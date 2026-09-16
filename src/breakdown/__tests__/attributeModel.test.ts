import { describe, expect, it } from "vitest";
import {
  sortKnownSlots,
  splitAttributeColumns,
  type AttributeSlot,
} from "../attributeModel";
import type { AttributeDef } from "../../parser/language";
import type { AttributeNode } from "../../parser/types";

function def(
  name: string,
  overrides: Partial<AttributeDef> = {},
): AttributeDef {
  return { name, verified: true, ...overrides };
}

function instanceAt(start: number): AttributeNode {
  // sortKnownSlots only ever reads .span.start off an instance, so a
  // minimal stand-in is enough; a full AttributeNode needs a parsed
  // document this module has no reason to construct.
  return { span: { start, end: start + 1 } } as unknown as AttributeNode;
}

function textSlot(
  name: string,
  overrides: Partial<AttributeDef> = {},
  instances: AttributeNode[] = [],
): AttributeSlot {
  return {
    name,
    def: def(name, {
      arguments: [{ name: "value", type: "string" }],
      ...overrides,
    }),
    instances,
    isFlag: false,
  };
}

function numberSlot(
  name: string,
  overrides: Partial<AttributeDef> = {},
  instances: AttributeNode[] = [],
): AttributeSlot {
  return {
    name,
    def: def(name, {
      arguments: [{ name: "value", type: "integer" }],
      ...overrides,
    }),
    instances,
    isFlag: false,
  };
}

function boolSlot(
  name: string,
  overrides: Partial<AttributeDef> = {},
  instances: AttributeNode[] = [],
): AttributeSlot {
  return { name, def: def(name, overrides), instances, isFlag: true };
}

describe("sortKnownSlots", () => {
  it("alphabetical mode ignores type and required entirely", () => {
    const slots = [
      numberSlot("zeta"),
      textSlot("alpha"),
      boolSlot("mid", { required: true }),
    ];
    expect(sortKnownSlots(slots, "alphabetical").map((s) => s.name)).toEqual([
      "alpha",
      "mid",
      "zeta",
    ]);
  });

  it("required mode groups required first, then text, then number, then boolean, alphabetical within each", () => {
    const slots = [
      numberSlot("num_b"),
      textSlot("text_b"),
      boolSlot("bool_b"),
      numberSlot("num_a"),
      textSlot("text_a"),
      boolSlot("bool_a"),
      textSlot("req_b", { required: true }),
      numberSlot("req_a", { required: true }),
    ];
    expect(sortKnownSlots(slots, "required").map((s) => s.name)).toEqual([
      "req_a",
      "req_b",
      "text_a",
      "text_b",
      "num_a",
      "num_b",
      "bool_a",
      "bool_b",
    ]);
  });

  it("fileOrder mode sorts present slots by first-instance position, absent slots appended after in required order", () => {
    const slots = [
      textSlot("present_late", {}, [instanceAt(100)]),
      numberSlot("absent_number"),
      textSlot("present_early", {}, [instanceAt(10)]),
      boolSlot("absent_bool"),
      textSlot("absent_text"),
    ];
    expect(sortKnownSlots(slots, "fileOrder").map((s) => s.name)).toEqual([
      "present_early",
      "present_late",
      "absent_text",
      "absent_number",
      "absent_bool",
    ]);
  });

  it("fileOrder mode uses only the FIRST instance's position for a repeated attribute", () => {
    const slots = [
      textSlot("repeated", {}, [instanceAt(50), instanceAt(5)]),
      textSlot("single", {}, [instanceAt(20)]),
    ];
    // repeated's first instance (in source order, as buildCommandBreakdown
    // already produces it) is at 50, so it sorts after single at 20 even
    // though it also has an instance earlier at 5 — only instances[0] counts.
    expect(sortKnownSlots(slots, "fileOrder").map((s) => s.name)).toEqual([
      "single",
      "repeated",
    ]);
  });

  it("custom mode with no saved order falls back to required order", () => {
    const slots = [boolSlot("b"), textSlot("a", { required: true })];
    expect(sortKnownSlots(slots, "custom").map((s) => s.name)).toEqual([
      "a",
      "b",
    ]);
    expect(sortKnownSlots(slots, "custom", []).map((s) => s.name)).toEqual([
      "a",
      "b",
    ]);
  });

  it("custom mode applies the saved order, appending any unlisted slot in required order", () => {
    const slots = [textSlot("a"), textSlot("b"), textSlot("c"), boolSlot("d")];
    expect(
      sortKnownSlots(slots, "custom", ["c", "a"]).map((s) => s.name),
    ).toEqual(["c", "a", "b", "d"]);
  });

  it("custom mode drops stale names from a saved order that no longer exist as slots", () => {
    const slots = [textSlot("a"), textSlot("b")];
    expect(
      sortKnownSlots(slots, "custom", ["ghost", "b", "a"]).map((s) => s.name),
    ).toEqual(["b", "a"]);
  });
});

describe("splitAttributeColumns", () => {
  it("with no override, splits purely by isFlag, preserving relative order in each column", () => {
    const slots = [
      textSlot("a"),
      boolSlot("flag1"),
      numberSlot("b"),
      boolSlot("flag2"),
    ];
    const { left, right } = splitAttributeColumns(slots);
    expect(left.map((s) => s.name)).toEqual(["a", "b"]);
    expect(right.map((s) => s.name)).toEqual(["flag1", "flag2"]);
  });

  it("an explicit rightColumn override wins over isFlag, in either direction", () => {
    const slots = [textSlot("a"), boolSlot("flag1"), numberSlot("b")];
    // "a" (a text slot) forced right, "flag1" (a boolean slot) forced left.
    const { left, right } = splitAttributeColumns(slots, ["a"]);
    expect(left.map((s) => s.name)).toEqual(["flag1", "b"]);
    expect(right.map((s) => s.name)).toEqual(["a"]);
  });

  it("an empty rightColumn override puts everything in the left column", () => {
    const slots = [textSlot("a"), boolSlot("flag1")];
    const { left, right } = splitAttributeColumns(slots, []);
    expect(left.map((s) => s.name)).toEqual(["a", "flag1"]);
    expect(right).toEqual([]);
  });
});
