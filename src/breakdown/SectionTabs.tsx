import type { Diagnostic, DiagnosticSeverity } from "../parser/types";
import type { SectionTab } from "./sectionTabsModel";
import { tabProblemSeverity } from "./sectionTabsModel";
import type { ClickMode } from "./multiSelect";
import { clickModeOf } from "./multiSelect";
import { HelpTip } from "../components/HelpTip";
import styles from "./SectionTabs.module.css";

// A filled glyph per severity, coloured by the matching theme token
// (SectionTabs.module.css), in place of the word the tab used to print. The
// shape differs as well as the colour, so the three read apart without
// relying on hue alone. `currentColor` lets the CSS class drive the fill, and
// role="img" with a label gives a screen reader the word the text used to.
const SEVERITY_GLYPH: Record<DiagnosticSeverity, string> = {
  // Triangle with an exclamation mark cut out.
  warning:
    "M12 2.5 1.5 21h21L12 2.5Zm-1.1 7h2.2v6h-2.2v-6Zm0 7.5h2.2v2.2h-2.2V17Z",
  // Disc with a cross cut out.
  error:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.3 12.7-1.6 1.6L12 13.6l-2.7 2.7-1.6-1.6L10.4 12 7.7 9.3l1.6-1.6L12 10.4l2.7-2.7 1.6 1.6L13.6 12l2.7 2.7Z",
  // Disc with an "i" cut out.
  info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1.1 15h-2.2v-6h2.2v6Zm0-8h-2.2V6.8h2.2V9Z",
};

function SeverityIcon({ severity }: { severity: DiagnosticSeverity }) {
  return (
    <svg
      className={`${styles.severityIcon} ${styles[`severity-${severity}`]}`}
      viewBox="0 0 24 24"
      role="img"
      aria-label={severity}
    >
      <path
        d={SEVERITY_GLYPH[severity]}
        fill="currentColor"
        fillRule="evenodd"
      />
    </svg>
  );
}

// ui-help.json ids must match ^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$
// (see reference/schemas/ui-help.schema.json), no underscores, but
// section names (PLAYER_SETUP, etc.) are SCREAMING_SNAKE_CASE, so map
// each dot-segment to camelCase for the help id.
function toCamelCase(snake: string): string {
  return snake
    .toLowerCase()
    .split("_")
    .map((word, i) =>
      i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
}

interface SectionTabsProps {
  tabs: SectionTab[];
  /** The in-focus section, the one Add writes to. */
  activeId: string;
  /** `mode` is Ctrl or Cmd ("toggle", add to the shown set) or Shift ("range", show the run from the focus tab). */
  onSelect: (id: string, mode?: ClickMode) => void;
  diagnostics: Diagnostic[];
  /** The tabs whose sections are on screen (viewScope.ts). */
  shownIds: readonly string[];
  onToggleShown: (id: string) => void;
  /** Show every tab, or back to only the in-focus one when all are shown. */
  onShowAll: () => void;
}

// docs/breakdown-design.md Sec.3.1, Header (always, even empty) + the 7
// canonical sections (data-driven order/labels from sectionLabels.ts) +
// any unknown sections (RMS0100), each with a count badge and a problem
// badge computed by diagnostic-span containment over the tab's (possibly
// disjoint, for aggregated duplicate sections) ranges.
//
// Since 2026-10-21 each tab also carries a checkbox in its top right corner
// saying whether its section is in the stacked view (Sec.3.1.1). A tab whose
// box is clear has a faded name. The box sits beside the tab button rather
// than inside it, since a checkbox inside a button is invalid markup and
// would hand every click on the box to the button as well.
export function SectionTabs({
  tabs,
  activeId,
  onSelect,
  diagnostics,
  shownIds,
  onToggleShown,
  onShowAll,
}: SectionTabsProps) {
  const allShown =
    tabs.length > 0 && tabs.every((t) => shownIds.includes(t.id));
  return (
    <div
      className={styles.tabBar}
      role="tablist"
      data-tutorial-anchor="breakdown.sectionTabs"
    >
      {tabs.map((tab) => {
        const severity = tabProblemSeverity(tab, diagnostics);
        const helpId =
          tab.id === "header"
            ? "breakdown.tab.header"
            : !tab.known
              ? "breakdown.tab.unknown"
              : `breakdown.tab.${toCamelCase(tab.id)}`;
        const shown = shownIds.includes(tab.id);
        return (
          <span key={tab.id} className={styles.tabSlot}>
            <HelpTip id={helpId}>
              <button
                type="button"
                role="tab"
                aria-selected={activeId === tab.id}
                className={`${styles.tab} ${activeId === tab.id ? styles.tabActive : ""} ${shown ? "" : styles.tabHidden}`}
                onClick={(e) => onSelect(tab.id, clickModeOf(e))}
              >
                {/* Numbered tabs (0. Header, 1. Player Setup, 2. Land, ...)
                  are ABSOLUTE, tied to each tab's fixed canonical identity
                  (SectionTab.number, from SECTION_NUMBERS), not its render
                  position. A missing section still renders an empty tab in
                  its own canonical slot (buildSectionTabs always pushes all
                  seven), so e.g. a missing Elevation section does not shift
                  Cliff/Terrain/Connection/Objects's numbers down by one. */}
                <span>
                  {tab.number}. {tab.label}
                </span>
                <span className={styles.countBadge}>{tab.items.length}</span>
                {!tab.known && (
                  <span
                    className={styles.warnBadge}
                    title="Unknown section name (RMS0100)"
                  >
                    ?
                  </span>
                )}
                {severity && <SeverityIcon severity={severity} />}
              </button>
            </HelpTip>
            <span className={styles.showSlot}>
              <HelpTip id="breakdown.tab.show">
                <input
                  type="checkbox"
                  className={styles.showBox}
                  checked={shown}
                  // The last shown section stays shown (viewScope.ts).
                  disabled={shown && shownIds.length === 1}
                  aria-label={`Show ${tab.label}`}
                  onChange={() => onToggleShown(tab.id)}
                />
              </HelpTip>
            </span>
          </span>
        );
      })}
      <HelpTip id="breakdown.tab.showAll">
        <button type="button" className={styles.showAll} onClick={onShowAll}>
          {allShown ? "Show one" : "Show all"}
        </button>
      </HelpTip>
    </div>
  );
}
