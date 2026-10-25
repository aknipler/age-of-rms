import type { DirectiveNode } from "../../parser/types";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import { ENTER_ADD, ENTER_SCOPE } from "../enterNav";
import { ItemCard } from "./ItemCard";
import { addedConstNameStart, freshTableName } from "../constTableModel";
import styles from "./ConstTable.module.css";

// A run of `#const` (or `#define`) lines shown as one table (2026-10-23).
// Each row is still its own card underneath, wrapped in ItemCard, so
// selecting, dragging, the right click menu and each row's own Delete and
// comment buttons all work as before. Only the frame changes, one border
// around the run instead of one per line.
//
// Each table ends with an add button and is an Enter group (enterNav.ts).
// In a `#const` table Enter on a name moves to its value, Enter on the last
// value lands on the button, and Enter there adds a row with its name
// selected for typing over. A `#define` row has only its name, so Enter
// moves name to name and then to the button.

export function ConstTable({
  rows,
  directive,
}: {
  rows: readonly DirectiveNode[];
  directive: string;
}) {
  const { applyEdit, requestFocus, parseResult } = useBreakdownContext();
  const isConst = directive === "#const";
  const addRow = () => {
    const taken = new Set(parseResult.symbols.map((s) => s.name));
    const at = { after: rows[rows.length - 1] };
    if (isConst) {
      const name = freshTableName("NEW_CONST", taken);
      const result = applyEdit({ kind: "addConst", at, name, value: 0 });
      if (result) requestFocus(addedConstNameStart(result.caret, name));
    } else {
      // addDefine leaves the caret on the name already.
      const name = freshTableName("NEW_DEFINE", taken);
      const result = applyEdit({ kind: "addDefine", at, name });
      if (result) requestFocus(result.caret);
    }
  };
  return (
    <div className={styles.table} {...{ [ENTER_SCOPE]: true }}>
      <div className={styles.rows}>
        {rows.map((row) => (
          <ItemCard key={row.span.start} item={row} />
        ))}
      </div>
      <div className={styles.addRow}>
        <HelpTip
          id={
            isConst ? "breakdown.constTable.add" : "breakdown.defineTable.add"
          }
        >
          <button
            type="button"
            className={styles.addButton}
            {...{ [ENTER_ADD]: true }}
            onClick={addRow}
          >
            + add {directive}
          </button>
        </HelpTip>
      </div>
    </div>
  );
}
