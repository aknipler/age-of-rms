// Sec.6.2 acceptance (slice-3 item 2): "a generated create_land references
// role constants by name; a hand-edited attribute detaches that land from
// its role and the detachment is detectable (a pure predicate)."

import { describe, expect, it } from "vitest";
import {
  ASSIGN_TO_PLAYER_PER_REPEAT,
  ROLE_OPTIONAL_ATTRIBUTES,
} from "../model";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import type { CommandNode } from "../../../../parser/types";
import { NameAllocator } from "../compiler/naming";
import { emitRole } from "../roleEmit";
import {
  buildCreateLandSkeleton,
  buildLandAttachmentExpectations,
  checkLandAttachment,
  type AttachmentExpectation,
} from "../landCommand";
import type { LandRole } from "../model";

const lang = loadLanguage();

function findCreateLand(source: string): CommandNode {
  const parsed = parseRms(source, lang);
  for (const item of parsed.script.preamble) {
    if (
      item.kind === "command" &&
      parsed.tokens[item.name].text === "create_land"
    )
      return item;
  }
  throw new Error("no create_land found in fixture");
}

function neutralBRole(): LandRole {
  return {
    id: "role-b",
    label: "Neutral B",
    terrain: { k: "name", name: "DLC_BOGLAND" },
    baseSize: { k: "num", v: 7 },
    baseElevation: { k: "num", v: 9 },
    extent: { kind: "percent", value: { k: "num", v: 0 } },
    zone: { kind: "perRepeat", base: 11, step: 11 },
    assign: { kind: "none" },
  };
}

describe("roleEmit.ts — Sec.6.2's role constants", () => {
  it("emits one #const per role attribute, referencing the terrain by name", () => {
    const namer = new NameAllocator();
    const { cells, names } = emitRole(neutralBRole(), namer);
    const byName = new Map(cells.map((c) => [c.name, c.text]));
    expect(byName.get(names.terrainName)).toBe("DLC_BOGLAND");
    expect(byName.get(names.baseSizeName)).toBe("7");
    expect(byName.get(names.baseElevationName)).toBe("9");
    expect(byName.get(names.extentName)).toBe("0");
    // perRepeat zone: no role-level constant (Sec.6.2's named exception).
    expect(names.fixedZoneName).toBeUndefined();
  });

  it("emits a role-level zone constant only for a fixed ZonePolicy", () => {
    const role: LandRole = {
      ...neutralBRole(),
      zone: { kind: "fixed", zone: 3 },
    };
    const namer = new NameAllocator();
    const { cells, names } = emitRole(role, namer);
    expect(names.fixedZoneName).toBeDefined();
    const cell = cells.find((c) => c.name === names.fixedZoneName);
    expect(cell?.text).toBe("3");
  });
});

