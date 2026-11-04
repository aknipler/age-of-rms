# Include resolution slice A brief, the index and the softening

**This is a work brief for one implementing session, not a design document.** The design is `docs/include-resolution-design.md` (rev 1, CREATION_PLAN A.1). Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself. The owner answered the design's questions on 2026-11-02, and Sec.1 below adds the decisions this brief makes.

Slice A gives the Code tab's checks the names defined in a script's `#include_drs` files, and stops turning "this name is not defined" down to info when those files were read. It builds the pure include index, threads it into `parseRms` and `validate`, and gets the files from the app into the parser worker. It does **not** touch the name lookup, autocomplete, hover, the two quick fixes or the Constants Usage tool (slice C), and it adds neither of the design's two quieting rules (slice B).

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies, so explain the non-obvious decisions in comments. The Hard rules apply, especially that `src/parser/**` imports no React, Monaco or Tauri, no tree-restoring git commands, and `npm run format` at the end.
- Read `docs/include-resolution-design.md` Sec.2 to 4 before item 1.
- Build the items in the order of Sec.3. Each item ends with its tests green before the next one starts.
- Run tests by exact file path while working (`npx vitest run <path>`). Run the full `npm test` once, at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-include-resolution-slice-a.txt` at the end, as the project does.
- Stop and ask the owner, rather than guessing, when a rule here or in the design cannot be followed as written, when an existing test fails for a reason this brief does not explain, or when a test needs a fixture that cannot produce the wrong answer.

## 1. Decisions made for this brief

**D1. `validate` gets an options object, as parser-design Sec.7 already names it.** `validate(result, refDb, opts?: ValidateOptions)` with `interface ValidateOptions { resolvedIncludes?: IncludeIndex }`. The design says "a new optional third argument". This is that argument, in the shape `validate.ts`'s own doc comment reserves. Update that doc comment, it says the parameter is omitted until it has something to carry.

**D2. The parser learns the included names from the text, before it parses.** The parser's RMS0202 check runs inside `parseRms`, before any `ParseResult` exists, so the index (which needs `parse.includes`) cannot feed it. The worker therefore scans the source with `includePathsInText`, walks the cached include files to collect every name they define, and passes that set as `ParseOptions.externalSymbols`. After the parse it builds the full `IncludeIndex` from `parse.includes` for `validate`. Both use the same cache, so the files are parsed once.

**D3. "Unread" is decided per path, and the app says which paths it asked for.** `useIncludeFiles` reads files asynchronously, so for a moment after the user types a new `#include_drs` the worker has files for the old set only. A path the app has not asked for yet is **unread** (softening stays). A path it asked for and the install lacks is **missing** (no softening, DE reads it as empty, design Sec.4.4). So the includes message carries `requested`, every key the loader asked for, beside `files`.

**D4. The worker's cache compares whole texts.** It keeps `Map<key, { text, parse }>`. On a new includes message it reuses an entry whose `text` is identical (`===`) and parses the rest. The design mentions a length and a hash. A string comparison is exact and costs microseconds next to a parse, so it replaces them.

**D5. A definition is conditional when it sits in a branch in its own file, or the directive that brought its file in sits in a branch in the script.** Branch depth at a token is counted over the non-trivia tokens before it, `+1` for `if` and `start_random`, `−1` for `endif` and `end_random`, floored at 0. Use the parser's own `SymbolInfo.conditionalDepth` inside the include file. Use this count for the directive in the script, since `IncludeInfo` carries no depth.

**D6. `#includeXS` never softens once an index is passed.** Today any include in `parse.includes`, XS ones too, softens. With an index, only an unread `#include_drs` softens. Without an index nothing changes, so existing tests and tools keep today's behaviour.

## 2. What exists

Built 2026-11-02 for the preview, all reused here.

