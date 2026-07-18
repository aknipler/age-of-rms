import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { PlaceholderPane } from "./PlaceholderPane";
import { AOE2_RMS_THEME } from "../editor/aoe2RmsLanguage";
import { useRmsDiagnostics } from "../editor/useRmsDiagnostics";
import { diagnosticsToMarkers } from "../editor/diagnosticsToMarkers";
import type { Diagnostic } from "../parser/types";
import type { ResourceTotals } from "../parser/resourceTotals";
import styles from "./CodePane.module.css";

// A stable "owner" id for our diagnostics, so setModelMarkers only ever
// replaces markers this feature added — never Monaco's own built-in
// ones (there aren't any for a custom Monarch language, but this keeps
// the call correct if that ever changes).
const MARKER_OWNER = "aoe2-rms-parser";

interface CodePaneProps {
  content: string;
  onChange: (value: string) => void;
  hasFile: boolean;
  /** From GenerationSettingsContext (Phase 2.5) — scales resource totals
   * for set_place_for_every_player create_object calls. */
  playerCount: number;
  /** Reports the diagnostics actually applied to the editor, so App can
   * feed StatusBar's Problems count without StatusBar needing to know
   * anything about Monaco or the parser worker. */
  onDiagnosticsChange?: (diagnostics: Diagnostic[]) => void;
  /** Reports resource totals for the same parse, same reasoning. */
  onResourceTotalsChange?: (totals: ResourceTotals) => void;
}

// RMS syntax highlighting via the custom "aoe2-rms" Monarch language
// registered in src/editor/aoe2RmsLanguage.ts (Phase 1.4). The find
// widget (Ctrl+F) and minimap are both on by default; nothing special is
// needed to enable them.
//
// Live diagnostics (Phase 2.4): useRmsDiagnostics debounces content
// changes ~150ms and re-parses in a web worker (src/editor/parserWorker.ts)
// so a slow parse of a huge map never blocks typing. Results come back
// as char-offset Diagnostic[]; diagnosticsToMarkers converts those to
// Monaco's line/column IMarkerData using the model's own offset<->position
// conversion, which is what actually draws the squiggles.
export function CodePane({
  content,
  onChange,
  hasFile,
  playerCount,
  onDiagnosticsChange,
  onResourceTotalsChange,
}: CodePaneProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const { source, diagnostics, resourceTotals } = useRmsDiagnostics(content, playerCount);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = editor.getModel();
    if (!model) return;
    // These diagnostics were computed for `source`. If the user kept
    // typing during the debounce/parse round-trip, the model may already
    // be ahead of it — applying markers against a mismatched source
    // would point squiggles at the wrong characters. Skip and wait for
    // the next (matching) result instead of showing something wrong.
    if (model.getValue() !== source) return;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, diagnosticsToMarkers(model, diagnostics));
    onDiagnosticsChange?.(diagnostics);
    onResourceTotalsChange?.(resourceTotals);
  }, [source, diagnostics, resourceTotals, onDiagnosticsChange, onResourceTotalsChange]);

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
        onMount={handleMount}
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
