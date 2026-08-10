import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function AdvancedToolsSettings() {
  return (
    <SettingsPlaceholder
      title="Advanced Tools"
      description="The Advanced Tools pane itself hasn't been built yet, so it has nothing to configure."
      planned={["Which tools appear in the pane", "Per-tool defaults", "Where generated output is written"]}
    />
  );
}
