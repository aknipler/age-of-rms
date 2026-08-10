import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function CodeSettings() {
  return (
    <SettingsPlaceholder
      title="Code"
      description="The code editor uses its built-in defaults for now."
      planned={[
        "Tab width and whether tabs insert spaces",
        "Word wrap, line numbers and the minimap",
        "Which diagnostic severities show as editor markers",
      ]}
    />
  );
}
