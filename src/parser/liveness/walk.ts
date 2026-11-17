// The token walk of name liveness (docs/name-liveness-design.md Sec.4.4 and
// 4.5). PURE: no React, Monaco or Tauri.
//
// The walk reads a script the way the game's token filter does, one token at
// a time, keeping the GUARD the current token runs under. A guard is a
// formula (a BDD node) over the lobby and dice atoms of atoms.ts. It starts
// at TRUE. An `if` branch narrows it by the branch's condition and by the
// negation of every earlier condition in the chain, and a `percent_chance`
// arm narrows it to "this block took this arm".
//
// Why tokens and not the AST: a conditional can open in one section and close
// in another (preview-design Sec.3), and the parser then leaves a raw region
// with no tree. A token walk reads that region like any other. The AST gives
// the walk one thing, which tokens sit inside an argument (`collectArgTokens`),
// so it knows where a name is READ and not merely mentioned.
//
// Two facts decide what a name's condition is at a point. A name the script
// defines is taken to be the script's alone, so its condition is the join of
// its definitions above the point. A name nobody defines is a free atom,
// possibly defined by the engine, because our data missing a name proves
// nothing about the engine (CLAUDE.md, the positive-resolver rule).

import type { LanguageData } from "../language";
import { includeKey, includePathsIn } from "../includeIndex";
import { lineNumberOfOffset } from "../lineIndex";
import type { Item, ParseResult, Token } from "../types";
import type { AtomTable } from "./atoms";
import type { Bdd, BddNode } from "./bdd";

export interface LivenessInput {
  parse: ParseResult;
  language: LanguageData;
  /** Engine constant names, as for ParseOptions.builtinConstants. */
  builtinConstants: ReadonlySet<string>;
  /** The parse of an include file by includeKey, undefined when it was not read. */
  includeParse?: (key: string) => ParseResult | undefined;
  /** True when the script names an include nobody read (include resolution's includesUnread). */
  includesUnread: boolean;
  /** Names to treat as free atoms whatever their definitions (D2's second walk). */
  freeNames?: ReadonlySet<string>;
}

/** One read of a script `#const`, in the open script only. */
export interface WalkUse {
  /** Index into `parse.tokens`. */
  token: number;
  name: string;
  /** The guard the token runs under. */
  guard: BddNode;
  /** Def(name) at this token. */
  def: BddNode;
  /** The open script's definition tokens above this one. Definitions in include files have no token here. */
  definitionTokens: number[];
  /** The include keys holding a definition of the name above this token, each once, in the order they were met. */
  includeDefinitions: string[];
}

/** One `if`, `elseif` or `else` branch of the open script. */
export interface WalkBranch {
  keywordToken: number;
  /** Absent for `else` and for a bare `elseif`, which acts as `else`. */
  conditionToken?: number;
  /** The same number for every branch of one `if` chain. */
  chainIndex: number;
  guard: BddNode;
  /** The guard around the whole chain. */
  enclosingGuard: BddNode;
  /**
   * The chain part of the guard: this branch's own condition and the negation
   * of every earlier condition of its chain, without the guard around the
   * chain. A branch that is dead only because its chain already covered every
   * case has `local` impossible by itself.
   */
  local: BddNode;
  /** Def(condition) where the `if` reads it. Absent with the condition. */
  conditionDef?: BddNode;
  /** The condition words of this chain up to and including this branch, and of every chain around it, outermost first. */
  conditionNames: string[];
}

export interface WalkResult {
  uses: WalkUse[];
  branches: WalkBranch[];
  /** Names with a definition no `if` or `start_random` encloses (design Sec.6.1's switches). */
  switches: Set<string>;
  /** Def(n) after the last token, for every name the open script defines. */
  endDefs: Map<string, BddNode>;
  /** For each switch, the token of its first definition that no `if` or `start_random` encloses. */
  switchTokens: Map<string, number>;
}

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Every token index that sits inside a value position of the open script: the
 * arguments of commands and attributes, the `percent_chance` operand, and a
 * `#const`'s value (the arguments after its first, which is the name it
 * defines). The walk reads names only at these.
 */
