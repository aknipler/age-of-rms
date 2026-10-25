import { useMemo } from "react";
import type { ParseResult, Span } from "../../parser/types";
import {
  BreakdownProvider,
  useBreakdownContext,
  type BreakdownContextValue,
} from "../BreakdownContext";
import { BlockList } from "../BlockList";
import { NoCardDrag } from "../cardDrag";
import { commentRangeEdit } from "../commentedCode";
import { computeEdit, editsOf } from "../patch/computeEdit";
import {
  PatchError,
  type CommentRef,
  type EditIntent,
  type EditResult,
} from "../patch/intents";
import styles from "./CommentCard.module.css";

// The cards of a comment whose text reads as RMS (2026-10-23,
// breakdown-design Sec.3.14). Every card component is reused unchanged. What
// makes it work is a second BreakdownProvider around them, whose context
// looks like a pane over the comment's own text.
//
// This is the React idiom of overriding a context for a subtree: the
// nearest provider wins, so the cards read `source`, `tokens` and
// `parseResult` from the comment's parse, and their edits come back through
// this context's `applyEdit`. That one runs the ordinary patch engine
// against the comment's parse, works out what the comment text becomes,
// and hands the outer pane one editComment for the part that changed. The
// alternative, a flag on every card saying "you are inside a comment", would
// spread one feature across a dozen components.
//
// Offsets are the one thing that cannot be shared as they are. The cards
// speak in offsets into the comment text, the pane in offsets into the
// document, so every member that carries one adds `innerStart` on the way
// out. Selection and dragging are not offered inside. A click selects the
// comment card itself, which is the unit that moves, deletes and
// uncomments.

export function CommentedCode({
  parse,
  innerStart,
  commentSpan,
}: {
  /** The comment text parsed on its own (commentedCode.ts). */
  parse: ParseResult;
  /** Document offset of the comment text's first character, just past the opening marker. */
  innerStart: number;
  /** The whole comment, markers included. */
  commentSpan: Span;
}) {
  const outer = useBreakdownContext();
  const value = useMemo<BreakdownContextValue>(() => {
    const toOuter = (s: Span): Span => ({
      start: s.start + innerStart,
      end: s.end + innerStart,
    });
    const commentRef: CommentRef = { kind: "comment", span: commentSpan };
    const applyEdit = (intent: EditIntent): EditResult | null => {
      let result: EditResult;
      try {
        result = computeEdit(parse, intent, outer.lang);
      } catch (err) {
        if (err instanceof PatchError) return null;
        throw err;
      }
      // editsOf lists the highest offset first, so splicing in that order
      // leaves the lower offsets valid.
      let next = parse.source;
      for (const edit of editsOf(result))
        next = next.slice(0, edit.start) + edit.newText + next.slice(edit.end);
      const range = commentRangeEdit(parse.source, next);
      if (!range) return null;
      const landed = outer.applyEdit({
        kind: "editComment",
        innerSpan: {
          start: innerStart + range.start,
          end: innerStart + range.end,
        },
        text: range.text,
      });
      if (!landed) return null;
      return { ...result, caret: range.mapNew(result.caret) };
    };
    return {
      ...outer,
      source: parse.source,
      tokens: parse.tokens,
      parseResult: parse,
      // Commented-out code never runs, so its problems are not the map's.
      diagnostics: [],
      // The text of one comment holds no other comment (a nested one keeps
      // the plain text view, CommentCard.tsx).
      comments: [],
      applyEdit,
      isExpanded: (s) => outer.isExpanded(toOuter(s)),
      toggleExpanded: (s) => outer.toggleExpanded(toOuter(s)),
      expandCard: (s) => outer.expandCard(toOuter(s)),
      collapseFromStrip: (s) => outer.collapseFromStrip(toOuter(s)),
      revealAfterEdit: (offset, scroll, expand) =>
        outer.revealAfterEdit(offset + innerStart, scroll, expand),
      requestFocus: (target) =>
        outer.requestFocus(
          typeof target === "number" ? target + innerStart : target,
        ),
      registerFocusable: (offset, el) =>
        outer.registerFocusable(offset + innerStart, el),
      isSelected: () => false,
      selectCard: () => outer.selectCard(commentSpan),
      selectedItem: undefined,
      clickCard: (_card, mode) =>
        outer.clickCard
          ? outer.clickCard(commentRef, mode)
          : outer.selectCard(commentSpan),
      selectedItems: [],
      selectedCards: [],
      selectedComment: undefined,
      // The card menu's Move and Duplicate, inside the comment's text.
      moveItem: (item, to) => {
        const result = applyEdit({ kind: "moveNode", node: item, to });
        if (result) outer.revealAfterEdit(result.caret + innerStart, true);
      },
      duplicateItem: (item) => {
        const result = applyEdit({ kind: "duplicateNode", node: item });
        if (result) outer.revealAfterEdit(result.caret + innerStart, true);
      },
      moveItems: undefined,
      deleteSelected: undefined,
      // Commenting out a card that is already inside a comment would nest
      // one, so the toggles are hidden in here (CommentCard.module.css).
      toggleCommentOut: undefined,
      // A commit note pairs an offset with the pane's source, which is not
      // this text, so names typed in here neither flash nor offer a #const.
      constNote: null,
      noteCommit: undefined,
      clearConstNote: undefined,
    };
  }, [outer, parse, innerStart, commentSpan]);

  return (
    <div className={styles.commentedCode}>
      <BreakdownProvider value={value}>
        <NoCardDrag>
          <BlockList
            items={parse.script.preamble}
            trailingBoundary={parse.source.length}
          />
        </NoCardDrag>
      </BreakdownProvider>
    </div>
  );
}
