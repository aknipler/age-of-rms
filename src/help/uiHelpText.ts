// The ui-help.json lookup, split out of HelpTip.tsx so it has a home that
// isn't a component file. Two reasons, one practical and one structural:
// Fast Refresh only works on a module whose exports are all components, so
// a plain function exported from HelpTip.tsx costs the whole file its hot
// reload; and StatusBar composes live text onto a written entry, which
// makes this a second caller rather than a HelpTip implementation detail.
//
// Same shape as helpConstants.ts, which exists so the React context and the
// imperative Monaco hover provider agree on one persisted key.

import uiHelpDataRaw from "../../reference/data/ui-help.json";

interface UiHelpEntry {
  id: string;
  text: string;
}
interface UiHelpData {
  entries: UiHelpEntry[];
}

const uiHelpData = uiHelpDataRaw as UiHelpData;
const HELP_TEXT_BY_ID = new Map(uiHelpData.entries.map((entry) => [entry.id, entry.text]));

/** The written help for an id, or undefined when nobody has authored one yet. */
export function helpTextFor(id: string): string | undefined {
  return HELP_TEXT_BY_ID.get(id);
}
