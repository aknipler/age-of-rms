// Classifies the walk's uses and branches (docs/name-liveness-design.md Sec.1
// and 6.1). PURE: no React, Monaco or Tauri.
//
// For a use of a name n, three formulas matter. G is the guard the line runs
// under, Def(n) is the condition under which n is defined there, and D is the
// domain (the lobbies and rolls that can happen). Everything is one BDD
// question:
//
//   dead    G and D and Def(n) is impossible: whenever the line runs, n is not defined
//   live    G and D and not Def(n) is impossible: whenever the line runs, n is defined
//   maybe   neither
//
// Reaching a use that can never run at all (G and D impossible) is not a
// finding about the name, so those uses are skipped.

import { Bdd, BddOverflow, type BddNode } from "./bdd";
import { AtomTable, sizeKeys } from "./atoms";
import {
  walkLiveness,
  type LivenessInput,
  type WalkBranch,
  type WalkResult,
} from "./walk";

export type Verdict = "live" | "dead" | "maybe";

export interface LivenessResult {
  status: "complete" | "incomplete" | "overflow";
  uses: {
    token: number;
    name: string;
    verdict: Verdict;
    definitionTokens: number[];
  }[];
  deadBranches: { keywordToken: number; kind: "contradiction" | "switch" }[];
  /** Def(n) at the end of the file, for every name the script defines. For tests and the measure. */
  namesAtEnd: Map<string, Verdict>;
  nodeCount: number;
  ms: number;
}

/** One walk with its own diagram. The second walk of a file must not share atoms with the first. */
function run(input: LivenessInput) {
  const labels = input.language.predefinedLabels ?? [];
  const bdd = new Bdd();
  const atoms = new AtomTable(
    bdd,
    labels,
    input.language.labelGroups ?? [],
    sizeKeys(labels),
  );
  const walk = walkLiveness(bdd, atoms, input);
  // D is read after the walk, since every block and group member it constrains is known by then.
  return { bdd, atoms, walk, domain: atoms.domain() };
}

function verdictOf(
  bdd: Bdd,
  domain: BddNode,
  guard: BddNode,
  def: BddNode,
): Verdict {
  const reach = bdd.and(guard, domain);
  if (bdd.isFalse(bdd.and(reach, def))) return "dead";
  if (bdd.isFalse(bdd.and(reach, bdd.not(def)))) return "live";
  return "maybe";
}

/**
 * The branches that can never run. A branch whose chain already repeats its
 * condition is RMS0313's (D3), and a branch inside a dead one is not a dead
 * branch of its own (D4), so only the outermost counts.
 */
function deadBranches(
  bdd: Bdd,
  domain: BddNode,
  walk: WalkResult,
  tokenText: (token: number) => string,
): WalkBranch[] {
  const seenConditions = new Map<number, Set<string>>();
  const dead: WalkBranch[] = [];
  for (const b of walk.branches) {
    let repeat = false;
    if (b.conditionToken !== undefined) {
      const text = tokenText(b.conditionToken);
      const seen = seenConditions.get(b.chainIndex) ?? new Set<string>();
      repeat = seen.has(text);
      seen.add(text);
      seenConditions.set(b.chainIndex, seen);
    }
    if (repeat) continue;
    if (!bdd.isFalse(bdd.and(b.guard, domain))) continue;
    if (bdd.isFalse(bdd.and(b.enclosingGuard, domain))) continue;
    dead.push(b);
  }
  return dead;
}

export function analyseLiveness(
  input: Omit<LivenessInput, "freeNames">,
): LivenessResult {
  const started = performance.now();
  const empty = (status: LivenessResult["status"], nodeCount = 0) => ({
    status,
    uses: [],
    deadBranches: [],
    namesAtEnd: new Map<string, Verdict>(),
    nodeCount,
    ms: performance.now() - started,
  });

  // A name could come from a file nobody read, so no verdict is safe (Sec.6.3).
  if (input.includesUnread) return empty("incomplete");

  try {
    const first = run(input);
    const { bdd, walk, domain } = first;
    const tokenText = (i: number): string => input.parse.tokens[i].text;

    const uses: LivenessResult["uses"] = [];
    for (const u of walk.uses) {
      if (bdd.isFalse(bdd.and(u.guard, domain))) continue;
      uses.push({
        token: u.token,
        name: u.name,
        verdict: verdictOf(bdd, domain, u.guard, u.def),
        definitionTokens: u.definitionTokens,
      });
    }

    const dead = deadBranches(bdd, domain, walk, tokenText);
    const classified: LivenessResult["deadBranches"] = [];
    if (dead.length > 0) {
      // Walk again with every switch as a free atom. A branch that is alive
      // there is dead only because a flag is always defined above, a switch
      // case. One still dead is a contradiction whatever the flags say.
      const second = run({ ...input, freeNames: walk.switches });
      const guards = new Map<number, BddNode>();
      for (const b of second.walk.branches) guards.set(b.keywordToken, b.guard);
      for (const b of dead) {
        const g = guards.get(b.keywordToken);
        const alive =
          g !== undefined &&
          !second.bdd.isFalse(second.bdd.and(g, second.domain));
        classified.push({
          keywordToken: b.keywordToken,
          kind: alive ? "switch" : "contradiction",
        });
      }
    }

    const namesAtEnd = new Map<string, Verdict>();
    for (const [name, def] of walk.endDefs)
      namesAtEnd.set(name, verdictOf(bdd, domain, bdd.TRUE, def));

    return {
      status: "complete",
      uses,
      deadBranches: classified,
      namesAtEnd,
      nodeCount: bdd.nodeCount,
      ms: performance.now() - started,
    };
  } catch (e) {
    if (e instanceof BddOverflow) return empty("overflow");
    throw e;
  }
}
