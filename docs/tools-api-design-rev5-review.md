# Review: tools-api-design.md — the rev 5 round

**What this file is.** The critique round that produces **rev 5** of `docs/tools-api-design.md`. The doc is at rev 4. A previous round already exists — `docs/tools-api-design-rev4-review.md`, two passes, both dated **2026-07-30** — and it has **not** been folded into the doc (no rev-5 changelog, Sec.2's `MAP_SIZE_TILES` prescription still stands, Sec.6's capability list still omits `read-reference`). So rev 5 has two jobs: fold in that review, and fold in this one.

Every repo claim below was re-derived from the working tree on **2026-08-10**, with file:line. Where this note and the source disagree, re-check the source.

**Verdict.** The contract is still sound and the rev-4 review is still, in the main, right — I re-checked all twelve of its numbered findings and eight survive untouched. But **it is now eleven days old in a repo that moves daily, and four of its items have decayed**: one is already implemented, one has been solved in code by a different route, one's prescribed fix would now make things worse, and one of its Minor claims is flatly false today and would send a rev-5 session to "correct" two documents that are already correct. Folding it in verbatim lands three wrong instructions.

Separately, five new findings, two of them blocking. All five are consequences of work that landed **after** 2026-07-30: the Phase-4 generator became a real callable function with an input shape `ToolContext` cannot supply, and the map-size mapping the doc orders you to create now exists and is tested.

---

## Part 1 — Status of the rev-4 review, item by item

Fold it in, but not as written. Verified 2026-08-10.

| Item | Status |
|---|---|
| B1 `MAP_SIZE_TILES` | **Criticism holds, fix superseded** — see below |
| B2 `predefinedLabels` mistyped | **Already fixed in code; delete the action item** |
| B3 `GameConstantsData` exists twice | **Holds, but its fix is now wrong** |
| B4 stale parse | **Holds, verified unchanged** |
| B5 cancelled run paints over the next | **Holds, verified unchanged** |
| B6 no inbound validation | **Holds** |
| S1 no multiSelect | **Holds** |
| S2 `selection` dropped | **Holds, and sharpens — see N3** |
| S3 Sec.2/Sec.6 capability disagreement | **Holds** (`tools-api-design.md:161` still lists three) |
| S4/S5 sentinel + `SerializedParseResult` | **Hold** (line drift only: `parser.ts:938` is now `:992`) |
| S6 single-edit `applyTextEdit` | **Holds** (`useDocument.ts:244`, still one edit) |
| L1/L2/L3 | **Hold** (`useDocument.ts:22` model, `:162` `setValue`) |

### B1 — the criticism is right, the fix is obsolete, and rev 5 must not write a resolver either

The rev-4 review told rev 5 to replace "create `MAP_SIZE_TILES`" with "the context builder resolves it from `predefinedLabels`". **That function now exists**, and writing a second one is the same mistake one level down:

- `src/preview/generator/mapDimensions.ts:30` — `resolveMapDim(mapSize, predefinedLabels): number | null`. Its header comment makes the review's own argument, unprompted, and its docstring pins the `.find()`-not-uniqueness-assertion detail the review's second pass spent a paragraph on.
- `src/preview/__tests__/mapDimensions.test.ts` covers all seven sizes including Giant 252.
- The Giant/Huge ordering issue the doc cross-references as open (`tools-api-design.md:70-73`) was **fixed 2026-08-01**: `generationSettingsConstants.ts:46-55` orders Giant last, and its comment says `validate:reference` now asserts the ordering, the legacy/modern agreement, and that every size resolves. So the doc's "unreconciled … flagged there as reconcile during 4.3" is stale twice over.
- `preview-design.md` is at **rev 7**, not rev 5. Both the doc's "Sec.4's 6-row table" claim and the rev-4 review's "cite Sec.12 item 1 / Sec.15 item 6" replacement cite revisions that no longer exist. **Cite preview-design by content, not by section number** — that doc reorganises every revision, and it is now on its third numbering of this material.

**Fix for rev 5.** Sec.2's tiles comment becomes one sentence: the context builder calls `resolveMapDim` from `src/preview/generator/mapDimensions.ts` and surfaces the `null` case rather than defaulting it. Delete the `MAP_SIZE_TILES` prescription, the "DO NOT copy preview-design Sec.4" instruction, and the Giant/Huge cross-reference. The build-log sweep the review prescribed still applies unchanged — `build-log.md:170` and `:172` still carry the instruction verbatim, and `:172` is a "Next:" line an implementer will act on.

### B2 — already done; the review lost the argument it was making, correctly

