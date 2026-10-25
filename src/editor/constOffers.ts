import { computeEdit, editsOf } from "../breakdown/patch/computeEdit";
import {
  PatchError,
  type EditIntent,
  type InsertTarget,
  type TextEdit,
} from "../breakdown/patch/intents";
import type { LanguageIndex } from "../parser/language";
import {
  moveUpPlan,
  resolveName,
  tokenIndexAt,
  unknownNameOffer,
  type DefaultConstValue,
  type ScriptNameIndex,
  type SlotKind,
  type StaticNameIndex,
} from "../parser/nameLookup";
import type { Item, ParseResult, Token } from "../parser/types";
import { COMMENT_OPEN_ID } from "../parser/validate";
import { caretContext } from "./caretContext";

// Which #const offers the word under the caret gets (docs/name-lookup-design.md
// Sec.7.2 and Sec.9.1), as plain data. constActions.ts turns these into
// Monaco code actions.
//
// Kept apart from constActions.ts so it imports no Monaco. Vitest cannot
// load monaco-editor at all (undoGrouping.test.ts says why), so anything
// that should be tested has to live on this side of that import.

/** Argument slots a const can stand in, the ones the flash and the create offer speak about. */
export function isConstSlot(
  slot: SlotKind | null,
): slot is Extract<SlotKind, { kind: "argument" }> {
  return slot?.kind === "argument" && slot.def.type !== "string";
}

/** One offer, with its menu title, its edits and the range to select after them. */
export interface ConstOffer {
  title: string;
  edits: readonly TextEdit[];
  /** Offsets in the text after the edits. */
  select?: { start: number; length: number };
}

/** The non-trivia word token under `offset`, touching either edge. */
function wordTokenAt(parse: ParseResult, offset: number): number | undefined {
  const i = tokenIndexAt(parse, offset);
  const isWord = (t: Token | undefined) =>
    t !== undefined && !t.isTrivia && t.kind === "word";
  if (isWord(parse.tokens[i]) && parse.tokens[i].start === offset) return i;
  const prev = parse.tokens[i - 1];
  if (isWord(prev) && prev.end >= offset) return i - 1;
  return undefined;
}

/**
 * The statement-level item that holds token `index`: a command (a use in
 * one of its attributes counts as a use by the command), a directive, or a
 * raw node. Descends into if and start_random branches, so a use inside a
 * branch gets its line inside the same branch (Sec.7.3).
 */
export function holdingItem(
  parse: ParseResult,
  index: number,
): Item | undefined {
  const visit = (items: readonly Item[]): Item | undefined => {
    for (const item of items) {
      if (index < item.firstToken || index > item.lastToken) continue;
      if (item.kind === "if") {
        for (const b of item.branches) {
          const hit = visit(b.items);
          if (hit) return hit;
        }
        return item;
      }
      if (item.kind === "random") {
        const hit =
          visit(item.preamble) ??
          item.branches.map((b) => visit(b.items)).find((h) => h);
        return hit ?? item;
      }
      return item;
    }
    return undefined;
  };
  return (
    visit(parse.script.preamble) ??
    parse.script.sections.map((s) => visit(s.items)).find((h) => h)
  );
}

function valueSuffix(d: DefaultConstValue): string {
  const meaning = d.meaning
    ? ` (${d.value} is ${d.meaning.name}${d.meaning.descriptiveName ? `, ${d.meaning.descriptiveName}` : ""})`
    : "";
  // Sec.7.4. The default can land on 69 (an object id), and a word valued
  // 69 opens a nested comment wherever it later sits inside one.
  const warning =
    d.value === COMMENT_OPEN_ID
      ? ". 69 opens a comment wherever this name appears inside one (RMS0111)"
      : "";
  return meaning + warning;
}

/**
 * The offers for the word at `offset`, or none. `parse` must be a parse of
 * exactly `text`, since the edits are computed from its token offsets and a
 * stale parse would put the line in the wrong place.
 */
export function constOffersAt(
  text: string,
  offset: number,
  parse: ParseResult,
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  lang: LanguageIndex,
): ConstOffer[] {
  if (parse.source !== text) return [];
  const index = wordTokenAt(parse, offset);
  if (index === undefined) return [];
  const token = parse.tokens[index];
  const ctx = caretContext(text, token.end, lang, parse);
  if (!isConstSlot(ctx.slot) || ctx.wordStart !== token.start) return [];
  const name = token.text;

  const run = (intent: EditIntent) => {
    try {
      return computeEdit(parse, intent, lang);
    } catch (e) {
      if (e instanceof PatchError) return undefined; // e.g. an unclosed block
      throw e;
    }
  };

  const offer = unknownNameOffer(stat, script, name, token.start, ctx.slot);
  if (offer) {
    const out: ConstOffer[] = [];
    if (offer.didYouMean)
      out.push({
        title: `Change to ${offer.didYouMean}`,
        edits: [
          { start: token.start, end: token.end, newText: offer.didYouMean },
        ],
      });
    const value = offer.defaultValue.value;
    const valueText = String(value);
    const create = (at: InsertTarget, where: string) => {
      const result = run({ kind: "addConst", at, name, value });
      if (!result) return;
      out.push({
        title: `Create #const ${name} ${valueText} ${where}${valueSuffix(offer.defaultValue)}`,
        edits: editsOf(result),
        select: { start: result.caret, length: valueText.length },
      });
    };
    const holder = holdingItem(parse, index);
    if (holder) create({ before: holder }, "above this command");
    create({ in: "preamble" }, "in the header");
    return out;
  }

  const resolved = resolveName(stat, script, name, token.start, ctx.slot);
  if (resolved.kind !== "definedBelow") return [];
  const plan = moveUpPlan(script, name, token.start);
  if (!plan.ok) return [];
  const result = run({
    kind: "moveNode",
    node: plan.definition,
    to: { before: plan.before },
  });
  return result
    ? [{ title: "Move the #const up here", edits: editsOf(result) }]
    : [];
}
