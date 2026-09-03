// Slice-3 item 6: "Add cartesian and formula offsets and absolute frames.
// Acceptance: the Sec.10.1 acceptance gate still passes byte-for-byte." The
// gate itself lives in acceptance.test.ts and is untouched; these tests
// cover the new offset kinds and frame directly.

import { describe, expect, it } from "vitest";
import { cosFromTheta, evalExpr, nodeRef, num, sinFromTheta } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import { buildFrame } from "../frame";
import type { Placement } from "../model";

function resolve(cells: ReturnType<typeof buildFrame>["cells"]): Map<string, number> {
  const resolved = new Map<string, number>();
  for (const cell of cells) {
    const v = evalExpr(cell.expr, {
      resolveSym: (n) => resolved.get(n),
      resolveParam: () => undefined,
      resolveNode: () => undefined,
    });
    if (v !== undefined) resolved.set(cell.name, v);
  }
  return resolved;
}

describe("buildFrame — cartesian offsets", () => {
  it("a top-level cartesian placement is anchorX+dx, anchorY+dy off the map centre (50,50)", () => {
    const placements: Placement[] = [{ id: "c1", parent: "center", frame: "radial", offset: { kind: "cartesian", dx: num(8), dy: num(-3) }, label: "C1" }];
    const namer = new NameAllocator({ prefix: "" });
    const { cells, quantities } = buildFrame(placements, namer);
    const resolved = resolve(cells);
    const q = quantities.get("c1")!;
    expect(resolved.get(q.xName)).toBe(58);
    expect(resolved.get(q.yName)).toBe(47);
    // No angle: a cartesian node has nothing to give a radial child.
    expect(q.degreesName).toBeUndefined();
  });

  it("a cartesian child adds its dx/dy to the parent's own X/Y, not the map centre", () => {
    const placements: Placement[] = [
      { id: "p1", parent: "center", frame: "radial", offset: { kind: "polar", r: num(10), theta: num(0) }, label: "P1" },
      { id: "c1", parent: "p1", frame: "radial", offset: { kind: "cartesian", dx: num(1), dy: num(2) }, label: "C1" },
    ];
    const { cells, quantities } = buildFrame(placements, new NameAllocator({ prefix: "" }));
    const resolved = resolve(cells);
    const p1 = quantities.get("p1")!;
    const c1 = quantities.get("c1")!;
    expect(resolved.get(c1.xName)).toBe(resolved.get(p1.xName)! + 1);
    expect(resolved.get(c1.yName)).toBe(resolved.get(p1.yName)! + 2);
  });
});

describe("buildFrame — formula offsets (the custom-formula escape hatch)", () => {
  it("emits x/y exactly as given, with no anchor combined in", () => {
    const placements: Placement[] = [
      { id: "f1", parent: "center", frame: "radial", offset: { kind: "formula", x: num(12), y: num(34) }, label: "F1" },
    ];
    const resolved = resolve(buildFrame(placements, new NameAllocator({ prefix: "" })).cells);
    const q = buildFrame(placements, new NameAllocator({ prefix: "" })).quantities.get("f1")!;
    expect(resolved.get(q.xName)).toBe(12);
    expect(resolved.get(q.yName)).toBe(34);
  });

  it("passes a {k:'node'} reference straight through, unresolved — Rage Forest's bisector idiom (Sec.5.0)", () => {
    // Resolving {k:"node"} into a concrete `sym` reference is a later
    // compiler pass this slice does not build (emit.ts's own contract
    // already says every node/param ref must be pre-resolved before it gets
    // there). buildFrame's whole job for a `formula` offset is to emit `x`/
    // `y` exactly as given, so this pins that it does not silently drop or
    // rewrite the reference.
    const placements: Placement[] = [
      { id: "mid", parent: "center", frame: "radial", offset: { kind: "formula", x: nodeRef("a", "x"), y: num(0) }, label: "MID" },
    ];
    const { cells } = buildFrame(placements, new NameAllocator({ prefix: "" }));
    const xCell = cells.find((c) => c.name === "X_MID")!;
    expect(xCell.expr).toEqual(nodeRef("a", "x"));
  });
});

