# Name liveness slice A brief, the engine and the measurement

**This is a work brief for one implementing session, not a design document.** The design is `docs/name-liveness-design.md` (rev 1, CREATION_PLAN A.4). Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself. The owner answered the design's questions on 2026-11-02, and Sec.1 below adds the decisions this brief makes.

Slice A builds the analysis that works out, for every `#const` a script reads, the condition under which it is defined, and measures it over 243 scripts. **It reports nothing in the editor.** No diagnostic, no setting, no hover. Those are slice B, briefed after this slice's numbers are in, since this slice's timing decides where slice B runs the analysis.

**Include resolution slice A (`docs/include-resolution-slice-a-brief.md`) must be built first.** This slice reads include files through its `src/parser/includeIndex.ts` and `src/editor/includeCache.ts`. If either is missing, stop and say so. Do not build a stand-in.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. This slice is mostly pure algorithm, so the comments are where a reader learns what a decision diagram is and why each rule holds. Name the concepts (a reduced ordered binary decision diagram, hash-consing, memoisation, a one-hot constraint) where they appear.
- Read the design in full before item 1, and `src/preview/generator/tokenFilter.ts`, whose control-word handling item 4 mirrors.
- Everything new lives in `src/parser/liveness/`, pure, with no React, Monaco or Tauri, the rule `src/parser/**` follows.
- Build the items in the order of Sec.3. Each item ends with its tests green before the next one starts. Run tests by exact path while working, the full `npm test` once at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-name-liveness-slice-a.txt` at the end.
- Stop and ask the owner when a rule here or in the design cannot be followed as written, when a fixture's expected answer in design Sec.8 comes out different, or on any trigger in Sec.4.

## 1. Decisions made for this brief

**D1. A use is a word inside an argument that names a script `#const`.** For each command, attribute and directive argument (a directive's arguments after its first, the name it defines), take every identifier in the argument's tokens with `/[A-Za-z_][A-Za-z0-9_]*/g`, so `(PLAYER_COUNT)` and `(A + B)` count. A use is an identifier that some `#const` in the script or its includes defines. Names that only `#define` sets are not value uses (design Sec.5.1).

