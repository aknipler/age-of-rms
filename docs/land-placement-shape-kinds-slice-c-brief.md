# Land Placement, shape kinds slice C brief: `triangle`, `polygon`, and the handles

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-shape-kinds-escalation.md` §3(a) and §5, plus `docs/land-placement-design.md`
Sec.7.3 for the handles. Read this file for _what to build and in what order_; read those for _why_,
and treat them as authoritative wherever they and this file disagree.

**Slice B must be built before this one, and C is the small one.** B's `perimeterOffset` is already
the general M sided case, so `triangle` and `polygon` are that function called with two more values
plus one model field and one panel control. The escalation says this in as many words: building any
one perimeter kind builds the machinery for all of them. What makes C worth its own session is the
other half, the handles that slice 5's item 6 was cut for, which are now small enough to finish.

**Read §1 item 3 before planning the session.** Most of slice 5's item 6 has dissolved rather than
been deferred, and the remainder is two handles, not a system.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules and Teaching mode.
2. `docs/land-placement-shape-kinds-escalation.md` **§3(a)'s general M sided paragraphs and the
   pinned `sides` field, and §5**.
3. `docs/land-placement-shape-kinds-slice-b-brief.md` **item 3**, which is the function you are
   calling and the two conventions it pinned.
4. `docs/land-placement-design.md` **Sec.7.3**, whose handle list this slice makes out of date and
   which item 5 corrects.
5. `src/tools/builtin/landPlacement/panel/gizmoGeometry.ts` in full, including its header's own
   reasoning about why it is a separate file from `dragMath.ts`. Items 3 and 4 add to it for the
   same reason and should read the same way.
6. `src/tools/builtin/landPlacement/panel/LandPlacementCanvas.tsx` from `RADIUS_HANDLE_ID` down
   through `onDrag`. Three separate places know about handle ids and all three need the new ones.

## 1. What to build, in order

### Item 1: `sides`, `triangle` and `polygon`

The field is pinned by the escalation and belongs on `ShapeGroup` verbatim, including the reason it
is not carried by `square` and `triangle`, which is that their side count is exactly what makes them
their own kinds and a `square` with `sides: 5` would be a model that disagrees with itself.

```ts
/**
 * Side count for `kind: "polygon"` ONLY, at least 3. `square` and `triangle`
 * hardcode 4 and 3 and carry no field of their own. Absent or ignored for
 * every other kind.
 */
