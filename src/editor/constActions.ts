import * as monaco from "monaco-editor";
import type { TextEdit } from "../breakdown/patch/intents";
import {
  getNameLookupParse,
  getScriptNameIndex,
  getStaticNameIndex,
  languageIndex,
} from "./aoe2RmsCompletion";
import type { Diagnostic } from "../parser/types";
import { constOffersAt, suggestionOffersAt } from "./constOffers";

// The Code editor's half of the unknown const offer and the move offer
// (docs/name-lookup-design.md Sec.7.2 and Sec.9.1), as Monaco code actions:
// the light bulb, and Ctrl+. on the word.
//
// NOT A DIAGNOSTIC. These actions come with no marker, no squiggle and
// nothing in the status bar count. A name our data does not know proves
// nothing about the game (CLAUDE.md's positive resolver rule), so the offer
// waits to be asked for rather than flagging the line.
//
// HELPTIP EXCEPTION. Monaco draws the light bulb and the action menu
// itself, so neither can be wrapped in a HelpTip. Each action's title says
// what it writes, value included.
//
// Every edit goes through the patch engine (`computeEdit`), the same code
// the Breakdown uses, and is held to the Sec.4.8 property gate there.
// constOffers.ts decides which intents to offer. This file only hands them
// to Monaco.

/** What the actions call, set by CodePane while it is mounted. */
export interface ConstActionHandlers {
  /** Apply `edits` as one undo step, then select `select` (offsets in the new text) if given. */
  apply: (
    edits: readonly TextEdit[],
    select?: { start: number; length: number },
  ) => void;
}

let handlers: ConstActionHandlers | null = null;

export function setConstActionHandlers(next: ConstActionHandlers | null): void {
  handlers = next;
}

const APPLY_COMMAND = "aoe2rms.constOffer.apply";

// The diagnostics the did-you-mean fixes read, with the text they describe.
// Set by CodePane next to the markers, since the diagnostics come from the
// parser worker and not from the name lookup's parse.
let diagnosticSource: { source: string; diagnostics: readonly Diagnostic[] } = {
  source: "",
  diagnostics: [],
};

export function setSuggestionDiagnostics(
  source: string,
  diagnostics: readonly Diagnostic[],
): void {
  diagnosticSource = { source, diagnostics };
}

/** The actions for the word at `offset` in the current parse, or none. */
function constActionsAt(
  text: string,
  offset: number,
): monaco.languages.CodeAction[] {
  const parse = getNameLookupParse();
  const script = getScriptNameIndex();
  const offers = [
    ...(parse && script
      ? constOffersAt(
          text,
          offset,
          parse,
          getStaticNameIndex(),
          script,
          languageIndex,
        )
      : []),
    ...suggestionOffersAt(
      text,
      offset,
      diagnosticSource.source,
      diagnosticSource.diagnostics,
    ),
  ];
  // A slot's own "Change to X" and the diagnostic's can name the same fix.
  const seen = new Set<string>();
  return offers
    .filter(({ title }) => !seen.has(title) && seen.add(title))
    .map(({ title, edits, select }) => ({
      title,
      kind: "quickfix",
      command: { id: APPLY_COMMAND, title, arguments: [edits, select] },
    }));
}

/**
 * The offset where the word under the caret begins, when that word has at
 * least one action to offer, otherwise null. The light bulb asks it on every
 * caret move and parse, so it stays a thin wrapper over `constActionsAt`.
 */
export function offerWordStart(text: string, caret: number): number | null {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(text.charAt(start - 1))) start--;
  const touching = /[A-Za-z0-9_]/.test(text.charAt(caret)) || start < caret;
  if (!touching) return null;
  return constActionsAt(text, caret).length > 0 ? start : null;
}

/**
 * The offset where the first word on a line that has an action begins, or null
 * when none of them does. The light bulb in the gutter asks it for the caret's
 * line, so the bulb shows wherever on the line the caret is and not only
 * while it touches the word. Each word is asked with the caret at its end, the
 * same question `offerWordStart` answers.
 */
export function offerWordOnLine(
  text: string,
  lineStart: number,
  lineEnd: number,
): number | null {
  const line = text.slice(lineStart, lineEnd);
  for (const match of line.matchAll(/[A-Za-z0-9_]+/g)) {
    const start = lineStart + match.index;
    if (offerWordStart(text, start + match[0].length) !== null) return start;
  }
  return null;
}

let registered = false;

export function registerConstActions(): void {
  if (registered) return;
  registered = true;

  monaco.editor.registerCommand(
    APPLY_COMMAND,
    (_accessor, edits: unknown, select: unknown) => {
      if (!Array.isArray(edits)) return;
      handlers?.apply(
        edits as TextEdit[],
        select as { start: number; length: number } | undefined,
      );
    },
  );

  monaco.languages.registerCodeActionProvider(
    "aoe2-rms",
    {
      provideCodeActions(model, range) {
        const actions = constActionsAt(
          model.getValue(),
          model.getOffsetAt(range.getStartPosition()),
        );
        return { actions, dispose() {} };
      },
    },
    { providedCodeActionKinds: ["quickfix"] },
  );
}
