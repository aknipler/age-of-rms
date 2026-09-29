// The emission orchestrator, Sec.5 and Sec.6's own fixed order, composed
// into one function (slice-4 brief item 2): "nothing composes an AlpModel
// into { body, resolved values, create_land text } against one shared
// NameAllocator." Buried in a parenthetical in the first draft of that
// brief; it is the largest remaining headless piece, and both a panel's
// Apply (item 3) and its canvas (4b, via item 6's overlay builder) depend on
// what it returns.
//
// ONE NameAllocator, passed in by the caller (already seeded, Sec.5.6, P4,
// from the document's own symbols and language.json's reserved words via
// preconditions.ts's `reservedNames`), shared across every step below. A
// second allocator would each think a name was free and collide silently
// (Sec.5.6; repeated in the slice-4 brief's hazards section for exactly this
// reason).

import type { Expr } from "../../../../tools-api/index";
import { expandShapeGroup } from "./expand";
import { buildFrame, type PlacementQuantity } from "./frame";
import {
  emitRandomParams,
  computeOwnerPlayers,
  resolveParamRefs,
} from "./paramEmit";
import { emitRole, emitRoleOverrides } from "./roleEmit";
import { buildCreateLandSkeleton } from "./landCommand";
import { emitCells, formatConstLine, type EmittedConst } from "./compiler/emit";
import { verifyEmission, type VerifyProblem } from "./compiler/verify";
import type { NameAllocator } from "./compiler/naming";
import type { AlpModel } from "./fence";
import {
  ROLE_OPTIONAL_ATTRIBUTES,
  effectiveRole,
  type LandRole,
  type Placement,
} from "./model";
import type { RoleConstNames } from "./roleEmit";
import {
  buildPrologue,
  jitterUnitsForKind,
  renderConditionalBlock,
} from "./prologue";

export interface EmissionOk {
  ok: true;
  /** Every `#const` line, role constants first then the frame/position algebra, the fence BODY (Sec.6.1). */
  body: string;
  /** A `create_land` skeleton per placement that owns a role (Sec.6.2), keyed by Placement.id, WRAPPED in its `if ALP_AT_LEAST_k` guard where it has one. */
  createLandText: ReadonlyMap<string, string>;
  /** Every RandomParam's preview stand-in (the midpoint of its range) by param id, what the panel resolves a `param` leaf with. */
  paramPreview: ReadonlyMap<string, number>;
  /** The same skeletons UNWRAPPED (the `create_land { … }` block alone), what an in-place update of an existing block replaces its span with, since the guard sits outside the command node. */
  createLandSkeleton: ReadonlyMap<string, string>;
  /**
   * Every emitted name's resolved value (Sec.5.5 step 2), what item 3's
   * placement bookkeeping and item 6's overlay builder both consume.
   *
   * SEEDED WITH THE DOCUMENT'S OWN `#const` TABLE (verify.ts), so that a
   * cell's expression can resolve against the constants the script already
   * defines. That makes this a symbol table for LOOKUP, and its key set the
   * union of the document's names and this model's. Use `emittedNames` for
   * any question of the form "what would this emission add".
   */
  resolved: ReadonlyMap<string, number>;
  /**
   * Per-placement emitted position names (frame.ts's own output), keyed by
   * Placement.id. Item 6's overlay builder needs these to look a placement's
   * X/Y up in `resolved`, since the names themselves are allocator-assigned
   * and not guessable from the placement alone.
   */
  quantities: ReadonlyMap<string, PlacementQuantity>;
  /** A placement's own role's emitted const names, keyed by Placement.id, present only for placements that carry a `role`. Same reason as `quantities`: `roleEmit.ts`'s names are allocator-assigned. */
  roleNamesByPlacement: ReadonlyMap<string, RoleConstNames>;
  /**
   * Every name THIS emission would write into the script, in emission order,
   * and nothing else. The answer to "what am I about to add", which
   * `resolved.keys()` is not (see above).
   *
   * P4, the collision check, is exactly that kind of caller, and reading it
   * off `resolved` is the defect this field exists to make unrepresentable:
   * fed the union, P4 reports every constant the script already defines as
   * colliding with itself, on every script that defines one.
   */
  emittedNames: readonly string[];
}

