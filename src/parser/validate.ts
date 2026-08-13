// validate() — the semantic pass, docs/parser-design.md Sec.8. Pure function
// over a finished ParseResult plus reference data: no React/Monaco/Tauri
// imports (Sec.14), so it runs in the parser worker beside parseRms and stays
// fully Vitest-testable in plain Node.
//
// WHY THIS IS A SECOND PASS, not more checks inside the parser. parseRms is
// single-pass and deliberately knows only "what have I seen so far" — that is
// not a shortcut, it is the engine's own rule for constants (a #const only
// counts below its own line, guide:148). Every check in this file needs the
// opposite: the whole file at once. You cannot know a #const is a *re*definition
// until you've seen both, you cannot know a name is undefined until you've read
// to EOF, and you cannot know base_elevation is missing its section until you've
// seen every section header. Folding these into the parser would mean either
// buffering diagnostics until the end (a second pass wearing a disguise) or
// giving wrong answers early.
//
// WHAT THESE CHECKS HAVE IN COMMON, and why they're worth shipping at all: in
// every single case the map still generates. The engine "ignores it or
// substitutes the most recent valid identifier and keeps going". Nothing looks
// broken at authoring time — a typo'd condition label just quietly never fires,
// a redefined #const quietly keeps its old value. These are the bugs that are
// invisible without a tool, which is the whole argument for the pass.
//
// THE ONE RULE THAT SHAPES EVERY DECISION HERE — reference data is a POSITIVE
// resolver, never a negative authority. game-constants.json holds 31 constants;
// the real game has ~130 terrains and hundreds of objects. So finding a name in
// it proves something ("SNOW is a terrain"), but NOT finding one proves nothing
// at all. That asymmetry is why the unknown-name check below runs on if/elseif
// condition labels only, where predefinedLabels + user #defines really are the
// closed vocabulary, and never on terrain/object slots, where it would false-warn
// on every constant Phase 4.0 hasn't extracted yet. Goal #5 (no false alarms on
// legal maps) outranks coverage.

import * as d from "./diagnostics";
import { lineNumberOfOffset } from "./lineIndex";
import { NUMERIC_ARGUMENT_TYPES } from "./language";
import { editDistanceCapped } from "./parser";
import type { ArgumentType, LanguageData, PredefinedLabel } from "./language";
import type {
  ArgNode,
  AttributeNode,
  BlockNode,
  CommandNode,
  Diagnostic,
  DirectiveNode,
  IfBranch,
  IfNode,
  Item,
  ParseResult,
  RandomNode,
  SectionNode,
  SymbolInfo,
  Token,
} from "./types";

/**
 * The slice of game-constants.json this pass needs — deliberately narrower
 * than the file's real shape, same approach as resourceTotals.ts's
 * GameConstantsForTotals. TypeScript is structurally typed, so the full JSON
 * object satisfies this without any adapter: a type here is a description of
 * the shape we read, not a box the data has to be put into.
 */
export interface ValidateConstant {
  rmsConstant: string;
  category: string; // "terrain" | "object" today; kept open, the data may grow
  constId?: number;
  idSource?: string; // provenance gate for RMS0204/RMS0205 wording (spec Sec.6)
}

export interface GameConstantsForValidate {
  constants: ValidateConstant[];
}

export interface ValidateReferenceDb {
  language: LanguageData;
  gameConstants: GameConstantsForValidate;
}

/**
 * Sec.6's ID-resolution gate: only name what an ID resolves to when the
 * game-constants entry says where the ID came from. Everything in the file
 * carries "extracted" as of Phase 4.0's .dat run; "patch-notes" is reserved
 * for the IDs Sec.13 item 7 sources from DE's dated patch notes.
 */
const VERIFIED_PROVENANCE: ReadonlySet<string> = new Set(["extracted", "patch-notes"]);

/**
 * Which game-constants category a typed argument slot expects. `otherConstant`
 * is deliberately absent rather than mapped to something: it is the open slot
 * (Sec.6 — "#const's value slot is otherConstant, not integer", because one
 * item may carry several constants), so there is no category to be wrong about.
 */
const CONSTANT_SLOT_CATEGORY: Partial<Record<ArgumentType, string>> = {
  terrainConstant: "terrain",
  objectConstant: "object",
};

/**
 * Marks a guard literal standing for "the Nth branch of the Mth start_random".
 * Those branches are mutually exclusive but have no condition name to reason
 * about, so they get an opaque literal instead. The NUL prefix keeps them out
 * of the namespace of real condition labels, which come from token text and
 * can otherwise contain very nearly anything.
 */
const RANDOM_BRANCH_PREFIX = "\u0000rnd";

/**
 * The engine's own token id for the opening comment marker, inferred from four
 * in-game runs (parser-design Sec.2.1 amendment). Drives RMS0111. The id for
 * the CLOSING marker is still unknown, so the words that would close a comment
 * early are unenumerated and this check is deliberately one-sided.
 */
export const COMMENT_OPEN_ID = 69;

/**
 * The words the lexer must treat as `/*` when it meets them INSIDE a comment,
 * built from reference data so no RMS vocabulary is hardcoded. Feed the result
 * to `ParseOptions.commentOpenAliases`.
 *
 * Engine-defined names only. A script's own `#const NAME 69` is caught by
 * RMS0111 but is NOT modelled, because deciding it needs the directive stream
 * the lexer deliberately does not read — see the note on `checkCommentOpeningWords`.
 */
export function commentOpenAliases(
  // Structurally typed to the two fields it reads, and both slots accept null
  // AND undefined: the JSON carries null, `ValidateConstant` models the same
  // absence as optional, and a parameter narrower than either caller is a
  // compile error rather than a bug — which is how this signature was found.
  constants: readonly { rmsConstant?: string | null; constId?: number | null }[],
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const c of constants) {
    if (c.constId === COMMENT_OPEN_ID && c.rmsConstant) names.add(c.rmsConstant);
  }
  return names;
}

/** One `#const`, with the conditions that have to hold for it to run. */
interface GuardedDefinition {
  symbol: SymbolInfo;
  /** Innermost last. A negated condition is the name prefixed with "!". */
  guards: readonly string[];
  /** `guards` joined for equality comparison — see recordConstDefinition. */
  path: string;
}

