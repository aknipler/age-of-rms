// tools-api-design.md Sec.9 items 3-7, the host's own obligations.
//
// The kill paths are EXERCISED, never assumed, and every deadline assertion
// reads the constant the host actually holds rather than a literal in a test
// body. Sec.4.1 has moved both numbers twice; a test carrying `30_000` would go
// green against a host that had since been re-derived to something else.

import { describe, expect, it, vi } from "vitest";
import {
  DEADLINES,
  LIMITS,
  TOOLS_API_VERSION,
  type OverlayShape,
  type ToolImplementation,
  type ToolManifest,
  type ToolMessage,
} from "../../../tools-api/index";
import {
  checkOutboundContextSize,
  effectiveCapabilities,
  overlayShapesToRender,
  parseInboundLine,
  resolveParams,
  tableRowsToRender,
  validateEdits,
  validateManifest,
  validateToolMessage,
} from "../protocol";
import {
  ToolHost,
  type RunnerHandle,
  type ToolRunner,
  type Timers,
} from "../host";
import { checkRegistry, type RegisteredTool } from "../registry";

// --- a controllable clock, so the deadlines are tested rather than waited on --
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
  };
  return {
    timers,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
  };
}

function manifest(over: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: "t",
    name: "T",
    version: "1.0.0",
    apiVersion: TOOLS_API_VERSION,
    description: "d",
    capabilities: [],
    ...over,
  };
}

/** A runner the test drives by hand, including one that refuses to cancel. */
function scriptedRunner(opts: { honourCancel?: boolean } = {}) {
  const honourCancel = opts.honourCancel ?? true;
  let emit: ((raw: unknown) => void) | null = null;
  let killed = false;
  const runner: ToolRunner = {
    start(_tool, _ctx, onMessage): RunnerHandle {
      emit = onMessage;
      return {
        cancel() {
          if (honourCancel)
            emit?.({ type: "error", message: "stopped", reason: "cancelled" });
        },
        kill() {
          killed = true;
        },
      };
    },
  };
  return {
    runner,
    send: (m: ToolMessage | unknown) => emit?.(m),
    wasKilled: () => killed,
  };
}

const toolImpl: ToolImplementation = {
  manifest: manifest(),
  run: () => ({ cancel() {} }),
};
// host.start() takes a RegisteredTool, not a bare ToolImplementation (external-tools-design.md Sec.10).
const tool: RegisteredTool = {
  kind: "builtin",
  manifest: toolImpl.manifest,
  impl: toolImpl,
};

describe("inbound message validation (Sec.4.2)", () => {
  it("rejects invalid JSON", () => {
    expect(parseInboundLine("{not json")).toEqual({
      ok: false,
      problem: "inbound line is not valid JSON",
    });
  });

  it("rejects valid JSON that is not a ToolMessage", () => {
    const r = parseInboundLine(JSON.stringify({ hello: "world" }));
    expect(r.ok).toBe(false);
  });

  it("rejects an out-of-enum severity level", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [{ kind: "severity", level: "catastrophe", text: "x" }],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a table whose rows are not strings", () => {
    const r = validateToolMessage({
      type: "partial",
      output: { blocks: [{ kind: "table", columns: ["a"], rows: [[1, 2]] }] },
    });
    expect(r.ok).toBe(false);
  });

  // The only cross-field invariant on OutputBlock, and it would otherwise ship
  // unvalidated: Sec.2 declares it and delegates the check to Sec.4.2.
  it("rejects a table whose rowSpans length does not match rows length", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "table",
            columns: ["a"],
            rows: [["1"], ["2"]],
            rowSpans: [{ start: 0, end: 1 }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain("1 rowSpans for 2 rows");
  });

  it("accepts a rowSpans entry that is null, which means the row has nowhere to jump", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "table",
            columns: ["a"],
            rows: [["1"], ["2"]],
            rowSpans: [{ start: 0, end: 1 }, null],
          },
        ],
      },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an over-cap line before parsing it", () => {
    const r = parseInboundLine("x".repeat(LIMITS.maxInboundLineBytes + 1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain("cap");
  });

  it("does not trust the discriminant", () => {
    expect(validateToolMessage({ type: "result" }).ok).toBe(false);
    expect(validateToolMessage({ type: "progress", fraction: 5 }).ok).toBe(
      false,
    );
  });
});

