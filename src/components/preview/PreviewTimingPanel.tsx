import { useLayoutEffect, useRef, useState } from "react";
import type { GenerationTiming } from "../../preview/generator/generationTiming";
import { HelpTip } from "../HelpTip";
import styles from "./PreviewTimingPanel.module.css";

// The hourglass's box: how long the last generation took, per section, each
// section opening to its commands, slowest first (generationTiming.ts).

/** What each stage is called in the script, the names an author knows. */
const SECTION_NAMES: Record<string, string> = {
  S0: "Script and effects",
  S1: "Land",
  S2: "Elevation",
  S3: "Cliffs",
  S4: "Terrain",
  S5: "Connections",
  S6: "Objects",
};

/**
 * What a section's "Other work" row covers, the steps of the stage that no
 * timed row names (generatePreview in generator/index.ts). The larger steps
 * have rows of their own, such as the beach pass, so this lists the rest.
 */
const OTHER_WORK_NOTES: Record<string, string> = {
  S0: "object data, effects, terrain object setup",
  S1: "land outcome counts, base elevation notes",
  S2: "elevation setup and notes",
  S3: "stage handover",
  S4: "terrain setup, terrain objects updated",
  S5: "connection setup, terrain objects updated, beach layers cleared",
  S6: "painted terrain view, auto tree scan, object setup",
};

/** Under 10 ms with a decimal, so a fast section does not read as 0. */
function formatMs(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 10000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Time under this share of a section is folded away, as noise. */
const OTHER_WORK_MIN_MS = 0.5;

export function PreviewTimingPanel({
  timing,
  measuredHidden,
}: {
  timing: GenerationTiming | undefined;
  /**
   * The window was hidden when the result came in. A hidden WebView2 window
   * ran about five times slower in an earlier measurement, so the times say
   * more about the window than the script.
   */
  measuredHidden: boolean;
}) {
  // Which sections are open. Local, since it means nothing once the box closes.
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  // The box's height, measured once with every section closed and then held,
  // so opening a section grows the list downward inside the box (with a
  // scroll bar when it runs out of room) instead of growing the box upward
  // from the button row and sliding the clicked row away from the pointer.
  // A layout effect, so the measured height is set before the browser
  // paints. A plain effect would show one frame at the unlocked height.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [lockedHeight, setLockedHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (lockedHeight === null && panelRef.current !== null)
      setLockedHeight(panelRef.current.offsetHeight);
  }, [lockedHeight, timing]);
  if (timing === undefined)
    return <p className={styles.empty}>No timing for this map yet.</p>;
  const toggle = (stage: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  // The widest section sets the bars' scale.
  const longest = Math.max(1, ...timing.sections.map((s) => s.ms));
  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={lockedHeight === null ? undefined : { height: lockedHeight }}
    >
      <div className={styles.total}>
        Generated in {formatMs(timing.totalMs)}
        {timing.parseMs !== undefined && (
          <span className={styles.parse}>
            {" "}
            · parsing{" "}
            {timing.parseMs === 0 ? "reused" : formatMs(timing.parseMs)}
          </span>
        )}
      </div>
      {measuredHidden && (
        <p className={styles.warning}>
          Measured while the window was hidden, which slows it several times
          over.
        </p>
      )}
      <ul className={styles.sections}>
        {timing.sections.map((section) => {
          const isOpen = open.has(section.stage);
          const accounted = section.calls.reduce((sum, c) => sum + c.ms, 0);
          const other = section.ms - accounted;
          return (
            <li key={section.stage}>
              <HelpTip id="preview.timingSection">
                <button
                  type="button"
                  className={styles.sectionRow}
                  aria-expanded={isOpen}
                  disabled={section.calls.length === 0}
                  onClick={() => toggle(section.stage)}
                >
                  <span className={styles.chevron} aria-hidden="true">
                    {section.calls.length === 0 ? "" : isOpen ? "▾" : "▸"}
                  </span>
                  <span className={styles.name}>
                    {SECTION_NAMES[section.stage] ?? section.stage}
                  </span>
                  <span className={styles.bar} aria-hidden="true">
                    <span
                      className={styles.barFill}
                      style={{ width: `${(section.ms / longest) * 100}%` }}
                    />
                  </span>
                  <span className={styles.ms}>{formatMs(section.ms)}</span>
                </button>
              </HelpTip>
              {isOpen && (
                <ul className={styles.calls}>
                  {section.calls.map((call) => (
                    <li
                      key={`${call.line ?? ""}\0${call.label}`}
                      className={styles.callRow}
                    >
                      <span className={styles.callName}>
                        {call.label}
                        {call.count > 1 && (
                          <span className={styles.count}> ×{call.count}</span>
                        )}
                      </span>
                      <span className={styles.line}>
                        {call.line !== undefined ? `line ${call.line}` : ""}
                      </span>
                      <span className={styles.ms}>{formatMs(call.ms)}</span>
                    </li>
                  ))}
                  {other >= OTHER_WORK_MIN_MS && (
                    <li className={`${styles.callRow} ${styles.other}`}>
                      <span className={styles.callName}>
                        Other work
                        {OTHER_WORK_NOTES[section.stage] !== undefined && (
                          <span className={styles.otherNote}>
                            {" "}
                            ({OTHER_WORK_NOTES[section.stage]})
                          </span>
                        )}
                      </span>
                      <span className={styles.line} />
                      <span className={styles.ms}>{formatMs(other)}</span>
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
