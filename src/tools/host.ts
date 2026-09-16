/**
 * Run lifecycle for the Advanced Tools pane (tools-api-design.md Sec.4.1,
 * Sec.4.3, Sec.4.4, Sec.5).
 *
 * No React. The pane subscribes to state changes; this file owns the rules.
 *
 * ONE RUN AT A TIME, APP-WIDE, not per tool. A single active run means one
 * run-state here, one document snapshot for the staleness guard, and one
 * progress surface.
 *
 * The RUNNER is injected rather than hardcoded. A built-in that finishes in a
 * microtask runs in-process; the checker's Monte Carlo runs in a tool worker
 * (NOT the parser worker, a stuck tool must not stall diagnostics), where the
 * same messages arrive over `postMessage`. The host cannot tell them apart above
 * this line, which is the whole point of the contract, and it is also what makes
 * the kill paths testable: a fake runner that refuses to cancel is how Sec.9
 * item 3 exercises `killed` instead of assuming it.
 */

import {
  DEADLINES,
  type ErrorReason,
  type TextEdit,
  type ToolMessage,
  type ToolOutput,
} from "../../tools-api/index";
import { checkOutboundContextSize, validateToolMessage } from "./protocol";
import type { RegisteredTool } from "./registry";

export interface RunnerHandle {
  cancel(): void;
  /** Hard stop: `worker.terminate()` / SIGKILL. Must not throw if already dead. */
  kill(): void;
}

/**
 * One worker per run, so `kill()` needs no recovery logic and tool module state
 * cannot persist across runs. A tool wanting persistence must put it in its
 * output, not in globals. This is also what makes the run watchdog nearly free:
 * there is nothing to reconcile, so the kill IS the whole recovery.
 *
 * Takes a `RegisteredTool`, not a bare `ToolImplementation`
 * (external-tools-design.md Sec.10). A panel arm has no `run()` to call, so
 * synthesising one whose `run` throws would be a lie the type system then
 * propagates. `inProcessRunner`/`workerRunner` narrow on `kind` and throw on
 * anything but `builtin`, since neither transport ever runs a panel this way
 * (Sec.3.2: a panel does not go through `ToolHost.start()` at all).
 */
export interface ToolRunner {
  start(
    tool: RegisteredTool,
    contextJson: unknown,
    onMessage: (raw: unknown) => void,
  ): RunnerHandle;
}

export type RunPhase = "idle" | "running" | "cancelling" | "done";

export interface RunState {
  phase: RunPhase;
  toolId: string | null;
  /** The run's DOCUMENT SNAPSHOT. Every span in the output is relative to this. */
  snapshot: string;
  /**
   * The generation settings the run was actually started with, `null` for a
   * caller that doesn't supply one. Exists so the pane's settings echo can
   * describe a finished result correctly even after the user changes the live
   * generation context (docs/known-issues.md BUG-014): read this, never the
   * live context, when labelling `state.output`.
   */
  settingsSnapshot: { playerCount: number; mapSize: string } | null;
  progress: { fraction?: number; note?: string } | null;
  output: ToolOutput | null;
  edits: readonly TextEdit[] | null;
  error: { message: string; reason: ErrorReason } | null;
  /** Protocol violations, surfaced rather than swallowed. */
  log: string[];
}

// Distinct from `null` (no file open) so the FIRST call to noteOpenDocument
// never reads as a replacement. There is nothing to have replaced yet.
const UNSET = Symbol("unset");

// ---------------------------------------------------------------------------
// The panel lifecycle (land-placement-design.md Sec.3.6), a SECOND, PARALLEL
// slot alongside RunState, not a replacement for it. The reframe that makes
// this small: a panel is long-lived, but every `generate` it asks for
// (layer 1, runPreview.ts) is a one-shot, bounded computation, exactly the
// quantity DEADLINES already bounds. So nothing about the run machinery
// above changes; a panel just has its OWN, simpler state, and `isBusy()`
// grows one clause reading it.
// ---------------------------------------------------------------------------

export type PanelPhase = "unmounted" | "mounted" | "suspended";

export interface PanelState {
  phase: PanelPhase;
  toolId: string | null;
  /** The file the mounted model belongs to. Mismatch is a `documentReplaced()`, not a panel concern. */
  documentId: string | null;
  /** True when the model differs from what the fence in the document says (Sec.3.6(a), content, never a version number). */
  dirty: boolean;
}

const UNMOUNTED_PANEL: PanelState = Object.freeze({
  phase: "unmounted",
  toolId: null,
  documentId: null,
  dirty: false,
});

