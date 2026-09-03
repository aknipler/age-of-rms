# RMSTEST scripts

Minimal RMS scripts whose only job is to make one open question in
`docs/preview-design.md` produce a number. Each one isolates a single constant
or rule, states its predictions in its own header **before** the run, and names
the reading that would refute it.

Dev-side only. These are not example maps and several are deliberately
degenerate, which is why they live here and not in `test-maps/`. The parser
corpus gates glob `test-maps/`, so putting them there would shift the
diagnostic counts that every corpus measurement is compared against.

`RMSTEST_1` through `RMSTEST_19` are the engine-verification programme that
produced rev 6, and their headers carry the read-off tables from those runs.
`RMSTEST_20` onward are the calibration batches below. **Batches 1 through 9 have
all been run. Batch 10 was written, generated and read on 2026-08-11** — see its
results table; five of its scripts (`52`–`56`) are still to generate. Each batch
heading carries its own status and that is the one to trust: this line went stale
for months while results from those very batches were being cited in the specs,
which is worth one glance before believing any "not yet run" anywhere in the repo.

## A WORD valued 69 in a comment deletes the rest of the file

**Measured, four runs, and the scope is exactly two engine constants.**

| leading comment contains | map |
|---|---|
| nothing (`56b`, control) | **snow** — the script ran |
| `SHORE_FISH`, object 69 (`56a`) | **blank grass** |
| the bare literal `69` (`57`) | **snow** — literals do not participate |
| `ATTR_PROJECTILE_ARC`, attribute 69 (`60`) | **blank grass** |

`/*` is token 69. A **word** resolving to 69 opens a nested comment; comments
nest, so the author's closing `*/` shuts only the inner one and everything after
it is invisible to the engine. The map still generates, as a blank default, and
nothing reports an error. Numeric literals are lexed as numbers and never reach
the symbol table. The namespace is irrelevant — that is what `60` establishes,
using an attribute constant against `56a`'s object one.

**The complete engine-defined set is two names.** `random_map.def` is loose in
the install at `resources/_common/drs/gamedata_x2/` — no archive extraction — and
contains exactly two constants valued 69: `SHORE_FISH` (line 263) and
`ATTR_PROJECTILE_ARC` (line 1117). Plus any script-level `#const NAME 69`.

This is what blanked `RMSTEST_42` and cost a run. Filed as BUG-012, with an
escalation inside it: whether the parser should *model* the truncation or only
diagnose it pits two CLAUDE.md hard rules against each other.

**Still open: the closing marker.** Nothing defines `/*` or `*/` in
`random_map.def`, so the marker IDs live in the engine's internal token table.
The `*/` ID is unknown, so the words that would *close* a comment early are
unenumerated — less destructive, since the file still runs, but noisier. That is
the only part of this that still wants the Equivalencies sheet.

### The house rule

**Headers go at the BOTTOM of the file, below the script, from `RMSTEST_44` on.**
A leading comment can swallow everything after it; a trailing one has nothing
left to swallow. Each script opens with a short pointer.

With the set enumerated, the sufficient rule is just "do not write those two
words, or a `#const` equal to 69, above your script". Keep the position rule
anyway: the `*/` side is unenumerated, and **a blank map is indistinguishable
from a script error, a bad map design, or a genuine "nothing placed" result** —
which is what a large fraction of these tests measure. A run that comes back
empty is not a reading until the file is cleared.

## Running them

Copy the `.rms` files into the DE install's random map scripts folder:

```
<install>/resources/_common/random-map-scripts/
```

Then leave the watcher running in one terminal:

```bash
python watch_scenarios.py
```

In the scenario editor, for each script: **Random Map location** → pick the
script → set the map size and player count its header asks for → **Generate
Map** → **Menu ▸ Save As**. Output appears in the watcher a second or two later.

The watcher prints the default histograms. For the per-script reading, run
`probe_scenario.py` directly with the flags named in that script's header.

**Saved scenarios do NOT land in the install.** DE writes them under the user
profile, in the Steam-id folder rather than the `0` one beside it:

```
C:/Users/<you>/Games/Age of Empires 2 DE/<steam-id>/resources/_common/scenario/
```

The scripts go in the install (`resources/_common/random-map-scripts/`) and the
exports come out of the profile, which is the one path pair worth writing down.
A probe invocation that "cannot find the file" is nearly always this and not a
bad export, so list that directory by modified time before debugging anything.

## Batch 1 (RUN, 2026-08-01) — items 1, 2, 3

| Script | Sec.15 | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_20_terrainclump` | item 3 | Normal, any players | 2 | `--patches <each terrain>` |
| `RMSTEST_21_landclump` | item 3 | Normal, any players | 2 | `--patches <each terrain>` |
| `RMSTEST_22a_southbias` | item 1 | Tiny, any players | 3 | `--rows ELEVATION` |
| `RMSTEST_22b_balancedelev` | item 1 | Tiny, any players | 3 | `--rows ELEVATION` |
| `RMSTEST_23_borderfuzz` | item 1 | Normal, any players | 5 | `--bbox <each>`, `--rows <each> --bands 20` |
| `RMSTEST_24_defaultcircle` | item 1 | **Tiny, 8 players** | 5 | `--patches GRASS` |
| `RMSTEST_25_crossarea` | item 2 | Tiny, any players | 5 | `--patches SNOW` |
| `RMSTEST_26_object_connectivity` | tool check | Normal, any players | 1 | `--clusters GOLD` |

Twenty five generations. 22a and 22b are a matched pair and belong in the same
sitting, because the whole comparison rests on nothing differing between them
except the one attribute. Results are folded into the spec; see the build log.

## Batch 2 (RUN, 2026-08-04) — everything else that needs the game

Written 2026-08-02. This is every remaining open question in Sec.15 that an
export can answer, plus the RMS0304 blocker.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_27_negcircle` | negative `circle_radius` | **Tiny, 8 players** | 5 | `--patches GRASS` |
| `RMSTEST_28a_cfneg` | item 13 | Normal, any players | 3 | `--patches SNOW` |
| `RMSTEST_28b_cfzero` | item 13 (control) | Normal, any players | 3 | `--patches SNOW` |
| `RMSTEST_29_zonebyteam` | item 14 | **Normal, 8 players, teams set** | 3 each config | `--patches GRASS` |
| `RMSTEST_30_groupedbyteam` | item 15 | **Normal, 8 players, teams set** | 1 each config | `--patches GRASS` |
| `RMSTEST_31_cliffspacing` | item 12 | Normal, any players | 3 | `--patches SNOW`, `--clusters <cliff>` |
| `RMSTEST_32_elevsize` | item 11 | **Normal, 8 players** | 3 | `--rows ELEVATION --bands 20` |
| `RMSTEST_33a_sectionlock_terrain` | RMS0304 debt | Normal, any players | 1 | default histogram |
| `RMSTEST_33b_sectionlock_object` | RMS0304 debt | Normal, any players | 1 | default, `--clusters GOLD` |

Thirty two generations, counting 29 as two configurations and 30 as three.

**Read this before committing a sitting to it.** `RMSTEST_29` and `RMSTEST_30`
need TEAMS, which come from the lobby and not from RMS. Check first that the
scenario editor will let you set teams for a random map. If it will not, those
two have to be run from a real game lobby with the script as the selected map,
and finding that out after generating everything else wastes the sitting.
Everything else in the batch runs in the editor exactly like batch 1.

Suggested order, cheapest and most independent first: 33a, 33b, 28a, 28b, 27,
31, 32, then the two team scripts last so a team-setup problem costs the least.