export function collectArgTokens(parse: ParseResult): Set<number> {
  const found = new Set<number>();
  const addArg = (a: {
    firstToken: number;
    lastToken: number;
    def?: { type: string };
  }): void => {
    // A `string` slot names something the command makes (create_object_group's
    // group name) and reads no value, the same reason a #const's own name is
    // skipped. Without this, `create_object_group HARE` would count as a read
    // of an unrelated `#const HARE` (rms-check's back_prop fixture).
    if (a.def?.type === "string") return;
    for (let i = a.firstToken; i <= a.lastToken; i++) found.add(i);
  };
  const visit = (items: readonly Item[]): void => {
    for (const item of items) {
      switch (item.kind) {
        case "command":
          item.args.forEach(addArg);
          if (item.block) visit(item.block.items);
          break;
        case "attribute":
          item.args.forEach(addArg);
          break;
        case "directive":
          // The first argument of #const and #define is the name being defined.
          item.args.slice(1).forEach(addArg);
          break;
        case "if":
          for (const b of item.branches) visit(b.items);
          break;
        case "random":
          visit(item.preamble);
          for (const b of item.branches) {
            if (b.chance) addArg(b.chance);
            visit(b.items);
          }
          break;
        case "orphanBlock":
          visit(item.block.items);
          break;
        case "raw":
          break;
      }
    }
  };
  visit(parse.script.preamble);
  for (const s of parse.script.sections) visit(s.items);
  return found;
}

/**
 * A guard that is built the first time something asks for it. Most of an
 * include file is commands and objects that define no name, and the guard of
 * a branch only matters to a definition, a use or a reported branch inside
 * it. Building every branch's guard eagerly made the BDD 5 times larger on
 * include-heavy scripts for guards nobody read. This is a thunk (a function
 * that delays work) with a cache, the usual way to get laziness in a language
 * that evaluates eagerly.
 */
interface Guard {
  node(): BddNode;
}

interface IfFrame {
  kind: "if";
  outer: Guard;
  /** The negation of every condition of the chain so far. */
  negs: Guard;
  chain: number;
  /** The condition words of this chain so far, for the messages of a dead branch. */
  conditions: string[];
}

interface RandomFrame {
  kind: "random";
  outer: Guard;
  block: number;
}

