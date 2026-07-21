# Breakdown Editor Design (Phase 3.1, rev 4)

> **Rev 4 (2026-07, during 3.2):** §0.1/§7 re-synced to the repo — the doc had frozen a snapshot into normative text and the repo moved past it (P2 is DONE, `repeatable`×4 and `Diagnostic.suggestion` exist, §6.2 is implemented). Standing rule going forward: **§0.1's table rows carry a verified-date, and any implementer re-checks a row before acting on it** — a check script (`scripts/check-breakdown-prereqs.mjs`, grep-based) is the preferred refresh mechanism over hand-verified prose counts. Two substantive gaps closed: the quick-fix now goes through the intent pipeline (`applySuggestion`), and placeholder tokens are pinned. Appendices C/D are historical records — do not treat their repo-state claims as current.

Spec for the Breakdown editor in `src/breakdown/` — the MVP centerpiece. It is a beginner-friendly, block-based **view over the RMS code**, not a separate model: it renders from the parser's AST, and every user action becomes a **minimal text edit** applied to the source, after which a re-parse re-renders the view. Code text is the single source of truth, always.

This spec depends entirely on `docs/parser-design.md` (the parser is done: lexer 2.2, parser core 2.3, live diagnostics 2.4, resource totals 2.5) and on `reference/data/language.json` + `reference/data/game-constants.json`. **Read those first.** Where this spec says "the parser guarantees X", X is a property proven by the parser's §12 corpus gates — the patch engine (3.3) is built directly on top of them.

**Implementation sessions (3.2 read-only → 3.3 patch engine → 3.4 editable): do not deviate from this spec — if something here seems wrong or ambiguous, stop and escalate rather than improvising.** 3.3 is explicitly the hardest code in the project; its property test (§4.8) is the contract that keeps Breakdown trustworthy forever.

**Rev 3** folds in a second critique (changelog: Appendix D). The three majors: §3.3's unknown-name model now matches the AST the parser actually produces (bare unknown names are `RawNode`s, not def-less cards — the editable-card promise only ever held for block-attached unknowns); §10's duplicate-attribute specimens were both gitignored (the committed corpus is 13 files — specimens replaced with the committed `AD4 - Pag - v1.2.rms`); §4.8 clause 4 no longer fails legitimate deletes of comment-containing constructs.

**Rev 2** folds in a full critique of rev 1 (changelog: Appendix C). Two clusters were fixed. (a) **Reference-data prerequisites rev 1 assumed were satisfied and are not**: `repeatable`, `maxRepeats`, `nonFunctional`, `predefinedLabels`, `sectionLabels` have **zero** occurrences in `language.json` today; the `#ifdef` family that parser-design §13 ordered removed is **still present**; argument `default` coverage is **34 of 132 (25.8%)**, not the near-complete coverage §0.3 implied. These are now split into blocking vs graceful-degradation (§0.1, §7), and the UI is specified to stay correct under incomplete data rather than assuming the flags exist (§3.3). (b) **Under-specification concentrated in §4.1/§4.5/§4.8** — the hardest code in the project: the §4.8 gate property is now formally defined and its comparator scoped as new work, `InsertTarget`'s branch variant is made resolvable, optional `condition`/`chance` are handled, `computeEdit`'s return is pinned, and the `string`-argument overload is fixed.

## 0. Decisions locked with Ash before writing this spec

Three forks were put to Ash (map author, knows community conventions) up front; all three took the more ambitious branch, so the whole spec is designed around them:

1. **Control flow is fully editable (§3.5).** `if`/`elseif`/`else` and `start_random`/`percent_chance` blocks render as editable nested branch groups — you can edit values, add/delete commands, and add/remove branches inside them, not just view them. This is the largest single driver of patch-engine complexity; §4 treats conditional-internal edits as first-class, not bolted on.
2. **Insert formatting matches the surrounding style (§4.3).** Code that Breakdown generates infers the local layout (indent unit, one-item-per-line vs inline) from its neighbours and matches it, so inserts look native in a hand-written map. Not a fixed house style, not minimal wedging.
3. **All supported attributes are shown, present ones filled (§3.3).** A command block lists every attribute the command supports (from `language.json`); present attributes show their value and a delete control, absent ones show a faint add-affordance. More discoverable than "only what's written", at the cost of a busier block and a firm rule (§3.3) that an absent-attribute row is *not* the same as one whose value is empty.
   - **Honest caveat (rev 2):** rev 1 sold this as "absent rows show a faint add-affordance **with the default**". Only **34 of 130 arguments (rev-4 recount)** carry a `default` in `language.json` today, so as things stand roughly three in four absent rows would show no default and open onto a placeholder the user must fill — a wall of empty rows for exactly the beginner this decision targets. Either raise `default` coverage first (§0.1 P3) or accept that the absent row's value is "empty, click to add" for most attributes. Do not describe the feature to Ash or in docs as default-populated until the data supports it.

## 0.1 Reference-data prerequisites (rev 2 — read before starting 3.2)

Rev 1 wrote §7 as if these were live data to be "confirmed". They are not present at all. Verified counts in `reference/data/language.json` as of this revision:

| Field | Occurrences | Status |
|---|---|---|
| `repeatable` | **4** — `replace_terrain`, `terrain_cost`, `terrain_size`, `spacing_to_specific_terrain` (rev 4 verified) | **DONE** — ground-truth rule still governs rendering; flag governs "add another" |
| `maxRepeats` | 0 | fine (parser §8 withdrew the only proposed cap) |
| `nonFunctional` | **2** — `#undefine`/`#include` (rev 4) | **DONE** — §3.6's badge now renders |
| `predefinedLabels` | 0 (rev 4) | degrades gracefully (§3.4) |
| `sectionLabels` | **created** (`sectionLabels.ts`, rev 4) | DONE |
| `#ifdef` family in `directives[]` | **removed** (rev 4) | **DONE** — 3.2's hardcode-suppress mandate is dead; delete it if written |
| argument `default` | 34 / 130 (rev 4 recount) | shapes §0.3's honesty, not correctness |
| `validate()` (parser-design §8) | not built (rev 4 re-verified) | graceful — two §3.x notes depend on it, see below |
| `Diagnostic.suggestion` | **exists** (`types.ts:43`, populated by `unknownName()`; rev 4) | DONE — §3.3's quick-fix prerequisite satisfied |

**Rev-4 repeatable reconciliation:** the doc previously listed "replace_terrain, terrain_cost, spacing_to_specific_terrain and the connection radii". The data pass flagged the first three **plus `terrain_size`** and no radius attribute — and the data is right: parser §8's "connection radius attributes" was imprecise; `terrain_size` (per-terrain width/spacing along the connection path) is the repeating one, actual radius attributes set widths once. Parser-design §8's phrasing should be corrected when next touched.

