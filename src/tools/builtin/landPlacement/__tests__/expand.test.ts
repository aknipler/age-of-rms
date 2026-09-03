// Slice-3 item 4 acceptance: "a [P, A, B] × 3 group expands to 9
// correctly-keyed members with integer angles; the members ordering
// invariant is asserted directly."

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../tools-api/index";
import { emitCells } from "../compiler/emit";
import { evalExpr, num, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { buildFrame } from "../frame";
import { expandShapeGroup, memberKeyAt } from "../expand";
import type { PatternSlot, ShapeGroup } from "../model";

const closed = { resolveSym: () => undefined, resolveParam: () => undefined };

function ring(pattern: PatternSlot[], repeats: number): ShapeGroup {
  return {
    id: "G",
    parent: "center",
    kind: "circle",
    pattern,
    repeats,
    radius: num(26),
    rotation: num(0),
    frame: "radial",
    members: [],
    perPlayer: false,
  };
}

/**
 * Shared by every perimeter kind's own describe block (square, triangle,
 * polygon): a member's polar offset (perimeter-symbolic-rotation-slice-a-
 * brief.md item 2 — every kind is `polar` now, including these), converted
 * to a cartesian point via REAL trigonometry, never `perimeterOffset`'s old
 * formula — the item 1 hazard warning against verifying new code by
 * agreeing with a copy of the old one pasted into the test.
 */
function evalPosition(p: { offset: { kind: string; r?: Expr; theta?: Expr } }): { dx: number; dy: number } {
  if (p.offset.kind !== "polar" || p.offset.r === undefined || p.offset.theta === undefined) throw new Error("expected polar");
  const r = evalExpr(p.offset.r, closed);
  const theta = evalExpr(p.offset.theta, closed);
  if (r === undefined || theta === undefined) throw new Error("expected a fully-closed literal");
  const rad = (theta * Math.PI) / 180;
  return { dx: r * Math.cos(rad), dy: r * Math.sin(rad) };
}

describe("expandShapeGroup — Sec.4.5", () => {
  it("[P, A, B] x 3 expands to exactly 9 members, repeat-major then pattern order", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }, { id: "B", role: "role-B" }];
    const { placements, members } = expandShapeGroup(ring(pattern, 3));

    expect(placements).toHaveLength(9);
    expect(members).toHaveLength(9);

    // The ordering invariant, asserted directly: members[k] is
    // (floor(k/3), pattern[k % 3].id).
    const expectedKeys = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => memberKeyAt(k, pattern));
    expect(expectedKeys).toEqual([
      { repeatIndex: 0, slotId: "P" },
      { repeatIndex: 0, slotId: "A" },
      { repeatIndex: 0, slotId: "B" },
      { repeatIndex: 1, slotId: "P" },
      { repeatIndex: 1, slotId: "A" },
      { repeatIndex: 1, slotId: "B" },
      { repeatIndex: 2, slotId: "P" },
      { repeatIndex: 2, slotId: "A" },
      { repeatIndex: 2, slotId: "B" },
    ]);
  });

  it("every member's angle resolves to an integer, at N=9 (a case with no fractional remainder) and N=7 (one that does)", () => {
    for (const repeats of [3, 7]) {
      const pattern: PatternSlot[] = repeats === 3 ? [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }, { id: "B", role: "role-B" }] : [{ id: "P", role: "role-P" }];
      const { placements } = expandShapeGroup(ring(pattern, repeats));
      for (const p of placements) {
        if (p.offset.kind !== "polar") throw new Error("expected a polar offset");
        const angle = evalExpr(p.offset.theta, { resolveSym: () => undefined, resolveParam: () => undefined });
        expect(Number.isInteger(angle)).toBe(true);
      }
    }
  });

  it("a symbolic rotation keeps steering every member (Sec.4.5's 'must survive a symbolic group')", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P" }, { id: "A", role: "role-A" }];
    const group: ShapeGroup = { ...ring(pattern, 2), rotation: sym("ROTATION_PLAYER") };
    const { placements } = expandShapeGroup(group);
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected a polar offset");
      const angle = evalExpr(p.offset.theta, { resolveSym: (n) => (n === "ROTATION_PLAYER" ? 40 : undefined), resolveParam: () => undefined });
      expect(angle).toBeDefined();
    }
  });

  it("PatternSlot.theta overrides the even default for one slot", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P" }, { id: "A", role: "role-A", theta: num(999) }];
    const { placements } = expandShapeGroup(ring(pattern, 2));
    const a0 = placements[1]; // repeat 0, slot A
    if (a0.offset.kind !== "polar") throw new Error("expected polar");
    const angle = evalExpr(a0.offset.theta, { resolveSym: () => undefined, resolveParam: () => undefined });
    expect(angle).toBe(999); // rotation (0) + override (999)
  });

  it("PatternSlot.radius overrides the ring radius (the 'wavy ring' case)", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P" }, { id: "A", role: "role-A", radius: num(5) }];
    const { placements } = expandShapeGroup(ring(pattern, 1));
    if (placements[0].offset.kind !== "polar" || placements[1].offset.kind !== "polar") throw new Error("expected polar");
    expect(placements[0].offset.r).toEqual(num(26));
    expect(placements[1].offset.r).toEqual(num(5));
  });

  it("an empty pattern or zero/negative repeats expands to nothing", () => {
    expect(expandShapeGroup(ring([], 3)).placements).toEqual([]);
    expect(expandShapeGroup(ring([{ id: "P", role: "role-P" }], 0)).placements).toEqual([]);
  });
});

