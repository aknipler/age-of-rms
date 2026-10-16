// docs/tutorial-islands-design.md Sec.5. The regression gate for the Comeer
// tutorial's planted problem. If the preview engine changes so the pinned seed
// stops showing what the copy says, this goes red and names the sentence that
// broke.
//
// A check that has only ever passed proves nothing (CLAUDE.md, mutation-test
// rule), so half of this file is the same checks run against generators that
// are broken on purpose, to show each one can fail.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import type { ObjectConstant } from "../../../preview/generator/objects";
import {
  COMEER,
  comeerScript,
  NEUTRAL_TOP_BORDER_FIX,
  OVERSIZED_BASE_SIZE,
  PINNED_COMEER_SEED,
  RANGES,
  START_COMEER_SEED,
} from "../comeerValues";
import { createSeedCheckDeps } from "../seedCheckGenerate";
import {
  diagonalOffset,
  findComeerSeed,
  inspectNeutralBorders,
  inspectSeed,
  playerWaterGap,
  readS1,
  verifyOrFindSeed,
  type SeedCheckDeps,
} from "../seedCheck";

const constants = (
  JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as { constants: ObjectConstant[] }
).constants;
const deps = createSeedCheckDeps(loadLanguage(), constants);

/** The real generator with the script text rewritten first, which is how a defect in one attribute's handling is simulated without touching the engine. */
function mutant(rewrite: (source: string) => string): SeedCheckDeps {
  return {
    ...deps,
    generate: (source, seed, snapshots) =>
      deps.generate(rewrite(source), seed, snapshots),
  };
}

function failed(report: ReturnType<typeof inspectSeed>): string[] {
  return report.properties.filter((p) => !p.ok).map((p) => p.name);
}

/**
 * For the tests that search. Measured alone 2026-10-14 at 2.2 to 3.0 s, now
 * that a search from seed 1 walks to 55 and fully inspects the failing
 * diagonal seeds on the way. Under the full suite's load the default 5 s was
 * not enough, so this is about ten times the measured cost.
 */
const SEARCH_TIMEOUT_MS = 30_000;

