# Land Placement, per player on every shape kind

**Status. Design, rev 2, 2026-09-28. Slices A (the core and Arc) and B (radius cells and Line)
built 2026-09-28, and slice C (the perimeter kinds) built 2026-09-29. Every kind takes one land
per player, and the interim guard of section 2 is deleted.** Every
fork was decided by the owner the same day (section 3), and nothing is open. Decision 9 was asked
while building slice C. Rev 2 replaced rev
1's perimeter slide with a runtime walk round the perimeter (5.4) and dropped the minimum
separation helper for the new kinds (5.5). Sliced in section 9.

Read `docs/land-placement-design.md` Sec.4.5 (shape kinds and the merge rule) and
`docs/land-placement-per-player-escalation.md` (the prologue, Sec.8 and Sec.11) before this file.
Where this file and those two disagree about per player shapes, this file is the later decision.

---

## 1. The ask, and how it arrived

A run of the panel found a trap. On a per player ring, picking Line in the Shape select left
`perPlayer` on. `emitAlpModel` refuses a per player group of any kind other than Circle
(`group:<id>:perPlayer`), so the whole dry run failed, the canvas drew nothing, and every shape
vanished. The "One land per player" checkbox is disabled outside Circle, so the user could not
untick it, and the only report was one line in the collapsed Generated code section.

Neither Sec.4.5 nor `land-placement-shape-kinds-slice-a-brief.md` item 5 says what a kind change
on a per player ring should do. Both describe the refusal in two places (the emitter, and the
checkbox) and nothing guarded the other direction. The slice A run sheet (manual run sheet
section 6) went further and named the refusal in Generated code as the expected result.

Asked which rule should apply, the owner answered that **per player should work for any shape**.
That turns a guard question into this feature, parked twice before. Sec.4.5 called a per player
arc "a real future want" and the perimeter rotation escalation Sec.6 left the refusal alone as out
of scope.

## 2. The interim guard, built 2026-09-28

Until the slices in section 9 land, a per player shape stays a circle, and the trap is closed
from the panel's side.

- `perPlayerSupportsKind(kind)` in `prologue.ts` answers "can the prologue place this kind per
  player", Circle alone today. Three guards read it and nothing else.
- `emitAlpModel`'s existing refusal reads it in place of its own `kind !== "circle"`.
- `applyGroupEdit` returns null for an edit that newly makes a per player group of an
  unsupported kind, the way it already returns null for an origin the shape cannot take. A group
  that already holds the combination (only a hand edited fence can) still takes every edit, so
  unticking it or picking Circle keeps working.
- The Shape select disables every option but Circle while One land per player is ticked, with a
  title saying to untick it first. The checkbox stays enabled while ticked, so a hand edited per
  player square can be unticked.

Each slice widens `perPlayerSupportsKind` to the kinds it builds. Slice C deletes the function
and the three guards with it, since a predicate that always answers yes is dead code.

Deleted by slice C on 2026-09-29, with all three guards. The Shape select offers every kind and
One land per player is enabled on every kind, ticked or not.

## 3. Decided by the owner, 2026-09-28

1. **Per player works for every kind.** Circle, Line, Arc, Square, Triangle and Polygon.
2. **The whole shape re-spaces at every count.** At player count k the shape holds
   `N_k = L × k` members (L is `pattern.length`), spread over the whole shape by the kind's own
   formula, as the ring does today. At 3 players a line has lands at both ends and the middle,
   an arc spans its full sweep, and a square spreads them evenly round its perimeter. Keeping the
   eight player positions and dropping the absent players' lands was the rejected alternative,
   since it leaves a line or an arc lopsided below eight.
3. **Jitter moves a land along its own shape, for every kind.** Section 5 is the design this
   answer asked for.
4. **A land slides along the polygon's perimeter and turns its corners** (rev 2). Rev 1 slid a
   land along the straight side it sat on and asked whether a corner land should slide some
   other way. The owner answered that it follows the perimeter, and 5.4 shows the engine can.
5. **No minimum separation input on Arc, Line or the perimeter kinds** (rev 2). The scripter
   sets how far lands may move by choosing the jitter amount, which already decides how close
   two neighbours can come. Circle keeps the helper it has.
6. **Using only part of a shape is its own want** (rev 2), recorded in section 11 and not
   designed here.
