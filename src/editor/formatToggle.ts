/**
 * The Code tab's "toggle command layout" hotkey: flip one command's block
 * between one-line and one-attribute-per-line, or every command touched by
 * a selection, each independently. The layout it lands on is the OPPOSITE
 * of whatever it already is, not a fixed target shape.
 *
 * Deliberately built on the Script Formatter's own engine
 * (`src/tools/builtin/formatter`) rather than a second AST-to-text writer:
 * that engine is the one place in this app allowed to re-lay-out code at all
 * (CLAUDE.md's "never re-print code" hard rule, and `breakdown-design.md:63`
 * names it the sanctioned exception), and it is already token-verified,
 * re-tokenises its own output and refuses to emit edits it cannot prove kept
 * every token. Reusing it here means this hotkey inherits that guarantee for
 * free instead of re-earning it.
 *
 * The trick that makes a single-instance toggle possible on a whole-document
 * engine: `FormatOptions.alwaysExpand`/`alwaysInline` are name-keyed (every
 * command called `create_object` in the document, not one occurrence of it),
 * so a plain `formatScript` call can't target ONE occurrence. Instead, run it
 * once per targeted node with that node's own name forced to the opposite of
 * its current shape. Every OTHER node sharing that name is either already
 * in its target shape (no-op) or is a different occurrence this call is not
 * for, and since every other option stays at its `"preserve"` default,
 * nothing about the rest of the document is asked to change. That leaves
 * exactly one node different between `parse.source` and the run's output,
 * found by trimming their common prefix and suffix (`trimmedEdit`) rather
 * than by filtering `formatScript`'s own edit list. `GapWriter` coalesces
 * an edit across any short unchanged run between two real changes, so one
 * node's edit can read as spanning into a sibling's untouched text even
 * though nothing there differs; diffing the two full strings sidesteps that
 * entirely and finds the tightest possible edit regardless of how the writer
 * represented it internally.
 */

import { lineOfOffset } from "../parser/lineIndex";
import type {
  CommandNode,
  IfNode,
  Item,
  OrphanBlockNode,
  ParseResult,
  RandomNode,
  Span,
} from "../parser/types";
import {
  DEFAULT_FORMAT_OPTIONS,
  formatScript,
  type SourceEdit,
} from "../tools/builtin/formatter/index";

export interface ToggleLayoutResult {
  edits: SourceEdit[];
  /** Commands whose layout actually flipped. */
  toggledCount: number;
  /**
   * Commands the selection touched but could not be flipped. A block with a
   * nested `if`/`start_random`/command can't safely go on one line (the
   * formatter's own `inline`/`compact` policies refuse to create that shape
   * too, for the same readability reason), and an unclosed block or one with
   * a multi-line comment inside it can't be proven safe to inline at all.
   * Reported so a caller COULD surface "3 of 5 toggled" rather than silently
   * doing less than asked; today's caller (the hotkey) doesn't.
   */
  skippedCount: number;
}

/** Every `CommandNode` with a block, at any depth, descending into `if`/`start_random` branches and shared blocks the same way the block's own contents would render, so a selection spanning a conditional's body still finds the commands inside it. */
function collectCommandNodes(items: readonly Item[], out: CommandNode[]): void {
  for (const item of items) {
    switch (item.kind) {
      case "command":
        if (item.block) out.push(item as CommandNode);
        if (item.block) collectCommandNodes(item.block.items, out);
        break;
      case "if": {
        const node = item as IfNode;
        for (const branch of node.branches)
          collectCommandNodes(branch.items, out);
        break;
      }
      case "random": {
        const node = item as RandomNode;
        collectCommandNodes(node.preamble, out);
        for (const branch of node.branches)
          collectCommandNodes(branch.items, out);
        break;
      }
      case "orphanBlock":
        collectCommandNodes((item as OrphanBlockNode).block.items, out);
        break;
      case "attribute":
      case "directive":
      case "raw":
        break;
    }
  }
}

function allCommandNodes(parse: ParseResult): CommandNode[] {
  const out: CommandNode[] = [];
  collectCommandNodes(parse.script.preamble, out);
  for (const section of parse.script.sections)
    collectCommandNodes(section.items, out);
  return out;
}

/** Half-open overlap for a real selection; point containment for a collapsed cursor (`range.start === range.end`), so clicking inside a command with no drag still resolves to it. */
function overlaps(span: Span, range: Span): boolean {
  if (range.start === range.end)
    return range.start >= span.start && range.start <= span.end;
  return span.start < range.end && span.end > range.start;
}

function contains(outer: Span, inner: Span): boolean {
  return outer.start <= inner.start && inner.end <= outer.end;
}

/**
 * The minimal edit that turns `original` into `formatted`, found by trimming
 * their common prefix and suffix, a two-pointer diff, not a general LCS,
 * which is exact here because exactly one region differs (see the file
 * header). `null` means the two strings are identical: the requested shape
 * change was not achievable (an unclosed block, or a multi-line comment
 * `canInline` refuses to disturb), not an error.
 */
