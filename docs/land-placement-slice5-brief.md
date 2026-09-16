# Land Placement, slice 5 brief: the canvas learns to edit

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-design.md` (rev 3, plus the 2026-08-30 addenda in Sec.4.2 and Sec.4.5, and
4b's own two amendments to Sec.3.4 and Sec.7.1). Read this file for _what to build and in what
order_; read the design doc for _why_, and treat it as authoritative wherever the two disagree.

**Slice 5 is half built.** The session of 2026-09-01 closed `RandomParam` hoisting and the
formula field, and built snapping and the canvas drag math as pure, tested modules that nothing
calls. This brief covers what is left, and §0 lists what is already done so none of it gets
rebuilt.

---

## 0. Where the work stands

|                                                                                                                                 | status                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Sec.5 math compiler, Sec.4.2 frame algebra, Sec.10.1 acceptance gate                                                            | **built** (slice 1)                                               |
| `generatePreview` prerequisites, `PanelState`, layers 1 to 3                                                                    | **built** (slice 2)                                               |
| Fence writer, `create_land` skeletons, `ShapeGroup` expansion, `reExpand()`, remaining offsets and frames, P2 to P5             | **built** (slice 3)                                               |
| The `RegisteredTool` seam, the emission orchestrator, panel Apply, `read-preview-view`, the cut offset, the overlay builder, P1 | **built** (slice 4a)                                              |
| The preview pipeline per consumer, the shared overlay canvas, the panel lifecycle, the canvas (Sec.7.2), the panel (Sec.8)      | **built** (slice 4b)                                              |
| `RandomParam` hoisting (`paramEmit.ts`), the formula field (`panel/formulaField.ts`)                                            | **built** (slice 5, 2026-09-01)                                   |
| Snapping (`panel/snapping.ts`), canvas drag math (`panel/dragMath.ts`)                                                          | **built as pure modules, wired to nothing** (slice 5, 2026-09-01) |
| Pointer wiring, `nudged`, snapping wired, gizmo handles, chain by drag, per vertex handles                                      | **this brief**                                                    |
| Naming an existing `RandomParam` from a formula                                                                                 | **§1's escalation**, not a build item                             |
| The importer (Sec.6.4, Sec.10.3)                                                                                                | **slice 6, not this one**                                         |

**Two manual passes are outstanding, and neither is this slice's fault.** 4b's §5 run sheet has
never been worked through in `npm run tauri dev`, so no person has yet driven the canvas and
panel this slice extends. Run that sheet FIRST, before adding a third pointer mode, and record
its results. If it turns up defects, fix those before wiring a drag; a drag on a canvas whose
selection is already wrong is undebuggable.

### Read before writing code, in this order

1. `docs/build-log.md`, the **2026-09-01 "Land Placement Slice 5 (partial)" entry** first, then
   the 2026-08-31 4b entry. Between them they name every deliberate omission this brief picks up.
2. `docs/land-placement-design.md`, Sec.7 **in full**, Sec.4.5 including the 2026-08-30 merge
   rule subsection, Sec.3.4 layer 3, Sec.3.7, Sec.8.
3. `src/tools/builtin/landPlacement/panel/dragMath.ts` and `panel/snapping.ts` with their tests.
   **You are calling these, not changing them.**
4. `src/components/preview/OverlayCanvas.tsx`, the whole file, in particular the pan and hover
   block from line 242. Adding a third pointer mode to it is the whole of item 1.
5. `panel/LandPlacementCanvas.tsx` and `panel/canvasGeometry.ts`, the existing click to select
   path, which is the seam the drag extends.

---

## 1. Scope

**In.** Six items, ordered in §2 so the slice stays shippable if it is cut short.

**Out, and do not drift into these.**

- **The importer** (Sec.6.4, Sec.10.3). Slice 6.
- **Layer 4** (declarative forms). Deferred by design, Sec.3.4.
- **The arithmetic in `dragMath.ts` and `snapping.ts`.** Both are tested. If one looks wrong,
  prove it with a failing test before touching it.
- **The Sec.10.1 acceptance gate.** It is the regression test for every emission change. If it
  goes red you changed behaviour.
- **Raising the test floor beyond what this slice's own files require**, and any formatting pass.

**One escalation, and it blocks nothing in §2.** Referencing an EXISTING named `RandomParam`
from inside a formula field is Sec.8's own worked ring rotation example and it has no syntax.
The grammar turns a bare identifier into `sym(name)` resolved against script and model symbols,
with no notion of "this identifier is a `RandomParam`'s label, materialise a reference to its
emitted name". Closing it needs a resolution step at commit time plus a decision about what a
collision between a param label and a script symbol means. That is a design decision, and
`CLAUDE.md`'s rule is to stop and escalate rather than improvise one. **Recommendation: decide
it in writing before slice 6 and keep it out of this slice.** Everything in §2 is reachable
without it.

---

## 2. The work, in order

Each item states its acceptance criterion. An item is done when its criterion is demonstrated,
by a test where a test is possible and by a named run sheet step where it is not.

### 1. A third pointer mode on the shared canvas (Sec.7.3)

`OverlayCanvas` owns pointer capture, pan, and the click versus pan slop (`CLICK_SLOP_PX` and
the `travel` accumulator that separates the two). A second pointer owner layered over it would
fight it for capture, so **the drag belongs inside that component behind optional props**, not
in a wrapper around it. Two surfaces render this component, and Breakdown and Code must behave
identically when the new props are absent.

Suggested shape, one optional pair. A callback answering "does a drag start on this tile, and on
which shape" (the panel supplies `hitTestCircles`), and a callback receiving the shape id, the
drop point and the modifier keys on move and on release. With neither supplied, `onPointerDown`
does exactly what it does today.

**Decide and record which path the built-in panel uses.** Layer 3's `createDragCoalescer` exists
for a tool receiving `overlayEvent` across a transport, and the built-in panel is in process, so
it can call `applyDrag` directly with no serialisation and no rate bound. **Recommendation:
direct call for the built-in.** If that is the decision, update `src/tools/overlayEvents.ts`'s
header comment, which says "the caller (a future canvas)", to name which canvas will pump it and
when (M6, an external panel tool), so it stops reading as an unclaimed obligation.

**One piece of arithmetic that must not end up in the component.** `readTile` FLOORS the
fractional `screenToTile` result. Flooring and then snapping rounds twice and biases every drag
by up to half a tile toward the map origin. Convert the fractional point to percent and let
`applyDefaultSnapping` do all the rounding.

**Acceptance:** the existing `drawOverlay.test.ts`, `canvasGeometry.test.ts` and
`projection.test.ts` still green and unmodified, the percent conversion covered by its own test,
and run sheet steps 1 and 8.

### 2. `nudged`, which this slice makes reachable for the first time

`Placement.nudged` is set when a user moves a group member away from its expansion, and
Sec.4.5's merge rule branches on it. Today the panel gates every offset field on `!inGroup`
(`LandPlacementPanel.tsx:469` onward), so a member's offset is not editable anywhere, and
**nothing in the app has ever set `nudged`**. `reExpand()`'s nudged branch is tested and has no
producer.

A drag on a group member is that producer. Set `nudged: true` in the same model update that
writes the new offset.

**Acceptance:** dragging a member and then changing the ring's `repeats` re-applies the drag as
a delta against the new base rather than discarding it, asserted through `reExpand()` on the
model with no canvas involved. Assert the negative too: dragging a standalone placement leaves
`nudged` unset.

### 3. Snapping, wired

`applyDefaultSnapping` sits between the drop point and `applyDrag`. Its `SnapContext` wants
`mapDim`, the parent's own resolved anchor (omitted for a placement parented to `center`, since
`snapToCentre` already covers that), and the tolerance, which defaults to 2 tiles.
`snapToIntegerPercent` is the explicit modifier and never a default, per rev 3's own withdrawal.
`OverlayEvent.modifiers` already names the four modifier keys; use that vocabulary whichever
path item 1 chooses.

**Acceptance:** the snap context builder is a lookup, so it is testable. Pin that it supplies
`parentAnchor` for a chained node and omits it for a root one. The feel is run sheet step 4.

### 4. Gizmo handles on the selection (Sec.7.3)

Sec.7.3 asks for "a radius ring handle, a rotation handle, and a count stepper". The stepper
exists in the panel; the two handles do not. **They edit the GROUP, not a member**, so they route
through `modelOps.applyGroupEdit` and therefore through `reExpand()`, exactly as the panel's own
radius and rotation fields already do. Never call `expandShapeGroup` fresh from a handle.

Both are `dragPolar` inputs against the group's own anchor. The radius handle keeps the bearing
and takes the distance; the rotation handle keeps the distance and takes the bearing.

**Acceptance:** where the handles sit for a given group is a pure function and gets a test. The
drag itself is run sheet step 5.

### 5. Chain creation by dragging from a rim handle (Sec.7.3)

Drag from a land's rim to another land or to the centre marker to create the chain, "computing
the offset that leaves the child exactly where it is". That last clause is the whole item: the
offset is `applyDrag` against the NEW parent with the drop point set to the child's CURRENT
resolved position, so creating a chain never moves anything on screen.

`wouldCreateCycle` already exists in `viewModel.ts`. Reuse it, and refuse the drop while the
pointer is over an invalid target rather than alerting after the fact, which is what the parent
picker does today.

**Acceptance:** re-parenting through this path leaves the child's resolved position unchanged,
asserted by running `emitModel` before and after and comparing resolved positions, not by
asserting on the offset numbers. Run sheet steps 6 and 7.

### 6. Per vertex handles, which are a model gap wearing a UI costume

`ShapeGroup.kind` carries `circle | square | triangle | polygon | line | arc`, and
**`expandShapeGroup` ignores `kind` entirely** (`expand.ts:57`). Every kind lays its members on
a ring at `r = radius`, `theta = rotation + even division`. So there are no vertices for a per
vertex handle to grab, and the panel's "+ Ring" only ever creates a circle anyway.

Two halves, and the first is the real one. Give expansion a meaning for each kind, and give the
panel a way to create one. Only then do the handles have something to edit. Check Sec.4.5 for
what each kind is supposed to mean before inventing it, and escalate if the section is silent,
which it may well be.

**Acceptance:** expansion of each kind covered by a test that pins the member positions, before
any handle exists.

**If the slice runs short, cut from item 6 upward.** Items 1 to 3 are one coherent feature (drag
a land, it snaps, the nudge survives a re-expansion) and are worth shipping alone. Items 4 and 5
are additive. Item 6 may turn out to be a slice 3 gap that deserves its own escalation.

---

## 3. Hazards a fresh session gets wrong

**Nobody has run the panel yet.** 4b's §5 run sheet is still owed. Run it before building on top
of it, and expect its results to change this brief's ordering.

**The overlay is a guarantee, not a picture.** `LandPlacementCanvas.tsx`'s own header says the
vector tier "can never disagree with what will be emitted, because it reads the SAME
`emitAlpModel` + `buildOverlayShapes` pipeline Apply itself uses". A drag must therefore go
through the model and let the overlay re-derive. Moving a drawn shape directly and letting the
model catch up later breaks the one property that sentence claims.

**`dim` and `mapDim` are two different numbers in the same component.** `LandPlacementCanvas`
draws with `snapshot?.dim ?? mapDim` while it builds overlay shapes from `mapDim`. Today a
divergence is a drawing offset. Once a pointer position is converted to a model coordinate it
becomes a wrong emitted position. Derive both from one source, or assert they agree.

**A `formula` node can decline the drag, and the decline must be visible.** `applyDrag` returns a
discriminated union and the failure arm carries a reason. Sec.7.3 is explicit that the handle
becomes a read only marker and the panel says why. A silent no-op reads as a broken canvas, and
"silently discarding a user's formula because they brushed the canvas is unacceptable" is the
section's own sentence.

**One `NameAllocator` per emission.** Carried from 4a and 4b and still live. Every emission goes
through `emitAlpModel`.

**`helpCoverage.test.ts` cannot see a help id passed as a prop.** 4b had to pin
`landPlacement.canvas` explicitly because it reaches `HelpTip` through `helpTipId=` rather than
as a literal `<HelpTip id="...">`. Any new prop-passed id needs the same explicit pin.

**Tooling traps, all previously paid for.** The Grep tool under-reports on `test-maps/*.rms`, so
use `grep` through Bash for any corpus count. Run vitest by exact path
(`npx vitest run src/tools/builtin/landPlacement`), since a directory wide run can collide with a
long-running measurement probe another session started. `elevation.test.ts` and
`patch.property.test.ts` have documented wall clock timeout flakes under full suite load; if one
of those is the only failure, confirm it in isolation before believing it.

---

## 4. How this slice ends green

Nothing in this repo can render `ToolsPane` or `App.tsx`, so the same split 4b used applies here.
**Push every calculation into a tested pure function, so the run sheet checks wiring and
legibility and never the correctness of a number.** If a run sheet step could fail because a
number is wrong, that number belonged in a module.

Then run `npm run tauri dev` and work through this sheet, recording every result in the build log
entry, including the ones that looked wrong and were left.

- **R0.** 4b's own §5 sheet, all twelve steps, first. It has never been run.
- **1.** Drag a standalone land. It moves, its children follow live, the tree's numbers update,
  and the Generated Code section changes with it.
- **2.** Drag a land whose offset is a non invertible formula. It does not move, and the panel
  says why.
- **3.** Drag a ring member. It moves alone. Change the ring's repeats. The nudge survives as a
  delta rather than snapping back to the expansion.
- **4.** Drag near the map centre and near a parent's axis. Both snap. Drag far from both. It
  still lands on a tile.
- **5.** Radius and rotation handles on a ring. The count stepper is unaffected by both.
- **6.** Rim drag onto another land. The chain appears and **nothing moves**.
- **7.** Rim drag onto a descendant. Refused before the drop, not alerted after it.
- **8.** Pan and zoom still work, on the panel canvas and on Breakdown's preview.
- **9.** Apply. The fence updates, everything outside it is byte identical, and a second Apply
  with no edits produces zero changes.
- **10.** Hover every new control. Real help text, no "No help written yet" fallback.

**Write down what was ugly even when it was not wrong.** Sec.13 names the first read of real
output by a person as the thing an agent cannot do, and this repo has twice found a class of
defect that survives every review round and is legibility rather than correctness.

---

## 5. Teaching mode is a requirement here, not a nicety

`CLAUDE.md` governs this session and this slice is mostly React, which is the half that does not
transfer from Python and C++. Explain the decision, never the syntax, and name the concept out
loud so it can be looked up later.

The decision points this slice actually has: why pointer capture means the drag lives inside the
component that owns the pointer rather than in a wrapper; why an optional prop pair rather than a
second canvas or a subclass, and what "optional props keep the other caller's behaviour
identical" buys; why the model stays the source of truth and the canvas re-derives, which is the
same rule Breakdown runs on one tier up; and why `DragOutcome` is a discriminated union rather
than a nullable result. Say which of those are standard React practice and which are this
codebase's own choices, so the habits transfer and the quirks do not get cargo culted.

End the session by offering two or three questions that check understanding of what was built.

---

## 6. Repo rules that will bite

Read `CLAUDE.md` in full before starting. The ones most likely to reach this slice:

- **Design specs are authoritative.** If Sec.7.3 or Sec.4.5 seems wrong or ambiguous, stop and
  escalate. Item 6 is the likeliest place this happens.
- **NEVER run `git checkout --`, `git restore`, `git stash` or `git clean`.** The working tree
  carries weeks of uncommitted work as its normal state and git cannot recover what was never
  committed. Undo an edit with the edit tools, the same way it was made.
- **Do not commit.** Write the commit message and leave it to be run.
- **Other sessions edit this repo concurrently.** Re-read a file immediately before editing it,
  and never overwrite one wholesale.
- **Do not run Prettier.** `.prettierrc.json` is `{}`, the tree has never been formatted, and a
  run rewrites untouched lines everywhere. Match the style of the file you are editing.
- **Every new interactive element wraps in `HelpTip`** with a matching
  `reference/data/ui-help.json` entry, as it is built. Handles are interactive elements. The
  `landPlacement.*` namespace is 4b's and this slice extends it rather than growing `tools.*`.
- **A new dependency means saying `npm install` in the same breath.** This slice should need none.
- **Imperative mood, no names, no "Phase", and no em dashes** in code comments, docs or any user
  facing string. Fix that in passing where you edit an existing line, rather than leaving it for
  a cleanup pass.

---

## 7. Definition of done

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run validate:reference
```

```bash
npm run check:generated-types
```

- All of the above clean.
- Full suite green. **Baseline entering this slice is 99 files / 2512 tests, floor 68/1625**
  (clean run, 2026-09-01). Report the real number you end with, and **never edit a test to make
  it pass**.
- The Sec.10.1 acceptance gate passes unmodified, and Sec.10.4's four fence gates stay green.
- `helpCoverage.test.ts` extended to the new controls and green.
- **Mutation test item 2's `nudged` branch and item 5's "nothing moves" assertion.** Both are
  checks that will only ever pass in normal operation, which is the definition of a check that
  proves nothing until it has been seen to fail. Introduce the defect, confirm red, restore.
- §4's run sheet worked through, with every step's result written down.

Then:

1. Append an entry to `docs/build-log.md` in the style of the existing ones: what was built, what
   was found, what moved a conclusion, what is deliberately not done, and the real verification
   numbers.
2. **Update `CLAUDE.md`'s expected files and tests row.** It is stale right now, reading 94/2411
   while `scripts/check-test-floor.mjs` already holds `MIN_FILES = 68` and the 2026-09-01 entry
   measured 99/2512. Fix it with this slice's own measured number.
3. If something in the design doc turned out to be wrong, amend the doc and say so in the log
   entry. That is the house style, not a deviation from it.
4. **Write slice 6's scope line while the omissions are fresh**: the importer (Sec.6.4,
   Sec.10.3), plus whatever §1's escalation is decided to be.
