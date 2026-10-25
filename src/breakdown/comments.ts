// Show comments in Breakdown too. RMS's only
// comment syntax is /* */ (docs/parser-design.md Sec.2); the lexer's
// comment-span pass marks every token inside one, including nested /* */
// when nestedComments is on, as `isTrivia`, and the parser then skips
// trivia tokens entirely when building the AST. That makes comments
// genuinely invisible outside the Code tab: there's no Item, no node, no
// span recorded anywhere in ParseResult beyond the raw token stream.
// Reconstructing comment spans here (from `parseResult.tokens`, which IS
// still available) is what lets Breakdown show them at all. Kept
// pure/framework-free, same convention as ephemeralAnchors.ts/
// selectionResolve.ts.
import type {
  CommandNode,
  Item,
  ParseResult,
  Span,
  Token,
} from "../parser/types";

/**
 * Re-derives each TOP-LEVEL (outermost) comment's full span by re-pairing
 * commentOpen/commentClose among trivia tokens with the same
 * nesting-depth counter the lexer's own comment-span pass uses. An
 * unclosed comment (the parser already raised its own diagnostic for
 * this) still gets a span through the end of whatever trivia exists,
 * rather than being dropped, same "never silently drop content" rule
 * the rest of Breakdown follows for raw/orphan regions.
 */
export function extractComments(tokens: readonly Token[]): Span[] {
  const comments: Span[] = [];
  let depth = 0;
  let start = -1;
  for (const token of tokens) {
    if (!token.isTrivia) continue;
    if (token.kind === "commentOpen") {
      if (depth === 0) start = token.start;
      depth++;
    } else if (token.kind === "commentClose") {
      if (depth === 0) continue; // stray close, already diagnosed by the lexer
      depth--;
      if (depth === 0 && start !== -1) {
        comments.push({ start, end: token.end });
        start = -1;
      }
    }
  }
  if (depth > 0 && start !== -1) {
    const lastToken = tokens[tokens.length - 1];
    comments.push({
      start,
      end: lastToken ? Math.max(lastToken.end, start) : start,
    });
  }
  return comments;
}

/**
 * The comment anchored at exactly this offset, the same exact-match lookup
 * findItemAtOffset does for an Item's own span.start (selectionResolve.ts).
 * CommentCard's `data-anchor` is always a comment's own span.start (never an
 * interior offset), so an exact match is enough, unlike findItemAtOffset's
 * range test, which also has to resolve an offset that lands inside a
 * nested branch. Used by cardDrag.tsx to resolve a drop target onto a
 * comment card once findItemAtOffset itself comes back empty.
 */
export function findCommentAtOffset(
  comments: readonly Span[],
  offset: number,
): Span | undefined {
  return comments.find((c) => c.start === offset);
}

/**
 * Comments whose span falls strictly between two consecutive items in
 * `items`, the only placement BlockList could attribute to itself
 * unambiguously without knowing its container's own boundaries. A comment
 * before the very first item of a list is leadingComments' job (below). A
 * comment AFTER the last item is now included too,
 * when the caller passes `boundaryEnd`, the offset of whatever closes
 * this container (a block's `}`, a branch's terminator keyword, the next
 * SectionNode's header, or EOF), so a trailing comment genuinely inside
 * this container isn't confused with one that starts the next construct.
 * Every BlockList call site now has that offset in hand for the same
 * reason computeEdit's own insert helpers do (Sec.4.5): appending a new
 * comment/command has to know exactly where "the end of this container"
 * is. Stored at index `items.length - 1`, the one slot the loop below
 * never writes (`i` stops at `items.length - 2`), which is also exactly
 * where BlockList already renders the gap after the last item.
 */
export function commentsBetweenItems(
  items: readonly { span: Span }[],
  allComments: readonly Span[],
  boundaryEnd?: number,
): Map<number, Span[]> {
  const byIndex = new Map<number, Span[]>();
  for (let i = 0; i < items.length - 1; i++) {
    const gapStart = items[i].span.end;
    const gapEnd = items[i + 1].span.start;
    const inGap = allComments.filter(
      (c) => c.start >= gapStart && c.end <= gapEnd,
    );
    if (inGap.length > 0) byIndex.set(i, inGap);
  }
  if (boundaryEnd !== undefined && items.length > 0) {
    const gapStart = items[items.length - 1].span.end;
    const trailing = allComments.filter(
      (c) => c.start >= gapStart && c.end <= boundaryEnd,
    );
    if (trailing.length > 0) byIndex.set(items.length - 1, trailing);
  }
  return byIndex;
}

