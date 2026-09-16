// The standard comment AoRMS stamps at the top of a script it created.
//
// Pure: no React, no Monaco, no Tauri. Split out of useDocument.ts for the
// same reason components/statusFormat.ts is split out of StatusBar.tsx, the
// formatting rules are the part worth unit-testing, and a hook that only
// runs inside a Tauri window is the one place they could not be tested from.
//
// TWO THINGS TO KNOW BEFORE EDITING THE LAYOUT BELOW.
//
// 1. RMS comment markers are whole tokens, not character sequences. The lexer
//    (src/parser/lexer.ts) splits on whitespace and only then asks whether a
//    token IS "/*" or "*/", so both markers have to stand alone, separated
//    by whitespace from everything around them. A closing "====*/" would not
//    close the comment; it would lex as one `word` and the rest of the script
//    would stay commented out, silently, with the map still generating.
//    That is why each marker gets its own line and why the rules are drawn
//    with "=" rather than the "*" a C-style banner would use.
//
// 2. Anything written inside the comment is still read by the game engine's
//    constant resolution. A word in a comment that happens to be a constant
//    whose value is 69 opens a SECOND comment (see diagnostics.ts's
//    RMS0301/commentOpensNestedComment), which hides the rest of the file.
//    Nothing this module writes on its own can do that, but the author name
//    and file name come from outside, so keep them out of the shapes that
//    matter; see sanitizeField.
//
// OWNERSHIP IS PER ROW, NOT PER BLOCK. The app keeps refreshing the rows it
// still recognises as its own and leaves the rest alone, so correcting the
// created date by hand costs you nothing else; see `refreshScriptHeader`.

/** Every field the stamped comment carries. Dates are `Date` so formatting stays this module's business. */
export interface ScriptHeaderFields {
  /** The script's file name including its extension, e.g. `Sacred Springs.rms`. */
  fileName: string;
  /** Whatever the author has put in Settings > General; blank is normal and handled. */
  author: string;
  /** When the script was first written to disk. */
  created: Date;
  /** When it was last written to disk. */
  modified: Date;
  /** `__APP_VERSION__`, i.e. the app version out of package.json. */
  appVersion: string;
}

/**
 * The rows, in the order they are printed.
 *
 * A `const` array with a type derived from it, rather than a TypeScript
 * `enum`: the array is the printing order AND the set of legal keys, so
 * adding a row here is the whole change. `(typeof HEADER_FIELDS)[number]`
 * reads the union of its element types straight back out, the standard TS
 * idiom for "these exact strings", and unlike an enum it survives into plain
 * JavaScript as ordinary data.
 */