class Validator {
  readonly diagnostics: Diagnostic[] = [];

  private readonly tokens: Token[];
  private readonly includesPresent: boolean;

  // Grouped rather than a plain name->symbol map: a name legitimately has
  // several definitions (exclusive if/elseif branches), and both the
  // duplicate check and the use-before-definition check need to reason over
  // all of them, not just the last writer to win the map slot.
  private readonly symbolsByName = new Map<string, SymbolInfo[]>();
  private readonly predefinedByName = new Map<string, PredefinedLabel>();
  private readonly constantsByName = new Map<string, ValidateConstant>();
  private readonly constantsByCategoryAndId = new Map<string, ValidateConstant>();
  private readonly sectionNames = new Set<string>();

  // Names whose #define/#const is present in the file but COMMENTED OUT.
  // Toggling a feature by commenting its #define is a real RMS idiom, and the
  // resulting `if DEBUG_MODE` branches are dead on purpose — 168 uses of that
  // one flag in a single DE-official map. Without this the unknown-name check
  // cannot tell a deliberate switch-off from a typo, and reports the idiom as
  // an error hundreds of times per file.
  private readonly disabledDefinitions = new Set<string>();

  // The section currently being walked, or undefined while walking the
  // preamble. A mutable field rather than a walkItem parameter for the same
  // reason `guards` below is one: walkItem is an eight-arm discriminated-union
  // switch and exactly two arms care.
  //
  // RMS0304 reports NOTHING for the preamble. That is a deliberate limit and
  // not an oversight — what RMSTEST_33a/33b measured is a locked command in the
  // WRONG section, never one in no section at all, and this check does not
  // claim past its measurement.
  private currentSection: SectionNode | undefined;

  // Sec.8's wrong-section suppression rule, revived alongside RMS0304 (its
  // only consumer). A degraded region can SWALLOW a section header — the
  // parser's recovery scan absorbs one outright when only conditionals are
  // open (parser.ts, "Only conditionals open → legal spanning; absorb the
  // header") — and every item after that point is then attributed to the
  // previous section. Reporting those would be reporting the parser's own
  // recovery as the author's mistake, and it would do so exactly on the
  // broken files where a warning is least readable.
  //
  // Deliberately triggered by ANY RawNode rather than only the reasons that
  // can absorb a header. The two directions are not symmetric: over-suppressing
  // loses a true positive in an already-degraded file, while under-suppressing
  // invents warnings from a recovery artefact, and this check's whole history
  // is false positives.
  private sectionAttributionLost = false;

  // RMS0311 is a file-level condition with a line-level span: report the first
  // use of each attribute that's missing its section, not all forty.
  private readonly reportedMissingSections = new Set<string>();

  // The conditions guarding the item currently being walked, innermost last.
  // An `if A` contributes "A" to its own branch; every later branch of that
  // chain inherits "!A". Two definitions with an IDENTICAL guard stack sit on
  // one execution path — either both run or neither does — which is the whole
  // basis of RMS0301 below. Maintained as a mutable stack rather than passed
  // down as a parameter because walkItem is a discriminated-union switch with
  // eight arms and only two of them care.
  private readonly guards: string[] = [];
  private randomCounter = 0;

  // Every #const seen during the walk, with the path it sits on. Collected
  // rather than checked in place: a redefinition is only visible once both
  // definitions have been walked.
  private readonly constDefinitions: GuardedDefinition[] = [];

  // Keyed by the token index the parser recorded as the symbol's name, which
  // is `firstArg.firstToken` (parser.ts:388) — the same token the walk sees as
  // args[0].firstToken. Correlating instead of re-deriving keeps ONE answer to
  // "is this a #const or a #define" in the codebase, the parser's.
  private readonly symbolByNameToken = new Map<number, SymbolInfo>();

  // refDb is read apart into the lookup maps below and never kept: every
  // consumer wants an indexed view, and holding the raw arrays as well would
  // just invite a linear scan to creep back in later.
  constructor(
    private readonly result: ParseResult,
    refDb: ValidateReferenceDb,
  ) {
    this.tokens = result.tokens;
    this.includesPresent = result.includes.length > 0;

    for (const symbol of result.symbols) {
      const list = this.symbolsByName.get(symbol.name);
      if (list) list.push(symbol);
      else this.symbolsByName.set(symbol.name, [symbol]);
      this.symbolByNameToken.set(symbol.nameToken, symbol);
    }
    // `?? []` is mandated, not defensive: predefinedLabels is optional on
    // LanguageData precisely so this guard stays live as the backstop against
    // a data regression silently making every conditional look undefined
    // (docs/preview-design.md Sec.3.1).
    for (const label of refDb.language.predefinedLabels ?? []) {
      this.predefinedByName.set(label.name, label);
    }
    for (const constant of refDb.gameConstants.constants) {
      this.constantsByName.set(constant.rmsConstant, constant);
      if (constant.constId !== undefined) {
        // Keyed by category too: terrain 0 and object 0 are different id
        // spaces, and conflating them is exactly the bug the Phase 4.0
        // extraction run hit when it joined Graphic.slp against Terrain.slp.
        this.constantsByCategoryAndId.set(`${constant.category}:${constant.constId}`, constant);
      }
    }
    for (const section of result.script.sections) this.sectionNames.add(section.name);

    // The lexer tokenizes comment interiors normally and only flags the tokens
    // `isTrivia` afterwards (lexer.ts, the comment-span pass), so a
    // commented-out definition is still fully readable here — no re-scan of
    // the raw source needed.
    for (let i = 0; i < this.tokens.length - 1; i++) {
      const token = this.tokens[i];
      if (!token.isTrivia || token.kind !== "directive") continue;
      if (token.text !== "#define" && token.text !== "#const") continue;
      const name = this.tokens[i + 1];
      if (name.isTrivia) this.disabledDefinitions.add(name.text);
    }
  }

  /**
   * The 1-based line an offset falls on, for the messages that point at a
   * SECOND place in the file — the earlier definition, the branch that
   * already ran, the other half of a mutex pair.
   *
   * Only the PROSE takes a line. Every `span` stays a character offset, which
   * is what Monaco, the Breakdown ruler and `shiftPointThroughEdits` all
   * consume; a diagnostic carrying a line number as position data would go
   * stale on the first edit above it.
   */
  private lineOf(offset: number): number {
    return lineNumberOfOffset(this.result.lineOffsets, offset);
  }

