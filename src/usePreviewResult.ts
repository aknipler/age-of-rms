import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PreviewWorker from "./preview/worker?worker";
import type { ParseResult } from "./parser/types";
import type { PreviewRequest, PreviewResponse, PreviewResult, PreviewSettings } from "./preview/generator/types";
import type { MapSize, TeamNumber } from "./generationSettings/generationSettingsConstants";

// docs/preview-design.md Sec.10. Mirrors useParsedDocument.ts's shape
// closely on purpose — same worker lifecycle, same request-id staleness
// discard — plus the one thing that hook doesn't need: a watchdog, since
// generatePreview is synchronous and a pathological script (Sec.11's
// iteration-cap escape hatches aside) could in principle run long enough to
// block a worker's onmessage from ever firing again.
const DEBOUNCE_MS = 300; // Sec.10: "regenerate ~300ms [tune] after the parse settles"

/**
 * How long a request may be outstanding before the worker is assumed wedged.
 *
 * Sec.10 says "Sec.11's hard ceiling plus headroom" and this was 1000ms,
 * taken from Sec.11's 40ms-per-stage budget. **That budget is not what the
 * pipeline costs**, and the gap turned the watchdog from a safety net into
 * the bug: measured over the 32 tracked maps (2026-08-07), a full
 * `generatePreview` runs a median of ~460ms and up to 3.8s. So the corpus's
 * heavier maps were reliably killed at 1000ms — and because the timeout
 * re-posts the same request and re-arms itself, they were killed again, and
 * again, forever. A map that took 1.2s to generate would never render at all
 * and would pin a core doing it. This is exactly the shape of "slow preview"
 * a user reports.
 *
 * 12s is chosen against the measured worst case with a wide margin, not
 * against the stage budget: the watchdog exists for a worker that has stopped
 * responding, and every real generation must finish well inside it or the
 * mechanism is fighting the thing it protects.
 */
const WATCHDOG_MS = 12_000;

/**
 * How many times one request may be re-posted before giving up on it.
 *
 * The unbounded retry above is only half the defect. A script that hangs
 * deterministically hangs identically on retry, so "keep retrying until a
 * newer request supersedes it" is an infinite loop whenever the user stops
 * typing — which is precisely when they are waiting for the preview. Two
 * attempts is enough to survive a genuinely stuck worker; past that the
 * honest answer is to stop and keep showing the last good result.
 */
const MAX_WATCHDOG_RETRIES = 2;

export interface PreviewResultState {
  /** null until the first response arrives (or there is no parse to generate from yet). */
  result: PreviewResult | null;
}

/**
 * The single generated preview for the current document (Sec.10). Runs
 * generatePreview() in a dedicated worker, debounced after the parse
 * settles. `playerCount`/`mapSize`/`teams` are taken as separate primitives
 * (matching useParsedDocument's own `playerCount` param) rather than one
 * `PreviewSettings` object, so a caller building that object fresh every
 * render doesn't reset the debounce timer on referential inequality alone —
 * this hook builds its own stable one via useMemo.
 */
export function usePreviewResult(
  parseResult: ParseResult | null,
  playerCount: number,
  mapSize: MapSize,
  teams: readonly TeamNumber[],
  seed: number,
): PreviewResultState {
  const [result, setResult] = useState<PreviewResult | null>(null);
  const workerRef = useRef<Worker | null>(null);
  // Only the most recently SENT request's id is "current" — mirrors
  // useParsedDocument.ts's latestRequestIdRef exactly, same reason: a
  // response (or a watchdog firing) for any earlier request means a newer
  // one has since superseded it and must be dropped/ignored.
  const latestRequestIdRef = useRef(0);
  const watchdogTimeoutRef = useRef<number | null>(null);
  // Retry count per request id. A ref, not state: nothing renders from it, and
  // a write must not schedule a render. Only the current id is ever read, and
  // ids are monotonic, so the map is cleared whenever a new request is sent
  // rather than growing for the life of the session.
  const retriesRef = useRef<Map<number, number>>(new Map());

  const settings: PreviewSettings = useMemo(() => ({ playerCount, mapSize, teams }), [playerCount, mapSize, teams]);

  const clearWatchdog = useCallback((): void => {
    if (watchdogTimeoutRef.current !== null) {
      window.clearTimeout(watchdogTimeoutRef.current);
      watchdogTimeoutRef.current = null;
    }
  }, []);

  const attachHandlers = useCallback(
    (worker: Worker): void => {
      worker.onmessage = (event: MessageEvent<PreviewResponse>) => {
        const data = event.data;
        // Stale response (a newer request has since been sent, or the
        // watchdog already reposted this one under a fresh id) -- drop it,
        // same discard-by-id rule as useParsedDocument.ts.
        if (data.id !== latestRequestIdRef.current) return;
        clearWatchdog();
        if (data.ok) setResult(data.result);
        // data.ok === false (abandoned) never actually arrives from THIS
        // worker in practice -- see worker.ts's header: a worker can't post
        // it about itself. Handled here only because the type is a
        // discriminated union and narrowing must cover both arms.
      };
    },
    [clearWatchdog],
  );

  const spawnWorker = useCallback((): Worker => {
    const worker = new PreviewWorker();
    attachHandlers(worker);
    workerRef.current = worker;
    return worker;
  }, [attachHandlers]);

  // Forward-declared via ref so armWatchdog and sendRequest can call each
  // other (the watchdog re-posts by calling the same send path) without a
  // circular useCallback dependency.
  const sendRequestRef = useRef<(request: PreviewRequest) => void>(() => {});

  const armWatchdog = useCallback(
    (request: PreviewRequest): void => {
      clearWatchdog();
      watchdogTimeoutRef.current = window.setTimeout(() => {
        // Only act if THIS request is still the outstanding one -- a
        // response may have raced in and already cleared the watchdog by
        // the time this fires under contention.
        if (request.id !== latestRequestIdRef.current) return;
        workerRef.current?.terminate();
        spawnWorker();
        // Bounded, unlike the original. Re-posting re-arms the watchdog
        // (postRequest calls armWatchdog again), so without a counter a
        // deterministically-hanging script retries forever -- see
        // MAX_WATCHDOG_RETRIES. After the last attempt the worker is left
        // freshly spawned and idle, ready for the NEXT edit, and the pane
        // keeps showing the last good result. Sec.10 says this moment
        // "emits {ok:false, abandoned: true} for the outstanding id"; not
        // surfaced here, since this hook's public state is just the latest
        // successful `result` -- a future stalled-generation indicator
        // would hook in exactly here.
        const attempts = (retriesRef.current.get(request.id) ?? 0) + 1;
        if (attempts > MAX_WATCHDOG_RETRIES) return;
        retriesRef.current.set(request.id, attempts);
        sendRequestRef.current(request);
      }, WATCHDOG_MS);
    },
    [clearWatchdog, spawnWorker],
  );

  const postRequest = useCallback(
    (request: PreviewRequest): void => {
      workerRef.current?.postMessage(request);
      armWatchdog(request);
    },
    [armWatchdog],
  );
  sendRequestRef.current = postRequest;

  useEffect(() => {
    spawnWorker();
    return () => {
      clearWatchdog();
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only, matching useParsedDocument.ts's own worker-lifecycle effect
  }, []);

  useEffect(() => {
    if (parseResult === null) return;
    const timeoutId = window.setTimeout(() => {
      const id = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = id;
      retriesRef.current.clear(); // every earlier id is superseded and can never retry again
      postRequest({ id, parse: parseResult, settings, opts: { seed, collectSnapshots: true } });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [parseResult, settings, seed, postRequest]);

  return { result };
}
