# Approximate Preview Design (Phase 4.1, rev 3)

Spec for the approximate map preview generator in `src/preview/`. Design only — implementation follows in 4.2 (canvas renderer) and 4.3 (generation heuristics). Rev 2 folded in the first critique, rev 3 the second (changelogs in Appendices A/B). Sources: PLAN.md (Current/Final toggle, "approximate" mandate), `docs/parser-design.md` (AST shape, §2.2 math semantics the generator must implement, §13.9 preview inputs), and the Definitive RMS Guide (`reference-docs/definitive-rms-guide-2026-07-16.txt`) — all engine-behavior claims below cite it. **Implementation sessions: do not deviate from this spec — if something seems wrong or ambiguous, stop and escalate.**

## 1. Goals and non-goals

Goals, in priority order:

1. **Honest approximation.** The preview conveys *layout* — where lands, terrains, hills, and objects plausibly end up — never a claim of pixel- or seed-accuracy. Every rendering is labeled approximate (§9). We would rather show nothing than show something confidently wrong.
2. **Structured failure instrumentation.** Every placement function returns a structured failure reason on a miss — never bare `false`. This is a hard design requirement from CREATION_PLAN 5.2: the Generation Consistency Checker consumes this instrumentation, and retrofitting it is painful. See §7 — it is the contract, not an afterthought.
3. **Never throws.** Like the parser: any ParseResult (including ones full of RawNodes and diagnostics) produces a PreviewResult. Unsimulatable regions become SimulationNotes (§9), not exceptions.
4. **Fast enough for live update.** Full pipeline on a 200×200 map inside a web worker, debounced on code change, with cancellation. Budget in §11. Cheap enough that 5.2 can run ~1000 generations in seconds.
5. **Deterministic.** Same (ParseResult, settings, seed) → identical PreviewResult, byte for byte. This is what makes the re-roll button meaningful and the 5.2 Monte Carlo reproducible.

Non-goals: seed parity with DE (our seeds mean nothing in-game and the UI must never imply otherwise); full-fidelity rendering (later milestone, possibly via game-state reading per PLAN.md); simulating everything in §9's exclusion list; incremental regeneration (full regen is cheap; the API is pure so incremental can come later).

## 2. Position in the architecture

```
ParseResult ─┐
refDb (language.json + game-constants.json) ─┤
GenerationSettings (playerCount, mapSize)  ─┼→ [worker] generatePreview() → PreviewResult
seed + PreviewOptions ─┘                              │
                                                      ├→ 4.2 canvas renderer (grids, objects, markers)
                                                      ├→ status-bar notes / Problems-adjacent surfaces
                                                      └→ 5.2 Consistency Checker (reports, batch mode)
```

The generator is a **pure function hosted in a web worker** (same discipline as the parser: no imports from React, Monaco, or Tauri anywhere under `src/preview/generator/` — it must run in a bare worker and in Node/Vitest unchanged). The renderer (4.2) is a separate, dumb consumer: it draws whatever grids and marker lists it is given and owns zoom/pan/diamond projection; it contains no generation logic. Renderer contract, minimally: terrain fill from `previewColor` (§12), `layer` as an overlay tint, **elevation as brightness shading** (lighten toward the light-source edge per height step, darken opposite — cheap slope shading, no 3D), cliff glyphs, object dots/glyphs colored by `category`, numbered player markers, and the §9 badge.

Consumers and their needs:

- **Preview pane (4.2/4.3):** snapshots + objects + players + notes; re-roll and Current/Final toggle.
- **Consistency Checker (5.2):** `reports` with `collectSnapshots: false` for cheap batch runs across a player-count matrix.
- **Status bar (existing):** resource totals stay AST-derived (Phase 2.5) — the preview does NOT replace them in v1; a note in 5.2's design may reconcile the two later.

## 3. Script instantiation — evaluating what the parser deliberately didn't

The parser never evaluates conditionals, randoms, or math (parser-design §1 non-goals; §2.2 explicitly assigns those semantics to us). Stage 0 of every generation is an **instantiation pass** that walks the AST and produces a flat, per-section list of concrete commands — mirroring the engine's token-filter model.

Rules (each cites its source):

