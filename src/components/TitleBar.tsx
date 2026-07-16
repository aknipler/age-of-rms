import { useState } from "react";
import styles from "./TitleBar.module.css";

// Edit/Preferences/Help are still stubs — no menus wired up yet.
const STATIC_MENUS = ["Edit", "Preferences", "Help"] as const;

interface TitleBarProps {
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
}

export function TitleBar({ onOpen, onSave, onSaveAs }: TitleBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  return (
    <div className={styles.titleBar}>
      <div className={styles.menuWrapper}>
        <button
          type="button"
          className={styles.menuItem}
          onClick={() => setFileMenuOpen((open) => !open)}
          // Closes the menu when focus leaves it (e.g. clicking elsewhere).
          onBlur={() => setFileMenuOpen(false)}
        >
          File
        </button>
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
        <button key={item} type="button" className={styles.menuItem}>
          {item}
        </button>
      ))}
    </div>
  );
}
