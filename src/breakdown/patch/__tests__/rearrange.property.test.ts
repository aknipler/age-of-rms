// 2026-09-18, the Sec.4.8 gate's companion for moveNode (breakdown-design
// Sec.4.12). astDiff.ts compares one edit's before and after by translating
// offsets across a single delta, which a move does not have, so a move is
// checked against what a move IS instead. Nothing is lost or gained, only
// rearranged. For seeded random moves over every corpus map, the result
// re-parses well formed with no new errors, holds exactly the same
// non-trivia tokens and the same comments as before (as multisets, order
// aside), the same count of every node label, and the two halves applied
// as Monaco applies them (simultaneously, from original offsets) agree with
// applying them one after the other. Per-file seeding as in
// patch.property.test.ts, so results are identical with or without the
// gitignored maps present.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type { Item, ParseResult, Span } from "../../../parser/types";
import {
  checkProperties,
  collectNodes,
  loadLanguage,
  REPO_ROOT,
} from "../../../parser/__tests__/testUtils";
import { applyEditResult, computeEdit, editsOf } from "../computeEdit";
import {
  PatchError,
  type BranchRef,
  type DraggableCard,
  type InsertAnchor,
  type InsertTarget,
  type RearrangeableNode,
} from "../intents";
import { extractComments } from "../../comments";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const N_MOVES = 12;

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

// A different salt from patch.property.test.ts's, so the two gates do not
// walk the same random sequence over the same pools.
function fileSeed(name: string): number {
  let h = 0x5e0e_2026;
  for (let i = 0; i < name.length; i++)
    h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
  return h;
}

interface Pools {
  movables: RearrangeableNode[];
  branches: BranchRef[];
  /**
   * Every comment that is NOT itself contained within some item's own span
   * (DraggableCard's non-Item half). A comment strictly INSIDE an item's
   * span (e.g. between a command's args and its own attached block, still
   * trivia there, invisible to the AST, comments.ts) sits somewhere the
   * parser expects an immediate next non-trivia token to CONTINUE building
   * that same node (Sec.4.6's block-attach rule reads the next non-trivia
   * token exactly the same way): inserting anything right after such a
   * comment severs that adjacency and silently turns the intended block
   * into an orphan one, found the hard way when this pool first went in
   * unfiltered (2026-09-18-ish follow-up, comment drag). The product itself
   * never offers such a comment as a drop anchor at all: CommentCard only
   * ever mounts for a comment BlockList's commentsBetweenItems places in a
   * GAP between two already-complete items, which by construction excludes
   * every comment this filter also excludes. Kept as a simple containment
   * test rather than replaying BlockList's own per-container recursion,
   * since containment is the exact property that makes the anchor safe,
   * not which component happens to render it today.
   */
  comments: DraggableCard[];
}

function harvest(r: ParseResult): Pools {
  const pools: Pools = { movables: [], branches: [], comments: [] };
  const itemSpans: Span[] = [];
  const visit = (items: Item[]) => {
    for (const item of items) {
      itemSpans.push(item.span);
      if (
        item.kind === "directive" ||
        (item.kind === "command" &&
          (item.block === undefined || item.block.close !== undefined)) ||
        (item.kind === "if" && item.endif !== undefined) ||
        (item.kind === "random" && item.end !== undefined)
      )
        pools.movables.push(item);
      if (item.kind === "command" && item.block) visit(item.block.items);
      if (item.kind === "if") {
        if (item.endif !== undefined)
          item.branches.forEach((_, index) =>
            pools.branches.push({ parent: item, index }),
          );
        for (const b of item.branches) visit(b.items);
      }
      if (item.kind === "random") {
        if (item.end !== undefined)
          item.branches.forEach((_, index) =>
            pools.branches.push({ parent: item, index }),
          );
        visit(item.preamble);
        for (const b of item.branches) visit(b.items);
      }
      if (item.kind === "orphanBlock") visit(item.block.items);
    }
  };
  visit(r.script.preamble);
  for (const s of r.script.sections) visit(s.items);
  for (const span of extractComments(r.tokens)) {
    const insideSomeItem = itemSpans.some(
      (s) => span.start >= s.start && span.end <= s.end,
    );
    if (!insideSomeItem) pools.comments.push({ kind: "comment", span });
  }
  return pools;
}

function sortedCounts(values: string[]): string {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, n]) => `${n}×${k}`)
    .join("\n");
}

