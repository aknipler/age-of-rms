// The parser worker's reply protocol and the typing debounce, kept pure (no
// Worker, no React, no Monaco) so both can be tested in plain Vitest.
// docs/diagnostics-latency-report.md Sec.7 fixes 1 and 2 are why this exists.
import type { Diagnostic } from "../parser/types";
import type { ParseResultMessage } from "./parserWorker";

/**
 * How long typing must pause before a parse is sent, by document length.
 *
 * The debounce exists to coalesce keystrokes, so it should be no longer than
 * the work it saves. Measured on 2026-10-22 (report Sec.3.1), a whole round
 * trip is about 27 ms on a 2.5 KB map and 41 ms on Comeer's 42 KB, so a
 * 150 ms wait was most of the delay before squiggles on every small and
 * medium map. Vanguard (366 KB) takes 360 ms or more, part of it unpacking
 * the result on the UI thread, so parsing it after every keystroke would
 * stall typing. Big documents keep the old 150 ms.
 *
 * BUG-001's `reparseNow` never waits on this. It is for typing only.
 */
export const SHORT_DEBOUNCE_MS = 30;
export const LONG_DEBOUNCE_MS = 150;
export const SHORT_DEBOUNCE_MAX_CHARS = 50_000;

export function debounceMsFor(sourceLength: number): number {
  return sourceLength < SHORT_DEBOUNCE_MAX_CHARS
    ? SHORT_DEBOUNCE_MS
    : LONG_DEBOUNCE_MS;
}

/**
 * At or above this many tokens the worker posts the diagnostics on their own
 * first, then the full ParseResult. Below it, one message as before.
 *
 * Why not always split. Each message that changes state is its own React
 * commit, and on a small map the full result is so cheap to copy (about 1 ms
 * at 195 tokens, 14 ms at Comeer's 3.6k) that an extra commit would cost more
 * than it saves. The copy grows at about 5 microseconds per token, so at 10k
 * tokens the early diagnostics arrive about 50 ms sooner, and on Vanguard's
 * 49.7k about 150 to 250 ms sooner.
 */
export const EARLY_DIAGNOSTICS_MIN_TOKENS = 10_000;

/** The small message sent ahead of a big ParseResult. */
export interface ParseDiagnosticsMessage {
  kind: "diagnostics";
  requestId: number;
  diagnostics: Diagnostic[];
}

/**
 * How long the worker must sit idle before it starts the name liveness pass
 * (docs/name-liveness-slice-b-brief.md B1). The same wait the preview uses for
 * its own debounce. The analysis is not on the typing path: it runs after the
 * parse result is posted, and any message reaching the worker first cancels it.
 */
export const LIVENESS_IDLE_MS = 300;

/**
 * The liveness pass's reply, posted on its own after the parse result. It is
 * not part of the diagnostics-then-result pair, and it carries only the marks
 * the pass found, so a main thread that applies it never re-renders the card
 * tree (the cost docs/diagnostics-latency-report.md Sec.10 removed).
 */
export interface ParseLivenessMessage {
  kind: "liveness";
  /** The parse request this was computed for. */
  requestId: number;
  status: "complete" | "incomplete" | "overflow";
  diagnostics: Diagnostic[];
  /** How long the pass took inside the worker. */
  ms: number;
}

/**
 * Anything with a `data` field, which is all the router reads of a
 * MessageEvent. Declared this narrow so tests can pass an object whose
 * `data` getter counts how often it is read.
 */
export interface MessageLike<T> {
  readonly data: T;
}

export interface ParseResponseHandlers {
  /** Whether this request is still the newest one sent. */
  isCurrent(requestId: number): boolean;
  /** Early diagnostics for the newest request. */
  onDiagnostics(message: ParseDiagnosticsMessage): void;
  /** A full result. Its own handler still checks isCurrent, since an unsplit result is not pre-checked. */
  onResult(message: ParseResultMessage): void;
  /** A full result dropped unread because a newer request superseded it. */
  onSkippedResult(requestId: number): void;
  /**
   * A liveness reply. The handler decides whether it still applies. The router
   * cannot use `isCurrent` for it, since useParsedDocument forgets a request's
   * source once the request's result is applied, so by the time the liveness
   * reply arrives `isCurrent` is false for every one of them.
   */
  onLiveness(message: ParseLivenessMessage): void;
}

/**
 * Returns the worker's `onmessage` handler.
 *
 * The point of the router is what it does NOT do. Chromium turns a message's
 * bytes back into objects lazily, on the first read of `event.data`, and for
 * Vanguard that read costs 93 to 158 ms of UI thread time (report Sec.3.1).
 * A stale result is about to be thrown away, so reading it is pure waste. But
 * its request id lives inside `data`, so the id has to be known some other
 * way. It is known from the order of messages. The worker always posts a
 * split pair back to back, diagnostics then result, on the one channel, and
 * a channel keeps its order. So after a diagnostics message for request X,
 * the next message is X's result, and if X is no longer current the router
 * drops it without touching `data`.
 *
 * The pending id is a closure variable, not React state, because nothing
 * renders from it and it must update synchronously between two messages.
 */
export function createParseResponseRouter(
  handlers: ParseResponseHandlers,
): (
  event: MessageLike<
    ParseDiagnosticsMessage | ParseResultMessage | ParseLivenessMessage
  >,
) => void {
  let resultFollowsFor: number | null = null;
  return (event) => {
    // The worker posts a diagnostics message and its result back to back in
    // one task, and a liveness reply always in a later task (a timer that
    // fires after the worker has been idle). So a liveness reply can never sit
    // between the pair, and the "next message is the result" rule below stays
    // true without looking at it.
    if (resultFollowsFor !== null) {
      const requestId = resultFollowsFor;
      resultFollowsFor = null;
      if (!handlers.isCurrent(requestId)) {
        handlers.onSkippedResult(requestId);
        return;
      }
    }
    const data = event.data;
    if (data.kind === "liveness") {
      handlers.onLiveness(data);
      return;
    }
    // `kind` is the discriminant of a *discriminated union*. Checking it
    // narrows `data` to one member, so each branch below can only touch the
    // fields that member has.
    if (data.kind === "diagnostics") {
      resultFollowsFor = data.requestId;
      if (handlers.isCurrent(data.requestId)) handlers.onDiagnostics(data);
      return;
    }
    handlers.onResult(data);
  };
}
