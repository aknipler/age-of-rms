# Land Placement, shape kinds slice A brief: the two polar shapes

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-shape-kinds-escalation.md`, closed 2026-09-03 and marked ready for exactly
this brief. Read this file for _what to build and in what order_; read the escalation for _why_,
and treat the escalation and `docs/land-placement-design.md` as authoritative wherever they and
this file disagree.

**Slice A builds `line` and `arc`, the two kinds that ride the existing polar model unchanged.**
Both keep every member's offset `polar`, so `reExpand.ts`'s merge rule, `dragMath.ts`, `snapping.ts`,
`canvasInteraction.ts` and `gizmoGeometry.ts` all keep working with no edit at all. That is the whole
reason the escalation's §5 puts them first. The perimeter kinds (`square`, `triangle`, `polygon`)
need a cartesian offset, a second `reExpand` branch and the drag absorb path before any of them is
safe to ship, and they are slice B. Do not start them here. Section 5 below says what B and C hold,
so this slice can be scoped short of them without losing the plan.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules and Teaching mode.
2. `docs/land-placement-shape-kinds-escalation.md`, **§3(a)'s `line` and `arc` paragraphs, §5 and
   §7**. §3(b) and §6 are slice B's work; read them once for context and then leave them alone.
3. `docs/land-placement-design.md` **Sec.4.5** (the group model and the merge rule), **Sec.5.1**
   (strict left to right, no precedence, `+ - * /` do not round, floats flow through), **Sec.5.3**
   (the emit rule, and the note that negative literals ride inline as operands), **Sec.5.4** (why an
   angle reaching the trig macro has to be an integer) and **Sec.7.3**.
4. `src/tools/builtin/landPlacement/expand.ts` with its test. This slice is mostly about that one
   function.
5. `docs/land-placement-per-player-escalation.md` **Sec.8.2**, then `prologue.ts`. Item 5 exists
   because of what those two say together, and it is the one hazard in this slice that produces a
   wrong map rather than a compile error.

## 1. What to build, in order

### Item 1: `ShapeGroup.sweep`, and why it is a plain number

```ts
export interface ShapeGroup {
  ...
  /**
   * Angular span for `kind: "arc"` ONLY, degrees, default 180. Ignored by
   * every other kind. A plain number rather than an `Expr` because it is
   * consumed at EXPANSION time to bake one integer degree literal per member
   * (Sec.5.4), the same way `repeats` is consumed to decide how many members
   * exist. A symbolic sweep could not be rounded to whole degrees before the
   * trig macro sees it, which is the property Sec.5.4 requires.
   */
  sweep?: number;
}
```

Optional, so every group already in a document keeps parsing unchanged. Nothing else in the model
changes this slice. `sides` (the escalation's other pinned field) belongs to slice B with the kind
that needs it.

### Item 2: kind dispatch in `expandShapeGroup`

Today the function reads `pattern`, `repeats`, `radius` and `rotation`, and never reads `kind`. Give
it a switch, and keep every kind on the same two lines it already produces:

```
theta = rotation + offsetTerm      offsetTerm defaults per kind, or slot.theta overrides it
r     = per kind                   slot.radius overrides the group radius, as it does today
```

So a kind decides two defaults and nothing else. That is worth stating in the file header, because it
is what keeps `frame.ts`, `reExpand.ts` and every panel module out of this slice entirely.

**Do not rewrite `circle`'s own arithmetic.** `angleOffsetDegrees` is algebraically `360 * m / N`
for the linear member index `m = i * pattern.length + j`, and it is tempting to unify all three
kinds on that one fraction. Leave it alone. The two forms can round differently at an exact half
degree because they associate their floats differently, and Sec.10.1's acceptance gate is a byte
comparison. Compute the linear index for the new kinds and let circle keep the expression it has.

**`square`, `triangle` and `polygon` keep falling through to the circle path this slice**, with a
comment naming slice B and the escalation section that specifies them. Do not throw. Nothing in the
panel can create one, so the only way to hold one is a hand edited `@alp-model`, and turning that
into a crashed panel breaks CLAUDE.md's "never crash, never vanish" for no gain. Item 6 makes the
fallback visible rather than silent.

### Item 3: `line`

The dual of a circle in the same polar representation. A circle holds `r` and varies `theta`; a line
holds `theta` and varies `r`, signed, so the members run from one end through the anchor to the other.

`radius` is the half length, which is the escalation's own "reuse `radius`, avoid a new field"
option. Take it, and take it for a second reason the escalation does not give: the radius gizmo
handle sits at `(radius, rotation)`, which for a line is exactly the far end member, so the existing
handle drags the line's length with no change to `gizmoGeometry.ts`.

```ts
// N = pattern.length * repeats, m = i * pattern.length + j, span = N - 1
const base: Expr = slot.radius ?? group.radius;
const r: Expr =
  span === 0 ? num(0) : divE(mul(base, num(2 * m - span)), num(span));
