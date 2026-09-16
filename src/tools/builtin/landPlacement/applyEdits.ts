// Sec.6.1, Sec.6.2: the whole edit set a panel's Apply produces (slice-4
// brief item 3). Two kinds of edit, per Sec.6.1/6.2:
//
//   - the FENCE, regenerated wholesale (buildFenceEdits, slice 3, done).
//   - `create_land` SKELETONS, which live OUTSIDE the fence and are written
//     once, then hand-owned forever (Sec.6.2: "from that moment the tool
//     owns only what is inside the fence").
//
// Sec.3.6(a): a panel takes NO snapshot at mount. This function computes its
// TextEdit[] synchronously against the CURRENT parse every time it is
// called; "stale" is unreachable for a panel, and this is deliberately NOT
// routed through RunState.edits / ToolHost.canApply(). Those exist for a
// computation that cannot be re-run, which is the opposite of this.

import { walkItems } from "../../walkItems";
import type { LanguageData } from "../../../parser/language";
import type { CommandNode, ParseResult } from "../../../parser/types";
import type { TextEdit } from "../../../../tools-api/index";
import { buildFenceEdits, locateFence, type AlpModel } from "./fence";
import {
  buildLandAttachmentExpectations,
  checkLandAttachment,
} from "./landCommand";
import { emitAlpModel } from "./emitModel";
import { NameAllocator } from "./compiler/naming";
import { reservedNames } from "./preconditions";
import { resolveLandGenerationCutOffset } from "./cutOffset";

/**
 * P4's `reservedNames` (preconditions.ts) reads every symbol the CURRENT
 * document defines, with no notion of "which of these did the tool itself
 * write", correct for its own job (does a candidate collide with anything),
 * wrong for THIS one. Re-Applying an unchanged model must reproduce its OWN
 * previous names exactly (Sec.10.4 #4, idempotence), but those names are
 * themselves already sitting in `parse.symbols` inside the EXISTING fence, so
 * seeding the allocator from the unfiltered set makes it see every one of its
 * own names as "taken" and rename around them (`ALP_X_P1` -> `ALP_X_P1_2` on
 * every re-Apply, forever). The fence is about to be regenerated wholesale
 * regardless (`buildFenceEdits`), so a symbol defined INSIDE it is not a real
 * collision. It is the thing being replaced.
 */
export function reservedNamesForApply(
  parse: ParseResult,
  lang: LanguageData,
): Set<string> {
  const loc = locateFence(parse);
  if (!loc) return reservedNames(parse, lang);
  const outsideFence: ParseResult = {
    ...parse,
    symbols: parse.symbols.filter((s) => {
      const tok = parse.tokens[s.nameToken];
      return !(tok && tok.start >= loc.span.start && tok.end <= loc.span.end);
    }),
  };
  return reservedNames(outsideFence, lang);
}

/**
 * Where a brand-new fence goes, and, item 3's own note that these two share
 * one scan, the SAME offset a brand-new skeleton is appended before: the end
 * of the document's land-generation content (Sec.7.1's own rule: the start of
 * the first section following the LAST `<LAND_GENERATION>`, or end of
 * document). The fence is inserted at the START of that section instead (the
 * text right after its header, `section.header`), so its `#const`s
 * topologically precede every skeleton this same Apply appends at the
 * section's END, Sec.6.1's one constraint ("the #consts must precede their
 * uses"), while both live inside the section a land-placement tool's output
 * obviously belongs in.
 */
function computeFenceInsertionOffset(parse: ParseResult): number | undefined {
  let lastLandGen: ParseResult["script"]["sections"][number] | undefined;
  for (const section of parse.script.sections) {
    if (section.name === "LAND_GENERATION") lastLandGen = section;
  }
  // undefined -> buildFenceEdits' own end-of-document default, for a script
  // with no <LAND_GENERATION> section to anchor to at all.
  return lastLandGen ? parse.tokens[lastLandGen.header].end : undefined;
}

/** Every `create_land` command reachable by `walkItems`, RawNode-covered ones are invisible here by construction (P1, preconditions.ts), same as everywhere else in this tool. */
function findCreateLandCommands(parse: ParseResult): CommandNode[] {
  const out: CommandNode[] = [];
  walkItems(parse, (item) => {
    if (
      item.kind === "command" &&
      parse.tokens[item.name]?.text === "create_land"
    )
      out.push(item);
  });
  return out;
}

export interface ApplyEditsResult {
  edits: TextEdit[];
  /** Sec.5.5: non-empty only when emission disagreed with itself, Apply must offer NOTHING in that case, and the panel reports these rather than silently doing nothing. */
  emissionProblems: readonly import("./compiler/verify").VerifyProblem[];
}

