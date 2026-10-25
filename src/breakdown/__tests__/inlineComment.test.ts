// 2026-10-21, a command's inline comment (breakdown-design Sec.3.3.2), e.g.
// `create_land /* top left island */`. Round trips both ways: text written
// in the Code tab is found as the row's comment, and the row's add, edit and
// delete write text that re-parses to the same structure and is found
// again. A corpus sweep runs add, edit and delete on real commands and
// requires the file to come back byte for byte.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { buildLanguageIndex } from "../../parser/language";
import type { CommandNode, Item, ParseResult } from "../../parser/types";
import {
  checkProperties,
  collectNodes,
  loadLanguage,
  REPO_ROOT,
} from "../../parser/__tests__/testUtils";
import { applyEditResult, computeEdit } from "../patch/computeEdit";
import type { EditIntent } from "../patch/intents";
import {
  commentsBetweenItems,
  extractComments,
  inlineCommentStarts,
  inlineCommentsOf,
} from "../comments";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const parse = (src: string): ParseResult => parseRms(src, langData);
const first = (r: ParseResult) => r.script.sections[0].items[0] as CommandNode;
const texts = (r: ParseResult, c: CommandNode) =>
  inlineCommentsOf(c, r.tokens, r.source).map((s) =>
    r.source.slice(s.start, s.end),
  );

function apply(src: string, intentOf: (r: ParseResult) => EditIntent) {
  const r = parse(src);
  return applyEditResult(src, computeEdit(r, intentOf(r), lang));
}

/** Add, then set the text, the two steps the row takes. */
function addAndEdit(src: string, text: string, pick = first): string {
  const added = apply(src, (r) => ({
    kind: "addInlineComment",
    command: pick(r),
  }));
  return apply(added, (r) => {
    const span = inlineCommentsOf(pick(r), r.tokens, r.source)[0];
    return {
      kind: "editComment",
      innerSpan: { start: span.start + 2, end: span.end - 2 },
      text,
    };
  });
}

function removeFirstInline(src: string, pick = first): string {
  return apply(src, (r) => ({
    kind: "removeComment",
    span: inlineCommentsOf(pick(r), r.tokens, r.source)[0],
  }));
}

describe("Code to Breakdown: which comments are the row's", () => {
  it.each([
    [
      "block on the next line",
      "<LAND_GENERATION>\ncreate_land /* top left island */\n{\n  terrain_type GRASS\n}\n",
      ["/* top left island */"],
    ],
    [
      "block on the same line",
      "<LAND_GENERATION>\ncreate_land /* a */ { terrain_type GRASS }\n",
      ["/* a */"],
    ],
    [
      "after the arguments",
      "<TERRAIN_GENERATION>\ncreate_terrain FOREST /* c */\n{\n  land_percent 5\n}\n",
      ["/* c */"],
    ],
    [
      "between name and argument, as hand written",
      "<TERRAIN_GENERATION>\ncreate_terrain /* c */ FOREST\n{\n  land_percent 5\n}\n",
      ["/* c */"],
    ],
    [
      "no block, trailing on the line",
      "<PLAYER_SETUP>\nrandom_placement /* r */\nnomad_resources\n",
      ["/* r */"],
    ],
    [
      "two on one line",
      "<PLAYER_SETUP>\nrandom_placement /* a */ /* b */\n",
      ["/* a */", "/* b */"],
    ],
    [
      "a comment on a later line is not the row's",
      "<LAND_GENERATION>\ncreate_land\n/* below */\n{\n  terrain_type GRASS\n}\n",
      [],
    ],
    [
      "a comment inside the block is not the row's",
      "<LAND_GENERATION>\ncreate_land { /* inside */ terrain_type GRASS }\n",
      [],
    ],
    [
      "the next command's line is not the row's",
      "<PLAYER_SETUP>\nrandom_placement\nnomad_resources /* n */\n",
      [],
    ],
  ])("%s", (_name, src, expected) => {
    const r = parse(src);
    expect(texts(r, first(r))).toEqual(expected);
  });

  it("a block-less command's inline comment is not also a comment card", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement /* r */\nnomad_resources\n";
    const r = parse(src);
    const items = r.script.sections[0].items as Item[];
    const all = extractComments(r.tokens);
    const inline = inlineCommentStarts(items, r.tokens, r.source);
    const gaps = commentsBetweenItems(
      items,
      all.filter((c) => !inline.has(c.start)),
      src.length,
    );
    expect(gaps.size).toBe(0);
    // A plain comment on its own line still is one.
    const own =
      "<PLAYER_SETUP>\nrandom_placement\n/* own */\nnomad_resources\n";
    const r2 = parse(own);
    const items2 = r2.script.sections[0].items as Item[];
    expect(inlineCommentStarts(items2, r2.tokens, r2.source).size).toBe(0);
  });
});

