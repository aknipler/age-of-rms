import { useMemo, useState } from "react";
import { usePreviewView } from "./PreviewViewContext";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import { createTerrainPalette, type TerrainConstant } from "../../preview/render/palette";
import { usePreviewResultContext } from "../../PreviewResultContext";
import { HelpTip } from "../HelpTip";
import { PreviewCanvas, type HoveredTile } from "./PreviewCanvas";
import type { PlacedObject } from "../../preview/generator/types";
import { PreviewNotes } from "./PreviewNotes";
import styles from "./PreviewPane.module.css";

// Same double-cast reasoning as parserWorker.ts: resolveJsonModule infers a
// literal type from the file that does not always structurally overlap the
// hand-written interface, and `npm run validate:reference` (ajv) is the real
// guarantee the data is shaped correctly.
const terrainConstants = (gameConstantsRaw as unknown as { constants: TerrainConstant[] }).constants;

/**
 * The objects on one tile, as a readout fragment: `GOLD x4`, or
 * `BOAR (P3), DEER` where they differ.
 *
 * Grouped by (objectRef, player) rather than listed one per line, because
 * the common case for a stacked tile is several of the same thing — a tight
 * group of four gold, say — and "GOLD, GOLD, GOLD, GOLD" is noise. Player
 * ownership is shown only where an object has one: most of what a script
 * places is Gaia, and "(Gaia)" on every row would bury the cases that matter.
 */
function describeObjects(objects: readonly PlacedObject[]): string {
  const counts = new Map<string, number>();
  for (const object of objects) {
    const label = object.player === undefined ? object.objectRef : `${object.objectRef} (P${object.player})`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => (count > 1 ? `${label} x${count}` : label)).join(", ");
}

/**
 * The approximate map preview (CREATION_PLAN 4.2/4.3, docs/preview-design.md).
 *
 * Runs the real `generatePreview()` in a dedicated worker (`usePreviewResult`,
 * Sec.10) over the live document's `ParseResult` — the fixture this pane drew
 * against through 4.2 (`src/preview/fixture.ts`) is gone; CREATION_PLAN 4.3's
 * last line was "swaps the fixture for the worker" and this is that swap.
 *
 * Current vs Final (Sec.5): both toggle positions currently drive the
 * IDENTICAL result. Real Current semantics need `truncateAst()` and a
 * pin-line UI control (see `PreviewViewContext.tsx`'s `PreviewViewMode`
 * doc) — neither exists yet, no CREATION_PLAN step currently owns building
 * them, and shipping a toggle that silently does nothing would be worse
 * than shipping one that's honest about it (`breakdown.sidePanel
 * .previewToggle`'s HelpTip copy says so).
 */
