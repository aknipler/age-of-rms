import type { Diagnostic } from "../parser/types";
import type { SectionTab } from "./sectionTabsModel";
import { tabProblemSeverity } from "./sectionTabsModel";
import { HelpTip } from "../components/HelpTip";
import cardStyles from "./cards/cards.module.css";
import styles from "./SectionTabs.module.css";

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
  onSelect: (id: string) => void;
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
                onClick={() => onSelect(tab.id)}
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
                {severity && (
                  <span
                    className={`${cardStyles.problemBadge} ${cardStyles[`severity-${severity}`]}`}
                  >
                    {severity}
                  </span>
                )}
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
