import type { AttributeNode, ArgNode } from "../../parser/types";
import type { ArgumentType } from "../../parser/language";
import type { AttributeSlot } from "../attributeModel";
import type { AttributeTarget } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { renderArg } from "../renderValue";
import { namedEntryHelpText } from "../helpText";
import { maxSeverityWithin, diagnosticsWithin } from "../diagnosticsForSpan";
import { ValueEditor } from "./ValueEditor";
import { HelpTip } from "../../components/HelpTip";
import { DiagnosticPopup, useDiagnosticHover } from "../../components/DiagnosticTooltip";
import styles from "./AttributeRow.module.css";

interface InstanceValueProps {
  arg: ArgNode;
  type: ArgumentType;
  helpId: string;
}

// docs/breakdown-design.md §3.4/§4.11 — set-value edits, commit on
// blur/Enter. Wired to the same-value-source-order intent regardless of
// whether this arg belongs to a listed attribute, an unlisted one (Other
// contents), or a positional command argument (reused by CommandCard).
export function AttributeValueEditor({ arg, type, helpId }: InstanceValueProps) {
  const { tokens, applyEdit, requestFocus } = useBreakdownContext();
  const text = renderArg(arg, tokens);
  const isExpr = typeof arg.value === "object" && arg.value !== null && "expr" in arg.value;
  if (isExpr) {
    return (
      <span className={styles.constantPill} title="Math expression — edit in the Code tab">
        {text}
      </span>
    );
  }
  // §3.4's quoting round-trip: a quoted source token (only #include_drs/
  // #includeXS filename args are ever written this way) is allowed to
  // contain spaces — computeEdit re-quotes on write iff the original
  // token was quoted, so whitespace here is legal RMS, not unrenderable.
  const wasQuoted = tokens[arg.firstToken]?.text.startsWith('"') ?? false;
  return (
    <ValueEditor
      text={text}
      type={type}
      anchorOffset={arg.span.start}
      helpId={helpId}
      allowSpaces={wasQuoted}
      onCommit={(value, restoreFocus) => {
        const result = applyEdit({ kind: "setArgValue", arg, value });
        if (result && restoreFocus) requestFocus(result.caret);
      }}
    />
  );
}

/** Exported for OtherContentsRow.tsx — a known-but-unlisted attribute (§3.3(c)) renders as this same typed row, just with no repeatable/badge framing. */
export function AttributeInstanceRow({ node, helpId }: { node: AttributeNode; helpId: string }) {
  const { tokens, applyEdit, diagnostics } = useBreakdownContext();
  const name = tokens[node.name].text;
  const defArgs = node.def?.arguments ?? [];
  const isBareFlag = node.args.length === 0 && defArgs.length === 0;
  // Ash's follow-up ask: a diagnostic on this attribute previously only
  // showed up in the owning CommandCard's HEADER badge — easy to miss
  // which of several attributes it was actually about. Highlighting the
  // specific row too (same span-containment rule §5 already uses for the
  // header badge, just scoped to this one node instead of the whole
  // command) makes that immediate.
  const severity = maxSeverityWithin(diagnostics, node.span);
  const rowMessage = severity ? diagnosticsWithin(diagnostics, node.span).map((d) => d.message).join("\n") : undefined;
  // Custom-positioned popup instead of a native `title` — see
  // DiagnosticTooltip.tsx: a browser tooltip can't be repositioned, so it
  // was free to land on top of a HelpTip popup opened by something
  // nested in this same row (Ash's report). Always hoverable when a
  // severity exists (unlike HelpTip, not gated behind the help-mode
  // setting), just flips above/below to avoid colliding with one.
  const diagHover = useDiagnosticHover();

  // Note: no row-level HelpTip wrapper here — the value editor (below,
  // via AttributeValueEditor -> ValueEditor) already wraps its own input
  // in a HelpTip with this same id. Wrapping the whole row a second time
  // with the same id produced two overlapping popups on hover (one
  // obscuring the other) since both wrappers' mouse-enter fires together
  // for anything inside the value editor. The bare-flag checkbox has no
  // nested ValueEditor, so it gets its own explicit HelpTip instead.
  return (
    <div
      className={`${styles.row} ${severity ? styles[`rowSeverity-${severity}`] : ""}`}
      {...(severity ? diagHover.handlers : {})}
    >
      {severity && diagHover.hovering && (
        <DiagnosticPopup message={rowMessage!} severity={severity} side={diagHover.side} />
      )}
      {/* .labelSlot (not .label) carries the fixed column width — see its
          CSS comment. It's the actual flex item; HelpTip's own wrapper
          span goes inside it so the column width holds regardless of
          whether HelpTip renders a wrapper (help mode on) or a bare
          fragment (off). */}
      <span className={styles.labelSlot}>
        <HelpTip id="breakdown.attributeRow.name" text={namedEntryHelpText(name, node.def?.description)}>
          <span className={styles.label}>{name}</span>
        </HelpTip>
      </span>
      <span className={styles.values}>
        {isBareFlag ? (
          <HelpTip id={helpId}>
            <input
              type="checkbox"
              checked
              onChange={() => applyEdit({ kind: "removeNode", node })}
              // Unchecking removes this attribute — same "don't steal
              // selection" reasoning as the delete buttons below, applied to
              // click rather than change since that's what bubbles to
              // ItemCard's selection handler.
              onClick={(e) => e.stopPropagation()}
              className={styles.flagCheckbox}
            />
          </HelpTip>
        ) : (
          node.args.map((arg, i) => (
            <AttributeValueEditor
              key={arg.span.start}
              arg={arg}
              type={defArgs[i]?.type ?? "string"}
              helpId={helpId}
            />
          ))
        )}
      </span>
      <HelpTip id="breakdown.attributeRow.delete">
        <button
          type="button"
          className={styles.deleteButton}
          onClick={(e) => {
            // Same "deleting must not change selection" rule as CommandCard's
            // delete button — this row lives inside a CommandCard, and
            // removing one attribute instance shouldn't touch which card (or
            // which OTHER card) is selected.
            e.stopPropagation();
            applyEdit({ kind: "removeNode", node });
          }}
          title="Delete"
        >
          −
        </button>
      </HelpTip>
    </div>
  );
}

