import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";
import { useAppSettings } from "../../settings/AppSettingsContext";
import {
  checkInstallFolder,
  findDeInstallFolder,
  type FolderProbe,
} from "../../settings/scriptFolder";
import { HelpTip } from "../HelpTip";
import dialogStyles from "../dialog.module.css";
import styles from "./SettingsDialog.module.css";

const PROBE: FolderProbe = { exists, readTextFile };

/** What the line under the field says. `checking` while a probe runs. */
type Status =
  | { kind: "checking" }
  | { kind: "found"; folder: string; automatic: boolean }
  | { kind: "missing"; automatic: boolean };

/**
 * Settings > General's AoE2 install folder, for a Microsoft Store, Game Pass
 * or other install the automatic search does not reach.
 *
 * The field keeps a local draft and commits it on blur or Enter, rather than
 * writing the setting on every keystroke as the author name does. Each commit
 * drops the include, texture and sprite caches and reads the disk again, and
 * doing that for every letter of a typed path would read half-typed folders.
 */
export function InstallFolderSetting() {
  const { installFolder, setInstallFolder } = useAppSettings();
  const [draft, setDraft] = useState(installFolder);
  const [status, setStatus] = useState<Status>({ kind: "checking" });

  // The saved value arrives after the store loads, after this mounted with
  // "", so the draft follows the setting whenever the setting changes.
  useEffect(() => setDraft(installFolder), [installFolder]);

  useEffect(() => {
    // The stale flag stops a slow drive search from overwriting the answer
    // for a folder chosen after it started.
    let stale = false;
    setStatus({ kind: "checking" });
    const automatic = installFolder.trim() === "";
    const check = automatic
      ? findDeInstallFolder(PROBE)
      : checkInstallFolder(PROBE, installFolder);
    void check
      .catch(() => null)
      .then((folder) => {
        if (stale) return;
        setStatus(
          folder === null
            ? { kind: "missing", automatic }
            : { kind: "found", folder, automatic },
        );
      });
    return () => {
      stale = true;
    };
  }, [installFolder]);

  const commit = (next: string) => {
    if (next.trim() !== installFolder.trim()) setInstallFolder(next);
  };

  const browse = async () => {
    const picked = await open({
      directory: true,
      defaultPath: draft.trim() || undefined,
      title: "AoE2 DE install folder",
    });
    if (typeof picked === "string") {
      setDraft(picked);
      commit(picked);
    }
  };

  return (
    <HelpTip id="settings.installFolder">
      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Game install</legend>
        <div className={dialogStyles.optionRow}>
          <label htmlFor="install-folder">AoE2 DE folder</label>
          <input
            type="text"
            id="install-folder"
            className={styles.textInput}
            value={draft}
            placeholder="Search automatically"
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => commit(draft)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit(draft);
            }}
          />
          <button
            type="button"
            className={dialogStyles.closeButton}
            onClick={() => void browse()}
          >
            Browse
          </button>
        </div>
        <p className={styles.hint}>{statusText(status)}</p>
      </fieldset>
    </HelpTip>
  );
}

function statusText(status: Status): string {
  switch (status.kind) {
    case "checking":
      return "Looking for the game";
    case "found":
      return status.automatic
        ? `Found automatically in ${status.folder}`
        : `Using ${status.folder}`;
    case "missing":
      return status.automatic
        ? "No install found. Choose the folder the game is in."
        : "No AoE2 DE install in this folder. Choose the folder with resources in it.";
  }
}
