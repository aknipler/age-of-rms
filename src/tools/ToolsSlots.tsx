import { createContext, useContext, useState, type ReactNode } from "react";
import { useSidePanelLayout } from "../components/sidepanel/SidePanelLayoutContext";
import styles from "./ToolsSlots.module.css";

// The Advanced Tools tab reuses the map panel's place on the left, so the
// title row reads as one band with a column under its left half. The tool
// picker, Run button, description and parameters live in that column, and
// the output fills the main area.
//
// ToolsPane owns all the state those controls read and write, but the column
// has to sit beside the map header, outside the pane. React portals bridge
// that: App renders the empty column with two slots, and ToolsPane renders
// its controls into them with createPortal. State stays in ToolsPane, only
// the DOM position moves. The slot elements are state (a callback ref
// stored with useState), not useRef, so ToolsPane re-renders once they
// mount and the portal target is never null when it is first used.
//
// Without a provider (a test that renders ToolsPane alone) the slots are
// null and ToolsPane lays its controls out inline as before.

interface ToolsSlots {
  header: HTMLElement | null;
  body: HTMLElement | null;
  setHeader: (el: HTMLElement | null) => void;
  setBody: (el: HTMLElement | null) => void;
}

const ToolsSlotsContext = createContext<ToolsSlots | null>(null);

export function ToolsSlotsProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  return (
    <ToolsSlotsContext.Provider value={{ header, body, setHeader, setBody }}>
      {children}
    </ToolsSlotsContext.Provider>
  );
}

/** The two slot elements, or null for each when no column is mounted. */
export function useToolsSlots(): {
  header: HTMLElement | null;
  body: HTMLElement | null;
} {
  const ctx = useContext(ToolsSlotsContext);
  return { header: ctx?.header ?? null, body: ctx?.body ?? null };
}

/** The empty left column. Same width as the map panel, same top row height. */
export function ToolsSideColumn() {
  const ctx = useContext(ToolsSlotsContext);
  const { width } = useSidePanelLayout();
  if (!ctx) return null;
  return (
    <div className={styles.column} style={{ width }}>
      <div className={styles.topRow} ref={ctx.setHeader} />
      <div className={styles.body} ref={ctx.setBody} />
    </div>
  );
}
