// land-placement-per-player-any-kind-escalation.md, slices A, B and C. The
// prologue asks the expander for a member's position at each player count
// (`memberOffset`), in place of its own copy of the ring formula. Slice A
// adds Arc to the kinds a per player shape can take, and slice B adds Line
// with its radius cells. Slice C adds Square, Triangle and Polygon, whose
// jittered lands walk the perimeter at runtime.
//
// The emitted script is read back through the preview's own
// `instantiateScript`, the path the map preview takes, and not only through
// the compiler's evaluator (CLAUDE.md, "sharing a helper with a consumer is
// not sharing its result").

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Expr, TextEdit } from "../../../../../tools-api/index";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../parser/language";
import { parseRms } from "../../../../parser/parser";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import { createTileGrid } from "../../../../preview/generator/grid";
import { placeLandOrigins } from "../../../../preview/generator/lands";
import type { ObjectConstant } from "../../../../preview/generator/objects";
import { computeApplyEdits } from "../applyEdits";
import { add, bin, num, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel } from "../emitModel";
import { expandShapeGroup, memberOffset } from "../expand";
import type { AlpModel } from "../fence";
import {
  ASSIGN_TO_PLAYER_PER_REPEAT,
  type LandRole,
  type Placement,
  type ShapeGroup,
} from "../model";
import {
  addChainTemplate,
  addPatternSlot,
  addRing,
  applyDragToPlacement,
  applyGroupEdit,
  degreesAsPercentOfGap,
  setGroupJitter,
  setGroupKind,
  setThetaPerCountOverride,
  updatePlacement,
} from "../panel/modelOps";
import * as prologueModule from "../prologue";
import { buildPrologue } from "../prologue";
import { perimeterPolar } from "../perimeterOffset";
import { perPlayerForcedLabels } from "../panel/canvasInteraction";

const lang = loadLanguage();
const refDb = buildLanguageIndex(lang);
const NL = String.fromCharCode(10);
const SOURCE = "<PLAYER_SETUP>" + NL + "direct_placement" + NL;
const parse = parseRms(SOURCE, lang);
const IDENTITY_RESOLVER = (e: Expr): Expr => e;

function role(): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: { k: "num", v: 12 },
    baseElevation: { k: "num", v: 0 },
    extent: { kind: "percent", value: { k: "num", v: 8 } },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
  };
}

/** A per player arc built the way the panel builds one, the kind picked first and the box ticked after. */
function perPlayerArc(
  opts: { sweep?: number; rotation?: number; slots?: number } = {},
): { model: AlpModel; groupId: string } {
  const { sweep = 100, rotation = 10, slots = 1 } = opts;
  const base: AlpModel = {
    v: 1,
    placements: [],
    roles: [role()],
    randomParams: [],
    groups: [],
  };
  const ring = addRing(base, "player");
  const groupId = ring.groupId;
  let model = applyGroupEdit(
    ring.model,
    groupId,
    { kind: "arc", sweep, rotation: num(rotation) },
    parse,
    null,
  )!.model;
  for (let s = 1; s < slots; s++)
    model = addPatternSlot(model, groupId, "player", parse, null)!.model;
  const ticked = applyGroupEdit(
    model,
    groupId,
    { perPlayer: true, repeats: 8 },
    parse,
    null,
  );
  expect(ticked).not.toBeNull();
  return { model: ticked!.model, groupId };
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let text = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.newText + text.slice(e.end);
  return text;
}

function applied(model: AlpModel, playerCount = 8) {
  const { edits, emissionProblems } = computeApplyEdits(
    parse,
    model,
    lang,
    new Map(),
    playerCount,
  );
  return { text: applyEdits(SOURCE, edits), emissionProblems };
}

/** Every `ALP_DEG_*` constant the preview resolves for `text` at `playerCount`. */
function previewDegrees(
  text: string,
  playerCount: number,
  seed = 1,
): Map<string, number> {
  const instantiated = instantiateScript(
    parseRms(text, lang),
    refDb,
    { playerCount, mapSize: "Normal", teams: [] },
    seed,
  );
  const out = new Map<string, number>();
  for (const [name, value] of instantiated.symbols)
    if (name.startsWith("ALP_DEG_")) out.set(name, value);
  return out;
}

/** Sec.4.5's arc formula at player count `count`, the member `m` of `L × count`. */
function arcDegrees(
  rotation: number,
  sweep: number,
  m: number,
  memberCount: number,
): number {
  const span = memberCount - 1;
  return rotation + (span === 0 ? 0 : Math.round((sweep * m) / span));
}

describe("memberOffset, the expander asked about one member at any count", () => {
  function group(overrides: Partial<ShapeGroup>): ShapeGroup {
    return {
      id: "G",
      parent: "center",
      kind: "circle",
      pattern: [{ id: "A" }, { id: "B" }],
      repeats: 3,
      radius: num(30),
      rotation: sym("ROT"),
      frame: "radial",
      members: [],
      perPlayer: false,
      ...overrides,
    };
  }

  it.each(["circle", "arc", "line", "square", "triangle", "polygon"] as const)(
    "gives exactly what expandShapeGroup gives a %s at its own repeats",
    (kind) => {
      const g = group({ kind, sweep: 140, sides: 5 });
      const { placements } = expandShapeGroup(g);
      placements.forEach((p, k) => {
        const i = Math.floor(k / g.pattern.length);
        const j = k % g.pattern.length;
        expect(memberOffset(g, i, j, g.repeats)).toEqual(p.offset);
      });
    },
  );

  // The slice's hazard (doc section 9). Circle's two term angle,
  // round(360/repeats * i + 360/N * j), and the linear round(360 * m / N)
  // are equal as algebra and not as floats. Here the two term sum is
  // 247.49999999999997 and rounds down, while the linear form reads 247.5
  // and rounds up. A memberOffset that unified the two would move this
  // land a degree.
  it("keeps Circle's own two term angle, which rounds differently from a linear index at an exact half degree", () => {
    const g = group({
      rotation: num(0),
      pattern: Array.from({ length: 8 }, (_, j) => ({ id: `S${j}` })),
      repeats: 22,
    });
    const offset = memberOffset(g, 15, 1, 22);
    expect(offset).toEqual({
      kind: "polar",
      r: num(30),
      theta: add(num(0), num(247)),
    });
  });

  it("spreads an arc over its whole sweep at a count other than the group's own", () => {
    const g = group({ kind: "arc", sweep: 100, rotation: num(10) });
    // 2 slots at count 3 is 6 members, span 5, so steps of 20.
    const thetas = [0, 1, 2].flatMap((i) =>
      [0, 1].map((j) => memberOffset(g, i, j, 3)),
    );
    expect(thetas.map((o) => (o.kind === "polar" ? o.theta : null))).toEqual(
      [0, 20, 40, 60, 80, 100].map((d) => add(num(10), num(d))),
    );
  });
});

// Slice C deletes the interim guard of doc section 2, since a predicate
// that answers yes for every kind is dead code, and the three guards that
// read it go with it.
describe("every kind takes one land per player, after slice C", () => {
  it("the interim guard's predicate is gone", () => {
    expect("perPlayerSupportsKind" in prologueModule).toBe(false);
  });

  it.each(["circle", "arc", "line", "square", "triangle", "polygon"] as const)(
    "the panel ticks One land per player on a %s and the emitter takes it",
    (kind) => {
      const { model } = perPlayerShape({ kind });
      expect(model.groups[0]!.perPlayer).toBe(true);
      expect(model.groups[0]!.kind).toBe(kind);
      expect(applied(model).emissionProblems).toEqual([]);
    },
  );
});

