# Name liveness slice B brief, the diagnostics

**This is a work brief for one implementing session, not a design document.** The design is `docs/name-liveness-design.md` (rev 1, CREATION_PLAN A.4). Read this file for what to build and in what order, and the design for why. Where the two disagree, stop and ask the owner. Do not pick one yourself. The owner settled the three decisions slice A stopped on, on 2026-11-04, and Sec.1 records them with the decisions this brief adds.

Slice B turns slice A's analysis into what the editor shows. RMS0320 (warning) on a use that can never see its definition, RMS0321 (info) on a use that may run without it, RMS0322 (info) on a branch that can never run, RMS0323 (info, can be turned off) on a branch only a switch turns off. Each use mark links to the lines that define the name. A Settings > Diagnostics checkbox turns RMS0323 off, and the status bar says when a script was too complex to check. The analysis runs as a second pass in the parser worker, after the parse result is posted, never on the typing path.

**Slice A must be built.** `src/parser/liveness/` (`bdd.ts`, `atoms.ts`, `walk.ts`, `analyse.ts`, `describe.ts`) and `npm run measure:liveness` must exist. If either is missing, stop and say so.

## 0. How to work

- Read `CLAUDE.md` in full before starting. Teaching mode applies. This slice crosses a worker boundary and React state, so the comments are where a reader learns why the pass is debounced inside the worker, why the liveness marks live in their own state field rather than in the parse result, and why a stale mark is dropped rather than shown. Name the concepts where they appear (a discriminated union, a debounce, a stale closure, lifting state up).
- Read the design in full, the 2026-11-03 build log entry "Name liveness slice A", `src/editor/parserWorker.ts`, `src/editor/parseResponses.ts`, `src/useParsedDocument.ts`, `src/editor/diagnosticActions.ts` and `src/components/settings/DiagnosticsSettings.tsx` before item 1.
- `src/parser/**` stays pure, no React, Monaco or Tauri.
- Build the items in the order of Sec.3. Each item ends with its tests green before the next one starts. Run tests by exact path while working, the full `npm test` once at the end.
- Do not commit. Write a draft commit message to `RMS/commit-message-<date>-name-liveness-slice-b.txt` at the end.
- Stop and ask the owner when a rule here or in the design cannot be followed as written, or on any trigger in Sec.4.

## 1. Decisions

The owner's three answers, 2026-11-04.

