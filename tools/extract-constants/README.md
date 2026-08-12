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

Five narrow modes exist alongside the full run, each rewriting only its own
fields. They are mutually exclusive, and each takes `--dry-run`.

| mode | writes | section below |
|---|---|---|
| `--ids-only` | `constId` only, no dat needed | above |
| `--colors-only` | `previewColor`, `minimapColor` | The two terrain colours |
| `--terrain-table` | `terrainRestrictionId`, `allowedTerrains`, `placementSideTerrain`, `habitat` | The terrain restriction table |
| `--classes` | `classId`, and the `objectClass` rows | Unit classes |
| `--storages` | `resourceStorages`, and a refreshed `resourceAmounts` | Resource storage |

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

Add `--terrain-table` to refresh **just** the engine's terrain table on object
entries, and the `habitat` derived from it, leaving every other field alone.
Pair it with `--dry-run` first — see "The terrain restriction table" below,
which is where that mode is documented in full.

```bash
python extract_constants.py --terrain-table --dry-run
```

It was called `--habitat-only` while the derived class was all it wrote, which
is the name the 2026-08-10 build-log entry uses.

They are mutually exclusive, and each one exists for the same reason: a full run
recomputes `verified` and rewrites `notes` wholesale, which is right when
re-extracting everything and wrong when adding one field to a working tree
carrying uncommitted reference-data edits.

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

## The terrain restriction table — `--terrain-table`

The dat stores a per-object `terrain_restriction_id` indexing a per-restriction
row of allowed terrains — the "terrain table" — and it decides where every
object may stand. It is now read, and the run that reads it writes four fields:

| field | what it is |
|---|---|
| `terrainRestrictionId` | the dat's own `Unit.terrain_restriction`, a key into the game's table |
| `allowedTerrains` | that row expanded to the terrain ids it permits |
| `placementSideTerrain` | the two-slot "must sit beside" requirement, `[-1, -1]` when there is none |
| `habitat` | our five-value reading of the three above |

```bash
python extract_constants.py --terrain-table --dry-run   # report only
python extract_constants.py --terrain-table             # take it
```

**The first three are a transcription and the fourth is a reading, which is why
all four are written.** The restriction id alone would be a key that resolves
to nothing outside an install, so the row travels with it; and `habitat` is a
five-value approximation whose cost is only visible next to what it
approximates. The order in the file says the same thing: the measurement
precedes our reading of it.

A row that no class fits still gets its first three fields. That case is
exactly where a five-value vocabulary is known to be inadequate, so it is the
last place to drop the measurement — pinned by
`TestMergeTerrainTable.test_writes_the_raw_table_even_when_no_class_fits`.

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
for the raw 131-terrain mask is the open question, and `allowedTerrains` is now
in the file rather than only in this process, so whoever takes it on starts
from a diff rather than from an argument. Nothing reads that field today:
retiring the classes changes `objects.ts`'s placement rules and belongs to
whoever measures what that does to the corpus.

Two more things the mode reports rather than acts on. A row it cannot
classify — an empty row, or a tie between the best two classes — keeps
whatever `habitat` the file already had, because picking one of a tie is a coin
flip wearing a measurement's clothes and no class fitting is not evidence that
the old reading is wrong. And a `placement_side_terrain` that the chosen class cannot express is
flagged: `shore` is `water` plus "must sit beside a beach", so the rule applies
cleanly to restriction 19, but the DOCK family carries the same `(2, 35)`
requirement over an `amphibious`-shaped row (restriction 6) and no class says
that. No DOCK is in the reference data today, so it reports and changes
nothing.

The mode is idempotent: it replaces the habitat clause in `notes` rather than
stacking another copy, pinned by `TestHabitatNote.test_is_idempotent` and
`TestMergeTerrainTable.test_is_idempotent_across_runs`, and confirmed against
the real file (a second run is byte-identical).

The report gained one line worth reading before the rest: **`RESTRICTION ID
MOVED`**, printed when the dat's restriction id for an object differs from the
one already in the file. It is the only result in the report that cannot be a
mistake of ours — a DE patch moved an object into a different row, and
everything the preview assumed about where that object stands is stale. It is
silent today because every id agrees.

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

## Resource storage — `--storages`

```bash
python extract_constants.py --storages          # add --dry-run to see the report first
```

This is the other half of what `src/parser/resourceTotals.ts` needs, the first
half being `--classes`.

