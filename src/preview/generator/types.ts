// Every type docs/preview-design.md declares, in the one place Sec.14 says
// they live. Sec.10 is explicit about why this file exists before any
// generator code does: "4.2 builds its hardcoded fixture against exactly
// this list", and an earlier revision of the spec left four field types
// undeclared, which made the fixture unbuildable.
//
// PURITY (CLAUDE.md hard rule, preview-design Sec.2): nothing under
// src/preview/generator/ may import React, Monaco or Tauri, so it runs
// unchanged in a bare web worker and in plain-Node Vitest. The two imports
// below are the deliberate exceptions Sec.2 names — both are plain modules
// with no framework import of their own.
//
// Nothing in here is implementation. The generator (4.3) fills these in;
// 4.2 renders them.

import type { ArgNode, ParseResult, Span } from "../../parser/types";
import type { CommandDef } from "../../parser/language";
import type { MapSize, TeamNumber } from "../../generationSettings/generationSettingsConstants";
import type { CanonicalTeams } from "../../generationSettings/teamModel";

// ---------------------------------------------------------------------------
// Inputs (Sec.10)
// ---------------------------------------------------------------------------

/**
 * The generator's read-only view of the three user choices the settings pane
 * owns. Named PreviewSettings rather than GenerationSettings because
 * GenerationSettingsContext.tsx already owns that name for the app-level
 * value type.
 *
 * mapSize, NOT dim. `dim` is derived inside the generator by looking the size
 * up in language.json's predefinedLabels, and then `override_map_size` may
 * change it mid-script (Sec.3.8) while the *labels* stay those of the lobby
 * size. Passing a bare dim in would throw away the only input the label
 * environment can be built from.
 */
export interface PreviewSettings {
  playerCount: number;
  mapSize: MapSize;
  /**
   * SELECTED team per player, 0 = un-teamed (guide:1001). Always length 8,
   * indexed player - 1, regardless of playerCount: the settings pane retains
   * assignments for players currently counted out, so entries at index
   * >= playerCount describe people who are NOT in the game and must be
   * ignored everywhere, team sizes included.
   *
   * These are NOT the numbers that appear in TEAMn_SIZEm / PLAYERx_TEAMy.
   * S0 canonicalises to lobby order first (Sec.3.1) — dropping teams with
   * fewer than 2 members and renumbering the survivors by lowest player
   * number. src/generationSettings/teamModel.ts is that rule, and the
   * generator imports it rather than re-implementing it.
   */
  teams: readonly TeamNumber[];
}

/** Structured-cloneable: plain data only, no functions (Sec.10). */
export interface PreviewOptions {
  seed: number;
  /** false in 5.2 batch mode — the only cost knob. Reports are unconditional (Sec.7). */
  collectSnapshots: boolean;
}

// ---------------------------------------------------------------------------
// Script instantiation (Sec.3) — Stage 0's output, consumed by S1 onward.
// ---------------------------------------------------------------------------

/**
 * A resolved argument value, aligned 1:1 with the originating ArgNode's
 * position. `undefined` means Sec.3 could not resolve it (an unresolved
 * `#const`/`#define` name feeding a numeric slot, or a math expression whose
 * first operand failed to resolve, Sec.3.6) — the parser has already warned
 * about this shape (RMS0200/RMS0210 series); S0 does not warn again, it just
 * hands the gap downstream for that stage to decide how to degrade.
 *
 * A `string` surviving here is NOT a failure: `terrainConstant`/
 * `objectConstant` arguments are deliberately left as names (Sec.12's game
 * constants DB resolves those, not the `#define`/`#const` symbol table S0
 * owns), and a name in a numeric slot that never matched a symbol is passed
 * through as-is rather than discarded, so a click-through or a raw-value
 * report can still show the author's original word.
 */
export type InstantiatedValue = number | string | undefined;

export interface InstantiatedArg {
  value: InstantiatedValue;
  /** The originating node, kept for its span (click-through) and its ArgumentDef. */
  source: ArgNode;
}