1. **Environment.** Predefined labels derived from GenerationSettings: the map-size labels for the active size — both legacy and modern per §4's table, and **note the names are offset**: the app's Normal (200×200) defines `LARGE_MAP` *and* `MAPSIZE_NORMAL`; `MAPSIZE_LARGE` is the next size up (220×220, legacy `HUGE_MAP`); Giant has no legacy label at all. Use §4's table columns verbatim — guessing the pairing by name produces silently wrong branch selection on every size-aware map. `<N>_PLAYER_GAME` for the active player count, `DE_AVAILABLE` and its version-detection chain set, standard-lobby defaults for the rest (no REGICIDE, no EMPIRE_WARS, etc.). Team labels (`TEAMx_SIZEy`, `PLAYERx_TEAMy`): v1 settings have no team configuration → evaluate as **undefined**, and emit one SimulationNote the first time a script tests one ("team setup isn't configurable yet — team conditionals evaluate as false"). Adding a teams control to the generation-settings pane is a v1.x follow-up.
2. **`if`/`elseif`/`else`:** select the first branch whose condition label is defined in the environment (user `#define`s included, in stream order). Deterministic, not random.
3. **`start_random`/`percent_chance`:** roll once per RandomNode from the stage-0 RNG substream (§8). Model (pinned to the guide's Random Code rules): roll `r` = uniform integer 1–100; branches claim cumulative ranges in declaration order, truncated at 99; a branch fires when its range covers `r`. **The 100th percent is never chosen** (guide) — `r`=100 is always the no-branch outcome, so even totals summing to exactly 100 leave a 1% no-branch chance; totals <99 leave a larger one. The engine's occasionally-chosen-`percent_chance`-0-first-branch bug is NOT simulated (§9; validate() already warns against writing it).
4. **Symbols:** `#define` marks defined; `#const` first-definition-wins, including silent no-op when shadowing a predefined name (parser-design §8). `#undefine` does nothing.
5. **`rnd(a,b)`:** evaluated at consumption time from the current substream, uniform integer inclusive.
6. **Math expressions (ArgNode `expr`):** implement parser-design §2.2 *exactly*: strict left-to-right, **no precedence, no nested parentheses** (a nested `(` operand is silently not-a-number — the engine drops it; do NOT implement standard precedence out of habit), constants resolve to numeric values, `inf`/`-inf` native, floats flow through, divide-by-zero → 0, `%` is **truncation toward zero** and `x % 0` → left operand truncated toward zero, rounding to integer (0.5 up) only where a float meets an integer-only slot. Verify item #18 (negative-float modulo) still governs: implement whatever the in-game test showed, and leave a code comment pointing at it.
7. **`behavior_version`** (0–2): a stream variable; the value in effect when a land command is instantiated governs that land's tile accounting (§6.1). We treat 2 as 1 (guide reports no observed difference) with a SimulationNote.
8. **`override_map_size`** (36–480, clamps): applied if it is in effect **before the first land command**; later overrides are recorded as a SimulationNote and ignored (the engine technically re-sizes mid-script; not worth simulating — flagged in §9's list). Scaling attributes use the overridden area.
9. **RawNodes and unknown commands:** skipped, one SimulationNote each with the node's span ("this region isn't simulated in the preview"). Includes (`#include_drs`/`#includeXS`): one prominent note — "this map depends on include files the preview cannot see; the preview is missing whatever they generate."
10. **Duplicate attributes within a block:** last-wins, EXCEPT attributes flagged `repeatable` in language.json (`spacing_to_specific_terrain`, `replace_terrain`, `terrain_cost`, connection radius attrs, `avoid_actor_area`) which accumulate (parser-design §8 — the same rule that keeps Breakdown from corrupting connection blocks). **Prerequisite:** `repeatable` flags do **not** yet exist in language.json (parser-design §13.4, still open — the same data trap breakdown-design rev 2 documented in its §0.1). Until the data lands, the generator ships a pinned hardcoded fallback list — exactly the names above — with a comment pointing here. Implementing blanket last-wins would silently corrupt connection simulation (corpus blocks carry dozens of `replace_terrain`/`terrain_cost` lines).
11. **Duplicate sections merge; sections process in canonical engine order** (LAND → ELEVATION → CLIFF → TERRAIN → CONNECTION → OBJECTS) regardless of file order, matching the engine's merge behavior (guide line 148 area; parser-design §4).

Output: `InstantiatedScript` — per-section arrays of resolved command records (numeric args final, attribute maps folded, each retaining the source span of its originating CommandNode for click-through and failure reporting).

## 4. The tile model

The grid is square, `dim × dim` tiles. `dim` comes from the settings pane's MapSize (or `override_map_size`):

| App MapSize | Legacy label | Modern label | Dimensions | Area ratio (vs 100×100) |
|---|---|---|---|---|
| Tiny | `TINY_MAP` | `MAPSIZE_TINY` | 120×120 | 1.4 |
| Small | `SMALL_MAP` | `MAPSIZE_SMALL` | 144×144 | 2.1 |
| Medium | `MEDIUM_MAP` | `MAPSIZE_MEDIUM` | 168×168 | 2.8 |
| Normal | `LARGE_MAP` | `MAPSIZE_NORMAL` | 200×200 | 4.0 |
| Large | `HUGE_MAP` | `MAPSIZE_LARGE` | 220×220 | 4.8 |
| Huge | `GIGANTIC_MAP` | `MAPSIZE_HUGE` | 240×240 | 5.8 |
| Giant | *(none)* | `MAPSIZE_GIANT` | 252×252 | 6.4 |

Legacy and modern names are **offset by one size** for Normal/Large/Huge — this is the guide's table, confirmed by its own live example (`elseif LARGE_MAP create_actor_area 100 100 …` — the center of a 200×200 map). §3.1's environment sets both columns for the active row. For `override_map_size` beyond these, `LUDIKRIS_MAP`/`MAPSIZE_LUDICROUS` = 480×480, ratio 23.0; other override dims define no size labels (dims and labels are independent inputs — labels come from the lobby size, dims may be overridden).

(Guide Map Sizes table. ⚠ The `MAP_SIZES` array in `generationSettingsConstants.ts` currently orders Giant before Huge, but in-game Giant (252) > Huge (240) — reconcile the constant's order/labels during 4.3, don't silently re-map.) The area ratio drives every `set_scale_by_size` / `set_scale_by_groups` / `set_scaling_to_map_size` computation: scaled value = declared value × (dim²/10000).

**Coordinates:** tile `(x, y)`, `x, y ∈ [0, dim)`. `land_position %X %Y` maps to `(round(X/100·dim), round(Y/100·dim))`. Corner semantics per the guide: (0,0) = west corner, (99,99) = east, (99,0) = north, (0,99) = south. Borders: `left_border` = southwest edge (x=0), `right_border` = northeast (x=max), `top_border` = northwest (y=0), `bottom_border` = southeast (y=max). The renderer owns the diamond projection of this grid; the generator never thinks in screen space.

**Layers** (typed arrays, allocated once per generation):

```ts
interface TileGrid {
  dim: number;
  terrain: Uint16Array;    // terrain id (index into refDb terrain table)
  layer: Uint16Array;      // base_layer / terrain_mask visual layer, 0 = none
  elevation: Uint8Array;   // 0-16
  cliff: Uint8Array;       // 1 = cliff tile
  landId: Int16Array;      // which land claimed this tile; -1 = base terrain
  zone: Int16Array;        // zone of the claiming land (defaults per §6.1)
  occupied: Uint8Array;    // object occupancy (objects stage)
}
```

Derived masks (computed on demand, cached per stage): distance-to-terrain maps for spacing checks (one BFS distance transform per queried terrain id), forest-zone mask (tiles whose terrain is flagged `isForest` in refDb, plus placed tree objects, plus 1-tile adjacency — guide `place_on_forest_zone` semantics), water mask (`isWater` flag).

## 5. Pipeline stages, snapshots, and the Current/Final toggle

Stages run in fixed order; each ends with an optional snapshot (copy of the mutable grids at that point):

```
S0 instantiate → S1 lands → S2 elevation → S3 cliffs → S4 terrains → S5 connections → S6 objects
```

`PreviewResult.snapshots` holds one entry per stage S1–S6 when `collectSnapshots: true` (objects aren't in the grid; the S6 snapshot is the final grid plus the full `objects` list). Snapshots copy **only the renderable layers** — `terrain`+`layer`+`elevation`+`cliff`, 6 bytes/tile (`landId`/`zone`/`occupied` are generation state the renderer never reads): 6 B × 480² × 6 snapshots ≈ 8 MB worst case at Ludicrous — acceptable, and snapshots are skipped entirely in 5.2 batch mode.

**Current/Final toggle (per PLAN.md and the Breakdown side-panel mockup):**

- **Final** = the S6 result: full map, objects included.
- **Current** = the snapshot for the pipeline stage the user is *editing right now*: in the Breakdown tab, the stage matching the active section sub-tab; in the Code tab, the stage of the section containing the cursor. Contexts with no section affiliation fall back to the **post-elevation snapshot (S2)** — PLAN.md's "without post-elevation & object passes" reading. Note the context-sensitive "stage being edited" behavior is a design *extension* of PLAN.md's fixed toggle (only the S2 fallback is its letter) — confirm with Ash before wiring (§15).

The generator always runs all stages (reports and totals need S6); the toggle only selects which snapshot the renderer draws. HelpTip ids for the toggle, re-roll button, and seed chip are mandatory (CLAUDE.md convention).

## 6. Stage designs

Every "pick a tile / grow a region / place a thing" operation goes through the instrumented placement layer (§7) and draws randomness only from its stage substream (§8). Heuristic parameters marked **[tune]** are 4.3 calibration knobs — start with the given value, iterate against real screenshots.

### 6.1 Lands (S1)

Engine model (guide <LAND_GENERATION> intro): land *origins* (square bases) are placed sequentially in script order; then **all lands grow simultaneously** from their origins until they hit their size target, a border, or another land.

**Base fill:** `base_terrain` (default GRASS) fills the grid; `base_layer` fills `layer`.

**Player lands** (`create_player_lands`, expanded to one land per active player):

- Default placement: origins on a circle. Radius: `circle_radius` values are a **percentage of map width** (guide), and so is our default — nothing here is in tiles. Two regimes for borders (guide distinguishes them): the *default* circle's center = map center shifted by borders (borders shift the whole circle); an *explicit* `circle_radius` **ignores borders when placing origins** — center stays at map center — though growth remains border-constrained. Use the explicit value if given (with multiple `create_player_lands` commands, only the **final** radius applies — guide); else **40 [tune]** with variance **20 [tune]** (guide: "standard radius … around 40", "20 seems close to the standard variance"). Angles: players evenly spaced, whole ring rotated by a random offset, each player's radius jittered by variance independently.
- `grouped_by_team`: without team data (v1), behaves as random_placement + SimulationNote (§3.1).
- `direct_placement` in <PLAYER_SETUP>: disables circular positioning; player lands with `land_position` go exactly there; assigned `create_land`s likewise (guide direct_placement).
- `land_percent P` on player lands: total-map percentage **divided equally among players**; `number_of_tiles N`: N **per player** (guide).

**Neutral lands** (`create_land`): origin =

1. `land_position` if present (ignores borders; if outside borders, the land will not grow past base_size — emulate).
2. Else a rejection-sampled random tile: inside borders, inside the **cross-shaped area** (not corners) unless `generate_mode 1` — approximate the cross as: reject candidates where *both* |x−center| and |y−center| exceed **dim·0.35 [tune]**; at least `base_size` from every edge; at least `min_placement_distance` (center-to-center; default: `other_zone_avoidance_distance` edge-to-edge) from prior origins. **K = 100 [tune]** attempts; on exhaustion, the engine places the land **at map center, overlapping whatever is there** — we do the same and record `originFallbackCenter` (§7), which is exactly the signal 5.2 wants.

**Origin stamp:** square of radius `base_size` (default 3 → 7×7), or inscribed circle if `set_circular_base`. Origins may overlap; later stamps overwrite (guide: "the land placed last will be the one visible").

**Zones:** player land i → zone `i − 10` (each unique); `create_land` default → zone −10 (shared); `zone N` explicit; `set_zone_by_team` → team zone (v1: distinct per player + note); `set_zone_randomly` → uniform in [−8, playerCount−9]; zone −12 → belongs to no zone (other zones may grow over it).

**Size targets:** `land_percent` → `P/100 · dim²` tiles (per-player division applied first); `number_of_tiles` → N. behavior_version 0: target is *additive* to the origin square; version 1/2: origin square *included* in the target (guide behavior_version). Default when neither given: land_percent 100.

**Growth — synchronized frontier expansion:** all lands grow in round-robin turns, one tile per unfinished land per round (this approximates "growth happens all at once"). Per turn, a land picks from its frontier (empty candidates 4-adjacent to owned tiles) with weight `(1 + neighborsOwned)^(clumpingFactor/8)` **[tune]** — `clumping_factor` default 8 for lands; higher → rounder, ≤0 → snakey, matching the guide's described ranges. A candidate is rejected if:

- outside a border, with probability `border_fuzziness`% (default 20; 0 = ignore borders, 100 = hard stop, negative values clamp to 100 — guide semantics: adherence percentage);
- within `other_zone_avoidance_distance` (the **smaller** of the two lands' values — guide) of a tile owned by a different zone (zone −12 exempt);
- already owned.

A land stops at target, or when its frontier is exhausted — recording a `growthShortfall` report (owned/target, dominant blocker among border/zone/space) for 5.2's land layer. `land_conformity` is **not simulated** (buggy in-engine, guide advises avoiding it) — SimulationNote when present.

`base_elevation H`: after growth, set `elevation = H` on the land's tiles — **skipped for lands with a water terrain_type** (guide: doesn't work in HD/DE) (requires <ELEVATION_GENERATION> present in-engine; if absent, note it — validate() territory but cheap to flag here too). `land_id`, `assign_to_player`/`assign_to` recorded on the land record for S6 (lands assigned to non-playing players are **not created** — guide).

### 6.2 Elevation (S2)

Per `create_elevation MaxHeight { … }` command:

- Tile budget `number_of_tiles` (default: ~120 tiles *on a Tiny map* per the guide → model as `86 × area-ratio` **[tune]**), clump count `number_of_clumps` (default 1); `set_scale_by_size` scales tiles, `set_scale_by_groups` scales clumps (DE-fixed semantics; only the *last* scale attribute applies — guide); budget divided equally among clumps.
- Clump seeds: random eligible tiles — terrain matches `base_terrain` (+`base_layer` if the map used one), **≥9 tiles from every player-land origin** (guide: "elevation avoids the origins of player lands by about 9 tiles"). Seed selection is **south-biased** unless `enable_balanced_elevation`: weight candidate rows linearly toward high y by factor **2× at the far south [tune]**; with the attribute, keep a slight residual bias **1.15× [tune]** (guide: still "slightly biased" even with it).
- Grow each clump like a land region (clumping weight fixed moderate [tune]) to its tile share.
- Height assignment: per clump roll target height `h ∈ [1, MaxHeight]` (single-clump commands always attempt MaxHeight — guide); tile height = `min(h, floor(distanceFromClumpEdge / spacing))` with `spacing` default 1 — concentric rings, wider flats for larger spacing. Heights add on top of `base_elevation` (DE-relative behavior).
- Misses (no eligible seed tiles) → `terrainAbsent` or `playerOriginAvoidance` failure reasons.

### 6.3 Cliffs (S3)

Coarse simulation — enough for layout honesty, no fine geometry (PLAN.md defers cliff fidelity; 5.2 defers cliff checking):

- Section present (even empty) → cliffs generate with defaults (guide: "simply typing the section header will generate default cliffs").
- Count = uniform `[min_number_of_cliffs, max_number_of_cliffs)` (min 3/max 8 defaults; max exclusive per guide). Length in segments uniform `[min,max]` inclusive (defaults 5/9); tiles ≈ `3·(len+1)` (guide: 3→12, 4→15, 5→18).
- Each cliff: random walk of 3-tile segments; direction change chance = `cliff_curliness`% (default 36) per segment. Start tiles: ≥22 tiles from every land origin, not on water, **not on sloped tiles** (cliffs "avoid any slopes" — guide; S2 elevation is already available at S3), ≥`min_distance_cliffs`·3 tiles from existing cliff tiles (default 2), ≥`min_terrain_distance`·3 tiles from water (default 2) (guide values). Walk steps that would violate constraints truncate the cliff (guide: "may end up shorter").
- Marks `cliff` mask; renderer draws cliff glyphs. The engine's under-cliff terrain-16 mechanics are **not simulated** (§9).

### 6.4 Terrains (S4)

Sequential per `create_terrain T { … }`, in script order (guide: "generated sequentially… positions cannot be directly specified"):

- Budget: `land_percent` (of total map) or `number_of_tiles` (default: ~122 tiles *on a Tiny map* per the guide → model as `87 × area-ratio` **[tune]**); `number_of_clumps` default 1; scaling per attribute — note the terrain-specific rule: `set_scale_by_groups` scales **both** clumps and tiles for terrains (guide), unlike elevation.
- Eligible tiles: terrain == `base_terrain` (and layer == `base_layer` if given); within `height_limits` if given; ≥`spacing_to_other_terrain_types` from any tile of a *different* terrain (distance-transform query); **pinned approximation:** cliff tiles also count as foreign terrain for this spacing — the engine gets this via under-cliff terrain 16, which we don't simulate (§9.7); ≥ each `spacing_to_specific_terrain T d` (accumulated list); `set_flat_terrain_only`: also ≥spacing from sloped tiles (only when spacing ≥1 — guide); `set_avoid_player_start_areas d` (default 13 when bare): ≥d from player origins with mild variance.
- Clump seeds from eligible set; grow with `clumping_factor` default **20** (terrains differ from lands — guide) restricted to eligible tiles; adjacent clumps may merge naturally.
- `terrain_mask 1/2`: write the new terrain into `layer` (mask over) or swap-with-layer (mask under) rather than `terrain`; rendered as a simple overlay tint, honesty note in §9. `beach_terrain`: after growth, set beach terrain on tiles of this clump bordering water (skip entirely if a <CONNECTION_GENERATION> section exists — guide documents that bug; emulating it IS the honest choice, plus a note).
- Failures: `terrainAbsent` (no eligible tiles at all — e.g. base_terrain never present on the map: a real, common map bug this preview should surface), `spacingConflict` (eligible set emptied by spacing), `budgetShortfall` (partial growth).

### 6.5 Connections (S5)

Per connection command, build the node set: `create_connect_all_players_land` → player-land origins (incl. assigned lands); `…teams_lands` → same-team pairs (v1 no-team → SimulationNote, treat as no pairs); `…all_lands` / `…same_land_zones` → all land origins, all pairs; `…land_zones z1 z2` → lands of those zones, all cross+intra pairs; `…to_nonplayer_land` → player×neutral pairs only (and emulate its documented bug: it blocks all subsequent connection commands — note emitted).

- Pathfinding: A* over tiles, cost per tile = accumulated `terrain_cost` for its terrain (default 1; ≤0 → impassable). Costs read the terrain state **at the start of S5** unless `accumulate_connections` (DE semantics — guide); with it, costs/replacements see prior connections' output.
- No path (impassable moat of cost-0 terrain, or unreachable land) → that pair's connection simply isn't produced (engine behavior) + `connectionBlocked` failure with the pair identified — prime 5.2 material.
- Terrain application along the path: for each path tile, radius = `terrain_size[terrain].radius ± uniform(variance)` (per-tile roll; negative effective radius → replace nothing — guide); within the disc, apply `replace_terrain old→new` (accumulated list; `default_terrain_replacement` = replace-everything, overriding earlier list entries but not later ones — emulate by expansion order). Replacements reference pre-S5 terrain per the same accumulate rule.

### 6.6 Objects (S6)

Sequential per `create_object` (order matters — engine places in order, first come first served). Object identity resolves through refDb; `create_object_group` picks per-placement uniformly from the group (the guide says the % weighting is bugged/inverted in-engine; uniform + note is the honest v1).

**Counts:** `number_of_objects` (default 1) × `number_of_groups` (default: ungrouped); `group_variance v` varies each group's count within `[n−v, n+v−1]` (positive range reduced by 1 — guide), floored at 1; `set_scaling_to_map_size` ×area-ratio, `set_scaling_to_player_number` ×playerCount — **mutually exclusive** (guide); if both appear, **last wins** (pinned, matching the guide's rule for the elevation/terrain scale-attribute pairs). Scaling applies to groups when grouping is present, else to objects (guide).

**Reference frame:**

- `set_place_for_every_player`: iterate player lands (per land, not per player — multiple create_player_lands → multiple placements unless `generate_for_first_land_only`); all constraints evaluated relative to that land's origin.
- `place_on_specific_land_id id`: iterate lands with that id (−11 → random map position). Missing id → `landMissing` failure for every intended placement.
- Neither → gaia scatter anywhere valid; `max_distance_to_players` inert (guide says only *maximum* "has no effect" without a frame). **`min_distance_to_players` still applies frameless — pinned:** candidate must be ≥min from *every* player-land origin (Chebyshev, or Euclidean under `set_circular_placement`) — this is how real maps keep neutral resources off starting towns. Also inert without a frame (all guide-marked "Requires: set_place_for_every_player or place_on_specific_land_id"): `find_closest`, `find_closest_to_map_center`, `find_closest_to_map_edge`, `ignore_terrain_restrictions`, `require_path`, `avoid_other_land_zones`, `generate_for_first_land_only` — accepted with a SimulationNote, not an error.

**Candidate filter** (each check is a named predicate contributing to §7 failure attribution):

- `occupied` free (unless `force_placement` — stacking allowed, occupancy skipped; force_placement is disabled under `set_loose_grouping` — guide);
- terrain habitat: object's coarse habitat class from refDb (land/water/beach/any — §12 data request; default "any land" + note) matches tile; `terrain_to_place_on` / `layer_to_place_on` exact matches; `ignore_terrain_restrictions` bypasses habitat;
- **implicit terrain-separation (default-ON for every frame-referenced placement):** the candidate must be *reachable from the reference land's origin* through tiles the object is not habitat-restricted on — the guide states this for both `set_place_for_every_player` and `place_on_specific_land_id` ("only be placed where they are not separated from the origin of their land by a terrain they are restricted on"), with road terrains explicitly not counting as separation. This — not the opt-in `require_path` — is the mechanism that keeps island resources on the owning player's island; without it the preview scatters player gold onto other players' islands on every water map, a highly visible lie. Bypassed by `ignore_terrain_restrictions`. Implement as one BFS reachability mask per (reference land, habitat class), cached for the stage;
- distance band `min/max_distance_to_players` from the reference origin — **square** (Chebyshev) by default, Euclidean with `set_circular_placement` (guide); `min > max` → deterministic zero placement, `minExceedsMax`;
- `avoid_other_land_zones d`: tile must belong to the referenced land, d from its edge;
- forest zone: `place_on_forest_zone` requires membership; `avoid_forest_zone d` requires distance ≥d (bare attribute → d=1 — guide);
- `avoid_cliff_zone d` (bare → d=1), `min_distance_to_map_edge d`, `max_distance_to_other_zones d` (min distance from habitat-restricted terrain — e.g. gold off coastlines);
- grouping scope for the constraints above: **tight groups → checks apply to the group center only; loose groups → to each member individually** (the guide self-contradicts here — the avoid_*_zone entries say member-level when grouped while the tight-grouping note says center-only; this is a *deliberate, pinned resolution* — 4.3 must not flip-flop);
- actor areas: `actor_area_to_place_in` membership, `avoid_actor_area`/`avoid_all_actor_areas` exclusion. `create_actor_area` records areas up-front regardless of script position (guide); `actor_area`+`actor_area_radius` on placed objects append areas as they place. Referencing a never-created id → `actorAreaMissing`;
- `min_distance_group_placement` (persistent spacing vs all prior and future placements) and `temp_min_distance_group_placement` (this command only) via a spacing field on placements;
- `require_path dev`: BFS from candidate to land origin over passable (non-habitat-blocking, non-cliff, non-wall) tiles; dev 0 = any path, 1 = path length ≤ **1.3× [tune]** straight-line, larger dev looser. Applies only to a group's first member (guide).

**Selection:** uniform random from surviving candidates (we always shuffle — `enable_tile_shuffling` becomes a no-op accepted silently), except `find_closest` (min Euclidean distance to land origin), `find_closest_to_map_center`, `find_closest_to_map_edge` (override precedence per guide). Groups: tight → flood-fill adjacent tiles from the group center; when tiles run out, place what fits (guide: "a perfect square worth of objects will be filled" — a capped partial fill, NOT all-or-nothing) and report `groupPartial` with placed/requested; `occupancyFull` is reserved for the zero-tiles case. Loose → independent placements within `group_placement_radius` (default 3), individual misses allowed (partial → `groupPartial` — mirrors the engine's documented behavior).

**Output:** `PlacedObject { objectRef, x, y, player?, category, groupId? }`. Player markers: one `PlayerMarker { player, x, y }` per player-land origin (renderer draws numbered flags). VILLAGER/SCOUT count quirks are cosmetic — place the declared count, note that DE spawn-count special-casing is not simulated. Walls: **not simulated** (§9) — one note per wall-type create_object.

## 7. Placement instrumentation — the 5.2 contract

The non-negotiable rule: **no placement primitive returns a bare boolean.** The shared vocabulary:

```ts
type PlacementOutcome<T> = { ok: true; value: T } | { ok: false; failure: PlacementFailure };

interface PlacementFailure {
  bucket: FailureBucket;
  commandSpan: Span;          // originating command's source span (click-through)
  stage: StageId;
  entity: string;             // "GOLD", "land #3", "connection P2–P5", …
  reference?: string;         // player/land frame if any
  detail: string;             // human sentence, beginner-first, like parser diagnostics
  data?: Record<string, number | string>;  // bucket-specific (e.g. owned/target)
}

type FailureBucket =
  | "noValidTiles"          // constraint intersection empty (generic terminal)
  | "terrainAbsent"         // required terrain/layer never present on the map
  | "spacingConflict"       // a spacing/avoidance constraint emptied the set
  | "occupancyFull"         // tiles exist but are taken (tight group / crowding)
  | "minExceedsMax"         // deterministic: min_distance > max_distance
  | "landMissing"           // place_on_specific_land_id unmatched / player land absent
  | "actorAreaMissing"      // referenced actor area never created
  | "pathBlocked"           // require_path found no acceptable path
  | "connectionBlocked"     // no route between a connection pair
  | "originFallbackCenter"  // land origin placement exhausted → engine center fallback
  | "growthShortfall"       // land/terrain/elevation grew < target (data: owned, target, blocker)
  | "groupPartial"          // loose group placed k of n members (data: placed, requested)
  | "zoneAvoidanceBlocked"  // other_zone_avoidance prevented growth/placement
  | "borderBlocked"         // border constraints prevented growth/placement
  | "notSimulated";         // feature in §9's list — placement skipped, honesty bucket
```

When several predicates each independently empty the candidate set, attribute to the **first single predicate whose removal leaves a non-empty set** (cheap: evaluate predicates as successive set intersections and record which one hit zero); otherwise `noValidTiles`. Buckets are deliberately coarse — 5.2's report UI aggregates by bucket, and stable bucket identity matters more than forensic precision.

`PreviewResult.reports: CommandReport[]` — one per instantiated generative command: `{ commandSpan, stage, attempted, placed, failures: PlacementFailure[] }`. In batch mode (5.2) this is the entire output; in preview mode the pane surfaces a compact count ("3 placements failed — see notes") linking to spans.

## 8. Seeded RNG and re-roll

- PRNG: **mulberry32** (or splitmix32) — tiny, fast, deterministic across JS engines; quality is ample for a visual heuristic. No `Math.random()` anywhere in `src/preview/generator/` (lint-enforced if practical).
- **Substreams:** stream seed = `hash(masterSeed, stageId, commandOrdinal)` (e.g. splitmix of the tuple). Each instantiated command draws only from its own substream; stage-0 randomization (start_random rolls, rnd()) uses per-node substreams keyed by node ordinal. Consequence: editing one create_object does not reshuffle lands or unrelated commands — *best-effort* stability (shared state like occupancy still cascades), a deliberate UX choice the real engine does not share; documented in the help popup, harmless to honesty since our seeds never match DE's anyway.
- **UI:** seed chip (current seed, editable number field) + re-roll button (new random seed) in the preview pane header, both HelpTip-wrapped. Copyable seed so users can share "this preview arrangement". The help text explicitly says previews with the same seed match *each other*, never the in-game map — and mentions that DE shows its own map seed in the Objectives screen for eventual side-by-side checking (parser-design §13.9).

## 9. What we do NOT simulate — and how we say so

The exclusion list (each item present in a script yields one SimulationNote with span; the pane shows a notes drawer, count-badged):

1. Engine seed/RNG parity — layouts are *plausible*, never *predictive*.
2. Include files (`#include_drs`/`#includeXS`): contents invisible; prominent banner note.
3. XS scripting, `effect_amount`/`effect_percent` and all gamedata effects, AI-info commands.
4. Walls (special placement behavior), gates.
5. `second_object`, placeholder-object tricks, `set_facet`, gaia civ styling, capturability/indestructibility — gameplay-only attributes accepted silently (no note; they don't affect layout) except second_object (note: the stacked object isn't drawn).
6. terrain_mask true visual blending (rendered as flat overlay tint), water_definition, enable_waves, color_correction, season visuals.
7. Cliff fine geometry and under-cliff terrain-16 mechanics (coarse walk only).
8. `land_conformity` (bugged in-engine, guide advises against).
9. Mid-script `override_map_size` changes after land generation begins.
10. Token-ID aliasing maps (parser-design §2.1) — bare numeric IDs resolve through refDb where known, else `notSimulated`.
11. `min_connected_tiles` (engine-bugged), `override_actor_radius_if_required` building-footprint mechanics (footprints are v1.x; all objects occupy one tile).
12. Team-dependent behavior (zones by team, team connections, grouped_by_team) until a teams setting exists.
13. civ-specific object replacement (`objreplacement.json`, Update 169123), civ starting-unit counts.
14. Nomad treaty/resources and other lobby-interaction semantics.
15. Documented engine placement *biases* that our always-shuffle selection deliberately erases: the west bias when `min_distance_to_players` ≈ `max` (e.g. starting villagers), the loose-group `find_closest_to_map_*` spawn-failure bugs. Our layouts are more evenly distributed than the engine's in these spots.
16. The engine bug where a `percent_chance 0` first branch is still occasionally chosen (§3.3) — we never select it; validate() warns against writing it.

**On-canvas labeling (hard requirement, PLAN.md risk table):** a persistent corner badge — `≈ Approximate preview` — always visible at every zoom, HelpTip-wrapped with the honest explanation ("heuristic re-implementation, not the game's generator; use in-game testing before publishing"). The badge is part of the renderer contract (4.2), not optional chrome. The notes drawer and failed-placement count sit beside it.

## 10. API and worker protocol

```ts
// Pure. No I/O, no globals, no exceptions.
function generatePreview(
  parse: ParseResult,
  refDb: ReferenceData,
  settings: GenerationSettings,
  opts: PreviewOptions
): PreviewResult;

interface GenerationSettings { playerCount: number; dim: number }   // dim resolved from MapSize upstream
interface PreviewOptions {
  seed: number;
  collectSnapshots: boolean;      // false in 5.2 batch mode
  collectReports: boolean;        // true always in practice; snapshots are the cost knob
  checkCancelled?: () => boolean; // polled between stages and every N growth rounds
}
interface PreviewResult {
  dim: number;
  seedUsed: number;
  snapshots?: StageSnapshot[];    // S1–S6 grids (S6 = final)
  objects: PlacedObject[];
  players: PlayerMarker[];
  reports: CommandReport[];
  notes: SimulationNote[];        // §9 + §3 instantiation notes, each with span
}
```

Worker protocol mirrors the parser worker: `{ id, parse, settings, opts }` request; `{ id, result }` or `{ id, cancelled: true }` response; a newer request implicitly cancels the in-flight one (worker polls `checkCancelled` between stages and every **500 [tune]** growth-loop iterations). UI debounce: regenerate **~300 ms [tune]** after the parse settles (parser reparse is its own 150 ms debounce upstream). Grids transfer as Transferables to avoid copies.

Cancellation granularity is stage+loop-chunk, not per-operation — worst-case staleness is one stage's work, fine at our budgets.

## 11. Performance budget

- Target: full pipeline (no snapshots) on a 200×200 Arabia-like script in **≤ 40 ms**; with snapshots ≤ 80 ms. Hard ceiling 500 ms at 480×480 on pathological scripts (9320-clump commands) — beyond that, per-command iteration caps kick in (growth rounds capped at `4·dim²` total steps per command **[tune]**; report `budgetShortfall`-style truncation as a SimulationNote, never hang).
- 5.2 batch feasibility: 1000 runs at 120×120, reports-only → ~5 ms/run target → seconds total, in the worker, cancellable — matching CREATION_PLAN 5.2's "seconds, not minutes".
- Techniques: typed arrays only, no per-tile objects; distance transforms computed lazily per (stage, terrainId) and invalidated on stage boundaries; A* with binary heap; Vitest benchmark with a 10×-observed threshold, same flake philosophy as parser-design §9.

## 12. Reference-data requests (to Phase 4.0 / schema)

The generator degrades gracefully when these are absent (fallbacks noted), but 4.0's extraction script should provide, per entry:

1. **`previewColor`** per terrain (minimap-like RGB). Fallback: stable hash-color + legend note "colors are placeholders".
2. **`isWater`, `isForest`, `isRoad` flags** per terrain (water for cliffs/beach/habitat; forest for forest-zone; road for the road-doesn't-separate quirk). Fallback: name-based heuristics (`*WATER*`, `*FOREST*`/`*JUNGLE*`/`BAMBOO`…) + note.
3. **`habitat`** per object: `"land" | "water" | "beach" | "any"` (coarse terrain-restriction class; full restriction tables are explicitly out of scope). Fallback: `"land"` for known resources/units, `"any"` otherwise + note.
4. **`category`** per object (resource-food/wood/gold/stone, unit, building, decoration, relic…) for renderer glyph/color. Partially derivable from existing resource-amount data.
5. Existing needs stand: per-object resource amounts (2.5 totals), `idSource` provenance (parser RMS0204/0205 gating).

Schema changes go through `reference/schemas/` with CI validation as usual. None of these block 4.2/4.3 starting — fallbacks are specified precisely so work can proceed against placeholder data.

## 13. Test plan

**Determinism (bedrock):** same (parse, settings, seed) → deep-equal PreviewResult, asserted over 3 corpus maps × 3 seeds. Separate test: different seeds → different land origins (sanity that the seed is actually consumed).

**Instrumentation unit tests — one per FailureBucket:** a crafted minimal script per bucket asserting exactly that bucket fires with the right span/entity (e.g. `create_object GOLD { terrain_to_place_on SNOW }` on a snowless map → `terrainAbsent`; `min_distance_to_players 20 max_distance_to_players 10` → `minExceedsMax`; cost-0 moat → `connectionBlocked`; 10 lands on a Tiny map with huge min_placement_distance → `originFallbackCenter`). These are 5.2's foundation and gate merges.

**Rev-2 regression fixtures (pin the critique fixes):** (1) map-size labels — a script with an `if TINY_MAP / elseif LARGE_MAP / elseif MAPSIZE_LARGE` chain asserting Normal (200×200) selects the `LARGE_MAP` branch and Large (220×220) the `MAPSIZE_LARGE` branch (the offset table, §4); (2) implicit terrain-separation — a two-island water map with `set_place_for_every_player` gold asserting every placed mine sits on its owner's island, and the same script with `ignore_terrain_restrictions` asserting the check lifts.

**Semantics units:** math evaluator against parser-design §2.2's full example set (left-to-right, nested-paren drop, `%` truncation, `% 0`, `/0`, inf flooring idiom — same fixtures as the parser's, asserting *values* where the parser asserts *assembly*); instantiation (if/elseif selection, start_random cumulative ranges incl. >99 unreachable and <100 no-branch, first-const-wins, predefined shadowing no-op, behavior_version tile accounting, override_map_size clamp); scaling arithmetic against the guide's own worked examples (400 tiles × 2.1 = 840 on Small, etc.); duplicate-attribute last-wins vs repeatable accumulation.

**Statistical (tolerance, fixed seeds, N=50):** `land_percent 40` single land → coverage within ±10 pp; `other_zone_avoidance_distance 10` two-zone map → min inter-zone gap ≥ 8 tiles in ≥95% of runs; placed objects always satisfy their min/max distance bands (hard invariant, not statistical); elevation south-bias measurably present without `enable_balanced_elevation` and reduced with it.

**Corpus:** every `test-maps/*.rms` (incl. `broken/`) × seeds {1,2,3} × players {2,4,6,8} (aligned with 5.2's stated player-count matrix): never throws, completes within budget, every generative command yields exactly one CommandReport, all failures carry valid spans. This is the 5.2 dress rehearsal.

**Cancellation:** long script, cancel mid-stage → worker responds cancelled, no result leak, next request unaffected.

**Visual calibration (4.3, manual):** side-by-side vs real DE screenshots of Arabia + 2–3 test-maps scripts at matched player counts. Checklist: player ring radius/spacing, land coverage proportions, forest clump size/count feel, resource-distance bands, hill distribution. Iterate the **[tune]** knobs; record chosen values and screenshots in `docs/preview-calibration.md`.

## 14. File layout

```
src/preview/
  generator/            pure — no React/Monaco/Tauri imports (CI-greppable)
    instantiate.ts      §3: AST → InstantiatedScript (env, conditionals, randoms, math)
    mathEval.ts         §2.2 semantics (shared fixture set with parser tests)
    rng.ts              mulberry32 + substream hashing
    grid.ts             TileGrid, distance transforms, masks
    lands.ts elevation.ts cliffs.ts terrains.ts connections.ts objects.ts
    placement.ts        PlacementOutcome machinery, failure attribution (§7)
    index.ts            generatePreview()
    types.ts            every interface in this doc
  worker.ts             protocol wrapper (§10)
  __tests__/            unit + statistical + corpus + bench suites (§13)
src/components/preview/ pane UI: canvas host, Current/Final toggle, seed chip,
                        re-roll, notes drawer — all HelpTip-wrapped (4.2/4.3)
```

4.2 builds `src/components/preview/` + the canvas renderer against a **hardcoded PreviewResult fixture** (its brief says: feed it a hardcoded grid first). 4.3 builds `generator/` to this spec and swaps the fixture for the worker.

## 15. Open questions / calibration items (for 4.3, with Ash)

1. All **[tune]** constants — calibrate against real screenshots (§13 visual pass); defaults above are guide-derived starting points, not conclusions.
2. Cross-shaped land-placement area: the 0.35·dim rejection rule is a guess at the engine's cross; if neutral-land distributions look wrong vs screenshots, revisit first.
3. Growth-frontier weighting exponent vs the engine's actual clumping look at extreme `clumping_factor` values (negative/40+).
4. Teams setting in the generation-settings pane (unblocks §3.1, §6.5 team connections, grouped_by_team) — scope with Ash; likely small.
5. Whether the preview should visually mark `growthShortfall`/failed lands on-canvas (e.g. hatched origin marker) in v1 or leave all failure surfacing to the notes drawer + 5.2 — decide during 4.3 with real examples on screen.
6. `MAP_SIZES` Giant/Huge ordering in `generationSettingsConstants.ts` (§4) — reconcile before wiring `mapSize` → `dim`.
7. In-game verify: do the elevation/terrain default tile budgets (~120/~122 "on a tiny map") actually scale with map size? §6.2/§6.4's `× area-ratio` modeling is an assumption, not guide text — same verify-list discipline as parser-design §11.
8. Current/Final: confirm the context-sensitive "Current = stage being edited" extension of PLAN.md's fixed toggle with Ash before 4.3 wires it (§5). The S2 fallback alone is the conservative reading if rejected.

---

## Appendix A: rev 2 changelog

From the first critique: **map-size label table corrected** — legacy and modern names are offset one size (`LARGE_MAP` ↔ `MAPSIZE_NORMAL` at 200×200, `HUGE_MAP` ↔ `MAPSIZE_LARGE`, `GIGANTIC_MAP` ↔ `MAPSIZE_HUGE`, Giant has no legacy label); §4 gained label columns and the Ludicrous override row, §3.1's mismatched example replaced, regression fixture added — the rev-1 example would have silently mis-selected branches on every size-aware map. **Implicit terrain-separation added to §6.6** (default-on reachability from the reference origin over non-restricted terrain, roads exempt, `ignore_terrain_restrictions` bypasses — distinct from opt-in `require_path`; rev 1 would have scattered player resources across islands on water maps), fixtured. **`repeatable`-flag prerequisite pinned in §3.10** (data doesn't exist in language.json yet; hardcoded fallback list until it does — the breakdown-design §0.1 trap). Scaling-attribute exclusivity pinned last-wins (§6.6); snapshots copy renderable layers only, memory math corrected (§5); cliffs avoid slopes (§6.3); `circle_radius` units (% of map width) and final-radius-wins pinned (§6.1); frame-requiring object attributes enumerated as inert for gaia scatter, `require_path` first-member-only, `force_placement` disabled under loose grouping, bare `avoid_forest_zone`/`avoid_cliff_zone` default 1, tight-center/loose-member grouping scope recorded as a deliberate resolution of a guide self-contradiction (§6.6); erased engine placement biases (west bias et al.) added to §9's list; corpus matrix aligned to 5.2's 2/4/6/8; §15 gained the default-tile-budget scaling verify item and the Current-toggle decision item.

## Appendix B: rev 3 changelog

From the second critique — three substantive fixes: **tight-group overflow corrected** (guide: "a perfect square worth of objects will be filled" — capped partial fill reporting `groupPartial`, NOT all-or-nothing; `occupancyFull` narrowed to the zero-tiles case, preserving 5.2 bucket identity); **`circle_radius` border regimes split** (default circle shifts with borders; explicit `circle_radius` ignores borders for origin placement while growth stays constrained — rev 2 merged the two and misplaced player rings on bordered maps with explicit radii); **frameless `min_distance_to_players` pinned** (guide says only *maximum* is inert without a frame — min now applies against every player-land origin, the common neutral-resource idiom rev 2 left unspecified under a do-not-deviate banner). Nits: `percent_chance` model pinned to roll 1–100 with the 100th percent never chosen (exactly-100 totals leave a 1% no-branch chance) and the first-branch-0 engine bug added to §9's exclusions (item 16); `group_variance` asymmetry (`[n−v, n+v−1]`, floor 1); §6.4's cliff spacing re-labeled a pinned approximation (it derives from unsimulated terrain-16, not guide text); cliff spacing defaults (2/2) stated; negative `border_fuzziness` clamps to 100; `base_elevation` skipped for water-terrain lands.
