// slice-4 brief item 3 acceptance: "a pure model + parse → TextEdit[]
// covering both kinds; every edit passes validateEdits (protocol.ts); Apply
// twice produces zero edits the second time (Sec.10.4 #4, assert on the edit
// array being empty, not on the resulting text matching); a hand-edited
// create_land is detected as detached rather than silently re-emitted."

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import type { TextEdit } from "../../../../../tools-api/index";
import { validateEdits } from "../../../protocol";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../parser/language";
import { parseRms } from "../../../../parser/parser";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import { createTileGrid } from "../../../../preview/generator/grid";
import { placeLandOrigins } from "../../../../preview/generator/lands";
import type { ObjectConstant } from "../../../../preview/generator/objects";
import { computeApplyEdits } from "../applyEdits";
import { addRing } from "../panel/modelOps";
const NL = String.fromCharCode(10);
import type { AlpModel } from "../fence";
import type { LandRole, Placement } from "../model";

const lang = loadLanguage();

/** Applies a TextEdit[] the same way Monaco's pushEditOperations does, all offsets in ORIGINAL document coordinates, applied back-to-front so earlier offsets stay valid. */
function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let text = source;
  for (const e of sorted) {
    text = text.slice(0, e.start) + e.newText + text.slice(e.end);
  }
  return text;
}

function role(over: Partial<LandRole> = {}): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: { k: "num", v: 12 },
    baseElevation: { k: "num", v: 9 },
    extent: { kind: "percent", value: { k: "num", v: 8 } },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
    ...over,
  };
}

function twoPlayerModel(): AlpModel {
  const placements: Placement[] = [
    {
      id: "P1",
      parent: "center",
      frame: "radial",
      label: "P1",
      role: "player",
      repeatIndex: 0,
      offset: {
        kind: "polar",
        r: { k: "num", v: 26 },
        theta: { k: "num", v: 0 },
      },
    },
    {
      id: "P2",
      parent: "center",
      frame: "radial",
      label: "P2",
      role: "player",
      repeatIndex: 1,
      offset: {
        kind: "polar",
        r: { k: "num", v: 26 },
        theta: { k: "num", v: 180 },
      },
    },
  ];
  return { v: 1, placements, roles: [role()], randomParams: [], groups: [] };
}

