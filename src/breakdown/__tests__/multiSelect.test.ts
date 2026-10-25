// 2026-10-21, the click rules behind multi-select (multiSelect.ts) and the
// view scope's tab rules (viewScope.ts). Pure, no pane rendered.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import type { IfNode, Item, ParseResult } from "../../parser/types";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import {
  clickModeOf,
  nextSelection,
  outermostInOrder,
  type ClickMode,
  type SelectableCard,
} from "../multiSelect";
import { commentCardPlaces, extractComments } from "../comments";
import type { CommentRef } from "../patch/intents";
import {
  resolveShownIds,
  shownAfterTabClick,
  shownAfterToggle,
} from "../viewScope";

const langData = loadLanguage();
const SRC =
  "<OBJECTS_GENERATION>\ncreate_object A\ncreate_object B\nif REGICIDE\n\tcreate_object X\n\tcreate_object Y\nendif\ncreate_object C\ncreate_object D\n<LAND_GENERATION>\ncreate_land { }\n";
const r: ParseResult = parseRms(SRC, langData);
const obj = r.script.sections[0].items;
const [A, B, IF, C, D] = obj;
const [X, Y] = (IF as IfNode).branches[0].items;
const LAND = r.script.sections[1].items[0];
const sectionOf = (i: Item) =>
  r.script.sections.findIndex(
    (s) => i.span.start >= s.span.start && i.span.end <= s.span.end,
  );
const sameSection = (a: Item, b: Item) => sectionOf(a) === sectionOf(b);

/** Clicks in order from nothing selected, returning the selection as the cards' first words. */
function clicks(...steps: [Item, ClickMode][]) {
  let primary: Item | undefined;
  let extras: Item[] = [];
  const at = (o: number) =>
    [...obj, X, Y, LAND].find((i) => i.span.start === o)!;
  for (const [item, mode] of steps) {
    const next = nextSelection(
      r.script,
      primary,
      extras,
      item,
      mode,
      sameSection,
    );
    primary = next.primary === null ? undefined : at(next.primary);
    extras = next.extras.map(at);
  }
  const name = (i: Item) => SRC.slice(i.span.start, i.span.end).split("\n")[0];
  return {
    primary: primary && name(primary),
    extras: extras.map(name).sort(),
  };
}

describe("clickModeOf follows file-list conventions", () => {
  it.each([
    [{ ctrlKey: false, metaKey: false, shiftKey: false }, "replace"],
    [{ ctrlKey: true, metaKey: false, shiftKey: false }, "toggle"],
    [{ ctrlKey: false, metaKey: true, shiftKey: false }, "toggle"],
    [{ ctrlKey: false, metaKey: false, shiftKey: true }, "range"],
    [{ ctrlKey: true, metaKey: false, shiftKey: true }, "range"],
  ] as const)("%o → %s", (event, mode) => {
    expect(clickModeOf(event)).toBe(mode);
  });
});

