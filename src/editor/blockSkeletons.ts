// The skeleton a block template falls back on when the script has no block
// of that command yet (docs/name-lookup-design.md Sec.13.4.1, Q6). Built
// from other maps by `npm run generate:skeletons` into
// reference/data/block-skeletons.json, which the app ships. The app never
// reads a map file for this.
//
// Pure and Monaco-free, so the generator, the tests and the provider share
// one copy of the rule.

import type {
  BlockNode,
  CommandNode,
  Item,
  ParseResult,
  Token,
} from "../parser/types";
import { argTokens } from "./linePrediction";

export interface SkeletonAttribute {
  name: string;
  /** One starting value per argument. Empty for an attribute that takes none. */
  values: string[];
}

export interface SkeletonEntry {
  /** A command name, or a command with its arguments, such as `create_object GOLD`. */
  key: string;
  /** How many maps have a block under this key. At least `MIN_MAPS`. */
  maps: number;
  attributes: SkeletonAttribute[];
}

export interface BlockSkeletonData {
  /** How many maps the generator read. */
  maps: number;
  skeletons: SkeletonEntry[];
}

/** A key needs this many maps behind it, so no single copied template decides one. */
export const MIN_MAPS = 3;
/** An attribute is kept when its votes reach this share of the maps that have the key. */
export const KEEP_SHARE = 0.5;

interface MapAttributeTally {
  /** Blocks under the key that use the attribute. */
  uses: number;
  /** Sum of the attribute's position in each such block, as a fraction of the block's length. */
  positionSum: number;
  /** How often each set of values was written, keyed by the values as JSON. */
  values: Map<string, number>;
}

interface MapKeyTally {
  blocks: number;
  attributes: Map<string, MapAttributeTally>;
}

/**
 * The skeletons for a set of parsed maps, by the rule in Sec.13.4.1.
 *
 * WHY EACH MAP VOTES ONCE. A count is not a conclusion until its uses are
 * independent (CLAUDE.md). Arena.rms alone holds 3,967 blocks and shipped
 * maps repeat copied templates, so counting blocks would let one map decide
 * every key it uses. A map's vote for an attribute is the share of its own
 * blocks under the key that use it, a number from 0 to 1, so a map that
 * writes the attribute in half its blocks gives half a vote.
 */
export function buildSkeletons(
  maps: readonly ParseResult[],
): BlockSkeletonData {
  const perKey = new Map<string, MapKeyTally[]>();
  for (const parse of maps) {
    const tallies = new Map<string, MapKeyTally>();
    for (const cmd of closedBlockCommands(parse)) {
      const name = cmd.def!.name;
      const args = cmd.args.map((a) =>
        argTokens(parse.tokens, a.firstToken, a.lastToken).join(" "),
      );
      const keys =
        args.length === 0 ? [name] : [name, `${name} ${args.join(" ")}`];
      const attrs = directAttributes(parse.tokens, cmd.block!);
      for (const key of keys) {
        let t = tallies.get(key);
        if (!t) tallies.set(key, (t = { blocks: 0, attributes: new Map() }));
        t.blocks++;
        attrs.forEach((a, i) => {
          let at = t.attributes.get(a.name);
          if (!at)
            t.attributes.set(
              a.name,
              (at = { uses: 0, positionSum: 0, values: new Map() }),
            );
          at.uses++;
          at.positionSum += (i + 0.5) / attrs.length;
          const v = JSON.stringify(a.values);
          at.values.set(v, (at.values.get(v) ?? 0) + 1);
        });
      }
    }
    for (const [key, t] of tallies) {
      let list = perKey.get(key);
      if (!list) perKey.set(key, (list = []));
      list.push(t);
    }
  }

  const skeletons: SkeletonEntry[] = [];
  for (const [key, tallies] of perKey) {
    if (tallies.length < MIN_MAPS) continue;
    const names = new Set<string>();
    for (const t of tallies) for (const n of t.attributes.keys()) names.add(n);
    const kept: { attr: SkeletonAttribute; position: number }[] = [];
    for (const name of names) {
      let votes = 0;
      let positions = 0;
      let using = 0;
      const valueVotes = new Map<string, number>();
      for (const t of tallies) {
        const at = t.attributes.get(name);
        if (!at) continue;
        votes += at.uses / t.blocks;
        positions += at.positionSum / at.uses;
        using++;
        // Each map's blocks share one vote between their values.
        for (const [v, n] of at.values)
          valueVotes.set(v, (valueVotes.get(v) ?? 0) + n / at.uses);
      }
      if (votes < KEEP_SHARE * tallies.length) continue;
      kept.push({
        attr: { name, values: JSON.parse(topValue(valueVotes)) as string[] },
        position: positions / using,
      });
    }
    if (kept.length === 0) continue;
    kept.sort(
      (a, b) =>
        a.position - b.position || a.attr.name.localeCompare(b.attr.name),
    );
    skeletons.push({
      key,
      maps: tallies.length,
      attributes: kept.map((k) => k.attr),
    });
  }
  skeletons.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { maps: maps.length, skeletons };
}

