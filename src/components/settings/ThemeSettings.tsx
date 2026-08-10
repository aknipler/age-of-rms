import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function ThemeSettings() {
  return (
    <SettingsPlaceholder
      title="Theme"
      description="The app ships one light theme for now."
      planned={["Light and dark app themes", "Monaco editor colour scheme", "Interface font size"]}
    />
  );
}
