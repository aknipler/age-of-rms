import type { DirectiveNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { maxSeverityWithin } from "../diagnosticsForSpan";
import { HelpTip } from "../../components/HelpTip";
import { AttributeValueEditor } from "./AttributeRow";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./DirectiveCard.module.css";

// docs/breakdown-design.md §3.6. Includes the "has no effect in DE"
// badge for nonFunctional directives (#undefine/#include — flagged in
// language.json per §0.1 P2), and the string-overload distinction:
// #const/#define NAME are never quoted, #include_drs/#includeXS filename
// args re-emit their original quoting (§3.4's pinned
// DirectiveNode.hash -> IncludeInfo.directiveToken lookup) — both are
// handled uniformly by setArgValue/renderValue (computeEdit consults the
// same lookup), so this card doesn't special-case quoting itself.
export function DirectiveCard({ directive }: DirectiveCardProps) {
  const { tokens, diagnostics, applyEdit } = useBreakdownContext();
  const name = tokens[directive.hash].text;
  const severity = maxSeverityWithin(diagnostics, directive.span);
  const known = directive.def !== undefined;

  return (
    <div className={cardStyles.card}>
      <div className={styles.header}>
        {/* Only the static name gets its own HelpTip here — each arg's
            AttributeValueEditor (-> ValueEditor) already wraps its own
            input in a HelpTip with the same id, and nesting a second
            identical-id wrapper around it produced two overlapping
            popups on hover, same bug as AttributeRow's. */}
        <HelpTip id="breakdown.directiveCard">
          <span className={styles.name}>{name}</span>
        </HelpTip>{" "}
        {directive.args.map((a, i) => (
          <span key={a.span.start} className={styles.argValue}>
            <AttributeValueEditor
              arg={a}
              type={directive.def?.arguments?.[i]?.type ?? "string"}
              helpId="breakdown.directiveCard"
            />
          </span>
        ))}
        {directive.def?.nonFunctional && (
          <HelpTip id="breakdown.directiveCard.nonFunctional">
            <span className={styles.nonFunctionalBadge}>has no effect in DE</span>
          </HelpTip>
        )}
        {!known && <span className={cardStyles.unknownBadge}>unknown directive</span>}
        {severity && <ProblemBadge severity={severity} />}
        <HelpTip id="breakdown.directiveCard.delete">
          <button
            type="button"
            className={cardStyles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              applyEdit({ kind: "removeNode", node: directive });
            }}
            title="Delete"
          >
            trash
          </button>
        </HelpTip>
      </div>
    </div>
  );
}

interface DirectiveCardProps {
  directive: DirectiveNode;
}
