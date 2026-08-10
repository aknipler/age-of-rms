import styles from "./SettingsDialog.module.css";

interface SettingsPlaceholderProps {
  title: string;
  /** One sentence on what this tab is for, so an empty tab still explains itself. */
  description: string;
  /** Settings this tab is expected to grow, listed so the intent is visible before the controls exist. */
  planned?: ReadonlyArray<string>;
}

// Every unbuilt settings tab renders through this rather than each
// placeholder file hand-rolling its own markup — same reasoning as
// PlaceholderPane, and it keeps the five of them to a few lines each so
// they're cheap to replace with real controls one at a time.
export function SettingsPlaceholder({ title, description, planned }: SettingsPlaceholderProps) {
  return (
    <>
      <h3 className={styles.panelTitle}>{title}</h3>
      <p className={styles.placeholder}>{description}</p>
      {planned && (
        <ul className={styles.placeholderList}>
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </>
  );
}
