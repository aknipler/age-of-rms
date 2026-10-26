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
player" on a Circle ring, confirm it works as before and that the Shape select now offers
Circle alone (section 16 covers this guard), then untick it, switch the ring to Line or Arc
and confirm the checkbox is disabled with a stated reason; Apply a Line and an Arc ring and read the emitted fence for the one-line-per-member
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
- Step 0's "Carry on with my own map" advances into step 1 with the user's own file
  untouched.
- `Escape` and `Exit tutorial` end a run cleanly, with no overlay left behind.
- The spotlight follows its anchor when the pane is scrolled or the window resized, and
  degrades to a centred callout when the anchor is not on screen.

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

## 11. Beta feedback round, 2026-09-17 (build-log entries dated 2026-09-17)

Everything below was built headless. None of it has been seen in the Tauri host.

1. Open the Breakdown tab on a brand-new script (File > New). Confirm the Header tab is
   present and numbered 0. Add a `#const` from it and confirm it lands on the line after the
   stamped header comment, not above it.
2. On any section tab, open Add Command and confirm `#const` and `#define` are listed after the
   commands and insert with placeholders. `#undefine` and `#include` must not be offered.
3. Collapse a `create_land` with many attributes. Confirm the summary truncates with an ellipsis
   and the trash button stays on the right edge, never pushed off the card.
4. Expand a `create_terrain`, click the absent `terrain_type` row. Confirm it inserts bare, the
   field is empty with the italic hint, an RMS0201 warning shows, and typing a value then
   clicking away fills it. Confirm the clear cross sits inside the field where the dropdown
   arrow used to be, and the list still opens on click.
5. Add a bare `replace_terrain`. Confirm both fields appear at once with "with" between them,
   and filling the second first pads the first with `TODO`.
6. Add Command, Add Comment and Add Template. Confirm each new card opens and the list scrolls
   to it. Turn off Settings > Breakdown > "Scroll to a card when it is added" and confirm the
   scroll stops while the card still opens.
7. Collapsed card, click an attribute on its summary line. Default mode opens the card with
   that field focused. Switch the setting to "Edit it in place", click a value attribute and
   confirm an inline editor; click a boolean and confirm it is removed from the code and shown
   struck through, click it again to restore, leave one for 30 s and confirm it disappears.
8. Open a long card, scroll into its attributes, click the card's left edge. Confirm it
   collapses and sits at the top of the list. Click + without scrolling and confirm the view
   returns to where it was inside the card. Repeat, but scroll first, and confirm the reopen
   leaves the view alone.
9. Hover the trash button on a directive card. Confirm one tooltip, not two.
10. Settings > Breakdown > Hide unused attributes on. Open a card, confirm only present rows
    plus the Add Attribute bar show with an "N unused hidden" line. Untick a flag and confirm
    its row stays until the card is closed and reopened. Type in Add Attribute, click a result,
    confirm it appears at once. Add a name to "Always show" and confirm it stays on every card.
11. Objects tab, Add template. Try each template with its options, confirm the preview text
    matches what is inserted, and that Insert is disabled for a bad `terrain_to_place_on`.
12. Preview pane, Minimap mode, on a script with `terrain_mask 1` layers. Confirm the layer has
    no effect on colours.
13. Objects tab, Add template, Player forests (2026-09-28). On a script with a PLAYER_SETUP,
    Insert and confirm the `create_object` lands at the cursor and the `#const` and
    `effect_amount` lines land at the end of PLAYER_SETUP, then one Ctrl+Z removes both. Insert
    again and confirm only the `create_object` goes in, with the dialog saying why. On a script
    with no PLAYER_SETUP, confirm the lines go to the header instead. Clear a number field and
    confirm Insert greys out with the reason written under the options. No FOREST warning
    appears in the Code tab. Pick Custom… under Forest terrain, confirm the box opens holding
    the current choice, type a name one letter at a time and confirm the box stays open the
    whole time (it must not snap back when a partial name matches a list entry).
14. Terrain tab, Add template, Player forests. Confirm the player land field holds the script's
    `create_player_lands` terrain, that changing it updates the note under it, and that the
    preview shows ten rounds. Generate the map in game for 2 and 8 players and confirm every
    player gets a forest near the start and none away from it.

---

## 12. Land Placement Q11 and Q12, 2026-09-22 (`land-placement-role-attributes-escalation.md` slices 1 to 3, `land-placement-composite-pattern-escalation.md` slices 1 and 2, BUG-030)

Open a script with a `<PLAYER_SETUP>` and a `<LAND_GENERATION>` section but no
`<ELEVATION_GENERATION>`, select Land Placement.

1. `+ Role`. In the Roles list confirm the new Extent, Zone and Assign controls render as one
   control each: switching Extent between land_percent and number_of_tiles keeps the typed
   number; Zone offers none, zone N, zone per repeat, set_zone_randomly; Assign offers none,
   assign_to_player, assign_to and reveals target, number, mode and flags only for assign_to.
2. Set Assign to assign_to AT_PLAYER, per repeat. Confirm the preconditions strip shows the
   direct_placement warning WITH an "Add direct_placement" button; press it and confirm the
   line lands under `<PLAYER_SETUP>` in the Code tab and the warning clears.
3. `+ Shape`. Confirm the strip now shows the `<ELEVATION_GENERATION>` warning with its
   "Add <ELEVATION_GENERATION>" button; press it and confirm an empty section appears after
   the land section and the warning clears.
4. Roles list, tier 1: type 5 into Left border, leave Right border empty. Apply, read the
   Code tab: the fence has `ALP_ROLE_LEFT_BORDER_*` and the create_land has `left_border`
   and NO `right_border` line. Type -3 into Top border and confirm the caution text appears
   beneath it. Clear Left border and confirm the constant and the line both go on the next
   Apply.
5. Open "Shape and conformity", tick set_circular_base. Apply and confirm `set_circular_base`
   appears with no argument and no trailing space, and `land_id` (if set) is the last line of
   the block, after `assign_to`.
6. Select one ring member. Under its role picker open Overrides, add Size, type 20. Apply:
   confirm that land's block references `ALP_LAND_SIZE_<label>` while its siblings still
   reference `ALP_ROLE_SIZE_*`, and the tree row shows "1 override". Press Reset and confirm
   the row disappears and the next Apply references the role constant again.
7. Toolbar: change "with role" to a second role, press `+ Land`, confirm the new land wears
   it. On the ring's pattern strip, change a slot chip's role select and confirm every member
   of that slot re-dresses (tree tags) without any dragged member losing its nudge.
8. Pattern strip: three slots, remove the middle one, add one, drag a member of each of the
   three and confirm they move independently (BUG-030).
9. Chain: on a slot, open "Chained off …", press `+ chained land` three times, set angles 0,
   -135, 135 and distance 14. Tick "One land per player". Confirm the tree shows three
   children indented under EVERY member, the canvas draws 32 hit targets at 8 players, the
   ring's own label reads "up to 32 lands", and after Apply every child's create_land sits
   inside the same `if ALP_AT_LEAST_k` as its parent. Drag one child: confirm only that copy
   moves. Change the template's distance: confirm every un-nudged copy moves and the strip
   reports the nudged one as position-detached.
10. Judgement call left open by the composite escalation (its Sec.11): with 32 targets on the
    canvas, decide whether chain children should stay selectable by default, and record it.
11. BUG-032. On a script with `<PLAYER_SETUP>` and `<ELEVATION_GENERATION>` but no land
    section: `+ Role`, `+ Shape`, Apply. Confirm the fence sits above `<PLAYER_SETUP>`, a
    `<LAND_GENERATION>` section appears between the two with the eight blocks inside it, and
    the elevation section's own content is untouched. Press the button again: it reads
    "Applied, up to date". Add Clumping to the role, confirm the button reads "Update (N
    changes)" and the line under it says "update 8"; press it and confirm every block gained
    `clumping_factor` with no block duplicated. Hand-edit one block's `base_size` to a number,
    change the role again, confirm that block is left alone and the line says so.
12. BUG-033. Fresh script, `+ Role`, `+ Shape`, Apply. Confirm the Random parameters section
    lists `ROTATION_RING_N` and the Rotation field reads `ROTATION_RING_N + 0`. In the app's
    map preview, reseed several times: the ring turns. Drag the ring's rotation handle: the
    field reads `ROTATION_RING_N + <delta>` and the param stays. Type `rnd(10,20)` into a
    land's Distance field: a new parameter appears in the list, the field reads its label.
    Try Delete on a referenced parameter: refused, with the reason on hover.
13. Show generated code: confirm both the header block and every create_land are listed.

---

## 13. Generation Settings fixed height and the preview's Generating label, 2026-09-23

Built headless and checked against the real stylesheets in a scratch page. Not yet seen in the
Tauri host.

1. Open Generation Settings from the Preview pane's cog. Click through 1v1, 2v2, 3v3, 4v4 and
   FFA, then type player counts 2 to 8 by hand. Confirm the dialog's height and the Close
   button's position never change.
2. Set 3 players with teams 1, 1, 2 so player 3 is alone on a team. Confirm the readout wraps
   onto a second line and the dialog still holds its height.
3. Theme settings, UI size at its largest. Reopen Generation Settings and confirm all 8 rows,
   the readout and Close are visible without scrolling. Shrink the window until the dialog
   cannot fit and confirm the middle scrolls while the title and Close stay in view.
4. Open a heavy script. Confirm "Generating..." shows in the middle of the preview slot before
   the first map appears.
5. Edit a line and confirm "Generating..." appears centred over the old map and goes away when
   the new map lands. Pan and zoom while it shows and confirm both still work.
6. Current mode, unpinned, move the caret around a light script. Confirm the label does not
   flicker on quick generations.

---

## 14. Land Placement Roles, Shapes and Lands sections, and the default selection, 2026-09-23

Built and tested headless (`LandPlacementPanel.selection.test.tsx` renders the real panel with
the canvas stubbed). The canvas highlighting and gizmo under each kind of selection have not
been seen in the Tauri host.

1. Open `test-maps/ALP_test.rms` and select Land Placement. Confirm the right column shows
   Roles (1), Shapes (1) and Lands (8) as three sections, and that Role 1 is selected with its
   editor open under the Roles list.
2. With Role 1 selected, confirm every land wearing it is drawn selected on the canvas and no
   rotation or radius handle shows.
3. Click Circle in the Shapes list. Confirm the shape editor (Shape, radius, rotation, pattern)
   opens under the Shapes list, the role editor closes, all eight lands draw selected, and the
   rotation and radius handles appear and drag.
4. Click a land row. Confirm its editor opens under the Lands list with a "Shape Circle
   ring_2" row, and that Edit shape selects the shape. Click a land on the canvas and confirm
   the same editor opens. Click bare map and confirm nothing stays selected.
5. Select a land, switch to the Code tab, then Breakdown, then back to Advanced Tools. Confirm
   the same land is still selected, not Role 1.
6. Select another tool, then Land Placement again. Confirm Role 1 is selected again, since that
   is a fresh open.
7. `+ Role`, `+ Shape` and `+ Land` each select what they created and open its editor.
   Delete the selected shape and confirm the Shapes editor closes without an error.
8. Columns. In all three lists, confirm every row's cells line up under each other. Add a
   second role and a second shape, and a standalone land with a long label, and confirm the
   columns widen for the longest cell rather than drifting per row. Chain a land under a
   shape member and confirm only its label is indented.
