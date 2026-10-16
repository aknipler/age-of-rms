# Tutorial C, "Growing islands" (Design, Rev 1, 2026-10-06)

Status. The engine additions in Sec.4.1 to Sec.4.3 are built (2026-10-06), and so is the background seed check in `src/tutorial/landGenerationComeer/`. The tutorial itself is built too (2026-10-06), in `src/tutorial/landGenerationComeer/tutorial.ts`, and has not run in the real app. Its steps follow Sec.0 and not the older step list in Sec.2, which is kept for the reasoning. Sec.0 records decisions taken after rev 1 and overrides the sections below where they disagree. Extends `docs/tutorial-design.md` (the engine, Sec.5, and the backlog, Sec.17 and Sec.17.1). The measurements in Sec.3 were taken on 2026-10-06 with a throwaway probe that has been deleted. Every number marked [tune] is provisional until the seed finder in Sec.5 has run.

## 0. Owner decisions after rev 1 (2026-10-06)

These override the rest of the document.

1. The title is "Land Generation (Comeer)". Code for it lives in `src/tutorial/landGenerationComeer/`, named so that later land generation or island tutorials can sit beside it.
2. The first step says the tutorial is 1v1 and opens with "We are going to make a tournament map, Comeer", followed by the finished map image as an image block in `body` (Sec.4.1).
3. The players sit diagonally opposite each other.
4. `border_fuzziness` starts at 100 and then drops to a value in 10 to 40, with Comeer's 20 as the pick. This replaces the order in Sec.2 steps 2 and 3 and answers open question 1.
5. Every other spoiler also uses Comeer's own value as the pick.
6. The settings a step pins stay as they are when the tutorial ends. Nothing is restored, which answers open question 3. The last step should say so.
7. `rnd()` in `create_player_lands` gives both players the same value. This is the owner's answer to open question 6, so step 6 can call it fair.
8. The stated `base_size` range is 8 to 11, with 10 as the pick, and not 8 to 12 as Sec.3 first suggested. The players' own `other_zone_avoidance_distance 3` leaves a 3 tile channel at every value from 8 to 11. At 12 the channel falls to 1 or 2 tiles on some seeds, so 12 stays unjoined but crowds. The regression test asserts the full channel. **Revised 2026-10-14 for the DE land stage (preview-design rev 9, BUG-037).** DE leaves one tile fewer than the avoidance distance on a diagonal, so the channel is 2 tiles and the test asserts that. On the new pinned seed, 55, values 8 to 12 keep it and 13 does not. Some other diagonal seeds lose it at 10 or 11, so the range stays 8 to 11. The border lane check likewise asks for 11 tiles, since DE's right and bottom borders are inclusive. A replacement seed found at tutorial start is saved in `settings.json` and checked first on later starts (`seedMemory.ts`). **Changed again the same day, owner's decision.** The pinned seed is 217, where the players start 21 to 22 tiles apart, and the player `base_size` is 9 (Comeer writes 10) with a stated range of 7 to 9. On 217, 9 is the biggest value that keeps the 2 tile channel and 10 leaves 1 tile, so the step's "biggest one that still leaves a clear channel" is the pick. **Added 2026-10-14, owner's decision.** A step "Does the square count?" (`does-the-square-count`) follows "One island per player". The learner predicts whether the starting square counts toward land_percent, adds `behavior_version 1` to Player Setup, and sees the islands shrink, because Comeer uses version 1. `comeerScript` writes version 1 by default, so every range is proven on it, and `seedCheck.ts` proves the step's own claim (`behavior-version-1-shrinks-the-islands`, version 1 at most 0.8 of version 0, measured 0.62 on 217). **Added 2026-10-16, owner's decision.** A manual step "Box in the neutral island" (`neutral-island-borders`) follows "Shape the island". At land_percent 100 and border_fuzziness 100 the learner tries right_border and bottom_border (70 to 74, pick 73), finds in a "Notice something?" dropdown that the corner cut comes from the left and right borders and shows against the map edge, and moves it off the map with a negative top_border. The step ends with land_percent back at 6 and border_fuzziness 20, the borders optional since Comeer does not use them, and the range is measured in that state, a border that stops the wild growth and does not make the island smaller on average. It is a check with `autoAdvance` false, ticking on the kept borders and never moving on by itself. "Four corners" now also checks land_percent 6 on every island. `seedCheck.ts` section 7 proves both ends of the range, the cut at the map edge and the `top_border -8` fix (-7 leaves a notch at 70), and `inspectNeutralBorders` proves the size claims over 22 seeds (de-disassembly `notes/borders-corner-cut.md`, RMSTEST_75).
9. The spoilers hide a range as three separate numbers, the low end, the high end and the pick. Every range comes from `comeerValues.ts` and is proved by the regression test.
10. The picture in the first step is drawn headlessly from the finished script at the pinned seed (`renderImage.ts`, `public/tutorial/comeer.png`), and a test fails if it goes stale. Regenerate it by running `renderImage.test.ts` with `UPDATE_COMEER_IMAGE=1`.

