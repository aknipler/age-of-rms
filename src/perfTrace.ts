// Opt-in latency trace for docs/diagnostics-latency-report.md. Off unless the
// dev tools console has run
//
//   localStorage.setItem("aorms.perfTrace", "1"); location.reload();
//
// and back off with `localStorage.removeItem("aorms.perfTrace")`. Every
// function here returns at once when the flag is off, so leaving the calls in
// costs one boolean check per call site.
//
// Why a runtime flag and not `import.meta.env.DEV`. The numbers worth having
// come from the real Tauri host, and a flag read at startup lets the same
// build be timed with and without tracing, which is how to check that the
// trace itself is not what got slow. The flag is read ONCE at module load
// (a plain `const`, not React state) because nothing should re-render when it
// changes. A reload is the switch.
//
// Every line it prints starts with "[perf]" so the console filter box can
// isolate them.

function readFlag(): boolean {
  // localStorage can throw (a locked down WebView, a worker scope), so the
  // read is guarded and a failure means "off".
  try {
    return globalThis.localStorage?.getItem("aorms.perfTrace") === "1";
  } catch {
    return false;
  }
}

export const PERF_TRACE = readFlag();

// Module state, not React state, for the same reason as the flag. These are
// timestamps from performance.now(), all on the main thread's clock.
let lastEditAt = 0;
let lastOpenAt = 0;

const ms = (x: number) => `${x.toFixed(1)} ms`;

/** A keystroke or any other model edit. Recorded, never printed, since it fires per key. */
export function perfEdit(): void {
  if (!PERF_TRACE) return;
  lastEditAt = performance.now();
}

/** A file open (useDocument's setValue). Starts the "first highlighted tokens" clock. */
export function perfFileOpen(chars: number): void {
  if (!PERF_TRACE) return;
  lastOpenAt = performance.now();
  lastEditAt = lastOpenAt;
  console.log(`[perf] file opened, ${chars} chars`);
}

/** Prints one stage, stamped with the time since the last edit. */
export function perfLog(stage: string, detail = ""): void {
  if (!PERF_TRACE) return;
  const since = performance.now() - lastEditAt;
  console.log(
    `[perf] ${stage} | +${ms(since)} after last edit${detail ? ` | ${detail}` : ""}`,
  );
}

/** Same, stamped with the time since the last file open. */
export function perfLogSinceOpen(stage: string, detail = ""): void {
  if (!PERF_TRACE) return;
  const since = performance.now() - lastOpenAt;
  console.log(
    `[perf] ${stage} | +${ms(since)} after file open${detail ? ` | ${detail}` : ""}`,
  );
}

/**
 * Logs once the browser has painted what the current task changed. A
 * requestAnimationFrame callback runs just BEFORE the next paint, so the
 * setTimeout inside it lands just after. That pairing is the usual
 * approximation of "on screen now" without a paint timing API.
 */
export function perfAfterPaint(stage: string, sinceOpen = false): void {
  if (!PERF_TRACE) return;
  requestAnimationFrame(() =>
    setTimeout(() => (sinceOpen ? perfLogSinceOpen(stage) : perfLog(stage)), 0),
  );
}

/**
 * The one part of a Monaco text model this file needs. Monaco's models have
 * this event at runtime (textModel.js), but monaco-editor's public .d.ts does
 * not declare it, so an ITextModel does not typecheck as one. The caller
 * passes the model as `object` and `hasTokenEvent` narrows it at runtime,
 * a *type guard*. If a later Monaco drops the internal event, the guard
 * fails and the trace just skips this stage instead of throwing.
 */
interface TokenEventSource {
  onDidChangeTokens(listener: () => void): { dispose(): void };
}

function hasTokenEvent(model: object): model is TokenEventSource {
  return (
    typeof (model as Partial<TokenEventSource>).onDidChangeTokens === "function"
  );
}

/**
 * Logs the first token event after `startedAt`, which is when the visible
 * lines get their colours. Monaco only tokenizes a model that an editor is
 * showing, so after a file open with the Breakdown tab in front this waits
 * until the Code tab mounts. A model that already holds tokens (a return
 * visit to the Code tab) fires nothing until the next edit, so an event more
 * than 5 s late is ignored rather than reported as a slow first paint.
 */
export function perfFirstTokens(
  model: object,
  stage: string,
  startedAt: number,
): void {
  if (!PERF_TRACE || !hasTokenEvent(model)) return;
  const once = model.onDidChangeTokens(() => {
    once.dispose();
    const after = performance.now() - startedAt;
    if (after > 5000) return;
    console.log(`[perf] ${stage} tokens computed | +${ms(after)}`);
    requestAnimationFrame(() =>
      setTimeout(
        () =>
          console.log(
            `[perf] ${stage} tokens painted | +${ms(performance.now() - startedAt)}`,
          ),
        0,
      ),
    );
  });
}

/**
 * Times a synchronous block and logs it. Returns the block's own result, so a
 * call site wraps an expression without restructuring around it.
 */
export function perfTime<T>(stage: string, block: () => T): T {
  if (!PERF_TRACE) return block();
  const start = performance.now();
  const result = block();
  perfLog(stage, ms(performance.now() - start));
  return result;
}

/**
 * React's <Profiler> callback (main.tsx). actualDuration is the time React
 * spent rendering the committed tree, the number that turns into typing lag
 * when it runs on every keystroke. Commits under 4 ms are not printed, so a
 * trace stays readable while typing.
 */
export function perfReactCommit(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
): void {
  if (!PERF_TRACE || actualDuration < 4) return;
  perfLog(`react ${phase} (${id})`, ms(actualDuration));
}

// A long task is any main thread task over 50 ms, the point at which a
// keystroke visibly waits. WebView2 (Chromium) reports them, so the trace can
// say which stage blocked typing rather than leaving it to inference.
if (PERF_TRACE && typeof PerformanceObserver !== "undefined") {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        perfLog("LONG TASK on main thread", ms(entry.duration));
      }
    }).observe({ type: "longtask", buffered: false });
  } catch {
    // Not supported in this host. The other stages still log.
  }
  console.log(
    '[perf] trace on. Turn off with localStorage.removeItem("aorms.perfTrace") and a reload',
  );
}