Matched pairs that belong in one sitting: 28a with 28b, 33a with 33b. `27` is
already matched against `RMSTEST_24`'s measured result, so it needs no control
run of its own — but only if it is generated at Tiny with 8 players, exactly as
24 was.

## Three rules this batch is built on

**Measure a counted quantity, never a grown one where a counted one will do.**
Item 7(d) spent a whole round discovering that growth overshoots its budget by
about 3 percent with real run to run spread, which means any reading taken off
a grown tile count carries that noise. Where a question can be put to a
position or a centroid instead, it is.

**Beware auto-generated terrain.** DE paints a BEACH ring at every land and
water boundary, and forest terrain auto-places a tree object per tile. The
first attempt at item 7(c) used a WATER base, got a 432 tile beach ring that
shifted every edge by one, and read as a format error rather than as a game
behaviour. Every script here avoids water, beach, forest and leaves for that
reason, and says so in its header.

**Write the prediction down first.** Rev 6's process note is the argument: four
rounds of critique converged on internal consistency and the round that
actually touched the engine deleted the thing they had spent the most words on.
A prediction recorded before the run is what makes a wrong one undeniable
afterward.

## After the run

Fold the numbers into the relevant `preview-design.md` section, strike the
`[tune]` marker on anything now measured, and update Sec.15. Record what the
reading was, not just the conclusion, so the next revision can tell a
measurement from an inference. Then append the session to `docs/build-log.md`.

## Batch 3 (RUN, 2026-08-04) — three re-tests, written 2026-08-04

Batch 2 ran on 2026-08-04. Four questions closed (items 12 and 13, the RMS0304
blocker, and negative `circle_radius`). **Three did not, and all three failed
for instrument reasons rather than for want of data** — the scripts measured
something other than what they were written to measure. Each of these changes
exactly one thing against its predecessor.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_34_zonerange` | item 14, replaces 29 | **Normal, 8 players, NO teams (plain FFA)** | 3 | `--patches GRASS` + min-distance per probe terrain |
| `RMSTEST_35_elevnolands` | item 11, replaces 32 | Normal, any players | 3 | `--rows ELEVATION --bands 20` + diagonal split |
| `RMSTEST_36_groupedclean` | item 15, replaces 30 | **Normal, 8 players, teams set** | 2 at 4v4 + **3 at 5v1v1v1** | `--patches GRASS` |

Eight generations. `34` and `35` need no team setup at all; only `36` does, and
the `RMSTEST_30` re-run already proved the editor can set teams (it produced a
correct 4v4 as `[1,3,5,7]` vs `[2,4,6,8]`).

**`RMSTEST_36` must be run at BOTH configurations.** 4v4 alone cannot separate
the two readings under any instrument — that is the whole reason item 15 is
still open after three runs of `RMSTEST_30`. The 5v1v1v1 runs are the result;
the 4v4 runs are the control.

### Why each predecessor failed, since the pattern is the point

- **`RMSTEST_29` → 34.** Eight separate patches were read as confirming the
  pinned zone choice. Two hypotheses predict eight separate patches — the
  pinned `playerNumber − 10` and a plain `TeamNumber − 9` in which solo players
  still carry a team number — and the run could not separate them. It also had
  no instrument control, so nothing proved `other_zone_avoidance_distance` was
  doing any work. **34 adds a control land and probes the two boundary zones.**
- **`RMSTEST_30` → 36.** Bimodal angular gaps were read as team clustering.
  The script specified no `circle_radius`, so the default ring's own variance
  and ±7° jitter applied, and `base_size 8` merged lands 8→4-6 patches. Merging
  neighbours on a 45° ring manufactures exactly the gaps that were read as the
  signal. **36 pins `circle_radius 40 0` and shrinks the lands so the reading
  becomes a patch count.**
- **`RMSTEST_32` → 35.** Changed map size AND added player lands in one step,
  against a predecessor that had neither. The 8 exclusion discs sit on a ring
  that crosses the diagonal being measured. **35 changes only the size.**

**And one procedural failure worth its own line: `RMSTEST_32`'s first attempt
exported the same generated map three times.** The md5s differed — a scenario
file embeds its own filename — while the full probe output was byte-identical.
Regenerate between saves, and check that the headline count differs run to run
before trusting a triplicate.

## Batch 4 (RUN, 2026-08-04) — one script, written 2026-08-04

Batch 3 ran the same day. **Items 11 and 15 closed**; item 14 failed a second
time and is the only thing left that an export can answer.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_37_zoneforced` | item 14, replaces 34 | **Normal, 8 players, plain FFA — no teams** | 3 | `--patches GRASS` + min distance per probe terrain |

**Why 34 failed, and it is a different failure from the batch-2 ones.** 34's
design was sound and its *reasoning* was already correct in its own header —
prediction 4 said outright that sharing a zone only PERMITS contact and does not
compel it, and that a null result would therefore be inconclusive. The script
was built anyway on the half of the instrument that depends on luck, and the
luck did not arrive: every probe including the control came back 17–21 tiles
away. **A test whose header names its own failure mode should be redesigned
before it is run, not after.** 37 pins player 1 with `direct_placement` and puts
the probes at fixed offsets, so contact and non-contact are both forced.

34 also aimed one probe at `zone -1` on the grounds that it is player 8's zone
under hypothesis B — while pinning nothing about where player 8 was. That probe
could never have been read. Both of 37's probes target player 1.

### Batch 3 outcomes, for the record

- **Item 15 closed.** `RMSTEST_36` at 5v1v1v1: four groups at 89–91°, one arc of
  five, three lone players, all on an 80-tile ring. The ring is divided by group
  count. New open number: intra-team spacing measured 10–12 tiles against
  guide:356's `2·base_size` = 6.
- **Item 11 closed, and it replaced Sec.6.2's model.** `RMSTEST_35` at 200 with
  no player lands gave 7.16:1 against Tiny's 18:1 and 200-with-lands' 2.24:1.
  The ratio decays with `|y − x|` — ~12:1 beside the diagonal, ~1.9:1 in the far
  corner — which reconciles all three, since 22a only ever sampled the
  near-diagonal region. Item 11(a)'s wrong-way gradient **reproduces** and is now
  the open half.
- **A reading error worth remembering:** the first pass at 11(a) used raw counts
  per diagonal band and found no gradient. The bands have very unequal areas
  (4675 tiles against 300), and normalising reversed the conclusion.

## Batch 5 (RUN, 2026-08-04) — the land-growth sweep, written 2026-08-04

Batch 4 closed item 14. **Item 16 is now the largest open question in Phase 4**
— Sec.6.1's land-growth model is refuted and nothing replaces it yet.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_38_clumpsweep` | item 16 | **Giant (252), any player count** — but the exports on disk are all dim 480, see the map's own header | 3 | `--patches` once per terrain (six of them) |

Three generations, not eighteen. The script puts **six lands on one map**, one per
`clumping_factor` value, each with its own terrain, spaced 76–101 tiles apart on
a 63504-tile map so they never interact. Every other attribute matches
`RMSTEST_28a/28b` exactly (`number_of_tiles 400`, `base_size 1`,
`border_fuzziness 0`), so the results are directly comparable to the runs that
opened the item rather than being a fresh baseline.

| terrain | `clumping_factor` | why this value |
|---|---|---|
| SNOW | −20 | beyond anything measured |
| DESERT | 0 | reproduces the RMSTEST_28b control |
| DIRT | 8 | the documented default |
| DIRT2 | 20 | the corpus mode |
| DIRT3 | 40 | high |
| GRASS3 | 100 | corpus uses it 18×, above the community's stated max of 99 |