export interface InstantiatedAttribute {
  name: string;
  args: InstantiatedArg[];
  span: Span;
}

export interface InstantiatedCommand {
  name: string;
  def?: CommandDef;
  span: Span;
  args: InstantiatedArg[];
  /**
   * Folded per Sec.3 rule 10: last-wins, EXCEPT attributes `language.json`
   * flags `repeatable`, which accumulate in occurrence order instead. A
   * non-repeatable name is therefore always length 1 once folding is done —
   * the array shape exists so both cases share one field rather than the
   * repeatable case needing a special sibling.
   */
  attributes: ReadonlyMap<string, InstantiatedAttribute[]>;
  /**
   * The `behavior_version` in effect (0-2) when this command was
   * instantiated (Sec.3 rule 7 — a stream variable, not a per-command
   * setting). 2 is folded to 1 here already ("we treat 2 as 1", same rule);
   * the note that folding happened lives in `InstantiatedScript.notes`, not
   * on every command that inherits it.
   */
  behaviorVersion: 0 | 1;
}

/** `<PLAYER_SETUP>` stream state Sec.3 rule 11 folds into the environment for S1+, rather than a pipeline stage of its own. */
export interface PlayerSetupState {
  directPlacement: boolean;
  randomPlacement: boolean;
  groupedByTeam: boolean;
  nomadResources: boolean;
}

export interface InstantiatedScript {
  /**
   * Post-`override_map_size` (Sec.3 rule 8) — the dimension every later
   * stage actually generates against. Can differ from the lobby mapSize's
   * own dimensions.
   */
  dim: number;
  /** Canonical engine section order (Sec.3 rule 11); a section absent from the script has no entry. */
  sections: ReadonlyMap<string, InstantiatedCommand[]>;
  /** `create_object_group` definitions, keyed by the group's `type` name (Sec.3 rule 12). */
  objectGroups: ReadonlyMap<string, InstantiatedCommand>;
  /** `create_actor_area` definitions, keyed by identifier — multiple areas may share one (Sec.3 rule 12). */
  actorAreas: ReadonlyMap<number, InstantiatedCommand[]>;
  playerSetup: PlayerSetupState;
  /**
   * The script's own numeric `#const` definitions (Sec.3 rule 4), name ->
   * value, in first-definition-wins order.
   *
   * Exposed because a terrain or object slot is NOT a numeric context in
   * Sec.6's sense, so `resolveArg` deliberately leaves `terrain_type WOODIES`
   * as the string "WOODIES" — those names are supposed to resolve against
   * game-constants.json instead. But only 78 of DE's 131 terrains HAVE a
   * constant, so naming the other 53 means `#const WOODIES 48` and then
   * using WOODIES, which is a mainstream idiom rather than an edge case:
   * three of the corpus's own maps do it, and before this field existed
   * `TL Black Forest.rms` lost every one of its 33 `create_terrain WOODIES`
   * commands to "reference data doesn't know that terrain".
   *
   * Symbols defined with no value (`#define`, or `#const` with a
   * non-numeric value) are omitted — a flag is not an id. Resolution order
   * is the CALLER's decision and it matters: game-constants first, this
   * second, because the engine loads random_map.def before the script and
   * `#const` is first-definition-wins, so a script redefining a built-in
   * name does not actually win.
   */
  symbols: ReadonlyMap<string, number>;
  /** Canonicalised team assignment (Sec.3.1 / generationSettings/teamModel.ts), ready for S1/S6's zone and ring math. */
  teams: CanonicalTeams;
  notes: SimulationNote[];
}

// ---------------------------------------------------------------------------
// The grid (Sec.4)
// ---------------------------------------------------------------------------

/**
 * The generator's mutable working grid. Square, dim x dim, tile (x, y) at
 * index `y * dim + x`.
 *
 * Coordinates are the guide's, and they are rotated 45 degrees from what a
 * screenshot suggests: (0,0) is the WEST corner, (max,0) north, (0,max)
 * south, (max,max) east. That rotation is not cosmetic — it is what
 * docs/elevation-bias-study.md found the whole elevation model had been
 * fitted against the wrong axis of. The renderer owns the projection into
 * screen space; the generator never thinks in pixels.
 *
 * Typed arrays rather than an array of tile objects, because Sec.11's 40 ms
 * budget on a 200x200 map does not survive 40,000 allocations.
 */
