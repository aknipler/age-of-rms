// Sec.12 corpus gates. Two tiers:
//
// 1. EVERY .rms in test-maps/ (including test-maps/local/, test-maps/broken/,
//    test-maps/rms-check/ and any still-untriaged additions): parseRms must
//    not throw and must satisfy the coverage + span-fidelity properties.
//    Non-negotiable.
// 2. The TRIAGED allowlist below additionally passes the zero-error gate.
//    A file joins this list only after the per-map triage protocol
//    (generates in DE + every diagnostic triaged, spec Sec.12). The corpus
//    grew to ~52 files in July 2026; triage is incremental, so most files
//    are tier-1 only for now.
//
// BCC2-Rekawa is deliberately NOT in the allowlist: its glued `}8050`
// (line 891) makes RMS0101 fire by design. It belongs in test-maps/broken/
// or fixed, per the spec.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { lineNumberOfOffset } from "../lineIndex";
import { walkComments, type CommentMarker } from "../commentWalk";
import {
  commentCloseAliases,
  commentOpenAliases,
  validate,
  type GameConstantsForValidate,
  type ValidateReferenceDb,
} from "../validate";
import { checkProperties, loadLanguage, REPO_ROOT } from "./testUtils";

const lang = loadLanguage();
const MAPS_DIR = join(REPO_ROOT, "test-maps");
const BROKEN_DIR = join(MAPS_DIR, "broken");
// Gitignored (19 DE-official maps + community scripts), so these tests
// silently reduce to the tracked set on CI. Included anyway because the
// scoping measurements behind validate() were taken over this half of the
// corpus too, and a measurement whose inputs no gate ever runs is a
// measurement that can rot without anyone noticing.
const LOCAL_DIR = join(MAPS_DIR, "local");
// The test_rms/ set from Divy1211/rms-check (GPL-3.0), added 2026-08-29. Also
// gitignored, it is somebody else's corpus, not ours to redistribute, and
// kept out of test-maps/local/ because it is a different KIND of input: tiny
// synthetic probes for name liveness and random-block unification, several
// deliberately malformed (`#const 5+_players`, a bare `#const P(L)`). Mixing
// them into local/ would quietly change what "the local corpus" means for the
// scoping measurements in docs/build-log.md that were taken over it.
const RMSCHECK_DIR = join(MAPS_DIR, "rms-check");

const refDb: ValidateReferenceDb = {
  language: lang,
  gameConstants: JSON.parse(
    readFileSync(
      join(REPO_ROOT, "reference", "data", "game-constants.json"),
      "utf8",
    ),
  ) as GameConstantsForValidate,
};

// The REVISION_5-verified snapshot set, minus BCC2 (known real defect).
const ZERO_ERROR_ALLOWLIST = [
  "sample.rms",
  "AD4 - Ra.rms",
  "Comeer v1.5.rms", // renamed from TC2 - Comeer v1.4.rms (2026-10-14)
  "Menindee_AUS_v2.3.rms",
  "AK_ForeDaut_v1.3.rms",
  "AK_Six_Points_v1.4.rms",
  "QS_Three_Bays_v1.1.rms",
  "Pa_Site_v1.1.rms",
  "OWWC1Tewaipounamu-edited-v1.2.rms",
  "AK_Hourglass_v2.0.rms",
  "AK_Vanguard_v1.2.rms", // renamed from Vanguard_v1.2.rms. The old name silently dropped it from this gate
];

// `.rms2` is deliberately NOT matched. DE ships some official maps under that
// extension and they parse, but they are a separate triage question (a `.rms2`
// carries XS-script companions and DE-only syntax the corpus hasn't been read
// for), so pulling them into a non-negotiable gate would be admitting
// untriaged files through the front door.
function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);
}

const allMaps = [
  ...listRms(MAPS_DIR).map((name) => ({ name, path: join(MAPS_DIR, name) })),
  ...listRms(LOCAL_DIR).map((name) => ({
    name: `local/${name}`,
    path: join(LOCAL_DIR, name),
  })),
  ...listRms(BROKEN_DIR).map((name) => ({
    name: `broken/${name}`,
    path: join(BROKEN_DIR, name),
  })),
  ...listRms(RMSCHECK_DIR).map((name) => ({
    name: `rms-check/${name}`,
    path: join(RMSCHECK_DIR, name),
  })),
];

