# Token alias slice B brief, a word valued 70 closes a comment

**This is a work brief for one implementing session, not a design document.** The design is `docs/token-alias-design.md` (rev 1, CREATION_PLAN A.2), Sec.3.1 and 5 (B1) in particular, with the amendment under B1 dated 2026-11-03. Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself.

Slice A (built 2026-11-03, `docs/build-log.md`) put the engine's token numbers into `language.json` and added `COMMENT_CLOSE_ID = 70` with nothing reading it. RMSTEST Batch 20 (run 2026-11-02, read 2026-11-03, `tools/scenario-probe/rmstest/README.md`) opened this slice. 82a came back snow with both controls grass, so a word valued 70 ends a live comment, and 83 placed town centres, so Chaotic Strait's nested comment ends and the rest of the map runs. 84a came back grass, so slice C is not built and this slice records that answer.

Slice B models the close in the lexer, adds **RMS0112** and **RMS0113**, rewrites **RMS0111**'s check so it reads comments the way the game does, and corrects the docs that say Chaotic Strait loses half its lines.

**Slice A must be in the tree.** It added `COMMENT_CLOSE_ID` to `src/parser/validate.ts`, `structuralTokens` to `language.json`, `src/parser/__tests__/tokenData.test.ts`, and the sixth `parseOptions` parameter of `instantiateScript`. If any is missing, stop and say so.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. The Hard rules apply, especially "never silently drop content", "a check that has only ever passed proves nothing", no tree-restoring git commands, and `npm run format` at the end.
- Read the design's Sec.3.1 and 5, parser-design Sec.11 item 7 (the BUG-012 history and the corpus table), and the RMS0111 code in `src/parser/validate.ts` (`checkCommentOpeningWords`) and `src/parser/lexer.ts` (`markComments`) before item 1.
- Build the items in the order of Sec.2. Each item ends with its tests green before the next one starts. Run tests by exact path while working, the full `npm test` once at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-token-alias-slice-b.txt` at the end.
- Stop and ask the owner when a rule here or in the design cannot be followed as written, when an existing test changes for a reason this brief does not name, or on any trigger in Sec.3.

## 1. Decisions made for this brief

**D1. The lexer models the close for the game's own names, the same way it models the open.** `LexOptions` and `ParseOptions` gain `commentCloseAliases?: ReadonlySet<string>`, built by a new `commentCloseAliases(constants)` in `validate.ts`. Inside a comment, such a word lowers the depth by one, and when the depth reaches 0 the comment ends after the word. The word itself stays trivia, like a written `*/`. Outside a comment it is an ordinary word. A script's own `#const NAME 70` is not modelled by the lexer, for the reason `commentOpenAliases`' comment gives for 69 (the lexer does not read the directive stream). The expected engine set is exactly `ATTR_ATTACK_GRAPHIC`, `CITY_OF_LAKES` and `HOUSE`.

**D2. `validate` reads comments through its own walk, so its reports do not depend on how the parse was configured.** Today RMS0111 scans trivia tokens, which only works because a 69 word swallows the rest of the file. With closes, RMS0111 and RMS0112 both need the comment depth the game sees, and the parse handed to `validate` may have been made with no alias sets at all (every test in `validate.test.ts` is). So a new pure module `src/parser/commentWalk.ts` walks the tokens and resolves each word inside a comment itself, the game's own names first and then the script's `#const` literals, the order RMS0111 already uses. A corpus test pins the walk to the lexer (item 5), which is what keeps the two from drifting.

**D3. A word valued 69 is always reported, once per comment as the game reads it, at the severity of what it costs.** At the first word valued 69 in a game comment.

- **RMS0111, error**, when that comment runs to the end of the file (today's message, unchanged), or when it swallows a token that the written markers alone leave live (a second message naming the line where the game's comment ends).
- **RMS0113, info (new)**, when the game's comment ends before the end of the file and everything it skipped was inside written comments anyway. Nothing is lost today, but the word still moves where the comment ends, and rewording or removing whatever closes it later would make the game skip the code below. That is Chaotic Strait. Without `SHORE_FISH` the `HOUSE` on line 560 would end its comment. With it the comment runs on to line 561, and if both `HOUSE` words went, the rest of the map would go with them.

Info and not warning, since the map works as written and the code is only fragile. The owner asked on 2026-11-03 that the case still be pointed out. The design was amended to say so the same day.

