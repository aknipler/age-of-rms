# Land Placement, perimeter slice A brief: the polar unification and a symbolic rotation

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-perimeter-symbolic-rotation-escalation.md` **Sec.8** (the design session's own
outcome; Sec.0-7 of that file are the question, Sec.8 is the answer and wins wherever they disagree).
Read this file for _what to build and in what order_; read the escalation for _why_, and treat the
escalation and `docs/land-placement-design.md` as authoritative wherever they and this file disagree.

**Nothing else needs building first.** This slice has no dependency on slice B — B depends on A, not
the other way round — and it touches no module the shape-kinds work left unfinished.

**What this slice actually is:** a representation change, not a feature. Every square, triangle and
polygon member stops being a `cartesian` offset and becomes an ordinary `polar` one, in exactly the
shape `circle` already produces. The feature the owner asked for (a rotation that can be a formula
and re-rolls per generation) then falls out with **no new machinery at all** — `frame.ts`,
`compiler/trig.ts` and `reExpand`'s polar branch are untouched, and a refusal gets deleted rather
than narrowed. Most of the work in this slice is therefore in the tests and the comments, not the
arithmetic, and that split is the point: get the four lines of geometry right and then go and correct
every place in the tree that currently states the opposite.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules and Teaching mode.
2. `docs/land-placement-perimeter-symbolic-rotation-escalation.md` **Sec.8 in full**, then Sec.2 and
   Sec.3 for the ground truth they collect. Sec.8.1 is the verification you do not have to repeat;
   Sec.8.2 is the accuracy you are deliberately spending.
3. `docs/land-placement-design.md` **Sec.4.5** (shape kinds and the merge rule), **Sec.5.4** (the
   trig macro and why a bearing is rounded at expansion time), **Sec.7.3**.
4. `src/tools/builtin/landPlacement/perimeterOffset.ts` in full, including both of its pinned
   conventions. You are rewriting this file, and convention 2 (member 0 sits on the rotation ray)
   must survive the rewrite unchanged.
5. `src/tools/builtin/landPlacement/expand.ts`'s header and its `circle` case. The perimeter cases
   are about to become that case with different constants, and the header's warning about not
   rewriting `circle` in terms of `m`/`n` applies to nothing you are doing — leave `circle` alone.
6. `src/tools/builtin/landPlacement/frame.ts`'s header, **points 1 and 2**. Point 1 is why this
   change is necessary; point 2 is the free capability it hands over (escalation Sec.8.4).

## 1. What to build, in order

### Item 1: `perimeterPolar`, replacing `perimeterOffset`

Rewrite `perimeterOffset.ts` around one function that **takes no rotation at all**:

```ts
export interface PerimeterPolar {
  /** Multiply the group's radius Expr by this. hypot(apothem, u): 1 on a vertex, cos(pi/M) at a side's midpoint. */
  radiusScale: number;
  /** Add to the group's rotation Expr. k*(360/M) + psi, WHOLE degrees. */
  bearingDegrees: number;
}

