// Sec.6.2: the `create_land` skeleton the tool emits when a land is
// created, and the detachment predicate that reads one back.
//
// THE OWNERSHIP SPLIT (Sec.6.2). Everything this module writes into a
// `create_land` is a REFERENCE to a constant inside the tool's own fence,
// never a literal, with exactly one named exception: a PER-REPEAT value
// (a `perRepeat` zone, `assign_to AT_PLAYER n`) varies per instance, so a
// shared role constant is the wrong shape for it and it is written as a
// plain literal instead. From the moment a land is created, the tool owns
// only what is inside the fence; the `create_land` block itself belongs to
// Breakdown/hand-editing forever, and there is no marker, "the constant
// name is the link". That is also why detachment (below) is detectable
// without any id the tool would otherwise have to maintain.

import type { ArgNode, CommandNode, Token } from "../../../parser/types";
import type { LandRole } from "./model";
import type { RoleConstNames } from "./roleEmit";

export interface LandSkeletonInput {
  role: LandRole;
  roleNames: RoleConstNames;
  /** The placement's own emitted position names (frame.ts's PlacementQuantity). */
  xName: string;
  yName: string;
  /**
   * 0-based. Needed only when `role.zone.kind === "perRepeat"` or
   * `role.assignToPlayer` is true, both are per-instance (Sec.4.5) and
   * resolved here, at emit time, rather than left as further arithmetic in
   * the script.
   */
  repeatIndex?: number;
}

/** `zone = base + step * repeatIndex` (Sec.4.5), resolved at emit time, since the tool always knows `repeatIndex` by then. */
function perRepeatZone(base: number, step: number, repeatIndex: number): number {
  return base + step * repeatIndex;
}

/**
 * The single source of truth for "what would this tool write into a
 * create_land for this placement", as STRUCTURED attribute/args pairs
 * rather than text, so `buildCreateLandSkeleton` (rendering) and
 * `checkLandAttachment` (reading one back) are proven to agree by
 * construction instead of by two independently-hand-written lists staying in
 * sync. slice-4 brief item 3: "checkLandAttachment is the predicate slice 3
 * built for the neighbouring question; use it or extend it rather than
 * writing a second matcher", this is the extension.
 */
export function buildLandAttachmentExpectations(input: LandSkeletonInput): AttachmentExpectation[] {
  const { role, roleNames, xName, yName, repeatIndex } = input;
  const expectations: AttachmentExpectation[] = [
    { attribute: "terrain_type", expectedArgs: [roleNames.terrainName] },
    { attribute: "base_size", expectedArgs: [roleNames.baseSizeName] },
    { attribute: "base_elevation", expectedArgs: [roleNames.baseElevationName] },
    { attribute: "land_percent", expectedArgs: [roleNames.landPercentName] },
    { attribute: "land_position", expectedArgs: [xName, yName] },
  ];

  if (role.zone.kind === "fixed") {
    if (roleNames.fixedZoneName === undefined) {
      throw new Error("buildLandAttachmentExpectations: role has a fixed zone but roleNames.fixedZoneName is missing — emitRole and this call disagree");
    }
    expectations.push({ attribute: "zone", expectedArgs: [roleNames.fixedZoneName] });
  } else if (role.zone.kind === "perRepeat") {
    if (repeatIndex === undefined) throw new Error("buildLandAttachmentExpectations: a perRepeat zone needs repeatIndex");
    expectations.push({ attribute: "zone", expectedArgs: [String(perRepeatZone(role.zone.base, role.zone.step, repeatIndex))] });
  }

  if (role.assignToPlayer) {
    if (repeatIndex === undefined) throw new Error("buildLandAttachmentExpectations: assignToPlayer needs repeatIndex");
    expectations.push({ attribute: "assign_to", expectedArgs: ["AT_PLAYER", String(repeatIndex + 1)] });
  }

  return expectations;
}

export function buildCreateLandSkeleton(input: LandSkeletonInput): string {
  const lines: string[] = ["create_land", "{"];
  for (const exp of buildLandAttachmentExpectations(input)) {
    lines.push(`${exp.attribute} ${exp.expectedArgs.join(" ")}`);
  }
  lines.push("}");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Detachment (Sec.6.2's acceptance: "a hand-edited attribute detaches that
// land from its role and the detachment is detectable, a pure predicate").
// ---------------------------------------------------------------------------

/** What a healthy, tool-owned `create_land` is expected to say for one attribute. */
export interface AttachmentExpectation {
  attribute: string;
  /** Exact expected argument token text, in order, e.g. `["ALP_X_R2_S3", "ALP_Y_R2_S3"]` for `land_position`. */
  expectedArgs: readonly string[];
}

export interface AttributeAttachment {
  attribute: string;
  /** False when the attribute is missing entirely, a land can be detached by deletion, not just by edit. */
  present: boolean;
  /** True only when `present` and every argument matches `expectedArgs` exactly. */
  attached: boolean;
  actualArgs: readonly string[];
}

export interface LandAttachmentReport {
  attributes: readonly AttributeAttachment[];
  /** True only when every checked attribute is present and attached. */
  attached: boolean;
}

/**
 * `ArgNode.value` is a plain number for a numeric literal, a string for a
 * name/label reference, or an `{ rnd }` / `{ expr }` shape for anything more
 * exotic (Sec.2.2). A reference this tool ever writes is always the plain
 * string case, so anything else, including a literal number typed over a
 * reference, simply cannot equal the expected name and reads as detached
 * without a special case for "what kind of value is this".
 */
function argText(arg: ArgNode, tokens: readonly Token[]): string {
  if (typeof arg.value === "string") return arg.value;
  if (typeof arg.value === "number") return String(arg.value);
  return tokens[arg.firstToken]?.text ?? "";
}

/**
 * Reads an EXISTING `create_land` command back and checks it against what
 * the tool would have written. Deliberately given the expectations rather
 * than deriving them from the model+role itself: this module has no id, no
 * marker, and no notion of "which command belongs to which placement", that
 * pairing is Sec.8's panel's own bookkeeping (which command it created), and
 * this predicate is pure precisely because it does not need to reconstruct
 * that pairing to answer "does this command still say what I'd write".
 */
export function checkLandAttachment(
  land: CommandNode,
  tokens: readonly Token[],
  expectations: readonly AttachmentExpectation[],
): LandAttachmentReport {
  const byName = new Map<string, ArgNode[]>();
  for (const item of land.block?.items ?? []) {
    if (item.kind === "attribute") byName.set(tokens[item.name].text, item.args);
  }

  const attributes: AttributeAttachment[] = expectations.map((exp) => {
    const args = byName.get(exp.attribute);
    if (args === undefined) {
      return { attribute: exp.attribute, present: false, attached: false, actualArgs: [] };
    }
    const actualArgs = args.map((a) => argText(a, tokens));
    const attached =
      actualArgs.length === exp.expectedArgs.length && actualArgs.every((v, i) => v === exp.expectedArgs[i]);
    return { attribute: exp.attribute, present: true, attached, actualArgs };
  });

  return { attributes, attached: attributes.every((a) => a.attached) };
}
