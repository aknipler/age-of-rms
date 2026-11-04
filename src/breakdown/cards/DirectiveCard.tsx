import type { DirectiveNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { diagnosticsWithin } from "../diagnosticsForSpan";
import { HelpTip } from "../../components/HelpTip";
import { TrashIcon } from "../../components/TrashIcon";
import { CommentOutButton } from "./CommentOutButton";
import { AttributeValueEditor } from "./AttributeRow";
import { ValueEditor } from "./ValueEditor";
import { namesSlotOf } from "../constReview";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./DirectiveCard.module.css";

/**
 * Ghost text for a directive's empty argument field. The type-derived hint for
 * a `#const` value, "a #const name", is wrong there: it takes a number or
 * another name. Other directives keep the type's own hint.
 */
function argHint(directive: string, index: number): string | undefined {
  if (directive === "#const" || directive === "#define")
    return index === 0 ? "a new name" : "a number, constant, rnd() or ( math )";
  return undefined;
}

// docs/breakdown-design.md Sec.3.6. Includes the "has no effect in DE"
// badge for nonFunctional directives (#undefine/#include, flagged in
// language.json per Sec.0.1 P2), and the string-overload distinction:
// #const/#define NAME are never quoted, #include_drs/#includeXS filename
// args re-emit their original quoting (Sec.3.4's pinned
// DirectiveNode.hash -> IncludeInfo.directiveToken lookup), both are
// handled uniformly by setArgValue/renderValue (computeEdit consults the
// same lookup), so this card doesn't special-case quoting itself.
export function DirectiveCard({ directive }: DirectiveCardProps) {
  const { tokens, diagnostics, applyEdit, noteCommit, requestFocus } =
    useBreakdownContext();
  const name = tokens[directive.hash].text;
  const cardDiagnostics = diagnosticsWithin(diagnostics, directive.span);
  const known = directive.def !== undefined;

  return (
    <div className={cardStyles.card} data-card>
      <div className={styles.header} data-card-header>
        {/* Only the static name gets its own HelpTip here, each arg's
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
              def={directive.def?.arguments?.[i]}
              helpId="breakdown.directiveCard"
              hint={argHint(name, i)}
              // Only the last argument may be cleared. Clearing an earlier
              // one deletes its token, so the one after it slides into its
              // place and the field is gone from the card.
              required={i < directive.args.length - 1}
            />
          </span>
        ))}
        {/* Every argument the source is missing gets an empty field, the same
            as an attribute row, so clearing the last one (or writing a bare
            `#const`) leaves a field to fill in. A commit appends at that
            index, with placeholders for any slot skipped before it. */}
        {(directive.def?.arguments ?? [])
          .slice(directive.args.length)
          .map((def, j) => (
            <span
              key={`missing-${directive.span.end + j}`}
              className={styles.argValue}
            >
              <ValueEditor
                text=""
                type={def.type}
                anchorOffset={directive.span.end + j}
                helpId="breakdown.directiveCard"
                hint={argHint(name, directive.args.length + j)}
                names={namesSlotOf(def)}
                onCommit={(value, restoreFocus) => {
                  if (value === "") return;
                  const result = applyEdit({
                    kind: "appendArg",
                    node: directive,
                    index: directive.args.length + j,
                    value,
                  });
                  if (result && typeof value === "string")
                    noteCommit?.(value, result.caret);
                  if (result && restoreFocus) requestFocus(result.caret);
                  return result;
                }}
              />
            </span>
          ))}
        {directive.def?.nonFunctional && (
          <HelpTip id="breakdown.directiveCard.nonFunctional">
            <span className={styles.nonFunctionalBadge}>
              has no effect in DE
            </span>
          </HelpTip>
        )}
        {!known && (
          <span className={cardStyles.unknownBadge}>unknown directive</span>
        )}
        {cardDiagnostics.length > 0 && (
          <ProblemBadge diagnostics={cardDiagnostics} />
        )}
        {/* Pinned to the right edge regardless of how little content
            precedes it, same reasoning as CommandCard.module.css's
            .deleteSlot: the HelpTip it wraps renders an inline-block
            wrapper with no flex properties of its own, so `flex`/`margin`
            set on THIS span (a direct child of .header) is what actually
            moves in the flex layout, not anything set inside HelpTip's
            children. */}
        <span className={styles.deleteSlot}>
          <CommentOutButton card={directive} />
          <HelpTip id="breakdown.directiveCard.delete">
            <button
              type="button"
              className={cardStyles.deleteButton}
              data-quiet
              onClick={(e) => {
                e.stopPropagation();
                applyEdit({ kind: "removeNode", node: directive });
              }}
              aria-label="Delete"
            >
              <TrashIcon />
            </button>
          </HelpTip>
        </span>
      </div>
    </div>
  );
}

interface DirectiveCardProps {
  directive: DirectiveNode;
}