describe("nextSelection", () => {
  it("a plain click selects one card and drops the rest", () => {
    expect(clicks([A, "toggle"], [C, "toggle"], [D, "replace"])).toEqual({
      primary: "create_object D",
      extras: [],
    });
  });

  it("Ctrl adds a card and makes it the primary", () => {
    expect(clicks([A, "replace"], [C, "toggle"])).toEqual({
      primary: "create_object C",
      extras: ["create_object A"],
    });
  });

  it("Ctrl on a selected card removes it, and the newest extra takes over as primary", () => {
    expect(
      clicks([A, "replace"], [B, "toggle"], [C, "toggle"], [C, "toggle"]),
    ).toEqual({
      primary: "create_object B",
      extras: ["create_object A"],
    });
    expect(clicks([A, "replace"], [A, "toggle"])).toEqual({
      primary: undefined,
      extras: [],
    });
  });

  it("Shift selects the run of siblings between the primary and the clicked card, either direction", () => {
    expect(clicks([B, "replace"], [D, "range"])).toEqual({
      primary: "create_object B",
      extras: ["create_object C", "create_object D", "if REGICIDE"],
    });
    expect(clicks([D, "replace"], [A, "range"]).extras).toHaveLength(4);
  });

  it("a second Shift click re-runs from the same anchor, replacing the run", () => {
    expect(clicks([B, "replace"], [D, "range"], [A, "range"])).toEqual({
      primary: "create_object B",
      extras: ["create_object A"],
    });
  });

  it("Shift into a branch runs to the if card that holds the clicked card", () => {
    expect(clicks([A, "replace"], [X, "range"])).toEqual({
      primary: "create_object A",
      extras: ["create_object B", "if REGICIDE"],
    });
  });

  it("Shift out of a branch runs from the if card, and the primary stays the card inside it", () => {
    expect(clicks([X, "replace"], [D, "range"])).toEqual({
      primary: "create_object X",
      extras: ["create_object C", "create_object D", "if REGICIDE"],
    });
    expect(clicks([Y, "replace"], [B, "range"])).toEqual({
      primary: "create_object Y",
      extras: ["create_object B", "if REGICIDE"],
    });
  });

  it("Shift onto the if card holding the primary selects just that block", () => {
    expect(clicks([X, "replace"], [IF, "range"])).toEqual({
      primary: "create_object X",
      extras: ["if REGICIDE"],
    });
  });

  it("Shift across a lifted run replaces the extras a Ctrl click added", () => {
    expect(clicks([D, "replace"], [A, "toggle"], [X, "range"])).toEqual({
      primary: "create_object A",
      extras: ["create_object B", "if REGICIDE"],
    });
  });

  it("Shift between two branches lifts to the deepest list they share", () => {
    const src =
      "<OBJECTS_GENERATION>\ncreate_object A\nstart_random\npercent_chance 50\nif REGICIDE\ncreate_object P\nelse\ncreate_object Q\nendif\ncreate_object R\nend_random\n";
    const parsed = parseRms(src, langData);
    const random = parsed.script.sections[0].items[1];
    if (random.kind !== "random") throw new Error("expected start_random");
    const [inner, R] = random.branches[0].items;
    if (inner.kind !== "if") throw new Error("expected if");
    const P = inner.branches[0].items[0];
    const Q = inner.branches[1].items[0];
    const from = (primary: Item, clicked: Item) =>
      nextSelection(parsed.script, primary, [], clicked, "range", () => true);
    // P and Q sit in two branches of one if, so the run is that if card.
    expect(from(P, Q)).toEqual({
      primary: P.span.start,
      extras: [inner.span.start],
    });
    // P and R share the random branch, so the run is the if card and R.
    expect(from(P, R).extras).toEqual([inner.span.start, R.span.start]);
  });

  it("Shift inside a branch runs along the branch", () => {
    expect(clicks([X, "replace"], [Y, "range"]).extras).toEqual([
      "create_object Y",
    ]);
  });

  it("a modified click in another section starts over there", () => {
    expect(clicks([A, "replace"], [B, "toggle"], [LAND, "toggle"])).toEqual({
      primary: "create_land { }",
      extras: [],
    });
    expect(clicks([A, "replace"], [LAND, "range"]).extras).toEqual([]);
  });

  it("Shift or Ctrl with nothing selected is a plain click", () => {
    expect(clicks([C, "range"])).toEqual({
      primary: "create_object C",
      extras: [],
    });
  });
});

