import { useState } from "react";
import type { IfNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { BlockList } from "../BlockList";
import { ValueEditor } from "./ValueEditor";
import { CommandPicker } from "../CommandPicker";
import { HelpTip } from "../../components/HelpTip";
import cardStyles from "./cards.module.css";
import styles from "./ConditionalCard.module.css";

// docs/breakdown-design.md §3.5 — fully editable per Ash's Q1 decision.
// Condition fields commit via setCondition (§4.4's optional-condition
// handling — an absent condition on if/elseif inserts after the
// keyword rather than replacing a nonexistent span); branch add/remove
// use §4.10; per-branch add-command opens the same CommandPicker as
// SectionView, anchored `in: "branch"`.
export function ConditionalCard({ node }: { node: IfNode }) {
  const { tokens, applyEdit, requestFocus } = useBreakdownContext();
  const [pickerBranch, setPickerBranch] = useState<number | null>(null);
  const hasElse = node.branches.some((b) => tokens[b.keyword].text === "else");

  return (
    <div className={cardStyles.card}>
      <div className={styles.title}>
        <HelpTip id="breakdown.conditionalCard">
          <span>Conditional (if / elseif / else)</span>
        </HelpTip>
        {node.endif === undefined && <span className={cardStyles.unknownBadge}>unclosed — finish in Code tab</span>}
        <HelpTip id="breakdown.conditionalCard.delete">
          <button
            type="button"
            className={cardStyles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              applyEdit({ kind: "removeNode", node });
            }}
            title="Delete this whole conditional"
          >
            trash
          </button>
        </HelpTip>
      </div>
      {node.branches.map((branch, i) => {
        const isElse = tokens[branch.keyword].text === "else";
        const conditionText = branch.condition !== undefined ? tokens[branch.condition].text : "";
        const anchor = branch.condition !== undefined ? tokens[branch.condition].start : tokens[branch.keyword].end;
        return (
          <div key={i} className={styles.branch}>
            <div className={styles.branchHeader}>
              <span className={styles.branchKeyword}>{tokens[branch.keyword].text}</span>
              {!isElse && (
                <ValueEditor
                  text={conditionText}
                  type="otherConstant"
                  anchorOffset={anchor}
                  helpId="breakdown.conditionalCard.condition"
                  onCommit={(value, restoreFocus) => {
                    if (typeof value !== "string") return;
                    const result = applyEdit({ kind: "setCondition", branch: { parent: node, index: i }, value });
                    if (result && restoreFocus) requestFocus(result.caret);
                  }}
                />
              )}
              {node.branches.length > 1 && (
                <HelpTip id="breakdown.conditionalCard.removeBranch">
                  <button
                    type="button"
                    className={cardStyles.deleteButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      applyEdit({ kind: "removeBranch", branch: { parent: node, index: i } });
                    }}
                    title="Remove this branch"
                  >
                    −
                  </button>
                </HelpTip>
              )}
            </div>
            <div className={styles.branchBody}>
              <BlockList items={branch.items} />
            </div>
            <div className={styles.addWrapper}>
              <HelpTip id="breakdown.conditionalCard.addCommand">
                <button
                  type="button"
                  className={styles.addCommandButton}
                  onClick={() => setPickerBranch(pickerBranch === i ? null : i)}
                >
                  + add command
                </button>
              </HelpTip>
              {pickerBranch === i && (
                <CommandPicker
                  onClose={() => setPickerBranch(null)}
                  onPick={(name) => {
                    const result = applyEdit({
                      kind: "addCommand",
                      at: { in: "branch", branch: { parent: node, index: i } },
                      name,
                    });
                    setPickerBranch(null);
                    if (result) requestFocus(result.caret);
                  }}
                />
              )}
            </div>
          </div>
        );
      })}
      <HelpTip id="breakdown.conditionalCard.branchControls">
        <div className={styles.branchControls}>
          <button
            type="button"
            className={styles.branchControlButton}
            onClick={() => applyEdit({ kind: "addBranch", parent: node, branch: "elseif" })}
          >
            + elseif
          </button>
          <button
            type="button"
            className={styles.branchControlButton}
            disabled={hasElse}
            onClick={() => applyEdit({ kind: "addBranch", parent: node, branch: "else" })}
          >
            + else
          </button>
        </div>
      </HelpTip>
    </div>
  );
}
