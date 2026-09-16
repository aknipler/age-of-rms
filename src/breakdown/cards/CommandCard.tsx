import { useEffect, useRef, useState } from "react";
import type { ArgNode, CommandNode, Diagnostic } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { useBreakdownSettings } from "../../settings/BreakdownSettingsContext";
import {
  buildCommandBreakdown,
  sortKnownSlots,
  splitAttributeColumns,
  type AttributeSlot,
} from "../attributeModel";
import type { AttributeTarget } from "../patch/intents";
import { renderArgs } from "../renderValue";
import { diagnosticsWithin, maxSeverityWithin } from "../diagnosticsForSpan";
import { argumentHelpText } from "../helpText";
import { HelpTip } from "../../components/HelpTip";
import {
  DiagnosticPopup,
  useDiagnosticHover,
} from "../../components/DiagnosticTooltip";
import { AttributeRow, AttributeValueEditor } from "./AttributeRow";
import { OtherContentsRow } from "./OtherContentsRow";
import { ProblemBadge } from "./ProblemBadge";
import cardStyles from "./cards.module.css";
import styles from "./CommandCard.module.css";

/**
 * One attribute slot plus its drag handle, shared by the flat single-column
 * layout and both columns of the compact two-column layout, so the three
 * only differ in which list they render and where a drop lands (see
 * CommandCard's renderAttributesBody).
 */
