import { HelpTip } from "../HelpTip";
import type { SortDirection } from "./referenceRows";
import styles from "./SortControl.module.css";

interface SortControlProps<K extends string> {
  /** The HelpTip entry for this control, since each table explains its own keys. */
  helpId: string;
  /** Every key the dropdown offers, mapped to its label. The keys' order is the dropdown's order. */
  labels: Record<K, string>;
  sortKey: K;
  onSortKeyChange: (key: K) => void;
  direction: SortDirection;
  onDirectionChange: (direction: SortDirection) => void;
}

/**
 * The "Sort by" dropdown and direction arrow, shared by the reference table's
 * tabs and the preview's Obj. List.
 *
 * Generic over the key type `K`, so each caller keeps its own union
 * (`ConstantSortKey`, `CommandSortKey`, `InventorySortKey`) and TypeScript
 * still checks that `onSortKeyChange` only ever receives one of that caller's
 * keys. The alternative, `string` throughout, would compile with a key from
 * the wrong table. `K extends string` is the constraint that lets a key be an
 * `<option value>` and a `Record` key at once.
 */
export function SortControl<K extends string>({
  helpId,
  labels,
  sortKey,
  onSortKeyChange,
  direction,
  onDirectionChange,
}: SortControlProps<K>) {
  return (
    <HelpTip id={helpId}>
      <div className={styles.sortRow}>
        <label className={styles.sortLabel}>
          Sort by
          <select
            className={styles.sortSelect}
            value={sortKey}
            // `e.target.value` is typed `string`. The cast is safe because
            // the only options rendered are the keys of `labels`.
            onChange={(e) => onSortKeyChange(e.target.value as K)}
          >
            {(Object.keys(labels) as K[]).map((key) => (
              <option key={key} value={key}>
                {labels[key]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={styles.sortDirectionButton}
          onClick={() =>
            onDirectionChange(direction === "asc" ? "desc" : "asc")
          }
          aria-label={
            direction === "asc"
              ? "Sorted ascending. Click to sort descending."
              : "Sorted descending. Click to sort ascending."
          }
        >
          {direction === "asc" ? "▲" : "▼"}
        </button>
      </div>
    </HelpTip>
  );
}
