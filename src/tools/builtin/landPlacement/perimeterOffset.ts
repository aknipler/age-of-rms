// land-placement-perimeter-symbolic-rotation-slice-a-brief.md item 1
// (escalation Sec.8.3): the shared geometry every perimeter kind (`square`,
// `triangle`, `polygon`) walks. Pure, no model types, `expand.ts` is its
// only caller, kept in its own file because it is the one place in this
// tool that computes real trigonometry rather than baking an
// RMS-emittable formula, and it earns a test file of its own for exactly
// that reason.
//
// Takes NO rotation at all — the absence of that parameter is the whole
// design (escalation Sec.8.3): a perimeter member reduces to an ordinary
// `polar` offset, `r = base * radiusScale`, `theta = rotation +
// bearingDegrees`, with rotation entering only as the outermost additive
// term the caller supplies, exactly like every other kind. That is what
// lets rotation be symbolic for these kinds for free — this function never
// sees it, so there is nothing here for a `sym`/`param` to break.

/** What a member's cartesian offset (the old representation) reduces to under a polar one. */
export interface PerimeterPolar {
  /** Multiply the group's radius Expr by this: `hypot(apothem, u)`, in `[cos(pi/M), 1]`. 1 on a vertex, the apothem at a side's midpoint. Not rounded to an integer — a scale factor, not an angle. */
  radiusScale: number;
  /** Add to the group's rotation Expr: `k*(360/M) + psi`, rounded to a whole degree. */
  bearingDegrees: number;
}

/** Six decimal places: a millionth of a percent is five thousandths of a tile even at this app's largest map (480, language.json's own `dimensions`), far under the lattice a position is rounded onto anyway. A cosine is not a ratio of small integers the way slice A's line offset is, so this is one of the few places this compiler bakes a decimal literal on purpose. */
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/**
 * `sides` = M, `memberCount` = N, `memberIndex` = m (0-based).
 *
 * Two conventions carried over unchanged from the cartesian representation
 * this replaces, pinned here rather than at the call site:
 *
 *  1. Rotation rotates the whole shape once — enforced by construction now,
 *     rather than by convention, since this function cannot see the
 *     rotation at all. The escalation's own §3(a) sketch also wrote it into
 *     a `phase` term inside `delta`, which would spin the polygon AND slide
 *     every member along its own perimeter at the same time; dropped, so
 *     rotation means here exactly what it already means for circle/line/arc
 *     — an additive term on the bearing, nothing else.
 *  2. The walk starts at the midpoint of side 0 (the `1 / (2M)` term), so
 *     member 0 sits on the rotation ray like every other kind: under this
 *     form that reads as `bearingDegrees === 0` at `m === 0` for every `M`
 *     and `N`, and a square at rotation 0 has flat sides facing the axes
 *     rather than a corner.
 *
 * `Math.round` on `bearingDegrees`, and only on it. `bearingDegrees` becomes
 * a DEGREES cell, and the engine casts that to an int inside the trig
 * macro's `%` (mathEval.ts's `applyOperator` note): rounding here costs at
 * most 0.5 degrees where letting the engine truncate would cost 1.0 — the
 * identical decision `expand.ts`'s `angleOffsetDegrees` and
 * `arcStepDegrees` already make. `radiusScale` is never rounded to an
 * integer — rounding it would collapse every member onto the circumradius
 * and turn a polygon into a circle, a plausible-looking wrong picture.
 */
/**
 * `shiftPercent` (perimeter-symbolic-rotation-slice-b-brief.md item 2): a
 * slot's `perimeterShift`, percent of one lap, ADDED to the even walk before
 * the wrap — a delta on `delta` itself, not a separate term downstream of it.
 * Defaults to 0, at which this is byte-identical to the pre-shift function.
 * The existing wrap already handles a negative or greater-than-one `delta`
 * correctly (`k`'s double mod, `f`'s subtraction from `floor`), which was
 * checked during the design session and is now pinned by a test rather than
 * left as a happy accident (escalation Sec.8.5, slice-b-brief.md item 2).
 */
export function perimeterPolar(
  sides: number,
  memberCount: number,
  memberIndex: number,
  shiftPercent = 0,
): PerimeterPolar {
  const M = sides;
  const N = memberCount;
  const m = memberIndex;

  const delta = m / N + 1 / (2 * M) + shiftPercent / 100; // fraction of the way round the perimeter
  const scaled = delta * M;
  // Hazard: `floor(delta * M)` can land exactly on `M` for the last member
  // of some counts (an exact multiple of a full lap), which is a side index
  // off the end of the shape without this wrap.
  const k = ((Math.floor(scaled) % M) + M) % M; // which side
  const f = scaled - Math.floor(scaled); // how far along that side, (delta*M) mod 1

  const u = (f - 0.5) * 2 * Math.sin(Math.PI / M); // signed distance from the side's midpoint, in units of R
  const apo = Math.cos(Math.PI / M); // the apothem, in units of R

  const radiusScale = round6(Math.hypot(apo, u));
  const psi = (Math.atan2(u, apo) * 180) / Math.PI;
  const bearingDegrees = Math.round(k * (360 / M) + psi);

  return { radiusScale, bearingDegrees };
}