## 1. Goal and source

The learner builds a small island map in the Land section and learns how land grows, what stops it, and how to keep neighbours apart. The map is a simplified version of TC2 Comeer v1.4 by Captain Kniples, who has given permission to use their maps without restriction. The first step credits them by name.

The tutorial starts with the end in mind, as Tutorial A does. Step 0 shows a picture of the finished map before anything is typed (Sec.4.1).

The map is 1v1 on a Tiny map (120 by 120 tiles), and nothing else. The tutorial pins the 1v1 team preset and the Tiny size (Sec.4.3). The finished map has two player islands facing each other across the ring, four neutral islands in the corners, water everywhere else, a few hills, forests on the islands, and the starting objects. The learner writes the land section by hand and then chooses between having the rest filled in or writing it.

## 2. What the learner meets, in order

The order is built so that the learner meets each failure before the attribute that fixes it.

1. Water first. `base_terrain WATER` fills the whole map. Lands are painted over it.
2. Player lands. `create_player_lands` with `terrain_type GRASS`, `land_percent`, and `circle_radius`. The learner also sets `border_fuzziness 0`. The copy explains that this is a diagnostic. The guide calls this attribute border adherence, and 0 makes land growth ignore borders entirely, so the preview shows how far the land is able to grow before anything holds it back. At the pinned seed the islands run to the map edge. **This reverses the first draft, which set 100.** At 100 borders are fully respected, so a learner who sets it first would see a hard wall and nothing about how far the land wanted to go. See Sec.3 and open question 1.
3. Borders, learned by getting them wrong twice. The learner sets all four borders to a first value and `border_fuzziness` to 100. The preview shows the land stopping at the border, but too close to the map edge to leave a lane for ships. They set a second value, which is closer but still short. They then add `#const BORDERS_PL` and point all four borders at it, and a spoiler gives the answer. Spoilers say things like "a value between 10 and 14 works, we pick 12" [tune]. Border values are percentages of the map, so the copy says so, and says that 12 on this map is about 14 tiles. This is the first step that uses `#const`, so the copy says why one name for four attributes is worth having. The default adherence is 20, which gives ragged edges, and a short note says why the tutorial raises it.
4. Island size and the overlap, discovered. The learner sets `base_size` to the deliberately large value and presses nothing else. At the pinned seed, the two islands fuse along a diagonal. The step does not announce this. The copy asks the learner to look at the preview and say what is wrong, with a spoiler explaining it. The fix is a smaller `base_size`, with a spoiler that gives the safe range and the picked value. With two players the pair sits opposite each other on the ring, so when the ring is rotated a quarter turn off the axes both origins lie on the same diagonal line through the map centre, and the spoiler can say so.
5. Neutral islands. One `create_land` in a corner with `land_position`, its own `zone`, `other_zone_avoidance_distance`, and `land_id`. The learner uses the card duplicate action three times and changes the position and zone of each copy. The learner first sets `land_percent` too high and sees the neutral island swell against its neighbours, then constrains it with `other_zone_avoidance_distance` and a smaller `land_percent`, with a spoiler. This diagnostic has not been measured yet (Sec.8 question 6).
6. Randomness, once. A short discussion step. A map with every number fixed plays the same every game, and part of what makes an AoE2 map replayable is variation that is fair to every player. The learner picks one attribute and wraps one value in `rnd(a,b)`. Options offered are `clumping_factor` and `base_size` on the neutral islands, `land_percent` on the neutral islands, and the second number of `circle_radius`. Each option carries a safe range in its spoiler, and the discussion points out that a range on a player attribute must stay inside the rule from step 4.
7. Finish the map. One step with two buttons. "Fill in the rest for me" inserts the elevation, terrain and objects sections. "I'll write it myself" ends the guided part with a short list of things to try (hills on the neutral islands, a second forest pass, resources on `land_id 100`). A learner who wants to write it themselves gets a `check` that the script has the three sections, so the tutorial can end properly either way.