describe("corpus: no-throw + coverage + span fidelity (every file)", () => {
  it("found the corpus", () => {
    expect(allMaps.length).toBeGreaterThan(0);
  });

  for (const map of allMaps) {
    it(map.name, () => {
      const source = readFileSync(map.path, "utf8");
      const result = parseRms(source, lang); // must not throw
      const problems = checkProperties(result);
      expect(problems).toEqual([]);
    });
  }
});

describe("corpus: zero-error gate (triaged allowlist)", () => {
  const present = allMaps.filter((m) => ZERO_ERROR_ALLOWLIST.includes(m.name));

  it("allowlisted files are present", () => {
    expect(present.length).toBeGreaterThan(0);
  });

  for (const map of present) {
    it(map.name, () => {
      const source = readFileSync(map.path, "utf8");
      const result = parseRms(source, lang);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      expect(
        errors.map((e) => `${e.code} @${e.span.start}: ${e.message}`),
      ).toEqual([]);
    });
  }
});

// The semantic pass gets the same treatment as the parser: it runs over every
// file (must not throw), and over the triaged allowlist it must raise no
// error-severity diagnostic. These are maps confirmed to generate in DE, so
// an error against one is by definition a false alarm. RMS0311 is the only
// error this pass can raise, which makes this gate a live check on
// `requiresSection` data rather than a formality.
//
// Deliberately NOT asserted: a cap on total diagnostic volume. The corpus is
// half gitignored (test-maps/local/), so any fixed number would mean something
// different on CI than it does locally. The measurement that scoped these
// checks lives in docs/build-log.md, and re-running it is the way to re-check
// noise, not a magic constant here.
describe("corpus: validate() no-throw (every file)", () => {
  for (const map of allMaps) {
    it(map.name, () => {
      const source = readFileSync(map.path, "utf8");
      const result = parseRms(source, lang);
      expect(() => validate(result, refDb)).not.toThrow();
    });
  }
});

describe("corpus: validate() zero-error gate (triaged allowlist)", () => {
  const present = allMaps.filter((m) => ZERO_ERROR_ALLOWLIST.includes(m.name));

  for (const map of present) {
    it(map.name, () => {
      const source = readFileSync(map.path, "utf8");
      const errors = validate(parseRms(source, lang), refDb).filter(
        (d) => d.severity === "error",
      );
      expect(
        errors.map((e) => `${e.code} @${e.span.start}: ${e.message}`),
      ).toEqual([]);
    });
  }
});

describe("corpus: benchmark sanity (Vanguard, ~50k tokens)", () => {
  // Spec Sec.9 wants this to catch a COMPLEXITY regression, not to measure the
  // machine. It used to assert `elapsed < 500` and went red twice on
  // 2026-07-31 (672 ms once, and once inside a suite run that took 279 s
  // against a normal 84 s) on code that does not touch the parser's hot loop.
  // A wall clock on a shared machine measures the machine: agent sessions have
  // seen the same suite take 48 s and 307 s on identical code.
  //
  // So the threshold is now RELATIVE. Parse a small input first to price one
  // token on whatever hardware is running today, then require Vanguard to cost
  // no more than RATIO times that per token. Super-linear behaviour still
  // trips it; a slow or loaded machine scales both sides and does not.
  it("parses the benchmark file without super-linear blow-up", () => {
    const path = join(MAPS_DIR, "AK_Vanguard_v1.2.rms");
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");

    // Warm-up doubles as the calibration sample. Repeat the small parse so its
    // timing is not dominated by one-off JIT and allocation noise.
    const small = source.slice(0, 20_000);
    const SMALL_REPS = 20;
    const s0 = performance.now();
    let smallTokens = 0;
    for (let i = 0; i < SMALL_REPS; i += 1)
      smallTokens = parseRms(small, lang).tokens.length;
    const perTokenSmall = (performance.now() - s0) / (SMALL_REPS * smallTokens);

    const t0 = performance.now();
    const full = parseRms(source, lang);
    const perTokenFull = (performance.now() - t0) / full.tokens.length;

    // 8x headroom on a per-token cost that should be roughly constant. Chosen
    // to sit far above ordinary variance and far below the quadratic blow-up
    // this exists to catch, where the ratio grows with input size rather than
    // hovering near 1.
    const RATIO = 8;
    expect(perTokenFull).toBeLessThan(perTokenSmall * RATIO);
  });
});