describe("a per player arc re-spaces over its whole sweep at every count", () => {
  it.each([1, 2, 3, 8])(
    "puts its members at rotation + round(sweep × m / span) at %i players",
    (count) => {
      const { model } = perPlayerArc({ sweep: 100, rotation: 10 });
      const expected = Array.from({ length: count }, (_, m) =>
        arcDegrees(10, 100, m, count),
      );
      // The emitter's own resolved table, what the canvas draws.
      const emission = emitAlpModel(
        model,
        new NameAllocator(),
        new Map(),
        count,
      );
      expect(emission.ok).toBe(true);
      if (!emission.ok) return;
      expect(
        expected.map((_, m) => emission.resolved.get(`ALP_DEG_P${m + 1}`)),
      ).toEqual(expected);
      // The preview's own reading of the applied script. It cannot be asked
      // about a 1 player game (the app's minimum is 2), so the branch at 1
      // is read from the emission alone.
      if (count >= 2) {
        const deg = previewDegrees(applied(model, count).text, count);
        expect(expected.map((_, m) => deg.get(`ALP_DEG_P${m + 1}`))).toEqual(
          expected,
        );
      }
    },
  );

  it("counts every slot of every player in the span, with two slots per player", () => {
    const { model } = perPlayerArc({ sweep: 90, rotation: 0, slots: 2 });
    const deg = previewDegrees(applied(model, 3).text, 3);
    // The allocator upper-cases a name's suffix (naming.ts).
    const slotIds = model.groups[0]!.pattern.map((s) => s.id.toUpperCase());
    // 6 members, span 5, steps of 18.
    const got = [0, 1, 2].flatMap((i) =>
      slotIds.map((slot) => deg.get(`ALP_DEG_P${i + 1}_${slot}`)),
    );
    expect(got).toEqual([0, 18, 36, 54, 72, 90]);
  });

  // The lands the preview actually places, measured from the map centre. A
  // land's percent position is whole, so a bearing can sit a couple of
  // degrees off, and a gap compares two of them.
  it("the preview places the lands 50 degrees apart at 3 players over a 100 degree sweep", () => {
    const constants = (
      JSON.parse(
        readFileSync(
          join(REPO_ROOT, "reference", "data", "game-constants.json"),
          "utf8",
        ),
      ) as { constants: ObjectConstant[] }
    ).constants;
    const { model } = perPlayerArc({ sweep: 100, rotation: 10 });
    const instantiated = instantiateScript(
      parseRms(applied(model, 3).text, lang),
      refDb,
      { playerCount: 3, mapSize: "Normal", teams: [] },
      1,
    );
    const dim = instantiated.dim;
    const { origins } = placeLandOrigins(
      instantiated,
      createTileGrid(dim, 0),
      constants,
      1,
    );
    expect(origins).toHaveLength(3);
    const bearings = origins
      .map(
        (o) =>
          ((Math.atan2(o.y - dim / 2, o.x - dim / 2) * 180) / Math.PI + 360) %
          360,
      )
      .sort((a, b) => a - b);
    const gaps = bearings.map((b, i) =>
      i === bearings.length - 1 ? bearings[0]! + 360 - b : bearings[i + 1]! - b,
    );
    // Two 50 degree gaps along the arc and the 260 degree one round the back.
    const sorted = [...gaps].sort((a, b) => a - b);
    expect(Math.abs(sorted[0]! - 50)).toBeLessThan(4);
    expect(Math.abs(sorted[1]! - 50)).toBeLessThan(4);
    expect(Math.abs(sorted[2]! - 260)).toBeLessThan(4);
  });
});

