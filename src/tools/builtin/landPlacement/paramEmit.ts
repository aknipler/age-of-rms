// Sec.4.4: RandomParam hoisting. Open since slice 4a's own build log named it
// ("emit.ts's own leafText comment says frame.ts is supposed to resolve
// {k:"param"} references to sym(emittedName) before lowering, it does not,
// today") and confirmed still open by 4b ("the panel's own worked example,
// a ring whose rotation IS a RandomParam, is not reachable from anything 4b
// actually built"). This module closes it: every RandomParam becomes one
// #const `rnd(min,max)` cell (shared) or one per player, `_P<n>` suffixed
// (Sec.4.4's own table); `resolveParamRefs` walks an Expr tree replacing
// every `{k:"param", id}` leaf with `sym(name)`, emit.ts's own documented
// contract ("real model code never lets a param ref reach this module").

import type { Expr } from "../../../../tools-api/index";
import { MAX_PLAYER_COUNT } from "../../../generationSettings/generationSettingsConstants";
import { sym } from "./compiler/expr";
import type { EmittedConst } from "./compiler/emit";
import type { NameAllocator } from "./compiler/naming";
import type { LandRole, Placement, RandomParam } from "./model";

function rndCell(name: string, min: number, max: number): EmittedConst {
  const text = `rnd(${min},${max})`;
  return { name, text, tokens: [text] };
}

export interface ParamEmission {
  /** Every RandomParam's own #const cell(s), in declaration order. */
  cells: EmittedConst[];
  /**
   * Resolves a param id to its emitted name. `ownerPlayer` is 1-based; for a
   * `perPlayer: false` param it is ignored (one shared draw). Returns
   * `undefined`, never throws, for an unknown id, or a `perPlayer: true`
   * param referenced with no owner (or an owner outside 1..MAX_PLAYER_COUNT):
   * the caller turns that into a reported problem rather than a silent P1
   * fallback (Sec.4.4: "a perPlayer parameter referenced from [an unowned
   * node] is a model error the panel reports").
   */
  resolveName: (id: string, ownerPlayer: number | undefined) => string | undefined;
  /**
   * A DETERMINISTIC stand-in value per emitted param cell, the midpoint of
   * [min, max], same value for every `_P<n>` variant of one param.
   *
   * WHY THIS EXISTS, A GAP FOUND BUILDING THIS MODULE RATHER THAN DOCUMENTED
   * IN ADVANCE: `compiler/verify.ts`'s step 2 reads the emitted block back
   * with `mathEval.ts`'s `evaluateExpressionTokens`, "exactly as the engine
   * will", and that function's own Sec.2.2 contract makes `rnd(...)`
   * UNRESOLVABLE as an operand, unconditionally, including as the sole token
   * of a whole-value `#const` (RND_PATTERN is checked before the
   * first/last-position special cases). So a param cell's own value can
   * never come from that walk, only from something supplied out of band,
   * and everything topologically downstream of an unresolved cell is
   * `undefined` too, silently. verifyEmission now accepts these values to
   * seed `resolved` directly for exactly the cells this module emits (see
   * its own comment). The midpoint is not a claim about what the engine will
   * roll, there is no live RNG at vector-tier draw time, it is what keeps
   * step 2 and step 3 trivially self-consistent, and it is what the vector
   * tier draws until the Full tier (a real generation) shows the actual
   * rolled value.
   */
  previewValues: ReadonlyMap<string, number>;
}

