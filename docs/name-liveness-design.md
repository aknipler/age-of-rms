# Name Liveness (CREATION_PLAN A.4, rev 1)

Rev 1, 2026-11-02. Design only, nothing built. Opus wrote it. The owner answered Sec.11's questions the same day, so the severities are settled. Slice A is a measurement that stops for the owner only on the triggers in Sec.9.

Slice A built 2026-11-03.

Slice B brief 2026-11-04, `docs/name-liveness-slice-b-brief.md`. The owner chose the second pass, a cap of 1,000,000 nodes and slice A's two deviations the same day.

Slice B built 2026-11-04.

## 1. What this is for

A `#const` defined in one branch and read where that branch may not have run is a real bug that the editor cannot see today. RMS0303 asks whether a definition sits above the use, and RMS0202 whether one exists anywhere. Neither asks **under what conditions** it runs. So this passes every check and fails in the game on half its seeds.

```
start_random
  percent_chance 50 #const FOREST_SIZE 40
end_random
create_terrain FOREST { number_of_tiles FOREST_SIZE }
```

The obvious fix was tried and refused. parser-design Sec.8 asked for an info note on any name whose only definitions sit inside a branch, and it fired 6,404 times over 57 maps (`validate.ts`, `checkCondition`), because "set a flag in one branch, read it later" is ordinary RMS. **That is the bar this design has to clear.** A note that cannot tell a bug from a branch that correctly did not run is noise.

Liveness is the precise version. It tracks, for each name, the condition under which it is defined, and for each use, the condition under which that line runs. A use is then **definitely live** (whenever the line runs, the name is defined), **definitely dead** (whenever the line runs, it is not) or **maybe live** (neither).

**Goals.**

