// Phase 3.3, the text-patch engine, docs/breakdown-design.md Sec.4 (rev 4).
// Pure: no I/O, no React/Monaco/Tauri. Every intent reduces to one span
// replace or one anchored insert (Sec.4.2), computed from token spans only.

import type {
  AttributeNode,
  BlockNode,
  CommandNode,
  ParseResult,
  SectionNode,
} from "../../parser/types";
import type { DraggableCard, InsertAnchor } from "./intents";
import type { LanguageIndex } from "../../parser/language";
import {
  detectIndentStep,
  detectEol,
  inferStyle,
  lineIndentOf,
  lineStartOf,
  placeholderFor,
  reindentBlock,
  renderAttribute,
  renderCommand,
  renderNamed,
  renderValue,
  indentContinuationLines,
  relocateSlice,
  resolveRendered,
  type Rendered,
  type Renderable,
} from "./formatStyle";
import {
  PatchError,
  type BranchRef,
  type EditIntent,
  type EditResult,
  type InsertTarget,
  type TextEdit,
} from "./intents";
import { padCommentContent } from "../comments";

export function applyEdit(source: string, edit: TextEdit): string {
  return source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
}

/**
 * Every TextEdit an EditResult carries, highest offset first. All of them
 * are in the same ORIGINAL coordinates, so applying them in this order
 * keeps each remaining edit's offsets valid, since an edit never shifts
 * text that sits before it. Monaco's pushEditOperations takes the same
 * original-coordinate edits and orders them itself, so this order is for
 * string splicing and for anchor shifting, which walk edits one at a time.
 */
export function editsOf(result: EditResult): TextEdit[] {
  const edits = [result.edit];
  if (result.removal) edits.push(result.removal);
  if (result.companion) edits.push(result.companion);
  return edits.sort((x, y) => y.start - x.start);
}

/** Applies every edit of a result to the source, the string form of one Monaco undo entry. */
export function applyEditResult(source: string, result: EditResult): string {
  let out = source;
  for (const edit of editsOf(result)) out = applyEdit(out, edit);
  return out;
}

const WS = new Set([" ", "\t"]);

function nextEolEnd(src: string, pos: number): number {
  const i = src.indexOf("\n", pos);
  return i === -1 ? src.length : i + 1;
}

/** True iff only spaces/tabs sit between this offset's line start and the offset. */
function wsOnlyBefore(src: string, pos: number): boolean {
  return /^[ \t]*$/.test(src.slice(lineStartOf(src, pos), pos));
}

