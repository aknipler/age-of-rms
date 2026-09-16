import { useEffect, useMemo, useRef, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { ToolsPane } from "./tools/ToolsPane";
import { CodePane, getActiveCodeEditor, getActiveToggleLayoutRunner } from "./components/CodePane";
import { runEditMenuAction, type EditMenuAction } from "./editor/editMenuActions";
import { BreakdownPane } from "./breakdown/BreakdownPane";
import { StatusBar } from "./components/StatusBar";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { GenerationSettingsDialog } from "./components/GenerationSettingsDialog";
import { HelpSettingsProvider } from "./help/HelpSettingsContext";
import { AppSettingsProvider, useAppSettings } from "./settings/AppSettingsContext";
import { ThemeSettingsProvider } from "./settings/ThemeSettingsContext";
import { HotkeySettingsProvider, useHotkeySettings } from "./settings/HotkeySettingsContext";
import { formatHotkey, matchesHotkey } from "./settings/hotkeys";
import { BreakdownSettingsProvider } from "./settings/BreakdownSettingsContext";
import { CodeSettingsProvider } from "./settings/CodeSettingsContext";
import { GenerationSettingsProvider, useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { PreviewViewProvider, PreviewViewportProvider, usePreviewView } from "./components/preview/PreviewViewContext";
import { SidePanelLayoutProvider } from "./components/sidepanel/SidePanelLayoutContext";
import { PreviewReferenceSplitProvider } from "./components/sidepanel/PreviewReferenceSplitContext";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { useUpdateCheck } from "./update/useUpdateCheck";
import { buildBugReportUrl } from "./bugReport";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDocument, getDocumentModel } from "./hooks/useDocument";
import { useSharedSelection } from "./hooks/useSharedSelection";
import { useParsedDocument } from "./useParsedDocument";
import { ParsedDocumentProvider } from "./ParsedDocumentContext";
import { PreviewCutProvider, usePreviewCut } from "./PreviewCutContext";
import { PreviewResultProvider, PanelPreviewResultProvider, usePreviewResultContext } from "./PreviewResultContext";
import { ToolHostProvider } from "./tools/ToolHostContext";
import {
  PanelPreviewSeedProvider,
  usePanelPreviewSeed,
} from "./tools/builtin/landPlacement/panel/panelPreviewSeed";
import { LandPlacementModelProvider } from "./tools/builtin/landPlacement/panel/landPlacementModel";
import { resolveLandGenerationCutOffset } from "./tools/builtin/landPlacement/cutOffset";
import { TutorialProvider, useRegisterNavigator, useTutorial } from "./tutorial/TutorialContext";
import { TutorialOverlay } from "./tutorial/TutorialOverlay";
import { WelcomeDialog } from "./tutorial/WelcomeDialog";
import type { Diagnostic, ParseResult } from "./parser/types";
import type { TabId } from "./types";
import styles from "./App.module.css";
import "./App.css";

/**
 * Wires the document's own `PreviewResultProvider` (Breakdown/Code's shared
 * seed/view/cut) and the Land Placement panel's independent one
 * (`PanelPreviewResultProvider`) side by side, both still above the tab
 * switch (slice-4b item 1, §1.2 option (f)).
 *
 * A separate component, not inlined into `AppContent`, because
 * `usePreviewCut()` can only be called from a descendant of
 * `PreviewCutProvider`'s rendered subtree. `AppContent` is the component
 * that RENDERS that provider, which makes it the provider's parent, not its
 * descendant, so it cannot call the hook itself.
 */
function PreviewResultProviders({
  parseResult,
  children,
}: {
  parseResult: ParseResult | null;
  children: React.ReactNode;
}) {
  const documentView = usePreviewView();
  const documentCut = usePreviewCut();
  const panelSeed = usePanelPreviewSeed();
  // Pure and cheap (cutOffset.ts is a plain scan over already-parsed
  // sections), memoised only so a re-render that doesn't touch the parse
  // doesn't rebuild the debounce-restarting object identity Current/Final
  // truncation relies on (see PreviewResultContext.tsx's own note on this).
  const panelCutOffset = useMemo(
    () => (parseResult === null ? null : resolveLandGenerationCutOffset(parseResult)),
    [parseResult],
  );

  return (
    <PreviewResultProvider
      parseResult={parseResult}
      seed={documentView.seed}
      view={documentView.view}
      cutOffset={documentCut.cutOffset}
    >
      {/* No Current/Final toggle of its own. The panel always wants a cut,
          at the end of land generation rather than at the caret, so `view`
          is pinned to "current" (the channel's own flag for "cutOffset
          applies") rather than exposed as a user-facing choice. */}
      <PanelPreviewResultProvider parseResult={parseResult} seed={panelSeed.seed} view="current" cutOffset={panelCutOffset}>
        {children}
      </PanelPreviewResultProvider>
    </PreviewResultProvider>
  );
}

/**
 * Reads the document's own `PreviewResultProvider` context and renders
 * `StatusBar` from it (status-bar accuracy pass, D1/D3/D11) — the bar's
 * resource figures now come from a real generation
 * (`result.resourceTotals`), not a static per-keystroke AST walk, so it has
 * to live where that context is reachable, which is inside
 * `PreviewResultProviders`, not a sibling of it the way it used to be.
 *
 * A small wrapper rather than inlining into `AppContent`, for the same
 * reason `PreviewResultProviders` itself is split out: `usePreviewResultContext`/
 * `usePreviewCut`/`usePreviewView` can only be called from inside the
 * providers they read, and `AppContent` renders those providers rather than
 * living below them.
 */
function StatusBarContainer({
  diagnostics,
  onReportBug,
}: {
  diagnostics: Diagnostic[];
  onReportBug: () => void;
}) {
  const { result, pending } = usePreviewResultContext();
  const { pinnedOffset, pinnedLine, cursorOffset, cursorLine } = usePreviewCut();
  const { view } = usePreviewView();

  // D3: truncation must be visible. The condition is wider than "pinned" —
  // PreviewCutValue.cutOffset is "the pin when there is one, the caret
  // otherwise", so Current view truncates with no pin at all, which is the
  // more common case, and needs its own label.
  let cutLabel: string | undefined;
  if (view === "current") {
    if (pinnedOffset !== null && pinnedLine !== null) cutLabel = `Pinned line ${pinnedLine + 1}`;
    else if (cursorOffset !== null && cursorLine !== null) cutLabel = `Current line ${cursorLine + 1}`;
  }

  return (
    <StatusBar
      diagnostics={diagnostics}
      total={result?.resourceTotals.total}
      player={result?.resourceTotals.player}
      neutral={result?.resourceTotals.neutral}
      pending={pending}
      cutLabel={cutLabel}
      onReportBug={onReportBug}
    />
  );
}

// Split out from App so it can call hooks like useHotkeySettings/
// usePreviewView, which need to run below their own providers in the tree,
// same reason SettingsDialog/HelpTip call useHelpSettings rather than App
// itself.
function AppContent() {
  // activeTab is "lifted" here because both TabBar (which sets it) and
  // the panes below (which read it) need access to the same value.
  const [activeTab, setActiveTab] = useState<TabId>("breakdown");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Open/close flag lives on GenerationSettingsContext, not here: the
  // dialog is opened from PreviewPane's own settings button (beta feedback
  // moved it off the status bar, since that's the pane these settings
  // actually feed), which reads `openDialog` from the same context directly
  // rather than through a prop passed down from here. This component only
  // needs the other half, to render the dialog itself.
  const { isDialogOpen: generationSettingsOpen, closeDialog: closeGenerationSettings } = useGenerationSettings();
  // tutorial-design.md Sec.5.3, the "appTab" navigator a step's
  // `navigate.tab` drives. Registered here (rather than inside
  // TutorialProvider itself) because setActiveTab only exists below it.
  const { welcomeOpen } = useTutorial();
  // NavigatorKey's contract is a bare `(target: string) => void`. Every
  // step content author writes navigate.tab as a real TabId, so the cast
  // is the same trust the type Anchor/navigate fields already put in
  // hand-written content (Sec.5.1).
  useRegisterNavigator("appTab", (target) => setActiveTab(target as TabId));
  // The author name is read here rather than inside useDocument, so that hook
  // keeps depending on files and nothing else (see UseDocumentOptions).
  // AppContent already sits below AppSettingsProvider, which is what makes
  // this the natural place for the two to meet.
  const { authorName } = useAppSettings();
  const doc = useDocument({ authorName });
  const { saveFile, saveFileAs, newFile, openFile } = doc;
  const { hotkeys, recordingId } = useHotkeySettings();
  const { toggleView, reseed } = usePreviewView();

  // The app-wide shortcuts: Save (default Ctrl+S, the original binding),
  // Save As, New/Open, and the two Preview actions that make sense regardless of
  // which tab is showing (the preview's view/seed state lives above the
  // tab switch (PreviewViewContext.tsx), same as the pane itself, which
  // both Breakdown and Code render via MapSidePanel). Breakdown's own two
  // block-level actions are NOT here: they need `applyEdit` and the
  // selected card, both of which only exist while BreakdownPane is
  // mounted, so those listeners live there instead (BreakdownPane.tsx /
  // SectionView.tsx) and are naturally inactive on any other tab.
  //
  // Lives here rather than inside useDocument/PreviewViewContext because
  // the bindings themselves are a setting, not a file-I/O or preview
  // concern, and here rather than HotkeySettingsContext because the
  // listener needs saveFile/newFile/openFile/toggleView/reseed, which
  // would make the settings context depend on the document hook and the
  // preview context for no reason a rebind ever needs. No "skip when
  // inside Monaco" guard like useDocument's undo/redo listener has: every
  // binding here requires Ctrl, and Monaco has no binding of its own on
  // any of these combinations to defer to; preventDefault() is what stops
  // the browser's native Save-page/Open-file dialogs from opening on top
  // of the app either way.
  //
  // Destructured to individual functions rather than depending on `doc`
  // directly: `doc` is a fresh object every render (useDocument doesn't
  // memoize its return value), so `doc.saveFile` in a dependency array
  // reads as "depends on the whole doc object" to eslint's
  // exhaustive-deps rule, which would either nag for `doc` (re-subscribing
  // every render, since `doc` never has a stable identity) or hide that
  // `saveFile` itself IS stable (useDocument wraps it in useCallback). The
  // destructure makes the real, stable dependency explicit.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      if (matchesHotkey(event, hotkeys.save)) {
        event.preventDefault();
        void saveFile();
      } else if (matchesHotkey(event, hotkeys.saveAs)) {
        event.preventDefault();
        void saveFileAs();
      } else if (matchesHotkey(event, hotkeys.newFile)) {
        event.preventDefault();
        void newFile();
      } else if (matchesHotkey(event, hotkeys.openFile)) {
        event.preventDefault();
        void openFile();
      } else if (matchesHotkey(event, hotkeys.previewToggleView)) {
        event.preventDefault();
        toggleView();
      } else if (matchesHotkey(event, hotkeys.previewReseed)) {
        event.preventDefault();
        reseed();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys, recordingId, saveFile, saveFileAs, newFile, openFile, toggleView, reseed]);

  // Undo/Redo act on the shared Monaco model directly, the same target
  // useDocument.ts's own window-level Ctrl+Z/Ctrl+Y listener uses, so the
  // Edit menu reaches exactly the "one undo stack" both the Breakdown and
  // Code tabs already share (Sec.6.4). No editor instance is needed for
  // these, which is why they work from the Edit menu regardless of which
  // tab is active.
  function undoDocument() {
    void getDocumentModel().undo();
  }
  function redoDocument() {
    void getDocumentModel().redo();
  }

  // Cut/Copy/Paste/Find/Select All/Find and Replace/Toggle Comment, and the
  // Code tab's own Toggle Command Layout hotkey, unlike Undo/Redo, are
  // editor actions rather than model actions: they need a live, focused
  // Monaco instance to run against (a selection to cut, a place to paste,
  // an AST to re-lay-out). That instance only exists while the Code tab is
  // mounted (CodePane.tsx). `runOnCodeTab` is the shared "run it now, or
  // switch to Code and queue it for the moment CodePane hands back a fresh
  // instance" logic both kinds of action need; what differs between them is
  // only how each CHECKS readiness and RUNS, which is why this takes those
  // as two small functions rather than being written twice. A ref, not
  // state, holds the queued thunk since queuing an action must never itself
  // trigger a render.
  const pendingCodeActionRef = useRef<(() => void) | null>(null);
  function runOnCodeTab(isReady: () => boolean, run: () => void) {
    if (isReady()) {
      run();
      return;
    }
    pendingCodeActionRef.current = run;
    setActiveTab("code");
  }
  function performEditMenuAction(action: EditMenuAction) {
    runOnCodeTab(
      () => getActiveCodeEditor() !== null,
      () => runEditMenuAction(getActiveCodeEditor()!, action),
    );
  }
  function toggleCodeLayout() {
    runOnCodeTab(
      () => getActiveToggleLayoutRunner() !== null,
      () => getActiveToggleLayoutRunner()?.(),
    );
  }
  function handleCodeEditorReady() {
    const run = pendingCodeActionRef.current;
    if (run === null) return;
    pendingCodeActionRef.current = null;
    run();
  }

  // docs/breakdown-design.md Sec.6.2: "one parse, in the worker", lifted
  // to app level so both CodePane (diagnostics/source, for Monaco
  // markers) and BreakdownPane (the full ParseResult/AST) consume the
  // same parse instead of each parsing independently. Deliberately not
  // reset when switching tabs. Problems/Breakdown both reflect the last
  // known parse, like most editors' Problems panels.
  const parsed = useParsedDocument(doc.content);
  // One selection anchor shared by both panes,
  // lifted here (rather than living inside BreakdownPane, which unmounts
  // on every tab switch) specifically so it survives Breakdown <-> Code.
  const selection = useSharedSelection(parsed.source, parsed.parseResult);
  // Checks GitHub once on mount. Silent when offline or already current, so
  // most starts render nothing for this.
  const update = useUpdateCheck();

  // Opens a prefilled issue in the user's own browser, the same way the DE RMS
  // guide link does (TitleBar.tsx explains why an external page does not belong
  // in a Tauri webview). Counting the diagnostics here rather than in
  // bugReport.ts keeps that module free of the parser's types, so it stays
  // testable without constructing a ParseResult.
  function reportBug() {
    const counts = { errors: 0, warnings: 0, infos: 0 };
    for (const diagnostic of parsed.diagnostics) {
      if (diagnostic.severity === "error") counts.errors++;
      else if (diagnostic.severity === "warning") counts.warnings++;
      else counts.infos++;
    }

    const url = buildBugReportUrl({
      appVersion: __APP_VERSION__,
      userAgent: navigator.userAgent,
      diagnostics: doc.filePath === null ? null : counts,
      hasFileOpen: doc.filePath !== null,
    });

    openUrl(url).catch((error: unknown) => {
      console.error("Failed to open the bug report form", error);
    });
  }

  return (
    <div className={styles.app}>
      <TitleBar
        onNew={doc.newFile}
        onOpen={doc.openFile}
        onSave={doc.saveFile}
        onSaveAs={doc.saveFileAs}
        onUndo={undoDocument}
        onRedo={redoDocument}
        onCut={() => performEditMenuAction("cut")}
        onCopy={() => performEditMenuAction("copy")}
        onPaste={() => performEditMenuAction("paste")}
        onSelectAll={() => performEditMenuAction("selectAll")}
        onFind={() => performEditMenuAction("find")}
        onFindReplace={() => performEditMenuAction("findReplace")}
        onToggleComment={() => performEditMenuAction("toggleComment")}
        onToggleLayout={toggleCodeLayout}
        onOpenSettings={() => setSettingsOpen(true)}
        newHotkeyLabel={formatHotkey(hotkeys.newFile)}
        openHotkeyLabel={formatHotkey(hotkeys.openFile)}
        saveHotkeyLabel={formatHotkey(hotkeys.save)}
        saveAsHotkeyLabel={formatHotkey(hotkeys.saveAs)}
        toggleLayoutHotkeyLabel={formatHotkey(hotkeys.codeToggleLayout)}
      />
      <MapHeader mapName={doc.mapName} lastSavedAt={doc.lastSavedAt}>
        <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      </MapHeader>
      {/* All five providers sit above the tab switch so what they hold
          survives it. ParsedDocumentProvider makes parsed.parseResult
          reachable from inside MapSidePanel without threading a prop through
          it (ParsedDocumentContext.tsx); PreviewCutProvider turns the shared
          selection anchor into the line Current cuts at, and owns the pin
          (PreviewCutContext.tsx); PreviewResultProviders wires up BOTH the
          document's preview worker (which used to die with PreviewPane on
          every Breakdown/Code switch) and the Land Placement panel's own,
          independent one (PreviewResultContext.tsx, slice-4b item 1). The cut
          provider is OUTSIDE the result providers because the document one
          reads it. Current generates over a truncated parse. ToolHostProvider
          owns the Advanced Tools pane's ToolHost, for the same reason a
          PANEL tool's model must survive Breakdown/Code <-> Advanced Tools
          (land-placement-design.md Sec.3.6, ToolHostContext.tsx). It has no
          data dependency on the other four, so its position in the nesting
          is arbitrary; it sits innermost only because it is ToolsPane's own
          concern alone. */}
      <ParsedDocumentProvider parseResult={parsed.parseResult}>
        <PreviewCutProvider
          cursorOffset={selection.selectedAnchor}
          source={parsed.source}
          parseResult={parsed.parseResult}
        >
          <PreviewResultProviders parseResult={parsed.parseResult}>
            <ToolHostProvider>
              {/* The Land Placement panel's own AlpModel + selection, lifted
                  above the tab switch for the same reason ToolHost itself is
                  (land-placement-design.md Sec.3.6(b)), landPlacementModel.tsx. */}
              <LandPlacementModelProvider>
                <main className={styles.main}>
                  {activeTab === "breakdown" && (
                    <BreakdownPane
                      hasFile={doc.filePath !== null}
                      source={parsed.source}
                      parseResult={parsed.parseResult}
                      applyTextEdit={doc.applyTextEdit}
                      reparseNow={parsed.reparseNow}
                      selection={selection}
                    />
                  )}
                  {activeTab === "code" && (
                    <CodePane
                      hasFile={doc.filePath !== null}
                      source={parsed.source}
                      diagnostics={parsed.diagnostics}
                      parseResult={parsed.parseResult}
                      applyTextEdits={doc.applyTextEdits}
                      selectedItem={selection.selectedItem}
                      onCursorOffsetChange={selection.setAnchor}
                      onEditorReady={handleCodeEditorReady}
                    />
                  )}
                  {activeTab === "advanced-tools" && (
                    <ToolsPane
                      filePath={doc.filePath}
                      source={parsed.source}
                      reparseNow={parsed.reparseNow}
                      applyTextEdits={doc.applyTextEdits}
                      onJumpToOffset={selection.setAnchor}
                    />
                  )}
                </main>
                {/* Sibling of <main>, still inside ParsedDocumentProvider so
                    a check step's completion test can read the live parse
                    (tutorial-design.md Sec.5.4). Portals to document.body,
                    so its position here is about context access, not
                    layout. */}
                <TutorialOverlay
                  hasFile={doc.filePath !== null}
                  activeTab={activeTab}
                  applyTextEdits={doc.applyTextEdits}
                />
              </LandPlacementModelProvider>
            </ToolHostProvider>
            {/* Moved inside PreviewResultProviders (status-bar accuracy pass):
                StatusBarContainer reads the document's PreviewResultProvider
                context directly, which does not exist above this point.
                UpdatePrompt moves with it, directly above the status bar so
                an offer to restart the app sits next to the rest of the
                app's chrome rather than over the work — `.app` is a flex
                column and neither provider renders DOM of its own, so this
                is layout-neutral. */}
            <UpdatePrompt state={update.state} onInstall={update.install} onDismiss={update.dismiss} />
            <StatusBarContainer diagnostics={parsed.diagnostics} onReportBug={reportBug} />
          </PreviewResultProviders>
        </PreviewCutProvider>
      </ParsedDocumentProvider>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {welcomeOpen && <WelcomeDialog />}
      {/* Rendered only while a close-or-open attempt is waiting on the user.
          The hook owns the pending promise; this just collects the answer. */}
      {doc.unsavedAction !== null && (
        <UnsavedChangesDialog
          action={doc.unsavedAction}
          mapName={doc.mapName}
          onChoice={doc.resolveUnsavedChoice}
        />
      )}
      {generationSettingsOpen && <GenerationSettingsDialog onClose={closeGenerationSettings} />}
    </div>
  );
}