describe("computeApplyEdits — the whole edit set (Sec.6.1, Sec.6.2)", () => {
  it("produces both kinds of edit on a fresh script with a <LAND_GENERATION> section", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<OBJECTS_GENERATION>\n";
    const parse = parseRms(source, lang);
    const { edits, emissionProblems } = computeApplyEdits(
      parse,
      twoPlayerModel(),
      lang,
      new Map(),
      2,
    );

    expect(emissionProblems).toEqual([]);
    // At least one fence edit (new fence) and one skeleton-insertion edit.
    expect(edits.length).toBeGreaterThanOrEqual(2);

    const check = validateEdits(edits, source.length);
    expect(check.ok).toBe(true);

    const result = applyEdits(source, edits);
    expect(result).toContain("@alp v1 begin");
    expect(result).toContain("create_land");
    expect((result.match(/create_land/g) ?? []).length).toBe(2);

    // The fence's #consts precede both create_land skeletons, Sec.6.1's one
    // constraint. Every land uses ALP_ROLE_TERRAIN_PLAYER etc., defined in
    // the fence, so this also proves ordering rather than merely presence.
    const fenceEnd = result.indexOf("@alp end");
    const firstCreateLand = result.indexOf("create_land");
    expect(fenceEnd).toBeGreaterThan(-1);
    expect(firstCreateLand).toBeGreaterThan(fenceEnd);

    // The fence lands in the HEADER (before the first section), the
    // skeletons inside <LAND_GENERATION>, before <OBJECTS_GENERATION>
    // (2026-09-22: the fence used to open the land section itself).
    const playerSetupIdx = result.indexOf("<PLAYER_SETUP>");
    const landGenIdx = result.indexOf("<LAND_GENERATION>");
    const objGenIdx = result.indexOf("<OBJECTS_GENERATION>");
    expect(fenceEnd).toBeLessThan(playerSetupIdx);
    expect(firstCreateLand).toBeGreaterThan(landGenIdx);
    expect(firstCreateLand).toBeLessThan(objGenIdx);
  });

  it("Apply twice produces ZERO edits the second time (Sec.10.4 #4 — idempotence)", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<OBJECTS_GENERATION>\n";
    const model = twoPlayerModel();
    const parse1 = parseRms(source, lang);
    const first = computeApplyEdits(parse1, model, lang, new Map(), 2);
    expect(first.edits.length).toBeGreaterThan(0);

    const applied = applyEdits(source, first.edits);
    const parse2 = parseRms(applied, lang);
    const second = computeApplyEdits(parse2, model, lang, new Map(), 2);

    expect(second.edits).toEqual([]);
    expect(second.emissionProblems).toEqual([]);
  });

  it("a hand-edited create_land (role attribute changed, position left alone) is detected as detached — NOT silently re-emitted", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<OBJECTS_GENERATION>\n";
    const model = twoPlayerModel();
    const parse1 = parseRms(source, lang);
    const first = computeApplyEdits(parse1, model, lang, new Map(), 2);
    const applied = applyEdits(source, first.edits);

    // Hand-edit ONE land's terrain_type to a literal, detaching it from its
    // role while leaving land_position (the identity signal) untouched.
    const handEdited = applied.replace(
      "terrain_type ALP_ROLE_TERRAIN_PLAYER",
      "terrain_type GRASS2",
    );
    expect(handEdited).not.toBe(applied); // the replace actually matched something

    const parse2 = parseRms(handEdited, lang);
    const second = computeApplyEdits(parse2, model, lang, new Map(), 2);

    // No duplicate skeleton for either placement, and the fence itself is
    // unaffected by an edit made entirely outside it, total: zero edits.
    expect(second.edits).toEqual([]);
    expect((handEdited.match(/create_land/g) ?? []).length).toBe(2); // still exactly 2 lands, not 3
  });

  it("a hand-edited land_position (the identity signal itself changed) regenerates a fresh skeleton — the documented 'no marker' outcome", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\nbase_terrain GRASS\n<OBJECTS_GENERATION>\n";
    const model = twoPlayerModel();
    const parse1 = parseRms(source, lang);
    const first = computeApplyEdits(parse1, model, lang, new Map(), 2);
    const applied = applyEdits(source, first.edits);

    // Sever the link for P1 specifically by rewriting its land_position.
    const handEdited = applied.replace(
      /land_position ALP_X_P1 ALP_Y_P1/,
      "land_position 10 10",
    );
    expect(handEdited).not.toBe(applied);

    const parse2 = parseRms(handEdited, lang);
    const second = computeApplyEdits(parse2, model, lang, new Map(), 2);

    // P1 no longer has a recognisable land, so Apply proposes a fresh one.
    // P2's is left alone since its own land_position is untouched.
    expect(second.edits.length).toBeGreaterThan(0);
    const applied2 = applyEdits(handEdited, second.edits);
    expect((applied2.match(/create_land/g) ?? []).length).toBe(3); // the orphaned literal one, P2's, and P1's fresh one
  });

  it("a script with no <LAND_GENERATION> gets one created at its canonical position, after <PLAYER_SETUP> and before <ELEVATION_GENERATION>, with the fence in the header", () => {
    // The real-host case (2026-09-22): a script with an elevation section
    // and no land section had the fence AND the skeletons dumped at the
    // end of the document, inside <ELEVATION_GENERATION>.
    const source =
      "/* header */\n#const FOO 1\n<PLAYER_SETUP>\ndirect_placement\n<ELEVATION_GENERATION>\ncreate_elevation 3 { base_terrain GRASS }\n";
    const parse = parseRms(source, lang);
    const { edits, report } = computeApplyEdits(
      parse,
      twoPlayerModel(),
      lang,
      new Map(),
      2,
    );
    expect(validateEdits(edits, source.length).ok).toBe(true);
    const result = applyEdits(source, edits);
    const reparsed = parseRms(result, lang);
    expect(reparsed.script.sections.map((sec) => sec.name)).toEqual([
      "PLAYER_SETUP",
      "LAND_GENERATION",
      "ELEVATION_GENERATION",
    ]);
    expect((result.match(/create_land/g) ?? []).length).toBe(2);
    // Fence in the preamble, after the user's own header and #const.
    expect(result.indexOf("@alp v1 begin")).toBeGreaterThan(
      result.indexOf("#const FOO 1"),
    );
    expect(result.indexOf("@alp end")).toBeLessThan(
      result.indexOf("<PLAYER_SETUP>"),
    );
    // Both skeletons sit inside the new land section.
    const landIdx = result.indexOf("<LAND_GENERATION>");
    const elevIdx = result.indexOf("<ELEVATION_GENERATION>");
    for (const m of result.matchAll(/create_land/g)) {
      expect(m.index).toBeGreaterThan(landIdx);
      expect(m.index).toBeLessThan(elevIdx);
    }
    // The elevation section's own content is untouched and still its own.
    expect(result).toContain("<ELEVATION_GENERATION>\ncreate_elevation 3");
    expect(report).toEqual({ written: 2, updated: 0, unchanged: 0, left: 0 });
    // And the second Apply is a no-op.
    expect(
      computeApplyEdits(reparsed, twoPlayerModel(), lang, new Map(), 2).edits,
    ).toEqual([]);
  });

  it("a section-less document gets both, each on its own lines: never `/* @alp end */create_land` (2026-09-22)", () => {
    const source = "#const FOO 1";
    const parse = parseRms(source, lang);
    const { edits } = computeApplyEdits(
      parse,
      twoPlayerModel(),
      lang,
      new Map(),
      2,
    );
    expect(validateEdits(edits, source.length).ok).toBe(true);
    const result = applyEdits(source, edits);
    expect(result).not.toMatch(/\*\/create_land/);
    expect(result).toMatch(/@alp end \*\/\n/);
    const reparsed = parseRms(result, lang);
    expect(reparsed.script.sections.map((sec) => sec.name)).toEqual([
      "LAND_GENERATION",
    ]);
    expect(reparsed.diagnostics.filter((d) => d.severity === "error")).toEqual(
      [],
    );
    expect((result.match(/create_land/g) ?? []).length).toBe(2);
  });

  it("re-Apply after a role change UPDATES a tool-owned block in place rather than appending a second copy, and leaves a hand-edited one alone", () => {
    const source =
      "<PLAYER_SETUP>\ndirect_placement\n<LAND_GENERATION>\n<OBJECTS_GENERATION>\n";
    const model = twoPlayerModel();
    const first = applyEdits(
      source,
      computeApplyEdits(parseRms(source, lang), model, lang, new Map(), 2)
        .edits,
    );
    expect((first.match(/create_land/g) ?? []).length).toBe(2);

    // Hand-edit P2's block: add an attribute of the user's own.
    const handEdited = first.replace(
      /(land_position ALP_X_P2 ALP_Y_P2\n)/,
      "$1border_fuzziness 30\n",
    );
    expect(handEdited).not.toBe(first);

    // The role gains clumping_factor, so every attached block should now
    // carry a `clumping_factor` line.
    const changed: AlpModel = {
      ...model,
      roles: [role({ clumpingFactor: { k: "num", v: 20 } })],
    };
    const parse2 = parseRms(handEdited, lang);
    const second = computeApplyEdits(parse2, changed, lang, new Map(), 2);
    expect(second.report).toEqual({
      written: 0,
      updated: 1,
      unchanged: 0,
      left: 1,
    });
    const result = applyEdits(handEdited, second.edits);
    expect((result.match(/create_land/g) ?? []).length).toBe(2);
    expect(
      (result.match(/clumping_factor ALP_ROLE_CLUMPING_PLAYER/g) ?? []).length,
    ).toBe(1);
    // P1 updated, P2 (hand-owned) untouched, its own attribute intact.
    const p1 = result.slice(
      result.indexOf("land_position ALP_X_P1") - 200,
      result.indexOf("land_position ALP_X_P1") + 200,
    );
    expect(p1).toContain("clumping_factor");
    expect(result).toContain("border_fuzziness 30");
    const p2Start = result.indexOf(
      "create_land",
      result.indexOf("land_position ALP_X_P1"),
    );
    expect(result.slice(p2Start)).not.toContain("clumping_factor");

    // A third Apply with the same model: P1 unchanged, P2 still left.
    const third = computeApplyEdits(
      parseRms(result, lang),
      changed,
      lang,
      new Map(),
      2,
    );
    expect(third.edits).toEqual([]);
    expect(third.report).toEqual({
      written: 0,
      updated: 0,
      unchanged: 1,
      left: 1,
    });
  });

  it("on emission disagreement, offers NOTHING and reports the offending node (Sec.5.5) — no edits, problems non-empty", async () => {
    const { vi } = await import("vitest");
    vi.resetModules();
    vi.doMock("../emitModel", () => ({
      emitAlpModel: () => ({
        ok: false,
        problems: [{ name: "ALP_X_P1", emittedValue: 1, directValue: 2 }],
      }),
    }));
    const { computeApplyEdits: computeApplyEditsMocked } =
      await import("../applyEdits");
    const source = "<LAND_GENERATION>\nbase_terrain GRASS\n";
    const parse = parseRms(source, lang);
    const result = computeApplyEditsMocked(
      parse,
      twoPlayerModel(),
      lang,
      new Map(),
      2,
    );
    expect(result.edits).toEqual([]);
    expect(result.emissionProblems).toEqual([
      { name: "ALP_X_P1", emittedValue: 1, directValue: 2 },
    ]);
    vi.doUnmock("../emitModel");
    vi.resetModules();
  });
});

