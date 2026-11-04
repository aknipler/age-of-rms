// Stage 0: script instantiation, docs/preview-design.md Sec.3. PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// The parser deliberately never evaluates conditionals, randoms, or math
// (parser-design Sec.1 non-goals; Sec.2.2 assigns that semantics to "the
// preview generator"). This file is that pass: it walks the AST once,
// mirroring the engine's token-filter model, pick a branch, roll a random,
// resolve a constant, fold duplicate attributes, and produces a flat,
// per-section list of concrete commands with every value as final as S0 can
// make it. Every later stage (lands.ts onward) reads InstantiatedScript, not
// the AST.
//
// One walk, not two: `if`/`start_random` branch selection, `#define`/`#const`
// symbol definitions, and the S0 draws all happen in the SAME depth-first
// traversal, in the order the file is written (rev 9), so a symbol defined
// only inside a taken branch resolves correctly for everything after it, and
// a symbol inside an UNTAKEN branch never exists, exactly as the engine would
// see it. The commands are still collected per section, and the stages still
// run in canonical section order (Sec.3 rule 11).
//
// THE DRAWS ARE THE GAME'S, IN THE GAME'S ORDER (Sec.3 rules 3 and 5, rev 11).
// The game reads the whole script before player setup, and every rnd() it
// reads takes a draw from the one stream the land stage then continues. That
// includes an rnd() in a branch that is not taken, of an `if` or of a
// start_random block. A block rolls when it is reached, before anything
// inside it, and a block inside a dead branch is never rolled. `predrawItems`
// below reads dead text that way.

import type {
  ArgNode,
  AttributeNode,
  CommandNode,
  DirectiveNode,
  IfBranch,
  IfNode,
  Item,
  ParseOptions,
  ParseResult,
  RandomBranch,
  RandomNode,
  Span,
} from "../../parser/types";
import {
  NUMERIC_ARGUMENT_TYPES,
  type LanguageIndex,
} from "../../parser/language";
import {
  canonicaliseTeams,
  teamLabels,
} from "../../generationSettings/teamModel";
import { parseRms } from "../../parser/parser";
import { createDeStream } from "./deRandom";
import { filterScript } from "./tokenFilter";
import {
  includePathsIn,
  mapSpanToSource,
  type IncludeFiles,
  type Insertion,
} from "./includes";
import { evaluateExpressionTokens, roundForIntegerSlot } from "./mathEval";
import { resolveMapDim } from "./mapDimensions";
import type {
  InstantiatedArg,
  InstantiatedAttribute,
  InstantiatedCommand,
  InstantiatedScript,
  InstantiatedValue,
  PlayerSetupState,
  PreviewSettings,
  SimulationNote,
} from "./types";

// Absolute last resort only: every MAP_SIZES entry the settings pane can
// offer has a matching predefinedLabels row with `dimensions`, and
// `validate:reference` enforces that join, this constant exists so a
// corrupted/emptied data file degrades to *a* map rather than to no map at
// all (Sec.3 rule 1's own "label data is missing" guard covers the same
// failure and fires alongside this).
const FALLBACK_DIM = 200;

// Sec.3 rule 11's parenthetical names these five PLAYER_SETUP commands
// explicitly as stream state S0 folds into the environment, and rule 7/8
// name behavior_version/override_map_size the same way, these are pinned
// engine mechanics the spec itself calls out by name, not a data-driven
// vocabulary category (contrast CommandDef.repeatable, which IS read from
// language.json rather than hardcoded here).
const LAND_COMMAND_NAMES = new Set(["create_land", "create_player_lands"]);

const NAMED_RND = /^rnd\((-?[^,()\s]+),(-?[^,()\s]+)\)$/;
const INTEGER = /^-?\d+$/;

/**
 * `rnd(a,b)` with a name as a bound, which the lexer leaves as a plain word.
 * The game reads the name as 0 and still spends the draw, so
 * `rnd(-NAME,NAME)` is always 0 (Sec.3 rule 5, rev 11, CJ n1 and Bulls_Eyes,
 * where reading the constant's value fails). Returns the bounds, or
 * undefined for any other word.
 */
