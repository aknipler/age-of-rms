# tools/scenario-probe — Phase 4.1

Measures an RMS-generated map **exactly**, by reading a scenario export from a
maintainer's own DE install. Dev-side only, never invoked by the shipped app and
never shipped to users.

## Why this exists

The Phase 4.1 verification pass ran nine minimal scripts in DE's editor and read
the results off screenshots. That worked for every _binary_ question ("is the
gold on the dirt or not") and answered no _numeric_ one, because nobody can
count 829 versus 840 tiles by eye. Those numeric questions are exactly the ones
`preview-design.md` Sec.15 has been carrying open across three revisions, and
they are what the `[tune]` constants need in order to stop being guesses.

This is the only instrument in the project that can calibrate against ground
truth rather than against the guide's prose.

## Setup

```bash
pip install -r requirements.txt
```

## Use

**One-shot.** Save a scenario from the editor, then:

```bash
python probe_scenario.py "<path to .aoe2scenario>"
```

**Watch mode**, which is the loop you actually want. Leave it running, then in
the editor pick a script, Generate Map, Save As. Output appears in a second or
two.

```bash
python watch_scenarios.py
python watch_scenarios.py --once     # newest scenario, then exit
python watch_scenarios.py --dir <path>
```

The editor workflow is: **Random Map location** → your script → **Generate Map**
→ **Menu ▸ Save As**. Scenarios land in
`%USERPROFILE%\Games\Age of Empires 2 DE\<steamid>\resources\_common\scenario`,
which the watcher auto-detects.

## The measurement modes

The default run prints terrain, elevation and object histograms. Four flags add
a reading that a histogram cannot give, each built for a specific open question:

| Flag                        | Gives                                                                | For                                          |
| --------------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| `--bbox TERRAIN`            | bounding box and per-edge inset                                      | border arithmetic, Sec.4                     |
| `--clusters OBJECT`         | object blobs (4-connected) and the gaps between them                 | group spacing, Sec.6.6                       |
| `--patches TERRAIN`         | terrain patches (4-connected) with area, centroid, bbox, circularity | cross-shaped land area, clumping regimes     |
| `--rows TERRAIN\|ELEVATION` | banded row and column histogram plus the mean on each axis           | elevation south bias, border fuzziness depth |

Both use 4-connectivity, and in both cases that encodes how the thing was built
rather than a preference. An engine-grown terrain clump samples candidates
4-adjacent to owned tiles. A tight group's fill is also strictly 4-connected,
**measured by RMSTEST_26**, where 300 declared groups of 5 came back as exactly
300 components of exactly 5.

`--clusters` used 8-connectivity until 2026-08-01, on the reasoning that an
unchecked fill meant a diagonal touch was still one group. The premise was
right and the conclusion did not follow, since a fill being unconstrained by
attributes says nothing about its adjacency rule. On the same RMSTEST_26 data
8-connectivity returned 299 components with one blob of 10, merging two
distinct groups that touched at a corner.

`--patches` reports **circularity**, `4*pi*area/perimeter^2`, normalised so a
disc reads 1.0, a solid square reads 0.785 and a one-tile-wide snake tends to 0.
It is scale free, so patches grown at different budgets stay comparable, which
is what makes `clumping_factor` regimes testable as an ordering.

`--rows` prints `mean x` alongside `mean y` as a control. Neither the south bias
nor a left border is supposed to move the x axis, so an x mean off 0.500 means
the run is measuring something other than what it thinks it is.

## The scripts

`rmstest/` holds the minimal scripts these flags were built to read, each
carrying its predictions in its own header. See `rmstest/README.md` for the run
sheet.

## Adding a map to the DE gate

`export_de_fixture.py` turns a saved scenario into a record of
`src/preview/__tests__/fixtures/de-elevation-cliff-maps.json`, the fixture
`deElevationCliffMaps.test.ts` holds the preview to tile for tile
(preview-design Sec.13). Use it to test a new rule of the land, elevation or
cliff stages against the game, or to grow the gate at other map sizes and
lobbies.

```bash
python export_de_fixture.py check "<scenario>"
python export_de_fixture.py add "<scenario>" --script probe.rms --seed 1000
```

`check` prints the lobby the scenario saved. `add` writes the record, replacing
one of the same name, and needs the script and the seed, since a scenario
stores neither. Players and teams come from the scenario. Pass
`--no-team-positions` when the editor's Team Positions box was unticked. After
adding, run Prettier on the fixture and then the gate.

How to make a map worth adding.

1. **Write the probe and predict first.** Keep the script to the sections the
   preview reproduces exactly, `<PLAYER_SETUP>`, `<LAND_GENERATION>`,
   `<ELEVATION_GENERATION>` and `<CLIFF_GENERATION>`. `add` refuses any other
   section unless given `--force`, because the gate compares the finished map.
   Use a DESERT base unless decoration draws are the point, since DESERT has
   none to hide among the other draws. Run the script through the preview at
   the seeds you will use and note what it predicts before generating in DE.
   For a question with two possible answers, work out what each answer
   produces (a local change to the preview, run and then undone), so the map
   can decide between them.
2. **Clear the alliances.** In the editor's diplomacy, make sure no unused slot
   is allied with anybody. The editor builds teams from all 8 slots, unused ones
   included, which no lobby does, and stale alliances left over from an earlier
   setup moved players on 12 of the study's maps. `check` and `add` refuse such
   a map, and also alliances that are not whole teams.
3. **Generate.** Map > Random Map location > the script, tick Seed Map, type the
   seed, set players and teams, Generate Map, Save As. Name the file
   `RMSTEST_<script>_<seed>_n<players>` (adding `_size-<n>` off Tiny) so the
   seed is not lost.
4. **Add it and run the gate.** A match is evidence for every rule the script
   exercised. A mismatch is a finding. Find the first draw or tile where they
   part before changing any rule, and add a map that tells the readings apart
   if the existing ones cannot.

`de-study/` holds the probe scripts and saved maps behind all three DE fixtures,
so any of them can be exported again (`de-study/README.md`).

The other two DE fixtures, `de-land-stage-maps.json` and `de-beach-maps.json`,
use an older letter encoding and are frozen. New land-stage maps go into the
elevation and cliff fixture, which holds every tile anyway.

## Reading the output

Terrain and object ids resolve through the repo's own
`reference/data/game-constants.json`, so every run doubles as a cross-check of
the Phase 4.0 extraction — the scenario binary and `random_map.def` are entirely
separate code paths, and agreement between them is real corroboration. Ids the
reference data does not know print as bare numbers rather than guesses; the
constants table currently holds 31 of several hundred.

Forest terrain auto-places a tree object per tile, so a forest-heavy map reports
tens of thousands of units. That is not noise, it is the mechanism: terrains
seed objects at a density recorded in the dat (`Terrain.terrain_unit_id` /
`terrain_unit_density`, in objects per 1000 tiles), and those objects are
occupancy, which is the only constraint on a tight group's fill.

## Two traps, both of which look like something else

**The emoji crash.** `AoE2ScenarioParser` prints emoji progress markers. On a
cp1252 console that raises `UnicodeEncodeError` _during parsing_, which reads as
a format incompatibility and is not. Both scripts force UTF-8 stdout at import.
If you call the library directly, set `PYTHONIOENCODING=utf-8`.

**Truncated reads in watch mode.** The game writes a multi-megabyte file over a
noticeable interval. Probing on the first size change parses a partial file and
fails in a way that also looks like a format problem. The watcher only probes a
file whose size has held steady across consecutive polls.

**Object names silently swapped for an unrelated constant sharing the same id.
FIXED 2026-08-30.** `constId` is reused across at least seven unrelated
namespaces in `game-constants.json` (terrain, object, attribute, terrainAlias,
objectAlias, civilization, mapType) — it is per-namespace data, not a single
flat id space. `load_constant_names()` used to bucket everything that was not
category `"terrain"` into one `objects` dict keyed only by id, so a later row
in the file silently overwrote an earlier one at the same id. The 2026-08-30
`--misc-constants` extraction appended `terrainAlias`/`objectAlias` rows after
the real `object` rows, and reading `RMSTEST_64`'s output printed GOLD (66) as
"RICE_FARM_SEEDS", STONE (102) as "GRAVEL_DESERT", and three more objects
under equally wrong names — a full, correctly-shaped histogram with the wrong
labels on it, which looks like a successful run and is not. **The tell was that
the ten printed names didn't match any of the ten `create_object` constants the
script itself declared**, not a crash or a warning. Now filters to exactly
`category in ("terrain", "object")` before either dict is populated. If a
future extraction pass adds another namespace, it is invisible by construction
rather than silently colliding — the two categories this script actually
reports on are named explicitly, not reached by exclusion.

## Two more, if you import this as a library rather than run it as a CLI

Both surfaced writing the RMSTEST_20 to 25 analysis, and both present as file
format errors.

**Do not wrap `sys.stdout` before importing `probe_scenario`.** It installs its
own UTF-8 wrapper at import time. Wrapping first puts two `TextIOWrapper`s over
one buffer, and when the orphaned one is collected it closes the buffer under
the live one. The library then dies mid-parse with `ValueError: I/O operation
on closed file`.

**Do not hold tile objects past their scenario's lifetime.** Tiles resolve their
owning scenario through a global store at attribute-access time, so a `.terrain_id`
read after the scenario is collected raises `Unable to find scenario based on
the given identifier`. Materialise what you need into plain tuples inside the
function that opens the file.

## Validating a change to these scripts

Point the probe at a map whose contents you specified yourself and check the
numbers against the script. `RMSTEST_8_terrainplaceon.rms` is the reference
case: it should report 216 GRASS, 98 DESERT, 9 DIRT and 14077 FOREST summing to
14400, with 25 GOLD and 1 STONE. Do **not** validate against mod scenarios —
they are trigger-heavy and unrepresentative of a generated map.
