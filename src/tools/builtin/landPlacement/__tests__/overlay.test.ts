// slice-4 brief item 6 acceptance: "shape counts and coordinates for a
// Bulls_Eyes-shaped model; the truncation path at maxOverlayShapesPerBlock
// (10,000) reporting the hidden count; the zero case printing its count."

import { describe, expect, it } from "vitest";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import { LIMITS } from "../../../../../tools-api/index";
import { overlayShapesToRender } from "../../../protocol";
import { add, num, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import { buildOverlayShapes } from "../overlay";
import type { AlpModel } from "../fence";
import type { LandRole, Placement } from "../model";

const ROTATION_PLAYER = 4123;
const ROTATION_AUX = -47;
const VAR_A1 = 1;
const VAR_A2 = -2;
const VAR_A3 = 0;
const DIST_BW_PLAYERS = 150;
const RADIUS_PLAYER_LANDS = 26;
const RADIUS_AUX_LANDS = 14;

const SCRIPT_SYMBOLS = new Map<string, number>([
  ["ROTATION_PLAYER", ROTATION_PLAYER],
  ["ROTATION_AUX", ROTATION_AUX],
  ["VAR_A1", VAR_A1],
  ["VAR_A2", VAR_A2],
  ["VAR_A3", VAR_A3],
  ["DIST_BW_PLAYERS", DIST_BW_PLAYERS],
  ["RADIUS_PLAYER_LANDS", RADIUS_PLAYER_LANDS],
  ["RADIUS_AUX_LANDS", RADIUS_AUX_LANDS],
]);

function role(over: Partial<LandRole> = {}): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: num(12),
    baseElevation: num(9),
    extent: { kind: "percent", value: num(8) },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
    ...over,
  };
}

/** Bulls_Eyes' 8 lands, this time every one wearing a role (unlike emitModel.test.ts's roleless fixture) so the overlay has circles to draw. */
function bullsEyesModel(): AlpModel {
  const player = (
    id: string,
    thetaSym: import("../../../../../tools-api/index").Expr,
  ): Placement => ({
    id,
    parent: "center",
    frame: "radial",
    label: id,
    role: "player",
    repeatIndex: id === "P1" ? 0 : 1,
    offset: { kind: "polar", r: sym("RADIUS_PLAYER_LANDS"), theta: thetaSym },
  });
  const aux = (
    id: string,
    parent: string,
    baselineDelta: number,
    varName: string,
  ): Placement => ({
    id,
    parent,
    frame: "radial",
    label: id,
    role: "player",
    repeatIndex: 0,
    offset: {
      kind: "polar",
      r: sym("RADIUS_AUX_LANDS"),
      theta:
        baselineDelta === 0
          ? add(sym("ROTATION_AUX"), sym(varName))
          : add(add(num(baselineDelta), sym("ROTATION_AUX")), sym(varName)),
    },
  });
  const placements: Placement[] = [
    player("P1", sym("ROTATION_PLAYER")),
    aux("P1_A1", "P1", 0, "VAR_A1"),
    aux("P1_A2", "P1", -135, "VAR_A2"),
    aux("P1_A3", "P1", 135, "VAR_A3"),
    player("P2", add(sym("DIST_BW_PLAYERS"), sym("ROTATION_PLAYER"))),
    aux("P2_A1", "P2", 0, "VAR_A1"),
    aux("P2_A2", "P2", -135, "VAR_A2"),
    aux("P2_A3", "P2", 135, "VAR_A3"),
  ];
  return { v: 1, placements, roles: [role()], randomParams: [], groups: [] };
}

