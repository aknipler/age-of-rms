import { describe, expect, it } from "vitest";
import { tokenize } from "../../parser/lexer";
import {
  buildScriptHeader,
  HEADER_SEPARATOR,
  HEADER_SIGNATURE,
  refreshScriptHeader,
  UNKNOWN_AUTHOR,
  type HeaderEdit,
  type RefreshedValues,
  type ScriptHeaderFields,
  type StampedHeader,
} from "../scriptHeader";

const FIELDS: ScriptHeaderFields = {
  fileName: "Sacred Springs.rms",
  author: "Ash",
  created: new Date(2026, 7, 3),
  modified: new Date(2026, 7, 3),
  appVersion: "0.1.1",
};

const SCRIPT = "<PLAYER_SETUP>\nrandom_placement\n";

/** A document as the app would have written it, plus the record it kept. */
function stampedDocument(fields: ScriptHeaderFields = FIELDS) {
  const { text, stamped } = buildScriptHeader(fields);
  return { source: `${text}${HEADER_SEPARATOR}${SCRIPT}`, stamped };
}

/** What `useDocument` does with the edits: apply them, back to front, to get the new document. */
function applyEdits(source: string, edits: readonly HeaderEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of ordered) {
    result =
      result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
  }
  return result;
}

/** A save on a later day, same file, same app version, unless overridden. */
function laterSave(over: Partial<RefreshedValues> = {}): RefreshedValues {
  return {
    fileName: FIELDS.fileName,
    appVersion: FIELDS.appVersion,
    modified: new Date(2026, 7, 23),
    ...over,
  };
}

function rowFor(source: string, label: string): string {
  const row = source
    .split("\n")
    .find((line) => line.trimStart().startsWith(label));
  if (!row) throw new Error(`no "${label}" row in:\n${source}`);
  return row.trim();
}

describe("buildScriptHeader", () => {
  it("carries all five fields", () => {
    const { text } = buildScriptHeader(FIELDS);
    expect(rowFor(text, "File")).toBe("File           Sacred Springs.rms");
    expect(rowFor(text, "Author")).toBe("Author         Ash");
    expect(rowFor(text, "Created")).toBe("Created        03/08/2026");
    expect(rowFor(text, "Last modified")).toBe("Last modified  03/08/2026");
    expect(rowFor(text, `${HEADER_SIGNATURE} version`)).toBe(
      `${HEADER_SIGNATURE} version  0.1.1`,
    );
  });

  it("names an unset author rather than leaving the row blank", () => {
    expect(buildScriptHeader({ ...FIELDS, author: "   " }).text).toContain(
      UNKNOWN_AUTHOR,
    );
  });

  it("zero-pads a single-digit day and month", () => {
    // Not cosmetic. A row is matched as an exact string on the next save, so
    // a date that changes width changes what has to be found.
    const { text } = buildScriptHeader({
      ...FIELDS,
      modified: new Date(2026, 0, 5),
    });
    expect(text).toContain("05/01/2026");
  });

  it("lines every value up in one column", () => {
    const columns = buildScriptHeader(FIELDS)
      .text.split("\n")
      .filter((line) => /^ {3}\S/.test(line))
      .map((line) => line.search(/ {2}\S+$|(?<= {2})\S/));
    expect(new Set(columns).size).toBe(1);
  });

  it("starts every row owned", () => {
    expect([...buildScriptHeader(FIELDS).stamped.owned].sort()).toEqual([
      "author",
      "builtWith",
      "created",
      "file",
      "modified",
    ]);
  });

  it("widens the rules rather than truncating a long file name", () => {
    const long =
      "A Really Very Long Map Name That Runs Past The Standard Box Width.rms";
    const lines = buildScriptHeader({ ...FIELDS, fileName: long }).text.split(
      "\n",
    );
    const rule = lines[1];

    expect(lines).toContain(`   File           ${long}`);
    expect(rule.length).toBeGreaterThanOrEqual(
      `   File           ${long}`.length - 1,
    );
    expect(lines[lines.length - 2]).toBe(rule);
  });
});