const theta: Expr = add(group.rotation, slot.theta ?? num(0));
```

**Emit the position as an integer ratio, never as a baked decimal.** `2m - span` and `span` are both
integers, so a member at one third of the way along emits `RADIUS * -1 / 3`, not `RADIUS *
-0.3333333333333333`. Both are legal (Sec.5.1: floats flow through), and the ratio is the one that
reads like the corpus. It also stays exact under a symbolic radius, which the decimal form only
approximates.

Check the emitted shape once, by hand, before writing the test that pins it. `frame.ts` builds
`X = r * COS + anchorX`, so a line member's X cell is `RADIUS * -3 / 7 * ALP_COS_x + 50`. Walk its
left spine: every right operand is a leaf, so Sec.5.3's rule emits the whole thing as ONE `#const`,
no temps. With a literal radius, `normalizeExpr`'s integer fold collapses `30 * -3` to `-90` first.

`span === 0` is the one member case, and it sits at the anchor rather than at either end. Say so in
a comment; a reader's first guess is that a one member line degenerates to the radius, not to zero.

### Item 4: `arc`

Circle's formula with the full turn replaced by `sweep`, and the divisor `N` replaced by `N - 1`,
because an arc occupies both of its ends while a ring's last member deliberately stops short of its
first.

```ts
const step = N === 1 ? 0 : Math.round(((group.sweep ?? 180) * m) / (N - 1));
const theta: Expr = add(group.rotation, slot.theta ?? num(step));
const r: Expr = slot.radius ?? group.radius;
```

