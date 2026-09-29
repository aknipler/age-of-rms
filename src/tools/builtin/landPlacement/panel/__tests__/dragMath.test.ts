// Sec.7.3: canvas dragging, the math half. Verifies against `evalExpr` /
// the real trig functions this repo already uses elsewhere, not just
// against hand re-derived numbers.

import { describe, expect, it } from "vitest";
import { bin, evalExpr, num, sym } from "../../compiler/expr";
import type { Placement } from "../../model";
import {
  applyDrag,
  dragCartesian,
  dragPolar,
  tryInvertFormulaCoordinate,
  tryInvertFormulaOffset,
} from "../dragMath";

const CENTRE = { x: 50, y: 50 };

describe("dragPolar", () => {
  it("a root node (no parent DEGREES): theta is a plain world bearing", () => {
    // Dropped due east of centre, same y, bearing 0.
    const east = dragPolar(CENTRE, { x: 70, y: 50 }, "radial", undefined);
    expect(east.r).toBeCloseTo(20, 6);
    expect(east.theta).toBeCloseTo(0, 6);

    // Dropped due north, in this repo's own y-down screen convention
    // (matching frame.ts: y = r*sin(theta) + anchorY, and worldBearingDegrees
    // uses the same atan2(dy, dx)), a SMALLER y is a NEGATIVE bearing.
    const north = dragPolar(CENTRE, { x: 50, y: 30 }, "radial", undefined);
    expect(north.r).toBeCloseTo(20, 6);
    expect(north.theta).toBeCloseTo(-90, 6);
  });

  it("absolute frame always uses a plain world bearing, even with a parent DEGREES available", () => {
    const result = dragPolar(
      { x: 40, y: 40 },
      { x: 60, y: 40 },
      "absolute",
      123,
    );
    expect(result.theta).toBeCloseTo(0, 6); // due east of the anchor, parentDegrees ignored
  });

  it("radial frame composes against the parent's own DEGREES per Sec.4.2: theta = worldBearing - parentDegrees - 180", () => {
    // Parent's own DEGREES is 90 (parent itself points south-ish). Anchor
    // (the parent's resolved position) is (50,50); drop the child due east
    // of the parent -> worldBearing 0.
    const result = dragPolar({ x: 50, y: 50 }, { x: 70, y: 50 }, "radial", 90);
    expect(result.theta).toBeCloseTo(foldExpected(0 - 90 - 180), 6);
  });

  function foldExpected(deg: number): number {
    const wrapped = ((deg % 360) + 360) % 360;
    return wrapped > 180 ? wrapped - 360 : wrapped;
  }

  it("round-trips through the compiler's OWN reference evaluator (real trig, not the Bhaskara macro — see this file's own header)", () => {
    // Drop a node and confirm real Math.cos/sin at the derived (r,theta)
    // reproduces the drop point. This is the geometric identity the
    // inversion is built on, independent of the emitted macro's own
    // approximation error.
    const dropped = { x: 82, y: 15 };
    const { r, theta } = dragPolar(CENTRE, dropped, "radial", undefined);
    const rad = (theta * Math.PI) / 180;
    expect(CENTRE.x + r * Math.cos(rad)).toBeCloseTo(dropped.x, 6);
    expect(CENTRE.y + r * Math.sin(rad)).toBeCloseTo(dropped.y, 6);
  });

  it("theta always folds into (-180, 180]", () => {
    // Drop due west, a 180-degree bearing, the boundary case.
    const west = dragPolar(CENTRE, { x: 30, y: 50 }, "radial", undefined);
    expect(west.theta).toBe(180);
  });
});

describe("dragCartesian", () => {
  it("never consults frame — plain world-axis deltas from the anchor", () => {
    const result = dragCartesian({ x: 40, y: 60 }, { x: 55, y: 50 });
    expect(result).toEqual({ kind: "cartesian", dx: 15, dy: -10 });
  });
});

