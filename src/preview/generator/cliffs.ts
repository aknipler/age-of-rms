// S3: cliffs — docs/preview-design.md Sec.6.3. PURE (CLAUDE.md hard rule /
// preview-design Sec.2).
//
// Coarse simulation only ("enough for layout honesty, no fine geometry" —
// Sec.6.3's own framing, and Sec.9 item 7 lists cliff fine geometry as a
// standing, blanket exclusion, so no per-cliff SimulationNote is emitted for
// it). No `create_cliff` command exists in the language — `<CLIFF_GENERATION>`
// holds only standalone attributes (`min_number_of_cliffs`,
// `cliff_curliness`, ...) sitting directly in the section, so unlike every
// other stage there is no single instantiated command to loop over. The
// section's mere PRESENCE is the generative act ("simply typing the section
// header will generate default cliffs" — guide, quoted in Sec.6.3), so this
// file folds the section's standalone commands into one settings record
// (last-one-wins, mirroring Sec.3 rule 10's attribute-folding policy) and
// emits exactly one CommandReport for the section as a whole, using the
// first contained command's span as the representative span (or a zero span
// for a genuinely empty section — there is nothing else to point at).
//
// `cliff_type` (visual cliff material) is read by nothing here: the
// renderer already draws every cliff with one flat colour (Sec.9 item 7),
// so the attribute has no effect on the grid and, per Sec.9 items 5/6's
// precedent for gameplay/visual-only attributes, does not need a note.

import type {
  CommandReport,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PlacementFailure,
  PlacementOutcome,
  SimulationNote,
  TileGrid,
} from "./types";
import { createSubstream, nextInt, type Rng } from "./rng";
import {
  UNREACHABLE,
  computeSlopeMask,
  distanceTransformFromMask,
  tileIndex,
  waterMask,
  type TerrainConstantForMasks,
} from "./grid";
import { intersectCandidates, ok, fail, pushFailure, type AttributedPredicate } from "./placement";

// ---------------------------------------------------------------------------
// [tune] / guide-value constants
// ---------------------------------------------------------------------------

/** guide:1351: "Count = uniform [min, max)" — max exclusive. Defaults per language.json. */
const DEFAULT_MIN_CLIFFS = 3;
const DEFAULT_MAX_CLIFFS = 8;
/** guide:1365's worked tile counts fix this at "uniform [min,max] inclusive", NOT the count roll's exclusive upper bound. */
const DEFAULT_MIN_LENGTH = 5;
const DEFAULT_MAX_LENGTH = 9;
/** guide default; percent chance of a direction change per segment. */
const DEFAULT_CURLINESS = 36;
/** No default declared in language.json (verified: false) — Sec.6.3 states "default 2" as a guide value for both. */
const DEFAULT_MIN_DISTANCE_CLIFFS = 2;
const DEFAULT_MIN_TERRAIN_DISTANCE = 2;

/** guide value, Sec.6.3: "Start tiles: >=22 tiles from every land origin". Flat tile distance, not the x3 scaling the other two spacing constraints use. */
const LAND_ORIGIN_MIN_DISTANCE = 22;

/** guide: "minimum must be at least 3 for cliffs to appear" (Sec.6.3, language.json's own pinned min). */
const MIN_LENGTH_FOR_CLIFFS_TO_APPEAR = 3;

const ZERO_SPAN = { start: 0, end: 0 };

const DIRECTIONS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

// ---------------------------------------------------------------------------
// Attribute folding — CLIFF_GENERATION's standalone commands are top-level
// `InstantiatedCommand`s (no enclosing block, so Sec.3's attribute-map
// folding never runs on them), so a duplicate declaration is a second array
// entry rather than a second entry in an `attributes` map. Last-one-wins by
// script position, matching every other duplicate-declaration rule in this
// spec (Sec.3 rule 10; Sec.6.1's "only the final circle_radius applies").
// ---------------------------------------------------------------------------

