// Item 1.5 of land-placement-constants-chains-drag-brief.md, the pure half of
// the Constants section.

import { describe, expect, it } from "vitest";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../../parser/parser";
import { num, sym, add } from "../../compiler/expr";
import type { AlpModel } from "../../fence";
import type { LandRole } from "../../model";
import { collectScriptConstUses } from "../formulaField";
import {
  addPanelConstant,
  renamePanelConstant,
  removePanelConstant,
  uniqueConstantName,
} from "../modelOps";

const lang = loadLanguage();

function role(baseSize = sym("SIZE")): LandRole {
  return {
    id: "r1",
    label: "R",
    terrain: { k: "name", name: "GRASS" },
    baseSize,
    baseElevation: num(0),
    extent: { kind: "percent", value: add(sym("SIZE"), num(2)) },
    zone: { kind: "none" },
    assign: { kind: "none" },
  };
}

function modelUsing(...names: string[]): AlpModel {
  return {
    v: 1,
    placements: [],
    roles: [role(names.map((n) => sym(n)).reduce((a, b) => add(a, b), num(0)))],
    randomParams: [],
    constants: [],
    groups: [],
  };
}

function rows(source: string, model: AlpModel) {
  const parse = parseRms(source, lang);
  return collectScriptConstUses(model, parse, null);
}

describe("collectScriptConstUses", () => {
  it("lists a plain constant as editable with the span of its number only", () => {
    const src = "#const SIZE 40 /* note */\n";
    const out = rows(src, modelUsing("SIZE"));
    expect(out).toHaveLength(1);
    expect(out[0].readOnlyReason).toBeUndefined();
    expect(out[0].value).toBe(40);
    expect(out[0].uses).toBe(2);
    expect(out[0].line).toBe(1);
    const { start, end } = out[0].valueSpan!;
    expect(src.slice(start, end)).toBe("40");
  });

  it("skips names the script does not define", () => {
    expect(rows("#const OTHER 1\n", modelUsing("SIZE"))).toEqual([]);
  });

  it("skips a name defined only inside the fence", () => {
    const src = "#const SIZE 40\n";
    const parse = parseRms(src, lang);
    const out = collectScriptConstUses(modelUsing("SIZE"), parse, {
      start: 0,
      end: src.length,
    });
    expect(out).toEqual([]);
  });

  it("skips a name the model owns as a panel constant", () => {
    const m = modelUsing("SIZE");
    const withOwn = {
      ...m,
      constants: [{ id: "c", name: "SIZE", value: num(1) }],
    };
    expect(rows("#const SIZE 40\n", withOwn)).toEqual([]);
  });

  it("is read-only for a #define", () => {
    const out = rows("#define SIZE\n", modelUsing("SIZE"));
    expect(out[0].readOnlyReason).toBe("a #define has no number");
  });

  it("is read-only inside a branch", () => {
    const src = "start_random\npercent_chance 50 #const SIZE 4\nend_random\n";
    const out = rows(src, modelUsing("SIZE"));
    expect(out[0].readOnlyReason).toBe("defined inside an if or random branch");
  });

  it("is read-only when defined more than once", () => {
    const out = rows("#const SIZE 4\n#const SIZE 5\n", modelUsing("SIZE"));
    expect(out[0].readOnlyReason).toBe("defined 2 times");
  });

  it("is read-only when the value is not a plain number", () => {
    expect(
      rows("#const SIZE 4 + 5\n", modelUsing("SIZE"))[0].readOnlyReason,
    ).toBe("its value is not a plain number");
    expect(
      rows("#const SIZE OTHER\n", modelUsing("SIZE"))[0].readOnlyReason,
    ).toBe("its value is not a plain number");
  });

  it("lets a number be followed by a comment or a later line", () => {
    expect(
      rows("#const SIZE 4 /* c */ #const B 1\n", modelUsing("SIZE"))[0]
        .readOnlyReason,
    ).toBeUndefined();
    expect(
      rows("#const SIZE 4\n#const B 1\n", modelUsing("SIZE"))[0].readOnlyReason,
    ).toBeUndefined();
  });
});

describe("panel constant operations", () => {
  it("adds with a fresh id and numbers a taken name", () => {
    const { model, constantId } = addPanelConstant(
      modelUsing(),
      "NEW_CONST",
      0,
    );
    expect(model.constants).toHaveLength(1);
    expect(model.constants[0].id).toBe(constantId);
    expect(uniqueConstantName(model, "NEW_CONST")).toBe("NEW_CONST_2");
    expect(uniqueConstantName(model, "NEW_CONST", new Set(["FREE"]))).toBe(
      "NEW_CONST_2",
    );
  });

  it("rename rewrites every use in the model", () => {
    const base = modelUsing("SIZE");
    const { model } = addPanelConstant(base, "SIZE", 5);
    const next = renamePanelConstant(model, model.constants[0].id, "BIG");
    expect(next.constants[0].name).toBe("BIG");
    expect(JSON.stringify(next)).not.toContain('"name":"SIZE"');
    expect(JSON.stringify(next.roles)).toContain('"name":"BIG"');
    expect(JSON.stringify(next.roles)).not.toContain('"SIZE"');
  });

  it("remove works while a formula still names it", () => {
    const { model } = addPanelConstant(modelUsing("SIZE"), "SIZE", 5);
    const next = removePanelConstant(model, model.constants[0].id);
    expect(next.constants).toEqual([]);
    expect(JSON.stringify(next.roles)).toContain('"SIZE"');
  });
});
