// per-player-escalation.md Sec.4.1/4.3, slice-a-brief items 3-6, and its own
// Sec.2's acceptance: "the rendered fence has balanced if/endif at every
// player count, asserted by a test" and "emittedNames contains every
// ALP_AT_LEAST_* and ALP_DEG_* name."

import { describe, expect, it } from "vitest";
import type { Expr } from "../../../../../tools-api/index";
import { add, bin, num, sym } from "../compiler/expr";
import { NameAllocator } from "../compiler/naming";
import {
  buildPrologue,
  renderConditionalBlock,
  resolveMemberAngle,
} from "../prologue";
import type { Placement, ShapeGroup } from "../model";

/** Most tests here have no `RandomParam` to resolve — a real caller's `resolveExprParams` closure (emitModel.ts) is exercised separately below. */
const IDENTITY_RESOLVER = (e: Expr): Expr => e;

function oneSlotRing(overrides: Partial<ShapeGroup> = {}): ShapeGroup {
  return {
    id: "ring",
    parent: "center",
    kind: "circle",
    pattern: [{ id: "P", role: "role-player" }],
    repeats: 8,
    radius: num(30),
    rotation: num(0),
    frame: "radial",
    members: Array.from({ length: 8 }, (_, i) => `ring#${i}#P`),
    perPlayer: true,
    ...overrides,
  };
}

/** Balanced iff every opening `if` has exactly one closing `endif`, one block per `if`, regardless of how many `elseif`s sit between them. */
function countBalance(text: string): { ifCount: number; endifCount: number } {
  const ifCount = (text.match(/^if /gm) ?? []).length;
  const endifCount = (text.match(/^endif$/gm) ?? []).length;
  return { ifCount, endifCount };
}

describe("renderConditionalBlock — the structure that cannot unbalance (item 6 hazard 3)", () => {
  it("renders exactly one if, N-1 elseifs and one endif for N branches", () => {
    const text = renderConditionalBlock([
      { condition: "A", lines: ["x1"] },
      { condition: "B", lines: ["x2"] },
      { condition: "C", lines: ["x3"] },
    ]);
    expect(text.match(/^if /gm)).toHaveLength(1);
    expect(text.match(/^elseif /gm)).toHaveLength(2);
    expect(text.match(/^endif$/gm)).toHaveLength(1);
    expect(text.split("\n")[0]).toBe("if A");
    expect(text).toContain("elseif B");
    expect(text).toContain("elseif C");
    expect(text.trim().endsWith("endif")).toBe(true);
  });

  it("a single branch is just if/endif, no elseif — item 6's own guard shape", () => {
    const text = renderConditionalBlock([
      { condition: "ALP_AT_LEAST_3", lines: ["create_land", "{", "}"] },
    ]);
    expect(text).toBe("if ALP_AT_LEAST_3\ncreate_land\n{\n}\nendif");
  });

  it("throws rather than emit an empty conditional with no branches at all", () => {
    expect(() => renderConditionalBlock([])).toThrow();
  });
});

