import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { HelpTip } from "./HelpTip";
import { useTutorial } from "../tutorial/TutorialContext";
import { getTutorial, latestFeatureTour } from "../tutorial/registry";
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
// every handler has to remember to maintain.
type OpenMenu = "file" | "edit" | "help";

interface TitleBarProps {
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  /** Undo/Redo act on the shared document model directly (see App.tsx), so unlike Cut/Copy/Paste/Find they need no live editor to run against. */
  onUndo: () => void;
  onRedo: () => void;
  /** Cut/Copy/Paste/Select All/Find/Find and Replace/Toggle Comment/Toggle Layout all run against the live Code-tab editor; App.tsx switches to it and queues the action if it isn't mounted yet. */
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onFind: () => void;
  onFindReplace: () => void;
  onToggleComment: () => void;
  /** The Code tab's own "toggle command layout" hotkey (formatToggle.ts), offered here too so it isn't Code-tab-only. */
  onToggleLayout: () => void;
  onOpenSettings: () => void;
  /** Current display form of each shortcut (e.g. "Ctrl+N"), shown beside its menu item, Settings > Hotkeys is where they're changed. */
  newHotkeyLabel: string;
  openHotkeyLabel: string;
  saveHotkeyLabel: string;
  saveAsHotkeyLabel: string;
  /** Unlike the Cut/Copy/Paste/Find group's fixed OS-standard bindings, this one is rebindable (Settings > Hotkeys), so its hint has to come from there rather than being hardcoded like the others. */
  toggleLayoutHotkeyLabel: string;
}

