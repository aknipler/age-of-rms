// The shared "does this name exist here, and what is it" lookup behind
// autocomplete, the confirmation flash and the unknown const offer
// (docs/name-lookup-design.md). Pure, like everything in src/parser/, so the
// Code editor, the Breakdown and the Land Placement panel can all call it on
// the keystroke and Vitest can call it in plain Node.
//
// TWO HALVES, BUILT AT DIFFERENT RATES. The static index (reference data)
// never changes while the app runs, so it is built once. The script index
// is rebuilt from every new ParseResult. Splitting them is what keeps a
// keystroke from re-reading 4000 constant rows. It is the same idea as
// React's useMemo with two different dependency lists, done by hand, so the
// callers can memoise each half on its own dependency.
//
// THE RULE THIS FILE MUST NOT BREAK is the positive resolver rule in
// CLAUDE.md. A hit in our data proves what a name is. A miss proves only
// that our data does not know it. So `unknown` below is a statement about
// our data, and nothing built on it may claim more (Sec.7.1 of the design
// keeps the create offer neutral for exactly this reason).

import { matchRank } from "../breakdown/pickerRanking";
import type { ArgumentDef, CommandDef, LanguageData } from "./language";
import { lineNumberOfOffset } from "./lineIndex";
import { editDistanceCapped } from "./parser";
import { isDefinedAbove } from "./scope";
import type { DirectiveNode, Item, ParseResult, SymbolInfo } from "./types";
import {
  CATEGORY_ALIAS_OF,
  CONSTANT_SLOT_CATEGORY,
  NON_AMBIENT_CONSTANT_CATEGORIES,
} from "./validate";

// `matchRank` lives in src/breakdown/ because the Add Command picker needed
// it first. It is pure and imports nothing, so reaching for it from here
// keeps the parser worker-safe (the ESLint purity block allows it). Copying
// it would give the picker and the suggestions two match rules.

/**
 * The fields of a game-constants.json row this module reads. Structurally
 * typed, so the real JSON rows and validate.ts's narrower view both satisfy
 * it without an adapter. Nullable and optional together for the reason
 * `commentOpenAliases` in validate.ts gives: the JSON carries null, other
 * views model the same absence as optional.
 */
export interface LookupConstantRow {
  rmsConstant?: string | null;
  category?: string | null;
  constId?: number | null;
  descriptiveName?: string | null;
}

/** One named row, cleaned of the nulls the JSON carries. */
export interface BuiltinRow {
  name: string;
  category: string;
  constId: number | null;
  descriptiveName?: string;
}

/**
 * What kind of text the caret is in. A discriminated union rather than one
 * object with optional fields, so a `switch (slot.kind)` gets exhaustiveness
 * checking: add a fifth kind and the compiler points at every switch below
 * that has not handled it.
 */
export type SlotKind =
  /** A command, attribute or directive argument. The whole def, not just its type, since Sec.8's default reads `default` and `min`. */
  | { kind: "argument"; def: ArgumentDef }
  /** An `if`/`elseif` condition. Resolves `#define`, `#const` and predefined labels, never a game constant. */
  | { kind: "condition" }
  /** A Land Placement formula. The script's `#const`s with no position test (Sec.9). */
  | { kind: "formula" }
  /** The first word of a line. `enclosing` is the block's command when inside one. */
  | {
      kind: "lineStart";
      enclosing: CommandDef | null;
      section: string | null;
      /**
       * The block command a person is still writing the header of, outside
       * any block: `create_object SCOUT` on the line above, no `{` yet. Its
       * attributes are offered beside the commands, since that is what
       * typing at this spot almost always means.
       */
      pending?: CommandDef | null;
    };

