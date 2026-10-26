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
  /** True while a tool that merges the two body columns into one (a panel tool) is open. */
  bodyMerged: boolean;
  setBodyMerged: (merged: boolean) => void;
}

const ToolsSlotsContext = createContext<ToolsSlots | null>(null);

export function ToolsSlotsProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HTMLElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [bodyMerged, setBodyMerged] = useState(false);
  return (
    <ToolsSlotsContext.Provider
      value={{
        header,
        body,
        setHeader,
        setBody,
        bodyMerged,
        setBodyMerged,
      }}
    >
      {children}
    </ToolsSlotsContext.Provider>
  );
}

/** The two slot elements, or null for each when no column is mounted. */
export function useToolsSlots(): {
  header: HTMLElement | null;
  body: HTMLElement | null;
  /**
   * Merges the left and right body columns into one that takes the whole row,
   * for a tool with its own full width layout. The title row keeps the tool
   * picker. A no-op without a provider.
   */
  setBodyMerged: (merged: boolean) => void;
} {
  const ctx = useContext(ToolsSlotsContext);
  return {
    header: ctx?.header ?? null,
    body: ctx?.body ?? null,
    setBodyMerged: ctx?.setBodyMerged ?? noop,
  };
}

function noop() {}

/**
 * The left column. Same width as the map panel, same top row height. While the
 * body columns are merged it is only the top row, laid over the left of the
 * title row, so the pane below can take the whole width.
 */
export function ToolsSideColumn() {
  const ctx = useContext(ToolsSlotsContext);
  const { width } = useSidePanelLayout();
  if (!ctx) return null;
  return (
    <div
      className={
        ctx.bodyMerged
          ? `${styles.column} ${styles.columnMerged}`
          : styles.column
      }
      style={{ width }}
    >
      <div className={styles.topRow} ref={ctx.setHeader} />
      {/* Gone while merged. ToolsPane renders nothing into it then, and the
          callback ref hands the slot back when the body returns. */}
      {!ctx.bodyMerged && <div className={styles.body} ref={ctx.setBody} />}
    </div>
  );
}

/**
 * Wraps the map header on the Advanced Tools tab. While the body columns are
 * merged the left column is a strip laid over the header's left end instead of
 * a column beside it, so the header steps right by the column's width and the
 * title row still reads as one band.
 */
export function ToolsHeaderSlot({ children }: { children: ReactNode }) {
  const ctx = useContext(ToolsSlotsContext);
  const { width } = useSidePanelLayout();
  return (
    <div
      className={styles.headerSlot}
      style={
        ctx?.bodyMerged ? { paddingLeft: `min(${width}px, 70%)` } : undefined
      }
    >
      {children}
    </div>
  );
}