- `src/preview/generator/includes.ts`. `IncludeFiles`, `includeKey`, `includePathsIn`, `includePathsInText`, `loadIncludeFiles`, `Insertion`, `mapSpanToSource`.
- `src/useIncludeFiles.ts`. `useIncludeFiles(parseResult)`, with the module-level `findGamedataFolder` and `loadFor` shared by every caller.
- `src/settings/scriptFolder.ts`. `findDeGamedataFolder`, `gamedataFolderIn`.
- `src/parser/parser.ts`. `ParseOptions.builtinConstants` and `isDefinedSymbol`, the precedent for outside names. `this.includes.length > 0` at the two RMS0202 sites and `unresolvedNumericUses[].includesPresent`.
- `src/parser/validate.ts`. `includesPresent` (constructor, and three call sites), `symbolsByName`, `isDefinedAbove` from `scope.ts`.
- `src/editor/parserWorker.ts` and `src/useParsedDocument.ts`. The worker is created on mount and terminated on unmount, never replaced.

## 3. What to build, in order

### Item 1. Move the shared include helpers into the parser

Create `src/parser/includeIndex.ts`. Move `IncludeFiles`, `includeKey`, `includePathsIn` and `includePathsInText` (with `INCLUDE_LINE`) into it, word for word with their comments. `src/preview/generator/includes.ts` re-exports them (`export { … } from "../../parser/includeIndex"`), so no other import changes. `loadIncludeFiles`, `Insertion` and `mapSpanToSource` stay in the generator.

Give `loadIncludeFiles` an optional third parameter, `requested?: Set<string>`, which it fills with every key it asks `read` for, found or not. It is never passed to `map` or `filter` by name, so CLAUDE.md's rule on optional parameters does not bite, but say so in its comment.

Gate. `npx tsc --noEmit -p .` clean, and `src/preview/__tests__/includes.test.ts` green unchanged. Add one test that `requested` holds `gone.inc` after the existing missing-file case.

### Item 2. The index

In `src/parser/includeIndex.ts`, add the types and `buildIncludeIndex` exactly as design Sec.4.2 gives them, with D5's `conditional` rule. Signature:

```ts
export function buildIncludeIndex(
  parse: ParseResult,
  files: IncludeFiles | undefined,
  parseFile: (key: string, text: string) => ParseResult,
): IncludeIndex;
```

