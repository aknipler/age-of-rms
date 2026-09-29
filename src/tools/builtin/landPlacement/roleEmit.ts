// Sec.6.2: a LandRole's own attributes become `#const`s a create_land
// skeleton references by NAME, never by literal, so editing the role is
// editing one line, and every land wearing it follows. `terrain` is a `Ref`
// (Sec.5.0: a name is not a number, and this repo already paid once for
// mixing the two, BUG-015), so it emits differently from the three `Expr`
// fields, which go through the ordinary math-compiler backend (emit.ts),
// the same code frame.ts's X/Y cells use, so a role attribute that happens
// to need hoisting (a formula, not just a literal) gets it for free.

import type { Ref } from "../../../../tools-api/index";
import {
  ROLE_OPTIONAL_ATTRIBUTES,
  type LandExtent,
  type LandRole,
  type RoleOptionalField,
  type RoleOverrides,
} from "./model";
import { emitCells, type EmittedConst } from "./compiler/emit";
import type { NameAllocator } from "./compiler/naming";

export interface RoleConstNames {
  terrainName: string;
  baseSizeName: string;
  baseElevationName: string;
  /**
   * The constant behind `land_percent` OR `number_of_tiles`; which attribute
   * it is written under rides on `extentKind`, never on a second name, so
   * the mutex pair stays unrepresentable through emission as well as in the
   * model (role-attributes-escalation.md Sec.4.1).
   */
  extentName: string;
  extentKind: LandExtent["kind"];
  /**
   * Present only when `role.zone.kind === "fixed"`. A `perRepeat` zone is a
   * per-instance value and is never a role constant (Sec.6.2's one named
   * exception); a `"none"` zone has no attribute to emit at all, and a
   * `"random"` one is a bare flag with nothing to name.
   */
  fixedZoneName?: string;
  /**
   * Present only when the assign policy's number is a `fixed` slot. Same
   * shape as `fixedZoneName` and for the same reason: a fixed value is not
   * per-repeat, so the ownership split makes it a reference (Sec.4.2).
   */
  fixedAssignNumberName?: string;
  /**
   * One name per optional valued attribute the role actually sets
   * (`ROLE_OPTIONAL_ATTRIBUTES`); a field absent on the role is absent
   * here, and `landCommand.ts` writes nothing for it (Sec.4.5's
   * absent-is-not-zero rule).
   */
  optional: Partial<Record<RoleOptionalField, string>>;
}

export interface RoleEmission {
  /** Every `#const` line the role owns, in emission order. */
  cells: EmittedConst[];
  names: RoleConstNames;
}

function refToken(ref: Ref): string {
  return ref.k === "name" ? ref.name : String(ref.id);
}

/** A `Ref` never needs hoisting, it is always exactly one token, so it is rendered directly rather than through emitCells, which only understands `Expr`. */
function refCell(name: string, ref: Ref): EmittedConst {
  const text = refToken(ref);
  return { name, text, tokens: [text] };
}

function literalCell(name: string, value: number): EmittedConst {
  const text = String(value);
  return { name, text, tokens: [text] };
}

export function emitRole(role: LandRole, namer: NameAllocator): RoleEmission {
  return emitFields(role, namer, "ROLE", role.label, ALL_FIELDS);
}

/** Every constant-bearing key of a role, the set `emitRole` emits and the universe `emitRoleOverrides` selects from. */
const ALL_FIELDS: ReadonlySet<keyof RoleOverrides> = new Set<
  keyof RoleOverrides
>([
  "terrain",
  "baseSize",
  "baseElevation",
  "extent",
  "zone",
  "assign",
  ...ROLE_OPTIONAL_ATTRIBUTES.map((a) => a.field),
]);

/**
 * The per-land constants for one placement's overrides (role-attributes-
 * escalation.md Sec.5.2 option (ii)): each overridden VALUED attribute gets
 * its own `#const`, named after the placement rather than the role, and the
 * returned names are the role's with exactly those keys replaced, so
 * `buildLandAttachmentExpectations` fed these names references the per-land
 * constant for the overridden attribute and the role's for everything else.
 * A flag override (`circularBase`) needs no constant and is read straight
 * off the effective role. A `zone` or `assign` override whose arm has no
 * constant (per-repeat, none, random) REMOVES the role's fixed name, since
 * the effective role no longer has a fixed arm for it to reference.
 *
 * `effective` must already be the merged role (`effectiveRole`) with its
 * `Expr`s resolved for the PLACEMENT's owner, which is the one capability an
 * override has that a role does not (Sec.5.4).
 */
