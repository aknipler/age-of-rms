# Build log — Age of RMS

Phase-by-phase record of what was built, why, and what broke along the way. Moved out of `CLAUDE.md` (which had grown to ~95KB and was loaded into every session) so the context file could stay short.

**This is history, not instructions.** Design decisions live in the `docs/*-design.md` specs; hard rules live in `CLAUDE.md`. Read this when you need the *reasoning* behind a past decision, a bug post-mortem, or a verification record.

**Append new session entries at the bottom of the relevant phase.** Keep entries factual; if an entry establishes a durable rule, also add that rule to `CLAUDE.md` or the relevant design spec, because nobody reads this file top-to-bottom.

Two quirks of the inherited content, worth knowing before you trust the order: entries are in **append order, not strict chronological order** (e.g. several `3.1 rev N` entries land after the `3.3` ones, and Phase 5's early start sits after Phase 3), and each entry describes the repo **as of that session** — snapshots inside entries (file counts, line numbers, "still unbuilt" claims) go stale by design. `CLAUDE.md`'s status table is the current state; this file is the trail.

---

**Phase 0 — Foundation (M0): complete.**

- 0.1 Toolchain installed and verified (Node, Rust, MSVC Build Tools, Git) — done.
- 0.2 Tauri 2 + React + TypeScript + Vite scaffold created (`npm create tauri-app@latest`), `npm run tauri dev` confirmed working — done.
- 0.3 Repo/license/context files (this file, LICENSE, README.md, CONTRIBUTING.md, ESLint/Prettier/Vitest config, CI workflow) — done. `git init`, first commit, and push to GitHub — done, repo is live.
- Ran `npm approve-scripts esbuild` to approve esbuild's postinstall (npm 11's new install-script allowlist; expect to hit this again for other native-binary deps).
- Ran `npm audit fix --force`, which bumped vitest 2 → 4 (breaking change, accepted now while only the placeholder smoke test exists — cheapest possible time to take it). Re-verify `npm test`/`npm run typecheck` still pass after this and note here if vitest 4 required config changes.

**Phase 1 — Editor core (M1): complete.**

- 1.1 App shell UI — done and verified. `src/App.tsx` composes `TitleBar`, `MapHeader`, `TabBar` (Breakdown/Code/Advanced Tools — `activeTab` state lifted in `App`, controlled component pattern), a `PlaceholderPane` per tab, and `StatusBar` (static placeholder resource totals). Plain CSS Modules per component, no UI library. Styled to match the mockups' flat bordered look (`aoermsplanning_*.png`, one level up in the parent `AOE2_projects/RMS` folder alongside `PLAN.md`/`CREATION_PLAN.md` — not duplicated into this repo).
- 1.2 File open/save — done and verified. Added `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` (JS) and `tauri-plugin-dialog` + `tauri-plugin-fs` (Rust, registered in `src-tauri/src/lib.rs`); removed the scaffold's unused `greet` command. `src-tauri/capabilities/default.json` grants `dialog:default`, `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-exists`, `fs:scope` allow `**` (unrestricted — .rms files can live anywhere: game install dir, Documents, custom folders; there's no dialog-picked-path auto-scope in Tauri v2), plus `core:window:allow-destroy` and `core:window:allow-close` (NOT included in `core:default`, which only covers read-only window queries — this cost a debugging round, see below). `src/hooks/useDocument.ts` owns filePath/content/isDirty/lastSavedAt and open/save/saveAs, plus a window-close guard (`onCloseRequested`) that offers Save/Discard when closing with unsaved changes. `TitleBar`'s File menu is a working dropdown (Open/Save/Save As); Edit/Preferences/Help remain stubs. The Code tab temporarily renders a plain `<textarea>` bound to the same content/onChange contract Monaco will use in 1.3.
  - Two bugs hit and fixed during verification, both worth remembering: (1) React 18 StrictMode double-invokes effects in dev; `onCloseRequested` registers asynchronously, so the original cleanup could run before registration resolved, leaking a listener that StrictMode's second mount then duplicated — fixed with a `cancelled` flag pattern in the effect. (2) `core:default` does not grant window `destroy`/`close` — a missing-capability call fails as a *silent* unhandled promise rejection with no visible error unless the webview devtools console is open (right-click > Inspect). **General lesson**: a Tauri JS API call that does nothing with no thrown error → suspect a missing capability first, check devtools console.
- 1.3 Monaco integration — done and verified. Added `@monaco-editor/react` + `monaco-editor` deps. `CodePane` renders a real Monaco `<Editor>`, wired to the same `content`/`onChange` from `useDocument`, so Open/edit/dirty/Save all carry over unchanged. Minimap and find widget (Ctrl+F) are both on by default, no extra config needed. **Self-hosted, not CDN-loaded**: `src/editor/monacoSetup.ts` (imported once as a side effect at the top of `main.tsx`) configures `@monaco-editor/react`'s loader to use the local `monaco-editor` package and sets up `self.MonacoEnvironment` to load the editor's web worker via Vite's `?worker` import — deliberate, since this is a desktop app that needs to work fully offline, and the library's default behavior is to fetch Monaco from a CDN at runtime. `vite.config.ts` got `worker: { format: "es" }` so that worker bundles correctly.
  - Hit a `tsc` error needing a `declare global { interface Window { MonacoEnvironment?: monaco.Environment } }` block in `monacoSetup.ts` — Monaco ships the `Environment` type but nothing declares it onto `Window`/`self` by default. Also took an `npm audit fix --force` here (0.55.0 → 0.53.0, a downgrade — the vulnerable dependency, likely `dompurify`, was pulled in by a newer monaco-editor; 0.53 avoids it).
  - Bug found and fixed in the close-guard: the original `ask()`-based flow only branched on *whether to save*, not *whether to close at all* — clicking "No" and dismissing the dialog (Esc/X) both fell through to the same unconditional `destroy()`, so cancelling the close dialog closed the app anyway. Rewrote as a 2-way `confirm()`: "Save and close?" — Ok saves then closes, anything else (Cancel or dismiss) leaves the window open. Deliberately dropped the "discard changes" option rather than risk it again: Tauri's dialog plugin doesn't cleanly expose a 3-button (Save/Discard/Cancel) dialog from JS, and there's no reliable way to distinguish an explicit "Discard" click from a dismissed dialog via the boolean `ask()`/`confirm()` return — that ambiguity was the root cause. If a real Discard option is wanted later, build a custom in-app modal (full control over button semantics and Esc handling) rather than relying on native dialog booleans again.
- 1.4 RMS syntax highlighting — done and verified. `src/editor/aoe2RmsLanguage.ts` registers a custom `"aoe2-rms"` Monaco language (Monarch tokenizer) covering comments, section headers, directives, control keywords, commands, attributes, ALL_CAPS constants, and numbers. Custom `AOE2_RMS_THEME` gives each category its own color after the default theme made several categories look identical. Added `test-maps/sample.rms` for visual verification. (COMMANDS/ATTRIBUTES were hand-written and unverified at first — see 1.5 below, which replaced them with real sourced data.)
- 1.5 Reference DB schema + language definition — done and verified (`npm run validate:reference`, `npm run typecheck` both green). Three JSON Schemas in `reference/schemas/` (`game-constants.schema.json`, `language.schema.json`, `doc-strings.schema.json`, all draft 2020-12) plus populated `reference/data/*.json`, plus `scripts/validate-reference-data.mjs` (ajv-based, checks schema conformance AND that every command's `attributes[]` references actually exist in the top-level `attributes[]` array) wired into `npm run validate:reference` and CI.
  - **Sourcing, important**: the official-looking `support.ageofempires.com` "Random Map Scripting Commands" article is for **AoE3:DE, not AoE2** (XS-scripting camelCase syntax like `rmCreateArea(...)` — confirmed by checking its breadcrumb category before using it, since it would have silently corrupted the whole database otherwise). The real source used was the **Definitive RMS Scripting Guide (Zetnus)**, published at the Google Docs URL linked from `forums.ageofempires.com/t/definitive-random-map-scripting-guide/104902` — same guide PLAN.md already names as the eventual doc-strings seed source. That fetch was **truncated partway through `<CLIFF_GENERATION>`** (~2,464 lines in, mid-sentence) — likely the fetch tool's size limit, not the doc's actual length. Consequence: `PLAYER_SETUP`, `LAND_GENERATION`, `ELEVATION_GENERATION`, and most of `CLIFF_GENERATION` are `"verified": true` with real argument types/ranges/defaults; `TERRAIN_GENERATION`, `CONNECTION_GENERATION`, and `OBJECTS_GENERATION` are mostly `"verified": false` — real command/attribute *names* (confirmed via the guide's syntax-skeleton listing, which was NOT truncated) but no confirmed argument shapes beyond a couple of worked examples. Every unverified entry has a `notes` field explaining exactly what's missing — grep `"verified": false` to find them all. **To finish verifying**: re-fetch the guide starting past the cliff_curliness cutoff (or fetch section-by-section) and fill in the gaps.
  - Caught and fixed one real bug this surfaced: the command is `create_connect_all_players_land` (singular "land"), not `create_connect_all_players_lands` — my Phase 1.4 tokenizer had guessed the plural. `aoe2RmsLanguage.ts`'s `COMMANDS`/`ATTRIBUTES`/`CONTROL_KEYWORDS` now `import languageData from "../../reference/data/language.json"` and derive from it directly (`.map(x => x.name)`) instead of hand-duplicating — the fix propagated automatically once the data file was corrected. This cross-`src/` JSON import typechecks fine.
  - `npm run validate:reference` (ajv schema check + referential-integrity check) caught two real gaps on first run: `base_terrain`/`base_layer` are used both as standalone `LAND_GENERATION` commands *and* as attributes inside `create_elevation`/`create_terrain` blocks — only the command entries existed in `commands[]`; the corresponding `attributes[]` entries were referenced by `create_elevation`/`create_terrain` but never actually added. Added both. This is exactly the class of bug the referential-integrity check exists to catch in a large hand-written dataset — worth re-running after any future edits to `language.json`.
  - Also hit (unrelated to the data itself): `ajv/dist/2020.js` import failed twice — first because `ajv` was a newly-added dependency that `npm install` hadn't been run for yet (looked like an exports/extension problem, wasn't), second because of my own bad fix attempting to drop the `.js` extension (ajv has no package.json `exports` map, so Node's ESM resolver needs the literal file path, unlike CJS `require`'s extension-guessing). **Lesson**: when adding a new dependency to package.json, always say `npm install` explicitly in the same breath — don't assume it's implied.
  - `reference/data/game-constants.json` has ~30 hand-picked common terrains/objects per CREATION_PLAN's explicit allowance ("Step 4.0 can proceed with a hand-made subset"). `constId`/`deTextureFile`/`resourceAmounts` are ALL placeholders (`null` or illustrative numbers) pending the real Phase 4.0 extraction script — do not treat any number in this file as accurate.
  - Verified: `npm run validate:reference` all green after the base_terrain/base_layer fix, `npm run typecheck` clean.
- 1.6 Hover docs — done and verified (confirmed working during 1.7 testing: hover popups appear correctly over commands/attributes/directives/etc., and respect hover/alt-hover/off modes once 1.7 wired that in). `src/editor/aoe2RmsHover.ts` registers a Monaco hover provider for `aoe2-rms` (`registerAoe2RmsHoverProvider()`, called once from `main.tsx`) covering commands, attributes, directives (`#const` etc. — special-cased since Monaco's default word detection strips the leading `#`, so the provider checks the preceding character to reconstruct the full directive name), control keywords, ALL_CAPS constants, and section headers. Each hover shows a generated signature (e.g. `land_percent <percent: 0-100>`, `create_elevation <maxHeight: 1-16> { ... }`) built from `language.json`'s argument shapes, then the matching `reference/data/doc-strings.json` entry if one exists (falling back to `language.json`'s own one-line `description` if not), then an "unverified" caveat when the underlying data's `verified` flag is false. Unknown identifier-like tokens fall back to a "no documentation yet — contribute..." message pointing at `doc-strings.json`/CONTRIBUTING.md, per CREATION_PLAN's spec (no real repo link available to point to, so it references the contributing doc instead).
  - Imports `language.json`/`game-constants.json`/`doc-strings.json` and casts them to explicit local TS interfaces rather than trusting inferred JSON-literal types — with a heterogeneous array (some entries have `arguments`, some don't) TS infers a strict per-element union, and accessing an optional field absent on some union members would be a type error. The cast just asserts what `validate:reference` already enforces.
- 1.7 Universal help system + Preferences — done and verified (`npm run typecheck` clean after the `defaults: {}` fix below; user confirmed Preferences dialog, hover/alt-hover/off modes all work correctly in both the app shell UI and the Monaco editor). Added `@tauri-apps/plugin-store` (JS) + `tauri-plugin-store` (Rust, registered in `src-tauri/src/lib.rs`), capability `store:default` added to `default.json`.
  - `reference/schemas/ui-help.schema.json` + `reference/data/ui-help.json` (13 entries, ids like `titleBar.file`, `mapHeader.mapName`, `preferences.helpMode`) — wired into `scripts/validate-reference-data.mjs`'s `FILES` array.
  - `src/help/helpConstants.ts` — shared constants (`HELP_STORE_FILE = "settings.json"`, `HELP_MODE_KEY = "helpMode"`, `HelpMode = "hover" | "alt-hover" | "off"`, `DEFAULT_HELP_MODE`, `isHelpMode` type guard) — deliberately shared between the React context and the imperative Monaco hover provider so both read/write the same store key instead of drifting apart.
  - `src/help/HelpSettingsContext.tsx` — `HelpSettingsProvider`/`useHelpSettings()`. Loads the persisted mode from the Tauri store on mount, persists on change (`autoSave: true`), and separately tracks global ALT-key-held state via a single `window` keydown/keyup/blur listener (blur clears it, so alt-tabbing away doesn't leave it stuck true).
  - `src/components/HelpTip.tsx` — wraps any element; shows a popup after a 600ms hover delay in `"hover"` mode, only while ALT is held in `"alt-hover"` mode, never in `"off"` mode. Looks up text by `id` in `ui-help.json`, falls back to a "no help written yet" message pointing at the file. `position: relative`/`inline-block` wrapper specifically chosen to avoid breaking existing flex layouts in `TitleBar`/`TabBar`.
  - `src/components/PreferencesDialog.tsx` — simple overlay+box modal (not a separate Tauri window — too heavy for this), radio group for the three `HelpMode` values, itself wrapped in `<HelpTip id="preferences.helpMode">`. Wired into `App.tsx` via new `preferencesOpen` state and `TitleBar`'s new `onOpenPreferences` prop (Preferences is no longer part of `TitleBar`'s inert `STATIC_MENUS` — it's special-cased with a real `onClick` now; Edit/Help remain stubs).
  - `App.tsx` now wraps everything in `<HelpSettingsProvider>`.
  - Retrofitted `TitleBar`, `TabBar`, `StatusBar`, `MapHeader` — every button/label wrapped in `<HelpTip id="...">` matching the ids seeded in `ui-help.json`.
  - `src/editor/aoe2RmsHover.ts`'s `provideHover` is now `async` (Monaco's hover API accepts a Promise): reads `store.get(HELP_MODE_KEY)` first and returns `null` immediately if `"off"`. Per CREATION_PLAN's exact wording, Monaco's own hover has no alt-hover equivalent, so it stays visible for both `"hover"` and `"alt-hover"` and only `"off"` suppresses it.
  - Hit a `tsc` error: the installed `@tauri-apps/plugin-store` version's `StoreOptions` type requires a `defaults` property (not optional, despite older docs/examples showing `{ autoSave: true }` alone) — fixed by passing `{ autoSave: true, defaults: {} }` to both `load()` calls (`HelpSettingsContext.tsx` and `aoe2RmsHover.ts`).
**Phase 2 — Parser (M2): complete**, except `validate()` (parser-design Sec.8), still unbuilt.

- 2.1 Parser design spec — done (Fable session). `docs/parser-design.md` created. Key decisions: the engine's whitespace-token model drives everything (lexer = whitespace splitter + classifier, braces/comment-markers are ordinary tokens only when whitespace-delimited); comments are a token-stream pass; if/start_random are engine-level token *filters*, so the AST treats them structurally where they align with statement boundaries and degrades the whole construct to a RawNode (RMS0110) when they split commands/blocks; argument consumption is data-driven from language.json with severity capped at info for `"verified": false` entries so bad reference data can't produce false errors; `validate()` is a separate semantic pass; two corpus-wide property tests (token coverage + span fidelity) are non-negotiable CI gates because the 3.3 patch engine depends on them. Spec Sec.11 lists 6 assumptions to verify in actual DE (comment nesting, token separation rules, etc.) before 2.3 is declared done. Action items logged in spec: add `predefinedLabels` to language.json (Sec.7); collect real-map corpus into test-maps/ (Sec.12, mind redistribution etiquette).
- Also fixed stale `create_connect_all_players_lands` (plural) in `test-maps/sample.rms` — the 1.5 data fix had corrected language.json but not the sample map.
- 2.1 amendment (same Fable session, after user review): added spec Sec.2.1 — the engine resolves words/constants/numbers into one shared internal token-ID space ("RMS Equivalencies"). In scope for us: bare numeric IDs are valid in constant slots (RMS0204 info) and cross-category constant use resolves by ID (RMS0205 warning with resolved-ID explanation). Out of scope v1: structural aliasing (MILL closing a block, numbers as comment markers) — parser will misparse such obfuscated maps into diagnostics+RawNodes; `ParseOptions.aliasTable` hook designed so importing the Equivalencies sheet as `reference/data/token-aliases.json` later upgrades fidelity without parser changes. Equivalencies sheet (1gr37obgoA_oa_Yikw8rt4AmNtRk4czX9VcRPkQQZPEc) is JS-rendered — fetch failed, import manually, spot-verify against DE (verify item #7).
- Corpus plan updated (spec Sec.12): Ash's own authored maps are the primary committable corpus, pending a one-pass verification (generates in DE + all parse diagnostics triaged).
- New UI requirement logged in PLAN.md + CREATION_PLAN 2.5: status-bar cog → generation-settings pane (map size, players) feeding totals/preview/consistency-checker; manual v1, auto-pull from running game later.
- 2.1 rev 2 — critique session complete, all findings resolved (full changelog in the spec's appendix). Highlights: conditional-wrapped section headers are legal RMS and now degrade to RawNode/RMS0110-info instead of erroring (was a contradiction that would fail legit game-mode-variant maps in the corpus gate); argument stop-set enumerated + includes known command/attribute names (closes the unverified-arity cascade); recursion-safety mandate (explicit stack or depth cap, fuzz has a 20k-nested-if case); RMS0204/0205 ID-wording gated on constants provenance since game-constants IDs are all placeholders; whitespace pinned to C isspace + NBSP/BOM lints; new goal #5 = no false errors on legal maps (only RMS0101/0103 remain error-severity, both with verify items). Verify-in-game list is now 12 items. New schema action items: optional/variadic arg flags, idSource provenance field, predefinedLabels.
- 2.1 rev 3 input — critique of rev 2 against (a) the real-map corpus (11 community maps now in `test-maps/`) and (b) DE patch notes May 2023→July 2026: **`docs/REVISION_3.md`** is the full report; the spec itself is NOT yet edited. Headline: **DE added math expressions in April 2025 (Update 141935; refined in 153015)** — `(A + 1)` style, floats are now first-class everywhere, `#const` can't be redefined (answers verify #5) — and rev 2 doesn't model any of it; corpus maps (Vanguard, Pa_Site) contain live expressions/floats that rev 2 would false-warn on. Other majors: `#include_drs` symbol-table hole (Pa_Site pulls 43 includes), BCC2's glued `}8050` makes it fail the zero-error corpus gate today (needs `test-maps/broken/` escape hatch + makes verify #6 top priority), `avoidance_distance` (Pa_Site ×128) unresolved — either an undocumented attribute or an author bug for `other_zone_avoidance_distance`, per Ash likely the latter; verify before adding to language.json (otherwise zero vocab gaps corpus-wide — everything added in 2024-25 patches is already present), edit-distance did-you-mean (real `elavation` typo in OWWC), new RMS0207 for wrong-context known names. Corpus *confirms* rev-2 architecture: zero conditional/structure overlaps in ~123k tokens, all rnd() canonical, no NBSP/BOM.
- 2.1 rev 3 input, part 2 — **full guide now available locally**: Ash exported the complete Zetnus guide as HTML; cleaned text archived at `AOE2_projects/RMS/reference-docs/definitive-rms-guide-2026-07-16.txt` (workspace level, NOT committed to the repo — redistribution unclear; original zip alongside). This unblocks the `"verified": false` cleanup of language.json (full TERRAIN/CONNECTION/OBJECTS references included). Guide review findings added to REVISION_3.md Sec.7 + Sec.5: **DE comments DO nest** (rev 2's `nestedComments: false` default is wrong), quoted `#include_drs` paths span tokens (needs quote-assembly in arg consumption), `#undefine`/`#include` are non-functional exe ghosts (SymbolInfo.undefined models a fiction; `#ifdef` family should be dropped from language.json), full predefinedLabels list captured (incl. digit-leading names like `1_PLAYER_GAME` + map-size dimensions table), `start_random` can't nest, engine numeric parsing truncates at first non-numeric char, guide's own example endorses conditional-split command/block (verify #3 answered — RMS0110 info confirmed), `avoidance_distance` confirmed author bug (not in guide — don't add). Verify-in-game list: 5 of 12 original items answered from the guide; remaining priorities: #6 unclosed-brace (BCC2 specimen), #4 rnd-in-percent_chance, new #13-#16 (float forms, float rejection points, expression edges, quoted includes).
- 2.1 rev 3 — DONE (Fable session): `docs/parser-design.md` fully rewritten incorporating REVISION_3.md Sec.6 + Sec.7.8, with a few deliberate deviations from the report: (a) expression assembly breaks on control keywords too, not just structural tokens, plus a 64-token collection cap — an unclosed `(` must not eat half the file, and conditionals-inside-expressions degrade to raw consistently with Sec.5.3; (b) expression lints grouped under one code (RMS0210) with variant messages instead of four codes; (c) goal #5 broadened to "no false errors *or false warnings*" since the corpus findings were all false-warning cases; (d) `#ifdef` family = remove from language.json entirely (not in exe dump), while `#undefine`/`#include` = keep with non-functional flag (they ARE in the dump); (e) `IncludeInfo` is structured (token/path/quoted), not `string[]`; (f) RMS0212 digit-prefix lint restricted to argument positions AND exempts if-condition positions (condition labels are arbitrary text per guide). New codes RMS0207–0213. Spec Sec.13 consolidates all data/schema action items. Both critique changelogs are appendices in the spec.
- 2.1 rev 4 — DONE (Fable session, from a fourth critique that independently re-derived the corpus claims). All six substantive findings adopted: RMS0212 re-scoped to numeric-typed argument slots only (rev 3 would have false-warned on `#define 2V1`, live in 5 corpus maps); Sec.8 duplicate-attribute rule split by new `repeatable` schema flag (blanket last-wins would have made Breakdown corrupt connection blocks — repeatable attrs are pinned as lists in Breakdown UI); "skip" eliminated as an AST outcome (rejected tokens join the pending unknown-run — coverage gate satisfiable by construction); symbols/includes survive Sec.5.3 RawNode degradation (token-stream concern, mirrors engine); new validate() shadowing-predefined-names check (`#const GOLD` = silent no-op); errata fixed (ELEVATION header miscount — legality now cited to guide line 148; expression count is actually 45 across 3 files incl. AD4's #const-value expressions, now a required fixture; AK_Six_Points has a live stray `*/` at line 1893 — corpus is not comment-clean). Also: RMS0207 cascade suppression (one glued brace ≠ fifty warnings), RMS0214 malformed-rnd did-you-mean, verify #17 (float rnd bounds), BOM token representation pinned, RMS0004 char set enumerated, sectionHeader regex admits digits, stop set made context-symmetric. Changelog = spec Appendix B.
- 2.1 rev 5 input — fifth critique (Fable session): **`docs/REVISION_5.md`** is the full report; the spec is NOT yet edited. Method: token-level re-derivation of every corpus claim (comment/nesting-aware walker) + verification of every guide citation against the archived guide text. Rev-4 architecture survives; no structural rework. Majors: (1) **guide Example2 (the flagship split-command idiom) never reaches Sec.5.3** — it dispatches through Sec.5.4 to OrphanBlockNode + RMS0102 *warning*, not the promised RMS0110 *info* (goal-#5 violation; fixture also missing from Sec.12); (2) **ArgNode has no token span** — quote-assembled include paths' interior tokens are unreachable from any AST field, breaking both the Sec.12 coverage gate (whose "reachable" is never defined) and the 3.3 patch engine (can't compute the span to edit); (3) **Sec.5.3's wrap is backward-only** — both trigger cases leave the construct's *trailing* closer (the `}` or `endif` ahead of the trigger) to fire a spurious RMS0104/0106 warning; needs forward extension bounded by section header/EOF; (4) **Sec.2.2 modulo-by-0 is self-contradictory**: guide main text ("Modulo 0 gives 0") is stale — the Summer 2025 patch notes changed it to "left operand truncated toward zero", and the spec pasted both; also % truncates (doesn't floor) per the guide's own `-5.9 % -inf` example; (5) guide line 3362 "**comments cannot be used in math expressions**" unmodeled — comment pass runs first, so assembly silently accepts `(A + /* x */ 1)` which the engine rejects (needs an RMS0210 variant checking for trivia inside the expression's index range); (6) **`spacing_to_specific_terrain` maxRepeats:4 is uncited** — guide says "can be used multiple times", no cap (the example just has 4 lines); would false-warn on a legal 5th; (7) corpus claim "zero if/brace imbalances" is false — **ForeDaut line 642 has a live stray extra `endif`** (new RMS0106 corpus fixture; engine provably tolerates). Plus 6 pinned-decision gaps (expression-terminator edges like interior `rnd(1,5)`/`(5)` both ending with `)`; quote-assembly cap unstated; percent_chance/if-condition consumption mechanics — controlKeywords have no `arguments[]` in language.json; unknown-run code for number-initiated runs; section attribution after a Sec.5.3 RawNode containing a header; conditionalDepth vs start_random branches — QS line 1189 specimen), 2 new validate() checks (use-before-definition per guide line 148; `mutexWith` is live data in language.json that nothing consumes), errata (RMS0005 "skipped" vs BOM-as-token; digit-defines are in 8 of 11 maps not 5; guide has 3 more not-a-comment fixture strings incl. `//` — suggested beginner lint). Everything else re-verified exact (45 expressions/3 files, BCC2 depth 1, Six_Points stray `*/` genuinely stray at token level, 123,162 corpus tokens, Vanguard 49,705 tokens/366,303 bytes, zero BOM/NBSP/nested-randoms, newest patch vocab all present in language.json).
- 2.1 rev 5 — DONE (Fable session). All seven substantive REVISION_5 findings adopted, changelog = spec Appendix B (appendices relettered: B=rev5, C=rev4, D=rev2). Key resolutions: guide Example2 gets a dedicated **shared-block rule** in Sec.5.4 (lookbehind: `{` after a just-completed if/random whose branch tails are block-capable commands → OrphanBlockNode + RMS0110 *info*, contents parse — chose the lossless shape over wrapping to raw); ArgNode now has firstToken/lastToken + coverage "reachable" formally defined (deepest-owner + well-nested ranges); Sec.5.3 wraps forward until involved constructs close (bounded by section header/EOF); modulo pinned to truncation-toward-zero (Summer 2025 patch supersedes stale guide text; % is truncate not floor per the guide's own -5.9 % -inf example; new verify #18); comment-inside-expression RMS0210 variant; spacing maxRepeats:4 withdrawn pending re-check of Update 153015's notes (REVISION_3 sourced the cap from patch notes, REVISION_5 confirmed the guide has none — conflict unresolved, so no cap ships); ForeDaut stray-endif correction + fixture. Six ambiguities pinned (expression terminator: rnd-kind tokens never terminate collection, interior `(5)` terminates + lints; quote cap 64; control-keyword operands incl. expression/rnd active in percent_chance slot + `arguments[]`-on-controlKeywords schema action; RMS0215 for value-initiated unknown-runs; wrong-section suppression after degraded headers; conditionalDepth counts random branches). validate() gains use-before-definition (guide line 148) and mutexWith consumption. New codes RMS0215/0216 (0216 = `//`-is-not-a-comment beginner lint, adopted from the report's suggestion).
- **Corpus grew to ~52 files** (was 12): **BCC2 was renamed** `BCC2-Rekawa.rms` (spec's old `_Capt_Knip_edit` name is stale — spec Sec.12 updated). Spec header + Sec.12 now mark all corpus statistics as the 12-file REVISION_5 snapshot; re-derive before citing for the new set. Full 52-file triage is explicitly NOT required — the zero-error gate applies to whatever is present once each file passes the per-map triage protocol; triage incrementally, starting with files already used as fixtures.
- 2.2 Tokenizer — done, **not yet verified locally by Ash** (verified by me in an isolated sandbox copy — see below — since this session's own shell mount is unreliable, see caveat). `src/parser/types.ts` (`Token`/`TokenKind`/`Diagnostic`/`Span`/`LexOptions`/`LexResult`), `src/parser/diagnostics.ts` (full RMS00xx–RMS0216 code table from spec Sec.10, data for 2.3 to reuse, plus the lexer-level message builders actually wired up now: RMS0001/0002/0003/0004/0005/0216), `src/parser/lexer.ts` (`tokenize(source, opts)`), `src/parser/__tests__/lexer.test.ts` (31 tests). Implements spec Sec.2 exactly: whitespace-splitting on the pinned C `isspace` set, classification precedence (exact-match brace/comment markers → sectionHeader → directive → rnd → number → word fallback), a nesting-aware comment-span pass (`nestedComments` defaults true; setting it false degenerately collapses to first-closer-wins without a separate code path), and the three lexer-level lints (RMS0003 glued markers with leading/trailing/embedded message variants, RMS0004 non-standard space chars, RMS0216 `//`-is-not-a-comment). BOM and the RMS0004 character set are built from numeric code points (`String.fromCharCode`) at runtime rather than embedded as literal invisible characters or `\u` escapes in the source — both proved to get silently mangled by this session's own tooling while I was writing the file (see bug below), so runtime construction sidesteps the whole class of problem for good.
  - **Real bug caught during self-verification**: a JSDoc comment in `types.ts` read `` Whether `/* */` comments nest `` — the literal `*/` inside that comment text closes the `/** ... */` doc comment early (JS/TS comments don't nest), corrupting everything after it into broken syntax. `tsc` caught it immediately as a syntax error. Fixed by rewording to avoid the substring entirely ("Whether RMS's block comments... nest inside each other"). Lesson for future sessions: never write a literal `/* ... */` example inside a real comment block — describe it in prose or split the slash-star apart.
  - **Environment caveat, worth knowing about**: while iterating, I found this session's Linux shell mount was serving a **stale cached snapshot** of `types.ts` after an edit (missing its last 4 lines, byte-for-byte reproducible across multiple re-reads and a `cp`), even though the real file (verified via the file-editing tool directly, which is authoritative) was correct and complete the whole time. I did not chase this further — it's a sandbox quirk, not a project bug. Practical effect: I could not fully self-verify `npm test`/`npm run typecheck` against the actual project tree this session, so I mirrored `src/parser/*` into an isolated scratch project (fresh `npm install vitest typescript`) and ran the suite there instead — genuinely the same source files, just copied via heredoc to route around the stale-mount issue. All 31 tests passed and `tsc --noEmit` was clean there, using the same `strict`/`noUnusedLocals`/etc. compiler options as this repo's `tsconfig.json`. Given that history, **please still run the commands below yourself** as the real confirmation.
  - Left `src/smoke.test.ts` in place (couldn't delete it from this session's sandbox — file removal isn't permitted). It's harmless alongside the real suite; delete it locally whenever convenient, per its own "safe to delete once real tests exist" comment.
  - Interpretation note for the guide fixture strings in spec Sec.12 (lines 2936–2943 of the archived guide): under RMS's whitespace-splitting model, a prose string like `/*this is NOT a comment*/` is actually several separate tokens once real spaces are involved, not one — the tests assert the token-level behavior each fixture implies rather than reproducing the guide's markdown prose verbatim. The "triple-backtick string" item has no independent lexical meaning to RMS (backticks aren't special) and is covered generically by the one-giant-token degenerate-input test instead. Full reasoning is in a comment block directly above the `guide fixture strings` describe block in the test file.
  - **Missed a real dependency**: `lexer.test.ts` imports `node:fs`/`node:path`/`node:url` for the corpus offset-exactness test, but `@types/node` was never in `package.json` — `npm run typecheck` correctly failed with `Cannot find module 'node:fs'`. Added `"@types/node": "^22"` to devDependencies. Confirmed the fix against this repo's actual pinned `typescript: ~5.8.3` (not just my scratch sandbox, which had briefly and misleadingly picked up an unpinned newer major version with different auto-`@types` behavior — a red herring, unrelated to this repo). **Lesson, same shape as the ajv one in 1.5**: a new runtime/test-time import needs its types package declared too, not just working "by accident" in whatever sandbox happens to already have it installed.
  - **Needs** (please run and report back): `npm install` (picks up the new `@types/node` dependency), `npm test` (expect 31 passing in `lexer.test.ts`, plus whatever's in `smoke.test.ts`), `npm run typecheck`.
- 2.3 Parser core — done (Fable session), verified in an isolated sandbox mirror (see environment caveat below): **128 tests passing** (31 lexer + 46 parser unit + 47 corpus + 4 fuzz), `tsc --noEmit` clean. Files: `src/parser/language.ts` (LanguageData/LanguageIndex — typed view + lookup maps over language.json; NUMERIC_ARGUMENT_TYPES), `src/parser/types.ts` (AST types appended — NOTE: nodes reference tokens by INDEX into ParseResult.tokens, never Token objects; deliberate, documented in the file, consistent with spec Sec.3 + rev-5 ArgNode), `src/parser/diagnostics.ts` (parser-level builders appended, incl. capToInfo implementing the Sec.6.2 unverified-severity cap), `src/parser/parser.ts` (~1,280 lines — `parseRms()`, iterative explicit-frame-stack, NO recursion so goal #1 holds structurally; Sec.5.1 dispatch, Sec.5.3 degrade with forward extension, Sec.5.4 incl. shared-block rule, Sec.6 consumeArgs with stop set + expression/quote assembly, Sec.7 symbols/includes, RMS0207 cascade suppression, did-you-mean with banded Levenshtein + suffix match), tests in `src/parser/__tests__/` (testUtils.ts has the Sec.12 coverage/span-fidelity property checkers — REUSE THESE in future suites; parser.test.ts; corpus.test.ts — zero-error gate is an explicit ZERO_ERROR_ALLOWLIST of the 11 triaged snapshot maps, BCC2 deliberately excluded, everything else gets no-throw+properties only; fuzz.test.ts — seeded mulberry32, 1k soups + 20k-nested-if + 10k-brace adversaries).
  - **Zero-error gate passes on all 11 triaged maps against real language.json** — Pa_Site (35 expressions, 43 includes, float consts), Vanguard (benchmark, parses well under the 500ms sanity bound), ForeDaut (stray endif → RMS0106 warning only), OWWC, Six_Points (stray */ → RMS0002 warning only) all clean of error-severity diagnostics. This is the strongest validation of both parser and reference data so far.
  - **Fuzz found one real bug pre-commit** (iteration 36): nodes were pushed into their item list AFTER arg consumption, so an assembly-failure RawNode (RMS0208/0209 path) landed BEFORE its owner in the list, breaking item-order monotonicity and section span extension. Fix: all named nodes (command/attribute/directive) are pushed BEFORE consumeArgs runs; a "Push BEFORE consuming args" comment marks each site. Lesson: the Sec.12 property checkers catch ordering bugs unit tests never would — keep them wired into every fixture test (parser.test.ts's parse() helper does this automatically).
  - **Stale-mount environment issue recurred, worse than 2.2**: the sandbox shell mount served (a) pre-session versions of files EDITED this session (types.ts, diagnostics.ts) and (b) a TRUNCATED tail of parser.ts (cut mid-line at 1278/1291 lines) even though it was created this session. The file-editing tool's view is authoritative and was correct throughout. Workaround as in 2.2: mirrored src/parser + language.json + test-maps into /tmp scratch (fresh npm install: vitest typescript @types/node), overwrote the stale/truncated files from in-context authoritative content via heredoc, ran there. Also: the mount's test-maps listing showed 33 files vs the real ~52 — corpus verification here covered the 33 visible ones.
  - **Ash, please run locally to confirm** (authoritative check): `npm test` (expect ~128+ passing; corpus tests will also pick up the ~19 maps the sandbox couldn't see — any NEW no-throw/property failures from those files are real findings, report them) and `npm run typecheck`. Also delete `src/smoke.test.ts` if still present.
  - CREATION_PLAN's "2.3 extension sessions per command group" are mostly obsolete: argument consumption is fully data-driven, so there is no per-command parser code to extend — remaining per-command work is language.json cleanup (Sec.13) + fixtures, not parser changes. Parallelizable Sonnet session: language.json cleanup per spec Sec.13 (fill unverified arg shapes from archived guide; remove #ifdef family; flag #undefine/#include non-functional — parser already reads `nonFunctional`; add predefinedLabels; repeatable flags — NO maxRepeats without re-checking 153015's notes; add `arguments[]` to controlKeywords — parser has the pinned exception ready to be replaced; keep mutexWith, consumed by validate() in 2.4/2.5). In-game verify session: open items #4, #6–10, #12–18 (#6 first — BCC2 specimen; #15 now includes the engine's expression close-detection rule). Corpus triage: incremental; BCC2 → test-maps/broken/ or fix + reduced fixture (then add it to corpus.test.ts's ZERO_ERROR_ALLOWLIST if fixed); newly-triaged maps join the allowlist one by one.
- 2.4 Live diagnostics — done, verified in an isolated sandbox mirror (129 tests passing — 128 parser/lexer + 1 smoke — plus a clean `tsc --noEmit` across the whole frontend, not just src/parser/ this time; `npm run validate:reference` also green). Files:
  - `src/editor/parserWorker.ts` — the actual worker entry (`?worker`-imported, same pattern as `monacoSetup.ts`'s Monaco editor worker). Imports `reference/data/language.json`, double-casts it to `LanguageData` (`as unknown as LanguageData` — a single-step cast isn't guaranteed to typecheck against every optional field the language.json shape has grown since 1.5), calls `parseRms(source, languageData)` on each `{requestId, source}` message, posts back `{requestId, diagnostics, tokenCount, parseTimeMs}`. This is the ONLY file that imports both `src/parser/*` and the reference JSON together — `src/parser/*` itself still has zero React/Monaco/Tauri imports, so it stays worker-safe and Node-testable.
  - `src/editor/useRmsDiagnostics.ts` — debounces `content` changes 150ms (per CREATION_PLAN's exact number), then posts to the worker. Tracks a monotonic `requestId`; a response is only applied if its id matches the *latest sent* request, so a slow/out-of-order response for an edit the user has since typed past gets silently dropped rather than corrupting the display. Returns `{ source, diagnostics }` — deliberately includes `source` (the string the diagnostics were computed for) so callers can detect staleness themselves.
  - `src/editor/diagnosticsToMarkers.ts` — converts `Diagnostic[]` (char offsets) to Monaco `IMarkerData[]` (line/column) via `model.getPositionAt`, which is the same UTF-16-code-unit counting the parser used, so the two never disagree.
  - `src/components/CodePane.tsx` — wires it together: `onMount` captures the Monaco `editor`/`monaco` refs; a `useEffect` on `[source, diagnostics]` calls `monaco.editor.setModelMarkers(model, "aoe2-rms-parser", ...)`, but ONLY if `model.getValue() === source` — guards against applying markers computed for stale content if the user kept typing during the debounce/parse round-trip (next matching result catches up instead). Also reports the applied diagnostics up via a new `onDiagnosticsChange` prop.
  - `src/components/StatusBar.tsx` — new optional `diagnostics` prop, renders "Problems: N errors, M warnings" (or "Problems: none"); `statusBar.problems` added to `ui-help.json`.
  - `src/App.tsx` — lifts diagnostics state (`useState` + a `useCallback`-wrapped setter, same shape as `activeTab`/`preferencesOpen`) and passes it to both `CodePane` (as the setter) and `StatusBar` (as the value). Deliberately NOT cleared when `CodePane` unmounts (e.g. switching to the Breakdown tab) — Problems keeps showing the last known parse, like most editors.
  - **Environment note, third time this has happened (see 2.2/2.3)**: the sandbox shell mount served stale/truncated snapshots of `types.ts`, `parser.ts`, and — new this session — `package.json` itself (truncated mid-`allowScripts`, breaking `npm install` with a JSON parse error in the scratch mirror). All three were confirmed correct and complete via the file-editing tool (authoritative) and rewritten into the scratch mirror via heredoc from that content. This is clearly a caching quirk specific to this sandbox's view of previously-edited files, not a real repo problem — but it means every self-verification this phase required re-fetching supposedly-unchanged files through the authoritative tool rather than trusting `cp`/`cat` from the mount. Flagging again in case a future session hits the same thing and wastes time debugging "corrupted" files that are actually fine.
  - **Ash, please run locally to confirm** (authoritative check): `npm install` (no new dependency this phase), `npm test` (expect the 129 shown above, plus corpus tests will run against your full ~52-map corpus rather than the sandbox's partial view — any new failures there are real findings), `npm run typecheck`, then `npm run tauri dev` and open a `.rms` file on the Code tab — type an unknown command or an unclosed `{` and confirm a squiggle appears and the status bar's Problems count updates within ~150ms; switch to Breakdown and back and confirm Problems doesn't reset to zero.
- 2.4 bug-fix pass (live-testing feedback from Ash) — done, verified in an isolated sandbox mirror (typecheck clean, `validate:reference` clean, all 129 tests still passing). Two real `language.json` data bugs, one confirmed-correct non-bug, and one diagnostics UX fix:
  - **`place_on_forest_zone` is a boolean flag, not an integer-argument attribute** — was wrongly given a `distance` integer argument (copy-paste from `avoid_forest_zone`, which genuinely does take one), causing a false RMS0201 "too few arguments" warning on every real (bare) use. Fixed: `arguments` removed, `verified` flipped to `true`, notes cite the guide's own worked examples showing it used bare.
  - **`left_border`/`right_border`/`top_border`/`bottom_border` wrongly had `"min": 0`** — the guide explicitly allows negative values as long as the land origin stays inside the map (e.g. via `land_position` or a big enough `base_size`), so `min: 0` was producing false RMS0203 range warnings. Fixed: `min` removed from all four (kept `max: 99`), notes cite the guide, plus `top_border`'s pre-existing asymmetric-border bug note. **Also added, per Ash's live-testing caveat**: a negative border can crash the game outright if it pushes the land origin off-map — noted on all four attributes as a CAUTION recommending an explicit `land_position` alongside any negative border.
  - **`spacing` (ELEVATION_GENERATION attribute) was double-checked against Ash's suspicion that 0 should be allowed — guide confirms the existing data (`min: 1, default: 1`) is correct as-is.** Guide text (line ~1286-1289): "Arguments: * Amount - number (1+) (default: 1 - no spacing)". No change made; flagging here so this doesn't get "fixed" again by a future session misreading the same suspicion.
  - **Degradation message (RMS0110) now explains the common unclosed-if/start_random case directly**, rather than relying on a separate diagnostic (RMS0105) whose span is easy to miss under RMS0110's much wider squiggle. Reported behavior: an `if` opened before the map's first section header, never closed, turns the whole rest of the file blue (RMS0110 "shown as raw code") with no obvious hint why. `src/parser/diagnostics.ts`'s `degradedToRaw(first, last, unclosedAtEof = false)` gained a third param that appends "This region runs all the way to the end of the file, which usually means the if/start_random it starts with is missing its endif/end_random." when set. `src/parser/parser.ts`'s `degrade()` now passes `sawUnfinishedAtEof && openConds > 0` (both already computed in that method) as this argument. No existing test asserted exact RMS0110 message text, so this was a safe, backward-compatible addition (default `false` preserves the old message for every other degrade path — shared-block, cross-section spanning, etc.). Manually verified in the sandbox: `if HUGE_MAP` before a section header, no `endif`, now correctly emits both RMS0105 (narrow, on `if`) and an RMS0110 whose message explicitly names the unclosed-conditional cause.
  - **Environment note, same recurring issue (4th time — see 2.2/2.3/2.4)**: this session's sandbox mount served stale views of `diagnostics.ts` (113 lines vs. real 336 — missing the entire 2.3 parser-level builder section), `parser.ts` (missing all comments — a stripped-looking copy), and `language.json` (pre-edit content, no trailing newline, clearly from before this session's edits). All three were confirmed correct via the file-editing tool (authoritative) and rewritten into the scratch mirror via heredoc from that content before running `tsc`/`vitest`/`validate:reference` there. Same workaround as prior phases; flagging again for whichever future session hits it next.
  - **Ash, please run locally to confirm**: `npm run typecheck`, `npm test`, `npm run validate:reference`, then re-test the three fixed attributes in the Code tab (no more false warnings on bare `place_on_forest_zone` or negative border values) and the `if`-before-section-header scenario (confirm the RMS0110 tooltip now mentions the missing endif/end_random).
- 2.4 bug-fix pass, part 2 (Ash noticed the border crash-risk note didn't actually show up on hover) — done, verified in an isolated sandbox mirror (typecheck clean, `validate:reference` clean, 131/131 tests passing — up from 129, two new RMS0217 cases added). Root cause: `buildHoverContents` in `src/editor/aoe2RmsHover.ts` never rendered `language.json`'s `notes` field at all (nor anything else beyond `description`/doc-strings/the unverified caveat) — so the border crash caution added in the first 2.4 bug-fix pass was invisible in the editor no matter how carefully it was worded. Ash's ask: fix the visibility gap, and also make it a live warning (not just static docs) that explicitly says the value is still valid RMS. Implementation, new user-facing channel end to end:
  - **New optional `ArgumentDef` fields** `cautionBelow`/`cautionMessage` (`src/parser/language.ts`, schema in `reference/schemas/language.schema.json`) — distinct from `min`: a value below `cautionBelow` is NOT a range violation, just worth a second look. `cautionMessage` is the exact user-facing text, reused verbatim by both the hover popup and the live diagnostic below (single source of truth, no drift risk between the two surfaces).
  - **New diagnostic RMS0217** (`src/parser/diagnostics.ts`'s `valueCaution()`, severity `warning`) — checked in `parser.ts`'s `consumeOneArg()` only after the existing min/max check passes, so it can never double-fire alongside RMS0203. Logged as a post-spec amendment in `docs/parser-design.md` Sec.10 (not folded silently into the original numbered table).
  - **`left_border`/`right_border`/`top_border`/`bottom_border`** now carry `cautionBelow: 0` + a `cautionMessage` stating the value is valid RMS but can crash the game if it pushes the land origin off-map, recommending an explicit `land_position`. The redundant "CAUTION:" sentence that had been silently sitting unused in `notes` (from the first bug-fix pass) was removed from there now that `cautionMessage` is the real, rendered channel.
  - **Hover fix** (`src/editor/aoe2RmsHover.ts`): new `collectCautions()` helper pulls `cautionMessage` off an entry's arguments; `buildHoverContents()` gained a `cautions` parameter rendering each as `⚠️ **Caution:** ...` beneath the description. Wired into all three call sites that can carry arguments (commands, attributes, directives) — deliberately NOT rendering the generic `notes` field, which is often internal/maintainer-facing bookkeeping text ("Name only — see create_object's notes.") that would be confusing shown verbatim to end users.
  - Two new tests in `parser.test.ts`: negative `left_border` value draws RMS0217 (not RMS0203), with message asserted to contain both "valid RMS" and "land_position"; a non-negative value draws neither.
  - **Ash, please run locally to confirm**: `npm run typecheck`, `npm test`, `npm run validate:reference`, then hover over `left_border`/`right_border`/`top_border`/`bottom_border` in the Code tab and confirm the caution now appears, and type a negative border value to confirm the live warning squiggle appears with the same wording.
- 2.5 Resource totals + generation-settings cog — done. Asked Ash two clarifying questions before implementing (per CREATION_PLAN's explicit instruction) and got both back: (1) if/start_random-driven counts show as a **min-max range**, formatted hyphenated and k-abbreviated (e.g. `10k-15k`, collapsing to a single number like `8k` when min===max); (2) v1 Player/Neutral split is **flag-based**: a `create_object` block containing `set_place_for_every_player` counts as Player (scaled by the generation-settings player count), everything else counts as Neutral — deliberately NOT correlating placement against `LAND_GENERATION`'s per-player land assignment, a known v1 gap logged in the code for a later pass. Verified: 13/13 new tests passing (mirrored `src/parser/*` into an isolated `/tmp` scratch sandbox after discovering it had been fully wiped mid-session — see environment note below), plus `npm run typecheck` (whole frontend, zero errors after fixing three files that got a stray literal `</content>` tag appended by a tool-output leak — caught by `tsc`, not silent), `npx eslint` on every touched file (clean), and `npm run validate:reference` (all four schemas green, including the updated `ui-help.json`).
  - `src/parser/resourceTotals.ts` (new, ~250 lines, zero React/Monaco/Tauri imports per spec Sec.14 — runs unchanged in the parser worker and stays plain-Node Vitest-testable) — `computeResourceTotals(script, tokens, gameConstants, playerCount)` walks the AST summing `create_object` contributions (`number_of_objects × number_of_groups`, `rnd(...)` widening the range directly, `set_place_for_every_player` multiplying by `playerCount`) into `{ total, player, neutral }`, each a `{ min, max }` `ResourceAmounts` (food/wood/gold/stone). If/random branches combine independently **per resource per bucket** (documented design simplification: the branch that minimizes Food need not be the branch that minimizes Gold — each resource reports its own worst/best case, not one joint what-if). `allowZero` distinguishes if-chains with no `else` (can result in nothing placed → 0 floor) from if-with-else and `start_random` (exactly one branch always runs, assuming well-formed `percent_chance` sums → no 0 floor). `src/parser/__tests__/resourceTotals.test.ts` (13 tests) covers the count arithmetic, the flag-based split, and all four range-combination cases (start_random spread, always-one-branch, if-without-else zero floor, if-with-else no floor, rnd widening, sibling-item summing).
  - `src/editor/parserWorker.ts` — now also imports `game-constants.json` (double-cast to a narrow `GameConstantsForTotals`, same reasoning as the existing `LanguageData` cast), computes `resourceTotals` alongside `diagnostics` on every parse, and requires `playerCount` on the request message. `src/editor/useRmsDiagnostics.ts` — signature is now `useRmsDiagnostics(content, playerCount)`, returns `resourceTotals` alongside `source`/`diagnostics`; `playerCount` changes take effect on the next debounce tick without requiring a content edit.
  - `src/generationSettings/` (new folder, mirrors `src/help/`'s context+constants split) — `generationSettingsConstants.ts` (`MAP_SIZES` — AoE2:DE's seven standard size names, `DEFAULT_PLAYER_COUNT = 8`, `MIN_PLAYER_COUNT = 2`/`MAX_PLAYER_COUNT = 8`, type guards) and `GenerationSettingsContext.tsx` (`GenerationSettingsProvider`/`useGenerationSettings()` — loads/persists via the same Tauri store file as `HelpSettingsContext`, `settings.json`, under new keys `generationPlayerCount`/`generationMapSize`, so the app isn't juggling multiple store files for what's conceptually one settings surface). `mapSize` is persisted now but not yet consumed anywhere — reserved for the approximate preview/consistency-checker (PLAN.md), per CREATION_PLAN's framing ("feed the totals now and the preview/consistency-checker later").
  - `src/components/GenerationSettingsDialog.tsx` (new, reuses `PreferencesDialog.module.css` rather than a near-duplicate stylesheet) — number input for player count (2-8), dropdown for map size, both wrapped in `HelpTip`. Opened via a new `⚙` cog button in `StatusBar.tsx` (also `HelpTip`-wrapped, `margin-left: auto` pushes it to the status bar's right edge).
  - `src/components/StatusBar.tsx` — `total`/`player`/`neutral` props (each a `ResourceRange`) replace the old static placeholder spans; new `formatK`/`formatRange`/`formatBucket` helpers implement Ash's exact format decision. `src/App.tsx` — new `AppContent` inner component (split out from `App` because `useGenerationSettings()` must run below `GenerationSettingsProvider` in the tree, same reason `PreferencesDialog`/`HelpTip` call `useHelpSettings()` rather than `App` itself); lifts `resourceTotals` state the same way `diagnostics` already was, wraps everything in `<GenerationSettingsProvider>` (nested inside the existing `<HelpSettingsProvider>`).
  - `reference/data/ui-help.json` — `statusBar.total`/`player`/`neutral` rewritten from "arrives in Phase 2.5" placeholders to real descriptions (explicitly noting the v1 land-ownership gap on Player/Neutral); new entries `statusBar.generationSettings`, `generationSettings.playerCount`, `generationSettings.mapSize`.
  - **Environment note, 5th recurrence (see 2.2/2.3/2.4×2)**: the `/tmp` scratch sandbox used for isolated verification was found fully wiped partway through this session (not just stale-cached like prior phases —`node_modules` and most of `src`/`reference` were entirely gone). Rebuilt from scratch (minimal `package.json`: typescript+vitest+@types/node only, scoped `tsconfig.json`) and re-mirrored every needed `src/parser/*` file via the authoritative file-editing tool. Separately, this session's real-project shell mount hit a **different, new issue**: `npx vitest run` failed there with `Cannot find module '@rollup/rollup-linux-x64-gnu'` (the classic npm optional-dependencies bug, npm/cli#4828 — this mount's `node_modules` was evidently installed on a different OS/arch than the Linux sandbox). Deliberately did NOT try to fix this by installing into the mounted `node_modules` (would mean writing Linux-specific native binaries into a folder that persists back to Ash's Windows machine). Instead ran `tsc --noEmit`/`eslint`/`validate:reference` directly against the real project mount (none of those three need `rollup`) for full-project verification, and used the scratch sandbox for the actual `vitest run` of the new parser tests. `npm test`/`npx vitest run` against the real project remains unverified this session — worth trying again locally (or `rm -rf node_modules && npm install` if Ash hits the same rollup error).
  - **Ash, please run locally to confirm**: `npm install`, `npm test` (expect the new resourceTotals suite passing alongside the existing ~131), `npm run typecheck`, `npm run validate:reference`, then `npm run tauri dev` — open an `.rms` file with a few `create_object` lines on the Code tab and confirm the status bar shows real Total/Player/Neutral numbers instead of zeros, click the new ⚙ cog and confirm the Generation Settings dialog opens with working player-count/map-size fields, and change player count to confirm Player-bucket totals update (for scripts using `set_place_for_every_player`).
- 2.5 fix (Ash caught it right after confirming tests passed): **Player bucket was showing the map-wide total, not a per-player amount** — `computeCreateObjectContribution` multiplied `set_place_for_every_player` counts by `playerCount` and used that same scaled range for both `total` AND `player`, so Player just duplicated Total's number instead of answering "what does one player get". Fixed in `src/parser/resourceTotals.ts`: Player now uses the unscaled per-instance count (what a single player's copy places); Total still uses the `playerCount`-multiplied count (the map-wide sum across every player's copy). Updated the module's header decision-log comment to state this explicitly (Player = per-player, not summed), the two `Player vs Neutral split` tests in `resourceTotals.test.ts` (now 14, was 13 — added a second case confirming Player stays constant at 800 while Total scales from `playerCount=4` to `8`), and `ui-help.json`'s `statusBar.player` text. Verified: 14/14 tests passing in the scratch sandbox, `tsc --noEmit` clean, `eslint` clean, `validate:reference` green.
  - **Ash, please confirm**: `npm test`, then in the Code tab check a script using `set_place_for_every_player` — Player should now show the per-instance amount (e.g. 800 gold for one gold mine per player), not that number multiplied by your player count.
- 2.5 fix #2 (Ash: MENINDEE showed 0 neutral food despite SHORE_FISH/FISH placements) — done, verified. Root cause: `computeCreateObjectContribution` only ever read `node.args[0]` (the primary object type) and zeroed the whole `create_object` block if THAT type had no `resourceAmounts` in `game-constants.json` — it never looked at the block's `second_object` attribute at all. Real maps commonly pair a resource-less placeholder primary type (e.g. `FISH_PLACEHOLDER`, `ONGRID_PLACEHOLDER` — invisible grid markers, no `resourceAmounts` entry and never will have one) with the actual resource object via `second_object TYPE`, e.g. Menindee's `create_object FISH_PLACEHOLDER { ... second_object FISH }`. Fix in `src/parser/resourceTotals.ts`: new `readAttributeConstant()` helper reads `second_object`'s constant name out of the block; new `mergeResourceAmounts()` sums the primary's and second_object's per-instance `resourceAmounts` (both are placed together, once per instance — sum before multiplying by count, not treated as independent counts); `computeCreateObjectContribution` now resolves and combines both instead of early-returning on the primary alone. Also added the missing `SHORE_FISH` constant to `game-constants.json` (`food: 200`, matching the existing generic `FISH` placeholder value) since Menindee's shore-fish block used it and it wasn't in the reference data at all.
  - 5 new tests in `resourceTotals.test.ts` (19 total, was 14): second_object counting alone, summing with a resolving primary, an unresolved second_object name contributing nothing extra, neither resolving still contributing 0 with no throw, and second_object respecting `set_place_for_every_player` the same as the primary.
  - **Verified against the real corpus, not just synthetic fixtures**: ran `computeResourceTotals` against the actual `test-maps/Menindee_AUS_v2.3.rms` (via a throwaway script in the scratch sandbox, real `language.json`/`game-constants.json`, `playerCount: 8`) — neutral food went from 0 to 2,008,600 (matching the huge `FISH_PLACEHOLDER`/`number_of_objects 9999` shore-fish block plus several pond-fish blocks), confirming the fix actually resolves the reported symptom on the real file, not just the unit tests. 19/19 tests passing in the scratch sandbox, `tsc --noEmit`/`eslint`/`validate:reference` all clean against the real project.
  - **Ash, please confirm**: `npm test`, then open Menindee (or another map using `second_object`) in the Code tab and check the status bar's Neutral food is now nonzero.
- Note: `validate()` (spec Sec.8) is still unbuilt — the parser exposes `symbols`/`includes`/`def`s for it; several of its checks (unknown constants, wrong-section, duplicate `#const`) feed the same Problems count 2.4 wired up. It is not a prerequisite for Phase 3 (Breakdown reuses `ParseResult.diagnostics` as-is, Sec.5 of the breakdown spec) — can be done in parallel or after.

**Phase 3 — Breakdown editor (M3), in progress.**

- 3.1 Architecture spec — done (Opus session). `docs/breakdown-design.md` created (rev 1, ~parser-design-level rigor; references parser-design.md heavily and inherits its span/coverage/comment-ownership guarantees rather than re-deriving them — see the spec's Appendix B). Covers all five CREATION_PLAN 3.1 deliverables: (1) AST→UI mapping (Sec.3), (2) the text-patch engine (Sec.4), (3) RawBlock rendering (Sec.3.7), (4) behavior under parse errors (Sec.5), (5) React component + state architecture (Sec.6). Also: help-coverage plan (Sec.8), consolidated schema/data/parser action items (Sec.7), open/verify items (Sec.9), test plan (Sec.10), v1.x deferrals (Sec.11), file layout (Sec.12).
  - **Three design forks were put to Ash up front and all took the ambitious branch** (spec Sec.0 + Appendix A): (a) **control flow is fully editable** — `if`/`elseif`/`else` and `start_random`/`percent_chance` render as editable nested branch groups (edit values, add/delete commands inside branches, add/remove branches), not just viewable; degraded (RawNode/OrphanBlockNode) conditionals stay read-only as the honest boundary. (b) **inserts match surrounding style** — `inferBlockStyle` reads indent unit / EOL / one-per-line-vs-inline from neighbours; no fixed house style. (c) **all supported attributes shown** — a command block lists every attribute from `def.attributes[]` (def order), present ones filled+deletable, absent ones a faint byte-free "add" row; repeatable attrs render as a list (never overwrite — parser Sec.8), flags as presence-checkboxes.
  - **Key architecture decisions pinned for the 3.2–3.4 implementer** (do not deviate without escalating): code is the only source of truth — every user action is an `EditIntent` → `computeEdit(result, intent, lang)` → one `TextEdit` (pure fn, `src/breakdown/patch/`, no React/Monaco, Vitest-testable like the parser), applied then re-parsed; the two byte primitives are span-replace and insert-at-anchor, both computed from the parser's exact token spans; the **Sec.4.8 property test** (patch → reparse → intended-diff-only + comments byte-identical, over the whole corpus, reusing `testUtils.ts` checkers) is the 3.3 gate and must be green before any UI wires to the engine. **Lift the parse to app level** (`useParsedDocument`) since Breakdown needs the full `ParseResult`/AST, not just diagnostics (today the parse lives inside `CodePane`); Code-tab keeps the worker for typing-time squiggles, Breakdown parses on the main thread (fast, synchronous AST for immediate re-render). Ephemeral UI state (expansion/focus) is **anchored to source offsets**, re-resolved after each reparse (node identities don't persist). **Shared undo with Monaco** via a persistent app-level `ITextModel` as the authoritative buffer (Breakdown patches via `pushEditOperations` land on Monaco's own undo stack) — this is a migration from the current controlled-`content` wiring in `useDocument`/`CodePane`; a spike (spec Sec.9 item 4) should confirm model-survives-tab-unmount before committing it in 3.4, with an app-level-undo-stack alternative noted.
  - **Section→tab mapping is data-driven from `language.json` sections[]** (7 canonical: Player Setup / Land / Elevation / Cliff / Terrain / Terrain Connection / Objects — the mockup drew 6 and conflated Terrain/Connection; follow the data, not the mockup), plus a leading **Header** tab for `ScriptNode.preamble` (`#define`/`#const`/`#include` live here) and trailing tabs for unknown sections; duplicate same-type sections aggregate with provenance so edits target the right physical section.
  - **New action items surfaced** (spec Sec.7, none blocking 3.1): a `sectionLabels` map for tab labels; broader `ArgumentDef.default` population for the absent-attribute add-rows; confirm `repeatable` flags on all cumulative attrs; `predefinedLabels` (also a parser Sec.13 item) for condition/constant comboboxes; the Phase-4.0 `game-constants.json` extraction fills the terrain/object comboboxes + reference table (names-only until then).
- 3.1 rev 2 — DONE (same session, after a critique pass). Every empirical claim in the critique was re-verified against the data before adoption; one was wrong and is corrected in the spec (see below). Changelog = spec Appendix C. Two clusters fixed:
  - **Reference-data prerequisites rev 1 assumed existed and don't** (new spec Sec.0.1; Sec.7 split blocking/graceful). Verified **zero occurrences** of `repeatable`, `maxRepeats`, `nonFunctional`, `predefinedLabels`, `sectionLabels` in `language.json`; the **`#ifdef`/`#ifndef`/`#else`/`#endif` entries parser-design Sec.13 ordered removed are still live** in `directives[]`; argument `default` coverage is **34/132 (25.8%)**. Consequences: (a) **new Sec.3.3 ground-truth rule — duplicate present attribute instances render as a list regardless of the `repeatable` flag** (the flag now only governs whether "add another" is offered). Rev 1 keyed the list off the flag, so with zero flags the natural implementation binds one row to the first instance and **silently orphans the rest** — real corpus exposure: 35 `replace_terrain`s in `Rage Forest 2026.rms`, 3 consecutive in one block in `24hr_Bazi is God.rms`. That was invisible-content-loss in Breakdown and one edit from the collapse parser Sec.8 exists to prevent. (b) 3.2 **must hardcode-suppress the four `#ifdef`-family names** from any picker until the data is cleaned, else beginners get offered phantom directives with no warning badge (`nonFunctional`, which drives the badge, doesn't exist). (c) The all-attributes pitch restated honestly — ~74% of absent rows show no default, so the no-default path is the common case.
  - **Patch-engine under-specification, concentrated in the hardest code.** `InsertTarget`'s branch variant was **unimplementable**: `IfBranch`/`RandomBranch` are plain interfaces with no span/parent/index, yet Sec.4.5 needed `branches[i+1].keyword` using an `i` no intent carried → replaced with `BranchRef { parent, index }`. `computeEdit` return pinned to `EditResult { edit, caret }` (rev 1 said "one TextEdit" in Sec.4.1 and "also returns a caret" in Sec.6.3). Optional `condition`/`chance` handled (both `?` in types.ts; rev 1's replace-the-span rule had no span → now insert-after-keyword). **`string` argument type de-overloaded** — `#const`/`#define` *names* are also `type: "string"`, so rev 1's quote round-trip would emit `#const "NAME"`; quoting now applies to filename args only via the `DirectiveNode.hash` → `IncludeInfo.directiveToken` hop. Sec.4.6 delete rule rewritten as two all-or-nothing modes (rev 1's was garbled and could strand a comment at column 0). New Sec.4.11 pins commit-on-blur/Enter/Escape semantics (asserted in Sec.3.4, specified nowhere).
  - **Sec.4.8, the acceptance criterion, made implementable.** Rev 1's "differs in exactly the intended way and no other" is not a testable statement — every insert shifts spans downstream, so a literal structural diff fails on *correct* edits. Now formal: shift `Δ`, pre-/post-/straddling partition, explicit **shift-equal** node equality, five numbered clauses. **Corrected a false claim**: the harness cannot "reuse parser Sec.12's checkers" — `testUtils.ts` exports only `loadLanguage`/`collectNodes`/`checkProperties(result)`, all single-`ParseResult` validators covering the well-formedness clause alone. The **shift-aware AST comparator (`astDiff.ts`) is new work** and is now budgeted as a real 3.3 component. Added seeded `mulberry32` + fixed per-file intent budget (rev 1 said only "generate random intents" — unreproducible and slow in CI).
  - **Sec.6.2 one-parse contradiction resolved**: rev 1 said both "the single parse" and worker-plus-main-thread. Pinned to **one parse in the existing worker** returning the full `ParseResult`; hook returns `{ source, parseResult, diagnostics, resourceTotals }` — `source` retained because `CodePane.tsx:72` uses it as the marker-staleness guard, and `resourceTotals` stays worker-computed so `StatusBar`'s props are genuinely unchanged. AST payload cost is a measured trigger (`wantAst` flag), not an open question.
  - **One critique claim was wrong and is corrected in the spec**: it stated `test-maps/local/` and `test-maps/broken/` both don't exist. **`local/` does exist (19 files)** — it's *gitignored* (`.gitignore:26`), so the real problem is unavailability in CI, not absence; `broken/` genuinely doesn't exist. Sec.10 now treats both as opportunistic (directory-exists check), with no test hard-depending on either.
  - **Still not reviewed by Ash.** No code written — spec only, both revs.
- 3.1 addendum — **"Hide Unused" switch** (Ash's request, post-rev-2). New spec Sec.3.3.1 + mentions in Sec.3.1 (control lives in the section sub-tab row), Sec.8 (HelpTip `breakdown.hideUnused`), Appendix A, and a product-level line in `PLAN.md`'s UI section. View-level boolean toggle that hides attribute rows **corresponding to no bytes in the source** (the faint absent rows of Sec.3.3, incl. unchecked flags). **The pinned line is "no bytes", not "no value"** — a present-but-valueless attribute (e.g. `land_percent` written with no argument, `RMS0201`) stays visible, as do the "Other contents" group and positional args; hiding real content would violate total coverage (goal #3). Cards show a "N unused hidden" count so a filtered view never looks complete. Default off, persisted in `settings.json` like `helpMode`. Rationale: it's the escape valve for the busy-block cost the all-attributes decision knowingly accepted, and it directly mitigates the Sec.0.3 caveat (only 25.8% of arguments have a `default`, so most absent rows currently render empty).
- 3.3 test fix — **3 failing property tests fixed, verified green** (`EM Arabia.rms`, `EM Arena.rms`, `EM Runestones.rms`, all `AssertionError: expected 25 to be less than 25`). **Not a patch-engine bug.** Those three files are 47–52-byte stubs (`#define ESCALATION_MODE` + `#include_drs Arabia.rms`) with no sections, commands, or blocks, so `harvest()` returned all-empty pools, `makeIntent` returned `undefined` all 25 iterations, and the `expect(skipped).toBeLessThan(N_INTENTS)` guard tripped. Two fixes in `src/breakdown/patch/__tests__/patch.property.test.ts`:
  - **Directives are now removable** (the real find). `harvest` had `if (item.kind !== "directive") pools.removables.push(item)` — but `removeNode` explicitly accepts `DirectiveNode` in `intents.ts` and `computeEdit` handles it generically via `removeSpan`. So excluding them was a harness omission, not a design constraint, and it left **every directive edit — the entire Header tab surface (Sec.3.1/Sec.3.6) — with zero property coverage corpus-wide**. Including them closes that gap and makes the EM stubs productive rather than merely exempt. Also tightened `Pools.removables` to `(CommandNode | AttributeNode | DirectiveNode)[]`, which let the `as never` cast on the `removeNode` intent be deleted.
  - **The productivity assertion is now conditional.** "At least one real edit per file" is false as an absolute — a file can legitimately offer nothing to edit. New `isInert(pools)` helper: assert `skipped < N_INTENTS` where targets exist, `skipped === N_INTENTS` where they don't, so both a broken generator *and* a mis-harvested file still fail loudly. (Kept even though fix 1 alone makes the EM files pass — the guard was wrong in principle and would trip again on any inert file, e.g. comment-only.)
  - **Verified** in an isolated `/tmp` scratch mirror (the repo's own `node_modules` still can't run vitest in the Linux sandbox — the documented `@rollup/rollup-linux-x64-gnu` arch error from 2.5; deliberately did NOT install Linux binaries into the mounted tree). Mirror integrity was line-count-checked against source (no stale-mount corruption this session). Results: the 3 originally-failing files pass; full corpus green across four batches (24hr+AK_ incl. Vanguard = 14, Pa_Site/AD4/13_Rings/BCC2/Chaotic/Menindee/OWWC/QS_/Rage/TC2/W4/sample/TL = 19, local DE-official maps = 19); `patch.unit.test.ts` 22/22; `tsc --noEmit` clean. **Ash, please confirm locally with a full `npm test`** — expect 225/225.
- 3.1 rev 3 — DONE (Fable session, from a second critique; changelog = spec Appendix D; all critique claims re-verified against .gitignore/AD4 Pag/parser.ts before adoption — all held). Majors: (1) **the CI corpus is 13 committed files** — `.gitignore:27` is `test-maps/*` with selective negations, and rev 2's own duplicate-attribute specimens (Rage Forest, Bazi) were both untracked; committed specimen is now **`AD4 - Pag - v1.2.rms`** (5× consecutive replace_terrain at 686–690, terrain_costs, commented-out replace_terrain inside a block at 734) everywhere a test names a file. (2) **Sec.3.3 unknown-name model corrected to match parser.ts**: def-less CommandNodes exist only via the word+`{` upgrade; bare unknowns (the `elavation` typo path) are RawNodes → raw cards, now with a specified **did-you-mean quick-fix** backed by a new structured `Diagnostic.suggestion` field (small parser change, Sec.7 item 10, before 3.4); known-but-unlisted attributes arrive fully-resolved with NO diagnostic → normal typed rows, no badge. (3) **Sec.4.8 clause 4 scoped** — delete intents legitimately remove interior trivia; absolute form failed every correct delete of a commented construct. Also: clause 3 ancestor-chain rule stated generically; `AttributeTarget = BlockNode | CommandNode` for the brace-synthesis case; validate() dependency made explicit in Sec.0.1 (two UI notes deferred until it exists); **per-file PRNG seeding** (filename-derived) so dev/CI corpus differences can't desync the property gate; minors (own-lines governance, duplicate-flag list rule, last-percent_chance-branch symmetry, blur-vs-caret focus, Header-tab badge, clause-5 example replaced, `{after: Item}` dropped).
  - **Fixed in code**: `corpus.test.ts` allowlist + benchmark still said `Vanguard_v1.2.rms` after the file's rename to `AK_Vanguard_v1.2.rms` — the benchmark map had silently dropped out of the zero-error gate. Both fixed (Ash: re-run `npm test`; if AK_Vanguard now surfaces error-severity diagnostics they're real findings, likely triage items).
  - Next: 3.2 read-only Breakdown (Sonnet) — section tabs, command cards, all-attributes rows (incl. the Sec.3.3 duplicate-list + rev-3 unknown-name rules), RawBlock display, reference-table side panel; verify against every committed `test-maps/` file. **Do spec Sec.0.1 P1/P2 (the `#ifdef` removal + `nonFunctional`/`repeatable` flags in language.json) first or alongside** — P2 is a beginner-harm path; add `Diagnostic.suggestion` (Sec.7 item 10) in the same pass. Then 3.3 patch engine (Fable/Opus — `astDiff.ts` + the Sec.4.8 property gate green *before* any UI wiring), 3.4 editable (quick-fix ships here), 3.5 help audit. validate() remains its own parallelizable Sonnet session (unblocks two deferred UI notes).
- **3.2 read-only Breakdown — DONE (Sonnet session).** Sec.0.1 P1/P2 prerequisites verified already correct from a prior pass (`#ifdef`/`#ifndef`/`#else`/`#endif` gone from `directives[]`; `nonFunctional: true` on `#undefine`/`#include`; `repeatable: true` on `replace_terrain`/`terrain_cost`/`spacing_to_specific_terrain`/`terrain_size` — `terrain_size` is the judgment call for "connection radii", the closest def in the connection block's attribute list to a radius/band concept; `Diagnostic.suggestion` populated by `unknownName()`) — **but `reference/schemas/language.schema.json` had NOT been updated to allow `repeatable`/`maxRepeats`/`nonFunctional`/`optional`/`variadic`**, so `npm run validate:reference` was actually red going into this session (`additionalProperties: false` rejected the new fields). Fixed as part of this pass — flagging so nobody assumes "P1/P2 already done" meant fully verified end-to-end again.
  - **`sectionLabels`** — `src/breakdown/sectionLabels.ts`, the 7-entry canonical-name→label map per Sec.3.1, plus `CANONICAL_SECTION_ORDER`.
  - **Parse lifted to app level (Sec.6.2)** — `src/editor/parserWorker.ts`'s response widened with the full `parseResult` (structured-clones fine, plain data); new `src/useParsedDocument.ts` (app-level, per spec) owns the one parse and returns `{ source, parseResult, diagnostics, resourceTotals }`; `AppContent` (`src/App.tsx`) calls it once and feeds `CodePane` (now a thin `source`/`diagnostics` props consumer, no longer owns its own worker/hook) and the new `BreakdownPane` (`parseResult`) and `StatusBar` (unchanged props) from the same instance. Old `src/editor/useRmsDiagnostics.ts` is superseded (left as an empty `export {}` stub — this sandbox couldn't delete the file; nothing imports it, safe to actually delete locally).
  - **Full `src/breakdown/` tree** (all of Sec.12's file layout except `patch/`, explicitly 3.3 scope): `BreakdownPane`/`SectionTabs`/`SectionView`/`BlockList`, `cards/{CommandCard,AttributeRow,ConditionalCard,RandomCard,DirectiveCard,RawCard,ItemCard,OtherContentsRow,StrayAttributeCard,ProblemBadge}`, `sidepanel/{BreakdownSidePanel,ReferenceTable,PreviewPlaceholder}`, plus pure logic modules `attributeModel.ts` (the Sec.3.3 all-attributes/ground-truth model), `cardKind.ts` (total Sec.3.2 AST→card mapping, `never`-exhaustive), `sectionTabsModel.ts` (Sec.3.1 tab aggregation + span-containment problem-badge severity), `diagnosticsForSpan.ts`, `renderValue.ts`, `gameConstants.ts`. Everything read-only per scope: value editors render typed but inert, add/delete/toggle affordances are disabled stubs with "arrives in 3.4" tooltips, `RawCard` shows the suggestion text but no apply button. Every interactive element wrapped in `HelpTip` with new `ui-help.json` entries (`breakdown.*`, ~35 new).
  - **Side panel (Sec.3.8) — most under-specified part, built pragmatically**: `PreviewPlaceholder` is the Phase-4 stub with a Current/Final radio toggle (wired to local state only, no preview logic). `ReferenceTable` is a Terrain/Objects/Commands radio + table, **not filtered to the current selection** — spec explicitly calls selection-filtering a "nice-to-have, not required for 3.2", so it wasn't built; deferred to whoever wants it later (a natural fit once cards have real focus/selection state in 3.4).
  - **Verified**: `npx tsc --noEmit` clean (whole project), `npx eslint .` clean on every touched/new file (two pre-existing-pattern warnings only — react-refresh on a context file, react-hooks/exhaustive-deps on the lifted parse hook, both inherited from the code being replaced), `node scripts/validate-reference-data.mjs` all green. Real vitest against the mounted project still hits the known rollup optional-dependency issue (unrelated, see 2.5's note) — instead built an isolated `/tmp` sandbox (parser + breakdown pure `.ts` files only, no React/jsdom) with a new coverage test asserting every `Item` (recursively through blocks/branches/conditionals) in every one of the 33 files under this environment's `test-maps/` maps to exactly one card-kind and that `buildCommandBreakdown`/`buildSectionTabs` never throw — **33/33 passing**, `tsc --noEmit` clean there too.
  - **Ash, please confirm visually**: `npm run tauri dev`, open a real `.rms` file (`AD4 - Pag - v1.2.rms` is the spec's own duplicate-attribute/comment specimen — good first check for the ground-truth list rule), switch to the Breakdown tab, click through section tabs, expand a few command cards, and open a file with a conditional/`start_random` block to see the nested read-only branch rendering. Also worth trying a file with a genuine parse error to confirm the raw-card fallback and the unclosed-container "finish in Code tab" messaging read sensibly.
  - Next: 3.3 patch engine (Fable/Opus — `astDiff.ts` + the Sec.4.8 property gate green *before* any UI wiring), 3.4 wires the read-only stubs built here to real `EditIntent`s, 3.5 help audit.

**Phase 3 — post-3.4 feedback session (Opus).**

- **BUG-001 logged** (`docs/known-issues.md`, new file, linked from CLAUDE.md): Breakdown card expansion jumps to the neighbouring card for ~150ms after a delete. Not a keying bug — offset anchoring (Sec.6.3) is correct and must NOT be replaced with per-card booleans (no stable node identity across reparse). Root cause is sequencing: `BreakdownPane.tsx:103` shifts anchors synchronously while `parseResult` lags behind the debounced worker reparse, so new anchors render against old spans. Prescribed fix is two-part (defer the shift until the matching parse arrives; skip the debounce for programmatic edits). Left for a Sonnet session.
- **Unsaved-changes guard rewritten and generalised.** Was: Tauri's native `confirm()`, a 2-way save-or-stay, because a boolean can't express three outcomes *or* distinguish an explicit "No" from a dismissed dialog. Now: custom `src/components/UnsavedChangesDialog.tsx` with three real outcomes, where the X / Esc / backdrop all report `"cancel"`. Generalised over `UnsavedAction = "close" | "open"` (labels via a `Record<UnsavedAction, …>` mapped type, so adding an action is a compile error until its wording exists).
  - **Open was silently discarding work** — `openFile` had no dirty check at all, so opening a map over unsaved changes lost them with no prompt. Both call sites now share one guard, `ensureSavedBefore(action)`, which returns false on *either* cancel path (dialog Cancel, or backing out of the native Save As picker — the latter previously would have closed the window anyway).
  - Prompt fires **before** the file picker: no point making the user browse if they're going to cancel.
  - `ui-help.json`: close-specific ids replaced with generic `unsavedChanges.save`/`.discard`/`.cancel`/`.dismiss`.
  - Verified: `tsc --noEmit` clean, `eslint` clean on touched files, `validate:reference` green. **Not verifiable from the sandbox** — Ash must test the close/open paths in `npm run tauri dev`.
- **CLAUDE.md gained a "Teaching mode" section**, placed second (before Commands/Hard rules) at Ash's request: he is learning TS/React through this project and it hasn't been happening enough. Rules are behavioural — name the concept, explain the decision not the syntax, show the failing alternative, separate idiom from project quirk, offer a learning check at session end.
- **breakdown-design.md gained three post-3.4 specs** from Ash's live-testing feedback: Sec.3.9 card selection + Add-inserts-after-selection (reinstates `InsertTarget`'s `{ after: Item }`, dropped in rev 3 purely for having no consumer — selection is that consumer); Sec.3.2 sticky section header; Sec.3.10 diagnostics overview ruler (flagged hardest: must map over *rendered card positions*, not source offsets, because cards are variable-height and resize at runtime — the only DOM measurement in Breakdown; sequence last). Plus Sec.4.5 anchor rule, Sec.6.3 selection anchoring with the BUG-001 ordering requirement, Sec.8 help ids, Sec.10 fixtures, Appendix A rows.

- **RMS0202 false-warning campaign (Opus, post-3.4).** Ash reported `#const` values in attribute slots warning. Two fixes, both corpus-measured.
  - **parser-design Sec.6 amendment — user constants satisfy numeric slots.** `consumeOneArg` now consults the symbol table (`Parser.isDefinedSymbol`) before emitting RMS0202: a word naming a `#const`/`#define` **already seen in this parse** draws nothing. "Already seen" is the engine's own rule, not a single-pass limitation — guide L148 says a definition only holds if it is higher up the file, so use-before-definition genuinely fails in-engine and warning is correct; a symbol-collecting pre-pass would be *less* accurate. Unresolvable names keep RMS0202 with a message naming the real problem (undefined, suggest `#const`) and **soften to info when any `#include_drs` is present** (Sec.7 — Pa_Site's 40 all became info). Permissive about `#define`-vs-`#const` on purpose (Sec.2.1: type diagnostics are style warnings, never correctness claims).
  - **`#const` value slot retyped `integer` -> `otherConstant`** (`language.json`). Ash asserted from memory that every constant is a number and aliasing is legal; the guide confirms outright — L3295 "everything ... is represented internally by a numeric identifier", L3353 constants read as numbers "where numeric inputs are expected", L3306 "items can have multiple constants assigned to them". The flagged risk (retyping breaking expression assembly, which would have regressed AD4's `#const MAPAREA (MAPSIZE * MAPSIZE)` Sec.12 fixture) **did not materialise**: `consumeOneArg` dispatches expressions on a leading `(` at parser.ts:906, before any type check, and the `rnd`/number branches are ungated too. All seven value forms fixtured.
  - **Corpus effect: 238 RMS0202 warnings -> 61**, across 52 files; only 3 files still warn (`Rage Forest 2026.rms` 155 -> 0). 11 new parser tests, 160 parser tests passing, patch suites unaffected (22 unit + property gate green in batches), `tsc` and `validate:reference` clean.
  - **BUG-002 logged** for what the measurement exposed and these fixes do *not* cover: (b) undefined words used as opaque identifiers — `actor_area ACT_AREA_TEAM_RES_TERRAIN` x26 in shipped Vanguard, legal via Sec.2.1's token-ID model, evidence that `integer` conflates "magnitude" with "identifier" and probably wants a new `identifier` argument type; (c) unmodeled `$`-prefixed names (x35 across DE-official Acclivity and community TL Team Acropolis — supported syntax we don't model). Also noted: L3353's fuller rule licenses *predefined* constants in *any* numeric slot, which needs the parser to see `game-constants.json` or `predefinedLabels` — not done, no corpus case today.

**Phase 5 (early start).**

- 5.1 Advanced Tools API design — DONE (Fable session, **no critique pass — token budget; spec Sec.9 lists its own known risks in lieu**): `docs/tools-api-design.md`. Core decisions: one JSON-first contract, two transports (built-in tools in a dedicated tool worker — NOT the parser worker; v1.1 external tools speak identical messages as NDJSON over stdin/stdout); tools are display-documents not app-extensions (declarative `OutputBlock`s, no HTML/markdown from tools in v1); capability-gated context (`read-source`/`read-ast`/`read-settings`/`edit-source` — undeclared fields simply absent); progress + cooperative cancellation first-class (the 5.2 checker needs them); **edits are proposals** — Apply button, disjointness check, descending-order single-batch apply through the breakdown Sec.6.4 shared model = one undo entry, staleness guard (model changed since run → re-run, never rebase); `apiVersion` hard-rejects mismatches. Types live in `tools-api/index.ts` (no app imports — future published contract), host in `src/tools/`. Ships with a trivial exemplar tool (scriptStats) alongside the checker. Sec.9 = test plan (serialization round-trip over a real corpus parse is the load-bearing one) + known-risk list for whoever implements.
- 5.1 rev 2 — self-critique applied (same Fable session/author, NOT an independent review — weight accordingly; changelog in spec Sec.9). Two findings would have blocked the flagship tool: (1) rev 1's cooperative cancellation ("cancel() sets a flag the tool polls") was unimplementable across the worker boundary — a tight synchronous loop never services the event loop, so no message ever arrives; now tools MUST chunk work in awaitable units, cancel is a message, and no-terminal-within-5s hard-kills uniformly (worker.terminate() / SIGKILL), with the busy-loop kill path in the test plan. (2) No capability exposed reference data — the checker's static layer needs game-constants + full language.json; added `read-reference`. Also: built-ins may import app modules (checker links the Phase-4 generator → not externalizable until that's a lib — stated honestly); edits from tools without `edit-source` are dropped-with-warning (enforcement on the result path too); codeRef staleness, `text` param type, sync-throw handling, progress throttling.
- 5.1 rev 3 — independent critique received and applied (all 8 findings; changelog in spec Sec.9). The two ship-broken bugs: `settings.mapSize` was typed `number` but is a string union in the app (now `{ name, tiles }` — tools never import app types); `Infinity` in ArgValue silently becomes `null` through JSON (now sentinel-encoded `{inf:±1}` by the context builder on BOTH transports + explicit round-trip fixture). One fix redirected with reasoning: critique offered stripping `ParseResult.source` for the read-ast capability leak — rejected because `tokens[].text` reconstructs the document anyway; pinned as read-ast implies read-source, collapsed in the consent dialog. Also: tools-api type-home contradiction resolved (type-only imports from src/parser; published artifact = bundled .d.ts; dependency inversion rejected); handle↔message cancel binding stated; concurrency = one run app-wide; ToolParamDef discriminated union; GameConstantsData interface = action item in language.ts; **5.2 sequencing warning: the checker's static layer is garbage until Phase 4.0 replaces placeholder game-constants — build structure, don't trust or demo output**.
- 5.1 rev 4 — second independent critique, all 7 adopted (changelog in spec Sec.9). Standouts: `mapSize.tiles` had NO source of truth — new `MAP_SIZE_TILES` constant to create in generationSettingsConstants.ts from the guide's Map Sizes table (do NOT copy preview-design Sec.4's table: 6 rows, omits Giant, unreconciled Giant-252>Huge-240 ordering flagged for 4.3) **[WITHDRAWN at rev 5, 2026-08-10 — do not act on this. The "6 rows, omits Giant" claim described rev 4 of preview-design, which is now at rev 7; the ordering issue was fixed 2026-08-01 and `validate:reference` asserts it; and `MAP_SIZE_TILES` must NOT be created, because `resolveMapDim` in `src/preview/generator/mapDimensions.ts` already does this job from `predefinedLabels`. Cite preview-design by content, never by section number — it renumbers every revision.]**; `ToolContext.parseResult` is now typed `SerializedParseResult` (ArgValue number positions widened to `number | {inf:±1}`) so the compiler forces sentinel decoding; sentinel decode is a PROTOCOL.md per-language rule, published artifact stays types-only; one-worker-per-run (no cross-run state); edit bounds validation; run-time param validation; stderr 64KB ring; NaN impossible by construction. Process lesson reconfirmed: the mapSize finding was a cross-doc data dependency same-author review structurally misses.
- 3.1 rev 4 — third breakdown critique applied (during 3.2). **Systemic finding: the spec froze repo snapshots as normative text and went stale** — Sec.0.1's table was wrong on 4 of 8 rows (P2 is DONE: `repeatable`×4, `nonFunctional`×2, `#ifdef` family removed; `Diagnostic.suggestion` exists at types.ts:43; Sec.6.2/useParsedDocument/sectionLabels implemented; defaults 34/130; CodePane guard at components/CodePane.tsx:63). Table re-synced with rev-4 dates + standing rule: rows carry verified-dates, implementers re-check before acting; a grep-based check script (`scripts/check-breakdown-prereqs.mjs`, `npm run check:breakdown-prereqs`) is the preferred refresh — **built** (post-3.2 refresh pass): re-derives all 8 Sec.0.1 rows from the actual source files (language.json counts, types.ts, sectionLabels.ts, useParsedDocument.ts, CodePane.tsx's staleness-guard line) and reports drift; a report, not a CI gate. Ran clean against the current repo — no drift. Also fixed a stale `#ifdef`-suppression comment in `SectionView.tsx` left over from when P2 was still blocking. **Repeatable reconciliation: the data pass was right, the doc was wrong** — `terrain_size` repeats (per-terrain width/spacing), no "connection radius" attribute does; parser-design Sec.8's phrase is imprecise, correct when next touched. Substantive gaps closed: **`applySuggestion` intent added to Sec.4.1** (quick-fix previously bypassed the intent pipeline entirely — unreachable through the specified architecture and invisible to the Sec.4.8 gate; its per-intent expectation: structure free WITHIN the old RawNode span, nothing outside); **placeholder tokens pinned** (`def.min ?? 0` numeric / literal `TODO` constant-string — both always consumed as ArgNodes, so they can never coalesce into unknown-runs and fail Sec.4.8 on a correct edit); Sec.6.3 anchors inside a deleted range are dropped. Both new Sec.10 fixtures added. Declined for now: moving the changelog appendices out of the doc (flagged as bloat; do it when tokens are cheap).
- Next: 5.1 implementation (pane, host, worker plumbing, scriptStats, protocol tests; same session: generate the published `GameConstantsData` from `reference/schemas/game-constants.schema.json` per tools-api-design rev 5 Sec.2, and add `tools-api` to `tsconfig.json`'s `include` and the eslint purity globs in the same session the directory is created). **The former "create MAP_SIZE_TILES from the guide table" instruction is withdrawn — see the bracketed correction on the rev-4 line above; `resolveMapDim` already exists.** Then 5.2 checker (design session first; mind the 4.0 placeholder-data dependency). Phase-3 next-steps above still stand (3.2 → 3.3 → 3.4).

- 3.3 Text-patch engine — DONE (Fable session), **Sec.4.8 property gate GREEN before any UI wiring** (per CREATION_PLAN's ordering rule). Verified in /tmp scratch mirror (stale-mount workaround again — mount served all files fine this time; one earlier `wc` glitch was cosmetic): `tsc --noEmit` clean; **unit suite 22/22**; **property gate 34/34 files** (33 corpus maps visible to the sandbox + AK_Vanguard, ~25 seeded intents each: setArgValue/removeNode/addAttribute/addCommand; per-file filename-derived mulberry32 seeds per spec Sec.4.8 rev 3). Files: `src/breakdown/patch/intents.ts` (EditIntent incl. rev-4 `applySuggestion` + `AttributeTarget`, PatchError = "edit unavailable", not a crash), `formatStyle.ts` (eol/indent/onOwnLines inference, Sec.4.3 placeholder pins `def.min ?? 0`/`TODO`, renderers return caretOffset), `computeEdit.ts` (~370 lines — all Sec.4.2–4.10 intents; Sec.4.6 whole-line/surgical all-or-nothing deletes; Sec.4.5 anchors incl. branch terminators; brace synthesis; quote round-trip via first-token `"` check), `__tests__/astDiff.ts` (clauses 1/2/4/5 + boundary-stretch rule; clause 3 per-intent checks live in the tests), `patch.property.test.ts` (60s per-file timeout — AK_Vanguard needs ~7s), `patch.unit.test.ts` (every Sec.10 rev-2/3/4 fixture: delete modes incl. trailing-comment + interior-comment clause-4 scoping, duplicate-middle delete, quote/no-quote string overload, absent-condition insert, branch insert middle/last/unclosed-suppressed, add/removeBranch guards incl. last-percent_chance, applySuggestion promote-to-structured, placeholder cleanliness, CRLF).
  - **Spec-level discovery, recorded in breakdown-design Sec.4.8**: the pre/post partition's `end <= start` boundary misclassifies containers that end exactly at an append point — they legitimately STRETCH to absorb the insert (section append, brace synthesis). Comparator accepts identical-or-stretched for nodes touching the edit point; leaf siblings still held to strict identity. Found by the gate's first run — clause 1 failed on correct edits, the exact defect class rev 2/3 kept fixing in the spec.
  - Fixture note: `enable_balanced_elevation` is NOT in language.json attributes (OWWC's `elavation` typo can't round-trip to a structured node yet) — applySuggestion unit fixture uses `base_sixe`→`base_size` instead; when the Sec.13 language cleanup adds the elevation attrs, add the OWWC-real fixture back.
  - **Ash: run locally** — `npm test` (expect +56 from patch suites; property gate will also cover the ~19 maps the sandbox can't see — failures there are real findings) and `npm run typecheck`.
- Next: 3.4 editable Breakdown (Sonnet — wire cards to computeEdit via Sec.6.4's shared-model migration + Sec.4.11 commit semantics + Sec.6.3 anchors; engine API: `computeEdit(parseResult, intent, langIndex) → {edit, caret}`, `applyEdit`, PatchError = disable-the-control). Then 3.5 help audit. 5.1 impl session still pending.

- **3.4 editable Breakdown — DONE (Sonnet session).** Wired the 3.2 read-only tree to the 3.3 patch engine; every affordance the design doc scopes for this session is live.
  - **Sec.6.4 shared Monaco model — went with the spec's primary recommendation, not the fallback.** `src/hooks/useDocument.ts` now creates a single module-scope `monaco.editor.ITextModel` (`documentModel`, URI `inmemory://model/document.rms`) at import time — module-scope, not inside the hook, specifically so React 18 StrictMode's double-invoked render/lazy-init can never attempt `createModel` twice at the same URI (Monaco throws on that). This was safe to do *synchronously* (no `loader.init()` async dance) because `src/editor/monacoSetup.ts` already self-hosts Monaco and calls `loader.config({ monaco })` before React ever renders (`main.tsx`) — `@monaco-editor/react`'s internal loader and this hook's `import * as monaco from "monaco-editor"` are provably the same module instance, so there is no race to spike (Sec.9 item 4's open question resolves cleanly from the existing self-hosting setup). `content` (React state) is now a pure mirror via `documentModel.onDidChangeContent`; dirty tracking switched to `model.getAlternativeVersionId() !== savedVersionIdRef` (the spec's suggested cleaner signal — also means an undo back to the last-saved state correctly clears dirty, a string-compare couldn't do that for free). `CodePane.tsx` dropped `value`/`onChange` entirely and binds via `<Editor path={DOCUMENT_MODEL_PATH} keepCurrentModel />` (confirmed from `@monaco-editor/react`'s source that `path` + `keepCurrentModel` reuse-and-never-dispose an externally-created model at that URI) — Code-tab typing writes directly into the shared model, so it and Breakdown's `pushEditOperations` land on the identical undo/redo stack by construction. `openFile()` uses `model.setValue()` (deliberately resets undo history — a different file is a new buffer); everything else (`applyTextEdit`, used by Breakdown) uses `pushEditOperations` (preserves/extends the stack). **Not spiked interactively against a live `npm run tauri dev`** (sandbox has no Tauri runtime) — flagged for Ash's manual Ctrl+Z check below.
  - **`src/breakdown/applyEdit.ts`** — the only new file that touches both `patch/` types and Monaco-adjacent plumbing (deliberately outside `src/breakdown/patch/`, which stays React/Monaco-free per the standing rule): `applyEditIntent(parseResult, intent, lang, applyTextEdit)` calls `computeEdit`, catches `PatchError` and returns `null` (never throws through to a card), else pushes the `TextEdit` via the passed-in `applyTextEdit` (from `useDocument`) and returns the `EditResult`.
  - **Sec.6.3 ephemeral anchors** — `src/breakdown/ephemeralAnchors.ts` (pure, no React): `shiftAnchors(anchors, edit)` moves/drops offsets by the edit's Δ (dropping any anchor that fell inside the edited range, per the rev-4 rule), `isAnchoredWithin(anchors, span)` is the expanded-card test. Owned by `BreakdownPane` (`expandedAnchors: Set<number>`, shifted on every successful `applyEdit`) rather than each card's local `useState` — `CommandCard`'s expand/collapse now reads `isExpanded(command.span)`/`toggleExpanded` off `BreakdownContext` instead of local state, so it survives a reparse triggered by an edit elsewhere. Focus restoration is a small registry: editors call `registerFocusable(offset, el)` with their own current anchor offset on mount; `requestFocus(offset)` (called after an Enter-commit or an explicit add/delete action, never after a blur-commit, per Sec.4.11) is resolved in an effect keyed on `parseResult` — looks up the exact offset once the next parse's re-render has run, focuses+selects if found, silently drops otherwise (documented simplification: an *exact*-offset match, not a "deepest containing node" walk — see caveats below).
  - **`src/breakdown/cards/ValueEditor.tsx`** — the shared Sec.4.11 commit-semantics editor: uncontrolled `<input defaultValue>` keyed by the value's own anchor offset (so an unrelated reparse never clobbers in-progress typing, and remounts cleanly when the anchor genuinely moves), commits on blur (no refocus) or Enter (`preventDefault` + refocus via caret, no separate blur fires), Escape resets the DOM value without committing, identical-to-current commits are a no-op (no intent built at all), internal whitespace in a non-path slot is rejected inline with no commit. Constant types (`terrainConstant`/`objectConstant`/`otherConstant`) render as a plain `<input>` with a native `<datalist>` populated from `game-constants.json` / `parseResult.symbols` — a real, always-free-text-accepting searchable combobox, just HTML-native rather than a custom dropdown widget (time-boxed judgment call). `AttributeValueEditor` (in `AttributeRow.tsx`, reused by `CommandCard`/`DirectiveCard`/`ConditionalCard`/`RandomCard`) wraps it, renders `expr`-valued args as the spec's read-only pill instead, and detects the Sec.3.4 quoting round-trip via `tokens[arg.firstToken].text.startsWith('"')` to allow-list internal spaces only for genuinely-quoted tokens (filenames), never for `#const`/`#define` names.
  - **Card-by-card wiring**, all going through `BreakdownContext.applyEdit` (new context members: `applyEdit`, `isExpanded`/`toggleExpanded`, `requestFocus`/`registerFocusable`, `parseResult`): `AttributeRow`/`AttributeInstanceRow` — setArgValue, addAttribute (with/without a default, brace-synthesis target when the command has no block), removeNode, toggleFlag (on for absent flags, off via direct node deletion when exactly one instance — simpler and more precise than resolving "the last match"), repeatable "add another" gated on `def.repeatable` + `maxRepeats`. `CommandCard` — delete, positional-arg edits, and (bugfix while wiring) the all-attributes breakdown is now computed whenever the command is *known*, not only when it also has a block — the old `known && command.block` gate silently hid every attribute row for a block-kind command written bare (`create_terrain FOREST` with no `{ }`), which is exactly the case the brace-synthesis path (Sec.4.6) exists to handle; `buildCommandBreakdown` already tolerated `command.block === undefined` internally, so this was a one-line fix, not a new function. `RawCard` — the did-you-mean **[Fix] button**, `applySuggestion` targeting `node.firstToken`. `SectionView` — a real command picker (`src/breakdown/CommandPicker.tsx`: search box + "show all sections" toggle + verified/unverified chip, filtered to `def.section === tab.id` by default), constructing `addCommand` targeting the **last** concrete `SectionNode` a tab aggregates (Sec.3.1's duplicate-section rule) — disabled on the Header tab, since `InsertTarget` has no variant for `ScriptNode.preamble` (a real gap the patch engine's union doesn't cover; not a 3.4 regression, just newly visible now that everything else works). `ConditionalCard`/`RandomCard` — condition/chance edits (handling the optional-condition/-chance insert-after-keyword case per Sec.4.4), add/remove branch (`removeBranch` disabled when it's the only branch, matching computeEdit's own guard), per-branch add-command via the same `CommandPicker` anchored `in: "branch"`, plus a whole-card delete (`removeNode` on the `IfNode`/`RandomNode` — a natural, low-cost addition alongside the required per-branch controls). `DirectiveCard` — arg edits + delete.
  - **Judgment calls, flagged rather than silently made**: (1) focus restoration resolves the caret to an *exact* registered offset, not "walk to the deepest containing node" as Sec.6.3's prose describes — every editor's anchor is already its own value's `span.start`, and `computeEdit`'s `caret` is documented to point at exactly that offset for every intent that matters here, so in practice this is equivalent for everything wired this session; it would need the fuller walk if a future editor's anchor isn't its own caret target. (2) `OrphanBlockNode`'s nested `BlockList` (the shared-block idiom, Sec.3.5 — "read-only in v1") is no longer specially locked: its child items are ordinary structured nodes rendered through the same now-editable `ItemCard`/`CommandCard` chain as everything else, so they're editable in practice even though the spec calls the *card* read-only. The wrapper itself (no add/remove-branch controls, since there's no branch structure) is unchanged; only the "read-only" framing for its contents has quietly stopped being true. Not fixed this session (would need a read-only mode threaded through `BreakdownContext`) — flagged for Ash/a future session rather than silently left. (3) The RawCard "Edit in Code tab" button stays a disabled stub — wiring it needs tab-switch + Monaco cursor-placement plumbing the per-card task list didn't ask for and the session didn't have budget for; noted, not forgotten.
  - **Verified**: `npx tsc --noEmit` clean (whole project). `npx eslint src/breakdown src/hooks/useDocument.ts src/components/CodePane.tsx src/App.tsx` — 0 errors, 2 pre-existing-pattern warnings (`react-refresh/only-export-components` on `BreakdownContext.tsx` and the new `ValueEditor.tsx`, same class of warning 3.2 already had elsewhere). `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green (ui-help.json schema-valid with ~15 new entries + ~15 stale "arrives in 3.4" texts corrected to describe what's now actually wired). **Did not run `npx vitest run`** — the documented rollup arch mismatch — and did not build a new `/tmp` isolated-Vitest suite this session: nothing added is pure-logic-only in the way `ephemeralAnchors.ts`/`ValueEditor.tsx` aren't (they're either trivial pure functions covered by inspection, `shiftAnchors`/`isAnchoredWithin`, or inherently React-rendering-dependent, which per the task brief has no test harness in this project). 3.3's own property/unit suites were not re-run (untouched files; trust-but-note per the task brief).
  - **Ash, please manually verify via `npm run tauri dev`** (none of this was exercised against a live Tauri window): (a) edit an attribute value, confirm it round-trips through Monaco/Code-tab correctly and **Ctrl+Z undoes it** — this is the one piece with no automated coverage at all in this sandbox; (b) delete a command, confirm undo restores it; (c) the RawCard quick-fix on a real typo (e.g. type `craete_land` bare in a section); (d) add-command via the picker, both same-section and "show all sections"; (e) expand a command card, edit something elsewhere that shifts offsets, confirm the card stays expanded; (f) a repeatable-attribute "add another" and a duplicate-flag list delete against `AD4 - Pag - v1.2.rms`; (g) decide whether the OrphanBlockNode read-only regression above needs a same-session-style follow-up or can ride to 3.5.
  - Next: 3.5 help-coverage audit (compare `ui-help.json` against the design doc's Sec.8 checklist — this session added/updated Breakdown entries as it built but did not do a full audit pass, per scope). The two flagged gaps (Header-tab add-command via a preamble `InsertTarget`, OrphanBlockNode read-only enforcement) are natural small follow-ups whenever someone's next in this area.

- **3.4 follow-up — three bugs from Ash's manual pass, all fixed (Sonnet session).**
  - **Duplicate/overlapping HelpTip popups on hover.** `AttributeRow.tsx`'s `AttributeInstanceRow` wrapped a whole row in `<HelpTip id={helpId}>`, but the value editor it renders (`AttributeValueEditor` → `ValueEditor`) *also* wraps its own `<input>` in `<HelpTip id={helpId}>` with the same id — hovering the value fired both wrappers' mouseenter, rendering two overlapping popups with identical text. Same bug independently in `DirectiveCard.tsx` (outer `HelpTip` wrapped the name + all arg editors). Fixed both by narrowing the outer wrap to only the parts with no independent HelpTip of their own (bare-flag checkbox in `AttributeInstanceRow`; the static name span in `DirectiveCard`), leaving each value editor's own HelpTip as the sole wrapper over itself. Checked every other card for the same pattern (`ConditionalCard`/`RandomCard`/`StrayAttributeCard`) — none nest.
  - **RawCard had the did-you-mean Fix button, CommandCard didn't.** Sec.3.3's unknown-name boundary has two cases that both carry a `Diagnostic.suggestion` from `unknownName()`: a bare unknown name (`RawNode`, e.g. `elavation 5`) and a block-attached one (def-less `CommandNode` via the word+`{` upgrade, e.g. `elavation { }`). Only the first got a Fix button last session. Widened `applySuggestion`'s intent type (`src/breakdown/patch/intents.ts`) from `node: RawNode` to `node: RawNode | CommandNode` — `computeEdit`'s implementation only ever reads `node.firstToken`/`lastToken` as a bounds check, so no engine change was needed. Added the same Fix-button treatment to `CommandCard.tsx` (targets `command.name`), a `.fixButton` style in `cards.module.css`, and a `breakdown.commandCard.fix` `ui-help.json` entry.
  - **Undo unreachable from the Breakdown tab.** The Sec.6.4 shared model genuinely has one undo stack, but Ctrl+Z is normally a keybinding the Monaco *editor instance* owns, and that instance only exists while `CodePane` is mounted — switch to Breakdown and nothing listens for Ctrl+Z at all, so Breakdown's own edits (which did land on the model) had no way to be undone without switching back to the Code tab and focusing the editor first. Fixed in `useDocument.ts`: a `window`-level `keydown` listener calls `documentModel.undo()`/`redo()` directly, and steps aside (does nothing) when `document.activeElement` is inside a `.monaco-editor` container so the editor's own binding — which also handles cursor/scroll restoration — keeps handling the keystroke when it's focused. This is additive to, not a replacement for, Monaco's own binding.
  - **Verified**: `npx tsc --noEmit` clean, `npx eslint src/breakdown src/hooks/useDocument.ts` 0 errors, `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green.
  - **Ash, please re-verify**: the three original manual-check items from the 3.4 entry above still apply, plus (a) hover an attribute value and a directive value — should now show exactly one popup; (b) create `elavation { }` in a section, confirm a Fix button now appears on its (CommandCard) unknown-name badge and applying it promotes the card; (c) from the Breakdown tab (Code tab not focused/mounted), make an edit, then Ctrl+Z without switching tabs — should undo in place.

- **3.4 follow-up #2 — three more from Ash's next pass (Sonnet session).** Also noted: another session has been expanding `docs/breakdown-design.md` (still headed "rev 4" but has grown to 734 lines with new Sec.3.9 card-selection/insert-after and Sec.3.10 diagnostics-ruler sections, both explicitly scoped "post-3.4") and opened `docs/known-issues.md` with **BUG-001** (card-expansion jumps to the wrong card for one frame after a delete — an anchor-sequencing race between `expandedAnchors` shifting synchronously and `parseResult` arriving ~150ms+worker-round-trip later; full diagnosis + prescribed two-part fix already written up, not yet applied). Neither is this session's scope — flagging so the next session doesn't rediscover them from scratch.
  - **Redundant/overlapping HelpTips on hover.** Same root cause in two places: a row-level `<HelpTip id={helpId}>` wrapped a value editor that *also* wraps itself in `<HelpTip id={helpId}>` (identical id) — hovering the value fired both, rendering two overlapping popups. `AttributeRow.tsx`'s `AttributeInstanceRow` (whole row wrapped; fixed by narrowing the outer wrap to only the bare-flag checkbox case, which has no nested `ValueEditor`) and `DirectiveCard.tsx` (outer wrap covered the name + every arg editor; narrowed to just the static name span). Checked `ConditionalCard`/`RandomCard`/`StrayAttributeCard` for the same pattern — none nest.
  - **No hover text on attribute/argument *names*, only generic boilerplate on their values.** `breakdown-design.md` Sec.8 says attribute help should be "reused from the Monaco hover DB (`doc-strings.json`/`language.json` descriptions)," but no label in `AttributeRow`/`CommandCard` had ever been wrapped in a `HelpTip` at all — only the value editors were, with generic per-control-kind text ("This attribute's current value"). Fixed properly rather than patching around it: extended `HelpTip` (`src/components/HelpTip.tsx`) with an optional `text` prop that overrides the `ui-help.json` id-based lookup — needed because one `id` is shared across every attribute/argument's label, so a static `ui-help.json` entry can't carry per-name content on its own. New `src/breakdown/helpText.ts` (pure, no React/Monaco) provides `namedEntryHelpText(name, description)` (doc-strings.json summary → `AttributeDef.description` → generic fallback) and `argumentHelpText(argDef, contextName)` (same chain, plus a composed type/range/default fallback for positional args like `maxHeight` that have no `description` field in the data at all today) — reads the *same* `doc-strings.json`/`language.json` data `src/editor/aoe2RmsHover.ts`'s Monaco hover provider reads (not the same code path — a smaller module, since `HelpTip`'s popup is plain text, not markdown — but the same source data, so the two surfaces can't disagree). Wired into `AttributeRow.tsx`'s label spans (both the filled-instance and absent-row cases) and `CommandCard.tsx`'s positional-argument label. Two new generic `ui-help.json` fallback entries (`breakdown.attributeRow.name`, `breakdown.commandCard.argumentName`) for the (normally unreached) case where the dynamic lookup itself returns nothing.
  - **Code-tab diagnostics stayed stale after an undo/redo performed from the Breakdown tab.** Root cause: `CodePane`'s marker-application `useEffect` depends on `[source, diagnostics]`, but `editorRef`/`monacoRef` reset to `null` on every mount (`CodePane` fully unmounts when the Code tab isn't active — `App.tsx`'s `{activeTab === "code" && <CodePane />}`). If the parse already completed *while the Code tab was unmounted* (exactly what an undo/redo triggered from Breakdown does), `source`/`diagnostics` are already current at mount time and never change again afterward — so the effect's one run happens before `handleMount` has set the refs, bails out on the null-ref guard, and is never retried. `setModelMarkers` markers are keyed to the model, which persists across tab switches (`keepCurrentModel`), so the editor kept showing whichever markers were set the *previous* time it was mounted — visibly "pre-Redo" diagnostics, even though the text itself (bound directly to the shared model) was correct. Fixed by extracting the marker-application logic into `applyMarkers` and calling it from both the effect (handles updates while mounted, e.g. typing) and directly from `handleMount` (closes the race — runs the instant the refs are actually ready, using the current `source`/`diagnostics` from that render).
  - **Numbered section tabs** (Ash's ask, cosmetic): `SectionTabs.tsx` now prefixes each tab's label with its render-order index — `0. Header, 1. Player Setup, 2. Land, …` — degrading correctly with no Header tab (numbering just starts at 0 on whatever's first) or extra unknown-section tabs (they continue the count).
  - Also fixed `scripts/check-breakdown-prereqs.mjs`'s own false-positive: its CodePane-guard grep looked for a literal lowercase `"source"` substring, which broke once the guard's local variable was renamed `currentSource` during the marker-race fix — the guard itself was never missing. Loosened to a case-insensitive match.
  - **Verified**: `npx tsc --noEmit` clean, `npx eslint src/breakdown src/components/CodePane.tsx src/components/HelpTip.tsx` 0 errors, `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green (no drift).
  - **Ash, please re-verify**: (a) hover several different attribute *names* (not just values) across a few commands, incl. one with no `description` in the data (should still show something useful, not the fallback "No documentation yet" — those two now only appear for names truly undocumented anywhere); (b) redo the undo/redo-then-switch-tabs sequence from your last report — Code tab's squiggles should now match instantly; (c) glance at the section tab bar for the new numbering.
  - Next: still 3.5 help-coverage audit, plus whatever the other session's BUG-001 fix and Sec.3.9/Sec.3.10 features turn into once picked up. Worth deciding with Ash whether Sec.3.9 (card selection + insert-after) or Sec.3.10 (diagnostics ruler) get scheduled before or after 3.5.

- **3.4 follow-up #3 — absolute section numbering + BUG-001 fixed (Sonnet session).**
  - **Absolute section numbering (Ash's ask).** The numbering added last session used array index, which is *only* correct because `buildSectionTabs` already always pushes all seven canonical tabs (empty if the section is absent) — correct today, but fragile (derived from render position, not identity) and wrong the instant that invariant ever changed, plus the Header tab genuinely does shift everything by one when absent/present, which Ash flagged as wrong. Fixed properly: `sectionLabels.ts` gains `SECTION_NUMBERS` (`header: 0, PLAYER_SETUP: 1, ..., OBJECTS_GENERATION: 7` — fixed by canonical identity, not position), `SectionTab` gains a `number` field set from that map in `sectionTabsModel.ts` (unknown sections continue the count from 8 in first-appearance order — no fixed canonical slot exists for an arbitrary/typo'd section name), `SectionTabs.tsx` renders `tab.number` instead of the map index. New `src/breakdown/__tests__/sectionTabsModel.numbering.test.ts` (4 cases, incl. the load-bearing one: numbering is byte-identical whether or not a middle section like Elevation is actually present in the file).
  - **BUG-001 fixed — both prescribed parts, per `docs/known-issues.md`'s diagnosis from the other session (not re-derived, just implemented).** Root cause recap: `BreakdownPane`'s `expandedAnchors` shifted synchronously with the edit while `parseResult` only caught up ~150ms-debounce+worker-round-trip later, so for that window the UI rendered new (already-shifted) anchors against the still-old AST — a delete's negative Δ moved every later anchor backward into the *preceding* card's span, visibly expanding the wrong card for one frame before self-correcting.
    - **Part A (consistency).** `BreakdownPane.tsx`: replaced the eager `setExpandedAnchors(shiftAnchors(...))` call with a queue (`pendingAnchorShiftsRef: {edit, expectedSource}[]`) plus a chaining baseline (`expectedSourceRef`, so a second edit fired before the first's reparse lands computes its expected source from the *first edit's expected result*, not the still-stale `source` prop — handles rapid edit bursts correctly even when an intermediate source is coalesced away and never itself renders, since `useParsedDocument`'s requestId dedup drops superseded responses). A new effect keyed on `source` resolves the queue: finds the first pending entry whose `expectedSource` matches what actually rendered, applies every shift up to and including it in one `setState` (one commit, no visible intermediate frame), and drops anything before it. If `source` matches nothing in the queue (e.g. manual Code-tab typing raced a Breakdown edit), the queue is dropped rather than left permanently stuck waiting for a source that will never appear — the doc's own "generic, not per-feature" framing was followed but `pendingFocusRef` itself was left untouched, since the doc explicitly calls its existing `[parseResult]`-keyed deferral already correct.
    - **Part B (latency).** `useParsedDocument.ts` gains `reparseNow(source: string)`, sharing a `sendParseRequest` helper with the existing debounced-typing path (`playerCount` mirrored into a ref so the imperative call doesn't need it threaded through). `BreakdownPane.applyEdit` calls `reparseNow(expectedSource)` with the exact string it already computes for the Part A queue — no separate computation — immediately after every successful edit, so a card action's reparse only waits on the worker round-trip, not +150ms of debounce on top. Typing in the Code tab is untouched (still debounced). Threaded through `App.tsx` (`parsed.reparseNow` -> `BreakdownPane`'s new `reparseNow` prop).
    - New `src/breakdown/__tests__/ephemeralAnchors.queue.test.ts` (3 cases) — extracts the exact queue/resolve algorithm as plain functions (mirroring what's now in `BreakdownPane.tsx`) so the sequencing math is covered without rendering React or mocking a worker: anchors provably don't move until the matching source resolves; a rapid two-edit chain resolves correctly even though edit 1's intermediate source is never itself observed; a stuck/out-of-band queue drops instead of hanging.
  - Also fixed a false positive introduced in `scripts/check-breakdown-prereqs.mjs` by this session's own `SECTION_NUMBERS` addition — its `sectionLabels` key-count grep was file-wide and started double-counting once a second canonical-name-keyed object existed in the same file; scoped to the `SECTION_LABELS` object specifically.
  - **Verified**: `npx tsc --noEmit` clean, `npx eslint src/breakdown src/useParsedDocument.ts src/App.tsx src/components/CodePane.tsx` 0 errors, `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green. Both new test files run green in the isolated `/tmp` scratch sandbox (7/7 — the pattern established for `src/parser`/`src/breakdown/patch` pure-logic tests, since `npx vitest run` still can't run directly against this project's mounted `node_modules`, per the standing rule).
  - **Ash, please re-verify**: (a) the section-tab numbers no longer shift if you remove/comment out a middle section like Elevation from a test map; (b) re-run the exact BUG-001 repro from the known-issues writeup (expand a card at position 12+, delete a different card above it) — no wrong-card flash, and it should feel closer to instant than before; (c) also sanity-check a rapid double-action (e.g. click "add another" twice quickly on a repeatable attribute) doesn't misbehave.
  - Next: 3.5 help-coverage audit; Sec.3.9/Sec.3.10 still pending a scheduling decision.

- **3.5 — Breakdown help-coverage audit — DONE (Sonnet session).** Compared every interactive element across `src/breakdown/` (cards, side panel, command picker, section tabs) against Sec.8's checklist and cross-referenced every `HelpTip` id actually used in code (both literal `id="..."` and computed/passed `helpId` props, e.g. `AttributeRow`'s per-kind `breakdown.attributeRow.${helpKind}` and `SectionTabs`' per-section `breakdown.tab.${name}`) against `reference/data/ui-help.json`'s registered entries.
  - **Found and fixed 4 real gaps** — interactive elements with no `HelpTip` at all, not just missing entries: `AttributeRow.tsx`'s per-instance delete ("−") button; `CommandCard.tsx`'s expand/collapse (+/−) toggle; `CommandPicker.tsx`'s search input and its result-entry buttons (the latter also carries the verified/unverified chip Sec.8 explicitly calls out — wrapped the whole results list in one `HelpTip`, not one per row, matching `ReferenceTable.tsx`'s existing pattern rather than spamming a tooltip per visible result). Added the 4 matching `ui-help.json` entries: `breakdown.attributeRow.delete`, `breakdown.commandCard.expand`, `breakdown.addCommand.search`, `breakdown.addCommand.entry`.
  - **Everything else was already covered** — most of 3.2's build already wrapped its stubs, and 3.4 mostly just removed `disabled` rather than adding new bare elements, so the gap was smaller than expected. Final tally: 50 distinct `HelpTip` ids used in `src/breakdown/`, all 50 registered in `ui-help.json`, zero orphaned entries (registered but unused) either.
  - **Verified**: `npx tsc --noEmit` clean, `npx eslint src/breakdown` 0 errors, `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green.
  - **Not done this session** (out of scope for a coverage *audit*, flagged for whoever picks it up): auditing help *text quality* (whether existing entries are actually good, not just present) beyond the fixes already made in the two follow-up sessions; Sec.3.9 (card selection + insert-after) and Sec.3.10 (diagnostics overview ruler) remain unscheduled.
  - Phase 3 (M3) is now feature-complete per the original CREATION_PLAN 3.1-3.5 scope. Remaining Breakdown work is the two Ash-added post-3.4 features (Sec.3.9/Sec.3.10) and BUG-001-class hardening as it's found — no longer "3.x steps," just backlog.
  - Next: Ash to decide sequencing on Sec.3.9 vs Sec.3.10, or move on to Phase 4 (preview) / Phase 4.0 (constants extraction, still undecided per the earlier stalled AskUserQuestion) / Phase 5 groundwork.

- **Sticky section header + Sec.3.9 card selection/insert-after — DONE (Sonnet session).** Ash confirmed the recommended sequencing (sticky header → Sec.3.9 → Sec.3.10, deferring Sec.3.10's DOM-measurement work as hardest/last) with "Yes, do it."
  - **Sticky header**: `SectionView.module.css`'s `.addWrapper` switched from `position: relative` to `position: sticky; top: 0` (plus `z-index: 1`, `background: #fff` so scrolled content doesn't show through). No "Hide Unused" switch or badges row exists yet in `SectionView.tsx`, so this session's scope was just the Add-button row — the rest of the sticky row will fall out for free whenever those are built, since they'd land in the same `.addWrapper`. `CommandPicker`'s own `.wrapper { position: relative }` (in `CommandPicker.module.css`) already anchors its dropdown panel, so the `.addWrapper` position swap needed no follow-on change there.
  - **Sec.3.9 card selection**: new `selectedAnchor: number | null` state in `BreakdownPane.tsx`, offset-anchored exactly like `expandedAnchors` (reused `shiftAnchors` via a new `shiftSingleAnchor` helper in `ephemeralAnchors.ts` for the nullable-single-value case) and threaded through the same BUG-001 queued-shift effect so selection never flashes onto the wrong card for a frame after an edit, same as expansion. `isSelected`/`selectCard`/`clearSelection`/`selectedItem` added to `BreakdownContext`. `selectedItem` is re-resolved fresh every render from the current `parseResult` via a new pure module `src/breakdown/selectionResolve.ts` (`findItemAtOffsetInScript`/`findItemAtOffset`) — descends into `if`/`random` branches (those render as separate nested `ItemCard`s) but not into a command's own block/attributes (no separate `Item` exists for those). `ItemCard.tsx` (the single dispatcher every card — top-level or nested — already goes through, per `BlockList.tsx`) now wraps its output in a clickable div with `isSelected`/`selectCard` and `stopPropagation`, which is what makes "click anywhere on a card, including nested ones, selects only the innermost card" fall out with zero per-card-type special-casing. Tab switch clears selection (`handleSelectTab`). New CSS: `ItemCard.module.css`'s `.selectable`/`.selected` (left accent bar + subtle background, per spec Sec.3.9's affordance requirement).
  - **Insert-after**: `{ after: Item }` reinstated on `InsertTarget` (`patch/intents.ts`) — rev 3 had dropped it as consumer-less; Sec.3.9's selection is that consumer, exactly as the spec's rev-4 note anticipated. New `insertAfterItem()` in `patch/computeEdit.ts`, wired into the `addCommand` dispatch. `SectionView.tsx`'s Add Command button now resolves its `InsertTarget` as `{ after: selectedItem }` when something's selected, else the pre-existing `{ in: "section", section: targetSection }` — matching Sec.3.9's exact two-step resolution. Clicking the pane background (anywhere `ItemCard`'s `stopPropagation` doesn't intercept) now calls `clearSelection` via `SectionView`'s own `onClick`.
  - **Sec.4.8 property gate extended, not just left green by omission**: the reinstated `{ after: Item }` path had no property-test coverage until this session — `patch.property.test.ts`'s `makeIntent` generator gained an `addCmdAfter` case (reuses the existing `removables` pool — every command/attribute/directive at any depth — as anchors, since that's exactly the set of `Item`s Sec.3.9's `selectedItem` can produce). Verified in the `/tmp/age-of-rms-check` sandbox (real repo's mounted `node_modules` still can't run Vitest directly — the Rollup native-binary issue noted in earlier entries persists) against all 33 corpus files (split into two batches to fit the sandbox's command-timeout ceiling; 35 total test cases, all green, 0 failures).
  - New pure-logic tests, also sandbox-verified before being committed as permanent files: `src/breakdown/__tests__/selectionResolve.test.ts` (6 cases — top-level resolution, non-descent into a command's block, if-branch/if-node-itself distinction, random preamble+branch resolution, whitespace-gap → undefined) and `src/breakdown/__tests__/ephemeralAnchors.single.test.ts` (5 cases for `shiftSingleAnchor` — null passthrough, insertion/deletion shift, before-edit no-op, inside-deleted-range drop).
  - **Verified**: `npx tsc --noEmit` clean, `npx eslint` clean on every touched file, `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green (no Sec.0.1 drift). No new `HelpTip`/`ui-help.json` entries needed — selection is a new affordance on existing cards, not a new distinct control, and the spec's Sec.8 checklist doesn't call for one.
  - **Ash, please manually verify**: (a) clicking a card (top-level and nested inside an `if`/`random` branch) shows the left-accent/background marker and only on that innermost card; (b) clicking a value editor inside a card also selects the card, not just the editor; (c) clicking empty pane background clears selection; (d) switching section tabs clears selection; (e) with a card selected, Add Command inserts immediately after it at the right nesting depth/indentation (try one at top level and one inside an `if` branch); (f) deleting the selected card clears selection cleanly (no stale marker, no crash); (g) the Add-button row now stays pinned to the top of the pane while scrolling a long section.
  - Not done this session (unchanged from before): Sec.3.10 diagnostics overview ruler (next up, explicitly sequenced last/hardest per the spec's own cost note); the two long-standing flagged gaps (OrphanBlockNode nested-content read-only enforcement, Header-tab/preamble add-command — the latter arguably now closer given `{ after: Item }` exists, but inserting into an *empty* preamble or with nothing selected there is still unaddressed).
  - Next: Sec.3.10, or Ash's call on reprioritizing to Phase 4/4.0/5.

- **Post-3.9 follow-up: cross-tab selection sync, delete-doesn't-steal-selection, full-width Add Command — DONE (Sonnet session).** Ash's feedback after the previous session: (1) selection should survive the Breakdown <-> Code tab switch, with Code showing the selected card's text mid-screen and selected, and switching back resolving to wherever the Code cursor ended up; (2) deleting a card must never change *which* card is selected unless it's the selected one being deleted; (3) the Add Command button should span the full row.
  - **Selection lifted to App (`src/hooks/useSharedSelection.ts`, new).** Sec.3.9's `selectedAnchor` used to live inside `BreakdownPane`, which is destroyed on every tab switch (`App.tsx` conditionally renders `BreakdownPane`/`CodePane`, not both) — so there was no way for it to survive a switch to Code at all. The new hook owns one `selectedAnchor: number | null` at `AppContent` level, passed into both panes. `BreakdownPane` no longer has its own selection state; its `isSelected`/`selectCard`/`clearSelection`/`selectedItem` in `BreakdownContext`'s value now come straight from this shared hook via a new `selection` prop.
  - **Shift/drop rule generalized to ALL edit origins, not just Breakdown's.** The old BUG-001 queue (still in place for `expandedAnchors`, unchanged) only fired for edits made through Breakdown's own `applyEdit` — fine when selection lived inside Breakdown, but now that Code-tab typing/undo/redo must also shift the anchor correctly, that queue's trigger was too narrow. `useSharedSelection` instead subscribes directly to the shared Monaco model's `onDidChangeContent` (`getDocumentModel()`, already exported from `useDocument.ts`) — this fires for every edit regardless of source, and `model.getValue()` read synchronously inside the handler gives the exact post-edit "expected source" for free (no manual string-surgery needed, unlike the original queue). Multiple simultaneous changes in one event (multi-cursor typing) are sorted highest-offset-first before sequential `shiftSingleAnchor` calls, since Monaco expresses each change relative to the pre-event text. Same resolve-only-once-`source`-matches gating as before, so Breakdown's card selection still can't flash onto the wrong card for a frame.
  - **Breakdown -> Code (the "reveal" half).** `CodePane.tsx` gained a `selectedItem?: Item` prop (App passes `selection.selectedItem`). On mount only (`handleMount`, since @monaco-editor/react only calls it once per actual mount and CodePane fully unmounts/remounts on every tab switch), if present: computes a `monaco.Range` from the item's span via `model.getPositionAt`, then `editor.setSelection(range)` + `editor.revealRangeInCenter(range)` — "that section of code in the middle of the page, text selected."
  - **Code -> Breakdown (the "track" half).** `CodePane` also gained `onCursorOffsetChange?: (offset: number) => void` (App passes `selection.setAnchor`), wired to `editor.onDidChangeCursorSelection` inside `handleMount` — fires continuously while the Code tab is open, so the shared anchor always reflects wherever the user's cursor currently is, not just wherever it was at the moment of switching. The listener reads the callback through a ref (`onCursorOffsetChangeRef`) to avoid the same stale-closure trap `useDocument.ts`'s `isDirtyRef`/`filePathRef` already solve, and is explicitly disposed both on re-registration and on unmount.
  - **Breakdown's own mount-time catch-up.** Since `BreakdownPane` now receives `selectedAnchor` as a prop that may already be non-null at mount (set from the Code tab), a new mount-only effect resolves which section tab contains that anchor's item (reusing `findItemAtOffset` over each tab's items) and switches `activeTabId` to it, then queues a scroll. `ItemCard.tsx` now carries a `data-anchor={item.span.start}` attribute specifically so a second effect (keyed on `[activeTabId, parseResult]`, resolving once the target tab has actually rendered the card) can `document.querySelector` it and call `scrollIntoView({ block: "center" })`. Deliberately mount-only (`didMountSyncRef`) — clicking a different card later in the same Breakdown session must not re-trigger a tab jump.
  - **Delete/remove no longer steals selection.** Every delete/remove button across the card components (`CommandCard`, `AttributeRow`'s per-instance delete AND its bare-flag uncheck checkbox, `DirectiveCard`, `RandomCard`'s whole-block delete AND its per-branch remove, `ConditionalCard`'s whole-conditional delete AND its per-branch remove) now calls `e.stopPropagation()` before dispatching its `removeNode`/`removeBranch` intent. Root cause: none of these controls stopped propagation, so every delete click bubbled up into `ItemCard`'s own click handler first — which unconditionally selected THAT card (via Sec.3.9's stopPropagation-at-the-wrapper design) an instant before removing it. Deleting card B while card A was selected therefore always reselected B first, then dropped selection entirely once B's anchor fell inside the deleted range — net effect, deleting *any* card cleared whatever was actually selected. Now a delete click never reaches `ItemCard`'s selection handler at all, so only deleting the card that IS currently selected can clear it (via the existing anchor-drop rule) — deleting any other card leaves selection untouched.
  - **Add Command spans the full row.** `SectionView.module.css`: `.addWrapper` switched from `align-self: flex-start` to `align-self: stretch`; `.addButton` gained `display: block; width: 100%; text-align: left` (was sized to its own text). `CommandPicker`'s dropdown panel is unaffected — it's `position: absolute` off its own `.wrapper`, not sized relative to the button.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on every touched file (`App.tsx`, `useSharedSelection.ts`, `BreakdownPane.tsx`, `ItemCard.tsx`, `CodePane.tsx`, all 5 card files with delete buttons, `SectionView.tsx`); `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green.
  - **Not sandbox-testable this session**: the cross-tab sync logic is fundamentally a Monaco + DOM integration (`editor.setSelection`, `revealRangeInCenter`, `onDidChangeCursorSelection`, `scrollIntoView`, `document.querySelector`) with no pure-logic core to extract beyond what `ephemeralAnchors.single.test.ts`/`selectionResolve.test.ts` already cover from the prior session — those still apply unchanged (the shift/drop math and offset-to-Item resolution are identical, only the *trigger* for the shift moved from `applyEdit`-queueing to the model's own change event). No new automated tests added this session; verification is manual only.
  - **Ash, please manually verify**: (a) select a card in Breakdown, switch to Code — the corresponding text is selected and scrolled to the middle of the editor; (b) in Code, click/move the cursor somewhere else (don't touch Breakdown), switch to Breakdown — the card under wherever the cursor ended up is now selected and scrolled into view, on the correct section tab (test with a target in a *different* section than whatever was selected before, and with a target inside an `if`/`random` branch); (c) with card A selected, delete card B elsewhere in the same section (or a different section) — A is still selected afterward; (d) delete the actually-selected card — selection clears cleanly, no stale marker; (e) uncheck a bare-flag attribute checkbox and delete a repeatable attribute instance — neither steals selection from whatever card was selected; (f) the Add Command button now visually spans the full width of the pane, not just its own text width, and still opens the picker correctly positioned; (g) rapid-fire: type a few edits in Code tab, then immediately switch to Breakdown — no wrong-card flash (BUG-001-class regression check, now that the shift trigger changed).
  - Next: Sec.3.10 diagnostics overview ruler remains the only unscheduled post-3.4 Breakdown item.

- **Post-cross-tab-sync bug reports: scroll fix, comments-in-Breakdown, rapid-delete data corruption — DONE (Sonnet session).** Ash tested the previous session's work and reported three things: selection was landing on the right card/tab when switching Code -> Breakdown but the pane wasn't scrolling to it; comments aren't shown in Breakdown at all; and rapidly deleting several cards in a row sometimes truncated an unrelated, different command elsewhere in the file.
  - **Scroll fix.** Root cause: `BreakdownPane`'s mount-sync effect queued the scroll target using the raw `selection.selectedAnchor` — wherever the Code-tab cursor happened to be, almost never a command's `span.start`. `ItemCard`'s `data-anchor` attribute (what the scroll effect queries for) is keyed on `span.start`, so the query silently matched nothing whenever the cursor wasn't exactly at a card's first character — which is why selection itself still worked (`isSelected` does a range check, not exact match) but the scroll never fired. Fixed by using `selection.selectedItem.span.start` (the already-resolved containing Item) instead of the raw anchor, in both the tab-lookup and the scroll-target assignment.
  - **Comments now shown in Breakdown.** New pure module `src/breakdown/comments.ts`: `extractComments(tokens)` re-derives each top-level `/* */` comment's span by re-pairing `commentOpen`/`commentClose` among trivia tokens with a nesting-depth counter (comments are pure trivia — parser-design Sec.2 — so the parser never puts them in the AST; this was the reason they were invisible to begin with, not a rendering oversight). `commentsBetweenItems(items, comments)` attributes each comment to whichever GAP between two consecutive items in a given list it falls into — deliberately the only placement that's unambiguous without knowing a list's own container boundaries; a comment before the first item or after the last item of any list is out of scope for v1 and doesn't render yet (documented in both the module and the build log so it isn't mistaken for a bug later). New read-only `CommentCard.tsx` (dashed border, italic muted text, its own `breakdown.commentCard` HelpTip/`ui-help.json` entry) — not editable from Breakdown, same as raw/orphan regions (Sec.3.7); Code-tab-only for now. `BreakdownContext` gained a `comments: Span[]` field (computed once per parse in `BreakdownPane` via `extractComments(parseResult.tokens)`); `BlockList.tsx` — the single recursive Item[] renderer used everywhere (section bodies, if/random branches, orphan-block contents) — now interleaves `CommentCard`s between the `ItemCard`s of whichever list it's rendering, so this covers every nesting level for free, not just top-level section comments.
  - **Rapid-delete data corruption — the serious one.** Root cause: `computeEdit` (the pure patch engine) only knows about `parseResult`, the last CONFIRMED parse — its returned edit's byte offsets are only valid relative to THAT parse's source. `pushEditOperations` (in `applyTextEdit`) is synchronous, so a second card action fired before the first action's reparse lands lands on a model that's already been shifted by the first edit, while its own offsets were computed against the PRE-first-edit source. `BreakdownPane`'s `applyEdit` wrapper was blindly splicing those stale offsets into `expectedSource` (itself already reflecting the first edit) to compute the UI's anchor-shift queue — the exact moment two edits' coordinate spaces silently diverged, corrupting whatever text happened to occupy the stale offsets in the new coordinate space. This is a data-corruption bug, not just a UI glitch (BUG-001 was the UI-only version of a structurally similar problem; this is its text-editing analogue, and had been silently possible since 3.4 — the "sanity-check a rapid double-action" line in an earlier build-log entry flagged the *risk* without catching this specific manifestation).
    - Fix: two new pure functions in `ephemeralAnchors.ts` — `rebaseEdit(edit, priorEdits)` walks a freshly-computed edit's `[start, end)` through a chain of not-yet-confirmed prior edits (each entirely before, entirely after — shift by that edit's delta — or overlapping, in which case return `null`, treated exactly like `PatchError`: "unavailable right now," not a crash) — and `shiftPointThroughEdits(point, priorEdits)`, the same chain applied to a single point (the post-edit caret) via repeated `shiftSingleAnchor`.
    - `applyEditIntent` (`applyEdit.ts`) gained a `priorEdits: readonly OffsetEdit[] = []` parameter: after `computeEdit` succeeds, it rebases the edit (and caret) through `priorEdits` before calling `applyTextEdit`, returning `null` if the rebase says the edit can't be safely resolved yet.
    - `BreakdownPane`'s `applyEdit` callback now passes `pendingAnchorShiftsRef.current.map(p => p.edit)` (the SAME queue that already tracks not-yet-confirmed edits for the BUG-001 anchor-shift fix) as `priorEdits` — no new state needed, just reusing what was already being tracked for a different purpose.
    - Net effect: rapid consecutive card actions (delete, delete, delete, faster than a reparse round-trip) now either land correctly-rebased or silently no-op (treated as an unavailable edit) instead of ever corrupting unrelated text. A no-op on an over-fast double-click is a minor UX cost against a correctness bug — consistent with this codebase's established "PatchError = disable-the-control, never guess" philosophy.
  - **New pure-logic tests**, sandbox-verified (`/tmp/age-of-rms-check`) before being committed: `src/breakdown/__tests__/ephemeralAnchors.rebase.test.ts` (9 cases — no-prior no-op, shift-after-deletion, shift-after-insertion, before-prior no-op, overlap → null, multi-edit chaining, plus 3 for `shiftPointThroughEdits`) and `src/breakdown/__tests__/comments.test.ts` (8 cases — single comment, multiple separate comments, zero-gap adjacent comments — discovered via this testing that the lexer tokenizes a glued `*//*` as one plain word rather than a close+open pair, so two comments with literally no space between them merge into one span; documented as a lexer characteristic, not something this session touched — nested comments, no-comments case, plus 3 for `commentsBetweenItems`'s gap attribution). All 50 tests in `src/breakdown/__tests__/` + `patch.unit.test.ts` still pass together; the Sec.4.8 property gate was re-run against the full 33-file corpus (two batches) and is still green — it wasn't expected to catch this bug in the first place, since it drives `computeEdit` directly rather than through the rebase-guarded `applyEditIntent`, but re-confirming it stayed green after touching adjacent files (`ephemeralAnchors.ts`, `applyEdit.ts`) was cheap insurance.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on every touched/new file; `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green.
  - **Ash, please manually verify**: (a) switching Code -> Breakdown now actually scrolls to the selected card, not just selects it (retest the exact scenario from before — cursor in a different section, and inside an if/random branch); (b) a comment written between two commands (in a section body, and inside an if/else branch) now shows as its own dashed read-only card in the right place; (c) a comment at the very start of a section or right after `if`/before the first branch command does NOT show yet (known v1 scope gap, not a bug — flag if this matters enough to prioritize the boundary case); (d) the original repro — select several cards in the same area and delete them in quick succession (as fast as you can click) — no more truncated/corrupted text anywhere else in the file, even after a dozen-plus rapid deletes; (e) as a related but distinct check, try rapid-fire on OTHER edit types too (quickly editing an attribute value, then immediately deleting a different card, etc.) since the fix is general, not delete-specific.
  - Next: Sec.3.10 diagnostics overview ruler.

- **Sec.3.10 Diagnostics overview ruler — DONE (Sonnet session).** Last of the three post-3.4 Ash-added items; done immediately after the bug-fix session above, in the same sitting.
  - **Split per the spec's own guidance and this codebase's "pure logic first, DOM glue after" convention.** `src/breakdown/rulerTicks.ts` (pure, framework-free): `ticksForItems(items, diagnostics)` returns one `{anchor, severity}` per TOP-LEVEL item that has at least one diagnostic anywhere within its span (via the existing `maxSeverityWithin`, same severity rollup Sec.3.1's card badges already use — error > warning > info). Reading the WHOLE item span (not just its visible/expanded portion) is what makes "ticks for cards inside collapsed containers still appear, positioned at the collapsed container's tick" (Sec.3.10's explicit v1 requirement) fall out for free — no separate expand-state check needed anywhere in this function. `src/breakdown/DiagnosticsRuler.tsx` is the DOM-measuring half: converts each tick's anchor into a screen position via `card.offsetTop / scrollContainer.scrollHeight` (Monaco-ruler-style; source offsets can't work here since cards are variable-height and that height changes at runtime — the spec's own "mapping problem" section, called out as the reason this had to be sequenced last).
  - **Measurement isolated to one component, kept out of the rest of the pane** (per the spec's cost note): `SectionView.tsx` gained a `scrollContainerRef` (on its existing `.view` scroll div, now wrapped in a new `.outer` flex row alongside the ruler) and passes it + `tab.items` into `<DiagnosticsRuler>`. Nothing else in Breakdown touches layout/measurement.
  - **Recompute triggers, per the spec's explicit instruction**: a `useLayoutEffect` (not a regular effect — "measure in a layout effect... do not measure during render") re-measures on `[remeasure, expandedAnchors]`, where `remeasure` itself depends on `[items, diagnostics, containerRef]` (so a fresh parse or diagnostics change re-triggers it) and `expandedAnchors` is a NEW context field added specifically for this (Sec.6.3's expansion Set, exposed raw rather than just via the `isExpanded` predicate) — expand/collapse changes a card's rendered height without changing the AST or diagnostics at all, so it needed its own trigger; `toggleExpanded` already produces a new Set reference every time, so this "just worked" as a dependency once exposed. A separate `ResizeObserver` on the scroll container catches pure pane/window resizes, which change nothing about the AST or expansion state but do change where things land on screen.
  - **Ticks reuse `ItemCard`'s existing `data-anchor` attribute** (added in the cross-tab-sync session) for both measurement (`querySelector` for `offsetTop`) and click-to-jump (`scrollIntoView` + `selectCard`) — no new DOM wiring needed on the card side at all. A tick's `onClick` constructs a single-point `Span` (`{start: anchor, end: anchor + 1}`) since `selectCard` only ever reads `.start`.
  - **Filename collision caught by `tsc`, not guessed at**: `DiagnosticsRuler.tsx` (component) and `diagnosticsRuler.ts` (the originally-named pure module) differ only in casing, which breaks on case-insensitive filesystems (Windows) even though the repo itself is case-sensitive on disk here — `tsc --noEmit` caught it immediately (`TS1149`) rather than it surfacing later as a mysterious Windows-only build failure. Renamed the pure module to `rulerTicks.ts`.
  - New CSS: `DiagnosticsRuler.module.css` — a fixed 10px-wide strip (`flex: 0 0 10px`) along the section pane's right edge, ticks as small rounded bars positioned via inline `top: %` styles, solid severity colors (distinct from the softer badge-background colors in `cards.module.css`, chosen for visibility at tick size: `#dc3545`/`#e0a300`/`#17a2b8`). New `ui-help.json` entry: `breakdown.diagnosticsRuler.tick`.
  - **New pure-logic tests**, sandbox-verified before committing: `src/breakdown/__tests__/rulerTicks.test.ts` (6 cases — no ticks when clean, one tick per item-with-a-diagnostic, max-severity rollup across multiple diagnostics on one item, diagnostics outside an item's span don't attribute to it, a diagnostic nested deep inside a span still ticks the owning top-level item (the collapsed-container case), ticks returned in item order). All 56 tests across `src/breakdown/__tests__/` + `patch.unit.test.ts` pass together in the `/tmp/age-of-rms-check` sandbox.
  - **Verified**: `npx tsc --noEmit` clean (including catching and fixing the filename-casing collision above); `npx eslint` clean on every new/touched file; `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green.
  - **Not covered by automated tests** (consistent with how the cross-tab-sync session was verified): the actual DOM measurement/positioning — `offsetTop`, `ResizeObserver` firing, tick click → scroll+select — is Monaco/DOM integration with no pure core beyond what `rulerTicks.test.ts` already covers. Manual verification needed.
  - **Ash, please manually verify**: (a) a section with at least one error/warning/info diagnostic shows a colored tick on the right edge of the pane, roughly proportional to where that card sits in the scroll — scroll through a long section and confirm ticks stay aligned with their cards; (b) clicking a tick scrolls to and selects the corresponding card, same as the cross-tab-sync scroll behavior; (c) collapse a card that has a diagnostic somewhere inside it (e.g. an attribute value) — its tick still shows; (d) expand/collapse some cards above a ticked card and confirm the tick's vertical position updates to match the new layout (this is the part that can't be verified by tests at all); (e) resize the window/pane and confirm ticks stay correctly positioned; (f) a section with zero diagnostics shows no ruler at all (not an empty strip).
  - This completes CREATION_PLAN's original Phase 3 scope PLUS all three Ash-added post-3.4 items (Sec.3.9, sticky header, Sec.3.10) and the follow-up bug-fix round. No more scheduled Breakdown work — CLAUDE.md's Phase 3 status line updated accordingly.
  - Next: Ash's call — Phase 4 (preview), Phase 4.0 (constants extraction, still pending an earlier stalled decision), or Phase 5 groundwork.

- **Sec.3.10 ruler follow-up round — DONE (Sonnet session, same day).** Ash tried the ruler and reported: one static tick in the same spot on every map and every section tab regardless of how many warnings existed; resizing did nothing to tick position; no way to tell whether the current scroll position was near a problem or not; a clean section showed no ruler at all (wanted it always visible); and diagnostics only ever showed in a CommandCard's header, not at the specific attribute/argument actually causing them.
  - **Root cause of the positioning bugs, found via `tsc`/first-principles rather than guessed at: `SectionView.module.css`'s `.view` (the scroll container passed to `DiagnosticsRuler` as `containerRef`) had no explicit `position`.** `HTMLElement.offsetTop` is relative to the nearest ANCESTOR with a non-static `position` (its `offsetParent`) — not automatically the nearest scrollable ancestor. Without `position: relative` on `.view`, every card's `offsetTop` was being measured against some unrelated ancestor further up the tree (roughly the same across every map/section, since it reflects the app shell's layout, not the section's content) — explaining literally every symptom at once: one static tick near the top everywhere (whatever a card's offsetTop happened to be relative to that wrong ancestor, divided by `.view`'s `scrollHeight`, landed near 0 essentially by coincidence), zero reaction to resize (the wrong ancestor's box doesn't change when the PANE resizes), and no correlation to scroll position (offsetTop relative to the wrong ancestor doesn't reflect "how far down THIS scrollable content" at all). Fix: `position: relative` on `.view` — one line, makes it the actual `offsetParent` for its descendant cards, so `offsetTop` becomes "distance from the top of the full scrollable content," exactly what the ruler math assumes. Documented at length in the CSS itself so the reasoning doesn't get lost.
  - **Viewport ("you are here") indicator, new** — Ash: "no way to tell if the warning is on screen or not." `DiagnosticsRuler.tsx` now tracks a second measurement, `viewport: {topFraction, heightFraction}`, computed from `scrollTop/scrollHeight` and `clientHeight/scrollHeight` and rendered as a translucent blue band on the ruler (`.viewport` in the CSS module) showing exactly which slice of the section is currently visible. Deliberately updated via its OWN scroll-event listener (`remeasureViewport`, separate from `remeasureTicks`) rather than folded into the layout effect — ticks are positions within the full document and don't move when you scroll, only the viewport band does, so re-running the (relatively) more expensive tick measurement on every scroll event would have been pure waste.
  - **Ruler always renders now** — removed the `if (ticks.length === 0) return null` early return Ash didn't want; a clean section still shows the track (now doubling as a pure scroll-position indicator via the viewport band even with zero problems).
  - **Diagnostics now shown at the specific row, not just the card header** — Ash: "it would be good if the warning also showed up at the attribute that actually causes it." `AttributeInstanceRow` (`AttributeRow.tsx`, covers both attribute-slot rows and, via `OtherContentsRow`, unlisted attributes) and `CommandCard`'s positional-argument rows now each independently compute `maxSeverityWithin(diagnostics, node.span)` / `maxSeverityWithin(diagnostics, arg.span)` — the SAME span-containment rollup the card-header `ProblemBadge` already uses (Sec.5's rule: diagnostics come from the parser, Breakdown invents none, just re-scopes to a smaller span) — and apply a colored left-border + tinted background + native `title` tooltip (the diagnostic message text) directly on the row/arg-row `<div>` when it has one. New `.rowSeverity-error/warning/info` CSS classes in both `AttributeRow.module.css` and `CommandCard.module.css` (same solid colors as the ruler's ticks, for visual consistency: `#dc3545`/`#e0a300`/`#17a2b8`). The card-header badge is unchanged (still shows the command's overall max severity) — this is additive, pinpointing WHICH row within an expanded card to look at.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on every touched file; `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green. The positioning fix and viewport/always-render changes are DOM/CSS behavior with no pure-logic surface to unit test (same category as the rest of Sec.3.10's measurement half); the per-row diagnostic highlighting reuses `maxSeverityWithin`/`diagnosticsWithin`, which already have their own test coverage from earlier sessions — no new pure logic was introduced that needed new tests.
  - **Ash, please manually verify**: (a) ticks now spread out across the ruler proportional to where their cards actually sit (test on a map with several diagnostics scattered through a long section); (b) the blue viewport band moves as you scroll and roughly brackets what's currently visible, so you can tell at a glance whether a tick above/below it is off-screen; (c) resizing the window now visibly repositions ticks/viewport band; (d) a completely clean section still shows the ruler track (just no ticks, viewport band still present); (e) expand a command with a diagnostic on one specific attribute (not the whole command) — that ONE row gets a colored left border/tint and a hover tooltip with the message, while sibling rows with no problem stay plain.
  - Next: still nothing scheduled for Breakdown — Ash's call on Phase 4/4.0/5, unless this round surfaces something else.

- **Ruler tick positioning — still wrong after the `position: relative` fix, root-caused properly this time (Sonnet session, same day).** Ash re-tested: viewport band/resize/always-visible/per-row diagnostics all confirmed working, but ticks were STILL not landing at the right position — the `position: relative` fix alone wasn't sufficient.
  - **Real root cause: `offsetTop`/`offsetParent` is fragile in a codebase that wraps almost every interactive element in `HelpTip`, whose own wrapper span is itself `position: relative`** (`HelpTip.module.css`'s `.wrapper` — needed so its hover popup can anchor via `position: absolute; top: 100%`). That doesn't affect a CARD's own `offsetParent` (HelpTip wraps things INSIDE a card, not the card itself), so it wasn't literally the bug — but it's exactly the kind of thing that makes `offsetTop`/`offsetParent`-based measurement fragile and easy to get subtly wrong in this specific codebase, and after re-verifying `position: relative` really was present on `.view` with nothing else positioned in between, `offsetTop` still wasn't the right tool for this job.
  - **Fix: replaced `offsetTop` entirely with `getBoundingClientRect()` differences**, which don't depend on the `offsetParent` ancestor chain at all — `elRect.top - containerRect.top + container.scrollTop` recovers "distance from the top of the full scrollable content" purely from actual rendered viewport-relative boxes, immune to whatever ends up positioned where between the container and a card, now or in any future change. This is the standard robust alternative to `offsetTop` for exactly this kind of measurement, and removes the dependency on `.view` having `position: relative` at all (kept anyway — harmless, semantically correct, doesn't hurt).
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean; `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green. Still no live-browser access to confirm visually — this is a best-effort root-cause fix based on a well-known `offsetTop` footgun, not something provable from static analysis alone.
  - **Ash, please re-verify tick position specifically** — scroll to a warning/error, note roughly what fraction of the way down the section it is, and confirm the tick lands at roughly that same fraction down the ruler. If it's STILL off after this, the next debugging step would need actual DOM inspection (e.g. logging `elRect`/`containerRect`/`scrollHeight` values from the running app) since static code review has now ruled out the two most likely causes.
  - Next: same as above — Phase 4/4.0/5, or another look at the ruler if this still isn't right.

- **Ruler tick positioning — actual root cause found (Sonnet session, same day).** Ash reported the exact same symptom again after the `getBoundingClientRect()` fix ("Still the same issue," twice) — meaning the JS measurement math was never the bug at all. The measured `topFraction` values were most likely correct the whole time.
  - **Real root cause: the positioning bug was in RENDERING, not measurement.** Each tick was `<HelpTip><button className={styles.tick} style={{top: X%}} /></HelpTip>`. `HelpTip` wraps its `children` in its own `<span className={styles.wrapper}>`, and `HelpTip.module.css`'s `.wrapper` is `position: relative` (needed so the hover popup can anchor via `position: absolute; top: 100%` inside it). A `position: absolute` element is positioned relative to its nearest positioned ANCESTOR — for the tick button, that's HelpTip's own wrapper span, NOT `.ruler`. That wrapper span auto-sizes to fit the button (a few px), and nothing positions the wrapper span itself within `.ruler`'s normal document flow — so every tick's wrapper span just stacks in plain block flow near the top of `.ruler`, and the button's `top: X%` resolves against that tiny auto-sized box (collapsing to near-zero) regardless of the JS-computed fraction. This explains every part of the original symptom precisely: "one tick... right next to the top... even when many warnings are present" (all wrapper spans stack together near the top), and why it was completely unaffected by either of the two prior fixes (`position: relative` on `.view`, then switching to `getBoundingClientRect`) — both correctly fixed the *measurement*, which was never broken. It also explains why the viewport band (not wrapped in HelpTip) was independently confirmed working while only the ticks stayed broken.
  - **Fix**: moved the position/top styling OFF the button and onto a new outer `<div className={styles.tickWrapper} style={{top: X%}}>` that is a direct child of `.ruler`'s tick list, with `<HelpTip>` now wrapping only the button INSIDE that already-correctly-positioned wrapper. `DiagnosticsRuler.module.css` gained `.tickWrapper` (`position: absolute; left: 1px; width: 8px; height: 0`, carries the `top: %`) and `.tick` lost `position`/`left`/`top` (now just sized/colored, laid out normally within its wrapper).
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on the touched files. Still no live-browser access — same caveat as the prior two rounds, but this fix targets a different bug category (CSS containing-block/rendering, not JS offset math) than the two attempts Ash already ruled out, and the mechanism lines up exactly with every detail of the reported symptom (constant near-top position, unaffected by resize/scroll/expand, viewport band unaffected).
  - **Ash, please re-verify** — same check as before: scroll to a diagnostic, note its rough fraction down the section, confirm the tick lands at that same fraction down the ruler, and confirm distinct diagnostics at different depths now show as visually distinct tick positions rather than clustering near the top.
  - Next: same as above — Phase 4/4.0/5, or another look at the ruler if this still isn't right.

- **Ruler tick position confirmed fixed; one leftover layout bug — ruler overflowing into the StatusBar (Sonnet session, same day).** Ash confirmed the HelpTip-containing-block fix worked. Only remaining issue: the ruler's bar extended down past the bottom of the Breakdown pane into the StatusBar.
  - **Root cause: `SectionView.module.css`'s `.outer` had `height: 100%` instead of `flex: 1`.** `.outer` is a flex ITEM of `BreakdownPane.module.css`'s `.main` (a column flex container whose other child is `SectionTabs`, above it). `height: 100%` on a flex item in a column container becomes its flex-basis — i.e. it demands 100% of `.main`'s own height, IN ADDITION TO whatever height `SectionTabs` already takes above it, overflowing the combined content past the bottom of `.main`'s box (which has no `overflow: hidden`) and into the `StatusBar` sitting below it in `App.tsx`'s own flex column. Every other level of this tree (`App.module.css`'s `.main`, `BreakdownPane.module.css`'s `.pane`/`.main`) already uses the `flex: 1; min-height: 0` pattern for exactly this reason — `.outer` was the one spot that used `height: 100%` instead when the ruler support was added.
  - **Fix**: `.outer` now uses `flex: 1; min-height: 0`, matching the rest of the tree. `.ruler`'s own `height: 100%` (within `.outer`, a flex ROW) is unaffected/still correct, since `.outer` itself now has a definite height clipped correctly by its own parent.
  - **Verified**: `npx tsc --noEmit` clean (CSS-only change, no ESLint-relevant surface).
  - **This closes out Phase 3 for real** — Sec.3.10 (and every post-3.4 Ash-added item under it: sticky header, Sec.3.9 selection, cross-tab sync, comments-in-Breakdown, rapid-delete-corruption fix, and now three ruler-positioning rounds) is confirmed working end-to-end. `CLAUDE.md`'s Phase 3 status line was already marked done; no further action needed there.
  - Next: Ash's call — Phase 4 (preview), Phase 4.0 (constants extraction, still pending an earlier stalled decision — see task #39), or Phase 5 groundwork.

- **Diagnostic tooltip vs. HelpTip popup overlap — fixed (Sonnet session, same day).** Ash: hovering a row with a diagnostic showed BOTH the diagnostic message and a nested HelpTip popup (e.g. the value editor's or the label's) at once, one partially covering the other, and asked whether the diagnostic tooltip could reposition (above the row when help mode is on, below when off) to avoid the collision, or offered to hear other approaches.
  - **Root cause: the diagnostic message was a native `title` attribute** on `AttributeRow.tsx`'s `AttributeInstanceRow` row div and `CommandCard.tsx`'s per-argument `argRow` div (added in the earlier per-row-highlighting round). Native `title` tooltips are OS/browser-rendered — there's no CSS or JS hook to reposition, delay, or suppress them, so they're free to land wherever the browser puts them (typically right under the cursor), which is exactly where a HelpTip popup opened by something nested in the same row (the label, the value editor) also renders.
  - **Fix, exactly matching Ash's suggested approach**: new `src/components/DiagnosticTooltip.tsx` — a custom-rendered popup (same visual pattern as `HelpTip`'s own popup, colored by severity) plus a `useDiagnosticHover()` hook that tracks hover state on the row itself and decides which side to open on by reading the SAME `useHelpSettings()` mode `HelpTip` reads: `mode === "off"` → open below (nothing to collide with, HelpTip never opens); any other mode → open above (HelpTip's own popup always opens below its trigger, so above never collides with it). Unlike HelpTip, the diagnostic popup is never gated behind the help-mode setting itself — Ash was clear it "should always stay on."
  - **`AttributeRow.tsx`**: `AttributeInstanceRow`'s row div swapped its `title={rowTitle}` for `{...(severity ? diagHover.handlers : {})}` plus a conditionally-rendered `<DiagnosticPopup>` absolutely positioned within the row (`AttributeRow.module.css`'s `.row` gained `position: relative` for this, same reasoning as the ruler's `.view`/`.ruler`).
  - **`CommandCard.tsx`**: the equivalent `argRow` div lived inside an inline `.map()` callback — calling a hook (`useDiagnosticHover`) once per loop iteration there would have broken React's hook-call-order guarantee the moment the argument count changes (which happens live via `AttributeValueEditor`'s commits), so this one row was extracted into its own small `ArgRow` component (a real per-item component instance, called via `.map()` rather than hook-calling inside the callback itself) — everything else about it is unchanged. `CommandCard.module.css`'s `.argRow` gained the same `position: relative`.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on all four touched/new files (`DiagnosticTooltip.tsx`, `AttributeRow.tsx`, `CommandCard.tsx`, plus the two `.module.css` files, which ESLint doesn't lint but were hand-checked). No new pure logic (this is pure DOM/CSS positioning + a straightforward hover hook), so no new unit tests — consistent with how the rest of this tooltip/popup family (HelpTip itself) has always been treated.
  - **Ash, please verify**: hover a row/argument with an active diagnostic while something else in that row (label, value editor) ALSO has help-hover active — confirm the two popups now stack above/below the row instead of overlapping, in both help-mode "hover" and "off" (Preferences dialog) states.
  - Next: same as above — Phase 4/4.0/5.

- **Absent-attribute rows merging onto one line when Help Tips is on — fixed (Sonnet session, same day).** Ash noticed attribute rows sometimes packed multiple-per-line instead of one-per-line, and asked whether this was tied to the Help Tips setting and intentional. It was tied to Help Tips, and it was NOT intentional — a genuine layout bug, not a documented behavior.
  - **Root cause**: `AttributeRow.tsx`'s zero-instance ("click to add") case wrapped the ENTIRE row `<div>` in `<HelpTip>`, unlike every other row variant in this file (which only ever wrap a piece INSIDE a row — `AttributeInstanceRow`'s own code comment already explains why, for an unrelated double-popup reason). `HelpTip`'s wrapper span (`HelpTip.module.css`'s `.wrapper`) is `display: inline-block`. With help mode ON, that put an inline-block box around this otherwise block-level row div; the row's parent (`.group`, `CommandCard.module.css`) has no `display` set at all — ordinary block flow — so consecutive inline-block-wrapped rows behave like inline content (same as wrapping text) and pack onto shared lines wherever they fit. With help mode OFF, `HelpTip` renders a bare fragment (see `HelpTip.tsx`'s `mode === "off"` branch), so the row was a normal block div again and always stacked one-per-line — exactly matching what Ash observed.
  - **Fix**: moved the row `<div>` outside `<HelpTip>`, wrapping only the label `<span>` inside it instead — same shape as every other row variant already uses.
  - **Checked for the same anti-pattern elsewhere**: `ConditionalCard.tsx` and `RandomCard.tsx` each have one more `<HelpTip>` wrapping a block `<div>` directly (`.branchControls`), but both are the LAST child of their card with no wrapped siblings after them — block elements before them still force a line break either way, so this doesn't currently produce a visible symptom. Left alone rather than expanding scope beyond what was reported; worth revisiting if either of those cards ever gets a sibling element added after `.branchControls`.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on the touched file.
  - Next: same as above — Phase 4/4.0/5.

- **A family of HelpTip-wrapping layout bugs, all the same root cause — fixed (Sonnet session, same day).** Ash's follow-up on the row-merging fix above surfaced three more symptoms, all tied to Help Tips on/off: (1) attribute/argument VALUES sat right after the name instead of in an aligned column, and row height changed, whenever help mode was on; (2) the StatusBar's generation-settings cog stuck right after the resource totals instead of sitting at the far right, when help mode was on; (3) a NEW regression from the row-merging fix above — hovering a greyed-out (not-yet-added) attribute now showed a see-through, dimmed help popup.
  - **All three are the exact same mechanism**: some CSS (`min-width` for column alignment, `margin-left: auto` for right-alignment) was set on an element that's a child of `<HelpTip>`. With help mode OFF, `HelpTip` renders a bare fragment (see `HelpTip.tsx`), so that element IS the real flex item and the CSS works. With help mode ON, `HelpTip` wraps it in its own `<span className={styles.wrapper}>` (`display: inline-block`) — NOW THAT WRAPPER is the actual flex item, and CSS set one level too deep (on the element HelpTip wraps, not on the wrapper itself) has no effect on flex sizing/alignment at all. This is the same class of bug as the ruler's tick-position saga and the row-merging bug just above — HelpTip's wrapper silently becomes the thing that matters for layout, and code that doesn't account for it breaks only in one of the two help-mode states.
  - **Fix, applied uniformly**: introduce a small wrapper `<span>` that the app controls (not HelpTip's own), placed OUTSIDE `<HelpTip>`, and move the layout-critical CSS onto THAT wrapper instead of the thing HelpTip wraps. `AttributeRow.module.css`'s `.label` → new `.labelSlot` carries `min-width: 12rem`; `CommandCard.module.css`'s `.argLabel` → new `.argLabelSlot` carries `min-width: 8rem`; `StatusBar.module.css`'s `.settingsCog` → new `.cogSlot` carries `margin-left: auto`. Each of `AttributeRow.tsx`, `CommandCard.tsx` (the `ArgRow` component from the earlier tooltip fix), and `StatusBar.tsx` now wraps its `<HelpTip>` block in the corresponding slot span. This also fully explains — and fixes — the row-height/vertical-spacing symptom Ash noticed: without a reliably-enforced label column, the label and value could be forced to wrap onto two lines within the row when help mode was on, inflating that row's height; restoring the column fixes the wrapping and the height together, not as two separate fixes.
  - **The see-through-popup regression**: caused by this session's earlier absent-row fix, which moved `<HelpTip>` INSIDE `.absentRow` (previously it was outside, wrapping the whole row). `.absentRow` had `opacity: 0.5` for the "not yet added" greyed look — once `HelpTip` (and its popup) became a DESCENDANT of that opacity-reduced row, the popup inherited the dimming too; CSS opacity composites its entire subtree at reduced alpha, and no descendant can locally undo an ancestor's opacity. Fixed by removing `opacity` from `.absentRow` entirely and applying a new `.absentDim` class directly to each visible piece instead (the label text span, the value span, the add button) — all three are siblings of (or don't contain) HelpTip's popup, so the popup itself is never inside anything dimmed.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on all four touched files.
  - **Ash, please verify**: toggle Help Tips on/off in Preferences and confirm attribute/argument rows keep a consistent aligned column and row height in both states; confirm the StatusBar cog stays pinned to the far right in both states; hover an absent (not-yet-added) attribute's label and confirm its help popup is fully opaque, not see-through.
  - Next: same as above — Phase 4/4.0/5.

- **One more instance of the same HelpTip-wrapping bug (Add Command button), plus a residual row-height jitter fix (Sonnet session, same day).** Ash: with Help Tips on, Add Command shrank to button size (black outline, rest of the row plain white) instead of spanning the full row like it does with Help Tips off; also flagged that row spacing "still changes slightly" between the two modes even after the previous round's fixes, and asked about a confusing diagnostic wording ("areaID").
  - **Add Command**: identical root cause to the previous round — `SectionView.module.css`'s `.addButton` had `display: block; width: 100%`, but the button lives inside `<HelpTip>`; that `100%` only had a definite containing block to resolve against when help mode was off (HelpTip renders no wrapper, button IS the flow item). Fixed the same way: new `.addButtonSlot` wraps `<HelpTip>` from outside and carries the block/100% sizing (`SectionView.tsx`/`.module.css`).
  - **Residual row-height jitter**: `HelpTip.module.css`'s `.wrapper` is `display: inline-block` with no `vertical-align` set, which defaults to `baseline` — the classic "small reserved gap under an inline-block for text descenders" quirk. That doesn't move the wrapper's position inside a flex row (`align-items: center` governs that), but it can make the wrapper's OWN computed height a hair taller than the same content with no wrapper at all (help mode off), which is exactly a "row height changes slightly between modes" symptom. Added `vertical-align: middle` to `.wrapper` — a small, low-risk, broadly-applicable fix (affects every HelpTip usage, not just attribute rows) since it only removes unused reserved space, doesn't change HelpTip's actual behavior.
  - **The "areaID" diagnostic wording — investigated, not a bug.** `unresolvedConstantInNumericSlot` (`diagnostics.ts`) substitutes `argDef.name` — the per-ARGUMENT name from `reference/data/language.json`, not the owning attribute/command's own name. For `actor_area`/`actor_area_to_place_in`/`avoid_actor_area` (and others), that argument is named `"areaId"` in the reference data — camelCase is this file's established convention for argument-level names throughout (`civId`, `mapType`, `isNomad`, `resourceDelta`, ...), distinct from RMS's own snake_case attribute/command keywords. So the message is doing exactly what it's designed to do; "areaID" is legitimately the argument's name, not a bug or a stand-in that should say the attribute instead. Left as-is — flagged for Ash rather than changed, since swapping to the attribute name (or adding it alongside) would need `unresolvedConstantInNumericSlot`'s call site in `parser.ts` to also thread through the owning command/attribute's name, which it doesn't currently have, and that's a real design choice, not an obvious bug fix.
  - **Also noted, not fixed**: Ash mentioned a small persistent gap above/left of the sticky Add Command row where the scrolled content peeks through, present in BOTH help modes (so unrelated to this round's bugs) — this is `.view`'s uniform `0.75rem` padding combined with `position: sticky`, which only sticks within the padding box, not into it. Cosmetic, not a regression, left alone pending Ash's call on whether it's worth addressing.
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on the touched files.
  - Next: same as above — Phase 4/4.0/5, or a decision on the sticky-header padding gap / diagnostic wording if Ash wants either addressed.

- **Previous round's Add Command / row-spacing fixes didn't actually work — root-caused properly this time, plus the sticky-header gap (Sonnet session, same day).** Ash: none of the three fixes from the round above landed. Two were flawed reasoning on my part; investigated properly this time instead of patching blind again.
  - **Why the Add Command fix didn't work**: the previous attempt gave `.addButtonSlot` `display: block; width: 100%` and left `.addButton` unchanged. That doesn't help — CSS percentage widths resolve against the element's IMMEDIATE parent only, and `.addButton`'s immediate parent is still HelpTip's own wrapper span, not `.addButtonSlot`. Adding an outer wrapper with its own 100% width does nothing for a percentage two levels further down; that was simply the wrong tool for this specific case (unlike the earlier `min-width`/`margin-left: auto` slot fixes, which DO work that way, because those properties apply to the slot's own box directly rather than needing to reach through it to a Descendant).
  - **Why the row-spacing fix didn't work**: `vertical-align: middle` was added to HelpTip's wrapper on the theory that its default `baseline` alignment was adding a small reserved gap. `vertical-align` only affects inline/table-cell layout — flex items (which `.row`'s children all are) ignore it completely. The change was inert, not wrong-but-insufficient; it plainly could never have had any effect in a flex context.
  - **Real root cause of ALL of it, found this round: `HelpTip` rendered two entirely different DOM shapes depending on the setting** — a real `<span>` wrapper when help mode was on, a bare Fragment (no DOM node at all) when off. Every CSS rule anywhere in the app that assumed "the thing I'm styling is directly what matters for layout" (a flex item's width, a percentage-width child's containing block, a row's natural content height) was implicitly assuming ONE of those two shapes, and broke in whichever mode didn't match. This is the same root pattern behind every HelpTip-related bug this session (the diagnostics ruler's tick containing-block issue was the first instance of it), just now confirmed to be the reason the label-column/cog fixes worked (they set properties — `min-width`, `margin-left: auto` — that act on a box's own size, unaffected by the shape question) while the Add Command and row-height fixes didn't (they needed something that reaches through the wrapper, which the shape divergence broke regardless of which slot pattern was tried).
  - **The actual fix: `HelpTip.tsx` now ALWAYS renders its wrapper `<span>`, in every mode.** Only the popup's presence is still gated by `visible` (which already requires mode to be "hover" post-delay or "alt-hover" while ALT is held — mode "off" still never shows a popup, just via `visible` staying false instead of skipping the wrapper). Every HelpTip usage in the app now has one consistent DOM shape regardless of the Preferences setting — this eliminates the entire bug CLASS at its source rather than requiring a bespoke fix at every affected call site (which is what the last three rounds were doing).
  - **Add Command, fixed properly now that the shape is uniform**: `.addButtonSlot` is `display: flex`, with `.addButtonSlot > * { flex: 1; min-width: 0; }` — this makes whatever HelpTip renders (always the wrapper span now) an actual flex item with `flex: 1`, which DOES give it a genuinely definite width via the flex algorithm (unlike block-level shrink-to-fit sizing, flex-grow isn't subject to the same "child's percentage width against an undetermined parent" circularity) — `.addButton`'s existing `width: 100%` then correctly resolves against that now-definite parent.
  - **The sticky-header gap, removed as asked**: `.view`'s own `padding: 0.75rem` was the cause — `position: sticky` only sticks within the padding BOX's inner edge, so `.view`'s own padding remained visible above/left of the stuck header, with scrolled card content passing behind it in that exposed strip. Moved the equivalent spacing onto `.addWrapper` (`padding: 0.75rem 0.75rem 0`) and a new `.content` wrapper around `BlockList` (`padding: 0 0.75rem 0.75rem`) instead of `.view` itself — `.addWrapper`'s existing opaque white background now extends flush to `.view`'s true top/left edges with nothing exposed behind it, and the visual spacing around the button/cards is unchanged (`SectionView.tsx` now wraps `<BlockList>` in `<div className={styles.content}>`).
  - **Verified**: `npx tsc --noEmit` clean; `npx eslint` clean on `HelpTip.tsx`/`SectionView.tsx`; `node scripts/validate-reference-data.mjs` and `node scripts/check-breakdown-prereqs.mjs` both green (unaffected by this, run as a general sanity check since `HelpTip.tsx` is used everywhere in the app).
  - **Ash, please re-verify all three**: Add Command spans the full row in BOTH help-mode states now; row spacing is now identical between the two states (since the DOM shape no longer differs between them at all); the gap above/left of the sticky Add Command row while scrolling is gone.
  - Next: same as above — Phase 4/4.0/5.

- **Phase 4.0 — constants extraction script written and tested as far as this session could (Sonnet session, same day).** CREATION_PLAN's 4.0 explicitly required investigating and presenting options with licenses before writing any code — did that first.
  - **Investigation finding that reframed the problem**: the RMS constant→ID mapping (`GOLD`, `GRASS`, ...) doesn't need binary `.dat` parsing at all. DE ships a plain-text `random_map.def` (ordinary RMS `#const NAME <id>` syntax) under the install's `resources/_common/` tree, auto-included in every random map script. Only per-object resource amounts and terrain texture filenames actually require parsing `empires2_x2_p1.dat`.
  - **Library comparison for the `.dat` half**: genieutils-py (SiegeEngineers, LGPL-3.0) vs. genie-dat (Node/JS, LGPL-3.0, but last commit 2020 — stale enough to risk silently-wrong output on current DE) vs. genieutils C++ core (lower-level, genieutils-py already wraps it). Presented to Ash with a table; Ash chose genieutils-py, and flagged an important nuance while reviewing: RMS scripts can override an object's resource yield at generation time via `resource_delta`/effect-percent-style commands, so the extracted `resourceAmounts` needs to be documented as the unmodified BASE value, not a live total.
  - **Verified the library's actual API by installing it and reading its source** (`genieutils/unit.py`, `terrainblock.py`, `graphic.py`, `datfile.py`) rather than guessing field names from memory — confirmed `DatFile.parse(path)`, `Unit.resource_storages` (`type`/`amount`/`flag`, standard genie resource-type indices 0=food/1=wood/2=stone/3=gold), `Terrain.slp` cross-referenced against `Graphic.file_name` for texture filenames, and Civ index 0 (Gaia) as the canonical roster for map-object stats.
  - **No local DE install was available to test the `.dat`-parsing half against** — confirmed directly with Ash after an initial filesystem probe found a misleadingly-named empty Steam folder. Handled honestly rather than faked: `tools/extract-constants/README.md` has a "Testing status" section spelling out exactly what is and isn't verified, `extract_constants.py` searches recursively for `random_map.def`/`empires2_x2_p1.dat` instead of hardcoding an unconfirmed path, and prints a sanity-check table (GOLD/STONE/FORAGE/SHEEP) for whoever runs it for real to eyeball before trusting the resource-type index.
  - **What IS tested**: everything independently verifiable without genieutils or a real install — the `random_map.def` text parser (comment-stripping, `#const` extraction, redefinition-wins-last) and the JSON merge/formatting logic, including a byte-identical round-trip regression test against the real, current `reference/data/game-constants.json` (caught a real bug during writing: `json.dumps`'s default `ensure_ascii=True` was escaping the file's literal em dashes to `—`; fixed with `ensure_ascii=False`). `python -m unittest test_extract_constants.py -v` — 16/16 passing.
  - **Schema/CLAUDE.md updates**: `game-constants.schema.json`'s `resourceAmounts` description now states the base-value caveat explicitly; new Tracked Debt entry noting `resourceTotals.ts` doesn't model `resource_delta`/effect modifiers on top of that base value (a real gap for scripts that use them, deliberately not fixed in this session — it needs its own design pass on correlating a delta command back to the `create_object` instances it targets).
  - **`npm run validate:reference`**: still green after the schema description edit.
  - **Ash, next real step**: run `tools/extract-constants/extract_constants.py` against an actual DE install (yours or another machine's), eyeball the GOLD/STONE/FORAGE/SHEEP sanity-check table it prints, then PR the resulting `game-constants.json` diff. Until that happens, Phase 4.1 (preview heuristics spec) still can't rely on real terrain/object IDs.
  - Next: Phase 4.0's real-data run (above), or Phase 4.1 (preview heuristics spec, Fable/Opus) if Ash wants to start the design work in parallel with placeholder data.

- **known-issues.md audit — stale-entry cleanup (no code changes).** Ash asked whether entries in `docs/known-issues.md` had been resolved. Audited both against source rather than against other docs:
  - **BUG-001 confirmed fixed, entry retired.** Both prescribed parts are live: Part A's queued shift (`pendingAnchorShiftsRef` + the `source`-keyed resolve effect, `BreakdownPane.tsx:136-206`) and Part B's `reparseNow` (`useParsedDocument.ts:123`, called at `BreakdownPane.tsx:167`), plus the queue-ordering test the entry asked for (`ephemeralAnchors.queue.test.ts`). The fix write-up already lives in this log ("3.4 follow-up #3"), so per the file's own convention the entry was deleted rather than marked fixed in place.
  - **BUG-002 (a) retired the same way** — the `#const` `value` slot is `otherConstant` in `language.json` (confirmed at the retyping's own `notes` field) and the campaign is logged above. The entry is now two causes, relettered (a)/(b), with a one-line pointer to the log for the closed third.
  - **BUG-002's remaining two confirmed still open**, not assumed: `actor_area`/`actor_area_to_place_in`/`avoid_actor_area` are all still `"type": "integer"` (`language.json:1755-1805`) and no `identifier` type exists anywhere in the file; `$` appears nowhere in `src/parser/**` outside unrelated regex end-anchors. Corpus baseline in the entry (61 warnings + 45 info) left as-is — not re-measured this session.
  - CLAUDE.md's Phase 3 row reworded so its BUG-001 reference doesn't dangle now that the entry is gone.

- **`preview-design.md` rev 4 — third critique folded in (design only, no code).** A reviewer critiqued rev 3; treated as input, not instruction, and verified every claim against source before acting. Six blockers, one substantive engine-semantics error, and a stale prerequisite that had inverted one of the doc's own headline traps.
  - **Verified first, then acted.** `repeatable` flags now exist in `language.json` (4 attributes) — rev 3's mandated hardcoded fallback list was stale AND violated CLAUDE.md's data-driven-vocabulary rule, so it's withdrawn; `avoid_actor_area` is genuinely missing the flag (repeatable per guide:2857, used in all 32 corpus maps) and became a Sec.12 data request. `predefinedLabels` still absent (`grep -c` → 0) and was missing from Sec.12 entirely — the exact trap Sec.3.10 was written to catch. `parserWorker.ts` confirmed to use `requestId` with no cancellation, so rev 3's "mirrors the parser worker" claim is withdrawn.
  - **The substantive engine error: grouping scope.** Rev 3 pinned a blanket "tight groups → center, loose groups → member" and called the guide self-contradictory. Read the per-attribute entries: five state an unconditional rule the blanket policy overrode (`min`/`max_distance_to_players`, `max_distance_to_other_zones`, `min_distance_to_map_edge`, `min`/`temp_min_distance_group_placement` are center-always; `avoid_forest_zone`/`avoid_cliff_zone` are member-always). The real contradiction is only between those entries and the tight/loose notes' *illustrative* lists. Replaced with a per-attribute table; the heuristic now covers only the actor-area attributes, where the guide is genuinely silent. Corpus reach: 32/32, 30/33, 26/33 maps.
  - **Blockers fixed**: API takes `PreviewSettings { playerCount, mapSize }` not `{ playerCount, dim }` (labels and dims are independent, and `dim` isn't a stable input since S0 mutates it); worker protocol rebuilt around terminate-and-respawn (a `checkCancelled` function can't cross `postMessage`, and a synchronous generator can't receive a cancel message anyway) with a discriminated-union response; `FailureBucket` union completed (two buckets were emitted by stages but absent from the union, so Sec.13's per-bucket test gate could never have covered them) and given disjoint domains; `StageSnapshot`/`SimulationNote`/`StageId`/`Span` defined, with `SimulationNote` gaining the `key`/`prominence` pair its three described behaviours needed.
  - **Where I disagreed**: the critique called the v1 team handling "three different fallbacks with three different lies". It isn't — the three behaviours all follow from one premise (every player is a solo team), and its suggested alternative ("all players one team") would make `grouped_by_team` cluster all eight players together. What was actually missing is that the premise was never *named*, and that a Team Islands script rendered this way looks right and isn't. Fixed by naming it once in Sec.3.1, promoting the note to an on-canvas banner, and making the teams control the top Sec.15 item.
  - **Also**: scaling formula vs its own fixture resolved (exact `dim²/10000` is authoritative per guide:3432; test asserts 829, not the guide's rounded 840); `border_fuzziness` remodelled as depth-decaying so borders fuzz instead of dissolving; `circle_radius 0` disables rather than stacking players at map center, variance defaults to 0 when the argument is omitted; `clumping_factor` given four regimes (it is not monotonic past 40); zone numbering fixed to `playerNumber − 10`, `playerNumber ∈ [1,N]`; `create_actor_area` coordinates are tiles not percent; `land_id` disables `set_place_for_every_player`; goal 5's byte-for-byte determinism made achievable by banning `Math.sin`/`cos`/`pow`/`sqrt` from the generator; Sec.11 now specifies the data structures the 40 ms depends on; `<PLAYER_SETUP>` added to the section order; `test-maps/broken/` dropped from the corpus gate (it doesn't exist); HelpTip ids enumerated, incl. the note that `breakdown.sidePanel.previewToggle`'s "arrives in Phase 4" copy is 4.2's to update.
  - Full item-by-item changelog in the doc's Appendix C.
  - **No code changed, nothing to run.** The two `language.json` items (Sec.12 items 1 and 2 — `predefinedLabels`, `repeatable` on `avoid_actor_area`) are one-file edits that unblock both the preview and `validate()`; worth landing before 4.3 starts.

- **`language.json`: `predefinedLabels` landed + `avoid_actor_area` flagged repeatable.** The two data prerequisites `preview-design.md` rev 4 named in its Sec.12. Both also close `validate()` blockers, which is why they were worth doing before any preview code.
  - **`predefinedLabels` — 138 entries** under a new top-level key, transcribed from the guide's Conditionals section (lines 3047-3199) and Map Sizes table (line 3437). Not a flat string array: each entry carries a `category` (`gameMode`, `mapSize`, `startingResources`, `startingAge`, `lobbySetting`, `playerCount`, `teamCount`, `teamSize`, `playerInTeam`, `gameVersion`), which is the thing the preview's Stage 0 switches on to decide whether a label is true for the current generation settings. A flat list would have satisfied `validate()`'s unknown-constant check and left the preview to re-derive the categorisation in code.
  - **Map-size labels carry `dimensions` and, where the app offers that size, the matching `MAP_SIZES` value.** This is the point of the whole exercise: preview-design Sec.4 flags the legacy/modern name offset (`LARGE_MAP` and `MAPSIZE_NORMAL` are both 200x200, `MAPSIZE_LARGE` is the next size up) as a hazard that produces silently wrong branch selection on every size-aware map. As data, no consumer can get it wrong by inferring from the name. Deliberately **not** stored: the guide's rounded area-ratio column — preview-design rev 4 pins scaling to exact `dim` squared over 10000, and storing 2.1 alongside would reintroduce the 840-vs-829 contradiction that rev fixed.
  - **Faithful transcription over tidy-looking data.** The guide's team-size enumeration is irregular (`TEAM1_SIZE1` and several others are simply absent). Transcribed as written, with the gap recorded in each entry's `notes` rather than filled in by inference; if a real script uses a missing name, it needs an in-game check, not a guess.
  - **Schema**: new `$defs/predefinedLabel`, `predefinedLabels` added to `properties` and `required`. The `name` pattern admits a leading digit (`4_PLAYER_GAME`, `2_TEAM_GAME` are real labels — parser-design Sec.13 called this out).
  - **`avoid_actor_area` gained `repeatable: true`**, taking the flag from four attributes to five. It is cumulative in-engine (the guide says "the same object can avoid multiple actor areas" and its own example stacks six) and appears in all 32 corpus maps. Without the flag the preview would apply last-wins and silently drop every avoidance but the last, and `validate()` would emit a false "the engine uses the last one" note on correct scripts.
  - **Edited programmatically** after confirming `json.dumps(..., indent=2, ensure_ascii=False)` round-trips the file byte-identically, so the 57 KB of existing content kept its formatting and its 77 em dashes. Same `ensure_ascii` trap the extract-constants session hit.
  - **Docs re-synced rather than left to drift**: `preview-design.md` Sec.3.1/Sec.12 (requests marked landed, `?? []` guard kept as a regression backstop), `parser-design.md` Sec.8 + Sec.13 items 3/4 (also corrected Sec.8's imprecise "connection radius attributes" phrasing to `terrain_size`, which breakdown-design Sec.0.1 had asked for), `breakdown-design.md` Sec.0.1's prerequisite table, and CLAUDE.md's tracked-debt entry. `scripts/check-breakdown-prereqs.mjs` updated to expect 5 repeatable attributes and given a new `predefinedLabels` row, since its whole purpose is catching exactly this kind of drift.
  - **Verified**: `npm run validate:reference` green, `npm run typecheck` clean, `npm test` 277/277 passing, `npm run check:breakdown-prereqs` reports no drift. `npm run lint` unchanged at 8 pre-existing warnings, 0 errors (no TS touched).
  - Next: 4.2 (canvas renderer against a hardcoded fixture) or 4.3 (generator) can now start without a data blocker. `validate()` also has no blocking prerequisite left.

- **Phase 4.0 — first real-install run, two bugs found and fixed (Sonnet session, same day).** Ash ran `extract_constants.py` against his actual DE install and asked whether it had also picked up "the pre-defined DE labels" — that question led to auditing the actual diff rather than trusting the script's own success output, which surfaced two real bugs.
  - **The labels question, answered**: `parse_random_map_def` parses every `#const NAME <id>` in `random_map.def` into memory — likely hundreds of names (map sizes, zones, connection types, ...), not just terrain/object ones — but `main()` only persists the ~29 names already present in `game-constants.json`'s curated list; everything else parsed is discarded, nothing was changed there. Confirmed unrelated to `predefinedLabels` (landed two entries up in this log) — that's sourced from the Zetnus guide's Conditionals/Map-Sizes sections, not from `#const` at all, so this run couldn't have touched it either way.
  - **Bug 1 (the one that actually mattered): the `.dat` half silently didn't run.** Diffing the real output against the pre-run file showed `resourceAmounts`/`deTextureFile` byte-identical to the old placeholders on every entry, yet `verified` had flipped to `true` — a false claim the schema's own docstring explicitly warns against. Asked Ash what the console printed rather than guessing; it was `'NoneType' object has no attribute 'id'` from `empires2_x2_p1.dat`.
  - **Root cause**: `Civ.units` (`genieutils/civ.py`) is `list[Unit | None]` — a sparse, pointer-based array over the whole unit-ID space, same shape as `DatFile.graphics` (which the script already handled correctly). `_build_unit_lookup` read `u.id` on every slot unconditionally and crashed on the first unused one. `DatExtraction.__init__` catches exceptions from this path (`main()`'s `try/except` around `DatExtraction(...)`), which is why the script "succeeded" — constId still got written — while quietly never attempting the `.dat` half at all.
  - **Fix**: `_build_unit_lookup` → `build_unit_lookup(units)`, filtering `None` before reading `.id`, same pattern as the graphics lookup. Pulled both lookups out into pure top-level functions (`build_slp_lookup`, `build_unit_lookup`) that take plain lists rather than reading `self.dat` — makes them unit-testable with stand-in dataclasses, no genieutils import needed. Added regression tests for the exact crash shape (`None` slots interleaved with real entries) for both.
  - **Bug 2 (found while fixing Bug 1): `merge_entry` set `verified: true` unconditionally whenever `constId` resolved, even when `dat is None`.** That's how the false claim above got written even on the crash path — constId really was confirmed, but resourceAmounts/deTextureFile were just carried through unchanged from old hand-written placeholders, and the entry said "verified" anyway. Fixed: when `dat is None`, `verified` is left untouched (whatever the entry already had) rather than forced to `true`, and the notes say explicitly that resourceAmounts/deTextureFile were NOT re-checked this run, quoting the prior notes rather than discarding them. `verified: true` is now only set on the branch that actually attempted the `.dat` lookups.
  - **Test suite grew from 16 to 22**: `TestBuildSlpLookup`/`TestBuildUnitLookup` (the None-filtering regression, both libraries' sparse-array shape) plus `TestMergeEntry` split into three cases covering all three states a re-run can land in (`dat=None` on a previously-unverified entry stays unverified with an explicit "not re-verified" note; `dat=None` on a previously-verified entry doesn't get silently downgraded; a full run with `dat` present does set `verified: true`). All 22 passing.
  - **Not yet done**: Ash hasn't re-run since the fix, so `game-constants.json` in the working tree still has the Bug-2 symptom (`constId` real, `verified: true`, `resourceAmounts` still placeholder) — a clean re-run will regenerate it correctly. `random_map.def` parsing and path-finding were never in question (constId values resolved correctly the whole time); only the `.dat` half was broken.
  - Next: Ash re-runs `extract_constants.py` against the same install now that both bugs are fixed; check the GOLD/STONE/FORAGE/SHEEP sanity table for plausible real numbers before committing the diff.

- **`preview-design.md` rev 5 — fourth critique folded in (design only, no code or data).** Verified each finding against source first. All 17 held up; the biggest was a genuine hole rather than a wrong detail.
  - **The hole: `set_gaia_object_only` appeared nowhere in rev 4.** The guide is unambiguous — it "must be used when placing player's gold/stone/berries/deer/boar" under `set_place_for_every_player`, and objects that cannot be player-owned "also require" it. 32 of the 33 corpus files use it. Rev 4's reference-frame logic would have drawn per-player gold, boar and berries for any script that forgot the attribute — objects the engine places nowhere. Now a pinned rule (zero placements), a new `gaiaOnlyRequired` bucket, a `playerOwnable` data request, and a flagged `validate()` hook, since a static check catches it without generating anything. It is one of the most common beginner mistakes in RMS, so surfacing it beats any layout detail on the page.
  - **The failure mode the critique diagnosed structurally, and it was right.** Rev 4 withdrew Sec.3.10's `avoid_actor_area` workaround in its appendix but left the superseded paragraph standing in the body, where an implementer reads it first. Deleted — and the general fix applied: the rev-2/3/4 changelogs moved out of the spec into this log (archived below), leaving only the current round. A do-not-deviate spec should not spend a fifth of its length litigating its own history.
  - **Cancellation reversed.** Rev 4 replaced an unsendable `checkCancelled` callback with terminate-and-respawn and argued the cost was "paid rarely at a ~300 ms debounce". Backwards: cancellation fires only when a request arrives mid-flight, i.e. during continuous typing, so the respawn cost lands exactly in the regime claimed rare — and it was the one unquantified number in a document that quantifies everything. v1 now does what the parser already does: one long-lived worker, stale responses discarded by id (`useParsedDocument.ts:95`), a superseded run wasting ≤40 ms of worker time and nothing else, plus a 1000 ms watchdog for the pathological tail. The "mirrors the parser worker" claim, withdrawn in rev 4, is restored and this time accurate.
  - **Two self-contradictions closed.** Sec.6.1 specified `border_fuzziness` as a power while Sec.8 banned `Math.pow` two sections later (restated as one Bernoulli roll per tile of depth — same distribution, and the loop is now the normative form). Sec.6.2/6.4's default budgets were back-derived from the guide's rounded area-ratio column, which Sec.4 spends a paragraph banning on determinism grounds (rebased on `dim` squared over 14400).
  - **A correction one level down from rev 4's headline fix.** Rev 4 replaced the land `clumping_factor` model with a four-regime table because the engine's behaviour is not monotonic, then left terrains pointing at that same table. Terrains have their own default (20 vs 8), their own useful range (0-25 vs 0-40) and no directional regime at all. Own table now.
  - **`Span` was documented as the wrong thing** — called a token-index span when the parser derives it as character offsets (`types.ts:78`); click-through built on that comment lands nowhere. `types.ts` now re-exports the parser's type instead of declaring a structural look-alike, since the duplicate is what let the comment drift.
  - **Also**: `refDb` reconciled with the worker message (the worker imports the JSON, as `parserWorker.ts` does — shipping it per request would clone 111 KB per keystroke burst); `enable_tile_shuffling`'s honesty note moved to the attribute's *absence*, where the engine is deterministic and our always-shuffle scatters the herdables-under-the-town-center idiom; actor-area ids pinned as sets, not single areas; border percent-to-tile rounding pinned as asymmetric with the guide's worked example, marked verify; `game-constants.json`'s 31-entry stub confronted with a stated rule for unknown named constants and an explicitly narrowed corpus gate until Phase 4.0 runs for real; `terrain_size`'s argument names added as a data request (the data says width/spacing, the guide says Radius/Variance — also a live wrong label in Breakdown and hover today).
  - **Citation pass.** Rev 4's guide line numbers were systematically 1-3 low, and `actor_area_radius` was off by 29 (it pointed at `find_closest`). Every one re-grepped against the text it quotes and corrected; a spec whose authority rests on sourcing cannot have an unverifiable citation layer. The `percent_chance` framing was softened too — the two guide statements are not actually contradictory, so rev 4's "resolves a conflict" oversold it, and the in-game verify slot it consumed was reassigned.
  - **Two findings declined, both re-checked before declining**: frameless `min_distance_to_players` (the guide says only *maximum* is inert without a frame — the literal reading stands) and the grouping-scope table overriding the tight/loose notes (those notes say "most constraints (ex. ...)" while the per-attribute entries state their rules unconditionally). The critique had already flagged both as defensible.
  - **Nothing to run** — markdown only. Also corrected CLAUDE.md's repo map, which claimed the corpus was "13 tracked" (it is 32 plus `sample.rms`, with 19 more in the gitignored `local/`).
  - Next: 4.2 or 4.3. No data prerequisite blocks either; the `game-constants.json` re-run still gates anything that asserts *what* gets placed.


---

# Archived design-doc changelogs

Moved out of `docs/preview-design.md` at rev 5. The spec carries a do-not-deviate banner, and superseded "rev 3 wrote X" narration competes with the normative text for an implementer's attention — rev 4 proved the risk by leaving a withdrawn decision standing in its Sec.3.10 while the correction lived in an appendix. Kept here because the reasoning behind each fix is still worth being able to find.

## preview-design.md rev 2 changelog (moved from the spec, rev 5)

From the first critique: **map-size label table corrected** — legacy and modern names are offset one size (`LARGE_MAP` ↔ `MAPSIZE_NORMAL` at 200×200, `HUGE_MAP` ↔ `MAPSIZE_LARGE`, `GIGANTIC_MAP` ↔ `MAPSIZE_HUGE`, Giant has no legacy label); Sec.4 gained label columns and the Ludicrous override row, Sec.3.1's mismatched example replaced, regression fixture added — the rev-1 example would have silently mis-selected branches on every size-aware map. **Implicit terrain-separation added to Sec.6.6** (default-on reachability from the reference origin over non-restricted terrain, roads exempt, `ignore_terrain_restrictions` bypasses — distinct from opt-in `require_path`; rev 1 would have scattered player resources across islands on water maps), fixtured. **`repeatable`-flag prerequisite pinned in Sec.3.10** (data doesn't exist in language.json yet; hardcoded fallback list until it does — the breakdown-design Sec.0.1 trap). Scaling-attribute exclusivity pinned last-wins (Sec.6.6); snapshots copy renderable layers only, memory math corrected (Sec.5); cliffs avoid slopes (Sec.6.3); `circle_radius` units (% of map width) and final-radius-wins pinned (Sec.6.1); frame-requiring object attributes enumerated as inert for gaia scatter, `require_path` first-member-only, `force_placement` disabled under loose grouping, bare `avoid_forest_zone`/`avoid_cliff_zone` default 1, tight-center/loose-member grouping scope recorded as a deliberate resolution of a guide self-contradiction (Sec.6.6); erased engine placement biases (west bias et al.) added to Sec.9's list; corpus matrix aligned to 5.2's 2/4/6/8; Sec.15 gained the default-tile-budget scaling verify item and the Current-toggle decision item.

## preview-design.md rev 3 changelog (moved from the spec, rev 5)

From the second critique — three substantive fixes: **tight-group overflow corrected** (guide: "a perfect square worth of objects will be filled" — capped partial fill reporting `groupPartial`, NOT all-or-nothing; `occupancyFull` narrowed to the zero-tiles case, preserving 5.2 bucket identity); **`circle_radius` border regimes split** (default circle shifts with borders; explicit `circle_radius` ignores borders for origin placement while growth stays constrained — rev 2 merged the two and misplaced player rings on bordered maps with explicit radii); **frameless `min_distance_to_players` pinned** (guide says only *maximum* is inert without a frame — min now applies against every player-land origin, the common neutral-resource idiom rev 2 left unspecified under a do-not-deviate banner). Nits: `percent_chance` model pinned to roll 1–100 with the 100th percent never chosen (exactly-100 totals leave a 1% no-branch chance) and the first-branch-0 engine bug added to Sec.9's exclusions (item 16); `group_variance` asymmetry (`[n−v, n+v−1]`, floor 1); Sec.6.4's cliff spacing re-labeled a pinned approximation (it derives from unsimulated terrain-16, not guide text); cliff spacing defaults (2/2) stated; negative `border_fuzziness` clamps to 100; `base_elevation` skipped for water-terrain lands.

## preview-design.md rev 4 changelog (moved from the spec, rev 5)

From the third critique. Verified against the sources before acting: the `repeatable` flags, `predefinedLabels`' absence, `parserWorker.ts`'s protocol, `MAP_SIZES`' ordering, `ui-help.json:268`, corpus attribute counts, and every guide line cited below.

**Blockers that would have stopped 4.2/4.3 (six):**

1. **API takes `mapSize`, not `dim`** (Sec.4, Sec.10). Rev 3's `GenerationSettings { playerCount, dim }` threw away the only input Sec.3.1 could build a label environment from — dims and labels are independent (`override_map_size 200` on a Tiny lobby), and `dim` isn't even stable since Sec.3.8 mutates it. Renamed `PreviewSettings` to avoid colliding with `GenerationSettingsContext`'s concept; `dim` derived internally.
2. **Worker protocol rebuilt** (Sec.10). `checkCancelled?: () => boolean` inside a structured-cloned message throws `DataCloneError`; a synchronous `generatePreview` can never receive a cancel message anyway; and the response type had no representation for a cancelled run. Now: plain-data `PreviewOptions`, a discriminated-union response, **terminate-and-respawn** cancellation owned by the host (with SAB and async-pipeline alternatives written down and deferred), and an internal `shouldStop` hook so the SAB upgrade is a swap. The "mirrors the parser worker" claim is withdrawn — `parserWorker.ts` uses `requestId` and has no cancellation.
3. **Sec.3.10's hardcoded fallback list withdrawn.** The `repeatable` flags landed (`spacing_to_specific_terrain`, `replace_terrain`, `terrain_cost`, `terrain_size` — that last is what rev 3 called "connection radius attrs", a category rather than a name). Read the flag from the data, per CLAUDE.md's hard rule. The one genuinely-missing flag, `avoid_actor_area`, becomes a data request (Sec.12 item 2), not a vocabulary fork.
4. **`predefinedLabels` added to Sec.12** as item 1, with the preview and `validate()` pinned to the same array — the exact trap Sec.3.10 was written to catch, and rev 3 walked into it.
5. **`FailureBucket` union completed** (Sec.7): `playerOriginAvoidance` added, rev 3's phantom `budgetShortfall` replaced by `growthShortfall` (Sec.6.4) and a new `iterationCapped` (Sec.11), and `growthShortfall` vs `borderBlocked`/`zoneAvoidanceBlocked` given disjoint domains (region-level vs single-placement) so bucket identity stays stable.
6. **`StageSnapshot`, `SimulationNote`, `StageId`, `Span` defined** (Sec.10) — 4.2's hardcoded fixture referenced four types that existed only as field names. `SimulationNote` gained the `key`/`prominence` pair that rev 3's three different note behaviours needed and never specified.

**Engine semantics:**

7. **Grouping scope is per-attribute, not a blanket tight/loose rule** (Sec.6.6) — the substantive correction. Five attributes state an unconditional rule that rev 3's policy overrode: `min`/`max_distance_to_players` (guide:2431), `max_distance_to_other_zones` (2529), `min_distance_to_map_edge` (2599), `min`/`temp_min_distance_group_placement` (2614/2635) are **center, always**; `avoid_forest_zone` (2570) and `avoid_cliff_zone` (2585) are **member, always**. The tight/loose heuristic now applies only to the actor-area attributes, where the guide's illustrative lists (2122/2143) are the only source. Corpus reach: `avoid_forest_zone` 32/32 maps, `min_distance_to_players` 30, `set_loose_grouping` 26.
8. **Scaling formula vs its own fixture resolved** (Sec.4, Sec.13): exact `dim²/10000` is authoritative (guide:3432 — `override_map_size` scaling "will use the new map area"), the guide's 2-significant-figure ratio column is display, and the test now asserts 829, not 840. Rounding added to the verify list.
9. **`border_fuzziness` remodelled** (Sec.6.1): acceptance `((100−f)/100)^d` at depth `d` past the border instead of a depth-independent Bernoulli, which at the default 20 accepted 80% of each successive ring and dissolved borders rather than fuzzing them. Endpoints unchanged. 19 corpus maps.
10. **`circle_radius` details** (Sec.6.1): `0` disables it (guide:844) rather than stacking players at map center; the Variance argument defaults to **0** (guide:847) — the 20 belongs only to the no-`circle_radius` branch, where the guide estimates the engine's implicit jitter. Live on corpus maps writing a bare `circle_radius 38`.
11. **`clumping_factor` is not monotonic** (Sec.6.1): four regimes per guide:927 (negative snakey / 0–10 irregular / 11–40 rounder / 40+ directional), replacing a weight that got rounder forever and mis-drew high-factor lands as circles.
12. **`terrain_size` defaults stated** (Sec.6.5): radius 1, variance 0 when absent (guide:1958/1960), and radius 0 still paints a single-tile path (guide:1963) — the difference between a 1-tile and 3-tile default connection, on 2 of the 12 connection-using corpus maps.
13. **`create_actor_area` coordinates are tiles, not percent** (Sec.6.6, guide:1994, stated there in capitals), Radius is a square radius, and `actor_area_radius` defaults to 1 (guide:2780).
14. **Zone numbering** (Sec.6.1): `playerNumber − 10` with `playerNumber ∈ [1,N]`, so player 1 is −9 (guide:1038/1074). Rev 3's "land `i` → zone `i − 10`" collided player 1 with `create_land`'s shared −10 under any 0-based reading.
15. **`land_id` disables `set_place_for_every_player`** (Sec.6.6, guide:1146/2264) — the "fake player lands" idiom; placing objects there anyway would be a confident lie.

**Design and budget:**

16. **One attribution algorithm** (Sec.7): successive intersection in a fixed documented order. Rev 3's normative leave-one-out and its "cheap implementation" were different algorithms that disagree on overlapping predicates.
17. **Sec.11 now specifies the data structures the 40 ms depends on** — bucketed O(1) frontier sampling, `Int32Array` candidate lists filtered in place (which is also what the attribution rule needs, so it costs nothing extra), per-stage caches for reachability masks and distance transforms — and says plainly that the benchmark, not the target, gates merges. Sec.13's corpus matrix is costed (~384 generations, ~15 s) with a stated fallback.
18. **Determinism made real** (goal 5, Sec.8): no `Math.sin`/`cos`/`pow`/`sqrt`/`**` in the generator — fixed-point sine table, integer weight buckets, squared-distance comparisons. Rev 3 claimed byte-for-byte cross-engine determinism while placing origins with `sin`/`cos` and weighting with a fractional exponent.
19. **Teams: one premise, stated once, banner-noted** (Sec.3.1). Here we disagreed with the critique's framing — rev 3's three fallbacks *are* one coherent policy (every player a solo team), not three different lies, and swapping to "all players one team" would make `grouped_by_team` cluster all eight players together, which is worse. What was actually missing is that the premise was never named, and that on a Team Islands script the honest-looking output is badly wrong. Fixed by naming the premise, making the note a banner, and promoting the teams control to the top Sec.15 item.
20. **`<PLAYER_SETUP>` added** to the canonical section order (Sec.3.11, guide:135) with an explicit statement that S0 folds it into stream state rather than running it as a stage — Sec.6.1 was reading `direct_placement`/`behavior_version`/`override_map_size` from a section the pipeline never mentioned. Sec.3.12 also pins S0 collection of `create_object_group` names and `create_actor_area` records.
21. **`test-maps/broken/` dropped from the corpus gate** (Sec.13) — it doesn't exist (CLAUDE.md tracked debt, BCC2 triage open).
22. **HelpTip ids enumerated** (Sec.5), plus the note that `breakdown.sidePanel.previewToggle` already exists and its "Preview logic arrives in Phase 4" copy is 4.2's to update.

**Minor:** `create_terrain` eligibility is `base_terrain` **or** `base_layer` (guide:1603), not both; cliff walk described as `len` segments plus a starting stub so it agrees with `3·(len+1)`, plus `min_length < 3` → no cliffs and `min > max` → engine crash as validate() hooks; `find_closest`'s Euclidean-vs-square metric mismatch called out (guide:2652); `percent_chance` reframed as resolving a guide conflict rather than transcribing one, with a verify item; scaling last-wins upgraded from "pinned" to sourced (guide:167); `require_path`'s wall clause noted as inert given Sec.9's wall exclusion; PLAN.md:54's S1/S2 ambiguity folded into Sec.15 item 8; Sec.4 notes the MORE_MAP_SIZES label tier that `predefinedLabels` must carry even though no `MapSize` selects it.

## preview-design.md rev 5 changelog (moved from the spec, rev 6)

From the fourth critique. Verified before acting: `set_gaia_object_only`'s guide entry and its 32/33 corpus usage, `avoid_actor_area`'s landed `repeatable` flag, `Span` in `src/parser/types.ts:27` and its derivation comment at :78, the stale-response guard at `useParsedDocument.ts:95`, the terrain `clumping_factor` entry, `terrain_size`'s argument names in `language.json`, `game-constants.json`'s 31 entries, and every corrected line number below.

**Blocking:**

1. **`set_gaia_object_only` added to Sec.6.6** — the largest gap in rev 4, which did not mention the attribute at all. A frame-referenced `create_object` naming a non-ownable object without it places **nothing** (guide:2354, guide:2262); new `gaiaOnlyRequired` bucket, new `playerOwnable` data request (Sec.12 item 3), flagged as a `validate()` hook. 32 of 33 corpus files use the attribute, so rev 4 would have drawn per-player gold and boar on every script that forgot it.
2. **Sec.3.10's stale paragraph deleted.** It still described `avoid_actor_area`'s missing flag as an open gap and prescribed last-wins, contradicting Sec.12 item 2's LANDED. An implementer reads Sec.3 before Sec.12. This is why Appendices A/B moved out (see the header).
3. **`Span` corrected and de-duplicated.** It is **character offsets**, not token indices — `types.ts:78` derives it from `tokens[first].start .. tokens[last].end`, and token indices live on `NodeBase.firstToken`/`lastToken`. `types.ts` now re-exports the parser's `Span` instead of declaring a look-alike; the duplicate is what let the comment drift.
4. **`refDb` reconciled with the worker protocol** — the worker imports the JSON itself, as `parserWorker.ts:7-8` does. Rev 4's function signature took it while `PreviewRequest` had no field for it.
5. **Terrain `clumping_factor` got its own regime table** (Sec.6.4, guide:1646–1648): default 20, useful range 0–25, irregular 0–5, rounder 5–25, no directional regime at all. Rev 4 fixed the land table's non-monotonicity — its headline correction — and left the terrain twin pointing at it, which mis-classifies factors 6–10 and invents streaks the engine never draws.

**Should-fix:**

6. **Cancellation reversed to discard-by-id** (Sec.10). Rev 4's terminate-and-respawn argued the cost was "paid rarely at a ~300 ms debounce", but cancellation fires *only* mid-flight, i.e. during continuous typing — the cost landed exactly where it was claimed rare, and was unquantified. v1 now keeps one long-lived worker and discards superseded responses by id, exactly as the parser does; a superseded run wastes ≤40 ms of worker time and nothing else. A 1000 ms watchdog covers the pathological tail. The "mirrors the parser worker" claim, withdrawn in rev 4, is restored — and this time it is accurate.
7. **`border_fuzziness` restated without `Math.pow`** (Sec.6.1): `d` independent Bernoulli rolls, one per tile of depth. Same distribution; rev 4 wrote the closed-form exponent as normative while Sec.8 bans the operator. Sec.6.2's south-bias weights likewise restated as integers.
8. **Default tile budgets rebased on `dim²/14400`** (Sec.6.2/6.4) — `120 × dim²/14400` and `122 × dim²/14400`, from guide:1228/1616. Rev 4's `86 × area-ratio` / `87 × area-ratio` were back-derived by dividing by the guide's rounded 1.4, i.e. the exact display column Sec.4 bans for scaling. Internal contradiction in the doc's most-argued section.
9. **`enable_tile_shuffling` note moved to the attribute's *absence*** (Sec.6.6, Sec.9 item 15). Without it the engine uses the first candidate deterministically (guide:2694) — the documented way to put herdables and villagers under the town center (guide:2697), which always-shuffle scatters. Rev 4 called it a silent no-op and put nothing on the omission.
10. **`terrain_size` argument names** added as a data request (Sec.12 item 4): the data says `terrain`/`width`/`spacing`, the guide says `TerrainType`/`Radius`/`Variance`, and Sec.6.5 is written against the guide. Also mislabels the fields in Breakdown and hover today.
11. **`game-constants.json`'s 31-entry stub confronted** (Sec.12): unknown *named* constants now have a stated rule (place at declared count, placeholder glyph, `notSimulated` note — never a placement failure, which would poison 5.2's buckets with data-gap noise), and Sec.13's corpus gate is explicitly scoped down to structural assertions until Phase 4.0 runs against a real DE install.
12. **Actor-area ids are sets, not areas** (Sec.6.6, guide:1995): `avoid_actor_area 1234` must clear every area carrying that id. Store a multimap.
13. **Border percent→tile rounding is asymmetric** (Sec.4, guide:885–886): floor on left/top, ceil on right/bottom, reproducing the guide's 120×120 worked example, marked `[verify]`. Plus: negative borders are legal (don't clamp), and borders and `circle_radius` accept floats.

**Precision:** a mechanical citation pass — rev 4's line numbers were systematically 1–3 low and `actor_area_radius` was off by 29 (2809 pointed at `find_closest`). Every citation now re-grepped against the text it quotes. The `percent_chance` framing is softened: the two guide statements sit at 3006 and 3010, and they are not contradictory — the first is a sufficient condition, not an iff — so rev 4's "resolves a conflict" oversold it; Sec.15's verify slot was reassigned to the `set_gaia_object_only` question. `parserWorker.ts:28` corrected to `useParsedDocument.ts:95` (the worker echoes the id; the host does the discarding). Appendices A/B/C (the rev-2, rev-3 and rev-4 changelogs) moved to the build log, leaving the spec 20% shorter and free of superseded self-litigation.

**Left alone deliberately**, both flagged by the critique as defensible and both re-checked: frameless `min_distance_to_players` (guide:2433 says only *maximum* is inert — the literal reading stands) and the grouping-scope table overriding guide:2122/2143 (those two lines say "most constraints (ex. …)" while the per-attribute entries state their rules unconditionally; per-attribute wins).

## preview-design.md rev 6 changelog (moved from the spec, rev 7)

The first round tested against the game rather than against the guide. Nine `RMSTEST_*.rms` maps were run in DE's scenario editor (kept in the install's `random-map-scripts` folder, each carrying its full reasoning and read-off table in its header), and `tools/extract-constants` completed its first successful run against a real install.

**Overturned:**

1. **Sec.6.6's grouping-scope table is gone**, replaced by a measured two-rule model: tight grouping checks the **anchor** only and the fill is checked against nothing; loose grouping checks **every member**. Rev 4 introduced the eight-row per-attribute table as its headline "substantive correction", rev 5 kept it and defended it as re-checked. Both were wrong, and re-reading could never have shown it — the guide's per-attribute entries describe loose behaviour, so a table built from them inverts the answer for tight groups. Evidenced across three *kinds* of constraint: `avoid_forest_zone` (distance), `terrain_to_place_on` (tile validity — 25 of 25 placed on a 9-tile patch, spilling onto illegal terrain), `avoid_actor_area` (area exclusion, against a terrain-marked area). Loose confirmed by 12 requested → exactly 9 placed, 9 being the exact count of valid tiles. This also makes rev 3's original blanket policy closer to right than either revision that "corrected" it.
2. **A reference frame does not confine the candidate set.** It anchors the distances that `min`/`max_distance_to_players` and `find_closest` measure from, and nothing more. A frame with no distance band confines nothing. Observed in three separate tests; the spec previously implied per-land placement.
3. **Terrain separation is decided by terrain restriction, never by occupancy.** Same script, one word changed: with WATER between clearings resources stayed on their own land; with FOREST they scattered freely, because forest is legal terrain for them and trees block only by occupancy. The rule itself was right; what was missing is that a visually impassable barrier is not a barrier.

**Confirmed (previously inference, now measured):** `set_gaia_object_only` omitted under a frame places **nothing** (Sec.15 item 9, closed); negative `base_elevation` = **16**; `circle_radius 0` behaves exactly as if the attribute were absent, inheriting the no-attribute variance; `land_position 50 50` → tile (60,60) on a 120 map, pinning Sec.4's percent→tile rule; an empty `<ELEVATION_GENERATION>` section is sufficient.

**Data (Sec.12):** the 31-entry stub is discharged — 31/31 real `constId`s, 15/15 terrain textures, 6 resource yields, `idSource: "extracted"`, 29/31 verified. Items 5 and 6 are now *sourced but not decodable*: `Terrain.colors` is palette indices, not RGB (SNOW reads identical to GRASS), and `Terrain.is_water` is a bitfield, not a boolean. Both need a decoding pass before use; the fallbacks stand until then. FISH/SHORE_FISH left unverified on an honest contradiction.

**Also:** `<ELEVATION_GENERATION>`'s absence promoted to an error-severity `validate()` check, because the map generates fine and then crashes in play; `RMS0201` false-positives on optional trailing arguments filed as `docs/known-issues.md` BUG-003; `PredefinedLabel` typed in `src/parser/language.ts`, which had lagged the data since rev 5 marked it LANDED.

**Process note.** Rev 5's changelog opens by listing what four critique rounds had fixed. The item those rounds spent the most words on is the one this round deleted. Critique converges on internal consistency, which is necessary and not sufficient; a spec about engine behaviour needs contact with the engine, and nine minimal scripts bought more than four rounds of argument did.

## Phase 4.1 rev 6 — engine verification (2026-07-30/31)

The first session to test spec claims against the game instead of against the guide. Started as an independent critique of `preview-design.md` rev 5 (`docs/preview-design-rev5-review.md`), became a data-extraction session, then an in-game verification pass.

**Critique first.** Rev 5's sourcing layer held up under audit — ~45 guide citations, 7 repo file:line references, 4 reference-data claims and 8 corpus statistics spot-checked, with exactly one misattributed line number. Findings were about underdetermination rather than error: "grouped" was never defined though the whole grouping table pivots on it; Sec.7's attribution order was pinned for S6 only; Sec.11 told the implementer to write-compact a cached array in place. Fixed items 1-7 of the review's edit list.

**`predefinedLabels` was landed as data but not as a type.** `src/parser/language.ts:82` still read `predefinedLabels?: string[] // absent today` while the data held 138 objects, so `entry.category` — the switch the whole item exists to enable — did not compile. Nothing caught it because `parserWorker.ts` reaches `LanguageData` through a double cast, which asserts a shape rather than verifying one. Added `PredefinedLabel` / `PredefinedLabelCategory` from the schema's `$defs`, category as a ten-member union so the generator's switch is exhaustiveness-checked. Field kept optional despite the schema marking it required, so preview-design Sec.3.1's mandated `?? []` guard is not dead code. **Lesson recorded: a prerequisite marked done in one representation is not done in the others.**

**Phase 4.0 extraction completed — first successful `.dat` run.** `game-constants.json` went from 31 entries with zero `constId`s and zero `verified` to 31/31 real ids, 15/15 terrain textures, 6 resource yields, `idSource: "extracted"`, 29/31 verified. Three tool bugs surfaced on that first real run: the terrain→texture lookup joined `Graphic.slp` against `Terrain.slp` (unrelated id spaces — resolved for no terrain, and produced `s_town_center_extra_x1` for the two whose slp is -1); `verified = True` was set unconditionally, so GRASS shipped `verified: true` beside its own note reading "texture NOT resolved"; and DE's literal `"None"` placeholder filename reached the JSON, which `validate:reference` structurally cannot catch since the schema types the field `["string","null"]`. **A unit test was pinning the second bug in place** — `test_full_run_sets_verified_true` handed `merge_entry` a fake dat reporting *unit not found* and asserted `verified: True`. Replaced with six per-branch tests. The `build_slp_lookup` tests all passed too; they verified the function did what it claimed, never that the claim was the right question.

**Nine in-game verification maps.** Kept in the install's `random-map-scripts/`, each minimal, deterministic where possible, with a binary observable and its full reasoning in its header. Results are in preview-design Appendix A; the headline is that Sec.6.6's grouping-scope table — rev 4's flagship correction, re-checked and defended by rev 5 — was wrong, and no further re-reading could have shown it, because both readings were consistent with the guide.

**Process lessons worth keeping.**

- **Verify the instrument, not just the result.** A filter of `RMSTEST_[0-9]_[a-z]+\.rms` silently dropped every diagnostic from `RMSTEST_2_circle0.rms` because `circle0` contains a digit, and the missing output was misread as the parser being silent on `circle_radius 0`. That produced a phantom "possible falsy-zero bug" that does not exist. A filter that discards non-matching input without complaint will manufacture findings.
- **Test-map designs need their own controls.** Test 7's actor area was invisible, so its result was unreadable; Test 9 re-ran it with the area marked by a concentric terrain stamp, which also incidentally confirmed Sec.4's `land_position` mapping.
- **Critique converges on internal consistency, which is necessary and not sufficient.** Four critique rounds spent more words on the grouping table than on anything else in the spec, and it was the thing that was wrong.

**Also landed:** `docs/known-issues.md` BUG-003 (false `RMS0201` on optional trailing arguments — parser already honours `argDef.optional`, `language.json` never sets it; live on three corpus maps); `<ELEVATION_GENERATION>`'s absence promoted to an error-severity `validate()` check in CLAUDE.md tracked debt (map generates, then crashes in play — reported by Zetnus, crash second-hand); `idSource` added to the extraction tool and the game-constants schema, closing the last `validate()` data gap.

## Phase 2.4/2.5 — `validate()`, the semantic pass (2026-07-31)

The tracked-debt item from Phase 2 shipped: `src/parser/validate.ts`, a pure second pass over a finished `ParseResult` (parser-design Sec.8), wired into the parser worker and merged into the one diagnostics list every consumer already reads. Nine of the spec's checks are live, two are deliberately not, and the reason for that split is the substance of this session.

**The pass is a second pass on purpose.** `parseRms` is single-pass and knows only what it has seen so far, which is not a shortcut — it is the engine's own rule for constants (guide:148). Every semantic check needs the opposite: a redefinition is invisible until both definitions are read, a missing `<ELEVATION_GENERATION>` until EOF. Folding these into the parser would have meant buffering diagnostics until the end, which is a second pass wearing a disguise.

**Measurement drove every scoping decision.** Implemented straight from Sec.8, the pass emitted **11,623 diagnostics across the 57-map corpus**. Tuning brought it to **277** (~4.9 per map), and each cut was made against evidence rather than taste:

| Check | First run | Shipped | What the corpus showed |
|---|---:|---:|---|
| RMS0300 conditionally-defined note | 6,404 | 0 | Dropped. "Set a flag in a random branch, read it later" is the core RMS control-flow technique, not an edge case (2,349 in AK_Vanguard alone), and the note cannot tell a typo from a branch that correctly didn't run. |
| RMS0301 duplicate definition | 4,856 | 3 | Restricted to both-definitions-unconditional. Sec.8 already says why conditional redefinition is legitimate; reporting it anyway produced 491 notes in one DE-official map. |
| RMS0304 wrong section | 53 | 0 | Not built. `CommandDef.section` records where the guide *documents* a command, not where the engine accepts it — 52 of the 53 were `effect_amount` used in `<OBJECTS_GENERATION>`/`<LAND_GENERATION>` by shipped, working maps. |
| RMS0306 duplicate attribute | 60 | 17 | Kept; 43 of the 60 were `add_object`, which is cumulative by design. Fixed as data (`repeatable: true`), not as a special case in code. |
| RMS0300 undefined label | 299 | 7 | Inverted from a negative claim to a positive one — see below. |

**The rule that came out of it: reference data is a positive resolver, never a negative authority.** `game-constants.json` holds 31 of the game's several hundred constants, so finding a name in it proves something and *not* finding one proves nothing. The same asymmetry then turned up where it wasn't expected — in condition labels, the one vocabulary that was supposed to be closed. DE-official maps branch on `MAPSIZE_ABOVE_GIANT`, `THEME_AFRICAN`, `NOMAD_START`, `ESCALATION_MODE` and a dozen more labels that appear **nowhere** in the archived guide our 138 `predefinedLabels` were transcribed from. They are engine labels newer than our data, and "never defined" would have been a false warning 299 times.

So RMS0300 now reports only on positive evidence of a typo: a label within edit distance **1** of something the file or the engine actually defines. Distance 2 (what the parser's RMS0200 uses for command names) is wrong here — command names are a fixed, well-spaced vocabulary, while condition labels are invented per file and arrive in dense families, so at distance 2 a neighbour is always findable and means nothing. The corpus produced `CONFIG_RIVER_D1 — did you mean CONFIG_RIVER_A4?`, which is a different river. Two further suppressions fell out of the same principle: a name whose `#define` exists but is **commented out** is switched off deliberately (168 `if DEBUG_MODE` uses in one map), and an unrecognised name with no near neighbour is presumed to be a label we don't know yet.

**What survived is worth having.** The tightened check found a real dead branch in a DE-official map: `hamburger.rms2` writes `if 0_TEAMGAME / elseif 3_TEAMGAME / elseif 4_TEAMGAME` where the engine label is `0_TEAM_GAME` — one missing underscore, three branches that never run, and a map that generates perfectly while doing so. That is precisely the class of bug the pass exists for. Also confirmed by hand: RMS0307's mutex hits are genuine (`set_scale_by_size` and `set_scale_by_groups` in the same `create_terrain` block, 50 sites), and RMS0302's shadowing hits are genuine no-ops (`#const BEACH 2` against a name `random_map.def` defined first).

**Two data-driven additions rather than name checks in code**, per the vocabulary-is-data rule: `AttributeDef.requiresSection` (`base_elevation` → `ELEVATION_GENERATION`, driving RMS0311, the pass's only error severity) and `CommandDef.deprecated` (`effect_percent`, holding its own user-facing replacement text). Both landed in the schema, the data, and the TypeScript mirror together — the lesson from the `predefinedLabels` session, applied.

**Diagnostic codes.** Sec.8 enumerates the checks but assigns codes to only two of them, so semantic checks got a new `RMS03xx` block (0300–0311), continuing the existing grouping and logged in `diagnostics.ts` as an amendment in the style RMS0217 established. RMS0304 keeps its number and a comment explaining why it is unbuilt.

**Open, for a future in-game session:** which commands are genuinely section-locked. Until that is answered RMS0304 cannot distinguish an authoring mistake from a documentation artifact, and Sec.8's wrong-section suppression rule (for degraded regions that swallowed a section header) is absent along with it — the two revive together.

**Verification.** `npm test` 361 passing (up from 277: 40 new unit tests, one per check plus its negative cases, and validate() added to both corpus gates — no-throw over every file, zero-error over the triaged allowlist). `npm run typecheck`, `npm run lint` (0 errors), `npm run validate:reference` all clean.

## Phase 2.4/2.5 — `validate()` corpus review (2026-07-31, same day)

A review pass over the just-shipped semantic pass, run by re-taking the 57-map measurement against the committed code rather than reading it. The total reproduced exactly (277), which is what made the *composition* worth looking at: one check nobody had put in the tuning table was supplying 79 of the 277, and classifying its hits found the pass's one outright false claim.

**RMS0302 was two checks wearing one code.** Sec.8 asks for a single "shadowing a predefined name" warning over `predefinedLabels` + the constants DB. Classified against the corpus, its 79 hits split cleanly:

| Kind | Hits | Verdict |
|---|---:|---|
| `#const <game constant>` written to the engine's own value | 73 | True, worthless. All in copied `if TERRAIN_CONSTANTS` headers pinning IDs. **Zero value mismatches corpus-wide.** |
| `#define <predefined label>` | 6 | **False.** Not shadowed at all. |

The second row is the finding. Every one of the 138 `predefinedLabels` is a *runtime condition* — the ten categories are game mode, map size, starting resources, starting age, lobby setting, player count, team count, team size, player-in-team, game version — so the engine defines each only when it holds. `MAPSIZE_TINY` exists on a tiny map and nowhere else, or `if MAPSIZE_TINY` could not work. A user `#define EMPIRE_WARS` is therefore overridden by nothing; it switches the condition on, which is precisely the point of the block `Acclivity`, `Enclosed` and `Haboob` all ship:

```
if EW_TESTING
    #define EMPIRE_WARS
    #define EW_FEUDAL
    #define FEUDAL_AGE_START
```

The old message told the author that line "does nothing at all — pick a different name". Following it would have broken their test harness. A unit test pinned the behaviour in place, which is the same shape as the Phase 4.0 `test_full_run_sets_verified_true` failure: the test verified the function did what it claimed, never that the claim was the right question.

**The split.** RMS0302 keeps the game-constant half, and gets a severity that tracks the evidence: warning only when a verified `constId` and an integer literal disagree (the silent value bug — `#const SNOW 11` where every `SNOW` below still means 32), info when they agree or can't be compared. RMS0312 is new and carries the label half, phrased as what it is rather than as a mistake, with the one real hazard named (an unguarded `#define` ships the mode enabled). Corpus total is unchanged at 277 — the deliberate choice was info over silence, since "this line does nothing" is true and worth saying once to a beginner — but the mix moved from **149 warning / 128 info to 70 / 207**. Zero RMS0302 warnings survive on the corpus, which is the correct answer for a corpus that contains no value mismatches.

**The rule this adds to the positive-resolver one:** a reference-data hit says what a name *is*, never what the engine has already done with it. Rule 1 governs whether a lookup may be trusted; this governs what may be concluded once it is. `predefinedLabels` records names the engine *may* define. Written into parser-design Sec.10 as scoping rule 3 and into the Sec.8 bullet it amends.

**Corpus gates were running on 33 of the 57 files.** `listRms` never recursed into `test-maps/local/`, so the half of the corpus every scoping decision was measured against — including `hamburger.rms2`, the pass's one real find, and the three DE-official maps supplying 59 of the 79 RMS0302 hits — sat outside every gate. Now walked (`.rms` only; `.rms2` stays out as a separate triage question, so the headline find is still ungated). All 19 newly-gated files pass the coverage and span-fidelity properties unchanged, which is the first evidence those properties hold on DE's own scripts and not just on community ones. This is the build log's own "verify the instrument" lesson landing one session later: a loader that silently skips input will let a measurement rot without anyone noticing.

**Also corrected:** parser-design Sec.8 said five attributes carry `repeatable`; the data has had six since `add_object` was flagged during the build (rationale was recorded on the entry's `notes` and in the tuning table, never in the spec sentence).

**Left open, recorded in Sec.10 rule 2:** distance 1 narrowed RMS0300's dense-family problem without closing it. `AK_Namatjira` defines `CONFIG_RIVER_{A4,A6,A9,M4,M6,M9}` and branches on twelve members; `A8` and `M8` are reported, the four undefined siblings at distance 2 are not. Suggested discriminator, unmeasured: a chain whose conditions are *all* undefined is a typo family (`hamburger`), a chain mixing defined and undefined members is a config switch (`AK_Namatjira`, `Rage Forest 2026`).

**One unrelated gate repaired.** `lexer.test.ts`'s offset property check (spec Sec.12, non-negotiable) started timing out mid-session on unchanged code. Measured rather than guessed: the five fixture files hold 76,534 tokens, tokenizing them costs 403 ms and comparing every offset costs 68 ms, while the `expect()` per token the test used cost 7.6 s of assertion-object construction — so a gate over a 0.4 s workload was failing a 5 s timeout on nothing but machine speed. Rewritten to collect mismatches and assert once, the same shape `testUtils.checkProperties` already uses. Identical comparison, same failure detail, 0 mismatches. **Rule of thumb: an assertion inside a five-figure loop is a harness cost, not a check** — collect and assert once.

**Verification.** `npm test` 404 passing (up from 361: +5 unit tests for the split, +38 from the newly-gated local corpus). `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` clean.

## Phase 4.1 — exact measurement via scenario export (2026-07-31)

Follow-on to the rev 6 verification pass. The in-game maps answered every *binary* question and could answer no *numeric* one, because nobody can count 829 versus 840 tiles from a screenshot. This session closed that gap.

**`tools/scenario-probe/` — the instrument.** DE's editor can save an RMS-generated map as a `.aoe2scenario`, and `AoE2ScenarioParser` (added dependency, `pip install -r requirements.txt`) reads it. The probe prints exact terrain, elevation and object histograms with names resolved through our own `game-constants.json`. Workflow: pick the script in the editor, Generate Map, Save As, run the probe.

Two things worth knowing before using it. The library prints emoji progress markers, which raises `UnicodeEncodeError` on a cp1252 console **during parsing** and looks exactly like a parse failure; the probe forces UTF-8 stdout at import. And mod scenarios are a poor test corpus — trigger-heavy and unrepresentative — so validate the probe against a map whose contents you specified yourself.

**It validated itself on first use.** `RMSTEST_8` came back: 216 GRASS, 98 DESERT, 9 DIRT, 14077 FOREST, summing to exactly 14400 = 120². Every number is one the script asked for — `base_size 7` → 15×15 = 225 minus 9 dirt, `base_size 3` → 7×7 = 49 per player land (guide:769), `number_of_tiles 9` landing exactly, and `number_of_tiles 1` correctly failing to grow a land past its origin stamp. Gold 25, stone 1. The terrain ids also matched `game-constants.json` exactly (GRASS 0, DIRT 6, FOREST 10, DESERT 14) via a completely separate code path from `random_map.def`, which is real corroboration of the Phase 4.0 extraction.

**Sec.15 item 7b is NOT settled, and both candidate models are refuted.** `RMSTEST_10` ran `create_elevation 1 { number_of_tiles 400 set_scale_by_size }` on Small (144×144). Exact area predicts 400 × 2.0736 = **829.44**; the guide's rounded ratio column predicts 400 × 2.1 = **840**. Measured: **853 tiles at elevation 1**. Neither. This is the single most valuable outcome of building the probe: three revisions of the spec argued 829 versus 840 and the answer was neither.

Two follow-up exports pinned the shape of it. Declared 400 twice → **853, 851**; declared 200 → **428**. So run-to-run variance is ±2 tiles (measurement is stable), the relationship is **linear with no constant overhead** (halving the declared value halves the result, ruling out a fixed slope skirt or perimeter cost), and the effective multiplier is **~2.13** — *above* both candidates, exact 2.0736 and rounded 2.1. The achieved count therefore exceeds the budget by ~2.8% (exact model) or ~1.4% (ratio model), consistently.

**A tile count could not settle it.** It measures what the elevation clump *grew to*, not what it was *told to grow to*, and region growing overshoots. `RMSTEST_11_scaling_objects.rms` re-ran the same arithmetic against `number_of_objects 400 set_scaling_to_map_size` — frameless and unconstrained, so nothing could starve the count — because an object count is counted rather than grown.

**SETTLED: 829 GOLD, exactly the exact-area prediction** (`400 × 20736/10000 = 829.44`). The rounded-ratio model predicted 840. **preview-design Sec.4 was right**, guide:3429's "multiply by the area ratio listed" is an author-facing simplification, and Sec.13's fixture asserting 829 stands. Recorded in Sec.4 as CONFIRMED.

This also explains the elevation numbers retroactively: against a budget of 829, the measured 851-853 is a **~2.7% overshoot**, and at declared 200 the 428 against ~415 is **~3.1%**. So **elevation clump growth overshoots its target by roughly 3%** — now a measured `[tune]` datum for Sec.6.2, since our own growth stops exactly at target and will under-produce against the engine by that margin.

**Rounding settled too, and the spec was wrong.** `number_of_objects 500` on Small is exactly 1036.8; three separate runs each placed **1036**, never 1037. **The engine truncates.** Revisions 3 through 6 all said "round half up", never verified. Sec.4 corrected. The two measurements compose cleanly — 829.44 → 829 and 1036.8 → 1036 are both plain truncation — and note the first could not have detected the error, since its fraction was below .5. **Sec.15 item 7b is closed.**

**A caution the object runs surfaced.** Object counts were perfectly reproducible (1036 ×3) while elevation tile counts varied (853, 851 at the same declared value). Same scaling path, different variance, which localises elevation's variance to growth rather than arithmetic — but does **not** establish that the ~3% mean offset is growth. At least three explanations survive two data points: batch overshoot; `set_scale_by_size` not following the same rule as `set_scaling_to_map_size` (only the object path was ever measured, and Sec.4 asserting they share a rule is spec, not evidence); or a perimeter-scaled skirt of tiles raised to render the hill edge. Filed as **Sec.15 item 7d** with a one-map discriminator — `RMSTEST_13_overshoot.rms` runs `number_of_tiles 829` with no `set_scale_by_size`, deleting the scaling path, so ~853 means growth overshoots and exactly 829 means the offset lives in elevation's scaling. Re-running it at 25 separates the skirt hypothesis, since a perimeter effect is an enormous fraction of a small clump and a rounding error on a large one. **RESOLVED same day (RMSTEST_13, 4 runs per budget).** Budget 829 with scaling deleted still gave **863, 855, 851, 848** (mean 854.25, +3.05%) — the overshoot survives removal of the scaling path, so it is growth. Budget 25 gave **26, 26, 27, 26**, killing the perimeter-skirt explanation: a 25-tile blob's perimeter is ~18 against ~102 for an 829-tile one, so a skirt would have added ~18 tiles and it added one; the overshoot ratio (20x) tracks the area ratio (33x), not the perimeter ratio (5.8x).

**A second result fell out of the same runs.** The unscaled 829 mean (854) is indistinguishable from the *scaled* declared-400 runs (853, 851), which means `set_scale_by_size` targets the same budget the object path does. Had elevation scaled differently it would have aimed at a different number and landed elsewhere. Sec.4 previously asserted that the two scale attributes share a rule; that is now measured.

Recorded in Sec.6.2 with the spread, not just the bias: 848-863 is a 1.8% range on identical input, so 5.2's Monte Carlo must not expect elevation coverage repeatable to the tile. Implementing the 3% is marked optional and low priority — it is invisible at preview scale and inside Sec.13's tolerances. Sec.15 item 7d closed.

**Method lesson, now written into Sec.15 item 7:** measure a *counted* quantity, never a *grown* one. The first instrument was not wrong about arithmetic, it was measuring the wrong thing, and it produced a number (~2.13×) that matched no model and would have looked like evidence against both.

**New mechanism found: terrains auto-place objects, at a density the dat records.** `Terrain.terrain_unit_id` / `terrain_unit_density`, and the unit is **objects per 1000 tiles** — confirmed at scale on RMSTEST_10, where 20736 GRASS tiles at density 60 produced 1245 objects against a predicted 1244.2, and on RMSTEST_8 where FOREST at density 1000 produced 14080 trees on 14077 tiles. This matters beyond decoration: Test 8 established that **occupancy is the only constraint on a tight group's fill**, and these auto-placed units are occupancy. preview-design models forest trees for the forest-zone mask but not the general mechanism.

**BUG-003 partially fixed: corpus RMS0201 69 → 27.** Six arguments flagged `optional: true` — `circle_radius.variance` plus five attributes the guide documents as legal written bare (`set_avoid_player_start_areas` guide:1693, `avoid_forest_zone` guide:2565, `avoid_cliff_zone` guide:2581, `require_path` guide:2719, `avoid_other_land_zones` guide:2312). Remaining 27 are triaged in `docs/known-issues.md`, dominated by `#const` at 16 which is probably the Sec.6 stop-set rather than optionality.

**Two instrument errors in one session, same shape as the regex incident.** Both are recorded in BUG-003 because the lesson is worth more than the fix.

- The first candidate scan required `len(arguments) >= 2`, reasoning that only a trailing argument can be omitted. That silently excluded every single-argument attribute — all five of the real cases. It returned 3 candidates and looked authoritative. **A sweep returning suspiciously few results is a reason to check the filter, not to conclude the problem is small.**
- "Carries a documented `default` → is optional" is unsafe: `terrain_state` declares defaults on all four arguments, so the mechanical rule marks the **first** argument of a four-argument command optional. Guide:608 shows those describe values, not omissibility. Left alone, as was `guard_state`; neither appears in any of the 215 scripts checked.

**Process note on parallel sessions.** A concurrent session was writing `validate.ts` and `language.json` throughout. One full `npm test` run showed two failures that did not reproduce on re-run and passed in isolation — files being rewritten mid-suite. Before believing a red gate in this repo, re-run it and check file mtimes.

## Parser audit after 4.0 and the tech-debt passes (2026-07-31)

A read-only audit of everything Phase 4.0, 4.1 and the `validate()` sessions left in `src/parser/`, asking what the new insight implies for code nobody re-examined. The parser's own diagnostics had not been measured since the corpus grew to 52 files, and that turned out to be where the problem was.

**The merge itself is clean.** `parseRms` and `validate()` were checked for double-reporting by comparing exact spans across all 52 files: **zero overlaps**. The single merge point in `parserWorker.ts` is correct, the pure modules stay split, and `docs/parser-design.md` Sec.10's code table matches the 45 codes the implementation actually emits, RMS0312 included. `parser.ts` itself changed almost not at all — an exported `editDistanceCapped` (shared with `validate()` so the two passes agree on what counts as a typo) and a TODO. The rest of its diff is a repo-wide `§` → `Sec.` sweep, complete, zero occurrences left.

**What the measurement found is that the noise moved.** `validate()` was tuned 11,623 → 277 and is well behaved. Nobody re-measured the *parser*, which emits **1,800** diagnostics over the same corpus — 6.5× the semantic pass it was so carefully scoped against.

| Code | Hits | Verdict |
|---|---:|---|
| RMS0200 unknown name | 858 | ~2.5% signal. Filed BUG-005/BUG-004 |
| RMS0203 out of range | 514 | 463 false, **fixed this session** |
| RMS0217 negative border | 169 | Genuine caution, left alone |
| RMS0202 type mismatch | 106 | Already tracked as BUG-002 |

**The fix: two `min` values that contradicted their own `default`.** `base_elevation.level` and `create_elevation.maxHeight` both declared `min 1 / max 16 / default 0`. Both were transcribed from a guide line reading `number (1-16) (default: 0 - not elevated)` — the parenthesised range was copied and the clause beside it, which documents 0 as the legal value meaning flat, was not. Every one of the corpus's **461** `base_elevation 0` uses drew RMS0203. Corrected to `min 0`; RMS0203 fell **514 → 51**, and the survivors are true positives (`land_position` past 99, which guide:818 says can crash the game outright).

**The instrument fix matters more than the data fix.** A declared default outside a declared range is always one of the two being wrong, and JSON Schema cannot express the relationship — it can type all three fields correctly while they contradict each other. `scripts/validate-reference-data.mjs` now fails CI on it. Verified by reintroducing the bug and watching it fire, per this log's own standing lesson: exactly 2 offenders repo-wide, both the ones above.

**Two findings escalated rather than patched, both the same root.** CLAUDE.md's **positive resolver** rule was written during the `validate()` session, applied thoroughly inside `validate.ts`, and never carried back to the parser. RMS0200 still says "the engine will silently ignore it" on evidence that is purely the name's absence from `language.json` (BUG-005). The concrete casualty: `avoidance_distance`, used 128 times by a **Forgotten Empires** map and 128 more by an allowlisted community one, is absent from the guide and therefore from our data, so we call working DE-official syntax unknown 256 times (BUG-004). Its argument shape is unresearched, so the entry was deliberately not invented. **A rule established in one pass is not established in the passes that predate it** — the same shape as rev 6's "a prerequisite marked done in one representation is not done in the others".

**One stale comment retired.** `CommandPicker.tsx` justified its advisory section filter with "validate() doesn't exist". It does now; the filter stays advisory for a different reason (RMS0304 is deliberately unbuilt), and the comment says so.

**BUG-003's remaining count was re-measured: 27 → 35.** Not a regression. That sweep walked only the 33 tracked maps, so `test-maps/local/`'s 19 DE-official scripts were invisible and `ai_info_map_type` alone goes 2 → 10. Third instrument error of this exact family in three sessions, so the entry now carries a standing instruction to state which half of the corpus any count was taken over.

**Verification.** `npm test` 405 passing, `npm run validate:reference` clean including the new check. Note for whoever reads a red gate next: two `npm test` runs raced on this machine and produced two phantom timeout failures in the patch property gate (323s wall vs 45s solo) that vanished on a clean re-run — the parallel-sessions note above, reproduced exactly.

## Phase 2.4/2.5 — `validate()` reachability checks (2026-07-31, same day)

A follow-on from the corpus review, driven by two worked examples rather than a sweep. Both looked like they should produce a diagnostic and neither did; running them found one check missing, one check mis-specified, and one real defect in a DE-official map.

**The examples.** First: `if A1 #const T 2 endif / if A2 #const T 3 endif / ... / #const T 1` with A1 and A2 picked by a `start_random`. Correctly silent, and worth recording why — because first-definition-wins, the fallback **must** come last, which inverts the habit that transfers from C and Python. Writing the default first is the bug, and nothing reports it today (CREATION_PLAN 2.6). Second: `if A1 #const T 2 endif` near the top, then a `B1`/`B2` chain each of whose branches contains `if A1 #const T ...`. Both inner assignments are dead whenever A1 holds, and nothing reported them. That is 2.6's shape too.

**What did get built, both from the same insight: `conditionalDepth` is a count, not a path.** Depth 1 describes `if A / else` (two paths, legitimate, the 4,856-diagnostic cut) *and* two definitions inside one `if A` (one path, the second provably dead). The old RMS0301 discarded both. Replaced with a guard stack maintained during the walk — a condition contributes a positive literal to its own branch and a negation to every later branch of its chain, each `start_random` branch contributes an opaque literal — and two definitions share a path when their stacks are equal.

| Check | Before | After |
|---|---:|---:|
| RMS0301 redefinition | 3 | **38** |
| RMS0313 unreachable branch | — | **1** |
| Corpus total | 277 | 313 (106 warning / 207 info) |

Verified as a strict superset: every hit the old `conditionalDepth` rule produced is still produced. The 35 new ones triaged as real, the largest cluster being a shared template that writes `#const PREDATOR_A` twice in each branch of a six-way switch while the block immediately above it correctly writes `LUREABLE_A` and `LUREABLE_B` — every branch reads as picking two predator species and delivers one.

**RMS0313 found a defect in DE's own `nomad.rms`.** One `if`/`elseif` ladder tests `INDOMALAYAN_TROPICAL` at branch 6 and again at branch 11, 130 lines apart. The second can never be reached, so 23 lines and 15 constants of biome configuration are dead in a shipping official map. It surfaced first as 15 redefinition hits whose guard sets contained both `X` and `!X`, which is what prompted separating reachability from redefinition — a contradictory guard means the *branch* is dead, not the assignment, and it deserves one report rather than one per statement inside it. **The general lesson: when a check's hits cluster, ask whether the cluster is one fact being counted many times.** RMS0313 reports the same defect once, needs no reference data, and has no soundness precondition, because every branch of one chain is tested against the same defines at the same point in the token stream.

**Deferred with its measurement attached (CREATION_PLAN 2.6, spec Sec.8):** guard *subsumption*, where an earlier definition on a *containing* path kills a later one. It catches both worked examples above and found exactly **one** genuine corpus hit beyond same-path, at the cost of guard algebra plus a monotonicity precondition — unsound if a guard name is `#define`d between the two sites, since the earlier guard could have been false there and true later. Recorded rather than built.

**Correction to the review entry above.** Its "37 hits, zero overlap with RMS0301" understated the overlap: the triage compared the prototype's offsets (the `#const` token) against RMS0301's spans (the *name* token), so the comparison could never match. Two of the 37 were already reported. The 37 stands, the net-new figure is 35. **Anchor comparisons on the same token before concluding two checks are disjoint.**

**Verification.** `npm test` 413 passing (up from 405: 8 new unit tests across the two checks and the reworked RMS0301). `npm run typecheck` clean, `npm run lint` 0 errors.

## Phase 2.6 — guard subsumption, `RMS0314` (2026-07-31)

Built the same day it was deferred, on request. The brief and the deferral reasoning are in CREATION_PLAN 2.6; this records what building it actually produced, which is not what the prototype predicted.

**The check.** An earlier `#const` whose guard set is a **subset** of a later one's has already run whenever the later one can, so the later value never applies. The empty set is a subset of everything, so the beginner case falls out for free — a default written above the conditional versions instead of below them.

**The soundness precondition is the whole difficulty.** Guards are evaluated where they are *written*, so a positive literal true at the later site need not have been true at the earlier one:

```
if A            <- false here, so nothing is defined
  #const T 1
endif
#define A       <- A becomes true
if A
  #const T 2    <- genuinely live; reporting it would be a false positive
endif
```

Any `#define` of a guard name landing between the two sites silences the claim. Negated literals need no check, because definitions only accumulate (`#undefine` is non-functional, spec Sec.7) — a name undefined at the later site was undefined at the earlier one too. The opaque `start_random` literals need none either, having no name to redefine. **Only positive literals can flip, so only positive literals are checked.**

**The real find was in RMS0301, not in the new code.** The same-path check that shipped hours earlier needs the identical precondition and did not have it: two *separate* `if A` blocks produce identical guard stacks, so a `#define A` between them makes the first block's definition never happen and the second one live. `subsumes()` now gates both codes. Same-branch definitions are unaffected, their guard having been evaluated once before both.

**Corpus result: zero RMS0314 hits, and the predicted one was an artifact.** All 15 proper-subset candidates over the 57 maps sit inside `nomad.rms`'s unreachable branch and belong to RMS0313, which reports them once rather than fifteen times. None were removed by the monotonicity precondition. The "one genuine hit beyond same-path" from the morning's partition came from the prototype grouping by AST *scope* while the shipped check groups by guard *set* — two separate `if A` blocks share a set but not a scope, so that pair is RMS0301's and always was. **Two prototypes in one day have now disagreed with the implementation because of how they bucketed, not because of what they computed; a prototype's grouping key is part of its result and has to match the real one before the numbers can be compared.**

**Why it ships at zero.** The corpus is expert-written community maps and DE-official ones, where nobody declares a default first. The app is for people learning RMS, and default-first is the single most predictable transfer error from C, Python and every brace language — silent in-engine, invisible on inspection. A corpus count of zero is not a check that cannot fire; both worked examples that motivated it are unit tests, in both directions of the precondition.

**Verification.** `npm test` 423 passing (up from 413: 10 new unit tests). `npm run typecheck` clean, `npm run lint` 0 errors.

## Phase 2.3 — did-you-mean widened, `#undefine`/`#include` notes corrected (2026-07-31)

Two small changes that came out of reading the guide's Non-Functional Syntax appendix properly rather than trusting the summary of it in the reference data.

**What the appendix actually says.** `#undefine`, `#include`, `min_distance`, `max_distance`, `set_position` and `percent_of_land` were found by searching the game's own non-localized-key-value-strings file in HD/DE, and none of them appear to do anything. That is a list of strings the *engine binary ships*, not a list of mistakes anyone made — an important distinction, because it means they are vestigial vocabulary (renamed or planned-and-never-wired) rather than typos. Three of the four attribute-shaped ones are truncations of names that work: `min_distance_to_players`, `max_distance_to_players`, `land_position`, with `percent_of_land` corresponding to `land_percent`.

**RMS0200's containment heuristic was suffix-only,** so every one of those four drew a bare "unknown attribute" with no suggestion — edit distance cannot reach them either, the missing tails run to eleven characters. Now matches prefixes too. `set_position` still gets no suggestion and should not: it is not a prefix of any working name, and an invented neighbour is worse than silence.

**The prefix rule needed candidate ranking to be worth having.** Shortest-match-wins returns `min_distance_cliffs` for `min_distance` — 19 characters against `min_distance_to_players`'s 23, and a terrain attribute that cannot appear in the `create_object` block where the author typed it. Containment matches are now ranked by whether the enclosing block's command accepts them, falling back to length. `CommandDef.attributes` ranks and never rejects, per the positive-resolver rule; a name missing from a command's list is a data gap, not evidence about the author. The frame stack already carried `owner: CommandNode`, so this cost one small method. **The lesson is that a heuristic's tiebreak is part of the heuristic** — widening the match set without fixing the ordering would have shipped a confidently wrong answer for the exact case that motivated the widening.

Also fixed while in there: the containment test compared an original-case candidate against a lowercased needle while the edit-distance branch above it lowercased both. Invisible today because every name in `language.json` is lowercase.

**`#undefine` and `#include` notes rewritten, `verified` deliberately left `false`.** Both notes claimed the source fetch never reached the section that would confirm them; it did, and the appendix lists both. The flag stays `false` on purpose, and the reason is now written into the notes: on this schema `verified` gates whether RMS0201/0202/0203 fire as warnings for the entry's ARGUMENTS, and the appendix sources the name and its inertness, not an arity. The appendix lists the bare word; a directive with no behaviour has no documented argument contract, and `#undefine`'s one-string-argument form follows community usage rather than the guide. Holding those diagnostics at info is the correct posture for an assumed arity. Open question recorded on the entry: does the engine consume a following token at all, or is `#undefine FOO` two stray tokens?

**Verification.** `npm test` 425 passing (up from 423). `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` clean.

**Flaky gate to watch, unrelated to these changes:** `corpus.test.ts`'s Vanguard benchmark asserts a fixed 500 ms wall clock and failed twice today on slow runs (672 ms once, and once in a suite pass that took 279 s against a normal 84 s), passing on every clean run. Same shape as the `lexer.test.ts` timeout fixed earlier — a wall-clock assertion on a shared machine. Spec Sec.9 says the threshold exists to catch complexity regressions, not to measure, so it should probably be scaled off a warm-up measurement rather than pinned to a constant.

### 7a and 7c (same session, 2026-07-31)

**7a ANSWERED, and it is the largest numeric correction the spec has taken: default tile budgets scale with SIDE LENGTH, not area.** `RMSTEST_14` runs `create_elevation` and `create_terrain` with no `number_of_tiles`, so both fall back to their defaults, and reads them from different histograms in one export. Two runs each on Tiny and Small:

| | Tiny (120) | Small (144) | ratio |
|---|---|---|---|
| elevation (level 1) | 126, 128 | 147, 158 | **1.20** |
| terrain (DIRT) | 120, 121 | 148, 146 | **1.22** |

Side length gives 144/120 = 1.20; area gives 1.44. The terrain fit is near exact — `122 × dim/120` predicts 122 and 146.4 against 120.5 and 147 measured. Sec.6.2/6.4 corrected from `× dim²/14400` to `× dim/120`. **The old model over-predicted by 4x at Ludicrous** (1920 tiles against 480), and every revision since rev 2 carried it. Comparing *ratios* rather than absolute counts is what made this readable, since both quantities are grown and carry overshoot that cancels in a ratio.

Second finding from the same runs: **terrain growth does not overshoot, elevation does.** Terrain lands on its budget; elevation sits ~6% above at these sizes against ~3% at a budget of 829, so the overshoot fraction is larger for smaller budgets. Sec.6.4 now warns against carrying Sec.6.2's overshoot allowance across.

**7c NOT answered — the test was confounded, by something built into the map.** `RMSTEST_15` used a WATER base so the grass rectangle would be unambiguous. DE auto-generates a **BEACH ring** where land meets water: 432 beach tiles, a one-tile band around the entire land. So the land's true edge sits one tile outside the grass, and "is the boundary the grass or the beach" shifts every inset by one — which is exactly the precision the question needs, since the four candidate models differ by a single tile. Measured insets were grass 5/2/8/11 and land-including-beach 4/1/7/10; neither matches any candidate, and one edge is anomalous under both readings. `RMSTEST_16_borders_nowater.rms` re-runs it on a DESERT base with DESERT player lands, so nothing can trigger beach and no terrain but GRASS can move the bbox. Its header asks for the terrain total as a check that the confound is actually gone.

**Shape note, worth keeping.** Bordered lands come out chamfered — the "borders make a hexagon" behaviour. Row-by-row measurement showed corners cut at 45 degrees over about four tiles. A bounding box is still the correct instrument, because the chamfer only cuts inward from the corners and the flat-edge extent is preserved; verified by the middle row spanning exactly the bbox range. The `--bbox` option added to `probe_scenario.py` for this reports per-edge *insets* rather than raw coordinates, since border attributes are specified as insets and comparing like with like is what avoids off-by-one errors.

**7c ANSWERED on the re-run (RMSTEST_16, DESERT base so nothing triggers beach; GRASS + DESERT = 14400 exactly, confound gone).** Measured x 4..118, y 7..109, identical on two runs. It matched none of the four candidate signatures, which turned out to be a framing error on my part rather than a strange engine: I was comparing per-edge *insets*, and the inset folds an off-by-one into the number being compared. Against raw coordinates the rule falls out exactly:

```
min_x = round(left_pct/100 · dim)      max_x = dim − round(right_pct/100 · dim)
min_y = round(top_pct/100 · dim)       max_y = dim − round(bottom_pct/100 · dim)
```

Declared 3/2/6/9 on dim 120 → 3.6/2.4/7.2/10.8 → predicted 4/118/7/109, measured 4/118/7/109. **Round-half-up on all four edges.** Sec.4 said floor on low edges and ceil on high edges since rev 2; wrong. The genuine asymmetry is `dim` versus index 0 in the coordinate arithmetic, which is what guide:885's "3 is needed on bottom/right where 2 works on top/left" is actually describing.

**Two rounding behaviours now measured in the same engine, and they differ:** scaling truncates (1036.8 → 1036), borders round half up (3.6 → 4, 10.8 → 11). Sec.4 carries an explicit warning against unifying them behind one helper.

**Residual closed the same day (RMSTEST_17).** All four borders set to 2 on Tiny — guide:885's exact case — gave `x 2..118, y 2..118` on both runs, precisely what the formula predicts. It also explains the guide's wording instead of merely coexisting with it: a declared 2 leaves a 2-tile gap on the low edges but only a 1-tile gap on the high ones, which is why a larger value is "needed" on bottom and right. That phrasing means the smallest integer achieving *at least* the stated gap; a declared 3 actually buys 3. **Sec.15's entire verify list — 7a, 7b, 7c, 7d — is now closed.**

**Process note: two of the four verification maps this session were confounded by something I built in.** RMSTEST_7's actor area was invisible, so the result was unreadable; RMSTEST_15's WATER base triggered an automatic BEACH ring that shifted every border by a tile. Both were caught by a sanity check rather than by inspection — the terrain totals not summing to the map area is what exposed the beach. **Add a "what must this map NOT contain" line to any future verification map, and check the totals before reading the result.**

### Item 10 — the last open engine question (2026-07-31)

**ANSWERED: no attribute is enforced during a tight group's fill.** `min_distance_group_placement` was the last plausible exception to Sec.6.6's uniform rule, because it is a different *shape* of constraint — the three already tested ask "is this tile acceptable", this one asks "is this tile far enough from other placements".

`RMSTEST_18` placed six tight groups of 49 with a declared spacing of 12, three runs. Minimum edge-to-edge gaps: **8**, 16, 34. A single sub-12 gap refutes per-member enforcement (runs 2 and 3 being far apart is just random placement), so the constraint is applied once per group. That agrees with guide:2614, "distance refers to the center of the group, not the individual members".

The rule now rests on four constraints spanning four kinds — distance avoidance, tile validity, area exclusion, inter-placement spacing. `temp_min_distance_group_placement` is untested but has an identical guide entry (guide:2635) and identical semantics apart from command scope, so it is treated as the same rather than given its own map.

Incidental confirmation: all six groups placed exactly 49 in every run, so a tight group fills completely when there is room and `groupPartial` correctly does not fire.

**Tooling:** `probe_scenario.py --clusters` added. Group membership is not stored in the scenario file, but a tight group is contiguous by definition, so connected components recover the groups and make inter-group spacing measurable. Validated against RMSTEST_8's known single group of 25 before use.

**With this, every engine question raised by the Phase 4.1 verification programme is closed.** Sec.15's remaining items (1, 2, 3, 5, 6, 8) are calibration knobs and UI decisions, none of which need the game.

### Method notes from the whole verification programme

Worth keeping, because the same failure recurred three times and was never in the reasoning.

**Every failure was in the instrument, not the analysis.**

1. A diagnostic filter of `RMSTEST_[0-9]_[a-z]+\.rms` silently dropped `RMSTEST_2_circle0.rms` — `circle0` contains a digit — and the missing output was read as the parser being silent on `circle_radius 0`. Manufactured a phantom bug that did not exist.
2. A candidate scan for BUG-003 required `len(arguments) >= 2`, on the theory that only a trailing argument can be omitted. That excluded every single-argument attribute, which is where all five real cases lived. It returned three candidates and looked authoritative.
3. RMSTEST_16 reported per-edge *insets* rather than raw coordinates. The inset conversion `(dim-1) - max` silently committed to one of the very things under test, so the true rule arrived at the comparison disguised as something no candidate model predicted.

The third is the instructive one. Insets were chosen *because* they are in the same units as the border attribute, on the reasoning that comparing like with like avoids off-by-one errors. It did the opposite. All four candidate models shared that conversion, so no possible observation could have distinguished "my rounding model is wrong" from "my conversion is wrong" — four rows sharing an assumption test one thing, not four.

**Standing rules that came out of it.**

- Record the rawest available observation and derive comparisons downstream. The probe prints both coordinates and insets for this reason.
- "Matches none of the candidates" is diagnostic information. When a well-designed discriminator matches nothing, something upstream of the comparison is far more likely to be wrong than the engine doing something exotic.
- Measure a *counted* quantity, never a *grown* one, when the question is arithmetic. Elevation overshoots ~3%; that made the first scaling test unreadable.
- State what a verification map must NOT contain, and check totals before reading a result. RMSTEST_15's WATER base triggered an automatic 432-tile BEACH ring that shifted every border by a tile; it surfaced only because the terrain counts did not sum to the map area.
- Two of nine verification maps were confounded by something built into them by their author. Neither was caught by re-reading the script.

### Sec.15 tidy-up and session close (2026-08-01)

**Item 6 DONE.** `MAP_SIZES` reordered so Huge (240) precedes Giant (252) — the names mislead, the dimensions do not. Display order only: nothing indexes the array, and the strings are the persisted values under `MAP_SIZE_KEY`, so existing settings still load. Added a comment recording that dimensions deliberately are **not** duplicated there; they live in `predefinedLabels` and the preview resolves size to dim through that array. A second hand-typed copy is precisely how the legacy/modern label offset gets mis-transcribed, which is the trap Sec.4 spends a paragraph on.

**Items 1, 2 and 3 rewritten around the probe.** All three said "calibrate against screenshots", which was correct advice before an exact instrument existed and is now actively misleading. Item 1 now describes the measure-one-constant-per-map loop and notes that five constants have already been *measured* rather than tuned. Item 2 gains a concrete design — scatter many single-tile `create_land`s with no `land_position` and read the origin coordinates, which pins the cross-shaped exclusion boundary directly instead of inferring it from how a map looks. Item 3 notes that perimeter-to-area ratio is a workable numeric proxy for "snakey versus round", so the clumping tables are partly measurable even though the final call stays visual.

**Items 4, 5 and 8 remain open, and none of them need the game.** Item 4 (teams setting) is still the highest-priority item in the section and the weakest point in the design against goal 1. Item 5 is a 4.3 UI decision wanting real examples on screen. **Item 8 needs a decision, not a test**: PLAN.md:54's "with/without post-elevation & object passes" reads equally as S1 or S2, the spec pinned S2 on a coin-flip, and the context-sensitive "Current = stage being edited" behaviour is an extension of PLAN.md rather than a reading of it. Both want an explicit call before 4.2 wires the toggle.

**Session end state.** preview-design is at rev 6 with every engine question closed and seven measured corrections folded in. `game-constants.json` carries real extracted data. Two dev tools exist that did not before (`tools/extract-constants` completed its first successful run; `tools/scenario-probe` is new). BUG-003 is filed and partly fixed. Nine verification maps live in the DE install's `random-map-scripts` folder, each self-documenting, and they are worth keeping — several are reusable instruments rather than one-shot tests.

## RMSTEST 19 — the `#undefine` question goes to the engine (2026-08-01)

`RMSTEST_19_undefine.rms` written to the DE install's `random-map-scripts/`, following the nine-map convention from the Phase 4.1 verification pass. It asks two things at once, with independent observables so neither can mask the other.

**Q1, does `#undefine` remove a flag** — `#define TEST_FLAG`, `#undefine TEST_FLAG`, then branch on it and place 7 BOAR. Present means the directive is inert and the guide is right; absent means it works and `subsumes()` in `src/parser/validate.ts` has a false-positive path, since it skips the monotonicity check for negated guards on the grounds that definitions only accumulate. RMS0310's message would need rewriting too. A control of 5 RELIC behind a flag that is never undefined rules out the failure where the conditional simply never fires — that is the RMSTEST 7 mistake, whose observable was invisible and which RMSTEST 9 had to re-run.

**Q2, does `#undefine` consume the following token** — `#undefine base_terrain` followed by `SNOW` on its own line. A white map means the operand survived and `base_terrain SNOW` executed, so `#undefine FOO` is two statements and `language.json`'s one-argument entry should lose its `arguments` array. A non-white map means the operand was eaten and the entry is right. The observable is the whole backdrop of the map, so it needs no probe and no counting.

**Predictions recorded in the map header before the run.** Running the file through our own parser says: `TEST_FLAG` stays defined (7 BOAR), and `base_terrain` is not eaten because argument consumption stops at known command and attribute names, so it predicts white. That second prediction is a side-effect of an error-tolerance rule rather than a considered claim about the engine, which is the honest reason to test it. The parse also emits an info-level RMS0201 on the `#undefine base_terrain` line — "expects 1 argument but only 0 were found" — the arity assumption surfacing as a false complaint about a legal line.

**Writing the prediction down first is the point.** The Phase 4.1 lesson was that four rounds of critique converged on internal consistency and the thing that was wrong survived all four. A prediction recorded after the fact is not a prediction.

## RMSTEST 19 result, and the four dead strings become data (2026-08-01)

**Both questions answered, two runs agreeing exactly on everything that matters** (20398 SNOW / 338 GRASS, 7 BOAR, 5 RELIC in each; only an unidentified id-1358 count varied, 21 against 13, which touches neither question).

- **`#undefine` does nothing.** The flag it targeted still took its branch. The control fired, so the test was readable rather than merely silent. `validate()`'s `subsumes()` may keep skipping the monotonicity check on negated guards, which is sound only while definitions are irreversible, and RMS0310's wording stands. Spec Sec.11 item 11 moves from guide-sourced to engine-verified.
- **`#undefine` does not consume the following token.** `#undefine base_terrain` then `SNOW` gave a 98% snow map, so `base_terrain` survived and executed. The engine reads the line as two statements.

**Both predictions, recorded in the map header before the run, were right.** Worth noting because the value of writing them down first is exactly that it makes a wrong one undeniable, and this time neither was.

**The arity finding did not become the obvious data change.** `#undefine`'s one-argument entry is factually wrong about the engine, so the first instinct was to delete it. Measured instead: deleting it makes the operand a separate statement to our parser too, which then reports RMS0200 unknown-command on the flag name of every real `#undefine` line, `sample.rms:16` included. The array stays, with the reason written into the entry's `notes` — **it groups the line into the unit the author wrote so one RMS0310 can cover all of it, and it is not a claim about engine behaviour.** A data field can serve the tool's grouping without asserting a fact about the engine, as long as the file says which it is doing.

**The four dead attribute strings are now entries.** `min_distance`, `max_distance`, `set_position`, `percent_of_land`, each `nonFunctional: true` with `replacedBy` naming the attribute that works — `min_distance_to_players`, `max_distance_to_players`, `land_position`, `land_percent`. Previously each drew a bare unknown-attribute warning, which is wrong on its face (the engine does carry the word) and names nothing to use instead. RMS0310 now covers attributes as well as directives and renders the replacement.

Three consequences that had to be handled together, and would each have been a regression alone:

1. **A known name stops drawing RMS0200.** Adding the entries without extending RMS0310 to attributes would have made the tool go *silent* on all four — strictly worse than the warning it replaced.
2. **They must never be offered as a did-you-mean.** They are now in `attributesByName`, so without filtering, a typo of one would be "fixed" to a second dead end. `didYouMean` excludes `nonFunctional` entries from its pool outright.
3. **The prefix heuristic's exemplars moved.** The four dead strings were the motivating cases for adding prefix matching yesterday; they now resolve and never reach the heuristic. Its tests were rewritten against names the data does not carry (`max_distance_to`, `min_distance_`), which also gave the command-scoped ranking a cleaner test than it had — `min_distance_` prefers `min_distance_to_players` over the shorter `min_distance_cliffs` that `create_object` cannot take.

**Schema note:** `nonFunctional` and `replacedBy` added to the attribute definition. `replacedBy` is deliberately not `deprecated` — a deprecated command still works and the guidance is stylistic, while these never worked at all.

**Verification.** `npm test` 428 passing (up from 425). `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` clean.

**Housekeeping to be aware of:** `reference/schemas/language.schema.json` was reformatted by Prettier during this session. Content is unchanged apart from the two new properties, but the whitespace diff is large and the file is now the only Prettier-formatted JSON under `reference/` — the other four still fail `prettier --check`. Either normalise the rest or leave it; it is cosmetic, but it is a real diff to review.

## Sec.15 items 1/2/3 — instrument, test batch, and the MAP_SIZES guard (2026-08-01)

Two halves. The calibration batch is **written and not yet run**, so nothing in
`preview-design.md` changed; the `[tune]` constants are still guesses. The
`MAP_SIZES` guard is landed and verified.

### scenario-probe gains two measurement modes

`--patches TERRAIN` splits one terrain into 4-connected patches and reports
area, centroid, bounding box and circularity. `--rows TERRAIN|ELEVATION` gives a
banded row/column histogram plus the mean position on each axis.

**The connectivity difference between `--patches` and `--clusters` is a claim,
not a preference,** and it is now written into `connected_components`'s
docstring. Objects use 8 because a tight group's fill is checked against nothing
(item 10), so it is contiguous with no holes and a diagonal touch is still one
group. Terrain uses 4 because Sec.6.1/6.4 grow a clump from candidates
*4-adjacent* to owned tiles, so an engine-grown clump is 4-connected by
construction and 8-connectivity would silently merge two clumps touching at a
corner.

Circularity is `4*pi*area/perimeter^2`. Self-tested against synthetic input
before use: a solid square reads **0.785**, which is exactly the theoretical
maximum `pi/4` for a square, and a one-tile-wide snake reads **0.283**. That
separation is what makes `clumping_factor` regimes testable as an ordering
rather than as a feel.

**`--clusters` gained a guard for a silent failure it always had.** Unit
coordinates are floats and the neighbour walk steps by integer 1, so adjacency
only resolves while every instance shares one fractional offset. Filtering to a
single `unit_const` is what makes that hold, and nothing said so. If it ever
stopped holding, every object would become its own blob and "49 blobs of 1"
would read as 49 groups rather than as a broken measurement. It now prints a
mixed-offset warning instead.

### RMSTEST_20 to RMSTEST_25, six scripts covering items 1, 2 and 3

Each states its predictions in its own header before the run and names the
reading that would refute it. Twenty five generations in total; see
`tools/scenario-probe/rmstest/README.md` for the run sheet.

- **20 / 21, clumping regimes**, terrains and lands as *separate* maps. Rev 4
  corrected the land table and left its terrain twin pointing at it, which was
  the same error one level down, so testing them together would repeat it. The
  land map's real target is the 40+ directional regime, which is an invention
  built on one guide sentence and has never been seen. Its observable is
  bounding-box elongation, not circularity, because a snake and a directional
  land are both non-circular and only one is lopsided.
- **22a / 22b, elevation south bias**, a matched pair differing in exactly one
  attribute. The three candidate mean-y values are far apart and were derived
  rather than guessed: uniform **0.500**, Sec.6.2's weight **0.556** (which is
  5/9), `enable_balanced_elevation` **0.512**. A dry run of the instrument
  showed that high coverage drags the mean toward 0.5 by saturation, pulling a
  true 0.556 down to 0.543 at 34 percent coverage, so both scripts are capped
  near 14 percent and the header says why.
- **23, `border_fuzziness` penetration.** The reading that matters is f=100
  stopping at exactly the border tile, because that is a hard boundary rather
  than a distribution and an off-by-one there is worth more than the fuzziness
  constant itself.
- **24, the default player ring.** Two questions, and the second matters more:
  **what is 40 a percentage of.** "Percentage of map width" admits 48 tiles or
  24 tiles from centre on a 120 map, which are completely different maps, and
  there is currently no evidence for either.
- **25, the cross-shaped land area.** Sixty single-tile lands, so each patch is
  one origin and the centroid list is the origin scatter. The 0.35 model
  predicts zero origins in the four corner squares against about 27 for a
  uniform draw over five runs.

Attribute names in all six were checked against `language.json` before writing,
and the single-line brace form used by script 25 was checked against the corpus
first (4620 instances) rather than assumed.

**Numbering note:** the batch was drafted starting at 19, which is already the
`#undefine` test. The `rmstest/` folder was tracked with all nineteen prior
scripts; CLAUDE.md's Phase 4 row describes them only by where they are *run*
from, which is what caused the mistake. Renumbered to 20 to 25.

### `MAP_SIZES` <-> `predefinedLabels`, the join nothing was checking

`generationSettingsConstants.ts` deliberately carries no dimensions, and the
reason is stronger than "avoid duplication": **"Huge is 240" is only true in one
naming era.** `HUGE_MAP` is 220 and `MAPSIZE_HUGE` is 240. A `tiles` field would
be a true-looking statement sitting beside data that is equally true, with
nothing to distinguish them.

The split was sound and unpaid for. `validate-reference-data.mjs` had **zero**
references to `predefinedLabels`, `dimensions` is optional on `PredefinedLabel`,
and every consumer resolves the join at runtime. Four assertions added, reading
`MAP_SIZES` out of the TypeScript source the way `check-breakdown-prereqs.mjs`
already does:

1. every `MAP_SIZES` value resolves to at least one label;
2. every such label declares `dimensions`;
3. labels sharing a `mapSize` agree on the number (legacy vs modern);
4. no label claims a `mapSize` the picker does not offer (a typo there orphans
   it silently);
5. `MAP_SIZES` is still ascending by dimension.

That last one is the Sec.15 item 6 bug class. The array shipped with Giant
before Huge until 2026-08-01 and the fix was a comment; the comment is now
enforceable.

**Mutation-tested, because a check that has only ever passed proves nothing.**
All five failure modes were introduced one at a time against backed-up copies
and each produced a readable message and exit 1, for example
`MAP_SIZES is not ascending by dimension: "Giant" (252) is listed before "Huge" (240)`.
Files restored and re-verified clean afterward.

### Verification

`npm run validate:reference` passes with the new line. `npm run typecheck`
clean. `npm run lint` 0 errors (8 pre-existing warnings). `npm test` **428
passing across 16 files**, exit 0. (An earlier run this session printed 17/429;
the tree holds 16 test files and repeat runs give 16/428, so treat 17/429 as
unreliable — see the exit-0-while-erroring note below.)

**That suite run took 307 s against a normal 84 s** and still passed, Vanguard
benchmark included. Same shape as the 279 s run recorded on 2026-07-31 and more
evidence for the tracked-debt item: a wall-clock assertion on a shared machine
measures the machine. No source under `src/` changed this session except a
comment, so the 3.7x is entirely environmental.

### Open after this

Items 1, 2 and 3 stay open until the batch is generated and read. Items 4
(teams setting), 5 and 8 are untouched.

## Sec.15 items 1/2/3 — the batch runs, and two corrections from review (2026-08-01, same day)

Thirty generations of `RMSTEST_20`–`25`, plus `RMSTEST_26` written independently
to check the tool itself. Results below are per test and deliberately not pooled
across tests. **Two of the session's own claims were wrong and are corrected
first**, because both were review catches rather than things the runs surfaced.

### Correction 1 — tight group fills are 4-connected, not 8

`--clusters` used 8-connectivity, with a docstring asserting that an unchecked
fill (item 10) meant a diagonal touch was still one group. **The premise is
right and the conclusion does not follow.** A fill being unconstrained by
*attributes* says nothing about its *adjacency* rule, and the two were conflated.

RMSTEST_26 settles it. 300 declared groups of 5 gold:

| connectivity | components | sizes |
|---|---|---|
| 4 | **300** | all exactly 5 |
| 8 | 299 | one blob of **10**, rest 5 |

Exactly 300 components of exactly 5 under 4-connectivity is the declared answer.
Under 8, two distinct groups touching at a corner merged. That is the precise
failure mode the old docstring claimed was impossible. Switched to 4, with the
evidence written into `connected_components`.

**Effect on item 10, which depended on this:** RMSTEST_18 reported a minimum
inter-group gap of 8 against a declared 12. A merge can only *drop* a pair from
the gap matrix, never invent a smaller gap, so the true minimum is at most the
reported 8 and the refutation of per-member enforcement holds a fortiori. No
re-run needed.

### Correction 2 — the scripts generated cliffs

All seven carried an empty `<CLIFF_GENERATION>` header. Sec.6.3 states plainly
that a present-even-if-empty section generates default cliffs, so this was
writing a script against the spec and then violating a rule the spec states.
Cliff units are in every export (the 264–271 block: 33 in test 20, 41 in 21, 56
in 23). Header stripped from all seven.

**The terrain readings survive, and the reason is itself a finding.** Every map's
terrain histogram sums to exactly dim squared across only the terrains its
script asked for. Test 20: 36280 GRASS + nine terrains = 40000 exact. No terrain
16, no unaccounted tiles. **Cliffs went down as units on top of existing terrain
and replaced none of it**, across three maps carrying 33 to 56 cliff units.
Sec.9.7 assumes an under-cliff terrain-16 mechanic; it did not appear. Worth its
own check before Sec.6.4's "cliff tiles count as foreign terrain for spacing"
approximation is relied on.

### RMSTEST_25 — cross area: shape confirmed, constant wrong by 2x

All six runs had merges (43–53 patches against 60), so the header's own rule said
discard everything. Salvaged by filtering to unmerged patches, the modal area
being exactly 9 (the `base_size 1` stamp), giving 258 clean origins.

- **Zero** origins in the modelled 0.35 x dim corner region, against ~23 for a
  uniform draw. The cross is real.
- Observed max of min(|dx|,|dy|) = **20.5 tiles = 0.171 x dim**, and eleven of
  the twelve corner-most samples sit at *exactly* 0.171. A hard wall, not a tail.
- **20.5 is 0.342 x (dim/2).** The constant 0.35 is right; the reference length
  is wrong. Sec.6.1 applies it to dim, the engine applies it to dim/2, so our
  modelled cross is twice the engine's width.
- Symmetry control passed (mean x 0.4958, mean y 0.4924).
- The high merge rate independently corroborates a smaller placement region.

### RMSTEST_22a/22b — the control failed, and that is the result

Predicted mean x 0.500; measured **0.336**. Both axes displaced together, toward
low x and high y, which is a diagonal. The follow-up decomposition settles it:

| | mean x | mean y | mean (y-x) | mean (x+y) |
|---|---|---|---|---|
| 22a | 0.3359 | 0.6336 | **0.6488** | 0.4848 |
| 22b | 0.3499 | 0.6325 | **0.6413** | 0.4912 |

(x+y) is unbiased and (y-x) carries the whole displacement. DE renders the map
rotated 45 degrees, so the guide's "south" is a **screen** direction landing on a
diagonal of the tile array, not the +y edge. **Sec.6.2's weight is wrong in
direction, not merely in magnitude.**

And no linear weight can fit it. The diagonal's marginal is triangular rather
than uniform, which caps a linear weight at a mean of **0.583**; measured 0.649.
At 21 percent coverage saturation pulls the mean *toward* 0.5, so the true bias
is stronger still. This is a redesign, not a retune.

**`enable_balanced_elevation` does approximately nothing.** 0.6488 to 0.6413, a
0.0075 shift at roughly 2 sigma against a modelled 0.044.

Side finding: the budget overshot by **54 percent** (2000 requested, ~3080
delivered, 6.2 tiles per clump against 4 requested). Sec.6.2's ~3 percent was
measured at 829 tiles in one clump; at 4 tiles per clump there is evidently a
floor.

### RMSTEST_23 — ordering confirmed, magnitude refuted

| f | min x per run | depth |
|---|---|---|
| 0 | 63, 57, 66, 66, 81, 60 | 14.5 |
| 20 | 78, 78, 78, 78, 81, 81 | 1.0 |
| 50 | 79, 79, 80, 79, 79, 79 | 0.8 |
| 100 | 80, 80, 80, 80, 80, 81 | -0.2 |

Predictions 1, 2 and 3 hold, including f=100 stopping on **exactly tile 80**, so
Sec.4's border arithmetic is right to the tile. Prediction 4 fails: predicted
depth 3–4 at the default, measured **1.0**. Under the per-tile Bernoulli an edge
this long reaches depth 4+ nearly every run. Real behaviour is that f=0 is off
and any f>0 is close to a hard border. Rev 3's flat coin-flip was too permissive
and rev 4's per-tile rewrite still is.

### RMSTEST_24 — both questions answered

48 radii over 6 runs, mean **50.44 tiles**, sd 7.11, on dim 120.

- **Radius is a percentage of FULL map width.** 42.0 percent measured against
  candidate A's 48.0 tiles (delta +2.4) and candidate B's 24.0 (delta +26.4).
  40 is a good default and slightly low.
- Variance is real but **smaller than modelled**: sd 7.11 implies a uniform
  half-range near 12.3 tiles, about 10 percent of width, against the modelled 20.
- Eight patches every run.
- Angular gaps 53.9, 40.2, 49.9, 39.2, 43.4, 44.2, 51.0 — mean 45 degrees with
  roughly plus or minus 7 spread, so there is **angular jitter Sec.6.1 does not
  model**.

### RMSTEST_20 — the bucket model is the wrong shape

| cf | -5 | 0 | 3 | 5 | 8 | 15 | 20 | 25 | 40 |
|---|---|---|---|---|---|---|---|---|---|
| circularity | 0.035 | 0.068 | 0.128 | 0.172 | 0.217 | 0.272 | 0.222 | 0.217 | 0.268 |

Negative is dramatically snakey and clearly separated. But cf 0 to 15 is a
**smooth near-linear ramp with no step at the guide's 5 boundary**. The header's
prediction 4 said in advance that a smooth ramp means the bucket model is the
wrong shape and a continuous weight is closer to the engine. It ramped smoothly.
Above 15 it plateaus around 0.22–0.27, so the clamp claim roughly survives.

### RMSTEST_21 — the 40+ directional regime does not exist

| cf | patches | area | circ | aspect |
|---|---|---|---|---|
| -5 | 6.0 | 366 | 0.074 | 1.60 |
| 0 | 3.0 | 475 | 0.099 | 1.25 |
| 8 | 1.0 | 633 | 0.265 | 1.50 |
| 25 | 1.0 | 631 | 0.391 | 1.38 |
| 40 | 1.0 | 637 | 0.384 | 1.24 |
| 60 | 1.0 | 639 | **0.394** | **1.05** |

cf 60 is the **roundest** land of the six, not an elongated one, and cf 40 and 60
are indistinguishable from cf 25. Sec.6.1's "extends in one direction away from
the origin" row, and the per-land preferred-direction model built on it, has no
support and should fold into the rounder row.

**The cf -5 and cf 0 rows are unreliable and the cause is unknown.** They came
back in 6 and 3 pieces. Cliffs are ruled out (S3 post-dates land growth and they
replace no terrain). Overwrite by another land is ruled out (origin stamps
precede growth, and growth rejects already-owned tiles). A land grown by
4-adjacent frontier sampling cannot fragment, so either something else edits
land terrain or **negative clumping is not frontier expansion at all**, which
would be a finding about Sec.6.1's growth model rather than about its table.
Needs a dedicated single-land map before anyone concludes anything.

### Still open

The spec edits are NOT applied. Five corrections are queued (Sec.6.1 cross
reference length, ring variance and angular jitter, border fuzziness strength,
the clumping tables, and Sec.6.2's axis) and the Sec.6.2 one is a redesign that
should not be improvised into the doc.

## Install-wide scan of the official DE scripts (2026-08-01)

Ran `parseRms` + `validate()` over all **276 script files** in
`resources/_common/drs/gamedata_x2` — 179 `.rms`, 16 `.rms2`, 81 `.inc`,
including the `includes/` subfolder that `test-maps/local/`'s 19-map sample
never covered. 6,051 raw diagnostics. Report for the DE developers written to
`../de-official-map-issues.md` (parent folder, deliberately outside this repo).

The two scratch instruments were deleted after use. Both were vitest files under
`src/parser/__tests__/` so they could import the parser directly; neither is
worth keeping as a gate, because the input is a game install that CI does not
have.

### What the scan is worth to the project

**Every candidate was opened in the source and confirmed by reading before it
entered the report.** The tool's own known false-positive families were
subtracted first (BUG-004's `avoidance_distance`, BUG-003's optional trailing
arguments, BUG-002's opaque identifiers, `circle_radius 0`). What survived is
roughly 60 confirmed defects: a 457-site `set_loose grouping` typo across three
Battle Royale maps, a duplicated `elseif INDOMALAYAN_TROPICAL` in
`includes/gaia_civilisation.inc` that makes three civilisations unreachable on
55 scripts, `Arabia.rms`'s `percent_chance` chain summing to 130, and the
`#const PREDATOR_A`-written-twice template bug across 27 maps that
`RMS0301`'s execution-path amendment had already found on the local sample.

**Two instrument lessons, both worth more than the findings.**

1. **A parser diagnostic about *structure* needs an independent check before it
   is reported.** `RMS0101`/`RMS0105` flagged unclosed `{` in
   `GeneratingObjects.inc` and `Megarandom.rms2`. A separate brace counter (strip
   nested comments by whitespace-delimited token, then count) agreed on the
   arithmetic — 192 `{` against 190 `}` — and reading the source showed **both
   are correct and neither is a defect**: the files use one `{` per `if` branch
   with a single shared `}` after the `endif`, so the braces balance at runtime
   and only ever look unbalanced statically. That is Sec.5.3's interleaving case
   seen from the other side. Dropped from the report. `Continental.rms`'s missing
   `endif` survived the same treatment and is real (9 `if`, 8 `endif`).
2. **A second instrument that shares no data with the first is what makes an
   absence claim safe.** Alongside `validate()`, a label-pairing pass collected
   per file the names a script `#define`s but never tests against the names it
   tests but never defines. It needs no reference data at all, so it is immune to
   the negative-authority trap — and it found the `PH_TROPICALSOUTH` /
   `PH_TROPHICALSOUTH` family that `RMS0300`'s edit-distance-1 rule misses at
   distance 3. Its own false positives (`THEME_MANGROVE` against
   `TREE_MANGROVE`, `MAPSIZE_*` against `scaling.inc`'s `MAPSIDE_*` constants)
   were removed by hand, not by widening a filter.

### Doc updates landed

- **`parser-design.md` Sec.11 items 19–24**, six new verify-in-game questions, each with a live official specimen rather than a constructed one: `#define`/`#const` symbol-table sharing, nested `start_random` semantics, the `set_scale_by_size`/`set_scale_by_groups` mutex against 194 official co-uses, three documented ranges that shipped scripts exceed, the completeness of the predefined condition-label table, and what the engine does with a bare value inside a block.
- **Sec.11 item 8 promoted.** "Conditionals spanning section headers" had "zero corpus occurrences" against it. `Continental.rms` is now a live specimen with a binary observable needing no instrument: play it with Infinite Resources and look for cliffs.
- **Sec.13 item 5 retracted.** It said do *not* add `avoidance_distance`, resolved as a Pa_Site author bug. 320 uses in three official maps says otherwise, and `known-issues.md` BUG-004 had already said otherwise months of sessions ago. Two docs in this repo held opposite conclusions and neither was reconciled — the same failure BUG-005 is about, one level up. `building_architecture` (72 uses) and `temp_min_distance_to_players` (1) recorded alongside it.
- **BUG-005's 2.5%-signal measurement qualified.** Over the DE install RMS0200 is **~59% true positives**, because shared-template typos live in include-heavy official scripts. Piece 3 of its prescribed fix — soften to info when a file has any `#include_drs` — would have buried the `capture_relic.inc` and `water_blending.inc` findings. Flagged for reconsideration; piece 1 is unaffected and is what surfaced all 563.

### Also noted

`random_map.def` ships in that folder and is the authoritative predefined-constant
source Sec.13 item 3 names as the tie-breaker. It is 1,251 lines of `#const`, it
is right there, and nothing in the project reads it yet.

## Sec.15 — the six corrections land in the spec, and item 5 gets its redesign (2026-08-01, same day)

All six queued changes applied to `preview-design.md`. Items 1, 2 and 3 of Sec.15
close; three new items open (11, 12, 13) for residuals that are real questions
rather than loose ends.

### The four constant-level corrections

- **Sec.6.1 cross.** `0.35·dim` becomes `0.35·(dim/2)` = `0.171·dim`. The constant
  was right and the reference length was wrong, so revisions 3 through 6 drew a
  cross twice the engine's width.
- **Sec.6.1 ring.** Radius 40 confirmed as a percentage of **full** map width
  (measured 42.0%), settling an ambiguity that admitted 48 or 24 tiles on a 120
  map. Variance 20 halved to **10**. **Angular jitter of ±7° added** — a degree
  of freedom no revision had.
- **Sec.6.1 border fuzziness.** The per-tile Bernoulli is gone. `f = 0` switches
  borders off; any `f > 0` is very nearly a hard stop, with a single fringe tile
  accepted at `(100−f)/100`. `f = 100` stopped on exactly tile 80 in five of six
  runs, so Sec.4's border arithmetic is right to the tile.
- **Sec.6.1 / Sec.6.4 clumping.** The 40+ directional row is deleted from the
  land table — `cf 60` produced the roundest, least elongated land of six. Both
  bucket tables become continuous weights, saturating near `cf 15` rather than
  the guide's 25.

### Sec.9 item 7

Caveat added: the under-cliff terrain-16 mechanic **was not observed**. Three
exports carrying 33–56 cliff units each had terrain histograms summing to exactly
dim squared with no terrain 16. Not simulating it costs nothing, but Sec.6.4's
cliff-spacing approximation was justified *by* that mechanic, so it now needs its
own test (item 12).

### Sec.6.2 — the redesign, item 5

Two errors compounded, and neither was a magnitude:

**Wrong axis.** DE renders the map rotated 45 degrees, so the guide's "south" is
a screen direction that lands on the `y − x` diagonal of the tile array, not the
`+y` edge. Measured mean x came back 0.336 against a predicted 0.500. Decomposing,
`x + y` is flat at 0.95–1.06 of the map average and `y − x` carries the entire
displacement.

**Wrong shape.** Dividing band size out to get the per-tile selection rate gives
a **step**, not a ramp:

| `y − x` | −15..−1 | 0..14 | 15..29 | 30..44 | 45..59 | 60..74 |
|---|---|---|---|---|---|---|
| rate vs map average | 0.09 | 1.36 | 1.96 | 2.05 | 2.10 | 2.14 |

Normative form is now two integer weights: **18 where `y ≥ x`, 1 where `y < x`**;
**12 and 1** with `enable_balanced_elevation`. Fitted two independent ways that
agree — band rates give ~20:1 and ~15:1, and fitting a step to the *mean* of
`y − x` alone gives 17.7:1 and 12.1:1.

**Why tuning could never have rescued the old model.** A linear weight on `y − x`
has a hard ceiling of 0.5833 for the mean, because that axis has a **triangular**
marginal over a square grid rather than a uniform one. Measured 0.6488. No value
of `k` in `100 + k·y/(dim−1)` reaches the observation. That is precisely what
separates a calibration item from a redesign.

`enable_balanced_elevation` **softens the bias but does not remove it** — the
rev 6 model had it reducing a 2:1 ramp to 1.15:1; the truth is 20:1 to 12:1.

Also folded in: the elevation budget overshoot is **per clump with a floor near 6
tiles**, not a percentage. 2000 tiles across 500 clumps delivered ~3080, 54% over,
against ~3% for a single 829-tile clump.

### Method notes worth carrying forward

**The failed control was the finding.** RMSTEST_22's `mean x` was included purely
as a sanity check on an axis nobody had questioned. It failing is what exposed
the rotation. A control that can only ever confirm is not worth printing.

**A per-run pass/fail gate can be stricter than the data requires.** All six
RMSTEST_25 runs "failed" their own header rule (43–53 patches against 60). The
contamination was separable — filter to unmerged patches, the modal area being
exactly the `base_size 1` stamp — and 258 clean origins came out of six discarded
runs. Check separability before discarding.

**Every one of the four constants was wrong in kind, not in magnitude,** and in
three of four the error had survived multiple rounds of critique. `border_fuzziness`
is the sharpest: two successive rounds of careful reasoning about a distribution's
shape moved the answer toward the truth and stopped far short of it. One map
settled it.

### New items

11. Sec.6.2's disfavoured half has an internal gradient running the wrong way
    (0.09 next to the diagonal, 0.21 in the far corner), and the measurement is
    one map size with no player lands — whose `≥9 tiles from origins` exclusion
    sits on a circle that crosses the diagonal.
12. Sec.9.7 / Sec.6.4 cliff-spacing justification, above.
13. The `cf −5` land that came back in six pieces.

### Verification

`npm run validate:reference` passes. `npm run typecheck` clean. `npm run lint` 0
errors. `npm test` **428 passing across 16 files**. No `src/` behaviour changed
this session; the only source edit is a comment plus the `MAP_SIZES` guard in
`scripts/`.

**A test-harness problem surfaced while confirming that, and it is worse than
the flaky benchmark already tracked.** Three runs of the unchanged suite gave
three answers:

| run | files | tests | errors | exit |
|---|---|---|---|---|
| 1 | 17 | 429 | — | 0 |
| 2 | **9** | **61** | **7** | **0** |
| 3 | 16 | 428 | — | 0 |

Run 2 loaded seven fewer test files, never executed 367 of 428 tests, printed
`Errors 7 errors`, and **still exited 0**. It happened while background scenario
parsing was saturating the machine, so it is load-dependent. The exit code is
what CI branches on, so **a green `npm test` is not by itself evidence the suite
ran.** Added to CLAUDE.md tracked debt with the expected counts, since the fix is
a floor assertion on file count rather than anything in the tests themselves.
Run 1's 17/429 is unexplained and the tree holds 16 test files; it is recorded
as unreliable rather than reconciled. **Confirmed independently on Ash's
machine: 16 files, 428 tests, 150 s**, which is what makes the expected counts
usable as a check. Note the duration spread on identical code — 150 s locally
against 90–307 s in agent sessions — which is further evidence for the
wall-clock benchmark item directly below it in tracked debt.

---

## Phase 4.3 — Sec.15 item 4: the teams setting (2026-08-01)

Closes the highest-priority open item in `preview-design.md` Sec.15. The spec was
rewritten first and reviewed before any code was written, because Sec.3.1's teams
paragraph was a *pinned* premise that this work retires, and CLAUDE.md's "design
specs are authoritative" rule makes silently contradicting it the wrong order.

### The model

Per-player **selected** team, `0 | 1 | 2 | 3 | 4`. `0` is un-teamed and is the
engine's own value for it, not a UI placeholder — `assign_to`'s `AT_TEAM`
argument documents "0 is for un-teamed players" (guide:1002). The picker shows
it as `-`. The cap of 4 is the label vocabulary's cap.

Two guide rules drive everything downstream, and both are easy to read past:

1. **Team numbers in labels are lobby order, not the picked number** (guide:1000,
   3121, 3151). So `1,1,4,4` canonicalises to `1,1,2,2`. Skipping this step is
   correct on a plain 2v2 — the configuration anyone tests by hand — and wrong
   in any lobby that picks a high number first.
2. **A team of one is not a team** (guide:1004, 3115). A 1v1 therefore reports
   **zero** teams, and `0_TEAM_GAME` is what a 1v1 defines.

`src/generationSettings/teamModel.ts` holds both as a pure function with no
React/Tauri imports, so the Phase 4 preview worker imports the same code rather
than growing a second copy of the rule.

### The teamSize enumeration is not irregular — and the check that showed it

`language.json`'s 29 `teamSize` entries each carried a note calling the guide's
enumeration irregular (`TEAM1_SIZE1` absent while `TEAM0_SIZE1` is present) and
recording it as transcribed-as-written rather than completed by inference. That
was the right call when written and it is a misreading.

Enumerating which of the 45 candidate `TEAMn_SIZEm` names are **reachable** under
"a real team needs ≥2 members, team 0 is the un-teamed remainder, ≤8 players"
returns **exactly** the 29 the guide lists. Nothing present-but-unreachable,
nothing reachable-but-absent. `TEAM2_SIZE7` is missing because team 1 would then
need 2 more for 9 players; `TEAM4_SIZE3` because 2+2+2+3 is 9.

**Note the shape of the argument**, because CLAUDE.md forbids the lazy version:
this rests on a *predicted set matching an observed set*, not on any single
name's absence. One name missing proves nothing. Exactly the sixteen a rule
predicts, and no others, is a measurement. Notes rewritten to derived-and-checked.

### Verification

`npm run validate:reference` passes (incl. the ui-help schema for the three new
entries). `npm run typecheck` clean. `npm run lint` 0 errors, 1 pre-existing
react-refresh warning on the context file. `npm test` **436 passing across 17
files** — up exactly one file and eight tests from the recorded 16/428 baseline,
with no `Errors N` line, which is what makes the green meaningful per the tracked
harness debt.

**The label-existence check was mutation-tested rather than trusted green.**
Relaxing the ≥2 rule to `< 1` in `canonicaliseTeams` turned it red, and it named
precisely `TEAM1_SIZE1`, `TEAM2_SIZE1`, `TEAM3_SIZE1`, `TEAM4_SIZE1`,
`TEAM4_SIZE3` — the reachability analysis and the guide's enumeration confirming
each other from opposite directions. Restored after.

That test also reproduced the `lexer.test.ts` trap on first write: an `expect()`
per label across 15,625 lobbies timed out at 10 s. Collecting misses and
asserting once took it to 594 ms. **A loop must measure the code, not vitest.**

**Not verified: the UI on screen.** The app needs the Tauri runtime to mount, so
a browser-only vite preview renders an empty root and cannot exercise the
control. `npm run tauri dev` on Ash's machine is the real confirmation.

### New Sec.15 items opened by this work

14. **What zone does `set_zone_by_team` give an un-teamed player?** The formula
    (`TeamNumber − 9`) would put team 0 in zone −9, which is *player 1's own
    default zone* — merging every un-teamed player's land with player 1's and
    with each other's, so an FFA map writing `set_zone_by_team` becomes one
    landmass. Sec.6.1 pins the graceful alternative (keep `playerNumber − 10`)
    explicitly as a **choice, not a measurement**. Needs one map.
15. **Does `grouped_by_team` space teams evenly around the ring, or space players
    evenly and reorder?** Guide:356 pins the intra-team spacing (`2·base_size`)
    and says nothing about the ring. The readings diverge sharply at 5v1v1v1.

### Same session — BUG-004 closed as not-a-bug (2026-08-01)

Queued `avoidance_distance` as the next item on the strength of `known-issues.md`
BUG-004 and `parser-design.md` Sec.13 item 5, both of which had it as real RMS on
a 320-use install count. Ash challenged it from memory of the *original*
conclusion ("we ascertained it was not real RMS"), which turned out to be
correct and traceable: Sec.13 item 5 had said "do NOT add — resolved as a
Pa_Site author bug", and the 2026-08-01 overturn struck it through.

**Checking the overturn instead of defending it produced three findings.**

1. **The cited source does not contain the claim.** Both docs attribute the 320
   figure to the install scan at `../../de-official-map-issues.md`. That file has
   **zero** mentions of `avoidance_distance`. The number was reproduced
   independently here and is accurate — but it was unsourced in the repo.
2. **The three "independent" scripts are one template.** `Shipwreck.rms`,
   `Kilimanjaro.rms`, `fortified_clearing.rms` share an identical `CIRCLE_*`
   constant block (`48/48/89`, `56/17/89`, `18/113`), and `Pa_Site_v1.1.rms` is a
   derivative of the same block. 320 uses are one observation repeated, and "two
   Forgotten Empires maps" is one FE circle-generator copied twice.
3. **All 320 pass `CIRCLE_AVOIDANCE`, which is `#const CIRCLE_AVOIDANCE 0` at all
   three definition sites.** Install-wide: no literal, no other constant, no
   non-zero value anywhere. An argument of 0 is a no-op whether or not the engine
   implements the attribute, so **no shipped script can distinguish a real
   attribute set to zero from a token the engine discards.**

That is the fingerprint of a dead token propagated by copy-paste, which is what
the original finding said. BUG-004 closed as not-a-bug; Sec.13 item 5 rewritten
with the reasoning rather than just the verdict, since the bullet has now been
written three times and the middle one was wrong.

**Knock-on correction.** BUG-005's composition table wrote those 256 warnings off
as "False. See BUG-004". They are now *undetermined*, which moves its
signal-to-noise estimate from 2.5% to as much as 32% and creates an awkward fact
worth holding while deciding RMS0200's wording: the clause most criticised in
that entry — "the engine will silently ignore it" — is plausibly **accurate** on
the check's single largest input.

**`building_architecture` was wrongly grouped with it** ("same shape, same fix
needed"). Its argument varies meaningfully — 52 uses of `2` against 20 of `1`
across the two Battle Royale maps. An author distinguishing two values is using
something they believe works. It stays a genuine candidate; `avoidance_distance`
never was.

**Rule added to CLAUDE.md: a count is not a conclusion.** Frequency measures how
often a line was copied, not how often anyone decided. Before a usage count
becomes evidence, check that the uses are independent and that at least one of
them could have been observed to matter. Both checks were available here and
neither was run, in an entry whose whole argument was a number. Same family as
"prefer an observable to an argument" — and note the failure direction is
symmetric to Sec.15 item 4's finding earlier the same day, where a *predicted*
set matching an *observed* set was legitimate evidence. The difference is
whether the observation could have come out otherwise.

**No code or data changed.** `language.json` is untouched; the 256 warnings stand
pending the RMS0200 wording decision (BUG-005).

### Same session — Sec.15 item 8 (Current/Final) answered by Ash

Decided in conversation while triaging the next item, and recorded here because a
decision given verbally that never reaches the spec is a failure mode this
project has already paid for.

**Current = the script truncated at a pinned line**, i.e. "generate as if
everything after this line were commented out". A pin button sets the cut point
explicitly so it holds while the author keeps editing and scrolling; unpinned it
follows the cursor.

**The question as posed was malformed.** Sec.5 framed a binary — S1 (before the
elevation pass) versus S2 (after elevation, before objects) — and revisions 3
through 6 argued it as a coin-flip on PLAN.md:54's wording. Both readings assume
Current selects a *stage snapshot*. It does not: a truncated script is a **prefix
of the source**, not a point in the pipeline, so neither answer was right and the
ambiguity never needed resolving.

Two consequences folded into Sec.5, both of which the snapshot model hides:

1. **Current needs its own generation run**, not a stored snapshot — truncating
   the source changes every later stage. Cheap at the Sec.11 budget (≤40 ms) but
   it is a second run, so it shares the ~300 ms debounce and is skipped on Final.
2. **Truncation is AST-level, not text-level.** Cutting mid-block leaves an
   unterminated `create_land {`; the prefix runs to the last complete top-level
   item at or before the line, and a cursor inside a block includes that block.
   Text-level cutting would flicker between valid and broken on every other line.

New HelpTip id `preview.pinLine` added to Sec.5's mandatory list.

**Third instance of the same pattern this project keeps hitting**, and worth
naming: Sec.6.6's grouping-scope table and Sec.6.2's elevation axis both survived
multiple rounds of careful argument because the argument was inside the wrong
frame. **When a question has resisted several rounds of good reasoning, suspect
the question.**

## BUG-002(b) — `$`-prefixed names are a build artefact, not RMS (2026-08-02)

Closed as not-a-bug, with the sign reversed: the 35 `RMS0202` warnings this
sub-item filed as false positives are **correct**.

`$` is not RMS syntax. It is the substitution sigil of an external preprocessor
the authors build their scripts with, and every site is one where substitution
never ran before the file shipped. The lexer is whitespace-delimited so
`$heightLow` arrives as an ordinary `word`, the engine resolves it to some token
ID per Sec.2.1, and a numeric slot gets a meaningless magnitude. The maps are
broken at those lines.

### Why the entry got it backwards

The argument was "it appears in a DE-official map *and* a community map,
therefore it is fully supported syntax". Four things falsify it, and none needed
the game:

- **35 occurrences are 3 sites.** `height_limits $heightLow $heightHigh` ×8 and
  `set_avoid_player_start_areas $SpawnAvoidance` ×9 in `Acclivity.rms`;
  `number_of_objects $infinite` ×10 in `TL Team Acropolis.rms`. Each is one
  block repeated per player or per distance band.
- **The two files are not independent.** Acropolis is "modifed by Zetnus", the
  author of the guide this project transcribes; Acclivity is by Chrazini. Both
  open with the same `#define THEME_AUTUMN` / `#define COLLAPSE` vocabulary.
  Shared toolchain is what that co-occurrence predicts.
- **Acclivity's header carries a second version stamp** — `Version: 2.6` and
  `BSV: 9.1.1` two lines apart. A file that records the version of the thing
  that built it is a build artefact.
- **The names break RMS house style.** camelCase among SCREAMING_SNAKE, and
  `$infinite` is a symbolic stand-in for a number, which RMS cannot express and
  a preprocessor has every reason to.

This is the `avoidance_distance` independence failure again, in a doc that
already carried the rule. Added to Hard rules as its own bullet, because the new
half is specific: the corpus contains build outputs, so "a shipped map does X"
is not automatically a claim about the engine.

### Changes

No code, no data. `docs/known-issues.md` BUG-002 retitled to one remaining
cause, (b) rewritten as closed, and the verification baseline corrected — **the
target is 26, not 0**, since (b)'s 35 must survive any fix to (a). A run that
takes corpus RMS0202 below 26 has broken something.

Also rejected: a dedicated "unexpanded template variable" diagnostic. Three
sites in two files from one toolchain is too thin to earn a code, and the
message would assert something about an authoring pipeline seen only
indirectly. Revisit if `$` shows up in an unrelated ecosystem.

## BUG-002 closed in both halves, and a data-loss incident (2026-08-02)

Two findings and one self-inflicted wound. The wound first, because its lesson
is the more expensive one.

### `git checkout --` destroyed ten days of uncommitted `language.json` work

A python round-trip re-serialised `language.json`; `git diff` showed +1080/-29
and that was read as formatting churn from the script. It was not. This tree
carries ~90 modified files and weeks of uncommitted work, so `git diff` compares
against a HEAD from 2026-07-22 and the +1080 was the accumulated *real* work
being shown for what it was. `git checkout -- reference/data/language.json`
then discarded all of it: 138 `predefinedLabels`, the six BUG-003 `optional`
flags, the `base_elevation`/`create_elevation` range fix, four `nonFunctional`
attributes, two engine-verified note rewrites. 2951 lines to 1947.
`validate:reference` went to 9 errors.

Recovery, in the order the avenues were eliminated: `dist/` and the Vite cache
predate the work; Documents is not OneDrive-redirected; File History is off; VS
Code local history held only Jul 26 snapshots; no transcript contained a
full-file Read. What worked was VSS.

**The first snapshot was a trap worth recording.** Snapshot 13 (Aug 1 12:53:38)
looked ideal and returned a 119,236-byte file whose first **114,688 bytes were
NUL** — and returned it identically through two unrelated read paths, which is
what ruled out the read and indicted the snapshot. `language.json`'s last write
was 12:51 and two agent sessions were editing it at 12:53: VSS caught the file
mid-rewrite, with the length extended but the data still in the write cache, and
NTFS reads allocated-but-unflushed regions as zeros. **A shadow copy taken while
a file is being written is not a backup of that file.** Snapshot 12 (Jul 31
23:59:13), 22 hours clear of any write, came back clean.

Snapshot 12 predates three Aug 1 edits. Those were recovered verbatim by mining
the 25 session transcripts for writes to the file — and the delta had to be
computed from record **timestamps**, not file mtimes, which differ by up to 36
hours here and initially put six Jul 31 01:28 edits on the wrong side of the
cutoff. A json round-trip was checked byte-identical on the recovered file
before replaying anything, so the replay introduced no churn.

Restored to 2963 lines: `validate:reference` green, `typecheck` clean,
**17 files / 436 tests passed** with no `Errors` line.

Rule added to CLAUDE.md, stated as an absolute because there is no safe version
of it in this repo: never run a tree-restoring git command here; undo an edit
with the edit tools.

### BUG-002 (b) — `$`-prefixed names are a build artefact

Filed as "unmodeled DE templating syntax, therefore supported". They are
unexpanded variables from a preprocessor the authors build with, so the maps
ship broken at those lines and the 35 warnings are **true positives**. Four
things falsify the original argument, none needing the game: 35 occurrences are
3 copy-pasted template sites; the two files are not independent (one is
"modifed by Zetnus", the guide's own author, and both share a
`#define THEME_AUTUMN`/`COLLAPSE` vocabulary); `Acclivity.rms`'s header carries
`BSV: 9.1.1` beside its own `Version: 2.6`, and a file recording the version of
the thing that built it is a build artefact; and the names are camelCase with
`$infinite` standing in for a number, which RMS cannot express.

### BUG-002 (a) — the opaque-identifier idiom was a deleted `#const`

`AK_Vanguard`'s 26 uses of an undefined `ACT_AREA_TEAM_RES_TERRAIN` were read as
a deliberate Sec.2.1 token-ID handle. An `identifier` argument type was designed,
scoped to four slots, approved, and half-built on that reading.

The map's author recalls no idiom — they recall a workaround for something not
working, and probably deleting the `#const`. The file agrees: lines 35-37 are a
blank-line-delimited block of exactly three `ACT_AREA_*` constants, the file uses
four names from that scheme, and eleven of the twelve actor-area identifiers in
the map are either `#const`s or bare numbers. Line 1434 has a commented-out
`avoid_actor_area`, so the region was being hand-edited. "It works" had never
been observed, only inferred from the map having shipped.

`identifier` reverted from `language.ts`, `language.schema.json`,
`formatStyle.ts` and `validate.ts`. **Kept:** `create_actor_area`'s data, which
guide:1982 sources independently — real argument names (`X Y Identifier Radius`)
replacing an `a`/`b`/`c`/`d` stub. Its note now draws a distinction the stub
invited readers to miss: `create_actor_area` areas are hoisted before every
`create_object`, but areas defined by the `actor_area` *attribute* are built as
their objects are placed (guide:2782's "first object successfully created" only
means anything if they are progressive), so `avoid_actor_area` can reference the
former from anywhere and the latter only after placement.

**RMS0202's remaining 61 corpus warnings are now a regression baseline, not a
number to drive down.** A change that takes it below 61 is suppressing real
findings.

### The pattern, which is the point

Three items in one session were filed as false positives on evidence that was
one observation wearing a plural — 320 `avoidance_distance` uses that are one
template, 35 `$` uses that are three, 26 uses of one name in one file. Each then
attracted a mechanism plausible enough to survive review, because a mechanism
that explains the data feels like evidence for it. None needed the game to
refute: one needed the file headers read, one needed the author asked.

## BUG-005 piece 1 — RMS0200 stops asserting engine behaviour (2026-08-02)

`unknownName` had said `Unknown <context> "X" — the engine will silently ignore
it.` since the parser was built. The second clause is a claim about the engine
whose entire evidence is the name's absence from `language.json`, which is the
thing CLAUDE.md's positive-resolver rule forbids. It fired **858 times** on the
52-file corpus, the largest single diagnostic source in the tool.

Split by evidence rather than softened wholesale:

| branch | count | message |
|---|---:|---|
| did-you-mean fires | 272 | unchanged — a near-miss is positive evidence |
| no suggestion | **586** | `Age of RMS doesn't recognise the <context> "X".` |

The 581 `L` warnings — the Sec.2.1 token-ID alias idiom, a spec-sanctioned v1
limitation rather than a defect — are the bulk of what got softened, which is
the right target.

**Mutation-tested, per the hard rule.** Two assertions in `parser.test.ts` pin
the two branches. Reinstating the old string was confirmed to turn the
no-suggestion assertion red with a readable failure before the fix was restored.
The message had no test at all before this, which is how a string contradicting
a hard rule survived four months.

`rms0200.measure.test.ts` is kept as the repeatable instrument; it reproduces
this entry's 858 and its composition exactly rather than trusting the figure.

### The measurement undercut the fix's own rationale

Piece 1 kept the confident wording where a did-you-mean fires, on the stated
grounds that a near-miss is positive evidence of a typo. Measured, that branch
is **256 of 272 `avoidance_distance`** — matched by *suffix* against
`other_zone_avoidance_distance`, not by edit distance, and the one name BUG-004
closed as not-a-typo and explicitly undetermined. The retained behavioural claim
now sits almost entirely on the case we decided we cannot judge.

Recorded in BUG-005 with two candidate follow-ups (restrict the confident
wording to edit-distance matches; or drop the clause from both branches). Not
improvised here, because the prescribed fix said piece 1 and this is a fourth
piece. **Third time `avoidance_distance` has distorted a conclusion in that
file** — it is worth treating any argument that leans on it as suspect by
default.

Pieces 2 (`L` aliasing) and 3 (severity) remain open and are spec changes.

### Also this session

Nine `RMSTEST_27`-`33b` scripts written for the remaining game questions
(negative `circle_radius`, items 11-15, and the RMS0304 section-lock blocker),
validated against `language.json` so no misspelled attribute silently no-ops.
Run sheet in the rmstest README, split into batch 1 (run) and batch 2 (pending),
with the teams-setup caveat flagged up front.

Three doc-drift fixes: Sec.6.1 quoted `circle_radius 0`'s inherited variance as
guide:849's ~20 while RMSTEST_24's measurement three bullets above says ~10;
Sec.15 item 4 still said "code pending" for a control shipped 2026-08-01; and
Sec.15 item 7's residual was already closed by RMSTEST_17.

The `npm test` expected-counts row in CLAUDE.md is now 18 files / 439 tests, with
a note to update it whenever a test file lands — a stale row there reads as the
silent-skip failure and costs an investigation.

### Same session — `building_architecture` added, and `npm test` given a floor (2026-08-02)

**`building_architecture` is in `language.json`** (`verified: false`, one integer
argument, no declared min/max since only 1 and 2 are attested). It selects the
architecture set a **Gaia-placed building** is rendered with — cosmetic, so
Sec.9 item 5 already excludes it from the preview and nothing downstream needs
it. Recovered from the install: 72 uses across `BR_BattleontheIce.rms` and
`BR_FallofRome.rms`, always inside `create_object` on building-type objects with
`set_gaia_object_only` (STABLE/STRANGETRADE/ARCHERY_RANGE/BARRACKS → 2,
GUARD_TOWER → 1), never on units, trees or resources.

**Sharpening of the earlier claim, because the first version was loose.** The two
maps have *identical* usage counts (11/10/10/4/1), so they are one template
copied — the same lineage pattern as `avoidance_distance`, and "two maps" was
never two decisions. What separates them is that the value **varies by object
within the single template**, which means someone chose it and could have seen
the result. `avoidance_distance` passed a constant defined as `0` in all 320
uses, which no observer could ever have distinguished from a discarded token.
The evidence is within-template variation, not file count.

Verified by mutation, not by assumption: removing the entry produced 36 RMS0200
per map (72 total, matching the independent count); restoring it produced zero.

**`npm test` now enforces a floor** — `scripts/check-test-floor.mjs`, wired as
the `test` script. It runs Vitest with the JSON reporter alongside the default
one and fails if fewer than 17 files / 436 tests ran, or if Vitest's own exit
code is non-zero. `npm test <path>` passes through and skips the floor (a
filtered run legitimately executes a fraction); `npm run test:raw` is plain
`vitest run`.

Three things worth keeping:

- **Mutation-tested both directions.** Floor raised to 99 → exit **1**; restored
  → exit **0**. The first attempt at checking this read `$?` after a pipe to
  `tail` and got *tail's* status, reporting a misleading 0 — the exit code is the
  entire point of the guard, so it had to be measured without a pipe.
- **File count is `testResults.length`, not `numTotalTestSuites`.** The latter
  counts `describe` blocks: one file with three describes reports 3. Using it
  would have made the guard pass on exactly the partial runs it exists to catch.
- **The floor is a floor, not an equality**, so adding tests never fails it. Left
  at 17/436 against a current 18/439 deliberately: `rms0200.measure.test.ts` is
  self-described scratch and may be deleted, and a guard that breaks when someone
  removes a scratch harness would get disabled.

**Concurrent-session note.** Another session was editing this repo during the
above — `diagnostics.ts` (BUG-005 piece 1 wording, citing the `avoidance_distance`
finding from earlier today), `parser.test.ts`, and a new
`rms0200.measure.test.ts`, all timestamped mid-session. One `npm test` run failed
with exit 1 mid-write and passed cleanly on re-run, which is worth knowing before
reading that failure as a regression. **`known-issues.md` BUG-005 still lists
piece 1 as prescribed-and-not-done while the code now implements it** — that
entry needs reconciling by whoever owns that work.

---

## Phase 4.3 — batch 2 read, four answers and three re-tests (2026-08-04)

Batch 2 (`RMSTEST_27`–`33b`) generated and read with `tools/scenario-probe`.
Four questions closed, three could not be read, and **every one of the three
failed for instrument reasons rather than for want of data** — each script
measured something other than what it was written to measure.

### Closed

**Item 12 — cliffs do count as foreign terrain, and the 2026-08-01 caveat was
an artefact.** Ash supplied the mechanism from guide:1325: terrain 16 "turns
into the map's base_terrain prior to `<OBJECTS_GENERATION>`". A scenario export
is taken after the pipeline, so **the probe cannot see terrain 16 by
construction**, and six exports showing none of it is exactly what the guide
predicts. Reading that as evidence against the mechanic was inferring from an
instrument blind to the quantity — the positive-resolver rule one level up.
guide:1539 states the consequence directly, and RMSTEST_31 measured a minimum
cliff-to-SNOW distance of **7 against a declared spacing of 6** across three
runs at 8.2% SNOW density with 143–180 cliff units. Sec.9 item 7's caveat
withdrawn; Sec.6.4 needs no rescue; stage order confirmed. New detail for
Sec.6.5: guide:1326 puts the revert before `<CONNECTION_GENERATION>`, so the
pathfinder sees `base_terrain` under cliffs.

**Item 13 — Sec.6.1's growth model is refuted, and the finding is larger than
the item.** `cf −5` fragmented into 3/5/4 pieces and the `cf 0` **control**
fragmented into 4/4/1. A 4-adjacent frontier cannot fragment, so this was never
a negative-clumping special case. Comparable piece sizes at `cf −5`
(215/204, 182/132, 175/154) point at multiple scattered seeds grown separately.
Totals 386–439 against a declared 400 rule out early termination; no
`<CLIFF_GENERATION>` header rules out cliffs. Sec.6.1's growth paragraph now
carries a blocking warning. The seed count is unmeasured and is 4.3 work.

**RMS0304 — the engine does enforce sections.** `create_terrain` in
`<OBJECTS_GENERATION>` and `create_object` in `<TERRAIN_GENERATION>` each
produced **nothing**, three runs apiece, while `base_terrain` applied normally
— one command discarded, not a failed generation. So a misplaced command is a
real defect and RMS0304 is a warning, not a style hint. **But it must be driven
by a measured per-command `sectionLocked` flag, not `CommandDef.section`**: the
52 corpus `effect_amount` hits are a standing counter-example from working maps,
so a blanket rule rebuilds the false-positive class BUG-002 and BUG-005 already
cost three rounds.

**Negative `circle_radius` is a third behaviour** (RMSTEST_27, five runs, 34
origins): mean radius 33.2 tiles = 27.6% of dim, CV 0.44 — against the default
ring's 50.4 / 0.14 and 24 / 0 for an absolute-value reading. Scattered rather
than annular, centre-biased relative to uniform. The convenient answer, folding
it into the `0`-disables branch, was recorded as the prediction *because* it was
convenient, and it is refuted. `radiusPercent` min widened 1 → −50, guarded by
`src/parser/__tests__/circleRadius.test.ts` and mutation-tested against the old
bound (0 and −20 go red at min 1; the out-of-range control stays green in both,
so the range check is not merely disabled).

### Could not be read, and why — the pattern is the point

**Item 14 (`RMSTEST_29`).** Eight separate patches, three runs, initially read
as confirming Sec.6.1's pinned zone choice. **It does not.** Ash's observation:
two hypotheses predict eight separate patches — the pinned `playerNumber − 10`
(zones −9..−2) and a plain `TeamNumber − 9` in which solo players still carry an
engine-internal team number (zones −8..−1). Both give eight *distinct* zones.
B is not in conflict with a team of one failing to register in
`TEAMn_SIZEm`/`PLAYERx_TEAMy` — those report what the *lobby* sees, a zone is an
internal growth property, and they may disagree. The run also had **no
instrument control**, so nothing proved `other_zone_avoidance_distance` was
working. What survives: the single-merged-zone reading is refuted.

**Item 15 (`RMSTEST_30`).** First attempt had no teams set at all. Second had
teams correct but ran **4v4 three times** — the configuration the script itself
names as non-discriminating. Its bimodal gaps looked like reading A and are
unsafe: no `circle_radius` means the default ring's own variance and ±7° jitter
apply, and `base_size 8` merged 8 lands into 4–6 patches, which manufactures
~90°/135° gaps out of a 45° ring. **Both defects bias toward the reading already
modelled** — the shape of error that confirms what you expected.

**Item 11 (`RMSTEST_32`).** Ratio 2.25/2.40/2.08 ≈ 2.24:1 against Tiny's 18:1,
stable across three distinct maps — but the run changed map size **and** added
player lands in one step, and the eight exclusion discs sit on a ring crossing
the diagonal being measured. Confounded, not wrong.

**Procedural, and it nearly cost the run: `RMSTEST_32`'s first attempt exported
the same generated map three times.** The md5s differed — a scenario file embeds
its own filename — while the whole probe output was byte-identical. A hash is
not the duplicate check, because it is sensitive to metadata the measurement
never reads. Check that a headline count varies run to run.

### Batch 3 written

`RMSTEST_34_zonerange` (item 14 — probes zones −9 and −1 with distinct terrains,
plus a `zone 5` control the first attempt lacked; no teams needed),
`RMSTEST_35_elevnolands` (item 11 — changes only the map size against 22a), and
`RMSTEST_36_groupedclean` (item 15 — `circle_radius 40 0` and small lands turn
the reading into a patch count; **must run 4v4 and 5v1v1v1**). Run sheet in the
rmstest README. Eight generations.

### Same session — batch 3 read: items 11 and 15 close, 14 fails again (2026-08-04)

**Item 15 — ANSWERED, reading A, and the discriminator was decisive.**
`RMSTEST_36` with `circle_radius 40 0` and small lands. Three runs at 5v1v1v1
gave one packed arc of five spanning 24–32°, three lone players, and **four
groups at 89–91°** — 360/4 — with every origin at radius 79.6–80.7 on an 80-tile
ring. Five runs at 4v4 gave two clusters of four at 176–180°. So **the ring is
divided by GROUP count, not player count**, and a solo player takes a full slot.
The competing reading (eight players at 45°, merely reordered) predicts uniform
spacing and no merging; refuted.

New open number: **intra-team spacing is not `2·base_size`.** guide:356 gives 6
tiles at `base_size 3`; measured consecutive-teammate spacing was 10–12, roughly
3.5–4×. Centroids of grown lands are not origins, so it needs a run across
several `base_size` values — and note a ~2× error on a reference length is
exactly what RMSTEST_25 found in the ring's radius.

**Item 11 — ANSWERED, and it replaces Sec.6.2's model rather than tuning it.**
`RMSTEST_35` (200, no player lands) gave **7.16:1**, against Tiny's 18:1 and
200-with-player-lands' 2.24:1. Both size and player lands matter, and one
mechanism explains all three: **the ratio decays with `|y − x|`** — ~12:1 beside
the diagonal, ~1.9:1 in the far corner. RMSTEST_22a's band table spans only
`y − x` = −15..+74 on a 120 map, i.e. the near-diagonal region, so **18:1 was
never wrong for what it sampled — it was extrapolated.** A larger map holds
proportionally more far-region area, which drags the pooled ratio down with no
size term required. Player lands cost a further 3× on top, so the `≥9 tiles from
origins` exclusion and the diagonal bias do not compose independently.

**Item 11(a) reproduces and does not close.** The disfavoured half's wrong-way
gradient climbs 0.008 → 0.063 outward (8×) at a second size in a clean run.
Spillover is ruled out — clumps growing across the line would raise the
disfavoured density *nearest* the diagonal, and the measurement shows the
opposite. No mechanism proposed. It is no longer a ~6% curiosity; it is the
shape of the whole rule.

**A reading error worth keeping.** The first pass at 11(a) used raw counts per
diagonal band and found no gradient, which would have closed the item as a Tiny
artefact. The bands have very unequal areas — 4675 tiles against 300 — and
normalising by tiles-available reversed the conclusion entirely. RMSTEST_32's
earlier "noisy and inconsistent" band profiles were the same mistake.

**Item 14 — failed a second time, and this failure was self-announced.**
`RMSTEST_34` returned every probe **including the control** at 17–21 tiles from
the player lands; nothing separated them. Its own prediction 4 had stated the
reason in advance: **sharing a zone only PERMITS contact, it does not compel
it**, so a randomly placed probe has to happen to grow beside the one player land
it might share with, and never did. The script was built on the luck-dependent
half of its own instrument after the header had identified that half as weak.
**A test whose header names its own failure mode should be redesigned before it
is run.** It also aimed a probe at `zone -1` as "player 8's zone under B" while
pinning nothing about where player 8 was — unreadable in principle.

Replaced by **`RMSTEST_37_zoneforced`**: `direct_placement` pins player 1, probes
sit at fixed 22-tile offsets, both probes target player 1 (zone −9 under A, −8
under B), plus a `zone 5` control. Contact and non-contact are both forced by
geometry, so a null result means something. Three runs, plain FFA, no lobby.

Also verified: an instrument check of my own was wrong first time. RMSTEST_35's
three exports were flagged as duplicates by a terrain-only content hash — but
that script varies only ELEVATION on a uniform GRASS map, so terrain was
identical by design. Re-hashing on elevation showed three distinct maps
(2433/2479/2535 elevated tiles). **Hash the quantity the measurement reads.**

**Two test-harness findings surfaced while gating the above, and the floor guard
earned itself.** One `npm test` came back `only 12 test files ran, expected at
least 18; only 151 tests ran, expected at least 440` — the load-dependent
partial run the guard was built for, caught with the numbers named instead of
passing silently. A second run then failed differently: full counts, but
`rms0200.measure.test.ts` **timed out against Vitest's 5 s default**, taking
6.3 s inside the suite against 3.5 s alone. It walks and parses all 52 corpus
maps and had no timeout allowance. Given a 30 s timeout — it is a reporter with
no assertion worth timing, so the headroom costs nothing. Same defect class as
the Vanguard benchmark already in tracked debt: **a wall clock on a shared
machine measures the machine.** Suite green afterwards at 19 files / 443 tests.

### Same session — item 14 ANSWERED, and the 2026-08-01 pin was wrong (2026-08-04)

`RMSTEST_37_zoneforced`, five runs, five distinct maps, unanimous:

| probe | zone | min distance to player 1's land, runs 1–5 |
|---|---|---|
| DESERT | **−8** | **3, 1, 4, 3, 1 — contact** |
| DIRT | −9 | 12, 12, 12, 12, 12 |
| DIRT3 | 5 (control) | 12, 12, 12, 12, 12 |

The `−9` probe and the control are identical to the tile in every run, and the
`−8` probe is plainly different. So **an un-teamed player carries an
engine-internal team number of their own** and `set_zone_by_team` gives player
`k` zone `k − 9` — occupied set `{−8..−1}`. No special case. Sec.6.1 rewritten.

**The error matters more than the result.** The 2026-08-01 revision pinned the
opposite ("un-teamed keeps `playerNumber − 10`") by reasoning that team 0 would
compute to −9, collide with player 1's default zone, and collapse an FFA map
into one landmass — then choosing the graceful alternative to avoid that. **The
premise was false**: an un-teamed player is not team 0 for zoning purposes, so
no collision was ever possible. The literal reading of guide:1056 was right, and
the rev-6 text that pin replaced already said `k − 9`. A fallback chosen to
avoid a failure mode nobody demonstrated is still a guess — added to Hard rules.

**Zones and labels disagree about solo players, and both readings are now
measured.** `TEAMn_SIZEm`/`PLAYERx_TEAMy` place a lone player in team 0 (the
≥2-members rule, evidenced by the reachable-set match on 2026-08-01); the zone
treats them as their own team. Lobby-visible against internal. Ash raised this
distinction before either was measured and both halves held.

**Three attempts, and the failure modes were structural rather than unlucky.**
RMSTEST_29 could not discriminate — both hypotheses predict eight separate
patches — and had no control. RMSTEST_34 placed probes at random and returned
every probe *including the control* at 17–21 tiles, which its own prediction 4
had described in advance as the likely null. **A test whose header names its own
failure mode should be redesigned before it is run**; also added to Hard rules.
RMSTEST_37 forced the geometry with `direct_placement` and fixed offsets, and
aimed both probes at the one player whose position was pinned.

**Sec.15 is now closed except item 5 (a 4.2 UI call) and item 11(a).**

### Same session — item 11(a) decomposed, item 5 deferred, item 16 opened (2026-08-04)

**Item 11(a): the outward gradient is mostly a MAP-EDGE effect, found by
re-analysing exports already in hand rather than by another sitting.**
Controlling density for distance-from-nearest-edge splits what the `|y − x|`
banding had mixed:

| `|y − x|` 0–39 | interior (edge ≥45) | near edge (<20) |
|---|---|---|
| favoured | 0.117 | 0.099 |
| disfavoured | **0.004** | **0.027** |
| ratio | **29 : 1** | **3.7 : 1** |

The discontinuity is sharp in the interior and soft near the boundary, and
essentially all of that sensitivity is on the disfavoured side. Tiles at large
`|y − x|` are *necessarily* corner tiles, so the far bands were pure edge — that
is the bulk of the "wrong-way gradient". A weaker `|y − x|` term of ~3–5×
survives inside a fixed edge column, so both are real.

**This removes the size term rather than explaining it, and corrects what this
log said earlier today.** RMSTEST_22a's bands span `y − x` = −15..+74 — near the
diagonal, mostly interior — so its 18:1 belongs with the 29:1 interior cell.
**22a and RMSTEST_35 measured different regions of the map, not different
sizes.** The intermediate reading (bigger map, proportionally more weak-ratio
area) had the right instinct and the wrong variable: Tiny has *more* near-edge
area than Normal, 55.6% against 36%, which would push the pooled ratio the other
way. Do not model a size term. Player lands remain a separate real effect.

Still open, and the question is now much sharper than "why does density rise
outward": **why does the ratio soften from 29:1 to 3.7:1 within ~20 tiles of the
boundary?** Spillover is ruled out — clumps growing across the line would raise
disfavoured density nearest *the diagonal*, and it is raised nearest *the edge*,
including in far corners with no favoured tile within 100 tiles. Next test is
the same script at a second size reading interior and edge ratios **separately**
rather than pooled; that is the first thing in this whole batch that genuinely
needs another sitting.

**Item 5 — deferred to 4.2, deliberately.** The question is what a rendering
looks like and there is no rendering. Deciding now would repeat exactly what
cost item 14 three test maps. Recorded with its inputs so it can be settled
quickly once 4.2's fixture puts a real failure on screen, and noting that
**nothing is blocked**: Sec.7 already carries everything a marker needs, so this
is a rendering choice rather than a contract change. Item 16 raised the stakes —
fragmented lands render as plausible small blobs, not as visible failures.

**Item 16 opened: Sec.6.1's land-growth model needs rebuilding.** This existed
only inside item 13's struck-through text and a warning box, with no tracked
entry — the largest open 4.3 task was effectively invisible. Now stated with its
evidence (`cf 0` control fragmenting), what is unmeasured (seed count and its
relation to `clumping_factor`), what survives a rewrite (weight buckets, the
guide:927 regimes, round-robin turns), and a one-sitting test shape.

### Same session — item 16 ANSWERED by a parameter sweep (2026-08-04)

`RMSTEST_38_clumpsweep`, six lands on one Ludicrous (480) map, one per
`clumping_factor` value, six exports of which **five are distinct** (runs 2 and 3
are the same map — the recurring duplicate-export trap, harmless here since the
pattern is unanimous). Bounding boxes never overlapped, so the one-map shortcut
held and the no-interaction assumption is checked rather than assumed.

| `cf` | −20 | 0 | 8 | 20 | 40 | 100 |
|---|---|---|---|---|---|---|
| pieces | 6–10 | 1–5 | 1–2 | **1** | **1** | **1** |
| circularity | 0.133 | 0.181 | 0.360 | 0.409 | 0.428 | 0.463 |
| tiles vs 400 | **−6.5%** | +4.6% | +3.3% | +3.2% | +3.6% | +4.1% |

**Piece count falls monotonically and reaches a hard 1 by `cf 20`** — fifteen
consecutive single-piece generations — which is inside the corpus's own common
band of 15–25, so ordinary maps never fragment. Identical under 8-connectivity.

**This is the cheap outcome.** `clumping_factor` sets how strongly growth prefers
candidates adjacent to the existing mass; below ~20 the `neighborsOwned = 0`
bucket carries weight and the land may place a tile detached from itself, seeding
a new component. **Weight buckets, the guide:927 regimes and round-robin turns
all stand** — Sec.6.1 needed one bucket added, not a rebuild. The expensive
alternative (growth not frontier-based at any setting) is refuted.

Two findings came free. At `cf −20` growth **fails its tile budget** by 6.5%
(one run 15% short) while every other setting overshoots by the familiar +3–4.6%
— a real `growthShortfall`, not rounding. And **`cf 100` is accepted, not
clamped**, which matters for the 18 corpus maps that write exactly that against
a community-reported maximum of 99.

**The method lesson, and it is the reusable part.** Items 13 and 16 both rested
on runs at `cf −5` and `cf 0`. Both sit at the spindly end of a range running
−100 to 99, so fragmentation looked absolute rather than graded, and the model
looked *refuted* rather than *mis-parameterised* — a much more expensive
diagnosis than the truth. **Two points at one end of a range are not a
measurement of the range.** What prompted the sweep was an hour of reading the
public record: nobody has published the algorithm, but AoK Heaven's Cartographer
thread reports negatives giving "super spindly" lands and near-+100 giving
"clumped and roundish" ones. That single sentence is what turned a from-scratch
rebuild into a one-line bucket change.

**Also checked and worth recording as a near miss:** the community's "spindly"
description raised the possibility that the fragmentation was a *4-connectivity
artefact* — a diagonal snake splits under 4-connectivity and holds under 8. It
is not; the pieces stay separate under both. That alternative would have
invalidated items 13 and 16 entirely and was never tested until the search
suggested it.

**Sec.15 now has one open item — 11(a)** — plus item 5, deliberately deferred to
4.2. Every other question an export can answer is closed.

### Item 11 closed, and Sec.6.2's model replaced (2026-08-05)

`RMSTEST_41a/b/c` swept clump count at a fixed 6-tile budget and confirmed the
density relationship. The matched pairs are the result: 250 clumps at 4.14%
coverage gives **3.74** against 50 clumps at 3.29% giving **1.41**, and 1000
clumps at 20% gives **14.88** against 50 clumps at 13% giving **2.08**. Matched
coverage, five and twenty times the clumps.

The strongest single number is the same-count pair: **500 clumps at 6 tiles gives
7.01 against 500 clumps at 4 tiles giving 7.16** — a 2% difference across a 50%
budget change and 46% more coverage, from independently written scripts four days
apart. Clump count drives the ratio; the budget does not.

Above ~250 clumps the relationship is proportional, `ratio ≈ 585 × clumps/area`,
constant 582 ± 17 across four points. Below that it flattens to the seed-bias
floor of 1.3–1.9.

**Sec.6.2 rewritten.** The "step with weight 18 vs 1" is withdrawn. Seed
placement is **1.31:1** and flat against distance from the map edge; every
previous figure (18:1, 20:1, 12:1 balanced, 7.16:1, 29:1 interior) was measured
over elevated tiles, which are seeds convolved with growth and merging. There is
no border rule, no per-band table and no size term.
`enable_balanced_elevation` reduces the ratio by 4.6%, not from 20:1 to 12:1.

**Five hypotheses tested and rejected**, each with its refuting measurement
recorded so they are not re-tread: biased growth, coverage, map size, seed
exclusion near the border, and spillover across the diagonal.

**The mechanism of the density scaling is unknown** and is recorded as unknown.
The naive expectation runs the other way — clumps under a spacing constraint
should push overflow into the disfavoured half and lower the ratio. It rises,
monotonically, across a twentyfold range.

**Written up as `docs/elevation-bias-study.md`**, a standalone report with the
raw data, the decomposition and its consistency check, the refuted hypotheses,
the fitted model and its limits. Added to CLAUDE.md's design-docs table.

**The method lesson, which cost six sittings.** Every round until the last
measured a downstream quantity and inferred an upstream rule from it. Elevated
tiles are not seeds. The change that resolved the item was lowering the clump
count until each connected component was one seed, so the quantity being
measured was the quantity being modelled. **Measure the stage you intend to
model.**

### Housekeeping, and the tracked-debt items that were actually small (2026-08-05)

**`corpus.test.ts`'s Vanguard benchmark is no longer a wall clock.** It asserted
`elapsed < 500` and went red twice on 2026-07-31 on code that does not touch the
parser's hot loop. The threshold is now relative: parse a 20 KB slice 20 times to
price one token on today's hardware, then require the full benchmark's per-token
cost to stay within 8× of that. Super-linear behaviour still trips it; a loaded
machine scales both sides and does not. **Mutation-tested** — ratio 8 → 0.3
turns it red. This is what spec Sec.9 asked for in the first place: catch a
complexity regression, do not measure a duration.

**`test-maps/broken/` created and the BCC2 triage closed.** `BCC2-Rekawa.rms`
moved there with a README stating the tier rule. Its glued `}8050` at line 891
makes RMS0101 fire **by design**, so the diagnostic is correct and the file was
never a candidate for the zero-error allowlist; leaving it beside the clean maps
implied the parser was wrong about it. It stays in tier 1 (no throw, coverage and
span-fidelity) and remains the RMS0101 fixture.

**That move broke a gate, which is the useful part.** `lexer.test.ts`'s
offset-exactness property check reads five corpus files by name and one of them
had just moved. Caught by the suite, fixed to the new path, and deliberately
still reading the file: offset exactness must hold on malformed content too, so
a known-defective file is exactly what belongs in that list.

**`src/smoke.test.ts` deleted**, superseded by the real suites.

Suite is now **18 files / 441 tests** (was 19/443). Floor lowered to **17/438** —
it had been 18/440, which after the deletion sat one test below live and would
have gone red on any further removal.

### BUG-003 closed: RMS0201 triaged to a baseline of 32 (2026-08-05)

Every one of the 35 remaining RMS0201 warnings was read individually against the
guide. **3 were false positives and are fixed; 20 are true positives and stay;
10 are UNDETERMINED and deliberately still warn; 2 are a different defect and
moved to BUG-005.** Corpus RMS0201 is now **32, and that is a floor, not a
target** — the same regression-baseline shape BUG-002 closed in. **No
`language.json` change survived the session.**

**The main result is a mistake this session made and then caught, and it is more
useful than the fix would have been.**

`ai_info_map_type.showType` was marked `optional: true` and **reverted the same
day**. The evidence was 52 three-argument uses across 52 distinct DE-official
files spanning 20+ map types — genuinely independent, not a copy-paste artefact,
and it passed every check this project had written down. It was still wrong.

**A shipped map is not a specification.** The engine passes malformed lines
silently, the affected code never takes effect in game, and nobody finds out.
This same session measured `set_loose grouping` 457 times across three official
Battle Royale maps and `set_scale_by_group` 96 times in DE's own
`includes/water_blending.inc`. Official authors ship bugs at scale.

The check that was missing is not independence, it is **observability**: could
anyone have noticed if the form were wrong? guide:475 lists `showType` **not
functional on DE**, so the three- and four-argument forms are indistinguishable
in game. No shipped script could ever have revealed which is correct, and 52
independent authors each dropping a trailing no-op argument looks exactly like 52
independent authors correctly omitting an optional one. Same shape as
`avoidance_distance`, which CLAUDE.md already had a rule about — and that rule
was quoted in the entry while this was being written.

Independence answers "is this one observation?". It does not answer "could this
observation have come out the other way?". **Both are now Hard rules.**

**Three of the 35 were our own fixture.** `test-maps/sample.rms` is a
hand-written Phase 1.4 highlighting demo that predates the parser and had never
been read by it. It wrote `create_elevation` and `create_terrain` with their
required arguments missing, and put `terrain_type` — a land-generation attribute
— inside `create_terrain` blocks where `base_terrain` belongs. It has sat in
`corpus.test.ts`'s `ZERO_ERROR_ALLOWLIST` the whole time, which is not a
contradiction: that gate checks zero *errors*, and RMS0201 is a warning. **A
Phase-1-era fixture is an untested assertion about the language.**

**The result that generalises, and it inverts the prescribed fix.** The entry
told the next session to sweep `language.json` for trailing arguments carrying a
documented `default` and mark them optional, calling the sweep "mechanical".
**Do not.** A documented `default` licenses nothing on its own:

| | guide notation | guide sentence saying it may be omitted? | verdict |
|---|---|---|---|
| the five fixed 2026-07-31 | `default: N` | **yes** — e.g. guide:2719 "**No argument**, or a value of 0 imposes no further restrictions" | omissible |
| `terrain_cost.TerrainType` | none at all | no | **required** |
| `ai_info_map_type.showType` | `default: 0` | **no** | **UNDETERMINED — left required** |

**Look for the sentence.** When there is none the answer is UNDETERMINED, and
undetermined means leave the data alone and write down why. It does not mean fall
back to counting shipped maps — that is the trap the top of this entry describes.

**The `#const` bucket's 2026-07-31 guess was right and worth recording as a
process win.** It read "almost certainly not optionality — more likely the Sec.6
stop set. Investigate before touching data." All 16 were the stop set, splitting
15 true positives (Mont Saint Michel writes `#const SIZE` with no value, 15
times, one pasted pattern) against 1 false positive. A mechanical sweep would
have silenced 15 real map bugs. **A bucket flagged "investigate before touching
data" is worth the investigation.**

**Two warnings moved rather than closed.** `24hr_Battle Lines 1.0.rms:93` writes
`#const restricted_terrain_distance max_distance_to_other_zones` under a
`/* parameter renames */` comment. That is Sec.2.1 token-ID aliasing — the same
idiom as BUG-005's `L` — and it fires because the aliased-to name is a known
attribute and therefore in the Sec.6 stop set, so `#const`'s value consumption
stops before reaching it. `optional` cannot reach it and the stop set is spec, so it
belongs to BUG-005 piece 2's decision — **same principle, different code path.**
The principle is that a `#const` may alias any name, so a known name in an
unexpected position may be an alias rather than a mistake. The paths diverge:
`L` is an unknown word at statement position followed by `{` (RMS0200, Sec.5.4);
this is a known attribute name landing in `#const`'s value slot and terminating
consumption (RMS0201, Sec.6). One ruling governs both, but they are two edits.

**Adjacent gap, found and not filed.** The parser does not check that an
attribute belongs to its enclosing command; `terrain_type` inside `create_terrain`
drew nothing. Same family as the unbuilt RMS0304 section-lock check and it needs
the same treatment — measured per-command data, never a blanket rule.

**Verification.** New reporter `src/parser/__tests__/rms0201.measure.test.ts`
prints every RMS0201 by file, line and source line, splitting `.rms` from
`.rms2` so the "which half of the corpus" trap this entry already caught twice
cannot recur silently. It is a reporter and stays off the floor. The gate is five
assertions in `parser.test.ts`, pinned in both directions: `require_path` proves
the `optional` mechanism still works on a case the guide states outright,
`terrain_cost` and `create_terrain` prove a missing required argument still
warns, and `ai_info_map_type`'s three-argument form is pinned **as warning** with
a comment saying it is undetermined and must only ever be changed from a game
measurement, never from a recount of shipped maps.

The `optional`-flag mechanism was mutation-tested while the `showType` flag was
briefly in place: removing it turned the legal-omission assertion red with a
readable message while the counter-tests stayed green. The flag was then
reverted, so what the suite pins today is the undetermined state.

Suite is now **19 files / 447 tests** (was 18/441). Floor raised to **17/442**,
which is live minus the two deletable scratch harnesses and a little slack.

## Phase 4.1 rev 7 — the critique round rev 6 needed (2026-08-05)

An independent review of `preview-design.md` rev 6 (`docs/preview-design-rev6-review.md`), verified claim by claim before acting, then folded in. **No measurement from rev 6 was overturned.** Every RMSTEST result held; the sourcing layer held (43 guide citations resolved, one off by a line, every repo `file:line` exact). What failed was edit discipline, and the shape of the failure is worth more than any single fix.

**Verified independently before editing anything**, because a review is a claim like any other: the corpus cliff scan (comment-aware — two of five hits are inside `/* */` blocks and do not count), `eslint.config.js` and `ci.yml` in full, `predefinedLabels`' `playerInTeam` grid, the guide's own Conditionals enumeration at 3121–3191, guide:994–1016 for `assign_to`, guide:927 and 1646–1648 for both `clumping_factor` entries, `generationSettingsConstants.ts:89`, `validate-reference-data.mjs:182` for the mapSize dimension join, and every corpus count. Three review claims needed correcting and are noted below.

**The blocker that was not one, and it is this session's own worst error.** The review reported six DE-official maps writing `min_length_of_cliff` 1 or 2 against a documented minimum of 3, and described `Fortress.rms` as "a shipped official map whose entire identity is cliff-walled player bases". On that basis Sec.6.3's zero-cliffs rule was withdrawn to `[verify]`, an interim per-draw model was invented, and `language.json`'s `min_length_of_cliff.min` was widened 3 to 1 as an RMS0203 false positive.

**The characterisation is false.** Fortress is known for its starting stone walls, castle and towers, not for cliffs — caught on review. Correcting it inverts the finding rather than weakening it. `Fortress.rms:748` declares `min_number_of_cliffs 5` / `max_number_of_cliffs 10` with `min_length_of_cliff 2`, so if the map shows no cliffs then that live unconditional block is a **natural experiment confirming guide:1366**. Six official maps with dead cliff sections is an ordinary outcome for a copy-pasted block; it is not the anomaly it was read as.

**All three changes reverted the same day.** The rule is restored as the working model and keeps a verify slot (item 17b) — it is unmeasured and it silently suppresses a whole section, which is worth one map to confirm, and `Cliffbound.rms` is on the sub-3 list with a name that claims cliffs, so it is the cheapest thing to look at first. The data bound is back at `min: 3` carrying a `notes` entry that says it is deliberate, because the next reader will otherwise re-derive the same wrong fix.

**The distinction that was missed, and it matters beyond this attribute.** `circle_radius 0` and `base_elevation 0` are documented as **functional** — 0 disables circular placement, 0 means not-elevated — so warning on them was a false positive. A sub-3 cliff length is documented as **non-functional**, so `RMS0203` there is a **true** positive telling the author their section does nothing. CLAUDE.md's *a documented range is not an accepted range* cuts both ways, and "shipped scripts use it" is not evidence that it works: six scripts using an inert value are six scripts with an inert section. The corpus tells you what authors **wrote**, never what the engine **did** with it.

**And the transferable one: a claim about a well-known artefact is itself an observable.** The false premise was about a map that ships with the game, was checkable by loading it or by asking anyone who plays, and was instead carried from a review into a spec and a data file. It flipped a blocking finding. The session verified the review's *citations* scrupulously — line numbers, corpus counts, comment-stripped scans — and did not verify its one claim about the world.

**Three more blockers, all the same failure — a withdrawn rule still standing elsewhere in the same document:**

* **Goal 5 was guarded by a lint rule that did not exist.** "No `Math.sin`/`cos`/`pow`/`sqrt` — same lint rule" and Sec.14's "CI-greppable" both referred to nothing: `eslint.config.js` is 28 lines with no `no-restricted-*` of any kind, and CI runs lint, typecheck, test and validate:reference with no grep. The exact config is now normative, lands with `rng.ts` rather than "in 4.3", and is mutation-tested three ways in Sec.13. It also closes an **older** gap nobody had noticed: CLAUDE.md's hard rule that `src/parser/**` and `src/breakdown/patch/**` import no React/Monaco/Tauri has been unenforced since it was written.
* **Sec.5 still closed with the snapshot model its own DECIDED block deletes.** Under a do-not-deviate banner the implementer got both readings and no tiebreak — the preamble's body-beats-appendix rule does not reach a body-against-body conflict, so the preamble now carries one that does (the dated statement wins). The same edit found the snapshots **orphaned**: after the Current/Final decision nothing read S1 to S5, leaving an 8 MB budget and the API's only cost knob pointing at no consumer. Sec.2 now names the 4.2 stage scrubber, because "the field exists and nothing reads it" reads as an oversight and gets deleted.
* **Sec.6.1's bucket-0 repair was inert.** Item 16's fix was written as "the `neighborsOwned = 0` bucket exists", but the frontier is *defined* as candidates 4-adjacent to owned tiles, so that bucket is unreachable by construction: an implementer following the normative growth paragraph rebuilds the pre-item-16 model and never sees the `cf −20` fragmentation. The missing piece was never the weight, which is fittable, but the **candidate source**, which is not. Respecified as a per-land detached-seed reservoir, O(1), compatible with Sec.11.

**Where the review was wrong, or not right enough** — recorded because taking a review on trust is the same mistake as taking the guide on trust:

* It proposed emitting `borderBlocked`/`zoneAvoidanceBlocked` from S1's origin-rejection path "per rejected candidate". That would put tens of thousands of records into a report 5.2 aggregates by count. The emitters are S6's `min_distance_to_map_edge` and `avoid_other_land_zones`; region stages roll their rejections into one `growthShortfall` carrying the dominant blocker, which is what the disjointness rule already said.
* It proposed asserting **set equality per label category** in Sec.13 test (5). That would simply go red — `playerInTeam` emits 34 of 40 by design under the current rule. Written instead as equality for three categories and equality-minus-an-explicit-six-name-list for `playerInTeam`, which goes red precisely when the numbering rule changes, which is the point.
* It said goal 4's "with cancellation" should be struck and Sec.11's "cancellable" fixed. Half right: per-run cancellation is genuinely withdrawn, but a 1000-run **batch** is cancellable between runs, that loop is ours, and CREATION_PLAN 5.2's UX asks for it. Both now say which they mean.
* On `playerInTeam` it offered two readings and left them level. Checking the guide makes the finding sharper: it **enumerates both lists name by name** in adjacent paragraphs (3121–3150, 3151–3191), and prunes the `teamSize` one meticulously enough to drop `TEAM2_SIZE7` (which needs noticing that team 1 costs two players). An author that careful would have pruned six names from the grid if step 3 were the rule. And there is a numbering rule under which **all 40 are reachable** — order surviving groups by ascending *selected* number rather than by lowest player number. Note `teamSize` reachability is identical under both, so the 29-name match is evidence for the "at least 2 members" rule and evidence for step 3 under neither.

**So Sec.15 is reopened**, items 17 to 20, after being closed for one day. 17a (team numbering) is the one to run first: it either strengthens a rule that is already a CLAUDE.md hard rule, or invalidates `teamModel.ts` and every label the preview derives. It needs a lobby, not an instrument.

**Also found, and not in the review:** guide:1016 says an **assigned land ignores `land_position`** and takes a ring slot unless `direct_placement` is set — read backwards, that is a whole-layout error on every map using the idiom, and Sec.6.1 stated the neutral-land rule without the carve-out. `assign_to` now has its own bullet covering all three targets, negative targeting, `-10`, `Mode` and `Flags`. And `Michi.rms` branches on `TEAM1_SIZE1`, `TEAM2_SIZE1` and `TEAM2_SIZE7`, three names Sec.12 item 9's new wording says cannot exist — probably dead branches, which is what `de-official-map-issues.md` concluded, and also exactly what a wrong reachability argument looks like from outside. Folded into item 17a's run.

**Rev 6's changelog moved to the archived-changelogs section above**, per the spec's own rule that only the current round's appendix lives in the doc. `preview-design.md` is at **rev 7**.

**The process note, and it is the mirror image of rev 6's.** Rev 6 closed by observing that critique converges on internal consistency, which is necessary and not sufficient, and that nine minimal scripts bought more than four rounds of argument. Both halves true — and rev 7 is the other half: internal consistency is necessary, and rev 6 did not have it. Its measurements were right and were then written in *beside* the sentences they falsified, four separate times. Neither failure mode catches the other, and both are cheap. **The habit that would have caught all four: when a measurement lands, grep the document for the rule it replaces before writing the new one down.** Every rev-7 blocker was findable with one search for a phrase the author had just made false.

## Parser spec review — parser-design.md rev 5 checked against the shipped parser (2026-08-05)

Independent critique written to `docs/parser-design-rev5-review.md`. No code, data or spec text changed; the review is the deliverable. Corpus numbers were taken with a throwaway Vitest probe over all 52 `.rms` files (tracked + `local/` + `broken/`), deleted after reading.

**What holds, and it is most of the document.** The lexer is the spec line for line. Every numeric claim re-derived still matches exactly: RMS0202 at 61 warnings + 45 info, RMS0201 at 32, RMS0200 at 858, RMS0301 at 38, RMS0302 at 73 info. Sec.12's fuzz requirements are implemented, and the coverage/span-fidelity gates run over more files than Sec.12 demands.

**One measurement worth keeping:** RMS0110 splits **94 shared-block against 2 degradation** across 52 files, in 12 files, led by `local/Haboob.rms` 20, `local/Enclosed.rms` 19, `local/Acclivity.rms` 15. Rev 5's shared-block rule was argued from one guide example and is worth 94 false RMS0102 warnings on real maps — the strongest evidence any rev-5 change has. Sec.5.3 degradation is correspondingly rare, which the spec predicted.

**Three blocking findings, each demonstrated with a run rather than an argument.**

* **Sec.5.3's "symbols and includes survive degradation" is false for the forward-extended half.** The backward half satisfies it for free, because those tokens were parsed before the imbalance was found. Rev 5's forward scan does not parse at all — it counts braces and keywords — so a `#const` there is absorbed into the RawNode and never recorded. A five-line fixture produces `symbols: []` and the exact false RMS0202 the pinned rule exists to prevent. Two corpus degradations today, neither carrying a directive, so the volume is zero and the invariant is still broken.
* **RMS0217 asserts a crash the guide does not describe.** guide:887-890 says negative borders "can be used, as long as the land origin stays inside the map" and names two remedies; the shipped message says "can crash the game". It fires **169 times, all one message** — second only to RMS0200 — including 32 in DE-official `local/CoastalForest.rms`, and it fires on `local/Enclosed.rms`'s `land_position 99 1 top_border -10`, which is the guide's own first remedy applied in the same block. A per-argument `cautionBelow` scalar cannot see a mitigation, so the check fires hardest on authors who did the documented thing.
* **RMS0308's thresholds are 100 where the guide says 99, and Sec.8 uses both numbers in one sentence.** guide:3006-3007 sets both rules at 99, guide:3003 gives the operand range as 0-99, guide:3010 says the 100th percent is never chosen. `33/33/33` draws a false "adds up to less than 100" info (live in `24hr_Mont Saint Michel.rms`), and `45/54/1` has a provably dead third branch that goes unreported (live in `TL Cape of Storms.rms`).

**Ten significant, of which three can make a future session build the wrong thing.** Sec.6's RMS0202 paragraph still carries both readings BUG-002 withdrew — including the `identifier` argument type that was designed, half-built and reverted the same day — while its counts are still correct, so nothing about the section looks stale. Sec.8's bullets still specify the naive checks that measured 11,623 diagnostics, with the scoping rules that fixed them two sections away in Sec.10, and its wrong-section bullet specifies the `CommandDef.section` form Sec.10 explicitly forbids. And the positive-resolver rule appears only as a scoping rule for the RMS03xx block, in the document that governs the pass where BUG-005 happened.

**The verify checklist has never been connected to the instrument.** Nineteen items open, four tagged TOP PRIORITY or promoted, against 44 RMSTEST scripts and four batches that closed every question the preview spec asked. Exactly one parser item has ever been run (#11, `#undefine`). At least eleven are the same one-map, one-read shape. Item #7 alone gates 581 of the 858 RMS0200 warnings via BUG-005 piece 2. Item #6's status is now actively misleading: moving BCC2 to `test-maps/broken/` answers whether the glue is real, which was never the question — whether DE generates a file at brace depth 1 is what decides RMS0101's severity, and it is still unmeasured.

**Also found:** seven cross-references to sections that do not exist (`Sec.6.5` six times over five lines, `Sec.6.2` once); Sec.4's AST sketches disagree with the shipped types, which `types.ts:63-71` documents as a deliberate deviation nobody carried back; Sec.9's benchmark rule was replaced by the relative per-token gate; the benchmark file's name is stale in two places, the same failure `corpus.test.ts:52` records as having silently dropped it from a gate once already; Sec.13's action items are half-done and unmarked, with `arguments[]` on `controlKeywords` still missing, which is why the guide's documented 0-99 range for `percent_chance` cannot be enforced at all; and `mutexWith` has grown from the one pair Sec.8 names to ten, of which the dominant one on the corpus (50 of 62 RMS0307 warnings) is the pair Sec.11 item 21 says it does not believe.

**The recurring shape, and it is the one rev 7 of the preview spec just recorded.** Every blocking finding here is a rule the project already established, applied in one place and not carried to the neighbouring one: the symbol-survival rule holds for the half of Sec.5.3 that predates the forward extension; the name-the-observation rule holds throughout `validate.ts` and not in `consumeOneArg`'s caution; the guide's own number is used twice in one sentence with two different values. **When an amendment lands in a spec, grep the same document for the sections that now disagree with it** — every finding above was reachable that way.

---

## Phase 4.2 — the canvas renderer (2026-08-05)

CREATION_PLAN 4.2: "Implement the diamond-projection canvas renderer for a tile grid (terrain colors from the constants DB, object markers, player-position markers), with zoom/pan. Feed it a hardcoded grid first; no generation logic yet." Done, plus the pane chrome `preview-design.md` Sec.14 assigns to 4.2/4.3 jointly.

### What landed

| File | What it is |
|---|---|
| `src/preview/generator/types.ts` | Every type the spec declares (Sec.4, 6.6, 7, 10). No implementation. Sec.10's whole reason for wanting this before generator code: "4.2 builds its hardcoded fixture against exactly this list" |
| `src/preview/generator/mapDimensions.ts` | `resolveMapDim` — Sec.4's `MapSize` to `dim` lookup through `predefinedLabels`, the only representation allowed to answer that question |
| `src/preview/render/projection.ts` | The diamond projection, its inverse, fit/zoom/pan/clamp. Pure |
| `src/preview/render/palette.ts` | Stable hash colours, elevation shading, layer tint, cliff, category and player colours. Pure |
| `src/preview/render/terrainBitmap.ts` | Snapshot to RGBA bytes, one pixel per tile, no projection applied. Pure |
| `src/preview/render/drawPreview.ts` | The only file that touches a 2D context |
| `src/preview/fixture.ts` | A hardcoded demo map. Deleted when the worker lands |
| `src/components/preview/` | `PreviewPane`, `PreviewCanvas`, `PreviewNotes` + CSS modules |

`src/breakdown/sidepanel/PreviewPlaceholder.{tsx,module.css}` deleted; `BreakdownSidePanel` now mounts `PreviewPane`. Ten new `ui-help.json` entries, and `breakdown.sidePanel.previewToggle` rewritten as Sec.5 requires (its copy still ended "Preview logic arrives in Phase 4").

Gates: `tsc --noEmit` clean, `eslint` 0 errors (8 pre-existing warnings, none in new files), `validate:reference` passes, `npm test` **24 files / 495 tests**, all green.

### The transform is the projection, and that is what makes zoom free

The obvious renderer walks the grid and strokes a diamond path per tile. At 200x200 that is 40,000 paths per frame and panning is not smooth. Instead `terrainBitmap.ts` builds a plain `dim x dim` RGBA bitmap in **tile space with no projection at all**, and `drawPreview` hands it to the canvas under

```
ctx.transform(halfWidth, -halfHeight, halfWidth, halfHeight, originX, originY)
```

A canvas transform maps `(x, y)` to `(a*x + c*y + e, b*x + d*y + f)`, and the projection is `screenX = (x + y)*halfWidth`, `screenY = (y - x)*halfHeight` — so `a = c = halfWidth`, `b = -halfHeight`, `d = halfHeight`. Under that matrix the bitmap's unit-square pixel at `(x, y)` lands exactly on tile `(x, y)`'s diamond. The rotation is not approximated; the transform *is* the projection. One `drawImage` per frame, the bitmap rebuilt only when the grid or the palette changes, and pan/zoom become four numbers.

One detail that is a decision rather than a default: `imageSmoothingEnabled` is **off above roughly two pixels a tile and on below it**. Nearest-neighbour keeps tile edges crisp and honest when zoomed in, but under two pixels a tile it silently drops whole rows — a lake can vanish — which is the wrong failure for a tool whose first goal is not showing something confidently wrong.

### The half-tile offset, caught by the round-trip test

`tileToScreen` returns a tile's **centre**, which is half a tile along both axes from the lattice point the tile is named after. `screenToTile` has to return a **continuous** coordinate whose integer part is the tile. The first version applied the offset in both, and the round-trip property test went red immediately: the centre of tile (0,0) came back as exactly 0.0, which floors correctly right up until floating-point error makes it -1e-16 and the hover read-out reports tile -1.

Fixing it by deleting the offset from `screenToTile` then broke `zoomAt`, which reads `screenToTile` and feeds the result back through `tileToScreen` — applying the offset a second time and drifting the map half a tile on every zoom step. The resolution is structural rather than arithmetic: `latticeToScreen` is now the primitive, `tileToScreen` is `latticeToScreen(x + 0.5, y + 0.5)`, and callers that already hold a continuous coordinate use the primitive. **One function applies the offset, one does not, and that is what stops a caller applying it twice.** Both failures are pinned by tests.

Worth recording because neither bug is visible by eye — a half-tile drift on a 288 px panel is a pixel and a half — and both would have surfaced later as "click-through lands on the wrong command".

### Terrain colours are confetti, and that is the spec's answer

Sec.12 item 5 is implemented exactly as written: `previewColor` does not exist yet because the dat's `Terrain.colors` holds **palette indices rather than RGB** (SNOW reads (55,236,54), byte-identical to GRASS), so the fallback is "stable hash-color + legend note". That is what shipped. FNV-1a over the constant name, pinned in tests against the published FNV-1a vectors rather than against our own output, so the test can tell a correct implementation from a plausible one.

The consequence, seen rather than predicted: **GRASS is yellow-green, WATER is green, FOREST is pink.** The map reads as a layout — lands, clearings, the ring, the lake, the cliff ridge — and does not read as terrain. Two mitigations shipped with it: a legend listing only the terrains actually on the drawn grid, and a hover read-out naming the tile under the pointer. Both are worth keeping after the palette is decoded.

**So the priority order in Sec.12 has changed by observation.** Item 5 was filed alongside items 6-9 as "specified fallbacks, does not block 4.3 starting", which is still true and is no longer the useful framing: it is now the single item standing between this renderer and a preview anybody can read. It needs the install's palette file, which `tools/extract-constants/` already has access to.

### Honesty, given there is no generator

A plausible map drawn beside somebody's real script, with nothing saying which is which, is the exact failure goal 1 of the spec forbids. So the fixture supplies its own `prominence: "banner"` note — "This is a demonstration map, not your script" — rendered on-canvas beside the approximate badge, and `fixture.test.ts` asserts it is present in both toggle positions. The Current/Final toggle is wired and Current drops the objects, labelled in the drawer as a stand-in: Sec.5 pins Current as a second generation run over an AST truncated at a pinned line, which needs a generator, and inventing semantics for it now is how a pin gets built on.

### Decisions taken here that the spec left open

- **Tile aspect is 1:1 — a square rotated 45 degrees, not 2:1 isometric.** Nothing in the spec pins it. 1:1 is what the Breakdown mockup shows, it keeps tile distances isotropic (a ring of resources reads as a ring rather than an ellipse, which is most of what the preview is for), and it does not waste half the vertical space of a 288 px side panel. 2:1 would match a screenshot of DE's own minimap more closely. It is one constant, `TILE_ASPECT`, and 4.3's visual-calibration pass is the right place to revisit it.
- **`PlacedObject.category` is `string`, not a union.** The spec's own list ends with "...", so a closed union would make the renderer's fallback branch unreachable-by-type while the data can still produce a value it has never heard of. Contrast `PredefinedLabelCategory` next door, which *is* a union because the schema pins its ten members.
- **The toggle keeps the id `breakdown.sidePanel.previewToggle`** rather than gaining `preview.toggle`. Sec.5 offers the latter "if the pane hosts its own toggle distinct from the Breakdown side panel"; it does not, and two ids for one control would leave 3.5's audit checking two entries for the same thing.

### Verification, and why it needed a throwaway

The app cannot run in a plain browser — `useDocument.ts:94` calls `getCurrentWindow()`, which throws without the Tauri shell, and `AppContent` unmounts. That is pre-existing and unrelated, but it means the vite dev server alone cannot show the renderer. A throwaway harness mounting `PreviewPane` under its two providers (both of which only *reject a promise* outside Tauri rather than throwing) rendered it, and was deleted afterwards.

Read off the drawn canvas rather than by eye, which is the only part of this worth reusing:

| reading | value | why it is the right check |
|---|---|---|
| non-background fraction | **0.467** | a diamond inscribed in a square covers exactly half of it, so this is the projection's geometry confirmed by area rather than by looking |
| corner pixel | background | the diamond leaves the square's corners empty |
| centre pixel | FOREST's hash colour | matches the tile the hover read-out names |
| hover at canvas centre | **(100, 99)** on a 200 map | the inverse projection lands on the centre tile |
| coverage after six zoom-in steps | **1.000** | zoom reaches and passes full-canvas |

### For 4.3

- The Sec.8 lint rules. Their `src/preview/generator/**` glob is **no longer vacuous** — Sec.13 says the first mutation test is what proves the glob is right, and the directory now exists. Left out deliberately because Sec.8 assigns them to land with `rng.ts`.
- `preview.pinLine` and the Current cut point. Not built, so no `ui-help.json` entry, per the convention that an entry lands with the control.
- **Sec.15 item 5 is answerable now.** It was deferred *to* 4.2 on the grounds that marking failed placements on-canvas is a judgement about a rendering that did not exist. It exists. The failure count and the notes drawer are already wired to `CommandReport.failures`; what is undecided is whether a failure gets a mark at its span on the map.
- `PreviewResult` is consumed only through the types file, so swapping `buildFixturePreview` for the worker touches one `useMemo` in `PreviewPane`.

---

## parser-design.md rev 6 — the rev-5 review implemented, with two of its calls overturned (2026-08-05)

Worked through `docs/parser-design-rev5-review.md`, re-deriving each claim against the live parser before acting on it rather than taking the report as authoritative. **Every numeric claim in the report reproduced within one**, so the disagreements below are about judgement, not measurement. All three blocking findings were real and are fixed; the two spec-catches-up-to-code tiers are done; one recommendation was rejected and one was completed by reading the guide instead of scheduling a game session.

### The three blocking findings, all reproduced and all fixed

**B1 — Sec.5.3's symbol-survival rule was broken for the forward half of the range.** Confirmed on the report's own five-line fixture: `symbols: []` plus a false RMS0202, against a control giving `symbols: ["FOO"]` and silence. `degrade()` and `degradeTooDeep()` now record `#define`/`#const`/`#include_drs`/`#includeXS` as they consume, via a shared `recordDirectiveInRawScan` + `takeRawOperand` pair.

Three properties made it more than a five-line patch, and all three are pinned in the spec and in tests. It mirrors `parseDirective`'s bookkeeping and **emits no diagnostics** — the region already carries one RMS0110 and a second would break Sec.5.3's one-diagnostic promise, so a quoted `#includeXS` in a degraded region draws no RMS0211. It reuses the Sec.6 **stop set**, so `#define endif` records nothing and lets the `endif` close the range, identically inside and outside a degraded region; a raw scan with its own idea of where operands end would desynchronise the range. And it runs Sec.5.2 **quote assembly**, or `#include_drs "my maps/x.inc"` records its path as `"my`.

`conditionalDepth` is the surviving frames' depth plus the live `openConds` counter. **My own first test assertion here was wrong and the code was right:** I expected depth 1 for a `#const` sitting after the `endif` that triggered the degradation, and it is 0 — the `endif` has already closed the conditional, so the directive is unconditional in the engine's reading however the region is rendered. The test now asserts 0 with that reasoning written down, and a second test uses the mirror trigger to pin a genuinely-nested directive at 1.

**B2 — RMS0217 asserted a crash the guide does not describe, and the severity was the bigger problem.** guide:887-890 says only that negative borders "can be used, as long as the land origin stays inside the map", and names two remedies. The message said "can crash the game". Reworded to the guide, naming **both** remedies rather than the one.

Severity is now **info**, and a measurement decided it rather than the report's argument. Of the 169 corpus hits, the **135 attributable to an enclosing block sit in a block that already carries `land_position` or `base_size` — and 0 sit in a block with neither.** `cautionBelow` is a per-argument scalar and structurally cannot see either mitigation, so at warning severity the check fires hardest on authors who did the documented thing. That measurement also kills the report's middle option: a conditional version would emit **zero** on this corpus, so it needs constructed tests in both directions and belongs in `validate()`. This is the largest user-visible change in the session — 169 diagnostics leave the warning tier.

**B3 — RMS0308's cumulative thresholds were 100 twice where the guide says 99 twice.** Sec.8 used both numbers in one sentence and the implementation resolved the contradiction by picking one. Both comparisons are now 99 (guide:3006-3007, plus guide:3010's "the 100th percent is never chosen"), and the `under100` message kind is renamed `under99`. Corpus effect is exactly what the report predicted, one of each and both live: `24hr_Mont Saint Michel.rms`'s 33/33/33 loses a false info, `TL Cape of Storms.rms`'s 45/54/1 gains a warning on a third branch that can never run.

### Two calls I did not take from the report

**Verify item 21 is closed by the guide, not by an RMSTEST.** The report proposed a one-map experiment for `set_scale_by_size` vs `set_scale_by_groups`. Both guide entries answer both halves outright: `Mutually exclusive with:` declares the pair, and "**If you see a script scaling by both size and groups, only the final attribute will apply!**" (guide:1662 terrain, 1679 elevation) says which wins — with the workaround attached. Reading the entry the mutex was transcribed from was cheaper than measuring.

The report was right about *why* item 21 was suspect and wrong about what follows. Its framing — 194 shipped co-occurrences, therefore "almost certainly a false-positive source" — is a frequency argument, the reasoning BUG-003 discredited. But inverting a frequency argument does not license demoting the check either. **194 co-occurrences are 194 lines whose earlier half does nothing**, in maps where nobody could have noticed, which is the case *for* the check.

**So I declined the recommended per-pair severity gating and fixed the message instead.** RMS0307 said a mutex pair "set the same thing two different ways" — false for the pair producing 51 of its 62 corpus hits, since `set_scale_by_size` scales the tile count and `set_scale_by_groups` scales the clump count. The base message now claims only what `mutexWith` records, and a new optional per-entry **`mutexNote`** carries the consequence and the fix where the guide states them. Only the `set_scale_by_*` pair has one; `land_percent`/`number_of_tiles` is declared exclusive with no consequence named, so it gets the base wording and no invented advice. The two descriptions were also wrong in the same direction and are corrected.

**Also declined: writing the batch-5 RMSTEST run sheet.** The report is right that the verify checklist has never been connected to the instrument — nineteen items open, one ever run. But authoring in-game test scripts is a separate job in `tools/scenario-probe/rmstest/`, and I cannot run them. What landed is the doc half: Sec.11's header now states the gap, names the eleven one-map-shaped items and a suggested order, and calls out that **#7 gates 581 of the 858 RMS0200 warnings** (68% of the tool's largest diagnostic source). Item #6 gains an explicit note that moving BCC2 to `test-maps/broken/` is **not** a resolution — the README's "the brace really is glued" answers a question nobody asked, and whether DE generates a file at brace depth 1 is what decides RMS0101's error severity.

### The staleness that mattered most

Sec.6's RMS0202 paragraph still carried both readings BUG-002 closed **in the opposite direction** — including "evidence that `integer` wrongly conflates a magnitude with an identifier", i.e. it still named the `identifier` argument type that was designed on that reading and reverted the same day. Its counts were exactly right, so nothing about the section looked stale. **In a document headed "do not deviate from this spec", a stale paragraph that names work to do is worse than one that merely describes the past.** Rewritten, with 61 recorded as a floor rather than noise, and the generalisable error kept: each half was filed on evidence that was one observation wearing a plural, and each then attracted a mechanism plausible enough to survive review.

### Mutation testing

All five behaviour changes were mutation-tested together: each defect reintroduced deliberately, the suite run, each assertion seen to go red with a readable message, then restored and re-run green. Ten tests failed under the five mutations, and every one of them belonged to the defect that caused it. A companion assertion (the stop-set agreement one) correctly stayed green, since it asserts a negative that holds either way.

### Spec, rev 5 to rev 6

Corpus-vintage tags defined and applied — three sets were live under a header claiming there was one. The positive-resolver rule and its "a hit says what a name *is*, not what the engine has done with it" corollary hoisted to Sec.1 to bind both passes, since the document governing the pass where BUG-005 happened never stated either. Sec.4's AST sketches reconciled with the shipped token-index representation. Sec.8's unknown-constant and wrong-section bullets rewritten to what shipped, `validate()`'s signature corrected to two parameters, and the direct-items-only scope for RMS0306/RMS0307 pinned — it existed only as a code comment and is the whole correctness argument for both. Sec.9's absolute benchmark threshold replaced by the relative per-token gate that runs. Sec.12 documents the two tiers, the `.rms2` exclusion, `validate()`'s own gates, and the deliberately-absent volume cap. Sec.13 gained a status table because half its items were done and still listed open. Seven cross-references to a `Sec.6.5`/`Sec.6.2` that never existed repointed. Appendix E is the full changelog.

Two small code lints fixed alongside: RMS0210's unglued-operand diagnostic double-fired on `( 5 + 1 )` (same code, message and span twice), and the glued-operator character class's deliberate exclusion of `-` is now documented rather than looking like an omission.

### Verification

`npm test` — **24 files / 507 tests**, green, 57 s. `npm run typecheck`, `npm run lint`, `npm run validate:reference` all green. Corpus re-measured after the changes: RMS0217 169 warning to 169 **info**, RMS0308 60 total with one info-to-warning swap between the two files named above, everything else unchanged including RMS0200 858, RMS0202 106, RMS0110 96 (94 shared-block / 2 degradation), RMS0201 32.

## Terrain colours decoded, two modes, and the side panel moved to Code (2026-08-05)

Three things, one session: `previewColor` is real data now rather than a hash, the pane offers two colour modes because the two available sources disagree in interesting ways, and the preview + reference column is on the Code tab as well as Breakdown.

### preview-design Sec.12 item 5 is discharged, and the obvious reading of it was wrong

The item said `Terrain.colors` is "sourced but NOT yet decodable — palette indices, not RGB", with the instruction to keep hash colours until the install's palette file is decoded. Decoding it took twenty minutes: `resources/_common/palettes/original.pal` is a plain-text JASC-PAL file, 256 entries, and `palettes.conf` confirms it is palette 0. Index 55 is `(0,169,0)` green, 19 is `(48,93,182)` blue, 137 is `(248,201,138)` sand. All sensible.

**It does not fix the defect the item was written about.** The item's own evidence was that SNOW reads `(55,236,54)`, byte-identical to GRASS, and it read that as an encoding problem. It is not. Across the **131 enabled terrain records the field takes exactly 12 distinct values** — it is a legacy colour *class*, not a per-terrain colour. SNOW (32), Snow Light (73), Snow Deep (74), Snow Soft (124) and every grass variant all carry index 55. The collision is in the data, one level above the encoding, and no amount of correct decoding moves it.

**The fix was a different file.** DE ships terrain textures as ordinary `.dds` under `resources/_common/terrain/textures/2x/`, named by the Terrain record's `name_2` — which this repo already stores as `deTextureFile`. The mean of the opaque texels is one number per terrain, from the terrain the script actually places: `g_sno` is `(180,205,219)` pale blue-white, `g_grs` is `(129,146,63)` olive. That is `previewColor`, and it is the default.

The generalisable bit, a variant of a rule already in CLAUDE.md: **a field being undecodable and a field being unfit for purpose are different problems, and fixing the first tells you nothing about the second.** The spec had one caveat where there were two, and the visible one was the cheaper one. Worth asking of any "blocked on decoding X" item what it would still not answer once decoded.

### Two modes, because each source separates what the other collapses

Ash's call, and it turned a discarded source into a feature. `previewColor` is per-texture, so it tells SNOW from GRASS but not FOREST from LEAVES (both `g_for`) or DESERT from PALM_DESERT (both `g_pal`). `minimapColor` is the dat's colour class, so it tells FOREST from LEAVES and PALM_DESERT from DESERT, but draws every snow as grass. Neither dominates. The pane toggles, Game is the default, and `preview.colorMode`'s help text states the coarseness of minimap mode plainly rather than letting a user discover green snow and file it as a bug.

`palette.ts` grew `TerrainColorMode` and `sourceFor()`. The fallback chain is mode colour, then the other mode's colour, then a hash, and `sourceFor` is what makes that honest: the legend marks any row whose colour did not come from the selected mode, so a data gap reads as "no colour in data" rather than quietly passing for real. Both fields are populated for all 15 known terrains today, so that path only runs on future gaps. The memoisation cache is per palette instance rather than shared, because one cache across two modes would serve game colours to minimap mode after a toggle; the `keeps a separate cache per mode` test pins it.

### Tooling

`tools/extract-constants/` gained `average_texture_color`, `parse_jasc_palette`, `TextureExtraction`, `MinimapColorExtraction` and a `--colors-only` mode, plus Pillow in `requirements.txt`. The schema gained both fields, with the coarseness caveat written into `minimapColor`'s own description.

Three details that were decisions rather than defaults, each commented at its site. The resample filter is NEAREST, not the usual box: the sheets hold diamond tiles on a transparent field, and any smoothing filter blends that border into the edge texels *before* the alpha test can drop them, dragging every average toward black by a shape-dependent amount. Texel access is `tobytes()` rather than `getdata()`, the one accessor whose spelling has not moved across Pillow versions. And `--colors-only` is a separate code path from a full run (`merge_terrain_colors`, not `merge_entry`) because a full run recomputes `verified` and rewrites `notes` wholesale — correct when re-extracting everything, wrong when adding a field to a tree carrying weeks of uncommitted reference-data edits.

**A defect the tests caught, worth recording because it is the kind that survives.** The first `merge_terrain_colors` appended its provenance sentence unconditionally, so two runs produced two identical sentences in `notes`. A tool meant to be re-run after every DE patch has to be idempotent. Fixed with a regex that strips the previous sentence, and **mutation-tested** per CLAUDE.md: reintroducing the unconditional append turns `test_is_idempotent_across_runs` and `test_replaces_a_stale_colour_rather_than_keeping_both` red, restoring it turns them green. 43 tests in `test_extract_constants.py`.

Also caught by a gate rather than by review: `npm run validate:reference` failed on `minimapColor` before it was added to the schema (`must NOT have additional properties`, 15 times). That is `additionalProperties: false` doing exactly its job.

### The side panel is shared, and the reference table never needed Breakdown

`src/breakdown/sidepanel/` moved to `src/components/sidepanel/`, `BreakdownSidePanel` was renamed `MapSidePanel`, and the Code tab now renders it beside the editor. A component both tabs render does not belong inside one of them.

`ReferenceTable` was the only real obstacle and it was not much of one. It read `gameConstants` and `lang` from `BreakdownContext` — two of that context's fifteen fields, both module-level JSON that never changes at runtime, while the rest of the context is edit intents, expansion anchors and card selection. It now imports the JSON directly, exactly as `PreviewPane` does, and has no Breakdown dependency at all. There is no `BreakdownProvider` over the Code tab and there should not be one.

While there: the table's footnote read "IDs/textures pending extraction (Phase 4.0)". That extraction ran on 2026-07-30 and the values above it are real, so the note was telling users to distrust correct data. Replaced with the thing that *is* still true, that the table holds 31 of several hundred constants, so a name missing from it proves nothing about the game. Same shape as the stale-rule sweep rev 7 was mostly about: **when a pass lands, grep the UI strings it just falsified, not only the docs.**

`PreviewViewContext` is new and exists for one reason: the tabs are a conditional render, so the inactive one is genuinely unmounted and React discards its state. Seed, view and colour mode live above the switch, so walking to Code and back no longer resets a seed you re-rolled to. Zoom and pan deliberately stay in `PreviewCanvas` — they are derived from the canvas's measured pixel size, which does not exist until it mounts, and the viewport is refitted on mount anyway.

### Scheduled, not built

`CREATION_PLAN.md` gained **step 4.4**: drag to resize the column separator on both tabs, and collapse the column entirely with a button to bring it back, both persisted via the Tauri store. Recorded rather than built because Ash asked for it to be planned. Note the collapse half is a **fix**, not a nicety — 4.2 put a fixed 18rem column on a Code tab that was previously full width, and there is currently no way to dismiss it.

### Verification

`npm test` — **24 files / 515 tests**, green, 51 s. `npm run typecheck` clean, `npm run lint` 0 errors (9 pre-existing warnings), `npm run validate:reference` green, `npm run build` succeeds. `python -m unittest test_extract_constants.py` — 43 tests, green, and mutation-tested as above.

The `game-constants.json` diff was checked field by field against a pre-run copy, before and after the extraction: only `previewColor`, `minimapColor` and an appended `notes` sentence changed, on terrain entries only, with `constId`/`verified`/`resourceAmounts` untouched throughout.

**Not verified: how any of this looks.** The app does not run under bare Vite — `AppContent`'s startup hooks call Tauri, so a browser tab renders blank — and this session could not display a browser pane regardless. Every gate that can run without the desktop host is green; the visual check is `npm run tauri dev` on Ash's machine, per this file's standing note that his local run is the real confirmation.

## Phase 4.3 started: the RNG/determinism foundation, before any stage (2026-08-06)

Sec.14's file layout lists eight files under `src/preview/generator/`; only `types.ts` and `mapDimensions.ts` existed (from 4.2). This session built the two pieces every later stage (S1 lands onward) will share rather than reimplement per-stage — `rng.ts` and `placement.ts` — plus the Sec.8 lint gate that makes the determinism goal real instead of aspirational. Deliberately did NOT start `instantiate.ts` (S0) or any stage file: those are each a session-sized chunk of their own (S0 alone is Sec.3's twelve numbered rules), and starting one half-built would leave the actually-finished, actually-tested slice harder to review.

### The lint rules Sec.8 specified but nothing enforced

`eslint.config.js` gained two new blocks, scoped by `files`, matching Sec.8's spec text almost verbatim: `no-restricted-imports` (react, react-dom, monaco-editor, `@monaco-editor/*`, `@tauri-apps/*`) across all three pure directories — `src/parser/**`, `src/breakdown/patch/**`, `src/preview/generator/**` — and `no-restricted-properties` (the twelve `Math.*` names) plus `no-restricted-syntax` (`**`/`**=`) scoped to `src/preview/generator/**` only. The import rule closes a gap that predates this session: `src/parser/**` and `src/breakdown/patch/**` have been a CLAUDE.md hard rule since Phase 2, unenforced by tooling until now.

**Mutation-tested per CLAUDE.md and Sec.13's own table, all three, each added then reverted:** `Math.sqrt(2)` in `rng.ts` → `no-restricted-properties` error naming Sec.8; `2 ** 3` in `placement.ts` → `no-restricted-syntax` error (confirms the property rule alone can't catch the operator form); `import { useState } from "react"` in `src/parser/types.ts` → `no-restricted-imports` error. `npm run lint` returned to 0 errors / 9 warnings (the standing baseline) after each revert.

### `rng.ts`

mulberry32 (integer form — returns a uint32 draw, not a `[0,1)` float, since every consumer in the spec wants an integer) plus a `hash32`/`fnv1aString`/`substreamSeed` chain implementing Sec.8's `hash(masterSeed, stageId, commandOrdinal)`. `hash32` is deliberately order-sensitive (`hash32(a,b) !== hash32(b,a)`) so a stage tag and an ordinal can't accidentally commute into the same substream. `nextInt` is plain modulo, not rejection-sampled — argued in the code comment: every range this generator draws from is minuscule next to 2^32, and Sec.8 only asks for "ample for a visual heuristic" quality, not cryptographic uniformity.

The sine table (`sineTable.ts`, 3600 entries, fixed-point ×10000) is generated OFFLINE by a new `scripts/gen-sine-table.mjs` and checked in as literal data — the one place `Math.sin`/`Math.cos` appear in this session's work, and deliberately outside the lint-scoped directory, run once, never at runtime. `sinAt(k, n)`/`cosAt(k, n)` do the `floor(3600·k/N)` lookup Sec.8 specifies. Measured (not assumed) error bounds went into the test tolerances rather than picked by feel: max deviation from the continuous value at an exact table index is 0.5 (pure rounding); max deviation at an arbitrary `(k, n)` including index quantisation, checked for `n` up to 20, is 16.7; max `|sin² + cos² − scale²|` over the whole table is 12119. `rng.test.ts` asserts within 20 and 15000 respectively, with the measured numbers in the test names so a future tightening has to re-derive them rather than guess.

One correctness note worth recording: the first draft of `mulberry32`'s second mixing step had a stray `t ^ (...)` wrapped around the whole expression, which is not the published algorithm — caught by comparing line-by-line against the canonical reference before writing tests, not by a test (nothing here has an external oracle to catch a self-consistent-but-wrong PRNG). Fixed before any test was written against it.

### `placement.ts`

`ok()`/`fail()` — trivial, but every stage constructs `PlacementOutcome` values exactly this way, so it is one place rather than a repeated `{ ok: true, value }` literal. `intersectCandidates` implements Sec.7's attribution algorithm ("successive set intersections... attribute the failure to the predicate whose intersection first produced the empty set") in the shape Sec.11 requires it to run in: predicates write-compact the SAME scratch `Int32Array` in place, one pass each, rather than allocating a filtered copy per predicate — which is also what makes the attribution free instead of a second pass. Tests pin the case rev 3 got wrong implicitly (Sec.7's own history): a predicate that narrows the set without emptying it must not be blamed when a later predicate is the one that actually empties it.

Not built yet, and flagged rather than guessed at: the per-stage, per-(reference frame, habitat class) candidate-set CACHE that Sec.11 says feeds `intersectCandidates` its `scratch` copy. That's stage-specific plumbing (S1's border/zone/owned list, S6's much longer one) and belongs with the first stage that actually needs it, not invented here against no caller.

### Verification

`npm test` — **26 files / 537 tests** (was 24/515; +2 files from this session's `rng.test.ts` and `placement.test.ts`, +22 tests). `npm run typecheck` clean. `npm run lint` 0 errors, 9 pre-existing warnings (unchanged baseline). `npm run validate:reference` green, MAP_SIZES/predefinedLabels join still ascending. All four gates run against the real mount, not a sandbox mirror.

**Not done, and next in Sec.14's file order:** `instantiate.ts` (S0 — the AST-to-`InstantiatedScript` pass, Sec.3's twelve rules, including the still-open `[verify]` on team-canonicalisation step 3 and the unresolved `playerInTeam` reachability question, Sec.3.1) and `mathEval.ts` (Sec.2.2 semantics, shared fixtures with the parser's own tests). Both are prerequisites for every stage from S1 onward — nothing in `lands.ts` can run without an `InstantiatedScript` to read. **No visual calibration in this session** — Sec.13's screenshot pass and Sec.15's `[tune]` constants need an actual stage generating tiles, which does not exist yet; this session was infrastructure only.

## Bug fix: preview canvas zoom/pan reset on every Breakdown <-> Code switch (2026-08-06)

Reported by Ash, not found by a gate — there is no component-level render test in this codebase (no React Testing Library dependency; UI correctness here has always relied on `npm run tauri dev` plus review, per this file's own standing note), so a state-loss bug in a mount/unmount boundary had no test that could have caught it.

**Root cause.** `PreviewCanvas`'s `viewport` (pan/zoom) and its `userFramedRef` flag were local `useState`/`useRef`. `PreviewPane` — and therefore `PreviewCanvas` — lives inside `BreakdownPane`/`CodePane`, which `App.tsx` renders as a conditional (`activeTab === "breakdown" && (...)`), not a hide/show toggle, so the inactive tab's whole tree genuinely unmounts. Switching tabs destroyed the canvas's local state, and remounting always started from `viewport = null`, which the sizing effects treat as "never framed" and fit to the container from scratch — the zoom/pan reset the report describes.

This is exactly the failure mode `PreviewViewContext.tsx`'s header comment already names (state lost across a conditional-render tab switch, indistinguishable from a bug), but its own reasoning had carved zoom/pan out of the fix: "derived from the canvas's own pixel size, which does not exist until it mounts and measures — the viewport is refitted on mount anyway, so hoisting it would preserve a value that is immediately overwritten." That is true of the very first mount and not true of a tab switch — Breakdown and Code render the same shared `MapSidePanel` (moved out of `src/breakdown/` in the terrain-colour session), so a remount re-measures the same container size, and there was no reason the framing had to be thrown away every time. The original note undersold how often someone actually crosses the tab boundary mid-inspection.

**Fix.** A second context, `PreviewViewportProvider`/`usePreviewViewport()`, added to `PreviewViewContext.tsx` and mounted in `App.tsx` alongside the existing `PreviewViewProvider` (both above the tab switch, both survive it). Deliberately a SEPARATE context rather than folded into the existing one: `viewport` changes on every pixel of a drag or wheel tick, and the existing context is read by `PreviewPane`'s whole control row (seed chip, view toggle, colour mode) — coupling them would re-render those controls on every drag frame for no reason.

`userFramedRef` stays a ref inside `PreviewCanvas` — it still has to be, since the ResizeObserver and snapshot-change effects read it from closures that don't list it as a dependency, which needs a synchronous always-current value, the textbook reason for a ref over state. What changed is where it's *seeded*: `useRef(persistedUserFramed)` reads the context's persisted flag once, at mount, so a remount after a tab switch starts already-framed instead of defaulting to false; every write goes through a new `markUserFramed()` helper that sets both the local ref (for this instance's closures) and the context flag (for the next remount).

**Two small lint consequences, both fixed, not suppressed.** `setViewport` now arrives through `usePreviewViewport()` instead of a literal `useState` call in this component, so `react-hooks/exhaustive-deps` can no longer see through the indirection to know it's stable (it still is — a `useState` setter's identity never changes, regardless of how many hooks it passes through) — added to the two affected effects' dependency arrays rather than disabled, since it's true and free. And the new `usePreviewViewport` hook export is one more `react-refresh/only-export-components` warning on a file that already carried one for `usePreviewView`, the same pattern already standing in `GenerationSettingsContext.tsx` and `HelpSettingsContext.tsx` — not a new defect, the established shape of a context-plus-hook file in this codebase.

**Verification.** `npm test` — 26/537, unchanged (no test exists that exercises a tab-switch remount; see the opening note — this fix has none written for it, which is a gap, not a claim of coverage). `npm run typecheck` clean. `npm run lint` — 0 errors, 10 warnings (+1 over the prior baseline of 9, entirely the expected new `react-refresh` line described above). Not visually verified — the app does not run under bare Vite (`AppContent`'s startup hooks call Tauri), so this session could not drive a browser pane against it either; **Ash's local run is the real confirmation**, per this file's standing note. To check: `npm run tauri dev`, zoom/pan on either tab, switch tabs, switch back — the framing should hold.

## `mathEval.ts`: the other Sec.14 prerequisite for `instantiate.ts` (2026-08-06)

Continuing 4.3 in Sec.14's file order after the RNG/placement session: `mathEval.ts`, parser-design Sec.2.2's math-expression evaluator. The parser only assembles an expression into an `ArgNode` and lints its guide-verified malformed shapes (`RMS0210`) — Sec.2.2 states outright that evaluating it is the generator's job, not the parser's. This is that job, built and tested in isolation from `instantiate.ts` (which doesn't exist yet) — `evaluateExpressionTokens` takes plain token-text arrays and a `resolveConstant` lookup, so it needed no AST or symbol table to test against.

**Every worked example in the spec text was traced through by hand before being written as a test, and all of them landed exactly.** `(GOLD_COUNT + (5 + 2))` → 8 "dropping `(5`": modelling the drop as "skip this operator+operand step, keep the accumulator" and choosing `GOLD_COUNT = 6` for the test reproduces 8 exactly. `(5.9 % -inf)` → 5 and `(-5.9 % -inf + 10)` → 5 both required truncation-toward-zero on an infinite divisor specifically — JS's native `%` does NOT do this (`5.9 % Infinity` is `5.9` in JS, fractional part intact), so the zero-and-infinite-divisor case is hand-written as `Math.trunc(left)`, general finite division falls through to native `%` (which already IS truncation-toward-zero, unlike Python's floor-mod). The negative idiom is the one that actually distinguishes truncation from floor (`-5.9` truncates to `-5`, floors to `-6`; only `-5 + 10 = 5` matches the guide), which is why it's asserted as its own test rather than folded into the positive one.

**One rule is this file's own extension, not a separately guide-sourced fact, and the header comment says so.** Sec.2.2 only works through the nested-paren case explicitly ("a nested `(` operand is silently not-a-number"). Whether an unresolved constant reference gets the same treatment is not stated anywhere — there's no engine-verified answer for "expression references an undefined name" the way there is for nested parens. Extending the same "not-a-number, drop the step" handling to it was the only choice that didn't require inventing a DIFFERENT undocumented behaviour, but it is flagged in the code as an inference, not a citation, per the codebase's standing distinction between the two.

**A third case, `( A + 1 )`'s unglued leading paren, gets neither treatment — it bails the whole expression rather than guessing.** Sec.2.2 marks this shape `⚠ verify #15` outright ("the engine's own close-detection rule is unknown and is the real arbiter"). Implemented as: reject any expression with an even token count, and reject on any operator-position token that isn't one of the five operators — both catch this shape without needing a special case for it, and both are honest about not knowing rather than picking a plausible-looking reading for a case the spec itself says nobody has checked.

### A near-miss: `*/` inside a `+-*/%` inside a JSDoc comment

First draft of the file's top JSDoc wrote the operator set as `` +-*/% `` in prose. `vite:esbuild` failed the whole file with `Unexpected "%"` — the literal substring `*/` inside that closes a `/** ... */` block comment early, so `%` landed outside the comment as bare syntax. Fixed by spelling it out ("one of the five operators") instead. Left as a build-log note because it is exactly the kind of failure that reads as a tooling bug from the error message alone (`Unexpected "%"` gives no hint the actual defect is nine characters earlier, inside a comment) and will recur the next time someone writes `*/` literally in a comment about arithmetic operators.

### Verification

`npm test` — **27 files / 559 tests** (was 26/537; `mathEval.test.ts` +22). `npm run typecheck` clean. `npm run lint` — 0 errors, 10 warnings (unchanged baseline; `mathEval.ts` sits under the Sec.8 `src/preview/generator/**` gate and uses only `Math.trunc`/`Math.floor`, both exact and allowed). Mutation-tested the truncation rule specifically, since it's the one place this file diverges from JS's native operator behaviour: swapped `Math.trunc` for `Math.floor` in the zero/infinite-divisor branch of `mod()`, confirmed exactly the two tests that depend on it went red with a readable diff (`expected 4 to be 5`, `expected -6 to be -5`), reverted, confirmed green again.

**Still not started:** `instantiate.ts` itself — the S0 AST-walk that actually calls this. `mathEval.ts` and `rng.ts`/`placement.ts` are now all of Sec.14's non-stage prerequisites; every stage file from `lands.ts` onward is still unbuilt and unblocked-but-not-started.

## `instantiate.ts`: Stage 0, script instantiation (2026-08-06)

The last of Sec.14's non-stage prerequisites, and CREATION_PLAN 4.3's next scheduled step: Sec.3's twelve rules, AST → `InstantiatedScript`. Every stage from `lands.ts` onward reads this output instead of the AST — `InstantiatedScript` itself didn't exist as a type yet (Sec.14 says it belongs in `types.ts` "every interface in this doc"; the type had simply lagged the prose since rev 6), so this session added it there first: `InstantiatedArg`/`InstantiatedAttribute`/`InstantiatedCommand`/`PlayerSetupState`/`InstantiatedScript`.

**One walk, not two.** Branch selection (`if`/`elseif`/`else`, `start_random`), `#define`/`#const` symbol definition, and the S0 RNG rolls all happen in the same depth-first traversal, in canonical section order (rule 11) rather than file order — so a symbol defined only inside a taken branch resolves for everything after it and never exists for anything inside an untaken one, matching the engine's own token-filter model (parser-design Sec.1) rather than a static two-pass approximation of it.

**Reused rather than re-derived:** `resolveMapDim` (`mapDimensions.ts`, already built for the renderer) for the mapSize→dim join, and `canonicaliseTeams`/`teamLabels` (`generationSettings/teamModel.ts`, Sec.3.1) for the team environment — CLAUDE.md's "no parallel model" applies here exactly as it does to Breakdown.

**Judgment calls made where the spec's prose doesn't nail down an implementation, each left as a comment at its call site, not silently decided:**

- **`RandomNode.preamble` executes unconditionally**, not as part of any branch. The parser's own doc calls this content "tokens before the first `percent_chance`" and flags it `RMS0106` as an authoring mistake, but the tokens sit outside the engine's branch-filter range entirely (parser-design Sec.1: the engine deletes inactive-branch tokens, and preamble isn't inside any branch to begin with) — so it is ordinary content that happens to sit in an odd place, not a fourth branch.
- **A command name that resolves inside block context** (Sec.4's pinned lookup: block context tries attributes first, so a real command name there is the rare cross-category `RMS0207` case) has no attribute-sink slot to fold into, and is treated as unsimulated rather than invented a home for.
- **`create_object_group`/`create_actor_area` collection keys are the only fields their `CommandDef`s expose for the purpose** — the group's `type` argument, the area's `identifier` argument — since neither entry's language.json record names a different identity field. If a later session finds the engine actually keys these differently, that's a data/spec correction, not an S0 bug.
- **"Before the first land command" (rule 8) is checked by command name** (`create_land`/`create_player_lands`) **regardless of which section actually contains it**, rather than gating on canonical-order section boundaries — simpler, and behaves identically for every non-malformed script since canonical order already puts `LAND_GENERATION` immediately after `PLAYER_SETUP`.
- **`otherConstant`-typed values (`#const`'s own value slot) get the same symbol-resolution and rounding treatment as `integer`/`percent`/`flag`**, on the reasoning that both are fundamentally numeric internally (Sec.3 rule 6's "everything in the game is a number"); `terrainConstant`/`objectConstant` deliberately do not, since that aliasing is CREATION_PLAN A.2's unbuilt token-alias table, not this pass.

**Not addressed, because it's outside S0's scope:** preview-design Sec.3.1's open `[verify]` on team-canonicalisation step 3 (lowest-player-number vs. ascending-selected-number) and the `playerInTeam` reachability question — `instantiateScript` calls `teamModel.ts` as-is, per "no parallel model"; resolving the `[verify]` is a `teamModel.ts`/engine-measurement question, not something this pass can settle by construction.

### Tests

`src/preview/__tests__/instantiate.test.ts`, one `describe` per Sec.3 rule plus the `PlayerSetupState`/teams integration checks, all against real `parseRms` output (matching `validate.test.ts`'s convention, not hand-built AST nodes) — 90 tests including a corpus smoke gate (every tracked `test-maps/*.rms`, instantiated at three player-count/map-size combinations, asserting no throw and `dim > 0`; this gate makes no claim about the RESULT, only that the pass survives real, sometimes-invalid scripts, mirroring `corpus.test.ts`'s tier-1 no-throw gate).

**Mutation-tested four of the riskiest rules, and the first attempt caught a real gap in the test itself, worth recording because it's exactly the failure the practice exists to catch:** the original "first-definition-wins" test used `#const N 5` then `#const N 10`, both of which clamp to `override_map_size`'s 36 floor — so removing the `symbols.has()` first-write guard entirely still passed, since 5-vs-10 was invisible after clamping. Rewritten to `60` vs `200` (both inside the legal range, far apart) before re-testing; the same mutation then failed as expected (`200` vs `60`). The other three — dropping the `Math.min(pct, 99 - cumulative)` cap to `100 - cumulative` (99%-truncation rule), disabling the `repeatable` branch of attribute folding, and disabling the `landCommandSeen` gate on `override_map_size` — each went red on the first try, each reverted after confirming.

### Verification

`npm test` — **28 files / 649 tests** (was 27/559; `instantiate.test.ts` +90 — the local `test-maps/local/` corpus was mounted for this run, which is why the jump is larger than the tracked-corpus-only count would suggest). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline (`instantiate.ts` sits under the Sec.8 `src/preview/generator/**` gate; no `Math.*`/`**` violations). `npm run validate:reference` green, unchanged.

**Still not started:** every stage file, `lands.ts` onward — `instantiateScript` has no caller yet (`index.ts`'s `generatePreview()` doesn't exist), so nothing generates a tile. Sec.13's visual-screenshot pass and Sec.15's `[tune]` calibration still need a stage to calibrate. Next in Sec.14's file order: `grid.ts` (TileGrid, distance transforms, masks) or `lands.ts` (S1) directly, per CREATION_PLAN 4.3.

## `grid.ts`: TileGrid allocation, border/position arithmetic, distance transform, masks (2026-08-06)

Sec.14's last non-stage prerequisite before `lands.ts` (S1) itself — every stage from here on builds its grid and reads its masks through this module rather than re-deriving Sec.4's arithmetic per stage.

**`createTileGrid(dim, baseTerrainId, baseLayerId)`** allocates all seven of Sec.4's typed arrays, fills `terrain`/`layer` with the base fill (Sec.6.1's "Base fill" step), and defaults `landId` to `-1` ("no land claims this tile", Sec.4's own field comment) and `zone` to `0` — a neutral placeholder, since a zone only means something once a land claims the tile and stamps its own zone onto it (Sec.6.1). `zone: 0` is a judgment call, not a spec citation: nothing in Sec.4/Sec.6.1 pins an UNCLAIMED tile's zone value, because nothing reads it before a land claims the tile.

**Two rounding rules, kept deliberately separate, per Sec.4's own warning ("a single shared helper would silently break one of them"):** `percentRound` (round-half-up, aliasing `mathEval.ts`'s `roundForIntegerSlot` rather than a second "floor(x+0.5)") backs both `positionPercentToTile` (round, then clamp to `[0, dim-1]` — the `Michi.rms land_position 100 100` fix, which the spec is explicit rounds BEFORE clamping, not the reverse) and `borderBounds` (the asymmetric `min = round(pct/100·dim)`, `max = dim − round(pct/100·dim)` formula, measured to the tile by RMSTEST_16/17). `borderBounds` deliberately does NOT clamp negative border values — Sec.4 says they're legal (a land origin can still be on-map with a negative border), and deciding what an empty/inverted resulting range means is a stage's job, not this arithmetic's.

**`distanceTransform(grid, terrainId)`**: multi-source BFS, 4-connected — matching the codebase's standing connectivity convention for terrain-shaped structure (CLAUDE.md: "connectivity here is a claim about how the thing was built, not a preference"). Index-based `Int32Array` ring-buffer queue, no per-tile objects (Sec.11's "typed arrays only"). Returns `UNREACHABLE` (`0xffff`) for every tile when the queried terrain never appears on the grid — a real case worth a named sentinel rather than `Infinity` (doesn't fit `Uint16Array`) or `-1` (reads as "not yet computed" in a lazy-cache context Sec.11 also specifies, which this function itself doesn't implement — the cache key is a stage concept this module doesn't have).

**`waterMask`/`forestZoneMask`** implement Sec.12 item 6's own documented fallback, not an invention: `isWater`/`isForest` per real terrain data don't exist yet (the dat's `is_water` is an undecoded bitfield), so the spec itself prescribes name heuristics — quoted close to verbatim in the code comment: `/WATER/` and `/FOREST|JUNGLE|BAMBOO/`. Deliberately did NOT widen the water pattern to `SHALLOW`/`BEACH`/`ICE` even though they're water-adjacent in-engine — the spec names exactly these patterns, and Sec.12 item 6 itself flags real per-terrain data as "worth doing properly rather than by name-matching," which reads as a caution against exactly this kind of quiet widening. `forestZoneMask` takes a plain `treeObjectTiles: number[]` rather than reaching into a `PlacedObject[]`, so it has no dependency on the objects stage (S6, unbuilt) existing yet.

**One thing flagged rather than assumed:** forest-zone adjacency is implemented as full 8-neighbourhood (Moore) — "1-tile adjacency" in Sec.4's prose, read as "a tile you can reach diagonally still counts," which is a different claim from the 4-connected rule this same file uses for the BFS transform and that CLAUDE.md pins for growth/connectivity elsewhere. No RMSTEST exists to confirm 8 over 4 for this specific zone; the code comment says so rather than presenting it as measured.

### Tests

`src/preview/__tests__/grid.test.ts`, 18 tests: exact reproductions of RMSTEST_16 (borders 3/2/6/9 on a 120 map → `{4, 118, 7, 109}`) and RMSTEST_17 (all borders 2 → `{2, 118, 2, 118}`), Test 9's `land_position 50 50` → `(60, 60)`, the `Michi.rms` clamp case, and BFS correctness including the 4-vs-8-connected distinction (a diagonal neighbour must read distance 2, not 1) and multi-source nearest-wins behaviour.

**Mutation-tested the two places a silent regression would be invisible until someone screenshotted a map:** dropping the `dim − ` term from `borderBounds`' `maxX`/`maxY` (both RMSTEST reproductions went red, reverted), and widening the BFS to 8-connected by adding the four diagonal `relax` calls (the diagonal-distance assertion went red — `expected 1 to be 2` — reverted).

### Verification

`npm test` — **29 files / 667 tests** (was 28/649; `grid.test.ts` +18). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline (a labelled `outer:` loop in `forestZoneMask`'s neighbour scan did not trip any rule). `npm run validate:reference` unaffected (this session touched no reference data).

**Still not started:** every stage file, `lands.ts` onward, and `index.ts`'s `generatePreview()`. `instantiate.ts`/`mathEval.ts`/`rng.ts`/`placement.ts`/`grid.ts` are now all of Sec.14's non-stage prerequisites — `lands.ts` (S1) is next, and it is the first file that actually generates a tile, so it is also where Sec.13's visual-screenshot pass and the first `[tune]` calibrations become possible.

## `lands.ts`: S1 origin placement (first slice of the first stage) (2026-08-06)

The first file that actually places anything on a `TileGrid`. Sec.6.1 is the single largest stage section in the spec — origin placement, zone assignment, and growth (frontier weight buckets, the `cf`-dependent detached-seed reservoir, `base_elevation`'s post-growth clamp) — so this session drew an explicit line rather than attempt all of it: **origin placement, zone assignment, and origin stamping only.** Growth and `base_elevation` are NOT built; `LandOrigin.declaredTargetTiles`/`behaviorVersion` carry what a grower will need without this file guessing at the additive-vs-included size-target adjustment (Sec.6.1: "behavior_version 0: target is additive to the origin square; version 1/2: origin square included") it has no grower to apply yet.

**Also explicitly deferred, and this is a real scope reduction from what Sec.6.1 itself sanctions:** `assign_to`/`assign_to_player` on a `create_land`. The spec says building only `AT_PLAYER`/`AT_COLOR` and leaving the rest `notSimulated` is "a legitimate v1 answer" — this session does LESS than that (assign_to'd lands are placed as ordinary neutral lands, with a `notSimulated` failure + a drawer `SimulationNote`), because doing even `AT_PLAYER`/`AT_COLOR` correctly means knowing the FULL ring membership across every `assign_to`'d command in the section before placing any player-associated land (an assign_to'd `create_land` "takes a ring slot, like a player land" per Sec.6.1), which is real cross-command bookkeeping this session didn't have time to build carefully. Flagged as the most important thing to pick up next, not silently dropped — every deferral emits a note and a `PlacementFailure`, never a silent placement.

**What's built, one function per Sec.6.1 sub-rule:**

- **Neutral (`create_land`, unassigned) origin**: `land_position` when given (round-then-clamp, the same `Michi.rms` fix `grid.ts` already has); else rejection sampling — inside `borderBounds`, inside the cross-shaped region (`0.35*(dim/2)` from center, MEASURED RMSTEST_25) unless `generate_mode 1`, at least `base_size` from the true map edge, at least `min_placement_distance` (defaulting to `other_zone_avoidance_distance`) from every prior origin — for `ORIGIN_ATTEMPTS = 100` tries, falling back to map center with an `originFallbackCenter` `PlacementFailure` on exhaustion (Sec.7's exact contract).
- **Player lands (`create_player_lands`, expanded to one origin per player)**: the ring model, ALL FOUR `circle_radius` regimes — no attribute (radius 40%, variance 10%, jitter +/-7 degrees, MEASURED RMSTEST_24, center shifted by borders), explicit positive (exact radius + variance, NO jitter — "three corpus maps... mean a perfect circle"), exactly 0 (falls back to the no-attribute branch WHOLESALE, including the border-shifted center, not just the numbers — tested by asserting byte-identical output to the no-attribute case at the same seed), and negative (a genuinely approximate MIXTURE model — see below). `direct_placement` uses the block's own `land_position` for every player instead of the ring.
- **`grouped_by_team`** (MEASURED RMSTEST_36): players grouped by canonical team, every un-teamed player its own group of one, groups evenly spaced around the ring, members within a group clustered at `3.5 * base_size` tiles apart (converted to an angle via the ring's own nominal radius) rather than each taking a full ring slot, with no per-player jitter inside a group.
- **Zones**: player default `playerNumber - 10`; `create_land` default `-10`; explicit `zone N` wins over any default; `set_zone_by_team` — deliberately emulates guide:1055's footgun (it ALWAYS reads player 1's canonical team, regardless of whose land it is, on an unassigned neutral land included); `set_zone_randomly` draws uniformly from `[-8, playerCount-9]` (guide:1071).
- **Origin stamp**: square `2*base_size+1` (or the inscribed circle under `set_circular_base`) written onto `landId`/`zone`, later origins overwriting earlier overlapping ones by simple placement-order iteration — "the land placed last will be the one visible" falls out of processing order rather than needing an explicit precedence rule.

**The negative-`circle_radius` mixture, worked by hand because there's no way to look it up.** Sec.6.1 measured mean radius `0.276*dim`, CV 0.44, and says "start with a mixture, weight [tune] fitted to CV 0.44" without doing the algebra. Both proposed components — a uniform radius on `[0, 0.552*dim]` (CV `0.577`) and a uniform point in a disc of radius `0.414*dim` (CV `~0.354`) — already hit the target MEAN exactly, so mixing them at any weight preserves the mean and only the resulting variance depends on the mixing weight `p` (no cross term, since the two component means are equal). Solving `p*Var(disc) + (1-p)*Var(uniform) = (0.44 * 0.276*dim)^2` gives `p ~= 0.671` (probability of the disc draw). Implemented with NO `Math.sqrt`/`Math.pow` (Sec.8's ban applies to this file too): the disc component is sampled by Cartesian rejection (draw `dx,dy` uniform in the bounding square, accept if `dx^2+dy^2 <= r^2`) rather than the textbook `r*sqrt(u)` inverse-CDF, which needs a square root this file isn't allowed to call.

**One thing added to `rng.ts` to make the mixture possible**: `nextFloat01(rng)`, a uniform `[0,1)` float via plain division — the first caller in this codebase to need a continuous draw rather than `nextInt`'s integer range. Tested in `rng.test.ts` alongside the existing `nextInt` suite (determinism, range, and a loose mean-near-0.5 sanity check over 5000 draws).

### Verification

Tested through the real pipeline end-to-end (`parseRms` -> `instantiateScript` -> `createTileGrid` -> `placeLandOrigins`), matching `validate.test.ts`/`instantiate.test.ts`'s convention rather than hand-built fixtures. `src/preview/__tests__/lands.test.ts`, 23 tests, plus 3 new `nextFloat01` tests in `rng.test.ts` and a corpus smoke gate (every tracked `.rms`, asserting `placeLandOrigins` never throws). Sanity-checked the two hardest-to-assert-exactly behaviours (`grouped_by_team`'s clustering, the negative-`circle_radius` scatter) by printing real coordinates from a throwaway test before writing the final assertions — team clusters came back ~186 degrees apart against a measured 176-180, and the scattered radii spanned 19-39% of dim around the target mean without collapsing to one value.

**Mutation-tested five of the riskiest lines, all confirmed red on the first try then reverted**: the player-zone default (`-10` to `-9`), the circular-stamp clip predicate (disabled entirely), the `set_zone_by_team` footgun (hardcoded to un-teamed), and the `circle_radius 0` fallback branch (disabled, breaking the byte-identical-to-absent guarantee).

`npm test` — **30 files / 693 tests** (was 29/667; `lands.test.ts` +23, `rng.test.ts` +3). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline.

**Not started:** growth (the frontier weight-bucket structure Sec.11 specifies, the `cf`-dependent detached-seed reservoir, `border_fuzziness`'s fringe-tile roll, zone-avoidance-during-growth), `base_elevation` application, and the full `assign_to`/`assign_to_player` ring-membership integration flagged above. `elevation.ts`/`cliffs.ts`/`terrains.ts`/`connections.ts`/`objects.ts` (S2-S6) are all still unbuilt and unblocked-but-not-started; nothing generates a full map yet.

## `lands.ts`: growth (2026-08-06)

Closes the growth gap the previous session flagged as the next `lands.ts` priority. `growLands(origins, grid, reports, masterSeed)` grows every `LandOrigin` from its origin stamp toward `declaredTargetTiles`, mutating `grid.landId`/`grid.zone` and appending `growthShortfall`/`iterationCapped` failures into the SAME `CommandReport` its origin came from (matched by `commandSpan`, so every player-land from one `create_player_lands` shares that command's one report, per Sec.7).

**All three of Sec.6.1's growth mechanisms landed**: the round-robin frontier-bucket sampler (guide:927's clumping regimes, MEASURED RMSTEST_21 — weight rises continuously with `neighborsOwned`, saturating by `cf~=15`, only the negative regime is qualitatively different); the `cf`-dependent detached-seed reservoir (fragmentation, MEASURED RMSTEST_38's piece-count table); and the three per-candidate rejection rules (border, per-pair `other_zone_avoidance_distance`, already-owned) that a drawn candidate has to clear before it's claimed.

**Two decisions worth recording because they simplified real complexity rather than dodging it:**

- **`R(cf)`, not `w(cf)`, is where the cf-dependence actually lives.** Sec.6.1 asks for `w(cf)` (the per-turn probability of drawing from the reservoir) to be fitted to the measured piece counts. Working through the numbers: since a land's turn count (its tile target) is normally far larger than a small reservoir, virtually every reservoir tile gets drawn eventually as long as the per-turn probability isn't tiny — so final piece count is dominated by the reservoir SIZE, not the draw probability, which mostly just controls how fast it's spent. Sec.6.1 explicitly licenses this reparameterisation ("what is measured is the piece-count column, and any mechanism reproducing it is admissible"): `reservoirSize(cf)` carries the measured cf-dependence (linear interpolation hitting the two named endpoints, `0` at `cf>=20` and `7` at `cf<=-20`), `RESERVOIR_DRAW_PROBABILITY` is one fixed constant.
- **A rejected growth candidate is discarded permanently, never re-offered.** All three rejection reasons (border, zone, already-owned) are static with respect to a fixed grid state — a border violation never stops being one, a claimed tile never becomes unclaimed — so a candidate rejected once can never become acceptable later. Dropping it on rejection (rather than keeping it in its bucket for a future round) costs nothing in correctness and is the natural O(1) reading of Sec.11's "no sorting, no re-weighting."

**One deliberate, flagged deviation from Sec.11's literal data-structure spec.** Sec.11 asks for the frontier as `Int32Array` buckets with a `Uint8Array` membership flag, calling this "part of the spec, not an optimization pass." This session used plain arrays and a `Set` instead — behaviourally identical (same draws, same distribution, same O(1) draw/pop), just without the typed-array constant-factor guarantee. No benchmark gate exists yet to measure against (Sec.11's own gate isn't built), so this session prioritised the algorithm's correctness over matching its exact prescribed data structure. Recorded here rather than silently done, since CLAUDE.md's hard rule is "escalate a deviation, don't improvise one" — this one is flagged for whoever builds Sec.11's benchmark next, at which point it's a mechanical rewrite against a real measurement rather than a guess.

**Deliberately NOT implemented: the measured growth-overshoot number (+3 to +4.6% over target at most `cf`, -6.5% under at `cf -20`).** Sec.6.1 measures this as a real engine behaviour but doesn't prescribe a mechanism for it (unlike the reservoir, where "any mechanism reproducing the measurement is admissible" is stated explicitly). Inventing a plausible-but-unverified fudge factor to hit a number without a known cause is exactly the "confidently wrong" failure CLAUDE.md's hard rules repeatedly warn against, so this session's `growLands` stops cleanly at target rather than manufacturing an overshoot. Tracked as a known gap, not silently absent.

### A mutation test that found a real hole in what an earlier test could prove

The first `it("high clumping_factor produces a single connected piece...")` test passed **even after `bucketWeights` was mutated to return uniform weights for every `cf`.** Working out why was the useful part: `reservoirSize(cf)` is `0` for every `cf >= 20` regardless of `bucketWeights`, and a pure frontier walk (candidates always 4-adjacent to owned tiles) is connected BY CONSTRUCTION no matter how the four buckets are weighted — so the "single piece at high cf" outcome the test asserted was actually pinned entirely on `reservoirSize`, never on `bucketWeights`, and the two are entangled at every `cf < 20` (where `reservoirSize` is also non-zero) so no combination of cf values run through the FULL pipeline can isolate one from the other. Confirmed by mutating `reservoirSize` alone (with `bucketWeights` untouched) — the same test failed exactly as expected. Fixed by exporting both functions and unit-testing them directly (`bucketWeights`/`reservoirSize` describe block in `lands.test.ts`), which is also how the mutation on `bucketWeights` itself was subsequently confirmed to go red. The general lesson, consistent with this project's standing rule about checks that have only ever passed: a full-pipeline outcome test can look like it covers a mechanism while actually being insensitive to it whenever a SECOND mechanism alone is sufficient to produce the same observable — worth checking for on any test whose assertion could be explained by more than one code path.

### A second bug the same practice caught: a corpus test structured wrong, not written wrong

The corpus smoke test (`placeLandOrigins` + `growLands` over every tracked map) was written as a single `it()` looping over 30+ files, unlike this project's established per-file pattern (`corpus.test.ts`, and this session's own earlier `instantiate.test.ts`/`grid.test.ts`). It passed in isolation and then timed out at vitest's default 5s per-test limit when the FULL suite ran under normal machine load — not because any one map is slow (profiled: all 32 tracked maps combined run in under 2s in isolation, including `Crownwood.rms`'s deliberately-unclamped `land_percent 1024`, which legitimately runs every step of the `4*dim^2` iteration cap before giving up), but because a single `it()` accumulates every map's time against ONE timeout, and vitest's timeout is per-test, not per-file. Rewritten to one `it()` per map, matching convention; the full suite passed clean afterward. Recorded because it reproduces this project's own "a wall clock on a shared machine measures the machine" lesson (the Vanguard benchmark fix) in a new shape — this time the fix was structural (test granularity) rather than a threshold change.

### Tests

`src/preview/__tests__/lands.test.ts` grew from 23 to 66: 8 growth-behaviour tests (target growth, the border hard-stop and the `border_fuzziness 0` disable, zone-avoidance separation, no-double-claim, `cf` round-vs-fragmented shape, `growthShortfall`, `behavior_version 1`'s inclusive target), 3 direct unit tests for `bucketWeights`/`reservoirSize` (added after the mutation-test finding above), and the corpus smoke gate rewritten to one test per tracked map (33, up from 1). Sanity-checked visually before finalising assertions — printed an ASCII render of a `cf=100` land (single round blob), a `cf=-20` land (visibly fragmented into several pieces), and a full 8-player ring after growth (eight independent, non-overlapping blobs) from a throwaway test before trusting the numeric assertions.

**Mutation-tested five of the growth-specific lines.** Two initial attempts (the two-different-zone-lands test, the border-disabled test) passed even with their target mechanism disabled, both for the same underlying reason: the test's SCENARIO didn't force the mechanism to matter (lands too far apart to ever compete for zone-avoidance; a target small enough to fit inside the bordered region even with the border enforced) — both fixed by choosing scenarios that only succeed if the real mechanism is active, then reconfirmed red-then-green. The `bucketWeights`-vs-`reservoirSize` entanglement above is the same category of finding at the unit level. Final five, all confirmed red then reverted: the `border_fuzziness 0` bypass, the zone-avoidance rejection, `reservoirSize`'s cf-dependence, and `bucketWeights`' two shape claims (negative-regime bias, saturating steepness).

### Verification

`npm test` — **30 files / 736 tests** (was 30/693; no new test file, `lands.test.ts`'s own count grew from 23 to 66). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. Confirmed the full suite passes clean under normal load after the corpus-test restructure (it had failed once, from the timeout bug above, before the fix).

**Still not started:** `base_elevation` application (Sec.6.1: applied AFTER growth, clamped to [1,16] with negative meaning 16, skipped for water `terrain_type`, gated on `<ELEVATION_GENERATION>` presence — none of that is built), the full `assign_to`/`assign_to_player` ring-membership integration (still the top-flagged gap from the previous session), and every stage S2-S6. `lands.ts` itself is now functionally complete for origin placement + growth; `base_elevation` is the natural next piece since it is still this stage's responsibility (Sec.6.1, not S2 elevation) before moving on to S2 proper.

## `lands.ts`: assign_to integration, then base_elevation (2026-08-06)

Both of the two gaps the previous session flagged, closed in one sitting. `lands.ts` is now a complete implementation of Sec.6.1 short of growth's one deliberately-undone item (the measured overshoot percentage) and the Flags argument.

### assign_to / assign_to_player

Sec.6.1's own sanctioned scope: `AT_PLAYER`/`AT_COLOR`/`AT_TEAM` with `Mode`, everything but `Flags`. The reason this was deferred rather than rushed last session is structural and real: an `assign_to`'d `create_land` "takes a ring slot, like a player land" (guide:1016), so origin placement can't place any ring member — implicit or assigned — until it knows the FULL ring membership. `placeLandOrigins` is now two passes: one scan that resolves every assignment, places neutral lands immediately (they don't depend on ring membership), and COLLECTS everything ring-eligible; then one placement pass over the combined membership.

**What's modelled, matching the guide's own enumerated list (guide:994-1016):**

- `AT_PLAYER n` / `AT_COLOR n` resolve to player `n` directly (`AT_COLOR` gets a `notSimulated` note, since the preview has no colour assignment to differ from `AT_PLAYER` with).
- `AT_TEAM n` builds a candidate pool from canonical team membership (`n>0` -> that team, `0` -> un-teamed, negative except `-10` -> NOT that team, `-10` -> anyone) MINUS players already given a land by an earlier `assign_to` — guide:1008's default "remembering" behaviour, which the (unmodelled) `Flags` argument would override. `Mode -1` picks lobby order (lowest eligible player number); `Mode 0` draws from the S1 substream.
- **Lands assigned to non-playing players are not created** (guide:1015) — no origin, `attempted:1, placed:0`, one drawer note. Same fate for an `AT_TEAM` domain with no eligible player left.
- `land_position` is ignored on an assigned land unless `direct_placement` is set (guide:1016) — checked FIRST in the per-slot placement logic, ahead of the ring math, matching "getting this backwards puts every assigned land at its written coordinates... a whole-layout error rather than a detail."

**One incidental correctness improvement, not scope creep — worth flagging because it changes existing behaviour.** The OLD code processed each `create_player_lands` occurrence independently with its own full ring, which never actually implemented Sec.6.1's "with multiple `create_player_lands` commands, only the final radius applies" (guide:856). Building the combined-ring machinery for `assign_to` extras made it natural to fix this at the same time: every `create_player_lands` occurrence now contributes its `playerCount` slots to ONE shared ring, geometry governed by the LAST occurrence — matching the guide rather than diverging from it further. `assign_to`'d extras never redefine the shared geometry themselves; they only take a slot on whatever ring `create_player_lands` (if any) already defined, falling back to the same default-ring parameters the no-`circle_radius` branch already used when no `create_player_lands` command exists at all.

**guide:857's documented engine bug, deliberately emulated rather than "fixed."** Under `grouped_by_team`, "additional [player] land positions do not generate properly" — a real, named engine bug, not a gap in the spec's own model. An `assign_to`'d extra under `grouped_by_team` is placed at the map center with a `notSimulated` failure explaining why, rather than this session inventing a "correct" clustered position the real engine doesn't produce. The ordinary (non-grouped) ring integration above is unaffected — the bug is specifically a `grouped_by_team` interaction.

### base_elevation

The last of Sec.6.1's own responsibilities, applied strictly after growth per the guide's own ordering ("after growth, set elevation = H"). `applyBaseElevation(instantiated, origins, grid)`: for each land with a declared, non-zero `H`, clamp (negative -> 16, CONFIRMED in-game; above 16 -> 16 — `elevation` is a `Uint8Array`, so an unclamped `-1` would store 255 and paint the land blinding white under the renderer's brightness shading) and write it to every tile the land currently owns. Two skip conditions, both guide-cited: a water `terrain_type` (guide:959, "doesn't work in HD/DE" — reuses `grid.ts`'s `/WATER/` name heuristic, now exported, rather than a second copy) and a missing `<ELEVATION_GENERATION>` section anywhere in the script (guide:952 — an EMPTY section satisfies it; the guide reports the game crashes when the map is later played without one, which is `validate()` territory tracked in CLAUDE.md, not this function's job — this function only matches the silent-failure half so the preview doesn't render a slope the engine wouldn't).

One tile-count optimisation worth naming: rather than scanning the whole grid once per land (`O(numLands * dim^2)`), the function computes a per-land target-or-skip lookup first, then does ONE pass over the grid consulting it — the same "single combined pass" shape growth's own ownership/frontier seeding already established.

### Tests

`src/preview/__tests__/lands.test.ts` grew from 66 to 89: 15 `assign_to` tests (each `AT_TEAM` domain, the remembering behaviour, both `Mode`s, the not-created case, the ring/`grouped_by_team` integration, `direct_placement`'s override, a standalone assign_to'd land with no `create_player_lands` at all) and 7 `base_elevation` tests (the clamp both directions, the H=0 no-op, the water skip, the missing/empty-section cases, cross-land isolation). The corpus smoke gate now runs `applyBaseElevation` too. Sanity-checked the N+M ring integration visually (a throwaway test printing real coordinates: 6 ring members at roughly 60-degree spacing with the default ring's own jitter, three separate `CommandReport`s) before trusting the assertions.

**Mutation-tested five of the highest-risk new lines, all confirmed red then reverted**: the "remembering" exclusion (disabling it let two `AT_TEAM` commands double-assign the same player), the non-playing-player range check on `assign_to_player`, the `AT_TEAM` negative-`n` candidate filter (flipped to require the excluded team instead of excluding it), the `grouped_by_team` bug-emulation flag, `clampElevation`'s negative branch, the water-terrain skip, and the missing-`<ELEVATION_GENERATION>` gate.

### Verification

`npm test` — **30 files / 759 tests** (was 30/736; `lands.test.ts` alone grew from 66 to 89, no new test file). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline.

**Still not started:** growth's measured overshoot percentage (deliberately not implemented — no mechanism is specified for it) and `assign_to`'s `Flags` argument (both recorded as known, deliberate gaps, not oversights) — these are the two remaining Sec.6.1 items with no plan to close them without a new observation. Every stage S2-S6 (`elevation.ts`/`cliffs.ts`/`terrains.ts`/`connections.ts`/`objects.ts`) and `index.ts`'s `generatePreview()` are still unbuilt. `lands.ts` (S1) is now a complete, standalone implementation of everything Sec.6.1 asks for except those two named gaps.

## `elevation.ts`: S2 (2026-08-06)

The first stage after S1. Per `create_elevation MaxHeight { ... }`: resolve the tile/clump budget (Sec.4's scaling formula, its first real caller in this codebase), pick seeds (terrain-matched, kept away from player-land origins, diagonally biased per the measured seed study), grow each clump like a land region, then stamp a concentric-ring height profile that ADDS onto whatever `base_elevation` already wrote.

**Reused rather than re-derived, twice.** `bucketWeights` (lands.ts, exported already) supplies the frontier-growth weight shape at a fixed "moderate" `cf=8` — `create_elevation` has no `clumping_factor` attribute of its own, so there is nothing per-command to read, and Sec.6.2 explicitly asks for "the same" shape lands.ts already has. Sec.7's `intersectCandidates`/`AttributedPredicate` machinery (placement.ts, built in the RNG/placement session and unused since) is what the seed-eligibility check runs on: two predicates, terrain-match then player-origin distance, in the exact order that makes the failure bucket (`terrainAbsent` vs `playerOriginAvoidance`) fall out of Sec.7's own attribution rule instead of a hand-written if/else.

**Added to grid.ts**: `scaleToMapArea(declared, dim)`, Sec.4's `set_scale_by_size`/`set_scale_by_groups` formula (`floor(declared * dim^2 / 10000)`) — no earlier stage needed it (`create_land` has no scale attributes), so this is its first real caller. Lives in grid.ts rather than elevation.ts because it is Sec.4 arithmetic, the same reasoning that put `borderBounds`/`percentRound` there.

**The "only the LAST scale attribute applies" resolution (guide:1257/1274) needed its own logic**, and isn't free from Sec.3's own attribute folding: `set_scale_by_size` and `set_scale_by_groups` are two DIFFERENT attribute names, so instantiate.ts's per-name last-wins folding doesn't collapse them — a script writing both leaves both present in the command's attribute map, and `lastScaleAttribute()` resolves the tie by comparing the two attributes' own source spans.

**The ring-height profile** is a small multi-source BFS (`clumpEdgeDistances`) seeded from every clump tile touching a non-clump tile OR the map edge (both count as "the boundary" — there is no clump tile beyond either), then `elevation = min(h, floor(depth/spacing))` per tile, clamped to 16 and ADDED to whatever's already there rather than overwritten. Visually confirmed with an ASCII render before trusting the numeric assertions — a 400-tile clump at MaxHeight 6 came back as clean concentric rings (`1` through `6`, deepest at the center), not a noisy scatter.

### The density-amplification calibration, done honestly rather than skipped

Sec.6.2 gives a formula shape (`seedRatio = clamp(1.3 + A*max(0, density-d0), 1.3, 20)`) but explicitly withholds the fitted value of `A`, insisting instead that "the fit targets the OUTPUT... run the generator, count elevated tiles, compare" against its own five-point table (50/100/250/500/1000 clumps on a 200 map -> tile ratios 1.45/1.88/3.74/7.01/14.88). This session ran that calibration rather than guessing a constant blind.

**First attempt failed for an informative reason.** Measuring at the shipped default (clumps at the RMSTEST_22a 6-tile floor) gave almost no signal — a compact 6-tile clump frequently has ZERO tiles more than one step from its own boundary, so almost nothing is ever "elevated" (ring value > 0) to count favoured/disfavoured tiles from at all. Re-measured with a larger per-clump budget (tens of tiles per clump, enough to guarantee real interior tiles) to get a usable sample, landing `A = 900`:

| clumps | target ratio | measured (this session's calibration) |
|---|---|---|
| 100 | 1.88 | 1.41 |
| 250 | 3.74 | 1.30 (at the knee — see below) |
| 500 | 7.01 | 5.98 |
| 1000 | 14.88 | 14.64 |

**Fits well above the knee, badly AT it.** 500 and 1000 clumps land within about 15% and 1.5% of the table; 250 clumps — sitting almost exactly at the modelled knee `d0`, where the formula is pinned to the flat 1.3 floor by construction — comes in at barely a third of the table's 3.74. No value of `A` fixes this specific point, since the formula is flat at the knee regardless of `A`; the mismatch says the knee's actual location (or the "flat below it" shape itself) is off, not that the amplification slope is. Recorded as a known, unresolved gap rather than quietly tuned away — Sec.6.2 itself flags the knee's location as `[verify]`, and this measurement is a first data point toward re-locating it, not a fix.

**What this is and is not.** A genuine first-pass calibration against the spec's own methodology, with the actual numbers this session measured — not the "run it once, ship whatever came out" version, but also not the iterated, multi-round fit the spec describes as ideal. Tracked as open work, same as the reservoir's `R`/`w(cf)` constants were in lands.ts's growth session.

### Two findings from mutation testing, the same category as lands.ts's session

**A test that looked like it covered `applyElevation`'s ring-clamp line didn't.** `growClump`/`clumpEdgeDistances` were exported for direct unit testing (mirroring `bucketWeights`/`reservoirSize`'s precedent), and the first version of a "ring formula" test computed `min(h, floor(depth/spacing))` INLINE in the test rather than calling anything in `elevation.ts` — so mutating the real `min(h, ...)` clamp in `applyElevation` left that test green. The full-pipeline "single-clump always attempts MaxHeight" integration test does catch the same mutation (confirmed). Fixed by re-scoping the unit test's claim to what it actually verifies (`growClump` reaches a real depth) rather than deleting it, and recording in a comment which test actually covers the mutated line. Same lesson as lands.ts's `bucketWeights`-via-`reservoirSize` finding: an outcome test can look like it covers a mechanism while being sensitive to a completely different one, or in this case, to none of the real code at all.

**The corpus-gate timeout mistake from the lands.ts growth session recurred in this file's first draft**, caught before it ever ran green: a single `it()` looping over 30+ maps. Fixed to one `it()` per map before running the suite at all, per the convention `corpus.test.ts`/`instantiate.test.ts`/`lands.test.ts` already establish.

### Tests

`src/preview/__tests__/elevation.test.ts`, new file, 59 tests: `resolveTileBudget`/`resolveClumpCount` tested directly against real attribute folding (RMSTEST_14's un-scaled default, `set_scale_by_size`/`groups`, the last-attribute-wins tie-break, the 6-tile floor), `seedRatio` at and above the knee with the RMAX clamp, `eligibleSeedCandidates`'s two-predicate attribution (both failure buckets, a success case, `base_layer` filtering), `drawSeed`'s diagonal bias and spacing rejection as isolated units (avoiding the small-clump sparse-signal problem the calibration run hit), the height/ring profile, the additive-onto-`base_elevation` and clamp-at-16 contracts, and a per-file corpus smoke gate (33 tests, one per tracked map).

**Mutation-tested five of the riskiest lines, all confirmed red then reverted** (one on the second attempt, once the misleading unit test above was correctly re-scoped): the diagonal-bias split, the ring height clamp (caught by the integration test, not the misleading unit test), the last-scale-attribute tie-break, and the player-origin distance predicate (two tests, both confirmed).

### Verification

`npm test` — **31 files / 818 tests** (was 30/759; new `elevation.test.ts` +59). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. Full suite run twice to confirm stability after the corpus-gate structure was gotten right the first time.

**Not started:** S3-S6 (`cliffs.ts`/`terrains.ts`/`connections.ts`/`objects.ts`) and `index.ts`'s `generatePreview()`. Growth's measured overshoot (Sec.6.2 calls implementing it "optional and low priority") and the density-amplification knee mismatch above are both deliberate, recorded gaps rather than unbuilt features.

## `cliffs.ts`: S3 (2026-08-06)

Per `create_elevation`, `create_land`: a normal command loop. `<CLIFF_GENERATION>` is not — the language has no `create_cliff` command at all, only standalone attributes (`min_number_of_cliffs`, `cliff_curliness`, ...) sitting directly in the section, and the section's mere presence is the generative act ("simply typing the section header will generate default cliffs" — guide, Sec.6.3). So this file's shape differs from every earlier stage: `resolveCliffSettings` folds the section's standalone `InstantiatedCommand`s into one settings record (last-one-wins by script position, the same policy Sec.3 rule 10 uses for block attributes, applied here to top-level commands instead since there is no attribute map for the parser to fold them into), and `applyCliffs` emits exactly one `CommandReport` for the section as a whole rather than one per command.

**Reused Sec.7's `intersectCandidates` again**, third stage running on it (after `elevation.ts` and, structurally, `lands.ts`'s reservoir seeding) — five predicates in Sec.6.3's own listed order (land-origin distance, water, slope, cliff spacing, terrain/water distance), so `eligibleCliffStartTiles` gets its failure attribution for free the same way `elevation.ts`'s seed selection does.

**Added `distanceTransformFromMask` to grid.ts**, a sibling to the existing `distanceTransform` rather than a generalisation of it: cliffs need distance from a name-heuristic water mask and from the live, mutating `cliff` mask, neither of which is "distance from a single terrain id", and Sec.6.4's own pinned approximation ("cliff tiles also count as foreign terrain for this spacing") means `terrains.ts` will want the same mask-based BFS next. Deliberately NOT implemented by having `distanceTransform` call the new function internally — same reasoning grid.ts already gives for keeping `percentRound`/`scaleToMapArea` un-unified: an edit to one must not risk silently changing the other's already-tested behaviour.

**Slope has no existing helper anywhere in `generator/`** — it was purely a rendering concept (`terrainBitmap.ts`'s light-direction shading) until this session. `computeSlopeMask` is new: a tile is sloped when any in-bounds 4-neighbour carries a different elevation value, computed once per `applyCliffs` call since S2 has already run by S3 (Sec.6.3's own note) and the grid's elevation is final for this stage.

**The walk** (`walkCliff`): a 3-tile starting stub in a random initial direction, then `len` more 3-tile segments, each with a `curliness`% chance to turn before it is laid — the `+1` in Sec.6.3's own tile formula (`3*(len+1)`) falls out of this construction for free rather than needing to be asserted separately. A step that would leave the grid, land on water, or land on an already-cliffed tile (this cliff's own earlier tiles included, which makes it self-avoiding for free) truncates the walk right there, matching the guide's "may end up shorter".

**One judgment call, recorded in the file header rather than left implicit.** Sec.6.3 groups land-origin distance, water, slope, cliff-spacing and terrain-distance under "Start tiles:", then separately says only that "walk steps that would violate constraints truncate the cliff" — without saying which constraints re-apply mid-walk. Re-checking the full five-predicate set per tile would mean a distance-transform rebuild after every single tile rather than every cliff, for a feature Sec.6.3 itself frames as "coarse... layout honesty, no fine geometry". `walkCliff` re-checks only grid bounds, water and cliff-overlap mid-walk — the three whose violation would look outright broken on a render — and leaves the three distance-band constraints as start-tile-only, matching where Sec.6.3's prose literally places them.

**Two zero-cliff cases, both modelled as "zero cliffs plus a note" rather than clamped**, per Sec.6.3's own explicit instruction for both: `min_number_of_cliffs > max_number_of_cliffs` ("crashes the engine" — the preview must not throw, so it shows nothing instead) and `min_length_of_cliff < 3` ("produces no cliffs at all" — language.json's own pinned `min: 3`, with a detailed `notes` field explaining why six DE-official maps writing 1 or 2 there does not license widening it). Neither gets a `SimulationNote` for cliff fine geometry itself — Sec.9 item 7 already lists that as a standing, blanket exclusion, so a per-instance note would be redundant. `cliff_type` (visual cliff material) is read by nothing here either: the renderer already draws every cliff one flat colour, so the attribute has no effect on the grid, and per Sec.9 items 5/6's precedent for gameplay/visual-only attributes it does not need a note.

**The count roll's own edge case**: Sec.6.3 states "uniform `[min, max)`", max exclusive, but does not say what happens when `min == max` — a literal empty-interval reading would need special-casing to avoid dividing by zero. `nextInt(rng, min, Math.max(min, max - 1))` collapses to exactly `min` in that case rather than throwing, matching how every other defensive clamp in this codebase (`elevation.ts`'s `Math.max(1, scaled)` clump count, `lands.ts`'s `growthShortfall` handling) treats an edge the spec doesn't name rather than leaving it to fail.

### Tests

`src/preview/__tests__/cliffs.test.ts`, new file, 62 tests: `resolveCliffSettings` (defaults, every attribute read, last-one-wins on a duplicate), `computeSlopeMask` (flat grid, a single raised tile and its neighbours), `eligibleCliffStartTiles` (all five failure buckets exercised individually, plus a success case checked against the land-origin distance it actually returned), `walkCliff` as an isolated unit (exact tile count for a straight walk, a non-collinear shape at curliness 100 over 20 seeds, truncation at a 1x1 grid's edge, truncation into water and into an existing cliff — the last two constructed so the assertion holds regardless of the walk's own randomly-rolled initial direction), `applyCliffs` end to end (no section, an empty section still generating with defaults, both zero-cliff cases and their notes, the `min == max` degenerate count, water/slope/land-origin avoidance measured directly off the grid after a real run, and a full S1-S3 pipeline smoke test), a per-file corpus gate (one `it()` per tracked map, following the established convention rather than the single-loop shape that caused a timeout in an earlier session), and two direct tests of the new `distanceTransformFromMask` in grid.ts.

Two test-construction bugs were caught and fixed before trusting the suite, both worth naming since they were test bugs, not implementation bugs: the land-origin-exclusion test's original 40x40 grid was too large for a centred origin's 22-tile rule to exclude every tile (a corner sits ~28 tiles out), fixed by shrinking to a 15x15 grid with the origin at a corner; and the cliff-overlap truncation test originally pre-filled the ENTIRE grid as cliff before running the walk, so the tile-count assertion was measuring the fixture's own setup rather than anything `walkCliff` did — fixed by pre-cliffing only the four tiles one step from the start in each direction, isolating the walk's actual contribution.

**Mutation-tested two lines, both confirmed red then reverted**: adding a banned `Math.sqrt` call to `cliffs.ts` (confirms the Sec.8 lint gate's glob still covers a file that didn't exist when that gate was written), and shifting the `min_length_of_cliff < 3` threshold by one (confirms the suppression-note test actually exercises the boundary rather than a looser condition).

### Verification

`npm test` — **32 files / 880 tests** (was 31/818; new `cliffs.test.ts` +62). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. `npm run validate:reference` clean (no reference-data files touched this session; run anyway since the gate is cheap).

**Not started:** S4-S6 (`terrains.ts`/`connections.ts`/`objects.ts`) and `index.ts`'s `generatePreview()`. The walk-truncation judgment call above (which constraints re-check mid-walk) and the min==max count-roll clamp are both deliberate, recorded gaps rather than oversights — Sec.6.3 doesn't pin either, and the reasoning for the choice made is in the file header, not just this log.

## `terrains.ts`: S4 (2026-08-06)

Per `create_terrain T { ... }`, sequential in script order: resolve a tile budget (side-length-scaled default, `land_percent`, or `number_of_tiles` — with the terrain-specific rule that `set_scale_by_groups` scales BOTH clumps and tiles here, unlike elevation where it scales only clumps), then grow `number_of_clumps` clumps restricted to an eligible-tile set, using terrain's OWN `clumping_factor` regime rather than reusing lands.ts's table (Sec.6.4 says so explicitly; RMSTEST_20's saturation point happens to equal lands' RMSTEST_21 saturation point, coincidence in the data rather than a reason to import it). `computeSlopeMask` moved from `cliffs.ts` to `grid.ts` first (alongside `waterMask`/`forestZoneMask`) since this file needs it too, for `set_flat_terrain_only` — `grid.test.ts` and `cliffs.test.ts` both updated, no behaviour change.

**Three deliberate simplifications, recorded in the file header because the one-line spec clauses they come from underspecify the mechanism**: `set_flat_terrain_only`'s "also >= spacing from sloped tiles (only when spacing >= 1)" is modelled as a direct, unconditional "reject any sloped candidate" rather than extending the spacing distance transform conditionally; `set_avoid_player_start_areas`'s "with mild variance" drops the variance (unquantified, and Sec.7's `AttributedPredicate.test` has no RNG access to thread it through); `terrain_mask 1/2` ("mask over" vs "mask under, swap-with-layer") collapses to one behaviour — write into `grid.layer` instead of `grid.terrain` — since Sec.9 item 6 already lists true blending as not simulated, with a note saying so.

### The performance bug, caught by the corpus gate rather than shipped

**First implementation recomputed the full eligible-tile candidate set (base match, height_limits, both spacing flavours, flatness, player-avoidance — an O(dim^2) `intersectCandidates` pass, with `spacing_to_specific_terrain`/`spacing_to_other_terrain_types` each adding a further O(dim^2) distance-transform BFS) once PER CLUMP, reasoning that an earlier clump's painted tiles must stop being eligible for the next one.** That reasoning is correct; the implementation was not, because the corpus's own `24hr_Blind Valley.rms` declares `number_of_clumps 9320` three separate times (matching the guide's own worked `create_terrain` example) — once under `set_scale_by_groups`, which this file's own terrain-specific scaling rule turns into tens of thousands — and other corpus scripts declare `number_of_clumps` up to `999999999`. The corpus test hung: a first `npx vitest run` on the new suite never printed past the `RUN` header and had to be killed via `Stop-Process` after burning 569 CPU-seconds, because a tight synchronous JS loop blocks the event loop entirely and vitest's own 5000ms per-test timeout can never fire while it's running — the timeout mechanism itself needs the event loop free.

**Fixed by computing the eligible set ONCE per command instead of once per clump** (matching elevation.ts's own precedent, which this file's first draft had diverged from without registering why): a static `eligibleMask` from the one `intersectCandidates` pass, plus a separate live `claimed` mask that grows tile-by-tile as each clump is painted, checked alongside `eligibleMask` during frontier growth. Seed draws against the cached candidate pool are bounded rejection sampling (`SEED_PICK_ATTEMPTS = 100`, mirroring lands.ts's `ORIGIN_ATTEMPTS`) rather than a set rebuild. This is an approximation, not a re-derivation of the exact same behaviour: `otherTerrainSpacing`/`specificSpacings` now reflect the grid as it stood when the COMMAND started rather than live per clump, meaning a later clump of the same command stays at least as spaced from an earlier one as the check demands, never less — a conservative, documented simplification rather than a silent behaviour change.

**Sec.11 was already the answer for the residual cost.** Even at O(1)-ish per clump, 999999999 attempts is not free, and Sec.11 names this exact scenario by number ("9320-clump commands... per-command iteration caps kick in... report the truncation as an `iterationCapped` failure plus a SimulationNote, never hang"). `MAX_CLUMP_ATTEMPTS_PER_DIM = 4` (attempts capped at `4 * dim`, not `4 * dim^2` — the literal `4*dim^2` total-ops reading, divided by an O(dim^2)-per-clump cost, collapses to a size-independent handful of clumps that would wrongly cap an ordinary script asking for a few dozen) closes the gap. Confirmed by mutation test: disabling the cap (`maxAttempts = clumpCount`) and re-running just the pathological-clump-count test required killing the run again after a 20-second hard timeout — proof the test catches the exact regression it exists to guard against, not just a slower-but-fine path.

**The corpus gate is what caught this, not intuition or code review.** Nothing about the implementation LOOKED wrong in isolation — it was a plain, readable per-clump loop calling an already-tested function. The failure mode only exists at the intersection of "a real script uses an extreme value" and "this file's cost model differs from its neighbours' in a way nothing forced anyone to notice." Same shape as the corpus-gate timeout mistakes recorded in the lands.ts growth and elevation.ts sessions, one level more expensive: those were `it()`-per-30-maps structural mistakes caught before ever running; this one shipped a first draft that actually hung and had to be killed.

### Tests

`src/preview/__tests__/terrains.test.ts`, new file, 74 tests: budget/clump-count resolution (default formula, `land_percent`, both scale attributes and the terrain-specific "groups scales tiles too" rule, last-attribute-wins), `terrainBucketWeights` (uniform at 0, saturates at 15, negative regime), `eligibleTerrainCandidates`'s full predicate list with Sec.6.4's own spec-stated bucket assignment (`terrainAbsent` for the base match only, `spacingConflict` for every later predicate — not a judgment call, the spec says so directly), `growTerrainClump` including the new `claimed`-mask exclusion, and `applyTerrains` end to end (unresolvable terrain names, `terrain_mask`'s layer-write plus note, `beach_terrain`'s water-adjacency dressing and its documented `<CONNECTION_GENERATION>` no-op, `height_limits`, `growthShortfall`, cross-command eligibility, and the pathological-clump-count case). Plus a 33-test per-map corpus gate and two new `grid.test.ts` tests each for the relocated `computeSlopeMask` and `distanceTransformFromMask` (the latter previously only exercised indirectly from `cliffs.test.ts`, now covered where it actually lives).

**Three test-construction bugs caught and fixed before trusting the suite**, all worth naming: a `beach_terrain` test relied on a random 40-tile clump on a 40000-tile map happening to touch a 1-tile-wide water strip, which it essentially never does — fixed by confining the eligible base terrain to a single column directly beside water, so every reachable tile borders it by construction; a `growthShortfall` test asked for 5000 tiles on a Tiny map whose whole ~14400-tile area trivially satisfies that budget — fixed by asking for 999999, more than any map size could ever hold; and an `eligibleTerrainCandidates` unit test passed a non-player origin directly to the function expecting it to self-filter, when filtering to player-only origins is documented as the CALLER's job (matching elevation.ts's `eligibleSeedCandidates` precedent) — fixed by correcting the test's premise rather than the code.

**Mutation-tested three lines, all confirmed red (or, for the iteration cap, confirmed-hung) then reverted**: the Sec.8 lint gate against this new file, the `height_limits` predicate (AND to OR, caught by two different tests), and the iteration cap itself (removing it reproduced the exact hang the fix exists to prevent).

### Verification

`npm test` — **33 files / 956 tests** (was 32/880; new `terrains.test.ts` +74, plus 2 new tests each in the existing `grid.test.ts` and 2 removed from `cliffs.test.ts` when its now-redundant `distanceTransformFromMask` coverage moved to `grid.test.ts`). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. `npm run validate:reference` clean (no reference-data files touched). Full corpus gate (33 maps) now runs in ~5s for this file alone, down from a run that had to be killed after burning 569 CPU-seconds without completing.

**Not started:** S5-S6 (`connections.ts`/`objects.ts`) and `index.ts`'s `generatePreview()`. The three named simplifications above (flat-only's spacing extension, avoid-player-start's variance, terrain_mask's over/under distinction) and the once-per-command eligibility snapshot (rather than fully live per-clump) are deliberate, documented scope decisions, not oversights.

### `set_flat_terrain_only`'s spacing extension: corrected same session, not carried forward as a gap

The scoping decision above turned out to be wrong, and was caught immediately rather than surviving to a later session: `set_flat_terrain_only`'s "also >= spacing from sloped tiles (only when spacing >= 1)" was flagged as too marginal to implement, on the reasoning that it is a narrow interaction between two attributes. It is not marginal — the corpus's own `24hr_Blind Valley.rms` (already read in full for the iteration-cap bug above) combines `set_flat_terrain_only` with `spacing_to_other_terrain_types 1` in a live command, which this session had already grepped and quoted without registering the implication.

**Fixed properly rather than left as a documented gap.** `eligibleTerrainCandidates`'s `otherTerrainSpacing` block (the "foreign terrain" distance transform) now folds a sloped tile into "foreign" exactly when `ctx.flatOnly` is set — the block's own existing gate (`otherTerrainSpacing > 0`) already IS "spacing >= 1" for an integer attribute, so no new conditional was needed, only widening the mask. The separate unconditional "never paint ON a slope" predicate stays, since it is the flag's own base behaviour ("only paints this terrain onto flat ground") and must still apply when `spacing_to_other_terrain_types` is absent or 0 — the two predicates are deliberately redundant when both attributes are active, which costs nothing (a second pass over an already-filtered survivor set) and keeps each one independently correct for the case where the other doesn't apply. The file header's "THREE DELIBERATE SIMPLIFICATIONS" is now "TWO", with a note recording why the third was removed rather than silently dropping it from the list.

Two new tests distinguish the buffered case from the bare case (`flatOnly` alone excludes only the slope tile itself; `flatOnly` + `otherTerrainSpacing` excludes a whole buffer band around it) — 74 to 76 tests in `terrains.test.ts`. Mutation-tested by reverting to the old unconditional-only mask and confirming the new buffer test goes red, then restored.

`npm test` — **33 files / 958 tests** (was 956; +2 in `terrains.test.ts`). Full suite re-run twice; two unrelated tests (`lands.test.ts`'s `border_fuzziness f=100` growth test, `terrainBitmap.test.ts`'s pixel-count test — neither touched this session) failed under full-suite load both times but passed cleanly in isolation, matching this repo's own documented load-dependent flakiness pattern (`docs/build-log.md`'s 2026-08-01 entry, "a clean re-run on identical code gave 16/428"); not a regression from this change.

**The lesson, stated plainly because it is the second time this exact shape has cost a round-trip this session (the iteration-cap bug above is the first): grep the corpus before deciding a spec clause is marginal, not after.** The evidence that this combination was real was already sitting in this session's own terminal output.

## `connections.ts`: S5 (2026-08-06)

Per connection command, resolve a NODE SET and a PAIRING rule, then A* a path between each pair's regions and paint terrain along it. All six `create_connect_*` commands reduce to "resolve nodes, connect every pair" — even `create_connect_to_nonplayer_land`, whose pairing is bipartite (player x neutral) rather than within one set. `create_connect_teams_lands` groups by CANONICAL team (Sec.3.1's `teamModel.ts`, reused rather than re-derived) and produces zero pairs for canonical team 0 (un-teamed) — "not the team of everyone left over."

**`create_connect_same_land_zones` is modelled identically to `create_connect_all_lands`** ("all land origins, all pairs"), per Sec.6.5's own text, which lists both commands together against one shared behaviour rather than describing a zone-partitioned grouping for the former. Surprising given the name, but the design doc is explicit and gives no separate rule for it, and nothing elsewhere in the doc contradicts this reading — implemented as written rather than improvised around (CLAUDE.md: escalate a spec that looks wrong, don't guess a deviation; this one reads as deliberate, not wrong).

**Pathfinding is real A*, first genuine pathfinding need in this codebase.** Multi-source (every tile of the source land starts at cost 0) and multi-goal (search ends the moment ANY tile of the target land is reached) rather than point-to-point between origins, since a connection joins REGIONS, not single tiles. Heuristic is Manhattan distance from a candidate tile to the target land's bounding box — admissible because the guide's own "cost <=0 means impassable" puts a floor of 1 on any passable step, so true path cost can never undercut a box-distance lower bound. `Sec.11: "A* uses a binary heap"` — built one (`MinHeap`, exported and directly tested against a plain-sort reference over 200 random-priority pushes, including forced ties) rather than a naive linear-scan priority queue. **No special-casing needed for cliffs under a path**: `grid.terrain` already holds the terrain UNDER any cliff (`cliffs.ts` never writes to `terrain`, only to `cliff`), which is exactly Sec.9 item 7's own resolution of "what does the pathfinder see under a cliff" (guide:1325/1326, closed 2026-08-04) — the grid already reads that way for free.

**`accumulate_connections` is a standalone stream-state toggle**, same shape as `cliffs.ts`'s own standalone attributes (`kind: "standalone"`, sitting directly in the section rather than as a block attribute) — encountered in script order alongside the six `create_connect_*` block commands, and once seen, every LATER command reads terrain state (for both `terrain_cost` and `replace_terrain`'s "from" matching) from the LIVE grid instead of a snapshot frozen at the start of S5. `create_connect_to_nonplayer_land`'s documented bug (it silently blocks every connection command declared after it) is emulated deliberately — a blocked command still gets a `CommandReport` (never silently drop content) plus a `SimulationNote` naming why.

**Terrain application along a found path**: per path tile, roll an effective radius (`terrain_size`'s declared value +/- uniform variance, default radius 1/variance 0 when the tile's own terrain has no entry — guide:1958/1960), skip entirely on a negative roll (guide:1965), else replace a Euclidean disc (squared-distance compared, Sec.8's `Math.sqrt` ban) per an ordered rule list. **`replace_terrain`/`default_terrain_replacement` merge into ONE list by source position** ("expansion order"): a wildcard (`default_terrain_replacement`) matches every terrain, so scanning in order and keeping the LAST match naturally gives "a later default overrides earlier specific rules, but a later specific rule still wins over an earlier default" — exactly Sec.6.5's own two-directional statement, verified in both directions by two separate tests.

**A second real performance issue, same category as `terrains.ts`'s but smaller: the corpus itself needed a wider test timeout, not an architecture fix.** `AD4 - Pag - v1.2.rms` has ~27 lands and three separate `create_connect_all_lands` commands, each independently resolving and pathing every pair (several hundred A* searches total, each up to O(dim^2)) — a real, honest cost the script's author intended (three connection styles layered over the same land graph), not a bug. Completes in well under a second standalone, but tipped vitest's 5s default under full 34-file parallel load, reproducing 2 of 3 full-suite runs. **Distinguished from the `terrains.ts` bug by measurement, not assumption**: timed the isolated case first, confirmed it was fast, and only then concluded the fix belongs in the test (a 15s per-map timeout on this file's corpus loop, matching vitest's own `it(name, fn, timeout)` third argument, not attempted elsewhere in this codebase's corpus gates since no other stage's cost scales with land-pair count) rather than in the algorithm — Sec.11 names pathological CLUMP counts as the case needing an iteration cap, and nothing in the corpus resembles a 9320-land script.

### Tests

`src/preview/__tests__/connections.test.ts`, new file, 66 tests: `MinHeap` (ascending-priority pop order, empty pop, 200 random-priority pushes with forced ties checked against a plain sort), `computeLandBoundingBoxes`, `findConnectionPath` (straight path, a full impassable moat, cost preferred over raw distance, genuine multi-source/multi-goal behaviour), `teamPairs`/`landZonePairs`/`crossPairs` as isolated units, `readTerrainCosts`/`readTerrainSizes`/`readReplacementRules`/`resolveReplacement` against real `instantiateScript` output, `applyTerrainAlongPath` (disc radius, negative-roll skip, radius-0-still-replaces, the terrain_size-absent default), and `applyConnections` end to end (all six command types, the no-teams `"teams"` note, the to_nonplayer_land blocking bug plus its note, `connectionBlocked` on an unreachable pair, both directions of `accumulate_connections`, a full S1-S5 pipeline smoke test) plus a 33-test per-map corpus gate.

**Four test-construction bugs caught and fixed before trusting the suite** (on top of the corpus-timeout finding above): an off-by-one in a hand-counted path-length assertion (20 tiles between x=0 and x=19 inclusive, not 19); a `connectionBlocked` test that hardcoded an assumed grid dimension of 20 for coordinate math while the real grid (`mapSize: "Tiny"`) was 120, so the intended wall and the two lands ended up on the SAME side of it; and the two `accumulate_connections` tests originally used a PARTIAL wall (two local rows either side of a corridor) that a path could simply detour around through open space elsewhere on the map, rediscovering the same "a partial wall isn't a moat" lesson the earlier `findConnectionPath` moat test had already gotten right — fixed by reusing that test's own full-height-wall-with-one-gap shape.

**Mutation-tested three lines, all confirmed red then reverted**: the Sec.8 lint gate against this new file, `resolveReplacement`'s last-match-wins expansion-order logic (return-on-first-match instead of keep-scanning, caught by both directional tests), and the `to_nonplayer_land` blocking flag (commented out, caught by the one test that exists specifically to catch it).

### Verification

`npm test` — **34 files / 1024 tests** (was 958; new `connections.test.ts` +66). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. `npm run validate:reference` clean. Full suite run four times total across the session (two before the corpus-timeout fix, two after) to confirm the fix actually holds under load rather than trusting one green run.

**Not started:** S6 (`objects.ts`) and `index.ts`'s `generatePreview()` — the last stage and the orchestrator that will finally wire S0-S6 together into one callable pipeline. Every stage file built so far (`lands.ts` through `connections.ts`) has been tested individually via its own hand-rolled `place()` helper; `index.ts` is what makes that a real, single public API.

### `create_connect_same_land_zones` corrected same session (2026-08-06) — not carried forward as a gap

Shipped wrong, caught by the user, fixed before the session ended. The build log entry above states "`create_connect_same_land_zones` is modelled IDENTICALLY to `create_connect_all_lands`... per Sec.6.5's own explicit grouping" — that was a misreading of one compressed line in the design doc ("`…all_lands` / `…same_land_zones` -> all land origins, all pairs"), not a deliberate simplification, and it was wrong.

**Correct model, confirmed against two independent community RMS references**: `create_connect_same_land_zones` GROUPS lands by their `.zone` value and connects all pairs WITHIN each zone, never across zones — the same shape `create_connect_teams_lands` already has one level up, keyed on zone instead of canonical team. On an unmodified script this connects only the neutral `create_land`s to each other (they share the default zone −10, Sec.6.1) and leaves player lands untouched (each gets its own `playerNumber − 10`) — which is the entire reason the command exists as something other than a plain synonym for `create_connect_all_lands`. Zone −12 ("belongs to no zone") is excluded from grouping, mirroring `lands.ts`'s own exemption for it.

**Fixed**: new `sameZonePairs(origins)` function (excluded from the "identical" claim in `resolvePairs`'s switch, which now calls it instead of `allPairs` for this one command); the file header's incorrect claim rewritten with the correction and its sourcing spelled out; `preview-design.md` Sec.6.5 itself corrected to match, with a new Sec.15 item 21 tracking that this is community-sourced, not yet confirmed in-game the way this project's RMSTEST_* runs confirm other facts (a concrete one-map run is specified there). No corpus map uses this command, so the fix carries no corpus-gate risk. Test fix: the one test asserting "identical behaviour" (constructed by the same earlier misreading) replaced with two tests proving the actual distinguishing behaviour (different zones -> no connection under same_land_zones but one under all_lands; shared zone -> connection under both) plus three direct `sameZonePairs` unit tests (within-zone grouping, the zone −12 exclusion, the all-distinct-zones no-op case) — 66 to 70 tests in `connections.test.ts`. Mutation-tested by reverting `resolvePairs`'s new branch to the old `allPairs` call and confirming the corrected test goes red, then restored.

**Where the correction came from, since it matters for calibrating confidence: not this project's own RMSTEST methodology.** Every other correction recorded in this log traces to an in-game measurement or the guide `preview-design.md` otherwise cites by line number. This one came from web search turning up two independent community RMS references (a command-table page and a separate zone-semantics summary) that agree with each other and with facts this project HAD already measured (Sec.6.1's zone defaults) — good corroboration, but a different evidence class than an RMSTEST run, and Sec.15 item 21 says so rather than quietly treating it as equally solid.

`npm test` — **34 files / 1028 tests** (was 1024; +4 in `connections.test.ts`). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline.

### `objects.ts` (S6) built (2026-08-06) — the last generation stage

Per `create_object`, the candidate filter is Sec.6.6's own listed order run as one successive intersection (Sec.7): occupied, terrain habitat/`terrain_to_place_on`/`layer_to_place_on`, implicit terrain-separation, distance band, `avoid_other_land_zones`, forest zone, `avoid_cliff_zone`/`min_distance_to_map_edge`/`max_distance_to_other_zones`, actor areas, `require_path`. Closes all three of Sec.7's "declared but never emitted" `FailureBucket` gaps (`borderBlocked`, `zoneAvoidanceBlocked`, `pathBlocked` — all pinned to S6). Grouping scope follows rev 6's measured rule: tight checks the ANCHOR only then flood-fills by occupancy alone (plain BFS from the anchor, which naturally fills the "perfect square worth of objects" shape the guide describes without pinning); loose checks every member (free, since every tile already in the candidate pool has already passed the full predicate set — loose only adds a local `group_placement_radius` filter around a drawn center). `create_object_group`/`add_object` resolved separately from spatial grouping — two orthogonal "group" concepts the guide names identically — with % weights read but never consulted (guide:2025 confirms the engine ignores them too).

**Six named, deliberate simplifications, recorded in the file's own header rather than left implicit** (matching `terrains.ts`'s precedent): can-overlap (multi-tile buildings dropped by tight/`force_placement`) not modelled, same one-tile-footprint deferral Sec.9 item 11 already makes; the ownership gate (`requiresGaiaOnly`) falls back to "any `resourceAmounts`", which mis-handles SHEEP in exactly the direction the spec itself predicts ("the awkward case the flag exists to settle"); habitat (`objectHabitat`) falls back to the LETTER of Sec.12 item 7's own text ("land" for anything refDb resolves), which mis-handles FISH/SHORE_FISH/TRANSPORT_SHIP the same honest way; walls place as ordinary objects plus a not-simulated note (Sec.9's exclusion is the connected-segment mechanic, not "nothing gets placed"); actor areas an object adds via its own `actor_area` attribute are recorded once per COMMAND rather than per placement (true per-placement bookkeeping would mean re-running candidate filtering after every single placement, which the Sec.11 architecture doesn't support); `min_distance_group_placement` is scoped to the current command only, not the whole S6 run (keeps every command's candidate pool independent of processing order). `require_path`'s `dev` argument is described numerically in `preview-design.md` but `language.json`'s own entry declares an optional `otherConstant` `pathType` instead — the same class of doc-vs-data drift Sec.12 item 4 already names for `terrain_size` — so it is treated as `dev 0` ("any path exists") always, the loosest reading, which never over-rejects.

**A real performance bug, caught by the corpus gate before shipping, not by review — same shape as `terrains.ts`'s own iteration-cap bug, twice over.** First cause: the water/forest masks, the cliff distance transform and the per-land terrain-separation BFS were each recomputed from scratch inside the per-(command, frame) candidate-filter builder, rather than cached once for the whole stage the way Sec.11 says reachability masks should be ("cached per (land, habitat class) for the whole stage") — fixed with `createObjectStageCaches`, one object of memoized getters built once per `applyObjects` call. That fix alone barely moved the needle (`AK_Namatjira.rms` 68s → 75s, `TL Team Acropolis.rms` 31s → 58s — noise plus CPU contention from a stray background process, not a real change), which was itself the useful signal: the real cost was somewhere else. **Second, larger cause, found by checking what those two specific corpus maps actually declare**: both combine an astronomically large count (`number_of_groups 999999` in one, `number_of_objects 65536` in the other) with `find_closest`/`find_closest_to_map_center`/`find_closest_to_map_edge` (17 and 40 uses respectively), and the original picking logic re-scanned the ENTIRE candidate pool to find the closest tile on every single pick attempt, up to 100 retry attempts each — an O(placements × attempts × pool size) blowup, tens of billions of operations on paper. Fixed by exploiting a monotonicity fact: occupancy only grows and spacing points only accumulate during a command's run, so a tile rejected once can never become valid again later in the same frame — licensing a `CandidatePool` that is sorted ONCE by selection key (closest/center/edge) or left as a swap-remove array (uniform), with a cursor/removal that only moves forward, giving amortized O(1) per pick and O(pool log pool) total per frame instead of O(picks × pool). The loose-grouping path had an identical smaller version of the same bug (`pool.filter(...)` re-scanning the whole pool once per spatial group) — fixed by scanning a bounded local region (`group_placement_radius` is typically small even when the pool or the group count is huge) against a fixed `isCandidate` lookup instead. Both fixes together took the two pathological maps from 68s/58s to under a second each, and the full 25-map corpus gate from timing out to 30s.

**One class of judgment call carried over from earlier stages: "region stages roll rejections up, S6 reports per placement" (Sec.7) only goes so far before it would mean re-deriving state Sec.11's architecture doesn't keep.** `min_distance_group_placement`'s "vs all prior AND FUTURE placements" read literally asks for state that persists across every `create_object` command in script order; scoped instead to the current command, per the file header's note 6 above — every command's candidate pool stays independent of processing order, matching how every other stage in this codebase already works.

### Tests

`src/preview/__tests__/objects.test.ts`, new file, 83 tests: pure-helper units (`isGrouped`'s four independent triggers including the `group_placement_radius`-alone case Sec.6.6 calls out by name; `requiresGaiaOnly`/`objectHabitat`/`objectCategory` against the real 16-object slice of `game-constants.json`, with the SHEEP/FISH miscalibrations pinned as tests rather than left to be rediscovered; `objectGroupMembers`; `resolveObjectCounts`'s scaling-applies-to-groups-not-objects rule and the mutually-exclusive-scale-attribute last-wins rule; `resolveObjectFrames`'s land_id skip, `generate_for_first_land_only`, and the `-11`-degrades-to-frameless case), one instrumentation test per `FailureBucket` this stage owns (`gaiaOnlyRequired`, `minExceedsMax`, `landMissing`, `terrainAbsent`, `borderBlocked`, `actorAreaMissing`, `zoneAvoidanceBlocked`, `groupPartial`, `noValidTiles`), end-to-end behaviour (bare/scattered placement, no-double-occupancy, `force_placement` stacking, object-group member resolution never leaking the group's own name, `set_place_for_every_player` per-land placement, a connectivity check that a tight group's flood-fill is a genuine 4-adjacent blob), the two Sec.9 honesty notes, and a 25-map corpus gate (fewer than the other stages' 33 — `test-maps/broken/`'s deliberately malformed fixture and a few maps with no `<OBJECTS_GENERATION>` section at all are naturally absent from a per-`create_object`-command test, not excluded by policy).

### Verification

`npm test` — **35 files / 1111 tests** (was 1028; new `objects.test.ts` +83). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline (one `prefer-const` error introduced and fixed in the test file itself before this count). Full corpus (`test-maps/` + gitignored `test-maps/local/`, 57 maps total when both are mounted) exercised via the standard `npm test` run, not just this file's own 25-map subset.

**Not started:** `index.ts`'s `generatePreview()` — the only thing left in CREATION_PLAN 4.3. Every stage from `lands.ts` through `objects.ts` has been tested individually via its own hand-rolled `place()` helper; `index.ts` is what wires S0-S6 into one callable `PreviewResult`-returning function, which is also what the worker protocol (Sec.10, not yet built) and the 4.2 canvas renderer (currently fed a hardcoded fixture) are both waiting on.

### `index.ts` built (2026-08-06) — `generatePreview()`, CREATION_PLAN 4.3 complete, every generation stage now wired into one callable pipeline

Sec.10 pins the signature exactly: `generatePreview(parse, refDb, settings, opts): PreviewResult`, no mode parameter and no cancellation hook — both deliberately out of scope here, and the file's own header explains why rather than leaving the omission to look like an oversight. **Current/Final (Sec.5) is a caller concern**: "Current is `generatePreview(truncateAst(parse, pinnedLine), refDb, settings, opts)`" — the truncation happens to `parse` before this function ever sees it, so `generatePreview` needs no awareness that Current exists; `truncateAst()` belongs to whoever calls this twice (the worker, not built yet). The `runStages(…, shouldStop)` cancellation hook Sec.10 mentions is explicit future-proofing ("drops in later without a rewrite... a genuine decision about Tauri's protocol headers, not a detail to slip in during 4.3") that Sec.10's own code block gives `generatePreview` no parameter for — not built. `worker.ts` itself is a separate file per Sec.14 and isn't this one either — this file has no `postMessage`, no `Worker`, nothing async.

**One piece of real, previously-unbuilt logic: base-terrain resolution.** Every stage file's own test suite hardcoded `createTileGrid(dim, GRASS)` in its `place()` helper, so nothing before this session actually read a script's own `base_terrain`/`base_layer` (Sec.6.1's "Base fill" — standalone `<LAND_GENERATION>` commands, not attributes, so Sec.3 rule 10's attribute-folding never touches them; resolved here with a last-occurrence-wins forward scan matching guide:167's general duplicate rule). Falls back to GRASS (or id 0 if even GRASS is unresolvable — never crashes) with a `baseTerrainUnresolved` note when the declared name isn't in `game-constants.json`.

**Snapshot boundaries (Sec.5) and the note-dedup pass (Sec.10) are the other two pieces no single stage owns.** Snapshots are taken after `applyBaseElevation` (S1, since base elevation is described as part of S1's own work in Sec.6.1) and after each of S2-S6, each one a `.slice()` copy of the four renderable layers — a reference would keep mutating as later stages ran. Sec.10's "the generator appends notes freely and a final pass keeps the first note per key" turns out to describe a CROSS-stage pass that literally has nowhere to live except here: `instantiateScript` already dedupes its own S0 notes internally, but no individual stage file dedupes against a DIFFERENT stage's notes, because none of them can see any other stage's output.

**`PreviewReferenceData` (this file's own type, not `types.ts`'s)** bundles the parser's `LanguageIndex` (for `instantiateScript`) with the `game-constants.json` array (for every stage from S1 on) — Sec.10 lists what `types.ts` owns and this bundle isn't in it, the same category as `EligibilityContext` living in `terrains.ts` rather than `types.ts`. The constants array itself is typed as `ObjectConstant[]` (reused from `objects.ts`) rather than a fourth near-identical interface: it is a strict superset of every other stage's own narrower projection of the same JSON (`TerrainConstantForMasks`/`TerrainConstantForElevation`, both just `{constId, rmsConstant, category}`), so one array satisfies every stage's parameter type with no cast, per each of those files' own "narrow shape per consumer" convention.

**A load-dependent test-timeout flake, caught by a full-suite run and fixed the same way `connections.test.ts`'s own corpus gate was.** The determinism tests (Sec.13's own "bedrock" requirement — same inputs must produce a deep-equal `PreviewResult`) each run the FULL pipeline TWICE with `collectSnapshots: true`; standalone that's fast, but under full 36-file parallel load eight of them hit vitest's 5s default and failed with `Test timed out in 5000ms` — not a hang (CPU time was actively climbing throughout, checked before assuming otherwise) and not a correctness bug, just an under-sized timeout for a test shape none of this file's siblings had (two full pipeline runs per test, not one). Fixed by giving the determinism tests and the subset-corpus tests an explicit 15s timeout, matching the convention `connections.test.ts` already established for the same reason. Confirmed by a clean full-suite re-run afterward rather than trusting the standalone pass.

### Tests

`src/preview/__tests__/index.test.ts`, new file, 67 tests: base-fill resolution (default GRASS, explicit `base_terrain`, last-occurrence-wins, unresolvable-name fallback-plus-note), snapshot shape (absent when `collectSnapshots: false`; exactly six, in S1-S6 order, each `dim x dim`, when true), cross-stage note dedup (no duplicate keys across a script that trips notes in more than one stage), Sec.13's determinism bedrock (3 corpus maps x 3 seeds, deep-equal `PreviewResult` across two runs of the same inputs), a seed-sensitivity sanity check (different seeds move player origins), and a right-sized corpus matrix: the full corpus once at a baseline (4 players, seed 1, matching every sibling stage's own corpus-gate cost) plus a 3-map subset carrying the extra player-count {2,6,8} and seed {2,3} axes — Sec.13 asks for the full cross product and its own text pre-empts the cost concern ("cut the seed axis... rather than dropping the player-count axis"), but the full cross product specifically (every map x all 4 player counts) is not what that sentence asks for and would have made this one file alone slower than the rest of `npm test` combined. Deliberately does NOT re-prove any single stage's own internal correctness (candidate filtering, grouping scope, growth heuristics, ...) — that is each stage's own test file's job, already done; this file exists for orchestration bugs only.

### Verification

`npm test` — **36 files / 1178 tests** (was 1111; new `index.test.ts` +67). `npm run typecheck` clean. `npm run lint` 0 errors, unchanged 10-warning baseline. Full suite run twice: the first surfaced the timeout flake above (8 failures, all in the same describe block, all the same error), the second — after the fix, nothing else touched — passed clean at 36/1178 with the test-floor gate green.

**CREATION_PLAN Phase 4 (Preview, M4) is now fully complete.** Every stage S0-S6 is built, tested individually, and now wired into one real `generatePreview()` entry point. What Phase 4 does NOT yet include, both by design (Sec.14's own file layout) and both explicitly out of this file's scope per the header above: `worker.ts` (the postMessage protocol wrapper, Sec.10) and swapping `src/components/preview/`'s hardcoded `fixture.ts` for a real call through that worker. Those are the natural next steps whenever this project resumes preview work, but they sit outside CREATION_PLAN 4.3's own stated scope ("4.3 builds `generator/` to this spec and swaps the fixture for the worker" — the swap itself was always described as following 4.3, not part of it).

### `worker.ts` + the fixture swap built (2026-08-06) — the preview pane now draws the real document

Two pieces, done together in one session since the second was blocked on the first.

**`src/preview/worker.ts` (Sec.10's protocol wrapper).** Mirrors `src/editor/parserWorker.ts`'s shape closely on purpose — one long-lived worker, imports `language.json`/`game-constants.json` directly rather than taking them over the wire (Sec.10: "shipping it per request would structured-clone ~111 KB of JSON on every keystroke burst for data that never changes"), builds its `PreviewReferenceData` bundle ONCE per worker instance rather than per message. The file itself is deliberately thin: `onmessage` calls `generatePreview` and posts back `{id, ok: true, result}` — nothing else. Two things Sec.10 assigns to this layer are NOT here, both because Sec.10 itself says they belong to the HOST, not the worker: the watchdog (a worker cannot terminate itself) and debouncing. A worker can also never legitimately post `{ok: false, abandoned: true}` about itself — that message only exists because the HOST manufactures it after killing an unresponsive worker.

**`src/usePreviewResult.ts`**, the consuming hook, same location convention as `useParsedDocument.ts` (`src/`, not nested). Debounces ~300ms after the parse settles, discards stale responses by request id (identical rule to `useParsedDocument.ts`), and adds the one thing that hook doesn't need: a 1000ms watchdog that terminates a stuck worker, spawns a replacement, and re-posts the same request — re-arming itself on every re-post, so a script that hangs deterministically keeps retrying until either it succeeds or a NEWER request (the user editing again) supersedes it via the same id guard. `playerCount`/`mapSize`/`teams` are accepted as separate primitives rather than one `PreviewSettings` object, so a caller that builds that object fresh every render doesn't reset the debounce timer on referential inequality alone — the hook builds its own stable one via `useMemo`.

**Threading the live `ParseResult` down to `PreviewPane` needed a new context, not a prop.** `MapSidePanel.tsx`'s own header states its contract explicitly: "Neither child takes props. Both read what they need from module-level reference data or context... which is what lets the same element be dropped into two different panes without either pane knowing anything about them." Adding a `parseResult` prop would have broken that contract for both `BreakdownPane` and `CodePane`, which each independently render `<MapSidePanel />`. `src/ParsedDocumentContext.tsx` (new) exposes `AppContent`'s `parsed.parseResult` via context instead, provided just above the tab switch in `App.tsx` — the smallest change that keeps `MapSidePanel`'s children honestly prop-less.

**`PreviewPane.tsx` swapped `buildFixturePreview` for `usePreviewResult`, plus one real bug fix the swap surfaced.** The fixture only ever produced ONE snapshot (hand-tagged `"S6"`), so `result.snapshots?.[0]` happened to be correct there — the real generator's `collectSnapshots: true` returns all six (S1-S6, Sec.5's own order), and index 0 is now S1, the map before elevation/cliffs/terrain/connections/objects ever ran. Fixed to `result.snapshots?.at(-1)` (S6, the final grid) before this could ship as a preview that looked plausible but was quietly showing the wrong stage. `dim` is now read from the real result (`result.dim`, the authoritative post-`override_map_size` value) instead of the pane's own `resolveMapDim` guess, which is no longer needed for anything and was removed.

**Current/Final (Sec.5): both toggle positions currently draw the identical result, and this is a scope decision, not an oversight.** Real Current semantics need `truncateAst()` (AST-level script truncation at a pinned line) and a pin-line UI control — Sec.5 describes both in detail but no CREATION_PLAN step currently owns building either, and the user's own instruction this session was "the worker, then the fixture," not the pin-line feature. Shipping a toggle that silently does nothing on one side would be the "confidently wrong" failure CLAUDE.md warns against, so the `breakdown.sidePanel.previewToggle` HelpTip copy (`reference/data/ui-help.json`) was rewritten to say plainly that Current isn't implemented yet — the same honesty move the fixture's own note used to make ("Current is a stand-in here"), now living in the real UI copy instead of a note only the fixture could show. `FixtureView` (the `"current" | "final"` type) moved from the deleted `fixture.ts` into `PreviewViewContext.tsx`, since it was never actually a fixture concept — renamed `PreviewViewMode` to stop implying otherwise.

**`src/preview/fixture.ts` and its test deleted**, per the file's own header ("it is deleted the day the worker lands") — both were untracked (never committed), so nothing was lost that git could have recovered anyway. `-1 file / -8 tests` from the count below.

**Verification, and its real limit.** `npm run typecheck`, `npm run lint` (0 errors; 11 warnings now, +1 — `ParsedDocumentContext.tsx` picks up the same `react-refresh/only-export-components` warning every other context-with-an-exported-hook file already carries, not a new class of problem), `npm run validate:reference` (the `ui-help.json` copy edit), and the full `npm test` all pass — **35 files / 1170 tests** (was 36/1178; `-1/-8` for the deleted fixture test, `+67` already counted, net matches exactly). Started the real Vite dev server (`npm run dev`, via a new top-level `.claude/launch.json` — the tool reads that path relative to the outer `AOE2_projects/RMS` folder, not this repo root, and the first attempt was placed one level too deep) and confirmed Vite itself compiles every new file cleanly (worker `?worker` import included, checked via `preview_logs`) with zero build errors. **Could not visually verify the running preview pane**: this app calls Tauri store APIs (`HelpSettingsContext`/`GenerationSettingsContext`/`useDocument.ts` — all pre-existing, none touched this session) synchronously on mount, which throw (`Cannot read properties of undefined (reading 'invoke')`) outside the real Tauri host process, crashing the whole component tree before `PreviewPane` ever renders. Confirmed this is pre-existing and unrelated to this session's changes by checking which files call Tauri APIs. A plain browser tab — including one pointed at a `tauri dev` session's own Vite server — cannot exercise this, since the Tauri IPC bridge (`window.__TAURI_INTERNALS__`) is injected into the native WebView2 window specifically, not into the port it happens to share. This is the same class of gap CLAUDE.md's "Environment: sandbox caveats" section already documents for Vitest/Rollup, extended here to full-app UI verification: **Ash's local `npm run tauri dev` run is the real confirmation**, not anything this session could produce.

### Preview review round 1 (2026-08-07) — five reported defects, four of them one root cause

A review of the finished preview against real corpus maps reported five problems. Numbered here as reported, because three turn out to share a single root cause and the report is what makes that visible.

#### 1. Lands never painted their terrain, so every map rendered as one flat colour

**`lands.ts` wrote `landId` and `zone` and never once wrote `grid.terrain`.** `stampOrigin` and `claimTile` both set land ownership; nothing anywhere turned a land's `terrain_type` into a terrain id on the grid. `AK_Six_Points_v1.4.rms` came back with a terrain histogram of exactly one entry — 40,000 tiles of `base_terrain WATER` — which is the flat blue diamond in the report's screenshot.

**The shape of this bug is the lesson, not the fix.** A stage that silently produces a plausible grid is far harder to spot than one that throws, and the damage surfaced two stages later as an avalanche of *correct* diagnostics: `create_terrain { base_terrain DIRT2 }` genuinely had no DIRT2 to paint on, water objects genuinely had no water, and one map reported 19,608 placement failures that were all this single missing loop. Every stage's own test suite passed throughout, because every one of them hardcoded `createTileGrid(dim, GRASS)` in its `place()` helper and then asserted against a grid it had built itself — the same class of blind spot the base-terrain resolution work found in the previous session, one layer down. **Fixed** by `paintLandTerrain()`, deliberately shaped as a sibling of `applyBaseElevation` (one O(dim^2) pass over `grid.landId` after growth, so a land covers its final footprint rather than its origin stamp), and by adding it to every downstream stage's own test helper so the helpers run the real pipeline instead of an abridged one.

#### 3. Unknown terrains — three separate resolution failures wearing one symptom

`DEEP_WATER` and `MED_WATER` were reported as "not known, but they should be", along with the observation that **not every terrain has an RMS constant at all**. Investigating produced three distinct causes:

- **The reference data held 15 of DE's 131 terrains.** Fixed from the community DE terrain table now in `reference-docs/AoE2 Terrains.xlsx` (Zetnus): all 131 now present with `constId`, `descriptiveName`, `deTextureFile`, and the two new flags below. New entries carry `verified: false` and no `idSource` (the schema's own documented "unknown provenance") because they came from a community sheet, not this repo's extraction. `previewColor` is filled in only where a terrain shares a `deTextureFile` with an already-extracted one, which is not a guess: `previewColor` is defined as the mean of that one `.dds`, so two terrains naming the same file have the same colour by construction. That covers 35 of 131; **the remaining 96 need one `python extract_constants.py --colors-only` run on a machine with the game installed** and are marked in the legend as having no colour until then.
- **Bare numeric terrain ids never resolved.** Only 78 of the 131 have a callable constant, so `terrain_type 26` is the only way to reach the other 53 — and all five stages' private `terrainIdByName` copies took a `string`.
- **Script-defined `#const` terrain names never resolved.** `instantiate.ts` deliberately leaves `terrainConstant` slots as strings (they are not Sec.6 "numeric slots"), so `#const WOODIES 48` then `create_terrain WOODIES` failed. This is a mainstream idiom precisely *because* 53 terrains have no name of their own: `TL Black Forest.rms` lost 33 commands to it, `AK_Namatjira.rms` more than 100.

Fixed by one shared `resolveTerrainId(constants, value, symbols)` in `grid.ts` replacing all five private copies, and by exposing `InstantiatedScript.symbols` (numeric `#const` definitions only). **Resolution order is deliberate and testable: game constants first, `#const` second** — the engine loads `random_map.def` before the script and `#const` is first-definition-wins, so a script redefining `WATER` does not actually win in game and must not win here.

**Two new data fields, `isWater` and `isForest`, which discharge Sec.12 item 6.** That item recorded the dat's `is_water` as an undecoded bitfield and named a `/WATER/` name heuristic as the interim fallback. The heuristic is not merely incomplete, it is wrong in both directions, and painting terrain for the first time is what made that matter. It cannot see the 53 unnamed terrains at all (id 15 "Water 2D, Shoreless", id 90 "Forest, Reeds"), it reads `DLC_MANGROVESHALLOW` as dry land when it is a shallow, and it misses "Forest, Oak Bush" entirely. The community table lists per-terrain building and pathing rules for all 131, which is exactly the data the item asked for. The patterns remain as a fallback for any entry carrying no flag — absence of a flag is not evidence of anything (CLAUDE.md's positive-resolver rule).

`rmsConstant` is now nullable in the schema. A null never matches a name lookup, which is the correct outcome rather than a gap, and the legend falls back to the scenario editor's own `descriptiveName` ("Water, Deep Ocean" beats "terrain 57" on precisely the terrains a script reaches by id).

#### 4. Slow generation — measured first, and the headline number was not a generator problem

Timed the full 32-map corpus before touching anything: **median 458 ms, worst 3.8 s**. Then found the actual reported symptom somewhere else entirely.

**`usePreviewResult`'s watchdog was killing working generations in an infinite loop.** It fired at 1000 ms, taken from Sec.11's 40 ms-per-stage budget — but that budget is not what the pipeline costs, and roughly a third of the corpus exceeds it. On those maps the watchdog terminated the worker, re-posted the same request, re-armed itself, and did it again forever: the map never rendered and a core spun until the user typed something else. **A watchdog calibrated against a budget rather than a measurement is a denial of service on your own feature.** Raised to 12 s against the measured worst case with margin, and bounded at 2 retries — a script that hangs deterministically hangs identically on retry, so "retry until superseded" was an infinite loop by construction.

Then the generator itself, all three found by measurement rather than reading:

- **`spacingIndex.ts` (new).** S2's `create_elevation spacing` and S6's `min_distance_group_placement` each kept a growing point list and rescanned it per candidate, O(n^2) per command. `TL Team Acropolis.rms` ran **545 million** distance comparisons inside S6's scan, `24hr_Blind Valley.rms` 238 million, `AK_Namatjira.rms` 188 million, together roughly two thirds of the whole preview's runtime. Replaced with a uniform grid (cells `ceil(d)` wide, nine-cell neighbourhood, exact for both metrics since Euclidean distance never exceeds Chebyshev). S6 on Acropolis 3174 ms to 1118 ms.
- **`drawSeed` re-split its candidate pool on every call.** Its own doc comment said "split the pool by diagonal side once"; the implementation did it per clump, over up to 40,000 candidates, once per clump. Hoisted into `buildSeedPool`. S2 on `AK_Namatjira.rms` **3101 ms to 133 ms**.
- **`buildCandidatePool` allocated 40,000 short-lived objects per frame** to sort by selection key. Now packs `key * dim^2 + tile` into one number and sorts a `Float64Array` with no comparator (the engine's fast path); the packing is exact and invertible, and it makes the tie break deterministic by tile index rather than incidentally stable.
- **A* allocated a `neighbors` array per node expansion** and three `dim^2` arrays per search. The arrays are now allocated once per command and cleared by generation stamping rather than refilling.

**Failure records were the other half of "slow", and the whole of "a LOT of error messages".** `Menindee_AUS_v2.3.rms` produced **280,427** failure records in one generation, `TC2 - Comeer v1.4.rms` 185,432, `24hr_Caverns.rms` 172,650 — each an object carrying a freshly built sentence, allocated during generation, structured-cloned across the worker boundary on every keystroke burst, and rendered as one `<li>` each the moment the notes drawer opened. They are now coalesced by bucket per command as they are made (`pushFailure`), keeping the first as the example and counting the rest: **280,427 to 165**. Sec.7 already licensed this ("5.2's report UI aggregates by bucket, and stable bucket identity matters more than forensic precision"); nothing downstream ever read the second record of a bucket.

Corpus after all of it: **median 469 ms**, and the full-suite runtime dropped from 144 s to 80 s. `24hr_Caverns.rms` remains the worst at ~3.8 s, dominated by S5 A* (a `create_connect_all_lands` over ~25 lands is 300 pairwise searches). **The structural fix is known and deliberately not taken**: one multi-source Dijkstra per source land answers every pair from that land at once, ~12x fewer searches. It would change what a later pair in the same command sees under `accumulate_connections`, which is spec'd behaviour — escalating rather than improvising, per CLAUDE.md's hard rule.

#### 2. Hover readout now lists the objects on the tile

`PreviewCanvas` builds a tile-to-objects index once per result (a map can carry tens of thousands of objects and the pointer fires continuously, so filtering per event would be O(objects) per mouse move). Grouped by object and player in the readout — `GOLD x4` rather than four identical entries — since the common stacked tile is a tight group of the same thing.

#### 5. The preview pane vanished on every Breakdown to Code switch

`usePreviewResult` was called by `PreviewPane`, which lives inside `MapSidePanel`, which both panes render — so a tab switch unmounted it, killed the worker, discarded the finished result, and started a generation that can take seconds. **The viewport fix from 2026-08-06 hoisted the zoom and pan but not the map they framed.** `src/PreviewResultContext.tsx` (new) hoists the hook above the tab switch, the same move `useSharedSelection` and `PreviewViewportProvider` already make for the same reason, and `PreviewPane` reads the result from context, keeping it prop-less as `MapSidePanel`'s own contract requires.

#### Also done

`tools/extract-constants` carries the new fields through (`CONSTANT_KEY_ORDER` — a key missing from that list is silently dropped on the next run, so a schema addition has to land in both places) and now merges the unnamed terrains by id instead of skipping them: `random_map.def` is keyed by constant name and has no row for them, but their textures and colours are looked up by id anyway. Those entries keep no `idSource`, since this run does not confirm an id it never looked up.

Worth recording for next time: the Advanced Genie Editor shipped in the DE install (`Tools_Builds/`) is very likely how the community terrain table was compiled in the first place, and is a route to game properties and constants that does not depend on genieutils-py parsing the `.dat`. Recorded in that tool's README as a fallback worth trying whenever the dat parse breaks after a patch.

### Tests

**36 files / 1203 tests** (was 35/1170). New: `spacingIndex.test.ts` (+9, mostly a differential test against the linear scan it replaced, with edges over-sampled deliberately — uniform draws over a 60-wide map almost never exercise the cell arithmetic that matters). Added to existing files: `lands.test.ts` +9 (terrain painting across all three reference forms, plus the `#const`-does-not-shadow rule), `grid.test.ts` +11 (`resolveTerrainId`, `isWaterTerrain`), `placement.test.ts` +3 (`pushFailure` coalescing), `palette.test.ts` +1 with 2 rescoped. `tools/extract-constants/test_extract_constants.py` +2.

Mutation-tested: the spacing index's boundary comparison (`<` to `<=`, 3 red) and neighbourhood radius (3x3 to 1x1, 2 red); `resolveTerrainId`'s `#const` fallback (1 red); the extractor's id-provenance guard (1 red) and its key-order round trip (1 red). All confirmed red, then restored and re-confirmed green.

**One mutation test failed to go red and that was the useful one.** The spacing index guards against an out-of-range column aliasing onto the previous row's last cell, and the comment claimed this prevented false positives. Removing the guard changed nothing, which forced the actual argument: the distance test runs on true coordinates, so an aliased bucket can only ever be wasted work (a point 39 tiles away fails the test whichever cell it was found in), and it cannot cause a miss either, since the cell being aliased away from is off-grid and necessarily empty. The guard is a performance measure. Comment and test both corrected to say so.

### Verification

`npm test` 36/1203, `npm run typecheck` clean, `npm run lint` 0 errors (12 warnings, +1: `PreviewResultContext.tsx` picks up the same `react-refresh/only-export-components` warning every other context-with-an-exported-hook file already carries), `npm run validate:reference` passes, `python -m unittest test_extract_constants.py` 45/45.

**Not verified in the running app, for the reason CLAUDE.md's sandbox caveats already record**: this app calls Tauri store APIs synchronously on mount, so the component tree crashes outside the real Tauri host and no browser tab can exercise `PreviewPane`. A local `npm run tauri dev` run is the confirmation.

### Preview review round 2 (2026-08-07) — object terrain restrictions, `terrain_mask` layers, and a cap that was quietly eating `create_terrain`

A second review pass, driven by reading `AD4 - Pag - v1.2.rms` in the running app. Four reports; the diagnosis for one of them turned up a second, larger bug next to it.

#### The clump cap was truncating the most common `create_terrain` idiom

Reported as "the DESERT terrain has not affected correctly in the terrain generation section". It had not: `MAX_CLUMP_ATTEMPTS_PER_DIM` capped S4 at `4 * dim` clump attempts, which is **800 on a 200 map**, and Pag's own commands ask for `number_of_clumps 9320` — the guide's own worked example — twenty-three times. So `create_terrain DIRT { base_terrain DESERT land_percent 100 number_of_clumps 9320 ... }`, which is how a script converts *all* of one terrain into another, was converting 8.6% of it. One generation emitted 23 `terrainIterationCapped` notes and nobody had looked at them.

**The cap is gone, replaced by a bound that is a fact rather than a guess.** Every clump that runs claims at least its own seed tile, so `min(clumpCount, eligiblePool.length)` is an exact upper bound on useful clumps — and it terminates a `999999999`-clump command after at most `dim^2` iterations on its own, which is what the cap was there for. Seed draws now come from a shrinking pool with swap-remove instead of 100-attempt rejection sampling, so the whole command pays O(pool) for removals however many clumps it asks for, and saturation is detected exactly instead of guessed at after 100 failed draws. The DIRT layer on Pag went from 2,729 tiles to 9,204.

**The lesson is about how the cap was justified.** Its comment said it was "chosen generously enough that no non-pathological corpus script hits it". That was never measured; the corpus hits it constantly. And because the failure mode was a silently wrong-looking map rather than an error, it survived the whole of 4.3.

#### `terrain_mask 1` and `terrain_mask 2` are different behaviours, not one

This file's header listed collapsing them as a deliberate simplification, reasoning that Sec.9 renders masking as a flat tint anyway so "the over/under distinction would be invisible in the renderer's own contract even if modelled exactly". **That reasoning was wrong, and the review caught it directly: the distinction is not about rendering at all.** guide:1502-1509 says mask 1's new terrain "inherits its properties" from the base while mask 2's "provides new properties" — so mask 2 changes *which terrain owns the tile*, and therefore what every later `base_terrain` match, habitat check and automatic-object rule sees. guide:2486 confirms it from the object side (`layer_to_place_on` "works for terrain_mask 1, but not when set to 2 ... because the layer has become the main terrain").

Now modelled as two behaviours: mask 1 writes the layer and leaves the terrain alone; mask 2 moves the old terrain into the layer and takes the tile. Pag uses mask 2 in two of its first three terrain commands, where it had been a no-op for the rest of the pipeline.

#### Objects ignored terrain restrictions entirely

Reported as trees in water, and it was worse than it sounded. `objectHabitat` returned `"land"` for objects the reference data knows and **`"any"` — unrestricted — for everything else**, and the data knows 16 objects of several hundred, so in practice every tree, animal and decoration a real script places was unrestricted. Measured on Pag: 21 of 40 OLIVE_TREEs and 16 of 40 CYPRESS_TREEs stood in open water.

Three changes, and the second one is the one that actually mattered:

1. **The unknown-object fallback is now `land`, not `any`.** The two defaults are not symmetric: land objects are the overwhelming majority of what scripts place, the water ones are a small known family, and a script placing a water object writes `terrain_to_place_on SHALLOW`-or-similar, which is honoured ahead of the guessed habitat. A forest floating on the sea is not a cautious approximation; it is a confident lie about the layout.
2. **The habitat check is ADDITIVE to `layer_to_place_on`, not replaced by it.** This was the actual defect. Pag's tree stragglers carry `layer_to_place_on GRASS`, the GRASS layer survives underneath water terrain that a later mask-2 command laid down, and the old predicate chain treated any explicit terrain-or-layer attribute as standing in for the habitat — so the check never ran. `terrain_to_place_on` remains an exception on purpose: it names the *ground*, which is the same thing habitat is guessing at, so the author's statement outranks the guess. A layer carries no such claim.
3. **A tight group's flood fill respects it too.** Test 8's measured rule — a tight group's members skip the command's *attributes* — stands untouched. The terrain table is not an attribute; it is an engine-level restriction on where the object can exist, which is precisely why `ignore_terrain_restrictions` exists as a separate opt-out. Without this a tight group of 7 GOLD anchored on the coast spilled into open water, 13 times on Pag.

After all three, every object on Pag sits on land, and the water is empty.

**A new `habitat` field** (`land`/`water`/`shore`/`any`) carries the real answer where the data has one; `FISH`, `SHORE_FISH` and `TRANSPORT_SHIP` are populated, which retires the mis-handling the file header used to document as deliberate. `shore` is the waterline itself, within one tile either side — SHORE_FISH sits on the water side and DLC_BOXTURTLE on the land side, and the exact row differs per object in a table we do not have.

**What is still missing is data, and it is obtainable.** The engine stores a per-object terrain-restriction id indexing a per-restriction row of allowed terrains, in the dat that `tools/extract-constants` already parses; a script can also rewrite it at runtime with `effect_amount SET_ATTRIBUTE <object> ATTR_TERRAIN_ID <n>` (`Menindee_AUS_v2.3.rms` does this ten times), which nothing here models. Tracked as Sec.15 item 23.

#### Forest terrain now reads as forest

Two halves of one complaint. Tree objects were drawn in the near-white unknown-object colour, burying the terrain under white confetti; they now resolve to the wood colour via a name pattern, which is deliberately confined to a cosmetic decision (the same precedent as `WALL_NAME_PATTERN`, and the alternative is not a correct colour but a worse one). And forest *terrain* was drawn in its own texture colour, which is the GROUND UNDER the trees — `MEDITERRANEAN_FOREST` and plain `LEAVES` are both `g_for`, an earthy brown — so 4,271 tiles of forest on Pag rendered as bare dirt. Forest terrains now take a canopy tint, driven by the `isForest` flag rather than a name, and following whichever terrain owns the tile, exactly as the engine's own automatic-object rule does.

`LAYER_TINT_WEIGHT` also went 0.45 to 0.7. A mask is a real texture in game covering most of what you see, and at 0.45 a mask between two similar colours was invisible: Pag's DIRT-over-DESERT came out (218,169,110) against bare desert's (221,180,124), so the map read as undifferentiated sand and the mask looked like it had not run.

**Not done, and it needs the same missing data:** the engine spawns tree objects on forest terrain automatically, and a script can suppress them by rewriting that tree's terrain restriction. The preview draws the canopy but emits no tree objects, so object counts on a forest map are low and the suppression idiom is invisible. Same Sec.15 item 23.

### Tests

**36 files / 1216 tests** (was 1203). `terrains.test.ts` +4 (mask 1 vs mask 2 and the distinguishing `base_terrain` consequence; the 9320-clump example running in full; the pool bound when the pool is smaller), `objects.test.ts` +7 (the whole terrain-restriction group, on a half-water fixture that runs S6 alone so S1-S5 cannot repaint it) and 4 rewritten where they had pinned the old `any` fallback and the documented FISH mis-handling.

Mutation-tested three lines, each confirmed red then restored: the habitat fallback back to `any` (5 red), `terrain_mask 2` collapsed into mask 1 (2 red), and the clump bound back to `4 * dim` (2 red).

### Verification

`npm test` 36/1216, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes, extractor unit tests 45/45. Rendered Pag's final grid to a PNG out of band (a throwaway harness, deleted) to check the result by eye rather than only by histogram — which is what confirmed the white-confetti and bare-forest symptoms and then that they were gone.

### Preview review round 3 (2026-08-07) — the layer array, and three more rules read backwards

A follow-up question — "`base_layer` in object generation is determined by the visual mask. Are we keeping track of the visual masks? And `base_layer` and `base_terrain` should be able to be used together" — turned into four corrections. All four are the same shape as round 2's `terrain_mask` finding: a guide sentence read as the opposite of what it says, sitting behind a plausible comment.

#### `base_layer` narrows `base_terrain`; it was widening it

guide:1471, on `base_layer` in `<TERRAIN_GENERATION>`: "If used together with base_terrain, the new terrain will be placed only where **both** the base and the layer apply." The eligibility predicate was an OR. So `create_terrain X { base_terrain GRASS base_layer DESERT }` — "the desert layered onto grass" — matched every bare GRASS tile on the map as well as the layered ones, which is the opposite of what the attribute is for. Fixed in both places it appeared: the candidate predicate and `spacing_to_other_terrain_types`'s own "this command's eligible ground" test. `base_terrain` still always applies, defaulting to GRASS (guide:1449); `base_layer` has no default and only narrows when written.

The test that pinned the old behaviour was named *"base_layer is an alternative match, per the guide's disjunction (terrain OR layer)"* — it cited a disjunction the guide does not contain. Replaced with two tests: the layer narrows, and a matching layer does not rescue a tile whose base terrain is wrong.

#### "No layer" and "layered with GRASS" were the same value

`grid.layer` used **0** to mean "nothing layered here". 0 is GRASS's terrain id. So every consumer of the layer array — the renderer's tint, `base_layer` matching, `layer_to_place_on` — could not tell the two apart, in both directions: a `base_layer GRASS` would have matched every unlayered tile on the map, and a tile genuinely layered with GRASS rendered with no tint at all. Not hypothetical: `AD4 - Pag - v1.2.rms` runs `create_terrain DLC_DESERTGRAVEL { base_terrain GRASS ... terrain_mask 2 }`, which moves GRASS into the layer, and that whole region was drawing bare.

`NO_LAYER = 0xffff` now means it, for the same reason `UNREACHABLE` can: the array holds terrain ids and DE's table ends at 130. Found by asking the question in the review rather than by any test — a zero-filled `Uint16Array` is exactly the kind of default that looks like initialisation and is actually a value.

Related, and fixed alongside: a plain (unmasked) `create_terrain` now clears the layer. Whatever was layered there was layered on the terrain that used to be on that tile, and that terrain is gone.

#### `ignore_terrain_restrictions` was cancelling `terrain_to_place_on`

guide:2510-2511: the attribute means "objects can be placed on terrains they are normally restricted from" and it explicitly "can be used in combination with `terrain_to_place_on`". The implementation gated the entire terrain block on it, so an author writing both got neither. `AK_Six_Points_v1.4.rms` writes exactly that pair for `DLC_ANIMALSKELETON` (`terrain_to_place_on DIRT` plus the flag) and scattered 11 skeletons across open water. The flag now lifts only the habitat check — the engine's terrain table, which is what it is about — and leaves the author's own instruction standing.

After this, the only objects left on water across the two maps under review are `SHORE_FISH`, `TUNA` and `FISH`, all of which belong there.

#### The colour extraction ran

`extract_constants.py --colors-only` was run against a real install, the first time that mode has run against a table this script did not itself build. **121 of 131 terrains now carry a real `previewColor` and all 131 a `minimapColor`**, up from 35 and 15. The hand-added `isWater`/`isForest`/`habitat` fields survived untouched, which is the thing `CONSTANT_KEY_ORDER` exists to guarantee and which had not previously been exercised.

The 10 terrains still without a `previewColor` are correct and permanent: they are the legacy two-texture blends (`DIRT_SNOW`, `GRASS_SNOW`, `DLC_MOORLAND`, `DLC_DRYROAD`, `DLC_JUNGLEROAD`, `DLC_JUNGLELEAVES`, `DLC_ROADGRAVEL` and three unnamed siblings) that guide:1513 lists as "already a blend of two texture files". There is no single texture to average; they fall back to `minimapColor`, which they all have.

### Tests

**36 files / 1219 tests** (was 1216). `objects.test.ts` +1 (the `ignore_terrain_restrictions` scope), `terrains.test.ts` +1 (a matching layer does not rescue a wrong base terrain) and 1 rewritten from the disjunction it had pinned, `grid.test.ts` +1 (NO_LAYER is not 0, and an explicit `base_layer GRASS` still fills with 0). `terrainBitmap.test.ts`'s fixture had to stop zero-filling its layer array — worth noting, since a hand-built `StageSnapshot` now needs `NO_LAYER` rather than a default `Uint16Array`.

Mutation-tested both new rules, each confirmed red then restored: `ignore_terrain_restrictions` no longer lifting the habitat (1 red), and `base_layer` back to a disjunction (2 red).

### Verification

`npm test` 36/1219, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes, extractor unit tests 45/45. Rendered Pag, Six Points and Black Forest to PNGs out of band again — which is what surfaced the skeletons-on-water and the untinted gravel region, neither of which any histogram would have shown. Black Forest still renders almost empty, correctly: its biome and its terrain constants come from `#include_drs F_seasons.inc`, which cannot be read, so no conditional branch is taken. The `includes` note fires and says so.

### Preview review round 4 (2026-08-07) — elevation stacking, second_object, and four items answered rather than changed

Nine reports, with a standing instruction to push back where a change would contradict a measurement or a guide rule. Three were fixed; four were diagnosed and answered without a code change; two are real gaps left open with the evidence written down.

#### `create_elevation` commands were stacking on each other

The largest of the round. Sec.6.2 said heights "add onto whatever elevation is already there", and the implementation read that as summing across commands. `AD4 - Pag - v1.2.rms` writes `create_elevation 7 { number_of_clumps 1 number_of_tiles 230400 }` **five times** over one region — 230,400 tiles on a 40,000-tile map, so each one floods all of it — plus a 180-clump `create_elevation 2` on top. Summed that is 37, clamped: **36,877 of 40,000 tiles came out at elevation 16** on a map whose author asked for 7.

Repeating a command is the coverage idiom every script uses for `create_terrain`; reading it as "and then five times taller" is not a reading any author could intend. Each command now raises a tile to `base_elevation + ring` and keeps the higher of that and what is already there. **The part of Sec.6.2 that was actually pinned survives**: a land at `base_elevation 3` under a `create_elevation 7` still reaches 10 — the sentence was about `base_elevation`, not about commands adding to each other. Flagged for a run as Sec.15 item 25, since it revises a spec reading.

This also explains the reported "a tile says DIRT but is the wrong colour". Elevation shading is `1 + elevation * 0.03`, so elevation 16 brightens a tile by 48% — every terrain on Pag was rendering washed out. Pag's max is now 7.

#### `second_object` was dropped, and it was hiding most of the fish

It had a `secondObjectNotDrawn` note, which read as a cosmetic omission. It is not: guide:2211 recommends `second_object` explicitly as the way to "bypass terrain restrictions by using an invisible placeholder object as the main object", so a script that wants fish somewhere awkward places a **placeholder** and hangs the fish off it. Dropping the second object drops the only thing the author cared about. `AD4 - Pag - v1.2.rms` had no fish at all (it places `ONGRID_PLACEHOLDER_NAVAL` with the fish as `second_object`); `Menindee_AUS_v2.3.rms` lost every pond fish the same way. Now emitted as its own `PlacedObject` on the same tile, once per placement of the carrier, with a note that says what it is rather than that it is missing. Pag gains 57 `FISH_PERCH`, Menindee 18 `IS_FISH_IN_OUTSIDE_PONDS` and 25 `SHORE_FISH`.

#### The hover readout shows the layer

Requested, and it is also the diagnosis for the colour complaint above: with `LAYER_TINT_WEIGHT` at 0.7 the layer is most of what you see, so a readout naming only the terrain reads as a rendering bug. `(63, 124) DIRT + DESERT layer · elev 7` says what is actually on the tile.

### Answered without a code change

**The land-origin "bias" is the measured cross-shape meeting borders, and it is not a bug in the implementation.** Reported as: Pag's `BEACH_BUILDABLE` islands with `right_border 60 bottom_border 60` always hug the border edges and never reach the map corner. Working it through: the borders allow `x, y ∈ [0, 80]` on a 200 map, and RMSTEST_25's cross rejects any candidate with `|x−100| > 34.2` AND `|y−100| > 34.2`. The intersection is an L-shaped sliver along `x ∈ [65.8, 80]` or `y ∈ [65.8, 80]` — exactly the observed banding, produced entirely by two rules each of which is implemented as specified. **What is genuinely open is whether the engine's cross is absolute in map coordinates or relative to the region the borders leave**; RMSTEST_25 measured it only on unbordered lands. Sec.15 item 26 has a twenty-generation run that decides it. Changing the model on the strength of "it looks odd" would be overturning a measurement with an impression.

**`AK_Six_Points_v1.4.rms`'s variability is the map's own design, not obviously a defect — but the instability is real and unexplained.** The script draws an ellipse outline out of ~250 `create_land { number_of_tiles 0 }` stamps and then floods the interior with one `create_land { land_percent 100 }` at (90, 49). Across six seeds the DIRT count ranges 12,079–20,319 and the water 8,999–17,452, so the flood is escaping or stalling depending on seed. The mechanism is not yet identified — candidates are `other_zone_avoidance_distance` between the zone-2 flood land and the zone-default outline, and `border_fuzziness` rejections — and it deserves its own session rather than a guess. Recorded here rather than fixed.

**No beach terrain is generated at land/water boundaries.** Confirmed: 536 land tiles on Pag touch water on their west side with no beach between. This is a real missing engine behaviour — terrain 2 is described as "automatically placed when land terrains border water", terrain 37 (`ICYSHORE`) likewise for snowy terrains — and `beach_terrain` currently only applies inside a `create_terrain` clump, which is a different thing. Not implemented this round; it is a new S1/S4 post-pass, not a correction. It also blocks the box-turtle report: those want a water tile adjacent to a **beach** tile, and there is no beach to be adjacent to.

**Box turtles still place wrongly.** `DLC_BOXTURTLE` is not in the 16-entry object table, so it takes the `land` fallback; it should be a shore object, and "shore" should mean the water side of a beach rather than the current symmetric band. Both halves need the terrain table (Sec.15 item 23) plus the beach generation above.

### Tests

**36 files / 1222 tests** (was 1219). `elevation.test.ts` +3 (repetition does not raise the ceiling; a later shorter command does not lower an earlier one; `base_elevation` still adds), `objects.test.ts` 1 rewritten from asserting the not-drawn note to asserting the second object lands on the carrier's tile.

Mutation-tested the elevation change (restored the summing write, 2 red, reverted).

### Verification

`npm test` 36/1222, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes. The first full run went red on a stale `second_object` test that asserted the behaviour this round removed — worth noting only because the test-floor script's own advice ("re-run before investigating") is for a different failure mode, and this one was real.

### Preview review round 4b (2026-08-07) — elevation corrected again, automatic beaches, and detached seeds brought home

Continues the previous entry. Two of its conclusions were revised the same day on further review, which is the point of writing them down.

#### `MaxHeight` is an absolute ceiling, not an increment

The previous entry replaced summing with `base_elevation + ring`, keeping Sec.6.2's "heights add on top of base_elevation". Review corrected that too, with the case that settles it: two lands under one `create_elevation 6`, one at `base_elevation 5` and one at 2, **both top out at 6**. The first reads as shallow hills (5 → 6), the second as tall ones (2 → 6). The additive model would have put them at 11 and 8.

So a command raises a tile toward MaxHeight, never past it, and never lowers one already higher — `if (ring > grid.elevation[tile]) grid.elevation[tile] = ring`. Nothing adds: not clumps within a command, not commands within a section, and not `base_elevation` underneath. Sec.6.2's "heights add on top of base_elevation" is withdrawn outright rather than narrowed, and Sec.15 item 25 has the run.

Worth recording the shape of the mistake: the first fix was reached by asking what would stop `AD4 - Pag - v1.2.rms` reaching elevation 16, and `base_elevation + ring` does stop it. It fits the symptom without being the rule. The distinguishing observation — two lands at *different* base elevations under *one* command — was never constructed, and it is the only one that separates the two models.

#### Automatic beaches at the land/water boundary

Reported as: Pag has no beach anywhere, and 536 of its land tiles touch water directly. This is engine behaviour rather than a command — the community DE table states it on the beach terrains' own rows (id 2 BEACH "automatically placed when land terrains border water", id 37 ICYSHORE "created when snowy terrains border water") — and `create_terrain`'s `beach_terrain` attribute exists to override it per command, which is why guide:1483 gives that attribute a default of BEACH.

`applyAutomaticBeach` writes each land tile's own beach terrain onto it where it borders water, one tile wide, on the land side only. The water mask is taken before any write, so a new beach can never make its neighbour look inland (mutation-tested: writing live turns 2 tests red).

**It first shipped as a single pass after S5, and that was wrong — the corpus says so outright.** The reasoning for running late was that a beach is a property of the FINAL coastline and both `create_terrain` and connection painting move water. It reads well and it ignores what the beach is FOR: `base_terrain BEACH` is an ordinary idiom with **67 uses across the tracked maps**, including five consecutive `create_terrain RIVERBANK_TERRAIN_TEMP { base_terrain BEACH land_percent 100 number_of_clumps 99999 }` in `AK_Namatjira.rms`, and a beach that does not exist until after S5 matches none of them. Those commands ran against an empty eligible pool and painted nothing — a silent wrong answer, not an error. Worse, running last made the pass the final writer on every coastal tile, so it undid the conversions it had prevented in the first place.

Corrected to the engine's own moments: **the end of land generation, and the end of every `create_terrain` command.** Measured after the change, seed 7 on Normal — Pag 726 beach tiles, Namatjira 2815, `24hr_Mont Saint Michel.rms` 800, all previously zero.

**The per-command step only fires when the command set `beach_terrain`, and that condition is the interesting part.** Making it unconditional is the obvious reading of "beach at the end of every create_terrain" and it eats its own output: the command converts beach into X, then its own beach step converts X's waterline straight back, because X borders water and X's row says it grows a BEACH. Every beach tile borders water by construction, so the undo is total and the 67-use idiom becomes a no-op. Two tests caught it within a minute of the change — worth recording that the failing assertion was the one written to prove the feature worked, not a regression test for something else. **The fork is genuinely open and is now Sec.15 item 28**, with the run that decides it; the shipped reading is the one that does not break a documented idiom, and the cost of being wrong that way is measured rather than assumed (873 unbeached coastal tiles on Pag, 829 on Mont Saint Michel, 0 on Namatjira).

No pass after S5. Connection painting can carve new water and whether the engine dresses it is unmeasured; the only datum nearby points away, since `beach_terrain` is documented to stop working entirely when a `<CONNECTION_GENERATION>` section exists. Adding a pass there to tidy the number above would be inventing a third moment nobody has observed.

**The per-terrain `beachTerrain` field is new this session, not pre-existing data, and its provenance matters.** It was derived mechanically from the community DE table (Zetnus, the same source `isWater`/`isForest` came from) by four of that table's own columns: the beach terrains themselves are null (Building Allowed "walls only", or a Descriptive Name starting "Beach" — a beach does not grow a beach, and the guide's `beach_terrain DLC_BEACH2` example would be a no-op if it did); the four rows reading "no beaches" are null; water is null; snowy and icy terrains take ICYSHORE; everything else takes BEACH. That gives 78 BEACH, 16 ICYSHORE, 37 null. **One extrapolation, flagged in the schema rather than buried:** only ids 32/33/34 carry the explicit "icy beach when bordering water" annotation, and the other thirteen snow/ice rows are matched against the ICYSHORE row's own phrase "snowy terrains" using the table's Descriptive Name and Comments text. A first pass matched those as bare substrings and handed five *Rice* Farm rows an icy shore; the fix is a word-boundary match, and the lesson is the ordinary one — a derivation script needs its output read, not just its exit code.

**`beach_terrain` and the automatic pass are ONE rule, and were briefly built as two.** Two implementations landed in the same file within the same session: one placing beaches at the end of S4 with per-command `beach_terrain` support, one placing them after S5 from `index.ts` with none. Both ran, so every map got the pass twice and the second overwrote the first. Consolidated into one: the after-S5 call site is right (a beach follows the FINAL coastline, and S6 needs to see it), and `create_terrain` no longer dresses its own clump at all — it records its `beach_terrain` per tile into a `beachOverride` array returned on `TerrainsResult`, and the single pass consults that before the terrain's data default. Deciding adjacency once, at the end, is strictly better than deciding it per clump against a stage-start mask: a later command painting water beside an earlier clump now beaches it, and a clump painted over no longer leaves a stale strip of sand.

**That threading also closed what had been written up as an accepted edge.** A `beach_terrain` naming a NON-beach terrain (guide:1488 — the way an author makes a coastline players cannot build docks on) was being overwritten by the pass, because a non-beach terrain's own row says it grows a BEACH. With the override it is honoured, which is what the guide describes.

**A dead branch found by mutation testing, removed, and then put back when the override made it reachable.** The pass carried a `beach === terrainId` guard against a terrain that grows itself. On the DATA path it is genuinely unreachable — a beach terrain's own row carries `beachTerrain: null`, so `beach === undefined` already catches it — and a mutation proved that. The override path reaches it: nothing stops a script writing `create_terrain BEACH { beach_terrain BEACH }`, and without the guard that tile is counted as written on every run. Worth recording as a pair, because the first finding was correct when it was made and the second did not contradict it — **"unreachable" is a claim about the current call graph, so it expires when a new caller arrives.**

**`beach_terrain` naming a WATER terrain now reproduces guide:1485** ("it will fully replace the terrain specified in `create_terrain`, so this is NOT recommended"). That is the engine cascading — the waterline becomes water, so the ring behind it is a waterline too, and so on until the clump is gone. Modelled as the outcome the guide states outright rather than by iterating the pass, which is what lets the pass stay single-pass. Emits its own note.

**Box turtles were the reason the beach work was asked for, and they needed one more line.** `DLC_BOXTURTLE` had no row in `game-constants.json` at all, so `objectHabitat` fell back to `land` and put them inland regardless of whether a shore existed. Added with `habitat: "shore"` — not a new judgment, since the schema's own `habitat` description already records the classification ("SHORE_FISH sits on the water side, DLC_BOXTURTLE on the land side"); the row implementing it was simply missing. `constId` is deliberately null: the schema forbids guessing it, and `objectHabitat` resolves by `rmsConstant`, so the habitat works without one. `SHORE_FISH` already had its row and needed nothing — what it lacked was a beach, which it now has. Both stay `verified: false` pending the dat's terrain-restriction table (Sec.15 item 23).

Two note changes: `beachTerrainSkipped` (the `<CONNECTION_GENERATION>` bug) now says the coastline still gets the engine's default, because "the attribute was ignored" is not "there is no beach" and the old wording implied it; and a new drawer note names the automatic beach at all, since this sand is the only terrain on the map that no line of the script asked for.

#### Detached seeds are drawn near their land, not across the map

`AK_Six_Points_v1.4.rms` walls a `create_land { land_percent 100 }` inside a closed ellipse built from 120 zero-tile land stamps. Verified the ring really is closed: a 4-connected flood from the land's origin over non-ring tiles never reaches the map edge, and the interior is 14,201 tiles. The land nevertheless came out at 16,703 tiles on one seed — past a wall it cannot cross.

The mechanism is the detached-seed reservoir. `clumping_factor` defaults to 8, `reservoirSize(8)` is 2, and Sec.6.1 says those seeds are "rejection-sampled by the same origin rules the land's own origin used" — map-wide. Because this land's target of 40,000 is unreachable inside the ring, it keeps taking turns forever, so both seeds landed outside and grew without limit.

Seeds now come from a neighbourhood of the land's own origin (`0.12 · dim`, floor 12, both `[tune]`). Sec.6.1 licenses the change explicitly: R and the FORM are both `[tune]` and "any mechanism reproducing the piece-count column is admissible". RMSTEST_38 counted PIECES, and a splinter 40 tiles away counts exactly as one 150 tiles away — so the measurement is untouched while a detached seed now means "this land broke apart" rather than "this land also appeared over there". Tracked as Sec.15 item 27.

**This does not close the Six Points report, and the entry should not read as if it does.** The spill past the ring is gone, but the same map still fills its ellipse inconsistently — the flood reaches roughly 8,000–13,500 tiles of a 14,201-tile interior depending on seed. Border fuzziness is ruled out (`borderDepth` returns 0 for any tile inside its bounds, and this land has none) and zone avoidance is ruled out (`other_zone_avoidance_distance` resolves to 0 here). The cause is not identified. Recorded as the open half of item 27.

### Tests

**36 files / 1233 tests.** `terrains.test.ts` +7 net (the beach pass: one tile wide on the land side; snow takes ICYSHORE rather than BEACH; no beach on a beach; no water means no work; the pre-taken mask — plus, from the consolidation, `beach_terrain` reaching the pass instead of dressing its own clump, a non-beach `beach_terrain` surviving it, and the water-`beach_terrain` cascade; the old "beach_terrain dresses clump tiles" test is gone, since that is no longer how it works, and the `<CONNECTION_GENERATION>` test now also pins that the coastline still gets the default beach). **Both new override tests failed on first run for the same reason and it was the test's premise, not the code:** the fixture's clump is 30 tiles and its column is 120, so the un-painted tiles correctly took GRASS's own default — fixed by asserting over the tiles the command actually claimed rather than the whole column, which is a sharper test than the one intended), `elevation.test.ts` +2 rewritten to the ceiling model (two lands at different base elevations reaching the same ceiling; a land above the ceiling left alone), `lands.test.ts` +1 (detached seeds stay local).

Mutation-tested three lines: the elevation write restored to summing (2 red), the beach pass writing against a live mask (2 red), the reservoir radius widened to the whole map (1 red). All confirmed then reverted.

**One mutation restore went wrong and is worth recording as a method note.** Reverting the reservoir mutant by string replacement hit the FIRST match of a pattern that appears in two functions, silently moving the neighbourhood bound out of `sampleReservoir` and into `neutralOrigin`. Ten tests went red and the cause was five minutes of confusion rather than obvious. When mutation-testing by text substitution, assert the match is unique before replacing — the mutation is safe, the restore is where the damage happens.

### Verification

`npm test` 36/1229, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes. One full run failed on a stale test asserting the `second_object` behaviour removed earlier the same day, and one failed load-dependently and passed on re-run — the test-floor script's own advice covers the second case and not the first.

## The per-command beach step is unconditional (2026-08-08)

Sec.15 item 28 was open because the per-`create_terrain` beach step fired **only when the command set `beach_terrain`**, and the reason recorded for that condition was that an unconditional step destroys the `base_terrain BEACH` idiom: the command converts beach into X, the step converts X's waterline straight back, and — the clause that carried the whole argument — "every beach tile borders water by construction, so the undo is total".

**That clause is true of a beach the STEP laid and false of beach that is simply what a land is made of.** It describes a waterline, and a waterline is one tile wide by definition. Separate the two cases and the fork closes without a run:

- **The only beach is the waterline.** The command converts that strip, the step converts it back, the command is a no-op. Correct: there was nothing else to convert.
- **A land made OF beach** — a beach clump, a `base_terrain BEACH` fill, a wide `DLC_WETBEACH` shelf. Every beach tile converts to X except the tiles touching water, which revert. The interior keeps the conversion, which is the entire point of the idiom.

So the unconditional step does not break the 67-use idiom, it is what gives the idiom anything to do, and it also beaches the coastline a command paints — the cost the conditional version was measured to carry (873 unbeached coastal tiles on `AD4 - Pag - v1.2.rms`, 829 on `24hr_Mont Saint Michel.rms`, at seed 7 on Normal). The condition protected the case where nothing was at stake and broke the case that mattered.

Every run of the step now dresses the whole grid. What stays scoped to the painting command's own tiles is `beach_terrain` (guide:1483), passed in as an override plus a scope mask rather than acting on its own. Grid-wide matters on its own account: a command that paints WATER puts land it never touched onto the coast, and only a grid-wide pass dresses that land.

**The generalisable part is not about beaches.** The rejected reading was rejected on an argument that was locally valid and quantified over the wrong set. "Every beach tile borders water" was never checked against a map that contains beach the step did not lay, and the corpus counts cited in its favour (67 uses) were counts of exactly the maps that would have refuted it. A frequency argument and a geometry argument were run past each other without either being pointed at the same tiles.

Sec.15 item 28 is narrowed rather than closed. What is still unmeasured is whether the engine's step is grid-wide as modelled or confined to the command's own tiles, which differs only where a command paints water beside untouched land; the run that decides it is in the item.

### Tests

**36 files / 1237 tests.** `terrains.test.ts` carries the distinction as two tests that must both hold, because either one alone is satisfiable by the wrong model: `base_terrain BEACH` on a four-column beach band beside water converts three columns and reverts the one touching water, and `base_terrain BEACH` on a coast whose only beach is the waterline changes nothing at all. `index.test.ts` +3 for the orchestration half no stage file can see — a map with no `<TERRAIN_GENERATION>` section still gets a beach and a drawer note, the beach is present in the S1 snapshot, and a `base_terrain BEACH` command therefore places rather than reporting `terrainAbsent`.

**One of the new assertions shipped vacuous for ten minutes and `tsc` is what caught it**, not the test run: it read `f.reason === "terrainAbsent"` against a field named `bucket`, so `some()` compared `undefined` and returned false on every possible implementation. A green run said nothing. Fixed, then checked the other way by pointing the command at a terrain the map does not contain and confirming the assertion goes red — the same discipline the mutation tests below follow, applied to a test rather than to code.

Mutation-tested two lines. Restoring the `applyBeach &&` condition on the per-command step turns both distinction tests red — including the no-op one, which is the useful half: the conditional model leaves the waterline converted, so "nothing changed" is a real assertion and not a test that passes on any implementation. Removing the end-of-land-generation call turns all three `index.test.ts` tests red. Both reverted.

### Verification

`npm test` 36/1237, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## Beaches at the shallows boundaries (2026-08-08)

The beach rule had two depths, land and water, and the map has three. Shallows are terrain both land units and ships cross, and the engine edges every boundary between two different depths rather than only the outer one, so a shallows band running from a coast out to sea should read sand, shallow, sand, sea. Only the first of those two boundaries existed.

**Half of it already worked, and for the wrong reason.** `SHALLOW` carries `isWater: true`, so a land tile beside it already grew a beach — incidentally, as a consequence of the shallow being counted as water, not because anything modelled a shallows boundary. That incidental correctness had two holes. The shallows the table calls dry (`DLC_MANGROVESHALLOW` is buildable, walkable ground; `Ice, Navigable`; `DLC_MANGROVEFOREST`) grew no beach against adjacent land at all. And the far boundary, shallows against open water, could not exist under a two-value flag: both sides read water, so there was nothing to edge.

### The model

One rule replaces the old one and covers all three boundaries: **a tile takes its own beach where it borders anything strictly deeper than itself**, and the beach lands on the shallower of the two. Land against shallows, land against open water, shallows against open water. `terrainDepth` in `grid.ts` defines the ordering; `waterDepthMask` is `waterMask`'s three-level sibling and the only thing the beach pass reads.

**`isHybrid` is orthogonal to `isWater`, not a partition of it, and that is the load-bearing decision.** The obvious alternative — make shallows a third value of the water flag — moves every consumer of the water mask: cliffs avoid water, objects have water habitats, `base_elevation` does not work on water lands. None of those readings is wrong today. `isWater` answers the placement question every stage asks, and by that reading a shallow IS water; depth answers a question only the beach rule asks, and by that reading a shallow is neither. The two disagree in both directions, which is what makes them separate fields rather than one field spelled two ways. Nothing outside the beach pass reads the new flag.

`isHybrid` is taken from the community DE table's own `Unit Pathing` column, which reads `all` on exactly 24 rows. Removing the nine beach terrains and the five rice farms leaves the ten that ship: a beach is what this rule PRODUCES rather than a thing it edges, and a rice farm is not wet. Two of the ten are forests placed on shallows rather than shallows proper (55 DLC_MANGROVEFOREST, 90 Forest Reeds), included on the grounds that both are named as growing out of a shallow, and flagged as a judgment call in the schema.

**No name heuristic, deliberately, and it is the one place this field differs from `isWater`/`isForest`.** Those two carry fallback patterns because the table left gaps. There are none here — all 131 rows carry `isHybrid` explicitly — and no pattern could work anyway, since `YELLOW_SHALLOW` is a shallow and `YELLOW_SHALLOW_WATER` is open water. An id the table never covered falls back to `isWater`'s own answer, which leaves it behaving exactly as it did before the field existed. Absence means unknown and unknown means unchanged, rather than absence meaning a guess.

Seven of the ten hybrids carried `beachTerrain: null`. That was the old rule showing through the data: the derivation pass read `isWater`, and water grows no beach. They now carry 2 BEACH (37 ICYSHORE for navigable ice, which was already right), and `beachTerrainFor`'s fallback for an unrecognised terrain asks `terrainDepth` rather than `isWaterTerrain` so an unrecognised shallow is answered the same way a recognised one is.

**A latent bug found next door and fixed in passing.** `beachTerrain` was never added to `extract_constants.py`'s `CONSTANT_KEY_ORDER`, whose own comment says a key missing from that list is silently dropped from the rewritten file. The next extraction run would have deleted all 131 values without a word. Added, along with `isHybrid`.

### Measurement

Seed 7 on Normal, the whole tracked corpus, run twice through the real pipeline — once as shipped and once with `isHybrid` stripped, which reproduces the old behaviour exactly. Nine maps change. The beach present when `<TERRAIN_GENERATION>` starts never decreases on any of them: `AK_Six_Points_v1.4.rms` 957 to 1611, `TL Tres Leches.rms` 376 to 678, `AK_ForeDaut_v1.3.rms` 96 to 356. Final counts: `W4 - Immersion.rms` 1324 to 2468, `QS_Three_Bays_v1.1.rms` 2753 to 3700.

Two maps end with FEWER beach-family tiles and both were chased down rather than waved through, since a rule that only adds coastline should not subtract any. Both are downstream cascade. Pag writes `create_terrain DLC_BEACH2 { base_terrain SHALLOW … }`, so shallows edged earlier are no longer SHALLOW when that command looks for them, and its `<CONNECTION_GENERATION>` then replaces plain BEACH with DIRT where it would have left DLC_BEACH2 alone. That is the interleaved beach step working as designed, and the S1 numbers are what confirm the rule itself is monotone.

That same Pag line was also the closest thing to counter-evidence and it cannot settle anything: painting a beach over every shallow reads either as an author supplying what the engine does not, or as an author choosing a different beach from the one it does, and `terrain_mask 1` makes it cosmetic either way. Recorded as Sec.15 item 29 with the run that separates them — one shallows shelf between land and deep water, read both of its edges.

### Tests

**36 files / 1248 tests** (+11). `terrains.test.ts` +6 on a `bands()` cross-section helper: both boundaries of a shallows band; a river crossing with no open water anywhere, where the shallows survive untouched because nothing is deeper than them; stability, since the beach lands on a tile whose own row grows no beach and so cannot creep inward on the next of the many passes a script triggers; the dry hybrid the water flag calls land; navigable ice growing ICYSHORE rather than BEACH; and WATER against DEEP_WATER growing nothing, which pins that the scale is depth-class and not a gradient. `grid.test.ts` +5 for `terrainDepth`/`waterDepthMask`/`beachTerrainFor`, with a fixture that deliberately mixes the flags in both directions.

Mutation-tested four lines, each confirmed red then reverted. Restoring the land-only skip turns three tests red. Reading "deeper than land" instead of "deeper than self" turns four red, including the river crossing, which is the useful one — it is the test that separates a depth ORDERING from a land-versus-not test. Pointing `beachTerrainFor`'s fallback back at `isWaterTerrain` turns the shallow-grows-a-beach test red. Requiring `isWater === false` alongside `isHybrid` turns red in both files, which confirms the two classification paths are each covered rather than one riding on the other.

### Verification

`npm test` 36/1248, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## Shore fish, box turtles and the ocean-fish family (2026-08-08)

Two defects reported against `QS_Three_Bays_v1.1.rms`, with one root in common: the habitat model had a boundary in the wrong place and a fallback doing more work than it should.

### `shore` meant the waterline, and it means open water touching a beach

The band was symmetric — one tile of water plus one tile of land — on the reasoning that SHORE_FISH stands on the water side and DLC_BOXTURTLE on the land side, so a band including both was the honest way to cover a per-object row we do not have. **The premise is wrong and the guide says so plainly**: guide:4991 glosses the shared DE constant MELKARYBA as "small fish, ie. shore fish or box turtles". They are one family with one rule, and both stand in the water. Measured on Three Bays at seed 7 on Normal: 130 of 226 shore fish were on the sand.

`shore` is now **a tile of open water orthogonally adjacent to a beach**, with three exclusions that each had to be argued rather than assumed:

- **Not the beach.** The reported bug.
- **Not a shallow.** `terrainDepth` from the beach work earlier the same day already separates the three, and a shallow is walkable ground as far as the game is concerned, which is the same reason it is not where a fish goes. This is what makes the habitat a three-way question rather than a two-way one, and it is also why `water` and `shore` are not nested: `water` INCLUDES the shallows, matching guide:4717's "water and amphibious terrains" for OYSTERS.
- **Not water merely near land.** The anchor is a beach terrain, which needed a new `isBeach` flag on all 131 terrain rows — the community table's "Building Allowed: walls only" selects exactly the nine beach terrains and nothing else, checked against the sheet rather than assumed.

**`isBeach` is not derivable from `beachTerrain: null` even though the same nine rows satisfy both.** A beach does not grow a beach, so the coincidence is real, and reading one off the other is still wrong: open water grows no beach either and is emphatically not sand. A mutant that made the derivation turns five tests red, four of them by putting shore fish in the middle of the ocean.

The cost of anchoring on beach rather than on "any land neighbour" is stated rather than hidden. The two coincide everywhere the engine's own beach rule has run, and diverge where a script paints its coastline over — Pag replaces BEACH with DIRT along its connection paths, and a shore object will not place against that stretch. A test pins that consequence so it is a decision rather than a surprise.

### TUNA was on the beach because "fish" was not in the data

Nine bare `create_object TUNA` commands, no `terrain_to_place_on`, so TUNA took the unknown-object fallback of `land`. All 119 came out on dry ground, 77 of them on the beach. After: 121 placed, 119 open water, 2 shallows, 0 beach. SNAPPER went 3-on-beach to 2 water + 1 shallow, OYSTERS 5-on-beach to 5 water.

**The interesting part is which sentence was wrong.** The `any` → `land` change of 2026-08-07 justified itself on an asymmetry: land objects dominate, and "the small water family is nearly always written with an explicit `terrain_to_place_on`", which is honoured ahead of the guessed habitat. That claim was drawn from `Menindee_AUS_v2.3.rms`, which names a terrain for every fish — and it names one because it is placing fish on SHALLOWS, where the author wants a particular water terrain. A script placing fish on OPEN water has no reason to name anything: the engine's terrain table already restricts the object, so the attribute is redundant and authors skip it. The sample that produced the rule was the exception to it, and nothing in the reasoning could have caught that because the rule was checked against the map that suggested it.

The fix is rows, not a better fallback: TUNA, SNAPPER, SALMON, DORADO, MARLIN1 and OYSTERS gain `habitat: "water"`, `constId` left null because the id is not needed to answer the question and guessing it would be a second, separate claim. Deliberately not a name pattern — a row is a claim about one object, a pattern is a claim about every name nobody has looked at yet, which is the line objects.ts's own header already drew for `WATER_NAME_PATTERN`.

**Scope held deliberately.** PERCH and MARLIN2 are plausible siblings and are absent because they appear in no tracked map; DOLPHIN is absent for a different reason, that every corpus use carries its own `#const DOLPHIN 61`, making it a script-level name rather than a game constant. The notes on the new rows say what the evidence is and what it is not: the names are written bare in shipped scripts with no `#const`, which is consistent with a predefined constant but does not prove one, since the engine passes an undefined name silently. Nothing depends on that either way. The real fix remains Sec.15 item 23, the dat's own terrain-restriction table.

### An incidental fix: a renderer test that measured the machine

`terrainBitmap.test.ts`'s "one opaque RGBA pixel per tile" went red in the full run and passed alone. Cause was ~78,000 `expect()` calls in one loop over four grid sizes, costing about 4 s against vitest's 5 s default — a wall clock on a shared machine, the same class the CLAUDE.md corpus-gate entries record. Rewritten to scan first and assert once: 3.97 s to 73 ms, with a failure message that now names the offending tile. Mutation-tested by making one pixel alpha 254 (red, correct index reported) then reverted. Nothing to do with this session's change beyond lengthening the run enough to expose it.

### Tests

**36 files / 1255 tests** (+7). `objects.test.ts` +6 net on a `placeOnColumns()` cross-section helper whose last entry fills the rest of the grid: shore fish land on the water column beside the beach and only there; DLC_BOXTURTLE behaves identically; a shallow interposed between water and beach yields NO shore at all rather than falling back to the shallow; a coastline with no beach yields none either, pinning the stated limitation; the ocean-fish family reads `water`; DLC_BOXTURTLE reads `shore`; and TUNA reaches the open sea while SHORE_FISH does not leave the beach's own column, which is the one assertion that separates the two water habitats. That is seven new tests less the one they replace, "holds a shore object to the waterline", which asserted the defect: its fixture had no beach on it at all, so under the corrected rule it describes a coast with no shore. `grid.test.ts` +1 for `isBeachTerrain` against `beachTerrainFor`.

**A second wall-clock gate went red on the way out, and was raised rather than investigated as a regression.** `connections.test.ts`'s per-map corpus timeout was 15s; `24hr_Caverns.rms` costs 8.4s standalone and took 16.8s under full-suite load, reproducing to the millisecond across two runs. S5 is a stage this session never touched — the changes are in `objects.ts` and one new `grid.ts` function that only `objects.ts` calls — so the number to size the ceiling against is the LOAD FACTOR, recorded on this machine at up to 3.7x, not the cost. Raised to 60s (~7x standalone) on the same reasoning that turned the Vanguard benchmark into a relative bound: leave enough room that only a complexity change can trip it.

Mutation-tested four lines, each confirmed red then reverted: admitting shallows to the shore band (1 red); anchoring on any land rather than on beach (1 red, the painted-over-coast test); deriving `isBeach` from `beachTerrainFor` (5 red); and dropping `water` from the accepted declared habitats (4 red).

### Verification

`npm test` 36/1255, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## The terrain table read out of the dat, and the fish family finished (2026-08-08)

Follow-on to the shore-habitat session. PERCH, MARLIN2 and DOLPHIN were asked for as `water`, with the question attached: is this extractable from the game rather than transcribed by hand, perhaps via the Advanced Genie Editor?

**Yes, and it does not need AGE.** AGE is the documented fallback for when the format parse breaks; the parse has not broken. `genieutils-py` — already a dependency of `tools/extract-constants` — reads it against the current build, and the join is four lines:

```python
df   = DatFile.parse(".../empires2_x2_p1.dat")
unit = df.civs[0].units[object_id]                  # civ 0 is gaia, 2701 slots
row  = df.terrain_restrictions[unit.terrain_restriction].passable_buildable_dmg_multiplier
allowed = [tid for tid, v in enumerate(row) if v > 0]   # 131 floats, > 0 = permitted
```

53 restriction rows × 131 terrains, joined to `random_map.def`'s 1114 constants, which the tool already scans.

### What it says, including about work already shipped

Restriction **19** — FISH, SHORE_FISH, TUNA, SNAPPER, SALMON, DORADO, DLC_BOXTURTLE — permits 15 terrains: 14 water plus 26 Ice Navigable, and **no beach, no shallow**. Restriction **13** (MARLIN1/2, and unit 61 'DOLP3' which is what `#const DOLPHIN 61` points at) and **3** (OYSTERS) permit 38: every water, shallow and beach plus the five rice farms — guide:4717's "water and amphibious terrains" for OYSTERS, verbatim, from the other side.

The bigger find is a second field nobody had looked at. `Unit.placement_side_terrain` is a two-slot "must sit beside" requirement, `(-1, -1)` on 1064 of 1083 resolvable entries and `(2, 35)` — Beach or Ice — on the rest; stripped of id collisions the users are **SHORE_FISH, DLC_BOXTURTLE and DOCK, and nothing else**. So yesterday's `shore` rule — open water, not a shallow, touching a beach — is not an approximation of the terrain table. It IS the terrain table, restriction 19 plus side-terrain 2, and the two objects that share the field are the two guide:4991 calls one family. **A rule reached by reading a guide gloss and a bug report turned out to be the two fields the engine actually stores.** Recorded because the reverse is the usual outcome, and because it is the strongest evidence yet that Sec.12 item 7's coarse classes were cut in roughly the right places.

Two smaller corrections fell out. `FISH_PERCH` is a real predefined constant and is **id 53 — the same unit as FISH**; there is no bare `PERCH` in `random_map.def`. And `MARLIN1`/`MARLIN2` carry `/* DOLPHIN1 */` and `/* DOLPHIN2 */` comments in DE's own file, so the marlins and the dolphins are one series.

### The trap that stops this being a loop

`random_map.def`'s numeric ids are **per namespace and collide freely**. Id 45 is `DOCK` and also `CUSTOM`, `DLC_CRACKED`, `CIVILIZATION_GEORGIANS` and `ATTR_BLAST_DEFENSE`. Id 61 is the dolphin unit and also `DLC_JUNGLEROAD` and `ATTR_CHARGE_EVENT`. 1083 of 1114 constants "resolve" to a gaia unit slot and most of those resolutions are meaningless — the first probe printed a side-terrain requirement for `CIVILIZATION_WEI`, which is how it was noticed. **An extraction that does not first decide which constants are OBJECT constants will confidently give civilizations and attribute enums a terrain habitat**, and every one of those rows would look plausible. Deciding that split — `random_map.def`'s own section structure is the obvious source and is unchecked — is the remaining work. The dat read is the easy half, which is the opposite of how the item was written up.

Also left open deliberately: restriction 19 permits **no shallow** while the preview's `water` class includes shallows, so a strict transcription is not a superset of what ships. Shipped maps put fish on shallows on purpose (`Menindee_AUS_v2.3.rms` writes `terrain_to_place_on SHALLOW` for every one of its fish, honoured ahead of habitat, so nothing visible changes today). Whether `habitat` stays four coarse classes or becomes the real per-terrain mask is a decision to take before transcribing, not during.

### Data

Ten rows added, eight updated. The six rows added yesterday with `constId: null` now carry their real ids (TUNA 457, SNAPPER 458, SALMON 456, DORADO 455, MARLIN1 450, OYSTERS 2170) and `verified: true`; DLC_BOXTURTLE gains 1141. New: MARLIN2 451, FISH_PERCH 53, the `FISH_*`/`GREAT_FISH_*` alias spellings `random_map.def` binds to the same units, and DOLPHIN/PERCH with `constId: null` because **neither is a DE constant** — the water answer for DOLPHIN comes from unit 61's restriction 13, and DE's own name for the perch is `FISH_PERCH`.

`idSource` is deliberately left absent on all of them: the schema says not to backfill it by hand, and these were read by a probe rather than by `tools/extract-constants`. It reads as slightly less provenance than the values have, which is the safe direction — the parser's RMS0204/RMS0205 gating only firms up its wording when provenance is trusted.

### Tests

**36 files / 1257 tests** (+2). `objects.test.ts` gains the rest-of-the-family habitat sweep and an id assertion that pins DOLPHIN/PERCH as null on purpose — absence of a number there is a fact about the game, not a gap in the transcription.

### Verification

`npm test` 36/1257, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## `water` and `amphibious` are two classes (2026-08-08)

The open question left by the terrain-table read — restriction 19 permits no shallow, but shipped maps put fish on shallows, so is a strict transcription safe? — was answered from outside the data, and the answer inverts the evidence.

**Fish cannot be placed on shallow-type terrain. The maps that appear to do it are using a workaround, and the workaround is the proof.** `Menindee_AUS_v2.3.rms` writes `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW … second_object FISH }`. Checked against the dat: `FISH_PLACEHOLDER` is unit 647, terrain restriction **0**, all 131 terrains permitted — an object with no restrictions at all, which is the entire reason it is the placeholder of choice. guide:2211 recommends exactly this, "bypass terrain restrictions by using an invisible placeholder object as the main object".

So the `terrain_to_place_on SHALLOW` belongs to the PLACEHOLDER and never to the fish, and the fish arrives as a second object with its own restriction never consulted. **Yesterday's write-up read those commands as "shipped maps place fish on shallows deliberately, so a strict transcription is not a superset of what ships" — the same sentence, read one level of indirection too shallow.** The maps are evidence that fish cannot be placed there directly, since otherwise nobody would pay for a placeholder. Same shape as the `terrain_to_place_on` overstatement two entries above, and from the same map: `Menindee` keeps looking like the general case and keeps being the special one.

### The split

`Habitat` gains a fifth value. `water` now means **open water only** (`DEPTH_WATER`); `amphibious` means **anything that is not plain dry land** — water, shallows and beaches. Rows reassigned strictly from the measured restriction id, not by judgement: restriction 19 → `water` (FISH, TUNA, SNAPPER, SALMON, DORADO, FISH_PERCH and the alias spellings), restrictions 13/3/15 → `amphibious` (MARLIN1/2, GREAT_FISH_MARLIN/2, DOLPHIN, OYSTERS, TRANSPORT_SHIP).

`land` was deliberately NOT re-expressed as `depth === DEPTH_LAND` while the neighbouring branches were being rewritten, even though it reads as the obvious tidy-up. It differs from the existing `!isWater` on exactly the three shallows the water flag calls dry (`DLC_MANGROVESHALLOW`, Ice Navigable, `DLC_MANGROVEFOREST`), and whether a land object may stand on those is unmeasured — a second behaviour change riding along unasked inside the first.

### Measured, seed 7 on Normal

`QS_Three_Bays_v1.1.rms`: TUNA 123, **all open water, 0 shallows** (was 119 water + 2 shallows before the split, and 0 water + 77 beach before yesterday's habitat rows). SNAPPER 3, all water. SHORE_FISH 213, all water.

`Menindee_AUS_v2.3.rms`: FISH_PLACEHOLDER 18 on shallows with its 18 second objects riding along on the same tiles, plus 26 SHORE_FISH also arriving as second objects on shallows. The bypass works and is visible in the output, which is the point — with fish now barred from shallows outright, this is the ONLY route they have.

**One visible consequence, chased down rather than waved through:** Three Bays' oysters now put 5 of 7 on beach, where both oyster commands write `terrain_to_place_on WATER`. Not a leak. Both use `set_tight_grouping`, and rev 6's measured rule is that a tight group checks the ANCHOR only — the fill is checked against habitat but not against the author's `terrain_to_place_on`. `amphibious` permits beaches because restriction 3 does, so the fill spills onto the adjacent sand exactly as the engine's own table allows.

### Tests

**36 files / 1260 tests** (+3). `objects.test.ts`: an ocean fish stays off an interposed shallow column; the amphibious family reaches it; and a `second_object` rides its main object's tile onto a shallow that its own habitat forbids. Two existing habitat sweeps were split to assert the two classes separately rather than loosened.

Mutation-tested three lines, each red then reverted. Restoring `water` to the water mask breaks the fish-off-shallows test; collapsing `amphibious` into `water` breaks the amphibious test; and **adding a habitat check to the second-object emit breaks the bypass test** — that last one is the regression this session most wants guarded, because it is a one-line "consistency fix" someone will reach for and it would silently empty every pond on Menindee.

### Verification

`npm test` 36/1260, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## `terrain_to_place_on` does not lift the terrain table (2026-08-08)

Reported: `AK_Hourglass_v2.0.rms`'s shore fish spawn all over the water instead of hugging the beach. The shore rule itself was fine; the command never reached it.

```
create_object SHORE_FISH { terrain_to_place_on WATER number_of_objects 200000 temp_min_distance_group_placement 4 set_gaia_object_only }
```

`buildCandidatePredicates` carried a carve-out: when a command wrote `terrain_to_place_on`, the habitat check was **skipped entirely**. So this command was filtered by "terrain must be WATER" and nothing else — no shore constraint at all, 788 shore fish across the open sea.

### Why the carve-out was wrong, and the evidence was already in hand

Its rationale: `terrain_to_place_on` "names the GROUND, which is the same thing habitat is guessing at, and the author saying so outranks our guess". The premise is right and the conclusion does not follow. **Naming a terrain does not lift the engine's terrain table**, and the proof is the placeholder idiom read from the other side: if `terrain_to_place_on SHALLOW` were enough to put a fish on a shallow, `Menindee_AUS_v2.3.rms` would write `create_object FISH { terrain_to_place_on SHALLOW }` and be done. It instead pays for `create_object FISH_PLACEHOLDER { terrain_to_place_on SHALLOW … second_object FISH }`, where the placeholder is unit 647 with terrain restriction 0 — all 131 terrains. **Nobody buys an unrestricted carrier object if naming the terrain already works.** guide:2510 names the actual override and it is `ignore_terrain_restrictions`, which is why that one still gates the check.

That argument was available one session earlier and was not made. The previous entry recorded the placeholder fact, used it to split `water` from `amphibious`, and stopped — the same fact also refutes the carve-out sitting fifteen lines further down the same function, and nothing prompted a re-read of the neighbours. **A fact that overturns one rule is worth pointing at every rule that quantifies over the same thing**, which is the `validate()`-era lesson about carrying a new rule back to the code that predates it, in miniature and within a single file.

### What survives

The carve-out is kept for **exactly the case that motivated it and no wider**: an UNDECLARED habitat. The reference data covers a few dozen objects of several hundred, so an unknown water object falls back to `land`, and an author writing `terrain_to_place_on SHALLOW` for one is the only signal there is — narrowing by a guessed `land` would place nothing and read as the object failing rather than as a restriction. Where the habitat came from the dat's own restriction table there is no guess to defer to, and the two narrow each other exactly as `layer_to_place_on` already does. `objectHabitatIsDeclared` is a separate exported predicate rather than a richer return type from `objectHabitat`, because it decides one thing and naming it is what makes the distinction visible at the call site.

### Measured, seed 7 on Normal, whole tracked corpus

Four maps change and **every single difference is SHORE_FISH**: Hourglass 788 → 245, `AK_ForeDaut_v1.3.rms` 66 → 36, `AK_Six_Points_v1.4.rms` 200 → 136, `OWWC1Tewaipounamu-edited-v1.2.rms` 84 → 75. Nothing else moves beyond ±2 on TUNA/MARLIN1 as vacated tiles reshuffle. `Menindee_AUS_v2.3.rms` is byte-identical at 14298 objects, which is the undeclared-habitat carve-out doing its job. On Hourglass all 245 survivors are open water AND adjacent to beach.

The count dropping is the fix, not a loss: the command asks for 200000 and gets as many as fit, so confining it to the beach ring is supposed to reduce it.

### Tests

**36 files / 1263 tests** (+3). A declared habitat and `terrain_to_place_on` narrowing each other (DEEP_WATER alone would allow two columns, shore alone one, both together exactly one — so the assertion cannot pass under either rule alone); a contradiction placing nothing rather than picking a winner; and an undeclared habitat still deferring.

Mutation-tested both directions, which matters here because the change is a conditional with two ways to be wrong. Restoring the old carve-out turns the first two red. Removing the carve-out entirely turns three red, including the `second_object` bypass and the pre-existing undeclared-habitat test — that second mutant is the one that shows the fix is a narrowing rather than a deletion.

### Verification

`npm test` 36/1263, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## `max_distance_to_other_zones` is a MINIMUM (2026-08-08)

Reported: `QS_Three_Bays_v1.1.rms` line 1145 is a "tuna everywhere" command and there was barely any tuna on the map.

```
create_object TUNA { number_of_objects 4096 temp_min_distance_group_placement 8 min_distance_group_placement 7 max_distance_to_other_zones 4 set_gaia_object_only set_scaling_to_map_size avoid_actor_area 3110 }
```

guide:2527, in its own capitals: *"Minimum (NOT maximum) distance, in tiles, that objects will stay away from terrains that they are restricted from being placed on"*, and guide:2528's worked example is "deep fish away from beaches". The predicate shipped as `dist !== UNREACHABLE && dist <= d` — a maximum, on both halves. So `max_distance_to_other_zones 4` confined the tuna to a 4-tile ribbon hugging the shoreline instead of pushing them 4 tiles off it into open sea: the exact inverse of what the line is for.

Two details worth keeping. The **UNREACHABLE half was inverted too**: no restricted terrain anywhere means the constraint cannot bind, so it must pass, and the old code failed it — an all-water map placed zero fish. And **preview-design Sec.6.6 already said "minimum, not maximum" and even flagged that the guide shouts it**; the spec was right and only the code was wrong, which is the failure mode a spec is supposed to prevent and does not when nothing tests the code against it.

**There was no test of this attribute at all — not one, in either direction.** That is the whole explanation for how an inverted comparison survived: the two sibling predicates immediately above it (`avoid_forest_zone`, `avoid_cliff_zone`) both carry the correct `dist === UNREACHABLE || dist >= d` shape, so the wrong one sat between two right ones and read as consistent at a glance. An attribute whose NAME contradicts its behaviour is exactly the one to write the test for first.

### Measured, seed 7 on Normal

`QS_Three_Bays_v1.1.rms` L1145: **118 → 200 tuna**, and spread over the whole sea rather than a shore ribbon. The remaining shortfall against the requested 16384 is the script's own spacing, not the predicate — 21638 open-water tiles, **17373 of them now qualify** (80%), and `min_distance_group_placement 7` caps a perfect lattice at ~355, so 200 from random sequential placement is the expected packing efficiency rather than a constraint biting.

**One consequence that goes the other way, isolated by disabling the predicate rather than assumed:** Three Bays' central-lake OYSTERS (×2) and SNAPPER commands now place nothing, where the old maximum reading placed 7 and 3. Disabling the predicate entirely gives 14 and 3, so it is this rule and not another. The mechanism is coherent — each is confined by `actor_area_to_place_in` to a small bay AND asked to sit 3 or 5 tiles clear of dry land, and inside those areas nothing is far enough out. **Whether the engine agrees is unmeasured, and this is the one place where the approximation could be ours rather than the author's**: our land generation only has to be slightly tighter than DE's for a bay that works in game to fail here. Recorded rather than tuned away, because softening a rule the guide states in capitals to rescue two commands is the move CLAUDE.md's `border_fuzziness` entry exists to warn against.

### Tests

**36 files / 1266 tests** (+3), the first coverage this attribute has ever had. An object pushed away from restricted terrain (grass at x = 0 and 1, so a water tile's distance is x − 1; d = 3 means x >= 4, where the old reading allowed x = 2..4 — the two bands share one column, so no assertion on minimum x can pass under both); the all-water map placing fish rather than none; and d = 0 being a no-op rather than a filter.

Mutation-tested by restoring the old `!== UNREACHABLE && <= d`: all three go red, then reverted.

### Verification

`npm test` 36/1266, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes.

## CREATION_PLAN 4.4 — the side panel resizes and collapses (2026-08-10)

The map preview + reference column shipped in 4.2 at a fixed 18rem, and 4.2 put it on the **Code** tab, which had been full width. So half of this step is a fix rather than a nicety: somebody who just wants to write code had lost that space with no way to get it back. The other half, dragging, is what makes the preview usable for actually inspecting a generated map, which is why the step sits after 4.3 rather than before.

### What landed

`src/components/sidepanel/sidePanelLayout.ts` — the arithmetic, pure and Node-testable. `clampSidePanelWidth`, `resolveSidePanelDrag` (returns a discriminated union, so a caller cannot read a width out of a collapse), `isSidePanelWidth` for the store round trip, and the four constants. `src/components/sidepanel/SidePanelLayoutContext.tsx` — width plus collapsed flag, persisted to `settings.json` alongside the help (1.7) and generation (2.5) settings. `src/components/sidepanel/SidePanelResizer.tsx` + its CSS — the 14px separator strip and the chevron button, plus `SidePanelReopener` for the collapsed state. `MapSidePanel` now renders a fragment of panel-then-separator and takes its width from context.

### The decisions worth recording

**The width is one value shared by both tabs, above the tab switch.** Local state would have been two independent widths that reset on every Breakdown⇄Code switch, since the inactive tab is genuinely unmounted — the trap `PreviewViewContext.tsx` exists to document, and the reason CREATION_PLAN 4.4 named that file. Unlike the two contexts already there, this one **is** persisted, and the line that decides it is the one `PreviewViewContext` already draws: a seed is where you happen to be looking right now, a panel width is how you want the app laid out.

**A drag writes to the store once, not sixty times a second.** `setWidth` updates state only; `commitWidth` writes. Every store write is an IPC hop into the Rust host, and putting one in a pointermove loop would be a disk-backed round trip per frame for a value that only matters once the user lets go. Keyboard resizing commits per press, which auto-repeat makes a few per second rather than ~60.

**The "leave room for the editor" rule is CSS (`max-width: 70%`), not drag arithmetic.** It has to hold when the *window* resizes, which is not a drag and would never run that code. One rule, in the layer that sees a resize without being told about it. `sidePanelLayout.ts` therefore clamps only to the panel's own bounds and says so.

**The collapse threshold has a margin (48px) below the minimum.** Without one, every drag that bottoms out collapses the panel, so the minimum width is unreachable — you can never actually sit at it. A test pins both edges of that margin.

**HelpTip wraps the button, not the strip.** HelpTip's wrapper is `position: relative` and its popup is `top: 100%`, so wrapping a full-height element anchors the popup below the entire pane, off the bottom of the app. Same trap `DiagnosticsRuler.tsx` documents for its ticks and the same fix: the sized element is the outer div and HelpTip goes inside it. One entry (`sidePanel.resizer`) covers resizing and hiding both, because it reads as one control — the call `PreviewPane` made when it reused `breakdown.sidePanel.previewToggle`.

`setPointerCapture` is the detail that makes the drag survive a fast pointer leaving a 14px strip, and the button's own `onPointerDown` has to `stopPropagation` or the click that hides the panel starts a drag instead.

### Tests

**37 files / 1279 tests** (+13, `sidePanelLayout.test.ts`). The component is not covered — this project has no jsdom environment — which is exactly why the rules worth asserting were put on the pure side of the line, the same split `teamModel.ts` uses.

Mutation-tested three lines, each confirmed red then restored: dropping `COLLAPSE_DRAG_MARGIN` from the collapse threshold (the "sticks at the minimum" test goes red), dropping the non-finite guard in `clampSidePanelWidth` (the NaN test goes red — a `NaN` width reaches React as no width attribute at all, so the panel silently shrinks to its content), and narrowing `isSidePanelWidth`'s bounds to strict inequalities (the boundary test goes red).

### Verification

`npm test` 37/1279, `npm run typecheck` clean, `npm run lint` 0 errors, `npm run validate:reference` passes. **Not visually verified** — this app calls Tauri store APIs synchronously on mount, so it cannot render outside the real host (see CLAUDE.md's sandbox caveats). Confirming the drag feel, the collapse, and that both survive a restart needs a local `npm run tauri dev`.

---

## Settings dialog — Preferences renamed and split into tabs (2026-08-10)

Preferences was one box holding one radio group. It is now **Settings**, a tabbed dialog with six tabs: **General, Hotkeys, Theme, Breakdown, Code, Advanced Tools**. Only General has controls today (help mode, moved across unchanged); the other five are placeholders that each name what they are for and what they are expected to grow.

### What moved

`PreferencesDialog.tsx` and `PreferencesDialog.module.css` are deleted. In their place:

- `src/components/dialog.module.css` — the modal chrome (overlay, box, title, option row, actions, close button), lifted verbatim out of the old stylesheet.
- `src/components/settings/SettingsDialog.tsx` + `.module.css` — the shell: vertical tab strip, panel, close.
- `src/components/settings/settingsTabs.ts` — the tab table.
- `src/components/settings/GeneralSettings.tsx` — help mode.
- `src/components/settings/SettingsPlaceholder.tsx` + five one-call wrappers around it.

`App.tsx` (`settingsOpen`), `TitleBar.tsx` (`onOpenSettings`, label "Settings") and `ui-help.json` (`titleBar.settings`, `settings.helpMode`, six `settings.tab.*` entries) follow the rename.

**The stylesheet split is the part that was not just a rename.** `GenerationSettingsDialog` imported `PreferencesDialog.module.css` across a component boundary — fine while both dialogs were the same plain box, wrong the moment one of them grew a fixed-size two-column layout, since `.dialog` is the class both were reading. Generic chrome now lives in `dialog.module.css` and settings-specific rules live beside the settings dialog. Generation Settings stays a separate dialog rather than becoming a Settings tab: those are properties of the script being written, not preferences about the app, which is why they open from the status bar.

### Decisions worth recording

**The tab strip is vertical.** Six labels do not fit across a dialog the width of its content, and a sidebar keeps the list cheap to extend.

**Tabs are data, not a switch statement.** `SETTINGS_TABS` carries the panel *component* per entry and the dialog renders `<ActivePanel />`, so adding a tab is one table entry plus one file and the dialog never changes.

**The box is a fixed size and the panel scrolls inside it.** A dialog that resizes per tab moves the tab strip out from under the cursor.

**Roving tabindex, selection follows focus.** Only the selected tab is in the tab order; arrows, Home and End move within the strip. Selection following focus is right here because switching panels costs nothing — nothing loads or submits.

**Panels are keyed by tab id**, so switching remounts rather than reusing the previous panel's state. Unrelated panels sharing a mount would leak state between them once they hold real controls.

**`.tabList > span` is `display: block`.** HelpTip always renders its own `<span>` wrapper (the fix recorded against the StatusBar cog and Add Command width), so the span is the flex item, not the button — without the rule the buttons shrink to their text width instead of filling the strip.

### Verification

`npm test` 37/1279, `npm run typecheck` clean, `npm run lint` 0 errors (13 pre-existing warnings, none in the new files), `npm run validate:reference` passes. **Not visually verified** — this app calls Tauri store APIs synchronously on mount, so it cannot render outside the real host (CLAUDE.md's sandbox caveats). Confirming the layout, the arrow-key strip and Escape-to-close needs a local `npm run tauri dev`.

## Preview — tile selection, a readout that wraps, and shortened constant names (2026-08-10)

Three changes to the preview pane, all in the UI layer. No generator file was touched.

**Click a tile to pin its readout.** Hover already produced a readout and it vanished the moment the pointer left, which is exactly when you want to read it — the tile you are inspecting is usually the one you then want to compare against the notes drawer or the code. A click now selects, a second click on the same tile deselects, and a `Clear` button next to the readout does the same thing for anyone who has panned the tile off screen. The selected tile draws an amber diamond over the white hover one, and `drawHighlight` generalised into `drawTileOutline(colour, weight)` since the two differ only in those two values. Selection is drawn AFTER the hover outline so it stays visible when the pointer rests on the tile that is already selected.

**Click and pan are separated by accumulated travel, not by distance from the press point.** The canvas takes pointer capture on press for panning, so an `onClick` handler would also fire at the end of every drag. `endDrag` therefore does the click detection itself, against a `travel` counter that sums `|dx| + |dy|` over the whole gesture — a drag that wanders out and comes back has small displacement and large travel, and displacement alone would call it a click. Threshold is 4 px; zero would make selection nearly impossible, since a mouse moves a pixel or two during any real click. `pointercancel` passes `clicked: false`, because a gesture taken away from us is not a gesture the user completed.

**The selection is coordinates, held above the tab switch; the description is derived.** `PreviewViewContext` gains `selectedTile`/`toggleSelectedTile`/`clearSelectedTile`, alongside the seed and colour mode and for the same reason — `PreviewPane` unmounts on every Breakdown⇄Code switch. Storing `{x, y}` rather than a captured `HoveredTile` is the part that matters beyond tab switching: **a selection outlives the re-roll that regenerates the map**, and a stored description would keep showing the previous generation's terrain under a tile the user is looking at right now. Deriving on every render makes that impossible by construction. `PreviewCanvas` consequently no longer describes tiles at all — it reports coordinates and the pane looks them up (new `components/preview/tileInfo.ts`, holding `TileInfo`, `indexObjectsByTile`, `describeTile` and `tallyObjects`, all pure and unit-tested). The object index moved up to the pane with it, so hover and selection share one index rather than building two.

Guarded: a `dim` change (a re-roll at a different map size, or `override_map_size`) can leave a selection off the new grid. Reading past a typed array's end yields `undefined`, which renders as "terrain undefined" rather than throwing, so the bounds check is explicit and the readout falls back to the hint line.

**The readout wraps instead of truncating.** It was one `white-space: nowrap` line with `text-overflow: ellipsis`, in a column ~300 px wide. A tile with a few objects on it always overflowed, so the cut fell on the objects — and a stacked tile is usually the reason anyone looked at it. It is now a two-column grid (`auto 1fr`), one row each for Tile, Terrain (plus its layer), Elevation (plus cliff) and Objects, with `overflow-wrap: anywhere` on the value column so a long object list grows the pane by a line rather than disappearing. The header says "Selected tile" or "Hovered tile", because a readout that stops following the pointer with no explanation reads as a frozen UI.

**"Shorten long #const / #define names", Settings ▸ General, on by default.** A name over six characters displays as its first three letters plus a single-character ellipsis (`SHORE_FISH` → `SHO…`); hovering shows the full name. `src/settings/nameDisplay.ts` is the pure rule, `AppSettingsContext` is a third settings context persisting to the same `settings.json` under `shortenLongNames`, and `components/ScriptName.tsx` renders one name.

Two decisions inside that:

- **A third context rather than a field on `HelpSettingsContext`**, which already loads the same file. The split is by what the setting is about, not by where it is stored: `HelpSettingsContext` is read by every `HelpTip` and by the imperative Monaco hover provider, and widening it would re-render all of that for an unrelated preference.
- **The full name rides on a native `title`, not on a `HelpTip`** — a deliberate exception to the wrap-everything-in-HelpTip rule. HelpTip is gated on the help-mode setting, so with tips off the hidden name would be unreachable. This is the one case where the tooltip is not an explanation of a control but **the data itself**, and a value the app has chosen to hide has to stay recoverable regardless of how the help system is configured. `<abbr>` rather than `<span>`, since that is precisely what it is and screen readers announce the expansion.

Scope note: this applies to object names in the tile readout, which is where a script-written name actually reaches the preview UI (`PlacedObject.objectRef` is "the RMS constant name as written"). Terrain names in the readout and legend come from `game-constants.json` and are resolved back to the canonical constant, so a script `#const` never surfaces there.

### Mutation tests

`shortenName`'s `<=` boundary flipped to `<` — three tests red, restored.

`tallyObjects`'s key reverted to the name-first, no-separator form — and **it survived**, which was the finding. The test written for it (`"BOAR"` gaia vs `"BOAR"` owned by player 1) cannot fail under that form, because those two keys differ anyway. The pair that separates the forms is `MARLIN1` placed by gaia against `MARLIN` owned by player 1 — **both are real DE constants** — which collide into one tally with the name first and one of the two vanishes from the readout. A test for that case was added, confirmed red under the mutation, then the key restored to player-first (`1:MARLIN`), where a number or the literal `gaia` always terminates at the colon and no pair can collide. Same shape as the `bucketWeights` finding in `lands.ts`: the first test passed under the bug it was named after.

### Verification

`npm test` 39/1300, `npm run typecheck` clean, `npm run lint` 0 errors (14 warnings, all pre-existing categories — the new context draws the same `react-refresh/only-export-components` warning every other context in the app does), `npm run validate:reference` passes. **Not visually verified**, for the standing reason in CLAUDE.md's sandbox caveats: this app calls Tauri store APIs synchronously on mount, so it cannot render outside the real host. Confirming click-to-select, the wrapped rows and the shortening toggle needs a local `npm run tauri dev`.

### Merge note

Written alongside two parallel sessions (the side-panel resize/collapse and the settings-dialog split). The settings work was already on disk and complete when this started, so `GeneralSettings.tsx` was extended in place rather than duplicated; the only shared files touched are `App.tsx` (one provider), `GeneralSettings.tsx` (one fieldset), `ui-help.json` (two entries) and CLAUDE.md's test-count row.

---

## 5.1 rev 5 — third independent critique folded in (2026-08-10, design only, no code)

`docs/tools-api-design.md` goes rev 4 → rev 5. Two rounds were outstanding: the rev-4 review (two passes, both dated 2026-07-30, never folded in) and a new rev-5 review. Every repo claim in both was re-derived against the working tree before acting.

### The finding that shaped the whole round: a review is a repo snapshot too

The rev-4 review was accurate on 2026-07-30 and **four of its twelve findings had decayed by 2026-08-10**. Folding its edit list in verbatim would have landed three wrong instructions:

- **B1's fix is obsolete.** It told rev 5 to replace "create `MAP_SIZE_TILES`" with "resolve it from `predefinedLabels`". That resolver now exists — `resolveMapDim` in `src/preview/generator/mapDimensions.ts`, tested over all seven sizes — so writing a second one is the same mistake one level down. The criticism held; the prescription did not.
- **B2 is already implemented, and the repo went the OTHER way on purpose.** `PredefinedLabel` is typed at `language.ts:126` with its 10-member category union at `:107`. But the review prescribed making `predefinedLabels` non-optional and `language.ts:148-160` deliberately keeps `?`, with a comment giving the reason (nothing checks the shape at runtime; a non-optional type makes preview-design's mandated `?? []` guard read as dead code). Rev 5 records this as settled and says not to re-litigate it.
- **B3's fix would now make things worse.** "Promote the hover module's interface" rested on that interface being the complete view. `game-constants.json` went from 31 entries / 7 keys to **164 / 17**; ten fields exist in none of the five TypeScript views. Promoting any of them publishes a type missing ten fields. The published type is now generated from the schema instead, which is the artefact CI already validates.
- **Its game-constants Minor is factually inverted, and edit-list item 14 was a trap.** It states twice that all 31 `constId` are null and all 31 `verified` false, and tells rev 5 to go "correct" CLAUDE.md and `build-log.md:395` for describing a file that does not exist. Measured 2026-08-10: **164 entries, 2 null `constId`, 44 `verified: true`.** Both documents are right and acting on item 14 would have broken them.

Standing instruction now written into the spec (Sec.10.2): **fold a review in by re-deriving each finding, not by transcribing its edit list.** The half-life of an undated repo claim here is about a week.

### Blocking findings from the rev-5 round

- **`read-settings` could not construct the input the flagship tool's own dependency requires.** `generatePreview` takes `PreviewSettings = { playerCount, mapSize, teams }` (`generator/types.ts:37-54`); `ToolContext.settings` supplied only the first two. Per-player team assignment landed 2026-08-01, after rev 3 pinned the settings shape, and it is not cosmetic — it decides the player ring, `grouped_by_team`, `set_zone_by_team`, and the whole `TEAMn_SIZEm` / `PLAYERx_TEAMy` label environment S0 builds branch selection from. A checker handed only `playerCount` invents teams or silently generates a different map than the pane is showing. `teams: number[]` added, narrowed by the existing `isTeams` guard.
- **`mapSize.tiles` is the LOBBY dimension and a script can change it.** `override_map_size` (`instantiate.ts:288-302`) replaces it, and `InstantiatedScript.dim` is what every stage generates against. Any static check keyed on map area — `land_percent` over-allocation, impossible count×spacing, both named in CREATION_PLAN 5.2's brief — computes against the wrong grid on every overriding script, and fails quietly in the direction of "your map is fine". One sentence in Sec.2 that is impossible to guess.

### Three numbers the review left as "decide it", now decided

- **The seed stays OUT of the context.** The pane's seed is view state in `PreviewViewContext` (defaults to 1, not persisted); the Monte Carlo layer varies the seed by construction so it is the one value it does not want; and a tool that wants a fixed seed already has an `integer` param, which the host validates and which the settings echo puts in the output header. A tool needing to reproduce the pane exactly is a future `read-preview-view` capability and an escalation, not a silent widening.
- **Cancel grace 5s → 15s, derived rather than rounded.** 5s is shorter than one unit of the flagship tool's own work: one generation costs a median ~460 ms and up to **3.8 s** over the 32 tracked maps, against a machine load factor reaching **3.7×**. A perfectly cooperative checker cancelled one millisecond into `24hr_Caverns.rms` missed the deadline under any load and was killed as if wedged. 3.8 × 3.7 ≈ 14, so 15s with the derivation stated. Same mistake the preview watchdog already paid for in the other direction. Related: the chunk unit is now **one generation**, not "one batch" — `generatePreview` is synchronous and cannot yield inside itself, and a tool-chosen batch size would make the deadline measure the batch rather than the cooperativeness.
- **A run watchdog now exists at all: 30s of silence.** Rev 4's only kill path was post-cancel, so a wedged built-in bricked the pane until app restart (one run app-wide). Chunking is already mandatory, so silence is the right signal; 30s is ~2× the legitimate worst gap between chunk boundaries. One worker per run makes the kill the whole recovery — no retry cap needed.

### Also folded in

`ErrorReason` splits `cancelled` / `killed` / `unresponsive` / `protocol` / `tool-error` (rev 4 collapsed an honoured cancel and a hard kill into one terminal, throwing away the only signal that a tool misbehaves). Sec.1 names the prohibited value set explicitly instead of saying "serializable" — `undefined` and `Map`/`Set` are both live today (`InstantiatedValue` carries `undefined` as load-bearing; `LanguageIndex` is Maps and Sets, so **every tool must build its own index**). Sec.9's round-trip test moves to **`toStrictEqual`**: `toEqual` ignores undefined-valued keys by design, so the load-bearing test was blind to the exact class it existed to guard. `codeRef` carries a `Span` rather than a bare offset. `selection` is added as `{ offset, item? }` — **not** the rev-4 review's `Span`, which is not implementable: the Monaco editor instance only exists while CodePane is mounted, and a tool runs from the Tools tab, so `useSharedSelection`'s offset anchor is the only thing that survives the tab switch. `read-settings` → `read-generation-settings`, because `settings.json` now holds four unrelated families and this is a v1.1 consent-dialog string. Apply now ends at `reparseNow(source)`, and states that `rebaseEdit` is **not** for tool edits.

The surviving rev-4 findings all land: source-equality staleness gate (B4), host-side stale-run rejection without a wire `runId` (B5), inbound validation and stdout caps (B6), `multiSelect` plus the `string[]` union widening (S1), Sec.6's capability list corrected to include `read-reference` (S3), the deep-clone-before-convert pin (S4), `ParseResult<N>` parameterization (S5), `applyTextEdits` named as new work with the descending sort demoted to an implementation detail (S6), document-replace cancel and the settings echo (L1, L2), the pane's seven `ui-help.json` ids.

### The highest-value item, and why it is a test rather than a rule

**Three consecutive revisions were broken by the same dependency.** Rev 3 typed `settings.mapSize` as `number` against a string union; rev 4 had `tiles` with no source of truth while the data had one; rev 5 found `teams` missing three weeks after it shipped. Each was filed as "a cross-doc data dependency same-author review structurally misses" — a rule that has now failed three times, because it asks a reader to notice an absence. Sec.9 item 2 is a four-line test that builds a `PreviewSettings` out of a `ToolContext` and calls `generatePreview`: it is the flagship tool's actual first step and **it stops compiling the day the app's settings type grows a required field**. Its limit is stated in the spec rather than oversold — it does not catch a new optional field, or a stable type whose meaning changed.

### Two things found in this pass that neither review had

- **Sec.2's normative type block still said `parseResult?: ParseResult` while Sec.4 pinned it as `SerializedParseResult`.** The code block is what an implementer copies. Fixed.
- **`tools-api/` at the repo root would ship untypechecked.** `tsconfig.json:23` is `"include": ["src"]`, so `tsc --noEmit` never sees a root-level `tools-api/index.ts` — the one file destined to be a published artefact. ESLint would cover it (`**/*.{ts,tsx}`); the purity gate would not, since its globs name the three `src/` directories explicitly. Sec.8 now says to decide this in the same session that creates the directory.

### Housekeeping

The rev-2/3/4 changelogs moved out of the spec into this log, following `preview-design.md` rev 7 and for its stated reason. The rev-4 preamble ("written without a scheduled critique pass") and Sec.9's "no critique pass — read this hardest" heading were both false after three rounds and are gone. Rev 3's 5.2 sequencing warning is **re-pointed rather than deleted** (Sec.10.1): `constId` is real now, so "all placeholders until 4.0 lands" would be ignored the first time someone opened the file — what is actually still soft is `resourceAmounts` on 8 of 164 rows, 116 of 131 terrains `verified: false`, `language.json` at 28/41 commands and 38/94 attributes, and `resourceTotals.ts` not modelling script-level resource modifiers at all. New open item recorded in Sec.10: **PLAN.md and CREATION_PLAN 5.2 both assume "1000 runs should be seconds, not minutes", and at the measured median that is ~8 minutes for one player count and ~30 for the 2/4/6/8 matrix.** `collectSnapshots: false` is the only cost knob the generator offers and its effect has never been measured. A 5.2 problem, but it is what sizes the protocol's progress/cancel/`partial` design.

The two `MAP_SIZE_TILES` propagation sites in this log are corrected above: the rev-4 line carries a bracketed withdrawal (it is a changelog) and the `Next:` line's instruction is deleted outright.

**No code or data changed this session.** Design docs only: `docs/tools-api-design.md`, this log, and CLAUDE.md's Phase 5 row. `npm test` was not run and has no reason to have moved.

## Reference table — the Preview Obj. List (2026-08-10)

A fourth mode beside Terrain/Objects/Commands, and the first one in that panel that is a **control** rather than a lookup. It lists every object the open script names, with how many the current generation placed and a tick box deciding whether the canvas draws it.

### Where the rows come from, and why not from the placed objects

`result.objects` was the obvious source and it is the wrong one on its own: it only knows what reached the map, so an object the script asks for and the generator never places would simply be absent from the table. Absent reads as "the table does not cover that", when the answer worth showing is **0**. That number is the diagnostic — it is what a terrain restriction or a distance band nothing satisfies looks like from the outside, and the class of bug the last four review rounds were mostly about.

So `src/components/sidepanel/objectInventory.ts` walks the AST instead. Four places name an object and the fourth is easy to miss: `create_object X`, `add_object X` inside a group, `second_object X` (guide:2211's placeholder idiom, where the second object is the one the author cares about), and `create_object G` where G is a **group name** rather than an object — excluded, because no placement ever carries the group's own name and a row for it would read 0 forever. Group names are collected in the same pass for exactly that subtraction. Branch contents count from every branch of an `if`/`start_random`: the table is about what the script mentions, and a name that only appears under `percent_chance 5` is the one hardest to find by reading.

The rows are then **unioned** with the spawned tallies. That direction matters as a safety property rather than a nicety — the checkboxes are keyed on rows, so anything drawable without a row would be permanently unhideable.

Sorted by name, not by count: the counts change on every re-roll, and a table that reorders itself under the pointer is unusable for the one thing it exists for.

### Hiding is a view filter and stays one

`hiddenObjects` is a `ReadonlySet<string>` on `PreviewViewContext` (above the tab switch, same reasoning as the seed), consumed by `drawPreview`'s object loop. **A set of hidden names rather than a map of visible ones**, because the default is "draw everything": the empty set IS the default state, and an object written for the first time after an edit is visible without anything having registered it. Per-object visibility flags would make a new name's default depend on whether the table had seen it yet.

The filter lives in the renderer, not upstream of it. Filtering `result.objects` would have been fewer lines and would also have removed the hidden objects from the tile readout and from their own Total Spawned count, turning a display control into something indistinguishable from a change to the generation.

A "Show all (N hidden)" button appears above the table while anything is hidden. Unticking is per row, and a long list can end up with a dozen hidden objects and no record of which — re-ticking them one at a time is the kind of chore that makes people abandon a control.

`PreviewCanvas` takes the set as a **prop** rather than calling `usePreviewView()` itself: the pane already subscribes to that context, and a second subscriber would re-render the canvas on every seed keystroke and colour-mode click for a value it does not read.

### The warning, and why it is outside the panel

Unticking anything raises a triangle beside the Preview Obj. List label and a 10px band of yellow inside the section's edge. Both exist because the **effect shows up where the control is not** — objects missing from a map, with the table that explains it three radio buttons away and not even on screen while Terrain is selected. The band is an `::after` overlay on a new non-scrolling `.section` wrapper, not an inset shadow on `.panel`: an inset box-shadow on a scroll container moves with its content in Chromium, so the band would have slid out of view the moment the table was scrolled.

### Tests

8 new (`src/components/sidepanel/__tests__/objectInventory.test.ts`), against real `parseRms` output. Three mutants confirmed red then reverted: dropping the group-name subtraction, dropping `second_object` from the attribute check, and dropping the union with the placed tallies — each turns exactly the test written for it red and nothing else. Full suite measured **41 files / 1321 tests** on this mount, which includes a parallel session's work; CLAUDE.md's row is updated to the measurement.

Not visually verified — the app cannot render outside the Tauri host (see CLAUDE.md's sandbox caveats). `npm run tauri dev` locally is the confirmation.

## 2026-08-10 — Sec.15 item 23 closed: the terrain table is extracted and taken

The remaining half of item 23, automating what was demonstrated by hand on 2026-08-08. `tools/extract-constants` gains `--habitat-only` (with `--dry-run`), which derives `habitat` for every object entry from the engine's own terrain restriction rows, reports every disagreement with what the file already says, and only then writes.

### The run agreed with the hand assignments, and the first version of the derivation did not

**Result: 18 of 18 hand assignments reproduced, 13 habitats added to entries that had none, 0 contradictions.** The nine ordinary fish stayed `water`, SHORE_FISH and DLC_BOXTURTLE stayed `shore`, the great fish, OYSTERS and TRANSPORT_SHIP stayed `amphibious`.

That is the second result. The first run of the first implementation moved every fish to `amphibious`, which would have undone the `water`/`amphibious` split this same item established two days earlier and put fish back on the shallows. The cause is worth recording because the code read as careful: `derive_habitat` was an ordered chain of predicates, and its `amphibious` test was "the row permits any hybrid terrain". Restriction 19 permits 15 terrains — 14 open water and **26 `Ice, Navigable`**, which carries `isHybrid` in our own terrain table. One terrain out of fifteen tripped a threshold and flipped nine rows.

**The replacement asks a different question: which of the classes the app implements has a terrain set closest to this row?** Smallest symmetric difference wins. It reproduces every hand assignment by a margin rather than a hair:

| row | objects | permits | best | runner-up |
|---|---|---|---|---|
| 19 (ordinary fish) | 12 | 15 | **water**, differs on 1 | amphibious, 18 |
| 13 / 3 / 15 | 21 | 38 | **amphibious**, 5 | water, 24 |
| 0 (unrestricted) | 72 | 131 | **any**, 0 | land, 21 |
| 7 (most land objects) | 177 | 116 | **land**, 8 | any, 15 |

The class sets are transcribed from `objects.ts`'s `habitatMask` and `grid.ts`'s `terrainDepth`, not paraphrased from the schema's prose, because the whole method is "which class does the app actually implement that comes closest" — scoring against a class the app does not have would be measuring nothing. Two transcription details look like slips and are not: `land` is `!isWater` and deliberately not `depth === LAND`, and `water` excludes hybrids even though they carry `isWater`, because `terrainDepth` tests `isHybrid` first and returns early.

**The generalisable part: a threshold over a derived flag is a model, and this one was never pointed at the case it existed to decide.** "Permits any hybrid" was written while reading rows that had many hybrids or none; the row with exactly one was the whole question and nobody looked at it. Same family as `max_distance_to_other_zones` two days earlier — an inversion that read as consistency because its neighbours looked the same.

### The mismatch number is kept, and it prices the vocabulary

`derive_habitat` returns a `HabitatFit`, not a string: the chosen class, how many terrains it differs from the engine's row by, and the runner-up with its distance. All of it goes into the entry's `notes` and is printed worst-first by the run.

This is what answers the question the item left open — whether the five coarse classes should be retired for the raw 131-terrain mask. **They stay, and they now carry the size of what they cost.** The land family fits worst: restriction 8 (GOLD/STONE/FORAGE) permits 83 of the 110 terrains `land` covers, so 27 terrains where the engine says no are terrain the preview still uses. That is a limit of a five-value vocabulary rather than an error in the join, and `land` still wins by a wide margin (runner-up `any` at 48). The argument for retiring the classes is now a number in the file instead of a judgement.

Two cases the mode reports rather than acts on. A **tie** between the best two classes leaves the entry alone — picking one of a tie is a coin flip wearing a measurement's clothes. And a `placement_side_terrain` the chosen class cannot express is **flagged**: `shore` is `water` plus "must sit beside a beach" and applies cleanly to restriction 19, but the DOCK family carries the same `(2, 35)` over an `amphibious`-shaped row (restriction 6) and no class says that. No DOCK is in the reference data today, so it reports and changes nothing.

### The namespace split was the blocker, and the check that mattered ran the other way

`parse_random_map_def_sections` reads the `/* SECTION */` comments that `strip_rms_comments` throws away, so it is deliberately line-based rather than built on it. `object_constants` keeps the five object sections and drops `STRING_*` (localisation ids) and `*_CLASS` (unit-class ids, a third id space): **1114 flat names become 618 object names.**

Resolving is not the same as being right — 45 is `DOCK` and `CUSTOM` and `CIVILIZATION_GEORGIANS` and `ATTR_BLAST_DEFENSE`, so an id that "works" proves nothing on its own. So every one of the 31 resolvable object constants was checked against its unit's own name in the dat: `GOLD`→`GOLDM`, `STONE`→`STONM`, `SHORE_FISH`→`FISHS`, `TUNA`→`FISH3`, `OYSTERS`→`Oysters`, `MONUMENT`→`KOH-FLAG`. All 31 correct. `DOLPHIN` and `PERCH` resolve to nothing and are correctly left alone — both are script-level `#const`s, not names the file defines.

### What changed in the data, including the part that is not a documentation change

13 entries gained a habitat: GOLD/STONE/FORAGE, DEER/BOAR/SHEEP/WOLF, RELIC/VILLAGER/KING, HOUSE, TOWN_CENTER (all `land`) and MONUMENT (`any`, on an exact fit — it is unit 826 `KOH-FLAG`, a King-of-the-Hill marker the engine really does allow anywhere).

**Writing `land` where the field was absent is not a no-op even though the generator's fallback for an absent habitat is also `land`.** It flips `habitatIsData`, which is what decides whether an author's `terrain_to_place_on` narrows the habitat or replaces it. So `create_object GOLD { terrain_to_place_on WATER }` now places nothing instead of placing on water, which is what restriction 8 says the engine does. Intended, and correct, but a behaviour change rather than a data annotation — worth stating because the diff looks like the latter.

### Tests

28 new Python tests (45 → 73 in `test_extract_constants.py`, which is stdlib unittest and not part of the vitest suite, so CLAUDE.md's test row is unaffected by them). Seven mutants run through a harness that asserts each match is unique before substituting and verifies the restore by hash.

**Two of the seven survived the first pass, and both were real holes.** A `water` class that quietly includes the shallows still beat `amphibious` on the fish row, just by less — the ranking tests could not see it, and a `water` that includes shallows is a fish standing on walkable ground. Fixed by pinning the class *definition* (an open-water row must fit `water` **exactly**, mismatch 0) rather than only its rank. And the commented-out-`#const` guard survived because the fixture had no live definition *after* the comment, so the bogus section was never created and nothing was lost — which is precisely the shape of the real defect, where the damage is to the names *below* the comment. Fixed by adding one, and by asserting the name survives into the object namespace. All seven red after that.

Full vitest suite green (40 files / 1318 tests on this mount at the time of the run; a parallel session has since landed more). `npm run validate:reference` passes. A second `--habitat-only` run is byte-identical, so the mode is idempotent against the real file and not only in the unit test.

## 2026-08-10 — RMS0304 built, the last unbuilt Sec.8 check

The wrong-section check, unbuilt since `validate()` shipped on 2026-07-31 and unblocked by RMSTEST_33a/33b on 2026-08-04. Built the only way the spec allows, which is the whole content of the work: **driven by a per-command `sectionLocked` flag, never by `CommandDef.section`.**

### The two fields, and why one of them is not the other

`CommandDef.section` records where the guide DOCUMENTS a command. It is not a claim about the engine, and treating it as one is the trap this check has been sitting in front of for six weeks. `sectionLocked` is the engine claim, set only where an in-game run measured it, and today that is exactly two commands:

- `create_terrain` — RMSTEST_33a put it in `<OBJECTS_GENERATION>`, three runs on a 200 map, **zero SNOW** (40000/40000 base terrain).
- `create_object` — RMSTEST_33b put it in `<TERRAIN_GENERATION>`, three runs, **zero GOLD**.

In both, the script's own `base_terrain GRASS` applied normally, so the script parsed and ran and exactly one command was discarded. Each command's `notes` in `language.json` now carries its run, so the flag cannot be copied to a third command without someone noticing there is no sentence to write.

Everything else is silent. That is not caution, it is the measurement: 39 of 41 commands have never been tested in a wrong section, and the corpus contains a standing counter-example proving at least one of them is not locked the way its `section` implies.

### The corpus census is a permanent test, not a number in this entry

CREATION_PLAN 2.7 asked for the corpus counted before and after, per command name. `src/parser/__tests__/rms0304.measure.test.ts` prints both columns on every run, and **recomputes the rejected design rather than quoting it**:

```
===== if driven by CommandDef.section (the rejected design): 53 =====
   52  effect_amount
    1  create_player_lands
===== as shipped, driven by sectionLocked: 0 =====
sectionLocked commands (2): create_terrain → <TERRAIN_GENERATION>, create_object → <OBJECTS_GENERATION>
files walked: 57
```

53 → 0, reproducing the 2026-07-31 figure exactly. The 52 `effect_amount` hits are `24hr_Blind Valley.rms`, `QS_Three_Bays_v1.1.rms`, `TC2 - Comeer v1.4.rms` and `W4 - Immersion.rms`, all shipped and working; the 53rd is `create_player_lands` in `<PLAYER_SETUP>` in our own `test-maps/sample.rms`.

Keeping the rejected design **executable** next to the shipped one is the point. "52 of 53 were false positives" is the kind of fact that decays into folklore a later session either re-derives from scratch or quietly disbelieves while simplifying the check — and this project has already paid three rounds for that class of mistake (BUG-002, BUG-005). A number that recomputes itself cannot go stale, and it will move on its own if the corpus ever grows a real hit.

### Zero corpus hits is the expected result, and is not evidence the check works

The corpus is expert-written and DE-official; nobody ships a `create_object` in `<TERRAIN_GENERATION>`. Same situation as RMS0314, and the same response, because **a check that has only ever passed proves nothing**:

- Eleven worked examples in `validate.test.ts`, in both directions. Every negative case is a specific false positive — `effect_amount` outside `<PLAYER_SETUP>`, `create_player_lands` in `<PLAYER_SETUP>` — rather than a general "does not overfire" gesture.
- **Six mutants, all confirmed red then restored by hash.** Deleting the `sectionLocked` gate (2 red), deleting the suppression (1), deleting the raw-node marker (1), dropping the unknown-section exemption (1), inverting the match test (7). The sixth is the one worth naming: **deleting `"sectionLocked": true` from `create_terrain` in `language.json` turns four tests red**, which is the proof the check reads the data rather than a name list, and the only mutant that could have caught a check that merely looked data-driven.

### Three silences, each a refusal to claim past the measurement

- **The preamble.** What was measured is a locked command in the WRONG section, never one in NO section. `currentSection` is undefined while the preamble is walked and the check returns.
- **An unrecognised section header.** What the engine does with a header it does not know is not something anyone has run.
- **Anything after a degraded region in the same section.** This is Sec.8's wrong-section suppression rule, revived here because RMS0304 was its only consumer and the spec says to revive them together.

The suppression rule is not hypothetical. The parser's recovery scan **absorbs a section header outright** when only conditionals are open (`parser.ts`: "Only conditionals open → legal spanning; absorb the header"), so every item after a degraded region can be attributed to the wrong section — and warning on those would report the parser's own recovery as the author's mistake, on exactly the broken files where an extra warning is least readable. It is deliberately triggered by **any** `RawNode` rather than only the reasons that can swallow a header: the two directions are not symmetric, since over-suppressing loses a true positive in an already-broken file while under-suppressing manufactures warnings out of recovery, and this check's entire history is false positives.

Two tests pin the boundary in both directions — silent after a degraded region, and firing again at the next real header, which by construction cannot have been swallowed.

### Threading, and one small structural note

`validate.ts` gained `currentSection` and `sectionAttributionLost` as mutable fields rather than `walkItem` parameters, matching the reasoning already written above `guards`: `walkItem` is an eight-arm discriminated-union switch and only two arms care. The `raw` arm stops being a pure no-op — it still emits nothing, but it now records that section attribution is no longer trustworthy.

`CommandPicker.tsx`'s comment was updated rather than deleted. Its section filter stays advisory, and now for a third reason: the filter reads `section` (documentation) and the diagnostic reads `sectionLocked` (engine), so the two are deliberately different sets rather than one lagging the other.

### Verification

`npm run typecheck`, `npm run lint` (0 errors, 14 pre-existing warnings) and `npm run validate:reference` all clean. Full suite **42 files / 1340 tests** green.

**One thing to re-run rather than trust.** The first full run of the session reported 2 failed / 1334 passed; three subsequent runs were clean, and the file count moved 40 → 41 → 42 across them as a parallel session landed work. The failing run's JSON report was cleaned up before it could be read, so which two failed is unrecoverable. Consistent with the load-dependent flakiness this file already documents, and with a suite being measured while another session writes to it, but it is an unexplained red rather than a diagnosed one.

## 2026-08-10 — `ignore_terrain_restrictions` has two engine rules, and the code had neither

Reported as two preview bugs, one of which was not a bug and one of which was two.

### The report, and what the measurement said

**"Shore fish on Namatjira do not touch beach."** They did not, and the preview was right about the reason and wrong about everything downstream. `AK_Namatjira.rms:4865` writes its one shore-fish command as `terrain_to_place_on DLC_MANGROVESHALLOW` + `ignore_terrain_restrictions`, so the shore rule was lifted deliberately and 232 fish sat on mangrove shallow, 160 of them beside sand. The two control maps whose bug produced the shore rule in the first place were untouched: `QS_Three_Bays_v1.1` 213 of 213 touching beach, `AK_Hourglass_v2.0` 245 of 245. So the shore fix was intact and this map opted out of it.

**Then the map was run in the actual game, and it spawns no shore fish at all.**

### Rule (a): the flag is not a standalone flag

guide:2509 carries a `Requires:` line, `set_place_for_every_player` or `place_on_specific_land_id`, and the engine's answer when neither is present is not "the restrictions apply after all". The command places **nothing**. It has been in the guide the whole time, next to the sentence the code did read (guide:2510, the one that names the override).

This is the third time this file has paid for the same shape. `max_distance_to_other_zones` was inverted for months against a guide line that shouts "Minimum (NOT maximum)" in its own capitals, and `terrain_to_place_on` was lifting the terrain table on a reading nobody had tested. **A guide line that looks like documentation of an attribute is a rule, and an attribute with no test is where they hide.** All three had zero test coverage in either direction at the time they were wrong.

Corpus effect: **47 commands across 11 maps** now place nothing where they used to place objects (Chaotic Strait 16, Three Bays 12, Menindee 9, Vanguard 3, Comeer 2, and one each on five more). Namatjira's shore fish go 232 to 0, which is the number the game gives.

**Two existing tests were asserting the behaviour the engine never had**, both writing the flag standalone and expecting it to work. They were repaired rather than deleted, since their real claims (the flag lifts the table; `terrain_to_place_on` still narrows) are correct and still pinned.

### Rule (b): the shore class is exempt from what the flag lifts

Most objects really do go anywhere under it; guide:2513's own example puts SALMON on grass. Shore fish and box turtles do not. Measured in game: they keep the beach anchor and cannot leave the water, and what the flag buys them is the **shallows**.

So the flag is no longer a gate on the habitat check, it is an argument to it. `habitatMask` returns "unrestricted" for every class except `shore`, which switches to a relaxed band: anything that is not dry land, orthogonally adjacent to a beach. The beach tile itself stays excluded in both modes, because it is dry land and "not on land" is the half the flag does not touch.

**The exception lives inside the mask rather than at the call site**, and that placement is the durable part. A caller holding "if the flag is set, skip the habitat check" is one refactor away from beaching the fish again; a mask that answers "which tiles qualify, given the flag" cannot decay that way.

### The other report: `ONGRID_PLACEHOLDER_NAVAL` on land in Pag

Confirmed against `empires2_x2_p1.dat` directly rather than reasoned about: unit **1546** is `PLACEHOLDER (NAVAL)`, terrain restriction 6, 40 terrains permitted, which `derive_habitat` classes as `amphibious`. Water, shallows, beaches and ice. The preview had it on DESERT, DIRT and forest, 111 of them, each carrying a `second_object FISH_PERCH` onto dry ground.

Two independent gaps, and only one of them is coverage.

1. **`game-constants.json` has 33 object rows**, about 20 with a habitat, so anything else takes `objectHabitat`'s `land` default. That is the extraction's half.
2. **`objectEntry` matched on name only.** Pag writes `#const ONGRID_PLACEHOLDER_NAVAL 1546`, an author invented name, and **unit 1546 has no `#const` in `random_map.def` at all**, so no amount of completeness in the data file could ever resolve it by name. The id is the only handle that exists.

Measured over the 56 corpus maps: **397 distinct names reach `create_object`, 11 have a habitat row, and 216 are script `#const`s rather than DE names.** The `#const` bucket is the larger half of the gap, so id resolution is not a garnish on the extraction, it is most of the fix.

`objectEntry` now falls back to the symbol table and matches on `constId`, in `resolveTerrainId`'s order and for its reason (built-in name first, since the engine loads `random_map.def` before the script). It resolves nothing the data has no row for, which is the point of separating the halves: this closes the lookup, the extraction closes the coverage. Same lesson as the terrain resolver, one namespace late. **A rule established in one pass is not established in the passes that predate it.**

### RMS0315, and a `Requires:` field for the language data

The engine rule earns a diagnostic, so `AttributeDef` gained `requiresOneOf` and `requiresNote` (schema, TS type and one entry), and `validate()` gained RMS0315 at warning severity. One entry today; a second needs no code change. The bar for adding one is `requiresSection`'s: the guide must state the requirement AND the consequence must be known, which here means measured in game.

**The search is block-WIDE, and the scope runs opposite to the two checks it sits between.** RMS0306/RMS0307 walk direct items only, because descending into branches would false-warn on the most ordinary conditional in RMS. RMS0315 asks "is the partner anywhere at all", and a partner inside an `if` is a partner. It matches on token text rather than a resolved `def`, so an unrecognised attribute still counts as present, which is the positive-resolver rule pointed at its own consequence: this answer *suppresses* a warning. It errs toward the false negative (a partner supplied in only one branch is still a bug on the other paths) and the code says so.

**Corpus: 56 sites across 12 maps**, reported by a new permanent reporter in the RMS0200/0201/0304 family. Unlike RMS0304's expected zero this one has plenty to say, and the clearest find is `AK_Vanguard_v1.2.rms:1508-1510`: three identical `create_object STONE` lines carrying the flag with no partner, directly above four `create_object GOLD` lines of the same shape without it. The author believed the flag was doing something. All three commands place nothing, and nothing in game would ever have told them. The engine's silence is why these survive.

**Attribute to attribute references were never gated.** `validate:reference` checked command to attribute and nothing else, so a typo in `mutexWith` silently stops RMS0307 ever pairing, and a typo in `requiresOneOf` would make RMS0315 fire on every correct use of the attribute, since the partner it looks for cannot be written. Both fields are now checked, and the gate was mutation-tested by introducing the typo (exit 1, naming the field and the bad name) before restoring.

### A reporter that has never printed anything

All three existing measure files, RMS0200, RMS0201 and RMS0304, use `console.log`, and **Vitest 4 intercepts console output under this repo's config, so none of them prints a line and all of them exit 0.** That reads exactly like a check that found nothing. `--disableConsoleIntercept` is required, and it is now written into the new reporter's header and into parser-design.

### Verification

Seven mutants confirmed red one at a time and restored, with `diff` against a pre-mutation copy of `objects.ts` rather than an assumption that the restore was exact: the prerequisite gate disabled, the relaxed shore band collapsed to strict, the relaxed band admitting dry land, the id path removed, RMS0315's branch search disabled, `requiresOneOf` renamed in the data (proving the check is data-driven and not name-driven), and a typo'd partner name against the new reference gate.

`npm run typecheck`, `npm run lint` (0 errors, 14 pre-existing warnings) and `npm run validate:reference` all clean.

### The part that is NOT settled, and the run that settles it

**Namatjira cannot tell apart the two models that both predict its zero**, and this was noticed only after the gate shipped.

- **A, what is implemented.** Requirement unmet, the whole command is voided.
- **B.** The flag is merely INERT, which is what `preview-design.md:542` already says for this entire attribute family. SHORE_FISH then keeps its shore habitat (open water beside a beach), the command also says `terrain_to_place_on DLC_MANGROVESHALLOW`, a shallow is never open water, the two contradict, and zero fish place for that reason instead.

**There is corpus evidence pointing at B.** `find_closest` carries the identical `Requires:` line at guide:2649 and appears **71 times with no frame attribute** across working maps. If that line voided a command, 71 shipped commands would place nothing — and unlike a decorative fish, missing starting resources is something an author would notice. So the Requires line alone does not appear to void a command, and if `ignore_terrain_restrictions` does, it is special rather than an instance of a general rule.

The difference is not cosmetic: A empties 47 corpus commands, B leaves most of them placing normally.

`tools/scenario-probe/rmstest/RMSTEST_42_ignoreterrain_frameless.rms` is written and unrun. Three frameless commands on a half-land half-water map — a flagged SALMON, an unflagged SALMON control, and a flagged OLIVE_TREE — where A gives 30 objects, B gives 60 with the fish confined to water, and "the flag works frameless after all" gives 60 with fish on grass. **If it comes back B, revert the whole-command gate to a flag-is-inert model, re-scope RMS0315 from "this command places nothing" to "this attribute does nothing here", and strike the 47-command figure above rather than leaving it to age.**
