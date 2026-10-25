// The Monaco half of line and block prediction
// (docs/name-lookup-design.md Sec.13). The rules live in linePrediction.ts
// and blockTemplate.ts, which import no Monaco, so they are tested in plain
// Node. This file only asks them and hands Monaco the answer as ghost text.
//
// HELPTIP EXCEPTION. Ghost text is drawn inside Monaco's own view and cannot
// be wrapped in a HelpTip. The Settings > Code checkbox that turns it off
// carries the HelpTip for this feature, as the completion list's does.

import * as monaco from "monaco-editor";
import skeletonData from "../../reference/data/block-skeletons.json";
import type { ParseResult } from "../parser/types";
import { getNameLookupParse } from "./aoe2RmsCompletion";
import type { BlockSkeletonData } from "./blockSkeletons";
import { blockTemplate } from "./blockTemplate";
import { caretContext } from "./caretContext";
import {
  buildStatementIndex,
  predictLine,
  type StatementIndex,
} from "./linePrediction";
import { languageIndex } from "./staticNameIndex";

const skeletons = skeletonData as BlockSkeletonData;

// The same module-level bridge as aoe2RmsCompletion.ts's parse: providers
// are registered once for the app, while the setting lives in React state.
// CodePane writes it on every change, and each request reads it, so turning
// the checkbox off takes effect on the next keystroke without re-registering.
let enabled = true;
export function setCodePredictionEnabled(on: boolean): void {
  enabled = on;
}

let cachedIndex: StatementIndex | null = null;
function statementIndexFor(parse: ParseResult): StatementIndex {
  if (cachedIndex?.parse !== parse) cachedIndex = buildStatementIndex(parse);
  return cachedIndex;
}

let registered = false;

export function registerAoe2RmsPrediction(): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerInlineCompletionsProvider("aoe2-rms", {
    provideInlineCompletions(model, position) {
      const none = { items: [] };
      if (!enabled) return none;
      const parse = getNameLookupParse();
      if (!parse) return none;
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const ctx = caretContext(text, offset, languageIndex, parse);
      const range = new monaco.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      );
      const line = predictLine(text, offset, ctx, statementIndexFor(parse));
      if (line !== null) return { items: [{ insertText: line, range }] };
      const block = blockTemplate(
        text,
        offset,
        ctx,
        languageIndex,
        parse,
        skeletons,
      );
      if (block)
        return { items: [{ insertText: { snippet: block.snippet }, range }] };
      return none;
    },
    // Required by the interface. Nothing is held per request, so there is
    // nothing to release.
    disposeInlineCompletions() {},
  });
}
