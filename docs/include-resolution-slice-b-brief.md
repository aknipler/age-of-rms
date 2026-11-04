# Include resolution slice B brief, the two quieting rules and the measured gate

**This is a work brief for one implementing session, not a design document.** The design is `docs/include-resolution-design.md` (rev 1, CREATION_PLAN A.1), Sec.3, 4.5 and 5 in particular. Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself.

Slice A (built 2026-11-02, `docs/build-log.md`) lifted the include softening, so a script whose include files were read now gets real warnings. Slice B adds the design's two rules that keep the false ones quiet, then pins every remaining warning on the corpus with a verdict, so the count cannot drift unnoticed. It does not touch the name lookup, autocomplete or hover (slice C).

**Slice A must be in the tree.** It added `src/parser/includeIndex.ts`, `src/editor/includeCache.ts`, `ParseOptions.externalSymbols` and `includesUnread`, and `validate`'s `resolvedIncludes`. If any is missing, stop and say so.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. The Hard rules apply, especially the positive-resolver rule (both rules here only ever stop a report, never start one), no tree-restoring git commands, and `npm run format` at the end.
- Read the design's Sec.3 and 4.5, and slice A's build log entry, before item 1.
- Build the items in the order of Sec.2. Each item ends with its tests green before the next one starts. Run tests by exact path while working, the full `npm test` once at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-include-resolution-slice-b.txt` at the end.
- Stop and ask the owner when a rule here or in the design cannot be followed as written, when an existing test changes for a reason this brief does not name, or on any trigger in Sec.3.

## 1. Decisions made for this brief

**D1. Rule 1 lives in the parser.** RMS0202 is raised inside `parseRms` (`d.unresolvedConstantInNumericSlot` in `src/parser/parser.ts`), not in `validate`, so the rule goes where the warning is made. The parser's open frames (`this.frames`) already hold each open `IfFrame` with its `IfNode`, whose last branch is the one being parsed, so no guard stack has to be added.

**D2. Rule 1 reads only the current branch's own condition.** A use is self-guarded when some open `if` frame's current branch (the last of `node.branches`) has a condition token whose text equals the name. An `else` branch has no condition, and an earlier branch's condition is a negation by the time a later branch runs, so neither counts. `start_random` frames never count.

**D3. Rule 2 has two clauses** (design Sec.4.5 as amended 2026-11-02). A suggestion is dropped when the two names are family siblings.

1. Digits. Stripping every run of digits from both gives equal strings (`9_PLAYER_GAME` and `8_PLAYER_GAME`, `BR_CENTRAL_25` and `BR_CENTRAL_24`, `CONFIG_RIVER_A8` and `CONFIG_RIVER_A4`).
2. Lettered slots. Split on `_`, both have the same number of parts, exactly one part differs, and both differing parts are one letter (`PREDATOR_A_POLAR_BEAR` and `PREDATOR_B_POLAR_BEAR`).

It applies to RMS0300 in every script, includes or not (owner, design Sec.8 Q1). It does not apply to the name lookup's did-you-mean, which offers a fix rather than claiming a typo.

**D4. The gate is its own command.** `npm run measure:includes`, with its own vitest config, excluded from `npm test`, skipping DE's maps when the install is absent. The same pattern as `measure:checker`.

## 2. What to build, in order

### Item 1. Rule 1, a use under its own name's `if`

In `src/parser/parser.ts`, add a private method beside `conditionalDepth()`:

```ts
/** D2. True when an open if's current branch tests `name` itself, so this line only runs when the name is defined. */
private guardedByOwnName(name: string): boolean;
```

It walks `this.frames`. For each frame of type `"if"`, it takes the last branch of `frame.node.branches`, and returns true when that branch has a `condition` and `this.tokens[condition].text === name`. At the RMS0202 site, before building the diagnostic, skip the whole else-branch (no diagnostic, no `unresolvedNumericUses` entry) when `this.guardedByOwnName(tok.text)`. Comment it with the design's reason and the 14 sites it covers.

Tests, in the parser test file that already covers RMS0202 (`src/parser/__tests__/parser.test.ts`).

1. `<OBJECTS_GENERATION> create_object RELIC { if RELIC_CAA_A avoid_actor_area RELIC_CAA_A endif }` gives no RMS0202.
2. The same with `if RELIC_CAA_A … else avoid_actor_area RELIC_CAA_A endif` gives RMS0202 (the use is in the `else`).
3. `if OTHER avoid_actor_area RELIC_CAA_A endif` gives RMS0202.
4. Nested, `if RELIC_CAA_A if OTHER avoid_actor_area RELIC_CAA_A endif endif` gives none.
5. `if A … elseif RELIC_CAA_A avoid_actor_area RELIC_CAA_A endif` gives none (the current branch is the `elseif`).

### Item 2. Rule 2, family siblings

In `src/parser/validate.ts`, add and export a pure function:

```ts
/** D3. True when two names are members of one numbered or lettered family, so one is not a typo of the other. */
export function isFamilySibling(a: string, b: string): boolean;
```

In `checkCondition`, after `nearestKnownName` returns a suggestion, return without a diagnostic when `isFamilySibling(token.text, suggestion)`. Comment it with the design reference and the sites it covers (195 numbered, Rage Forest's 2 lettered, AK_Namatjira's 2).

Tests, in `src/parser/__tests__/validate.test.ts`.

1. `isFamilySibling` is true for the four pairs in D3, and for `A_X` and `B_X`.
2. It is false for `REGICIDE` and `REGICIDES`, `TINY_MAP` and `TINY_MAPS`, `MAP_SIZE` and `MAPSIZE`, `ABC_1` and `ABD_1`, and `PLAYER_AA` and `PLAYER_AB` (a two-letter part is a word, not a slot).
3. A script with `#define BR_CENTRAL_24` and `if BR_CENTRAL_25` gets no RMS0300.
4. A real one-letter typo of a script label still gets RMS0300. Reuse a pair an existing RMS0300 test in that file already uses, so this test and the old one agree.

