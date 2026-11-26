// drawGridLines against a recording mock, the pattern drawOrientation.test.ts
// uses. End points are compared with latticeToScreen, the projection every
// other draw call goes through.

import { describe, expect, it } from "vitest";
import { drawGridLines } from "../drawPreview";
import { fitViewport, latticeToScreen } from "../projection";

function mockCtx() {
  const moves: [number, number][] = [];
  const lines: [number, number][] = [];
  const strokes: string[] = [];
  const state = { strokeStyle: "", lineWidth: 0 };
  const ctx = {
    beginPath() {
      moves.length = 0;
      lines.length = 0;
    },
    moveTo: (x: number, y: number) => moves.push([x, y]),
    lineTo: (x: number, y: number) => lines.push([x, y]),
    stroke: () => strokes.push(state.strokeStyle),
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, moves, lines, strokes, state };
}

describe("drawGridLines", () => {
  const dim = 4;
  const vp = fitViewport(dim, 400, 300);

  it("draws 5 lines each way on a flat 4 by 4 map, end points on the lattice", () => {
    const m = mockCtx();
    drawGridLines(m.ctx, vp, dim, "dark");
    expect(m.moves).toHaveLength(10);
    expect(m.lines).toHaveLength(10);
    expect(m.strokes).toEqual(["rgba(0, 0, 0, 0.5)"]);
    expect(m.state.lineWidth).toBe(1);
    // First line of constant x: lattice (0,0) to (0,4).
    const a = latticeToScreen(vp, 0, 0);
    const b = latticeToScreen(vp, 0, dim);
    expect(m.moves[0]).toEqual([a.x, a.y]);
    expect(m.lines[0]).toEqual([b.x, b.y]);
    // First line of constant y: lattice (0,0) to (4,0).
    const c = latticeToScreen(vp, dim, 0);
    expect(m.moves[5]).toEqual([a.x, a.y]);
    expect(m.lines[5]).toEqual([c.x, c.y]);
  });

  it("follows raised ground with more than two points per line", () => {
    const m = mockCtx();
    const corners = new Float32Array((dim + 1) * (dim + 1));
    for (let i = 0; i < corners.length; i++) corners[i] = i % 3;
    drawGridLines(
      m.ctx,
      { ...vp, ground: { dim, corners, maxLevel: 2 } },
      dim,
      "dark",
    );
    // A flat map has one lineTo per line, the raised one has one per step.
    expect(m.lines.length).toBeGreaterThan(m.moves.length);
  });

  it("strokes nothing for none", () => {
    const m = mockCtx();
    drawGridLines(m.ctx, vp, dim, "none");
    expect(m.strokes).toHaveLength(0);
  });
});
