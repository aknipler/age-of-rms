// Sec.4.5's merge rule, and slice-3 item 5's acceptance: "tests for reorder,
// slot insertion, slot deletion, repeats up, repeats down, and the
// shrink->grow non-round-trip. The delta case and the release-vs-delete
// branch each need their own test."

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import type { ParseResult } from "../../../../parser/types";
import { evalExpr, num, sym } from "../compiler/expr";
import { expandShapeGroup } from "../expand";
import { perimeterPolar } from "../perimeterOffset";
import { reExpand } from "../reExpand";
import type { Placement, ShapeGroup } from "../model";

const closed = { resolveSym: () => undefined, resolveParam: () => undefined };

const lang = loadLanguage();

function emptyParse(source = ""): ParseResult {
  return parseRms(source, lang);
}

function group(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
  return {
    id: "G",
    parent: "center",
    kind: "circle",
    pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }, { id: "B", role: "role-B" }],
    repeats: 3,
    radius: num(26),
    rotation: num(0),
    frame: "radial",
    members: [],
    perPlayer: false,
    ...overrides,
  };
}

/** Runs a fresh group through its own expansion to get a realistic starting `members`/placements pair, as the panel would after first creating it. */
function seed(g: ShapeGroup): { group: ShapeGroup; placements: Placement[] } {
  const { placements, members } = expandShapeGroup(g);
  return { group: { ...g, members }, placements };
}

const noNames = () => [] as readonly string[];

describe("reExpand — matching and the ordering it depends on", () => {
  it("reorder: [P, A, B] -> [P, B, A] keeps every land in place, matched by (repeatIndex, slotId) not by position", () => {
    const { group: oldGroup, placements } = seed(group());
    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }, { id: "B", role: "role-B" }, { id: "A", role: "role-A" }] };

    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    // Same 9 ids, just recomputed offsets (nothing nudged), the reorder
    // moved the ANGLE FORMULA'S j-index, not the land identities.
    expect(new Set(result.members)).toEqual(new Set(oldGroup.members));
    expect(result.report.recomputedIds).toHaveLength(9);
    expect(result.report.addedIds).toEqual([]);
    expect(result.report.deletedIds).toEqual([]);
    expect(result.report.releasedIds).toEqual([]);
  });

  it("slot insertion: [P, A, B] -> [P, A, X, B] adds new members and keeps the three originals", () => {
    const { group: oldGroup, placements } = seed(group());
    const newGroup: ShapeGroup = {
      ...oldGroup,
      pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }, { id: "X", role: "role-X" }, { id: "B", role: "role-B" }],
    };

    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    expect(result.report.recomputedIds).toHaveLength(9); // the 3 original slots x 3 repeats
    expect(result.report.addedIds).toHaveLength(3); // the new X slot x 3 repeats
    expect(result.members).toHaveLength(12);
    expect(result.report.deletedIds).toEqual([]);
    expect(result.report.releasedIds).toEqual([]);
  });

  it("slot deletion: [P, A, B] -> [P, B] releases or deletes A's members, and reports which", () => {
    const { group: oldGroup, placements } = seed(group());
    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }, { id: "B", role: "role-B" }] };

    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    expect(result.report.recomputedIds).toHaveLength(6); // P and B across 3 repeats
    expect(result.report.deletedIds.length + result.report.releasedIds.length).toBe(3); // the 3 A members
    expect(result.members).toHaveLength(6);
  });
});