The rest of the script, whichever way it arrives, has three parts. A `create_elevation` pass for a few hills. A `create_terrain FOREST` in TERRAIN_GENERATION with `base_terrain GRASS` so it only grows on the islands. The starting objects (town centre, villagers, scout, and a small set of resources, plus gold on `land_id 100`).

## 3. Measurements behind the design

All runs used the real `generatePreview` with the 1v1 teams and a Tiny map (120 by 120 tiles), `create_player_lands` only, `circle_radius 16 1`, `clumping_factor 20`, `other_zone_avoidance_distance 3`, `base_terrain WATER`. A flood fill over the S1 terrain decides whether the two islands merged. The first round of measurements, taken with six players on a Normal map, is superseded and not kept.

**Merging depends on `base_size` and not on `land_percent`.** The two players sit on a ring of radius about 19 tiles around (60,60), rotated by the seed. Their Chebyshev distance runs from 26 to 40 tiles. In 80 seeds per cell, the count that merged was the same at 15 percent and at 25 percent, and moved only with `base_size`.

| `base_size`        | 8   | 10  | 12  | 14  | 16  | 18  |
| ------------------ | --- | --- | --- | --- | --- | --- |
| Seeds merged of 80 | 0   | 0   | 0   | 12  | 32  | 62  |

At `circle_radius 20` the first merges appear at 18, and at 24 none appear up to 18. So the ring radius moves the whole table. `circle_radius 16` is the tutorial value.

**The overlap rule.** A land starts as a square of radius `base_size` (`lands.ts`, origin stamp). Two origins whose offsets are both at most `2 * base_size` have overlapping squares. The table above follows that rule exactly, because the smallest distance is 26 and 2 times 12 is 24, so nothing merges at 12 or below, and the merges at 14 and above come from the seeds where the pair sits near a diagonal and the distance is shortest. A first round of measurements on a six player ring found one exception, where the offset was exactly `2 * base_size` on both axes. The squares then share a single corner tile and the pipeline treats the islands as separate. A guarantee therefore needs an overlap two tiles deep, an offset of at most `2 * base_size - 2`. The finder uses that.

**Border values are percentages of the map.** On Tiny, borders of 4, 8, 12 and 16 left the nearest land 5, 10, 14 and 19 tiles from the edge, which are 4, 8, 12 and 16 percent of 120.

**`border_fuzziness` is border adherence, and the default is 20.** The guide says 0 makes growth ignore borders, 100 respects them fully, and a low value gives ragged edges (guide, `border_fuzziness`). The preview port follows that (`lands.ts`, rule 6a, a tile one step past the border is refused with a chance of `f * d` percent). The measurement agrees. At 0 the borders had no effect at all on any seed. At 100 the nearest land sat at the border value, to within a tile. With `land_percent 25` and adherence 0, the nearest land was 2.5 tiles from the edge on average over 40 seeds and touched it on at least one.

**`land_percent` sets the island area.** At 10 percent the two islands held about 2350 tiles, at 25 percent about 4500, and at 40 percent about 6700. The tutorial value is [tune].