describe("buildPrologue — no perPlayer group", () => {
  it("emits nothing at all, so a script that never uses this stays byte-identical (Sec.10.1)", () => {
    const group = oneSlotRing({ perPlayer: false });
    const result = buildPrologue(
      [group],
      [],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    expect(result.text).toBe("");
    expect(result.emittedNames).toEqual([]);
    expect(result.thetaOverrides.size).toBe(0);
    expect(result.liveDegCells).toEqual([]);
  });
});

describe("buildPrologue — one-slot perPlayer ring (the brief's own worked acceptance case)", () => {
  const group = oneSlotRing();
  const namer = new NameAllocator();
  const result = buildPrologue(
    [group],
    [],
    new Map(),
    namer,
    3,
    IDENTITY_RESOLVER,
  );

  it("covers 1 through 8 branches, not 2 through 8 (Sec.8.4)", () => {
    const { ifCount, endifCount } = countBalance(result.text);
    expect(ifCount).toBe(1);
    expect(endifCount).toBe(1);
    expect(result.text.match(/^elseif /gm)).toHaveLength(7);
    expect(result.text).toContain("if 1_PLAYER_GAME");
    expect(result.text).toContain("elseif 8_PLAYER_GAME");
  });

  it("emits exactly 7 ALP_AT_LEAST_* names (k=2..8) and one ALP_DEG_P* name per player (8)", () => {
    const atLeast = result.emittedNames.filter((n) => n.includes("AT_LEAST"));
    const deg = result.emittedNames.filter((n) => n.includes("DEG"));
    expect(atLeast).toHaveLength(7);
    expect(deg).toHaveLength(8);
    expect(new Set(result.emittedNames).size).toBe(result.emittedNames.length); // no accidental dupes
  });

  it("gives every group member its own theta override, a plain sym reference", () => {
    expect(result.thetaOverrides.size).toBe(8);
    for (let i = 0; i < 8; i++) {
      const override = result.thetaOverrides.get(`ring#${i}#P`);
      expect(override?.k).toBe("sym");
    }
  });

  it("player 1 (repeat index 0) needs no guard; players 2-8 each get their own ALP_AT_LEAST_k", () => {
    expect(result.guardLabels.get("ring#0#P")).toBeUndefined();
    for (let i = 1; i < 8; i++) {
      const guard = result.guardLabels.get(`ring#${i}#P`);
      expect(guard).toContain(`AT_LEAST_${i + 1}`);
    }
    // Exactly 7 guarded, matching the brief's own acceptance line.
    const guarded = [...result.guardLabels.values()].filter(
      (g) => g !== undefined,
    );
    expect(guarded).toHaveLength(7);
  });

  it("liveDegCells carries exactly the currently-previewed count's own cells, evenly spaced at that count (rotation 0)", () => {
    expect(result.liveDegCells).toHaveLength(3); // playerCount 3
    const byName = new Map(result.liveDegCells.map((c) => [c.name, c.text]));
    const nameOf = (memberId: string) =>
      (result.thetaOverrides.get(memberId) as { name: string }).name;
    const p1Name = nameOf("ring#0#P");
    const p2Name = nameOf("ring#1#P");
    const p3Name = nameOf("ring#2#P");
    expect(byName.get(p1Name)).toBe("0");
    expect(byName.get(p2Name)).toBe("120");
    expect(byName.get(p3Name)).toBe("240");
  });
});

// slice-c-brief.md item 1: "the fallback order should be a named function
// with its own test rather than a chain of `??` at the emit site."
describe("resolveMemberAngle — the three-level fallback (per-count, own rule, even default)", () => {
  const evenDefault = num(45);
  const ownRule = num(180);

  it("uses the per-count override for the branch it names", () => {
    const overrides = new Map([[2, num(30)]]);
    expect(resolveMemberAngle(2, overrides, ownRule, evenDefault)).toEqual(
      num(30),
    );
  });

  it("falls through to the member's own rule at a count with no override", () => {
    const overrides = new Map([[2, num(30)]]);
    expect(resolveMemberAngle(5, overrides, ownRule, evenDefault)).toEqual(
      ownRule,
    );
  });

  it("falls through to the even default when neither an override nor a rule exists", () => {
    expect(resolveMemberAngle(5, undefined, undefined, evenDefault)).toEqual(
      evenDefault,
    );
  });

  it("an override at the exact count in question wins even over an own rule", () => {
    const overrides = new Map([[3, num(99)]]);
    expect(resolveMemberAngle(3, overrides, ownRule, evenDefault)).toEqual(
      num(99),
    );
  });

  it("an empty override map behaves exactly like no override map at all", () => {
    expect(resolveMemberAngle(2, new Map(), ownRule, evenDefault)).toEqual(
      ownRule,
    );
  });
});

describe("buildPrologue — a per-count override (slice-c-brief.md item 1)", () => {
  it("emits the override only in the branch it names, the own rule in branches with none, and the even default elsewhere", () => {
    const group = oneSlotRing(); // rotation num(0), patternLength 1, repeats 8
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(180) }, // an authored, count-independent rule
      nudged: true,
      thetaPerCount: { 4: num(77) }, // overrides ONLY the 4-player branch
    };
    const namer = new NameAllocator();
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      namer,
      4,
      IDENTITY_RESOLVER,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;

    // Re-derive every branch's own value for P2 by re-running buildPrologue at each count's own preview.
    const valueAt = (count: number): string => {
      const r = buildPrologue(
        [group],
        [p2],
        new Map(),
        new NameAllocator(),
        count,
        IDENTITY_RESOLVER,
      );
      const name = (r.thetaOverrides.get("ring#1#P") as { name: string }).name;
      return new Map(r.liveDegCells.map((c) => [c.name, c.text])).get(name)!;
    };
    expect(valueAt(4)).toBe("77"); // the override's own branch
    expect(valueAt(2)).toBe("180"); // the own rule, count-independent, elsewhere
    expect(valueAt(3)).toBe("180");

    // The currently-previewed count (4) is the override too, confirmed via the live result itself.
    expect(
      new Map(result.liveDegCells.map((c) => [c.name, c.text])).get(p2Name),
    ).toBe("77");
  });

  it("an override can itself reference a hoisted RandomParam owned by the member's own player index, same as an own rule can", () => {
    const group = oneSlotRing();
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(0) },
      thetaPerCount: { 2: { k: "param", id: "dist" } },
    };
    const resolveExprParams = (
      e: Expr,
      ownerPlayer: number | undefined,
    ): Expr =>
      e.k === "param" && e.id === "dist" ? sym(`ALP_DIST_P${ownerPlayer}`) : e;
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      new NameAllocator(),
      2,
      resolveExprParams,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const cell = result.liveDegCells.find((c) => c.name === p2Name)!;
    expect(cell.tokens).toContain("ALP_DIST_P2");
  });

  it("a member with no thetaPerCount at all is unaffected, matching pre-slice-C behaviour exactly", () => {
    const group = oneSlotRing();
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(180) },
      nudged: true,
    };
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    expect(
      new Map(result.liveDegCells.map((c) => [c.name, c.text])).get(p2Name),
    ).toBe("180");
  });
});

