// Phase 3.3, per-intent unit fixtures, breakdown-design Sec.10 (rev 4).
// Each asserts the exact TextEdit shape and/or that the re-parse yields the
// intended structure with clean astDiff, incl. every rev-2/3/4 defect fixture.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type { CommandNode, IfNode, RandomNode, RawNode, ParseResult } from "../../../parser/types";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { applyEdit, computeEdit } from "../computeEdit";
import { PatchError, type EditIntent } from "../intents";
import { astDiff, diffOptionsFor } from "./astDiff";
import { extractComments } from "../../comments";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

function parse(src: string): ParseResult {
  return parseRms(src, langData);
}

/** computeEdit + apply + reparse + astDiff-clean, returning the patched parse. */
function run(src: string, intent: EditIntent): { out: string; b: ParseResult; caret: number } {
  const a = parse(src);
  const { edit, caret } = computeEdit(a, intent, lang);
  const out = applyEdit(src, edit);
  const b = parse(out);
  const problems = astDiff(a, b, edit, diffOptionsFor(intent, edit));
  expect(problems).toEqual([]);
  return { out, b, caret };
}

const firstCmd = (r: ParseResult) => r.script.sections[0].items[0] as CommandNode;

describe("setArgValue (Sec.4.4)", () => {
  it("replaces exactly the arg span", () => {
    const src = "<LAND_GENERATION>\ncreate_land { land_percent 30 base_size 5 }";
    const a = parse(src);
    const attr = firstCmd(a).block!.items[0];
    const arg = (attr as CommandNode).args[0];
    const { out } = run(src, { kind: "setArgValue", arg, value: 55 });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land { land_percent 55 base_size 5 }");
  });

  it("quoted include path keeps its quotes; #const name gets none (Sec.3.4 overload)", () => {
    const src = '#include_drs "my maps/a.rms"\n#const FOO 5';
    const a = parse(src);
    const inc = a.script.preamble[0] as CommandNode; // DirectiveNode shape-compatible for args
    const { out } = run(src, { kind: "setArgValue", arg: inc.args[0], value: "other maps/b.rms" });
    expect(out).toContain('#include_drs "other maps/b.rms"');
    const a2 = parse(out);
    const cst = a2.script.preamble[1] as CommandNode;
    const { out: out2 } = run(out, { kind: "setArgValue", arg: cst.args[0], value: "BAR" });
    expect(out2).toContain("#const BAR 5");
    expect(out2).not.toContain('"BAR"');
  });
});

describe("delete modes (Sec.4.6)", () => {
  it("whole-line: node alone on its line vanishes with no blank residue", () => {
    const src = "<LAND_GENERATION>\ncreate_land\n{\n\tland_percent 30\n\tbase_size 5\n}";
    const a = parse(src);
    const node = firstCmd(a).block!.items[0] as never;
    const { out } = run(src, { kind: "removeNode", node });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land\n{\n\tbase_size 5\n}");
  });

  it("surgical: trailing comment on the same line keeps its position", () => {
    const src = "<LAND_GENERATION>\ncreate_land\n{\n\tland_percent 30 /* keep me */\n\tbase_size 5\n}";
    const a = parse(src);
    const node = firstCmd(a).block!.items[0] as never;
    const { out } = run(src, { kind: "removeNode", node });
    expect(out).toContain("/* keep me */");
    expect(out).not.toContain("land_percent");
  });

  it("surgical: inline sibling loses only the target plus one separator space", () => {
    const src = "<LAND_GENERATION>\ncreate_land { land_percent 30 base_size 5 }";
    const a = parse(src);
    const node = firstCmd(a).block!.items[0] as never;
    const { out } = run(src, { kind: "removeNode", node });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land { base_size 5 }");
  });

  it("deleting a construct deletes its interior comment (clause-4 scoping, AD4-Pag shape)", () => {
    const src = "<CONNECTION_GENERATION>\ncreate_connect_all_players_land\n{\n\treplace_terrain WATER GRASS\n\t/* replace_terrain DESERT ICE */\n\tterrain_cost WATER 7\n}\nbase_terrain WATER";
    const a = parse(src);
    const { out } = run(src, { kind: "removeNode", node: a.script.sections[0].items[0] as never });
    expect(out).not.toContain("ICE");
    expect(out).toContain("base_terrain WATER");
  });

  it("duplicate attributes: deleting the middle one leaves the others byte-identical", () => {
    const src =
      "<CONNECTION_GENERATION>\ncreate_connect_all_players_land\n{\n\treplace_terrain WATER SHALLOW\n\treplace_terrain MED_WATER WATER\n\treplace_terrain DEEP_WATER WATER\n}";
    const a = parse(src);
    const items = firstCmd(a).block!.items;
    const { out } = run(src, { kind: "removeNode", node: items[1] as never });
    expect(out).toContain("replace_terrain WATER SHALLOW");
    expect(out).toContain("replace_terrain DEEP_WATER WATER");
    expect(out).not.toContain("MED_WATER");
  });
});