function lastByName(commands: readonly InstantiatedCommand[], name: string): InstantiatedCommand | undefined {
  let found: InstantiatedCommand | undefined;
  for (const cmd of commands) if (cmd.name === name) found = cmd;
  return found;
}

function numArg(cmd: InstantiatedCommand | undefined, fallback: number): number {
  const v: InstantiatedValue = cmd?.args[0]?.value;
  return typeof v === "number" ? v : fallback;
}

export interface CliffSettings {
  minCliffs: number;
  maxCliffs: number;
  minLength: number;
  maxLength: number;
  curliness: number;
  minDistanceCliffs: number;
  minTerrainDistance: number;
  /** Commands whose span identifies the min/max-cliffs authoring mistake, if any — kept apart from the plain numbers so the note can point at the right line. */
  minCliffsCmd?: InstantiatedCommand;
  maxCliffsCmd?: InstantiatedCommand;
  minLengthCmd?: InstantiatedCommand;
}

/** Folds every standalone CLIFF_GENERATION command into one settings record, defaults per Sec.6.3/language.json. */
export function resolveCliffSettings(commands: readonly InstantiatedCommand[]): CliffSettings {
  const minCliffsCmd = lastByName(commands, "min_number_of_cliffs");
  const maxCliffsCmd = lastByName(commands, "max_number_of_cliffs");
  const minLengthCmd = lastByName(commands, "min_length_of_cliff");
  const maxLengthCmd = lastByName(commands, "max_length_of_cliff");
  const curlinessCmd = lastByName(commands, "cliff_curliness");
  const minDistanceCliffsCmd = lastByName(commands, "min_distance_cliffs");
  const minTerrainDistanceCmd = lastByName(commands, "min_terrain_distance");

  return {
    minCliffs: numArg(minCliffsCmd, DEFAULT_MIN_CLIFFS),
    maxCliffs: numArg(maxCliffsCmd, DEFAULT_MAX_CLIFFS),
    minLength: numArg(minLengthCmd, DEFAULT_MIN_LENGTH),
    maxLength: numArg(maxLengthCmd, DEFAULT_MAX_LENGTH),
    curliness: numArg(curlinessCmd, DEFAULT_CURLINESS),
    minDistanceCliffs: numArg(minDistanceCliffsCmd, DEFAULT_MIN_DISTANCE_CLIFFS),
    minTerrainDistance: numArg(minTerrainDistanceCmd, DEFAULT_MIN_TERRAIN_DISTANCE),
    minCliffsCmd,
    maxCliffsCmd,
    minLengthCmd,
  };
}

// ---------------------------------------------------------------------------
// Start-tile candidate set (Sec.7's successive-intersection attribution,
// predicate order matching Sec.6.3's own listed order: land-origin distance,
// water, slope, cliff spacing, terrain/water distance). Buckets are the
// closest existing fit rather than new ones (types.ts: "a stable bucket
// identity is worth more than forensic precision") — the two genuinely
// distance-based constraints (origin proximity, the two x3-scaled spacings)
// use `spacingConflict`; the two flat terrain-class exclusions (on water, on
// a slope) use the generic `noValidTiles`.
// ---------------------------------------------------------------------------