export interface TileGrid {
  dim: number;
  /** Terrain constant id (refDb / random_map.def id, not an array index). */
  terrain: Uint16Array;
  /** base_layer / terrain_mask visual layer; 0 = none. */
  layer: Uint16Array;
  elevation: Uint8Array; // 0-16
  cliff: Uint8Array; // 1 = cliff tile
  /** Which land claimed this tile; -1 = base terrain. */
  landId: Int16Array;
  /** Zone of the claiming land (defaults per Sec.6.1). */
  zone: Int16Array;
  /** Object occupancy, written by the objects stage. */
  occupied: Uint8Array;
}

// ---------------------------------------------------------------------------
// Pipeline (Sec.5)
// ---------------------------------------------------------------------------

export type StageId = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6";

/**
 * A copy of the RENDERABLE layers at a stage boundary — four of TileGrid's
 * seven, because landId/zone/occupied are generation bookkeeping the renderer
 * never reads. 6 bytes/tile x 480^2 x 6 snapshots is about 8 MB at the
 * largest map size, which is why the split is worth making.
 *
 * Only the (not yet built) stage scrubber consumes S1-S5. The Current/Final
 * toggle does NOT: both of its positions draw a final grid, because Current
 * is a second run over a truncated script rather than an earlier stage
 * (Sec.5). Sec.2 asks explicitly that this type not be deleted on the
 * grounds that nothing reads it yet.
 */
export interface StageSnapshot {
  stage: StageId; // S1-S6; S6 is the final grid
  dim: number;
  terrain: Uint16Array;
  layer: Uint16Array;
  elevation: Uint8Array;
  cliff: Uint8Array;
}

/** Sec.4's border-percent-to-tile conversion result. Lives here (not grid.ts, which computes it) because LandOrigin below needs to reference it and grid.ts is not upstream of types.ts. */
export interface BorderBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// S1 lands (Sec.6.1) — one record per placed land, output of the origin-
// placement phase. Growth (lands.ts's growLands) reads and extends this; it
// does not replace it, so the fields here are what origin placement itself
// can compute, plus the border/generate_mode state growth's own candidate
// rejection needs and origin placement had already resolved once for its own
// purposes.
// ---------------------------------------------------------------------------

export interface LandOrigin {
  commandSpan: Span;
  x: number;
  y: number;
  /** The zone this land's tiles claim (Sec.6.1's zone rules); -12 means "belongs to no zone". */
  zone: number;
  /** From the `land_id` attribute, if given — the name later commands (`place_on_specific_land_id`) target. Distinct from the grid's internal `landId` index. */
  declaredLandId?: number;
  /** 1-based, present only for a player's own land (ring-placed). Assign_to-based assignment is not yet modelled (see lands.ts). */
  player?: number;
  baseSize: number;
  circularBase: boolean;
  /** The `terrain_type` reference exactly as the script wrote it — a constant name, or a bare terrain id. Kept alongside `terrainId` so a failure message can quote what the author typed. */
  terrainType?: string | number;
  /** `terrain_type` resolved to a terrain id (grid.ts's `resolveTerrainId`). Undefined when the attribute is absent, or names something nothing can resolve — in which case the land claims tiles but paints no terrain, leaving the base fill showing. */
  terrainId?: number;
  /** Raw declared value (1-16, or negative meaning "maximally elevated"); clamping and application happen in the elevation step (Sec.6.1: "after growth, set elevation = H"), not here. */
  baseElevation?: number;
  clumpingFactor: number;
  borderFuzziness: number;
  otherZoneAvoidanceDistance: number;
  minPlacementDistance: number;
  /**
   * The `behavior_version` in effect for this land (Sec.6.1: governs whether
   * the origin square counts toward `declaredTargetTiles` or is additional to
   * it). The additive/included adjustment itself is growth's job, not
   * origin placement's — this field is carried through so growth doesn't
   * have to re-derive it from the command.
   */
  behaviorVersion: 0 | 1;
  /** land_percent (already divided per player for a player land) or number_of_tiles, BEFORE the behaviorVersion additive/included adjustment. */
  declaredTargetTiles: number;
  /** True when this origin came from Sec.6.1's K-attempts exhaustion fallback (map center, overlapping whatever is there) rather than a real placement. */
  fromOriginFallback: boolean;
  /** This land's own border bounds (Sec.4), resolved once here rather than re-read from the command by growth — growth's border rejection and detached-seed reservoir sampling both need it. */
  borderBounds: BorderBounds;
  /** The `generate_mode` attribute's value (default 0); `1` disables the cross-shaped-region restriction for reservoir seeding, same as it does for origin placement. */
  generateMode: number;
}

