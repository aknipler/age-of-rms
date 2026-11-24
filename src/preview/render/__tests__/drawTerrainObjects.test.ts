// The terrain object layer of the canvas (preview-design Sec.6.6, rev 12),
// against the same kind of recording mock drawOverlay.test.ts uses, since
// jsdom's canvas has no 2D context.

import { describe, expect, it } from "vitest";
import type {
  PreviewWireResult,
  StageSnapshot,
  TerrainObjectLayer,
} from "../../generator/types";
import { drawPreview } from "../drawPreview";
import { fitViewport, latticeToScreen } from "../projection";

function createMockCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => {
      if (prop === "canvas") return { width: 400, height: 400 };
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
      };
    },
    set: (_t, prop, value) => {
      calls.push({ method: `set ${String(prop)}`, args: [value] });
      return true;
    },
  };
  return {
    ctx: new Proxy({}, handler) as CanvasRenderingContext2D,
    calls,
  };
}

const dim = 20;
const viewport = fitViewport(dim, 400, 400);

const layer: TerrainObjectLayer = {
  kind: new Uint16Array([0, 0, 1]),
  x: new Float32Array([3.5, 4.5, 10.5]),
  y: new Float32Array([3.5, 4.5, 2.5]),
  kinds: [
    { id: 411, objectRef: "OAK_FOREST_TREE", category: "resource-wood" },
    { id: 1351, objectRef: "object 1351", category: "decoration" },
  ],
};

function scene(hidden?: ReadonlySet<string>) {
  const result = {
    dim,
    objects: [],
    players: [],
    failureMarks: [],
    terrainObjects: layer,
  } as unknown as PreviewWireResult;
  return {
    base: {
      result,
      snapshot: { dim } as unknown as StageSnapshot,
      terrain: {} as HTMLCanvasElement,
      hiddenObjects: hidden,
    },
  };
}

const arcs = (calls: { method: string; args: unknown[] }[]) =>
  calls
    .filter((c) => c.method === "arc")
    .map((c) => c.args as [number, number, number]);

/** A scene with one scripted object at tile 7, 7, to compare sizes against. */
function sceneWithObject() {
  const s = scene();
  (s.base.result as unknown as { objects: unknown[] }).objects = [
    { x: 7, y: 7, objectRef: "GOLD", category: "resource-gold" },
  ];
  return s;
}

describe("drawTerrainObjects", () => {
  it("draws one circle per terrain object, centred on its own position", () => {
    const { ctx, calls } = createMockCtx();
    drawPreview(ctx, viewport, scene());
    const drawn = arcs(calls);
    expect(drawn).toHaveLength(3);
    // The positions are continuous, so no half tile is added on top. With
    // `tileToScreen` each circle would sit half a tile further on.
    const [x, y] = drawn[0];
    const centre = latticeToScreen(viewport, 3.5, 3.5);
    expect(x).toBeCloseTo(centre.x, 6);
    expect(y).toBeCloseTo(centre.y, 6);
  });

  it("draws a terrain object as large as a scripted one", () => {
    // At this zoom and closer in, where the old squares were smaller.
    for (const halfWidth of [2, 6, 20]) {
      const { ctx, calls } = createMockCtx();
      drawPreview(ctx, { ...viewport, halfWidth }, sceneWithObject());
      const radii = new Set(arcs(calls).map((a) => a[2]));
      // Three terrain objects and one scripted, all one size.
      expect(arcs(calls)).toHaveLength(4);
      expect(radii.size).toBe(1);
    }
  });

  it("fills once per colour, not once per object", () => {
    const { ctx, calls } = createMockCtx();
    drawPreview(ctx, viewport, scene());
    // Two colours here, wood and decoration, so two fills before the rest of
    // the scene draws (no objects, players or marks in it).
    expect(calls.filter((c) => c.method === "fill")).toHaveLength(2);
  });

  it("leaves out decorations when they are hidden, and keeps resources", () => {
    const { ctx, calls } = createMockCtx();
    const s = scene();
    drawPreview(ctx, viewport, {
      base: { ...s.base, hideDecorations: true },
    });
    // The oak trees stay (wood), the one decoration goes.
    expect(arcs(calls)).toHaveLength(2);
  });

  it("leaves out a kind the Obj. List hides", () => {
    const { ctx, calls } = createMockCtx();
    drawPreview(ctx, viewport, scene(new Set(["OAK_FOREST_TREE"])));
    expect(arcs(calls)).toHaveLength(1);
  });
});
