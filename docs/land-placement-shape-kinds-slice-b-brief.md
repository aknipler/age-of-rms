# Land Placement, shape kinds slice B brief: the cartesian machinery and `square`

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-shape-kinds-escalation.md` §3(a), §3(b) and §6. Read this file for _what to
build and in what order_; read the escalation for _why_, and treat the escalation and
`docs/land-placement-design.md` as authoritative wherever they and this file disagree.

**Slice A (`line` and `arc`) must be built before this one.** B is where a group member stops being
polar, and three separate pieces have to be in place before the first perimeter kind can ship safely.
`reExpand.ts` needs a cartesian delta branch or a repeat count edit silently detaches every member
of a square. `dragMath.ts` needs the absorb path, because the same question ("how much may the tool
reinterpret a symbolic offset") is being answered for a second offset kind. Only then does `square`
have somewhere safe to land. `triangle` and `polygon` are the same function called twice more and
they are slice C, deliberately, so this session ends with one perimeter kind that works rather than
three that share an untested implementation.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules and Teaching mode.
2. `docs/land-placement-shape-kinds-escalation.md` **§3(a) from "square is decided to walk the
   perimeter" onward, §3(b), §6 and §7**. §6 is a specification of item 2, near enough line by line.
3. `docs/land-placement-design.md` **Sec.4.5** (the merge rule, and slice A's own kinds write up),
   **Sec.5.1**, **Sec.5.3**, **Sec.7.3**.
4. `src/tools/builtin/landPlacement/reExpand.ts` in full, including its header. Item 1 adds a branch
   next to one that already exists and must read as its twin.
5. `src/tools/builtin/landPlacement/frame.ts`'s header, **points 1 and 2**. They are why a perimeter
   kind cannot carry a symbolic rotation, which is item 4's refusal.
6. `src/tools/builtin/landPlacement/panel/dragMath.ts` in full, especially the block comment above
   `symbolicComponents`, which says in so many words that absorbing is a real option recorded in the
   escalation rather than taken there. Item 2 is that recorded decision arriving.

## 1. What to build, in order

### Item 1: `reExpand`'s cartesian delta branch

Today the merge rule reads:

```ts
if (oldPlacement.offset.kind !== "polar" || freshPlacement.offset.kind !== "polar") -> positionDetached
```

Restructure to three outcomes, not two. Both polar keeps the branch that exists. Both cartesian gets
the identical treatment componentwise, `dx` against `dx` and `dy` against `dy`, through the same
`deltaComponent` helper and behind the same `isFullyNumericLiteral` guard. A MIXED pair stays
`positionDetached`.

That third case is not a leftover, it is the honest answer to a real user action: a nudged member
whose group changes from Circle to Square has a nudge measured in `(r, theta)` and no meaningful
reading of it in `(dx, dy)`. Leaving the placement untouched and reporting it is exactly what
`positionDetachedIds` is for. Pin it with its own test so the next reader knows it was chosen.

`deltaComponent`, `freshId`, the released and deleted paths and the report shape all stay as they
are. This item adds a branch, nothing else.

### Item 2: `dragMath`'s absorb path

The escalation's §6 gives the mechanism. Two things it leaves to the keyboard, pinned here.

**The new parameter, self checking rather than positional.**

```ts
export type ResolvedOffsetComponents =
  | { kind: "polar"; r: number; theta: number }
  | { kind: "cartesian"; dx: number; dy: number };
```

`applyDrag` takes one optional value of that type and ignores it when its `kind` does not match the
placement's own offset. Omitting it means "no resolved values available", and the behaviour then is
today's, a decline. That default is what keeps every existing call site and every existing test
correct while the new path is built.

Both call sites can supply it, and both should. `LandPlacementCanvas.tsx`'s `handlePlacementDrag`
already holds `emission`; `canvasInteraction.ts`'s `computeRimDragReparent` does too. Rim drag gets
a real behaviour change out of it and it is the nicer of the two to demonstrate: re-parenting a
member of a symbolically rotated ring currently declines outright, and afterwards it keeps the
rotation reference and adjusts the constant so the land does not move.

**Order matters inside the function.** Check `isPerPlayerMember` BEFORE attempting to absorb, never
after. Absorbing a delta into a value the emission replaces wholesale would report success and change
nothing on the map, which the escalation calls out as worse than declining.

Keep `tryInvertFormulaOffset`'s all or nothing rule. If `r` absorbs and `theta` cannot, the whole
drag declines with the reason naming the component that failed.

Worth stating in the code, because it is the reason only `sym ± num` qualifies: absorbing into the
constant term is correct at every draw of a `rnd`, since the drag changes an offset from the
reference rather than the reference itself. A shape that needed the symbol's own value to be known
would be correct only for the seed that happened to be showing.

### Item 3: `perimeterOffset`, the shared geometry

One pure function, no model types, its own test file.

```ts
/** Coefficients to multiply the group's radius Expr by, giving a member's cartesian offset from the anchor. */
export interface PerimeterCoefficients {
  cx: number;
  cy: number;
}

