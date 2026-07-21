import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { CodePane } from "./components/CodePane";
import { BreakdownPane } from "./breakdown/BreakdownPane";
import { StatusBar } from "./components/StatusBar";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { UnsavedChangesDialog } from "./components/UnsavedChangesDialog";
import { GenerationSettingsDialog } from "./components/GenerationSettingsDialog";
import { HelpSettingsProvider } from "./help/HelpSettingsContext";
import { GenerationSettingsProvider, useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { useDocument } from "./hooks/useDocument";
import { useSharedSelection } from "./hooks/useSharedSelection";
import { useParsedDocument } from "./useParsedDocument";
import type { TabId } from "./types";
import styles from "./App.module.css";
import "./App.css";

// Split out from App so it can call useGenerationSettings — the hook
// needs to run below GenerationSettingsProvider in the tree, same reason
// PreferencesDialog/HelpTip call useHelpSettings rather than App itself.
function AppContent() {
  // activeTab is "lifted" here because both TabBar (which sets it) and
  // the panes below (which read it) need access to the same value.
  const [activeTab, setActiveTab] = useState<TabId>("breakdown");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [generationSettingsOpen, setGenerationSettingsOpen] = useState(false);
  const doc = useDocument();
  const { playerCount } = useGenerationSettings();
  // docs/breakdown-design.md §6.2: "one parse, in the worker" — lifted
  // to app level so both CodePane (diagnostics/source, for Monaco
  // markers) and BreakdownPane (the full ParseResult/AST) consume the
  // same parse instead of each parsing independently. Deliberately not
  // reset when switching tabs — Problems/Breakdown both reflect the last
  // known parse, like most editors' Problems panels.
  const parsed = useParsedDocument(doc.content, playerCount);
  // Ash's post-3.9 follow-up: one selection anchor shared by both panes,
  // lifted here (rather than living inside BreakdownPane, which unmounts
  // on every tab switch) specifically so it survives Breakdown <-> Code.
  const selection = useSharedSelection(parsed.source, parsed.parseResult);

  return (
    <div className={styles.app}>
      <TitleBar
        onOpen={doc.openFile}
        onSave={doc.saveFile}
        onSaveAs={doc.saveFileAs}
        onOpenPreferences={() => setPreferencesOpen(true)}
      />
      <MapHeader mapName={doc.mapName} lastSavedAt={doc.lastSavedAt} />
      <TabBar activeTab={activeTab} onSelect={setActiveTab} />
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
      <StatusBar
        diagnostics={parsed.diagnostics}
        total={parsed.resourceTotals.total}
        player={parsed.resourceTotals.player}
        neutral={parsed.resourceTotals.neutral}
        onOpenGenerationSettings={() => setGenerationSettingsOpen(true)}
      />
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
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
      <GenerationSettingsProvider>
        <AppContent />
      </GenerationSettingsProvider>
    </HelpSettingsProvider>
  );
}

export default App;
