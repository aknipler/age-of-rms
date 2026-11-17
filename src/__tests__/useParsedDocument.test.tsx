// A Breakdown card action changes the document and calls reparseNow with the
// edited text, then the same change reaches useParsedDocument as new content
// and arms the typing debounce. Both used to send a parse request for the
// same text. Only the newest request counts, so when the round trip outlasted
// the debounce the reply to the first was dropped as stale and the screen
// waited for the second. These drive the real hook against a fake worker, so
// what is asserted is which requests were posted and which reply landed.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounceMsFor } from "../editor/parseResponses";

const fake = vi.hoisted(() => ({
  posted: [] as { requestId: number; source: string }[],
  worker: null as { onmessage: ((e: unknown) => void) | null } | null,
}));

vi.mock("../editor/parserWorker?worker", () => ({
  default: class FakeWorker {
    onmessage: ((e: unknown) => void) | null = null;
    constructor() {
      fake.worker = this;
    }
    postMessage(message: { requestId: number; source: string }) {
      fake.posted.push(message);
    }
    terminate() {}
  },
}));

import { useParsedDocument } from "../useParsedDocument";

const DEBOUNCE = debounceMsFor(1);

// The worker's answer to one request, as the hook's router receives it.
function reply(requestId: number, source: string) {
  act(() => {
    fake.worker!.onmessage!({
      data: {
        kind: "result",
        requestId,
        diagnostics: [],
        tokenCount: 0,
        parseTimeMs: 0,
        lexParseMs: 0,
        validateMs: 0,
        postedAtEpochMs: 0,
        parseResult: { source, tokens: [], script: { sections: [] } },
      },
    });
  });
}

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

// Mounts on "A" and answers its first parse, so each test starts settled.
function settledOnA() {
  const hook = renderHook(({ content }) => useParsedDocument(content), {
    initialProps: { content: "A" },
  });
  advance(DEBOUNCE);
  reply(1, "A");
  expect(hook.result.current.source).toBe("A");
  return hook;
}

beforeEach(() => {
  fake.posted.length = 0;
  fake.worker = null;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useParsedDocument after a card action", () => {
  it("sends one request and applies its reply even when the round trip outlasts the debounce", () => {
    const { result, rerender } = settledOnA();

    act(() => result.current.reparseNow("B"));
    rerender({ content: "B" });
    advance(DEBOUNCE + 5);

    expect(fake.posted.map((p) => p.source)).toEqual(["A", "B"]);

    reply(2, "B");
    expect(result.current.source).toBe("B");
  });

  it("still sends typed text after the debounce", () => {
    const { result, rerender } = settledOnA();

    rerender({ content: "AB" });
    expect(fake.posted).toHaveLength(1);
    advance(DEBOUNCE);

    expect(fake.posted.map((p) => p.source)).toEqual(["A", "AB"]);
    reply(2, "AB");
    expect(result.current.source).toBe("AB");
  });

  it("applies reparseNow's reply before the new content has reached the hook", () => {
    const { result } = settledOnA();

    act(() => result.current.reparseNow("B"));
    // No rerender with "B" yet, which is the race a card action can lose.
    reply(2, "B");

    expect(result.current.source).toBe("B");
  });

  it("sends text that matches an older request but not the newest one", () => {
    const { rerender } = settledOnA();

    rerender({ content: "B" });
    advance(DEBOUNCE);
    // Back to what the first request held, as an undo does.
    rerender({ content: "A" });
    advance(DEBOUNCE);

    expect(fake.posted.map((p) => p.source)).toEqual(["A", "B", "A"]);
  });
});