9. Change the shape's kind to Square. Confirm its row reads "Square 2" (not ring or Circle),
   its lands' shape column follows, and the shape editor's title and the land editor's Shape
   row both say "Square 2". Confirm the shape row lists the roles its pattern uses.
10. In "with role", pick (none). Confirm `+ Land` adds a land whose Role reads "(none, chain
    anchor)" and whose role column is blank, and that Apply writes no `create_land` for it.
    `+ Shape` stays enabled and makes a shape of points (section 15, item 1).

## 15. Land Placement jitter, points-only shapes and shape origins, 2026-09-28

1. In "with role", pick (none) and press `+ Shape`. Confirm the editor reads "Circle N, 8
   points", the canvas shows eight small points on a ring, and a point can be clicked to open its
   land editor. Apply and confirm the script gains eight coordinate `#const` sets and no new
   `create_land`.
2. On that shape, open "Chained off each point" and add a chained land. Confirm eight lands
   appear, one beside each point, and the title reads "8 lands, 8 points".
3. On a shape with a role, set a slot's role to "(none, points)" and back. Confirm its lands turn
   into points and back, and a dragged land keeps its nudge.
4. Select a shape. Confirm there is an Origin select reading Map centre and no Frame row. Press
   `+ Origin point`. Confirm the shape does not move or turn, the new point is selected, and a
   Frame row reading "radial (turns with the origin)" appears on the shape. Drag the point round
   the centre and confirm the shape turns as it goes. Switch Frame to absolute, drag again, and
   confirm the shape now moves without turning.
5. Pick another shape's land as the Origin. Confirm the shape centres on it. Confirm the select
   never offers this shape's own lands, or a land chained off them.
6. Delete the origin point. Confirm the shape goes back to the map centre without an error.
7. On a Circle, tick "One land per player". Confirm the jitter controls read "Largest safe jitter
   at 8 players is ±22°" at a minimum of 0, and pressing "Add jitter ±22°" shows "Jitter is ±22°,
   drawn per player by JITTER_RING_N". Re-roll a few times with 4 players previewed and confirm
   the players move off even spacing. Switch to "% of the even gap", confirm the amount reads
   ±50% and the button reads "Update jitter".
8. Confirm the JITTER param's "per player" box in Random parameters is greyed out with a tooltip
   naming the shape, and its Delete is disabled. Press Remove jitter and confirm the param is
   gone. Tick jitter back on, then untick "One land per player", and confirm the jitter and its
   param both go.
9. Apply a jittered ring and run it in game at 3 and 8 players. Confirm the players are spread
   around the ring, none overlapping.
10. In a shape's Rotation, type `ROTATOIN + 45`. Confirm an amber warning appears under the box
    while typing, saying no #const is named ROTATOIN, that it is still there after clicking
    away, and that the canvas is blank. Type `45` and confirm the warning and the shapes both come
    back. Add `if TINY_MAP` / `#const R 10` / `endif` to the script, type `R` into a Radius with
    Normal previewed, and confirm the warning names the untaken branch instead. Confirm the
    warning's colour reads in both themes.

---

## 16. Land Placement, a per player shape takes every kind, 2026-09-28 (`land-placement-per-player-any-kind-escalation.md` section 2, widened to Arc and Line by its slices A and B the same day, and deleted by its slice C on 2026-09-29)

1. On a Circle, tick "One land per player". Open the Shape select and confirm every kind is
   offered, none greyed out, and hovering the select shows no tooltip. Pick each kind in turn and
   confirm the canvas redraws that shape, the box stays ticked, and Generated code shows no
   error.
2. Untick "One land per player", pick Square, and confirm the checkbox stays enabled. Tick it
   again and confirm the square stays a square with one land per player.
3. Hover the help for the Shape select and for "One land per player". Confirm both say per
   player works with every shape, with no mention of unticking it first.

---

## 17. Land Placement, a per player arc, 2026-09-28 (`land-placement-per-player-any-kind-escalation.md` slice A)

1. Make a shape, pick Arc, set Sweep to 100 and Rotation to 10, then tick "One land per player".
   Confirm the box stays ticked, the shape stays an Arc, and the canvas draws lands at both ends
   of the sweep.
2. Change the previewed player count in Generation Settings through 2, 3 and 8. Confirm the
   canvas re-spaces every time, with a land at each end of the arc at every count, 3 players at
   the two ends and the middle, and 8 players evenly along it.
3. Add a second slot to the arc's pattern. Confirm that at 3 players the canvas shows 6 lands
   spread over the whole sweep, with no two stacked.
4. On a per player Circle, pick Arc in the Shape select. Confirm it switches without an error in
   Generated code and the box stays ticked.
5. On the per player arc, confirm the jitter controls read "Jitter amount" and "Jitter in", with
   no Min. separation field. Type 15, pick "% of the even gap", and press "Add jitter ±15% of the
   even gap". Confirm the line "Jitter is ±15% of the even gap, drawn per player by JITTER_RING_N"
   appears. Re-roll a few times at 3 players and confirm the lands move along the arc. Confirm a
   Circle's jitter controls still show Min. separation and the computed amount.
6. Hover the help for Jitter amount, Jitter in and the jitter button. Confirm they read sensibly
   for an arc.
7. Apply the jittered per player arc and run the map in game at 3 players and at 8 players.
   Confirm the lands sit along the arc, one at each end within the jitter, and none overlap.
   Remove the jitter, Apply again, and confirm at 3 and 8 players that the lands sit evenly from
   one end of the sweep to the other.

---

## 18. Land Placement, a per player line, 2026-09-28 (`land-placement-per-player-any-kind-escalation.md` slice B)

1. Make a shape, pick Line, set Half length to 30 and Rotation to 0, then tick "One land per
   player". Confirm the box stays ticked and the canvas draws lands from one end of the line to
   the other through the anchor.
2. Change the previewed player count through 2, 3 and 8. Confirm the canvas re-spaces every
   time. At 2 players a land sits at each end, at 3 players at both ends and on the anchor, and
   at 8 players evenly along the line.
3. Select the second land and type 12 into its Radius. Confirm it stays 12 out at every count
   while the other lands keep re-spacing.
4. Try to drag a land of the per player line. Confirm the drag is refused with a message naming
   Radius and Angle.
5. Confirm the jitter controls show "Jitter amount" and the button, with no "Jitter in" choice
   and no Min. separation. Type 30 and press "Add jitter ±30% of the even gap". Re-roll a few
   times at 3 players and confirm the lands slide along the line and never off it.
6. On a per player Circle, press "Add jitter ±22°" at 8 players previewed, then pick Line in the
   Shape select. Confirm the shape becomes a Line with no error in Generated code, and the jitter
   line now reads "Jitter is ±48% of the even gap". Repeat at 4 players previewed and confirm it
   reads ±24%.
7. Hover the help for Jitter amount, the jitter button, the Shape select and "One land per
   player". Confirm each reads sensibly for a line.
8. Apply the jittered per player line and run the map in game at 3 players and at 8 players.
   Confirm the lands sit along one straight line through the centre, the end lands near the two
   ends, and none overlap. Remove the jitter, Apply again, and confirm at 3 and 8 players that
   the lands sit evenly from one end to the other.

---

## 19. Land Placement, a per player square, triangle and polygon, 2026-09-29 (`land-placement-per-player-any-kind-escalation.md` slice C)

1. Make a shape, pick Square, set Radius to 30 and Rotation to 0, then tick "One land per
   player". Confirm the box stays ticked, the shape stays a Square, and the canvas draws lands on
   the square's outline.
2. Change the previewed player count in Generation Settings through 2, 3, 4 and 8. Confirm the
   canvas re-spaces every time. At 4 players one land sits on the middle of each side, and at 8
   they alternate between side middles and corners.
3. Pick Triangle, then Polygon with Sides set to 7, and repeat step 2 at 3 and 8 players.
   Confirm the lands stay on the outline and spread evenly round it.
4. Try to drag a land of the per player square. Confirm the drag is refused with a message
   naming Radius and Angle.
5. Confirm the jitter controls show "Jitter amount" and the button, with no "Jitter in" choice
   and no Min. separation. Type 30 and press "Add jitter ±30% of the even gap". Re-roll a few
   times at 3 players and confirm the lands slide along the outline and never off it. Type 150,
   press "Update jitter ±150% of the even gap", re-roll, and confirm a land sometimes turns a
   corner and still sits on the outline.
6. On a per player Circle, select the second land and add an angle override at 4 players. Pick
   Square in the Shape select, then select the second land again. Confirm the "Angle overrides by
   player count" list shows with a note saying the land takes no jitter at any count, and that it
   has no row for adding another override. Select the first land and confirm it has no such list.
   Add jitter, re-roll at 4 players, and confirm the second land stays put while the others move.
   Press Remove on the override, confirm the list disappears, and confirm the second land now
   moves with the others.
7. On a per player Circle, press "Add jitter ±22°" at 8 players previewed, then pick Square in
   the Shape select. Confirm the shape becomes a Square with no error in Generated code, and the
   jitter line reads "Jitter is ±48% of the even gap".
8. Hover the help for Jitter amount, the jitter button, the Shape select, "One land per player"
   and the angle override list. Confirm each reads sensibly for a square.
9. Apply the jittered per player square and run the map in game at 3 players and at 8 players.
   Confirm the lands sit on the square's outline and none overlap. Remove the jitter, Apply again,
   and confirm at 3 and 8 players that the lands sit evenly round the square, alternating side
   middles and corners at 8.

---

## 20. Land Generation (Comeer) tutorial, 2026-10-06 (`tutorial-islands-design.md`)

Nothing in this tutorial has run in the real app. Every check below is owed against `npm run tauri dev`.

1. Open the Help menu. Confirm "Tutorial: Land Generation (Comeer)" is listed between the Golden Hill
   entry and the app tour, and that its hover help reads sensibly.
2. Start it. Confirm the first step is centred with no spotlight, shows the finished map picture
   under "We are going to make a tournament map, Comeer.", and the picture is not cut off. Confirm
   the preview switches to 1v1 on a Tiny map at once, with the 1v1 preset lit in the generation
   settings, and the seed chip shows 13.
3. Open the console. Confirm there is no warning that the pinned seed no longer passes, and no
   error from the background check. Exit the tutorial in the first second and confirm nothing is
   logged afterwards.
4. Step through to "Start a new script" and complete it, then through the Player Setup and water
   steps. On every step that opens the Add command picker, confirm the callout does not sit over
   the picker.
5. On "One island per player", add the four attributes. Enter `circle_radius` as 16 and 1 in its
   two fields. Confirm the step ticks, and that the islands run to the map edge in the preview.
   On "Does the square count?", confirm the app moves to the Player Setup tab, add
   behavior_version with the value 1, and confirm the islands get visibly smaller and the step
   ticks. Confirm it does not tick while the value is still 0, and that it stays on screen after
   ticking until you press Next. The next step should move back to the Land tab.
6. On the two border steps, confirm the preview shows land about 5 tiles from the edge at 4 and
   about 8 at 7. Press Re-roll before each, then press Next, and confirm the seed returns to 217 on
   the next step that reads the picture.
7. On "Give the number a name", add `#const` from the picker. Confirm it lands at the bottom of
   the section, that the step does not tick, then use Move up to put it above create_player_lands
   and confirm it ticks once all four borders read BORDERS_PL and the value is 10 to 14.
