import { useCallback, useEffect, useRef, useState } from "react";
import ParserWorker from "./editor/parserWorker?worker";
import type { ParseRequestMessage, ParseResponseMessage } from "./editor/parserWorker";
import type { Diagnostic, ParseResult } from "./parser/types";

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
const DEBOUNCE_MS = 150;

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
}

const EMPTY_STATE: ParsedDocumentState = {
  source: "",
  parseResult: null,
  diagnostics: [],
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
   * +150ms debounce on top). Safe to call with a source that never
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
  const sourceByRequestIdRef = useRef(new Map<number, string>());

  useEffect(() => {
    const worker = new ParserWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ParseResponseMessage>) => {
      const { requestId, diagnostics, parseResult } = event.data;
      const source = sourceByRequestIdRef.current.get(requestId);
      sourceByRequestIdRef.current.delete(requestId);
      if (source === undefined || requestId !== latestRequestIdRef.current) return;
      setState({ source, diagnostics, parseResult });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      sourceByRequestIdRef.current.clear();
    };
  }, []);

  // Shared by both the debounced typing path and reparseNow, so "send a
  // parse request" has exactly one implementation.
  const sendParseRequest = useCallback((source: string) => {
    const worker = workerRef.current;
    if (!worker) return;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    sourceByRequestIdRef.current.set(requestId, source);
    const message: ParseRequestMessage = { requestId, source };
    worker.postMessage(message);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => sendParseRequest(content), DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [content, sendParseRequest]);

  const reparseNow = useCallback(
    (source: string) => {
      sendParseRequest(source);
    },
    [sendParseRequest],
  );

  return { ...state, reparseNow };
}