describe("buildCreateLandSkeleton — every non-per-repeat attribute is a reference, never a literal", () => {
  it("references role constants and the placement's own X/Y names", () => {
    const namer = new NameAllocator();
    const role = neutralBRole();
    const { names } = emitRole(role, namer);
    const text = buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "ALP_X_R2_S3",
      yName: "ALP_Y_R2_S3",
      repeatIndex: 1,
    });

    expect(text).toContain(`terrain_type ${names.terrainName}`);
    expect(text).toContain(`base_size ${names.baseSizeName}`);
    expect(text).toContain(`base_elevation ${names.baseElevationName}`);
    expect(text).toContain(`land_percent ${names.extentName}`);
    expect(text).toContain("land_position ALP_X_R2_S3 ALP_Y_R2_S3");
    // perRepeat zone (base 11, step 11) at repeatIndex 1 -> literal 22, per
    // Sec.6.2's own worked example (aux-land zone 11/22 by repeat).
    expect(text).toContain("zone 22");
    expect(text).not.toContain("assign_to");
  });

  it("assign_to AT_PLAYER n is a literal (Sec.6.2's other named exception)", () => {
    const namer = new NameAllocator();
    const role: LandRole = {
      ...neutralBRole(),
      zone: { kind: "none" },
      assign: ASSIGN_TO_PLAYER_PER_REPEAT,
    };
    const { names } = emitRole(role, namer);
    const text = buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "ALP_X_P2",
      yName: "ALP_Y_P2",
      repeatIndex: 1,
    });
    // The FULL line, four arguments. `toContain("assign_to AT_PLAYER 2")`
    // was what this test asserted while the tool emitted two, and a
    // four-argument line satisfies that prefix just as well, so it pinned
    // nothing (role-attributes-escalation.md Sec.9 rev 1).
    expect(text.split("\n")).toContain("assign_to AT_PLAYER 2 0 0");
  });

  it("number_of_tiles rides on the extent union's discriminant, under its own name", () => {
    const namer = new NameAllocator();
    const role: LandRole = {
      ...neutralBRole(),
      extent: { kind: "tiles", value: { k: "num", v: 600 } },
    };
    const { cells, names } = emitRole(role, namer);
    expect(names.extentKind).toBe("tiles");
    expect(names.extentName).toMatch(/TILES/);
    expect(
      new Map(cells.map((c) => [c.name, c.text])).get(names.extentName),
    ).toBe("600");
    const text = buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "X",
      yName: "Y",
      repeatIndex: 0,
    });
    expect(text).toContain(`number_of_tiles ${names.extentName}`);
    expect(text).not.toContain("land_percent");
  });

  it("set_zone_randomly is a bare flag: no constant, no argument, no trailing space", () => {
    const namer = new NameAllocator();
    const role: LandRole = { ...neutralBRole(), zone: { kind: "random" } };
    const { names } = emitRole(role, namer);
    expect(names.fixedZoneName).toBeUndefined();
    const text = buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "X",
      yName: "Y",
    });
    expect(text.split("\n")).toContain("set_zone_randomly");
    expect(text).not.toMatch(/set_zone_randomly /);
    expect(text).not.toContain("zone ");
  });

  it("assign_to_player with a perRepeat slot is a literal; a fixed slot is a role constant the land references", () => {
    const perRepeat: LandRole = {
      ...neutralBRole(),
      zone: { kind: "none" },
      assign: {
        kind: "player",
        number: { kind: "perRepeat", base: 1, step: 1 },
      },
    };
    const { names: n1 } = emitRole(perRepeat, new NameAllocator());
    expect(
      buildCreateLandSkeleton({
        role: perRepeat,
        roleNames: n1,
        xName: "X",
        yName: "Y",
        repeatIndex: 2,
      }).split("\n"),
    ).toContain("assign_to_player 3");

    // Sec.4.2 rev 1: a fixed number is not per-repeat, so it is a reference,
    // and it is an Expr so a script's own #const can sit there
    // (CoastalForest.rms writes `assign_to AT_COLOR L1_COLOUR 0 0`).
    const fixed: LandRole = {
      ...neutralBRole(),
      zone: { kind: "none" },
      assign: {
        kind: "assignTo",
        target: "AT_COLOR",
        number: { kind: "fixed", value: { k: "sym", name: "L1_COLOUR" } },
        mode: -1,
        flags: 2,
      },
    };
    const namer = new NameAllocator();
    const { cells, names: n2 } = emitRole(fixed, namer);
    expect(n2.fixedAssignNumberName).toBeDefined();
    expect(
      new Map(cells.map((c) => [c.name, c.text])).get(
        n2.fixedAssignNumberName!,
      ),
    ).toBe("L1_COLOUR");
    const text = buildCreateLandSkeleton({
      role: fixed,
      roleNames: n2,
      xName: "X",
      yName: "Y",
    });
    expect(text.split("\n")).toContain(
      `assign_to AT_COLOR ${n2.fixedAssignNumberName} -1 2`,
    );
  });

  it("throws rather than silently omitting when a perRepeat zone has no repeatIndex", () => {
    const namer = new NameAllocator();
    const role = neutralBRole();
    const { names } = emitRole(role, namer);
    expect(() =>
      buildCreateLandSkeleton({
        role,
        roleNames: names,
        xName: "X",
        yName: "Y",
      }),
    ).toThrow();
  });
});