describe("addAttribute / toggleFlag (Sec.4.6)", () => {
  it("own-lines block: inserted before } matching indent", () => {
    const src = "<LAND_GENERATION>\ncreate_land\n{\n\tland_percent 30\n}";
    const a = parse(src);
    const { out } = run(src, { kind: "addAttribute", target: firstCmd(a).block!, name: "base_size", value: [7] });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land\n{\n\tland_percent 30\n\tbase_size 7\n}");
  });

  it("inline block: inserted inline before }", () => {
    const src = "<LAND_GENERATION>\ncreate_land { land_percent 30 }";
    const a = parse(src);
    const { out } = run(src, { kind: "addAttribute", target: firstCmd(a).block!, name: "base_size", value: [7] });
    expect(out).toBe("<LAND_GENERATION>\ncreate_land { land_percent 30 base_size 7 }");
  });

  it("block-less command synthesizes braces (Sec.4.6, AttributeTarget=CommandNode)", () => {
    const src = "<LAND_GENERATION>\ncreate_land";
    const a = parse(src);
    const { out, b } = run(src, { kind: "addAttribute", target: firstCmd(a), name: "land_percent", value: [40] });
    expect(out).toContain("{");
    const cmd = firstCmd(b);
    expect(cmd.block?.items).toHaveLength(1);
  });

  it("toggleFlag on inserts the bare flag; off removes it", () => {
    const src = "<LAND_GENERATION>\ncreate_land { land_percent 30 }";
    const a = parse(src);
    const { out } = run(src, { kind: "toggleFlag", target: firstCmd(a).block!, name: "set_flat_terrain_only", on: true });
    expect(out).toContain("set_flat_terrain_only");
    const a2 = parse(out);
    const { out: out2 } = run(out, {
      kind: "toggleFlag",
      target: firstCmd(a2).block!,
      name: "set_flat_terrain_only",
      on: false,
    });
    expect(out2).not.toContain("set_flat_terrain_only");
  });
});