`Math.round`, once, at expansion time, for the reason `angleOffsetDegrees` already documents at
length (Sec.5.4 point 2, and rounding beats the engine's own truncation by half a degree).

**Correct the escalation doc in passing.** §3(a) says a `sweep` of 360 "degenerates to today's circle
exactly". It does not. Dividing by `N - 1` at a 360 sweep puts the last member on top of the first,
which is precisely the collision the `N` divisor exists to avoid. Amend that sentence in place, the
way slice 4b amended the design doc, and record the real behaviour in `sweep`'s own doc comment: a
360 sweep is legal and stacks the two end members. Default 180 rather than 360 for the same reason.

### Item 5: per player is a circle only setting, refused in two places

This is the item that stops a silently wrong map, so build it before the panel work rather than after.

`prologue.ts` computes every per player angle from `evenAngleOffsetDegrees`, which is the ring
formula and only the ring formula, and `emitModel.ts` substitutes that angle over any member whose
offset is `polar`. A line and an arc are both polar. So a `perPlayer` line would emit ring angles
over its members, and produce a shape that is neither a line nor an error.

Refuse it, twice:

- **In the emitter.** Before the prologue is built, fail the emission for any `perPlayer` group whose
  `kind` is not `circle`. Follow `paramProblems`' own precedent for the shape of the refusal, a
  `VerifyProblem` carrying the where string in `name` and `undefined` for both values. The panel
  already renders emission problems in the Generated Code section, so this needs no new surface.
- **In the panel.** Disable the "One land per player" checkbox unless the kind is `circle`, with a
  `title` saying that per player angles are computed for a ring. Match the wording style of the
  Repeats field's own disabled title, which already explains itself the same way.

**Do not generalise the prologue to cover an arc this slice.** A per player arc is a real want and a
genuine design question (how a sweep divides across a runtime count, and whether `thetaPerCount` is
still the right override surface), and CLAUDE.md's rule is to escalate a silent spec rather than
improvise. Record it as a named future want in the escalation doc's §7 and leave it.

### Item 6: the panel's kind control

- A `<select>` on `GroupEditor` offering Circle, Line and Arc, wrapped in `HelpTip` with a new
  `landPlacement.shapeKind` entry in `reference/data/ui-help.json`, per CLAUDE.md's rule that every
  new interactive element gets one. Extend `helpCoverage.test.ts` the way the existing landPlacement
  ids already are.
- **A select, not one create button per shape.** Sec.7.3 says "shape buttons", and the escalation's
  own discoverability argument is about the kinds being NAMED rather than about the control being a
  button. Named options in a select satisfy it in a narrow panel, and they keep the existing "+ Ring"
  entry point unchanged, so `addRing` needs no new parameter and nothing about creation moves.
- **Route the kind change through `applyGroupEdit`**, which means widening its patch type to include
  `kind` and `sweep`. Every pattern and repeats edit already goes through `reExpand()` rather than a
  fresh `expandShapeGroup` (Sec.4.5's requirement), and a kind change is exactly the edit that rule
  is for. Circle, line and arc are all polar, so the existing delta branch handles a nudged member
  across a kind change with no new code.
- Kind aware labels. The section title reads Circle, Line or Arc rather than "Ring". The Radius field
  reads "Half length" for a line. The sweep input appears for an arc only, a plain number input with
  a 1 to 360 range, not a `FormulaField`, because item 1 made `sweep` a number.
- **Say what an unbuilt kind is doing.** If a hand edited model holds `square`, `triangle` or
  `polygon`, show the kind as read only text saying it draws as a circle until its own slice lands.
  One sentence. This is what turns item 2's fallback from silent into stated.
- `shapeGroupLandTotal` (`viewModel.ts`) needs no arithmetic change. Its count is
  `pattern.length * repeats` for every kind.

### Item 7: the write up the escalation has been asking for

Add the two kinds to `docs/land-placement-design.md` Sec.4.5, which owns `ShapeGroup` and has never
mentioned `kind` at all. Formulas, the `sweep` field, the per player restriction from item 5, and a
line saying the three perimeter kinds are specified in the escalation and not yet built. Then update
the escalation's §5 build order to mark step 1 done.

## 2. Acceptance

- **Sec.10.1's acceptance gate stays byte identical.** Bulls_Eyes has no groups at all, so this is a
  regression check on item 2's dispatch, not a feature check. If it moves, the circle path was
  rewritten and item 2 said not to.
- A line of N members is symmetric about its anchor, ends at `±radius`, and puts member 0 at
  `-radius`. Pinned at N = 1, 2, 3 and 8, and once with a symbolic radius, where the assertion is on
  the Expr shape rather than a number.
- A line member's X cell emits as exactly one `#const`. Assert the line count, not just the value;
  this is the claim item 3 asks you to check by hand first, and a test is how it stays true.
- An arc at sweep 180 with 5 members steps 45 degrees; at sweep 90 it steps 22 or 23 per member
  after rounding; at N = 1 every member sits at `rotation`.
- `reExpand` across a circle to line change keeps a nudged member on the delta branch and leaves the
  rest recomputed. One fixture, asserting the report rather than only the offsets.
- A `perPlayer` line fails emission with a problem, and a `perPlayer` circle still emits its prologue
  unchanged.
- Every new HelpTip id resolves, by the existing coverage test.

## 3. Hazards

1. **Per player over a non circle kind.** Item 5. It is the only failure in this slice that emits a
   plausible looking map rather than an error, and both of its halves are one line each.
2. **Unifying circle's angle arithmetic with the new kinds' linear index.** Item 2. Algebraically
   identical, not identical under float association, and the gate is a byte comparison.
3. **Baking a decimal where a ratio will do.** Item 3. `RADIUS * -1 / 3` stays exact under a symbolic
   radius and reads like the corpus; a 17 digit decimal does neither.
4. **Trusting the escalation's "sweep 360 is a circle" sentence.** Item 4. It is wrong, and it is the
   kind of wrong that produces two lands stacked on one tile.
5. **Editing `reExpand.ts`, `dragMath.ts` or `gizmoGeometry.ts`.** Every kind in this slice is polar,
   so all three already work. If one of them looks like it needs a change, the change belongs to
   slice B and the reason belongs in the escalation doc first.
6. **A mutation that survives.** The three numbers most worth mutating are the `N - 1` divisor in the
   arc step, the `2m - span` centring in the line, and the `span === 0` guard. Each of them returns a
   plausible looking number when wrong, which is the exact pattern slice C's jitter calculator hit.
   Mutate them, watch a test fail, and restore from a byte copy rather than by reverse substitution.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, and full `npm test`. Slice C
recorded 110 files and 2675 tests; re-measure rather than quoting that, and update CLAUDE.md's test
count row if a file lands.

**Nothing in this environment can render the panel**, so end the session with a written run sheet for
`npm run tauri dev`: create a ring, switch it to Line, confirm the canvas redraws as a line through
the anchor, drag the radius handle and confirm it changes the half length, switch to Arc, change the
sweep, confirm the per player checkbox is disabled outside Circle, then Apply and read the emitted
fence for the one line per member claim.

Append a `docs/build-log.md` entry, and follow the house language rules in CLAUDE.md for every
comment and user facing string.

## 5. What slices B and C hold, so this one can stop here

- **Slice B, the cartesian machinery and `square`.** `reExpand.ts`'s cartesian delta branch (§3(b))
  and `dragMath.ts`'s absorb path (§6) first, both before any perimeter kind ships, then
  `perimeterOffset(M, N, i, phase)` at `M = 4`. B also owns one decision this slice did not need: a
  perimeter coefficient is irrational, so it has to decide how many decimals a baked coefficient
  carries before it reaches the emitted line. Slice A's integer ratio trick does not generalise to a
  cosine.
- **Slice C, `triangle`, `polygon`, `sides`, and the handles.** Two more calls into B's own function,
  the `sides` field and its control, and then slice 5's original item 6. Note before starting it that
  most of item 6 has already dissolved: once a perimeter kind is a walk around a circumradius, its
  vertices are fully determined by radius and rotation, and the existing gizmo already edits both, so
  a per vertex handle would be a second way to set the same two numbers. What is left of item 6 is
  a line's two end handles and an arc's sweep handle, and A's own choice to make the radius handle
  land on a line's far end has already built half of that.