7. **A kind change that leaves degree jitter on a kind without degrees translates it** (asked
   while building slice B). A per player Circle or Arc can hold `deg` jitter, and Line cannot
   (5.1), so switching the Shape to Line would have met the emitter's `jitterUnit` refusal and
   blanked the canvas, the same trap as section 1. The owner chose to keep the jitter and
   translate it, as a percent of the old shape's even gap at the player count being previewed,
   rounded down to a whole number and never below 1. `setGroupKind` in `panel/modelOps.ts` does
   it, and `applyGroupEdit` refuses an edit that would newly leave `deg` on such a kind, so no
   other caller can reach the refusal. Removing the jitter and refusing the kind change were the
   rejected alternatives.
8. **Jitter on a Line is decided per quantity** (asked while building slice B). Line jitter
   moves `r` (5.3), so only a rule on `r` takes it away, an authored radius or a drag. A member
   with an authored angle, or a per count angle override, keeps its radius jitter. Section 5's
   "a member with an authored rule or a per count override gets none" was written with the ring
   in mind, where both live on the same quantity.
9. **A per count angle on a jittered perimeter land keeps that land off the walk at every count**
   (asked while building slice C, 2026-09-29). A kind change keeps a member's
   `Placement.thetaPerCount`, so a circle land with an override at 4 players keeps it as a square
   land. The walk of 5.4 sets X and Y once, outside the count branches, so it cannot give way to
   a fixed angle at one count only. The owner chose to keep the override, give that land no walk
   and no jitter at any count, and show the per count list on a perimeter shape while the land
   still holds an override, so the scripter can see why it does not jitter and remove it. No new
   override can be added there. Clearing the overrides on a kind change was the rejected
   alternative, since it loses work a switch back cannot restore and still leaves a hand edited
   fence to handle.

## 4. The core, the prologue asks the expander

`prologue.ts` computes the ring formula at each count through its own copy of `expand.ts`'s
arithmetic (`evenAngleOffsetDegrees`, a deliberate duplicate). That copy is the reason every
other kind is refused, and generalising it kind by kind would grow a second implementation of
every formula in Sec.4.5.

**The expander already answers the question.** `expandShapeGroup` takes the member count as its
only count input, through `repeats`, and member ids are deterministic in the repeat and slot
(`memberIdFor`). So the position of member `(i, j)` at player count k is the position
`expandShapeGroup` gives it when `repeats` is k. The kind's formula then lives in `expand.ts`
alone, for every kind, and the prologue asks it once per count.

The per kind `switch` in `expandShapeGroup` moves into an exported
`memberOffset(group, repeatIndex, slotIndex, repeats)` returning the member's polar offset.
`expandShapeGroup` calls it with `group.repeats`. `buildPrologue` calls it with each count from 1
to `MAX_PLAYER_COUNT`, on the group with its rotation already resolved for params (the
`resolvedRotationByGroup` it receives today). `evenAngleOffsetDegrees` is deleted.

For Circle this is the same number by construction, since the two functions are the same
arithmetic, and it is pinned by slice A's acceptance rather than argued.

### 4.1 Which quantities move with the count

| Kind                      | Moves with the count | Per count cells, per member per branch |
| ------------------------- | -------------------- | -------------------------------------- |
| circle                    | theta                | `DEG` (today)                          |
| arc                       | theta                | `DEG`                                  |
| line                      | r                    | `DEG`, `RAD`                           |
| square, triangle, polygon | r and theta          | `DEG`, `RAD`                           |

A line's bearing does not move with the count. It still gets a `DEG` cell per member, as every
circle member does today, so a per count angle override (per player escalation Sec.8.3) has a
cell to land in on every kind. The price is one line per member per branch.

`RAD` is a new stem (Sec.5.6), chosen over `R` because the trig macro already emits an `R_k`
(Sec.5.4). `emitModel.ts` gains a radius substitution beside its theta one. Today it replaces a
per player member's `theta` with the prologue's `DEG` reference, and for a kind in the `RAD` rows
it also replaces `r`. `liveDegCells` and `crossCheckDegCells` carry the `RAD` cells too, so the
canvas draws the previewed count and the cross check covers every cell.

### 4.2 What counts as an authored rule

Per player slice B lets a member's own angle win over the even default ("first match wins",
`resolveMemberAngle`), and it detects a rule by comparing the member's stored theta with the
ring formula at `group.repeats`. That comparison becomes a comparison with the expander.

