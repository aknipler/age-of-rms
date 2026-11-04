# Include Resolution for the Editor (CREATION_PLAN A.1, rev 1)

Rev 1, 2026-11-02. All three slices are built (A on 2026-11-02, B and C on 2026-11-03). Opus wrote it, and the slices in Sec.7 are sized for a Sonnet build from a brief per slice. The owner answered Sec.8's three questions the same day, so nothing here waits on a decision.

Slice A built 2026-11-02.

Slice B built 2026-11-03.

Slice C built 2026-11-03.

Two amendments from the slice B build. Rule 1 lives in the parser (`guardedByOwnName`), not in `validate.ts`, because RMS0202 is raised there. RMS0300 does not reach 0 on DE's 180 maps. Three sites survive Rule 2 (`PH_TROPICALSOUTH` and `PH_TROPICALEAST` in `special_map_borderstones.rms`, `special_map_holyline.rms` and `special_map_yinyang.rms`, where DE defines `PH_TROPHICAL…`). They are true positives, and the gate pins them with a verdict each (owner, 2026-11-03).

## 1. What this is for

The Code tab, Breakdown and the name lookup read one file, the open script. A script that uses `#include_drs` gets names from files they never see, so today every check that says "this name is not defined" is turned down to info in any script with an include, with the sentence "It may come from an include file. Age of RMS can't see inside those yet." That costs real bugs. DE's own `Stranded.rms` defines `#const FOREST_IDENTIFICATIO 500` (one letter short) and then uses `FOREST_IDENTIFICATION` 1,887 times as a `land_id`. The editor reports that as 1,887 info lines nobody reads.

The preview already reads include files (preview-design Sec.3 rule 11, amended 2026-11-02). It runs them through the token filter, which knows which branch is live for the lobby being previewed. This design gives the editor's checks the same files, so a missing name is a warning again when the files were read.

**Goals.**

1. A name an include defines counts as defined for RMS0202, RMS0300 and RMS0303, and for the name lookup (autocomplete, hover, the resolve flash, the quick fixes).
2. When the files were read, the include softening stops and those checks report at their normal severity.
3. No new false warnings on the corpus or on DE's shipped maps (Sec.3 has the hazards and Sec.5 the rules that remove them).
4. Typing stays as fast as it is. The include files are parsed once, not on every keystroke.

**Non-goals.**

- Diagnostics inside include files. They are DE's files, the user cannot edit them, and a warning there names nothing the user can act on.
- Branch liveness. Which `#const` in an include is live under which lobby is CREATION_PLAN A.4 (`docs/name-liveness-design.md`). This design counts every name an include defines in any branch, the same rule the parser already applies to the script's own definitions (`scope.ts`, "any definition counts, conditional or not").
- Breakdown cards for included commands, and opening an include file. The included text is never shown as editable cards.
- Changing the preview. It already expands includes with liveness and stays as it is.

## 2. What already exists

Built for the preview on 2026-11-02, all reusable here.

| Piece               | Where                                                    | What it does                                                                                                                        |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Finding the install | `findDeGamedataFolder` in `src/settings/scriptFolder.ts` | The Open dialog's install search, aimed at `resources\_common\drs\gamedata_x2`                                                      |
| Reading the files   | `src/useIncludeFiles.ts`                                 | Reads every file a script names, nested ones included, once per change of the set of paths, shared by the preview and the Tools tab |
| Keys and loading    | `src/preview/generator/includes.ts`                      | `includeKey`, `includePathsIn`, `includePathsInText`, `loadIncludeFiles`                                                            |
| The result          | `IncludeFiles`, a `ReadonlyMap<string, string>`          | `undefined` when no install was found, and a key missing from the map is a file that install lacks                                  |

What the parser has. `ParseResult.includes` lists every `#include_drs` and `#includeXS` with its assembled path. `ParseOptions.builtinConstants` is the precedent for names that come from outside the file, a set the parser consults in numeric slots. `validate.ts` holds `includesPresent` and `softenForIncludes`, and `nameLookup.ts` returns early on `parse.includes.length > 0` in two places (the "create a missing `#const`" offer and the "move the `#define` up" offer).

## 3. Measured, 2026-11-02

A throwaway probe parsed and validated 243 scripts, the 44 tracked corpus maps, 19 in `test-maps/local` and DE's 180 shipped maps in `gamedata_x2`, and read every include from the install. It was run by exact path and deleted.

