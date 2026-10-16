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
// THE DRAWS ARE THE GAME'S, IN THE GAME'S ORDER (Sec.3 rules 3 and 5, rev 9).
// The game reads the whole script before player setup, and every rnd() it
// reads takes a draw from the one stream the land stage then continues. That
// includes an rnd() inside a start_random branch that is not taken, because
// the game reads a whole start_random block, drawing as it goes, before it
// rolls for the branch. So a block's roll comes after every rnd() inside it
// and before every rnd() after it. `predrawItems` below is that read-ahead.

import type {
  ArgNode,
  AttributeNode,
  CommandNode,
  DirectiveNode,
  IfBranch,
  IfNode,
  Item,
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
import { createDeStream } from "./deRandom";
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

/**
 * Sec.3: AST -> InstantiatedScript. `masterSeed` is the game seed. It seeds
 * the game's own stream (deRandom.ts), every parse-time draw comes off it in
 * reading order, and the stream's position afterwards goes to S1 as
 * `landStream` (Sec.8, rev 9).
 */
export function instantiateScript(
  parse: ParseResult,
  refDb: LanguageIndex,
  settings: PreviewSettings,
  masterSeed: number,
): InstantiatedScript {
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
  for (const label of predefinedLabels) {
    if (label.category === "mapSize" && label.mapSize === settings.mapSize)
      env.add(label.name);
  }
  env.add(`${settings.playerCount}_PLAYER_GAME`);
  env.add("RANDOM_MAP"); // standard random-map game mode (rule 1)
  env.add("DE_AVAILABLE");
  env.add("DE_GAME_AGE2");
  // Deliberately NOT set: UP_*, DE_GAME_ROME, every other gameMode
  // (REGICIDE, EMPIRE_WARS, ...), lobbySetting except TEAM_POSITIONS below,
  // startingResources,
  // startingAge, none of these are derivable from PreviewSettings, so
  // "standard-lobby defaults for the rest" means they stay undefined/false.

  const canonicalTeams = canonicaliseTeams(
    settings.teams,
    settings.playerCount,
  );
  for (const label of teamLabels(canonicalTeams)) env.add(label);

  // The lobby's Team Positions box defines TEAM_POSITIONS, resolved through
  // predefinedLabels rather than constructed and trusted. FIXED_POSITIONS,
  // which the guide ties to the older "team together" box, is left undefined,
  // since nothing measured says the DE box sets it too (preview-design
  // Sec.15 item 55).
  const teamPositions = settings.teamPositions !== false;
  if (teamPositions) {
    const label = predefinedLabels.find(
      (l) => l.category === "lobbySetting" && l.name === "TEAM_POSITIONS",
    );
    if (label) env.add(label.name);
  }

  const lobbyDim =
    resolveMapDim(settings.mapSize, refDb.data.predefinedLabels) ??
    FALLBACK_DIM;

  // -------------------------------------------------------------------
  // Mutable stream state (rules 4, 7, 8, 11) and the game's stream (Sec.8).
  // -------------------------------------------------------------------
  const symbols = new Map<string, number | undefined>(); // presence = "defined" (rule 4)
  const stream = createDeStream(masterSeed);
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

  function unsimulatedNote(span: Span): SimulationNote {
    return {
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
    if (typeof raw === "string")
      return isNumericSlot(node) && symbols.has(raw) ? symbols.get(raw) : raw;
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
    if (name === "set_zone_randomly") inst.draw = stream.raw();
    else if (
      name === "assign_to" &&
      args[0]?.value === "AT_TEAM" &&
      args[2]?.value === 0
    )
      inst.draw = stream.raw();
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
  // The read-ahead (rules 3 and 5, rev 9). Draws every rnd() in a stretch
  // of script and rolls every start_random block in it, in reading order,
  // without defining anything or collecting any command. The walk below
  // uses it for every branch it does not take, and a start_random block
  // uses it on all of its own branches before it rolls.
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
  }

  function predrawTokens(first: number, last: number): void {
    for (let i = first; i <= last; i++) {
      const tok = parse.tokens[i];
      if (tok?.kind !== "rnd") continue;
      const m = /^rnd\((-?\d+),(-?\d+)\)$/.exec(tok.text);
      if (m) drawRnd(i, Number(m[1]), Number(m[2]));
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
          rollFor(item);
          break;
        case "orphanBlock":
        case "raw":
          predrawTokens(item.firstToken, item.lastToken);
          break;
      }
    }
  }

  /** A block's roll, drawn after every draw inside the block. Nested blocks inside it roll first, in reading order. */
  function rollFor(node: RandomNode): number {
    const rolled = rollByNode.get(node);
    if (rolled !== undefined) return rolled;
    predrawItems(node.preamble);
    for (const branch of node.branches) {
      if (branch.chance) predrawArg(branch.chance);
      predrawItems(branch.items);
    }
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
    } else if (
      directiveName === "#include_drs" ||
      directiveName === "#includeXS"
    ) {
      addNote({
        key: "includes",
        prominence: "banner",
        stage: "S0",
        text: "This map depends on include files the preview cannot see — the preview is missing whatever they generate.",
      });
    }
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
          // The roll comes first, and it reads ahead through the whole block.
          // Preamble tokens sit before the engine's own branch filtering
          // starts (RMS0106 already flags this as misplaced authoring) and
          // execute unconditionally; the chosen branch, if any, follows.
          const branch = selectRandomBranch(item);
          walkItems(item.preamble, sectionName, sink, out);
          if (branch) walkItems(branch.items, sectionName, sink, out);
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

  // Preamble: content written above the first <SECTION> tag. Not one of the
  // seven pipeline sections (rule 11), so nothing is collected for it, but
  // it still runs, for its symbol/stream-state side effects.
  walkItems(parse.script.preamble, "", undefined, undefined);

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