// shape-kinds-slice-a-brief.md item 3, acceptance: line/arc geometry.
describe("expandShapeGroup — kind: line (shape-kinds-slice-a-brief.md item 3)", () => {
  function line(count: number, radius = 26): ShapeGroup {
    return { ...ring([{ id: "P", role: "role-P" }], count), kind: "line", radius: num(radius) };
  }

  it.each([1, 2, 3, 8])("N=%i is symmetric about the anchor, ends at +/- radius, member 0 at -radius", (n) => {
    const { placements } = expandShapeGroup(line(n));
    expect(placements).toHaveLength(n);
    const rs = placements.map((p) => {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      const v = evalExpr(p.offset.r, closed);
      if (v === undefined) throw new Error("expected a fully-closed literal");
      return v;
    });
    if (n === 1) {
      // model.ts's own doc comment: a one-member line sits at the anchor,
      // not at either end — this is the degenerate case, not "radius".
      expect(rs).toEqual([0]);
      return;
    }
    expect(rs[0]).toBe(-26);
    expect(rs[n - 1]).toBe(26);
    // Symmetric: r_i === -r_(N-1-i). toBeCloseTo, not toBe: the middle
    // member of an odd N is its own mirror, and JS's `0 * -1` is `-0`,
    // numerically equal but not Object.is-equal to the `+0` the other side
    // computes.
    for (let i = 0; i < n; i++) expect(rs[i]).toBeCloseTo(-rs[n - 1 - i], 10);
  });

  it("theta stays at rotation for every member, unaffected by position along the line", () => {
    const { placements } = expandShapeGroup({ ...line(5), rotation: num(37) });
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      expect(evalExpr(p.offset.theta, closed)).toBe(37);
    }
  });

  it("a symbolic radius keeps the offset as an Expr shape, not a folded number", () => {
    const symbolic = { ...line(3), radius: sym("LINE_LENGTH") };
    const { placements } = expandShapeGroup(symbolic);
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      expect(p.offset.r.k).not.toBe("num"); // still carries the sym leaf, unresolved
      const resolved = evalExpr(p.offset.r, { resolveSym: (n) => (n === "LINE_LENGTH" ? 26 : undefined), resolveParam: () => undefined });
      expect(resolved).toBeDefined();
    }
  });

  it("a line member's X cell emits as exactly one #const, no temps (item 3's own hand-check, pinned)", () => {
    const { placements } = expandShapeGroup(line(7));
    const namer = new NameAllocator();
    const frame = buildFrame(placements, namer);
    const cells = emitCells(frame.cells, namer);
    // frame.ts emits DEGREES + SIN's macro internals + COS's macro internals
    // + X + Y per member. Whatever that count is for a fixed member count,
    // it must not grow when a member's own X is a division rather than a
    // plain leaf — that growth is exactly what a spurious TMP hoist would
    // look like.
    const xCells = cells.filter((c) => c.name.includes("_X_"));
    expect(xCells).toHaveLength(7); // one #const per member, none of them split into a TMP
  });

  it("an empty pattern or zero/negative repeats still expands to nothing for kind: line", () => {
    expect(expandShapeGroup({ ...line(3), pattern: [] }).placements).toEqual([]);
    expect(expandShapeGroup({ ...line(3), repeats: 0 }).placements).toEqual([]);
  });
});