**B1. The analysis runs as a second pass in the parser worker (owner's Decision 1).** Slice A missed design Sec.7's 50 ms budget on 47 to 66 of 243 scripts, the slowest about 245 ms. Inside `validate` every keystroke would pay that. The worker posts the parse result as today, then runs the analysis after the worker has been idle for `LIVENESS_IDLE_MS = 300` (the preview's debounce), and posts the liveness diagnostics as their own message. Any message reaching the worker before the timer fires cancels it. Once the analysis has started it runs to the end, so a keystroke made during it waits for it. That is the cost the owner accepted, and item 7's run sheet checks it.

**B2. The node cap is 1,000,000 (owner's Decision 2).** Measured 2026-11-04 by a throwaway probe over the ten scripts that overflow at 200,000.

| Script                                                                 | Nodes to finish | Time to finish    | Time spent before overflow at 1M |
| ---------------------------------------------------------------------- | --------------- | ----------------- | -------------------------------- |
| Pa_Site_v1.1, Arabia (both), Arabian Desert, Capricious, Forest Breach | 206K to 335K    | 95 to 184 ms      |                                  |
| Rage Forest 2026                                                       | 448K            | 302 ms            |                                  |
| MountainRange                                                          | 2.86M           | 2.6 s             | 429 ms                           |
| Michi                                                                  | 2.39M           | 1.7 s             | 997 ms                           |
| Blind_Random                                                           | not at 40M      | overflows at 23 s | 363 ms                           |

No cap finishes Blind_Random, and 2M finishes none of the last three. At 1M seven of the ten finish, the slowest in about 0.3 s, and an overflow gives up within about 1 s. MountainRange, Michi and Blind_Random report nothing and say so in the status bar (item 6). Chasing them (another variable order, splitting a script into independent parts) is not in this slice.

**B3. Slice A's two deviations are confirmed (owner's Decision 3).** Both were checked against the data on 2026-11-04 before the owner confirmed them.

- A `string` argument slot is not a value use. The only `string` slot of any command or attribute is `create_object_group`'s `groupName`. `language.json`'s note on it calls the slot a definition site for a name the author invents, and the guide allows any characters there. Skipping it can only remove a mark, never add one.
- Map-size atoms are keyed by `dimensions`. Every `mapSize` label has a `dimensions` value, the fourteen values are the fourteen sizes of the guide's Map Sizes table (80 to 480), and each value holds one modern label and at most one legacy one (`LUDIKRIS_MAP` and `MAPSIZE_LUDICROUS` are both 480, as the guide pairs them). The `mapSize` field is absent on the seven sizes Generation Settings does not offer, which is why keying by it left those sizes outside "exactly one size" and was behind most of the 807 contradiction branches of slice A's first run.

Design Sec.4.1's size atoms, Sec.4.6's cap and Sec.7's choice carry dated amendments to match, made when this brief was written.

The brief's own decisions.

**B4. A use mark needs a definition the walk recorded above the use.** RMS0320 and RMS0321 fire only when the name has at least one definition above the use, in the script or in an include the walk entered above it. A use with none is left to RMS0303 (defined only below) or RMS0202 (never defined). This settles two of slice A's six dead uses. `ALP_test.rms` line 20 is RMS0303's case and gets no RMS0320. `24hr_Mont Saint Michel.rms` line 111 reads `MAPSIZE`, which the walk never sees defined because every branch writes `#const SIZE #const MAPSIZE 80` and the walk reads the second `#const` as `SIZE`'s value, the way `tokenFilter.ts` does. Whether the engine reads the line that way is unmeasured, so nothing is said there.

**B5. Messages name labels the way the script wrote them.** A size atom is named after the first label of that size the script reads (`TINY_MAP` in a script that tests `TINY_MAP`, `MAPSIZE_TINY` in one that tests that), and after the modern label when the script reads none. A player atom is `N_PLAYER_GAME`. A random arm is `arm 2 of the start_random on line 12`. A free atom and a label atom are their name. Negation is `not X`.

**B6. Liveness marks live beside the parse result, never inside it.** `ParseResult` and its `diagnostics` stay as the parse and `validate` made them. The main thread holds the liveness diagnostics in a field of their own with the source they were computed for, and merges them only where a list is read, and only when that source matches. A liveness reply never re-renders Breakdown's card tree through a new `parseResult`, the cost `docs/diagnostics-latency-report.md` Sec.10 removed.

**B7. A dead branch's message says which of three things killed it.** Checked in this order, for a branch with condition `c` (absent on `else`), its chain part `L` (its own condition and the negations of the earlier conditions of its chain), and the guard `E` around the chain.

1. `c` is present and `Def(c) ∧ D` is impossible. "This branch never runs, because `c` is never defined here."
2. `L ∧ D` is impossible. "This branch never runs, because the branches above it in this chain already cover every case."
3. Otherwise. "This branch never runs, because it needs `<L>` inside a branch that needs `<E>`." Both read with `describeCondition`.

RMS0323 has its own shape (item 3).

## 2. Terms used below

- **Use mark**, an RMS0320 or RMS0321 on the token of a name in a line that reads it.
- **Branch mark**, an RMS0322 or RMS0323 on a branch's keyword token (`if` with its condition, `elseif`, or `else`).
- **Liveness reply**, the worker's new message carrying the marks for one parse request.

## 3. What to build, in order

### Item 1. Design amendments

Already made when this brief was written (B3). Read them in design Sec.4.1, 4.6 and 7 and change nothing there.

### Item 2. Atom names, definition sites and the cap

In `src/parser/liveness/`.

- `atoms.ts`. Size and player atoms take B5's names. `openBlock(line: number)` takes the line of its `start_random` token, and arm names read `arm N of the start_random on line L`. Record the first label a size atom is reached through and use it from then on.
- `walk.ts`. `WalkUse` gains `includeDefinitions: string[]`, the include keys holding a definition of the name above the use, each once. `WalkBranch` gains `local: BddNode` (B7's `L`) and `conditionDef?: BddNode` (`Def(c)` at the branch) and `conditionNames: string[]`, the condition words of this chain up to and including this branch and of every chain around it, outermost first.
- `analyse.ts`. `analyseLiveness(input, options?: { maxNodes?: number })` with `export const LIVENESS_MAX_NODES = 1_000_000` as the default, passed to both walks' `Bdd`. `Bdd`'s own default stays 200,000, so its tests keep their meaning.

Tests. `atoms.test.ts` gains one case for B5's first-read rule (`TINY_MAP` read first names the atom `TINY_MAP`, even after `MAPSIZE_TINY` is read). `analyse` gains a test that a tiny `maxNodes` gives `overflow`.

### Item 3. The diagnostics

`Diagnostic` in `src/parser/types.ts` gains `related?: { span: Span; message: string }[]`, a doc comment saying it holds other places in the same file the message refers to.

`src/parser/diagnostics.ts` gains the four codes, with `summary` lines in the table's style, and RMS0323 `dismissible: true`. Widen the comment on `dismissible` to say an info that is legal and often meant may carry it too. Add four factories beside the others, each taking the line numbers already computed, never offsets (CLAUDE.md's rule on second locations).

| Code    | Severity | Message                                                                                                                                                                                                       | `related`                                 |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| RMS0320 | warning  | "`NAME` is only defined when `<cond>`, and this line never runs then." Adds " It is also defined in `<file>`." per include holding a definition                                                               | "Defined on line N" per script definition |
| RMS0321 | info     | "`NAME` is only defined when `<cond>`, so this line can run without it." Same include sentence                                                                                                                | The same                                  |
| RMS0322 | info     | B7's sentence                                                                                                                                                                                                 | none                                      |
| RMS0323 | info     | "This branch never runs, because `SWITCH` is always defined above (line N)." With no switch among the branch's `conditionNames`, "This branch never runs, because of a flag the script always defines above." | "Defined on line N" for the named switch  |

`<cond>` is `describeCondition(def)` with B5's names. The backticks above mark the name in this brief only. The message holds the bare name, as other messages do.

A new pure `src/parser/liveness/report.ts`, `livenessDiagnostics(input, options?): { status: LivenessResult["status"]; diagnostics: Diagnostic[] }`. It runs the analysis and builds the diagnostics while the diagrams are still alive, since `LivenessResult` keeps verdicts and not nodes. Extend `analyseLiveness` with whatever it must hand over (the guards, the walk) rather than walking a third time. Its rules.

- A `live` use gets nothing. A `dead` use is RMS0320, a `maybe` use RMS0321, each only under B4.
- One mark per read, on the name's token span, as A.1 settled for RMS0202.
- RMS0320 and RMS0321 are never reported on a token that already has RMS0202 or RMS0303 in the parse result's diagnostics. Pass the parse result's diagnostics in and test by span.
- A dead branch of kind `contradiction` is RMS0322, of kind `switch` RMS0323. The span is the keyword token, joined with the condition token when there is one.
- `overflow` and `incomplete` return no diagnostics and their status.

Tests, `src/parser/liveness/__tests__/report.test.ts`.

1. Design Sec.1's `FOREST_SIZE` example gives one RMS0321, its message naming the `start_random` line, its `related` pointing at the `#const` line.
2. `if TINY_MAP #const A 1 endif` then `if HUGE_MAP` around `number_of_tiles A` gives RMS0320 naming `TINY_MAP`.
3. A use above the name's only definition gives no RMS0320 or RMS0321 (B4).
4. The design Sec.8 fixtures. `liveness_test.rms`'s H and I give two RMS0322 of B7's first shape. `unified_multiple_def.rms`'s last `elseif MAPSIZE_MINI` gives RMS0322 of B7's second shape and its repeated `MAPSIZE_INCREDIBLE` nothing. `test_check_dead_paths.rms`'s `else` gives RMS0323 naming `A` and its line. `back_prop.rms` gives nothing.
5. A use defined only in an include gives the include sentence and no `related` entry.
6. No message holds an em dash, a colon or a semicolon (CLAUDE.md's language rule covers user-facing strings).

### Item 4. The worker's second pass

- `src/editor/parseResponses.ts`. Add `export const LIVENESS_IDLE_MS = 300` and the message `ParseLivenessMessage { kind: "liveness"; requestId: number; status: "complete" | "incomplete" | "overflow"; diagnostics: Diagnostic[]; ms: number }`. The router handles `kind === "liveness"` on its own branch and hands every one to a new `onLiveness` handler, which decides (item 5). It cannot use `isCurrent`, since `useParsedDocument` forgets a request's source once its result is applied, so `isCurrent` is false for every liveness reply. It must not disturb the diagnostics-then-result pairing. The worker posts that pair back to back in one task and a liveness reply always in a later task, so a liveness reply never sits between them. Say so in a comment.
- A new pure `src/editor/livenessPass.ts`, `createLivenessScheduler({ schedule, cancel, run, post })`, so the timing logic is tested without a worker. `request(requestId, job)` cancels any pending job and schedules this one after `LIVENESS_IDLE_MS`. `cancel()` drops a pending job. A job that runs posts once.
- `src/editor/parserWorker.ts`. After posting the result, `request` a job that calls `livenessDiagnostics` on the same parse, the cache's include parses and `parseOptionsFor`'s `includesUnread`, and posts a `ParseLivenessMessage`. Every incoming message, parse request or includes, calls `cancel()` first. The job reads the include state captured when it was requested, not the current one.

Tests. `parseResponses.test.ts` gains a liveness reply routed to `onLiveness` and a diagnostics, result, liveness sequence keeping the first two paired. `livenessPass.test.ts` with Vitest's fake timers covers a job run after 300 ms, a second request replacing the first, `cancel()` stopping a pending job, and a job that has run not being re-run.

### Item 5. The main thread

- `src/useParsedDocument.ts`. `ParsedDocumentState` gains `liveness: { source: string; status: ParseLivenessMessage["status"]; diagnostics: Diagnostic[] } | null`. Keep the id of the request whose result was applied in a ref. A liveness reply is applied when its request id equals both that id and the newest sent, and takes the applied `source`. A newly applied result resets `liveness` to null, so marks for older text never meet newer text.
- `src/App.tsx`. The list passed to `dismissal.visible` for the Code tab and the status bar is the parse diagnostics plus `liveness.diagnostics` when `liveness.source === parsed.diagnosticsSource`, merged in a `useMemo` keyed on those fields.
- `BreakdownPane` gains a `livenessDiagnostics: readonly Diagnostic[]` prop, which App fills only when `liveness.source === parsed.source`, and merges into the list its own `dismissal.visible` call reads.
- `src/editor/diagnosticsToMarkers.ts` maps `related` to Monaco's `relatedInformation`, with the model's own `uri` as the resource.

Tests. Extend the existing `useParsedDocument` or router tests (whichever already drives replies) so a liveness reply for the applied request lands, one for an earlier request is dropped, and a new result clears it. `diagnosticsToMarkers` gains a test for `relatedInformation`.

### Item 6. The links, the checkbox and the status bar

- **The Code tab's links.** Monaco's marker hover renders `relatedInformation` as links that open the resource at the range, and in the standalone editor opening the editor's own model should move the caret. Check it in the browser pane with mocked Tauri IPC (the memory note "Mock-Tauri browser harness", which needs the owner's `npm run tauri dev` running for its Vite server). With no such server running, ask the owner to start one rather than skipping the check. If a click does not move the caret, add a "Defined on line N" command link to `diagnosticActions.ts`'s hover provider instead, built like its "Ok" link and allowed by name in `enabledCommands`, and drop the `relatedInformation` mapping so the line is not shown twice. Say in the build log which one shipped. That hover's HelpTip exception covers the link, so extend its comment rather than adding a HelpTip.
- **Breakdown's links.** `ProblemBadge`, for a lone diagnostic with `related`, shows one button per entry in the popup's `actions`, labelled "Line N", which selects the card at that offset through the shared selection (`selection.setAnchor`, as `onEditInCode` does). Reach `ProblemBadge` through the existing prop chain if it passes two components or fewer, otherwise through a small context beside the pane. Wrap the buttons in `<HelpTip id="diagnostics.related.goTo">`, `ui-help.json` text "Selects the card on that line, where the name is defined."
- **The checkbox.** `DiagnosticsSettings.tsx` gains a fieldset with one checkbox, "Report branches a switch turns off", checked while `turnedOff` lacks `RMS0323`, calling `turnOff` or `turnBackOn`. `HelpTip id="settings.diagnostics.switchBranches"` with design Sec.6.1's sentence. The "Warnings turned off" list skips `RMS0323`, since the checkbox already shows it.
- **The status bar.** When `liveness.status` is `overflow` for the current source, `StatusBar` shows a short label, "Name checks skipped", in `HelpTip id="statusBar.livenessSkipped"`, text "This script is too complex for the check that finds names read where they may not be defined, so that check says nothing here. Every other check still runs." Nothing for `incomplete`, which A.1's softening already explains.

Each new HelpTip id gets its `ui-help.json` entry, and `helpCoverage.test.ts` must stay green.

### Item 7. The measurement and the verdicts

`liveness.measure.test.ts` switches to `livenessDiagnostics` with the default cap and prints, per script, the counts of RMS0320 to RMS0323 and the status, then the totals, the slowest five, and every RMS0320 with its file, line and message.

**Verdicts, as RMS0304's were.** Every RMS0320 on the 243 scripts is read and given a verdict in a pinned list in the measure test (file, line, name, verdict, one sentence why), and the test fails when an RMS0320 appears that the list lacks or one in the list disappears. After B4 slice A's six dead uses leave four candidates, `Dorothea Quarry.rms` lines 1001, 1107 and 1211 (`BUILDING_DISTANCE`, defined in `includes/empire_buildings.inc` only in the else of `NOMAD_START`) and whatever the seven newly finished scripts add (the probe found no dead use in them). Read at least 20 RMS0322 across at least 10 files, and pin each with a verdict in the same way.

Then add run sheet section `<next free number>` to `docs/manual-test-run-sheet.md`, "Name liveness marks", covering, in the real app on DE's `Stranded.rms`, `Arabia.rms` and `24hr_Blind Valley.rms`,

1. a blue RMS0321 underline appearing about a third of a second after typing stops, and its hover's definition link moving the caret,
2. typing during an analysis, so the next squiggles' wait can be felt on the slowest script,
3. the marks clearing while typing and coming back after the pause,
4. the Settings checkbox hiding and restoring every RMS0323, and the hover's "Don't show me this again" unticking it,
5. Breakdown's badge showing the same message and its "Line N" button selecting the defining card,
6. "Name checks skipped" on `MountainRange.rms`.

## 4. Stop and ask the owner when

- An RMS0320 reads as a false positive and no rule in the design or this brief removes it (design Sec.9).
- An RMS0322 read in item 7 reads as a false positive.
- Any script that finishes takes more than **1,000 ms** in the measure's second run, or an overflow takes more than **1,500 ms** to give up. Those are B2's measured figures with a margin, and past them the wait in item 7's step 2 is longer than the owner was told.
- Any one script gets more than **500** RMS0321, the trigger slice A carried (design Sec.9). Slice A's most was 205.
- The Code tab links cannot be made to move the caret by either route of item 6.

## 5. Done means

- `npm test`, `npm run typecheck`, `npm run lint`, `prettier --check .` and `npm run validate:reference` are green. `npm run measure:liveness` and `npm run measure:includes` run to the end and pass.
- Mutation tested once each, then restored exactly. B4 (drop it, report test 3 goes red), the RMS0303 overlap rule (drop it, a constructed both-codes case goes red), the cancel on an incoming message (drop it, a scheduler test goes red), and the source check before merging liveness marks (drop it, the main thread test for a stale reply goes red).
- `docs/build-log.md` gains an entry with the measure's totals, the slowest five, the pinned verdict lists and which link route shipped, and `CLAUDE.md`'s test table a row.
- `docs/name-liveness-design.md` gets one line under its rev line, "Slice B built <date>", besides item 1's amendments.
