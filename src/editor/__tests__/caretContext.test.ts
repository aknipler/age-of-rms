// docs/name-lookup-design.md slice B, the Code editor's slot detection.
// Each fixture marks the caret with `|`.

import { describe, expect, it } from "vitest";
import { buildLanguageIndex } from "../../parser/language";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { parseRms } from "../../parser/parser";
import { caretContext, lookupOffset } from "../caretContext";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

/**
 * Runs every fixture three ways and requires one answer: lexing everything,
 * reusing a parse of the same text, and reusing a STALE parse whose caret
 * line still lacks the word being typed (the worker lagging a keystroke
 * behind). The reuse path is an optimisation, so any disagreement with the
 * plain path is a bug in it.
 */
function at(marked: string) {
  const caret = marked.indexOf("|");
  const text = marked.slice(0, caret) + marked.slice(caret + 1);
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const stale = text.slice(0, lineStart) + text.slice(caret);
  const plain = caretContext(text, caret, lang);
  expect(caretContext(text, caret, lang, parseRms(text, langData))).toEqual(
    plain,
  );
  expect(caretContext(text, caret, lang, parseRms(stale, langData))).toEqual(
    plain,
  );
  // An edit higher up the worker has not caught up with, which must fall
  // back to lexing everything rather than trust shifted offsets.
  const editedAbove = parseRms("/* added */\n" + text, langData);
  expect(caretContext(text, caret, lang, editedAbove)).toEqual(plain);
  return plain;
}

describe("caretContext", () => {
  it("reads an attribute's argument slot inside a block", () => {
    const ctx = at("<LAND_GENERATION>\ncreate_land {\n  terrain_type GRA|\n}");
    expect(ctx.word).toBe("GRA");
    expect(ctx.slot).toMatchObject({
      kind: "argument",
      def: { type: "terrainConstant" },
    });
  });

  it("reads a slot on a single-line block", () => {
    const ctx = at("<LAND_GENERATION>\ncreate_land { terrain_type |");
    expect(ctx.word).toBe("");
    expect(ctx.slot).toMatchObject({ def: { type: "terrainConstant" } });
  });

  it("offers the enclosing command's attributes at a line start", () => {
    const ctx = at("<LAND_GENERATION>\ncreate_land {\n  terr|\n}");
    expect(ctx.slot).toMatchObject({
      kind: "lineStart",
      enclosing: { name: "create_land" },
      section: "LAND_GENERATION",
    });
  });

  it("remembers the block command whose header has no brace yet", () => {
    // Typing attributes under `create_object X` before the `{` offered only
    // commands, so avoid_forest_zone found create_actor_area by its text.
    const ctx = at("<OBJECTS_GENERATION>\ncreate_object SCOUT\n  avoid_for|");
    expect(ctx.slot).toMatchObject({
      kind: "lineStart",
      enclosing: null,
      pending: { name: "create_object" },
    });
    const done = at(
      "<OBJECTS_GENERATION>\ncreate_object SCOUT\n{\n}\n  avoid_for|",
    );
    expect(done.slot).toMatchObject({ kind: "lineStart", pending: null });
    const oneLiner = at("<LAND_GENERATION>\nbase_terrain GRASS\n  avoid_for|");
    expect(oneLiner.slot).toMatchObject({ kind: "lineStart", pending: null });
  });

  it("names the block's command, not the argument before the brace", () => {
    // Read the token before `{` once, which named this block GOLD and lost
    // create_object's attributes at the line start.
    const ctx = at("<OBJECTS_GENERATION>\ncreate_object GOLD {\n  num|\n}");
    expect(ctx.slot).toMatchObject({
      kind: "lineStart",
      enclosing: { name: "create_object" },
    });
    expect(ctx.inBlock).toBe(true);
    const attr = at(
      "<OBJECTS_GENERATION>\ncreate_object GOLD {\n  number_of_objects |",
    );
    expect(attr.statement).toMatchObject({
      head: "number_of_objects",
      args: [],
      enclosing: "create_object",
      firstOnLine: true,
    });
  });

  it("reads a line start right after an opening brace", () => {
    const ctx = at("<LAND_GENERATION>\ncreate_land { terr|");
    expect(ctx.slot).toMatchObject({ kind: "lineStart" });
  });

  it("knows the section at the top level", () => {
    const ctx = at("<OBJECTS_GENERATION>\ncreate_obj|");
    expect(ctx.slot).toMatchObject({
      kind: "lineStart",
      enclosing: null,
      section: "OBJECTS_GENERATION",
    });
  });

  it("reads a command's own argument", () => {
    const ctx = at("<OBJECTS_GENERATION>\ncreate_object GO|");
    expect(ctx.slot).toMatchObject({ def: { type: "objectConstant" } });
  });

  it("reads an if condition", () => {
    expect(at("if TINY|").slot).toEqual({ kind: "condition" });
  });

  it("reads #const's value slot and nothing for the name being defined", () => {
    expect(at("#const MY_FOREST FOR|").slot).toMatchObject({
      def: { type: "otherConstant" },
    });
    expect(at("#const MY_FOR|").slot).toBeNull();
  });

  it("offers directives after #", () => {
    expect(at("#co|").slot).toMatchObject({ kind: "lineStart" });
    expect(at("#co|").word).toBe("#co");
  });

  it("returns no slot inside a comment, open or after whitespace", () => {
    expect(at("/* create_land { terrain_type GRA| */").slot).toBeNull();
    expect(at("/* still open |").slot).toBeNull();
  });

  it("returns no slot past a command's last argument", () => {
    expect(
      at("<OBJECTS_GENERATION>\ncreate_object GOLD EXTRA|").slot,
    ).toBeNull();
  });

  it("does not count a closed block as enclosing", () => {
    const ctx = at("<LAND_GENERATION>\ncreate_land { }\ncreate_l|");
    expect(ctx.slot).toMatchObject({ kind: "lineStart", enclosing: null });
  });

  it("hands the lookup the caret's line start", () => {
    const ctx = at(
      "#const A 1\n<LAND_GENERATION>\ncreate_land { terrain_type A|",
    );
    expect(lookupOffset(ctx)).toBe("#const A 1\n<LAND_GENERATION>\n".length);
  });
});
