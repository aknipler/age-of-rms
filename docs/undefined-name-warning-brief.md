# Undefined name warning, RMS0324 (design and build brief)

Written 2026-11-25 for a Sonnet build session. The design is in this file, measured the same
day, and the owner settled both open questions on 2026-11-25. Build the items in the order
given and nothing else. Where the brief says **STOP AND ASK**, message the owner and wait.
Don't choose for them.

All paths are relative to `age-of-rms/`. Other sessions edit this repo at the same time. Re-read
a file right before editing it, use Edit (never a whole-file Write on an existing file), don't
`git commit`, and run `npx prettier --write` on the files you changed at the end. New prose in
code comments, docs and diagnostic messages follows the repo CLAUDE.md language rule (no
colons, semi-colons or dashes as punctuation). Teaching mode applies. Comment the why at each
decision point.

Run test files by exact path, never vitest over a whole folder. `src/parser/**` must not import
React, Monaco or Tauri (hard rule). Run the full `npm test` once, at the very end.

---

## 1. What the owner wants

A script that names something nobody defines gets a squiggle. Today

```
create_object MY_GOLD          // no #const MY_GOLD anywhere
create_terrain FORSET          // typo for FOREST
```

draw nothing at all, and the map quietly loses that gold or that forest. The owner lost a typo
this way and decided on 2026-11-18 to build the warning.

## 2. What exists today, and the gap

| Where the name sits                                                                    | Today                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A numeric slot (`number_of_objects MY_COUNT`)                                          | RMS0202 "isn't defined in this file", from the parser, softened to info when include files are unread. **Already covered, leave it alone.** |
| An `if` or `elseif` condition                                                          | RMS0300, only with a near typo, since unknown engine labels are common there. **Leave it alone.**                                           |
| Defined, but only below the use                                                        | RMS0303. **Leave it alone.**                                                                                                                |
| **A name slot** (`terrainConstant`, `objectConstant`, `otherConstant`) defined nowhere | **Nothing.** This brief fills this row.                                                                                                     |

The building blocks are there. `resolveName` in `src/parser/nameLookup.ts` already answers
"what is this name here" for a slot and returns `{ kind: "unknown" }` or
`{ kind: "constantsIncOnly" }` on a miss. It reads the game constants table, the script's own
`#const` and `#define` above the use, and the names the script's `#include_drs` files define.

## 3. Why this is safe now, and where it was not

CLAUDE.md's positive resolver rule says a miss in our data proves nothing. That rule is why the
check was never built. Two things changed.

1. `game-constants.json` grew from 31 rows to about 4,400, read from DE's own `random_map.def`
   and `constants.inc`.
2. The editor now reads the script's include files from the user's DE install
   (`docs/include-resolution-design.md`).

What is left is measured below, and each remaining hole gets its own rule.

### 3.1 The measurement (2026-11-25)

A throwaway probe ran `resolveName` over every word in a name slot of the 64 corpus maps
(`test-maps/` and `test-maps/local/`) and DE's 180 maps, with include files read from the
install exactly as `npm run measure:includes` reads them. 91,976 name slot words in all.

