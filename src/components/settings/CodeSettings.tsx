import { SettingsPlaceholder } from "./SettingsPlaceholder";

export function CodeSettings() {
  return (
    <SettingsPlaceholder
      title="Code"
      description="The code editor follows whichever theme is active on the Theme tab (light, dark, or a custom one). Everything else still uses its built-in defaults."
      planned={[
        "Tab width and whether tabs insert spaces",
        "Word wrap, line numbers and the minimap",
        "Which diagnostic severities show as editor markers",
      ]}
    />
  );
}
