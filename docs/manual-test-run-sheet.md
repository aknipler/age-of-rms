# Manual test run sheet — everything owed against a real `npm run tauri dev`

Nothing in the agent environment can render `App.tsx`/`ToolsPane.tsx`: the Tauri store
plugin calls (`HelpSettingsContext`, `GenerationSettingsContext`, `useDocument.ts`) throw
outside the real host process, so every UI-touching slice since Land Placement 4b has shipped
with a written run sheet nobody has worked through yet (see CLAUDE.md's Environment section).
This file collects every one of those sheets in the order they need running — several later
sheets extend or assume an earlier one — so one `npm run tauri dev` sitting can clear the
whole backlog instead of five separate ones.

**When you run this:** work top to bottom, record each step's result (including anything
that looked wrong and was left, per this repo's own "the first read of real output finds a
different class of defect than review" rule), and fold the results into `docs/build-log.md`
as a dated entry. Steps within a section can be skipped only if a later section says its
predecessor is already confirmed.

---

## 1. Land Placement 4b — the panel exists at all (`land-placement-slice4-brief.md` Sec.5)

**First, the two refactor regressions** — run before the panel exists, and again at the end:

- **R1.** Breakdown and Code: the preview generates, the seed re-rolls, Current/Final still
  cut where they did, and switching Breakdown ↔ Code neither restarts a generation nor resets
  zoom.
- **R2.** Breakdown's preview is unchanged to the eye — same terrain, objects, player flags,
  failure marks, hover and selection outlines, at a fixed seed.

**Then, with the panel:**

1. Select Land Placement. The panel mounts; `isBusy()` is true; starting a report tool is
   refused with a readable message.
2. Switch to another tool with a clean panel — no confirm. Make an edit, switch again —
   confirm appears. Cancel it; the panel and the model are still there.
3. Switch to Code and back. The model survives. The panel re-requests one generation on
   return.
4. File > Open a different script. The panel unmounts unconditionally and says so in the
   pane, not in a modal.
5. The canvas draws the pinned seed's generation, cut at the end of land generation. Re-roll;
   it redraws. The seed is visible.
6. Land circles sit where the emitted script puts them — check one against the preview pane
   on the Breakdown tab at the same seed and player count.
7. Click a land. The tree scrolls to it; click a tree row, the canvas highlights it.
8. Create a ring of 8. The count reads 8 live. Change repeats to 3 with a 3-slot pattern; it
   reads 9. Reorder a chip; the report says what moved.
9. Every number field shows its tile equivalent, and it changes with the map size.
10. Open `Rage Forest 2026.rms`. The preconditions strip states the raw-node fraction and
    names the lands it cannot manage. The panel is not silently empty.
11. Apply on a fresh script. The fence appears, everything outside it is byte-identical, the
    script still parses with no new diagnostics. Apply again with no edits — zero changes.
12. Hover eight elements at random. Every tip has real text; none shows the "No help written
    yet" fallback.

---

## 2. Land Placement slice 5 — drag, snap, gizmo, rim-drag chaining (`land-placement-slice5-brief.md` Sec.4)

- **R0.** Section 1's sheet above, all twelve steps, if not already run.
- **1.** Drag a standalone land. It moves, its children follow live, the tree's numbers
  update, and the Generated Code section changes with it.
- **2.** Drag a land whose offset is a non-invertible formula. It does not move, and the
  panel says why.
- **3.** Drag a ring member. It moves alone. Change the ring's repeats. The nudge survives as
  a delta rather than snapping back to the expansion.
- **4.** Drag near the map centre and near a parent's axis. Both snap. Drag far from both. It
  still lands on a tile.
- **5.** Radius and rotation handles on a ring. The count stepper is unaffected by both.
- **6.** Rim drag onto another land. The chain appears and nothing moves.
- **7.** Rim drag onto a descendant. Refused before the drop, not alerted after it.
- **8.** Pan and zoom still work, on the panel canvas and on Breakdown's preview.
- **9.** Apply. The fence updates, everything outside it is byte identical, and a second
  Apply with no edits produces zero changes.
- **10.** Hover every new control. Real help text, no "No help written yet" fallback.

---

## 3. Land Placement per-player slice A — the ring's own per-player mode (`land-placement-per-player-slice-a-brief.md`)

1. Open a script, select the Land Placement tool, add a role and a ring (`+ Role`, `+ Ring`).
2. Check "One land per player" on the ring. Confirm the Repeats field disables and shows a
   title explaining why, and the ring's own label switches to "up to 8 lands".
3. With the generation-settings player count at some value below 8 (say 3), confirm the
   canvas draws exactly that many lands, evenly spaced.
4. Change the player count in generation settings (e.g. to 5 or 8) without touching the
   model. Confirm the canvas rearranges to match, with no Apply needed — the preview should
   visibly react to the setting alone.
5. Press Apply. Confirm the preconditions strip shows no P4 collisions, and switch to the
   Code tab to read the emitted fence: one prologue with eight `if`/`elseif`/`endif`
   branches at the top, `ALP_AT_LEAST_*` defines and `ALP_DEG_P*` consts inside each, then the
   unconditional frame algebra, then eight `create_land` blocks lower in the section, seven of
   them wrapped in their own guard.
6. Change the player count again post-Apply and regenerate (or re-open the Preview tab) to
   confirm the SCRIPT itself, not just the panel, produces the right count of lands at
   runtime.
7. Try adding a chained aux land off one of the ring's members (parent it to a specific
   `ring#i#P` placement) and confirm, after Apply, that its own `create_land` is wrapped in
   the SAME guard as its parent rather than left unguarded or given its own.