// 2026-10-22, comment cards became selectable (breakdown-design Sec.3.13).
describe("comment cards in the selection", () => {
  const src =
    "<OBJECTS_GENERATION>\n/* c0 */\ncreate_object A\n/* c1 */\ncreate_object B\nif REGICIDE\n\t/* c2 */\n\tcreate_object X\nendif\n/* c3 */\ncreate_object C /* inline */\n";
  const parsed = parseRms(src, langData);
  const comments = extractComments(parsed.tokens);
  const places = commentCardPlaces(parsed, comments);
  const items = parsed.script.sections[0].items;
  const [a, b, iff] = items;
  const branch = (iff as IfNode).branches[0].items;
  const ref = (i: number): CommentRef => ({
    kind: "comment",
    span: comments[i],
  });
  const select = (
    primary: SelectableCard,
    clicked: SelectableCard,
    mode: ClickMode,
    withPlaces = true,
  ) =>
    nextSelection<SelectableCard>(
      parsed.script,
      primary,
      [],
      clicked,
      mode,
      () => true,
      withPlaces ? places : undefined,
    );

  it("places a leading, a between, a branch and a trailing comment in their own lists, and an inline one nowhere", () => {
    expect(places.get(comments[0].start)?.items).toBe(items);
    expect(places.get(comments[1].start)?.items).toBe(items);
    expect(places.get(comments[2].start)?.items).toBe(branch);
    expect(places.get(comments[2].start)?.container).toBe(iff);
    expect(places.get(comments[3].start)?.items).toBe(items);
    expect(places.has(comments[4].start)).toBe(false);
  });

  it("Ctrl adds a comment card and makes it the primary", () => {
    expect(select(a, ref(1), "toggle")).toEqual({
      primary: comments[1].start,
      extras: [a.span.start],
    });
  });

  it("Shift from a card to a comment takes the comment cards between along", () => {
    expect(select(a, ref(3), "range")).toEqual({
      primary: a.span.start,
      extras: [
        comments[1].start,
        b.span.start,
        iff.span.start,
        comments[3].start,
      ],
    });
  });

  it("Shift from a branch comment to a section card lifts to the if card", () => {
    expect(select(ref(2), b, "range")).toEqual({
      primary: comments[2].start,
      extras: [b.span.start, iff.span.start],
    });
  });

  it("Shift onto a comment with no places to look it up in starts over", () => {
    expect(select(a, ref(1), "range", false)).toEqual({
      primary: comments[1].start,
      extras: [],
    });
  });
});

describe("outermostInOrder", () => {
  it("sorts, dedupes and drops cards inside other selected cards", () => {
    const out = outermostInOrder([C, X, IF, A, C]);
    expect(out).toEqual([A, IF, C]);
  });
});

describe("view scope", () => {
  const ids = [
    "header",
    "PLAYER_SETUP",
    "LAND_GENERATION",
    "OBJECTS_GENERATION",
  ];

  it("nothing remembered shows the first tab, as before", () => {
    expect(resolveShownIds(ids, null)).toEqual(["header"]);
  });

  it("a remembered set keeps tab order and drops ids this file lacks", () => {
    expect(
      resolveShownIds(ids, [
        "OBJECTS_GENERATION",
        "unknown:FOO",
        "LAND_GENERATION",
      ]),
    ).toEqual(["LAND_GENERATION", "OBJECTS_GENERATION"]);
    expect(resolveShownIds(ids, ["unknown:FOO"])).toEqual(["header"]);
  });

  it("a click on a shown tab keeps the set, on a faded tab shows only that one", () => {
    const shown = ["LAND_GENERATION", "OBJECTS_GENERATION"];
    expect(shownAfterTabClick(shown, "LAND_GENERATION")).toEqual(shown);
    expect(shownAfterTabClick(shown, "PLAYER_SETUP")).toEqual(["PLAYER_SETUP"]);
  });

  it("ticking adds in tab order, unticking removes, the last one stays", () => {
    expect(shownAfterToggle(["OBJECTS_GENERATION"], "header", ids)).toEqual([
      "header",
      "OBJECTS_GENERATION",
    ]);
    expect(
      shownAfterToggle(["header", "OBJECTS_GENERATION"], "header", ids),
    ).toEqual(["OBJECTS_GENERATION"]);
    expect(shownAfterToggle(["header"], "header", ids)).toEqual(["header"]);
  });
});
