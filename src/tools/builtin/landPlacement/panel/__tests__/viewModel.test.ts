import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../../parser/language";
import { parseRms } from "../../../../../parser/parser";
import { instantiateScript } from "../../../../../preview/generator/instantiate";
import { reservedNamesForApply } from "../../applyEdits";
import { NameAllocator } from "../../compiler/naming";
import { emitAlpModel } from "../../emitModel";
import type { AlpModel } from "../../fence";
import type { Placement } from "../../model";
import { EMPTY_MODEL } from "../landPlacementModel";
import {
  availableThetaPerCountOptions,
  buildPlacementTree,
  checkP4ForPanel,
  exprAsNumber,
  flattenPlacementTree,
  formatPercentWithTiles,
  numberToExpr,
  percentToTile,
  shapeGroupLandTotal,
  validThetaPerCountRange,
  wouldCreateCycle,
} from "../viewModel";

function placement(id: string, parent: string): Placement {
  return {
    id,
    parent,
    frame: "radial",
    offset: { kind: "polar", r: { k: "num", v: 20 }, theta: { k: "num", v: 0 } },
    label: id,
  };
}

function modelWith(placements: Placement[]): AlpModel {
  return { v: 1, placements, roles: [], randomParams: [], groups: [] };
}

describe("buildPlacementTree / flattenPlacementTree", () => {
  it("nests children under their parent with increasing depth", () => {
    const model = modelWith([
      placement("P1", "center"),
      placement("A1", "P1"),
      placement("A2", "P1"),
      placement("B1", "A1"),
    ]);
    const tree = buildPlacementTree(model);
    expect(tree).toHaveLength(1);
    expect(tree[0].placement.id).toBe("P1");
    expect(tree[0].depth).toBe(0);
    expect(tree[0].children.map((c) => c.placement.id)).toEqual(["A1", "A2"]);
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[0].children[0].placement.id).toBe("B1");
    expect(tree[0].children[0].children[0].depth).toBe(2);

    const flat = flattenPlacementTree(tree);
    expect(flat.map((n) => `${n.placement.id}@${n.depth}`)).toEqual(["P1@0", "A1@1", "B1@2", "A2@1"]);
  });

  it("surfaces multiple map-centre roots independently", () => {
    const model = modelWith([placement("P1", "center"), placement("P2", "center")]);
    const tree = buildPlacementTree(model);
    expect(tree.map((n) => n.placement.id)).toEqual(["P1", "P2"]);
  });

  it("treats a placement parented to a missing id as its own root rather than dropping it", () => {
    const model = modelWith([placement("Orphan", "does-not-exist")]);
    const tree = buildPlacementTree(model);
    expect(tree).toHaveLength(1);
    expect(tree[0].placement.id).toBe("Orphan");
    expect(tree[0].depth).toBe(0);
  });
});

describe("wouldCreateCycle", () => {
  const model = modelWith([placement("P1", "center"), placement("A1", "P1"), placement("B1", "A1")]);

  it("is never a cycle to re-parent onto the map centre", () => {
    expect(wouldCreateCycle(model, "B1", "center")).toBe(false);
  });

  it("rejects a placement becoming its own parent", () => {
    expect(wouldCreateCycle(model, "P1", "P1")).toBe(true);
  });

  it("rejects re-parenting an ancestor under its own descendant", () => {
    // P1 -> A1 -> B1; re-parenting P1 under B1 would close the loop.
    expect(wouldCreateCycle(model, "P1", "B1")).toBe(true);
  });

  it("allows re-parenting onto an unrelated existing placement", () => {
    const wider = modelWith([placement("P1", "center"), placement("P2", "center"), placement("A1", "P1")]);
    expect(wouldCreateCycle(wider, "A1", "P2")).toBe(false);
  });
});

describe("shapeGroupLandTotal", () => {
  it("is pattern length times repeats, exact for an ordinary fixed-count ring", () => {
    expect(shapeGroupLandTotal({ pattern: [{ id: "s1", role: "r" }, { id: "s2", role: "r" }, { id: "s3", role: "r" }], repeats: 3, perPlayer: false })).toEqual({ count: 9, exact: true });
    expect(shapeGroupLandTotal({ pattern: [{ id: "s1", role: "r" }], repeats: 8, perPlayer: false })).toEqual({ count: 8, exact: true });
  });

  it("is an upper bound for a perPlayer ring — the real count depends on the game's own player count", () => {
    expect(shapeGroupLandTotal({ pattern: [{ id: "s1", role: "r" }], repeats: 8, perPlayer: true })).toEqual({ count: 8, exact: false });
  });
});

