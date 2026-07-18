// §12 fuzz-lite: random token soup must never throw and must satisfy the
// coverage/span-fidelity properties; plus the adversarial deep-nesting case
// (spec §5.0). Seeded PRNG — failures reproduce.

import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { checkProperties, loadLanguage } from "./testUtils";

const lang = loadLanguage();

/** Mulberry32 — tiny deterministic PRNG. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = [
  "{",
  "}",
  "/*",
  "*/",
  "if",
  "elseif",
  "else",
  "endif",
  "start_random",
  "percent_chance",
  "end_random",
  "<PLAYER_SETUP>",
  "<LAND_GENERATION>",
  "#define",
  "#const",
  "#include_drs",
  "#bogus",
  "create_land",
  "create_object",
  "terrain_type",
  "land_percent",
  "base_terrain",
  "GRASS",
  "GOLD",
  "50",
  "-3",
  "0.5",
  "rnd(1,5)",
  "rnd(1,",
  "5)",
  "(A",
  "+",
  "1)",
  "(",
  ")",
  '"quoted',
  'path"',
  "50%",
  "}8050",
  "create_land{",
  "//nope",
  "inf",
  "-inf",
  "unknown_word",
  "2V1",
];

describe("fuzz-lite (seeded)", () => {
  it("1000 random token soups: no throw, properties hold", () => {
    const rand = prng(0xa0e2);
    for (let iter = 0; iter < 1000; iter++) {
      const len = 1 + Math.floor(rand() * 120);
      const parts: string[] = [];
      for (let i = 0; i < len; i++) {
        parts.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
        parts.push(rand() < 0.1 ? "\n" : " ");
      }
      const source = parts.join("");
      const result = parseRms(source, lang); // must not throw
      const problems = checkProperties(result);
      if (problems.length > 0) {
        throw new Error(`iteration ${iter} failed:\n${problems.slice(0, 5).join("\n")}\nsource:\n${source}`);
      }
    }
  });

  it("20k-token nested-if adversary completes without throwing (§5.0)", () => {
    const source = new Array(20000).fill("if").join(" ");
    const result = parseRms(source, lang);
    expect(checkProperties(result)).toEqual([]);
  });

  it("20k-token nested-brace adversary via unknown-command blocks", () => {
    const source = new Array(10000).fill("foo {").join(" ");
    const result = parseRms(source, lang);
    expect(checkProperties(result)).toEqual([]);
  });

  it("degenerate inputs: empty, whitespace, one giant token", () => {
    for (const source of ["", "   \n\t  ", "x".repeat(100000)]) {
      const result = parseRms(source, lang);
      expect(checkProperties(result)).toEqual([]);
    }
  });
});
