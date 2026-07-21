import type { OrphanBlockNode, RawNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { diagnosticsWithin } from "../diagnosticsForSpan";
import { BlockList } from "../BlockList";
import { HelpTip } from "../../components/HelpTip";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./RawCard.module.css";

interface RawCardProps {
  node: RawNode | OrphanBlockNode;
  kindLabel: string;
}

// docs/breakdown-design.md §3.7 — the universal read-only fallback:
// anything the structured UI can't represent renders verbatim, with the
// parser's own diagnostic and an "Edit in Code tab" affordance. Raw
// cards are the only cards with no Breakdown-side editing, by design —
// this holds for both v1 (no patch engine yet) and v1.x (these regions
// stay Code-tab-only even once 3.3/3.4 ship, §1 non-goals).
export function RawCard({ node, kindLabel }: RawCardProps) {
  const { source, diagnostics, applyEdit } = useBreakdownContext();
  const text = source.slice(node.span.start, node.span.end);
  const nodeDiagnostics = diagnosticsWithin(diagnostics, node.span);
  const worstSeverity = nodeDiagnostics[0]?.severity;

  // §3.3's did-you-mean quick-fix, wired to the patch engine in 3.4
  // (§4.1's `applySuggestion` intent — the common typo path and the whole
  // reason did-you-mean exists). Targets the RawNode's *first* token,
  // per §4.1's pinned rev-4 shape.
  const suggestion = nodeDiagnostics.find((d) => d.suggestion)?.suggestion;
  const rawNode = node.kind === "raw" ? node : undefined;

  return (
    <div className={cardStyles.card}>
      <div className={styles.header}>
        <HelpTip id="breakdown.rawCard.why">
          <span className={styles.kindLabel}>{kindLabel} — shown as code</span>
        </HelpTip>
        {worstSeverity && <ProblemBadge severity={worstSeverity} />}
      </div>
      <pre className={styles.code}>{text}</pre>
      {nodeDiagnostics.map((d, i) => (
        <p key={i} className={styles.diagnosticMessage}>
          {d.code}: {d.message}
        </p>
      ))}
      {suggestion && (
        <p className={styles.suggestion}>
          Suggested fix: <code>{suggestion}</code>{" "}
          {rawNode && (
            <HelpTip id="breakdown.rawCard.fix">
              <button
                type="button"
                className={styles.fixButton}
                onClick={() =>
                  applyEdit({
                    kind: "applySuggestion",
                    node: rawNode,
                    tokenIndex: rawNode.firstToken,
                    replacement: suggestion,
                  })
                }
              >
                Fix
              </button>
            </HelpTip>
          )}
        </p>
      )}
      <HelpTip id="breakdown.rawCard.editInCode">
        <button type="button" className={cardStyles.stubButton} title="Switch to the Code tab (wiring arrives with 3.4)" disabled>
          Edit in Code tab
        </button>
      </HelpTip>
      {node.kind === "orphanBlock" && (
        <div className={styles.orphanContents}>
          <p className={styles.orphanNote}>Contents (read-only, shared-block idiom):</p>
          <BlockList items={node.block.items} />
        </div>
      )}
    </div>
  );
}
