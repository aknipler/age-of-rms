import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ParserWorker from "./editor/parserWorker?worker";
import type {
  IncludesMessage,
  InstalledDefinitionsMessage,
  ParseRequestMessage,
  ParseResponseMessage,
} from "./editor/parserWorker";
import { useIncludeLoad, useInstalledDefinitions } from "./useIncludeFiles";
import type { Diagnostic, ParseResult } from "./parser/types";
import { PERF_TRACE, perfLog } from "./perfTrace";
import {
  createParseResponseRouter,
  debounceMsFor,
  type ParseLivenessMessage,
} from "./editor/parseResponses";

// docs/breakdown-design.md Sec.6.2: "one parse, in the worker". This
// supersedes the old src/editor/useRmsDiagnostics.ts. Breakdown needs
// the full ParseResult (the AST), not just diagnostics, so the parse is
// lifted to app level (AppContent) and both CodePane (diagnostics +
// source, for Monaco markers) and BreakdownPane (parseResult) consume
// the one hook instance's output. Debounced ~150ms, run in the existing
// worker (CREATION_PLAN 2.4) so typing-time parsing never blocks the UI
// thread, unchanged behavior from 2.4/2.5, just widened.
//
// Resource totals used to be computed here too (a static AST walk over
// script.script, playerCount as an input) and are gone as of the status-bar
// accuracy pass: they now come from a real generation's PreviewResult
// (resourceSummary.ts, read via PreviewResultContext), not a second copy of
// the parse's own numbers. `playerCount` accordingly is no longer this
// hook's concern.
//
// The debounce is 30 ms on documents under 50,000 characters and 150 ms on
// bigger ones, and a big document's diagnostics arrive ahead of its tree.
// Both are measured choices, see src/editor/parseResponses.ts and
// docs/diagnostics-latency-report.md.

export interface ParsedDocumentState {
  /**
   * The exact source string this state was computed for. Retained
   * deliberately (Sec.6.2): CodePane's marker-application effect uses it as
   * a staleness guard (`model.getValue() !== source` -> skip), and that
   * guard must survive the lift. `parseResult.source` carries the same
   * string once a parse has completed; `source` is exposed directly so
   * that guard reads the same as it always has, and so it's available
   * even before the first parse response arrives (empty string).
   */
  source: string;
  /** null until the first parse response arrives. */
  parseResult: ParseResult | null;
  diagnostics: Diagnostic[];
  /**
   * The exact source `diagnostics` was computed for. Usually equal to
   * `source`. On a big document the diagnostics arrive ahead of the tree, and
   * for that window this is the newer text while `source` and `parseResult`
   * still describe the older one. CodePane's marker guard reads this field,
   * so squiggles land as soon as the diagnostics do.
   */
  diagnosticsSource: string;
  /**
   * The name liveness marks (docs/name-liveness-slice-b-brief.md B6), which
   * arrive in their own message about 300 ms after the worker goes idle. They
   * live beside the parse result and never inside it, so a liveness reply does
   * not give Breakdown a new `parseResult` and re-render the card tree.
   * `source` is the text they were computed for. Readers merge them into a
   * diagnostics list only while it matches the text that list is for. A newly
   * applied result resets this to null, so marks for older text never meet
   * newer text. null until a reply arrives.
   */
  liveness: {
    source: string;
    status: ParseLivenessMessage["status"];
    diagnostics: Diagnostic[];
  } | null;
}

const EMPTY_STATE: ParsedDocumentState = {
  source: "",
  parseResult: null,
  diagnostics: [],
  diagnosticsSource: "",
  liveness: null,
};

export interface ParsedDocumentApi extends ParsedDocumentState {
  /**
   * BUG-001 (docs/known-issues.md) Part B, bypasses the debounce for a
   * single discrete, already-known-exact source string (a Breakdown card
   * action, as opposed to keystroke-by-keystroke typing, which still has
   * nothing to gain from immediate parsing and stays debounced). The
   * debounce exists to coalesce rapid keystrokes; a programmatic edit is
   * one event, so there's nothing to coalesce, and BUG-001's Part A
   * (BreakdownPane's anchor-shift queue) needs the matching reparse to
   * land as fast as possible to keep the "wrong card flashes expanded"
   * window as close to zero as achievable (worker round-trip only, not
   * the debounce on top). Safe to call with a source that never
   * actually renders (e.g. superseded by a second rapid edit). The
   * normal requestId-based staleness check drops it like any other
   * out-of-order response.
   */
  reparseNow: (source: string) => void;
}

