// external-tools-design.md Sec.10 / land-placement-slice4-brief.md item 1:
// the RegisteredTool seam. 4a proved the seam with a fixture only; 4b wires
// the real panel in. `TOOLS` now carries every built-in PLUS one `panel`
// arm (Land Placement), and this file's first describe block was rewritten
// to match rather than assert the pre-4b shape.

import { describe, expect, it } from "vitest";
import { TOOLS_API_VERSION, type ToolManifest } from "../../../tools-api/index";
import { checkRegistry, registeredTools, TOOLS, type RegisteredTool } from "../registry";

function panelManifest(over: Partial<ToolManifest> = {}): ToolManifest {
  return {
    id: "a-fixture-panel",
    name: "Fixture Panel",
    version: "1.0.0",
    apiVersion: TOOLS_API_VERSION,
    description: "d",
    capabilities: [],
    surface: "panel",
    ...over,
  };
}

describe("TOOLS — the live built-in registry", () => {
  it("wraps every built-in in the builtin arm, unchanged, plus the Land Placement panel arm", () => {
    expect(TOOLS.length).toBeGreaterThan(0);
    const builtins = TOOLS.filter((t) => t.kind === "builtin");
    const panels = TOOLS.filter((t) => t.kind === "panel");
    expect(builtins.length).toBeGreaterThan(0);
    for (const t of builtins) {
      expect(t.impl.manifest).toBe(t.manifest);
    }
    // Exactly one panel-kind entry, and it is Land Placement, the only
    // panel tool this slice builds.
    expect(panels).toHaveLength(1);
    expect(panels[0]?.manifest.id).toBe("land-placement");
  });

  it("registeredTools()'s manifest validation is untouched by the widening", () => {
    const check = checkRegistry();
    expect(check).toEqual({ ok: true, problems: [] });
    expect(registeredTools().length).toBe(TOOLS.length);
  });
});

describe("RegisteredTool — the panel arm (Sec.3.2)", () => {
  it("a panel-kind fixture registers and reaches registeredTools()'s output, alongside the real built-ins and the real panel", () => {
    const panel: RegisteredTool = { kind: "panel", manifest: panelManifest(), component: null };
    const withPanel = [...TOOLS, panel];

    expect(checkRegistry(withPanel)).toEqual({ ok: true, problems: [] });

    const offered = registeredTools(withPanel);
    expect(offered).toHaveLength(TOOLS.length + 1);
    expect(offered.map((t) => t.manifest.id)).toContain("a-fixture-panel");
    expect(offered.map((t) => t.manifest.id)).toContain("land-placement");
  });

  it("a malformed panel manifest is rejected the same way a malformed builtin manifest is", () => {
    const panel: RegisteredTool = { kind: "panel", manifest: panelManifest({ apiVersion: 999 }), component: null };
    const check = checkRegistry([panel]);
    expect(check.ok).toBe(false);
    expect(check.problems[0]?.manifestId).toBe("a-fixture-panel");
  });
});