`PredefinedLabel` is typed at `src/parser/language.ts:126`, its 10-member `category` union at `:107`, both against the schema. The doc's Sec.2 action item is discharged.

Note for whoever folds in the rev-4 review: **it prescribed making the field non-optional and the repo went the other way on purpose.** `language.ts:148-160` keeps `predefinedLabels?:` with a comment that says exactly why — nothing checks the shape at runtime, the double cast at `parserWorker.ts:22` asserts rather than verifies, and a non-optional type would make preview-design's mandated `?? []` guard read as dead code. That is the same collision the review identified, resolved the opposite way with reasons. **Do not re-litigate it into the tools doc.**

### B3 — holds, but "promote the hover's interface" is now the wrong instruction

The review's fix rested on `src/editor/aoe2RmsHover.ts:64-76` being the complete view. It is no longer complete, and this is the more important half now:

`reference/data/game-constants.json` is **164 entries with 17 distinct keys** (was 31 entries when the review ran). The new fields — `habitat`, `isWater`, `isForest`, `isHybrid`, `isBeach`, `isTree`, `beachTerrain`, `previewColor`, `minimapColor`, `idSource` — appear in **none** of the five TypeScript views (`aoe2RmsHover.ts:64`, `breakdown/gameConstants.ts:5`, `parser/resourceTotals.ts:55`, `parser/validate.ts:61`, and the structural `ObjectConstant` the preview worker casts to at `preview/worker.ts:35`).

Worse, and this is a live hazard for a *published* contract: `reference/schemas/game-constants.schema.json` types `rmsConstant` as `["string", "null"]` and **53 of the 164 rows are null** (the DE terrains with no callable constant). All four hand-written TS copies declare `rmsConstant: string`. An external tool written against a published `.d.ts` that says `string` and doing `entry.rmsConstant.startsWith(…)` crashes on a third of the file.

**Fix for rev 5.** The action item is neither "define one" nor "promote one" — it is **derive the published type from `reference/schemas/game-constants.schema.json`, which is the artefact CI validates**, and pin that the four narrow in-repo views stay narrow projections of it. Carry the review's own field-level notes (`resourceAmounts` optional and per-resource-partial, `constId` nullable, `category` the 2-member enum) and add `rmsConstant` nullable to the list.

### Minor correction: the review's game-constants Minor is now false, and its edit-list item 14 is a trap

The review states, twice, "all 31 `constId` are `null`, all 31 `verified` are `false`", and its edit-list item 14 tells rev 5 to go correct `CLAUDE.md`'s status row and `build-log.md:395` because they describe a file that does not exist. Measured today:

- 164 entries; **2** null `constId`; **44** `verified: true` (29 of 33 objects, 15 of 131 terrains).
- `resourceAmounts` on **8** entries — still exactly the hand-written placeholders (GOLD, STONE, FORAGE, DEER, BOAR, SHEEP, FISH, SHORE_FISH).

So the two documents the review calls wrong are right, and acting on item 14 would break them. **Drop item 14's first half.** Its second half (extend `check-breakdown-prereqs.mjs` to re-derive these facts) is the good part and is worth more now than when it was written.

The doc's own **5.2 sequencing warning** (`tools-api-design.md:201`) needs re-pointing rather than deleting: `constId` is real, so "all placeholders until Phase 4.0 lands" is wrong and will be ignored the first time someone checks. What is still soft is what the checker's static layer actually keys on — **`resourceAmounts` exists on 8 of 33 objects**, and 116 of 131 terrain rows are `verified: false` (community-sourced). `language.json` is 28/41 commands and 38/94 attributes verified. Say that instead.

---

## Part 2 — New findings

### N1 (blocking). `read-settings` cannot construct the input the flagship tool's own dependency requires

The checker runs the Phase-4 generator. That generator's entry point is now real and its signature is fixed:

```
generatePreview(parse, refDb, settings: PreviewSettings, opts: PreviewOptions)   // preview/generator/index.ts:226
PreviewSettings  = { playerCount, mapSize: MapSize, teams: readonly TeamNumber[] }  // generator/types.ts:37-54
PreviewOptions   = { seed, collectSnapshots }                                        // generator/types.ts:57-61
```

`ToolContext.settings` (`tools-api-design.md:74`) supplies `{ playerCount, mapSize: { name, tiles } }`. **`teams` is not in the context and there is no capability that would carry it.** Per-player team assignment landed 2026-08-01, after rev 3 pinned the settings shape, and it is not cosmetic: it decides the player ring, `grouped_by_team`, `set_zone_by_team`, and the whole `TEAMn_SIZEm` / `PLAYERx_TEAMy` label environment S0 builds branch selection from. A checker handed only `playerCount` either invents teams or silently generates a different map than the preview pane is showing.

