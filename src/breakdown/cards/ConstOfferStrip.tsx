import { useState } from "react";
import { HelpTip } from "../../components/HelpTip";
import { shiftSingleAnchor } from "../ephemeralAnchors";
import { editsOf } from "../patch/computeEdit";
import type { EditResult, InsertTarget } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import {
  commentOpenWarning,
  defaultMeaning,
  moveUpRefusal,
  type CommitReview,
} from "../constReview";
import styles from "./ConstOfferStrip.module.css";

// The strip under a value field that offers to create a missing #const or to
// move one up (docs/name-lookup-design.md Sec.7.2 and Sec.9.1).
//
// NOT A DIAGNOSTIC. It is neutral in colour, adds no badge and nothing to the
// problem count, and it goes away on the next edit. A name our data does not
// know proves nothing about the game (CLAUDE.md's positive resolver rule), so
// the strip offers and never accuses.
//
// Every control carries a HelpTip, per the project rule.

type StripReview = Extract<CommitReview, { kind: "offer" | "definedBelow" }>;

interface ConstOfferStripProps {
  review: StripReview;
  name: string;
  /** Offset of the committed argument in the rendered source. */
  anchor: number;
  /** Put a different name in the field and commit it, for "Did you mean". */
  onUseName: (name: string) => void;
}

/** Where an anchor ends up after an edit result, folded through its edits highest first (editsOf's order, which the pane's own queue uses). */
function anchorAfter(anchor: number, result: EditResult): number {
  let at: number | null = anchor;
  for (const edit of editsOf(result)) {
    at = shiftSingleAnchor(at, edit);
    if (at === null) return anchor;
  }
  return at;
}

export function ConstOfferStrip(props: ConstOfferStripProps) {
  const { review } = props;
  return review.kind === "offer" ? (
    <CreateStrip {...props} review={review} />
  ) : (
    <MoveStrip {...props} review={review} />
  );
}

type OfferReview = Extract<StripReview, { kind: "offer" }>;
type BelowReview = Extract<StripReview, { kind: "definedBelow" }>;

function CreateStrip({
  review,
  name,
  anchor,
  onUseName,
}: ConstOfferStripProps & { review: OfferReview }) {
  const { applyEdit, noteCommit, clearConstNote } = useBreakdownContext();
  const [value, setValue] = useState(String(review.defaultValue.value));
  // "Above this command" needs an item to put the line above. There is always
  // one in practice, but a use the parse could not place falls back to the
  // header, the only other choice, rather than offering a dead option.
  const [where, setWhere] = useState<"above" | "header">(
    review.holder ? "above" : "header",
  );
  const meaning = defaultMeaning(review.defaultValue);
  const typed = value.trim();
  const numeric = typed !== "" && Number.isFinite(Number(typed));
  const warning = numeric ? commentOpenWarning(Number(typed)) : undefined;

  const create = () => {
    if (typed === "") return;
    const at: InsertTarget =
      where === "above" && review.holder
        ? { before: review.holder }
        : { in: "preamble" };
    const result = applyEdit({
      kind: "addConst",
      at,
      name,
      value: numeric ? Number(typed) : typed,
    });
    if (!result) return;
    // The name now resolves, so the field flashes once the new parse lands.
    noteCommit?.(name, anchorAfter(anchor, result));
  };

  return (
    <div
      role="group"
      aria-label={`Create a constant named ${name}`}
      className={styles.strip}
    >
      <p className={styles.message}>
        No const named <code>{name}</code> in this script or the built-in list.
      </p>
      {review.didYouMean && (
        <HelpTip id="breakdown.constOffer.didYouMean">
          <button
            type="button"
            className={styles.button}
            onClick={() => onUseName(review.didYouMean!)}
          >
            Did you mean {review.didYouMean}?
          </button>
        </HelpTip>
      )}
      <div className={styles.controls}>
        <label className={styles.label}>
          Value
          <HelpTip id="breakdown.constOffer.value">
            <input
              type="text"
              className={styles.valueInput}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  create();
                } else if (e.key === "Escape") clearConstNote?.();
              }}
            />
          </HelpTip>
        </label>
        {meaning && <span className={styles.meaning}>{meaning}</span>}
        <HelpTip id="breakdown.constOffer.where">
          <select
            className={styles.select}
            aria-label="Where to put the line"
            value={where}
            onChange={(e) => setWhere(e.target.value as "above" | "header")}
          >
            {review.holder && <option value="above">Above this command</option>}
            <option value="header">In the header</option>
          </select>
        </HelpTip>
        <HelpTip id="breakdown.constOffer.create">
          <button
            type="button"
            className={styles.button}
            disabled={typed === ""}
            onClick={create}
          >
            Create
          </button>
        </HelpTip>
        <HelpTip id="breakdown.constOffer.dismiss">
          <button
            type="button"
            className={styles.button}
            onClick={() => clearConstNote?.()}
          >
            Dismiss
          </button>
        </HelpTip>
      </div>
      {warning && <p className={styles.warning}>{warning}</p>}
    </div>
  );
}

function MoveStrip({
  review,
  name,
  anchor,
}: ConstOfferStripProps & { review: BelowReview }) {
  const { applyEdit, noteCommit, clearConstNote } = useBreakdownContext();
  const { plan, line } = review;
  const refusal = moveUpRefusal(plan, name, line);

  const move = () => {
    if (!plan.ok) return;
    const result = applyEdit({
      kind: "moveNode",
      node: plan.definition,
      to: { before: plan.before },
    });
    if (!result) return;
    noteCommit?.(name, anchorAfter(anchor, result));
  };

  return (
    <div
      role="group"
      aria-label={`${name} is defined below this use`}
      className={styles.strip}
    >
      <p className={styles.message}>
        <code>{name}</code> is defined on line {line}, below this use, so the
        game does not see it here.
      </p>
      {refusal && <p className={styles.warning}>{refusal}</p>}
      <div className={styles.controls}>
        {plan.ok && (
          <HelpTip id="breakdown.constOffer.moveUp">
            <button type="button" className={styles.button} onClick={move}>
              Move the #const up here
            </button>
          </HelpTip>
        )}
        <HelpTip id="breakdown.constOffer.dismiss">
          <button
            type="button"
            className={styles.button}
            onClick={() => clearConstNote?.()}
          >
            Dismiss
          </button>
        </HelpTip>
      </div>
    </div>
  );
}