export function TitleBar({
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
  onFind,
  onFindReplace,
  onToggleComment,
  onToggleLayout,
  onOpenSettings,
  newHotkeyLabel,
  openHotkeyLabel,
  saveHotkeyLabel,
  saveAsHotkeyLabel,
  toggleLayoutHotkeyLabel,
}: TitleBarProps) {
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);
  // Sec.6, TitleBar calls useTutorial() directly rather than taking new
  // props, the same reasoning App.tsx already records for
  // HelpTip/SettingsDialog calling useHelpSettings() themselves.
  const { start } = useTutorial();
  const rmsBasics = getTutorial("rms-basics");
  const appTour = getTutorial("app-tour");
  const whatsNew = latestFeatureTour();

  // Clicking the open menu's own button closes it; clicking a different one
  // switches straight to it.
  function toggleMenu(menu: OpenMenu) {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  function openGuide() {
    // openUrl rejects when the OS has no handler for the URL. There is no
    // notification surface in the app yet, so the rejection is logged rather
    // than left floating, an unhandled rejection is invisible in a release
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
          <div className={styles.dropdown} data-help-flyout>
            {/* data-help-flyout: lets a HelpTip on any item in here (see
                HelpTip.tsx) open beside this whole pane instead of below the
                one item, which would land on top of the item under it. */}
            {/* onMouseDown, not onClick: mousedown fires before the File
                button's onBlur, so the action still runs before the menu
                closes. onClick fires after blur and would be too late. */}
            <HelpTip id="titleBar.file.new">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onNew();
                  setOpenMenu(null);
                }}
              >
                New
                <span className={styles.hotkeyHint}>{newHotkeyLabel}</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.file.open">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onOpen();
                  setOpenMenu(null);
                }}
              >
                Open…
                <span className={styles.hotkeyHint}>{openHotkeyLabel}</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.file.save">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onSave();
                  setOpenMenu(null);
                }}
              >
                Save
                <span className={styles.hotkeyHint}>{saveHotkeyLabel}</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.file.saveAs">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onSaveAs();
                  setOpenMenu(null);
                }}
              >
                Save As…
                <span className={styles.hotkeyHint}>{saveAsHotkeyLabel}</span>
              </button>
            </HelpTip>
          </div>
        )}
      </div>
      <div className={styles.menuWrapper}>
        <HelpTip id="titleBar.edit">
          <button
            type="button"
            className={styles.menuItem}
            onClick={() => toggleMenu("edit")}
            onBlur={() => setOpenMenu(null)}
          >
            Edit
          </button>
        </HelpTip>
        {openMenu === "edit" && (
          <div className={styles.dropdown} data-help-flyout>
            {/* data-help-flyout: lets a HelpTip on any item in here (see
                HelpTip.tsx) open beside this whole pane instead of below the
                one item, which would land on top of the item under it. */}
            {/* onMouseDown for the same reason File's items use it: it fires
                before the Edit button's onBlur closes the menu. */}
            <HelpTip id="titleBar.edit.undo">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onUndo();
                  setOpenMenu(null);
                }}
              >
                Undo
                <span className={styles.hotkeyHint}>Ctrl+Z</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.redo">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onRedo();
                  setOpenMenu(null);
                }}
              >
                Redo
                <span className={styles.hotkeyHint}>Ctrl+Y</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.cut">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onCut();
                  setOpenMenu(null);
                }}
              >
                Cut
                <span className={styles.hotkeyHint}>Ctrl+X</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.copy">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onCopy();
                  setOpenMenu(null);
                }}
              >
                Copy
                <span className={styles.hotkeyHint}>Ctrl+C</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.paste">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onPaste();
                  setOpenMenu(null);
                }}
              >
                Paste
                <span className={styles.hotkeyHint}>Ctrl+V</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.selectAll">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onSelectAll();
                  setOpenMenu(null);
                }}
              >
                Select All
                <span className={styles.hotkeyHint}>Ctrl+A</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.find">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onFind();
                  setOpenMenu(null);
                }}
              >
                Find
                <span className={styles.hotkeyHint}>Ctrl+F</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.findReplace">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onFindReplace();
                  setOpenMenu(null);
                }}
              >
                Find and Replace
                <span className={styles.hotkeyHint}>Ctrl+H</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.toggleComment">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onToggleComment();
                  setOpenMenu(null);
                }}
              >
                Toggle Comment
                <span className={styles.hotkeyHint}>Ctrl+/</span>
              </button>
            </HelpTip>
            <HelpTip id="titleBar.edit.toggleLayout">
              <button
                type="button"
                className={styles.dropdownItem}
                onMouseDown={() => {
                  onToggleLayout();
                  setOpenMenu(null);
                }}
              >
                Toggle Command Layout
                <span className={styles.hotkeyHint}>{toggleLayoutHotkeyLabel}</span>
              </button>
            </HelpTip>
          </div>
        )}
      </div>
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
          <div className={styles.dropdown} data-help-flyout>
            {/* data-help-flyout: lets a HelpTip on any item in here (see
                HelpTip.tsx) open beside this whole pane instead of below the
                one item, which would land on top of the item under it. */}
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
            {/* Sec.6, starting a tutorial from the menu always begins at
                step 1, whether or not it's been completed before (the
                recovery path for someone who clicked out by accident), so
                this is never gated on `completed`. */}
            {rmsBasics && (
              <HelpTip id="titleBar.help.tutorialRms">
                <button
                  type="button"
                  className={styles.dropdownItem}
                  onMouseDown={() => {
                    start(rmsBasics.id);
                    setOpenMenu(null);
                  }}
                >
                  Tutorial: {rmsBasics.title}
                </button>
              </HelpTip>
            )}
            {appTour && (
              <HelpTip id="titleBar.help.tutorialApp">
                <button
                  type="button"
                  className={styles.dropdownItem}
                  onMouseDown={() => {
                    start(appTour.id);
                    setOpenMenu(null);
                  }}
                >
                  Tutorial: {appTour.title}
                </button>
              </HelpTip>
            )}
            {/* Omitted rather than rendered dead when the registry holds no
                feature tour at all (Sec.6). */}
            {whatsNew && (
              <HelpTip id="titleBar.help.whatsNew">
                <button
                  type="button"
                  className={styles.dropdownItem}
                  onMouseDown={() => {
                    start(whatsNew.id);
                    setOpenMenu(null);
                  }}
                >
                  What's new
                </button>
              </HelpTip>
            )}
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