export const HEADER_FIELDS = [
  "file",
  "author",
  "created",
  "modified",
  "builtWith",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

/**
 * The one-line signature that identifies a block as ours.
 *
 * Deliberately the product name rather than a machine-readable marker: the
 * comment is meant to be read and freely edited by a human, so it does not
 * get a hidden tag telling them not to touch part of it.
 */
export const HEADER_SIGNATURE = "AoRMS";

const LABELS: Record<HeaderField, string> = {
  file: "File",
  author: "Author",
  created: "Created",
  modified: "Last modified",
  builtWith: `${HEADER_SIGNATURE} version`,
};

/**
 * The rows the app rewrites on every save, as opposed to the ones it writes
 * once and never touches again.
 *
 * `created` is a fact about the script rather than about this save. `author`
 * is deliberately here too: changing the setting names the author of scripts
 * written from then on, and silently re-attributing a script somebody already
 * saved is not a thing a text editor should do.
 */
const REFRESHED_FIELDS: readonly HeaderField[] = [
  "file",
  "modified",
  "builtWith",
];

/** Shown in place of an author who has not filled the setting in. */
export const UNKNOWN_AUTHOR = "Unknown";

/**
 * Shortest the "=" rules are ever drawn, a width that keeps a typical header
 * inside 80 columns and, more to the point, keeps every header the same size
 * as every other one. The rules grow past this only when a row would
 * otherwise stick out past them (see `ruleFor`), which a long file name does.
 */
const MIN_RULE_WIDTH = 62;

/** Label column width, the longest label ("Last modified") plus the two-space gutter. */
const LABEL_WIDTH = 15;

/** What goes between the stamped comment and whatever the script already had. One blank line, so the block reads as separate from the code. */
export const HEADER_SEPARATOR = "\n\n";

/**
 * What the app remembers about the header it wrote, so it can tell its own
 * rows from a person's on the next save.
 *
 * `rows` holds each line EXACTLY as written. That is the whole ownership
 * test: a line still present, byte for byte, in the document is one nobody
 * has touched. The alternative, re-parsing the block and deciding how much
 * drift still counts as ours, has to answer "how edited is edited", and
 * every answer to that eventually rewrites something a person typed.
 *
 * `owned` only ever shrinks. Once a row leaves the set it does not come back,
 * even if a later edit happens to restore the original text, because the
 * point is that a person has taken that row over.
 */
export interface StampedHeader {
  /** Values as the app last wrote them. Its own record, not a reading of the document. */
  readonly fields: ScriptHeaderFields;
  /** Each row exactly as written. Rows outside `owned` are stale and unused. */
  readonly rows: Readonly<Record<HeaderField, string>>;
  /** The rule line, written twice, above and below the rows. */
  readonly rule: string;
  /** Rows the app may still rewrite. */
  readonly owned: ReadonlySet<HeaderField>;
}

/** A byte-range replacement, the same shape `useDocument.applyTextEdits` takes. */
export interface HeaderEdit {
  readonly start: number;
  readonly end: number;
  readonly newText: string;
}

/**
 * Strip anything from an outside-supplied value that would change what the
 * comment IS rather than what it says.
 *
 * Newlines would break the one-field-per-line layout, and would also break
 * ownership: a row is matched as a whole line, so a value containing a line
 * break could never be found again. A literal comment-close marker typed into
 * the author field would end the comment early, leaving the rest of the
 * header as live script, the engine would then try to run "Author" as a
 * command. Windows file names cannot contain either, but the author name is
 * free text.
 */
function sanitizeField(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\/\*|\*\//g, "")
    .trim();
}

/** `23/08/2026`, the same day/month/year order MapHeader's "Last Saved" already uses. */
function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

function valueFor(field: HeaderField, fields: ScriptHeaderFields): string {
  switch (field) {
    case "file":
      return sanitizeField(fields.fileName);
    case "author":
      return sanitizeField(fields.author) || UNKNOWN_AUTHOR;
    case "created":
      return formatDate(fields.created);
    case "modified":
      return formatDate(fields.modified);
    case "builtWith":
      return sanitizeField(fields.appVersion);
  }
}

function renderRow(field: HeaderField, fields: ScriptHeaderFields): string {
  return `   ${LABELS[field].padEnd(LABEL_WIDTH)}${valueFor(field, fields)}`;
}

function renderRows(fields: ScriptHeaderFields): Record<HeaderField, string> {
  // `Object.fromEntries` loses the key union (it returns a plain index
  // signature), so the assertion puts it back. The alternative is a hand-
  // written object literal repeating all five keys, which is the thing
  // HEADER_FIELDS exists to avoid.
  return Object.fromEntries(
    HEADER_FIELDS.map((field) => [field, renderRow(field, fields)]),
  ) as Record<HeaderField, string>;
}

/**
 * The top and bottom rules, drawn wide enough to enclose the widest row.
 *
 * The rules are one character shorter than the width they span because they
 * start one space in, matching the indent the rows sit at. Growing them
 * rather than truncating the value: a file name is a fact about the script
 * and the box is decoration, so the decoration is what gives way.
 */
function ruleFor(rows: Readonly<Record<HeaderField, string>>): string {
  const widest = HEADER_FIELDS.reduce(
    (longest, field) => Math.max(longest, rows[field].length),
    0,
  );
  return ` ${"=".repeat(Math.max(MIN_RULE_WIDTH, widest - 1))}`;
}

function assemble(
  rows: Readonly<Record<HeaderField, string>>,
  rule: string,
): string {
  return [
    "/*",
    rule,
    ...HEADER_FIELDS.map((field) => rows[field]),
    rule,
    "*/",
  ].join("\n");
}

/** A freshly written header: the text to insert, and the record that makes later refreshes possible. */
export interface HeaderStamp {
  readonly text: string;
  readonly stamped: StampedHeader;
}

/** Render the block for a script being saved for the first time. No trailing newline. The caller decides what separates it from the script below. */
export function buildScriptHeader(fields: ScriptHeaderFields): HeaderStamp {
  const rows = renderRows(fields);
  const rule = ruleFor(rows);
  return {
    text: assemble(rows, rule),
    stamped: { fields, rows, rule, owned: new Set(HEADER_FIELDS) },
  };
}

/** The values that can change between one save and the next. */
export interface RefreshedValues {
  /** Follows Save As to a new name. */
  fileName: string;
  /** The version doing the saving, which is not necessarily the one that created the file. */
  appVersion: string;
  /** Now. */
  modified: Date;
}

/** Edits to apply, and the narrowed record to remember. `edits` is empty when there is nothing to do, which is the common case. */
export interface HeaderRefresh {
  readonly edits: readonly HeaderEdit[];
  readonly stamped: StampedHeader;
}

interface SourceLine {
  readonly text: string;
  readonly start: number;
}

function splitLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  for (;;) {
    const brk = source.indexOf("\n", start);
    if (brk === -1) {
      lines.push({ text: source.slice(start), start });
      return lines;
    }
    // Trailing "\r" is dropped from the compared text but still counted in
    // the offsets, so a file saved with CRLF endings matches its rows and the
    // replacement lands in the right place. Monaco normalises what it writes,
    // but a file can arrive from anywhere.
    const raw = source.slice(start, brk);
    lines.push({ text: raw.endsWith("\r") ? raw.slice(0, -1) : raw, start });
    start = brk + 1;
  }
}

