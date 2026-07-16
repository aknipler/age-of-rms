import { HelpTip } from "./HelpTip";
import styles from "./StatusBar.module.css";

// Static placeholder — real resource totals are computed by walking the
// AST in Phase 2.5, once the parser exists.
export function StatusBar() {
  return (
    <div className={styles.statusBar}>
      <HelpTip id="statusBar.total">
        <span>(Total) Food: 0 Wood: 0 Gold: 0 Stone: 0</span>
      </HelpTip>
      <HelpTip id="statusBar.player">
        <span>(Player) F: 0 W: 0 G: 0 S: 0</span>
      </HelpTip>
      <HelpTip id="statusBar.neutral">
        <span>(Neutral) F: 0 W: 0 G: 0 S: 0</span>
      </HelpTip>
    </div>
  );
}