describe("the pinned seed", () => {
  it("shows every property the tutorial copy relies on", () => {
    const report = inspectSeed(deps, PINNED_COMEER_SEED);
    // The message names the broken sentence and its measured detail.
    expect(
      report.properties
        .filter((p) => !p.ok)
        .map((p) => `${p.name}: ${p.detail}`),
    ).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("is reproducible, since the whole design assumes a seed is a fixed arrangement", () => {
    expect(inspectSeed(deps, PINNED_COMEER_SEED)).toEqual(
      inspectSeed(deps, PINNED_COMEER_SEED),
    );
  });
});

describe("the starting seed", () => {
  // The only seed-dependent properties the planted problem owns. Everything
  // else inspectSeed asserts is a claim an early step makes too, so the start
  // seed must pass all of it.
  const PLANTED = (name: string): boolean =>
    name === "players-on-a-diagonal" ||
    name === "overlap-is-two-tiles-deep" ||
    name.startsWith("oversized-islands-fuse-");

  it("is not a diagonal arrangement, so the avoidance step does not already show the planted problem", () => {
    const result = deps.generate(
      comeerScript({ baseSize: OVERSIZED_BASE_SIZE }),
      START_COMEER_SEED,
      false,
    );
    expect(diagonalOffset(result)).toBeNull();
    // The geometry behind it. The squares only overlap when the players are
    // closer than a square's width on both axes at once.
    const [a, b] = result.landOrigins.filter((o) => o.player !== undefined);
    expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeGreaterThan(
      2 * OVERSIZED_BASE_SIZE + 1,
    );
    expect(START_COMEER_SEED).not.toBe(PINNED_COMEER_SEED);
  });

  it("keeps every claim the early steps make, and fails only the planted-problem ones", () => {
    const report = inspectSeed(deps, START_COMEER_SEED);
    const other = report.properties.filter((p) => !p.ok && !PLANTED(p.name));
    expect(other.map((p) => `${p.name}: ${p.detail}`)).toEqual([]);
    expect(failed(report)).toContain("players-on-a-diagonal");
  });

  it("leaves a clear channel between the oversized player islands at every adherence the tutorial uses", () => {
    for (const fuzz of [
      RANGES.borderFuzziness.min,
      COMEER.player.borderFuzziness,
      RANGES.borderFuzziness.max,
    ]) {
      const reading = readS1(
        deps.generate(
          comeerScript({
            baseSize: OVERSIZED_BASE_SIZE,
            borderFuzziness: fuzz,
          }),
          START_COMEER_SEED,
          true,
        ),
        deps.waterId,
      );
      // Null means the islands fused. The avoidance distance is 3, so a
      // channel of at least 2 water tiles is what the step promises.
      expect(
        playerWaterGap(reading),
        `adherence ${fuzz}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("the finder", () => {
  it(
    "finds a passing seed from scratch, which is the self-repair path at tutorial start",
    () => {
      const found = findComeerSeed(deps, { from: 1, limit: 400 });
      expect(found).not.toBeNull();
      expect(inspectSeed(deps, found!.seed).ok).toBe(true);
    },
    SEARCH_TIMEOUT_MS,
  );

  it("verifyOrFindSeed keeps the pinned seed when it still passes", () => {
    expect(verifyOrFindSeed(deps, [PINNED_COMEER_SEED])).toEqual({
      status: "pinned",
      seed: PINNED_COMEER_SEED,
    });
  });

  it("verifyOrFindSeed moves past a failing candidate to a passing one without searching", () => {
    // Seed 1 fails (not a diagonal). A search would take a limit of 0 and
    // find nothing, so a "pinned" answer can only come from the candidates.
    expect(
      verifyOrFindSeed(deps, [1, PINNED_COMEER_SEED], { limit: 0 }),
    ).toEqual({ status: "pinned", seed: PINNED_COMEER_SEED });
  });

  it(
    "verifyOrFindSeed replaces a pinned seed that does not pass",
    () => {
      // Seed 1 is not a diagonal arrangement, so it cannot show the planted problem.
      const outcome = verifyOrFindSeed(deps, [1], { from: 1, limit: 400 });
      expect(outcome.status).toBe("found");
      if (outcome.status === "found") {
        expect(outcome.seed).not.toBe(1);
        expect(inspectSeed(deps, outcome.seed).ok).toBe(true);
      }
    },
    SEARCH_TIMEOUT_MS,
  );
});

describe("each check can fail (mutants)", () => {
  it("rejects a seed whose players are not on a diagonal", () => {
    const report = inspectSeed(deps, 1);
    expect(report.ok).toBe(false);
    expect(failed(report)).toContain("players-on-a-diagonal");
  });

  it("notices when an oversized base_size no longer fuses the islands", () => {
    const report = inspectSeed(
      mutant((s) =>
        s.replace(`base_size ${OVERSIZED_BASE_SIZE}`, "base_size 6"),
      ),
      PINNED_COMEER_SEED,
    );
    expect(failed(report)).toContain("oversized-islands-fuse-at-adherence-20");
  });

  it("notices when behavior_version stops shrinking the islands", () => {
    // With the line gone both scripts are version 0, so nothing shrinks.
    const report = inspectSeed(
      mutant((s) => s.replace("behavior_version 1\n", "")),
      PINNED_COMEER_SEED,
    );
    expect(failed(report)).toContain("behavior-version-1-shrinks-the-islands");
  });

  it("notices when the safe base_size range stops being safe", () => {
    // Every base_size becomes the oversized one, so the "safe" values fuse.
    const report = inspectSeed(
      mutant((s) =>
        s.replace(/base_size (7|9)\b/g, `base_size ${OVERSIZED_BASE_SIZE}`),
      ),
      PINNED_COMEER_SEED,
    );
    expect(failed(report).some((n) => n.startsWith("base-size-"))).toBe(true);
  });

  it("notices when borders stop doing anything", () => {
    const report = inspectSeed(
      mutant((s) => s.replace(/^\s*(left|right|top|bottom)_border .*\n/gm, "")),
      PINNED_COMEER_SEED,
    );
    expect(failed(report)).toContain("border-12-leaves-a-lane");
  });

  it("notices when the wrong border values stop being visibly wrong", () => {
    // Every border becomes 20, so the "too small" values leave a wide lane.
    const report = inspectSeed(
      mutant((s) => s.replace(/_border \d+/g, "_border 20")),
      PINNED_COMEER_SEED,
    );
    expect(failed(report)).toContain("border-4-is-visibly-too-small");
  });

  it("notices when a neutral island fuses with another land", () => {
    const report = inspectSeed(
      // Growth alone does not fuse zones (the avoidance distance holds them
      // apart, which is itself worth knowing), so the mutant removes the
      // separation too, one shared zone and no avoidance distance, on islands
      // ten times the size.
      mutant((s) =>
        s
          .replace(/land_percent 6\b/g, "land_percent 60")
          .replace(
            /other_zone_avoidance_distance 10/g,
            "other_zone_avoidance_distance 0",
          )
          .replace(/zone [1-4]\b/g, "zone 1"),
      ),
      PINNED_COMEER_SEED,
    );
    expect(
      failed(report).some((n) => n.startsWith("six-separate-islands")),
    ).toBe(true);
  });

  describe("the bordered neutral island", () => {
    const max = RANGES.neutralBorder.max;
    const min = RANGES.neutralBorder.min;

    const fix = NEUTRAL_TOP_BORDER_FIX;
    /** The neutral island's borders are the only ones in the range's 70s. */
    const NEUTRAL_RIGHT = / {2}right_border 7\d\n/g;

    it("notices when the corner cut stops showing at the map edge", () => {
      const report = inspectSeed(
        mutant((s) =>
          s.replace(NEUTRAL_RIGHT, (line) => `  top_border -20\n${line}`),
        ),
        PINNED_COMEER_SEED,
      );
      expect(failed(report)).toContain(
        `neutral-border-${min}-cuts-the-corner-at-the-map-edge`,
      );
    });

    it("notices when a negative top_border stops moving the cut off the map", () => {
      const report = inspectSeed(
        mutant((s) =>
          s.replace(new RegExp(`top_border ${fix}\\b`, "g"), "top_border 0"),
        ),
        PINNED_COMEER_SEED,
      );
      expect(failed(report)).toContain(
        `top-border-${fix}-moves-the-cut-off-the-map-at-${max}`,
      );
    });

    it("notices when one above the fix stops leaving a notch", () => {
      const report = inspectSeed(
        mutant((s) =>
          s.replace(
            new RegExp(`top_border ${fix + 1}\\b`, "g"),
            "top_border -20",
          ),
        ),
        PINNED_COMEER_SEED,
      );
      expect(failed(report)).toContain(
        `top-border-${fix + 1}-leaves-a-notch-at-${min}`,
      );
    });

    // The size claims hold over a sample and not on one seed. 22 seeds at
    // both ends of the near corner span, 44 runs a border. The range was
    // set on 378 runs (comeerValues.ts), and this keeps the claim honest
    // without paying for all of them on every test run.
    const sample = [
      PINNED_COMEER_SEED,
      START_COMEER_SEED,
      ...Array.from({ length: 20 }, (_, i) => i + 1),
    ];
    const NEUTRAL_SAMPLE_TIMEOUT_MS = 180_000;
    const failedOf = (properties: { name: string; ok: boolean }[]) =>
      properties.filter((p) => !p.ok).map((p) => p.name);

    it(
      "proves the range stops the wild growth and keeps the island its size",
      () => {
        const properties = inspectNeutralBorders(deps, sample);
        expect(
          properties.filter((p) => !p.ok).map((p) => `${p.name}: ${p.detail}`),
        ).toEqual([]);
        expect(properties.length).toBe(6);
      },
      NEUTRAL_SAMPLE_TIMEOUT_MS,
    );

    it(
      "notices when the borders stop doing anything",
      () => {
        const properties = inspectNeutralBorders(
          mutant((s) => s.replace(/ {2}(right|bottom)_border 7\d\n/g, "")),
          sample,
        );
        expect(failedOf(properties)).toContain(
          `neutral-border-${min}-stops-the-wild-growth`,
        );
      },
      NEUTRAL_SAMPLE_TIMEOUT_MS,
    );

    it(
      "notices when a border shrinks the island",
      () => {
        // Well past the range. 78 already measured 12% smaller on average.
        const properties = inspectNeutralBorders(
          mutant((s) =>
            s.replace(new RegExp(`_border ${max}\\b`, "g"), "_border 80"),
          ),
          sample,
        );
        expect(failedOf(properties)).toContain(
          `neutral-border-${max}-keeps-the-island-its-size`,
        );
      },
      NEUTRAL_SAMPLE_TIMEOUT_MS,
    );
  });

  it(
    "reports none, with the failing names, when nothing can pass",
    () => {
      const broken = mutant((s) => s.replace(/base_size \d+/g, "base_size 6"));
      const outcome = verifyOrFindSeed(broken, [PINNED_COMEER_SEED], {
        from: 1,
        limit: 60,
      });
      expect(outcome.status).toBe("none");
      if (outcome.status === "none")
        expect(outcome.failed.length).toBeGreaterThan(0);
    },
    SEARCH_TIMEOUT_MS,
  );
});

describe("the avoidance gap check (mutants)", () => {
  it("notices when the players' avoidance distance stops holding the islands apart", () => {
    const report = inspectSeed(
      mutant((s) =>
        s.replace(
          "other_zone_avoidance_distance 3",
          "other_zone_avoidance_distance 0",
        ),
      ),
      PINNED_COMEER_SEED,
    );
    expect(
      failed(report).some((n) => n.includes("keeps-the-avoidance-gap")),
    ).toBe(true);
  });

  it("holds at the top of the stated range and no longer one above it on the pinned seed", () => {
    // The edge of the stated range, so the range cannot quietly widen again.
    // On seed 217 the top, 9, keeps DE's gap and 10 leaves 1 tile (2026-10-14).
    const top = RANGES.safeBaseSize.max;
    const at = (baseSize: number) =>
      inspectSeed(
        mutant((s) => s.replace(/base_size 9\b/g, `base_size ${baseSize}`)),
        PINNED_COMEER_SEED,
      ).properties.find(
        (p) => p.name === "base-size-9-keeps-the-avoidance-gap-at-adherence-20",
      );
    expect(at(top)?.ok).toBe(true);
    expect(at(top + 1)?.ok).toBe(false);
  });
});
