# Object Templates build brief (rev 1, 2026-09-17)

Beta-tester feature request. A new **Add Template** button in the Breakdown pane's
Objects section (`<OBJECTS_GENERATION>`) opens a dialog offering three canned
blocks of `create_object` commands with a few options each. Choosing one
**inserts RMS text into the script**. Nothing is tracked afterwards. Once
inserted, the commands are ordinary cards like any other.

Read `CLAUDE.md` first ("Teaching mode", "Hard rules", "Commands"). The rules
that bite here are these. Vocabulary is data-driven (`reference/data/language.json`), code
is the only source of truth for Breakdown (every action is a `TextEdit`). Never
`git commit`. Every new interactive UI element is wrapped in `HelpTip`
(`src/components/HelpTip.tsx`, see how `src/breakdown/SectionView.tsx` wraps
Add Command) with a matching entry in `reference/data/ui-help.json`. The tree
is Prettier-formatted and CI checks it, so run `npx prettier --write` on the
files you changed before the final checks. New prose (comments, help text)
follows the CLAUDE.md language rule, imperative mood, no em dashes, no colons
as punctuation.

## 1. Where it plugs in

- Button. Next to **Add Command / Add Comment** in `src/breakdown/SectionView.tsx`
  (`.buttonRow`, ~line 128). Show it **only when the active section is
  `OBJECTS_GENERATION`**. Hotkey not required.
- Insertion. The patch engine's intents are in `src/breakdown/patch/intents.ts`
  and are computed in `src/breakdown/patch/computeEdit.ts`. There is
  `addCommand` (inserts one empty command by name) but nothing that inserts a
  multi-command text block. Add a new intent,
  `{ kind: "insertText"; at: InsertTarget; text: string }`, that inserts a
  prepared block at the same `InsertTarget` Add Command uses (after the current
  selection, else at section end; see SectionView Sec.3.9 comment ~line 54).
  Reuse `patch/formatStyle.ts` so indentation matches the file's detected style.
  Keep `src/breakdown/patch/**` React-free (hard rule) and add a unit test in
  `src/breakdown/patch/__tests__/patch.unit.test.ts` for the new intent. Run the
  property gate file too (`patch.property.test.ts`). It must stay green.
- Dialog. Follow `src/components/GenerationSettingsDialog.tsx` and
  `src/components/dialog.module.css` for structure/styling. New files under
  `src/breakdown/templates/` are `templates.ts` (pure, option types to RMS text,
  no React), `TemplateDialog.tsx`, `TemplateDialog.module.css`, and
  `__tests__/templates.test.ts` asserting each template with each option
  combination **parses cleanly through `src/parser`** with zero diagnostics of
  severity error, and contains the expected command names.
- Settings. None needed.
- Help text. Add `HelpTip` ids for the button, each template choice, and each
  option, registered the same way `breakdown.addCommand.search` is (grep for
  it). One or two plain sentences each. Run `npm run validate:reference` after
  editing any file under `reference/data/`.

## 2. The three templates

Produce the **simple, readable, canonical** form of each block, the kind a
newcomer can read top to bottom. The competitive maps in `test-maps/` wrap
these in heavy `ONGRID_PLACEHOLDER` / actor-area machinery; **do not copy that
machinery**. Use the corpus to confirm attribute names and sensible numbers,
not for structure. Emit RMS only (no other source languages). Each emitted
block starts with a one-line comment naming the template, e.g.
`/* Standard player objects */`.

Every `create_object` in every template takes `set_place_for_every_player`
unless it is a gaia object placed globally.

### T1. Standard Player Objects

Base blocks are `TOWN_CENTER` (`max_distance_to_players 0`, `min_distance_to_players 0`),
`VILLAGER` ×3 (`min_distance_to_players 6`, `max_distance_to_players 6`),
`SCOUT` (`min_distance_to_players 7`, `max_distance_to_players 9`).

Options

- **Quick-start (9 villagers)** checkbox. The QS start is 6 villagers placed on
  a sheep next to the TC, 3 villagers placed on a straggler tree, plus 2
  `HOUSE`s, and the initial villager block becomes 9 total. Reference
  `test-maps/QS_Three_Bays_v1.1.rms` lines ~741–830 (HERDABLE_A / SCOUT /
  HERDABLE / VILLAGER / HOUSE) and the "3 villagers" + "2 starting houses"
  blocks in `test-maps/Bulls_Eyes.rms` ~812–832. The simple form uses one
  `actor_area` on the sheep and `actor_area_to_place_in` on the 6 villagers, and
  `place_on_forest_zone` / a straggler-tree actor area for the 3. Keep the
  standard 4 close sheep out of T1, those belong to T2, but QS needs its one
  "eating" sheep, so emit it here with a comment saying so.
