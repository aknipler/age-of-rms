// The liveness pass's timing (src/editor/livenessPass.ts), driven with
// Vitest's fake timers so no worker and no real waiting are involved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLivenessScheduler } from "../livenessPass";
import { LIVENESS_IDLE_MS } from "../parseResponses";

function setup() {
  const posted: string[] = [];
  const ran: string[] = [];
  const scheduler = createLivenessScheduler<
    string,
    string,
    ReturnType<typeof setTimeout>
  >({
    delayMs: LIVENESS_IDLE_MS,
    schedule: (fn, ms) => setTimeout(fn, ms),
    cancel: (handle) => clearTimeout(handle),
    run: (job) => {
      ran.push(job);
      return `result of ${job}`;
    },
    post: (requestId, result) => posted.push(`${requestId}: ${result}`),
  });
  return { scheduler, posted, ran };
}

describe("createLivenessScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs a job once the worker has been idle for the wait, and not before", () => {
    const { scheduler, posted } = setup();
    scheduler.request(1, "a");
    vi.advanceTimersByTime(LIVENESS_IDLE_MS - 1);
    expect(posted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(posted).toEqual(["1: result of a"]);
  });

  it("lets a second request replace the first", () => {
    const { scheduler, posted, ran } = setup();
    scheduler.request(1, "a");
    vi.advanceTimersByTime(100);
    scheduler.request(2, "b");
    vi.advanceTimersByTime(LIVENESS_IDLE_MS);
    expect(ran).toEqual(["b"]);
    expect(posted).toEqual(["2: result of b"]);
  });

  it("drops a waiting job on cancel()", () => {
    const { scheduler, posted, ran } = setup();
    scheduler.request(1, "a");
    scheduler.cancel();
    vi.advanceTimersByTime(LIVENESS_IDLE_MS * 3);
    expect(ran).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("does not run a job that has already run again, and cancel() then does nothing", () => {
    const { scheduler, posted, ran } = setup();
    scheduler.request(1, "a");
    vi.advanceTimersByTime(LIVENESS_IDLE_MS);
    scheduler.cancel();
    vi.advanceTimersByTime(LIVENESS_IDLE_MS * 3);
    expect(ran).toEqual(["a"]);
    expect(posted).toEqual(["1: result of a"]);
  });
});
