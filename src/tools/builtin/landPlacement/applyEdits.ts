// Sec.6.1, Sec.6.2: the whole edit set a panel's Apply produces (slice-4
// brief item 3). Two kinds of edit, per Sec.6.1/6.2:
//
//   - the FENCE, regenerated wholesale (buildFenceEdits, slice 3, done).
//   - `create_land` SKELETONS, which live OUTSIDE the fence. Written once,
//     then, since 2026-09-22, UPDATED IN PLACE for as long as the block still
//     says exactly what the tool would write (every attribute attached, no
//     attribute of the user's own). The first hand edit hands the block to
//     the user for good (Sec.6.2: "from that moment the tool owns only what
//     is inside the fence"); the tool then reports it and never rewrites it.
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
import { effectiveRole } from "./model";
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
 * Where a brand-new fence goes: the END OF THE PREAMBLE, right before the
 * first section header, or the end of a section-less document. That is the
 * script's own header, where its `#const`s conventionally live, and it
 * precedes every section, so Sec.6.1's one constraint ("the #consts must
 * precede their uses") holds wherever the skeletons land. The first version
 * put the fence at the start of the last `<LAND_GENERATION>`, and, with no
 * such section, at the END OF THE DOCUMENT, which on a script that already
 * had an `<ELEVATION_GENERATION>` dropped the whole fence inside that
 * section (2026-09-22, from the real host). An EXISTING fence is replaced
 * where it is (`buildFenceEdits`), never moved.
 */
function computeFenceInsertionOffset(parse: ParseResult): number {
  const first = parse.script.sections[0];
  return first === undefined
    ? parse.source.length
    : parse.tokens[first.header].start;
}

/**
 * Where skeletons go, and whether a `<LAND_GENERATION>` header has to be
 * written first. With a land section: the end of the LAST one
 * (`resolveLandGenerationCutOffset`, the canvas's own cut). Without one: a
 * new section at its canonical position, read from `language.json`'s own
 * section order rather than hardcoded, so it lands after `<PLAYER_SETUP>`
 * and before `<ELEVATION_GENERATION>` and the rest, never at the document
 * end inside whatever section happens to be last.
 */
