import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function BreakdownSettings() {
  return (
    <SettingsPlaceholder
      title="Breakdown"
      description="Nothing about the Breakdown editor is configurable yet."
      planned={[
        "Which sections start expanded",
        "Whether comments are shown alongside commands",
        "Default state of the diagnostics ruler",
      ]}
    />
  );
}
