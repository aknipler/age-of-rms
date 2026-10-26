import * as monaco from "monaco-editor";
import { lineNumberOfOffset } from "../parser/lineIndex";
import { moveUpRefusal } from "../breakdown/constReview";
import {
  buildScriptNameIndex,
  describeSuggestion,
  moveUpPlan,
  resolveName,
  suggest,
  type ScriptNameIndex,
  type Suggestion,
} from "../parser/nameLookup";
import type { ParseResult } from "../parser/types";
import { caretContext, lookupOffset } from "./caretContext";
import { isConstSlot } from "./constOffers";
import { FLASH_RANGE_COMMAND } from "./resolveFlash";
import { getStaticNameIndex, languageIndex } from "./staticNameIndex";

// The shared instances live in staticNameIndex.ts, which imports no Monaco so
// the Breakdown's component tests can load it. Re-exported so this file's
// importers (constActions.ts) are unchanged.
export { getStaticNameIndex, languageIndex };

// The Code editor's autocomplete (docs/name-lookup-design.md Sec.4.1), and
// the shared state the resolve flash, the #const code actions and the
// hover's script-name line read.
//
// HELPTIP EXCEPTION. The suggestion list is Monaco's own widget, which
// cannot be wrapped in a HelpTip. Each row's detail text says what the name
// is, which is what a tip would have said. The Settings checkbox that turns
// the flash off carries the HelpTip for this feature.

// A module-level bridge from Monaco's global providers into React, the same
// pattern diagnosticActions.ts uses: providers are registered once for the
// app, while the parse lives in React state. CodePane hands each new parse
// in and takes it back out on unmount.
let currentParse: ParseResult | null = null;
let cachedScript: { parse: ParseResult; index: ScriptNameIndex } | null = null;

export function setNameLookupParse(parse: ParseResult | null): void {
  currentParse = parse;
}

export function getNameLookupParse(): ParseResult | null {
  return currentParse;
}

/** The script half of the lookup for the current parse, rebuilt only when the parse changes. */
export function getScriptNameIndex(): ScriptNameIndex | null {
  if (!currentParse) return null;
  if (cachedScript?.parse !== currentParse)
    cachedScript = {
      parse: currentParse,
      index: buildScriptNameIndex(currentParse),
    };
  return cachedScript.index;
}

const KIND_BY_SOURCE: Record<
  Suggestion["source"],
  monaco.languages.CompletionItemKind
> = {
  script: monaco.languages.CompletionItemKind.Constant,
  builtin: monaco.languages.CompletionItemKind.Constant,
  label: monaco.languages.CompletionItemKind.EnumMember,
  command: monaco.languages.CompletionItemKind.Function,
  attribute: monaco.languages.CompletionItemKind.Property,
  directive: monaco.languages.CompletionItemKind.Keyword,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  section: monaco.languages.CompletionItemKind.Module,
};

let registered = false;

export function registerAoe2RmsCompletion(): void {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider("aoe2-rms", {
    // `#` and `<` are not word characters, so typing one would not open the
    // list on its own.
    triggerCharacters: ["#", "<"],
    provideCompletionItems(model, position) {
      const script = getScriptNameIndex();
      if (!script) return { suggestions: [] };
      const text = model.getValue();
      const offset = model.getOffsetAt(position);
      const ctx = caretContext(text, offset, languageIndex, currentParse);
      if (!ctx.slot) return { suggestions: [] };
      const rows = suggest(
        getStaticNameIndex(),
        script,
        ctx.word,
        lookupOffset(ctx),
        ctx.slot,
      );
      const start = model.getPositionAt(ctx.wordStart);
      const range = new monaco.Range(
        start.lineNumber,
        start.column,
        position.lineNumber,
        position.column,
      );
      const flashes = isConstSlot(ctx.slot);
      return {
        // Monaco filters and re-sorts a list itself as typing continues,
        // by its own fuzzy score. `incomplete` makes it ask again on every
        // keystroke instead, and a `filterText` equal to the typed word
        // gives every row the same score, so `sortText` (our Sec.3 order)
        // is what decides. This is a common trick with Monaco rather than
        // anything specific to this app.
        incomplete: true,
        suggestions: rows.map((s, i) => ({
          label: { label: s.name, description: describeSuggestion(s) },
          kind: KIND_BY_SOURCE[s.source],
          insertText: s.name,
          range,
          filterText: ctx.word,
          sortText: String(i).padStart(5, "0"),
          documentation: s.description,
          // Accepting a name that resolves flashes it, the Tab half of
          // design Sec.6.1's "the caret leaves a word it just typed".
          command:
            flashes &&
            (s.source === "builtin" ||
              (s.source === "script" && !s.definedBelow))
              ? {
                  id: FLASH_RANGE_COMMAND,
                  title: "",
                  arguments: [ctx.wordStart, s.name.length],
                }
              : undefined,
        })),
      };
    },
  });
}

/**
 * The resolve flash's test (design Sec.6.1): the word starting at `start`
 * sits in a const slot and resolves to a built-in or to the script's own
 * definition above it. `definedBelow`, `otherKind` and `unknown` never
 * flash, and neither does a number.
 */
export function wordResolvesToConst(
  text: string,
  start: number,
  word: string,
): boolean {
  const script = getScriptNameIndex();
  if (!script) return false;
  const ctx = caretContext(
    text,
    start + word.length,
    languageIndex,
    currentParse,
  );
  if (!isConstSlot(ctx.slot) || ctx.wordStart !== start) return false;
  const r = resolveName(
    getStaticNameIndex(),
    script,
    word,
    lookupOffset(ctx),
    ctx.slot,
  );
  return r.kind === "builtin" || r.kind === "script";
}

/**
 * The hover's line for a script's own name (design Sec.6.3, the hover says
 * what a name is whether or not the flash showed). Undefined for anything
 * that is not one of the script's names, which leaves the hover as it was.
 */
export function describeScriptName(
  name: string,
  offset: number,
  /** Where the use begins, for the move offer's position test. Defaults to `offset`. */
  useStart: number = offset,
): string | undefined {
  const script = getScriptNameIndex();
  if (!script) return undefined;
  const defs = script.symbolsByName.get(name);
  if (!defs || defs.length === 0) return undefined;
  const parse = script.parse;
  const r = resolveName(
    getStaticNameIndex(),
    script,
    name,
    offset,
    { kind: "condition" }, // every script name resolves here, #define included
  );
  const lineOf = (tokenIndex: number) =>
    lineNumberOfOffset(parse.lineOffsets, parse.tokens[tokenIndex].start);
  const kind = defs[0].directiveKind === "const" ? "#const" : "#define";
  if (r.kind === "definedBelow") {
    const line = lineOf(r.symbol.nameToken);
    const base = `\`${name}\`, your ${kind} on line ${line}, below this line, so the game does not see it here.`;
    // The Quick Fix list offers "Move the #const up here" when it can. When it
    // cannot, nothing in that list says why, so the hover does.
    const why = moveUpRefusal(moveUpPlan(script, name, useStart), name, line);
    return why ? `${base} ${why}` : base;
  }
  if (r.kind === "script")
    return `\`${name}\`, your ${kind} on line ${lineOf(r.symbol.nameToken)}${r.conditional ? ", inside an if or start_random branch, so only some maps define it" : ""}.`;
  return undefined;
}