**D4. RMS0112 fires on every word valued 70 inside a game comment.** Warning severity, as the design says, since the text after the word often does nothing (Fortress). Two message forms. When the depth after the word is 0, the comment ends at the word. When it is above 0, the word closes one level of a nested comment, so the comment ends sooner than its markers say. Every hit is reported, not only the first, because each one moves where the code starts running.

**D5. The `#const` offers warn at 70 as they do at 69.** `commentOpenWarning` in `src/breakdown/constReview.ts` becomes `commentMarkerWarning`, and `valueSuffix` in `src/editor/constOffers.ts` gains the 70 sentence. A name created with value 70 closes a comment wherever it later appears inside one, which is the same hazard Sec.7.4 of the name lookup design guards for 69.

**D6. Not in this slice.** Each is recorded so it is not built by accident.

- The Code tab's colouring. Monaco colours comments by their written markers and does not model 69 either, so text after a close word still looks like a comment there. The squiggle is the signal.
- The Breakdown comment out button. It writes `/* … */` around a card, so commenting out a `create_object HOUSE` card gives the Fortress shape. The new warning shows on the result, which is the honest outcome. A guard is a separate feature.
- What the game does with a block left with no command (`{ number_of_objects 4 … }` after a closing word). The parser's existing rule applies (`OrphanBlockNode` and RMS0102, parser-design Sec.5.4), and the preview keeps treating it as unsimulated. No run has measured it.
- The houses in DE's `GeneratingObjects.inc` (Sec.4). The preview will place them where the lobby routes there, which is what RMSTEST_82a predicts, but no run on those maps has confirmed it.

## 2. What to build, in order

### Item 1. The alias set and the lexer

In `src/parser/validate.ts`.

- Factor the body of `commentOpenAliases` into a private `aliasesValued(constants, id)`, and add `export function commentCloseAliases(constants)` returning `aliasesValued(constants, COMMENT_CLOSE_ID)`. Same structural parameter type, same `NON_AMBIENT_CONSTANT_CATEGORIES` rule.
- Rewrite `COMMENT_CLOSE_ID`'s comment. It is now read by `commentCloseAliases` and the walk, measured by RMSTEST_82a, and Chaotic Strait (RMSTEST_83) is its corpus case.
- `COMMENT_OPEN_ID`'s comment says the check is "deliberately one-sided". Drop that sentence.