export function perimeterPolar(
  sides: number,
  memberCount: number,
  memberIndex: number,
): PerimeterPolar;
```

```
M = sides, N = memberCount, m = memberIndex
delta = m / N + 1 / (2M)                  fraction of the way round the perimeter
k     = floor(delta * M) mod M            which side          (keep the existing double-mod wrap)
f     = (delta * M) mod 1                 how far along it
u     = (f - 0.5) * 2 * sin(pi / M)       signed distance from the side's midpoint, in units of R
apo   = cos(pi / M)                       the apothem, in units of R
radiusScale   = round6(hypot(apo, u))
bearingDegrees = round(k * (360 / M) + atan2(u, apo) in degrees)
```

The first four lines are lifted verbatim from today's function; only the last two are new. Keep
`round6` and its existing doc comment for `radiusScale` — it is the same kind of quantity for the same
reason.

**`Math.round` on the bearing, and only on the bearing.** `bearingDegrees` becomes a DEGREES cell,
and the engine casts that to an int inside the trig macro's `%` (see `mathEval.ts`'s `applyOperator`
note, and Sec.5.4 point 2): rounding here costs at most 0.5 degrees where letting the engine truncate
costs 1.0. This is the identical decision `expand.ts`'s `angleOffsetDegrees` and `arcStepDegrees`
already made, and the new function's comment should say so by naming them. `radiusScale` is NOT
rounded to an integer — it is a scale factor, not an angle, and a decimal literal flows through the
compiler fine (Sec.5.1).

**Keep both pinned conventions and their comments**, updated only where the mechanism changed:

1. Rotation rotates the whole shape once — which is now enforced by construction, since this function
   cannot see the rotation at all. Say that; it is a stronger statement than the old comment's.
2. The walk starts at the midpoint of side 0, so member 0 sits on the rotation ray. Under the new
   form that reads as `bearingDegrees === 0` at `m === 0` for every `M` and `N`, which is a better
   test than the old one and belongs in the test file as its own case.

**Delete `perimeterOffset` and port its tests, deliberately.** After item 2 nothing calls it. Do not
leave it behind as dead code, and do not delete its test file: every case in
`__tests__/perimeterOffset.test.ts` still describes real geometry and must be re-expressed against
`perimeterPolar` (a member's expected `(cx, cy)` becomes an expected `(radiusScale, bearingDegrees)`
pair, or is checked by converting back with real trig — pick one and be consistent). `npm test` runs
a computed FLOOR on the test count; a net drop after this port is a signal that a case was lost, not
a reason to lower the floor.

### Item 2: `expand.ts` emits polar for all three kinds

```ts
function perimeterKindOffset(
  sides: number,
  base: Expr,
  group: ShapeGroup,
  m: number,
  n: number,
): { r: Expr; theta: Expr } {
  const { radiusScale, bearingDegrees } = perimeterPolar(sides, n, m);
  return {
    r: mul(base, num(radiusScale)),
    theta: add(group.rotation, num(bearingDegrees)),
  };
}
```

and the `square`/`triangle`/`polygon` cases each build `{ kind: "polar", r, theta }`. `evalClosed` is
no longer imported by this file unless something else still needs it — check before deleting the
import.

**Rotation must be the OUTER addend**, `add(group.rotation, num(bearingDegrees))`, exactly as
`circle` writes it, and for exactly the reason `circle`'s own comment gives: a symbolic rotation has
to keep steering every member. Write the perimeter case so a reader can see it is the same shape.

`clampSides` stays as it is. `slot.radius` stays the `base`, which is what makes a slot's radius
override scale the whole local vector (escalation Sec.8.5's radius rule) — no change, but it is now a
stated rule and item 5 owes it a test.

**Do not consult `slot.theta` for these kinds.** It stays unread here; slice B is what gives a
perimeter member a per-slot position, through a different field. Amend `model.ts`'s doc comment on
`slot.theta` so its REASON is current: it is not "these kinds are not angular" any more (they are), it
is "a perimeter member's bearing is derived from its position on the perimeter; use `perimeterShift`".

### Item 3: delete the rotation refusal

In `emitModel.ts`, remove the second `kindProblems` entry (the `isPerimeterKind(g.kind) &&
evalClosed(g.rotation) === undefined` filter), its comment, and the now-unused `isPerimeterKind`
helper. Check whether `evalClosed` is still used in the file before removing the import.

**Leave the `perPlayer` refusal exactly as it is**, and add to its comment the fact that it is now the
only guard. Escalation Sec.8.7 finding 2 is the reason and should be summarised in two sentences
there: `prologue.ts`'s `offset.kind !== "polar"` skip used to catch every perimeter member as a
second line of defence, and after this slice it catches none of them.

### Item 4: every place in the tree that states the opposite

This is not tidying. Each of these currently tells a reader something the code will no longer do, and
this project's own rule is that a comment restating a rule the code does not implement is worse than
no comment.

| Where                                                             | What it says now                                                                                 | What it must say                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `expand.ts`'s `perimeterKindOffset` comment                       | a symbolic rotation "does not" work, with `frame.ts` point 1 as the reason                       | rotation is an ordinary additive term on the member's bearing; the geometry never sees it                                                              |
| `emitModel.ts` (refusal b's comment)                              | deleted with the refusal                                                                         | —                                                                                                                                                      |
| `model.ts`, `ShapeGroup.sides` / `PatternSlot.theta` doc comments | perimeter members are cartesian; `slot.theta` is meaningless because these kinds are not angular | see item 2                                                                                                                                             |
| `reExpand.ts`'s cartesian branch comment                          | "a perimeter kind's own delta case"                                                              | the branch that serves a standalone user-authored `cartesian` placement — still reachable, no longer reached from group expansion (escalation Sec.8.6) |
| `panel/LandPlacementHelpDialog.tsx` (~line 98)                    | "A square, triangle or polygon member ... has no [DEGREES cell]"                                 | they have one now, so a chained child can use a radial frame                                                                                           |
| `reference/data/ui-help.json`, `landPlacement.shapeKind`          | "all three need a plain number in Rotation rather than a formula"                                | drop that clause; a formula works. Re-run `npm run validate:reference` after editing                                                                   |
| `panel/dragMath.ts`'s block comment above `symbolicComponents`    | fine as written                                                                                  | optionally note that a perimeter member now reaches the polar absorb path                                                                              |

### Item 5: tests

The rewritten `perimeterOffset.test.ts` (item 1) plus:

- **`expand.test.ts`**: the three `"produces a cartesian offset, not polar"` cases (square ~line 241,
  triangle ~line 332, and the polygon block) invert. Rewrite them, do not relax them — assert
  `"polar"`, and re-derive the numeric expectations rather than deleting them. The shared helper at
  ~line 31 that evaluates a member's cartesian offset becomes a polar one; the positions it produces
  should be checked against real trig, so the test still says where the member IS and not merely how
  it is spelled.
- **A symbolic rotation survives expansion**: a square with `rotation: sym("ROT")` expands to members
  whose `theta` is `bin("+", sym("ROT"), num(k))`, structurally — the same assertion `circle` already
  has, applied to all three kinds.
- **`emitModel.test.ts`**: the whole `"the perimeter kinds' symbolic-rotation refusal"` describe block
  (~line 549) inverts. It becomes the block that proves a symbolic rotation EMITS: the emission is
  `ok`, and the member's DEGREES cell references `ROT`. Keep the literal-rotation and
  closed-arithmetic cases green as they are — they were never about the refusal.
- **The `perPlayer` refusal still fires**, with a test title that says it is now the only guard
  (item 3).
- **The equivalence gate, the one new test that matters.** For a spread of `sides` in {3,4,5,6,7,12},
  `memberCount` in {3,5,7,8,12}, every member index, and literal rotations, assert that the emitted
  position of a member (its `r`/`theta` evaluated through `evalExpr`, macro included) is within
  **0.5 percent-units** of the position real trigonometry puts it at, for radii up to 45 percent.
  Measured worst case over that grid during the design session: **0.440**, at `M=7 N=5 m=4 R=45`
  (escalation Sec.8.2). Pin the tolerance with a comment naming that measurement, so a future
  regression that doubles the error goes red instead of hiding under a loose bound.
- **A child of a perimeter member composes radially** (escalation Sec.8.4 point 1): chain a `radial`
  polar child to a square member and assert its DEGREES cell references the parent's, which today it
  cannot. This is a real output change and it needs a test that names it.

### Item 6: docs

- `docs/land-placement-design.md` **Sec.4.5**: the write-up every prior slice has given it. State the
  representation (all six kinds are polar; there is no cartesian group member any more), the
  measured accuracy trade (Sec.8.2's table), and the two capabilities that came free.
- `docs/build-log.md`: the usual entry, including the equivalence gate's measured number.
- `docs/manual-test-run-sheet.md`: one step — a square with `rnd(0,359)` in Rotation, applied, and the
  emitted `#const` block read to confirm the rotation reaches the DEGREES cells. The run sheet is
  still owed from earlier slices; add to it, do not reorganise it.

