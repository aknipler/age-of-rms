import { Fragment, useMemo, useState } from "react";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import languageDataRaw from "../../../reference/data/language.json";
import { buildLanguageIndex, type LanguageData } from "../../parser/language";
import type {
  GameConstantEntry,
  GameConstantsData,
} from "../../breakdown/gameConstants";
import { useParsedDocumentContext } from "../../ParsedDocumentContext";
import { usePreviewResultContext } from "../../PreviewResultContext";
import { usePreviewView } from "../preview/PreviewViewContext";
import { HelpTip } from "../HelpTip";
import { ScriptName } from "../ScriptName";
import { buildObjectInventory } from "./objectInventory";
import {
  CONSTANT_SORT_LABELS,
  compareConstantRowsBy,
  matchesQuery,
  matchingCommandRows,
  orphanAttributeRows,
  type ConstantSortKey,
} from "./referenceRows";
import styles from "./ReferenceTable.module.css";

// Read straight from the reference data rather than through
// BreakdownContext, which is what this component used to do.
//
// That dependency was the only thing tying the reference table to the
// Breakdown tab, and it was never a real one: of the fifteen fields on
// BreakdownContextValue this needed exactly two, `gameConstants` and `lang`,
// both of which are module-level JSON that never changes at runtime. The rest
// of that context is edit intents, expansion anchors and card selection,
// machinery a read-only lookup table has no business requiring. Dropping it is
// what lets the Code tab render this component at all, since there is no
// BreakdownProvider over there and there should not be one.
//
// Same double-cast reasoning as parserWorker.ts: resolveJsonModule infers a
// literal type from the file that does not always structurally overlap the
// hand-written interface, and `npm run validate:reference` (ajv) is the real
// guarantee the data is shaped correctly.
const gameConstants = gameConstantsRaw as unknown as GameConstantsData;
const languageData = languageDataRaw as unknown as LanguageData;
// attributesByName is the one piece of this the Commands tab needs; the rest
// of LanguageIndex (commandsByTokenId, controlKeywords, ...) is parser
// machinery this read-only table has no use for.
const { attributesByName } = buildLanguageIndex(languageData);

type Mode = "terrain" | "objects" | "commands" | "previewObjects";

const MODE_LABELS: Record<Mode, string> = {
  terrain: "Terrain",
  objects: "Objects",
  commands: "Commands / Attributes",
  previewObjects: "Preview Obj. List",
};

/** The two modes that are a slice of game-constants.json. */
type ConstantMode = "terrain" | "objects";

/**
 * The radio's `Mode` vocabulary and game-constants.json's `category`
 * vocabulary are two different vocabularies that mostly agree, and the
 * Objects tab rendered nothing for months because of the one place they do
 * not: an object row's category is the SINGULAR `"object"`. The filter read
 * `c.category === mode`, which is a valid filter that matches zero rows, so
 * there was no error to see, only an empty table.
 *
 * Mapping them explicitly is the point. `ValueEditor.tsx` already writes the
 * category out as a literal rather than reusing a UI string, and passing a
 * label through as a data key is what let the two drift apart silently.
 */
const CATEGORY_BY_MODE: Record<ConstantMode, string> = {
  terrain: "terrain",
  objects: "object",
};

/**
 * A column is a header plus a function from a row to a cell, so the two modes
 * can share one table body while disagreeing about the columns between the
 * shared prefix and the shared `Description` suffix.
 *
 * The middle has to disagree: `deTextureFile` is null on every object row, so
 * reusing the terrain columns would have "implemented" Objects as a table
 * with a permanently empty column. `habitat` and `resourceAmounts` are the
 * object-side equivalents, the fields the generator and the status-bar
 * totals actually read.
 */
interface ConstantColumn {
  header: string;
  /**
   * Returns text rather than a ReactNode on purpose. Every cell in these two
   * tables is a plain value, and keeping the return type printable is what
   * lets Find search EXACTLY what the table shows: the filter runs the same
   * `cell` functions the renderer does, so a column added later is searchable
   * without anyone remembering to update a parallel list of fields.
   */
  cell: (c: GameConstantEntry) => string | number;
}

