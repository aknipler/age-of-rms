import { useEffect, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { ToolsPane } from "./tools/ToolsPane";
import { CodePane } from "./components/CodePane";
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
import { GenerationSettingsProvider, useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { PreviewViewProvider, PreviewViewportProvider, usePreviewView } from "./components/preview/PreviewViewContext";
import { SidePanelLayoutProvider } from "./components/sidepanel/SidePanelLayoutContext";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { useUpdateCheck } from "./update/useUpdateCheck";
import { buildBugReportUrl } from "./bugReport";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDocument } from "./hooks/useDocument";
import { useSharedSelection } from "./hooks/useSharedSelection";
import { useParsedDocument } from "./useParsedDocument";
import { ParsedDocumentProvider } from "./ParsedDocumentContext";
import { PreviewCutProvider } from "./PreviewCutContext";
import { PreviewResultProvider } from "./PreviewResultContext";
import type { TabId } from "./types";
import styles from "./App.module.css";
import "./App.css";

// Split out from App so it can call useGenerationSettings — the hook
// needs to run below GenerationSettingsProvider in the tree, same reason
// SettingsDialog/HelpTip call useHelpSettings rather than App itself.
function AppContent() {
  // activeTab is "lifted" here because both TabBar (which sets it) and
  // the panes below (which read it) need access to the same value.
  const [activeTab, setActiveTab] = useState<TabId>("breakdown");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generationSettingsOpen, setGenerationSettingsOpen] = useState(false);
  // The author name is read here rather than inside useDocument, so that hook
  // keeps depending on files and nothing else (see UseDocumentOptions).
  // AppContent already sits below AppSettingsProvider, which is what makes
  // this the natural place for the two to meet.
  const { authorName } = useAppSettings();
  const doc = useDocument({ authorName });
  const { saveFile, saveFileAs, newFile, openFile } = doc;
  const { playerCount } = useGenerationSettings();
  const { hotkeys, recordingId } = useHotkeySettings();
  const { toggleView, reseed } = usePreviewView();

  // The app-wide shortcuts: Save (default Ctrl+S, the original binding),
  // Save As, New/Open, and the two Preview actions that make sense regardless of
  // which tab is showing (the preview's view/seed state lives above the
  // tab switch — PreviewViewContext.tsx — same as the pane itself, which
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
  // docs/breakdown-design.md Sec.6.2: "one parse, in the worker" — lifted
  // to app level so both CodePane (diagnostics/source, for Monaco
  // markers) and BreakdownPane (the full ParseResult/AST) consume the
  // same parse instead of each parsing independently. Deliberately not
  // reset when switching tabs — Problems/Breakdown both reflect the last
  // known parse, like most editors' Problems panels.
  const parsed = useParsedDocument(doc.content, playerCount);
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
        onOpenSettings={() => setSettingsOpen(true)}
        newHotkeyLabel={formatHotkey(hotkeys.newFile)}
        openHotkeyLabel={formatHotkey(hotkeys.openFile)}
        saveHotkeyLabel={formatHotkey(hotkeys.save)}
        saveAsHotkeyLabel={formatHotkey(hotkeys.saveAs)}
      />
      <MapHeader mapName={doc.mapName} lastSavedAt={doc.lastSavedAt} />
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
      {/* All three providers sit above the tab switch so what they hold
          survives it. ParsedDocumentProvider makes parsed.parseResult
          reachable from inside MapSidePanel without threading a prop through
          it (ParsedDocumentContext.tsx); PreviewCutProvider turns the shared
          selection anchor into the line Current cuts at, and owns the pin
          (PreviewCutContext.tsx); PreviewResultProvider owns the preview
          worker and its last result, which used to die with PreviewPane on
          every Breakdown/Code switch (PreviewResultContext.tsx). The cut
          provider is OUTSIDE the result provider because the result provider
          reads it — Current generates over a truncated parse. */}
      <ParsedDocumentProvider parseResult={parsed.parseResult}>
        <PreviewCutProvider
          cursorOffset={selection.selectedAnchor}
          source={parsed.source}
          parseResult={parsed.parseResult}
        >
          <PreviewResultProvider parseResult={parsed.parseResult}>
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
          </PreviewResultProvider>
        </PreviewCutProvider>
      </ParsedDocumentProvider>
      {/* Directly above the status bar, so an offer to restart the app sits
          next to the rest of the app's chrome rather than over the work. */}
      <UpdatePrompt state={update.state} onInstall={update.install} onDismiss={update.dismiss} />
      <StatusBar
        diagnostics={parsed.diagnostics}
        total={parsed.resourceTotals.total}
        player={parsed.resourceTotals.player}
        neutral={parsed.resourceTotals.neutral}
        onOpenGenerationSettings={() => setGenerationSettingsOpen(true)}
        onReportBug={reportBug}
      />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {/* Rendered only while a close-or-open attempt is waiting on the user.
          The hook owns the pending promise; this just collects the answer. */}
      {doc.unsavedAction !== null && (
        <UnsavedChangesDialog
          action={doc.unsavedAction}
          mapName={doc.mapName}
          onChoice={doc.resolveUnsavedChoice}
        />
      )}
      {generationSettingsOpen && (
        <GenerationSettingsDialog onClose={() => setGenerationSettingsOpen(false)} />
      )}
    </div>
  );
}

function App() {
  return (
    <HelpSettingsProvider>
      {/* Display preferences that aren't any one subsystem's — read by the
          Settings dialog and by every place a script-written constant name is
          rendered, so it has to sit above both. */}
      <AppSettingsProvider>
        {/* Same store, its own context — see ThemeSettingsContext.tsx for why
            the palette isn't just another AppSettingsContext field. Above
            everything else in this tree because it writes CSS custom
            properties straight onto documentElement on mount, which every
            component stylesheet below reads through var(--token-name) —
            nothing downstream needs to import it directly. */}
        <ThemeSettingsProvider>
          {/* Same store, its own context — see HotkeySettingsContext.tsx for why
              rebindable shortcuts aren't just another AppSettingsContext field. */}
          <HotkeySettingsProvider>
            <GenerationSettingsProvider>
              {/* Above AppContent, so the preview's seed/view/colour and its
                  canvas zoom/pan survive the tab switch that unmounts the pane
                  holding them. Two providers, not one context, so a drag or wheel
                  tick (which changes viewport on every frame) doesn't re-render
                  the seed/colour-mode controls — see PreviewViewContext.tsx. */}
              <PreviewViewProvider>
                <PreviewViewportProvider>
                  {/* Also above the tab switch, and for the same reason: both tabs
                      render their own MapSidePanel and the inactive one is
                      unmounted, so a width held inside it would be two widths that
                      reset on every switch (CREATION_PLAN 4.4). Unlike the two
                      above, this one IS persisted — a layout choice should still be
                      there tomorrow, where a seed should not. */}
                  <SidePanelLayoutProvider>
                    <AppContent />
                  </SidePanelLayoutProvider>
                </PreviewViewportProvider>
              </PreviewViewProvider>
            </GenerationSettingsProvider>
          </HotkeySettingsProvider>
        </ThemeSettingsProvider>
      </AppSettingsProvider>
    </HelpSettingsProvider>
  );
}

export default App;