describe("a default ring is random under reseed (2026-09-22)", () => {
  it("the script carries one rnd(0,359) draw and every member's DEGREES cell steers off it", () => {
    const base: AlpModel = {
      v: 1,
      placements: [],
      roles: [role()],
      randomParams: [],
      groups: [],
    };
    const { model } = addRing(base, "player");
    const source = "<PLAYER_SETUP>" + NL + "direct_placement" + NL;
    const { edits, emissionProblems } = computeApplyEdits(
      parseRms(source, lang),
      model,
      lang,
      new Map(),
      8,
    );
    expect(emissionProblems).toEqual([]);
    const result = applyEdits(source, edits);
    const draws =
      result.match(/#const ALP_PARAM_ROTATION_RING_\d+ rnd\(0,359\)/g) ?? [];
    expect(draws).toHaveLength(1);
    const param = draws[0]!.split(" ")[1]!;
    const degrees = result.match(/#const ALP_DEGREES_\S+ \(.*\)/g) ?? [];
    expect(degrees).toHaveLength(8);
    for (const line of degrees) expect(line).toContain(param);
    // And the draw is defined before its first use.
    expect(result.indexOf(draws[0]!)).toBeLessThan(result.indexOf(degrees[0]!));
  });
});

// BUG-034. The Bulls_Eyes gate and verify.ts both check the emitted text
// with evaluateExpressionTokens and their own resolver, so neither ever
// went through the preview's #const handling, which rounded every constant.
// This runs the Applied script through the preview's real S0 and land
// placement, the path the app's map preview takes.
describe("an Applied ring places its lands on a circle in the map preview (BUG-034)", () => {
  it("every origin sits at the ring's radius from the centre, at every seed", () => {
    const base: AlpModel = {
      v: 1,
      placements: [],
      roles: [role()],
      randomParams: [],
      groups: [],
    };
    const { model } = addRing(base, "player"); // radius 30, eight members
    const source = "<PLAYER_SETUP>" + NL + "direct_placement" + NL;
    const { edits } = computeApplyEdits(
      parseRms(source, lang),
      model,
      lang,
      new Map(),
      8,
    );
    const result = applyEdits(source, edits);

    const constants = (
      JSON.parse(
        readFileSync(
          join(REPO_ROOT, "reference", "data", "game-constants.json"),
          "utf8",
        ),
      ) as { constants: ObjectConstant[] }
    ).constants;
    const refDb = buildLanguageIndex(lang);
    for (const seed of [1, 7, 42, 12345]) {
      const instantiated = instantiateScript(
        parseRms(result, lang),
        refDb,
        { playerCount: 8, mapSize: "Normal", teams: [] },
        seed,
      );
      const dim = instantiated.dim;
      const { origins } = placeLandOrigins(
        instantiated,
        createTileGrid(dim, 0),
        constants,
        seed,
      );
      // A rounded SIN/COS snaps every member onto the eight outer points of
      // a 3x3 grid. Eight distinct points there means using all four
      // corners, 30 * sqrt(2) = 42% out, which the radius check catches.
      // Fewer stacks two lands on one tile, which the distinct check
      // catches. So the pair fails at every rotation the draw can pick.
      expect(origins).toHaveLength(8);
      for (const o of origins) {
        const radiusPercent =
          (Math.hypot(o.x - dim / 2, o.y - dim / 2) / dim) * 100;
        // land_position takes whole percents, so a point can sit up to
        // about 0.7% off the true circle.
        expect(Math.abs(radiusPercent - 30)).toBeLessThan(1.5);
      }
      const distinct = new Set(origins.map((o) => `${o.x},${o.y}`));
      expect(distinct.size).toBe(8);
    }
  });
});
