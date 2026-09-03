// tutorial-design.md Sec.8, the vocabulary tutorial steps are written
// against. Steps must never hand-roll AST walks; every completion predicate
// goes through one of these.
//
// `CommandNode.name`/`AttributeNode.name` are TOKEN INDICES, not strings,
// resolved through `parse.tokens[node.name].text` (see
// src/breakdown/cards/AttributeRow.tsx:58). The lexer does not fold case, so
// every comparison here is case-insensitive.

import type { AttributeNode, CommandNode, Item, ParseResult } from "../parser/types";
import { renderArg } from "../breakdown/renderValue";

const OBJECTS_SECTION = "OBJECTS_GENERATION";
const CREATE_OBJECT = "create_object";

function tokenText(parse: ParseResult, tokenIndex: number): string {
  return parse.tokens[tokenIndex]?.text ?? "";
}

/**
 * Flattens one `Item[]` list, descending into `IfNode.branches[].items`,
 * `RandomNode.branches[].items` (and its preamble) and `OrphanBlockNode`,
 * a user who wraps their first `create_object` in an `if` has still done
 * the step.
 */
function collectItems(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    out.push(item);
    switch (item.kind) {
      case "command":
        if (item.block) out.push(...collectItems(item.block.items));
        break;
      case "if":
        for (const branch of item.branches) out.push(...collectItems(branch.items));
        break;
      case "random":
        out.push(...collectItems(item.preamble));
        for (const branch of item.branches) out.push(...collectItems(branch.items));
        break;
      case "orphanBlock":
        out.push(...collectItems(item.block.items));
        break;
      case "attribute":
      case "directive":
      case "raw":
        break;
    }
  }
  return out;
}

/**
 * Every item in every section named `section`, aggregated across duplicate
 * sections of the same name, `buildSectionTabs` already treats those as one
 * tab, so this must agree with it.
 */
function sectionItems(parse: ParseResult, section: string): Item[] {
  const target = section.toLowerCase();
  const out: Item[] = [];
  for (const node of parse.script.sections) {
    if (node.name.toLowerCase() === target) out.push(...collectItems(node.items));
  }
  return out;
}

function commandsNamed(parse: ParseResult, section: string, command: string): CommandNode[] {
  const target = command.toLowerCase();
  const out: CommandNode[] = [];
  for (const item of sectionItems(parse, section)) {
    if (item.kind === "command" && tokenText(parse, item.name).toLowerCase() === target) {
      out.push(item);
    }
  }
  return out;
}

/** A command's own attributes, including ones nested inside a conditional within its block. */
function attributesOf(cmd: CommandNode): AttributeNode[] {
  if (!cmd.block) return [];
  const out: AttributeNode[] = [];
  for (const item of collectItems(cmd.block.items)) {
    if (item.kind === "attribute") out.push(item);
  }
  return out;
}

function argTexts(parse: ParseResult, node: CommandNode | AttributeNode): string[] {
  return node.args.map((arg) => renderArg(arg, parse.tokens));
}

/** True when `section` contains a command called `command` (any nesting depth). */
export function hasCommand(parse: ParseResult | null, section: string, command: string): boolean {
  if (!parse) return false;
  return commandsNamed(parse, section, command).length > 0;
}

/** As above, but also requires the command's block to contain `attribute`. */
export function hasCommandWithAttribute(parse: ParseResult | null, section: string, command: string, attribute: string): boolean {
  if (!parse) return false;
  const target = attribute.toLowerCase();
  return commandsNamed(parse, section, command).some((cmd) =>
    attributesOf(cmd).some((attr) => tokenText(parse, attr.name).toLowerCase() === target),
  );
}

/** As above, plus a predicate over the attribute's argument texts. */
export function hasCommandWithAttributeWhere(
  parse: ParseResult | null,
  section: string,
  command: string,
  attribute: string,
  test: (args: string[]) => boolean,
): boolean {
  if (!parse) return false;
  const target = attribute.toLowerCase();
  return commandsNamed(parse, section, command).some((cmd) =>
    attributesOf(cmd).some(
      (attr) => tokenText(parse, attr.name).toLowerCase() === target && test(argTexts(parse, attr)),
    ),
  );
}

