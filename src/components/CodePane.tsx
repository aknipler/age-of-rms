import { useCallback, useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { PlaceholderPane } from "./PlaceholderPane";
import {
  AOE2_RMS_MONACO_THEME,
  defineAoe2RmsMonacoTheme,
} from "../editor/monacoTheme";
import { diagnosticsToMarkers } from "../editor/diagnosticsToMarkers";
import { toggleCommandLayoutInRange } from "../editor/formatToggle";
import { DOCUMENT_MODEL_PATH, getDocumentModel } from "../hooks/useDocument";
import { usePreviewCut } from "../PreviewCutContext";
import { usePreviewView } from "./preview/PreviewViewContext";
import { useHotkeySettings } from "../settings/HotkeySettingsContext";
import { cycleDirection, matchesHotkey } from "../settings/hotkeys";
import { isSidePanelKeyEvent } from "../settings/focusRegion";
import { sectionJumpTop } from "../editor/sectionJump";
import { useThemeSettings } from "../settings/ThemeSettingsContext";
import { useCodeSettings } from "../settings/CodeSettingsContext";
import {
  useCurrentFilePath,
  useDiagnosticDismissal,
} from "../settings/DiagnosticDismissalContext";
import { setDiagnosticActionHandlers } from "../editor/diagnosticActions";
import {
  setNameLookupParse,
  wordResolvesToConst,
} from "../editor/aoe2RmsCompletion";
import { attachResolveFlash } from "../editor/resolveFlash";
import { setCodePredictionEnabled } from "../editor/aoe2RmsPrediction";
import { setConstActionHandlers } from "../editor/constActions";
import { useAppSettings } from "../settings/AppSettingsContext";
import type { Diagnostic, Item, ParseResult } from "../parser/types";
import styles from "./CodePane.module.css";
import {
  PERF_TRACE,
  perfAfterPaint,
  perfFirstTokens,
  perfLog,
  perfLogSinceOpen,
  perfTime,
} from "../perfTrace";

// A stable "owner" id for our diagnostics, so setModelMarkers only ever
// replaces markers this feature added, never Monaco's own built-in
// ones (there aren't any for a custom Monarch language, but this keeps
// the call correct if that ever changes).
const MARKER_OWNER = "aoe2-rms-parser";

// Module-scope, same pattern as useDocument.ts's `documentModel`: there is
// at most one mounted editor instance at a time (CodePane fully unmounts
// with the Code tab), so a plain module variable is enough for the Edit
// menu (TitleBar.tsx, wired through App.tsx) to reach the live instance
// without threading a ref down through props it otherwise has no reason to
// need. Unlike the shared model, this does NOT survive a Code-tab unmount,
// undo/redo don't need it (they act on the model directly), only
// cut/copy/paste/find do, since those are editor actions tied to a live
// selection/focus rather than to the model's own state.
let activeEditor: Monaco.editor.IStandaloneCodeEditor | null = null;

/** The live Monaco editor instance, or `null` while the Code tab isn't mounted. */
export function getActiveCodeEditor(): Monaco.editor.IStandaloneCodeEditor | null {
  return activeEditor;
}

// Same reasoning as `activeEditor` above, for the Code tab's own "toggle
// command layout" hotkey (formatToggle.ts, default Ctrl+Alt+F) so the Edit
// menu can offer it too. It's app logic rather than a Monaco action id
// (editMenuActions.ts's ACTION_IDS doesn't cover it), needs parseResult and
// applyTextEdits, and both change on every edit, so this holds a STABLE
// wrapper set once at mount, not the logic itself, see runToggleLayoutRef
// below for where the current parseResult/applyTextEdits are actually read.
let toggleLayoutRunner: (() => void) | null = null;

/** Runs the toggle-command-layout action at the current selection, or `null` while the Code tab isn't mounted. */
export function getActiveToggleLayoutRunner(): (() => void) | null {
  return toggleLayoutRunner;
}

interface CodePaneProps {
  hasFile: boolean;
  /**
   * Live diagnostics + the exact source they were computed for, from
   * AppContent's single useParsedDocument() instance (docs/breakdown-design.md
   * Sec.6.2, "one parse, in the worker", CodePane no longer owns the parse
   * itself as of the Breakdown 3.2 lift).
   */
  source: string;
  diagnostics: Diagnostic[];
  /**
   * The same parse `diagnostics` came from, needed only by
   * `codeToggleLayout` below, to resolve the command(s) under the cursor/
   * selection. `null` during the brief window before the first parse lands.
   */
  parseResult: ParseResult | null;
  /**
   * The N-edit form (docs/tools-api-design.md Sec.4.5), same function
   * Advanced Tools' Apply button uses; one `pushEditOperations` call, one
   * undo entry, however many commands `codeToggleLayout` touched at once.
   */
  applyTextEdits: (
    edits: readonly { start: number; end: number; newText: string }[],
  ) => void;
  /**
   * Cross-tab-sync follow-up: the Item the shared selection
   * anchor currently resolves to (from App's useSharedSelection), used
   * ONLY at mount time to select+reveal that range. This is "switching
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
   * Code tab. That's what lets switching back to Breakdown resolve to
   * the right card so that cursor / selection is maintained.
   */
  onCursorOffsetChange?: (offset: number) => void;
  /**
   * Fires once, right after the editor instance is ready (end of
   * `handleMount`). Lets App.tsx run an Edit-menu action (Cut/Copy/Paste/
   * Find) that was requested while the Code tab wasn't mounted yet: it
   * switches to this tab and queues the action, this is what lets the
   * queued action fire the moment there's an editor to run it on, instead
   * of silently doing nothing.
   */
  onEditorReady?: () => void;
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
// Sec.6.4 migration (3.4): this editor no longer owns/controls its content
// via a `value` prop. It attaches to the single persistent Monaco
// ITextModel created in src/hooks/useDocument.ts (`path={DOCUMENT_MODEL_PATH}`
// + `keepCurrentModel` so unmounting the Code tab never disposes it).
// Typing writes directly into that model; Breakdown edits
// (src/breakdown/applyEdit.ts) push onto the SAME model via
// pushEditOperations, so both share Monaco's own undo/redo stack. React
// state (`doc.content` in useDocument) is a read-only mirror derived from
// the model's onDidChangeContent. CodePane doesn't need it at all
// anymore, hence no `content`/`onChange` props here.
export function CodePane({
  hasFile,
  source,
  diagnostics,
  parseResult,
  applyTextEdits,
  selectedItem,
  onCursorOffsetChange,
  onEditorReady,
}: CodePaneProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  // A ref's initial value is only used on the first render, so this holds
  // when this CodePane instance first rendered (src/perfTrace.ts reads it).
  const firstRenderAtRef = useRef(performance.now());
  // Read inside a mount-only listener (handleMount runs once per mount),
  // mirrored into a ref so that listener always calls the LATEST callback
  // rather than whichever one was passed in at mount time (same stale-
  // closure concern useDocument.ts's isDirtyRef/filePathRef solve).
  const onCursorOffsetChangeRef = useRef(onCursorOffsetChange);
  onCursorOffsetChangeRef.current = onCursorOffsetChange;
  const cursorSubscriptionRef = useRef<Monaco.IDisposable | null>(null);
  // The resolve flash (name-lookup-design.md Sec.6) lives as long as the
  // editor does, so its handle is a ref disposed on unmount. The setting is
  // mirrored into a ref because the flash reads it from a listener set up
  // once at mount, the same stale closure concern as the ref above.
  const resolveFlashRef = useRef<Monaco.IDisposable | null>(null);
  const { resolveFlash, codePrediction } = useAppSettings();
  const resolveFlashOnRef = useRef(resolveFlash);
  resolveFlashOnRef.current = resolveFlash;
  // Line and block prediction (Sec.13) is a provider registered once for
  // the app, so the setting reaches it through a module variable rather
  // than a ref here. An effect, not a write during render, because it
  // changes state outside React.
  useEffect(() => {
    setCodePredictionEnabled(codePrediction);
  }, [codePrediction]);

  // Same ref-mirrors-latest-props pattern as onCursorOffsetChangeRef above,
  // and for the same reason: this can run long after the render that
  // created it (from the Edit-menu wrapper stored in `toggleLayoutRunner`,
  // which is a stable function set once at mount), so it must always act on
  // the CURRENT parseResult/applyTextEdits rather than whichever ones were
  // in scope the moment the wrapper was created.
  const runToggleLayoutRef = useRef<() => void>(() => {});
  runToggleLayoutRef.current = () => {
    const editor = editorRef.current;
    if (!editor || !parseResult) return;
    const model = getDocumentModel();
    // Same staleness guard as the keydown handler this logic used to live
    // in: parseResult can be one debounce cycle behind the live buffer.
    if (model.getValue() !== parseResult.source) return;
    const selection = editor.getSelection();
    if (!selection) return;
    const start = model.getOffsetAt(selection.getStartPosition());
    const end = model.getOffsetAt(selection.getEndPosition());
    const { edits } = toggleCommandLayoutInRange(parseResult, { start, end });
    if (edits.length > 0) applyTextEdits(edits);
  };

  // The preview's Current cut point (docs/preview-design.md Sec.5). Read
  // straight from context rather than threaded down as props: this pane
  // already renders inside both providers, and the alternative is two more
  // props through AppContent that only this one decoration wants.
  const { cutOffset } = usePreviewCut();
  const { view } = usePreviewView();
  // Whichever theme is active in Settings > Theme (light, dark, or a
  // custom one), see monacoTheme.ts for why this can't be expressed as a
  // fixed Monaco theme the way the Monarch tokenizer's coloring used to be.
  const { draftTokens } = useThemeSettings();
  // Settings > Code's tab size / spaces-vs-tabs, passed straight through to
  // Monaco's own options below. @monaco-editor/react re-applies changed
  // `options` via updateOptions on every render, the same way `theme` and
  // `language` already react to prop changes, so no separate effect is
  // needed here the way the theme colours (a Monaco THEME DEFINITION, not
  // an editor option) require one.
  const { tabSize, insertSpaces } = useCodeSettings();
  // The hover's "Ok" and "Don't show me this again" links run Monaco
  // commands registered once for the whole app (diagnosticActions.ts). This
  // hands them the current file and the dismissal callbacks while the pane
  // is mounted, and the cleanup takes them back, so a stale closure from an
  // earlier file can never be the one a click reaches.
  const { hideForFile, turnOff } = useDiagnosticDismissal();
  const filePath = useCurrentFilePath();
  useEffect(() => {
    setDiagnosticActionHandlers({
      hideForFile: (code) => hideForFile(code, filePath),
      turnOff,
    });
    return () => setDiagnosticActionHandlers(null);
  }, [hideForFile, turnOff, filePath]);
  // The name lookup's providers (completion, hover, #const actions) are
  // registered once for the app and read the parse through this bridge.
  useEffect(() => {
    setNameLookupParse(parseResult);
  }, [parseResult]);
  useEffect(() => () => setNameLookupParse(null), []);
  // The #const code actions apply through the same one-undo-step path as
  // everything else, then select the new value for typing over.
  useEffect(() => {
    setConstActionHandlers({
      apply: (edits, select) => {
        applyTextEdits(edits);
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!select || !editor || !monaco) return;
        const model = getDocumentModel();
        const a = model.getPositionAt(select.start);
        const b = model.getPositionAt(select.start + select.length);
        editor.setSelection(
          new monaco.Range(a.lineNumber, a.column, b.lineNumber, b.column),
        );
        editor.focus();
      },
    });
    return () => setConstActionHandlers(null);
  }, [applyTextEdits]);
  // Belongs to ONE editor instance and dies with it, so it is a ref that is
  // reset on unmount rather than a value that outlives the mount.
  const cutDecorationsRef =
    useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  // Extracted so it can run from two places: the effect below (fires on
  // every new source/diagnostics while mounted, e.g. typing) AND
  // handleMount (fires once, right when the editor/monaco refs first
  // become available). Both are needed, see the mount-race note below.
  const applyMarkers = useCallback(
    (currentSource: string, currentDiagnostics: Diagnostic[]) => {
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;
      const model = getDocumentModel();
      // These diagnostics were computed for `source`. If the user kept
      // typing during the debounce/parse round-trip, the model may already
      // be ahead of it, applying markers against a mismatched source
      // would point squiggles at the wrong characters. Skip and wait for
      // the next (matching) result instead of showing something wrong.
      if (model.getValue() !== currentSource) {
        perfLog("markers skipped, model is ahead of this parse");
        return;
      }
      const markers = perfTime("diagnosticsToMarkers", () =>
        diagnosticsToMarkers(model, currentDiagnostics),
      );
      perfTime(`setModelMarkers (${markers.length})`, () =>
        monaco.editor.setModelMarkers(model, MARKER_OWNER, markers),
      );
      perfAfterPaint("squiggles painted");
    },
    [],
  );

  /**
   * Dims everything the Current preview is ignoring, from the cut point to
   * the end of the document.
   *
   * Why it earns its keep: Current silently drops the rest of the script, and
   * a map that is missing half its lands looks identical to a map whose
   * lands failed. The shading is what makes "this is a prefix" visible
   * instead of inferred, and it is the same information the pin button
   * states in words.
   *
   * Only in Current: in Final nothing is ignored, so there is nothing to
   * shade. Passing `null` clears rather than removing the collection, so the
   * editor keeps one collection for its whole life instead of churning
   * decorations on every toggle.
   *
   * Monaco tracks decoration ranges through edits on its own, which would
   * leave the shading ending where the document used to end. Recomputing on
   * every new `source` is what keeps the range anchored to the real cut.
   */
  const applyCutShading = useCallback((cut: number | null) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    if (cutDecorationsRef.current === null) {
      cutDecorationsRef.current = editor.createDecorationsCollection();
    }
    const collection = cutDecorationsRef.current;
    const model = getDocumentModel();
    const length = model.getValueLength();
    if (cut === null || cut >= length) {
      collection.clear();
      return;
    }
    const start = model.getPositionAt(cut);
    const end = model.getPositionAt(length);
    collection.set([
      {
        range: new monaco.Range(
          start.lineNumber,
          start.column,
          end.lineNumber,
          end.column,
        ),
        options: { inlineClassName: styles.cutIgnored },
      },
    ]);
  }, []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (PERF_TRACE) {
      perfLogSinceOpen(
        "code editor mounted",
        `${(performance.now() - firstRenderAtRef.current).toFixed(1)} ms after the Code tab first rendered`,
      );
      // Highlighting is Monaco's own tokenizer, not the parser worker, so it
      // gets its own clock, measured from this mount.
      perfFirstTokens(
        getDocumentModel(),
        "after editor mount, first highlighted",
        performance.now(),
      );
    }
    activeEditor = editor;
    // A stable wrapper, set once here rather than re-set on every render:
    // it only ever calls through the ref, so it never goes stale on its own.
    toggleLayoutRunner = () => runToggleLayoutRef.current();
    // Belt-and-suspenders: @monaco-editor/react's `path` + `keepCurrentModel`
    // props already resolve to the shared model (see useDocument.ts's
    // header comment on why there's no async race), but making it
    // explicit here means a future prop-wiring mistake fails obviously
    // (wrong content shown) rather than silently diverging.
    if (editor.getModel() !== getDocumentModel()) {
      editor.setModel(getDocumentModel());
    }
    // Mount-race fix: markers are keyed to the MODEL (setModelMarkers),
    // and the model persists across tab switches (keepCurrentModel), but
    // editorRef/monacoRef reset to null on every remount, since CodePane
    // fully unmounts when the Code tab isn't active. The effect below
    // depends on [source, diagnostics], which normally re-fires it after
    // any edit, but if the parse already completed WHILE the Code tab
    // was unmounted (e.g. a Breakdown edit, or Ctrl+Z/Y from the
    // Breakdown tab), `source`/`diagnostics` are already current at
    // mount time and never change again afterward, so that effect's one
    // and only run happens before these refs are set (guard bails out)
    // and is never retried. The model kept showing whichever markers
    // were set the *previous* time this editor was mounted, stale,
    // pointing at pre-edit diagnostics. Applying markers directly here,
    // once refs are actually ready, closes that gap.
    applyMarkers(source, diagnostics);
    // Same mount-race as the markers above: the theme effect below depends
    // on [draftTokens], which won't re-fire just because the Code tab
    // remounted with the same tokens it already had. This is what makes
    // a *fresh* editor instance actually start out on the right theme
    // instead of Monaco's own "vs" default.
    defineAoe2RmsMonacoTheme(monaco, draftTokens);
    // Same mount-race as the markers above, and the same fix: the effect
    // below has already run (and bailed) by the time these refs are set.
    // A fresh editor means a fresh collection. The old one went with the
    // editor that owned it.
    cutDecorationsRef.current = null;
    applyCutShading(view === "current" ? cutOffset : null);

    // Cross-tab sync, incoming half (Breakdown -> Code): a card was
    // selected before the user switched here, so land the caret there,
    // select the whole span, and scroll it to the middle of the viewport,
    // "switching to Code should have that section of code in the
    // middle of the page, text selected." Uses the model directly rather
    // than `source` (a prop, possibly one debounce cycle behind) since
    // the model IS the authoritative current text (Sec.6.4).
    if (selectedItem) {
      const model = getDocumentModel();
      const startPos = model.getPositionAt(selectedItem.span.start);
      const endPos = model.getPositionAt(selectedItem.span.end);
      const range = new monaco.Range(
        startPos.lineNumber,
        startPos.column,
        endPos.lineNumber,
        endPos.column,
      );
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

    resolveFlashRef.current?.dispose();
    resolveFlashRef.current = attachResolveFlash(editor, {
      className: styles.resolveFlash,
      isEnabled: () => resolveFlashOnRef.current,
      resolves: wordResolvesToConst,
    });

    onEditorReady?.();
  };

  // Toggle-command-layout hotkey (default Ctrl+Alt+F), also reachable from
  // the Edit menu (App.tsx, via getActiveToggleLayoutRunner). Scoped to this
  // component rather than App.tsx's global listener, same reasoning as
  // BreakdownPane's own two hotkeys (see App.tsx's comment on why): it needs
  // `editorRef`/`parseResult`/`applyTextEdits`, all of which only exist
  // while the Code tab is mounted, so this effect's own mount lifetime is
  // the "only while Code is the active tab" guard. The actual logic lives in
  // runToggleLayoutRef above, shared with the Edit menu's entry point, this
  // effect only decides WHEN the hotkey fires.
  const { hotkeys, recordingId } = useHotkeySettings();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      if (!matchesHotkey(event, hotkeys.codeToggleLayout)) return;
      event.preventDefault();
      runToggleLayoutRef.current();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys.codeToggleLayout, recordingId]);

  // Cycle Tabs (Ctrl+Tab, Ctrl+Shift+Tab backwards) scrolls the next or
  // previous <SECTION> header to the top of the editor, the Code tab's
  // version of stepping Breakdown's section tabs. Scrolls only: the cursor
  // stays put, since it also sets the preview's Current cut point and a jump
  // to look at another section should not move that. Stands down for a press
  // in the side panel, whose Preview/Reference tabs take the same chord.
  const jumpSectionRef = useRef<(step: 1 | -1) => void>(() => {});
  jumpSectionRef.current = (step) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !parseResult) return;
    const model = getDocumentModel();
    // Same staleness guard as the layout toggle: header offsets from a parse
    // one debounce cycle behind the buffer would land on the wrong lines.
    if (model.getValue() !== parseResult.source) return;
    const headerTops = parseResult.script.sections.map((section) =>
      editor.getTopForLineNumber(
        model.getPositionAt(section.span.start).lineNumber,
      ),
    );
    const maxScrollTop =
      editor.getScrollHeight() - editor.getLayoutInfo().height;
    const target = sectionJumpTop(
      headerTops,
      editor.getScrollTop(),
      maxScrollTop,
      step,
    );
    if (target !== null)
      editor.setScrollTop(target, monaco.editor.ScrollType.Immediate);
  };
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      const step = cycleDirection(event, hotkeys.cycleFocusedTabs);
      if (step === null || isSidePanelKeyEvent(event)) return;
      event.preventDefault();
      jumpSectionRef.current(step);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys.cycleFocusedTabs, recordingId]);

  useEffect(() => {
    applyMarkers(source, diagnostics);
  }, [source, diagnostics, applyMarkers]);

  // Picks up every live theme change: switching theme in Settings, and
  // every keystroke while dragging a color picker there (draftTokens is
  // the live-preview draft, not only the last-saved theme, see
  // ThemeSettingsContext's own header comment on why those are the same
  // value here).
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineAoe2RmsMonacoTheme(monaco, draftTokens);
  }, [draftTokens]);

  // `source` is a dependency even though it is not read: a new parse means
  // the text changed, and the shading has to be re-laid against the new end
  // of the document.
  useEffect(() => {
    applyCutShading(view === "current" ? cutOffset : null);
  }, [view, cutOffset, source, applyCutShading]);

  // Dispose the cursor-tracking subscription on unmount, the editor
  // instance itself is torn down by @monaco-editor/react when the Code
  // tab isn't active, which would dispose this anyway, but explicit
  // disposal matches this codebase's standing convention (see
  // useDocument.ts's onDidChangeContent subscription) rather than relying
  // on that implicitly.
  useEffect(() => {
    return () => {
      cursorSubscriptionRef.current?.dispose();
      cursorSubscriptionRef.current = null;
      resolveFlashRef.current?.dispose();
      resolveFlashRef.current = null;
      // The collection is owned by the editor being torn down; dropping the
      // reference stops the next mount from writing into a dead one.
      cutDecorationsRef.current = null;
      // Same reasoning: @monaco-editor/react disposes the editor VIEW
      // instance itself when the Code tab unmounts (only the shared MODEL
      // survives, via keepCurrentModel). Without this, getActiveCodeEditor()
      // and getActiveToggleLayoutRunner() would keep handing the Edit menu a
      // disposed instance instead of correctly reporting "not mounted" so it
      // can queue the action and switch tabs.
      activeEditor = null;
      toggleLayoutRunner = null;
    };
  }, []);

  if (!hasFile) {
    return (
      <PlaceholderPane description="Open an .rms file (File > Open) to see its code here." />
    );
  }

  return (
    <div className={styles.pane}>
      {/* The preview + reference column sits beside this pane, rendered once
          by App as a full-height column next to the header. */}
      <div className={styles.editorFrame} data-tutorial-anchor="code.editor">
        <Editor
          height="100%"
          width="100%"
          language="aoe2-rms"
          theme={AOE2_RMS_MONACO_THEME}
          path={DOCUMENT_MODEL_PATH}
          keepCurrentModel
          onMount={handleMount}
          options={{
            minimap: { enabled: true },
            fontSize: 13,
            fontFamily: '"Cascadia Code", Consolas, monospace',
            wordWrap: "off",
            scrollBeyondLastLine: false,
            tabSize,
            insertSpaces,
            // name-lookup-design.md Sec.4.1. Word suggestions would mix in
            // every word of the file, comments included. Enter always makes
            // a new line, only Tab accepts (owner's choice, Q1).
            wordBasedSuggestions: "off",
            acceptSuggestionOnEnter: "off",
            // Sec.13.5. Ghost text is drawn in the theme's muted colour
            // (monacoTheme.ts). Monaco's default colours it like real code
            // at lower opacity, which reads as typed text on some themes.
            inlineSuggest: { syntaxHighlightingEnabled: false },
          }}
        />
      </div>
    </div>
  );
}
