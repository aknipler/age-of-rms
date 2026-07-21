// Per-attribute/argument hover text for Breakdown labels — reads the same
// underlying data src/editor/aoe2RmsHover.ts's Monaco hover provider reads
// (reference/data/doc-strings.json, falling back to reference/data/language.json's
// own `description` fields) so Breakdown and hover can never disagree
// (docs/breakdown-design.md §8's help-coverage rule). This is a smaller
// module than aoe2RmsHover.ts on purpose — HelpTip's popup is plain text,
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

/** doc-strings.json's summary for `name`, if an entry exists — undefined otherwise. Callers supply their own fallback (usually the def's own `description`). */
export function docSummary(name: string): string | undefined {
  return DOC_BY_KEY.get(name)?.summary;
}

/**
 * Hover text for an attribute or command name: doc-strings.json's summary
 * first, then the reference-data `description` field, then a generic
 * fallback that still says something useful rather than nothing.
 */
export function namedEntryHelpText(name: string, description: string | undefined): string {
  return (
    docSummary(name) ??
    description ??
    `No documentation yet for "${name}" — contribute an entry to reference/data/doc-strings.json.`
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
 * Hover text for a positional argument. Most positional args (unlike
 * attributes) have no dedicated language.json `description` today — the
 * fallback composes something from the type/range/default rather than a
 * bare "a positional argument" placeholder, so at minimum the type and
 * legal range are visible on hover even with no prose written yet.
 */
export function argumentHelpText(arg: ArgumentLike | undefined, contextName: string): string {
  if (!arg) return `A positional argument for "${contextName}".`;
  const fromDocs = docSummary(arg.name) ?? arg.description;
  if (fromDocs) return fromDocs;
  const parts = [`A ${arg.type} argument for "${contextName}".`];
  if (arg.min !== undefined || arg.max !== undefined) {
    parts.push(`Range ${arg.min ?? "?"}–${arg.max ?? "?"}.`);
  }
  if (arg.default !== undefined) {
    parts.push(`Default ${arg.default}.`);
  }
  return parts.join(" ");
}
