// seedMemory.ts. A replacement seed found at tutorial start is saved, used
// first on the next start, and dropped when it no longer applies. The check
// itself is a fake here, seedCheck.test.ts runs the real one.

import { describe, expect, it, vi } from "vitest";
import { isRememberedSeed, type RememberedSeed } from "../../tutorialConstants";
import { prepareWithMemory, type PrepareSeedDeps } from "../seedMemory";
import type { SeedRunResult } from "../seedRunner";

const PINNED = 55;

function setup(
  stored: RememberedSeed | undefined,
  result: SeedRunResult,
): {
  deps: PrepareSeedDeps;
  saved: () => RememberedSeed | undefined;
  candidates: () => readonly number[];
  provisional: () => (number | null)[];
} {
  let memory = stored;
  let asked: readonly number[] = [];
  const provisional: (number | null)[] = [];
  const deps: PrepareSeedDeps = {
    pinned: PINNED,
    memory: {
      read: () => Promise.resolve(memory),
      write: (value) => {
        memory = value ?? undefined;
        return Promise.resolve();
      },
    },
    run: (candidates) => {
      asked = candidates;
      return Promise.resolve(result);
    },
    setResult: () => {},
    setProvisional: (seed) => provisional.push(seed),
  };
  return {
    deps,
    saved: () => memory,
    candidates: () => asked,
    provisional: () => provisional,
  };
}

const signal = (): AbortSignal => new AbortController().signal;

describe("the saved replacement seed", () => {
  it("is saved when a search finds one", async () => {
    const t = setup(undefined, { status: "found", seed: 123, tried: 9 });
    await prepareWithMemory(t.deps, signal());
    expect(t.candidates()).toEqual([PINNED]);
    expect(t.saved()).toEqual({ seed: 123, replaces: PINNED });
  });

  it("is checked first and used before the check ends, on the next start", async () => {
    const t = setup(
      { seed: 123, replaces: PINNED },
      { status: "pinned", seed: 123 },
    );
    await prepareWithMemory(t.deps, signal());
    expect(t.candidates()).toEqual([123, PINNED]);
    // Cleared first, then set to the saved seed before the worker answers.
    expect(t.provisional()).toEqual([null, 123]);
    expect(t.saved()).toEqual({ seed: 123, replaces: PINNED });
  });

  it("is ignored when it replaced a different pinned seed, and then overwritten", async () => {
    const t = setup(
      { seed: 123, replaces: 13 },
      { status: "found", seed: 134, tried: 4 },
    );
    await prepareWithMemory(t.deps, signal());
    expect(t.candidates()).toEqual([PINNED]);
    expect(t.provisional()).toEqual([null]);
    expect(t.saved()).toEqual({ seed: 134, replaces: PINNED });
  });

  it("is cleared once the pinned seed passes again", async () => {
    const t = setup(
      { seed: 123, replaces: 13 },
      { status: "pinned", seed: PINNED },
    );
    await prepareWithMemory(t.deps, signal());
    expect(t.saved()).toBeUndefined();
  });

  it("is kept when the check finds nothing or cannot run", async () => {
    const results: SeedRunResult[] = [
      { status: "none", failed: ["players-on-a-diagonal"] },
      { status: "unavailable", reason: "timeout" },
    ];
    for (const result of results) {
      const t = setup({ seed: 123, replaces: PINNED }, result);
      await prepareWithMemory(t.deps, signal());
      expect(t.saved()).toEqual({ seed: 123, replaces: PINNED });
    }
  });

  it("is not written after the tutorial was exited", async () => {
    const t = setup(undefined, { status: "found", seed: 123, tried: 9 });
    const controller = new AbortController();
    t.deps.run = () => {
      controller.abort();
      return Promise.resolve({ status: "found", seed: 123, tried: 9 });
    };
    expect(await prepareWithMemory(t.deps, controller.signal)).toBeNull();
    expect(t.saved()).toBeUndefined();
  });

  it("does not stop the check when the store cannot be read", async () => {
    const t = setup(undefined, { status: "pinned", seed: PINNED });
    t.deps.memory.read = () => Promise.reject(new Error("no store"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await prepareWithMemory(t.deps, signal());
    warn.mockRestore();
    expect(result).toEqual({ status: "pinned", seed: PINNED });
    expect(t.candidates()).toEqual([PINNED]);
  });

  it("only reads back a well formed value", () => {
    expect(isRememberedSeed({ seed: 1, replaces: 2 })).toBe(true);
    for (const bad of [
      null,
      5,
      {},
      { seed: "1", replaces: 2 },
      { seed: 1.5, replaces: 2 },
    ])
      expect(isRememberedSeed(bad)).toBe(false);
  });
});
