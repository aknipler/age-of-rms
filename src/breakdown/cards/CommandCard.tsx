import type { ArgNode, CommandNode, Diagnostic } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { buildCommandBreakdown } from "../attributeModel";
import { renderArgs } from "../renderValue";
import { diagnosticsWithin, maxSeverityWithin } from "../diagnosticsForSpan";
import { argumentHelpText } from "../helpText";
import { HelpTip } from "../../components/HelpTip";
import { DiagnosticPopup, useDiagnosticHover } from "../../components/DiagnosticTooltip";
import { AttributeRow, AttributeValueEditor } from "./AttributeRow";
import { OtherContentsRow } from "./OtherContentsRow";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./CommandCard.module.css";

// Split out from CommandCard's args.map() specifically so
// useDiagnosticHover (a real hook) has a real per-item component
// instance to attach to — calling a hook once per loop iteration inside
// an inline .map() callback breaks React's hook-call-order guarantee the
// moment the argument count changes (adding/removing a positional arg),
// which does happen here via AttributeValueEditor's commits.
function ArgRow({
  arg,
  argDef,
  argLabel,
  commandName,
  diagnostics,
}: {
  arg: ArgNode;
  argDef: Parameters<typeof argumentHelpText>[0];
  argLabel: string;
  commandName: string;
  diagnostics: readonly Diagnostic[];
}) {
  // Same per-field highlighting AttributeInstanceRow gets — a positional
  // argument's own diagnostic (e.g. an out-of-range value) previously
  // only showed as the card-header ProblemBadge, indistinguishable from
  // a problem on a totally different argument or attribute.
  const argSeverity = maxSeverityWithin(diagnostics, arg.span);
  const argMessage = argSeverity
    ? diagnosticsWithin(diagnostics, arg.span).map((d) => d.message).join("\n")
    : undefined;
  // Custom-positioned popup instead of a native `title` — see
  // DiagnosticTooltip.tsx: a browser tooltip can't be repositioned, so it
  // was free to land on top of a HelpTip popup opened by the argument
  // label/value editor nested in this same row (Ash's report).
  const diagHover = useDiagnosticHover();

  return (
    <div
      className={`${styles.argRow} ${argSeverity ? styles[`rowSeverity-${argSeverity}`] : ""}`}
      {...(argSeverity ? diagHover.handlers : {})}
    >
      {argSeverity && diagHover.hovering && (
        <DiagnosticPopup message={argMessage!} severity={argSeverity} side={diagHover.side} />
      )}
      {/* .argLabelSlot (not .argLabel) is the fixed-width column — see
          AttributeRow.module.css's .labelSlot comment for why this can't
          live on .argLabel itself (it's nested inside HelpTip, which is
          the actual flex item once help mode is on). */}
      <span className={styles.argLabelSlot}>
        <HelpTip id="breakdown.commandCard.argumentName" text={argumentHelpText(argDef, commandName)}>
          <span className={styles.argLabel}>{argLabel}</span>
        </HelpTip>
      </span>
      <AttributeValueEditor arg={arg} type={argDef?.type ?? "string"} helpId="breakdown.commandCard.argument" />
    </div>
  );
}

interface CommandCardProps {
  command: CommandNode;
}

