// 2026-09-18, the card-rearranging intents (breakdown-design Sec.4.12):
// moveNode, duplicateNode, addControlFlow and the `{ before: Item }`
// InsertTarget. moveNode is the first intent that produces TWO edits, so
// this file exercises applyEditResult rather than run()'s single applyEdit.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type {
  CommandNode,
  DirectiveNode,
  IfNode,
  ParseResult,
  RandomNode,
} from "../../../parser/types";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import {
  applyEdit,
  applyEditResult,
  computeEdit,
  editsOf,
} from "../computeEdit";
import { PatchError, type EditIntent } from "../intents";
import { astDiff, diffOptionsFor } from "./astDiff";
import { extractComments } from "../../comments";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

function parse(src: string): ParseResult {
  return parseRms(src, langData);
}

const items = (r: ParseResult) => r.script.sections[0].items;
const cmd = (r: ParseResult, i: number) => items(r)[i] as CommandNode;
const ifNode = (r: ParseResult, i: number) => items(r)[i] as IfNode;
const names = (r: ParseResult) =>
  items(r).map((it) =>
    it.kind === "command" ? r.tokens[it.name].text : it.kind,
  );
const errors = (r: ParseResult) =>
  r.diagnostics.filter((d) => d.severity === "error");

/** Single-edit intents still go through the Sec.4.8 comparator, exactly as patch.unit.test.ts's run() does. */
function runSingle(src: string, intent: EditIntent) {
  const a = parse(src);
  const result = computeEdit(a, intent, lang);
  expect(result.removal).toBeUndefined();
  const out = applyEdit(src, result.edit);
  const b = parse(out);
  expect(
    astDiff(a, b, result.edit, diffOptionsFor(intent, result.edit)),
  ).toEqual([]);
  return { out, b, caret: result.caret };
}