describe("addCommand + placeholders (Sec.4.3/Sec.4.5, rev 4 pins)", () => {
  it("placeholders parse as structured nodes — no RawNode, no errors", () => {
    const src = "<OBJECTS_GENERATION>\ncreate_object GOLD { number_of_objects 4 }";
    const a = parse(src);
    const { b } = run(src, {
      kind: "addCommand",
      at: { in: "section", section: a.script.sections[0] },
      name: "create_object",
    });
    const items = b.script.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items[1].kind).toBe("command");
    expect(b.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("empty section insert lands after the header", () => {
    const src = "<PLAYER_SETUP>\n<LAND_GENERATION>\nbase_terrain WATER";
    const a = parse(src);
    const { b } = run(src, {
      kind: "addCommand",
      at: { in: "section", section: a.script.sections[0] },
      name: "random_placement",
    });
    expect(b.script.sections[0].items).toHaveLength(1);
  });

  it("in:preamble appends after the last preamble item (Header tab, nothing selected)", () => {
    const src = "#const FOO 5\n<PLAYER_SETUP>";
    const { out, b } = run(src, { kind: "addCommand", at: { in: "preamble" }, name: "random_placement" });
    expect(b.script.preamble).toHaveLength(2);
    expect(out).toBe("#const FOO 5\nrandom_placement\n<PLAYER_SETUP>");
  });

  it("in:preamble on an empty preamble inserts at offset 0 (not reachable from the UI today — see SectionView.tsx)", () => {
    const src = "<PLAYER_SETUP>";
    const { out } = run(src, { kind: "addCommand", at: { in: "preamble" }, name: "random_placement" });
    expect(out).toBe("random_placement\n<PLAYER_SETUP>");
  });

  it("in:preamble with 2+ existing items reads onOwnLines from a real consecutive pair", () => {
    const src = "#const FOO 5\n#const BAR 6\n<PLAYER_SETUP>";
    const { out } = run(src, { kind: "addCommand", at: { in: "preamble" }, name: "random_placement" });
    expect(out).toBe("#const FOO 5\n#const BAR 6\nrandom_placement\n<PLAYER_SETUP>");
  });
});

describe("addCommand in:newSection (a canonical tab with no SectionNode yet)", () => {
  it("a wholly empty file gets the tag with no leading separator", () => {
    const { out, b } = run("", { kind: "addCommand", at: { in: "newSection", name: "PLAYER_SETUP" }, name: "random_placement" });
    expect(out).toBe("<PLAYER_SETUP>\nrandom_placement\n");
    expect(b.script.sections).toHaveLength(1);
    expect(b.script.sections[0].name).toBe("PLAYER_SETUP");
  });

  it("appends after the last existing section, not woven in at its canonical slot", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement";
    const { out } = run(src, { kind: "addCommand", at: { in: "newSection", name: "LAND_GENERATION" }, name: "create_land" });
    expect(out).toBe("<PLAYER_SETUP>\nrandom_placement\n<LAND_GENERATION>\ncreate_land\n");
  });

  it("appends after the preamble when there are no sections at all yet", () => {
    const src = "#const FOO 5";
    const { out } = run(src, { kind: "addCommand", at: { in: "newSection", name: "PLAYER_SETUP" }, name: "random_placement" });
    expect(out).toBe("#const FOO 5\n<PLAYER_SETUP>\nrandom_placement\n");
  });

  it("anchors after an empty existing section's header, not its (nonexistent) last item", () => {
    const src = "<PLAYER_SETUP>";
    const { out } = run(src, { kind: "addCommand", at: { in: "newSection", name: "LAND_GENERATION" }, name: "create_land" });
    expect(out).toBe("<PLAYER_SETUP>\n<LAND_GENERATION>\ncreate_land\n");
  });
});

// astDiff's clause 4 now knows addComment/editComment legitimately touch
// the trivia sequence (diffOptionsFor derives the right deletedRange/
// insertedRange exception per intent kind, see astDiff.ts), so these go
// through the same run()/astDiff pipeline as every other intent below,
// rather than asserting on computeEdit's raw output only.
describe("addComment (reuses addCommand's own InsertTarget resolution)", () => {
  it("appends /* */ at a section's own end, same placement as a bare addCommand", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement";
    const a = parse(src);
    const { out, caret } = run(src, { kind: "addComment", at: { in: "section", section: a.script.sections[0] } });
    expect(out).toBe("<PLAYER_SETUP>\nrandom_placement\n/* */");
    expect(caret).toBe(out.indexOf("/* */"));
  });

  it("inserts after a selected item, not just at the section's end", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement\nnomad_resources";
    const a = parse(src);
    const first = a.script.sections[0].items[0];
    const { out } = run(src, { kind: "addComment", at: { after: first } });
    expect(out).toBe("<PLAYER_SETUP>\nrandom_placement\n/* */\nnomad_resources");
  });

  it("the caret lands exactly on the new comment's own span.start, so CommentCard's focus registration matches", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement";
    const a = parse(src);
    const { out, caret } = run(src, { kind: "addComment", at: { in: "section", section: a.script.sections[0] } });
    const comments = extractComments(parseRms(out, langData).tokens);
    expect(comments).toHaveLength(1);
    expect(comments[0].start).toBe(caret);
  });
});

