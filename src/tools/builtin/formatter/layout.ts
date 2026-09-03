/**
 * The layout pass: walk the AST, decide where every token goes, and say so to
 * the `GapWriter` (docs/formatter-design.md Sec.4, Sec.5).
 *
 * AST-GUIDED, TOKEN-DRIVEN, and that phrase is the whole architecture. A
 * printer that walked only the AST would emit no comments at all, they are
 * `isTrivia` tokens the parser skips (parser.ts:132's non-trivia index), not
 * nodes, and would lose every `RawNode`'s interior. So the tree decides
 * INDENTATION AND LINE BREAKS while a token cursor guarantees COVERAGE: every
 * token from `cursor` up to whatever the tree asks for next is emitted first,
 * whether or not any node claimed it.
 *
 * That cursor is why nothing can be dropped. It is not a promise, it is the
 * only path text takes.
 */

import { lineOfOffset } from "../../../parser/lineIndex";
import type {
  BlockNode,
  CommandNode,
  IfNode,
  Item,
  OrphanBlockNode,
  ParseResult,
  RandomNode,
  RawNode,
  SectionNode,
} from "../../../parser/types";
import { displayWidth, type FormatOptions } from "./options";
import type { GapWriter } from "./writer";

export interface LayoutStats {
  /** Blocks that were on one line and stayed there. */
  inlineKept: number;
  /** Blocks that were spread over lines and stayed spread. */
  expandedKept: number;
  madeInline: number;
  madeExpanded: number;
  /**
   * Non-trivia tokens no AST node claimed. Should be 0, parser-design Sec.12's
   * coverage property says every one belongs to a node, so this is a census of
   * a thing believed impossible, handled rather than asserted because the
   * alternative to handling it is losing the token.
   */
  strayTokens: number;
}

/**
 * One position in a sibling list: an item, a comment run between items, or a
 * stray token. Comment runs are first-class here (and only here) because
 * Sec.4.4's comment groups are a relationship BETWEEN a comment and the
 * siblings after it, which is invisible if comments are only ever flushed as a
 * side effect of placing the next node.
 */
interface Entry {
  kind: "comment" | "item" | "stray";
  first: number;
  last: number;
  item?: Item;
  /**
   * Display column of the entry's first token, iff that token starts its
   * source line. `undefined` for a trailing comment or a second statement on
   * one line, which carry no indentation evidence.
   */
  col?: number;
}

type BlockShape = "inline" | "expanded";

export class Layout {
  private readonly parse: ParseResult;
  private readonly opts: FormatOptions;
  private readonly writer: GapWriter;
  private readonly unit: string;
  /** The next token index not yet placed. Only ever moves forward. */
  private cursor = 0;

  readonly stats: LayoutStats = {
    inlineKept: 0,
    expandedKept: 0,
    madeInline: 0,
    madeExpanded: 0,
    strayTokens: 0,
  };

  constructor(parse: ParseResult, opts: FormatOptions, writer: GapWriter, indentUnit: string) {
    this.parse = parse;
    this.opts = opts;
    this.writer = writer;
    this.unit = indentUnit;
  }

  // -------------------------------------------------------------------------
  // Source geometry
  // -------------------------------------------------------------------------

  private indent(level: number): string {
    return this.unit.repeat(Math.max(0, level));
  }

  private lineOf(offset: number): number {
    return lineOfOffset(this.parse.lineOffsets, offset);
  }

  /** The whitespace prefix of the source line `offset` falls on. */
  private sourceIndent(offset: number): string {
    const start = this.parse.lineOffsets[this.lineOf(offset)];
    return /^[ \t]*/.exec(this.parse.source.slice(start, offset))![0];
  }

  /** Display column of token `i`, or `undefined` if it does not start its line. */
  private startColumn(i: number): number | undefined {
    const offset = this.parse.tokens[i].start;
    const before = this.parse.source.slice(this.parse.lineOffsets[this.lineOf(offset)], offset);
    return /^[ \t]*$/.test(before) ? displayWidth(before) : undefined;
  }

  private blanksBefore(i: number): number {
    return Math.min(Math.max(this.writer.breaksBefore(i) - 1, 0), this.opts.maxBlankLines);
  }

  // -------------------------------------------------------------------------
  // Placement primitives. Everything below goes through these three, so the
  // cursor invariant holds in one place instead of at forty call sites.
  // -------------------------------------------------------------------------

