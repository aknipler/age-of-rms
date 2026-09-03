// tools-api-design.md Sec.9 item 1, "these are the surviving obligations of
// seven review rounds, not a substitute for review." Nothing in this repo
// tested the wire encode/decode path before BUG-017: `InfSentinel` and
// `SerializedParseResult` describe the SHAPE, `numeric()` decodes one already-
// wire number, but nothing built the ENCODE direction or proved it round-trips
// through real JSON.
//
// Two matchers, by design (Sec.9 item 1, both halves): `toStrictEqual` for the
// hand-built fixtures in this file, because they are ours and carry no
// incidental `undefined`-valued keys; `toEqual` for the real corpus parse,
// because Sec.1 tolerates `undefined`-valued optional keys and `toStrictEqual`
// fails on its first run against real input (4,017 such keys, measured
// 2026-08-13). The mutation-test note from the spec: putting a `[undefined]`
// into a fixture should turn the (a) assertions red; it cannot turn (b) red,
// because the corpus carries no non-finite value at all (measured, zero `inf`
// words, zero 20+-digit literals across every map on disk); that split is
// exactly why (a) exists as a SEPARATE, hand-built group rather than being
// folded into the corpus loop.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage, REPO_ROOT } from "../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../parser/language";
import type { CommandNode } from "../../parser/types";
import { numeric, type ToolMessage } from "../../../tools-api/index";
import { validateToolMessage } from "../protocol";
import { encodeArgValue, encodeParseResultForWire, findProhibitedValue, WireEncodingError } from "../wireCodec";
import { reconstructAliasedCommand } from "../defReconstruction";

const lang = loadLanguage();
const language = buildLanguageIndex(lang);

// ---------------------------------------------------------------------------
// (a) Hand-built fixtures, toStrictEqual.
// ---------------------------------------------------------------------------

describe("(a) ToolMessage kinds round-trip through real JSON unchanged", () => {
  const fixtures: Record<string, ToolMessage> = {
    progress: { type: "progress", fraction: 0.5, note: "halfway" },
    "progress (indeterminate)": { type: "progress" },
    partial: { type: "partial", output: { blocks: [{ kind: "heading", text: "Partial" }, { kind: "text", text: "still running" }] } },
    result: {
      type: "result",
      output: { blocks: [{ kind: "table", columns: ["a", "b"], rows: [["1", "2"]], rowSpans: [{ start: 0, end: 1 }] }] },
      edits: [{ start: 0, end: 3, newText: "xyz" }],
    },
    error: { type: "error", message: "boom", reason: "tool-error" },
  };

  for (const [name, message] of Object.entries(fixtures)) {
    it(`${name} survives JSON.stringify/JSON.parse and still validates`, () => {
      const wire = JSON.parse(JSON.stringify(message)) as unknown;
      expect(wire).toStrictEqual(message);
      const check = validateToolMessage(wire);
      expect(check.ok, check.ok ? "" : check.problem).toBe(true);
    });
  }
});

describe("(a) an AST containing inf/-inf and an infinite rnd bound", () => {
  // `land_percent` is `percent`, a NUMERIC_ARGUMENT_TYPES member, so the
  // parser accepts the bare words `inf`/`-inf` in that slot (parser.ts:1024).
  // The rnd bound reaches Infinity by an unrelated route: `parseRndValue` is
  // `Number()` over an unbounded digit run, and 310 nines overflows
  // `Number.MAX_VALUE` (~1.8e308), the exact route parser-design Sec.4's
  // amendment names as the "not an oversight-free freebie" half.
  const HUGE = "9".repeat(310);
  const SOURCE = [
    "<LAND_GENERATION>",
    "create_player_lands {",
    "  land_percent inf",
    "}",
    "create_player_lands {",
    `  land_percent rnd(${HUGE},1)`,
    "}",
    "create_player_lands {",
    "  land_percent -inf",
    "}",
  ].join("\n");

  // `land_percent` is an ATTRIBUTE, consumed inside each command's own block,
  // the numeric value lives on the attribute node's arg, not the command's.
  function landPercentArgs() {
    const parsed = parseRms(SOURCE, lang);
    const encoded = encodeParseResultForWire(parsed);
    const commands = encoded.script.sections[0].items.filter((i): i is CommandNode<never, never> => i.kind === "command");
    return commands.map((c) => {
      const attr = c.block!.items.find((i) => i.kind === "attribute")!;
      return (attr as { args: { value: unknown }[] }).args[0].value;
    });
  }

  it("encodes inf/-inf as the sentinel and strips def, both surviving a real JSON round trip", () => {
    const parsed = parseRms(SOURCE, lang);
    const encoded = encodeParseResultForWire(parsed);
    const roundTripped = JSON.parse(JSON.stringify(encoded));
    // toStrictEqual, not toEqual: this fixture is hand-built and carries no
    // incidental undefined-valued keys, so the stronger matcher is the right
    // one, Sec.9 item 1(a)'s own justification for the split.
    expect(roundTripped).toStrictEqual(encoded);

    const [infArg, rndArg, negInfArg] = landPercentArgs();
    expect(infArg).toStrictEqual({ inf: 1 });
    expect(negInfArg).toStrictEqual({ inf: -1 });
    expect(rndArg).toStrictEqual({ rnd: [{ inf: 1 }, 1] });

    // def is not merely typed away, it is ABSENT from the wire payload, the
    // 41%-of-payload saving Sec.4.2 exists for.
    const firstCommand = encoded.script.sections[0].items[0] as CommandNode<never, never>;
    expect(Object.prototype.hasOwnProperty.call(firstCommand, "def")).toBe(false);
  });

  it("decodes back to the original Infinity/-Infinity through numeric()", () => {
    const [infArg, rndArg, negInfArg] = landPercentArgs();
    expect(numeric(infArg as never)).toBe(Infinity);
    expect(numeric(negInfArg as never)).toBe(-Infinity);
    const rnd = rndArg as { rnd: [unknown, unknown] };
    expect(numeric(rnd.rnd[0] as never)).toBe(Infinity);
    expect(numeric(rnd.rnd[1] as never)).toBe(1);
  });
});

