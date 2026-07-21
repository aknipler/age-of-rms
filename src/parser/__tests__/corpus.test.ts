// §12 corpus gates. Two tiers:
//
// 1. EVERY .rms in test-maps/ (including test-maps/broken/ and any
//    still-untriaged additions): parseRms must not throw and must satisfy
//    the coverage + span-fidelity properties. Non-negotiable.
// 2. The TRIAGED allowlist below additionally passes the zero-error gate.
//    A file joins this list only after the per-map triage protocol
//    (generates in DE + every diagnostic triaged — spec §12). The corpus
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
import { checkProperties, loadLanguage, REPO_ROOT } from "./testUtils";

const lang = loadLanguage();
const MAPS_DIR = join(REPO_ROOT, "test-maps");
const BROKEN_DIR = join(MAPS_DIR, "broken");

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

function listRms(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => e.name);
}

const allMaps = [
  ...listRms(MAPS_DIR).map((name) => ({ name, path: join(MAPS_DIR, name) })),
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

describe("corpus: benchmark sanity (Vanguard, ~50k tokens)", () => {
  it("parses the benchmark file in a sane time", () => {
    const path = join(MAPS_DIR, "AK_Vanguard_v1.2.rms");
    if (!existsSync(path)) return;
    const source = readFileSync(path, "utf8");
    const t0 = performance.now();
    parseRms(source, lang);
    const elapsed = performance.now() - t0;
    // Deliberately generous (spec §9: 10x observed local, flake-resistant).
    expect(elapsed).toBeLessThan(500);
  });
});
