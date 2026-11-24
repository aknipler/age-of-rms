import type { PreviewWireResult } from "../../preview/generator/types";
import {
  COLOR_MODE_NOTES,
  cssColor,
  HASHED_COLOR_NOTE,
  type TerrainPalette,
} from "../../preview/render/palette";
import { HelpTip } from "../HelpTip";
import { InlineCode, renderProse } from "../InlineCode";
import styles from "./PreviewNotes.module.css";

/** Which box is open over the preview's bottom edge. At most one. */
export type PreviewPanelSection =
  "help" | "timing" | "objects" | "notes" | "legend";

/**
 * The counts the button row and the Notes box share. Computed once here so
 * the failure notice, the "Notes (n)" label and the box agree.
 *
 * Failures are coalesced per command per bucket (generator/placement.ts), so
 * the headline number has to sum `occurrences` rather than count records.
 * A script can genuinely produce a quarter of a million failed placements
 * from a handful of records, and reporting "6 placements failed" for it
 * would be worse than the pre-coalescing wall of text.
 */
/**
 * What identifies a note across edits. The key of a per-span note holds
 * character offsets, which move whenever anything above it is edited, so a
 * note with a snippet is identified by its sentence and snippet instead.
 */
export function noteId(note: PreviewWireResult["notes"][number]): string {
  return note.snippet !== undefined
    ? `${note.stage}|${note.text}|${note.snippet}`
    : note.key;
}

export function summarizePreviewResult(
  result: PreviewWireResult,
  isHidden: (noteId: string) => boolean = () => false,
) {
  const allDrawerNotes = result.notes.filter(
    (note) => note.prominence === "drawer",
  );
  const drawerNotes = allDrawerNotes.filter((note) => !isHidden(noteId(note)));
  const hiddenCount = allDrawerNotes.length - drawerNotes.length;
  const failureCount = result.reports.reduce(
    (total, report) =>
      total +
      report.failures.reduce((n, failure) => n + (failure.occurrences ?? 1), 0),
    0,
  );
  const attempted = result.reports.reduce(
    (total, report) => total + report.attempted,
    0,
  );
  const placed = result.reports.reduce(
    (total, report) => total + report.placed,
    0,
  );
  return { drawerNotes, hiddenCount, failureCount, attempted, placed };
}

export type PreviewSummary = ReturnType<typeof summarizePreviewResult>;

interface PreviewBarControlsProps {
  summary: PreviewSummary;
  open: PreviewPanelSection | null;
  onToggle: (section: PreviewPanelSection) => void;
  /** How many objects the Obj. List has unticked, for the warning on its button. */
  hiddenObjectCount: number;
  /** The hourglass button is enabled (Preview Options, Time each generation). Off, it shows greyed out. */
  showTiming?: boolean;
}

/**
 * The preview's own buttons for the bottom row of the canvas: the placement
 * notice, then Obj. List, Notes and Legend. `OverlayCanvas` puts them
 * beside its zoom buttons (its `bottomControls` slot). The Help button that
 * opens the same box lives in the top right corner (`PreviewHelpButton`).
 *
 * The honesty surface: how many placements failed, what the preview did not
 * simulate, and what the colours mean. Sec.9 splits notes by `prominence`.
 * "banner" notes are lifted onto the canvas (OverlayCanvas draws those) and
 * the rest live in the Notes box with a count, so a script with twenty
 * caveats does not bury the map.
 */
export function PreviewBarControls({
  summary,
  open,
  onToggle,
  hiddenObjectCount,
  showTiming,
}: PreviewBarControlsProps) {
  const { drawerNotes, failureCount, placed } = summary;
  return (
    <>
      <HelpTip id="preview.failureCount">
        <span
          className={`${styles.notice} ${
            failureCount > 0 ? styles.failureBad : styles.failureOk
          }`}
        >
          {failureCount === 0
            ? `${placed} placed`
            : `${failureCount} placement${failureCount === 1 ? "" : "s"} failed`}
        </span>
      </HelpTip>
      <HelpTip id="preview.objectList">
        <button
          type="button"
          className={styles.barButton}
          aria-expanded={open === "objects"}
          onClick={() => onToggle("objects")}
        >
          Obj. List
          {/* Objects missing from the map is an effect that shows somewhere
              other than the control causing it, so the button says so even
              while its box is closed. */}
          {hiddenObjectCount > 0 && (
            <span
              className={styles.hiddenWarning}
              title="Some objects are hidden from the preview"
              aria-label="Some objects are hidden from the preview"
            >
              {" "}
              ⚠
            </span>
          )}
        </button>
      </HelpTip>
      {/* The hourglass: how long the last generation took, by section and
          command (PreviewTimingPanel). Greyed out, not removed, while timing
          is off in Preview Options, so the row keeps its shape and the
          feature stays findable. */}
      <HelpTip id="preview.timingButton">
        <button
          type="button"
          className={`${styles.barButton} ${styles.squareButton}`}
          aria-expanded={open === "timing"}
          aria-label="Generation time"
          disabled={!showTiming}
          onClick={() => onToggle("timing")}
        >
          ⌛
        </button>
      </HelpTip>
      <HelpTip id="preview.notesDrawer">
        <button
          type="button"
          className={styles.barButton}
          aria-expanded={open === "notes"}
          onClick={() => onToggle("notes")}
        >
          Notes ({drawerNotes.length})
        </button>
      </HelpTip>
      <HelpTip id="preview.legend">
        <button
          type="button"
          className={styles.barButton}
          aria-expanded={open === "legend"}
          onClick={() => onToggle("legend")}
        >
          Legend
        </button>
      </HelpTip>
    </>
  );
}