export interface EmissionFailed {
  ok: false;
  /** Sec.5.5: "on disagreement the tool emits nothing and reports the offending node." */
  problems: readonly VerifyProblem[];
}

export type EmissionResult = EmissionOk | EmissionFailed;

/**
 * Step 1 (Sec.5's fixed order): "expand every ShapeGroup into its members."
 * `model.placements` is expected to already carry every group's expanded
 * members as ordinary entries. That is the whole point of Sec.4.1 ("the
 * resulting Placements are ordinary and individually editable") and what
 * `reExpand()` maintains on every edit to `pattern`/`repeats`. This is
 * therefore a DEFENSIVE fill, not the primary path: it only ever adds a
 * member that `group.members` names but `model.placements` is missing (a
 * model that skipped `reExpand()`, a freshly-imported one, say). It never
 * overwrites an existing entry, so a nudged/edited member already present is
 * never silently replaced by a fresh, un-nudged one.
 */
function resolveFullPlacements(model: AlpModel): Placement[] {
  const byId = new Map(model.placements.map((p) => [p.id, p] as const));
  for (const group of model.groups) {
    const { placements: fresh, chainPlacements } = expandShapeGroup(group);
    const freshById = new Map(
      [...fresh, ...chainPlacements].map((p) => [p.id, p] as const),
    );
    for (const memberId of [...group.members, ...(group.chainMembers ?? [])]) {
      if (byId.has(memberId)) continue;
      const f = freshById.get(memberId);
      if (f) byId.set(memberId, f);
    }
  }
  return [...byId.values()];
}