  /**
   * Last token of ONE comment starting at `from`, bounded by `limit`.
   *
   * Not the maximal trivia run: one complete comment immediately followed by
   * another is two units, and has to be, or Sec.4.4 cannot see a heading
   * comment whose group begins with another comment, exactly the shape
   * 24hr_Battle Lines uses.
   *
   * Depth is recounted here rather than read off the lexer, which is an
   * approximation with a known and harmless error direction.
   * `LexOptions.commentOpenAliases` means a word can open a nested comment, and
   * this count does not know the alias set, so it can only ever run SHORT of
   * the true depth. Running short splits a unit early, which re-indents comment
   * text as though it were its own comment. Whitespace only, never content. The
   * `nestedComments: false` case can only make the count run long, which
   * degrades to treating the whole run as one unit.
   *
   * A trivia token that is not an opener at depth 0 (the byte-order mark, a
   * stray closing marker) is its own single-token unit.
   */
  private triviaUnitEnd(from: number, limit: number): number {
    let depth = 0;
    for (let i = from; i < limit; i++) {
      const token = this.parse.tokens[i];
      if (!token.isTrivia) return i - 1;
      if (token.kind === "commentOpen") depth++;
      else if (token.kind === "commentClose" && depth > 0) depth--;
      if (depth === 0) return i;
    }
    return limit - 1;
  }

  /**
   * Emit every token in `[cursor, limit)`. These are normally comments; a
   * non-trivia token here is a coverage hole and is emitted anyway.
   *
   * `mode: "sameLine"` forces attachment to the line in progress, for a comment
   * sitting inside something being laid out on one line.
   */
  private emitTrivia(limit: number, indent: string, mode: "auto" | "sameLine"): void {
    while (this.cursor < limit) {
      const i = this.cursor;
      const token = this.parse.tokens[i];
      if (!token.isTrivia) {
        this.emitStray(i, indent);
        continue;
      }
      const end = this.triviaUnitEnd(i, limit);
      // Shift the run's interior relative to the line it CAME from, so an
      // ASCII-art box keeps its shape (Sec.4.2).
      const oldIndent = this.sourceIndent(token.start);
      const last = this.writer.lastPlaced;
      const trailing =
        mode === "sameLine" ||
        (last >= 0 && this.lineOf(this.parse.tokens[last].end) === this.lineOf(token.start));

      if (trailing) this.writer.placeSameLine(i);
      else this.writer.placeOnLine(i, indent, this.blanksBefore(i));

      const newIndent = this.writer.currentIndent;
      for (let k = i + 1; k <= end; k++) this.writer.placeVerbatim(k, oldIndent, newIndent);
      this.cursor = end + 1;
    }
  }

  private emitStray(i: number, indent: string): void {
    this.stats.strayTokens++;
    this.writer.placeOnLine(i, indent, this.blanksBefore(i));
    this.cursor = i + 1;
  }

  /** Flush pending comments, then put token `i` at the head of a new line. */
  private startLine(i: number, indent: string, atLeastBlank = 0): void {
    this.emitTrivia(i, indent, "auto");
    this.writer.placeOnLine(i, indent, Math.max(this.blanksBefore(i), atLeastBlank));
    this.cursor = i + 1;
  }

  /** Flush pending comments onto this line, then put token `i` on it too. */
  private sameLine(i: number): void {
    this.emitTrivia(i, this.writer.currentIndent, "sameLine");
    this.writer.placeSameLine(i);
    this.cursor = i + 1;
  }

  private runSameLine(from: number, to: number): void {
    for (let i = from; i <= to; i++) this.sameLine(i);
  }

  private sameSourceLineAsPrevious(i: number): boolean {
    return i > 0 && this.lineOf(this.parse.tokens[i - 1].end) === this.lineOf(this.parse.tokens[i].start);
  }

  /**
   * Start a line for token `i`, UNLESS the author had it continuing the
   * previous line, in which case keep it there. Sec.3's preservation principle
   * one level below a command block.
   *
   * The case this exists for is everywhere in the DE official maps:
   *
   *     percent_chance 50 #define TWO_A
   *     percent_chance 50 #define TWO_B
   *
   * A branch body on the keyword's own line is the same authorial choice as a
   * command on one line, space, when the alternative is four lines saying one
   * thing, and splitting it is the same kind of damage.
   *
   * Off under `blockLayout: "expanded"`, which is the "normalise everything"
   * setting, and off for the DIRECT items of an expanded block, where one
   * statement per line IS the shape being asked for.
   */
  private placeStatement(i: number, indent: string, allowContinuation: boolean): void {
    if (allowContinuation && this.opts.blockLayout !== "expanded" && this.writer.lastPlaced >= 0 && this.sameSourceLineAsPrevious(i)) {
      this.sameLine(i);
      return;
    }
    this.startLine(i, indent);
  }