describe("(a) aliased-command fixture — a consumer holding only the wire form still reaches create_land", () => {
  const SOURCE = ["<LAND_GENERATION>", "#const L 32", "L {", "  land_percent 20", "}"].join("\n");

  it("strips L's def from the wire, and reconstruction from tokens+symbols+referenceData.language recovers create_land", () => {
    const parsed = parseRms(SOURCE, lang);
    const realCommand = parsed.script.sections[0].items.find((i): i is CommandNode => i.kind === "command")!;
    expect(realCommand.def?.name).toBe("create_land");

    const encoded = encodeParseResultForWire(parsed);
    const wireCommand = encoded.script.sections[0].items.find((i) => i.kind === "command")!;
    expect(Object.prototype.hasOwnProperty.call(wireCommand, "def")).toBe(false);

    const roundTripped = JSON.parse(JSON.stringify(encoded)) as typeof encoded;
    const recovered = reconstructAliasedCommand("L", roundTripped.symbols, roundTripped.tokens, language);
    // THE MUTANT: delete the `?? reconstructAliasedCommand(...)` fallback from
    // defReconstruction.ts's command-def resolution (or delete
    // `Parser.aliasedCommand`'s own fallback in parser.ts) and this goes red,
    // `recovered` becomes `undefined` where the real parse resolved
    // "create_land".
    expect(recovered).toStrictEqual(realCommand.def);
    expect(recovered?.name).toBe("create_land");
  });
});

describe("(a) values the serializer must reject before they ever reach the wire", () => {
  it("rejects an array containing undefined", () => {
    expect(findProhibitedValue([1, undefined, 3])).toEqual({ path: "$[1]", kind: "undefined as an array element" });
  });

  it("rejects a Map anywhere in the tree", () => {
    expect(findProhibitedValue({ nested: { m: new Map([["a", 1]]) } })).toEqual({ path: "$.nested.m", kind: "Map" });
  });

  it("rejects a Set anywhere in the tree", () => {
    expect(findProhibitedValue({ s: new Set([1, 2]) })).toEqual({ path: "$.s", kind: "Set" });
  });

  it("rejects NaN", () => {
    expect(findProhibitedValue({ v: NaN })).toEqual({ path: "$.v", kind: "NaN" });
  });

  it("rejects a bare ±Infinity outside the sentinel", () => {
    expect(findProhibitedValue({ v: Infinity })).toEqual({ path: "$.v", kind: "±Infinity outside the sentinel" });
  });

  it("tolerates an undefined-VALUED KEY on a plain object — Sec.1's explicit carve-out", () => {
    expect(findProhibitedValue({ a: 1, b: undefined })).toBeNull();
  });

  it("passes a clean tree", () => {
    expect(findProhibitedValue({ a: 1, b: [1, 2, 3], c: { d: "x" } })).toBeNull();
  });

  it("encodeArgValue throws WireEncodingError on NaN rather than silently encoding it", () => {
    expect(() => encodeArgValue(NaN)).toThrow(WireEncodingError);
    expect(() => encodeArgValue({ rnd: [NaN, 1] })).toThrow(WireEncodingError);
  });
});

// ---------------------------------------------------------------------------
// (b) A real parseRms result over the corpus, toEqual, plus the scanner run
// directly. Measured: zero occurrences of `inf`/`-inf` as a word and zero
// numeric literals of 20+ digits across the corpus (2026-08-13), so this loop
// has low power to catch a sentinel regression on its own, that is exactly
// why (a) exists as a separate, hand-built group.
// ---------------------------------------------------------------------------

describe("(b) corpus: encode -> real JSON round trip is lossless, and the wire is clean", () => {
  const mapNames = readdirSync(join(REPO_ROOT, "test-maps"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".rms"))
    .map((entry) => entry.name)
    .sort();

  it(`finds maps to check (${mapNames.length})`, () => {
    // A control that cannot come back zero: an empty corpus makes every
    // assertion below vacuously green.
    expect(mapNames.length).toBeGreaterThan(0);
  });

  for (const mapName of mapNames) {
    it(`${mapName}: encode round-trips through JSON and stays clean of every prohibited kind`, () => {
      const source = readFileSync(join(REPO_ROOT, "test-maps", mapName), "utf8");
      const parsed = parseRms(source, lang);
      const encoded = encodeParseResultForWire(parsed);
      const roundTripped = JSON.parse(JSON.stringify(encoded));
      // toEqual, not toStrictEqual: a real parse carries thousands of
      // undefined-valued optional keys (ArgNode.def and CommandNode/
      // AttributeNode/DirectiveNode.block/close), which toStrictEqual would
      // fail on for a reason unrelated to what this test checks (Sec.1).
      expect(roundTripped).toEqual(encoded);
      expect(findProhibitedValue(encoded)).toBeNull();
    });
  }
});