8. On "Let the edges breathe", confirm 9 and 41 do not tick it and 10, 20 and 40 do. Confirm the
   edges look ragged and no land reaches the map edge.
9. Set base_size 16. Confirm the two player islands join into one piece of land in the preview. On
   "Spot the problem" open the hint, then fix it. Confirm 8 to 11 tick the step and 12 does not,
   and that a channel of water is visible between the islands at 10.
10. On every step with hidden numbers, confirm each number is a separate masked bar, that clicking
    one reveals only that number, and that stepping Back then Next hides them all again. Confirm
    the callout moves sensibly when a spoiler opens.
11. Add the first neutral island and shape it. Duplicate it three times from the card menu, set each
    zone and position, and confirm the step ticks only with four different zones. Confirm the four
    islands sit in the corners and do not join the player islands.
12. On "A little chance", wrap base_size or clumping_factor in rnd(). Confirm rnd(7,9) ticks it and
    rnd(1,30) does not. Press Re-roll and confirm the island changes.
13. On "Finish the map", press "Fill in the rest for me". Confirm three sections appear at the end,
    the step ticks, the status bar shows no placement failures, and pressing it again does nothing.
    Run the tutorial a second time and use "I'll write the rest myself", then write the three parts.
14. On the last step, confirm the copy is true. The preview is still 1v1 on a Tiny map.
15. Compare the first step's picture with the preview of the finished map at seed 217. The islands
    and forests should match, though the preview draws objects and the picture does not.
16. On "Box in the neutral island" (2026-10-16), set the neutral island to land_percent 100,
    border_fuzziness 100, right_border 73 and bottom_border 73. Confirm the island is a box whose
    two corners on the right_border side are cut at a slant, one of them against the map edge, and
    whose corner on the left_border side is square. Open "Notice something?" and confirm its hints
    stay masked until clicked, and that closing and reopening it masks them again. Lower
    top_border from -1 one step at a time. Confirm the cut at the map edge shrinks and is gone by
    -8, the other cut stays, and the editor shows a caution on the negative value. Set land_percent
    back to 6 and border_fuzziness to 20. Confirm the step ticks but does not move on by itself,
    and that Next still works with the borders removed instead. On "Four corners" confirm the step
    does not tick while any island is still at 100.

---

## 21. Your first random map, Breakdown or Code, 2026-10-10 (`tutorial-design.md` Sec.9.2)

Nothing in this change has run in the real app. Every check below is owed against `npm run tauri dev`.

1. Start "Your first random map" from the Help menu and complete "Start a new script". Confirm the
   next step is "Breakdown or Code", with both top tabs spotlit, the counter reading 2 / 19, and
   two buttons "Use Breakdown" and "Use Code" where Next would be. Hover each and confirm its help.
2. Press "Use Breakdown". Confirm the next step is "The order of a map" pointing at the section
   tabs, exactly as before this change. Press Back and confirm the choice step returns.
3. Press "Use Code". Confirm the app switches to the Code tab and "The order of a map" shows the
   seven headers as a boxed block in a fixed width font, line breaks kept.
4. On each Code typing step, confirm where the callout sits. It should land bottom right. Confirm
   it does not cover the lines being typed at the top of an empty file, and that minimize (section 26) shrinks it out of the way. If it covers the side panel's preview at "Watch it appear", note it.
5. Type the text each step asks for. Confirm each step ticks and moves on by itself, including when
   the text is typed in a different order or with different indentation.
6. On "A hill in the middle", confirm a red underline appears under base_elevation and its hover
   explains the missing elevation section. On "Hills", confirm it clears as soon as the
   `<ELEVATION_GENERATION>` header is typed.
7. On every step with an Answer, open it. Confirm the code keeps its indentation, a long line
   scrolls inside its box rather than widening the callout, and the callout re-places itself.
8. On "Everyone else's resources", press "Add them for me". Confirm the four blocks appear in the
   editor and the step ticks.
9. Confirm "The same map as cards" switches to Breakdown on the Objects tab with every typed block
   showing as a card, and the next step switches back to Code.
10. Finish the Code track. Confirm the last step shows the Discord link and Finish, and that the
    tutorial is then marked complete. Start it again from Help and confirm it begins at step 1 and
    the choice is asked again.

## 22. Land Generation (Comeer), Breakdown or Code, 2026-10-14 (`tutorial-design.md` Sec.9.2)

Nothing in this change has run in the real app. Every check below is owed against `npm run tauri dev`.
Section 20 is still owed too, and covers the Breakdown track.

1. Start "Land Generation (Comeer)" from the Help menu, pass the picture and complete "Start a new
   script". Confirm the next step is "Breakdown or Code", the counter reads 3 / 20, and the two
   buttons replace Next.
2. Press "Use Code". Confirm the app switches to the Code tab and "Player Setup" spotlights the
   editor. Press Back, pick "Use Breakdown", and confirm the app switches back to the Breakdown tab
   on Player Setup with Add command spotlit.
3. Back again, pick "Use Code", and type each step's text. Confirm every check step ticks by itself.
4. On every step with a script Answer (Player Setup, base_terrain, One island per player, Name a
   value once, A neutral island), open it and confirm the indentation is kept and the callout
   re-places itself.
5. On "Name a value once", type the `#const` BELOW create_player_lands first and confirm the step
   does not tick, then move it above and confirm it does.
6. On "A little chance", type `rnd(7, 9)` with a space and confirm the step does not tick, then
   remove the space and confirm it does.
7. On "Spot the problem", confirm the preview is spotlit while the Code tab is showing.
8. On "Finish the map", press "Fill in the rest for me" and confirm the three sections appear at the
   end of the editor text and the step ticks.
9. On each Code typing step, note whether the callout covers the lines being typed or the preview.
   9a. On "Does the square count?" in Code, type behavior_version 1 under random_placement. Confirm
   the islands shrink and the step ticks, and that it waits for Next.
10. Remembered seed. With the app closed, set `PINNED_COMEER_SEED` to 1 (a seed that fails) in
    `comeerValues.ts`, start the app and the tutorial, and wait about 30 seconds. Confirm the
    console warns that seed 1 no longer passes and a found seed is saved, and that
    `settings.json` now holds `tutorialComeerSeed`. Restart the tutorial and confirm the console
    says it is using the saved seed, with no long wait. Put the seed back to 217, restart, and
    confirm `tutorialComeerSeed` is gone from `settings.json`.

---

## 23. Team Positions setting and the DE-exact lands, 2026-10-14 (`preview-design.md` rev 9)

1. Open Generation Settings from the preview pane. Confirm a ticked "Team Positions" checkbox sits
   in the top row beside Player count and Map size, its HelpTip shows, and clicking the words
   toggles it.
2. With a 2v2 preset, untick it and confirm the player lands move. Tick it again and confirm they
   return to the same places at the same seed.
3. Untick it, close the app, reopen, and confirm it is still unticked. Tick it again before going on.
4. Open a corpus map that branches on `TEAM_POSITIONS` (for example `AK_Vanguard_v1.2.rms`) and
   confirm the preview changes when the box is toggled.
5. Run the Generation Consistency Checker once with the box ticked and once unticked, and confirm
   both runs complete.
6. Optional, against the game. Generate any land-only script in DE's scenario editor at a typed
   seed with Team Positions ticked, set the same seed, players and teams in the preview, and
   compare the lands. Note the map size used, since only Tiny has been measured.

---

## 24. DE-exact hills and cliffs, 2026-10-19 (`preview-design.md` rev 10)

