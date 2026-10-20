// generatePreview(), docs/preview-design.md Sec.10. PURE (CLAUDE.md hard
// rule / preview-design Sec.2). The last piece of CREATION_PLAN 4.3: every
// stage from `instantiate.ts` through `objects.ts` has so far only been
// exercised through its own hand-rolled `place()` test helper. This file is
// what turns that into the one real public entry point.
//
// SCOPE, READ THIS BEFORE ADDING ANYTHING: Sec.10 pins the signature as
// `generatePreview(parse, refDb, settings, opts): PreviewResult` with no
// Current/Final mode and no cancellation hook. Both are deliberately NOT
// this file's job:
//   - Current/Final (Sec.5) is a CALLER concern. "Current is
//     `generatePreview(truncateAst(parse, pinnedLine), refDb, settings,
//     opts)`", the truncation happens to `parse` before this function ever
//     sees it, so `generatePreview` itself needs no mode parameter and no
//     awareness that Current exists. `truncateAst()` belongs to whoever
//     calls this twice (the worker/pane), not here.
//   - The `runStages(…, shouldStop)` hook Sec.10 mentions is explicitly
//     future-proofing for a cancellation mechanism this project doesn't
//     have yet ("drops in later without a rewrite... a genuine decision
//     about Tauri's protocol headers, not a detail to slip in during 4.3").
//     Sec.10's own code block gives `generatePreview` no such parameter.
//     Not built here.
//   - `worker.ts` (Sec.14: "protocol wrapper") is its own file, not built
//     here, this file has no `postMessage`, no `Worker`, nothing async.
//
// So this file does exactly one thing: run S0 through S6 once, synchronously,
// over whatever `parse` it is given, and hand back one PreviewResult.

import type { LanguageIndex } from "../../parser/language";
import type { ParseResult } from "../../parser/types";
import type {
  CommandReport,
  FailureMark,
  InstantiatedScript,
  InstantiatedValue,
  LandOrigin,
  PreviewOptions,
  PreviewResult,
  PreviewSettings,
  SimulationNote,
  StageId,
  StageSnapshot,
  TileGrid,
} from "./types";
import { instantiateScript } from "./instantiate";
import { createTileGrid, resolveTerrainId } from "./grid";
import {
  placeLandOrigins,
  growLands,
  finishLandStage,
  baseElevationNotes,
  countOwnedTiles,
} from "./lands";
import { applyElevation } from "./elevation";
import { applyCliffs, finishTerrainStage } from "./cliffs";
import { applyAutomaticBeach, applyTerrains } from "./terrains";
import { applyConnections } from "./connections";
import { applyObjects, type ObjectConstant } from "./objects";
import { computeForestWood } from "./forestTrees";
import {
  scanAutoTreeEffects,
  type TerrainRestriction,
} from "./forestTreeSuppression";
import { computeResourceSummary } from "./resourceSummary";
import { cleanupNote, createCleanupTally, recordCleanup } from "./cleanupNote";

/**
 * The bundled reference data `generatePreview` needs, `instantiateScript`
 * (S0) wants the parser's `LanguageIndex`, every stage from S1 on wants the
 * `game-constants.json` array. NOT declared in `types.ts`: Sec.10 explicitly
 * lists what that file owns and this bundle isn't in it, it is a parameter
 * shape for this one entry point, the same category as `EligibilityContext`
 * living in terrains.ts rather than types.ts.
 *
 * `ObjectConstant` (objects.ts) is reused as the constants element type
 * rather than re-declaring an identical interface: it is a strict superset
 * of every other stage's own narrower projection of the same JSON array
 * (`TerrainConstantForMasks`, `TerrainConstantForElevation`, both just
 * `{constId, rmsConstant, category}`), so passing one `ObjectConstant[]`
 * array through to every stage typechecks with no cast, per each of those
 * files' own "each consumer states the narrow shape it depends on" convention.
 */