describe("editComment (a plain span replace, comments carry no Item at all)", () => {
  it("replaces exactly the content between the delimiters", () => {
    const src = "<PLAYER_SETUP>\n/* old */\nrandom_placement";
    const span = extractComments(parse(src).tokens)[0];
    const innerSpan = { start: span.start + 2, end: span.end - 2 };
    const { out } = run(src, { kind: "editComment", innerSpan, text: " new " });
    expect(out).toBe("<PLAYER_SETUP>\n/* new */\nrandom_placement");
  });

  it("a length-changing edit shifts later nodes without altering their text", () => {
    const src = "<PLAYER_SETUP>\n/* x */\nrandom_placement";
    const span = extractComments(parse(src).tokens)[0];
    const innerSpan = { start: span.start + 2, end: span.end - 2 };
    const { out, b } = run(src, { kind: "editComment", innerSpan, text: " a much longer note " });
    const cmd = b.script.sections[0].items[0];
    expect(out.slice(cmd.span.start, cmd.span.end)).toBe("random_placement");
  });

  // padCommentContent (comments.ts), exercised through the real intent:
  // the delimiters must stay whitespace-separated from the content no
  // matter what the caller supplies, or the run()/astDiff pipeline above
  // would itself catch the comment silently stopping being a comment.
  it("pads unpadded replacement text so the delimiters don't glue onto it", () => {
    const src = "<PLAYER_SETUP>\n/* old */\nrandom_placement";
    const span = extractComments(parse(src).tokens)[0];
    const innerSpan = { start: span.start + 2, end: span.end - 2 };
    const { out } = run(src, { kind: "editComment", innerSpan, text: "unpadded" });
    expect(out).toBe("<PLAYER_SETUP>\n/* unpadded */\nrandom_placement");
  });

  it("pads a fully empty replacement to a single space rather than gluing the delimiters together", () => {
    const src = "<PLAYER_SETUP>\n/* old */\nrandom_placement";
    const span = extractComments(parse(src).tokens)[0];
    const innerSpan = { start: span.start + 2, end: span.end - 2 };
    const { out } = run(src, { kind: "editComment", innerSpan, text: "" });
    expect(out).toBe("<PLAYER_SETUP>\n/* */\nrandom_placement");
  });

  it("keeps an already-padded multi-line block's own formatting instead of collapsing it", () => {
    const src = "<PLAYER_SETUP>\n/*\n * Author: Old\n */\nrandom_placement";
    const span = extractComments(parse(src).tokens)[0];
    const innerSpan = { start: span.start + 2, end: span.end - 2 };
    const { out } = run(src, { kind: "editComment", innerSpan, text: "\n * Author: New\n " });
    expect(out).toBe("<PLAYER_SETUP>\n/*\n * Author: New\n */\nrandom_placement");
  });
});