`seed` is the second half and it is a design question, not an omission to patch reflexively: the Monte Carlo layer varies the seed by construction, so it probably does *not* want the pane's current seed — but "probably" is exactly what a spec is for, and the app now has a user-visible seed chip (`ui-help.json`: `preview.seedChip`, `preview.reroll`) whose value a user will reasonably expect a run to be comparable against. Decide it and write it down.

Two smaller shape mismatches in the same place: `mapSize.name` is a plain `string` (deliberately, so external tools need no import) while `PreviewSettings.mapSize` is the `MapSize` union, so a built-in must re-narrow; and `PreviewOptions.collectSnapshots` is documented at `types.ts:59` as "false in 5.2 batch mode — the only cost knob", which is a decision the preview spec has already made *for* this tool and which the tools doc should acknowledge rather than rediscover.

**Fix.** Add `teams` to `settings` under `read-settings`, as the plain `number[]` the JSON boundary allows (length 8, 0 = un-teamed, and say that entries at index ≥ `playerCount` are not in the game — `types.ts:40-53` is the wording to mirror). Decide the seed. Then see N7, which is the structural version of this finding.

### N2 (blocking). `mapSize.tiles` is the lobby size, and the script can change it

`tiles` is presented as the resolved dimension with no caveat. It is the **lobby** dimension. `override_map_size` (`preview/generator/instantiate.ts:288-302`) replaces it — clamped to `[36, 480]`, honoured only before the first land command, ignored with a note after — and `InstantiatedScript.dim` (`generator/types.ts:127-133`) is the value every stage actually generates against, with its own comment saying it "can differ from the lobby mapSize's own dimensions".

This is not exotic. Any static check keyed on map area — `land_percent` over-allocation and impossible count×spacing are both named in CREATION_PLAN 5.2's brief — computes against the wrong grid on every script that overrides, and it fails *quietly*, in the direction of "your map is fine".

**Fix.** One sentence in Sec.2: `tiles` is the lobby size; a tool that needs the generated dimension must resolve `override_map_size` itself (or call `instantiateScript`). Name `InstantiatedScript.dim` as the authority. This is cheap to state and impossible to guess.

### N3. Sharpening S2 — there is no selection *range* to give a tool, only an anchor

The rev-4 review is right that the brief names `selection` (PLAN.md:56, CREATION_PLAN 5.1) and the doc drops it in a parenthetical, and right that `useSharedSelection.ts` makes it nearly free. Its prescription `selection?: Span` is not implementable as written:

- The Monaco **editor instance** exists only while CodePane is mounted, i.e. while the Code tab is active (`useDocument.ts:255-267` documents this — it is why Ctrl+Z needs a window-level listener at all). **A tool runs from the Tools tab, so there is no mounted editor and no live selection range at run time.**
- What survives a tab switch is `useSharedSelection.ts`'s single nullable **offset anchor**, lifted to app level precisely so it outlives the panes.

**Fix.** If `selection` is added, it is `selection?: { offset: number }` plus, at most, the resolved `Item`'s span from `findItemAtOffsetInScript`. Say that the anchor is what exists and why, or the 5.1 session will go looking for `editor.getSelection()` and find nothing.

### N4. The 5s hard-kill deadline is shorter than one unit of the flagship tool's own work

Sec.4 requires tools to chunk, names "one batch of generations" as the checker's unit, and hard-kills at 5s after cancel — SIGKILL/`terminate()`, synthesizing `error: "cancelled"`, which is indistinguishable in the UI from an orderly cancel.