function namedRnd(text: string): [number, number] | undefined {
  const m = NAMED_RND.exec(text);
  if (!m || (INTEGER.test(m[1]) && INTEGER.test(m[2]))) return undefined;
  const bound = (b: string): number => (INTEGER.test(b) ? Number(b) : 0);
  return [bound(m[1]), bound(m[2])];
}

/**
 * Sec.3: AST -> InstantiatedScript. `masterSeed` is the game seed. It seeds
 * the game's own stream (deRandom.ts), every parse-time draw comes off it in
 * reading order, and the stream's position afterwards goes to S1 as
 * `landStream` (Sec.8, rev 9). `includeFiles` holds the game's include files
 * from the user's install, undefined when no install was found (includes.ts).
 *
 * `parseOptions` is what the caller's own first parse was given, which this
 * function repeats on the parses it makes itself, the filtered text and the
 * include files. Without it a script that goes through the token filter is
 * parsed a second time with no `commentOpenAliases`. A comment holding a word
 * valued 69, such as SHORE_FISH, ran to the end of the file in the first parse
 * and closes at its own marker in the second, so the preview draws text the
 * game never reads (docs/token-alias-design.md Sec.5, B2). A sixth optional parameter is safe
 * here because nothing passes this function to `map` or `forEach` by name,
 * which would fill it with the array index.
 */
