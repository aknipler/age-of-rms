# tools/extract-constants — Phase 4.0

Regenerates `reference/data/game-constants.json` from a maintainer's own
local AoE2:DE install. **This is a dev-side tool, never invoked by the
shipped app.** End users never run this, never need Python, and never
need AoE2 installed — they just get the committed JSON. Only whoever
re-extracts after a DE patch runs it, then PRs the diff (per
`PLAN.md`'s "Reference DB approach").

## Why this exists / why two data sources

`game-constants.json` needs, per RMS constant name (`GOLD`, `GRASS`, ...):
a numeric ID, and — for terrains — a texture filename, or — for
resource objects — the resource amount(s) it yields.

Investigating this (see the design conversation in `docs/build-log.md`) turned up something that simplifies half the problem:
DE ships a plain-text file, **`random_map.def`**, using ordinary RMS
`#const NAME <id>` syntax, auto-included in every random map script.
That's the entire RMS-constant-name → numeric-ID mapping, and it needs
no binary parsing at all — just a text scan (`parse_random_map_def` in
`extract_constants.py`).

The numeric ID then unlocks the rest from **`empires2_x2_p1.dat`** (the
compiled game-data file): terrain → texture filename, object → resource
yield.

## Library choice: genieutils-py (LGPL-3.0)

Compared before writing any code:

| Option | License | Maintenance (as of this writing) |
|---|---|---|
| **genieutils-py** (SiegeEngineers) — chosen | LGPL-3.0 | Active; explicitly supports current DE format versions (`GV_C20`+ / FileVersion 7.7+); same org as `aoe2techtree`/`mgz` |
| genie-dat (Node/JS) | LGPL-3.0 | Last commit 2020 — predates a lot of DE format evolution, real risk of silently-wrong output on current DE |
| genieutils (C++ core) | LGPL-3.0 | Active but lower-level; genieutils-py already wraps it |

Genieutils-py is a runtime dependency of this
standalone dev script only — never linked into or shipped with the
Tauri/React app — so LGPL-3.0's linking obligations don't reach the
GPL-3.0 app at all.

## Legal posture (PLAN.md open question #2)

Both sources are read from the **maintainer's own local install** at
extraction time. Nothing of Microsoft's binary data is committed —
only the derived shallow facts this script writes out (IDs, names,
numbers), the same class of data `aoe2techtree` (MIT, explicitly citing
Microsoft's Game Content Usage Rules) and the whole `genieutils`-based
tool ecosystem have redistributed for years without incident.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

```bash
python extract_constants.py --install-path "C:\Program Files (x86)\Steam\steamapps\common\AoE2DE"
```

Omit `--install-path` to try a few common Steam install locations
first. Add `--ids-only` to skip `empires2_x2_p1.dat` entirely (just
fills in `constId`) if genieutils-py can't parse your DE version's dat
file — file format assumptions get out of date; this keeps half the
tool useful even then.

Add `--colors-only` to refresh **just** the two terrain colour fields
and leave every other field, and the rest of each entry's `notes`,
exactly as they were:

```bash
python extract_constants.py --colors-only
```

**That run has been done (2026-08-07)** and it is worth recording what it
produced, because it is the first time `--colors-only` ran against a table
this script did not itself build. The same review had expanded
`game-constants.json` from 15 terrains to all 131 from the community DE
table in `reference-docs/`, leaving 96 without a `previewColor`. After the
run: **121 of 131 terrains have `previewColor` and all 131 have
`minimapColor`.** The hand-added `isWater`/`isForest`/`habitat` fields
survived untouched, which is what `CONSTANT_KEY_ORDER` exists to guarantee.

The 10 still without a `previewColor` are correct and will stay that way:
they are the legacy two-texture blends (`DIRT_SNOW`, `GRASS_SNOW`,
`DLC_MOORLAND`, `DLC_DRYROAD`, `DLC_JUNGLEROAD`, `DLC_JUNGLELEAVES`,
`DLC_ROADGRAVEL` and three unnamed siblings), whose `deTextureFile` is
deliberately null because the terrain is drawn from two files at once —
the same set guide:1513 lists as "already a blend of two texture files"
and unable to be visually masked. There is no single texture to average.
They fall back to `minimapColor`, which they all have.

This is the mode to reach for after a DE art patch. It is deliberately a
separate code path from a full run (`merge_terrain_colors`, not
`merge_entry`) because a full run recomputes `verified` and rewrites
`notes` wholesale, which is right when re-extracting everything and wrong
when adding one field to a working tree that carries uncommitted
reference-data edits. Both modes are idempotent — re-running replaces the
previous colour sentence in `notes` rather than stacking another copy,
which is pinned by `test_is_idempotent_across_runs`.

Add `--habitat-only` to refresh **just** the `habitat` field on object entries
from the engine's own terrain table, leaving every other field alone. Pair it
with `--dry-run` first — see "The terrain restriction table" below, which is
where that mode is documented in full.

```bash
python extract_constants.py --habitat-only --dry-run
```

The three narrow modes are mutually exclusive, and each one exists for the same
reason: a full run recomputes `verified` and rewrites `notes` wholesale, which
is right when re-extracting everything and wrong when adding one field to a
working tree carrying uncommitted reference-data edits.

## The two terrain colours, and why there are two

Terrain entries carry `previewColor` and `minimapColor`, and the preview
pane toggles between them. They come from different files and answer
different questions:

| Field | Source | What it is good for |
|---|---|---|
| `previewColor` | mean of the opaque texels of `resources/_common/terrain/textures/<deTextureFile>.dds` (needs Pillow) | Per terrain. Snow looks like snow. Terrains sharing a texture file share a colour — `FOREST` and `LEAVES` are both `g_for` |
| `minimapColor` | `Terrain.colors[0]` from the dat, decoded through `resources/_common/palettes/original.pal` | The game's own colour class. Flat and readable, and it separates `FOREST` from `LEAVES` |

**Read this before "fixing" minimap mode.** `Terrain.colors` holds palette
indices rather than RGB, which is what the preview spec recorded as "not
yet decodable". Decoding it is easy — `original.pal` is a plain-text
JASC-PAL file — and it is *not* the whole answer: across the 131 enabled
terrain records that field takes only **12 distinct values**. It is a
legacy colour class, so every snow variant genuinely carries grass's
green. Minimap mode drawing snow as grass is the data faithfully
reported, not a bug here, and it is why `previewColor` is the default.

The script prints a resolved/unresolved count and a sanity-check table
for a few well-known objects (GOLD, STONE, FORAGE, SHEEP) — eyeball
those before committing; if they look wrong, the resource-type index at
the top of `extract_constants.py` (`RESOURCE_TYPE_INDEX`) is the
convention to double check first.

After running:

```bash
npm run validate:reference   # from the repo root
```

then review the `git diff` on `reference/data/game-constants.json`
before committing, same as any other reference-data change.

## The terrain restriction table — `--habitat-only`

The dat stores a per-object `terrain_restriction_id` indexing a per-restriction
row of allowed terrains — the "terrain table" — and it decides where every
object may stand. It is now read, and the run that reads it writes `habitat`:

```bash
python extract_constants.py --habitat-only --dry-run   # report only
python extract_constants.py --habitat-only             # take it
```

**Run `--dry-run` first and read the report, every time.** The report is the
point of this mode rather than a courtesy. Every `habitat` in the file was
assigned by hand on 2026-08-08 from a handful of restriction rows read one at a
time, so the automated answer can be checked against the hand answer on the
entries where both exist — and on the first real run it disagreed, correctly
(see below). A mode that silently overwrote them would have thrown that away.

**The first real run (2026-08-10) agreed with every hand assignment** and added
13 habitats to entries that had none: nine ordinary fish stayed `water`,
SHORE_FISH and DLC_BOXTURTLE stayed `shore`, the great fish, OYSTERS and
TRANSPORT_SHIP stayed `amphibious`. The 13 additions are the land family
(GOLD/STONE/FORAGE, DEER/BOAR/SHEEP/WOLF, RELIC/VILLAGER/KING, HOUSE and
TOWN_CENTER) plus MONUMENT, which is `any` because it resolves to unit 826
`KOH-FLAG`, a King-of-the-Hill marker the engine really does allow anywhere.

Both are worth knowing before reading a diff. Writing `land` where the field
was previously absent is **not** a no-op even though the generator's fallback
for an absent habitat is also `land`: it flips `habitatIsData`, which is what
decides whether an author's `terrain_to_place_on` narrows the habitat or
replaces it. That is the intended effect — the fallback is a guess and these
are measured — but it is a behaviour change, not a documentation change.

### It is a distance, not a chain of predicates

The derivation picks **the class whose own terrain set is closest to the
engine's row**, smallest symmetric difference winning, and the classes are
transcribed from `objects.ts`'s `habitatMask` rather than paraphrased from the
schema's prose.

It first shipped as an ordered chain instead — `any`, `shore`, then
`amphibious` if the row permits any hybrid, else `water` — and the first run
against a real install refuted it on the exact family this work was about.
Restriction 19 (every ordinary fish) permits 15 terrains: 14 open water plus
**26, `Ice, Navigable`**, which carries `isHybrid` in our own terrain table. One
hybrid tripped the test and made all nine fish rows `amphibious`, undoing the
2026-08-08 `water`/`amphibious` split and putting fish back on the shallows.

A distance has no threshold to get wrong, and it separates the cases by a
margin rather than a hair:

| row | objects | permits | best | runner-up |
|---|---|---|---|---|
| 19 (ordinary fish) | 12 | 15 | **water**, differs on 1 | amphibious, 18 |
| 13 / 3 / 15 (great fish, OYSTERS, TRANSPORT_SHIP) | 21 | 38 | **amphibious**, 5 | water, 24 |
| 0 (unrestricted, incl. FISH_PLACEHOLDER) | 72 | 131 | **any**, 0 | land, 21 |
| 7 (most land objects) | 177 | 116 | **land**, 8 | any, 15 |

The `mismatch` column is the honest half of the answer, so it is written into
each entry's `notes` and printed worst-first. **The land family fits worst**:
restriction 8 (GOLD/STONE/FORAGE) permits 83 of the 110 terrains `land` covers,
so there are 27 terrains where the engine says no and the preview will still
place. That is the cost of a five-value vocabulary, not an error in the join,
and `land` still wins by a wide margin. Whether the classes should be retired
for the raw 131-terrain mask is the open question; `allowed_terrains` is
already there for whoever takes it on.

Two more things the mode reports rather than acts on. A row it cannot
classify — an empty row, or a tie between the best two classes — is **left
alone**, because picking one of a tie is a coin flip wearing a measurement's
clothes. And a `placement_side_terrain` that the chosen class cannot express is
flagged: `shore` is `water` plus "must sit beside a beach", so the rule applies
cleanly to restriction 19, but the DOCK family carries the same `(2, 35)`
requirement over an `amphibious`-shaped row (restriction 6) and no class says
that. No DOCK is in the reference data today, so it reports and changes
nothing.

The mode is idempotent: it replaces the habitat clause in `notes` rather than
stacking another copy, pinned by `TestHabitatNote.test_is_idempotent` and
confirmed against the real file (a second run is byte-identical).

### The namespace split, which was the actual blocker

The dat read is four lines. What stood in the way was that `random_map.def`'s
ids are **per namespace and collide freely** — id 45 is `DOCK` and also
`CUSTOM`, `DLC_CRACKED`, `CIVILIZATION_GEORGIANS` and `ATTR_BLAST_DEFENSE`; id
61 is the dolphin unit and also `DLC_JUNGLEROAD` and `ATTR_CHARGE_EVENT`. 1083
of the 1114 constants "resolve" to a gaia unit slot and most of those
resolutions are meaningless, so a flat join would have confidently given
civilizations a terrain habitat.

The split is in the file itself, in the `/* SECTION */` comments that
`strip_rms_comments` throws away, so `parse_random_map_def_sections` is
deliberately line-based rather than built on it. `object_constants` then keeps
the five object sections and drops `STRING_*` (localisation ids) and `*_CLASS`
(unit-class ids, a third id space). 1114 flat names become **618 object names**.

Two traps, both hit while writing it and both now pinned by a test:

- **A commented-out `#const` looks exactly like a section header.** The file
  carries 35 of them (`/* #const ARCHER    4 */`). Treating those as headers
  shattered `EXPORTED FROM THE DATABASE` into 40 one-line sections and cut the
  object namespace from 651 names to 69 — a failure quiet enough to ship,
  because every name it kept was still correct. What it actually does is move
  every name *below* the comment out of the namespace.
- **Titles are decorated with dashed rules** (`/*-----*/`), which carry no
  title and must not reset the section.

The join was then checked the other way, which is the check this blocker
actually needed: every one of the 31 resolvable object constants points at a
unit whose own name in the dat matches it — `GOLD`→`GOLDM`, `SHORE_FISH`→
`FISHS`, `TUNA`→`FISH3`, `OYSTERS`→`Oysters`. A join that resolves is not a
join that is right.

### The read itself

The join is:

```python
df   = DatFile.parse(".../resources/_common/dat/empires2_x2_p1.dat")
unit = df.civs[0].units[object_id]                  # civ 0 is gaia, 2701 slots
row  = df.terrain_restrictions[unit.terrain_restriction].passable_buildable_dmg_multiplier
allowed = [tid for tid, v in enumerate(row) if v > 0]   # 131 floats, > 0 = permitted
```

53 restriction rows × 131 terrains, wrapped as `DatExtraction.placement`.
Object ids come from `object_constants` rather than `parse_random_map_def`, for
the namespace reason above. The second field taken in the same pass is
`unit.placement_side_terrain`, a two-slot "must sit beside" requirement that is
`(-1, -1)` for almost everything and `(2, 35)` — Beach or Ice — for exactly
SHORE_FISH, DLC_BOXTURTLE and the DOCK family. That pair of fields is the whole
of the preview's `shore` habitat. (`unit.placement_terrain`, "must stand ON",
is unused across the roster.)

Note the table is also mutable at run time from inside a script, via
`effect_amount SET_ATTRIBUTE <object> ATTR_TERRAIN_ID <n>`, which no static
extraction can capture. `Menindee_AUS_v2.3.rms` uses it ten times.

## If the dat parse breaks: the Advanced Genie Editor

DE ships the **Advanced Genie Editor** under `Tools_Builds/` in the
install root. It reads the same `empires2_x2_p1.dat` this script parses,
but as a maintained GUI rather than a third-party format guess, so it
survives patches that break genieutils-py. It is almost certainly how the
community terrain table in `reference-docs/` was compiled in the first
place — by reading values out and typing them into a sheet.

Reach for it when a run reports `failed to parse empires2_x2_p1.dat` or
returns values that fail the sanity check the script prints. It does not
replace this tool (nothing about it is scriptable or idempotent), but it
is a way to confirm a handful of fields by hand and to tell a genuine
data change apart from a format-parsing regression.

## Testing status — read before trusting a run

**No AoE2:DE install was available to test against while writing this**. Everything independently testable
without one *is* tested — `test_extract_constants.py` covers the
`random_map.def` parser and the JSON merge/formatting logic (including a
byte-identical round-trip regression test against the real, current
`game-constants.json`). Run it:

```bash
python -m unittest test_extract_constants.py -v
```

**What is NOT tested**: `DatExtraction` (the genieutils-py-backed half —
terrain texture lookup, unit resource-storage lookup) and the exact
`random_map.def` file location DE actually uses. Concretely, before
trusting a real run's output:

- The script searches recursively under `--install-path` for
  `random_map.def` and `empires2_x2_p1.dat` rather than assuming a fixed
  subpath, specifically because that path wasn't independently
  confirmed. If it finds none, or finds more than one, it says so.
- `RESOURCE_TYPE_INDEX` (`0=food, 1=wood, 2=stone, 3=gold`) is the
  standard genie-engine convention used across this whole tooling
  ecosystem, not something read out of the dat file as a label — verify
  it against the printed sanity-check table on your first real run.
- If `DatExtraction` throws on your DE version (genieutils-py's format
  support can lag a patch or two), `--ids-only` still gets you real
  `constId` values, which is most of the value.

## `resourceAmounts` caveat — base value only

RMS scripts can override an object's resource amount at generation time via 
effect/resource-delta style commands. What this script (and `game-constants.json`) 
records is the **unmodified base value from the game's data files** — the number 
a plain `create_object GOLD` gets before any such script-level modifier.
`src/parser/resourceTotals.ts` (Phase 2.5) does not currently account
for those modifiers when computing the status-bar totals — tracked as
known debt in `CLAUDE.md`, not something this script's scope covers.
