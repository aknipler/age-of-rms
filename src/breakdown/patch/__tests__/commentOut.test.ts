// 2026-10-22, commenting cards out and back in (breakdown-design Sec.3.13,
// Sec.4.15). Fixtures for the toggleCommentOut intent first, then a corpus
// sweep: every sampled card commented out reparses with no new error codes,
// shows up as a comment card Breakdown renders (so it never vanishes from the
// tab), and uncommenting that comment gives back the original bytes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type {
  IfNode,
  Item,
  ParseResult,
  RandomNode,
  Span,
} from "../../../parser/types";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import { applyEditResult, computeEdit, editsOf } from "../computeEdit";
import {
  PatchError,
  type DraggableCard,
  type RearrangeableNode,
} from "../intents";
import {
  commentCardPlaces,
  commentsBetweenItems,
  extractComments,
  inlineCommentStarts,
  leadingComments,
} from "../../comments";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const parse = (src: string): ParseResult => parseRms(src, langData);
const items = (r: ParseResult) => r.script.sections[0].items;
const errors = (r: ParseResult) =>
  r.diagnostics.filter((d) => d.severity === "error");
const comment = (r: ParseResult, i: number): DraggableCard => ({
  kind: "comment",
  span: extractComments(r.tokens)[i],
});

function toggle(src: string, cards: (r: ParseResult) => DraggableCard[]) {
  const a = parse(src);
  const result = computeEdit(
    a,
    { kind: "toggleCommentOut", cards: cards(a) },
    lang,
  );
  const out = applyEditResult(src, result);
  return { out, result, b: parse(out) };
}

const THREE =
  "<OBJECTS_GENERATION>\ncreate_object A\ncreate_object B\ncreate_object C\n";