describe("reExpand — repeats up/down", () => {
  it("repeats up (3 -> 4) adds a whole new repeat's worth of members", () => {
    const { group: oldGroup, placements } = seed(group());
    const newGroup: ShapeGroup = { ...oldGroup, repeats: 4 };
    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);
    expect(result.report.addedIds).toHaveLength(3);
    expect(result.report.recomputedIds).toHaveLength(9);
    expect(result.members).toHaveLength(12);
  });

  it("repeats down (3 -> 2) leaves the third repeat's members to release-or-delete", () => {
    const { group: oldGroup, placements } = seed(group());
    const newGroup: ShapeGroup = { ...oldGroup, repeats: 2 };
    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);
    expect(result.report.deletedIds.length + result.report.releasedIds.length).toBe(3);
    expect(result.members).toHaveLength(6);
  });

  it("shrink -> grow is NOT a round trip: a RELEASED member survives untouched, and regrowth adds a genuinely fresh one rather than re-adopting it", () => {
    const parse = emptyParse();
    const { group: g0, placements: p0 } = seed(group());
    // Nudge repeat-2's P so its departure releases rather than deletes it,
    // deletion removes the old id outright, which would make "does regrowth
    // reuse it" trivially true for the wrong reason (nothing there to
    // collide with). Release is the branch consequence 1 is actually about:
    // stale, customised data still sitting on the map.
    const p2Id = g0.members[2 * 3 + 0]; // repeat 2, slot P (pattern length 3)
    const nudgedP0 = p0.map((p) => (p.id === p2Id ? { ...p, nudged: true } : p));

    const shrunk = reExpand(g0, { ...g0, repeats: 2 }, nudgedP0, parse, noNames);
    expect(shrunk.report.releasedIds).toEqual([p2Id]);

    const grown = reExpand({ ...g0, repeats: 2, members: shrunk.members }, g0, shrunk.placements, parse, noNames);

    // The released placement is untouched and still on the map...
    const stillThere = grown.placements.find((p) => p.id === p2Id);
    expect(stillThere).toBeDefined();
    expect(stillThere!.nudged).toBe(true);
    // ...AND a fresh member fills repeat 2's P slot again, under a
    // DIFFERENT id, re-adoption is rejected (Sec.4.5 consequence 1: "leaves
    // the two released members on the map PLUS two fresh ones at the same
    // keys"), so growth must not silently merge the two.
    expect(grown.report.addedIds).toHaveLength(3);
    expect(grown.report.addedIds).not.toContain(p2Id);
    const fresh = grown.placements.find((p) => grown.report.addedIds.includes(p.id) && p.label.endsWith("_2_P"));
    expect(fresh).toBeDefined();
    expect(fresh!.nudged).toBeFalsy();
  });
});

describe("reExpand — the delta case (nudged, matched key)", () => {
  it("a numeric-literal nudge is re-applied as a delta against the new base, not discarded", () => {
    const { group: oldGroup, placements } = seed(group({ rotation: num(0) }));
    // Nudge P's repeat-0 offset: base is (r=26, theta=0); user dragged it to (r=30, theta=10).
    const pId = oldGroup.members[0]; // repeat 0, slot P (repeat-major, pattern order)
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(30), theta: num(10) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, rotation: num(90) }; // whole ring rotates 90 degrees
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.deltaAppliedIds).toEqual([pId]);
    const updated = result.placements.find((p) => p.id === pId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");
    // delta: (30 - 26) = +4 on r; (10 - 0) = +10 on theta, re-applied against
    // the NEW base (r=26 unchanged, theta=90): r=30, theta=100.
    expect(updated.offset.r).toEqual(num(30));
    expect(updated.offset.theta).toEqual(num(100));
  });

  it("a nudge that is a hand-typed formula (not numeric-literal) is never rewritten — reported position-detached", () => {
    const { group: oldGroup, placements } = seed(group());
    const pId = oldGroup.members[0];
    const nudged = placements.map((p) =>
      p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(26), theta: sym("SOME_CUSTOM_CONST") }, nudged: true } : p,
    );

    const newGroup: ShapeGroup = { ...oldGroup, rotation: num(90) };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.positionDetachedIds).toEqual([pId]);
    expect(result.report.deltaAppliedIds).toEqual([]);
    const untouched = result.placements.find((p) => p.id === pId)!;
    if (untouched.offset.kind !== "polar") throw new Error("expected polar");
    expect(untouched.offset.theta).toEqual(sym("SOME_CUSTOM_CONST"));
  });
});

describe("reExpand — a kind change (shape-kinds-slice-a-brief.md item 2: circle, line and arc are all polar)", () => {
  it("circle -> line keeps a nudged member on the delta branch and recomputes the rest", () => {
    const { group: oldGroup, placements } = seed(group({ rotation: num(0) }));
    const pId = oldGroup.members[0]; // repeat 0, slot P
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(30), theta: num(10) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, kind: "line" };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    // Neither `reExpand.ts` nor `expand.ts`'s dispatch needed a new offset
    // kind for this: circle and line both produce `polar` members, so the
    // existing delta branch (no edit this slice) picks the nudged member up
    // exactly the way a rotation-only edit already does.
    expect(result.report.deltaAppliedIds).toEqual([pId]);
    expect(result.report.recomputedIds).toHaveLength(8);
    expect(result.report.positionDetachedIds).toEqual([]);

    const updated = result.placements.find((p) => p.id === pId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");
    expect(updated.offset.r.k).not.toBe("bin"); // still a folded literal, not left symbolic
  });
});