/**
 * As `hasCommand`, plus a predicate over the COMMAND's own argument texts
 * (its positional args, e.g. `create_elevation`'s height or a standalone
 * command like `max_number_of_cliffs`'s count, not a nested attribute,
 * see `hasCommandWithAttributeWhere` for that). Every command argument gets
 * a placeholder value the instant the command is created (computeEdit's
 * `renderCommand` always renders with `values: undefined`, so
 * `placeholderFor` fills in `default ?? min ?? 0`), a presence-only
 * `hasCommand` check is satisfied by that placeholder before the user has
 * typed the real value, so a step whose body names a specific number needs
 * this instead.
 */
export function hasCommandWhere(
  parse: ParseResult | null,
  section: string,
  command: string,
  test: (args: string[]) => boolean,
): boolean {
  if (!parse) return false;
  return commandsNamed(parse, section, command).some((cmd) => test(argTexts(parse, cmd)));
}

/** How many commands named `command` live in `section`. */
export function countCommand(parse: ParseResult | null, section: string, command: string): number {
  if (!parse) return 0;
  return commandsNamed(parse, section, command).length;
}

/** True when any `create_object` in OBJECTS_GENERATION names `objectConstant`. */
export function hasObject(parse: ParseResult | null, objectConstant: string): boolean {
  if (!parse) return false;
  const target = objectConstant.toLowerCase();
  return commandsNamed(parse, OBJECTS_SECTION, CREATE_OBJECT).some(
    (cmd) => cmd.args.length > 0 && renderArg(cmd.args[0], parse.tokens).toLowerCase() === target,
  );
}

/** hasObject, narrowed to placements whose block carries `attribute`. */
export function hasObjectWith(parse: ParseResult | null, objectConstant: string, attribute: string): boolean {
  if (!parse) return false;
  const target = objectConstant.toLowerCase();
  const attrTarget = attribute.toLowerCase();
  return commandsNamed(parse, OBJECTS_SECTION, CREATE_OBJECT).some(
    (cmd) =>
      cmd.args.length > 0 &&
      renderArg(cmd.args[0], parse.tokens).toLowerCase() === target &&
      attributesOf(cmd).some((attr) => tokenText(parse, attr.name).toLowerCase() === attrTarget),
  );
}

/**
 * `hasObjectWith`, plus a predicate over `attribute`'s own argument texts,
 * same reasoning as `hasCommandWithAttributeWhere`: an attribute's argument
 * gets a placeholder value the instant it's added, so a step whose body
 * names a specific number (e.g. `place_on_specific_land_id 10`) needs this
 * rather than presence-only `hasObjectWith`.
 */
export function hasObjectWithAttributeWhere(
  parse: ParseResult | null,
  objectConstant: string,
  attribute: string,
  test: (args: string[]) => boolean,
): boolean {
  if (!parse) return false;
  const target = objectConstant.toLowerCase();
  const attrTarget = attribute.toLowerCase();
  return commandsNamed(parse, OBJECTS_SECTION, CREATE_OBJECT).some(
    (cmd) =>
      cmd.args.length > 0 &&
      renderArg(cmd.args[0], parse.tokens).toLowerCase() === target &&
      attributesOf(cmd).some(
        (attr) => tokenText(parse, attr.name).toLowerCase() === attrTarget && test(argTexts(parse, attr)),
      ),
  );
}

/**
 * True when the script has no sections and no preamble items, comments are
 * lexer trivia, never represented as `Item`s, so an empty script's preamble
 * is always length 0 regardless of how many comments it carries.
 */
export function isEmptyScript(parse: ParseResult | null): boolean {
  if (!parse) return false;
  return parse.script.sections.length === 0 && parse.script.preamble.length === 0;
}
