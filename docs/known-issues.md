# Known issues — Age of RMS

Open bugs with diagnosis and prescribed fix. One `##` section per bug. Move an entry to `docs/build-log.md` (as part of the session entry that fixed it) once it's closed — don't leave stale "fixed" entries here.

Entry format: symptom → reproduction → root cause (with file:line) → prescribed fix → verification.

---

## BUG-001 — Breakdown card expansion jumps to the wrong card after a delete, then corrects itself

**Status:** open. **Found:** Ash, live-testing 3.4. **Area:** `src/breakdown/BreakdownPane.tsx`, `src/useParsedDocument.ts`.

### Symptom

Expand a command card, then delete a *different* card above it. For a moment the wrong card renders expanded and the correct one collapses; after a brief pause the list shifts and the correct card is expanded again.

### Reproduction

1. Open a map with 12+ commands in one section.
2. Expand the card at position 12.
3. Delete the card at position 5.
4. Observe: card 11 renders expanded and card 12 collapses; ~150ms later the list shifts up (12 → 11) and the right card is expanded.

### Root cause — a sequencing bug, not a keying bug

Two pieces of state that must change together change at different times:

- **`expandedAnchors` shifts synchronously.** `BreakdownPane.tsx:103`, inside `applyEdit`:
  ```ts
  setExpandedAnchors((prev) => shiftAnchors(prev, result.edit));
  ```
  This runs in the same tick as the edit, so anchors immediately hold **post-edit** offsets.
- **`parseResult` updates much later.** `useParsedDocument` debounces `DEBOUNCE_MS = 150` (`src/useParsedDocument.ts:15`, `:80-92`) and then round-trips the parser worker. Until that response lands, the tree still renders the **pre-edit** AST with pre-edit spans.

So for ~150ms plus the worker round-trip, the UI renders **new anchors against old spans**. A delete has negative Δ (`newText.length - (end - start)`), so `shiftAnchors` moves every anchor after the edit *backward*. In the old AST those backward-shifted offsets land inside the **preceding** card's span — which is why expansion appears to jump one card up, and why the direction is always "one earlier", never later.

**Offset anchoring itself is correct — do not replace it with a per-card boolean.** The AST is fully re-derived on every parse, so nodes have no stable identity. A boolean would have to be keyed by something, and every alternative is worse: keyed by **index** it breaks permanently on any insert/delete (expansion lands on the wrong command and stays there); keyed by **node object** it is lost on every reparse (all cards collapse on every keystroke). Offsets are the design (breakdown-design.md §6.3) and they are right. Fix the sequencing, not the keying.

### Prescribed fix (two parts — do both)

**Part A — consistency (removes the glitch).** Maintain the invariant: *anchors are always expressed in the coordinate space of the currently-rendered `parseResult`.* Rather than shifting eagerly, queue the edit and apply the shift when the parse for that exact source arrives.

- `useParsedDocument` already correlates responses to their source (`sourceByRequestIdRef`, and it returns `source` on the state), so the pane can tell when the rendered `parseResult` corresponds to the post-edit text.
- Suggested shape: hold pending edits in a ref (`pendingEditsRef: OffsetEdit[]`) alongside the source they patched *to*; in an effect keyed on `parseResult`, if the new `parseResult.source` matches that post-edit text, apply the queued `shiftAnchors` calls in order and clear the queue.
- During the in-between window you then have **old anchors against the old AST — self-consistent** — so the expanded card simply stays expanded and both flip in the same commit. No visible jump.
- Note the same reasoning applies to any other offset-anchored ephemeral state added later (§6.3 lists focus/selection); solve it once, generically, rather than per-feature. `pendingFocusRef` (`BreakdownPane.tsx:56`) is already correctly deferred — it resolves in an effect keyed on `parseResult` — so Part A brings expansion in line with how focus already works.

**Part B — latency (removes the pause).** Skip the 150ms debounce for **programmatic** patches. The debounce exists to avoid reparsing on every keystroke; a Breakdown card action is a single discrete event, so there is nothing to coalesce. Give `useParsedDocument` a way to request an immediate parse (e.g. an exported `reparseNow()`, or a flag on the applied edit), leaving typing-driven reparses debounced as they are. The window then shrinks to just the worker round-trip (low single-digit ms on typical maps).

Part A alone fixes correctness; Part B alone does not (it only narrows the window). Part B is what makes deletes feel instant.

### Verification