// Comments before the first item of a list, or every comment in a list with
// no items (2026-10-22). These used to be left out on the grounds that
// nothing in Breakdown wrote one there. Commenting out a card does, so
// commenting out the first command of a section, or the only one in a
// branch, would have made it vanish from Breakdown with no way to bring it
// back from there.
//
// The region starts after the last real token before the list. Nothing of
// this list sits between that token and the first item (or `boundaryEnd`
// for an empty list), so the token is whatever opens the container: the
// section header, `{`, the condition of an `if` or `elseif`, a
// percent_chance operand. For the Header tab it is the start of the file.
// The regions of two lists never meet, since each starts after its own
// opener and the gaps of the list outside lie outside the container's span.
export function leadingComments(
  items: readonly { span: Span }[],
  allComments: readonly Span[],
  tokens: readonly Token[],
  boundaryEnd?: number,
): Span[] {
  const end = items.length > 0 ? items[0].span.start : boundaryEnd;
  if (end === undefined) return [];
  // Binary search for the last token starting before `end`, since BlockList
  // calls this once per list on every render and a big map has thousands of
  // lists and a hundred thousand tokens. Tokens are in source order.
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].start < end) lo = mid + 1;
    else hi = mid;
  }
  let start = 0;
  for (let i = lo - 1; i >= 0; i--) {
    if (!tokens[i].isTrivia) {
      start = tokens[i].end;
      break;
    }
  }
  return allComments.filter((c) => c.start >= start && c.end <= end);
}

/** A comment card: its comment, the card list holding it, and the if, start_random or shared block that list belongs to (none for a section or the Header tab). */
export interface CommentCardPlace {
  span: Span;
  items: readonly Item[];
  container?: Item;
}

// Every comment Breakdown shows as a card, keyed by its start, with the list
// it shows in (2026-10-22, comment cards became selectable). The same walk
// BlockList and its call sites make, with the same boundaries: SectionView
// gives a section the next section's header (the first one for the Header
// tab), ConditionalCard and RandomCard give a branch the next branch's
// keyword or the closer, RawCard gives a shared block its `}`, and a random
// block's leading strip only shows while it has items. A comment that is
// not in this map (an inline one, one inside a command, one before the
// first percent_chance of an empty strip) has no card. The selection uses
// it to tell a comment card's anchor from any other offset, and a Shift
// click uses the list to find the run.
export function commentCardPlaces(
  parse: Pick<ParseResult, "script" | "tokens" | "source">,
  comments: readonly Span[],
): Map<number, CommentCardPlace> {
  const { script, tokens, source } = parse;
  const out = new Map<number, CommentCardPlace>();
  const at = (i: number | undefined) =>
    i === undefined ? undefined : tokens[i].start;
  const list = (
    items: readonly Item[],
    boundary: number | undefined,
    container?: Item,
  ) => {
    const inline = inlineCommentStarts(items, tokens, source);
    const shown =
      inline.size > 0 ? comments.filter((c) => !inline.has(c.start)) : comments;
    for (const c of leadingComments(items, shown, tokens, boundary))
      out.set(c.start, { span: c, items, container });
    for (const gap of commentsBetweenItems(items, shown, boundary).values())
      for (const c of gap) out.set(c.start, { span: c, items, container });
    for (const item of items) {
      if (item.kind === "if")
        item.branches.forEach((b, i) =>
          list(
            b.items,
            at(item.branches[i + 1]?.keyword) ?? at(item.endif),
            item,
          ),
        );
      else if (item.kind === "random") {
        if (item.preamble.length > 0)
          list(
            item.preamble,
            at(item.branches[0]?.chanceKeyword) ?? at(item.end),
            item,
          );
        item.branches.forEach((b, i) =>
          list(
            b.items,
            at(item.branches[i + 1]?.chanceKeyword) ?? at(item.end),
            item,
          ),
        );
      } else if (item.kind === "orphanBlock")
        list(item.block.items, at(item.block.close), item);
    }
  };
  const sections = script.sections;
  list(script.preamble, at(sections[0]?.header) ?? source.length);
  sections.forEach((s, i) =>
    list(s.items, at(sections[i + 1]?.header) ?? source.length),
  );
  return out;
}

