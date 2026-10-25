// docs/name-lookup-design.md slice C, what the Breakdown does with a name right
// after it is committed. Real language.json and game-constants.json through
// the shared indexes, never a hand-built table.

import { describe, expect, it } from "vitest";
import type { ArgumentDef } from "../../parser/language";
import type { SlotKind } from "../../parser/nameLookup";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import {
  commentOpenWarning,
  defaultMeaning,
  moveUpRefusal,
  reviewCommit,
} from "../constReview";

const lang = loadLanguage();

function argDef(attribute: string): ArgumentDef {
  const def = lang.attributes.find((a) => a.name === attribute)?.arguments?.[0];
  if (!def) throw new Error(`no argument on ${attribute}`);
  return def;
}
const terrain: SlotKind = { kind: "argument", def: argDef("terrain_type") };
const condition: SlotKind = { kind: "condition" };

/** Review the `nth` use of `word` in `source`, in the slot given. */
function review(source: string, word: string, slot: SlotKind, nth = 0) {
  const parse = parseRms(source, lang);
  let at = -1;
  for (let i = 0; i <= nth; i++) at = source.indexOf(word, at + 1);
  return reviewCommit(parse, word, at, slot);
}

const HEAD = "<LAND_GENERATION>\ncreate_land {\n  ";

describe("reviewCommit, a name that resolves", () => {
  it("flashes a built-in and names its kind", () => {
    const r = review(`${HEAD}terrain_type GRASS\n}`, "GRASS", terrain);
    expect(r.kind).toBe("flash");
    if (r.kind === "flash")
      expect(r.message).toMatch(/^GRASS is a built-in terrain/);
  });

  it("flashes the script's own #const defined above, with its line", () => {
    const src = `#const MY_FOREST 10\n${HEAD}terrain_type MY_FOREST\n}`;
    const r = review(src, "MY_FOREST", terrain, 1);
    expect(r).toEqual({
      kind: "flash",
      message: "MY_FOREST is your #const on line 1",
    });
  });

  it("flashes a #const defined inside a branch and says so (Q5)", () => {
    const src = `if TINY_MAP\n#const MY_FOREST 10\nendif\n${HEAD}terrain_type MY_FOREST\n}`;
    const r = review(src, "MY_FOREST", terrain, 1);
    expect(r.kind).toBe("flash");
    if (r.kind === "flash") expect(r.message).toMatch(/inside a branch/);
  });

  it("does not flash a number", () => {
    expect(review(`${HEAD}terrain_type 10\n}`, "10", terrain).kind).toBe(
      "none",
    );
  });
});

describe("reviewCommit, a name our data does not know (Sec.7)", () => {
  it("offers to create it, with the closest built-in as Did you mean and as the value", () => {
    const r = review(`${HEAD}terrain_type FORREST\n}`, "FORREST", terrain);
    expect(r.kind).toBe("offer");
    if (r.kind !== "offer") return;
    expect(r.didYouMean).toBe("FOREST");
    expect(r.defaultValue.value).toBe(10); // FOREST's id, Sec.8.1's first row
    expect(r.holder?.kind).toBe("command");
  });

  it("offers a plain default when nothing is close", () => {
    const r = review(`${HEAD}terrain_type ZZQQ\n}`, "ZZQQ", terrain);
    expect(r.kind).toBe("offer");
    if (r.kind === "offer") expect(r.didYouMean).toBeUndefined();
  });

  it("makes no offer in a script that includes another file (Sec.7.1)", () => {
    const src = `#include_drs random_map.def\n${HEAD}terrain_type FORREST\n}`;
    expect(review(src, "FORREST", terrain).kind).toBe("none");
  });

  it("makes no offer in a condition slot, which reads #define", () => {
    const src = "if NOPE_FLAG\nendif";
    expect(review(src, "NOPE_FLAG", condition).kind).toBe("none");
  });

  it("makes no offer when the name exists under another kind (an object in a terrain slot)", () => {
    expect(review(`${HEAD}terrain_type GOLD\n}`, "GOLD", terrain).kind).toBe(
      "none",
    );
  });
});

describe("reviewCommit, a name defined below the use (Sec.9)", () => {
  it("reports the line and that the #const can move up", () => {
    const src = `${HEAD}terrain_type MY_FOREST\n}\n#const MY_FOREST 10\n`;
    const r = review(src, "MY_FOREST", terrain);
    expect(r.kind).toBe("definedBelow");
    if (r.kind !== "definedBelow") return;
    expect(r.line).toBe(5);
    expect(r.plan.ok).toBe(true);
  });

  it("hides the move for a definition inside a branch, and says why", () => {
    const src = `${HEAD}terrain_type MY_FOREST\n}\nif TINY_MAP\n#const MY_FOREST 10\nendif\n`;
    const r = review(src, "MY_FOREST", terrain);
    expect(r.kind).toBe("definedBelow");
    if (r.kind !== "definedBelow") return;
    expect(r.plan.ok).toBe(false);
    expect(moveUpRefusal(r.plan, "MY_FOREST", r.line)).toMatch(
      /inside a branch/,
    );
  });

  it("names the const a moved definition would break", () => {
    const src = `${HEAD}terrain_type B\n}\n#const A 1\n#const B (A + 1)\n`;
    const r = review(src, "B", terrain);
    expect(r.kind).toBe("definedBelow");
    if (r.kind !== "definedBelow") return;
    expect(moveUpRefusal(r.plan, "B", r.line)).toMatch(/reads A/);
  });
});

describe("reviewCommit, a condition", () => {
  it("flashes a script name and nothing else", () => {
    const src = "#define BIG\nif BIG\nendif";
    const r = review(src, "BIG", condition, 1);
    expect(r.kind).toBe("flash");
    // A predefined label is vocabulary, not the person's own const.
    expect(review("if TINY_MAP\nendif", "TINY_MAP", condition).kind).toBe(
      "none",
    );
  });
});

describe("strip wording", () => {
  it("says what the number means in words, never as a comment", () => {
    const r = review(`${HEAD}terrain_type FORREST\n}`, "FORREST", terrain);
    if (r.kind !== "offer") throw new Error("expected an offer");
    expect(defaultMeaning(r.defaultValue)).toMatch(/^10 is FOREST/);
  });

  it("warns about 69 and only 69 (RMS0111)", () => {
    expect(commentOpenWarning(69)).toMatch(/RMS0111/);
    expect(commentOpenWarning(70)).toBeUndefined();
  });
});
