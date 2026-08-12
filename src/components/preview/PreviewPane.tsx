import { Fragment, useMemo, useState } from "react";
import { usePreviewView } from "./PreviewViewContext";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import { createTerrainPalette, type TerrainConstant } from "../../preview/render/palette";
import { usePreviewResultContext } from "../../PreviewResultContext";
import { usePreviewCut } from "../../PreviewCutContext";
import type { TilePoint } from "../../preview/render/projection";
import { HelpTip } from "../HelpTip";
import { ScriptName } from "../ScriptName";
import { PreviewCanvas } from "./PreviewCanvas";
import { describeTile, indexMarksByTile, indexObjectsByTile, tallyObjects, type TileInfo } from "./tileInfo";
import { PreviewNotes } from "./PreviewNotes";
import styles from "./PreviewPane.module.css";

// Same double-cast reasoning as parserWorker.ts: resolveJsonModule infers a
// literal type from the file that does not always structurally overlap the
// hand-written interface, and `npm run validate:reference` (ajv) is the real
// guarantee the data is shaped correctly.
const terrainConstants = (gameConstantsRaw as unknown as { constants: TerrainConstant[] }).constants;

/**
 * One labelled line of the tile readout.
 *
 * The readout is a two-column grid rather than one run of text: a tile with
 * four objects on it used to overflow the column and get cut off by an
 * ellipsis, which hid exactly the interesting cases (a stacked tile is the
 * one you clicked BECAUSE something odd is on it). Splitting by kind also
 * means the eye can find "elevation" without reading the terrain first.
 */
function ReadoutRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className={styles.readoutLabel}>{label}</dt>
      <dd className={styles.readoutValue}>{children}</dd>
    </>
  );
}

/**
 * The objects on one tile: `GOLD ×4`, or `BOAR (P3), DEER` where they differ.
 *
 * Player ownership is shown only where an object has one — most of what a
 * script places is Gaia, and "(Gaia)" on every entry would bury the cases
 * that matter.
 */
function ObjectList({ objects }: { objects: TileInfo["objects"] }) {
  const tallies = tallyObjects(objects);
  return (
    <>
      {tallies.map((tally, index) => (
        <Fragment key={`${tally.objectRef}-${tally.player ?? ""}`}>
          {index > 0 && ", "}
          <ScriptName name={tally.objectRef} />
          {tally.player !== undefined && ` (P${tally.player})`}
          {tally.count > 1 && ` ×${tally.count}`}
        </Fragment>
      ))}
    </>
  );
}

/** The terrain/layer/elevation/objects rows for one tile. */
function TileReadout({ tile }: { tile: TileInfo }) {
  return (
    <dl className={styles.readoutGrid}>
      <ReadoutRow label="Tile">
        ({tile.x}, {tile.y})
      </ReadoutRow>
      <ReadoutRow label="Terrain">
        {tile.terrainName ?? `terrain ${tile.terrain}`}
        {/* The layer is what a terrain_mask or base_layer painted on top. It
            is often the thing you are actually LOOKING at — the tile is drawn
            as a heavy blend of the two — so a readout naming only the terrain
            reads as a colour bug. */}
        {tile.layer !== null && ` + ${tile.layerName ?? `terrain ${tile.layer}`} layer`}
      </ReadoutRow>
      <ReadoutRow label="Elevation">
        {tile.elevation}
        {tile.cliff && " · cliff"}
      </ReadoutRow>
      {tile.objects.length > 0 && (
        <ReadoutRow label="Objects">
          <ObjectList objects={tile.objects} />
        </ReadoutRow>
      )}
      {/*
        The other half of the marker. A red triangle on the map says something
        is wrong HERE; only this row says what, and it is the reason the marks
        need no legend entry beyond naming the glyph — the explanation is one
        hover away rather than in a key the reader has to hold in their head.
      */}
      {tile.marks.map((mark) => (
        <ReadoutRow key={`${mark.kind}-${mark.commandSpan.start}`} label="Problem">
          <span className={styles.readoutProblem}>{mark.label}</span>
        </ReadoutRow>
      ))}
    </dl>
  );
}

/**
 * The Current cut point (Sec.5's pin).
 *
 * Two states, one button. Unpinned, Current follows the caret and the button
 * offers to hold it where it is; pinned, the same button lets go. A separate
 * "unpin" control would spend a second slot in a narrow row on a state that
 * is already visible in the label.
 *
 * The label says a LINE while the cut itself is a character offset (Sec.5).
 * That is deliberate: "line 34" is the only address the user shares with the
 * gutter, and "offset 812" would be true and useless. The shading in the code
 * is what shows the exact point. 1-based here, 0-based everywhere below,
 * converted once — in the two `+ 1`s in this component.
 *
 * Rendered only in Current. In Final the cut has no effect at all, and a
 * control that changes nothing is worse than no control — the same reasoning
 * that kept this toggle honest while the pin did not exist.
 */
