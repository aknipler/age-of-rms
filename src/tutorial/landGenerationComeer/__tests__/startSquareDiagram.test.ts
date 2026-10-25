// The picture on "Fixing the island-joining problem" makes three claims. The
// two pairs of players are the same distance apart, the squares on the left
// overlap and those on the right do not, and the left one is lined up the way
// the pinned seed lines the players up in the preview. Each is checked here
// against the overlap rule, projection.ts and a real generation.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import type { ObjectConstant } from "../../../preview/generator/objects";
import { latticeToScreen } from "../../../preview/render/projection";
import {
  comeerScript,
  OVERSIZED_BASE_SIZE,
  PINNED_COMEER_SEED,
} from "../comeerValues";
import { createSeedCheckDeps } from "../seedCheckGenerate";
import {
  DIAGRAM_BASE_SIZE,
  startSquareDiagram,
  type TileCentre,
} from "../startSquareDiagram";

const geometry = startSquareDiagram();

function distance([a, b]: readonly TileCentre[]): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The larger of the x and y offsets, which decides whether two squares overlap. */
function chebyshev([a, b]: readonly TileCentre[]): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** A screen offset as an angle from straight down, 0 to 90 degrees. */
function angleFromVertical(dx: number, dy: number): number {
  return (Math.atan2(Math.abs(dx), Math.abs(dy)) * 180) / Math.PI;
}

describe("the start square diagram", () => {
  it("draws the squares the learner has at Spot the problem", () => {
    expect(DIAGRAM_BASE_SIZE).toBe(OVERSIZED_BASE_SIZE);
  });

  it("puts both pairs the same distance apart", () => {
    expect(distance(geometry.lined.players)).toBeCloseTo(
      distance(geometry.edge.players),
      6,
    );
  });

  it("overlaps the squares on the left and leaves water on the right, by the overlap rule", () => {
    const touching = 2 * DIAGRAM_BASE_SIZE;
    // An overlap two tiles deep or more, so it reads in the picture.
    expect(chebyshev(geometry.lined.players)).toBeLessThanOrEqual(touching - 2);
    expect(geometry.lined.overlap).not.toBeNull();
    // At least three tiles of water between the squares.
    expect(chebyshev(geometry.edge.players) - (touching + 1)).toBeGreaterThan(
      3,
    );
    expect(geometry.edge.overlap).toBeNull();
  });

  it("lines the left pair up one above the other on screen, and the right pair along an edge", () => {
    const [a, b] = geometry.lined.players.map((p) =>
      latticeToScreen(
        { width: 0, height: 0, halfWidth: 1, originX: 0, originY: 0 },
        p.x,
        p.y,
      ),
    );
    expect(angleFromVertical(a.x - b.x, a.y - b.y)).toBeCloseTo(0, 6);
    const [c, d] = geometry.edge.players.map((p) =>
      latticeToScreen(
        { width: 0, height: 0, halfWidth: 1, originX: 0, originY: 0 },
        p.x,
        p.y,
      ),
    );
    // A map edge runs at 45 degrees on screen.
    expect(angleFromVertical(c.x - d.x, c.y - d.y)).toBeCloseTo(45, 6);
  });

  it("lines the left pair up the way the pinned seed lines the players up", () => {
    const constants = (
      JSON.parse(
        readFileSync(
          join(REPO_ROOT, "reference", "data", "game-constants.json"),
          "utf8",
        ),
      ) as { constants: ObjectConstant[] }
    ).constants;
    const deps = createSeedCheckDeps(loadLanguage(), constants);
    const result = deps.generate(
      comeerScript({ baseSize: OVERSIZED_BASE_SIZE }),
      PINNED_COMEER_SEED,
      false,
    );
    const players = result.landOrigins.filter((o) => o.player !== undefined);
    expect(players).toHaveLength(2);
    const onScreen = (p: TileCentre) =>
      latticeToScreen(
        { width: 0, height: 0, halfWidth: 1, originX: 0, originY: 0 },
        p.x,
        p.y,
      );
    const [a, b] = players.map(onScreen);
    const [c, d] = geometry.lined.players.map(onScreen);
    // Compared with the picture, not with a fixed direction, so a picture
    // redrawn side by side fails here even though it would still be a
    // correct overlap. Within a few degrees, since the ring's one tile of
    // wobble keeps the seed from being exact.
    expect(
      Math.abs(
        angleFromVertical(a.x - b.x, a.y - b.y) -
          angleFromVertical(c.x - d.x, c.y - d.y),
      ),
    ).toBeLessThan(5);
  });
});
