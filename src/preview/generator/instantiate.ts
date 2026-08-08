// Stage 0: script instantiation — docs/preview-design.md Sec.3. PURE
// (CLAUDE.md hard rule / preview-design Sec.2).
//
// The parser deliberately never evaluates conditionals, randoms, or math
// (parser-design Sec.1 non-goals; Sec.2.2 assigns that semantics to "the
// preview generator"). This file is that pass: it walks the AST once,
// mirroring the engine's token-filter model — pick a branch, roll a random,
// resolve a constant, fold duplicate attributes — and produces a flat,
// per-section list of concrete commands with every value as final as S0 can
// make it. Every later stage (lands.ts onward) reads InstantiatedScript, not
// the AST.
//
// One walk, not two: `if`/`start_random` branch selection, `#define`/`#const`
// symbol definitions, and the S0 RNG rolls all happen in the SAME
// depth-first traversal, in canonical section order (Sec.3 rule 11) — so a
// symbol defined only inside a taken branch resolves correctly for
// everything after it, and a symbol inside an UNTAKEN branch never exists,
// exactly as the engine would see it.

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
import { NUMERIC_ARGUMENT_TYPES, type LanguageIndex } from "../../parser/language";
import { canonicaliseTeams, teamLabels } from "../../generationSettings/teamModel";
import { createSubstream, nextInt } from "./rng";
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
// `validate:reference` enforces that join — this constant exists so a
// corrupted/emptied data file degrades to *a* map rather than to no map at
// all (Sec.3 rule 1's own "label data is missing" guard covers the same
// failure and fires alongside this).
const FALLBACK_DIM = 200;

// Sec.3 rule 11's parenthetical names these five PLAYER_SETUP commands
// explicitly as stream state S0 folds into the environment, and rule 7/8
// name behavior_version/override_map_size the same way — these are pinned
// engine mechanics the spec itself calls out by name, not a data-driven
// vocabulary category (contrast CommandDef.repeatable, which IS read from
// language.json rather than hardcoded here).
const LAND_COMMAND_NAMES = new Set(["create_land", "create_player_lands"]);