- **terrain_to_place_on** optional text field. When non-empty, every command in
  the block gets `terrain_to_place_on <value>`. Placeholder text in the field is
  _e.g. GRASS_ (italic, grey), with no default value.

### T2. Standard Player Resources

Base blocks, each `set_place_for_every_player`;

- `FORAGE_BUSH` (berries), `number_of_objects 6`, `set_tight_grouping`,
  `min_distance_to_players 10`, `max_distance_to_players 12`,
  `min_distance_group_placement 6`.
- Large gold, `GOLD` ×7, tight, min 12 / max 16.
- Large stone, `STONE` ×5, tight, min 14 / max 18.
- Small gold, `GOLD` ×4, tight, min 18 / max 26.
- Small stone, `STONE` ×4, tight, min 20 / max 26.
- Sheep, `SHEEP` ×4 close (`number_of_groups 1`, min 7 / max 9) and
  `SHEEP` ×2 far, `number_of_groups 2`, min 14 / max 30.
- Deer, `DEER` ×4, `number_of_groups 1`, loose grouping, min 14 / max 30.
- Boar, `BOAR` ×2 (`number_of_groups 2`, min 16 / max 22).
  Cross-check numbers against `test-maps/Bulls_Eyes.rms` and Arabia-style maps in
  the corpus before finalising. The corpus wins over the numbers above.

Options

- **Seasonal variation** checkbox. Instead of concrete names, emit the
  placeholder consts the DE seasons include expects and add
  `#include_drs F_seasons.inc` at the top of the block. The seasonal maps in the
  corpus (`test-maps/TL Frontline.rms`, `test-maps/AK_Vanguard_v1.2.rms`) show
  the convention, `HERDABLE` (sheep), `HUNTABLE` (deer), `LURABLE` (boar),
  `BERRIES` (berries), plus `HERDABLE_A` where a distinct close herdable is
  used. Confirm the exact const names from those maps. Gold and stone stay `GOLD` and
  `STONE`. The parser must accept `#include_drs F_seasons.inc`. The corpus maps
  already parse, so this should already hold, and the test in §1 checks it.
- **Berry type** select (disabled when Seasonal is on), `FORAGE_BUSH` (default)
  or `FRUIT_BUSH`. Read the option list from `reference/data/game-constants.json`
  if berries are enumerable there. Otherwise these two literals are fine, with a
  comment saying why.
- **Wildlife** select (disabled when Seasonal is on). Herdable `SHEEP`,
  `TURKEY`, `GOAT`, `LLAMA`, `COW`. Huntable `DEER`, `ZEBRA`, `OSTRICH`,
  `IBEX`. Lurable `BOAR`, `ELEPHANT`, `RHINOCEROS`, `JAVELINA`. Same
  data-first rule as berries.
- **terrain_to_place_on** optional field, same behaviour as T1.

### T3. Standard Water Resources

Base blocks, gaia, not per-player;

- Shore fish, `SHORE_FISH` `number_of_objects 6` per player
  (`set_place_for_every_player`, `min_distance_to_players 8`,
  `max_distance_to_players 16`, `terrain_to_place_on WATER`).
