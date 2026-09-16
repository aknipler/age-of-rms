import type { ReactNode } from "react";
import { HelpTip } from "./HelpTip";
import styles from "./MapHeader.module.css";

interface MapHeaderProps {
  mapName: string;
  lastSavedAt: Date | null;
  /** The Breakdown/Code/Advanced Tools tab strip (TabBar), rendered centred
   * in this same row (item 7, UI pass 2026-09-15) instead of on a row of
   * its own, to give the editors below a bit more vertical space. */
  children?: ReactNode;
}

// mapName/lastSavedAt are owned by useDocument and passed down from App.
export function MapHeader({ mapName, lastSavedAt, children }: MapHeaderProps) {
  return (
    <div className={styles.mapHeader}>
      <HelpTip id="mapHeader.mapName">
        <h1 className={styles.mapName}>{mapName}</h1>
      </HelpTip>
      <div className={styles.center}>{children}</div>
      <HelpTip id="mapHeader.lastSaved">
        <span className={styles.lastSaved}>
          Last Saved: {lastSavedAt ? formatTimestamp(lastSavedAt) : "—"}
        </span>
      </HelpTip>
    </div>
  );
}

function formatTimestamp(date: Date): string {
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${time} ${day}/${month}/${year}`;
}
