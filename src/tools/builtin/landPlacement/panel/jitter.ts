// per-player-escalation.md Sec.5.3, slice-c-brief.md item 3: the one
// separation guarantee the emission can actually keep. RMS cannot solve a
// "keep everyone at least N degrees apart" constraint at runtime, but a ring
// spaced evenly and then jittered by a bounded `rnd(-j,+j)` keeps every
// adjacent gap at or above `evenGap - 2j` BY CONSTRUCTION, so the largest
// safe `j` for a requested minimum is a closed-form calculation, not a
// search.
//
// Pure and standalone, beside snapping.ts's own pure percent-space helpers:
// this module knows nothing about a ShapeGroup, a Placement, or an Expr, only
// the arithmetic. The brief's own hazard 2 is this calculation's whole
// reason to exist as its own tested module rather than an inline formula at
// a call site: "clamping an impossible separation to zero" is the wrong
// answer dressed as a safe default, and every wrong answer this calculation
// can give is a plausible-looking number.

export interface SafeJitterResult {
  ok: true;
  /**
   * The largest `j`, in degrees, such that every adjacent land keeps at
   * least the requested minimum separation under `even_k + rnd(-j, +j)`.
   * Can be 0 (the requested minimum exactly equals the even spacing, so no
   * jitter is safe but the request is not impossible).
   */
  jitterDegrees: number;
}

export interface SafeJitterFailure {
  ok: false;
  /** Why the requested minimum cannot be met at this count, for the panel to show verbatim rather than silently clamping. */
  reason: string;
}

/**
 * `count` is the player count one prologue branch covers (1-8). `patternLength`
 * is the group's own `pattern.length` (Sec.4.1's "one angle per land per
 * branch", not per player, so a multi-slot pattern spaces `patternLength *
 * count` lands total around the ring, matching the `n` Circle's arm of
 * `memberOffset` in expand.ts uses). Circle only. Every other kind takes a
 * typed amount with no bound (land-placement-per-player-any-kind-
 * escalation.md Sec.5.5). `requestedMinSeparationDegrees` is the author's "keep them at
 * least this far apart" ask.
 *
 * Refuses rather than clamps (slice-c-brief.md hazard 2) whenever the
 * request exceeds what the even spacing at this count leaves room for -
 * `jitterDegrees` would have to go negative to satisfy it, and a negative
 * jitter is not jitter, it is lands moved past each other.
 */
export function computeSafeJitterDegrees(
  count: number,
  patternLength: number,
  requestedMinSeparationDegrees: number,
): SafeJitterResult | SafeJitterFailure {
  const totalLands = count * patternLength;
  const evenGapDegrees = 360 / totalLands;
  const jitterDegrees = (evenGapDegrees - requestedMinSeparationDegrees) / 2;
  if (jitterDegrees < 0) {
    return {
      ok: false,
      reason: `At ${count} player${count === 1 ? "" : "s"}, evenly spaced lands sit ${evenGapDegrees.toFixed(2)} degrees apart, so a minimum separation of ${requestedMinSeparationDegrees} degrees leaves no room for jitter. Lower the minimum, or accept exact even spacing with none.`,
    };
  }
  return { ok: true, jitterDegrees };
}

// ---------------------------------------------------------------------------
// The amount the "Add jitter" button writes (per-player-escalation.md
// Sec.11). One draw serves every player count, so it has to be safe at the
// count where the even gap is smallest. The gap is `360 / (count * slots)`,
// which only shrinks as players join, so that count is always
// MAX_PLAYER_COUNT and the bound computed there holds at every count below.
// ---------------------------------------------------------------------------

export type JitterUnit = "deg" | "percent";

export interface JitterAmountResult {
  ok: true;
  /** A whole number of at least 1, the `N` in `rnd(-N, N)`. */
  amount: number;
}

/**
 * The largest WHOLE `amount` that keeps neighbouring lands at least
 * `requestedMinSeparationDegrees` apart at every count up to `maxCount`.
 *
 * `deg` uses `computeSafeJitterDegrees` at `maxCount`. `percent` is a share
 * of each count's own even gap, so two neighbours can close by at most
 * `2 * P%` of it and the bound is `P <= 50 * (1 - min / gap)`, tightest where
 * the gap is smallest.
 *
 * Rounded DOWN to a whole number because the guide never says `rnd` accepts
 * fractional bounds, and rounding down can only make the result safer.
 * Refuses when that leaves 0, since the guide also requires `max` to exceed
 * `min` and `rnd(0,0)` would be no jitter dressed as some.
 */
export function computeJitterAmount(
  unit: JitterUnit,
  maxCount: number,
  patternLength: number,
  requestedMinSeparationDegrees: number,
): JitterAmountResult | SafeJitterFailure {
  const degrees = computeSafeJitterDegrees(
    maxCount,
    patternLength,
    requestedMinSeparationDegrees,
  );
  if (!degrees.ok) return degrees;
  const evenGapDegrees = 360 / (maxCount * patternLength);
  const exact =
    unit === "deg"
      ? degrees.jitterDegrees
      : 50 * (1 - requestedMinSeparationDegrees / evenGapDegrees);
  const amount = Math.floor(exact);
  if (amount < 1) {
    return {
      ok: false,
      reason: `At ${maxCount} players the safe jitter is ${exact.toFixed(2)}${unit === "deg" ? " degrees" : "% of the even gap"}, which is less than one whole step. Lower the minimum separation.`,
    };
  }
  return { ok: true, amount };
}
