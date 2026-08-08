import { useState } from "react";
import gameConstantsRaw from "../../../reference/data/game-constants.json";
import languageDataRaw from "../../../reference/data/language.json";
import type { LanguageData } from "../../parser/language";
import type { GameConstantsData } from "../../breakdown/gameConstants";
import { HelpTip } from "../HelpTip";
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

type Mode = "terrain" | "objects" | "commands";

/**
 * docs/breakdown-design.md Sec.3.8 — a read-only reference/lookup aid, not
 * filtered to the current selection (spec explicitly calls that a
 * nice-to-have, not required for 3.2). Terrain/Objects come from
 * game-constants.json; Commands comes from language.json's commands[], with
 * the verified/unverified chip.
 */
export function ReferenceTable() {
  const [mode, setMode] = useState<Mode>("terrain");

  return (
    <div className={styles.panel}>
      <HelpTip id="breakdown.sidePanel.referenceRadio">
        <div className={styles.radioRow}>
          {(["terrain", "objects", "commands"] as const).map((m) => (
            <label key={m}>
              <input type="radio" name="reference-mode" checked={mode === m} onChange={() => setMode(m)} />
              {m === "terrain" ? "Terrain" : m === "objects" ? "Objects" : "Commands"}
            </label>
          ))}
        </div>
      </HelpTip>

      {mode !== "commands" ? (
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
      */}
      {mode !== "commands" && (
        <p className={styles.note}>
          The common constants, not all of them — a name missing here may still be valid in game.
        </p>
      )}
    </div>
  );
}