describe("reExpand — release vs delete (Sec.4.5's condition 3)", () => {
  it("releases (does not delete) a departing member that still has a child chained off it", () => {
    const { group: oldGroup, placements } = seed(group({ repeats: 1, pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }] }));
    const aId = oldGroup.members[1]; // repeat 0, slot A
    const withChild: Placement[] = [...placements, { id: "child-of-a", parent: aId, frame: "radial", offset: { kind: "polar", r: num(5), theta: num(0) }, label: "child" }];

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }] };
    const result = reExpand(oldGroup, newGroup, withChild, emptyParse(), noNames);

    expect(result.report.releasedIds).toEqual([aId]);
    expect(result.report.deletedIds).toEqual([]);
    // Released, not deleted: the placement (and its child) survive in the document.
    expect(result.placements.some((p) => p.id === aId)).toBe(true);
    expect(result.placements.some((p) => p.id === "child-of-a")).toBe(true);
  });

  it("releases (does not delete) a departing member that is itself nudged", () => {
    const { group: oldGroup, placements } = seed(group({ repeats: 1, pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }] }));
    const aId = oldGroup.members[1];
    const withNudge = placements.map((p) => (p.id === aId ? { ...p, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }] };
    const result = reExpand(oldGroup, newGroup, withNudge, emptyParse(), noNames);

    expect(result.report.releasedIds).toEqual([aId]);
    expect(result.report.deletedIds).toEqual([]);
    expect(result.placements.some((p) => p.id === aId)).toBe(true);
  });

  it("releases (does not delete) a departing member whose constants are still referenced OUTSIDE the fence", () => {
    const { group: oldGroup, placements } = seed(group({ repeats: 1, pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }] }));
    const aId = oldGroup.members[1];
    // auditConstants only tracks USES of a name it has also seen DEFINED
    // (constantsAuditor.ts's byName.get(...)?.useSpans), so the fixture needs
    // a definition too, standing in for the tool's own emitted #const,
    // exactly as if a previous Apply had already written it.
    const parse = emptyParse(`#const ALP_X_A 1\n#const ALP_Y_A 1\ncreate_land\n{\nland_position ALP_X_A ALP_Y_A\n}\n`);

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }] };
    const result = reExpand(oldGroup, newGroup, placements, parse, (id) => (id === aId ? ["ALP_X_A", "ALP_Y_A"] : []));

    expect(result.report.releasedIds).toEqual([aId]);
    expect(result.report.deletedIds).toEqual([]);
  });

  it("deletes a departing member with no child, no nudge, and no reference outside the fence", () => {
    const { group: oldGroup, placements } = seed(group({ repeats: 1, pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }] }));
    const aId = oldGroup.members[1];

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }] };
    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    expect(result.report.deletedIds).toEqual([aId]);
    expect(result.report.releasedIds).toEqual([]);
    expect(result.placements.some((p) => p.id === aId)).toBe(false);
  });

  it("a use of the constants INSIDE the fence does not block deletion (the circularity Sec.4.5 warns against)", () => {
    const { group: oldGroup, placements } = seed(group({ repeats: 1, pattern: [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }] }));
    const aId = oldGroup.members[1];
    const source = `/* @alp v1 begin — x.\n   @alp-model {"v":1,"placements":[],"roles":[],"randomParams":[],"groups":[]} */\n#const ALP_X_A 1\ncreate_land\n{\nland_position ALP_X_A ALP_X_A\n}\n/* @alp end */\n`;
    const parse = emptyParse(source);

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P" }] };
    const result = reExpand(oldGroup, newGroup, placements, parse, (id) => (id === aId ? ["ALP_X_A"] : []));

    // The only use of ALP_X_A is INSIDE the fence (the create_land the tool
    // itself just wrote there), that must not count against deletion.
    expect(result.report.deletedIds).toEqual([aId]);
  });
});

