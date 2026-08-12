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

      {/* Required by the Game Content Usage Rules, which are what let this app
          ship the extracted reference data at all. The rules ask for the notice
          wherever the item is distributed, so it appears here and in NOTICE at
          the repo root. Do not reword the second paragraph, it is Microsoft's
          own template filled in. */}
      <h3 className={styles.panelTitle}>Game data</h3>
      <p className={styles.creditThanks}>
        The terrain and object reference data is derived from Age of Empires II: Definitive
        Edition&apos;s own data files, and the names in it are Microsoft&apos;s. It is included
        under Microsoft&apos;s Game Content Usage Rules and is not covered by this app&apos;s
        GPL-3.0 license, which reaches the code only. See NOTICE in the repository.
      </p>
      <p className={styles.legalNotice}>
        Age of Empires II © Microsoft Corporation. Age of RMS was created under Microsoft&apos;s
        &apos;Game Content Usage Rules&apos; using assets from Age of Empires II, and it is not
        endorsed by or affiliated with Microsoft.
      </p>
    </>
  );
}
