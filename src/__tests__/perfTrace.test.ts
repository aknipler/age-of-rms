// src/perfTrace.ts is opt-in instrumentation left in hot paths (every
// keystroke, every parse). These pin the promise that makes leaving it in
// acceptable: with the flag off it prints nothing and every wrapper hands the
// wrapped value straight back. The flag is read once at module load, so each
// test re-imports the module after setting localStorage.
import { afterEach, describe, expect, it, vi } from "vitest";

async function load(flag: string | null) {
  vi.resetModules();
  if (flag === null) localStorage.removeItem("aorms.perfTrace");
  else localStorage.setItem("aorms.perfTrace", flag);
  return import("../perfTrace");
}

afterEach(() => {
  localStorage.removeItem("aorms.perfTrace");
  vi.restoreAllMocks();
});

describe("perfTrace", () => {
  it("is off and silent without the flag, and perfTime still returns the block's value", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = await load(null);
    expect(trace.PERF_TRACE).toBe(false);
    trace.perfEdit();
    trace.perfLog("stage");
    trace.perfReactCommit("app", "update", 500);
    expect(trace.perfTime("block", () => 42)).toBe(42);
    expect(log).not.toHaveBeenCalled();
  });

  it('treats any value other than "1" as off', async () => {
    const trace = await load("true");
    expect(trace.PERF_TRACE).toBe(false);
  });

  it("prints [perf] lines when on, and skips React commits under 4 ms", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = await load("1");
    log.mockClear(); // the "trace on" banner printed at import
    expect(trace.perfTime("block", () => "x")).toBe("x");
    trace.perfReactCommit("app", "update", 1);
    trace.perfReactCommit("app", "update", 12);
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.startsWith("[perf] "))).toBe(true);
    expect(lines[1]).toContain("react update (app)");
  });

  it("logs the first token event once, and ignores a model without the event", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const trace = await load("1");
    log.mockClear();
    let fire: () => void = () => {};
    const dispose = vi.fn();
    const model = {
      onDidChangeTokens(listener: () => void) {
        fire = listener;
        return { dispose };
      },
    };
    trace.perfFirstTokens(model, "open", performance.now());
    fire();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("open tokens computed");
    // A plain object has no token event, so the guard skips it without throwing.
    expect(() => trace.perfFirstTokens({}, "none", 0)).not.toThrow();
  });
});