**Why a raw field when `resourceAmounts` already exists.**
`effect_amount SET_ATTRIBUTE <target> ATTR_STORAGE_VALUE <n>` writes **slot 0**,
whatever that slot happens to hold, and the corpus does it 374 times across 16
maps. Whether such a line changes a map's food total depends entirely on the
slot's TYPE, and `resourceAmounts` has already thrown the type away by keying on
our own four-resource vocabulary. It also drops a zero amount, which is exactly
the value a script writes to switch a resource off (`24hr_Caverns.rms` and
`24hr_Holler.rms` both do).

So `resourceStorages` is the measurement and `resourceAmounts` stays the reading,
the same order the terrain table uses.

### What slot 0 actually holds, measured across the roster

| type | units | meaning | examples |
|---|---|---|---|
| 0 | 89 | food | BOARX 340, FORAG 125, DEERX 140 |
| 1 | 53 | wood | TREETD 125, BUSH 100 |
| 2 | 3 | stone | STONM 350 |
| 3 | 7 | gold | GOLDM 800 |
| 4 | 807 | population | HOUS 5 provides, LEGION -1 consumes |
| 12 | 533 | decay time | every `*_D` dead-unit record, 300 |
| 17 | 16 | fish food | FISH1-5 225, FISHS 200, WHAL1 200 |
| 9, 14, 56, 508, 514 | 11 | unread | SDOC 600, OREMN 400 |

guide:3599 annotates the attribute as "population support, tree wood amount,
decay time", which is types 4, 1 and 12. **The guide is describing the slot's
type varying, not three unrelated meanings**, and reading it that way is what
makes the attribute tractable at all.

### Type 17 was missing, and that is why FISH and SHORE_FISH were unverified

`RESOURCE_TYPE_INDEX` mapped only 0-3. Fish store their food under type **17**,
so the extraction dropped the value, read the absence as "the dat reports no
resource storage", and wrote a `CONTRADICTION` sentence into both entries along
with `verified: false`. That note has sat in the data since 2026-07-30, and its
own text guessed the cause correctly: *"suspect this script's Gaia-roster lookup
before the placeholder"*. The lookup was fine; this table had nowhere to put the
type.

Two independent readings confirm 17 is food, on two different numbers:

- guide:4999 says "FISH_A: a type of standard fish (225 food)", and the dat's
  FISH1-FISH5 (units 455-459) carry type 17 amount **225**.
- The hand-written entries claimed 200 food for FISH and SHORE_FISH, and the dat
  carries type 17 amount **200** for units 53 and 69.

All sixteen users of the type are a fish, a whale, a marlin, a turtle or a fish
trap. The run retracts the contradiction sentence in place rather than rewriting
the note wholesale, and prints which entries it retracted — it deliberately does
**not** flip `verified`, since that flag is a claim about the whole entry and
belongs to a human.

Effect on the file: 15 entries gained a `resourceAmounts` they never had, the
whole ocean-fish family plus DLC_BOXTURTLE, and OYSTERS turns out to be gold 450
rather than a food source.

### One character of collateral damage, found by accident

The retraction regex matched FISH and not SHORE_FISH, which made no sense until
the two notes were compared as codepoints. SHORE_FISH's em dash was stored as
`â` + `` + `` — the character's UTF-8 bytes decoded as latin-1, one
round trip through the wrong encoding somewhere in this file's history. It was
the only occurrence in all four reference data files, it survives every existing
gate (the schema types the field `string`, and a corrupted string is still a
string), and it left with the sentence that carried it.

`npm run validate:reference` now refuses double-encoded text anywhere in
`reference/data`, so a repeat is caught rather than waiting for the next regex
to trip over it.

## Unit classes — `--classes`

```bash
python extract_constants.py --classes            # add --dry-run to see the report first
```

An RMS author can aim `effect_amount SET_ATTRIBUTE` at a **class** rather than a
unit, and 374 of the corpus's uses do. `TREE_CLASS` alone covers 51 unit types.
Nothing in the reference data could resolve one, so a consumer asking "did that
line change the object I am about to place" had no way to answer at all.

**There is no class table in the dat to read.** A class is not a record, it is a
field every unit carries (`Unit.class_`), so the mapping exists only as a
groupby over Gaia's roster. That is why nothing could look a class up before,
and it is the whole of the extraction: 2642 live units, 57 classes.

The run writes both directions.

| field | on | what it is |
|---|---|---|
| `classId` | object rows | which class this object is in |
| `classId` + `memberIds` | new `objectClass` rows | the class, and every unit id in it |

`memberIds` covers the **whole roster**, not just the objects that have their
own row. That is the point of the field: the question is whether an object the
script places belongs to a class the script named, and an object with no row of
its own is exactly the case that gets asked about.

### Where the rows live, and why not in a file of their own

