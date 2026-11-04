# Token alias slice A brief, the token data and the preview re-parse fix

**This is a work brief for one implementing session, not a design document.** The design is `docs/token-alias-design.md` (rev 1, CREATION_PLAN A.2). Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself. The owner answered the design's questions on 2026-11-02, and Sec.1 below adds the decisions this brief makes.

Slice A puts the engine's token numbers from the RMS Equivalencies sheet into `language.json` as data, with where each came from, and fixes a preview defect found while designing (the preview's second parse drops the comment-alias option). It changes **no** lexer, parser or diagnostic behaviour. The comment close (slice B) and comments in dead code (slice C) wait on RMSTEST Batch 20.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. The Hard rules apply, especially that vocabulary is data-driven, that `npm run validate:reference` runs after any edit to `language.json`, no tree-restoring git commands, and `npm run format` at the end.
- Read `docs/token-alias-design.md` Sec.2 to 5 and parser-design Sec.2.1 before item 1.
- Build the items in the order of Sec.3. Each item ends with its tests green before the next one starts.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-token-alias-slice-a.txt` at the end.
- Stop and ask the owner when a rule here or in the design cannot be followed as written, when the import reports an ID clash, or when any existing test changes result.

## 1. Decisions made for this brief

**D1. Every `tokenId` carries a `tokenIdSource`, and only measured IDs drive the parser.** `language.json` already uses `CommandDef.tokenId` for one thing, the parser's alias lookup (`commandsByTokenId` in `src/parser/language.ts`), so a `#const X 32` makes `X` a `create_land`. Writing the sheet's numbers onto every command would quietly switch that lookup on for all of them, which the design rules out for lack of any population (Sec.3.3). So the new field `tokenIdSource: string` names where the number came from, either a run (`"RMSTEST_62"`) or the sheet (`"equivalencies-2026-11-02"`). `buildLanguageIndex` builds `commandsByTokenId` from entries whose source starts with `RMSTEST_` only. `create_land` keeps behaving exactly as today.

**D2. The `/*` and `*/` numbers stay constants in code, pinned to the data by a test.** `COMMENT_OPEN_ID = 69` is imported by `src/breakdown/constReview.ts` and `src/editor/constOffers.ts`, neither of which has the language data. Threading the data into both for a number that cannot change between game versions is churn. Instead, add `COMMENT_CLOSE_ID = 70` beside it in `validate.ts`, and a test asserts both equal the `tokenId` of `/*` and `*/` in `structuralTokens`. The design's Sec.4 wording ("becomes a read of `structuralTokens`") is updated to this in the same session.

**D3. The import script writes ids and sources only, never notes.** `notes` is human prose, and 150 lines of "from the sheet" in it would bury what the notes say. `tokenIdSource` carries the provenance, and the design names the sheet once.

**D4. The preview gets the parse options through `instantiateScript`'s sixth parameter.** `instantiateScript(parse, refDb, settings, seed, includeFiles?, parseOptions?: ParseOptions)`. `generatePreview` builds the options once per `constants` array (a module-level `WeakMap<readonly ObjectConstant[], ParseOptions>`) with `commentOpenAliases` and `builtinConstantNames` from `validate.ts`, the same two the parser worker passes. `instantiateScript` is not passed to `map` by name, so the optional-parameter rule does not bite. Say so in a comment.

## 2. The data source

The sheet was read on 2026-11-02 through `https://docs.google.com/spreadsheets/d/1gr37obgoA_oa_Yikw8rt4AmNtRk4czX9VcRPkQQZPEc/export?format=csv&gid=0`. The CSV's first column is the ID and its second the RMS keyword. Fetch it into a scratch folder outside the repo with `curl -sL -o <scratch>/sheet.csv "<url>"`. Do not commit the CSV. If the fetch fails or the file does not start with `ID,rms token,`, stop and ask the owner.

The expected match against `language.json` (measured while designing).

- 153 rows, IDs 0 to 152.
- Every command, attribute, directive and control keyword in `language.json` matches a row by exact name, **except** seven entries the sheet lacks: `terrain_state`, `weather_type`, `create_connect_teams_lands`, `building_architecture`, `match_player_civ`, `other_zone_avoidance_distance`, `temp_min_distance_to_players`. They get no `tokenId`.
- Two rows match nothing in `language.json`, `set_other_zone_avoidance_distance` (31) and `create_connect_teams_land` (64). They are not imported, and the import prints them.
- Seven rows are section headers (`<PLAYER_SETUP>` 11, `<LAND_GENERATION>` 17, `<CLIFF_GENERATION>` 34, `<TERRAIN_GENERATION>` 42, `<OBJECTS_GENERATION>` 47, `<CONNECTION_GENERATION>` 62, `<ELEVATION_GENERATION>` 79) and four are `{` 67, `}` 68, `/*` 69, `*/` 70. These go into `structuralTokens`.
- `create_land` is 32 in the sheet, the same as its measured `tokenId`. Any other disagreement between a measured ID and the sheet is a stop-and-ask.

## 3. What to build, in order

### Item 1. The schema and the gate

In `reference/schemas/language.schema.json`.

- `tokenId` (integer, minimum 0) and `tokenIdSource` (string, pattern `^(RMSTEST_[0-9A-Za-z_]+|equivalencies-\d{4}-\d{2}-\d{2})$`) on command, attribute, directive and control keyword entries. Rewrite the command's `tokenId` description, it now says "ONLY when a run has measured it". It becomes, a number from a run or the sheet, `tokenIdSource` says which, and only run-measured numbers drive alias resolution.
- A new top-level `structuralTokens`, an array of `{ text: string, tokenId: integer, tokenIdSource: string }`, with `additionalProperties: false`.