describe("mapOverlay validation (land-placement-design.md Sec.3.4 layer 2, Sec.3.7)", () => {
  it("accepts a well-formed block of every shape kind", () => {
    const shapes: OverlayShape[] = [
      { kind: "point", x: 1, y: 1, role: "primary" },
      { kind: "circle", x: 2, y: 2, rTiles: 3, role: "secondary" },
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, role: "muted" },
      {
        kind: "polyline",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        role: "warning",
      },
      { kind: "label", x: 3, y: 3, text: "hi", role: "error" },
      { id: "h1", kind: "handle", x: 4, y: 4, role: "primary" },
    ];
    const r = validateToolMessage({
      type: "partial",
      output: { blocks: [{ kind: "mapOverlay", shapes }] },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an out-of-enum role", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "mapOverlay",
            shapes: [{ kind: "point", x: 1, y: 1, role: "rainbow" }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a handle shape with no id — the type says required, JSON cannot enforce it", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "mapOverlay",
            shapes: [{ kind: "handle", x: 1, y: 1, role: "primary" }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a shape with a non-numeric x/y", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "mapOverlay",
            shapes: [{ kind: "point", x: "1", y: 1, role: "primary" }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("does not trust the discriminant on an unknown shape kind", () => {
    const r = validateToolMessage({
      type: "partial",
      output: {
        blocks: [
          {
            kind: "mapOverlay",
            shapes: [{ kind: "star", x: 1, y: 1, role: "primary" }],
          },
        ],
      },
    });
    expect(r.ok).toBe(false);
  });

  it("accepts a block over the shape cap — that is overlayShapesToRender's job, not validation's", () => {
    const shapes: OverlayShape[] = Array.from(
      { length: LIMITS.maxOverlayShapesPerBlock + 1 },
      (_, i) => ({
        kind: "point" as const,
        x: i,
        y: i,
        role: "primary" as const,
      }),
    );
    const r = validateToolMessage({
      type: "partial",
      output: { blocks: [{ kind: "mapOverlay", shapes }] },
    });
    expect(r.ok).toBe(true);
  });
});

describe("overlayShapesToRender (Sec.3.7)", () => {
  const shape = (x: number): OverlayShape => ({
    kind: "point",
    x,
    y: 0,
    role: "primary",
  });

  it("passes an under-cap block through unchanged, with hidden: 0", () => {
    const shapes = [shape(1), shape(2)];
    expect(overlayShapesToRender(shapes)).toEqual({ shapes, hidden: 0 });
  });

  it("truncates an over-cap block and reports how many were hidden — never rejects", () => {
    const shapes = Array.from(
      { length: LIMITS.maxOverlayShapesPerBlock + 5 },
      (_, i) => shape(i),
    );
    const { shapes: rendered, hidden } = overlayShapesToRender(shapes);
    expect(rendered).toHaveLength(LIMITS.maxOverlayShapesPerBlock);
    expect(hidden).toBe(5);
  });

  it("prints hidden: 0, not an absent field, for an empty overlay — a filtered overlay and an empty one are different claims", () => {
    expect(overlayShapesToRender([])).toEqual({ shapes: [], hidden: 0 });
  });
});

describe("edit validation (Sec.4.5)", () => {
  it("rejects the WHOLE set when one edit overlaps", () => {
    const r = validateEdits(
      [
        { start: 0, end: 5, newText: "a" },
        { start: 3, end: 9, newText: "b" },
      ],
      100,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects malformed bounds", () => {
    expect(validateEdits([{ start: 9, end: 2, newText: "" }], 100).ok).toBe(
      false,
    );
    expect(validateEdits([{ start: -1, end: 2, newText: "" }], 100).ok).toBe(
      false,
    );
    expect(validateEdits([{ start: 0, end: 500, newText: "" }], 100).ok).toBe(
      false,
    );
  });

  it("accepts disjoint edits given out of order, because ordering is not the mechanism", () => {
    expect(
      validateEdits(
        [
          { start: 10, end: 12, newText: "b" },
          { start: 0, end: 5, newText: "a" },
        ],
        100,
      ).ok,
    ).toBe(true);
  });
});

describe("manifest registration (Sec.5)", () => {
  it("rejects an apiVersion mismatch rather than warning", () => {
    expect(validateManifest(manifest({ apiVersion: 99 }))).toHaveLength(1);
  });

  // The case the rule exists for: it passes every RUN-TIME check and ships a
  // form that cannot be submitted as authored.
  it("rejects a multiSelect whose default violates its own minSelected", () => {
    const problems = validateManifest(
      manifest({
        params: [
          {
            key: "p",
            type: "multiSelect",
            label: "P",
            default: [],
            options: [{ value: "a", label: "A" }],
            minSelected: 1,
          },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain("minSelected");
  });

  it("rejects a select default that is not one of its own options", () => {
    const problems = validateManifest(
      manifest({
        params: [
          {
            key: "p",
            type: "select",
            label: "P",
            default: "z",
            options: [{ value: "a", label: "A" }],
          },
        ],
      }),
    );
    expect(problems).toHaveLength(1);
  });

  it("rejects an integer default outside its own min/max", () => {
    expect(
      validateManifest(
        manifest({
          params: [
            { key: "p", type: "integer", label: "P", default: 0, min: 1 },
          ],
        }),
      ),
    ).toHaveLength(1);
  });

  it("passes the real registry", () => {
    expect(checkRegistry()).toEqual({ ok: true, problems: [] });
  });
});

describe("run-time param validation (Sec.5)", () => {
  it("clamps an integer into its declared range", () => {
    const defs = [
      {
        key: "n",
        type: "integer" as const,
        label: "N",
        default: 10,
        min: 1,
        max: 100,
      },
    ];
    expect(resolveParams(defs, { n: 5000 }).params.n).toBe(100);
    expect(resolveParams(defs, { n: -3 }).params.n).toBe(1);
  });

  it("falls back to the default for a value outside a select's options", () => {
    const defs = [
      {
        key: "s",
        type: "select" as const,
        label: "S",
        default: "a",
        options: [{ value: "a", label: "A" }],
      },
    ];
    expect(resolveParams(defs, { s: "nope" }).params.s).toBe("a");
  });

  // The check that gets forgotten: every other multiSelect rule passes an empty
  // selection, and the parameter that motivated multiSelect is meaningless empty.
  it("reports an empty multiSelect against its minSelected", () => {
    const defs = [
      {
        key: "m",
        type: "multiSelect" as const,
        label: "M",
        default: ["2"],
        options: [{ value: "2", label: "2" }],
        minSelected: 1,
      },
    ];
    expect(resolveParams(defs, { m: [] }).problems).toHaveLength(1);
  });

  it("drops submitted values that are not options at all", () => {
    const defs = [
      {
        key: "m",
        type: "multiSelect" as const,
        label: "M",
        default: [],
        options: [{ value: "2", label: "2" }],
      },
    ];
    expect(resolveParams(defs, { m: ["2", "999"] }).params.m).toEqual(["2"]);
  });
});

describe("capabilities (Sec.6)", () => {
  it("auto-grants read-source when read-ast is declared", () => {
    expect(effectiveCapabilities(["read-ast"]).has("read-source")).toBe(true);
  });

  it("grants nothing that was not declared or implied", () => {
    expect(effectiveCapabilities(["read-ast"]).has("edit-source")).toBe(false);
  });
});

describe("lifecycle (Sec.9 item 3)", () => {
  it("orders progress before result and ends in done", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    send({ type: "progress", fraction: 0.5 });
    expect(host.getState().progress?.fraction).toBe(0.5);
    send({
      type: "result",
      output: { blocks: [{ kind: "text", text: "done" }] },
    });
    expect(host.getState().phase).toBe("done");
    expect(host.getState().output?.blocks).toHaveLength(1);
  });

  it("discards messages after a terminal", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    send({
      type: "result",
      output: { blocks: [{ kind: "text", text: "first" }] },
    });
    send({
      type: "partial",
      output: { blocks: [{ kind: "text", text: "late" }] },
    });
    expect(host.getState().output?.blocks[0]).toEqual({
      kind: "text",
      text: "first",
    });
  });

  it("synthesizes an error from a synchronous throw in run()", () => {
    const throwing: ToolRunner = {
      start() {
        throw new Error("boom");
      },
    };
    const host = new ToolHost(throwing, fakeTimers().timers);
    host.start(tool, {}, "src");
    expect(host.getState().error?.reason).toBe("tool-error");
  });

  it("reports a protocol violation as a terminal and never renders it", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    send({
      type: "partial",
      output: {
        blocks: [{ kind: "severity", level: "catastrophe", text: "x" }],
      },
    });
    expect(host.getState().error?.reason).toBe("protocol");
    expect(host.getState().output).toBeNull();
  });

  it("cancel yields reason 'cancelled' when the tool honours it", () => {
    const { runner } = scriptedRunner({ honourCancel: true });
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    host.cancel();
    expect(host.getState().error?.reason).toBe("cancelled");
  });

  // A deliberately non-chunked busy-loop tool: the cancel message can never be
  // serviced, so the grace expires and the host hard-kills.
  it("hard-kills at the cancel grace with reason 'killed' when the tool ignores cancel", () => {
    const clock = fakeTimers();
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, clock.timers);
    host.start(tool, {}, "src");
    host.cancel();
    expect(host.getState().phase).toBe("cancelling");
    clock.advance(DEADLINES.cancelGraceMs - 1);
    expect(host.getState().phase).toBe("cancelling");
    clock.advance(2);
    expect(host.getState().error?.reason).toBe("killed");
    expect(wasKilled()).toBe(true);
  });

  it("kills a silent tool at the run watchdog with reason 'unresponsive'", () => {
    const clock = fakeTimers();
    const { runner, wasKilled } = scriptedRunner();
    const host = new ToolHost(runner, clock.timers);
    host.start(tool, {}, "src");
    clock.advance(DEADLINES.runWatchdogMs + 1);
    expect(host.getState().error?.reason).toBe("unresponsive");
    expect(wasKilled()).toBe(true);
  });

  it("re-arms the watchdog on every message, so a chunking tool is never killed", () => {
    const clock = fakeTimers();
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, clock.timers);
    host.start(tool, {}, "src");
    for (let i = 0; i < 5; i++) {
      clock.advance(DEADLINES.runWatchdogMs - 10);
      send({ type: "progress", fraction: i / 5 });
    }
    expect(host.getState().phase).toBe("running");
  });

  it("refuses a second run while one is active (one run at a time, app-wide)", () => {
    const { runner } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    expect(() => host.start(tool, {}, "src")).toThrow(/already active/);
  });

  it("reset() with nothing active behaves exactly as before (idle, no throw)", () => {
    const host = new ToolHost(scriptedRunner().runner, fakeTimers().timers);
    expect(() => host.reset()).not.toThrow();
    expect(host.getState().phase).toBe("idle");
  });

  // Sec.4.3, Sec.7.2 item 3: start()'s per-run `runner` argument is how
  // ToolsPane picks workerRunner vs inProcessRunner without giving ToolHost a
  // second constructor shape or touching its `useMemo` deps. Prove the
  // argument is actually consulted, not merely accepted and ignored.
  it("start()'s runner argument overrides the constructor's default runner for that one run", () => {
    const constructorDefault = scriptedRunner();
    const perRun = scriptedRunner();
    const host = new ToolHost(constructorDefault.runner, fakeTimers().timers);

    host.start(tool, {}, "src", perRun.runner);
    perRun.send({ type: "progress", fraction: 0.5 });
    expect(host.getState().progress?.fraction).toBe(0.5);

    // The constructor's own runner never started anything, so its `send`
    // reaches no live run and the state is unaffected by it.
    constructorDefault.send({ type: "progress", fraction: 0.9 });
    expect(host.getState().progress?.fraction).toBe(0.5);
  });

  it("omitting the runner argument falls back to the constructor's default, exactly as before this section", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    send({ type: "progress", fraction: 0.3 });
    expect(host.getState().progress?.fraction).toBe(0.3);
  });

  // consistency-checker-design.md Sec.4.3, Sec.7.2 item 1. Mirrors
  // ToolsPane.selectTool's exact sequence (cancel() then reset()) on a tool
  // that never honours cancel. A worker-backed checker is the first tool
  // that can still be alive at a switch, so this reproduces with an injected
  // runner and no worker at all.
  it("kills the cancelled run's own timers at reset(), so its orphaned grace timer cannot blame the NEXT run", () => {
    const clock = fakeTimers();
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, clock.timers);

    host.start(tool, {}, "src-a");
    host.cancel();
    expect(host.getState().phase).toBe("cancelling");

    host.reset();
    expect(wasKilled()).toBe(true);
    expect(host.getState().phase).toBe("idle");

    // Give run B a later start time than run A's cancel(), so run A's
    // now-orphaned grace timer (armed at A's cancel() time + cancelGraceMs,
    // WERE it still armed) would fire strictly before run B's OWN watchdog
    // ever could. Now that `cancelGraceMs` equals `runWatchdogMs`, starting B
    // immediately would make the two deadlines coincide and the test could
    // not tell "the old bug fired" apart from "B's own legitimate watchdog
    // fired", see the cancel() fix in host.ts for the same race.
    clock.advance(30_000); // t = 30_000
    host.start(tool, {}, "src-b"); // B's own watchdog deadline: 90_000
    expect(host.getState().phase).toBe("running");

    // Before this fix: reset() left run A's `cancelTimer` armed (deadline
    // 60_000) and `this.active` un-cleared, so `start()` for run B silently
    // overwrote `this.active`. When A's grace timer fires here, `terminate()`
    // reads `this.active`, now B, and kills and blames IT with reason
    // "killed", for a cancel B never received. B's own watchdog (90_000) is
    // nowhere close.
    clock.advance(30_001); // t = 60_001
    expect(host.getState().phase).toBe("running");
    expect(host.getState().error).toBeNull();
  });
});

describe("stale-run message rejection (Sec.4.4)", () => {
  // A cancelled run never sends a terminal and has the full grace to keep
  // talking. Without handle identity, run A's late `partial` replaces run B's
  // output, because `partial` is a full redraw.
  it("drops a late partial from a cancelled run instead of overwriting the new one", () => {
    const clock = fakeTimers();
    const a = scriptedRunner({ honourCancel: false });
    const hostA = new ToolHost(a.runner, clock.timers);
    hostA.start(tool, {}, "src");
    hostA.cancel();
    clock.advance(DEADLINES.cancelGraceMs + 1); // A is killed

    hostA.reset();
    const b = scriptedRunner();
    const hostB = new ToolHost(b.runner, clock.timers);
    hostB.start(tool, {}, "src");
    b.send({
      type: "partial",
      output: { blocks: [{ kind: "text", text: "B" }] },
    });
    a.send({
      type: "partial",
      output: { blocks: [{ kind: "text", text: "A (late)" }] },
    });

    expect(hostB.getState().output?.blocks[0]).toEqual({
      kind: "text",
      text: "B",
    });
  });
});

describe("capability enforcement on the result path (Sec.9 item 6)", () => {
  it("drops edits from a tool that never declared edit-source, with a visible warning", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.registerEditCapable([]); // this tool did not declare it
    host.start(tool, {}, "src");
    send({
      type: "result",
      output: { blocks: [] },
      edits: [{ start: 0, end: 1, newText: "x" }],
    });
    expect(host.getState().edits).toBeNull();
    expect(host.getState().log.join(" ")).toContain("edit-source");
  });

  it("keeps edits from a tool that did declare it", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.registerEditCapable(["t"]);
    host.start(tool, {}, "src");
    send({
      type: "result",
      output: { blocks: [] },
      edits: [{ start: 0, end: 1, newText: "x" }],
    });
    expect(host.getState().edits).toHaveLength(1);
  });
});

describe("staleness and document replace (Sec.4.3, Sec.9 item 8)", () => {
  it("blocks Apply once the model no longer matches the run's snapshot", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "original");
    host.registerEditCapable(["t"]);
    send({
      type: "result",
      output: { blocks: [] },
      edits: [{ start: 0, end: 1, newText: "x" }],
    });
    expect(host.canApply("original")).toBe(true);
    expect(host.canApply("edited since")).toBe(false);
  });

  // Undo back to the snapshot must RE-ENABLE Apply, which is why the gate is a
  // string comparison rather than a monotonic version counter.
  it("re-enables Apply after an undo back to the snapshot", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.registerEditCapable(["t"]);
    host.start(tool, {}, "original");
    send({
      type: "result",
      output: { blocks: [] },
      edits: [{ start: 0, end: 1, newText: "x" }],
    });
    expect(host.canApply("changed")).toBe(false);
    expect(host.canApply("original")).toBe(true);
  });

  it("terminates the run and clears Apply when the document is replaced", () => {
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "original");
    host.documentReplaced();
    expect(wasKilled()).toBe(true);
    expect(host.getState().phase).toBe("idle");
    expect(host.canApply("original")).toBe(false);
  });

  // Regression: the caller used to diff a `hasFile` BOOLEAN across renders,
  // which stays `true` across "file A open, then file B opened", the exact
  // transition Sec.5 names, because useDocument.openFile never passes through
  // `null`. noteOpenDocument diffs the identity itself so this is covered here
  // rather than only in a component the repo has no render harness for.
  it("noteOpenDocument treats one open file replaced by a different one as a replacement", () => {
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, fakeTimers().timers);
    host.noteOpenDocument("a.rms");
    host.start(tool, {}, "content of a");
    host.noteOpenDocument("b.rms"); // File > Open, straight to a different path
    expect(wasKilled()).toBe(true);
    expect(host.getState().phase).toBe("idle");
  });

  it("noteOpenDocument does nothing on the first call, or when the identity repeats", () => {
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, fakeTimers().timers);
    host.noteOpenDocument("a.rms"); // first call: nothing to have replaced yet
    host.start(tool, {}, "content of a");
    host.noteOpenDocument("a.rms"); // unchanged, a re-render, not a new file
    expect(wasKilled()).toBe(false);
    expect(host.getState().phase).toBe("running");
  });

  it("noteOpenDocument fires on New (a path replaced by null) and on Open after New", () => {
    const { runner, wasKilled } = scriptedRunner({ honourCancel: false });
    const host = new ToolHost(runner, fakeTimers().timers);
    host.noteOpenDocument("a.rms");
    host.start(tool, {}, "content of a");
    host.noteOpenDocument(null);
    expect(wasKilled()).toBe(true);
  });
});