export function eligibleCliffStartTiles(
  grid: TileGrid,
  origins: readonly LandOrigin[],
  water: Uint8Array,
  slope: Uint8Array,
  cliffDistance: Uint16Array,
  waterDistance: Uint16Array,
  minCliffSpacing: number,
  minWaterSpacing: number,
): PlacementOutcome<Int32Array> {
  const { dim } = grid;
  const n = dim * dim;
  const scratch = new Int32Array(n);
  for (let i = 0; i < n; i++) scratch[i] = i;

  const predicates: AttributedPredicate[] = [
    {
      bucket: "spacingConflict",
      test: (i) => {
        if (origins.length === 0) return true;
        const x = i % dim;
        const y = (i - x) / dim;
        for (const origin of origins) {
          const dx = x - origin.x;
          const dy = y - origin.y;
          if (dx * dx + dy * dy < LAND_ORIGIN_MIN_DISTANCE * LAND_ORIGIN_MIN_DISTANCE) return false;
        }
        return true;
      },
    },
    { bucket: "noValidTiles", test: (i) => water[i] === 0 },
    { bucket: "noValidTiles", test: (i) => slope[i] === 0 },
    { bucket: "spacingConflict", test: (i) => cliffDistance[i] === UNREACHABLE || cliffDistance[i] >= minCliffSpacing },
    { bucket: "spacingConflict", test: (i) => waterDistance[i] === UNREACHABLE || waterDistance[i] >= minWaterSpacing },
  ];

  const result = intersectCandidates(scratch, n, predicates);
  if (result.count === 0) {
    return fail({
      bucket: result.failedBucket ?? "noValidTiles",
      commandSpan: ZERO_SPAN, // filled in by the caller, which has the real span
      stage: "S3",
      entity: "cliff",
      detail: "",
    });
  }
  return ok(Int32Array.from(result.survivors));
}

// ---------------------------------------------------------------------------
// The walk (Sec.6.3): a 3-tile starting stub in a random initial direction,
// then `len` more 3-tile segments, each with a `curliness`% chance to turn
// before it is laid. A step that would leave the grid, land on water, or
// land on an already-cliffed tile (this cliff's own earlier tiles included,
// which is what makes this self-avoiding for free) truncates the whole walk
// right there ("may end up shorter" — guide, quoted in Sec.6.3).
//
// JUDGMENT CALL: Sec.6.3 groups land-origin distance, water, slope,
// cliff-spacing and terrain-distance under "Start tiles:" and separately
// says only that "walk steps that would violate constraints truncate the
// cliff", without saying which constraints re-apply mid-walk. Re-checking
// the full five-predicate set per tile would need a distance-transform
// rebuild after every single tile (not just every cliff) for negligible
// visual benefit on a "coarse... layout honesty" feature. This function
// re-checks only grid bounds, water and self/other-cliff overlap — the
// three whose violation would look outright broken on a render (a cliff
// stepping into the sea or through another cliff) — and leaves the
// distance-band constraints (origin proximity, the two spacings) as
// start-tile-only, matching where Sec.6.3's prose literally places them.
// ---------------------------------------------------------------------------

function canPlaceCliffTile(grid: TileGrid, water: Uint8Array, x: number, y: number): boolean {
  const { dim } = grid;
  if (x < 0 || x >= dim || y < 0 || y >= dim) return false;
  const i = tileIndex(grid, x, y);
  return grid.cliff[i] === 0 && water[i] === 0;
}

