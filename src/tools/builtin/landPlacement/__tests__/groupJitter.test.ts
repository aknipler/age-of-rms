// per-player-escalation.md Sec.11: a per-player ring's jitter, added to
// each player's even default inside every count's branch. The last block
// runs an Applied script through the preview's real S0 and land placement,
// the path the app's map preview takes (CLAUDE.md, "sharing a helper with a
// consumer is not sharing its result").

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TextEdit } from "../../../../../tools-api/index";
import {
  loadLanguage,
  REPO_ROOT,
} from "../../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../../parser/language";
import { parseRms } from "../../../../parser/parser";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import { createTileGrid } from "../../../../preview/generator/grid";
import { placeLandOrigins } from "../../../../preview/generator/lands";
import type { ObjectConstant } from "../../../../preview/generator/objects";
import { computeApplyEdits } from "../applyEdits";
import { add, num, sym } from "../compiler/expr";
import type { AlpModel } from "../fence";
import { ASSIGN_TO_PLAYER_PER_REPEAT, type LandRole } from "../model";
import {
  addRing,
  applyGroupEdit,
  deleteRandomParam,
  isParamReferenced,
  removeGroupJitter,
  setGroupJitter,
  updatePlacement,
  updateRandomParam,
} from "../panel/modelOps";
import { jitteredEvenDefault } from "../prologue";

const lang = loadLanguage();
const NL = String.fromCharCode(10);
const SOURCE = "<PLAYER_SETUP>" + NL + "direct_placement" + NL;

function role(): LandRole {
  return {
    id: "player",
    label: "Player",
    terrain: { k: "name", name: "DIRT" },
    baseSize: { k: "num", v: 12 },
    baseElevation: { k: "num", v: 0 },
    extent: { kind: "percent", value: { k: "num", v: 8 } },
    zone: { kind: "perRepeat", base: 1, step: 1 },
    assign: ASSIGN_TO_PLAYER_PER_REPEAT,
  };
}

/** One role and a per-player ring wearing it, the shape the panel builds with + Shape and the One land per player box. */
function perPlayerRing(): { model: AlpModel; groupId: string } {
  const base: AlpModel = {
    v: 1,
    placements: [],
    roles: [role()],
    randomParams: [],
    groups: [],
  };
  const { model, groupId } = addRing(base, "player");
  const result = applyGroupEdit(
    model,
    groupId,
    { perPlayer: true, repeats: 8 },
    parseRms(SOURCE, lang),
    null,
  );
  return { model: result!.model, groupId };
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  let text = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.newText + text.slice(e.end);
  return text;
}

function applied(model: AlpModel, playerCount = 8) {
  const { edits, emissionProblems } = computeApplyEdits(
    parseRms(SOURCE, lang),
    model,
    lang,
    new Map(),
    playerCount,
  );
  return { text: applyEdits(SOURCE, edits), emissionProblems };
}

describe("jitteredEvenDefault", () => {
  const even = add(add(sym("ROT"), num(0)), num(45));

  it("leaves the even default alone when the group has no jitter", () => {
    expect(jitteredEvenDefault(even, undefined, undefined, 1, 8)).toBe(even);
  });

  it("degrees adds the draw after the even default", () => {
    expect(jitteredEvenDefault(even, sym("J"), "deg", 1, 8)).toEqual(
      add(even, sym("J")),
    );
  });

  it("percent scales by this count's gap and keeps one left spine", () => {
    // J * 360 / 3 / 100 + ROT + 0 + 45. Every right operand is a leaf,
    // which is what lets the emit rule write it as one line.
    const e = jitteredEvenDefault(even, sym("J"), "percent", 1, 3);
    const share = {
      k: "bin",
      op: "/",
      l: {
        k: "bin",
        op: "/",
        l: { k: "bin", op: "*", l: sym("J"), r: num(360) },
        r: num(3),
      },
      r: num(100),
    };
    expect(e).toEqual(
      add(add(add(share as never, sym("ROT")), num(0)), num(45)),
    );
  });
});