export interface PreviewReferenceData {
  language: LanguageIndex;
  constants: readonly ObjectConstant[];
  /**
   * The dat's terrain_restrictions table, read alongside `--terrain-table`'s
   * per-object `allowedTerrains`. Optional and defaults to empty: only the
   * document's own worker (worker.ts) currently threads it through, since
   * only the status bar needs an arbitrary runtime `ATTR_TERRAIN_ID` id
   * resolved — the Monte Carlo tools (balanceSummary.ts, consistencyChecker.ts)
   * are explicitly out of scope for this data (D7), so a caller that omits
   * it simply never suppresses an automatic forest spawn, same as before
   * this field existed.
   */
  terrainRestrictions?: readonly TerrainRestriction[];
}

/**
 * Sec.15 item 5's two land outcomes, split by whose problem each one is:
 * a canvas MARK where the script's own result is not what the map reads like,
 * and a drawer NOTE where the gap is in our model. `FailureMark` in types.ts
 * carries the measurement that put each on its own side of that line.
 *
 * Derived here, from the origins and the finished grid, rather than emitted by
 * `lands.ts` alongside its `PlacementFailure`s. Three reasons, in the order
 * they mattered:
 *
 * 1. **`owned` here means the same thing the canvas shows.** A later land
 *    overwrites an earlier one's tiles, so a land can finish with none through
 *    no fault of its own growth. Counting `grid.landId` after every land has
 *    run is the only place that fact exists; growth's own `state.owned` is a
 *    running figure of the same quantity, and re-deriving it from the finished
 *    grid cannot drift from what is drawn.
 * 2. It needs no change to the Sec.7 failure contract, which is 5.2's, and
 *    whose coalescing would have destroyed the per-land positions anyway.
 * 3. One O(dim²) pass, 40,000 reads on a Normal map against a ~460 ms median
 *    generation, so it does not need to be folded into a loop that already
 *    walks the grid.
 */
function collectLandOutcomes(
  origins: readonly LandOrigin[],
  grid: TileGrid,
): { marks: FailureMark[]; note?: SimulationNote } {
  const marks: FailureMark[] = [];
  if (origins.length === 0) return { marks };

  const owned = countOwnedTiles(origins, grid);

  let overwritten = 0;
  for (let index = 0; index < origins.length; index++) {
    const origin = origins[index];
    if (origin.fromOriginFallback) {
      marks.push({
        x: origin.x,
        y: origin.y,
        kind: "landAtMapCenter",
        commandSpan: origin.commandSpan,
        label:
          "No valid spot was found for this land, so the engine drops it at the map centre, on top of whatever is already there.",
      });
      continue;
    }
    // `declaredTargetTiles > 0` is the guard that keeps deliberate zero-tile
    // stamps out of the count. Scripts use them as walls and markers,
    // AK_Six_Points draws an ellipse out of 120 of them, and a land that
    // asked for nothing and got nothing has not failed at anything.
    if (owned[index] === 0 && origin.declaredTargetTiles > 0) overwritten++;
  }

  return {
    marks,
    note:
      overwritten > 0
        ? {
            key: "landOverwrittenBeforeGrowth",
            prominence: "drawer",
            stage: "S1",
            text: `${overwritten} ${overwritten === 1 ? "land is" : "lands are"} missing from this map. Each one's starting square was covered by a later land before it could grow, so every tile it could have grown into was already taken. The game loses these lands the same way.`,
          }
        : undefined,
  };
}

/**
 * Sec.6.1's "Base fill": `base_terrain` (default GRASS) fills the whole grid
 * before any land is placed; `base_layer` fills the layer array. Both are
 * standalone `<LAND_GENERATION>` commands (not attributes), so, like
 * `cliffs.ts`'s own standalone attributes, they show up as plain
 * `InstantiatedCommand`s in the section's command list rather than folded
 * attributes; multiple occurrences are resolved last-wins by a forward scan,
 * matching guide:167's general duplicate-attribute rule (Sec.3 rule 10 only
 * folds attributes INSIDE a command block this way, not standalone commands,
 * so this stage has to do it itself). No stage file owns this today because
 * every one of them was tested via a hand-rolled `place()` helper that just
 * hardcoded `createTileGrid(dim, GRASS)`, this orchestrator is the first
 * caller that has to get it from the actual script.
 */
