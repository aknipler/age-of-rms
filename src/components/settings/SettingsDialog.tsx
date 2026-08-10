import { useEffect, useRef, useState } from "react";
import { HelpTip } from "../HelpTip";
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, type SettingsTabId } from "./settingsTabs";
import dialogStyles from "../dialog.module.css";
import styles from "./SettingsDialog.module.css";

interface SettingsDialogProps {
  onClose: () => void;
}

// A simple modal, not a separate window — Tauri windows are heavier to
// set up (own webview, own close-guard) and an overlay + fixed-position
// box is the simpler choice.
//
// The tab strip is vertical rather than a TabBar-style horizontal row:
// six labels don't fit comfortably across a dialog, and a sidebar is what
// makes the list cheap to extend as tabs get real content.
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);
  // Roving tabindex needs to move focus, not just selection, so the
  // buttons are kept by id. A Map in a ref (rather than state) because
  // writing it must not re-render — refs are the escape hatch for values
  // that aren't part of the rendered output.
  const tabRefs = useRef(new Map<SettingsTabId, HTMLButtonElement>());

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Arrow/Home/End movement across the strip, per the ARIA tabs pattern.
  // Selection follows focus, which is the expected behaviour when
  // switching panels is free (nothing here loads or submits).
  function handleTabKeyDown(event: React.KeyboardEvent, index: number) {
    const lastIndex = SETTINGS_TABS.length - 1;
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = index === lastIndex ? 0 : index + 1;
    else if (event.key === "ArrowUp") nextIndex = index === 0 ? lastIndex : index - 1;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = lastIndex;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = SETTINGS_TABS[nextIndex];
    setActiveTab(next.id);
    tabRefs.current.get(next.id)?.focus();
  }

  const active = SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0];
  const ActivePanel = active.Panel;

  return (
    <div className={dialogStyles.overlay} onMouseDown={onClose}>
      <div
        className={`${dialogStyles.dialog} ${styles.settingsDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className={dialogStyles.title} id="settings-dialog-title">
          Settings
        </h2>

        <div className={styles.body}>
          <div className={styles.tabList} role="tablist" aria-orientation="vertical">
            {SETTINGS_TABS.map((tab, index) => (
              <HelpTip key={tab.id} id={tab.helpId}>
                <button
                  type="button"
                  role="tab"
                  id={`settings-tab-${tab.id}`}
                  aria-selected={tab.id === activeTab}
                  aria-controls={`settings-panel-${tab.id}`}
                  // Roving tabindex: only the selected tab is in the tab
                  // order, so Tab moves past the whole strip and the arrow
                  // keys move within it.
                  tabIndex={tab.id === activeTab ? 0 : -1}
                  ref={(element) => {
                    if (element) tabRefs.current.set(tab.id, element);
                    else tabRefs.current.delete(tab.id);
                  }}
                  className={`${styles.tabButton} ${tab.id === activeTab ? styles.tabButtonActive : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              </HelpTip>
            ))}
          </div>

          {/* Keyed by tab id so switching tabs remounts the panel rather
              than reusing the previous one's state — panels are unrelated
              to each other, and a shared mount would leak state between
              them once they hold real controls. */}
          <div
            className={styles.panel}
            role="tabpanel"
            id={`settings-panel-${active.id}`}
            aria-labelledby={`settings-tab-${active.id}`}
            tabIndex={0}
          >
            <ActivePanel key={active.id} />
          </div>
        </div>

        <div className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