## 4. Engine additions

Tutorial A needs none of these. Each is small and testable on its own.

### 4.1 Step image

As built (2026-10-06, revised the same day on the owner's request). A step's `body` is a list of blocks (`BodyBlock` in `src/tutorial/types.ts`, rendered by `src/tutorial/StepBody.tsx`). A plain string is a paragraph, as before, so existing content is unchanged. An `{ kind: "image", src, alt }` block puts a picture between paragraphs. For the two spots outside the body there is still `TutorialStep.image`, with `placement` `"top"` (above the title, the default) or `"bottom"` (just above the buttons). Images live in `public/tutorial/`. The callout is placed again when an image loads, because a manual step has no polling loop to notice the new height. A test fails if any registered image, in either place, is missing from `public/`.

Step 0 of this tutorial uses the finished island map. Tutorial A gets a new anchorless first step, "What we're building", showing Golden Hill, widened with `calloutMaxWidthPx`. The overlay already centres a step with no anchor. Both images must be regenerated when the renderer changes, so each gets a line in the build log. The Golden Hill image needs a person to run `npm run tauri dev`, pick a seed, and press Export PNG, because the export opens a native save dialog.

### 4.2 Spoilers

As built (2026-10-06, revised the same day on the owner's request). Spoilers are body blocks too, in two forms, so they can sit anywhere in a step.

A block spoiler, `{ kind: "spoiler", label, text }`, is a labelled toggle between paragraphs that opens a hidden paragraph. It is a button with `aria-expanded` and not a native details element, because HelpTip wraps its child and a wrapped summary stops working.

An inline spoiler hides words inside a sentence. A paragraph written as an array mixes plain strings with `{ spoiler: "12" }`, for example `["A value between 10 and 14 works, we pick ", { spoiler: "12" }, "."]`. Until it is clicked, the hidden words are not in the page at all. A masked bar about as wide stands in for them, so a screen reader, a text selection or find in page cannot give the answer away. Once clicked, the words join the sentence with a faint dotted underline.

Neither has a HelpTip. The owner made that exception to CLAUDE.md's every-control rule, since the label or the masked bar already says what the control does. Every spoiler starts hidden each time its step is shown, Back included. The separate `spoilers` field from the first build is gone.

### 4.3 Pinned preview state

`TutorialStep.preview?: { seed?: number; teamPreset?: string; mapSize?: MapSize }`, with `teamPreset` taking the id `"1v1"` from `TEAM_PRESETS`, which sets both the player count and the teams. It is applied once when the step becomes active, in the same place `navigate` is applied. The seed lives in `PreviewViewContext` and the settings in the generation settings context, which persists to the store. Changing a persisted setting for a tutorial would leave it changed afterwards. ~~The engine should remember the learner's values when the tutorial starts and put them back when it ends or is exited.~~ Superseded by Sec.0 item 6, nothing is restored. A learner who presses Re-roll still gets the pinned seed back on the next step that pins one, and on Back to a step that pins one.

As built. The app registers a `PreviewPinner` with the engine through `useRegisterPreviewPinner` (`src/tutorial/useAppPreviewPinner.ts`, called from `AppContent`), the same inversion the navigators use, so the engine imports no app context. The preset goes through the new `selectTeamPreset` in `GenerationSettingsContext`, which does nothing when the preset is already active, because the existing toggle would switch it off on a second pinning step. The engine reads `step.preview` when the step becomes active, so a step can write its seed as a getter over the background seed check, `get seed() { return currentComeerSeed(); }`.

### 4.4 Multi-section auto fill

Tutorial A's `autoFill` returns one `StepTextEdit` from `appendObjectBlocks`. Step 7 needs an edit that appends three whole sections. `StepTextEdit` already carries a start, an end and the new text, so this is a content function and not an engine change. The only care needed is that it inserts after the last section the learner has, and does nothing if one of those sections already exists.

## 5. The seed finder, and the regression gate

The map's discovery step depends on a seed that makes two islands fuse along a diagonal. The engine could change, and then the pinned seed would quietly stop showing the problem. Two pieces prevent that.

The finder is a report, not a gate, in the same family as `measure:checker`. It runs under its own vitest config, so it stays out of `npm test`. For each seed it generates the learner's script in the state of step 4, with the 1v1 preset at Tiny, and looks for a seed where the two player origins are on a diagonal (`|dx - dy| <= 1`) with an offset at most `2 * base_size - 2`. With two players that means both origins lie on one of the map's two diagonals through the centre, the line x = y or the line x + y = 120, and either one counts. For each candidate it then generates the fixed state and checks that no two player islands merge there, by flood fill over the S1 terrain. It prints the smallest passing seeds. It also prints the smallest player to player distance over a few thousand seeds, which certifies the spoiler's safe `base_size` range for every seed and not only the pinned one, and it prints which seeds pass the later checks below, so one seed can serve the whole tutorial.

The gate is a normal test in `npm test`. It reads the pinned seed from `tutorialConstants.ts` and asserts, with a handful of generations and no sweep, the properties the copy depends on.

- In the step 4 state, two player islands are fused, found by the real pipeline and not only by the geometric rule.
- In the fixed state, no two player islands are fused. Every `base_size` in the spoiler's stated safe range is checked, not only the picked value.
- In the first and second border states, with adherence 100, the nearest land is closer to the map edge than the lane the copy asks for. With `BORDERS_PL` it is not. This is the claim that the two wrong attempts are visibly wrong and the third is right, and the lane width is [tune].
- Every neutral island stays separate from every player island at the picked values.
- The finished script generates without failure marks.

When the engine improves and a pinned property no longer holds, the gate fails, the finder is rerun, and the constant is updated. Mutation test the gate once when it is built, as the project's rule on checks that have only ever passed asks.

## 6. Content rules

Tutorial copy follows the language rules in CLAUDE.md, so no em dashes, no colons or hyphens as punctuation, no semicolons in prose, and no triads. Attribute names stay in code form. Every spoiler states a range and then the picked value, so a learner who chose differently can tell whether they were also right.

## 7. Test plan

The same pattern as `rmsBasics.test.ts`. A fixture `islands.rms` holds the finished script, and the test asserts that every `check` predicate is false on the previous step's script and true on this step's. The gate in Sec.5 covers the preview claims. Engine additions in Sec.4 each get their own test (image renders, spoiler toggles, pinned state applies once and restores on exit).

## 8. Open questions

1. **Border adherence direction.** The first draft had the learner set `border_fuzziness 100` as a diagnostic that shows how far the land can grow. The guide and the preview both say 100 respects borders fully and 0 ignores them. The design now sets 0 first, then 100 once borders are added. A third option keeps the learner at the default of 20 and lets the ragged edges show, at the cost of the "wrong twice" values being harder to judge by eye. Confirm which one.
2. Whether step 3 should include the moment where borders do nothing at adherence 0. A learner who adds borders while still at 0 sees no change, and then has to find out why. It teaches adherence well and costs one more step. The design as written avoids it by setting adherence and borders together.
3. Restoring the learner's team preset and map size on exit (Sec.4.3). The alternative is to leave them changed and say so on the last step.
4. The map and tutorial names. The working names are "Growing islands" and "Mini Comeer".
5. The step 4 `base_size` and the step 3 wrong border values are provisional [tune]. The measurements above give a starting point, `base_size 16` as the unsafe value (it merges on about 40 percent of seeds, and the finder picks one of those) and 10 as the safe pick, with 12 or less certified safe by the distance of 26. They are fixed after the finder and the gate have run.
6. Whether `rnd()` on a `create_player_lands` attribute gives both players the same value. The copy in step 6 says it is fair because it does, and nothing here has measured it. A one run spike against the preview, and then a check against the guide, settles it before step 6 is written.
7. The neutral island diagnostic in step 5 (`land_percent` too high, swelling against neighbours) has not been measured on this map.