Expected changes elsewhere. RMS0300 disappears from `AK_Namatjira.rms`. If an existing test pins RMS0300 there (search with `grep -rn RMS0300 src --include=*.test.ts`), update its expected count and say why in the test's comment. Any other test changing is a stop.

### Item 3. The measured gate

`src/parser/__tests__/includeResolution.measure.test.ts`, with `vitest.includes.config.ts` copied from `vitest.measure.config.ts` (its `include` narrowed to this file, its header comment rewritten for this gate), a `package.json` script `"measure:includes": "vitest run --config vitest.includes.config.ts --disableConsoleIntercept"`, and an entry in `vitest.config.ts`'s `exclude`.

It reads the 243 scripts of the design's Sec.3 (`test-maps/*.rms`, `test-maps/local/*.rms`, and every `*.rms` in the install's `gamedata_x2`), reads include files from the install through `loadIncludeFiles`, and parses and validates each script exactly as the parser worker does. Build the worker's options through `src/editor/includeCache.ts` (`receiveIncludes`, `parseOptionsFor`, `indexFor`), never by hand, so the gate tests the code the app runs. When the install is absent, the DE half is skipped with a printed note and the corpus half still runs.

It asserts, in this order.

1. No diagnostic carries the include sentence ("It may come from an include file"). Expected **0**.
2. `Stranded.rms` has **1,887** RMS0202 warnings, every one on `FOREST_IDENTIFICATION`.
3. Every RMS0202 warning on a script that uses an `#include_drs`, other than `Stranded.rms`, equals a list pinned in the test file, one row per site with the file, line, name and a one-sentence verdict. Slice A counted 71 before Rule 1. Expect about 57 after it. Write the real list.
4. RMS0300 warnings across all 243 scripts, expected **0**.

To write the pinned list, read each site in its script. A verdict is "true positive" with the reason (for example, `Pa_Site_v1.1.rms` reads `GOLD_SECONDARY_CAA_A` that no file defines, copied from `starting_resources.inc` without its `if`). See Sec.3 for when a verdict stops the slice.

Also print, not assert, the same counts for the scripts with no include, so a reader sees the whole picture.

### Item 4. Documents

- `docs/parser-design.md`, the RMS0300 row of the diagnostic table (Sec.10) and the RMS0202 row each gain one sentence for its rule, written to the project's language rules.
- `docs/include-resolution-design.md`, one line under its rev line, "Slice B built <date>".
- `docs/manual-test-run-sheet.md` gains a section. Open DE's `BR_BattleontheIce.rms` (from the install's `gamedata_x2`) and confirm no warning on `9_PLAYER_GAME`. Open `test-maps/Rage Forest 2026.rms` and confirm none on `PREDATOR_A_POLAR_BEAR`. Open `test-maps/Pa_Site_v1.1.rms` and confirm the 30 `*_CAA_*` names still warn.

## 3. Stop and ask the owner when

- A pinned RMS0202 site's honest verdict is "false positive", and neither rule covers it. Do not invent a third rule.
- RMS0300 is not 0 after item 2. List the survivors and ask.
- Item 3's first or second assertion fails.
- The gate takes longer than 10 minutes on a second run.

## 4. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green, and `npm run measure:includes` passes.
- Mutation tested once each, then restored exactly. Make `guardedByOwnName` also accept an `else` branch (item 1 test 2 goes red). Drop D3's lettered clause (item 2 test 1's `PREDATOR` pair goes red). Make `isFamilySibling` compare without stripping digits (the gate's RMS0300 count goes above 0).
- `docs/build-log.md` gains an entry with the gate's final counts and the pinned list's size, and `CLAUDE.md`'s test table a row.