export function perimeterOffset(
  sides: number,
  memberCount: number,
  memberIndex: number,
  rotationDegrees: number,
): PerimeterCoefficients;
```

```
M = sides, N = memberCount, m = memberIndex
delta = m / N + 1 / (2M)                 fraction of the way round the perimeter
k     = floor(delta * M) mod M           which side
f     = (delta * M) mod 1                how far along that side
u     = (f - 0.5) * 2 * sin(pi / M)      signed distance from the side's midpoint, in units of R
apo   = cos(pi / M)                      the apothem, in units of R
phi   = (rotationDegrees + k * 360 / M) in radians
cx    = apo * cos(phi) - u * sin(phi)
cy    = apo * sin(phi) + u * cos(phi)
```

**Two conventions this pins, because the escalation left them ambiguous.**

1. **Rotation rotates the whole shape, once.** It enters through `phi` only. The escalation's §3(a)
   writes rotation into `phi_k` AND into a `phase` term inside `delta`, which would spin the polygon
   and slide the members along its perimeter at the same time, so a 90 degree rotation of a square
   would not be a rotation of the picture. Drop the `phase` term. Rotation then means for a perimeter
   kind exactly what it already means for a circle, a line and an arc, which is also what the gizmo's
   rotation handle does.
2. **The walk starts at the midpoint of side 0**, which is the `1 / (2M)` in `delta`. So member 0
   sits on the rotation ray, matching every other kind, and a square at rotation 0 has flat sides
   facing the axes rather than sitting on a corner. Starting at a vertex instead is defensible and
   looks wrong at rotation 0, which is reason enough.

**Round `cx` and `cy` to 6 decimal places** before they reach an `Expr`. The tool bakes them, so both
sides of `verifyEmission`'s comparison see the same rounded number and nothing disagrees; the only
question is the emitted line. At the largest map the app offers (480 tiles, from `language.json`'s
own `dimensions`) a millionth of a percent is five thousandths of a tile, far under the lattice the
position is rounded onto anyway. Slice A's integer ratio trick does not reach here, a cosine is not
a ratio of small integers, so this is the first place in the tool where a decimal literal is emitted
on purpose.

Check the emitted shape by hand once. `frame.ts`'s cartesian branch builds `X = dx + anchorX`, so a
square member's X cell is `ALP_RADIUS * 0.707107 + ALP_X_parent`, one `#const` per coordinate under
Sec.5.3's rule, no temps.

### Item 4: `square`, and the refusal a symbolic rotation earns

`expandShapeGroup`'s dispatch calls `perimeterOffset` with `M = 4` and builds
`{ kind: "cartesian", dx: mul(base, num(cx)), dy: mul(base, num(cy)) }`, where `base` is
`slot.radius ?? group.radius` exactly as the polar kinds use it.

**A symbolic radius keeps working and a symbolic rotation does not.** The radius is multiplied by a
baked scalar, so it can be any `Expr` at all. The rotation is consumed by `Math.cos`/`Math.sin` while
the coefficients are computed, so it has to be a number. `frame.ts`'s own header point 1 is why there
is no way around this from the cartesian side: a cartesian offset is added to the anchor and never
rotated.

So `expandShapeGroup` uses `evalClosed(group.rotation) ?? 0`, and the EMITTER refuses the model, the
same two place pattern slice A used for per player over a non circle kind. The group still draws (at
rotation 0, which is honest, it is what the model would mean if the rotation resolved to nothing) and
Apply is blocked with a stated reason rather than writing a map whose rotation does nothing.

Record the alternative as a want rather than building it: the escalation names a `formula` offset
carrying the rotation as explicit SIN/COS, which is fully expressible with the compiler as it stands
and is a slice of its own.