function resolveBaseFill(
  instantiated: InstantiatedScript,
  constants: readonly ObjectConstant[],
): { terrainId: number; layerId?: number; note?: SimulationNote } {
  const commands = instantiated.sections.get("LAND_GENERATION") ?? [];
  let terrainRef: InstantiatedValue;
  let layerRef: InstantiatedValue;
  for (const cmd of commands) {
    if (cmd.name === "base_terrain" && cmd.args[0] !== undefined)
      terrainRef = cmd.args[0].value;
    else if (cmd.name === "base_layer" && cmd.args[0] !== undefined)
      layerRef = cmd.args[0].value;
  }

  const grassId = resolveTerrainId(constants, "GRASS") ?? 0; // 0: never crashes (CLAUDE.md), even against a stub/empty reference DB
  const resolvedTerrainId = resolveTerrainId(
    constants,
    terrainRef,
    instantiated.symbols,
    instantiated.aliases,
  );
  const layerId = resolveTerrainId(
    constants,
    layerRef,
    instantiated.symbols,
    instantiated.aliases,
  );

  const note: SimulationNote | undefined =
    terrainRef !== undefined && resolvedTerrainId === undefined
      ? {
          key: "baseTerrainUnresolved",
          prominence: "drawer",
          stage: "S1",
          text: `This map's reference data doesn't know the terrain "${String(terrainRef)}", so the preview fell back to GRASS as the base terrain.`,
        }
      : undefined;

  return { terrainId: resolvedTerrainId ?? grassId, layerId, note };
}

/** Sec.5: a StageSnapshot copies ONLY the four renderable layers, `.slice()` on a typed array copies, unlike a plain reference, which matters because every later stage keeps mutating the same live grid. */
function captureSnapshot(stage: StageId, grid: TileGrid): StageSnapshot {
  return {
    stage,
    dim: grid.dim,
    terrain: grid.terrain.slice(),
    layer: grid.layer.slice(),
    elevation: grid.elevation.slice(),
    cliff: grid.cliff.slice(),
  };
}

/**
 * Sec.10's own SimulationNote doc: "the generator appends notes freely and a
 * final pass keeps the first note per key." `instantiateScript` already
 * dedupes its OWN notes internally; no individual stage file dedupes against
 * notes from a DIFFERENT stage (there would be nothing to dedupe against,
 * each only ever sees its own run). This final cross-stage pass is what the
 * spec's sentence is actually describing, and it has nowhere to live except
 * here, the one place that sees every stage's notes at once.
 */
function dedupeNotes(notes: readonly SimulationNote[]): SimulationNote[] {
  const seen = new Set<string>();
  const out: SimulationNote[] = [];
  for (const note of notes) {
    if (seen.has(note.key)) continue;
    seen.add(note.key);
    out.push(note);
  }
  return out;
}

/**
 * Sec.10: `generatePreview(parse, refDb, settings, opts): PreviewResult`.
 * Runs S0 (`instantiateScript`) through S6 (`applyObjects`) once, in the
 * fixed order Sec.5 pins, over the single live `TileGrid` every stage from
 * S1 on mutates in place. Never throws (CLAUDE.md/Sec.2): every stage this
 * calls already degrades rather than crashes on malformed/pathological
 * input (the corpus gate below is what actually proves that composition
 * holds, not this function's own logic).
 */