  // ---- entry point ------------------------------------------------------

  run(): void {
    this.checkCommentOpeningWords();
    this.checkDefinitions();
    this.checkMissingPlayerSetup();

    this.walkItems(this.result.script.preamble);
    for (const section of this.result.script.sections) {
      // Reset per section: "the next real header" in Sec.8's suppression rule
      // is exactly this loop boundary, since a header the parser DID see is
      // one that could not have been swallowed.
      this.currentSection = section;
      this.sectionAttributionLost = false;
      this.walkItems(section.items);
    }
    this.currentSection = undefined;

    // After the walk, not during: it consumes the execution paths the walk
    // collects, and a path is only known once its whole subtree has been
    // visited.
    this.checkRedefinitions();

    // Emit in source order. The parser's diagnostics come out in token order
    // for free; these don't (file-level checks run first), and the Breakdown
    // diagnostics ruler and Monaco's marker list both read better sorted.
    this.diagnostics.sort((a, b) => a.span.start - b.span.start || a.code.localeCompare(b.code));
  }

  // ---- file-level checks ------------------------------------------------

  /**
   * RMS0111 — a word inside a comment that the engine resolves to **69**, its
   * own id for `/*`. Measured (parser-design Sec.2.1 amendment): a leading
   * comment containing `SHORE_FISH` (object 69) or `ATTR_PROJECTILE_ARC`
   * (attribute 69) blanked the map, while the bare literal `69` did not —
   * numeric literals are lexed as numbers and never reach the symbol table, so
   * **it is the value, carried by a word**, and the namespace is irrelevant.
   *
   * **Reported, not modelled — decided 2026-08-11, do not re-open.** Treating
   * the rest of the file as commented would match the engine and would hand
   * the author an empty Breakdown for a file full of content, as a consequence
   * of the bug they are hunting. The AST below the offending comment is
   * therefore deliberately NOT what the engine produces, and nothing
   * downstream may read a clean parse there as evidence the script works.
   *
   * **Only the FIRST hit is reported.** Everything after it is inside the
   * engine's nested comment, so a second one is not a second bug — and the
   * message's whole claim is "everything below here is gone".
   *
   * Resolution is positive-only, per this module's standing rule: engine
   * constants by name, then the script's own `#const`s. The engine-defined set
   * is exactly two names in `random_map.def`, and both are in our data with
   * `constId` 69, so nothing is hardcoded here.
   */
  private checkCommentOpeningWords(): void {
    for (const token of this.tokens) {
      if (!token.isTrivia || token.kind !== "word") continue;
      const constant = this.constantsByName.get(token.text);
      if (constant?.constId === COMMENT_OPEN_ID) {
        this.diagnostics.push(d.commentOpensNestedComment(token, `the game's own ${constant.category} constant`));
        return;
      }
      // A script `#const NAME 69` reaches the same table the engine's names do.
      // `SymbolInfo` carries the value's TOKEN rather than a number, since a
      // `#const` value can be an expression — so the literal case is the one
      // that can be answered here, and it is the one that matters.
      const symbols = this.symbolsByName.get(token.text);
      if (symbols?.some((s) => s.valueToken !== undefined && this.tokens[s.valueToken]?.text === String(COMMENT_OPEN_ID))) {
        this.diagnostics.push(d.commentOpensNestedComment(token, "this script defines it as 69"));
        return;
      }
    }
  }

  /** RMS0301 duplicate definition + RMS0302/RMS0312 redefining an engine name. */
  private checkDefinitions(): void {
    for (const [name, definitions] of this.symbolsByName) {
      const first = definitions[0];

      this.checkOverridesEngineCondition(name, first);
      this.checkShadowedConstant(name, definitions);
    }
    // RMS0301 and RMS0314 live in checkRedefinitions, after the walk. They
    // used to run here, off `conditionalDepth`, which cannot express what the
    // check actually needs — see that method.
  }

  /**
   * RMS0312 — a user definition of one of language.json's predefinedLabels.
   *
   * This is NOT shadowing, and reading it as shadowing was the pass's one
   * outright wrong claim (found by the 2026-07-31 corpus review; spec Sec.8
   * amended). Sec.8's rationale for the shadowing check is "random_map.def
   * defined it first", which is true of game constants and false of these:
   * every one of the 138 labels is a runtime condition — the ten categories
   * are game mode, map size, starting resources, starting age, lobby setting,
   * player count, team count, team size, player-in-team, game version — and
   * the engine defines each one only when it holds. `MAPSIZE_TINY` exists on a
   * tiny map and nowhere else. So `#define EMPIRE_WARS` is not overridden by
   * anything; it switches the condition on, which is exactly why three
   * DE-official maps do it inside `if EW_TESTING`. Telling the author to "pick
   * a different name" would have broken their test harness.
   *
   * Reported on the first definition only — the note is about the name, and
   * repeating it per branch would say the same thing twice.
   */
  private checkOverridesEngineCondition(name: string, first: SymbolInfo): void {
    if (!this.predefinedByName.has(name)) return;
    this.diagnostics.push(d.overridesEngineCondition(this.tokens[first.nameToken]));
  }

  /**
   * RMS0302 — a user `#const` of a name the constants DB says the engine
   * already owns. Positive resolution, so an incomplete DB can only make this
   * check miss, never false-fire.
   *
   * The severity split is the point. The engine keeps its own definition
   * either way, so the *line* is inert either way — but that only costs the
   * author something when the value they wrote differs from the engine's,
   * which is a silent value bug and earns the warning. When the values match
   * (73 of 73 corpus instances, all in copied `if TERRAIN_CONSTANTS`
   * documentation headers) nothing is lost at all, and info is as loud as that
   * deserves.
   */
  private checkShadowedConstant(name: string, definitions: SymbolInfo[]): void {
    const constant = this.constantsByName.get(name);
    if (!constant) return;

    // Sec.6's provenance gate again: quote an ID only when the DB says where
    // it came from. Without a trustworthy engine value there is nothing to
    // compare against, so the mismatch branch can't run and the check falls
    // back to the value-agnostic note.
    const engineValue =
      constant.constId !== undefined && constant.idSource !== undefined && VERIFIED_PROVENANCE.has(constant.idSource)
        ? constant.constId
        : undefined;

    if (engineValue !== undefined) {
      for (const definition of definitions) {
        const written = this.writtenIntegerValue(definition);
        if (written !== undefined && written !== engineValue) {
          this.diagnostics.push(
            d.shadowedConstantValueIgnored(this.tokens[definition.nameToken], engineValue, written),
          );
          return; // one report per name, on the definition that actually differs
        }
      }
    }

    this.diagnostics.push(d.redundantConstantDefinition(this.tokens[definitions[0].nameToken], engineValue));
  }

