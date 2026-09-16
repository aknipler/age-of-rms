# Generation Consistency Checker — design (rev 14)

CREATION_PLAN 5.2, the flagship Advanced Tool (PLAN.md, "Built-in tool: Generation
Consistency Checker"). Section numbers below are this document's own; where a
claim depends on `docs/tools-api-design.md` or `docs/preview-design.md` it is
cited by section, not restated.

**Rev 14 is the first revision with an implementation behind it.** Sec.7.0-7.2's
infrastructure and Sec.7.3's checker (`src/tools/builtin/consistencyChecker.ts`
plus `checker/{astScan,staticChecks,aggregate,report}.ts`) landed 2026-08-19,
and rev 14 is the round that read the code against the spec. Where a rule below
is marked **IMPLEMENTED** it has been run over the corpus and the figure beside
it is that run's; where it is marked **OWED** the spec states it and the code
does not carry it yet. Sections that only describe intent carry neither, which
is itself a signal — those are the ones no run has ever checked.

## 0. What is already decided, and where

Two prior specs pre-committed a large fraction of this tool's shape before this
document existed, because both documents were written with the checker as their
named forward-consumer. Restating their reasoning here would drift the moment
either is revised; this section is a pointer list, checked against the current
code rather than transcribed from either document's prose.

- **The instrumentation this tool is built on already ships.** `PlacementFailure`,
  `FailureBucket` (19 members), `CommandReport { commandSpan, stage, attempted,
placed, failures }` and `PreviewResult.reports` are real, in
  `src/preview/generator/types.ts`, and every stage (`lands.ts`, `elevation.ts`,
  `cliffs.ts`, `terrains.ts`, `connections.ts`, `objects.ts`) already populates
  them unconditionally — "no `collectReports` option, because reports are goal 2
  and cost one record per command rather than per tile" (`types.ts`, Sec.7
  comment). Sec.3 below consumes this surface directly; it does not design it.
- **The contract this tool runs under already ships.** `tools-api/index.ts`
  (rev 10) has a `multiSelect` param type whose own doc comment names the
  2/4/6/8 player-count matrix as the reason it exists; `OutputBlock`'s `severity`
  and `table` carry optional `Span`s whose own doc comment names this tool's
  per-`create_object` table as the reason; `run`'s chunk unit is pinned as _one
  generation_ (`tools-api-design.md` Sec.4.1); the two deadlines are derived from
  this tool's own cost profile. Sec.4 and Sec.5 below consume this surface; they
  do not re-litigate it.
- **The bridge from `ToolContext` to `PreviewSettings` already ships, and it is
  one generation short of what this tool needs.** `src/tools/previewBridge.ts` —
  `previewSettingsFromContext` narrows `mapSize`/`teams`, `runPreviewFromContext`
  calls `generatePreview` straight off `ctx.parseResult` with no clone and no
  decode, because a built-in receives the in-process `ParseResult`
  (`tools-api-design.md` Sec.3, Sec.9 item 2). **It takes `playerCount` from
  `ctx.settings` and offers no override**, so the 2/4/6/8 matrix cannot be driven
  through it as it stands — Sec.4.1 and Sec.7.2 specify the one parameter that
  closes it.
- **The budget risk is named but not closed.** `tools-api-design.md` Sec.10
  computes 1000 runs at ~460 ms median as "~8 minutes for one player count and
  ~30 for the 2/4/6/8 matrix" and states plainly "this is a 5.2 problem, not a
  5.1 one". Sec.4.4 below is where it closes, **on numbers re-measured for this
  revision rather than re-cited** — the 460 ms figure has drifted 1.7× and the
  re-cite is exactly how it stayed unnoticed.
- **The data-readiness gaps are named, not fixed, and this tool inherits them
  live.** `tools-api-design.md` Sec.10.1: 116/131 terrain rows and most
  attribute rows are `verified: false`. Measured: **2891 of
  3011 rows are `verified: true` and 120 are not**, so Sec.3.5's downgrade path
  is the rare case rather than the common one the inherited warning suggests.
- **`allowedTerrains` is on 31 of 2672 object rows, not on the roster.**
  CREATION_PLAN 4.10 stripped it on 2026-08-12 as a derivable 1.33 MB; the 2666
  rows that were read out of a dat carry `terrainRestrictionId` (32 distinct
  values) instead, and **`reference/` holds no expansion table for those ids**.
  Sec.2 is the consequence and Sec.3.3 is written around it.
- **One infrastructure gap is already named and unfixed**, found while building
  5.1 and deliberately left for this session (`docs/build-log.md`, most recent
  entry): `ToolsPane.tsx`'s context builder has no `read-reference` branch, so a
  tool declaring that capability gets `referenceData: undefined`. This tool
  declares it. Sec.7.1 is the fix.
- **`ToolHost.reset()` does not stop the run it forgets.** It sets the state to
  `IDLE` and notifies; it clears neither `this.active` nor either timer, and
  `ToolsPane.selectTool` calls `cancel()` then `reset()`, where `cancel()` only
  arms a 30 s grace. Sec.4.3 and Sec.7.2 carry the fix, which this tool needs
  because it is the first tool that can still be alive at a tool switch.
- **Two seams this tool is the first to cross do not typecheck or do not
  exist, and both are decisions this document has to make rather than leave to
  the implementing session.** `ToolReferenceData.gameConstants` is
  `PublishedGameConstants` and does not assign to the
  `readonly ObjectConstant[]` the generator takes (Sec.4.1); and everything
  Sec.3 says to reuse — `objects.ts`'s two-step object resolver, `lands.ts`'s
  declared-area arithmetic, and the `argValue`/`numAttr` pair every check reads
  attributes through — is module-private, with the resolver additionally typed
  to a projection carrying neither `allowedTerrains` nor `verified`. Sec.7.0 is
  the export surface and Sec.7.2 item 2 the adapter. **The two are one
  decision**: with the resolver exported generically the static layer reads
  `PublishedGameConstant` rows directly and never needs the two arrays to be
  the same type, which leaves exactly one call site to adapt instead of two
  casts in two files. **Exporting the resolver is itself three edits and a
  cast, not the one-word change it reads as** — Sec.7.0 item 1 carries the
  compile.

## 1. Scope

Two layers, per PLAN.md: a deterministic static-analysis pass that runs once
and never generates, and a Monte Carlo pass that runs `generatePreview`
repeatedly across a player-count matrix and aggregates `PreviewResult.reports`
(**not** `failureMarks` — Sec.4.2). Both write into one shared report keyed by
originating command (Sec.5), each finding carrying the player count it was found
at (Sec.3.0) — as a **field**, never written into the finding's own sentence,
which is what lets Sec.5.1 collapse the four passes a static check makes into
one block.

**Out of scope, named so nobody re-derives it as an oversight:**

