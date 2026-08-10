import { useMemo, useState } from "react";
import { useBreakdownContext } from "./BreakdownContext";
import { HelpTip } from "../components/HelpTip";
import styles from "./CommandPicker.module.css";

interface CommandPickerProps {
  /** The tab's section name (canonical or unknown-section raw name) — filters the list by default, per Sec.3.2. */
  defaultSection?: string;
  onPick: (name: string) => void;
  onClose: () => void;
}

// docs/breakdown-design.md Sec.3.2 — a searchable list of every command,
// filtered to the active tab's section by default with a "show all
// sections" toggle. This is a pure convenience filter, never a hard
// restriction: cross-section placement draws a diagnostic for two commands and
// nothing for the other 39.
//
// The reason has now changed twice, and the filter has stayed advisory through
// both. RMS0304 shipped 2026-08-10, but it fires only where `sectionLocked` is
// set — two commands, `create_terrain` and `create_object`, the only two the
// engine has been measured on. `CommandDef.section`, which is what this filter
// reads, records where the guide *documents* a command, and 52 of the 53
// corpus hits a `section`-driven check produces are shipped, working maps. So
// the filter is a convenience over documentation and the diagnostic is a claim
// about the engine, and they are deliberately not the same set. Each entry
// shows name + one-line description + a verified/unverified chip.
export function CommandPicker({ defaultSection, onPick, onClose }: CommandPickerProps) {
  const { lang } = useBreakdownContext();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(!defaultSection);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lang.data.commands
      .filter((c) => showAll || c.section === defaultSection)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [lang, query, showAll, defaultSection]);

  return (
    <div className={styles.panel} role="dialog" aria-label="Add a command">
      <div className={styles.searchRow}>
        <HelpTip id="breakdown.addCommand.search">
          <input
            type="text"
            autoFocus
            placeholder="Search commands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className={styles.search}
          />
        </HelpTip>
        {defaultSection && (
          <HelpTip id="breakdown.addCommand.showAll">
            <label className={styles.toggle}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              show all sections
            </label>
          </HelpTip>
        )}
      </div>
      {/* One HelpTip over the whole list rather than one per entry —
          matches ReferenceTable.tsx's pattern (a wrap per row here would
          spam a tooltip over every visible result in a scrollable list). */}
      <HelpTip id="breakdown.addCommand.entry">
        <div className={styles.list}>
          {results.length === 0 && <p className={styles.empty}>No matching commands.</p>}
          {results.map((c) => (
            <button key={c.name} type="button" className={styles.entry} onClick={() => onPick(c.name)}>
              <span className={styles.entryName}>{c.name}</span>
              <span className={styles.entryDesc}>{c.description ?? ""}</span>
              <span className={styles.chip}>{c.verified ? "verified" : "unverified"}</span>
            </button>
          ))}
        </div>
      </HelpTip>
    </div>
  );
}
