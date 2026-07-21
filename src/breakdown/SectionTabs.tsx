import type { Diagnostic } from "../parser/types";
import type { SectionTab } from "./sectionTabsModel";
import { tabProblemSeverity } from "./sectionTabsModel";
import { HelpTip } from "../components/HelpTip";
import cardStyles from "./cards/cards.module.css";
import styles from "./SectionTabs.module.css";

// ui-help.json ids must match ^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)*$
// (see reference/schemas/ui-help.schema.json) — no underscores — but
// section names (PLAYER_SETUP, etc.) are SCREAMING_SNAKE_CASE, so map
// each dot-segment to camelCase for the help id.
function toCamelCase(snake: string): string {
  return snake
    .toLowerCase()
    .split("_")
    .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}

interface SectionTabsProps {
  tabs: SectionTab[];
  activeId: string;
  onSelect: (id: string) => void;
  diagnostics: Diagnostic[];
}

// docs/breakdown-design.md §3.1 — Header (if preamble non-empty) + the 7
// canonical sections (data-driven order/labels from sectionLabels.ts) +
// any unknown sections (RMS0100), each with a count badge and a problem
// badge computed by diagnostic-span containment over the tab's (possibly
// disjoint, for aggregated duplicate sections) ranges.
export function SectionTabs({ tabs, activeId, onSelect, diagnostics }: SectionTabsProps) {
  return (
    <div className={styles.tabBar} role="tablist">
      {tabs.map((tab) => {
        const severity = tabProblemSeverity(tab, diagnostics);
        const helpId =
          tab.id === "header"
            ? "breakdown.tab.header"
            : !tab.known
              ? "breakdown.tab.unknown"
              : `breakdown.tab.${toCamelCase(tab.id)}`;
        return (
          <HelpTip key={tab.id} id={helpId}>
            <button
              type="button"
              role="tab"
              aria-selected={activeId === tab.id}
              className={`${styles.tab} ${activeId === tab.id ? styles.tabActive : ""}`}
              onClick={() => onSelect(tab.id)}
            >
              {/* Ash's ask: numbered tabs (0. Header, 1. Player Setup, 2. Land, ...)
                  are ABSOLUTE — tied to each tab's fixed canonical identity
                  (SectionTab.number, from SECTION_NUMBERS), not its render
                  position. A missing section still renders an empty tab in
                  its own canonical slot (buildSectionTabs always pushes all
                  seven), so e.g. a missing Elevation section does not shift
                  Cliff/Terrain/Connection/Objects's numbers down by one. */}
              <span>
                {tab.number}. {tab.label}
              </span>
              <span className={styles.countBadge}>{tab.items.length}</span>
              {!tab.known && <span className={styles.warnBadge} title="Unknown section name (RMS0100)">?</span>}
              {severity && (
                <span className={`${cardStyles.problemBadge} ${cardStyles[`severity-${severity}`]}`}>
                  {severity}
                </span>
              )}
            </button>
          </HelpTip>
        );
      })}
    </div>
  );
}