describe("expandShapeGroup — kind: arc (shape-kinds-slice-a-brief.md item 4)", () => {
  function arc(count: number, sweep?: number): ShapeGroup {
    return { ...ring([{ id: "P", role: "role-P" }], count), kind: "arc", sweep };
  }

  it("sweep 180 with 5 members steps 45 degrees apart", () => {
    const { placements } = expandShapeGroup(arc(5, 180));
    const angles = placements.map((p) => {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      return evalExpr(p.offset.theta, closed);
    });
    expect(angles).toEqual([0, 45, 90, 135, 180]);
  });

  it("sweep 90 with 5 members steps 22 or 23 degrees per member after rounding", () => {
    const { placements } = expandShapeGroup(arc(5, 90));
    const angles = placements.map((p) => {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      return evalExpr(p.offset.theta, closed);
    });
    expect(angles).toEqual([0, 23, 45, 68, 90]);
  });

  it("N=1 sits at rotation, span===0 guarded rather than dividing by zero", () => {
    const { placements } = expandShapeGroup({ ...arc(1, 180), rotation: num(12) });
    expect(placements).toHaveLength(1);
    if (placements[0].offset.kind !== "polar") throw new Error("expected polar");
    expect(evalExpr(placements[0].offset.theta, closed)).toBe(12);
  });

  it("defaults sweep to 180, not 360, when unset", () => {
    const withDefault = expandShapeGroup(arc(3)).placements;
    const explicit180 = expandShapeGroup(arc(3, 180)).placements;
    expect(withDefault).toEqual(explicit180);
  });

  it("every member's angle resolves to an integer, satisfying Sec.5.4's macro guard", () => {
    const { placements } = expandShapeGroup(arc(7, 111));
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      expect(Number.isInteger(evalExpr(p.offset.theta, closed))).toBe(true);
    }
  });

  it("PatternSlot.theta and PatternSlot.radius still override the arc default", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P" }, { id: "A", role: "role-A", theta: num(999), radius: num(5) }];
    const { placements } = expandShapeGroup({ ...ring(pattern, 1), kind: "arc", sweep: 180 });
    const a0 = placements[1];
    if (a0.offset.kind !== "polar") throw new Error("expected polar");
    expect(evalExpr(a0.offset.theta, closed)).toBe(999);
    expect(a0.offset.r).toEqual(num(5));
  });
});

