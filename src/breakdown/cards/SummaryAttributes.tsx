import { useEffect, useRef, useState } from "react";
import type { AttributeNode, CommandNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { useBreakdownSettings } from "../../settings/BreakdownSettingsContext";
import { renderArgs } from "../renderValue";
import { HelpTip } from "../../components/HelpTip";
import { AttributeValueEditor } from "./AttributeRow";
import styles from "./SummaryAttributes.module.css";

/** How long a struck-through flag stays in the summary before it is dropped. */
export const GHOST_LIFETIME_MS = 30_000;

interface GhostFlag {
  name: string;
  expiresAt: number;
  /**
   * The name of the attribute that immediately followed this one in the
   * summary line at the moment it was struck (undefined if it was last).
   * Lets the ghost render back in roughly its old spot instead of always
   * being appended after every live entry — see the render-order comment
   * below for why that placement matters now that the line is uncapped.
   */
  beforeName: string | undefined;
}

interface SummaryAttributesProps {
  command: CommandNode;
  /** Every attribute of the block, in source order (CommandCard.tsx). */
  attrs: AttributeNode[];
}

// The attributes shown on a collapsed command card's summary line, each one
// clickable (beta feedback 2026-09-17). What a click does is the
// settings.breakdown.summaryClick choice.
//
// "open": expand the card and focus that attribute's editor. The focus
// request resolves once the body has rendered (BreakdownPane's focus
// effect runs on expansion changes as well as reparses for exactly this).
//
// "edit": edit in place. A value attribute swaps its text for the same
// ValueEditor the expanded row uses, committing through setArgValue. A
// flag attribute is removed from the code at once and stays on the line
// struck through for GHOST_LIFETIME_MS, and clicking the ghost puts it
// back. The code changes immediately rather than after the timer so the
// Code tab never disagrees with what is on screen, and the ghost is an
// undo affordance rather than a pending edit.
//
// Ghosts are local state. This component's instance survives a reparse
// because the card's key (its span.start) does not move when something
// inside its own block is removed, and if the card is re-keyed by an
// edit above it the ghosts simply vanish, which is the safe failure.
export function SummaryAttributes({ command, attrs }: SummaryAttributesProps) {
  const { tokens, applyEdit, expandCard, requestFocus } = useBreakdownContext();
  const { summaryClick } = useBreakdownSettings();
  const [editingAnchor, setEditingAnchor] = useState<number | null>(null);
  const [ghosts, setGhosts] = useState<GhostFlag[]>([]);
  // One timer per ghost, cleared on unmount. A ref rather than state:
  // timers are not something to render from.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
    };
  }, []);

  const target = command.block ?? command;

  const removeGhost = (name: string) => {
    const t = timersRef.current.get(name);
    if (t) clearTimeout(t);
    timersRef.current.delete(name);
    setGhosts((prev) => prev.filter((g) => g.name !== name));
  };

  const strikeFlag = (node: AttributeNode, name: string) => {
    const index = attrs.indexOf(node);
    const beforeName =
      index === -1 || index === attrs.length - 1
        ? undefined
        : tokens[attrs[index + 1].name].text;
    const result = applyEdit({ kind: "removeNode", node });
    if (!result) return;
    removeGhost(name);
    setGhosts((prev) => [
      ...prev,
      { name, expiresAt: Date.now() + GHOST_LIFETIME_MS, beforeName },
    ]);
    timersRef.current.set(
      name,
      setTimeout(() => removeGhost(name), GHOST_LIFETIME_MS),
    );
  };

  const restoreFlag = (name: string) => {
    removeGhost(name);
    applyEdit({ kind: "toggleFlag", target, name, on: true });
  };

  const openAt = (node: AttributeNode) => {
    expandCard(command.span);
    // A value attribute's editor registers under its first arg's span.start,
    // a bare one under the node's own span.end (the missing-argument
    // editor, AttributeRow). A flag has no editor, expanding is the whole
    // action.
    const defArgs = node.def?.arguments ?? [];
    if (node.args.length > 0) requestFocus(node.args[0].span.start);
    else if (defArgs.length > 0) requestFocus(node.span.end);
  };

  const renderLiveEntry = (node: AttributeNode) => {
    const name = tokens[node.name].text;
    const defArgs = node.def?.arguments ?? [];
    const isFlag = node.args.length === 0 && defArgs.length === 0;
    const label = `${name} ${renderArgs(node.args, tokens)}`.trim();
    const editing =
      summaryClick === "edit" &&
      !isFlag &&
      node.args.length > 0 &&
      editingAnchor === node.span.start;
    return (
      <span key={node.span.start} className={styles.entry}>
        <span className={styles.dot} aria-hidden="true">
          {" · "}
        </span>
        {editing ? (
          <span
            className={styles.inlineEditor}
            // Keep a click inside the editor from reaching the summary
            // entry below it (which would re-enter edit mode) or the
            // card's own toggle.
            onClick={(e) => e.stopPropagation()}
            onBlur={() => setEditingAnchor(null)}
          >
            {name}{" "}
            <AttributeValueEditor
              arg={node.args[0]}
              type={defArgs[0]?.type ?? "string"}
              helpId="breakdown.attributeRow.value"
            />
          </span>
        ) : (
          <HelpTip id="breakdown.commandCard.summaryAttribute">
            <button
              type="button"
              className={styles.attrButton}
              onClick={(e) => {
                e.stopPropagation();
                if (summaryClick === "open") {
                  openAt(node);
                } else if (isFlag) {
                  strikeFlag(node, name);
                } else if (node.args.length > 0) {
                  setEditingAnchor(node.span.start);
                } else {
                  // A bare attribute has nothing to edit in place yet,
                  // opening is the useful action.
                  openAt(node);
                }
              }}
            >
              {label}
            </button>
          </HelpTip>
        )}
      </span>
    );
  };

  const renderGhostEntry = (ghost: GhostFlag) => (
    <span key={`ghost-${ghost.name}`} className={styles.entry}>
      <span className={styles.dot} aria-hidden="true">
        {" · "}
      </span>
      <HelpTip id="breakdown.commandCard.summaryGhost">
        <button
          type="button"
          className={`${styles.attrButton} ${styles.ghost}`}
          onClick={(e) => {
            e.stopPropagation();
            restoreFlag(ghost.name);
          }}
        >
          {ghost.name}
        </button>
      </HelpTip>
    </span>
  );

  // Interleaved rather than "every live attr, then every ghost": the line
  // is uncapped now (every attribute renders, .summary's own overflow CSS
  // truncates it visually), so a command with enough attributes to fill
  // the row has no spare width past the last live entry. A ghost appended
  // there lands beyond the ellipsis cutoff and is invisible from the
  // first frame, not just once its 30s runs out. Reinserting it before
  // the same neighbor it sat beside when struck keeps it inside whatever
  // portion of the row was already visible (the user could see the
  // attribute they just clicked, so its old neighborhood was visible
  // too), falling back to the end only when that neighbor is gone too.
  //
  // Live entries whose name currently has a ghost are filtered out here
  // rather than left to `attrs` catching up on its own. `strikeFlag`
  // updates `ghosts` synchronously, but `attrs` only reflects the removal
  // once the reparse round-trip lands (a worker message, not free), so
  // without this filter the struck attribute briefly renders BOTH as its
  // normal live entry and as the new ghost — a duplicate that then
  // collapses to one the instant the reparse catches up, instead of the
  // clean live-to-struck-through transition this is supposed to be.
  const ghostNames = new Set(ghosts.map((g) => g.name));
  type Entry =
    { kind: "live"; node: AttributeNode } | { kind: "ghost"; ghost: GhostFlag };
  const entries: Entry[] = attrs
    .filter((node) => !ghostNames.has(tokens[node.name].text))
    .map((node) => ({ kind: "live", node }));
  for (const ghost of ghosts) {
    const insertAt = ghost.beforeName
      ? entries.findIndex(
          (e) =>
            e.kind === "live" && tokens[e.node.name].text === ghost.beforeName,
        )
      : -1;
    entries.splice(insertAt === -1 ? entries.length : insertAt, 0, {
      kind: "ghost",
      ghost,
    });
  }

  return (
    <>
      {entries.map((entry) =>
        entry.kind === "ghost"
          ? renderGhostEntry(entry.ghost)
          : renderLiveEntry(entry.node),
      )}
    </>
  );
}
