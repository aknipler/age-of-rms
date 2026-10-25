// 2026-10-21, multi-select's two engine intents (breakdown-design Sec.3.12):
// removeNodes and moveNodes. Fixtures first, then the undo contract
// (applyEditIntent pushes every edit in ONE applyTextEdits call, which
// useDocument turns into one Monaco undo entry, see undoGrouping.test.ts),
// then a seeded corpus sweep in the shape of rearrange.property.test.ts:
// a group delete or move re-parses well formed, loses nothing it should
// keep, and the edits applied as Monaco applies them (all at once, from
// original offsets) agree with applying them one after another.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type {
  CommandNode,
  IfNode,
  Item,
  ParseResult,
} from "../../../parser/types";
import {
  checkProperties,
  collectNodes,
  loadLanguage,
  REPO_ROOT,
} from "../../../parser/__tests__/testUtils";
import { applyEditResult, computeEdit, editsOf } from "../computeEdit";
import {
  PatchError,
  type InsertTarget,
  type RearrangeableNode,
  type TextEdit,
} from "../intents";
import { applyEditIntent } from "../../applyEdit";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);

const parse = (src: string): ParseResult => parseRms(src, langData);
const items = (r: ParseResult) => r.script.sections[0].items;
const cmd = (r: ParseResult, i: number) => items(r)[i] as CommandNode;
const errors = (r: ParseResult) =>
  r.diagnostics.filter((d) => d.severity === "error");

function run(src: string, nodes: (r: ParseResult) => RearrangeableNode[]) {
  const a = parse(src);
  const result = computeEdit(a, { kind: "removeNodes", nodes: nodes(a) }, lang);
  return { out: applyEditResult(src, result), result };
}

function move(
  src: string,
  nodes: (r: ParseResult) => RearrangeableNode[],
  to: (r: ParseResult) => InsertTarget,
) {
  const a = parse(src);
  const result = computeEdit(
    a,
    { kind: "moveNodes", nodes: nodes(a), to: to(a) },
    lang,
  );
  const out = applyEditResult(src, result);
  return { out, result, b: parse(out) };
}

const FOUR =
  "<OBJECTS_GENERATION>\ncreate_object A\ncreate_object B\ncreate_object C\ncreate_object D\n";

describe("removeNodes", () => {
  it("deletes scattered cards, leaving the rest byte for byte", () => {
    const { out, result } = run(FOUR, (r) => [cmd(r, 0), cmd(r, 2)]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object D\n",
    );
    expect(editsOf(result)).toHaveLength(2);
  });

  it("merges the removals of neighbouring cards into one edit", () => {
    const { out, result } = run(FOUR, (r) => [cmd(r, 1), cmd(r, 2)]);
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object A\ncreate_object D\n",
    );
    expect(editsOf(result)).toHaveLength(1);
  });

  it("two cards sharing one line do not claim the same separating space twice", () => {
    const src =
      "<PLAYER_SETUP>\nrandom_placement behavior_version 2 nomad_resources\n";
    const a = parse(src);
    const result = computeEdit(
      a,
      { kind: "removeNodes", nodes: [cmd(a, 0), cmd(a, 2)] },
      lang,
    );
    const edits = editsOf(result).sort((x, y) => x.start - y.start);
    for (let i = 1; i < edits.length; i++)
      expect(edits[i].start).toBeGreaterThan(edits[i - 1].end);
    const b = parse(applyEditResult(src, result));
    expect(items(b).map((i) => b.tokens[(i as CommandNode).name].text)).toEqual(
      ["behavior_version"],
    );
  });

  it("a selected card inside another selected card goes with it, deleted once", () => {
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object A\nendif\ncreate_object B\n";
    const { out } = run(src, (r) => [
      items(r)[0] as IfNode,
      (items(r)[0] as IfNode).branches[0].items[0] as CommandNode,
    ]);
    expect(out).toBe("<OBJECTS_GENERATION>\ncreate_object B\n");
  });

  it("takes a block-less command's inline comment with it", () => {
    const src = "<PLAYER_SETUP>\nrandom_placement /* r */\nnomad_resources\n";
    const { out } = run(src, (r) => [cmd(r, 0)]);
    expect(out).toBe("<PLAYER_SETUP>\nnomad_resources\n");
  });
});

