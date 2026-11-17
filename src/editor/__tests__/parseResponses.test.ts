// The parser worker's reply router and the size-scaled debounce
// (docs/diagnostics-latency-report.md Sec.7 fixes 1 and 2). The router's whole
// value is a read it avoids, so the messages here count how often their
// `data` is read, the way Chromium's lazy unpack would be paid.
import { describe, expect, it } from "vitest";
import {
  LONG_DEBOUNCE_MS,
  SHORT_DEBOUNCE_MAX_CHARS,
  SHORT_DEBOUNCE_MS,
  createParseResponseRouter,
  debounceMsFor,
  type MessageLike,
  type ParseDiagnosticsMessage,
  type ParseLivenessMessage,
} from "../parseResponses";
import type { ParseResultMessage } from "../parserWorker";
import type { ParseResult } from "../../parser/types";

function diagnosticsMessage(requestId: number): ParseDiagnosticsMessage {
  return { kind: "diagnostics", requestId, diagnostics: [] };
}

function resultMessage(requestId: number): ParseResultMessage {
  return {
    kind: "result",
    requestId,
    diagnostics: [],
    tokenCount: 0,
    parseTimeMs: 0,
    lexParseMs: 0,
    validateMs: 0,
    postedAtEpochMs: 0,
    parseResult: {} as ParseResult,
  };
}

function livenessMessage(requestId: number): ParseLivenessMessage {
  return {
    kind: "liveness",
    requestId,
    status: "complete",
    diagnostics: [],
    ms: 0,
  };
}

/** A MessageEvent stand-in whose `data` getter records every read. */
function counted<T>(data: T): MessageLike<T> & { reads: number } {
  const event = {
    reads: 0,
    get data() {
      event.reads++;
      return data;
    },
  };
  return event;
}

function setup(latest: { id: number }) {
  const calls: string[] = [];
  const route = createParseResponseRouter({
    isCurrent: (id) => id === latest.id,
    onDiagnostics: (m) => calls.push(`diagnostics ${m.requestId}`),
    onResult: (m) => calls.push(`result ${m.requestId}`),
    onSkippedResult: (id) => calls.push(`skipped ${id}`),
    onLiveness: (m) => calls.push(`liveness ${m.requestId}`),
  });
  return { route, calls };
}

describe("createParseResponseRouter", () => {
  it("passes a lone result straight through, as small documents send it", () => {
    const latest = { id: 1 };
    const { route, calls } = setup(latest);
    route(counted(resultMessage(1)));
    expect(calls).toEqual(["result 1"]);
  });

  it("applies a current pair's diagnostics first, then its result", () => {
    const latest = { id: 4 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(4)));
    route(counted(resultMessage(4)));
    expect(calls).toEqual(["diagnostics 4", "result 4"]);
  });

  it("never reads a superseded result's data", () => {
    const latest = { id: 2 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(2)));
    // The user types on and request 3 is sent while 2's tree is in flight.
    latest.id = 3;
    const staleResult = counted(resultMessage(2));
    route(staleResult);
    expect(staleResult.reads).toBe(0);
    expect(calls).toEqual(["diagnostics 2", "skipped 2"]);
  });

  it("does not apply diagnostics for a request that is already stale", () => {
    const latest = { id: 6 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(5)));
    const staleResult = counted(resultMessage(5));
    route(staleResult);
    expect(staleResult.reads).toBe(0);
    expect(calls).toEqual(["skipped 5"]);
  });

  it("reads the message after a skipped result normally", () => {
    const latest = { id: 7 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(7)));
    latest.id = 8;
    route(counted(resultMessage(7)));
    const next = counted(resultMessage(8));
    route(next);
    expect(next.reads).toBeGreaterThan(0);
    expect(calls).toEqual(["diagnostics 7", "skipped 7", "result 8"]);
  });
});

describe("createParseResponseRouter, liveness replies", () => {
  it("hands every liveness reply to onLiveness, current or not", () => {
    const latest = { id: 9 };
    const { route, calls } = setup(latest);
    route(counted(livenessMessage(2)));
    route(counted(livenessMessage(9)));
    expect(calls).toEqual(["liveness 2", "liveness 9"]);
  });

  it("keeps a diagnostics, result, liveness sequence paired", () => {
    const latest = { id: 5 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(5)));
    route(counted(resultMessage(5)));
    route(counted(livenessMessage(5)));
    expect(calls).toEqual(["diagnostics 5", "result 5", "liveness 5"]);
  });

  it("still skips a superseded result unread when a liveness reply follows it", () => {
    const latest = { id: 5 };
    const { route, calls } = setup(latest);
    route(counted(diagnosticsMessage(5)));
    latest.id = 6;
    const stale = counted(resultMessage(5));
    route(stale);
    route(counted(livenessMessage(5)));
    expect(stale.reads).toBe(0);
    expect(calls).toEqual(["diagnostics 5", "skipped 5", "liveness 5"]);
  });
});

describe("debounceMsFor", () => {
  it("is short below the size limit and long from it on", () => {
    expect(debounceMsFor(0)).toBe(SHORT_DEBOUNCE_MS);
    expect(debounceMsFor(SHORT_DEBOUNCE_MAX_CHARS - 1)).toBe(SHORT_DEBOUNCE_MS);
    expect(debounceMsFor(SHORT_DEBOUNCE_MAX_CHARS)).toBe(LONG_DEBOUNCE_MS);
  });

  it("puts the measured maps in the tier their round trip calls for", () => {
    // Comeer v1.5 is 42,423 characters, a 41 ms round trip. Vanguard is
    // 366,303, about 360 ms (report Sec.3.1).
    expect(debounceMsFor(42_423)).toBe(SHORT_DEBOUNCE_MS);
    expect(debounceMsFor(366_303)).toBe(LONG_DEBOUNCE_MS);
    expect(SHORT_DEBOUNCE_MS).toBeLessThan(LONG_DEBOUNCE_MS);
  });
});