/**
 * The whole Apply edit set, computed fresh against `parse` every call.
 * `scriptSymbols` is the document's own resolved constant table, computed
 * by the caller (the panel, via `instantiateScript` at its pinned seed,
 * Sec.3.3), kept as a parameter so this function stays pure and testable
 * without a real generation pipeline in front of it. `playerCount` is
 * `settings.playerCount` at the moment of Apply, threaded through to
 * `emitAlpModel` for the PREVIEW-facing parts of an emission only (Sec.7.4:
 * "the preview draws one count") — per-player-escalation.md Sec.5.4/slice-b-
 * brief.md item 3 lifted the restriction this used to record
 * (`RandomParam.emittedForPlayerCount`, model.ts): a `perPlayer` param now
 * emits at MAX_PLAYER_COUNT regardless, so there is no longer a count to
 * stamp the model with here.
 */
export function computeApplyEdits(
  parse: ParseResult,
  model: AlpModel,
  lang: LanguageData,
  scriptSymbols: ReadonlyMap<string, number>,
  playerCount: number,
): ApplyEditsResult {
  const namer = new NameAllocator({
    reserved: reservedNamesForApply(parse, lang),
  });
  const emission = emitAlpModel(model, namer, scriptSymbols, playerCount);
  if (!emission.ok) {
    // Sec.5.5: "the tool emits nothing and reports the offending node."
    return { edits: [], emissionProblems: emission.problems };
  }

  // A model with no roles and no placements has nothing to write, and
  // `buildFenceEdits` cannot see that on its own — asked to insert a fence
  // where none exists yet, it always returns the insertion edit regardless
  // of body content, which is correct for its own job (fence.test.ts pins
  // that against an arbitrary body). Left unguarded here, Apply reported
  // "1 change" against a script the user had not touched at all, since a
  // fresh EMPTY_MODEL still has no existing fence to compare against.
  // Skipped only when there is also no EXISTING fence to reconcile: a model
  // emptied out from real content must still be free to clear that fence.
  const modelIsEmpty =
    model.roles.length === 0 && model.placements.length === 0;
  const fenceInsertionOffset = computeFenceInsertionOffset(parse);
  const fenceEdits =
    modelIsEmpty && locateFence(parse) === null
      ? []
      : buildFenceEdits(parse, model, emission.body, fenceInsertionOffset);

  const existingLands = findCreateLandCommands(parse);
  const skeletonInsertAt = resolveLandGenerationCutOffset(parse);
  const newSkeletonTexts: string[] = [];

  for (const placement of model.placements) {
    const skeletonText = emission.createLandText.get(placement.id);
    if (skeletonText === undefined) continue; // no role, nothing to place

    const quantity = emission.quantities.get(placement.id)!;

    // "Which placements need one" (item 3 point 2), and the acceptance's
    // sharper case: "a hand-edited create_land is detected as detached
    // rather than silently re-emitted." The identity signal can only be
    // `land_position`. Every OTHER attribute (terrain_type, base_size, …)
    // is a ROLE constant shared by every land wearing that role, so matching
    // on them cannot tell "this placement's land, now detached" apart from
    // "no land at all". `land_position`'s names, by contrast, are
    // allocator-assigned PER PLACEMENT (frame.ts), so a create_land whose
    // `land_position` still names this placement's own X/Y is this
    // placement's land REGARDLESS of what else has been hand-edited on it,
    // detached from its role, perhaps, but not absent. Only when the user
    // has ALSO hand-edited `land_position` itself is the link genuinely
    // gone, and regenerating a fresh skeleton is then the documented, correct
    // outcome (Sec.6.2: "the constant name is the link", no marker).
    const positionExpectation = buildLandAttachmentExpectations({
      role: model.roles.find((r) => r.id === placement.role)!,
      roleNames: emission.roleNamesByPlacement.get(placement.id)!,
      xName: quantity.xName,
      yName: quantity.yName,
      repeatIndex: placement.repeatIndex,
    }).filter((e) => e.attribute === "land_position");

    const alreadyExists = existingLands.some(
      (land) =>
        checkLandAttachment(land, parse.tokens, positionExpectation)
          .attributes[0]?.attached === true,
    );
    if (alreadyExists) continue;

    newSkeletonTexts.push(skeletonText);
  }

  // ONE edit at the shared insertion point, never one per skeleton, several
  // zero-width edits at the identical offset have no defined relative order
  // once handed to the document's edit-application machinery, and this
  // avoids the question entirely.
  const skeletonEdits: TextEdit[] =
    newSkeletonTexts.length > 0
      ? [
          {
            start: skeletonInsertAt,
            end: skeletonInsertAt,
            newText: newSkeletonTexts.map((t) => `${t}\n`).join(""),
          },
        ]
      : [];

  return { edits: [...fenceEdits, ...skeletonEdits], emissionProblems: [] };
}
