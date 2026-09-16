# Land Placement escalation: symbolic rotation and per-member perimeter variance for square/triangle/polygon

**Status: CLOSED 2026-09-03** by the design session Sec.7 asked for. Both asks are decided, Sec.3's
algebra was verified against the running code rather than transcribed (Sec.8.1 has the numbers), and
two work briefs exist: `land-placement-perimeter-symbolic-rotation-slice-a-brief.md` (ask 1, the
polar unification) and `-slice-b-brief.md` (ask 2, per-member perimeter variance). **Nothing is built
yet** — CLOSED here means the design questions are answered, not that code exists. Sections 0-7 below
are the ORIGINAL scoping text, left as written; every decision, correction and new finding is in
**Sec.8**, which is authoritative wherever it and Sec.1-7 disagree.

Raised 2026-09-03, scoped by a Sonnet session. Continues a thread
`land-placement-shape-kinds-escalation.md` explicitly left open rather than one this file
discovered fresh — see Sec.1's quote.

**Decide this before writing any code in `expand.ts`/`perimeterOffset.ts`.** Same standing rule as
every other escalation in this tree: a spec silent on a combination it never considered gets
escalated, not improvised.

---

## 0. The two asks, stated precisely

The owner wants both, together, for `square`/`triangle`/`polygon` groups:

1. **The shape's own rotation can be symbolic** — `rnd()`-driven or referencing a `RandomParam` —
   and re-rolls every map generation, the same way it already does for `circle`/`line`/`arc`.
2. **A member's position along the perimeter can vary independently of the others** — the
   perimeter-kind analogue of what `PatternSlot.theta` already does for `circle` (override one
   member's angular position away from the even `i/N` default).

Both, not either — a design that only solves (1) still leaves every perimeter-kind ring
perfectly evenly spaced with no way to nudge or jitter one member, which is a real and
currently-missing capability parallel to what circle groups already have via `slot.theta`.

## 1. This is a standing, explicitly-flagged gap, not a new discovery

`land-placement-shape-kinds-escalation.md` §3(a), written when `square` shipped, already named
exactly ask (1) and explicitly deferred it:

> **One real limitation this does carry, worth recording rather than discovering later.**
> `frame.ts`'s `cartesian` branch does not compose with `Placement.frame`/rotation at all (its own
> header comment, point 1): a `cartesian` offset's `dx`/`dy` are added to the anchor directly,
> never rotated. So a square built this way supports a symbolic RADIUS but not a symbolic
> ROTATION, since rotating the walk means baking `rotation` into the per-side coefficients above,
> which only works for a literal `rotation` value. A square that needs to spin under a live
> parameter (the `ROTATION_PLAYER` shape Sec.4.5 already supports for circle) would have to go
> through the `formula` offset kind instead, writing the rotation explicitly with SIN/COS (`x =
anchorX + dx_i*cos(rotation) - dy_i*sin(rotation)`, and the `y` equivalent), fully expressible
> with the compiler's existing primitives but with `expand.ts` composing the Exprs itself rather
> than leaning on `frame.ts`'s automatic composition. Not a blocker, a literal rotation is the
> overwhelmingly common case, matching every ring built in the corpus today, but the fork should
> be built deliberately rather than discovered when someone tries to spin a square.

That "someone tries to spin a square" moment is this file. The sketch it already gives
(`dx_i*cos(rotation) - dy_i*sin(rotation)`, expressed with the compiler's existing SIN/COS
primitives) is the right shape and is expanded on in Sec.3 below.

Ask (2) — per-member perimeter variance — is genuinely new; nothing in the prior escalation
raises it. `model.ts`'s own doc comment on `PatternSlot.theta` currently states it is _"meaningless
for a perimeter kind (`square`, `triangle`, `polygon`) ... `expandShapeGroup` does not consult
this field for those kinds"_ — Sec.4 below is where that gets a real design.

## 2. Ground truth to read before deciding anything (saves re-deriving it)