// shape-kinds-slice-b-brief.md item 4, acceptance: square geometry.
describe("expandShapeGroup — kind: square (shape-kinds-slice-b-brief.md item 4)", () => {
  const APOTHEM_45 = Math.SQRT1_2;

  function square(count: number, radius = 26, rotation: Expr = num(0)): ShapeGroup {
    return { ...ring([{ id: "P", role: "role-P" }], count), kind: "square", radius: num(radius), rotation };
  }

  it("produces a polar offset, not cartesian (perimeter-symbolic-rotation-slice-a-brief.md item 2: every kind is polar now)", () => {
    const { placements } = expandShapeGroup(square(4));
    for (const p of placements) expect(p.offset.kind).toBe("polar");
  });

  it("N=4: each member sits at the middle of its own side, at rotation 0", () => {
    const { placements } = expandShapeGroup(square(4));
    const offsets = placements.map(evalPosition);
    expect(offsets[0].dx).toBeCloseTo(26 * APOTHEM_45, 3);
    expect(offsets[0].dy).toBeCloseTo(0, 3);
    expect(offsets[1].dx).toBeCloseTo(0, 3);
    expect(offsets[1].dy).toBeCloseTo(26 * APOTHEM_45, 3);
  });

  it("N=8 alternates side midpoint and corner; corner members sit at exactly the radius, midpoint members at exactly the apothem", () => {
    const { placements } = expandShapeGroup(square(8, 10));
    placements.forEach((p, m) => {
      const { dx, dy } = evalPosition(p);
      const magnitude = Math.hypot(dx, dy);
      if (m % 2 === 0) expect(magnitude).toBeCloseTo(10 * APOTHEM_45, 2);
      else expect(magnitude).toBeCloseTo(10, 2);
    });
  });

  it("rotation 90 is the same set of points as rotation 0, rotated", () => {
    const base = expandShapeGroup(square(8)).placements.map(evalPosition);
    const rotated = expandShapeGroup(square(8, 26, num(90))).placements.map(evalPosition);
    for (let i = 0; i < base.length; i++) {
      expect(rotated[i].dx).toBeCloseTo(-base[i].dy, 3);
      expect(rotated[i].dy).toBeCloseTo(base[i].dx, 3);
    }
  });

  it("every member's DEGREES/X/Y (and the shared trig macro internals) emit, exactly like circle (item 2's own hand-check, pinned)", () => {
    const { placements } = expandShapeGroup(square(4));
    const namer = new NameAllocator();
    const frame = buildFrame(placements, namer);
    const cells = emitCells(frame.cells, namer);
    // A polar offset emits DEGREES + the trig macro's internals (SIN/CR/CS/
    // CP/CD/COS, Sec.5.4) + X + Y per member — the same shape circle
    // already has, no longer the cartesian offset's plain X/Y sum.
    const xCells = cells.filter((c) => c.name.includes("_X_"));
    const degCells = cells.filter((c) => c.name.includes("_DEGREES_"));
    expect(xCells).toHaveLength(4);
    expect(degCells).toHaveLength(4);
  });

  it("a symbolic radius keeps the offset as an Expr shape, not a folded number", () => {
    const symbolic = { ...square(4), radius: sym("SQUARE_RADIUS") };
    const { placements } = expandShapeGroup(symbolic);
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      expect(p.offset.r.k).not.toBe("num");
      const resolved = evalExpr(p.offset.r, { resolveSym: (n) => (n === "SQUARE_RADIUS" ? 26 : undefined), resolveParam: () => undefined });
      expect(resolved).toBeDefined();
    }
  });

  // Sec.8.4 point 2 / item 5: this is a real behaviour change from the
  // cartesian representation's `evalClosed(group.rotation) ?? 0` fallback —
  // rotation is now an ordinary Expr the geometry never inspects, so it
  // survives expansion unresolved, structurally, exactly like circle's own
  // symbolic-rotation case.
  it("a symbolic rotation keeps steering every member — no fallback to 0, the same shape circle already has", () => {
    const symbolic = square(4, 26, sym("ROTATION_PLAYER"));
    const { placements } = expandShapeGroup(symbolic);
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      // theta = bin("+", sym("ROTATION_PLAYER"), num(bearingDegrees)) —
      // structurally, the same shape circle's own equivalent test asserts.
      if (p.offset.theta.k !== "bin") throw new Error("expected a bin node");
      expect(p.offset.theta.op).toBe("+");
      expect(p.offset.theta.l).toEqual(sym("ROTATION_PLAYER"));
      expect(p.offset.theta.r.k).toBe("num");
      const angle = evalExpr(p.offset.theta, { resolveSym: (n) => (n === "ROTATION_PLAYER" ? 40 : undefined), resolveParam: () => undefined });
      expect(angle).toBeDefined();
    }
  });

  it("PatternSlot.theta is not consulted for a perimeter kind (model.ts's own doc comment)", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P", theta: num(999) }];
    const withTheta = expandShapeGroup({ ...square(4), pattern });
    const withoutTheta = expandShapeGroup({ ...square(4), pattern: [{ id: "P", role: "role-P" }] });
    // Only one member per repeat here, so both groups have 4 members total;
    // comparing member 0 across both confirms the (ignored) theta override
    // made no difference.
    expect(withTheta.placements[0].offset).toEqual(withoutTheta.placements[0].offset);
  });

  it("PatternSlot.radius still overrides the group radius for a perimeter kind", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P", radius: num(5) }];
    const { placements } = expandShapeGroup({ ...square(4), pattern });
    const { dx, dy } = evalPosition(placements[0]);
    expect(Math.hypot(dx, dy)).toBeCloseTo(5 * APOTHEM_45, 3);
  });
});

