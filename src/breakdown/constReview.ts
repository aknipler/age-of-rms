import { holdingItem, isConstSlot } from "../editor/constOffers";
import { getStaticNameIndex, scriptIndexFor } from "../editor/staticNameIndex";
import type { ArgumentDef } from "../parser/language";
import { lineNumberOfOffset } from "../parser/lineIndex";
import {
  moveUpPlan,
  resolveName,
  tokenIndexAt,
  unknownNameOffer,
  type DefaultConstValue,
  type MoveUpPlan,
  type SlotKind,
} from "../parser/nameLookup";
import type { Item, ParseResult } from "../parser/types";
import { COMMENT_OPEN_ID } from "../parser/validate";

// What the Breakdown does with a name right after the person commits it
// (docs/name-lookup-design.md Sec.6.1, Sec.7 and Sec.9). Pure and free of
// React so the rules can be tested without rendering a card.
//
// It is the Breakdown's counterpart of constOffers.ts, which answers the same
// question for the word under the Code editor's caret. Both end in
// nameLookup.ts's resolveName, so the two editors cannot disagree about what
// a name is. Only the wording and the thing offered differ.

export type CommitReview =
  /** The name resolves to a real const. Flash the row and say so to a screen reader. */
  | { kind: "flash"; message: string }
  /** Our data does not know the name (Sec.7). */
  | {
      kind: "offer";
      /** A known name within edit distance 2. */
      didYouMean?: string;
      defaultValue: DefaultConstValue;
      /** The item holding the use, for "Above this command". Absent when there is none to put a line above. */
      holder?: Item;
    }
  /** Defined only below the use (Sec.9). */
  | {
      kind: "definedBelow";
      /** The 1-based line of the first definition below. */
      line: number;
      plan: MoveUpPlan;
    }
  | { kind: "none" };

const NONE: CommitReview = { kind: "none" };

/**
 * The review for `text` just committed at offset `at` in `parse`'s source.
 * `parse` has to be the parse of the source the commit produced. The caller
 * waits for that parse before asking, because the scope test compares token
 * positions and a stale parse puts them in the wrong place.
 */
export function reviewCommit(
  parse: ParseResult,
  text: string,
  at: number,
  slot: SlotKind,
): CommitReview {
  const name = text.trim();
  if (name === "") return NONE;
  const stat = getStaticNameIndex();
  const script = scriptIndexFor(parse);
  const lineOf = (tokenIndex: number) =>
    lineNumberOfOffset(parse.lineOffsets, parse.tokens[tokenIndex].start);

  // An if or elseif condition resolves #define and labels. It flashes for the
  // script's own names but never draws a create offer (Sec.7.1), since `if`
  // reads #define and the offer writes #const.
  if (slot.kind === "condition") {
    const r = resolveName(stat, script, name, at, slot);
    return r.kind === "script"
      ? {
          kind: "flash",
          message: describeScriptName(
            name,
            lineOf(r.symbol.nameToken),
            r.conditional,
          ),
        }
      : NONE;
  }
  if (!isConstSlot(slot)) return NONE;

  const r = resolveName(stat, script, name, at, slot);
  switch (r.kind) {
    case "builtin":
      return {
        kind: "flash",
        message: `${name} is a built-in ${r.row.category}${r.row.descriptiveName ? ` (${r.row.descriptiveName})` : ""}`,
      };
    case "script":
      return {
        kind: "flash",
        message: describeScriptName(
          name,
          lineOf(r.symbol.nameToken),
          r.conditional,
        ),
      };
    case "definedBelow":
      return {
        kind: "definedBelow",
        line: lineOf(r.symbol.nameToken),
        plan: moveUpPlan(script, name, at),
      };
    case "unknown": {
      const offer = unknownNameOffer(stat, script, name, at, slot);
      if (!offer) return NONE;
      return {
        kind: "offer",
        didYouMean: offer.didYouMean,
        defaultValue: offer.defaultValue,
        holder: holdingItem(parse, tokenIndexAt(parse, at)),
      };
    }
    default:
      return NONE;
  }
}

function describeScriptName(
  name: string,
  line: number,
  conditional: boolean,
): string {
  return `${name} is your #const on line ${line}${conditional ? ", inside a branch" : ""}`;
}

/** The sentence beside "No const named X" for a default value, naming what the number means in words only (Sec.8.1, a name in a comment would be unsafe). */
export function defaultMeaning(d: DefaultConstValue): string | undefined {
  if (!d.meaning) return undefined;
  const label = d.meaning.descriptiveName
    ? `${d.meaning.name} (${d.meaning.descriptiveName})`
    : d.meaning.name;
  return `${d.value} is ${label}`;
}

/** Sec.7.4. A word valued 69 opens a nested comment wherever it later sits inside one (RMS0111). */
export function commentOpenWarning(value: number): string | undefined {
  return value === COMMENT_OPEN_ID
    ? "69 opens a comment wherever this name appears inside one (RMS0111)"
    : undefined;
}

/** Why the Move button is hidden, in the words Sec.9.1 gives. Undefined when it can move. */
export function moveUpRefusal(
  plan: MoveUpPlan,
  name: string,
  line: number,
): string | undefined {
  if (plan.ok) return undefined;
  switch (plan.reason) {
    case "conditional":
      return `${name} is defined on line ${line}, inside a branch. Moving it out would change which maps define it.`;
    case "dependsOn":
      return `${name} reads ${plan.dependsOn}, which is defined between here and line ${line}. Moving ${name} would break it.`;
    case "includes":
      return `This script includes another file, so a ${name} defined there may already exist.`;
    case "notTopLevel":
      return `${name} is defined on line ${line}, inside a block, so it cannot be lifted out as a single line.`;
    case "notDefinedBelow":
      return undefined;
  }
}

/**
 * The name slot an argument def gives its value field, or null for a def that
 * takes no names. `string` slots hold filenames and the new name after
 * `#const`, where nothing already exists to suggest or resolve.
 */
export function namesSlotOf(def: ArgumentDef | undefined): SlotKind | null {
  return def && def.type !== "string" ? { kind: "argument", def } : null;
}
