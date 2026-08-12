import styles from "./SettingsDialog.module.css";

// Static text, no controls — the only settings tab with nothing to set. It
// lives here rather than in a Help > About dialog because the tab strip
// already exists and a second modal would be a whole window's worth of
// chrome for two paragraphs.
export function CreditsSettings() {
  return (
    <>
      <h3 className={styles.panelTitle}>Credits</h3>
      <p className={styles.creditRow}>
        <span className={styles.creditLabel}>Maintainer</span>
        Captain Kniples the Fourth
      </p>
      <p className={styles.creditThanks}>
        A big thank you to Zetnus for allowing use of his guide and Terrain / Object reference
        sheets, and to his contributions to the RMS community in general.
      </p>
    </>
  );
}