// perimeter-symbolic-rotation-slice-a-brief.md item 2/escalation Sec.8.3: no
// group expansion produces a `cartesian` offset any more, square/triangle/
// polygon included, so this describe block is no longer "a perimeter kind's
// own delta case" (its old title) — it exercises a STANDALONE, hand-authored
// `cartesian` placement, still a real, reachable case outside any
// `ShapeGroup`.
describe("reExpand — the cartesian delta branch (a standalone cartesian placement, not a perimeter kind)", () => {
  function squareGroup(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
    return group({ kind: "square", pattern: [{ id: "P", role: "role-P" }], repeats: 4, ...overrides });
  }

  it("a repeat-count edit on a square with a member STILL carrying a stale cartesian nudge (a model saved before this slice) reports positionDetached, not a delta — hazard 3's accepted migration consequence", () => {
    const { group: oldGroup, placements } = seed(squareGroup());
    const pId = oldGroup.members[0];
    // A pre-slice-A save: the member's offset is still cartesian, though a
    // fresh expansion of ANY group now produces polar (item 2).
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "cartesian" as const, dx: num(5), dy: num(-3) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, repeats: 8 };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    // MIXED pair (old cartesian, fresh polar): detached, not silently
    // reinterpreted — the member keeps its stale position exactly.
    expect(result.report.positionDetachedIds).toEqual([pId]);
    expect(result.report.deltaAppliedIds).toEqual([]);
    expect(result.report.addedIds).toHaveLength(4); // 8 - 4 new members
    const untouched = result.placements.find((p) => p.id === pId)!;
    expect(untouched.offset).toEqual({ kind: "cartesian", dx: num(5), dy: num(-3) });
  });

  // Sec.8.6's ripple: since every kind is polar now, a KIND change (circle
  // to square, or any pair) is no longer a kind MISMATCH the way
  // cartesian-vs-polar was — a nudged polar member takes the ordinary delta
  // branch across it, the same as a repeats/radius edit. This used to
  // detach (the old cartesian-shaped square meant the pair was mixed); now
  // it does not, because there is no cartesian shape on the fresh side to
  // mismatch against.
  it("a circle-to-square kind change on a nudged (fully-numeric) polar member now takes the ordinary polar delta branch — every kind is polar, so this is no longer a MIXED pair", () => {
    const { group: oldGroup, placements } = seed(group()); // kind: "circle"
    const pId = oldGroup.members[0];
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(30), theta: num(10) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, kind: "square" };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.deltaAppliedIds).toEqual([pId]);
    expect(result.report.positionDetachedIds).toEqual([]);
    const updated = result.placements.find((p) => p.id === pId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");

    // oldBase (circle, member 0 of 9): r=26, theta=0. Nudge: r=30, theta=10
    // — a delta of (+4, +10), reapplied onto the fresh square base (member
    // 0 of 9, at square's own M=4).
    const { radiusScale, bearingDegrees } = perimeterPolar(4, 9, 0);
    expect(evalExpr(updated.offset.r, closed)).toBeCloseTo(26 * radiusScale + 4, 5);
    expect(evalExpr(updated.offset.theta, closed)).toBeCloseTo(bearingDegrees + 10, 5);
  });

  it("an UNnudged member across a repeat-count edit recomputes wholesale, same as the polar branch", () => {
    const { group: oldGroup, placements } = seed(squareGroup());
    const newGroup: ShapeGroup = { ...oldGroup, repeats: 8 };
    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    expect(result.report.recomputedIds).toHaveLength(4);
    expect(result.report.positionDetachedIds).toEqual([]);
  });

  it("a stale hand-typed formula-shaped cartesian nudge is never rewritten — reported position-detached (a MIXED pair against the now-polar fresh side, same outcome the non-numeric guard used to produce on its own)", () => {
    const { group: oldGroup, placements } = seed(squareGroup());
    const pId = oldGroup.members[0];
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "cartesian" as const, dx: sym("SOME_CONST"), dy: num(0) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, repeats: 8 };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.positionDetachedIds).toEqual([pId]);
    expect(result.report.deltaAppliedIds).toEqual([]);
    const untouched = result.placements.find((p) => p.id === pId)!;
    if (untouched.offset.kind !== "cartesian") throw new Error("expected cartesian");
    expect(untouched.offset.dx).toEqual(sym("SOME_CONST"));
  });
});

// shape-kinds-slice-c-brief.md item 1's own acceptance: "a sides change on
// a group with one nudged member keeps that member on the delta branch."
// Since perimeter-symbolic-rotation-slice-a-brief.md item 2, a fresh nudge
// is polar (there is no cartesian group member any more), so the branch
// that now does this job is the ordinary polar delta branch, not the
// cartesian one — the generic branch above still exists for a STALE
// pre-slice-A cartesian nudge, which detaches instead (hazard 3).
describe("reExpand — a sides change on a polygon (shape-kinds-slice-c-brief.md item 1, updated for perimeter-symbolic-rotation-slice-a-brief.md item 2)", () => {
  function polygonGroup(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
    return group({ kind: "polygon", sides: 5, pattern: [{ id: "P", role: "role-P" }], repeats: 4, ...overrides });
  }

  it("keeps a nudged (polar) member on the ordinary delta branch and recomputes the rest", () => {
    const { group: oldGroup, placements } = seed(polygonGroup());
    const pId = oldGroup.members[0];
    // A nudge made AFTER this slice: the member's offset is polar, exactly
    // what a real drag (dragMath.ts's own absorb path) would produce.
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(20), theta: num(7) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, sides: 8 };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.deltaAppliedIds).toEqual([pId]);
    expect(result.report.positionDetachedIds).toEqual([]);
    const updated = result.placements.find((p) => p.id === pId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");
    expect(updated.offset.r.k).toBe("num");
    expect(updated.offset.theta.k).toBe("num");
  });

  it("a STALE cartesian-shaped nudge (a model saved before this slice) reports positionDetached instead — hazard 3's accepted migration consequence, the same as square's own case", () => {
    const { group: oldGroup, placements } = seed(polygonGroup());
    const pId = oldGroup.members[0];
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "cartesian" as const, dx: num(5), dy: num(-3) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, sides: 8 };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.positionDetachedIds).toEqual([pId]);
    expect(result.report.deltaAppliedIds).toEqual([]);
    const untouched = result.placements.find((p) => p.id === pId)!;
    expect(untouched.offset).toEqual({ kind: "cartesian", dx: num(5), dy: num(-3) });
  });
});

