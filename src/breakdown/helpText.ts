// Per-attribute/argument hover text for Breakdown labels, reads the same
// underlying data src/editor/aoe2RmsHover.ts's Monaco hover provider reads
// (reference/data/doc-strings.json, falling back to reference/data/language.json's
// own `description` fields) so Breakdown and hover can never disagree
// (docs/breakdown-design.md Sec.8's help-coverage rule). This is a smaller
// module than aoe2RmsHover.ts on purpose. HelpTip's popup is plain text,
// not Monaco's richer markdown (signature blocks, cautions, verified
// badge), so this only needs the summary lookup, not the full formatter.
import docStringsDataRaw from "../../reference/data/doc-strings.json";
import type { ArgumentType } from "../parser/language";

interface DocEntry {
  key: string;
  kind: string;
  summary: string;
  details?: string;
}
interface DocStringsData {
  entries: DocEntry[];
}
const docStringsData = docStringsDataRaw as DocStringsData;
const DOC_BY_KEY = new Map(docStringsData.entries.map((e) => [e.key, e]));

/** doc-strings.json's summary for `name`, if an entry exists, undefined otherwise. Callers supply their own fallback (usually the def's own `description`). */
export function docSummary(name: string): string | undefined {
  return DOC_BY_KEY.get(name)?.summary;
}

/**
 * Hover text for an attribute or command name: doc-strings.json's summary
 * first, then the reference-data `description` field, then a generic
 * fallback that still says something useful rather than nothing.
 */
export function namedEntryHelpText(
  name: string,
  description: string | undefined,
): string {
  return (
    docSummary(name) ??
    description ??
    `No documentation yet for "${name}". Contribute an entry to reference/data/doc-strings.json.`
  );
}

interface ArgumentLike {
  name: string;
  type: ArgumentType;
  min?: number;
  max?: number;
  default?: number | string;
  description?: string;
}

/**
 * Hover text for one argument slot: what it means (the def's own
 * `description`, when one is written), then its range and default. Returns
 * undefined when there is nothing of that to say, and the caller passes
 * `null` to HelpTip so no popup opens, a tip that only restates the argument's
 * type or the command's name teaches nothing.
 *
 * Deliberately does not look the argument up in doc-strings.json. Argument
 * names such as `percent` or `distance` repeat across dozens of attributes
 * and mean something different in each, so a name-keyed lookup could only
 * ever show the wrong one. `showName` prefixes the argument's name for an
 * attribute with several slots (circle_radius takes a radius and a variance),
 * where the tip would otherwise not say which box it is for.
 */
export function argumentHelpText(
  arg: ArgumentLike | undefined,
  showName = false,
): string | undefined {
  if (!arg) return undefined;
  const parts: string[] = [];
  if (arg.description) parts.push(arg.description);
  if (arg.min !== undefined && arg.max !== undefined) {
    parts.push(`Range ${arg.min}–${arg.max}.`);
  } else if (arg.min !== undefined) {
    parts.push(`Min ${arg.min}.`);
  } else if (arg.max !== undefined) {
    parts.push(`Max ${arg.max}.`);
  }
  if (arg.default !== undefined) parts.push(`Default ${arg.default}.`);
  if (parts.length === 0) return undefined;
  const text = parts.join(" ");
  return showName ? `Argument ${arg.name}. ${text}` : text;
}