**A quantity carries a rule when the member is `nudged`, or when its stored value differs
structurally (`exprEquals`) from what `memberOffset` gives that member at `group.repeats`.** It is
decided per quantity, so a line member with an authored radius keeps that radius at every count
while its bearing still follows the shape. A `nudged` member carries a rule in both quantities,
since a drag writes both.

One output changes for Circle. `PatternSlot.theta` is part of what the expander produces, so a
slot angle on a per player circle now counts as the shape rather than as a rule, and a jitter
applies on top of it. Today the same member is read as a rule and gets no jitter. The case needs
a hand edited fence (the panel has no control for `slot.theta`), and on a per player ring a slot
angle stacks every player's land for that slot on one bearing (Sec.4.5, "only usable at
`repeats: 1`"), so the ring was already degenerate. Recorded here so the acceptance test that
pins Circle's output names it rather than finding it.

### 4.3 Small counts

At count 1 with one slot there is one member and no span. A line member sits at the anchor, an
arc member on the rotation ray, a perimeter member at the midpoint of side 0. Each is the span 0
rule `expand.ts` already has (`lineOffset`, `arcStepDegrees`, `perimeterPolar` at `N = 1`), and
none needs new code.

## 5. Jitter along the shape

Per player escalation Sec.11 is unchanged in everything below except the kinds it reaches.
Jitter applies to the default position only (a member with an authored rule or a per count
override gets none), and the draw is one `perPlayer` param per ring with every slot of a player
sharing that player's draw. On the new kinds the scripter types the amount (5.5) in place of the
button's computed bound.

**Along the shape** means a land moves along the path its kind lays members on, by a share of
the even gap between neighbours at that count.

### 5.1 Units per kind

| Kind                      | `deg`       | `percent` of the even gap |
| ------------------------- | ----------- | ------------------------- |
| circle                    | yes (built) | yes (built)               |
| arc                       | yes         | yes                       |
| line                      | no          | yes                       |
| square, triangle, polygon | no          | yes                       |

A line or a perimeter has no angle along its path, so `deg` has no reading there. The emitter
refuses `unit: "deg"` on those kinds (a new `kindProblems` entry, `group:<id>:jitterUnit`) and the
panel hides the unit toggle for them, the same two place pattern Sec.4.5 already uses. A distance
unit for jitter (map percent) is not designed, and nothing here needs one.

In every kind the jitter term is left out of a branch whose span is 0 (one member, no
neighbour), since there is no gap to take a share of.

### 5.2 Arc

The gap at count k is `sweep / span_k`, `span_k = N_k - 1`.

- `deg` is circle's form, `DEG = default + J`.
- `percent` is circle's percent form with 360 replaced by `sweep` and `N` by `span`,
  `J * sweep / span / 100 + default`. Both are integer literals, and `appendAddends` keeps the
  whole angle one left spine as it does for the ring.

The two end members can move past the arc's nominal ends by the amount's share of a gap, staying
on its circle.
A clamp would need the draw compared with a bound at runtime, and an `if` tests a label, never a
value (per player escalation Sec.2).

### 5.3 Line

The quantity is `r`. With `B` the member's own base (`slot.radius ?? group.radius`), the gap at
count k is `2B / span_k`. The percent form is one left spine when `B` is a leaf,

```
J * 2 / 100 + K * B / span        K = 2m - span, an integer literal
```

which RMS reads left to right as `(J × 2 / 100 + K) × B / span`, equal to the even
`B × K / span` plus `J` percent of `2B / span`. A probe checked the two forms against each other
over five radii, five spans, every member and five draws, with a largest difference of 7e-15.
A negative `K` rides inline as an operand (Sec.5.3). A `B` that is not a leaf is hoisted into a
temporary by the emit rule, as `lineOffset`'s own output already is today.

The two end members can move past `±B` by the amount's share of a gap, along the line.

### 5.4 Square, triangle, polygon

**A jittered land walks the perimeter at runtime and turns its corners.** The walk fraction is
linear in the draw, and the engine can compute everything the walk needs from there. `%`
truncates both operands toward zero (Sec.5.1, measured), so for a positive value `x % 100000` is
its whole part, which gives the side a land is on and how far along it. The trig macro takes an
angle computed at runtime (Sec.5.4), the way a random rotation already reaches it.

Per branch, one cell per member, the walk in laps.

```
WALK = J / N / 100 + w0 + L        w0 = m / N + 1 / (2M) + shift / 100, rounded to 6 places
```