// docs/breakdown-design.md §3.3 — the workhorse card. Collapsed/expanded
// with the all-attributes model in the expanded body. Wired to the patch
// engine as of 3.4: delete, positional-arg edits, and (via AttributeRow)
// attribute set/add/delete/toggle all construct real EditIntents.
// Expansion is anchored to the command's span.start (§6.3) via context
// rather than local state, so it survives a reparse triggered by an edit
// elsewhere in the document.
export function CommandCard({ command }: CommandCardProps) {
  const { tokens, lang, diagnostics, applyEdit, isExpanded, toggleExpanded } = useBreakdownContext();
  const expanded = isExpanded(command.span);
  const name = tokens[command.name].text;
  const severity = maxSeverityWithin(diagnostics, command.span);
  const known = command.def !== undefined;
  // §3.3's unknown-name boundary has two cases with a did-you-mean
  // Diagnostic.suggestion: a bare RawNode (RawCard's Fix button, wired in
  // 3.4) and this one — a def-less CommandNode via the word+`{` upgrade.
  // Both got the same suggestion field from unknownName(), but only
  // RawCard's fix path got wired originally; this closes that gap.
  const suggestion = !known ? diagnosticsWithin(diagnostics, command.span).find((d) => d.suggestion)?.suggestion : undefined;

  const posArgsText = renderArgs(command.args, tokens);
  let preview = "";
  if (command.block) {
    const attrs = command.block.items.filter((i) => i.kind === "attribute").slice(0, 3);
    preview = attrs
      .map((a) => `${tokens[a.name].text} ${renderArgs(a.args, tokens)}`.trim())
      .join(" · ");
  }

  // known-but-block-less (a block-kind command written bare, e.g.
  // `create_terrain FOREST` with no `{ }` at all) still gets the full
  // all-attributes list, every slot absent — buildCommandBreakdown
  // handles `command.block === undefined` internally. This is what makes
  // the §4.6 brace-synthesis path reachable: clicking "add" on an absent
  // slot targets the CommandNode itself (attributeTarget below) and
  // computeEdit synthesizes the `{ }`.
  const breakdown = known ? buildCommandBreakdown(command, lang) : null;
  // Def-less commands still render positional args + any block contents
  // generically (Other contents), preserving total coverage (§3.3's
  // unknown-name boundary: this path is ONLY reached for a block-attached
  // unknown command, i.e. word immediately followed by `{` — a bare
  // unknown name never becomes a def-less CommandNode, it's a RawNode,
  // see cardKind.ts/ItemCard.tsx).
  const genericOtherContents = !known && command.block ? command.block.items : [];
  // §4.6 brace synthesis: addAttribute needs a BlockNode when the command
  // has one, else the CommandNode itself (computeEdit synthesizes `{ }`).
  const attributeTarget = command.block ?? command;

  return (
    <div className={cardStyles.card}>
      <div className={styles.header}>
        <HelpTip id="breakdown.commandCard.expand">
          <button
            type="button"
            className={styles.toggle}
            onClick={() => toggleExpanded(command.span)}
            aria-expanded={expanded}
          >
            {expanded ? "−" : "+"}
          </button>
        </HelpTip>
        <HelpTip id="breakdown.commandCard.summary">
          <span className={styles.summary}>
            {name}
            {posArgsText ? ` ${posArgsText}` : ""}
            {preview ? ` · ${preview}` : ""}
            {!known && <span className={cardStyles.unknownBadge}>unknown name</span>}
          </span>
        </HelpTip>
        {suggestion && (
          <HelpTip id="breakdown.commandCard.fix">
            <button
              type="button"
              className={cardStyles.fixButton}
              onClick={() =>
                applyEdit({ kind: "applySuggestion", node: command, tokenIndex: command.name, replacement: suggestion })
              }
              title={`Replace with "${suggestion}"`}
            >
              Fix: {suggestion}
            </button>
          </HelpTip>
        )}
        {severity && <ProblemBadge severity={severity} />}
        <HelpTip id="breakdown.commandCard.delete">
          <button
            type="button"
            className={cardStyles.deleteButton}
            onClick={(e) => {
              // Deleting a card must never change selection by itself — only
              // deleting the card that IS currently selected should clear it
              // (via the existing anchor-drop rule). Without stopPropagation
              // this click bubbles to ItemCard's wrapper, which would select
              // THIS card an instant before removing it — stealing selection
              // away from whatever else was actually selected.
              e.stopPropagation();
              applyEdit({ kind: "removeNode", node: command });
            }}
            title="Delete"
          >
            trash
          </button>
        </HelpTip>
      </div>

      {expanded && (
        <div className={styles.body}>
          {command.args.length > 0 && (
            <section className={styles.group}>
              <h4 className={styles.groupTitle}>Arguments</h4>
              {command.args.map((arg, i) => (
                <ArgRow
                  key={arg.span.start}
                  arg={arg}
                  argDef={command.def?.arguments?.[i]}
                  argLabel={command.def?.arguments?.[i]?.name ?? `arg ${i + 1}`}
                  commandName={name}
                  diagnostics={diagnostics}
                />
              ))}
            </section>
          )}

          {breakdown && breakdown.knownSlots.length > 0 && (
            <section className={styles.group}>
              <h4 className={styles.groupTitle}>Attributes</h4>
              {breakdown.knownSlots.map((slot) => (
                <AttributeRow key={slot.name} slot={slot} target={attributeTarget} />
              ))}
            </section>
          )}

          {breakdown && breakdown.otherContents.length > 0 && (
            <section className={styles.group}>
              <h4 className={styles.groupTitle}>Other contents</h4>
              {breakdown.otherContents.map((item) => (
                <OtherContentsRow key={item.span.start} item={item} />
              ))}
            </section>
          )}

          {genericOtherContents.length > 0 && (
            <section className={styles.group}>
              <h4 className={styles.groupTitle}>Block contents (unknown command — generic)</h4>
              {genericOtherContents.map((item) => (
                <OtherContentsRow key={item.span.start} item={item} />
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