describe("checkLandAttachment — Sec.6.2's detachment predicate", () => {
  const expectations: AttachmentExpectation[] = [
    { attribute: "terrain_type", expectedArgs: ["ALP_ROLE_TERRAIN_NEUTRAL_B"] },
    {
      attribute: "land_position",
      expectedArgs: ["ALP_X_R2_S3", "ALP_Y_R2_S3"],
    },
    { attribute: "zone", expectedArgs: ["22"] },
  ];

  it("reports fully attached when every attribute matches exactly", () => {
    const land = findCreateLand(`
create_land
{
terrain_type ALP_ROLE_TERRAIN_NEUTRAL_B
land_position ALP_X_R2_S3 ALP_Y_R2_S3
zone 22
}
`);
    const parsed = parseRms(
      `
create_land
{
terrain_type ALP_ROLE_TERRAIN_NEUTRAL_B
land_position ALP_X_R2_S3 ALP_Y_R2_S3
zone 22
}
`,
      lang,
    );
    const report = checkLandAttachment(land, parsed.tokens, expectations);
    expect(report.attached).toBe(true);
    expect(report.attributes.every((a) => a.attached)).toBe(true);
  });

  it("detects a hand-edited literal as detachment, without disturbing the other attributes", () => {
    const source = `
create_land
{
terrain_type DLC_BOGLAND
land_position ALP_X_R2_S3 ALP_Y_R2_S3
zone 22
}
`;
    const land = findCreateLand(source);
    const parsed = parseRms(source, lang);
    const report = checkLandAttachment(land, parsed.tokens, expectations);
    expect(report.attached).toBe(false);
    const terrain = report.attributes.find(
      (a) => a.attribute === "terrain_type",
    )!;
    expect(terrain.present).toBe(true);
    expect(terrain.attached).toBe(false);
    expect(terrain.actualArgs).toEqual(["DLC_BOGLAND"]);
    // The land_position and zone lines were untouched, so THEY stay attached.
    // Detachment is per-attribute, not all-or-nothing for the land.
    expect(
      report.attributes.find((a) => a.attribute === "land_position")!.attached,
    ).toBe(true);
    expect(
      report.attributes.find((a) => a.attribute === "zone")!.attached,
    ).toBe(true);
  });

  it("detects a deleted attribute as detached (present: false)", () => {
    const source = `
create_land
{
land_position ALP_X_R2_S3 ALP_Y_R2_S3
zone 22
}
`;
    const land = findCreateLand(source);
    const parsed = parseRms(source, lang);
    const report = checkLandAttachment(land, parsed.tokens, expectations);
    const terrain = report.attributes.find(
      (a) => a.attribute === "terrain_type",
    )!;
    expect(terrain.present).toBe(false);
    expect(terrain.attached).toBe(false);
    expect(report.attached).toBe(false);
  });
});

describe("checkLandAttachment — a zero-argument flag (role-attributes-escalation.md Sec.4.4)", () => {
  const flagExpectation: AttachmentExpectation[] = [
    { attribute: "set_zone_randomly", expectedArgs: [] },
  ];

  it("reads a present flag as attached", () => {
    const source = "create_land\n{\nset_zone_randomly\n}\n";
    const report = checkLandAttachment(
      findCreateLand(source),
      parseRms(source, lang).tokens,
      flagExpectation,
    );
    expect(report.attached).toBe(true);
    expect(report.attributes[0].attached).toBe(true);
  });

  it("reads a missing flag as detached by deletion", () => {
    const source = "create_land\n{\nterrain_type GRASS\n}\n";
    const report = checkLandAttachment(
      findCreateLand(source),
      parseRms(source, lang).tokens,
      flagExpectation,
    );
    expect(report.attached).toBe(false);
    expect(report.attributes[0].present).toBe(false);
  });
});

