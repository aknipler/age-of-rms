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

## Wanted next: the terrain restriction table

The highest-value thing this script does not yet read. The dat stores a
per-object `terrain_restriction_id` indexing a per-restriction row of allowed
terrains — the "terrain table" — and it decides where every object may stand.
Three separate approximations in the preview are waiting on it
(`preview-design.md` Sec.15 item 23): object habitat currently falls back to
`land` for anything the 16-entry object list does not cover, shore objects are
one hand-drawn band, and the trees a forest terrain spawns automatically are
drawn as a tint rather than emitted.

genieutils exposes the restrictions alongside the unit and terrain blocks this
script already walks, so it is an extraction job rather than an engine
measurement. Emit it as the `habitat` field the schema already declares
(`land`/`water`/`shore`/`any`) rather than as raw rows; the preview's
placement model is deliberately coarser than the table.

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
