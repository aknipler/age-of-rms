import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { PlaceholderPane } from "./PlaceholderPane";
import { AOE2_RMS_THEME } from "../editor/aoe2RmsLanguage";
import { diagnosticsToMarkers } from "../editor/diagnosticsToMarkers";
import { DOCUMENT_MODEL_PATH, getDocumentModel } from "../hooks/useDocument";
import type { Diagnostic, Item } from "../parser/types";
import styles from "./CodePane.module.css";

// A stable "owner" id for our diagnostics, so setModelMarkers only ever
// replaces markers this feature added — never Monaco's own built-in
// ones (there aren't any for a custom Monarch language, but this keeps
// the call correct if that ever changes).
const MARKER_OWNER = "aoe2-rms-parser";

interface CodePaneProps {
  hasFile: boolean;
  /**
   * Live diagnostics + the exact source they were computed for, from
   * AppContent's single useParsedDocument() instance (docs/breakdown-design.md
   * §6.2 — "one parse, in the worker", CodePane no longer owns the parse
   * itself as of the Breakdown 3.2 lift).
   */
  source: string;
  diagnostics: Diagnostic[];
  /**
   * Ash's post-3.9 cross-tab-sync follow-up: the Item the shared selection
   * anchor currently resolves to (from App's useSharedSelection), used
   * ONLY at mount time to select+reveal that range — this is "switching
   * to Code shows that section of code, selected, in the middle of the
   * page." Deliberately not re-applied on every prop change: once the
   * editor is up, the user's own cursor movement (onCursorOffsetChange,
   * below) is what should be driving the anchor, not this pane
   * re-asserting itself over their navigation.
   */
  selectedItem?: Item;
  /**
   * Fires on every cursor/selection move while this pane is mounted, so
   * the shared anchor always reflects "where the user is looking" in the
   * Code tab — that's what lets switching back to Breakdown resolve to
   * the right card, per Ash's "cursor / selection is maintained" ask.
   */
  onCursorOffsetChange?: (offset: number) => void;
}

