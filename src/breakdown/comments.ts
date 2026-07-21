// Ash's follow-up ask: "show comments in Breakdown too." RMS's only
// comment syntax is /* */ (docs/parser-design.md §2); the lexer's
// comment-span pass marks every token inside one — including nested /* */
// when nestedComments is on — as `isTrivia`, and the parser then skips
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
 * rather than being dropped — same "never silently drop content" rule
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
    comments.push({ start, end: lastToken ? Math.max(lastToken.end, start) : start });
  }
  return comments;
}

/**
 * Comments whose span falls strictly between two consecutive items in
 * `items` — the only placement BlockList can attribute to itself
 * unambiguously without knowing its container's own boundaries (a
 * comment before the very first item of a list, or after the very last,
 * is out of scope for v1 — see comments.ts's own module doc and the
 * build log for the reasoning). Returned as a map from `i` (the index of
 * the item the comments render AFTER) to the comments in that gap, in
 * source order.
 */
export function commentsBetweenItems(
  items: readonly { span: Span }[],
  allComments: readonly Span[],
): Map<number, Span[]> {
  const byIndex = new Map<number, Span[]>();
  for (let i = 0; i < items.length - 1; i++) {
    const gapStart = items[i].span.end;
    const gapEnd = items[i + 1].span.start;
    const inGap = allComments.filter((c) => c.start >= gapStart && c.end <= gapEnd);
    if (inGap.length > 0) byIndex.set(i, inGap);
  }
  return byIndex;
}