| Group                                                                | Corpus | DE  | What it is                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Group names (`create_object_group NAME` in the script or an include) | 29     | 2   | **False positives** today. `resolveName` does not know group names. Rule G below.                                                                                                                      |
| In the installed `random_map.def`, missing from our table            | 0      | 3   | **False positives.** `MAP_FORTRESS`, `MAP_BOGLAND`, `MAP_COASTAL_FOREST`, added by a DE update after the extractor ran. Rule D below.                                                                  |
| Inside an `if` branch                                                | 5      | 99  | Real undefined names under a flag that is usually itself undefined (DE's Aftermath writes `if ENABLE_EXTRA_CLUMP` around `create_terrain EXTRA_CLUMP_TERRAIN`, and neither name exists). Info, rule I. |
| `constants.inc` only, script does not include it                     | 1      | 0   | `SEAGULLS` in Menindee. True positive, its own wording, rule C.                                                                                                                                        |
| Undefined everywhere, not guarded                                    | 51     | 91  | **True positives.** Rule W.                                                                                                                                                                            |

Every row of the last group was checked by hand against the installed `random_map.def`,
`includes/constants.inc` and every include the map names. Examples, all real.

- `BIRD_A` and `BIRD_B` in 7 corpus maps, copied from DE's bird block without the
  `#include_drs includes/themes.inc` that defines them. DE's own saved maps settle the effect.
  On `cg-x-comeer` and `cg-x-ra` (both use the undefined `BIRD_A`), DE placed 0 hawks, falcons
  and ravens on both seeds, and the preview's object gate matches those maps object for object.
- `PH_GENERIC_OFF` 5 times in Comeer v1.5, `FENCE_RUBBLE` in Chaotic Strait,
  `ONGRID_PLACEHOLDER2` in 13 Rings and Vanguard, all effect targets naming nothing.
- `PALM_FOREST` in Menindee, `CUSTOM` as an `ai_info_map_type` in Chaotic Strait.
- In DE's own maps, `TERRAIN_SHALLOWS` (Isthmus), `PLACEHOLDER_TERRAIN` (Dingos),
  `STRAGGLER_FOREST` (Mired), and `RICE_FARM_EMPTY` 64 times in `real_world_manchuria.rms`.
  Our table lists `RICE_FARM_EMPTY` as a `constants.inc` name, but the installed
  `constants.inc` no longer defines it, so the table is stale there too. Rule D's reading of
  the real file is what catches that.

One `#const` value also missed (`#const restricted_terrain_distance max_distance_to_other_zones`
in Battle Lines), a renaming idiom that is not a constant at all. Rule V skips it.

## 4. The design

### 4.1 Which words are checked

The first token of an argument whose value is a plain word (`typeof arg.value === "string"`),
in a slot typed `terrainConstant`, `objectConstant` or `otherConstant`, on a command, an
attribute, or the value of a `#const` directive. Numbers, `rnd(...)` and expressions are not
names and are skipped, as `checkArg` in `src/parser/validate.ts` already skips them.

**Rule V.** Skip a `#const` value word that is a command, attribute or directive name in
`language.json` (look it up through the language index, never a hardcoded list). That is the
renaming idiom, a different construct.

### 4.2 What resolves a name (silent)

In this order. The first hit means no diagnostic.

1. Anything `resolveName` resolves (`number`, `builtin`, `script`, `included`, `label`,
   `otherKind`, `definedBelow`). `otherKind` is RMS0205's case and `definedBelow` is RMS0303's,
   so this check stays out of their way.
2. **Rule G, group names.** A name bound by `create_object_group` anywhere in the open script,
   or in any include file that was read. Anywhere in the file and not "above the use", since
   whether DE needs the group above its use is unmeasured (CREATION_PLAN A.5), and the silent
   reading is the safe one.
3. **Rule D, the installed definitions.** A name that the user's installed `random_map.def`
   defines with `#const` or `#define`. This reads the real file, so it is positive evidence and
   it is never stale.

### 4.3 What is reported

Checked in this order. The first rule that applies decides the severity and the message.

| Rule  | When                                                                                            | Severity | Message (exact wording to use)                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **U** | The script has an include nobody could read (`includesUnread`)                                  | info     | `"NAME" isn't defined in this file. It may come from an include file Age of RMS couldn't read.`                                      |
| **N** | No DE install was found, so rule D could not run                                                | info     | `Age of RMS's game data has no "NAME", and nothing in this script defines it.`                                                       |
| **I** | The word sits inside an `if`, `elseif` or `else` branch, at any depth                           | info     | `"NAME" is not defined in random_map.def or in any file this script includes, so if this branch runs, this line has no NAME to use.` |
| **C** | `resolveName` said `constantsIncOnly`, and the script does not include `includes/constants.inc` | warning  | `Only includes/constants.inc defines "NAME". Add #include_drs includes/constants.inc above this line, or define NAME with #const.`   |
| **W** | Everything else                                                                                 | warning  | `"NAME" is not defined in random_map.def or in any file this script includes, so this line has no NAME to use.`                      |

- A `start_random` branch is **not** a guard for rule I. Its branches do run, so a typo there
  is a real warning.
- For rule C, a script that does include `constants.inc`, whose read copy lacks the name
  (`RICE_FARM_EMPTY`), falls through to rule W. Our table is stale there and the file is the
  truth.
- Rules I and W add ` Did you mean "X"?` when a near name exists, and set
  `diagnostic.suggestion = X`, the field RMS0300 already sets, so the existing quick fix
  replaces the word. Find X with `closestBuiltin(stat, name, def)` (rule 1 hits only) for the
  three constant slots, then the script's own `#const` names above the use within edit
  distance 1. Skip a candidate that `isFamilySibling` (`src/parser/parser.ts`) calls a sibling,
  so `BIRD_A` never suggests `BIRD_B`.
- The Code tab's existing create offer (`unknownNameOffer`, `src/editor/constOffers.ts`)
  already offers `#const NAME ...` on these words. Nothing new is needed there. Confirm it
  appears on an RMS0324 squiggle in item 6.

**Why the wording is what it is.** Rules I and W state what was checked (random_map.def and the
files the script includes), which is an observation about files. "This line has no NAME to
use" is the observed effect, settled by the bird maps in 3.1. Nothing claims more. Rules U and
N say less because less was checked.

---

## 5. Items in build order

### 1. The diagnostic code

`src/parser/diagnostics.ts`. Add

```ts
RMS0324: {
  severity: "warning",
  summary: "Name in a terrain, object or constant slot is not defined anywhere this script can see",
},
```

after RMS0323, and one builder `undefinedSlotName(token, rule, suggestion?)` that returns the
right message and severity for rules U, N, I, C and W from the table. Severity per rule comes
from the table, not from the summary entry. Read how `undefinedName` (RMS0300) and
`unresolvedConstantInNumericSlot` (RMS0202) build theirs and copy the shape. Add RMS0324 to
`docs/parser-design.md`'s diagnostic list with one line.

**Gate 1.** In `src/parser/__tests__/validate.test.ts` (or the diagnostics test file the
codebase uses for builders), one test per rule's message and severity.

### 2. Group names in the data and the include index

1. `reference/data/language.json`, on `create_object_group`'s `groupName` argument, add
   `"definesName": true`. Add the optional boolean to the argument schema in
   `reference/schemas/` and to `ArgumentDef` in `src/parser/language.ts`. Run
   `npm run validate:reference`, then `npm run generate:types` and
   `npm run check:generated-types` in case the published types read the schema.
2. A pure helper in `src/parser/nameLookup.ts`,
   `boundNamesIn(parse: ParseResult): Set<string>`, collecting the text of every argument
   whose def has `definesName`, through blocks and `if` and `start_random` branches.
3. `src/parser/includeIndex.ts`, `IncludeIndex` gains `readonly boundNames: ReadonlySet<string>`,
   filled in `buildIncludeIndex` from `boundNamesIn` of every include file it walks (empty when
   no install).

**Gate 2.** A test that a script with `create_object_group HERD { add_object COW }` binds
`HERD`, and one that an include defining a group puts it in `boundNames`.

### 3. The installed definitions

1. Pure, `src/parser/installedDefinitions.ts`,
   `definitionNamesIn(text: string): Set<string>`, the names of every `#const` and `#define`
   line in a `random_map.def` text. Parse it with `parseRms` and read `parse.symbols`, rather
   than a regex, so comments and conditionals behave as everywhere else.
2. `src/useIncludeFiles.ts` exports its install finder. Add a hook
   `useInstalledDefinitions(): ReadonlySet<string> | null | undefined` (undefined while
   loading, null when no install), reading `${gamedataFolder}\random_map.def` once per session
   behind a module level promise, the same pattern as `findGamedataFolder` there.
3. Send it to the parser worker the way include files travel. Find where
   `useParsedDocument.ts` posts the includes message and where `src/editor/parserWorker.ts`
   handles it, add a sibling message `{ kind: "installedDefinitions", names: string[] | null }`,
   keep the set in the worker, and pass it to `validate` (item 4). A new set re-validates the
   current text once.

**STOP AND ASK** if the parser worker has no message path from the main thread you can copy,
rather than inventing a new transport.

**Gate 3.** `definitionNamesIn` on a small text with a `#const`, a `#define`, a commented out
`#const` and one inside an `if`. The commented one is absent, the other three present.

### 4. The check in validate()

`src/parser/validate.ts`.

1. `ValidateOptions` gains
   `installedDefinitions?: ReadonlySet<string> | null`. Absent means not loaded yet, and null
   means no install. Both mean rule N.
2. Build the name lookup's indexes inside `validate`. The static one
   (`buildStaticNameIndex(language, constants)`) is the same for every call, so memoise it in a
   module level `WeakMap` keyed by the `refDb` object. Building 4,400 rows on every keystroke
   is what the name lookup's two halves exist to avoid (its file comment says why). The script
   one is `buildScriptNameIndex(parse)` with `includes` set to `opts.resolvedIncludes`.
3. The validator needs to know whether the word is inside an `if` branch. Find where the
   `Validator` class visits `if` branches and keep an `ifDepth` counter around that visit.
   `start_random` branches don't count.
4. New private `checkUndefinedSlotName(token, arg, tokenIndex)`, called from `checkArg` right
   after `checkUseBeforeDefinition`, and from wherever `#const` values are checked (find it,
   **STOP AND ASK** if `#const` values never reach `checkArg`). It applies rule V, then 4.2, then
   4.3 in order.
5. Leave the header comment's paragraph about "never on terrain/object slots" true by
   rewriting it, since this check is exactly that. Say the table is now about 4,400 rows, cite
   this brief's 3.1, and say which rules keep the old worry from coming back.

**Gate 4.** In `validate.test.ts`, one fixture per row of 4.2 and 4.3, each with a control that
must stay silent, and each written so it could tell the rules apart (CLAUDE.md, a fixture that
cannot produce the wrong answer is not a test). At least these.

- `create_object MY_GOLD` with no definition, rule W, warning.
- The same inside `if SOMETHING`, rule I, info. Inside `start_random`, still W.
- `create_object_group HERD` then `create_object HERD`, silent. The group defined below the
  use, also silent.
- `MAP_FORTRESS` in `ai_info_map_type` with `installedDefinitions` holding it, silent. The same
  with `installedDefinitions: null`, rule N, info.
- `SEAGULLS` with no include, rule C. With a resolved index for `constants.inc` that defines
  it, silent. With one that does not, rule W.
- An unread include, rule U, info.
- `create_terrain FORSET`, W with `Did you mean "FOREST"?` and `suggestion` set.
  `create_object BIRD_A` with `BIRD_B` defined, W with no suggestion (family sibling).
- `#const RENAME max_distance_to_other_zones`, silent (rule V).
- Mutation test it once (CLAUDE.md). Delete the rule I branch, watch the guarded fixture fail
  with a readable message, then restore it with the edit tool.

### 5. The corpus gate

New `src/parser/__tests__/undefinedNames.measure.test.ts` with its own config
`vitest.undefined-names.config.ts` and `npm run measure:undefined-names`, excluded from
`npm test` in `vitest.config.ts` like the other measure files. Copy the setup of
`src/parser/__tests__/includeResolution.measure.test.ts` (it finds the install, reads include
files, and runs `validate` exactly as the worker does), and pass `installedDefinitions` read
from the install's `random_map.def` through `definitionNamesIn`.

It asserts these, all with the install present (skip with a printed note without one).

1. **The tracked corpus, pinned site by site.** These 28 RMS0324 diagnostics on the tracked
   `test-maps/*.rms`, and no others. Each is `file:line:NAME`, with its rule.
   - W, `13_Rings_v1.2.rms` 105 `ONGRID_PLACEHOLDER2`, 1505 `BIRD_A`, 1509 `BIRD_B`
   - W, `AD4 - Ra.rms` 897 `BIRD_A`, 901 `BIRD_B`, 912 `BIRD_A`, 913 `BIRD_B`
   - W, `AK_ForeDaut_v1.3.rms` 2129 `BIRD_A`, 2134 `BIRD_B`
   - W, `AK_Hourglass_v2.0.rms` 1836 `BIRD_A`, 1840 `BIRD_B`
   - W, `AK_Six_Points_v1.4.rms` 1885 `BIRD_A`, 1889 `BIRD_B`
   - W, `AK_Vanguard_v1.2.rms` 106 `ONGRID_PLACEHOLDER2`, 1726 `BIRD_A`, 1730 `BIRD_B`
   - W, `Chaotic_Straitv0.99.rms` 117 `FENCE_RUBBLE`, 122 `CUSTOM`, 927 `BIRDS_A`
   - W, `Comeer v1.5.rms` 344 to 348 `PH_GENERIC_OFF` (five), 1019 `BIRD_A`, 1023 `BIRD_B`
   - W, `Menindee_AUS_v2.3.rms` 1070 `PALM_FOREST`
   - C, `Menindee_AUS_v2.3.rms` 1390 `SEAGULLS`
2. **DE's 180 maps.** Exactly 91 warnings and 99 infos, and every warning's name is one of
   `RICE_FARM_EMPTY` (64), `TERRAIN_SHALLOWS` (6), `PLACEHOLDER_TERRAIN` (5), `ICY_SHORE` (4),
   `STRAGGLER_FOREST` (4), `STRAGGLER_FOREST_BLEND` (4), `BASE_TERRAIN`, `COLOR_MOOD`,
   `MIDDLE_TERRAIN_BLEND_C`, `WATER_A` (1 each). Print the infos grouped by name.
3. **No group name and no installed name ever fires.** Any RMS0324 on a name some
   `create_object_group` binds, or that `random_map.def` defines, fails the gate.
4. Print the counts for `test-maps/local/` without asserting them (those maps are not tracked).

**STOP AND ASK** if the tracked list or the DE totals differ from the above. Don't re-pin them
to match the code. The difference is either a bug or a fact about the data the owner should see.

Add the command to the Commands table in `CLAUDE.md` with one line, like
`measure:includes`.

### 6. Run sheet and build log

Add a section to `docs/manual-test-run-sheet.md` (the next free number) with these checks.

1. Type `create_object MY_GOLD` in the Code tab. A warning squiggle appears, and the light bulb
   offers `#const MY_GOLD`.
2. `create_terrain FORSET` offers the Did you mean fix, which writes FOREST.
3. The same line inside `if X` shows as info.
4. Open `Comeer v1.5.rms`. Five warnings on `PH_GENERIC_OFF` and two on the birds.
5. In Breakdown, the same card shows the warning.
6. With the game folder hidden from the app (rename it for the test), the warning on
   `MY_GOLD` becomes info with the "game data has no" wording.

Append a dated entry to `docs/build-log.md` with the test counts and the gate's numbers.

**Final gate.** Full `npm test`, `npx tsc --noEmit`, `npx eslint` on the changed files,
`npm run validate:reference`, `npm run check:generated-types`, `npm run measure:includes`
(RMS0202 and RMS0300 must not move) and `npm run measure:undefined-names`.

## 6. Not in this brief

- Updating `game-constants.json` with `MAP_FORTRESS`, `MAP_BOGLAND` and `MAP_COASTAL_FOREST`
  (an extractor re-run, the open DE update 185872 follow-up). Rule D already keeps them silent
  with an install.
- RMS0300's condition labels and RMS0202's numeric slots keep their own rules.
- CREATION_PLAN A.5's group binding warnings (shadowed and redefined group names).
- The preview's handling of an undefined name, which already places nothing, matching DE.
