// Sec.6.2: a LandRole's own attributes become `#const`s a create_land
// skeleton references by NAME, never by literal, so editing the role is
// editing one line, and every land wearing it follows. `terrain` is a `Ref`
// (Sec.5.0: a name is not a number, and this repo already paid once for
// mixing the two, BUG-015), so it emits differently from the three `Expr`
// fields, which go through the ordinary math-compiler backend (emit.ts),
// the same code frame.ts's X/Y cells use, so a role attribute that happens
// to need hoisting (a formula, not just a literal) gets it for free.

import type { Ref } from "../../../../tools-api/index";
import type { LandRole } from "./model";
import { emitCells, type EmittedConst } from "./compiler/emit";
import type { NameAllocator } from "./compiler/naming";

export interface RoleConstNames {
  terrainName: string;
  baseSizeName: string;
  baseElevationName: string;
  landPercentName: string;
  /**
   * Present only when `role.zone.kind === "fixed"`. A `perRepeat` zone is a
   * per-instance value and is never a role constant (Sec.6.2's one named
   * exception); a `"none"` zone has no attribute to emit at all.
   */
  fixedZoneName?: string;
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
  const terrainName = namer.allocate("ROLE_TERRAIN", role.label);
  const baseSizeName = namer.allocate("ROLE_SIZE", role.label);
  const baseElevationName = namer.allocate("ROLE_ELEVATION", role.label);
  const landPercentName = namer.allocate("ROLE_PERCENT", role.label);

  const cells: EmittedConst[] = [refCell(terrainName, role.terrain)];
  cells.push(...emitCells([{ name: baseSizeName, expr: role.baseSize }], namer));
  cells.push(...emitCells([{ name: baseElevationName, expr: role.baseElevation }], namer));
  cells.push(...emitCells([{ name: landPercentName, expr: role.landPercent }], namer));

  const names: RoleConstNames = { terrainName, baseSizeName, baseElevationName, landPercentName };
  if (role.zone.kind === "fixed") {
    const fixedZoneName = namer.allocate("ROLE_ZONE", role.label);
    cells.push(literalCell(fixedZoneName, role.zone.zone));
    names.fixedZoneName = fixedZoneName;
  }

  return { cells, names };
}
