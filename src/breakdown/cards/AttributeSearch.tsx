import { useState } from "react";
import type { AttributeSlot } from "../attributeModel";
import type { AttributeTarget } from "../patch/intents";
import { useBreakdownContext } from "../BreakdownContext";
import { addAbsentSlotIntent, filterSlots } from "../hideUnused";
import { HelpTip } from "../../components/HelpTip";
import styles from "./AttributeSearch.module.css";

interface AttributeSearchProps {
  /** The slots Hide Unused is currently hiding on this card. */
  hidden: AttributeSlot[];
  attributeTarget: AttributeTarget;
}

// The "Add Attribute" bar at the top of a card while Hide Unused is on
// (Sec.3.3.1 amendment, 2026-09-17). Type to filter the hidden slots, click
// one to add it. The added attribute is present in the source from then
// on, so partitionSlots shows it at once without touching the snapshot.
export function AttributeSearch({
  hidden,
  attributeTarget,
}: AttributeSearchProps) {
  const { applyEdit, requestFocus } = useBreakdownContext();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const results = filterSlots(hidden, query);

  const pick = (slot: AttributeSlot) => {
    const result = applyEdit(addAbsentSlotIntent(slot, attributeTarget));
    setQuery("");
    setOpen(false);
    if (result) requestFocus(result.caret);
  };

  return (
    <div
      className={styles.bar}
      // Focus leaving the whole bar (input and list) closes the list.
      // relatedTarget is where focus is going, null when it leaves the
      // document, which counts as leaving too.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <HelpTip id="breakdown.commandCard.addAttributeSearch">
        <input
          type="text"
          className={styles.input}
          placeholder="Add Attribute"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              e.currentTarget.blur();
            } else if (e.key === "Enter" && results.length > 0) {
              e.preventDefault();
              pick(results[0]);
            }
          }}
        />
      </HelpTip>
      {open && (
        <div className={styles.list} role="listbox">
          {results.length === 0 && (
            <p className={styles.empty}>
              {hidden.length === 0
                ? "Every attribute is already shown."
                : "No matching attributes."}
            </p>
          )}
          {results.map((slot) => (
            <button
              key={slot.name}
              type="button"
              role="option"
              aria-selected={false}
              className={styles.entry}
              // mousedown, so the input's blur (which would close the list
              // before the click lands) does not fire first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(slot);
              }}
            >
              <span className={styles.entryName}>{slot.name}</span>
              <span className={styles.entryDesc}>
                {slot.def.description ?? ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
