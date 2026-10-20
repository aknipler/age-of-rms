// The side names and the x/y axis arrows drawn around the preview. Asserted
// against a recording mock, the same way drawOverlay.test.ts does, with the
// positions and angles checked against `latticeToScreen`, the projection every
// other draw call goes through.

import { describe, expect, it } from "vitest";
import { drawPreview } from "../drawPreview";
import {
  fitViewport,
  isOnMap,
  latticeToScreen,
  screenToTile,
  type Viewport,
} from "../projection";

interface Call {
  method: string;
  args: unknown[];
}

interface Text {
  x: number;
  y: number;
  /** Rotation in force when the text was drawn, radians. */
  angle: number;
}

/**
 * Records every call, and tracks the transform the way the real context
 * would for the one pattern drawOrientation uses: save, translate, rotate,
 * draw, restore. That is what turns `fillText(text, 0, 0)` into a position.
 */
function createMockCtx() {
  const calls: Call[] = [];
  const texts = new Map<string, Text>();
  const stack: { x: number; y: number; angle: number }[] = [];
  let state = { x: 0, y: 0, angle: 0 };
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  const ctx = {
    clearRect: record("clearRect"),
    fillRect: record("fillRect"),
    beginPath: record("beginPath"),
    closePath: record("closePath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    fill: record("fill"),
    stroke: record("stroke"),
    strokeText: record("strokeText"),
    save() {
      stack.push({ ...state });
    },
    restore() {
      state = stack.pop() ?? state;
    },
    translate(x: number, y: number) {
      state = { ...state, x: state.x + x, y: state.y + y };
    },
    rotate(angle: number) {
      state = { ...state, angle: state.angle + angle };
    },
    fillText(text: string) {
      texts.set(text, { ...state });
    },
  } as unknown as CanvasRenderingContext2D;
  for (const name of [
    "fillStyle",
    "strokeStyle",
    "lineWidth",
    "lineCap",
    "lineJoin",
    "font",
    "textAlign",
    "textBaseline",
  ]) {
    Object.defineProperty(ctx, name, {
      set(value: unknown) {
        calls.push({ method: `set ${name}`, args: [value] });
      },
    });
  }
  return { ctx, calls, texts };
}

const DIM = 200;

function draw(
  width: number,
  height: number,
  withOrientation: boolean,
  sideNames = true,
) {
  const { ctx, calls, texts } = createMockCtx();
  const viewport = fitViewport(DIM, width, height);
  drawPreview(ctx, viewport, {
    orientation: withOrientation ? { dim: DIM, sideNames } : undefined,
  });
  return { calls, texts, viewport };
}

/** The angle text turned to run along one side, read off the projection. */
function sideAngle(
  viewport: Viewport,
  from: [number, number],
  to: [number, number],
): number {
  const a = latticeToScreen(viewport, ...from);
  const b = latticeToScreen(viewport, ...to);
  let angle = Math.atan2(b.y - a.y, b.x - a.x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle <= -Math.PI / 2) angle += Math.PI;
  return angle;
}

function onMap(viewport: Viewport, point: { x: number; y: number }) {
  return isOnMap(screenToTile(viewport, point.x, point.y), DIM);
}

describe("map orientation aids", () => {
  it("puts each side name beside its own side, outside the map", () => {
    const { texts, viewport } = draw(288, 288, true);
    // The middle of each side. left_border is x = 0, bottom_border is
    // y = max, right_border is x = max, top_border is y = 0.
    const mids = {
      Left: latticeToScreen(viewport, 0, DIM / 2),
      Bottom: latticeToScreen(viewport, DIM / 2, DIM),
      Right: latticeToScreen(viewport, DIM, DIM / 2),
      Top: latticeToScreen(viewport, DIM / 2, 0),
    };
    for (const [name, mid] of Object.entries(mids)) {
      const at = texts.get(name);
      expect(at, name).toBeDefined();
      // Beside its own side, nearer to it than to any other.
      const distance = (point: { x: number; y: number }) =>
        Math.hypot(at!.x - point.x, at!.y - point.y);
      for (const other of Object.values(mids)) {
        if (other !== mid) expect(distance(mid)).toBeLessThan(distance(other));
      }
      // And never on the map.
      expect(onMap(viewport, at!), name).toBe(false);
    }
    // Left is the south west side and Top the north west one, so on screen
    // Left is the lower of the two, and Right the one to the east.
    expect(texts.get("Left")!.y).toBeGreaterThan(texts.get("Top")!.y);
    expect(texts.get("Bottom")!.y).toBeGreaterThan(texts.get("Right")!.y);
    expect(texts.get("Left")!.x).toBeLessThan(texts.get("Right")!.x);
  });

  it("turns every name to run along its side, upright", () => {
    const { texts, viewport } = draw(288, 288, true);
    expect(texts.get("Left")!.angle).toBeCloseTo(
      sideAngle(viewport, [0, 0], [0, DIM]),
    );
    expect(texts.get("Bottom")!.angle).toBeCloseTo(
      sideAngle(viewport, [0, DIM], [DIM, DIM]),
    );
    expect(texts.get("Right")!.angle).toBeCloseTo(
      sideAngle(viewport, [DIM, 0], [DIM, DIM]),
    );
    expect(texts.get("Top")!.angle).toBeCloseTo(
      sideAngle(viewport, [0, 0], [DIM, 0]),
    );
    // Never upside down.
    for (const name of ["Left", "Bottom", "Right", "Top", "x", "y"]) {
      const angle = texts.get(name)!.angle;
      expect(Math.abs(angle)).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it("draws x growing up and to the right, and y growing down and to the right", () => {
    const { texts, viewport } = draw(288, 288, true);
    const origin = latticeToScreen(viewport, 0, 0);
    const x = texts.get("x")!;
    const y = texts.get("y")!;

    // Read the expected directions off the projection rather than typing
    // them: one tile along +x, one tile along +y.
    const alongX = latticeToScreen(viewport, 1, 0);
    const alongY = latticeToScreen(viewport, 0, 1);
    expect(alongX.x).toBeGreaterThan(origin.x);
    expect(alongX.y).toBeLessThan(origin.y); // up the screen
    expect(alongY.x).toBeGreaterThan(origin.x);
    expect(alongY.y).toBeGreaterThan(origin.y); // down the screen

    // The letters sit at the arrow heads, which point the same way.
    expect(x.x).toBeGreaterThan(origin.x);
    expect(x.y).toBeLessThan(origin.y);
    expect(y.x).toBeGreaterThan(origin.x);
    expect(y.y).toBeGreaterThan(origin.y);
    // And run along the side the axis grows along.
    expect(x.angle).toBeCloseTo(sideAngle(viewport, [0, 0], [DIM, 0]));
    expect(y.angle).toBeCloseTo(sideAngle(viewport, [0, 0], [0, DIM]));
  });

  it("keeps every arrow point and axis letter off the map", () => {
    const { calls, texts, viewport } = draw(288, 288, true);
    // Without a base layer nothing else draws a path, so every moveTo and
    // lineTo here belongs to an arrow.
    const points = calls
      .filter((call) => call.method === "moveTo" || call.method === "lineTo")
      .map((call) => ({
        x: (call.args as number[])[0],
        y: (call.args as number[])[1],
      }));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) expect(onMap(viewport, point)).toBe(false);
    expect(onMap(viewport, texts.get("x")!)).toBe(false);
    expect(onMap(viewport, texts.get("y")!)).toBe(false);
  });

  it("points each arrow head along its own axis", () => {
    const { calls, viewport } = draw(288, 288, true);
    const origin = latticeToScreen(viewport, 0, 0);
    // A head is the one path that is moveTo(tip), lineTo, lineTo, closePath.
    const heads: { x: number; y: number }[] = [];
    calls.forEach((call, index) => {
      if (call.method !== "closePath") return;
      const move = calls[index - 3];
      if (move?.method !== "moveTo") return;
      const [x, y] = move.args as [number, number];
      heads.push({ x, y });
    });
    // Two arrows, each drawn twice (halo then ink).
    const tips = heads.filter((_, index) => index % 2 === 0);
    expect(tips).toHaveLength(2);
    const [xTip, yTip] = tips;
    expect(xTip.y).toBeLessThan(origin.y);
    expect(yTip.y).toBeGreaterThan(origin.y);
    expect(xTip.x).toBeGreaterThan(origin.x);
    expect(yTip.x).toBeGreaterThan(origin.x);
  });

  it("uses no colour for the arrows or any text", () => {
    const { calls } = draw(288, 288, true);
    const styles = calls
      .filter(
        (call) =>
          call.method === "set fillStyle" || call.method === "set strokeStyle",
      )
      .map((call) => String(call.args[0]))
      // The first fill is the canvas background, not an aid.
      .slice(1);
    expect(styles.length).toBeGreaterThan(0);
    for (const style of styles) {
      expect(style).toMatch(/^rgba\((255, 255, 255|0, 0, 0),/);
    }
  });

  it("draws only the axes when side names are not asked for", () => {
    const { texts } = draw(288, 288, true, false);
    expect([...texts.keys()].sort()).toEqual(["x", "y"]);
  });

  it("draws nothing extra unless asked", () => {
    const { texts, calls } = draw(288, 288, false);
    expect(texts.size).toBe(0);
    expect(calls.some((call) => call.method === "moveTo")).toBe(false);
  });

  it("drops the side names before the axes as the map shrinks", () => {
    // 220 px wide, so the map is about 208: room for the axes, not the names.
    const { texts } = draw(220, 220, true);
    expect([...texts.keys()].sort()).toEqual(["x", "y"]);
  });

  it("leaves the aids out when the map is too small to carry them", () => {
    // 100 px wide: the map is under the width the aids need.
    const { texts } = draw(100, 100, true);
    expect(texts.size).toBe(0);
  });
});