- Terrain and elevation checking. PLAN.md excludes both explicitly ("terrain
  blobs degrade rather than fail... elevation rarely fails outright") and
  nothing measured since has contradicted that.
- Anything the preview generator itself does not simulate. `SimulationNote`
  (`types.ts`) is the generator's own honesty surface; this tool surfaces it
  (Sec.5.4) rather than duplicating or second-guessing it.
- Reproducing the preview pane's seed or Current/Final cut point.
  `tools-api-design.md` Sec.2 already answers this for every tool: both are view
  state, deliberately outside `ToolContext`, and a tool wanting a fixed seed
  declares an `integer` param (Sec.6 below does).
- Full-fidelity (game-state-read) checking. PLAN.md's "later" column, not v1.

## 2. Two engines answering the same question at different precision

Read this before writing either layer, and read the coverage number before
believing the framing.

The preview generator's object placement (`src/preview/generator/objects.ts`)
filters candidate tiles by the **coarse** `Habitat` enum (`"land" | "water" |
"amphibious" | "shore" | "any"`, five values) via `objectHabitat()`.
`PublishedGameConstant.allowedTerrains` is the _exact_ permitted-terrain-id
list expanded from the game's own restriction table, and the schema's doc
comment on it quantifies what the vocabulary costs: **restriction 8
(GOLD/STONE/FORAGE) permits 83 terrains while the `land` class covers 110, so
27 terrains the engine refuses are terrain the preview still uses.**

**Where the field actually is, measured against `reference/data/game-constants.json`:**

|                                                                      |        |
| -------------------------------------------------------------------- | ------ |
| object rows                                                          | 2672   |
| carrying `allowedTerrains`                                           | **31** |
| carrying `terrainRestrictionId` (no expansion table in `reference/`) | 2666   |
| carrying `habitat`                                                   | 2668   |

So on 99.9% of _rows_ the two layers are not two engines at different precision;
they are two readers of `habitat`. **Rows are the wrong denominator for this
tool, and the right one keeps the section alive**: the 31 are the 4.7-era
hand-set family — `GOLD`, `STONE`, `FORAGE`, `DEER`, `BOAR`, `SHEEP`, `WOLF`,
`RELIC`, the fish, `TRANSPORT_SHIP`, `TOWN_CENTER` — which is what scripts
overwhelmingly place.

**Measure the denominator through the resolver this tool actually calls, and
say which population each number is over.** Four scans over the 32 maps on
this mount, each a strict refinement of the one above it:

| scan                                          | `create_object` | resolvable          | covered by `allowedTerrains` | share   |
| --------------------------------------------- | --------------- | ------------------- | ---------------------------- | ------- |
| token scan, `/* */` comments left in          | 2052            | 1034 built-in names | 580                          | 56%     |
| token scan, comments stripped                 | 1937            | 997 built-in names  | 562                          | 56%     |
| + each file's own `#const NAME <int>` table   | 1937            | 1790                | 575                          | 32%     |
| through S0, instantiated at 4 players, seed 1 | 1475            | 1379                | **471**                      | **34%** |

**The last row is the one this tool lives on** — it is `instantiateScript`'s
own output resolved the way `objects.ts` resolves it (name first, then the
instantiation's own symbol table, over the `category === "object"` rows
`objectIndex` builds from) — and it is 34%, not 56%. The move is structural rather than
incidental, and an earlier revision predicted its direction backwards:
resolving `#const` names is precisely what reaches the guide:2211 placeholder
idiom (`PHON` ×152, `ONGRID_PLACEHOLDER` ×147), placeholders are unrestricted
carriers by construction, so **every use the real resolver adds to the
denominator is a use tier 1 cannot serve**. A token scan does not overstate
coverage by being crude; it overstates it by silently dropping the family that
dilutes it.

**So Sec.2's conclusion survives and its headline number is "about a third".**
Tier 1 covers about a third of resolvable `create_object` uses and the
majority of the resource family, which is the claim the rest of this section
rests on. Do not re-cite 56% — it is a token scan over comment-including text,
and both of those qualifiers matter.

**What tier 1 buys varies 3× within that third**, measured by intersecting
each row's `allowedTerrains` against the 110 terrains `isWater: false` admits
(the `uses` column here is the comment-stripped token scan, row two above):

| family                                           | restriction   | uses | land terrains the exact table refuses |
| ------------------------------------------------ | ------------- | ---- | ------------------------------------- |
| `GOLD` / `STONE` / `FORAGE`                      | 8             | 261  | **27**, including `BEACH`             |
| `TOWN_CENTER` / `HOUSE` / `DEER` / `WOLF`        | 4, 1          | 57   | 16–17                                 |
| `VILLAGER` / `RELIC` / `BOAR` / `SHEEP` / `KING` | 7             | 180  | **1** (`DLC_BLACK`)                   |
| the fish/water family                            | 19, 13, 3, 15 | 64   | n/a — water-side                      |

(The four rows total 562 exactly, which is the comment-stripped token scan and
nothing to do with resolution — the 18-use gap to 580 is comments, not the
resolver. The shape is what the table is for, not the last unit.)

So for the 180 tier 1 and tier 2 return the same answer on any script anyone
would write, and **Sec.2's claim lives on the 261**. The `BEACH` row is also why Sec.3.3's terrain surface has to include the
producers a script never names: restriction 8 refuses beach, and beach is
something this corpus really puts on the ground — 225 `terrain_type BEACH` and
10 `base_terrain BEACH` across 2 of the 32 maps, before the automatic beach
pass adds any.

The two layers therefore **legitimately disagree** on a terrain-impossibility
finding for exactly the objects a beginner script is made of: the static layer
reads `allowedTerrains` **when the row has it** and answers "does the ENGINE's
terrain table admit this", while the Monte Carlo layer's `terrainAbsent`
failures come from the generator's coarser `habitat` filter and answer "did the
PREVIEW's approximation find a tile".

**"Admit this" is two questions and Sec.3.3 splits them, because only one of
them is the engine's.** Where the command names a terrain, the static question
is `allowedTerrains ∩ {that terrain}` and nothing else; whether the script ever
lays that terrain down is `terrainAbsent`'s question and the static layer must
not answer it under the exact table's label. Where the command names none, the
static question genuinely is `allowedTerrains ∩` the script's terrain surface,
and the finding is a joint claim worded as one. Rev 6 stated the first case in
the second case's form and the corpus output was **2 findings, both false** —
`terrainAbsent` in disguise, printed as an assertion about the engine's data on
maps whose engine tables permit the terrain named (Sec.3.3). **Both findings
are correct at their own precision and the report must label which is which**
(Sec.5.1: static findings carry `"engine table"` or `"terrain category"`
provenance per Sec.3.3's tier, Monte Carlo findings carry `"approximate
preview"`) — collapsing them into one undifferentiated list would be exactly the
"confidently wrong" failure CLAUDE.md names as goal 1.

**The restriction table is a follow-up, not a prerequisite** — Sec.9 carries the
decision and its cost. Sec.3.3's tier 1 is written to read the field per row, so
it widens from 31 rows to 2666 on the day the table lands with no change to this
document.

**Standing rule, because this section was built on a doc comment once already —
and the warning that used to sit here has been discharged.**
`game-constants.schema.json`'s description of `terrainRestrictionId` said the id
sat beside the expanded row, _"which is why `allowedTerrains` carries the row
itself beside it"_, which was false on 2666 rows. **It was rewritten on
2026-08-16**: the description now states the correction in this document's own
terms (2666 rows carry the id, 31 carry `allowedTerrains` beside it) and
`allowedTerrains`'s own description leads with _"PRESENT ON 31 OBJECT ROWS ONLY,
NOT ON THE ROSTER"_, citing this document by section.
`npm run check:generated-types` is green, so the generated type went with it.

The rule survives its instance and is the reason this paragraph is kept rather
than deleted. Neither gate would have caught the original: `validate:reference`
checks data against the schema and the field is optional,
`check:generated-types` diffs the generated type against the schema and never
looks at the data. **Read the data, not the comment, before this section is
quoted again** — and note which way this one decayed. A _warning about a defect_
decays exactly as a measurement does, and it decays faster, because a warning
invites nobody to re-run anything; its whole form is "we checked, do not check
again". A revision that re-derived every count in this document went one further
revision without re-reading the single file its own Sec.2 tells the reader to go
and read.

## 3. Static-analysis layer

Runs against `InstantiatedScript` (S0's own output, `instantiate.ts`) — **no
`TileGrid`, no S1-S6.** That much is deliberate and unchanged: the checks below
are cheap because they read resolved attribute values rather than simulating
placement.

**Positive-resolver rule applies throughout (CLAUDE.md hard rule).** An object,
terrain or actor-area reference the reference data has no row for is
**UNRESOLVED, not ABSENT-therefore-BROKEN.** Every check below has an explicit
third outcome — "cannot determine" — and a check that cannot determine reports
nothing, per the same rule that keeps RMS0200 silent on a mere miss.

### 3.0 There is no such object as _the_ `InstantiatedScript`, and every check below inherits that

`instantiateScript(parse, refDb, settings, masterSeed)` **takes the seed, and
uses it twice**: `rnd(a,b)` in any numeric slot draws from an S0 substream, and
`start_random` branch selection rolls from another. It takes `settings` too, so
the label environment, conditional resolution and per-player division all vary
with the player count. There is one instantiation per **(player count, seed)**,
not one per script.

**Measured over the 32 maps on this mount. Every row is swept over the range
the tool actually runs, not over one pair of points** — the two-point readings
are kept beside them because they are what an earlier revision published, and
they understate the rate a reader will apply to Sec.4.2's aggregation by 3×:

|                                                                | one pair             | **swept over what the tool runs** |
| -------------------------------------------------------------- | -------------------- | --------------------------------- |
| a **watched static-check input** changes across seeds 1–5      | —                    | **13 / 32**                       |
| the instantiated **command set** changes with the seed         | 4 / 32 (seed 1 vs 2) | **12 / 32** (seeds 1–5)           |
| the instantiated **command set** changes with the player count | 7 / 32 (4 vs 8)      | **12 / 32** (2/4/6/8)             |
| the instantiated **command set** changes with the map size     | —                    | **11 / 32** (all seven sizes)     |

"Watched" means the attributes these checks read, **and that set shrank in this
revision, so the rate did too.** An earlier revision measured eight attributes —
`number_of_objects`, `number_of_groups`, `land_percent`, `number_of_tiles`,
`min_distance_group_placement`, `group_placement_radius`,
`min_distance_to_players`, `max_distance_to_players` — and got **23 / 32**, with
15 of the 23 producing five distinct fingerprints. Sec.3.4's packing bound is
CUT, and with it the four count-and-spacing attributes that
carried most of that variance: the remaining watched set is `land_percent`,
`number_of_tiles`, `min_distance_to_players`, `max_distance_to_players`, the
three actor-area attributes and the terrain-surface producers, and it measures
**13 / 32, five of them producing five distinct fingerprints**. Both numbers are
recorded because the drop is a consequence of a design decision rather than a
correction, and a later revision that re-adds a count-reading check inherits the
higher rate again.

The key has to be stated or neither number can be re-measured: the fingerprint
is the set of `(section, command span, attribute) → resolved values` triples,
and it gives its answer whether taken deduped or over every occurrence. **The
map-size row is the third revision in which it has been re-derived by a
different method, so it carries its fingerprint explicitly**: sorted
`(section, command, span)` triples and a plain sorted command-name multiset
both return 11, while the other three rows reproduce unchanged under the same
instrument, which is the control that says the instrument did not move. The
corpus context, and the reason this is not an edge case:
`start_random` appears in **27 of 32** maps (104 times in `AK_Namatjira.rms`
alone) and `rnd(` in **23 of 32** (125 times in Namatjira). **That second 23 is
a coincidence of this corpus and not the same 23 as the table's first row** —
a map can write `rnd()` in a slot no check reads. Do not derive one from the
other; both are measured separately.

The direction of the sweep favours the design and is exactly why the numbers
are restated rather than left to be re-cited at a third of their size:
`commandSpan` aggregation (Sec.4.2) has to tolerate a span present in only
some runs, and it has to do so three times more often than the pairwise
reading implies.

**So the layer's input is pinned, and its soundness claim is scoped to match.**

1. **Run the static layer once per selected player count**, at the same
   `baseSeed` the Monte Carlo layer starts from. A finding carries the player
   count it was found at, exactly as a Monte Carlo row does.

   **Carries it as a field, and the renderer collapses the duplicates** — on
   this corpus every static finding is identical at all four counts, so
   rendered per pass the output is the same block four times over
   (`Pa_Site_v1.1.rms`: 256 distinct findings × 4 = 1024 blocks, over
   `LIMITS.maxBlocksPerOutput`). Sec.5.1 carries the collapse. This rule is
   unchanged and still earns its cost: what moves across counts is the command
   **set**, on 12 of 32 maps (Sec.3.0's own drift census), and running once at
   `ctx.settings.playerCount` would label four columns with one.

2. **Demote any finding whose inputs are seed-derived** from "guaranteed" to
   "guaranteed on this seed", and say so in the finding's own text. This is not
   a guess about provenance: `InstantiatedArg.source` keeps the originating
   `ArgNode` (`types.ts`), so a check can look for an `rnd` bound in the source
   node and label from what it finds.
3. **Where a sound-on-any-seed answer is available cheaply, prefer it.**
   Reading an `rnd`-sourced operand at its **lower** bound is guaranteed on
   every seed at the cost of catching less. No surviving check needs it — the
   one that did was Sec.3.4's packing bound, since cut — but the rule
   is kept, because it is the rule any future count-reading check has to obey
   and Sec.3.4's own history is what it costs to skip it.

A check that skipped all three would report a per-draw outcome as a guaranteed
error — confidently wrong, in the one direction this whole document exists to
avoid.

### 3.0b There is no such thing as _the attributes of a command_ either, and no instantiation contains them all

Sec.3.0 pins the layer's input. This section pins what that input is missing,
because the answer is not "nothing" and every check below inherits it.

**The construct.** `parser-design.md` Sec.5.4's shared-block rule: a `{`
arriving right after a completed `if`/`start_random` whose branches end in
block-capable commands becomes an `OrphanBlockNode` carrying **info RMS0110**,
_"this block is shared by the command(s) chosen in the if/random above"_. It is
guide Example2, cited in this repo's own parser spec as a guide-endorsed idiom,
and the corpus uses it heavily. `Pa_Site_v1.1.rms`:

```
    endif
    {
        place_on_specific_land_id 420
        ...
        actor_area 8000
        actor_area_radius 2
    }
```

Sixteen lines below, `create_object SKELETON { … actor_area_to_place_in 8000 … }`
— an ordinary attached block.

**Those attributes are on no command, in the AST or in the instantiation.**
They are `AttributeNode`s inside an `OrphanBlockNode`, so an AST walk phrased
as "every `create_object` carrying attribute X" does not reach them; and
`instantiate.ts` sends `orphanBlock` straight to `unsimulatedNote` and drops
the contents, so `InstantiatedCommand.attributes` never holds them either.
**Both of Sec.3's two input surfaces are blind to the same construct**, which
is why this sits beside Sec.3.0 rather than inside one check.

**Measured over the 32 maps on this mount:** 29 `OrphanBlockNode`s across
**5 of 32 maps** (`Pa_Site_v1.1.rms`, `TL Cape of Storms.rms`,
`TL Team Acropolis.rms`, `W4 - Immersion.rms`,
`OWWC1Tewaipounamu-edited-v1.2.rms`), carrying **216 attributes** between them,
against 31 RMS0110 diagnostics corpus-wide. The count descends into `if` and
`start_random` nested _inside_ a shared block, because `instantiate.ts` drops
the block whole and so drops those too. The rows that matter to a check here:

| attribute                 | occurrences | maps | which check reads it                      |
| ------------------------- | ----------- | ---- | ----------------------------------------- |
| `avoid_actor_area`        | 27          | 4    | Sec.3.2, reference side                   |
| `min_distance_to_players` | **21**      | 5    | Sec.3.4 — the only surviving static check |
| `second_object`           | 15          | 3    | Sec.3.3's never-check rule                |
| `actor_area`              | **14**      | 3    | Sec.3.2, declaration side                 |
| `actor_area_radius`       | 14          | 3    | —                                         |
| `actor_area_to_place_in`  | 9           | 3    | Sec.3.2, reference side                   |
| `max_distance_to_players` | 7           | 3    | Sec.3.4                                   |
| `terrain_to_place_on`     | 4           | 2    | Sec.3.3                                   |
| `base_terrain`            | 3           | 1    | Sec.3.3's terrain surface                 |
| `land_percent`            | 3           | 1    | Sec.3.1's sum                             |

**The direction differs per check, and only the declaration side is dangerous.**
A hidden `land_percent` understates declared area and a hidden
`min_distance_to_players` never trips `minExceedsMax` — false _negatives_, in
the "your map is fine" direction, which this document tolerates and states
rather than fixes, because Sec.3.1 and Sec.3.4 read `InstantiatedScript` and
cannot see these attributes at all without a second input surface. A hidden
**declaration** is the other sign: it makes Sec.3.2 emit an error-severity
false positive on a shipped map, which is the one failure class Sec.3.2's
soundness argument exists to exclude. So the rule is asymmetric and cheap, and
**the asymmetry is the whole of it** — a construct invisible to two readers for
two different reasons does not get one fix:

1. **Every scan that only ever SUPPRESSES a finding descends into
   `OrphanBlockNode`s** — Sec.3.2's declaration side (both forms), Sec.3.3's
   terrain surface. _Which_ command the attribute belongs to does not matter,
   because a suppressing scan is allowed to be over-generous.
2. **A REPORTING scan may descend only where it can honestly anchor the
   finding.** Sec.3.2's reference side does, because a shared block _executes_
   and the attribute's own span is real, clickable code; the finding is then
   worded to name the reference rather than a command's outcome, since which
   command consumes the block is exactly what RMS0110 records as ambiguous.
   Sec.3.1's sum and Sec.3.4's comparison cannot, because both are claims about
   a command and neither has one.
3. **Every check that reads `InstantiatedScript` states its blind spot in its
   own section**, one sentence naming the direction, rather than leaving a
   reader to rediscover it as a missing detection.
4. **S0 already emits an `unsimulated:<span>` `SimulationNote` for every one of
   these blocks**, so the report has an honest surface for them and Sec.5.4 is
   what connects a suppressed finding to its cause.

**There is a THIRD construct with the same shape and it needs a different rule
again.** `RawNode` — the parser's "never silently drop content" degradation — is
invisible to both surfaces like a shared block, but it is **opaque by
construction**, so rule 1 has nothing to descend into and the answer cannot be
"descend": it has to be **abstain**. Rules 2 and 3 apply unchanged and are
inherited here: every check loses whatever the node hides, in the false-negative
direction, and says so. On this corpus 10 of 32 maps carry one, 159 in total,
and one of them is 70.9% of its file. `instantiate.ts` already treats `raw` and
`orphanBlock` identically (one `unsimulatedNote` per span, same `case` arm),
which is why the two are easy to conflate and why the difference is written down
here rather than left to the reader.

**A raw node damages EVERY suppressing scan, not only the terrain surface, and
an earlier revision said the opposite in terms.** It read _"Sec.3.3's own
`RawNode` subsection carries it, because the surface is the only thing it can
invalidate"_ — false, and the corpus carries the counterexample twice. Sec.3.2's
declaration side is also a suppressing scan over the AST, and a missed
declaration is a missed **suppression**, so the check calls an id
guaranteed-undefined at **error** severity on a script that declares it. That is
the same failure class the shared-block rule above cost a blocking finding to
close, one construct over. **Measured: 88 actor-area ids are declared only
inside a `RawNode`** — 87 in `Rage Forest 2026.rms` (`actor_area 20000`
through `20086`, all inside the 90,719-character node) and id **2** in
`TL Cape of Storms.rms`, inside an 864-character node that swallows a whole
`create_object GOLD { … actor_area 2 … }` after a malformed `elseif`. That map
**references the id twice** (`actor_area_to_place_in 2` on `create_object
MINING_CAMP` and `create_object VILLAGER`), and `actor_area 2` appears once in
the file, inside the node — the `Pa_Site` shape exactly, one construct over.

**So the rule is per-scan, and the SHAPE is what belongs here rather than the
token.** Every suppressing scan that a raw node can invalidate abstains for the
script when **any `RawNode`'s own source text contains a token that scan's
inputs cannot be spelled without** — a lexical containment test over the node's
own text, used only in the abstaining direction, never as a population count
(which is what Sec.2 and Sec.3.2 forbid). Each section names its own token and
measures its own abstention rate, because the token is a property of what that
scan reads:

| scan                       | token                      | abstains on                                      |
| -------------------------- | -------------------------- | ------------------------------------------------ |
| Sec.3.3's terrain surface  | `terrain` / `#const` / `<` | **1 of 32** (`Rage Forest 2026.rms`)             |
| Sec.3.2's declaration side | `actor_area`               | **2 of 32** (`Rage Forest`, `TL Cape of Storms`) |

Sec.3.1's sum and Sec.3.4's comparison need no entry: both read
`InstantiatedScript`, both lose whatever the node hides as a **false negative**,
and rule 3 already makes each say so.

**It does not fire on this corpus today and the reason is worth stating
precisely rather than being read as safety.** Both of `TL Cape of Storms`'s
referencing commands sit inside an untaken `if EMPIRE_WARS`, so they never reach
the instantiation at the settings the tool runs, and Sec.3.2's reference side is
instantiation-scoped. The measured Sec.3.2 output is therefore **unchanged in
both finding rows** by adding the abstention (4 / 4 / 2 and 30 / 7 either way,
verified by running the check with and without it); only the abstention count
moves, 1 to 3. The check is one label environment away from two error-severity
false positives on a shipped map, in a construct this document had already
identified and described as unable to reach it.

**The lesson, because it is one level up from the counts.** Sec.3.2 was written
from `objects.ts` and `instantiate.ts`, correctly — which is why its severity
split is right — and "the attributes of a command" is a question **neither file
answers on its own**: the parser has a documented third case where the
attributes are not inside the command. The standing rule is _a spec section that
says it mirrors a function must be written FROM that function_; the extension is
that **a section reading a CONSTRUCT must be written from the parser's model of
that construct**, because the generator's model of it is `unsimulatedNote` and
silence.

### 3.1 `land_percent`/`number_of_tiles` over-allocation

**Detection.** For **each** selected player count, sum
`declaredTargetTiles` (`lands.ts`, computed per land from
`land_percent`/`number_of_tiles`, before the `behaviorVersion` additive/included
adjustment — Sec.7.0 exports it), with player lands
multiplied by the player count exactly as `lands.ts`'s own `reportFor` already
does for its `attempted` count. **The multiplier is `create_player_lands` only.** An
`assign_to`/`assign_to_player` land takes a ring slot like a player land and
reads like one, but it is ONE land: `lands.ts` gives it `perPlayerDivisor` 1
and `attempted += 1`, against `playerCount` for a `create_player_lands`
occurrence. Multiplying it would over-count the declared area by a factor of
the player count and turn this check into a false-alarm generator on every map
using the idiom. Compare the sum to `dim * dim`
(`InstantiatedScript.dim`, **post**-`override_map_size` — never the lobby
`mapSize.tiles`, which is exactly the trap `tools-api-design.md` Sec.2 names by
quoting this check specifically: _"A static check keyed on map area... computes
against the wrong grid on every script that overrides, and fails quietly, in
the direction of 'your map is fine'."_).

**A land declaring the whole map or more is EXCLUDED from the sum, and that
exclusion is the difference between a check and a noise floor.** Specified
without it and run over the corpus, this check warns on **23 of 32 tracked maps
at 4 players (92 of 128 map/player-count pairs), with ratios from 100% to
1393%** (`AK_ForeDaut_v1.3.rms`). The cause is an idiom rather than a defect:
two or more `create_land` commands each asking for `land_percent 100` is how a
script says _fill whatever is left_, and growth stops when a land meets its
target **or runs out of frontier** (`lands.ts`, `growLands`), so the
over-declaration is the mechanism working. `AD4 - Ra.rms` is the clean specimen,
labelled by its own author's comment (`/* neutral space */`) and summing to
800%. Excluding lands whose declared target is `>= dim*dim` takes the check to
**6 of 32 maps and 24 of 128 pairs**, and leaves a question the check can
answer: do the lands that named a _size_ fit?

Keep both numbers beside each other, because a later reader will otherwise
reintroduce the sum-everything form as a simplification: **23 of 32 as first
specified, 6 of 32 with fillers excluded.** The 17 maps in the gap stop warning
for one reason — a filler land carried their sum over on its own — so the
exclusion is not a threshold that happens to work, it is the idiom leaving the
population.

**Which value the exclusion tests has to be written down, and it is the RAW
declared target.** `declaredTargetTiles` returns the value **after** the
`perPlayerDivisor` division, and the check multiplies player lands back up
before summing, so `>= dim*dim` can be read against either the pre- or the
post-division figure. Test the pre-division one: it is the area the author
declared, and the post-division reading would let an 8-player `land_percent
100` slip under the bar as 12.5% of the map. Measured, **0 of 32 maps flip
between the two readings**, which is exactly why this needs the clause rather
than a re-measurement later — it is safe today and silently unpinned.

**This check reads `InstantiatedScript`, so it cannot see a `land_percent`
inside a shared block** (Sec.3.0b) — 3 occurrences on 1 map — **nor one inside a
`RawNode`** (Sec.3.3's subsection), which on this corpus is a whole
`<LAND_GENERATION>` on one map. The direction is the same in both cases and it
is a false negative: the sum is understated, so the check under-reports rather
than over-reports, which is the tolerable sign for a finding that is already
info. Neither warrants an abstention here — an understated sum cannot manufacture
an over-allocation, so unlike Sec.3.3's surface there is nothing unsound to
protect against.

**Which default is being summed also has to be stated.** `declaredTargetTiles`
defaults `land_percent` to 100 (`lands.ts`, `numAttr(cmd, "land_percent", 0,
100)`), so a `create_land` declaring neither size attribute contributes the
entire map. That is a second, independent route to the same false alarm, and the
filler exclusion closes it by construction rather than by a special case. It is
rare — **4 commands across 2 maps** (3 on `24hr_Petra.rms`, 1 on
`TL Black Forest.rms`) — which is exactly why it would have survived review as
an unnoticed clause.

**The per-player-count arithmetic cancels exactly, and the requirement to run
per player count survives on a different mechanism.** `declaredTargetTiles`
divides by `perPlayerDivisor`, which is the player count for a
`create_player_lands` occurrence (`lands.ts`) — so multiplying its lands back
by the player count returns the raw declared area, for both the `land_percent`
and the `number_of_tiles` form, and the sum is player-count invariant. What
does move is the command **set**, on 12 of 32 maps across 2/4/6/8 (Sec.3.0),
and that is the whole reason the check runs per count. Stating the cancelling
mechanism as the reason would leave the real one uncovered by any test.

**The prescribed form is `declaredTargetTiles(cmd, dim, 1)` called ONCE, with
that single value used as both the exclusion test's input and the sum's
contribution** — the implementation reached this and it is sharper than the
prose it came from, because a divide-then-multiply written as two expressions
can drift apart under a later edit and this cannot. Folded back as the form, not
left as a deviation.

**And this check takes no player count at all.** It is invariant by the argument
above; the count belonged only to the finding's old _"At N players,"_ prefix,
and that prefix was the single thing stopping four identical findings from
collapsing into one block (Sec.5.1). The count is now a FIELD on the finding,
stamped by `runStaticChecks`.

**Finding.** `sum > dim*dim` over the sized lands is a shortfall somewhere — the
engine cannot honor every land's declared target, because the targets literally
do not fit. It does **not** say which land loses; growth order interacts with
clumping factor and is exactly what the Monte Carlo layer measures
(`growthShortfall`, Sec.4). Severity: **info**, worded as "the lands that name a
size declare N% of the map between them, so some will grow smaller than
requested; M further lands ask for the whole map, which is the normal way to
fill the remainder", **with the player count carried as a field rather than
written into the sentence** (Sec.5.1's collapse rule) and, when any contributing
`land_percent`/`number_of_tiles` came through an `rnd()` draw (Sec.3.0 rule 2),
"on this seed" rather than a bare assertion.

**Info, not warning, and the demotion is a measurement rather than caution.**
Six of 32 expert maps still trip the exclusion-corrected form
(`AK_Vanguard_v1.2.rms` 554% and `OWWC1Tewaipounamu-edited-v1.2.rms` 551% with
no filler land at all, `24hr_Holler.rms` 396%, `AD4 - Pag - v1.2.rms` 133%,
`AK_Namatjira.rms` 127%, `QS_Three_Bays_v1.1.rms` 114%), and every one of them
is a finished, shipped map that plays. The statement is _true_ on all six and
names no defect on any, which is the definition of an info: a beginner writing
three lands at 60% each is told something they want to know, and an expert is
told something harmless. A warning here would be the "confidently wrong" failure
this document's goal 1 names, arriving through a check that is never wrong.

**Soundness is about the arithmetic, not about the finding, and the two were
conflated in an earlier revision.** "The targets do not fit" is sound — the
`dim*dim` bound is coarse and a script that trips it really cannot fit. What
does not follow is that a script tripping it has a problem, and it was the
second claim that put a warning on 72% of the corpus. **A bound being sound says
nothing about whether the sentence built on it is worth printing.**

**What this deliberately does not attempt.** A tighter bound accounting for
water/unusable tiles would need S1-S6 to know which tiles are unusable, which
is exactly the layer this one is not.

### 3.2 Undefined actor areas

**Detection, and the two ways a script actually declares one.**
`InstantiatedScript.actorAreas` (`instantiate.ts`) indexes every explicit
`create_actor_area` command by identifier — **and the identifier is `args[2]`,
not the command's first argument.** The signature is `x, y, identifier,
radius` (`instantiate.ts`'s own inline comment, and `language.json` agrees),
and the corpus writes the first slot as a math expression
(`create_actor_area (TAX + 3) TAY 11 0`), so an implementer who reads
"`create_actor_area <id>`" as prose about arg 0 gets a plausible number out
and indexes the whole check on the wrong one.

**Scale, with the population named on every number, because these were
`grep`-shaped figures one section after Sec.2 fixed exactly that.** A token
scan over comment-including text answers 286 / 2586; through the parser and
the instantiation the same corpus answers:

|                                               | token scan (comments in) | **through the parser (AST)** | **through the instantiation, 4p/seed 1** |
| --------------------------------------------- | ------------------------ | ---------------------------- | ---------------------------------------- |
| `create_actor_area` commands                  | 286 / 15 maps            | **284 / 15 maps**            | 100 / 12 maps                            |
| `actor_area_to_place_in` + `avoid_actor_area` | 2586 / 31 maps           | **2385 / 30 maps**           | **2001 / 30 maps**                       |
| bare `actor_area` attribute (form b)          | 919 / 31 maps            | **742 / 30 maps**            | 629 / 30 maps                            |

Still the highest-traffic check in Sec.3 by an order of magnitude, and the
conclusions do not change — but the gap is real material rather than rounding:
`AK_Vanguard_v1.2.rms` contains a commented-out `create_object FLAG_A { …
actor_area_to_place_in ACT_AREA_MIDDLE_LARGE … }`, a concrete member of it. The
AST column is the one a scan of `ctx.parseResult` will reproduce and the
instantiation column is the one a scan of `InstantiatedScript` will; quote
whichever matches the side being specified, never the token scan.

But `objects.ts`'s own
placement loop (file header note 5) shows a **second** declaration path: any
`create_object`/`create_object_group` command carrying its own `actor_area
<id>` attribute registers into `liveActorAreas` at its first successful
placement. A static check keyed only on `instantiate.ts`'s map would
false-warn on every script using the second form — 3.2's whole job is to be
sound, so both forms count as "declared".

**Form (b) is the larger path and the number belongs beside form (a)'s, because
the soundness argument is what it supports**: a bare `actor_area` attribute
measures **742 uses across 30 of 32 maps** through the parser, against form
(a)'s 284 across 15. Omitting it would false-warn on almost every map in the
corpus rather than on a minority of them.

For every command in the script carrying `actor_area_to_place_in` or
`avoid_actor_area`, resolve the referenced id and check it against the union
of (a) `InstantiatedScript.actorAreas.keys()` and (b) every `actor_area`
attribute with that id **anywhere in the script** — inside a
`create_object`/`create_object_group` block, or inside a shared block attached
to one (Sec.3.0b). Block-wide, the same scope rule RMS0315 already uses for a
"does a partner exist anywhere" question (`parser-design.md` Sec.8). Phrasing
(b) as _"every `create_object` command carrying its own `actor_area`"_ is what
made an earlier revision miss the shared-block form: in the AST that attribute
is on no command at all.

**Both sides are read as RESOLVED VALUES, never as token text, and this is the
whole correctness of the check.** `actorAreas` is
`ReadonlyMap<number, InstantiatedCommand[]>` — numeric keys. A token scan yields
strings, so `#const MY_AREA 7` + `create_object … { actor_area MY_AREA }` +
`actor_area_to_place_in 7` would compare `"MY_AREA"` against `7`, find nothing,
and emit a **guaranteed-undefined error against a correct script** — a false
positive in the check whose own job is to be sound. Nothing needs inventing:
S0 has already resolved both sides (`InstantiatedArg.value` is
`number | string | undefined` with `#const` names resolved), and `objects.ts`'s
own declaration-form-(b) path — the code this check mirrors — reads
`argValue(cmd, "actor_area", 0)` and gates on `typeof idVal === "number"`. Walk
`InstantiatedScript.sections` and do the same.

**The DECLARATION side is taken over the AST, not only over the instantiation,
and this is Sec.3.0 landing on this check.** An instantiation contains one
resolution of every `start_random`/`if`, so a `create_actor_area 7` sitting in
an unselected branch is simply absent from `InstantiatedScript.sections` — and
this check would then call an id undefined on a script that declares it on other
seeds, which is the false positive it exists not to produce. Walk
`ctx.parseResult` for declarations (both forms, every branch, selected or not),
**descending into `OrphanBlockNode`s** (Sec.3.0b — 14 of the corpus's bare
`actor_area` declarations live in one, and missing them is what put an
error-severity false positive on `Pa_Site_v1.1.rms`).
The **reference** side stays on the instantiation, because a reference in an
unselected branch cannot fail on this seed. The asymmetry is the point: be
generous about what counts as declared, strict about what counts as a
reference.

**The reference side takes shared-block references too, and that is not a
breach of the asymmetry — but it takes them only where S0 reached the block.**
An `OrphanBlockNode` is not an unselected _branch_ in its own right: it
executes, on whichever command the `if`/`start_random` immediately above chose,
so a reference inside one really does run on this seed and belongs in the strict
half. What it lacks is an owning command — which is exactly what RMS0110
records as ambiguous — so the finding anchors on the **attribute's own span**
and is worded to name the reference rather than a command's outcome ("actor
area N is referenced here and nothing in the script creates it").

**"It executes" is false for a majority of this corpus's shared blocks, and the
reference side's strictness rested on it.** A shared block can be nested inside
an ordinary conditional like anything else, and then it executes only if that
conditional's branch was taken. Measured over the 29 blocks: **16 of 29 are
nested inside an `if` branch** (`Pa_Site` 6 of 6, `TL Cape of Storms` 9 of 12,
`TL Team Acropolis` 1 of 2), and **1 of 29 is not reached by S0 at all** at
4 players / Normal / seed 1 — `TL Team Acropolis.rms` at offset 56719, inside an
`if REGICIDE`, carrying three `avoid_actor_area` references and one `actor_area`
declaration on a block that executes on no command at these settings. So the
clause is: **a shared block inherits the branch selection of the construct it is
nested in; take its references only where S0 reached the block.** S0 records
that for free — it emits an `unsimulated:<start>-<end>` note for every orphan
block it walks, and Sec.5.4 already consumes those notes — so the test is a set
membership rather than a second branch simulation. The declaration side needs no
equivalent: it takes every branch by design.

Measured, both clauses are insurance rather than live concerns: the shared-block
reference clause **adds 0 findings on this corpus** (every id referenced from a
shared block is declared) and the reachability filter **removes 0** (the
unreached block's three ids are all declared elsewhere in that file). They are
written down so a later reader does not mistake the zeros for reasons to drop
them — the same shape as Sec.3.3's `start_random` clause below.

**And S0's symbol table cannot resolve the declaration side, which is the same
finding one level down.** `instantiate.ts`'s file header states the rule it
implements: _"a symbol inside an UNTAKEN branch never exists"_. So a
`#const MY_AREA 7` sitting in the same unselected `start_random` branch as its
`create_actor_area … MY_AREA …` is absent from `InstantiatedScript.symbols`,
the declaration resolves to nothing, is dropped, and the check emits the
guaranteed-undefined error it was just rewritten to avoid. Reaching for the
instantiation's symbol table would undo the AST scan in the one case the AST
scan exists for. Three rules instead, all cheap — and note that rule 2 below
**adds** the instantiation's answers to the AST scan's rather than deferring to
them, which is what keeps this paragraph and that rule consistent: a union of
two suppressing scans is still a suppressing scan.

1. **Resolve declaration-side `#const` names over the whole AST**, collecting
   every value a name takes in any branch. A declaration counts if the
   referenced id is among them. Over-generous by construction, which is the
   correct direction here — this side only ever suppresses findings.
2. **Take the declaration set as the UNION of the AST scan and the
   instantiation's own resolved values** (`actorAreas.keys()` plus every
   instantiated `actor_area` attribute value). Both sides only suppress, so
   unioning them cannot introduce a false positive, and S0 evaluates math
   expressions — which buys the one thing rule 1 cannot do. `24hr_Caverns.rms`
   writes `actor_area (AA_TC)`, a parenthesised expression a `#const`-name scan
   cannot evaluate; S0 resolves it to 1 for free.
3. **A declaration whose id resolves on NEITHER side makes the check abstain
   for that script.** An unresolvable declaration is an actor area whose id we
   cannot name, so no reference can be proven undeclared. This is Sec.3's own
   third outcome, and rules 1 and 2 make it rare: measured over both
   declaration forms there are **38 non-literal declaration ids — 2 in form (a)
   and 36 in form (b)** — and after both rules exactly **one map abstains**.
   That map is `AK_Vanguard_v1.2.rms`, which writes `actor_area
ACT_AREA_TEAM_RES_TERRAIN`, a name **no `#const` in the file defines** (see
   the unresolvable-reference rule below — the same name, on the other side,
   is where the corpus's clearest actor-area defect lives).

   **The "2 of 286" this rule used to rest on was form (a) only**, in a section
   whose own text calls form (b) the larger path. A rule quantifying over both
   forms has to be measured over both.

4. **A `RawNode` whose own source text contains `actor_area` makes the check
   abstain for that script** — Sec.3.0b's per-scan containment rule, with this
   section's token. A raw node is opaque, so rule 1 has nothing to descend into
   and a hidden declaration is a missed suppression, which is this check's one
   fatal direction. `actor_area` is a substring of **both** declaration forms
   (`create_actor_area` and the bare attribute), so its absence from a span of
   source _proves_ no declaration is hidden there — which is what makes this a
   decision procedure rather than a judgement. **Measured: 2 of 32 maps abstain**
   (`Rage Forest 2026.rms`, `TL Cape of Storms.rms`) and both finding rows below
   are unchanged, so the rule costs this corpus nothing and buys the 88
   raw-node-only declaration ids Sec.3.0b counts.

   A hidden `#const` needs no clause of its own here, and the reason is worth one
   sentence because Sec.3.3's token list does carry one. A `#const` inside a raw
   node is invisible to S0 as well, so a reference naming it resolves to no
   number, and the check compares nothing — the unresolvable-reference case
   below, not a false positive.

**The reference side's `#const` case is not a fixture, and the numbers say so
loudly enough to be worth writing down.** 146 references across 11 of 32
maps are written as a name or an expression rather than a literal, over
**62 distinct names** — `ACT_A_GOLD_A`, `AA_9V_VIL`, `GOLD_SECONDARY_CAA_C`.
That is the population the resolved-values rule above protects, and it is why
Sec.8's mutation of that rule back to token text has real material to go red on
rather than only a hand-built fixture. (`24hr_Caverns.rms`'s `(AA_TC)` was
listed here in an earlier revision and belongs on the declaration side: it is
`actor_area (AA_TC)`, form (b), and it is the single thing that used to trigger
rule 3's abstention on that map.)

**An unresolvable REFERENCE is not a static finding, and saying so is a
decision rather than an omission.** Rules 1–3 pin what an unresolvable
_declaration_ does and an earlier revision said nothing about the other side.
The corpus has one, and it is the finding a beginner-facing tool exists to
print: `AK_Vanguard_v1.2.rms` carries `actor_area_to_place_in
ACT_AREA_TEAM_RES_TERRAIN` on **18 `create_object` commands**, and that name is
defined nowhere in the file. `objects.ts` reads `typeof id === "number" ?
(liveActorAreas.get(id) ?? []) : []`, so a non-numeric id yields an empty area
list, `buildCandidatePredicates` returns `undefined`, and every one of those
commands **places nothing**. `validate()` produces 5 diagnostics on that map
and none of them names the constant, so nothing in the app tells the author
today.

As specified this check is silent twice over: the reference is not a number so
no comparison happens, and rule 3 has already abstained the whole script. That
stands, and it is the right answer — **an unresolved name in a numeric slot is
the parser's territory, not this tool's**, and inventing a static finding for
it here would put the same claim in two places under two vocabularies. **The
consequence is that the Monte Carlo layer is the only thing that will report
it** — as an `actorAreaMissing` bucket on a row with **no** spawn rate, since
these commands attempt nothing rather than failing at attempts (Sec.5.1's
zero-attempt rule; `0%` would be a measurement and this is the absence of one),
so Sec.5.1's suppression rule
has to be worded to leave it visible — it keys on "a command already carrying a
Sec.3.2 finding", which this command will not have. Sec.9 carries the parser
question as a follow-up rather than absorbing it here.

**Finding, and it is TWO findings because `objects.ts` treats the two reference
forms differently.** An id neither declaration scan finds is **guaranteed**
undefined — no successful placement, on any seed, ever creates it, because
nothing in the script ever tries. What that costs the command depends on which
attribute referenced it:

- **`actor_area_to_place_in`** collapses the command to zero placements:
  `objects.ts` returns `undefined` from `buildCandidatePredicates` when the
  referenced area list is empty, and the caller pushes `actorAreaMissing`.
  Severity: **error**, and "the referencing command places nothing, matching
  `actorAreaMissing`'s existing message register" is true of exactly this form.
- **`avoid_actor_area`** is a **silent no-op**. The avoid predicate is pushed
  only `if (avoidAreas.length > 0)`, so an undeclared id pushes nothing and the
  command places normally — which is also the semantically obvious reading, since
  avoiding a region that does not exist avoids nothing. Severity: **info**,
  worded "this command avoids actor area N, which nothing in the script creates,
  so the line has no effect". That is the register RMS0315 already moved to after
  BUG-007 re-scoped it from "this command places nothing" to "this line does
  nothing", on the identical shape.

**The split is not a nicety — it is most of what this check emits, and the
measurement below is the check as prescribed rather than an approximation of
it.** An earlier revision measured the declaration side by unioning
instantiations across 2/4/6/8 × seeds 1–5, labelled in its own sentence as
"to approximate the generous AST-wide scan above", and never tested the
approximation. It cannot reach a branch gated on **map size**, which is exactly
the shape this corpus contains: `AK_Vanguard_v1.2.rms` declares 6756/6757
inside `if TINY_MAP / elseif … / elseif HUGE_MAP`, `Menindee_AUS_v2.3.rms`
declares 9900/9901 inside `if HUGE_MAP`, `OWWC1Tewaipounamu-edited-v1.2.rms`
declares 6900/6901 inside `if TINY_MAP` — invisible at Normal at every player
count and every seed. **Sec.3.3 already names the first of the three**, used
there to justify a different design point and never carried back to the
paragraph whose baseline it invalidates.

Measured at 4 players / Normal / seed 1 over the 32 tracked maps, each row a
strict refinement of the one above it:

| declaration side                                             | `actor_area_to_place_in` (error) | `avoid_actor_area` (info) | scripts abstaining |
| ------------------------------------------------------------ | -------------------------------- | ------------------------- | ------------------ |
| instantiation union — the approximation, kept as the control | 11 ids / 12 commands / 4 maps    | 59 commands / 10 maps     | 0                  |
| **as this section prescribes** (AST scan, all branches)      | **5 / 5 / 2**                    | **37 / 8**                | 2                  |
| + descending into `OrphanBlockNode`s (Sec.3.0b)              | **4 / 4 / 2**                    | **30 / 7**                | 2                  |
| + unioned with S0's own resolved values (rule 2)             | **4 / 4 / 2**                    | **30 / 7**                | **1**              |
| **+ the `RawNode` abstention (rule 4)**                      | **4 / 4 / 2**                    | **30 / 7**                | **3**              |

The last row is the check as specified above and the number to hold this tool
to. The first row is kept beside it the way Sec.3.1 keeps its 23-against-6,
because the gap is the _measurement's_ and not the check's, and a later reader
will otherwise re-derive the loose form as a simplification.

**Rule 4 is the one row whose finding columns do not move, and that is the
result rather than a reason to drop it.** It was measured by running the check
with and without it, because a fix prescribed for a finding is a claim in its
own right: the two abstaining maps contribute nothing to either finding column
today (`Rage Forest` parses as one section; `TL Cape of Storms`'s two references
sit in an untaken `if EMPIRE_WARS`), so the rule buys soundness at zero measured
cost. A later corpus where either map's branch environment differs is exactly
where it starts paying.

**Count findings by DISTINCT (map, id) pair, and the reason this needs stating
is in the first row.** Read by referencing command instead, the same run
answers 12 rather than 11 — the convention was never pinned, so a reporter and
a reader could disagree by one and both be right. One id referenced from three
commands is one defect; the table has three rows of evidence for it.

**The four are worth stating as a positive result rather than left as a
surprise, and at their true size.** `Pa_Site_v1.1.rms` 81, 82 and 91 and
`Menindee_AUS_v2.3.rms` 1000 are declared nowhere in their files by either
form — genuine defects in expert maps, which makes this check the tool's first
real corpus win, and the one place in Sec.3 where the corpus is expected to be
non-zero. The fifth of the earlier revision's five was `Pa_Site`'s 8000, which
is Sec.3.0b's false positive; the other seven were declarations the
approximation could not see. Sec.8 item 2's baseline records the corrected
numbers.

An id that IS declared by
form (b) but might fail to place on a given seed is explicitly **not** this
check's job — that residual (declared, but not live at the point of reference
on this particular run) is exactly `actorAreaMissing`'s existing job in the
Monte Carlo layer (Sec.4), and the two must not double-report the same
command: Sec.5.1 pins the suppression rule.

### 3.3 Placement on terrain that can't exist

**Detection.** For every `create_object` command, resolve the object reference
(`objects.ts`'s existing two-step resolver: built-in name, then the script's own
`#const` table — Sec.2 above is why this check must call that resolver rather
than inventing a second one).

**That resolver is `objectEntry` and today it can answer neither of the two
questions below.** It is module-private, and it is typed to `ObjectConstant`,
the preview's own six-field projection, which carries **neither
`allowedTerrains` (tier 1, below) nor `verified` (Sec.3.5's readiness gate)** —
so "call the existing resolver" as written is unimplementable, and the two ways
out are the second resolver this paragraph forbids or a source change. **Sec.7.0
is the source change**: export `objectEntry` generic over its row type, which
it can be because it only ever touches `constId`, `rmsConstant` and `category`.
One exported function then serves the preview's `ObjectConstant[]` and this
check's `PublishedGameConstants` with no second index and no second copy of the
two-step rule. Then:

1. **If `PublishedGameConstant.allowedTerrains` is present** for the resolved
   object — **31 rows today, the ones scripts place most, and every row carrying
   a `terrainRestrictionId` on the day Sec.9's table lands; test the field, never
   a hardcoded object list** — the test **forks on whether the command names a
   terrain, and the two halves ask different questions of different data.**

   - **`terrain_to_place_on` resolves to a terrain id ⇒ test
     `allowedTerrains ∩ {that terrain}` and nothing else.** This is the pure
     engine-table question, it is the one the _"exact terrain table"_ provenance
     label is entitled to make, and it is what
     `create_object DEER { terrain_to_place_on WATER }` fails. **Whether the
     script ever lays that terrain down is a different question with an existing
     owner** — `terrainAbsent`, a `FailureBucket` the Monte Carlo layer already
     reports with a spawn count attached (Sec.4), assigned by Sec.2 to the
     _approximate preview_ provenance. Do not intersect the surface here.
   - **`terrain_to_place_on` is written but does NOT resolve ⇒ report nothing
     for this command.** This is the positive-resolver rule the section's own
     opening paragraph states, applied to the fork rather than around it, and it
     is the arm two bullets quietly omitted: written as a pair whose second is
     labelled "No terrain named", the second reads as the `else`, so an
     implementer routes an unresolvable name to the **surface** test on a
     command whose author named a terrain — which is the three-set reading this
     fork exists to eliminate, reintroduced at warning severity through the case
     the fork forgot. **Measured, the state is live and it is at tier 1**: of the
     446 tier-1 commands, **264 name a terrain that resolves, 181 name none, and
     1 names a terrain that does not resolve** — `24hr_Battle Lines 1.0.rms`'s
     `create_object STONE { … terrain_to_place_on TERR_CORNER … }` against
     `#const TERR_CORNER GRASS2` at `:99`, the alias case the surface subsection
     below prices. Tier 2's equivalent count is **0**, which is a fact about this
     corpus rather than about the fork. Both branches cost nothing today —
     `GRASS2` is id 12 and **is** in `STONE`'s 83-terrain restriction-8 row, and
     Battle Lines' surface intersects those 83 as well — so the price of the
     missing arm is entirely what the next revision is licensed to do with a
     fork that has no third branch.
   - **No terrain named ⇒ test `allowedTerrains ∩ surface`** (the terrain
     surface, below). This one is a joint claim — the engine's table AND what
     this script can produce — so its finding says so in those words, and it is
     the half the RawNode rule below can invalidate.

   **This fork exists because rev 6 stated the tier-1 test twice, in two
   subsections, in two forms that disagree, and never said which was meant.**
   Tier 1 read _"compute the script's terrain surface … if the intersection with
   `allowedTerrains` is empty"_; the override subsection read _"the finding is
   `allowedTerrains` ∩ {the named terrain} is empty"_. Three sets against two,
   and on this corpus the difference was the whole of the output: the three-set
   reading — the one an implementer writes, because the surface is the section's
   headline machinery and the override subsection reads as a refinement of it —
   produced **5 findings on 32 maps, of which the 2 that reached warning
   severity were both false**, while the two-set reading produces **0 warnings
   and 1 info**. The two false warnings were `terrainAbsent` wearing the
   exact table's label: `AK_Six_Points_v1.4.rms`'s `TUNA` on `WATER` (id 1,
   **present** in `TUNA`'s 15-terrain restriction-19 row) and `sample.rms`'s
   `GOLD` on `DESERT` (id 14, **present** in `GOLD`'s 83-terrain restriction-8
   row) — checked against `game-constants.json` directly, so the falseness is a
   property of the data rather than of the run that found it.

   **"2 warnings" was never that run's whole output and the loose phrasing is
   part of how the info row survived the fork.** The other three were the same
   defect gated to info by Sec.3.5 (below), which is a distinction Sec.8 item 2's
   own table draws two rows apart. A count of findings and a count of findings
   _at one severity_ are two numbers, and a section that reports the second while
   saying "output" has already mislaid the first.

2. **Else if only `habitat` is present**, fall back to the coarser test, **and
   fork it the same way tier 1 forks**, because the argument is the same one
   tier down and rev 6 made the same omission in both places. Where
   `terrain_to_place_on` resolves, test the habitat against **that terrain
   alone** — a `"water"` habitat against a named `DESERT` is a static
   contradiction the engine will never satisfy, and it is a finding rev 6's
   surface-only form could not make. Where no terrain is named, test against the
   surface: a `"water"` habitat needs at least one terrain in the surface with
   `isWater: true`; `"land"` needs at least one **without** `isWater`. Both
   halves are sound, and only the second reads the surface, so only the second
   inherits the `RawNode` abstention.
   `"shore"` and `"amphibious"` are **not** checked in v1 — deliberately,
   because whether the automatic-beach rule (`preview-design.md`, the per-tile
   depth-boundary rule) reliably produces a `"shore"`-eligible tile from an
   arbitrary land/water surface has not been measured the way the beach rule's
   _rendering_ has, and a habitat this check cannot bound soundly must abstain
   rather than guess. `"any"` never restricts, by definition.
3. **Else (no reference row at all)**: report nothing. Absence proves nothing.

**Finding.** Severity: warning, worded to name which precision produced it —
_"the exact terrain table"_ for case 1, _"this object's terrain category"_ for
case 2 — per Sec.2's provenance requirement.

**That severity is CONFIRMED, and the run that confirmed it is the one three
revisions declined to make.** Sec.3.1 shipped a warning that fired on 23 of 32
maps and Sec.3.4 an error that fired on 26 of 32, both predicted near-zero and
neither run; this section then inherited _"cannot be run until Sec.7.0's
resolver export lands"_ from rev 5 — which was true when rev 5 wrote it, and
stopped being true the moment rev 6 wrote the export out in full and verified
that it compiles. Applying Sec.7.0 item 1 verbatim to a scratch copy takes ten
minutes and the check then runs over the corpus in seconds. **The reason a
section could not be measured is itself a claim with a cost, and it decays: a
prerequisite marked blocking in one revision is not blocking in the next.**

Baseline at 4 players / Normal / seed 1 over the 32 maps, as specified above
(both tiers, `second_object` never followed, `create_object_group` skipped,
valid `ignore_terrain_restrictions` abstaining, the surface taking all six
producers plus `beachTerrainFor`, descending into shared blocks and both
`start_random` branches):

|                                                    | 32 maps                    |
| -------------------------------------------------- | -------------------------- |
| tier 1 checked (`allowedTerrains` present)         | 446 commands               |
| tier 2 checked (`habitat` land/water)              | 356 commands               |
| skipped, valid `ignore_terrain_restrictions`       | 52                         |
| **case 3, resolver returns no row**                | **75**                     |
| **case 3, names a `create_object_group`**          | **21**                     |
| **warnings, three-set reading (rev 6 as written)** | **2 — both false**         |
| **warnings, as specified above**                   | **0**                      |
| **info (Sec.3.5 gate)**                            | **2** — 1 tier 1, 1 tier 2 |

**The two case-3 rows used to be one column reading 96, and splitting them is
what makes it a control.** 75 + 21 = 96, and 1475 − 1379 = 96, so both readings
close — but a single column mixes _"the resolver could not answer"_ with _"the
spec says do not ask"_, which is the un-decomposed number this document pins
conventions against everywhere else. Sec.8 item 2 makes the checked counts a
control precisely so a zero can be told from a broken probe; the object-group row
is the one that goes to 0 the day someone "improves" the check into the
per-member test the subsection below forbids by name.

The tier-2 fork was run before being written down rather than after: **230 of
the `create_object` commands that resolve a row and name a terrain reach tier 2
before the valid-`ignore_terrain_restrictions` skip is applied, and 228 after
it** (habitat `land`/`water`, no `allowedTerrains`) — the pinned table below
counts the 228, and _"checkable"_ was the word doing the damage, since the two
the skip removes are never checked. The fork produces
**1 finding on 32 maps** — the undecided `Chaotic_Straitv0.99.rms` row Sec.3.5
downgrades to info and Sec.9 carries. One finding is near-zero and the severity
holds; a detection added to a spec without being run is what three of the last
four rounds were spent on.

**That denominator needs its counting convention pinned, the way Sec.3.2 pinned
`(map, id)`, because the same run answers it three ways — and a number is pinned
by naming the predicate it counts in the same sentence, not by picking one of the
three.** An earlier revision published **844**, which is none of them. All figures
below are one run at 4 players / Normal / seed 1 over the 32 maps on this mount:

| population                                                | predicate                 | count   |
| --------------------------------------------------------- | ------------------------- | ------- |
| resolves a row and names a terrain that itself resolves   | before any skip           | **843** |
| the same, less the valid-skip members that name a terrain | 42 of the 52 do           | **801** |
| **tier 1 checked + tier 2 checked**                       | what the two tiers divide | **802** |
| checked **and** naming a resolving terrain                | the fork's first bullet   | **492** |

**801 and 802 are one apart by coincidence and they are different sets.** 801
counts **309** commands neither tier ever sees — they name a terrain but carry
`shore`/`amphibious`/`any`/no habitat — while 802 counts **310** the 801 figure
never sees, the checked commands **not naming a resolving terrain** (182 at tier
1 — 181 naming none and 1 naming a name that does not resolve — and 128 at tier
2, all of them naming none). The intersection is 492 both ways.

**A complement is not a predicate, and that is how the odd command hid for a
revision.** `264 + 228 = 492` and `182 + 128 = 310` both close whichever side the
one unresolvable-name command falls on, because 492's predicate is _checked
**and** naming a resolving terrain_ and the arithmetic never cared what the
remainder was made of. Rev 9 wrote that remainder down as "naming no terrain at
all" — a complement described as though it were a category — in the same table it
added to stop exactly this. The number was right; the sentence was not.

**A revision that pinned one number
and called it "the population the two tiers divide" had a true measurement
wearing the wrong label**, and Sec.8 item 2's control row was already carrying
the right one — two sections apart, both right about their own predicate,
neither naming it. That is the failure mode a green run cannot see, in the
document that pins `(map, id)` one section earlier so exactly this cannot
happen.

**Two consequences worth stating, because the near-miss hid both.** The
subtraction that produces 801 is **843 − 42, not 843 − 52**: only 42 of the 52
valid `ignore_terrain_restrictions` skips name a resolving terrain, so a sentence
reading "with the 52 skips removed" invites a reader to check 791 and conclude
the run is broken. And the 310 checked commands naming no terrain are not a
rounding error — they are the entire audience for the six-producer surface table,
the `beachTerrainFor` pass, the shared-block descent and the `RawNode`
abstention. Read as "the population the two tiers divide is the set naming a
terrain", the no-terrain-named half of each fork becomes a branch with no
constituency, and a later revision has a licence to delete the machinery that
serves 38% of the check's own traffic.

**Sec.8's control stays 802**, because the control's job is to prove the scan
ran, and what the scan iterates is the checked set.

**A zero in the WARNING row is the expected result and must not be read as a
defect**, which is the reading Sec.8's own "expect near-zero" guidance was
rewritten to prevent in the other direction. This corpus is expert-written and
the check exists for `create_object DEER { terrain_to_place_on WATER }`, which is
a beginner's mistake; RMS0304 shipped at a corpus count of 0 for the same reason
and its evidence is worked examples plus red mutants, not a corpus census. If a
later corpus does make it fire broadly, it demotes the same way Sec.3.1 did.

**The info row is 2, and the revision that published 4 had carried three of them
across the fork unre-derived.** An earlier revision described them as _"Sec.3.5's
gate firing exactly where it said it would (`SHORE_FISH` twice, `FISH` once)"_.
That paragraph is **withdrawn**: those three are the _three-set_ reading's
output, not this section's. Run the three-set reading and it produces **5**
findings, which decompose exactly as that revision reported them — the two on
`verified: true` rows are `AK_Six_Points_v1.4.rms`'s `TUNA` on `WATER` and
`sample.rms`'s `GOLD` on `DESERT`, the two false warnings the fork was written to
eliminate; the three on `verified: false` rows are `AK_Six_Points`'s `SHORE_FISH`
and `FISH` on `WATER`, and `AK_Namatjira`'s `SHORE_FISH` on
`DLC_MANGROVESHALLOW`. **One run, one reading, split by the Sec.3.5 gate.** The
fold re-derived the warning half under the two-set reading and took it to 0;
nobody re-derived the other half. Under the two-set reading:

| finding                               | named terrain              | in the object's own table? | as specified                   |
| ------------------------------------- | -------------------------- | -------------------------- | ------------------------------ |
| `AK_Six_Points_v1.4.rms` `SHORE_FISH` | `WATER` (1)                | **yes** (restriction 19)   | **no finding**                 |
| `AK_Six_Points_v1.4.rms` `FISH`       | `WATER` (1)                | **yes** (restriction 19)   | **no finding**                 |
| `AK_Namatjira.rms` `SHORE_FISH`       | `DLC_MANGROVESHALLOW` (54) | **no**                     | finding, info (row unverified) |

The first two are the identical defect the fork exists to remove — `WATER` is
present in both objects' engine tables, so both are `terrainAbsent` wearing the
exact table's label, on the same map as `TUNA`/`WATER` and for the same reason.
This section's own words about the warning pair — _"checked against
`game-constants.json` directly, so the falseness is a property of the data rather
than of the run that found it"_ — apply verbatim to them.

**The general rule, because this is the third round in a row on the same shape:
when a fix changes what a run MEANS, re-derive every row that run produced, not
the row the finding named.** A number computed for one deadline was checked
against one of the two it bounds; a fix that forked tier 1 had to be carried to
tier 2 by the fold; and then the fork's own baseline table was corrected in its
warning row and inherited in its info row, one line down.

**The surviving tier-1 finding is not a gate artefact either — it is this
check's first true corpus finding, and it arrives with its own control.**
`AK_Namatjira.rms:4865`:

```
create_object SHORE_FISH
{
  terrain_to_place_on               DLC_MANGROVESHALLOW
  number_of_objects                 9999
  temp_min_distance_group_placement 6
  set_gaia_object_only
  ignore_terrain_restrictions
}
```

The command carries `ignore_terrain_restrictions` with **neither**
`set_place_for_every_player` nor `place_on_specific_land_id`, so the flag is
**inert** (BUG-007, and this section's own _"the flag's presence alone must not
suppress the check"_). `SHORE_FISH`'s restriction-19 row admits 15 terrains and
no shallow; 54 is a shallow. So the author wrote the override, did not earn it,
and the engine refuses the pairing — exactly the shape this check exists for,
arriving on an expert map. It prints at **info** only because `SHORE_FISH`
carries `verified: false`.

**`AK_ForeDaut_v1.3.rms` writes the same pairing with the prerequisite present**
(`place_on_specific_land_id 1`), so the flag is valid and the command is
correctly skipped — and the line above it places `SHORE_FISH` on `WATER` with no
flag at all, which is the permitted case. **The corpus therefore contains the
whole tier-1 fixture triple, written by two authors**, and both maps are tracked
(Sec.8 item 1).

#### The terrain surface, and its six producers

The surface is every terrain id the script can put on the ground:

**The population column is the AST's, and it has to be, because the surface is
built by an AST walk.** Rev 6 published the token-scan column beside numbers
measured through the resolver, which is the mistake Sec.2 fixed once ("do not
re-cite 56%") and Sec.3.2 fixed again with a three-column table. Both columns
are kept here so the gap is visible rather than resolved silently; **the walk
reaches the right-hand column and nothing more.**

| producer                              | where                                | comment-stripped token scan | **through the parser (AST)** |
| ------------------------------------- | ------------------------------------ | --------------------------- | ---------------------------- |
| `base_terrain`                        | `<LAND_GENERATION>`                  | 2262 / 32                   | **1908 / 31** — see below    |
| a land's own `terrain_type`           | `create_land`, `create_player_lands` | 6548 / 32                   | **6505 / 31**                |
| `create_terrain <T>`                  | `<TERRAIN_GENERATION>`               | 2198 / 32                   | **1855 / 31**                |
| **`replace_terrain`'s target**        | S5 `create_connect_*`                | 82 / 8                      | **47 / 7**                   |
| **`beach_terrain`'s target**          | `create_terrain`                     | 77 / 4                      | **10 / 3**                   |
| **the engine's automatic beach pass** | every coastline                      | —                           | every map with one           |

**The `beach_terrain` row is a 7.7× shortfall and it has one cause**: 67 of the
67 missing occurrences are inside `Rage Forest 2026.rms`'s raw node (below), and
so is the whole of every other row's gap — the map contributes to no AST column,
which is why five of the six read 31 maps against the token scan's 32.

**The `base_terrain` row is the one measured with a different instrument from
its four siblings, and the table's whole point is that a population is stated
with the instrument that produced it.** `terrain_type` 6505/31, `create_terrain`
1855/31, `replace_terrain` 47/7 and `beach_terrain` 10/3 all reproduce as counts
of `AttributeNode`s (and, for `create_terrain`, `CommandNode`s). `base_terrain`
measures **1877 as `AttributeNode`s** and **1908 over every item kind** — the
figure above is the second, and the 31-item gap is `base_terrain` occurrences the
parser does not produce as attributes. **1908 is the right number for this
column and the walk must take both kinds**, because a `base_terrain` the parser
classified some other way is still terrain the script lays down, and this
section's own rule says every omission shrinks the surface and pushes the
emptiness test toward false alarms. Stated here rather than silently corrected,
because a row that reproduces only under an unstated counting rule is
reproducible by accident.

All via `resolveTerrainId` (`grid.ts` — game constants first, script `#const`
second, per the positive-resolver-respecting rule that function already
implements). `default_terrain_replacement` is `replace_terrain`'s wildcard form
and belongs in the same clause; it has zero corpus uses and is real language.

**"Script `#const` second" names no symbol table, and which one is passed is the
whole question.** `resolveTerrainId(constants, value, symbols)` takes a **third
argument** (`grid.ts:301-312`). Sec.3.2 answers the identical question for actor
areas in three numbered rules — scan `#const` names over the whole AST including
unselected branches, union that with S0's own resolved values, abstain when
neither side resolves — and prices each one. The terrain side had none of the
three, and the two obvious readings differ materially. Measured over the walk
this table specifies (every branch, orphan blocks descended, the producers above,
`beachTerrainFor` applied over the result), 32 maps at 4 players / Normal /
seed 1: **10,325 producer occurrences**.

| reading of "script `#const` second"                                          | occurrences resolving to nothing | maps |
| ---------------------------------------------------------------------------- | -------------------------------- | ---- |
| A — `InstantiatedScript.symbols` (what an implementer holding `inst` writes) | **271**                          | 8    |
| B — A ∪ an AST-wide numeric `#const` scan (Sec.3.2 rule 1's analogue)        | **228**                          | 8    |
| C — B plus following a `#const NAME OTHER_NAME` alias                        | **183**                          | 7    |

**Two maps carry most of it, and the second lands on a rule this section already
wrote.**

- **`24hr_Battle Lines 1.0.rms`: 50 of its 67 producer occurrences resolve to
  nothing under reading A, and its surface is 5 ids where reading C gives 11.**
  The cause is the `#const` block at `:97-107`: eleven declarations of which
  **six** are `NAME OTHER_NAME` aliases — `#const TERR_PLAYER GRASS` (`:98`),
  `#const TERR_CORNER GRASS2` (`:99`), `#const TERR_FOREST FOREST` (`:104`) —
  while five are numeric and therefore survive (`TERR_BASE 83` `:97`,
  `TERR_BLACK 129` `:103`, `TERR_TEMP_2 8` `:105`, `TERR_P_POINT 7` `:106`,
  `TERR_FOREST_B 20` `:107`). `instantiate.ts` keeps only **numeric** `#const`s
  in `symbols` (`:446-449`; `resolveArg` leaves a game-constant name as a string
  because `terrainConstant` slots resolve elsewhere), so every producer written
  through one of those names is silently absent from the surface.
- **`TL Black Forest.rms`: 88 of 180 under A, 53 under B.** `#const WOODIES 48`
  sits inside `if PH_AFRICAN_E` (`:21-23`), and `PH_AFRICAN_E` is `#define`d
  inside a `start_random` branch at `percent_chance 10` (`:6`). At seed 1 the
  branch is not taken, the symbol never exists, and all **34**
  `create_terrain WOODIES` commands — the map's entire middle forest — resolve
  to nothing. **The sweep this section already ran cannot reach it.** Sec.3.3
  says _"the surface takes `start_random`'s untaken branches too, and does not
  take `if`'s"_ and defends the `if` half with a map-size sweep at 0 of 32 — but
  that sweep is about **producers**, and the hole is in the **symbol table**: a
  `#const` inside an untaken `if`, gated on a label a `start_random` defines,
  kills the resolution of producers sitting in taken branches at the top level.
  The `RawNode` abstention cannot reach it either; both maps parse perfectly and
  carry no raw node.

**Priced honestly, and the price today is zero.** Running the surface-half checks
of both tiers under all three readings: **0 findings on 32 maps, under A, B and C
alike.** The control, because a counter that only ever answers 0 proves nothing:
the same counter against an **emptied** surface returns **309 findings on 28
maps**, and against a surface of GRASS alone **23 on 8**. So the instrument fails
loudly and the zero is real. That puts this in the same register as Sec.3.2's
shared-block clause (_"adds 0 findings on this corpus"_) and the `RawNode`
abstention (_"both finding rows byte-identical"_), and it gets the same treatment
rather than a louder one. What stops it being ignorable is the margin: Battle
Lines is already carrying a 5-id surface, and a 1-id surface is worth 23 findings
across 8 maps.

**Three clauses, mirroring Sec.3.2's three rules rather than inventing
anything.**

1. **Name the symbol table.** Resolve producer names over the **union** of the
   instantiation's `symbols` and an AST-wide numeric `#const` scan, for the
   reason Sec.3.2 rule 2 gives verbatim: both sides only ever suppress findings,
   so unioning them cannot introduce a false positive.
2. **Say what an unresolvable producer does, and the answer is not "nothing".**
   183 occurrences survive every reading, and they are not aliases — they are
   names **no script defines anywhere**: `LAYER_A` ×41 plus `LAYER_B`/`LAYER_C`
   in `TL Black Forest.rms` and `TL Frontline.rms`, `PLACEHOLDER_TERRAIN_A` ×36
   and `PLACEHOLDER_TERRAIN_B` in `Pa_Site_v1.1.rms` and `24hr_Bazi is God.rms`,
   plus `CESTA`, `MELCINA` and `FE_PLEASE_FIXED_CRACKED_SAND`. No symbol-table
   choice reaches them. This section's own stated direction — _"every omission
   shrinks the surface, and a smaller surface makes an empty intersection MORE
   likely"_ — is Sec.3.2 rule 3's direction exactly, so it takes the same answer:
   **a script that loses a large fraction of its producers to unresolvable names
   abstains from the surface-half checks**, while the tier-1 named-terrain half,
   which reads no surface, keeps running. The rule has to exist, because 183
   unresolvable producers across 7 maps is not an edge case, and the surface-half
   checks are the ones whose false-positive direction this section has been
   demoting checks over since Sec.3.1.

   **The threshold is an INTERIM constant, labelled as one, and the reason it is
   written down rather than deferred is that a rule with no number is not
   implementable.** An earlier revision said _"the threshold is not a tuned
   constant to be guessed at here"_ and stopped, which left the one clause in
   this section with no value, no fixture, no reporter row and no entry in
   Sec.9 — a decision deferred into nobody's hands, in the clause whose own
   subject is a check that cannot fail loudly. The two anchors bound it three
   orders of magnitude apart: Battle Lines at **50 of 67** (75%) is what the rule
   is for, `Menindee` at **1 of 539** (0.2%) is what it must not fire on, and the
   other five maps' ratios are unmeasured because the check does not exist yet.
   **Take `unresolvable / total producers ≥ 1/3` until the reporter row below
   sets it on evidence.** It sits an order of magnitude clear of both anchors in
   both directions, so no plausible measurement moves the two cases the section
   argues from, and the direction of an error is the safe one: too high abstains
   on nothing that matters, too low abstains on scripts whose checks measure 0
   findings anyway.

   **The cost of getting it wrong is invisible, which is why it gets a reporter
   row rather than a comment.** The surface-half checks measure **0 findings
   under readings A, B and C alike**, so a threshold set too low kills them on
   many maps and changes no number this document prints. Sec.8 item 2's reporter
   prints **each map's unresolvable-producer ratio and whether it abstains**, so
   the first run over the corpus replaces the interim with a measurement; Sec.8
   item 1 carries the fixture pair; and Sec.9 carries the decision. The control
   the section already has is the stakes: an emptied surface is worth 309
   findings on 28 maps and a GRASS-only surface 23 on 8, so the abstention is
   discarding a real instrument every time it fires.

   **IMPLEMENTED, and the corpus ratio is now measured rather than bounded by
   two anchors** (`UNRESOLVABLE_PRODUCER_ABSTAIN_RATIO` in `staticChecks.ts`;
   `computeTerrainSurface` returns a `{ surface, producersTotal,
producersUnresolvable }` census and `runStaticChecks` folds the ratio into
   the single `surfaceAbstained` flag alongside rule 4's `RawNode` abstention).
   Over the 32 maps at 4 players / Normal / seed 1:

   | map                          | unresolvable / producers    |                                              |
   | ---------------------------- | --------------------------- | -------------------------------------------- |
   | `24hr_Battle Lines 1.0.rms`  | **29 / 40 = 72.5%**         | **abstains**                                 |
   | `TL Black Forest.rms`        | **48 / 89 = 53.9%**         | **abstains**                                 |
   | `TL Grand Bara.rms`          | 1 / 12 = 8.3%               |                                              |
   | `Pa_Site_v1.1.rms`           | 20 / 245 = 8.2%             |                                              |
   | `TL Frontline.rms`           | 15 / 228 = 6.6%             |                                              |
   | `24hr_Bazi is God.rms`       | 19 / 552 = 3.4%             |                                              |
   | `24hr_Mont Saint Michel.rms` | 1 / 54 = 1.9%               |                                              |
   | `Rage Forest 2026.rms`       | 0 / 0                       | abstains already, on rule 4's `RawNode` test |
   | the other 24 maps            | 0 / 8 … 0 / 2294 = **0.0%** |                                              |

   **The corpus is bimodal and the interim constant survives with room on both
   sides**: 33% sits **4.0× above** the highest non-firing map (8.3%) and
   **1.6× below** the lowest firing one (53.9%), and there is nothing at all
   between 8.3% and 53.9%. **Kept at 1/3 rather than re-tuned**, because a
   threshold placed inside a gap this wide is decided by the gap and not by the
   number, and moving it anywhere in `[0.09, 0.53]` changes no map. It stays
   labelled interim: 30 of 32 maps read exactly 0.0%, so the corpus constrains
   the LOW side barely at all, and a script with a genuine 20% would be new
   information.

   **The two anchors this clause was written from are both restated, because
   neither denominator was this one.** Battle Lines's _"50 of 67"_ comes from
   BUG-015's count of terrain-producer OCCURRENCES including the ones this walk
   never attempts to resolve; `Menindee`'s _"1 of 539"_ counted a wider
   population again, and against the resolver's own denominator that map reads
   **0 of 75**. The ratios move, the two cases do not, and the anchors are the
   argument rather than the figures — which is exactly the failure this
   document has filed twice as _an unpinned denominator is reproducible only by
   accident_. **The denominator is now stated in the same sentence as the rule:
   a producer is an occurrence this walk ACTUALLY TRIED to resolve** — an absent
   optional attribute contributes to neither side, or the ratio would measure
   how many optional attributes a script declines to write.

   **Priced, and it costs nothing:** `terrainImpossible` measures **2 findings
   corpus-wide with the abstention live** (`AK_Namatjira`'s `SHORE_FISH` on
   `DLC_MANGROVESHALLOW`, `Chaotic_Strait`'s `MAKE_WATER_TERRAIN` on
   `DLC_NEWSHALLOW`), which is the same 2 the section already pins as the tool's
   first true corpus findings, and neither is on a map that abstains.

3. **Decide the alias case out loud.** `#const TERR_CORNER GRASS2` is legal RMS
   that the engine resolves trivially and this repo's data model does not carry.
   Whether the checker follows it is a **decision**, and leaving it unstated
   means the surface silently depends on which of two functions the implementer
   reaches for. **It is a live preview-generator question before it is a checker
   one** — those 50 occurrences are terrain `terrains.ts` is not painting either,
   and it says so in a `terrainAbsent` detail reading _"This map's reference data
   doesn't know the terrain TERR_CORNER"_, which is false: the data knows
   `GRASS2`. Filed as `docs/known-issues.md` **BUG-015** (97 such failures on the
   two maps above) rather than absorbed here. Until that entry lands, the checker
   resolves at **reading B** and treats an alias as unresolvable, which is the
   direction that abstains under clause 2.

**Every omission shrinks the surface, and a smaller surface makes an empty
intersection MORE likely** — so leaving a producer out pushes this check toward
false alarms — the direction Sec.3.1 was demoted for and Sec.3.4's packing bound
was cut for, so this is the section where the same mistake would land next. The automatic beach is the sharp one, because it is the producer with no
token to grep for: `BEACH`/`ICYSHORE` exist on maps whose text never names
them, the rule is three depths deep as of 2026-08-08, and restriction 8
(`GOLD`/`STONE`/`FORAGE`, 261 corpus uses) **refuses beach** — so the omission
lands exactly on the family Sec.2's claim rests on. Close it with
`beachTerrainFor` (`grid.ts`) applied over every terrain already in the
surface, which is the same function the beach pass itself calls.

**The surface takes shared blocks, for the same reason Sec.3.2's declaration
side does.** `base_terrain`, `beach_terrain` and `replace_terrain` inside an
`OrphanBlockNode` are terrain the script really lays down — 3 `base_terrain`
and 4 `terrain_to_place_on` occurrences on this corpus (Sec.3.0b) — and the
surface only ever suppresses findings, so the walk descends. Omitting them
shrinks the surface, which this section's own next paragraph says pushes an
emptiness test toward false alarms.

#### `RawNode` is the third blind spot, and the surface abstains rather than shrinks

Sec.3.0b names three constructs Sec.3's input surfaces cannot see and gives the
third its own rule shape; this subsection is that rule with **this scan's
token** in it, and Sec.3.2 rule 4 is the same rule with its own. The construct
is not an idiom — it is the parser's own honesty surface.
`RawNode` is the "never silently drop content" degradation CLAUDE.md makes a
hard rule, and it is **opaque by construction**: `validate.ts`'s own comment
says so (_"a RawNode has no children"_), so no walk can descend into one and no
descent rule can help. A raw node inside the wrong place makes the surface
**incomplete by construction**, and this section's own rule says which direction
that moves the answer: _every omission shrinks the surface, and a smaller
surface makes an empty intersection MORE likely._ A raw node is the largest
omission available.

**Census over the 32 maps: 10 carry at least one `RawNode`, 159 in total.** One
of them is not like the others. **`Rage Forest 2026.rms` degrades 90,782 of its
128,062 characters — 70.9% of the file — into two raw nodes, one of which is
90,719 characters on its own**: a `conditional-spans-structure` degradation,
which is **legal RMS** carrying info
RMS0110 (`parser-design.md` Sec.5.3's own documented case: the file's `if`/
`elseif` biome structure spans three complete sets of section headers), not a
broken script. Measured consequences: the parsed script is **one section**
(`<PLAYER_SETUP>`, 52 items); the terrain surface computes to **0 terrain ids**;
**0 of the file's 228 `create_object` commands** reach the instantiation; and
`beach_terrain` is **67 textual occurrences against 0 AST attribute nodes**. Rage
Forest escapes the false alarms only because the same node ate its objects too. A
degradation that swallowed `<TERRAIN_GENERATION>` and left `<OBJECTS_GENERATION>`
standing would warn on **every** tier-1 and tier-2 object on the map, at warning
severity, under the exact table's label.

**The trigger is a containment test over the raw node's own TEXT, not the
section it sits in, and the difference is not cosmetic — it decides the answer
on this corpus in both directions.** The obvious rule (_abstain when a raw node
sits in a surface-feeding section_) was written, measured and **rejected**: it
abstains on 4 maps whose raw nodes provably cannot hide anything —
`Pa_Site_v1.1.rms`'s 128 are each 35 characters reading
`avoidance_distance CIRCLE_AVOIDANCE`, `TC2 - Comeer`'s three are `4056`,
`AK_ForeDaut`'s are `elseif 7_PLAYER_GAME` — **and it misses Rage Forest, the
map it was written about**, whose 90,719-character node is inside
`<PLAYER_SETUP>` rather than in any surface-feeding section.

So: **the surface abstains for a script when any `RawNode`'s own source text
contains `terrain`, `#const`, or `<`.** Each of the three is a decision
procedure rather than a judgement, and each closes one way in:

- **`terrain`** is a substring of all six producer names, so its absence from a
  span of source _proves_ no producer is hidden there. This is a lexical
  containment test used only in the abstaining direction — not a population
  count, which is what Sec.2 and Sec.3.2 forbid.
- **`#const`** can redefine what a terrain name resolves to, and an unresolvable
  name is dropped from the surface, which shrinks it.
- **`<`** catches a swallowed section header — the Rage Forest shape, where the
  hidden producers are not merely inside the node but inside whole
  `<TERRAIN_GENERATION>` sections the parse does not contain. It is the clause
  that is _about_ that case; all three happen to fire on it, and keeping the
  other two is what makes the rule hold on a file shaped differently.

**Measured, this abstains on 1 of 32 maps and it is Rage Forest.** The four maps
the section-scoped rule would have cost are kept, and the map it would have lost
is caught.

Three consequences, in Sec.3.0b's own asymmetric shape:

1. **Sec.3.3's emptiness tests abstain for that script** — Sec.3's own third
   outcome, the same rule Sec.3.2 rule 3 applies to an unresolvable declaration.
   Only the surface half needs it: the `terrain_to_place_on` half of tier 1
   reads no surface and stays live.
2. **Every check inherits a false negative on a raw node's contents, including
   the reporting scans.** Sec.3.1's sum and Sec.3.4's comparison lose whatever
   the node hides, one sentence each exactly as Sec.3.0b prescribes for the
   shared block — and so does Sec.3.3's own reporting side, which is the half
   Sec.3.0b did not have to think about: `TL Cape of Storms.rms` hides a whole
   `create_object GOLD { … }` in an 864-character node in
   `<OBJECTS_GENERATION>`. A false negative needs no abstention and no
   suppression; it needs saying.
3. **Sec.5.4's passthrough carries the covered fraction** (below). It already
   groups by text and keeps the spans, so _"these spans cover N% of the script"_
   is arithmetic over data it already holds — and it is the one thing that turns
   Rage Forest's report from silently empty into honestly empty.

**The corpus cannot pin this rule and Sec.8 must not ask it to.** `Rage
Forest 2026.rms` is not tracked — `.gitignore` whitelists a handful of names and
a clone gets 12 files — and of the two RawNode-carrying maps that _are_ tracked
(`AK_ForeDaut_v1.3.rms`, `TC2 - Comeer v1.4.rms`) both are correctly classified
harmless, so **on CI this rule never fires**. A corpus assertion here would pass
vacuously, which is the mistake the rev-8 tools-api round made when it put a
prescribed fixture in `test-maps/broken/`. Pin it with two hand-built fixtures
instead (Sec.8 item 1): a script whose raw node reads `4056` and must **not**
abstain, and one whose raw node contains a `<TERRAIN_GENERATION>` header and
must.

**The surface takes `start_random`'s untaken branches too, and does not take
`if`'s.** Same asymmetry as Sec.3.2's declaration side, for the same reason: a
larger surface only suppresses findings, so being generous is the sound
direction — and a producer inside an untaken `start_random` branch is a
terrain other seeds really do lay down, so counting it upgrades the finding
from "guaranteed on this seed" (Sec.3.0 rule 2) to guaranteed outright, which
is rule 3's own instruction. An `if` branch is different in kind, **and the
reason is a measurement rather than the argument an earlier revision gave**. The
argument was that an `if` resolves from the player count and map size, and the
check runs once per player count with the count named — which covers half the
disjunction and leaves the map-size half open, since the tool never varies map
size. `AK_Vanguard_v1.2.rms` declares two actor areas inside an `elseif
HUGE_MAP`, invisible at Normal at every player count, so the shape is live in
this corpus — and on three maps rather than one, which Sec.3.2's own baseline
found out the expensive way.

The conclusion survives on the measurement instead: computing the terrain
surface at all seven map sizes and diffing against Normal, **0 of 32 tracked
maps put down a terrain producer at any other map size that Normal does not also
produce** — while 11 of 32 move their command set with map size at all, so the
instrument is not blind. The instantiation's `if` selection is therefore the
whole terrain surface at any setting, and Sec.5.2's header carries the map size
so the finding is labelled with the settings it was taken under. **Stating a
reason that does not close, beside a conclusion that is right, is how the next
revision talks itself into widening the wrong thing.**

**Measured, the `start_random` clause is insurance rather than a live
concern**: across the
32 maps, 327 `start_random` blocks contain a terrain producer 4 times, in one
file, and that file is our own `sample.rms`. It is one clause in the walk, and
it is written down so a later reader does not mistake the near-zero for a
reason the rule is unnecessary.

#### The two overrides, and which one actually is one

**`terrain_to_place_on` does NOT override the terrain table — it narrows
alongside it.** This is the defect measured and reversed on 2026-08-08 and it
is a CLAUDE.md hard rule: `objects.ts`'s own comment carries the correction in
capitals (_"It does NOT lift the engine's terrain table"_), with the refutation
(Menindee's placeholder idiom, read from the other side: nobody buys an
unrestricted carrier object if naming the terrain already worked) and the cost
(`AK_Hourglass_v2.0.rms`'s 200000 shore fish over open sea). guide:2510's
override is `ignore_terrain_restrictions`, below.

So the two **narrow each other**, exactly as `layer_to_place_on` already does,
and **tier 1's first bullet above is the whole of what that licenses** —
`allowedTerrains ∩ {the named terrain}`, two sets, no surface. This subsection
states no test of its own; rev 6's did, in a form that disagreed with tier 1's,
and the two-against-three ambiguity was worth 2 false warnings out of a total
output of 2. It catches `create_object DEER { terrain_to_place_on WATER }` —
guaranteed-zero, and a beginner's mistake, which is this tool's whole audience.
**The question it deliberately does not answer is whether the script lays that
terrain down at all**; that is `terrainAbsent`'s, and Sec.5.1 records it beside
the `actorAreaMissing` suppression rule as the second place where the two layers
answer adjacent questions and only one of them may claim the exact table.
Reading `terrain_to_place_on` as an
override would have switched tier 1 off on **290 of the 471** covered uses
(62%, measured through the instantiation at 4 players, seed 1 — the same
population as Sec.2's last row), leaving the exact table consulted on ~181 and
cancelling most of the coverage Sec.2's argument rests on.

`objects.ts`'s live carve-out is `if (terrainId === undefined || habitatIsData)`
and it is **not** an exception to this: the habitat check is skipped only for an
UNDECLARED habitat, where `land` is a guess and narrowing by it would place
nothing and read as the object failing. `objectHabitatIsDeclared` is row
presence, and **all 31 `allowedTerrains` rows carry `habitat`** — so the
carve-out applies to exactly the rows tier 1 cannot use, and never to the rows
tier 1 is about. It belongs to tier 2, where the same rule holds: an undeclared
habitat is not checked against a named terrain, because there is no data to
check with.

**`ignore_terrain_restrictions` is the real override, and this check must model
it and its prerequisite.** 119 uses across 14 of 32 maps; **47 of the 471
covered uses carry it, and the split is 25 valid against 22 inert** — both
states are live on this corpus in comparable numbers, which is why modelling
only one swings the check to the other kind of error:

- **Valid** — the command also carries `set_place_for_every_player` or
  `place_on_specific_land_id` (guide:2509, RMS0315). The flag lifts the terrain
  table (`objects.ts`: `habitatMask(habitat, false, ignoreTerrain)`), so the
  object has no terrain restriction to violate and **Sec.3.3 reports nothing at
  all** — tier 1 and tier 2 both. Any finding against it is a false positive,
  in the check whose own opening paragraph says a check that cannot determine
  reports nothing. (`shore` is the one class the flag only relaxes rather than
  lifts, keeping its beach anchor; abstaining is still the right answer, since
  tier 1's exact table stops describing what is permitted either way.)
- **Inert** — the flag with neither prerequisite. BUG-007 measured this as a
  no-op, not a fatal: the command places its objects under their normal
  restrictions. **The flag's presence alone must not suppress the check**, or
  the check swings to false negatives on the 56 sites RMS0315 already counts.

#### Two things this check does not resolve, both for the same reason

- **`second_object` is never checked.** guide:2211's placeholder idiom puts an
  unrestricted carrier (`FISH_PLACEHOLDER`, unit 647, restriction 0) on the
  main slot and the object the author wants on the second — 295 uses across 24
  of 32 maps here. `objects.ts` deliberately never re-checks the second
  object's own habitat, because it is the only route a fish has to a shallow.
  Checking it _under the `terrain_to_place_on` fix above_ would be a guaranteed
  false positive on the idiom in its canonical form: `FISH`'s restriction 19
  admits 15 terrains and **`SHALLOW` is not one of them**, so
  `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW second_object
FISH }` — Menindee's every pond — would report empty-intersection against a
  script the engine runs correctly.
- **`create_object_group` is not checked.** Its first argument is a group name,
  not an object, and its members' habitats can differ; `objects.ts` gives the
  whole command `habitat: "any"` for exactly that reason. Resolving the group
  name through the object resolver yields no row and falls to case 3 anyway —
  stated so an implementer does not "improve" it into a per-member check that
  reports on the strictest member.

### 3.4 Static contradictions — and the count × spacing bound, cut

**What this check is, after the packing bound was cut.** One rule, promoted from the
generator rather than invented: `objects.ts` already computes
`min_distance_to_players > max_distance_to_players ⇒ minExceedsMax`
(line-anchored comment: _"no tile can ever satisfy both"_) purely from
instantiated attribute values — **already deterministic**, just currently only
surfaced once generation reaches that command. Run the same comparison at the
static layer so it is reported once, instantly, rather than rediscovered
identically on every one of N Monte Carlo runs. Severity: **error** — no tile
satisfies both bounds, so the command places nothing, and unlike everything cut
below there is no reading of the script under which the author meant it.
**Not a new rule; the same comparison, moved earlier.**

Measured over the 32 tracked maps at 4 players: **0 findings**. That is the
expected result and not a failure, for the reason `rms0304.measure.test.ts`
already records in this repo — the corpus is expert-written and this is a
beginner's contradiction. The fixtures in Sec.8 item 1 are the proof it can
fire.

#### There is a SECOND contradiction of exactly this shape, and three revisions of this section did not name it

**`cliffs.ts:289-298` computes `min_number_of_cliffs > max_number_of_cliffs`
from instantiated attribute values and every word of the justification above
applies verbatim.** `resolveCliffSettings` (`:113-130`) resolves both attributes
with `lastByName`, compares them, and on a contradiction pushes a
`cliffsMinExceedsMax` note and returns a zero report. It is promoted from the
generator rather than invented, it is already deterministic, and it is currently
only surfaced once generation reaches `<CLIFF_GENERATION>`. **Its consequence is
strictly worse than `minExceedsMax`'s**: the generator's own note says the pair
_"crashes the real game when the map is generated"_, where an object command
that satisfies no tile merely places nothing. Severity **error**, on the same
sentence Sec.3.4 already gives — there is no reading of the script under which
the author meant it.

**The input surface is live and its shape is the reason the scoping needs
saying.** **8 of 32 maps write the pair** — `13_Rings`, `AD4 - Ra`,
`AK_Hourglass`, `AK_Six_Points`, `AK_Vanguard`, `Chaotic_Strait`,
`OWWC1Tewaipounamu`, `QS_Three_Bays` — and **seven of them write it three times
inside a map-size `if`**. All 8 write `min < max` on every branch, so the corpus
measures **0 findings**, the same register as `connections.ts:784`: zero today,
one edit from live. But the tool runs one map size and Sec.3.3's own producer
sweep measured the map-size axis at 0 of 32, so **a contradictory Tiny branch is
invisible to a Normal-only check**. State the scope rather than let a reader
infer coverage the run does not have: this check sees the branches the
instantiation at the run's own map size took, and nothing else.

**The defaulted-max case is decided here rather than left to the implementer,
because the two candidate answers differ and Sec.3.4(b) reads the wrong way on
it.** `DEFAULT_MIN_CLIFFS` is 3 and `DEFAULT_MAX_CLIFFS` is 8 (`cliffs.ts:51-52`),
and `resolveCliffSettings` uses `lastByName`, so a script writing only
`min_number_of_cliffs 9` trips the comparison against a maximum its author never
wrote. Sec.3.4(b)'s cut criterion — _"a constraint the author never wrote"_ —
would say abstain. **It does not apply, and the difference is where the
constraint comes from.** The packing bound was cut because the _checker_ was
inventing the constraint; here the default is the **engine's**, the generator
already resolves and reports against it, and the real game really does crash on
the resolved pair. A script that writes `min_number_of_cliffs 9` and nothing else
is a script that crashes. **So: report it, at error, and word the finding so the
defaulted side is visible** (_"against the default maximum of 8, which this
script does not set"_), because a user who never wrote a maximum needs to be told
which number the comparison used.

**The 0 has a second mechanism behind it besides "expert-written", and it is
worth naming so the number is not read as stronger than it is.** This check
reads `InstantiatedScript`, so the **21 `min_distance_to_players` and 7
`max_distance_to_players` occurrences sitting inside shared blocks**
(Sec.3.0b, 5 of 32 maps) are unreadable to it: they can never trip
`minExceedsMax` however contradictory they are. **The same goes for anything
inside a `RawNode`** (Sec.3.3's subsection) — `TL Cape of Storms.rms` hides an
entire `create_object GOLD { … }` in one, and on `Rage Forest 2026.rms` all 228
`create_object` commands are inside one. A false negative, in the tolerable
direction, and the only surviving static check in this section is the one it
lands on.

#### The packing bound is CUT, and this is the section's own record of why

An earlier revision specified a second check here: for a command with a resolved
count and a resolved minimum spacing, bound the area N placements need as
`N · π · (spacing/2)²` and report **error** — "N objects at minimum spacing S
cannot geometrically fit on a `dim`×`dim` map" — when that exceeds `dim * dim`.
It was never run over the corpus before being specified. Run now, it is
unshippable, and the three defects are worth keeping because each is a different
way to get this wrong.

**(a) It read an attribute whose behaviour is not what its name suggests.**
`group_placement_radius` is a cohesion **maximum**, not a minimum separation:
`objects.ts` scans within `group_placement_radius` of a group's anchor
(Chebyshev) to pull members _together_. Nothing keeps two groups apart — only
`min_distance_group_placement` does that, and it is a separate attribute. So N
groups do not require N disjoint discs and the packing bound is not a bound on
anything. Same class as `max_distance_to_other_zones` being a minimum: an
attribute read from its name rather than from the line that consumes it.

**(b) It would have reported a constraint the author never wrote.**
`DEFAULT_GROUP_PLACEMENT_RADIUS = 3` is the generator's fallback for a
grouped-but-bare command, and "resolve the spacing" picks the default up. Of the
195 findings the radius clause produces at 4 players, **190 rest on the
defaulted 3** and 5 on a number an author typed. The check invents a
constraint, then reports its violation as a geometric certainty.

**(c) It read the minority attribute, and fixing that makes the count worse
rather than better.** `objects.ts` resolves
`temp_min_distance_group_placement` **first**, falling back to
`min_distance_group_placement`; the `temp_` spelling is the dominant one on this
corpus (**789 instantiated commands carry it against 398 for the plain form,
229 carrying both**) and the section never named it. The section's own headline
example is caught by neither path it describes: `AK_Namatjira.rms`'s
`number_of_groups 999999` command carries `temp_min_distance_group_placement 3`.

| spacing driver, at 4 players                                       | findings | maps   |
| ------------------------------------------------------------------ | -------- | ------ |
| `min_distance_group_placement` alone — as the section specified it | 11       | 9      |
| `group_placement_radius`, author-written                           | 5        | 4      |
| `group_placement_radius`, defaulted to 3 by the checker            | **190**  | 12     |
| **resolved the way `objects.ts` resolves it (`temp_` first)**      | **207**  | **26** |

**The last row is the fix making it worse, and that is the finding.** Deleting
the radius clause and correcting the resolution order — the two obvious repairs
— take an error-severity "guaranteed impossible" finding from 11 sites to **207
sites across 26 of 32 maps**, because the corrected check finally reads the
attribute the corpus actually writes.

**(d) The reason no repair works: over-declaration is an RMS idiom, not a
defect.** The declared N on the 207 tripping commands runs min 16, median
**9999**, max 999999. `number_of_objects 65536` means _fill the water with
fish_, exactly as `land_percent 100` means _take the remainder_ (Sec.3.1) and
`number_of_clumps 9320` — the guide's own worked example — means _convert all of
this terrain_. The engine places what fits and stops. So the finding is a true
statement about a working script, on 81% of the corpus, at error severity: the
same failure Sec.3.1 was demoted for, one section over and one severity worse.

**(e) And what the bound wanted to say, the Monte Carlo layer already says
better.** "You asked for 65536 and the map holds ~800" is a spawn rate, measured
rather than derived, on real terrain rather than an empty square, and it needs
no impossibility claim to be useful. A static packing bound is a weaker
duplicate of Sec.4's own output.

**One correction recorded so nobody "fixes" the cut bound in the unsound
direction if it is ever revived.** `createSpacingIndex` uses **Chebyshev**
distance, so the generator's exclusion region is a square of side `s` (area
`s²`), not a disc of area `π(s/2)² ≈ 0.785 s²`. The disc form is therefore
conservative against the generator and leaves ~27% of its reach unused —
tightening it to `s²` would make a check that already fires on 26 of 32 maps
fire more.

**One refinement of the cut bound goes with it and is recorded here rather than lost.** The
bound was to floor `group_variance v` at `max(1, n − v)` per group
(`variedGroupTarget`, `objects.ts`; 71 uses across 14 of 32 maps), exactly as an
`rnd`-sourced operand is read at its lower bound, because over-counting N makes
an impossibility claim trip more easily. The reasoning is correct and survives as
Sec.3.0 rule 3; it just has nothing left to apply to.

**What would have to exist before this returns.** A discriminator between "the
author asked for more than fits" and "the author made a mistake". None is known:
the count alone does not separate them (the tripping distribution runs from 16
to 999999 continuously, with 14 commands under N=200), and the repo's standing
rule is that a heuristic invented to rescue a check is the check's third
defect. If one is ever found, this returns as **info** beside the measured spawn
rate, never as an error on its own.

### 3.5 Data-readiness gate on every static finding

Per Sec.0's inherited warning: before emitting **any** Sec.3.3 finding, check
`PublishedGameConstant.verified` on the resolved row. An unverified row's
`allowedTerrains`/`habitat`/`resourceAmounts` are placeholders, not facts
(`gameConstants.ts`'s own doc comment: _"Treat unverified numeric fields...
as placeholders, not facts"_). `verified: false` downgrades a Sec.3.3 finding
to info with a "this object's terrain data has not been checked against the
game's files" clause, mirroring RMS0201/0202's own `verified`-gated
warning/info split (`parser-design.md` Sec.6 rule 2) rather than inventing a
second convention for the same idea.

**The gate is cheaper than the inherited warning implies, and it is not
vacuous**: 2891 of 3011 rows are `verified: true` and 120 are not, so this is a
rare downgrade rather than a blanket one — but **116 of the 120 are terrain
rows and the other 4 are objects, of which two are `FISH` and `SHORE_FISH`,
both tier-1 rows carrying `allowedTerrains`.** So the gate fires on 2 of the 31
rows tier 1 can use, and on the family the corpus places 30 times directly plus
every placeholder-carried fish behind it. It is worth one fixture rather than a
sentence, and **the row it actually fires on is now named**: the corpus's one
tier-1 finding is `AK_Namatjira.rms`'s `SHORE_FISH` on `DLC_MANGROVESHALLOW`
(Sec.3.3), which prints at info for exactly this reason and would print at
warning the day `SHORE_FISH` is re-extracted. Sec.8 item 1's tier-1 fixture pair
uses that row.

**The gate covers EVERY row the comparison reads, and reading it as "the
object's row" is what makes the 116 look irrelevant.** A Sec.3.3 finding is
always a claim about a _pairing_, and tier 2's is
`habitat(object) × isWater(terrain)` — so the terrain row is an input to the
finding exactly as the object row is, and its `verified` flag governs it exactly
as much. The paragraph above got as far as counting the 116 and then set them
aside, which is the mistake in miniature.

Two consequences, and the first is a real change to what the tool prints:

- **Tier 2 findings are INFO in practice today**, because `isWater` was
  transcribed from the community DE terrain table on 2026-08-07 and 116 of 131
  terrain rows carry `verified: false` for that reason. They lift to warning per
  row on the day `tools/extract-constants` re-derives the flag from an install.
  That is the honest severity for the coarse tier and it costs little — tier 1,
  the precise tier, reads `allowedTerrains` as a list of **ids** and compares
  against ids, so it reads no `verified`-gated terrain field and keeps its
  warning.
- **The corpus's one tier-2 finding is an info row, which is the severity it
  deserves, because nothing here can decide it.** `Chaotic_Straitv0.99.rms`
  writes `create_object MAKE_WATER_TERRAIN { … terrain_to_place_on
TEMP_POND_TERRAIN }`, where `MAKE_WATER_TERRAIN` is `#const … 1641`
  (restriction 4, `habitat: "land"`, `verified: true`) and `TEMP_POND_TERRAIN`
  is `#const … 59` = `DLC_NEWSHALLOW` (`isWater: true`, **`verified: false`**).
  A land-restricted building on a shallow is either a real defect the engine
  passed silently — the shape CLAUDE.md's _"a shipped map is not a
  specification"_ rule names — or a terrain flag we transcribed rather than
  measured. **Sec.9 carries it as the one thing the tier-2 fork owes**, with the
  run that would settle it.

## 4. Monte Carlo layer

### 4.1 The loop

For each player count in the manifest's selected set (Sec.6), for each of
`runsPerPlayerCount` iterations: build `PreviewOptions { seed, collectSnapshots:
false }` (Sec.0 — already the documented cost knob, not re-decided here) and
call `runPreviewFromContext(ctx, refDb, opts, { playerCount })`. Fold the
returned `PreviewResult.reports` into the running aggregate (Sec.4.2) and
`emit({ type: "progress", ... })`.

**That fourth argument does not exist yet, and without it this loop cannot run
its own matrix.** `previewSettingsFromContext` reads `playerCount` from
`ctx.settings` — one value, the pane's current setting — so every "player count"
in the loop above would generate the same map. Sec.7.2 adds a narrow
`overrides?: { playerCount?: number }` applied **after** the bridge narrows, so
the seam guard that module exists to be (it stops compiling the day
`PreviewSettings` grows a required field) still covers the call.

**The override belongs on `previewSettingsFromContext`, with
`runPreviewFromContext` passing it through — not on `runPreviewFromContext`
alone, which is where rev 6 put it and which leaves the STATIC layer with no
sanctioned path.** Sec.3.0 rule 1 says _"run the static layer once per selected
player count"_, and that needs `instantiateScript(parse, langIndex, settings,
seed)` — a `PreviewSettings` per count, which is what
`previewSettingsFromContext` returns and `runPreviewFromContext` swallows inside
a `PreviewResult`. With the override on the wrapper only, the implementing
session either spreads `{ ...bridged.settings, playerCount: n }` at the call
site — the parallel construction that module's header says it exists to prevent
— or runs the static layer once at `ctx.settings.playerCount` and labels four
columns with it, which turns "each finding carries the player count it was found
at" into three lies.

**Measured, the cost of getting this wrong today is zero, and saying so is what
stops a later reader deleting the rule.** Running Sec.3.2 as prescribed
independently at 2/4/6/8, the findings, the info rows and the abstention are
**identical at all four counts** (`Menindee` 1000; `Pa_Site` 81/82/91;
`AK_Vanguard` abstaining), and Sec.3.1's six maps are identical at all four (24
of 128 pairs is exactly 6 × 4). The only movement is in the reference
_population_ — 10 references present at 4p and absent at 2p, 1 the other way —
and none of it changes a finding. So this is insurance, in the same register
Sec.3.2 uses for its own shared-block reference clause ("adds 0 findings on this
corpus"), and it gets the same treatment: put the override where both layers can
reach it, and record that the measured rate is zero so the zero is not mistaken
for a reason to drop the rule.

**`teams` needs no equivalent, and that is a property of the type rather than
luck.** `PreviewSettings.teams` is always length 8, indexed `player - 1`,
**independent of `playerCount`** — the settings pane retains assignments for
players currently counted out, and every consumer slices to `playerCount` first
(`teamModel.ts` is that rule). So one context's `teams` array is already the
right input at 2, 4, 6 and 8, and a checker that "helpfully" re-derived a teams
array per player count would be inventing a lobby the user never configured.

**`refDb` is `PreviewReferenceData`, and it is not `ctx.referenceData`.**
`runPreviewFromContext` takes `{ language: LanguageIndex; constants: readonly
ObjectConstant[] }`, while `ToolReferenceData.language` is `LanguageData` —
plain data, deliberately not an index, with its own doc comment naming the
remedy ("built-ins import `buildLanguageIndex`"). Build the index **once, before
the loop, never per generation**: the loop body is otherwise a plausible home
for it and the cost would hide inside a per-generation number nobody would
question.

**That instruction covers BOTH conversions, and the second one is easier to
miss because it does not look like an index.** Sec.7.2 item 2's
`PublishedGameConstants → readonly ObjectConstant[]` conversion is a `.map()`
producing a **new array every call**, and `objectEntry`'s index is a `WeakMap`
keyed on **array identity** (Sec.7.0 item 1) — so calling the conversion inside
the loop silently rebuilds that index per generation, and the rebuild is
invisible because the `WeakMap` is doing exactly what it was designed to do.
**The numbers, since this paragraph's subject is a cost: the `.map()` allocates
3011 fresh objects, and `objectIndex` then scans all 3011 to index the 2672 whose
`category` is `"object"` (`objects.ts:284`)** — a scan of 3011 producing an index
of 2672, which is two different nouns and the reason the figure is written with
both. The cost is two passes rather than the 465-million-comparison scan
`objects.ts`'s own comment records, so this is small; it is written down because this is the
file whose header is about precisely this mistake. **Both conversions happen
once, before the loop.**

**`constants` does NOT come straight from `ctx.referenceData.gameConstants`,
and this line is where a session under time pressure writes the cast this
repo has a module dedicated to refusing.** `ToolReferenceData.gameConstants`
is `PublishedGameConstants`, generated from the schema, whose element declares
`constId?: number | null`; `PreviewReferenceData.constants` is
`readonly ObjectConstant[]`, whose element declares `constId: number | null`,
**required**. An optional property does not assign to a required one of
otherwise identical type, because optionality widens the domain by `undefined`
— compiled against this repo's own `tsconfig.json`, the assignment is a
`TS2322` naming exactly that chain, and `constId` is the only incompatible
member. Nothing in `src/` consumes `ToolReferenceData.gameConstants` today
(`preview/worker.ts` casts the raw JSON import and never names the published
type), so **this tool is the first to cross the seam** and the spec has to say
which side gives way.

**It is the adapter, and the alternative was measured rather than argued.**
Widening `ObjectConstant.constId` to optional is inert at _runtime_ —
`objectIndex` already guards `c.constId !== null && c.constId !== undefined` —
and it is not inert to the toolchain: `ObjectConstant` is passed where
`TerrainConstantForMasks` (required `constId: number | null`) is expected, and
its readers narrow with `!== null`, so the widening produces **about 30 fresh
errors across `grid.ts`, `palette.ts` and four test files**, measured by making
the edit and running `tsc`. So: **Sec.7.2 item 2 adds one named conversion
beside `previewSettingsFromContext`**, in the module whose entire stated
purpose is this class of seam, defaulting an absent `constId` to `null`. What
must **not** happen is an inline `as unknown as readonly ObjectConstant[]` at
the call site — that is precisely the cast `previewBridge.ts` exists to refuse.

The static layer needs no adapter at all: Sec.3.3 reads
`PublishedGameConstant` rows directly through the generic `objectEntry`
(Sec.7.0), which is why this is one call site rather than two.

**A `PreviewBridgeFailure` is an ERROR, never a `continue`, and this is the one
place the loop can produce a confident empty report.** The three reasons
(`no-settings`, `bad-map-size`, `bad-teams`) are all properties of `ctx` and all
deterministic, so a `continue` skips **every** player count and the tool then
emits a report whose header reads _"Total generations 60"_ over empty tables,
with no error, no note and no static finding. That is the _"clean report on a
script the tool read none of"_ failure Sec.5.4's covered-fraction clause was
written against, arriving through the settings door instead of the `RawNode`
one, and it is worse than that failure because the covered fraction at least
prints something. **Emit `error` / `host-error` on the first non-`ok` bridge**,
which is the treatment the missing-`referenceData` guard at the top of the run
already gets, and do not increment the completed-generation counter on a
generation that produced no data. The counter is the second half of the same
defect: incremented unconditionally, it reports work that did not happen.

**Chunk unit is one generation, per `tools-api-design.md` Sec.4.1 — restated
here as a constraint on this loop's shape, not re-derived.**
`generatePreview` is synchronous and cannot yield inside itself, so between
every single call the loop must `await` a macrotask boundary (e.g. `await new
Promise(r => setTimeout(r, 0))`) before the next one, so a pending `cancel`
message can be serviced. Batching several generations per yield would silently
turn the tool's own choice of batch size into the deadline being measured —
exactly the mistake that section warns against.

**Seeding.** The pane's view-state seed is not available here (Sec.1). Each
generation uses `baseSeed + runIndex` for a user-supplied (or default)
`baseSeed` integer param (Sec.6) — plain, not derived through the generator's
own `mulberry32` substream keying, because that keying is for **within** one
generation's stages, not for decorrelating **across** independent top-level
runs. **Flagged as unmeasured**, in this project's own terms: nothing here
establishes that consecutive integer seeds produce independent generations
rather than correlated ones. If a future measurement finds correlation, the fix
is confined to this one line (a stronger derivation, e.g. hashing `baseSeed`
with `runIndex`) and touches nothing else in this design.

**`runIndex` RESETS at each player count, and the sentence above admits the
other reading.** _"Each generation uses `baseSeed + runIndex`"_ is equally
satisfied by a counter monotonic across the whole matrix, and the two produce
different runs. Two things in this document already assume the reset and neither
says so: Sec.3.0 rule 1 pins the static layer to _"the same `baseSeed` the Monte
Carlo layer starts from"_ **at every count**, which is only true if every count's
batch starts at `runIndex 0`; and Sec.4.2's drift census is measured seeds 1–5 at
one count, i.e. the seed set the reset reading gives every count. **The reset is
also the better instrument, which is the reason to pin it rather than the
accident that made it necessary**: it makes 2/4/6/8 a paired comparison over one
seed set, so a rate that moves across counts moves because of the player count
and not because count 8 happened to draw seeds 45–59. Monotonic seeding would
confound the two axes the report's own Worst player count column ranks.

### 4.2 Aggregation key

**`commandSpan`.** Within one player-count's batch of runs, the AST is
constant (only the RNG changes across runs at fixed `playerCount`/`mapSize`),
so a `create_object`/`create_land`/`create_connect_*` command's `Span` is
stable across every run in that batch and is already how every stage's own
`CommandReport` identifies itself. Group `CommandReport`s by `(commandSpan,
playerCount)`, summing `attempted`/`placed` and merging `failures` by bucket
(same coalescing shape `pushFailure` already uses within one run — see
`types.ts`'s own note on why per-instance detail is discarded past the first
occurrence: it is exactly the reason a quarter-million misses stays
affordable, and it applies again here across N runs for the same reason).

**Across player counts**, do **not** merge into one number — PLAN.md's report
shape is explicitly "worst player count" per entity, which requires keeping
the per-`playerCount` spawn rate distinct until the final report step picks
the minimum (Sec.5.1).

#### The aggregate record carries a THIRD field, and without it the report cannot tell "attempted nothing" from "was not in the script here"

**`{ attempted, placed, failures }` per `(commandSpan, playerCount)` cannot
represent a command that is not generated at that player count at all.**
"Summing `attempted`/`placed`" over an empty set of reports and summing over
reports that total zero both produce `{ attempted: 0 }`, and Sec.5.1's rules —
every quantifier of which ranges over _the selected matrix_ — then rank a
count the command never reached as though the command had reached it and
failed. So the record is:

```ts
{ runs: number;            // generations in this batch (Sec.4.4's runsPerPlayerCount)
  runsContaining: number;  // of those, how many contained this commandSpan at all
  attempted: number; placed: number; failures: Failure[] }
```

`runsContaining === 0` is **absent**; `runsContaining === runs` is **fully
present**; between them is **partially present**, which is a real state and not
an edge case. Sec.5.1 branches on all three.

**`runs` lives on the BATCH, not on the cell, and the implementation's factoring
is the prescribed one.** The five fields above read as one record because they
are consumed together, but `runs` is a property of the player count's batch —
identical for every cell at that count — and storing a copy per cell lets the
two disagree. The shipped shape is `AggregateCell { runsContaining, attempted,
placed, failures }` with `runs` reachable as `MonteCarloAggregate.runsAt(pc)`,
and the join is one lookup at the single place Sec.5.1's denominator rule needs
it. Recorded here so a later reader does not "correct" the code back toward the
literal five-field block above. The one thing this factoring buys is the one
thing to watch: the consumer has to make the join, and the first implementation
built `runsAt()` and never called it.

**Both populations are measured, and neither is small.**

_Absent at a count._ Keyed `(map, stage, commandSpan)` over the 32 maps at
2/4/6/8, Normal, seed 1 — **8358 distinct rows, of which 352 exist at some
player counts and not at others**, presence patterns `--P-` 86, `P---` 85,
`---P` 71, `PP-P` 34, `-PPP` 29, `-P--` 26, `--PP` 21. **All 352 are rated at
every count where the report exists and not one carries an `attempted: 0` cell
anywhere** — they are healthy commands sitting inside a `if N_PLAYER_GAME`
branch — so **all 352 sit inside Sec.5.1's 7891 never-zero rows** and none of
them is in the 402 or the 65 that section counts, which is precisely why a
census taken over `attempted` alone cannot see them. **146 of them are on
tracked maps** (`Menindee_AUS_v2.3` 86,
`AK_Namatjira` 54, `AK_Hourglass` 4, `AK_Six_Points` 2), so this is
CI-visible; the rest are `TL Cape of Storms` 78, `OWWC1Tewaipounamu` 68,
`TL Black Forest` 20, `TL Frontline` 20, `24hr_Blind Valley` 12, `W4` 7,
`24hr_Battle Lines` 1.

_Partially present within one count's batch._ At **4 players over seeds 1–5**,
**207 of 8231 rows appear in some runs and not others** on **11 of 32 maps** —
`13_Rings` 62, `AK_Vanguard` 60, `Pa_Site` 25, `TL Cape of Storms` 22,
`AK_Namatjira` 16, `TL Frontline` 8, `24hr_Arrakeen` 5, `24hr_Holler` 3,
`OWWC1` 2, `QS_Three_Bays` 2, **`sample.rms` 2** — distributed 142 rows present
in exactly 1 of the 5 runs, 23 in 2, 6 in 3, 36 in 4. This is Sec.3.0's
`start_random` drift (12 of 32 maps over seeds 1–5) arriving on this axis, and
**the default is 15 runs per count, so the batch is where it lives**: at seed 1
alone, presence at a count is a boolean and the state is invisible.

**Both of those censuses are quoted over the matrix and measured at ONE point of
it, and the populations move when the batch is swept.** The absent census is
2/4/6/8 at seed 1; the partial census is seeds 1–5 at 4 players; the tool's own
default runs 4 counts × 15 runs, and no census above crosses the two axes.
Swept 2/4/6/8 × seeds 1–5 (a third of the default):

| census                                           | quoted (one axis)          | swept 2/4/6/8 × seeds 1–5                |
| ------------------------------------------------ | -------------------------- | ---------------------------------------- |
| distinct rows, keyed `(map, stage, commandSpan)` | 8358                       | **8511**                                 |
| absent at ≥1 count                               | 352 (146 tracked)          | **373 (149 tracked)**                    |
| partially present at ≥1 count                    | 207, **at 4 players only** | **240 (145 tracked)**, across the matrix |

**153 rows exist somewhere in the batch that seed 1 never generates**, which is
the same `start_random` drift arriving on the row set itself rather than on a
cell. Every figure this document pins against these populations is therefore a
**lower bound at the default settings**, and Sec.8 item 2 states them that way.

**The one hypothesis this sweep was run to test came back negative, and the
negative is the more useful half.** The expectation was that the 352
absent-at-a-count rows were a seed-1 artefact the 15-run batch would dissolve
into partially-present rows, which would have collapsed the absent state into
the partial one and cost this subsection its third field. Measured: **0 rows,
not one, is present at a count where seed 1 found it absent.** The mechanism is
`if N_PLAYER_GAME`, which is a function of the player count and no seed moves
it. **The absent state and the membership of its 352 stand**; what grows is the
population around them.

**The two axes are one missing field and the test plan already knew about the
second.** Sec.8 item 3 commissions exactly this case — _"a `commandSpan`
present in only one of two runs … assert the merge neither crashes nor invents
a zero row for a run that never contained the command"_ — which is
`runsContaining` stated as an assertion three sections before the record that
would carry it. A merge that satisfies item 3 by _skipping_ absent runs and
then reports the sum as though it covered `runs` runs has moved the same
conflation one level up rather than fixing it.

**The conflation is what an implementer writes by default, so the spec has to
forbid it by name.** Folding the matrix with `row.get(pc)?.attempted ?? 0` —
the obvious line — turns the 352 absent-at-a-count rows into zero-attempt rows
and reports **417** "zero at some counts" against **7539** never-zero, where
the true split is **65 / 7891**: the population Sec.5.1's ordering rule governs,
overstated **6.4×** by one `?? 0`. That measurement is not hypothetical; it is
what the rev-12 round's first probe returned, written by a reader with the
subsection in front of him.

**`PreviewResult.failureMarks` is ignored entirely, and the reason is that
folding it would corrupt the tally rather than enrich it.** The one kind that
exists is `landAtMapCenter`, and it is _derived_ — `index.ts`'s
`collectLandOutcomes` emits one for every origin with `fromOriginFallback` set,
which is the same flag `lands.ts` sets on the paths that have **already pushed a
failure record** for that event. So every mark's event is in
`CommandReport.failures` before this tool looks at it, and folding the marks in
double-counts a population `types.ts` measures at "6 times, on 2 maps".

**That population re-measures at zero, which changes nothing here and matters
for Sec.8.** Across all 51 maps on this mount at 4 players, Normal, seeds 1 and
2, no map produces a mark at all (Sec.8 item 6 has the run and its control).
The argument above is unaffected — it is about what folding _would_ do, and it
would still do it — but the decision must not be re-justified by the size of a
population that is currently empty. It rests on the double-count and the
fabrication being wrong in kind.

Worse on one of the two paths, and worth the sentence because it is not what a
reviewer would predict: the `grouped_by_team` extras case sets the same flag but
pushes its failure under **`notSimulated`**, not `originFallbackCenter` (it
models guide:857's own engine bug). Folding the mark under "an equivalent
bucket" there would not double an existing count — it would **fabricate an
`originFallbackCenter` count that no failure record carries**.

The marks exist to carry a **tile**, which is the one thing coalescing destroys
and the one thing this tool has no canvas for. That makes them the pane's
surface, not this tool's.

### 4.3 Runtime: a worker, and why the pane cannot use it unmodified today

`tools-api-design.md` Sec.3 pins that "Built-in tools that do heavy CPU work
(the checker's Monte Carlo) run inside a **tool worker** (not the parser
worker — a stuck tool must not stall diagnostics)". **This infrastructure does
not exist yet** — `src/tools/host.ts`'s only `ToolRunner` is `inProcessRunner`, and
`ToolsPane.tsx` constructs its one `ToolHost` with that runner fixed at
`useMemo` time (`new ToolHost(inProcessRunner)`, dependency array `[tools]`,
which never changes). This section specifies the missing piece.

**A `ToolImplementation`'s `run` closure cannot be `postMessage`d** — functions
are not structured-cloneable, so a worker-based runner cannot forward the
`tool: ToolImplementation` argument `ToolRunner.start` receives. The worker
script instead holds its **own** static import of the checker implementation
(a second module instantiation in a separate JS realm, safe because
`ToolImplementation`s in this codebase are stateless singletons — `scriptStats`
already is one) and dispatches on `tool.manifest.id`, which **is** a plain
string and crosses the boundary fine.

```
src/tools/checkerWorker.ts   // self.onmessage: HostMessage<ParseResult> & { toolId }
                              // {type:"run",toolId,context} | {type:"cancel"}
                              // dispatches to a small { [id]: ToolImplementation }
                              // table (today: just consistencyChecker), calls
                              // .run(context, msg => self.postMessage(msg))
src/tools/workerRunner.ts    // ToolRunner factory: start() constructs one Worker
                              // (one per run, matching host.ts's own "no
                              // recovery logic" reasoning for the in-process
                              // case), postMessages {type:"run",...}; cancel()
                              // posts {type:"cancel"}; kill() calls
                              // worker.terminate() — satisfies RunnerHandle as
                              // host.ts already defines it, no change to that
                              // file
```

**The message name is `run`, not `start`, and that is the published
contract's** — `HostMessage` is `{ type: "run"; context }` (`tools-api/index.ts`).
An earlier revision's sketch invented a third name for a message that already
has one. Nothing breaks either way, since the sketch is internal to the worker;
one vocabulary is still worth having when the whole doc's argument is "one
contract, two transports". `toolId` rides alongside as the one field the
in-process transport does not need, because the closure it replaces cannot be
cloned.

**Reusing the published name is right and reusing it UNPARAMETERISED does not
compile, which rev 6 wrote and did not check.** `HostMessage`'s context is
`ToolContext`, and that parameter **defaults to the wire form** — the whole
point of the type, per its own doc comment. `ToolImplementation.run` takes
`ToolContext<ParseResult>`, the in-process form, and is not generic.
Assignability runs one way only (`ToolContext<ParseResult>` → `ToolContext`),
which is what makes the host side and the runner side fine and the **worker's
inbound typing** the one place it breaks. Typed exactly as rev 6 sketched it and
compiled against this repo's own `tsconfig.json`:

```
error TS2345: Argument of type 'ToolContext<SerializedParseResult>' is not
assignable to parameter of type 'ToolContext<ParseResult<number, DefSlots>>'.
  Type 'SerializedParseResult' is not assignable to type 'ParseResult<number, DefSlots>'.
    Type 'WireNumber' is not assignable to type 'number'.
      Type 'InfSentinel' is not assignable to type 'number'.
```

**The runtime was never in doubt and that is exactly why nothing caught it**:
the host posts the live in-process context and structured clone preserves
`Infinity` and `def`, so the object the worker receives really is
`ParseResult`-shaped. Only the declared type is wrong, which is the half a spec
is responsible for — and `HostMessage` has **zero consumers in the tree** (`grep
-rn "HostMessage" src/ tools-api/` returns the declaration and nothing else), so
this worker would be its first instantiation ever and no compiler elsewhere was
ever going to object. It breaks at the exact seam `tools-api-design.md` rev 6
reversed a pin over (_"Re-scope it to both transports and this line stops
compiling"_).

**Fix, verified.** Give `HostMessage` the parameter its payload already has:

```ts
export type HostMessage<
  P extends SerializedParseResult = SerializedParseResult,
> = { type: "run"; context: ToolContext<P> } | { type: "cancel" };
```

The worker then types itself `HostMessage<ParseResult> & { toolId?: string }`
and calls `tool.run(msg.context, …)` with no cast. Made against this tree, with
the sketch above written out as a real file: `tsc --noEmit` goes from the
TS2345 to **EXIT 0**, and the default keeps every external reading unchanged.
This is a published-contract addition, so it lands in **Sec.7.2 item 4** beside
`ownsSettingsHeader`, with the same doc-comment obligation.

**Do not close it with a cast.** `context as ToolContext<ParseResult>` compiles,
and it is precisely the move `previewBridge.ts` exists to refuse — which this
document already says twice, once about the constants conversion (Sec.4.1) and
once about the resolver (Sec.3.3).

**`protocol.ts` needs zero changes** — message validation already runs on
whatever `onMessage` receives regardless of transport — and `ToolRunner` is
already the right shape (`start(tool, contextJson, onMessage): RunnerHandle`).
**`registry.ts`** gains a small `WORKER_RUNTIME_TOOL_IDS: ReadonlySet<string>`
(or equivalent) so the runner for a tool can be looked up by id.

**The lookup happens inside ONE `ToolHost`, not by building a host per tool,
and the invariant is why.** The obvious wiring is to add `selectedId` to
`ToolsPane.tsx`'s `host` `useMemo` dependency array so each tool gets a host
constructed with its own runner. That silently breaks the contract's own
words: `start()` throws on `isBusy()` to enforce _"one run at a time,
app-wide"_, and `isBusy()` is per-instance. A cancelled-but-not-yet-terminated
run on H1 and a fresh run on H2 are two live workers, 60 generations each,
with neither host able to see the other — and the 30 s cancel grace makes that
window ordinary rather than exotic. Keep one host and give it the policy
instead: **`ToolHost`'s constructor takes a runner RESOLVER**
(`(toolId: string) => ToolRunner`, defaulting to `() => inProcessRunner`) and
picks per `start()`. Passing the runner as a fourth `start()` argument works
equally well and puts the choice at the call site; either keeps the host, the
invariant and the `useMemo` deps exactly as they are today.

**`host.ts` needs one fix first, and it is this tool that makes it live.**
`ToolHost.reset()` sets `state = IDLE` and notifies listeners. It does **not**
clear `this.active` and does **not** clear the timers — `documentReplaced()`
gets this right by calling `terminate()` first, which does both, while
`ToolsPane.selectTool` calls `host.cancel()` then `host.reset()`, and `cancel()`
only arms a 30 s grace. After that pair: two timers still armed, `isBusy()`
false, so a second `start()` is accepted and overwrites `this.active`. When the
**first** run's grace expires, `terminate()` reads `this.active` — now the
**second** run — kills it and reports it. The innocent tool is blamed in the one
field `tools-api/index.ts` says is a verdict on the tool: _"only `killed` and
`unresponsive` mean 'this tool did not behave', and only they should ever be
counted anywhere."_ The overwritten `ActiveRun` is also never killed, so the
first run's worker leaks.

It is unreachable today only because `inProcessRunner` calls `tool.run(...)`
synchronously and `scriptStats` finishes inside that call, so no tool has ever
still been alive at a tool switch. **A worker-backed checker is the first tool
that can be**, which is this very section. The fix is small and belongs in
`host.ts`: `reset()` terminates an active run rather than forgetting it — share
`clearTimers` + `active = null`, or call `terminate()` when `this.active !==
null`.

**What makes the defect reachable is the WORKER RUNNER, and it is worth being
exact because the obvious answer is wrong.** The misattribution above needs one
host holding both runs — `terminate()` reads `this.active`, which the second
`start()` overwrote. A host built per tool (the wiring rejected above) does not
produce it at all: the cancelled run's grace timer fires on the OLD host and
kills the OLD host's `active`, which is the run that was actually cancelled.
So a per-tool host would MASK this defect rather than expose it, while
introducing the two-live-runs defect in its place. The enabler is a tool that
can still be alive at a switch, on today's single shared host — which is the
worker runner, and which an injected slow in-process runner already reproduces
with no worker and no wiring change at all. That is why Sec.7.2 sequences the
`reset()` fix first: it is independently testable today, and the runner work is
what turns it from latent into live.

**Structured clone is a third transport, and it is not free.**
`tools-api/index.ts` frames the contract as "one contract, two transports";
posting a `ToolContext` to a worker is a third — in-process types (real
`Infinity`, real `def`) over a structured-clone boundary. Sec.0's "no clone and
no decode" describes `inProcessRunner` and stops being true here, so the two
statements are scoped rather than left contradicting each other.

Two things follow, and the second is the useful one:

- **Do not price the clone off the JSON number.** The worst tracked parse is
  13.97 MB _as `JSON.stringify` output_, ~41% of which is `def` re-expansion —
  but `postMessage` uses the structured clone algorithm, which **preserves
  internal aliasing**: a `def` object shared by a thousand nodes is cloned once,
  not a thousand times. The JSON figure is an upper bound on a different
  operation and must not be transcribed as a transfer cost. It is still a real
  per-run cost and still unmeasured; measure it before quoting it.
- **The checker takes its reference data from the context, and the argument for
  a private import does not transfer.** The tempting move is to copy
  `src/preview/worker.ts`, which holds its own import for the reason `types.ts`
  records — _"Shipping it per request would structured-clone ~111 KB of JSON on
  every keystroke burst for data that never changes"_ — and to note that the
  reference data here is **1.50 MB** on disk — the 1.44/1.30 an earlier revision
  published are MiB, and the files measure 1,364,320 and 142,644 bytes
  (`game-constants.json` 1.36 MB +
  `language.json` 0.14 MB, re-measured 2026-08-17), 13× that argument. **The multiplier is the wrong
  half of that sentence.** The preview worker is long-lived and paid per
  keystroke; the checker's worker is one per run (this section's own "one
  worker per run" rule), and one run is 48 s on a median map to 24 minutes on
  a heavy one at Giant (Sec.4.4). One 1.5 MB clone at the head of that is
  noise, and buying it back would cost a second copy of the data in the worker
  bundle plus a divergence between what `ToolContext` says the tool reads and
  what it reads.

  **It would also not be bought.** Sec.6 declares `read-reference` (pinned by
  name in `tools-api-design.md` Sec.6) and Sec.7.1's branch keys purely on the
  declared capability, so `ToolsPane` builds the 1.5 MB into `ctx` and
  `postMessage` clones it whatever the worker then chooses to read. A private
  import would leave the cost in place and only add a second source of truth.
  Sec.4.1's `buildLanguageIndex(ctx.referenceData.language)` and
  `ctx.referenceData.gameConstants` stand as written.

### 4.4 Budget and defaults — closing the risk `tools-api-design.md` left open

`tools-api-design.md` Sec.10 states plainly "This is a 5.2 problem, not a 5.1
one" of the budget question — the arithmetic that follows is this document's
answer, **on numbers measured for this revision, because the older figure had
drifted 1.7× while sitting in a document**.

**Corpus cost, `generatePreview` once per player count per map at Normal,
`collectSnapshots: false`, meaned per map, this machine (2026-08-15):**

|            | measured                                                        |
| ---------- | --------------------------------------------------------------- |
| median map | **794 ms/generation** (`AD4 - Ra.rms`)                          |
| mean       | 960 ms                                                          |
| worst      | **`24hr_Petra.rms`, 4669 ms**                                   |
| next four  | Grand Bara 2239, Caverns 1804, Pag 1600, Mont Saint Michel 1540 |

**Re-run on 2026-08-16, same method: median 775 ms, mean 980 ms, worst Petra
4524 ms, then Caverns 2870 / Grand Bara 2268 / Mont Saint Michel 1812 / Pag 1510.** The level reproduces and the top of the ordering does not quite (the
middle three swap), which is what a 3.7× load factor on a shared machine looks
like. A third reading of the same corpus on a loaded machine put the worst map
at 6208 ms. **Treat every number in this table as ±50% and never as a point** —
the budget arithmetic below is built to survive that, and the one place it
would not is called out explicitly.

The worst case has a name and a cause: **`24hr_Petra.rms` is the map BUG-013
fixed** — it went from 0 land origins to 384 (30,926 tiles) on 2026-08-13 and
its generation cost went with it, and nobody re-timed. (Petra is local-only, so
a clone will not reproduce 4669 ms; a maintainer's disk will.)

**Two multipliers apply on top and both are already documented in this repo.**
Giant against Normal measures 1.2–1.6× on four heavy maps (Caverns 2489 → 3536,
Pag 2084 → 2837, Namatjira 1696 → 2700, Three Bays 1739 → 2243), consistent with
the 1.09–1.41× `tools-api/index.ts` records; and this machine's load factor
reaches 3.7×. `DEADLINES`' own comment names the two available mistakes — _"a
deadline shorter than one unit of the tool's own work, and a worst case measured
at ONE map size"_ — and a budget section that quoted one median at one map size
would be making the second again.

**What that gives at the defaults (4 × 15 = 60 generations):**

|                              | Normal, unloaded | with Giant × load |
| ---------------------------- | ---------------- | ----------------- |
| median map                   | **48 s**         | up to ~4 min      |
| worst map                    | **280 s**        | ~24 min           |
| worst map at N=200 (the max) | **62 min**       | several hours     |

So N=1000 across four player counts is **hours, not the ~30 minutes**
`tools-api-design.md` Sec.10 estimated, and is emphatically not this tool's
default. Concretely:

- `runsPerPlayerCount`: **integer param, default 15, min 5, max 200.**
- `playerCounts`: **multiSelect, default `["2","4","6","8"]`** (matching
  PLAN.md's literal matrix) — the count is where the budget gets controlled,
  not the matrix.
- **The 60 s run watchdog is fine, and for a reason that survives the new
  numbers**: it resets on every progress message (`DEADLINES.runWatchdogMs`,
  `host.ts`'s `armWatchdog`), so it bounds **one generation**, not the run.
  Worst measured generation × Giant × load is **≈24 s at the 4.5–4.7 s the
  worst map measures unloaded, ≈32 s at the 6.2 s a loaded machine produced**
  — inside the 60 s window either way, and consistent with the ~20 s the
  constant was derived against, but the honest margin is 2× rather than 2.5×.
  This is the one line in the budget where the table's ±50% is load-bearing,
  which is why it carries a range rather than the point estimate an earlier
  revision computed. The chunking rule above is what makes the per-generation
  framing true at all; batching would break it.
- **That same 24–32 s bounds the CANCEL GRACE too, and rev 6 computed the
  number for both deadlines and checked it against one.** Cancel is a message,
  not a flag (`host.ts`: _"a tool in a tight synchronous loop never services its
  event loop"_), and Sec.4.1 pins that `generatePreview` is synchronous and
  cannot yield inside itself — so the tool services a `cancel` only at the
  macrotask boundary **between** generations. **Cancel latency is therefore one
  generation, the same quantity**, against `DEADLINES.cancelGraceMs` of **30 s**,
  half the watchdog. At the top of this section's own range the grace expires
  first and `host.ts` calls
  `terminate("The tool did not stop when asked and was killed.", "killed")` —
  and `killed` is one of the two reasons `tools-api/index.ts` says are a verdict
  on the tool (_"only `killed` and `unresponsive` mean 'this tool did not
  behave', and only they should ever be counted anywhere"_), collected against a
  tool that honoured the cancel exactly as specified, on the flagship tool, on
  the heaviest maps.

  **So `cancelGraceMs` moves 30 s to 60 s**, equal to `runWatchdogMs`, because
  the two bound the same quantity and a factor of two between them is the
  asymmetry `DEADLINES`' own comment already argues against (_"Asymmetric, so
  round up"_). **What the grace costs when it expires is smaller than it looks,
  and being exact about it is what decides the side**: a worker-backed runner's
  `kill()` is `worker.terminate()`, which needs no cooperation from the tool, so
  the run stops either way. The only thing the grace decides is whether a
  cooperative tool is RECORDED as having misbehaved — which is what `DEADLINES`'
  comment says the constant is for (_"a DIAGNOSIS threshold, not a safety
  deadline"_), and it is the reading under which erring long is nearly free. A
  wedged tool holds the app-wide run slot for 60 s rather than 30 s; against a
  legitimate run of 8 to 30 minutes that is not worth a false verdict.

  This is a change to a published constant, so it is an amendment to
  `tools-api/index.ts` and `tools-api-design.md` Sec.4.1 rather than a local
  decision — the same move that document's own rev 6 made when it took both
  constants from 15 to 30 and 30 to 60 for this exact reason. It lands in
  **Sec.7.2 item 4**. **The general rule, now twice in three rounds: when a
  document computes a number for one constant, check every constant that number
  bounds.**

- **A third and fourth reading of the Giant multiplier, recorded rather than
  folded.** Re-measured best-of-two with the Normal and Giant arms interleaved:
  `24hr_Petra.rms` 6935 → 12308 ms (**1.77×**), Caverns 2503 → 4556 (1.82×), Pag
  2101 → 3415 (1.63×), Three Bays 2100 → 3243 (1.54×), Namatjira 2031 → 2837
  (1.40×), Grand Bara 3968 → 4161 (1.05×). Four of six sit at or above the
  1.2–1.6× band stated above, and the band was taken over four heavy maps that
  **exclude `24hr_Petra.rms`, the worst map it is then applied to**. Per this
  repo's own rule a contrary reading is a third data point rather than a
  correction, so the band stands and this sits beside it — but the _set_ it was
  measured over is a real defect in the derivation, and nothing above depends on
  the multiplier's exact value: the grace finding holds at rev 6's own 24–32 s.
- **The UI must not tell a user that raising N costs minutes.** On the heaviest
  maps it costs an hour or more. The progress display carries elapsed time and
  generations completed (Sec.5.2) so the user can cancel on evidence rather than
  on a promise, and `Cancel` (Sec.4.3) is always available. This document does
  not pretend a higher N is cheap.
- This is a **deviation from CREATION_PLAN 5.2's literal "1000 runs... should
  be seconds" brief**, made explicitly rather than silently, on the same
  measured ground `tools-api-design.md` Sec.10 already established: that
  estimate was PLAN.md's own aspiration, not a measurement. The fresh numbers
  widen the gap rather than narrow it — closer to three orders of magnitude than
  two. Same posture this project has taken every other time a brief's arithmetic
  met a measurement (CLAUDE.md hard rules, "prefer an observable to an
  argument").

### 4.5 `partial` streaming

Per `tools-api-design.md` Sec.4.2's own note ("`partial` exists so the checker
can stream findings while running"), emit a `partial` with the current
aggregate's report table (Sec.5.1) after each player count's batch completes —
**not** after every single generation, which at N=60+ costs a full re-render of
the output area for no benefit (the table's shape does not change meaningfully
generation-to-generation).

#### A `partial`'s table ranges over the counts RUN, never over the selected matrix

**Every quantifier in Sec.5.1 ranges over _the selected matrix_, and part way
through a run the matrix is not what the aggregate holds.** Sec.4.2 defines
**absent** as `runsContaining === 0`, and that is also the state of every player
count the loop has not reached yet. Prescribed without a domain, the first
`partial` of a 2/4/6/8 run has 4, 6 and 8 absent on every row, and Sec.5.1's
third reason clause fires on all of them: _"this command is only generated at 2
players"_.

**Measured, and it is not a rounding error on the output.** At 2 players, seed 1
— this document's own census point — **8125 rows, of which 8040 (99.0%) are also
present at 4, 6 or 8**; swept seeds 1–5, 8260 and **8172**; tracked only, 2497
and **2438**. Only **85 rows** in the whole corpus (presence pattern `P---`) are
genuinely 2-players-only. The second and third partials repeat the claim with
wider wording. **Three of the four outputs the tool emits at the defaults would
be wrong on ~99% of their rows**, and only the final `result` right.
`sample.rms` — tracked, every CI run — carries 8 rows at 2 players.

**It is not a transient, because the wrong output is what survives a cancel.**
`host.ts`'s `"partial"` case sets `output` with a bare `this.set({ output })`,
and `finish()` sets `phase: "done"` without clearing it, so a cancelled run
leaves the last partial on screen as its permanent result. Sec.4.4 designs for
exactly that cancel (_"the user can cancel on evidence rather than on a
promise"_) on runs it prices at 8 to 30 minutes.

_Both claims were written with raw line numbers (`:243`, `:278-283`) and both
line numbers were stale within an hour_ — Sec.7.2's own `reset()` rewrite moved
them to `:272` and `:305-310` the morning after this section shipped, while
leaving both claims true. That is the tools-api rev-9 decay measurement
reproducing on this document, and the fix is the one that round already
prescribed: **anchor on the symbol, not the offset.** Line numbers survive here
only where the file is not under active edit.

**Both of Sec.8 item 2's invariants pass on this output**, because both were
written against a completed matrix: the worst count named is a count the command
really was generated at, and no row reports "attempted nothing" at an absent
count.

**The rule, and the discriminator is already in the record.** _A player count the
run has not started is **not yet measured**: it is not ranked, it contributes no
"only generated at" claim, and no reason clause may mention it._ The report
table a `partial` carries quantifies over the counts whose batches have
completed, and Sec.5.2's `keyValue` header already draws this distinction one
block away — its first row is _"player counts run"_, so _selected_ versus _run_
was modelled in the header and nowhere in the table's rules.

**Stated twice, because the natural implementation makes the primary form
unobservable.** The aggregate is a map keyed `(commandSpan, playerCount)`, so a
count that has not run has **no entry at all** rather than an entry reading
`runs === 0` — the domain rule above is the one that does the work. The
`runs === 0` test is the **backstop** for an implementation that pre-seeds the
matrix with empty cells, which is a reasonable thing to write and is exactly how
the absent state would be reintroduced. A count that ran and never contained the
command is `runs > 0, runsContaining === 0` and is genuinely absent; the two are
distinguishable without a new field, which is the same shape as this section's
own three-state fix.

**Three `partial`s at the default settings, not four, and the fourth was a
redundant full re-render.** The last player count's batch completing leaves the
aggregate identical to what the final `result` carries, so a `partial` there
re-renders the whole output area to display what the next message displays
again — the exact cost this paragraph's own argument is about. Emit a `partial`
after every completed count **except the last**: three at the defaults, plus the
`result`.

**`maxBlocksPerOutput` was cited as "not the reason" over an arithmetic that
named two of the output's three block populations, and the sentence was false on
this corpus for four revisions.** The static-finding blocks appear in neither
term of the table below, and `Pa_Site_v1.1.rms` reached **1026 blocks** at the
default matrix — over the 1000 cap, rejected by `protocol.ts`, the run killed,
the user given nothing. Sec.5.1 now bounds that population at a constant (**at
most 29 blocks from the static layer, whatever the script says**) and the worst
map measures **6**; the cap conclusion below is restated with the term present
rather than inherited.

**A `partial` **replaces** the output** — _"A full self-contained output, never a
delta"_ — so blocks never accumulate across partials. The 8-block figure an
earlier revision used counted the finding tables alone; with Sec.5.4's notes
passthrough the worst corpus map is **`24hr_Petra.rms`'s 30 distinct note
texts**, which under Sec.5.4's shape (a `severity` plus a `table` per group) is
**60** blocks, roughly 72 with the finding tables — and even the rejected
one-block-per-span rendering tops out at `Pa_Site`'s **184**. Render cost is the
whole of the argument and stands on its own.

**The rule this section owes its own successors**: _a paragraph that closes a
cap question has to enumerate every producer that writes into the capped thing._
The tell is a cap arithmetic naming fewer block kinds than the output contains,
and this one named two of three while a third section, one page later,
prescribed one block per static finding with no unit and a fourth multiplied
whatever that turned out to be by the player count. Three sections each correct
in isolation.

**That margin was computed at ONE generation and this tool's default is sixty,
and the figures move by an order of magnitude.** Sec.5.4's own opening sentence
is that notes are _"accumulated across the Monte Carlo runs"_; the defaults are
4 counts × 15 runs. Measured over 2/4/6/8 × seeds 1–5 (20 runs, a third of the
default), under the accumulation this section had before Sec.5.4's ordering rule
below:

**One table, three columns, because two tables over the same population one
paragraph apart is the exact drift this document keeps filing findings about.**
The third column is the re-take at the real defaults that rev 13 named as owed
— all 32 maps, 2/4/6/8 × 15 = 60 generations, seeds 1–15 per count, under the
corrected pipeline. The first two columns are kept only so the saturation is
visible; **neither is the margin, and a later reader must not cite them as
one.**

|                                                                                                  | 1 run             | 20 runs, naive                      | **60 runs, corrected** | cap                               |
| ------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------- | ---------------------- | --------------------------------- |
| worst map, note blocks (`severity` + `table` per group)                                          | `24hr_Petra` 60   | `24hr_Caverns` **570**              | **`24hr_Petra` 65**    | `maxBlocksPerOutput` **1000**     |
| worst tracked map, note blocks                                                                   | `AK_Namatjira` 48 | `AK_Namatjira` 538                  | **`AK_Namatjira` 58**  |                                   |
| largest single group's table rows                                                                | `Pa_Site` **134** | **2680** (distinct spans still 134) | **`Pa_Site` 134**      | `maxTableRowsRendered` **10 000** |
| same, tracked                                                                                    | `AK_Namatjira` 77 | **1540**                            | **`AK_Namatjira` 77**  |                                   |
| covered fraction, `Rage Forest` (the one map where per-group and per-map coincide — see Sec.5.4) | 70.9%             | **1418.1%**                         | **70.9%**              | 100% by construction              |
| corpus same-text groups                                                                          | 338               | **1847** (tracked 124 → 639)        | not re-taken           |                                   |

**Every figure saturates to its one-generation value, and the two table rows
land on it EXACTLY.** That is the strongest available check that the dedupe does
what the ordering rule says rather than merely reducing a number: `Pa_Site`'s `unsimulated` group is 134
distinct spans however many times the tool visits them, and 60 runs finds the
same 134. The block counts sit a little **above** their one-run values (60 → 65,
48 → 58) rather than at them, and that is the range rule working rather than a
residue — more runs genuinely discover note texts one run does not produce, and
each new text is one more group. **A run adds a group only when it produces a
sentence no earlier run produced**, which is the saturation the rule predicted,
stated as the shape of the arithmetic rather than as a hope about it.

**So the whole output is bounded, and every term is now named.** Notes:
**≤ 65 measured**. Static findings: **≤ 29 by construction** (Sec.5.1), 6
measured. Finding tables: **≤ 12 by construction** — one `heading` plus one
`table` per stage, six stages. Header: 1. Nothing here is within an order of
magnitude of `maxBlocksPerOutput`, and unlike the version of this paragraph that
stood for four revisions, the static term is in the sum.

**The conclusion survives, and the reason it survives is Sec.5.4's accumulation
rule rather than headroom.** The 570 is a count of _groups_ under a naive
accumulation that lets one note's interpolated text found a new group per run,
which is precisely the defect Sec.5.4's ordering rule below closes: group by
`key` first, collapse same-key/different-text into a range, then group by text,
and dedupe spans within a group. Under that rule a run adds a group only when it
produces a note text no earlier run produced, so the counts saturate near the
one-generation figures instead of multiplying by the run count —
`Pa_Site`'s 2680-row table is 134 distinct spans repeated 20 times, and the
merged table is 134 rows. **So the block cap is not the binding constraint, and
that sentence is now conditional on the fix rather than on the margin.** The
re-take at the full 60 runs under the corrected accumulation is **done, and is
the table above**; what must not happen is a later reader citing the **1-run**
figures as the margin, which is what this paragraph did for three revisions.
The 1-run column is kept only so the saturation is visible.

**The worst map has changed identity three rounds running and the mechanism is
different each time**, which is why the number is now stated with its
accumulation attached: `AK_Namatjira` (24 texts, ranked off the wrong
population), corrected to `24hr_Petra` (30, ranked correctly at one generation),
and over the runs the tool actually performs it was `24hr_Caverns` (285 groups
naive), with Petra fourth.

**And the fourth identity is `24hr_Petra` again, which is the point.** Measured
at the real defaults under the corrected pipeline, the ranking is **`24hr_Petra`
65 blocks, `AK_Namatjira` 58, `AD4 - Pag` 54, `Menindee` 52, `24hr_Caverns` 49** —
Caverns's naive lead was an artefact of the accumulation and not a fact about
the map. **A superlative that moves when the arithmetic under it is fixed was
never a claim about the corpus**, which is the same lesson this paragraph
already records one revision earlier, arriving through the other input.

**The map this paragraph named for one revision was the wrong one, and the
mechanism is worth a sentence because it is this document's own recurring
shape.** An earlier revision published `AK_Namatjira`'s **24** texts (48 blocks)
as the worst; it had swept **notes per map** — 184 / 138 / 132 — and read the
distinct-text count off the top three of _that_ ranking. The two rankings are
different orders: `Pa_Site`'s 184 notes are 6 texts, while Petra's 99 are 30.
Ranked by distinct texts the corpus reads **Petra 30, `AK_Namatjira` 24,
`24hr_Caverns` 23, `AD4 - Pag` 23, `Chaotic_Strait` 21, `QS_Three_Bays` 17**.
The conclusion never moved, which is exactly why it was worth correcting rather
than arguing: a superlative published with the population it was _not_ measured
over, in the paragraph whose own subject is that the earlier figure had never
been taken.

## 5. Report format

### 5.1 The finding table

PLAN.md's own words: "per object/land/connection: spawn rate, failure buckets,
worst player count."

One `OutputBlock` of `kind: "table"` per **stage-scoped entity kind** (Land,
Terrain, Elevation, Cliff, Connection, Object — the six stages that emit
reports, so the table headings are the same section names Breakdown already
uses; `StageId` itself has **seven** values, S0–S6, and S0 emits no
`CommandReport`s — it does emit `SimulationNote`s, which Sec.5.4 passes through,
so the two statements are scoped rather than left to look contradictory), each
row one aggregated `commandSpan`:

| Column             | Source                                                                                                                                                                                                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command            | the command's own text, sliced from `ctx.source` at `commandSpan` (see below)                                                                                                                                                                                                                                                    |
| Spawn rate         | `Σ placed / Σ attempted` across all runs at the **worst** player count (below), as a percent — **and it is not a percent when `Σ attempted` is 0**, which is 467 of 8095 reports on this corpus (below)                                                                                                                          |
| Worst player count | the `playerCount` in the selected matrix with the lowest spawn rate for this command, **ties broken by the lowest player count** (below) — **and the ranking is over three states, not two: a count that attempted nothing ranks below every rate, and a count where the command is not generated at all is not ranked** (below) |
| Failure buckets    | comma-joined `FailureBucket` names with counts, e.g. `occupancyFull ×140, spacingConflict ×12` — **at the worst player count, the same domain as the rate beside it** (below), never the matrix union                                                                                                                            |
| Provenance         | `"simulated"` for every row this section produces                                                                                                                                                                                                                                                                                |

**`rowSpans` is one array on the block, not a property of a row.** The contract
is `{ kind: "table"; columns; rows: string[][]; rowSpans?: (Span | null)[] }`,
and its own doc comment requires exactly `rows.length` entries — so the block
carries `rowSpans: reports.map(spanForRow)`, in row order. A user clicking a row
jumps the Code tab there, same as `scriptStats`'s section table already
demonstrates. (An earlier revision wrote _"`rowSpans: cmd.commandSpan` on every
row"_, which names the right intent in a shape that does not compile.)

**The Command column has to come from the source, because `CommandReport` has no
label.** `entity` ("GOLD", "land #3") lives on `PlacementFailure`, not on
`CommandReport` — so a command that never failed carries no failures and
therefore no name, which is precisely the row a healthy report is full of. Slice
`ctx.source` at `commandSpan` and take the first line, trimmed. Where the row
_does_ have failures, the first failure's `entity` is a good short label and may
be preferred.

#### `Σ attempted` is 0 on 467 of 8095 reports, and the prescribed formula on them is `0 / 0`

**The Spawn rate column states a formula and never states its domain.**
`Σ placed / Σ attempted` is `NaN` when the denominator is 0,
`(NaN * 100).toFixed(1)` is `"NaN"`, and nothing here or in Sec.4.2's
aggregation ("summing `attempted`/`placed`") says what a row with nothing
attempted does. Sec.5.3 thought carefully about the rate's **honesty** — _"a
command showing 100% at `runsPerPlayerCount: 5` is not proven reliable"_ — and
never about whether it exists.

**Measured, one generation per map at 4 players / Normal / seed 1 over the 32
maps on this mount: 8095 `CommandReport`s, of which 467 carry `attempted: 0`,
spread over 30 of the 32 maps.**

| stage          | zero-attempt reports | maps                                            | what the row carries            |
| -------------- | -------------------- | ----------------------------------------------- | ------------------------------- |
| S6 objects     | **462**              | **29**                                          | exactly one failure bucket each |
| S5 connections | 4                    | 3 (`Menindee`, `TL Black Forest`, `sample.rms`) | **no failures at all**          |
| S2 elevation   | 1                    | 1 (`AK_ForeDaut_v1.3.rms`)                      | **no failures at all**          |

**Pinned at 4 players, in a subsection about a four-count matrix, so the other
three were swept.** 6 and 8 players are identical to the unit — 467 of 8142 and
of 8161, 30 maps, the same 242 / 203 / 17, the same five bucketless rows.
**2 players is 402 of 8125 on 29 maps**, decomposing `actorAreaMissing` **251**,
`landMissing` **128**, `gaiaOnlyRequired` **20**, with **3** bucketless: the
total moves 14%, the largest bucket _grows_ by 9 while the second falls by 75,
and the bucketless half loses two of five. Nothing below changes and the ordering
is stable. The decomposition is quoted at 4 because that is where this document's
other figures are taken; the rule further down is stated over the **whole
matrix**, because that is where the defect this subsection exists for actually
lives.

**The 462 decompose into three buckets, and the largest one is not an early
return** — which matters, because a fix aimed at the early returns repairs 220
rows and leaves 242 standing. `actorAreaMissing` **242**, `landMissing` **203**,
`gaiaOnlyRequired` **17**; 242 + 203 + 17 = 462, so every S6 row is accounted
for and every one carries exactly one bucket. Six early returns in `objects.ts`'s
per-command loop push a bucket and a `{ attempted: 0, placed: 0 }` report: an
unresolvable type (`:1345`), an object group with no valid `add_object` members
(`:1354`), `place_on_specific_land_id` naming a land no command declares
(`:1361`), a reference frame matching no land (`:1372`),
an object that must carry `set_gaia_object_only` and does not (`:1379` —
_"without it the engine places nothing"_), and
`min_distance_to_players > max_distance_to_players` (`:1417`). _(All six cite
the `pushFailure(` line, which is the `if`'s first statement; two of them are
multi-line calls, so the `bucket:` line is one further down and is not the
anchor.)_ **Only three of
the six fire on this corpus** — the two `landMissing` paths and
`gaiaOnlyRequired`. The 242 come from the ordinary path instead:
`buildCandidatePredicates` returns `undefined` when `actor_area_to_place_in`
names an id with no live areas (`:1079`), and the frame loop's guard at
`:1498` `continue`s at `:1509` **without incrementing `attempted`**, so a
command whose every frame misses that way arrives at 0/0 with no early return
involved.

**The 5 non-S6 rows carry no bucket at all, and they are the harder half — and
four of the five come from a path this section named wrongly for a revision.**
`elevation.ts:393` reports a `create_elevation` whose `MaxHeight` is ≤ 0 as 0/0
with an empty `failures`, and that is 1 of the 5. The other four are S5 and they
do **not** come from `connections.ts:784`. That is the blocked-by-bug path; it
pushes a `connectionBlockedByBug:<span>` note beside its report, and measured
across the 32 maps at **2, 4, 6 and 8 players there are 0 such notes** — the path
is never taken on this corpus at any count the tool runs. It is also not about
the command this section used to name: `blocked` is set at `:860` _after_ a
`create_connect_to_nonplayer_land` has been processed, so the path reports the
connections declared **after** one, never that command itself.

**All four arrive at the ordinary push site.** `connections.ts` has exactly two
`reports.push` sites, `:784` and `:858` (`attempted: pairs.length`); the four
reach `:858` with `pairs.length === 0` — an empty pairing, no early return, no
note. Measured at 4 players:

| map                     | command                            | tracked |
| ----------------------- | ---------------------------------- | ------- |
| `sample.rms`            | `create_connect_all_players_land`  | **yes** |
| `TL Black Forest.rms`   | `create_connect_all_players_land`  | no      |
| `TL Black Forest.rms`   | `create_connect_teams_lands`       | no      |
| `Menindee_AUS_v2.3.rms` | `create_connect_to_nonplayer_land` | **yes** |

**And no S5 row carries a note at its own span**, checked at all four counts —
including Menindee's, which is the named command but did not come from the bug
path. `TL Black Forest`'s `create_connect_teams_lands` does produce an
explanation, the run-level `teams` note (_"this script connects team lands, but
the current lobby has no teams"_), and it has **no span**, so it is exactly the
kind Sec.5.4's span-carrying rendering cannot anchor to a row.

**The mechanism is `resolvePairs` (`:717-737`), and it is a better row than any
stage label.** Each command resolves a node set that can come back empty:
`create_connect_all_players_land` → `allPairs(playerLandIndices(origins))`, empty
below two player-land origins — `sample.rms` declares its `create_player_lands`
inside `<PLAYER_SETUP>`, which S1 does not read, so it has none;
`create_connect_teams_lands` → `teamPairs`, empty when no two lands share a team;
`create_connect_to_nonplayer_land` → `crossPairs`, empty when either side is.
_"This command connects nothing, because one side of the pairing is empty"_ is
true of all four, is PLAN.md's _this command contributes nothing to your map_
exactly, and is derivable from the command name plus the pairing the stage has
already resolved. _"Print the failure buckets instead of a rate"_ prints nothing
on any of the five, and _"say it from the stage"_ prints a named engine bug on a
tracked map about a command the bug never touched.

**Four consequences, in ascending order of how bad they look to a user.**

1. **The Spawn rate cell reads `NaN%`.** On a typical corpus map that is
   roughly fifteen rows of the object table.
2. **The Worst player count cell is silently wrong rather than visibly wrong.**
   Every comparison against `NaN` is `false`, so a `reduce` with `<` keeps
   whichever player count was folded first and prints it as a measured worst
   case; `Math.min` returns `NaN` and the column renders empty. Both are
   confident-sounding output about a command the tool never measured.
3. **The rows it lands on are this tool's own best findings.** `landMissing`,
   `gaiaOnlyRequired` and an unresolvable type are precisely _this command
   contributes nothing to your map_, the class PLAN.md commissioned the tool
   for. This is goal 1's "confidently wrong" arriving through a **division**
   rather than through a claim, and it is worse than the `{0,0}` span below:
   a wrong span fails at the point of a click, while `NaN%` sits in a table of
   real percentages and never fails at all.

**A fourth consequence, and it is the one that decides what "worst" may mean:
the zero-attempt rows are not all zero at every player count.** Keyed by
`(map, stage, commandSpan)` over the 32 maps at 2/4/6/8, Normal, seed 1 —
**8358 distinct rows**:

|                                                         | rows    |
| ------------------------------------------------------- | ------- |
| `Σ attempted` 0 at **every** player count in the matrix | **402** |
| **zero at some counts, with a real rate at others**     | **65**  |
| never zero                                              | 7891    |

**All 65 carry one pattern** — a rate at 2 players and `attempted: 0` at 4, 6 and
8 (`N000` ×65; no other pattern occurs) — across 7 maps: `AK_Six_Points` 15,
`AK_Hourglass` 13, `OWWC1Tewaipounamu` 12, `Menindee` 10, `TL Cape of Storms` 9,
`TL Black Forest` 5, `W4 - Immersion` 1. **Three of those maps are tracked** (38
of the 65 rows), so this is CI-reproducible rather than a maintainer-disk
artefact. 63 of the 65 carry `landMissing` at the higher counts — a
`place_on_specific_land_id` naming a land that only exists in the 2-player
branch, which is a **finding**, not noise — and the other 2 are S5 rows from the
bucketless five above. **And the surviving rate is not a middling one: 60 of the
65 place 100% at 2 players**, 2 place 50%, 3 place under 11%. A rule that merely
**excludes** zero-attempt counts from the minimum takes the minimum over `{2}`
and prints, on 60 rows, _"Worst player count 2 — spawn rate 100.0%"_ about a
command that attempts nothing at three of the four counts in the matrix: every
cell individually defensible, the row as a whole a confident falsehood, and this
time in a cell that looks **measured** rather than one that looks broken. It is
consequence 2 again, arriving through consequence 2's own fix.

_Scope note: the 402/65 split is at seed 1, and over 15 seeds the two populations
will move — Sec.3.0's 12-of-32 command-set drift is the mechanism. The direction
will not: the pattern is unanimous and its cause is that more players means more
frames to miss._

**The rule.**

- **A row whose `Σ attempted` is 0 at a player count has no spawn rate at that
  player count.** Print an explicit non-numeric cell (`—`), never a computed
  percent and never `0%` — `0%` is a measurement, and this is the absence of
  one.
- **The order is over THREE states, and the third is the one an implementation
  invents by accident.** Per Sec.4.2 each `(commandSpan, playerCount)` cell is
  **rated** (`runsContaining > 0`, `Σ attempted > 0`), **zero-attempt**
  (`runsContaining > 0`, `Σ attempted === 0`) or **absent**
  (`runsContaining === 0` — the command is not generated at that player count
  at all). They rank differently and the difference is not cosmetic:
  - A **zero-attempt** count ranks BELOW every rate; it is not excluded from
    the order. A count where the command ran and attempted nothing is not
    missing data for the purposes of "worst" — it is the worst outcome the
    matrix contains, and the column has to be able to say so. "Worst" names the
    **lowest** such count, and the Spawn rate cell beside it takes the
    non-numeric marker rather than importing a different count's percent (which
    keeps _"`0%` is a measurement and this is the absence of one"_ true of the
    cell it actually lands in).
  - An **absent** count is **not ranked at all** — not as a rate, not as a
    zero. There is no outcome to rank: the user's script does not contain this
    command at that player count. "Worst" is taken over the counts that are
    rated or zero-attempt, and a row that is absent everywhere except where it
    is healthy prints its true worst **rated** count with its real percent.
  - Where **every** count in the matrix is zero-attempt, the Worst player count
    cell is the non-numeric marker, because there "worst" is a claim about a
    rate that does not exist.

- **"Worst" is a MINIMUM over a set that is usually not a singleton, so the
  tie-break is part of the rule and not an implementation detail.** Measured over
  the 32 maps at 2/4/6/8, Normal, seed 1, restricted to rows with at least two
  rated counts and no zero-attempt cell — **7623 rows, of which 7313 (95.9%) have
  the minimum rate tied across two or more counts**, 2041 of them on tracked
  maps. That is the corpus rather than an edge case, because a healthy command
  places 100% at every count, and 100% ties with 100%. **The tie is the
  lowest player count**, which is the same tie-break the zero-attempt clause
  above already uses (_"'Worst' names the lowest such count"_) and is what this
  document's own worked exemplar has been assuming without saying so:
  `13_Rings_v1.2.rms` at `:128660` is `attempted 3, placed 3` at _every_ count,
  so its published "worst count 2" is a tie-break result and not a measurement.

  **An undetermined tie stopped being harmless when the Failure buckets column
  got its domain.** While the tie chose only a _label_, either count printed a
  true statement. Pinning the buckets cell to _"the worst player count's, the
  same domain as the rate"_ makes the undetermined key select the **evidence cell
  beside the fraction**: of the 7313 tied rows, **2022 carry a failure at a tied
  count**, and the tied counts disagree on the bucket **set** on **146** rows (10
  tracked) and on the bucket **counts** on **250** (29 tracked). The set
  disagreements are the difference between an empty cell and a named failure at
  the same printed rate — `24hr_Blind Valley.rms`'s S4 row at `:19132-19247` is
  100.0% at all four counts carrying `{growthShortfall ×10}`, `{×6}`, `{×3}` and
  `{}`.

  **The alternative was to break ties toward the count carrying the most failure
  occurrences, and it is rejected for a reason worth recording**, because it is
  the rule a reader re-derives from the paragraph above. It would make the
  evidence cell the strongest evidence available at the printed rate, which is
  what that column is for. It is not taken because it makes "worst" a minimum
  over two differently-typed quantities — a rate, then a count of occurrences
  whose units differ per bucket (`growthShortfall` counts tiles, not attempts,
  which is the qualification the buckets subsection already carries) — and
  because on the tied rows every candidate count prints the **same rate**, so no
  cell is wrong under either rule and only one of the two is a function of one
  variable. **The cost is priced rather than buried**: Sec.8's reporter prints
  the 146 and the 250, so a later revision reopening this has the number in front
  of it.

  The invariant, stated so an implementer can test it rather than infer it:
  **"worst" must never resolve to a player count the command succeeds at while
  another count in the same matrix ran the command and attempted nothing** —
  and its partner, which is the clause the three-state reading exists for:
  **a count where the command is not generated must never appear as a worst
  player count, and must never contribute a zero-attempt verdict.**

  **The cost of collapsing absent into zero-attempt is 352 rows and every one
  of them is healthy** (Sec.4.2's census). Folded with `?? 0`, **233 of them
  print `Worst player count 2`, 85 print `4` and 34 print `6`**, each beside
  the non-numeric marker, about commands that placed at 100% at every count
  where they exist — `24hr_Blind Valley.rms`'s `create_land { if ANGLE1 … }`
  family and `24hr_Battle Lines 1.0.rms:5008`'s `create_player_lands` are the
  shape. **This is the same inversion this subsection filed against the
  exclusion rule, pointed the other way**: excluding zero-attempt counts from
  the minimum was harmless on these rows because it dropped the absent ones
  too; ranking them below every rate promotes them to the answer. A rule that
  fixes a column by ordering its states is only as good as its census of the
  states.

- **A row that is zero at some counts and not others says which, and a row that
  EXISTS at some counts and not others says that instead.** They are three
  findings, not one, and they otherwise render identically:
  - 402 rows attempt nothing at every count — _this command contributes nothing
    to your map_.
  - 65 rows work at 2 players and attempt nothing above — _"attempted nothing
    at 4, 6, 8"_, with the reason from the buckets (`landMissing ×N`).
  - 352 rows are generated at some counts only — _"this command is only
    generated at 2 players"_, which is a finding a user wants and is **not** a
    failure. Never phrase it as attempting nothing: the command is not in the
    script there.

  **The counts need a home that does not assume a bucket cell.** The natural
  vehicle is the Failure buckets cell (_`landMissing ×N at 4, 6, 8`_) and it
  exists on 63 of the 65 — the other **2 are the bucketless S5 rows**, which
  have no bucket cell to annotate, and all 352 of the absent-at-a-count rows
  are healthy and so carry no bucket either. So the per-count annotation is
  stated as part of the row's **reason** (the last clause of this rule), which
  every row has by construction, and rendered into the Failure buckets cell
  only where that cell is non-empty. A rule whose only carrier is a cell that
  is empty on the rows it governs is not a rule.

- **A row whose `runsContaining` is between 1 and `runs` at a count says its
  denominator.** Sec.4.2 measures **207 rows at 4 players over seeds 1–5** that
  appear in some runs of one batch and not others, on 11 maps including
  `sample.rms`, and at the default 15 runs per count that is where the
  `start_random` population lives. A rate summed over 1 of 15 runs and one
  summed over 15 of 15 print identically today and are ranked against each
  other as if measured equally. Print the run count beside the rate whenever
  `runsContaining < runs` (_"100% — generated in 3 of 15 runs"_); it is the
  same honesty Sec.5.3 already demands of the rate itself, on the axis Sec.5.3
  does not cover.

  **IMPLEMENTED, and the first implementation built the carrier and never wired
  it** — `AggregateCell.runsContaining` and `MonteCarloAggregate.runsAt()` both
  existed, `report.ts` read the first only through `cellStateOf` and the second
  not at all, so every rate printed bare. A field added for a rule is not the
  rule. Measured at the defaults (2/4/6/8 × 15), the population this governs is
  **104 of 330 rows on `13_Rings_v1.2.rms`, 40 of 476 on `AK_Namatjira.rms`, and
  2 of 8 on `sample.rms`** — tracked, so it is on every CI run's report. Sec.8
  item 3's assertion must take one of those three CORPUS cases, which is what it
  already says and which the first implementation answered with a hand-built
  two-`addGeneration` fixture.

- **The three reason populations are not disjoint, and a row in two of them says
  both.** A row can be absent at some counts and zero-attempt at others; nothing
  above prevents it and the presentation of 402 / 65 / 352 as _"three findings,
  not one"_ reads as though something did. The reporter measures the overlap at
  **0** today (`partial carrying a zero cell 0`), so this is insurance, priced
  the way this document prices its other zero-cost clauses rather than left for
  an implementer to resolve by picking one. The row states its absent counts and
  its zero-attempt counts as separate clauses of the same reason; neither
  suppresses the other, and neither may be worded as though it covered the
  counts belonging to the other.
- **Every such row still says why, in words**: from the failure buckets where it
  has them, and where it has none, from **what the stage resolved** rather than
  from the stage's identity — a `create_elevation` whose `MaxHeight` is 0, a
  connection command whose pairing came back empty (above), a cliff section whose
  `min_number_of_cliffs` exceeds its maximum (below). A row that reports neither
  a rate nor a reason is a row that should not have been printed.
- **The S3 contradiction is the SEVENTH zero-attempt path and the census above
  does not contain it.** That census enumerates `objects.ts`'s six early returns
  plus its ordinary `:1079`/`:1498` path, `elevation.ts:393` and
  `connections.ts:784`/`:858`. **`cliffs.ts:298` is another**, returning
  `{ commandSpan, stage: "S3", attempted: 0, placed: 0, failures: [] }` when
  `min_number_of_cliffs > max_number_of_cliffs` — a non-numeric rate, a
  non-numeric worst count, an empty bucket cell, and under the reason clause as
  written **no reason at all**, because that clause enumerates its causes by name
  and this is a third. It is the row this section's own rule forbids. The reason
  is _this section asks for more cliffs at minimum than it allows at maximum, so
  no cliffs are generated_, and Sec.3.4's static check reports the same
  contradiction at error severity on the same script.
- **The S3 reason keys on the note's KEY, not on a note at the row's own span,
  and copying the S5 discriminator here would work on one arm and fail on the
  other.** `cliffs.ts:282` takes the row's `commandSpan` from
  `commands[0].span`, while `:290` anchors the `cliffsMinExceedsMax` note at
  `maxCliffsCmd?.span ?? minCliffsCmd?.span`. Where the script writes only a
  minimum the two coincide; where it writes both they **differ** — a fixture
  writing `min 20` then `max 5` produces the row at `152-175` and the note at
  `176-198`. So the discriminator is _an S3 zero-attempt row in a run whose notes
  carry `cliffsMinExceedsMax`_, which is unambiguous because `applyCliffs` emits
  exactly one report for the whole section. The S5 rule stays keyed on its own
  span, where the generator does anchor the note to the row.
- **The S5 reason is conditioned on the note, because the row shape alone
  cannot tell the two paths apart.** `connections.ts:784` pushes
  `{ commandSpan, stage: "S5", attempted: 0, placed: 0, failures: [] }` and
  `:858` pushes the same bytes whenever `pairs.length === 0` — so _"the pairing
  came back empty"_, stated unconditionally over the shape, is a confident
  diagnosis of the wrong cause the first time `:784` fires, on a command whose
  pairing may be full and which was neutralised by a
  `create_connect_to_nonplayer_land` above it. **The discriminator is free and
  the tool already collects it**: `:776-786` emits
  `connectionBlockedByBug:<span.start>` **at the row's own span** beside the
  report. So: an S5 zero-attempt row carrying that note at its own span says
  the connection was neutralised by the `create_connect_to_nonplayer_land`
  above it; every other S5 zero-attempt row says the pairing was empty.
  **`:784` measures zero on this corpus and is one edit from live** — six maps
  write `create_connect_to_nonplayer_land` (`13_Rings`, `AD4 - Ra`,
  `AK_Six_Points`, `Menindee`, `TC2 - Comeer`, all tracked, and
  `TL Grand Bara`) and in **all six it is the last connect command in the
  file**, which is the whole reason the path never runs. Moving one
  `create_connect_all_lands` below it makes the row live. Pinning the sentence
  for the path that never fires and leaving the other one unpinned is the
  position this subsection found the previous revision in.

**The suppression rule above meets this one, and their intersection is a row
with nothing in it — on 4 rows, not on 242.** 242 of the 467 carry
`actorAreaMissing` and nothing else, and suppressed, such a row would have no
rate **and** no bucket: an entity name beside four empty cells. But the
suppression keys on a **present** Sec.3.2 finding, and measured by `(map,
referenced id)` the 242 decompose **220 / 18 / 4** — 220 are the
declared-but-not-live case Sec.3.2 explicitly leaves to this layer (`Menindee`
2300 ×18, `QS_Three_Bays` 20 ×26 and 2800 ×16, `Chaotic_Strait` 2800 ×13,
`AK_Namatjira` 1501 ×12, `Pa_Site` 7001 ×9, and a long tail), **18** are
`AK_Vanguard`'s non-numeric id, which Sec.3.2 abstains on and the last clause of
this section exists to protect, and **4** are Sec.3.2's four corpus findings:
`Menindee` 1000 and `Pa_Site` 81, 82, 91. **So the suppression reaches 4 rows
here** — and _4 rows_ and _4 findings_ are the same number here only because
each of those four findings is a **single** row, which the decomposition states
rather than the count implying it: the 242 split by `(map, referenced id)` into
**86 distinct pairs**, exactly one of them non-numeric (`AK_Vanguard|?` ×18),
and the four Sec.3.2 ids carry one row apiece, and the rule must not touch the other 238. It is still right, and it is
insurance of the kind this document prices honestly elsewhere — the shared-block
reference clause (_"adds 0 findings on this corpus"_), rule 4 (_"both finding
rows byte-identical"_) — so it is priced rather than left standing beside the
largest number in the paragraph. Where it does fire, the suppression
**replaces** the bucket rather than deleting it: the cell says the static layer
has already reported this command, which is what the suppression asserts
anyway. A suppression that empties a row is not a suppression; it is a silent
drop, and Sec.3.2's own reasoning about `AK_Vanguard` is that a row nobody can
read is the same as a finding nobody made.

#### The Failure buckets column states its domain in the same sentence as its formula, because it shares the rate's denominator and had no domain at all

**A domain stated for one column is owed to every column that shares its
denominator** — this subsection's own rule for the Spawn rate cell, applied to
the row above it and to nothing else. The buckets cell can be read as the worst
count's (matching the rate beside it) or as the matrix union (matching Sec.4.2's
per-count merge summed for display), and the per-count annotation the
zero-attempt rule adds (`landMissing ×N at 4, 6, 8`) is a third reading written
into the same cell. Three readings, no stated domain, and the cell is the
**evidence for the fraction printed beside it**.

**Measured over the 32 maps × 2/4/6/8, Normal, seed 1, per aggregated row,
worst count taken under the corrected three-state rule above** — so the
population is the **7891 rows that print a numeric rate** (the 467 marker rows
have no rate for a bucket cell to be the evidence for):

**The unit is `occurrences`, not records, and this document got that wrong once
already.** `PlacementFailure` has no `count` field — it carries
`occurrences?: number` (`types.ts:372`, _"Absent means one"_), because
`pushFailure` coalesces by bucket as records are made. The Failure buckets cell
renders that number (`occupancyFull ×140`), so every figure about what the cell
prints must be occurrence-weighted. A probe written against `failure.count`
silently reads `undefined ?? 1` and counts **records** instead, and Vitest
transpiles without typechecking, so nothing goes red — which is exactly how the
first measurement of this subsection was taken. **Both readings are published
below and both are pinned in Sec.8's reporter**, because this document's own
rule is to pin a counting convention rather than let one be inferred.

|                                                                                     | records                   | occurrences (what the cell prints) |
| ----------------------------------------------------------------------------------- | ------------------------- | ---------------------------------- |
| numeric-rate rows carrying at least one failure somewhere in the matrix             | **2498**                  | **2498**                           |
| of those, rows where the bucket **set** differs between the two readings            | **191**                   | **191**                            |
| rows where the bucket **counts** differ                                             | —                         | **2306**                           |
| summed failure totals, worst count vs matrix union                                  | **2833 vs 10647 — 3.76×** | **2 026 194 vs 8 105 519 — 4.00×** |
| rows where the matrix-union total **exceeds the `Σ attempted` the rate divides by** | **462**                   | **803**                            |

The last row is the one that prints as nonsense rather than as ambiguity.
`13_Rings_v1.2.rms` (**tracked**) `create_terrain LOWER_HILLTOPS { base_terrain
BASE_TERRAIN land_percent 100 number_of_clumps 4056 height_limits 1 1 }` at
`:128660` is `attempted 3, placed 3` at **every** count — the row reads
**"100.0%"** — and carries `growthShortfall ×3, iterationCapped ×1` at each, so
the cell prints **4 occurrences** under the worst-count reading and **16** under
the union, beside a denominator of **3**. On 191 rows the union reading also
**names a bucket that never fired at the count whose rate is printed**, which is
the "confidently wrong" register this document ranks below `NaN%` only because
the number is smaller.

**One honest qualification on the 803, because it is two defects wearing one
number.** An occurrence total can exceed `Σ attempted` without any domain error
at all: `growthShortfall` counts **tiles short of a budget**, not failed
placement attempts, so 4 occurrences against 3 attempts is a unit mismatch
rather than a widened domain — visible in the exemplar above at its own worst
count. The domain finding does not rest on that row: it rests on the **191**
rows whose bucket _set_ differs and the **2306** whose counts do, where the two
readings disagree about the same command in the same unit. The 803 is worth
printing because a cell that can exceed its neighbour's denominator by either
mechanism needs its domain stated either way, and Sec.8's assertion is scoped
accordingly (below).

**So: the buckets are the worst player count's, the same domain as the rate.**
The per-count annotation for rows that are zero or absent at some counts is an
explicit, separately-worded **exception** — those rows print no percent, so
there is no denominator for the cell to disagree with, and the whole point of
the annotation is that one cell must describe several counts. Where a user
wants the matrix-wide totals they are a summary-header figure (Sec.5.2), not a
silent widening of a column that sits beside a percentage.

**`minExceedsMax` is the Monte Carlo twin of Sec.3.4's only surviving static
check, and the pairing is a fixture obligation rather than a corpus one.** The
static layer reports that comparison at **error** severity; the same command
reaches this table through `objects.ts:1417` with `attempted: 0`. On this corpus
neither fires — Sec.3.4 measures 0 findings and the bucket contributes 0 of the
462 — so the two layers' treatment of one command is pinned in Sec.8 item 1 or
not at all.

#### No S3 report has a command, and testing for `{0,0}` catches the 2 maps where the borrow failed while missing the 5 where it succeeded

**`commandSpan` is `{ start: 0, end: 0 }` on a real row of a real report, so
"the source slice is the one that always exists" — this section's own former
reassurance — is false.** `cliffs.ts:282` reads
`commands[0]?.span ?? ZERO_SPAN`: `<CLIFF_GENERATION>` has no `create_cliff`, so
S3 emits **one report for the whole section** and borrows the first standalone
attribute's span. When the section is present but instantiates to zero commands
there is no span to borrow, and `applyCliffs` returns early only when the section
is **absent**, so the report is emitted anyway.

**Measured over the 32 maps at 4 players / Normal / seed 1: the section is
present-but-empty on 2, and one of them is tracked** — `sample.rms` and
`24hr_Holler.rms`. Both produce `{ commandSpan: {0,0}, attempted: 4, placed: 4,
failures: [] }`. Three more maps look empty in the text and are not: `Mont Saint
Michel`, `AK_ForeDaut_v1.3.rms` and `AK_Namatjira.rms` write
`/* <CLIFF_GENERATION> */`, so the section is absent and the early return fires.

**An empty `<CLIFF_GENERATION>` header is the idiom for default cliffs**, not a
degenerate script — this repo's own RMSTEST batch generated cliffs exactly that
way (`docs/build-log.md`, the 4.3 calibration entry), and the numbers above are
four real cliffs placed successfully. So the row is a healthy row about real
cliffs, and both prescriptions above mishandle it: `source.slice(0, 0)` is `""`,
and the `entity` fallback is conditioned on the row _having_ failures, which is
the one thing a healthy row does not have.

**The rule, and the predicate is the STAGE, not the span.**
`start === 0 && end === 0` is what a **failed borrow** looks like, not what a
**borrowed span** looks like. `cliffs.ts:282` reads
`commands[0]?.span ?? ZERO_SPAN` unconditionally and `applyCliffs` emits exactly
one report for the whole section on every path it takes, so **no S3 report has a
command of its own by construction** — whether or not the borrow found something
to take. `{0,0}` is only the subset where the section was empty; where it is
non-empty the borrow **succeeds**, and succeeding is what makes it invisible.
Measured over the 32 maps at 4 players / Normal / seed 1, the parse's answer
rather than a grep's:

| `<CLIFF_GENERATION>` | maps  | what a `{0,0}` test gives the row                                                      |
| -------------------- | ----- | -------------------------------------------------------------------------------------- |
| absent               | 25    | no report at all                                                                       |
| present, 0 commands  | **2** | `rowSpans` `null` + stage label — caught                                               |
| present, ≥1 command  | **5** | the first standalone attribute's own line, presented as a per-command row — **missed** |

The five, with the line the Command column would carry: `24hr_Bazi is God.rms`
and `Pa_Site_v1.1.rms` (`cliff_type CLIFF_TYPE`),
`OWWC1Tewaipounamu-edited-v1.2.rms` (`min_number_of_cliffs 5`),
`AK_Six_Points_v1.4.rms` and `QS_Three_Bays_v1.1.rms`
(`min_number_of_cliffs 21`). So the Cliff table's one row reads
**`min_number_of_cliffs 21`**, carries the whole section's attempted/placed/
failures, and clicking it jumps the Code tab to that attribute.

**The missed case is the worse one, and this document's own hard rule is why.**
The `{0,0}` case fails loudly at offset 0. This one points a person at _a_ real
place, one that is even inside the right section — so it looks correct, it reads
as a per-command row in a table whose every other row is a per-command row, and
there is nothing for a reader to notice. That is the RMS03xx _"already set at
offset 86970"_ shape with the diagnostic pointing at a plausible neighbour
instead of at nothing.

**So the rule is stated on the stage: S3's row always takes its Command label
from the stage** ("Cliff generation (whole section)"), on every map, because S3
has no per-command report to label. `rowSpans` **keeps** the borrowed span where
the borrow succeeded — it is a real offset inside the right section and jumping
to it is useful — and carries **`null`** where it failed. `null` per row is
legal and documented; this is what the `| null` in `(Span | null)[]` is for. The
`{0,0}` test does not disappear, it changes job: it becomes the **backstop
assertion** in Sec.8 item 2 rather than the rule.

**The general shape, because this is the fourth round in a row on it.** A number
computed for one deadline was checked against one of the two it bounds; a fork
applied to tier 1 was owed to tier 2; a table was corrected in its warning row
and inherited in its info row; and now a fix was written against the case where
a borrowed value came back **empty** rather than against the borrowing itself.
**When a finding is "this value came from somewhere else", the fix belongs on
the borrowing, not on the one borrow that returned nothing.**

Scoped deliberately, so the fix does not spread: `terrains.ts:377` and
`cliffs.ts:186` also mint `ZERO_SPAN`, both as helper defaults their callers
overwrite with `cmd.span`. Those are fine. `cliffs.ts:282` is the one with no
caller behind it.

**Static findings (Sec.3) render as their own blocks, with a `span` and
provenance stated in the text** (`"the exact terrain table"` / `"this object's
terrain category"` / `"declared land area is N%"` / etc., per Sec.2/Sec.3.5) —
**not** folded into the Monte Carlo table's rows, because a static finding has
no spawn rate or run count to put in those columns, and forcing one shape onto
both would either invent numbers for the static half or drop the click-through
span for the finding half.

#### The unit of a static finding, pinned three ways, because there are three of them and this document was using all three

**"One `severity` block per finding" was the rule for four revisions and never
said what a finding is, and the answer differs by a factor of 124 depending on
which section you read it out of.** Measured on `Pa_Site_v1.1.rms` at 4 players
/ Normal / seed 1, the undeclared-`avoid_actor_area` population is:

| unit                                     | `Pa_Site` | what reads it                                                              |
| ---------------------------------------- | --------- | -------------------------------------------------------------------------- |
| attribute **occurrence**                 | **253**   | the renderer, one table ROW each                                           |
| distinct **(map, id)** pair              | **134**   | Sec.3.2's own counting-convention paragraph, and `npm run measure:checker` |
| **command**                              | **8**     | Sec.3.2's census table's second column                                     |
| **family** — one `(kind, severity)` pair | **1**     | the renderer, one `severity` + one `table`                                 |

None of the four is wrong; leaving the choice implicit is. **Pinned: the
occurrence is the ROW unit, the `(map, id)` pair is the CENSUS unit, and the
FAMILY is the BLOCK unit.** Sec.3.2's convention is unchanged and is not a
rendering rule — it never was, and reading it as one is what left Sec.5.1 free
to pick a different one silently.

#### A finding identical at every selected count collapses to ONE block, and the count is carried on the finding rather than in its sentence

**Sec.3.0 rule 1 runs the whole static layer once per selected player count, and
nothing collapsed the result.** Measured over 2/4/6/8 at seed 1: `Pa_Site`'s
**1024** static blocks are **256 distinct, each appearing exactly four times**;
`24hr_Bazi is God` is 216 × 4; `Chaotic_Straitv0.99` 19 × 4; `Menindee` 1 × 4.
On this corpus **every** static finding is identical at all four counts.

Only Sec.3.1's finding ever carried the count in its own text, **and Sec.3.1 is
the section that proves it need not**: _"The per-player-count arithmetic cancels
exactly… the sum is player-count invariant."_ So the layer ran it four times and
printed four blocks differing only by the words _"At 2 / 4 / 6 / 8 players"_ in
front of one identical percentage.

**The rule: `playerCount` is a FIELD on the finding, never an interpolation into
its text, and the renderer prints it only when the finding does not hold at every
selected count.** Collapse on the identity `(kind, severity, text, span,
commandSpan)`; a group covering the whole selected matrix renders with no count
clause at all, and a group covering a subset prefixes `At 2, 4 players: `.
`runStaticChecks` stamps the field on the way out so no individual check can
forget it, and `checkLandOverAllocation` now takes no player count at all —
Sec.3.1's cancellation argument says it has no use for one, and the argument had
been true while the sentence quietly depended on it anyway.

**IMPLEMENTED** (`report.ts`'s `collapseStaticFindings`, `staticChecks.ts`'s
stamping `map` in `runStaticChecks`). The subset clause has **no corpus
constituency today** and is written anyway, because it is what makes the
collapse honest rather than lossy: without it, a finding that really did hold at
only two of four counts would render as though it held at all of them.

#### Every location this report names in PROSE is a LINE NUMBER

`span` stays a character offset, because Monaco and `useSharedSelection`
consume it; the `Location` cell a person reads and then acts on is
`line N`, via `lineNumberOfOffset` (`src/parser/lineIndex.ts`). Both tables
carry both: the prose column says the line, the `rowSpans` entry beside it
carries the offset, so the click-through is unchanged.

This is the standing repo rule, and the first implementation of **both** tables
broke it — they rendered `offset 40`, a position no editor displays, which is
the exact defect seven RMS03xx diagnostics shipped to a release with.
`scriptStats.ts` is the exemplar and had it right from the start, one directory
away. **A rule that already has an exemplar in the same folder is not
self-enforcing**, which is the only interesting thing about this one.

#### A row with nothing to say about it is hidden by default, and the count of hidden rows is always printed

**The finding tables run to hundreds of rows and almost all of them are
healthy** — `24hr_Petra` 608 rows, `AK_Namatjira` 476, `13_Rings` 330 — so the
findings this tool exists to surface arrive below a screen or more of commands
that worked. A report nobody scrolls to the bottom of has hidden the thing it
was run to find, which is a worse failure than a report that is too short.

**`hideHealthy` (Sec.6, default ON) drops a row only when there is nothing
whatsoever to say about it**: every player count where the command exists is
rated, placed everything it attempted, and carries no failure bucket, no stage
reason and no per-count annotation. Strict on all four, because each of the
others is a finding in its own right:

- a **zero-attempt** count has no rate at all and ranks below every rate;
- a **failure bucket** is the report's primary evidence — and note that **a row
  at 100% with a bucket is not healthy**: it placed everything eventually,
  having missed on the way, which is precisely the intermittent case a
  Monte Carlo layer exists to find and a filter keyed on the rate alone would
  erase;
- a **stage reason** is one of the seven bucketless zero-attempt paths;
- an **annotation** says the command is absent at some counts, a fact about the
  script that no spawn rate can express.

**The hidden count is printed unconditionally, including when it is zero.** A
filtered table and an empty one are different claims, and a reader who cannot
tell them apart has been told the script is clean when it was only quiet — the
same never-silently-drop rule the rest of this project runs on. Printing it at
0 as well is deliberate: the sentence's _absence_ must never be what carries
the information.

#### A family of many findings is one `severity` plus one `table`, which is the ONLY shape with a bound

**The tool's output was rejected by its own host on an ordinary corpus map.**
`Pa_Site_v1.1.rms` produced **1026 blocks** at the default matrix against
`LIMITS.maxBlocksPerOutput`'s **1000** (`tools-api/index.ts`); `protocol.ts`
returns _"output has 1026 blocks, over the 1000 cap"_, `host.ts` logs a
`Protocol error` and calls `finish(run, { reason: "protocol" })`, which sets
`run.terminated` and drops every later message. On a full run the tool died at
the **first** `partial`, one batch of four in. **The user got nothing at all —
not a truncated report — on the map this document cites by name 27 times.**

**Neither multiplier was in any cap arithmetic**: the cross-count duplication
above, and one block per attribute occurrence. Collapsing the counts alone takes
`Pa_Site` to 258, which is legal and still absurd — 253 near-identical sentences
about one script.

**So the block unit is the family.** One `(kind, severity)` pair renders as one
`severity` block whose text states the family and its size, plus one `table`
with a `Location` and a `Finding` column and one clickable `rowSpan` per
occurrence. `(kind, severity)` and not `kind` alone, because
`actorAreaUndeclaredSharedBlockReference` files at `error` or `info` depending on
which attribute carried the reference, and a `severity` block carries exactly one
level. A family of one renders as the bare `severity` block it always was.

This is the shape Sec.5.4 argues for one section down and on the same ground:
`severity` holds one span and `table.rowSpans` holds many, so a group of N
findings cannot keep its click-throughs in a single block. It is bounded by
`maxTableRowsRendered` (**10,000**) instead of `maxBlocksPerOutput` (**1000**) —
253 rows is under that by a factor of 40.

**The bound this gives Sec.4.5 is a constant rather than a measurement**, which
is the point: **seven finding kinds × at most two severities × two blocks each,
plus one heading — at most 29 blocks from the static layer whatever the script
says.** Measured after the fix, the worst map in the corpus is `Pa_Site` at
**6 blocks** for the whole static pass (heading, two families, and the summary
header), and **0 of 32 maps produce output the host rejects**.

**IMPLEMENTED** (`report.ts`'s `buildStaticFindingBlocks`).

**The gate is a corpus walk through `validateToolMessage`, and it has to be,
because NEITHER multiplier alone reaches the cap.** With the collapse removed
`Pa_Site` sits at 258 blocks and with the family shape removed it sits at 256 —
both legal, both absurd, and both green under any block-count assertion. The
1026 is the product. So the unit tests pin each rule separately (one block for a
finding identical at every count; one `severity` plus one `table` for a family
of 253) and the corpus test asserts what the HOST asserts, over
`test-maps/*.rms` read **from disk** rather than by name — 11 files on a clone,
32 on a maintainer's disk, and `staticOnly` keeps it to one AST pass per count
per map. Mutation-tested: with both rules removed the corpus test goes red on
exactly `Pa_Site_v1.1.rms` and nothing else.

**Suppression, so the two layers never double-report one command.** A command
already carrying a Sec.3.2 "undefined actor area" static finding is excluded
from the Monte Carlo table's `actorAreaMissing` bucket for that same
`commandSpan` — the static finding subsumes it (guaranteed-every-run implies the
Monte Carlo row would carry the same empty rate and the same single bucket on
every one of N runs and add nothing).
The reverse is not suppressed: a command with **no** static finding can still
show `actorAreaMissing` misses from the declared-but-sometimes-unplaced case
Sec.3.2 explicitly leaves to this layer.

**The suppression is scoped to the `actor_area_to_place_in` finding only, and
saying so costs one clause.** `actorAreaMissing` is pushed for that attribute
alone; an undeclared `avoid_actor_area` places normally and produces no bucket
at all, so there is nothing for its info finding to subsume. Wiring the
suppression to "any Sec.3.2 finding on this span" would silently hide real
`actorAreaMissing` misses on any command that also carries a dead `avoid`
line — 30 commands on this corpus.

**The same shape governs terrain, and this is the second place the two layers
answer adjacent questions.** `terrainAbsent` is the Monte Carlo layer's and it
means _the script never lays this terrain down_; Sec.3.3's tier 1, where the
command names a terrain, means _the engine's table refuses this pairing_. Only
the second may carry the _"the exact terrain table"_ provenance, and rev 6
printed the first under that label twice out of a total output of two. No
suppression is needed in either direction — they are different findings about
different data and a script can legitimately produce both — but a static finding
and a `terrainAbsent` row on the same `commandSpan` must never be worded as
though one confirms the other.

**The suppression keys on a finding, never on a script Sec.3.2 abstained on,
and this is the clause that keeps the corpus's clearest actor-area defect
visible.** Sec.3.2's unresolvable-reference rule leaves
`AK_Vanguard_v1.2.rms`'s 18 `actor_area_to_place_in
ACT_AREA_TEAM_RES_TERRAIN` commands to this layer deliberately: they place
nothing **and attempt nothing**, so under the zero-attempt rule above the Monte
Carlo table reports them with no rate at all — the non-numeric cell — and an
`actorAreaMissing` bucket, and **that bucket is the only thing in the app that
names the problem**. (These 18 are exactly the 18 non-numeric-id rows of the 242
above, which is why the bucket has to survive the suppression: it is carrying the
whole finding.) A suppression phrased as "commands Sec.3.2 has an opinion
about" would erase it, since Sec.3.2 abstained on the whole script and
therefore has no opinion at all. Suppress on a **present** finding for the
same `commandSpan`, never on the check's abstention.

### 5.2 Summary header

A `keyValue` block first: player counts run, **map size**, `runsPerPlayerCount`,
`baseSeed`, total generations, elapsed time, and the approximate-preview
disclosure — reusing the pane's own existing wording convention
(`ui-help.json`'s `preview.*` entries) rather than inventing new copy, per
Sec.5's settings-echo convention already established for other tools
(`tools-api-design.md` Sec.5).

**`mapSize` is in that list because suppressing the pane's echo removes the only
thing in the UI that names it**, and a header that replaces an echo has to carry
what the echo carried. Read it from the run's own snapshot of
`ctx.settings.mapSize.name`, never the live context — the same reason this
section gives for the player count, one row down. It matters on this corpus:
**11 of 32 tracked maps change their instantiated command set with the map size**
(measured across all seven sizes at 4 players, Sec.3.0's table), and Sec.4.4's
own budget moves 1.2–1.6× on the same axis. A spawn-rate table generated at Tiny
and read as though it were
Normal is exactly the stale-result failure the echo exists to prevent, reproduced
by the fix for it.

**"Elapsed" is the WHOLE run's, and in the one mode where the static layer is
the whole run the first implementation reported `0.0s`.** The clock starts above
Sec.3.0 rule 1's static loop, not below it: with `staticOnly: true` there is no
Monte Carlo layer to time, and on `Pa_Site_v1.1.rms` that pass walks the AST once
per selected player count. A header row that reads `0.0s` for real work is the
same class of claim as Sec.5.4's `(0 places)` — a number that is not merely
imprecise but says the opposite of what happened.

**The pane prints its own settings echo above this, and for this tool it is
wrong twice.** `ToolsPane.tsx` renders `Run at {generation.playerCount} players,
{generation.mapSize}` above every tool's output, to keep a stale result
self-describing. For a tool whose report _is_ a 2/4/6/8 matrix it names one
player count the report is not about; and it reads the **live** generation
context rather than the run's snapshot, so changing the player count after a run
re-labels a finished report with a setting it was never run at — the failure the
echo exists to prevent, produced by the echo. **The pane suppresses its echo
when the running tool declares its own header, and the declaration is a
manifest flag — `ownsSettingsHeader: true`, in Sec.6's block below.** "A
manifest flag or an equivalent check on the output's first block" was two
designs and neither of them got written into the manifest; sniffing the first
block would make the pane's chrome depend on a tool's output shape, which is
the coupling a manifest exists to avoid. **Fixing the live binding itself is
5.1's and is now filed as `docs/known-issues.md` BUG-014** rather than riding
along this tool — the flag hides the defect for one tool and leaves it for
every other one.

### 5.3 "Worst" is a claim about this run, not the map

The header states plainly that spawn rates are **estimates from
`runsPerPlayerCount` samples**, not exact probabilities — a command showing
100% at `runsPerPlayerCount: 5` is not proven reliable, only unobserved-to-fail
in five draws. No confidence interval is computed in v1 (out of scope, Sec.1);
the honest mitigation is stating the sample size beside every rate, which the
summary header already does.

### 5.4 Notes passthrough

`SimulationNote`s accumulated across the Monte Carlo runs stay visible here
exactly as they are in the pane, rather than this tool silently re-deriving its
own opinion about what it could not check. **How they are grouped and what they
render as are two decisions, and an earlier revision got both wrong in the same
sentence** ("deduped by `key`… as a final `text` block").

**Group by TEXT, not by `key`.** S0's dominant note is
`unsimulated:${span.start}-${span.end}` — keyed **per span** — so a dedupe by
key never merges two of them. Measured at 4 players / Normal / seed 1:
`Pa_Site_v1.1.rms` produces **134** of them, `OWWC1Tewaipounamu-edited-v1.2.rms`
18, `TL Cape of Storms.rms` 15, `W4 - Immersion.rms` 7 — every one a distinct
key and every one the same sentence. The prescribed rendering was 134 identical
lines. Group by text, carry the **count** and the **spans**.

**Those four figures are one note family, and the rule governs every family.**
Over **all** notes at the same settings, the largest same-text groups are
`Pa_Site` **134** (`unsimulated`), `AK_Namatjira` **77**
(`terrainMaskApproximated`), `QS_Three_Bays` **69** (tile-shuffling
determinism), `Pa_Site` **43**, `24hr_Caverns` **38** and `TC2 - Comeer` **36** —
**76 groups above three notes across 28 of the 32 maps**, every one keyed per
span and every one rendering as N identical lines under a dedupe by `key`. Notes
per map reach **184** (`Pa_Site`, 6 distinct texts), 138 (`AK_Namatjira`, **24**
texts) and 132 (`QS_Three_Bays`, 17). The rule is unchanged; its reach is roughly
three times the four rows above, which is what makes the block shape below a
constraint rather than a preference.

**Emit a `severity` block per group PLUS a `table` carrying that group's spans —
not one `text` blob, and not one span-carrying block per group either.**
`OutputBlock`'s `text` kind carries **no span** (`tools-api/index.ts:317-326`),
so the `text` rendering throws away the one field that would let a user click
through to the part of their script the preview skipped. But `severity` declares
`span?: Span` and `codeRef` declares `span: Span` — **one each** — and `table`'s
`rowSpans?: (Span | null)[]` is the only member of the union that holds many. So
"group by text, carry the spans" and "emit `severity`/`codeRef`" are not jointly
satisfiable at one block per group: such a block keeps one of `Pa_Site`'s 134
spans and drops 133, which is the click-through this paragraph exists to
preserve, preserved for 1 of N; and one block per span reproduces the
identical-lines defect the grouping rule exists to remove, as `codeRef`s instead
of `text`. **The shape is the one Sec.5.1 already uses for exactly this job**: a
`severity` block carrying the group's text, its count and its covered fraction,
followed by a `table` whose `rowSpans` carries the group's spans one per row —
bounded by `maxTableRowsRendered` (10,000) rather than by `maxBlocksPerOutput`
(1000), and `rowSpans` must have exactly `rows.length` entries (Sec.5.1).
**A group whose notes carry NO span emits the `severity` alone — there is no
table, because there is nothing to put in it.** `SimulationNote.span` is
optional (`types.ts:307`, _"Absent for run-level notes"_) and the corpus is
full of them: measured at 4 players over the 32 maps, **338 same-text note
groups, of which 29 carry no span at all**, spread over **24 of the 32 maps**,
and no group is mixed — the automatic-beach note (18 groups), `includes`
(_"depends on include files the preview cannot see"_, 6),
`landOverwrittenBeforeGrowth` (4) and `teams` (1). Prescribed without this
clause, the shape above emits an empty `table` on three quarters of the corpus,
in the section whose own argument is that a block carrying nothing is worse
than no block. Sharper still: the family this section gives its **other** new
rule to — the range rule below, written about `landOverwrittenBeforeGrowth` by
name — is **entirely spanless**, so the section's two rules meet on a block
with nothing in it.

Those spans are exactly Sec.3.0b's blind spot — the shared blocks whose
attributes no check can read — so keeping them is what lets the report say
_this finding sits next to a block the preview could not read_, which is the
whole reason a notes passthrough is worth having rather than a disclaimer.

**Carry the COVERED FRACTION beside the count, and it is the one line that
turns a silently-empty report into an honestly-empty one.** The spans are
already in hand and the script's length is `ctx.parseResult.source.length`, so
_"these spans cover N% of the script"_ is arithmetic over data this block
already holds. It exists because of `Rage Forest 2026.rms` (Sec.3.3's `RawNode`
subsection): the tool's entire output on that map today is six empty tables plus
one `SimulationNote` reading _"This part of the script isn't simulated in the
preview."_ — no count, no fraction, no indication that the span it carries is
**71% of the file**. A user reads a clean report on a script the tool read 29%
of, which is goal 1's failure mode arriving through silence rather than through
a wrong number. Print the fraction whenever it is non-trivial, and treat a large
one as the headline rather than a footnote.

**"Arithmetic over data this block already holds" was the wrong prescription in
two independent ways, and one of them prints 1418%.** The naive reading — sum
the group's span lengths, divide by `source.length` — is what that sentence
licenses, and both of its defects come from the same place: **every figure in
this subsection was measured at one generation while this subsection's own
opening sentence says the notes are accumulated across sixty.** Measured over
2/4/6/8 × seeds 1–5 (20 runs, a third of the default):

| map                                 | 1 run, naive | 20 runs, naive | 20 runs, spans merged |
| ----------------------------------- | ------------ | -------------- | --------------------- |
| **`Rage Forest 2026.rms`**          | 70.9%        | **1418.1%**    | 70.9%                 |
| `QS_Three_Bays_v1.1.rms`            | 55.3%        | 1099.7%        | **41.9%**             |
| `24hr_Caverns.rms`                  | 53.6%        | 1053.6%        | **41.1%**             |
| `Chaotic_Straitv0.99.rms` (tracked) | 44.3%        | 885.8%         | **34.2%**             |
| `TC2 - Comeer v1.4.rms` (tracked)   | 39.0%        | 827.2%         | 37.4%                 |

**THIS TABLE IS PER MAP AND `coveredFraction` IS PER GROUP, and the two are
different numbers on every map with more than one note group.** The column
reads the union of **every** group's spans on the map; the field the paragraph
above prescribes is one group's. Re-derived on this table's own population:
`QS_Three_Bays` is **41.9% as a per-map union and 30.8% as its largest single
group**, `24hr_Caverns` **41.1% and 16.9%**, and `Chaotic_Straitv0.99` — tracked,
so it is the CI-visible one — **34.2% and 16.0%**. **All five of this table's
merged figures reproduce to the unit** under the union reading and none of them
under the per-group one; the table is the union.

**Re-taken at the real defaults the union grows slightly and the per-group
figure does not move at all** — `QS_Three_Bays` goes 41.9% → **42.8%** over
2/4/6/8 × 15 while its largest group stays at 30.8%. That is the shape a
correct merge has to have: a union over more runs can only grow, it is bounded
by 100% by construction, and the growth is the handful of spans 60 generations
reach that 20 do not. Against the naive sum's **1099.7%** on the same map, the
distance between "bounded and slightly larger" and "unbounded and eleven times
larger" is the whole of the fix. They coincide on `Rage Forest`
(70.9% both ways) because it has one dominant group — **which is the same map,
and the same coincidence, that made the 1418% invisible for three revisions.**
Nothing in the table is wrong; what was missing is the sentence saying which
population it counts, in a table sitting directly under the prescription for
the other one. _An unpinned population is reproducible only by accident_, for
the fourth time in this document — and the tell each time is a figure quoted
one paragraph away from a field it is not measuring.

**Across runs the sum multiplies by the run count**, because the same span is
re-emitted every generation and nothing deduped it. **Within one run the spans
overlap**, so even the per-run sum overstates — 55.3% against 41.9% on
`QS_Three_Bays`, 53.6% against 41.1% on `24hr_Caverns`. **The second defect is
why the first was invisible, and the map that motivated the clause is the single
case that does not exercise it**: `Rage Forest`'s 70.9% is the one figure the
naive arithmetic gets right at one run, because its two raw nodes happen to be
disjoint, so the number this section argues from is the number its own
prescription cannot get wrong.

**The fraction is over the MERGED UNION of the group's spans, deduped and
overlap-collapsed, never their sum.** Sort the group's distinct spans by start,
merge overlapping and adjacent ones, sum the merged lengths, divide by
`source.length`. It is bounded by 100% by construction, which the sum is not,
and a fraction that can exceed 100% is a number no reader can act on.

**The `table` beside it carries the DISTINCT spans, one row each.** `Pa_Site`'s
`unsimulated` group is 134 spans at one run and **2680 rows** at 20 under the
naive accumulation, carrying the same 134 spans repeated — a table whose row
count is a function of the run count is reporting on the tool's settings rather
than on the script.

_Two figures about the same file measure different things and agree by
coincidence, which is worth one sentence so nobody derives one from the other._
Sec.3.3's 70.9% for `Rage Forest` is a parse-time figure over `RawNode`
extents; this one is a run-time figure over `unsimulated` note spans. They
coincide on that map because the raw nodes are exactly what S0 declines to
simulate. Neither is computed from the other and a map where they diverge is not
a defect.

**A group whose notes carry no span has no covered fraction, and the spanless
clause above exempted the `table` without exempting the number.** The `severity`
block for such a group carries its text and its count and stops there. 29 groups
at one run, 177 at 20.

**And a group's COUNT is its distinct occurrences, not its span count — those are
the same number only when every note in the group carried a span.** The first
implementation's only counter was the span map, so a spanless group rendered
`"no teams in this lobby (0 places)."` — on 24 of the 32 maps, `sample.rms`
included, so on every CI run. **It is goal 1 in miniature**: a true note
delivered with a false number welded to it, in the passthrough whose whole
argument is that the tool does not re-derive its own opinion about what it could
not check. Saying _"this happened in 0 places"_ about something that happened is
a stronger claim than saying nothing, and it is the wrong one.

**"Places" is a claim about spans, so a spanless group does not make it.** Count
spanless occurrences per **KEY**, not per `(key, text)` bucket, and render a
spanless group as its bare text when the count is 1 and `"… (N times)."` when
more than one key produced the same sentence. Rendering `"(1 place)"` for
something with no place is the same category of false claim as `"(0 places)"`,
one unit over.

**Per key and not per bucket, because the obvious fix over-counts by the run
count on the corpus's own commonest spanless note.** `sample.rms`'s
`automaticBeach` is one key, no span, with a tile count interpolated into its
text — over the 60 default generations it produces **14 distinct texts**, which
step 1 has already collapsed into one ranged entry. Counting the buckets reports
**14 occurrences of a thing that happened once and is being reported once**;
counting the key reports 1. **This is the same rule as the span dedupe below —
a count that tracks `runsPerPlayerCount` is reporting on the tool's settings —
arriving on the branch that has no span to dedupe by**, which is why the two
have to be decided together rather than one at a time. The `(key, text)` bucket
is the right unit for spans and the wrong one for a count.

**And a MIXED group — some occurrences spanned, some not — says "times" as well,
because "places" counted over a mixed group over-claims by exactly its spanless
occurrences.** This section measures **no** mixed group on the corpus, so the
branch is insurance, priced the way this document prices its other zero-cost
clauses rather than left for an implementer to resolve by rounding it into the
larger case.

**IMPLEMENTED** (`aggregate.ts`'s `TextBucket.spanless`, folded per key at the
range collapse; `report.ts`'s `countClause`).

#### Grouping is an ORDERED pipeline across runs, and stating the two rules separately is what let the texts multiply

**Group by `key` first, collapse same-key/different-text into a range, then
group by text, then dedupe spans within the group.** The two rules below existed
before this ordering and were written as independent prescriptions, which is the
whole mechanism of the figures above.

**The fourth step is the one the pipeline is named after and the one the first
implementation left out, and it is not a rounding error.** Steps 1 and 3 both
CONCATENATE — the range collapse joins every text's spans under one key, and the
text grouping joins every key's spans under one sentence — so with spans deduped
only per `(key, text)` bucket, a span reappears **once per distinct text its key
produced**. Measured at the defaults (2/4/6/8 × 15 = 60 generations, the rate this
subsection's own opening sentence names): `AK_Namatjira.rms` **23 of 30** groups
inflated, worst reading `count = 58` for **one** span with a 58-row table beside
it; `24hr_Petra.rms` 20 of 32; `13_Rings_v1.2.rms` 7 of 22. That is verbatim the
shape this section already filed — _"a table whose row count is a function of the
run count is reporting on the tool's settings rather than on the script"_ —
surviving because only the arithmetic half of the fix landed.

**The dominant corpus mechanism is exactly the one the range rule exists for**,
which is why the two rules have to be read as one pipeline rather than two
prescriptions. `unsimulated:<span>` keys carry a constant text, so the
`(key, text)` bucket already catches them and `Pa_Site`'s 134 really does render
as 134. What survives is every key whose text interpolates a per-run number — the
`create_terrain` clump family, `terrainMaskApproximated` — 23 of
`AK_Namatjira`'s 30 groups. **The range rule and the dedupe rule meet on the same
note, and a fixture that exercises one cannot see the other**: a range fixture
with no span makes the concatenation invisible, and a dedupe fixture with one
text never reaches the range branch. The regression test carries the SAME span
under texts that differ by a number, across several runs, and asserts
`count === 1`. **IMPLEMENTED** (`aggregate.ts`, step 3 before the covered
fraction, which was already merging correctly and is why the defect stayed
invisible: `coveredFraction` was verified and `count` was not).

**A note whose text differs across runs sharing one `key` is reported as a
range.** `landOverwrittenBeforeGrowth` interpolates _"N lands are missing from
this preview"_, and N varies across 60 runs — grouped naively, the report shows
whichever run got there first, presented as if it described the run. Report
"2–5 lands", which is the honest shape and is detectable without a new field:
collect the texts per key and compare. This is the same instinct as the
grouping rule above, pointed the other way — one key with many texts becomes a
range, many keys with one text become a count.

**Applied in the other order, or in no stated order, the range rule never fires
and every interpolated value founds its own group.** _"Group by TEXT"_ makes
`"2 lands are missing"` and `"5 lands are missing"` two groups, at which point
there is no key left to range over; the corpus's same-text group count goes
338 → **1847** over 20 runs and the worst map's block count 60 → **570**, which
is the arithmetic Sec.4.5's cap margin rests on. The range rule exists for
exactly this population and was unreachable from where it sat. **The ordering is
the fix for both sections.**

#### The passthrough has ONE exclusion, and the bar for it is not "low value"

**A note is excluded only when it is not a statement about what the preview
could not check at all.** `automaticBeach` is the one on this corpus: _"The
engine lays a beach wherever the ground meets deeper ground, with no command
asking for it — N tiles here."_ The preview models that **correctly and
completely**; the sentence is a true description of engine behaviour, in a
section whose title promises the opposite. It fires on most of the corpus and
pushes real findings down the page.

**It stays in the preview pane's own drawer**, where a reader who does not yet
know the rule is the audience. `NOTE_KEYS_NOT_PASSED_THROUGH` (`aggregate.ts`)
is the checker's alone, and the Advanced Tools pane is the argument for the
split: this tool's reader has already chosen the advanced surface.

**Everything that is genuinely a limitation stays, including the cheap-sounding
ones.** `behaviorVersion2` (_"simulated the same as version 1"_) and `atColor`
(_"AT_COLOR is treated the same as AT_PLAYER"_) look like noise and are not —
they are real gaps between the preview and the engine, and **a limitation with
low consequence is still a limitation**. The bar is a category test, never a
usefulness judgement, because a usefulness judgement is exactly the opinion
this section's opening sentence says the tool must not form.

**Filtered at INGESTION, not at render**, so the group counts and the covered
fraction describe exactly what the report shows. A note dropped on the way out
would leave both quietly measuring a population the reader never sees.

#### The renderer appends no punctuation to text it is passing through

The generator's note texts are authored sentences and most already end in a
full stop, so a period appended unconditionally printed _"…with
beach_terrain.."_. Append a terminator only when the text does not already
carry one and no count clause follows it. **Punctuation invented by the
renderer is the smallest possible version of this section's own defect** — the
tool editing text whose whole contract is that it is passed through verbatim —
and it is the one a reader notices first, because a doubled full stop reads as
machine output.

#### `severity` blocks render at `info`, uniformly, because this tool has no basis for any other level

**`severity` declares `level: "info" | "warning" | "error"` as required**
(`tools-api/index.ts:325`) and the section prescribing a `severity` block per
group never said how to fill it. `SimulationNote` carries no severity: it has
`prominence: "drawer" | "banner"` (`types.ts:304`), a two-value **pane display
hint** (23 `drawer` sites against 2 `banner` in the generator) consumed by
`PreviewNotes.tsx:30` and `PreviewCanvas.tsx:302` as a placement rule and
nothing more.

**A `prominence`-derived mapping is the obvious guess and it is wrong in both
directions on this corpus.** `cliffsMinExceedsMax` — whose own text says it
_"crashes the real game"_ — is `drawer`, so it would file at the lowest level,
while the spanless `includes` family (6 of the 29 spanless groups) is `banner`
and would file above it.

**So every note group renders at `info`, and the uniformity is the point rather
than a default.** This section's stated principle is that notes stay visible
_"rather than this tool silently re-deriving its own opinion about what it could
not check"_, and **assigning a severity is that opinion**. `info` is the level
that carries none. Sec.3.5 shows this document assigning a level where it has a
basis — a verified reference-data row — and the contrast is the argument: there
the gate reads a field that means what the level means, here there is no such
field on either side of the passthrough. A note that deserves a louder level
deserves it in the generator, where the fact lives, and that is a
`preview-design.md` change rather than a checker one.

## 6. Manifest

**An excerpt — only the fields that differ from the `scriptStats` template.**
`ToolManifest` also requires `name`, `version`, `apiVersion` and `description`
(`tools-api/index.ts`), and a reader taking this block for the whole manifest
writes one that fails `protocol.ts`'s validation.

```
id: "consistency-checker"
capabilities: ["read-source", "read-ast", "read-generation-settings", "read-reference"]
ownsSettingsHeader: true    # Sec.5.2 — the pane suppresses its own echo
```

(`read-source` is implied by `read-ast`, declared anyway per the `scriptStats`
convention of the manifest being the copy-paste template — `tools-api-design.md`
Sec.6 already pins this exact four-capability list for this tool by name.)

```
params:
  playerCounts:        multiSelect, options 2/4/6/8, default all four, minSelected 1
  runsPerPlayerCount:   integer, default 15, min 5, max 200
  baseSeed:             integer, default 1, min 0
  hideHealthy:          boolean, default TRUE — leave out rows with nothing to
                         report (Sec.5.1); the hidden count is always printed
  staticOnly:           boolean, default false — skip Sec.4 entirely, for a
                         fast first pass; Sec.3 always runs regardless
```

**`hideHealthy` is the one param that defaults to ON, and the default is the
decision rather than the param.** The finding tables run to hundreds of rows on
this corpus and the overwhelming majority are healthy, so the findings arrive
below a screen of commands that worked. The cost of the default is bounded by
the rule that the hidden count is printed unconditionally — the reader is never
short a fact, only short the rows carrying no facts.

**Read it as `params.hideHealthy !== false`, not `=== true`.** The default is
ON, so an absent param — an older saved param set, or a host that sends only
what changed — must read as the default rather than silently inverting it.
This is the one param where the two spellings differ in behaviour, which is
exactly why it is written down.

`staticOnly: true` still pays for a worker spawn and the context clone, because
`WORKER_RUNTIME_TOOL_IDS` (Sec.4.3) keys on **tool id**, not on the run's
params — the host picks a runner before the tool reads anything. Harmless, and
stated so the next reader files it as a known cost rather than a bug.

`edit-source` is **not** declared — this tool reports, it does not patch code
(unlike Breakdown's patch engine or a future formatter tool, CREATION_PLAN
5.2b). `read-selection` is not declared; nothing here is selection-scoped.

## 7. Infrastructure the implementing session must land before the tool itself

Ordered by dependency, not by importance — each is small and independently
testable.

### 7.0 The export surface Sec.3 is written on

**Sec.3 reuses four things from `preview/generator/` and every one of them is
unreachable from outside its own module, and it needs a fifth thing that does
not exist anywhere.** This item exists because the alternative — "the spec said
reuse it, the export was missing, so I wrote my own" — produces the second
resolver Sec.3.3 forbids and the second copy of the area arithmetic Sec.3.1
forbids, and does it silently. Items 4 and 5 are the two every check needs and
nobody names, which is how they were going to be copied.

1. **`objectEntry` (`objects.ts`) becomes exported and generic over its row
   type — three edits in two declarations, not one word.** It is private today
   and typed to `ObjectConstant`, which carries neither `allowedTerrains` nor
   `verified` — so as written it cannot answer either question Sec.3.3 and
   Sec.3.5 ask of it. It only ever reads `constId`, `rmsConstant` and
   `category`, so the constraint is
   `{ constId?: number | null; rmsConstant?: string | null; category: string }`
   and `T` flows through to the return type. One function then serves the
   preview's `ObjectConstant[]` and the checker's `PublishedGameConstants`,
   with no second index and no second copy of the two-step rule.

   **`OBJECT_INDEX` has to be re-typed with it, and this is the same
   `constId?`-against-`constId` seam Sec.4.1 documents, crossed a second time
   inside the fix for the first.** The `WeakMap` is declared
   `WeakMap<readonly ObjectConstant[], …>`, and a `WeakMap`'s key type is fixed
   at construction, so it cannot be generic per call: `readonly T[]` does not
   assign to `readonly ObjectConstant[]` for precisely the reason Sec.4.1 gives.
   Made exactly as prescribed above and compiled, this produces **six errors,
   four `TS2345` and two `TS2322`, every one of them the `WeakMap`** (verified
   against this repo's `tsconfig.json`, 2026-08-16). "The `WeakMap` keys on the
   array identity and keeps doing so" is a true statement about the runtime and
   says nothing about the declared key type, which is the half that fails.

   The form that compiles:

   ```ts
   const OBJECT_INDEX = new WeakMap<object, { byName: Map<string, unknown>; byId: Map<number, unknown> }>();

   function objectIndex<T extends Row>(constants: readonly T[]) {
     let index = OBJECT_INDEX.get(constants) as { byName: Map<string, T>; byId: Map<number, T> } | undefined;
     …
   }

   export function objectEntry<T extends Row>(
     objectRef: string, constants: readonly T[], symbols?: ReadonlyMap<string, number>,
   ): T | undefined
   ```

   **The cast on `.get()` is the load-bearing line and it deserves its own
   sentence.** It is safe because the `WeakMap` is keyed on array identity and
   each array only ever yields the index built from itself — which is the
   argument this item already made, pointed at the cast instead of at the
   absence of one.

2. **`declaredTargetTiles` (`lands.ts`) becomes exported.** Sec.3.1 sums it
   and it is a private function; `LandOrigin.declaredTargetTiles` carries the
   same value on the exported type but is reachable only by running S1, which
   is the layer Sec.3 is not. It is pure — `(cmd, dim, perPlayerDivisor)` —
   so exporting it costs nothing and is the whole of the fix.
3. **`reportFor`'s player-count multiplication is NOT exported and must not
   be.** It is a closure inside `placeLandOrigins` over that call's own
   accumulator. Sec.3.1's rule is one line (`perPlayerDivisor` is the player
   count for a `create_player_lands` occurrence and 1 for everything else) and
   the arithmetic cancels anyway; write the line, cite `lands.ts`, and let the
   Sec.8 fixture pin it.

4. **`argValue`/`numAttr` — decide, do not drift.** Every check in Sec.3 reads
   instantiated attribute values, and the helper for that is private **and
   already copied verbatim in four stage files** (`lands.ts`, `objects.ts`,
   `elevation.ts`, `terrains.ts`, confirmed 2026-08-16). Left unstated, the
   implementing session writes copy five under time pressure — the exact
   outcome this item exists to prevent, in the same session that reads this
   item. The four existing copies are a deliberate per-stage convention, so
   this is a real fork and the doc picks a side: **export one copy from
   `objects.ts` and have the checker import it.** The checker is not a stage,
   the convention is about stages, and a fifth copy in a different directory
   would be the first one nobody chose.

5. **One AST walk, written once, that descends into `OrphanBlockNode`s — and it
   is UNCONDITIONALLY GENEROUS, with every caller filtering.**
   Sec.3.2's declaration side, Sec.3.2's reference side and Sec.3.3's terrain
   surface all walk `ctx.parseResult` and all three must reach shared blocks
   (Sec.3.0b). Nothing in `src/parser/` **exports** a general item walker today
   — `collectNodes` in `__tests__/testUtils.ts` is the closest and it is a test
   helper that returns spans rather than nodes. This one belongs to the checker
   and lives beside it: a single `walkItems(parse, visit)` that recurses
   through command blocks, both `if` and `start_random` branches, and orphan
   blocks, handing each visitor the item, whether it came from a shared block,
   and the enclosing construct kind.

   **The "generous, callers filter" half is not a style preference — an earlier
   revision specified the walk as taking both branch kinds and its three named
   callers want three different branch policies:**

   | caller                   | wants                                             | a both-branches walk gives |
   | ------------------------ | ------------------------------------------------- | -------------------------- |
   | Sec.3.2 declaration side | **every** branch, selected or not                 | every branch ✓             |
   | Sec.3.3 terrain surface  | `start_random` all branches, **`if` as selected** | every branch ✗             |
   | Sec.3.2 reference side   | shared blocks **in taken branches only**          | every branch ✗             |

   Written as a single policy, an implementer building Sec.3.3's surface on this
   walker violates Sec.3.3's own stated rule, and **nothing in Sec.8 goes red for
   it** — the error is in the suppressing direction on a corpus where Sec.3.3 has
   measured that no map produces a terrain at another map size (0 of 32). The
   number that makes the mistake invisible is the same number that makes it
   harmless today, which is the worst way for a rule to be wrong.

   The alternative — teach the walker the branch policies — was rejected: knowing
   which `if` branch was _selected_ means knowing S0's answer, which couples a
   pure AST walk to the instantiation. So the walk yields everything and each
   section carries its own filter in its own text: Sec.3.3's surface drops
   unselected `if` branches, and Sec.3.2's reference side keeps only shared blocks
   S0 reached (which it tests by the `unsimulated:<span>` note, not by
   re-deriving branch selection).

   **The census this item used to argue from was wrong and the corrected one
   argues for the same answer on a different ground, which is the only reason
   the item survives.** "Three call sites with three hand-rolled recursions" is
   not the population. `grep -rn "orphanBlock" src/` returns 11 non-test files (16
   with tests); **six of them carry eight recursions over `Item[]`, and five of
   the six already descend**. The rest name the case without walking it, and the
   distinction matters in an item whose whole subject is a census that was wrong
   once: `scriptStats.ts` (`countItems` — Sec.6's own copy-paste template,
   sitting in the checker's own directory), `validate.ts` (`checkBlockContents`
   then `walkItems`), `resourceTotals.ts` (three separate walks),
   `objectInventory.ts` and `truncateAst.ts`. `instantiate.ts` is the one that
   deliberately does not, which is Sec.3.0b's whole subject. (`cardKind.ts`
   names the case and is a classifier, not a walk.) So the checker's would be
   the **seventh recursion and the second in `src/tools/`**, and six places have
   already made this decision rather than three.

   **A count of three would not have decided this fork and a count of six does
   not either — the PARAMETER SET does.** Item 4 resolves the identical-looking
   fork the other way (export one copy) because `argValue`/`numAttr` is the same
   work in every copy. This one is not: **none of the five existing descents
   carries either of the two bits this walk hands its visitors** — the "did this
   come from a shared block" flag Sec.3.2's reference side needs to anchor its
   span, and the enclosing construct kind the two filters above key on. An
   earlier revision made this argument on the orphan flag alone, which was the
   same argument one bit short. Checker-local, justified by the parameter set;
   copy the shape from `scriptStats.ts` rather than re-deriving it.

Item 2 is a one-word change plus its existing tests. Item 1 is three edits and
a cast. Neither has a behavioural effect on `preview/`; items 4 and 5 have none
either.

### 7.1 `ToolsPane.tsx`: the `read-reference` branch

`startRun`'s `ctx` builder (Sec.0's inherited gap) needs a fourth branch
alongside the three that exist:

```
...(granted.has("read-reference")
  ? { referenceData: { language: lang, gameConstants: <constants array> } }
  : {}),
```

`lang` is already a module-level import (`languageData` cast to `LanguageData`,
already used by `startRun`'s `tiles` computation). `gameConstants` needs its own
module-level import of `reference/data/game-constants.json`, cast through
`{ constants: PublishedGameConstants }.constants` — the same double-cast
`src/preview/worker.ts` already uses for the same file, for the same reason
(schema validation is `validate:reference`'s job, not a runtime assertion
here).

### 7.2 `host.ts`'s `reset()`, then the worker runner (Sec.4.3)

**In this order, because item 1 is independently testable today and item 3 is
what turns the defect it fixes from latent into live** (Sec.4.3 — a per-tool
host would have masked it instead, which is why the ordering argument is about
the runner and not about any `useMemo` change).

1. **`ToolHost.reset()` terminates an active run** instead of forgetting it
   (Sec.4.3). Smallest correct version: call `terminate()` — or share
   `clearTimers` + `active = null` — when `this.active !== null`. `host.ts`
   already accepts injected `Timers`, so the test is thirty lines, needs no
   real clock, and needs no worker: an injected runner whose handle never
   completes reproduces the misattribution on today's code.
2. **`previewBridge.ts` gains two things, both narrow and both at the seam
   that module exists to guard** (Sec.4.1). First,
   `overrides?: { playerCount?: number }` on **`previewSettingsFromContext`**,
   applied after it narrows, with `runPreviewFromContext` taking the same
   parameter and passing it through — without it the Monte Carlo matrix runs one
   player count four times, and with it on the wrapper only the static layer has
   no sanctioned path to a `PreviewSettings` at any count but the pane's
   (Sec.4.1). Second, a **named conversion from
   `PublishedGameConstants` to `readonly ObjectConstant[]`**, defaulting an
   absent `constId` to `null`, because the two types do not assign
   (`constId` is optional on one and required on the other) and this tool is
   the first consumer to cross that seam. Both are unit-testable without a
   generation; the conversion's test is that it compiles, which is the whole
   point of putting it here rather than at the call site.
3. `src/tools/checkerWorker.ts`, `src/tools/workerRunner.ts`, and a
   `WORKER_RUNTIME_TOOL_IDS` addition to `registry.ts`, all as specified in
   Sec.4.3. **`ToolHost` takes a runner resolver and picks per `start()`;
   `ToolsPane.tsx`'s `host` `useMemo` and its dependency array are unchanged**,
   which is what keeps "one run at a time, app-wide" true (Sec.4.3).

   **The runner posts the object it was handed, unserialised, and the parameter's
   NAME is the trap.** `ToolRunner.start`'s second parameter is declared
   `contextJson: unknown` (`host.ts:43`, `:129`), `ToolsPane.tsx:136` passes the
   **live** `ctx` object, and the in-process runner forwards it straight to
   `tool.run` (`host.ts:350`) — which is what Sec.4.3's whole argument rests on
   ("the host posts the live in-process context and structured clone preserves
   `Infinity` and `def`"). A session writing `workerRunner.ts` against a
   parameter called `contextJson` has exactly one obvious wrong move available,
   and `JSON.stringify(Infinity)` is `null`: the silent AST corruption
   `tools-api/index.ts` spends a doc comment on. The parameter's name predates
   the worker transport; **renaming it is 5.1's, not this document's**, so the
   clause has to live here instead.

4. **Three changes to `tools-api/index.ts`, the published contract — grouped
   because they carry the same obligation: a doc comment naming this tool as the
   reason, the way `multiSelect` and `OutputBlock.severity` already do.**

   a. **`ToolManifest` gains `ownsSettingsHeader?: boolean`**, with
   `ToolsPane.tsx` suppressing its settings echo when it is set (Sec.5.2),
   and `protocol.ts`'s manifest validation gaining the optional field.

   b. **`HostMessage` gains the type parameter its payload already has**
   (Sec.4.3):
   `HostMessage<P extends SerializedParseResult = SerializedParseResult>`,
   with `context: ToolContext<P>`. Without it the worker sketch does not
   compile, because the unparameterised form carries the WIRE context and
   `ToolImplementation.run` demands the in-process one. Verified: the sketch
   written out as a real file goes from `TS2345` to `tsc --noEmit` EXIT 0,
   and the default keeps every external reading unchanged. **Not a cast** —
   `context as ToolContext<ParseResult>` is the move `previewBridge.ts`
   exists to refuse.

   c. **`DEADLINES.cancelGraceMs` moves 30_000 → 60_000**, equal to
   `runWatchdogMs` (Sec.4.4): both bound one generation, the worst of which
   this document measures at 24–32 s, so a 30 s grace prints `killed` — a
   verdict on the tool — against a tool that cancelled exactly as specified.
   This one is **not** this document's to land alone: it is an amendment to
   `tools-api-design.md` Sec.4.1, which owns the derivation and has moved
   both constants once already for the same reason. Its tests assert against
   the constant rather than a literal, so nothing there needs editing.

### 7.3 The checker implementation

`src/tools/builtin/consistencyChecker.ts` — the `ToolImplementation` itself:
Sec.3's static checks, Sec.4's loop and aggregator, Sec.5's output builder.
Registered in `src/tools/registry.ts`'s `TOOLS` array (the comment already
reserving its slot names this exact export).

**Sec.3's checks are pure functions over TWO inputs, not one, and the signature
has to say so.** Sec.3.1 and Sec.3.4 read only `InstantiatedScript`; Sec.3.2
and Sec.3.3 read `InstantiatedScript` **and** `ParseResult`, because their
suppressing scans run over the AST (Sec.3.2's declaration side, Sec.3.3's
terrain surface) while their reporting scans run over the instantiation. Give
the second group `(inst, parse)` explicitly rather than a bundled context, so
a check that reaches for the AST is visible in its own type — and so no check
can quietly acquire the AST later and start reporting off a surface Sec.3.0's
soundness argument does not cover. All four stay independently unit-testable
without a `TileGrid`.

## 8. Test plan

1. **Static checks, each as hand-built fixtures in both directions** — a script
   that trips the check and a structurally similar one that does not (mirroring
   `validate.test.ts`'s convention of a positive and negative pair per RMS03xx
   code). Sec.3.1 needs a fixture at exactly `sum == dim*dim` (boundary, must
   not warn) and one tile over (must warn). Sec.3.2 needs all three declaration
   forms (`create_actor_area`, an object's own `actor_area` attribute, neither)
   plus the suppression rule against a Monte Carlo `actorAreaMissing` on the
   same command, plus a `#const`-named id declared in an UNSELECTED
   `start_random` branch (must not warn — Sec.3.2's union scan) and one whose
   `#const` is absent entirely (must abstain, not warn). Sec.3.3 needs one
   fixture per resolution tier (`allowedTerrains` present and
   empty-intersection; only `habitat` present; neither present — must report
   nothing) and one per branch the fold added, each of which is a false
   positive if it regresses:
   - `terrain_to_place_on` naming a terrain the object's table refuses (must
     warn — `create_object DEER { terrain_to_place_on WATER }`) and one it
     permits (must not);
   - the same attribute on an object whose habitat is UNDECLARED (must not
     warn — there is no data to narrow with);
   - **the tier-2 fork in both directions**: a `habitat: "water"` object named
     onto a dry terrain (must report) and onto a water terrain (must not),
     with a **third** fixture asserting that the same finding comes out at
     **info** when the terrain row is `verified: false` — which is 116 of 131
     rows today, so a fixture that happens to pick a verified one asserts the
     wrong severity and passes;
   - **a surface-only tier-2 case with the named terrain removed**, asserting
     the finding survives, which is what goes red the day someone collapses the
     fork back into one surface test;
   - `ignore_terrain_restrictions` with `set_place_for_every_player` (must
     report nothing) and the inert form without either prerequisite (must
     report normally);
   - a surface reachable only through `replace_terrain`, only through
     `beach_terrain`, and only through the automatic beach pass (all three must
     not warn);
   - the placeholder idiom verbatim — `create_object FISH_PLACEHOLDER
{ terrain_to_place_on SHALLOW second_object FISH }`, **preceded by its own
     `#const FISH_PLACEHOLDER 647`** — which must report nothing, and is the
     fixture that goes red the day someone "improves" the check into following
     `second_object`. **Both halves of that sentence are load-bearing and the
     fixture pins less than it looks like it does.** `FISH_PLACEHOLDER` is not
     an `rmsConstant` in `game-constants.json` (zero rows); it reaches a row only
     through the script's own `#const` (`Menindee_AUS_v2.3.rms:38`), so written
     without that line the fixture falls to case 3 and passes trivially. Written
     with it, unit 647 carries `habitat: "any"` and no `allowedTerrains`, so tier
     1 never applies and tier 2 skips it by habitat — **the `second_object` rule
     is not what makes it silent today**. It still goes red for the mutant it is
     aimed at, since following `second_object` reaches `FISH` (restriction 19,
     no `SHALLOW`). Assert the command is **tier-skipped**, not merely
     finding-free, or three different mechanisms produce the same green;
   - an `allowedTerrains` row with `verified: false` (`FISH` or `SHORE_FISH`,
     Sec.3.5) downgrading to info rather than warning;
   - **the fork's third arm**: `create_object GOLD
{ terrain_to_place_on SOME_UNDEFINED_NAME }`, asserting **abstention** —
     the command is tier-skipped, not merely finding-free. Three mechanisms
     produce the same green here, exactly as with the `FISH_PLACEHOLDER` fixture,
     and the one that must be pinned is the third arm rather than a lucky
     intersection. Its partner is the same command with `#const
SOME_UNDEFINED_NAME GRASS2` added, which must route to the named-terrain
     branch (reading C) or abstain (reading B) — whichever BUG-015 lands on, and
     the fixture is where that decision becomes visible.

   Sec.3.2's two reference forms need a fixture each, because they now carry
   different severities: an undeclared `actor_area_to_place_in` (error) and an
   undeclared `avoid_actor_area` (**info** — the fixture that goes red the day
   someone "tidies" the two back into one finding).

   **Sec.3.0b needs its own fixture in every scan that descends, and each one
   is a false positive if it regresses.** An `actor_area` declared inside a
   shared block with the reference on a later ordinary command (must report
   nothing — this is `Pa_Site_v1.1.rms`'s 8000 in miniature, and it is the
   fixture that goes red the day a declaration walk is rewritten as "every
   `create_object` carrying attribute X"); a `base_terrain` reachable only
   through a shared block feeding Sec.3.3's surface (must not warn); and a
   reference sitting inside a shared block for an id declared nowhere, which
   **must** report, anchored on the attribute's own span rather than on a
   command. Take the block shape from the parser's own RMS0110 fixtures rather
   than hand-writing one, since a `{` that does not qualify as shared parses as
   something else entirely.

   **Tier 1's fixture triple is already written, by two authors, on two tracked
   maps** (Sec.3.3), and using it costs less than hand-building the equivalent:
   `AK_ForeDaut_v1.3.rms` places `SHORE_FISH` on `WATER` with no flag (permitted,
   must not report) and on `DLC_MANGROVESHALLOW` with `place_on_specific_land_id`
   (valid override, must report nothing), while `AK_Namatjira.rms` writes the
   **same** pairing with the flag inert (must report, at **info** — Sec.3.5).
   Both maps are tracked, so unlike the `RawNode` fixtures below this one can be
   a corpus assertion. Keep a hand-built `create_object DEER
{ terrain_to_place_on WATER }` beside it for the beginner shape the check is
   aimed at, since the corpus contains no such thing by construction.

   **Sec.3.3's `RawNode` abstention needs two fixtures and CANNOT be pinned by
   the corpus**, which is the whole reason it is called out separately. The map
   that motivates the rule (`Rage Forest 2026.rms`, 70.9% raw) is untracked, and
   the two RawNode-carrying maps a clone does get — `AK_ForeDaut_v1.3.rms`
   (`elseif 7_PLAYER_GAME`) and `TC2 - Comeer v1.4.rms` (`4056`) — are both
   correctly classified harmless, so a corpus assertion here passes vacuously on
   CI. That is the mistake `tools-api-design.md` rev 8 made when it prescribed a
   fixture in `test-maps/broken/`, where `.gitignore` makes it invisible. So:
   one fixture whose raw node reads `4056` and whose Sec.3.3 findings must be
   **unchanged** (the negative half, and the one that goes red the day someone
   re-scopes the rule to "any raw node"), and one whose raw node contains a
   `<TERRAIN_GENERATION>` header and which must **abstain**. Take both raw-node
   shapes from the parser's own degradation fixtures rather than hand-writing
   text and hoping it degrades.

   **Sec.3.2 rule 4 needs the third `RawNode` fixture, and it is the one whose
   absence would have shipped an error.** A script whose raw node hides an
   `actor_area` declaration and whose visible, reachable command references that
   id, asserting **no error** — the `TL Cape of Storms` shape with the reference
   moved into a taken branch, which is the environment the corpus is one label
   away from. Corpus-unpinnable for the same `.gitignore` reason the two above
   are, and its negative partner is a raw node reading `4056` beside an
   undeclared reference, which must still report.

   **Sec.3.2 rule 2 needs a declaration written as a parenthesised expression**
   (`actor_area (AA_TC)` with `#const AA_TC 1`), which the AST scan cannot
   evaluate and S0 can. It must not abstain. Its partner is a declaration
   naming a `#const` that does not exist, which must abstain for the whole
   script — and the abstaining fixture must then assert that the Monte Carlo
   layer's `actorAreaMissing` row for that command is **still reported**
   (Sec.5.1), which is the corpus's real case and the one a suppression rule
   phrased as "commands Sec.3.2 has an opinion about" would erase.

   Sec.3.4 needs a `min_distance_to_players > max_distance_to_players` pair in
   both directions, and **one fixture for the cut packing bound**: a command
   declaring a count and a spacing that cannot geometrically fit, asserting the
   checker reports **nothing**. It goes red the day a reader reinstates the
   bound from the reasoning without re-reading why it was cut.

   **The report format needs fixtures of its own, and the zero-attempt rule
   (Sec.5.1) is why.** Three cheap hand-built scripts, asserted at the level of
   the emitted **table row** rather than at the level of a check:
   - `place_on_specific_land_id` naming a land no command declares
     (`landMissing`, 203 of the corpus's 462 S6 zero-attempt rows): the row's
     Spawn rate cell is the non-numeric one, its Worst player count cell is too,
     and its Failure buckets cell names the bucket.
   - The **same** `minExceedsMax` pair Sec.3.4 already asks for, asserted here as
     well — the static finding at error severity _and_ the Monte Carlo row on the
     same command, so the two layers' treatment of one command is pinned
     together. It is the only place that pairing exists: on this corpus the
     static check finds 0 and the bucket contributes 0 rows.
   - `create_elevation 0` (`elevation.ts:393`), the zero-attempt row that carries
     **no failure bucket at all**, asserting the row still states a reason.
     Without it the rule reads as "print the buckets" and the five bucketless
     rows print an empty cell. It covers **1 of the 5**, so:
   - **an empty-pairing connection** — `create_connect_all_players_land` with no
     player lands declared is two lines — asserting the row states the _pairing_
     reason rather than a stage label. This is the fixture that pins the sentence
     the tool prints on the **other four** bucketless rows, one of which is
     `sample.rms` on every CI run, and it goes red the day someone re-derives
     that sentence from `connections.ts:784`'s engine bug (which fires zero times
     on this corpus — Sec.5.1).
   - **a mixed-matrix row**: a command whose land exists at 2 players only, run
     over a 2/4 matrix, asserting that the Worst player count cell names **4**
     and the Spawn rate cell is the non-numeric one — never 2 and never that
     count's percent. 65 corpus rows have this shape and 60 of them place 100%
     at 2 players, so an implementation that excludes zero-attempt counts instead
     of ranking them worst passes every other assertion in this list.
   - **its partner, the ABSENT-count row, and it is the fixture the mixed-matrix
     one above cannot stand in for**: the same 2/4 matrix with the **command**
     inside `if 2_PLAYER_GAME` rather than its land, so at 4 players no
     `CommandReport` exists for that span at all. Assert the Worst player count
     cell names **2** with its **real percent**, that the row says _only
     generated at 2 players_, and that it never says the command attempted
     nothing. 352 corpus rows have this shape, 146 on tracked maps, and every
     one of them is healthy — an implementation folding the matrix with
     `?? 0` prints a worst-case verdict on all of them and passes both the
     mixed-matrix fixture and item 2's invariant.
   - **a partially-present row**: a command inside a `start_random` branch, run
     at one player count over several seeds, asserting the row prints its run
     count (_"generated in N of M runs"_) rather than a bare rate. 207 corpus
     rows at 4 players over seeds 1–5 have this shape, on 11 maps including
     `sample.rms`, and at the default 15 runs per count it is the common case
     rather than the exotic one.
   - **an S5 row with the BUG shape**, partner to the empty-pairing fixture
     above: a `create_connect_to_nonplayer_land` followed by a
     `create_connect_all_lands`, asserting the second row says it was
     neutralised by the command above it and **not** that its pairing was empty.
     `connections.ts:784` fires zero times on this corpus only because all six
     maps that write that command write it last, so without this fixture the
     spec pins the sentence for the path that never runs and leaves the live one
     unpinned.
   - **a spanless note group** (Sec.5.4): a script producing the automatic-beach
     note, asserting the output carries the `severity` block and **no** empty
     `table` beside it, and **no covered fraction** — 29 groups on 24 of the 32
     maps are spanless, 177 over 20 runs.
   - **the cliff contradiction, in both arms, because the two arms differ in the
     one field a copied rule would key on** (Sec.5.1, Sec.3.4). `min 20 / max 5`
     writes both attributes and puts the note at a **different** span from the
     row (`152-175` against `176-198`); `min 9` alone writes one and puts them at
     the **same** span. Assert on both that the S3 row states the contradiction
     as its reason, and on the second that the finding names the **defaulted**
     maximum of 8. Its negative partner is `min 3 / max 8` written explicitly,
     which must report nothing. This is the seventh zero-attempt path and no
     corpus map trips it — all 8 that write the pair write `min < max` — so it is
     fixtures or nothing.
   - **a note emitted in two runs** (Sec.5.4): one script, one player count, two
     runs producing the same `unsimulated` span, asserting the group's `table`
     carries **one** row and the covered fraction counts the span **once**. Its
     partner is two **overlapping** spans in one run, asserting the fraction is
     the merged union rather than the sum. Without the pair the prescribed
     arithmetic prints **1418%** on `Rage Forest 2026.rms` at 20 runs, and the
     figure that motivated the whole clause is the one case a naive sum gets
     right.
   - **a note whose interpolated text differs across two runs at one `key`**,
     asserting one group carrying a **range** rather than two groups. This is the
     fixture that pins Sec.5.4's grouping **order**, and it is what keeps
     Sec.4.5's block-cap margin true at the default run count.
   - **the surface abstention threshold** (Sec.3.3 clause 2): a script whose
     producers are overwhelmingly unresolvable names, asserting the surface-half
     checks **abstain** while the tier-1 named-terrain half still runs, and its
     partner with a single unresolvable producer among many resolvable ones,
     asserting **no** abstention. The corpus cannot pin this — the check measures
     0 findings under every reading, so a threshold set wrongly changes no number
     the reporter prints — which is why the constant is interim and these two
     fixtures are what a later measurement re-runs against.

2. **Corpus measurement, reporter not gate** — `src/tools/__tests__
/consistencyChecker.measure.test.ts`, same family as `rms0304.measure.test.ts`
   /`rms0315.measure.test.ts`: run the static layer over every tracked
   `test-maps/*.rms` and print counts per check.

   **The Monte Carlo half of this reporter EXISTS as of 2026-08-18 and is how
   every figure in this document is now re-derived.**
   `src/tools/__tests__/consistencyChecker.measure.test.ts`, run by
   `npm run measure:checker`, prints six censuses — the zero-attempt census per
   player count, the matrix row census, the presence census (Sec.4.2's absent
   state), the within-batch drift census (Sec.4.2's partial state), the bucket
   domain comparison and the note census — each in **two columns, all-on-disk
   and tracked-only**, with the denominator printed beside every count. It diffs
   **89 pinned figures** and prints per-figure `ok`/`DRIFT`, so a review round
   re-derives this document in one command instead of hand-writing probes. It
   is a reporter, not a gate: it never fails on drift.

   Three things about it are load-bearing for whoever maintains it. It has its
   own **`vitest.measure.config.ts`** and is named in `vitest.config.ts`'s
   `exclude`, because Vitest's default include catches any `*.test.ts` and this
   run costs **440–515 s** — inside `npm test` it would feed exactly the
   wall-clock flake this repo has documented for months. The npm script passes
   **`--disableConsoleIntercept`**, without which it prints nothing and still
   exits 0, indistinguishable from a broken probe. And it does **two generation
   sweeps total** (2/4/6/8 at seed 1; 4 players over seeds 1–5), computing all
   six censuses from those, rather than one sweep per section.

   **Four censuses are OWED to it, and three of them exist because every census
   it prints today is taken at one point of a swept parameter.** The two sweeps
   are 2/4/6/8 at seed 1 and 4 players over seeds 1–5, so no census crosses the
   two axes and none is taken at the run count the tool's own defaults set.
   - **The presence and drift censuses, swept together** (2/4/6/8 × seeds 1–5):
     8511 rows, 373 absent (149 tracked), 240 partial (145 tracked), plus the
     control that **0 rows** flip from absent to present across seeds. Sec.8's
     invariant figures are pinned off this, with `≥`.
   - **The note census at the DEFAULT run count, under Sec.5.4's ordering.**
     Every figure in Sec.5.4 and every block count in Sec.4.5 was taken at **one
     generation** while the defaults are **60**. The 20-run figures are recorded
     in those sections as the evidence for the ordering rule; what is owed is the
     re-take at 60 **after** the ordering lands, which is the number Sec.4.5's
     cap margin actually depends on. Print same-text groups, spanless groups, the
     worst map's block count and the largest table's row count, each in both
     columns.
   - **The tie-break census** (Sec.5.1): tied rows, tied rows carrying a failure,
     and the set/count disagreements — 7313 / 2022 / 146 / 250 at seed 1. It is
     the only evidence that the tie-break choice costs anything, and it becomes
     unobservable the moment the tie-break is deterministic.
   - **The unresolvable-producer ratio per map** (Sec.3.3 clause 2), with the
     abstention verdict beside it. This one belongs to the static half and is
     what replaces that clause's interim `1/3` with a measurement. It cannot be
     written until the check exists.

   **The static half is still owed** and cannot be written until Sec.3's checks
   exist. The table below is its specification.

   **"Tracked" is 12 files on a clone and 32 on a maintainer's disk, and this
   reporter has to print both.** `git ls-files test-maps` returns **11
   top-level `.rms` plus `broken/BCC2-Rekawa.rms`**; the other 21 are
   `.gitignore`d. Every number in the table below was measured over 32, and the
   first session to run this on CI would otherwise see numbers matching nothing
   in the doc — with **three of the four maps the error row names absent from
   their disk**. This repo has recorded the trap once already
   (`tools-api-design.md` rev 8: _"'tracked' was used 14 times to mean 32 maps
   when a clone gets 12"_) and item 6 below applies it correctly for the
   `FailureMark` mutant. Print both populations; the table has two columns for
   that reason.

   **The expected values are measured, not predicted, and this is the rule a
   whole review round was spent establishing.** An earlier revision wrote "expect near-zero on
   this corpus" for all four static checks, on the RMS0304 reasoning that this
   is expert-written, DE-official-heavy material. Run, three of the four were
   nowhere near zero, and the prediction was load-bearing: it is what would let
   an implementing session read a red reporter as "the corpus is expert-written"
   instead of as a defect. **A reporter's own expected values are as assumable
   as the numbers it prints.** The baseline this revision measured, at 4
   players / Normal / seed 1 over the 32 tracked maps, belongs in the test as
   the number to diff against:

   | check                                                         | 32 maps (a maintainer's disk)                                                                                                                                 | 12 files (a clone, CI)                                                                                                                                  |
   | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Sec.3.1 land over-allocation, fillers excluded (info)         | **6 maps** — 23 without the exclusion                                                                                                                         | **2 maps** (`AK_Namatjira`, `AK_Vanguard`) — 8 without                                                                                                  |
   | Sec.3.2 undeclared `actor_area_to_place_in` (error)           | **4 findings / 2 maps** (`Menindee` 1000; `Pa_Site` 81, 82, 91)                                                                                               | **1 finding / 1 map** (`Menindee`)                                                                                                                      |
   | Sec.3.2 undeclared `avoid_actor_area` (info)                  | **30 commands / 7 maps**                                                                                                                                      | **14 commands / 2 maps** (`AD4 - Ra` 3, `Chaotic_Strait` 11)                                                                                            |
   | Sec.3.2 scripts abstaining (rule 3, unresolvable declaration) | **1** (`AK_Vanguard`)                                                                                                                                         | **1** (same map)                                                                                                                                        |
   | Sec.3.2 scripts abstaining (rule 4, `RawNode`)                | **2** (`Rage Forest 2026.rms`, `TL Cape of Storms.rms`)                                                                                                       | **0** — both untracked; pin it with fixtures, never here                                                                                                |
   | Sec.3.3 terrain impossibility (warning)                       | **0** — 446 commands checked at tier 1, 356 at tier 2, 52 skipped as validly `ignore_terrain_restrictions`, 75 resolving to no row, 21 naming an object group | **0**, and both of the maps that produced the three-set reading's false warnings (`AK_Six_Points`, `sample.rms`) are tracked, so this row is real on CI |
   | Sec.3.3 terrain impossibility (info, Sec.3.5 gate)            | **2** — 1 tier 1 (`AK_Namatjira` `SHORE_FISH`/`DLC_MANGROVESHALLOW`, an inert-flag true positive) and 1 tier 2 (`Chaotic_Strait`, undecided — Sec.9)          | **2** — **both maps are tracked**, so this row is fully reproducible on CI                                                                              |
   | Sec.3.3 scripts abstaining (`RawNode`, Sec.3.3)               | **1** (`Rage Forest 2026.rms`)                                                                                                                                | **0** — the map is untracked and no tracked map trips the rule; pin it with fixtures, never here                                                        |
   | Sec.3.4 `minExceedsMax` (error)                               | **0** — near-zero here is real, and the fixtures are the proof it fires                                                                                       | **0**                                                                                                                                                   |

   **Two clone-column cells were guesses and one of them was wrong in the
   direction that costs coverage.** An earlier revision wrote _"measure on the
   first CI run; `Chaotic_Strait` is untracked"_ against the Sec.3.3 info row, and
   `git ls-files test-maps` returns `test-maps/Chaotic_Straitv0.99.rms` — the
   `.gitignore` whitelists it by name, and `AK_Namatjira.rms` arrives through the
   `!test-maps/AK_*.rms` line. So **both** of the corrected info row's findings
   are on tracked maps, and that row goes from unmeasurable-on-CI to the most
   reproducible row in the table. The `avoid_actor_area` clone cell was left as
   "fewer; measure on the first CI run" and is filled in above; it needed no run
   of its own, because Sec.3.2 is per-script and a per-map count does not depend
   on what else is on disk. **This document has now made the tracked/untracked
   mistake in both directions** — calling 32 maps "tracked" when a clone gets 12,
   and calling a tracked map untracked — so the rule is to run `git ls-files`,
   never to reason from a map's name or its provenance.

   **Two corpus assertions belong here and both are about the report rather
   than about a check.**

   **First: no row of the finding table may carry `{0, 0}` as its span, and no
   S3 row may take its label from a command.** Assert over the tracked corpus
   that every emitted `rowSpans` entry is either `null` or a span the source
   actually contains, that no Command cell is the empty string, and that every
   **S3** row's Command cell is the stage label rather than a source slice —
   which is the half a `{0,0}` test misses, live on 5 of 32 maps (Sec.5.1). It is
   a corpus assertion rather than a fixture because `sample.rms` is one of the 12
   files a clone gets and trips the `ZERO_SPAN` case today, so this row cannot
   pass vacuously the way the `RawNode` row above would.

   **Second: no Spawn rate cell is `NaN`, and none is empty through
   arithmetic.** 467 of the corpus's 8095 `CommandReport`s carry `attempted: 0`
   (Sec.5.1), so `Σ placed / Σ attempted` is `0 / 0` on them and the prescribed
   formula prints `"NaN"`. Assert over the tracked corpus that every Spawn rate
   cell is either a percent or the explicit non-numeric cell, and that every
   Worst player count cell is either a player count in the run's own matrix or
   that same non-numeric cell. This one also cannot pass vacuously: `sample.rms`
   produces zero-attempt reports at S5 today.

   **And the case that assertion passes as written**: a row naming worst player
   count `2` satisfies it while three other counts in the same matrix attempted
   nothing. Add the invariant itself — **no row may name a worst player count
   that has a spawn rate while another count in the same matrix attempted
   nothing** — which on this corpus goes red **65 times, 38 of them on the 12
   files a clone gets** (`AK_Six_Points` 15, `AK_Hourglass` 13, `Menindee` 10)
   against an implementation that reads the rule as an exclusion.

   **And the case THAT invariant passes as written, which is the same defect one
   state further out**: a row naming worst player count `2` beside the
   non-numeric marker satisfies both assertions above while the command simply
   does not exist at 4, 6 or 8. So the invariant has a partner — **no row may
   name a worst player count at which the command was never generated, and no
   row may report "attempted nothing" at such a count** — which goes red on
   **352 rows, 146 of them on the 12 files a clone gets** (`Menindee` 86,
   `AK_Namatjira` 54, `AK_Hourglass` 4, `AK_Six_Points` 2) against an
   implementation that folds the matrix with `?? 0`. Both invariants are needed:
   each is satisfied by the other's wrong answer.

   **Those two counts are LOWER BOUNDS and the assertion must be written as one,
   because they are quoted at seed 1 and the tool's default is 15 runs per
   count.** Swept 2/4/6/8 × seeds 1–5, the row set itself grows 8358 → **8511**,
   the absent population 352 → **373** (146 → **149** tracked) and the partial
   population 207 at one count → **240 across the matrix** (145 tracked), because
   153 rows exist somewhere in the batch that seed 1 never generates (Sec.4.2).
   A gate pinned at exactly 352 goes red on a correct implementation the first
   time it runs at the defaults. Assert the invariant, report the count, and pin
   the count with `≥`.

   **The one thing that does NOT move is the membership**, and it is worth
   asserting because it is what the absent state rests on: **0 rows — not one —
   are present at a count where seed 1 found them absent**, since the mechanism
   is `if N_PLAYER_GAME` and no seed moves it. That is a cheap reporter line and
   it is the control for the whole three-state rule.

   **Fourth: a `partial` never speaks about a player count it has not run.**
   Assert on a 2/4 matrix that the first `partial` contains no claim about 4 —
   no ranking, no "only generated at" reason, no zero-attempt verdict — and that
   the row set it prints is the one the 2-player batch produced. Written without
   it, **8040 of the first partial's 8125 rows (99.0%) deny containing a command
   the script contains** (Sec.4.5), the claim survives a cancel as the run's
   permanent output, and both invariants above pass on it. Assert too that the
   defaults emit **three** partials and one `result`, not four and one.

   **Third: the Failure buckets cell is the WORST COUNT's, and the assertion is
   a domain test rather than a magnitude test.** Assert that every row's bucket
   cell equals the buckets of **the count the ordering rule prescribes** — the
   minimum rate, ties broken by the lowest player count — which goes red on
   **2306** rows against a cell taken over the matrix, and on **191** of those the
   union names a bucket that never fired at the count whose rate is printed. Both
   figures are occurrence-weighted (`occurrences ?? 1`), the unit the cell
   renders.

   **Written against the row's own Worst player count cell instead, it passes
   under every tie-break including a hash order, and 95.9% of the rows it governs
   are tied.** _"Every row's bucket cell equals the buckets of the count named in
   its own Worst player count cell"_ tests consistency between two cells the same
   undetermined choice produced. The assertion has to name the count the **rule**
   prescribes, independently recomputed, or it is self-referential. Beside it,
   **as a reporter line rather than a gate**: of the 7623 rows with at least two
   rated counts and no zero-attempt cell, **7313 are tied at the minimum** (2041
   tracked), **2022** of those carry a failure at a tied count, and the tied
   counts disagree on the bucket **set** on **146** rows (10 tracked) and on the
   bucket **counts** on **250** (29 tracked). That is the population a later
   revision reopening the tie-break needs, and it is invisible once the tie-break
   is deterministic.

   **Do NOT write the assertion as "bucket counts may not exceed
   `Σ attempted`".** It goes red 803 times occurrence-weighted and 462 times on
   records, and it is not purely a domain test: `growthShortfall` counts **tiles
   short of a budget** rather than failed attempts, so an occurrence total can
   exceed `attempted` with the domain perfectly correct — `13_Rings_v1.2.rms`
   at `:128660` does exactly that at its own worst count (4 occurrences,
   3 attempted). Print it as a **reporter line**, not a gate: it is a useful
   tripwire for a cell that has silently widened, and it would fire on a corpus
   where nothing had.

   **Print all four summed populations beside it** — records **2833** worst
   count against **10647** matrix union, occurrences **2 026 194** against
   **8 105 519** — with the convention named in the output, because
   `PlacementFailure` carries `occurrences`, has no `count` field, and a probe
   reading `failure.count` silently counts records instead while Vitest
   transpiles without typechecking. That is not hypothetical: it is how the
   first measurement of this subsection was taken.

   **The two Sec.3.2 rows are the check as Sec.3.2 prescribes it.** An earlier
   revision published 12 findings / 4 maps and 59 commands / 10 maps, measured
   with the instantiation union — the algorithm Sec.3.2 exists to replace — and
   said so in its own sentence without ever asking whether the approximation
   and the algorithm disagree. They do, by more than half. Sec.3.2's table
   keeps both readings side by side; this one carries only the prescribed
   numbers, because a reporter that diffs against an approximation is
   measuring the wrong thing twice.

   **Sec.3.3's row was owed for three revisions and the reason it was owed had
   already expired.** Rev 5 wrote _"the check needs the exported resolver
   (Sec.7.0) before it can be run at all"_, which was true then; rev 6 wrote the
   export out in full and verified that it compiles, and inherited the blocker's
   conclusion without re-pricing its premise. Applying Sec.7.0 item 1 verbatim
   to a scratch copy takes ten minutes and the check then runs in seconds — and
   run, its two **warning**-severity findings were both false (Sec.3.3). Sec.3.3
   was at that point the only Sec.3 check with no number in its own section,
   which is rev 5's own published tell for which check fires. **A prerequisite
   marked blocking in one revision is not blocking in the next.**

   **The row that fold produced was then wrong for one more revision, in the line
   below the one it corrected.** The warning row was re-derived under the
   corrected tier-1 fork and went to 0; the info row of the same table, from the
   same run, was inherited at 4 — and two of those four were the _same two false
   positives on the same map_ the fork was written to eliminate, wearing a
   different severity. **A fix applied to a measurement must be re-applied to
   every row that measurement produced.**

   **Zero is not evidence a check is dead; the fixtures in item 1 are the proof
   it can fire** (`parser-design.md` Sec.8 on RMS0314/RMS0304) — but zero is
   only reassuring where it was _measured_ rather than assumed, which is the
   distinction this table exists to keep. Sec.3.3's zero is now measured, and it
   is a zero on an expert corpus for a check aimed at beginners, which is the
   RMS0304 shape exactly.

   **One row in this reporter must be one that CANNOT come back zero, and the
   reason is a probe that failed silently while writing this revision.**
   Sec.3.0's map-size sweep first measured **0 of 32** here — a tidy, plausible,
   entirely wrong zero — because `MAP_SIZES` is a `readonly string[]` of plain
   names and the probe read `.name` off each entry, giving seven identical runs
   over `undefined`. No error, no exception, no tell. That is this repo's own
   _"an instrument that cannot fail loudly has to be checked against a number
   you already trust"_, and the reporter prescribed here will make the identical
   mistake unless it prints a control: the count of commands **checked** beside
   the count of findings, per check. A findings row of 0 beside a checked row of
   802 is a measurement; a findings row of 0 beside a checked row of 0 is a
   broken probe, and the two are indistinguishable without the second column.

   **The reporter also prints the two coverage numbers that
   would have caught this document's own worst mistakes for free** —
   `allowedTerrains` coverage over the objects the corpus actually places
   (Sec.2), and the count of maps whose watched attributes move across five
   seeds (Sec.3.0). Both numbers were assumed wrongly by a document that cited
   its sources carefully, and both are three lines of reporter. **Measure the
   coverage through the resolver Sec.3.3 calls, over the instantiated script,
   and print the denominator beside it**: a token scan of the same corpus
   answers 56% where the resolver answers 34%, so a coverage figure with no
   population attached is not a measurement.

   **And the watched-attribute count is printed against the set the checks
   currently read, not a fixed list** (Sec.3.0: 13 of 32 for the set the
   checks read today, against 23 of 32 for the set before Sec.3.4's packing
   bound was cut). A hardcoded attribute list in a reporter
   decays the day a check is added or cut, and it decays silently, since it goes
   on printing a plausible number.

3. **Aggregation.** A hand-built two-run fixture with known `attempted`/`placed`
   per run, asserting the merged `CommandReport` sums correctly. Then the case
   that is **not** hypothetical: a `commandSpan` present in only one of two runs.
   Reusing one `ParseResult` is not reusing one instantiation — S0 resolves
   `start_random` per instantiation, and the instantiated command set moves with
   the seed on **12 of 32** tracked maps over seeds 1–5 (4 of 32 between seed 1
   and seed 2 alone, where `13_Rings_v1.2.rms` and `AK_Vanguard_v1.2.rms` each
   move 24 command spans). **The default run is 15 seeds, so the swept figure is
   the rate this aggregator meets** — a fixture built on the pairwise number
   would be tuned for a third of the real traffic. Assert it as a **corpus**
   case on one of those maps, not a hand-built one, and assert the merge neither
   crashes nor invents a zero row for a run that never contained the command.
   **That assertion is `runsContaining` stated as a test, and Sec.4.2 now
   carries the field it needs** — so assert the merged record's
   `runsContaining` against the runs that actually held the span, not merely
   that nothing crashed. A merge that satisfies the no-invented-zero clause by
   _skipping_ absent runs and then reports the sum as though it covered every
   run has moved the conflation up a level rather than fixing it, and no
   assertion phrased over `attempted` alone can see the difference. Measured, the
   population is **207 rows at 4 players over seeds 1–5, on 11 of 32 maps**
   including `sample.rms` — so this is a corpus case on a tracked map, not a
   hand-built one.

   **IMPLEMENTED, after the first cut answered it with a hand-built fixture**
   (`aggregate.test.ts`, two `addGeneration` calls with a literal report)
   citing this item by name, in the item whose own sentence is _"a **corpus**
   case on one of those maps, not a hand-built one"_. The corpus case exists at
   the defaults on three tracked maps: **104 of 330 rows on
   `13_Rings_v1.2.rms`, 40 of 476 on `AK_Namatjira.rms`, 2 of 8 on
   `sample.rms`** at 2/4/6/8 × 15. The hand-built one stays — it pins the sum
   arithmetic, which is this item's other half — and the corpus one runs
   `sample.rms` at the real defaults, because `sample.rms` is **tracked** and
   so the assertion holds on a clone. It carries the control this document
   requires of any zero-capable measurement: _the population is non-empty_
   asserted first, so a corpus that stopped carrying the shape reads as a red
   flag rather than as a clean pass over nothing.

4. **Worker plumbing, mirroring `tools-api-design.md` Sec.9 item 3's lifecycle
   list**: progress→partial→result ordering across the worker boundary; cancel
   mid-batch (between generations, honoring the Sec.4.1 yield point) stops
   within one generation's worth of latency; a worker crash (e.g. an unrelated
   uncaught exception, deliberately injected) synthesizes `error`/`killed`
   exactly as the in-process path does — this is the one place worker and
   in-process behavior must be proven identical, not assumed identical because
   the interface types match. **Plus the lifecycle case Sec.7.2 item 1 fixes**:
   cancel, switch tools, run a second tool, and assert the second run survives
   its predecessor's grace window — driven with injected `Timers`, which
   `host.ts` already supports.
5. **Budget arithmetic is itself a test**, not just a comment: assert
   `DEFAULT_RUNS_PER_PLAYER_COUNT * DEFAULT_PLAYER_COUNTS.length` stays within a
   named ceiling (e.g. 100 generations), so a future default change is caught.
   **Its comment must say it bounds the knob, not the time** — per-generation
   cost spans 6× across the corpus and a further 1.4× across map size (Sec.4.4),
   so no generation count pins a duration.

   **IMPLEMENTED, and the first implementation shipped the constant WITHOUT the
   assertion** — `MAX_GENERATIONS_CEILING` was declared, exported and commented
   with a citation to this item, and `grep -rn` returned that one line, so the
   constant could not go red on the change it names. An exported constant with a
   comment naming its test reads as done and is the same shape as this
   document's own _a doc comment that restates a rule the code does not
   implement is worse than no comment_. The assertion is one line and now sits
   in `consistencyChecker.test.ts`, with a second line pinning that
   `MAX_RUNS_PER_PLAYER_COUNT` × the matrix EXCEEDS the ceiling, so the ceiling
   is bounding something rather than being trivially true.

6. **Mutation-test per CLAUDE.md's standing rule** — a check that has only ever
   passed proves nothing. At minimum: Sec.3.1's `>` boundary flipped to `>=`;
   **Sec.3.1's filler exclusion removed** (must go red on a corpus map — this is
   the 23-against-6 mutant, and it is the one with a measured number on both
   sides); **Sec.3.2's severity split collapsed back to one error finding** (must
   go red on the `avoid_actor_area` fixture); Sec.3.2's suppression rule disabled
   (confirms the double-report the rule exists to prevent); Sec.3.2's
   resolved-value comparison reverted to token text
   (must go red on the `#const`-named-area fixture, which is the false positive
   the check would otherwise ship); **Sec.3.2's declaration walk stopped at
   `OrphanBlockNode`s** (must go red on the shared-block fixture — this is the
   `Pa_Site` mutant, and it is the one that reintroduces an error-severity
   false positive on a shipped map); **Sec.5.4's notes grouping reverted from
   text to `key`** (must go red on a fixture producing two spans with one
   text, which is the 134-identical-lines mutant); Sec.4.2's aggregation key
   changed from `commandSpan` to a looser one (confirms cross-command bleed is
   caught); **Sec.5.1's `{0,0}` backstop removed** (must go red on the corpus
   assertion in item 2, via `sample.rms`); **Sec.5.1's S3 label rule reverted to
   the `{0,0}` test** (must go red on the corpus assertion too — this is the
   5-of-32 mutant, and it is the one that goes green under the rule rev 9
   shipped); **Sec.5.1's zero-attempt guard removed** (must go red with `NaN` in
   a Spawn rate cell, on the corpus and on the `landMissing` fixture);
   **Sec.5.1's zero-attempt rows given `0%` instead of the non-numeric cell**
   (must go red on the fixture that asserts the two are different claims);
   **Sec.5.1's zero-attempt player counts EXCLUDED from the worst-player-count
   order rather than ranked below every rate** (must go red on the mixed-matrix
   fixture and on item 2's invariant — this is the 65-row mutant, and it is the
   one that goes green under the rule rev 10 shipped);
   **Sec.5.1's ABSENT player counts folded in as zero-attempt**
   (`?? 0` over the matrix — must go red on the absent-count fixture and on
   item 2's second invariant, 352 rows and 146 on a clone; this is the mutant
   that goes green under every assertion written for the 65-row one);
   **the Failure buckets cell counted as failure RECORDS rather than
   `occurrences`** (must go red on the reporter's own occurrence pins — the
   two conventions differ by three orders of magnitude, 2833 against 2 026 194,
   and a probe reading the non-existent `failure.count` silently produces the
   record reading while `tsc` stays green only because Vitest never runs it);
   **Sec.4.2's `runsContaining` dropped from the aggregate record** (must go red
   on the partially-present corpus case, where a 1-of-15 rate then prints as a
   15-of-15 one); **Sec.5.1's Failure buckets taken over the matrix instead of
   the worst player count** (must go red on item 2's third assertion — **2306**
   rows by bucket count and **191** by bucket set, occurrence-weighted; NOT the
   462/803 exceeds-`attempted` figure, which is a reporter line rather than a
   gate);
   **Sec.5.1's S5 reason stated unconditionally as an empty pairing** (must go
   red on the bug-shape fixture — the two push sites are byte-identical in the
   report, so only the note discriminates); **Sec.5.4's spanless groups emitting
   an empty `table`** (must go red on the automatic-beach fixture);
   **Sec.5.4's group spans
   emitted on one `severity` block instead of on a `table`** (must go red on a
   fixture whose group holds two spans, asserting both survive — the union holds
   one span per `severity`);
   **Sec.3.3's third fork arm routed to the surface test** (must go red on the
   unresolvable-name fixture, which is the three-set reading re-entering through
   the case the fork forgot); **Sec.3.3's producer resolution narrowed to the
   instantiation's `symbols` alone** (must go red on a fixture whose `#const`
   sits in an untaken `if` — the `TL Black Forest` shape, 88 occurrences); and
   Sec.4.2's `failureMarks` fold **re-enabled**.

   **Five more, all added by rev 14 and all against defects the first
   implementation actually shipped**, so each is a mutant whose green world is a
   world this repo has already been in:
   - **Sec.5.1's cross-count collapse removed** (must go red on the lifecycle
     fixture asserting **exactly one** error block at `playerCounts: ["2","4"]`;
     the predecessor assertion was `toBeGreaterThan(0)` and passed on the
     duplication, which at corpus scale is 1024 blocks over a 1000 cap).
   - **Sec.5.1's static families rendered one `severity` per occurrence** (must
     go red on `Pa_Site_v1.1.rms` through `validateToolMessage`, not through a
     block count — the host's own check is the assertion, because the host's
     own check is what killed the run).
   - **Sec.5.4's fourth pipeline step removed** (must go red on the fixture
     carrying the SAME span under texts differing by a number, asserting
     `count === 1`; a range fixture with no span and a dedupe fixture with one
     text are BOTH green in the mutant world, which is what the first two
     tests were).
   - **Sec.5.4's group count taken as `spans.length`** (must go red on the
     spanless run-level fixture, which then reads `0`).
   - **Sec.5.1's denominator clause removed** (must go red on the partially-
     present corpus case from item 3, where a 1-of-15 rate prints bare).

   **That last one has to be split per path, and it cannot be a corpus
   assertion.** Sec.4.2 was sharpened in this same round to say the two
   `fromOriginFallback` paths do different things: the ordinary give-up path
   pushes `originFallbackCenter` (so folding DOUBLES an existing count), while
   `grouped_by_team`'s extras push `notSimulated` (so folding FABRICATES an
   `originFallbackCenter` count no failure record carries). One assertion
   covering both fails for the wrong reason on one of them — the partial-fold
   failure mode `tools-api-design.md` rev 9 wrote a rule about. Two mutants,
   two fixtures: a script whose borders leave no legal origin area (doubles),
   and a `grouped_by_team` script with an `assign_to`'d extra (fabricates).

   **Fixtures rather than corpus maps, because the corpus does not produce
   marks any more.** Re-measured across **all 51 maps on this
   mount (32 tracked + 19 `test-maps/local/`) at 4 players, Normal, seeds 1 and
   2**: zero `FailureMark`s, zero `originFallbackCenter` and zero
   `notSimulated` in any S1 report. The control reading in the same pass —
   added because a reporter that finds nothing is indistinguishable from one
   that is broken — came back 10,673 S1 `CommandReport`s carrying 652
   `growthShortfall` failures, so the instrument works and the population is
   genuinely empty.

   **Pin the control's counting convention or it stops being reproducible, the
   same way Sec.3.2's did.** A re-run of this measurement reproduces the zeros
   and the 10,673 to the unit and reads `growthShortfall` as **622**, because
   summing `PlacementFailure.count` and counting failure _records_ are two
   different numbers over the same data. Sec.3.2 pinned "(map, id)" for its
   findings in the previous revision and nobody carried the same clause down to
   this control. Which is which is forced rather than guessed: every
   `PlacementFailure.count` is at least 1, so the sum can only be the larger —
   **652 is the sum of `count`, 622 is the number of records.** The control's
   job is to be non-zero, so either serves; the reporter states which it prints.

   `types.ts`'s own "`originFallbackCenter` fires **6 times, on 2 maps**"
   therefore does not reproduce at these settings. It predates BUG-009 (the
   land-origin cross measured against the border box rather than the map,
   landed 2026-08-12), which is exactly the change that would stop origins
   giving up — but this run varied neither player count nor map size nor seed
   beyond two, so the honest statement is that the figure does not reproduce
   here and needs re-measuring, not that it is wrong. Either way a mutation
   test written against "the two corpus maps that produce marks" is vacuous on
   this mount and doubly vacuous on a clone, where `.gitignore` removes the
   local half — the `test-maps/local/` trap `tools-api-design.md` rev 8 already
   recorded once.

**The earlier list — everything above this point in item 6 — is now run (2026-08-22), one mutant at a time, each reverted to byte-identical before the next.** 18 of the 23 confirmed clean: `>`→`>=`; the filler exclusion; the severity split; the suppression rule; the `{0,0}` backstop; the S3 label rule; the zero-attempt guard; the `0%`-instead-of-marker rewrite; the zero-attempt-excluded-from-ranking rewrite; the absent-folded-as-zero-attempt rewrite (`cellStateOf`); `runsContaining` dropped; the S5 reason stated unconditionally; the spanless-table rewrite; the group-spans-on-one-`severity` rewrite; the notes grouping reverted to key; and the third fork arm removed. Full run/revert log is `docs/build-log.md`'s 2026-08-22 entry.

**Five did not go red, and none of the five is a false pass — each is a real gap, confirmed by applying the mutation and reading why the suite stayed green rather than assumed.** Sec.3.2 rule 2's `resolveDeclarationId` mutation (resolved value → token text) is masked by its own neighbour: `checkActorAreas`'s "Rule 2's explicit union, restated" (`staticChecks.ts:283-284`) folds `inst.actorAreas`/`instValuesBySpan` into `declaredIds` unconditionally, and the `#const`-named-area fixture's declaration sits in the selected branch, so that fallback already carries the numeric value regardless of what rule 1's resolution returns. No fixture isolates rule 1 from the fallback — the one that would is a `#const`-declared `actor_area` inside an UNTAKEN `start_random` branch, which `instValuesBySpan` cannot see either. The Failure-buckets-as-records mutation (`aggregate.ts`'s `existing.occurrences` fold) is masked by coincidence rather than by design: the one fixture exercising it sums 3 (explicit) against 1 (default), and record-count and occurrence-sum both land on 4 — the fixture needs a SECOND generation whose own `occurrences` exceeds 1 to tell the two conventions apart, and none does. The Failure-buckets-over-the-matrix mutation (worst cell's failures replaced with a matrix-wide union in `buildFindingTables`) has no fixture at all across `report.test.ts` or `consistencyChecker.test.ts` with different buckets at different player counts on one row — checked both files before concluding this. Sec.3.3's producer-resolution-narrowed-to-`inst.symbols` mutation (`computeTerrainSurface`'s `symbols` map) has no fixture with a `#const` terrain name sitting in an untaken `if` (the `TL Black Forest` shape item 1 asks for) — every terrain-surface fixture in `staticChecks.test.ts` uses a literal terrain name. And the walk-stops-at-`OrphanBlockNodes` mutation (`walkItems.ts`) DOES go red, but only by collision: `walkItems` is shared, so the mutation is caught by Sec.3.3's own orphan-block terrain-surface fixture rather than by a dedicated Sec.3.2 declaration-side one — item 1's "Pa_Site" shared-block fixture for the DECLARATION side was never written, so a regression scoped to Sec.3.2 alone (leaving Sec.3.3's callers of `walkItems` untouched) would still ship clean.

**The 23rd — Sec.4.2's `failureMarks` fold re-enabled — has no code left to mutate.** `aggregate.ts` never imports or reads `FailureMark` at all; grep across `src/tools/` returns nothing. The concept was superseded twice over before this list could reach it: the design's own conclusion two revisions before rev 14 was to ignore `FailureMark`s entirely (never fold them), and rev 14's own five-mutant block above already split the underlying defect into the two `fromOriginFallback`-path mutants (doubles / fabricates) and ran both red. There is nothing here to force a mutation onto without inventing a fold the implementation never shipped.

## 9. Open questions, named rather than guessed at

- **The 32×131 restriction table is DECLINED as a prerequisite and scheduled as
  a follow-up. This is a decision, not a gap.** Expanding
  `terrainRestrictionId` into a top-level table in `game-constants.json` — 32
  rows × 131 terrains, about **4.2 KB** as a bitmask against the 1.33 MB that
  per-row expansion cost, which is the shape CREATION_PLAN 4.10 rejected on
  measurement — would take Sec.3.3's tier 1 from 31 rows to all 2666. It is
  worth doing. It is **not** worth blocking the flagship tool on, because
  writing it needs a schema change, a `--terrain-table` change, **and a
  regeneration from a maintainer's local DE install**, which no agent session
  can run: the app ships with no dat and `--terrain-table` re-expands on demand
  from an install. Sec.3.3 tier 1 tests the field per row, so the table lights
  up the remaining 2635 rows with no change to this document or to the checker.
  (The schema-description half of this bullet is **done** — the
  `terrainRestrictionId` and `allowedTerrains` descriptions were corrected on
  2026-08-16, see Sec.2 — so what is open here is the table alone.)
- **An actor-area id written as a name nothing defines is nobody's diagnostic
  today, and it belongs to the parser rather than to this tool.** Sec.3.2 is
  silent on it by decision (an unresolved name in a numeric slot is `validate()`'s
  territory) and the Monte Carlo layer reports it only as an `actorAreaMissing`
  bucket on a row with no spawn rate (Sec.5.1 — the commands attempt nothing).
  `AK_Vanguard_v1.2.rms` carries 18 of them and `validate()` produces 5
  diagnostics on that map, none naming the constant. Whether an RMS03xx code
  should cover it is a `parser-design.md` question — and the positive-resolver
  rule does **not** forbid it, since the evidence is the script's own `#const`
  table rather than absence from reference data. Filed here because this is
  where it was found; it changes nothing in this document either way.
- **Whether a `#const NAME OTHER_CONSTANT_NAME` alias resolves is filed as
  BUG-015, not decided here.** `#const TERR_CORNER GRASS2` is legal RMS the
  engine resolves trivially; `instantiate.ts` keeps only numeric `#const`s, so
  the preview reports 97 `terrainAbsent` failures across two corpus maps with a
  detail that names the alias and claims the reference data does not know it —
  a false statement about data that knows `GRASS2` perfectly well. The checker's
  surface inherits the same hole (Sec.3.3, reading C against reading B), and it
  is the generator's decision to make first because the generator is the one
  painting the wrong map. This document takes reading B until that entry lands
  and abstains where the loss is large, which is the direction that cannot
  invent a finding.

  **UPDATE 2026-08-24 — BUG-015 has landed, and this note's own figures were
  wrong.** `InstantiatedScript` now carries `aliases`, stored UNRESOLVED, and
  each resolver chases one hop against its own table: `resolveTerrainId` retries
  the target as a terrain name, `objectEntry` as an object name. So the answer
  is **reading C, scoped by slot** — the alias resolves where the written slot
  says which domain it belongs to, and nowhere else, because `#const` values
  share one namespace with flags and attribute ids. **The object half was the
  larger one** (108 corpus definitions name an object constant against 96 that
  name a terrain), which neither this note nor the bug entry mentioned.

  Two corrections to the paragraph above, both worth keeping because they are
  about the instrument rather than the fact. _"97 `terrainAbsent` failures
  across two corpus maps"_ does not reproduce: the real figure is **1,569 across
  46 maps**, because the bucket also carries _"no tile currently matches this
  patch's `base_terrain`"_, which is a resolved terrain with nowhere to go and
  not this defect at all. And the fix moves that count by **seventeen** while
  taking `24hr_Battle Lines 1.0.rms` from **one distinct terrain on the entire
  grid to six, and 324 objects to 921** — so the failure count was very nearly
  blind to the bug, and the grid was the instrument all along.

  **Still owed here:** Sec.3.3 abstains where the loss is large, and that
  abstention was sized against the pre-fix surface. Re-measure it before
  trusting the current threshold.

- **Sec.4.3's structured-clone cost is unmeasured.** The JSON figure is an upper
  bound on a different operation (Sec.4.3). What the tool actually pays per run
  is one `postMessage` of a `ToolContext` with aliasing preserved, and nobody has
  timed it. Measure before optimising, and before quoting.
- **Sec.4.1's seed derivation is unmeasured for correlation** (Sec.4.1 already
  flags this in place). Cheap to check once the loop exists: run the checker
  twice with `baseSeed` and `baseSeed + runsPerPlayerCount` and confirm the
  aggregate report doesn't repeat structure.
- **Whether a declared count that cannot fit is ever worth reporting
  statically** (Sec.3.4 cuts the packing bound). The blocker is a discriminator
  between the fill idiom and a mistake, and none is known; the honest answer
  today is that the Monte Carlo layer's spawn rate says the same thing with
  measured numbers. Reopens only if a discriminator is found, and returns as
  info beside the spawn rate rather than as a finding of its own.
- **~~Sec.3.3's corpus count is the one static number this revision did not
  measure.~~ CLOSED in this revision — and the reason it stayed open is worth
  more than the number.** Two revisions inherited "the check cannot run until
  Sec.7.0's resolver export lands" from a revision that wrote the export
  afterwards. Applying it verbatim takes ten minutes; the check runs in seconds;
  its two warning-severity findings were both false, and the info row it produced
  in the same run then went one further revision unre-derived (Sec.3.3, Sec.8
  item 2). **Every static row in Sec.8 item 2's table is now a measurement**, and
  every row of every table that run produced has been taken under the same
  reading — which is the position four review rounds were spent getting to.
- **The tier-2 fork's one corpus finding is UNDECIDED, and it is undecided in
  the way this project settles by generation rather than by argument.**
  `Chaotic_Straitv0.99.rms` places unit 1641 (`habitat: "land"`, restriction 4,
  `verified: true`) on `DLC_NEWSHALLOW` (`isWater: true`, `verified: false`,
  transcribed from the community table). Either the line is a real defect the
  engine passes silently, or `isWater` is wrong for that row. **The run that
  decides it is an RMSTEST-style generation** placing a restriction-4 object on
  terrain 59 and probing the export for it — the same instrument that settled
  `terrain_to_place_on`, `max_distance_to_other_zones` and the beach rule.
  Until then Sec.3.5's gate prints it as info, which is the honest severity for
  a finding whose own input is unverified. **Do not tune the check to make it
  disappear**; that is the move `border_fuzziness` and `set_zone_by_team` both
  record the cost of.
- **Whether `"shore"`/`"amphibious"` habitats can ever be soundly bounded
  statically** (Sec.3.3 defers both). If the automatic-beach rule's coverage
  is ever measured precisely enough (an RMSTEST-style run, matching how the
  rest of this project settles engine behavior), this reopens as a narrow
  addition rather than a redesign.
- **Sec.3.3 clause 2's abstention threshold stays INTERIM at `1/3`, and rev 14
  turned the argument into a measurement without moving the number.** All 32
  maps are now measured through the resolver the check calls (Sec.3.3 clause 2's
  table): the corpus is bimodal, **two maps fire at 72.5% and 53.9% and the
  highest non-firing map is 8.3%**, with nothing between. `1/3` sits 4.0× above
  one edge of that gap and 1.6× below the other, so no placement inside
  `[0.09, 0.53]` changes a single map and re-tuning would be tuning to noise.
  **What keeps it interim is the shape of the corpus rather than the absence of
  a run**: 30 of 32 maps read exactly 0.0%, so nothing here constrains the low
  side, and the first script that lands at 15–25% is new information.
  **Also closed with it**: the clause's two anchors were quoted from
  denominators that were not this one (Battle Lines's _"50 of 67"_ is BUG-015's
  occurrence count, `Menindee`'s _"1 of 539"_ a wider population again, and
  against the resolver's own denominator `Menindee` reads 0 of 75) — the
  denominator is now stated in the same sentence as the rule. The abstention
  costs **0 findings**: `terrainImpossible` measures 2 corpus-wide with it live,
  the same 2 the section already pins, and neither is on an abstaining map.
- **Whether a confidence interval belongs in a later revision** (Sec.5.3 states
  the honest limit rather than computing one). PLAN.md does not ask for one;
  raised here so it is a decision, not a gap nobody chose.
- **`types.ts`'s `originFallbackCenter` figure does not reproduce and belongs
  to `preview/`, not to this tool.** Sec.8 item 6 measured zero across all 51
  maps at one settings combination, against a comment claiming 6 on 2 maps.
  BUG-009 is the plausible cause and one run at a second player count and map
  size would settle it. Filed here because this document is where it was found;
  the fix, if the re-measurement confirms it, is a comment in
  `src/preview/generator/types.ts` and possibly a Sec.15 item, not a change to
  the checker.