**Read-off:** piece count per terrain, size distribution, circularity, and the
per-terrain total (should sit near 400 plus the ~3% growth overshoot — a total
far below 400 means growth terminated early, which invalidates the piece count).
**Also check the six bounding boxes do not overlap**; if any two lands met, that
pair is void and needs re-running singly. That check is why one map is an
acceptable substitute for six.

**The prediction that makes it worth a sitting:** piece count falls
**monotonically** with `cf` and reaches 1 somewhere in the corpus's common 15–25
band. Then Sec.6.1 needs a changed weight table — the `neighborsOwned = 0`
bucket stops being empty — rather than a new pipeline stage. If pieces persist at
`cf 100`, growth is not frontier-based at any setting and Sec.6.1 is rebuilt from
scratch.

### Where this design came from

A search of the public record (2026-08-04) found that **nobody has published the
algorithm**. AoK Heaven's "The Cartographer: RMS Discoveries" thread — the
community's reverse-engineering effort — has the `clumping_factor` range and
`land_id` behaviour and explicitly nothing on seeding, disconnected pieces or
elevation bias. `genie-rms` is a real RMS evaluator and GPL-3.0, but its own
README calls land positioning "buggy" and elevation "unclear". openage #65 is
planning discussion. The algorithm itself is compiled code in `AoE2DE_s.exe`;
`random_map.def` is 1251 lines of `#const`, and the `.dat` files are unit,
terrain and rendering data.

What the search *did* give: the community's `clumping_factor` range of about
−100 to 99 against the conventional 1–15, "super spindly" at negatives and "very
clumped and roundish" near +100. Both our existing runs sat at the spindly end,
which is why fragmentation looked absolute rather than graded — **this script
exists because of that observation.** It also prompted re-checking the pieces
under 8-connectivity (a diagonal snake would split under 4), which they survive.

## Batch 6 (RUN, 2026-08-04) — item 11(a), written 2026-08-04