They are rows in `constants[]` with `category: "objectClass"`. A class IS an RMS
constant — `TREE_CLASS` is defined in `random_map.def` like anything else — so
it belongs in the same array under the same shape, and every consumer that
resolves a written name against `constants[]` picks it up for free. The 32
classes with no constant carry `rmsConstant: null`, which is the shape the 53
unnamed terrains already established. A separate array would have meant a second
schema, a second resolver and a second thing to keep in sync, for data of
exactly the same kind.

### The offset, and why the run refuses to write without it

`constId` is `classId + 900`. That offset is what lets the engine tell a class
target from a unit target, and every `memberIds` list is attached to a constant
by it — so if DE ever moves it, the output is confidently wrong rather than
missing. The run therefore verifies it first and **aborts on a contradiction**.

Verification is two checks and neither hardcodes anything:

- **Name stem.** `SHORE_FISH_CLASS` is 933, deriving class 33, and the object
  constant `SHORE_FISH` in the same file is unit 69 whose `class_` is 33. Two
  independent readings of one fact, linked only by the shared stem. Eight names
  can be checked this way.
- **Existence**, for the rest: the derived id must be a class some unit is in.

**A shared stem can still be a coincidence, and the first real run found one.**
`MONASTERY_CLASS` is 918, so it derives class 18 — which holds MONKX, HFRIAR and
PRIEST, the monk class. The object constant `MONASTERY` is unit 104, the
building, class 3. Both readings are right and they are about different things.
Aborting there would have blocked the extraction over a pun.

What separates a coincidence from a real offset error is measurable rather than
a judgement call: **a wrong offset is a constant shift, so every check fails at
once**. Confirmed by monkeypatching the base — at 900 the run writes with 23
confirmations, at 901 it aborts with 3 contradictions, at 0 it aborts with 24
and no confirmations at all. So one disagreeing row among agreeing neighbours is
reported and tolerated; a derived id no unit is in, or zero confirmations, is
fatal.

### Two things the run reports that are not errors

**116 units are in class -1** and are dropped. A negative class is the dat's "no
class", not a class with a negative number, so there is nothing for a constant to
name — writing it would mint `constId 899` for a name no author can write. The
count is printed because a jump in it means a DE patch reclassified something.

**DOLPHIN and PERCH take no `classId`.** Both deliberately carry `constId: null`
(the id was never needed and guessing it would have been a second claim), so
there is no unit to look up. That is the existing decision showing through, not
a new gap.

### What this does not finish

`src/parser/resourceTotals.ts` is the caller that wants this — `ATTR_STORAGE_VALUE`
rewrites what an object yields and the status bar reports the base value
regardless — and classes are only half of what it needs. The other half is
knowing which meaning `ATTR_STORAGE_VALUE` carries for a given unit, since the
guide's own annotation for attribute 21 is "population support, tree wood
amount, decay time". A unit's `resource_storages` says which resource it holds
and is readable in the same pass whenever that work starts.

## The gaia roster (`--roster`)

```bash
python extract_constants.py --roster --dry-run   # report only
python extract_constants.py --roster             # take it
```

Every other mode fills fields on rows that already exist. This one CREATES
rows, one per live gaia unit, and it is the mode to re-run after a DE patch adds
units. It took the object table from 33 rows to 2672.

Why it exists. With 33 rows against a roster of 2642 live units, almost every
object a real script places has no entry, so the preview falls back to a `land`
habitat for all of them. `AD4 - Pag - v1.2.rms` defines
`#const ONGRID_PLACEHOLDER_NAVAL 1546`, which is a water unit, and grew 116 of
them in a desert with a stranded fish on each. That is the case the mode was
written for.

### One row per name, not one per id

Rows are keyed by `constId`, with `rmsConstant: null` where the unit has no
name, which is the shape the 53 unnamed terrains and 32 unnamed classes already
use. A name-keyed table can never reach unit 1546, because it has no `#const` in
`random_map.def` at all.

Pure id-keying is not available either. 618 object names cover 590 ids, since
`FISH` and `FISH_PERCH` are both unit 53 and six more pairs behave the same way,
and both spellings are ones a script may have written. So a named unit gets a row
per name and an unnamed unit gets a single row. `objectEntry` in
`src/preview/generator/objects.ts` resolves a written name first and a resolved
id second, so both forms keep working.

### Where a name comes from

DE ships its own display text in
`resources/en/strings/key-value/key-value-strings-utf8.txt`, 19,377 entries,
joined to a unit by `Unit.language_dll_name`. That is the first source, 1324
rows. A unit with no display string falls back to the dat's internal `Unit.name`
verbatim, 1315 rows, which is why the file contains entries like
`PLACEHOLDER (NAVAL)` and `ARCHR_D`. The internal code is the game's own text
rather than an invention, so it is written as it stands. Do not paraphrase one
into something friendlier, because that would be a claim about a unit nobody has
looked at.