// ---------------------------------------------------------------------------
// Honesty surface (Sec.9)
// ---------------------------------------------------------------------------

/**
 * One note per thing the preview did not, or could not, simulate. Goal 1 of
 * the spec is "we would rather show nothing than show something confidently
 * wrong", and this type is how the renderer says which parts of the picture
 * to distrust.
 */
export interface SimulationNote {
  /**
   * Dedupe key. The generator appends notes freely and a final pass keeps the
   * first per key: per-occurrence notes put the span in the key, run-level
   * notes use a bare topic ("teams", "includes").
   */
  key: string;
  /** banner = drawn on-canvas beside the approximate badge; drawer = in the list. */
  prominence: "drawer" | "banner";
  stage: StageId;
  /** Absent for run-level notes. Character offsets into the source. */
  span?: Span;
  /** Beginner-first sentence, same register as a parser diagnostic. */
  text: string;
}

// ---------------------------------------------------------------------------
// Placement instrumentation (Sec.7) — the 5.2 contract
// ---------------------------------------------------------------------------

/**
 * The non-negotiable rule of Sec.7: no placement primitive returns a bare
 * boolean. The Generation Consistency Checker (5.2) is built on these
 * records, and retrofitting them later is the painful path CREATION_PLAN 5.2
 * warns about.
 *
 * This is a *discriminated union* — `ok` is the discriminant, so narrowing on
 * it gives you `value` in one branch and `failure` in the other, with no cast
 * and no possibility of reading the wrong field.
 */
export type PlacementOutcome<T> = { ok: true; value: T } | { ok: false; failure: PlacementFailure };

/**
 * Deliberately coarse. 5.2's report UI aggregates by bucket, so a stable
 * bucket identity is worth more than forensic precision — a bucket that
 * splits in two later invalidates every saved report.
 */
export type FailureBucket =
  | "noValidTiles" // constraint intersection empty (generic terminal)
  | "terrainAbsent" // required terrain/layer never present on the map
  | "spacingConflict" // a spacing/avoidance constraint emptied the set
  | "occupancyFull" // tiles exist but are taken (tight group / crowding)
  | "minExceedsMax" // deterministic: min_distance > max_distance
  | "landMissing" // place_on_specific_land_id unmatched / player land absent / land_id land skipped
  | "actorAreaMissing" // referenced actor area never created
  | "pathBlocked" // require_path found no acceptable path
  | "connectionBlocked" // no route between a connection pair
  | "originFallbackCenter" // land origin placement exhausted -> engine center fallback
  | "growthShortfall" // land/terrain/elevation grew < target (data: owned, target, blocker)
  | "groupPartial" // loose group placed k of n members (data: placed, requested)
  | "zoneAvoidanceBlocked" // other_zone_avoidance rejected a single placement
  | "borderBlocked" // border constraint rejected a single placement
  | "playerOriginAvoidance" // seed set emptied by player-origin avoidance (Sec.6.2/6.4)
  | "gaiaOnlyRequired" // frame-referenced create_object of a non-ownable object without set_gaia_object_only
  | "iterationCapped" // Sec.11 per-command iteration cap hit — truncated, not blocked
  | "notSimulated"; // feature in Sec.9's list — placement skipped, honesty bucket

