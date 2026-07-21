import { useState } from "react";
import type { RandomNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { BlockList } from "../BlockList";
import { ValueEditor } from "./ValueEditor";
import { CommandPicker } from "../CommandPicker";
import { renderArg } from "../renderValue";
import { HelpTip } from "../../components/HelpTip";
import cardStyles from "./cards.module.css";
import styles from "./ConditionalCard.module.css";

// docs/breakdown-design.md §3.5 — same shape as ConditionalCard, one
// segment per percent_chance branch, wired to the patch engine (setChance,
// addBranch "percent_chance", removeBranch, addCommand `in: "branch"`).
export function RandomCard({ node }: { node: RandomNode }) {
  const { tokens, applyEdit, requestFocus } = useBreakdownContext();
  const [pickerBranch, setPickerBranch] = useState<number | null>(null);

  return (
    <div className={cardStyles.card}>
      <div className={styles.title}>
        <HelpTip id="breakdown.randomCard">
          <span>Random (start_random / percent_chance)</span>
        </HelpTip>
        {node.end === undefined && <span className={cardStyles.unknownBadge}>unclosed — finish in Code tab</span>}
        <HelpTip id="breakdown.randomCard.delete">
          <button
            type="button"
            className={cardStyles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              applyEdit({ kind: "removeNode", node });
            }}
            title="Delete this whole random block"
          >
            trash
          </button>
        </HelpTip>
      </div>
      {node.preamble.length > 0 && (
        <div className={styles.branch}>
          <p className={styles.preambleNote}>Before first percent_chance (RMS0106):</p>
          <BlockList items={node.preamble} />
        </div>
      )}
      {node.branches.map((branch, i) => {
        const chanceText = branch.chance !== undefined ? renderArg(branch.chance, tokens) : "";
        const anchor = branch.chance !== undefined ? branch.chance.span.start : tokens[branch.chanceKeyword].end;
        const isExprChance =
          branch.chance !== undefined && typeof branch.chance.value === "object" && branch.chance.value !== null && "expr" in branch.chance.value;
        return (
          <div key={i} className={styles.branch}>
            <div className={styles.branchHeader}>
              <span className={styles.branchKeyword}>percent_chance</span>
              {isExprChance ? (
                <span title="Math expression — edit in the Code tab">{chanceText}</span>
              ) : (
                <ValueEditor
                  text={chanceText}
                  type="integer"
                  anchorOffset={anchor}
                  helpId="breakdown.randomCard.chance"
                  onCommit={(value, restoreFocus) => {
                    const result = applyEdit({ kind: "setChance", branch: { parent: node, index: i }, value });
                    if (result && restoreFocus) requestFocus(result.caret);
                  }}
                />
              )}
              {node.branches.length > 1 && (
                <HelpTip id="breakdown.randomCard.removeBranch">
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
              <HelpTip id="breakdown.randomCard.addCommand">
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
      <HelpTip id="breakdown.randomCard.branchControls">
        <div className={styles.branchControls}>
          <button
            type="button"
            className={styles.branchControlButton}
            onClick={() => applyEdit({ kind: "addBranch", parent: node, branch: "percent_chance" })}
          >
            + percent_chance
          </button>
        </div>
      </HelpTip>
    </div>
  );
}