const IDLE: RunState = Object.freeze({
  phase: "idle",
  toolId: null,
  snapshot: "",
  settingsSnapshot: null,
  progress: null,
  output: null,
  edits: null,
  error: null,
  log: [],
});

export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

interface ActiveRun {
  handle: RunnerHandle;
  toolId: string;
  snapshot: string;
  cancelTimer: number | null;
  watchdogTimer: number | null;
  terminated: boolean;
}

export class ToolHost {
  private state: RunState = IDLE;
  private active: ActiveRun | null = null;
  private listeners = new Set<(s: RunState) => void>();
  private panel: PanelState = UNMOUNTED_PANEL;
  private panelListeners = new Set<(s: PanelState) => void>();

  constructor(
    private readonly runner: ToolRunner,
    private readonly timers: Timers = realTimers,
  ) {}

  getState(): RunState {
    return this.state;
  }

  subscribe(fn: (s: RunState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  getPanelState(): PanelState {
    return this.panel;
  }

  subscribePanel(fn: (s: PanelState) => void): () => void {
    this.panelListeners.add(fn);
    return () => this.panelListeners.delete(fn);
  }

  private setPanel(patch: Partial<PanelState>): void {
    this.panel = { ...this.panel, ...patch };
    for (const fn of this.panelListeners) fn(this.panel);
  }

  /**
   * `runPhase is running|cancelling || panelPhase === "mounted"` (Sec.3.6).
   * `start()` already throws on this, so a report tool cannot begin
   * underneath a mounted panel with no further edit, and a SUSPENDED panel
   * deliberately does NOT count: "the run slot is released… holding it
   * while the user is in another tab would block every other tool for no
   * benefit."
   */
  isBusy(): boolean {
    return (
      this.state.phase === "running" ||
      this.state.phase === "cancelling" ||
      this.panel.phase === "mounted"
    );
  }

  // -------------------------------------------------------------------
  // Panel transitions (Sec.3.6's table). Deliberately NOT wired into
  // ToolsPane.tsx yet, no panel-surface tool exists to mount one, and the
  // doc's own Sec.3.6(b) second note says the tool-switch confirm dialog
  // should stay unconditional "until a panel exists… a speculative change
  // would be a regression." This is the machinery a real panel tool calls
  // when it does.
  // -------------------------------------------------------------------

  /**
   * "select this tool": reject if `isBusy()`, else mount. Returns false
   * rather than throwing, a UI wants to show an inline message, not crash.
   */
  mountPanel(toolId: string, documentId: string | null): boolean {
    if (this.isBusy()) return false;
    this.setPanel({ phase: "mounted", toolId, documentId, dirty: false });
    return true;
  }

  /** "select another tool" (after a dirty-confirm the CALLER runs) / any unconditional teardown. */
  unmountPanel(): void {
    this.panel = UNMOUNTED_PANEL;
    for (const fn of this.panelListeners) fn(this.panel);
  }

  /**
   * "Advanced Tools tab left": mounted -> suspended. The model is retained
   * (Sec.3.6(b), a lifted model, not a discarded one); the run slot is
   * released because `isBusy()` only reads "mounted".
   */
  suspendPanel(): void {
    if (this.panel.phase !== "mounted") return;
    this.setPanel({ phase: "suspended" });
  }

  /** Re-entering the tab: suspended -> mounted. The caller re-requests one generation. */
  resumePanel(): void {
    if (this.panel.phase !== "suspended") return;
    this.setPanel({ phase: "mounted" });
  }

  /**
   * The panel's own React state calls this to keep `PanelState.dirty` in
   * sync, a CONTENT check against the fence (Sec.3.6(a)), never a version
   * comparison, and never computed here: this module has no fence parser.
   */
  setPanelDirty(dirty: boolean): void {
    if (this.panel.phase === "unmounted" || this.panel.dirty === dirty) return;
    this.setPanel({ dirty });
  }

  /**
   * `snapshot` is the exact text the context was built from. Sec.4.3 pins that
   * `ctx.source` and `ctx.parseResult.source` are the same string, always, and
   * that "the run's document snapshot" means this one, including for every
   * `codeRef` span the tool emits.
   *
   * `runner` picks the TRANSPORT for this one run, the in-process default
   * from the constructor, or a worker-backed `ToolRunner` for a tool the
   * caller knows needs one (`WORKER_RUNTIME_TOOL_IDS`, `registry.ts`).
   * Deliberately a per-call argument rather than a constructor-level runner
   * RESOLVER (consistency-checker-design.md Sec.4.3 offers both and calls
   * them equivalent): this keeps `ToolHost` a single shared instance with an
   * unchanged constructor, so "one run at a time, app-wide" stays true
   * without touching `ToolsPane.tsx`'s `host` `useMemo` or its dependency
   * array, the invariant a per-tool host would silently break (two live
   * runs, neither host able to see the other).
   *
   * `settingsSnapshot` is the generation settings this run was started at,
   * for `state.settingsSnapshot` (BUG-014), optional so a caller that has no
   * settings to snapshot (most tests) doesn't need to supply one.
   *
   * `scriptName` names the open script in the error message if the outbound
   * context is over `LIMITS.maxOutboundRunBytes` (Sec.4.2 rule 2), optional
   * so a caller with no file identity to hand (most tests) doesn't need one;
   * the message falls back to a generic label.
   */
  start(
    tool: RegisteredTool,
    contextJson: unknown,
    snapshot: string,
    runner: ToolRunner = this.runner,
    settingsSnapshot: { playerCount: number; mapSize: string } | null = null,
    scriptName: string | null = null,
  ): void {
    if (this.isBusy())
      throw new Error(
        "A tool run is already active; cancel it first (one run at a time, app-wide).",
      );

    this.state = {
      ...IDLE,
      phase: "running",
      toolId: tool.manifest.id,
      snapshot,
      settingsSnapshot,
    };
    for (const fn of this.listeners) fn(this.state);

    // Sec.4.2 rule 2: an oversized outbound context is a host-side error
    // naming the script, never a silent truncation. Checked before either
    // runner sees the context, so an in-process built-in and a worker-backed
    // tool fail identically.
    const sizeProblem = checkOutboundContextSize(contextJson);
    if (sizeProblem) {
      const label = scriptName ?? "the open script";
      this.set({
        phase: "done",
        error: {
          message: `Cannot run this tool on ${label}: ${sizeProblem}.`,
          reason: "host-error",
        },
      });
      return;
    }

    let handle: RunnerHandle;
    try {
      // A synchronous throw from `run` is caught here and synthesized into an
      // `error` terminal, same as a crash, a tool that dies on its first line
      // must not look different from one that dies later.
      handle = runner.start(tool, contextJson, (raw) =>
        this.onMessage(handle, raw),
      );
    } catch (e) {
      this.set({
        phase: "done",
        error: { message: String(e), reason: "tool-error" },
      });
      return;
    }

    this.active = {
      handle,
      toolId: tool.manifest.id,
      snapshot,
      cancelTimer: null,
      watchdogTimer: null,
      terminated: false,
    };
    this.armWatchdog();
  }

  /**
   * The run watchdog detects SILENCE, not non-termination. Do not read a
   * liveness guarantee into it. A tool that chunks and emits progress forever
   * runs forever and holds the run slot, which is the right trade: a legitimate
   * checker run is 8-30 minutes and no wall-clock ceiling can tell that from a
   * hang. What this catches is a tool that violated the chunking rule, and the
   * watchdog is that rule's only enforcement.
   */
  private armWatchdog(): void {
    const run = this.active;
    if (!run) return;
    if (run.watchdogTimer !== null) this.timers.clearTimeout(run.watchdogTimer);
    run.watchdogTimer = this.timers.setTimeout(() => {
      this.terminate("The tool stopped responding.", "unresponsive");
    }, DEADLINES.runWatchdogMs);
  }

  /**
   * Cancel is a MESSAGE, not a flag the host can set in the tool's memory. A
   * tool in a tight synchronous loop never services its event loop, so a posted
   * cancel would never arrive. That is why tools must chunk, and why this arms a
   * grace timer rather than trusting the request.
   */
  cancel(): void {
    const run = this.active;
    if (!run || this.state.phase !== "running") return;

    this.set({ phase: "cancelling" });
    run.handle.cancel();

    // The watchdog's silence deadline was armed at start() (or last message)
    // and knows nothing about the cancel request. Now that `cancelGraceMs`
    // equals `runWatchdogMs` (tools-api-design.md Sec.4.1, amended for
    // Sec.7.2 item 4c), a tool that has been silent since start and then
    // ignores cancel would otherwise race the two timers. Both deadlines
    // land at the same instant, and the watchdog (armed first, in start())
    // wins, reporting `unresponsive` for a tool that specifically ignored a
    // cancel it should have been recorded as `killed` for. The cancel grace
    // below is the more specific deadline from here on; clear the watchdog so
    // only it can terminate this run. `onMessage` still re-arms a fresh
    // watchdog if the tool proves life with any further message.
    if (run.watchdogTimer !== null) {
      this.timers.clearTimeout(run.watchdogTimer);
      run.watchdogTimer = null;
    }

    run.cancelTimer = this.timers.setTimeout(() => {
      // Grace expired. The two terminals are DISTINCT on purpose: collapsing
      // them throws away the only signal that a tool is misbehaving, so the user
      // cannot tell whether their Cancel worked or the host had to SIGKILL.
      this.terminate(
        "The tool did not stop when asked and was killed.",
        "killed",
      );
    }, DEADLINES.cancelGraceMs);
  }

  private terminate(message: string, reason: ErrorReason): void {
    const run = this.active;
    if (!run || run.terminated) return;
    run.terminated = true;
    this.clearTimers(run);
    try {
      run.handle.kill();
    } catch {
      // One worker per run: there is nothing to recover, so a kill that throws
      // because the thing is already dead is not an error worth surfacing.
    }
    this.active = null;
    this.set({ phase: "done", progress: null, error: { message, reason } });
  }

  private clearTimers(run: ActiveRun): void {
    if (run.cancelTimer !== null) this.timers.clearTimeout(run.cancelTimer);
    if (run.watchdogTimer !== null) this.timers.clearTimeout(run.watchdogTimer);
    run.cancelTimer = null;
    run.watchdogTimer = null;
  }

  private onMessage(handle: RunnerHandle, raw: unknown): void {
    const run = this.active;

    // Sec.4.4, closed host-side by HANDLE IDENTITY rather than by a wire field.
    // A cancelled run never sends a terminal and has up to the full grace to
    // keep talking; for an external tool a SIGKILLed process can be flushing
    // stdout for that whole window. Without this, run A's late `partial`
    // replaces run B's output, because `partial` is a full redraw.
    //
    // Deliberately NOT a `runId` on the wire: that makes correctness depend on
    // every external author echoing a field, and a tool that echoes it wrong has
    // ALL its output silently dropped, a new failure mode, in the direction
    // Sec.4.2 establishes we cannot trust.
    if (!run || run.handle !== handle || run.terminated) return;

    const checked = validateToolMessage(raw);
    if (!checked.ok) {
      this.set({
        log: [...this.state.log, `Protocol error: ${checked.problem}`],
      });
      this.finish(run, {
        message: `The tool sent something this host could not read: ${checked.problem}`,
        reason: "protocol",
      });
      return;
    }

    const msg: ToolMessage = checked.message;

    // Any message at all is proof of life, so the watchdog re-arms on every
    // one, which is why a run intending to exceed one chunk MUST emit per
    // chunk boundary, and why that costs a chunked tool nothing.
    this.armWatchdog();

    switch (msg.type) {
      case "progress":
        this.set({ progress: { fraction: msg.fraction, note: msg.note } });
        break;
      case "partial":
        // A full self-contained output, never a delta, so an idempotent redraw.
        this.set({ output: msg.output });
        break;
      case "result": {
        // Capability enforcement runs on BOTH directions of the contract: edits
        // from a tool that never declared `edit-source` are dropped with a
        // visible warning, never applied.
        const mayEdit = this.currentToolMayEdit();
        const dropped = msg.edits !== undefined && !mayEdit;
        this.set({
          output: msg.output,
          edits: dropped ? null : (msg.edits ?? null),
          log: dropped
            ? [
                ...this.state.log,
                "This tool proposed edits without declaring edit-source; they were dropped.",
              ]
            : this.state.log,
        });
        this.finish(run, null);
        break;
      }
      case "error":
        this.finish(run, { message: msg.message, reason: msg.reason });
        break;
    }
  }

  private editCapableToolIds = new Set<string>();

  /** Told at start-up which tools declared `edit-source`; see `registerEditCapable`. */
  registerEditCapable(ids: readonly string[]): void {
    this.editCapableToolIds = new Set(ids);
  }

  private currentToolMayEdit(): boolean {
    return (
      this.state.toolId !== null &&
      this.editCapableToolIds.has(this.state.toolId)
    );
  }

  private finish(
    run: ActiveRun,
    error: { message: string; reason: ErrorReason } | null,
  ): void {
    run.terminated = true;
    this.clearTimers(run);
    this.active = null;
    this.set({ phase: "done", progress: null, error });
  }

  /**
   * Cancel because the open document was REPLACED (File > Open / New).
   *
   * `useDocument` holds one module-level Monaco model for the app's whole
   * lifetime and File > Open calls `setValue` on it rather than creating a new
   * one, so "the document" can become an entirely different script mid-run.
   * Without this the run keeps burning CPU against a closed script, and its
   * `codeRef` jumps still fire with the soft "the code changed" notice, which
   * badly understates "you are looking at a different file".
   */
  documentReplaced(): void {
    // Sec.3.6(c): unconditional unmount, dirty or not, "the file is already
    // gone by then and a prompt that cannot undo anything is noise." Done
    // FIRST, so the isBusy() check right below sees the panel's own
    // contribution already cleared rather than short-circuiting the run
    // teardown for a document that no longer has a mounted panel anyway.
    this.unmountPanel();
    if (!this.isBusy()) {
      this.reset();
      return;
    }
    this.terminate(
      "The open document was replaced while this tool was running.",
      "cancelled",
    );
    this.reset();
  }

  private lastDocumentId: string | null | typeof UNSET = UNSET;

  /**
   * Call on every render with the app's current file identity (`filePath`,
   * `null` for no file open) and let the host decide whether that is a
   * replacement. Centralising the comparison here, rather than leaving each
   * caller to diff two renders itself, is what makes it correct at every
   * transition, including one open file replaced by a DIFFERENT one:
   *
   * A `hasFile: boolean` derived from `filePath !== null` stays `true` across
   * exactly that transition (`useDocument.openFile` calls
   * `documentModel.setValue()` then `setFilePath` without ever passing through
   * `null`), so a caller diffing a boolean misses it, which happened here
   * once, caught only by re-reading `useDocument.ts` rather than by any test.
   */
  noteOpenDocument(id: string | null): void {
    if (this.lastDocumentId === id) return;
    const first = this.lastDocumentId === UNSET;
    this.lastDocumentId = id;
    if (!first) this.documentReplaced();
  }

  /**
   * Terminates an active run rather than merely forgetting it
   * (consistency-checker-design.md Sec.4.3, Sec.7.2 item 1). Before this fix,
   * `reset()` cleared `state` but left `this.active` and BOTH its timers
   * armed: `ToolsPane.selectTool` calls `cancel()` then `reset()`, and
   * `cancel()` only ARMS the grace timer rather than resolving it, so a
   * second `start()` was accepted and overwrote `this.active`, and when the
   * FIRST run's now-orphaned grace timer fired, `terminate()` read
   * `this.active`, found the SECOND run, and killed and blamed it with
   * `reason: "unresponsive"`. The innocent tool was blamed in the one field
   * `tools-api/index.ts` says is a verdict on the tool, and the first run's
   * worker leaked (never killed). Unreachable until a worker-backed runner
   * could still be alive at a tool switch, `inProcessRunner` finishes
   * synchronously inside `start()`, so today's built-ins never trip it.
   */
  reset(): void {
    if (this.active) {
      const run = this.active;
      this.clearTimers(run);
      run.terminated = true;
      try {
        run.handle.kill();
      } catch {
        // One worker per run: there is nothing to recover, so a kill that
        // throws because the thing is already dead is not worth surfacing.
      }
      this.active = null;
    }
    this.state = IDLE;
    for (const fn of this.listeners) fn(this.state);
  }

  /**
   * Sec.4.3 pin 2: Apply re-checks the SAME string equality Run was gated on,
   * never a bare version comparison. The corruption path this exists for is a
   * stale PARSE, not a stale model: the worker's parse lags the model by design,
   * so a tool can compute offsets against text that is not in the editor while a
   * version check passes. Same-version garbage, silently.
   *
   * Never rebase tool edits. Re-run. (`rebaseEdit` in breakdown/ephemeralAnchors
   * exists for Breakdown's in-flight anchors and is NOT for this.)
   */
  canApply(currentText: string): boolean {
    return (
      this.state.edits !== null &&
      this.state.edits.length > 0 &&
      currentText === this.state.snapshot
    );
  }
}

/** In-process runner for built-ins that finish inside one chunk. */
export const inProcessRunner: ToolRunner = {
  start(tool, contextJson, onMessage) {
    // Arm narrowing (external-tools-design.md Sec.10): this transport only
    // ever runs a `builtin`, a `panel` never reaches `ToolHost.start()` at
    // all (Sec.3.2), so landing here with one is a caller bug, not a
    // recoverable case, and it must THROW rather than silently no-op.
    if (tool.kind !== "builtin") {
      throw new Error(
        `inProcessRunner: cannot run a "${tool.kind}" tool ("${tool.manifest.id}") — only "builtin" has a run()`,
      );
    }
    let dead = false;
    const handle = tool.impl.run(contextJson as never, (msg) => {
      if (!dead) onMessage(msg);
    });
    return {
      cancel: () => handle.cancel(),
      kill: () => {
        // An in-process tool cannot actually be pre-empted, which is exactly
        // why heavy work belongs in a worker. Muting it is the honest best
        // effort, and the host has already stopped listening by this point.
        dead = true;
        handle.cancel();
      },
    };
  },
};