describe("buildPrologue — guard propagation down a chain (per-player-escalation.md Sec.4.5 composition paragraph)", () => {
  it("a placement chained to a perPlayer group member inherits that member's own guard, not an unguarded default", () => {
    const group = oneSlotRing();
    const aux: Placement = {
      id: "aux",
      parent: "ring#2#P",
      frame: "radial",
      label: "aux",
      offset: { kind: "polar", r: num(10), theta: num(0) },
    };
    const result = buildPrologue(
      [group],
      [aux],
      new Map(),
      new NameAllocator(),
      8,
      IDENTITY_RESOLVER,
    );
    expect(result.guardLabels.get("aux")).toContain("AT_LEAST_3"); // repeat index 2 -> player 3
  });

  it("a placement chained to player 1's own member inherits no guard, same as player 1 itself", () => {
    const group = oneSlotRing();
    const aux: Placement = {
      id: "aux",
      parent: "ring#0#P",
      frame: "radial",
      label: "aux",
      offset: { kind: "polar", r: num(10), theta: num(0) },
    };
    const result = buildPrologue(
      [group],
      [aux],
      new Map(),
      new NameAllocator(),
      8,
      IDENTITY_RESOLVER,
    );
    expect(result.guardLabels.get("aux")).toBeUndefined();
  });

  it("a placement outside any perPlayer group's chain is simply unguarded", () => {
    const group = oneSlotRing();
    const standalone: Placement = {
      id: "solo",
      parent: "center",
      frame: "radial",
      label: "solo",
      offset: { kind: "polar", r: num(10), theta: num(0) },
    };
    const result = buildPrologue(
      [group],
      [standalone],
      new Map(),
      new NameAllocator(),
      8,
      IDENTITY_RESOLVER,
    );
    expect(result.guardLabels.get("solo")).toBeUndefined();
  });
});