/**
 * The preview's own buttons for the top right corner of the canvas: Help,
 * then the generation settings cog (`OverlayCanvas`'s `topRightControls`
 * slot, after the map size chip and Export).
 *
 * The cog used to sit in the map panel's top row. It moved onto the map
 * because the player count and map size it sets are what the chip beside it
 * reports. It takes the same dark chip look as Export and the other bar
 * buttons, since it now sits on unthemed map colours.
 */
export function PreviewCornerControls({
  open,
  onToggle,
  settingsOpen,
  onToggleSettings,
}: {
  open: PreviewPanelSection | null;
  onToggle: (section: PreviewPanelSection) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}) {
  return (
    <>
      <HelpTip id="preview.helpButton">
        <button
          type="button"
          className={`${styles.barButton} ${styles.squareButton}`}
          aria-expanded={open === "help"}
          aria-label="How to use the map"
          onClick={() => onToggle("help")}
        >
          ?
        </button>
      </HelpTip>
      {/* Beta feedback: the status bar's settings cog was hard to find, and
          testers expected map size and player count controls in the preview
          itself, since that is what they change. */}
      <HelpTip id="preview.generationSettings">
        <button
          type="button"
          className={`${styles.barButton} ${styles.squareButton} ${styles.cogButton}`}
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
          aria-label="Generation settings"
        >
          ⚙
        </button>
      </HelpTip>
    </>
  );
}

interface PreviewPanelProps {
  /** Every section but the Obj. List and the hourglass, which PreviewCanvas renders itself. */
  section: Exclude<PreviewPanelSection, "objects" | "timing">;
  result: PreviewWireResult;
  summary: PreviewSummary;
  palette: TerrainPalette;
  /** Terrain ids actually present on the drawn grid, for the legend. */
  terrainsInUse: readonly number[];
  /** Hides one note for the current script. */
  onHideNote?: (noteId: string) => void;
  /** Brings back every hidden note of the current script. */
  onRestoreNotes?: () => void;
}

/**
 * The box that opens over the bottom of the map when Help, Notes or Legend is
 * clicked (`OverlayCanvas`'s `bottomPanel` slot). It sits on the map and
 * covers part of it, so the button that opened it is the way to close it.
 */
export function PreviewPanel({
  section,
  result,
  summary,
  palette,
  terrainsInUse,
  onHideNote,
  onRestoreNotes,
}: PreviewPanelProps) {
  const { drawerNotes, hiddenCount, failureCount, attempted } = summary;

  if (section === "help") {
    return (
      <p className={styles.helpLine}>
        Click a tile to pin · drag to pan · wheel to zoom · double-click to fit
      </p>
    );
  }

  if (section === "notes") {
    return (
      <ul className={styles.noteList}>
        {drawerNotes.map((note) => (
          <li key={note.key} className={styles.note}>
            <span className={styles.stage}>{note.stage}</span>
            {renderProse(note.text)}
            {note.snippet !== undefined && (
              <span className={styles.snippet}> {note.snippet}</span>
            )}
            {onHideNote && (
              <HelpTip id="preview.noteHide">
                <button
                  type="button"
                  className={styles.hideButton}
                  onClick={() => onHideNote(noteId(note))}
                >
                  Hide
                </button>
              </HelpTip>
            )}
          </li>
        ))}
        {hiddenCount > 0 && onRestoreNotes && (
          <li className={styles.note}>
            {hiddenCount} hidden.{" "}
            <button
              type="button"
              className={styles.hideButton}
              onClick={onRestoreNotes}
            >
              Show
            </button>
          </li>
        )}
        {result.reports
          .flatMap((report) => report.failures)
          .map((failure, index) => (
            <li key={`${failure.bucket}-${index}`} className={styles.note}>
              <span className={styles.bucket}>{failure.bucket}</span>
              {(failure.occurrences ?? 1) > 1 && (
                <span className={styles.occurrences}>
                  ×{failure.occurrences}
                </span>
              )}
              {renderProse(failure.detail)}
            </li>
          ))}
        {drawerNotes.length === 0 && failureCount === 0 && (
          <li className={styles.note}>
            Nothing flagged. {attempted} placements attempted.
          </li>
        )}
      </ul>
    );
  }

  return (
    <>
      {/*
        Shown only when there is at least one on the map. A key entry for a
        glyph that is not on screen teaches the reader to look for
        something that is not there.
      */}
      {result.failureMarks.length > 0 && (
        <p className={styles.legendNote}>
          A red ▲ marks a land the engine could not place where the script
          asked, so it sits at the map centre instead. Hover the marker for the
          detail. Lands that merely grew smaller than they asked for carry no
          marker. That is the usual outcome of{" "}
          <InlineCode>land_percent</InlineCode>, and the map is showing their
          real size.
        </p>
      )}
      <p className={styles.legendNote}>
        {renderProse(COLOR_MODE_NOTES[palette.mode])}
      </p>
      <ul className={styles.legend}>
        {terrainsInUse.map((id) => {
          const source = palette.sourceFor(id);
          return (
            <li key={id} className={styles.legendRow}>
              <span
                className={styles.swatch}
                style={{ background: cssColor(palette.colorFor(id)) }}
                aria-hidden="true"
              />
              {palette.nameFor(id) ?? `terrain ${id}`}
              {/*
                Marked only when the colour did NOT come from the selected
                mode. Labelling every row would be noise; labelling none is
                how an arbitrary colour passes for a real one.
              */}
              {source !== palette.mode && (
                <span className={styles.legendSource}>
                  {source === "hashed" || source === "unknown"
                    ? "no colour in data"
                    : `${source} colour`}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {terrainsInUse.some((id) => {
        const source = palette.sourceFor(id);
        return source === "hashed" || source === "unknown";
      }) && <p className={styles.legendNote}>{HASHED_COLOR_NOTE}</p>}
    </>
  );
}
