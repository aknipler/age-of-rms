import { describe, expect, it } from "vitest";
import { tokenize } from "../lexer";
import { walkComments, type CommentMarker } from "../commentWalk";

const MARKERS: Record<string, CommentMarker> = {
  SHORE_FISH: "open",
  HOUSE: "close",
};
const markerOf = (word: string) => MARKERS[word];

const walk = (src: string) => walkComments(tokenize(src).tokens, markerOf);

describe("walkComments", () => {
  it("reads a plain comment with both arrays agreeing and no hits", () => {
    const w = walk("a /* b */ c");
    expect(w.comments).toEqual([{ start: 1, end: 3 }]);
    expect([...w.gameComment]).toEqual([0, 1, 1, 1, 0]);
    expect([...w.writtenComment]).toEqual([0, 1, 1, 1, 0]);
    expect(w.hits).toEqual([]);
  });

  it("ends the Chaotic Strait shape on the second closing word", () => {
    // tokens: 0 /*  1 /*  2 SHORE_FISH  3 */  4 HOUSE  5 HOUSE  6 a  7 */  8 b
    const w = walk("/* /* SHORE_FISH */ HOUSE HOUSE a */ b");
    expect(w.comments).toEqual([{ start: 0, end: 5 }]);
    expect(w.hits.map((h) => [h.index, h.marker, h.depthAfter])).toEqual([
      [2, "open", 3],
      [4, "close", 1],
      [5, "close", 0],
    ]);
    // `a` is live to the game and still inside the written comment. `b` is
    // live to both. The stray closer on token 7 counts as comment for both.
    expect(w.gameComment[6]).toBe(0);
    expect(w.writtenComment[6]).toBe(1);
    expect(w.gameComment[8]).toBe(0);
    expect(w.writtenComment[8]).toBe(0);
    expect(w.gameComment[7]).toBe(1);
  });

  it("leaves a comment open to the end of the file when an opener is never closed", () => {
    const w = walk("/* SHORE_FISH */ x");
    expect(w.comments).toEqual([{ start: 0, end: null }]);
    expect(w.gameComment[3]).toBe(1);
  });

  it("starts a second comment once the depth has returned to 0", () => {
    const w = walk("/* HOUSE */ /* HOUSE */");
    expect(w.comments).toHaveLength(2);
    // tokens: 0 /*  1 HOUSE  2 */ (stray)  3 /*  4 HOUSE  5 */ (stray)
    expect(w.comments.map((c) => [c.start, c.end])).toEqual([
      [0, 1],
      [3, 4],
    ]);
  });
});