In `src/parser/types.ts`, add `commentCloseAliases?: ReadonlySet<string>` to `LexOptions` (with a doc comment beside `commentOpenAliases`', saying the word ends a comment level only while one is open) and to `ParseOptions`. In `src/parser/parser.ts`, pass it to `tokenize` beside `commentOpenAliases`.

In `src/parser/lexer.ts`, `markComments` takes the new set as a fifth parameter. In the `depth > 0` branch:

```ts
if (token.kind === "word") {
  if (commentOpenAliases?.has(token.text)) {
    if (nestedComments) depth++;
  } else if (commentCloseAliases?.has(token.text)) {
    depth--;
  }
}
token.isTrivia = true;
```

The word is marked trivia before the depth is read again, so it belongs to the comment it closes. Extend the doc comment of `markComments` with the close rule and RMSTEST_82.

Tests, a new `describe` in `src/parser/__tests__/lexer.test.ts` after the opening aliases block, with `CLOSES = new Set(["HOUSE", "ATTR_ATTACK_GRAPHIC"])` and the existing `live` helper.

1. RMSTEST_82a. `/* HOUSE create_terrain SNOW { base_terrain GRASS land_percent 100 } */` with `commentCloseAliases: CLOSES` leaves `create_terrain SNOW { base_terrain GRASS land_percent 100 }` live, and the lexer reports RMS0002 on the final `*/`.
2. RMSTEST_82b. The same with `TOWN_CENTER` leaves nothing live.
3. RMSTEST_82c. The same with the literal `70` leaves nothing live.
4. `create_object HOUSE { number_of_objects 1 }` is untouched.
5. With no set supplied, test 1's text leaves nothing live.
6. `/* /* HOUSE */ x */ y` leaves `x` and `y` live (the word closed the inner level, so the first written `*/` closed the outer one and the last is a stray).
7. The Chaotic Strait shape with both sets. `/* /* SHORE_FISH */ HOUSE HOUSE a */ b` leaves `a` and `b` live.
8. With `nestedComments: false`, `/* HOUSE a */` leaves `a` live.

### Item 2. Every parse the app makes takes the close set

Find the sites with `grep -rn "commentOpenAliases" src`. Every call that passes `commentOpenAliases` to `parseRms` for the app, or to mirror the app, also passes `commentCloseAliases` built from the same constants. That is

- `src/editor/parserWorker.ts`, a module constant `COMMENT_CLOSE_ALIASES` beside `COMMENT_OPEN_ALIASES`, used in the include state's parse and the main parse,
- `src/preview/generator/index.ts`, `parseOptionsFor`, so `instantiateScript`'s second parse and the include files get it through slice A's parameter,
- `src/parser/__tests__/includeResolution.measure.test.ts`, both sites,
- `src/parser/liveness/__tests__/liveness.measure.test.ts`, both sites, and `src/parser/liveness/__tests__/fixtures.test.ts`.

Leave `lexer.test.ts`, `fence.test.ts`, `instantiate.test.ts` and `src/preview/__tests__/index.test.ts` alone, since each tests the open rule by itself. The corpus census is item 5.

Update the parser worker's comment above its main parse ("The lexer needs this to model the truncation") to cover both words.

Gate. `npm test` on the parser, preview and liveness folders by path, green, then the full `npm test`. The whole-script DE gate (`deWholeScriptMaps.test.ts`) must not change. None of its 234 probe scripts has a word valued 70 in a comment, but four Rage Forest probes and the Bazi maps read DE's `GeneratingObjects.inc`, which does (Sec.4). If any gate map changes, stop and ask.

### Item 3. The comment walk

New file `src/parser/commentWalk.ts`, pure, importing only types from `./types`.

```ts
/** What a word inside a comment does to the game's comment depth. */
export type CommentMarker = "open" | "close";

/** One comment as the game reads it, from the token that opens it to the token that brings the depth back to 0. */
export interface GameComment {
  start: number;
  /** Token index where the depth returns to 0, or null when it runs to the end of the file. */
  end: number | null;
}

export interface CommentWalk {
  /** Per token, 1 when the game reads it as part of a comment, markers and stray closes included. */
  gameComment: Uint8Array;
  /** Per token, 1 when the written markers alone put it inside a comment, the same marking with no words resolved. */
  writtenComment: Uint8Array;
  comments: GameComment[];
  /** Every word that acted as a marker, in order. `comment` indexes `comments`. */
  hits: {
    index: number;
    marker: CommentMarker;
    depthAfter: number;
    comment: number;
  }[];
}

export function walkComments(
  tokens: readonly Token[],
  markerOf: (word: string) => CommentMarker | undefined,
): CommentWalk;
```

Rules, chosen to mark exactly what `markComments` marks when comments nest (the default, and what the worker uses).

1. Two depth counters, game and written, both starting at 0.
2. A `commentOpen` token raises both and is marked in both arrays. When the game depth goes from 0 to 1, a new `GameComment` starts there.
3. A `commentClose` token is marked in both arrays, and lowers each counter that is above 0. When the game depth reaches 0, the current comment's `end` is this token.
4. Any other token is marked in an array when that array's counter is above 0 before it. Only when the game depth is above 0 and the token is a `word`, `markerOf(text)` is asked. `"open"` raises the game depth. `"close"` lowers it, and when it reaches 0 the comment's `end` is this token. Either records a hit with the depth after it.
5. A comment still open at the end of the file keeps `end: null`.

The byte-order mark the lexer marks trivia is the one place the two disagree. Say so in the module comment rather than special-casing it here.

Tests in a new `src/parser/__tests__/commentWalk.test.ts`, tokens from `tokenize(text)` with no options, `markerOf` from a two-entry map (`SHORE_FISH` open, `HOUSE` close).

1. `a /* b */ c` gives one comment from 1 to 3, both arrays `0,1,1,1,0`, no hits.
2. `/* /* SHORE_FISH */ HOUSE HOUSE a */ b` gives one comment ending at the second `HOUSE`, two close hits with `depthAfter` 1 then 0, `a` and `b` unmarked in `gameComment` and marked in `writtenComment` for `a` only.
3. `/* SHORE_FISH */ x` gives one comment with `end: null`.
4. `/* HOUSE */ /* HOUSE */` gives two comments, since the depth returned to 0 between them.

### Item 4. RMS0111, RMS0112 and RMS0113 in `validate`

In `src/parser/diagnostics.ts`.

- `RMS0112` in `DIAGNOSTIC_CODES`, severity `"warning"`, summary "A word inside a comment resolves to 70, which the engine reads as a closing comment marker. The code after it runs".
- `RMS0113` in `DIAGNOSTIC_CODES`, severity `"info"`, summary "A word inside a comment resolves to 69 and opens a nested comment that something later closes again. Nothing written to run is skipped yet".
- A new `commentOpenedAndClosed(token, source, endLine: number)` for RMS0113, `"${token.text}" inside this comment has the value 69, which the game reads as an opening comment marker (${source}). That opens a second comment, and something later in it closes that one again, so the comment ends on line ${endLine}. Nothing written to run is skipped today, but rewording or removing what closes it would make the game skip the code below. Split the word.` Doc comment saying why it is info (the map works as written) and why it is reported at all (the owner's call, D3).
- `RMS0111`'s summary drops "Everything below it is invisible to the game" and says the game skips code after it.
- `commentOpensNestedComment(token, source, endLine?: number)`. With no `endLine`, today's message exactly, so the existing tests keep passing. With one, `"${token.text}" inside this comment has the value 69, which the game reads as an opening comment marker (${source}). That opens a second comment, so the game keeps skipping code that was written to run, up to line ${endLine}. Split the word, or move this comment below the rest of the script.`
- A new `commentClosedByWord(token, source, endsComment: boolean)` for RMS0112. When `endsComment`, `"${token.text}" inside this comment has the value 70, which the game reads as a closing comment marker (${source}). The comment ends here and the game runs what follows as code. Split the word, or reword the comment.` Otherwise `"${token.text}" inside this comment has the value 70, which the game reads as a closing comment marker (${source}). It closes one level of this nested comment, so the comment ends sooner than its markers say. Split the word, or reword the comment.` Doc comment in the style of `commentOpensNestedComment`'s, naming RMSTEST_82 and 83 and saying why it is a warning.

In `src/parser/validate.ts`, replace `checkCommentOpeningWords` with `checkCommentMarkerWords`, called from the same place.

1. Build `markerOf(word)`. The ambient engine constant first, the same `find` the current code makes, giving `"open"` for `COMMENT_OPEN_ID` and `"close"` for `COMMENT_CLOSE_ID`. Otherwise the script's own `#const` whose value token's text is `"69"` or `"70"`. Keep the `source` label each case gives (`the game's own ${category} constant`, or `this script defines it as 69` or `as 70`) in a map keyed by word, so the messages can name it.
2. `const walk = walkComments(this.tokens, markerOf)`.
3. RMS0111 and RMS0113, per D3. For each comment in `walk.comments`, take its first `"open"` hit, if it has one. When `comment.end === null`, RMS0111 with no `endLine`. Otherwise, with `endLine = this.lineOf(this.tokens[comment.end].start)`, RMS0111 with that line when some token after the hit, up to and including `comment.end`, has `gameComment` 1 and `writtenComment` 0, and RMS0113 with that line when none has. Exactly one of the three per comment that holds a 69 word.
4. RMS0112, per D4. Every `"close"` hit, with `endsComment` set from `depthAfter === 0`.

Rewrite the method's doc comment. It still names the measurement and the positive resolution rule. It drops "Reported, not modelled, decided 2026-08-11, do not re-open", which the 2026-08-12 reversal in parser-design Sec.11 item 7 already overturned, and "Only the FIRST hit is reported", which D3 replaces. The comment on `commentOpenAliases` that points at `checkCommentOpeningWords` follows the rename.

Tests in `src/parser/__tests__/validate.test.ts`. The RMS0111 `describe` keeps its six tests unchanged. Its header comment's "Reported rather than modelled" sentence goes. Add, with the existing `only` helper (which parses with no alias sets, the case D2 exists for).

1. The Chaotic Strait shape gives RMS0113 and no RMS0111. `/*\n/* SHORE_FISH */\nHOUSE HOUSE\n*/\n<PLAYER_SETUP>\nrandom_placement\n` gives one RMS0113, severity `"info"`, naming `SHORE_FISH` and containing "ends on line 3".
   1a. `/* SHORE_FISH */ */\n<PLAYER_SETUP>\nrandom_placement\n` gives one RMS0113 too, since an extra written `*/` closes the nested level and nothing meant to run is skipped. This is the case where what closes it is a marker, not a word, which is why the message says "something later".
2. RMS0111 fires with the line when code meant to run is skipped. `/* SHORE_FISH */\n<PLAYER_SETUP>\nrandom_placement\n/* HOUSE */\n<LAND_GENERATION>\n` gives one RMS0111 whose message contains "up to line 4".
3. Two comments that each end, each with its own 69 word that skips live code, give two RMS0111. Write the source so both are shaped like test 2.
4. RMS0112 on `/* place a HOUSE here */\n<PLAYER_SETUP>\nrandom_placement\n` gives one warning naming `HOUSE` and containing "runs what follows as code".
5. `ATTR_ATTACK_GRAPHIC` gives one too.
6. The literal `70` gives none.
7. `create_object HOUSE { number_of_objects 1 }` in `<OBJECTS_GENERATION>` gives none.
8. `#const MY_HOUSE 70` then `/* MY_HOUSE */` gives one whose message contains "this script defines it as 70".
9. Test 1's source gives two RMS0112, the first containing "one level", the second "runs what follows as code".

### Item 5. The corpus gates

In `src/parser/__tests__/corpus.test.ts`.

**The 69 census.** `liveTokens` passes both sets, built once from `refDb.gameConstants.constants`, and compares against no options, so it measures what the worker shows. Expected change, Chaotic Strait leaves `affected` (with both sets it has more live tokens than with none, since its comment now ends at line 561). `broken/BCC2-Rekawa.rms` stays, and is still on every clone, so the `>= 1` assertion keeps its meaning. Update the describe's header comment, which says two tracked maps lose half their lines. If BCC2-Rekawa leaves `affected`, stop and ask.

**A new 70 census**, a sibling `describe` in the same shape. It asserts the close set is exactly `["ATTR_ATTACK_GRAPHIC", "CITY_OF_LAKES", "HOUSE"]`, prints the maps where a word valued 70 inside a comment ends one (more live tokens with both sets than with the open set alone), and asserts at least one, since `Chaotic_Straitv0.99.rms` is whitelisted in `.gitignore`. Selected from disk, never named, as the 69 census does. Expected on a maintainer's disk, `Chaotic_Straitv0.99.rms`, `24hr_Mont Saint Michel.rms` and `local/Fortress.rms`.

**The walk agrees with the lexer.** For every map in `allMaps`, `walkComments(tokens, markerOf)` with a `markerOf` built from the two engine sets only gives `gameComment[i] === 1` exactly where the lexer, given both sets, marks `isTrivia`, for every token except a leading byte-order mark. Report the first disagreeing map, line and token in the failure message.

### Item 6. The const offers

Per D5. In `src/breakdown/constReview.ts`, rename `commentOpenWarning` to `commentMarkerWarning`, return the existing sentence for 69 and `"70 ends a comment wherever this name appears inside one (RMS0112)"` for 70, and update its one caller in `src/breakdown/cards/ConstOfferStrip.tsx`. In `src/editor/constOffers.ts`, `valueSuffix` gains `". 70 ends a comment wherever this name appears inside one (RMS0112)"` for 70, with `COMMENT_CLOSE_ID` imported beside `COMMENT_OPEN_ID`.

Tests. `constReview.test.ts`'s "warns about 69 and only 69" becomes "warns about 69 and 70 and nothing else" and checks 68, 69, 70 and 71. That is the one existing test this brief changes on purpose. `constOfferFlow.test.tsx` gains a 70 case beside its 69 case, matching `/RMS0112/`. No new UI element, so no HelpTip.

### Item 7. Documents

Every new sentence follows the project's language rules (CLAUDE.md, no colons, semicolons, em dashes or hyphens as punctuation in prose).

- `docs/parser-design.md` Sec.11 item 7. A new dated paragraph after the corpus table, leaving the old prose alone. It says the Chaotic Strait row is wrong (RMSTEST_83 placed its town centres), that the comment ends at line 561 on the two `HOUSE` words, that the lexer models a word valued 70 since this slice, and the re-measured census from item 5 (which maps still lose lines to a 69 word, and which maps run text after a 70 word). Copy the numbers from the test's printed output, not from this brief.
- `docs/parser-design.md` Sec.10's table. An RMS0112 row, warning, an RMS0113 row, info, and one sentence on RMS0111's row for D3.
- `docs/parser-design.md` Sec.2.1, the paragraph slice A added on the sheet. One sentence for RMSTEST_84a, a comment word valued as a control word does nothing in dead code either, so slice C was not built.
- `docs/name-lookup-design.md` Sec.7.4, one sentence that the offer warns at 70 too.
- `docs/token-alias-design.md`, one line under its rev line, "Slice B built <date>".
- `tools/scenario-probe/rmstest/README.md`, under "Still open: the closing marker", one line saying Batch 20 closed it and pointing to that batch.
- `src/tools/builtin/landPlacement/fence.ts`'s header comment lists two hazards inside a comment. Add the 70 word to the second, in one clause. The escaping already covers it, since a closing word also has to be its own token.
- `src/tools/builtin/formatter/layout.ts`, the comment on `triviaUnitEnd` says the recount can only run short. With closing words it can also run long, which treats the run as one unit. Whitespace only either way. Correct the comment.
- `docs/manual-test-run-sheet.md`, the next free section (56 when this brief was written), checks in the app.
  1. Open `test-maps/Chaotic_Straitv0.99.rms`. Confirm an RMS0113 note (info, not an error) on `SHORE_FISH` at line 547 naming line 561, RMS0112 on the `HOUSE` of line 560 ("one level") and of line 561 ("runs what follows"), the Breakdown tab shows the `create_object TOWN_CENTER` card from line 567, and the preview draws town centres.
  2. Open `test-maps/local/Fortress.rms` or DE's own `Fortress.rms`. Confirm RMS0112 on `HOUSE` at line 428.
  3. At the top of any map type `/* place a HOUSE here */` on its own line. Confirm the warning appears, and that the Code tab still colours the line as a comment (D6).
  4. In the Breakdown tab, comment out a `create_object HOUSE` card with the comment out button. Confirm RMS0112 appears on the result and its block shows as a card of its own (D6).
  5. Create a `#const` from an offer with the value 70. Confirm the RMS0112 sentence shows beside Create.

## 3. Stop and ask the owner when

- Any `deWholeScriptMaps.test.ts`, `landStageDeMaps.test.ts` or `deElevationCliffMaps.test.ts` map changes result.
- `npm run measure:includes` fails. None of its pinned RMS0202 or RMS0300 sites sits in text a closing word makes live, so any move is unexplained.
- BCC2-Rekawa leaves the 69 census, or the 70 census finds a map outside the three expected that is not explained by a word in the close set.
- The walk and the lexer disagree on any corpus map (item 5's third test).
- Chaotic Strait does not get exactly one RMS0113 and no RMS0111 after item 4.

## 4. The census behind this brief

Measured 2026-11-03 with a throwaway token walk over `test-maps` (with `local` and `broken`), every `.rms` and `.inc` in the install's `gamedata_x2`, and the 234 probe scripts in `tools/scenario-probe/de-study/probes`. The item 5 tests are what re-derive these, so treat these as what to expect, not as figures to copy.

| File                                         | Word, line                                     | What the game does                                                                                                                     |
| -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Chaotic_Straitv0.99.rms`                    | `HOUSE` 560 (one level), `HOUSE` 561 (ends it) | The rest of 561 is a block with no command, 562's `create_object HOUSE` runs, 563's `*/` is a stray close, and the map runs to its end |
| `Fortress.rms`, DE's and the local copy      | `HOUSE` 428                                    | The disabled block after it is a block with no command, and its last `*/` is a stray close                                             |
| `24hr_Mont Saint Michel.rms`                 | `ATTR_ATTACK_GRAPHIC` 217                      | Lines 218 to 220 run, three `effect_amount` lines the author disabled                                                                  |
| DE's `GeneratingObjects.inc`                 | `HOUSE` 3048 and 3161                          | Each opens a disabled run of three `create_object HOUSE`. The first becomes a block with no command and the next two run               |
| The 234 probe scripts and every other script | none                                           |                                                                                                                                        |

`GeneratingObjects.inc` is included by 82 of DE's maps. Both runs sit inside its `if EMPIRE_WARS` (line 2884), the first also in the `else` of `if GNR_EMP_W_NOSPACE`, so an Empire Wars game on one of those maps is where DE would place the extra houses, if their actor areas exist. A run there would confirm D1 on a shipped file. It is not part of this slice.

## 5. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green, and `npm run measure:includes` passes.
- Mutation tested once each, then restored exactly. Delete the close branch in `markComments` (item 1 tests 1, 6 and 7 go red). Make `walkComments` ignore `"close"` (item 4 test 1 goes red, since RMS0111 fires in place of RMS0113). Drop D3's written-live condition so RMS0111 fires whenever the comment ends before the end of the file (item 4 tests 1 and 1a go red). Stop `walkComments` marking stray closes (item 5's agreement test goes red on Chaotic Strait).
- `docs/build-log.md` gains an entry with both censuses' printed lists, and `CLAUDE.md`'s test table a row and its `token-alias-design.md` row the slice B status.