describe("the optional attributes (role-attributes-escalation.md Sec.2, slice 2)", () => {
  function skeletonFor(role: LandRole, repeatIndex = 0): string[] {
    const { names } = emitRole(role, new NameAllocator());
    return buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "X",
      yName: "Y",
      repeatIndex,
    }).split("\n");
  }

  it.each(ROLE_OPTIONAL_ATTRIBUTES.map((a) => [a.attribute, a.field] as const))(
    "%s: set, one #const and one referencing line; absent, NOTHING at all (absent is not zero)",
    (attribute, field) => {
      const withIt: LandRole = {
        ...neutralBRole(),
        [field]: { k: "num", v: 37 },
      };
      const namer = new NameAllocator();
      const { cells, names } = emitRole(withIt, namer);
      const name = names.optional[field];
      expect(name).toBeDefined();
      expect(new Map(cells.map((c) => [c.name, c.text])).get(name!)).toBe("37");
      const lines = buildCreateLandSkeleton({
        role: withIt,
        roleNames: names,
        xName: "X",
        yName: "Y",
        repeatIndex: 0,
      }).split("\n");
      expect(lines).toContain(`${attribute} ${name}`);

      const without = neutralBRole();
      const { cells: c2, names: n2 } = emitRole(without, new NameAllocator());
      expect(n2.optional[field]).toBeUndefined();
      expect(c2.some((c) => c.name.includes(attribute.toUpperCase()))).toBe(
        false,
      );
      const text = buildCreateLandSkeleton({
        role: without,
        roleNames: n2,
        xName: "X",
        yName: "Y",
        repeatIndex: 0,
      });
      expect(text).not.toContain(attribute);
    },
  );

  it("land_id is written LAST, after the assign attribute (guide:1145, Sec.4.6)", () => {
    const role: LandRole = {
      ...neutralBRole(),
      zone: { kind: "fixed", zone: 3 },
      assign: ASSIGN_TO_PLAYER_PER_REPEAT,
      landId: { k: "num", v: 5 },
      clumpingFactor: { k: "num", v: 8 },
      circularBase: true,
    };
    const lines = skeletonFor(role);
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
    expect(at("land_id")).toBeGreaterThan(at("assign_to"));
    expect(at("land_id")).toBeGreaterThan(at("zone"));
    expect(at("land_id")).toBe(lines.length - 2); // the line before the closing brace
    // And the flag sits before the zone, with no trailing space.
    expect(lines).toContain("set_circular_base");
  });

  it("set_circular_base round-trips through checkLandAttachment as a zero-argument flag", () => {
    const role: LandRole = {
      ...neutralBRole(),
      zone: { kind: "none" },
      circularBase: true,
    };
    const { names } = emitRole(role, new NameAllocator());
    const expectations = buildLandAttachmentExpectations({
      role,
      roleNames: names,
      xName: "X",
      yName: "Y",
    });
    const source =
      buildCreateLandSkeleton({
        role,
        roleNames: names,
        xName: "X",
        yName: "Y",
      }) + "\n";
    const report = checkLandAttachment(
      findCreateLand(source),
      parseRms(source, lang).tokens,
      expectations,
    );
    expect(report.attached).toBe(true);
    const stripped = source.replace("set_circular_base\n", "");
    const report2 = checkLandAttachment(
      findCreateLand(stripped),
      parseRms(stripped, lang).tokens,
      expectations,
    );
    expect(
      report2.attributes.find((a) => a.attribute === "set_circular_base")!
        .present,
    ).toBe(false);
  });
});