describe("toggleCommentOut, commenting out", () => {
  it("wraps one card in /* */ and selects the new comment", () => {
    const { out, result, b } = toggle(THREE, (r) => [
      items(r)[1] as RearrangeableNode,
    ]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object A\n/* create_object B */\ncreate_object C\n",
    );
    expect(result.selection).toEqual([out.indexOf("/*")]);
    expect(extractComments(b.tokens)[0].start).toBe(result.caret);
  });

  it("wraps each card on its own and gives every new start in the new text", () => {
    const { out, result } = toggle(THREE, (r) => [
      items(r)[2] as RearrangeableNode,
      items(r)[0] as RearrangeableNode,
    ]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n/* create_object A */\ncreate_object B\n/* create_object C */\n",
    );
    expect(result.selection).toEqual([
      out.indexOf("/* create_object A"),
      out.indexOf("/* create_object C"),
    ]);
    expect(editsOf(result)).toHaveLength(4);
  });

  it("takes a whole block and a trailing same-line comment inside, nesting it", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A {\n\tnumber_of_objects 2\n} /* why */\ncreate_object B\n";
    const { out, b } = toggle(src, (r) => [items(r)[0] as RearrangeableNode]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n/* create_object A {\n\tnumber_of_objects 2\n} /* why */ */\ncreate_object B\n",
    );
    expect(errors(b)).toEqual([]);
    expect(extractComments(b.tokens)).toHaveLength(1);
  });

  it("wraps a whole conditional, branches and all", () => {
    const src =
      "<OBJECTS_GENERATION>\nif TINY_MAP\n\tcreate_object A\nelse\n\tcreate_object B\nendif\n";
    const { out, b } = toggle(src, (r) => [items(r)[0] as RearrangeableNode]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n/* if TINY_MAP\n\tcreate_object A\nelse\n\tcreate_object B\nendif */\n",
    );
    expect(items(b)).toHaveLength(0);
  });

  it("leaves the comments of a mixed selection alone", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A\n/* note */\ncreate_object B\n";
    const { out } = toggle(src, (r) => [
      items(r)[0] as RearrangeableNode,
      comment(r, 0),
    ]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n/* create_object A */\n/* note */\ncreate_object B\n",
    );
  });

  it("refuses an unclosed conditional", () => {
    const a = parse("<OBJECTS_GENERATION>\nif TINY_MAP\n\tcreate_object A\n");
    expect(() =>
      computeEdit(
        a,
        {
          kind: "toggleCommentOut",
          cards: [items(a)[0] as RearrangeableNode],
        },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("refuses a card holding a stray */, which would end the comment early", () => {
    const a = parse(
      "<OBJECTS_GENERATION>\ncreate_object A {\n\tnumber_of_objects 2 */\n}\n",
    );
    expect(a.diagnostics.some((d) => d.code === "RMS0002")).toBe(true);
    expect(() =>
      computeEdit(
        a,
        {
          kind: "toggleCommentOut",
          cards: [items(a)[0] as RearrangeableNode],
        },
        lang,
      ),
    ).toThrow(PatchError);
  });
});

describe("toggleCommentOut, uncommenting", () => {
  it("gives back the original bytes of a card it commented out", () => {
    const once = toggle(THREE, (r) => [items(r)[1] as RearrangeableNode]);
    const back = toggle(once.out, (r) => [comment(r, 0)]);
    expect(back.out).toBe(THREE);
    expect(back.result.selection).toEqual([THREE.indexOf("create_object B")]);
  });

  it("brings an inline comment back as an inline comment", () => {
    const src = "<OBJECTS_GENERATION>\ncreate_object A /* left */\n";
    const once = toggle(src, (r) => [items(r)[0] as RearrangeableNode]);
    expect(once.out).toBe(
      "<OBJECTS_GENERATION>\n/* create_object A /* left */ */\n",
    );
    expect(toggle(once.out, (r) => [comment(r, 0)]).out).toBe(src);
  });

  it("drops the lines of a hand written block's own /* and */", () => {
    const src =
      "<OBJECTS_GENERATION>\n\t/*\n\tcreate_object A\n\tcreate_object B\n\t*/\ncreate_object C\n";
    const { out, b, result } = toggle(src, (r) => [comment(r, 0)]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\n\tcreate_object A\n\tcreate_object B\ncreate_object C\n",
    );
    expect(items(b)).toHaveLength(3);
    expect(result.selection).toEqual([out.indexOf("create_object A")]);
  });

  it("keeps CRLF line ends intact", () => {
    const src =
      "<OBJECTS_GENERATION>\r\n/*\r\ncreate_object A\r\n*/\r\ncreate_object B\r\n";
    expect(toggle(src, (r) => [comment(r, 0)]).out).toBe(
      "<OBJECTS_GENERATION>\r\ncreate_object A\r\ncreate_object B\r\n",
    );
  });

  it("never joins two lines when the /* shares its line with code", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A /*\ncreate_object B */\n";
    const { out } = toggle(src, (r) => [comment(r, 0)]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object A \ncreate_object B\n",
    );
  });

  it("uncomments every comment of an all-comment selection", () => {
    const src =
      "<OBJECTS_GENERATION>\n/* create_object A */\n/* create_object B */\n";
    const { out, result } = toggle(src, (r) => [comment(r, 0), comment(r, 1)]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object A\ncreate_object B\n",
    );
    expect(result.selection).toEqual([
      out.indexOf("create_object A"),
      out.indexOf("create_object B"),
    ]);
  });

  it("refuses an empty comment, which holds no code", () => {
    const a = parse("<OBJECTS_GENERATION>\ncreate_object A\n/* */\n");
    expect(() =>
      computeEdit(
        a,
        { kind: "toggleCommentOut", cards: [comment(a, 0)] },
        lang,
      ),
    ).toThrow(PatchError);
  });
});

describe("a selected comment card in a group delete or move", () => {
  const src =
    "<OBJECTS_GENERATION>\ncreate_object A\n/* note */\ncreate_object B\ncreate_object C\n";

  it("is deleted with the rest, one undo entry", () => {
    const a = parse(src);
    const result = computeEdit(
      a,
      {
        kind: "removeNodes",
        nodes: [items(a)[0] as RearrangeableNode, comment(a, 0)],
      },
      lang,
    );
    expect(applyEditResult(src, result)).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object C\n",
    );
  });

  it("travels with the rest, in source order", () => {
    const a = parse(src);
    const result = computeEdit(
      a,
      {
        kind: "moveNodes",
        nodes: [items(a)[0] as RearrangeableNode, comment(a, 0)],
        to: { after: items(a)[2] },
      },
      lang,
    );
    expect(applyEditResult(src, result)).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object C\ncreate_object A\n/* note */\n",
    );
  });
});