- **`src/tools/builtin/landPlacement/perimeterOffset.ts`** — the shared geometry every perimeter
  kind walks. `perimeterOffset(sides, memberCount, memberIndex, rotationDegrees)` returns `{cx,
cy}`, a coefficient pair the caller multiplies by the (possibly symbolic) radius.
- **`src/tools/builtin/landPlacement/expand.ts`**, `perimeterKindOffset` (~line 102) — calls
  `evalClosed(group.rotation) ?? 0` to get a plain number before calling `perimeterOffset`, which
  is the actual reason rotation must be closed-form today: `perimeterOffset` internally calls
  `Math.cos`/`Math.sin` on it directly.
- **`src/tools/builtin/landPlacement/frame.ts`** header comment, point 1: a `cartesian` offset's
  `dx`/`dy` are added straight to the anchor and never composed with `Placement.frame` or any
  angle. This is _why_ today's cartesian representation for perimeter kinds cannot carry a
  symbolic rotation — not a property of RMS math, a property of this specific representation.
- **`src/tools/builtin/landPlacement/compiler/trig.ts`**, `expandTrig` — the existing Bhaskara
  sine/cosine macro (10 `#const` cells: `DEGREES`/`R`/`S`/`P`/`D`/`SIN`/`CR`/`CS`/`CP`/`CD`/`COS`).
  This is the ONLY place in the compiler that turns a symbolic angle `Expr` into engine-evaluated
  `SIN`/`COS` names, and it is already fully general — it takes any leaf `Expr`, not just a
  circle's `theta`.
- **`src/tools/builtin/landPlacement/reExpand.ts`**, the `cartesian`-vs-`cartesian` branch (~line 233) — the merge rule built specifically so a user's manual nudge on a perimeter-kind member
  survives a repeat-count/radius edit. Standalone `cartesian`-offset placements (a user's own
  choice in the panel, not group-generated) still need this branch regardless of what happens to
  perimeter kinds below.
- **`src/tools/builtin/landPlacement/panel/dragMath.ts`**'s absorb path (`resolvedOffset`
  parameter, `tryInvertFormulaCoordinate`) — built to absorb a drag into a symbolic `r`/`theta` or
  `dx`/`dy` component when it inverts as `sym(name) ± num(k)`. Whatever representation this design
  lands on has to be checked against this path, not assumed to already work with it.
- **`src/tools/builtin/landPlacement/emitModel.ts`** (~line 137-166) — `isPerimeterKind` and the
  two `kindProblems` refusals: (a) `perPlayer` on any non-`circle` kind, (b) a perimeter kind whose
  `rotation` does not `evalClosed`. Refusal (b) is exactly what this design needs to relax (fully,
  or under a new, narrower condition); refusal (a) is a separate, pre-existing restriction — see
  Sec.6, keep it out of scope unless the owner asks to widen it too.