function PinControl() {
  const { cursorLine, pinnedLine, pinCursor, unpin } = usePreviewCut();

  if (pinnedLine !== null) {
    return (
      <HelpTip id="preview.pinLine">
        <button type="button" className={`${styles.pin} ${styles.pinActive}`} onClick={unpin}>
          Pinned line {pinnedLine + 1} ✕
        </button>
      </HelpTip>
    );
  }

  return (
    <HelpTip id="preview.pinLine">
      {/* Disabled rather than hidden when nothing is selected: the row would
          otherwise lose a control every time the user cleared their selection,
          and a button that comes and goes reads as a glitch. HelpTip's own
          wrapper span carries the hover, so the explanation still works while
          the button itself is inert. */}
      <button
        type="button"
        className={styles.pin}
        onClick={pinCursor}
        disabled={cursorLine === null}
      >
        {cursorLine === null ? "Pin line" : `Pin line ${cursorLine + 1}`}
      </button>
    </HelpTip>
  );
}

/**
 * The approximate map preview (CREATION_PLAN 4.2/4.3, docs/preview-design.md).
 *
 * Runs the real `generatePreview()` in a dedicated worker (`usePreviewResult`,
 * Sec.10) over the live document's `ParseResult` — the fixture this pane drew
 * against through 4.2 (`src/preview/fixture.ts`) is gone; CREATION_PLAN 4.3's
 * last line was "swaps the fixture for the worker" and this is that swap.
 *
 * Current vs Final (Sec.5, CREATION_PLAN 4.6): Final draws the whole script,
 * Current draws the script truncated at the cut point — the pin, or the caret
 * while nothing is pinned. The truncation and the second generation happen in
 * `PreviewResultContext`; the code the cut leaves out is dimmed by `CodePane`
 * and `ItemCard`; this pane owns only the pin control, which reads and writes
 * `PreviewCutContext`.
 */
export function PreviewPane() {
  // Everything durable comes from context, not local state: this pane
  // unmounts on every tab switch and none of it may (PreviewViewContext for
  // the controls, PreviewResultContext for the generated map itself).
  const {
    view,
    setView,
    seed,
    setSeed,
    colorMode,
    setColorMode,
    selectedTile,
    toggleSelectedTile,
    clearSelectedTile,
    hiddenObjects,
  } = usePreviewView();
  // Hover is local because it dies with the pane and should: a pointer
  // position means nothing once you have switched tabs. The SELECTION lives in
  // the context above the tab switch, for the same reason the seed does.
  const [hovered, setHovered] = useState<TilePoint | null>(null);

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

  // Built here rather than in PreviewCanvas so hover and selection read the
  // same index; the canvas no longer describes tiles at all (tileInfo.ts).
  const objectsByTile = useMemo(
    () => indexObjectsByTile(result?.objects ?? [], result?.dim ?? 0),
    [result?.objects, result?.dim],
  );
  const marksByTile = useMemo(
    () => indexMarksByTile(result?.failureMarks ?? [], result?.dim ?? 0),
    [result?.failureMarks, result?.dim],
  );

  // The tile whose details are on screen. Selection wins over hover for as
  // long as it is set: the whole point of clicking is to keep a tile's details
  // still while you move the pointer somewhere else.
  //
  // Guarded against a dim change (a re-roll at a different map size, or
  // override_map_size) leaving the selection off the new grid — reading past
  // the end of a typed array yields undefined, which would render as "terrain
  // undefined" rather than throwing.
  const shown = selectedTile ?? hovered;
  const tile = useMemo(() => {
    if (snapshot === undefined || shown === null) return null;
    if (shown.x < 0 || shown.y < 0 || shown.x >= snapshot.dim || shown.y >= snapshot.dim) return null;
    return describeTile(snapshot, palette, objectsByTile, marksByTile, shown.x, shown.y);
  }, [snapshot, palette, objectsByTile, marksByTile, shown]);

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
        {view === "current" && <PinControl />}
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
        selected={selectedTile}
        onTileClick={toggleSelectedTile}
        hiddenObjects={hiddenObjects}
      />

      <div className={styles.readout}>
        {tile === null ? (
          <span className={styles.readoutHint}>
            {dim}×{dim} · click a tile to pin it · drag to pan · wheel to zoom · double-click to fit
          </span>
        ) : (
          <>
            <div className={styles.readoutHeader}>
              <span className={selectedTile !== null ? styles.readoutPinned : styles.readoutHint}>
                {selectedTile !== null ? "Selected tile" : "Hovered tile"}
              </span>
              {selectedTile !== null && (
                <HelpTip id="preview.clearSelection">
                  <button type="button" className={styles.clearSelection} onClick={clearSelectedTile}>
                    Clear
                  </button>
                </HelpTip>
              )}
            </div>
            <TileReadout tile={tile} />
          </>
        )}
      </div>

      <PreviewNotes result={result} palette={palette} terrainsInUse={terrainsInUse} />
    </div>
  );
}