/**
 * Where `text` sits in the document, if it appears as a complete line exactly
 * once.
 *
 * Uniqueness is the safety property. A row that appears twice, someone has
 * copied the header as a template for another script, most likely, gives no
 * way to tell which one the app wrote, and rewriting the wrong one would edit
 * text that was never ours. Two matches is treated exactly like none: the row
 * stops being ours and is left alone from then on.
 */
function uniqueLine(
  lines: readonly SourceLine[],
  text: string,
): SourceLine | null {
  let found: SourceLine | null = null;
  for (const line of lines) {
    if (line.text !== text) continue;
    if (found) return null;
    found = line;
  }
  return found;
}

/**
 * Bring the header up to date, row by row.
 *
 * Each row is looked for on its own, so the rows a person has edited and the
 * rows they have not are handled independently: correct the created date by
 * hand and the file name, modified date and version carry on updating around
 * it. That is the difference from checking the block as a whole, where one
 * hand-edited character froze the entire comment.
 *
 * Rows are matched anywhere in the document rather than inside a located
 * block, which sounds looser than it is. The search key is a full line
 * carrying an exact label, column padding and value, and it must be unique.
 * It buys tolerance for the things people actually do: adding a line inside
 * the box, putting another comment above the header, reordering the rows.
 */
export function refreshScriptHeader(
  source: string,
  stamped: StampedHeader,
  next: RefreshedValues,
): HeaderRefresh {
  const lines = splitLines(source);
  const owned = new Set(stamped.owned);
  const rows: Record<HeaderField, string> = { ...stamped.rows };
  const fields: ScriptHeaderFields = { ...stamped.fields };
  const edits: HeaderEdit[] = [];

  for (const field of HEADER_FIELDS) {
    if (!owned.has(field)) continue;

    const previous = stamped.rows[field];
    const at = uniqueLine(lines, previous);
    if (!at) {
      // Edited, deleted, or duplicated. Whichever it was, the app no longer
      // knows where that row is, and guessing is how it would overwrite one.
      owned.delete(field);
      continue;
    }
    if (!REFRESHED_FIELDS.includes(field)) continue;

    // Only the refreshed fields take new values; `created` and `author` are
    // copied from the previous record untouched.
    if (field === "file") fields.fileName = next.fileName;
    if (field === "modified") fields.modified = next.modified;
    if (field === "builtWith") fields.appVersion = next.appVersion;

    const rendered = renderRow(field, fields);
    rows[field] = rendered;
    // Dates render to the day and the version rarely moves, so most saves
    // rebuild an identical row. Comparing first keeps those saves off the
    // undo stack entirely rather than pushing a no-op edit for every Ctrl+S.
    if (rendered !== previous) {
      edits.push({
        start: at.start,
        end: at.start + previous.length,
        newText: rendered,
      });
    }
  }

  const rule = ruleFor(rows);
  if (rule !== stamped.rule) {
    // The rules are the one part written twice, so "appears exactly once"
    // cannot be the test for them. Both copies have to be present and
    // untouched before either is redrawn; otherwise the box keeps whatever
    // width it has and a long value simply overhangs it.
    const matches = lines.filter((line) => line.text === stamped.rule);
    if (matches.length === 2) {
      for (const match of matches) {
        edits.push({
          start: match.start,
          end: match.start + stamped.rule.length,
          newText: rule,
        });
      }
      return { edits, stamped: { fields, rows, rule, owned } };
    }
  }

  return { edits, stamped: { fields, rows, rule: stamped.rule, owned } };
}