- `files === undefined` returns `{ installFound: false, names: new Map(), missing: [] }`.
- Walk `parse.includes` in order, `#include_drs` only (the directive token's text), recurse into each file's own `#include_drs` lines, a key already on the current chain reads as empty. Every name gets the **outer** directive's token index.
- A key `files` lacks goes into `missing` once, by its path as written.

Write `src/parser/__tests__/includeIndex.test.ts`. Made-up files only, so CI runs it without an install.

1. Names from one file, with `directiveToken` pointing at the script's `#include_drs` token.
2. A nested include reports the outer directive's token.
3. A missing file goes into `missing` and adds no names.
4. A file that includes itself, and two files that include each other, finish and list each name once.
5. `conditional` true for a definition inside `if` in its file, true for a plain definition whose directive sits inside `start_random` in the script, false otherwise.
6. `#includeXS` lines are ignored.
7. `files` undefined gives `installFound: false`.

### Item 3. The parser

In `src/parser/types.ts`, `ParseOptions` gains two fields, each with a one-line comment like its neighbours.

- `externalSymbols?: ReadonlySet<string>`. Names defined outside the file (include files). Resolve in numeric slots like `builtinConstants`.
- `includesUnread?: boolean`. Whether a name might come from an include nobody read. Default, any include in the file, today's rule.

In `src/parser/parser.ts`, store both in the constructor as readonly fields beside `builtinConstants` (`this.externalSymbols = opts.externalSymbols ?? new Set()`, `this.includesUnreadOption = opts.includesUnread`). `isDefinedSymbol` returns true for a name in `externalSymbols`, beside the `builtinConstants` line. Replace both `this.includes.length > 0` at the RMS0202 sites with a private method `includesUnread()` returning `this.includesUnreadOption ?? this.includes.length > 0`, read at the time of use (the includes list is still filling while the parse runs). `explainDefinedBelow` keeps reading `use.includesPresent`, renamed `includesUnread`.

Tests in `src/parser/__tests__/` (extend the file that already tests RMS0202, find it with `grep -rln RMS0202 src/parser/__tests__`).

1. A name in `externalSymbols` used in a numeric slot draws nothing.
2. With `includesUnread: false`, an undefined name in a numeric slot of a script with an `#include_drs` is a **warning** with the non-include message.
3. With no options, the same script gives today's info and include sentence (the regression guard).

### Item 4. `validate`

In `src/parser/validate.ts`.

- Add `ValidateOptions` (D1), exported, and the third parameter. Pass it to the `Validator` constructor.
- In the constructor, after the loop over `result.symbols`, add one synthetic `SymbolInfo` per `IncludedName` to `symbolsByName`, `{ name, directiveKind, nameToken: directiveToken, conditionalDepth: conditional ? 1 : 0 }`. Do **not** add them to `symbolByNameToken`, which RMS0301 uses for AST definitions only.
- Rename `includesPresent` to `includesUnread`. Without `resolvedIncludes` it is `result.includes.length > 0` (today). With it, it is true only when `installFound` is false and the script has an `#include_drs` (D6).

Tests, in the existing validate test file for RMS0300 and RMS0303 (find with grep).

1. A label defined only in an include passes an `if` with no RMS0300.
2. A name used above the `#include_drs` that defines it gets RMS0303 at **warning** when the index has `installFound: true`.
3. The same with `installFound: false` gets today's info and include sentence.
4. RMS0300's did-you-mean can suggest an included name (a one-letter typo of it).
5. Without `opts`, every existing validate test passes untouched.

### Item 5. The worker's include state

Create `src/editor/includeCache.ts`, pure (no Tauri, no React), so the worker logic is testable in Node.

```ts
export interface IncludeState {
  /** undefined until the first includes message, null when no install was found. */
  files: IncludeFiles | null | undefined;
  requested: ReadonlySet<string>;
  cache: Map<string, { text: string; parse: ParseResult }>;
}
export function receiveIncludes(
  state: IncludeState,
  files: IncludeFiles | null,
  requested: readonly string[],
  parse: (text: string) => ParseResult,
): IncludeState;
export function parseOptionsFor(
  state: IncludeState,
  source: string,
): { externalSymbols: ReadonlySet<string>; includesUnread: boolean };
export function indexFor(
  state: IncludeState,
  result: ParseResult,
): IncludeIndex | undefined;
```

- `receiveIncludes` applies D4. It drops cache entries whose key is no longer in `files`.
- `parseOptionsFor` scans `source` with `includePathsInText`, walks the files it names transitively through the cache, collects their symbol names, and sets `includesUnread` true when `files` is `undefined` or `null` and the source names an include, or when any key it reaches is not in `requested` (D3). A requested key absent from `files` is missing, not unread.
- `indexFor` returns `undefined` when `files` is `undefined`, else `buildIncludeIndex(result, files ?? undefined, …)` with the cache as `parseFile`. When `files` is `null` it returns an index with `installFound: false`.

Tests, `src/editor/__tests__/includeCache.test.ts`.

1. Before any message, a script with an include gets `includesUnread: true` and no names.
2. After a message with the file, `includesUnread: false` and its names.
3. A key requested but missing from `files` gives `includesUnread: false`.
4. A newly typed include not yet in `requested` gives `includesUnread: true`.
5. A second message with an identical text reuses the cached parse (the same object), a changed text parses again.
6. `null` files give `includesUnread: true` for a script with an include, and an index with `installFound: false`.

### Item 6. The worker and the hook

**Worker** (`src/editor/parserWorker.ts`). Add a message type `IncludesMessage { kind: "includes"; files: IncludeFiles | null; requested: string[] }` beside `ParseRequestMessage`. Keep one module-level `IncludeState`. `onmessage` checks `"kind" in event.data && event.data.kind === "includes"` first and updates the state with `receiveIncludes`, then returns. A parse request passes `parseOptionsFor(state, source)` into `parseRms` beside the two existing options, and `{ resolvedIncludes: indexFor(state, result) }` into `validate`. The parse request's shape does not change.

**Hook** (`src/useIncludeFiles.ts`). Split the hook so the parser can use it with text.

- `useIncludeLoad(source: string | null): { files: IncludeFiles; requested: string[] } | null | undefined`. `undefined` while nothing has loaded or the text names no include, `null` when no install was found. `loadFor` records `requested` through item 1's new parameter and caches it with the files.
- `useIncludeFiles(parseResult)` becomes a wrapper that calls `useIncludeLoad(parseResult?.source ?? null)` and returns `.files` or `undefined`, so its four callers do not change.

**`useParsedDocument`** (`src/useParsedDocument.ts`). Call `useIncludeLoad(content)`. In an effect keyed on its result, post `{ kind: "includes", files, requested }` to the worker (with `null` files when the hook says no install), then send a parse of the current `content` through `sendParseRequest`, bypassing the `lastSentSourceRef` skip, so the diagnostics catch up without waiting for a keystroke. Do not post when the result is `undefined`.

The effect must run again when a new worker is created on mount. Key it on the load result and on a counter state that the mount effect increments after creating the worker. Explain in a comment why a ref alone would not re-run it.

Gate. `npx tsc --noEmit -p .`, `npx eslint` on the changed files, and these test files green, `includeIndex`, `includeCache`, `includes`, and the parser and validate files touched.

### Item 7. Measure

A throwaway probe run by exact path, then deleted, like the design's own (Sec.3). Over the 243 scripts (`test-maps`, `test-maps/local`, `gamedata_x2/*.rms`), with the files read from the install through `loadIncludeFiles`, parse with `parseOptionsFor` and validate with `indexFor`, and count.

1. Diagnostics with the include sentence. Expected **0**.
2. RMS0202 warnings on `Stranded.rms`. Expected **1,887**, all on `FOREST_IDENTIFICATION`.
3. RMS0202 warnings on the other scripts. Expected about **71** (42 unguarded, 14 under their own name's `if`, 15 under another `if`, design Sec.3). Write the real number in the build log.
4. RMS0300 warnings. Expected about **197** (195 numbered-family sites plus AK_Namatjira's 2). Slice B's Rule 2 removes these.

If 1 or 2 differ, stop and ask. 3 and 4 may differ by a few, since slice A has neither of slice B's rules. Record what they are.

## 4. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green.
- `includeIndex.test.ts` and `includeCache.test.ts` exist with the cases above. Mutation test three things once each, then restore them exactly. Make `parseOptionsFor` treat a requested but missing key as unread (test 3 goes red), make `buildIncludeIndex` use the inner directive for a nested name (test 2 goes red), and make `validate` ignore `resolvedIncludes` (item 4 test 2 goes red).
- Item 7's four numbers are in the build log entry.
- `docs/manual-test-run-sheet.md` gains a section. Open `24hr_Bazi is God.rms`, confirm no "may come from an include file" info lines remain once the files load, then misspell `MAPSCALE_AREA` once and confirm a yellow warning. Open DE's `Stranded.rms` and confirm the `FOREST_IDENTIFICATION` warnings. Rename the install's `includes` folder, restart, and confirm the info lines come back.
- `docs/build-log.md` gains an entry, and `CLAUDE.md`'s test table a row.
- `docs/include-resolution-design.md` gets one line under its rev line, "Slice A built <date>", nothing else.
