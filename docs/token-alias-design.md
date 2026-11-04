# Token IDs and Aliases (CREATION_PLAN A.2, rev 1)

Rev 1, 2026-11-02. Slice A built 2026-11-03 (data, import script, the preview's second parse). Slice B built 2026-11-03 (`docs/token-alias-slice-b-brief.md`, the lexer closes a comment on a word valued 70, RMS0112, RMS0113, `commentWalk.ts`). Opus wrote the design. Slices B and C waited on the DE runs in Sec.6, which are RMSTEST Batch 20 and were run 2026-11-02, results in `tools/scenario-probe/rmstest/README.md`. They read 82a snow with its controls grass, 83 with town centres, and 84a grass, so slice B went ahead and slice C is not warranted. The checker and Land Placement's emission take the same parse options as the preview since 2026-11-04. The owner's two questions (Sec.8) are answered.

## 1. What this is for

DE reads every word of a script as an integer. Commands, attributes, control words, braces, comment markers, terrains and objects all share one table, so a constant whose value equals a keyword's number can stand in for that keyword in some places. Two of those places are already modelled.

- **A command.** `#const L 32` then `L { … }` is a `create_land` (parser-design Sec.2.1 item 4, `CommandDef.tokenId`, measured by RMSTEST_62).
- **Opening a comment.** A word valued 69 inside a comment opens a nested one, and the rest of the file can vanish (parser-design Sec.11 item 7, RMS0111, measured by RMSTEST_56a, 57 and 60).

The rest of the table has been blocked on the community "RMS Equivalencies" sheet, which never fetched because it renders with JavaScript. **It is now obtained** (Sec.2). This design takes in the table and decides, place by place, which uses change the editor or the preview and which do not.

## 2. The source

The sheet is linked from Zetnus's "parser pitfalls" thread on the HeavenGames forum (`aok.heavengames.com`, forum 26, thread 42304). Google Sheets id `1gr37obgoA_oa_Yikw8rt4AmNtRk4czX9VcRPkQQZPEc`. On 2026-11-02 its `export?format=xlsx` URL returned the workbook with its cell colours, which the CSV export loses. It is not kept in the repo. The token numbers are facts about the engine and enter `language.json` as data with the sheet named as their source (Sec.4).

**What it holds.** 153 rows, IDs 0 to 152, with the RMS keyword for each ID and the terrains, objects and other constants that share it. The keyword column is coloured in three classes.

| Colour | Meaning, from the sheet's own legend                                         | IDs                                                                                                         |
| ------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Red    | "can cause issues in dead branches ... may prematurely terminate the branch" | 3 `if`, 4 `elseif`, 5 `else`, 6 `endif`, 7 `start_random`, 9 `end_random`, 67 `{`, 68 `}`, 69 `/*`, 70 `*/` |
| Beige  | "do not require arguments", should never cause problems in a proper script   | 45 tokens, section headers and argument-less attributes                                                     |
| White  | "require an argument, so there should be no issues"                          | the rest                                                                                                    |

**Agreement with what we measured.** `create_land` is 32 in the sheet and in RMSTEST_62. `/*` is 69 in the sheet and by inference from RMSTEST_56a and 60. Both independent checks agree.

**Where it is out of date.** Seven names in `language.json` are not in the sheet, so the sheet predates them or spells them differently.

| `language.json`                                                             | Sheet                                      |
| --------------------------------------------------------------------------- | ------------------------------------------ |
| `terrain_state`, `weather_type`                                             | absent, newer DE commands                  |
| `building_architecture`, `match_player_civ`, `temp_min_distance_to_players` | absent                                     |
| `other_zone_avoidance_distance`                                             | `set_other_zone_avoidance_distance`, ID 31 |
| `create_connect_teams_lands`                                                | `create_connect_teams_land`, ID 64         |

The thread itself also dates some claims to versions before DE ("SHORE_FISH acts as `/*` on non-DE versions", "DIRT3 is read as `if` on non-DE versions"). Our runs show SHORE_FISH does it in DE too, so the thread's version notes cannot be taken at their word either way.

## 3. The three places an ID can matter

### 3.1 Inside a comment

The lexer already treats a word valued 69 as `/*`. The sheet gives the other half. **`*/` is 70**, and the constants valued 70 are `HOUSE`, `ATTR_ATTACK_GRAPHIC` and `CITY_OF_LAKES`. The thread says so in words, "HOUSE can close a comment ... never let HOUSE appear in commented code".

This matters on files we have. Over the 243 scripts of the A.1 measurement (`docs/include-resolution-design.md` Sec.3), six comment words are valued 70.

| Script                                                   | Where                                                                     | What changes if 70 closes a comment                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Fortress.rms`, DE's own, line 427                       | `/* create_object HOUSE { number_of_objects 4 … } */`, a disabled command | The comment ends at `HOUSE`. The block after it is a block with no command, and the final `*/` is a stray close. Probably nothing visible                                                                                                                                                                                                                                                           |
| `Chaotic_Straitv0.99.rms`, lines 560 to 562, three times | inside the comment that line 547's `SHORE_FISH` nested                    | **The file is not truncated.** Line 546 opens depth 1. Line 547's `/*` takes it to 2, `SHORE_FISH` to 3, and the line's own `*/` back to 2. The `HOUSE`s on lines 560 and 561 close it to 1, then 0, partway through line 561. Line 562's `create_object HOUSE { … }` then runs, line 563's `*/` is a stray close, and every line after it runs, `create_object TOWN_CENTER` on line 567 among them |
| `24hr_Mont Saint Michel.rms`, line 217                   | `ATTR_ATTACK_GRAPHIC` in a commented note about effects                   | The rest of that comment becomes live, a run of `effect_amount` lines that were meant to be disabled                                                                                                                                                                                                                                                                                                |

**Chaotic Strait reverses a recorded claim.** parser-design Sec.11 item 7 and BUG-012 say DE loses lines 547 to 1109 of that map, 51%, and RMS0111 reports that at error severity. That was reasoned from the 69 rule alone, under which the depth never returns to 0. No run of Chaotic Strait itself was made. With the 70 rule the loss is lines 547 to 561, and the rest generates. RMSTEST_83 (Sec.6) settles it.

### 3.2 Inside dead code

The red class says a word with a control value may end a dead branch early. **In DE it does not, in code.** Measured 2026-11-02 against data already on disk. The 342 maps `deWholeScriptMaps.test.ts` holds the preview to all match DE tile for tile, and the preview's token filter ignores constant values. In those maps' dead text sit 597 words valued as control tokens, 213 as `end_random`, 170 `if`, 150 `elseif`, 48 `else` and 16 `endif` (`SHALLOW`, `GRASS3`, `CC_ARCTIC`, `MUL_RESOURCE` and others), across 14 maps. Had DE read any of them as a control word, the branches after it would have shifted and the map would not match. One such word could be harmless where it sits, but 597 across 14 maps cannot all be.

**Comments inside dead code are untested.** Those 342 maps have no control-valued word in a comment inside dead text. RMSTEST_84 asks it directly.

**Braces in dead code** (`ATTR_HIT_MODE` 67, `MILL` 68) have no population in our scripts and no run. Out of scope.

### 3.3 In place of a keyword in live code

This generalises `#const L 32` to every keyword. A word resolving to an attribute ID would be that attribute, to `{` an open brace, and so on. **It has no population.** Of the 1,058 RMS0200 diagnostics (unknown name where a command should be) left on the 243 scripts, one resolves by value to anything, `PLANT_BUSH_DRY` at 1361, which is not a token ID. CLAUDE.md's rule on a claimed population applies, the cheap check finds zero. The parser keeps resolving commands only.

`MILL` closing a block (parser-design Sec.2.1 item 3) is this case, and it is the sheet's 68. It stays recorded and unbuilt for the same reason.

## 4. The data

Token IDs are attributes of the vocabulary entry, the shape parser-design Sec.2.1 item 4 chose for `CommandDef.tokenId`. This extends it rather than adding a join table.

- `tokenId?: number` on `AttributeDef`, `DirectiveDef` and each control keyword entry, as on `CommandDef`.
- A new top-level `structuralTokens` array in `language.json` for the tokens that have no vocabulary entry, `[{ text: "{", tokenId: 67 }, { text: "}", tokenId: 68 }, { text: "/*", tokenId: 69 }, { text: "*/", tokenId: 70 }]`, and one for each section header (`<PLAYER_SETUP>` 11 and the rest).
- Only exact name matches get an ID. The seven names in Sec.2's second table get none until a run measures them. An absent `tokenId` means unknown, never "has no ID".
- Each `tokenId` carries a `tokenIdSource`, either a run (`RMSTEST_62`) or the sheet (`equivalencies-2026-11-02`), and `notes` is left alone. A run's source still needs a `notes` entry describing it, which `validate:reference` checks. Only run-sourced ids feed the parser's `commandsByTokenId`, since writing the sheet's numbers onto every command would otherwise switch alias resolution on for all of them (Sec.3.3). This replaces the first draft's note line per entry.
- One word has one id, so the two entries for a name that is both a command and an attribute, `base_terrain` and `base_layer`, carry the same number. `validate:reference` rejects an id shared by two different names, not by two entries of one name.
- `reference/schemas/language.schema.json` gains the fields, and `validate:reference` checks that no two entries share a `tokenId` and that every `structuralTokens` text is unique.
- `COMMENT_OPEN_ID = 69` in `validate.ts` stays a constant, and a new `COMMENT_CLOSE_ID = 70` sits beside it. `src/breakdown/constReview.ts` and `src/editor/constOffers.ts` import the first and neither has the language data, so threading it through for a number that cannot change between game versions would be churn. A test in `src/parser/__tests__/tokenData.test.ts` asserts both equal the `structuralTokens` ids of `/*` and `*/`, which is what keeps the two copies from drifting. Changed from the first draft's "becomes a read of `structuralTokens`" in slice A's brief (D2).

The import is a one-time script, `tools/token-ids/import.mjs`, that takes a CSV path on the command line and writes the IDs into `language.json`. The CSV is not committed. The script is, so the import can be repeated against a newer copy of the sheet.

## 5. Behaviour changes

**B1, a word valued 70 closes a comment.** Waits on RMSTEST_82. `LexOptions` gains `commentCloseAliases`, built by a new `commentCloseAliases(constants)` in `validate.ts` the way `commentOpenAliases` is. In `markComments`, such a word inside a comment lowers the depth by one, and at depth 0 the comment ends after it. A new **RMS0112**, warning, fires at the word, "HOUSE has the same number as `*/`, so the game ends the comment here and runs what follows as code." Warning and not error, since the text after it often does nothing (Fortress). RMS0111's message on Chaotic Strait changes with it, because the file is no longer truncated. Its corpus pin in parser-design Sec.11 item 7 is re-measured, not edited by hand.

Amended 2026-11-03 while writing slice B's brief (`docs/token-alias-slice-b-brief.md` D3 and D4). A word valued 69 is reported once per comment as the game reads it. RMS0111 (error) fires when that comment runs to the end of the file or swallows code the written markers leave live. A new **RMS0113** (info) fires when the comment ends before the end of the file having skipped only text that was commented anyway. On Chaotic Strait the comment SHORE_FISH deepens still ends at line 561, before the `*/` written on line 563, so nothing meant to run is lost and it gets RMS0113 rather than RMS0111. It is still reported because the word moves where the comment ends (line 560's `HOUSE` would end it without SHORE_FISH), and rewording or removing what closes it would make the game skip the code below. The owner asked for that on 2026-11-03. RMS0112 fires on every word valued 70 inside a comment, with one message when the comment ends at the word and another when it only closes one level of a nested comment. A census run for the brief found the same shape in DE's own `GeneratingObjects.inc` (lines 3048 and 3161, included by 82 DE maps), where two disabled runs of `create_object HOUSE` become live code from their second command on. That is a prediction for a run, not something this slice measures.

