// The panel's own view-model logic (land-placement-design.md Sec.8):
// flattening the graph to a tree, the parent-picker's cycle rejection, the
// live land total, percent<->tile conversion, and reading a placement's role
// attachment back off the document. All pure and tested, Sec.5's own rule
// for slice 4b: "a React component in 4b should be glue over tested
// functions... if a run-sheet step could fail because a number is wrong,
// that number belonged in 4a". This file is where those numbers live.

import type { Expr } from "../../../../../tools-api/index";
import { chainPerRepeat } from "../expand";
import type { LanguageData } from "../../../../parser/language";
import type { CommandNode, ParseResult, Span } from "../../../../parser/types";
import { walkItems } from "../../../walkItems";
import { reservedNamesForApply } from "../applyEdits";
import type { AlpModel } from "../fence";
import type { EmissionOk } from "../emitModel";
import {
  buildLandAttachmentExpectations,
  checkLandAttachment,
} from "../landCommand";
import type { Anchor, LandRole, Placement, ShapeGroup } from "../model";
import { groupForMember } from "./modelOps";

// ---------------------------------------------------------------------------
// The tree (Sec.8: "a tree mirroring the graph, indentation as the chain").
// ---------------------------------------------------------------------------

export interface PlacementTreeNode {
  placement: Placement;
  depth: number;
  children: PlacementTreeNode[];
}

/**
 * Roots are placements parented directly to "center"; every other placement
 * nests under its own parent. A placement naming a parent that does not
 * exist (a corrupt or hand-edited model) is treated as a root rather than
 * dropped, never-silently-drop, the same rule the parser itself follows for
 * unrepresentable content.
 */
export function buildPlacementTree(model: AlpModel): PlacementTreeNode[] {
  const byParent = new Map<Anchor, Placement[]>();
  for (const p of model.placements) {
    const siblings = byParent.get(p.parent) ?? [];
    siblings.push(p);
    byParent.set(p.parent, siblings);
  }
  const byId = new Set(model.placements.map((p) => p.id));

  function build(parent: Anchor, depth: number): PlacementTreeNode[] {
    return (byParent.get(parent) ?? []).map((placement) => ({
      placement,
      depth,
      children: build(placement.id, depth + 1),
    }));
  }

  const roots = build("center", 0);
  // Anything parented to a non-existent id (excluding "center" itself, which
  // build() already covers) is orphaned. Surface it as its own root rather
  // than lose it from the tree entirely.
  const orphans = model.placements.filter(
    (p) => p.parent !== "center" && !byId.has(p.parent),
  );
  return [
    ...roots,
    ...orphans.map((placement) => ({ placement, depth: 0, children: [] })),
  ];
}

