import type { ComponentType } from "react";
import { GeneralSettings } from "./GeneralSettings";
import { HotkeysSettings } from "./HotkeysSettings";
import { ThemeSettings } from "./ThemeSettings";
import { BreakdownSettings } from "./BreakdownSettings";
import { CodeSettings } from "./CodeSettings";
import { AdvancedToolsSettings } from "./AdvancedToolsSettings";
import { CreditsSettings } from "./CreditsSettings";

export type SettingsTabId =
  | "general"
  | "hotkeys"
  | "theme"
  | "breakdown"
  | "code"
  | "advanced-tools"
  | "credits";

interface SettingsTab {
  id: SettingsTabId;
  label: string;
  /** Matches an id in reference/data/ui-help.json. */
  helpId: string;
  /**
   * The panel component itself, not an element — SettingsDialog picks one
   * out of this table and renders `<Panel />`. Storing the component in
   * data (rather than a switch statement in the dialog) means adding a tab
   * is one entry here plus one file, and the dialog never changes.
   */
  Panel: ComponentType;
}

// Order is the order they appear down the strip. Most tabs are empty
// placeholders for now; each names what it will hold so the shape of the
// dialog is legible before the settings themselves exist.
export const SETTINGS_TABS: ReadonlyArray<SettingsTab> = [
  { id: "general", label: "General", helpId: "settings.tab.general", Panel: GeneralSettings },
  { id: "hotkeys", label: "Hotkeys", helpId: "settings.tab.hotkeys", Panel: HotkeysSettings },
  { id: "theme", label: "Theme", helpId: "settings.tab.theme", Panel: ThemeSettings },
  { id: "breakdown", label: "Breakdown", helpId: "settings.tab.breakdown", Panel: BreakdownSettings },
  { id: "code", label: "Code", helpId: "settings.tab.code", Panel: CodeSettings },
  {
    id: "advanced-tools",
    label: "Advanced Tools",
    helpId: "settings.tab.advancedTools",
    Panel: AdvancedToolsSettings,
  },
  // Last in the strip: it's the one tab nothing is configured from, so it
  // shouldn't sit between two that are.
  { id: "credits", label: "Credits", helpId: "settings.tab.credits", Panel: CreditsSettings },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "general";
