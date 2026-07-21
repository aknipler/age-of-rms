import { useState } from "react";
import { useBreakdownContext } from "../BreakdownContext";
import { HelpTip } from "../../components/HelpTip";
import styles from "./ReferenceTable.module.css";

type Mode = "terrain" | "objects" | "commands";

/**
 * docs/breakdown-design.md §3.8 — a read-only reference/lookup aid, not
 * filtered to the current selection (spec explicitly calls that a
 * nice-to-have, not required for 3.2). Terrain/Objects come from
 * game-constants.json (constId/deTextureFile mostly null pending Phase
 * 4.0's extraction script — shown as "—"); Commands comes from
 * language.json's commands[], with the verified/unverified chip.
 */
export function ReferenceTable() {
  const { gameConstants, lang } = useBreakdownContext();
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
              {lang.data.commands.map((c) => (
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
      {mode !== "commands" && <p className={styles.note}>IDs/textures pending extraction (Phase 4.0).</p>}
    </div>
  );
}