  /**
   * The literal integer a `#const` assigns, or undefined when there isn't one.
   * `Number()` is not used as the test because it accepts far too much —
   * `Number("")` is 0 and `Number(" 12 ")` is 12 — and because an expression,
   * an `rnd()` or another constant genuinely cannot be compared statically.
   * Anything unresolvable stays silent rather than guessing, per the module's
   * positive-evidence rule.
   */
  private writtenIntegerValue(definition: SymbolInfo): number | undefined {
    if (definition.valueToken === undefined) return undefined;
    const text = this.tokens[definition.valueToken].text;
    return /^-?\d+$/.test(text) ? Number(text) : undefined;
  }

  /** RMS0305 — info, and only for scripts that have sections at all. */
  private checkMissingPlayerSetup(): void {
    const sections = this.result.script.sections;
    if (sections.length === 0) return; // empty or preamble-only: nothing to say
    if (this.sectionNames.has("PLAYER_SETUP")) return;
    this.diagnostics.push(d.missingPlayerSetup(this.tokenSpan(sections[0].header)));
  }

  // ---- traversal --------------------------------------------------------

  private walkItems(items: Item[]): void {
    for (const item of items) this.walkItem(item);
  }

  /**
   * Runs `visit` with extra guards pushed, then restores the stack. Truncating
   * by remembered length rather than popping one per literal keeps the two
   * halves impossible to get out of step — the caller passes a variable number
   * of literals (an elseif inherits every earlier negation) and a mismatched
   * pop would silently corrupt every path recorded afterwards.
   */
  private withGuards(literals: string[], visit: () => void): void {
    const depth = this.guards.length;
    this.guards.push(...literals);
    visit();
    this.guards.length = depth;
  }

  /**
   * RMS0313 — an `elseif` whose condition already appeared earlier in the same
   * chain. The strongest claim this pass makes and the cheapest to compute:
   * every branch of one chain is tested against the same set of defines at the
   * same point in the token stream, so if the condition were true the earlier
   * branch would have taken it. No guard algebra, no reference data, no
   * question about whether a define landed in between.
   *
   * Compared by exact token text because RMS labels are case-sensitive —
   * `if Regicide` and `if REGICIDE` are genuinely different conditions, the
   * same rule RMS0300 relies on.
   *
   * Scoped to ONE chain, deliberately. The same condition tested by a nested
   * `if` inside a branch that already excluded it is also dead, but only if no
   * `#define` of that name ran in between, and that precondition is what
   * CREATION_PLAN 2.6 defers.
   */
  private checkChainReachability(node: IfNode): void {
    const firstUse = new Map<string, number>();
    for (const branch of node.branches) {
      if (branch.condition === undefined) continue; // `else` tests nothing
      const token = this.tokens[branch.condition];
      const earlier = firstUse.get(token.text);
      if (earlier === undefined) {
        firstUse.set(token.text, token.start);
        continue;
      }
      this.diagnostics.push(d.unreachableBranch(token, this.lineOf(earlier)));
    }
  }

  /** Records a `#const` and the execution path it sits on, for RMS0301. */
  private recordConstDefinition(item: DirectiveNode): void {
    const nameToken = item.args[0]?.firstToken;
    if (nameToken === undefined) return;
    const symbol = this.symbolByNameToken.get(nameToken);
    // Only a later #const is worth reporting. Re-#define-ing a flag is
    // idempotent — the flag is already set, nothing is lost. A later #const,
    // by contrast, carries a VALUE that silently never applies, which is the
    // whole point of the guide's first-definition-wins rule.
    if (!symbol || symbol.directiveKind !== "const") return;
    // Space-separated, and the key below is too. Every guard literal is a
    // whitespace-delimited token (or "!" plus one), so a space can never occur
    // inside one and two different stacks can never collide. Joining with ""
    // would make ["AB"] and ["A", "B"] the same path.
    this.constDefinitions.push({ symbol, guards: [...this.guards], path: this.guards.join(" ") });
  }

