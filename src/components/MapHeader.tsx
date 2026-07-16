import styles from "./MapHeader.module.css";

interface MapHeaderProps {
  mapName: string;
  lastSavedAt: Date | null;
}

// Real values arrive with file open/save in Phase 1.2 — for now this is
// fed static placeholder props from App.
export function MapHeader({ mapName, lastSavedAt }: MapHeaderProps) {
  return (
    <div className={styles.mapHeader}>
      <h1 className={styles.mapName}>{mapName}</h1>
      <span className={styles.lastSaved}>
        Last Saved: {lastSavedAt ? formatTimestamp(lastSavedAt) : "—"}
      </span>
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
