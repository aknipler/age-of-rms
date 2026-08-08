// generatePreview() — docs/preview-design.md Sec.10. PURE (CLAUDE.md hard
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
//     opts)`" — the truncation happens to `parse` before this function ever
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
//     here — this file has no `postMessage`, no `Worker`, nothing async.
//
// So this file does exactly one thing: run S0 through S6 once, synchronously,
// over whatever `parse` it is given, and hand back one PreviewResult.

import type { LanguageIndex } from "../../parser/language";
import type { ParseResult } from "../../parser/types";
import type {
  CommandReport,
  InstantiatedScript,
  InstantiatedValue,
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
import { placeLandOrigins, growLands, paintLandTerrain, applyBaseElevation } from "./lands";
import { applyElevation } from "./elevation";
import { applyCliffs } from "./cliffs";
import { applyAutomaticBeach, applyTerrains } from "./terrains";
import { applyConnections } from "./connections";
import { applyObjects, type ObjectConstant } from "./objects";

/**
 * The bundled reference data `generatePreview` needs — `instantiateScript`
 * (S0) wants the parser's `LanguageIndex`, every stage from S1 on wants the
 * `game-constants.json` array. NOT declared in `types.ts`: Sec.10 explicitly
 * lists what that file owns and this bundle isn't in it — it is a parameter
 * shape for this one entry point, the same category as `EligibilityContext`
 * living in terrains.ts rather than types.ts.
 *
 * `ObjectConstant` (objects.ts) is reused as the constants element type
 * rather than re-declaring an identical interface: it is a strict superset
 * of every other stage's own narrower projection of the same JSON array
 * (`TerrainConstantForMasks`, `TerrainConstantForElevation` — both just
 * `{constId, rmsConstant, category}`), so passing one `ObjectConstant[]`
 * array through to every stage typechecks with no cast, per each of those
 * files' own "each consumer states the narrow shape it depends on" convention.
 */
export interface PreviewReferenceData {
  language: LanguageIndex;
  constants: readonly ObjectConstant[];
}


/**
 * Sec.6.1's "Base fill": `base_terrain` (default GRASS) fills the whole grid
 * before any land is placed; `base_layer` fills the layer array. Both are
 * standalone `<LAND_GENERATION>` commands (not attributes), so — like
 * `cliffs.ts`'s own standalone attributes — they show up as plain
 * `InstantiatedCommand`s in the section's command list rather than folded
 * attributes; multiple occurrences are resolved last-wins by a forward scan,
 * matching guide:167's general duplicate-attribute rule (Sec.3 rule 10 only
 * folds attributes INSIDE a command block this way, not standalone commands,
 * so this stage has to do it itself). No stage file owns this today because
 * every one of them was tested via a hand-rolled `place()` helper that just
 * hardcoded `createTileGrid(dim, GRASS)` — this orchestrator is the first
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
    if (cmd.name === "base_terrain" && cmd.args[0] !== undefined) terrainRef = cmd.args[0].value;
    else if (cmd.name === "base_layer" && cmd.args[0] !== undefined) layerRef = cmd.args[0].value;
  }

  const grassId = resolveTerrainId(constants, "GRASS") ?? 0; // 0: never crashes (CLAUDE.md), even against a stub/empty reference DB
  const resolvedTerrainId = resolveTerrainId(constants, terrainRef, instantiated.symbols);
  const layerId = resolveTerrainId(constants, layerRef, instantiated.symbols);

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

/** Sec.5: a StageSnapshot copies ONLY the four renderable layers — `.slice()` on a typed array copies, unlike a plain reference, which matters because every later stage keeps mutating the same live grid. */
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
 * notes from a DIFFERENT stage (there would be nothing to dedupe against —
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
export function generatePreview(parse: ParseResult, refDb: PreviewReferenceData, settings: PreviewSettings, opts: PreviewOptions): PreviewResult {
  const { language, constants } = refDb;
  const instantiated = instantiateScript(parse, language, settings, opts.seed);

  const { terrainId: baseTerrainId, layerId: baseLayerId, note: baseFillNote } = resolveBaseFill(instantiated, constants);
  const grid = createTileGrid(instantiated.dim, baseTerrainId, baseLayerId);

  const snapshots: StageSnapshot[] | undefined = opts.collectSnapshots ? [] : undefined;
  const snapshot = (stage: StageId): void => {
    if (snapshots) snapshots.push(captureSnapshot(stage, grid));
  };

  const landResult = placeLandOrigins(instantiated, grid, constants, opts.seed);
  growLands(landResult.origins, grid, landResult.reports, opts.seed);
  // Both strictly after growth, and both over the land's FINAL footprint
  // (Sec.6.1). Terrain first only for readability — they write different
  // arrays, so the order between them is not load-bearing.
  paintLandTerrain(landResult.origins, grid);
  const baseElevationNotes = applyBaseElevation(instantiated, landResult.origins, grid, constants);
  // The engine beaches at the end of land generation, before any
  // <TERRAIN_GENERATION> command runs. That ordering is load-bearing rather
  // than cosmetic: `base_terrain BEACH` is an ordinary idiom (67 uses across
  // the tracked corpus) and it matches nothing unless a beach already exists
  // by the time S4 starts. Whole grid, no scope — every land tile takes its
  // own beach here, and S4 then beaches per command. See applyAutomaticBeach.
  const beachedInLands = applyAutomaticBeach(grid, constants);
  snapshot("S1");

  const elevationResult = applyElevation(instantiated, grid, constants, landResult.origins, opts.seed);
  snapshot("S2");

  const cliffsResult = applyCliffs(instantiated, grid, constants, landResult.origins, opts.seed);
  snapshot("S3");

  const terrainsResult = applyTerrains(instantiated, grid, constants, landResult.origins, opts.seed);
  snapshot("S4");

  const connectionsResult = applyConnections(instantiated, grid, constants, landResult.origins, opts.seed);
  // DELIBERATELY no beach pass here. The engine beaches at the end of land
  // generation and at the end of every create_terrain command, both of which
  // have already run; connection painting can carve new water, and whether
  // the engine dresses THAT is unmeasured. Adding a pass here to be tidy would
  // be inventing a third moment nobody has observed — and the one datum
  // pointing at it points the other way, since `beach_terrain` is documented
  // to stop working entirely when a <CONNECTION_GENERATION> section exists.
  snapshot("S5");

  const objectsResult = applyObjects(instantiated, grid, constants, landResult.origins, opts.seed);
  snapshot("S6");

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
  const beached = beachedInLands + terrainsResult.beached;
  const beachNote: SimulationNote | undefined =
    beached > 0
      ? {
          key: "automaticBeach",
          prominence: "drawer",
          stage: "S1",
          text: `The engine lays a beach wherever the ground meets deeper ground, with no command asking for it — ${beached} ${beached === 1 ? "tile" : "tiles"} here. That is land against shallows and shallows against open water as well as land against open water, so a shallows band out to sea is edged on both of its sides. A create_terrain command can choose which terrain the beach is for its own tiles with beach_terrain.`,
        }
      : undefined;

  const notes = dedupeNotes([
    ...instantiated.notes,
    baseFillNote,
    beachNote,
    ...landResult.notes,
    ...baseElevationNotes,
    ...cliffsResult.notes,
    ...terrainsResult.notes,
    ...connectionsResult.notes,
    ...objectsResult.notes,
  ].filter((n): n is SimulationNote => n !== undefined));

  return {
    dim: instantiated.dim,
    seedUsed: opts.seed,
    snapshots,
    objects: objectsResult.objects,
    players: objectsResult.players,
    reports,
    notes,
  };
}
