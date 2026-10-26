import { useCallback, useEffect, useRef, useState } from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import type { TabId } from "../types";

// Same settings.json as the side panel's tab (SidePanelTabContext.tsx), which
// this copies, a different key.
const STORE_FILE = "settings.json";
export const LAST_EDITOR_TAB_KEY = "lastEditorTab";

/** The two editor tabs, the ones a launch may open on. */
export type EditorTabId = Exclude<TabId, "advanced-tools">;

export const DEFAULT_EDITOR_TAB: EditorTabId = "breakdown";

/**
 * Guards the remembered tab on its way out of the Tauri store, since the
 * store file is user-editable. Advanced Tools is left out on purpose. It
 * needs an open file, and the app starts with none, so a launch on it would
 * show an empty tool column.
 */
export function isEditorTab(value: unknown): value is EditorTabId {
  return value === "breakdown" || value === "code";
}

/**
 * App's active tab, starting on whichever of Breakdown or Code was open last.
 * A Code user then never waits on a Breakdown pane, and the Code editor is
 * built once, at launch.
 *
 * The store loads asynchronously, so the first render shows the default
 * tab. With no file open yet that is only the pane's placeholder, so the
 * frame before the saved tab arrives costs nothing.
 */
export function useRememberedTab(): [TabId, (tab: TabId) => void] {
  const [activeTab, setActiveTab] = useState<TabId>(DEFAULT_EDITOR_TAB);
  const [store, setStore] = useState<Store | null>(null);
  // Set once anything picks a tab before the store answers, a click or a
  // tutorial step's navigator. A ref and not state, because the load
  // callback below reads it later, and a state value captured by that
  // closure would still hold its first-render value (a stale closure).
  const pickedBeforeLoadRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    load(STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        const saved = await loadedStore.get<unknown>(LAST_EDITOR_TAB_KEY);
        if (cancelled) return;
        // A choice made during the load wins over the remembered one.
        if (!pickedBeforeLoadRef.current && isEditorTab(saved)) {
          setActiveTab(saved);
        }
        // Only now, after the read. Handing the store over before it would
        // let a render in between write the default over the saved tab.
        setStore(loadedStore);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Written from an effect on the tab rather than inside the setter, so a
  // tab set any way at all is remembered. `store` is null until the load
  // has applied the saved tab, which is what stops the first render's
  // default from overwriting it.
  useEffect(() => {
    if (store !== null && isEditorTab(activeTab)) {
      void store.set(LAST_EDITOR_TAB_KEY, activeTab);
    }
  }, [store, activeTab]);

  // useCallback with no dependencies, so the setter keeps one identity like
  // a plain useState setter does. App's keydown effect lists it as a
  // dependency, and a new function each render would re-subscribe that
  // listener on every keystroke.
  const selectTab = useCallback((tab: TabId) => {
    pickedBeforeLoadRef.current = true;
    setActiveTab(tab);
  }, []);

  return [activeTab, selectTab];
}