- **`src/tools/builtin/landPlacement/panel/jitter.ts`** — the existing bounded-jitter calculator
  for a **circle's** angular spacing: closed-form safe-`j` bound, refuses rather than silently
  clamps an impossible request, deliberately advisory (computed for the panel to show, never
  written into the model as a `RandomParam` — see `land-placement-per-player-slice-c`'s own build
  notes on why a single hoisted draw can't serve every player count at once). The closest existing
  precedent for "per-member randomized variance with a safety guarantee," worth reading before
  inventing a second, incompatible mechanism for ask (2).
- **`land-placement-shape-kinds-escalation.md`** §7 — the standing argument for why perimeter
  kinds were built with **no per-vertex handles**: _"a perimeter kind needs no vertex handles. Its
  vertices are fully determined by the circumradius and the rotation, both of which the existing
  radius/rotation gizmo already edits."_ That argument's premise is "one shared rotation, no
  per-member deviation." Ask (2) removes that premise — see Sec.5.

## 3. A candidate approach to ask (1), reasoned through this session, NOT verified

Presented as a starting point for Opus to check or replace, not as a decision. It was derived by
algebra in conversation, against no test and no running instance — treat it exactly as skeptically
as this project treats any unverified claim.

`perimeterOffset`'s own internals show that only ONE step needs a concrete rotation number:

```
k   = which side a member falls on         — depends only on (sides, memberCount, memberIndex)
f   = how far along that side               — depends only on (sides, memberCount, memberIndex)
u   = (f - 0.5) * 2 * sin(pi/sides)         — depends only on sides
apo = cos(pi/sides)                          — depends only on sides
phi = rotation + k * (360/sides)             — rotation enters HERE, and ONLY here
cx  = apo*cos(phi) - u*sin(phi)
cy  = apo*sin(phi) + u*cos(phi)
```

`k`, `f`, `u`, `apo` never depend on rotation — they're plain numbers the tool can always compute,
symbolic rotation or not. `phi` is `rotation + (a plain constant per member)`, the identical
_additive_ shape circle's own `theta = rotation + offsetTerm` already has. And `cx`/`cy` are just
the fixed local point `(apo, u)` rotated by `phi` — which has the standard closed form `R_loc *
cos(phi + psi)`, `R_loc * sin(phi + psi)`, where `R_loc = hypot(apo, u)` and `psi = atan2(u, apo)`
are **both plain JS numbers, computed once** (they only depend on `sides`/`memberIndex`/
`memberCount`, never on rotation, so `Math.atan2` here is exact — this is not the atan2-in-RMS
problem raised earlier in this conversation, which is a different, harder question about
resolving an angle from a value the compiler can't see until the engine runs).

If that reduction holds, a perimeter-kind member could be re-expressed as an ordinary `offset.kind
=== "polar"` value — `r = base * R_loc`, `theta = group.rotation + (k*(360/sides) + psi)` — using
`frame.ts`'s existing polar branch and `expandTrig`'s existing macro completely unchanged. That
would make rotation symbolic for these kinds for free, and would also close the earlier
radial-framing gap from this same conversation (a polar offset carries a real `DEGREES` cell for a
child to measure from; a cartesian one never does).

**Before this goes anywhere near `expand.ts`, verify it, don't transcribe it.** Concretely: a
small standalone script or test comparing `perimeterOffset`'s existing `(cx, cy)` output against
`R_loc * cos(phi+psi)` / `R_loc * sin(phi+psi)` across a spread of `sides` (3, 4, 5, 6, 12),
`memberIndex`/`memberCount` pairs, and `rotationDegrees` values, checked to float tolerance. This
project's own hard rules are explicit that an argument reasoned through once and never run against
the code it describes is exactly the failure mode that has cost the most time here previously
(`docs/consistency-checker-design.md`'s whole review history is a record of that).

## 4. What adopting Sec.3's approach would ripple into

If the polar unification is confirmed and chosen, all of the following need a real decision, not
just an update-in-passing:

- **`reExpand.ts`'s `cartesian`-vs-`cartesian` merge branch** would stop being reachable via
  `ShapeGroup` expansion (no kind would ever produce it any more) but must stay, since a
  standalone user-authored `cartesian` placement is still a real, reachable case. Confirm nothing
  in that branch was written assuming it is ONLY ever exercised by a perimeter-kind group.
- **`dragMath.ts`'s absorb path** — check whether the existing `polar` absorb branch already
  handles the new `r`/`theta` shape correctly (it should, structurally, but has not been checked),
  or whether the extra `psi` term needs its own handling when a drag tries to invert `theta` back
  to a `sym(...) ± num(k)` shape.
- **Existing tests asserting `offset.kind === "cartesian"` for triangle/square/polygon** —
  `expand.test.ts` has at least three such assertions (e.g. `"produces a cartesian offset, not
polar"` in the triangle describe block). These would need deliberate, conscious rewriting to
  assert `"polar"` instead, with the underlying numeric assertions (member magnitude, position)
  re-verified against the new formula — not just relaxed to make the type-check pass.
- **`emitModel.ts`'s rotation refusal** (~line 152-162) would need narrowing or removal, and its
  own comment (_"a cartesian offset is added to the anchor and never rotated"_) updated to state
  the new mechanism, per this project's rule that a doc comment restating a rule the code no
  longer implements is worse than no comment.
- **`land-placement-shape-kinds-escalation.md` §7's "no vertex handles" argument** should be
  revisited once rotation is symbolic and (pending Sec.5) a member's perimeter position can move
  independently — its premise (one shared rotation, no per-member deviation) may no longer hold.
  This doesn't necessarily mean handles are now needed; it means the argument needs to be re-run,
  not left standing on a premise this change removes.

## 5. Ask (2): per-member perimeter variance is a genuinely open design fork

Unlike Sec.3, this session did not derive a candidate formula — only the shape of the decision.

**The geometric subtlety to know going in, because it changes what "variance" even means here:**
for a `circle`, jittering a member's `theta` never changes its distance from the anchor — every
point on a circle is equidistant from the centre by definition, so angle and radius are
independent degrees of freedom, which is exactly why `jitter.ts`'s existing calculator only has to
reason about degrees. A polygon's perimeter is **not** a circle: walking along a flat side moves a
point closer to the centre except exactly at the side's midpoint (that's what `apo` vs `R` already
capture — the apothem is strictly less than the circumradius for any finite `sides`). So "vary a
member's position along the perimeter" is NOT independent of "vary its radius" for these kinds the
way it is for `circle` — moving a member along its side changes both its bearing AND its distance
from the anchor simultaneously. Any design for ask (2) has to either embrace that (the member
genuinely leaves the circumradius locus, which is arguably the more honest "walks the perimeter"
reading) or define what it means to keep a member pinned to the circumradius while still varying
its _position_ along the shape (which would mean varying which vertex/side it's near, a
fundamentally different kind of variance, closer to reassigning `k` than perturbing `f`).

**At least three shapes this could take, none decided:**

1. **Repurpose `PatternSlot.theta` for perimeter kinds** as a perimeter-fraction override (a value
   in place of the even `i/N` term), the closest direct analogue of what it already means for
   `circle`. Needs a defined unit (a plain fraction 0-1? Degrees-equivalent, `0-360` mapped onto
   the perimeter the way `phi` already is?) and needs `expandShapeGroup` to actually consult the
   field for these kinds, reversing the model.ts doc comment that currently says it doesn't.
2. **A bounded-jitter mechanism**, the perimeter-kind sibling of `jitter.ts`, computing a safe
   maximum perturbation the same way (closed-form, refuse rather than clamp an impossible
   request) but expressed in perimeter-fraction or arc-length terms instead of degrees. Would need
   its own closed-form derivation — `jitter.ts`'s formula (`(evenGap - requestedMin) / 2`) is
   circle-specific (uniform angular spacing) and does not obviously carry over to a
   non-circular perimeter where adjacent gaps are not all the same physical length even at even
   spacing, unless the "fraction of perimeter" unit is used consistently, in which case it might
   carry over almost unchanged — worth checking rather than assuming either way.
3. **Something else**, if 1 and 2 turn out to conflict with `slot.radius`'s existing meaning
   ("overrides the group radius, the wavy-ring case," per `model.ts`) once a member is no longer
   pinned to the circumradius by construction — a member using BOTH a perimeter-position override
   and a radius override needs a stated rule for how they compose (does the radius override move
   it further out along the SAME local bearing `phi+psi`, or does it change which point on the
   perimeter walk it represents?).

## 6. Explicitly out of scope unless the owner asks to widen it

`perPlayer` support for non-`circle` kinds (`emitModel.ts`'s other refusal, ~line 149-151) is a
separate, pre-existing restriction with its own design history
(`land-placement-per-player-escalation.md`). Neither of the owner's two asks in Sec.0 mentions
per-player rings. Leave that refusal as-is; note it here only so a future session doesn't assume
this file silently authorized touching it.

## 7. What this file is asking for

Not a decision — the design session itself. Concretely, that session should:

1. **Verify or replace Sec.3's algebra** against the running `perimeterOffset` code before
   anything is built on it (see Sec.3's own closing paragraph for the concrete check).
2. **Decide ask (2)'s representation** among Sec.5's options (or a fourth), including the
   apothem-vs-circumradius subtlety it opens.
3. **Work through Sec.4's ripple list** for whichever representation gets chosen, the same
   thoroughness `land-placement-shape-kinds-escalation.md` gave `reExpand`/`dragMath` the first
   time these kinds were built.
4. **Produce a slice brief** in the existing house style
   (`land-placement-shape-kinds-slice-a-brief.md` and its siblings are the template) once the
   design questions above are closed, not before.

**Suggested acceptance shape** for whatever the slice brief ends up asking for, offered as a
starting sketch rather than a mandate: a perimeter-kind group's rotation can be `rnd()`/symbolic
and is verified to re-roll every generation (mirroring however circle's own symbolic-rotation
behaviour is currently tested); a member's perimeter position can vary independently without
breaking the existing even-spacing default when no override is given; the radius/perimeter-position
interaction from Sec.5 has a stated, tested rule; `reExpand`'s merge rule handles a manual nudge
sanely under the new representation; the existing corpus/acceptance suite is either still green or
deliberately and consciously changed with a recorded reason (never silently relaxed to pass); and
`docs/land-placement-design.md` Sec.4.5 gets the write-up every prior slice has given it.

---

## 8. Design session outcome (2026-09-03) — the decisions

Sections 0-7 above are the question. This section is the answer, and it is what the two briefs are
written against.

### 8.1 Sec.3's reduction is CORRECT, and was verified, not transcribed

Run as a throwaway vitest probe against the real `perimeterOffset`, then deleted (it asserted
nothing this feature will keep; the equivalence it checks becomes a permanent test in slice A's own
acceptance instead). **7,566 combinations** — `sides` in {3,4,5,6,7,12} x `memberCount` in
{1,2,3,4,5,6,7,8,9,12,16,24} x every member index x `rotationDegrees` in
{0,1,15,45,90,137,180,270,359,-30,-90,720,33.7}, comparing `perimeterOffset`'s own `(cx, cy)`
against `R_loc*cos(phi+psi)` / `R_loc*sin(phi+psi)`:

    worst |error| = 4.9998e-7   (at M=3 N=4 m=3 rot=33.7)

That worst case is exactly half a unit in `perimeterOffset`'s own `round6`, i.e. the reduction is
algebraically EXACT and the only discrepancy is the rounding the existing function already applies
to its output. The identity is the ordinary one — `(apo, u)` rotated by `phi` is `R_loc` at bearing
`phi + psi` — and `R_loc = hypot(apo, u)`, `psi = atan2(u, apo)` depend only on
`sides`/`memberCount`/`memberIndex`, never on rotation, exactly as Sec.3 claimed.

Two consequences Sec.3 did not state:

- **`R_loc` ranges over [apothem, 1]** (checked over the same grid), which is the polygon's own
  radial signature: a member at a side's midpoint sits at `cos(pi/M)` of the circumradius, one on a
  vertex at exactly 1. Under the polar representation that variation stops being implicit in a pair
  of cartesian coefficients and becomes the member's own emitted radius. Sec.5's apothem worry is
  answered by that visibility rather than by a rule.
- **Member 0 still sits on the rotation ray.** At `m = 0`, `delta = 1/(2M)` gives `k = 0`, `f = 0.5`,
  `u = 0`, so `psi = 0` and the bearing offset is 0. `perimeterOffset`'s convention 2 survives the
  change untouched, which is what keeps every existing picture the same picture.

### 8.2 The price of the polar representation, measured

The polar path costs accuracy, and the amount is small but not zero. A polar member's DEGREES cell is
truncated to a whole degree by the engine (`%` is a cast — `mathEval.ts`'s own `applyOperator` note),
so `expand.ts` rounds the bearing at expansion time exactly as it already does for `circle`. The
bearing offsets are NOT generally integral (worst residue measured: 0.498 degrees, at M=7 N=5 m=1),
so the rounding is real rather than theoretical. Measured worst-case emitted-position error against
real trigonometry, over sides {3,4,5,6,7,12} x counts {3,5,7,8,12} x rotations {0,17,45,137,300} x
radii {10,25,45} percent:

| representation    | worst position error  | at map dim 480 |
| ----------------- | --------------------- | -------------- |
| cartesian (today) | 0.00003 percent-units | 0.0001 tiles   |
| polar (proposed)  | 0.440 percent-units   | 2.1 tiles      |

Decomposed at radius 45 percent (the worst radius tested): the Bhaskara macro itself contributes
0.078 and the whole-degree bearing quantization 0.393. **The dominant term is the quantization every
`circle`, `line` and `arc` member already pays**, and it scales with radius, so a ring at radius 10
pays a quarter of the figure above. This is accepted deliberately: it buys a symbolic rotation, a
DEGREES cell for children (Sec.8.4), and one representation instead of two.

**A hybrid was considered and rejected**: keep cartesian when `rotation` resolves and switch to polar
only when it does not. It costs nothing in accuracy and moves no existing output, but it makes a
group's offset KIND depend on whether its rotation happens to be a formula, so typing `rnd(0,359)`
into the Rotation field would silently flip every member's representation, and `reExpand`'s
mixed-pair rule would then detach every nudged member (Sec.8.6). A user action that reads as "make
the ring spin" must not also read as "forget where I dragged things". One honest representation,
priced above, beats two that swap under the user.

### 8.3 Ask (1) is DECIDED: the polar unification

`perimeterOffset` is replaced by a function that takes NO rotation at all:

```ts
export interface PerimeterPolar {
  /** Multiply the group's radius Expr by this: hypot(apothem, u), in [cos(pi/M), 1]. */
  radiusScale: number;
  /** Add to the group's rotation Expr: k*(360/M) + psi, rounded to whole degrees. */
  bearingDegrees: number;
}
export function perimeterPolar(
  sides: number,
  memberCount: number,
  memberIndex: number,
): PerimeterPolar;
```

and `expand.ts` emits `{ kind: "polar", r: mul(base, num(radiusScale)), theta: add(group.rotation,
num(bearingDegrees)) }` — structurally the SAME shape `circle` already produces, with rotation as the
outermost addend so a symbolic one keeps steering every member. `frame.ts`, `compiler/trig.ts` and
`reExpand`'s polar branch are unchanged; `emitModel.ts`'s rotation refusal is deleted outright rather
than narrowed. The absence of the `rotationDegrees` parameter is the whole design: rotation stops
being something the geometry consumes and becomes something the algebra carries.

### 8.4 Two capabilities this hands over for free, both behaviour changes

1. **A child chained to a perimeter member now inherits a real DEGREES cell.** `frame.ts`'s header
   point 2 degrades a `radial` child of a cartesian parent to a plain world bearing, silently. Every
   square/triangle/polygon member is such a parent today. After slice A they are polar, so radial
   framing works off a polygon's corner. Any existing model with a child under a perimeter member
   emits different (better) numbers afterwards — a real output change, and slice A owes it a test
   rather than a discovery.
2. **The canvas draws a symbolically-rotated perimeter group at its resolved rotation instead of 0.**
   Today `expand.ts` falls back to `evalClosed(group.rotation) ?? 0` for the picture while
   `emitModel` refuses the Apply, so the panel shows a shape that is honest about nothing but its own
   refusal. Afterwards the rotation is an ordinary Expr resolved off `EmissionOk.resolved` at the
   panel's pinned seed, like every other symbolic value in the tool.

### 8.5 Ask (2) is DECIDED: a new plain-number `PatternSlot.perimeterShift`, as a DELTA

Sec.5's option 1, with two deliberate departures from the `slot.theta` analogue it names.

**A new field, not a repurposed `slot.theta`.** Three reasons, in order of weight: (a) a group's kind
is a `<select>` a user flips — circle to square and back — and overloading one field would either
lose the authored angles or reinterpret "90 degrees" as a quarter-lap, which is this feature's own
named failure mode (a plausible-looking wrong picture); (b) `slot.theta` is an `Expr` and a perimeter
fraction CANNOT be symbolic (Sec.8.7), so the two want different types; (c) `model.ts`'s existing doc
comment on `slot.theta` stays true instead of becoming a lie with a special case attached.

```ts
/** Percent of one lap around the perimeter, ADDED to this slot's even position.
 *  Perimeter kinds only; ignored by circle/line/arc. Signed; wraps; absent = 0. */
perimeterShift?: number;
```

**A delta, not a replacement — deliberately unlike `slot.theta`.** `slot.theta` REPLACES the even
angular term, which stacks every repeat of that slot at one bearing; that is only usable at
`repeats: 1` and is a pre-existing wart this design does not propagate. A delta is exactly the stated
ask ("nudge one member off even"), it works at every repeat count, and it composes with a future
bounded jitter (Sec.5's option 2) without needing a second unit. The asymmetry with `slot.theta` is
real and must be written into `model.ts`'s own doc comment so it reads as a decision rather than a
drift.

**Percent of a lap, not a 0-1 fraction and not degrees.** Degrees would lie: 90 "degrees" along a
square's perimeter is not a 90-degree bearing from the anchor. Percent matches the tool's own
convention everywhere a proportion is authored, and keeps the panel input a plain integer field.

**The radius interaction Sec.5 asks about (its option 3) has a one-line answer, because the code
already implements it**: `slot.radius` scales the whole local vector, so the member stays on the
perimeter of a SIMILAR polygon at the new circumradius. `perimeterShift` chooses the point on the
unit-circumradius polygon; the radius scales it. The two are orthogonal and always have been
(`mul(base, coefficient)`); what changes is that this is now stated and tested rather than emergent.

**Sec.5's apothem subtlety is embraced, not worked around.** Moving a member along a flat side
genuinely moves it closer to the anchor, and after Sec.8.3 that shows up as the member's own emitted
radius rather than hiding inside a coefficient pair. "Pin the member to the circumradius while
varying its position along the shape" is rejected outright: on a polygon that describes a point that
is not on the shape.

### 8.6 The ripple list of Sec.4, worked through

- **`reExpand`'s cartesian-vs-cartesian branch STAYS**, and is no longer reachable from group
  expansion. Re-read for the assumption Sec.4 asks about: it makes none — it is written generically
  in terms of `oldBase`/`fresh` and `deltaComponent`, and a standalone user-authored `cartesian`
  placement still exercises it. Its COMMENT calls it "a perimeter kind's own delta case", which stops
  being true and must be rewritten, not left standing.
- **A migration consequence, accepted:** a model already saved with a NUDGED perimeter member holds a
  cartesian offset, and the fresh expansion afterwards is polar, so the merge hits the MIXED pair and
  reports `positionDetached`. The member keeps its position and stops following its group, visibly
  and with a report the panel already renders. A silent cartesian-to-polar conversion of a user's own
  nudge was considered and rejected: re-interpreting numbers a user typed is exactly what
  `positionDetachedIds` exists to avoid.
- **`dragMath.ts` needs no code change**, established by reading it rather than assuming. A perimeter
  member with a literal radius resolves closed in both representations, so the ordinary
  overwrite-with-literals path applies before and after. With a SYMBOLIC radius, `r = base *
num(scale)` is a product, which `tryInvertFormulaCoordinate` declines — exactly as `dx = base *
num(cx)` declines today. What changes is a gain: a member of a group whose ROTATION is `sym(name)`
  now has `theta = sym ± num`, which the absorb path DOES invert, so dragging a member of a
  symbolically-rotated square keeps the rotation reference and adjusts the constant. The decline
  wording also changes from "Across/Down" to "Radius/Angle", a user-visible string change slice A
  owns.
- **Existing tests asserting `cartesian` for the three kinds are rewritten deliberately**, with the
  underlying positions re-derived rather than relaxed. They are named individually in slice A's
  brief.
- **`emitModel.ts`'s rotation refusal is deleted**, and with it the now-unused `isPerimeterKind`
  helper and its comment (a comment restating a rule the code no longer implements is worse than
  none).
- **`land-placement-shape-kinds-escalation.md` §7's "no vertex handles" argument re-run, as Sec.4
  asks.** It still holds after ask (1) — a rigid spin gives a vertex no freedom the radius/rotation
  gizmo lacks. Ask (2) weakens its premise (a member can now sit anywhere along the perimeter, not
  only at the even walk), but the handle that would follow is a "drag a member ALONG the perimeter"
  gesture, not a vertex handle, and that is parked in Sec.8.8 with its own reason.

### 8.7 Two findings that are NOT in Sec.1-7 and cost real time to derive

1. **The refusal does not disappear; it MIGRATES — and then the type system eats it.** Rotation can
   be symbolic because it is additive on the bearing and leaves `R_loc` alone. A perimeter POSITION
   cannot be symbolic under any representation this compiler can emit: the side index `k` is a
   `floor` of the fraction, and `R_loc`/`psi` are discontinuous across a vertex, so a fraction the
   tool cannot see at expansion time has no `radiusScale` and no bearing. Making `perimeterShift` a
   plain `number` (`sweep`'s own precedent, and `sweep`'s own reason) turns what would have been a
   runtime refusal into something unrepresentable, which is strictly better and is why ask (2) adds
   no new `kindProblems` entry.
2. **The `perPlayer` refusal quietly becomes load-bearing in a way it was not.** `prologue.ts`'s
   member loop skips any placement whose offset is not `polar` — a defensive second line that, today,
   happens to catch every perimeter member. After the unification it catches nothing, so
   `emitModel.ts`'s `g.perPlayer && g.kind !== "circle"` refusal is the ONLY thing standing between a
   square and a set of silently-stamped ring angles. It must stay, and slice A owes it a regression
   test that says so in its own title. (Read the other way, this is also the news that a per-player
   ARC — one of the two wants parked by the previous escalation — is much closer than it was: the
   prologue's rule-detection machinery works on any polar member.)

### 8.8 Parked, with reasons, so a later session does not rediscover them

- **Dragging a member ALONG the perimeter on the canvas.** The natural gesture, and out of scope for
  both slices: a drag on a member already means "nudge this one land freely" (literal offsets,
  `nudged: true`), and `perimeterShift` lives on the SLOT, so the same gesture would move every
  repeat of that slot. Two meanings for one gesture needs its own design, including which of the two
  a modifier key selects.
- **A bounded random jitter along the perimeter** (Sec.5's option 2). `jitter.ts`'s closed form
  carries over almost unchanged IF the unit is a fraction of the perimeter rather than degrees —
  worth checking rather than assuming — but nothing in it can be written into the model as a
  `RandomParam`, for the reason `land-placement-per-player-slice-c` already records, so it would be a
  second advisory calculator. Neither ask in Sec.0 asks for one.
- **A `formula`-kind escape for a symbolic perimeter position.** Expressible — `x = anchorX +
R*apo*COS(phi) - R*u*SIN(phi)`, with `u` symbolic and the anchor reached by `nodeRef` — but it
  abandons the polar representation for that member, and Sec.8.7's finding 1 makes it the only route,
  so it is a real fork if anyone ever needs a random walk along a polygon's edge. Not needed for
  either ask.
- **`perPlayer` for non-circle kinds** stays refused, per Sec.6, untouched by this design.
