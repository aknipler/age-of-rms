// Sec.4.4: RandomParam hoisting, the gap named open in slice 4a's and 4b's
// own build-log entries, closed this slice.

import { describe, expect, it } from "vitest";
import { ASSIGN_TO_PLAYER_PER_REPEAT } from "../model";
import { num, param, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import {
  computeOwnerPlayers,
  emitRandomParams,
  resolveParamRefs,
} from "../paramEmit";
import type { LandRole, Placement, RandomParam } from "../model";

function sharedParam(over: Partial<RandomParam> = {}): RandomParam {
  return {
    id: "p1",
    label: "VAR_A1",
    min: -2,
    max: 2,
    perPlayer: false,
    ...over,
  };
}

describe("emitRandomParams", () => {
  it("a shared (perPlayer: false) param emits exactly one #const rnd(min,max) cell", () => {
    const emission = emitRandomParams(
      [sharedParam()],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.cells).toEqual([
      { name: "PARAM_VAR_A1", text: "rnd(-2,2)", tokens: ["rnd(-2,2)"] },
    ]);
    expect(emission.resolveName("p1", undefined)).toBe("PARAM_VAR_A1");
    // ownerPlayer is irrelevant for a shared param, same name regardless.
    expect(emission.resolveName("p1", 3)).toBe("PARAM_VAR_A1");
  });

  // per-player-escalation.md Sec.5.4 / slice-b-brief.md item 3: the count is
  // runtime under a perPlayer ring, so this emits at MAX_PLAYER_COUNT (8)
  // unconditionally — there is no longer a "the count it was emitted for" to
  // pass in at all, for ANY perPlayer param, ring or not (Sec.4.4: "lifted
  // here and there together or not at all").
  it("a perPlayer param emits one cell per player up to MAX_PLAYER_COUNT (8), _P<n> suffixed, and resolves by owner", () => {
    const emission = emitRandomParams(
      [sharedParam({ perPlayer: true })],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.cells.map((c) => c.name)).toEqual(
      Array.from({ length: 8 }, (_, i) => `PARAM_VAR_A1_P${i + 1}`),
    );
    expect(emission.cells.every((c) => c.text === "rnd(-2,2)")).toBe(true);
    expect(emission.resolveName("p1", 1)).toBe("PARAM_VAR_A1_P1");
    expect(emission.resolveName("p1", 8)).toBe("PARAM_VAR_A1_P8");
  });

  it("an unowned reference to a perPlayer param resolves to undefined, not a P1 fallback (Sec.4.4)", () => {
    const emission = emitRandomParams(
      [sharedParam({ perPlayer: true })],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.resolveName("p1", undefined)).toBeUndefined();
    expect(emission.resolveName("p1", 9)).toBeUndefined(); // out of range regardless (max is 8)
  });

  it("an unknown param id resolves to undefined", () => {
    const emission = emitRandomParams(
      [sharedParam()],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.resolveName("nonexistent", undefined)).toBeUndefined();
  });

  it("previewValues seeds the midpoint of [min,max] for every emitted cell, including every _P<n> variant", () => {
    const emission = emitRandomParams(
      [sharedParam({ min: -180, max: 180, perPlayer: true })],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.previewValues.get("PARAM_VAR_A1_P1")).toBe(0);
    expect(emission.previewValues.get("PARAM_VAR_A1_P8")).toBe(0);
  });

  it("mixed shared and perPlayer params both emit, names never collide", () => {
    const emission = emitRandomParams(
      [
        sharedParam({ id: "shared", label: "ROTATION_AUX" }),
        sharedParam({ id: "pp", label: "JITTER", perPlayer: true }),
      ],
      new NameAllocator({ prefix: "" }),
    );
    expect(emission.cells.map((c) => c.name)).toEqual([
      "PARAM_ROTATION_AUX",
      ...Array.from({ length: 8 }, (_, i) => `PARAM_JITTER_P${i + 1}`),
    ]);
  });
});

describe("resolveParamRefs", () => {
  const resolveName = (id: string): string | undefined =>
    id === "known" ? "RESOLVED_NAME" : undefined;

  it("leaves num/inf/sym/node untouched", () => {
    expect(resolveParamRefs(num(5), resolveName)).toEqual(num(5));
    expect(resolveParamRefs(sym("X"), resolveName)).toEqual(sym("X"));
  });

  it("replaces a resolvable param leaf with sym(resolvedName)", () => {
    expect(resolveParamRefs(param("known"), resolveName)).toEqual(
      sym("RESOLVED_NAME"),
    );
  });

  it("returns null for an unresolvable param leaf", () => {
    expect(resolveParamRefs(param("unknown"), resolveName)).toBeNull();
  });

  it("resolves a param nested inside bin/neg/sin/cos", () => {
    const tree = {
      k: "bin" as const,
      op: "+" as const,
      l: { k: "neg" as const, e: param("known") },
      r: { k: "sin" as const, e: param("known") },
    };
    const resolved = resolveParamRefs(tree, resolveName);
    expect(resolved).toEqual({
      k: "bin",
      op: "+",
      l: { k: "neg", e: sym("RESOLVED_NAME") },
      r: { k: "sin", e: sym("RESOLVED_NAME") },
    });
  });

  it("an unresolvable param anywhere in the tree propagates null, even deeply nested", () => {
    const tree = {
      k: "bin" as const,
      op: "+" as const,
      l: num(1),
      r: {
        k: "bin" as const,
        op: "*" as const,
        l: param("unknown"),
        r: num(2),
      },
    };
    expect(resolveParamRefs(tree, resolveName)).toBeNull();
  });
});

describe("computeOwnerPlayers", () => {
  function playerRole(): LandRole {
    return {
      id: "player",
      label: "Player",
      terrain: { k: "name", name: "GRASS" },
      baseSize: num(10),
      baseElevation: num(0),
      extent: { kind: "percent", value: num(5) },
      zone: { kind: "none" },
      assign: ASSIGN_TO_PLAYER_PER_REPEAT,
    };
  }

  it("a placement wearing an assignToPlayer role owns itself, at repeatIndex + 1", () => {
    const placements: Placement[] = [
      {
        id: "P1",
        parent: "center",
        frame: "radial",
        label: "P1",
        role: "player",
        repeatIndex: 0,
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
      {
        id: "P2",
        parent: "center",
        frame: "radial",
        label: "P2",
        role: "player",
        repeatIndex: 1,
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
    ];
    const owners = computeOwnerPlayers(
      placements,
      new Map([["player", playerRole()]]),
    );
    expect(owners.get("P1")).toBe(1);
    expect(owners.get("P2")).toBe(2);
  });

  it("a fixed AT_PLAYER number owns when closed; AT_COLOR / AT_TEAM confer no owner (role-attributes-escalation.md Sec.4.2)", () => {
    const one: Placement = {
      id: "L",
      parent: "center",
      frame: "radial",
      label: "L",
      role: "r",
      offset: { kind: "polar", r: num(0), theta: num(0) },
    };
    const owner = (assign: LandRole["assign"]) =>
      computeOwnerPlayers(
        [one],
        new Map([["r", { ...playerRole(), assign }]]),
      ).get("L");
    expect(
      owner({ kind: "player", number: { kind: "fixed", value: num(3) } }),
    ).toBe(3);
    expect(
      owner({
        kind: "assignTo",
        target: "AT_PLAYER",
        number: { kind: "fixed", value: { k: "sym", name: "WHO" } },
        mode: 0,
        flags: 0,
      }),
    ).toBeUndefined(); // symbolic: the tool cannot see which player
    expect(
      owner({
        kind: "assignTo",
        target: "AT_TEAM",
        number: { kind: "fixed", value: num(1) },
        mode: 0,
        flags: 0,
      }),
    ).toBeUndefined();
  });

  it("a chained child inherits its ancestor's owner", () => {
    const placements: Placement[] = [
      {
        id: "P1",
        parent: "center",
        frame: "radial",
        label: "P1",
        role: "player",
        repeatIndex: 0,
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
      {
        id: "P1_A1",
        parent: "P1",
        frame: "radial",
        label: "P1_A1",
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
      {
        id: "P1_A1_A",
        parent: "P1_A1",
        frame: "radial",
        label: "P1_A1_A",
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
    ];
    const owners = computeOwnerPlayers(
      placements,
      new Map([["player", playerRole()]]),
    );
    expect(owners.get("P1_A1")).toBe(1);
    expect(owners.get("P1_A1_A")).toBe(1); // grandchild, still inherits
  });

  it("a node with no player-owning ancestor has an undefined owner", () => {
    const placements: Placement[] = [
      {
        id: "neutral",
        parent: "center",
        frame: "radial",
        label: "neutral",
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
    ];
    const owners = computeOwnerPlayers(placements, new Map());
    expect(owners.get("neutral")).toBeUndefined();
  });

  it("a cycle in the model does not infinite-loop — resolves to undefined rather than hanging", () => {
    const placements: Placement[] = [
      {
        id: "A",
        parent: "B",
        frame: "radial",
        label: "A",
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
      {
        id: "B",
        parent: "A",
        frame: "radial",
        label: "B",
        offset: { kind: "polar", r: num(0), theta: num(0) },
      },
    ];
    const owners = computeOwnerPlayers(placements, new Map());
    expect(owners.get("A")).toBeUndefined();
    expect(owners.get("B")).toBeUndefined();
  });
});