export function generatePreview(
  parse: ParseResult,
  refDb: PreviewReferenceData,
  settings: PreviewSettings,
  opts: PreviewOptions,
): PreviewResult {
  const { language, constants } = refDb;
  const instantiated = instantiateScript(parse, language, settings, opts.seed);

  const {
    terrainId: baseTerrainId,
    layerId: baseLayerId,
    note: baseFillNote,
  } = resolveBaseFill(instantiated, constants);
  const grid = createTileGrid(instantiated.dim, baseTerrainId, baseLayerId);

  const snapshots: StageSnapshot[] | undefined = opts.collectSnapshots
    ? []
    : undefined;
  const snapshot = (stage: StageId): void => {
    if (snapshots) snapshots.push(captureSnapshot(stage, grid));
  };

  // S1 to S3 run on the game's own random stream, each stage continuing it
  // where the one before left it (Sec.8, rev 10), from S0's parse-time draws
  // through origins, growth, the cleanup's restore draws, every hill and
  // every cliff. Each stage takes the stream as plain data and hands it back
  // the same way, so the order of the draws is visible here in the order of
  // the calls. S4 and later keep their own substreams.
  const landResult = placeLandOrigins(instantiated, grid, constants);
  const grown = growLands(
    landResult.origins,
    grid,
    landResult.reports,
    landResult.stream,
  );
  // Read right after growth and before the cleanup pass below, which also
  // clears `landId`. A land the cleanup erases was not buried by a later
  // stamp, and counting it here would give the note the wrong reason. Reading
  // it this early also keeps the marks a statement about land generation
  // rather than about whatever S4 painted over the result.
  const landOutcomes = collectLandOutcomes(landResult.origins, grid);
  // The cleanup note needs the same before-cleanup reading, to tell a land
  // the cleanup erased from one it only trimmed.
  const ownedAfterGrowth = countOwnedTiles(landResult.origins, grid);
  const waterId = resolveTerrainId(constants, "WATER");
  const cleanup = createCleanupTally(constants);
  // Sec.6.1 rules 9 to 11. Painting, then the cleanup, whose restored tiles
  // spend the base terrain's decoration draws. Heights were written during
  // growth, so base_elevation only has notes left to give.
  const landStream = finishLandStage(
    landResult.origins,
    grid,
    baseTerrainId,
    constants,
    grown,
    (_tile, formerTerrain, formerLand) =>
      recordCleanup(cleanup, "S1", baseTerrainId, formerTerrain, formerLand),
  );
  const baseElevationNoteList = baseElevationNotes(
    instantiated,
    landResult.origins,
  );
  snapshot("S1");

  const elevationResult = applyElevation(
    instantiated,
    grid,
    constants,
    landResult.origins,
    landStream,
  );
  snapshot("S2");

  const cliffsResult = applyCliffs(
    instantiated,
    grid,
    constants,
    landResult.origins,
    elevationResult.stream,
  );
  snapshot("S3");

  // A beach before <TERRAIN_GENERATION>, so that `base_terrain BEACH`, an
  // ordinary idiom (67 uses across the tracked corpus), has a beach to match
  // when S4 starts. It used to run at the end of the land stage, and DE says
  // that is too early. lh1 grows hills on the DESERT around a WATER land and
  // matches DE only if that DESERT is not beached first. Here, after the
  // cliffs, it is an assumption no DE map has tested, and on a script with no
  // create_terrain it changes nothing the end of the stage would not redo.
  const beachedBeforeTerrains = applyAutomaticBeach(grid, constants);
  const terrainsResult = applyTerrains(
    instantiated,
    grid,
    constants,
    landResult.origins,
    opts.seed,
  );
  // The end of the terrain stage, in the game's order (Sec.6.4, rev 10).
  // Cliff lines get their earlier terrain back, then the cleanup runs
  // against WATER, then the beach pass. So hills and cliffs both saw the
  // coast before the cleanup, and wc1 matches DE only this way.
  finishTerrainStage(
    grid,
    cliffsResult.lineTiles,
    waterId,
    waterId === undefined
      ? undefined
      : (_tile, formerTerrain, formerLand) =>
          recordCleanup(cleanup, "S4", waterId, formerTerrain, formerLand),
  );
  const beachedAtTerrainEnd = applyAutomaticBeach(grid, constants);
  snapshot("S4");

  const connectionsResult = applyConnections(
    instantiated,
    grid,
    constants,
    landResult.origins,
    opts.seed,
  );
  // MEASURED 2026-09-02, RMSTEST_70 (Sec.15 item 31): a beach pass DOES run
  // after connection painting. Three runs, two islands joined by one
  // create_connect_all_players_land { replace_terrain WATER DIRT } carving a
  // causeway through open water with no other land/water boundary nearby —
  // total beach came back 840-961 tiles against ~250-300 expected from the
  // two islands' own coastlines alone (perimeter 310+328), and the excess
  // sat right along the causeway's own route rather than clustered at the
  // islands, including around isolated single-tile DIRT dabs the path left
  // in open water. This replaces a single late pass that shipped for years
  // (see the beach-timing history at Sec.6.4) and was withdrawn for the same
  // reason it is added back here: measure, don't guess a third moment.
  const beachedAfterConnections = applyAutomaticBeach(grid, constants);
  snapshot("S5");

  // Terrain painting is final by this point (S4/S5 are both behind us), so
  // the forest-wood aggregate can read the finished grid, and the
  // suppression scan can resolve which auto-spawn slots the script has
  // retargeted off their terrain. Both run before S6 because S6 does not
  // need either of them; resourceSummary (below) needs S6's real placements
  // AND both of these, so it runs last.
  const suppression = scanAutoTreeEffects(
    instantiated,
    constants,
    refDb.terrainRestrictions ?? [],
  );
  const forestWood = computeForestWood(
    grid,
    constants,
    constants,
    suppression.suppressed,
    suppression.yieldOverrides,
  );

  const objectsResult = applyObjects(
    instantiated,
    grid,
    constants,
    landResult.origins,
    opts.seed,
  );
  snapshot("S6");

  const resourceTotals = computeResourceSummary(
    objectsResult.objects,
    objectsResult.players,
    forestWood,
    constants,
    instantiated.symbols,
    instantiated.aliases,
    suppression.yieldOverrides,
  );

  const reports: CommandReport[] = [
    ...landResult.reports,
    ...elevationResult.reports,
    ...cliffsResult.reports,
    ...terrainsResult.reports,
    ...connectionsResult.reports,
    ...objectsResult.reports,
  ];

  // Worth saying out loud in the drawer: this sand is the only terrain on the
  // map that no line of the script asked for, so an author looking for the
  // command that put it there will not find one.
  const beached =
    beachedBeforeTerrains +
    terrainsResult.beached +
    beachedAtTerrainEnd +
    beachedAfterConnections;
  const beachNote: SimulationNote | undefined =
    beached > 0
      ? {
          key: "automaticBeach",
          prominence: "drawer",
          stage: "S1",
          text: `The engine lays a beach wherever the ground meets deeper ground, with no command asking for it — ${beached} ${beached === 1 ? "tile" : "tiles"} here. That is land against shallows and shallows against open water as well as land against open water, so a shallows band out to sea is edged on both of its sides. A create_terrain command can choose which terrain the beach is for its own tiles with beach_terrain.`,
        }
      : undefined;

  // Same convention as beachNote just above: worth saying out loud, since
  // this wood is the only figure on the status bar that no line of the
  // script asked for directly.
  const forestWoodNote: SimulationNote | undefined =
    forestWood > 0
      ? {
          key: "forestWood",
          prominence: "drawer",
          stage: "S4",
          text: `Forest terrains spawn real, choppable trees automatically as they paint, no create_object involved — ${Math.round(forestWood)} wood counted from those here. This is folded into the status bar's Total and Neutral wood.`,
        }
      : undefined;

  const notes = dedupeNotes(
    [
      ...instantiated.notes,
      baseFillNote,
      beachNote,
      landOutcomes.note,
      cleanupNote(
        cleanup,
        landResult.origins,
        ownedAfterGrowth,
        constants,
        parse.lineOffsets,
      ),
      ...landResult.notes,
      ...baseElevationNoteList,
      ...cliffsResult.notes,
      ...terrainsResult.notes,
      ...connectionsResult.notes,
      ...objectsResult.notes,
      suppression.note,
      forestWoodNote,
    ].filter((n): n is SimulationNote => n !== undefined),
  );

  return {
    dim: instantiated.dim,
    seedUsed: opts.seed,
    snapshots,
    objects: objectsResult.objects,
    players: objectsResult.players,
    reports,
    failureMarks: landOutcomes.marks,
    notes,
    grid,
    landOrigins: landResult.origins,
    resourceTotals,
    cliffPieces: cliffsResult.pieces,
  };
}
