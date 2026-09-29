// Sec.10.4 (fence and edit safety) plus the item-1 acceptance from
// docs/land-placement-slice3-brief.md: "a model survives write → parse →
// deep-equal. A malformed fence yields no association on all three shapes."

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { commentOpenAliases } from "../../../../parser/validate";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../../../parser/__tests__/testUtils";
import {
  buildFenceEdits,
  locateFence,
  readFenceModel,
  type AlpModel,
} from "../fence";

const lang = loadLanguage();

function emptyModel(): AlpModel {
  return { v: 1, placements: [], roles: [], randomParams: [], groups: [] };
}

function modelWithLabel(label: string): AlpModel {
  return {
    v: 1,
    placements: [],
    roles: [
      {
        id: "r1",
        label,
        terrain: { k: "name", name: "GRASS" },
        baseSize: { k: "num", v: 10 },
        baseElevation: { k: "num", v: 0 },
        extent: { kind: "percent", value: { k: "num", v: 0 } },
        zone: { kind: "none" },
        assign: { kind: "none" },
      },
    ],
    randomParams: [],
    groups: [],
  };
}

/** The one edit `buildFenceEdits` returns against an empty document, applied by hand. */
function renderInto(model: AlpModel, body = ""): string {
  const empty = parseRms("", lang);
  const edits = buildFenceEdits(empty, model, body);
  expect(edits).toHaveLength(1);
  return edits[0].newText;
}

