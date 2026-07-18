import { useEffect, useRef, useState } from "react";
import ParserWorker from "./parserWorker?worker";
import type { ParseRequestMessage, ParseResponseMessage } from "./parserWorker";
import type { Diagnostic } from "../parser/types";
import type { ResourceTotals } from "../parser/resourceTotals";

// CREATION_PLAN 2.4: re-parse on change, debounced ~150ms, in a web
// worker so a slow parse of a huge map never blocks typing.
const DEBOUNCE_MS = 150;

const EMPTY_RESOURCE_TOTALS: ResourceTotals = {
  total: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
  player: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
  neutral: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
};

export interface RmsDiagnosticsState {
  /**
   * The exact source string these diagnostics were computed for. The
   * worker is async and debounced, so by the time a response arrives the
   * editor's content may have moved on — callers should compare this
   * against the model's *current* value before applying markers, rather
   * than trusting the response is still current.
   */
  source: string;
  diagnostics: Diagnostic[];
  /** Phase 2.5 — resource totals for the same `source`, same staleness caveat. */
  resourceTotals: ResourceTotals;
}

const EMPTY_STATE: RmsDiagnosticsState = { source: "", diagnostics: [], resourceTotals: EMPTY_RESOURCE_TOTALS };

/**
 * Debounced, worker-backed RMS parsing for live diagnostics + resource
 * totals. One worker per hook instance, terminated on unmount.
 *
 * `playerCount` comes from GenerationSettingsContext (Phase 2.5) — it's
 * read fresh on every re-parse rather than stored in a ref, so changing
 * player count in the settings dialog produces updated totals on the
 * next debounce tick without requiring a content edit first.
 */
export function useRmsDiagnostics(content: string, playerCount: number): RmsDiagnosticsState {
  const [state, setState] = useState<RmsDiagnosticsState>(EMPTY_STATE);
  const workerRef = useRef<Worker | null>(null);
  // Only the most recently SENT request's id is "current" — a response
  // for any earlier request means the user has since typed past it, and
  // must be dropped rather than applied out of order.
  const latestRequestIdRef = useRef(0);
  const sourceByRequestIdRef = useRef(new Map<number, string>());

  useEffect(() => {
    const worker = new ParserWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ParseResponseMessage>) => {
      const { requestId, diagnostics, resourceTotals } = event.data;
      const source = sourceByRequestIdRef.current.get(requestId);
      sourceByRequestIdRef.current.delete(requestId);
      if (source === undefined || requestId !== latestRequestIdRef.current) return;
      setState({ source, diagnostics, resourceTotals });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      sourceByRequestIdRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const worker = workerRef.current;
      if (!worker) return;
      const requestId = latestRequestIdRef.current + 1;
      latestRequestIdRef.current = requestId;
      sourceByRequestIdRef.current.set(requestId, content);
      const message: ParseRequestMessage = { requestId, source: content, playerCount };
      worker.postMessage(message);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timeoutId);
  }, [content, playerCount]);

  return state;
}