describe("leadingComments", () => {
  it("finds a comment between a section header and its first card", () => {
    const src =
      "<OBJECTS_GENERATION>\n/* create_object A */\ncreate_object B\n";
    const r = parse(src);
    const found = leadingComments(
      items(r),
      extractComments(r.tokens),
      r.tokens,
      src.length,
    );
    expect(found.map((c) => src.slice(c.start, c.end))).toEqual([
      "/* create_object A */",
    ]);
  });

  it("finds every comment of an emptied branch, and none of its neighbours", () => {
    const src =
      "<OBJECTS_GENERATION>\n/* before */\nif TINY_MAP\n\t/* create_object A */\nelse\n\tcreate_object B\nendif\n";
    const r = parse(src);
    const node = items(r)[0] as IfNode;
    const found = leadingComments(
      node.branches[0].items,
      extractComments(r.tokens),
      r.tokens,
      r.tokens[node.branches[1].keyword].start,
    );
    expect(found.map((c) => src.slice(c.start, c.end))).toEqual([
      "/* create_object A */",
    ]);
  });
});

// ---- corpus sweep ----

const N_CARDS = 24;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Its own salt, so this sweep does not walk the same sequence as the gates
// beside it.
function fileSeed(name: string): number {
  let h = 0x51c0_2210;
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
  return h;
}

/** Every closed card a person can comment out, grouped by the list it sits in. */
function cardLists(r: ParseResult): RearrangeableNode[][] {
  const lists: RearrangeableNode[][] = [];
  const isCard = (item: Item): item is RearrangeableNode =>
    item.kind === "directive" ||
    (item.kind === "command" &&
      (item.block === undefined || item.block.close !== undefined)) ||
    (item.kind === "if" && item.endif !== undefined) ||
    (item.kind === "random" && item.end !== undefined);
  const visit = (list: Item[]) => {
    const here = list.filter(isCard);
    if (here.length > 0) lists.push(here);
    for (const item of list) {
      if (item.kind === "if") for (const b of item.branches) visit(b.items);
      if (item.kind === "random") {
        visit(item.preamble);
        for (const b of item.branches) visit(b.items);
      }
    }
  };
  visit(r.script.preamble);
  for (const s of r.script.sections) visit(s.items);
  return lists;
}

/**
 * The start of every comment Breakdown shows, the way BlockList and its call
 * sites pick them: leading, between and trailing comments of each list as
 * cards, each list bounded by what its call site passes (SectionView,
 * ConditionalCard, RandomCard, RawCard), plus the inline comments a command's row
 * shows. A card commented out on the same line as a block-less command
 * before it becomes that command's inline comment, which its row shows with
 * the same toggle button (InlineComment.tsx).
 */
function shownCommentStarts(r: ParseResult): {
  cards: Set<number>;
  inline: Set<number>;
} {
  const all = extractComments(r.tokens);
  const out = new Set<number>();
  const inlineAll = new Set<number>();
  const list = (items: Item[], boundary: number | undefined) => {
    const inline = inlineCommentStarts(items, r.tokens, r.source);
    for (const start of inline) inlineAll.add(start);
    const shown = all.filter((c) => !inline.has(c.start));
    for (const c of leadingComments(items, shown, r.tokens, boundary))
      out.add(c.start);
    for (const gap of commentsBetweenItems(items, shown, boundary).values())
      for (const c of gap) out.add(c.start);
    for (const item of items) {
      // RawCard renders a shared block's contents as a list of its own.
      if (item.kind === "orphanBlock")
        list(
          item.block.items,
          item.block.close !== undefined
            ? r.tokens[item.block.close].start
            : undefined,
        );
      if (item.kind === "if") {
        const node = item as IfNode;
        node.branches.forEach((b, i) =>
          list(
            b.items,
            node.branches[i + 1]
              ? r.tokens[node.branches[i + 1].keyword].start
              : node.endif !== undefined
                ? r.tokens[node.endif].start
                : undefined,
          ),
        );
      }
      if (item.kind === "random") {
        const node = item as RandomNode;
        if (node.preamble.length > 0)
          list(
            node.preamble,
            node.branches[0]
              ? r.tokens[node.branches[0].chanceKeyword].start
              : node.end !== undefined
                ? r.tokens[node.end].start
                : undefined,
          );
        node.branches.forEach((b, i) =>
          list(
            b.items,
            node.branches[i + 1]
              ? r.tokens[node.branches[i + 1].chanceKeyword].start
              : node.end !== undefined
                ? r.tokens[node.end].start
                : undefined,
          ),
        );
      }
    }
  };
  const sections = r.script.sections;
  list(
    r.script.preamble,
    sections[0] ? r.tokens[sections[0].header].start : r.source.length,
  );
  sections.forEach((s, i) =>
    list(
      s.items,
      sections[i + 1]
        ? r.tokens[sections[i + 1].header].start
        : r.source.length,
    ),
  );
  return { cards: out, inline: inlineAll };
}

