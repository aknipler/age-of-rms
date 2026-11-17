// The timing of the worker's second pass, kept pure (no Worker, no timers of
// its own) so it can be tested with fake timers and no worker
// (docs/name-liveness-slice-b-brief.md item 4).
//
// The pass is a *debounce*: each request replaces the one waiting before it,
// and the job runs only after nothing has asked for a new one for `delayMs`.
// Unlike a UI debounce it also needs an outside `cancel()`, because a message
// reaching the worker (the next keystroke's parse) makes the waiting job stale
// before its timer fires.
//
// The timer functions arrive as parameters. In the worker they are the global
// setTimeout and clearTimeout. A test hands in Vitest's fakes, or its own
// recorders. That is *dependency injection*, the usual way to test code that
// would otherwise reach for a global clock.

export interface LivenessSchedulerDeps<Job, Result, Handle> {
  /** Starts a timer. Returns something `cancel` can stop. */
  schedule(fn: () => void, ms: number): Handle;
  cancel(handle: Handle): void;
  /** The slow part. Runs to the end once started. */
  run(job: Job): Result;
  /** Hands the result to the main thread. */
  post(requestId: number, result: Result): void;
  /** How long the worker must be idle before a job starts. */
  delayMs: number;
}

export interface LivenessScheduler<Job> {
  /** Replaces any waiting job with this one, to run after the idle wait. */
  request(requestId: number, job: Job): void;
  /** Drops a waiting job. Does nothing to one that has started or finished. */
  cancel(): void;
}

export function createLivenessScheduler<Job, Result, Handle>(
  deps: LivenessSchedulerDeps<Job, Result, Handle>,
): LivenessScheduler<Job> {
  // A pending timer, or null when nothing waits. Closure state, not a class
  // field, because nothing outside this function should be able to touch it.
  let pending: Handle | null = null;

  const cancel = (): void => {
    if (pending === null) return;
    deps.cancel(pending);
    pending = null;
  };

  return {
    request(requestId, job) {
      cancel();
      pending = deps.schedule(() => {
        // Cleared before running, so a job that has started is no longer
        // "pending" and a later cancel() leaves it alone.
        pending = null;
        deps.post(requestId, deps.run(job));
      }, deps.delayMs);
    },
    cancel,
  };
}