// slice-c-brief.md item 1's panel surface: restricting the offered counts to
// where a member's own land could actually be emitted (Item 6's guard,
// player k needs count >= k) turns a dead-configuration trap into something
// the control cannot produce.
describe("validThetaPerCountRange / availableThetaPerCountOptions", () => {
  it("player 1 (repeatIndex 0) can be overridden at every count from 1 to 8", () => {
    expect(validThetaPerCountRange({ repeatIndex: 0 }, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("player 3 (repeatIndex 2) can only be overridden from count 3 upward — the counts where player 3 exists at all", () => {
    expect(validThetaPerCountRange({ repeatIndex: 2 }, 8)).toEqual([3, 4, 5, 6, 7, 8]);
  });

  it("player 8 (repeatIndex 7) can only be overridden at count 8", () => {
    expect(validThetaPerCountRange({ repeatIndex: 7 }, 8)).toEqual([8]);
  });

  it("a placement with no repeatIndex (not a perPlayer group member) offers every count", () => {
    expect(validThetaPerCountRange({ repeatIndex: undefined }, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("availableThetaPerCountOptions excludes counts that already carry an override", () => {
    const p = { repeatIndex: 2, thetaPerCount: { 4: numberToExpr(30) } };
    expect(availableThetaPerCountOptions(p, 8)).toEqual([3, 5, 6, 7, 8]);
  });

  it("availableThetaPerCountOptions is empty once every valid count already has an override", () => {
    const p = { repeatIndex: 7, thetaPerCount: { 8: numberToExpr(30) } };
    expect(availableThetaPerCountOptions(p, 8)).toEqual([]);
  });

  it("a placement with no thetaPerCount at all offers its whole valid range", () => {
    expect(availableThetaPerCountOptions({ repeatIndex: 5 }, 8)).toEqual([6, 7, 8]);
  });
});

describe("percentToTile / formatPercentWithTiles", () => {
  it("rounds and clamps into [0, dim - 1]", () => {
    expect(percentToTile(50, 200)).toBe(100);
    expect(percentToTile(0, 200)).toBe(0);
    expect(percentToTile(100, 200)).toBe(199);
    expect(percentToTile(-10, 200)).toBe(0);
  });

  it("formats percent alongside the tile equivalent", () => {
    expect(formatPercentWithTiles(50, 200)).toBe("50% (100 tiles)");
    expect(formatPercentWithTiles(12.5, 200)).toBe("12.5% (25 tiles)");
  });
});

describe("exprAsNumber / numberToExpr", () => {
  it("round-trips a numeric literal", () => {
    expect(exprAsNumber(numberToExpr(42))).toBe(42);
  });

  it("returns null for anything other than a literal — the panel edits by numbers, never by formula", () => {
    expect(exprAsNumber({ k: "sym", name: "FOO" })).toBeNull();
    expect(exprAsNumber({ k: "param", id: "rp1" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// checkP4ForPanel, wired the way the panel wires it. This function had no
// coverage at all until the defect below was reported from a real run, and
// the defect was never in the function: it was in what the call site passed.
// So these run the whole panel-side computation rather than calling
// checkP4ForPanel with a hand-written name list, which is the only shape that
// could have caught it.
// ---------------------------------------------------------------------------

describe("checkP4ForPanel — as the panel calls it (regression, reported 2026-09-02)", () => {
  const lang = loadLanguage();

  /** Everything LandPlacementPanel does to reach P4, in the same order. */
  function panelP4(mapName: string, model: AlpModel) {
    const source = readFileSync(join(REPO_ROOT, "test-maps", mapName), "utf8");
    const parse = parseRms(source, lang);
    const refDb = buildLanguageIndex(lang);
    const instantiated = instantiateScript(parse, refDb, { playerCount: 2, mapSize: "Normal", teams: [] }, 12345);
    const namer = new NameAllocator({ reserved: reservedNamesForApply(parse, lang) });
    const emission = emitAlpModel(model, namer, instantiated.symbols, 2);
    if (!emission.ok) throw new Error("emission failed, which this fixture does not expect");
    return {
      scriptSymbols: instantiated.symbols,
      emission,
      p4: checkP4ForPanel(emission, parse, lang),
    };
  }

  it("an empty model on a script full of constants collides with nothing", () => {
    const { scriptSymbols, p4 } = panelP4("Bulls_Eyes.rms", EMPTY_MODEL);
    // The script really does define the constants that were being reported,
    // so this pins that the fixture can still fail, not that the map is quiet.
    expect(scriptSymbols.size).toBeGreaterThan(100);
    expect(scriptSymbols.has("RADIUS_PLAYER_LANDS")).toBe(true);
    expect(p4.collisions).toEqual([]);
    expect(p4.ok).toBe(true);
  });

  // The distinguishing test. `resolved` is SEEDED with the document's own
  // symbols, so its key set answers a different question from `emittedNames`,
  // and reading P4's candidates off it is what produced 133 collisions on a
  // model with nothing in it. Asserting the two key sets differ is what stops
  // anyone folding the field back into `resolved.keys()` as a simplification.
  it("emission.resolved carries the document's symbols and emittedNames does not", () => {
    const { scriptSymbols, emission } = panelP4("Bulls_Eyes.rms", EMPTY_MODEL);
    expect([...emission.resolved.keys()]).toEqual(expect.arrayContaining([...scriptSymbols.keys()]));
    expect(emission.emittedNames.filter((n) => scriptSymbols.has(n))).toEqual([]);
  });

  it("still reports a real collision: a model whose emitted name is already taken", () => {
    const namer = new NameAllocator({ prefix: "" });
    const model: AlpModel = {
      v: 1,
      placements: [{ id: "solo", parent: "center", frame: "radial", label: "solo", offset: { kind: "polar", r: { k: "num", v: 10 }, theta: { k: "num", v: 0 } } }],
      roles: [],
      randomParams: [],
      groups: [],
    };
    const emission = emitAlpModel(model, namer, new Map(), 2);
    expect(emission.ok).toBe(true);
    if (!emission.ok) return;
    // The allocator here is deliberately NOT seeded from the document, which
    // is the only way to manufacture a collision for P4 to find. That is
    // exactly the "something upstream got this wrong" case preconditions.ts
    // says a non-empty P4 result means.
    const taken = emission.emittedNames[0];
    const withCollision = parseRms(`#const ${taken} 5\n<LAND_GENERATION>\n`, lang);
    expect(checkP4ForPanel(emission, withCollision, lang).collisions).toContain(taken);
  });

  it("no emission to check is not a collision", () => {
    const parse = parseRms("#const FOO 5\n<LAND_GENERATION>\n", lang);
    expect(checkP4ForPanel(null, parse, lang)).toEqual({ ok: true, collisions: [] });
  });
});