  // -------------------------------------------------------------------------
  // Sibling lists and comment groups (Sec.4.4)
  // -------------------------------------------------------------------------

  private buildEntries(items: readonly Item[], endTok: number): Entry[] {
    const entries: Entry[] = [];
    let tok = this.cursor;

    const fill = (limit: number) => {
      while (tok < limit) {
        if (this.parse.tokens[tok].isTrivia) {
          const end = this.triviaUnitEnd(tok, limit);
          entries.push({ kind: "comment", first: tok, last: end, col: this.startColumn(tok) });
          tok = end + 1;
        } else {
          entries.push({ kind: "stray", first: tok, last: tok, col: this.startColumn(tok) });
          tok++;
        }
      }
    };

    for (const item of items) {
      fill(item.firstToken);
      entries.push({ kind: "item", first: item.firstToken, last: item.lastToken, item, col: this.startColumn(item.firstToken) });
      tok = Math.max(tok, item.lastToken + 1);
    }
    fill(endTok);
    return entries;
  }

  /**
   * A comment that starts its line and is followed by siblings indented deeper
   * than it owns those siblings, and they go one level in.
   *
   * Safe BECAUSE it is a sibling-list rule. Everything in one list sits at the
   * same structural depth, so structural indentation is constant across it and
   * any leftover difference in source column is the author's. A line-based
   * version of this rule reads a command's own indented block as a group.
   */
  private emitEntries(entries: readonly Entry[], level: number, allowContinuation: boolean): void {
    let i = 0;
    while (i < entries.length) {
      const entry = entries[i];
      this.emitEntry(entry, level, allowContinuation);
      i++;

      const openedAt = entry.col;
      if (!this.opts.commentGroups || entry.kind !== "comment" || openedAt === undefined) continue;

      let j = i;
      while (j < entries.length) {
        const col = entries[j].col;
        // No column evidence (a trailing comment, a second statement on one
        // line): it belongs with whatever it follows, so it never ends a group
        // and never starts one.
        if (col === undefined) {
          if (j === i) break;
          j++;
          continue;
        }
        if (col > openedAt) {
          j++;
          continue;
        }
        break;
      }
      if (j > i) {
        this.emitEntries(entries.slice(i, j), level + 1, allowContinuation);
        i = j;
      }
    }
  }

  private emitEntry(entry: Entry, level: number, allowContinuation: boolean): void {
    const indent = this.indent(level);
    if (entry.kind === "comment") {
      this.emitTrivia(entry.last + 1, indent, "auto");
      return;
    }
    if (entry.kind === "stray") {
      this.emitTrivia(entry.first, indent, "auto");
      this.emitStray(entry.first, indent);
      return;
    }
    this.emitItem(entry.item!, level, allowContinuation);
  }