// The reason this is its own module rather than a template string inside
// useDocument: the header is RMS source, and RMS's comment markers are whole
// tokens. These run the app's own lexer over the block to prove the engine
// would read it as one comment and nothing else.
describe("the stamped header as RMS", () => {
  it("lexes as a single comment with no live tokens after it", () => {
    const { source } = stampedDocument();
    const live = tokenize(source).tokens.filter((token) => !token.isTrivia);
    expect(live.map((token) => token.text)).toEqual([
      "<PLAYER_SETUP>",
      "random_placement",
    ]);
  });

  it("opens and closes with standalone markers", () => {
    const { tokens } = tokenize(buildScriptHeader(FIELDS).text);
    expect(tokens.filter((token) => token.kind === "commentOpen")).toHaveLength(
      1,
    );
    expect(
      tokens.filter((token) => token.kind === "commentClose"),
    ).toHaveLength(1);
  });

  it("produces no lexer diagnostics", () => {
    // Chiefly RMS0001 (unclosed comment) and RMS0003 (a marker glued into a
    // larger token), the two ways a decorative banner silently eats a script.
    expect(tokenize(buildScriptHeader(FIELDS).text).diagnostics).toEqual([]);
  });

  it("survives an author name that would otherwise close the comment", () => {
    const { text } = buildScriptHeader({
      ...FIELDS,
      author: "*/ create_object SCOUT /*",
    });
    const { tokens, diagnostics } = tokenize(
      `${text}${HEADER_SEPARATOR}<PLAYER_SETUP>\n`,
    );

    expect(diagnostics).toEqual([]);
    expect(
      tokens.filter((token) => !token.isTrivia).map((token) => token.text),
    ).toEqual(["<PLAYER_SETUP>"]);
  });

  it("keeps a pasted multi-line author on one row", () => {
    const { text } = buildScriptHeader({
      ...FIELDS,
      author: "Ash\nSecond line",
    });
    expect(text.split("\n")).toHaveLength(9);
  });
});

describe("refreshScriptHeader", () => {
  it("updates the modified date on a later save", () => {
    const { source, stamped } = stampedDocument();
    const refreshed = applyEdits(
      source,
      refreshScriptHeader(source, stamped, laterSave()).edits,
    );

    expect(rowFor(refreshed, "Last modified")).toBe(
      "Last modified  23/08/2026",
    );
    expect(rowFor(refreshed, "Created")).toBe("Created        03/08/2026");
  });

  it("makes no edit at all when nothing has changed", () => {
    // Two saves on the same day must not push a no-op onto the undo stack.
    const { source, stamped } = stampedDocument();
    const same = laterSave({ modified: FIELDS.modified });
    expect(refreshScriptHeader(source, stamped, same).edits).toEqual([]);
  });

  it("follows the file name through Save As", () => {
    const { source, stamped } = stampedDocument();
    const refresh = refreshScriptHeader(
      source,
      stamped,
      laterSave({ fileName: "Copy.rms" }),
    );

    expect(rowFor(applyEdits(source, refresh.edits), "File")).toBe(
      "File           Copy.rms",
    );
  });

  it("updates the version when a newer build saves the file", () => {
    const { source, stamped } = stampedDocument();
    const refresh = refreshScriptHeader(
      source,
      stamped,
      laterSave({ appVersion: "0.2.0" }),
    );

    expect(
      rowFor(applyEdits(source, refresh.edits), `${HEADER_SIGNATURE} version`),
    ).toBe(`${HEADER_SIGNATURE} version  0.2.0`);
  });

  it("leaves the script below the header untouched", () => {
    const { source, stamped } = stampedDocument();
    const refreshed = applyEdits(
      source,
      refreshScriptHeader(source, stamped, laterSave()).edits,
    );
    expect(refreshed.endsWith(`${HEADER_SEPARATOR}${SCRIPT}`)).toBe(true);
  });

  it("still lexes as one comment after a refresh", () => {
    const { source, stamped } = stampedDocument();
    const refreshed = applyEdits(
      source,
      refreshScriptHeader(source, stamped, laterSave()).edits,
    );
    const live = tokenize(refreshed).tokens.filter((token) => !token.isTrivia);

    expect(live.map((token) => token.text)).toEqual([
      "<PLAYER_SETUP>",
      "random_placement",
    ]);
  });
});

