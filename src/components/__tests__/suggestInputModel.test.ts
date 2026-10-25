import { describe, expect, it } from "vitest";
import { replaceWord, wordAtCaret } from "../suggestInputModel";

describe("wordAtCaret", () => {
  it("searches the part before the caret and replaces the whole run", () => {
    // GR|ASS: the caret sits inside the name.
    expect(wordAtCaret("GRASS", 2)).toEqual({ start: 0, end: 5, query: "GR" });
  });

  it("is empty when the caret touches no name", () => {
    expect(wordAtCaret("", 0)).toEqual({ start: 0, end: 0, query: "" });
    expect(wordAtCaret("A + ", 4)).toEqual({ start: 4, end: 4, query: "" });
  });

  it("stops at operators and parentheses, which are not part of a name", () => {
    expect(wordAtCaret("(MY_FOREST+5)", 10)).toEqual({
      start: 1,
      end: 10,
      query: "MY_FOREST",
    });
  });

  it("treats a number as part of the run, as a name can hold digits", () => {
    expect(wordAtCaret("GRASS2", 6).query).toBe("GRASS2");
  });

  it("clamps a caret outside the text", () => {
    expect(wordAtCaret("AB", 99).query).toBe("AB");
    expect(wordAtCaret("AB", -3).query).toBe("");
  });
});

describe("replaceWord", () => {
  it("replaces exactly the run and puts the caret after it", () => {
    const word = wordAtCaret("(GR + 5)", 3);
    expect(replaceWord("(GR + 5)", word, "GRASS")).toEqual({
      value: "(GRASS + 5)",
      caret: 6,
    });
  });

  it("does not double the tail when accepting in the middle of a name", () => {
    const word = wordAtCaret("GRASS", 2);
    expect(replaceWord("GRASS", word, "GRASS").value).toBe("GRASS");
  });
});