`J / N / 100` is `J` percent of the even gap as a share of one lap, and `w0` is the member's
even walk fraction from `perimeterPolar`. `L` is the whole number of laps that keeps `WALK`
positive at the draw's lower bound, computed at emit time from the jitter param's `min` and the
member's own `w0`, which a negative `perimeterShift` can pull below 0. Without it the truncating
`%` would round a negative walk toward zero and put the land on the wrong side. A whole lap
moves nothing.

Once, in the unconditional body, per member.

```
SIDE = WALK * M % 100000             whole sides walked
K    = SIDE % M                      which side
F    = WALK * M - SIDE               how far along it, 0 to 1
A    = K * 360 / M + 360.5 + base    side K's midpoint bearing, in the member's own frame
       (one trig macro over A)
U    = F * 2sin(180/M) - sin(180/M)  signed distance from the midpoint, in units of B
VS   = U * SIN_A
VC   = U * COS_A
X    = COS_A * apo - VS * B + anchorX        apo = cos(180/M)
Y    = SIN_A * apo + VC * B + anchorY
```

`base` is what the member's own bearing is composed from, the rotation plus `DEGREES_parent +
180` in a radial frame (Sec.4.2). The `+ 360.5` keeps the angle positive so the macro's
truncating `%` rounds it to the nearest degree, which holds whenever the rest of the angle is
above −360, as the default random rotation always is. The point is the side's midpoint,
`apo × (COS, SIN)`, plus `U` along the side, and the side's direction is the midpoint's turned 90
degrees, `(−SIN, COS)`. So one macro serves both terms, and the corner needs no expansion of its
own. The sines, `apo` and `w0` are baked to six decimal places on `perimeterOffset.ts`'s own
`round6` precedent.

**Checked through the preview's own evaluation.** A probe built these cells with the compiler's
`emitCells` and `expandTrig`, wrote them as `#const` lines, and evaluated them through the
preview's `instantiateScript`, the path the map preview takes (CLAUDE.md, sharing a helper is not
sharing its result). It covered 3 to 12 sides, member counts from 1 to 24, draws from −50 to 50
and three rotations, 9,240 cases at radius 30, and every cell resolved. The worst distance from
the true perimeter point was 0.052 percent units for every side count that divides 360, the sine
macro's own cost, and 0.28 for 7 and 11 sides, whose midpoint bearings fall between whole
degrees. The error scales with the radius. An unjittered perimeter member's polar form pays up to
0.440 (Sec.4.5). A first form interpolated between the side's two corners, which took two macros
and cost 0.31 at 8 sides, whose corners sit on half degrees, so the midpoint form replaced it.

Three consequences.

- A jittered perimeter member's `X` and `Y` come from the walk in every branch, at a zero draw
  too, and it needs no `RAD` cell. Turning jitter on moves each land by the difference between
  the two approximations, under half a percent unit at radius 30, toward the true perimeter.
- The member's `DEGREES` stays its even bearing from the polar form, since the walk computes no
  bearing. A radial child chained to a jittered member takes its origin from the walked position
  and its angle base from the even bearing.
- A large enough amount walks a land past its neighbour's even position and round any number of
  corners (5.5).

**Rev 1 said no runtime form existed, and nobody ran that argument.** It reasoned from
`perimeterPolar`, whose bearing needs an arctangent, and never asked whether a cartesian walk
needed one. It does not. Rev 1 slid a land along the extended straight side instead, and asked
in its section 10 how a corner land should slide. The owner's answer, follow the perimeter, is
what sent rev 2 looking. Rev 1's slide, its `TAN` and `SLIDE` cells and its corner figures are
withdrawn.

### 5.5 The amount, set by the scripter

On Arc, Line and the perimeter kinds the scripter types the jitter amount, a whole number of at
least 1, since the guide requires `rnd`'s max to exceed its min. There is no minimum separation
input and no computed bound (decision 5). The amount is the separation choice.

The help text states the one rule worth knowing. With the percent unit, two neighbours close by
at most twice the amount as a share of their even gap, so an amount under 50 never lets two
neighbours meet at any count, since the percent is a share of each count's own gap. On the
perimeter that holds along the walk, which rev 2 makes exact. With degrees on an arc the even gap
is smallest at 8 players, `sweep / (8L - 1)`, and the help text gives that formula. Nothing caps
the amount. Past 50 lands can pass each other, and an arc's or a line's end lands can move past
its nominal ends, which is the scripter's call.

Circle keeps its helper and its Add jitter button as built.

## 6. The panel