export type Resolution =
  | { kind: "number" }
  | { kind: "builtin"; row: BuiltinRow }
  /**
   * Defined above the use. `conditional` when every definition above sits
   * inside an if or start_random branch. `symbol` is the first one, the one
   * the engine keeps. `aliasOf` is set for a name to name `#const`
   * (`#const TERR_CORNER GRASS2`, BUG-015), the built-in it was given,
   * followed once.
   */
  | {
      kind: "script";
      symbol: SymbolInfo;
      conditional: boolean;
      aliasOf?: BuiltinRow;
    }
  /** Defined only below the use, RMS0303's case. `symbol` is the first definition below. */
  | { kind: "definedBelow"; symbol: SymbolInfo }
  /** A predefined condition label, condition slots only. */
  | { kind: "label" }
  /** Our data knows the name, under a category this slot does not take. */
  | { kind: "otherKind"; category: string }
  /** Our data does not know the name. Proves nothing about the game. */
  | { kind: "unknown" };

export interface Suggestion {
  name: string;
  source:
    | "script"
    | "builtin"
    | "label"
    | "command"
    | "attribute"
    | "directive"
    | "keyword"
    | "section";
  /** Built-in rows. */
  category?: string;
  constId?: number | null;
  descriptiveName?: string;
  /** Script names, the 1-based line of the definition the engine keeps (or of the first one below, for `definedBelow`). */
  line?: number;
  definedBelow?: boolean;
  conditional?: boolean;
  /** Commands and attributes, from language.json. */
  description?: string;
}

/**
 * The short line a suggestion row carries beside its name (design Sec.4.1,
 * "each item carries the same text the hover shows"). Shared by Monaco's list
 * and the Breakdown's, so the two cannot describe one name two ways. Undefined
 * for commands, attributes and the like, whose description is the longer text
 * a list shows on selection rather than inline.
 */
export function describeSuggestion(s: Suggestion): string | undefined {
  switch (s.source) {
    case "builtin":
      return `${s.category} ${s.constId ?? ""}${s.descriptiveName ? `, ${s.descriptiveName}` : ""}`;
    case "script":
      if (s.definedBelow)
        return `defined below (line ${s.line}), the game ignores it here`;
      return `your #const, line ${s.line}${s.conditional ? ", inside a branch" : ""}`;
    case "label":
      return "predefined label";
    default:
      return undefined;
  }
}

export interface StaticNameIndex {
  /** Every named row, all categories. A resolution hit, the positive resolver. */
  readonly rowsByName: ReadonlyMap<string, readonly BuiltinRow[]>;
  /**
   * Rows a script sees without an `#include`, grouped by name. Suggestions
   * come only from here, since offering a constants.inc-only name would offer
   * something that may not work. Resolution still reads `rowsByName`, so
   * typing such a name never draws a create offer either.
   */
  readonly ambientByName: ReadonlyMap<string, readonly BuiltinRow[]>;
  /** `${category}:${constId}` to the first row, for saying "0 is GRASS". */
  readonly rowByCategoryAndId: ReadonlyMap<string, BuiltinRow>;
  readonly language: LanguageData;
}

export interface ScriptNameIndex {
  readonly parse: ParseResult;
  /** In source order within each name, the order `parseRms` records them. */
  readonly symbolsByName: ReadonlyMap<string, readonly SymbolInfo[]>;
}

// ---------------------------------------------------------------------------
// Building the two halves
// ---------------------------------------------------------------------------

export function buildStaticNameIndex(
  language: LanguageData,
  constants: readonly LookupConstantRow[],
): StaticNameIndex {
  const rowsByName = new Map<string, BuiltinRow[]>();
  const ambientByName = new Map<string, BuiltinRow[]>();
  const rowByCategoryAndId = new Map<string, BuiltinRow>();
  for (const c of constants) {
    // A row with no name is reached by bare id only, see gameConstants.ts.
    if (!c.rmsConstant || !c.category) continue;
    const row: BuiltinRow = {
      name: c.rmsConstant,
      category: c.category,
      constId: c.constId ?? null,
      descriptiveName: c.descriptiveName ?? undefined,
    };
    pushTo(rowsByName, row.name, row);
    if (!NON_AMBIENT_CONSTANT_CATEGORIES.has(row.category))
      pushTo(ambientByName, row.name, row);
    if (row.constId !== null) {
      const key = `${row.category}:${row.constId}`;
      if (!rowByCategoryAndId.has(key)) rowByCategoryAndId.set(key, row);
    }
  }
  return { rowsByName, ambientByName, rowByCategoryAndId, language };
}

