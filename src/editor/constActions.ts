import * as monaco from "monaco-editor";
import type { TextEdit } from "../breakdown/patch/intents";
import {
  getNameLookupParse,
  getScriptNameIndex,
  getStaticNameIndex,
  languageIndex,
} from "./aoe2RmsCompletion";
import { constOffersAt } from "./constOffers";

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

/** The actions for the word at `offset` in the current parse, or none. */
function constActionsAt(
  text: string,
  offset: number,
): monaco.languages.CodeAction[] {
  const parse = getNameLookupParse();
  const script = getScriptNameIndex();
  if (!parse || !script) return [];
  return constOffersAt(
    text,
    offset,
    parse,
    getStaticNameIndex(),
    script,
    languageIndex,
  ).map(({ title, edits, select }) => ({
    title,
    kind: "quickfix",
    command: { id: APPLY_COMMAND, title, arguments: [edits, select] },
  }));
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