// A command's inline comments (2026-10-21), the `/* top left island */` a
// person writes on the command's own line to say what it is for. A comment
// counts when no line break separates it from the command name (or from the
// argument or comment before it) and it sits before the block's `{`, or, for a command with no block, before the
// next real token. So `create_terrain FOREST /* c */` and the hand-written
// `create_terrain /* c */ FOREST` both count, while a comment on a later
// line between the name and a `{` on its own line does not (it stays
// invisible in Breakdown, as before).
//
// The two shapes differ in where the comment sits relative to the span. With
// a block the comment is inside the command's span, so nothing else in
// Breakdown ever showed it. With no block it trails the span, and BlockList
// used to render it as a CommentCard of its own, so BlockList now leaves the
// ones this returns out of its gaps (inlineCommentStarts below). Either way
// the comment already travels with the card on a move (computeEdit.ts's
// carriedRange takes same-line trailing trivia).
//
// The slot is read from the token stream alone, the same as extractComments,
// since comments are trivia with no node of their own. An unclosed comment
// never counts; it runs on past the slot and keeps whatever rendering it had.
export function inlineCommentsOf(
  command: CommandNode,
  tokens: readonly Token[],
  source: string,
): Span[] {
  let limit = source.length;
  if (command.block) {
    limit = tokens[command.block.open].start;
  } else {
    for (let i = command.lastToken + 1; i < tokens.length; i++) {
      if (!tokens[i].isTrivia) {
        limit = tokens[i].start;
        break;
      }
    }
  }
  const out: Span[] = [];
  let depth = 0;
  let start = -1;
  // The end of the last thing on the line so far. A comment counts while no
  // line break separates it from that, the same test carriedRange in
  // computeEdit.ts applies, so a block-less command's row shows exactly the
  // comments its delete and move take with it.
  let prevEnd = tokens[command.name].end;
  for (let i = command.name + 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.start >= limit) break;
    if (!t.isTrivia) {
      if (depth === 0) prevEnd = t.end;
      continue;
    }
    if (t.kind === "commentOpen") {
      if (depth === 0) start = t.start;
      depth++;
    } else if (t.kind === "commentClose" && depth > 0) {
      depth--;
      if (depth === 0) {
        if (source.slice(prevEnd, start).includes("\n")) break;
        out.push({ start, end: t.end });
        prevEnd = t.end;
        start = -1;
      }
    }
  }
  return out;
}

// Where a new inline comment goes: right after the command's last positional
// argument, or after its name when it has none. After the arguments rather
// than directly after the name, so `create_terrain FOREST` becomes
// `create_terrain FOREST /* note */` and the argument stays beside its
// command.
export function inlineCommentInsertOffset(
  command: CommandNode,
  tokens: readonly Token[],
): number {
  const lastArg = command.args[command.args.length - 1];
  return tokens[lastArg ? lastArg.lastToken : command.name].end;
}

// The starts of every inline comment trailing a block-less command in
// `items`. Those comments sit between items, so commentsBetweenItems would
// otherwise hand them to a CommentCard as well, and the same text would show
// twice. A block command's inline comments are inside its span and never
// reach a gap, so only block-less commands are read.
export function inlineCommentStarts(
  items: readonly Item[],
  tokens: readonly Token[],
  source: string,
): Set<number> {
  const starts = new Set<number>();
  for (const item of items) {
    if (item.kind !== "command" || item.block) continue;
    for (const c of inlineCommentsOf(item, tokens, source)) starts.add(c.start);
  }
  return starts;
}

// Keeps the comment delimiters whitespace-separated from whatever sits
// between them: the lexer is a plain whitespace splitter (Sec.2 above),
// so it only recognizes the opening and closing markers as their own
// tokens when a run of non-whitespace doesn't glue onto them. Given
// "hello" this returns " hello ", but given content that ALREADY carries
// its own leading or trailing whitespace (an intentional multi-line
// doc-comment block, say, that opens with a newline) it only pads
// whichever side is actually missing, so that formatting survives an
// edit untouched. computeEdit.ts's editComment case is the only caller,
// so every write through this app's own UI is safe regardless of what
// the user typed; CommentCard.tsx separately rejects text that embeds a
// literal comment marker, a content policy this function has no opinion
// on.
export function padCommentContent(text: string): string {
  if (text === "") return " ";
  const withLeading = /^\s/.test(text) ? text : ` ${text}`;
  return /\s$/.test(withLeading) ? withLeading : `${withLeading} `;
}
