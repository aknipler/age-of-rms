import type { OrphanBlockNode, RawNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { diagnosticsWithin } from "../diagnosticsForSpan";
import { BlockList } from "../BlockList";
import { HelpTip } from "../../components/HelpTip";
import { TrashIcon } from "../../components/TrashIcon";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./RawCard.module.css";

interface RawCardProps {
  node: RawNode | OrphanBlockNode;
  kindLabel: string;
}

// docs/breakdown-design.md Sec.3.7, the universal read-only fallback:
// anything the structured UI can't represent renders verbatim, with the
// parser's own diagnostic and an "Edit in Code tab" affordance. Raw
// cards are the only cards with no Breakdown-side editing, by design.
// This holds for both v1 (no patch engine yet) and v1.x (these regions
// stay Code-tab-only even once 3.3/3.4 ship, Sec.1 non-goals).
export function RawCard({ node, kindLabel }: RawCardProps) {
  const {
    source,
    tokens,
    diagnostics,
    comments,
    applyEdit,
    editInCode,
    isExpanded,
    toggleExpanded,
  } = useBreakdownContext();
  const text = source.slice(node.span.start, node.span.end);
  const nodeDiagnostics = diagnosticsWithin(diagnostics, node.span);
  // Same anchor-by-span scheme as every other card (Sec.6.3), so a raw
  // region's collapse state survives a reparse the same way a command's
  // does, with the sense INVERTED from CommandCard's, same reasoning and
  // same shared expandedAnchors Set as CommentCard.tsx: open by default,
  // toggleExpanded(node.span) here means "explicitly closed".
  const expanded = !isExpanded(node.span);
  const firstLine = text
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();

  // Sec.3.3's did-you-mean quick-fix, wired to the patch engine in 3.4
  // (Sec.4.1's `applySuggestion` intent, the common typo path and the whole
  // reason did-you-mean exists). Targets the RawNode's *first* token,
  // per Sec.4.1's pinned rev-4 shape.
  const suggestion = nodeDiagnostics.find((d) => d.suggestion)?.suggestion;
  const rawNode = node.kind === "raw" ? node : undefined;
  // A block holding only a comment still has something to show.
  const hasContents =
    node.kind === "orphanBlock" &&
    (node.block.items.length > 0 ||
      comments.some(
        (c) => c.start >= node.span.start && c.end <= node.span.end,
      ));
  const unclosed =
    node.kind === "orphanBlock" && node.block.close === undefined;

  return (
    <div className={cardStyles.card}>
      <div className={styles.header}>
        <HelpTip id="breakdown.rawCard.toggle">
          <button
            type="button"
            className={styles.toggle}
            onClick={() => toggleExpanded(node.span)}
            aria-expanded={expanded}
          >
            {expanded ? "−" : "+"}
          </button>
        </HelpTip>
        <HelpTip id="breakdown.rawCard.why">
          <span className={styles.kindLabel}>{kindLabel} — shown as code</span>
        </HelpTip>
        {firstLine && <span className={styles.rawPreview}>{firstLine}</span>}
        {nodeDiagnostics.length > 0 && (
          <ProblemBadge diagnostics={nodeDiagnostics} />
        )}
        {/* Every card can be deleted. A raw node goes by its own span. A
            shared block goes as the whole `{ }` with the cards inside it, the
            same removal a command with a block gets. A block with no closing
            brace is the exception, since its span runs on over whatever
            follows it, so it waits until the brace is added in the Code tab
            (computeEdit refuses it too). */}
        <span className={styles.deleteSlot}>
          <HelpTip id="breakdown.rawCard.delete">
            <button
              type="button"
              className={cardStyles.deleteButton}
              disabled={node.kind === "orphanBlock" && unclosed}
              title={
                node.kind === "orphanBlock" && unclosed
                  ? "Close this block's { } in the Code tab first"
                  : undefined
              }
              onClick={(e) => {
                e.stopPropagation();
                applyEdit(
                  node.kind === "raw"
                    ? { kind: "removeRaw", span: node.span }
                    : { kind: "removeNode", node },
                );
              }}
              aria-label="Delete"
            >
              <TrashIcon />
            </button>
          </HelpTip>
        </span>
      </div>
      {expanded && (
        <>
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
            <button
              type="button"
              className={cardStyles.actionButton}
              onClick={(e) => {
                e.stopPropagation();
                editInCode(node.span);
              }}
            >
              Edit in Code tab
            </button>
          </HelpTip>
          {/* The block's own cards, when it has any. An empty block shows
              nothing, since a "nothing here yet" line under a card that is
              already shown as code only adds noise. */}
          {node.kind === "orphanBlock" && hasContents && (
            <div className={styles.orphanContents}>
              <BlockList
                items={node.block.items}
                trailingBoundary={
                  node.block.close !== undefined
                    ? tokens[node.block.close].start
                    : undefined
                }
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