1. Open a script with `<ELEVATION_GENERATION>` and `<CLIFF_GENERATION>` (for example
   `AK_Vanguard_v1.2.rms` or Comeer's finished script) and confirm the preview renders without a
   stall, with hills shaded and cliffs marked.
2. Re-roll a few times and confirm hills and cliffs move with the seed, and that the same seed gives
   the same picture twice.
3. Hover the approximate badge, the seed chip and Team Positions, and confirm their HelpTips say
   lands, hills and cliffs match the game.
4. Open the Comeer tutorial and confirm its first picture loads.
5. Optional, against the game. Copy one of the probe scripts in
   `src/preview/__tests__/fixtures/de-elevation-cliff-maps.json` (its `scripts` list), generate it in
   DE's scenario editor at a typed seed, Tiny, 2 players, set the same in the preview, and compare
   the hills and the cliff lines.

---

## 25. The base_layer warning and hidden warnings, 2026-10-19 (`parser-design.md` RMS0318)

Script for every step, in a saved file:

```
<LAND_GENERATION>
base_terrain DESERT
base_layer SNOW
<ELEVATION_GENERATION>
create_elevation 2 { base_terrain DESERT }
```

1. In Code, confirm a warning squiggle on `base_layer`. Hover it and confirm the message names line 5,
   with "Ok" and "Don't show me this again" links under it. Do the same with Help set to Off in
   Preferences, and confirm the links still show.
2. Click "Ok". Confirm the squiggle and the status bar count go, and that Breakdown's card for
   `base_layer` loses its badge. Open a second file with the same script and confirm it still warns
   there. Close and reopen the app, and confirm the first file still has no warning.
3. In Breakdown on the second file, hover the `base_layer` card's warning badge, move the pointer into
   the popup, and confirm it stays open and both buttons and their HelpTips work. Click "Don't show me
   this again" and confirm the warning goes in both files.
4. Open Settings, Diagnostics. Confirm the warning is listed under "Warnings turned off" and that
   "Show them again" says one file has a warning hidden. Click "Turn back on" and confirm the warning
   returns in the second file only, then "Show them again" and confirm it returns in the first.
5. Add `base_layer SNOW` to the `create_elevation` block and confirm the warning goes by itself.

---

## 26. Minimizing and dragging the tutorial card, 2026-10-20 (`tutorial-design.md` Sec.5.2)

Replaces "Move this out of the way". Run against "Your first random map" and the app tour.

1. On the first step, which has no anchor, confirm the card's top row shows a grip, the step
   counter and a minimize button. Hover the grip and the button and confirm each HelpTip.
2. Press minimize. Confirm the card becomes a one line bar in the bottom right corner, naming the
   step, with Next and a restore button, and that the spotlight and dimming go. Press restore and
   confirm the card comes back where it was.
3. On a typing step, open an Answer, minimize, type the answer, and confirm the bar shows a tick.
   Confirm the step moves on and opens full size. Go Back, open the Answer, minimize, restore, and
   confirm the Answer is still open.
4. On the choice step "Breakdown or Code", minimize and confirm the bar has no Next.
5. In the app tour, on "Resources and problems", minimize. Confirm the bar sits just above the
   status bar and does not cover the resource totals or the problems triangle.
6. Drag the card by its top row to the left side. Confirm it follows the pointer without selecting
   text, and that it cannot be dragged off screen. Press Next and confirm the next card opens in the
   same spot, unless it would cover what that step points at, in which case it goes beside it.
7. Minimize, drag the bar to the top of the window, and restore. Confirm the card returns to its
   own dragged spot. Minimize again and confirm the bar returns to where it was dragged.
8. Exit the tutorial and start it again. Confirm the card and the bar are back to their automatic
   places.

---

## 27. Breakdown feedback fixes, 2026-10-20 (`breakdown-design.md` Sec.3.3, 3.9, 3.11)

Four fixes from the October beta feedback. Run against any map with several commands, for example
the "Your first random map" result. Open the Breakdown tab with a few command cards.

1. Focus after an edit. Open a `create_land` card with `land_percent` followed by other
   attributes. Click into the `land_percent` value, change `30` to `100`, then click straight into
   the next value below it. Confirm the caret stays in the second field and you can keep typing.
   Repeat with the second field in a different card further down the list. Repeat once clicking
   into a field in a card above the edited one. Before the fix the caret appeared and vanished.
2. Focus stays put when you click away. Edit a value, then click empty space between cards.
   Confirm nothing is focused afterwards and the edit is kept.
3. Delete a comment. Add a comment (Add Comment), type some text, then press its trash button.
   Confirm the comment goes and the lines around it close up. Hover the button and confirm the
   HelpTip. Press Ctrl+Z and confirm the comment returns.
4. Delete a comment mid edit. Click into a comment, type a few words without clicking away, then
   press its trash button. Confirm it deletes on the first press and does not need a second.
5. Delete a comment on a command line. In the Code tab, write `create_land /* note */ { }` style
   input where a comment follows code on the same line, switch to Breakdown and delete it. Confirm
   the code on that line is untouched.
6. Delete key. Click a command card's header, then press Delete. Confirm the card is removed and
   Ctrl+Z restores it. Repeat after clicking a value field inside the card, then clicking the card
   header. Confirm Ctrl+Alt+D still works too.
7. Delete key stands down while typing. Click into a value field and press Delete a few times.
   Confirm it edits the field and no card is removed. Do the same inside a comment's text box and
   inside the Add Command search box.
8. Hold Delete with a card selected. Confirm only the one card is removed, not its neighbours.
9. Collapse during a drag. Open three or four command cards. Press on one card's header and drag
   a few pixels. Confirm every command card closes to its one line header while the drag is
   running and the dragged card is dimmed. Drop it between two others and confirm the same cards
   that were open before are open again, the moved card included.
10. Cancel a drag. Open some cards and leave one closed. Start a drag, press Escape, and confirm
    the open cards reopen and the closed one stays closed.
11. A plain click on a card header must not close the others, only a drag does.
12. Drag with a comment card. Start the drag from a comment card and confirm the command cards
    close the same way, then reopen on drop.
13. Hide Unused. Turn Hide Unused on, open a card, tick a flag so it shows, then drag any card and
    drop it. Confirm the reopened card still shows the slots it showed before the drag.
14. Watch the scroll position while the cards close. Note where the list lands after a drop and
    report it if the dragged card ends up out of sight.

---

## 28. The cleanup note, 2026-10-20 (`preview-design.md` Sec.6.1 rule 11, Sec.6.4)

Script for every step, in a saved file:

```
<LAND_GENERATION>
base_terrain WATER
create_land { terrain_type DESERT land_position 99 0 base_size 0 land_percent 0 }
```

1. Set the map size to Large. Open the preview's Notes drawer and confirm one S1 line reads
   "Cleanup turned 1 tile into WATER (DESERT 1) because it sat between WATER tiles, erasing the
   land on line 3. This shows because the terrain class changed, but the cleanup runs on every
   map." Confirm no sand shows in the top corner of the map.
2. Set the map size to Tiny. Confirm the cleanup line is gone from the drawer and a single tile of
   land shows in the corner (the beach pass repaints it as beach).
3. Change `base_terrain WATER` to `base_terrain GRASS`, still on Large. Confirm the desert tile is
   gone and no cleanup line shows, since DESERT and GRASS are both land.
4. Change `terrain_type DESERT` to `terrain_type DLC_ROCK` with the GRASS base. Confirm the line
   comes back as "Cleanup turned 1 tile into GRASS (DLC_ROCK 1) because it sat between GRASS
   tiles, erasing the land on line 3." followed by the same closing sentence.
5. Back on the WATER base, change `land_percent 0` to `land_percent 6`. Confirm the land grows and
   any cleanup line no longer says a land was erased.
6. Open a water map from the corpus (for example Comeer's finished script) and read the cleanup
   line, if one shows. Confirm it reads as one short entry in the drawer at the usual pane width.
7. Optional, against the game. Generate the WATER script above in DE's scenario editor on Large and
   on Tiny and confirm the land is missing on Large and shows in the corner on Tiny.

---

## 29. Preview pane polish, 2026-10-20 (`preview-design.md` Sec.4)

Open any map with a few lands in the Breakdown tab. Run `npm run tauri dev`.

1. The map fills the panel. On the Preview tab confirm the map takes all the height below the
   controls row, with nothing underneath it and no grip or handle on its bottom edge. Resize the
   app window taller and shorter and confirm the map grows and shrinks with it, refitting itself
   unless you have zoomed or panned.
2. Width does not need height. Drag the side panel's left edge much wider, then much narrower.
   Confirm the map box keeps filling the height, the map stays a square on its corner (a
   diamond), and empty bands fill the spare space to its left and right, or above and below when
   the panel is narrower than it is tall.
3. Short window. Make the app window very short and confirm the map stops shrinking at a small
   minimum and the Preview tab scrolls instead of squashing the map.
4. Old settings. If the settings file still holds a `previewCanvasHeight` from an earlier build,
   confirm the app opens normally and ignores it.
5. Zoom and pan stay. Zoom in, pan, then resize the window. Confirm the zoom is kept and only
   the visible window changes. Double click the map and confirm it refits inside the box.
6. Tabs. Confirm the panel has a Preview tab and a Reference tab at the top, and the divider bar
   between the two panes is gone. Click Reference and confirm the table fills the whole panel.
   Click Preview and confirm the map is back with the zoom and pan it had.
7. Tabs keep their state. On Reference, pick Preview Obj. List, type a search and untick one
   object. Switch to Preview and confirm that object is gone from the map. Switch back and
   confirm the list, the search text and the unticked box are as you left them.
8. Tab keys. Focus a tab and press Left or Right. Confirm the other tab opens and keeps focus.
9. Tab is remembered. Choose Reference, switch to the Code tab and confirm the panel there also
   shows Reference. Restart the app and confirm it still does.
10. Tutorials. Start the app tour from the Help menu with Reference showing. Confirm the preview
    steps switch to Preview on their own, and the reference table step switches to Reference.
    Start the Land Generation (Comeer) tutorial with Reference showing and confirm its first
    preview step switches to Preview.
11. Side names. Confirm Left, Bottom, Right and Top sit just OUTSIDE the four sides of the
    diamond, in the empty space around it, never over the map. Each runs parallel to its side
    and reads upright, in white with a dark outline. Left is the lower left side, Bottom the lower
    right, Right the upper right and Top the upper left. Add `left_border 20` to a land with
    `land_percent 100` and confirm it is cut off along the Left side.
12. Axis arrows. Confirm a white "x" arrow beside the upper left side, near the leftmost corner,
    pointing up and to the right, and a white "y" arrow beside the lower left side pointing down
    and to the right. Both are outside the map, run parallel to their side, and have no colour.
    Add a land with `land_position 0 0` and confirm it grows from the leftmost corner. Change it
    to `land_position 100 0` and confirm it moves to the topmost corner, the way the x arrow
    points. Change it to `land_position 0 100` and confirm it moves to the bottommost corner, the
    way the y arrow points.
13. Aids at small sizes. Shrink the box until the map is about 240 px across and confirm the side
    names go first while the arrows stay. Shrink it further and confirm the arrows go too instead
    of crowding. Zoom right in and confirm they stay with their sides and simply scroll out of
    view. Pan the map toward a canvas edge and confirm a label that ends up over the map is still
    readable.
14. Export. Click Export and confirm the saved PNG includes the side names and arrows.
15. Land Placement panel. Open the Advanced Tools tab, choose Land Placement and confirm its
    canvas shows the two white arrows outside the map and no side names. Confirm the arrows do
    not get in the way of dragging a land circle near the leftmost corner.
16. Map size picker. Open Generation Settings from the cog in the preview controls. Confirm the
    Map size list reads Tiny (120), Small (144), Medium (168), Normal (200), Large (220), Huge
    (240), Giant (252), and that picking one changes the map to that many tiles across (the
    "200×200" line under the badge matches).
17. Help tips. Hover both tabs and the map size list and confirm each shows a tip.
18. Bottom row of the map. Confirm the map's bottom edge has one row holding, from the left, the map
    size chip ("200×200, 6 players"), then on the right the placement notice, a "?" button, Notes
    (n), Legend, Export and the three zoom buttons. On a narrow panel the row may wrap onto a
    second line, with the three zoom buttons staying together. Drag the panel narrower and confirm the map size chip shares its line with as many buttons as fit, rather than sitting alone. Confirm there is no
    "Approximate preview" chip anywhere on the map, and the map size chip is not in the top left.
19. Help button. Confirm the line of hint text under the map is gone. Click "?" and confirm a box
    opens over the bottom of the map, above the row, as a single line of text that reads
    "Click a tile to pin · drag to pan · wheel to zoom · double-click to fit" (it may wrap onto a
    second line on a narrow panel). Click "?" again and confirm it closes.
20. Notes and Legend. Click Notes and confirm the box shows the notes and failed placements, and
    that "?" and Legend give way to it (only one box is open at a time). Click Legend and
    confirm the terrain swatches. Click the open button again to close it. Confirm a long list
    scrolls inside the box and the box never covers more than about the lower 60 percent of the
    map.
21. Panning under the box. With a box open, drag on the map above the box and confirm it still
    pans. Wheel over the box and confirm it scrolls the box and does not zoom the map.
22. Placement notice. Open a script with failed placements and confirm the notice reads "N
    placements failed" in red beside "?". Open one with none and confirm it reads "N placed" in
    green. Hover it and confirm its tip.
23. Tile readout. Hover a tile and confirm its details appear in a box over the map's top left
    corner, and that the map does not resize or jump as the box comes and goes. Move off the map
    and confirm the box disappears. Click a tile and confirm the box stays with a Clear button
    that works, and that a tile with several objects scrolls inside the box instead of covering
    the map.
24. Tutorial. Run the app tour to the Notes step and confirm it spotlights the Notes button on the
    map without asking you to scroll.
25. Scroll chaining. Open Notes with enough content to scroll, scroll to its bottom and keep
    scrolling. Confirm nothing else on screen moves. Do the same in the Reference tab's list, in a
    pinned tile's readout with many objects, and on the Preview tab in a very short window.
    Confirm the whole window never scrolls or bounces.

---

## 30. Tutorial spoilers, minimize line and the Golden Hill picture, 2026-10-20 (`tutorial-design.md` Sec.4.2)

Run `npm run tauri dev`, against "Land Generation (Comeer)" for the spoilers and "Your first random
map" for the picture.

1. Hidden words. On a Comeer step with a hidden number in a sentence, click the bar and confirm the
   number shows. Click the number and confirm it turns back into a bar the same width, with the
   sentence not moving. Reveal it again with the keyboard (Tab to it, Enter).
2. Dropdown spoilers. Open one, click its label again, and confirm it closes on that single click.
3. Remembering. Reveal a hidden number and open a dropdown on one step, press Next, then Back.
   Confirm both are still open. Confirm the next step's own spoilers are shut, and that a
   dropdown with a hidden word inside it still shows that word after closing and reopening the
   dropdown.
4. Restarting. Exit the tutorial from the Help menu, start it again, and confirm every spoiler is
   shut on every step.
5. Minimize. Confirm the minimize line in the card's top row is clearly visible in both themes,
   about as heavy as the restore square, and that hovering it still shows its HelpTip. Compare
   with the bar's restore button to confirm the two read as a pair.
6. Golden Hill picture. Start "Your first random map" and confirm the first step shows a map with
   a dirt hill in the middle, a road between two players, forest patches, a cluster of gold on the
   hill and small food, stone and gold circles near each player, below the line about the hill.
   Confirm no grey dots (units and buildings) are in it. Confirm the card is not so tall that it
   covers the File menu when it opens, and that the picture is sharp enough to read at the card's
   width. Open the preview on the finished script with 2 players, Tiny, no teams and seed 1 and
   confirm it looks like the picture.
7. Comeer picture. Open "Land Generation (Comeer)" and confirm its first step shows the two player
   islands, four neutral islands and the resource circles, many of them white fish dots in the water,
   and no grey dots. Confirm no object has a coloured ring (a dark ring only). Confirm the picture reads clearly at the card's width.
8. Gold on the hill. In "Your first random map", reach "Gold on the hill" in both the Breakdown and
   the Code track. Confirm the text asks for max_distance_to_players 10 and explains that
   place_on_specific_land_id only sets where to measure from. Add the GOLD without the distance and
   confirm the step does not complete, then add it and confirm it does. Regenerate the preview a
   few times and confirm the gold stays in the middle of the hill.

---

## 31. Add Template dialog, None options, resource piles and columns, 2026-10-20 (`object-templates-brief.md`)

Run `npm run tauri dev`, open a script, go to Breakdown > Objects generation and press Add Template.

1. Columns. Pick each of the five templates (Terrain generation tab for the terrain forests) and
   confirm every parameter's control sits right after its own title, with the options flowing into
   two or three columns and no control pushed to the far edge. Confirm the "Name or id" box that
   appears under a Custom... choice sits in the grid and the red problem list spans the full width.
2. Ownership. On Standard player resources confirm the preview shows set_gaia_object_only in every
   block except the two close herds marked "owned by the player". Confirm the Sheep part is one
   if QUICK_START / else / endif. Its if branch holds three owned sheep at 5 to 6 tiles and one
   gaia pair, its else branch one owned sheep, three gaia sheep beside it and two gaia pairs. On
   Standard player objects confirm no block has the line. Pick Horse in the Scout dropdown and
   confirm the last block becomes create_object HORSE.
   Insert the resources template alone into a script with no QUICK_START and generate a map. Each
   player should have one owned sheep with three gaia sheep beside it, plus two pairs further out.
   Then insert Standard player objects with Quick-start ticked (it adds the #define), regenerate
   and confirm each player has the eating sheep under the town center, three owned sheep at 5 to 6
   tiles and one gaia pair. Delete the #define and confirm the standard herd comes back.
3. None. Set Berry type, Herdable, Huntable and Lurable to None in turn and confirm the matching
   blocks (and the Sheep, Deer or Boar comment) leave the preview. Tick Seasonal variation and
   confirm each of the four then offers only "Seasonal (...)" and None. Set all four to None and
   untick all four piles and confirm Insert is disabled with a sentence saying why.
4. Piles. Confirm the four piles start at 7, 4, 5 and 4. Untick Small gold and confirm its block
   goes and its Amount box greys out. Type 0, then "x", in an Amount and confirm the box turns red,
   the problem list names the pile and Insert is disabled. Type 9 and confirm "number_of_objects 9".
   4b. Quick-start switch. On Standard player objects tick Quick-start and confirm the preview opens
   with a "Goes in the header of the file" part holding #define QUICK_START, then the block with
   the sheep, villagers and houses inside if QUICK_START and three plain villagers under else.
   Insert it into a script that has a PLAYER_SETUP and confirm the #define lands in the header
   above the first section, not in PLAYER_SETUP, and the caret lands on the TOWN_CENTER block.
   Generate the preview and confirm the quick-start villagers appear. Delete the #define line,
   regenerate and confirm each player now has three villagers. Open the dialog again on the same
   script, tick Quick-start, and confirm the preview no longer shows a header part.
   4c. find_closest. Insert both templates, generate a map and confirm each player's gold, stone,
   berries and animals sit at the near edge of their distance ranges, the same for every player,
   and the scout and starting villagers are placed without overlapping anything.
5. Insert. Insert a block with a mix of None and unticked piles. Confirm the caret lands on the
   first remaining command and the script shows no diagnostics.
6. Forest tree. On Player forests (Objects generation) confirm Tree offers None first. Choose it,
   confirm second_object leaves the preview and Insert still works. Choose Custom..., clear the box,
   and confirm it reads as None, not as an error.
7. Help tips. Hover each new control (Scout, the four pile checkboxes, Amount, the
   Berry, Herdable, Huntable and Lurable dropdowns, Tree) and confirm a sentence appears.

## 32. Argument tips and inline code, 2026-10-20 (`src/components/InlineCode.tsx`, `src/breakdown/helpText.ts`)

Run `npm run tauri dev`, open a script and go to Breakdown with Help Tips on.

1. Argument tips. Expand a `create_player_lands` card, add `border_fuzziness` and hover its value box.
   Confirm the tip reads "100 sticks closest to the borders, and 0 respects them least. Range 0–100.
   Default 20." and not the old sentence about committing on Enter.
2. Two-slot attribute. Add `circle_radius` and hover each box. The first tip is the radius
   description and range, the second starts "Argument variance."
   Also hover `base_size` (square width 2*base_size + 1, circle radius base_size),
   `generate_mode` (0 keeps lands out of the corners, 1 allows them) and `zone`. Each should fit a
   tip popup without scrolling or running off screen.
3. No filler. Hover a value box whose reference data has no description, range or default (a
   constant slot with none of the three). Confirm no tip appears at all. A slot with only a default,
   such as `terrain_type`, shows just "Default GRASS."
4. Command arguments. Add `create_elevation` and hover each positional argument's name and its
   value box. Both show the same specific sentence, or neither shows one.
5. Summary click. With Settings > Breakdown > Summary click set to edit, click an attribute in a
   collapsed card's summary and hover the inline box. Same tip as the expanded row.
6. Inline code. Hover Add Command, the Notes drawer and any tip that names a command. Confirm names
   such as `create_land` and `TEAM_POSITIONS` sit on a faint tinted chip in a monospace face, upright
   even inside the italic tip. Check Light and Dark. The chip must read in both.
7. Other surfaces. Confirm the same chip appears in the tutorial body and hint, a preview banner
   note and the Notes drawer, the Command Picker and Add Attribute lists, the reference table's
   description column and a diagnostic popup.
8. Plain words stay plain. Confirm ordinary words (zone, RMS, a file name such as `my_map.rms`) are
   not chipped. A revealed tutorial spoiler stays plain text on purpose.

---

## 33. Breakdown view scope, 2026-10-21 (`breakdown-design.md` Sec.3.1.1)

Run `npm run tauri dev` with Help Tips on and open a script that has Land, Terrain and Objects
sections plus at least one empty canonical section (Elevation, say).

1. Default. Start the app fresh and open Breakdown. Only the Header tab is ticked, every other tab
   name is faded, and the list looks as it did before this change (no section headings, no
   "Header:" label on the Add bar).
2. Checkbox placement. Each tab has a small checkbox in its top right corner. Confirm it never
   covers the count or problem badge, in light and dark themes, and with the window narrow enough
   that the tabs wrap onto two rows.
3. Tick Land and Objects, untick Header. Confirm the list shows Land then Objects, each under a
   heading with its number and count, the faded tabs are the others, and the Add bar reads
   "Land:" or "Objects:".
4. Focus follows the card. Click a card in Objects. The Add bar reads "Objects:" and the Objects tab
   is highlighted. Click a card in Land. It reads "Land:". Press Add command and confirm the new
   card lands right after the selected Land card.
5. Empty section. Tick Elevation. Confirm its heading shows with "Nothing here yet." under it. Click
   the heading, confirm the bar reads "Elevation:", then Add command and confirm the command lands
   in Elevation (a new `<ELEVATION_GENERATION>` section in the Code tab if there was none). Repeat
   by clicking the "Nothing here yet." text instead of the heading.
6. Empty space. Click the gap between two cards inside the Objects group. Confirm the selection
   clears and the bar reads "Objects:".
7. Tab click on a shown tab scrolls the list to that section's heading without unticking anything.
   The heading must not hide under the sticky Add bar.
8. Tab click on a faded tab shows that section alone, as tabs always did.
9. Last tick. With one section shown, its checkbox is greyed and cannot be cleared.
10. Show all. Press Show all at the right end of the tab row. Every section shows, the button reads
    Show one, and pressing it goes back to only the section in focus.
11. Remembered for the session. With Land and Objects shown, switch to the Code tab and back, then
    open a different script. Confirm Land and Objects are still the shown set. Restart the app and
    confirm it is back to Header only.
12. Code tab cursor. With Land and Objects shown, put the Code tab cursor inside a Terrain command
    and switch to Breakdown. Confirm Terrain is added to the shown set, scrolled to, and the card
    selected.
13. Ctrl+Tab. With three sections shown, Ctrl+Tab steps the focus through those three only (the bar
    label changes). With one shown it switches tabs as before.
14. Drag stays in its section. In the stacked view, drag a Land card over an Objects card. No drop
    line appears and releasing does nothing. A drag within Land still works.
15. Diagnostics ruler. With several sections shown, confirm a tick appears for problem cards in
    every shown section and clicking one scrolls to its card.
16. Tutorials. Run the first steps of "Your first random map". Every step that switches section
    must land on the right section, with the bar naming it.

---

## 34. Inline comments on a command's row, 2026-10-21 (`breakdown-design.md` Sec.3.3.2)

Open Breakdown with Help Tips on.

1. Code to Breakdown. In the Code tab write `create_land /* top left island */` followed by its
   `{ }` block, switch to Breakdown and confirm the comment shows on the card's header row right
   after the name, between faint `/*` and `*/`. Hover it for the HelpTip.
2. Edit. Click the comment, change it to `bottom right`, press Enter. Confirm the Code tab line
   reads `create_land /* bottom right */` and nothing else on it moved. Repeat committing by
   clicking away. Press Escape mid typing and confirm the old text comes back with no edit.
3. Delete. Press the × beside it. Confirm the line goes back to `create_land` with no trailing
   space, and Ctrl+Z restores the comment.
4. Add. Hover a command row with no inline comment. A faint `/* */` button appears at the end of the
   name. Press it, type `note`, press Enter, and confirm `create_land /* note */` in the Code tab.
   The button must not be clickable when the row is not hovered.
5. Arguments. On `create_terrain FOREST`, add a comment and confirm it lands after `FOREST`. In the
   Code tab write `create_terrain /* c */ FOREST` and confirm the row shows `c` and editing keeps it
   between the name and `FOREST`.
6. No block. On `random_placement /* r */` in Player Setup, confirm the comment shows on the row
   and NOT also as a separate comment card below it. Delete the card and confirm the comment goes
   with it.
7. Add after. Select that `random_placement` card and use Add command. Confirm the new command goes
   on the next line and `/* r */` stays on `random_placement`'s line.
8. Multi-line. Write `create_land /* one` with `two */` on the next line. Confirm the row shows the
   text read only (no field), with its × still working.
9. Bad text. Type `a */ b` into the field and press Enter. Confirm the inline error and no edit.
10. Collapsed and expanded. Confirm the comment shows and edits the same with the card open or
    closed, and that clicking the field never starts a card drag.

---

## 35. Multi-select cards, 2026-10-21 (`breakdown-design.md` Sec.3.12)

Open a script with several cards in one section, including an `if` with commands inside.

1. Ctrl+click two cards that are not neighbours. Both show the selected accent. Ctrl+click one of
   them again and confirm only that one clears.
2. Shift+click. Click a card, Shift+click one four cards below. Confirm the run between them is
   selected, and that no page text is highlighted by the Shift+click. Shift+click one above the
   first card and confirm the run flips upward from the same first card.
3. Plain click on a card in the selection selects only that card.
4. Shift+click from a top level card onto a command inside the `if`. Confirm the run reaches the
   `if` card and the whole `if` block is selected. Then click a command inside the `if` and
   Shift+click a top level card below the `endif`. Confirm the run starts at the `if` card.
5. Other section. With the stacked view showing two sections, select two cards in one, then
   Ctrl+click a card in the other. Confirm the selection restarts there and the Add bar label moves.
6. Delete. Select three cards and press Delete. All three go. Press Ctrl+Z once and confirm all
   three come back together. Repeat with Ctrl+Alt+D, and with the card menu, whose entry reads
   "Delete 3 cards" and whose Duplicate, Move up and Move down are greyed.
7. Delete an `if` and a command inside it together. Confirm the whole `if` goes and nothing else.
8. Drag. Select the first and third card of a section, press on one of them and drag. Both dim.
   Drop below the last card and confirm both land there in their original order, still selected,
   and any that were open are open again. Ctrl+Z once puts both back.
9. Drag into a branch. Drag two selected top level cards into the `if`'s branch and confirm they
   take the branch's indent in the Code tab.
10. Drag an unselected card while others are selected. Only that card moves and the selection
    becomes that card.
11. Alt+Up and Alt+Down with several selected do nothing. With one selected they move it as before.
12. Code tab. With several selected, switch to Code, move the cursor and switch back. Confirm the
    selection is now the single card under the cursor.
13. Fast deletes. Select two cards, Delete, then quickly select and delete two more before the
    list settles. Confirm nothing else in the file changed.

---

## 36. Tutorial step kinds, the spoiler warning and the island diagram, 2026-10-22 (`feedback/2026-10-comeer-feedback-sessions.md` session 1)

Run `npm run tauri dev` and start "Land Generation (Comeer)". Do items 1 to 5 in the light theme,
then switch to the dark theme in Theme Settings and repeat 1, 3 and 4.

1. Chip. On "Player Setup", confirm a green outlined chip with a hammer and the word Build sits
   before the title, and a green 3px stripe runs down the card's left edge. On "Does the square
   count?", confirm a blue chip with a magnifying glass and the word Investigate, and a blue stripe.
   Confirm both icons are crisp at the chip's size and the word is easy to read. On "Comeer, a
   tournament map", "Start a new script", "Breakdown or Code" and "You made Comeer", confirm there
   is no chip and no stripe.
2. Help mode. Turn help mode on and hover each chip. Confirm one short line explains it.
3. Minimized bar. Minimize a Build step and an Investigate step and confirm the bar keeps the
   stripe in the same colour, and that a step with no kind has no stripe.
4. Warning. On "Box in the neutral island", confirm a warning triangle in the warning colour sits
   before "Notice something?", spaced from the label, and that the other spoilers have none.
5. Diagram. On "Fixing the island-joining problem", confirm two diamond maps sit side by side
   under the first paragraph. The left pair of squares is one above the other with a small red
   diamond where their corners overlap. The right pair is lined up along an edge with water
   between. Confirm the dashed ring shows over the squares in both, and that the card is wide
   enough to read both pictures. Compare the left picture with the preview at the pinned seed
   ("Spot the problem" with land_percent 0) and confirm the players are lined up the same way.
   In the dark theme, confirm the water, squares, ring and red overlap all still read.
6. Code track. Back to "Breakdown or Code", pick Code, and confirm the same chips show on the Code
   steps, and that the diagram shows on the Code twin of step 15 inside the editor corner.
7. Wording. Read step 14's "What happened" and step 15's paragraph under the diagram. Confirm
   neither says "diagonal" and both describe the players as lined up one above the other, or side
   by side.

---

## 37. Diagnostics and highlighting latency trace and its two fixes, 2026-10-22 (`docs/diagnostics-latency-report.md` Sec.7, Sec.8)

Run `npm run tauri dev`. Open the developer tools with Ctrl+Shift+I, run
`localStorage.setItem("aorms.perfTrace", "1"); location.reload();` in the Console and filter it by
`[perf]`. Note the CPU load in Task Manager first.

1. Trace off by default. Before setting the flag, type in the Code tab and confirm no `[perf]`
   line appears.
2. Highlighting. On the Code tab open `test-maps/new_map.rms`, then `AK_Vanguard_v1.2.rms`, and
   read `after file open, first highlighted tokens painted` for each. Switch to Breakdown and back,
   and read `code editor mounted` and `after editor mount, first highlighted tokens painted`.
   Restart the app and repeat once.
3. Squiggles. With Vanguard open, type one character at a line's end and wait two seconds. Read
   every line from `parse #N sent` to `squiggles painted`, the `react update (app)` lines
   included. Five times, then the same on `new_map.rms`.
4. Typing lag. On Vanguard type a word at normal speed and note any `LONG TASK` and
   `react update` lines.
5. Errors ahead of the tree (report Sec.7 fix 1). On Vanguard type one character. Confirm
   `parse #N diagnostics back` prints before `parse #N back` for the same N, and that the squiggles
   paint before the tree arrives, about 120 ms against about 315 ms. On `new_map.rms` confirm only
   `parse #N back` prints, since a small file still sends one message.
6. Superseded trees. On Vanguard type a whole word quickly. Some `tree superseded, dropped unread`
   lines should print, each with no `main thread unpack` cost above a few ms. When typing stops,
   the squiggles sit on the right lines of the final text. Switch to Breakdown and confirm the cards
   match the code, which shows the last tree was kept.
7. Short debounce (fix 2). On `new_map.rms` delete a closing `}`. The squiggle should appear with no
   pause you can see. Put it back and confirm the squiggle clears just as fast. Vanguard is over
   50,000 characters, so it keeps the 150 ms wait.
8. Save the console into `RMS/test-outputs/` and name the file in the reply. Turn the trace off
   with `localStorage.removeItem("aorms.perfTrace"); location.reload();` and confirm the lines
   stop.

---

## 38. Code tab autocomplete, the green flash and the #const offers, 2026-10-22 (`docs/name-lookup-design.md` slice B)

Run `npm run tauri dev`, open the Code tab and start a new script with a `<LAND_GENERATION>`
section.

1. Suggestions. On a new line type `create_` and confirm the list shows commands valid in the
   section, and only those. Inside `create_land { }` type `terr` on a new line and confirm
   `terrain_type` is offered. After `terrain_type ` type `GRA` and confirm terrains come first,
   GRASS among them, and no objects or words from comments are listed.
2. Your own names first. Add `#const MY_FOREST 10` above the section. In a terrain slot type `MY`
   and confirm MY_FOREST sits above the built-in rows and says it is the script's own. Move the
   `#const` below the use and confirm the row moves to the bottom, tagged as defined below.
3. Tab and Enter. With the list open, press Enter and confirm a new line is made and nothing is
   accepted. Open it again and press Tab, and confirm the highlighted name is inserted. With the
   list closed, Tab indents.
4. Flash on typing. Type `terrain_type GRASS` then a space, and confirm GRASS flashes green for
   under a second. Repeat ending with Enter, then with the Right Arrow, then with a click
   elsewhere. Each flashes once. Type `terrain_type NOPE ` and confirm no flash.
5. Flash on Tab. Accept GRASS from the list with Tab and confirm it flashes. Accept a name defined
   below the use and confirm it does not.
6. No flash on these. Paste `terrain_type GRASS` from the clipboard, undo, redo, open a file and
   edit a value in the Breakdown tab, then come back to Code. None of them flash.
7. Theme. Check the flash reads in the light theme, the dark theme and one custom theme from
   Settings > Theme. It uses the theme's success background.
8. Reduced motion. In Windows Settings > Accessibility > Visual effects turn Animation effects off,
   restart the app, and confirm the flash is a flat tint that disappears after under a second
   instead of a fade.
9. Setting. In Settings > Code untick "Flash a name green when it resolves" and confirm typing
   GRASS no longer flashes, with no restart. Hover the checkbox in help mode and read its tip. Tick
   it again.
10. Hover. Hover MY_FOREST where it is used and confirm the hover names the line of your `#const`.
    With the `#const` below the use, confirm it says so.
11. Typo fix. Type `terrain_type FORREST`, put the caret on FORREST and press Ctrl+. (or click the
    light bulb). Confirm three actions in this order, "Change to FOREST", "Create #const FORREST 10
    above this command (10 is FOREST, ...)" and "Create #const FORREST 10 in the header". Pick the
    first and confirm the word changes. Ctrl+Z undoes it in one step.
12. Create above. On a new unknown name inside an `if TINY_MAP` branch, pick "Create #const ...
    above this command". Confirm the line lands inside the branch, directly above the command, at
    its indent, and the value is selected so typing replaces it. Ctrl+Z removes it in one step.
13. Create in the header. Pick "Create #const ... in the header" and confirm the line lands at the
    end of the header, above the first section, with the value selected.
14. Move up. With `#const MY_FOREST 10` below its use, press Ctrl+. on the use and pick "Move the
    #const up here". Confirm the line moves above the command, a trailing comment on it moves too,
    and one Ctrl+Z puts it back. Put the definition inside an `if` branch and confirm the action is
    not offered.
15. Not offered. Confirm no light bulb on GRASS, on a number, on a name inside a comment, in an
    `if` condition, or anywhere in a script that has an `#include_drs` line. Confirm an unknown
    name draws no squiggle and nothing in the status bar count.
16. Large map. Open `AK_Vanguard_v1.2.rms`, go to its last line and type a few names at normal
    speed. Confirm the list keeps up with no visible lag.

---

## 39. Code colours while typing, the preview render loop, 2026-10-22 (`src/components/preview/OverlayCanvas.tsx`)

Run `npm run tauri dev` and open `test-maps/new_map.rms`. Do not zoom or pan the preview, since
the bug only showed while the map was still fitted to the box.

1. Colours while typing. On the Code tab type `create_elevation 7` on a new line. Confirm it
   colours as you type, with no switch to Breakdown and back.
2. Same with the preview hidden. Repeat with the Reference tab in front of the side panel.
3. The preview still fits. Re-roll the seed and resize the side panel. Confirm the map refits each
   time. Zoom in, re-roll, and confirm your zoom is kept.
4. Land Placement. Open Advanced Tools, pick Land Placement, and confirm its canvas draws, fits the
   map, and the window stays responsive. Its canvas had the same loop.
5. Idle CPU. With the map open and nothing happening, confirm Task Manager shows the app near 0%
   CPU.

---

## 40. Commenting cards out, and selectable comment cards, 2026-10-22 (`breakdown-design.md` Sec.3.13)

Run `npm run tauri dev` and open a script with several commands in one section, an `if` with
commands inside, and a few comments between cards.

1. Button. Click the `/*` beside a command's trash button. Confirm the card becomes a comment card
   holding the command's text, and the Code tab shows `/* create_... */` on that line.
   Click the struck `/*` on the new comment card and confirm the command comes back exactly as it
   was. Ctrl+Z undoes each step in one press.
2. Every card kind. Repeat on a directive, an `if` card and a `start_random` card. The whole
   construct goes inside one comment and comes back whole.
3. First and only card. Comment out the first command of a section and confirm it stays visible
   at the top as a comment card. Comment out the only command in an `if` branch and confirm the
   branch shows the comment card, not "Nothing here yet".
4. Header tab. Open a map whose file starts with a comment block. Confirm the Header tab now shows
   it as a comment card.
5. Selecting a comment. Click a comment card's border or toggle. It shows the selected accent.
   Ctrl+click a command, then Shift+click a card a few below. Confirm the comment cards inside the
   run are selected too.
6. Hotkey. Select two commands and press Ctrl+/. Both become comments and stay selected. Press
   Ctrl+/ again and both come back. Select a command and a comment together and press Ctrl+/.
   Confirm only the command is commented out.
7. In a field. Click into a value field and press Ctrl+/. Confirm nothing happens.
8. Group delete and drag. Select a command and a comment card, press Delete, and confirm both go
   in one undo step. Select them again, drag the pair below another card, and confirm both land
   there in order.
9. Add after a comment. Select a comment card and use Add Command. Confirm the new command lands
   right below the comment.
10. Code tab sync. Select a comment card, switch to Code, and confirm the cursor is on that
    comment. Put the cursor inside another comment, switch back, and confirm its card is selected.
11. Shared line. On a line with two commands and no blocks, comment out the second one from the
    Code tab or Breakdown. Confirm it shows on the first command's row as an inline comment with a
    struck `/*` button, and that the button brings it back.
12. Card menu. Right click a command and confirm a "Comment out" entry with Ctrl+/ beside it. With
    three cards selected it reads "Comment out 3 cards".
13. Settings. Settings > Hotkeys lists "Breakdown: Comment Out / Uncomment" as Ctrl+/. Rebind it
    and confirm the new keys work and the card menu shows them.
14. Disabled. An unclosed `if` card and an empty `/* */` comment both show the button greyed.

---

## 41. Comeer tutorial card placement, spotlight and the warning icon, 2026-10-23 (`src/tutorial/landGenerationComeer/tutorial.ts`)

Checked in a browser copy with mocked Tauri at 1600 x 900 by reading element boxes. Never seen
drawn, and never run in the real app.

1. One island per player. Pick Breakdown and go to this step. The card sits in the bottom right
   corner of the Breakdown pane, not the middle of the window, with the pane, Add command and the
   preview lit.
2. Same corner every step. Page from Player Setup to A little chance. The card stays in the
   Breakdown pane's bottom right corner on every step except Spot the problem, which still sits
   beside the preview.
3. Add command lit only when needed. It is lit on Player Setup, base_terrain, One island per
   player, Does the square count?, Name a value once and A neutral island, and on no other step.
4. Preview first, then fade. On Four borders shape, Box in the neutral island and A little chance,
   only the preview is lit when the step opens. Click a card in the Breakdown pane. The dim and
   the ring fade out over about two and a half seconds, and the click still lands on the card.
   Clicking or typing inside the tutorial card does not fade it.
5. Fade timer. Open A little chance and touch nothing. The spotlight fades after about 12 seconds.
   Press Next, then Back. The spotlight is showing again on both steps.
6. Code track. Repeat 2, 4 and 5 on the Code track. The card sits in the code editor's bottom right
   corner and the preview is lit and fades on the same steps.
7. Kind chip. Box in the neutral island shows Investigate.
8. Warning icon. On Box in the neutral island, the triangle before "Notice something?" is filled
   in the warning colour with the exclamation mark cut out, so the card's white shows through it.
   Compare it with the status bar's triangle and pick which style both should use.
9. Last step. The step after A little chance is You made Comeer, numbered as the last step, with
   Fill in the rest for me, Finish and the four review questions. Press Fill in the rest for me.
   The three sections appear, the title ticks, and the card stays open. Finish ends the tutorial.

---

## 42. Breakdown suggestions, the green flash and the create strip, 2026-10-23 (`docs/name-lookup-design.md` slice C)

Run `npm run tauri dev`, open the Breakdown tab on a script with a `create_land` in
`<LAND_GENERATION>` and expand it. Everything below passed in component tests with a harness
standing in for the pane, so this sheet checks what a harness cannot: the real reparse timing, the
real focus handling and how the strip looks.

1. Suggestions. Click the `terrain_type` value and type `GRA`. Confirm a list appears under the
   field with terrains first, GRASS among them, each row saying what it is. No objects are listed.
   Hover the list in help mode and read its tip.
2. Tab and Enter. With the list open press Down once, then Tab, and confirm the second row fills
   the field and the list closes. Open it again and press Enter, and confirm what you typed is
   committed and nothing is accepted. With the list closed, Tab moves to the next field.
3. Escape and Shift+Tab. Open the list and press Escape. Confirm only the list closes and the field
   keeps your text. Press Escape again and confirm the field reverts. Open the list and press
   Shift+Tab, and confirm the list closes and focus stays.
4. Ctrl+Space. In an empty value field press Ctrl+Space and confirm the list opens on an empty
   word. Click a row with the mouse and confirm it fills the field.
5. Your own names first. Add `#const MY_FOREST 10` to the header. In a terrain value type `MY` and
   confirm MY_FOREST sits above the built-in rows and says it is your `#const`. Move the `#const`
   below the use and confirm the row moves to the bottom, tagged as defined below.
6. Flash. Commit `DIRT` in a terrain value with Enter, then with a click elsewhere, then with Tab.
   Each tints the field green for under a second. Commit `5` and confirm no flash.
7. Not on these. Open a file, undo an edit, redo it, and switch to Code and back. None flash. Change
   the value in the Code tab and come back, and confirm no flash.
8. Theme and motion. Check the tint reads in the light theme, the dark theme and one custom theme.
   With Windows animation effects off, confirm it is a flat tint that disappears after under a
   second.
9. Setting. In Settings > Breakdown untick "Flash a name green when it resolves" and confirm
   committing DIRT no longer flashes, with no restart. Confirm Settings > Code shows the same box
   unticked. Hover the box in help mode and read its tip. Tick it again.
10. Screen reader. With Narrator on, commit `DIRT` and confirm it announces "DIRT is a built-in
    terrain" along with the descriptive name.
11. Create strip. Commit `FORREST` in a terrain value. Confirm a strip appears under the field
    reading "No const named FORREST in this script or the built-in list", with a Did you mean
    FOREST button, a value box showing 10 beside "10 is FOREST (...)", a Where list and Create and
    Dismiss. It is neutral in colour, and the card shows no problem badge for it.
12. Create above. Press Create with "Above this command". Confirm `#const FORREST 10` lands on the
    line directly above the command at its indent, the strip goes, and the field flashes. Ctrl+Z
    removes the line in one step.
13. Create in the header. Repeat and pick "In the header". Confirm the line lands at the end of the
    header, above the first section.
14. Value and 69. Change the strip's value to 21 and Create, and confirm 21 is written. Make a
    strip, type 69 in its value box and confirm a note about RMS0111 appears beside the buttons.
15. Did you mean. Commit `FORREST` again, press the Did you mean button, and confirm the field
    becomes FOREST, the strip goes and the field flashes.
16. Dismiss. Press Dismiss and confirm the strip goes and the script is unchanged. Press Escape in
    the strip's value box and confirm the same.
17. A new attribute. Add a `terrain_type` row that is empty, type `FORREST` in it and press Enter.
    Confirm the strip still appears, since the empty field is replaced by a real one as you commit.
18. Defined below. Put `#const MY_FOREST 10` below the command and commit `MY_FOREST` in its
    terrain value. Confirm a strip says it is defined on line N, below this use, with a "Move the
    #const up here" button. Press it and confirm the line moves above the command and the field
    flashes. One Ctrl+Z puts it back.
19. Not offered. Put the `#const` inside an `if` branch and confirm the strip names the branch and
    shows no Move button. Confirm no strip for `GRASS`, a number, a name in an `if` condition field,
    or anywhere in a script with an `#include_drs` line.
20. Conditions and chances. In an `if` condition field type a `#define` name and confirm it is
    suggested, and a predefined label such as `TINY_MAP` too. Commit a name from the script and
    confirm it flashes. In a `percent_chance` field confirm `#const` names are suggested.
21. Directives. In a `#const` card, confirm the value field suggests names and the name field does
    not.
22. Large map. Open `AK_Vanguard_v1.2.rms` in Breakdown, open a command near the end and type in a
    value. Confirm the list keeps up with no visible lag.

---

## 43. Land Placement name suggestions, flash, unset names notice and Add Template terrain, 2026-10-23 (`docs/name-lookup-design.md` slice D)

Run `npm run tauri dev`, open Advanced Tools, pick Advanced Land Placement and add a role and a
shape. Add `#const MY_RADIUS 12` to the script's header first.

1. Suggestions. Click the Base size box and type `MY`. Confirm MY_RADIUS is listed, saying it is
   your `#const`. Tab fills it and leaves the rest of the box alone. Type `(5 + MY` and confirm Tab
   replaces only `MY`.
2. Other sources. Type `SI` and confirm SIN is listed as a function. Add a random value, type its
   label's first letters in a Rotation box and confirm the label is listed as a random value. Type
   the start of a name the layout emits and confirm it is listed as from this layout.
3. Keys. Confirm Up and Down move the highlight, Escape closes the list without reverting the box,
   and Enter commits the box. Confirm the list does not hide the next field's box.
4. Flash. Type `MY_RADIUS` in Base size and press Enter. The box tints green once. Commit `5` and
   confirm no flash. Click into a box and click out without typing and confirm no flash.
5. Setting. Untick the flash in Settings > Code and confirm Base size no longer flashes.
6. Unset names. Type `NOPE_SIZE` in Base size and press Enter. Confirm a notice appears under the
   Apply button reading "These names have no value yet...", with "NOPE_SIZE has no value.", a block
   showing `#const NOPE_SIZE 0` and a Copy button. Hover Copy in help mode and read its tip.
7. Copy. Press Copy and confirm "Copied." appears. Switch to Code and paste, and confirm the line
   is `#const NOPE_SIZE 0`. This checks the clipboard works inside the packaged WebView2 window,
   which nothing else in the app uses yet. If it does not, confirm the notice says Copy was blocked
   and the block can be selected by hand.
8. Shrinks and goes. Paste the line into the header, outside the fenced block. Confirm the notice
   disappears without pressing anything. Add a second unset name and confirm both are listed, and
   removing one line makes the notice list only the other.
9. The other reasons. Define `#define EDGE`, use `EDGE` in a box, and confirm the notice says it is
   a #define on line N and its snippet replaces that line. Define `#const BRANCHY 4` inside an `if`
   and use it, and confirm the notice names the branch and writes no line for it.
10. Apply. With `NOPE_SIZE` unset in Base size, confirm Apply is still offered and the notice
    stays up after pressing it. Then type `5 + NOPE_SIZE` in a radius box and confirm Apply is
    refused with the notice still showing. An unset name only stops Apply where it follows a
    formula's first operand or sits in a rotation (design Sec.4.3.1). Define the name and confirm
    Apply works and the notice goes.
11. Add Template. Open Add Template on the Terrain tab, pick the player forests template, and type
    `GRA` in "Terrain to place on" and in the player land box. Confirm terrains are suggested,
    Tab fills the box, a `#const` from the script is listed above the built-ins, and Escape closes
    the list without closing the dialog.

## 44. Code tab line and block prediction, 2026-10-23 (`docs/name-lookup-design.md` slice E)

Run `npm run tauri dev` and open a script in the Code tab. The three Monaco spikes (Sec.13.6) were
run against a stub editor in the browser, so these steps are the first run in the real app.

1. Line prediction. Below a `create_land` block that has `land_position 85 68`, open a new
   `create_land {` and type `land_position` and a space. Confirm `85 68` shows in grey after the
   caret, in the theme's muted colour rather than coloured like code. Tab writes it.
2. One word. Repeat, and press Ctrl+Right instead. Confirm only `85` is written and `68` stays
   grey. Type `7` instead of accepting and confirm the grey text goes away or narrows.
3. Home. In a script with `create_terrain FOREST { terrain_type FOREST }` and no `create_land`
   using `terrain_type`, type `terrain_type` and a space inside a `create_land` block. Confirm
   nothing is predicted.
4. Not predicted. Confirm no grey text after `#const `, after `if `, after `percent_chance `, inside
   a `/* comment`, or with text to the right of the caret.
5. Block template. With the Sec.13.4 example block above, type `create_object GOLD` on a new line.
   The word list opens on GOLD. Confirm the first Tab takes the list's row and closes it, and the
   whole block shows in grey without the comment. The second Tab inserts it with `7` selected.
   Type `5`, Tab to `13`, Tab to `15`, Tab once more and confirm the caret lands after `}`.
6. Indent. Do step 5 on an indented line, and with Settings > Code set to tabs and then to 4
   spaces. Confirm every inserted line takes the command's indent plus one unit. The grey preview
   draws the lines without the command's own indent, which is Monaco's preview and not a defect.
   Confirm the inserted text has it.
7. Word list inside a template. Inside an inserted template, type over a value with the start of a
   name so the word list opens. Tab takes the name and a second Tab moves to the next value.
8. Undo. After inserting a template, one Ctrl+Z removes the whole block.
9. Two Tabs write a command. On a new line type `create_object` and a space with a
   `create_object GOLD` line above. Tab writes `GOLD`, and the block template then shows.
10. Skeleton. In a new file with only `<OBJECTS_GENERATION>`, type `create_object GOLD`. Confirm a
    block from other maps shows (three or four attributes). Add a `create_object STONE` block
    above and confirm the template now copies that block instead.
11. Brace below. With the script's blocks written with `{` on its own line, confirm the template
    puts it there too. Put a `{` on the line after the caret and confirm no template shows.
12. Setting. Untick "Predict the rest of a line and whole blocks" in Settings > Code and confirm
    no grey text shows on the next keystroke, with no restart. Hover the checkbox in help mode and
    read its tip. Tick it again and restart the app, and confirm it stays on.
13. Large file. Open Arena.rms and type at its last line. Confirm typing does not lag.

---

## 45. Breakdown readability pass, 2026-10-23 (`docs/breakdown-design.md` Sec.3.14)

Use a map with comments, a run of `#const` lines, an if with a start_random inside it, a
commented-out `create_land` block and a `replace_terrain` connection.

1. Quiet buttons. Confirm every card's Delete and `/*` buttons are faded. Hover a command inside
   an if and confirm only that command's buttons brighten, not the if's. Select a card, then Tab
   into one of its fields, and confirm its buttons stay bright both times.
2. Margin notes. Confirm comment cards have no box, sit further in than the cards around them,
   and show a grey square bar on the left for a one line note and a taller block for a longer
   one. Confirm the text is grey italic and easy to read on both Light and Dark.
3. Colours. Confirm attribute names (rows and the collapsed summary line) are orange and
   constants teal, matching the same words in the Code tab. Type a lowercase value into a
   constant field and confirm it turns back to the normal text colour while typing.
4. Nesting lanes. Confirm if, elseif and else branches each show a tinted lane with a guide line,
   that the start_random lane inside is a shade deeper, and that the guide under the pointer
   turns blue.
5. Commented-out code. Confirm the commented `create_land` shows as an italic card inside the
   comment card. Open it, change `land_percent`, press Enter, and confirm the Code tab shows the
   change inside the comment and the card stays open. Press Text and Cards and confirm the
   switch. Confirm a prose comment still shows as text.
6. `#const` table. Confirm the run of `#const` lines is one framed table with a row per line.
   Click in the MY_WATER name, press Enter and confirm the caret moves to its value. Type a number,
   press Enter and confirm focus lands on "+ add #const". Press Enter, confirm a NEW_CONST row
   appears with its name selected, type a name, press Enter and confirm the caret is in the new
   value. Confirm Tab still walks every control, the row buttons included.
7. Connections. In the replace_terrain rows press Enter through every field and confirm focus
   ends on "+ add another replace_terrain". Enter adds a row with the caret in its first field,
   type a terrain, Enter, and confirm the caret is in the second field.
8. Help mode. Hover "+ add #const", "+ add #define" and the Text button and read their tips.
9. `#define` table. Add a `#define` line and confirm it shows as a table with "+ add #define".
   Click in its name, press Enter and confirm focus moves to the next name or the button. Press
   Enter on the button, confirm a NEW_DEFINE row appears with its name selected, type a name and
   press Enter, and confirm focus lands back on the button.

## 46. Remembered start tab, 2026-10-25 (`src/hooks/useRememberedTab.ts`)

1. Start `npm run tauri dev`, switch to the Code tab and close the app. Start it again and
   confirm it opens on Code.
2. Switch to Breakdown, close and start again, and confirm it opens on Breakdown.
3. Switch to Code, then to Advanced Tools, and close the app there. Start it again and confirm
   it opens on Code, not Advanced Tools.
4. On a launch that will open on Code, click Breakdown as soon as the window shows and confirm
   it stays on Breakdown.

## 47. Code tab feedback round, 2026-10-25 (`src/editor/offerBulb.ts`, `constActions.ts`, `templateTarget.ts`)

The browser pane copy (mocked Tauri) already showed the bulb, the menus, the hovers and the template insert working. These steps check the same in the real app, where the title bar and file dialogs are real.

1. Open a map in the Code tab. Hover a word inside a `/* comment */` and confirm no popup shows. Hover `GOLD` and confirm one line, `Default res: 800`. Hover `RELIC` and confirm `Default rate: ? g/in-game min`. Hover `GRASS` and confirm `Predefined constant.` Hover `BIRD_A` (no `#const` for it) and confirm no popup.
2. Hover several attributes (`number_of_groups`, `avoid_forest_zone`, `set_place_for_every_player`) and confirm none says "Not yet verified" and each description reads clearly in one or two short sentences.
3. Type `terrain_type FORREST` and stop. Confirm the bulb sits in the gutter between the line number and the code (it moved there on 2026-10-26), and stays while the caret is anywhere on that line. Click it and confirm the menu offers `Change to FOREST`. Move the caret away and confirm the bulb leaves.
4. Type `number_of_object 3` inside a `create_object` block. Confirm the bulb appears in the gutter and offers `Change to number_of_objects`. Do the same with a misspelled command (`create_lan`).
5. Write `if MY_FLAG` and put `#define MY_FLAG` below it. Confirm the bulb offers `Move the #const up here` and that choosing it puts the `#define` above the `if`. Undo and confirm one step puts it back.
6. In a script with an `#include_drs` line, or one whose `#const` sits inside an `if`, use that name above its definition. Hover it and confirm the hover says why the move is not offered.
7. Right-click inside `<OBJECTS_GENERATION>` between two commands and confirm `Add Template...` is in the menu. Choose it, press Insert and confirm the text lands below the command the caret was in, with the caret on the first inserted command. Undo and confirm one step removes it.
8. Right-click inside `<TERRAIN_GENERATION>` and confirm the dialog offers the terrain template. Right-click inside `<LAND_GENERATION>` and confirm `Add Template...` is absent.

## 48. Feedback round, 2026-10-26

1. Ctrl-click a section tab in Breakdown to add it, then Ctrl-click it again and confirm it leaves. Confirm the last shown tab stays.
2. Open a script with a command whose `{` is never closed in Land, followed by an Elevation header. Confirm the Land tab shows the error, the Elevation tab shows a warning, and hovering the command's error badge shows a popup that stays on screen, including for a card at the right or bottom edge of the pane.
3. Comment out a command with the card button. Confirm its card is grey rather than tinted.
4. In the preview, click ? and confirm the help box opens just below the button. Confirm the cog is larger and the button is the same size, and the left toggle reads Truncate at Cursor.
5. Open Generation Settings. Confirm it opens over the map panel, the row reads Players with a narrow box, no preset shows the team readout or the lock note, and Escape closes it.
6. Open Advanced Tools, choose Land Placement and confirm it fills the whole width, with the tool picker at the top of its own pane. Choose another tool and confirm the left column comes back.
7. Open a saved map, close the app, start it again, and confirm the same map opens in the same tab (Breakdown or Code). Rename the file, start again, and confirm the app opens empty.
8. Start the Code track of a tutorial, save the file when asked on exit, start the app again and confirm it opens on Code with that file.
9. Hover RELIC in the Code tab and confirm the rate shows a question mark.
10. In the Reference tab, Commands, confirm each command's arrow is right aligned and larger.
11. In the Code tab type an attribute prefix. Confirm Tab steps down the list, Shift+Tab steps up and Enter accepts. In Settings, Code, Suggestion keys try the other two choices.
12. Confirm a light bulb shows in the gutter on any line with a quick fix, whether or not the caret is on the word, and a second one above the word while the caret is on it. Confirm clicking either opens the menu and that the upper one is not oversized or misplaced over the line above.
13. Use a `#const` name above its definition in a number slot and confirm the warning says it is defined on a later line.
14. Press Ctrl+` from Breakdown, Code and Advanced Tools, and on a keyboard layout where the backtick is a dead key.

---

## 49. Generation Settings over the map, 2026-10-26 (`src/components/preview/GenerationSettingsPanel.tsx`)

1. Open a map and click the cog on the preview. Confirm the settings open as a box in the preview's top right corner, not as a dialog, and that the map stays visible and clickable around it.
2. Change Players, Map size, Team Positions and a team. Confirm the map redraws behind the box as each changes.
3. Narrow the side panel. Confirm the box shrinks to the panel's width and its Players, Map size and Team Positions row wraps instead of running off the left edge.
4. Click the map, or a control in the Preview tab, and press Ctrl+D. Confirm the box opens, and that a second press closes it.
5. With the caret in the Code editor, confirm Ctrl+D still selects the next match of the word under the caret and the box does not open. Confirm the same in Breakdown and on the Reference tab.
6. Click the map, press Ctrl+D, then click into the code editor and press Ctrl+D. Confirm the box stays as it was.
7. Open the box, then click the Help button (?). Confirm Help replaces the settings. Open the settings again and confirm Help closes.
8. With the box open, click the map (not the box) and press Esc. Confirm the box closes. Repeat with focus in the box. With focus in the code editor and the box open, press Esc and confirm the box stays open.
9. In Settings, Hotkeys, confirm the Generation Settings row shows Ctrl+D and can be rebound.
10. Confirm the tutorial steps that point at the cog (tour and Golden Hill) still highlight it.
11. Check the box in Dark and Light themes, since it takes the themed surface colours.

---

## Not covered here

Nothing currently owed and unbuilt. The next UI-touching slice should append its own run sheet
here rather than a new scattered file.