/** Flattens the tree to a list in display order, what a React list actually renders. */
export function flattenPlacementTree(
  nodes: readonly PlacementTreeNode[],
): { placement: Placement; depth: number }[] {
  const out: { placement: Placement; depth: number }[] = [];
  const walk = (list: readonly PlacementTreeNode[]) => {
    for (const node of list) {
      out.push({ placement: node.placement, depth: node.depth });
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

// ---------------------------------------------------------------------------
// Selection. The right column lists roles, shapes and lands in three
// sections, and any one item from any of them can be selected.
// ---------------------------------------------------------------------------

/**
 * What the panel has selected. A discriminated union rather than a bare id
 * string. Each kind opens a different editor, and the three kinds only
 * happen to share one id namespace because `freshId` draws from all of them.
 * `kind` is the discriminant, so a `switch (selection.kind)` narrows each
 * branch and the compiler flags a branch that forgets a kind.
 */
export type PanelSelection =
  | { kind: "role"; id: string }
  | { kind: "shape"; id: string }
  | { kind: "land"; id: string };

/**
 * The first item in the panel's lists, which a freshly opened panel selects
 * so an editor is on screen from the start. The sections run Roles, Shapes,
 * Lands, and that is the search order. Lands go by the tree's display order
 * rather than the model's array order, so "first" is the top row on screen.
 */
export function defaultSelection(model: AlpModel): PanelSelection | null {
  const role = model.roles[0];
  if (role) return { kind: "role", id: role.id };
  const group = model.groups[0];
  if (group) return { kind: "shape", id: group.id };
  const land = flattenPlacementTree(buildPlacementTree(model))[0];
  return land ? { kind: "land", id: land.placement.id } : null;
}

export interface ResolvedSelection {
  /** The live selection, or null when nothing is selected or its target has been deleted since. */
  selection: PanelSelection | null;
  role?: LandRole;
  /** A selected shape, or the shape a selected land belongs to. The canvas draws this one's gizmo. */
  group?: ShapeGroup;
  land?: Placement;
  /** The lands the canvas draws as selected. */
  highlightIds: ReadonlySet<string>;
}

/**
 * Looks the selection up in the current model. Resolved on read, not
 * repaired in the store. Deleting the selected role, shape or land leaves a
 * stale id behind, and this returns "nothing selected" for it. An effect
 * that cleared the stale id instead would render one frame with it first.
 */
export function resolveSelection(
  model: AlpModel,
  selection: PanelSelection | null,
): ResolvedSelection {
  const none: ResolvedSelection = { selection: null, highlightIds: new Set() };
  if (selection === null) return none;
  switch (selection.kind) {
    case "role": {
      const role = model.roles.find((r) => r.id === selection.id);
      if (!role) return none;
      const wearing = model.placements.filter((p) => p.role === role.id);
      return {
        selection,
        role,
        highlightIds: new Set(wearing.map((p) => p.id)),
      };
    }
    case "shape": {
      const group = model.groups.find((g) => g.id === selection.id);
      if (!group) return none;
      return {
        selection,
        group,
        highlightIds: new Set([
          ...group.members,
          ...(group.chainMembers ?? []),
        ]),
      };
    }
    case "land": {
      const land = model.placements.find((p) => p.id === selection.id);
      if (!land) return none;
      return {
        selection,
        land,
        group: groupForMember(model, land.id),
        highlightIds: new Set([land.id]),
      };
    }
  }
}

/** What each shape kind is called on screen. */
export const SHAPE_KIND_LABELS: Record<ShapeGroup["kind"], string> = {
  circle: "Circle",
  line: "Line",
  arc: "Arc",
  square: "Square",
  triangle: "Triangle",
  polygon: "Polygon",
};

/**
 * A shape's name on screen, its kind plus the number from its id, so
 * `ring_2` reads "Square 2" once it is a square. The id itself stays
 * `ring_N` for every shape, because `+ Shape` always starts a circle. It is
 * saved in the fence, and the land labels and emitted `#const` names are
 * built from it, so renaming it would rewrite a user's generated code. The
 * number is what links a shape to its lands' labels (`ring_2_0_slot_3`).
 */
export function shapeDisplayName(group: ShapeGroup): string {
  const kind = SHAPE_KIND_LABELS[group.kind];
  const n = /_(\d+)$/.exec(group.id)?.[1];
  return n === undefined ? `${kind} (${group.id})` : `${kind} ${n}`;
}

/** Every role a shape places, from its pattern slots and their chained lands, once each, in pattern order. A points-only slot has none to list. */
export function shapeRoleIds(group: ShapeGroup): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id !== undefined && !ids.includes(id)) ids.push(id);
  };
  for (const slot of group.pattern) {
    add(slot.role);
    for (const link of slot.chain ?? []) add(link.role);
  }
  return ids;
}

/**
 * Would setting `placementId`'s parent to `candidateParent` create a cycle?
 * "center" is never a cycle (it is the tree's root, not a placement). A
 * placement naming itself is trivially a cycle without needing the walk.
 */