describe("branches (Sec.4.5 in:branch, Sec.4.10, Sec.4.4 optional targets)", () => {
  const condSrc = "if HUGE_MAP\n\t#define BIG\nelseif TINY_MAP\n\t#define SMALL\nendif";

  it("insert into a middle branch anchors before the next elseif", () => {
    const a = parse(condSrc);
    const node = a.script.preamble[0] as IfNode;
    const { b } = run(condSrc, {
      kind: "addCommand",
      at: { in: "branch", branch: { parent: node, index: 0 } },
      name: "grouped_by_team",
    });
    expect((b.script.preamble[0] as IfNode).branches[0].items).toHaveLength(2);
    expect((b.script.preamble[0] as IfNode).branches[1].items).toHaveLength(1);
  });

  it("insert into the last branch anchors before endif", () => {
    const a = parse(condSrc);
    const node = a.script.preamble[0] as IfNode;
    const { b } = run(condSrc, {
      kind: "addCommand",
      at: { in: "branch", branch: { parent: node, index: 1 } },
      name: "grouped_by_team",
    });
    expect((b.script.preamble[0] as IfNode).branches[1].items).toHaveLength(2);
  });

  it("unclosed parent suppresses the insert (PatchError, not a guess)", () => {
    const a = parse("if HUGE_MAP\n#define BIG");
    const node = a.script.preamble[0] as IfNode;
    expect(() =>
      computeEdit(a, { kind: "addCommand", at: { in: "branch", branch: { parent: node, index: 0 } }, name: "grouped_by_team" }, lang),
    ).toThrow(PatchError);
  });

  it("setCondition on a missing condition inserts after the keyword", () => {
    const src = "if\n#define X\nendif";
    const a = parse(src);
    const node = a.script.preamble[0] as IfNode;
    expect(node.branches[0].condition).toBeUndefined();
    const { out } = run(src, { kind: "setCondition", branch: { parent: node, index: 0 }, value: "HUGE_MAP" });
    expect(out.startsWith("if HUGE_MAP")).toBe(true);
  });

  it("addBranch elseif lands before endif's line; removeBranch removes exactly one branch", () => {
    const a = parse(condSrc);
    const node = a.script.preamble[0] as IfNode;
    const { out, b } = run(condSrc, { kind: "addBranch", parent: node, branch: "elseif" });
    expect((b.script.preamble[0] as IfNode).branches).toHaveLength(3);
    const a2 = parse(out);
    const n2 = a2.script.preamble[0] as IfNode;
    const { b: b2 } = run(out, { kind: "removeBranch", branch: { parent: n2, index: 1 } });
    expect((b2.script.preamble[0] as IfNode).branches).toHaveLength(2);
  });

  it("removing the only branch of an if / last percent_chance is refused", () => {
    const a = parse("if X\n#define Y\nendif");
    const one = a.script.preamble[0] as IfNode;
    expect(() => computeEdit(a, { kind: "removeBranch", branch: { parent: one, index: 0 } }, lang)).toThrow(PatchError);
    const r = parse("start_random\npercent_chance 100\n#define Z\nend_random");
    const rnd = r.script.preamble[0] as RandomNode;
    expect(() => computeEdit(r, { kind: "removeBranch", branch: { parent: rnd, index: 0 } }, lang)).toThrow(PatchError);
  });

  it("setChance replaces a present operand", () => {
    const src = "start_random\npercent_chance 40\n#define A\npercent_chance 60\n#define B\nend_random";
    const a = parse(src);
    const rnd = a.script.preamble[0] as RandomNode;
    const { out } = run(src, { kind: "setChance", branch: { parent: rnd, index: 0 }, value: 50 });
    expect(out).toContain("percent_chance 50");
  });
});

describe("applySuggestion (Sec.4.1 rev 4 — the quick-fix goes through the pipeline)", () => {
  it("typo fix promotes the run to a structured node", () => {
    const src = "<ELEVATION_GENERATION>\ncreate_elevation 5 { base_size 4 }";
    const typo = src.replace("base_size", "base_sixe");
    const a = parse(typo);
    const raw = firstCmd(a).block!.items.find((i) => i.kind === "raw") as RawNode;
    expect(raw).toBeDefined();
    const diag = a.diagnostics.find((d) => d.code === "RMS0200");
    expect(diag?.suggestion).toBe("base_size");
    const { edit } = computeEdit(
      a,
      { kind: "applySuggestion", node: raw, tokenIndex: raw.firstToken, replacement: diag!.suggestion! },
      lang,
    );
    const out = applyEdit(typo, edit);
    expect(out).toBe(src);
    const b = parse(out);
    expect(firstCmd(b).block!.items.every((i) => i.kind !== "raw")).toBe(true);
  });
});

describe("CRLF files (Sec.4.3 eol detection)", () => {
  it("inserts use \\r\\n and nothing else changes", () => {
    const src = "<LAND_GENERATION>\r\ncreate_land\r\n{\r\n\tland_percent 30\r\n}";
    const a = parse(src);
    const { out } = run(src, { kind: "addAttribute", target: firstCmd(a).block!, name: "base_size", value: [7] });
    expect(out).toBe("<LAND_GENERATION>\r\ncreate_land\r\n{\r\n\tland_percent 30\r\n\tbase_size 7\r\n}");
  });
});