// shape-kinds-slice-c-brief.md item 1, acceptance: triangle geometry, the
// same `perimeterOffset` at M=3 as square's own tests use at M=4.
describe("expandShapeGroup — kind: triangle (shape-kinds-slice-c-brief.md item 1)", () => {
  const APOTHEM_60 = Math.cos(Math.PI / 3); // 0.5, the M=3 apothem, in units of R

  function triangle(count: number, radius = 26, rotation: Expr = num(0)): ShapeGroup {
    return { ...ring([{ id: "P", role: "role-P" }], count), kind: "triangle", radius: num(radius), rotation };
  }

  it("produces a polar offset, not cartesian (perimeter-symbolic-rotation-slice-a-brief.md item 2)", () => {
    const { placements } = expandShapeGroup(triangle(3));
    for (const p of placements) expect(p.offset.kind).toBe("polar");
  });

  it("N=3: each member sits at the middle of its own side", () => {
    const { placements } = expandShapeGroup(triangle(3, 10));
    for (const p of placements) {
      const { dx, dy } = evalPosition(p);
      expect(Math.hypot(dx, dy)).toBeCloseTo(10 * APOTHEM_60, 3);
    }
  });

  it("N=6 alternates side midpoint and corner; corner members sit at exactly the radius, midpoint members at exactly the apothem", () => {
    const { placements } = expandShapeGroup(triangle(6, 10));
    placements.forEach((p, m) => {
      const { dx, dy } = evalPosition(p);
      const magnitude = Math.hypot(dx, dy);
      if (m % 2 === 0) expect(magnitude).toBeCloseTo(10 * APOTHEM_60, 2);
      else expect(magnitude).toBeCloseTo(10, 2);
    });
  });

  it("a symbolic rotation keeps steering every member, matching square's own case", () => {
    const symbolic = triangle(3, 10, sym("ROTATION_PLAYER"));
    const { placements } = expandShapeGroup(symbolic);
    for (const p of placements) {
      if (p.offset.kind !== "polar") throw new Error("expected polar");
      const angle = evalExpr(p.offset.theta, { resolveSym: (n) => (n === "ROTATION_PLAYER" ? 40 : undefined), resolveParam: () => undefined });
      expect(angle).toBeDefined();
    }
  });
});

// shape-kinds-slice-c-brief.md item 1, acceptance: `sides: 4` matches
// square exactly (the escalation's own claim that the three kinds are one
// implementation), plus the clamp on a degenerate or absent `sides`.
describe("expandShapeGroup — kind: polygon (shape-kinds-slice-c-brief.md item 1)", () => {
  function polygon(count: number, sides: number | undefined, radius = 26, rotation: Expr = num(0)): ShapeGroup {
    return { ...ring([{ id: "P", role: "role-P" }], count), kind: "polygon", sides, radius: num(radius), rotation };
  }

  it("sides: 4 produces coordinates identical to a square with the same radius, rotation and member count", () => {
    const square: ShapeGroup = { ...ring([{ id: "P", role: "role-P" }], 8), kind: "square", radius: num(10), rotation: num(0) };
    const octagonalSquare = polygon(8, 4, 10);
    expect(expandShapeGroup(octagonalSquare).placements.map((p) => p.offset)).toEqual(expandShapeGroup(square).placements.map((p) => p.offset));
  });

  it("clamps sides: 2 to a drawable polygon (the floor, 3) rather than throwing", () => {
    expect(() => expandShapeGroup(polygon(6, 2))).not.toThrow();
    const { placements } = expandShapeGroup(polygon(6, 2));
    const triangleEquivalent = expandShapeGroup(polygon(6, 3));
    expect(placements.map((p) => p.offset)).toEqual(triangleEquivalent.placements.map((p) => p.offset));
  });

  it("clamps a negative sides the same way as sides: 2", () => {
    const { placements } = expandShapeGroup(polygon(6, -5));
    const triangleEquivalent = expandShapeGroup(polygon(6, 3));
    expect(placements.map((p) => p.offset)).toEqual(triangleEquivalent.placements.map((p) => p.offset));
  });

  it("an absent sides clamps to a drawable polygon (a hexagon) rather than throwing", () => {
    expect(() => expandShapeGroup(polygon(6, undefined))).not.toThrow();
    const withDefault = expandShapeGroup(polygon(6, undefined));
    const explicitHexagon = expandShapeGroup(polygon(6, 6));
    expect(withDefault.placements.map((p) => p.offset)).toEqual(explicitHexagon.placements.map((p) => p.offset));
  });

  it("truncates a fractional sides rather than rounding", () => {
    const fractional = expandShapeGroup(polygon(6, 5.9));
    const five = expandShapeGroup(polygon(6, 5));
    expect(fractional.placements.map((p) => p.offset)).toEqual(five.placements.map((p) => p.offset));
  });
});

