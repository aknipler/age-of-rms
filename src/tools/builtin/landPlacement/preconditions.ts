// Sec.9: P1-P6 as pure predicates, returning structured results, plus the
// one-click fixes for P3 and P6 as pure `TextEdit` builders. The panel strip
// only DISPLAYS them; every decision about what to insert and where is here,
// so it is testable without a DOM (role-attributes-escalation.md Sec.8).

import type { LanguageData } from "../../../parser/language";
import type { ParseResult } from "../../../parser/types";
import type { TextEdit } from "../../../../tools-api/index";
import { walkItems } from "../../walkItems";
import { readFenceModel, type AlpModel } from "./fence";
import {
  isPlayerAssigned,
  type LandRole,
  type Placement,
  type RandomParam,
} from "./model";

// ---------------------------------------------------------------------------
// P1, the RawNode-covered fraction of the file, and the lands inside it the
// tool therefore cannot manage (Sec.9). The only precondition that can make
// the tool useless on a valid script: `walkItems` cannot descend a RawNode
// (it visits the "raw" item and stops), so a tool sees no commands, no
// attributes and no sections inside one.
// ---------------------------------------------------------------------------

export interface P1Result {
  ok: boolean;
  /** Total characters covered by RawNode items, across the whole document. */
  rawCoveredChars: number;
  /** rawCoveredChars / source.length; 0 for an empty document. */
  rawFraction: number;
  /**
   * `create_land` occurrences found INSIDE a RawNode's span, by a TOKEN scan
   * over the node's own span, never a regex over the source, which would
   * also match the word inside a comment (this repo has a hard rule against
   * exactly that class of mistake).
   */
  unmanagedLandCount: number;
}

export function checkP1(parse: ParseResult): P1Result {
  const rawSpans: { start: number; end: number }[] = [];
  walkItems(parse, (item) => {
    if (item.kind === "raw") rawSpans.push(item.span);
  });

  const rawCoveredChars = rawSpans.reduce(
    (sum, s) => sum + (s.end - s.start),
    0,
  );
  const rawFraction =
    parse.source.length > 0 ? rawCoveredChars / parse.source.length : 0;

  let unmanagedLandCount = 0;
  for (const span of rawSpans) {
    for (const token of parse.tokens) {
      if (token.isTrivia || token.kind !== "word") continue;
      if (token.start < span.start || token.end > span.end) continue;
      if (token.text === "create_land") unmanagedLandCount++;
    }
  }

  // A RawNode elsewhere in the file that contains no `create_land` is not a
  // reason to warn: Land Placement's whole job is managing `create_land`
  // commands, and a raw span with none inside it is nothing this tool
  // cannot do. `ok` used to be `rawSpans.length === 0`, which fired the
  // "N% of this script is raw text" message at 0.0%/0 commands on any script
  // with a stray unrelated raw node — a true statement about the file and a
  // false alarm about what Land Placement can and cannot manage.
  return {
    ok: unmanagedLandCount === 0,
    rawCoveredChars,
    rawFraction,
    unmanagedLandCount,
  };
}

// ---------------------------------------------------------------------------
// P2, a perPlayer random parameter pins a player count (Sec.4.4).
//
// per-player-escalation.md Sec.5.4 / slice-b-brief.md item 3 lifted the
// restriction this exists to catch: `paramEmit.ts` now emits every
// `perPlayer` param at MAX_PLAYER_COUNT unconditionally, so
// `RandomParam.emittedForPlayerCount` is never stamped by this tool any
// more (model.ts's own doc comment) and this check has nothing left to fire
// on. Kept rather than deleted: `LandPlacementPanel.tsx` still calls it and
// still renders `p2Mismatches` (a live caller, slice-b-brief.md's own hazard
// 3), and a `RandomParam` built by hand or imported from elsewhere could
// still carry a stale `emittedForPlayerCount` this remains correct against.
// ---------------------------------------------------------------------------

export interface PlayerCountMismatch {
  paramId: string;
  label: string;
  emittedFor: number;
  livePlayerCount: number;
}