function App() {
  return (
    <HelpSettingsProvider>
      {/* Display preferences that aren't any one subsystem's, read by the
          Settings dialog and by every place a script-written constant name is
          rendered, so it has to sit above both. */}
      <AppSettingsProvider>
        {/* Same store, its own context; see ThemeSettingsContext.tsx for why
            the palette isn't just another AppSettingsContext field. Above
            everything else in this tree because it writes CSS custom
            properties straight onto documentElement on mount, which every
            component stylesheet below reads through var(--token-name).
            Nothing downstream needs to import it directly. */}
        <ThemeSettingsProvider>
          {/* Same store, its own context; see HotkeySettingsContext.tsx for why
              rebindable shortcuts aren't just another AppSettingsContext field. */}
          <HotkeySettingsProvider>
            {/* Same store, its own context; Breakdown-editor-only settings
                (today: attribute ordering), same split reasoning as the
                sibling providers above. */}
            <BreakdownSettingsProvider>
              {/* Same store, its own context; Code-tab-only settings (today:
                  tab size, spaces vs tabs), same split reasoning as its
                  Breakdown sibling above — CodePane.tsx reads it to set
                  Monaco's own tabSize/insertSpaces options. */}
              <CodeSettingsProvider>
                <GenerationSettingsProvider>
                  {/* Above AppContent, so the preview's seed/view/colour and its
                      canvas zoom/pan survive the tab switch that unmounts the pane
                      holding them. Two providers, not one context, so a drag or wheel
                      tick (which changes viewport on every frame) doesn't re-render
                      the seed/colour-mode controls; see PreviewViewContext.tsx. */}
                  <PreviewViewProvider>
                    <PreviewViewportProvider>
                      {/* Also above the tab switch, and for the same reason: both tabs
                          render their own MapSidePanel and the inactive one is
                          unmounted, so a width held inside it would be two widths that
                          reset on every switch (CREATION_PLAN 4.4). Unlike the two
                          above, this one IS persisted. A layout choice should still be
                          there tomorrow, where a seed should not. */}
                      <SidePanelLayoutProvider>
                        {/* One level in from the side panel's own width/collapse,
                            same persisted-and-shared-across-tabs reasoning, one
                            layer down: this one is the preview/reference split
                            WITHIN that panel rather than the panel's own width
                            (previewReferenceSplit.ts). */}
                        <PreviewReferenceSplitProvider>
                          {/* The Land Placement panel's own seed (PreviewResultProviders,
                              above), same "survive the tab switch" reasoning as
                              PreviewViewProvider, deliberately its own context rather
                              than a field on that one (panelPreviewSeed.tsx). */}
                          <PanelPreviewSeedProvider>
                            {/* Innermost of the App()-level providers
                                (tutorial-design.md Sec.5.4), a future step can
                                read generation settings or preview state, and
                                nothing above it needs to read tutorial state. */}
                            <TutorialProvider>
                              <AppContent />
                            </TutorialProvider>
                          </PanelPreviewSeedProvider>
                        </PreviewReferenceSplitProvider>
                      </SidePanelLayoutProvider>
                    </PreviewViewportProvider>
                  </PreviewViewProvider>
                </GenerationSettingsProvider>
              </CodeSettingsProvider>
            </BreakdownSettingsProvider>
          </HotkeySettingsProvider>
        </ThemeSettingsProvider>
      </AppSettingsProvider>
    </HelpSettingsProvider>
  );
}

export default App;