export function instantiateScript(
  scriptParse: ParseResult,
  refDb: LanguageIndex,
  settings: PreviewSettings,
  masterSeed: number,
  includeFiles?: IncludeFiles,
  parseOptions?: ParseOptions,
): InstantiatedScript {
  let parse = scriptParse;
  const notes: SimulationNote[] = [];
  const seenNoteKeys = new Set<string>();
  const addNote = (n: SimulationNote): void => {
    if (seenNoteKeys.has(n.key)) return;
    seenNoteKeys.add(n.key);
    notes.push(n);
  };

  // -------------------------------------------------------------------
  // Rule 1: the label environment.
  // -------------------------------------------------------------------
  const predefinedLabels = refDb.data.predefinedLabels ?? [];
  if (predefinedLabels.length === 0) {
    // The mandated regression backstop (Sec.3.1): never invent a label list.
    addNote({
      key: "labels",
      prominence: "banner",
      stage: "S0",
      text: "Label data is missing, so every if/elseif condition is being evaluated as undefined — the preview may be branching the wrong way.",
    });
  }

  const env = new Set<string>();
  /** A label from predefinedLabels, never one constructed and trusted. */
  const defineKnown = (name: string): void => {
    if (predefinedLabels.some((l) => l.name === name)) env.add(name);
  };
  const editor = settings.lobby === "scenarioEditor";
  for (const label of predefinedLabels) {
    if (label.category === "mapSize" && label.mapSize === settings.mapSize)
      env.add(label.name);
  }
  env.add(`${settings.playerCount}_PLAYER_GAME`);
  env.add("DE_AVAILABLE");
  env.add("DE_GAME_AGE2");
  if (editor) {
    // The scenario editor's own defaults, measured (Sec.3 rule 1, rev 11,
    // round CG's c7). It defines no game mode, so not RANDOM_MAP, and it
    // defines the standard start and resources and AI_PLAYERS.
    for (const name of ["DARK_AGE_START", "DEFAULT_RESOURCES", "AI_PLAYERS"])
      defineKnown(name);
  } else {
    env.add("RANDOM_MAP"); // standard random-map game mode (rule 1)
    // Deliberately NOT set: UP_*, DE_GAME_ROME, every other gameMode
    // (REGICIDE, EMPIRE_WARS, ...), lobbySetting except TEAM_POSITIONS
    // below, startingResources and startingAge. None of these are derivable
    // from PreviewSettings, so they stay undefined.
  }

  const canonicalTeams = canonicaliseTeams(
    settings.teams,
    settings.playerCount,
  );
  for (const label of teamLabels(canonicalTeams)) {
    // The editor leaves the size of team 0, the players without a team,
    // undefined (c7: no TEAM0_SIZE2 with two players and no teams).
    if (editor && label.startsWith("TEAM0_SIZE")) continue;
    env.add(label);
  }

  // The lobby's Team Positions box defines TEAM_POSITIONS. The editor's
  // ticked box defines FIXED_POSITIONS as well (c7). Whether a game lobby's
  // box does is not measured (preview-design Sec.15 item 55), so the game
  // lobby leaves it undefined.
  const teamPositions = settings.teamPositions !== false;
  if (teamPositions) {
    defineKnown("TEAM_POSITIONS");
    if (editor) defineKnown("FIXED_POSITIONS");
  }

  const lobbyDim =
    resolveMapDim(settings.mapSize, refDb.data.predefinedLabels) ??
    FALLBACK_DIM;

  // -------------------------------------------------------------------
  // Mutable stream state (rules 4, 7, 8, 11) and the game's stream (Sec.8).
  // -------------------------------------------------------------------
  const symbols = new Map<string, number | undefined>(); // presence = "defined" (rule 4)
  const stream = createDeStream(masterSeed);
  // A conditional that spans a section header leaves the parser a raw
  // region (RMS0110), which the walk below cannot read. The game's token
  // filter can, so such a script is filtered first and the walk reads the
  // result, where every branch is decided and every rnd() is a number
  // (tokenFilter.ts). The filter spends the draws, so the walk takes the
  // attribute draws from it rather than from the stream.
  //
  // A script that includes game files goes through the same filter when
  // the files were found, since the filter is what reads them in, live
  // branches only (includes.ts). The walk then reads the expanded text, and
  // every span it records is mapped back to the author's text at the end.
  let attributeDraws: Map<number, number> | undefined;
  let insertions: Insertion[] = [];
  const hasIncludes =
    includeFiles !== undefined && includePathsIn(parse).length > 0;
  if (parse.diagnostics.some((d) => d.code === "RMS0110") || hasIncludes) {
    const filtered = filterScript(
      parse,
      (name) => env.has(name),
      refDb.controlKeywords,
      stream,
      includeFiles === undefined
        ? undefined
        : {
            read: (key) => includeFiles.get(key),
            tokens: (text) => parseRms(text, refDb.data, parseOptions).tokens,
          },
    );
    parse = parseRms(filtered.text, refDb.data, parseOptions);
    attributeDraws = filtered.attributeDraws;
    insertions = filtered.insertions;
    if (filtered.missingIncludes.length > 0) {
      const names = [...new Set(filtered.missingIncludes)].join(", ");
      addNote({
        key: "includes",
        prominence: "banner",
        stage: "S0",
        text: `This map includes game files the preview could not read (${names}), so it may not match the game.`,
      });
    }
  }
  // An rnd() is drawn once, where the game reads it, and keyed by its token
  // so the walk that later resolves it reads that same draw. A start_random
  // roll is drawn once, after everything inside its block.
  const rndByToken = new Map<number, number>();
  const rollByNode = new Map<RandomNode, number>();
  let behaviorVersion: 0 | 1 = 0;
  let overrideDim = lobbyDim;
  let landCommandSeen = false;

  const playerSetup: PlayerSetupState = {
    directPlacement: false,
    randomPlacement: false,
    groupedByTeam: false,
    nomadResources: false,
  };

  /** BUG-015: name-to-name `#const`s, left unresolved for the caller's domain to chase. */
  const aliases = new Map<string, string>();
  const objectGroups = new Map<string, InstantiatedCommand>();
  const actorAreas = new Map<number, InstantiatedCommand[]>();
  const sections = new Map<string, InstantiatedCommand[]>();

  const isDefined = (name: string): boolean =>
    env.has(name) || symbols.has(name);
  const tokenText = (idx: number): string => parse.tokens[idx].text;

  /** `line N: first line of the span, cut at 50 characters`. */
  function snippetFor(span: Span): string {
    // lineOffsets is sorted, so a binary search finds the line.
    const offsets = parse.lineOffsets;
    let lo = 0;
    let hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= span.start) lo = mid;
      else hi = mid - 1;
    }
    const firstLine = parse.source
      .slice(span.start, Math.min(span.end, span.start + 200))
      .split(/\r?\n/, 1)[0]
      .trim();
    const cut =
      firstLine.length > 50 ? `${firstLine.slice(0, 50)}...` : firstLine;
    return `line ${lo + 1}: ${cut}`;
  }

  function unsimulatedNote(span: Span): SimulationNote {
    return {
      snippet: snippetFor(span),
      key: `unsimulated:${span.start}-${span.end}`,
      prominence: "drawer",
      stage: "S0",
      span,
      text: "This part of the script isn't simulated in the preview.",
    };
  }

  // -------------------------------------------------------------------
  // Rules 5, 6: argument resolution (rnd, math expressions, symbol lookup).
  // -------------------------------------------------------------------
  // integer/percent/flag are Sec.6's "numeric slots". otherConstant is
  // #const's own value slot and the id slot of a few commands (assign_to's
  // target, effect_amount's type), where a string may be "another
  // constant". All of them get the same symbol-table attempt.
  // terrainConstant/objectConstant do NOT: those names resolve against
  // game-constants.json elsewhere (CREATION_PLAN A.2's alias table is the
  // unbuilt feature that would extend this to them).
  function isNumericSlot(node: ArgNode): boolean {
    const type = node.def?.type;
    return (
      type !== undefined &&
      (NUMERIC_ARGUMENT_TYPES.has(type) || type === "otherConstant")
    );
  }

  /** An argument's value before any slot rounding. Only `#const` keeps it as is. */
  function resolveUnrounded(node: ArgNode): InstantiatedValue {
    const raw = node.value;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string") {
      const named = namedRnd(raw);
      if (named) return drawRnd(node.firstToken, named[0], named[1]);
      return isNumericSlot(node) && symbols.has(raw) ? symbols.get(raw) : raw;
    }
    if ("rnd" in raw) return drawRnd(node.firstToken, raw.rnd[0], raw.rnd[1]);
    // {expr}: rule 6, parser-design Sec.2.2 exactly.
    const texts = raw.expr.tokens.map(tokenText);
    return evaluateExpressionTokens(texts, (name) => symbols.get(name));
  }

  function resolveArg(node: ArgNode): InstantiatedArg {
    const value = resolveUnrounded(node);
    if (
      isNumericSlot(node) &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Number.isInteger(value)
    ) {
      return { value: roundForIntegerSlot(value), source: node, exact: value };
    }
    return { value, source: node };
  }

  /**
   * `#const`'s value slot, and the one numeric slot that does not round. The
   * engine keeps a constant as a float and rounds it only when it reaches an
   * integer-only attribute (guide:3351, and the Summer 2025 note at
   * guide:4548, "Constants no longer get rounded to integer values when used
   * in math expressions"). Rounding here turned every value between -1 and 1
   * into -1, 0 or 1, which is what a trig macro's SIN and COS constants are,
   * so every ring of lands snapped onto a 3x3 grid (BUG-034).
   *
   * A separate function rather than a `storesFloat` flag on `resolveArg`,
   * because `node.args.map(resolveArg)` hands `map`'s index to a second
   * parameter. With a flag, every argument after the first would have
   * silently stopped rounding.
   */
  function resolveConstValue(node: ArgNode): InstantiatedValue {
    return resolveUnrounded(node);
  }

  function resolveAttribute(node: AttributeNode): InstantiatedAttribute {
    const name = tokenText(node.name);
    const args = node.args.map(resolveArg);
    const inst: InstantiatedAttribute = { name, args, span: node.span };
    // The two attributes that draw while the script is read (Sec.3, rev 9),
    // named here for the same reason behavior_version is named below, an
    // engine mechanic rather than vocabulary. Only AT_TEAM in random mode is
    // measured to draw. AT_PLAYER and AT_COLOR name one player already, and
    // whether a 0 mode still draws for them is untested (Sec.15 item 50).
    const drawsHere =
      name === "set_zone_randomly" ||
      (name === "assign_to" &&
        args[0]?.value === "AT_TEAM" &&
        args[2]?.value === 0);
    if (drawsHere)
      inst.draw = attributeDraws
        ? attributeDraws.get(parse.tokens[node.name].start)
        : stream.raw();
    return inst;
  }

  /** Rule 10: last-wins, except attributes language.json flags `repeatable`. */
  function foldAttribute(
    sink: Map<string, InstantiatedAttribute[]>,
    node: AttributeNode,
  ): void {
    const inst = resolveAttribute(node);
    if (node.def?.repeatable) {
      const existing = sink.get(inst.name);
      if (existing) existing.push(inst);
      else sink.set(inst.name, [inst]);
    } else {
      sink.set(inst.name, [inst]); // wholesale replace: last write wins
    }
  }

  // -------------------------------------------------------------------
  // Rules 2, 3: branch selection.
  // -------------------------------------------------------------------
  function selectIfBranch(node: IfNode): IfBranch | undefined {
    for (const branch of node.branches) {
      if (tokenText(branch.keyword) === "else") return branch; // always matches
      // A bare `elseif`, followed by something that cannot be a label, acts
      // as `else` (rev 11, CJ n1 and Rage Forest's `elseif` then `#const`).
      // The parser leaves such a branch without a condition.
      if (
        tokenText(branch.keyword) === "elseif" &&
        branch.condition === undefined
      )
        return branch;
      if (
        branch.condition !== undefined &&
        isDefined(tokenText(branch.condition))
      )
        return branch;
    }
    return undefined;
  }

  /**
   * Rule 3 (rev 9, measured): the roll is 0..99, and the first branch whose
   * running total of `percent_chance` values is AT LEAST the roll is taken.
   * So the first branch wins for its weight plus one of the 100 values, every
   * later branch for exactly its weight, and a block whose weights add up to
   * 99 or more always takes a branch. A `percent_chance 0` first branch wins
   * on a roll of 0, which is the "occasionally chosen anyway" bug the guide
   * reports.
   */
  function selectRandomBranch(node: RandomNode): RandomBranch | undefined {
    const roll = rollFor(node);
    let cumulative = 0;
    for (const branch of node.branches) {
      const resolved = branch.chance
        ? resolveArg(branch.chance).value
        : undefined;
      cumulative += typeof resolved === "number" ? resolved : 0;
      if (cumulative >= roll) return branch;
    }
    return undefined;
  }

  // -------------------------------------------------------------------
  // Dead text (rules 3 and 5, rev 11). Draws every rnd() in a stretch of
  // script in reading order, without defining anything, collecting any
  // command or rolling any start_random block. The walk below uses it for
  // every branch it does not take.
  // -------------------------------------------------------------------
  function drawRnd(token: number, low: number, high: number): number {
    const drawn = rndByToken.get(token);
    if (drawn !== undefined) return drawn;
    const value = low + stream.bounded(high - low + 1);
    rndByToken.set(token, value);
    return value;
  }

  function predrawArg(node: ArgNode): void {
    const raw = node.value;
    if (typeof raw === "object" && "rnd" in raw)
      drawRnd(node.firstToken, raw.rnd[0], raw.rnd[1]);
    else if (typeof raw === "string") {
      const named = namedRnd(raw);
      if (named) drawRnd(node.firstToken, named[0], named[1]);
    }
  }

  function predrawTokens(first: number, last: number): void {
    for (let i = first; i <= last; i++) {
      const tok = parse.tokens[i];
      if (tok?.kind === "rnd") {
        const m = /^rnd\((-?\d+),(-?\d+)\)$/.exec(tok.text);
        if (m) drawRnd(i, Number(m[1]), Number(m[2]));
        continue;
      }
      const named = tok ? namedRnd(tok.text) : undefined;
      if (named) drawRnd(i, named[0], named[1]);
    }
  }

  function predrawItems(items: readonly Item[]): void {
    for (const item of items) {
      switch (item.kind) {
        case "command":
          item.args.forEach(predrawArg);
          if (item.block) predrawItems(item.block.items);
          break;
        case "attribute":
        case "directive":
          item.args.forEach(predrawArg);
          break;
        case "if":
          for (const branch of item.branches) predrawItems(branch.items);
          break;
        case "random":
          // A start_random block that is never reached is not rolled (c5),
          // but its rnd() calls are read like any dead text.
          predrawItems(item.preamble);
          for (const branch of item.branches) {
            if (branch.chance) predrawArg(branch.chance);
            predrawItems(branch.items);
          }
          break;
        case "orphanBlock":
        case "raw":
          predrawTokens(item.firstToken, item.lastToken);
          break;
      }
    }
  }

  /**
   * A block's roll, drawn when the block is reached and before anything
   * inside it (rev 11, round CG's c3). The branches are read afterwards, in
   * order, so their rnd() calls draw after the roll. Rev 9 had it the other
   * way round, every rnd() of the block first and the roll last.
   */
  function rollFor(node: RandomNode): number {
    const rolled = rollByNode.get(node);
    if (rolled !== undefined) return rolled;
    const roll = stream.bounded(100);
    rollByNode.set(node, roll);
    return roll;
  }

  // -------------------------------------------------------------------
  // Rule 4: #define / #const / #undefine.
  // -------------------------------------------------------------------
  function processDirective(node: DirectiveNode): void {
    const directiveName = tokenText(node.hash);
    if (directiveName === "#define" || directiveName === "#const") {
      const nameArg = node.args[0];
      const symbolName =
        nameArg && typeof nameArg.value === "string"
          ? nameArg.value
          : undefined;
      if (symbolName === undefined || symbols.has(symbolName)) {
        // First-definition-wins, but the game still reads the value, so an
        // rnd() in it still takes its draw.
        node.args.forEach(predrawArg);
        return;
      }
      if (directiveName === "#define") {
        symbols.set(symbolName, undefined);
      } else {
        const valueArg = node.args[1];
        const resolved = valueArg ? resolveConstValue(valueArg) : undefined;
        symbols.set(
          symbolName,
          typeof resolved === "number" ? resolved : undefined,
        );
        // BUG-015: a value that stayed a STRING is a name-to-name alias
        // (`#const TERR_CORNER GRASS2`). It cannot go in `symbols`, which
        // holds ids, and dropping it is what made the preview claim our own
        // reference data does not know a terrain it does. Recorded UNRESOLVED,
        // see `InstantiatedScript.aliases` for why resolving it here would
        // be worse than the bug.
        if (typeof resolved === "string" && resolved !== symbolName)
          aliases.set(symbolName, resolved);
      }
    } else if (directiveName === "#include_drs") {
      // Reached only when no install was found, since with one the filter
      // reads every live include in and blanks the directive. A file that
      // cannot be read reads as empty, as in the game.
      addNote({
        key: "includes",
        prominence: "banner",
        stage: "S0",
        text: "This map includes files from the game's install, which the preview could not find, so it may not match the game.",
      });
    }
    // #includeXS loads an XS script for triggers, which never shape the map.
    // #undefine: rule 4, "does nothing", deliberately no state change.
  }

  // -------------------------------------------------------------------
  // Rules 7, 8, 11, 12: command instantiation + stream-variable side effects.
  // -------------------------------------------------------------------
  function resolveCommand(
    node: CommandNode,
    sectionName: string,
  ): InstantiatedCommand {
    // `InstantiatedCommand.name` means "which command is this", NOT "what did
    // the author type". `#const L 32` + `L { … }` is `create_land` (the parser
    // resolves the alias through `commandsByTokenId` and writes the real def
    // onto `node.def`), so identity has to come from the def and fall back to
    // the written word only for commands language.json does not know.
    // Resolving it HERE rather than at the four call sites that compare
    // `cmd.name` is the point: every consumer, the land-command gate below,
    // lands.ts, terrains.ts, elevation.ts, objects.ts, connections.ts, gets
    // the answer without knowing the alias rule exists. See docs/known-issues.md
    // BUG-013; the author's literal spelling belongs in a separate field if a
    // message ever needs it.
    const name = node.def?.name ?? tokenText(node.name);
    const args = node.args.map(resolveArg);
    const attributes = new Map<string, InstantiatedAttribute[]>();
    if (node.block)
      walkItems(node.block.items, sectionName, attributes, undefined);

    if (name === "behavior_version") {
      const requested = args[0]?.value;
      if (requested === 0 || requested === 1) {
        behaviorVersion = requested;
      } else if (requested === 2) {
        behaviorVersion = 1; // rule 7: "we treat 2 as 1"
        addNote({
          key: `behaviorVersion2:${node.span.start}`,
          prominence: "drawer",
          stage: "S0",
          span: node.span,
          text: "behavior_version 2 is simulated the same as version 1 — the guide reports no observed difference.",
        });
      }
    } else if (name === "override_map_size") {
      const requested = args[0]?.value;
      if (typeof requested === "number") {
        if (landCommandSeen) {
          addNote({
            key: `overrideMapSizeLate:${node.span.start}`,
            prominence: "drawer",
            stage: "S0",
            span: node.span,
            text: "override_map_size after the first land command is ignored — the engine only applies it before land generation starts.",
          });
        } else {
          overrideDim = Math.min(480, Math.max(36, requested)); // rule 8: clamps
        }
      }
    } else if (name === "direct_placement") {
      playerSetup.directPlacement = true;
    } else if (name === "random_placement") {
      playerSetup.randomPlacement = true;
    } else if (name === "grouped_by_team") {
      playerSetup.groupedByTeam = true;
    } else if (name === "nomad_resources") {
      playerSetup.nomadResources = true;
    } else if (LAND_COMMAND_NAMES.has(name)) {
      landCommandSeen = true;
    }

    const inst: InstantiatedCommand = {
      name,
      def: node.def,
      span: node.span,
      args,
      attributes,
      behaviorVersion,
    };

    // Rule 12: collected as encountered in the executed stream, regardless
    // of where in the file the referencing command sits.
    if (name === "create_object_group") {
      const groupName = args[0]?.value;
      if (typeof groupName === "string") objectGroups.set(groupName, inst);
    } else if (name === "create_actor_area") {
      const identifier = args[2]?.value; // x, y, identifier, radius
      if (typeof identifier === "number") {
        const list = actorAreas.get(identifier);
        if (list) list.push(inst);
        else actorAreas.set(identifier, [inst]);
      }
    }

    return inst;
  }

  /**
   * Depth-first walk shared by section-level content and command blocks.
   * `sink`, when present, means we are inside a command's block: encountered
   * AttributeNodes fold into it (rule 10). `out`, when present, is the
   * per-section command array top-level CommandNodes push into. Passing both
   * through unchanged into if/random branches is what makes "if/start_random
   * anywhere, including mid-command" (Sec.1) fall out for free, the branch
   * contributes to whichever sink/out the surrounding context already has.
   */
  function walkItems(
    items: readonly Item[],
    sectionName: string,
    sink: Map<string, InstantiatedAttribute[]> | undefined,
    out: InstantiatedCommand[] | undefined,
  ): void {
    for (const item of items) {
      switch (item.kind) {
        case "command": {
          // A command name resolving inside block context is the rare
          // cross-category RMS0207 case (Sec.4 pinned lookup): there is no
          // attribute sink slot for it, so it is unsimulated like an
          // unknown name.
          if (sink || item.def === undefined) {
            addNote(unsimulatedNote(item.span));
            predrawItems([item]); // the game still reads it, and its rnd() calls still draw
            break;
          }
          out?.push(resolveCommand(item, sectionName));
          break;
        }
        case "attribute": {
          if (!sink) {
            addNote(unsimulatedNote(item.span)); // attribute name outside any block
            predrawItems([item]);
            break;
          }
          foldAttribute(sink, item);
          break;
        }
        case "directive":
          processDirective(item);
          break;
        case "if": {
          // Branches in reading order. The game skips an untaken branch but
          // still reads it, so its rnd() calls draw where they sit
          // (Sec.15 item 49).
          const taken = selectIfBranch(item);
          for (const branch of item.branches) {
            if (branch === taken)
              walkItems(branch.items, sectionName, sink, out);
            else predrawItems(branch.items);
          }
          break;
        }
        case "random": {
          // The roll comes first. Preamble tokens sit before the engine's own branch filtering
          // starts (RMS0106 already flags this as misplaced authoring) and
          // execute unconditionally; the chosen branch, if any, follows.
          // Then the branches in order, the chosen one live and the others
          // dead, whose rnd() calls still draw where they sit (c3, c4).
          const branch = selectRandomBranch(item);
          walkItems(item.preamble, sectionName, sink, out);
          for (const candidate of item.branches) {
            if (candidate === branch)
              walkItems(candidate.items, sectionName, sink, out);
            else predrawItems(candidate.items);
          }
          break;
        }
        case "orphanBlock":
        case "raw":
          addNote(unsimulatedNote(item.span));
          predrawItems([item]);
          break;
      }
    }
  }

  // -------------------------------------------------------------------
  // Rule 11: merge duplicate sections, run in canonical engine order. The
  // walk reads the file top to bottom, the way the game reads it, so
  // definitions and draws happen in written order (rev 9), and each
  // section's commands collect into one list however many times the
  // section is written.
  // -------------------------------------------------------------------
  const bySection = new Map<string, InstantiatedCommand[]>();

  // Preamble: content written above the first <SECTION> tag belongs to
  // <PLAYER_SETUP> (rule 11, rev 11). Caverns and Heart write
  // override_map_size there, and DE's maps are 144 and 151 tiles.
  const preambleOut: InstantiatedCommand[] = [];
  walkItems(parse.script.preamble, "PLAYER_SETUP", undefined, preambleOut);
  if (preambleOut.length > 0) bySection.set("PLAYER_SETUP", preambleOut);

  for (const section of parse.script.sections) {
    let out = bySection.get(section.name);
    if (out === undefined) {
      out = [];
      bySection.set(section.name, out);
    }
    walkItems(section.items, section.name, undefined, out);
  }

  // `refDb.data.sections` already IS the canonical order, read from the data
  // rather than retyping the seven names.
  for (const sectionName of refDb.data.sections) {
    const out = bySection.get(sectionName);
    if (out === undefined) continue;
    bySection.delete(sectionName);
    sections.set(sectionName, out);
  }
  // Unknown section names (RMS0100): not one of the canonical seven, but
  // "never silently drop content", still instantiated, after the seven, in
  // first-encountered order (there is no engine-defined slot for them).
  for (const [sectionName, out] of bySection) sections.set(sectionName, out);

  // Only the numeric definitions leave this function. `symbols` internally
  // stores `undefined` for a bare `#define`, where presence alone means
  // "defined" (rule 4), but a downstream terrain/object lookup wants an id,
  // and handing it a name that maps to nothing would just push the same
  // narrowing onto every consumer.
  //
  // Values leave unrounded, as the engine holds them (BUG-034). Readers
  // differ in what they need. Land Placement feeds them into expressions,
  // where floats flow. The terrain and object id lookups (resolveTerrainId,
  // objectEntry, forestTreeSuppression's two resolvers) round at the lookup,
  // since an id slot is where the engine rounds.
  const numericSymbols = new Map<string, number>();
  for (const [name, value] of symbols) {
    if (typeof value === "number") numericSymbols.set(name, value);
  }

  if (insertions.length > 0)
    mapSpansToSource(sections, notes, (span) =>
      mapSpanToSource(span, insertions),
    );

  return {
    dim: overrideDim,
    sections,
    objectGroups,
    actorAreas,
    playerSetup,
    symbols: numericSymbols,
    aliases,
    teams: canonicalTeams,
    teamPositions,
    landStream: stream.state(),
    notes,
  };
}