export function PreviewPane() {
  // Everything durable comes from context, not local state: this pane
  // unmounts on every tab switch and none of it may (PreviewViewContext for
  // the controls, PreviewResultContext for the generated map itself).
  const { view, setView, seed, setSeed, colorMode, setColorMode } = usePreviewView();
  const [hovered, setHovered] = useState<HoveredTile | null>(null);

  const result = usePreviewResultContext();

  // Rebuilt when the mode changes: the palette memoises a colour per terrain
  // id, and that cache is only valid for one mode. Keeping one palette and
  // passing the mode per call would move the mode into 40,000 per-tile lookups
  // for a value that changes once per click.
  const palette = useMemo(() => createTerrainPalette(terrainConstants, colorMode), [colorMode]);
  // The LAST snapshot, not the first: Sec.5 orders snapshots S1-S6 and "the
  // S6 snapshot is the final grid" -- the fixture only ever produced one
  // snapshot (tagged S6) so index 0 happened to be correct there, but the
  // real generator's collectSnapshots:true returns all six.
  const snapshot = result?.snapshots?.at(-1);

  // The legend only lists terrains the map actually uses. Computed from the
  // grid rather than from the reference table, so it stays honest when a map
  // uses three terrains and the DB knows fifteen.
  const terrainsInUse = useMemo(() => {
    if (snapshot === undefined) return [];
    const seen = new Set<number>();
    for (const id of snapshot.terrain) seen.add(id);
    return [...seen].sort((a, b) => a - b);
  }, [snapshot]);

  // null while the very first generation is still in flight (debounce +
  // worker turnaround, ~300ms+) -- after that, `result` holds the last
  // successful generation even while a newer one is running, same
  // stay-on-last-known-state convention the Problems panel already follows
  // for parse diagnostics.
  if (result === null || snapshot === undefined) return null;
  const dim = result.dim;

  return (
    <div className={styles.pane}>
      <div className={styles.controls}>
        {/*
          The id is the existing `breakdown.sidePanel.previewToggle` rather
          than a new `preview.toggle`. Sec.5 lists the latter "if the pane
          hosts its own toggle distinct from the Breakdown side panel" — it
          does not; this IS that toggle, in that panel, and a second id for
          one control would leave the audit checking two entries for the same
          thing. Its copy is rewritten this session, as Sec.5 requires.
        */}
        <HelpTip id="breakdown.sidePanel.previewToggle">
          <span className={styles.toggle}>
            View:
            <label>
              <input
                type="radio"
                name="preview-view"
                checked={view === "current"}
                onChange={() => setView("current")}
              />
              Current
            </label>
            <label>
              <input
                type="radio"
                name="preview-view"
                checked={view === "final"}
                onChange={() => setView("final")}
              />
              Final
            </label>
          </span>
        </HelpTip>
      </div>

      <div className={styles.controls}>
        <HelpTip id="preview.seedChip">
          <label className={styles.seed}>
            Seed
            <input
              type="number"
              className={styles.seedInput}
              value={seed}
              min={0}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setSeed(Math.max(0, Math.trunc(next)));
              }}
            />
          </label>
        </HelpTip>
        <HelpTip id="preview.reroll">
          <button
            type="button"
            className={styles.reroll}
            // A new seed, drawn once per click. Math.random is fine HERE —
            // Sec.8's ban on it covers src/preview/generator/, where
            // reproducibility is the whole contract. Picking which seed to
            // show a user is not part of that contract; consuming it
            // deterministically is.
            onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}
          >
            Re-roll
          </button>
        </HelpTip>
        {/*
          Two real colour sources, not a cosmetic skin — each resolves what the
          other collapses (see palette.ts's header). Game is the default
          because it is per-terrain; minimap is the game data's own colour
          class, which is coarser but separates forest from underbrush.
        */}
        <HelpTip id="preview.colorMode">
          <span className={styles.toggle}>
            <label>
              <input
                type="radio"
                name="preview-colors"
                checked={colorMode === "game"}
                onChange={() => setColorMode("game")}
              />
              Game
            </label>
            <label>
              <input
                type="radio"
                name="preview-colors"
                checked={colorMode === "minimap"}
                onChange={() => setColorMode("minimap")}
              />
              Minimap
            </label>
          </span>
        </HelpTip>
      </div>

      <PreviewCanvas
        result={result}
        snapshot={snapshot}
        palette={palette}
        onHoverTile={setHovered}
      />

      <div className={styles.readout}>
        {hovered === null ? (
          <span className={styles.readoutHint}>
            {dim}×{dim} · drag to pan · wheel to zoom · double-click to fit
          </span>
        ) : (
          <span>
            ({hovered.x}, {hovered.y}) {hovered.terrainName ?? `terrain ${hovered.terrain}`}
            {/* The layer is what a terrain_mask or base_layer painted on top.
                It is often the thing you are actually LOOKING at -- the tile
                is drawn as a heavy blend of the two -- so a readout naming
                only the terrain reads as a colour bug. */}
            {hovered.layer !== null ? ` + ${hovered.layerName ?? `terrain ${hovered.layer}`} layer` : ""}
            {hovered.elevation > 0 ? ` · elev ${hovered.elevation}` : ""}
            {hovered.cliff ? " · cliff" : ""}
            {hovered.objects.length > 0 && <> · {describeObjects(hovered.objects)}</>}
          </span>
        )}
      </div>

      <PreviewNotes result={result} palette={palette} terrainsInUse={terrainsInUse} />
    </div>
  );
}