- Manual: the reproduction above shows no intermediate wrong-card state at any point.
- Manual: same check for **insert** (add a command above an expanded card — positive Δ, so the naive bug would jump the other way) and for an edit *inside* an expanded card (it must stay expanded and keep focus).
- Unit: `shiftAnchors` already has plain-logic tests (`ephemeralAnchors.ts` is React-free by design) — add a case asserting the queue-then-apply ordering if the fix introduces a helper worth testing directly.
- Regression: `npm test`, `npm run typecheck`.

---

## BUG-002 — Three remaining causes of false RMS0202 warnings (corpus-measured)

**Status:** open — **(a) FIXED**, (b) and (c) remain. **Found:** while fixing Ash's `#const`-in-numeric-slot report (parser-design §6 amendment — that fix is done and is *not* what this entry is about). **Area:** `reference/data/language.json`, `src/parser/parser.ts`.

After the §6 amendment the 52-file corpus emitted **238 RMS0202 warnings + 75 info**. Fixing (a) below brought that to **61 warnings + 45 info**, confined to just 3 files. They were never one bug — measured causes:

### (a) `#const X ANOTHER_CONSTANT` aliasing — **FIXED**

`#const`'s `value` argument was typed `integer` in `language.json`, so aliasing one constant to another warned:

```
#const PREDATOR_A WOLF
#const BASE_FOREST DLC_DRAGONFOREST
```

Ash called this correct-and-legal from memory, and the guide confirms it outright: **L3295** "Everything in the game is represented internally by a numeric identifier"; **L3353** "Pre-defined constants will be interpreted as numbers if inside the parentheses, **or if used where numeric inputs are expected**"; **L3306** "Items can have multiple constants assigned to them". So `#const PREDATOR_A WOLF` is identical to `#const PREDATOR_A 3` when WOLF is 3.

**Fix:** `#const`'s `value` type `integer` → `otherConstant`, which accepts word **or** number (parser-design §6). The risk flagged earlier — that retyping would break expression assembly — **did not materialise**: assembly is triggered by a leading `(` in `consumeOneArg` (`parser.ts:906`) and is *not* gated on argument type, and the `rnd`/number branches are likewise ungated. All seven `#const` value forms verified clean (number, alias, expression, rnd, float, the `inf` flooring idiom, and downstream use), with the AD4 expression fixture asserted explicitly. **Corpus effect: 238 → 61 warnings.** `Rage Forest 2026.rms` went from 155 warnings to 0.

### (b) Undefined words used deliberately as opaque identifiers

`AK_Vanguard_v1.2.rms` uses `actor_area ACT_AREA_TEAM_RES_TERRAIN` **26 times**; the name is never defined and the file has no includes — yet it is a working, shipped map. Per §2.1 the engine resolves any word to an internal integer token ID, so an undefined name used *consistently* across an `actor_area` / `actor_area_to_place_in` pair works perfectly: both sides resolve to the same ID. The author is using the name as a self-documenting opaque handle.

This exposes a real gap in the reference data's type vocabulary: **`integer` currently conflates "a magnitude" with "an identifier".** An arbitrary token ID is fine for `actor_area` and garbage for `clumping_factor`, so the distinction is per-attribute, not per-type. *Likely fix:* a new argument type (`identifier`?) that accepts bare words silently, applied to the actor-area family. Needs a decision from Ash + a sweep of which attributes are identifier-like.

### (c) Unmodeled `$`-prefixed names

Two files, **35 of the 61 remaining warnings**: `test-maps/local/Acclivity.rms` (DE-official) uses `$SpawnAvoidance`/`$heightLow`/`$heightHigh` (25), and `test-maps/TL Team Acropolis.rms` (community) uses `$infinite` (10). That it appears in both an official *and* a community map is strong evidence it is fully supported syntax rather than an author quirk. `$` is not modeled anywhere in the parser or reference data. Probably a DE script-parameter/templating feature. **Research needed** (guide + patch notes) before deciding whether to lex, resolve, or simply exempt these. Note this is a *DE-official* map, so whatever it is, it is fully supported syntax.

### Verification for the remaining two

`npm test` (parser suites), plus re-measure the corpus RMS0202 counts before/after — a scratch script parsing every `test-maps/**/*.rms` and bucketing by code and severity is the quickest instrument. **Current baseline to beat: 61 warnings + 45 info across 52 files**, being 26 from (b) in AK_Vanguard and 35 from (c) in Acclivity + TL Team Acropolis. Zero from any other file.
