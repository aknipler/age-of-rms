import { useMemo, useState } from "react";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import languageDataRaw from "../../../reference/data/language.json";
import type { LanguageData } from "../../parser/language";
import type { GameConstantsData } from "../../breakdown/gameConstants";
import { useParsedDocumentContext } from "../../ParsedDocumentContext";
import { usePreviewResultContext } from "../../PreviewResultContext";
import { usePreviewView } from "../preview/PreviewViewContext";
import { HelpTip } from "../HelpTip";
import { ScriptName } from "../ScriptName";
import { buildObjectInventory } from "./objectInventory";
import styles from "./ReferenceTable.module.css";

// Read straight from the reference data rather than through
// BreakdownContext, which is what this component used to do.
//
// That dependency was the only thing tying the reference table to the
// Breakdown tab, and it was never a real one: of the fifteen fields on
// BreakdownContextValue this needed exactly two, `gameConstants` and `lang`,
// both of which are module-level JSON that never changes at runtime. The rest
// of that context is edit intents, expansion anchors and card selection —
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

type Mode = "terrain" | "objects" | "commands" | "previewObjects";

const MODE_LABELS: Record<Mode, string> = {
  terrain: "Terrain",
  objects: "Objects",
  commands: "Commands",
  previewObjects: "Preview Obj. List",
};

/**
 * The objects the current script names, with how many the preview placed and
 * whether the canvas should draw them.
 *
 * Read-only lookups are the rest of this file's job; this one is a CONTROL,
 * and the split shows in where its data comes from — the parse result and the
 * generated preview rather than the bundled reference JSON. It lives here
 * anyway because it answers the same question the user is asking when they
 * open this panel ("what is in this map?"), just about their own script
 * instead of about RMS.
 */
function PreviewObjectList() {
  const parse = useParsedDocumentContext();
  const result = usePreviewResultContext();
  const { hiddenObjects, toggleObjectHidden, showAllObjects } = usePreviewView();

  // Rebuilt only when the script or the generation changes, not on every
  // checkbox click: the AST walk is O(script) and a tick is a re-render.
  const rows = useMemo(() => buildObjectInventory(parse, result?.objects ?? []), [parse, result?.objects]);

  if (rows.length === 0) {
    return (
      <p className={styles.note}>
        No objects yet. Every create_object in your script gets a row here, along with anything an object
        group adds.
      </p>
    );
  }

  return (
    <>
      {/* One way back, shown only when there is something to come back from.
          Unticking is per row, so a long list can end up with a dozen hidden
          objects and no memory of which — re-ticking them one at a time is
          the kind of chore that makes people stop using the control. */}
      {hiddenObjects.size > 0 && (
        <HelpTip id="preview.showAllObjects">
          <button type="button" className={styles.showAll} onClick={showAllObjects}>
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
              <td className={row.spawned === 0 ? styles.zeroCount : undefined}>{row.spawned}</td>
              <td>
                <HelpTip id="preview.objectVisibility">
                  <input
                    type="checkbox"
                    // Ticked by default, and the DEFAULT is the empty set rather
                    // than a per-object flag — see PreviewViewContext's
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
 * docs/breakdown-design.md Sec.3.8 — a read-only reference/lookup aid, not
 * filtered to the current selection (spec explicitly calls that a
 * nice-to-have, not required for 3.2). Terrain/Objects come from
 * game-constants.json; Commands comes from language.json's commands[], with
 * the verified/unverified chip.
 */
export function ReferenceTable() {
  const [mode, setMode] = useState<Mode>("terrain");
  const { hiddenObjects } = usePreviewView();
  // Something is being withheld from the canvas. Worth saying on the OUTSIDE
  // of this panel, because the effect (objects missing from the map) shows up
  // somewhere the control is not, and on any of the other three tabs the
  // control is not even on screen.
  const objectsHidden = hiddenObjects.size > 0;

  return (
    <div className={`${styles.section} ${objectsHidden ? styles.sectionWarned : ""}`}>
      <div className={styles.panel}>
        <HelpTip id="breakdown.sidePanel.referenceRadio">
          <div className={styles.radioRow}>
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <label key={m}>
                <input type="radio" name="reference-mode" checked={mode === m} onChange={() => setMode(m)} />
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

        {mode === "previewObjects" ? (
          <HelpTip id="preview.objectList">
            <PreviewObjectList />
          </HelpTip>
        ) : mode !== "commands" ? (
          <HelpTip id="breakdown.sidePanel.referenceTable">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Const. ID#</th>
                  <th>RMS Constant</th>
                  <th>Descriptive Name</th>
                  <th>DE Texture File</th>
                </tr>
              </thead>
              <tbody>
                {gameConstants.constants
                  .filter((c) => c.category === mode)
                  .map((c) => (
                    <tr key={c.rmsConstant}>
                      <td>{c.constId ?? "—"}</td>
                      <td>{c.rmsConstant}</td>
                      <td>{c.descriptiveName}</td>
                      <td>{c.deTextureFile ?? "—"}</td>
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
                {languageData.commands.map((c) => (
                  <tr key={c.name}>
                    <td>
                      {c.name}
                      {!c.verified && <span className={styles.unverifiedChip}>unverified</span>}
                    </td>
                    <td>{c.section}</td>
                    <td>{c.description ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HelpTip>
        )}
        {/*
          This used to read "IDs/textures pending extraction (Phase 4.0)". That
          extraction ran on 2026-07-30 and the values above are real, so the note
          was telling users to distrust correct data. What is still true is the
          coverage: the table holds 31 of DE's several hundred constants, which
          is the thing worth saying (CLAUDE.md: reference data is a positive
          resolver, never a negative authority — a name missing from this table
          proves nothing about the game).

          It says nothing about the Preview Obj. List, which is not a slice of
          the constants DB at all — its rows come from the open script, so
          coverage is not a thing that can be short there.
        */}
        {(mode === "terrain" || mode === "objects") && (
          <p className={styles.note}>
            The common constants, not all of them — a name missing here may still be valid in game.
          </p>
        )}
        {mode === "previewObjects" && objectsHidden && (
          <p className={styles.note}>
            Unticked objects are hidden from the map only. They are still placed, still counted here, and
            still listed when you click their tile.
          </p>
        )}
      </div>
    </div>
  );
}