// The point of tracking ownership per row rather than per block: one
// hand-edited row must not freeze the other four.
describe("refreshScriptHeader ownership, row by row", () => {
  /** Hand-edit one row of the document, the way someone would in the Code tab. */
  function handEdit(
    source: string,
    label: string,
    replacement: string,
  ): string {
    return source.replace(rowFor(source, label), replacement);
  }

  it("keeps refreshing the other rows after the created date is corrected by hand", () => {
    const { source, stamped } = stampedDocument();
    const edited = handEdit(
      source,
      "Created",
      "Created        first written in 2019",
    );

    const refresh = refreshScriptHeader(
      edited,
      stamped,
      laterSave({ fileName: "Renamed.rms" }),
    );
    const result = applyEdits(edited, refresh.edits);

    expect(rowFor(result, "Created")).toBe(
      "Created        first written in 2019",
    );
    expect(rowFor(result, "Last modified")).toBe("Last modified  23/08/2026");
    expect(rowFor(result, "File")).toBe("File           Renamed.rms");
    expect(refresh.stamped.owned.has("created")).toBe(false);
    expect(refresh.stamped.owned.has("modified")).toBe(true);
  });

  it("stops touching a modified date the user has taken over, and only that row", () => {
    const { source, stamped } = stampedDocument();
    const edited = handEdit(
      source,
      "Last modified",
      "Last modified  whenever I say",
    );

    const refresh = refreshScriptHeader(
      edited,
      stamped,
      laterSave({ fileName: "Renamed.rms" }),
    );
    const result = applyEdits(edited, refresh.edits);

    expect(rowFor(result, "Last modified")).toBe(
      "Last modified  whenever I say",
    );
    expect(rowFor(result, "File")).toBe("File           Renamed.rms");
  });

  it("latches: a row stays un-owned even if its original text comes back", () => {
    const { source, stamped } = stampedDocument();
    const edited = handEdit(source, "Author", "Author         Someone else");
    const afterEdit = refreshScriptHeader(edited, stamped, laterSave()).stamped;
    // Only that row went, otherwise the assertion below would pass for the
    // wrong reason.
    expect(afterEdit.owned.has("author")).toBe(false);
    expect(afterEdit.owned.has("file")).toBe(true);

    // The user undoes their rename, so the row reads exactly as the app wrote
    // it. It is still theirs.
    const second = refreshScriptHeader(source, afterEdit, laterSave());
    expect(second.stamped.owned.has("author")).toBe(false);
    expect(second.stamped.owned.has("file")).toBe(true);
  });

  it("gives up a row that has been deleted outright", () => {
    const { source, stamped } = stampedDocument();
    const withoutAuthor = source
      .split("\n")
      .filter((line) => !line.includes("Author"))
      .join("\n");

    const refresh = refreshScriptHeader(withoutAuthor, stamped, laterSave());
    expect(refresh.stamped.owned.has("author")).toBe(false);
    expect(refresh.stamped.owned.has("modified")).toBe(true);
  });

  it("gives up every row when the whole comment is deleted", () => {
    const { stamped } = stampedDocument();
    const refresh = refreshScriptHeader(SCRIPT, stamped, laterSave());

    expect(refresh.edits).toEqual([]);
    expect(refresh.stamped.owned.size).toBe(0);
  });

  it("refuses to guess when a row appears twice", () => {
    // Someone has copied the header to the bottom as a template. Neither copy
    // is safely identifiable as the one the app wrote, so it edits neither.
    const { source, stamped } = stampedDocument();
    const duplicated = `${source}\n${buildScriptHeader(FIELDS).text}\n`;

    const refresh = refreshScriptHeader(duplicated, stamped, laterSave());
    expect(refresh.edits).toEqual([]);
    expect(refresh.stamped.owned.size).toBe(0);
  });

  it("finds its rows under a comment somebody put above the header", () => {
    const { source, stamped } = stampedDocument();
    const withPreamble = `/*\n   My own notes\n*/\n\n${source}`;

    const refresh = refreshScriptHeader(withPreamble, stamped, laterSave());
    const result = applyEdits(withPreamble, refresh.edits);

    expect(result).toContain("My own notes");
    expect(rowFor(result, "Last modified")).toBe("Last modified  23/08/2026");
  });

  it("matches its rows in a file saved with CRLF line endings", () => {
    const { source, stamped } = stampedDocument();
    const crlf = source.replace(/\n/g, "\r\n");

    const refresh = refreshScriptHeader(crlf, stamped, laterSave());
    const result = applyEdits(crlf, refresh.edits);

    expect(rowFor(result, "Last modified")).toBe("Last modified  23/08/2026");
    expect(result).toContain("\r\n");
  });
});