**D2. Switches are found by name, before the walk.** A switch is a name with at least one definition (in the script or an include) whose guard is ⊤, meaning no `if` or `start_random` encloses it. The second walk for design Sec.6.1 treats every switch as a free atom. A dead branch from the first walk that is alive in the second is a switch case (slice B's RMS0323), and one dead in both is a contradiction (RMS0322).

**D3. A branch RMS0313 already reports is not a dead branch here.** In one `if` chain, a branch whose condition text equals an earlier condition text of the same chain is skipped, whatever the analysis says. Exact text comparison, as RMS0313 does.

**D4. Branches inside unreachable code are not reported.** A branch whose enclosing guard is already ⊥ is not a dead branch of its own. Only the outermost dead branch counts. Uses inside unreachable code are skipped too, neither live nor dead.

**D5. The label groups are data, and the size and player atoms are derived.** Sec.3 item 1 has the groups. `players = n` is the label `n_PLAYER_GAME` in category `playerCount`. `size = s` comes from the `mapSize` field of every `mapSize` label, so `TINY_MAP` and `MAPSIZE_TINY` both read `size = Tiny`.

## 2. Terms used below

- **BDD**, a reduced ordered binary decision diagram. A boolean formula stored as a graph in which every node tests one variable and has a low (false) and a high (true) child, built so that two equal formulas are always the same node. Equality and "is this impossible" are then one comparison.
- **Atom**, one BDD variable. Design Sec.4.1 lists the kinds.
- **D**, the domain constraint. The conjunction of every group constraint and every random block constraint, true exactly on the lobbies and rolls that can happen.
- **Guard**, the condition under which a token runs. **Def(n)**, the condition under which name n is defined at a point (design Sec.4.4).

## 3. What to build, in order

### Item 1. Label groups in the data

`reference/data/language.json` gains a top-level `labelGroups` array, and `predefinedLabels` entries gain an optional `group` string.

| `id`                                         | `cardinality` | Members                                       | `evidence`                                                    |
| -------------------------------------------- | ------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `gameMode`                                   | `atMostOne`   | every `gameMode` label                        | a lobby defines one, the scenario editor none (round CG's c7) |
| `startingAge`                                | `atMostOne`   | every `startingAge` label                     | the editor defines one (c7), a game lobby is unmeasured       |
| `startingResources`                          | `atMostOne`   | every `startingResources` label               | the same                                                      |
| `player1Team` to `player8Team`, eight groups | `atMostOne`   | `PLAYERn_TEAM0` to `PLAYERn_TEAM4` for that n | one seat, one team                                            |

No group for `teamCount`, `teamSize`, `lobbySetting`, `gameVersion`, or for `mapSize` and `playerCount`, which item 3 derives (D5). In `src/parser/language.ts`, add `export interface LabelGroup { id: string; cardinality: "exactlyOne" | "atMostOne"; evidence: string }`, `group?: string` on `PredefinedLabel`, and `labelGroups?: LabelGroup[]` on `LanguageData`. The schema (`reference/schemas/language.schema.json`) gains both fields, `cardinality` an enum of `exactlyOne` and `atMostOne`. `scripts/validate-reference-data.mjs` checks that every `group` names a declared group and every declared group has at least two members. Edit `language.json` with the Edit tool or a Node script that reads and writes JSON, then `npx prettier --write` it.

Gate. `npm run validate:reference` green, and each of its two new checks mutation tested once against a temporary bad copy.

### Item 2. The BDD

`src/parser/liveness/bdd.ts`.

```ts
export type BddNode = number; // 0 is false, 1 is true
export class BddOverflow extends Error {}
export class Bdd {
  constructor(maxNodes?: number); // default 200_000
  readonly FALSE: BddNode;
  readonly TRUE: BddNode;
  variable(index: number): BddNode;
  not(a: BddNode): BddNode;
  and(a: BddNode, b: BddNode): BddNode;
  or(a: BddNode, b: BddNode): BddNode;
  ite(f: BddNode, g: BddNode, h: BddNode): BddNode;
  /** a and not b is impossible. */
  implies(a: BddNode, b: BddNode): boolean;
  isFalse(a: BddNode): boolean;
  readonly nodeCount: number;
}
```

- Nodes in parallel typed arrays (`Int32Array` for variable, low, high), grown by doubling. A unique table (`Map<string, number>` keyed `var,low,high`) gives hash-consing, so a node is never created twice. A node whose low equals its high is never created, its child is returned.
- `ite` with a memo table keyed by `f,g,h`, cleared when it passes 1,000,000 entries. `and`, `or`, `not` are `ite` calls.
- Lower variable index sits nearer the root.
- Creating a node past `maxNodes` throws `BddOverflow`.

Tests, `src/parser/liveness/__tests__/bdd.test.ts`.

1. `and(x, not(x))` is `FALSE`, `or(x, not(x))` is `TRUE`.
2. Equal formulas built different ways are the same node, `and(or(a,b), or(a,c))` against `or(a, and(b,c))`.
3. A property test. For 300 random formulas over 5 variables (a fixed seed, `mulberry32` written in the test file), the BDD agrees with a truth table on all 32 assignments.
4. `implies` on three hand cases.
5. `BddOverflow` is thrown at a tiny `maxNodes`.

### Item 3. Atoms and D

`src/parser/liveness/atoms.ts`.

```ts
export class AtomTable {
  constructor(
    bdd: Bdd,
    labels: readonly PredefinedLabel[],
    groups: readonly LabelGroup[],
    mapSizes: readonly string[],
  );
  /** The node for a predefined label, a disjunction of size atoms, a player atom, or its own atom. */
  label(name: string): BddNode;
  /** A fresh atom for an unknown name, the same node every time for one name. */
  free(name: string): BddNode;
  /** Opens a start_random block. Returns its id. */
  openBlock(): number;
  /** An arm's node, or FALSE for an arm that can never be taken. chance is the literal, or undefined when it is not a literal number. */
  arm(block: number, chance: number | undefined): BddNode;
  closeBlock(block: number): void;
  /** D, the conjunction of every constraint so far. */
  domain(): BddNode;
}
```

- Variables are numbered in order of first use, the size atoms and player atoms first (created in the constructor), so the BDD tests them nearest the root.
- `size` is exactly one of the map sizes, `players` exactly one of 1 to 8. Encode exactly-one over k atoms as at-least-one (an `or`) and pairwise at-most-one (`not(and(a,b))` for each pair). At-most-one alone for an `atMostOne` group.
- The random block rule, design Sec.4.3. Keep the running total. Arm 1 is possible. Arm i > 1 is possible when its chance is above 0 and the total before it is below 99. An impossible arm returns `FALSE` and gets no atom. A non-literal chance makes this arm and every later one possible and marks the block not exhaustive. `closeBlock` adds at-most-one over the possible arms, and exactly-one when the block is exhaustive (total at least 99 and no non-literal chance).

Tests, `atoms.test.ts`, each checking `implies(domain(), …)` or `isFalse(and(domain(), …))`.

1. `TINY_MAP` and `MAPSIZE_TINY` are the same node.
2. Two different size labels cannot both hold.
3. Two arms at 50 and 50 cover everything (their `or` is implied by D).
4. Two arms at 25 and 25 do not.
5. A first arm at 0 is possible, a second arm at 0 is `FALSE`.
6. Arms at 99 then 1, the second is `FALSE`. At 98 then 1, it is possible.
7. A non-literal chance leaves the block not exhaustive.
8. Two `gameMode` labels cannot both hold, and neither may hold.

### Item 4. The walk

`src/parser/liveness/walk.ts`.

```ts
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
export function walkLiveness(
  bdd: Bdd,
  atoms: AtomTable,
  input: LivenessInput,
): WalkResult;
```

The walk reads **tokens** (non-trivia, in order), the way `tokenFilter.ts` does, so a conditional spanning a section header needs nothing special. It keeps a stack of frames and the current guard G (⊤ at the start).

- `if c` pushes a frame and evaluates Def(c) **once, at the `if`** (and at each `elseif` for its own condition). A branch runs under G of the frame, and the conjunction of the negations of every earlier condition in the chain, and its own condition. `else` runs under the negations only. A bare `elseif` (followed by a token that cannot be a label, the `structural` test in `tokenFilter.ts`) acts as `else`. `endif` pops.
- `start_random` calls `openBlock`. `percent_chance x` opens the next arm under G and `arm(block, literal or undefined)`. `end_random` calls `closeBlock` and pops.
- `#const n` and `#define n` record a definition of n with the current G, at this token. Skip the value tokens as `tokenFilter.ts` does.
- `#include_drs path` (assembled as `tokenFilter.ts` does) walks the include file's tokens with `includeParse(includeKey(path))` under the current G, with its own frame stack, and a cycle guard. A file not read contributes nothing.
- Every token records G. Every value use (D1) records its token, its name and G.
- **Def(n) at a point**, design Sec.4.4, in this order. A name in `freeNames` is `free(n)`. A builtin constant is ⊤. A predefined label is `label(n)` or'ed with every recorded definition of n so far. A name with no definition anywhere (script and includes) is `free(n)`. Otherwise the `or` of the guards of its definitions so far.
- **"Anywhere"** for the free rule needs every definition up front. Before the walk, collect the names defined in the script and its read includes (from `parse.symbols` and each include parse's `symbols`).

`WalkResult` holds, for each value use, `{ token, name, guard, def }` (two `BddNode`s), for each `if`/`elseif`/`else` branch `{ keywordToken, conditionToken?, chainIndex, guard, enclosingGuard }`, and the names defined with guard ⊤ (the switches of D2).

### Item 5. Classify

`src/parser/liveness/analyse.ts`.

```ts
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
export function analyseLiveness(
  input: Omit<LivenessInput, "freeNames">,
): LivenessResult;
```

- `includesUnread` true gives `status: "incomplete"` with empty lists, and the walk does not run (design Sec.6.3).
- A `BddOverflow` gives `status: "overflow"` with empty lists.
- A use with `isFalse(and(G, D))` is skipped (D4). Otherwise `dead` when `isFalse(and(G, D, def))`, `live` when `isFalse(and(G, D, not(def)))`, else `maybe`.
- A branch is dead when `isFalse(and(guard, D))` and not `isFalse(and(enclosingGuard, D))` (D4) and not an RMS0313 repeat (D3). Run the walk a second time with `freeNames` set to the first walk's switches, and mark each dead branch `switch` when its guard is satisfiable in the second walk, else `contradiction`. Only run the second walk when the first found a dead branch.
- `namesAtEnd` classifies Def(n) at the end under G = ⊤.
- `ms` is the wall time of the whole call, `performance.now()` before and after.

Also `src/parser/liveness/describe.ts`, `describeCondition(bdd, node, atomNames): string`, a short sum of products of atom names read from the BDD's paths to `TRUE`, cut at three products with "or more". The measure prints it beside each dead use. Slice B reuses it for messages. Test it on three formulas.

### Item 6. The fixtures

Copy seven files from `test-maps/rms-check/` into `src/parser/liveness/__tests__/fixtures/`. They are `liveness_test.rms`, `liveness_test.inc`, `back_prop.rms`, `unified_random_else.rms`, `unified_random_else2.rms`, `unified_multiple_def.rms` and `test_check_dead_paths.rms`. The design's table lists six scripts, and `liveness_test.inc` is the file `liveness_test.rms` includes. Each copy starts with this header, then a blank line, then the file unchanged.

```
/* From rms-check by Divy1211 (github.com/Divy1211/rms-check), GPL-3.0,
   test_rms folder, copied 2026-11 for Age of RMS's liveness tests. */
```

`fixtures.test.ts` parses each with the same options the parser worker uses, supplies `liveness_test.inc` through `includeParse`, and asserts design Sec.8's expected answer for every row, with `namesAtEnd` for the per-name rows and `uses` and `deadBranches` for the rest. Read the table's expected answers as the spec. If one comes out different, stop and ask, never edit the expectation to match.

Then add a line to `README.md`'s thanks crediting rms-check by Divy1211 for the liveness model and the test scripts, in the style of the genie-rms line.

### Item 7. The measurement

`src/parser/liveness/__tests__/liveness.measure.test.ts`, with its own config `vitest.liveness.config.ts` copied from `vitest.measure.config.ts` (its `include` narrowed to this file), a `package.json` script `"measure:liveness": "vitest run --config vitest.liveness.config.ts --disableConsoleIntercept"`, and an entry in `vitest.config.ts`'s `exclude` so `npm test` never runs it.

Over the 243 scripts of design Sec.5.2 (`test-maps/*.rms`, `test-maps/local/*.rms`, and every `*.rms` in the install's `gamedata_x2`, skipping DE's maps with a printed note when the install is absent), with include files read from the install through `loadIncludeFiles` and parsed once each.

For each script print one line, with the name, status, the counts of live, dead and maybe uses, contradiction and switch dead branches, node count and ms. After the table print totals, then every dead use (file, line, name, `describeCondition` of its definitions) and every contradiction branch (file, line).

Run it twice and keep the second run's times, so the first run's cold start does not count.

## 4. Stop and ask the owner when

- Any one script has more than **500** maybe uses. The owner chose to show them as visible info and wants to see what that looks like first (design Sec.11).
- Any script takes more than **50 ms** in the second run (design Sec.7), or overflows.
- A design Sec.8 fixture answer comes out different.
- The total of dead uses is above **200**. Each will need a verdict in slice B, and a count that size means the model is wrong somewhere, not that the corpus is full of bugs.

When none of these trips, finish the slice. Put the measure's totals, the slowest five scripts with their times, and the full lists of dead uses and contradiction branches in the build log entry, and stop there. Slice B is briefed from them.

## 5. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green. `npm run measure:liveness` runs to the end.
- Mutation tested once each, then restored exactly. The DE roll rule (make a first arm at 0 impossible, atoms test 5 goes red), exhaustive at 99 (make it 100, atoms test 6 goes red), the free atom for unknown names (make it `FALSE`, the `test_check_dead_paths` fixture's `if B` goes red), and D3 (drop it, `unified_multiple_def`'s repeated `MAPSIZE_INCREDIBLE` shows up as a dead branch).
- `docs/build-log.md` gains the entry Sec.4 describes, and `CLAUDE.md`'s test table a row.
- `docs/name-liveness-design.md` gets one line under its rev line, "Slice A built <date>", nothing else.