describe("a jittered per player arc", () => {
  it("percent emits one line per member per branch, a share of the sweep over this count's span", () => {
    const { model, groupId } = perPlayerArc({ sweep: 100 });
    const plainLines = applied(model)
      .text.split(NL)
      .filter((l) => l.startsWith("#const")).length;
    const { text, emissionProblems } = applied(
      setGroupJitter(model, groupId, "percent", 30),
    );
    expect(emissionProblems).toEqual([]);
    const lines = text.split(NL);
    // The eight draws are the only new lines, so no temporary was spent.
    expect(lines.filter((l) => l.startsWith("#const")).length).toBe(
      plainLines + 8,
    );
    const deg = lines.filter((l) => /^#const ALP_DEG_P\d /.test(l));
    expect(deg).toHaveLength(36);
    const branch3 = text.split("elseif 3_PLAYER_GAME")[1]!.split("elseif")[0]!;
    expect(branch3).toMatch(/_P2 \* 100 \/ 2 \/ 100 \+/);
    const branch8 = text.split("elseif 8_PLAYER_GAME")[1]!.split("endif")[0]!;
    expect(branch8).toMatch(/_P2 \* 100 \/ 7 \/ 100 \+/);
  });

  it("degrees adds the draw to the even default", () => {
    const { model, groupId } = perPlayerArc();
    const { text } = applied(setGroupJitter(model, groupId, "deg", 7));
    const branch3 = text.split("elseif 3_PLAYER_GAME")[1]!.split("elseif")[0]!;
    const p2 = branch3.split(NL).find((l) => /^#const ALP_DEG_P2 /.test(l))!;
    expect(p2).toMatch(/\+ ALP_PARAM_JITTER_RING_\d+_P2\)$/);
  });

  // Doc 5.1. One member and no neighbour leaves no gap to take a share of.
  it("leaves the draw out of a branch whose span is 0, in both units", () => {
    for (const unit of ["deg", "percent"] as const) {
      const { model, groupId } = perPlayerArc();
      const { text } = applied(setGroupJitter(model, groupId, unit, 7));
      const branch1 = text.split("if 1_PLAYER_GAME")[1]!.split("elseif")[0]!;
      const p1 = branch1.split(NL).find((l) => /^#const ALP_DEG_P1 /.test(l))!;
      expect(p1).not.toContain("JITTER");
      // Two slots at 1 player is two members, so the gap exists again.
      const two = perPlayerArc({ slots: 2 });
      const twoText = applied(
        setGroupJitter(two.model, two.groupId, unit, 7),
      ).text;
      const twoBranch1 = twoText
        .split("if 1_PLAYER_GAME")[1]!
        .split("elseif")[0]!;
      expect(twoBranch1).toContain("JITTER");
    }
  });

  it("moves each land by its draw's share of the gap in the preview, never further", () => {
    // 40 percent of a 50 degree gap is 20 degrees either way.
    const { model, groupId } = perPlayerArc({ sweep: 100, rotation: 10 });
    const text = applied(setGroupJitter(model, groupId, "percent", 40), 3).text;
    let moved = false;
    for (const seed of [1, 7, 42, 12345, 999]) {
      const deg = previewDegrees(text, 3, seed);
      [10, 60, 110].forEach((even, m) => {
        const got = deg.get(`ALP_DEG_P${m + 1}`)!;
        expect(Math.abs(got - even)).toBeLessThanOrEqual(20);
        if (got !== even) moved = true;
      });
    }
    expect(moved).toBe(true);
  });
});

// Doc 4.2. A quantity carries an authored rule when the member is nudged, or
// when its stored value differs from what the expander gives it at the
// group's own repeats.
describe("rule detection against the expander", () => {
  function arcGroup(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
    return {
      id: "arc",
      parent: "center",
      kind: "arc",
      sweep: 70,
      pattern: [{ id: "P", role: "player" }],
      repeats: 8,
      radius: num(30),
      rotation: num(0),
      frame: "radial",
      members: Array.from({ length: 8 }, (_, i) => `arc#${i}#P`),
      perPlayer: true,
      ...overrides,
    };
  }
  const member = (id: string, theta: Expr, nudged?: boolean): Placement => ({
    id,
    parent: "center",
    frame: "radial",
    label: id,
    offset: { kind: "polar", r: num(30), theta },
    ...(nudged ? { nudged } : {}),
  });

  it("an arc member at its expander position follows the count, and a nudged one keeps its angle", () => {
    const g = arcGroup();
    // At 8 players, member 1 of span 7 over 70 degrees sits at 10.
    const following = member("arc#1#P", add(num(0), num(10)));
    const nudged = member("arc#2#P", num(33), true);
    const result = buildPrologue(
      [g],
      [following, nudged],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    const byName = new Map(result.liveDegCells.map((c) => [c.name, c.text]));
    const name = (id: string) =>
      (result.thetaOverrides.get(id) as { name: string }).name;
    // At 3 players the span is 2, so member 1 moves to 35.
    expect(byName.get(name("arc#1#P"))).toBe("35");
    expect(byName.get(name("arc#2#P"))).toBe("33");
  });

  // The one Circle output this slice changes, recorded in doc 4.2. A slot
  // angle is part of what the expander produces, so a member standing on it
  // is the shape, not a rule, and a jitter now applies on top of it. Before
  // this slice the same member read as a rule and took no jitter.
  it("a slot angle on a per player circle is the shape, so jitter applies on top of it", () => {
    const g: ShapeGroup = {
      ...arcGroup({ kind: "circle", id: "ring" }),
      pattern: [{ id: "P", role: "player", theta: num(40) }],
      members: Array.from({ length: 8 }, (_, i) => `ring#${i}#P`),
      jitter: { param: "J", unit: "deg" },
    };
    const p2 = member("ring#1#P", add(num(0), num(40)));
    const resolver = (e: Expr, owner: number | undefined): Expr =>
      e.k === "param" ? sym(`J_P${owner}`) : e;
    const result = buildPrologue(
      [g],
      [p2],
      new Map(),
      new NameAllocator(),
      3,
      resolver,
    );
    const name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const cell = result.liveDegCells.find((c) => c.name === name)!;
    expect(cell.tokens).toContain("J_P2");
    expect(cell.tokens).toContain("40");
  });

  // Asking the expander means a slot's own angle reaches the branch, so a
  // param inside it has to be resolved for the member's own player there.
  it("resolves a param inside a slot angle for the member's own player", () => {
    const g: ShapeGroup = {
      ...arcGroup({ kind: "circle", id: "ring" }),
      pattern: [{ id: "P", role: "player", theta: { k: "param", id: "d" } }],
      members: Array.from({ length: 8 }, (_, i) => `ring#${i}#P`),
    };
    const resolver = (e: Expr, owner: number | undefined): Expr => {
      const walk = (n: Expr): Expr =>
        n.k === "param"
          ? sym(`D_P${owner}`)
          : n.k === "bin"
            ? bin(n.op, walk(n.l), walk(n.r))
            : n;
      return walk(e);
    };
    const result = buildPrologue(
      [g],
      [],
      new Map(),
      new NameAllocator(),
      3,
      resolver,
    );
    const name = (result.thetaOverrides.get("ring#2#P") as { name: string })
      .name;
    const cell = result.liveDegCells.find((c) => c.name === name)!;
    expect(cell.tokens).toContain("D_P3");
  });
});

// ---------------------------------------------------------------------------
// Slice B, radius cells and Line. A Line member's radius moves with the
// count, so it gets a RAD cell beside its DEG cell in every branch.
// ---------------------------------------------------------------------------

/** A per player line at rotation 0 and half length `radius`, built the way the panel builds one. */
function perPlayerLine(opts: { radius?: number; slots?: number } = {}): {
  model: AlpModel;
  groupId: string;
} {
  const { radius = 30, slots = 1 } = opts;
  const base: AlpModel = {
    v: 1,
    placements: [],
    roles: [role()],
    randomParams: [],
    groups: [],
  };
  const ring = addRing(base, "player");
  const groupId = ring.groupId;
  let model = applyGroupEdit(
    ring.model,
    groupId,
    { kind: "line", radius: num(radius), rotation: num(0) },
    parse,
    null,
  )!.model;
  for (let s = 1; s < slots; s++)
    model = addPatternSlot(model, groupId, "player", parse, null)!.model;
  const ticked = applyGroupEdit(
    model,
    groupId,
    { perPlayer: true, repeats: 8 },
    parse,
    null,
  );
  expect(ticked).not.toBeNull();
  return { model: ticked!.model, groupId };
}

/** Every `ALP_<stem>_*` constant the preview resolves for `text` at `playerCount`. */
function previewCells(
  text: string,
  stem: string,
  playerCount: number,
  seed = 1,
): Map<string, number> {
  const instantiated = instantiateScript(
    parseRms(text, lang),
    refDb,
    { playerCount, mapSize: "Normal", teams: [] },
    seed,
  );
  const out = new Map<string, number>();
  for (const [name, value] of instantiated.symbols)
    if (name.startsWith(`ALP_${stem}_`)) out.set(name, value);
  return out;
}

/** Sec.4.5's line formula, member `m` of `memberCount`, half length `b`. */
function lineRadius(b: number, m: number, memberCount: number): number {
  const span = memberCount - 1;
  return span === 0 ? 0 : (b * (2 * m - span)) / span;
}

/** The `#const` lines naming `name` inside the `count` player branch. */
function branchLine(text: string, count: number, name: string): string {
  const head = count === 1 ? "if 1_PLAYER_GAME" : `elseif ${count}_PLAYER_GAME`;
  const branch = text.split(head)[1]!.split(/\n(?:elseif|endif)/)[0]!;
  return branch.split(NL).find((l) => l.startsWith(`#const ${name} `))!;
}

describe("a per player line runs from -B to +B with even steps at every count", () => {
  it.each([1, 2, 3, 8])("at %i players", (count) => {
    const { model } = perPlayerLine({ radius: 30 });
    const expected = Array.from({ length: count }, (_, m) =>
      lineRadius(30, m, count),
    );
    // The emitter's resolved table, what the canvas draws. Its RAD cells
    // come from the previewed count's own branch.
    const emission = emitAlpModel(model, new NameAllocator(), new Map(), count);
    expect(emission.ok).toBe(true);
    if (!emission.ok) return;
    expected.forEach((r, m) => {
      expect(emission.resolved.get(`ALP_RAD_P${m + 1}`)).toBeCloseTo(r, 9);
      expect(emission.resolved.get(`ALP_DEG_P${m + 1}`)).toBe(0);
    });
    if (count >= 2) {
      const rad = previewCells(applied(model, count).text, "RAD", count);
      expected.forEach((r, m) =>
        expect(rad.get(`ALP_RAD_P${m + 1}`)).toBeCloseTo(r, 9),
      );
    }
  });

  // The cross check has to see every RAD cell. Left out, a frame cell
  // reading one comes out unresolved in both evaluators, the two agree, and
  // the check passes having verified nothing, so no output can show the
  // gap. The field's own contract is the observable (mutation-tested).
  it("the cross check cells carry every player's RAD cell, the live cells only the previewed count's", () => {
    const g: ShapeGroup = {
      id: "line",
      parent: "center",
      kind: "line",
      pattern: [{ id: "P", role: "player" }],
      repeats: 8,
      radius: num(30),
      rotation: num(0),
      frame: "radial",
      members: Array.from({ length: 8 }, (_, i) => `line#${i}#P`),
      perPlayer: true,
    };
    const result = buildPrologue(
      [g],
      [],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    const rad = (cells: { name: string }[]) =>
      cells.map((c) => c.name).filter((n) => n.startsWith("ALP_RAD_"));
    expect(rad(result.crossCheckDegCells)).toEqual(
      Array.from({ length: 8 }, (_, i) => `ALP_RAD_P${i + 1}`),
    );
    expect(rad(result.liveDegCells)).toEqual([
      "ALP_RAD_P1",
      "ALP_RAD_P2",
      "ALP_RAD_P3",
    ]);
    expect([...result.radiusOverrides.keys()]).toEqual(g.members);
  });

  // The trap the brief names. A RAD cell left out of the live cells leaves
  // every member's X unresolved or at its 8 player value, and the canvas
  // draws the wrong count.
  it("the canvas's own X cells follow the previewed count", () => {
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const emission = emitAlpModel(model, new NameAllocator(), new Map(), 3);
    expect(emission.ok).toBe(true);
    if (!emission.ok) return;
    const members = model.groups.find((g) => g.id === groupId)!.members;
    const x = (k: number) =>
      emission.resolved.get(emission.quantities.get(members[k]!)!.xName)!;
    expect(x(0)).toBeCloseTo(20, 1);
    expect(x(1)).toBeCloseTo(50, 1);
    expect(x(2)).toBeCloseTo(80, 1);
  });

  it("the preview places 3 players at both ends and the anchor", () => {
    const constants = (
      JSON.parse(
        readFileSync(
          join(REPO_ROOT, "reference", "data", "game-constants.json"),
          "utf8",
        ),
      ) as { constants: ObjectConstant[] }
    ).constants;
    const { model } = perPlayerLine({ radius: 30 });
    const instantiated = instantiateScript(
      parseRms(applied(model, 3).text, lang),
      refDb,
      { playerCount: 3, mapSize: "Normal", teams: [] },
      1,
    );
    const dim = instantiated.dim;
    const { origins } = placeLandOrigins(
      instantiated,
      createTileGrid(dim, 0),
      constants,
      1,
    );
    expect(origins).toHaveLength(3);
    const polar = origins
      .map((o) => ({
        d: Math.hypot(o.x - dim / 2, o.y - dim / 2) / dim,
        a: (Math.atan2(o.y - dim / 2, o.x - dim / 2) * 180) / Math.PI,
      }))
      .sort((p, q) => p.d - q.d);
    // One land on the anchor, two at 30 percent out on opposite sides.
    expect(polar[0]!.d).toBeLessThan(0.02);
    expect(Math.abs(polar[1]!.d - 0.3)).toBeLessThan(0.02);
    expect(Math.abs(polar[2]!.d - 0.3)).toBeLessThan(0.02);
    const opposite = Math.abs(Math.abs(polar[1]!.a - polar[2]!.a) - 180);
    expect(opposite).toBeLessThan(4);
  });
});

describe("rules on a line member are decided per quantity", () => {
  it("an authored radius stays at every count while the bearing follows the shape", () => {
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const p2 = model.groups.find((g) => g.id === groupId)!.members[1]!;
    const placement = model.placements.find((p) => p.id === p2)!;
    if (placement.offset.kind !== "polar") throw new Error("polar expected");
    const authored = updatePlacement(model, p2, {
      offset: { ...placement.offset, r: num(12) },
    });
    expect(applied(authored).emissionProblems).toEqual([]);
    for (const count of [2, 3, 5, 8]) {
      const text = applied(authored, count).text;
      const rad = previewCells(text, "RAD", count);
      const deg = previewCells(text, "DEG", count);
      expect(rad.get("ALP_RAD_P2")).toBe(12);
      expect(deg.get("ALP_DEG_P2")).toBe(0);
      // Player 1 still re-spaces, and sits at the far end at every count.
      expect(rad.get("ALP_RAD_P1")).toBeCloseTo(-30, 9);
      expect(rad.get(`ALP_RAD_P${count}`)).toBeCloseTo(
        count === 2 ? 12 : 30,
        9,
      );
    }
  });

  // The owner's call (2026-09-28). Jitter rides on r, so only a rule on r
  // takes it away. An authored angle leaves the jitter on.
  it("an authored angle keeps the radius jitter, an authored radius drops it", () => {
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const members = model.groups.find((g) => g.id === groupId)!.members;
    const offsetOf = (id: string) => {
      const o = model.placements.find((p) => p.id === id)!.offset;
      if (o.kind !== "polar") throw new Error("polar expected");
      return o;
    };
    let m = updatePlacement(model, members[1]!, {
      offset: { ...offsetOf(members[1]!), theta: num(30) },
    });
    m = updatePlacement(m, members[2]!, {
      offset: { ...offsetOf(members[2]!), r: num(12) },
    });
    const { text } = applied(setGroupJitter(m, groupId, "percent", 20), 3);
    expect(branchLine(text, 3, "ALP_RAD_P2")).toContain("JITTER");
    expect(branchLine(text, 3, "ALP_DEG_P2")).not.toContain("JITTER");
    expect(branchLine(text, 3, "ALP_RAD_P3")).not.toContain("JITTER");
    expect(previewCells(text, "DEG", 3).get("ALP_DEG_P2")).toBe(30);
    expect(previewCells(text, "RAD", 3).get("ALP_RAD_P3")).toBe(12);
  });

  it("a nudged member keeps both quantities and takes no jitter", () => {
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const p2 = model.groups.find((g) => g.id === groupId)!.members[1]!;
    const nudged = updatePlacement(model, p2, {
      nudged: true,
      offset: { kind: "polar", r: num(17), theta: num(5) },
    });
    const { text } = applied(setGroupJitter(nudged, groupId, "percent", 20), 3);
    expect(branchLine(text, 3, "ALP_RAD_P2")).not.toContain("JITTER");
    expect(previewCells(text, "RAD", 3).get("ALP_RAD_P2")).toBe(17);
    expect(previewCells(text, "DEG", 3).get("ALP_DEG_P2")).toBe(5);
  });
});

describe("a jittered per player line", () => {
  it("emits each RAD cell as one line when B is a leaf, and leaves the angle alone", () => {
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const plain = applied(model)
      .text.split(NL)
      .filter((l) => l.startsWith("#const")).length;
    const { text, emissionProblems } = applied(
      setGroupJitter(model, groupId, "percent", 30),
    );
    expect(emissionProblems).toEqual([]);
    const lines = text.split(NL);
    expect(lines.filter((l) => l.startsWith("#const")).length).toBe(plain + 8);
    expect(lines.filter((l) => /^#const ALP_RAD_P\d /.test(l))).toHaveLength(
      36,
    );
    // Doc 5.3, J * 2 / 100 + K * B / span with K = 2m - span.
    expect(branchLine(text, 3, "ALP_RAD_P1")).toMatch(
      /^#const ALP_RAD_P1 \(ALP_PARAM_JITTER_RING_\d+_P1 \* 2 \/ 100 \+ -2 \* 30 \/ 2\)$/,
    );
    expect(branchLine(text, 3, "ALP_RAD_P3")).toMatch(
      /^#const ALP_RAD_P3 \(ALP_PARAM_JITTER_RING_\d+_P3 \* 2 \/ 100 \+ 2 \* 30 \/ 2\)$/,
    );
    for (const l of lines.filter((l) => /^#const ALP_DEG_P\d /.test(l)))
      expect(l).not.toContain("JITTER");
  });

  it("leaves the draw out of a branch whose span is 0", () => {
    const { model, groupId } = perPlayerLine();
    const jittered = setGroupJitter(model, groupId, "percent", 30);
    const { text } = applied(jittered);
    expect(branchLine(text, 1, "ALP_RAD_P1")).not.toContain("JITTER");
    const emission = emitAlpModel(jittered, new NameAllocator(), new Map(), 1);
    expect(emission.ok && emission.resolved.get("ALP_RAD_P1")).toBe(0);
    // Two slots at 1 player is two members, so the gap exists again.
    const two = perPlayerLine({ slots: 2 });
    const twoText = applied(
      setGroupJitter(two.model, two.groupId, "percent", 30),
    ).text;
    const branch1 = twoText.split("if 1_PLAYER_GAME")[1]!.split("elseif")[0]!;
    expect(branch1).toContain("JITTER");
  });

  it("moves each land by its draw's share of the gap in the preview, never further", () => {
    // At 3 players the gap is 2 * 30 / 2 = 30, and 40 percent of it is 12.
    const { model, groupId } = perPlayerLine({ radius: 30 });
    const text = applied(setGroupJitter(model, groupId, "percent", 40), 3).text;
    let moved = false;
    for (const seed of [1, 7, 42, 12345, 999]) {
      const rad = previewCells(text, "RAD", 3, seed);
      [-30, 0, 30].forEach((even, m) => {
        const got = rad.get(`ALP_RAD_P${m + 1}`)!;
        expect(Math.abs(got - even)).toBeLessThanOrEqual(12 + 1e-9);
        if (Math.abs(got - even) > 1e-9) moved = true;
      });
    }
    expect(moved).toBe(true);
  });

  it("refuses degrees with the jitterUnit problem, since a line has no angle along it", () => {
    const { model, groupId } = perPlayerLine();
    const jittered = setGroupJitter(model, groupId, "percent", 20);
    // Written straight onto the model, the way a hand edited fence would.
    const forced: AlpModel = {
      ...jittered,
      groups: jittered.groups.map((g) => ({
        ...g,
        jitter: { ...g.jitter!, unit: "deg" },
      })),
    };
    expect(applied(forced).emissionProblems.map((p) => p.name)).toEqual([
      `group:${groupId}:jitterUnit`,
    ]);
  });
});

// The owner's call (2026-09-28). A kind change to Line on a shape holding
// degree jitter translates the amount into percent of the even gap at the
// previewed count, so the jitter survives and the emitter never sees
// degrees on a line.
describe("switching a degree-jittered shape to Line", () => {
  function jitteredCircle(amount: number) {
    const { model, groupId } = perPlayerArc();
    const circle = applyGroupEdit(
      model,
      groupId,
      { kind: "circle" },
      parse,
      null,
    )!.model;
    return { model: setGroupJitter(circle, groupId, "deg", amount), groupId };
  }

  it("applyGroupEdit refuses it outright, so no caller can leave degrees on a line", () => {
    const { model, groupId } = jitteredCircle(12);
    expect(
      applyGroupEdit(model, groupId, { kind: "line" }, parse, null),
    ).toBeNull();
  });

  it("setGroupKind translates a circle's degrees at the previewed count", () => {
    // 4 players, one slot, gap 90 degrees. 12 / 90 is 13.3 percent, down to 13.
    const { model, groupId } = jitteredCircle(12);
    const result = setGroupKind(model, groupId, "line", 4, parse, null);
    expect(result).not.toBeNull();
    const group = result!.model.groups.find((g) => g.id === groupId)!;
    expect(group.kind).toBe("line");
    expect(group.jitter?.unit).toBe("percent");
    const param = result!.model.randomParams.find(
      (p) => p.id === group.jitter!.param,
    )!;
    expect([param.min, param.max]).toEqual([-13, 13]);
    expect(applied(result!.model).emissionProblems).toEqual([]);
  });

  it("setGroupKind translates an arc's degrees with the arc's own gap", () => {
    // Sweep 100 at 3 players is a 50 degree gap. 12 / 50 is 24 percent.
    const { model, groupId } = perPlayerArc({ sweep: 100 });
    const jittered = setGroupJitter(model, groupId, "deg", 12);
    const result = setGroupKind(jittered, groupId, "line", 3, parse, null)!;
    const group = result.model.groups.find((g) => g.id === groupId)!;
    const param = result.model.randomParams.find(
      (p) => p.id === group.jitter!.param,
    )!;
    expect(group.jitter?.unit).toBe("percent");
    expect(param.max).toBe(24);
  });

  // 1 degree of a 100 / 7 degree gap is exactly 7 percent. Dividing by the
  // gap first gives 6.999..., which rounds down to 6.
  it("keeps a whole percent whole, dividing once at the end", () => {
    const { model, groupId } = perPlayerArc({ sweep: 100 });
    const group = model.groups.find((g) => g.id === groupId)!;
    expect(degreesAsPercentOfGap(group, 1, 8)).toBe(7);
  });

  it("never translates to less than 1 percent, and leaves percent jitter alone", () => {
    const tiny = jitteredCircle(1);
    const toLine = setGroupKind(
      tiny.model,
      tiny.groupId,
      "line",
      2,
      parse,
      null,
    )!;
    const param = toLine.model.randomParams.find(
      (p) => p.id === toLine.model.groups[0]!.jitter!.param,
    )!;
    // 1 / 180 is under one percent.
    expect(param.max).toBe(1);

    const { model, groupId } = perPlayerArc();
    const pct = setGroupJitter(model, groupId, "percent", 30);
    const kept = setGroupKind(pct, groupId, "line", 5, parse, null)!.model;
    expect(kept.groups[0]!.jitter?.unit).toBe("percent");
    expect(kept.randomParams).toEqual(pct.randomParams);
  });
});

// Doc section 6. A drag on a per player member declines, since the emitter
// replaces its angle, and on a line its radius too.
describe("what a drag on a per player member may not write", () => {
  it("Angle on an arc, Radius and Angle on a line, nothing once per player is off", () => {
    const arc = perPlayerArc();
    expect(
      perPlayerForcedLabels(arc.model, arc.model.groups[0]!.members[0]!),
    ).toEqual(["Angle"]);
    const line = perPlayerLine();
    expect(
      perPlayerForcedLabels(line.model, line.model.groups[0]!.members[0]!),
    ).toEqual(["Radius", "Angle"]);
    const off = applyGroupEdit(
      line.model,
      line.groupId,
      { perPlayer: false },
      parse,
      null,
    )!.model;
    expect(perPlayerForcedLabels(off, off.groups[0]!.members[0]!)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Slice C, the perimeter kinds. A member's radius and angle both move with
// the count, so it gets RAD and DEG cells. A jittered member walks the
// perimeter at runtime and turns its corners (doc 5.4).
// ---------------------------------------------------------------------------

/** A per player shape of any kind, built the way the panel builds one, the kind picked first and the box ticked after. */
function perPlayerShape(
  opts: {
    kind?: ShapeGroup["kind"];
    sides?: number;
    radius?: number;
    rotation?: number;
    slots?: number;
    shift?: number;
  } = {},
): { model: AlpModel; groupId: string } {
  const {
    kind = "square",
    sides,
    radius = 30,
    rotation = 0,
    slots = 1,
    shift,
  } = opts;
  const base: AlpModel = {
    v: 1,
    placements: [],
    roles: [role()],
    randomParams: [],
    groups: [],
  };
  const ring = addRing(base, "player");
  const groupId = ring.groupId;
  let model = applyGroupEdit(
    ring.model,
    groupId,
    {
      kind,
      ...(sides !== undefined ? { sides } : {}),
      radius: num(radius),
      rotation: num(rotation),
    },
    parse,
    null,
  )!.model;
  for (let s = 1; s < slots; s++)
    model = addPatternSlot(model, groupId, "player", parse, null)!.model;
  if (shift !== undefined) {
    const pattern = model.groups[0]!.pattern.map((s, j) =>
      j === 0 ? { ...s, perimeterShift: shift } : s,
    );
    model = applyGroupEdit(model, groupId, { pattern }, parse, null)!.model;
  }
  const ticked = applyGroupEdit(
    model,
    groupId,
    { perPlayer: true, repeats: 8 },
    parse,
    null,
  );
  expect(ticked).not.toBeNull();
  return { model: ticked!.model, groupId };
}

/**
 * The true point on a regular polygon's perimeter, `walk` laps round, in
 * real trigonometry. Side 0's midpoint sits on the rotation ray (Sec.4.5),
 * so corner `c` is at bearing `rotation + (c - 0.5) × 360 / sides`, and a
 * walk of `1 / (2 × sides)` is that midpoint. A negative walk, or one past
 * a lap, reads correctly because the corners repeat every lap.
 */
function perimeterPoint(
  sides: number,
  radius: number,
  rotation: number,
  walk: number,
): { x: number; y: number } {
  const scaled = walk * sides;
  const k = Math.floor(scaled);
  const f = scaled - k;
  const corner = (c: number) => {
    const a = ((rotation + ((c - 0.5) * 360) / sides) * Math.PI) / 180;
    return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
  };
  const a = corner(k);
  const b = corner(k + 1);
  return { x: 50 + a.x + (b.x - a.x) * f, y: 50 + a.y + (b.y - a.y) * f };
}

/**
 * `text` with each player's jitter draw fixed to `draws[p - 1]`, so a test
 * picks the draw instead of a seed. Each `rnd` line must match exactly once
 * (CLAUDE.md, a text substitution asserts its match is unique).
 */
function withDraws(text: string, draws: readonly number[]): string {
  let out = text;
  draws.forEach((draw, k) => {
    const pattern = new RegExp(
      `^#const (ALP_PARAM_JITTER_\\w+_P${k + 1}) rnd\\(-?\\d+,-?\\d+\\)$`,
      "gm",
    );
    expect(out.match(pattern)).toHaveLength(1);
    out = out.replace(pattern, `#const $1 ${draw}`);
  });
  return out;
}

/** Each member's X and Y as the preview resolves them, at `count` players. */
function previewPositions(
  model: AlpModel,
  groupId: string,
  text: string,
  count: number,
): { x: number; y: number }[] {
  const emission = emitAlpModel(model, new NameAllocator(), new Map(), count);
  if (!emission.ok) throw new Error("emission failed");
  const symbols = instantiateScript(
    parseRms(text, lang),
    refDb,
    { playerCount: count, mapSize: "Normal", teams: [] },
    1,
  ).symbols;
  const group = model.groups.find((g) => g.id === groupId)!;
  return group.members.slice(0, count * group.pattern.length).map((id) => {
    const q = emission.quantities.get(id)!;
    const x = symbols.get(q.xName);
    const y = symbols.get(q.yName);
    if (x === undefined || y === undefined)
      throw new Error(`${id} did not resolve in the preview`);
    return { x, y };
  });
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Doc 5.4's measured worst case at radius 30, the sine macro's own cost for a side count that divides 360. */
const WALK_ERROR_DIVIDES_360 = 0.052;
/** The same for 7 and 11 sides, whose side midpoints fall between whole degrees. */
const WALK_ERROR_ODD_SIDES = 0.28;

describe("a per player square re-spaces round its perimeter at every count", () => {
  it.each([1, 4, 8])("matches perimeterPolar at %i players", (count) => {
    const { model } = perPlayerShape({ rotation: 10 });
    const expected = Array.from({ length: count }, (_, m) =>
      perimeterPolar(4, count, m),
    );
    const emission = emitAlpModel(model, new NameAllocator(), new Map(), count);
    expect(emission.ok).toBe(true);
    if (!emission.ok) return;
    expected.forEach(({ radiusScale, bearingDegrees }, m) => {
      expect(emission.resolved.get(`ALP_DEG_P${m + 1}`)).toBe(
        10 + bearingDegrees,
      );
      expect(emission.resolved.get(`ALP_RAD_P${m + 1}`)).toBeCloseTo(
        30 * radiusScale,
        9,
      );
    });
    if (count >= 2) {
      const text = applied(model, count).text;
      const deg = previewCells(text, "DEG", count);
      const rad = previewCells(text, "RAD", count);
      expected.forEach(({ radiusScale, bearingDegrees }, m) => {
        expect(deg.get(`ALP_DEG_P${m + 1}`)).toBe(10 + bearingDegrees);
        expect(rad.get(`ALP_RAD_P${m + 1}`)).toBeCloseTo(30 * radiusScale, 9);
      });
    }
  });

  it.each([
    ["triangle", 3, undefined],
    ["polygon", 7, 7],
  ] as const)(
    "a per player %s matches perimeterPolar too",
    (kind, sides, s) => {
      const { model } = perPlayerShape({ kind, sides: s, slots: 2 });
      const text = applied(model, 3).text;
      const deg = previewCells(text, "DEG", 3);
      const rad = previewCells(text, "RAD", 3);
      const slotIds = model.groups[0]!.pattern.map((p) => p.id.toUpperCase());
      for (let i = 0; i < 3; i++)
        slotIds.forEach((slot, j) => {
          const { radiusScale, bearingDegrees } = perimeterPolar(
            sides,
            6,
            i * 2 + j,
          );
          expect(deg.get(`ALP_DEG_P${i + 1}_${slot}`)).toBe(bearingDegrees);
          expect(rad.get(`ALP_RAD_P${i + 1}_${slot}`)).toBeCloseTo(
            30 * radiusScale,
            9,
          );
        });
    },
  );

  // An unjittered member keeps the polar form, whose whole degree bearing
  // costs up to 0.440 at radius 30 (Sec.4.5).
  it("the canvas's own X and Y cells follow the previewed count", () => {
    const { model, groupId } = perPlayerShape();
    const members = model.groups.find((g) => g.id === groupId)!.members;
    const at = (count: number) => {
      const emission = emitAlpModel(
        model,
        new NameAllocator(),
        new Map(),
        count,
      );
      if (!emission.ok) throw new Error("emission failed");
      const q = emission.quantities.get(members[1]!)!;
      return {
        x: emission.resolved.get(q.xName)!,
        y: emission.resolved.get(q.yName)!,
      };
    };
    // Member 1 of 2 sits at the midpoint of side 2, and member 1 of 8 on
    // the corner between sides 0 and 1.
    expect(
      distance(at(2), perimeterPoint(4, 30, 0, 1 / 2 + 1 / 8)),
    ).toBeLessThan(0.45);
    expect(
      distance(at(8), perimeterPoint(4, 30, 0, 1 / 8 + 1 / 8)),
    ).toBeLessThan(0.45);
  });
});

describe("a jittered per player square walks its perimeter", () => {
  function jitteredSquare(amount: number, opts: { shift?: number } = {}) {
    const { model, groupId } = perPlayerShape(opts);
    return {
      model: setGroupJitter(model, groupId, "percent", amount),
      groupId,
    };
  }

  // Doc 5.4, WALK = J / N / 100 + w0 + L. Member 1 of 4 on a square has
  // w0 = 1/4 + 1/8. At an amount of 30 the lowest walk is still positive,
  // so L is 0 and left out. At 200 it is -1/8, so one lap is added.
  it("emits one WALK line per member per branch, and adds a lap only where the lowest draw needs one", () => {
    const small = applied(jitteredSquare(30).model, 4).text;
    expect(branchLine(small, 4, "ALP_WALK_P2")).toMatch(
      /^#const ALP_WALK_P2 \(ALP_PARAM_JITTER_RING_\d+_P2 \/ 4 \/ 100 \+ 0\.375\)$/,
    );
    const large = applied(jitteredSquare(200).model, 4).text;
    expect(branchLine(large, 4, "ALP_WALK_P2")).toMatch(
      /^#const ALP_WALK_P2 \(ALP_PARAM_JITTER_RING_\d+_P2 \/ 4 \/ 100 \+ 0\.375 \+ 1\)$/,
    );
    expect(
      large.split(NL).filter((l) => /^#const ALP_WALK_P\d /.test(l)),
    ).toHaveLength(36);
  });

  it("a walked member drops its RAD cell and keeps an even DEG cell with no draw in it", () => {
    const { text } = applied(jitteredSquare(30).model, 4);
    expect(text).not.toMatch(/^#const ALP_RAD_P\d /m);
    const deg = text.split(NL).filter((l) => /^#const ALP_DEG_P\d /.test(l));
    expect(deg).toHaveLength(36);
    for (const l of deg) expect(l).not.toContain("JITTER");
    expect(previewCells(text, "DEG", 4).get("ALP_DEG_P2")).toBe(
      perimeterPolar(4, 4, 1).bearingDegrees,
    );
  });

  // Doc 5.1. One member and no neighbour leaves no gap to take a share of.
  it("leaves the draw out of a branch whose span is 0", () => {
    const { text } = applied(jitteredSquare(30).model, 4);
    expect(branchLine(text, 1, "ALP_WALK_P1")).toBe("#const ALP_WALK_P1 0.125");
  });

  // Doc section 9's acceptance. At 4 players the even gap is one whole
  // side and each land starts on a side's midpoint, half a side from
  // either corner. A draw of 30 moves 0.3 of a side and turns no corner,
  // 80 turns one, and 180 turns two.
  it("lands on the true perimeter at draws that cross no corner, one corner and two", () => {
    const { model, groupId } = jitteredSquare(200);
    const draws = [30, 80, 180, -80];
    const text = withDraws(applied(model, 4).text, draws);
    const got = previewPositions(model, groupId, text, 4);
    draws.forEach((draw, m) => {
      const walk = m / 4 + 1 / 8 + draw / 4 / 100;
      expect(
        distance(got[m]!, perimeterPoint(4, 30, 0, walk)),
      ).toBeLessThanOrEqual(WALK_ERROR_DIVIDES_360);
    });
  });

  // The slice's hazard (doc section 9). Member 0 starts 1/8 of a lap in,
  // so a draw of -180 walks it back 0.45 of a lap, past zero and round two
  // corners. The lap count L keeps the walk positive. Without it the
  // truncating `%` rounds the walk toward zero and the land lands on the
  // wrong side of the square (mutation-tested).
  it("a negative draw at member 0 walks backwards past zero and round two corners, and stays on the right side", () => {
    const { model, groupId } = jitteredSquare(200);
    const text = withDraws(applied(model, 4).text, [-180, 0, 0, 0]);
    const got = previewPositions(model, groupId, text, 4);
    const walk = 1 / 8 - 180 / 4 / 100;
    expect(walk).toBeLessThan(0);
    expect(
      distance(got[0]!, perimeterPoint(4, 30, 0, walk)),
    ).toBeLessThanOrEqual(WALK_ERROR_DIVIDES_360);
  });

  it("a zero draw lands at the even position within the same figure", () => {
    const { model, groupId } = jitteredSquare(200);
    const text = withDraws(applied(model, 4).text, [0, 0, 0, 0]);
    const got = previewPositions(model, groupId, text, 4);
    got.forEach((p, m) =>
      expect(
        distance(p, perimeterPoint(4, 30, 0, m / 4 + 1 / 8)),
      ).toBeLessThanOrEqual(WALK_ERROR_DIVIDES_360),
    );
  });

  // One slot, so the shift moves every player's land. A shift of -60 pulls
  // member 0's own w0 below zero before any draw, and the draw's lower
  // bound pulls it further. L covers both.
  it("a negative perimeterShift and the draw's lower bound both stay on the right side", () => {
    const { model, groupId } = jitteredSquare(50, { shift: -60 });
    const text = withDraws(applied(model, 4).text, [-50, -50, -50, -50]);
    const got = previewPositions(model, groupId, text, 4);
    expect(1 / 8 - 0.6).toBeLessThan(0);
    got.forEach((p, m) => {
      const walk = m / 4 + 1 / 8 - 0.6 - 50 / 4 / 100;
      expect(distance(p, perimeterPoint(4, 30, 0, walk))).toBeLessThanOrEqual(
        WALK_ERROR_DIVIDES_360,
      );
    });
  });

  it.each([
    ["triangle", 3, undefined, WALK_ERROR_DIVIDES_360],
    ["polygon", 7, 7, WALK_ERROR_ODD_SIDES],
  ] as const)(
    "a jittered %s lands on its true perimeter, rotated, round its corners",
    (kind, sides, s, bound) => {
      const { model: plain, groupId } = perPlayerShape({
        kind,
        sides: s,
        rotation: 25,
      });
      const model = setGroupJitter(plain, groupId, "percent", 250);
      const draws = [-240, 90, 240];
      const text = withDraws(applied(model, 3).text, draws);
      const got = previewPositions(model, groupId, text, 3);
      draws.forEach((draw, m) => {
        const walk = m / 3 + 1 / (2 * sides) + draw / 3 / 100;
        expect(
          distance(got[m]!, perimeterPoint(sides, 30, 25, walk)),
        ).toBeLessThanOrEqual(bound);
      });
    },
  );

  it("the cross check cells carry every player's WALK cell, the live cells only the previewed count's", () => {
    const g: ShapeGroup = {
      id: "sq",
      parent: "center",
      kind: "square",
      pattern: [{ id: "P", role: "player" }],
      repeats: 8,
      radius: num(30),
      rotation: num(0),
      frame: "radial",
      members: Array.from({ length: 8 }, (_, i) => `sq#${i}#P`),
      perPlayer: true,
      jitter: { param: "J", unit: "percent" },
    };
    const placements: Placement[] = expandShapeGroup(g).placements;
    const resolver = (e: Expr, owner: number | undefined): Expr =>
      e.k === "param" ? sym(`J_P${owner}`) : e;
    const result = buildPrologue(
      [g],
      placements,
      new Map(),
      new NameAllocator(),
      3,
      resolver,
      new Map([["sq", -20]]),
    );
    const walk = (cells: { name: string }[]) =>
      cells.map((c) => c.name).filter((n) => n.startsWith("ALP_WALK_"));
    expect(walk(result.crossCheckDegCells)).toEqual(
      Array.from({ length: 8 }, (_, i) => `ALP_WALK_P${i + 1}`),
    );
    expect(walk(result.liveDegCells)).toEqual([
      "ALP_WALK_P1",
      "ALP_WALK_P2",
      "ALP_WALK_P3",
    ]);
    expect(result.radiusOverrides.size).toBe(0);
    expect([...result.walks.keys()]).toEqual(g.members);
  });

  // The canvas draws from the emission's resolved table, where a draw
  // stands in at its range's midpoint, 0 for rnd(-a,a).
  it("the canvas draws each walked land at its even position for the previewed count", () => {
    const { model, groupId } = jitteredSquare(40);
    const members = model.groups.find((g) => g.id === groupId)!.members;
    for (const count of [3, 8]) {
      const emission = emitAlpModel(
        model,
        new NameAllocator(),
        new Map(),
        count,
      );
      if (!emission.ok) throw new Error("emission failed");
      for (let m = 0; m < count; m++) {
        const q = emission.quantities.get(members[m]!)!;
        const p = {
          x: emission.resolved.get(q.xName)!,
          y: emission.resolved.get(q.yName)!,
        };
        expect(
          distance(p, perimeterPoint(4, 30, 0, m / count + 1 / 8)),
        ).toBeLessThanOrEqual(WALK_ERROR_DIVIDES_360);
      }
    }
  });

  // Doc 5.4. A radial child takes its origin from the walked position and
  // its angle base from the member's even bearing.
  it("a chained radial child hangs off the walked position, turned by the even bearing", () => {
    const { model: plain, groupId } = perPlayerShape();
    const slotId = plain.groups[0]!.pattern[0]!.id;
    const chained = addChainTemplate(
      plain,
      groupId,
      slotId,
      "player",
      parse,
      null,
    )!.model;
    const model = setGroupJitter(chained, groupId, "percent", 200);
    const text = withDraws(applied(model, 4).text, [80, 0, 0, 0]);
    const emission = emitAlpModel(model, new NameAllocator(), new Map(), 4);
    if (!emission.ok) throw new Error("emission failed");
    const symbols = instantiateScript(
      parseRms(text, lang),
      refDb,
      { playerCount: 4, mapSize: "Normal", teams: [] },
      1,
    ).symbols;
    const parentId = model.groups[0]!.members[0]!;
    const childId = model.groups[0]!.chainMembers![0]!;
    const xy = (id: string) => {
      const q = emission.quantities.get(id)!;
      return { x: symbols.get(q.xName)!, y: symbols.get(q.yName)! };
    };
    const parent = xy(parentId);
    expect(
      distance(parent, perimeterPoint(4, 30, 0, 1 / 8 + 0.2)),
    ).toBeLessThanOrEqual(WALK_ERROR_DIVIDES_360);
    // The template sits 14 out at angle 0 in a radial frame, so it points
    // back along the parent's even bearing, 0 here, toward the anchor.
    const child = xy(childId);
    expect(child.x - parent.x).toBeCloseTo(-14, 1);
    expect(child.y - parent.y).toBeCloseTo(0, 1);
  });
});

describe("which lands of a jittered per player square walk", () => {
  it("a nudged member keeps its polar position and takes no walk", () => {
    const { model, groupId } = perPlayerShape();
    const p2 = model.groups.find((g) => g.id === groupId)!.members[1]!;
    const nudged = applyDragToPlacement(model, p2, {
      kind: "polar",
      r: num(20),
      theta: num(33),
    });
    const { text } = applied(setGroupJitter(nudged, groupId, "percent", 20), 3);
    expect(text).not.toMatch(/^#const ALP_WALK_P2 /m);
    expect(text).toMatch(/^#const ALP_WALK_P1 /m);
    expect(previewCells(text, "RAD", 3).get("ALP_RAD_P2")).toBe(20);
    expect(previewCells(text, "DEG", 3).get("ALP_DEG_P2")).toBe(33);
  });

  // The owner's call (2026-09-29, doc section 3 decision 9). The walk is
  // written once, outside the count branches, so it cannot give way to a
  // fixed angle at one count only. A land holding any per count angle
  // takes no walk at any count, and the override keeps working.
  it("a member with a per count angle takes no walk at any count, and its override still applies", () => {
    const { model: circle, groupId } = perPlayerShape({ kind: "circle" });
    const p2 = circle.groups[0]!.members[1]!;
    const overridden = setThetaPerCountOverride(circle, p2, 4, num(77));
    const square = setGroupKind(
      overridden,
      groupId,
      "square",
      4,
      parse,
      null,
    )!.model;
    expect(square.placements.find((p) => p.id === p2)!.thetaPerCount).toEqual({
      4: num(77),
    });
    const { text } = applied(setGroupJitter(square, groupId, "percent", 20), 4);
    expect(text).not.toMatch(/^#const ALP_WALK_P2 /m);
    expect(text).toMatch(/^#const ALP_WALK_P1 /m);
    expect(previewCells(text, "DEG", 4).get("ALP_DEG_P2")).toBe(77);
    expect(previewCells(text, "RAD", 4).get("ALP_RAD_P2")).toBeCloseTo(
      30 * perimeterPolar(4, 4, 1).radiusScale,
      9,
    );
  });

  it("refuses degrees with the jitterUnit problem, since a perimeter has no angle along it", () => {
    const { model, groupId } = perPlayerShape();
    const jittered = setGroupJitter(model, groupId, "percent", 20);
    const forced: AlpModel = {
      ...jittered,
      groups: jittered.groups.map((g) => ({
        ...g,
        jitter: { ...g.jitter!, unit: "deg" },
      })),
    };
    expect(applied(forced).emissionProblems.map((p) => p.name)).toEqual([
      `group:${groupId}:jitterUnit`,
    ]);
  });

  it("setGroupKind translates a circle's degrees when it becomes a square", () => {
    // 4 players, one slot, gap 90 degrees. 12 / 90 is 13.3 percent, down to 13.
    const { model: circle, groupId } = perPlayerShape({ kind: "circle" });
    const jittered = setGroupJitter(circle, groupId, "deg", 12);
    const result = setGroupKind(jittered, groupId, "square", 4, parse, null)!;
    const group = result.model.groups.find((g) => g.id === groupId)!;
    expect(group.kind).toBe("square");
    expect(group.jitter?.unit).toBe("percent");
    const param = result.model.randomParams.find(
      (p) => p.id === group.jitter!.param,
    )!;
    expect([param.min, param.max]).toEqual([-13, 13]);
    expect(applied(result.model).emissionProblems).toEqual([]);
  });

  it("a drag on a per player square member may write neither Radius nor Angle", () => {
    const { model } = perPlayerShape();
    expect(perPlayerForcedLabels(model, model.groups[0]!.members[0]!)).toEqual([
      "Radius",
      "Angle",
    ]);
  });
});

// Doc section 8 asked slice C to measure the fence size rather than
// estimate it. One slot, so 36 member instances across the eight branches.
describe("what a per player square costs, measured", () => {
  const constLines = (model: AlpModel) =>
    applied(model)
      .text.split(NL)
      .filter((l) => l.startsWith("#const")).length;

  it("an unjittered square adds one RAD line per member per branch to the circle", () => {
    const circle = perPlayerShape({ kind: "circle" }).model;
    const square = perPlayerShape({ kind: "square" }).model;
    expect(constLines(square) - constLines(circle)).toBe(36);
  });

  it("a jittered square adds 36 WALK lines and 17 walk lines per member to a jittered circle", () => {
    const c = perPlayerShape({ kind: "circle" });
    const s = perPlayerShape({ kind: "square" });
    const circle = setGroupJitter(c.model, c.groupId, "percent", 30);
    const square = setGroupJitter(s.model, s.groupId, "percent", 30);
    expect(constLines(square) - constLines(circle)).toBe(36 + 17 * 8);
  });
});
