// Phase 3.3, the text-patch engine, docs/breakdown-design.md Sec.4 (rev 4).
// Pure: no I/O, no React/Monaco/Tauri. Every intent reduces to one span
// replace or one anchored insert (Sec.4.2), computed from token spans only.

import type { AttributeNode, BlockNode, CommandNode, Item, ParseResult, SectionNode } from "../../parser/types";
import type { LanguageIndex } from "../../parser/language";
import {
  detectIndentStep,
  detectEol,
  inferStyle,
  lineIndentOf,
  lineStartOf,
  renderAttribute,
  renderCommand,
  renderValue,
  type Rendered,
} from "./formatStyle";
import { PatchError, type BranchRef, type EditIntent, type EditResult, type InsertTarget, type TextEdit } from "./intents";
import { padCommentContent } from "../comments";

export function applyEdit(source: string, edit: TextEdit): string {
  return source.slice(0, edit.start) + edit.newText + source.slice(edit.end);
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

export function computeEdit(result: ParseResult, intent: EditIntent, lang: LanguageIndex): EditResult {
  const src = result.source;
  const tokens = result.tokens;
  const eol = detectEol(src);

  // ---- shared insert helpers (Sec.4.5) ----

  function ownLineInsert(anchorTokenStart: number, indent: string, rendered: Rendered): EditResult {
    // Insert a full line so the anchor token keeps its own line + indent.
    if (wsOnlyBefore(src, anchorTokenStart)) {
      const at = lineStartOf(src, anchorTokenStart);
      const newText = indent + rendered.text + eol;
      return { edit: { start: at, end: at, newText }, caret: at + indent.length + rendered.caretOffset };
    }
    // Anchor shares its line with other content, degrade to inline (Sec.4.3 governs).
    const newText = rendered.text + " ";
    return { edit: { start: anchorTokenStart, end: anchorTokenStart, newText }, caret: anchorTokenStart + rendered.caretOffset };
  }

  function insertIntoBlock(block: BlockNode, rendered: Rendered): EditResult {
    if (block.close === undefined) throw new PatchError("block is unclosed — finish it in the Code tab first");
    const style = inferStyle(
      result,
      tokens[block.open].end,
      tokens[block.close].start,
      block.items.map((i) => i.span),
    );
    if (style.onOwnLines) return ownLineInsert(tokens[block.close].start, style.indentUnit, rendered);
    const at = tokens[block.close].start;
    return { edit: { start: at, end: at, newText: rendered.text + " " }, caret: at + rendered.caretOffset };
  }

  function insertIntoSection(section: SectionNode, rendered: Rendered): EditResult {
    const items = section.items;
    if (items.length === 0) {
      const at = tokens[section.header].end;
      // Sections don't add an indent step. Top-level items conventionally
      // sit at the header's own indent (usually column 0).
      const indent = lineIndentOf(src, tokens[section.header].start);
      const newText = eol + indent + rendered.text;
      return { edit: { start: at, end: at, newText }, caret: at + eol.length + indent.length + rendered.caretOffset };
    }
    const last = items[items.length - 1];
    const style = inferStyle(result, tokens[section.header].end, undefined, items.map((i) => i.span));
    const at = tokens[last.lastToken].end;
    if (style.onOwnLines) {
      const indent = lineIndentOf(src, items[items.length - 1].span.start);
      const newText = eol + indent + rendered.text;
      return { edit: { start: at, end: at, newText }, caret: at + eol.length + indent.length + rendered.caretOffset };
    }
    return { edit: { start: at, end: at, newText: " " + rendered.text }, caret: at + 1 + rendered.caretOffset };
  }

  // The Header tab's fallback target when nothing is selected, mirrors
  // insertIntoSection, minus the empty-container branch: SectionView only
  // renders the Header tab at all when `script.preamble.length > 0` (Sec.3.1),
  // so the empty case is unreachable from the UI today, but it's handled
  // anyway (insert at offset 0) rather than left to throw.
  function insertIntoPreamble(rendered: Rendered): EditResult {
    const items = result.script.preamble;
    if (items.length === 0) {
      const newText = rendered.text + eol;
      return { edit: { start: 0, end: 0, newText }, caret: rendered.caretOffset };
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
      const newText = eol + indent + rendered.text;
      return { edit: { start: at, end: at, newText }, caret: at + eol.length + indent.length + rendered.caretOffset };
    }
    const style = inferStyle(result, tokens[items[0].firstToken].start, undefined, items.map((i) => i.span));
    if (style.onOwnLines) {
      const indent = lineIndentOf(src, items[items.length - 1].span.start);
      const newText = eol + indent + rendered.text;
      return { edit: { start: at, end: at, newText }, caret: at + eol.length + indent.length + rendered.caretOffset };
    }
    return { edit: { start: at, end: at, newText: " " + rendered.text }, caret: at + 1 + rendered.caretOffset };
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
  function insertIntoNewSection(name: string, rendered: Rendered): EditResult {
    const sections = result.script.sections;
    const preamble = result.script.preamble;
    const lastSection = sections[sections.length - 1];
    const anchorEnd = lastSection
      ? lastSection.items.length > 0
        ? tokens[lastSection.items[lastSection.items.length - 1].lastToken].end
        : tokens[lastSection.header].end
      : preamble.length > 0
        ? tokens[preamble[preamble.length - 1].lastToken].end
        : 0;
    const prefix = anchorEnd === 0 ? "" : eol;
    const tag = `<${name}>`;
    const newText = `${prefix}${tag}${eol}${rendered.text}${eol}`;
    return {
      edit: { start: anchorEnd, end: anchorEnd, newText },
      caret: anchorEnd + prefix.length + tag.length + eol.length + rendered.caretOffset,
    };
  }

  // Sec.3.9/Sec.4.5, insert immediately after a selected card. Offset is the
  // anchor's own span.end (keeps a same-line trailing comment attached
  // to the anchor, mirroring Sec.4.6's delete-time rule); style (own-line
  // vs inline, indent) is read from the anchor's OWN line rather than
  // scanning the whole container, so a nested anchor (inside a branch or
  // block) inserts at that same depth for free.
  function insertAfterItem(item: Item, rendered: Rendered): EditResult {
    const anchorEnd = item.span.end;
    const indent = lineIndentOf(src, item.span.start);
    if (wsOnlyBefore(src, item.span.start)) {
      const newText = eol + indent + rendered.text;
      return {
        edit: { start: anchorEnd, end: anchorEnd, newText },
        caret: anchorEnd + eol.length + indent.length + rendered.caretOffset,
      };
    }
    const newText = " " + rendered.text;
    return { edit: { start: anchorEnd, end: anchorEnd, newText }, caret: anchorEnd + 1 + rendered.caretOffset };
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
    const b = ref.parent.kind === "if" ? ref.parent.branches[ref.index] : undefined;
    const rb = ref.parent.kind === "random" ? ref.parent.branches[ref.index] : undefined;
    if (!b && !rb) throw new PatchError("branch index out of range");
    return { ifBranch: b, randomBranch: rb };
  }

  function insertIntoBranch(ref: BranchRef, rendered: Rendered): EditResult {
    const term = branchTerminator(ref);
    if (term === undefined) throw new PatchError("conditional is unclosed — finish it in the Code tab first");
    const { ifBranch, randomBranch } = branchOf(ref);
    const items = (ifBranch?.items ?? randomBranch?.items)!;
    const openerEnd =
      ifBranch !== undefined
        ? tokens[ifBranch.condition ?? ifBranch.keyword].end
        : tokens[randomBranch!.chance?.lastToken ?? randomBranch!.chanceKeyword].end;
    const style = inferStyle(result, openerEnd, tokens[term].start, items.map((i) => i.span));
    if (style.onOwnLines) return ownLineInsert(tokens[term].start, style.indentUnit, rendered);
    const at = tokens[term].start;
    return { edit: { start: at, end: at, newText: rendered.text + " " }, caret: at + rendered.caretOffset };
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
  function insertAt(at: InsertTarget, rendered: Rendered): EditResult {
    if ("after" in at) return insertAfterItem(at.after, rendered);
    if (at.in === "section") return insertIntoSection(at.section, rendered);
    if (at.in === "block") return insertIntoBlock(at.block, rendered);
    if (at.in === "preamble") return insertIntoPreamble(rendered);
    if (at.in === "newSection") return insertIntoNewSection(at.name, rendered);
    return insertIntoBranch(at.branch, rendered);
  }

  // ---- dispatch ----

  switch (intent.kind) {
    case "setArgValue": {
      const first = tokens[intent.arg.firstToken];
      const quoted = first.text.startsWith('"');
      const text = quoted ? `"${renderValue(intent.value)}"` : renderValue(intent.value);
      return {
        edit: { start: intent.arg.span.start, end: intent.arg.span.end, newText: text },
        caret: intent.arg.span.start,
      };
    }

    case "applySuggestion": {
      const { node, tokenIndex, replacement } = intent;
      if (tokenIndex < node.firstToken || tokenIndex > node.lastToken) {
        throw new PatchError("suggestion token lies outside the raw node");
      }
      const tok = tokens[tokenIndex];
      return { edit: { start: tok.start, end: tok.end, newText: replacement }, caret: tok.start };
    }

    case "removeNode":
      return removeSpan(intent.node.span);

    case "addAttribute":
    case "toggleFlag": {
      if (intent.kind === "toggleFlag" && !intent.on) {
        if (intent.target.kind !== "block") throw new PatchError("cannot remove a flag from a block-less command");
        const matches = intent.target.items.filter(
          (i): i is AttributeNode => i.kind === "attribute" && tokens[i.name].text === intent.name,
        );
        if (matches.length === 0) throw new PatchError(`flag "${intent.name}" is not present`);
        return removeSpan(matches[matches.length - 1].span);
      }
      const def = lang.attributesByName.get(intent.name);
      const rendered = renderAttribute(def, intent.name, intent.kind === "addAttribute" ? intent.value : []);
      if (intent.target.kind === "block") return insertIntoBlock(intent.target, rendered);
      // Sec.4.6 brace synthesis, the command has no block at all.
      const cmd: CommandNode = intent.target;
      if (cmd.block !== undefined) return insertIntoBlock(cmd.block, rendered);
      const at = tokens[cmd.lastToken].end;
      const cmdIndent = lineIndentOf(src, cmd.span.start);
      const inner = cmdIndent + detectIndentStep(src);
      const newText = ` {${eol}${inner}${rendered.text}${eol}${cmdIndent}}`;
      return { edit: { start: at, end: at, newText }, caret: at + 2 + eol.length + inner.length + rendered.caretOffset };
    }

    case "addCommand": {
      const def = lang.commandsByName.get(intent.name);
      return insertAt(intent.at, renderCommand(def, intent.name));
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
      return { edit: { start: innerSpan.start, end: innerSpan.end, newText: text }, caret: innerSpan.start + text.length };
    }

    case "setCondition": {
      const { ifBranch } = branchOf(intent.branch);
      if (!ifBranch) throw new PatchError("setCondition targets an if/elseif branch");
      const kwText = tokens[ifBranch.keyword].text;
      if (kwText === "else") throw new PatchError("an else branch has no condition");
      if (ifBranch.condition !== undefined) {
        const tok = tokens[ifBranch.condition];
        return { edit: { start: tok.start, end: tok.end, newText: intent.value }, caret: tok.start };
      }
      const at = tokens[ifBranch.keyword].end; // Sec.4.4 absent case: insert after keyword
      return { edit: { start: at, end: at, newText: " " + intent.value }, caret: at + 1 };
    }

    case "setChance": {
      const { randomBranch } = branchOf(intent.branch);
      if (!randomBranch) throw new PatchError("setChance targets a percent_chance branch");
      const text = renderValue(intent.value);
      if (randomBranch.chance !== undefined) {
        const span = randomBranch.chance.span;
        return { edit: { start: span.start, end: span.end, newText: text }, caret: span.start };
      }
      const at = tokens[randomBranch.chanceKeyword].end;
      return { edit: { start: at, end: at, newText: " " + text }, caret: at + 1 };
    }

    case "addBranch": {
      const closer = intent.parent.kind === "if" ? intent.parent.endif : intent.parent.end;
      if (closer === undefined) throw new PatchError("construct is unclosed — finish it in the Code tab first");
      const text =
        intent.branch === "elseif" ? "elseif TODO" : intent.branch === "else" ? "else" : "percent_chance 0";
      const rendered: Rendered = { text, caretOffset: intent.branch === "else" ? 0 : text.indexOf(" ") + 1 };
      // Branch keywords sit at the closer's own indent, not one step deeper.
      return ownLineInsert(tokens[closer].start, lineIndentOf(src, tokens[closer].start), rendered);
    }

    case "removeBranch": {
      const { parent, index } = intent.branch;
      if (parent.branches.length <= 1) {
        throw new PatchError("cannot remove the only branch — delete the whole construct instead");
      }
      const closer = parent.kind === "if" ? parent.endif : parent.end;
      if (closer === undefined) throw new PatchError("construct is unclosed — finish it in the Code tab first");
      const startTok =
        parent.kind === "if" ? parent.branches[index].keyword : parent.branches[index].chanceKeyword;
      if (startTok === undefined) throw new PatchError("branch index out of range");
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