- One land per player is enabled on every kind, and the Shape select offers every kind whether
  or not it is ticked. The interim guard of section 2 goes, one kind per slice.
- The jitter controls show on every per player shape. The unit toggle shows for Circle and Arc
  only. On Arc, Line and the perimeter kinds the controls are an amount field and the unit, with
  no minimum separation field and no computed bound (5.5). Circle's are unchanged.
- The per count angle list (slice C of the per player feature) is hidden on a perimeter kind,
  since a bearing alone does not pick a point on a perimeter, the reason `PatternSlot.theta`'s
  own doc comment gives for ignoring a slot angle there. A land that already holds an override
  still shows the list, with its add row removed, so the override can be removed (decision 9).
- A drag on a per player member already declines on every kind, since its angle is forced to
  decline (`isPerPlayerMember`). The decline reason also names Radius on a kind in the `RAD` rows.
- The `landPlacement.perPlayer`, `landPlacement.shapeKind` and jitter help entries are rewritten
  as each slice lifts its part of the restriction.

## 7. What does not change

- The `AT_LEAST` guards, their propagation down a chain, and chain templates. None of them reads
  the kind.
- `ZonePolicy.perRepeat` and `assign`, which read the repeat index alone.
- `shapeGroupLandTotal`'s "up to 8".
- Sec.10.1's acceptance gate. Bulls_Eyes has no groups.
- Per player Circle output, byte for byte, apart from the one case in 4.2.

## 8. Cost

Across the eight branches a shape with L slots has `L × (1 + 2 + … + 8) = 36L` member
instances. A per player Circle pays one `DEG` line for each today. A Line or a perimeter kind
adds one `RAD` line each, `36L` more. A jittered perimeter member drops its `RAD` cell, adds one
`WALK` per instance (`36L`), and in the body adds `SIDE`, `K`, `F`, `A`, one trig macro, `U`, `VS`
and `VC`, about 17 lines per member (`17 × 8L`), with its `X` and `Y` rewritten rather than
added. For one slot a jittered per player square would carry about 170 lines more than a
jittered per player circle, and an unjittered one about 36 more. These are estimates from the
cell counts above, and slice C measures the real figure.

**Measured by slice C, 2026-09-29.** For one slot, an unjittered per player square emits exactly
36 `#const` lines more than an unjittered per player circle, and a jittered one exactly 172 more
than a jittered circle, `36 + 17 × 8`. The estimate held because the walked member keeps its
even bearing's DEGREES cell and that cell's trig macro, which a radial child builds on, and only
its X and Y are rewritten. `perPlayerAnyKind.test.ts` pins both figures. The same session swept
the walk through the preview's `instantiateScript` over 3 to 12 sides, one to three slots,
counts 2 to 8, three rotations and draws from −50 to 50, 69,300 cases, and every cell resolved.
The worst distance from the true perimeter point at radius 30 was 0.052 for every side count
that divides 360 and 0.273 for 7 and 11 sides, matching 5.4's figures.

## 9. Slice plan

Each slice is shippable and widens `perPlayerSupportsKind` to the kinds it builds.

**Slice A, the core and Arc. Built 2026-09-28.** Its tests are
`__tests__/perPlayerAnyKind.test.ts`, which slices B and C extend. Per player Circle output was
diffed byte for byte before and after over ten models at five counts, and matched. One reading
was needed while building it. "In every kind the jitter term is left out of a branch whose span
is 0" (5.1) was read as the new kinds only, since section 7 keeps per player Circle output
byte for byte and a ring's divisor is `N`, never 0.

`memberOffset` extracted from `expandShapeGroup`, the prologue
asking it per count, `evenAngleOffsetDegrees` deleted, rule detection against the expander (4.2).
Arc joins the supported kinds, with both jitter units (5.2) and a typed amount (5.5).

- Acceptance. Sec.10.1 byte identical. Every existing prologue and group jitter test unchanged
  in output, with the one 4.2 case pinned by its own test. A per player arc at counts 1, 2, 3
  and 8 puts its members at `rotation + round(sweep × m / span_k)`. A jittered arc's percent form
  emits as one line per member per branch.
- Hazard. Unifying Circle's arithmetic with a linear index. Slice A of the shape kinds warned
  the two forms round differently at an exact half degree. `memberOffset` keeps Circle's own
  two term expression, so this slice moves the call and changes no arithmetic.