/**
 * The comment-alias truncation, measured on whatever real maps are on disk
 * rather than on a fixture.
 *
 * This exists because the unit tests in `lexer.test.ts` pass with the feature
 * switched OFF everywhere else: the corpus gates above call `parseRms` with no
 * options, so a feature only the worker configures would never meet a real
 * file. One tracked map, `broken/BCC2-Rekawa.rms`, contains this in a form
 * that loses lines in game, a commented-out `create_object SHORE_FISH { … }`
 * block, which is what an author writes when disabling a command. Chaotic
 * Strait has the same shape and was recorded here as losing half its lines.
 * RMSTEST_83 placed its town centres, because two `HOUSE` words (valued 70)
 * close the nested comment again on line 561, so it left this census when the
 * lexer learned the closing word (token-alias-design, slice B). The lexer is
 * configured with both sets here, which is what the parser worker does.
 *
 * Selected from disk, never named: `.gitignore` whitelists only a handful of
 * maps, so naming one that happens to be on a maintainer's machine passes here
 * and ENOENTs on a clone. If no affected map is present the assertions are
 * vacuous BY CONSTRUCTION, so the count is asserted separately and loudly.
 */
describe("corpus: a word valued 69 inside a comment truncates the file (Sec.2.1 amendment)", () => {
  // Reuses the refDb already built above rather than re-reading the file, so
  // the gate and the app cannot drift onto different constant tables.
  const ALIASES = commentOpenAliases(refDb.gameConstants.constants);
  const CLOSERS = commentCloseAliases(refDb.gameConstants.constants);

  // With no argument, the parse the corpus gates above make: no alias sets.
  // With the open set, the two sets together, the worker's parse.
  const liveTokens = (src: string, aliases?: ReadonlySet<string>) =>
    parseRms(src, lang, {
      commentOpenAliases: aliases,
      commentCloseAliases: aliases && CLOSERS,
    }).tokens.filter((t) => !t.isTrivia).length;

  const affected = allMaps.filter((m) => {
    const src = readFileSync(m.path, "utf8");
    return liveTokens(src, ALIASES) < liveTokens(src);
  });

  it("the alias set is exactly the constants valued 69, and is not empty", () => {
    expect(ALIASES.size).toBeGreaterThan(0);
    // CENOTES joined on 2026-10-03, when Update 185872 renumbered it from 40
    // to 69. Predicted from this rule rather than seen in game.
    expect([...ALIASES].sort()).toEqual([
      "ATTR_PROJECTILE_ARC",
      "CENOTES",
      "SHORE_FISH",
    ]);
  });

  it("reports which maps the engine truncates", () => {
    // Not a threshold, a census. It prints so the number is re-derived each
    // run rather than quoted from a doc that ages.
    console.log(
      `[comment-alias] ${affected.length} of ${allMaps.length} corpus maps are truncated in game:`,
      affected.map((m) => m.name),
    );
    // NOT >= 0. That would be vacuous, and vacuous is the specific failure this
    // gate is exposed to: `affected` is computed, so a regression that stops the
    // truncation empties the loop below and every per-map test silently
    // disappears into a green run. `broken/BCC2-Rekawa.rms` is one of the dozen
    // maps `.gitignore` whitelists, so at least one hit exists on any clone.
    expect(affected.length).toBeGreaterThanOrEqual(1);
  });

  for (const map of affected) {
    it(`${map.name} loses tokens the engine never sees`, () => {
      const source = readFileSync(map.path, "utf8");
      const withAliases = liveTokens(source, ALIASES);
      const without = liveTokens(source);
      expect(withAliases).toBeLessThan(without);
      // The whole point is that a LOT is lost. A one-token difference would
      // mean the alias landed at the very end and the map is fine in practice.
      expect(withAliases).toBeLessThan(without * 0.9);
    });
  }
});

/**
 * The 70 census, the closing half of the block above. A word valued 70 inside a
 * comment closes one level of it, so text the author meant to disable can run
 * (RMSTEST_82a, and RMSTEST_83 for Chaotic Strait). Selected from disk, never
 * named, for the reason the 69 census gives. Expected on a maintainer's disk,
 * `Chaotic_Straitv0.99.rms`, `24hr_Mont Saint Michel.rms` and
 * `local/Fortress.rms`.
 */