export function walkCliff(grid: TileGrid, water: Uint8Array, start: number, len: number, curliness: number, rng: Rng): void {
  const { dim } = grid;
  let x = start % dim;
  let y = (start - x) / dim;
  let dir = DIRECTIONS[nextInt(rng, 0, 3)];

  function placeAt(nx: number, ny: number): boolean {
    if (!canPlaceCliffTile(grid, water, nx, ny)) return false;
    grid.cliff[tileIndex(grid, nx, ny)] = 1;
    x = nx;
    y = ny;
    return true;
  }

  if (!placeAt(x, y)) return; // the start tile itself was already validated by the caller; this should always succeed
  for (let i = 0; i < 2; i++) {
    if (!placeAt(x + dir.dx, y + dir.dy)) return;
  }

  for (let segment = 0; segment < len; segment++) {
    if (nextInt(rng, 0, 99) < curliness) {
      const others = DIRECTIONS.filter((d) => d !== dir);
      dir = others[nextInt(rng, 0, others.length - 1)];
    }
    for (let i = 0; i < 3; i++) {
      if (!placeAt(x + dir.dx, y + dir.dy)) return;
    }
  }
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface CliffsResult {
  reports: CommandReport[];
  notes: SimulationNote[];
}

/**
 * Sec.6.3: `<CLIFF_GENERATION>` -> cliffs. Mutates `grid.cliff`; returns one
 * CommandReport for the whole section (there is no per-cliff command to
 * report against — see the file header) plus any SimulationNotes for the
 * two documented zero-cliff cases (min > max "crashes the engine"; a
 * sub-3 `min_length_of_cliff` "produces no cliffs at all").
 */
export function applyCliffs(
  instantiated: InstantiatedScript,
  grid: TileGrid,
  constants: readonly TerrainConstantForMasks[],
  origins: readonly LandOrigin[],
  masterSeed: number,
): CliffsResult {
  const commands = instantiated.sections.get("CLIFF_GENERATION");
  if (commands === undefined) return { reports: [], notes: [] };

  const settings = resolveCliffSettings(commands);
  const commandSpan = commands[0]?.span ?? ZERO_SPAN;
  const notes: SimulationNote[] = [];
  let ordinal = 0;
  const nextSubstream = (): Rng => createSubstream(masterSeed, "S3", ordinal++);

  const zeroCliffReport = (): CommandReport => ({ commandSpan, stage: "S3", attempted: 0, placed: 0, failures: [] });

  if (settings.minCliffs > settings.maxCliffs) {
    const span = settings.maxCliffsCmd?.span ?? settings.minCliffsCmd?.span;
    notes.push({
      key: "cliffsMinExceedsMax",
      prominence: "drawer",
      stage: "S3",
      span,
      text: "min_number_of_cliffs is greater than max_number_of_cliffs, which crashes the real game when the map is generated — the preview shows no cliffs instead of crashing.",
    });
    return { reports: [zeroCliffReport()], notes };
  }

  if (settings.minLength < MIN_LENGTH_FOR_CLIFFS_TO_APPEAR) {
    notes.push({
      key: `cliffsLengthSuppressed:${settings.minLengthCmd!.span.start}`,
      prominence: "drawer",
      stage: "S3",
      span: settings.minLengthCmd!.span,
      text: "min_length_of_cliff below 3 produces no cliffs at all in the real game, so this section has no visible effect.",
    });
    return { reports: [zeroCliffReport()], notes };
  }

  const countRng = nextSubstream();
  const count = nextInt(countRng, settings.minCliffs, Math.max(settings.minCliffs, settings.maxCliffs - 1));

  const { mask: water } = waterMask(grid, constants);
  const waterDistance = distanceTransformFromMask(grid.dim, water);
  const slope = computeSlopeMask(grid);
  const minCliffSpacing = settings.minDistanceCliffs * 3;
  const minWaterSpacing = settings.minTerrainDistance * 3;

  const failures: PlacementFailure[] = [];
  let placed = 0;

  for (let c = 0; c < count; c++) {
    const cliffDistance = distanceTransformFromMask(grid.dim, grid.cliff);
    const candidateResult = eligibleCliffStartTiles(grid, origins, water, slope, cliffDistance, waterDistance, minCliffSpacing, minWaterSpacing);
    if (!candidateResult.ok) {
      pushFailure(failures, { ...candidateResult.failure, commandSpan, entity: `cliff ${c + 1}` });
      continue;
    }

    const pickRng = nextSubstream();
    const candidates = candidateResult.value;
    const start = candidates[nextInt(pickRng, 0, candidates.length - 1)];

    const lengthRng = nextSubstream();
    const len = nextInt(lengthRng, settings.minLength, Math.max(settings.minLength, settings.maxLength));

    const walkRng = nextSubstream();
    walkCliff(grid, water, start, len, settings.curliness, walkRng);
    placed++;
  }

  return { reports: [{ commandSpan, stage: "S3", attempted: count, placed, failures }], notes };
}