/**
 * Sec.3: AST -> InstantiatedScript. `masterSeed` seeds every S0-owned
 * substream (start_random rolls, rnd() draws) via rng.ts's
 * `createSubstream(masterSeed, "S0", ordinal)` convention, keyed by an
 * independent per-construct-kind ordinal so editing one rnd() or
 * start_random does not reshuffle another (Sec.8's "best-effort stability").
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
    if (label.category === "mapSize" && label.mapSize === settings.mapSize) env.add(label.name);
  }
  env.add(`${settings.playerCount}_PLAYER_GAME`);
  env.add("RANDOM_MAP"); // standard random-map game mode (rule 1)
  env.add("DE_AVAILABLE");
  env.add("DE_GAME_AGE2");
  // Deliberately NOT set: UP_*, DE_GAME_ROME, every other gameMode
  // (REGICIDE, EMPIRE_WARS, ...), lobbySetting, startingResources,
  // startingAge — none of these are derivable from PreviewSettings, so
  // "standard-lobby defaults for the rest" means they stay undefined/false.

  const canonicalTeams = canonicaliseTeams(settings.teams, settings.playerCount);
  for (const label of teamLabels(canonicalTeams)) env.add(label);

  const lobbyDim = resolveMapDim(settings.mapSize, refDb.data.predefinedLabels) ?? FALLBACK_DIM;

  // -------------------------------------------------------------------
  // Mutable stream state (rules 4, 7, 8, 11) and RNG ordinals (Sec.8).
  // -------------------------------------------------------------------
  const symbols = new Map<string, number | undefined>(); // presence = "defined" (rule 4)
  let rndOrdinal = 0;
  let randomOrdinal = 0;
  let behaviorVersion: 0 | 1 = 0;
  let overrideDim = lobbyDim;
  let landCommandSeen = false;

  const playerSetup: PlayerSetupState = {
    directPlacement: false,
    randomPlacement: false,
    groupedByTeam: false,
    nomadResources: false,
  };

  const objectGroups = new Map<string, InstantiatedCommand>();
  const actorAreas = new Map<number, InstantiatedCommand[]>();
  const sections = new Map<string, InstantiatedCommand[]>();

  const isDefined = (name: string): boolean => env.has(name) || symbols.has(name);
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
  function resolveArg(node: ArgNode): InstantiatedArg {
    const type = node.def?.type;
    // integer/percent/flag are Sec.6's "numeric slots"; otherConstant is
    // #const's own value slot, whose description says a string there may be
    // "another constant" — both get the same symbol-table attempt and the
    // same rounding, since both are fundamentally numeric internally.
    // terrainConstant/objectConstant do NOT: those names resolve against
    // game-constants.json elsewhere (CREATION_PLAN A.2's alias table is the
    // unbuilt feature that would extend this to them).
    const numericContext = type !== undefined && (NUMERIC_ARGUMENT_TYPES.has(type) || type === "otherConstant");

    const raw = node.value;
    let value: InstantiatedValue;
    if (typeof raw === "number") {
      value = raw;
    } else if (typeof raw === "string") {
      value = numericContext && symbols.has(raw) ? symbols.get(raw) : raw;
    } else if ("rnd" in raw) {
      // Rule 5: evaluated at consumption time, own substream per occurrence.
      const rng = createSubstream(masterSeed, "S0", rndOrdinal++);
      value = nextInt(rng, raw.rnd[0], raw.rnd[1]);
    } else {
      // {expr}: rule 6, parser-design Sec.2.2 exactly.
      const texts = raw.expr.tokens.map(tokenText);
      value = evaluateExpressionTokens(texts, (name) => symbols.get(name));
    }

    if (numericContext && typeof value === "number" && Number.isFinite(value) && !Number.isInteger(value)) {
      value = roundForIntegerSlot(value);
    }

    return { value, source: node };
  }

  function resolveAttribute(node: AttributeNode): InstantiatedAttribute {
    return { name: tokenText(node.name), args: node.args.map(resolveArg), span: node.span };
  }

  /** Rule 10: last-wins, except attributes language.json flags `repeatable`. */
  function foldAttribute(sink: Map<string, InstantiatedAttribute[]>, node: AttributeNode): void {
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
      if (branch.condition !== undefined && isDefined(tokenText(branch.condition))) return branch;
    }
    return undefined;
  }

  /**
   * Rule 3: roll r uniform 1-100 from this RandomNode's own substream;
   * branches claim cumulative ranges in declaration order, truncated at 99
   * (guide:3007) — so r=100 is always the no-branch outcome, and a total
   * under 99 leaves an even larger gap. Deterministic given the seed, never
   * re-rolled once chosen.
   */
  function selectRandomBranch(node: RandomNode): RandomBranch | undefined {
    const rng = createSubstream(masterSeed, "S0", randomOrdinal++);
    const roll = nextInt(rng, 1, 100);
    let cumulative = 0;
    for (const branch of node.branches) {
      if (cumulative >= 99) break; // nothing left to claim
      const resolved = branch.chance ? resolveArg(branch.chance).value : undefined;
      const pct = typeof resolved === "number" ? resolved : 0;
      const width = Math.max(0, Math.min(pct, 99 - cumulative));
      if (width > 0 && roll >= cumulative + 1 && roll <= cumulative + width) return branch;
      cumulative += width;
    }
    return undefined;
  }

  // -------------------------------------------------------------------
  // Rule 4: #define / #const / #undefine.
  // -------------------------------------------------------------------
  function processDirective(node: DirectiveNode): void {
    const directiveName = tokenText(node.hash);
    if (directiveName === "#define" || directiveName === "#const") {
      const nameArg = node.args[0];
      const symbolName = nameArg && typeof nameArg.value === "string" ? nameArg.value : undefined;
      if (symbolName === undefined || symbols.has(symbolName)) return; // first-definition-wins
      if (directiveName === "#define") {
        symbols.set(symbolName, undefined);
      } else {
        const valueArg = node.args[1];
        const resolved = valueArg ? resolveArg(valueArg).value : undefined;
        symbols.set(symbolName, typeof resolved === "number" ? resolved : undefined);
      }
    } else if (directiveName === "#include_drs" || directiveName === "#includeXS") {
      addNote({
        key: "includes",
        prominence: "banner",
        stage: "S0",
        text: "This map depends on include files the preview cannot see — the preview is missing whatever they generate.",
      });
    }
    // #undefine: rule 4, "does nothing" — deliberately no state change.
  }

  // -------------------------------------------------------------------
  // Rules 7, 8, 11, 12: command instantiation + stream-variable side effects.
  // -------------------------------------------------------------------
  function resolveCommand(node: CommandNode, sectionName: string): InstantiatedCommand {
    const name = tokenText(node.name);
    const args = node.args.map(resolveArg);
    const attributes = new Map<string, InstantiatedAttribute[]>();
    if (node.block) walkItems(node.block.items, sectionName, attributes, undefined);

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

    const inst: InstantiatedCommand = { name, def: node.def, span: node.span, args, attributes, behaviorVersion };

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
   * anywhere, including mid-command" (Sec.1) fall out for free — the branch
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
            break;
          }
          out?.push(resolveCommand(item, sectionName));
          break;
        }
        case "attribute": {
          if (!sink) {
            addNote(unsimulatedNote(item.span)); // attribute name outside any block
            break;
          }
          foldAttribute(sink, item);
          break;
        }
        case "directive":
          processDirective(item);
          break;
        case "if": {
          const branch = selectIfBranch(item);
          if (branch) walkItems(branch.items, sectionName, sink, out);
          break;
        }
        case "random": {
          // Preamble tokens sit before the engine's own branch filtering
          // starts (RMS0106 already flags this as misplaced authoring) and
          // execute unconditionally; the chosen branch, if any, follows.
          walkItems(item.preamble, sectionName, sink, out);
          const branch = selectRandomBranch(item);
          if (branch) walkItems(branch.items, sectionName, sink, out);
          break;
        }
        case "orphanBlock":
        case "raw":
          addNote(unsimulatedNote(item.span));
          break;
      }
    }
  }

  // -------------------------------------------------------------------
  // Rule 11: merge duplicate sections, process in canonical engine order.
  // `refDb.data.sections` already IS that order — read from the data
  // rather than retyping the seven names.
  // -------------------------------------------------------------------
  const bySection = new Map<string, Item[]>();
  for (const section of parse.script.sections) {
    const merged = bySection.get(section.name);
    if (merged) merged.push(...section.items);
    else bySection.set(section.name, [...section.items]);
  }

  // Preamble: content written above the first <SECTION> tag. Not one of the
  // seven pipeline sections (rule 11), so nothing is collected for it — but
  // it still runs, for its symbol/stream-state side effects.
  walkItems(parse.script.preamble, "", undefined, undefined);

  for (const sectionName of refDb.data.sections) {
    const items = bySection.get(sectionName);
    if (items === undefined) continue;
    bySection.delete(sectionName);
    const out: InstantiatedCommand[] = [];
    walkItems(items, sectionName, undefined, out);
    sections.set(sectionName, out);
  }
  // Unknown section names (RMS0100): not one of the canonical seven, but
  // "never silently drop content" — still instantiated, after the seven, in
  // first-encountered order (there is no engine-defined slot for them).
  for (const [sectionName, items] of bySection) {
    const out: InstantiatedCommand[] = [];
    walkItems(items, sectionName, undefined, out);
    sections.set(sectionName, out);
  }

  // Only the numeric definitions leave this function. `symbols` internally
  // stores `undefined` for a bare `#define`, where presence alone means
  // "defined" (rule 4) — but a downstream terrain/object lookup wants an id,
  // and handing it a name that maps to nothing would just push the same
  // narrowing onto every consumer.
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
    teams: canonicalTeams,
    notes,
  };
}
