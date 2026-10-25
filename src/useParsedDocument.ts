import { useCallback, useEffect, useRef, useState } from "react";
import ParserWorker from "./editor/parserWorker?worker";
import type {
  ParseRequestMessage,
  ParseResponseMessage,
} from "./editor/parserWorker";
import type { Diagnostic, ParseResult } from "./parser/types";
import { PERF_TRACE, perfLog } from "./perfTrace";
import {
  createParseResponseRouter,
  debounceMsFor,
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
}

const EMPTY_STATE: ParsedDocumentState = {
  source: "",
  parseResult: null,
  diagnostics: [],
  diagnosticsSource: "",
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
  const sourceByRequestIdRef = useRef(new Map<number, string>());
  // The text the newest request was sent for. The debounce below compares
  // against it, so text reparseNow already sent is not sent a second time.
  // A ref rather than state because nothing renders from it and the timer
  // callback has to read the value as it is when the timer fires.
  const lastSentSourceRef = useRef<string | null>(null);

  useEffect(() => {
    const worker = new ParserWorker();
    workerRef.current = worker;
    // A new worker has been sent nothing, so the debounce must not skip.
    lastSentSourceRef.current = null;
    const sourceByRequestId = sourceByRequestIdRef.current;

    const isCurrent = (requestId: number) =>
      requestId === latestRequestIdRef.current;
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
        sourceByRequestId.delete(requestId);
        if (source === undefined || !isCurrent(requestId)) return;
        setState({
          source,
          diagnostics,
          diagnosticsSource: source,
          parseResult,
        });
      },
      onSkippedResult: (requestId) => {
        sourceByRequestId.delete(requestId);
        perfLog(`parse #${requestId} tree superseded, dropped unread`);
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
      sendParseRequest(content);
    }, debounceMsFor(content.length));
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