Item 16 closed; **11(a) is the last open question an export can answer.** The
border band is measured (ratio collapses to near-parity within ~5 tiles of any
edge, recovers by ~10–15, does not scale with map size) and both candidate
mechanisms are refuted — seed exclusion (centroids appear at edge distance 0)
and spillover across the diagonal (0.7–3.0% straddling components). Two runs
here, one for the mechanism and one to guard the constant.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_39_cleanseeds` | 11(a) mechanism | **Normal (200)**, any player count | 5 | components → centroids → favoured/disfavoured split **profiled by edge distance** |
| `RMSTEST_35_elevnolands` | fixed-width guard | **Ludicrous (480)**, any player count | 6 | as the Normal runs; compare *where* the ratio recovers |

Eleven generations, neither needing team setup.

**`RMSTEST_39` exists because every elevation number this project holds — 18:1,
7.16:1, 29:1 interior, 3.7:1 border — was measured from *grown tiles*, i.e. a
seed distribution seen through growth blur and heavy merging (RMSTEST_35
declared 500 clumps and returned ~283 components). Setting the per-clump share
to the measured 6-tile floor with only 100 clumps makes each component one seed,
so the seed distribution can be read directly.** That separates the two live
possibilities: the bias function is genuinely weaker near the boundary, or
seeding is uniform and growth produces the effect by clipping against the edge.
It should also give the first uncontaminated estimate of the true weight ratio,
which is what Sec.6.2's table ought to be fitted to.

**The Ludicrous runs are a deliberate guard against a mistake this project just
made.** The "band is absolute, not proportional" claim rests on two sizes, 120
and 200. Item 16 was mis-diagnosed for exactly this reason — `cf −5` and `cf 0`
are two points at one end of a range, and they made a mis-parameterised model
look refuted. 480 is the far end. If recovery still completes by ~12 tiles the
constant is safe; if it stretches toward ~29, the band is proportional and
Sec.6.2 needs a `dim` term after all. Six runs rather than three because the
absolute tile budget makes coverage ~0.9% at that size.

## Batch 7 (RUN, 2026-08-04) — elevation GROWTH bias, written 2026-08-04

Batch 6 overturned Sec.6.2's model rather than refining it, and this trio
measures the replacement.

| Script | per-clump budget | coverage | Generate at | Runs |
|---|---|---|---|---|
| `RMSTEST_40a_growth6` | 6 tiles (the floor) | 0.75% | Normal (200) | 3 |
| `RMSTEST_40b_growth25` | 25 tiles | 3.1% | Normal (200) | 3 |
| `RMSTEST_40c_growth100` | 100 tiles | 12.5% | Normal (200) | 3 |

Nine generations, no team setup, one map size throughout.

**What batch 6 established.** `RMSTEST_39` read the elevation *seed* distribution
cleanly for the first time (100 clumps at the 6-tile floor, ~94 components from a
declared 100). The seed bias is **1.31:1**, not the 18:1/29:1 taken from grown
tiles, and it is **flat against distance from the map edge** — so the "border
band" is not a seeding property. The grown-tile ratio decomposes exactly as
`seed × clump-size` (1.31 × 1.41 = 1.86 vs 1.88 measured; 1.78 × 4.03 = 7.18 vs
7.16), and **the dominant term is clump size**. The bias is produced during
growth. The observed ratio also tracked coverage on otherwise identical scripts
— 1.88 at 1.55%, 7.16 at 6.21%, 12.86 at 21.47% — so the "step with weight 18
vs 1" was never an engine constant.

**Why the budget is the swept variable and the clump count is fixed at 50.**
Growth is the hypothesised mechanism, so the budget is what must vary. Fifty
clumps is few on purpose: `RMSTEST_35` declared 500 and returned ~283 components,
so its "clump size" was merged-component size — the confound this design exists
to avoid. `40a` sits at the measured 6-tile floor and is therefore the
**near-zero-growth control**: if the size ratio is already high there, growth is
not the mechanism.

**The reading is the size ratio's slope across the three.** If it climbs with
budget, that slope is the constant Sec.6.2 needs in place of the fitted 18:1.
If it is flat, growth is unbiased and the coverage dependence comes from
something else — the expensive outcome, and the reason the control is included.
The identity `tile_ratio = seed_ratio × size_ratio` must hold in each run; if it
does not, components are merging and only `40a`/`40b` can be read.

### One design failure from batch 6, recorded so it is not repeated

`RMSTEST_35` was re-run at Ludicrous (480) to check whether the border band was
absolute or proportional. **It resolved nothing.** The tile budget is absolute,
so coverage fell to 0.90%, leaving ~11 disfavoured tiles per edge bin and ratios
scattering 1.4–17.0 with no trend. The run sheet had predicted the 0.9% coverage
and then compensated with *more runs* — but runs fix variance, not a signal
that thin. **The fix was to scale the tile budget with the map so coverage stays
constant**, isolating the size variable. Any future cross-size comparison must
hold coverage fixed, not the declared budget.

## Batch 8 (RUN, 2026-08-05) — elevation bias vs clump density, written 2026-08-04

Third hypothesis for item 11. Two have already died, so the design is built
around matched pairs rather than a bare sweep.

| Script | clumps | budget | coverage | Generate at | Runs |
|---|---|---|---|---|---|
| `RMSTEST_41a_density250` | 250 | 6/clump | 3.75% | Normal (200) | 4 |
| `RMSTEST_41b_density500` | 500 | 6/clump | 7.5% | Normal (200) | 4 |
| `RMSTEST_41c_density1000` | 1000 | 6/clump | 15% | Normal (200) | 4 |

Twelve generations, one map size, no team setup.

**What died in batch 7.** *Growth is biased* — refuted: `40a`/`40b` hold the
clump-size ratio flat at 1.16 and 1.13 across a 4× change in per-clump budget.
*The ratio tracks coverage* — refuted: `40b` at 3.29% gives 1.41 while
`RMSTEST_39` at 1.55% gives 1.88 and `RMSTEST_35` at 6.21% gives 7.16. Not
monotone.

**What survives is clump density** — the only single variable ordering all six
runs held so far (0.00125 → ~1.4–2.1, 0.0025 → 1.88, 0.0125 → 7.16, 0.0347 →
12.86). The last two are the *same script* at two map sizes, so the "map size"
effect chased in items 11(b) and 32 was clump density all along. There is no
mechanism for it; this trio is the test.

**Why merging stops mattering.** High clump counts merge components, which is
what spoiled `RMSTEST_35`'s and `40c`'s size ratios. **The tile ratio is immune —
merging changes which tiles group together, never which tiles are elevated.** So
this design stays readable at every point, unlike every previous attempt.

**The matched pairs are the real design.** Coverage rises with clump count here,
which would normally confound them; it doesn't, because each point has a partner
already measured at nearly the same coverage and a very different clump count:

- `41a` (250 clumps, 3.75%) vs `40b` (50 clumps, 3.29%) → **1.41**
- `41c` (1000 clumps, 15%) vs `40c` (50 clumps, 13.1%) → **2.08**
- `41b` (500 clumps at 6 tiles) vs `RMSTEST_35` (500 clumps at 4 tiles) → **7.16**

The first two are 5× and 20× the clumps at matched coverage. The third holds
clump count fixed and changes the budget — if `41b` reproduces ~7 the budget is
irrelevant and count is confirmed; if it comes back near 1.5, the sub-floor
4-tile budget in `RMSTEST_35` is implicated and the density story is an artefact
of one script.

**If all three land near 1.4–2.1, density is dead too.** Three failed hypotheses
is the point at which to stop modelling the ratio and fit the qualitative
behaviour only — the preview needs layout plausibility, not engine parity.

## Batch 9 (RUN, 2026-08-11) — two questions, written 2026-08-10

Both came out of the same session and neither needs a sitting of its own. Nine
generations total.

| Script | Question | Generate at | Runs |
|---|---|---|---|
| `RMSTEST_42_ignoreterrain_frameless` | Does `ignore_terrain_restrictions` with no frame attribute VOID the command, or just do nothing? | Normal (200) | 1 |
| `RMSTEST_43a_accumulate_within_command` | Does `accumulate_connections` accumulate between PAIRS of one command, or only between commands? | Normal (200) | 3 |
| `RMSTEST_43b_accumulate_control` | The control for 43a. Identical map, no flag | Normal (200) | 3 |

**42 is the one that can invalidate shipped code**, and it is a single run
because every outcome is a presence/absence at a factor of two. `objects.ts` and
RMS0315 both currently assert that an unmet `Requires:` line empties the whole
`create_object`, which is what Namatjira showed. Namatjira cannot separate that
from the weaker reading where the flag is merely inert and the object's own
restriction re-applies, since both give the zero that was observed. The corpus
argues for the weaker one: `find_closest` carries the identical `Requires:` line
and appears 71 times with no frame attribute in working maps. Read the object
counts; 30 means voided, 60 means inert.

**43a/43b decide whether CREATION_PLAN 4.8 is a spec question or an afternoon.**
Sec.15 item 22's proposed escape route does not work — it says to batch only
when `accumulate_connections` is off and that "both slow corpus maps qualify",
and `24hr_Caverns.rms`, the 2.8s map the whole item was written about, turns the
flag on before its `create_connect_all_lands`. So the conditional fix leaves the
worst map untouched. If the engine turns out not to accumulate WITHIN a command,
batching per source land is correct unconditionally and the deviation
disappears. Read ROAD tile counts and compare the two files.

Three runs each for 43 because land growth stays random even with
`land_position` fixed. The predicted gap is far larger than that spread; a gap
the same size as the spread is the null result, not a weak positive.

## Batch 10 (RUN AND READ, 2026-08-11) — every remaining open question an export can answer

**Results, in one place. Seven answers, three of which overturn shipped code.**

| Script | Result | Effect |
|---|---|---|
| `42` | flag is INERT frameless; command untouched | **BUG-007** — revert `objects.ts` gate, re-scope RMS0315 |
| `45a/b/c` | 0 / 66 / 36 cliff units — a per-draw yield | **BUG-008** — `cliffs.ts` gates the section, should roll |
| `51` | 16 of 19 origins in the "forbidden" region | **BUG-009** — the cross is border-relative, `lands.ts` |
| `46` | unstated spills 24%, loose spills 0% | default is not loose; spec stands |
| `48` | 200 road tiles, one path | zone-grouping confirmed |
| `49` | snow 8,113 of 40,000 ≈ the layer | conjunction confirmed |
| `50` | both halves peak at 7 | no stacking; coverage idiom confirmed |
| `47` | 90 / 110 / 90 | modulo truncates toward zero |
| `44` | 3 discriminating lobbies, all snow | **ascending-selected REFUTED**; `teamModel.ts` stands |
| `59` | snow on a player-3 branch | lowest-player-number **CONFIRMED**, not just unrefuted |
| `57` / `60` | literal `69` snow, `ATTR_PROJECTILE_ARC` blank | the collision is **any WORD valued 69**; set is exactly 2 (BUG-012) |
| `58` | beach 146/138/127 on untouched grass | per-command beach step is **grid-wide**; item 28 closes, no change |
| `43a/43b` | 456 road tiles in all 8, zero spread | **no within-command accumulation** — unblocks the S5 batching fix |
| `52` | beach at shallow/water: 3 tiles of hundreds | **BUG-010** — seaward half of the depth rule is wrong |
| `53` | buried land yields zero tiles, 4 runs | model (a); Sec.6.1 stands, item 27's open half settled |
| `54a/b` | both fully snow | arity is THREE; `showType` omissible, closes BUG-003 row 10 |
| `55` | trees + stone | `percent_chance rnd(a,b)` evaluates normally |
| `56a/b` | blank vs snow | a constant in a comment **OPENS** a nested comment |
| `46a/b/c` | unstated spills 0%, tight 22–35%, loose 0% | **BUG-011** — the default is **loose**; `objects.ts` has tight |
| `44` re-runs | team numbers unrecorded; 5p gave the third outcome | **still open**, see its header |

**One null was void and one was real, and they looked the same.** `44` was run
with the habitual odd-versus-even lobby, which both candidate models predict
identically, so its confident 120 says nothing — its header now states the
requirement as an invariant. `43a/43b` agree to the tile across the flag, which
is the predicted null AND the signature of exporting one map repeatedly; the
automatic decoration count separates them (2297–2450 across the eight, so every
export is a distinct generation) and the null stands. **When a measurement comes
back suspiciously constant, find a quantity in the same file that SHOULD vary.**

**Every control object in this batch placed nothing on its first run.**
`FORAGEBUSH` is not a constant; it is `FORAGE`. The guard that exists to catch a
broken map was absent through the whole sitting, and the results survive only
because each is internally exact. Corrected. In the same pass `WILD_BOAR` was
"corrected" to `BOAR` on the grounds that our constants table lacks it, and the
game then showed `WILD_BOAR` placing 40 objects — absence from a 372-entry table
covering a 2642-unit roster is not evidence, which is a hard rule in this repo.
Reverted.

### Original run sheet

Written 2026-08-11. This is the whole outstanding set: the ten Sec.15 items that
name a run and had no script, plus three questions that live in other documents
and were never tracked on this sheet at all. **Forty-nine generations**, of
which twenty are one trivial map.

| Script | Settles | Generate at | Runs | Reads with |
|---|---|---|---|---|
| `RMSTEST_44_teamnumbering` | item 17(a) | **Tiny, 4 players, teams set**, then **5 players, teams set** | 1 each config | default histogram |
| `RMSTEST_45a_cliffminlen2` | item 17(b) | Normal, any players | 2 | `--clusters` |
| `RMSTEST_45b_cliffminlen3` | item 17(b) control | Normal, any players | 2 | `--clusters` |
| `RMSTEST_45c_cliffminlen24` | item 17(b) | Normal, any players | 2 | `--clusters` |
| `RMSTEST_46_groupdefault` | item 17(c) | Normal, any players | 3 | `--patches SNOW`, `--clusters` |
| `RMSTEST_47_negmodulo` | item 19 | Normal, any players | 1 | default histogram |
| `RMSTEST_48_samelandzones` | item 21 | **Normal, 1 player** | 3 | `--patches ROAD` |
| `RMSTEST_49_baselayer` | item 24 | Normal, any players | 2 | `--patches SNOW`, `--patches DESERT` |
| `RMSTEST_50_elevstack` | item 25 | Normal, any players | 2 | `--rows ELEVATION --bands 20`, `--patches` per half |
| `RMSTEST_51_crossborders` | item 26 | Normal, any players | **20** | `--patches SNOW` centroid, plotted |
| `RMSTEST_52_shallowsbeach` | item 29 | Normal, any players | 2 | `--patches BEACH`/`SHALLOW`/`GRASS` |
| `RMSTEST_53_overwrittenorigin` | item 30, bears on 27 | Normal, any players | 3 | `--patches SNOW`, `--patches DIRT` |
| `RMSTEST_54a_showtype` | known-issues BUG-003's last row | Normal, any players | 1 | look at the map |
| `RMSTEST_54b_showtype_control` | 54a's control | Normal, any players | 1 | look at the map |
| `RMSTEST_55_percentrnd` | parser-design Sec.13 item 4 | Normal, any players | 3 | default histogram |
| `RMSTEST_56a_commentbomb` | parser-design Sec.13 item 7 | Normal, any players | 1 | look at the map |
| `RMSTEST_56b_commentbomb_control` | 56a's control | Normal, any players | 1 | look at the map |

### Batch 11 (RUN AND READ, 2026-08-11) — what was left after batch 10

All run. **Sec.15 now has no open engine question**; items 18, 20 and 22 remain
and none of them needs the game.

| Script | Result |
|---|---|
| `RMSTEST_44` + `RMSTEST_59` | item 17(a) closed — canonical team numbering is by **lowest player number**, refuted and then confirmed |
| `RMSTEST_46a/b/c` | item 17(c) closed — the default grouping mode is **loose** (BUG-011) |
| `RMSTEST_58` | item 28 closed — the per-command beach step is **grid-wide**, no change |
| `RMSTEST_57` | the comment collision is **words only**; a bare `69` does nothing |

**One run is still worth having and it is not blocking**, if anyone touches the
teams UI: does `PLAYERn` follow the lobby SLOT or the player COLOUR? Set the
host's colour to 4 in slot 1 and branch `PLAYER1_TEAM1` against `PLAYER4_TEAM1`.
No generator code turns on it; the settings pane's wording might.

**Suggested order, and it is not the numeric one.**

1. **`56a`/`56b` first, and they take two minutes.** Every other script in this
   batch has a long header, and if the collision is the destructive reading then
   a single stray constant voids a run silently. Establish the hazard before
   spending a sitting on top of it.
2. **`54a`/`54b` next**, same reason and same shape — both are read by looking at
   the map, and both share the blank-map failure signature that `56` explains.
3. Then the ordinary Normal-any-players block in any order: `45a/b/c`, `46`,
   `47`, `49`, `50`, `52`, `53`, `55`, and `48` (one player).
4. **`51` on its own.** Twenty generations of a trivial map, and the reading is
   the scatter, so it wants an uninterrupted stretch rather than interleaving.
5. **`44` last.** It is the only script needing lobby teams, and finding out the
   editor will not set a 5-player split after generating everything else wastes
   the sitting — the lesson batch 2 already paid for.

**Matched pairs that belong in one sitting**: `45a`+`45b`+`45c` (the three arms
are meaningless apart), `54a`+`54b`, `56a`+`56b`.

**Regenerate between saves.** `RMSTEST_32` once exported one generated map three
times: the file hashes differed, because a scenario embeds its own filename,
while the probe output was byte-identical. `51` is twenty runs of a map whose
whole content is one small patch, and it is the likeliest place for that mistake
to recur.

### Batch 12 (2026-08-12) — one id, and it did not come back as expected

| Script | Feeds | Size | Runs | Read with |
|---|---|---|---|---|
| `RMSTEST_61_commandalias` | `docs/known-issues.md` BUG-005 piece 2, CREATION_PLAN A.2 | Normal, any players | 1 | default histogram | **RUN 2026-08-12** |
| `RMSTEST_62_commandalias_swap` | 61's confound | Normal, any players | 1 | default histogram | **RUN 2026-08-12** |
| `RMSTEST_63_unknownblockmerge` | whether an unknown command's block merges into the previous one | Normal, any players | 1 | default histogram + land POSITION | **RUN AND READ 2026-08-30** |

**Answer: 32 is `create_land`.** 61 came back `DIRT 6063, DESERT 6233, no SNOW`,
which reads as "33 is create_land and 32 is inert" — and 62, the same file with
the aliased arms swapped in id and terrain, came back `SNOW 6043, DESERT 6191, no
DIRT`, where 32 made a land. Loading `24hr_Petra.rms` in the DE editor closes it
from outside the instrument: no `create_land`, no `create_player_lands`, lands
generate, so `L` is making them.

**61 could not have answered on its own** — its aliased arms differed in id AND
position, so two models predicted its histogram. That is the standing vary-one-
thing rule, broken in the arms under test while being followed for the control.

**The pair yields a second finding**, which is what 63 is for: both
runs made exactly two lands of ~15%, and one model names which terrain goes
missing in each — **an unrecognised word's block merges into the command before
it**, later value winning. The rival is a buried origin (Sec.15 item 30), which
loses a land but does not predict which. 63 is the case that separates them.

**63 was DOWNGRADED 2026-08-13, and 63's own arms were rewritten.** It was called
the larger finding on the strength of reaching "every unrecognised command in a
real script, including the 457 misspelled `set_loose grouping` lines in the
Battle Royale maps". Those lines sit INSIDE a `create_object { … }` block with no
braces of their own, so the merge model — which acts only on a word that opens a
block — cannot touch them. Measured: after BUG-005 piece 2 resolved `L`, the
corpus holds **zero** unknown commands carrying a block, and a sweep of all 292
install files finds only `L` in Petra plus this batch's own `AL`/`AX`. Run it for
the beginner typo an expert corpus does not contain (`create_lands {`), not for
any shipped map. **The arms changed too**: as first written, 63's merge read-off
("SNOW, no DIRT") is also what a buried origin produces, so it could not separate
the models it names — the same fault that cost 61 and 62 a run each. Both origins
now carry `land_position` at opposite corners, which makes burial impossible by
construction and adds a second read-off, since under the merge the surviving land
sits at the UNKNOWN word's position rather than `create_land`'s.

**This is not the equivalencies-sheet import, and finding that out is most of the
value.** BUG-005 piece 2 was deferred until the sheet lands, on the reading that
the 581 unknown-command warnings need a token-id table. They do not. All 581 are
one idiom in two maps, `#const L 32` used as a land command in `24hr_Petra.rms`
and `24hr_Holler.rms`, and a sweep of every `#const` in the corpus finds no
second word used as a command. **One verified id closes the bug.** The sheet
still matters for the general case and is no longer what this is blocked on.

What the run settles is that the id is what the author's comment says it is.
Sec.2.1's shared-id model is measured (`RMSTEST_56a`/`57`, the comment
collision), but the value 32 has never been checked against anything except that
comment, and a resolver built on it would be reference data sourced from a claim.
Three land commands, one real and two aliased, distinguished by terrain. Read
the header for the four outcomes; the one that matters is snow present and desert
absent.