// RMS syntax highlighting via the custom "aoe2-rms" Monarch language
// registered in src/editor/aoe2RmsLanguage.ts (Phase 1.4). The find
// widget (Ctrl+F) and minimap are both on by default; nothing special is
// needed to enable them.
//
// Live diagnostics (Phase 2.4, lifted to app level in 3.2): diagnostics
// and their source come in as props from AppContent's useParsedDocument
// hook (src/useParsedDocument.ts), which debounces content changes
// ~150ms and re-parses in a web worker so a slow parse of a huge map
// never blocks typing. Results are char-offset Diagnostic[];
// diagnosticsToMarkers converts those to Monaco's line/column
// IMarkerData using the model's own offset<->position conversion, which
// is what actually draws the squiggles.
//
// §6.4 migration (3.4): this editor no longer owns/controls its content
// via a `value` prop. It attaches to the single persistent Monaco
// ITextModel created in src/hooks/useDocument.ts (`path={DOCUMENT_MODEL_PATH}`
// + `keepCurrentModel` so unmounting the Code tab never disposes it).
// Typing writes directly into that model; Breakdown edits
// (src/breakdown/applyEdit.ts) push onto the SAME model via
// pushEditOperations, so both share Monaco's own undo/redo stack. React
// state (`doc.content` in useDocument) is a read-only mirror derived from
// the model's onDidChangeContent — CodePane doesn't need it at all
// anymore, hence no `content`/`onChange` props here.
export function CodePane({ hasFile, source, diagnostics, selectedItem, onCursorOffsetChange }: CodePaneProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  // Read inside a mount-only listener (handleMount runs once per mount) —
  // mirrored into a ref so that listener always calls the LATEST callback
  // rather than whichever one was passed in at mount time (same stale-
  // closure concern useDocument.ts's isDirtyRef/filePathRef solve).
  const onCursorOffsetChangeRef = useRef(onCursorOffsetChange);
  onCursorOffsetChangeRef.current = onCursorOffsetChange;
  const cursorSubscriptionRef = useRef<Monaco.IDisposable | null>(null);

  // Extracted so it can run from two places: the effect below (fires on
  // every new source/diagnostics while mounted, e.g. typing) AND
  // handleMount (fires once, right when the editor/monaco refs first
  // become available). Both are needed — see the mount-race note below.
  const applyMarkers = useCallback((currentSource: string, currentDiagnostics: Diagnostic[]) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const model = getDocumentModel();
    // These diagnostics were computed for `source`. If the user kept
    // typing during the debounce/parse round-trip, the model may already
    // be ahead of it — applying markers against a mismatched source
    // would point squiggles at the wrong characters. Skip and wait for
    // the next (matching) result instead of showing something wrong.
    if (model.getValue() !== currentSource) return;
    monaco.editor.setModelMarkers(model, MARKER_OWNER, diagnosticsToMarkers(model, currentDiagnostics));
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Belt-and-suspenders: @monaco-editor/react's `path` + `keepCurrentModel`
    // props already resolve to the shared model (see useDocument.ts's
    // header comment on why there's no async race), but making it
    // explicit here means a future prop-wiring mistake fails obviously
    // (wrong content shown) rather than silently diverging.
    if (editor.getModel() !== getDocumentModel()) {
      editor.setModel(getDocumentModel());
    }
    // Mount-race fix: markers are keyed to the MODEL (setModelMarkers),
    // and the model persists across tab switches (keepCurrentModel) — but
    // editorRef/monacoRef reset to null on every remount, since CodePane
    // fully unmounts when the Code tab isn't active. The effect below
    // depends on [source, diagnostics], which normally re-fires it after
    // any edit — but if the parse already completed WHILE the Code tab
    // was unmounted (e.g. a Breakdown edit, or Ctrl+Z/Y from the
    // Breakdown tab), `source`/`diagnostics` are already current at
    // mount time and never change again afterward, so that effect's one
    // and only run happens before these refs are set (guard bails out)
    // and is never retried. The model kept showing whichever markers
    // were set the *previous* time this editor was mounted — stale,
    // pointing at pre-edit diagnostics. Applying markers directly here,
    // once refs are actually ready, closes that gap.
    applyMarkers(source, diagnostics);

    // Cross-tab sync, incoming half (Breakdown -> Code): a card was
    // selected before the user switched here, so land the caret there,
    // select the whole span, and scroll it to the middle of the viewport
    // — "switching to Code should have that section of code in the
    // middle of the page, text selected." Uses the model directly rather
    // than `source` (a prop, possibly one debounce cycle behind) since
    // the model IS the authoritative current text (§6.4).
    if (selectedItem) {
      const model = getDocumentModel();
      const startPos = model.getPositionAt(selectedItem.span.start);
      const endPos = model.getPositionAt(selectedItem.span.end);
      const range = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
      editor.setSelection(range);
      editor.revealRangeInCenter(range);
    }

    // Cross-tab sync, outgoing half (Code -> Breakdown): keep the shared
    // anchor pointed at wherever the user's cursor/selection currently is
    // in this editor, continuously, so switching to Breakdown later
    // resolves to the right card without needing a separate "commit"
    // action. Uses the selection's own active position (where the caret
    // actually sits, whichever end of a drag-selection that is) rather
    // than always the start, matching how a real cursor position reads.
    cursorSubscriptionRef.current?.dispose();
    cursorSubscriptionRef.current = editor.onDidChangeCursorSelection((e) => {
      const offset = getDocumentModel().getOffsetAt(e.selection.getPosition());
      onCursorOffsetChangeRef.current?.(offset);
    });
  };

  useEffect(() => {
    applyMarkers(source, diagnostics);
  }, [source, diagnostics, applyMarkers]);

  // Dispose the cursor-tracking subscription on unmount — the editor
  // instance itself is torn down by @monaco-editor/react when the Code
  // tab isn't active, which would dispose this anyway, but explicit
  // disposal matches this codebase's standing convention (see
  // useDocument.ts's onDidChangeContent subscription) rather than relying
  // on that implicitly.
  useEffect(() => {
    return () => {
      cursorSubscriptionRef.current?.dispose();
      cursorSubscriptionRef.current = null;
    };
  }, []);

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
        path={DOCUMENT_MODEL_PATH}
        keepCurrentModel
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