export function walkLiveness(
  bdd: Bdd,
  atoms: AtomTable,
  input: LivenessInput,
): WalkResult {
  const { parse, language, builtinConstants, includeParse, freeNames } = input;
  const controlKeywords = new Set(language.controlKeywords.map((k) => k.name));
  const labelNames = new Set(
    (language.predefinedLabels ?? []).map((l) => l.name),
  );

  // "Anywhere" for the free-atom rule needs every definition up front, so a
  // name defined LATER in the file is not mistaken for one nobody defines.
  const definedAnywhere = new Set<string>();
  const constNames = new Set<string>();
  const surveyed = new Set<string>();
  const survey = (file: ParseResult): void => {
    for (const s of file.symbols) {
      definedAnywhere.add(s.name);
      if (s.directiveKind === "const") constNames.add(s.name);
    }
    for (const path of includePathsIn(file)) {
      const key = includeKey(path);
      if (surveyed.has(key)) continue;
      surveyed.add(key);
      const inc = includeParse?.(key);
      if (inc) survey(inc);
    }
  };
  survey(parse);

  const argTokens = collectArgTokens(parse);

  // Definitions seen so far, by name. `defGuard` is the join (or) of their
  // guards, which is what Def(n) reads at a point.
  const defGuard = new Map<string, BddNode>();
  const defTokens = new Map<string, number[]>();
  const switches = new Set<string>();
  const switchTokens = new Map<string, number>();
  /** The include files holding a definition of each name, by name. */
  const includeDefs = new Map<string, string[]>();
  const uses: WalkUse[] = [];
  const branches: WalkBranch[] = [];
  let nextChain = 0;

  const constant = (n: BddNode): Guard => ({ node: () => n });
  const lazy = (build: () => BddNode): Guard => {
    let cached: BddNode | undefined;
    return { node: () => (cached ??= build()) };
  };
  const lazyAnd = (a: Guard, b: Guard): Guard =>
    lazy(() => bdd.and(a.node(), b.node()));
  const TRUE_GUARD = constant(bdd.TRUE);
  const FALSE_GUARD = constant(bdd.FALSE);
  let G: Guard = TRUE_GUARD;

  /**
   * Def(n), design Sec.4.4, in its order. What is already known at this point
   * (the definitions above) is captured now, and the node is built when asked.
   * Reading it at the `if` and not at the branch is what keeps a #define
   * inside the branch out of its own condition.
   */
  function defAt(name: string): Guard {
    if (freeNames?.has(name)) return lazy(() => atoms.free(name));
    if (builtinConstants.has(name)) return TRUE_GUARD;
    const seen = defGuard.get(name) ?? bdd.FALSE;
    if (labelNames.has(name)) {
      // Source order is what names a size atom after the script's own spelling.
      atoms.noteRead(name);
      return lazy(() => bdd.or(atoms.label(name), seen));
    }
    if (!definedAnywhere.has(name)) return lazy(() => atoms.free(name));
    return constant(seen);
  }
  const defOf = (name: string): BddNode => defAt(name).node();

  function recordDef(
    name: string,
    token: number | undefined,
    top: boolean,
    includeFile: string | undefined,
  ) {
    const g = G.node();
    defGuard.set(name, bdd.or(defGuard.get(name) ?? bdd.FALSE, g));
    if (g === bdd.TRUE) {
      switches.add(name);
      if (top && token !== undefined && !switchTokens.has(name))
        switchTokens.set(name, token);
    }
    if (top && token !== undefined) {
      const list = defTokens.get(name) ?? [];
      list.push(token);
      defTokens.set(name, list);
    }
    if (!top && includeFile !== undefined) {
      const list = includeDefs.get(name) ?? [];
      if (!list.includes(includeFile)) list.push(includeFile);
      includeDefs.set(name, list);
    }
  }

  /** The tokenFilter.ts test for "this token cannot be a label". */
  const structural = (t: Token | undefined): boolean =>
    t === undefined ||
    t.kind === "openBrace" ||
    t.kind === "closeBrace" ||
    t.kind === "sectionHeader" ||
    t.kind === "directive" ||
    (t.kind === "word" && controlKeywords.has(t.text));

  /** Records the value uses a token holds, in the open script only. */
  function visitUses(index: number, token: Token, top: boolean): void {
    if (!top || !argTokens.has(index)) return;
    const names = new Set(token.text.match(IDENTIFIER) ?? []);
    for (const name of names) {
      if (!constNames.has(name)) continue;
      uses.push({
        token: index,
        name,
        guard: G.node(),
        def: defOf(name),
        definitionTokens: [...(defTokens.get(name) ?? [])],
        includeDefinitions: [...(includeDefs.get(name) ?? [])],
      });
    }
  }

  /** The last non-trivia position of the path that starts at `k`, as tokenFilter.ts reads a quoted path. */
  function pathEnd(tokens: readonly Token[], k: number): number {
    const first = tokens[k];
    if (!first.text.startsWith('"')) return k;
    if (first.text.length > 1 && first.text.endsWith('"')) return k;
    for (let j = k + 1; j < tokens.length && !structural(tokens[j]); j++)
      if (tokens[j].text.endsWith('"')) return j;
    return k;
  }

  function walkFile(file: ParseResult, top: boolean, open: string[]): void {
    // Non-trivia tokens only, each remembered with its index in file.tokens.
    const index: number[] = [];
    file.tokens.forEach((t, i) => {
      if (!t.isTrivia) index.push(i);
    });
    const tokens = index.map((i) => file.tokens[i]);
    const frames: (IfFrame | RandomFrame)[] = [];

    /** Opens a branch of an if chain under the chain's narrowed guard. */
    const branch = (
      frame: IfFrame,
      keyword: number,
      condition: number | undefined,
      def: Guard | undefined,
      conditionName: string | undefined,
    ): void => {
      const around = lazyAnd(frame.outer, frame.negs);
      const guard = def === undefined ? around : lazyAnd(around, def);
      if (conditionName !== undefined) frame.conditions.push(conditionName);
      // A branch of the open script is always reported on, so its guard is built.
      if (top)
        branches.push({
          keywordToken: keyword,
          conditionToken: condition,
          chainIndex: frame.chain,
          guard: guard.node(),
          enclosingGuard: frame.outer.node(),
          local: (def === undefined
            ? frame.negs
            : lazyAnd(frame.negs, def)
          ).node(),
          conditionDef: def?.node(),
          conditionNames: frames.flatMap((f) =>
            f.kind === "if" ? f.conditions : [],
          ),
        });
      G = guard;
      // After an `else` nothing more can run, as the game's filter has it.
      frame.negs =
        def === undefined
          ? FALSE_GUARD
          : lazyAnd(
              frame.negs,
              lazy(() => bdd.not(def.node())),
            );
    };

    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      const at = index[k];
      switch (t.text) {
        case "if":
        case "elseif": {
          const next = tokens[k + 1];
          const bare = structural(next);
          const conditionIndex = bare ? undefined : index[k + 1];
          // Def(c) is read at the `if`, so a #define inside the branch does not change its own condition.
          const def = bare ? undefined : defAt(next.text);
          if (!bare) k++;
          if (t.text === "if") {
            const frame: IfFrame = {
              kind: "if",
              outer: G,
              negs: TRUE_GUARD,
              chain: nextChain++,
              conditions: [],
            };
            frames.push(frame);
            // A bare `if` has no condition and the game never runs it. It is
            // a syntax error the parser already reports, so it makes no branch.
            if (bare) {
              G = FALSE_GUARD;
              continue;
            }
            branch(frame, at, conditionIndex, def, next.text);
            continue;
          }
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "if") continue;
          // A bare `elseif` acts as `else` (preview-design Sec.3 rule 2).
          branch(frame, at, conditionIndex, def, bare ? undefined : next.text);
          continue;
        }
        case "else": {
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "if") continue;
          branch(frame, at, undefined, undefined, undefined);
          continue;
        }
        case "endif": {
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "if") continue;
          G = frame.outer;
          frames.pop();
          continue;
        }
        case "start_random":
          frames.push({
            kind: "random",
            outer: G,
            block: atoms.openBlock(
              lineNumberOfOffset(file.lineOffsets, t.start),
              top ? undefined : open[open.length - 1],
            ),
          });
          continue;
        case "percent_chance": {
          const next = tokens[k + 1];
          const frame = frames[frames.length - 1];
          if (next === undefined || frame?.kind !== "random") continue;
          k++;
          visitUses(index[k], next, top);
          // Only a literal whole number counts, the corpus's case. Anything
          // else is read as "unknown chance", the weaker and safe reading.
          const chance = /^\d+$/.test(next.text)
            ? Number(next.text)
            : undefined;
          const arm = atoms.arm(frame.block, chance);
          const outer = frame.outer;
          G = lazy(() => bdd.and(outer.node(), arm));
          continue;
        }
        case "end_random": {
          const frame = frames[frames.length - 1];
          if (frame?.kind !== "random") continue;
          atoms.closeBlock(frame.block);
          G = frame.outer;
          frames.pop();
          continue;
        }
      }

      if (
        t.kind === "directive" &&
        t.text === "#include_drs" &&
        k + 1 < tokens.length &&
        !structural(tokens[k + 1])
      ) {
        const last = pathEnd(tokens, k + 1);
        const path = file.source.slice(tokens[k + 1].start, tokens[last].end);
        k = last;
        const key = includeKey(path);
        const inc = open.includes(key) ? undefined : includeParse?.(key);
        if (inc === undefined) continue;
        // The included file is walked under the current guard with its own
        // frame stack, so a conditional it leaves open cannot leak out.
        const saved = G;
        open.push(key);
        walkFile(inc, false, open);
        open.pop();
        G = saved;
        continue;
      }

      if (
        t.kind === "directive" &&
        (t.text === "#const" || t.text === "#define")
      ) {
        const name = tokens[k + 1];
        if (name === undefined) continue;
        k++;
        const nameIndex = index[k];
        if (t.text === "#define") {
          recordDef(name.text, nameIndex, top, open[open.length - 1]);
          continue;
        }
        // The value is one token, or a parenthesised expression of several.
        const first = tokens[k + 1];
        if (first !== undefined) {
          let last = k + 1;
          if (first.text.startsWith("(") && !first.text.endsWith(")"))
            while (last + 1 < tokens.length && !tokens[last].text.endsWith(")"))
              last++;
          for (let j = k + 1; j <= last; j++)
            visitUses(index[j], tokens[j], top);
          k = last;
        }
        // Recorded after the value is read, so `#const A A` does not define A for itself.
        recordDef(name.text, nameIndex, top, open[open.length - 1]);
        continue;
      }

      visitUses(at, t, top);
    }

    // A block left open at the end of the file still constrains its arms.
    for (const frame of frames)
      if (frame.kind === "random") atoms.closeBlock(frame.block);
  }

  walkFile(parse, true, []);

  const endDefs = new Map<string, BddNode>();
  for (const s of parse.symbols)
    if (!endDefs.has(s.name)) endDefs.set(s.name, defOf(s.name));

  return { uses, branches, switches, endDefs, switchTokens };
}
