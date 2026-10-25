import { useMemo } from "react";
import { useParsedDocumentContext } from "../../ParsedDocumentContext";
import { usePreviewResultContext } from "../../PreviewResultContext";
import { HelpTip } from "../HelpTip";
import {
  buildObjectInventory,
  compareInventoryRows,
  INVENTORY_SORT_LABELS,
  type InventorySortKey,
} from "../sidepanel/objectInventory";
import { matchesQuery, type SortDirection } from "../sidepanel/referenceRows";
import { SortControl } from "../sidepanel/SortControl";
import { usePreviewView } from "./PreviewViewContext";
import styles from "./PreviewObjectList.module.css";

/**
 * The list's search text and order. Held by PreviewCanvas rather than in this
 * component, because this component unmounts every time its box is closed,
 * and closing the box to look at the map should not reset how the list was
 * sorted.
 */
export interface ObjectListSettings {
  query: string;
  sortKey: InventorySortKey;
  direction: SortDirection;
}

interface PreviewObjectListProps {
  settings: ObjectListSettings;
  onSettingsChange: (settings: ObjectListSettings) => void;
}

/**
 * The objects the current script names, with how many the preview placed and
 * whether the canvas should draw them. Opened by the Obj. List button under
 * the map. It used to be the reference table's fourth tab, and moved here
 * because every row's tick box changes this map.
 *
 * The search and sort sit above the scrolling table rather than inside it, so
 * they stay on screen however far the list is scrolled. The table header is
 * sticky inside that scroll area, which has no top padding, so no row can
 * show above the header.
 */
export function PreviewObjectList({
  settings,
  onSettingsChange,
}: PreviewObjectListProps) {
  const parse = useParsedDocumentContext();
  const { result } = usePreviewResultContext();
  const { hiddenObjects, toggleObjectHidden, showAllObjects } =
    usePreviewView();
  const { query, sortKey, direction } = settings;

  // Rebuilt only when the script or the generation changes, not on every
  // checkbox click: the AST walk is O(script) and a tick is a re-render.
  const allRows = useMemo(
    () => buildObjectInventory(parse, result?.objects ?? []),
    [parse, result?.objects],
  );

  // Filtering and sorting are a separate memo from building, so typing in the
  // search box does not re-walk the AST on every keystroke. `.filter()`
  // returns a fresh array, which is what makes the in-place `.sort()` safe.
  const rows = useMemo(() => {
    const sign = direction === "asc" ? 1 : -1;
    return allRows
      .filter((row) => matchesQuery(query, [row.objectRef, row.spawned]))
      .sort((a, b) => sign * compareInventoryRows(sortKey, a, b));
  }, [allRows, query, sortKey, direction]);

  if (allRows.length === 0) {
    return (
      <p className={styles.note}>
        No objects yet. Every create_object in your script gets a row here,
        along with anything an object group adds.
      </p>
    );
  }

  return (
    <div className={styles.list}>
      <div className={styles.controls}>
        <HelpTip id="preview.objectListFind">
          <div className={styles.findRow}>
            <input
              type="search"
              className={styles.findInput}
              value={query}
              placeholder="Find an object…"
              aria-label="Find an object"
              onChange={(e) =>
                onSettingsChange({ ...settings, query: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  onSettingsChange({ ...settings, query: "" });
                }
              }}
            />
          </div>
        </HelpTip>
        <div className={styles.controlsRow}>
          <SortControl
            helpId="preview.objectListSort"
            labels={INVENTORY_SORT_LABELS}
            sortKey={sortKey}
            onSortKeyChange={(key) =>
              onSettingsChange({ ...settings, sortKey: key })
            }
            direction={direction}
            onDirectionChange={(next) =>
              onSettingsChange({ ...settings, direction: next })
            }
          />
          {/* One way back, shown only when there is something to come back
              from. Unticking is per row, so a long list can end up with a
              dozen hidden objects and no memory of which. */}
          {hiddenObjects.size > 0 && (
            <HelpTip id="preview.showAllObjects">
              <button
                type="button"
                className={styles.showAll}
                onClick={showAllObjects}
              >
                Show all ({hiddenObjects.size} hidden)
              </button>
            </HelpTip>
          )}
        </div>
      </div>

      <div className={styles.scroll}>
        {rows.length === 0 ? (
          <p className={styles.note}>No objects match “{query}”.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Object</th>
                <th>Total Spawned</th>
                <th>Visualise in Preview</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.objectRef}>
                  {/* The full name as written, not ScriptName's shortened
                      form. This list is where a name is looked up, and a
                      shortened one can match several objects. */}
                  <td className={styles.name}>{row.objectRef}</td>
                  {/* Zero is worth spotting rather than reading past: the
                      script asked and the generator placed nothing, which is
                      the symptom of a restriction nothing on the map
                      satisfies. */}
                  <td
                    className={row.spawned === 0 ? styles.zeroCount : undefined}
                  >
                    {row.spawned}
                  </td>
                  <td>
                    <HelpTip id="preview.objectVisibility">
                      <input
                        type="checkbox"
                        // Ticked by default, and the DEFAULT is the empty set
                        // rather than a per-object flag. See
                        // PreviewViewContext's hiddenObjects for why that
                        // direction keeps a newly written object visible.
                        checked={!hiddenObjects.has(row.objectRef)}
                        onChange={() => toggleObjectHidden(row.objectRef)}
                        aria-label={`Visualise ${row.objectRef} in preview`}
                      />
                    </HelpTip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hiddenObjects.size > 0 && (
          <p className={styles.note}>
            Unticked objects are hidden from the map only. They are still
            placed, still counted here, and still listed when you click their
            tile.
          </p>
        )}
      </div>
    </div>
  );
}
