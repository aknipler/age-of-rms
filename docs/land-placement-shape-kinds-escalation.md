# Land Placement escalation: what does a non-circle `ShapeGroup.kind` mean?

**Status: IMPLEMENTED 2026-09-03.** `line`, `arc`, `square`, `triangle` and `polygon` each have a
geometry and a formula below, and all six kinds are now built — slice C (`triangle`/`polygon`/
`ShapeGroup.sides`, plus the two handles left of slice 5's own item 6) was the last of the three.
`square`/`triangle`/`polygon` turned out to be one shared implementation at three fixed side
counts. The two behavioural questions this file also carried (§3(b)'s `reExpand` branch, §6's drag
absorb-vs-decline) were decided and built alongside them. Raised 2026-09-02 when slice 5's item 6
(per vertex handles) was cut. What follows is left in its original decision-document form (the
question, the evidence, the options and a recommendation) rather than rewritten as a retrospective,
since the reasoning is still the reasoning; §5's build order and §7 below record what was actually
built against it.

**Decide this before writing any code in `expand.ts`.** `CLAUDE.md`'s own rule is that a spec
that seems ambiguous gets escalated rather than improvised, and this is the narrower case of a
spec that is silent on something its own type declares.

---

## 1. The question

`ShapeGroup.kind` is typed with six values.

```ts
kind: "circle" | "square" | "triangle" | "polygon" | "line" | "arc";
```

`expandShapeGroup` (`src/tools/builtin/landPlacement/expand.ts:57`) never reads the field. Every
kind expands identically, onto a ring:

```
r     = slot.radius ?? group.radius
theta = group.rotation + (slot.theta ?? even division of 360)
```

So five of the six values are inert today. A `square` group is a circle, and nothing anywhere
says what it should be instead.

## 2. What the repo actually says about them, which is almost nothing

- **`docs/land-placement-design.md` Sec.1, line 49** is the only prose mention: *"Drop lands in
  standard shapes, circle, square, triangle, ..."*. That is the goal statement in "what was asked
  for", written before the model existed. It names three of the six and defines none.
- **Sec.4.5** is the section that owns `ShapeGroup` and it discusses `pattern`, `repeats`,
  `rotation`, `radius`, the member ordering invariant and the merge rule. It never mentions
  `kind` at all.
- **Sec.7.3** says *"Shape buttons create a group at map centre; then a radius ring handle, a
  rotation handle, and a count stepper"*. Plural "buttons", so more than one kind was intended to
  be creatable, and the two gizmo handles it names are radius and rotation, which are circle
  vocabulary.
- **`model.ts` carries one real clue.** `radius` is commented as *"default **circumradius**,
  PERCENT"*. Circumradius is the word for the distance from a regular polygon's centre to its
  vertices, so the author was thinking of a polygon inscribed in the ring rather than of some
  separate side-length parameterisation. The word appears nowhere else in the repo and was never
  implemented, so treat it as a hint about intent, not as a decision.

**Nothing in the app can currently produce a non-circle group.** The panel's "+ Ring" button
always writes `kind: "circle"`, so the only way to reach one is by hand editing the `@alp-model`
JSON inside the fence. That is why the gap has cost nothing so far, and it is also why closing it
is cheap: there is no existing data to migrate and no user expectation to break.

## 3. The question is really three questions

**(a) What is each kind's geometry? DECIDED for all six kinds, 2026-09-03.**

`line` is the dual of `circle` in the same `(r, theta)` polar representation `expand.ts` already
uses. Circle holds `r` fixed and varies `theta` per member. A line holds `theta` fixed at
`rotation` and varies `r`, signed, per member.

```
r_i     = (i - (N-1)/2) * spacing
theta_i = rotation
```

Feeds straight through `frame.ts`'s existing `x = r*cos(theta) + anchorX` unchanged, since nothing
there requires `r` non-negative. `spacing` becomes a new `ShapeGroup` field, or reuses `radius` as
the endpoint-to-endpoint half-length (`spacing = radius * 2 / (N-1)`), avoiding a new field
entirely. No new primitive, no new `Placement.offset` kind, `reExpand`'s existing `polar` delta
branch keeps working unchanged.

`arc` is `circle`'s own formula with the hardcoded `360` replaced by a configurable sweep, and the
division by `N` (a closed ring) replaced by `N-1` (an arc's two ends are both occupied, unlike a
ring where the last member never coincides with the first).

```
r_i     = radius
theta_i = rotation + i * (sweep / (N-1))   // N = 1 is a degenerate single point at rotation
```

`sweep` is a new `ShapeGroup` field. **Amended, slice A, 2026-09-03: it does NOT degenerate to
today's circle at 360, and defaults to 180, not 360.** The paragraph originally here claimed a
360 sweep "degenerates to today's circle exactly". It does not: this formula divides by `N - 1`
(an arc's two ends are both occupied) where `circle` divides by `N`, so a 360 sweep puts the last
member on top of the first rather than closing into a ring, the exact collision the `N` divisor
exists to avoid. 360 is legal input, not a special case, and produces that stack deliberately
(`model.ts`'s own `sweep` doc comment has the corrected reasoning). The same rounding discipline
`angleOffsetDegrees` already applies (round each `theta_i` to the nearest integer degree before
it reaches the SIN/COS macro, Sec.5.4's self-guarding requirement) carries over unchanged. Stays
`polar`, `reExpand` unaffected.

`square` is decided to walk the perimeter, not sit at the four vertices only, per the owner's own
requirement: eight lands on a square must be able to land mid-edge, not only at a corner. That
settles this section's original vertex-vs-perimeter either/or in favour of the perimeter reading,
which is also the one that keeps `pattern.length x repeats` meaningful as the land count (Sec.4.5's
own framing, unchanged from the original question).

The chosen distribution is evenly BY ARC LENGTH along the boundary, not evenly by angle from the
centre, because it needs no trigonometry at all and it is what "walk the perimeter" means most
directly. Circumradius `R` (matching `radius`'s existing circle meaning) gives half-side `h = R /
sqrt(2)` and perimeter `P = 8h`. Member `i`'s arc-length position is `d_i = (i * P / N + phase) mod
P`, `phase` carrying `rotation`'s own role (which point sits at distance 0). The side index `k_i =
floor(d_i / 2h)` and the local offset `u_i = (d_i mod 2h) - h` are both plain numbers, computed
once by the tool exactly the way `angleOffsetDegrees` already bakes an angle, never emitted as RMS
arithmetic. Each side is then a fixed pair of axis-aligned coefficients multiplying `u_i` and `h`,
so a member's offset is

```
dx_i = coeffX(k_i) * h + coeffU_x(k_i) * u_i
dy_i = coeffY(k_i) * h + coeffU_y(k_i) * u_i
```

four constant `(coeffX, coeffY, coeffU_x, coeffU_y)` tuples, one per side, `+1`/`-1`/`0` valued and
fixed at build time. This needs no `abs`, no `max`, no SIN/COS at all, only the same multiply
already used for every `#const` cell in this compiler, so it emits as a plain `cartesian` offset,
a `dx`/`dy` pair of `Expr`s.

**Correcting the framing from the design discussion that led here.** An earlier pass on this
question assumed a perimeter square could not carry a symbolic (`RandomParam`-backed) radius, on
the premise that the closed polar form `r(theta) = R * cos(pi/4) / cos(theta_local)` needs `abs`/
`max`. It does not, once `theta_local` (equivalently here, the side index and local offset) is
recognised as a value the TOOL always bakes ahead of time, the same way every other shape's angle
already is. `h` above is `R / sqrt(2)`, a coefficient the tool computes once. `R` itself, and
therefore `h`, can be `radius: sym("SOME_PARAM")` or any other symbolic `Expr` with nothing above
changing, since `dx_i`/`dy_i` stay ordinary multiplication of that `Expr` by a baked scalar.

**One real limitation this does carry, worth recording rather than discovering later.** `frame.ts`'s
`cartesian` branch does not compose with `Placement.frame`/rotation at all (its own header comment,
point 1): a `cartesian` offset's `dx`/`dy` are added to the anchor directly, never rotated. So a
square built this way supports a symbolic RADIUS but not a symbolic ROTATION, since rotating the
walk means baking `rotation` into the per-side coefficients above, which only works for a literal
`rotation` value. A square that needs to spin under a live parameter (the `ROTATION_PLAYER` shape
Sec.4.5 already supports for circle) would have to go through the `formula` offset kind instead,
writing the rotation explicitly with SIN/COS (`x = anchorX + dx_i*cos(rotation) -
dy_i*sin(rotation)`, and the `y` equivalent), fully expressible with the compiler's existing
primitives but with `expand.ts` composing the Exprs itself rather than leaning on `frame.ts`'s
automatic composition. Not a blocker, a literal rotation is the overwhelmingly common case,
matching every ring built in the corpus today, but the fork should be built deliberately rather
than discovered when someone tries to spin a square.

**`triangle` and `polygon` are DECIDED too, 2026-09-03, as the general `M`-sided case `square`'s own
derivation already generalises to.** `square` above is `M = 4` of a single shared formula, not a
special case with its own geometry, so this is the same design written once at the general `M` and
specialised three ways.

**The general perimeter walk, any `M >= 3`.** Circumradius `R`, apothem `a = R * cos(pi/M)`,
half-side `h = R * sin(pi/M)` (which recovers square's own `h = R / sqrt(2)` exactly at `M = 4`,
since `sin(pi/4) = 1/sqrt(2)`). Side `k`'s own midpoint sits at bearing `phi_k = rotation + k *
(360/M)`, and a point `u` away from that midpoint along the side (perpendicular to the radius) is

```
x_local(k, u) = a * cos(phi_k) - u * sin(phi_k)
y_local(k, u) = a * sin(phi_k) + u * cos(phi_k)
```

Member `i`'s fractional position along the whole perimeter is `delta_i = (i / N + phase) mod 1` (a
plain ratio, independent of `R`). **Amended, slice B, 2026-09-03: `phase` is dropped, and the
constant term is `1 / (2M)`, not a rotation-carrying `phase`.** This paragraph originally routed
`rotation` through TWO places at once, `phi_k` above AND `phase` here, which would spin the shape
AND slide every member along its own perimeter for the same rotation edit — a 90 degree rotation
of a square would not read as a rotation of the picture at all. Rotation enters once, through
`phi_k` only, exactly what it already means for `circle`/`line`/`arc`; the fixed `1 / (2M)` term
instead starts the walk at the midpoint of side 0, so member 0 sits on the rotation ray like every
other kind (`perimeterOffset`'s own doc comment in `src/tools/builtin/landPlacement/perimeterOffset.ts`
has the corrected reasoning). It picks its side `k_i = floor(delta_i * M)` and its local
fraction `f_i = (delta_i * M) mod 1`, giving `u_i = (f_i - 0.5) * 2h`. Substituting `h = R *
sin(pi/M)` shows `u_i` is itself `R` times a plain number, so both of

```
dx_i = R * [ cos(pi/M) * cos(phi_{k_i}) - uCoeff_i * sin(phi_{k_i}) ]
dy_i = R * [ cos(pi/M) * sin(phi_{k_i}) + uCoeff_i * cos(phi_{k_i}) ]
```

are `R_expr` (which may be symbolic) times a single scalar the tool computes once per member from
`(i, N, M, rotation)` alone, none of which are ever runtime values. **This is structurally
identical to square's own formula**, just with `cos(phi_k)`/`sin(phi_k)` computed by ordinary JS
trig instead of being restricted to axis-aligned `0`/`+-1` values, so it costs nothing beyond what
`square` already needs: no `abs`, no `max`, no SIN/COS at RMS runtime, one `cartesian` offset per
member, symbolic `radius` fully supported by the same "multiply a baked scalar" argument, symbolic
`rotation` carrying the same limitation (bake it, or fall back to `formula`, per (a)'s square
section above).

**The consequence worth stating plainly: `square`, `triangle` and `polygon` are ONE
implementation, not three.** A single function `perimeterOffset(M, N, i, phase)` returning
`(coeffX, coeffY)` per member covers all three; `expand.ts` calls it with `M = 4` for `square`,
`M = 3` for `triangle`, and `M = group.sides` for `polygon`. Building any one of the three builds
the machinery for all of them, and the marginal cost of the other two, once one ships, is the model
field below plus the panel control to set it.

**The model change this needs, pinned:**

```ts
export interface ShapeGroup {
  ...
  /**
   * Side count for `kind: "polygon"` ONLY, `>= 3`. `square` and `triangle`
   * hardcode 4 and 3 respectively and carry no field of their own, since
   * their side count is exactly what distinguishes them as kinds. Absent
   * (or ignored) for every other kind.
   */
  sides?: number;
}
```

Not a field on `square`/`triangle`, deliberately: naming them separately in `kind` and then ALSO
letting their side count vary would let a `square` disagree with its own name, which is a trap this
model does not need. `polygon` is the one kind that is a shape FAMILY rather than a fixed shape,
so it is the one that needs the number.

**What decides between `square`/`triangle`/`polygon`'s naming and one generic
`polygon(sides)` kind is discoverability, not geometry**, and the type as it already stands
(carrying all three names) already made that call: a panel button labelled "Square" is findable in
a way "Polygon, sides = 4" is not, and `docs/land-placement-design.md` Sec.1 line 49 asked for the
named shapes specifically. Keep all three kinds; `perimeterOffset` is where the redundancy is
absorbed, not the type.

**(b) Does the integrality requirement survive? RESOLVED for all six kinds, 2026-09-03.** `line`
and `arc` stay `polar` exactly like circle, so nothing here changes for them, `reExpand`'s existing
delta branch keeps working untouched. Every perimeter-walking kind bakes to a `cartesian` `dx`/`dy`
pair (one shared formula, per (a) above), so `reExpand.ts`'s merge rule needs a second branch
mirroring the existing `polar` one exactly, componentwise: a nudged cartesian member's delta
reapplies as `new_dx = new_base_dx + (old_dragged_dx - old_base_dx)`, same for `dy`, the identical
shape the existing `polar` branch already uses for `r`/`theta`. This is not a fresh design call, it
is the existing merge rule applied to a second offset kind, and because `square`/`triangle`/
`polygon` share one implementation it is ONE addition to `reExpand.ts` that unblocks all three at
once, not three separate ones. Without it, any of the three would leave its members permanently
`positionDetached` on the very first repeat-count edit, silently, which is what this subsection
originally warned about.

**(c) Whose slice is it?** Closing (a) and (b) is a model change, an `expand.ts` change, a
`reExpand.ts` review, a panel control to create one, and only then the per vertex handles that
slice 5's item 6 was actually about. That is a slice, not a follow-up item.

## 4. Options

1. **Define the kinds and build them.** Answer (a) and (b), then implement. Largest, and it is
   the only option that delivers what Sec.1 line 49 promised.
2. **Cut the field to what is implemented.** Narrow the type to `"circle"` and delete the other
   five values, recording the reason. Honest, small, and reversible; the type stops advertising
   behaviour that does not exist, and `docs/land-placement-design.md` Sec.1's goal moves to a
   named future item rather than sitting silently unmet.
3. **Add `arc` only.** A `sweep` field defaulting to 360 makes the existing expansion a special
   case, needs no new geometry, keeps every member `polar`, and closes (b) trivially. The
   polygonal kinds stay out until someone wants them.
4. **Leave it.** The field keeps lying. Not recommended: an inert enum value is exactly the shape
   of defect this repo has paid for before, where reading the type is enough to believe the
   behaviour exists.

## 5. Recommendation

~~**Option 2 now, option 3 when someone wants a partial ring, option 1 only on a real request.**~~

**SUPERSEDED 2026-09-03: option 1 for all six kinds.** The original recommendation's whole
argument was that Sec.1 line 49's wishlist had never been pointed at by a real measurement or
request. That premise no longer holds for any of the six, per Sec.3(a)'s decisions above, all
raised by the owner asking for them directly, including the mid-edge requirement that settled
`square`'s own vertex-vs-perimeter fork and turned out to generalise to `triangle`/`polygon` at no
extra cost.

**Build in this order, each step unlocking the next at close to zero marginal cost:**

1. ~~`line` and `arc` first.~~ **BUILT 2026-09-03 (slice A).** Sec.3(a)'s formulas ride the
   existing `polar` model unchanged, zero `reExpand` impact. `docs/land-placement-design.md`
   Sec.4.5's "Shape kinds: line and arc" subsection has the write-up; the panel's kind control
   offers Circle, Line and Arc, and states out loud when a hand-edited model holds an unbuilt
   `square`/`triangle`/`polygon`.
2. ~~`reExpand.ts`'s cartesian-delta branch (Sec.3(b)), once, before any perimeter kind ships.~~
   **BUILT 2026-09-03 (slice B).** Both `polar` (unchanged) and both `cartesian` (the new,
   componentwise-identical branch) delta the same way; a mixed pair still reports
   `positionDetached`. `dragMath.ts`'s absorb path (Sec.6) landed in the same pass, per this
   line's own prediction.
3. ~~`square` (`M = 4`), the reference implementation of `perimeterOffset(M, N, i, phase)`.~~
   **BUILT 2026-09-03 (slice B).** `src/tools/builtin/landPlacement/perimeterOffset.ts`, its own
   test file, and `expand.ts`'s `square` case. `docs/land-placement-design.md` Sec.4.5's "Shape
   kinds: line, arc and square" subsection has the write-up; the panel's kind control offers
   Circle, Line, Arc and Square.
4. ~~`triangle` (`M = 3`) and `polygon` (`M = group.sides`), which are the same function called two
   more ways plus the `sides` field and its panel control. Not a second design pass.~~ **BUILT
   2026-09-03 (slice C).** Exactly the same function, two more calls, plus `ShapeGroup.sides`
   (clamped to at least 3 rather than refused, `expand.ts`'s `clampSides`) and the panel's Sides
   number input. `docs/land-placement-design.md` Sec.4.5's shape-kinds subsection has the write-up;
   the panel's kind control now offers all six kinds. The same session also closed what was left
   of slice 5's item 6, the two handles a `line` and an `arc` each still needed (§7 below).

Nothing is deferred by this recommendation any more, so the "cut the type" half of option 2 no
longer applies to any kind. If a future session finds real demand does not match this order (say,
`polygon` wanted before `square`), building the general form first and specialising down costs
nothing extra, since `square`/`triangle` are already special cases of it, not the other way round.

## 6. A second, smaller decision this file is also the home for

~~`dragMath.ts`'s `applyDrag` declines a drag whose `polar`/`cartesian` offset carries a live
symbolic reference.~~ **DECIDED 2026-09-03: absorb, not decline**, for both offset kinds, matching
what `formula` offsets already do. **BUILT the same day (slice B).** `applyDrag` took the new
`resolvedOffset` parameter this section pins below, both call sites (`LandPlacementCanvas.tsx`'s
own drag handler and `computeRimDragReparent`) supply it, and the `isPerPlayerMember`-before-absorb
ordering this section's own closing paragraph asks for is what the code does.

**The mechanism, reusing what already exists.** `tryInvertFormulaCoordinate` already recognises
exactly one invertible symbolic shape, `sym(name) ± num(k)`, and adjusts only the constant,
preserving the reference. It does this today only for `formula`'s absolute x/y. Extending it to
`polar`/`cartesian` needs one new piece of information at the call site: `formula`'s delta is
"dropped position minus the node's own previous position", computable with no lookup since
`formula`'s x/y ARE the absolute position. `polar`'s `r`/`theta` and `cartesian`'s `dx`/`dy` are
OFFSETS from an anchor, so a symbolic component's CURRENT numeric value has to come from
`emission.resolved` (via `evalExpr`, the same evaluator `dragMath.ts` already imports from
`compiler/expr.ts`) before a delta means anything. So `applyDrag` needs the placement's own
currently-resolved `r`/`theta` (or `dx`/`dy`) passed in alongside the anchor and the drop point,
one new parameter, not a new lookup mechanism. From there each symbolic component gets:

```
target = dragPolar(...).r_or_theta          // exactly what a fully-numeric drag would compute
current = evalExpr(offset.r_or_theta, resolvedFrom(emission))
delta = target - current
tryInvertFormulaCoordinate(offset.r_or_theta, delta)
```

**All-or-nothing, matching `tryInvertFormulaOffset`'s own existing rule.** If `r` is symbolic and
invertible but `theta` is symbolic and NOT (a bare `sym` with nothing to adjust, a product,
SIN/COS), the whole drag declines, exactly the way `formula`'s own x/y pair already declines
entirely if EITHER coordinate fails to invert. A component that was already a plain numeric
literal is unaffected either way, it just gets its ordinary freshly-computed value the same as
today.

**One case stays force-declined regardless, and it needs its own stated reason.** A `perPlayer`
group member's `theta` (`isPerPlayerMember`) declines unconditionally, not because it can't be
inverted, but because the model's own stored theta is not what gets emitted at all, the prologue
substitutes a `sym` reference to its own per-count constant over it (Sec.8.2 of
`land-placement-per-player-escalation.md`). Absorbing a delta into a value the emission never
reads would silently do nothing, which is worse than declining: the user would see the drag
"succeed" and then watch it have no effect on the real output. `isPerPlayerMember` already exists
as a caller-supplied flag for exactly this reason (dragMath.ts's own header comment says the shape
is indistinguishable from an ordinary literal one, which is why the caller has to say so rather
than the module inferring it) and needs no change.

**What this costs to verify.** New tests for the absorb path itself (a symbolic `r`, a symbolic
`theta`, both, one invertible and one not), and Sec.7's own note that a drag test whose fixture
passes with the guard removed is the specific failure mode this area has hit before, so the
existing decline-side tests stay and gain company rather than being replaced.

## 7. What closing this needs

Nothing left to decide. §3(a) (geometry), §3(b) (`reExpand`'s cartesian-delta branch) and §6 (drag
absorbs rather than declines, with the `perPlayer` force-decline kept) are all resolved above.
What remains is ordinary implementation work, not a design question: the `ShapeGroup.sides` field
from §3(a)'s pinned model change, `expand.ts`'s `perimeterOffset(M, N, i, phase)` and its three call
sites, `reExpand.ts`'s new cartesian branch, `dragMath.ts`'s absorb path per §6's mechanism, and the
write-up into `docs/land-placement-design.md` Sec.4.5 this section always asked for. Acceptance:
each kind's expansion pinned by a test on member positions before any handle exists, a `reExpand`
test for a perimeter kind's own repeat-count edit (one fixture covers `square`/`triangle`/`polygon`
at once, since they share the code path), and `dragMath.ts` tests for the absorb path on both a
symbolic `r` and a symbolic `theta`, including the one that must still decline (`perPlayer`).
This is ready for a slice brief, the same shape as `docs/land-placement-per-player-slice-a-brief.md`
and its two successors.

**BUILT 2026-09-03 (slice C), and one more question closed on the way.** Slice 5's item 6 was cut
as "per vertex handles for `square`/`triangle`/`polygon`/`line`/`arc`", and once (a) settled the
geometry most of that item dissolved rather than shipped: **a perimeter kind needs no vertex
handles.** Its vertices are fully determined by the circumradius and the rotation, both of which
the existing radius/rotation gizmo already edits, so a vertex handle would be a second control for
two numbers that already have one — dragging a vertex could only mean "set radius and rotation
together", which is exactly what the two existing handles already do between them. Nothing was
built for `square`/`triangle`/`polygon` for this reason, and the type alone should not be read as
implying otherwise; if a vertex handle starts to look necessary later, the question to ask first is
what it would set that radius and rotation do not. What was left of the item, one handle per
*polar* kind slice A introduced, shipped: a line's own second end (mirrored through the anchor,
`gizmoGeometry.ts`'s `lineEndHandlePosition`) and an arc's own sweep (at its last member,
`arcSweepHandlePosition`), both interpreted as pure functions in `canvasInteraction.ts`
(`computeLineEndDrag`/`computeArcSweepDrag`). `docs/land-placement-design.md` Sec.7.3's handle list
is corrected to name them.
