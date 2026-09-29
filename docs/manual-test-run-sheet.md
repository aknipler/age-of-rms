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

## Not covered here

Nothing currently owed and unbuilt. The next UI-touching slice should append its own run sheet
here rather than a new scattered file.
