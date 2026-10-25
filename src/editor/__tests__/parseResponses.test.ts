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