- Deep fish, `FISH_PERCH` (or the corpus's common deep fish), `number_of_objects 8`.
  Scale with `set_scaling_to_player_number` or `set_scaling_to_map_size` as the
  corpus does.
  Check `test-maps/QS_Three_Bays_v1.1.rms` and the `TL` water maps for the
  standard `terrain_to_place_on DEEP_WATER` / `MEDIUM_WATER` blocks.

Options

- **Oysters** checkbox adds an `OYSTER` or `SHELLFISH` block (use the name
  `game-constants.json` / the corpus actually uses; if neither has it, escalate
  rather than guess).
- **Whales** checkbox adds a `WHALE` or `DOLPHIN` style deep-water block, same
  name-resolution rule.

## 3. Dialog behaviour

- Left column holds the three template names (radio). Right column holds that
  template's options. Bottom holds **Insert** and **Cancel**. Escape cancels.
- Preview. A read-only `<pre>` under the options showing the exact RMS text that
  will be inserted, updated live as options change. This is the cheapest
  possible teaching aid and doubles as the manual test.
- Insert closes the dialog and inserts. Selection moves to the first inserted
  command (reuse whatever Add Command does after insertion).
- Insert is disabled while any field holds an invalid value (only
  `terrain_to_place_on` can, so reject anything that isn't an identifier).

## 4. Tests and checks

- `npx vitest run src/breakdown/templates` and the two patch test files above.
  Do not run the whole suite repeatedly. Once at the end via `npm test`.
- `npm run typecheck` and `npm run lint` clean.
- Do not start the app. No browser verification in this slice.

## 5. Concurrency and hand-off

- Other sessions edit `src/breakdown/cards/*` and
  `src/settings/BreakdownSettingsContext.tsx` concurrently. **Do not touch
  those files.** SectionView.tsx is the one shared touch point. Re-read it
  immediately before editing and keep the diff to the button and dialog mount.
- Never overwrite a whole file. Edit in place.
- Finish with a list of files changed, test/typecheck/lint results verbatim, any
  escalations (names you could not resolve), and a suggested commit message.
  Do not commit.

## 6. Backlog, two more templates (recorded 2026-09-28, corrected 2026-09-28, BUILT 2026-09-28, see Sec.7)

Two more templates are worth adding once someone picks this up again. Both put
a forest at each player's start, by two unrelated mechanisms — **neither is
"trees inside an already-existing forest zone"**, which is what this section
said before actually reading the corpus. Both are materially harder than
T1-T3 (a multi-step terrain-state chain, or object-attribute rewriting) and
want their own design pass rather than a drop-in option list.

### Terrain generation: player forests

A `TERRAIN_GENERATION` template that paints real `FOREST` terrain at each
player's start, following `test-maps/AK_Namatjira.rms`'s `SEVEN_GENERATION`
block and `test-maps/AK_Vanguard_v1.2.rms`'s equivalent. The idiom is a
per-player terrain-swap chain, not a single `create_terrain` call:

1. A per-player placeholder terrain — already carrying that one player's land
   from land generation — is claimed wholesale into a scratch terrain
   (`REPLACE_A` / `TEMP_TERRAIN2`, `base_terrain <placeholder> land_percent 100
number_of_clumps 1`), isolating one player's area at a time.
2. Within that scratch terrain, a forest patch is marked out with
   `number_of_tiles` / `number_of_clumps` and `set_avoid_player_start_areas
<dist>` so it doesn't overlap the TC.
3. That marked patch converts to the real forest terrain (a further
   `REPLACE_LUMBER` layer in Namatjira; Vanguard skips the extra layer and
   makes the marking step itself the final forest terrain).
4. The scratch terrain's remainder (everything that ended up not forest)
   converts back to a "this player is done" terrain (`TEMP_TERRAIN` /
   `PL_TERRAIN`) — issuing the **same `create_terrain` command 5-6 times in a
   row**, `land_percent 100` with an implausibly high `number_of_clumps`
   (9999, 4056). Not a typo: a single wholesale terrain-claim reliably leaves
   tiles behind in the engine, so the claim is repeated until nothing is.

Needs a design pass on: how the template gets a per-player placeholder
terrain to start from (does an existing land/player-setup template already
produce one, or does this template need its own prerequisite step?), and
Vanguard's `#const`-parameterized numbers (`PL_TOTAL_FOREST_TILES`,
`PL_FOREST_CLUMPS`, `PL_FOREST_MIN_DIST`) as the option-to-attribute mapping.
Read both corpus files in full, not just an excerpt, before designing.

### Object generation: player forests

The _other_ way to make the same forest, by object instead of by terrain
command, per `test-maps/broken/BCC2-Rekawa.rms` and
`test-maps/Chaotic_Straitv0.99.rms`. A spare gaia object — aliased
`MAKE_FOREST_TERRAIN` in BCC2-Rekawa, `#const MAKE_FOREST_TERRAIN 1639`
(`constId` 1639 is an unused "Monument resources enabler" row with no
`rmsConstant` of its own, per `game-constants.json`) — is reconfigured before
generation with `effect_amount`/`effect_percent SET_ATTRIBUTE`:
`ATTR_HITPOINTS 0`, `ATTR_RADIUS_1`/`ATTR_RADIUS_2 50` (a 1x1 footprint), and
`ATTR_FOUNDATION_TERRAIN 10` (forest). Wherever that object is then placed,
the tile underneath becomes forest terrain, not whatever the map generated
there. It's placed with `create_object`, `second_object <a real tree
constant, e.g. DLC_RAINTREE>` for the visible object, `set_gaia_object_only`,
`set_gaia_unconvertible`, `ignore_terrain_restrictions`, and the usual
distance/grouping attributes. The reason to prefer this over `create_terrain`:
leaving the map's real terrain under a tree means a building placed there
after the tree is chopped sits on ground that isn't leaves, which the corpus
authors treat as a defect worth working around.

All the vocabulary this needs is already in `reference/data/`:
`effect_amount`/`effect_percent`, `SET_ATTRIBUTE`, `ATTR_FOUNDATION_TERRAIN`,
`ATTR_RADIUS_1`/`_2`, `ATTR_HITPOINTS`, and `DLC_RAINTREE` all resolve today —
checked 2026-09-28, nothing to add there. Still needs: picking (or letting the
user pick) which spare object id stands in for `MAKE_FOREST_TERRAIN`, since
`1639` is just whatever slot BCC2-Rekawa happened to use, not a stable
convention, and confirming which terrain id is meant by `10`
(`ATTR_FOUNDATION_TERRAIN`'s value, presumably the FOREST row) against
`game-constants.json` rather than trusting the excerpt's comment.

Same process as Sec.2's three templates once each is actually designed:
confirm names and numbers against the corpus, keep the canonical
newcomer-readable form, and add each as its own template id in
`src/breakdown/templates/templates.ts` with a parser round-trip test.

## 7. What was built from Sec.6, and what the corpus corrected (2026-09-28)

Both forest templates are built. The owner's decisions are recorded here
because Sec.6 left them open.

**The terrain template's premise was wrong.** Neither Namatjira nor Vanguard
paints real forest terrain. Namatjira marks a `DESERT` patch and plants
`PALMTREE` objects on it, Vanguard marks `UNDERBRUSH_SNOW` (72) and plants
`SNOWPINETREE`. The owner's call was to paint the final forest terrain
directly, which is what was built.

- **Where it lives.** A new Add template button on the Terrain tab, with
  its own list (`templatesFor` in `templates.ts`). Nothing is emitted in
  LAND_GENERATION. The dialog reads `create_player_lands`' `terrain_type`
  as the player land terrain and lets the scripter override it
  (`scriptContext.ts`).
- **Shape.** Vanguard's, reduced. Set aside player land past the maximum
  distance, then ten rounds (eight players plus Vanguard's two spares) of
  claim one player's land with `number_of_clumps 1`, grow the forest in it,
  set the rest aside, then restore everything set aside to the player land
  terrain. Land past the distance and finished land share one scratch
  terrain, so there are two scratch terrains, not three. They are 84 and 68,
  the two ids the corpus has run through `create_terrain`. Every number is a
  `#const`, following Vanguard's `PL_*` constants.
- **Its one limit**, stated in the emitted comment. Player lands that touch
  inside the maximum distance are claimed by one round and share one forest.

**The object template.**

- The `#const` and `effect_amount` lines go to the end of PLAYER_SETUP (the
  preamble when there is none) as a second edit in the same undo step,
  breakdown-design Sec.4.13. If the script already defines
  `MAKE_FOREST_TERRAIN`, only the `create_object` is inserted.
- Stand-in id defaults to 1639 in an editable field. All three corpus uses
  are one author's maps, and 1639 is the dat's "Monument resources
  enabler", so the help tip says to pick an id nothing else places.
- `ATTR_HITPOINTS 0` is included (owner's call). It removes the stand-in at
  game start, the tree placed through `second_object` stays.
- `effect_amount ... 0.5` instead of the corpus's `effect_percent ... 50`,
  because `language.json` marks `effect_percent` deprecated and `validate()`
  reports RMS0310 on it. This is argued from the documented relation, not
  observed in game.
- `ATTR_FOUNDATION_TERRAIN FOREST`, a name rather than `10`. The owner asked
  whether a number was required. It is not, `random_map.def:55` is
  `#const FOREST 10`. Our parser disagreed and reported RMS0202, a false
  positive, because it only counted the script's own `#const`s in a number
  slot. `ParseOptions.builtinConstants` fixes that, fed by the parser worker
  from `game-constants.json`. Measured over every `.rms` under `test-maps/`,
  `test-maps/local/` and `test-maps/broken/` on disk, it removes 0 of 106
  RMS0202 warnings, so it changes nothing for existing
  scripts and only matters for new text like this template's.

**Custom forests (same day).** Each forest terrain and tree dropdown ends
with Custom…, which opens a text box for any name or bare id, so a
scripter's own `#const` works. A bare id draws the RMS0204 hint that a name
reads better, which is left alone since the scripter chose it.

**Still owed.** An in-game run of both templates, and the manual run sheet
item for the dialog.