// While the user types, the newest request is usually for text they have
// already typed past, because the next request waits for the debounce. On a
// big map unpacking that reply froze the UI thread for about 125 ms
// (docs/diagnostics-latency-report.md Sec.10), so it is dropped instead.
describe("useParsedDocument while typing past an in-flight parse", () => {
  it("drops the reply for older text and parses the newer text", () => {
    const { result, rerender } = settledOnA();

    rerender({ content: "AB" });
    advance(DEBOUNCE);
    rerender({ content: "ABC" });
    reply(2, "AB");

    expect(result.current.source).toBe("A");
    advance(DEBOUNCE);
    expect(fake.posted.map((p) => p.source)).toEqual(["A", "AB", "ABC"]);
    reply(3, "ABC");
    expect(result.current.source).toBe("ABC");
  });

  it("parses again when an undo returns to the text whose reply was dropped", () => {
    const { result, rerender } = settledOnA();

    rerender({ content: "AB" });
    advance(DEBOUNCE);
    rerender({ content: "ABC" });
    reply(2, "AB");
    // Undo, back to the text request 2 was for, before the debounce fires.
    rerender({ content: "AB" });
    advance(DEBOUNCE);

    expect(fake.posted.map((p) => p.source)).toEqual(["A", "AB", "AB"]);
    reply(3, "AB");
    expect(result.current.source).toBe("AB");
  });

  it("never reads a big document's tree for text the user has typed past", () => {
    const { result, rerender } = settledOnA();

    rerender({ content: "AB" });
    advance(DEBOUNCE);
    rerender({ content: "ABC" });

    // A big document's reply is a pair, diagnostics then tree. Reading the
    // tree message's `data` is the expensive unpack, so the getter counts it.
    let treeReads = 0;
    act(() => {
      fake.worker!.onmessage!({
        data: { kind: "diagnostics", requestId: 2, diagnostics: [] },
      });
      fake.worker!.onmessage!({
        get data() {
          treeReads++;
          return { kind: "result", requestId: 2 };
        },
      });
    });

    expect(treeReads).toBe(0);
    expect(result.current.source).toBe("A");
  });
});

// The worker's liveness reply arrives on its own after the result
// (docs/name-liveness-slice-b-brief.md item 5). It belongs to the request on
// screen and to nothing else.
describe("useParsedDocument and liveness replies", () => {
  const mark = {
    severity: "info" as const,
    code: "RMS0321",
    message: "constructed",
    span: { start: 0, end: 1 },
  };
  const livenessReply = (requestId: number) =>
    act(() => {
      fake.worker!.onmessage!({
        data: {
          kind: "liveness",
          requestId,
          status: "complete",
          diagnostics: [mark],
          ms: 1,
        },
      });
    });

  it("lands a reply for the request on screen, tagged with that text", () => {
    const { result } = settledOnA();
    expect(result.current.liveness).toBeNull();
    livenessReply(1);
    expect(result.current.liveness).toEqual({
      source: "A",
      status: "complete",
      diagnostics: [mark],
    });
  });

  it("drops a reply for an earlier request", () => {
    const { result, rerender } = settledOnA();
    rerender({ content: "AB" });
    advance(DEBOUNCE);
    reply(2, "AB");
    // Request 1's marks are for text that is gone.
    livenessReply(1);
    expect(result.current.liveness).toBeNull();
    livenessReply(2);
    expect(result.current.liveness?.source).toBe("AB");
  });

  it("drops a reply once a newer request has been sent", () => {
    const { result, rerender } = settledOnA();
    rerender({ content: "AB" });
    advance(DEBOUNCE);
    livenessReply(1);
    expect(result.current.liveness).toBeNull();
  });

  it("drops a reply for the newest request when its result was never applied", () => {
    const { result, rerender } = settledOnA();
    rerender({ content: "AB" });
    advance(DEBOUNCE);
    // The user types on before request 2 is answered, so its result is dropped
    // unread, while request 2 is still the newest one sent. Applying its
    // marks would put marks for "AB" beside the screen's "A".
    rerender({ content: "ABC" });
    reply(2, "AB");
    expect(result.current.source).toBe("A");
    livenessReply(2);
    expect(result.current.liveness).toBeNull();
  });

  it("clears the marks when a new result is applied", () => {
    const { result, rerender } = settledOnA();
    livenessReply(1);
    expect(result.current.liveness).not.toBeNull();
    rerender({ content: "AB" });
    advance(DEBOUNCE);
    reply(2, "AB");
    expect(result.current.liveness).toBeNull();
  });
});