describe("moveNodes", () => {
  it("drops scattered cards together, in source order, at the target", () => {
    const { out, b, result } = move(
      FOUR,
      (r) => [cmd(r, 2), cmd(r, 0)], // given out of order on purpose
      (r) => ({ after: cmd(r, 3) }),
    );
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object D\ncreate_object A\ncreate_object C\n",
    );
    expect(errors(b)).toEqual([]);
    // Each moved card's new start, in the NEW text, for re-selection.
    expect(result.selection!.map((p) => out.slice(p, p + 15))).toEqual([
      "create_object A",
      "create_object C",
    ]);
    expect(result.caret).toBe(result.selection![0]);
  });

  it("upward, before the first card", () => {
    const { out, result } = move(
      FOUR,
      (r) => [cmd(r, 1), cmd(r, 3)],
      (r) => ({ before: cmd(r, 0) }),
    );
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object D\ncreate_object A\ncreate_object C\n",
    );
    expect(result.selection!.map((p) => out.slice(p, p + 15))).toEqual([
      "create_object B",
      "create_object D",
    ]);
  });

  it("a drop right beside one of the moved cards folds into its removal", () => {
    // A and C move to just above D, which is just below C. The insert
    // point is the end of C's own removed line.
    const { out } = move(
      FOUR,
      (r) => [cmd(r, 0), cmd(r, 2)],
      (r) => ({ before: cmd(r, 3) }),
    );
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object A\ncreate_object C\ncreate_object D\n",
    );
  });

  it("into a branch, each card takes the branch's indent", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A\nif REGICIDE\n\tcreate_object X\nendif\ncreate_object B\n";
    const { out, b } = move(
      src,
      (r) => [cmd(r, 0), cmd(r, 2)],
      (r) => ({ after: (items(r)[1] as IfNode).branches[0].items[0] }),
    );
    expect(out).toBe(
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object X\n\tcreate_object A\n\tcreate_object B\nendif\n",
    );
    expect((items(b)[0] as IfNode).branches[0].items).toHaveLength(3);
  });

  it("refuses a target beside or inside one of the moved cards", () => {
    const a = parse(FOUR);
    expect(() =>
      computeEdit(
        a,
        {
          kind: "moveNodes",
          nodes: [cmd(a, 0), cmd(a, 2)],
          to: { after: cmd(a, 2) },
        },
        lang,
      ),
    ).toThrow(PatchError);
    const src =
      "<OBJECTS_GENERATION>\nif REGICIDE\n\tcreate_object X\nendif\ncreate_object B\n";
    const c = parse(src);
    const ifn = items(c)[0] as IfNode;
    expect(() =>
      computeEdit(
        c,
        {
          kind: "moveNodes",
          nodes: [ifn, cmd(c, 1)],
          to: { in: "branch", branch: { parent: ifn, index: 0 } },
        },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("refuses to move a bare #const, whose open value would take the next word", () => {
    // Found by the corpus sweep below in 24hr_Mont Saint Michel.rms, where
    // `#const SIZE` dropped above an effect_amount turned it into a raw node.
    const src =
      "#const SIZE\n#const OTHER 2\n<PLAYER_SETUP>\neffect_amount SET_ATTRIBUTE VILLAGER 0 1\nnomad_resources\n";
    const a = parse(src);
    const bare = a.script.preamble[0] as RearrangeableNode;
    const anchor = a.script.sections[0].items[0];
    expect(() =>
      computeEdit(
        a,
        { kind: "moveNode", node: bare, to: { before: anchor } },
        lang,
      ),
    ).toThrow(PatchError);
    expect(() =>
      computeEdit(
        a,
        {
          kind: "moveNodes",
          nodes: [bare, a.script.preamble[1] as RearrangeableNode],
          to: { before: anchor },
        },
        lang,
      ),
    ).toThrow(PatchError);
  });

  it("carries each card's same-line comment along", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A /* a */\ncreate_object B\ncreate_object C { number_of_objects 2 } /* c */\ncreate_object D\n";
    const { out } = move(
      src,
      (r) => [cmd(r, 0), cmd(r, 2)],
      (r) => ({ after: cmd(r, 3) }),
    );
    expect(out).toBe(
      "<OBJECTS_GENERATION>\ncreate_object B\ncreate_object D\ncreate_object A /* a */\ncreate_object C { number_of_objects 2 } /* c */\n",
    );
  });
});

describe("one undo entry", () => {
  // useDocument turns one applyTextEdits call into one pushEditOperations
  // behind its own pushStackElement (undoGrouping.test.ts pins that), so
  // "undoable as one step" is "pushed in one call", tested here, plus that
  // reversing that one entry restores the file.
  function pushed(
    src: string,
    intentOf: (r: ParseResult) => Parameters<typeof computeEdit>[1],
  ) {
    const a = parse(src);
    const calls: (readonly TextEdit[])[] = [];
    const result = applyEditIntent(a, intentOf(a), lang, (edits) => {
      calls.push(edits);
    });
    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
    // Undo replays the entry's inverse: every edit at once, from the
    // patched text's own coordinates.
    const edits = [...calls[0]].sort((x, y) => x.start - y.start);
    let after = src;
    for (const e of [...edits].reverse())
      after = after.slice(0, e.start) + e.newText + after.slice(e.end);
    let shift = 0;
    const inverse = edits.map((e) => {
      const start = e.start + shift;
      shift += e.newText.length - (e.end - e.start);
      return {
        start,
        end: start + e.newText.length,
        newText: src.slice(e.start, e.end),
      };
    });
    let undone = after;
    for (const e of [...inverse].reverse())
      undone = undone.slice(0, e.start) + e.newText + undone.slice(e.end);
    expect(undone).toBe(src);
    return calls[0];
  }

  it("a group delete is one push of every removal", () => {
    const edits = pushed(FOUR, (r) => ({
      kind: "removeNodes",
      nodes: [cmd(r, 0), cmd(r, 3)],
    }));
    expect(edits).toHaveLength(2);
  });

  it("a group move is one push of every removal and the insert", () => {
    const edits = pushed(FOUR, (r) => ({
      kind: "moveNodes",
      nodes: [cmd(r, 0), cmd(r, 2)],
      to: { after: cmd(r, 3) },
    }));
    expect(edits).toHaveLength(3);
  });

  it("a group delete overlapping an edit still in flight is refused whole, never half applied", () => {
    const a = parse(FOUR);
    const calls: unknown[] = [];
    const inFlight = [
      {
        start: a.script.sections[0].items[3].span.start,
        end: a.script.sections[0].items[3].span.start + 6,
        newText: "x",
      },
    ];
    const result = applyEditIntent(
      a,
      { kind: "removeNodes", nodes: [cmd(a, 0), cmd(a, 3)] },
      lang,
      (e) => calls.push(e),
      inFlight,
    );
    expect(result).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ---- corpus sweep ----

const N_GROUPS = 8;

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

// Its own salt, so this sweep does not walk the same sequence as the two
// gates beside it.
function fileSeed(name: string): number {
  let h = 0x3a17_1021;
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
  return h;
}

/** Every closed card-list item a person can select, grouped by the list it sits in (a selection is one section's cards). */
function movableLists(r: ParseResult): RearrangeableNode[][] {
  const lists: RearrangeableNode[][] = [];
  const isMovable = (item: Item): item is RearrangeableNode =>
    item.kind === "directive" ||
    (item.kind === "command" &&
      (item.block === undefined || item.block.close !== undefined)) ||
    (item.kind === "if" && item.endif !== undefined) ||
    (item.kind === "random" && item.end !== undefined);
  const visit = (list: Item[]) => {
    const here = list.filter(isMovable);
    if (here.length >= 2) lists.push(here);
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

describe("multi-card gate over the corpus", () => {
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
        const lists = movableLists(a);
        if (lists.length === 0) return;
        const pickList = () => lists[Math.floor(rand() * lists.length)];
        const wordsBefore = sortedCounts(
          a.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
        );
        const labelsBefore = sortedCounts(
          collectNodes(a).map(({ node }) => node.label),
        );
        const errorsBefore = sortedCounts(errors(a).map((d) => d.code));
        for (let iter = 0; iter < N_GROUPS; iter++) {
          const list = pickList();
          const group = list.filter(() => rand() < 0.4);
          for (const n of list) {
            if (group.length >= 2) break;
            if (!group.includes(n)) group.push(n);
          }
          const doMove = rand() < 0.5;
          let what = `delete ${group.map((n) => `${n.kind}@${n.span.start}`).join(",")}`;
          let result;
          try {
            if (doMove) {
              const rest = lists.flat().filter((n) => !group.includes(n));
              if (rest.length === 0) continue;
              const anchor = rest[Math.floor(rand() * rest.length)];
              const to: InsertTarget =
                rand() < 0.5 ? { after: anchor } : { before: anchor };
              what = `move ${group.map((n) => `${n.kind}@${n.span.start}`).join(",")} ${"after" in to ? "after" : "before"} ${anchor.kind}@${anchor.span.start}`;
              result = computeEdit(
                a,
                { kind: "moveNodes", nodes: group, to },
                lang,
              );
            } else {
              result = computeEdit(
                a,
                { kind: "removeNodes", nodes: group },
                lang,
              );
            }
          } catch (e) {
            if (e instanceof PatchError) continue; // a shared line, an unclosed target
            throw new Error(
              `(${file.name} iter ${iter}, ${what}) computeEdit threw: ${String(e)}`,
            );
          }
          const label = `${file.name} iter ${iter} (${what})`;
          // Monaco applies every edit at once from original offsets. Same
          // answer as splicing them highest first, and no two overlap.
          const edits = editsOf(result).sort((x, y) => x.start - y.start);
          for (let i = 1; i < edits.length; i++)
            expect(
              edits[i].start,
              `${label}: edits overlap`,
            ).toBeGreaterThanOrEqual(edits[i - 1].end);
          let simultaneous = "";
          let at = 0;
          for (const e of edits) {
            simultaneous += original.slice(at, e.start) + e.newText;
            at = e.end;
          }
          simultaneous += original.slice(at);
          const patched = applyEditResult(original, result);
          expect(patched, `${label}: application order`).toBe(simultaneous);
          const b = parse(patched);
          const problems = checkProperties(b);
          if (problems.length > 0)
            throw new Error(
              `(${label}) ${doMove ? "move" : "delete"}\n${problems.slice(0, 6).join("\n")}`,
            );
          expect(
            sortedCounts(errors(b).map((d) => d.code)),
            `${label}: errors`,
          ).toBe(errorsBefore);
          if (doMove) {
            expect(
              sortedCounts(
                b.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
              ),
              `${label}: words`,
            ).toBe(wordsBefore);
            expect(
              sortedCounts(collectNodes(b).map(({ node }) => node.label)),
              `${label}: node labels`,
            ).toBe(labelsBefore);
            // Every moved card starts where the result says, first line intact.
            const nodes = [...group].sort(
              (x, y) => x.span.start - y.span.start,
            );
            result.selection!.forEach((p, k) => {
              const text = original.slice(
                nodes[k].span.start,
                nodes[k].span.end,
              );
              const firstLine = text.split(/\r?\n/)[0].slice(0, 12);
              expect(
                patched.slice(p, p + firstLine.length),
                `${label}: selection ${k}`,
              ).toBe(firstLine);
            });
          } else {
            // Exactly the group's own words are gone.
            const removed = new Set<number>();
            for (const n of group)
              for (let t = n.firstToken; t <= n.lastToken; t++) removed.add(t);
            const kept = a.tokens.filter(
              (t, i) => !t.isTrivia && !removed.has(i),
            );
            expect(
              sortedCounts(
                b.tokens.filter((t) => !t.isTrivia).map((t) => t.text),
              ),
              `${label}: words left`,
            ).toBe(sortedCounts(kept.map((t) => t.text)));
          }
        }
      },
    );
  }
});