  /**
   * `allowContinuation` is false for the DIRECT items of an expanded block, and
   * true everywhere else, including for an `if` body nested inside an expanded
   * block, where `if TINY_MAP base_size 2 else base_size 3 endif` on one line is
   * a shape real scripts use and the block's own layout has nothing to say
   * about it.
   */
  private emitList(items: readonly Item[], endTok: number, level: number, allowContinuation = true): void {
    this.emitEntries(this.buildEntries(items, endTok), level, allowContinuation);
    // Trailing comments inside a container belong to the container, so they are
    // flushed at the INNER indent before the caller writes `}` / `endif`.
    this.emitTrivia(endTok, this.indent(level), "auto");
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  private emitItem(item: Item, level: number, allowContinuation: boolean): void {
    switch (item.kind) {
      case "attribute":
      case "directive":
        this.placeStatement(item.firstToken, this.indent(level), allowContinuation);
        this.runSameLine(this.cursor, item.lastToken);
        break;
      case "command":
        this.emitCommand(item, level, allowContinuation);
        break;
      case "if":
        this.emitIf(item, level, allowContinuation);
        break;
      case "random":
        this.emitRandom(item, level, allowContinuation);
        break;
      case "orphanBlock":
        this.emitOrphanBlock(item, level, allowContinuation);
        break;
      case "raw":
        this.emitRaw(item, level, allowContinuation);
        break;
    }
  }

  private emitCommand(cmd: CommandNode, level: number, allowContinuation: boolean): void {
    const indent = this.indent(level);
    if (cmd.block && this.shapeFor(cmd, cmd.block, level) === "inline") {
      this.placeStatement(cmd.firstToken, indent, allowContinuation);
      this.runSameLine(this.cursor, cmd.lastToken);
      return;
    }
    const headerEnd = cmd.block ? cmd.block.open - 1 : cmd.lastToken;
    this.placeStatement(cmd.firstToken, indent, allowContinuation);
    this.runSameLine(this.cursor, headerEnd);
    if (cmd.block) this.emitBlockExpanded(cmd.block, level, cmd.firstToken, headerEnd);
  }

  private emitOrphanBlock(node: OrphanBlockNode, level: number, allowContinuation: boolean): void {
    if (this.shapeFor(node, node.block, level) === "inline") {
      this.placeStatement(node.firstToken, this.indent(level), allowContinuation);
      this.runSameLine(this.cursor, node.lastToken);
      return;
    }
    // No header, so `braceStyle: sameLine` has nothing to join: open - 1 < open
    // is the "there is no header" signal `braceOnHeaderLine` reads.
    this.emitBlockExpanded(node.block, level, node.block.open, node.block.open - 1);
  }

  private emitBlockExpanded(block: BlockNode, level: number, headerFirst: number, headerEnd: number): void {
    const indent = this.indent(level);
    if (this.braceOnHeaderLine(block, headerFirst, headerEnd)) this.sameLine(block.open);
    else this.startLine(block.open, indent);

    this.emitList(block.items, block.close ?? block.lastToken + 1, level + 1, false);
    // An unclosed block has no `}` to write, and the formatter never invents
    // one, it is not a fixer.
    if (block.close !== undefined) this.startLine(block.close, indent);
  }

  private braceOnHeaderLine(block: BlockNode, headerFirst: number, headerEnd: number): boolean {
    if (headerEnd < headerFirst) return false;
    switch (this.opts.braceStyle) {
      case "sameLine":
        return true;
      case "ownLine":
        return false;
      case "preserve": {
        // Preserve only where there is something to preserve. A block that was
        // on ONE line in the source carries no evidence about where its author
        // would have put the brace had they expanded it, and reading its
        // `create_land {` as evidence produces that shape for every block the
        // user just asked to be expanded. With no evidence, fall back to the
        // corpus majority: 4,307 own-line against 1,110 on the header line.
        const close = block.close;
        if (close === undefined || this.lineOf(this.parse.tokens[block.open].start) === this.lineOf(this.parse.tokens[close].start)) {
          return false;
        }
        return this.lineOf(this.parse.tokens[headerEnd].start) === this.lineOf(this.parse.tokens[block.open].start);
      }
    }
  }

  private emitIf(node: IfNode, level: number, allowContinuation: boolean): void {
    const indent = this.indent(level);
    const inner = level + (this.opts.indentConditionals ? 1 : 0);
    for (let k = 0; k < node.branches.length; k++) {
      const branch = node.branches[k];
      // The `if` itself obeys the enclosing list; `elseif`/`else`/`endif` are
      // internal to the construct, so their own line relationship is the one
      // that matters and the enclosing flag has no say.
      this.placeStatement(branch.keyword, indent, k === 0 ? allowContinuation : true);
      if (branch.condition !== undefined) this.runSameLine(this.cursor, branch.condition);
      const next = node.branches[k + 1]?.keyword ?? node.endif ?? node.lastToken + 1;
      this.emitList(branch.items, next, inner);
    }
    if (node.endif !== undefined) this.placeStatement(node.endif, indent, true);
  }

  private emitRandom(node: RandomNode, level: number, allowContinuation: boolean): void {
    const indent = this.indent(level);
    const step = this.opts.indentConditionals ? 1 : 0;
    this.placeStatement(node.start, indent, allowContinuation);

    const firstBranch = node.branches[0]?.chanceKeyword ?? node.end ?? node.lastToken + 1;
    this.emitList(node.preamble, firstBranch, level + step);

    for (let k = 0; k < node.branches.length; k++) {
      const branch = node.branches[k];
      this.placeStatement(branch.chanceKeyword, this.indent(level + step), true);
      if (branch.chance) this.runSameLine(this.cursor, branch.chance.lastToken);
      const next = node.branches[k + 1]?.chanceKeyword ?? node.end ?? node.lastToken + 1;
      this.emitList(branch.items, next, level + step * 2);
    }
    if (node.end !== undefined) this.placeStatement(node.end, indent, true);
  }

  /**
   * A run of tokens the parser could not read. Reproduced VERBATIM apart from
   * its first line's indent, laying out something we did not understand is how
   * a formatter corrupts a file it should have left alone.
   */
  private emitRaw(node: RawNode, level: number, allowContinuation: boolean): void {
    const oldIndent = this.sourceIndent(this.parse.tokens[node.firstToken].start);
    this.placeStatement(node.firstToken, this.indent(level), allowContinuation);
    const newIndent = this.writer.currentIndent;
    for (let i = node.firstToken + 1; i <= node.lastToken; i++) {
      this.writer.placeVerbatim(i, oldIndent, newIndent);
      this.cursor = i + 1;
    }
  }

  // -------------------------------------------------------------------------
  // Inline vs expanded (Sec.3)
  // -------------------------------------------------------------------------

  private sourceIsInline(node: CommandNode | OrphanBlockNode): boolean {
    return (
      this.lineOf(this.parse.tokens[node.firstToken].start) === this.lineOf(this.parse.tokens[node.lastToken].start)
    );
  }

  /**
   * Whether this node CAN go on one line without losing anything.
   *
   * The test is exactly "is there a line break in a gap we would reproduce
   * verbatim", because verbatim gaps are the only ones the layout cannot
   * choose: the interior of a multi-line comment and the interior of a
   * multi-line `RawNode`. Everything else is ours to collapse.
   */
  private canInline(node: CommandNode | OrphanBlockNode, block: BlockNode): boolean {
    if (block.close === undefined) return false;
    for (let i = node.firstToken + 1; i <= node.lastToken; i++) {
      const inCommentInterior = this.parse.tokens[i].isTrivia && this.parse.tokens[i - 1].isTrivia;
      if (inCommentInterior && this.writer.breaksBefore(i) > 0) return false;
    }
    return !this.hasMultiLineRaw(block.items);
  }

  private hasMultiLineRaw(items: readonly Item[]): boolean {
    for (const item of items) {
      if (item.kind === "raw") {
        if (this.lineOf(item.span.start) !== this.lineOf(this.parse.tokens[item.lastToken].start)) return true;
      } else if (item.kind === "command") {
        if (item.block && this.hasMultiLineRaw(item.block.items)) return true;
      } else if (item.kind === "if") {
        for (const b of item.branches) if (this.hasMultiLineRaw(b.items)) return true;
      } else if (item.kind === "random") {
        if (this.hasMultiLineRaw(item.preamble)) return true;
        for (const b of item.branches) if (this.hasMultiLineRaw(b.items)) return true;
      } else if (item.kind === "orphanBlock") {
        if (this.hasMultiLineRaw(item.block.items)) return true;
      }
    }
    return false;
  }

  private hasNonAttributeItems(block: BlockNode): boolean {
    return block.items.some((item) => item.kind !== "attribute");
  }

  /** The resolved command name, so `#const L 32` + `L { … }` reads as create_land. */
  private commandName(node: CommandNode | OrphanBlockNode): string | undefined {
    if (node.kind !== "command") return undefined;
    return node.def?.name ?? this.parse.tokens[node.name].text;
  }

  private inlineWidth(node: CommandNode | OrphanBlockNode, level: number): number {
    let width = displayWidth(this.indent(level));
    for (let i = node.firstToken; i <= node.lastToken; i++) {
      if (i > node.firstToken) {
        const gap = this.writer.origGap(i);
        const keep = this.opts.intraLineSpacing === "preserve" && !/[\r\n]/.test(gap);
        width += keep ? displayWidth(gap) : 1;
      }
      width += displayWidth(this.parse.tokens[i].text);
    }
    return width;
  }

  private wantsInline(node: CommandNode | OrphanBlockNode, block: BlockNode, level: number): boolean {
    const name = this.commandName(node);
    // Expand wins a tie. A manifest cannot express a cross-param constraint, so
    // the rule is documented (options.ts) rather than validated.
    if (name !== undefined && this.opts.alwaysExpand.includes(name)) return false;
    if (name !== undefined && this.opts.alwaysInline.includes(name)) return true;

    switch (this.opts.blockLayout) {
      case "preserve":
        return this.sourceIsInline(node);
      case "expanded":
        return false;
      // `inline` and `compact` decline to CREATE a one-liner out of a block
      // holding a conditional; `preserve` keeps one the author wrote. Preserving
      // is faithful, imposing is opinionated, and 810 of the corpus's 11,226
      // one-line blocks hold a conditional.
      case "inline":
        return !this.hasNonAttributeItems(block);
      case "compact":
        return !this.hasNonAttributeItems(block) && this.inlineWidth(node, level) <= this.opts.inlineMaxWidth;
    }
  }

  private shapeFor(node: CommandNode | OrphanBlockNode, block: BlockNode, level: number): BlockShape {
    const shape: BlockShape = this.canInline(node, block) && this.wantsInline(node, block, level) ? "inline" : "expanded";
    const was = this.sourceIsInline(node);
    if (was && shape === "inline") this.stats.inlineKept++;
    else if (!was && shape === "expanded") this.stats.expandedKept++;
    else if (shape === "inline") this.stats.madeInline++;
    else this.stats.madeExpanded++;
    return shape;
  }

  // -------------------------------------------------------------------------
  // Sections (Sec.5.0)
  // -------------------------------------------------------------------------

  /**
   * The indent level a section's BODY starts at: 0 flush with the header, or 1
   * stepped in under it.
   *
   * Both are live conventions and neither is a majority; 88 of 265 corpus
   * section bodies are indented, 13 scripts do it in every section (eleven of
   * them DE official) against 33 that never do (options.ts's
   * `SectionIndentPolicy`). Flattening `local/Arena.rms` moved 4,746 of its
   * 5,403 lines at the all-preserve default, which is the one thing this
   * design set out not to do.
   *
   * Classified PER SECTION rather than per file, for the same reason
   * `braceStyle: preserve` is per block: the three mixed scripts then keep
   * both halves of what they wrote, and the answer needs no whole-file pass.
   *
   * The test is the MINIMUM column over everything in the section that starts
   * a line, not the first thing's. Two reasons, and the second is why this
   * counts TOKENS rather than `section.items`:
   *
   * - A leading comment group (Sec.4.4) indents its members, so "the first
   *   item is indented" is true of a flat section that merely opens with one.
   *   Only a minimum can tell a stepped-in body from a group inside a flat one.
   * - A comment is not an `Item`, and a heading comment at column 0 is exactly
   *   as much evidence as a command at column 0, it is the shape
   *   `24hr_Battle Lines 1.0.rms` uses, where every item is indented under a
   *   comment that is not.
   *
   * The interior lines of a multi-line comment are excluded, same rule and
   * same reason as `evidenceLines` in options.ts: an ASCII-art box is prose.
   *
   * Idempotent by construction: the output indents those same lines by exactly
   * one unit, so a re-run re-detects `indented` and emits the same text.
   */
  private sectionLevel(section: SectionNode, endTok: number): number {
    switch (this.opts.sectionIndent) {
      case "flat":
        return 0;
      case "indented":
        return 1;
      case "preserve": {
        let sawEvidence = false;
        for (let i = section.header + 1; i < endTok; i++) {
          if (this.parse.tokens[i].isTrivia && this.parse.tokens[i - 1].isTrivia) continue;
          const column = this.startColumn(i);
          if (column === undefined) continue;
          if (column === 0) return 0;
          sawEvidence = true;
        }
        return sawEvidence ? 1 : 0;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entry point
  // -------------------------------------------------------------------------

  run(): void {
    const script = this.parse.script;
    const end = this.parse.tokens.length;
    const firstSection = script.sections[0]?.header ?? end;

    this.emitList(script.preamble, firstSection, 0);

    for (let k = 0; k < script.sections.length; k++) {
      const section = script.sections[k];
      const next = script.sections[k + 1]?.header ?? end;
      const blank = this.opts.blankLineBeforeSections && this.writer.lastPlaced >= 0 ? 1 : 0;
      // The HEADER is always at column 0. Its body may or may not be, see
      // sectionLevel.
      this.startLine(section.header, "", blank);
      this.emitList(section.items, next, this.sectionLevel(section, next));
    }

    // Anything left, trailing comments, and a stray the tree never reached.
    this.emitTrivia(end, "", "auto");
  }
}