**B2, the preview passes the comment aliases when it re-parses.** A defect found writing this design, not waiting on any run. `instantiate.ts` re-parses the filtered text with `parseRms(filtered.text, refDb.data)` and parses include files the same way, with no `commentOpenAliases`. The worker's first parse had them, so a script that goes through the token filter loses the 69 truncation on the second parse and draws text DE never reads. The fix passes the same options, which means `PreviewReferenceData` carries the two alias sets. A unit test with a SHORE_FISH comment and a conditional spanning a section header pins it.

**B3, control-valued words in a comment in dead code.** Waits on RMSTEST_84. If DE reads them, the preview's token filter has to look at comment words in dead text. If not, nothing changes and parser-design records the answer.

**B4, nothing for dead code or live keyword aliases.** Sec.3.2 and 3.3. parser-design Sec.2.1 gains a paragraph recording both findings, so neither is built later on the sheet's word.

## 6. Runs in DE

Each is one script, generated in the scenario editor at seed 1000, Tiny, two players, read by looking at the map. Predictions are written before the run, as `tools/scenario-probe/rmstest/README.md` requires.

| Run         | Script                                                                                                             | Prediction if 70 closes / control words count              | Prediction otherwise                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------- |
| RMSTEST_82a | `<TERRAIN_GENERATION> /* HOUSE create_terrain SNOW { base_terrain GRASS land_percent 100 } */`                     | Snow                                                       | Grass                                        |
| RMSTEST_82b | The same with `TOWN_CENTER` in place of `HOUSE` (control)                                                          | Grass                                                      | Grass                                        |
| RMSTEST_82c | The same with the literal `70` (literals did not count for 69, RMSTEST_57)                                         | Grass                                                      | Grass                                        |
| RMSTEST_83  | `Chaotic_Straitv0.99.rms` as it is, seed 1000                                                                      | Town centres, from `create_object TOWN_CENTER` on line 567 | No town centres, nothing from below line 547 |
| RMSTEST_84a | `if NOT_A_LABEL /* DIRT */ create_terrain SNOW { base_terrain GRASS land_percent 100 } endif` (DIRT is 6, `endif`) | Snow                                                       | Grass                                        |
| RMSTEST_84b | The same with `/* ROCK */` (control)                                                                               | Grass                                                      | Grass                                        |

