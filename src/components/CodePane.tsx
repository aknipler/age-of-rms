import { PlaceholderPane } from "./PlaceholderPane";
import styles from "./CodePane.module.css";

interface CodePaneProps {
  content: string;
  onChange: (value: string) => void;
  hasFile: boolean;
}

// Temporary stand-in for Monaco (arrives in Phase 1.3): a plain textarea
// bound to the exact same content/onChange contract the real editor will
// use, so Open/Save/dirty-tracking are already fully testable now instead
// of waiting on the editor integration.
export function CodePane({ content, onChange, hasFile }: CodePaneProps) {
  if (!hasFile) {
    return (
      <PlaceholderPane description="Open an .rms file (File > Open) to see its code here. Full Monaco editor arrives in Phase 1.3." />
    );
  }

  return (
    <div className={styles.codePane}>
      <textarea
        className={styles.textarea}
        value={content}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
      />
    </div>
  );
}