describe("tryInvertFormulaCoordinate", () => {
  it("a bare number absorbs the delta directly", () => {
    const result = tryInvertFormulaCoordinate(num(30), 5);
    expect(result).toEqual({ ok: true, expr: num(35) });
  });

  it("sym + num: the drag adjusts only the constant, preserving the reference", () => {
    const result = tryInvertFormulaCoordinate(
      { k: "bin", op: "+", l: sym("X_P1"), r: num(10) },
      4,
    );
    expect(result).toEqual({
      ok: true,
      expr: { k: "bin", op: "+", l: sym("X_P1"), r: num(14) },
    });
  });

  it("num + sym (operand order reversed) also inverts", () => {
    const result = tryInvertFormulaCoordinate(
      { k: "bin", op: "+", l: num(10), r: sym("X_P1") },
      4,
    );
    expect(result).toEqual({
      ok: true,
      expr: { k: "bin", op: "+", l: num(14), r: sym("X_P1") },
    });
  });

  it("sym - num: increasing the position DECREASES the subtracted literal", () => {
    // value = X_P1 - 10; want value' = value + 4 = X_P1 - 6.
    const result = tryInvertFormulaCoordinate(
      { k: "bin", op: "-", l: sym("X_P1"), r: num(10) },
      4,
    );
    expect(result).toEqual({
      ok: true,
      expr: { k: "bin", op: "-", l: sym("X_P1"), r: num(6) },
    });
  });

  it("the inverted result actually evaluates to the delta-shifted value — proven, not just structurally asserted", () => {
    const original: {
      k: "bin";
      op: "-";
      l: import("../../../../../../tools-api/index").Expr;
      r: import("../../../../../../tools-api/index").Expr;
    } = {
      k: "bin",
      op: "-",
      l: sym("X_P1"),
      r: num(10),
    };
    const resolveSym = () => 60; // X_P1 = 60
    const before = evalExpr(original, {
      resolveSym,
      resolveParam: () => undefined,
    });
    const inverted = tryInvertFormulaCoordinate(original, 4);
    expect(inverted.ok).toBe(true);
    if (!inverted.ok) return;
    const after = evalExpr(inverted.expr, {
      resolveSym,
      resolveParam: () => undefined,
    });
    expect(after).toBeCloseTo((before ?? 0) + 4, 10);
  });

  it("a bare sym alone declines — nothing to absorb the delta into", () => {
    const result = tryInvertFormulaCoordinate(sym("X_P1"), 5);
    expect(result.ok).toBe(false);
  });

  it("SIN/COS decline", () => {
    expect(
      tryInvertFormulaCoordinate({ k: "sin", e: sym("THETA") }, 5).ok,
    ).toBe(false);
  });

  it("a product declines", () => {
    expect(
      tryInvertFormulaCoordinate(
        { k: "bin", op: "*", l: sym("X"), r: num(2) },
        5,
      ).ok,
    ).toBe(false);
  });

  it("a param leaf declines", () => {
    expect(tryInvertFormulaCoordinate({ k: "param", id: "p1" }, 5).ok).toBe(
      false,
    );
  });

  it("sym + sym (no literal to absorb into) declines", () => {
    expect(
      tryInvertFormulaCoordinate(
        { k: "bin", op: "+", l: sym("A"), r: sym("B") },
        5,
      ).ok,
    ).toBe(false);
  });
});

describe("tryInvertFormulaOffset", () => {
  it("both axes invertible: succeeds with both adjusted", () => {
    const result = tryInvertFormulaOffset(num(30), num(40), 5, -3);
    expect(result).toEqual({ ok: true, x: num(35), y: num(37) });
  });

  it("one axis declines: the WHOLE drag declines (Sec.7.3's read-only-marker is all-or-nothing)", () => {
    const result = tryInvertFormulaOffset(num(30), sym("Y_P1"), 5, -3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/^y:/);
  });

  it("both axes decline: both reasons are reported", () => {
    const result = tryInvertFormulaOffset(sym("X"), sym("Y"), 5, -3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons).toHaveLength(2);
  });
});

