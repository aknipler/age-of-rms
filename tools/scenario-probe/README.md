# tools/scenario-probe — Phase 4.1

Measures an RMS-generated map **exactly**, by reading a scenario export from a
maintainer's own DE install. Dev-side only, never invoked by the shipped app and
never shipped to users.

## Why this exists

The Phase 4.1 verification pass ran nine minimal scripts in DE's editor and read
the results off screenshots. That worked for every *binary* question ("is the
gold on the dirt or not") and answered no *numeric* one, because nobody can
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

| Flag | Gives | For |
|---|---|---|
| `--bbox TERRAIN` | bounding box and per-edge inset | border arithmetic, Sec.4 |
| `--clusters OBJECT` | object blobs (4-connected) and the gaps between them | group spacing, Sec.6.6 |
| `--patches TERRAIN` | terrain patches (4-connected) with area, centroid, bbox, circularity | cross-shaped land area, clumping regimes |
| `--rows TERRAIN\|ELEVATION` | banded row and column histogram plus the mean on each axis | elevation south bias, border fuzziness depth |

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
cp1252 console that raises `UnicodeEncodeError` *during parsing*, which reads as
a format incompatibility and is not. Both scripts force UTF-8 stdout at import.
If you call the library directly, set `PYTHONIOENCODING=utf-8`.

**Truncated reads in watch mode.** The game writes a multi-megabyte file over a
noticeable interval. Probing on the first size change parses a partial file and
fails in a way that also looks like a format problem. The watcher only probes a
file whose size has held steady across consecutive polls.

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
