import { describe, expect, it } from "vitest";
import { adaptiveDebounceMs, circlesFromOverlay, hitTestCircles } from "../canvasGeometry";

describe("adaptiveDebounceMs", () => {
  it("starts at the fixed initial guess before any measurement exists", () => {
    expect(adaptiveDebounceMs(null)).toBe(250);
  });

  it("floors at 100ms for a fast script", () => {
    expect(adaptiveDebounceMs(49)).toBe(100);
    expect(adaptiveDebounceMs(0)).toBe(100);
  });

  it("uses the measured duration once it exceeds the floor", () => {
    expect(adaptiveDebounceMs(1279)).toBe(1279);
    expect(adaptiveDebounceMs(150)).toBe(150);
  });
});

describe("circlesFromOverlay / hitTestCircles", () => {
  it("extracts only id-bearing circle shapes", () => {
    const shapes = circlesFromOverlay([
      { id: "P1", kind: "circle", x: 10, y: 10, rTiles: 5, role: "primary" },
      { kind: "line", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, role: "muted" },
      { kind: "circle", x: 20, y: 20, rTiles: 3, role: "primary" }, // no id, not hit-testable
    ]);
    expect(shapes).toEqual([{ id: "P1", x: 10, y: 10, rTiles: 5 }]);
  });

  it("selects the smallest circle containing the click", () => {
    const circles = [
      { id: "outer", x: 0, y: 0, rTiles: 10 },
      { id: "inner", x: 0, y: 0, rTiles: 2 },
    ];
    expect(hitTestCircles({ x: 1, y: 0 }, circles)).toBe("inner");
    expect(hitTestCircles({ x: 5, y: 0 }, circles)).toBe("outer");
  });

  it("returns null when nothing contains the click", () => {
    expect(hitTestCircles({ x: 50, y: 50 }, [{ id: "P1", x: 0, y: 0, rTiles: 5 }])).toBeNull();
  });

  it("treats the boundary itself as a hit", () => {
    expect(hitTestCircles({ x: 5, y: 0 }, [{ id: "P1", x: 0, y: 0, rTiles: 5 }])).toBe("P1");
  });
});
