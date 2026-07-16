import type { TabId } from "../types";
import styles from "./TabBar.module.css";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "breakdown", label: "Breakdown" },
  { id: "code", label: "Code" },
  { id: "advanced-tools", label: "Advanced Tools" },
];

interface TabBarProps {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

// Controlled component: App owns `activeTab` state and passes it down,
// TabBar just renders it and reports clicks back up via onSelect. This
// "state lives in the parent, children are just props+callbacks" pattern
// is called lifting state up — it's how React shares state between
// siblings (TabBar and the pane below it both need to know the active tab).
export function TabBar({ activeTab, onSelect }: TabBarProps) {
  return (
    <div className={styles.tabBar} role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
