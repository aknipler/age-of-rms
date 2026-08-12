import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { CodePane } from "./components/CodePane";
import { BreakdownPane } from "./breakdown/BreakdownPane";
import { StatusBar } from "./components/StatusBar";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { GenerationSettingsDialog } from "./components/GenerationSettingsDialog";
import { HelpSettingsProvider } from "./help/HelpSettingsContext";
import { AppSettingsProvider } from "./settings/AppSettingsContext";
import { GenerationSettingsProvider, useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { PreviewViewProvider, PreviewViewportProvider } from "./components/preview/PreviewViewContext";
import { SidePanelLayoutProvider } from "./components/sidepanel/SidePanelLayoutContext";
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
  const doc = useDocument();
  const { playerCount } = useGenerationSettings();
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

  return (
    <div className={styles.app}>
      <TitleBar
        onOpen={doc.openFile}
        onSave={doc.saveFile}
        onSaveAs={doc.saveFileAs}
        onOpenSettings={() => setSettingsOpen(true)}
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
                  selectedItem={selection.selectedItem}
                  onCursorOffsetChange={selection.setAnchor}
                />
              )}
              {activeTab === "advanced-tools" && (
                <PlaceholderPane description="Advanced Tools pane — arrives in Phase 5." />
              )}
            </main>
          </PreviewResultProvider>
        </PreviewCutProvider>
      </ParsedDocumentProvider>
      <StatusBar
        diagnostics={parsed.diagnostics}
        total={parsed.resourceTotals.total}
        player={parsed.resourceTotals.player}
        neutral={parsed.resourceTotals.neutral}
        onOpenGenerationSettings={() => setGenerationSettingsOpen(true)}
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
      </AppSettingsProvider>
    </HelpSettingsProvider>
  );
}

export default App;