**validate() dependency (rev 3).** Two specified UI behaviors source their text from `validate()` diagnostics, which don't exist yet: §3.3's "the engine uses the last one" note on non-repeatable duplicate attributes, and §3.2's cross-section placement warning in the picker. Under §5's own rule (diagnostics are the parser's, unmodified — Breakdown invents no validation), **neither note renders until validate() ships**; the UI simply omits them, losing polish, not correctness. When a validate() session lands (parser-design §8 — it was left as its own Sonnet session after 2.5), the notes light up with no Breakdown change beyond consuming the extra diagnostics array.

**P1 — `repeatable` (before 3.2, but the UI must not depend on it).** `replace_terrain`, `terrain_cost`, `spacing_to_specific_terrain` and the connection radii are cumulative per parser §8, and none is flagged. Real corpus exposure — **committed-corpus specimen (rev 3): `AD4 - Pag - v1.2.rms`**, which has 5 consecutive `replace_terrain`s in one block (lines 686–690), repeated `terrain_cost`s throughout its connection blocks, and a commented-out `replace_terrain` inside a block (line 734). (`Rage Forest 2026.rms` — 35 `replace_terrain`s — and `24hr_Bazi is God.rms` — 3 consecutive — are stronger specimens but are **gitignored**, usable only opportunistically per §10.) Under rev 1's text these fell into a case the spec never defined — not flagged repeatable, yet multiple `AttributeNode`s genuinely present — and the natural implementation binds the single row to the first and silently orphans the rest: invisible in Breakdown, and one edit away from the exact collapse parser §8 exists to prevent. **Fixed by the ground-truth rule in §3.3: duplicate present instances always render as a list, flag or no flag.** Populate the flags too (it governs whether "add another" is offered), but the UI is now safe either way — which is what goal #4 ("unverified data must degrade safely") actually demands.

**P2 — DONE (rev 4: flags live, family removed — the paragraph below is historical; the 3.2 hardcode-suppress mandate is void).** ~~`nonFunctional` + remove the `#ifdef` family (blocking for 3.2).~~ parser-design §13 item 2 ordered the `#ifdef`/`#ifndef`/`#else`/`#endif` entries deleted (they do not exist in DE — not in the guide, not in the exe string dump) and `#undefine`/`#include` flagged non-functional. Neither has been done. Consequence if 3.2 ships first: the §3.2 command/directive picker and the Header tab will offer beginners **`#ifdef` as a legitimate insertable directive**, and §3.6's "has no effect in DE" badge will never render because the flag driving it doesn't exist — so `#undefine`/`#include` are offered as though they work. For a beginner-first tool that is an active harm path, not a polish gap. **Do P2 before the picker ships.** Until then, 3.2 must hardcode-suppress the four `#ifdef`-family names from any picker.

**P3 — argument `default` coverage (not blocking; changes the pitch, not the code).** See §0.3's caveat. Raising coverage is a `language.json` population pass (Sonnet, same shape as the parser §13 cleanup, sourced from the archived guide). Absent-row behavior is well-defined either way (§3.3).

**Everything else degrades gracefully** and is not a prerequisite: `predefinedLabels` absent → the condition/`otherConstant` comboboxes offer symbol-table names + free text only (§3.4); `sectionLabels` absent → create it in 3.2, it's a seven-entry constant; `game-constants.json` placeholders → comboboxes and the reference table show names with "—" for IDs/textures (§3.8).

## 1. Goals and non-goals

Goals, in priority order:

1. **Code is the only source of truth.** Breakdown never holds a parallel model of the map. It holds (a) the source string, (b) the current `ParseResult`, and (c) ephemeral UI state (which blocks are expanded, which field is focused). Every edit is a `TextEdit` against the source; the AST is always re-derived, never mutated in place. This is the property that makes Breakdown and the Code tab impossible to desync by construction.
2. **Round-trip fidelity.** A Breakdown edit changes exactly the bytes it intends to and nothing else — untouched commands, attributes, comments, blank lines, and formatting survive byte-for-byte. Guaranteed by building edits from the parser's exact token spans and never re-printing code (§4, mirrors parser goal #2).
3. **Total coverage in the UI.** Every AST item is reachable somewhere in Breakdown — including preamble directives, unknown sections, unparseable `RawNode`s, and conditional-split `OrphanBlockNode`s. Nothing in the file is invisible in Breakdown, just as the parser's coverage gate makes every token owned by exactly one node. Regions Breakdown can't edit safely degrade to a **read-only raw card**, never vanish (mirrors CLAUDE.md's "never crash or silently drop content" convention).
4. **Data-driven.** Which sections exist, which commands belong to which section, which attributes a command supports, argument types/ranges/defaults, repeatability, flags — all come from `language.json`. Breakdown hardcodes no RMS vocabulary. Constant dropdowns come from `game-constants.json`. Unverified (`"verified": false`) data must degrade safely (§3.4, §4.9), never block editing.
5. **Honest about parse errors.** The parser never throws, so Breakdown is *always* available and always renders the whole document. Broken regions are read-only raw islands with the parser's own diagnostic shown; clean regions around them stay fully editable (§5).
6. **Beginner-first.** The whole reason Breakdown exists is to let someone who can't yet write RMS assemble a working map by picking commands and filling fields. Every control has a `HelpTip` (§8); every value editor is typed to its argument (number field, constant dropdown, flag checkbox) so a beginner can't easily produce a malformed token.

Non-goals for v1: reformatting/pretty-printing existing code (that's a future Advanced Tool, PLAN.md §5.2b — Breakdown preserves formatting, it does not normalize it); reordering existing commands by drag (deferred, §11); a visual editor for math expressions (`{ expr }` args render as a read-only expression pill with a "edit in Code" affordance, §3.4); editing *inside* a `RawNode`/degraded region in Breakdown (Code tab only, §5); resolving `#include` contents (parser records includes; Breakdown shows unknown-symbol dropdowns un-filtered when includes are present, §3.4).

## 2. The core loop

```
        ┌──────────────────────────────────────────────────────┐
        │  source: string   (the single source of truth)        │
        └──────────────────────────────────────────────────────┘
              │ parseRms(source, lang)                ▲
              ▼                                        │ apply TextEdit
        ┌───────────────┐   render     ┌───────────────────────┐
        │  ParseResult  │ ───────────▶ │  Breakdown UI (React)  │
        │  (AST + diag) │              │  blocks, rows, cards   │
        └───────────────┘              └───────────────────────┘
                                             │ user action
                                             ▼
                                       ┌───────────────────┐
                                       │  EditIntent        │
                                       │  (§4.1)            │
                                       └───────────────────┘
                                             │ computeEdit(result, intent, lang)
                                             ▼
                                       ┌───────────────────┐
                                       │  TextEdit          │──┐
                                       └───────────────────┘  │ applied to source,
                                                               └▶ re-parse, re-render
```

Every arrow is pure and one-directional. The UI is a function of the `ParseResult`; a user action is turned into an `EditIntent` (a description of *what* changed, in AST terms), the patch engine turns that into a `TextEdit` (a description of *which bytes* change), the edit is applied to the source, and the source is re-parsed. There is no path by which the UI mutates the AST or the source directly. This is unidirectional data flow at the scale of a whole document (Phase 3's stated learning objective).

**Rendering is stateless w.r.t. edits.** Because the view is recomputed from the AST after every edit, there is no reconciliation of "the block I was editing" — the block simply re-renders from its new AST node. The only thing that must survive a re-parse is *ephemeral UI state* (expansion, focus, selection), and that is anchored to source offsets, not node identity (§6.3).

## 3. AST → Breakdown UI mapping

The parser's AST (`docs/parser-design.md` §4, `src/parser/types.ts`) is the input. This section maps every node kind to a UI element. The guiding rule: **the mapping is total** — every `Item`, in every position, has a rendering; there is no node the UI silently omits.

### 3.1 Sections → sub-tabs

`ScriptNode` has `preamble: Item[]` (before the first `<SECTION>`) and `sections: SectionNode[]`. The Breakdown pane has a row of **section sub-tabs** (per the mockup: Player Setup / Land / Elevation / Cliff / Terrain Connection / Objects). The tab set is **data-driven from `language.json`'s `sections[]`**, in that fixed canonical order, with human-readable labels from a new `sectionLabels` map (§9 action item). The canonical seven (confirmed in `language.json`): `PLAYER_SETUP`→"Player Setup", `LAND_GENERATION`→"Land", `ELEVATION_GENERATION`→"Elevation", `CLIFF_GENERATION`→"Cliff", `TERRAIN_GENERATION`→"Terrain", `CONNECTION_GENERATION`→"Terrain Connection", `OBJECTS_GENERATION`→"Objects". (The mockup drew six tabs and conflated Terrain/Connection; the data has seven and the tab bar follows the data — do not hardcode the mockup's six.)

Three cases beyond the canonical seven, each with a defined home so coverage holds:

- **Preamble** (`ScriptNode.preamble`): a leading **"Header"** sub-tab, shown whenever `preamble` is non-empty. Holds the `#define`/`#const`/`#include_drs`/`#includeXS` directives and any stray pre-section items. This is where a map's global constants live; beginners need it, and it is the natural home for the "define a constant" affordance. (Directives that appear *inside* a section render inline where they sit — only the preamble gets its own tab.)
- **Unknown sections** (`SectionNode.known === false`, `RMS0100`): rendered as an extra tab **after** the canonical seven, labelled with the raw section name and a warning badge carrying the `RMS0100` message. Its items still render as normal blocks (editable), so a typo'd `<LAND_GENERATON>` is visible and fixable rather than hidden.
- **Duplicate same-type sections** (legal per parser §4 — the engine merges them): the tab for a section type **aggregates the items of every section of that type**, in source order, with a thin divider labelled "(second `<LAND_GENERATION>` block)" between them. Each block retains provenance (a pointer to its concrete `SectionNode`, hence its source range) so edits and inserts target the right physical section. **Add-command defaults to the last section of that type** (append there). This keeps the common single-section case clean while never losing or corrupting a duplicate.

**The section row also carries the "Hide Unused" switch (§3.3.1)** — a single boolean toggle, right-aligned in the sub-tab row, that hides every attribute row not actually present in the source. It is a view-level control (applies to all cards in the pane), not per-card.

A tab shows a **count badge** (number of top-level items) and a **problem badge**. The problem badge is the max diagnostic severity over **the union of the spans of every `SectionNode` the tab aggregates** — not "its span", since an aggregating tab (duplicate same-type sections) covers multiple **disjoint** source ranges with unrelated code in between. Compute it by testing each diagnostic's span for containment in any of the tab's section ranges; never by taking min/max offsets across them. **The Header tab (rev 3):** same containment rule over the union of the **preamble items'** spans (the preamble has no `SectionNode`; its items' spans are the ranges).

### 3.2 The block list

Within a section tab, each top-level `Item` renders as a **card** in source order (the mockup's stacked rounded rows). Card type by node kind:

| Node kind | Card |
|---|---|
| `CommandNode` | **Command card** (§3.3) — the main workhorse |
| `AttributeNode` at statement level | Command card styled as a stray attribute + `RMS0207` badge ("belongs inside a `{ }` block") |
| `DirectiveNode` | **Directive card** (§3.6) — `#define NAME value`, `#const`, `#include_drs` |
| `IfNode` | **Conditional card** (§3.5) |
| `RandomNode` | **Random card** (§3.5) |
| `OrphanBlockNode` | **Shared-block card** (§3.5) — read-only in v1, with its `RMS0110`/`RMS0102` note |
| `RawNode` | **Raw card** (§3.7) — read-only verbatim source + the degradation diagnostic |

The section header row — Add button, count/problem badges, and the §3.3.1 "Hide Unused" switch — is **sticky at the top of the scroll container** (`position: sticky; top: 0`), so Add stays reachable in a long section instead of scrolling away. Purely presentational; no state involved. Give it an opaque background and a z-index above the cards so they scroll cleanly underneath.

Top of the list: an **"Add"** button (per mockup) opening a **command picker** — a searchable list of every command whose `def.section` equals this tab's section (from `language.json`), each entry showing name + one-line description + a "verified/unverified" chip. Picking one inserts a new command (§4.5). The picker is filtered by section by default with a "show all sections" toggle (a beginner in the Objects tab almost always wants an Objects command, and nothing in RMS forbids cross-section placement — the wrong-section warning comes from validate(), which is **not built yet** (§0.1); until it ships, cross-section placement draws no diagnostic at all).

### 3.3 Command cards and the all-attributes model

A **command card** has a collapsed and an expanded state (mockup: `+`/`−` toggle, trash to delete).

- **Collapsed:** one-line summary — command name + its positional arguments + a faded preview of the first few set attributes (`create_terrain FOREST · land_percent 8 · number_of_clumps 12 …`). This is generated from the AST node, read-only in collapsed form.
- **Expanded:** the editable body, in three stacked groups:

**(a) Positional arguments.** From `def.arguments[]` (e.g. `create_terrain`'s single `terrain: terrainConstant`). One typed value editor per argument (§3.4), labelled with the argument `name`. Optional/variadic args (schema flags, honored if present) render with an add/remove affordance for the trailing ones.

**(b) Attributes — the all-supported list (Ash's Q3 decision).** For a `CommandNode` with a resolved block-kind `def`, gather `def.attributes[]` (the names of attributes this command supports) and render **one row per supported attribute, in `def.attributes[]` order** (a stable, discoverable order — *not* source order; see the note below). For each supported attribute:

- **Present exactly once** (one `AttributeNode` for that name in `node.block.items`): a filled, editable row — attribute label + typed value editor(s) bound to the `AttributeNode`'s arg spans + a delete (−) control. Editing the value is a set-value edit (§4.4); deleting removes the attribute (§4.6).
- **Present more than once — the ground-truth rule (rev 2, load-bearing):** if **two or more** `AttributeNode`s share a name in one block, the slot renders as a **list of all present instances**, each individually editable and deletable — **regardless of whether `AttributeDef.repeatable` is set**. Presence in the source is ground truth; the flag is only a *hint about intent*, and it governs one thing: whether an **"add another"** affordance is offered (offered when `repeatable === true`; withheld otherwise, since duplicating a non-cumulative attribute is usually a mistake — parser §8's "the engine uses the last one" note surfaces on the row *once validate() exists*; until then the list renders with no note, per §0.1's validate() row).
  - **Why this rule exists.** `repeatable` has **zero occurrences** in `language.json` today (§0.1 P1) while cumulative attributes are heavily used in the wild — `Rage Forest 2026.rms` has 35 `replace_terrain`s, `24hr_Bazi is God.rms` has 3 consecutive in one block. Keying the list UI off the flag (rev 1's rule) would bind the single row to the first instance and silently orphan the rest: invisible in Breakdown, violating total coverage (goal #3), and one edit away from the exact collapse parser §8 forbids. Deriving the list from the AST instead makes the UI correct **before** the data is fixed, and correct **after** — which is what goal #4 requires of unverified data. Never render a name with multiple present instances as a single overwrite field.
  - `maxRepeats` is honored if present (disables "add another" at the cap). Note parser §8 withdrew the unsourced `maxRepeats: 4` on `spacing_to_specific_terrain`, and there are zero `maxRepeats` in the data, so in practice no cap applies today.
- **Absent:** a **faint "add" row** — attribute label greyed, with a `+`/"add" affordance. If the attribute's *first* `ArgumentDef` carries a `default`, show it as placeholder text and use it as the inserted value; otherwise the row shows "click to add" and the insert opens focused on an empty placeholder the user fills (§4.5's rendering rule). Only 34/132 arguments have a `default` today (§0.1 P3), so the no-default path is the common one — build it first, not as an afterthought. **Firm rule:** a faint absent row is visually and behaviorally distinct from a present row whose value happens to be empty — the absent row corresponds to **no bytes in the source**; only when the user acts on it does an attribute get inserted. (This is the one place the "all attributes" model risks lying about what's in the file; the faint styling + no delete control is how we keep it honest.)
  - *Note on where `default` lives:* it is a field of **`ArgumentDef`**, not `AttributeDef` — read it from `attributeDef.arguments[0].default`, per-argument for multi-argument attributes. (Rev 1's §3.3 said "`def.default`", which does not exist on `AttributeDef`.)
- **Flag** (`AttributeDef` with no `arguments`, or a lone `flag`-typed arg used bare — e.g. `set_flat_terrain_only`, `set_scale_by_size`; the mockup's checkboxes): rendered as a **checkbox** whose checked state = presence in the source. Toggling adds/removes the bare attribute token (§4.6). Flags always appear (checkbox reflects presence), which is exactly the all-attributes model. **Duplicate flags (rev 3): the ground-truth rule wins.** A bare flag present 2+ times renders as the list of instances (each deletable), not a checkbox — a checkbox cannot represent "present twice", and collapsing would hide bytes. The checkbox form applies only at 0 or 1 present instances.

**(c) Non-standard block contents — rewritten rev 3 to match the AST the parser actually produces.** A block may legally contain items beyond the def's `attributes[]` list. What the parser emits for each case (verified against `parser.ts`):

- **Known-but-unlisted attributes** (in the global attribute map, but not in this command's `def.attributes[]`): the parser resolves in-block names against the **global** attribute map with no membership check — such a node arrives as a normal `AttributeNode` with a **fully resolved `AttributeDef` and no diagnostic at all**. Render it as a **normal typed row** (full value editors) in the "Other contents" group, in source order, **with no badge** — rendering it generic would throw away real typed-editor data, and a badge would be Breakdown-invented validation, which §5 forbids. (If a future validate() adds a listed-membership check, its diagnostic surfaces then; not before.)
- **Genuinely unknown attribute names never become `AttributeNode`s.** A bare unknown word in a block becomes a `RawNode` (reason `"unknown-run"`) carrying the `RMS0200` diagnostic (with did-you-mean). It renders as a **raw card** (§3.7) in the Other contents group — with the quick-fix affordance below when the diagnostic carries a suggestion.
- **Non-attribute items** (nested `IfNode`/`RandomNode`, `DirectiveNode`, wrong-context `CommandNode` with its parser-emitted `RMS0207`, `RawNode`): render in source order as their §3.2 card types — conditionals as full editable cards (§3.5), raw as raw cards.

This group is how coverage-in-UI is preserved for blocks whose reference data is incomplete (many `create_connect_*` / objects commands are still `"verified": false`).

**Display-order vs source-order (pinned).** Known attributes render in `def.attributes[]` order for discoverability; the source may have them in a different order. This is deliberate and safe: **Breakdown never reorders the code** — display order and code order are allowed to differ, and every edit targets the actual node span regardless of where the row sits in the display. Newly-added attributes are appended to the **end of the block** in the source (before `}`), even though their display row may sort earlier. (Consequence to verify with beta users, §10: whether the display/source order gap ever confuses. Attribute order is not engine-significant for the common cases; if a specific attribute turns out to be order-sensitive, it can be pinned to source-order rendering per-attribute later.)

**Unknown names — the honest boundary (rewritten rev 3; rev 2's model didn't match the parser).** A def-less `CommandNode` exists on exactly **one** parser path: an unknown word immediately followed by `{` (the unknown-run upgrade, parser §5.4). Everything else unknown — including the archetypal bare typo (`elavation`, the real OWWC specimen) — becomes a `RawNode` with reason `"unknown-run"`. So:

- **Block-attached unknown command** (`CommandNode`, `def === undefined`): the editable card renders — name editable with the did-you-mean quick-fix, positional args as generic value rows, block contents as Other-contents rows (all generic; no def to drive an attribute list). Editable, never dropped.
- **Bare unknown name** (`RawNode`, `RMS0200`): renders as a **raw card** (§3.7) — read-only verbatim, *plus* the **did-you-mean quick-fix (new specified work, 3.4)**: when a diagnostic contained in the card's span carries a suggestion, the card shows "Did you mean `create_land`? [Fix]" — clicking constructs an **`applySuggestion` intent** (§4.1, rev 4 — the quick-fix previously bypassed the intent pipeline, making a specified feature unreachable through the specified architecture and invisible to the §4.8 gate) targeting the run's *first* token; the re-parse usually promotes the region to a structured card. This is the common typo path and the whole reason did-you-mean exists. The structured `Diagnostic.suggestion` field this needs **exists** (`types.ts:43`, populated by `unknownName()` — rev 4; it was specced as a prerequisite and has since been built).

#### 3.3.1 "Hide Unused" switch (Ash, added post-rev-2)

A boolean toggle labelled **"Hide Unused"**, living in the section sub-tab row (§3.1) and applying to every command card in the pane.

**What it hides — pinned precisely, because the line matters:** when on, the block hides every attribute row that **corresponds to no bytes in the source** — i.e. exactly the faint absent rows of §3.3, including unchecked flag checkboxes (an unchecked flag *is* an absent attribute). When off (default), the full all-supported-attributes list renders as specified in §3.3.

**What it must never hide**, since these are real content and hiding them would violate total coverage (goal #3):

- Any **present** attribute — including one that is present but *valueless*, e.g. `land_percent` written with no argument (`RMS0201` too-few-arguments). "No value" is not the test; **"no bytes in the source" is the test.** A present-but-empty attribute stays visible, carrying its diagnostic, because it is really in the file and the user must be able to see and fix it.
- The **"Other contents"** group (§3.3(c)) — unknown/undocumented attributes, nested conditionals, raw regions. All real bytes, always shown.
- Positional arguments (§3.3(a)), which are part of the command itself.

**Affordance.** A card with rows hidden shows a quiet count ("12 unused hidden") so the user knows the list is filtered and can toggle back — a filtered view must never look like a complete one.

**Default and persistence.** Default **off**, persisted via the Tauri store alongside the other settings (`settings.json`, same pattern as `helpMode`/generation settings — §6.5). Off-by-default preserves the discoverability that motivated the all-attributes decision (§0.3); the switch is the escape valve for the busy-block cost that decision knowingly accepted.

**Why this earns its place.** It directly mitigates the §0.3 honest caveat: with `default` on only 34/132 arguments (25.8%), most absent rows currently render empty, so an experienced author editing a dense `create_terrain` block faces a wall of blank rows between the attributes they actually use. "Hide Unused" collapses that to just the live content, while a beginner keeps the full palette by default. If beta feedback shows most users flip it on immediately, that is the signal to reconsider the §0.3 default rather than to change this control.

### 3.4 Value editors by argument type

Driven by `ArgumentDef.type` (`src/parser/language.ts`):

| Type | Editor | Notes |
|---|---|---|
| `integer` | number input | `min`/`max` from def as **soft** validation (out-of-range shows the `RMS0203` message inline but is *allowed* — code is source of truth); `cautionBelow`/`cautionMessage` shown as a `RMS0217` inline caution (e.g. negative borders). |
| `percent` | number input, 0–100 soft | same soft-validation model |
| `flag` | checkbox or number | bare flag → checkbox; valued flag → number input |
| `terrainConstant` | **searchable combobox** from `game-constants.json` terrains + free text | free text required: bare numeric IDs and `#define`d constants are legal RMS (parser §2.1). Descriptive name + ID shown in the dropdown when `game-constants.json` has them (placeholders today — §9). |
| `objectConstant` | searchable combobox from object constants + free text | same |
| `otherConstant` | combobox from symbol table + `predefinedLabels` + free text | includes the map's own `#define`/`#const` names (from `ParseResult.symbols`) — this is where a beginner picks a constant they defined in the Header tab. Include-present → dropdown is advisory only, free text always accepted (parser §7). |
| `string` | text input | **Overloaded in the data — do not assume "path" (rev 2).** `type: "string"` is used for both filename slots (`#include_drs`/`#includeXS`) *and* plain name slots (`#const`'s `name`, `#define`'s `name`, `#undefine`'s). The quote round-trip below applies **only** to the filename case; applying it to `#const NAME` would emit `#const "NAME"` — broken RMS. Disambiguate by directive (§3.6), not by type. |

**Non-scalar arg values.** An `ArgNode.value` can be `{ rnd:[a,b] }`, `{ expr:{tokens} }`, or `Infinity`/`-Infinity`:
- `rnd` → a compact "rnd" editor: two number inputs (min, max) rendering `rnd(a,b)`. Common enough (corpus-wide) to be first-class.
- `expr` (math expression, parser §2.2) → a **read-only expression pill** showing the reconstructed expression text with an "edit in Code" affordance. v1 does not offer a structured expression builder (non-goal §1); it must show the expression faithfully and never corrupt it. This keeps the 45 live corpus expressions safe.
- `inf`/`-inf` → the number editor accepts the literal words `inf`/`-inf` in addition to numbers.

**Quoting round-trip (pinned).** `ArgNode` carries **no** `quoted` field — only `IncludeInfo` does. So an editor that must preserve quoting looks it up via the hop `DirectiveNode.hash` (token index) → the `IncludeInfo` in `ParseResult.includes` whose `directiveToken` equals it → its `quoted` flag. Rule: **re-add quotes on write iff that lookup says the original was quoted**, and only for `#include_drs`/`#includeXS` filename arguments. Everything else with `type: "string"` is written bare. (Cleaner long-term fix, §7 action item: add a distinct `path` argument type so this is decidable from the arg alone rather than by directive-name special-casing.)

Every editor is **uncontrolled during typing and commits on blur/Enter** (§4.11) — it does not fire a `TextEdit` per keystroke (that would reparse the whole file on every digit and fight the user's cursor). Escape reverts to the AST value. Full commit semantics are specified in §4.11.

### 3.5 Control-flow cards (fully editable — Ash's Q1 decision)

The parser produces structured `IfNode`/`RandomNode` for cleanly-nested conditionals (the common case — parser §5.1), and `OrphanBlockNode`/`RawNode` for the exotic ones (parser §5.3/§5.4). Breakdown renders the structured ones as **fully editable** nested cards.

**Conditional card (`IfNode`).** A titled container with a **segment per branch** (`if` / each `elseif` / `else`):
- Each `if`/`elseif` segment shows an editable **condition** field (the `branch.condition` token — a single token, of any non-structural kind; edited as a set-value on that token's span). Conditions are arbitrary labels (predefined game modes, user `#define`s, `TEAMx_SIZEy` — parser §5.1), so the condition editor is a combobox over `predefinedLabels` + symbol table + free text, like `otherConstant`.
  - **`condition` is optional in the AST and must be handled (rev 2).** `IfBranch.condition?: number` is `undefined` for `else` branches (expected) **and** for a malformed-but-parsed `if` with no condition (parser §5.1 emits an `RMS0106` variant, "if without a condition"). With no condition token there is **no span to replace**, so §4.4's set-value is undefined for it. Rule: an `else` branch shows no condition field at all; an `if`/`elseif` with `condition === undefined` shows an **empty** condition field carrying the `RMS0106` warning, and committing a value there is an **insert immediately after the branch's `keyword` token** (§4.4), not a replace. Same shape for `RandomBranch.chance?: ArgNode` when a `percent_chance` has no operand.
- Each segment's **items render recursively** as a nested block list (command cards, attribute rows, further nested conditionals) — the same renderer as a section body, just scoped to `branch.items`.
- **Per-segment "Add command"** inserts into that branch (§4.5, anchored before the branch's terminating keyword).
- **Branch structure controls:** "add elseif" / "add else" (insert a branch, §4.10) and delete-branch (remove a branch, §4.10). `endif` is implicit (the container boundary) — never shown as an editable token.

**Random card (`RandomNode`).** Same shape: a segment per `percent_chance` branch, each with an editable **chance** value (number/`rnd`/expression — the `percent_chance` operand, parser §5.1; `chance` is optional, handled as above) and recursively-rendered `branch.items`; add/remove branch; `start_random`/`end_random` implicit. `RandomNode.preamble` (items before the first `percent_chance`, `RMS0106`) renders in a leading "before first percent_chance" strip with the warning, still editable.

**Why fully-editable falls out of the span model.** Editing inside a branch is not a special case for the patch engine: every node — including one nested three conditionals deep — has exact `firstToken`/`lastToken`/`span`, and the parser guarantees the tree is well-nested (children within parents, siblings disjoint). So "set this value" or "delete this command" is the *same* span-based edit whether the node is top-level or inside a branch. The genuinely new work fully-editable conditionals add is confined to **insert-anchor computation** (where in the source does a new item go within a branch — §4.5) and **branch add/remove** (§4.10); those are the two sections to get right, and both are bounded by the branch's delimiting keyword tokens, which the AST already identifies.

**Nested/exotic conditionals stay read-only.** An `OrphanBlockNode` (shared-block idiom, parser §5.4) and any conditional that degraded to a `RawNode` (parser §5.3 — interleaves with block/section structure, or nesting-depth cap) render as **read-only cards** (§3.7) with their `RMS0110`/`RMS0102` note and an "edit in Code" affordance. Rationale: those are exactly the cases where the grammar-shaped AST is only an approximation of the token-filter reality, so a structured editor could not compute a safe patch. This is the honest boundary of fully-editable — structured where the parser is structured, raw where the parser degraded.

### 3.6 Directive cards

`DirectiveNode` → a compact card: the directive name (`#define`/`#const`/`#include_drs`/`#includeXS`) + its args as typed editors (`#define NAME`, `#const NAME value`, `#include_drs "path"`). In the Header tab this is the "define a constant" surface. Non-functional directives (`#undefine`/`#include`, `nonFunctional` flag, parser §7) render with an info badge ("has no effect in DE"). Unknown directives (`RMS0206`) render generically with the warning. A `#const` whose value is an `expr` shows the read-only expression pill (§3.4).

### 3.7 Raw cards

`RawNode` (and read-only `OrphanBlockNode`) → a **read-only card** showing the exact source slice (`source.slice(span.start, span.end)`) in a monospace box, with the node's diagnostic (`RMS0110` "valid RMS, shown as raw code", or whatever degraded it) and an **"Edit in Code tab"** button that switches tabs and moves the cursor to `span.start`. This is the universal fallback that makes coverage total: anything the structured UI can't represent is shown verbatim and read-only, never dropped, never crashing (PLAN.md's raw-block requirement). Raw cards are the only cards with no Breakdown-side editing.

### 3.8 The reference side panel and preview placeholder

Per the mockup, the Breakdown pane has a **left panel**:
- **Map preview area** with a "View: Current ● / Final ○" toggle and the diamond canvas. In Phase 3 this is a **labelled placeholder** ("Approximate preview — arrives in Phase 4"), reserving the layout. The toggle and canvas are wired in Phase 4 (M4). Do not build preview logic here.
- **Reference table** (in 3.2's scope) with a "Terrain ○ / Objects ● / Commands ○" radio and a table:
  - *Terrain* / *Objects*: columns Const. ID# / RMS Constant / Descriptive Name / DE Texture File, rows from `game-constants.json` (filtered to terrains / objects). **Today most columns are placeholders** (`constId`/`deTextureFile` are `null` pending the Phase 4.0 extraction script) — render what exists, show "—" for nulls, and mark the panel "IDs/textures pending extraction" so it isn't mistaken for real data.
  - *Commands*: columns Command / Section / Description, rows from `language.json` `commands[]`, with the verified chip.
  - The table is a **read-only reference/lookup aid** (double-clicking a terrain could later insert its constant into the focused editor — a nice-to-have, not required for 3.2). Every row and the radio get `HelpTip`s.

### 3.9 Card selection and insert-after (Ash, post-3.4)

**One card in the pane may be *selected*.** Selection is a first-class, visible state — distinct from expansion (a card can be selected while collapsed, and expanded while unselected) and from focus (which lives on an individual editor inside a card).

- **Affordance:** the selected card carries a visible marker (left accent bar + subtle background). It must be legible at a glance while scrolling — this is what makes "insert after *here*" predictable rather than guesswork.
- **Selecting:** click anywhere on a card's chrome (header, summary line, or its background) selects it. Clicking a value editor inside a card **also** selects that card — you are self-evidently working there, and it would be surprising for Add to then insert somewhere else. Clicking the pane background clears selection.
- **Single-select** in v1. Multi-select only earns its place alongside bulk operations, which don't exist (§11).
- **Scope:** selection is per-pane, not per-tab. Switching section tabs **clears** it, because the selected card is no longer on screen and an off-screen insert anchor is exactly the surprise this feature exists to remove.
- **Nested cards are selectable.** A command inside an `if` branch can be selected, and Add then inserts *into that branch*, after that command — which falls out of the anchor rule below with no special case.
- **State model:** ephemeral, **offset-anchored exactly like expansion** (§6.3) — a single `selectedAnchor: number | null`. It must obey §6.3's ordering rule (shift anchors only when the matching parse arrives, see BUG-001 in `docs/known-issues.md`), or selection will visibly jump to a neighbouring card for one frame after every edit, the same defect expansion had. **An anchor inside a deleted range is dropped** (rev 4's rule): deleting the selected card clears selection rather than silently re-pointing it at whatever slid into those offsets.

**Add Command inserts after the selected card.** §3.2's Add button resolves its `InsertTarget` as:

1. A card is selected in the active tab → `{ after: <that Item> }` — the new command lands immediately below it, at that card's own nesting depth and indentation (§4.3 infers style from the anchor item's surroundings, so a branch-nested insert indents correctly for free).
2. Nothing selected → `{ in: "section", section }`, i.e. append at the end of the section, the pre-existing behavior.

This is the reason `{ after: Item }` returns to `InsertTarget` (§4.1). It was dropped in rev 3 as *consumer-less* — the variant existed with no UI able to construct it and no test covering it — with the explicit note that it would be reintroduced "alongside its consumer". Selection **is** that consumer. Note the anchor is the `Item`, not the selection offset: resolve the offset to its owning top-level-in-container item **once**, at click time, so a deep click (on an attribute row inside a block) still inserts a sibling command after the whole command, never inside its block.

### 3.10 Diagnostics overview ruler (Ash, post-3.4 — hardest of the three, sequence last)

A thin vertical track down the right edge of the section's scroll container, showing where the problems are — the Breakdown analogue of Monaco's overview ruler. Completes the badge hierarchy: tab-level (§3.1) → **ruler (where in this section)** → card-level.

**The mapping problem, stated up front, because it is the whole difficulty.** Monaco's ruler is easy: a document is N lines of uniform height, so `offset → y` is a linear function computed without touching the DOM. Breakdown has no such luxury — cards are **variable-height**, and that height **changes at runtime** (expand/collapse, the §3.3.1 Hide Unused toggle, repeatable-attribute lists growing). So the ruler cannot be computed from source offsets. It must map over **rendered layout**:

- Tick position = `card.offsetTop / scrollContainer.scrollHeight`, measured from the DOM after layout.
- Recompute on anything that changes layout: expand/collapse, Hide Unused, a reparse that changes the card list, and container resize. A `ResizeObserver` on the scroll container plus a recompute keyed on `parseResult` and the expansion set covers all of it.
- Measure in a layout effect and keep the measurements in state; do **not** measure during render.

**Scope for v1:**

- One tick per card carrying at least one diagnostic, coloured by that card's **max severity** (error > warning > info) — the same severity rollup §3.1's badge uses.
- Ticks are **clickable**: scroll that card into view and select it (§3.9).
- Ticks for cards inside collapsed containers still appear, positioned at the collapsed container's tick — the problem is genuinely "in there", and hiding it would make the ruler lie about the section's state.
- **Not** in v1: density/heatmap rendering, a card minimap, or ticks for anything other than diagnostics.

**Cost note.** This is the most expensive of the three post-3.4 items and the only one requiring DOM measurement, which is otherwise absent from Breakdown (everything else is a pure function of the AST). Do it after §3.9 and the sticky header, and keep the measurement isolated in one hook so the rest of the pane stays measurement-free and testable.

## 4. The text-patch engine

The heart of Phase 3 (implemented in 3.3, the project's hardest code). It converts an `EditIntent` (AST-level description of a change) into a `TextEdit` (byte-level change), preserving everything else exactly.

### 4.1 Edit intents

```ts
// A byte-level change: replace source[start, end) with newText. start === end is an insertion.
interface TextEdit { start: number; end: number; newText: string }

// A branch is NOT independently addressable in the AST (rev 2 — see the note below):
// IfBranch/RandomBranch are plain interfaces with no span, no parent pointer, no index.
// Every branch-targeted intent therefore carries parent + index.
interface BranchRef { parent: IfNode | RandomNode; index: number }

// Where a new attribute/flag goes (rev 3): BlockNode when the command has a
// block; CommandNode when it has NONE — §4.6's brace-synthesis case applies
// exactly when no BlockNode exists to put in the intent, so the intent must
// be able to carry the command itself (same defect shape as rev 1's BranchRef).
// toggleFlag off with a CommandNode target is impossible by construction
// (nothing to remove) — the UI never constructs it.
type AttributeTarget = BlockNode | CommandNode;

type EditIntent =
  | { kind: "setArgValue"; arg: ArgNode; value: ArgValueInput }         // §4.4
  | { kind: "addAttribute"; target: AttributeTarget; name: string; value?: ArgValueInput[] } // §4.6
  | { kind: "removeNode"; node: AttributeNode | CommandNode | DirectiveNode | IfNode | RandomNode } // §4.6/§4.7
  | { kind: "toggleFlag"; target: AttributeTarget; name: string; on: boolean }  // §4.6
  | { kind: "addCommand"; at: InsertTarget; name: string }               // §4.5
  | { kind: "setCondition"; branch: BranchRef; value: string }           // §4.4 (replace, or insert if absent)
  | { kind: "setChance"; branch: BranchRef; value: ArgValueInput }       // §4.4 (percent_chance operand)
  | { kind: "addBranch"; parent: IfNode | RandomNode; branch: "elseif" | "else" | "percent_chance" } // §4.10
  | { kind: "removeBranch"; branch: BranchRef }                          // §4.10
  // rev 4 — the did-you-mean quick-fix previously bypassed this union entirely
  // ("applies a single-token TextEdit"), violating §2's every-action-is-an-intent
  // rule and escaping the §4.8 per-intent expectations:
  | { kind: "applySuggestion"; node: RawNode; tokenIndex: number; replacement: string };
  // Replaces exactly tokens[tokenIndex] (must lie within node's range) with
  // `replacement`. §4.8 expectation: the RawNode's range re-parses into
  // whatever structure the fixed name produces (typically an Attribute/
  // CommandNode absorbing the run's remaining tokens) — the ONE intent whose
  // straddling-set expectation is "structure may change freely WITHIN the old
  // RawNode's span, nothing outside it"; comments inside the span survive.

// Where a new statement goes. All resolve to a single source offset via §4.5.
// `{ after: Item }` was dropped in rev 3 as consumer-less, with the note that
// it would return "alongside its consumer" — §3.9's card selection IS that
// consumer, so it is back, now with a UI surface and §10 fixtures.
type InsertTarget =
  | { in: "section"; section: SectionNode }   // append at end of section body
  | { in: "block"; block: BlockNode }         // append before block close
  | { in: "branch"; branch: BranchRef }       // append before the branch's terminating keyword
  | { after: Item };                          // insert directly after a sibling (§3.9 selection)

type ArgValueInput = number | { rnd: [number, number] } | string; // never expr — expressions are Code-tab-only (§3.4)
```

**Why `BranchRef` and not the branch object (rev 2).** In `src/parser/types.ts`, `IfBranch` and `RandomBranch` are plain interfaces — they do **not** extend `NodeBase`, and carry no `span`, no `firstToken`/`lastToken`, no parent pointer, and no index:

```ts
interface IfBranch { keyword: number; condition?: number; items: Item[] }
interface RandomBranch { chanceKeyword: number; chance?: ArgNode; items: Item[] }
```

But every branch operation needs the *neighbourhood*: §4.5's branch anchor is "the offset of the next `elseif`/`else`/`endif`", which is `parent.branches[index + 1].keyword` or `parent.endif` — an `index` and a `parent` the branch object alone cannot supply. Rev 1 passed the bare branch and then used an `i` that no intent carried; that is unimplementable as written. This defect sat squarely in the fully-editable-conditional path Ash chose, i.e. the most load-bearing new work in 3.3, so it is fixed here rather than left to the implementer. Passing `parent + index` also makes `removeBranch` well-defined (its extent runs from `branches[index].keyword` to just before `branches[index+1].keyword` or the closer).

```ts
// Pure function: no I/O, no globals — mirrors parseRms.
function computeEdit(result: ParseResult, intent: EditIntent, lang: LanguageIndex): EditResult;

interface EditResult {
  edit: TextEdit;   // exactly one; see the note on compound edits below
  caret: number;    // post-edit caret offset in the NEW source, for focus restoration (§6.3)
}
```

**Return type is pinned (rev 2)**: rev 1's §4.1 said "returns exactly one `TextEdit`" while §6.3 said it "also returns a post-edit caret offset" — both load-bearing, mutually inconsistent. `EditResult` carries both. The `caret` is what makes "add attribute → the new value field is focused" work without node identity (§6.3): it points at the start of the value just set, or the first placeholder of a just-inserted item. (Compound operations needing more than one edit — none in v1 — would widen `edit` to `TextEdit[]`; keep it singular until a real case appears.)

### 4.2 The two primitives

Every intent reduces to one of two byte operations, both computed purely from token spans:

1. **Replace a span** — `{ start: node.span.start, end: node.span.end, newText }`. Used for set-value (replace an `ArgNode`/condition-token span) and delete (replace a node's extended span with `""`). Because `ParseResult` retains the source and every node's span is exact and well-nested, the replaced range is unambiguous and everything outside it is untouched by construction.
2. **Insert at an anchor** — `{ start: offset, end: offset, newText }`. Used for add-attribute, add-command, add-branch. The whole difficulty is (a) computing the right anchor offset and (b) formatting `newText` to match its surroundings (§4.3).

### 4.3 Formatting inference — match surrounding (Ash's Q2 decision)

Before any insertion, infer the local style so the new text looks native. `inferBlockStyle(result, container)` returns:

```ts
interface BlockStyle {
  indentUnit: string;      // the whitespace prefix one level deeper than the container opener
  onOwnLines: boolean;     // are existing sibling items each on their own line, or inline?
  eol: "\n" | "\r\n";      // detected from source (CRLF vs LF), file-wide
}
```

Inference rules (all read from the source string via spans, never guessed):
- **`eol`**: first `\r\n` vs `\n` in the source; default `\n`.
- **`onOwnLines`**: look at the container's existing item tokens — if consecutive top-level items in the container are separated by an EOL (there is a `\n` between the previous item's `lastToken.end` and the next item's `firstToken.start`), the container is one-item-per-line; if they sit on the same line, it's inline. Empty container → inherit the parent section's setting; empty file → `onOwnLines: true`.
- **`indentUnit`**: the exact whitespace run at the start of the line of the first existing item in the container (its leading trivia between the preceding EOL and its `firstToken.start`). For a nested block, this is naturally deeper than the block opener's line, so nested inserts indent correctly. Empty container → parent indent + one detected step (the step is the file's dominant indent delta — tab if any indented line starts with a tab, else the modal leading-space count; default one tab, since the corpus is overwhelmingly tab-indented).

Insertion text is then assembled as: for `onOwnLines`, `eol + indentUnit + <rendered item>`; for inline, `" " + <rendered item>`. Worked examples are exactly the previews Ash approved: a tab-indented one-per-line `create_terrain` block gets `\n\t number_of_clumps 12` before the `}`; a compact one-line block gets ` number_of_clumps 12` inline before the `}`.

**Rendering an item to text** uses `language.json`: `<name> <arg1> <arg2> …` with args rendered per type (numbers as-is, constants as their name, `rnd(a,b)` canonical, flags bare). Defaults come from `ArgumentDef.default`. **Placeholder tokens are pinned (rev 4 — previously unspecified, directly in the property-test path):** a required arg with no default renders `def.min ?? 0` for numeric types and the literal word **`TODO`** for constant/string types (the row opens focused on it). Why these exactly: both are **consumed as `ArgNode`s by the parser's argument consumption** — a word in a constant slot parses clean (parser §2.1: constants are just words/IDs; unknown-constant checking is validate-level), and a number in a numeric slot draws at most a range warning — so a placeholder can NEVER land in statement position, join an unknown-run, or coalesce with adjacent content into a RawNode. Expected post-parse shape per intent: the inserted item is a normal Command/AttributeNode with all args present as ArgNodes; no new RawNode, no error-severity diagnostic. (`TODO` may draw a validate()-level unknown-constant info once validate() exists — desirable, it marks unfinished fields.)

### 4.4 Set a value

`setArgValue`: replace the target `ArgNode` span with the new rendered value. `{ start: arg.span.start, end: arg.span.end, newText: renderValue(value, arg.def) }`; `caret` = the new value's start. Nothing else moves. A multi-token arg (quoted path, expression) uses `firstToken`..`lastToken` — but expressions are read-only (§3.4), so in practice set-value targets single-token args and quoted paths (quoting per §3.4's pinned `DirectiveNode.hash` → `IncludeInfo.directiveToken` hop, **filename args only**).

`setCondition` / `setChance` — **two cases, because the target is optional (rev 2)**:
- **Present** (`branch.condition !== undefined` / `branch.chance !== undefined`): a replace, exactly as above, over the condition token's span (`tokens[branch.condition]`) or the chance `ArgNode`'s span.
- **Absent** (`undefined` — an `else` branch, or a malformed `if`/`percent_chance` the parser kept with an `RMS0106`): there is **no span to replace**, so this becomes an **insert immediately after the branch's keyword token**: `{ start: tokens[branch.keyword].end, end: tokens[branch.keyword].end, newText: " " + rendered }`. (For `RandomBranch` the anchor is `tokens[branch.chanceKeyword].end`.) The UI never offers a condition field on an `else` (§3.5), so in practice this path is reached only for the malformed case — but it must exist, or committing a value into an empty condition field is undefined behavior.

### 4.5 Add a command / insert-anchor computation

`addCommand` with an `InsertTarget`. The anchor offset:
- **`in: "section"`** — append at end of the section body: the offset just after the last item's `lastToken.end` (or just after the section header token if the section is empty). New text = `eol + indentUnit + rendered`.
- **`in: "block"`** — before the block's `close` brace: offset = `tokens[block.close].start`, backed up over the whitespace immediately preceding `}` on its line so the `}` stays where it is. New text = `eol + indentUnit + rendered`.
- **`{ after: Item }`** (§3.9's selection-driven insert) — immediately after that item: offset = the end of the anchor item's last token (`tokens[item.lastToken].end`), i.e. `item.span.end`. Style comes from the **anchor item's own** surroundings (§4.3), so an item nested in a branch or block inserts at that depth with no special case — the anchor carries its context implicitly. Use `item.span.end` rather than "start of the next sibling's line" so any trailing same-line comment on the anchor stays attached to the anchor, exactly as §4.6's surgical rule keeps it attached on delete.

- **`in: "branch"`** (the fully-editable-conditional case) — before the branch's **terminating keyword**, resolved from the `BranchRef`'s `parent` + `index` (§4.1 — this is precisely why the intent carries both):

  ```ts
  const { parent, index } = target.branch;
  const next = parent.branches[index + 1];
  const terminator: number | undefined =        // token index
    next ? (parent.kind === "if" ? next.keyword : next.chanceKeyword)
         : (parent.kind === "if" ? parent.endif : parent.end);
  ```

  Offset = the line start of `tokens[terminator]`, backed up over its leading indentation (so the terminator keeps its own line and indent). New text = `eol + indentUnit + rendered` at the branch's indent depth. If `terminator === undefined` the construct is unclosed (`RMS0105`) — **suppress the insert** per the unclosed-container rule below. This is the one genuinely new anchor computation fully-editable conditionals require, and it is fully determined by AST token indices — no scanning of source text.
**§4.3 governs formatting (rev 3 — the formulas above show the own-lines case only).** Each bullet's `eol + indentUnit + rendered` applies when the container's inferred `onOwnLines` is true; for an inline container the inserted text is `" " + rendered` per §4.3. The anchor computation is identical either way; only `newText`'s prefix differs.

If the container is unclosed (no `close`/`endif`/`end_random` — the region has a parse error), the insert target is **suppressed** and the card shows "finish this block in the Code tab first" — we do not guess where an unterminated construct ends (§5).

### 4.6 Add / remove / toggle attributes

- **`addAttribute`** — with a `BlockNode` target: an insert into the block, `in: "block"` anchor (§4.5), text = the rendered attribute with its default value (or a placeholder to fill). With a **`CommandNode` target** (rev 3 — the command has no block at all: a block-kind command written bare, or an unknown command): the edit synthesizes the `{ … }` — `create_terrain FOREST` → `create_terrain FOREST {\n\t<attr>\n}` using inferred style, inserted immediately after the command's `lastToken.end`. (This is the only edit that adds a brace pair; it is safe because we control both braces.)
- **`toggleFlag on:true`** — same as addAttribute but the rendered text is the bare flag name.
- **`removeNode` / `toggleFlag on:false`** — deletion is **one of two modes, chosen up front and never mixed** (rev 2: rev 1's rule was both garbled and silently allowed an asymmetric extension that strips a line's indentation while leaving a comment stranded at column 0).

  Let `L` = the text between the preceding EOL and `node.span.start`, and `R` = the text between `node.span.end` and the next EOL (inclusive of that EOL).

  - **Whole-line mode** — chosen **iff** `L` is entirely whitespace **and** `R` is entirely whitespace (i.e. the node sits alone on its line, no comment or sibling either side). Delete `[lineStart, nextEolEnd)`: the indentation, the node, and its single trailing EOL. The line disappears cleanly with no blank residue.
  - **Surgical mode** — used in **every other case**, including whenever a comment or another item shares the line. Delete exactly `node.span`, plus **one** adjoining separator space (prefer the space before the node; if there is none, take the one after). Nothing else moves. A trailing `/* note */` keeps its position on the line; a sibling attribute on the same line keeps its indentation.

  **The two extensions are all-or-nothing** — never extend one side without the other. That is what rules out the stranded-comment-at-column-0 artifact, and it is what keeps the §4.8 comment-survival property true by construction for **adjacent** comments. **Precision (rev 3):** deleting an *adjacent* comment is never a side effect of deleting a command — but a comment *inside* the deleted construct's span (e.g. inside a removed command's block, like AD4 Pag's line-734 `/* replace_terrain DESERT ICE */`) is deleted **with** the construct, deliberately: you deleted the construct, contents included. §4.8 clause 4 is scoped accordingly.

### 4.7 Delete a command / conditional

`removeNode` on a `CommandNode`/`IfNode`/`RandomNode`/`DirectiveNode`: same extended-span deletion as §4.6, over the whole construct (a command's span already includes its block; an `IfNode`'s span already includes all branches through `endif`). Deleting is offered with a single-level **undo** (§6.4, shared Monaco stack) rather than a confirm dialog — reversible beats modal.

### 4.8 The apply → reparse → re-render cycle and its contract

Applying the `TextEdit` produces a new source string; the app re-parses it (§6.2) and the affected card re-renders from the new AST. The **contract the patch engine must satisfy** is this section, and it is the acceptance criterion for 3.3 — so it is stated formally. (Rev 1 stated it as prose: "an AST that differs from the original in exactly the intended way and no other". That is **not implementable as written** — every insert shifts token indices and spans for everything downstream, so a literal structural diff fails on *correct* edits. The parser spec hit the same class of vagueness in rev 5 around "reachable" in its coverage gate and resolved it with a formal definition; this does the same.)

**Definitions.** For an applied `TextEdit` `e = {start, end, newText}`:

- The **shift** `Δ = newText.length - (end - start)`.
- The **edit region** is `[e.start, e.end)` in the old source and `[e.start, e.start + newText.length)` in the new.
- A node is **pre-edit** if `node.span.end <= e.start`, **post-edit** if `node.span.start >= e.end`, and **straddling** otherwise. **Boundary refinement (found during 3.3 implementation):** a *container* whose span ends exactly at a zero-width insert point (append into a section; a block-less command growing a block) legitimately **stretches** to absorb the insert — the comparator accepts, for nodes touching the edit point, either the identical key or a same-start key with the end shifted by Δ. Leaf siblings touching the point remain byte-identical and pass the strict clause.
- Two nodes are **shift-equal by Δ** iff: same `kind`; same name text (for named nodes, comparing the *text* of the name token, not its index); same child-list length with children pairwise shift-equal; same `ArgValue` shape and value; and spans related by `new.span.start === old.span.start + δ`, `new.span.end === old.span.end + δ`, where `δ = 0` for pre-edit nodes and `δ = Δ` for post-edit nodes.

**The property.** For every generated `(file, intent)` pair, let `A` = parse of the original source and `B` = parse of the patched source. Then:

1. **Pre-edit nodes are identical.** Every pre-edit node of `A` has a shift-equal-by-0 counterpart in `B`, in the same tree position.
2. **Post-edit nodes are translated, not changed.** Every post-edit node of `A` has a shift-equal-by-Δ counterpart in `B`, in the same tree position. (This is the clause rev 1's prose could not express, and the reason a naive structural diff was the wrong tool.)
3. **Only straddling nodes changed, and only as intended.** The straddling set **always decomposes into two parts (rev 3)**:
   - **The ancestor chain.** Every ancestor of the edit point (block → command → section — any node whose span strictly contains the edit region) straddles by definition, since its span end shifts by Δ. The generic clause, stated once so the astDiff author doesn't re-derive it: each ancestor must be **span-stretched** (`span.start` unchanged, `span.end` shifted by Δ) and otherwise unchanged — same kind, same name text, children pairwise shift-equal *except* the single child on the path toward the edit region (recursively governed by this same rule) and any child-list-length change the intent itself declares (an insert adds one, a delete removes one, at the declared position).
   - **The intent's target set.** Compared against the per-intent expectation — each intent kind declares what it should produce (`setArgValue` ⇒ exactly one `ArgNode` differs and its value equals the input; `removeNode` ⇒ that node is absent and its former siblings are otherwise shift-equal; etc.). Written once per `EditIntent` kind.
4. **Comments outside the edit survive byte-identical (rev 3 — scoped; the absolute form failed every legitimate delete of a comment-containing construct).** For non-delete intents: the trivia-token text sequence of `B` equals `A`'s — same count, order, text. For `removeNode`/`removeBranch`/`toggleFlag off`: trivia whose span lies **within the deleted range** is expected to disappear (deleting a construct deletes its contents, §4.6's precision note — AD4 Pag's commented-out `replace_terrain` inside a block is the live specimen); the sequence of all **other** trivia must survive unchanged. No intent may ever delete trivia outside its edit range.
5. **Well-formedness.** `checkProperties(B)` returns no violations, and `B` has no **new** error-severity diagnostic absent from `A`. **(Rev 3 — the exemption is near-vacuous and treated as such:** the only error-severity codes are RMS0101/RMS0103 (unclosed/section-crossed brace), and a span-based edit on well-nested nodes cannot unbalance braces; rev 2's worked example — "deliberately setting an out-of-range value" — is RMS0203, a *warning*, and never triggers this clause. If the comparator ever observes a new error, treat it as a patch-engine bug until proven otherwise.)

**The comparator is new work — it does not exist (rev 2).** Rev 1 claimed the harness "reuses parser §12's coverage/span-fidelity checkers". `src/parser/__tests__/testUtils.ts` exports exactly `loadLanguage`, `collectNodes`, and `checkProperties(result)` — all of which validate **a single `ParseResult`**. They deliver clause 5 (the easy half: "the patched file is still well-formed") and nothing else. Clauses 1–3, the diff-confinement core, require a **new shift-aware AST comparator** — scope it as `src/breakdown/patch/__tests__/astDiff.ts` and budget for it explicitly; it is a real component of 3.3, not a test detail. `collectNodes` is a good primitive to build it on (it already yields the node/children ranges).

**Determinism and budget (rev 2; seeding re-pinned rev 3).** Unlike the parser's fuzz suite (seeded `mulberry32`, fixed iteration counts), rev 1 said only "generate random intents" over ~52 maps — unreproducible and slow in CI. Pin: a **seeded `mulberry32`** (reuse `fuzz.test.ts`'s generator) with the **seed derived per-file** (fixed base seed combined with a hash of the filename, reset at the start of each file) — **never one PRNG stream across files**, because dev (with `local/` present, ~57 files) and CI (committed only, 13 files) iterate different file sets, and a shared stream would generate different intents for every file after the first divergence, making CI failures unreproducible locally. A failure reproduces from `(file, iteration)` alone, printed in the assertion message. **Fixed N intents per file** (start N = 25; raise only if runtime allows), files in sorted order. Corpus scope per §10.

**Get this green before wiring any UI to the engine** (CREATION_PLAN 3.3 — debugging engine + UI at once is misery).

### 4.9 Unverified and unknown data

Adding/editing against `"verified": false` defs works identically (the mechanics don't depend on verification) — the row just carries the "unverified reference data" caveat, matching how the parser caps such diagnostics to info. Adding an attribute the def doesn't list is possible via the "Other contents" generic add (free-form name + value) but is de-emphasized. Never block an edit because the data is unverified — the user may know better than our reference data, and code is source of truth.

### 4.10 Add / remove a branch

- **`addBranch "elseif"/"else"`** — insert `eol + indent + "elseif <cond-placeholder>"` (or `"else"`) before `endif`'s line (offset from `IfNode.endif`), plus an empty body line. `else` is inserted after any existing `elseif`s (before `endif`); a second `else` is disallowed by the UI. For random, `addBranch "percent_chance"` inserts `percent_chance <n>` before `end_random`.
- **`removeBranch { parent, index }`** — delete from the start of `branches[index].keyword`'s line through the character before the next branch keyword's line start (`branches[index+1].keyword`, or the closer `parent.endif`/`parent.end` when removing the last branch), using §4.6's whole-line/surgical mode selection at each edge. Removing the only `if` branch is disallowed (it would orphan `endif`); the UI offers "delete the whole conditional" instead (`removeNode` on the `IfNode`). **Symmetrically (rev 3): removing the last `percent_chance` branch of a `RandomNode` is disallowed** (it would leave an empty `start_random … end_random`, drawing RMS0106 on whatever follows); the UI offers "delete the whole random block" instead. Removing a branch whose parent is unclosed is suppressed, like every other unclosed-container operation.

### 4.11 Editor commit semantics

§3.4 asserts editors are uncontrolled during typing and commit on blur/Enter; rev 1 specified that nowhere (and cross-referenced §4.7, the delete section). The rule, since it determines *when* an `EditIntent` is even constructed:

- **Typing changes only local component state.** No `EditIntent`, no `TextEdit`, no re-parse. This is what stops a whole-file reparse per digit and keeps the caret from being yanked mid-word.
- **Commit on `blur` or `Enter`.** Build the intent, call `computeEdit`, apply, re-parse. **Focus handling differs by trigger (rev 3):** after an **explicit action** (add attribute/command/branch — click-driven) or an **Enter** commit, restore focus via `EditResult.caret` (§6.3 — the new value field, or the field just committed). After a **blur** commit, do **not** refocus — the user just moved focus somewhere else deliberately, and yanking it back via `caret` would fight them; the caret is simply unused. If the committed text is **identical to the current AST value, do nothing** — no empty `TextEdit`, no reparse, no undo-stack entry (otherwise tabbing through a block would spam Monaco's undo stack with no-ops).
- **`Escape` reverts** the field to the AST value and commits nothing.
- **Invalid-but-writable input still commits** (§5's soft-validation rule): an out-of-range number or unknown constant is legal to write, and the resulting diagnostic surfaces on the row. Only input that cannot be *rendered* into a token at all (e.g. a value containing whitespace in a single-token slot) is rejected at the editor with an inline message and no commit.
- **Checkbox/dropdown controls commit immediately** on change — there is no partial-typing state to protect.

## 5. Behavior while the code has parse errors

There is no "parse failed" state — the parser always returns a best-effort AST. So Breakdown is **always fully rendered and mostly usable**, even mid-typo. The rules:

- **Clean regions stay fully editable.** A parse error in one section does not lock the others. Editing is scoped to the node you touch; a `TextEdit` on a clean node is unaffected by a broken node elsewhere.
- **Broken regions are read-only raw islands.** Anything the parser degraded to `RawNode` (interleaved conditionals, nesting-cap) renders as a raw card (§3.7): visible, verbatim, "edit in Code". Coverage holds — the broken bytes are on screen, just not structured-editable.
- **Unclosed containers suppress their inserts.** A `BlockNode`/`IfNode`/`RandomNode` with no closer (`RMS0101`/`RMS0105`) still renders its parsed contents (editable), but its "add item" affordance is disabled with "finish this block in the Code tab" — because §4.5 can't compute a safe insert anchor without a terminator. Existing items inside it remain editable (their spans are exact regardless).
- **Edits may introduce errors, and that's allowed.** Typing an out-of-range number or an unknown constant produces a valid `TextEdit`; the re-parse surfaces the diagnostic inline on the row (and as a Code-tab squiggle). Breakdown does **not** reject the edit — you are allowed to write invalid RMS; the diagnostic informs, it doesn't block. (Soft validation, §3.4.)
- **The diagnostics are the parser's, unmodified.** Row-level and card-level problem badges reuse `ParseResult.diagnostics`, mapped to the node whose span contains each diagnostic's span. No separate Breakdown validation exists; it would risk disagreeing with the Code tab.

## 6. React component and state architecture

### 6.1 Component tree

```
BreakdownPane                         // active only when the Breakdown tab is selected
├─ BreakdownSidePanel                 // left: preview placeholder + reference table (§3.8)
│  ├─ PreviewPlaceholder              // Phase-4 stub (Current/Final toggle, diamond)
│  └─ ReferenceTable                  // Terrain/Objects/Commands radio + table
├─ SectionTabs                        // Header? + 7 canonical + unknown-section tabs (§3.1)
└─ SectionView (active tab)
   ├─ AddCommandButton                // command picker (§3.2)
   └─ BlockList  ─┐ renders Item[] in source order
      ├─ CommandCard  ── AttributeRow* (all-attributes model, §3.3) / OtherContentsGroup
      ├─ DirectiveCard
      ├─ ConditionalCard ── BranchSegment* ── BlockList (recursive)   // §3.5
      ├─ RandomCard     ── BranchSegment* ── BlockList (recursive)
      ├─ SharedBlockCard (read-only)
      └─ RawCard (read-only)
```

`BlockList` is **recursive** — a branch segment renders a `BlockList` over `branch.items`, which is how nested conditionals and blocks-within-branches render uniformly. Every card takes its AST node + the shared context (below) as props; cards are otherwise pure functions of their node, so re-render after a reparse is automatic.

### 6.2 State ownership — lift the parse to app level

Today the parse lives inside `CodePane` (`useRmsDiagnostics`, `src/editor/useRmsDiagnostics.ts`) and only diagnostics/totals are lifted to `AppContent`. Breakdown needs the **full `ParseResult` (the AST)**, so the parse must be lifted:

**One parse, in the worker (pinned — rev 2).** Rev 1 contradicted itself here: it introduced `useParsedDocument` as owning "the single parse of the current document", then two bullets later pinned "worker for Code-tab squiggles, main-thread `parseRms` for the Breakdown AST" — two parses per change. Both cannot hold, and the ambiguity had teeth: **resource totals are computed inside the worker today** (`src/editor/parserWorker.ts`), so under the two-parse reading it was unstated which parse feeds `StatusBar`, while §6.5 simultaneously promised "no change to `StatusBar`'s props". Resolution:

- **`useParsedDocument(content, playerCount)`** at `AppContent` level owns **the one and only parse**, and it runs **in the existing worker** (parser §9 / 2.4 — typing-time parsing must never block the UI thread; this is already built and working, and it is where `resourceTotals` is computed).
- The worker's response is widened to carry the **full `ParseResult`** alongside what it already returns. The AST is plain data (token *indices*, numbers, strings — no class instances, no cycles), so it structured-clones without special handling.
- The hook returns **`{ source, parseResult, diagnostics, resourceTotals }`**. `source` is retained deliberately: `src/components/CodePane.tsx` (line 63 as of rev 4 — line refs drift; grep for the guard) uses it as the staleness guard (`model.getValue() !== source → skip applying markers`) and that guard must survive. `parseResult.source` carries the same string, so either may be used — but the hook surfaces `source` explicitly so the guard reads the same as it does today.
- Consumers: `CodePane` → `diagnostics` + `source` (markers, unchanged behavior); `StatusBar` → `resourceTotals` + `diagnostics` (**props unchanged**, as §6.5 promises); `BreakdownPane` → `parseResult`.
- **Payload-size trigger, not an open question.** The only cost of one-parse-in-worker is serializing the AST on each debounced parse. If profiling shows this hurts on the corpus's largest map (`AK_Vanguard_v1.2.rms`, ~49.7k tokens, the parser's named benchmark), the fix is a `wantAst` flag on the request so the AST is only posted while the Breakdown tab is active — a small, local change. Measure before adding it; do not pre-optimize.
- `src/parser` stays free of React/Monaco/Tauri (parser §14) — `useParsedDocument` and the worker are the boundary that import both.

### 6.3 Ephemeral UI state, anchored across reparse

Expansion (which cards are open), focus (which field), and selection are **not** part of the AST and must survive a reparse (after every edit the node objects are new). Token indices and node identities change on every edit, so **anchor ephemeral state to source offsets**, re-resolved after each parse — the same technique an editor uses to keep the cursor and folding stable across edits:

- **Expanded set**: a set of source offsets (each = the `span.start` of an expanded command/conditional at the moment it was expanded). After a reparse, a card is expanded iff some anchor offset falls within its span. Edits shift offsets after the edit point; the patch engine returns the edit's `start`/length delta so anchors past it are shifted to stay put. **An anchor inside a deleted range is dropped** (rev 4 — e.g. the expanded card whose command was just removed; there is nothing for it to re-anchor to, and letting it dangle would spuriously expand whatever next occupies those offsets).
- **Selected card** (§3.9): a single `selectedAnchor: number | null`, the selected card's `span.start`. Same resolution rule as expansion (the selected card is the one whose span contains the anchor), same drop-if-inside-a-deleted-range rule, and same ordering requirement below.
- **Ordering rule (BUG-001 — applies to every anchor set here).** Anchors must always be expressed in the coordinate space of the **currently rendered** `parseResult`. Do **not** shift them eagerly when the edit is applied: the reparse is debounced and runs in a worker, so for that window the UI would render new anchors against old spans and the highlight visibly jumps to a neighbouring card. Queue the shift and apply it when the parse for that exact source arrives, so both flip in one commit. See `docs/known-issues.md` BUG-001 for the full diagnosis; `pendingFocusRef` in `BreakdownPane.tsx` already does this correctly and is the pattern to follow.
- **Focus/selection after an edit**: `computeEdit` also returns a **post-edit caret offset** (e.g. the start of the value just set, or the first placeholder of a just-added attribute). After the reparse the UI resolves that offset to the deepest node containing it and focuses that node's editor. This is how "add attribute → the new attribute's value field is focused and selected" works without node identity.

This offset-anchoring is the Breakdown analogue of the parser's "nodes reference tokens by index, recomputed each parse" discipline — no identity is assumed to persist; positions are.

### 6.4 Shared document buffer and undo with Monaco

CREATION_PLAN 3.4 requires "a single undo stack shared with Monaco". Recommendation (pin, with the alternative noted for the 3.4 implementer / critique):

- **Make a persistent Monaco `ITextModel` the authoritative document buffer**, created once at app level (in `useDocument`), living independent of whether the Code tab's `<Editor>` is mounted. The Code tab's editor *attaches* to this model when mounted; Breakdown applies its patches to the **same model** via `model.pushEditOperations(...)`. `content` (React state) mirrors the model via `onDidChangeContent`. Result: Monaco's own undo/redo stack now spans **both** Code-tab typing and Breakdown edits, for free, and there's still exactly one source of truth (the model's text). Ctrl+Z after a Breakdown "delete command" undoes it, and it's the same stack the Code tab uses.
- This is a **migration** from the current 2.x wiring, where `useDocument` holds `content` as plain React state and Monaco is a controlled component over it (`CodePane` `value={content}`). Under the new model, `useDocument` owns the `ITextModel`; `content` becomes a derived mirror; `CodePane` binds to the model (uncontrolled `defaultValue` + the shared model) rather than a controlled `value`. Flag this clearly in 3.4 — it touches `useDocument`, `CodePane`, and the open/save/dirty logic (dirty = model version ≠ last-saved version, a cleaner signal than string compare).
- *Alternative (if the shared-model migration proves too invasive for 3.4):* keep `content` as the plain-string source of truth and maintain an app-level undo stack of `{ before, after, caret }` snapshots that both Breakdown and a Monaco `onDidChangeModelContent` push to, intercepting Ctrl+Z at the app level. More code, re-implements what Monaco already does well — hence the shared-model approach is preferred. Decide in 3.4; either way the *patch engine* (3.3) is unaffected — it just produces `TextEdit`s.

### 6.5 Interaction with existing systems

- **`GenerationSettingsContext`** (`playerCount`) already feeds resource totals; `useParsedDocument` takes `playerCount` so totals recompute on the same parse. `mapSize` reserved for preview (Phase 4).
- **`StatusBar`** totals/Problems already lifted; they now come from `useParsedDocument`. No change to `StatusBar`'s props.
- **`HelpTip`** (§8) wraps every interactive element per the standing convention.
- **Tauri store** — Breakdown adds no new persisted settings in v1 (expansion state is ephemeral, not persisted). If "remember which section tab I was on" is wanted, it's a `settings.json` key like the help/generation settings (defer unless asked).

## 7. Reference-data, schema, and parser action items (consolidated)

Surfaced by this design; do in the phase noted, not in 3.1. **Rev 2 splits these into blocking vs graceful** — rev 1 listed them flat and phrased several as "confirm the flag is set" when the field has zero occurrences (§0.1). Verify counts before assuming any of this data exists.

**Blocking — do before the corresponding 3.2 surface ships:**

1. **Remove the `#ifdef`/`#ifndef`/`#else`/`#endif` directive entries and add `nonFunctional` to `#undefine`/`#include`** (parser-design §13 item 2, still not done — all four phantoms are live in `directives[]`, and `nonFunctional` has zero occurrences). Without this, the §3.2 picker offers beginners directives that do nothing in DE, and §3.6's "has no effect" badge can never render. Until it lands, 3.2 **must hardcode-suppress** the four `#ifdef`-family names from any picker (§0.1 P2).
2. **`repeatable` flags** on the cumulative attributes (`replace_terrain`, `terrain_cost`, `spacing_to_specific_terrain`, connection radii — parser §8/§13). Zero occurrences today. Note the §3.3 ground-truth rule means the UI is **already safe without them** — the flag only governs whether "add another" is offered — so this is blocking for *feature completeness*, not for correctness. Do **not** add `maxRepeats` without the Update 153015 re-check (parser §8).
3. **`sectionLabels`** (constant → display label) for the sub-tabs. Zero occurrences; it is a seven-entry map, so just create it in 3.2 — as a `src/breakdown/` constant unless a contributor-editable version is wanted, in which case `reference/data`.

**Graceful — the UI degrades correctly without these:**

4. **Attribute `default`s**: currently **34/130 (rev-4 recount)**. Absent add-rows work without them (§3.3's no-default path), so this is not a blocker — but it *is* what makes the all-attributes decision feel good rather than empty, so it is the highest-value polish pass available (a `language.json` population session sourced from the archived guide).
5. **`game-constants.json` extraction** (Phase 4.0, already planned): the terrain/object comboboxes (§3.4) and the reference table (§3.8) show names now, and gain IDs/descriptive-names/textures when the extraction lands. Design the combobox/table to fill those columns when present, "—" when null.
6. **`predefinedLabels`** (parser §7/§13, zero occurrences today): the condition combobox and `otherConstant` editor want it. Until it lands, those comboboxes offer symbol-table names + free text only — which is why §3.4 pins free text as always-accepted rather than validating against a list.
7. **`controlKeywords` `arguments[]`** (parser §13): lets the `percent_chance`/condition editors be fully data-driven rather than special-cased.
8. **A distinct `path` argument type** (rev 2): `type: "string"` is currently overloaded across filename slots and plain name slots (`#const`/`#define` names), forcing §3.4's quote round-trip to special-case by directive name and hop through `IncludeInfo` to recover the `quoted` flag. A `path` type (or a `quoted` field on `ArgNode`) would make it decidable from the argument alone. Worth doing before the directive editors get more complex.
9. **Optional per-argument `label`/`placeholder`** on `ArgumentDef` for nicer field labels — pure polish, skip for v1 (use `name`).
10. ~~Structured `suggestion?: string` on `Diagnostic`~~ — **DONE (rev 4: `types.ts:43`, populated by `unknownName()`).** The quick-fix consumes it via the `applySuggestion` intent (§4.1).
11. **`validate()`** (parser-design §8, its own Sonnet session): unblocks §3.3's last-one-wins note and §3.2's cross-section warning (§0.1). Graceful — Breakdown consumes whatever diagnostics exist and invents none.

## 8. Help coverage (the `HelpTip` convention)

Per the standing rule (top-level `CLAUDE.md`, repo `CLAUDE.md`), every new interactive element wraps in `<HelpTip id="…">` with a matching `reference/data/ui-help.json` entry, as it's built. Coverage checklist for Phase 3 (the 3.5 audit step verifies it):

- Section sub-tabs (`breakdown.tab.<section>`), the Header/unknown tabs, count/problem badges, and the **"Hide Unused" switch** (`breakdown.hideUnused` — help text should say it hides attributes not present in the file, and that nothing real is ever hidden).
- **Selection + Add behavior** (`breakdown.selectedCard`, and update `breakdown.addCommand` to state that Add inserts *after the selected card*, or at the end of the section when nothing is selected — the insert position must be discoverable without trial and error). **Overview ruler** (`breakdown.overviewRuler` — "jump to problems in this section").
- Add-command button + command picker (`breakdown.addCommand`), the verified/unverified chip.
- Command card: expand/collapse, delete, the summary line.
- Attribute rows: each **kind** of control gets help (value field, constant combobox, flag checkbox, repeatable "add another", the faint "absent attribute add" affordance) — keyed generically by control kind, plus per-attribute help reused from the Monaco hover DB (`doc-strings.json` / `language.json` descriptions), so Breakdown and hover never disagree.
- Conditional/random cards: condition field, chance field, add/remove branch, per-branch add-command.
- Directive card, raw card ("why is this shown as code?"), the "Edit in Code" button.
- Side panel: Current/Final toggle, reference-table radio, table columns.

Command/attribute rows **reuse the docs DB content** (1.6 hover) rather than duplicating text — the 3.5 audit lists anything still missing so Ash can write it.

## 9. Open / verify items

Analogue of the parser's verify list — resolve with beta users (RMS Discord, PLAN.md) or a focused check:

1. **Display-order vs source-order for attributes** (§3.3): does showing attributes in def order (not file order) ever confuse or mislead? Watch in beta; per-attribute source-order pinning is the escape hatch.
2. **Attribute insertion position** (§4.5): always appending new attributes at end-of-block is predictable — confirm no common attribute is order-sensitive enough that end-append changes behavior (parser/guide check; none known).
3. **Match-surrounding heuristics** (§4.3): the `onOwnLines`/`indentUnit` inference needs tuning against the real corpus's varied styles (tabs, spaces, compact one-liners) — a fixture set of before/after inserts per style (§10).
4. **Shared-model undo** (§6.4): spike that a persistent `ITextModel` survives Code-tab unmount and that `pushEditOperations` from Breakdown lands on the same undo stack Ctrl+Z uses — before committing the `useDocument` migration in 3.4.
5. **Fully-editable branch inserts** (§4.5 `in:"branch"`): verify anchor computation against real corpus conditionals (8-way `elseif` chains inside `create_land`, `percent_chance` branches) — the §4.8 property test over the corpus is the enforcement.
6. **Empty-container style inference** (§4.3): inserting the first item into an empty block/section/branch has no sibling to match — confirm the parent-indent + detected-step fallback produces sane output on the corpus.
7. **AST payload cost under one-parse-in-worker** (§6.2): measure the serialized `ParseResult` round-trip on `AK_Vanguard_v1.2.rms` (~49.7k tokens). If the debounced parse visibly degrades typing, add the `wantAst` flag. Measure before optimizing.
8. **Node equality in the shift-aware comparator** (§4.8): the definition here is written from the AST's shape, not from a built comparator. When `astDiff.ts` is implemented, re-check that shift-equality doesn't produce false failures on nodes whose `def` resolution legitimately changes as a *result* of the intent (e.g. adding an attribute makes a previously-unknown name resolve) — if it does, exempt `def` from equality and compare name text only.

## 10. Test plan

Mirrors the parser's layered approach; the property test is the centerpiece.

**Patch engine (3.3), property-based (the gate):** the §4.8 contract, with its formal clauses 1–5, seeded `mulberry32`, and fixed N-intents-per-file budget. Requires the **new shift-aware AST comparator** (§4.8) — `testUtils.ts`'s `checkProperties` covers clause 5 only. **Non-negotiable CI gate**, like the parser's corpus properties.

**Generator coverage boundary (record — revisit deliberately, not by accident).** The §4.8 gate is only as strong as what `harvest`/`makeIntent` target, and that set is narrower than the full `EditIntent` union. Keep this table current whenever the generator changes:

| Intent / target | Covered? | Note |
|---|---|---|
| `setArgValue` | **numeric args only** | `harvest` takes single-token `number` args of numeric-typed defs. Constant/string args (terrain/object comboboxes, `#const` names, quoted paths) are **not** generated — §3.4's quoting round-trip is covered by unit fixtures only. |
| `removeNode` on commands/attributes | yes | |
| `removeNode` on **directives** | **yes — since the 3.3 test fix** | Originally excluded (`if (item.kind !== "directive")`), which left the entire Header tab surface (§3.1/§3.6) with zero property coverage and made directive-only maps generate no intents at all. `removeNode` accepts `DirectiveNode` and `computeEdit` handles it via `removeSpan`, so the exclusion was a harness omission, not a design constraint. **If directives are ever excluded again, that is a deliberate decision and belongs in this table.** |
| `addAttribute` | yes | closed blocks of block-kind commands with a non-empty `attributes[]` |
| `addCommand` | **known sections only** | `pools.sections` filters on `s.known`, so unknown-section inserts (§3.1) are never generated |
| `toggleFlag` | **no** | not emitted by `makeIntent` |
| `addBranch` / `removeBranch` / `setCondition` / `setChance` | **no** | **the largest gap.** These are the fully-editable-conditional intents (§0.1, §3.5, §4.10) — the most load-bearing new work in 3.3 — and the property gate never exercises them. Unit fixtures (§10 rev-2 additions) cover them; the corpus gate does not. Closing this is the highest-value extension to the harness. |
| `RawNode` / `OrphanBlockNode` | **excluded by design** | read-only in v1 (§3.7) — correctly never a patch target |

Related invariant: the productivity assertion is **conditional on the file having targets** (`isInert(pools)`). "At least one real edit per file" is false as an absolute — a file can legitimately offer nothing to edit (the `EM_*` stubs are two directives and no sections/commands/blocks). Assert productivity where targets exist and inertness where they don't, so both a broken generator and a mis-harvested file still fail loudly.

**Corpus scoping (rev 2; counts and specimens corrected rev 3 — rev 2 repeated the exact failure mode it was fixing, one `.gitignore` line lower).** `.gitignore:26` ignores `test-maps/local/` (now **24** files) — but `.gitignore:27` is `test-maps/*` with **selective negations**: git tracks only **13** of the ~57 map files. The untracked set includes rev 2's own named specimens (`Rage Forest 2026.rms`, `24hr_Bazi is God.rms`) plus Pa_Site, OWWC, QS_Three_Bays, and every `24hr_*`/`TL *` map. So: **the CI property-gate corpus is 13 committed files** — state it plainly, don't imply ~57; **no unit test may name an untracked file**; the committed duplicate-attribute/comment specimen is **`AD4 - Pag - v1.2.rms`** (5 consecutive `replace_terrain`s lines 686–690, repeated `terrain_cost`s, a conditional-wrapped connection block, and a commented-out `replace_terrain` inside a block at line 734 — one file covering both the ground-truth-rule and comment-survival fixtures). `local/` and `broken/` (still nonexistent — BCC2 triage open) are picked up **opportunistically via a directory-exists check** and skipped silently when absent; with §4.8's per-file seeding, their presence or absence cannot change any other file's generated intents. No test may hard-depend on either directory.

**Patch engine, unit (one per intent × formatting case):** set integer/percent/constant/rnd value; toggle flag on/off; add attribute into (own-lines block, inline block, block-less command → synthesizes braces); add command (empty section, non-empty section, into a branch before `elseif`/`else`/`endif`, into a `percent_chance` branch); delete command (with block, nested); add/remove `elseif`/`else`/`percent_chance` branch; set condition; CRLF vs LF file. Each asserts the exact `TextEdit` and that re-parse yields the intended AST.

Rev-2 additions, one per fixed defect (each of these would have shipped broken):

- **Delete modes (§4.6)** — whole-line mode (node alone on its line → line vanishes, no blank residue); surgical mode with a **trailing comment on the same line** (comment keeps its column, indentation preserved — the stranded-at-column-0 case); surgical mode with a **sibling attribute inline** (only the target plus one separator space goes); a block whose only other content is a comment.
- **Duplicate attributes without the `repeatable` flag (§3.3 ground-truth rule)** — a block with multiple `replace_terrain`s and **no flag in the data** must render one editable row per instance and expose all to edit/delete; deleting a middle one must leave the others byte-identical. Use the **committed** specimen `AD4 - Pag - v1.2.rms` (5 consecutive at lines 686–690; its line-734 commented-out `replace_terrain` doubles as the clause-4 interior-trivia fixture). (`24hr_Bazi is God.rms` / `Rage Forest 2026.rms` are gitignored — opportunistic only, never named in a test.)
- **Unknown-name boundary (§3.3, rev 3)** — a bare `elavation 5` in a block yields a `RawNode` rendered as a raw card whose RMS0200 carries the suggestion (quick-fix applies a first-token replace); `craete_land { … }` yields the def-less `CommandNode` editable card. One fixture each; the two must not be conflated.
- **Known-but-unlisted attribute (§3.3(c), rev 3)** — an `AttributeNode` with resolved def not in the enclosing `def.attributes[]` renders as a normal typed row in Other contents with NO badge.
- **Optional `condition`/`chance` (§4.4)** — `setCondition` on a branch with `condition === undefined` must produce an *insert after the keyword*, not a replace of `undefined`; an `else` branch exposes no condition field.
- **`string` overload (§3.4)** — `#const NAME 5`: editing `NAME` must **not** emit quotes; `#include_drs "a b.drs"`: editing the path **must** re-emit quotes, resolved via the `DirectiveNode.hash` → `IncludeInfo.directiveToken` hop.
- **Commit semantics (§4.11)** — committing an unchanged value produces **no** `TextEdit` and no undo entry; Escape commits nothing.
- **`applySuggestion` (§4.1, rev 4)** — on a bare-typo RawNode (`elavation 5`), the intent replaces the first token and the region re-parses to an AttributeNode absorbing the `5`; nothing outside the old RawNode span changes; a comment inside the span survives.
- **Placeholder tokens (§4.3, rev 4)** — addCommand/addAttribute with no defaults inserts `def.min ?? 0` / `TODO`; assert the new item parses as a structured node with all ArgNodes present, zero new RawNodes, zero error-severity diagnostics (the coalescing hazard the pin exists to prevent).
- **`BranchRef` resolution (§4.5)** — insert into the last branch of an `if` (terminator is `endif`) and into a middle branch (terminator is the next `elseif`); insert into a branch whose parent is unclosed must be suppressed, not guessed.

Post-3.4 additions (§3.9/§3.10):

- **`{ after: Item }` anchor (§4.5)** — insert after a top-level command; after a command **nested in an `if` branch** (must land in that branch, at that indent, not at section level); after a command with a **trailing same-line comment** (the comment stays with the anchor, the new command goes on the next line); after the **last** item in a section (equivalent to the append case). The property gate's generator should also emit this target now that it has a consumer — it was excluded when the variant was dropped.
- **Selection anchoring (§3.9/§6.3)** — deleting the selected card clears selection (anchor inside the deleted range); an edit above the selected card leaves selection on the same card; switching tabs clears it. Include the BUG-001 ordering assertion: at no point does selection resolve to a different card than the one selected.

**Formatting inference (§4.3), fixtures:** the two Ash-approved previews verbatim (tab one-per-line → newline insert; compact one-line → inline insert), plus space-indented, mixed, and empty-container cases drawn from the corpus.

**Rendering (3.2), against the corpus:** every `test-maps/` file renders without throwing and with **total coverage** — assert every top-level `Item` and every block item maps to exactly one card (the UI analogue of the parser's token-coverage gate); raw/orphan nodes render as read-only cards; unknown commands/attributes render (never dropped); duplicate sections aggregate correctly; preamble → Header tab.

**Behavior-under-error (§5):** a file with an unclosed block renders, its inserts are suppressed, sibling sections stay editable; an edit that introduces an out-of-range value re-parses and shows the inline diagnostic without rejecting the edit.

**Component/interaction:** expansion/focus survive a reparse via offset anchoring (§6.3); a Breakdown edit and a Code-tab edit share one undo stack (§6.4); switching Code↔Breakdown reflects the latest source both ways.

## 11. Deferred to v1.x (explicitly not in Phase 3)

*(Note: drag-reorder below is now partly unblocked — §3.9 reinstated `{ after: Item }`, which is the insert half of a reorder. A reorder is still delete + insert, and the drag gesture remains deferred.)*

Reorder commands/attributes by drag (a reorder is a delete+insert `TextEdit`; the engine can do it, the UI gesture is deferred); structured math-expression editor (read-only pill for now, §3.4); structured editing *inside* degraded raw/orphan regions (Code-tab only, §3.5/§3.7); double-click-reference-table-to-insert; persisting the active section tab; per-attribute source-order override (§9.1). None of these change the §4 engine — they're additive.

## 12. File layout

```
src/breakdown/
  BreakdownPane.tsx        top-level pane; consumes parseResult
  SectionTabs.tsx          Header + canonical + unknown tabs (§3.1)
  SectionView.tsx          add-command + BlockList for the active section
  BlockList.tsx            recursive Item[] renderer (§6.1)
  cards/
    CommandCard.tsx        collapsed/expanded, all-attributes model (§3.3)
    AttributeRow.tsx       typed value editors, flags, repeatable lists (§3.3/§3.4)
    ConditionalCard.tsx    IfNode branches, fully editable (§3.5)
    RandomCard.tsx         RandomNode branches
    DirectiveCard.tsx      §3.6
    RawCard.tsx            read-only fallback (§3.7)
  sidepanel/
    ReferenceTable.tsx     Terrain/Objects/Commands (§3.8)
    PreviewPlaceholder.tsx Phase-4 stub
  patch/
    intents.ts             EditIntent + BranchRef + TextEdit + EditResult types (§4.1)
    computeEdit.ts         the patch engine (§4) — pure, no React/Monaco
    formatStyle.ts         inferBlockStyle + renderItem (§4.3)
    __tests__/
      astDiff.ts           shift-aware AST comparator (§4.8) — NEW component, not a
                           test detail; testUtils.ts covers clause 5 only
      patch.property.test.ts  the §4.8 gate (seeded, fixed budget)
      patch.unit.test.ts      per-intent + per-formatting-case fixtures (§10)
  useParsedDocument.ts     app-level parse hook (§6.2) — actually lives at src/ level
```

`src/breakdown/patch/` (the engine) imports only `src/parser/*` types + `language.ts` — **no React/Monaco/Tauri**, so it's plain-Node Vitest-testable like the parser (the property test needs this). Only the card components and `useParsedDocument` touch React/Monaco.

---

## Appendix A: decisions and their consequences (quick reference for the 3.2–3.4 implementer)

| Decision (Ash) | Section | Consequence you must honor |
|---|---|---|
| Control flow **fully editable** | §3.5, §4.5, §4.10 | `IfNode`/`RandomNode` render as editable nested `BlockList`s; the two new patch pieces are branch-insert anchors (§4.5) and branch add/remove (§4.10); degraded (raw/orphan) conditionals stay read-only. |
| Inserts **match surrounding style** | §4.3 | `inferBlockStyle` reads indent/EOL/one-per-line from neighbours; no fixed house style; empty-container fallback = parent indent + detected step. |
| **All** supported attributes shown | §3.3 | Rows from `def.attributes[]` in def order; absent rows are faint & byte-free until acted on; **any name present 2+ times → list, flag or no flag** (ground-truth rule — `repeatable` has zero occurrences in the data); flags → checkbox = presence; `default` lives on `ArgumentDef` and is absent for ~74% of arguments. |
| **Card selection → Add inserts after it** (post-3.4) | §3.9, §4.1, §4.5 | Single-select, offset-anchored like expansion, cleared on tab switch and on delete. Add resolves to `{ after: Item }` when something is selected, else section-append. Reinstates the `{ after: Item }` target rev 3 dropped for having no consumer. |
| **Sticky section header** (post-3.4) | §3.2 | `position: sticky` on the header row (Add + badges + Hide Unused). Presentational only. |
| **Diagnostics overview ruler** (post-3.4) | §3.10 | Maps over **rendered card positions, not source offsets** — cards are variable-height and resize at runtime. Needs DOM measurement (the only place in Breakdown that does). Sequence last. |
| **"Hide Unused"** switch (post-rev-2) | §3.1, §3.3.1 | View-level toggle in the section row; hides only rows with **no bytes in the source** (absent attributes + unchecked flags). Never hides present-but-valueless attributes, "Other contents", or positional args. Default off, persisted; shows a "N unused hidden" count. |
| (all) Code is source of truth | §1, §2 | No parallel model; every action is a `TextEdit`; UI is a pure function of the AST; ephemeral state anchored to offsets (§6.3). |

## Appendix B: what this spec inherits from the parser (do not re-derive)

- **Exact spans + retained source** (parser goal #2) → every edit is a span replace/insert; no re-printing.
- **Coverage + well-nestedness** (parser §12) → the block/card tree is well-nested; deletes/inserts over a span can't corrupt a sibling.
- **Comment/trivia ownership** (parser §"Comment handling") → the §4.6 whitespace rules stop at comments so they survive byte-identical.
- **RawNode/OrphanBlockNode degradation** (parser §5.3/§5.4) → the read-only raw/shared cards; the honest boundary of fully-editable.
- **`repeatable` *semantics*** (parser §8) → cumulative attributes must never be collapsed to one. Note we inherit the **semantics, not the data**: the flag has zero occurrences today, which is exactly why §3.3 derives the list UI from the AST (presence in source) rather than from the flag.
- **Diagnostics with spans** (parser §10) → row/card problem badges reuse them, no separate Breakdown validation.
- **Symbols/includes** (parser §7) → the `otherConstant` combobox pulls user `#define`s; include-present relaxes constant validation.

## Appendix D: rev 3 changelog

From the second critique, every claim of which was re-verified before adoption (`.gitignore` lines 26–36, AD4 Pag lines 686–690/734, `parser.ts`'s unknown-name paths). **Majors:** (1) §10's corpus reality corrected — `.gitignore:27` (`test-maps/*` + selective negations) leaves only **13 committed** map files, and both rev-2 specimen maps were untracked; specimens replaced with committed `AD4 - Pag - v1.2.rms` throughout (§0.1 P1, §10), CI-corpus count stated plainly, `local/` count refreshed (24). (2) §3.3's unknown-name model rewritten to match the parser: def-less `CommandNode`s exist only via the unknown-run-upgrade (word + `{`); bare unknown names are `RawNode`s — so the editable-card promise is scoped to block-attached unknowns, and the common bare-typo path gets a **raw-card did-you-mean quick-fix** (new 3.4 work) backed by a new structured `Diagnostic.suggestion` field (§7 item 10 — parsing message prose is not acceptable). §3.3(c) also rewritten: known-but-unlisted attributes arrive fully resolved with **no** diagnostic → normal typed rows, no badge (a badge would be Breakdown-invented validation, which §5 forbids). (3) §4.8 clause 4 scoped: delete intents legitimately remove trivia **inside** the deleted range (AD4 Pag line 734 is the live specimen); all other trivia must survive — the absolute form failed every correct delete of a commented construct. §4.6's slogan given the same precision.

**Moderates:** clause 3 decomposed into the always-present **ancestor chain** (span-stretched, otherwise unchanged — stated generically once) + the per-intent target set, since every ancestor straddles by definition and rev 2's per-intent examples couldn't describe that; `addAttribute`/`toggleFlag` intents re-targeted to `AttributeTarget = BlockNode | CommandNode` (the brace-synthesis case had no `BlockNode` to carry — same defect shape as rev 1's `BranchRef`); `validate()` added to §0.1's prerequisite table as graceful-degradation with both dependent notes (§3.2 picker warning, §3.3 last-one-wins) explicitly deferred until it exists; §4.8 seeding re-pinned **per-file** (filename-derived, reset per file) so dev-vs-CI corpus differences can't desync intent generation — reproduction is `(file, iteration)`.

**Minors:** §4.5 formulas explicitly show the own-lines case with §4.3's `onOwnLines` governing; duplicate bare flags → the ground-truth list wins over the checkbox (checkbox only at 0/1 instances); §4.10 gains the symmetric last-`percent_chance`-branch rule (offer delete-whole-random); §4.11 focus split by trigger (explicit action/Enter → caret refocus; blur → never refocus); §3.1 Header-tab badge defined over preamble-item span union; clause 5's impossible worked example ("out-of-range" is a warning) replaced with the honest statement that new errors are comparator failures until proven otherwise; `InsertTarget`'s consumer-less `{ after: Item }` variant dropped (drag-reorder re-adds it with its consumer in v1.x). **In passing (fixed in code, not just spec):** `corpus.test.ts`'s allowlist and benchmark still referenced the old `Vanguard_v1.2.rms` filename after the rename to `AK_Vanguard_v1.2.rms` — the benchmark map had silently dropped out of both the zero-error gate and the benchmark; both references fixed.

## Appendix C: rev 2 changelog

From a full critique of rev 1, with every empirical claim re-verified against `reference/data/language.json`, `src/parser/types.ts`, `src/parser/__tests__/testUtils.ts`, and the corpus before adoption.

**Reference-data prerequisites rev 1 assumed were satisfied (new §0.1, §7 split into blocking/graceful).** Verified zero occurrences of `repeatable`, `maxRepeats`, `nonFunctional`, `predefinedLabels`, `sectionLabels`; the `#ifdef`/`#ifndef`/`#else`/`#endif` entries parser-design §13 ordered removed are still live in `directives[]`; argument `default` coverage is 34/132 (25.8%), not the near-complete coverage §0.3 implied. Consequences fixed: (a) **§3.3 ground-truth rule** — duplicate present instances render as a list **regardless of the `repeatable` flag**, which only governs whether "add another" is offered; rev 1 keyed the list off the flag, so with zero flags the natural implementation would bind one row to the first instance and silently orphan the rest (corpus exposure: 35 `replace_terrain`s in `Rage Forest 2026.rms`, 3 consecutive in one block in `24hr_Bazi is God.rms`) — invisible in Breakdown and one edit from the collapse parser §8 forbids; (b) `#ifdef`-family suppression mandated in 3.2 until the data is cleaned, since the picker would otherwise offer beginners phantom directives with no warning badge (`nonFunctional`, which drives §3.6's badge, does not exist); (c) §0.3 restated honestly about defaults, and §3.3's no-default path specified as the common case rather than the exception.

**Patch-engine under-specification (§4.1, §4.4, §4.5, §4.6, §4.8, new §4.11).** `InsertTarget`'s branch variant was unresolvable: `IfBranch`/`RandomBranch` are plain interfaces with no span, parent pointer, or index, yet §4.5 required `branches[i+1].keyword` using an `i` no intent carried — replaced with `BranchRef { parent, index }`, applied to `setCondition`/`setChance`/`removeBranch` too. `computeEdit`'s return pinned to `EditResult { edit, caret }` (rev 1's §4.1 said one `TextEdit`, §6.3 said it also returns a caret offset). Optional `condition`/`chance` handled — both are `?` in `types.ts` and reachable in malformed-but-parsed code, where rev 1's replace-the-span rule had no span to replace; now an insert-after-keyword. The `string` argument type de-overloaded: `#const`/`#define` names are also `type: "string"`, so rev 1's "re-add quotes if the original was quoted" would have emitted `#const "NAME"` — quoting now applies to filename args only, resolved via the `DirectiveNode.hash` → `IncludeInfo.directiveToken` hop (`ArgNode` has no `quoted` field), with a `path` type filed as the cleaner fix. §4.6's delete rule was garbled ("nothing but whitespace precedes it on the line after the node") and permitted an asymmetric extension stranding a comment at column 0 — rewritten as two all-or-nothing modes (whole-line vs surgical). New §4.11 specifies commit-on-blur/Enter/Escape semantics, which rev 1 asserted in §3.4 and specified nowhere (cross-referencing §4.7, the *delete* section).

**§4.8, the acceptance criterion, made implementable.** Rev 1's "differs in exactly the intended way and no other" has no operational meaning — every insert shifts spans downstream, so a literal structural diff fails on correct edits. Now formal: shift `Δ`, pre-/post-/straddling node partition, an explicit **shift-equal** node-equality definition, five numbered clauses, and per-intent expectations. Corrected the claim that the harness "reuses parser §12's checkers" — `testUtils.ts` exports only `loadLanguage`/`collectNodes`/`checkProperties(result)`, all single-`ParseResult` validators covering clause 5 alone; the **shift-aware AST comparator is new work**, now scoped as `astDiff.ts` and budgeted as a real 3.3 component. Added determinism the parser's fuzz suite already has and rev 1 lacked: seeded `mulberry32`, fixed N-intents-per-file, sorted iteration, failure reproducible from `(file, seed, iteration)`.

**§6.2 one-parse contradiction resolved.** Rev 1 introduced `useParsedDocument` as "the single parse" and then pinned worker-plus-main-thread (two parses). This had teeth: `resourceTotals` is computed in the worker today, so it was unstated which parse feeds `StatusBar` while §6.5 promised its props were unchanged, and the declared return dropped `source`, which `CodePane.tsx:72` uses as its marker-staleness guard. Pinned to **one parse in the existing worker**, returning the full `ParseResult`; hook returns `{ source, parseResult, diagnostics, resourceTotals }`; AST-payload cost handled as a measured trigger (`wantAst` flag) rather than an open question.

**Smaller.** §3.1's problem badge redefined over the **union of disjoint** section ranges (aggregating tabs cover several ranges with unrelated code between). `default` corrected to live on `ArgumentDef`, not `AttributeDef` (§3.3 was the sentence an implementer would code from). Cross-references fixed: §0.3 →§3.3 (twice, was §3.4), §3.3(a) →§3.4 (was §3.8), §3.4's commit-on-blur →§4.11 (was §4.7). Test-plan corpus scoping corrected — **`test-maps/local/` does exist** (19 files) but is **gitignored** (`.gitignore:26`) and so absent in CI, and `test-maps/broken/` does not exist at all; both are now opportunistic with a directory-exists check, and no test hard-depends on either. (The critique stated neither directory exists; `local/` does — the operative problem is availability in CI, not existence.) Unit-test list extended with one fixture per fixed defect.

**Unchanged from rev 1** (re-affirmed by the critique): the §2 core loop and the code-is-source-of-truth spine; §3.5's argument that fully-editable conditionals fall out of the span model, localizing new work to insert anchors and branch add/remove; §3.7 + §3.3(c) delivering real total coverage; §6.3's offset anchoring; §6.4's pinned-recommendation-plus-named-spike-plus-fallback handling of the Monaco model migration; Appendix B.
```
