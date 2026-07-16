import Editor from "@monaco-editor/react";
import { PlaceholderPane } from "./PlaceholderPane";
import { AOE2_RMS_THEME } from "../editor/aoe2RmsLanguage";
import styles from "./CodePane.module.css";

interface CodePaneProps {
  content: string;
  onChange: (value: string) => void;
  hasFile: boolean;
}

// RMS syntax highlighting via the custom "aoe2-rms" Monarch language
// registered in src/editor/aoe2RmsLanguage.ts (Phase 1.4). The find
// widget (Ctrl+F) and minimap are both on by default; nothing special is
// needed to enable them.
export function CodePane({ content, onChange, hasFile }: CodePaneProps) {
  if (!hasFile) {
    return (
      <PlaceholderPane description="Open an .rms file (File > Open) to see its code here." />
    );
  }

  return (
    <div className={styles.codePane}>
      <Editor
        height="100%"
        width="100%"
        language="aoe2-rms"
        theme={AOE2_RMS_THEME}
        value={content}
        onChange={(value) => onChange(value ?? "")}
        options={{
          minimap: { enabled: true },
          fontSize: 13,
          fontFamily: '"Cascadia Code", Consolas, monospace',
          wordWrap: "off",
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