describe("Breakdown to Code: add, edit, delete from the row", () => {
  it.each([
    [
      "create_land, block on the next line",
      "<LAND_GENERATION>\ncreate_land\n{\n  terrain_type GRASS\n}\n",
      "<LAND_GENERATION>\ncreate_land /* top left island */\n{\n  terrain_type GRASS\n}\n",
    ],
    [
      "create_land, block on the same line",
      "<LAND_GENERATION>\ncreate_land { terrain_type GRASS }\n",
      "<LAND_GENERATION>\ncreate_land /* top left island */ { terrain_type GRASS }\n",
    ],
    [
      "an argument stays beside its command",
      "<TERRAIN_GENERATION>\ncreate_terrain FOREST\n{\n  land_percent 5\n}\n",
      "<TERRAIN_GENERATION>\ncreate_terrain FOREST /* top left island */\n{\n  land_percent 5\n}\n",
    ],
    [
      "no block",
      "<PLAYER_SETUP>\nrandom_placement\nnomad_resources\n",
      "<PLAYER_SETUP>\nrandom_placement /* top left island */\nnomad_resources\n",
    ],
  ])("%s", (_name, src, withComment) => {
    const out = addAndEdit(src, "top left island");
    expect(out).toBe(withComment);
    // The row finds what it wrote, and nothing about the command changed.
    const a = parse(src);
    const b = parse(out);
    expect(texts(b, first(b))).toEqual(["/* top left island */"]);
    expect(b.tokens.filter((t) => !t.isTrivia).map((t) => t.text)).toEqual(
      a.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
    );
    expect(collectNodes(b).map((n) => n.node.label)).toEqual(
      collectNodes(a).map((n) => n.node.label),
    );
    expect(checkProperties(b)).toEqual([]);
    // Deleting from the row gives back the original bytes.
    expect(removeFirstInline(out)).toBe(src);
  });

  it("editing keeps the comment where the author wrote it", () => {
    const src =
      "<TERRAIN_GENERATION>\ncreate_terrain /* old */ FOREST\n{\n  land_percent 5\n}\n";
    const out = apply(src, (r) => {
      const span = inlineCommentsOf(first(r), r.tokens, r.source)[0];
      return {
        kind: "editComment",
        innerSpan: { start: span.start + 2, end: span.end - 2 },
        text: "new",
      };
    });
    expect(out).toBe(
      "<TERRAIN_GENERATION>\ncreate_terrain /* new */ FOREST\n{\n  land_percent 5\n}\n",
    );
  });

  it("deleting a block-less card takes its inline comment, deleting a block card already did", () => {
    const blockless =
      "<PLAYER_SETUP>\nrandom_placement /* r */\nnomad_resources\n";
    expect(
      apply(blockless, (r) => ({ kind: "removeNode", node: first(r) })),
    ).toBe("<PLAYER_SETUP>\nnomad_resources\n");
    const block =
      "<LAND_GENERATION>\ncreate_land /* a */\n{\n  terrain_type GRASS\n}\ncreate_land\n{\n}\n";
    expect(apply(block, (r) => ({ kind: "removeNode", node: first(r) }))).toBe(
      "<LAND_GENERATION>\ncreate_land\n{\n}\n",
    );
  });

  it("adding a card after one with an inline comment leaves the comment on its own card", () => {
    // Inserting at the span end used to push the comment onto the new line.
    const src = "<PLAYER_SETUP>\nrandom_placement /* r */\n";
    const out = apply(src, (r) => ({
      kind: "addCommand",
      at: { after: first(r) },
      name: "nomad_resources",
    }));
    expect(out).toBe(
      "<PLAYER_SETUP>\nrandom_placement /* r */\nnomad_resources\n",
    );
    const b = parse(out);
    expect(texts(b, first(b))).toEqual(["/* r */"]);
  });

  it("duplicating copies the comment once and the original keeps its own", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement /* r */\n";
    const out = apply(src, (r) => ({ kind: "duplicateNode", node: first(r) }));
    expect(out).toBe(
      "<PLAYER_SETUP>\nrandom_placement /* r */\nrandom_placement /* r */\n",
    );
  });

  it("a move carries a comment that starts on the card's line and runs onto the next, whole", () => {
    const src =
      "<PLAYER_SETUP>\nrandom_placement /* a\n b */\nnomad_resources\nbehavior_version 2\n";
    const r = parse(src);
    const items = r.script.sections[0].items;
    const out = applyEditResult(
      src,
      computeEdit(
        r,
        { kind: "moveNode", node: first(r), to: { after: items[2] } },
        lang,
      ),
    );
    expect(out).toBe(
      "<PLAYER_SETUP>\nnomad_resources\nbehavior_version 2\nrandom_placement /* a\n b */\n",
    );
  });
});