| Measure                                                                                  | Value                                       |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| Scripts with `#include_drs`                                                              | 176 of 243 (DE's own maps are most of them) |
| `#include_drs` lines                                                                     | 3,115                                       |
| Include files a script names that the install lacks                                      | 1, `includes/defend_wonder.inc`             |
| Names one script's includes define, at most                                              | 1,947                                       |
| Diagnostics softened today (RMS0202, RMS0300, RMS0303 at info with the include sentence) | 2,165                                       |
| Of those, answered by a name an include defines                                          | 12                                          |
| Parsing all 54 files in `includes/`, 600 K characters, warm                              | 84 ms                                       |
| Parsing and validating `Stranded.rms` alone                                              | 162 ms                                      |

**So reading the files answers almost nothing by itself.** The softening is what A.1 removes, and what is left once it is gone is the real question. The 2,153 that no include answers fall into these groups.

| Group                            | Sites | Example                                                                                                                                 | Verdict                                                                                              |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A typo in one map                | 1,887 | `Stranded.rms`, `FOREST_IDENTIFICATION` against `#const FOREST_IDENTIFICATIO`                                                           | True positive, the land gets no `land_id`                                                            |
| A name used that nothing defines | 42    | `Pa_Site_v1.1.rms` `avoid_actor_area GOLD_SECONDARY_CAA_A`, 30 of them, copied from `starting_resources.inc` without its `if`           | True positive, harmless in game                                                                      |
| Used under `if` on its own name  | 14    | `if RELIC_CAA_A avoid_actor_area RELIC_CAA_A`                                                                                           | **False positive.** The use only runs when the name is defined                                       |
| Used under some other `if`       | 15    |                                                                                                                                         | Mixed, to be read one by one in slice B                                                              |
| RMS0300 in a numbered family     | 195   | `BR_BattleontheIce.rms` testing `9_PLAYER_GAME` to `16_PLAYER_GAME`, `BR_FallofRome.rms` testing `BR_CENTRAL_25` beside `BR_CENTRAL_24` | **False positive.** The did-you-mean only differs in digits, and the author meant a different member |

The two false-positive groups are why Sec.5 has two rules beyond reading the files. Without them, A.1 would turn 209 quiet lines into warnings on DE's own maps.

## 4. The design

### 4.1 Where the files reach the parser

The parser worker (`src/editor/parserWorker.ts`) gets the files the same way the preview worker does, from `useIncludeFiles`, but **not with every parse request**. A parse request goes out on every keystroke burst, and the files are 458 K characters for a script like Bazi. The preview sends them per request because it regenerates far less often and its worker can be replaced by a watchdog. The parser worker is never replaced (`useParsedDocument.ts` creates it on mount and ends it on unmount), so it can hold them.

- A new message, `{ kind: "includes", files: IncludeFiles | null }`, sent by `useParsedDocument` whenever `useIncludeFiles` returns a new value. `null` means no install was found. The worker keeps the latest.
- The worker parses each file once and keeps the parsed result in a `Map` keyed by `includeKey` plus the text's length and a cheap hash, so a changed file on disk is parsed again and an unchanged one never is.
- Receiving new files triggers a re-parse of the current source, so the diagnostics catch up without waiting for a keystroke.
- `ParseRequestMessage` is unchanged.

`useIncludeFiles` already shares one read between its callers through a module-level promise, so the parser asking for the same files as the preview costs no extra disk reads.

### 4.2 The pure seam

`src/parser/**` must not import Tauri, and it must not import the preview either. The new module is `src/parser/includeIndex.ts`, pure, Node-testable.

```ts
/** What the editor's checks know about one script's includes. */
export interface IncludeIndex {
  /** False when no install was found. Every include then reads as unknown, and softening stays (Sec.4.4). */
  readonly installFound: boolean;
  /** Each name an include defines, with where the script brought it in. */
  readonly names: ReadonlyMap<string, readonly IncludedName[]>;
  /** Include paths the install does not have, in the order the script names them. */
  readonly missing: readonly string[];
}

export interface IncludedName {
  name: string;
  directiveKind: "define" | "const";
  /** The #include_drs token in the open script that brought the file in. Nested includes report the outer directive. */
  directiveToken: number;
  /** The include file the definition sits in, by includeKey. */
  file: string;
  /** True when the definition sits inside an if or start_random in its file, or the directive does in the script. */
  conditional: boolean;
}

export function buildIncludeIndex(
  parse: ParseResult,
  files: IncludeFiles | undefined,
  parseFile: (key: string, text: string) => ParseResult,
): IncludeIndex;
```

`parseFile` is how the worker's cache gets in without the pure module holding state. `IncludeFiles` moves from `src/preview/generator/includes.ts` to `src/parser/includeIndex.ts` (the generator re-exports it), since the parser is now its lower layer. `includeKey` and `includePathsInText` move with it. `loadIncludeFiles` stays in the generator module, which keeps the app-facing reading code out of the parser.

Rules for building it.

1. Walk `parse.includes` in order, `#include_drs` only. For each, read its file through `files`, parse it with `parseFile`, take its `symbols`, and recurse into its own `#include_drs` lines. A file already on the current chain reads as empty (the cycle guard the preview's filter uses).
2. Each definition gets the **outer** directive's token in the open script, however deep the nesting. That is the one place the user can be shown.
3. A path `files` lacks goes into `missing` and contributes no names.
4. No liveness. Every definition in every branch counts, with `conditional` recorded for the name lookup's "defined in a branch" note.

### 4.3 How the checks use it

`validate(result, refDb, includeIndex?)` takes the index as a new optional third argument. Absent, it behaves exactly as today.

- **Definitions.** `symbolsByName` gains a synthetic `SymbolInfo` for each included name, with `nameToken` set to the directive token, so `isDefinedAbove` (`scope.ts`) gives the right answer with no change. A name used above the `#include_drs` that defines it is RMS0303, which is what DE does. The file runs where the directive stands.
- **RMS0202, RMS0300, RMS0303** find included names the same way they find the script's own.
- **`builtinConstants`** in the parser stays the engine's names only. The parser's numeric-slot check (`Parser.unresolvedNumericUses`) gets the included names through a new `ParseOptions.externalSymbols?: ReadonlySet<string>`, which `parseRms` consults beside `builtinConstants`. The worker passes `new Set(index.names.keys())`.

The name lookup (`nameLookup.ts`) gets the index through `ScriptNameIndex`, which gains `includes?: IncludeIndex`. `resolveName` returns a new resolution kind for an included name, `{ kind: "included", file, directiveKind, conditional }`. Autocomplete offers included names once two letters are typed, ranked after the script's own (owner, 2026-11-02, Sec.8 Q3). The threshold is a new `INCLUDED_MIN_PREFIX = 2` beside `OBJECT_MIN_PREFIX`, not a reuse of it, so the two can change apart. Hover says "Defined in includes/scaling.inc" and, for a `#const`, the value written there (the first definition's value token text, as hover shows for the script's own). The resolve flash treats an included name as resolved. The two early returns on `parse.includes.length > 0` change to "the index is absent or its install was not found".

### 4.4 When to soften

Softening exists because a name might come from a file nobody read. With the index, the editor knows which files were read.

| Situation                                 | Softening                                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No index passed (tests, tools without it) | As today, any include softens                                                                                                                                           |
| Index with `installFound: false`          | As today, any include softens                                                                                                                                           |
| Install found, every named file read      | **None**                                                                                                                                                                |
| Install found, a named file missing       | **None.** DE reads a missing file as empty too (24hr_Bazi generates with `defend_wonder.inc` missing), so a name it would have defined is undefined in the game as well |

`includesPresent` in `validate.ts` becomes `includesUnread`, true only in the first two rows. The softened message wording stays.

### 4.5 The two rules that keep it quiet

Both come from Sec.3's false-positive groups and both are positive-evidence rules, they only stop a report.

**Rule 1, a use under its own name's `if`.** A name read inside a branch whose guard tests that same name, `if RELIC_CAA_A … avoid_actor_area RELIC_CAA_A … endif`, only runs when the name is defined, so RMS0202 is never reported there. `validate.ts` already keeps a guard stack for RMS0301 and RMS0314 (`this.guards`, positive literals are the condition text). The check is `this.guards.includes(name)`. This is the one piece of A.4 that is cheap, certain and needed now. It covers 14 sites on the corpus.

**Rule 2, numbered families.** RMS0300's did-you-mean is skipped when the unknown name and the suggestion differ only in their digits (`9_PLAYER_GAME` against `8_PLAYER_GAME`, `BR_CENTRAL_25` against `BR_CENTRAL_24`). Strip every run of digits from both, and if the two results are equal, there is no suggestion. A family member that was never defined is a branch the author knows is dead, not a typo of its neighbour. This covers the 195 sites, and it applies to every script, includes or not (owner, 2026-11-02, Sec.8 Q1). Measured the same day over the 243 scripts, RMS0300 reports two warnings today, both in `AK_Namatjira.rms` and both digit-only (`CONFIG_RIVER_A8` against `CONFIG_RIVER_A4`, `CONFIG_RIVER_M8` against `CONFIG_RIVER_M6`), so the rule leaves RMS0300 with no corpus warnings. Slice B pins that at 0.

**Amended 2026-11-02 after slice A, lettered slots.** Slice A's measurement found two of the 197 that differ in a letter, not digits. `Rage Forest 2026.rms` defines its predators as lettered slots (`PREDATOR_A_ARCTIC_WOLF`, `PREDATOR_B_POLAR_BEAR`) and tests combinations it never defines (`PREDATOR_A_POLAR_BEAR`), the same shape of a family member that is a dead branch on purpose. So Rule 2 also drops the suggestion when the two names, split on `_`, have the same number of parts and differ in exactly one, and both differing parts are a single letter. A one-letter part is a slot name, not a word that can be misspelt. Without this clause the two Rage Forest sites would stay warnings.

### 4.6 What the user sees

- In a script with includes and an install, a misspelled name gets a yellow squiggle and the did-you-mean, exactly as in a script without includes.
- Hover on `MAPSCALE_AREA` in Bazi says it is defined in `includes/scaling.inc`.
- Without an install the editor behaves as today, and the status bar's existing notes do not change. The preview's banner already says the install was not found.

## 5. Corpus gate

`src/parser/__tests__/includeResolution.measure.test.ts`, its own vitest config like `measure:checker`, skipped without an install like the preview's DE gate. It runs the 243 scripts of Sec.3 with the index and fails when any of these move.

1. Softened diagnostics with an install present, **0**.
2. RMS0202 warnings on `Stranded.rms`, **1,887**, all naming `FOREST_IDENTIFICATION` with the suggestion `FOREST_IDENTIFICATIO`. The true positive this feature exists for.
3. RMS0202 warnings across the other 242 scripts, pinned at the slice B count, every one listed in the test file with its verdict.
4. RMS0300 warnings across all 243 scripts, **0** under Rule 2 (two today, both digit-only, Sec.4.5).

The unit tests (`includeIndex.test.ts`, extended `validate.test.ts`) use made-up files, so CI checks the rules without an install.

## 6. Risks

- **The parse cache grows with every file edit on disk.** Bounded by the 276 files `gamedata_x2` holds, keyed by name, the new text replaces the old.
- **A name defined in an include and again in the script.** First definition wins in DE. The synthetic definition sits at the directive, so whichever comes first in the file is first here too, and RMS0301 (redefinition on the same path) needs no change. Slice B checks that RMS0301 does not start firing on DE's maps, where scripts often `#const` a name an include also sets.
- **1,887 squiggles on one map.** True, and the Code tab draws them, but the status bar count will read 1,887 warnings for one typo. Sec.8 Q2 asks whether to collapse them.

## 7. Slices

**Slice A, the index and the softening.** `includeIndex.ts` with its tests, the move of `includeKey` and friends, `validate`'s third argument, `includesUnread`, `ParseOptions.externalSymbols`, the worker's `includes` message and cache, `useParsedDocument` sending it. Gate, unit tests green and the existing corpus tests unchanged (no index there, so softening stays).

**Slice B, the two rules and the measured gate.** Rule 1 and Rule 2 in `validate.ts`, `includeResolution.measure.test.ts`, every remaining warning read and given a verdict in the test file. Stop and ask the owner if any verdict is "false positive" and no rule covers it.

**Slice C, the name lookup.** The `included` resolution kind, autocomplete, hover, the flash, the two quick-fix early returns, and the Constants Usage tool marking the names it lists that may sit in an unread include. **Amended 2026-11-02 in its brief.** The tool reads the parse's own RMS0202 diagnostics, which slice A already computes with the include files, so it needs no `read-reference` and no file reading of its own. A run sheet section for the Code tab on Bazi and Stranded.

## 8. Questions for the owner

All three answered by the owner on 2026-11-02, each as recommended. No questions remain open.

1. **Rule 2 also applies to scripts without includes.** **Answered, everywhere.** It removes RMS0300's two existing corpus warnings, both the same digit-only shape (Sec.4.5).
2. **One typo, 1,887 warnings.** **Answered, a squiggle on every use**, today's rule for RMS0202, since every one is a line that will not work.
3. **Included names in autocomplete.** **Answered, after two letters**, the threshold object names already use, with its own constant (Sec.4.3).
