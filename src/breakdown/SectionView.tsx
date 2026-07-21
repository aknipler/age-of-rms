import { useRef, useState } from "react";
import type { SectionTab } from "./sectionTabsModel";
import { BlockList } from "./BlockList";
import { CommandPicker } from "./CommandPicker";
import { DiagnosticsRuler } from "./DiagnosticsRuler";
import { useBreakdownContext } from "./BreakdownContext";
import { HelpTip } from "../components/HelpTip";
import styles from "./SectionView.module.css";

interface SectionViewProps {
  tab: SectionTab;
}

// docs/breakdown-design.md §3.2: an "Add" button opening a command
// picker (filtered to this tab's section by default), then the
// BlockList of the active section's items in source order.
//
// 3.4: the picker constructs a real `addCommand` intent, targeting the
// LAST concrete SectionNode this tab aggregates (§3.1's rule for
// duplicate same-type sections — "add-command defaults to the last
// section of that type"). The Header tab has no SectionNode at all
// (ScriptNode.preamble is a bare Item[]) — computeEdit's InsertTarget
// union has no variant for "the preamble", so add-command is disabled
// there until that gap is addressed (not scoped for 3.4 — flagged in the
// session report).
export function SectionView({ tab }: SectionViewProps) {
  const { applyEdit, requestFocus, selectedItem, clearSelection } = useBreakdownContext();
  const [pickerOpen, setPickerOpen] = useState(false);
  const targetSection = tab.sections[tab.sections.length - 1];
  // §3.10 — the diagnostics ruler measures/queries against this exact
  // scroll container (offsetTop of each top-level card's data-anchor
  // node, relative to this element's own scrollHeight).
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // §3.9 — Add Command resolves relative to the current selection when one
  // exists (insert right after the selected card), falling back to the
  // existing "append to this tab's last concrete section" default
  // otherwise. ItemCard.tsx stops click propagation on every card, so this
  // handler only ever fires for a genuine background click (the padding
  // around/between cards, not a card itself) — exactly the "click empty
  // space to deselect" behavior the spec calls for.
  const insertTarget = selectedItem ? { after: selectedItem } : targetSection ? { in: "section" as const, section: targetSection } : null;

  return (
    <div className={styles.outer}>
      <div className={styles.view} onClick={clearSelection} ref={scrollContainerRef}>
        <div className={styles.addWrapper}>
          {/* .addButtonSlot makes HelpTip's wrapper span a flex item with
              flex: 1 — see its CSS comment (SectionView.module.css) for
              why .addButton's own width: 100% needs that, rather than a
              width set directly on this slot. */}
          <span className={styles.addButtonSlot}>
            <HelpTip id="breakdown.addCommand">
            <button
              type="button"
              className={styles.addButton}
              disabled={!insertTarget}
              onClick={(e) => {
                e.stopPropagation();
                setPickerOpen((v) => !v);
              }}
              title={insertTarget ? "Add a command" : "Can't add commands to the Header tab yet"}
            >
              + Add command
            </button>
          </HelpTip>
          </span>
          {pickerOpen && insertTarget && (
            <CommandPicker
              defaultSection={tab.isCanonicalOrHeader ? tab.id : undefined}
              onClose={() => setPickerOpen(false)}
              onPick={(name) => {
                const result = applyEdit({ kind: "addCommand", at: insertTarget, name });
                setPickerOpen(false);
                if (result) requestFocus(result.caret);
              }}
            />
          )}
        </div>
        <div className={styles.content}>
          <BlockList items={tab.items} />
        </div>
      </div>
      <DiagnosticsRuler items={tab.items} containerRef={scrollContainerRef} />
    </div>
  );
}