---

## 4. Land Placement per-player slice B — authored angles (`land-placement-per-player-slice-b-brief.md`)

Extends section 3's sheet rather than replacing it:

Build a per-player ring, select a non-P1 member, confirm the Angle field is now visible and
editable, type a formula referencing another member or a `RandomParam` (e.g.
`ALP_DIST_BW_PLAYERS + ALP_ROTATION`), confirm the canvas redraws that member off the new rule
at the current player count, confirm dragging that member declines with a stated reason and
leaves the model unchanged, Apply, and read the fence: the referenced param's own
`#const rnd(...)` cell should appear before the prologue, and the authored member's own
`ALP_DEG_Pk` line should read the formula (not a number) in every branch from its own player
count through 8.

---

## 5. Land Placement per-player slice C — per-count overrides and the jitter helper (`land-placement-per-player-slice-c-brief.md`)

1. Open a script with a `perPlayer` ring (or build one fresh: + Role, + Ring, tick "One land
   per player").
2. Select a ring member, add a per-count override at 2 players via the new select, give it a
   distinct angle from the default.
3. Switch the generation player count between 2 and 6 in Generation Settings; confirm the
   canvas shows the override's own angle at 2 players and the default rule's angle at 6, and
   confirm the override row stays visible in the panel at both settings.
4. On the ring's own controls, set a minimum separation past what the previewed count's even
   spacing allows (e.g. 50 degrees at 8 players) and confirm the panel shows the refusal text,
   not a silently clamped number; lower it below the safe bound and confirm the ±X.X°
   readout updates.

---

## 6. Land Placement shape kinds slice A — Line and Arc (`land-placement-shape-kinds-slice-a-brief.md`)

Create a ring, switch its Shape select to Line, confirm the canvas redraws as a line through
the anchor; drag the radius handle and confirm it changes the line's half length; switch to
Arc, change the Sweep field, confirm the canvas redraws the swept arc; tick "One land per
player" on a Circle ring, confirm it works as before, then switch that same ring's shape to
Line or Arc and confirm the checkbox becomes disabled with a stated reason (and, if it was
already checked, that the Generated Code section now reports a refusal rather than a wrong
map); Apply a Line and an Arc ring and read the emitted fence for the one-line-per-member
claim.

---

## 7. Land Placement shape kinds slices B and C — Square, Triangle, Polygon, and the last two handles (`land-placement-shape-kinds-slice-b-brief.md`, `-slice-c-brief.md`)

Neither slice has been run against a real host before this sheet; B shipped `square` and the
cartesian machinery, C added `triangle`/`polygon`/`sides` and the line-end/arc-sweep handles.
Run together, in this order:

1. Switch a group through all six kinds (Circle, Line, Arc, Square, Triangle, Polygon) and
   confirm each draws as its own name — no kind still reads as a circle.
2. Set Polygon's Sides field to 4 and confirm the drawn shape matches a Square ring at the same
   radius, rotation and member count exactly.
3. Try Sides values at the edges (3 and 12) and confirm both draw a real polygon rather than
   clamping visibly or refusing.
4. ~~On a Square, Triangle or Polygon ring, type a formula into Rotation referencing a
   `RandomParam` or another placement. Confirm the ring still draws (at rotation 0) and the
   preconditions strip / Generated Code section reports a refusal rather than allowing Apply.~~
   **Superseded, item 10 below**: perimeter-symbolic-rotation-slice-a-brief.md deleted this
   refusal the same day — a symbolic rotation now emits normally, at its real resolved value.
5. Drag the radius handle on a Square/Triangle/Polygon ring and confirm every member's own
   `#const` in the Generated Code preview updates with one clean line each, no extra temps.
6. Select a Line ring. Confirm it now shows THREE handles: radius (far end), rotation, and a
   third sitting on the near end. Grab the near-end handle and drag it; confirm the whole line
   swings and resizes in one move, with no intermediate flicker of a half-updated shape. Drag it
   back to exactly where it started and confirm nothing in the Generated Code diff changes.
7. Select an Arc ring. Confirm it shows a third handle sitting at the swept end. Grab it and
   drag it around the anchor; confirm the arc opens and closes without moving its own first
   member, and confirm dragging past the point opposite the rotation ray keeps the sweep
   reading as a large positive number rather than jumping negative.
8. ~~Apply from each of the six kinds in turn and read the emitted fence: a Square/Triangle/
   Polygon member's X/Y cells should each be one `#const` line (a baked decimal coefficient
   times the radius, no SIN/COS/DEGREES cells the way a circle/line/arc member has).~~
   **Superseded, item 10 below**: every kind is `polar` now, so a perimeter member DOES emit a
   DEGREES cell and the full trig macro, exactly like circle/line/arc. Apply from each of the
   six kinds and confirm every member's fence lines look the same shape regardless of kind.
