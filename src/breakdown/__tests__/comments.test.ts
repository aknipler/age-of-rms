import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { extractComments, commentsBetweenItems } from "../comments";

// Ash's follow-up ask: "show comments in Breakdown too." Comments are
// pure trivia (parser-design §2) — extractComments re-derives their
// spans from the token stream, and commentsBetweenItems decides which
// items[] gap (if any) each one belongs to.
describe("extractComments", () => {
  const langData = loadLanguage();

  it("finds a single top-level comment", () => {
    const src = "<PLAYER_SETUP>\n/* hello */\nnomad_resources\n";
    const r = parseRms(src, langData);
    const comments = extractComments(r.tokens);
    expect(comments).toHaveLength(1);
    expect(src.slice(comments[0].start, comments[0].end)).toBe("/* hello */");
  });

  it("finds multiple separate comments", () => {
    const src = "<PLAYER_SETUP>\n/* one */\nnomad_resources\n/* two */\n";
    const r = parseRms(src, langData);
    const comments = extractComments(r.tokens);
    expect(comments).toHaveLength(2);
    expect(src.slice(comments[0].start, comments[0].end)).toBe("/* one */");
    expect(src.slice(comments[1].start, comments[1].end)).toBe("/* two */");
  });

  it("merges zero-gap adjacent comments into one span (lexer characteristic: the glued '*//*' between them tokenizes as one plain word, not a close+open pair, so the first comment never actually closes until the final '*/')", () => {
    const src = "<PLAYER_SETUP>\n/* a *//* b */\nnomad_resources\n";
    const r = parseRms(src, langData);
    const comments = extractComments(r.tokens);
    expect(comments).toHaveLength(1);
    expect(src.slice(comments[0].start, comments[0].end)).toBe("/* a *//* b */");
  });

  it("treats a nested comment as one outer span (default nestedComments: true)", () => {
    const src = "<PLAYER_SETUP>\n/* outer /* inner */ still outer */\nnomad_resources\n";
    const r = parseRms(src, langData);
    const comments = extractComments(r.tokens);
    expect(comments).toHaveLength(1);
    expect(src.slice(comments[0].start, comments[0].end)).toBe("/* outer /* inner */ still outer */");
  });

  it("returns an empty array when there are no comments", () => {
    const src = "<PLAYER_SETUP>\nnomad_resources\n";
    const r = parseRms(src, langData);
    expect(extractComments(r.tokens)).toEqual([]);
  });
});

describe("commentsBetweenItems", () => {
  it("attributes a comment to the gap between the two items it falls between", () => {
    const items = [
      { span: { start: 0, end: 5 } },
      { span: { start: 20, end: 25 } },
      { span: { start: 40, end: 45 } },
    ];
    const comments = [{ start: 10, end: 15 }]; // falls in the gap after item 0
    const result = commentsBetweenItems(items, comments);
    expect(result.get(0)).toEqual([{ start: 10, end: 15 }]);
    expect(result.has(1)).toBe(false);
  });

  it("does not attribute a comment before the first item or after the last (v1 scope limit)", () => {
    const items = [
      { span: { start: 20, end: 25 } },
      { span: { start: 40, end: 45 } },
    ];
    const leading = { start: 0, end: 5 };
    const trailing = { start: 50, end: 55 };
    const result = commentsBetweenItems(items, [leading, trailing]);
    expect(result.size).toBe(0);
  });

  it("handles multiple comments in the same gap, in source order", () => {
    const items = [
      { span: { start: 0, end: 5 } },
      { span: { start: 30, end: 35 } },
    ];
    const comments = [
      { start: 10, end: 15 },
      { start: 20, end: 25 },
    ];
    const result = commentsBetweenItems(items, comments);
    expect(result.get(0)).toEqual(comments);
  });
});
