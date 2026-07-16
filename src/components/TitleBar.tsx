import { useState } from "react";
import { HelpTip } from "./HelpTip";
import styles from "./TitleBar.module.css";

// Edit/Help are still stubs — no menus wired up yet. Preferences is
// special-cased below since it needs its own onClick.
const STATIC_MENUS = ["Edit", "Help"] as const;

interface TitleBarProps {
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOpenPreferences: () => void;
}

export function TitleBar({ onOpen, onSave, onSaveAs, onOpenPreferences }: TitleBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  return (
    <div className={styles.titleBar}>
      <div className={styles.menuWrapper}>
        <HelpTip id="titleBar.file">
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => setFileMenuOpen((open) => !open)}
            // Closes the menu when focus leaves it (e.g. clicking elsewhere).
            onBlur={() => setFileMenuOpen(false)}
          >
            File
          </button>
        </HelpTip>
        {fileMenuOpen && (
          <div className={styles.dropdown}>
            {/* onMouseDown, not onClick: mousedown fires before the File
                button's onBlur, so the action still runs before the menu
                closes. onClick fires after blur and would be too late. */}
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onOpen();
                setFileMenuOpen(false);
              }}
            >
              Open…
            </button>
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onSave();
                setFileMenuOpen(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className={styles.dropdownItem}
              onMouseDown={() => {
                onSaveAs();
                setFileMenuOpen(false);
              }}
            >
              Save As…
            </button>
          </div>
        )}
      </div>
      {STATIC_MENUS.map((item) => (
        <HelpTip key={item} id={`titleBar.${item.toLowerCase()}`}>
          <button type="button" className={styles.menuItem}>
            {item}
          </button>
        </HelpTip>
      ))}
      <HelpTip id="titleBar.preferences">
        <button type="button" className={styles.menuItem} onClick={onOpenPreferences}>
          Preferences
        </button>
      </HelpTip>
    </div>
  );
}