In `scripts/validate-reference-data.mjs`, replace the command-only `tokenId` block with one over every entry kind and `structuralTokens`.

1. No two entries share a `tokenId`, across all kinds.
2. Every `tokenId` has a `tokenIdSource`, and every `tokenIdSource` has a `tokenId`.
3. A `tokenIdSource` naming a run also has `notes` (the existing rule that the run is described, now keyed on the source).
4. No two `structuralTokens` share a `text`.

Gate. Mutation test each of the four once against a temporary bad copy (never against `language.json` itself), and `npm run validate:reference` green on the real file before item 2 starts. `create_land` needs `"tokenIdSource": "RMSTEST_62"` added by hand first.

### Item 2. The import script

`tools/token-ids/import.mjs`, Node, no dependencies. `node tools/token-ids/import.mjs <path to sheet.csv>`.

- Reads the first two columns of each row.
- Sets `tokenId` and `tokenIdSource: "equivalencies-2026-11-02"` on every entry whose `name` equals the keyword. An entry that already has a run-sourced `tokenId` keeps its source, and a different number there exits with an error.
- Writes `structuralTokens` for the section headers and the four markers, in ID order.
- Prints the unmatched rows and the `language.json` entries left without an ID. The expected lists are in Sec.2.
- Writes `language.json` with `JSON.stringify(data, null, 2) + "\n"`, then the session runs `npx prettier --write reference/data/language.json`.

Also `tools/token-ids/README.md`, a few lines saying what the script does, where the sheet is, that the CSV is never committed, and that a newer copy of the sheet is imported by running it again.

Gate. The two printed lists equal Sec.2's. `npm run validate:reference` green. `git diff --stat reference/data/language.json` shows additions only, no removed lines (read the diff, do not restore anything with git).

### Item 3. The alias lookup keeps its old behaviour

In `src/parser/language.ts`, add `tokenIdSource?: string` to `CommandDef`, `AttributeDef`, `DirectiveDef` and the control keyword type, `tokenId?: number` where it is missing, and `structuralTokens?: { text: string; tokenId: number; tokenIdSource: string }[]` to `LanguageData`. `buildLanguageIndex` skips a command whose `tokenIdSource` does not start with `RMSTEST_` when it builds `commandsByTokenId` (D1). Explain in a comment why the sheet's numbers do not feed it.

Tests, beside the existing `commandsByTokenId` tests (find with `grep -rln commandsByTokenId src`).

1. `commandsByTokenId` holds 32 and no other id, read from the real `language.json`.
2. A script with `#const L 48` and `L { number_of_objects 1 }` still reports `L` as unknown (48 is `create_object` in the sheet, not measured). This is the test that fails if D1 is skipped.
3. The existing `#const L 32` alias test still passes.

### Item 4. The pinned constants

In `src/parser/validate.ts`, add `export const COMMENT_CLOSE_ID = 70` beside `COMMENT_OPEN_ID` with a comment pointing to the design's Sec.3.1 and saying no behaviour uses it until slice B. Test, in a new `src/parser/__tests__/tokenData.test.ts`, that both constants equal `structuralTokens` in `language.json` for `/*` and `*/`, and that every section in `sections` has a `<NAME>` row in `structuralTokens`.

### Item 5. The preview's second parse

Per D4. In `src/preview/generator/instantiate.ts`, the new parameter is passed to both `parseRms` calls (the re-parse of the filtered text, and the include files' tokens in the `IncludeSource`). In `src/preview/generator/index.ts`, `generatePreview` builds and passes it.

Test, in `src/preview/__tests__/instantiate.test.ts`. The order matters. First a conditional that spans a section header, so the input parse has an RMS0110 region and `instantiateScript` runs the token filter. **Below it**, `/* SHORE_FISH */` and then a `create_land { land_percent 10 }`. Parse the script with `parseRms(text, lang, { commentOpenAliases })`, as the worker does, so in the input parse the comment runs to the end of the file and the `create_land` is hidden. Assert that `instantiateScript` with the new parameter yields no `create_land`, and that without the parameter it yields one, which is the defect (the second parse closes the comment at its `*/`). Put the comment above the conditional instead and the filter never runs, so the test proves nothing. Say so in the test's comment. Then the full `npm test`, since a DE gate map could change if it has such a comment. If any gate map changes, stop and ask.

### Item 6. Documents

- `docs/parser-design.md` Sec.2.1 gains a paragraph, written to the project's language rules, recording the two findings of design Sec.3.2 and 3.3. Words valued as control words do nothing in dead code (597 in the 342 matched maps), and live keyword aliases beyond commands have no population. Cite the design.
- `docs/token-alias-design.md`, one line under its rev line, "Slice A built <date>", and Sec.4's `COMMENT_OPEN_ID` bullet updated to D2.
- `README.md`'s thanks to Zetnus gains the RMS Equivalencies sheet beside the guide and the reference sheets.

## 4. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .`, `npm run validate:reference` and `npm run check:generated-types` are green.
- `language.json` carries `tokenId` and `tokenIdSource` on every exact match, and `structuralTokens` has 11 rows.
- The four gate checks of item 1 and item 3's test 2 were each mutation tested once, then restored exactly.
- `docs/build-log.md` gains an entry, and `CLAUDE.md`'s test table a row.
