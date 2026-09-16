// slice-4 brief item 3 acceptance: "a pure model + parse → TextEdit[]
// covering both kinds; every edit passes validateEdits (protocol.ts); Apply
// twice produces zero edits the second time (Sec.10.4 #4, assert on the edit
// array being empty, not on the resulting text matching); a hand-edited
// create_land is detected as detached rather than silently re-emitted."

import { describe, expect, it } from "vitest";
import type { TextEdit } from "../../../../../tools-api/index";
import { validateEdits } from "../../../protocol";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../parser/parser";
import { computeApplyEdits } from "../applyEdits";
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
    landPercent: { k: "num", v: 8 },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assignToPlayer: true,
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

    // Both skeletons and the fence land INSIDE <LAND_GENERATION>, before <OBJECTS_GENERATION>.
    const landGenIdx = result.indexOf("<LAND_GENERATION>");
    const objGenIdx = result.indexOf("<OBJECTS_GENERATION>");
    expect(fenceEnd).toBeGreaterThan(landGenIdx);
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

  it("a script with no <LAND_GENERATION> at all still produces a valid, well-formed edit set (falls back to end-of-document)", () => {
    const source = "<PLAYER_SETUP>\ndirect_placement\n";
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
    expect((result.match(/create_land/g) ?? []).length).toBe(2);
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