## 2. Acceptance

- All six shape kinds produce `offset.kind === "polar"`; no group expansion produces a `cartesian`
  offset any more.
- A `square`, `triangle` or `polygon` group whose `rotation` is `sym(...)`, a `param`, or any
  non-closed Expr **emits**, and its members' DEGREES cells carry the reference.
- The equivalence gate above is green at its pinned tolerance, with the measured worst case recorded
  in the test's own comment.
- A `radial` child chained to a perimeter member composes off its parent's DEGREES cell.
- The `perPlayer`-on-a-non-circle refusal still fires, with its own test.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run validate:reference` all green, and the
  test count does not fall (item 1).
- The acceptance gate (`__tests__/acceptance.test.ts`, Bulls_Eyes) is untouched and still byte-exact —
  it contains no `ShapeGroup` at all, so if it moves, something is wrong beyond this slice.

## 3. Hazards

1. **Rounding the wrong quantity.** `bearingDegrees` is rounded to a whole degree; `radiusScale` is
   not. Rounding the scale to an integer would collapse every member onto the circumradius and turn a
   polygon into a circle — a plausible-looking wrong picture, which is this feature's own named
   failure mode.
2. **Losing the rotation ray convention.** If member 0's bearing offset is not exactly 0, every
   existing square silently spins by a fraction of a side. Test it directly rather than inferring it
   from a position check.
3. **Nudged perimeter members detach on the next re-expansion**, and that is the accepted outcome
   (escalation Sec.8.6): an old model's nudged member holds a `cartesian` offset, the fresh one is
   polar, and the merge's MIXED branch reports `positionDetached`. Do not "fix" this by converting
   the stored offset — write the test that pins the detach and its report instead.
4. **Deleting `evalClosed` imports too eagerly.** Both `expand.ts` and `emitModel.ts` may still use it
   elsewhere. Let the typechecker decide, not a search-and-delete.
5. **The `positionDetached` path is not the same as the recompute path.** A NON-nudged perimeter
   member recomputes wholesale and follows the group normally; only a nudged one detaches. If your
   test for hazard 3 does not set `nudged: true`, it is testing nothing.
6. **The panel gains an "Angle (deg)" field on perimeter members for free** — the field at
   `LandPlacementPanel.tsx` ~line 511 renders for any polar offset, in-group included. That is
   intended and honest under the new representation (it is a real bearing, and editing it nudges the
   member the same way a drag does), but check it renders and commits sanely rather than discovering
   it in the run sheet.

## 4. Verification

Beyond the suite: the equivalence gate IS the verification for the geometry, and it is written to
compare against real trigonometry rather than against the old implementation, so it stays meaningful
after `perimeterOffset` is gone. Do not verify the new code by asserting it agrees with a copy of the
old formula pasted into the test — that only proves the paste was faithful.

## 5. What slice B holds

`PatternSlot.perimeterShift` and its panel surface: a member's position along the perimeter, per
slot, as a signed percent of a lap (escalation Sec.8.5). It is a strictly additive change on top of
this slice — one term inside `delta`, one optional model field, one panel input — and it is a separate
session because this one already rewrites a geometry module, inverts three test blocks and deletes a
refusal.