describe("{ before: Item } (the mirror of after)", () => {
  it("inserts above the first item of a section at that item's indent", () => {
    const src = "<OBJECTS_GENERATION>\ncreate_object GOLD\ncreate_object STONE";
    const a = parse(src);
    const { out, caret } = runSingle(src, {
      kind: "addCommand",
      at: { before: cmd(a, 0) },
      name: "create_object",
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object TODO\ncreate_object GOLD\ncreate_object STONE",
    );
    expect(out.slice(caret)).toMatch(/^TODO/);
  });

  it("inside a branch, the anchor keeps its line and the new line takes its indent", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif";
    const a = parse(src);
    const anchor = ifNode(a, 0).branches[0].items[0];
    const { out } = runSingle(src, {
      kind: "addComment",
      at: { before: anchor },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\t/* */\n\tcreate_object GOLD\nendif",
    );
  });
});

// A card whose own line starts with something else first — a directive
// glued to a sibling directive by a tab, a comment sitting after a
// command's own args — makes the anchor's start position NOT own-line, and
// computeEdit refuses rather than splice new text onto that shared line.
// The corpus case (test-maps/24hr_Mont Saint Michel.rms:93, `#const SIZE`
// tab-separated from `#const MAPSIZE 260`) used to reparse `create_object`
// as `#const SIZE`'s OWN value — `#const`'s value slot is declared
// `acceptsKnownName: true` (reference/data/language.json), so it swallows
// any adjacent word, newline or not — turning one real command into a
// RawNode.
describe("insertAfterItem/insertBeforeItem refuse a same-line anchor", () => {
  it("before a directive glued to a preceding sibling by a tab", () => {
    const src =
      "<PLAYER_SETUP>\n#const SIZE\t#const MAPSIZE 260\ncreate_object GOLD";
    const a = parse(src);
    const anchor = (a.script.sections[0].items as DirectiveNode[])[1];
    expect(() =>
      computeEdit(
        a,
        { kind: "addCommand", at: { before: anchor }, name: "create_object" },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("after a directive glued to a preceding sibling by a tab", () => {
    const src = "<PLAYER_SETUP>\n#const SIZE\t#const MAPSIZE 260";
    const a = parse(src);
    const anchor = (a.script.sections[0].items as DirectiveNode[])[1];
    expect(() =>
      computeEdit(
        a,
        { kind: "addCommand", at: { after: anchor }, name: "create_object" },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("after a comment sitting between a command's own args and its own block", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object PH_NEUTRAL_OFF /* note */\n{\n\tnumber_of_objects 1\n}";
    const a = parse(src);
    const comment = extractComments(a.tokens)[0];
    expect(() =>
      computeEdit(
        a,
        {
          kind: "addCommand",
          at: { after: { kind: "comment", span: comment } },
          name: "create_object",
        },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("still inserts cleanly around an anchor that owns its own line", () => {
    const src = "<PLAYER_SETUP>\n#const FOO 1\n#const MAPSIZE 260";
    const a = parse(src);
    const anchor = (a.script.sections[0].items as DirectiveNode[])[1];
    const { out } = runSingle(src, {
      kind: "addCommand",
      at: { before: anchor },
      name: "create_object",
    });
    expect(out).toBe(
      "<PLAYER_SETUP>\n#const FOO 1\ncreate_object TODO\n#const MAPSIZE 260",
    );
  });
});

describe("duplicateNode", () => {
  it("copies a one-line command right below itself", () => {
    const src = "<OBJECTS_GENERATION>\ncreate_object GOLD\ncreate_object STONE";
    const a = parse(src);
    const { out, b, caret } = runSingle(src, {
      kind: "duplicateNode",
      node: cmd(a, 0),
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object GOLD\ncreate_object GOLD\ncreate_object STONE",
    );
    expect(names(b)).toEqual([
      "create_object",
      "create_object",
      "create_object",
    ]);
    // The caret is the copy's own start, the offset its card anchors on.
    expect(caret).toBe(items(b)[1].span.start);
  });

  it("copies a multi-line block byte for byte, trailing comment included", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object GOLD /* main gold */\n{\n\tnumber_of_objects 4\n}\ncreate_object STONE";
    const a = parse(src);
    const { out, b } = runSingle(src, {
      kind: "duplicateNode",
      node: cmd(a, 0),
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object GOLD /* main gold */\n{\n\tnumber_of_objects 4\n}\ncreate_object GOLD /* main gold */\n{\n\tnumber_of_objects 4\n}\ncreate_object STONE",
    );
    expect(extractComments(b.tokens)).toHaveLength(2);
  });

  it("a nested card's copy lands at the same depth", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\t{\n\t\tnumber_of_objects 4\n\t}\nendif";
    const a = parse(src);
    const node = ifNode(a, 0).branches[0].items[0] as CommandNode;
    const { out, b } = runSingle(src, { kind: "duplicateNode", node });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\t{\n\t\tnumber_of_objects 4\n\t}\n\tcreate_object GOLD\n\t{\n\t\tnumber_of_objects 4\n\t}\nendif",
    );
    expect(ifNode(b, 0).branches[0].items).toHaveLength(2);
  });

  it("duplicating a whole conditional keeps every branch", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nelse\n\tcreate_object STONE\nendif";
    const a = parse(src);
    const { b } = runSingle(src, { kind: "duplicateNode", node: ifNode(a, 0) });
    expect(items(b).map((i) => i.kind)).toEqual(["if", "if"]);
    expect(ifNode(b, 1).branches).toHaveLength(2);
  });

  it("refuses an unclosed conditional", () => {
    const src = "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n";
    const a = parse(src);
    expect(() =>
      computeEdit(a, { kind: "duplicateNode", node: ifNode(a, 0) }, lang),
    ).toThrow(PatchError);
  });
});

/** Both halves applied, plus the well-formedness half of Sec.4.8 clause 5. */
function runMove(src: string, intent: EditIntent) {
  const a = parse(src);
  const result = computeEdit(a, intent, lang);
  expect(result.removal).toBeDefined();
  const out = applyEditResult(src, result);
  const b = parse(out);
  expect(errors(b)).toEqual(errors(a));
  return { a, b, out, result };
}

describe("moveNode", () => {
  const three =
    "<OBJECTS_GENERATION>\ncreate_object GOLD\ncreate_object STONE\ncreate_object WOOD";

  it("moves a card up (insert before its previous sibling)", () => {
    const a = parse(three);
    const { out, b, result } = runMove(three, {
      kind: "moveNode",
      node: cmd(a, 1),
      to: { before: cmd(a, 0) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object STONE\ncreate_object GOLD\ncreate_object WOOD",
    );
    // The caret is the moved card's new start, in the FINAL text.
    expect(out.slice(result.caret)).toMatch(/^create_object STONE/);
    expect(result.caret).toBe(items(b)[0].span.start);
  });

  it("moves a card down (insert after its next sibling), caret slides up by the removed length", () => {
    const a = parse(three);
    const { out, b, result } = runMove(three, {
      kind: "moveNode",
      node: cmd(a, 0),
      to: { after: cmd(a, 1) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object STONE\ncreate_object GOLD\ncreate_object WOOD",
    );
    expect(result.caret).toBe(items(b)[1].span.start);
  });

  it("into an empty branch, gaining one indent level on every line", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\nendif\ncreate_object GOLD\n{\n\tnumber_of_objects 4\n}";
    const a = parse(src);
    const { out, b } = runMove(src, {
      kind: "moveNode",
      node: cmd(a, 1),
      to: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\t{\n\t\tnumber_of_objects 4\n\t}\nendif\n",
    );
    expect(items(b)).toHaveLength(1);
    expect(ifNode(b, 0).branches[0].items).toHaveLength(1);
  });

  it("out of a branch to section level, losing the indent level", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\t{\n\t\tnumber_of_objects 4\n\t}\nendif\ncreate_object STONE";
    const a = parse(src);
    const node = ifNode(a, 0).branches[0].items[0] as CommandNode;
    const { out, b } = runMove(src, {
      kind: "moveNode",
      node,
      to: { after: cmd(a, 1) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\nendif\ncreate_object STONE\ncreate_object GOLD\n{\n\tnumber_of_objects 4\n}",
    );
    expect(ifNode(b, 0).branches[0].items).toHaveLength(0);
    expect(names(b)).toEqual(["if", "create_object", "create_object"]);
  });

  it("a same-line trailing comment travels with the card, a next-line one stays", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object GOLD /* gold */\n/* about stone */\ncreate_object STONE";
    const a = parse(src);
    const { out } = runMove(src, {
      kind: "moveNode",
      node: cmd(a, 0),
      to: { after: cmd(a, 1) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n/* about stone */\ncreate_object STONE\ncreate_object GOLD /* gold */",
    );
  });

  it("between two branches of one conditional", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nelse\n\tcreate_object STONE\nendif";
    const a = parse(src);
    const node = ifNode(a, 0).branches[0].items[0] as CommandNode;
    const { out, b } = runMove(src, {
      kind: "moveNode",
      node,
      to: { in: "branch", branch: { parent: ifNode(a, 0), index: 1 } },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\nelse\n\tcreate_object STONE\n\tcreate_object GOLD\nendif",
    );
    expect(ifNode(b, 0).branches[1].items).toHaveLength(2);
  });

  it("a whole conditional moves as one card", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif\ncreate_object STONE";
    const a = parse(src);
    const { out } = runMove(src, {
      kind: "moveNode",
      node: ifNode(a, 0),
      to: { after: cmd(a, 1) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object STONE\nif REGICIDE\n\tcreate_object GOLD\nendif",
    );
  });

  it("refuses to move a conditional into its own branch", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif";
    const a = parse(src);
    expect(() =>
      computeEdit(
        a,
        {
          kind: "moveNode",
          node: ifNode(a, 0),
          to: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
        },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("refuses the degenerate move after itself", () => {
    const a = parse(three);
    expect(() =>
      computeEdit(
        a,
        { kind: "moveNode", node: cmd(a, 0), to: { after: cmd(a, 0) } },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("refuses an unclosed random block", () => {
    const src =
      "<OBJECTS_GENERATION>\nstart_random\npercent_chance 50\ncreate_object GOLD";
    const a = parse(src);
    const node = items(a)[0] as RandomNode;
    expect(node.kind).toBe("random");
    expect(() =>
      computeEdit(a, { kind: "moveNode", node, to: { after: node } }, lang),
    ).toThrow(PatchError);
  });

  it("the two halves never overlap and applying them in either order agrees", () => {
    const a = parse(three);
    const result = computeEdit(
      a,
      { kind: "moveNode", node: cmd(a, 2), to: { before: cmd(a, 0) } },
      lang,
    );
    const [hi, lo] = editsOf(result);
    expect(lo.end).toBeLessThanOrEqual(hi.start);
    // Descending application (what applyEditResult does) against the
    // Monaco-style simultaneous application, both from original offsets.
    const simultaneous =
      three.slice(0, lo.start) +
      lo.newText +
      three.slice(lo.end, hi.start) +
      hi.newText +
      three.slice(hi.end);
    expect(applyEditResult(three, result)).toBe(simultaneous);
  });
});

// A comment is DraggableCard's non-Item half (intents.ts's CommentRef):
// moveNode's node can be one, and InsertTarget's after/before can anchor on
// one too, so a comment can both be dragged itself and be something another
// card drags beside. Comment cards had no drag wiring at all before this.
describe("moveNode with a comment", () => {
  it("a comment moves past the commands around it", () => {
    const src =
      "<OBJECTS_GENERATION>\n/* about gold */\ncreate_object GOLD\ncreate_object STONE";
    const a = parse(src);
    const comment = extractComments(a.tokens)[0];
    const { out } = runMove(src, {
      kind: "moveNode",
      node: { kind: "comment", span: comment },
      to: { after: cmd(a, 1) },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object GOLD\ncreate_object STONE\n/* about gold */",
    );
  });

  it("a command can be dropped beside a comment", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object GOLD\n/* about stone */\ncreate_object STONE\ncreate_object WOOD";
    const a = parse(src);
    const comment = extractComments(a.tokens)[0];
    const { out } = runMove(src, {
      kind: "moveNode",
      node: cmd(a, 2),
      to: { after: { kind: "comment", span: comment } },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object GOLD\n/* about stone */\ncreate_object WOOD\ncreate_object STONE\n",
    );
  });

  it("a comment can move into an empty branch, gaining one indent level", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\nendif\n/* leftover note */\ncreate_object GOLD";
    const a = parse(src);
    const comment = extractComments(a.tokens)[0];
    const { out } = runMove(src, {
      kind: "moveNode",
      node: { kind: "comment", span: comment },
      to: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\t/* leftover note */\nendif\ncreate_object GOLD",
    );
  });

  it("refuses the degenerate move after itself", () => {
    const src = "<OBJECTS_GENERATION>\n/* note */\ncreate_object GOLD";
    const a = parse(src);
    const comment = extractComments(a.tokens)[0];
    const node = { kind: "comment" as const, span: comment };
    expect(() =>
      computeEdit(a, { kind: "moveNode", node, to: { after: node } }, lang),
    ).toThrow(PatchError);
  });
});

describe("addControlFlow", () => {
  it("an empty if at section level, caret on the placeholder condition", () => {
    const src = "<OBJECTS_GENERATION>\ncreate_object GOLD";
    const a = parse(src);
    const { out, b, caret } = runSingle(src, {
      kind: "addControlFlow",
      at: { in: "section", section: a.script.sections[0] },
      construct: "if",
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object GOLD\nif TODO\nendif",
    );
    expect(out.slice(caret)).toMatch(/^TODO/);
    const node = items(b)[1] as IfNode;
    expect(node.kind).toBe("if");
    expect(node.endif).toBeDefined();
    expect(node.branches[0].items).toHaveLength(0);
  });

  it("a random block inside a branch, every line at the branch's depth", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif";
    const a = parse(src);
    const { out, b, caret } = runSingle(src, {
      kind: "addControlFlow",
      at: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
      construct: "random",
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\tstart_random\n\t\tpercent_chance\n\tend_random\nendif",
    );
    expect(out.slice(caret)).toMatch(/^\n/);
    const random = ifNode(b, 0).branches[0].items[1] as RandomNode;
    expect(random.kind).toBe("random");
    expect(random.branches).toHaveLength(1);
    expect(random.end).toBeDefined();
  });

  it("before a selected card, with a space-indented file's own step", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n  create_object GOLD\nendif";
    const a = parse(src);
    const anchor = ifNode(a, 0).branches[0].items[0];
    const { out } = runSingle(src, {
      kind: "addControlFlow",
      at: { before: anchor },
      construct: "random",
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n  start_random\n    percent_chance\n  end_random\n  create_object GOLD\nendif",
    );
  });
});

describe("insertText continuation lines follow the destination indent (2026-09-18)", () => {
  it("a two-command template dropped in a branch indents both commands", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif";
    const a = parse(src);
    const text =
      "create_object A\n{\n\tnumber_of_objects 1\n}\ncreate_object B";
    const { out, caret } = runSingle(src, {
      kind: "insertText",
      at: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
      text,
      caretOffset: 0,
    });
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\n\tcreate_object A\n\t{\n\t\tnumber_of_objects 1\n\t}\n\tcreate_object B\nendif",
    );
    expect(out.slice(caret)).toMatch(/^create_object A/);
  });

  it("a caret past a header comment still lands on the first command", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object GOLD\nendif";
    const a = parse(src);
    const text = "/* header */\ncreate_object A\ncreate_object B";
    const { out, caret } = runSingle(src, {
      kind: "insertText",
      at: { in: "branch", branch: { parent: ifNode(a, 0), index: 0 } },
      text,
      caretOffset: "/* header */\n".length,
    });
    expect(out.slice(caret)).toMatch(/^create_object A/);
  });
});