`PatternSlot.theta` has no meaning for a perimeter kind, since the member's position is not an angle
from the anchor. Say so in that field's own doc comment rather than leaving a field that reads as
though it applies everywhere.

### Item 5: the panel

- Square joins the kind select from slice A. Nothing else in the group editor changes; radius already
  reads as the circumradius, which is what `model.ts` has said since slice 1.
- Slice A's "this kind draws as a circle until its own slice lands" note narrows to `triangle` and
  `polygon`. Do not delete it, slice C does that.
- The per player checkbox is already disabled outside Circle from slice A's item 5, so a per player
  square needs no new work.

### Item 6: docs

Sec.4.5 gains the perimeter walk, the two conventions from item 3, the symbolic rotation limit and
its reason. The escalation's §5 build order marks steps 2 and 3 done, and §3(a)'s `phase` sentence is
corrected in place the way slice A corrected its sweep sentence.

## 2. Acceptance

- **Sec.10.1's acceptance gate stays byte identical.**
- A square of 4 members puts one on the middle of each side. A square of 8 alternates side midpoint
  and corner, and the corner members sit at exactly the radius while the midpoint members sit at the
  apothem. This is the mid edge requirement that settled the escalation's own vertex versus perimeter
  fork, so pin it directly rather than through a bounding box.
- A square at rotation 90 is the same set of points as at rotation 0, rotated. Assert against the
  rotated coordinates, which is what catches a `phase` term sneaking back in.
- Every member's X and Y emit as one `#const` each.
- A repeat count edit on a square with one nudged member keeps that member on the delta branch and
  recomputes the rest. Without item 1 this test reports `positionDetached` for every member, which is
  the silent corruption the escalation warned about, so write it before item 4 if you can.
- A Circle to Square change on a nudged member reports `positionDetached` and leaves the placement
  untouched.
- Absorb: a symbolic `r` with an invertible shape, a symbolic `theta` with one, both at once, one
  invertible and one not (declines), a bare `sym` (declines), and a per player member with a
  perfectly invertible symbolic theta that declines anyway.
- Rim drag re-parenting a member of a symbolically rotated ring keeps the reference and does not move
  the land.
- A `perPlayer` square, and a square with a symbolic rotation, both fail emission with a problem.

## 3. Hazards

1. **`floor(delta * M)` reaching `M`.** `delta` can land on exactly 1 for the last member of some
   counts, and a side index of `M` is off the end of the shape. Take it mod `M`, and pin a member
   count that reaches it (`M = 4`, `N = 8`, the last member) rather than trusting the guard.
2. **Rotation counted twice.** Item 3 convention 1, straight out of the escalation's own text.
3. **Shipping `square` before item 1.** The failure is silent and only shows up on the first repeat
   count edit, which is the second thing a user does with a new shape.
4. **An absorb test that passes with the guard removed.** The escalation's §7 names this specifically
   and CLAUDE.md's own rule covers it. Mutate the `isPerPlayerMember` check, the all or nothing
   rule, and the delta subtraction's operand order. Restore from a byte copy.
5. **Checking `isPerPlayerMember` after the absorb attempt.** It reads as an equivalent refactor and
   it is not; it reports a successful drag that changes nothing.
6. **Baking a rotation to 0 without saying so.** Item 4. Drawing something reasonable is fine only
   because Apply refuses and says why.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, and full `npm test`. Re-measure the
suite counts rather than quoting slice A's, and update CLAUDE.md's test count row if a file lands.

Run sheet for `npm run tauri dev`: create a ring, switch it to Square, confirm four members sit on
the sides rather than the corners, raise repeats to 8 and confirm the corners fill in, drag one
member and then change repeats again to confirm the nudge survives, type a formula into Rotation and
confirm Apply refuses with a readable reason, then drag a member of a ring whose rotation is a random
parameter and confirm the drag now lands instead of declining.

Append a `docs/build-log.md` entry, and follow the house language rules in CLAUDE.md for every
comment and user facing string.

## 5. What slice C holds

`triangle` (`M = 3`), `polygon` (`M = group.sides`), the `sides` field and its control, and what is
left of slice 5's per vertex handles, which is a line's second end handle and an arc's sweep handle.
See `docs/land-placement-shape-kinds-slice-c-brief.md`.