function invariants(r: ParseResult) {
  return {
    words: sortedCounts(r.tokens.filter((t) => !t.isTrivia).map((t) => t.text)),
    trivia: sortedCounts(r.tokens.filter((t) => t.isTrivia).map((t) => t.text)),
    labels: sortedCounts(collectNodes(r).map(({ node }) => node.label)),
    errors: sortedCounts(
      r.diagnostics.filter((d) => d.severity === "error").map((d) => d.code),
    ),
  };
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
].sort((a, b) => a.name.localeCompare(b.name));

describe("moveNode gate: a move rearranges and loses nothing", () => {
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
        const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
        const a = parseRms(original, langData);
        const pools = harvest(a);
        // Comments join the pool a move can pick its node AND its anchor
        // from (DraggableCard/InsertAnchor, intents.ts): a comment can drag
        // itself, and any card can drop beside one. The anchor pool is the
        // full drag pool, unfiltered by physical line layout: a card whose
        // own line starts with something else (two directives tab-glued on
        // one physical line, a trailing same-line comment) is exactly the
        // hazard computeEdit.ts's insertAfterItem/insertBeforeItem now
        // refuse rather than splice into — a PatchError, caught below and
        // counted as skipped, same as an unclosed container or a move into
        // itself.
        const dragPool: DraggableCard[] = [
          ...pools.movables,
          ...pools.comments,
        ];
        const anchorPool: InsertAnchor[] = dragPool;
        const before = invariants(a);
        let skipped = 0;
        for (let iter = 0; iter < N_MOVES; iter++) {
          if (dragPool.length < 2 || anchorPool.length === 0) {
            skipped++;
            continue;
          }
          const node = pick(dragPool);
          const roll = rand();
          const to: InsertTarget =
            roll < 0.4
              ? { after: pick(anchorPool) }
              : roll < 0.8 || pools.branches.length === 0
                ? { before: pick(anchorPool) }
                : { in: "branch", branch: pick(pools.branches) };
          let result;
          try {
            result = computeEdit(a, { kind: "moveNode", node, to }, lang);
          } catch (e) {
            if (e instanceof PatchError) {
              skipped++; // into itself, after itself, unclosed target
              continue;
            }
            throw new Error(
              `(${file.name}, iter ${iter}) computeEdit threw: ${String(e)}`,
            );
          }
          const [hi, lo] = editsOf(result);
          expect(
            lo.end,
            `${file.name} iter ${iter}: halves overlap`,
          ).toBeLessThanOrEqual(hi.start);
          const simultaneous =
            original.slice(0, lo.start) +
            lo.newText +
            original.slice(lo.end, hi.start) +
            hi.newText +
            original.slice(hi.end);
          const patched = applyEditResult(original, result);
          expect(patched, `${file.name} iter ${iter}: application order`).toBe(
            simultaneous,
          );
          const b = parseRms(patched, langData);
          const problems = checkProperties(b);
          if (problems.length > 0)
            throw new Error(
              `(${file.name}, iter ${iter}) moved ${node.kind}@${node.span.start} → ${JSON.stringify(Object.keys(to))}\n${problems.slice(0, 6).join("\n")}`,
            );
          const after = invariants(b);
          const label = `${file.name} iter ${iter}: moved ${node.kind}@${node.span.start}`;
          expect(after.words, `${label}, words`).toBe(before.words);
          expect(after.trivia, `${label}, comments`).toBe(before.trivia);
          expect(after.labels, `${label}, node labels`).toBe(before.labels);
          expect(after.errors, `${label}, error codes`).toBe(before.errors);
          // The caret is the moved card's own new start. Capped to the
          // node's own FIRST LINE (an empty "/* */" comment is 5 chars, and
          // relocateSlice reindents a multi-line comment's continuation
          // lines to the destination, formatStyle.ts, so bytes past the
          // first line break are not expected to survive a move unchanged).
          const nodeText = original.slice(node.span.start, node.span.end);
          const firstLineBreak = nodeText.search(/\r?\n/);
          const window = Math.min(
            8,
            firstLineBreak === -1 ? nodeText.length : firstLineBreak,
          );
          expect(
            patched.slice(result.caret, result.caret + window),
            `${label}, caret`,
          ).toBe(original.slice(node.span.start, node.span.start + window));
        }
        if (dragPool.length >= 2 && anchorPool.length > 0)
          expect(skipped).toBeLessThan(N_MOVES);
      },
    );
  }
});