  /**
   * RMS0301 — a second `#const` of a name on the SAME execution path.
   *
   * "Same path" replaced "both unconditional" in the 2026-07-31 corpus review,
   * and the two differ in both directions. It is broader: two definitions
   * inside one `if` branch both run whenever that branch does, so the second
   * is dead, and the old depth test could not see this because
   * `conditionalDepth` is a COUNT — depth 1 could mean the same branch or two
   * exclusive ones. It is also exactly as narrow where it matters: `if A` and
   * `else` produce different guard stacks, so the legitimate
   * branch-per-value idiom stays silent, which was the 4,856-diagnostic cut
   * that scoped this check originally.
   *
   * Corpus effect: 3 hits to 38, the 35 new ones triaged as real, the largest
   * being a shared template that writes `#const PREDATOR_A` twice per branch
   * where its neighbours write `_A` and `_B`.
   *
   * RMS0314 — the same claim reaching ACROSS paths (CREATION_PLAN 2.6).
   *
   * If an earlier definition's guards are a SUBSET of a later one's, then
   * whenever the later one runs the earlier one already did, so the later
   * value never applies. The empty guard set is a subset of everything, which
   * makes the beginner case fall out for free: a default written above the
   * conditional versions instead of below them.
   *
   * Both live in one method because a definition must draw at most one of
   * them. Same-path wins when both apply — it names the nearer cause, and the
   * subsuming definition is usually the same one the reader would find next.
   */
  private checkRedefinitions(): void {
    // Grouped by name first so the pairwise scan below stays quadratic in the
    // definitions of ONE constant (38 at corpus worst) rather than in every
    // #const in the file (four figures in the larger maps).
    const byName = new Map<string, GuardedDefinition[]>();
    for (const definition of this.constDefinitions) {
      const list = byName.get(definition.symbol.name);
      if (list) list.push(definition);
      else byName.set(definition.symbol.name, [definition]);
    }

    for (const definitions of byName.values()) {
      // Walk order is token order for everything the AST reaches, but sort
      // rather than rely on it: "earlier" is the whole claim, and a future
      // reordering of walkItem must not be able to invert it silently.
      definitions.sort((a, b) => a.symbol.nameToken - b.symbol.nameToken);

      for (let i = 1; i < definitions.length; i++) {
        const later = definitions[i];
        // A guard set holding both X and !X describes a branch that cannot
        // run at all. RMS0313 reports that once, on the branch; repeating it
        // per statement inside would be one fact counted many times — which
        // is exactly how this analysis first surfaced nomad.rms's dead biome,
        // as 15 redefinition hits that were really one unreachable branch.
        if (this.isContradictory(later.guards)) continue;

        let samePath: GuardedDefinition | undefined;
        let subsuming: GuardedDefinition | undefined;
        for (let j = 0; j < i; j++) {
          const earlier = definitions[j];
          // subsumes() gates BOTH codes, not just RMS0314. Equal guard stacks
          // are the subset case where the two sets happen to match, and they
          // need the monotonicity test just as much: two separate `if A`
          // blocks produce the same stack, so a `#define A` landing between
          // them makes the first block's definition never happen and the
          // second one genuinely live. Same-branch definitions are unaffected
          // — their guard was evaluated once, before both.
          if (!this.subsumes(earlier, later)) continue;
          if (earlier.path === later.path) samePath ??= earlier;
          else subsuming ??= earlier;
        }

        if (samePath) {
          this.diagnostics.push(
            d.duplicateDefinition(
              this.tokens[later.symbol.nameToken],
              this.lineOf(this.tokens[samePath.symbol.nameToken].start),
            ),
          );
        } else if (subsuming) {
          this.diagnostics.push(
            d.subsumedDefinition(
              this.tokens[later.symbol.nameToken],
              this.lineOf(this.tokens[subsuming.symbol.nameToken].start),
              subsuming.guards.filter((g) => !g.startsWith("!") && !g.startsWith(RANDOM_BRANCH_PREFIX)),
            ),
          );
        }
      }
    }
  }

  /** Both `X` and `!X` present: the branch is unsatisfiable (see RMS0313). */
  private isContradictory(guards: readonly string[]): boolean {
    return guards.some((g) => !g.startsWith("!") && guards.includes(`!${g}`));
  }

  /**
   * Does `earlier` run in every world where `later` does?
   *
   * The subset test alone is not enough, and the gap is the reason
   * CREATION_PLAN 2.6 called this out as the risky half. Guards are evaluated
   * where they are WRITTEN, not where we compare them, so a literal holding at
   * the later site need not have held at the earlier one:
   *
   *     if A         <- false here, so no definition happens
   *       #const T 1
   *     endif
   *     #define A    <- A becomes true
   *     if A         <- true now
   *       #const T 2 <- genuinely live; reporting it would be wrong
   *     endif
   *
   * NEGATED literals are safe without any check: definitions only ever
   * accumulate in RMS (`#undefine` is documented non-functional, spec Sec.7),
   * so a name undefined at the later site was undefined at the earlier one
   * too. Opaque `start_random` literals are safe for the same reason — no
   * name, nothing to redefine. Only a POSITIVE condition can flip, so only
   * those are checked, and any definition of one landing between the two
   * sites makes the claim unsound and silences it.
   */
  private subsumes(earlier: GuardedDefinition, later: GuardedDefinition): boolean {
    if (!earlier.guards.every((g) => later.guards.includes(g))) return false;

    for (const literal of earlier.guards) {
      if (literal.startsWith("!") || literal.startsWith(RANDOM_BRANCH_PREFIX)) continue;
      const definitions = this.symbolsByName.get(literal);
      if (!definitions) continue; // engine label or never defined here: stable
      const flipped = definitions.some(
        (s) => s.nameToken > earlier.symbol.nameToken && s.nameToken < later.symbol.nameToken,
      );
      if (flipped) return false;
    }
    return true;
  }

  private walkItem(item: Item): void {
    // No `default:` on purpose. Item is a discriminated union, so an
    // unhandled kind is a compile error here rather than a silent no-op —
    // add a node type to types.ts and the compiler points at this switch.
    switch (item.kind) {
      case "command":
        this.checkDeprecated(item);
        this.checkWrongSection(item);
        this.checkArgs(item.args);
        if (item.block) {
          this.checkBlockContents(item.block);
          this.walkItems(item.block.items);
        }
        break;
      case "attribute":
        this.checkNonFunctional(item);
        this.checkRequiredSection(item);
        this.checkArgs(item.args);
        break;
      case "directive":
        this.checkNonFunctional(item);
        this.recordConstDefinition(item);
        // args[0] is skipped deliberately: for #const/#define/#undefine it is
        // the name being DEFINED, not a reference to resolve (flagging it
        // would report every definition as undefined), and for the #include
        // pair it is a file path.
        this.checkArgs(item.args.slice(1));
        break;
      case "if": {
        this.checkChainReachability(item);
        // An elseif branch runs only when every earlier condition in its chain
        // was false, so the negations accumulate down the chain. `else` adds
        // no positive literal of its own, just the accumulated negations.
        const negated: string[] = [];
        for (const branch of item.branches) {
          this.checkCondition(branch);
          const condition = branch.condition === undefined ? undefined : this.tokens[branch.condition].text;
          this.withGuards([...negated, ...(condition === undefined ? [] : [condition])], () =>
            this.walkItems(branch.items),
          );
          if (condition !== undefined) negated.push(`!${condition}`);
        }
        break;
      }
      case "random": {
        this.checkChances(item);
        this.walkItems(item.preamble);
        // Each branch gets an opaque literal rather than a condition name:
        // two branches of one start_random are mutually exclusive, but there
        // is no name to reason about. Two definitions in the SAME branch still
        // share a path, which is all the redefinition checks need. See
        // RANDOM_BRANCH_PREFIX for why the literal is namespaced.
        const randomId = this.randomCounter++;
        item.branches.forEach((branch, index) => {
          if (branch.chance) this.checkArg(branch.chance);
          this.withGuards([`${RANDOM_BRANCH_PREFIX}${randomId}#${index}`], () => this.walkItems(branch.items));
        });
        break;
      }
      case "orphanBlock":
        this.checkBlockContents(item.block);
        this.walkItems(item.block.items);
        break;
      case "raw":
        // Opaque by construction (spec Sec.4: a RawNode has no children).
        // The parser already said what it needed to via RMS0110/RMS0107.
        //
        // It does have one consequence for this pass: a degraded region may
        // have eaten a section header, so nothing after it in this section can
        // be trusted to be in the section it appears to be in.
        this.sectionAttributionLost = true;
        break;
    }
  }

