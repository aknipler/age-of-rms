/**
 * Shared AST-level scanning helpers for Sec.3's static checks
 * (consistency-checker-design.md Sec.3.0b, Sec.3.2 rule 1, Sec.3.3's producer
 * `#const` resolution). Every function here reads `ParseResult` directly,
 * NEVER `InstantiatedScript`, because the whole point is to be generous
 * about branches S0 did not take (Sec.3.0b: "a suppressing scan is allowed
 * to be over-generous").
 */

import type { Item, ParseResult, Span } from "../../../parser/types";
import { walkItems, type WalkContext } from "../../walkItems";

/**
 * Every numeric `#const NAME <decimal>` in the script, over the WHOLE AST,
 * `parse.symbols` already covers every branch regardless of selection (the
 * parser builds it independently of S0), so this needs no walk of its own.
 * `all` collects every distinct value a name takes across branches (Sec.3.2
 * rule 1: "collecting every value a name takes in any branch", a name
 * redefined to different numbers in mutually exclusive branches is real RMS,
 * and a suppressing scan must not silently pick one); `first` is the
 * lexical-order single value, for call sites (terrain resolution) that need
 * one `ReadonlyMap<string, number>`, matching `resolveTerrainId`'s own
 * first-definition-wins reading of the script's `#const` table.
 */
export interface AstConstMap {
  all: ReadonlyMap<string, ReadonlySet<number>>;
  first: ReadonlyMap<string, number>;
}

export function scanAstConsts(parse: ParseResult): AstConstMap {
  const all = new Map<string, Set<number>>();
  const first = new Map<string, number>();
  for (const symbol of parse.symbols) {
    if (symbol.directiveKind !== "const" || symbol.valueToken === undefined) continue;
    const text = parse.tokens[symbol.valueToken].text;
    const value = Number(text);
    if (!Number.isFinite(value)) continue; // an expression/name value, rule 1 does not evaluate those (rule 2's S0 union does, for taken branches)
    let set = all.get(symbol.name);
    if (!set) {
      set = new Set();
      all.set(symbol.name, set);
    }
    set.add(value);
    if (!first.has(symbol.name)) first.set(symbol.name, value);
  }
  return { all, first };
}

/**
 * Every `RawNode`'s own source text (Sec.3.0b's third construct, opaque by
 * construction, so a suppressing scan cannot descend into it and must
 * abstain instead). One entry per raw node; callers run their own
 * containment test (`text.includes("actor_area")`, etc.) per Sec.3.0b's
 * per-scan token rule.
 */
export function rawNodeTexts(parse: ParseResult): string[] {
  const out: string[] = [];
  walkItems(parse, (item) => {
    if (item.kind === "raw") out.push(parse.source.slice(item.span.start, item.span.end));
  });
  return out;
}

/** True when any raw node's own text contains `token`, Sec.3.0b's abstention test, never a population count. */
export function anyRawNodeContains(parse: ParseResult, token: string): boolean {
  return rawNodeTexts(parse).some((text) => text.includes(token));
}

/**
 * A producer/declaration occurrence found by an AST walk, carrying enough
 * context for a caller to decide inclusion per its own asymmetric rule
 * (Sec.3.0b: "if" is different in kind from "start_random").
 */
export interface AstOccurrence {
  item: Item;
  ctx: WalkContext;
}

/** Every item of a given predicate, over the whole AST, generous by construction (see `walkItems`'s own header). */
export function collectOccurrences(parse: ParseResult, predicate: (item: Item) => boolean): AstOccurrence[] {
  const out: AstOccurrence[] = [];
  walkItems(parse, (item, ctx) => {
    if (predicate(item)) out.push({ item, ctx });
  });
  return out;
}

/** `tokens[idx].text`, the same one-liner every stage file repeats. */
export function tokenText(parse: ParseResult, idx: number): string {
  return parse.tokens[idx].text;
}

/**
 * A command's identity the way `instantiate.ts`'s `resolveCommand` computes
 * it, `def?.name` first, falling back to the literal token only for a
 * command `language.json` does not know. AST-level defs already carry the
 * `#const`-alias resolution (BUG-013's fix), so this needs no separate alias
 * handling.
 */
export function astCommandName(parse: ParseResult, item: Extract<Item, { kind: "command" }>): string {
  return item.def?.name ?? tokenText(parse, item.name);
}

/** `tokens[node.name].text` for an attribute, attribute names are never aliased (Sec.4.3's own scoping: the alias path is commands only). */
export function astAttributeName(parse: ParseResult, item: Extract<Item, { kind: "attribute" }>): string {
  return tokenText(parse, item.name);
}

/**
 * Does `span` fall inside a `SimulationNote` with an `unsimulated:<span>`
 * key? That is S0's own record that it walked past this exact block without
 * simulating it (Sec.3.0b: "S0 already emits an `unsimulated:<span>` note
 * for every one of these blocks"), which is what lets a reference inside a
 * shared block be treated as "S0 reached it" without re-simulating branch
 * selection.
 */
export function wasReachedButUnsimulated(notes: readonly { key: string }[], span: Span): boolean {
  return notes.some((n) => n.key === `unsimulated:${span.start}-${span.end}`);
}
