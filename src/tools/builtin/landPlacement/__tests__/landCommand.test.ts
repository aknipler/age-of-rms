// Sec.6.2 acceptance (slice-3 item 2): "a generated create_land references
// role constants by name; a hand-edited attribute detaches that land from
// its role and the detachment is detectable (a pure predicate)."

import { describe, expect, it } from "vitest";
import { parseRms } from "../../../../parser/parser";
import { loadLanguage } from "../../../../parser/__tests__/testUtils";
import type { CommandNode } from "../../../../parser/types";
import { NameAllocator } from "../compiler/naming";
import { emitRole } from "../roleEmit";
import {
  buildCreateLandSkeleton,
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
    landPercent: { k: "num", v: 0 },
    zone: { kind: "perRepeat", base: 11, step: 11 },
    assignToPlayer: false,
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
    expect(byName.get(names.landPercentName)).toBe("0");
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
    expect(text).toContain(`land_percent ${names.landPercentName}`);
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
      assignToPlayer: true,
    };
    const { names } = emitRole(role, namer);
    const text = buildCreateLandSkeleton({
      role,
      roleNames: names,
      xName: "ALP_X_P2",
      yName: "ALP_Y_P2",
      repeatIndex: 1,
    });
    expect(text).toContain("assign_to AT_PLAYER 2");
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
