/**
 * `def` reconstruction from the wire form (tools-api-design.md Sec.4.2's
 * recovery recipe, Sec.9 item 11). An external tool declaring `read-ast` gets
 * `node.def` typed `unknown` (parser-design Sec.4's `NoDefs`) and is expected
 * to recover it itself from `tokens`, `symbols` and `referenceData.language`
 * alone. This is that recovery, built so the recipe is an executable check
 * rather than prose two documents state and nothing runs.
 *
 * Every rule below is copied from `src/parser/parser.ts`, not re-derived.
 * Re-deriving it is exactly how the recipe went silently wrong for two days
 * (Sec.9 item 11's own "why this earns its place" paragraph):
 *
 *  - A `CommandNode`'s def is ALWAYS `commandsByName.get(name) ??
 *    aliasedCommand(name)`, regardless of block context. `parseNamedOrRun`
 *    (parser.ts) computes `asCommand` this way unconditionally and BOTH the
 *    context-native command path and the RMS0207 "known name, wrong context"
 *    path parse the node as a command using this exact value, so the
 *    resolution rule needs no `inBlock` branch at all.
 *  - An `AttributeNode`'s def is ALWAYS `attributesByName.get(name)`. Sec.2.1
 *    aliasing is command-only; there is no attribute equivalent.
 *  - A `DirectiveNode`'s def is `directivesByName.get(hashTokenText)`.
 *  - An `ArgNode`'s def is its parent's `arguments[i]`, bounded at the last
 *    index. `language.json` has no `variadic: true` entries today, so this
 *    bound is exact for everything the corpus can produce; a variadic
 *    argument whose repeat count varies mid-list is NOT reconstructable from
 *    the wire alone (the count is a parse-time fact, not a data fact), and
 *    this module does not pretend otherwise.
 *  - `percent_chance`'s `chance` argument is a DELIBERATE, documented
 *    exception (parser.ts's own "Sec.5.1 pinned exception" comment): its
 *    `ArgumentDef` is a hardcoded literal, not a `language.json` row, so it is
 *    NOT recoverable from `referenceData.language` at all. This module leaves
 *    it `undefined` rather than fabricate a match; callers that need it must
 *    hardcode the same literal, which is precisely the kind of hidden
 *    coupling Sec.9 item 11 exists to make visible instead of silent.
 */

import type { LanguageIndex } from "../parser/language";
import type { AttributeDef, ArgumentDef, CommandDef, DirectiveDef } from "../parser/language";
import type { ArgNode, Item, NoDefs, ScriptNode, SymbolInfo, Token } from "../parser/types";

/**
 * Mirrors `Parser.aliasedCommand` exactly: walk `symbols` IN SOURCE ORDER and
 * stop at the FIRST one matching `name`, whatever its kind. A `Map<name,
 * symbol>` built by iterating and overwriting would keep the LAST symbol
 * instead and give the wrong answer on fixture (c) below (`#define L` then
 * `#const L 32`). A real `#define` earlier in the file shadows a later
 * `#const` of the same name, because the engine's own name table is
 * first-definition-wins.
 */
export function reconstructAliasedCommand(
  name: string,
  symbols: readonly SymbolInfo[],
  tokens: readonly Token[],
  language: LanguageIndex,
): CommandDef | undefined {
  if (language.commandsByTokenId.size === 0) return undefined;
  for (const symbol of symbols) {
    if (symbol.name !== name) continue;
    if (symbol.directiveKind !== "const" || symbol.valueToken === undefined) return undefined;
    const text = tokens[symbol.valueToken]?.text ?? "";
    if (!/^\d+$/.test(text)) return undefined;
    return language.commandsByTokenId.get(Number(text));
  }
  return undefined;
}

function reconstructCommandDef(nameTokenText: string, symbols: readonly SymbolInfo[], tokens: readonly Token[], language: LanguageIndex): CommandDef | undefined {
  return language.commandsByName.get(nameTokenText) ?? reconstructAliasedCommand(nameTokenText, symbols, tokens, language);
}

function argDefAt(parentArgs: readonly ArgumentDef[] | undefined, index: number): ArgumentDef | undefined {
  if (!parentArgs || parentArgs.length === 0) return undefined;
  return parentArgs[Math.min(index, parentArgs.length - 1)];
}

/** One reconstructed def, in the depth-first order `collectDefs` below walks any tree of this shape. */
export interface ReconstructedDef {
  path: string;
  def: CommandDef | AttributeDef | DirectiveDef | ArgumentDef | undefined;
}