describe("refreshScriptHeader and the rules", () => {
  it("redraws both rules when a longer file name needs a wider box", () => {
    const { source, stamped } = stampedDocument();
    const long =
      "A Really Very Long Map Name That Runs Past The Standard Box Width.rms";

    const refresh = refreshScriptHeader(
      source,
      stamped,
      laterSave({ fileName: long }),
    );
    const lines = applyEdits(source, refresh.edits).split("\n");
    const fileRow = lines.find((line) => line.includes(long));

    expect(fileRow).toBeDefined();
    expect(lines[1]).toBe(lines[lines.indexOf("*/") - 1]);
    expect(lines[1].length).toBeGreaterThanOrEqual(
      (fileRow as string).length - 1,
    );
  });

  it("leaves the box alone when only one rule is still ours", () => {
    const { source, stamped } = stampedDocument();
    const lines = source.split("\n");
    lines[1] = " ~~~~~~~~~~ my own divider ~~~~~~~~~~";
    const edited = lines.join("\n");
    const long =
      "A Really Very Long Map Name That Runs Past The Standard Box Width.rms";

    const refresh = refreshScriptHeader(
      edited,
      stamped,
      laterSave({ fileName: long }),
    );
    const resultLines = applyEdits(edited, refresh.edits).split("\n");

    expect(resultLines[1]).toBe(" ~~~~~~~~~~ my own divider ~~~~~~~~~~");
    // The surviving rule keeps its old width rather than being redrawn on its
    // own. Half a box is worse than a narrow one, and the app has no way to
    // redraw the half a person has taken over. This is the assertion the
    // test was missing: without it, redrawing the lone rule went unnoticed.
    expect(resultLines[resultLines.indexOf("*/") - 1]).toBe(stamped.rule);
    // The row itself still updates; only the decoration is left as found.
    expect(rowFor(resultLines.join("\n"), "File")).toBe(
      `File           ${long}`,
    );
  });
});

describe("the record handed back", () => {
  it("carries the refreshed values forward for the next save", () => {
    const { source, stamped } = stampedDocument();
    const first = refreshScriptHeader(
      source,
      stamped,
      laterSave({ fileName: "Renamed.rms" }),
    );
    const afterFirst = applyEdits(source, first.edits);

    // A second save on a third day starts from the record the first produced,
    // which is the case a stale `rows` record would break.
    const second = refreshScriptHeader(afterFirst, first.stamped, {
      fileName: "Renamed.rms",
      appVersion: "0.1.1",
      modified: new Date(2026, 8, 1),
    });
    const result = applyEdits(afterFirst, second.edits);

    expect(rowFor(result, "File")).toBe("File           Renamed.rms");
    expect(rowFor(result, "Last modified")).toBe("Last modified  01/09/2026");
    expect(rowFor(result, "Created")).toBe("Created        03/08/2026");
  });

  it("never re-owns a row once it is lost", () => {
    const { source, stamped } = stampedDocument();
    const narrowed: StampedHeader = refreshScriptHeader(
      SCRIPT,
      stamped,
      laterSave(),
    ).stamped;

    // Even handed the untouched original document back, ownership stays gone.
    expect(
      refreshScriptHeader(source, narrowed, laterSave()).stamped.owned.size,
    ).toBe(0);
  });
});