// perimeter-symbolic-rotation-slice-b-brief.md item 4: `PatternSlot.perimeterShift`
// composing with the two things already on a slot/group (`slot.radius`, a
// symbolic group rotation), and its own inertness outside the three
// perimeter kinds — everything about the SHIFT VALUE itself (the wrap, the
// larger-radius-off-midpoint subtlety) is already pinned one layer down in
// `perimeterOffset.test.ts`, against `perimeterPolar` directly.
describe("expandShapeGroup — PatternSlot.perimeterShift (perimeter-symbolic-rotation-slice-b-brief.md item 4)", () => {
  function square(pattern: PatternSlot[], radius = 26, rotation: Expr = num(0)): ShapeGroup {
    return { ...ring(pattern, 1), kind: "square", radius: num(radius), rotation };
  }

  it("an absent perimeterShift and an explicit 0 both expand identically to no shift at all — the default path is byte-identical", () => {
    const noField = expandShapeGroup(square([{ id: "P", role: "role-P" }]));
    const explicitZero = expandShapeGroup(square([{ id: "P", role: "role-P", perimeterShift: 0 }]));
    expect(explicitZero.placements[0].offset).toEqual(noField.placements[0].offset);
  });

  it("composes with slot.radius: the shift picks the point on the unit-circumradius polygon, the radius scales it, and the two are independent", () => {
    // Same member (single-slot pattern, so N=1, m=0 in both expansions) with
    // and without a radius override, both carrying the identical shift — if
    // the composition were anything other than a plain multiply, the two
    // would not scale by the same factor from the same bearing.
    const base = expandShapeGroup(square([{ id: "P", role: "role-P", perimeterShift: 6.25 }], 26)).placements[0];
    const overridden = expandShapeGroup(square([{ id: "P", role: "role-P", perimeterShift: 6.25, radius: num(13) }], 26)).placements[0];
    const b = evalPosition(base);
    const o = evalPosition(overridden);
    expect(Math.hypot(o.dx, o.dy)).toBeCloseTo(Math.hypot(b.dx, b.dy) / 2, 3); // 13 is half of 26
    // Same bearing too: a radius override scales the local vector, it does
    // not choose a different point on the perimeter.
    expect(Math.atan2(o.dy, o.dx)).toBeCloseTo(Math.atan2(b.dy, b.dx), 5);
  });

  it("composes with a symbolic group rotation: theta is still bin(+, sym, num(shiftedBearing)) — rotation spins the shape, the shift moves along it, neither reads the other", () => {
    const pattern: PatternSlot[] = [{ id: "P", role: "role-P", perimeterShift: 6.25 }];
    const { placements } = expandShapeGroup(square(pattern, 26, sym("ROTATION_PLAYER")));
    const offset = placements[0].offset;
    if (offset.kind !== "polar") throw new Error("expected polar");
    if (offset.theta.k !== "bin") throw new Error("expected a bin node");
    expect(offset.theta.op).toBe("+");
    expect(offset.theta.l).toEqual(sym("ROTATION_PLAYER"));
    expect(offset.theta.r.k).toBe("num");
    // The baked bearing offset is the SHIFTED one (27, per
    // perimeterOffset.test.ts's own 6.25% case), not the unshifted 0 —
    // confirms the shift reaches the geometry even under a symbolic rotation.
    expect((offset.theta.r as { k: "num"; v: number }).v).toBe(27);
  });

  it("is inert for circle, line and arc, the same way sweep is inert outside arc", () => {
    const withShift: PatternSlot[] = [{ id: "P", role: "role-P", perimeterShift: 40 }];
    const withoutShift: PatternSlot[] = [{ id: "P", role: "role-P" }];
    for (const kind of ["circle", "line", "arc"] as const) {
      const base = { ...ring(withoutShift, 4), kind };
      const shifted = { ...ring(withShift, 4), kind };
      expect(expandShapeGroup(shifted).placements.map((p) => p.offset)).toEqual(expandShapeGroup(base).placements.map((p) => p.offset));
    }
  });
});
