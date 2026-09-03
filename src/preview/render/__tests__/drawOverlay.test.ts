// Sec.3.4 layer 2: OverlayShape -> screen, exercised without a real canvas.
// jsdom's `getContext("2d")` returns null (no `canvas` native module in this
// tree, see CLAUDE.md's sandbox notes), so this asserts against a minimal
// mock implementing exactly the CanvasRenderingContext2D surface drawPreview
// calls, and checks the SCREEN coordinates each draw call receives against
// `tileToScreen` (projection.ts) directly, which is the ground truth this
// module must never disagree with (slice-4-brief §4 item 2's own framing:
// "the overlay cannot disagree with what will be emitted", the geometric
// analogue of that rule).

import { describe, expect, it } from "vitest";
import type { OverlayShape } from "../../../../tools-api/index";
import { drawPreview } from "../drawPreview";
import { fitViewport, tileToScreen } from "../projection";

/** Records every call made to it; enough of CanvasRenderingContext2D's surface for drawPreview/drawOverlay to run against. */
function createMockCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const ctx = {
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    arc: record("arc"),
    rect: record("rect"),
    fill: record("fill"),
    stroke: record("stroke"),
    setLineDash: record("setLineDash"),
    fillText: record("fillText"),
    drawImage: record("drawImage"),
    transform: record("transform"),
    set fillStyle(v: unknown) {
      calls.push({ method: "set fillStyle", args: [v] });
    },
    set strokeStyle(v: unknown) {
      calls.push({ method: "set strokeStyle", args: [v] });
    },
    set lineWidth(v: unknown) {
      calls.push({ method: "set lineWidth", args: [v] });
    },
    set font(v: unknown) {
      calls.push({ method: "set font", args: [v] });
    },
    set textAlign(v: unknown) {
      calls.push({ method: "set textAlign", args: [v] });
    },
    set textBaseline(v: unknown) {
      calls.push({ method: "set textBaseline", args: [v] });
    },
    set imageSmoothingEnabled(v: unknown) {
      calls.push({ method: "set imageSmoothingEnabled", args: [v] });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const viewport = fitViewport(20, 400, 400);

function arcCalls(calls: { method: string; args: unknown[] }[]) {
  return calls.filter((c) => c.method === "arc").map((c) => c.args as [number, number, number, number, number]);
}

describe("drawOverlay (Sec.3.4 layer 2)", () => {
  it("draws a point at its screen position", () => {
    const { ctx, calls } = createMockCtx();
    const shapes: OverlayShape[] = [{ kind: "point", x: 5, y: 5, role: "primary" }];
    drawPreview(ctx, viewport, { overlayShapes: shapes });
    const expected = tileToScreen(viewport, 5, 5);
    const arcs = arcCalls(calls);
    expect(arcs).toHaveLength(1);
    expect(arcs[0][0]).toBeCloseTo(expected.x);
    expect(arcs[0][1]).toBeCloseTo(expected.y);
  });

  it("draws a circle centred on its tile with a positive screen radius", () => {
    const { ctx, calls } = createMockCtx();
    const shapes: OverlayShape[] = [{ id: "p1", kind: "circle", x: 10, y: 10, rTiles: 2, role: "primary" }];
    drawPreview(ctx, viewport, { overlayShapes: shapes });
    const expected = tileToScreen(viewport, 10, 10);
    const arcs = arcCalls(calls);
    expect(arcs).toHaveLength(1);
    expect(arcs[0][0]).toBeCloseTo(expected.x);
    expect(arcs[0][1]).toBeCloseTo(expected.y);
    expect(arcs[0][2]).toBeGreaterThan(0);
  });

  it("fills a circle only when shape.fill is set", () => {
    const unfilled = createMockCtx();
    drawPreview(unfilled.ctx, viewport, {
      overlayShapes: [{ kind: "circle", x: 1, y: 1, rTiles: 1, role: "primary" }],
    });
    expect(unfilled.calls.filter((c) => c.method === "fill")).toHaveLength(0);

    const filled = createMockCtx();
    drawPreview(filled.ctx, viewport, {
      overlayShapes: [{ kind: "circle", x: 1, y: 1, rTiles: 1, role: "primary", fill: true }],
    });
    expect(filled.calls.filter((c) => c.method === "fill")).toHaveLength(1);
  });

  it("draws a line between the screen positions of its two endpoints", () => {
    const { ctx, calls } = createMockCtx();
    const shapes: OverlayShape[] = [
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, role: "muted" },
    ];
    drawPreview(ctx, viewport, { overlayShapes: shapes });
    const from = tileToScreen(viewport, 0, 0);
    const to = tileToScreen(viewport, 5, 5);
    const moveTo = calls.find((c) => c.method === "moveTo")!.args;
    const lineTo = calls.find((c) => c.method === "lineTo")!.args;
    expect(moveTo[0]).toBeCloseTo(from.x);
    expect(moveTo[1]).toBeCloseTo(from.y);
    expect(lineTo[0]).toBeCloseTo(to.x);
    expect(lineTo[1]).toBeCloseTo(to.y);
  });

  it("dashes a line only when shape.dashed is set", () => {
    const plain = createMockCtx();
    drawPreview(plain.ctx, viewport, {
      overlayShapes: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, role: "muted" }],
    });
    expect(plain.calls.some((c) => c.method === "setLineDash")).toBe(false);

    const dashed = createMockCtx();
    drawPreview(dashed.ctx, viewport, {
      overlayShapes: [{ kind: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, role: "muted", dashed: true }],
    });
    expect(dashed.calls.some((c) => c.method === "setLineDash")).toBe(true);
  });

  it("walks a polyline's points in order and closes it only when asked", () => {
    const open = createMockCtx();
    drawPreview(open.ctx, viewport, {
      overlayShapes: [
        { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], role: "primary" },
      ],
    });
    expect(open.calls.filter((c) => c.method === "moveTo")).toHaveLength(1);
    expect(open.calls.filter((c) => c.method === "lineTo")).toHaveLength(2);
    expect(open.calls.some((c) => c.method === "closePath")).toBe(false);

    const closed = createMockCtx();
    drawPreview(closed.ctx, viewport, {
      overlayShapes: [
        { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], role: "primary", closed: true },
      ],
    });
    expect(closed.calls.some((c) => c.method === "closePath")).toBe(true);
  });

  it("draws nothing for an empty polyline rather than throwing", () => {
    const { ctx, calls } = createMockCtx();
    expect(() =>
      drawPreview(ctx, viewport, { overlayShapes: [{ kind: "polyline", points: [], role: "primary" }] }),
    ).not.toThrow();
    expect(calls.some((c) => c.method === "moveTo")).toBe(false);
  });

  it("draws a label's text at its screen position", () => {
    const { ctx, calls } = createMockCtx();
    drawPreview(ctx, viewport, { overlayShapes: [{ kind: "label", x: 3, y: 4, text: "P1", role: "primary" }] });
    const fillText = calls.find((c) => c.method === "fillText")!.args;
    expect(fillText[0]).toBe("P1");
    const expected = tileToScreen(viewport, 3, 4);
    expect(fillText[1]).toBeCloseTo(expected.x);
  });

  it("draws a handle as a small rect centred on its tile", () => {
    const { ctx, calls } = createMockCtx();
    drawPreview(ctx, viewport, { overlayShapes: [{ id: "h1", kind: "handle", x: 6, y: 6, role: "secondary" }] });
    expect(calls.some((c) => c.method === "rect")).toBe(true);
  });

  it("draws nothing at all when overlayShapes is omitted or empty", () => {
    const omitted = createMockCtx();
    drawPreview(omitted.ctx, viewport, {});
    expect(arcCalls(omitted.calls)).toHaveLength(0);

    const empty = createMockCtx();
    drawPreview(empty.ctx, viewport, { overlayShapes: [] });
    expect(arcCalls(empty.calls)).toHaveLength(0);
  });

  it("draws every shape when there is no base layer at all — a pure overlay canvas", () => {
    const { ctx, calls } = createMockCtx();
    const shapes: OverlayShape[] = [
      { kind: "point", x: 1, y: 1, role: "primary" },
      { kind: "circle", x: 2, y: 2, rTiles: 1, role: "primary" },
    ];
    expect(() => drawPreview(ctx, viewport, { overlayShapes: shapes })).not.toThrow();
    expect(arcCalls(calls)).toHaveLength(2);
    // No base layer means drawImage (the terrain bitmap) is never called.
    expect(calls.some((c) => c.method === "drawImage")).toBe(false);
  });
});
