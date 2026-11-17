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
import { parseOptionsFor } from "./parseOptions";
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
import { NO_LAYER, createTileGrid, resolveTerrainId } from "./grid";
import {
  placeLandOrigins,
  growLands,
  finishLandStage,
  baseElevationNotes,
  countOwnedTiles,
  cleanTerrainAgainst,
} from "./lands";
import { applyElevation } from "./elevation";
import { applyCliffs, finishTerrainStage } from "./cliffs";
import {
  applyAutomaticBeach,
  applyTerrains,
  clearBeachLayers,
  paintedView,
  resolveComposites,
} from "./terrains";
import { applyConnections } from "./connections";
import { applyObjects, type ObjectConstant } from "./objects";
import { computeForestWood } from "./forestTrees";
import {
  scanAutoTreeEffects,
  type TerrainRestriction,
} from "./forestTreeSuppression";
import { computeResourceSummary } from "./resourceSummary";
import { cleanupNote, createCleanupTally, recordCleanup } from "./cleanupNote";
import { createDeChainStream, resumeDeStream } from "./deRandom";
import { ObjectCatalog, type ObjectDataFile } from "./deObjectData";
import { TerrainObjectWorld, decorationTables } from "./terrainObjects";
import {
  collectEffects,
  runDeObjectStage,
  terrainObjectLayer,
} from "./deObjects";
import { COMPOSITE_AS_LAYER, COMPOSITE_AS_TERRAIN } from "./terrains";
import { COMPOSITE_TERRAINS, terrainClassTable } from "./terrainClass";

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
  /**
   * `reference/data/object-data.json`, the dat's object fields. With it the
   * object stage is DE's own (Sec.6.6, rev 12) and the result carries
   * `deObjects`. Without it the older approximate stage in `objects.ts` runs,
   * which is what a caller that never loads the file still gets.
   */
  objectData?: ObjectDataFile;
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
  // The game behaves as if the map started as GRASS under a GRASS layer,
  // `base_terrain` cleared the layer and `base_layer` set it, in script
  // order (Sec.6.1, rev 11). So a `base_layer` written before `base_terrain`
  // is lost (ly2), and a script with no `base_terrain` line leaves every
  // unpainted tile with a GRASS layer (ly3). `null` is "no layer".
  let terrainRef: InstantiatedValue;
  let layerRef: InstantiatedValue | null = "GRASS";
  for (const cmd of commands) {
    if (cmd.name === "base_terrain" && cmd.args[0] !== undefined) {
      terrainRef = cmd.args[0].value;
      layerRef = null;
    } else if (cmd.name === "base_layer" && cmd.args[0] !== undefined)
      layerRef = cmd.args[0].value;
  }

  const grassId = resolveTerrainId(constants, "GRASS") ?? 0; // 0: never crashes (CLAUDE.md), even against a stub/empty reference DB
  const resolvedTerrainId = resolveTerrainId(
    constants,
    terrainRef,
    instantiated.symbols,
    instantiated.aliases,
  );
  const layerId =
    layerRef === null
      ? undefined
      : resolveTerrainId(
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
  const instantiated = instantiateScript(
    parse,
    language,
    settings,
    opts.seed,
    opts.includeFiles,
    parseOptionsFor(constants),
  );

  const {
    terrainId: baseTerrainId,
    layerId: baseLayerId,
    note: baseFillNote,
  } = resolveBaseFill(instantiated, constants);
  const grid = createTileGrid(instantiated.dim, baseTerrainId, baseLayerId);

  // The object stage's data and its world of terrain objects, which the land
  // and cliff stages fill long before the object stage runs (Sec.6.6, rev
  // 12). Effects change the object data before anything is generated,
  // wherever their lines stand, so they are read now.
  let catalog: ObjectCatalog | undefined;
  let world: TerrainObjectWorld | undefined;
  if (refDb.objectData) {
    catalog = new ObjectCatalog(refDb.objectData, terrainClassTable(constants));
    catalog.setOverrides(collectEffects(instantiated, constants, catalog));
    world = new TerrainObjectWorld(
      catalog,
      instantiated.dim,
      decorationTables(constants),
      createDeChainStream(opts.seed, 6),
    );
  }

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
  // The land zones the object stage reads (write-up 6.2 step 3) are growth's
  // own one-byte grid, which the cleanup leaves alone in the game.
  let landZone = new Int16Array(grid.terrain.length).fill(0xfe);
  const grown = growLands(
    landResult.origins,
    grid,
    landResult.reports,
    landResult.stream,
    (zones) => {
      landZone = Int16Array.from(zones);
    },
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
    world,
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
    world,
  );
  snapshot("S3");

  const terrainsResult = applyTerrains(
    instantiated,
    grid,
    constants,
    landResult.origins,
    cliffsResult.stream,
  );
  // The end of the terrain stage, in the game's order (Sec.6.4, rev 11).
  // Composite terrains resolve first, keeping what each tile was painted as
  // for the connections and the objects. Then cliff lines get their earlier
  // terrain back and the cleanup runs against WATER, then the beach pass,
  // which reads each tile's beach_terrain mark.
  const terrainBeforeEnd = world ? grid.terrain.slice() : undefined;
  const composites = resolveComposites(grid);
  finishTerrainStage(
    grid,
    cliffsResult.lineTiles,
    waterId,
    waterId === undefined
      ? undefined
      : (_tile, formerTerrain, formerLand) =>
          recordCleanup(cleanup, "S4", waterId, formerTerrain, formerLand),
  );
  const beachedAtTerrainEnd = applyAutomaticBeach(grid, constants, {
    beachMark: terrainsResult.beachMark,
  });
  // A tile the end of the stage changed loses the terrain objects its old
  // terrain made or its new one refuses. Resolving a composite layer is not
  // such a change (write-up 11), so a tile that still holds what its layer
  // composite resolves to is spared.
  if (world && terrainBeforeEnd)
    for (let i = 0; i < grid.terrain.length; i++) {
      if (terrainBeforeEnd[i] === grid.terrain[i]) continue;
      if (composites.kind[i] === COMPOSITE_AS_LAYER) {
        const r = COMPOSITE_TERRAINS.get(composites.layer[i]);
        if (r && r[0] === grid.terrain[i] && r[1] === grid.layer[i]) continue;
      }
      world.changed(i, terrainBeforeEnd[i], grid.terrain[i]);
    }
  snapshot("S4");

  const terrainBeforeConnections = world ? grid.terrain.slice() : undefined;
  const connectionsResult = applyConnections(
    instantiated,
    grid,
    constants,
    landResult.origins,
    terrainsResult.stream,
    composites,
  );
  // The end of the connection stage, only when the script has one: the
  // WATER cleanup again, then the beach rule again with no beach_terrain
  // marks (Sec.6.5, rev 11, cn8a and cn8c). RMSTEST_70 first showed the
  // second beach, along a causeway carved through open water.
  let beachedAfterConnections = 0;
  if (instantiated.sections.has("CONNECTION_GENERATION")) {
    if (waterId !== undefined)
      cleanTerrainAgainst(grid, waterId, (i) => {
        grid.layer[i] = NO_LAYER;
      });
    beachedAfterConnections = applyAutomaticBeach(grid, constants);
  }
  if (world && terrainBeforeConnections)
    for (let i = 0; i < grid.terrain.length; i++)
      world.changed(i, terrainBeforeConnections[i], grid.terrain[i]);
  // The object stage sees layers as they were before this cleanup (write-up 6.5).
  const layerBeforeCleanup = grid.layer.slice();
  // A beach tile has no layer, read after the connections, with or without
  // a connection section (Sec.6.4, rev 11).
  clearBeachLayers(grid, constants);
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

  // The object stage and the forest count read the map as painted, so a
  // tile still holding a composite reads as the composite, as the study
  // found DE's object stage doing (Sec.6.4's end, step 1). The grid goes back
  // to its resolved terrain afterwards, which is what is drawn. A swap of
  // the two arrays rather than a parameter, since S6 reads `grid.terrain` in
  // dozens of places, and `finally` so a throw cannot leave the drawn map
  // showing the painted one.
  const resolved = { terrain: grid.terrain, layer: grid.layer };
  const painted = paintedView(grid, composites);
  grid.terrain = painted.terrain;
  grid.layer = painted.layer;
  let forestWood: number;
  let objectsResult!: Pick<
    ReturnType<typeof applyObjects>,
    "objects" | "players" | "reports" | "notes"
  >;
  try {
    forestWood = computeForestWood(
      grid,
      constants,
      constants,
      suppression.suppressed,
      suppression.yieldOverrides,
    );
    if (!catalog)
      objectsResult = applyObjects(
        instantiated,
        grid,
        constants,
        landResult.origins,
        opts.seed,
      );
  } finally {
    grid.terrain = resolved.terrain;
    grid.layer = resolved.layer;
  }
  let deObjects: PreviewResult["deObjects"];
  let terrainObjects: PreviewResult["terrainObjects"];
  if (catalog && world) {
    const de = runDeStage(
      instantiated,
      constants,
      catalog,
      world,
      grid,
      composites,
      layerBeforeCleanup,
      landResult.origins,
      cliffsResult.pieces,
      connectionsResult.stream,
      landZone,
      settings,
      opts.seed,
      opts.objectTrace,
    );
    deObjects = de.objects;
    terrainObjects = terrainObjectLayer(de.objects, constants);
    objectsResult = {
      objects: de.placed,
      players: de.players,
      reports: de.reports,
      notes: [],
    };
  }
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
  const beached = beachedAtTerrainEnd + beachedAfterConnections;
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
    deObjects,
    terrainObjects,
  };
}