export function emitAlpModel(
  model: AlpModel,
  namer: NameAllocator,
  scriptSymbols: ReadonlyMap<string, number>,
  playerCount: number,
): EmissionResult {
  // Step 0 (Sec.4.4, closed this slice; the perPlayer restriction lifted by
  // slice-b-brief.md item 3): hoist every RandomParam to its own #const
  // cell(s), before anything that might reference one. A role's Expr fields
  // (step 2) and a placement's offset (step 3) can both carry a `{k:"param"}`
  // leaf, and emit.ts's own contract requires it resolved to `sym(name)`
  // before a tree reaches lowering. `playerCount` is not threaded in here any
  // more: a `perPlayer` param now always emits at MAX_PLAYER_COUNT.
  const paramEmission = emitRandomParams(model.randomParams, namer);
  const paramProblems: VerifyProblem[] = [];

  function resolveExprParams(
    e: Expr,
    ownerPlayer: number | undefined,
    where: string,
  ): Expr {
    const resolved = resolveParamRefs(e, (id) =>
      paramEmission.resolveName(id, ownerPlayer),
    );
    if (resolved === null) {
      paramProblems.push({
        name: where,
        emittedValue: undefined,
        directValue: undefined,
      });
      return e; // discarded, the whole emission fails once paramProblems is non-empty, below
    }
    return resolved;
  }

  // Step 1.
  const placements = resolveFullPlacements(model);

  // Refused HERE, before the prologue is built and before any placement is
  // resolved further, so nothing downstream is built for a group this check
  // is about to reject. `paramProblems`' own shape, so the panel's existing
  // Generated Code section already knows how to render it: no new surface.
  const kindProblems: VerifyProblem[] = [
    // A per player group of every kind is placed by the prologue, so the
    // refusal of a kind it could not place is gone
    // (land-placement-per-player-any-kind-escalation.md slice C deleted the
    // interim guard of its section 2). What remains here is about jitter.
    //
    // per-player-escalation.md Sec.11: jitter needs one draw per player. On
    // a fixed-count ring the prologue never runs, so the field would be
    // dropped without a word. With a shared param every player would take
    // the same draw, which turns the ring rather than jittering it. Both are
    // plausible-looking wrong maps, so both refuse. The panel keeps either
    // from arising, and this catches a hand-edited fence.
    ...model.groups
      .filter(
        (g) =>
          g.jitter !== undefined &&
          (!g.perPlayer ||
            model.randomParams.find((p) => p.id === g.jitter!.param)
              ?.perPlayer !== true),
      )
      .map((g) => ({
        name: `group:${g.id}:jitter`,
        emittedValue: undefined,
        directValue: undefined,
      })),
    // any-kind escalation Sec.5.1: degrees need an angle along the path, and
    // a line or a perimeter has none. Emitted anyway, the draw would swing
    // each land off its shape rather than along it. `setGroupKind`
    // translates degrees to percent on a kind change and `applyGroupEdit`
    // refuses an edit that would leave them, so what reaches this is a hand
    // edited fence.
    ...model.groups
      .filter(
        (g) =>
          g.jitter !== undefined &&
          !jitterUnitsForKind(g.kind).includes(g.jitter.unit),
      )
      .map((g) => ({
        name: `group:${g.id}:jitterUnit`,
        emittedValue: undefined,
        directValue: undefined,
      })),
  ];
  if (kindProblems.length > 0) {
    return { ok: false, problems: kindProblems };
  }

  // Step 1.5 (per-player-escalation.md Sec.4.1, slice-a-brief items 1, 3-6):
  // a perPlayer group's own prologue — the AT_LEAST/DEG names, the eight
  // rendered branches, the per-member theta override and the per-placement
  // guard label. Built from the RAW placements above (parent/id only,
  // unaffected by param resolution) so guard propagation walks real chain
  // topology regardless of resolution order. A group's `rotation` is
  // resolved for params here, exactly like every other Expr this function
  // resolves, since it feeds the prologue's own emitted values.
  const resolvedRotationByGroup = new Map<string, Expr>();
  for (const group of model.groups) {
    if (!group.perPlayer) continue;
    resolvedRotationByGroup.set(
      group.id,
      resolveExprParams(
        group.rotation,
        undefined,
        `group:${group.id}:rotation`,
      ),
    );
  }
  // A walked perimeter member's lap count is computed from its group's
  // draw lower bound (any-kind escalation Sec.5.4). The jitter refusal
  // above guarantees the param exists for every jittered group that gets
  // this far.
  const jitterMinByGroup = new Map<string, number>();
  for (const group of model.groups) {
    const param =
      group.jitter &&
      model.randomParams.find((p) => p.id === group.jitter!.param);
    if (param) jitterMinByGroup.set(group.id, param.min);
  }
  const prologue = buildPrologue(
    model.groups,
    placements,
    resolvedRotationByGroup,
    namer,
    playerCount,
    resolveExprParams,
    jitterMinByGroup,
  );

  const roleById = new Map<string, LandRole>(
    model.roles.map((r) => [r.id, r] as const),
  );
  // A role field has no single placement to own it (Sec.6.2: one role, many
  // lands). A `perPlayer` reference there is therefore unresolvable by
  // construction, DECIDED HERE rather than left implicit (same class of gap
  // frame.ts/model.ts already document): pass `undefined` as the owner, so a
  // `perPlayer: false` param (ownerPlayer is ignored for those) still
  // resolves, and a `perPlayer: true` one correctly fails as "no owner".
  const ownerPlayers = computeOwnerPlayers(placements, roleById);

  /**
   * Every `Expr` a role (or an effective role) carries, resolved for
   * `owner`. A role's own fields resolve with `undefined` (many lands, no
   * one owner); a placement's overrides resolve with THAT placement's owner,
   * which is the one thing an override can do that a role cannot (Sec.5.4).
   */
  function resolveRoleExprs(
    role: LandRole,
    owner: number | undefined,
    where: string,
  ): LandRole {
    const resolved: LandRole = {
      ...role,
      baseSize: resolveExprParams(role.baseSize, owner, `${where}:baseSize`),
      baseElevation: resolveExprParams(
        role.baseElevation,
        owner,
        `${where}:baseElevation`,
      ),
      extent: {
        ...role.extent,
        value: resolveExprParams(role.extent.value, owner, `${where}:extent`),
      },
      // A `fixed` assign number is the one other `Expr` a role carries; a
      // `perRepeat` one is two plain numbers and has nothing to resolve.
      assign:
        role.assign.kind !== "none" && role.assign.number.kind === "fixed"
          ? {
              ...role.assign,
              number: {
                kind: "fixed",
                value: resolveExprParams(
                  role.assign.number.value,
                  owner,
                  `${where}:assign`,
                ),
              },
            }
          : role.assign,
    };
    for (const { field } of ROLE_OPTIONAL_ATTRIBUTES) {
      const expr = role[field];
      if (expr === undefined) continue;
      resolved[field] = resolveExprParams(expr, owner, `${where}:${field}`);
    }
    return resolved;
  }

  // Step 2: emit each role's constants. One call per role, never per
  // placement, since a role's attributes are shared by every land wearing
  // it (Sec.4.5: "editing a role is editing one line").
  const roleCells: EmittedConst[] = [];
  const roleEmissions = new Map<string, ReturnType<typeof emitRole>>();
  for (const role of model.roles) {
    const emission = emitRole(
      resolveRoleExprs(role, undefined, `role:${role.label}`),
      namer,
    );
    roleEmissions.set(role.id, emission);
    roleCells.push(...emission.cells);
  }

  // Step 2.5 (role-attributes-escalation.md Sec.10 slice 3): per-land
  // override constants, after every role's (so the role's name is already
  // allocated and a later delta form could reference it) and before the
  // frame algebra. Each placement with overrides gets its effective role
  // (role + overrides, replacement per key) resolved WITH ITS OWN OWNER, one
  // per-land `#const` per overridden valued attribute, and an effective
  // name set that step 4's skeleton references in place of the role's.
  // Keyed by placement id; a placement with no overrides is simply absent
  // and step 4 falls back to the role's own names.
  const effectiveByPlacement = new Map<
    string,
    { role: LandRole; names: RoleConstNames }
  >();
  for (const placement of placements) {
    if (placement.role === undefined || placement.roleOverrides === undefined)
      continue;
    const role = roleById.get(placement.role);
    const roleEmission = roleEmissions.get(placement.role);
    if (!role || !roleEmission) continue; // step 4 throws for the dangling role; not this step's job
    const merged = effectiveRole(role, placement.roleOverrides);
    const resolved = resolveRoleExprs(
      merged,
      ownerPlayers.get(placement.id),
      `placement:${placement.label}:override`,
    );
    const own = emitRoleOverrides(
      resolved,
      placement.roleOverrides,
      placement.label,
      roleEmission.names,
      namer,
    );
    roleCells.push(...own.cells);
    effectiveByPlacement.set(placement.id, {
      role: resolved,
      names: own.names,
    });
  }

  // Step 3: the frame algebra over every placement, params resolved first.
  const resolvedPlacements: Placement[] = placements.map((p) => {
    const owner = ownerPlayers.get(p.id);
    if (p.offset.kind === "polar") {
      // Sec.8.2: a perPlayer group member's baked-literal theta is replaced
      // wholesale by a reference to the prologue constant `buildPrologue`
      // already allocated for it, never param-resolved — the literal it
      // would resolve to is discarded either way, and the override is
      // already a plain `sym` leaf with nothing left to resolve. A kind whose
      // radius moves with the count (a line, a perimeter kind) has its `r`
      // replaced the same way, by its RAD cell (any-kind escalation
      // Sec.4.1). A walked perimeter member has no RAD cell, and its `r` is
      // never read, since `buildFrame` takes its X and Y from the walk.
      const thetaOverride = prologue.thetaOverrides.get(p.id);
      const radiusOverride = prologue.radiusOverrides.get(p.id);
      return {
        ...p,
        offset: {
          kind: "polar",
          r:
            radiusOverride ??
            resolveExprParams(p.offset.r, owner, `placement:${p.label}:r`),
          theta:
            thetaOverride ??
            resolveExprParams(
              p.offset.theta,
              owner,
              `placement:${p.label}:theta`,
            ),
        },
      };
    }
    if (p.offset.kind === "cartesian") {
      return {
        ...p,
        offset: {
          kind: "cartesian",
          dx: resolveExprParams(p.offset.dx, owner, `placement:${p.label}:dx`),
          dy: resolveExprParams(p.offset.dy, owner, `placement:${p.label}:dy`),
        },
      };
    }
    return {
      ...p,
      offset: {
        kind: "formula",
        x: resolveExprParams(p.offset.x, owner, `placement:${p.label}:x`),
        y: resolveExprParams(p.offset.y, owner, `placement:${p.label}:y`),
      },
    };
  });

  if (paramProblems.length > 0) {
    // Sec.5.5's own philosophy, extended: an unresolvable reference is
    // reported the same way a numeric disagreement is, and nothing is
    // emitted, never a partial body built from placeholder originals.
    return { ok: false, problems: paramProblems };
  }

  const frame = buildFrame(resolvedPlacements, namer, prologue.walks);

  // Step 4: lower to #const cells and render them, the fence body.
  const frameCells = emitCells(frame.cells, namer);
  // One array, three consumers (the rendered body, the verifier, and
  // `emittedNames`). This list used to be spelled out twice; a third copy is
  // the point at which they could silently disagree about what was emitted,
  // and `emittedNames` is only trustworthy while it names the same cells the
  // body renders. The prologue's own cells are deliberately NOT folded in
  // here: they already have their own conditional text (`prologue.text`),
  // and flattening them into this array would render them a SECOND time,
  // unconditionally, alongside it.
  const emittedCells = [...paramEmission.cells, ...roleCells, ...frameCells];
  // Sec.4.1: "emitted once per fence." NOT before EVERYTHING, despite what
  // this line used to say (slice A shipped that reading, and it went
  // untested because nothing before slice B ever put a param reference
  // inside a prologue DEG cell): a member's own authored rule can reference a
  // hoisted RandomParam (item 2), and paramEmit.ts's own header already
  // guarantees params are hoisted before anything that might reference one.
  // So the prologue's #const lines have to land textually AFTER the param
  // cells that back them (slice-b-brief.md hazard 2) — role/frame cells stay
  // after the prologue, unaffected, since a member's frame algebra can
  // reference `ALP_DEG_Pk`, which the prologue itself defines.
  // `verifyEmission`'s own resolve order already assumed this (its cross-
  // check pass has always fed itself `paramEmission.cells` before
  // `prologue.crossCheckDegCells`); only the RENDERED text disagreed.
  // Empty when no group is `perPlayer` (Sec.10.1's own byte-identical
  // requirement — a script that never turns this on gets nothing new, and
  // this reduces to the untouched `paramEmission.cells, roleCells, frameCells`
  // order it always was).
  const paramLines = paramEmission.cells.map(formatConstLine);
  const restLines = [...roleCells, ...frameCells].map(formatConstLine);
  const body = [
    ...paramLines,
    ...(prologue.text.length > 0 ? [prologue.text] : []),
    ...restLines,
  ].join("\n");

  // Step 5: verify, in TWO passes over the same cells. `prologue.liveDegCells`
  // and `prologue.crossCheckDegCells` MUST both precede `frameCells` in
  // whichever array they enter: a perPlayer member's own DEGREES cell
  // references its `ALP_DEG_Pk` name by `sym`, so that name has to already
  // be in `resolved` by the time the walk reaches it.
  //
  // Pass 1, cross-check, uses `crossCheckDegCells` — EVERY player fully
  // resolved, never just the previewed count's. `evalExpr`'s strict AST
  // propagation and `evaluateExpressionTokens`' RMS-faithful "drop an
  // unresolved operand after the first" (Sec.5.1) only ever have to agree
  // once every operand genuinely resolves; feeding this pass a
  // deliberately-partial preview (players beyond the live count, unresolved
  // by design) would make the two evaluators disagree for a reason that has
  // nothing to do with a real compiler bug, which is exactly what
  // `crossCheckDegCells`'s own doc comment in prologue.ts explains. Its own
  // `resolved` output is discarded; only `ok`/`problems` matter here.
  const crossCheck = verifyEmission(
    [
      ...paramEmission.cells,
      ...roleCells,
      ...prologue.crossCheckDegCells,
      ...frameCells,
    ],
    frame.cells.map((c) => ({ name: c.name, source: c.expr })),
    scriptSymbols,
    undefined,
    undefined,
    paramEmission.previewValues,
  );

  if (!crossCheck.ok) {
    return { ok: false, problems: crossCheck.problems };
  }

  // Pass 2, preview, uses `liveDegCells` — only the CURRENTLY PREVIEWED
  // count's own cells, so `resolved` (item 3 and item 6's shared consumer)
  // only ever answers for the count actually being shown (Sec.7.4: "the
  // preview draws one count"). No targets: correctness was already
  // established by pass 1, this pass exists only to produce the RETURNED
  // `resolved` map.
  const verified = verifyEmission(
    [
      ...paramEmission.cells,
      ...roleCells,
      ...prologue.liveDegCells,
      ...frameCells,
    ],
    [],
    scriptSymbols,
    undefined,
    undefined,
    paramEmission.previewValues,
  );

  const createLandText = new Map<string, string>();
  const createLandSkeleton = new Map<string, string>();
  const roleNamesByPlacement = new Map<string, RoleConstNames>();
  for (const placement of placements) {
    if (placement.role === undefined) continue; // a chain anchor with no land of its own
    const role = roleById.get(placement.role);
    if (!role) {
      throw new Error(
        `emitAlpModel: placement "${placement.id}" references role "${placement.role}", which is not in model.roles`,
      );
    }
    const roleEmission = roleEmissions.get(role.id)!;
    // The effective (overridden) role and names where the placement has
    // overrides, the role's own otherwise. Detachment detection reads the
    // same names (`roleNamesByPlacement`), so an overridden attribute is
    // "attached" when the land references ITS constant, by construction
    // rather than by a second list (Sec.5.5's three states).
    const effective = effectiveByPlacement.get(placement.id) ?? {
      role,
      names: roleEmission.names,
    };
    roleNamesByPlacement.set(placement.id, effective.names);
    const quantity = frame.quantities.get(placement.id);
    if (!quantity) {
      throw new Error(
        `emitAlpModel: placement "${placement.id}" has no emitted position — buildFrame and this function disagree`,
      );
    }
    const skeleton = buildCreateLandSkeleton({
      role: effective.role,
      roleNames: effective.names,
      xName: quantity.xName,
      yName: quantity.yName,
      repeatIndex: placement.repeatIndex,
    });
    // Item 6: one guard per create_land. A land belonging to player 1 (or
    // chained to one) needs none; every other player's land is wrapped in
    // its own `if ALP_AT_LEAST_k … endif`, via the same structural builder
    // the prologue's own ladder uses, so this single guard cannot unbalance
    // either.
    const guardLabel = prologue.guardLabels.get(placement.id);
    createLandSkeleton.set(placement.id, skeleton);
    createLandText.set(
      placement.id,
      guardLabel === undefined
        ? skeleton
        : renderConditionalBlock([
            { condition: guardLabel, lines: skeleton.split("\n") },
          ]),
    );
  }

  return {
    ok: true,
    body,
    createLandText,
    createLandSkeleton,
    paramPreview: paramEmission.previewById,
    resolved: verified.resolved,
    quantities: frame.quantities,
    roleNamesByPlacement,
    // Every param/role/frame name the flat body renders, PLUS every
    // AT_LEAST/DEG name across the prologue's own eight branches (P4/Sec.5.6
    // — "what am I about to add", not just what the currently-previewed
    // branch happens to use).
    emittedNames: [
      ...emittedCells.map((c) => c.name),
      ...prologue.emittedNames,
    ],
  };
}