function AttributeSlotRow({
  slot,
  attributeTarget,
  draggable,
  onDragStart,
  onDrop,
}: {
  slot: AttributeSlot;
  attributeTarget: AttributeTarget;
  draggable: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={styles.attributeSlotWrap}
      draggable={draggable}
      onDragStart={(e) => {
        // WebView2 (like Firefox) shows the "no-drop" cursor for the whole
        // drag and never fires onDrop unless dataTransfer actually carries
        // something — an empty native drag reads as "nothing to drop".
        e.dataTransfer.setData("text/plain", slot.name);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragOver={(e) => {
        if (draggable) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      {draggable && (
        <HelpTip id="breakdown.commandCard.attributeDragHandle">
          <span
            className={styles.dragHandle}
            title="Drag to reorder"
            aria-hidden="true"
          >
            ⠿
          </span>
        </HelpTip>
      )}
      <AttributeRow slot={slot} target={attributeTarget} />
    </div>
  );
}

// Split out from CommandCard's args.map() specifically so
// useDiagnosticHover (a real hook) has a real per-item component
// instance to attach to. Calling a hook once per loop iteration inside
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
  // Same per-field highlighting AttributeInstanceRow gets, a positional
  // argument's own diagnostic (e.g. an out-of-range value) previously
  // only showed as the card-header ProblemBadge, indistinguishable from
  // a problem on a totally different argument or attribute.
  const argSeverity = maxSeverityWithin(diagnostics, arg.span);
  const argMessage = argSeverity
    ? diagnosticsWithin(diagnostics, arg.span)
        .map((d) => d.message)
        .join("\n")
    : undefined;
  // Custom-positioned popup instead of a native `title`, see
  // DiagnosticTooltip.tsx: a browser tooltip can't be repositioned, so it
  // was free to land on top of a HelpTip popup opened by the argument
  // label/value editor nested in this same row.
  const diagHover = useDiagnosticHover();

  return (
    <div
      className={`${styles.argRow} ${argSeverity ? styles[`rowSeverity-${argSeverity}`] : ""}`}
      {...(argSeverity ? diagHover.handlers : {})}
    >
      {argSeverity && diagHover.hovering && (
        <DiagnosticPopup
          message={argMessage!}
          severity={argSeverity}
          side={diagHover.side}
        />
      )}
      {/* .argLabelSlot (not .argLabel) is the fixed-width column, see
          AttributeRow.module.css's .labelSlot comment for why this can't
          live on .argLabel itself (it's nested inside HelpTip, which is
          the actual flex item once help mode is on). */}
      <span className={styles.argLabelSlot}>
        <HelpTip
          id="breakdown.commandCard.argumentName"
          text={argumentHelpText(argDef, commandName)}
        >
          <span className={styles.argLabel}>{argLabel}</span>
        </HelpTip>
      </span>
      <AttributeValueEditor
        arg={arg}
        type={argDef?.type ?? "string"}
        helpId="breakdown.commandCard.argument"
      />
    </div>
  );
}

interface CommandCardProps {
  command: CommandNode;
}

// docs/breakdown-design.md Sec.3.3, the workhorse card. Collapsed/expanded
// with the all-attributes model in the expanded body. Wired to the patch
// engine as of 3.4: delete, positional-arg edits, and (via AttributeRow)
// attribute set/add/delete/toggle all construct real EditIntents.
// Expansion is anchored to the command's span.start (Sec.6.3) via context
// rather than local state, so it survives a reparse triggered by an edit
// elsewhere in the document.
export function CommandCard({ command }: CommandCardProps) {
  const { tokens, lang, diagnostics, applyEdit, isExpanded, toggleExpanded } =
    useBreakdownContext();
  const {
    attributeOrderMode,
    customAttributeOrder,
    setCustomAttributeOrderFor,
    density,
  } = useBreakdownSettings();
  const expanded = isExpanded(command.span);
  const name = tokens[command.name].text;
  const severity = maxSeverityWithin(diagnostics, command.span);
  const known = command.def !== undefined;
  // Sec.3.3's unknown-name boundary has two cases with a did-you-mean
  // Diagnostic.suggestion: a bare RawNode (RawCard's Fix button, wired in
  // 3.4) and this one, a def-less CommandNode via the word+`{` upgrade.
  // Both got the same suggestion field from unknownName(), but only
  // RawCard's fix path got wired originally; this closes that gap.
  const suggestion = !known
    ? diagnosticsWithin(diagnostics, command.span).find((d) => d.suggestion)
        ?.suggestion
    : undefined;

  const posArgsText = renderArgs(command.args, tokens);
  let preview = "";
  if (command.block) {
    const attrs = command.block.items
      .filter((i) => i.kind === "attribute")
      .slice(0, 3);
    preview = attrs
      .map((a) => `${tokens[a.name].text} ${renderArgs(a.args, tokens)}`.trim())
      .join(" · ");
  }

  // known-but-block-less (a block-kind command written bare, e.g.
  // `create_terrain FOREST` with no `{ }` at all) still gets the full
  // all-attributes list, every slot absent. buildCommandBreakdown
  // handles `command.block === undefined` internally. This is what makes
  // the Sec.4.6 brace-synthesis path reachable: clicking "add" on an absent
  // slot targets the CommandNode itself (attributeTarget below) and
  // computeEdit synthesizes the `{ }`.
  const breakdown = known ? buildCommandBreakdown(command, lang) : null;
  // Def-less commands still render positional args + any block contents
  // generically (Other contents), preserving total coverage (Sec.3.3's
  // unknown-name boundary: this path is ONLY reached for a block-attached
  // unknown command, i.e. word immediately followed by `{`, a bare
  // unknown name never becomes a def-less CommandNode, it's a RawNode,
  // see cardKind.ts/ItemCard.tsx).
  const genericOtherContents =
    !known && command.block ? command.block.items : [];
  // Sec.4.6 brace synthesis: addAttribute needs a BlockNode when the command
  // has one, else the CommandNode itself (computeEdit synthesizes `{ }`).
  const attributeTarget = command.block ?? command;

  // The Breakdown attribute-order setting (settings.breakdown.attributeOrder):
  // knownSlots is built alphabetically by buildCommandBreakdown, this is
  // where the chosen mode actually reorders it for display.
  const persistedCustomOrder = customAttributeOrder[name];
  const orderedSlots = breakdown
    ? sortKnownSlots(
        breakdown.knownSlots,
        attributeOrderMode,
        persistedCustomOrder?.order,
      )
    : [];

  // A live drag (custom mode only) is kept as a local list of NAMES rather
  // than mutating orderedSlots directly, so "Set as default" has an exact
  // value to persist and a plain re-render (no drag in progress) always
  // reflects the settings/data rather than stale local state. draftOrder is
  // the flat top-to-bottom order regardless of layout; draftRightColumn is
  // only meaningful in the compact two-column layout (settings.breakdown
  // .attributeOrder's density setting), where a drag is free to move a slot
  // into either column, not just reorder it in place — see
  // renderAttributesBody below. Both cleared whenever the effective order
  // changes out from under them: switching commands, changing the global
  // mode, or another card/session saving a new default for this same
  // command name.
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [draftRightColumn, setDraftRightColumn] = useState<string[] | null>(
    null,
  );
  useEffect(() => {
    setDraftOrder(null);
    setDraftRightColumn(null);
  }, [command.span.start, attributeOrderMode, persistedCustomOrder]);

  const displayedSlots = (() => {
    if (!draftOrder) return orderedSlots;
    const byName = new Map(orderedSlots.map((s) => [s.name, s] as const));
    const matched = draftOrder
      .map((n) => byName.get(n))
      .filter((s): s is AttributeSlot => s !== undefined);
    const matchedNames = new Set(matched.map((s) => s.name));
    return [
      ...matched,
      ...orderedSlots.filter((s) => !matchedNames.has(s.name)),
    ];
  })();

  // The compact density's two-column layout (settings.breakdown
  // .attributeOrder's sibling density setting): booleans on the right,
  // everything else on the left, by default. Only "custom" mode ever lets a
  // drag move a slot to the OTHER column (draftRightColumn, falling back to
  // whatever's already saved); every other mode always uses the plain
  // isFlag split, since there's no drag to override it with there.
  const compactColumns =
    density === "compact"
      ? splitAttributeColumns(
          displayedSlots,
          attributeOrderMode === "custom"
            ? (draftRightColumn ?? persistedCustomOrder?.rightColumn)
            : undefined,
        )
      : null;

  // Refs rather than state: which row a drag started from doesn't need to
  // trigger a render on its own, only the drop does. Separate from the
  // two-column one below since a flat-layout drag index and a
  // column-scoped one aren't comparable.
  const dragFromFlat = useRef<number | null>(null);
  const dragFromColumn = useRef<{
    col: "left" | "right";
    index: number;
  } | null>(null);

  function renderAttributesBody() {
    if (compactColumns) {
      const { left, right } = compactColumns;

      // A column move updates both pieces of custom-order state together:
      // draftOrder (so the flat/single-column view and sortKnownSlots' own
      // customOrder stay coherent) and draftRightColumn (so the OTHER
      // column's membership reflects the move too). Anchoring the insertion
      // to the target's NEIGHBOR NAME rather than a raw array index is what
      // makes this correct regardless of which column the drag started in.
      const handleColumnDrop = (toCol: "left" | "right", toIndex: number) => {
        const from = dragFromColumn.current;
        dragFromColumn.current = null;
        if (!from) return;
        const draggedSlot = (from.col === "left" ? left : right)[from.index];
        if (!draggedSlot) return;
        if (from.col === toCol && from.index === toIndex) return;

        const withoutDragged = displayedSlots
          .map((s) => s.name)
          .filter((n) => n !== draggedSlot.name);
        const neighborName = (toCol === "left" ? left : right)[toIndex]?.name;
        const newOrder =
          neighborName && neighborName !== draggedSlot.name
            ? (() => {
                const pos = withoutDragged.indexOf(neighborName);
                return [
                  ...withoutDragged.slice(0, pos),
                  draggedSlot.name,
                  ...withoutDragged.slice(pos),
                ];
              })()
            : [...withoutDragged, draggedSlot.name];

        const nextRightNames = new Set(right.map((s) => s.name));
        if (toCol === "right") nextRightNames.add(draggedSlot.name);
        else nextRightNames.delete(draggedSlot.name);

        setDraftOrder(newOrder);
        setDraftRightColumn([...nextRightNames]);
      };

      return (
        <div className={styles.attributesColumns}>
          <div className={styles.columnsRow}>
            <div className={styles.column}>
              {left.map((slot, index) => (
                <AttributeSlotRow
                  key={slot.name}
                  slot={slot}
                  attributeTarget={attributeTarget}
                  draggable={attributeOrderMode === "custom"}
                  onDragStart={() => {
                    dragFromColumn.current = { col: "left", index };
                  }}
                  onDrop={() => handleColumnDrop("left", index)}
                />
              ))}
            </div>
            <div className={styles.column}>
              {right.map((slot, index) => (
                <AttributeSlotRow
                  key={slot.name}
                  slot={slot}
                  attributeTarget={attributeTarget}
                  draggable={attributeOrderMode === "custom"}
                  onDragStart={() => {
                    dragFromColumn.current = { col: "right", index };
                  }}
                  onDrop={() => handleColumnDrop("right", index)}
                />
              ))}
            </div>
          </div>
        </div>
      );
    }

    return (
      <>
        {displayedSlots.map((slot, index) => (
          <AttributeSlotRow
            key={slot.name}
            slot={slot}
            attributeTarget={attributeTarget}
            draggable={attributeOrderMode === "custom"}
            onDragStart={() => {
              dragFromFlat.current = index;
            }}
            onDrop={() => {
              const from = dragFromFlat.current;
              dragFromFlat.current = null;
              if (from === null || from === index) return;
              const next = [...displayedSlots];
              const [moved] = next.splice(from, 1);
              next.splice(index, 0, moved);
              setDraftOrder(next.map((s) => s.name));
            }}
          />
        ))}
      </>
    );
  }

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
            {!known && (
              <span className={cardStyles.unknownBadge}>unknown name</span>
            )}
          </span>
        </HelpTip>
        {suggestion && (
          <HelpTip id="breakdown.commandCard.fix">
            <button
              type="button"
              className={cardStyles.fixButton}
              onClick={() =>
                applyEdit({
                  kind: "applySuggestion",
                  node: command,
                  tokenIndex: command.name,
                  replacement: suggestion,
                })
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
              // Deleting a card must never change selection by itself. Only
              // deleting the card that IS currently selected should clear it
              // (via the existing anchor-drop rule). Without stopPropagation
              // this click bubbles to ItemCard's wrapper, which would select
              // THIS card an instant before removing it, stealing selection
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
              <div className={styles.groupHeader}>
                <h4 className={styles.groupTitle}>Attributes</h4>
                {/* Always mounted rather than conditionally rendered, and
                    hidden with `visibility` instead of unmounted: a
                    mount/unmount round-trips through the browser's layout
                    pass and can land the row a subpixel off from its
                    steady-state height, which read as the header row
                    nudging everything below it on every drop. Visibility
                    keeps the box in the layout permanently, so the row's
                    height never changes. */}
                <span
                  style={{
                    visibility:
                      attributeOrderMode === "custom" && draftOrder
                        ? "visible"
                        : "hidden",
                  }}
                >
                  <HelpTip id="breakdown.commandCard.setAttributeOrderDefault">
                    <button
                      type="button"
                      className={styles.setDefaultButton}
                      tabIndex={
                        attributeOrderMode === "custom" && draftOrder ? 0 : -1
                      }
                      onClick={() => {
                        if (!draftOrder) return;
                        setCustomAttributeOrderFor(name, {
                          order: draftOrder,
                          rightColumn:
                            draftRightColumn ??
                            persistedCustomOrder?.rightColumn,
                        });
                        setDraftOrder(null);
                        setDraftRightColumn(null);
                      }}
                    >
                      Set as default
                    </button>
                  </HelpTip>
                </span>
              </div>
              {renderAttributesBody()}
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
              <h4 className={styles.groupTitle}>
                Block contents (unknown command — generic)
              </h4>
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
