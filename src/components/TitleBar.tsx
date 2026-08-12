import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HelpTip } from "./HelpTip";
import styles from "./TitleBar.module.css";

// Zetnus's DE RMS guide, hosted as a Google Doc. It opens in the user's own
// browser rather than in a webview of ours: a Tauri window has no address
// bar, no back button and none of their Google session, so an external doc
// this long is worse inside the app than outside it.
const DE_RMS_GUIDE_URL =
  "https://docs.google.com/document/d/1jnhZXoeL9mkRUJxcGlKnO98fIwFKStP_OBozpr0CHXo/edit?tab=t.0";

// Which top-level menu is currently dropped down. A union of the menu names
// rather than one boolean each: two booleans can both be true, and "at most
// one menu is open" is a rule worth making unrepresentable rather than one
// every handler has to remember to maintain. Edit is not in here because it
// is still a stub with nothing to drop down.
type OpenMenu = "file" | "help";

interface TitleBarProps {
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenSettings: () => void;
}

export function TitleBar({ onOpen, onSave, onSaveAs, onOpenSettings }: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

  // Clicking the open menu's own button closes it; clicking a different one
  // switches straight to it.
  function toggleMenu(menu: OpenMenu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function openGuide() {
    // openUrl rejects when the OS has no handler for the URL. There is no
    // notification surface in the app yet, so the rejection is logged rather
    // than left floating — an unhandled rejection is invisible in a release
    // build, and "the menu item did nothing" is the symptom that would reach
    // a bug report.
    openUrl(DE_RMS_GUIDE_URL).catch((error: unknown) => {
      console.error("Failed to open the DE RMS guide", error);
    });
  }

  return (
    <div className={styles.titleBar}>
      <div className={styles.menuWrapper}>
        <HelpTip id="titleBar.file">
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => toggleMenu("file")}
            // Closes the menu when focus leaves it (e.g. clicking elsewhere).
            onBlur={() => setOpenMenu(null)}
          >
            File
          </button>
        </HelpTip>
        {openMenu === "file" && (
          <div className={styles.dropdown}>
            {/* onMouseDown, not onClick: mousedown fires before the File
                button's onBlur, so the action still runs before the menu
                closes. onClick fires after blur and would be too late. */}
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onOpen();
                setOpenMenu(null);
              }}
            >
              Open…
            </button>
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onSave();
                setOpenMenu(null);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onSaveAs();
                setOpenMenu(null);
              }}
            >
              Save As…
            </button>
          </div>
        )}
      </div>
      {/* Edit is still a stub — no menu to drop down yet. */}
      <HelpTip id="titleBar.edit">
        <button type="button" className={styles.menuItem}>
          Edit
        </button>
      </HelpTip>
      <div className={styles.menuWrapper}>
        <HelpTip id="titleBar.help">
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => toggleMenu("help")}
            onBlur={() => setOpenMenu(null)}
          >
            Help
          </button>
        </HelpTip>
        {openMenu === "help" && (
          <div className={styles.dropdown}>
            {/* onMouseDown for the same reason the File items use it: it
                fires before the Help button's onBlur closes the menu. */}
            <HelpTip id="titleBar.help.deRmsGuide">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  openGuide();
                  setOpenMenu(null);
                }}
              >
                DE RMS Guide
              </button>
            </HelpTip>
          </div>
        )}
      </div>
      <HelpTip id="titleBar.settings">
        <button type="button" className={styles.menuItem} onClick={onOpenSettings}>
          Settings
        </button>
      </HelpTip>
    </div>
  );
}