**RUN AND READ 2026-08-30.** `--patches SNOW` and `--patches DIRT`: SNOW 6073
tiles in one patch, centroid (152.4, 147.6) on a 200-tile map — bottom-right,
where `AX`'s `land_position 75 75` puts it; DIRT **not present**, 0 tiles. That
is the read-off header's first case exactly: **the merge is real.** The block
belonging to the unrecognised word `AX` (aliased to 33) merged into the
`create_land` command above it, and its `land_position`/`terrain_type`
attributes overrode the command's own — one land was created, not two, and both
its terrain and its position came from the word the engine does not know. The
rival buried-origin model is ruled out by construction (the two origins sit at
opposite corners) and by outcome (a buried origin loses a land but does not
relocate the survivor to the buried one's position). Confirms 61/62's model
rather than merely being consistent with it. Nothing was blocked on this run and
nothing changes as a result — it closes the last standing question about the
merge model's mechanism, recorded here since the mechanism might matter again if
`docs/known-issues.md`'s BUG-005-shaped diagnostics are ever extended to warn on
a block-opening unknown command by name.

### Batch 13 (2026-08-29) — the modulo operator, both halves of it

| Script | Feeds | Size | Runs | Read with | Status |
|---|---|---|---|---|---|
| `RMSTEST_64_modzero_and_cast` | `docs/known-issues.md` BUG-022, parser-design Sec.2.2, `mathEval.ts` `mod()`, land-placement-design Sec.5.4 | Normal (200), any players | 1 | default histogram | **RUN AND READ 2026-08-30** |

**Two unmeasured claims share one operator, and on 2026-08-29 both changed at
once.** `x % 0` has two *sourced* readings that contradict each other — the
guide's main math text ("Modulo 0 also gives 0") against a Summer 2025 Update
note at guide line 4550 ("the left operand truncated toward zero") — and the
repo has now implemented each of them in turn without ever observing either. And
`%` casting both operands to int was adopted the same day from a Discord report
and a GitHub example, fixing a real defect in `mod()` but on no observation of
this project's own.

**Why it is not "blocks nothing" the way 63 is.** The cast is what makes the
Bhaskara sine macro in `Bulls_Eyes.rms` and `Venn.rms` self-guarding: `θ % 360`
truncates θ, so the macro's sign trick holds for any input. If the cast is not
real, that trick collapses to zero on fractional angles and every land built on
it stacks at the map centre. A wrong answer is silent, and silent in the "your
map is fine" direction.

**Read arms 1 and 7 against each other first** — they must agree about the zero
rule, and if they do not, the cast reading is wrong and question (b) needs its
own run before (a) can be read at all. The script's header carries all ten
predictions plus three controls, one of which (do decimal literals survive?)
exists because without it the cast arms would confirm the cast while measuring
nothing.

**Answer, and it splits down the middle: the cast is real, the zero rule was
re-guessed wrong.** All ten object counts read back, none zero, none needing a
substitute constant. FORAGE 100, GOLD 600, STONE 670 (control C — decimals
survive), CYPRESS_TREE 100 (division by zero is 0, unaffected). OLIVE_TREE 170
and BIRCH_TREE 30 — arm 1/2's truncating prediction, not the 2026-08-29 guess's
100/100. DEER 300 and WILD_BOAR 200 — arm 5/6's cast prediction, not the uncast
310/370. BAMBOO_TREE 600 is the decisive cross-check named in the header: it is
the one value unique to "cast AND truncate" among all four candidate readings,
so arms 1/2 and 5/6 are not just individually confirmed, they agree with each
other. **`x % 0` reverses back to the left operand truncated toward zero** — the
2026-08-29 owner decision that followed the guide's main math text was wrong,
and the Summer 2025 Update note this project originally built `mod()` from was
right. **The cast stays** — it is the one part of the 2026-08-29 change that
was already correct. `mathEval.ts`'s `mod()`, its tests, `parser-design.md`
Sec.2.2 and `land-placement-design.md`'s Q5 follow-up 2 are all updated; full
table in `docs/known-issues.md` BUG-022 (closed).

**One thing this run found that it was not looking for.** `probe_scenario.py`'s
default histogram printed GOLD as "RICE_FARM_SEEDS" and STONE as "GRAVEL_DESERT"
on the first read — a `game-constants.json` id collision across namespaces, not
an engine result. See the tool's own README for the fix; it did not change any
number in the table above, since every object was cross-checked against the
correct row by id before the probe was corrected.

### Two design notes worth reading before running

**`45` is three files rather than three arms on one map, and Sec.15 item 17(b)
asked for the impossible.** The cliff section holds no block command — it is a
bare list of standalone attributes, last one wins — so one map can only ever
express one cliff configuration. The item was written without that in view.

**`50` splits its map at land generation, not at terrain generation.** The
engine runs its sections in a fixed order and elevation precedes terrain, so an
elevation command filtered on a terrain painted in `<TERRAIN_GENERATION>` would
match nothing at all and the run would read as "repetition does nothing" under
either model. The first draft of that script had exactly this bug.

### Batch 14 (2026-08-30, RUN AND READ 2026-09-02) — the forest auto-spawn table

| Script | Feeds | Size | Runs | Read with | Status |
|---|---|---|---|---|---|
| `RMSTEST_65_forestmix_and_density` | preview-design Sec.15 item (c), the status-bar forest-wood plan | Normal (200), **2 players** | 2 | default histograms (objects AND terrains) | **RUN AND READ 2026-09-02** |

**Both questions answered, decisively, on two runs.** Arm 1 (SOUTH_AMERICAN_FOREST's six-slot mix): measured 35.07%/9.83%/16.10%/16.47%/16.72%/5.81% of the terrain's tile count against Model A's (sequential first-hit down the slot list) predicted 35.0/9.8/16.6/16.2/16.8/5.6 — TREE_GREEN_OAK (16.7% measured) and DLC_AFRICANBUSH (5.8%) are the discriminators the header named, and both rule out Model D (predicted 0% for each) and Model C (predicted 25.3%/33.7%) on their own; Model B (100% AFRICANBUSH, nothing else) was already dead on arrival. Reproduced on run 2 (34.35/9.87/16.73/16.02/17.27/5.76). Arm 2 (`terrain_unit_density` is per-mille): DLC_BAOBABTREE / DLC_BAOBABFOREST tiles measured 24.98% and 25.59% across the two runs against the documented 25%, confirming the schema's `density` field is correctly normalised 0-1 from a per-mille dat value. **Neither arm changed any code** — `computeForestWood`'s per-species selection assumption (Sec.15 item 23(c), already shipped) is confirmed rather than merely inferred. A separate, tangential finding surfaced while re-reading `computeForestWood` alongside this result — its wood-per-tile AGGREGATION formula sums every slot's density unconditionally rather than cascading them, which is a different question from the one this script answers and is tracked as its own follow-up rather than folded in here.

## Batch 15 (written 2026-08-30, RUN AND READ 2026-09-02) — four open bugs, all settled

Four scripts, one per open `docs/known-issues.md` entry as of the write-up
(BUG-016, BUG-019, BUG-020, BUG-021). Each is self-contained, deterministic
(every branching attribute is pinned to a value that removes run-to-run
variance except RMSTEST_66's contested-boundary pairs), and readable in one
generation apiece except where noted.

| Script | Settles | Generate at | Runs | Reads with | Result |
|---|---|---|---|---|---|
| `RMSTEST_66_otherzoneavoidance` | BUG-016's `other_zone_avoidance_distance` half | Normal (200), any players | 3 (4 exports exist; all four agree) | `--bbox` per terrain (6 calls), `--patches` per terrain as a cross-check | ~~**The positive control OVERLAPS instead of holding a gap** — different-zone lands at matched radius 6 measured -3/-10/-5 tiles across three runs... `other_zone_avoidance_distance` does not restrict growth at all; `lands.ts`'s `violatesZoneAvoidance` check is **removed**.~~ **WRONG, corrected 2026-09-03 — see Batch 17.** The `--bbox` read (`min_x(right) − max_x(left)` over each land's FULL bounding box) cannot tell "these two patches overlap" from "these two patches each reach far in some direction, at different y-values" — growth is non-convex. Re-read with the TRUE tile-to-tile minimum distance: the control pair never touches, sitting 5-7 tiles apart across all four runs (zero 8-connected contact tiles in every one), matching the modelled ~6-tile separation. The asymmetric pair (radius 12 vs 2), same correction, sits 3-7 tiles apart across four runs — three of four exactly at the smaller radius + 1 — confirming "smaller wins", not "unreadable". `violatesZoneAvoidance` is **restored**. |
| `RMSTEST_67_tempmindistance` | BUG-019 | Normal (200), 8 players, plain FFA, no lobby needed | 1 | default histogram | **The attribute is a no-op.** STONE (test, 30 tiles from the pinned origin, `temp_min_distance_to_players 45`) placed its full count 20/20, same as the unrestricted GOLD control; the matched `min_distance_to_players 45` control correctly placed 0 at 30 tiles and 20 at 60. `language.json` gains a `nonFunctional: true` entry, same shape as `min_distance`. |
| `RMSTEST_68_nestedstartrandom` | BUG-020 | Normal (200), any players | 1 | default histogram | **The suspected corruption is REFUTED.** All seven markers read exactly as correct nesting predicts — outer branch 0 (STONE) and inner branch 0 (OLIVE_TREE) both absent, everything else present. Nested `start_random` resolves precisely as lexically written for this two-level case. RMS0213's message now states the measured consequence instead of only the prohibition. |
| `RMSTEST_69_defineinnumericslot` | BUG-021 | Normal (200), any players | 1 | default histogram | **The symbol-table half was already correct** (first-definition-wins, GOLD read 7 unchanged after `#define`) — **the real defect was one layer downstream**: `numAttr` across four stage files could not tell "argument absent" from "argument present, known symbol, no value" and used the same fallback for both, predicting STONE (bare `#define`, no `#const`) would place ~1 object where it measured 0. Fixed by checking the arg node's presence rather than only its resolved value. |

Full corpus (`npm test`, 109 files / 2609 tests) green after all four fixes — no tracked or local map currently exercises any of the four narrow shapes closely enough to move a pinned figure.

**NEEDS MANUAL REVIEW: `RMSTEST_67_tempmindistance` and `RMSTEST_68_nestedstartrandom`.** Ash flagged these two on 2026-09-03 to check by hand before trusting the results above as final.

**BUG-016's other two suspicions are narrower than the entry as filed.** Code
inspection (not a run - this does not close anything) found: `objects.ts`
only owns one of the three named attributes (`min_distance_to_players`);
`spacing_to_other_terrain_types` lives in `terrains.ts` and is already
**measured**, not suspected — `RMSTEST_31` confirmed it operationally
(preview-design.md Sec.6.4, item 12 closed 2026-08-04), which the BUG-016
entry does not mention, so double-check that measurement actually covers
Venn's combined `spacing_to_other_terrain_types` +
`spacing_to_specific_terrain` usage before spending a fresh run on it; and
`min_distance_to_players`'s frameless "every player origin" reading
(`objects.ts:1026-1036`) already uses `.every(...)` across all player
origins, which is the overlap/intersection BUG-016 asks for — but Venn's own
`min_distance_to_players` uses are all frame-referenced
(`set_place_for_every_player`), where per-frame-origin-only checking is the
*correct* behaviour (one placement per player, each scoped to that player),
not the suspected bug. So `other_zone_avoidance_distance` — genuinely
unmeasured against the engine directly, everywhere else it appears is either
guide-sourced or an origin-time-only reading from RMSTEST_25/51 — is the one
piece of BUG-016 with an actual open question and a script. If Venn's
observed discrepancy turns out not to be explained by RMSTEST_66's read,
the other two attributes above are where to look next, but re-read what is
already measured before writing a new script for either.

**Not blocking, not run.** Written together because a session was already in
this file; none of them requires the others; run in any order.

**Why it is not urgent, in two measurements.** The dat's `terrain_unit_id` /
`terrain_unit_density` table (read 2026-08-29) answers item (c) outright for
23 of the 24 wood-bearing terrains. What it does not state is how the engine
chooses when a terrain lists several trees, and that gap can only change a
number where a terrain mixes trees of *different* wood values. Of the seven
multi-slot terrains, six draw only 100-wood units — 20, 88, 89, 106, plus
19 and 21 whose extra slots sit at density 0 — so every candidate model
returns exactly 100 wood/tile for them. `SOUTH_AMERICAN_FOREST` is the sole
exception, because `DLC_ACACIATREE`'s 150 is in its mix. And
**`SOUTH_AMERICAN_FOREST` is used by 0 of the 53 corpus maps** (`FOREST` 20,
`SNOW_FOREST` 6, `MEDITERRANEAN_FOREST` 4, `DLC_BAOBABFOREST` 2 — none of
which depends on the model). Across the four candidate models the figure
spans 100.0–110.0 wood/tile, so the whole exposure is one unused terrain at
about 10%.

**What it would still buy.** Arm 2 is the reason to run it at all: it is the
first DIRECT look at whether `terrain_unit_density` is per-mille. That
reading currently rests on three `descriptiveName` prose figures agreeing
with it (25%/50%/80% against densities 250/500/800), which is strong but is
still prose, and every forest-wood figure in the plan is scaled by it. Arm 2
rides along on the same generation for free.

**Two things checked while writing it, worth keeping.** `DESERT` is the base
because it is one of the few terrains with no `terrain_unit` slots of its own,
so every object in the export comes from one of the two arms — `GRASS` and
`DIRT` would each have added a cosmetic unit to the histogram. And the two
arms share no unit, checked against the dat, which is what lets both sit on
one map and be read from a single map-wide histogram.

**A third constant valued 69, unlisted above.** The table in "A WORD valued 69"
names `SHORE_FISH` and `ATTR_PROJECTILE_ARC` and calls the scope "exactly two
engine constants". `game-constants.json` holds a third row at constId 69,
**`CORRUPTION`**, which by the same mechanism would trip the same trap. Not
measured — no run has put it in a leading comment — so treat it as a name to
avoid above a script rather than as a fourth data point.

## Batch 16 (written 2026-09-02, RUN AND READ the same day) — the connection-generation beach question, settled

| Script | Settles | Generate at | Runs | Reads with | Result |
|---|---|---|---|---|---|
| `RMSTEST_70_connectionbeach` | item 31, `index.ts`'s "DELIBERATELY no beach pass here" comment | Normal (200), 2 players | 3 | `--patches DIRT`, `--patches BEACH`, `--patches GRASS` | **YES, a pass runs after S5.** |

Found while looking into why `AD4 - Pag - v1.2.rms` shows land bordering water with no beach between. Pag's `<CONNECTION_GENERATION>` section carves DIRT causeways through water with `replace_terrain`, and the shipped generator had never run a beach pass after S5 by design — `preview-design.md` Sec.6.4 already measured the cost (873 unbeached tiles on Pag) but the open question itself had drifted onto item 28's text, which closed on a narrower, already-answered question (the per-command step's own scope, not this one). Item 31 was the new number this batch settled; `RMSTEST_70` is its script.

**Total beach came back 840-961 tiles across three runs** — well past the ~250-300 tiles the two islands' own coastlines alone would produce (perimeter 310+328) — and the largest single patch each run spanned most or all of the map (bbox up to 200x200) at very low circularity, a shape consistent with beach strung along the causeway's route rather than confined to two separate coastal rings. `index.ts` now calls `applyAutomaticBeach` a second time, immediately after `applyConnections`. Pag itself now reads 2688 total beach tiles, up from the pre-fix figure.

**An unplanned second finding, not settled here.** The DIRT causeway itself came out fragmented (dozens of small/single-tile patches) in two of the three runs rather than one contiguous strip, which Sec.6.5's assumed "no `terrain_size` entry → radius 1, variance 0" default should not produce. Opened as Sec.15 item 32, not yet its own script.

## Batch 17 (written and run 2026-09-03) — BUG-016 reopened and re-closed: `other_zone_avoidance_distance` is real after all

Batch 15's `RMSTEST_66` reading of the growth-time half of this attribute was wrong, and this batch is the correction — four scripts, one of them (`RMSTEST_66` itself) re-read rather than re-run.

| Script | Settles | Generate at | Runs | Reads with | Result |
|---|---|---|---|---|---|
| `RMSTEST_66` (re-read) | growth-time model, corrected | (as Batch 15) | (existing 4 exports) | TRUE tile-to-tile minimum distance between the two patches, not `--bbox` extent | Control pair (DESERT/DIRT2, matched radius 6): **5-7 tiles apart, zero 8-connected contact, in all four runs.** Asymmetric pair (DIRT3 radius 12 vs GRASS3 radius 2): **3-7 tiles apart, zero contact, three of four runs at exactly 2+1=3** — confirms "smaller wins". Same-zone control (SNOW/DIRT, both zone 30): **freely interleaves, 63-87 tiles of real contact** — the exemption is real and the contrast with the different-zone pairs is exactly what the model predicts. |
| `RMSTEST_71_zoneavoidance_origin` | origin-time spacing (superseded by `RMSTEST_74` below) | Normal (200), any players | 3 | `--bbox`/`--patches` per terrain | Read via patch-to-WALL distance, several lands landed adjacent (distance 1) to the WALL — but the WALL never declares `other_zone_avoidance_distance` itself and grew hugely with no self-restraint, swallowing space its neighbours' ORIGINS had correctly kept clear of. Re-read against each land's centroid vs. the WALL's actual origin point (50,100): **all 18 origins (6 lands × 3 runs) sit well past the declared 15-tile threshold.** Origin spacing was never refuted; the instrument (patch-to-patch distance) was measuring the wrong thing. Superseded by `RMSTEST_74`, which removes the wall entirely and gets real statistical power. |
| `RMSTEST_72_other_zone_avoidance_distance_take_2` | growth-time, vs. a static (non-declaring) wall | Normal (200), any players | 4 | `--bbox`/`--patches` per terrain, exact tile-to-tile distance | Three of four petals (SNOW, WATER, SAVANNAH) had `land_position` placed CLOSER to the static ICE wall than their own declared avoidance value, so "zero growth-ward movement" was consistent with any threshold ≥ the origin's own starting gap and settled nothing about the specific number. Superseded by `RMSTEST_73`, which fixes this by starting every grower far enough away. |
| `RMSTEST_73_other_zone_avoidance_distance_take_3` | growth-time, calibration | Normal (200), any players | 3 | exact tile-to-tile distance vs. two rows of static ICE blocks | **Exact and reproducible: measured gap = declared value + 1**, for DIRT (declared 6 → 7), WATER (declared 10 → 11, checked against both ICE rows independently), and SAVANNAH (declared 12 → 13) — bit-for-bit identical across all three runs. This is the calibration that closes the question `RMSTEST_66`/`72` left open. |
| `RMSTEST_74_originspacing_powered` | origin-time spacing, properly powered | Normal (200), any players | 3 | `--patches SNOW`, then pairwise Chebyshev distance among all reported centroids | 20 same-map competing origins (no wall — the guide states origin-spacing applies "regardless of zone"), each declaring `other_zone_avoidance_distance 15`. All three runs: **20 of 20 patches, no merges.** Of 190 pairwise checks per run, only 1-2 came in under 15, and only by 1-2 tiles (consistent with the origin check's own Euclidean metric differing slightly from the Chebyshev distance used to read patches, plus each patch's own small footprint around its origin) — far fewer and smaller than the ~4.6 chance collisions per run the null hypothesis predicts at this sample size. |

**The root cause, in one sentence: a bounding-box extent cannot tell "two patches overlap" from "two patches each reach far in some direction, at different places".** `RMSTEST_66`'s original read used `gap = min_x(right land) − max_x(left land)` across each land's WHOLE bounding box. Growth is a randomised frontier process, so DESERT can bulge rightward at one y-value while DIRT2 bulges leftward at a completely different y-value — the two rectangles cross on paper with the actual shapes never coming near each other. The fix, used throughout this batch, is the true minimum tile-to-tile distance between the two patches (or an explicit 4-/8-connected contact count), computed directly from the scenario's terrain grid rather than from any bbox summary. This is now a CLAUDE.md Hard Rule.

**What changed in the app.** `lands.ts`'s `violatesZoneAvoidance` (deleted 2026-09-02) is restored and wired back into `acceptCandidate`; `lands.test.ts`'s matching test is rewritten to assert the correct (avoidance-holds) outcome, plus two new tests for the same-zone exemption and the smaller-of-two-values rule. `docs/known-issues.md` BUG-016 and `docs/preview-design.md` Sec.6.1 are both corrected in place (struck-through claims replaced, not deleted, per this file's own convention). Full corpus (`npm test`, 111/111 files, 2757 tests) green — no tracked corpus map's pinned figures moved. `npm run typecheck` clean.

## Batch 7's scripts — RECOVERED 2026-08-12

`RMSTEST_40a/40b/40c` were run but existed only in the DE install for a while,
which meant the elevation study cited three measurements whose scripts — and so
whose predictions and read-off tables — were nowhere in the repo. They are back
in this directory and tracked.

**Keep the rule that failed here: a script is tracked here, not only where it is
run.** The headers are most of what a run leaves behind, since they record what
was predicted *before* the generation and what would have refuted it. An export
without its script is a number without a question.
