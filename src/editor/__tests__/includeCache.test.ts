// The parser worker's include state (src/editor/includeCache.ts).

import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import {
  emptyIncludeState,
  indexFor,
  parseOptionsFor,
  receiveIncludes,
} from "../includeCache";

const lang = loadLanguage();
const parse = (text: string) => parseRms(text, lang);
const SCRIPT = "#include_drs a.inc\n<PLAYER_SETUP>\n";

describe("parseOptionsFor", () => {
  it("before any message, a script with an include is unread and has no names", () => {
    const state = emptyIncludeState(parse);
    expect(parseOptionsFor(state, SCRIPT)).toEqual({
      externalSymbols: new Set(),
      includesUnread: true,
    });
  });

  it("after the files arrive, the names are in and nothing is unread", () => {
    const state = receiveIncludes(
      emptyIncludeState(parse),
      new Map([
        ["a.inc", "#include_drs b.inc\n#const A 1\n"],
        ["b.inc", "#const B 2\n"],
      ]),
      ["a.inc", "b.inc"],
      parse,
    );
    const options = parseOptionsFor(state, SCRIPT);
    expect(options.includesUnread).toBe(false);
    expect([...options.externalSymbols].sort()).toEqual(["A", "B"]);
  });

  it("a key that was requested but is missing from the files is not unread", () => {
    const state = receiveIncludes(
      emptyIncludeState(parse),
      new Map(),
      ["a.inc"],
      parse,
    );
    expect(parseOptionsFor(state, SCRIPT).includesUnread).toBe(false);
  });

  it("a newly typed include that was never requested is unread", () => {
    const state = receiveIncludes(
      emptyIncludeState(parse),
      new Map([["a.inc", "#const A 1\n"]]),
      ["a.inc"],
      parse,
    );
    const typed = "#include_drs a.inc\n#include_drs new.inc\n";
    expect(parseOptionsFor(state, typed).includesUnread).toBe(true);
    expect(parseOptionsFor(state, SCRIPT).includesUnread).toBe(false);
  });

  it("no install found keeps a script with an include unread", () => {
    const state = receiveIncludes(emptyIncludeState(parse), null, [], parse);
    expect(parseOptionsFor(state, SCRIPT).includesUnread).toBe(true);
    expect(parseOptionsFor(state, "<PLAYER_SETUP>\n").includesUnread).toBe(
      false,
    );
  });
});

describe("receiveIncludes", () => {
  it("reuses the parse of an identical text and parses a changed one again", () => {
    const first = receiveIncludes(
      emptyIncludeState(parse),
      new Map([
        ["a.inc", "#const A 1\n"],
        ["b.inc", "#const B 1\n"],
      ]),
      ["a.inc", "b.inc"],
      parse,
    );
    const second = receiveIncludes(
      first,
      new Map([
        ["a.inc", "#const A 1\n"],
        ["b.inc", "#const B 2\n"],
      ]),
      ["a.inc", "b.inc"],
      parse,
    );
    expect(second.cache.get("a.inc")).toBe(first.cache.get("a.inc"));
    expect(second.cache.get("b.inc")).not.toBe(first.cache.get("b.inc"));
  });

  it("drops a cached file that left the set", () => {
    const first = receiveIncludes(
      emptyIncludeState(parse),
      new Map([["a.inc", "#const A 1\n"]]),
      ["a.inc"],
      parse,
    );
    const second = receiveIncludes(first, new Map(), ["a.inc"], parse);
    expect(second.cache.size).toBe(0);
  });
});

describe("indexFor", () => {
  it("is undefined before any message, and says no install for null files", () => {
    const result = parse(SCRIPT);
    expect(indexFor(emptyIncludeState(parse), result)).toBeUndefined();
    const none = receiveIncludes(emptyIncludeState(parse), null, [], parse);
    expect(indexFor(none, result)?.installFound).toBe(false);
  });

  it("builds from the cache", () => {
    const state = receiveIncludes(
      emptyIncludeState(parse),
      new Map([["a.inc", "#const A 1\n"]]),
      ["a.inc"],
      parse,
    );
    const index = indexFor(state, parse(SCRIPT))!;
    expect(index.installFound).toBe(true);
    expect(index.names.has("A")).toBe(true);
  });
});