9. Hover every new control (the Sides field, both new handles if they render their own tips)
   and confirm real help text, no "No help written yet" fallback.
10. **Owed since perimeter-symbolic-rotation-slice-a-brief.md** (item 6): on a Square ring,
    type `rnd(0,359)` into Rotation and Apply. Confirm it succeeds (no refusal in the
    preconditions strip or Generated Code section) and read the emitted `#const` block: each
    member's own DEGREES cell should reference the `rnd(0,359)` param's own emitted name, and
    the drawn shape on the canvas should visibly re-roll its rotation across re-generation the
    same way a Circle ring with a symbolic rotation already does. Also confirm a `radial` child
    chained to one of the Square's members now measures its own angle from that member's real
    bearing (drag the child and watch it follow the parent's rotation), where before this slice
    it would have measured from a fixed world bearing regardless of the parent's own spin.

---

## 8. Newcomer tutorial — acceptance criteria (`tutorial-design.md` Sec.16)

- A fresh profile (no `settings.json`) shows the welcome pane once, with a skip button whose
  wording varies between launches.
- Each of the three welcome buttons does exactly what Sec.7.4 says, and the pane never
  appears again.
- Help ▸ either tutorial item starts that tutorial from step 1, at any time, whether or not
  it has been completed.
- In Tutorial A, performing a step's edit in the Breakdown editor advances the tutorial
  without the user clicking Next.
- `Next` advances an unsatisfied check step anyway; `Back` returns to it and it is still
  unsatisfied.
- Running Tutorial A against a finished Golden Hill does NOT race to the end: each step
  renders ticked and waits for Next, so it is readable as a reference.
- Step 0's "Carry on with my own map" advances into step 1 with the user's own file
  untouched.
- `Escape` and `Exit tutorial` end a run cleanly, with no overlay left behind.
- With the tutorial open, every control behind the scrim is still clickable.
- The spotlight follows its anchor when the pane is scrolled or the window resized, and
  degrades to a centred callout when the anchor is not on screen.
- Following Tutorial A end to end on an empty file produces a script that parses with zero
  errors and renders a recognisable map in the preview.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run validate:reference` all pass.

---

## 9. Advanced Tools tab-switch persistence (2026-09-03 fix — no prior sheet, no dependency on sections above)

Fixes the "have to select the tool again" report: `ToolsPane` fully unmounts on every tab
switch, and which tool the dropdown showed (`selectedId`) used to be a plain local `useState`
that forgot the selection and fell back to the first tool in the list. It's now lifted into
`ToolHostContext.tsx` alongside `ToolHost` itself.

1. Select a report tool (e.g. Script Stats), switch to Code, switch back to Advanced Tools.
   Confirm the dropdown still shows that tool, not the first one in the list.
2. Select Land Placement, build something (a role, a ring), switch to Code, switch back.
   Confirm the panel itself reappears showing the same model — not the dropdown reverted to
   a different tool with the Land Placement panel invisible underneath it.
3. Confirm the Code tab's own cursor/scroll position also survives an Advanced-Tools round
   trip (this piece needed no code change — the shared selection anchor already covers it —
   but has never been checked against a real render).

---

## 10. Land Placement perimeter rotation, slices A and B (`land-placement-perimeter-symbolic-
    rotation-slice-a-brief.md`, `-slice-b-brief.md`)

A replaced the perimeter kinds' `cartesian` offset with `polar` and let their rotation be
symbolic; B added `PatternSlot.perimeterShift`, a per-slot position along the perimeter. Run
together, in this order:

1. Build a Square ring with a couple of members. Type `rnd(0, 359)` into Rotation and confirm
   the canvas still draws a real square (not stuck at rotation 0) and re-rolls it on reseed.
2. Apply, then switch to Code and read the emitted fence: the rotation's own `#const rnd(...)`
   cell should appear once, and each member's `DEGREES` cell should reference it rather than a
   baked literal.
3. On one slot's chip, enter a number in the new shift field. Confirm the land slides along the
   shape's own edge — both its bearing AND its distance from the centre change, visibly further
   out or in depending on which way it moved off the side's midpoint.
4. Try a shift past 100 and a negative shift; confirm both wrap to a real position on the shape
   rather than refusing or clamping.
5. Chain an aux land off a Square/Triangle/Polygon ring member (radial frame). Confirm it now
   measures from that member's own real bearing rather than the flat world bearing it used to
   fall back to.
6. Drag a Square/Triangle/Polygon ring member whose group Rotation is a formula. Confirm the
   drag keeps the rotation reference and adjusts only the constant term, rather than declining.
7. Hover the new shift field and confirm real help text, no "No help written yet" fallback.

---

## Not covered here

Nothing currently owed and unbuilt. The next UI-touching slice should append its own run sheet
here rather than a new scattered file.