/** The single parse of the current document (docs/breakdown-design.md Sec.6.2). */
export function useParsedDocument(content: string): ParsedDocumentApi {
  const [state, setState] = useState<ParsedDocumentState>(EMPTY_STATE);
  const workerRef = useRef<Worker | null>(null);
  // Only the most recently SENT request's id is "current". A response
  // for any earlier request means the user has since typed past it (or a
  // reparseNow superseded it), and must be dropped rather than applied
  // out of order.
  const latestRequestIdRef = useRef(0);
  // The request whose result is on screen, and the text it was for. A liveness
  // reply belongs to the screen only if it answers THIS request, and it takes
  // this text as its source. A ref, not state, for the same reason as the id
  // above: the reply handler reads it between renders.
  const appliedRef = useRef<{ requestId: number; source: string } | null>(null);
  const sourceByRequestIdRef = useRef(new Map<number, string>());
  // The requests reparseNow sent, which the reply handler applies even when
  // `content` has not caught up with their text yet (see isCurrent below).
  const exactRequestIdsRef = useRef(new Set<number>());
  // The text the newest request was sent for. The debounce below compares
  // against it, so text reparseNow already sent is not sent a second time.
  // A ref rather than state because nothing renders from it and the timer
  // callback has to read the value as it is when the timer fires.
  const lastSentSourceRef = useRef<string | null>(null);
  // The text the document holds right now, for the include effect below and
  // for the reply handler's "is this reply for the current text" test. The
  // effect must not depend on `content` itself, or it would resend the files
  // on every keystroke, so it reads the text through a ref instead.
  const contentRef = useRef(content);
  // Counts the workers this hook has created. The include effect below lists
  // it as a dependency so a fresh worker is sent the files again. A ref could
  // not do that job: changing a ref does not re-render, so no effect would
  // notice a new worker, and the files would stay with the old one.
  const [workerGeneration, setWorkerGeneration] = useState(0);
  // The script's #include_drs files, read from the user's install
  // (docs/include-resolution-design.md Sec.4.1).
  const includeLoad = useIncludeLoad(content);
  // The names the installed random_map.def defines, for RMS0324. Read once
  // per session, whatever the script includes.
  const installedDefinitions = useInstalledDefinitions();

  useEffect(() => {
    const worker = new ParserWorker();
    workerRef.current = worker;
    setWorkerGeneration((generation) => generation + 1);
    // A new worker has been sent nothing, so the debounce must not skip.
    lastSentSourceRef.current = null;
    const sourceByRequestId = sourceByRequestIdRef.current;
    // The same Set for the hook's whole life, read once so the cleanup below
    // clears the one this effect used.
    const exactRequestIds = exactRequestIdsRef.current;

    // A reply is worth reading only if it is for the newest request AND for
    // the text the document holds now. The second half is new (2026-11-04).
    // While the user types, the newest request is usually for text they have
    // already typed past, since the next request waits for the debounce.
    // Reading that reply anyway cost Stranded.rms about 125 ms of frozen UI
    // thread to unpack a 48,000 token tree, plus a React commit, for a tree
    // that was out of date before it landed. Its diagnostics were no use
    // either, since CodePane's marker guard skips diagnostics for text the
    // editor has moved past. So a big document's reply is now dropped unread,
    // the same way a superseded one is (parseResponses.ts), and the debounce
    // that the newer text armed asks for a fresh parse.
    //
    // reparseNow's requests skip the text check. A card action calls it with
    // the text it is about to produce, and the new content can reach this
    // hook a moment after the reply does. Dropping that reply would cost
    // BUG-001's fast path a second round trip.
    const isCurrent = (requestId: number) =>
      requestId === latestRequestIdRef.current &&
      (exactRequestIds.has(requestId) ||
        sourceByRequestId.get(requestId) === contentRef.current);
    // Called when a reply is thrown away. If it was the newest request's, the
    // text it was for no longer counts as sent, so the debounce's "same text
    // as last time" test cannot skip it. Without this, typing a character
    // and undoing it inside one round trip would leave the screen on the
    // older parse until the next edit, since the undo brings back exactly
    // the text whose reply was just dropped.
    const forgetDropped = (requestId: number) => {
      sourceByRequestId.delete(requestId);
      exactRequestIds.delete(requestId);
      if (requestId === latestRequestIdRef.current) {
        lastSentSourceRef.current = null;
      }
    };
    const route = createParseResponseRouter({
      isCurrent,
      // A big document's diagnostics, ahead of its tree. Only the diagnostic
      // half of the state moves, so `source` and `parseResult` stay a
      // matching pair for Breakdown and the selection anchor, while CodePane
      // reads `diagnosticsSource` for its marker guard.
      onDiagnostics: ({ requestId, diagnostics }) => {
        const source = sourceByRequestId.get(requestId);
        if (source === undefined) return;
        perfLog(`parse #${requestId} diagnostics back`);
        setState((previous) => ({
          ...previous,
          diagnostics,
          diagnosticsSource: source,
        }));
      },
      onResult: (message) => {
        const { requestId, diagnostics, parseResult } = message;
        if (PERF_TRACE) {
          perfLog(
            `parse #${requestId} back`,
            `${message.tokenCount} tokens, worker lex+parse ${message.lexParseMs.toFixed(1)} ms, validate ${message.validateMs.toFixed(1)} ms, posted to unpacked ${(performance.timeOrigin + performance.now() - message.postedAtEpochMs).toFixed(1)} ms`,
          );
        }
        const source = sourceByRequestId.get(requestId);
        // Checked before the entry is deleted, since isCurrent reads it.
        if (source === undefined || !isCurrent(requestId)) {
          forgetDropped(requestId);
          return;
        }
        sourceByRequestId.delete(requestId);
        exactRequestIds.delete(requestId);
        appliedRef.current = { requestId, source };
        setState({
          source,
          diagnostics,
          diagnosticsSource: source,
          parseResult,
          // Marks for the older text would sit on the wrong lines.
          liveness: null,
        });
      },
      // The liveness pass answers a request whose result was applied some
      // time ago, so isCurrent cannot judge it (the hook forgets a request's
      // source once its result lands). It applies when it answers the request
      // on screen AND that request is still the newest sent. A newer request in
      // flight means the text is about to change, and its own pass will follow.
      onLiveness: ({ requestId, status, diagnostics }) => {
        const applied = appliedRef.current;
        if (
          applied === null ||
          applied.requestId !== requestId ||
          requestId !== latestRequestIdRef.current
        ) {
          perfLog(`liveness #${requestId} out of date, dropped`);
          return;
        }
        setState((previous) => ({
          ...previous,
          liveness: { source: applied.source, status, diagnostics },
        }));
      },
      onSkippedResult: (requestId) => {
        forgetDropped(requestId);
        perfLog(`parse #${requestId} tree out of date, dropped unread`);
      },
    });

    worker.onmessage = (event: MessageEvent<ParseResponseMessage>) => {
      if (!PERF_TRACE) {
        route(event);
        return;
      }
      // Chromium turns the worker's bytes back into objects lazily, on the
      // first read of event.data, which happens inside route(). So the time
      // around it is the main thread's share of the structured clone.
      const arrivedAt = performance.now();
      route(event);
      perfLog(
        "parse message handled",
        `main thread unpack and state update ${(performance.now() - arrivedAt).toFixed(1)} ms`,
      );
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      sourceByRequestId.clear();
      exactRequestIds.clear();
    };
  }, []);

  // Shared by both the debounced typing path and reparseNow, so "send a
  // parse request" has exactly one implementation. `exact` is reparseNow's
  // promise that `source` is the text the document is about to hold.
  const sendParseRequest = useCallback((source: string, exact: boolean) => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    sourceByRequestIdRef.current.set(requestId, source);
    if (exact) exactRequestIdsRef.current.add(requestId);
    lastSentSourceRef.current = source;
    const message: ParseRequestMessage = { requestId, source };
    perfLog(`parse #${requestId} sent`, `${source.length} chars`);
    worker.postMessage(message);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      // A card action calls reparseNow with the text it produced, and that
      // same text then arrives here as new content. Sending it again would
      // make the first request stale (only the newest id counts), so when the
      // round trip outlasted this debounce the first reply was dropped and
      // the screen waited for a second parse of identical text. Matching the
      // newest request's text, not the applied text, is what makes this safe
      // while that request is still in flight.
      if (content === lastSentSourceRef.current) return;
      sendParseRequest(content, false);
    }, debounceMsFor(content.length));
    return () => window.clearTimeout(timeoutId);
  }, [content, sendParseRequest]);

  // A layout effect, not a plain one. React runs layout effects inside the
  // commit itself, so no worker message can be handled between the new text
  // reaching the screen and this ref learning it. A plain effect runs a
  // moment later, in a task of its own, and a reply handled in that gap
  // would be compared with the text from one keystroke earlier.
  useLayoutEffect(() => {
    contentRef.current = content;
  }, [content]);

  useEffect(() => {
    const worker = workerRef.current;
    // Nothing to send while no include has loaded, and a worker not yet made
    // has nowhere to put it (the generation bump re-runs this once it exists).
    if (includeLoad === undefined || worker === null) return;
    const message: IncludesMessage = {
      kind: "includes",
      files: includeLoad === null ? null : includeLoad.files,
      requested: includeLoad === null ? [] : includeLoad.requested,
    };
    worker.postMessage(message);
    // The files changed what the checks can say about the text already
    // parsed, so parse it again now rather than waiting for a keystroke. This
    // goes through sendParseRequest, which skips the debounce's "same text as
    // last time" test on purpose.
    sendParseRequest(contentRef.current, false);
  }, [includeLoad, workerGeneration, sendParseRequest]);

  // The installed definitions travel the same way the include files do, as a
  // message the long-lived worker keeps. `undefined` means still loading, so
  // nothing is sent and the worker's default (not loaded, which reads as no
  // install) stands until the answer arrives. A Set does not clone through
  // postMessage cheaply to read back, so it goes as an array.
  useEffect(() => {
    const worker = workerRef.current;
    if (installedDefinitions === undefined || worker === null) return;
    const message: InstalledDefinitionsMessage = {
      kind: "installedDefinitions",
      names: installedDefinitions === null ? null : [...installedDefinitions],
    };
    worker.postMessage(message);
    // Same reason as the includes message: the checks can now say something
    // different about the text already parsed.
    sendParseRequest(contentRef.current, false);
  }, [installedDefinitions, workerGeneration, sendParseRequest]);

  const reparseNow = useCallback(
    (source: string) => {
      sendParseRequest(source, true);
    },
    [sendParseRequest],
  );

  return { ...state, reparseNow };
}