  // ---- per-item checks --------------------------------------------------

  /** RMS0309 — read off the def, so the deprecation list lives in the data. */
  private checkDeprecated(item: CommandNode): void {
    if (!item.def?.deprecated) return;
    this.diagnostics.push(d.deprecatedCommand(this.tokens[item.name], item.def.deprecated));
  }

  /**
   * RMS0304 — a command the engine will not run from where it is written.
   *
   * **Driven by `CommandDef.sectionLocked`, never by `CommandDef.section`, and
   * that distinction is the entire check.** `section` records where the guide
   * DOCUMENTS a command. Enforcing it warned 53 times on the corpus and 52 of
   * those were `effect_amount` used outside <PLAYER_SETUP> by shipped, working
   * maps — so at least one command is provably not locked the way its `section`
   * implies, and a blanket rule rebuilds the false-positive class BUG-002 and
   * BUG-005 already cost three rounds of work. `sectionLocked` is set only
   * where the engine has been measured: two commands today, `create_terrain`
   * (RMSTEST_33a) and `create_object` (RMSTEST_33b), each of which produced
   * NOTHING from the wrong section across three runs while the rest of the
   * script ran normally.
   *
   * **Expect zero hits on this corpus, and do not read that as the check
   * failing.** These are expert-written and DE-official maps; nobody ships a
   * `create_object` in <TERRAIN_GENERATION>. Same situation as RMS0314, and the
   * same response: the unit tests carry worked examples in both directions,
   * because a corpus count of zero says nothing about whether a check can fire.
   *
   * Three silences, each a refusal to claim past the measurement:
   * - the preamble (`currentSection === undefined`) — measured is wrong
   *   section, not no section;
   * - an unrecognised section name (`known === false`) — what the engine does
   *   with a header it does not know is not something we have measured;
   * - anything after a degraded region in the same section — see
   *   `sectionAttributionLost`.
   */
  private checkWrongSection(item: CommandNode): void {
    if (this.sectionAttributionLost) return;
    const section = this.currentSection;
    if (section === undefined || !section.known) return;
    if (item.def?.sectionLocked !== true) return;
    if (section.name === item.def.section) return;
    this.diagnostics.push(d.wrongSection(this.tokens[item.name], item.def.section, section.name));
  }

  /** RMS0311 — the one error. Data-driven via AttributeDef.requiresSection. */
  private checkRequiredSection(item: AttributeNode): void {
    const required = item.def?.requiresSection;
    if (!required) return;
    if (this.sectionNames.has(required)) return;
    const key = `${this.tokens[item.name].text}:${required}`;
    if (this.reportedMissingSections.has(key)) return;
    this.reportedMissingSections.add(key);
    this.diagnostics.push(d.missingRequiredSection(this.tokens[item.name], required));
  }

  /**
   * RMS0310 — real engine words with no behavior behind them, from the guide's
   * Non-Functional Syntax appendix.
   *
   * Two shapes, one check. The directives (`#undefine`, `#include`) correspond
   * to nothing you should write instead, so the message ends at "deleting it
   * changes nothing". The attributes (`min_distance`, `max_distance`,
   * `set_position`, `percent_of_land`) each shadow a name that works, and
   * naming it is the entire reason they carry an entry at all: without one
   * they resolved to nothing and drew a bare unknown-name warning, which is
   * both wrong (the engine does carry the word) and unhelpful.
   */
  private checkNonFunctional(item: DirectiveNode | AttributeNode): void {
    const def = item.def;
    if (!def?.nonFunctional) return;
    const token = item.kind === "directive" ? this.tokens[item.hash] : this.tokens[item.name];
    this.diagnostics.push(d.nonFunctionalSyntax(token, "replacedBy" in def ? def.replacedBy : undefined));
  }

  /**
   * RMS0300 on if/elseif condition labels — the one place the vocabulary is
   * genuinely closed (user #defines + the 138 predefinedLabels), so "I can't
   * find this" is real evidence rather than a gap in our data.
   */
  private checkCondition(branch: IfBranch): void {
    if (branch.condition === undefined) return; // `else`, or a missing condition
    const index = branch.condition;
    const token = this.tokens[index];
    if (token.kind === "number") return; // a literal, not a name

    const definitions = this.symbolsByName.get(token.text);
    if (definitions) {
      const above = definitions.filter((s) => s.nameToken < index);
      if (above.length === 0) {
        this.diagnostics.push(
          d.usedBeforeDefinition(token, this.lineOf(this.tokens[definitions[0].nameToken].start), this.includesPresent),
        );
      }
      // Sec.8 also asks for an info note when the only definitions sit inside
      // if/start_random branches. NOT BUILT, on measurement: it fired 6,404
      // times across the 57-map corpus (2,349 in AK_Vanguard alone), because
      // "set a flag in a random branch, read it later" is the core RMS
      // control-flow technique rather than an edge case. It also cannot
      // distinguish a typo from a branch that correctly didn't run, so every
      // one of those 6,404 was noise around zero signal.
      return;
    }

    if (this.predefinedByName.has(token.text)) return;
    if (this.constantsByName.has(token.text)) return;
    if (this.disabledDefinitions.has(token.text)) return; // switched off on purpose

    // Everything above is a POSITIVE resolution. Reaching here only means we
    // couldn't find the name — which, per this module's header rule, is not
    // by itself evidence of anything. The corpus proved why: DE-official maps
    // branch on MAPSIZE_ABOVE_GIANT, THEME_AFRICAN, NOMAD_START and a dozen
    // more labels that appear nowhere in the archived guide our 138
    // predefinedLabels came from. They are real engine labels newer than our
    // data, and "never defined" would have been a false warning 299 times.
    //
    // So the claim gets inverted: report only when there IS positive evidence
    // of a typo — a name within edit distance 2 of something this file or the
    // engine actually defines. An unrecognised name with no near neighbour is
    // presumed to be a label we simply don't know about yet, and stays silent.
    const suggestion = this.nearestKnownName(token.text);
    if (!suggestion) return;
    this.diagnostics.push(d.undefinedName(token, suggestion, this.includesPresent));
  }