describe("a jittered per-player ring's emitted script", () => {
  it("each player's angle reads its own draw, at every count", () => {
    const { model, groupId } = perPlayerRing();
    const { text, emissionProblems } = applied(
      setGroupJitter(model, groupId, "deg", 12),
    );
    expect(emissionProblems).toEqual([]);
    expect(text).toMatch(/#const ALP_PARAM_JITTER_RING_\d+_P1 rnd\(-12,12\)/);
    expect(text).toMatch(/#const ALP_PARAM_JITTER_RING_\d+_P8 rnd\(-12,12\)/);
    const deg = text.split(NL).filter((l) => /#const ALP_DEG_P\d /.test(l));
    // One line per player per branch, 1 + 2 + ... + 8.
    expect(deg).toHaveLength(36);
    for (const line of deg) {
      const player = /ALP_DEG_P(\d) /.exec(line)![1];
      expect(line).toMatch(
        new RegExp(`ALP_PARAM_JITTER_RING_\\d+_P${player}\\b`),
      );
    }
  });

  it("percent names each count's own gap", () => {
    const { model, groupId } = perPlayerRing();
    const { text } = applied(setGroupJitter(model, groupId, "percent", 30));
    const branch3 = text.split("elseif 3_PLAYER_GAME")[1]!.split("elseif")[0]!;
    expect(branch3).toMatch(/_P2 \* 360 \/ 3 \/ 100 \+/);
    const branch8 = text.split("elseif 8_PLAYER_GAME")[1]!.split("endif")[0]!;
    expect(branch8).toMatch(/_P2 \* 360 \/ 8 \/ 100 \+/);
  });

  it("adds no line beyond the eight draws, in either unit", () => {
    const { model, groupId } = perPlayerRing();
    const lines = (m: AlpModel) =>
      applied(m)
        .text.split(NL)
        .filter((l) => l.startsWith("#const")).length;
    const plain = lines(model);
    expect(lines(setGroupJitter(model, groupId, "deg", 12))).toBe(plain + 8);
    expect(lines(setGroupJitter(model, groupId, "percent", 30))).toBe(
      plain + 8,
    );
  });

  it("leaves a member with its own authored angle where it was put", () => {
    const { model, groupId } = perPlayerRing();
    const group = model.groups.find((g) => g.id === groupId)!;
    const p2 = group.members[1]!;
    const authored = updatePlacement(model, p2, {
      nudged: true,
      offset: { kind: "polar", r: num(30), theta: num(100) },
    });
    const { text } = applied(setGroupJitter(authored, groupId, "deg", 12));
    const p2Lines = text.split(NL).filter((l) => /#const ALP_DEG_P2 /.test(l));
    expect(p2Lines.length).toBeGreaterThan(0);
    for (const line of p2Lines) expect(line).not.toContain("JITTER");
  });
});

describe("the emitter refuses a jitter that would not jitter", () => {
  it("on a ring that is not per player", () => {
    const { model, groupId } = perPlayerRing();
    const jittered = setGroupJitter(model, groupId, "deg", 12);
    // Written straight onto the model, the way a hand-edited fence would,
    // since applyGroupEdit clears jitter when per player goes off.
    const forced: AlpModel = {
      ...jittered,
      groups: jittered.groups.map((g) => ({ ...g, perPlayer: false })),
    };
    expect(applied(forced).emissionProblems.map((p) => p.name)).toContain(
      `group:${groupId}:jitter`,
    );
  });

  it("when its param is shared by every player", () => {
    const { model, groupId } = perPlayerRing();
    const jittered = setGroupJitter(model, groupId, "deg", 12);
    const paramId = jittered.groups[0]!.jitter!.param;
    const shared = updateRandomParam(jittered, paramId, { perPlayer: false });
    expect(applied(shared).emissionProblems.map((p) => p.name)).toContain(
      `group:${groupId}:jitter`,
    );
  });
});

describe("jitter model ops", () => {
  it("creates one per-player param and updates it on a second press", () => {
    const { model, groupId } = perPlayerRing();
    const once = setGroupJitter(model, groupId, "deg", 12);
    const twice = setGroupJitter(once, groupId, "percent", 30);
    expect(twice.randomParams).toHaveLength(model.randomParams.length + 1);
    const param = twice.randomParams.at(-1)!;
    expect(param).toMatchObject({ min: -30, max: 30, perPlayer: true });
    expect(twice.groups[0]!.jitter).toEqual({
      param: param.id,
      unit: "percent",
    });
  });

  it("refuses a ring that is not per player, and an amount under 1", () => {
    const base: AlpModel = {
      v: 1,
      placements: [],
      roles: [role()],
      randomParams: [],
      groups: [],
    };
    const { model, groupId } = addRing(base, "player");
    expect(setGroupJitter(model, groupId, "deg", 12)).toBe(model);
    const ring = perPlayerRing();
    expect(setGroupJitter(ring.model, ring.groupId, "deg", 0)).toBe(ring.model);
  });

  it("keeps its param from being deleted while the ring uses it", () => {
    const { model, groupId } = perPlayerRing();
    const jittered = setGroupJitter(model, groupId, "deg", 12);
    const paramId = jittered.groups[0]!.jitter!.param;
    expect(isParamReferenced(jittered, paramId)).toBe(true);
    expect(deleteRandomParam(jittered, paramId)).toBe(jittered);
  });

  it("remove deletes the key and the param", () => {
    const { model, groupId } = perPlayerRing();
    const removed = removeGroupJitter(
      setGroupJitter(model, groupId, "deg", 12),
      groupId,
    );
    expect("jitter" in removed.groups[0]!).toBe(false);
    expect(removed.randomParams).toEqual(model.randomParams);
  });

  it("turning per player off takes the jitter with it", () => {
    const { model, groupId } = perPlayerRing();
    const off = applyGroupEdit(
      setGroupJitter(model, groupId, "deg", 12),
      groupId,
      { perPlayer: false },
      parseRms(SOURCE, lang),
      null,
    )!.model;
    expect(off.groups[0]!.jitter).toBeUndefined();
    expect(off.randomParams).toEqual(model.randomParams);
    expect(applied(off).emissionProblems).toEqual([]);
  });
});

// The preview rolls every rnd() for real at each seed, so this is the first
// place the draw actually moves a land. The control arm is the same ring
// with no jitter, and it has to come out evenly spaced, or the jittered
// arm's spread could be rounding rather than jitter.
describe("a jittered ring in the map preview", () => {
  const constants = (
    JSON.parse(
      readFileSync(
        join(REPO_ROOT, "reference", "data", "game-constants.json"),
        "utf8",
      ),
    ) as { constants: ObjectConstant[] }
  ).constants;
  const refDb = buildLanguageIndex(lang);

  /** The circular gaps between the players' bearings around the centre, in degrees, at one seed and 4 players. */
  function gaps(text: string, seed: number): number[] {
    const instantiated = instantiateScript(
      parseRms(text, lang),
      refDb,
      { playerCount: 4, mapSize: "Normal", teams: [] },
      seed,
    );
    const dim = instantiated.dim;
    const { origins } = placeLandOrigins(
      instantiated,
      createTileGrid(dim, 0),
      constants,
      seed,
    );
    expect(origins).toHaveLength(4);
    const bearings = origins
      .map(
        (o) =>
          ((Math.atan2(o.y - dim / 2, o.x - dim / 2) * 180) / Math.PI + 360) %
          360,
      )
      .sort((a, b) => a - b);
    return bearings.map((b, i) =>
      i === bearings.length - 1 ? bearings[0]! + 360 - b : bearings[i + 1]! - b,
    );
  }

  const seeds = [1, 7, 42, 12345, 999];
  // land_position takes whole percents, so at 30% out a land can sit about
  // 2 degrees off its true bearing, and a gap compares two of them.
  const ROUNDING = 4;

  it("the control ring stays evenly spaced at every seed", () => {
    const { model } = perPlayerRing();
    const text = applied(model, 4).text;
    for (const seed of seeds)
      for (const gap of gaps(text, seed))
        expect(Math.abs(gap - 90)).toBeLessThan(ROUNDING);
  });

  it("degrees jitter moves the lands, never past its bound", () => {
    const { model, groupId } = perPlayerRing();
    const text = applied(setGroupJitter(model, groupId, "deg", 20), 4).text;
    let moved = false;
    for (const seed of seeds) {
      for (const gap of gaps(text, seed)) {
        // Two neighbours can close or open by at most 2 * 20.
        expect(Math.abs(gap - 90)).toBeLessThan(40 + ROUNDING);
        if (Math.abs(gap - 90) > ROUNDING + 1) moved = true;
      }
    }
    expect(moved).toBe(true);
  });

  it("percent jitter is scaled by the 4-player gap of 90 degrees", () => {
    const { model, groupId } = perPlayerRing();
    // 40% of 90 is 36 degrees either way.
    const text = applied(setGroupJitter(model, groupId, "percent", 40), 4).text;
    let moved = false;
    for (const seed of seeds) {
      for (const gap of gaps(text, seed)) {
        expect(Math.abs(gap - 90)).toBeLessThan(72 + ROUNDING);
        if (Math.abs(gap - 90) > ROUNDING + 1) moved = true;
      }
    }
    expect(moved).toBe(true);
  });
});
