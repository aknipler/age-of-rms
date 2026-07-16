import { useState } from "react";
import { TitleBar } from "./components/TitleBar";
import { MapHeader } from "./components/MapHeader";
import { TabBar } from "./components/TabBar";
import { PlaceholderPane } from "./components/PlaceholderPane";
import { CodePane } from "./components/CodePane";
import { StatusBar } from "./components/StatusBar";
import { PreferencesDialog } from "./components/PreferencesDialog";
import { HelpSettingsProvider } from "./help/HelpSettingsContext";
import { useDocument } from "./hooks/useDocument";
import type { TabId } from "./types";
import styles from "./App.module.css";
import "./App.css";

function App() {
  // activeTab is "lifted" here because both TabBar (which sets it) and
  // the panes below (which read it) need access to the same value.
  const [activeTab, setActiveTab] = useState<TabId>("breakdown");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const doc = useDocument();

  return (
    <HelpSettingsProvider>
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
            />
          )}
          {activeTab === "advanced-tools" && (
            <PlaceholderPane description="Advanced Tools pane — arrives in Phase 5." />
          )}
        </main>
        <StatusBar />
        {preferencesOpen && <PreferencesDialog onClose={() => setPreferencesOpen(false)} />}
      </div>
    </HelpSettingsProvider>
  );
}

export default App;
