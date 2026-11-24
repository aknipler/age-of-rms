import { useState } from "react";
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
    <div className={styles.panel}>
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
                      <span className={styles.callName}>Other work</span>
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