/**
 * The skeleton for a typed command line. The entry for the command with its
 * arguments when there is one, else the command name's entry.
 */
export function findSkeleton(
  data: BlockSkeletonData,
  command: string,
  args: readonly string[],
): SkeletonEntry | undefined {
  const byKey = indexOf(data);
  return (
    (args.length > 0 ? byKey.get(`${command} ${args.join(" ")}`) : undefined) ??
    byKey.get(command)
  );
}

const indexes = new WeakMap<BlockSkeletonData, Map<string, SkeletonEntry>>();
function indexOf(data: BlockSkeletonData): Map<string, SkeletonEntry> {
  let m = indexes.get(data);
  if (!m)
    indexes.set(data, (m = new Map(data.skeletons.map((s) => [s.key, s]))));
  return m;
}

/**
 * Every closed block of a known block command, at any depth, in source
 * order. Cached per parse, since the block template asks on every
 * keystroke and a parse never changes once made. A WeakMap rather than a
 * one-entry cache because the replay gate asks about several parses in
 * turn, and a WeakMap entry goes away with its parse, so nothing leaks.
 */
export function closedBlockCommands(
  parse: ParseResult,
): readonly CommandNode[] {
  let cached = blockCache.get(parse);
  if (!cached) blockCache.set(parse, (cached = findClosedBlocks(parse)));
  return cached;
}

const blockCache = new WeakMap<ParseResult, readonly CommandNode[]>();

function findClosedBlocks(parse: ParseResult): CommandNode[] {
  const out: CommandNode[] = [];
  const walk = (items: readonly Item[]) => {
    for (const item of items) {
      if (item.kind === "command") {
        if (item.block?.close !== undefined && item.def?.kind === "block")
          out.push(item);
      } else if (item.kind === "if") {
        for (const b of item.branches) walk(b.items);
      } else if (item.kind === "random") {
        walk(item.preamble);
        for (const b of item.branches) walk(b.items);
      }
    }
  };
  walk(parse.script.preamble);
  for (const s of parse.script.sections) walk(s.items);
  return out;
}

/**
 * A block's own attributes, the first use of each, in order. Attributes in
 * an `if` or `start_random` inside the block are left out, so a skeleton
 * never holds a branch. So are names language.json does not know, which
 * `validate:reference` would reject.
 */
function directAttributes(
  tokens: readonly Token[],
  block: BlockNode,
): SkeletonAttribute[] {
  const seen = new Set<string>();
  const out: SkeletonAttribute[] = [];
  for (const item of block.items) {
    if (item.kind !== "attribute" || !item.def) continue;
    const name = item.def.name;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      values: item.args.map((a) =>
        argTokens(tokens, a.firstToken, a.lastToken).join(" "),
      ),
    });
  }
  return out;
}

/** The value with the most votes. Ties go to the first in sort order, so the file is the same on every run. */
function topValue(votes: ReadonlyMap<string, number>): string {
  let best = "";
  let bestVotes = -1;
  for (const [v, n] of [...votes].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  ))
    if (n > bestVotes + 1e-9) {
      best = v;
      bestVotes = n;
    }
  return best;
}