export interface P2Result {
  ok: boolean;
  mismatches: readonly PlayerCountMismatch[];
}

export function checkP2(
  params: readonly RandomParam[],
  livePlayerCount: number,
): P2Result {
  const mismatches: PlayerCountMismatch[] = [];
  for (const p of params) {
    if (!p.perPlayer || p.emittedForPlayerCount === undefined) continue;
    if (p.emittedForPlayerCount !== livePlayerCount) {
      mismatches.push({
        paramId: p.id,
        label: p.label,
        emittedFor: p.emittedForPlayerCount,
        livePlayerCount,
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

// ---------------------------------------------------------------------------
// P3, direct_placement for any player-assigned land (Sec.6.3).
// ---------------------------------------------------------------------------

/**
 * `direct_placement` is a bare attribute (no arguments) conventionally
 * declared inside `<PLAYER_SETUP>`, confirmed against `test-maps/
 * Bulls_Eyes.rms:239` and `language.json`. A plain token scan is enough:
 * this precondition only needs to know it is declared SOMEWHERE live, not
 * which section (`validate()`'s RMS0304 already owns section-placement
 * correctness).
 */
function hasDirectPlacement(parse: ParseResult): boolean {
  return parse.tokens.some(
    (t) => !t.isTrivia && t.kind === "word" && t.text === "direct_placement",
  );
}

export interface P3Result {
  ok: boolean;
  hasPlayerAssignedLand: boolean;
  directPlacementDeclared: boolean;
}

export function checkP3(
  roles: readonly LandRole[],
  parse: ParseResult,
): P3Result {
  const hasPlayerAssignedLand = roles.some((r) => isPlayerAssigned(r.assign));
  const directPlacementDeclared = hasDirectPlacement(parse);
  return {
    ok: !hasPlayerAssignedLand || directPlacementDeclared,
    hasPlayerAssignedLand,
    directPlacementDeclared,
  };
}

// ---------------------------------------------------------------------------
// P4, emitted names must not collide (Sec.5.6), checked against
// parseResult.symbols AND language.json.
// ---------------------------------------------------------------------------

/**
 * Every name `NameAllocator` must be seeded with before it allocates a
 * single candidate, first-definition-wins is the engine's rule
 * (`instantiate.ts`), so a shadowing emit is a silent no-op rather than an
 * error, which is exactly why this has to be checked BEFORE offering an
 * edit rather than left to be noticed after.
 */
export function reservedNames(
  parse: ParseResult,
  lang: LanguageData,
): Set<string> {
  const names = new Set<string>();
  for (const s of parse.symbols) names.add(s.name);
  for (const c of lang.commands) names.add(c.name);
  for (const a of lang.attributes) names.add(a.name);
  for (const d of lang.directives) names.add(d.name);
  for (const s of lang.sections) names.add(s);
  for (const k of lang.controlKeywords) names.add(k.name);
  return names;
}

export interface P4Result {
  ok: boolean;
  /** Candidate names that DO collide, present only when something upstream (a `NameAllocator` not seeded from `reservedNames`) got this wrong. */
  collisions: readonly string[];
}

/**
 * A safety net rather than the primary defence: `NameAllocator` itself
 * already renames on collision when seeded correctly (Sec.5.6,
 * Sec.10.2 item 5), so a non-empty result here means a caller built one
 * without `reservedNames`'s output, not that collision-avoidance failed.
 */
export function checkP4(
  candidateNames: readonly string[],
  parse: ParseResult,
  lang: LanguageData,
): P4Result {
  const reserved = reservedNames(parse, lang);
  const collisions = candidateNames.filter((n) => reserved.has(n));
  return { ok: collisions.length === 0, collisions };
}

// ---------------------------------------------------------------------------
// P5, the fence's @alp-model must parse (Sec.6.1). Falls out of item 1.
// ---------------------------------------------------------------------------

export interface P5Result {
  ok: boolean;
  model: AlpModel | null;
}

export function checkP5(parse: ParseResult): P5Result {
  const model = readFenceModel(parse);
  return { ok: model !== null, model };
}

// ---------------------------------------------------------------------------
// P6, `<ELEVATION_GENERATION>` must exist when any emitted land carries a
// `base_elevation` (role-attributes-escalation.md Sec.8).
// ---------------------------------------------------------------------------

/**
 * `language.json` carries `requiresSection: "ELEVATION_GENERATION"` on
 * `base_elevation` (measured in game 2026-07-30, RMS0311): without the
 * section the map generates and looks right while every slope silently
 * does nothing. `buildLandAttachmentExpectations` writes `base_elevation`
 * into EVERY skeleton unconditionally, so the tool can trip the app's own
 * error diagnostic on a script the user never prepared for it. The section
 * may be completely empty; presence is all the engine needs.
 */
export interface P6Result {
  ok: boolean;
  /** True when at least one placement wears a role, so at least one skeleton will carry `base_elevation`. */
  needsSection: boolean;
  sectionDeclared: boolean;
}

const ELEVATION_SECTION = "ELEVATION_GENERATION";

export function checkP6(
  placements: readonly Placement[],
  parse: ParseResult,
): P6Result {
  const needsSection = placements.some((p) => p.role !== undefined);
  const sectionDeclared = parse.script.sections.some(
    (sec) => sec.name === ELEVATION_SECTION,
  );
  return {
    ok: !needsSection || sectionDeclared,
    needsSection,
    sectionDeclared,
  };
}

// ---------------------------------------------------------------------------
// One-click fixes. Pure edit builders; the panel applies what they return.
// ---------------------------------------------------------------------------

/** Offset just past the end of the line that contains `offset` (after its newline), or the document end. */
function endOfLine(source: string, offset: number): number {
  const nl = source.indexOf("\n", offset);
  return nl === -1 ? source.length : nl + 1;
}

/**
 * P6's fix: insert an empty `<ELEVATION_GENERATION>` section. Placed right
 * after the LAST `<LAND_GENERATION>` section's content (which is where the
 * guide's own ordering puts it, and where the user will look for it), or at
 * the document end when there is no land section at all. Sections are
 * order-independent to the engine; this is about legibility.
 */
export function buildElevationSectionFix(parse: ParseResult): TextEdit[] {
  const { source } = parse;
  const lands = parse.script.sections.filter(
    (sec) => sec.name === "LAND_GENERATION",
  );
  const last = lands[lands.length - 1];
  const at = last === undefined ? source.length : last.span.end;
  const before = source.slice(0, at);
  const prefix =
    before.length === 0
      ? ""
      : before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n";
  const after = source.slice(at);
  const suffix = after.length === 0 || after.startsWith("\n") ? "\n" : "\n\n";
  return [
    { start: at, end: at, newText: `${prefix}<${ELEVATION_SECTION}>${suffix}` },
  ];
}

/**
 * P3's fix: declare `direct_placement`. Goes on its own line right under the
 * first `<PLAYER_SETUP>` header. With no such section, a new one is opened
 * just before the first section header (so `#const`s in the preamble stay
 * where they are), or at the end of a section-less document.
 */
export function buildDirectPlacementFix(parse: ParseResult): TextEdit[] {
  const { source, tokens } = parse;
  const setup = parse.script.sections.find(
    (sec) => sec.name === "PLAYER_SETUP",
  );
  if (setup !== undefined) {
    const at = endOfLine(source, tokens[setup.header].end);
    // The header may be the last thing in the file with no newline after
    // it; `endOfLine` then returns the document end, so open the line first.
    const needsBreak = at === source.length && !source.endsWith("\n");
    return [
      {
        start: at,
        end: at,
        newText: `${needsBreak ? "\n" : ""}direct_placement\n`,
      },
    ];
  }
  const first = parse.script.sections[0];
  const at = first === undefined ? source.length : tokens[first.header].start;
  const before = source.slice(0, at);
  const prefix =
    before.length === 0
      ? ""
      : before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n";
  return [
    {
      start: at,
      end: at,
      newText: `${prefix}<PLAYER_SETUP>\ndirect_placement\n\n`,
    },
  ];
}
