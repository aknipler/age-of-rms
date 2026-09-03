// land-placement-design.md Sec.3.6, the panel lifecycle. A SECOND, PARALLEL
// slot on ToolHost, tested standalone: no panel-surface tool exists yet to
// wire this into ToolsPane.tsx (deliberately, see host.ts's own comment),
// so these tests exercise the machinery a future panel tool will call.

import { describe, expect, it } from "vitest";
import { TOOLS_API_VERSION, type ToolManifest } from "../../../tools-api/index";
import { ToolHost, inProcessRunner, type RunnerHandle, type ToolRunner } from "../host";
import type { RegisteredTool } from "../registry";

function manifest(over: Partial<ToolManifest> = {}): ToolManifest {
  return { id: "t", name: "T", version: "1.0.0", apiVersion: TOOLS_API_VERSION, description: "d", capabilities: [], ...over };
}

/** A bare `builtin` RegisteredTool wrapping a report run, host.start()'s new parameter shape (Sec.10). */
function reportTool(): RegisteredTool {
  const m = manifest();
  return { kind: "builtin", manifest: m, impl: { manifest: m, run: () => ({ cancel() {} }) } };
}

/** A report runner the test holds open, so isBusy() reads "running" until told to finish. */
function openRunner() {
  let killed = false;
  const runner: ToolRunner = {
    start(): RunnerHandle {
      return { cancel: () => {}, kill: () => (killed = true) };
    },
  };
  return { runner, wasKilled: () => killed };
}

describe("PanelState — mount/unmount", () => {
  it("starts unmounted", () => {
    const host = new ToolHost(inProcessRunner);
    expect(host.getPanelState()).toEqual({ phase: "unmounted", toolId: null, documentId: null, dirty: false });
  });

  it("mounts, becoming isBusy()", () => {
    const host = new ToolHost(inProcessRunner);
    const ok = host.mountPanel("land-placement", "/map.rms");
    expect(ok).toBe(true);
    expect(host.getPanelState()).toEqual({ phase: "mounted", toolId: "land-placement", documentId: "/map.rms", dirty: false });
    expect(host.isBusy()).toBe(true);
  });

  it("rejects mounting while a report run is active — the one-at-a-time slot is shared", () => {
    const { runner } = openRunner();
    const host = new ToolHost(runner);
    host.start(reportTool(), {}, "src");
    expect(host.isBusy()).toBe(true);
    expect(host.mountPanel("land-placement", "/map.rms")).toBe(false);
    expect(host.getPanelState().phase).toBe("unmounted");
  });

  it("unmountPanel returns to the unmounted state unconditionally", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.setPanelDirty(true);
    host.unmountPanel();
    expect(host.getPanelState()).toEqual({ phase: "unmounted", toolId: null, documentId: null, dirty: false });
  });

  it("a mounted panel blocks start() the same way a busy report run does", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    expect(() => host.start(reportTool(), {}, "src")).toThrow(/already active/);
  });
});

describe("PanelState — suspend/resume (Advanced Tools tab left/entered)", () => {
  it("suspend releases the run slot: isBusy() goes false while the model is retained", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.suspendPanel();
    expect(host.getPanelState().phase).toBe("suspended");
    expect(host.getPanelState().toolId).toBe("land-placement"); // model retained
    expect(host.isBusy()).toBe(false);
  });

  it("a suspended panel no longer blocks a report tool from starting", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.suspendPanel();
    expect(() => host.start(reportTool(), {}, "src")).not.toThrow();
  });

  it("resume returns to mounted, reoccupying the slot", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.suspendPanel();
    host.resumePanel();
    expect(host.getPanelState().phase).toBe("mounted");
    expect(host.isBusy()).toBe(true);
  });

  it("suspend is a no-op when not mounted", () => {
    const host = new ToolHost(inProcessRunner);
    host.suspendPanel();
    expect(host.getPanelState().phase).toBe("unmounted");
  });

  it("resume is a no-op when not suspended", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.resumePanel(); // already mounted, not suspended
    expect(host.getPanelState().phase).toBe("mounted");
  });
});

describe("PanelState — dirty tracking (Sec.3.6(a))", () => {
  it("setPanelDirty updates the flag while mounted", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.setPanelDirty(true);
    expect(host.getPanelState().dirty).toBe(true);
    host.setPanelDirty(false);
    expect(host.getPanelState().dirty).toBe(false);
  });

  it("setPanelDirty is a no-op when unmounted", () => {
    const host = new ToolHost(inProcessRunner);
    host.setPanelDirty(true);
    expect(host.getPanelState().dirty).toBe(false);
  });

  it("mounting resets dirty to false", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.setPanelDirty(true);
    host.unmountPanel();
    host.mountPanel("land-placement", "/map.rms");
    expect(host.getPanelState().dirty).toBe(false);
  });
});

describe("PanelState — documentReplaced() (Sec.3.6(c))", () => {
  it("unmounts the panel unconditionally, dirty or not", () => {
    const host = new ToolHost(inProcessRunner);
    host.mountPanel("land-placement", "/map.rms");
    host.setPanelDirty(true);
    host.documentReplaced();
    expect(host.getPanelState()).toEqual({ phase: "unmounted", toolId: null, documentId: null, dirty: false });
  });

  it("documentReplaced with no panel mounted still resets RunState as before (no regression)", () => {
    const host = new ToolHost(inProcessRunner);
    host.documentReplaced();
    expect(host.getState().phase).toBe("idle");
  });

  it("a report run active AND a panel is unreachable (mounting rejects while busy) — documentReplaced still terminates the run", () => {
    const { runner, wasKilled } = openRunner();
    const host = new ToolHost(runner);
    host.start(reportTool(), {}, "src");
    host.documentReplaced();
    expect(wasKilled()).toBe(true);
    expect(host.getState().phase).toBe("idle");
  });
});

describe("inProcessRunner — arm narrowing (external-tools-design.md Sec.10)", () => {
  // "a runner handed the wrong kind must throw, not silently no-op." A panel
  // never reaches a runner at all (Sec.3.2: it does not go through
  // ToolHost.start()), so landing here with one is a caller bug and must be
  // loud rather than a silent no-op.
  it("throws rather than silently no-op'ing when handed a non-builtin RegisteredTool", () => {
    const panelTool: RegisteredTool = { kind: "panel", manifest: manifest(), component: null };
    expect(() => inProcessRunner.start(panelTool, {}, () => {})).toThrow(/panel/);
  });
});

describe("PanelState — subscribePanel", () => {
  it("notifies subscribers on every transition", () => {
    const host = new ToolHost(inProcessRunner);
    const seen: string[] = [];
    const unsub = host.subscribePanel((s) => seen.push(s.phase));
    host.mountPanel("land-placement", "/map.rms");
    host.suspendPanel();
    host.resumePanel();
    host.unmountPanel();
    expect(seen).toEqual(["mounted", "suspended", "mounted", "unmounted"]);
    unsub();
  });

  it("stops notifying after unsubscribe", () => {
    const host = new ToolHost(inProcessRunner);
    const seen: string[] = [];
    const unsub = host.subscribePanel((s) => seen.push(s.phase));
    unsub();
    host.mountPanel("land-placement", "/map.rms");
    expect(seen).toEqual([]);
  });
});
