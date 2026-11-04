// A second, independent reading of where the game's comments are, for the
// validator. Pure: it imports only types, so it runs in the parser worker, in
// plain Node and in Vitest alike (parser-design Sec.14).
//
// Why this exists beside the lexer's `markComments`. The lexer models comment
// markers only for the words its caller hands it (`commentOpenAliases`,
// `commentCloseAliases`), and the parse given to `validate` may have been made
// with no such sets at all, every test in `validate.test.ts` is. RMS0111,
// RMS0112 and RMS0113 all need the depth the GAME sees, so they walk the tokens
// themselves and ask `markerOf` about each word inside a comment. The lexer and
// this walk are pinned to each other by a corpus test, which is what keeps the
// two from drifting.
//
// The one place they disagree on purpose is the byte-order mark. The lexer
// emits it as trivia on its own account and the walk does not mark it.
//
// Comments nest here, as they do by default in the lexer and in the game.

import type { Token } from "./types";

/** What a word inside a comment does to the game's comment depth. */
export type CommentMarker = "open" | "close";

/** One comment as the game reads it, from the token that opens it to the token that brings the depth back to 0. */
export interface GameComment {
  start: number;
  /** Token index where the depth returns to 0, or null when it runs to the end of the file. */
  end: number | null;
}

export interface CommentWalk {
  /** Per token, 1 when the game reads it as part of a comment, markers and stray closes included. */
  gameComment: Uint8Array;
  /** Per token, 1 when the written markers alone put it inside a comment, the same marking with no words resolved. */
  writtenComment: Uint8Array;
  comments: GameComment[];
  /** Every word that acted as a marker, in order. `comment` indexes `comments`. */
  hits: {
    index: number;
    marker: CommentMarker;
    depthAfter: number;
    comment: number;
  }[];
}

export function walkComments(
  tokens: readonly Token[],
  markerOf: (word: string) => CommentMarker | undefined,
): CommentWalk {
  const gameComment = new Uint8Array(tokens.length);
  const writtenComment = new Uint8Array(tokens.length);
  const comments: GameComment[] = [];
  const hits: CommentWalk["hits"] = [];
  // Two counters. `written` sees only the markers an author typed, `game` also
  // sees the words the engine resolves to a marker.
  let game = 0;
  let written = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === "commentOpen") {
      if (game === 0) comments.push({ start: i, end: null });
      game++;
      written++;
      gameComment[i] = 1;
      writtenComment[i] = 1;
      continue;
    }
    if (token.kind === "commentClose") {
      gameComment[i] = 1;
      writtenComment[i] = 1;
      if (written > 0) written--;
      if (game > 0) {
        game--;
        if (game === 0) comments[comments.length - 1].end = i;
      }
      continue;
    }

    if (written > 0) writtenComment[i] = 1;
    if (game === 0) continue;
    gameComment[i] = 1;
    if (token.kind !== "word") continue;
    const marker = markerOf(token.text);
    if (marker === undefined) continue;
    if (marker === "open") {
      game++;
    } else {
      game--;
      if (game === 0) comments[comments.length - 1].end = i;
    }
    hits.push({
      index: i,
      marker,
      depthAfter: game,
      comment: comments.length - 1,
    });
  }

  return { gameComment, writtenComment, comments, hits };
}