describe("applyDrag — the dispatcher", () => {
  function polarPlacement(over: Partial<Placement> = {}): Placement {
    return {
      id: "P",
      parent: "center",
      frame: "radial",
      label: "P",
      offset: { kind: "polar", r: num(20), theta: num(0) },
      ...over,
    };
  }

  it("dispatches polar offsets through dragPolar", () => {
    const result = applyDrag(
      polarPlacement(),
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offset = result.placement.offset;
    expect(offset.kind).toBe("polar");
    if (offset.kind !== "polar") return;
    expect(offset.r).toEqual(num(20));
    expect((offset.theta as { v: number }).v).toBeCloseTo(0, 6);
  });

  it("dispatches cartesian offsets through dragCartesian", () => {
    const placement = polarPlacement({
      offset: { kind: "cartesian", dx: num(0), dy: num(0) },
    });
    const result = applyDrag(
      placement,
      { x: 40, y: 60 },
      { x: 40, y: 60 },
      { x: 55, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placement.offset).toEqual({
      kind: "cartesian",
      dx: num(15),
      dy: num(-10),
    });
  });

  it("a formula offset's delta is measured from the NODE's own previous position, never the anchor", () => {
    const placement = polarPlacement({
      offset: { kind: "formula", x: num(60), y: num(30) },
    });
    // The node's own previous resolved position (60,30) differs from its
    // parent anchor (50,50). Dropping it 5 further right must add 5 to the
    // stored x regardless of where the anchor sits.
    const result = applyDrag(
      placement,
      CENTRE,
      { x: 60, y: 30 },
      { x: 65, y: 30 },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placement.offset).toEqual({
      kind: "formula",
      x: num(65),
      y: num(30),
    });
  });

  it("a non-invertible formula offset is declined with a reason, and the placement is left untouched by the caller (the caller simply doesn't apply an ok:false result)", () => {
    const placement = polarPlacement({
      offset: { kind: "formula", x: { k: "sin", e: num(45) }, y: num(30) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      { x: 60, y: 30 },
      { x: 65, y: 30 },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("a polar theta that still references its group's rotation is declined, never frozen to a literal", () => {
    // Exactly what expand.ts builds for a member of a ring whose rotation is
    // a RandomParam: add(sym(ROTATION), num(45)). Overwriting it would stop
    // this one member following the ring while its siblings keep rotating.
    const placement = polarPlacement({
      offset: {
        kind: "polar",
        r: num(20),
        theta: bin("+", sym("ROTATION_PLAYER"), num(45)),
      },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Angle");
    expect(result.reason).not.toContain("Radius");
  });

  it("a polar offset built from literals inside a bin STILL drags — the guard asks whether it resolves, not whether it is one literal", () => {
    // The ordinary case, and the one a literal-shape test would break:
    // expand.ts never folds, so EVERY group member's theta is a bin, even
    // when the group's rotation is a plain number.
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: bin("+", num(30), num(15)) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offset = result.placement.offset;
    if (offset.kind !== "polar") return;
    expect((offset.theta as { v: number }).v).toBeCloseTo(0, 6);
  });

  it("per-player-escalation.md Sec.7.7: a perPlayer ring member declines even with a fully literal theta, the exact fixture the test above proves DOES resolve", () => {
    // Same shape as the test above — expand.ts's own even-default bin, every
    // operand a plain number, `evalClosed` resolves it fine — because that is
    // precisely the case the caller cannot tell apart from an ordinary
    // draggable member by looking at the Expr alone (slice-b-brief.md item
    // 4). Only `isPerPlayerMember` distinguishes them, so this fixture is
    // deliberately the one the guard's own removal would flip from decline to
    // success, not one that already declines for an unrelated reason.
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: bin("+", num(30), num(15)) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
      ["Angle"],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Angle");
    expect(result.reason).not.toContain("Radius");
  });

  it("isPerPlayerMember never invents a second reason when Angle is already symbolic", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: sym("ROTATION_PLAYER") },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
      ["Angle"],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Angle is a formula");
    expect(result.reason).not.toContain("and");
  });

  it("isPerPlayerMember still reports a symbolic Radius alongside the forced Angle", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: sym("R"), theta: num(30) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
      ["Angle"],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Radius and Angle");
  });

  // land-placement-per-player-any-kind-escalation.md slice B: a Line member's
  // radius is a prologue RAD cell too, so the decline names Radius as well.
  it("a per player line member declines naming both Radius and Angle, with both literal", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: bin("+", num(30), num(15)) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
      ["Radius", "Angle"],
      { kind: "polar", r: 20, theta: 45 },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Radius and Angle");
    expect(result.reason).not.toContain("Radius:");
  });

  it("the forced labels come out in Radius, Angle order whatever order they are passed in", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: num(30) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
      ["Angle", "Radius"],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Radius and Angle");
  });

  it("isPerPlayerMember defaults to false — a plain member (not passed the flag) is unaffected", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: num(20), theta: bin("+", num(30), num(15)) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(true);
  });

  it("a cartesian offset with a symbolic component declines and names that component", () => {
    const placement = polarPlacement({
      offset: { kind: "cartesian", dx: sym("SOME_CONST"), dy: num(0) },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 60, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Across");
  });

  it("both components symbolic: one message naming both, not two separate refusals", () => {
    const placement = polarPlacement({
      offset: { kind: "polar", r: sym("R"), theta: sym("T") },
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Radius and Angle");
  });

  it("preserves every other field on the placement — id, label, role, repeatIndex", () => {
    const placement = polarPlacement({
      role: "player",
      repeatIndex: 2,
      label: "P2",
    });
    const result = applyDrag(
      placement,
      CENTRE,
      CENTRE,
      { x: 70, y: 50 },
      undefined,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placement.id).toBe("P");
    expect(result.placement.label).toBe("P2");
    expect(result.placement.role).toBe("player");
    expect(result.placement.repeatIndex).toBe(2);
  });

  // shape-kinds-slice-b-brief.md item 2, escalation §6: the absorb path.
  // `resolvedOffset` is the ONE new input — reachable only when the caller
  // supplies it, so every test above (which never does) stays proof that
  // the pre-slice-B decline behaviour is unchanged by default.
  describe("the absorb path (resolvedOffset supplied)", () => {
    function reconstruct(
      r: number,
      thetaDeg: number,
    ): { x: number; y: number } {
      const rad = (thetaDeg * Math.PI) / 180;
      return {
        x: CENTRE.x + r * Math.cos(rad),
        y: CENTRE.y + r * Math.sin(rad),
      };
    }

    it("a symbolic r with an invertible shape absorbs the delta, preserving the reference", () => {
      // r = R_BASE + 5, currently 20 (R_BASE = 15). Drop due east at
      // distance 40: target r = 40, theta = 0 (unchanged).
      const placement = polarPlacement({
        offset: {
          kind: "polar",
          r: bin("+", sym("R_BASE"), num(5)),
          theta: num(0),
        },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 90, y: 50 },
        undefined,
        [],
        { kind: "polar", r: 20, theta: 0 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const offset = result.placement.offset;
      if (offset.kind !== "polar") throw new Error("expected polar");
      expect(offset.r).toEqual(bin("+", sym("R_BASE"), num(25))); // 5 + (40 - 20)
      expect(
        evalExpr(offset.theta, {
          resolveSym: () => undefined,
          resolveParam: () => undefined,
        }),
      ).toBeCloseTo(0, 6);
    });

    it("a symbolic theta with an invertible shape absorbs the delta, preserving the reference", () => {
      // theta = ROTATION + 10, currently 15 (ROTATION = 5). Drop due north
      // at distance 20: target r = 20 (unchanged), theta = -90.
      const placement = polarPlacement({
        offset: {
          kind: "polar",
          r: num(20),
          theta: bin("+", sym("ROTATION"), num(10)),
        },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 50, y: 30 },
        undefined,
        [],
        { kind: "polar", r: 20, theta: 15 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const offset = result.placement.offset;
      if (offset.kind !== "polar") throw new Error("expected polar");
      expect(offset.r).toEqual(num(20));
      expect(offset.theta).toEqual(bin("+", sym("ROTATION"), num(-95))); // 10 + (-90 - 15)
    });

    it("both r and theta symbolic and invertible: both absorb, and the result reconstructs the drop point exactly (proven, not just structurally asserted)", () => {
      const placement = polarPlacement({
        offset: {
          kind: "polar",
          r: bin("+", sym("R_BASE"), num(5)),
          theta: bin("+", sym("ROTATION"), num(10)),
        },
      });
      const droppedAt = { x: 90, y: 30 };
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        droppedAt,
        undefined,
        [],
        { kind: "polar", r: 20, theta: 15 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const offset = result.placement.offset;
      if (offset.kind !== "polar") throw new Error("expected polar");
      const resolveSym = (name: string) =>
        name === "R_BASE" ? 15 : name === "ROTATION" ? 5 : undefined;
      const r = evalExpr(offset.r, {
        resolveSym,
        resolveParam: () => undefined,
      })!;
      const theta = evalExpr(offset.theta, {
        resolveSym,
        resolveParam: () => undefined,
      })!;
      const reconstructed = reconstruct(r, theta);
      expect(reconstructed.x).toBeCloseTo(droppedAt.x, 4);
      expect(reconstructed.y).toBeCloseTo(droppedAt.y, 4);
    });

    it("one symbolic component invertible, the other not: the whole drag declines, naming only the failed component", () => {
      const placement = polarPlacement({
        // r absorbs; theta is a product, which tryInvertFormulaCoordinate declines.
        offset: {
          kind: "polar",
          r: bin("+", sym("R_BASE"), num(5)),
          theta: bin("*", sym("ROT"), num(2)),
        },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 90, y: 50 },
        undefined,
        [],
        { kind: "polar", r: 20, theta: 90 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("Angle:");
      expect(result.reason).not.toContain("Radius:");
    });

    it("a bare sym (nothing to absorb into) declines, matching tryInvertFormulaCoordinate's own reason", () => {
      const placement = polarPlacement({
        offset: { kind: "polar", r: sym("R_BASE"), theta: num(0) },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 90, y: 50 },
        undefined,
        [],
        { kind: "polar", r: 20, theta: 0 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("Radius:");
      expect(result.reason).toContain("no constant term");
    });

    it("a perPlayer member with a perfectly invertible symbolic theta still declines — checked and force-declined BEFORE any invert is attempted (hazard 5)", () => {
      const placement = polarPlacement({
        offset: {
          kind: "polar",
          r: num(20),
          theta: bin("+", sym("ROTATION_PLAYER"), num(10)),
        },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 50, y: 30 },
        undefined,
        ["Angle"],
        { kind: "polar", r: 20, theta: 15 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // The FORCED reason (symbolicDeclineReason), never the invert-failure
      // wording — proof the code never even attempted the invert for Angle.
      expect(result.reason).toContain("Angle is a formula");
      expect(result.reason).not.toContain("Angle:");
      expect(result.reason).not.toContain("Radius");
    });

    it("a mismatched resolvedOffset.kind (cartesian passed for a polar placement) is treated as absent — falls back to the ordinary decline", () => {
      const placement = polarPlacement({
        offset: { kind: "polar", r: sym("R_BASE"), theta: num(0) },
      });
      const result = applyDrag(
        placement,
        CENTRE,
        CENTRE,
        { x: 90, y: 50 },
        undefined,
        [],
        { kind: "cartesian", dx: 20, dy: 0 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("Radius is a formula");
    });

    it("cartesian: a symbolic dx with an invertible shape absorbs the delta", () => {
      const placement = polarPlacement({
        offset: {
          kind: "cartesian",
          dx: bin("+", sym("X_BASE"), num(5)),
          dy: num(0),
        },
      });
      // anchor (40,60), drop (55,50): target dx=15, dy=-10.
      const result = applyDrag(
        placement,
        { x: 40, y: 60 },
        { x: 40, y: 60 },
        { x: 55, y: 50 },
        undefined,
        [],
        { kind: "cartesian", dx: 10, dy: 0 },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const offset = result.placement.offset;
      if (offset.kind !== "cartesian") throw new Error("expected cartesian");
      expect(offset.dx).toEqual(bin("+", sym("X_BASE"), num(10))); // 5 + (15 - 10)
      expect(offset.dy).toEqual(num(-10));
    });

    it("cartesian: a non-invertible symbolic dy declines and names it", () => {
      const placement = polarPlacement({
        offset: { kind: "cartesian", dx: num(0), dy: sym("Y_BASE") },
      });
      const result = applyDrag(
        placement,
        { x: 40, y: 60 },
        { x: 40, y: 60 },
        { x: 55, y: 50 },
        undefined,
        [],
        { kind: "cartesian", dx: 0, dy: -10 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toContain("Down:");
    });
  });
});