**Slice B, radius cells and Line. Built 2026-09-28**, the same day as slice A, with decisions 7
and 8 in section 3 asked of the owner while building it. Per player Circle output was diffed
byte for byte again and matched. The drag decline became a list of forced labels
(`applyDrag`'s `perPlayerForced`), so a line member's decline names Radius and Angle. One
finding worth keeping: the cross check cannot show a missing `RAD` cell in its output, since a
frame cell reading an unresolved name is undefined in both evaluators and the two agree. A
test pins the field's own contract instead, and it is the only one that fails when the `RAD`
cells are left out of `crossCheckDegCells`.

`RAD` allocation, the `r` substitution in `emitModel.ts`,
`RAD` in the live and cross check cells, per quantity rule detection for `r`, the `jitterUnit`
refusal, line jitter (5.3) with a typed amount.

- Acceptance. A per player line at counts 1, 2, 3 and 8 runs from `-B` to `+B` with even steps.
  A line member with an authored radius keeps it at every count. A jittered line member emits
  its `RAD` cell as one line when `B` is a leaf. `deg` jitter on a line fails emission with the
  new problem.

**Slice C, the perimeter kinds. Built 2026-09-29.** Per player output for every kind it did not
touch (Circle, Arc, Line and the fixed count perimeter shapes) was diffed byte for byte before
and after over twelve models at four counts, and matched. Decision 9 in section 3 was asked of
the owner while building it. One reading was needed. Jitter applies to the default position only
(section 5), and the walk moves both quantities, so a member with a rule on either quantity, or
a `nudged` one, keeps its polar cells and takes no walk. Decision 8 gives that reading for a
line, where only a rule on the quantity the jitter moves takes it away. The draw's lower bound
is the jitter param's `min`, which `emitAlpModel` hands the prologue. The mutation tests set `L`
to 0 (the hazard test then put member 0 18 units off, on the wrong side), removed the rule
check, removed the per count check, and dropped the half degree from `A` (the heptagon's walk
then missed by more than 0.28). Each one failed a test, and each file was restored from a byte
copy.

`RAD` and `DEG` together, the runtime walk (5.4) with a typed
amount, the per count angle list hidden, and `perPlayerSupportsKind` deleted with its three
guards.

- Acceptance. A per player square at counts 1, 4 and 8 matches `perimeterPolar` at `N_k`. A
  jittered member, evaluated through `instantiateScript`, lands on the true perimeter within 5.4's
  figure at draws that cross no corner, one corner and two. A zero draw lands at the even
  position within the same figure. A negative `perimeterShift` and the draw's lower bound both
  stay on the right side. The fence size is measured and recorded here.
- Hazard. The lap count `L`. Set it to 0 and a negative draw at member 0 walks backwards past
  zero, the truncating `%` rounds toward zero, and the land jumps to the wrong side. Mutate it
  and watch that test fail.

Every slice ends with a `npm run tauri dev` run sheet section. Build a per player shape of that
slice's kind, change the previewed player count, and confirm the canvas re-spaces. Apply, then
run the map in game at 3 and 8 players.

## 10. Resolved

1. ~~How a corner member slides.~~ **Along the perimeter, turning the corner** (owner, rev 2).
   Rev 1 offered sliding along the side the walk puts it on, or along the average of its two
   sides' directions, and the owner took neither. 5.4 shows the engine can walk the perimeter.
2. ~~The minimum separation unit on a line or a perimeter.~~ **None** (owner, rev 2). The
   scripter's jitter amount already decides how close neighbours can come, so no minimum
   separation input is built for the new kinds. Rev 1's map percent recommendation and a tile
   unit were both dropped.

## 11. Related wants, recorded not designed

The owner also asked for a **Custom** shape kind, whose member positions come from a formula the
user types with the maths this tool already emits. It is recorded in Sec.4.5 of the design doc.
It touches this file in one place. If a Custom formula reads the member index and the member
count as its only per member inputs, section 4's core gives it per player placement with no
further design, since the prologue would ask the expander for its positions at each count like
any other kind.

**Using only part of a shape** (rev 2). A field like Arc's Sweep on Line, Square, Triangle and
Polygon, saying what percent of the shape the lands spread over, so 50 percent of a square gives
its top half at the right rotation. Recorded in Sec.4.5 of the design doc. As a plain number
the expander consumes, like `sweep`, it would re-space per player under section 4 with no further
design. Its own questions are where the used part starts, and whether 100 percent closes the
shape (a circle's divisor `N`) or stacks its two end lands (an arc's `N - 1`, which Sec.4.5 chose
for a 360 sweep).
