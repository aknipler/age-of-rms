// Sec.12 corpus gates. Two tiers:
//
// 1. EVERY .rms in test-maps/ (including test-maps/local/, test-maps/broken/
//    and any still-untriaged additions): parseRms must not throw and must
//    satisfy the coverage + span-fidelity properties. Non-negotiable.
// 2. The TRIAGED allowlist below additionally passes the zero-error gate.
//    A file joins this list only after the per-map triage protocol
//    (generates in DE + every diagnostic triaged — spec Sec.12). The corpus
//    grew to ~52 files in July 2026; triage is incremental, so most files
//    are tier-1 only for now.
//
// BCC2-Rekawa is deliberately NOT in the allowlist: its glued `}8050`
// (line 891) makes RMS0101 fire by design — it belongs in test-maps/broken/
// or fixed, per the spec.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import {
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

const refDb: ValidateReferenceDb = {
  language: lang,
  gameConstants: JSON.parse(
    readFileSync(join(REPO_ROOT, "reference", "data", "game-constants.json"), "utf8"),
  ) as GameConstantsForValidate,
};

// The REVISION_5-verified snapshot set, minus BCC2 (known real defect).
const ZERO_ERROR_ALLOWLIST = [
  "sample.rms",
  "AD4 - Ra.rms",
  "TC2 - Comeer v1.4.rms",
  "Menindee_AUS_v2.3.rms",
  "AK_ForeDaut_v1.3.rms",
  "AK_Six_Points_v1.4.rms",
  "QS_Three_Bays_v1.1.rms",
  "Pa_Site_v1.1.rms",
  "OWWC1Tewaipounamu-edited-v1.2.rms",
  "AK_Hourglass_v2.0.rms",
  "AK_Vanguard_v1.2.rms", // renamed from Vanguard_v1.2.rms — the old name silently dropped it from this gate
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
  ...listRms(LOCAL_DIR).map((name) => ({ name: `local/${name}`, path: join(LOCAL_DIR, name) })),
  ...listRms(BROKEN_DIR).map((name) => ({ name: `broken/${name}`, path: join(BROKEN_DIR, name) })),
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
// error-severity diagnostic — these are maps confirmed to generate in DE, so
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
      const errors = validate(parseRms(source, lang), refDb).filter((d) => d.severity === "error");
      expect(errors.map((e) => `${e.code} @${e.span.start}: ${e.message}`)).toEqual([]);
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
    for (let i = 0; i < SMALL_REPS; i += 1) smallTokens = parseRms(small, lang).tokens.length;
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
 * file. Two tracked maps do contain this — both a commented-out
 * `create_object SHORE_FISH { … }` block, which is what an author writes when
 * disabling a command — and each loses about half its lines in game.
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

  const liveTokens = (src: string, aliases?: ReadonlySet<string>) =>
    parseRms(src, lang, { commentOpenAliases: aliases }).tokens.filter((t) => !t.isTrivia).length;

  const affected = allMaps.filter((m) => {
    const src = readFileSync(m.path, "utf8");
    return liveTokens(src, ALIASES) < liveTokens(src);
  });

  it("the alias set is exactly the constants valued 69, and is not empty", () => {
    expect(ALIASES.size).toBeGreaterThan(0);
    expect([...ALIASES].sort()).toEqual(["ATTR_PROJECTILE_ARC", "SHORE_FISH"]);
  });

  it("reports which maps the engine truncates", () => {
    // Not a threshold — a census. It prints so the number is re-derived each
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