export function emitRoleOverrides(
  effective: LandRole,
  overrides: RoleOverrides,
  placementLabel: string,
  roleNames: RoleConstNames,
  namer: NameAllocator,
): RoleEmission {
  const overridden = new Set<keyof RoleOverrides>(
    (Object.keys(overrides) as (keyof RoleOverrides)[]).filter(
      (k) => overrides[k] !== undefined && ALL_FIELDS.has(k),
    ),
  );
  if (overridden.size === 0) return { cells: [], names: roleNames };
  const own = emitFields(effective, namer, "LAND", placementLabel, overridden);
  const names: RoleConstNames = {
    ...roleNames,
    optional: { ...roleNames.optional },
  };
  if (overridden.has("terrain")) names.terrainName = own.names.terrainName;
  if (overridden.has("baseSize")) names.baseSizeName = own.names.baseSizeName;
  if (overridden.has("baseElevation"))
    names.baseElevationName = own.names.baseElevationName;
  if (overridden.has("extent")) {
    names.extentName = own.names.extentName;
    names.extentKind = own.names.extentKind;
  }
  if (overridden.has("zone")) names.fixedZoneName = own.names.fixedZoneName;
  if (overridden.has("assign"))
    names.fixedAssignNumberName = own.names.fixedAssignNumberName;
  for (const { field } of ROLE_OPTIONAL_ATTRIBUTES) {
    if (overridden.has(field))
      names.optional[field] = own.names.optional[field];
  }
  return { cells: own.cells, names };
}

/**
 * The one emitter behind both `emitRole` and `emitRoleOverrides`. `prefix`
 * is `ROLE` for a role's own constants and `LAND` for a placement's
 * overrides, `label` the name stem after it, and `fields` which keys to
 * emit at all. Names for keys outside `fields` are left as empty strings
 * and never read, `emitRoleOverrides` overlays only the keys it asked for.
 */
function emitFields(
  role: LandRole,
  namer: NameAllocator,
  prefix: "ROLE" | "LAND",
  label: string,
  fields: ReadonlySet<keyof RoleOverrides>,
): RoleEmission {
  const cells: EmittedConst[] = [];
  const names: RoleConstNames = {
    terrainName: "",
    baseSizeName: "",
    baseElevationName: "",
    extentName: "",
    extentKind: role.extent.kind,
    optional: {},
  };
  if (fields.has("terrain")) {
    names.terrainName = namer.allocate(`${prefix}_TERRAIN`, label);
    cells.push(refCell(names.terrainName, role.terrain));
  }
  if (fields.has("baseSize")) {
    names.baseSizeName = namer.allocate(`${prefix}_SIZE`, label);
    cells.push(
      ...emitCells([{ name: names.baseSizeName, expr: role.baseSize }], namer),
    );
  }
  if (fields.has("baseElevation")) {
    names.baseElevationName = namer.allocate(`${prefix}_ELEVATION`, label);
    cells.push(
      ...emitCells(
        [{ name: names.baseElevationName, expr: role.baseElevation }],
        namer,
      ),
    );
  }
  if (fields.has("extent")) {
    // `ROLE_PERCENT` for the percent arm keeps Sec.10.1's acceptance gate
    // byte-identical through the reshape; `_TILES` is the other arm's own
    // stem so the name still says what the number is.
    names.extentName = namer.allocate(
      role.extent.kind === "percent" ? `${prefix}_PERCENT` : `${prefix}_TILES`,
      label,
    );
    cells.push(
      ...emitCells(
        [{ name: names.extentName, expr: role.extent.value }],
        namer,
      ),
    );
  }
  for (const { field, stem } of ROLE_OPTIONAL_ATTRIBUTES) {
    if (!fields.has(field)) continue;
    const expr = role[field];
    if (expr === undefined) continue;
    const name = namer.allocate(stem.replace(/^ROLE/, prefix), label);
    cells.push(...emitCells([{ name, expr }], namer));
    names.optional[field] = name;
  }
  if (fields.has("zone") && role.zone.kind === "fixed") {
    const fixedZoneName = namer.allocate(`${prefix}_ZONE`, label);
    cells.push(literalCell(fixedZoneName, role.zone.zone));
    names.fixedZoneName = fixedZoneName;
  }
  if (
    fields.has("assign") &&
    role.assign.kind !== "none" &&
    role.assign.number.kind === "fixed"
  ) {
    const fixedAssignNumberName = namer.allocate(`${prefix}_ASSIGN`, label);
    cells.push(
      ...emitCells(
        [{ name: fixedAssignNumberName, expr: role.assign.number.value }],
        namer,
      ),
    );
    names.fixedAssignNumberName = fixedAssignNumberName;
  }
  return { cells, names };
}