export function computeEdit(
  result: ParseResult,
  intent: EditIntent,
  lang: LanguageIndex,
): EditResult {
  const src = result.source;
  const tokens = result.tokens;
  const eol = detectEol(src);

  // ---- shared insert helpers (Sec.4.5) ----

  function ownLineInsert(
    anchorTokenStart: number,
    indent: string,
    renderable: Renderable,
  ): EditResult {
    // Insert a full line so the anchor token keeps its own line + indent.
    if (wsOnlyBefore(src, anchorTokenStart)) {
      const at = lineStartOf(src, anchorTokenStart);
      const rendered = resolveRendered(renderable, indent);
      const newText = indent + rendered.text + eol;
      return {
        edit: { start: at, end: at, newText },
        caret: at + indent.length + rendered.caretOffset,
      };
    }
    // Anchor shares its line with other content, degrade to inline (Sec.4.3 governs).
    const rendered = resolveRendered(renderable, "");
    const newText = rendered.text + " ";
    return {
      edit: { start: anchorTokenStart, end: anchorTokenStart, newText },
      caret: anchorTokenStart + rendered.caretOffset,
    };
  }

  function insertIntoBlock(
    block: BlockNode,
    renderable: Renderable,
  ): EditResult {
    if (block.close === undefined)
      throw new PatchError(
        "block is unclosed — finish it in the Code tab first",
      );
    const style = inferStyle(
      result,
      tokens[block.open].end,
      tokens[block.close].start,
      block.items.map((i) => i.span),
    );
    if (style.onOwnLines)
      return ownLineInsert(
        tokens[block.close].start,
        style.indentUnit,
        renderable,
      );
    const at = tokens[block.close].start;
    const rendered = resolveRendered(renderable, "");
    return {
      edit: { start: at, end: at, newText: rendered.text + " " },
      caret: at + rendered.caretOffset,
    };
  }

  function insertIntoSection(
    section: SectionNode,
    renderable: Renderable,
  ): EditResult {
    const items = section.items;
    if (items.length === 0) {
      const at = tokens[section.header].end;
      // Sections don't add an indent step. Top-level items conventionally
      // sit at the header's own indent (usually column 0).
      const indent = lineIndentOf(src, tokens[section.header].start);
      const rendered = resolveRendered(renderable, indent);
      const newText = eol + indent + rendered.text;
      return {
        edit: { start: at, end: at, newText },
        caret: at + eol.length + indent.length + rendered.caretOffset,
      };
    }
    const last = items[items.length - 1];
    const style = inferStyle(
      result,
      tokens[section.header].end,
      undefined,
      items.map((i) => i.span),
    );
    const at = tokens[last.lastToken].end;
    if (style.onOwnLines) {
      const indent = lineIndentOf(src, items[items.length - 1].span.start);
      const rendered = resolveRendered(renderable, indent);
      const newText = eol + indent + rendered.text;
      return {
        edit: { start: at, end: at, newText },
        caret: at + eol.length + indent.length + rendered.caretOffset,
      };
    }
    const rendered = resolveRendered(renderable, "");
    return {
      edit: { start: at, end: at, newText: " " + rendered.text },
      caret: at + 1 + rendered.caretOffset,
    };
  }

  // Where a "nothing to anchor to" insert really goes. Offset 0 was the old
  // answer, and it put the new text ABOVE the header comment scriptHeader.ts
  // stamps on every new script, so the comment sank to the bottom as the
  // script grew (beta feedback 2026-09-17). A leading comment is trivia
  // tokens with no AST node, so `preamble` is empty while the file is not.
  // Land on the line after the last leading trivia token instead. A file
  // with no leading trivia still answers offset 0.
  function afterLeadingTrivia(): { at: number; prefix: string } {
    let end = 0;
    for (const t of tokens) {
      if (!t.isTrivia) break;
      end = t.end;
    }
    if (end === 0) return { at: 0, prefix: "" };
    // Prefer the start of the next line, so the insert does not share the
    // comment's closing line. Fall back to "right after the trivia, on a
    // fresh line" when something else already sits on that line (a section
    // header glued to the comment) or the file ends without a newline.
    const lineEnd = nextEolEnd(src, end);
    if (lineEnd > end && src.slice(end, lineEnd).trim() === "")
      return { at: lineEnd, prefix: "" };
    return { at: end, prefix: eol };
  }

  // The Header tab's fallback target when nothing is selected, mirrors
  // insertIntoSection. The empty case is reachable now that the Header tab
  // always renders (sectionTabsModel.ts), a fresh script gets its first
  // #const this way.
  function insertIntoPreamble(renderable: Renderable): EditResult {
    const items = result.script.preamble;
    if (items.length === 0) {
      const { at, prefix } = afterLeadingTrivia();
      const rendered = resolveRendered(renderable, "");
      const newText = prefix + rendered.text + eol;
      return {
        edit: { start: at, end: at, newText },
        caret: at + prefix.length + rendered.caretOffset,
      };
    }
    const last = items[items.length - 1];
    const at = tokens[last.lastToken].end;
    // A single preamble item has no consecutive pair for inferStyle to compare,
    // and (unlike a section) there's no opener token to compare it against
    // either, the preamble starts at file offset 0, not a `<SECTION>` tag.
    // Default to own-lines, matching inferStyle's own empty-container/empty-file
    // default one line up.
    if (items.length === 1) {
      const indent = lineIndentOf(src, last.span.start);
      const rendered = resolveRendered(renderable, indent);
      const newText = eol + indent + rendered.text;
      return {
        edit: { start: at, end: at, newText },
        caret: at + eol.length + indent.length + rendered.caretOffset,
      };
    }
    const style = inferStyle(
      result,
      tokens[items[0].firstToken].start,
      undefined,
      items.map((i) => i.span),
    );
    if (style.onOwnLines) {
      const indent = lineIndentOf(src, items[items.length - 1].span.start);
      const rendered = resolveRendered(renderable, indent);
      const newText = eol + indent + rendered.text;
      return {
        edit: { start: at, end: at, newText },
        caret: at + eol.length + indent.length + rendered.caretOffset,
      };
    }
    const rendered = resolveRendered(renderable, "");
    return {
      edit: { start: at, end: at, newText: " " + rendered.text },
      caret: at + 1 + rendered.caretOffset,
    };
  }

  // A canonical tab whose section doesn't exist in the file at all yet (no
  // SectionNode, so no header token and no items to anchor to), the
  // fallback for e.g. a brand-new file's PLAYER_SETUP tab. Appends
  // `<name>` plus the rendered command after everything already in the
  // file (last section, else preamble, else offset 0) as ONE insert.
  // Doesn't hunt for a canonically-ordered slot among existing sections:
  // the engine runs sections in canonical order regardless of file
  // position (measured, docs/build-log.md), so there's no correctness
  // reason to, and appending naturally lands in canonical order anyway
  // for the common case of building a script front-to-back.
  function insertIntoNewSection(
    name: string,
    renderable: Renderable,
  ): EditResult {
    const rendered = resolveRendered(renderable, "");
    const sections = result.script.sections;
    const preamble = result.script.preamble;
    const lastSection = sections[sections.length - 1];
    // Nothing in the file but (maybe) a leading comment, the new-script
    // case, see afterLeadingTrivia.
    const lead =
      !lastSection && preamble.length === 0 ? afterLeadingTrivia() : undefined;
    const anchorEnd = lastSection
      ? lastSection.items.length > 0
        ? tokens[lastSection.items[lastSection.items.length - 1].lastToken].end
        : tokens[lastSection.header].end
      : preamble.length > 0
        ? tokens[preamble[preamble.length - 1].lastToken].end
        : lead!.at;
    const prefix = lead ? lead.prefix : eol;
    const tag = `<${name}>`;
    const newText = `${prefix}${tag}${eol}${rendered.text}${eol}`;
    return {
      edit: { start: anchorEnd, end: anchorEnd, newText },
      caret:
        anchorEnd +
        prefix.length +
        tag.length +
        eol.length +
        rendered.caretOffset,
    };
  }

  // The token (trivia included) immediately at-or-after `pos`, skipping
  // trivia. Used to see what a same-line-agnostic grammar rule (block-open
  // adjacency, parser.ts's openBlockFrame) would find right after an
  // insertion point, since newlines are trivia and never terminate that
  // rule on their own.
  function firstNonTriviaFrom(pos: number) {
    for (const t of tokens) {
      if (t.end <= pos || t.isTrivia) continue;
      return t;
    }
    return undefined;
  }

  // Sec.3.9/Sec.4.5/Sec.4.12, insert immediately after or before a selected
  // card (breakdown-design.md). An anchor that does not start its own
  // physical line shares that line with something else the parser is still
  // free to extend into — a sibling directive's own optional/aliasing value
  // slot (`#const`, acceptsKnownName) is the corpus case that found this:
  // splicing new tokens onto that shared line, even with a bare space and
  // no newline, can get swallowed into the wrong node or sever it into a
  // RawNode on reparse (rearrange.property.test.ts). There is no general,
  // purely-token-span way to tell a safe shared line from an unsafe one, so
  // refuse rather than guess (PatchError, same "unavailable" contract as an
  // unclosed container) — applyEdit.ts already renders that as an inert
  // control, never a crash. `insertAfterItem` also refuses when the very
  // next non-trivia token is a block-open brace: even a fully-own-line
  // anchor (a comment sitting between a command's own args and its own
  // `{`) would otherwise sever the block from its command, since a
  // newline does not stop that adjacency rule either.
  //
  // A third case, same family: the anchor itself is a directive (`#const`)
  // whose own `def` still has an unfilled `acceptsKnownName` argument slot
  // (a bare `#const NAME` with no value — parser-design Sec.2.1 item 4).
  // That slot's whole point is to accept a known command/attribute name as
  // a value, on the reading that it may be an alias rather than a mistake,
  // and `stopSetAt` is newline-agnostic — so inserting a new item right
  // after this anchor puts that new item's own leading token exactly where
  // the open slot will swallow it on reparse, degrading the new item into
  // this directive's value and severing whatever followed it into a
  // RawNode. This is not the shared-line case above (both anchor and
  // insertion can each own a full physical line) and not the open-brace
  // case (the swallowed token is an ordinary word). Read generically off
  // `def.arguments` rather than naming `#const`, since the flag is what
  // marks the danger, not the directive.
  function insertAfterItem(
    item: InsertAnchor,
    renderable: Renderable,
  ): EditResult {
    if (!wsOnlyBefore(src, item.span.start)) {
      throw new PatchError(
        "can't insert here — this card shares its line with something else",
      );
    }
    if (item.kind === "directive") {
      const nextArgDef = item.def?.arguments?.[item.args.length];
      if (nextArgDef?.acceptsKnownName) {
        throw new PatchError(
          "can't insert here — this directive's value would swallow the new item",
        );
      }
    }
    const anchorEnd = item.span.end;
    const next = firstNonTriviaFrom(anchorEnd);
    if (next?.kind === "openBrace") {
      throw new PatchError(
        "can't insert here — a block open must stay right after this card",
      );
    }
    const indent = lineIndentOf(src, item.span.start);
    const rendered = resolveRendered(renderable, indent);
    const newText = eol + indent + rendered.text;
    return {
      edit: { start: anchorEnd, end: anchorEnd, newText },
      caret: anchorEnd + eol.length + indent.length + rendered.caretOffset,
    };
  }

  // `{ before: Item }` (2026-09-18), the mirror of insertAfterItem, same
  // refusal above.
  function insertBeforeItem(
    item: InsertAnchor,
    renderable: Renderable,
  ): EditResult {
    if (!wsOnlyBefore(src, item.span.start)) {
      throw new PatchError(
        "can't insert here — this card shares its line with something else",
      );
    }
    return ownLineInsert(
      item.span.start,
      lineIndentOf(src, item.span.start),
      renderable,
    );
  }

  function branchTerminator(ref: BranchRef): number | undefined {
    const { parent, index } = ref;
    if (parent.kind === "if") {
      const next = parent.branches[index + 1];
      return next ? next.keyword : parent.endif;
    }
    const next = parent.branches[index + 1];
    return next ? next.chanceKeyword : parent.end;
  }

  function branchOf(ref: BranchRef) {
    const b =
      ref.parent.kind === "if" ? ref.parent.branches[ref.index] : undefined;
    const rb =
      ref.parent.kind === "random" ? ref.parent.branches[ref.index] : undefined;
    if (!b && !rb) throw new PatchError("branch index out of range");
    return { ifBranch: b, randomBranch: rb };
  }

  function insertIntoBranch(
    ref: BranchRef,
    renderable: Renderable,
  ): EditResult {
    const term = branchTerminator(ref);
    if (term === undefined)
      throw new PatchError(
        "conditional is unclosed — finish it in the Code tab first",
      );
    const { ifBranch, randomBranch } = branchOf(ref);
    const items = (ifBranch?.items ?? randomBranch?.items)!;
    const openerEnd =
      ifBranch !== undefined
        ? tokens[ifBranch.condition ?? ifBranch.keyword].end
        : tokens[randomBranch!.chance?.lastToken ?? randomBranch!.chanceKeyword]
            .end;
    const style = inferStyle(
      result,
      openerEnd,
      tokens[term].start,
      items.map((i) => i.span),
    );
    if (style.onOwnLines)
      return ownLineInsert(tokens[term].start, style.indentUnit, renderable);
    const at = tokens[term].start;
    const rendered = resolveRendered(renderable, "");
    return {
      edit: { start: at, end: at, newText: rendered.text + " " },
      caret: at + rendered.caretOffset,
    };
  }

  // ---- Sec.4.6 deletion: whole-line vs surgical, all-or-nothing ----

  function removeSpan(span: { start: number; end: number }): EditResult {
    const L = src.slice(lineStartOf(src, span.start), span.start);
    const R = src.slice(span.end, nextEolEnd(src, span.end));
    if (/^[ \t]*$/.test(L) && /^[ \t]*\r?\n?$/.test(R)) {
      const start = lineStartOf(src, span.start);
      const end = nextEolEnd(src, span.end);
      return { edit: { start, end, newText: "" }, caret: start };
    }
    // Surgical: exactly the span plus ONE adjoining separator space (prefer before).
    let start = span.start;
    let end = span.end;
    if (start > 0 && WS.has(src[start - 1])) start--;
    else if (end < src.length && WS.has(src[end])) end++;
    return { edit: { start, end, newText: "" }, caret: start };
  }

  // Shared by addCommand and addComment: both reduce to "render this text,
  // insert it at this InsertTarget" via the helpers above, differing only
  // in how `rendered` gets built.
  function insertAt(at: InsertTarget, rendered: Renderable): EditResult {
    if ("after" in at) return insertAfterItem(at.after, rendered);
    if ("before" in at) return insertBeforeItem(at.before, rendered);
    if (at.in === "section") return insertIntoSection(at.section, rendered);
    if (at.in === "block") return insertIntoBlock(at.block, rendered);
    if (at.in === "preamble") return insertIntoPreamble(rendered);
    if (at.in === "newSection") return insertIntoNewSection(at.name, rendered);
    return insertIntoBranch(at.branch, rendered);
  }

  // ---- 2026-09-18, moving and duplicating whole cards (Sec.4.12) ----

  // The text a card carries when it moves: its span plus any trivia that
  // finishes the same line (a trailing `/* why */`). The parser attaches
  // that comment to nothing, so without this it would be left behind at
  // the old position as an orphan line, which is not what a person
  // dragging the card meant. Trivia on a LATER line is not part of the
  // card and stays.
  //
  // A CommentRef carries no `lastToken` to glom trailing trivia onto (it
  // IS trivia), so it skips straight to its own span, unchanged.
  function carriedRange(node: DraggableCard): {
    start: number;
    end: number;
  } {
    if (node.kind === "comment")
      return { start: node.span.start, end: node.span.end };
    let end = node.span.end;
    for (let i = node.lastToken + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t.isTrivia) break;
      if (/\n/.test(src.slice(end, t.start))) break;
      end = t.end;
    }
    return { start: node.span.start, end };
  }

  function assertClosed(node: DraggableCard, verb: string): void {
    const closer =
      node.kind === "if"
        ? node.endif
        : node.kind === "random"
          ? node.end
          : node.kind === "command"
            ? (node.block?.close ?? 0)
            : 0;
    if (closer === undefined)
      throw new PatchError(
        `cannot ${verb} an unclosed construct, finish it in the Code tab first`,
      );
  }

  /** The node's own text, with continuation lines re-aligned to whatever indent the insert helper picks. */
  function sliceRenderable(
    node: DraggableCard,
    range: { start: number; end: number },
  ): Renderable {
    const slice = src.slice(range.start, range.end);
    const fromIndent = lineIndentOf(src, node.span.start);
    return (indent) => ({
      text: relocateSlice(slice, fromIndent, indent, eol),
      caretOffset: 0,
    });
  }

  // ---- dispatch ----

  switch (intent.kind) {
    case "setArgValue": {
      const first = tokens[intent.arg.firstToken];
      const quoted = first.text.startsWith('"');
      const text = quoted
        ? `"${renderValue(intent.value)}"`
        : renderValue(intent.value);
      return {
        edit: {
          start: intent.arg.span.start,
          end: intent.arg.span.end,
          newText: text,
        },
        caret: intent.arg.span.start,
      };
    }

    case "applySuggestion": {
      const { node, tokenIndex, replacement } = intent;
      if (tokenIndex < node.firstToken || tokenIndex > node.lastToken) {
        throw new PatchError("suggestion token lies outside the raw node");
      }
      const tok = tokens[tokenIndex];
      return {
        edit: { start: tok.start, end: tok.end, newText: replacement },
        caret: tok.start,
      };
    }

    case "removeNode":
      return removeSpan(intent.node.span);

    case "duplicateNode": {
      assertClosed(intent.node, "duplicate");
      const range = carriedRange(intent.node);
      // Anchored after the node's OWN span, not the carried range, so the
      // copy starts on the line after the original's trailing comment
      // (insertAfterItem keeps that comment glued to its owner).
      return insertAfterItem(intent.node, sliceRenderable(intent.node, range));
    }

    case "moveNode": {
      assertClosed(intent.node, "move");
      const range = carriedRange(intent.node);
      const removal = removeSpan(range).edit;
      const insert = insertAt(intent.to, sliceRenderable(intent.node, range));
      // The destination may not lie inside the text being moved. That is
      // both the degenerate "after itself" drop and the real hazard, a
      // conditional dragged into one of its own branches, which would
      // delete the destination along with the node.
      if (
        insert.edit.start >= removal.start &&
        insert.edit.start <= removal.end
      )
        throw new PatchError("cannot move a card into itself");
      // Both halves are in ORIGINAL coordinates. The caret is in the final
      // text, so when the insert lands below the removal it slides up by
      // the removed length; above it, the removal cannot reach it.
      const removedLength = removal.end - removal.start;
      const caret =
        insert.edit.start > removal.start
          ? insert.caret - removedLength
          : insert.caret;
      return { edit: insert.edit, caret, removal };
    }

    case "addControlFlow": {
      const step = detectIndentStep(src);
      const skeleton: Renderable = (indent) =>
        intent.construct === "if"
          ? { text: `if TODO${eol}${indent}endif`, caretOffset: 3 }
          : {
              // No "0" operand. A percent_chance left bare parses with
              // chance === undefined (Sec.4.4, same as an absent if
              // condition), which RandomCard.tsx already renders as a
              // blank field with a hint rather than a literal value. A
              // synthesized "0" here used to draw RMS0308's zeroFirst
              // warning on a block the user hadn't touched yet, since this
              // skeleton's one branch is always the first (beta feedback
              // 2026-09-18).
              text: `start_random${eol}${indent}${step}percent_chance${eol}${indent}end_random`,
              caretOffset: `start_random${eol}${indent}${step}percent_chance`
                .length,
            };
      return insertAt(intent.at, skeleton);
    }

    case "addAttribute":
    case "toggleFlag": {
      if (intent.kind === "toggleFlag" && !intent.on) {
        if (intent.target.kind !== "block")
          throw new PatchError(
            "cannot remove a flag from a block-less command",
          );
        const matches = intent.target.items.filter(
          (i): i is AttributeNode =>
            i.kind === "attribute" && tokens[i.name].text === intent.name,
        );
        if (matches.length === 0)
          throw new PatchError(`flag "${intent.name}" is not present`);
        return removeSpan(matches[matches.length - 1].span);
      }
      const def = lang.attributesByName.get(intent.name);
      const rendered =
        intent.kind === "addAttribute" && intent.bare
          ? // Caret at the END of the name, the offset the missing-arg
            // editor registers under (AttributeRow: node.span.end), so
            // requestFocus lands in the empty field.
            { text: intent.name, caretOffset: intent.name.length }
          : renderAttribute(
              def,
              intent.name,
              intent.kind === "addAttribute" ? intent.value : [],
            );
      if (intent.target.kind === "block")
        return insertIntoBlock(intent.target, rendered);
      // Sec.4.6 brace synthesis, the command has no block at all.
      const cmd: CommandNode = intent.target;
      if (cmd.block !== undefined) return insertIntoBlock(cmd.block, rendered);
      const at = tokens[cmd.lastToken].end;
      const cmdIndent = lineIndentOf(src, cmd.span.start);
      const inner = cmdIndent + detectIndentStep(src);
      const newText = ` {${eol}${inner}${rendered.text}${eol}${cmdIndent}}`;
      return {
        edit: { start: at, end: at, newText },
        caret: at + 2 + eol.length + inner.length + rendered.caretOffset,
      };
    }

    case "appendArg": {
      const at = tokens[intent.node.lastToken].end;
      const present = intent.node.args.length;
      const index = intent.index ?? present;
      if (index < present)
        throw new PatchError("appendArg targets an argument already present");
      const defs = intent.node.def?.arguments ?? [];
      const padding: string[] = [];
      for (let i = present; i < index; i++) {
        const def = defs[i];
        padding.push(def ? placeholderFor(def) : "TODO");
      }
      const parts = [...padding, renderValue(intent.value)];
      const text = " " + parts.join(" ");
      // Caret on the value the user typed, past any padding.
      const caret = at + text.length - renderValue(intent.value).length;
      return {
        edit: { start: at, end: at, newText: text },
        caret,
      };
    }

    case "addCommand": {
      const def = lang.commandsByName.get(intent.name);
      if (def) return insertAt(intent.at, renderCommand(def, intent.name));
      // Directives (#const/#define/#include_drs/#includeXS) share this intent.
      // The picker offers them on every tab (beta feedback 2026-09-17, they
      // are legal anywhere, not only in the preamble) and they render the
      // same way, name plus one placeholder per declared argument. An unknown
      // name falls through to renderCommand's bare-name path as before.
      const dir = lang.directivesByName.get(intent.name);
      if (dir)
        return insertAt(
          intent.at,
          renderNamed(intent.name, dir.arguments, undefined),
        );
      return insertAt(intent.at, renderCommand(undefined, intent.name));
    }

    case "insertText": {
      // Object Templates (docs/object-templates-brief.md): reindentBlock
      // translates templates.ts's tab-per-level canonical text to this
      // file's own detected indent unit/eol before the shared insertAt
      // helpers add the outer (anchor-line) indent, same as any other
      // Rendered value.
      // The block's continuation lines take the destination indent as well
      // (2026-09-18, alongside moveNode). Before this only the first line
      // did, so a template dropped inside an if branch had its second
      // command at column 0. The caret sits on a line start, and every
      // line before it gains the same prefix, so it moves by one indent
      // per line crossed.
      const block = (text: string, caretOffset: number): Renderable => {
        const rendered = reindentBlock(
          text,
          caretOffset,
          detectIndentStep(src),
          eol,
        );
        return (indent) => {
          const lineBreaks = rendered.text
            .slice(0, rendered.caretOffset)
            .split(eol).length;
          return {
            text: indentContinuationLines(rendered.text, indent, eol),
            caretOffset:
              rendered.caretOffset + indent.length * (lineBreaks - 1),
          };
        };
      };
      const main = insertAt(intent.at, block(intent.text, intent.caretOffset));
      if (intent.setupText === undefined) return main;

      // The companion lines go after everything already in the last
      // PLAYER_SETUP, so an effect the script already sets keeps its
      // place. With no PLAYER_SETUP at all they go to the preamble, which
      // is where every corpus map using this idiom keeps them. A new
      // section is not synthesized, insertIntoNewSection appends at end of
      // file and PLAYER_SETUP there would come after the generation it
      // has to precede.
      const setupSection = [...result.script.sections]
        .reverse()
        .find((s) => s.name === "PLAYER_SETUP");
      const setupBlock = block(intent.setupText, 0);
      const companion = (
        setupSection
          ? insertIntoSection(setupSection, setupBlock)
          : insertIntoPreamble(setupBlock)
      ).edit;
      // Both inserts are zero-width, so two at one offset would leave their
      // order up to whoever applies them. It happens in a file with no
      // sections and nothing in the preamble (empty, or only a comment),
      // where the preamble insert and the new OBJECTS_GENERATION section
      // both start after the leading trivia. Merge them into one insert
      // with the setup lines first, since they belong above every section.
      // Refusing here used to close the dialog having inserted nothing.
      if (companion.start === main.edit.start)
        return {
          edit: {
            start: main.edit.start,
            end: main.edit.end,
            newText: companion.newText + main.edit.newText,
          },
          caret: main.caret + companion.newText.length,
        };
      // Original coordinates for both edits, final-text coordinates for the
      // caret. A companion above the main insert pushes the caret down by
      // its own length, one below it cannot reach it.
      const caret =
        companion.start < main.edit.start
          ? main.caret + companion.newText.length
          : main.caret;
      return { edit: main.edit, caret, companion };
    }

    case "addComment": {
      // "/* */", not "/**/": RMS's comment markers only tokenize as such
      // when whitespace-separated from their neighbor (parser-design
      // Sec.2's whitespace-splitter lexical model), so glued delimiters
      // would lex as one plain word and never become a comment at all.
      // caretOffset 0 lands the post-reparse caret at the comment's own
      // span.start, the exact offset CommentCard registers as focusable
      // (Sec.6.3's anchor convention, see CommentCard.tsx), which is what
      // lets BreakdownPane's focus effect select the placeholder space so
      // the user's first keystroke replaces it instead of landing next to it.
      return insertAt(intent.at, { text: "/* */", caretOffset: 0 });
    }

    case "editComment": {
      const { innerSpan } = intent;
      // padCommentContent guarantees the delimiters stay whitespace-
      // separated from whatever the caller supplied, regardless of what
      // that text is, the same "the engine trusts its caller for content,
      // never for structural safety" split every other renderX helper in
      // formatStyle.ts already makes (CommentCard.tsx separately owns the
      // content policy of rejecting an embedded comment marker).
      const text = padCommentContent(intent.text);
      return {
        edit: { start: innerSpan.start, end: innerSpan.end, newText: text },
        caret: innerSpan.start + text.length,
      };
    }

    case "setCondition": {
      const { ifBranch } = branchOf(intent.branch);
      if (!ifBranch)
        throw new PatchError("setCondition targets an if/elseif branch");
      const kwText = tokens[ifBranch.keyword].text;
      if (kwText === "else")
        throw new PatchError("an else branch has no condition");
      if (ifBranch.condition !== undefined) {
        const tok = tokens[ifBranch.condition];
        return {
          edit: { start: tok.start, end: tok.end, newText: intent.value },
          caret: tok.start,
        };
      }
      const at = tokens[ifBranch.keyword].end; // Sec.4.4 absent case: insert after keyword
      return {
        edit: { start: at, end: at, newText: " " + intent.value },
        caret: at + 1,
      };
    }

    case "setChance": {
      const { randomBranch } = branchOf(intent.branch);
      if (!randomBranch)
        throw new PatchError("setChance targets a percent_chance branch");
      const text = renderValue(intent.value);
      if (randomBranch.chance !== undefined) {
        const span = randomBranch.chance.span;
        return {
          edit: { start: span.start, end: span.end, newText: text },
          caret: span.start,
        };
      }
      const at = tokens[randomBranch.chanceKeyword].end;
      return {
        edit: { start: at, end: at, newText: " " + text },
        caret: at + 1,
      };
    }

    case "addBranch": {
      const closer =
        intent.parent.kind === "if" ? intent.parent.endif : intent.parent.end;
      if (closer === undefined)
        throw new PatchError(
          "construct is unclosed — finish it in the Code tab first",
        );
      // No "0" operand on a new percent_chance branch, same reasoning as
      // addControlFlow above. Left bare, RandomCard.tsx's chance field
      // renders blank with a hint instead of a value nobody meant to write.
      const text =
        intent.branch === "elseif"
          ? "elseif TODO"
          : intent.branch === "else"
            ? "else"
            : "percent_chance";
      const rendered: Rendered = {
        text,
        caretOffset:
          intent.branch === "else"
            ? 0
            : intent.branch === "elseif"
              ? text.indexOf(" ") + 1
              : text.length,
      };
      // Branch keywords sit at the closer's own indent, not one step deeper.
      return ownLineInsert(
        tokens[closer].start,
        lineIndentOf(src, tokens[closer].start),
        rendered,
      );
    }

    case "removeBranch": {
      const { parent, index } = intent.branch;
      if (parent.branches.length <= 1) {
        throw new PatchError(
          "cannot remove the only branch — delete the whole construct instead",
        );
      }
      const closer = parent.kind === "if" ? parent.endif : parent.end;
      if (closer === undefined)
        throw new PatchError(
          "construct is unclosed — finish it in the Code tab first",
        );
      const startTok =
        parent.kind === "if"
          ? parent.branches[index].keyword
          : parent.branches[index].chanceKeyword;
      if (startTok === undefined)
        throw new PatchError("branch index out of range");
      const nextTok =
        parent.kind === "if"
          ? (parent.branches[index + 1]?.keyword ?? closer)
          : (parent.branches[index + 1]?.chanceKeyword ?? closer);
      const from = wsOnlyBefore(src, tokens[startTok].start)
        ? lineStartOf(src, tokens[startTok].start)
        : tokens[startTok].start;
      const to = wsOnlyBefore(src, tokens[nextTok].start)
        ? lineStartOf(src, tokens[nextTok].start)
        : tokens[nextTok].start;
      if (to <= from) throw new PatchError("branch range is degenerate");
      return { edit: { start: from, end: to, newText: "" }, caret: from };
    }
  }
}