Measured cost of **one** generation, over the 32 tracked maps on 2026-08-07 (`usePreviewResult.ts:22-30`): **median ~460 ms, worst ~3.8 s**. And this repo has measured its own load factor at up to **3.7×** (CLAUDE.md's tracked-debt table: the same suite at 81 s and 307 s on unchanged code).

So a *correctly implemented, perfectly cooperative* checker, cancelled one millisecond into a `24hr_Caverns.rms` generation, misses the 5s deadline under any load at all and gets killed as if it had wedged. The doc's own claim that chunking "costs well-behaved tools nothing" is true; the deadline is what costs them.

The repo has already paid for this exact mistake once, in the other direction, and the write-up is sitting in the file cited above: the preview watchdog was set to 1000 ms from Sec.11's **40 ms-per-stage budget**, killed and infinitely re-posted every generation slower than it (about a third of the corpus), and is now `WATCHDOG_MS = 12_000` chosen against the measured worst case with `MAX_WATCHDOG_RETRIES = 2`. CLAUDE.md carries it as a hard rule: *a watchdog set below the real cost is a denial of service on your own feature.*

**Fix.** Three parts. (a) The checker's chunk unit is **one generation**, not a batch — that is the smallest unit the generator offers, since `generatePreview` is synchronous and cannot yield inside itself. (b) Derive the grace from the measurement, not from a round number, and say which measurement. (c) Distinguish the two terminals: a user cancel that the tool honoured is not the same event as a tool that had to be killed, and collapsing both into `error: "cancelled"` throws away the only signal that a tool is misbehaving.

Related, and worth one line for whoever designs 5.2: PLAN.md and CREATION_PLAN 5.2 both assume "1000 runs … should be seconds, not minutes". At the measured median that is ~8 minutes for one player count and ~30 for the 2/4/6/8 matrix. `collectSnapshots: false` is the knob and its effect has not been measured. This is a 5.2 problem, not a 5.1 one, but the protocol's progress/cancel/`partial` design is sized by it.

### N5. Nothing kills a run that is never cancelled

The only kill path in the doc is post-cancel. A built-in tool that wedges — an unterminated loop, a stage that never yields — produces an indeterminate progress bar forever, one-run-app-wide, so the pane is bricked until the app restarts. The preview host solved the identical problem with a watchdog plus a retry cap; one-worker-per-run makes it cheaper here than there, because there is nothing to recover.

**Fix.** Specify a run watchdog with the same shape and the same calibration discipline as N4, and a test that exercises it.

### N6. Sec.9's round-trip test cannot catch the next `Infinity`, and `undefined` is already it

Two revisions went into `Infinity`, which is one member of a family: values whose behaviour **differs between structured clone (built-in transport) and JSON (external transport)**. The doc treats the one member it found and never names the class. The others are live:

- **`undefined`** — dropped from objects by `JSON.stringify`, and turned into **`null` inside arrays**, while structured clone preserves it. The preview pipeline already carries `undefined` as a load-bearing value (`InstantiatedValue`, `generator/types.ts:82` — "could not resolve" is not the same as absent).
- **`Map` / `Set`** — serialise to `{}`. `LanguageIndex` (`language.ts:164`) is Maps and Sets, and it is what every in-repo consumer of `LanguageData` actually uses. Related and worth stating outright: `referenceData.language` is plain `LanguageData`, so **every tool must call `buildLanguageIndex` itself** (built-ins import it; external tools reimplement it). One sentence saves a session.

And the test as specified would not catch the first one. `JSON.parse(JSON.stringify(x))` **deep-equal** passes on a dropped `undefined` property under Vitest's `toEqual`, which ignores undefined-valued keys by design. The load-bearing test in the plan is blind to the exact class it exists to guard.

**Fix.** Sec.9's round-trip assertion uses **`toStrictEqual`**, and the fixtures gain an `undefined`-valued optional field and an array containing one. Sec.1's "serializable by construction" goal names the prohibited value set explicitly — no `Map`, `Set`, `Date`, `undefined`, `NaN`, `±Infinity` except via the sentinel — rather than leaving it as an adjective.

### N7 (the structural one). Three revisions in a row have been broken by the same dependency, and hand-mirroring is the cause

- rev 3: `settings.mapSize` was typed `number`; the app had a string union.
- rev 4: `mapSize.tiles` had no source of truth; the data had one, in a directory the search didn't cover.
- rev 5 (N1 above): `settings` is missing `teams`, added to the app three weeks ago.

Each was found by a human reading two documents side by side, and each time the finding was filed as "a cross-doc data dependency same-author review structurally misses" (`tools-api-design.md:203`). It is not really three findings. It is one: **`ToolContext.settings` hand-mirrors a type the app already owns and evolves**, and nothing links the copy to the original, so it decays silently once per revision.

**Fix, and this is the highest-value item in this review.** Add a Sec.9 test that builds a `PreviewSettings` out of a `ToolContext` and calls `generatePreview` with it. It is four lines, it is the flagship tool's actual first step, and **it stops compiling the day the app's settings type grows a field** — which is precisely the event all three findings are instances of. A test that fails at build time beats a rule telling the next reviewer to be more careful, and this document has now recorded that rule three times without it working.

---

## Minor

- **`tools-api/` at the repo root is outside the typecheck gate.** `tsconfig.json:23` is `"include": ["src"]`, so `npm run typecheck` (`tsc --noEmit`) never sees a root-level `tools-api/index.ts` — the one file in the repo that is destined to be a *published* artefact. ESLint would still cover it (`eslint.config.js:11` globs `**/*.{ts,tsx}`), and the purity lint gate at `:35-39` would not, since its globs name the three `src/` directories explicitly. Either add `tools-api` to `include` in the same session the directory is created, or put the contract under `src/`. Name whichever, in Sec.8, next to the layout.
- **The preamble is now false.** `tools-api-design.md:3` says "Written without a scheduled critique pass (token budget)" and Sec.9's heading says "no critique pass — read this hardest". There have since been two independent rounds and this one. Rewrite both, and move the rev-2/3/4 changelogs to `build-log.md` — `preview-design.md` did exactly this at rev 7 and its stated reason applies verbatim: under a do-not-deviate banner, historical self-litigation competes with the spec for the implementer's attention.
- **Say what happens after Apply.** The doc stops at `pushEditOperations`. Breakdown's discrete-edit path calls `reparseNow(source)` (`useParsedDocument.ts`, the BUG-001 Part B fix) to skip the 150 ms typing debounce, because a programmatic edit is one event with nothing to coalesce. A tool's Apply is the same shape and should do the same. Also state explicitly that `rebaseEdit` (`breakdown/ephemeralAnchors.ts:76`) is **not** for tool edits — it exists for Breakdown's in-flight anchors, and the doc's "never rebase tool edits, re-run" rule will read as contradicting a function that is sitting right there.
- **`codeRef` should carry a span, not an offset.** `Diagnostic` (`parser/types.ts:32-44`) carries a `Span`, the diagnostics ruler and Monaco markers consume ranges, and a checker reporting "this `create_object` never places" wants the command highlighted, not a caret at its first character. Widening `{ offset }` to `{ start, end }` is free now and is a breaking wire change once external manifests exist — the same argument S1 makes for widening the `params` value union, and it should be taken for the same reason. Point the jump at `useSharedSelection`'s anchor rather than inventing a Code-tab-specific path; that hook is the app's cross-tab answer already.
- **`ui-help.json` counts have moved**: 97 entries (not 73), and **two** tools-adjacent ids — `tabBar.advancedTools` and `settings.tab.advancedTools` — neither of them inside the pane. The rev-4 review's finding stands unchanged otherwise, including the good question it ends on (does `ToolParamDef.help` or `ui-help.json` own a host-rendered, tool-authored param row?). Note `preview.*` has 13 ids for a pane of comparable complexity; that is the bar.
- **`read-settings` is now an imprecise capability name.** `settings.json` holds four unrelated families — help (1.7), generation (2.5), side-panel layout (4.4), and app display (`src/settings/nameDisplay.ts`, 2026-08-10). The capability carries only the generation ones. It is a consent-dialog string in v1.1, so the gap between "can read your settings" and "can read your player count and map size" is a trust-surface question, not a naming quibble. `read-generation-settings`, or one sentence pinning the scope.

---

## What is right and should survive rev 5

Everything the rev-4 review listed under that heading still holds, and I will not repeat it. Two additions from this pass. The **one-worker-per-run** pin (rev 4) reads even better against the code than it did against the argument: it is what makes N5's watchdog nearly free, and `useParsedDocument.ts:2`'s `?worker` import makes per-run spawn a one-liner. And the doc's habit of recording **what was rejected and why** is what let this round be specific about `predefinedLabels`' optionality — the repo made the opposite call from the rev-4 review, with reasons, and both records survive to be compared. That is the system working.

---

## Process note

**A critique is a repo snapshot too.** The rev-4 review's own thesis is that rev 4 froze the repo and went stale, its Process note prescribes dating every assertion, and its L3 admits its dating discipline is thinner than the discipline it prescribes. Eleven days later, four of its items have decayed — one implemented, one solved by another route, one whose fix would now do harm, one factually inverted. It was not careless; it was accurate on 2026-07-30. **The half-life here is on the order of a week**, and neither a doc nor a review gets an exemption from that.

The consequence for rev 5 is procedural: **fold the rev-4 review in by re-deriving each finding, not by transcribing its edit list.** Two of its fourteen edit-list items are actively wrong today (item 1's fix, item 14's first half) and both are phrased as confident instructions.

The deeper pattern is N7 and it is worth stating twice. Three consecutive revisions were each broken by the same hand-mirrored dependency, and each time the lesson was recorded as "watch for cross-doc data dependencies". That rule has now failed three times, because it asks a reader to notice an absence. The check that would have caught all three is a four-line test that constructs the neighbouring spec's input type from this spec's output type. Prefer the compile error to the rule — the same reason this project prefers an observable to an argument.
