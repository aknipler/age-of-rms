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
| `RMSTEST_38_clumpsweep` | item 16 | **Giant (252), any player count** | 3 | `--patches` once per terrain (six of them) |

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

## Batch 7's scripts are missing from this directory

`RMSTEST_40a/40b/40c` ran — the elevation study cites all three at four runs
each, and batch 8's entire design is built on what they refuted — but the files
exist only in the DE install they were run from. This directory's own rule is
that the scripts are tracked here, not only where they run, and a header
carrying a read-off table is most of what a run leaves behind. Recover them from
the install and commit them.
