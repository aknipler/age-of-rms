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