const SHARED_COLUMNS: ConstantColumn[] = [
  { header: "Const. ID#", cell: (c) => c.constId ?? "—" },
  // 53 of the 131 terrain rows have no callable constant (the engine reaches
  // them by bare id), so this is blank often enough to be worth an explicit
  // dash rather than an empty cell that reads as a rendering failure.
  { header: "RMS Constant", cell: (c) => c.rmsConstant ?? "—" },
  { header: "Descriptive Name", cell: (c) => c.descriptiveName },
];

// Community-table Comments, not this project's own data. 131 of 131 terrain
// rows carry one, 668 of 2670 object rows do (the rest are gaia roster rows
// the community table never annotates, mostly carcasses/blood decals). Its
// own dash reads as "the community table has nothing to say", the same as
// every other absent community field in this file (isWater, beachTerrain, ...).
const DESCRIPTION_COLUMN: ConstantColumn = {
  header: "Description",
  cell: (c) => c.description ?? "—",
};

const COLUMNS_BY_MODE: Record<ConstantMode, ConstantColumn[]> = {
  terrain: [
    ...SHARED_COLUMNS,
    { header: "DE Texture File", cell: (c) => c.deTextureFile ?? "—" },
    DESCRIPTION_COLUMN,
  ],
  objects: [
    ...SHARED_COLUMNS,
    { header: "Placed On", cell: (c) => c.habitat ?? "—" },
    {
      header: "Base Yield",
      cell: (c) => formatResourceAmounts(c.resourceAmounts),
    },
    DESCRIPTION_COLUMN,
  ],
};