sides?: number;
```

Both kinds are one line each in `expandShapeGroup`'s dispatch, `M = 3` for triangle and
`M = clampSides(group.sides)` for polygon. Clamp rather than refuse, `Math.max(3, Math.trunc(sides ??
6))`, with a comment saying why: a hand edited model with `sides: 2` has no polygon to draw, and a
floor keeps the panel drawing something while the input below stops the case arising in the first
place. This is the one place in the feature where clamping beats refusing, because the refusals in
slices A and B both protect an emitted map from being quietly wrong, and this one cannot reach the
map at all.

`applyGroupEdit`'s patch type gains `sides`, joining `kind` and `sweep` from slice A.

### Item 2: the panel

- Triangle and Polygon join the kind select. Delete slice A's "this kind draws as a circle until its
  own slice lands" note entirely, along with the read only kind display it lived on. Every value of
  `ShapeGroup.kind` is now real, which is the whole point of the feature.
- A Sides number input, shown for Polygon only, min 3 and max 12, wrapped in `HelpTip` with a new
  `landPlacement.shapeSides` entry in `reference/data/ui-help.json` and the coverage test extended.
  The maximum is a judgement rather than a limit of the maths: past a dozen sides a polygon and a
  circle are the same picture at map scale, and the circle kind gets there with less arithmetic. Say
  that in the help text rather than presenting 12 as a hard boundary.
- Changing `sides` keeps the member count and changes every coefficient, so it goes through
  `applyGroupEdit` like every other group edit and lands on slice B's cartesian delta branch for a
  nudged member. No new model plumbing.

### Item 3: what is left of slice 5's item 6

Slice 5 cut "per vertex handles for `square`/`triangle`/`polygon`/`line`/`arc`" because
`expandShapeGroup` ignored `kind` and there were no vertices to grab. The escalation answered the
geometry question, and the answer removed most of the item rather than unblocking it.

**A perimeter kind needs no vertex handles.** Its vertices are fully determined by the circumradius
and the rotation, both of which the existing gizmo already edits, so a vertex handle would be a
second control for two numbers that already have one. Dragging a vertex could only mean "set radius
and rotation together", which is what dragging the radius handle already does for the radius and the
rotation handle already does for the rotation. Build nothing for these three kinds, and record the
reasoning in the design doc so the question does not get reopened by the type alone.

**What is left is two handles, one per polar kind slice A introduced.**

- **A line's second end.** Slice A put `radius` on the half length so the existing radius handle
  lands on the far end member. The near end is the same point mirrored through the anchor, and
  grabbing either end of a line is the gesture people expect. Dragging it sets `radius` to the drop
  distance and `rotation` to the drop bearing plus 180, folded the way `dragMath.ts`'s `foldBearing`
  already folds. It patches both fields in ONE `applyGroupEdit` call, never two, or a nudged member's
  delta is measured against a half updated group.
- **An arc's sweep.** It sits at the last member, `(radius, rotation + sweep)`. Dragging it sets
  `sweep` only, to the drop bearing minus the rotation, wrapped into 1 to 360 rather than folded into
  the signed range, since a sweep is a span and never negative. Radius and rotation are untouched, so
  the arc pivots open and closed around its first member.

Both positions belong in `gizmoGeometry.ts` as **new small exported functions**, not as extra return
fields on `gizmoHandlePositions`. Its own header already gives the reason for that shape of choice,
and it keeps the existing function and its test untouched.

Both interpretations belong in `canvasInteraction.ts` as pure functions with their own tests, the way
`computeRimDragReparent` and the snap context builder already are. The canvas glue then stays glue,
which is what makes the run sheet a check on wiring rather than on arithmetic.

**Decline a symbolic field the same way the existing gizmo does.** The line end handle edits both
radius and rotation, so it declines if EITHER is symbolic, through `symbolicDeclineReason` with both
labels rather than a second phrasing. The sweep handle edits a plain number and can never hit this.

### Item 4: wiring the two handles into the canvas

Three places know about handle ids today and all three need the new ones. Handle them together, in
one pass, or the handle draws and refuses to respond.

1. The id constants next to `RADIUS_HANDLE_ID` and `ROTATION_HANDLE_ID`.
2. The `overlayShapes` memo, which appends the gizmo handles after `buildOverlayShapes`. The new ones
   are conditional on the selected group's kind, so this is where "a line has three handles and an
   arc has three" becomes true.
3. `gizmoHandleCircles`, which filters `overlayShapes` for the two ids it knows. A new id that misses
   this filter is a handle that draws and cannot be grabbed, which is the most likely way to lose an
   hour in this item.

Then the `onDrag` dispatcher gains its two branches, matching the shape of the two that are there.

Handles win over member circles in `hitTestDragStart`, which is already true and already matters: a
circle's own member 0 sits under the radius handle at rotation 0 today. The line's near end handle
sits exactly on member 0 by construction, so this is the first case where the overlap is guaranteed
rather than incidental. It is the correct precedence, grabbing an end of a line should resize the
line, and it is worth one line of comment where the ordering is decided.

### Item 5: docs, and closing the feature

- Sec.4.5 gains `triangle`, `polygon` and `sides`.
- **Sec.7.3's handle list is now wrong.** It says "a radius ring handle, a rotation handle, and a
  count stepper". Correct it in place to name the two new handles and the kinds they belong to.
- The escalation's §5 build order marks step 4 done, and §7 records that per vertex handles for the
  perimeter kinds were considered and are not needed, with item 3's reason. That paragraph is the
  one that stops the next reader re-raising the question from the type.
- `docs/land-placement-shape-kinds-escalation.md` can then say the whole file is implemented rather
  than decided. Leave the wants that were deliberately parked where they are, a per player arc from
  slice A and a `formula` backed symbolic rotation for the perimeter kinds from slice B, and check
  both are still stated plainly enough for someone to pick up.

## 2. Acceptance

- **Sec.10.1's acceptance gate stays byte identical.**
- A triangle of 3 members sits at the three side midpoints; of 6, it alternates midpoint and corner,
  with the corners at exactly the radius. Same assertion shape slice B used for the square, and if
  slice B's test was written as a helper this is two more calls into it.
- A polygon at `sides: 4` produces coordinates identical to a square with the same radius, rotation
  and member count. This is the test that pins the escalation's own claim that the three kinds are
  one implementation, and it is the cheapest regression guard the feature has.
- `sides: 2` and an absent `sides` both clamp to a drawable polygon rather than throwing.
- A `sides` change on a group with one nudged member keeps that member on the delta branch.
- Line end handle: dragging it to a point produces a group whose two ends are that point and its
  mirror, in one edit. Dragging it to where it already is changes nothing.
- Sweep handle: dragging round the arc gives a sweep in 1 to 360 at every bearing, including one drop
  that would fold negative if the signed range were used by mistake.
- Every new HelpTip id resolves.

## 3. Hazards

1. **A handle that draws and cannot be grabbed.** Item 4's third place, `gizmoHandleCircles`.
2. **Two edits where one belongs.** The line end handle patches radius and rotation together. Two
   `applyGroupEdit` calls re-expand twice and measure the second delta against a group that is half
   updated.
3. **Folding a sweep into the signed range.** `dragPolar` returns a bearing in the signed range,
   which is right for a bearing and wrong for a span. Wrap, do not fold, and pin the drop that lands
   just past 180.
4. **Reopening the vertex handle question from the type.** Item 3, and its paragraph in the design
   doc, exist to close it. If a vertex handle starts to look necessary, say what it would set that
   radius and rotation do not.
5. **Mutating the two numbers that look plausible when wrong.** The `+ 180` in the line end handle
   and the wrap boundary in the sweep. Both return a believable picture when wrong, which is the
   pattern this feature has hit in every slice. Restore from a byte copy.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, and full `npm test`. Re-measure the
suite counts rather than quoting an earlier slice's, and update CLAUDE.md's test count row if a file
lands.

Run sheet for `npm run tauri dev`: switch a group through all six kinds and confirm each draws as its
name; set Polygon to 3 sides and confirm it matches Triangle; grab a line's near end and confirm the
whole line swings and resizes in one move; grab an arc's sweep handle and confirm it opens and closes
without moving the first member; then Apply from each kind and read the fence.

Append a `docs/build-log.md` entry, and follow the house language rules in CLAUDE.md for every
comment and user facing string. This is the last of the three slices, so the entry is also the place
to say the feature is finished and what was left as a want.