  /**
   * Nearest defined name that is off by at most ONE character, comparing
   * case-insensitively so a wrong-case label (`Regicide` for `REGICIDE`, which
   * RMS really does treat as a different name) counts as an exact hit.
   *
   * Deliberately tighter than the parser's RMS0200 did-you-mean, which allows
   * distance 2. Command names are a fixed vocabulary of 130 well-spaced words;
   * condition labels are invented per file and come in dense families, so at
   * distance 2 a neighbour is always findable and means nothing — the corpus
   * produced "CONFIG_RIVER_D1 — did you mean CONFIG_RIVER_A4?", which is a
   * different river, not a misspelling. One character off is the signature of
   * an actual slip.
   */
  private nearestKnownName(name: string): string | undefined {
    const lower = name.toLowerCase();
    let best: string | undefined;
    let bestDistance = 2;
    const consider = (candidate: string): void => {
      // One character off on a 3-letter name is a third of the name.
      if (candidate.length < 4) return;
      if (Math.abs(candidate.length - lower.length) > 1) return;
      const distance = editDistanceCapped(lower, candidate.toLowerCase(), 1);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate;
      }
    };
    for (const symbolName of this.symbolsByName.keys()) consider(symbolName);
    for (const labelName of this.predefinedByName.keys()) consider(labelName);
    return best;
  }

  private checkArgs(args: ArgNode[]): void {
    for (const arg of args) this.checkArg(arg);
  }

  private checkArg(arg: ArgNode): void {
    this.checkRndRange(arg);

    const type = arg.def?.type;
    if (!type) return;
    // Numeric slots belong to the parser (Sec.6's amendment, RMS0202 via
    // isDefinedSymbol). Re-checking them here would double-report every
    // unresolved constant in the file.
    if (NUMERIC_ARGUMENT_TYPES.has(type)) return;
    if (type === "string") return; // file paths, not names

    const expectedCategory = CONSTANT_SLOT_CATEGORY[type];

    if (typeof arg.value === "number") {
      if (expectedCategory) this.checkBareNumericId(arg, expectedCategory);
      return;
    }
    // rnd()/expression values carry no name to resolve.
    if (typeof arg.value !== "string") return;

    const token = this.tokens[arg.firstToken];
    if (expectedCategory) this.checkCrossCategory(token, expectedCategory, arg);
    this.checkUseBeforeDefinition(token, arg.firstToken);
  }

  /** RMS0308 — an rnd() that can't actually vary, split by which kind it is. */
  private checkRndRange(arg: ArgNode): void {
    if (typeof arg.value !== "object" || !("rnd" in arg.value)) return;
    const [min, max] = arg.value.rnd;
    if (max > min) return;
    this.diagnostics.push(d.chanceLint(max === min ? "constantRange" : "reversedRange", arg.span));
  }

  /** RMS0204 — only when we can actually name the ID. */
  private checkBareNumericId(arg: ArgNode, category: string): void {
    const constant = this.constantsByCategoryAndId.get(`${category}:${arg.value as number}`);
    // Not in the DB means we have nothing useful to say — "use a named
    // constant" without being able to name it is worse than silence.
    if (!constant || !arg.def) return;
    const named = constant.idSource !== undefined && VERIFIED_PROVENANCE.has(constant.idSource);
    this.diagnostics.push(d.bareNumericId(this.tokens[arg.firstToken], arg.def, named ? constant.rmsConstant : undefined));
  }

  /** RMS0205 — fires on positive evidence only: the name IS in the DB, in the wrong category. */
  private checkCrossCategory(token: Token, expectedCategory: string, arg: ArgNode): void {
    const constant = this.constantsByName.get(token.text);
    if (!constant || !arg.def) return;
    if (constant.category === expectedCategory) return;
    this.diagnostics.push(d.crossCategoryConstant(token, constant.category, expectedCategory, arg.def));
  }

  /**
   * RMS0303. Positive evidence only, which is why this one is safe in constant
   * slots where RMS0300 is not: we found the #const, it's just below the use.
   * An incomplete constants DB cannot produce a false positive here.
   */
  private checkUseBeforeDefinition(token: Token, tokenIndex: number): void {
    const definitions = this.symbolsByName.get(token.text);
    if (!definitions) return;
    if (definitions.some((s) => s.nameToken < tokenIndex)) return;
    this.diagnostics.push(
      d.usedBeforeDefinition(token, this.lineOf(this.tokens[definitions[0].nameToken].start), this.includesPresent),
    );
  }

  /**
   * RMS0306 duplicate attribute + RMS0307 mutual exclusion, over a block's
   * DIRECT items only.
   *
   * Not descending into if/start_random branches inside the block is the whole
   * correctness argument: branches are mutually exclusive at runtime, so
   * `if A number_of_objects 5 else number_of_objects 3 endif` sets the
   * attribute exactly once however it's read. Counting across branches would
   * false-warn on the most ordinary conditional in RMS.
   */
  private checkBlockContents(block: BlockNode): void {
    const firstByName = new Map<string, AttributeNode>();

    for (const item of block.items) {
      if (item.kind !== "attribute" || !item.def) continue; // unknown names already drew RMS0200
      const name = this.tokens[item.name].text;
      const previous = firstByName.get(name);
      if (!previous) {
        firstByName.set(name, item);
        continue;
      }
      // Cumulative attributes are a list, not a last-one-wins slot. Read the
      // flag, never a name list (spec Sec.8, pinned) — five carry it today,
      // and without it this check false-warns on every connection block.
      if (item.def.repeatable === true) continue;
      this.diagnostics.push(
        d.duplicateAttribute(this.tokens[item.name], this.lineOf(this.tokens[previous.name].start)),
      );
    }

    // RMS0315 — a guide "Requires:" partner that is nowhere in this block.
    //
    // **The search is block-WIDE, unlike the two checks above, and the two
    // scopes are answering opposite questions.** RMS0306/RMS0307 ask "did the
    // author set this twice", where descending into branches would false-warn
    // on the most ordinary conditional in RMS (branches are mutually exclusive
    // at runtime, so `if A x else x endif` sets `x` once). This one asks "is
    // the partner anywhere at all", and a partner written inside a branch is a
    // partner. Reporting it would be exactly the false-positive class BUG-002
    // and BUG-005 cost three rounds each.
    //
    // Erring toward the false NEGATIVE is deliberate: a branch that supplies
    // the partner only sometimes is still a real bug on the other path, and
    // this check will stay quiet about it. Saying so is the honest version of
    // a rule whose evidence is an absence.
    for (const [, node] of firstByName) {
      const options = node.def?.requiresOneOf;
      if (!options || options.length === 0) continue;
      if (options.some((partner) => this.blockDeclaresAttribute(block, partner))) continue;
      this.diagnostics.push(d.missingRequiredPartner(this.tokens[node.name], options, node.def?.requiresNote));
    }

    const reportedPairs = new Set<string>();
    for (const [name, node] of firstByName) {
      for (const otherName of node.def?.mutexWith ?? []) {
        const other = firstByName.get(otherName);
        if (!other) continue;
        // mutexWith is symmetric in the data (both entries name each other),
        // so without this the pair reports twice.
        const key = [name, otherName].sort().join("|");
        if (reportedPairs.has(key)) continue;
        reportedPairs.add(key);
        const later = node.firstToken > other.firstToken ? node : other;
        const earlier = later === node ? other : node;
        // Either side of the pair may carry the note; both do where it exists.
        const note = later.def?.mutexNote ?? earlier.def?.mutexNote;
        this.diagnostics.push(
          d.mutuallyExclusive(
            this.tokens[later.name],
            this.tokens[earlier.name].text,
            this.lineOf(this.tokens[earlier.name].start),
            note,
          ),
        );
      }
    }
  }

  /**
   * Is `name` written anywhere inside this block, at any branch depth?
   *
   * Matches on the TOKEN TEXT rather than on `item.def`, so an attribute the
   * language data has never heard of still counts as present. That is the
   * positive-resolver rule pointed at its own consequence: this function's
   * answer is used to SUPPRESS a warning, so an unrecognised name must not be
   * read as an absent one.
   */
  private blockDeclaresAttribute(block: BlockNode, name: string): boolean {
    const search = (items: readonly Item[]): boolean =>
      items.some((item) => {
        if (item.kind === "attribute") return this.tokens[item.name].text === name;
        if (item.kind === "if") return item.branches.some((b) => search(b.items));
        if (item.kind === "random") return search(item.preamble) || item.branches.some((b) => search(b.items));
        return false;
      });
    return search(block.items);
  }

  /**
   * RMS0308 — the percent_chance family (spec Sec.8, all four guide-sourced).
   *
   * Both cumulative thresholds are 99, not 100, and the guide is explicit about
   * why (guide:3006-3007): "If the total percentages add up to less than 99%,
   * there is a chance that none of them get chosen. If the total exceeds 99%,
   * only the first 99% will have a chance of occurring" — plus guide:3010,
   * "the 100th percent is never chosen". So a block totalling exactly 99 has
   * full coverage and no gap, and a branch that starts at cumulative 99 is
   * already past the reachable range.
   *
   * This shipped as 100 twice because Sec.8 used both numbers in one sentence.
   * On the corpus the difference is one false info (a 33/33/33 block) and one
   * genuinely dead branch that went unreported (45/54/1).
   */
  private checkChances(node: RandomNode): void {
    if (node.branches.length === 0) return;

    let cumulative = 0;
    let evaluable = true;

    for (let i = 0; i < node.branches.length; i++) {
      const branch = node.branches[i];
      const value = typeof branch.chance?.value === "number" ? branch.chance.value : undefined;

      if (value === undefined) {
        // An rnd() or expression chance can't be reasoned about statically.
        // Stop the cumulative arithmetic rather than guessing — a wrong
        // "unreachable" claim is worse than no claim.
        evaluable = false;
        continue;
      }

      // The engine runs a first branch with percent_chance 0 anyway. Only the
      // first: later zero-chance branches are simply never selected, which is
      // unremarkable.
      if (i === 0 && value === 0) {
        this.diagnostics.push(d.chanceLint("zeroFirst", this.tokenSpan(branch.chanceKeyword)));
      }
      if (evaluable && cumulative >= 99) {
        this.diagnostics.push(d.chanceLint("unreachable", this.tokenSpan(branch.chanceKeyword)));
      }
      cumulative += value;
    }

    if (evaluable && cumulative < 99) {
      this.diagnostics.push(d.chanceLint("under99", this.tokenSpan(node.start)));
    }
  }

  private tokenSpan(tokenIndex: number): { start: number; end: number } {
    const token = this.tokens[tokenIndex];
    return { start: token.start, end: token.end };
  }
}

/**
 * Semantic checks over a parsed script (docs/parser-design.md Sec.8). Pure —
 * no I/O, never throws — and additive: the returned diagnostics are meant to be
 * concatenated onto `result.diagnostics`, which holds the lexical and syntactic
 * ones. Nothing here re-reports anything the parser already said.
 *
 * The spec's optional third `opts` parameter is omitted until it has something
 * to carry: its only documented member, `ValidateOptions.resolvedIncludes`
 * (Sec.7), is explicitly out of scope for v1, and a parameter that silently
 * does nothing is worse than one that isn't there yet.
 */
export function validate(result: ParseResult, refDb: ValidateReferenceDb): Diagnostic[] {
  const validator = new Validator(result, refDb);
  validator.run();
  return validator.diagnostics;
}
