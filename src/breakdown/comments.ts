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
import type { Span, Token } from "../parser/types";

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
 * Comments whose span falls strictly between two consecutive items in
 * `items`, the only placement BlockList could attribute to itself
 * unambiguously without knowing its container's own boundaries. A comment
 * before the very first item of a list is still out of scope (nothing
 * inserts one there). A comment AFTER the last item is now included too,
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
