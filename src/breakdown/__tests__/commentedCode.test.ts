// 2026-10-23, the pure halves of three Breakdown readability changes:
// commented-out code (commentedCode.ts), the #const table's grouping
// (ConstTable.tsx) and Enter moving through a group of fields (enterNav.ts).

import { afterEach, describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../parser/language";
import { padCommentContent } from "../comments";
import { commentRangeEdit, parseCommentedCode } from "../commentedCode";
import {
  addedConstNameStart,
  freshTableName,
  segmentList,
} from "../constTableModel";
import {
  ENTER_ADD,
  ENTER_FIELD,
  ENTER_SCOPE,
  nextEnterTarget,
  resolveEnterTarget,
} from "../enterNav";

const rawLang = loadLanguage();
const lang = buildLanguageIndex(rawLang);

/** What editComment leaves behind for a range edit, the way computeEdit applies it. */
function applyRange(oldInner: string, newInner: string): string {
  const r = commentRangeEdit(oldInner, newInner);
  if (!r) throw new Error("refused");
  return (
    oldInner.slice(0, r.start) +
    padCommentContent(r.text) +
    oldInner.slice(r.end)
  );
}

describe("parseCommentedCode", () => {
  it("reads commands, directives and control flow as code", () => {
    expect(parseCommentedCode(" #const MY_A 1 ", lang)).not.toBeNull();
    expect(
      parseCommentedCode(" create_land { land_percent 10 } ", lang),
    ).not.toBeNull();
    expect(
      parseCommentedCode(" if LARGE_MAP\n random_placement\n endif ", lang),
    ).not.toBeNull();
  });

  it("reads a sentence as prose, even one that starts with a command name", () => {
    expect(
      parseCommentedCode(" Half the time, add a forest island ", lang),
    ).toBeNull();
    expect(
      parseCommentedCode(" random_placement is used here ", lang),
    ).toBeNull();
    expect(parseCommentedCode("   ", lang)).toBeNull();
  });

  it("leaves text with a section header as prose", () => {
    expect(
      parseCommentedCode(" <LAND_GENERATION> create_land { } ", lang),
    ).toBeNull();
  });
});

describe("commentRangeEdit", () => {
  const OLD = " create_land\n{\n  terrain_type DESERT\n  land_percent 10\n} ";

  it("replaces only around the changed value, never the command's start", () => {
    const next = OLD.replace("land_percent 10", "land_percent 25");
    const r = commentRangeEdit(OLD, next)!;
    // An expansion anchor sits on create_land's first character, and the
    // pane drops an anchor caught inside a replaced range. A whole-text
    // replacement starts at 0 and fails here.
    expect(r.start).toBeGreaterThan(OLD.indexOf("create_land"));
    expect(r.end).toBeLessThanOrEqual(OLD.indexOf("}"));
    expect(applyRange(OLD, next)).toBe(next);
  });

  it("lands exactly the new text for inserts and deletions in the middle", () => {
    const inserted = OLD.replace(
      "  land_percent 10\n",
      "  land_percent 10\n  base_size 5\n",
    );
    expect(applyRange(OLD, inserted)).toBe(inserted);
    const removed = OLD.replace("  terrain_type DESERT\n", "");
    expect(applyRange(OLD, removed)).toBe(removed);
  });

  it("maps an offset after a padded start through the added space", () => {
    // No space after the opening marker, so the range reaches offset 0 and
    // editComment pads it.
    const old = "MY_A 1 ";
    const next = "MY_B 1 ";
    const r = commentRangeEdit(old, next)!;
    const landed = applyRange(old, next);
    expect(landed).toBe(" MY_B 1 ");
    expect(landed.slice(r.mapNew(next.indexOf("B")))).toMatch(/^B/);
  });

  it("refuses an edit that would put a comment marker inside", () => {
    expect(commentRangeEdit(" a b ", " a /* b ")).toBeNull();
    expect(commentRangeEdit(" a b ", " a */ b ")).toBeNull();
  });
});

describe("segmentList", () => {
  const items = (src: string) => {
    const p = parseRms(src, rawLang);
    return { items: p.script.preamble, tokens: p.tokens };
  };

  it("groups a run of #const into one table and leaves other cards alone", () => {
    const { items: list, tokens } = items(
      "#const A 1\n#const B 2\nrandom_placement\n#const C 3\n",
    );
    expect(segmentList(list, tokens, () => false)).toEqual([
      { kind: "table", first: 0, last: 1, directive: "#const" },
      { kind: "item", index: 2 },
      { kind: "table", first: 3, last: 3, directive: "#const" },
    ]);
  });

  it("breaks a run at a comment, and a lone #define is a table too", () => {
    const { items: list, tokens } = items(
      "#const A 1\n#const B 2\n#define X\n#define Y\n#define Z\n",
    );
    expect(segmentList(list, tokens, (i) => i === 0)).toEqual([
      { kind: "table", first: 0, last: 0, directive: "#const" },
      { kind: "table", first: 1, last: 1, directive: "#const" },
      { kind: "table", first: 2, last: 4, directive: "#define" },
    ]);
    const lone = items("#define X\nrandom_placement\n");
    expect(segmentList(lone.items, lone.tokens, () => false)).toEqual([
      { kind: "table", first: 0, last: 0, directive: "#define" },
      { kind: "item", index: 1 },
    ]);
  });
});

describe("new table rows", () => {
  it("picks a name nothing else uses", () => {
    expect(freshTableName("NEW_CONST", new Set())).toBe("NEW_CONST");
    expect(
      freshTableName("NEW_DEFINE", new Set(["NEW_DEFINE", "NEW_DEFINE_2"])),
    ).toBe("NEW_DEFINE_3");
  });

  it("finds the name from addConst's caret on the value", () => {
    const line = "#const NEW_CONST 0";
    const caret = line.length - 1;
    expect(line.slice(addedConstNameStart(caret, "NEW_CONST"))).toMatch(
      /^NEW_CONST 0$/,
    );
  });
});

describe("Enter navigation", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function build(): HTMLElement {
    document.body.innerHTML = `
      <input id="outside" ${ENTER_FIELD} />
      <div id="scope" ${ENTER_SCOPE}>
        <input id="a" ${ENTER_FIELD} />
        <button id="del">x</button>
        <input id="b" ${ENTER_FIELD} />
        <div ${ENTER_SCOPE}><input id="inner" ${ENTER_FIELD} /></div>
        <input id="c" ${ENTER_FIELD} disabled />
        <button id="add" ${ENTER_ADD}>+</button>
      </div>`;
    return document.getElementById("scope")!;
  }
  const el = (id: string) => document.getElementById(id)!;

  it("walks the scope's own fields and ends on the add button", () => {
    build();
    expect(nextEnterTarget(el("a"))?.el.id).toBe("b");
    // Skips the nested scope's field and the disabled one.
    expect(nextEnterTarget(el("b"))?.el.id).toBe("add");
    expect(nextEnterTarget(el("b"))?.isField).toBe(false);
    expect(nextEnterTarget(el("add"))).toBeNull();
  });

  it("does nothing outside a group, so Enter keeps commit-and-stay there", () => {
    build();
    expect(nextEnterTarget(el("outside"))).toBeNull();
    // A lone field in its own scope has nowhere to go either.
    expect(nextEnterTarget(el("inner"))).toBeNull();
  });

  it("finds the target again by position after the fields are replaced", () => {
    const scope = build();
    const target = nextEnterTarget(el("a"))!;
    // A reparse swaps the element out for a new one in the same place.
    const fresh = document.createElement("input");
    fresh.setAttribute(ENTER_FIELD, "");
    fresh.id = "b2";
    scope.replaceChild(fresh, el("b"));
    expect(resolveEnterTarget(target)?.id).toBe("b2");
    scope.remove();
    expect(resolveEnterTarget(target)).toBeNull();
  });
});