export function emitRandomParams(params: readonly RandomParam[], namer: NameAllocator): ParamEmission {
  const cells: EmittedConst[] = [];
  const previewValues = new Map<string, number>();
  const sharedNames = new Map<string, string>();
  const perPlayerNames = new Map<string, string[]>();

  for (const p of params) {
    const midpoint = (p.min + p.max) / 2;
    if (!p.perPlayer) {
      const name = namer.allocate("PARAM", p.label);
      cells.push(rndCell(name, p.min, p.max));
      previewValues.set(name, midpoint);
      sharedNames.set(p.id, name);
      continue;
    }
    // per-player-escalation.md Sec.5.4 / slice-b-brief.md item 3: the count
    // is runtime under a perPlayer ring, so this can no longer be pinned to
    // the count the script happens to be previewed at — it emits at
    // MAX_PLAYER_COUNT unconditionally, for every `perPlayer` param, not only
    // ones a ring references (Sec.4.4's "lifted... together or not at all").
    // Unused draws for players beyond the live count are harmless.
    const names: string[] = [];
    for (let player = 1; player <= MAX_PLAYER_COUNT; player++) {
      const name = namer.allocate("PARAM", `${p.label}_P${player}`);
      cells.push(rndCell(name, p.min, p.max));
      previewValues.set(name, midpoint);
      names.push(name);
    }
    perPlayerNames.set(p.id, names);
  }

  const resolveName = (id: string, ownerPlayer: number | undefined): string | undefined => {
    const shared = sharedNames.get(id);
    if (shared !== undefined) return shared;
    const names = perPlayerNames.get(id);
    if (names === undefined) return undefined;
    if (ownerPlayer === undefined || ownerPlayer < 1 || ownerPlayer > names.length) return undefined;
    return names[ownerPlayer - 1];
  };

  return { cells, resolveName, previewValues };
}

/**
 * Walks `e`, replacing every `{k:"param", id}` leaf with `sym(resolveName(id))`.
 * `null` on the first unresolvable reference (an unknown id, or a
 * `perPlayer` param with no usable owner), never a partial substitution,
 * matching Sec.5.5's "on disagreement the tool emits nothing" philosophy
 * extended to an unresolvable reference rather than a numeric one.
 */
export function resolveParamRefs(e: Expr, resolveName: (id: string) => string | undefined): Expr | null {
  switch (e.k) {
    case "num":
    case "inf":
    case "sym":
    case "node":
      return e;
    case "param": {
      const name = resolveName(e.id);
      return name === undefined ? null : sym(name);
    }
    case "neg": {
      const inner = resolveParamRefs(e.e, resolveName);
      return inner === null ? null : { k: "neg", e: inner };
    }
    case "sin": {
      const inner = resolveParamRefs(e.e, resolveName);
      return inner === null ? null : { k: "sin", e: inner };
    }
    case "cos": {
      const inner = resolveParamRefs(e.e, resolveName);
      return inner === null ? null : { k: "cos", e: inner };
    }
    case "bin": {
      const l = resolveParamRefs(e.l, resolveName);
      const r = resolveParamRefs(e.r, resolveName);
      return l === null || r === null ? null : { k: "bin", op: e.op, l, r };
    }
  }
}

/**
 * A placement's "owning player", 1-based, `undefined` if none, is the
 * nearest ancestor (including itself) whose own role has `assignToPlayer`
 * and a `repeatIndex`, walking `parent` back to `"center"`.
 *
 * UNDOCUMENTED IN THE DESIGN DOC, DECIDED HERE (same class of gap frame.ts
 * and model.ts already document): Sec.4.4 says a `perPlayer` reference
 * "resolves to that player's copy" for "a node owned by player n" and that a
 * node with no owning player is a model error, but never defines ownership
 * for anything other than the player-assigned land itself. The natural
 * reading for a CHAIN tool is that everything hung off a player's own land,
 * Bulls_Eyes' own A1/A2/A3 off P1, belongs to that player's cluster, which
 * is exactly what this walk computes.
 */
export function computeOwnerPlayers(
  placements: readonly Placement[],
  roleById: ReadonlyMap<string, LandRole>,
): Map<string, number | undefined> {
  const byId = new Map(placements.map((p) => [p.id, p] as const));
  const cache = new Map<string, number | undefined>();

  function ownerOf(id: string, seen: Set<string>): number | undefined {
    const cached = cache.get(id);
    if (cached !== undefined || cache.has(id)) return cached;
    if (seen.has(id)) return undefined; // a cycle elsewhere in the model, stop rather than loop forever
    seen.add(id);
    const p = byId.get(id);
    if (!p) return undefined;
    const role = p.role !== undefined ? roleById.get(p.role) : undefined;
    if (role?.assignToPlayer === true && p.repeatIndex !== undefined) {
      const owner = p.repeatIndex + 1;
      cache.set(id, owner);
      return owner;
    }
    const owner = p.parent === "center" ? undefined : ownerOf(p.parent, seen);
    cache.set(id, owner);
    return owner;
  }

  const out = new Map<string, number | undefined>();
  for (const p of placements) out.set(p.id, ownerOf(p.id, new Set()));
  return out;
}
