# Amendment, 2026-11-02: the 14 maps the whole-script gate marks `known`

For age-of-rms, after the rev 11 pass (terrain, elevation, layer). It explains the 14 `known` maps in
`src/preview/__tests__/fixtures/de-whole-script-maps.json`. The study's model reproduces all 14 tile for tile, so
neither gap is an open question about DE. It corrects `de-terrain-stage.md` Sections 3 and 6 where they are ambiguous.
Our own words, as before; no game code.

| Maps | Count | Cause |
|---|---|---|
| `cg-x-menindee_1004/1005_n2-brit` | 2 | the drain under `terrain_mask 1` (Section 1) |
| `cg-x-bazi_*`, `ci-se-bazi_*`, `ci-st-bazi_*`, `cj-b05`…`cj-b38-bazi_*` | 12 | `#include_drs` files the preview cannot read (Section 2) |

## 1. Menindee: a drained tile takes the whole target, terrain included

**What the preview does wrong.** 11 tiles (8 at seed 1004, 3 at 1005). Each one is PALM_DESERT in the preview and
DESERT in DE, with the same layer in both (6 or 42). Elevation is the same, and no other tile differs.

**The rule.** At the end of a pass, the drain (`de-terrain-stage.md` Section 6) writes the pass's *target* into the
tile: the target terrain and the target layer, both. It does not paint the tile the way growth does.
- For a plain pass the target is (new terrain, no layer), so the two readings agree.
- For `terrain_mask 1` the target is (base terrain, new terrain as layer). A drained tile therefore gets the **base
  terrain**, whatever terrain it held. It does not keep its own terrain.

**How a tile that is not the base gets drained.** A clump's seed puts its four neighbours on the clump's list
without the base and layer test (Section 6, Seeds); only tiles added during growth are tested. The drain then pops
the list and needs only one thing: a left and a right neighbour on the map, both holding the target terrain and
target layer. It runs no base test, no layer test, no height test and no avoidance test, and spends no draw. So a
seed's neighbour that is not the base terrain, but ends up with the target on both sides, is drained into
(base, layer).

**Menindee's case.** Its passes like `create_terrain DIRT { base_terrain DESERT terrain_mask 1 … }` (and the same
with terrain 42) seed on DESERT tiles next to PALM_DESERT ones. The preview gives the drained PALM_DESERT tiles the
layer and leaves their terrain alone (t13 l6); DE writes DESERT under the layer (t14 l6).

**Evidence.** In DE's saved maps, every one of the 11 tiles has (14, 6) or (14, 42) on both its left and its right.
The study's model writes the target in the drain and matches both maps exactly. Tiles (x, y), DE value
(terrain, layer):
- 1004: (42,0), (53,5), (68,5), (85,5), (18,17), (11,38), (2,75) are (14, 6); (2,74) is (14, 42).
- 1005: (1,49), (12,54), (4,84) are (14, 42).

**Corrections to `de-terrain-stage.md`:**
- Section 6, Drain: "is painted as well" becomes "is given the target terrain and target layer (for
  `terrain_mask 1`, the base terrain with the new terrain as its layer), whatever it held".
- Section 3, the sentence "With `terrain_mask 1` the tile keeps its terrain": true for tiles painted by seeds and
  growth, not for drained tiles.

**Not tested on its own.** Under `terrain_mask 2`, the study's model also writes the target (new terrain, base
terrain as the layer). It does not move the tile's own old terrain under, as a growth paint would. No saved map has
a drained mask-2 tile whose terrain is not the base, so that part of the rule is the model's reading, not a
measurement.

## 2. Bazi: DE's own include files

**What the preview does wrong.** `24hr_Bazi` starts with lines such as `#include_drs includes/scaling.inc`,
`includes/constants.inc`, `includes/themes.inc` and `includes/cliffs.inc` (11 files). They define constants and
also run commands. Without them, nothing after that point agrees with DE.

**How DE reads them**, as the study's model does. With these rules it reproduces all 12 Bazi maps in terrain,
elevation and layer:
- The name resolves against the game's `resources/_common/drs/gamedata_x2/` folder (so `includes/constants.inc` is
  `…/gamedata_x2/includes/constants.inc`). The files are plain-text map script.
- The file's text is read in at the line, by the same preprocessor, so its `#const`, `#define`, `if` and commands
  count as if they were written there. An `#include_drs` inside a dead `if` branch reads nothing.
- A file that is not there reads as empty: Bazi includes `defend_wonder.inc`, which DE's folder lacks, and the map
  still generates. (Findings Section 2.)
- Bazi also needs a land without `terrain_type` to take terrain 0 (findings Section 3), which rev 11 already has.

**Decision (owner, 2026-11-02): read them from the player's game install.** Include files become one of the app's
capabilities. The preview reads `#include_drs` files from the player's own AoE2 DE folder, at
`resources/_common/drs/gamedata_x2/` under the install. They are Microsoft's content, so they are never copied into
the repo, a fixture or a build.
- Without an install, or with a file missing, the include reads as empty, as DE does with a missing file. The preview
  then says the map may not match DE because the script includes game files it could not read.
- The gate needs the same files. Run the 12 Bazi maps against them when the install is found. Without an install,
  skip those maps with that reason rather than failing them, and keep the `known` mark until the capability exists.