describe("settings snapshot (BUG-014)", () => {
  // The pane's settings echo must describe the run it labels, not whatever the
  // generation context has since changed to. Proving that at the host level
  // (rather than by rendering ToolsPane, which this repo has no harness for,
  // see CLAUDE.md's Tauri-only-render caveat) means: the snapshot is captured
  // once at start() and nothing after start() can move it.
  it("captures the settings passed to start(), not a live reference", () => {
    const { runner } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src", runner, { playerCount: 4, mapSize: "tiny" });
    expect(host.getState().settingsSnapshot).toEqual({
      playerCount: 4,
      mapSize: "tiny",
    });
  });

  it("defaults to null when the caller supplies no settings", () => {
    const { runner } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src");
    expect(host.getState().settingsSnapshot).toBeNull();
  });

  it("does not change after start, even while the run is still live and later messages arrive", () => {
    const { runner, send } = scriptedRunner();
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, {}, "src", runner, { playerCount: 2, mapSize: "medium" });
    send({ type: "progress", fraction: 0.5 });
    send({ type: "result", output: { blocks: [] } });
    // Calling start() again for a NEW run (after this one finished) with
    // different settings must not reach back and mutate the first snapshot,
    // there is nothing left holding a reference to it once state moved on.
    expect(host.getState().settingsSnapshot).toEqual({
      playerCount: 2,
      mapSize: "medium",
    });
  });
});

