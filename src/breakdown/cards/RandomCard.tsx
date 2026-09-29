import { useState } from "react";
import type { RandomNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { BlockList } from "../BlockList";
import { ValueEditor } from "./ValueEditor";
import { CommandPicker, intentForPick } from "../CommandPicker";
import { renderArg } from "../renderValue";
import { HelpTip } from "../../components/HelpTip";
import { TrashIcon } from "../../components/TrashIcon";
import { ProblemBadge } from "./ProblemBadge";
import { diagnosticsWithin } from "../diagnosticsForSpan";
import cardStyles from "./cards.module.css";
import styles from "./ConditionalCard.module.css";

// docs/breakdown-design.md Sec.3.5, same shape as ConditionalCard, one
// segment per percent_chance branch, wired to the patch engine (setChance,
// addBranch "percent_chance", removeBranch, addCommand `in: "branch"`).
export function RandomCard({ node }: { node: RandomNode }) {
  const { tokens, diagnostics, applyEdit, requestFocus } =
    useBreakdownContext();
  const [pickerBranch, setPickerBranch] = useState<number | null>(null);
  // Same gap as ConditionalCard.tsx: this card never wired up the Sec.5
  // span-containment badge, so a diagnostic on a start_random block had
  // nowhere to surface in Breakdown (beta feedback 2026-09-18).
  const cardDiagnostics = diagnosticsWithin(diagnostics, node.span);

  return (
    <div className={cardStyles.card}>
      <div className={styles.title}>
        <HelpTip id="breakdown.randomCard">
          <span>Random (start_random / percent_chance)</span>
        </HelpTip>
        {node.end === undefined && (
          <span className={cardStyles.unknownBadge}>
            unclosed — finish in Code tab
          </span>
        )}
        {/* .trailingSlot (ConditionalCard.module.css): one margin-left:
            auto on the group, so the badge sits flush against the delete
            button instead of drifting apart from it. */}
        <span className={styles.trailingSlot}>
          {cardDiagnostics.length > 0 && (
            <ProblemBadge diagnostics={cardDiagnostics} />
          )}
          <HelpTip id="breakdown.randomCard.delete">
            <button
              type="button"
              className={cardStyles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                applyEdit({ kind: "removeNode", node });
              }}
              aria-label="Delete this whole random block"
            >
              <TrashIcon />
            </button>
          </HelpTip>
        </span>
      </div>
      {node.preamble.length > 0 && (
        <div className={styles.branch}>
          <p className={styles.preambleNote}>
            Before first percent_chance (RMS0106):
          </p>
          <BlockList
            items={node.preamble}
            trailingBoundary={
              node.branches[0]
                ? tokens[node.branches[0].chanceKeyword].start
                : node.end !== undefined
                  ? tokens[node.end].start
                  : undefined
            }
          />
        </div>
      )}
      {node.branches.map((branch, i) => {
        const chanceText =
          branch.chance !== undefined ? renderArg(branch.chance, tokens) : "";
        const anchor =
          branch.chance !== undefined
            ? branch.chance.span.start
            : tokens[branch.chanceKeyword].end;
        // Sec.3.4's 2026-09-18 amendment, the same whole-expression raw-text
        // edit AttributeRow's value editor does. A chance that parsed to a
        // math expression used to render as a read-only pill, which also
        // contradicted Sec.3.5's own description of this field as editable
        // (number, rnd or expression). "string" keeps the typed text opaque
        // instead of running it through Number(), and allowSpaces lets an
        // expression keep the spaces around its operators.
        const isExprChance =
          branch.chance !== undefined &&
          typeof branch.chance.value === "object" &&
          branch.chance.value !== null &&
          "expr" in branch.chance.value;
        return (
          <div key={i} className={styles.branch}>
            <div className={styles.branchHeader}>
              <span className={styles.branchKeyword}>percent_chance</span>
              <ValueEditor
                text={chanceText}
                type={isExprChance ? "string" : "integer"}
                anchorOffset={anchor}
                helpId="breakdown.randomCard.chance"
                // A freshly added branch starts with no chance token at all
                // (computeEdit's addBranch/addControlFlow), not 0. RMS0308's
                // zeroFirst warning is why. A literal percent_chance 0 on
                // the first branch is an engine bug, not a valid "off"
                // value. This example-value hint fills the resulting gap,
                // the same idea as ValueEditor's own constant-type hints.
                hint="e.g. 50"
                allowSpaces={isExprChance}
                onCommit={(value, restoreFocus) => {
                  const result = applyEdit({
                    kind: "setChance",
                    branch: { parent: node, index: i },
                    value,
                  });
                  if (result && restoreFocus) requestFocus(result.caret);
                }}
              />
              {node.branches.length > 1 && (
                <HelpTip id="breakdown.randomCard.removeBranch">
                  <button
                    type="button"
                    className={cardStyles.deleteButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      applyEdit({
                        kind: "removeBranch",
                        branch: { parent: node, index: i },
                      });
                    }}
                    aria-label="Remove this branch"
                  >
                    −
                  </button>
                </HelpTip>
              )}
            </div>
            <div className={styles.branchBody}>
              <BlockList
                items={branch.items}
                trailingBoundary={
                  node.branches[i + 1]
                    ? tokens[node.branches[i + 1].chanceKeyword].start
                    : node.end !== undefined
                      ? tokens[node.end].start
                      : undefined
                }
                emptyTarget={{
                  in: "branch",
                  branch: { parent: node, index: i },
                }}
              />
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
                  onPick={(choice) => {
                    const result = applyEdit(
                      intentForPick(choice, {
                        in: "branch",
                        branch: { parent: node, index: i },
                      }),
                    );
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
            onClick={() =>
              applyEdit({
                kind: "addBranch",
                parent: node,
                branch: "percent_chance",
              })
            }
          >
            + percent_chance
          </button>
        </div>
      </HelpTip>
    </div>
  );
}