describe("fence.ts — round trip (Sec.10.4 #2, slice-3 item 1)", () => {
  it("a model survives write -> parse -> deep-equal", () => {
    const model = modelWithLabel("Neutral B");
    const source = renderInto(model, "#const ALP_X_R1 (1 + 2)");
    const parsed = parseRms(source, lang);
    expect(readFenceModel(parsed)).toEqual(model);
  });

  it("JSON.parse(JSON.stringify(model)) deep-equals the model itself (Sec.10.4 #2)", () => {
    const model = modelWithLabel("Player");
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it("locates the body span between the two markers", () => {
    const model = emptyModel();
    const body = "#const ALP_X_R1 1\n#const ALP_Y_R1 2";
    const source = renderInto(model, body);
    const parsed = parseRms(source, lang);
    const loc = locateFence(parsed);
    expect(loc).not.toBeNull();
    expect(source.slice(loc!.bodySpan.start, loc!.bodySpan.end).trim()).toBe(
      body,
    );
  });
});

describe("fence.ts — malformed fences yield no association (Sec.9 P5, Sec.10.4 #3)", () => {
  it("truncated JSON", () => {
    const source = `/* @alp v1 begin — x.\n   @alp-model {"v":1,"placements":[ */\n/* @alp end */`;
    expect(readFenceModel(parseRms(source, lang))).toBeNull();
  });

  it("wrong v", () => {
    const model = { ...emptyModel(), v: 2 } as unknown as AlpModel;
    const source = renderInto(model);
    expect(readFenceModel(parseRms(source, lang))).toBeNull();
  });

  it("no @alp-model comment at all", () => {
    const source = `/* @alp v1 begin — x, but no model key here. */\n#const A 1\n/* @alp end */`;
    expect(readFenceModel(parseRms(source, lang))).toBeNull();
  });

  it("no fence present at all", () => {
    const source = `#const A 1\n<LAND_GENERATION>\n`;
    expect(readFenceModel(parseRms(source, lang))).toBeNull();
    expect(locateFence(parseRms(source, lang))).toBeNull();
  });
});

describe("fence.ts — idempotence (Sec.10.4 #4)", () => {
  it("applying the same model+body twice produces zero edits the second time", () => {
    const model = modelWithLabel("Aux");
    const body = "#const ALP_X_R1 (1 + 2)";
    const firstSource = renderInto(model, body);
    const parsed = parseRms(firstSource, lang);
    const secondEdits = buildFenceEdits(parsed, model, body);
    expect(secondEdits).toEqual([]);
  });

  it("a genuinely different model still produces an edit the second time", () => {
    const bodyA = "#const ALP_X_R1 1";
    const bodyB = "#const ALP_X_R1 2";
    const model = emptyModel();
    const parsed = parseRms(renderInto(model, bodyA), lang);
    expect(buildFenceEdits(parsed, model, bodyB)).toHaveLength(1);
  });
});

describe("fence.ts — byte-identity outside the fence (Sec.10.4 #1)", () => {
  const corpusDir = join(REPO_ROOT, "test-maps");
  // A corpus file that ALREADY carries a fence (a map saved from the tool,
  // e.g. ALP_test.rms) cannot have one appended; buildFenceEdits replaces
  // its fence in place, which is a different guarantee, pinned above.
  const corpusFiles = readdirSync(corpusDir)
    .filter((f) => f.endsWith(".rms"))
    .filter(
      (f) =>
        locateFence(
          parseRms(readFileSync(join(corpusDir, f), "utf8"), lang),
        ) === null,
    );

  it.each(corpusFiles)(
    "regenerating a fence appended to %s leaves the rest byte-identical",
    (fileName) => {
      const original = readFileSync(join(corpusDir, fileName), "utf8");
      const model = modelWithLabel("Corpus check");
      const firstEdits = buildFenceEdits(
        parseRms(original, lang),
        model,
        "#const ALP_X_R1 1",
      );
      expect(firstEdits).toHaveLength(1);
      const withFence =
        original.slice(0, firstEdits[0].start) +
        firstEdits[0].newText +
        original.slice(firstEdits[0].end);
      expect(withFence.startsWith(original)).toBe(true);

      // Regenerate with a DIFFERENT model/body. Everything before the fence
      // (all of `original`, since the fence was appended) must still be
      // untouched, which is the corpus-wide form of the same guarantee the
      // round-trip test above checks on one hand-built fixture.
      const reparsed = parseRms(withFence, lang);
      const secondEdits = buildFenceEdits(
        reparsed,
        modelWithLabel("Changed"),
        "#const ALP_X_R1 2",
      );
      expect(secondEdits).toHaveLength(1);
      const regenerated =
        withFence.slice(0, secondEdits[0].start) +
        secondEdits[0].newText +
        withFence.slice(secondEdits[0].end);
      expect(regenerated.slice(0, original.length)).toBe(original);
    },
  );
});

describe("fence.ts — hazard 2: a label equal to a 69-valued constant must not open a nested comment", () => {
  const aliases = commentOpenAliases([
    { rmsConstant: "SHORE_FISH", constId: 69, category: "object" },
  ]);

  it("without escaping, embedding the risky word verbatim swallows everything after it (the control)", () => {
    const naiveJson = JSON.stringify(modelWithLabel("a SHORE_FISH ring"));
    const source = `/* @alp v1 begin — x.\n   @alp-model ${naiveJson} */\n#const AFTER_FENCE 1\n/* @alp end */`;
    const parsed = parseRms(source, lang, { commentOpenAliases: aliases });
    const afterToken = parsed.tokens.find((t) => t.text === "AFTER_FENCE");
    expect(afterToken).toBeDefined();
    // The naive embed opens a SECOND comment at "SHORE_FISH" (depth 2), so
    // the header's own "*/" only closes the inner one and AFTER_FENCE is
    // swallowed as trivia, silently, exactly the hazard being guarded
    // against. This assertion is the demonstration that the hazard is real.
    expect(afterToken!.isTrivia).toBe(true);
  });

  it("with this module's escaping, the same label round-trips and nothing after the fence is swallowed", () => {
    const model = modelWithLabel("a SHORE_FISH ring");
    const source =
      renderInto(model, "#const ALP_X_R1 1") + "\n#const AFTER_FENCE 1\n";
    const parsed = parseRms(source, lang, { commentOpenAliases: aliases });

    const afterToken = parsed.tokens.find((t) => t.text === "AFTER_FENCE");
    expect(afterToken).toBeDefined();
    expect(afterToken!.isTrivia).toBe(false);
    expect(readFenceModel(parsed)).toEqual(model);
  });
});

describe("fence.ts — read-side upgrade of a pre-slice-1 role (role-attributes-escalation.md Sec.10 slice 1 item 4 rev 1)", () => {
  // Written in the OLD shape by hand, because that is the only shape the
  // bug can reach: a fence from a build that went out on 2026-09-15 carries
  // `landPercent` and `assignToPlayer`, and a cast without this upgrade
  // would crash the first emitRole on `role.extent === undefined`.
  const legacyRole = {
    id: "r1",
    label: "Player",
    terrain: { k: "name", name: "GRASS" },
    baseSize: { k: "num", v: 10 },
    baseElevation: { k: "num", v: 0 },
    landPercent: { k: "num", v: 7 },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assignToPlayer: true,
  };
  const legacyAux = {
    ...legacyRole,
    id: "r2",
    label: "Aux",
    assignToPlayer: false,
  };

  function legacyFence(roles: unknown[]): string {
    const json = JSON.stringify({
      v: 1,
      placements: [],
      roles,
      randomParams: [],
      groups: [],
    });
    return `/* @alp v1 begin\n@alp-model ${json.replace(/ /g, "\\u0020")}\n*/\n/* @alp end */\n`;
  }

  it("lifts landPercent into extent and assignToPlayer into the AT_PLAYER per-repeat policy", () => {
    const model = readFenceModel(
      parseRms(legacyFence([legacyRole, legacyAux]), lang),
    );
    expect(model).not.toBeNull();
    const [player, aux] = model!.roles;
    expect(player.extent).toEqual({
      kind: "percent",
      value: { k: "num", v: 7 },
    });
    expect(player.assign).toEqual(ASSIGN_TO_PLAYER_PER_REPEAT);
    expect(aux.assign).toEqual({ kind: "none" });
    expect("landPercent" in player).toBe(false);
    expect("assignToPlayer" in player).toBe(false);
    // A current-shape role round-trips untouched (the upgrade is a no-op on it).
    const current = modelWithLabel("Neutral B");
    expect(readFenceModel(parseRms(renderInto(current), lang))).toEqual(
      current,
    );
  });
});