/** `{ gold: 800 }` -> `800 gold`. Base value, before any script modifier. */
function formatResourceAmounts(
  amounts: GameConstantEntry["resourceAmounts"],
): string {
  if (!amounts) return "—";
  const parts = Object.entries(amounts).map(
    ([resource, amount]) => `${amount} ${resource}`,
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

/**
 * The objects the current script names, with how many the preview placed and
 * whether the canvas should draw them.
 *
 * Read-only lookups are the rest of this file's job; this one is a CONTROL,
 * and the split shows in where its data comes from, the parse result and the
 * generated preview rather than the bundled reference JSON. It lives here
 * anyway because it answers the same question the user is asking when they
 * open this panel ("what is in this map?"), just about their own script
 * instead of about RMS.
 */
function PreviewObjectList({ query }: { query: string }) {
  const parse = useParsedDocumentContext();
  const { result } = usePreviewResultContext();
  const { hiddenObjects, toggleObjectHidden, showAllObjects } =
    usePreviewView();

  // Rebuilt only when the script or the generation changes, not on every
  // checkbox click: the AST walk is O(script) and a tick is a re-render.
  const allRows = useMemo(
    () => buildObjectInventory(parse, result?.objects ?? []),
    [parse, result?.objects],
  );

  // Filtering is a separate memo from building, keyed on the query as well, so
  // typing in Find does not re-walk the AST on every keystroke.
  const rows = useMemo(
    () =>
      allRows.filter((row) =>
        matchesQuery(query, [row.objectRef, row.spawned]),
      ),
    [allRows, query],
  );

  if (allRows.length === 0) {
    return (
      <p className={styles.note}>
        No objects yet. Every create_object in your script gets a row here,
        along with anything an object group adds.
      </p>
    );
  }

  if (rows.length === 0) {
    return <p className={styles.note}>No objects match “{query}”.</p>;
  }

  return (
    <>
      {/* One way back, shown only when there is something to come back from.
          Unticking is per row, so a long list can end up with a dozen hidden
          objects and no memory of which. Re-ticking them one at a time is
          the kind of chore that makes people stop using the control. */}
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
              <td>
                <ScriptName name={row.objectRef} />
              </td>
              {/* Zero is worth spotting rather than reading past: it means the
                script asked and the generator placed nothing, which is the
                symptom of a restriction nothing on the map satisfies. */}
              <td className={row.spawned === 0 ? styles.zeroCount : undefined}>
                {row.spawned}
              </td>
              <td>
                <HelpTip id="preview.objectVisibility">
                  <input
                    type="checkbox"
                    // Ticked by default, and the DEFAULT is the empty set rather
                    // than a per-object flag. See PreviewViewContext's
                    // hiddenObjects for why that direction is the one that keeps
                    // a newly written object visible without being registered.
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
    </>
  );
}

/**
 * docs/breakdown-design.md Sec.3.8, a read-only reference/lookup aid, not
 * filtered to the current selection (spec explicitly calls that a
 * nice-to-have, not required for 3.2). Terrain/Objects come from
 * game-constants.json; Commands comes from language.json's commands[], with
 * the verified/unverified chip.
 */
export function ReferenceTable() {
  const [mode, setMode] = useState<Mode>("terrain");
  // One query shared across all four tabs rather than one per tab. Switching
  // tab with a live filter is how you ask "is this name a terrain or an
  // object?", and per-tab state would answer it by silently clearing.
  const [query, setQuery] = useState("");
  // The Objects tab holds one row per live gaia unit as of CREATION_PLAN 4.10,
  // and 501 of them are carcasses and blood decals, units something else in
  // the roster dies into, per the dat's own dead_unit_id/blood_unit_id links.
  // They are real, a script CAN name one by id, and offering them beside DEER
  // in the default listing makes the roster unreadable. Hidden unless asked.
  //
  // State, not a constant, because "unless asked" is the whole point: nothing
  // here is deleted, and the count in the label is what tells a user the toggle
  // is worth flipping.
  const [showCorpses, setShowCorpses] = useState(false);
  // Terrain/Objects only (beta feedback: "allow for different sorting
  // filters"). One shared pair rather than one per tab, same reasoning as
  // `query` above: switching tabs mid-comparison should not silently reset
  // how the table is ordered.
  const [sortKey, setSortKey] = useState<ConstantSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  // Manually expanded commands in the Commands / Attributes tab. Keyed by
  // name rather than a boolean per row, so it survives the query changing
  // (search auto-expands on top of this, see `isExpanded` below, without
  // ever collapsing something the user opened by hand).
  const [expandedCommands, setExpandedCommands] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const { hiddenObjects } = usePreviewView();
  // Something is being withheld from the canvas. Worth saying on the OUTSIDE
  // of this panel, because the effect (objects missing from the map) shows up
  // somewhere the control is not, and on any of the other three tabs the
  // control is not even on screen.
  const objectsHidden = hiddenObjects.size > 0;

  // Filter and sort once per mode instead of on every render. The hook has to
  // sit up here and cover all four modes, since hooks cannot run inside the
  // conditional below. The two non-constant modes just get an empty list.
  //
  // Sorting in place is safe ONLY because `.filter()` has already returned a
  // fresh array. `.sort()` mutates its receiver, so calling it directly on
  // `gameConstants.constants` would permanently reorder a module-level import
  // that ValueEditor and the parser worker also read.
  const constantRows = useMemo(() => {
    if (mode === "commands" || mode === "previewObjects") return [];
    const columns = COLUMNS_BY_MODE[mode];
    return (
      gameConstants.constants
        .filter((c) => c.category === CATEGORY_BY_MODE[mode])
        // `isCorpse` is absent on a row that is not one, so this is a positive
        // test rather than a default. Applied BEFORE the search filter on
        // purpose: a hidden row must stay hidden when a query matches it, or
        // Find silently reintroduces exactly what the toggle is holding back.
        .filter((c) => showCorpses || !c.isCorpse)
        .sort((a, b) => {
          const cmp = compareConstantRowsBy(sortKey, a, b);
          return sortDirection === "asc" ? cmp : -cmp;
        })
        // Search runs the same `cell` functions the renderer does, so it always
        // covers exactly the columns on screen and nothing else.
        .filter((c) =>
          matchesQuery(
            query,
            columns.map((col) => col.cell(c)),
          ),
        )
    );
  }, [mode, query, showCorpses, sortKey, sortDirection]);

  // Counted over the whole category rather than over what is on screen, so the
  // label reads the same whatever the search box holds.
  const corpseCount = useMemo(
    () =>
      mode === "objects"
        ? gameConstants.constants.filter(
            (c) => c.category === "object" && c.isCorpse,
          ).length
        : 0,
    [mode],
  );

  const commandRows = useMemo(
    () =>
      mode === "commands"
        ? matchingCommandRows(languageData.commands, attributesByName, query)
        : [],
    [mode, query],
  );

  // Attributes no command's attributes[] names (today: four legacy
  // non-functional engine strings), nowhere to nest, so they get their own
  // rows rather than being unreachable from Find.
  const orphanAttrRows = useMemo(
    () =>
      mode === "commands"
        ? orphanAttributeRows(
            languageData.commands,
            languageData.attributes,
            query,
          )
        : [],
    [mode, query],
  );

  const noCommandResults =
    commandRows.length === 0 && orphanAttrRows.length === 0;

  function toggleExpanded(commandName: string) {
    setExpandedCommands((prev) => {
      const next = new Set(prev);
      if (next.has(commandName)) next.delete(commandName);
      else next.add(commandName);
      return next;
    });
  }

  return (
    <div
      className={`${styles.section} ${objectsHidden ? styles.sectionWarned : ""}`}
      data-tutorial-anchor="sidePanel.reference"
    >
      <div className={styles.panel}>
        <HelpTip id="breakdown.sidePanel.referenceRadio">
          <div className={styles.radioRow}>
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name="reference-mode"
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {MODE_LABELS[m]}
                {m === "previewObjects" && objectsHidden && (
                  <span
                    className={styles.hiddenWarning}
                    title="Some objects are hidden from the preview"
                    aria-label="Some objects are hidden from the preview"
                  >
                    ⚠
                  </span>
                )}
              </label>
            ))}
          </div>
        </HelpTip>

        <HelpTip id="breakdown.sidePanel.referenceFind">
          <div className={styles.findRow}>
            <input
              type="search"
              className={styles.findInput}
              value={query}
              placeholder={`Find in ${MODE_LABELS[mode]}…`}
              aria-label={`Find in ${MODE_LABELS[mode]}`}
              onChange={(e) => setQuery(e.target.value)}
              // Escape clears without moving focus, so a mistyped query costs
              // one key rather than a select-all. `type="search"` gives Chromium
              // its own clear affordance; this is the keyboard route to it.
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setQuery("");
                }
              }}
            />
          </div>
        </HelpTip>

        {(mode === "terrain" || mode === "objects") && (
          <HelpTip id="breakdown.sidePanel.referenceSort">
            <div className={styles.sortRow}>
              <label className={styles.sortLabel}>
                Sort by
                <select
                  className={styles.sortSelect}
                  value={sortKey}
                  onChange={(e) =>
                    setSortKey(e.target.value as ConstantSortKey)
                  }
                >
                  {(Object.keys(CONSTANT_SORT_LABELS) as ConstantSortKey[]).map(
                    (key) => (
                      <option key={key} value={key}>
                        {CONSTANT_SORT_LABELS[key]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                type="button"
                className={styles.sortDirectionButton}
                onClick={() =>
                  setSortDirection((d) => (d === "asc" ? "desc" : "asc"))
                }
                aria-label={
                  sortDirection === "asc"
                    ? "Sorted ascending. Click to sort descending."
                    : "Sorted descending. Click to sort ascending."
                }
              >
                {sortDirection === "asc" ? "▲" : "▼"}
              </button>
            </div>
          </HelpTip>
        )}

        {mode === "objects" && corpseCount > 0 && (
          <HelpTip id="breakdown.sidePanel.referenceCorpses">
            <label className={styles.findRow}>
              <input
                type="checkbox"
                checked={showCorpses}
                onChange={(e) => setShowCorpses(e.target.checked)}
              />
              Show {corpseCount} carcasses and decals
            </label>
          </HelpTip>
        )}

        {mode === "previewObjects" ? (
          <HelpTip id="preview.objectList">
            <PreviewObjectList query={query} />
          </HelpTip>
        ) : mode !== "commands" ? (
          <HelpTip id="breakdown.sidePanel.referenceTable">
            <table className={styles.table}>
              <thead>
                <tr>
                  {COLUMNS_BY_MODE[mode].map((col) => (
                    <th key={col.header}>{col.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Index as key, deliberately. The list is fixed per mode
                    (never reordered, inserted into or removed from once built),
                    which is exactly the case where an index key is correct
                    rather than merely convenient. `rmsConstant` was the key
                    before and is null on 53 terrain rows, so React saw those
                    as keyless. */}
                {constantRows.map((c, i) => (
                  <tr key={i}>
                    {COLUMNS_BY_MODE[mode].map((col) => (
                      <td key={col.header}>{col.cell(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </HelpTip>
        ) : (
          <HelpTip id="breakdown.sidePanel.referenceTable">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Command</th>
                  <th>Section</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {commandRows.map(({ command, attributes }) => {
                  const hasAttributes = (command.attributes?.length ?? 0) > 0;
                  // Searching finds an attribute buried inside a collapsed
                  // command as easily as one that's already open: whenever a
                  // query is live and `attributes` is non-empty, whether
                  // that's every attribute (the command itself matched) or
                  // just the ones that matched (it didn't), force the row
                  // open on top of whatever the user last clicked, rather
                  // than making them expand every candidate by hand to see
                  // what's actually relevant.
                  const expanded =
                    expandedCommands.has(command.name) ||
                    (query !== "" && attributes.length > 0);
                  return (
                    <Fragment key={command.name}>
                      <tr>
                        <td>
                          {hasAttributes && (
                            <button
                              type="button"
                              className={styles.expandToggle}
                              onClick={() => toggleExpanded(command.name)}
                              aria-expanded={expanded}
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${command.name}'s attributes`}
                            >
                              {expanded ? "▾" : "▸"}
                            </button>
                          )}
                          {command.name}
                          {!command.verified && (
                            <span className={styles.unverifiedChip}>
                              unverified
                            </span>
                          )}
                        </td>
                        <td>{command.section}</td>
                        <td>{command.description ?? "—"}</td>
                      </tr>
                      {expanded &&
                        attributes.map((a) => (
                          <tr
                            key={`${command.name}::${a.name}`}
                            className={styles.attributeRow}
                          >
                            <td className={styles.attributeName}>
                              {a.name}
                              {!a.verified && (
                                <span className={styles.unverifiedChip}>
                                  unverified
                                </span>
                              )}
                            </td>
                            <td>—</td>
                            <td>{a.description ?? "—"}</td>
                          </tr>
                        ))}
                    </Fragment>
                  );
                })}
                {orphanAttrRows.length > 0 && (
                  <>
                    <tr className={styles.attributeGroupRow}>
                      <td colSpan={3}>
                        Other attributes (not tied to a specific command)
                      </td>
                    </tr>
                    {orphanAttrRows.map((a) => (
                      <tr key={a.name} className={styles.attributeRow}>
                        <td className={styles.attributeName}>
                          {a.name}
                          {!a.verified && (
                            <span className={styles.unverifiedChip}>
                              unverified
                            </span>
                          )}
                        </td>
                        <td>—</td>
                        <td>{a.description ?? "—"}</td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </HelpTip>
        )}
        {/*
          reference data is a positive
          resolver, never a negative authority, a name missing from this table
          proves nothing about the game).

          It says nothing about the Preview Obj. List, which is not a slice of
          the constants DB at all, its rows come from the open script, so
          coverage is not a thing that can be short there.
        */}
        {/* An empty table with a filter in the box reads as broken data unless
            it says otherwise, and this one is especially easy to misread: the
            note below already tells the user the table is incomplete, so an
            empty result looks like confirmation of that rather than like a
            query with no hits. */}
        {mode !== "previewObjects" &&
          query !== "" &&
          (mode === "commands"
            ? noCommandResults
            : constantRows.length === 0) && (
            <p className={styles.note}>
              Nothing in {MODE_LABELS[mode]} matches “{query}”.
            </p>
          )}
        {(mode === "terrain" || mode === "objects") && (
          <p className={styles.note}>
            The common constants, not all of them. A name missing here may still
            be valid in game.
          </p>
        )}
        {mode === "previewObjects" && objectsHidden && (
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
