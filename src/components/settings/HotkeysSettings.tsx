import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function HotkeysSettings() {
  return (
    <SettingsPlaceholder
      title="Hotkeys"
      description="Keyboard shortcuts aren't customisable yet."
      planned={[
        "Rebind the file actions (open, save, save as)",
        "Rebind tab switching and pane focus",
        "Reset every binding to its default",
      ]}
    />
  );
}