/**
 * Moves every span the walk recorded from the expanded text, include files
 * read in, back to the author's text, in place. Commands are shared with
 * `objectGroups` and `actorAreas`, so mapping the sections maps those too.
 * Spans from inside one include all land on its directive, so notes that
 * now say the same thing at the same place are kept once.
 */
function mapSpansToSource(
  sections: ReadonlyMap<string, InstantiatedCommand[]>,
  notes: SimulationNote[],
  map: (span: Span) => Span,
): void {
  const mapArgs = (args: InstantiatedArg[]): void => {
    for (const arg of args)
      arg.source = { ...arg.source, span: map(arg.source.span) };
  };
  for (const commands of sections.values())
    for (const cmd of commands) {
      cmd.span = map(cmd.span);
      mapArgs(cmd.args);
      for (const attrs of cmd.attributes.values())
        for (const attr of attrs) {
          attr.span = map(attr.span);
          mapArgs(attr.args);
        }
    }
  const seen = new Set<string>();
  let kept = 0;
  for (const note of notes) {
    if (note.span !== undefined) note.span = map(note.span);
    const id = `${note.text}@${note.span?.start}-${note.span?.end}`;
    if (seen.has(id)) continue;
    seen.add(id);
    notes[kept++] = note;
  }
  notes.length = kept;
}