// perimeter-symbolic-rotation-slice-b-brief.md item 4's own instruction:
// "changing a slot's shift is a group edit, so a NON-nudged member follows
// it and a NUDGED member takes the polar delta path and keeps its own
// offset. Two tests, one each." Both members are polar throughout (this is
// a group-level `pattern` edit, not a kind change), so neither hits the
// MIXED/detach branch — the shift only ever moves which BASE the delta (for
// a nudged member) or the wholesale recompute (for an unnudged one) starts
// from.
describe("reExpand — PatternSlot.perimeterShift (perimeter-symbolic-rotation-slice-b-brief.md item 4)", () => {
  function squareGroup(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
    return group({ kind: "square", pattern: [{ id: "P", role: "role-P" }], repeats: 4, ...overrides });
  }

  it("changing a slot's shift is a group edit: a NON-nudged member follows it, recomputed wholesale from the shifted base", () => {
    const { group: oldGroup, placements } = seed(squareGroup());
    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P", perimeterShift: 6.25 }] };
    const result = reExpand(oldGroup, newGroup, placements, emptyParse(), noNames);

    expect(result.report.recomputedIds).toHaveLength(4);
    expect(result.report.deltaAppliedIds).toEqual([]);
    expect(result.report.positionDetachedIds).toEqual([]);
    const updated = result.placements.find((p) => p.id === oldGroup.members[0])!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");
    const { radiusScale, bearingDegrees } = perimeterPolar(4, 4, 0, 6.25);
    expect(evalExpr(updated.offset.r, closed)).toBeCloseTo(26 * radiusScale, 5);
    expect(evalExpr(updated.offset.theta, closed)).toBeCloseTo(bearingDegrees, 5);
  });

  it("a NUDGED member takes the ordinary polar delta branch and keeps its own offset delta — the shift only moves the BASE the delta is measured against", () => {
    const { group: oldGroup, placements } = seed(squareGroup());
    const pId = oldGroup.members[0];
    const nudged = placements.map((p) => (p.id === pId ? { ...p, offset: { kind: "polar" as const, r: num(20), theta: num(7) }, nudged: true } : p));

    const newGroup: ShapeGroup = { ...oldGroup, pattern: [{ id: "P", role: "role-P", perimeterShift: 6.25 }] };
    const result = reExpand(oldGroup, newGroup, nudged, emptyParse(), noNames);

    expect(result.report.deltaAppliedIds).toEqual([pId]);
    expect(result.report.positionDetachedIds).toEqual([]);
    const updated = result.placements.find((p) => p.id === pId)!;
    if (updated.offset.kind !== "polar") throw new Error("expected polar");

    // oldBase: member 0 of 4, UNshifted (the group the nudge was originally
    // measured against). Nudge (r=20, theta=7) is a delta of
    // (20 - 26*oldBase.radiusScale, 7 - oldBase.bearingDegrees), reapplied
    // onto the SHIFTED fresh base.
    const oldBase = perimeterPolar(4, 4, 0);
    const freshBase = perimeterPolar(4, 4, 0, 6.25);
    const deltaR = 20 - 26 * oldBase.radiusScale;
    const deltaTheta = 7 - oldBase.bearingDegrees;
    expect(evalExpr(updated.offset.r, closed)).toBeCloseTo(26 * freshBase.radiusScale + deltaR, 5);
    expect(evalExpr(updated.offset.theta, closed)).toBeCloseTo(freshBase.bearingDegrees + deltaTheta, 5);
  });
});