interface AttributeRowProps {
  slot: AttributeSlot;
  /** The command's block (or the bare command itself, for brace synthesis, §4.6) — needed to construct addAttribute/toggleFlag intents. */
  target: AttributeTarget;
}

/**
 * Renders one def.attributes[] slot per docs/breakdown-design.md §3.3's
 * all-attributes model:
 * - 0 instances: faint, byte-free add-affordance -> addAttribute/toggleFlag(on).
 * - 1 instance: filled row (value editor(s), or checkbox for a flag).
 * - 2+ instances: ALWAYS a list (the ground-truth rule), regardless of
 *   `def.repeatable` — presence in the source is ground truth, the flag
 *   only gates whether "add another" is offered.
 */
export function AttributeRow({ slot, target }: AttributeRowProps) {
  const { applyEdit, requestFocus } = useBreakdownContext();
  const helpKind = slot.isFlag ? "flag" : slot.instances.length > 1 ? "repeatable" : "value";
  const helpId = `breakdown.attributeRow.${helpKind}`;

  if (slot.instances.length === 0) {
    const firstArgDefault = slot.def.arguments?.[0]?.default;
    const addAbsent = () => {
      let result;
      if (slot.isFlag) {
        result = applyEdit({ kind: "toggleFlag", target, name: slot.name, on: true });
      } else {
        const value = firstArgDefault !== undefined ? [firstArgDefault] : undefined;
        result = applyEdit({ kind: "addAttribute", target, name: slot.name, value });
      }
      if (result) requestFocus(result.caret);
    };
    // Ash's report: attributes were merging multiple-per-line only while
    // Help Tips was on. Root cause — this used to wrap the WHOLE row
    // <div> in <HelpTip>. HelpTip's own wrapper (HelpTip.module.css's
    // .wrapper) is `display: inline-block`; with help mode on, that put
    // an inline-block box around this block-level row div, and .group
    // (this row's parent) has no `display` set at all — plain block
    // flow — so consecutive inline-block-wrapped rows behave like
    // inline content and pack onto the same line wherever they fit,
    // exactly like wrapping text. With help mode off, HelpTip returns a
    // bare fragment (see HelpTip.tsx), so the row rendered as an
    // ordinary block div again and this never showed up. Every OTHER
    // row in this file (AttributeInstanceRow) already avoids this by
    // only wrapping a piece INSIDE the row, never the row itself — this
    // was the one place that didn't follow that pattern.
    return (
      // Note: the "greyed out" look is applied per-element (.absentDim
      // below) rather than once via `opacity` on this row div. Opacity
      // on an ANCESTOR of HelpTip's popup dims the popup too — CSS
      // opacity can't be undone by a descendant's own opacity, since it
      // composites the whole subtree at reduced alpha. Scoping it to the
      // label TEXT span (a sibling of the popup inside HelpTip's own
      // wrapper, not an ancestor of it) keeps the popup fully opaque.
      <div className={styles.row}>
        <span className={styles.labelSlot}>
          <HelpTip id="breakdown.attributeRow.absent" text={namedEntryHelpText(slot.name, slot.def.description)}>
            <span className={`${styles.label} ${styles.absentDim}`}>{slot.name}</span>
          </HelpTip>
        </span>
        <span className={`${styles.absentValue} ${styles.absentDim}`}>
          {firstArgDefault !== undefined ? String(firstArgDefault) : "click to add"}
        </span>
        <button type="button" className={`${styles.addButton} ${styles.absentDim}`} onClick={addAbsent} title="Add">
          +
        </button>
      </div>
    );
  }

  const canAddAnother =
    slot.def.repeatable && (slot.def.maxRepeats === undefined || slot.instances.length < slot.def.maxRepeats);

  return (
    <div className={styles.slot}>
      {slot.instances.map((node) => (
        <AttributeInstanceRow key={node.span.start} node={node} helpId={helpId} />
      ))}
      {slot.instances.length > 1 && (
        <p className={styles.groundTruthNote}>
          {slot.instances.length} instances present in the source — each is edited/deleted independently
          {slot.def.repeatable ? "." : " (not flagged repeatable in reference data, but shown per source ground truth)."}
        </p>
      )}
      {canAddAnother && (
        <HelpTip id="breakdown.attributeRow.addAnother">
          <button
            type="button"
            className={styles.addAnotherButton}
            onClick={() => {
              const firstArgDefault = slot.def.arguments?.[0]?.default;
              const value = firstArgDefault !== undefined ? [firstArgDefault] : undefined;
              const result = applyEdit({ kind: "addAttribute", target, name: slot.name, value });
              if (result) requestFocus(result.caret);
            }}
          >
            + add another {slot.name}
          </button>
        </HelpTip>
      )}
    </div>
  );
}