/**
 * Reconstructs every def in `script`, in the SAME depth-first order
 * `collectDefs` reads them off a real in-process tree, so a test can zip the
 * two lists and compare index-for-index without caring that the wire tree's
 * numeric slots carry `WireNumber` where the real tree carries `number`.
 *
 * `percent_chance`'s `chance` argument is deliberately excluded (see this
 * module's header) rather than pushed as a mismatched or fabricated entry.
 */
export function reconstructScriptDefs(
  script: ScriptNode<unknown, NoDefs>,
  tokens: readonly Token[],
  symbols: readonly SymbolInfo[],
  language: LanguageIndex,
): ReconstructedDef[] {
  const out: ReconstructedDef[] = [];

  function nameText(tokenIdx: number): string {
    return tokens[tokenIdx]?.text ?? "";
  }

  function visitArgs(args: readonly ArgNode<unknown, NoDefs>[], parentArgs: readonly ArgumentDef[] | undefined, path: string): void {
    args.forEach((_, i) => out.push({ path: `${path}.args[${i}]`, def: argDefAt(parentArgs, i) }));
  }

  function visitItems(items: readonly Item<unknown, NoDefs>[], path: string): void {
    items.forEach((item, i) => visitItem(item, `${path}[${i}]`));
  }

  function visitItem(item: Item<unknown, NoDefs>, path: string): void {
    switch (item.kind) {
      case "command": {
        const def = reconstructCommandDef(nameText(item.name), symbols, tokens, language);
        out.push({ path, def });
        visitArgs(item.args, def?.arguments, path);
        if (item.block) visitItems(item.block.items, `${path}.block`);
        return;
      }
      case "attribute": {
        const def = language.attributesByName.get(nameText(item.name));
        out.push({ path, def });
        visitArgs(item.args, def?.arguments, path);
        return;
      }
      case "directive": {
        const def = language.directivesByName.get(nameText(item.hash));
        out.push({ path, def });
        visitArgs(item.args, def?.arguments, path);
        return;
      }
      case "if":
        item.branches.forEach((b, bi) => visitItems(b.items, `${path}.branch[${bi}]`));
        return;
      case "random":
        visitItems(item.preamble, `${path}.preamble`);
        item.branches.forEach((b, bi) => visitItems(b.items, `${path}.branch[${bi}]`));
        return;
      case "orphanBlock":
        visitItems(item.block.items, `${path}.orphanBlock`);
        return;
      case "raw":
        return;
    }
  }

  visitItems(script.preamble, "preamble");
  script.sections.forEach((section, si) => visitItems(section.items, `section[${si}]`));

  return out;
}

/**
 * Reads defs already attached to a REAL in-process tree, in the identical
 * order and with the identical `percent_chance` exclusion as
 * `reconstructScriptDefs`, so the two outputs are directly comparable.
 */
export function collectScriptDefs(script: ScriptNode): ReconstructedDef[] {
  const out: ReconstructedDef[] = [];

  function visitArgs(args: readonly ArgNode[], path: string): void {
    args.forEach((arg, i) => out.push({ path: `${path}.args[${i}]`, def: arg.def }));
  }

  function visitItems(items: readonly Item[], path: string): void {
    items.forEach((item, i) => visitItem(item, `${path}[${i}]`));
  }

  function visitItem(item: Item, path: string): void {
    switch (item.kind) {
      case "command":
        out.push({ path, def: item.def });
        visitArgs(item.args, path);
        if (item.block) visitItems(item.block.items, `${path}.block`);
        return;
      case "attribute":
        out.push({ path, def: item.def });
        visitArgs(item.args, path);
        return;
      case "directive":
        out.push({ path, def: item.def });
        visitArgs(item.args, path);
        return;
      case "if":
        item.branches.forEach((b, bi) => visitItems(b.items, `${path}.branch[${bi}]`));
        return;
      case "random":
        visitItems(item.preamble, `${path}.preamble`);
        item.branches.forEach((b, bi) => visitItems(b.items, `${path}.branch[${bi}]`));
        return;
      case "orphanBlock":
        visitItems(item.block.items, `${path}.orphanBlock`);
        return;
      case "raw":
        return;
    }
  }

  visitItems(script.preamble, "preamble");
  script.sections.forEach((section, si) => visitItems(section.items, `section[${si}]`));

  return out;
}