function trimmedEdit(original: string, formatted: string): SourceEdit | null {
  if (original === formatted) return null;
  const maxCommon = Math.min(original.length, formatted.length);
  let prefix = 0;
  while (prefix < maxCommon && original[prefix] === formatted[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxCommon - prefix;
  while (
    suffix < maxSuffix &&
    original[original.length - 1 - suffix] ===
      formatted[formatted.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    start: prefix,
    end: original.length - suffix,
    newText: formatted.slice(prefix, formatted.length - suffix),
  };
}

/** Same restriction the formatter's own `inline`/`compact` policies apply: don't CREATE a one-liner out of a block holding a conditional or a nested command. Expanding has no such restriction, any block can always be spread out. */
function hasNonAttributeItems(node: CommandNode): boolean {
  return node.block!.items.some((item) => item.kind !== "attribute");
}

function isSourceInline(parse: ParseResult, node: CommandNode): boolean {
  return (
    lineOfOffset(parse.lineOffsets, parse.tokens[node.firstToken].start) ===
    lineOfOffset(parse.lineOffsets, parse.tokens[node.lastToken].start)
  );
}

function resolvedName(parse: ParseResult, node: CommandNode): string {
  return node.def?.name ?? parse.tokens[node.name].text;
}

/**
 * The nodes a selection actually targets: every command whose span overlaps
 * `range`, minus any that sits INSIDE another matched command's own span.
 * Real RMS scripts don't nest a full command inside another command's block,
 * but the parser's own types allow it, and toggling both an outer block and
 * something inside it in the same pass could ask for two edits over the same
 * text (the outer's inline/expand decision governs everything inside it).
 * Keeping only the outermost match is what keeps every returned edit's span
 * disjoint from every other's, which is what makes applying them all in one
 * `pushEditOperations` call safe.
 */
function targetedNodes(parse: ParseResult, range: Span): CommandNode[] {
  const candidates = allCommandNodes(parse).filter((node) =>
    overlaps(node.span, range),
  );
  return candidates.filter(
    (node) =>
      !candidates.some(
        (other) => other !== node && contains(other.span, node.span),
      ),
  );
}

/**
 * Toggles every command block the given range touches between one-line and
 * one-attribute-per-line, each independently of the others' current shape.
 * `range.start === range.end` (a plain cursor, no drag) toggles the one
 * command it sits inside, matching how the rest of the app treats a
 * collapsed selection as "the thing under the caret."
 */
export function toggleCommandLayoutInRange(
  parse: ParseResult,
  range: Span,
): ToggleLayoutResult {
  const nodes = targetedNodes(parse, range).sort(
    (a, b) => a.span.start - b.span.start,
  );
  const edits: SourceEdit[] = [];
  let toggledCount = 0;
  let skippedCount = 0;

  for (const node of nodes) {
    const isInline = isSourceInline(parse, node);
    // The unsafe direction is EXPANDED -> INLINE (collapsing something with a
    // nested if/random/command onto one line), going the other way is
    // always fine, any block can be spread out.
    if (!isInline && hasNonAttributeItems(node)) {
      skippedCount++;
      continue;
    }
    const name = resolvedName(parse, node);
    const options = {
      ...DEFAULT_FORMAT_OPTIONS,
      alwaysExpand: isInline ? [name] : [],
      alwaysInline: isInline ? [] : [name],
    };
    const result = formatScript(parse, options);
    if (!result.verified) {
      skippedCount++;
      continue;
    }
    const edit = trimmedEdit(parse.source, result.text);
    if (edit === null) {
      // Nothing the formatter could change here, an unclosed block or a
      // multi-line comment inside it, which `canInline` refuses regardless
      // of the override. Not an error; the node just can't flip.
      skippedCount++;
      continue;
    }
    if (edit.start < node.span.start || edit.end > node.span.end) {
      // The formatter's job outside this node's own shape is still "keep
      // this INDENTED CONSISTENTLY", not "keep byte-identical". An already-
      // expanded sibling elsewhere whose actual indentation happens not to
      // match what the shared indent unit computes to gets normalized as a
      // side effect of ANY run, whether or not that sibling's own shape
      // changed (measured: a hand-built fixture with one flush-left
      // already-expanded block and no other indentation evidence in the
      // file). A hotkey whose whole promise is "only the command(s) you
      // targeted" cannot ship an edit that reaches past them, so it declines
      // rather than silently reformatting something the user never asked
      // about. The tightest possible diff (`trimmedEdit`) already proves
      // there was nowhere narrower to land.
      skippedCount++;
      continue;
    }
    edits.push(edit);
    toggledCount++;
  }

  return { edits, toggledCount, skippedCount };
}