82b is the control that tells "70 closes" from "any object name closes", and 82c tells a value from a literal, the two shapes the 69 runs needed. 84b does the same for 84a.

## 7. Slices

**Slice A, the data and the preview fix.** The import script, `tokenId` on every exact match, `structuralTokens`, the schema and `validate:reference` checks, `COMMENT_OPEN_ID` read from data, B2 with its test, the parser-design paragraph for B4, and the sheet named in the README's thanks to Zetnus. Gate, `npm test`, `validate:reference` and a test that reads `create_land` 32, `/*` 69 and `*/` 70 back from `language.json`.

**Slice B, the comment close.** Only if RMSTEST_82a is snow and 82b and 82c are grass. B1, RMS0112, RMS0111's re-measured corpus pin, the BUG-012 correction in parser-design, a run sheet section for the squiggle. If RMSTEST_83 disagrees with 82, stop and ask the owner.

**Slice C, comments in dead code.** Only if RMSTEST_84a is snow. B3 in `tokenFilter.ts`, with a whole-script gate map from the run added to `de-whole-script-maps.json` through `export_de_fixture.py`.

**Not built.** RMSTEST_84a came back grass on 2026-11-03, so a comment word valued 6 in a dead branch does not close it. Slice B records the answer in parser-design Sec.2.1 and nothing else changes.

## 8. Questions for the owner

Both answered by the owner on 2026-11-02.

1. **The six runs.** **Answered, an automated session saves them.** The scripts are written (`tools/scenario-probe/rmstest/RMSTEST_82a` to `84b`, RMSTEST_83 being `test-maps/Chaotic_Straitv0.99.rms` as it is), with predictions in that folder's README as Batch 20. The session's run sheet and driver sit beside the editor harness outside this repo, since both carry paths from the maintainer's machine. The readings land in the README, and slices B and C are decided from them.
2. **Keeping the sheet.** **Answered, covered by Zetnus's permission.** The token numbers go into `language.json` with each entry's notes naming the sheet, and the README's thanks to Zetnus mentions it beside the guide and the reference sheets. Slice A adds that line.
