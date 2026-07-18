import { useCallback, useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { CodePane } from "./components/CodePane";
import { StatusBar } from "./components/StatusBar";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { GenerationSettingsDialog } from "./components/GenerationSettingsDialog";
import { HelpSettingsProvider } from "./help/HelpSettingsContext";
import { GenerationSettingsProvider, useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { useDocument } from "./hooks/useDocument";
import type { TabId } from "./types";
import type { Diagnostic } from "./parser/types";
import type { ResourceTotals } from "./parser/resourceTotals";
import styles from "./App.module.css";
import "./App.css";

const EMPTY_RESOURCE_TOTALS: ResourceTotals = {
  total: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
  player: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
  neutral: { min: { food: 0, wood: 0, gold: 0, stone: 0 }, max: { food: 0, wood: 0, gold: 0, stone: 0 } },
};

// Split out from App so it can call useGenerationSettings — the hook
// needs to run below GenerationSettingsProvider in the tree, same reason
// PreferencesDialog/HelpTip call useHelpSettings rather than App itself.
function AppContent() {
  // activeTab is "lifted" here because both TabBar (which sets it) and
  // the panes below (which read it) need access to the same value.
  const [activeTab, setActiveTab] = useState<TabId>("breakdown");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [generationSettingsOpen, setGenerationSettingsOpen] = useState(false);
  // Diagnostics and resource totals are lifted the same way: CodePane
  // owns the live parse (it mounts the worker), but StatusBar needs the
  // results too. Deliberately NOT cleared when CodePane unmounts (e.g.
  // switching to the Breakdown tab) — they reflect the last known parse,
  // like most editors' Problems panels.
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [resourceTotals, setResourceTotals] = useState<ResourceTotals>(EMPTY_RESOURCE_TOTALS);
  const handleDiagnosticsChange = useCallback((next: Diagnostic[]) => {
    setDiagnostics(next);
  }, []);
  const handleResourceTotalsChange = useCallback((next: ResourceTotals) => {
    setResourceTotals(next);
  }, []);
  const doc = useDocument();
  const { playerCount } = useGenerationSettings();

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
          <PlaceholderPane description="Breakdown editor — arrives in Phase 3." />
        )}
        {activeTab === "code" && (
          <CodePane
            content={doc.content}
            onChange={doc.setContent}
            hasFile={doc.filePath !== null}
            playerCount={playerCount}
            onDiagnosticsChange={handleDiagnosticsChange}
            onResourceTotalsChange={handleResourceTotalsChange}
          />
        )}
        {activeTab === "advanced-tools" && (
          <PlaceholderPane description="Advanced Tools pane — arrives in Phase 5." />
        )}
      </main>
      <StatusBar
        diagnostics={diagnostics}
        total={resourceTotals.total}
        player={resourceTotals.player}
        neutral={resourceTotals.neutral}
        onOpenGenerationSettings={() => setGenerationSettingsOpen(true)}
      />
      {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
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
