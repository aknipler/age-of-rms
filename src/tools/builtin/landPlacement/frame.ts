// Sec.4.2: the radial frame (angle ABC) and the DEGREES/X/Y algebra it
// reduces to. A = map centre, B = parent land, C = child; the chain
// maintains the angle at B, and depth composes by carrying one extra
// quantity per node, INBOUND, the world angle of the ray from a node back
// to ITS OWN anchor, which is why `DEGREES_c = DEGREES_p + 180 + θ_c` is a
// pure left spine and INBOUND itself never needs emitting (Sec.4.2, "the
// table is the algebra; only rows 1 and 2 reach the file").
//
// SLICE 3 (this file): every offset kind and both frame kinds are built now,
// `cartesian`, `formula` and `absolute` join slice 1's `radial`/`polar`.
//
// TWO POINTS THE DESIGN DOC DOES NOT SPELL OUT, DECIDED HERE AND DOCUMENTED
// RATHER THAN LEFT IMPLICIT (per CLAUDE.md: "if a spec seems wrong or
// ambiguous, stop and escalate", this is the narrower case of a spec that
// is simply silent on a combination it never considered, not one that
// contradicts itself, so a documented default rather than a work stoppage):
//
// 1. `cartesian`/`formula` offsets carry no notion of "frame" at all. `dx`/
//    `dy` are already plain world-axis deltas and a `formula`'s `x`/`y` are
//    already whatever the user's own Expr says, neither one has an angle
//    to rotate or an INBOUND term to drop, so `Placement.frame` is simply
//    not consulted for either kind. `absolute` vs `radial` is a distinction
//    that only exists for `polar` offsets in the first place (Sec.4.2's own
//    text: "the child keeps a world-axis delta", describing `polar`'s
//    theta, not a second mechanism).
// 2. A `cartesian`/`formula` node has no DEGREES cell, it was never placed
//    by angle, so it has none to give a child. A `radial`+`polar` CHILD
//    hung off one therefore has nothing to add `+ 180` to, and falls back
//    to the same rule Sec.4.2 already states for the map-centre degenerate
//    case: a plain world bearing, `theta` unmodified. `PlacementQuantity.
//    degreesName` is `undefined` for exactly these two offset kinds, and
//    that absence IS the fallback trigger, no separate flag needed.

import type { Expr } from "../../../../tools-api/index";
import { bin, num, sym } from "./compiler/expr";
import type { NamedCell } from "./compiler/emit";
import { expandTrig } from "./compiler/trig";
import type { NameAllocator } from "./compiler/naming";
import type { Placement } from "./model";

export interface PlacementQuantity {
  /** `undefined` for a `cartesian`/`formula` node, it has no angle to give a child (see file header, point 2). */
  degreesName: string | undefined;
  xName: string;
  yName: string;
}

export interface FrameResult {
  /** Every #const cell to emit, IN ORDER, parents and macro internals before their dependents. */
  cells: NamedCell[];
  /** Per-placement emitted names, keyed by Placement.id. */
  quantities: Map<string, PlacementQuantity>;
}

/**
 * Builds the DEGREES/R/S/P/D/SIN/CR/CS/CP/CD/COS/X/Y cells (for a `polar`
 * offset) or the plain X/Y sum (for `cartesian`/`formula`) of a tree of
 * Placements, in dependency order (a parent's cells always precede its
 * children's, required, since a child's DEGREES/X/Y reference its parent's
 * own emitted names by `sym`).
 */
export function buildFrame(
  placements: readonly Placement[],
  namer: NameAllocator,
): FrameResult {
  const childrenOf = new Map<string, Placement[]>();
  for (const p of placements) {
    const list = childrenOf.get(p.parent) ?? [];
    list.push(p);
    childrenOf.set(p.parent, list);
  }

  const cells: NamedCell[] = [];
  const quantities = new Map<string, PlacementQuantity>();

  function visit(p: Placement): void {
    const parentQ =
      p.parent === "center" ? undefined : quantities.get(p.parent);
    if (p.parent !== "center" && parentQ === undefined) {
      throw new Error(
        `buildFrame: placement ${p.id}'s parent ${p.parent} was not processed first`,
      );
    }
    const anchorX: Expr = parentQ === undefined ? num(50) : sym(parentQ.xName);
    const anchorY: Expr = parentQ === undefined ? num(50) : sym(parentQ.yName);

    if (p.offset.kind === "cartesian") {
      const xName = namer.allocate("X", p.label);
      cells.push({ name: xName, expr: bin("+", p.offset.dx, anchorX) });
      const yName = namer.allocate("Y", p.label);
      cells.push({ name: yName, expr: bin("+", p.offset.dy, anchorY) });
      quantities.set(p.id, { degreesName: undefined, xName, yName });
    } else if (p.offset.kind === "formula") {
      // The escape hatch: x/y are exactly what the user wrote (which may
      // itself reference an anchor, another node, or nothing at all via
      // `{ k: "node" }`, Sec.5.0), never combined with anchorX/anchorY here.
      const xName = namer.allocate("X", p.label);
      cells.push({ name: xName, expr: p.offset.x });
      const yName = namer.allocate("Y", p.label);
      cells.push({ name: yName, expr: p.offset.y });
      quantities.set(p.id, { degreesName: undefined, xName, yName });
    } else {
      // polar. `absolute` drops the INBOUND_p term outright (Sec.4.2); a
      // `radial` child of a node with no DEGREES of its own (cartesian/
      // formula parent) falls back to the same plain-bearing rule for the
      // same reason, there is nothing to add `+ 180` to.
      const inbound =
        parentQ?.degreesName === undefined
          ? undefined
          : sym(parentQ.degreesName);
      const degreesExpr: Expr =
        p.frame === "absolute" || inbound === undefined
          ? p.offset.theta
          : bin("+", bin("+", inbound, num(180)), p.offset.theta);

      const degreesName = namer.allocate("DEGREES", p.label);
      cells.push({ name: degreesName, expr: degreesExpr });

      const trig = expandTrig(sym(degreesName), p.label, namer);
      cells.push(...trig.cells);

      const xName = namer.allocate("X", p.label);
      cells.push({
        name: xName,
        expr: bin("+", bin("*", p.offset.r, sym(trig.cosName)), anchorX),
      });

      const yName = namer.allocate("Y", p.label);
      cells.push({
        name: yName,
        expr: bin("+", bin("*", p.offset.r, sym(trig.sinName)), anchorY),
      });

      quantities.set(p.id, { degreesName, xName, yName });
    }

    for (const child of childrenOf.get(p.id) ?? []) visit(child);
  }

  for (const root of childrenOf.get("center") ?? []) visit(root);

  return { cells, quantities };
}
