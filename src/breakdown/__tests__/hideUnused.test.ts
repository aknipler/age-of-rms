import { describe, expect, it } from "vitest";
import type { AttributeSlot } from "../attributeModel";
import type { AttributeNode } from "../../parser/types";
import {
  addAbsentSlotIntent,
  filterSlots,
  partitionSlots,
  snapshotVisibleNames,
} from "../hideUnused";

const present = {} as AttributeNode;

function slot(
  name: string,
  opts: { present?: boolean; flag?: boolean; type?: string; def?: number } = {},
): AttributeSlot {
  return {
    name,
    def: {
      name,
      verified: true,
      arguments: opts.flag
        ? []
        : [
            {
              name: "v",
              type: (opts.type ?? "integer") as never,
              default: opts.def,
            },
          ],
      description: `${name} description`,
    },
    instances: opts.present ? [present] : [],
    isFlag: opts.flag ?? false,
  };
}

describe("Hide Unused (Sec.3.3.1, 2026-09-17 amendment)", () => {
  const slots = [
    slot("land_percent", { present: true }),
    slot("base_size"),
    slot("set_flat_terrain_only", { flag: true, present: true }),
    slot("clumping_factor"),
  ];

  it("snapshot is the present names plus the exclusion list", () => {
    const snap = snapshotVisibleNames(slots, ["clumping_factor"]);
    expect([...snap].sort()).toEqual([
      "clumping_factor",
      "land_percent",
      "set_flat_terrain_only",
    ]);
  });

  it("a flag unticked after the snapshot stays shown until the card reopens", () => {
    const snap = snapshotVisibleNames(slots, []);
    const later = slots.map((s) =>
      s.name === "set_flat_terrain_only" ? { ...s, instances: [] } : s,
    );
    const { shown, hidden } = partitionSlots(later, snap);
    expect(shown.map((s) => s.name)).toEqual([
      "land_percent",
      "set_flat_terrain_only",
    ]);
    expect(hidden.map((s) => s.name)).toEqual(["base_size", "clumping_factor"]);
  });

  it("an attribute added after the snapshot appears at once", () => {
    const snap = snapshotVisibleNames(slots, []);
    const later = slots.map((s) =>
      s.name === "base_size" ? { ...s, instances: [present] } : s,
    );
    const { shown } = partitionSlots(later, snap);
    expect(shown.map((s) => s.name)).toContain("base_size");
  });

  it("addAbsentSlotIntent picks the same intents AttributeRow issues", () => {
    const target = {} as never;
    expect(addAbsentSlotIntent(slot("f", { flag: true }), target)).toEqual({
      kind: "toggleFlag",
      target,
      name: "f",
      on: true,
    });
    expect(
      addAbsentSlotIntent(slot("t", { type: "terrainConstant" }), target),
    ).toEqual({ kind: "addAttribute", target, name: "t", bare: true });
    expect(addAbsentSlotIntent(slot("n", { def: 3 }), target)).toEqual({
      kind: "addAttribute",
      target,
      name: "n",
      value: [3],
    });
    expect(addAbsentSlotIntent(slot("m"), target)).toEqual({
      kind: "addAttribute",
      target,
      name: "m",
      value: undefined,
    });
  });

  it("filterSlots matches name or description, case-insensitively, and empty means all", () => {
    expect(filterSlots(slots, "").length).toBe(4);
    expect(filterSlots(slots, "CLUMP").map((s) => s.name)).toEqual([
      "clumping_factor",
    ]);
    expect(
      filterSlots(slots, "base_size description").map((s) => s.name),
    ).toEqual(["base_size"]);
  });
});