describe("buildFrame — absolute frame", () => {
  it("drops the INBOUND term: a child keeps a plain world bearing regardless of the parent's own angle", () => {
    const placements: Placement[] = [
      { id: "p1", parent: "center", frame: "radial", offset: { kind: "polar", r: num(10), theta: num(45) }, label: "P1" },
      { id: "c1", parent: "p1", frame: "absolute", offset: { kind: "polar", r: num(5), theta: num(0) }, label: "C1" },
    ];
    const { cells, quantities } = buildFrame(placements, new NameAllocator({ prefix: "" }));
    const resolved = resolve(cells);
    const c1 = quantities.get("c1")!;
    // theta=0 under absolute means "due east of the parent" (world bearing
    // 0), NOT 45+180+0 the radial formula would give. Expected against the
    // SAME Bhaskara approximation the emitted macro uses (Sec.5.4), not real
    // trig. The two differ by up to 0.00163 (Sec.5.4's own measurement).
    const p1 = quantities.get("p1")!;
    expect(resolved.get(c1.xName)).toBe(resolved.get(p1.xName)! + 5 * cosFromTheta(0));
    expect(resolved.get(c1.yName)).toBe(resolved.get(p1.yName)! + 5 * sinFromTheta(0));
  });

  it("connecting never moves anything: theta chosen to reproduce the child's own current position stays put when the parent moves under radial, but NOT under absolute (that is the whole point of the two frames existing)", () => {
    // Documented as a property rather than asserted numerically here. The
    // "connecting never moves anything" UI promise (Sec.4.2) is a panel
    // behaviour (computing theta from a drag), not a frame.ts responsibility;
    // this test only pins that absolute and radial actually diverge once the
    // parent's own angle is non-zero, which is the property the two frames
    // exist to provide.
    const radial: Placement[] = [
      { id: "p1", parent: "center", frame: "radial", offset: { kind: "polar", r: num(10), theta: num(90) }, label: "P1" },
      { id: "c1", parent: "p1", frame: "radial", offset: { kind: "polar", r: num(5), theta: num(0) }, label: "C1" },
    ];
    const absolute: Placement[] = [
      radial[0],
      { id: "c1", parent: "p1", frame: "absolute", offset: { kind: "polar", r: num(5), theta: num(0) }, label: "C1" },
    ];
    const radialResolved = resolve(buildFrame(radial, new NameAllocator({ prefix: "" })).cells);
    const absoluteResolved = resolve(buildFrame(absolute, new NameAllocator({ prefix: "" })).cells);
    const rQ = buildFrame(radial, new NameAllocator({ prefix: "" })).quantities.get("c1")!;
    const aQ = buildFrame(absolute, new NameAllocator({ prefix: "" })).quantities.get("c1")!;
    expect(radialResolved.get(rQ.xName)).not.toBeCloseTo(absoluteResolved.get(aQ.xName)!, 3);
  });
});

describe("buildFrame — a radial polar child off a cartesian/formula parent falls back to a plain world bearing", () => {
  it("does not throw, and matches the top-level (no-parent-angle) formula exactly", () => {
    const placements: Placement[] = [
      { id: "anchor", parent: "center", frame: "radial", offset: { kind: "cartesian", dx: num(0), dy: num(0) }, label: "ANCHOR" },
      { id: "child", parent: "anchor", frame: "radial", offset: { kind: "polar", r: num(10), theta: num(30) }, label: "CHILD" },
    ];
    const { cells, quantities } = buildFrame(placements, new NameAllocator({ prefix: "" }));
    const resolved = resolve(cells);
    const anchor = quantities.get("anchor")!;
    const child = quantities.get("child")!;
    // theta=30 unmodified (no +180+INBOUND term, since the parent has no DEGREES).
    expect(resolved.get(child.xName)).toBe(resolved.get(anchor.xName)! + 10 * cosFromTheta(30));
  });
});