/**
 * DE's object stage (Sec.6.6, rev 12), after the connections: the terrain
 * objects' own pass over every tile, then every scripted command. Both read
 * the map as painted where a composite still holds (write-up 6.5 and 11),
 * and layers from before the beach-layer cleanup.
 */
function runDeStage(
  instantiated: InstantiatedScript,
  constants: PreviewReferenceData["constants"],
  catalog: ObjectCatalog,
  world: TerrainObjectWorld,
  grid: TileGrid,
  composites: ReturnType<typeof resolveComposites>,
  layerBeforeCleanup: Uint16Array,
  origins: readonly LandOrigin[],
  pieces: PreviewResult["cliffPieces"],
  streamState: ReturnType<typeof applyConnections>["stream"],
  landZone: Int16Array,
  settings: PreviewSettings,
  seed: number,
  trace?: (line: string) => void,
) {
  const n = grid.terrain.length;
  const holds = (i: number): boolean => {
    const kind = composites.kind[i];
    if (kind === 0) return false;
    const comp =
      kind === COMPOSITE_AS_TERRAIN
        ? composites.terrain[i]
        : composites.layer[i];
    const r = COMPOSITE_TERRAINS.get(comp);
    // Against the cleaned layer, so a composite tile the beach pass turned
    // into beach (and so lost its layer) is no longer the composite.
    return (
      r !== undefined && r[0] === grid.terrain[i] && r[1] === grid.layer[i]
    );
  };
  // The terrain the scripted objects see, and the table each tile draws.
  const view = grid.terrain.slice();
  const viewLayer = layerBeforeCleanup.slice();
  const table = grid.terrain.slice();
  for (let i = 0; i < n; i++) {
    if (!holds(i)) continue;
    // A terrain composite shows as itself with its resolved layer kept. A
    // layer composite shows as the terrain under it with the composite as
    // its layer.
    view[i] = composites.terrain[i];
    if (composites.kind[i] === COMPOSITE_AS_LAYER)
      viewLayer[i] = composites.layer[i];
    // A composite terrain draws its own table, and a tile whose layer was
    // painted with a composite draws the table of the terrain under the
    // layer (write-up 11). Both are the painted terrain.
    table[i] = composites.terrain[i];
  }
  const stream = resumeDeStream(streamState);
  world.objectStage(stream, grid.terrain, pieces, (i) => table[i]);
  return runDeObjectStage({
    script: instantiated,
    constants,
    catalog,
    world,
    stream,
    anim: createDeChainStream(seed, 3),
    dim: grid.dim,
    terrain: view,
    layer: viewLayer,
    elevation: grid.elevation,
    landZone,
    origins,
    playerCount: settings.playerCount,
    teams: settings.teams,
    civilizations: settings.civilizations ?? [],
    pieces,
    trace,
    paint: (tile, terrain) => {
      grid.terrain[tile] = terrain;
    },
  });
}