// ---- corpus sweep ----

function mapsUnder(dir: string): { name: string; path: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => ({ name: e.name, path: join(dir, e.name) }));
}

const files = [
  ...mapsUnder(join(REPO_ROOT, "test-maps")),
  ...mapsUnder(join(REPO_ROOT, "test-maps", "local")),
].sort((x, y) => x.name.localeCompare(y.name));

/** Every command in card lists or blocks, in source order. */
function commandsOf(r: ParseResult): CommandNode[] {
  const out: CommandNode[] = [];
  const visit = (items: Item[]) => {
    for (const item of items) {
      if (item.kind === "command") {
        out.push(item);
        if (item.block) visit(item.block.items);
      }
      if (item.kind === "if") for (const b of item.branches) visit(b.items);
      if (item.kind === "random") {
        visit(item.preamble);
        for (const b of item.branches) visit(b.items);
      }
    }
  };
  visit(r.script.preamble);
  for (const s of r.script.sections) visit(s.items);
  return out;
}

const PER_FILE = 12;

describe("inline comment round trip over the corpus", () => {
  it("found corpus files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(file.name, { timeout: 60_000 }, () => {
      const original = readFileSync(file.path, "utf8");
      const a = parse(original);
      const all = commandsOf(a).filter(
        (c) => inlineCommentsOf(c, a.tokens, a.source).length === 0,
      );
      // Spread over the file rather than the first few.
      const step = Math.max(1, Math.floor(all.length / PER_FILE));
      for (let k = 0; k < all.length && k / step < PER_FILE; k += step) {
        const target = all[k];
        const at = target.span.start;
        // Re-finds the same command after each edit, by its start, which
        // the comment is always inserted after.
        const pick = (r: ParseResult) =>
          commandsOf(r).find((c) => c.span.start === at)!;
        const label = `${file.name}: ${a.tokens[target.name].text}@${at}`;
        const out = addAndEdit(original, "note", pick);
        const b = parse(out);
        expect(texts(b, pick(b)), `${label}, found again`).toEqual([
          "/* note */",
        ]);
        expect(
          b.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
          `${label}, words`,
        ).toEqual(a.tokens.filter((t) => !t.isTrivia).map((t) => t.text));
        expect(
          collectNodes(b).map((n) => n.node.label),
          `${label}, structure`,
        ).toEqual(collectNodes(a).map((n) => n.node.label));
        expect(removeFirstInline(out, pick), `${label}, delete`).toBe(original);
      }
    });
  }
});