1. Report a value use of a script `#const` that is definitely dead. That is positive evidence, every definition sits on a path that excludes the use.
2. Report a branch that can never run, generalising RMS0313 (an `elseif` repeating its chain's condition) to any contradiction.
3. Report the maybe-live class as visible info (owner, 2026-11-02), after slice A has measured how many it marks.
4. Fit the per-keystroke budget, or move to a slower pass that does (Sec.7).

**Non-goals.** Value analysis (which number a `#const` holds), the preview (it already knows the one live path for its lobby), and RMS0300's typo check (it asks whether a name exists, not when).

## 2. The source

**rms-check**, by Divy1211, v0.1.5, Rust, GPL-3.0, `github.com/Divy1211/rms-check`. Its liveness analysis is specified at `divy1211.github.io/rms-check/static/rms_liveness/` (still online 2026-11-02, the only page of that site with content). It is the model this design adopts, with the DE corrections of Sec.3.

The model in short. Liveness is a set of `(name, guard)` pairs, where a guard is a proposition. `#const` and `#define` join `(name, G)` into the set under the current guard `G`. An `if` chain runs each branch under `G` and its condition, with every earlier condition negated, and `else` under all the negations. A `start_random` arm runs under `G ∧ P(k, i)`, the proposition that block k took arm i. `#include_drs` analyses the file under `G`. `#includeXS`, section headers and commands change nothing. Its two worked examples are the shape of everything below. Two 50% arms that both define A make A always defined. A second block testing names the first block set simplifies only through the lemma that a block's arms are exclusive.

**Its test maps.** Eleven files, untracked at `test-maps/rms-check/`, wired into the tier-1 corpus gate. Each is one case, and Sec.8 turns them into this design's unit fixtures with the expected result under our model.

**Its `grouped_symbols.def`** is at `RMS/grouped_symbols.def`. It writes the engine's labels as `start_random` blocks so that "exactly one map size" falls out of the arm lemmas. It is rms-check's own construction, not a DE file (checked 2026-08-29), and its percentages are invented. The idea is kept and the file is not (Sec.4.2).

## 3. Where DE differs from rms-check

rms-check's probability rules are written for a roll from 1 to 100. DE's was measured (preview-design Sec.3 rule 3, `p6-range`, 2026-10-10). The roll is `bounded(100)`, 0 to 99, and the first arm whose running total of chances is at least the roll is taken.

| rms-check                             | DE, measured                                                                                                                                   | Consequence here                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `P(k, n, 0) = ⊥`, a 0% arm never runs | The **first** arm wins a roll of 0, so a first arm at 0% runs 1 time in 100                                                                    | A first arm is always possible. A later arm at 0% is impossible |
| Arms covering 100% join to ⊤          | A total of **99** already covers every roll                                                                                                    | Exhaustive at 99                                                |
|                                       | An arm after the running total reached 99 can never be taken                                                                                   | Impossible, like a later 0% arm                                 |
| A name not in the set has guard ⊥     | CLAUDE.md's positive-resolver rule. DE-official maps test `MAPSIZE_ABOVE_GIANT`, `NOMAD_START`, `THEME_*` and more that are in no data we hold | An unknown name is a **free atom**, possibly defined. Never ⊥   |

Measured facts rms-check also assumes, confirmed. Conditional state crosses section headers (parser-design Sec.11 item 8, `Continental.rms`). A dead block is never rolled and its `#include_drs` reads nothing (preview-design Sec.3). Nested `start_random` resolves as written (parser-design item 20). `#undefine` does nothing (parser-design Sec.7). And one fact from the A.2 measurement (`docs/token-alias-design.md` Sec.3.2). A constant whose value equals a control word does not act as one in dead code, so the token stream's conditionals are exactly the ones written.

## 4. The model

### 4.1 Atoms

| Atom                                              | Meaning                                                                           | Constraint                      |
| ------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------- |
| `size = s`, one per map size                      | The lobby's size                                                                  | Exactly one size                |
| `players = n`, 1 to 8                             | The lobby's player count                                                          | Exactly one                     |
| A label from `predefinedLabels` outside those two | That label is defined                                                             | Its group's constraint, Sec.4.2 |
| A free atom per unknown name                      | A name no data knows and the script never defines, possibly defined by the engine | None                            |
| `arm(k, i)`                                       | Block k took arm i                                                                | Sec.4.3                         |

A label tied to a size is a disjunction of size atoms, read from `predefinedLabels` (`category: "mapSize"`, `mapSize` field), the same data the preview's label environment uses. `TINY_MAP` and `MAPSIZE_TINY` both become `size = Tiny`, so exclusivity and implication between the legacy and new names come out of the data with nothing written by hand. `N_PLAYER_GAME` is `players = N`.

Amended 2026-11-04. Size atoms are keyed by the label's `dimensions`, since `mapSize` is absent on the seven sizes Generation Settings does not offer (slice B brief B3).

### 4.2 Label groups

The other categories need a cardinality, and only a measured one may be stronger than "none". A weaker constraint only turns a definite answer into a maybe, so unmeasured groups take the weaker one.

| Category                                               | Constraint                               | Evidence                                                            |
| ------------------------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| `mapSize`                                              | Exactly one size, through the size atoms | Every lobby has one size                                            |
| `playerCount`                                          | Exactly one count                        | Every lobby has one, and the editor defines it (round CG's c7)      |
| `gameMode`                                             | At most one                              | A lobby defines one, the editor none (c7)                           |
| `startingAge`, `startingResources`                     | At most one                              | The editor defines one of each (c7), a game lobby unmeasured        |
| `playerInTeam`                                         | At most one team per player              | One seat, one team                                                  |
| `teamCount`, `teamSize`, `lobbySetting`, `gameVersion` | None                                     | Independent flags, or derived from teams in ways not worth encoding |

This needs a new field. `language.json` gains `labelGroups`, an array of `{ id, cardinality: "exactlyOne" | "atMostOne", evidence }`, and each `predefinedLabels` entry an optional `group`. `validate:reference` checks every `group` names a declared group. The size and player-count groups are derived from the existing fields and need no `group`.

### 4.3 Random blocks

For block k with arms 1 to n and literal chances c₁ to cₙ, running totals Tᵢ.

- Arm 1 is possible. Arm i > 1 is possible when cᵢ > 0 and Tᵢ₋₁ < 99. An impossible arm's atom is ⊥.
- The possible arms are at most one. They are exactly one when Tₙ ≥ 99.
- A chance that is not a literal number (a name, an `rnd()`, a math expression) makes that arm and every later arm possible and the block not exhaustive. Literal is the corpus's case. The weaker reading is the safe direction.

### 4.4 What a name's condition is

`Def(n)`, the condition under which `n` is defined at a point in the file, is

- **⊤** for an engine constant (`game-constants.json`, the same set as `ParseOptions.builtinConstants`),
- else **its label atom or atoms** for a predefined label, **or'ed with** every script definition above the point,
- else **a free atom** for a name no data knows and the script never defines,
- else **the script's definitions above the point**, joined. A name the script itself defines is taken to be the script's alone, the one place this design reads a miss in our data as an answer. Sec.10 states it as a risk.

### 4.5 The walk

The analysis walks **tokens**, not the AST, the way `tokenFilter.ts` does. A conditional that spans a section header leaves the parser a raw region (RMS0110), and a token walk reads it like any other. The AST supplies one thing, which token indices are value uses (Sec.5.1).

- The current guard `G` starts at ⊤.
- `#const n`, `#define n` join `G` into `L[n]`.
- `if c` pushes a frame. The branch runs under `G ∧ Def(c)`, and each `elseif c'` under `G ∧ ¬Def(c) ∧ … ∧ Def(c')`, `else` under all the negations. `Def(c)` is read **at the `if`**, so a `#define` inside the branch does not change its own condition.
- `start_random` allocates block k. `percent_chance` opens arm i under `G ∧ arm(k, i)`. `end_random` and `endif` pop.
- A bare `elseif` acts as `else` (preview-design Sec.3 rule 2, rev 11), so the walk reads it the same way.
- `#include_drs` walks the included file's tokens under `G`, with A.1's index supplying them (`docs/include-resolution-design.md`). A file not read contributes nothing, and its directive marks the script **incomplete** (Sec.6.3).

Every token records the guard it runs under. Every definition records its guard. The set `L` at a use is the join of the definitions above it.

### 4.6 The engine

Guards are reduced ordered binary decision diagrams (BDDs), a canonical form for boolean functions in which two equivalent formulas are the same node. So implication is one operation and an equality test, `G ∧ D ∧ ¬Def(n) = ⊥`, where `D` is the conjunction of every constraint from Sec.4.2 and 4.3.

- A small in-house implementation in `src/parser/liveness/bdd.ts`, about 300 lines. A node table with hash-consing, an `ite` operation with a memo table, `and`, `or`, `not`, and `isFalse`. No dependency, since the npm packages for this are unmaintained or large.
- Variable order by first appearance in the file, the size and player atoms first. Order is the main cost knob, and first appearance keeps the variables a chain tests next to each other.
- A cap of 200,000 nodes per file. Past it the analysis stops for that file and reports nothing, never a partial answer.

Amended 2026-11-04. The cap is 1,000,000, measured in slice B brief B2. A script that reaches it says so in the status bar.

**Why not the cheaper options.** A syntactic check (a use is live when some definition's guard is a subset of the use's) is what `validate.ts` already does for RMS0314, and the measurement in Sec.5.2 shows it leaves 21,670 uses unresolved. Full SAT is more than the formulas need. Guards here are short conjunctions joined by chains, and a BDD is exact on them and simple to write.

## 5. Measured, 2026-11-02

### 5.1 What counts as a use

A **value use** is a word token in an argument slot of a command, attribute or `#const` value that names a `#const` the script defines. A **condition use** is an `if` or `elseif` condition. Only value uses can be "used while undefined" bugs. A condition on an undefined name is how RMS branches, and that is what made the old note fire 6,404 times.

### 5.2 How far cheaper rules get

A throwaway probe walked the 243 scripts of A.1's measurement (44 corpus, 19 local, DE's 180) with `validate.ts`'s guard literals, run by exact path and deleted.

| Rule, applied in order                                                            | Value uses it settles | Left                     |
| --------------------------------------------------------------------------------- | --------------------- | ------------------------ |
| All value uses of script `#const` names                                           |                       | 107,635                  |
| Some definition above has a guard contained in the use's (same or enclosing path) | 62,353                | 45,282                   |
| Definitions in every branch of a chain that ends in `else`                        | 6,496                 | 38,786                   |
| Definitions in every arm of one block whose chances reach 99                      | 16                    | 38,770                   |
| Defined only below the use (RMS0303's)                                            | 2                     | 38,768                   |
| A flag the script `#define`s unconditionally above, read as true                  | 17,098                | **21,670 in 79 scripts** |

The 21,670 need the full model. The probe's samples are the shapes Sec.4 handles. `24hr_Blind Valley.rms` defines every theme constant inside `if WINTER_MAP … elseif TROPICAL_MAP … elseif ASIAN_MAP`, where those three flags come from a `start_random` at 100, 0 and 0. Under DE's roll rule arm 1 always runs and arms 2 and 3 never, so the branch with the definitions always runs. Every rule above misses it, and the BDD gets it exactly.

**Not yet measured, and slice A's job.** How many uses the full model calls definitely dead, how many stay maybe, and how many branches it calls dead. The severities are settled (Sec.11), so these numbers check the design rather than choose it, and Sec.9 says which of them stop the build.

## 6. What the editor reports

### 6.1 New diagnostics

| Code    | Severity                | When                                                                                                         | Message shape                                                                                             |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| RMS0320 | warning                 | A value use is definitely dead, and the name has at least one script definition (no definition is RMS0202's) | "FOREST_SIZE is only defined when TINY_MAP, and this line runs when it is not."                           |
| RMS0321 | info, always shown      | A value use is maybe live                                                                                    | "FOREST_SIZE is only defined in one arm of the start_random on line 12, so this line can run without it." |
| RMS0322 | info                    | A branch's guard is ⊥ under `D` whatever the script's switches say, and RMS0313 does not already report it   | "This branch never runs, because it needs TINY_MAP inside a branch that needs HUGE_MAP."                  |
| RMS0323 | info, can be turned off | A branch is dead only because of a switch (below), so RMS0322 does not report it                             | "This branch never runs, because DEBUG_MODE is always defined above (line 3)."                            |

The message names the condition, read from the BDD as a short sum of products of label and arm names, cut at three terms with "or more". Explaining _why_ is what separates this from the refused note.

**Where the mark goes.** On the use, the name's token in the line that reads it (`FOREST_SIZE` in `number_of_tiles FOREST_SIZE`), never on the definition, which is not wrong by itself. A name read in several places gets one mark per read, the rule A.1 settled for RMS0202. RMS0322 and RMS0323 mark the branch's keyword (`else`, `elseif`, or the `if` and its condition).

**A link to the definitions (owner, 2026-11-02).** RMS0320 and RMS0321 carry the line or lines that define the name, and the hover over the mark shows each as a link that moves the caret there. `Diagnostic` gains `related?: { span: Span; message: string }[]`, which the Code tab hands to Monaco as the marker's `relatedInformation`. Breakdown's problem badge shows the same links. No second mark is drawn on the definition.

**Switches (owner, 2026-11-02).** A switch is a name the file `#define`s or `#const`s with no guard at all, such as `#define DEBUG_MODE` on line 3, which an author sets to turn whole parts of the map on or off. A dead branch is RMS0323 instead of RMS0322 when it would be alive if every switch were a free atom (the walk is run a second time with switch definitions left out, only for the branches the first run found dead, so the cost is small). Both are shown by default. RMS0323 is `dismissible`, and Settings > Diagnostics gains a checkbox, "Report branches a switch turns off", on by default, bound to the same per-code state that "Don't show me this again" writes (`DiagnosticDismissalContext`), so the hover button and the checkbox can never disagree. The checkbox gets a `HelpTip` and a `ui-help.json` entry, "Shows a note on each branch that never runs because a flag like DEBUG_MODE is always defined at the top of the script. Turn it off if you use such flags on purpose."

### 6.2 What stays

RMS0303 stays positional, since "defined below the use" is its own message with its own fix. RMS0202 keeps the case of a name never defined at all. RMS0313 keeps its exact case and RMS0322 and RMS0323 skip those branches, so one dead branch gets one diagnostic.

### 6.3 When the analysis says nothing

- The node cap was reached.
- The script has an `#include_drs` that was not read (A.1's `includesUnread`). A missing definition there could be in the file nobody read, the same reason A.1 keeps softening.
- A use inside a raw region with no AST role (Sec.4.5). Its guard is still known, so definitions there still count.

### 6.4 The name lookup

Hover on a `#const` gains a line, "Defined when TINY_MAP or SMALL_MAP", from the same BDD, when the condition is not ⊤. It shows what a branch-only definition depends on without any warning. Slice C, optional.

## 7. Cost

`Stranded.rms`, the slowest DE script, takes 162 ms to parse and validate today. The analysis budget is **50 ms on the slowest corpus script**, measured in slice A with a relative benchmark like `corpus.test.ts`'s Vanguard gate (price a token on today's machine, require the analysis within a multiple of it), since this machine's wall clock varies by 6× under load.

If slice A misses the budget, the analysis moves out of `validate` into a second pass the parser worker runs after it posts the parse result, debounced like the preview, and its diagnostics arrive as their own message (`ParseDiagnosticsMessage` already exists for the early diagnostics). The design allows either, and slice A's number picks.

Settled 2026-11-04. Slice A missed the budget, so the analysis is the second pass.

## 8. Unit fixtures from rms-check

rms-check is GPL-3.0, the same licence as this repo, so its test maps may be copied in with credit. Slice A copies the six below into `src/parser/__tests__/fixtures/liveness/`, each with a header comment naming rms-check, its author and its licence, and asserts this design's answers. Where ours differs from what rms-check's model would say, the row says why.

| File                        | Case                                                                                                                  | Expected under this model                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `liveness_test.rms` A       | Two 50% arms both define A                                                                                            | A ⊤ (total 100 ≥ 99)                                                                                                                                                                                                                                                                                 |
| `liveness_test.rms` D       | Two 25% arms both define D                                                                                            | Maybe (total 50), same as rms-check                                                                                                                                                                                                                                                                  |
| `liveness_test.rms` E, F    | `if A #define E`, then `if E #define F`                                                                               | E and F ⊤, through A                                                                                                                                                                                                                                                                                 |
| `liveness_test.rms` H, I    | `if H #const I`, then `if I #const H`                                                                                 | Both never defined. `if H` sits above H's only definition, so `Def(H)` is ⊥ there, and both branches are dead, RMS0322 twice                                                                                                                                                                         |
| `liveness_test.rms` K, L    | B and C from two exclusive arms of an exhaustive block, K defined under `if B … elseif C`, L under two separate `if`s | K and L ⊤                                                                                                                                                                                                                                                                                            |
| `liveness_test.rms` M, N    | Defined under all eight `N_PLAYER_GAME`, as one chain and as eight `if`s                                              | M and N ⊤, through the player-count group. rms-check needs its invented prelude for this, ours comes from the data                                                                                                                                                                                   |
| `unified_random_else.rms`   | `ISLAND_COUNT (PLAYER_COUNT)` under `else` of `if 2_PLAYER_GAME`, `PLAYER_COUNT` from an eight-count chain            | Live                                                                                                                                                                                                                                                                                                 |
| `unified_random_else2.rms`  | `WATER_MASK` from arm 1, used under `else` of `if NO_GREEN_MASKING` from arm 2 of the same 50/50 block                | Live, the arms are exclusive and exhaustive                                                                                                                                                                                                                                                          |
| `unified_multiple_def.rms`  | `if MAPSIZE_MINI #define MAPSIZE_TINY`, then a 14-size chain defining `LENGTH`, used by `override_map_size (LENGTH)`  | Live, the chain covers every size. The repeated `MAPSIZE_INCREDIBLE` is RMS0313's, not RMS0322's. The last branch, `elseif MAPSIZE_MINI`, is dead, RMS0322. On a Mini map the script has already defined `MAPSIZE_TINY`, so the `MAPSIZE_TINY` branch above it is taken first, which is what DE does |
| `test_check_dead_paths.rms` | `if B` with B unknown, then `#define A` and `if A … else`                                                             | `if B` not dead (B is free). The `else` is dead because `A` is a switch, RMS0323                                                                                                                                                                                                                     |
| `back_prop.rms`             | Flags set in a 50/50 block, `HARE_MIX_SUMMER` defined under one of them and tested in a later section                 | Nothing to report. `create_object_group HARE` names a group rather than reading `HARE`, so there is no value use, and no branch is dead                                                                                                                                                              |

## 9. Slices

**Slice A, the engine and the measurement.** `bdd.ts` with its own tests, `labelGroups` in `language.json` with its schema and `validate:reference`, the token walk in `src/parser/liveness/walk.ts`, and the fixtures of Sec.8 as unit tests. Then `liveness.measure.test.ts` over the 243 scripts (its own vitest config, skipped without an install for DE's maps), printing per script the definitely-dead uses, the maybe-live uses, the dead branches split into RMS0322 and RMS0323, and the analysis time, and every definitely-dead use with its file and line. The six rms-check fixtures are copied with their credit headers, and the README's thanks gains a line for rms-check and its author. **No diagnostics.** The severities are already settled (Sec.11), so slice A does not wait on the owner, except as below. Stop and ask the owner when any one script would get more than 500 RMS0321 marks, so they see what "always shown" means on that map before it ships, or when the analysis time misses Sec.7's budget.

**Slice B, the diagnostics.** RMS0320, RMS0321 (info, always shown), RMS0322 and RMS0323, wired into `validate` or the second pass per Sec.7. `Diagnostic.related` with the Code tab's `relatedInformation` and Breakdown's badge links. RMS0323 `dismissible`, and the Settings > Diagnostics checkbox with its `HelpTip` and `ui-help.json` entry. Every definitely-dead site on the corpus is read and given a verdict in the measure test, as RMS0304's were. A false positive with no rule that removes it stops the slice. A run sheet section covers the marks, the links and the checkbox in the real app.

**Slice C, the hover line.** Optional, after B.

Depends on A.1 slice A for the include files' tokens. Without it, scripts with includes are "incomplete" and the analysis says nothing on them (Sec.6.3), which is most of DE's maps.

## 10. Risks

- **A name the script defines is read as the script's alone** (Sec.4.4). If DE defined such a name too, RMS0320 could report a use DE would accept. The cheap guard against it is RMS0320's own condition, it needs every definition to exclude the use, and an engine-defined name would normally be used without the author defining it at all.
- **The size atoms come from the data.** A size label the data lacks (`MAPSIZE_ABOVE_GIANT`) is a free atom, so a chain testing it never counts as exhaustive. That only weakens answers.
- **The editor's lobby is not a game lobby.** `D` describes every lobby, not the one in Generation Settings, so nothing here changes with the settings. That is deliberate, a diagnostic that came and went with the player count would be unreadable.

## 11. Questions for the owner

All answered by the owner on 2026-11-02. No questions remain open.

1. **RMS0321, the maybe class.** **Answered, visible info, always shown**, a blue underline on the use. Slice A still counts it and stops at more than 500 on one script (Sec.9).
2. **Dead branches that are switches.** **Answered, shown, with a setting to turn them off.** They get their own code, RMS0323, so Settings > Diagnostics can switch them off without touching contradictions (Sec.6.1).
3. **Copying rms-check's six test maps.** **Answered, yes, with credit** in each file's header and in the README's thanks.
4. **A link from the mark to the definition**, raised by the owner's question of where the mark goes. **Answered, yes.** The mark sits on the use only, and its hover links to each definition (Sec.6.1).