export function buildScriptNameIndex(parse: ParseResult): ScriptNameIndex {
  const symbolsByName = new Map<string, SymbolInfo[]>();
  for (const s of parse.symbols) pushTo(symbolsByName, s.name, s);
  return { parse, symbolsByName };
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ---------------------------------------------------------------------------
// Which rows a slot takes
// ---------------------------------------------------------------------------

/**
 * Whether a built-in row can stand in this slot. The category rules are
 * validate.ts's, imported rather than restated, so RMS0205 and this lookup
 * cannot disagree about what fits a terrain slot (design Sec.2.2).
 *
 * Numeric slots take any ambient name, which is what the parser's
 * `ParseOptions.builtinConstants` already accepts. `otherConstant` is the
 * open slot and takes any row at all, the same reason validate.ts leaves it
 * out of CONSTANT_SLOT_CATEGORY.
 */
function slotTakesRow(slot: SlotKind, row: BuiltinRow): boolean {
  if (slot.kind !== "argument") return false;
  const type = slot.def.type;
  const expected = CONSTANT_SLOT_CATEGORY[type];
  if (expected !== undefined)
    return (
      row.category === expected || row.category === CATEGORY_ALIAS_OF[expected]
    );
  if (type === "otherConstant") return true;
  if (type === "integer" || type === "percent" || type === "flag")
    return !NON_AMBIENT_CONSTANT_CATEGORIES.has(row.category);
  return false; // "string" slots hold file paths, not names
}

/** Script symbols a slot can name. A `#define` carries no number, so only condition slots and the parser's permissive numeric reading take one. */
function slotTakesSymbol(slot: SlotKind, symbol: SymbolInfo): boolean {
  switch (slot.kind) {
    case "condition":
      return true;
    case "formula":
      return symbol.directiveKind === "const";
    case "lineStart":
      return false;
    case "argument": {
      const type = slot.def.type;
      if (type === "string") return false;
      // The parser accepts a #define in a numeric slot without comment
      // (parser.ts isDefinedSymbol), so resolving it here keeps the flash
      // from contradicting a silent parser. Suggestions still leave
      // #defines out of these slots, see suggest().
      return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Resolving one name
// ---------------------------------------------------------------------------

/**
 * The first token whose start is at or after `at`. Used to turn an offset
 * into the token index the scope rule (scope.ts) compares, so the offset
 * callers (Code) and the token callers (Breakdown, validate) share one
 * predicate. Binary search, since `tokens` is sorted by start.
 */
export function tokenIndexAt(parse: ParseResult, at: number): number {
  const tokens = parse.tokens;
  let lo = 0;
  let hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].start < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function lineOfToken(parse: ParseResult, tokenIndex: number): number {
  return lineNumberOfOffset(parse.lineOffsets, parse.tokens[tokenIndex].start);
}

/** A word the parser reads as a number, `inf` and `-inf` included. */
function isNumberWord(text: string): boolean {
  if (text === "inf" || text === "-inf") return true;
  return text.trim() !== "" && !Number.isNaN(Number(text));
}

/**
 * What `name` is at offset `at` in this slot.
 *
 * The order copies `resolveTerrainId` in preview/generator/grid.ts, the
 * resolver the preview already shares. A number is itself. A built-in comes
 * before the script's own `#const`, because the engine loads random_map.def
 * first and the first definition wins (RMS0302).
 */
export function resolveName(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  name: string,
  at: number,
  slot: SlotKind,
): Resolution {
  if (isNumberWord(name)) return { kind: "number" };
  const useIndex = tokenIndexAt(script.parse, at);
  const definitions = (script.symbolsByName.get(name) ?? []).filter((s) =>
    slotTakesSymbol(slot, s),
  );

  if (slot.kind === "formula") {
    // Sec.9: a formula reads the script's consts with no position test,
    // since the fence's own placement decides what is above it.
    const first = definitions[0];
    if (!first) return { kind: "unknown" };
    return {
      kind: "script",
      symbol: first,
      conditional: definitions.every((s) => s.conditionalDepth > 0),
    };
  }

  if (slot.kind === "argument") {
    const rows = stat.rowsByName.get(name);
    if (rows) {
      const taken = rows.find((r) => slotTakesRow(slot, r));
      if (taken) return { kind: "builtin", row: taken };
      // The name IS a game constant, so a script `#const` of it never takes
      // effect (RMS0302), and the slot is the problem, not the name.
      return { kind: "otherKind", category: rows[0].category };
    }
  }

  const scoped = scriptResolution(definitions, useIndex);
  if (scoped.kind === "script") {
    const aliasOf = aliasTarget(stat, script, scoped.symbol, slot);
    return aliasOf ? { ...scoped, aliasOf } : scoped;
  }

  if (slot.kind === "condition") {
    const labels = stat.language.predefinedLabels ?? [];
    if (labels.some((l) => l.name === name)) return { kind: "label" };
  }
  return scoped;
}

/**
 * The built-in a name to name `#const` was given, followed once, as
 * grid.ts's form 4 does (BUG-015). Once and not recursively, matching the
 * preview, so the two cannot disagree about what `TERR_CORNER` is. Only a
 * value that is one plain word counts, an expression is not an alias.
 */
function aliasTarget(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  symbol: SymbolInfo,
  slot: SlotKind,
): BuiltinRow | undefined {
  if (symbol.directiveKind !== "const" || symbol.valueToken === undefined)
    return undefined;
  const text = script.parse.tokens[symbol.valueToken]?.text;
  if (!text || isNumberWord(text)) return undefined;
  const rows = stat.rowsByName.get(text);
  if (!rows) return undefined;
  return rows.find((r) => slotTakesRow(slot, r)) ?? rows[0];
}

/** The scope half of resolveName, on scope.ts's predicate. */
function scriptResolution(
  definitions: readonly SymbolInfo[],
  useIndex: number,
): Resolution {
  if (definitions.length === 0) return { kind: "unknown" };
  if (isDefinedAbove(definitions, useIndex)) {
    const above = definitions.filter((s) => s.nameToken < useIndex);
    return {
      kind: "script",
      symbol: above[0],
      conditional: above.every((s) => s.conditionalDepth > 0),
    };
  }
  return { kind: "definedBelow", symbol: definitions[0] };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

/** Built-in objects join the list from this many typed characters (Sec.3), since one letter matches several hundred of them. */
const OBJECT_MIN_PREFIX = 2;

interface Ranked {
  suggestion: Suggestion;
  tier: number;
  /** Sec.3's source order, lower first. */
  sourceOrder: number;
  /** Characters between the caret and the definition above it, script names only. */
  distance: number;
}

/**
 * Suggestions for `prefix` typed at `at`, strongest first (design Sec.3).
 * Returns up to `limit` rows. The list a person sees shows 12 and scrolls.
 */
export function suggest(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  prefix: string,
  at: number,
  slot: SlotKind,
  limit = 100,
): Suggestion[] {
  const q = prefix.trim().toLowerCase();
  const ranked: Ranked[] =
    slot.kind === "lineStart"
      ? lineStartCandidates(stat, slot, q, prefix.trim())
      : nameCandidates(stat, script, slot, q, at);
  ranked.sort(
    (a, b) =>
      // Sec.9, settled 2026-10-22: a name defined only below goes after every
      // other row, whatever its match tier.
      Number(a.suggestion.definedBelow ?? false) -
        Number(b.suggestion.definedBelow ?? false) ||
      a.tier - b.tier ||
      a.sourceOrder - b.sourceOrder ||
      a.distance - b.distance ||
      a.suggestion.name.length - b.suggestion.name.length ||
      a.suggestion.name.localeCompare(b.suggestion.name),
  );
  return ranked.slice(0, limit).map((r) => r.suggestion);
}

function nameCandidates(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  slot: SlotKind,
  q: string,
  at: number,
): Ranked[] {
  const out: Ranked[] = [];
  const useIndex = tokenIndexAt(script.parse, at);
  const seen = new Set<string>();

  for (const [name, all] of script.symbolsByName) {
    // A #define has no number, so outside a condition it is never offered,
    // even where resolveName tolerates one.
    const defs = all.filter(
      (s) =>
        slotTakesSymbol(slot, s) &&
        (slot.kind === "condition" || s.directiveKind === "const"),
    );
    if (defs.length === 0) continue;
    // A script name that is also a game constant is the game constant
    // (RMS0302), so it is listed once below, as built-in.
    if (stat.rowsByName.has(name) && slot.kind === "argument") continue;
    const tier = matchRank({ name }, q);
    if (tier === null) continue;
    seen.add(name);
    const above =
      slot.kind === "formula"
        ? defs
        : defs.filter((s) => s.nameToken < useIndex);
    if (above.length > 0) {
      const nearest = above[above.length - 1];
      out.push({
        suggestion: {
          name,
          source: "script",
          line: lineOfToken(script.parse, above[0].nameToken),
          conditional: above.every((s) => s.conditionalDepth > 0) || undefined,
        },
        tier,
        sourceOrder: 0,
        distance: Math.max(
          0,
          at - script.parse.tokens[nearest.nameToken].start,
        ),
      });
    } else {
      out.push({
        suggestion: {
          name,
          source: "script",
          line: lineOfToken(script.parse, defs[0].nameToken),
          definedBelow: true,
        },
        tier,
        sourceOrder: 0,
        distance: 0,
      });
    }
  }

  if (slot.kind === "condition") {
    for (const label of stat.language.predefinedLabels ?? []) {
      if (seen.has(label.name)) continue;
      const tier = matchRank({ name: label.name }, q);
      if (tier === null) continue;
      seen.add(label.name);
      out.push({
        suggestion: {
          name: label.name,
          source: "label",
          description: label.description,
        },
        tier,
        sourceOrder: 1,
        distance: 0,
      });
    }
    return out;
  }

  if (slot.kind !== "argument") return out;
  for (const [name, rows] of stat.ambientByName) {
    if (seen.has(name)) continue;
    const row = rows.find((r) => slotTakesRow(slot, r));
    if (!row) continue;
    if (row.category === "object" && q.length < OBJECT_MIN_PREFIX) continue;
    const tier = matchRank({ name }, q);
    if (tier === null) continue;
    out.push({
      suggestion: {
        name,
        source: "builtin",
        category: row.category,
        constId: row.constId,
        descriptiveName: row.descriptiveName,
      },
      tier,
      sourceOrder: 2,
      distance: 0,
    });
  }
  return out;
}

function lineStartCandidates(
  stat: StaticNameIndex,
  slot: Extract<SlotKind, { kind: "lineStart" }>,
  q: string,
  raw: string,
): Ranked[] {
  const lang = stat.language;
  const out: Ranked[] = [];
  const add = (
    name: string,
    source: Suggestion["source"],
    sourceOrder: number,
    description?: string,
  ) => {
    // Commands and attributes keep the description tier, constants do not
    // (Sec.3), since a command's text is written to be searched.
    const tier = matchRank({ name, description }, q);
    if (tier === null) return;
    out.push({
      suggestion: { name, source, description },
      tier,
      sourceOrder,
      distance: 0,
    });
  };

  if (raw.startsWith("#")) {
    for (const d of lang.directives) add(d.name, "directive", 0, d.description);
    return out;
  }
  if (raw.startsWith("<")) {
    if (slot.enclosing === null)
      for (const s of lang.sections) add(`<${s}>`, "section", 0);
    return out;
  }

  if (slot.enclosing !== null) {
    const byName = new Map(lang.attributes.map((a) => [a.name, a]));
    for (const name of slot.enclosing.attributes ?? []) {
      const a = byName.get(name);
      add(name, "attribute", 0, a?.description);
    }
  } else {
    const byName = new Map(lang.attributes.map((a) => [a.name, a]));
    for (const name of slot.pending?.attributes ?? []) {
      add(name, "attribute", 0, byName.get(name)?.description);
    }
    for (const c of lang.commands) {
      // Only a MEASURED lock keeps a command out of a section (see
      // CommandDef.sectionLocked). `section` alone is where the guide
      // documents it, and filtering on that would hide legal commands.
      if (slot.section && c.sectionLocked && c.section !== slot.section)
        continue;
      add(c.name, "command", c.section === slot.section ? 0 : 1, c.description);
    }
  }
  for (const k of lang.controlKeywords)
    add(k.name, "keyword", 2, k.description);
  return out;
}

// ---------------------------------------------------------------------------
// The closest built-in name and the default value (design Sec.8, Sec.8.1)
// ---------------------------------------------------------------------------

export interface ClosestBuiltin {
  row: BuiltinRow;
  /** Which of Sec.8.1's steps found it, 1 to 3. */
  rule: 1 | 2 | 3;
}

/** Within this many edits, a name counts as a typo of a known one (Sec.7.1, Sec.8.1). */
const TYPO_DISTANCE = 2;

/**
 * The built-in name nearest to `typed`, within the slot's own category
 * only (primary rows, never the constants.inc alias twin, since only they
 * carry a descriptive name worth showing). Sec.8.1's order:
 *
 * 1. within edit distance 2, the "Did you mean" candidate
 * 2. the strongest suggestion for the whole text
 * 3. the strongest suggestion for each underscore part, last part first
 *
 * Undefined when nothing matches, which is Sec.8.1's step 4 (the caller
 * falls back to 0).
 */
export function closestBuiltin(
  stat: StaticNameIndex,
  typed: string,
  def: ArgumentDef,
): ClosestBuiltin | undefined {
  const category = CONSTANT_SLOT_CATEGORY[def.type];
  if (category === undefined) return undefined;
  const pool: BuiltinRow[] = [];
  for (const rows of stat.ambientByName.values()) {
    const row = rows.find((r) => r.category === category && r.constId !== null);
    if (row) pool.push(row);
  }

  const typo = nearestByEditDistance(typed, pool);
  if (typo) return { row: typo, rule: 1 };

  const whole = strongestMatch(typed, pool);
  if (whole) return { row: whole, rule: 2 };

  const parts = typed.split("_").filter((p) => p !== "");
  // Only worth doing when there is more than one part, a one-part name was
  // step 2 already.
  if (parts.length > 1) {
    for (const part of parts.reverse()) {
      const hit = strongestMatch(part, pool);
      if (hit) return { row: hit, rule: 3 };
    }
  }
  return undefined;
}

/** Nearest name by edit distance, case-insensitive, within TYPO_DISTANCE. Ties go to the shorter name, then alphabetical. */
function nearestByEditDistance<T extends { name: string }>(
  typed: string,
  pool: readonly T[],
): T | undefined {
  const t = typed.toLowerCase();
  let best: { item: T; distance: number } | undefined;
  for (const item of pool) {
    const n = item.name.toLowerCase();
    if (n === t) continue; // an exact hit would have resolved, not be a typo
    const distance = editDistanceCapped(t, n, TYPO_DISTANCE);
    if (distance > TYPO_DISTANCE) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance &&
        (item.name.length < best.item.name.length ||
          (item.name.length === best.item.name.length &&
            item.name.localeCompare(best.item.name) < 0)))
    )
      best = { item, distance };
  }
  return best?.item;
}

/** Sec.3's ranking applied to one query over a pool, first row only. */
function strongestMatch(
  query: string,
  pool: readonly BuiltinRow[],
): BuiltinRow | undefined {
  const q = query.trim().toLowerCase();
  if (q === "") return undefined;
  let best: { row: BuiltinRow; tier: number } | undefined;
  for (const row of pool) {
    const tier = matchRank({ name: row.name }, q);
    if (tier === null) continue;
    if (
      !best ||
      tier < best.tier ||
      (tier === best.tier &&
        (row.name.length < best.row.name.length ||
          (row.name.length === best.row.name.length &&
            row.name.localeCompare(best.row.name) < 0)))
    )
      best = { row, tier };
  }
  return best?.row;
}

export interface DefaultConstValue {
  value: number;
  /** The built-in row the number stands for, shown beside the field (Sec.8.1). Terrain and object slots only. */
  meaning?: BuiltinRow;
}

/** The value a new `#const` for `typed` is pre-filled with (design Sec.8). */
export function defaultConstValue(
  stat: StaticNameIndex,
  typed: string,
  slot: SlotKind,
): DefaultConstValue {
  if (slot.kind !== "argument") return { value: 0 };
  const def = slot.def;
  const category = CONSTANT_SLOT_CATEGORY[def.type];
  if (category !== undefined) {
    const closest = closestBuiltin(stat, typed, def);
    if (closest && closest.row.constId !== null)
      return { value: closest.row.constId, meaning: closest.row };
    return {
      value: 0,
      meaning: stat.rowByCategoryAndId.get(`${category}:0`),
    };
  }
  if (def.type === "integer" || def.type === "percent") {
    // `default` is typed number | string in language.json. A string default
    // names something rather than counting it, so it is skipped here.
    if (typeof def.default === "number") return { value: def.default };
    if (typeof def.min === "number") return { value: def.min };
  }
  return { value: 0 };
}

// ---------------------------------------------------------------------------
// The unknown const offer (design Sec.7)
// ---------------------------------------------------------------------------

export interface UnknownNameOffer {
  /** A known name within edit distance 2, offered before the create choices. */
  didYouMean?: string;
  defaultValue: DefaultConstValue;
}

/**
 * The create offer for `text` at `at`, or null when Sec.7.1 says not to
 * offer one. Every condition has to hold, and each `return null` below is
 * one of them.
 */
export function unknownNameOffer(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  text: string,
  at: number,
  slot: SlotKind,
): UnknownNameOffer | null {
  if (slot.kind !== "argument") return null;
  const type = slot.def.type;
  if (
    type !== "integer" &&
    type !== "percent" &&
    type !== "terrainConstant" &&
    type !== "objectConstant" &&
    type !== "otherConstant"
  )
    return null;
  const name = text.trim();
  if (name === "" || /\s/.test(name) || isNumberWord(name)) return null;
  // An included file can define any name and we cannot read it, so a miss
  // proves even less than usual there.
  if (script.parse.includes.length > 0) return null;
  if (resolveName(stat, script, name, at, slot).kind !== "unknown") return null;

  const typo = didYouMeanFor(stat, script, name, at, slot);
  return {
    didYouMean: typo,
    defaultValue: defaultConstValue(stat, name, slot),
  };
}

function didYouMeanFor(
  stat: StaticNameIndex,
  script: ScriptNameIndex,
  name: string,
  at: number,
  slot: Extract<SlotKind, { kind: "argument" }>,
): string | undefined {
  if (CONSTANT_SLOT_CATEGORY[slot.def.type] !== undefined) {
    const closest = closestBuiltin(stat, name, slot.def);
    return closest?.rule === 1 ? closest.row.name : undefined;
  }
  // Numeric and open slots, any name the slot would resolve, script names
  // above the use included.
  const useIndex = tokenIndexAt(script.parse, at);
  const pool: { name: string }[] = [];
  for (const [n, rows] of stat.ambientByName)
    if (rows.some((r) => slotTakesRow(slot, r))) pool.push({ name: n });
  for (const [n, defs] of script.symbolsByName)
    if (
      defs.some((s) => s.directiveKind === "const") &&
      isDefinedAbove(defs, useIndex)
    )
      pool.push({ name: n });
  return nearestByEditDistance(name, pool)?.name;
}

// ---------------------------------------------------------------------------
// "Move the #const up here" (design Sec.9.1)
// ---------------------------------------------------------------------------

export type MoveUpPlan =
  | {
      ok: true;
      /** The definition to move, the first one below the use. */
      definition: DirectiveNode;
      /** The top-level item to insert it before. */
      before: Item;
    }
  | {
      ok: false;
      reason:
        | "notDefinedBelow"
        | "includes"
        | "conditional"
        | "notTopLevel"
        | "dependsOn";
      /** For "dependsOn", the script name the value reads that is defined in between. */
      dependsOn?: string;
    };

/**
 * Where the first definition of `name` below the use at `at` would move to,
 * or why it may not. Worked out here rather than in a component so the
 * button can be hidden rather than shown and then refused (Sec.9.1).
 */
export function moveUpPlan(
  script: ScriptNameIndex,
  name: string,
  at: number,
): MoveUpPlan {
  const parse = script.parse;
  const definitions = script.symbolsByName.get(name) ?? [];
  const useIndex = tokenIndexAt(parse, at);
  if (definitions.length === 0 || isDefinedAbove(definitions, useIndex))
    return { ok: false, reason: "notDefinedBelow" };
  if (parse.includes.length > 0) return { ok: false, reason: "includes" };
  const first = definitions[0];
  // Lifting a branch's definition out of its branch would change which maps
  // define it.
  if (first.conditionalDepth > 0) return { ok: false, reason: "conditional" };

  const topItems: Item[] = [
    ...parse.script.preamble,
    ...parse.script.sections.flatMap((s) => s.items),
  ];
  const definition = topItems.find(
    (i): i is DirectiveNode =>
      i.kind === "directive" && i.args[0]?.firstToken === first.nameToken,
  );
  // Not at the top level means inside a command's block, a shape
  // conditionalDepth does not count. Moving it out is a bigger change than
  // this offer claims to make.
  if (!definition) return { ok: false, reason: "notTopLevel" };

  // The outermost item that holds the use, or the next one when the use
  // sits between items. The line goes above it, at the definition's own
  // depth, so every use that saw it before still does.
  const before = topItems.find((i) => i.lastToken >= useIndex);
  if (!before || before.lastToken >= definition.firstToken)
    return { ok: false, reason: "notTopLevel" };

  // `#const B (A + 1)` with A defined between the new spot and the old one.
  // Tokens split on whitespace only, so `(A` and `(A+1)` are single tokens.
  // The words inside them are matched against the script's own names, which
  // can only find a real dependency, never invent one.
  for (const arg of definition.args.slice(1)) {
    for (let t = arg.firstToken; t <= arg.lastToken; t++) {
      const token = parse.tokens[t];
      if (token.isTrivia) continue;
      for (const word of token.text.match(/[A-Za-z0-9_]+/g) ?? []) {
        const defs = script.symbolsByName.get(word);
        if (!defs || word === name) continue;
        if (
          !isDefinedAbove(defs, before.firstToken) &&
          isDefinedAbove(defs, definition.firstToken)
        )
          return { ok: false, reason: "dependsOn", dependsOn: word };
      }
    }
  }
  return { ok: true, definition, before };
}