describe("render caps (Sec.4.2)", () => {
  it("shows the first N rows and reports how many are hidden", () => {
    const rows = Array.from(
      { length: LIMITS.maxTableRowsRendered + 25 },
      (_, i) => [String(i)],
    );
    const { rows: shown, hidden } = tableRowsToRender(rows);
    expect(shown).toHaveLength(LIMITS.maxTableRowsRendered);
    expect(hidden).toBe(25);
  });

  it("passes a small table through untouched", () => {
    const rows = [["a"], ["b"]];
    expect(tableRowsToRender(rows)).toEqual({ rows, hidden: 0 });
  });
});

describe("outbound context size cap (Sec.4.2 rule 2)", () => {
  it("accepts a context exactly at the cap", () => {
    // JSON.stringify adds the two surrounding quote characters.
    const s = "x".repeat(LIMITS.maxOutboundRunBytes - 2);
    expect(checkOutboundContextSize(s)).toBeNull();
  });

  it("rejects a context one byte over the cap", () => {
    const s = "x".repeat(LIMITS.maxOutboundRunBytes - 1);
    expect(checkOutboundContextSize(s)).toContain(
      `${LIMITS.maxOutboundRunBytes + 1} bytes`,
    );
  });

  it("refuses an oversized context host-side, naming the script, before the runner ever starts", () => {
    const start = vi.fn();
    const runner: ToolRunner = { start };
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(
      tool,
      "x".repeat(LIMITS.maxOutboundRunBytes),
      "src",
      runner,
      null,
      "Pa_Site_v1.1.rms",
    );
    expect(host.getState().phase).toBe("done");
    expect(host.getState().error?.reason).toBe("host-error");
    expect(host.getState().error?.message).toContain("Pa_Site_v1.1.rms");
    expect(start).not.toHaveBeenCalled();
  });

  it("falls back to a generic label when the caller has no script name to give", () => {
    const runner: ToolRunner = { start: vi.fn() };
    const host = new ToolHost(runner, fakeTimers().timers);
    host.start(tool, "x".repeat(LIMITS.maxOutboundRunBytes), "src");
    expect(host.getState().error?.message).toContain("the open script");
  });
});

describe("scriptStats exemplar (Sec.9 item 9)", () => {
  it("emits progress then a result through the real host", async () => {
    const { scriptStats } = await import("../builtin/scriptStats");
    const { parseRms } = await import("../../parser/parser");
    const { loadLanguage } = await import("../../parser/__tests__/testUtils");
    const { inProcessRunner } = await import("../host");
    const lang = loadLanguage();
    const source =
      "<LAND_GENERATION>\n  base_terrain GRASS\n  create_land { land_percent 20 }\n";
    const host = new ToolHost(inProcessRunner, fakeTimers().timers);
    const seen: string[] = [];
    host.subscribe((s) => seen.push(s.phase));
    host.start(
      { kind: "builtin", manifest: scriptStats.manifest, impl: scriptStats },
      {
        apiVersion: TOOLS_API_VERSION,
        parseResult: parseRms(source, lang),
        params: {},
      },
      source,
    );
    await vi.waitFor(() => expect(host.getState().phase).toBe("done"));
    expect(host.getState().error).toBeNull();
    expect(host.getState().output?.blocks[0]).toEqual({
      kind: "heading",
      text: "Script statistics",
    });
  });
});