export function wouldCreateCycle(
  model: AlpModel,
  placementId: string,
  candidateParent: Anchor,
): boolean {
  if (candidateParent === "center") return false;
  if (candidateParent === placementId) return true;
  const byId = new Map(model.placements.map((p) => [p.id, p] as const));
  let current: Anchor = candidateParent;
  const seen = new Set<string>();
  while (current !== "center") {
    if (current === placementId) return true;
    if (seen.has(current)) return true; // an existing cycle elsewhere in the model, stop rather than loop forever
    seen.add(current);
    const next = byId.get(current);
    if (!next) return false; // parent chain runs off the edge of the model, not a cycle involving placementId
    current = next.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// The pattern editor's live count (Sec.8: "pattern.length x repeats is the
// number the user is actually choosing").
// ---------------------------------------------------------------------------

export interface ShapeGroupLandTotal {
  /** Lands, meaning placements that emit a `create_land`. Members of a points-only slot are not lands and are counted in `points` instead. */
  count: number;
  /** Members of points-only slots, emitted as coordinates only. */
  points: number;
  /**
   * False for a `perPlayer` ring (per-player-escalation.md Sec.8.1): `count`
   * is `pattern.length * repeats`, and `repeats` is pinned to
   * MAX_PLAYER_COUNT while `perPlayer` is set, so the number is an UPPER
   * BOUND — the actual land count the script emits depends on however many
   * players are actually in the game, not on anything this panel controls.
   */
  exact: boolean;
}

export function shapeGroupLandTotal(
  group: Pick<ShapeGroup, "pattern" | "repeats" | "perPlayer">,
): ShapeGroupLandTotal {
  // Members plus expanded chain children (Q12): every repeat produces one
  // land per slot and one per template on any slot. A slot with no role
  // produces a point instead of a land, and its templates still produce
  // lands, since a template always carries its own role.
  const pointSlots = group.pattern.filter((s) => s.role === undefined).length;
  return {
    count:
      (group.pattern.length - pointSlots + chainPerRepeat(group.pattern)) *
      group.repeats,
    points: pointSlots * group.repeats,
    exact: !group.perPlayer,
  };
}

// ---------------------------------------------------------------------------
// Per-count angle overrides (per-player-escalation.md Sec.8.3, slice-c-brief
// item 1's panel surface). A member's `repeatIndex` is its player index
// (0-based), so its own player number is `repeatIndex + 1` — a guard the
// prologue itself enforces (Item 6: player k's create_land is guarded by
// ALP_AT_LEAST_k), which means an override at a count BELOW that player's own
// number could never be read: the member's land is not even emitted there.
// Restricting the offered counts to the range the member can actually exist
// in turns that dead-configuration trap into something the UI cannot produce,
// rather than a silent no-op the author would have to notice on their own.
// ---------------------------------------------------------------------------

/**
 * The player counts (1..`maxPlayerCount`) at which `placement` could ever be
 * emitted, i.e. where a `thetaPerCount` override on it would actually be
 * read. `undefined` `repeatIndex` (not a group member at all, or a chain
 * anchor `expandShapeGroup` never touched) means every count is fair game,
 * since nothing here restricts it.
 */
export function validThetaPerCountRange(
  placement: Pick<Placement, "repeatIndex">,
  maxPlayerCount: number,
): number[] {
  const from =
    placement.repeatIndex !== undefined ? placement.repeatIndex + 1 : 1;
  const counts: number[] = [];
  for (let count = from; count <= maxPlayerCount; count++) counts.push(count);
  return counts;
}

/** `validThetaPerCountRange`, filtered to the counts `placement` does not already carry an override for — exactly the choices left to offer a "+ add override" control. */
export function availableThetaPerCountOptions(
  placement: Pick<Placement, "repeatIndex" | "thetaPerCount">,
  maxPlayerCount: number,
): number[] {
  const used = new Set(Object.keys(placement.thetaPerCount ?? {}).map(Number));
  return validThetaPerCountRange(placement, maxPlayerCount).filter(
    (count) => !used.has(count),
  );
}

// ---------------------------------------------------------------------------
// Percent <-> tiles (Sec.4.3, Sec.8: "every number field shows percent with
// the tile equivalent beside it").
// ---------------------------------------------------------------------------

/** Matches overlay.ts's own `percentToTile` exactly, the panel's readout must never disagree with what the overlay draws. */
export function percentToTile(pct: number, dim: number): number {
  const raw = Math.round((pct / 100) * dim);
  return Math.max(0, Math.min(dim - 1, raw));
}

export function formatPercentWithTiles(pct: number, dim: number): string {
  return `${formatPercent(pct)}% (${percentToTile(pct, dim)} tiles)`;
}

/**
 * The Extent field's label, with the OTHER unit in brackets: `Land %
 * (2000 tiles)` for a percent value, `Tiles (5%)` for a tile count.
 * `land_percent` is a share of the map's AREA (guide: "percentage of the
 * total map that the land should grow to cover"), so the conversion is
 * against `dim * dim`, not the linear `percentToTile` a position uses: 5% of
 * a 200x200 map is 2000 tiles. With no resolvable value (a symbolic
 * formula, or no map size yet) the bare label comes back.
 */
export function formatExtentLabel(
  kind: "percent" | "tiles",
  value: number | undefined,
  dim: number,
): string {
  const base = kind === "percent" ? "Land %" : "Tiles";
  if (value === undefined || !(dim > 0)) return base;
  const area = dim * dim;
  if (kind === "percent") {
    return `${base} (${Math.round((value / 100) * area)} tiles)`;
  }
  return `${base} (${formatPercent((value / area) * 100)}%)`;
}

function formatPercent(pct: number): string {
  // Two decimals, trailing zeros trimmed; "50" not "50.00", "12.5" not "12.50".
  return Number(pct.toFixed(2)).toString();
}

// ---------------------------------------------------------------------------
// Numeric fields (Sec.7.3: "the panel edits by numbers"; the formula field
// and its full Expr grammar are slice 5). A field this panel edits is always
// a plain numeric literal. Anything else (a `sym`, a hoisted `param`, a
// formula) is shown read-only with a note, never silently coerced.
// ---------------------------------------------------------------------------

export function exprAsNumber(e: Expr): number | null {
  return e.k === "num" ? e.v : null;
}

export function numberToExpr(n: number): Expr {
  return { k: "num", v: n };
}

// ---------------------------------------------------------------------------
// Role attachment (Sec.6.2, Sec.8: "each land shows which role it wears, or
// that it has detached from one, checkLandAttachment's first UI consumer").
// ---------------------------------------------------------------------------

function findCreateLandCommands(parse: ParseResult): CommandNode[] {
  const out: CommandNode[] = [];
  walkItems(parse, (item) => {
    if (
      item.kind === "command" &&
      parse.tokens[item.name]?.text === "create_land"
    )
      out.push(item);
  });
  return out;
}

/**
 * `null`, no role, nothing to attach (a chain anchor). `true`, this
 * placement's `create_land` still says what the tool would write. `false`,
 * a role-bearing placement whose `land_position` no longer names this
 * placement's own emitted X/Y (Sec.6.2's "the constant name is the link"):
 * either hand-edited into something else, or the land was deleted outright.
 */
export function computePlacementAttachment(
  parse: ParseResult,
  model: AlpModel,
  emission: EmissionOk,
): ReadonlyMap<string, boolean | null> {
  const commands = findCreateLandCommands(parse);
  const out = new Map<string, boolean | null>();
  for (const placement of model.placements) {
    if (placement.role === undefined) {
      out.set(placement.id, null);
      continue;
    }
    const role = model.roles.find((r) => r.id === placement.role);
    const roleNames = emission.roleNamesByPlacement.get(placement.id);
    const quantity = emission.quantities.get(placement.id);
    if (!role || !roleNames || !quantity) {
      out.set(placement.id, false);
      continue;
    }
    const positionExpectation = buildLandAttachmentExpectations({
      role,
      roleNames,
      xName: quantity.xName,
      yName: quantity.yName,
      repeatIndex: placement.repeatIndex,
    }).filter((e) => e.attribute === "land_position");
    const attached = commands.some(
      (land) =>
        checkLandAttachment(land, parse.tokens, positionExpectation)
          .attributes[0]?.attached === true,
    );
    out.set(placement.id, attached);
  }
  return out;
}

// ---------------------------------------------------------------------------
// P4 for the panel's own preconditions strip. NOT `checkP4` from
// preconditions.ts directly: that function seeds itself from the UNFILTERED
// `reservedNames`, which still carries the self-collision 4a's build log
// names and fixed only in `applyEdits.ts`. Checking a re-Apply's own
// candidate names against it would flag the tool's OWN existing fence names
// as a collision on every second Apply. `reservedNamesForApply` is the
// fence-aware exclusion `applyEdits.ts` already uses; this reimplements
// `checkP4`'s comparison against that set instead, so the panel's P4 (the
// first surface that shows P4 to a user, per the slice-4 brief's own hazard
// note) does not inherit the bug.
// ---------------------------------------------------------------------------

/** P1's own `codeRef` (Sec.8: "with a codeRef to the raw node's first line"), the first RawNode in source order, or null on a healthy script. */
export function firstRawNodeSpan(parse: ParseResult): Span | null {
  let first: Span | null = null;
  walkItems(parse, (item) => {
    if (
      item.kind === "raw" &&
      (first === null || item.span.start < first.start)
    )
      first = item.span;
  });
  return first;
}

/**
 * Takes the EMISSION, not a name list, and reaches for `emittedNames`
 * itself. That is the whole point of the signature and it is worth stating,
 * since a `readonly string[]` parameter is the obvious shape and was what
 * this had.
 *
 * The reported defect (2026-09-02) was never in the comparison below. The
 * panel passed `emission.resolved.keys()`, and `resolved` is seeded with the
 * document's own #const table, so P4 was asked whether the script's
 * constants collide with the script's constants and said yes to all 133 of
 * them on Bulls_Eyes with an empty model. Both this function and
 * `reservedNamesForApply` were correct throughout.
 *
 * A name-list parameter leaves that choice at every call site, where it is
 * one plausible-looking property access away from wrong and where no test of
 * this function can see it. Taking the emission moves the choice in here,
 * next to the reasoning, and there is then nothing for a caller to get
 * wrong. Same rule this repo already applies to `ignore_terrain_restrictions`
 * and `beachTerrain`: the exception belongs inside the thing that computes
 * the rule, not at the call site that knows about it.
 *
 * `null` means there is no successful emission to check, which is not a
 * collision.
 */
export function checkP4ForPanel(
  emission: EmissionOk | null,
  parse: ParseResult,
  lang: LanguageData,
): { ok: boolean; collisions: readonly string[] } {
  const reserved = reservedNamesForApply(parse, lang);
  const collisions = (emission?.emittedNames ?? []).filter((n) =>
    reserved.has(n),
  );
  return { ok: collisions.length === 0, collisions };
}