function sortedCounts(values: string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
    .map(([k, n]) => `${n}×${k}`)
    .join("\n");
}

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

describe("comment out gate over the corpus", () => {
  it("found corpus files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(
      `${file.name} (seed ${fileSeed(file.name)})`,
      { timeout: 60_000 },
      () => {
        const original = readFileSync(file.path, "utf8");
        const rand = mulberry32(fileSeed(file.name));
        const a = parse(original);
        const lists = cardLists(a);
        if (lists.length === 0) return;
        const errorsBefore = sortedCounts(errors(a).map((d) => d.code));
        for (let iter = 0; iter < N_CARDS; iter++) {
          const list = lists[Math.floor(rand() * lists.length)];
          // Mostly one card, sometimes a few from one list, as a Shift or
          // Ctrl selection would give.
          const group =
            rand() < 0.7
              ? [list[Math.floor(rand() * list.length)]]
              : list.filter(() => rand() < 0.4);
          if (group.length === 0) continue;
          const what = group.map((n) => `${n.kind}@${n.span.start}`).join(",");
          const label = `${file.name} iter ${iter} (${what})`;
          let result;
          try {
            result = computeEdit(
              a,
              { kind: "toggleCommentOut", cards: group },
              lang,
            );
          } catch (e) {
            if (e instanceof PatchError) continue; // an unpaired marker
            throw new Error(`${label}: computeEdit threw ${String(e)}`);
          }
          const out = applyEditResult(original, result);
          const b = parse(out);
          expect(
            sortedCounts(errors(b).map((d) => d.code)),
            `${label}: new errors`,
          ).toBe(errorsBefore);
          // Every card's words are now comment text, and nothing else is.
          const groupWords = group.flatMap((n) =>
            a.tokens
              .filter(
                (t) =>
                  !t.isTrivia && t.start >= n.span.start && t.end <= n.span.end,
              )
              .map((t) => t.text),
          );
          const expectedWords = a.tokens
            .filter((t) => !t.isTrivia)
            .map((t) => t.text);
          for (const w of groupWords)
            expectedWords.splice(expectedWords.indexOf(w), 1);
          expect(
            sortedCounts(
              b.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
            ),
            `${label}: words`,
          ).toBe(sortedCounts(expectedWords));
          // Each result is a comment Breakdown shows, so the card has not
          // vanished from the tab.
          const comments = extractComments(b.tokens);
          const shown = shownCommentStarts(b);
          // commentCardPlaces, which the selection reads to tell a comment
          // card's anchor apart, is a second copy of the same walk. The two
          // must name the same cards.
          expect(
            [...commentCardPlaces(b, comments).keys()].sort((x, y) => x - y),
            `${label}: commentCardPlaces disagrees with BlockList`,
          ).toEqual([...shown.cards].sort((x, y) => x - y));
          const rendered = new Set([...shown.cards, ...shown.inline]);
          const made: Span[] = [];
          for (const start of result.selection ?? []) {
            const c = comments.find((x) => x.start === start);
            expect(c, `${label}: no comment at ${start}`).toBeDefined();
            expect(
              rendered.has(start),
              `${label}: comment at ${start} not shown`,
            ).toBe(true);
            made.push(c!);
          }
          // And uncommenting them all gives back the original bytes.
          const back = computeEdit(
            b,
            {
              kind: "toggleCommentOut",
              cards: made.map((span) => ({ kind: "comment", span })),
            },
            lang,
          );
          expect(applyEditResult(out, back), `${label}: round trip`).toBe(
            original,
          );
        }
      },
    );
  }
});
