# Include resolution slice C brief, the name lookup

**This is a work brief for one implementing session, not a design document.** The design is `docs/include-resolution-design.md` (rev 1, CREATION_PLAN A.1), Sec.4.3 in particular, and the name lookup's own design is `docs/name-lookup-design.md`. Read this file for what to build and in what order, and the designs for why. Where they disagree, stop and ask the owner. Do not pick one yourself.

Slice C teaches the name lookup the names a script's include files define, so the Code tab's autocomplete offers them, hover says where they come from, the resolve flash confirms them, and the two quick fixes ("create the missing `#const`", "move the `#define` up") work in scripts with includes. Breakdown gets the same through the shared lookup. Slice A made the warnings right. This slice makes the help right.

**Slice A must be in the tree** (`src/parser/includeIndex.ts`, `src/editor/includeCache.ts`, `validate`'s `resolvedIncludes`). Slice B need not be. If slice A is missing, stop and say so.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. The Hard rules apply, especially HelpTip on every new control (this slice adds none), the positive-resolver rule, no tree-restoring git commands, and `npm run format` at the end.
- Read `src/parser/nameLookup.ts` in full before item 1. Every consumer of a name's resolution goes through `resolveName` and `suggest` there, and this slice extends both rather than adding a parallel path.
- Build the items in the order of Sec.2. Each item ends with its tests green before the next one starts. Run tests by exact path while working, the full `npm test` once at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-include-resolution-slice-c.txt` at the end.
- Stop and ask the owner when a rule here or in the designs cannot be followed as written, or when an existing name lookup test changes for a reason this brief does not name.

## 1. Decisions made for this brief

**D1. The worker attaches the index to the parse it posts.** Every lookup builds its index from a `ParseResult` alone (`scriptIndexFor(parse)` in `src/editor/staticNameIndex.ts`, cached per parse object), and seven call sites in the Code tab and Breakdown use it. So `ParseResult` gains an optional `includeIndex?: IncludeIndex`, which `parseRms` never sets and the parser worker sets after `validate`, from the same `indexFor` result. The tools' wire encoding (`encodeParseResultForWire` in `src/tools/wireCodec.ts`) copies named fields only, so the index never reaches the wire.

**D2. One helper decides whether a miss may hide in an unread include.** `includesUnread(script: ScriptNameIndex): boolean` in `nameLookup.ts` returns true when the script names an `#include_drs` and its index is absent or has `installFound: false`. Both quick-fix early returns use it in place of `parse.includes.length > 0`, so a missing file under a found install no longer blocks them (the game reads it as empty, design Sec.4.4).

**D3. The first definition wins across the two sources.** When the script and an include both define a name, the one the engine keeps is whichever comes first in the file, the script's `#const` or the `#include_drs` that brings the include's in. `resolveName` compares the script definition's `nameToken` with the included name's `directiveToken`, as `isDefinedAbove` compares positions now.

**D4. Included names rank after the script's own, before labels.** `sourceOrder` 0.5 in `nameCandidates`, between the script's 0 and the labels' 1, so nothing else is renumbered. A new `INCLUDED_MIN_PREFIX = 2` beside `OBJECT_MIN_PREFIX` gates them (owner, design Sec.8 Q3).

**D5. The Constants Usage tool needs no new capability.** It lists "referenced but never defined" names from the parse's own RMS0202 diagnostics (`findUndefinedReferences` in `src/tools/builtin/constantsAuditor.ts`), and in the app those diagnostics already come from the worker with the include files resolved. The design's plan to give it `read-reference` is withdrawn. It only marks the RMS0202 rows that are still softened (info), which happens when no install was found.

## 2. What to build, in order

### Item 1. The index on the parse

- `src/parser/types.ts`, `ParseResult` gains `includeIndex?: IncludeIndex` (import the type from `./includeIndex`), with a comment saying the parser worker sets it and `parseRms` never does.
- `src/parser/includeIndex.ts`, `IncludedName` gains `valueText?: string`, the value of a `#const` as written in its file. Take the value token's text, and when it starts with `(` and does not end with `)`, join the following tokens with single spaces up to the one that ends with `)`, as `tokenFilter.ts` reads a parenthesised value. Absent for a `#define`.
- `src/editor/parserWorker.ts`, after `validate`, set `result.includeIndex` to the index it passed as `resolvedIncludes`, when that is defined.

Tests.

1. `includeIndex.test.ts`, `valueText` for `#const A 5`, `#const B (A * 2)` and `#define C` (absent).
2. A wire test (in the existing `wireCodec` test file) that `encodeParseResultForWire` of a parse with an `includeIndex` has no `includeIndex` key.

### Item 2. The lookup

In `src/parser/nameLookup.ts`.

- `ScriptNameIndex` gains `readonly includes?: IncludeIndex`, which `buildScriptNameIndex` copies from `parse.includeIndex`.
- `Resolution` gains `{ kind: "included"; name: IncludedName }`, with a doc comment like its neighbours.
- `resolveName` follows D3. After the built-in branch and before the label branch, gather the script definitions above the use (as `scriptResolution` does) and the included names whose `directiveToken` is above the use and whose `directiveKind` the slot takes (a `#const` for an argument or formula slot, either for a condition slot, the rule `slotTakesSymbol` applies to the script's own). The earliest of them wins. An included name only below the use resolves as `unknown`, since RMS0303 already says what is wrong there and the hover's "defined below" wording names a line the script owns.
- `includesUnread(script)` per D2, and the two early returns in `unknownNameOffer` and `moveUpPlan` use it.
- `Suggestion.source` gains `"included"`, and `Suggestion` gains `file?: string`. `describeSuggestion` returns `` `from ${s.file}${s.conditional ? ", inside a branch" : ""}` `` for it.
- `nameCandidates` adds included names per D4, each once, skipping a name the script already offered.

Then handle `"included"` at every place that switches on a resolution's kind. Find them with `grep -rn 'kind === "script"\|case "script"' src --include=*.ts --include=*.tsx`. Today they are `src/breakdown/constReview.ts` (lines near 73 and 93), `src/editor/aoe2RmsCompletion.ts` (`wordResolvesToConst` and `describeScriptName`) and `nameLookup.ts` itself. In each, an included name counts as resolved, the same as a script name.

Tests, in the name lookup test file (`grep -rln "resolveName" src --include=*.test.ts`), with a hand-built `IncludeIndex` on the parse.

1. A name an include defines, used below its `#include_drs`, resolves as `included` with its file.
2. Used above the directive, it resolves as `unknown`.
3. A name both the script and an include define resolves to whichever comes first, one test each way.
4. `suggest` offers an included `#const` after two typed letters and not after one, ranked after a script name that matches as well.
5. `unknownNameOffer` returns an offer in a script whose index has `installFound: true`, and null when it has `installFound: false`. Use `FOREST_IDENTIFICATION` against a script `#const FOREST_IDENTIFICATIO` and assert the did-you-mean is `FOREST_IDENTIFICATIO`, the Stranded case.
6. `moveUpPlan` no longer refuses with `"includes"` when the install was found.

### Item 3. The hover

In `describeScriptName` (`src/editor/aoe2RmsCompletion.ts`), when the script itself does not define the name but the resolution is `included`, return `` `\`${name}\`, a ${kind} in ${file}, brought in by the #include_drs on line ${line}${value}${branch}.` `` where `kind` is `#const` or `#define`, `line` is the directive's line, `value` is `` `, value ${valueText}` `` when there is one, and `branch` is `", inside a branch there, so only some maps define it"` when `conditional`. Today the function returns early when the script has no definition of the name. Move that test after the included case.

Test in the existing hover or completion test file, the line's text for a `#const` with a value and for a conditional `#define`.

### Item 4. The Constants Usage tool

Per D5. In `src/tools/builtin/constantsAuditor.ts`, `UndefinedReference` gains `softened: boolean`, true when any of its RMS0202 diagnostics has severity `"info"`. The table's rows for those names add, after the name, "(may be in an include file the app could not read)". Nothing else changes. Test in `constantsAuditor.test.ts` with one info and one warning RMS0202.

### Item 5. Documents

- `docs/include-resolution-design.md`, one line under its rev line, "Slice C built <date>". Its Sec.7 already carries D5.
- `docs/name-lookup-design.md` gains a short dated paragraph in its resolution section naming the `included` kind and D3, written to the project's language rules.
- `docs/manual-test-run-sheet.md` gains a section. In `24hr_Bazi is God.rms`, type `MA` in a numeric slot and see `MAPSCALE_AREA` offered with "from includes/scaling.inc", hover it and read its file and value, and watch the flash confirm it. In DE's `Stranded.rms`, open the quick fix on `FOREST_IDENTIFICATION` and see "Did you mean FOREST_IDENTIFICATIO". In Breakdown, a value field in Bazi offers the same included names. With the install's `includes` folder renamed, confirm the quick fixes stay off and the Constants Usage tool marks its rows.

## 3. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green.
- Mutation tested once each, then restored exactly. Make `resolveName` ignore D3's position comparison (item 2 test 3 goes red), drop `INCLUDED_MIN_PREFIX` (item 2 test 4 goes red), and make `includesUnread` return true whenever the script has an include (item 2 test 5 goes red).
- `docs/build-log.md` gains an entry, and `CLAUDE.md`'s test table a row.