describe("buildPrologue — a symbolic rotation keeps steering every player's angle (mirrors expand.ts's own 'must survive a symbolic group')", () => {
  it("folds the rotation reference into every branch's DEG expression rather than dropping it", () => {
    const group = oneSlotRing({ rotation: sym("ROTATION_PLAYER") });
    const result = buildPrologue(
      [group],
      [],
      new Map([["ring", sym("ROTATION_PLAYER")]]),
      new NameAllocator(),
      2,
      IDENTITY_RESOLVER,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const cell = result.liveDegCells.find((c) => c.name === p2Name)!;
    expect(cell.tokens).toContain("ROTATION_PLAYER");
  });
});

// per-player-escalation.md Sec.5, slice-b-brief.md item 2: "the prologue
// constant's VALUE is the member's own rule where it has one, and the even
// default otherwise." This is the whole slice, and hazard 1 is getting it
// backwards (clobbering the rule with the default).
describe("buildPrologue — an authored member theta survives into the prologue (slice-b-brief.md item 2)", () => {
  /** Every line of `text` naming `name`'s own #const, in branch order (1..8), whichever branches it appears in. */
  function constLinesFor(text: string, name: string): string[] {
    return text
      .split("\n")
      .filter((line) => line.startsWith(`#const ${name} `));
  }

  it("a member's rule — Bulls_Eyes' own DEGREES_P2 shape, referencing a perPlayer param owned by ITS player index — is used in every branch it appears in, unchanged by count", () => {
    const group = oneSlotRing(); // rotation num(0), patternLength 1, repeats 8
    const p2Rule: Expr = bin(
      "+",
      { k: "param", id: "dist" },
      sym("ALP_ROTATION"),
    );
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: p2Rule },
      nudged: true,
    };
    // Owner-aware, mirroring emitModel.ts's own closure: a perPlayer param's
    // name depends on WHICH player is asking, which is exactly what buildPrologue
    // has to thread through correctly for this to prove anything.
    const resolveExprParams = (
      e: Expr,
      ownerPlayer: number | undefined,
    ): Expr => {
      function walk(n: Expr): Expr {
        if (n.k === "param" && n.id === "dist")
          return sym(`ALP_DIST_P${ownerPlayer}`);
        if (n.k === "bin") return bin(n.op, walk(n.l), walk(n.r));
        return n;
      }
      return walk(e);
    };
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      new NameAllocator(),
      5,
      resolveExprParams,
    );

    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const lines = constLinesFor(result.text, p2Name);
    // Player 2 exists at every count from 2 through 8 — 7 branches.
    expect(lines).toHaveLength(7);
    // The SAME rule, resolved for player 2's OWN copy of the param, in every one — never the even default's per-count-varying literal (45 at 8, 180 at 2, ...).
    for (const line of lines)
      expect(line).toBe(`#const ${p2Name} (ALP_DIST_P2 + ALP_ROTATION)`);
  });

  it("a member whose stored theta happens to equal the even-default expansion is NOT treated as having a rule — the even default still varies with count", () => {
    const group = oneSlotRing(); // rotation num(0)
    // evenAngleOffsetDegrees(1, 0, 1, 8) === 45, exactly what expand.ts would
    // bake for this member with no authored slot.theta — structurally
    // identical to the default, so this must NOT freeze it at 45.
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: add(num(0), num(45)) },
    };
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const byName = new Map(result.liveDegCells.map((c) => [c.name, c.text]));
    // At count 3 the even default for player 2 (repeat index 1) is 120, not 45.
    expect(byName.get(p2Name)).toBe("120");
  });

  it("only the ruled member's own branches change — an untouched sibling in the same ring still gets the varying even default", () => {
    const group = oneSlotRing();
    const p2: Placement = {
      id: "ring#1#P",
      parent: "center",
      frame: "radial",
      label: "P2",
      offset: { kind: "polar", r: num(30), theta: num(180) }, // an authored, count-independent rule
      nudged: true,
    };
    const result = buildPrologue(
      [group],
      [p2],
      new Map(),
      new NameAllocator(),
      3,
      IDENTITY_RESOLVER,
    );
    const p2Name = (result.thetaOverrides.get("ring#1#P") as { name: string })
      .name;
    const p3Name = (result.thetaOverrides.get("ring#2#P") as { name: string })
      .name;
    const byName = new Map(result.liveDegCells.map((c) => [c.name, c.text]));
    expect(byName.get(p2Name)).toBe("180"); // player 2's own rule, unaffected by count
    expect(byName.get(p3Name)).toBe("240"); // player 3's even default at count 3 (untouched)
  });
});