describe("corpus: a word valued 70 inside a comment ends it (token-alias-design Sec.3.1)", () => {
  const OPENERS = commentOpenAliases(refDb.gameConstants.constants);
  const CLOSERS = commentCloseAliases(refDb.gameConstants.constants);

  const liveTokens = (src: string, closers?: ReadonlySet<string>) =>
    parseRms(src, lang, {
      commentOpenAliases: OPENERS,
      commentCloseAliases: closers,
    }).tokens.filter((t) => !t.isTrivia).length;

  const affected = allMaps.filter((m) => {
    const src = readFileSync(m.path, "utf8");
    return liveTokens(src, CLOSERS) > liveTokens(src);
  });

  it("the close set is exactly the constants valued 70", () => {
    expect([...CLOSERS].sort()).toEqual([
      "ATTR_ATTACK_GRAPHIC",
      "CITY_OF_LAKES",
      "HOUSE",
    ]);
  });

  it("reports which maps run text after a closing word", () => {
    console.log(
      `[comment-close] ${affected.length} of ${allMaps.length} corpus maps run text after a word valued 70 inside a comment:`,
      affected.map((m) => m.name),
    );
    // Not >= 0, for the reason the 69 census gives. `Chaotic_Straitv0.99.rms`
    // is whitelisted in .gitignore, so one hit exists on any clone.
    expect(affected.length).toBeGreaterThanOrEqual(1);
  });
});

// Chaotic Strait is the brief's stop trigger, exactly one RMS0113 and no
// RMS0111. It is named, so it is skipped on a clone where `.gitignore` leaves
// it out, but it is whitelisted there, so it normally runs.
describe("corpus: Chaotic Strait's 69 word is info, not an error", () => {
  const path = join(MAPS_DIR, "Chaotic_Straitv0.99.rms");
  it.skipIf(!existsSync(path))("gets one RMS0113 and no RMS0111", () => {
    const parse = parseRms(readFileSync(path, "utf8"), lang, {
      commentOpenAliases: commentOpenAliases(refDb.gameConstants.constants),
      commentCloseAliases: commentCloseAliases(refDb.gameConstants.constants),
    });
    const found = validate(parse, refDb).filter((x) =>
      ["RMS0111", "RMS0112", "RMS0113"].includes(x.code),
    );
    console.log(
      "[chaotic-strait]",
      found.map((x) => `${x.code} ${x.message.slice(0, 60)}`),
    );
    expect(found.filter((x) => x.code === "RMS0113")).toHaveLength(1);
    expect(found.filter((x) => x.code === "RMS0111")).toEqual([]);
    // Two HOUSE words (lines 560 and 561) and two words for the script's own
    // `#const YANG_MASK1 70` (line 23), one inside the disabled block at line
    // 26 and one in the commented create_terrain at line 463. The brief
    // expected the HOUSE pair only, so the YANG_MASK1 pair is a finding of the
    // walk, not a designed case.
    expect(found.filter((x) => x.code === "RMS0112")).toHaveLength(4);
  });
});

/**
 * `validate` reads comments through `walkComments`, not through the trivia
 * flags, so its reports do not depend on how the parse was configured. That
 * only holds while the walk and the lexer mark the same tokens, and this test
 * is what keeps the two from drifting. The leading byte-order mark is the one
 * token the lexer marks on its own account, so it is skipped.
 */
// Built from its code point, not typed, for the reason lexer.ts gives.
const BOM = String.fromCharCode(0xfeff);

describe("corpus: the comment walk agrees with the lexer", () => {
  const OPENERS = commentOpenAliases(refDb.gameConstants.constants);
  const CLOSERS = commentCloseAliases(refDb.gameConstants.constants);
  const markerOf = (word: string): CommentMarker | undefined =>
    OPENERS.has(word) ? "open" : CLOSERS.has(word) ? "close" : undefined;

  it("marks the same tokens as trivia on every corpus map", () => {
    expect(allMaps.length).toBeGreaterThan(0);
    for (const map of allMaps) {
      const source = readFileSync(map.path, "utf8");
      const { tokens, lineOffsets } = parseRms(source, lang, {
        commentOpenAliases: OPENERS,
        commentCloseAliases: CLOSERS,
      });
      const walk = walkComments(tokens, markerOf);
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].text === BOM) continue;
        if ((walk.gameComment[i] === 1) !== tokens[i].isTrivia) {
          const line = lineNumberOfOffset(lineOffsets, tokens[i].start);
          throw new Error(
            `${map.name}: walk and lexer disagree at line ${line}, token "${tokens[i].text}" (walk ${walk.gameComment[i]}, lexer trivia ${tokens[i].isTrivia})`,
          );
        }
      }
    }
  });
});