Put through the same check `--terrain-table` uses, DE's strings reproduce 14 of
the 31 comparable hand-written names exactly and disagree on 17, every
disagreement being DE saying something more specific such as `Grey Wolf` for
`Wolf` and `Fish (Tuna)` for `Tuna`.

**Existing rows are never overwritten and the disagreement report is the point.**
Each run prints the 17 and leaves them alone. Two of them lose information rather
than gaining precision, `King (Regicide)` becoming `King` and both Marlins
collapsing onto `Great Fish (Marlin)`, so `descriptiveName` is no longer unique
and these are settled one row at a time by hand.

### `isCorpse`, and the two derivations that do not work

336 of the units are death variants, and a reference table offering them beside
DEER is a list nobody can read, so the app hides them behind a toggle. Two
obvious rules were tried and rejected before the one that shipped.

- The `*_D` name suffix is a pattern, so it is a claim about every name nobody
  has read, which is the same trap the habitat classes avoid.
- `Unit.type` looks like the data answer and is not. 329 of the 336 carry type
  30, and so do DEER, SHEEP, WOLF and 13 other rows already in the file.

What works is a LINK rather than a label. A unit named by some other unit's
`dead_unit_id` or `blood_unit_id` is a carcass, guarded by the row carrying no
RMS constant, because 5 of the 506 referenced units do carry one and `FORAGE`
(59) is among them. 501 rows are marked. It under-reaches by about 44 units,
which is the safe direction, since a row wrongly visible is a row in a list and a
row wrongly hidden is a unit an author cannot find.

### What a roster row deliberately leaves out

A field that is a pure function of another field is not data, it is file size.
The first write came out at 3.5 MB and two fields were 2.4 MB of it.

| left out | why |
|---|---|
| `allowedTerrains` | A pure expansion of `terrainRestrictionId`, and the whole roster references only 33 distinct restriction ids. Nothing in `src/` reads it. Run `--terrain-table` when the expansion is wanted. |
| `deTextureFile: null` | Terrain field, never populated on an object row. |
| `placementSideTerrain: [-1, -1]` | The "must sit beside" pair, absent on all but three units. |
| per-row `notes` boilerplate | Replaced by one clause naming the mode and the run date. |

The result is 1.33 MB for 2639 new rows, which is roughly 400 bytes each and
about the floor for a self-describing JSON row.

### One thing to watch on a re-run

`validate:reference` is the gate that caught the only real defect here, 116 times
over. Roster rows were writing `classId: -1` for units in the dat's unnamed
class, which `--classes` deliberately gives no `objectClass` row, so referential
integrity failed. Class -1 is skipped rather than written, because absent is the
honest value for a unit in no class an author can name. Run
`npm run validate:reference` after taking a roster run.

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

**No AoE2:DE install was available to test against while writing this**, which
is why the section reads as it does. Four real runs have happened since and
each corrected something the unit tests could not see: the first (2026-07-30)
found the terrain→texture join crossing two id spaces, `--colors-only`
(2026-08-05) found `Terrain.colors` to be a 12-value legacy class,
`--terrain-table`'s habitat half (2026-08-10) refuted its own derivation on the
fish row, and its raw half (same day) confirmed every restriction id already in
the file. **The `DatExtraction` caveats below still stand** — none of those runs
is a test, and none of them runs in CI. Everything independently testable
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
`src/parser/resourceTotals.ts` does not currently account
for those modifiers when computing the status-bar totals — tracked as
known debt in `CLAUDE.md`, not something this script's scope covers.

**The data side of that debt is now closed, and the consumer side is not.**
`--classes` answers "which objects does this line target" when the target is a
class, and `--storages` answers "does slot 0 hold a resource, and which one".
Between them a consumer can resolve
`effect_amount SET_ATTRIBUTE TREE_CLASS ATTR_STORAGE_VALUE 200` down to a set of
unit ids and a resource bucket. Nothing reads either field yet. What remains is
in `resourceTotals.ts` itself: walk `<PLAYER_SETUP>`'s `effect_amount`
commands, resolve each target through the game constants, the script's own
`#const`s and the class rows, and apply the override before summing. Note the
ownership split (`SET_ATTRIBUTE` against `GAIA_SET_ATTRIBUTE`) and
`GAIA_UPGRADE_UNIT`, which changes yields by replacing one unit type with
another, are both still unmodelled.