export interface PlacementFailure {
  bucket: FailureBucket;
  /** Originating command's source span, for click-through from the report. */
  commandSpan: Span;
  stage: StageId;
  /** "GOLD", "land #3", "connection P2-P5", ... */
  entity: string;
  /** Player/land frame the placement was made under, if any. */
  reference?: string;
  /** Human sentence, beginner-first, like a parser diagnostic. */
  detail: string;
  /**
   * How many failures of this bucket this command produced. Absent means one.
   * Records are coalesced by bucket as they are made (`pushFailure`), so
   * `entity`, `reference`, `detail` and `data` describe the FIRST of them and
   * stand as the example — see `pushFailure` for why keeping the rest is
   * worth nothing and costs a great deal.
   */
  occurrences?: number;
  /** Bucket-specific numbers, e.g. { owned, target } for growthShortfall. */
  data?: Record<string, number | string>;
}

/**
 * One per instantiated generative command. Unconditional — Sec.7 rejects a
 * `collectReports` option, because reports are goal 2 and cost one record per
 * command rather than per tile. In 5.2's batch mode this is the entire output.
 */
export interface CommandReport {
  commandSpan: Span;
  stage: StageId;
  attempted: number;
  placed: number;
  failures: PlacementFailure[];
}

// ---------------------------------------------------------------------------
// Output (Sec.6.6, Sec.10)
// ---------------------------------------------------------------------------

export interface PlacedObject {
  /** The RMS constant name as written, e.g. "GOLD". Unresolved names still place (Sec.12). */
  objectRef: string;
  x: number;
  y: number;
  /** Owning player, absent for gaia/neutral placements. */
  player?: number;
  /**
   * Renderer glyph/colour class — "resource-gold", "unit", "building", ...
   * (Sec.12 item 8). A plain `string`, NOT a closed union, and the contrast
   * with PredefinedLabelCategory next door in the parser is the point: that
   * one is a union because reference/schemas pins its ten members, this one
   * is an open list the spec itself ends with "...". A union here would make
   * the renderer's fallback branch unreachable-by-type while the data can
   * still produce a value it has never heard of.
   */
  category: string;
  /** Group this placement belongs to, for renderers that want to draw cohesion. */
  groupId?: number;
}

/** One per player-land origin. The renderer draws a numbered flag. */
export interface PlayerMarker {
  player: number;
  x: number;
  y: number;
}

export interface PreviewResult {
  /** Post-override_map_size (Sec.3.8), so this can differ from the lobby size's dim. */
  dim: number;
  seedUsed: number;
  /** S1-S6 grids, S6 last and final. Absent when collectSnapshots is false. */
  snapshots?: StageSnapshot[];
  objects: PlacedObject[];
  players: PlayerMarker[];
  reports: CommandReport[];
  notes: SimulationNote[];
}

// ---------------------------------------------------------------------------
// Worker protocol (Sec.10)
// ---------------------------------------------------------------------------

// refDb is deliberately NOT in the message: the worker imports language.json
// and game-constants.json itself, exactly as src/editor/parserWorker.ts does.
// Shipping it per request would structured-clone ~111 KB of JSON on every
// keystroke burst for data that never changes.

export interface PreviewRequest {
  id: number;
  parse: ParseResult;
  settings: PreviewSettings;
  opts: PreviewOptions;
}

/**
 * A discriminated union, because a run that produced nothing has to be
 * representable. `abandoned` is the watchdog path only: there is no per-run
 * cancellation in v1 (Sec.10 gives the reasons — generatePreview is
 * synchronous, so a worker's onmessage cannot fire mid-run anyway), and stale
 * results are discarded by id on the host instead.
 */
export type PreviewResponse =
  | { id: number; ok: true; result: PreviewResult }
  | { id: number; ok: false; abandoned: true };
