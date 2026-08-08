import { useState } from "react";
import type { PreviewResult } from "../../preview/generator/types";
import {
  COLOR_MODE_NOTES,
  cssColor,
  HASHED_COLOR_NOTE,
  type TerrainPalette,
} from "../../preview/render/palette";
import { HelpTip } from "../HelpTip";
import styles from "./PreviewNotes.module.css";

interface PreviewNotesProps {
  result: PreviewResult;
  palette: TerrainPalette;
  /** Terrain ids actually present on the drawn grid, for the legend. */
  terrainsInUse: readonly number[];
}

/**
 * The honesty surface: how many placements failed, what the preview did not
 * simulate, and what the colours mean.
 *
 * Sec.9 splits notes by `prominence` — "banner" notes are lifted onto the
 * canvas (PreviewCanvas draws those) and the rest live here in a drawer with
 * a count badge, so a script with twenty caveats does not bury the map.
 */
export function PreviewNotes({ result, palette, terrainsInUse }: PreviewNotesProps) {
  const [openSection, setOpenSection] = useState<"notes" | "legend" | null>(null);

  const drawerNotes = result.notes.filter((note) => note.prominence === "drawer");
  // Failures are coalesced per command per bucket (generator/placement.ts), so
  // the headline number has to sum `occurrences` rather than count records —
  // a script can genuinely produce a quarter of a million failed placements
  // from a handful of records, and reporting "6 placements failed" for it
  // would be worse than the pre-coalescing wall of text.
  const failureCount = result.reports.reduce(
    (total, report) => total + report.failures.reduce((n, failure) => n + (failure.occurrences ?? 1), 0),
    0,
  );
  const attempted = result.reports.reduce((total, report) => total + report.attempted, 0);
  const placed = result.reports.reduce((total, report) => total + report.placed, 0);

  const toggle = (section: "notes" | "legend") =>
    setOpenSection((current) => (current === section ? null : section));

  return (
    <div className={styles.notes}>
      <div className={styles.summaryRow}>
        <HelpTip id="preview.failureCount">
          <span className={failureCount > 0 ? styles.failureBad : styles.failureOk}>
            {failureCount === 0
              ? `${placed} placed`
              : `${failureCount} placement${failureCount === 1 ? "" : "s"} failed`}
          </span>
        </HelpTip>
        <HelpTip id="preview.notesDrawer">
          <button
            type="button"
            className={styles.drawerButton}
            aria-expanded={openSection === "notes"}
            onClick={() => toggle("notes")}
          >
            Notes ({drawerNotes.length})
          </button>
        </HelpTip>
        <HelpTip id="preview.legend">
          <button
            type="button"
            className={styles.drawerButton}
            aria-expanded={openSection === "legend"}
            onClick={() => toggle("legend")}
          >
            Legend
          </button>
        </HelpTip>
      </div>

      {openSection === "notes" && (
        <ul className={styles.noteList}>
          {drawerNotes.map((note) => (
            <li key={note.key} className={styles.note}>
              <span className={styles.stage}>{note.stage}</span>
              {note.text}
            </li>
          ))}
          {result.reports
            .flatMap((report) => report.failures)
            .map((failure, index) => (
              <li key={`${failure.bucket}-${index}`} className={styles.note}>
                <span className={styles.bucket}>{failure.bucket}</span>
                {(failure.occurrences ?? 1) > 1 && (
                  <span className={styles.occurrences}>×{failure.occurrences}</span>
                )}
                {failure.detail}
              </li>
            ))}
          {drawerNotes.length === 0 && failureCount === 0 && (
            <li className={styles.note}>Nothing flagged. {attempted} placements attempted.</li>
          )}
        </ul>
      )}

      {openSection === "legend" && (
        <>
          <p className={styles.legendNote}>{COLOR_MODE_NOTES[palette.mode]}</p>
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
                      {source === "hashed" || source === "unknown" ? "no colour in data" : `${source} colour`}
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
      )}
    </div>
  );
}