describe("buildOverlayShapes — Bulls_Eyes-shaped model", () => {
  const model = bullsEyesModel();
  const namer = new NameAllocator({ prefix: "" });
  const emission = emitAlpModel(model, namer, SCRIPT_SYMBOLS, 2);
  if (!emission.ok) throw new Error("fixture must emit cleanly");

  it("draws one circle per land (8) and one line per chain link (6 — the aux lands only)", () => {
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 200,
    });
    const circles = shapes.filter((s) => s.kind === "circle");
    const lines = shapes.filter((s) => s.kind === "line");
    expect(circles).toHaveLength(8);
    expect(lines).toHaveLength(6); // P1_A1/2/3 and P2_A1/2/3 each have a parent; P1/P2's parent is "center", which draws no line
  });

  it("circle coordinates land in [0, dim-1] and match resolved X/Y converted to tiles", () => {
    const dim = 200;
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: dim,
    });
    const p1 = shapes.find((s) => s.kind === "circle" && s.id === "P1");
    expect(p1).toBeDefined();
    if (p1?.kind !== "circle") throw new Error("expected circle");
    const q = emission.quantities.get("P1")!;
    const expectedX = Math.max(
      0,
      Math.min(
        dim - 1,
        Math.round((emission.resolved.get(q.xName)! / 100) * dim),
      ),
    );
    const expectedY = Math.max(
      0,
      Math.min(
        dim - 1,
        Math.round((emission.resolved.get(q.yName)! / 100) * dim),
      ),
    );
    expect(p1.x).toBe(expectedX);
    expect(p1.y).toBe(expectedY);
    expect(Number.isFinite(p1.x)).toBe(true);
    expect(Number.isFinite(p1.y)).toBe(true);
  });

  it("circle radius is the role's resolved base_size, unconverted (base_size is not a percent quantity)", () => {
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 200,
    });
    const p1 = shapes.find((s) => s.kind === "circle" && s.id === "P1");
    if (p1?.kind !== "circle") throw new Error("expected circle");
    expect(p1.rTiles).toBe(12); // role().baseSize
  });

  it("gizmos (handles) draw only for the selected placement(s)", () => {
    const none = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 200,
    });
    expect(none.filter((s) => s.kind === "handle")).toHaveLength(0);

    const selected = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 200,
      selectedIds: new Set(["P1", "P2_A1"]),
    });
    const handles = selected.filter((s) => s.kind === "handle");
    expect(handles).toHaveLength(2);
    expect(
      handles.map((h) => (h.kind === "handle" ? h.id : null)).sort(),
    ).toEqual(["P1", "P2_A1"]);
  });
});

describe("buildOverlayShapes — truncation (Sec.3.7, via the existing overlayShapesToRender)", () => {
  it("over-budget truncates and reports the hidden count, never rejects", () => {
    const shapes: import("../../../../../tools-api/index").OverlayShape[] = [];
    const over = LIMITS.maxOverlayShapesPerBlock + 250;
    for (let i = 0; i < over; i++) {
      shapes.push({
        id: `s${i}`,
        kind: "circle",
        x: i % 100,
        y: 0,
        rTiles: 1,
        role: "primary",
      });
    }
    const { shapes: rendered, hidden } = overlayShapesToRender(shapes);
    expect(rendered).toHaveLength(LIMITS.maxOverlayShapesPerBlock);
    expect(hidden).toBe(250);
  });

  it("the zero case reports hidden: 0, unconditionally — a filtered overlay and an empty one are different claims", () => {
    const { shapes, hidden } = overlayShapesToRender([]);
    expect(shapes).toHaveLength(0);
    expect(hidden).toBe(0);
  });

  it("Land Placement's own real shape count (8 circles + 6 lines = 14) is nowhere near the cap", () => {
    const model = bullsEyesModel();
    const namer = new NameAllocator({ prefix: "" });
    const emission = emitAlpModel(model, namer, SCRIPT_SYMBOLS, 2);
    if (!emission.ok) throw new Error("fixture must emit cleanly");
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim: 200,
    });
    const { hidden } = overlayShapesToRender(shapes);
    expect(hidden).toBe(0);
    expect(shapes.length).toBeLessThan(LIMITS.maxOverlayShapesPerBlock);
  });
});

describe("buildOverlayShapes — degenerate inputs", () => {
  it("an empty model draws nothing", () => {
    const model: AlpModel = {
      v: 1,
      placements: [],
      roles: [],
      randomParams: [],
      groups: [],
    };
    expect(
      buildOverlayShapes({
        model,
        quantities: new Map(),
        resolved: new Map(),
        roleNamesByPlacement: new Map(),
        mapDim: 200,
      }),
    ).toEqual([]);
  });

  it("a placement with no resolved position (unresolved) draws nothing for it, honestly, rather than guessing", () => {
    const model: AlpModel = {
      v: 1,
      placements: [
        {
          id: "P1",
          parent: "center",
          frame: "radial",
          label: "P1",
          offset: { kind: "polar", r: num(1), theta: num(0) },
        },
      ],
      roles: [],
      randomParams: [],
      groups: [],
    };
    expect(
      buildOverlayShapes({
        model,
        quantities: new Map(),
        resolved: new Map(),
        roleNamesByPlacement: new Map(),
        mapDim: 200,
      }),
    ).toEqual([]);
  });
});
