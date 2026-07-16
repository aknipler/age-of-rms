import styles from "./PlaceholderPane.module.css";

interface PlaceholderPaneProps {
  description: string;
}

// Stands in for Breakdown/Code/Advanced Tools until each is built out in
// its own phase (see PLAN.md milestones). Deliberately dumb — no state,
// no logic — so it's cheap to delete once the real pane lands.
export function PlaceholderPane({ description }: PlaceholderPaneProps) {
  return (
    <div className={styles.pane}>
      <p className={styles.text}>{description}</p>
    </div>
  );
}