function resolveSkeletonInsertion(
  parse: ParseResult,
  lang: LanguageData,
): { at: number; sectionHeader: string | null } {
  const sections = parse.script.sections;
  if (sections.some((sec) => sec.name === "LAND_GENERATION")) {
    return { at: resolveLandGenerationCutOffset(parse), sectionHeader: null };
  }
  const order = lang.sections;
  const rank = (name: string): number => {
    const i = order.indexOf(name);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const landRank = rank("LAND_GENERATION");
  // The first existing section that canonically FOLLOWS land generation:
  // the new section opens just before its header.
  const following = sections.find((sec) => rank(sec.name) > landRank);
  const at =
    following !== undefined
      ? parse.tokens[following.header].start
      : parse.source.length;
  return { at, sectionHeader: "<LAND_GENERATION>" };
}

/** `text` placed at `at` so it starts on a fresh line and leaves the following text on one, whatever the neighbours are. */
function onOwnLines(source: string, at: number, text: string): string {
  const before = source.slice(0, at);
  const after = source.slice(at);
  const prefix = before.length === 0 || before.endsWith("\n") ? "" : "\n";
  const suffix = after.length === 0 || after.startsWith("\n") ? "" : "\n";
  return `${prefix}${text}${suffix}`;
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

/** What an Apply would do to the skeletons, for the panel to say so in words rather than as a bare edit count. */
export interface ApplyReport {
  /** New `create_land` blocks this Apply writes. */
  written: number;
  /** Existing tool-owned blocks rewritten in place because the role or position changed. */
  updated: number;
  /** Existing blocks already saying exactly what the tool would write. */
  unchanged: number;
  /** Existing blocks the user has hand-edited (detached, or carrying their own attributes), left alone. */
  left: number;
}

export interface ApplyEditsResult {
  edits: TextEdit[];
  /** Sec.5.5: non-empty only when emission disagreed with itself, Apply must offer NOTHING in that case, and the panel reports these rather than silently doing nothing. */
  emissionProblems: readonly import("./compiler/verify").VerifyProblem[];
  report: ApplyReport;
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
    return {
      edits: [],
      emissionProblems: emission.problems,
      report: { written: 0, updated: 0, unchanged: 0, left: 0 },
    };
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
  const insertion = resolveSkeletonInsertion(parse, lang);
  const newSkeletonTexts: string[] = [];
  const updateEdits: TextEdit[] = [];
  const report: ApplyReport = { written: 0, updated: 0, unchanged: 0, left: 0 };

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
    const expectations = buildLandAttachmentExpectations({
      role: effectiveRole(
        model.roles.find((r) => r.id === placement.role)!,
        placement.roleOverrides,
      ),
      roleNames: emission.roleNamesByPlacement.get(placement.id)!,
      xName: quantity.xName,
      yName: quantity.yName,
      repeatIndex: placement.repeatIndex,
    });
    const positionExpectation = expectations.filter(
      (e) => e.attribute === "land_position",
    );

    const existing = existingLands.find(
      (land) =>
        checkLandAttachment(land, parse.tokens, positionExpectation)
          .attributes[0]?.attached === true,
    );
    if (existing === undefined) {
      newSkeletonTexts.push(skeletonText);
      report.written++;
      continue;
    }

    // The land exists. UPDATE IN PLACE when, and only when, it is still
    // the tool's: every attribute PRESENT in the block still says what the
    // tool would write for it (a changed value is a hand edit), and the
    // block carries no attribute the tool would not write (a hand-added
    // `border_fuzziness` is the user's, and rewriting the block would
    // delete it). An attribute the tool would write that is MISSING from
    // the block does not count against it: that is what a role gaining an
    // attribute after the first Apply looks like, and restoring it is the
    // whole point of an update. The cost, stated: deleting a tool-written
    // line by hand no longer detaches the land, changing its value does,
    // and the supported way to make one land differ is its Overrides list.
    // A block that fails either test is hand-owned (Sec.6.2) and left
    // exactly as it is; the tree already shows it as detached. Only the
    // command node's own span is replaced, so a guard `if` around it is
    // untouched.
    const fresh = emission.createLandSkeleton.get(placement.id)!;
    const attachment = checkLandAttachment(
      existing,
      parse.tokens,
      expectations,
    );
    const presentAllAttached = attachment.attributes.every(
      (a) => !a.present || a.attached,
    );
    const actualNames = new Set(
      (existing.block?.items ?? [])
        .filter((item) => item.kind === "attribute")
        .map((item) => parse.tokens[item.name].text),
    );
    const expectedNames = new Set(expectations.map((e) => e.attribute));
    const onlyToolAttributes = [...actualNames].every((n) =>
      expectedNames.has(n),
    );
    if (!presentAllAttached || !onlyToolAttributes) {
      report.left++;
      continue;
    }
    const current = parse.source.slice(existing.span.start, existing.span.end);
    if (current === fresh) {
      report.unchanged++;
      continue;
    }
    updateEdits.push({
      start: existing.span.start,
      end: existing.span.end,
      newText: fresh,
    });
    report.updated++;
  }

  // ONE edit at the shared insertion point, never one per skeleton, several
  // zero-width edits at the identical offset have no defined relative order
  // once handed to the document's edit-application machinery, and this
  // avoids the question entirely. `onOwnLines` is what keeps
  // `/* @alp end */create_land` from ever being written again (2026-09-22):
  // whatever sits at the insertion point, the block starts on its own line.
  const skeletonEdits: TextEdit[] =
    newSkeletonTexts.length > 0
      ? [
          {
            start: insertion.at,
            end: insertion.at,
            newText: onOwnLines(
              parse.source,
              insertion.at,
              (insertion.sectionHeader !== null
                ? `\n${insertion.sectionHeader}\n`
                : "") + newSkeletonTexts.map((t) => `${t}\n`).join(""),
            ),
          },
        ]
      : [];

  // A section-less document puts the new fence AND the new land section at
  // the same offset (the document end). Two zero-width edits at one offset
  // have no defined order, and the wrong order writes the skeletons above
  // the fence. Merged into ONE edit, fence first, so the order is the
  // text's own.
  const fenceInsert = fenceEdits.find((e) => e.start === e.end);
  if (
    fenceInsert !== undefined &&
    skeletonEdits.length === 1 &&
    skeletonEdits[0].start === fenceInsert.start
  ) {
    const fenceText = fenceInsert.newText.endsWith("\n")
      ? fenceInsert.newText
      : `${fenceInsert.newText}\n`;
    const merged: TextEdit = {
      start: fenceInsert.start,
      end: fenceInsert.start,
      newText: fenceText + skeletonEdits[0].newText.replace(/^\n/, ""),
    };
    return {
      edits: [
        ...fenceEdits.filter((e) => e !== fenceInsert),
        ...updateEdits,
        merged,
      ],
      emissionProblems: [],
      report,
    };
  }

  return {
    edits: [...fenceEdits, ...updateEdits, ...skeletonEdits],
    emissionProblems: [],
    report,
  };
}
