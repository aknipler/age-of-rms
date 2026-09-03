# Advanced Land Placement — Design (rev 3)

**Status: proposal, nothing implemented.** Rev 1 and rev 2 were written 2026-08-29 against
the tree as it stood that day; rev 3 was measured against the same tree on 2026-08-29 and
supersedes both. `docs/tools-api-design.md` Sec.10.2's standing instruction applies — re-derive
before acting.

**Rev 2 settled its eight open questions by argument. Rev 3 ran six things instead.** The units
decision, the importer over the three corpus maps that carry the idiom, the generation-cost
re-derivation, `Expr`, a test plan, and `tsc` over the document's own code. **Five of the six
moved a conclusion**, and two of those five ran the way this repo's Hard rules predict — a
number re-cited rather than re-measured, and a claim about a *type* that no probe was ever
going to reach.

| | Change |
|---|---|
| Sec.5.0 | **New. `Expr` is defined.** Rev 2 used it fourteen times and never wrote it down; `tsc` says so in three seconds (Sec.11). The type it needs has an arm rev 2's model had no room for, and deliberately has no `rnd` arm. |
| Sec.5.3 | **Two amendments, both found by running the emit.** Re-association of a uniform `+`/`*` spine, and integer constant folding. Without them the compiler spills 14 unnecessary `#const`s on Bulls_Eyes; with them it reproduces the hand-written block **104 of 104 lines byte-identical**. Sec.2's acceptance bar is now met rather than asserted (Sec.10.1). |
| Sec.4.2 | The `INBOUND_n` row of the table is **a derivation, not an emission**. It never needs a `#const` of its own. |
| Sec.4.3 | **Rewritten on measurement.** Percent is right and integer-percent snapping is wrong; the reachable map sizes, the corpus's own lattice, and the angular error budget are all measured. `land_position`'s declared range is `[0, 99]`, not `[0, 100]`. |
| Sec.6.4 | **Reversed, in both directions.** Recognition must run backwards from `land_position`, not forwards from the macro shape — and once it does, Venn's "varied idiom" adopts cleanly (8/8, compound radius included). The map the importer actually cannot read is `Rage Forest 2026.rms`, and the reason is not the trigonometry. |
| Sec.7.2 | **Perf re-derived.** Rev 2 cited a median this repo had already superseded by 1.7×, from the file that warns against exactly that. The land-generation cut is worth **8×**, not the uniform saving the two-tier argument assumed, and the map it saves least on is the shape this tool serves. |
| Sec.9 | New. The **preconditions** a script must meet before this tool can see it at all. |
| Sec.10 | **New. The test plan** — three gates and two permanent reporters, replacing rev 3's throwaway probes. |
| Sec.11 | **New. The `tsc` pass**, and what it found. |
| Sec.3.6 | **New. The panel lifecycle**, written from `host.ts` and `ToolsPane.tsx`. A panel takes no snapshot and cannot go stale; its model has to be lifted above `activeTab` or a tab switch destroys it. |
| Sec.3.8 | **New. The handle lifecycle.** One live result per tool, so a leak is unrepresentable; 682 KB worst case. Found two things Sec.11's own sketch assumed and `generatePreview` does not have. |
| Sec.3.7 | **New. The overlay budget.** `mapOverlay` is one block holding N shapes, the way `table` is one block holding N rows — the alternative is the 1026-blocks-against-1000 failure the checker already shipped. |
| Sec.3.4 | One measured correction: the Ludicrous figure describes a size this app cannot select. |
| Sec.4.4, 6.4 | **Swept the DE install** (211 official scripts + 81 `.inc`). **Zero** of 10,226 official `land_position` uses computes anything — the idiom is community-only, which reprioritises the importer below the authoring path. And rev 2 overstated the `rnd` hoisting rule: `rnd` as a whole *argument* is legal and official maps use it 5,222 times, so hoisting is a choice the panel makes, not a constraint the language imposes. |

Worked examples come from `test-maps/Bulls_Eyes.rms`, `test-maps/Venn.rms` and
`test-maps/Rage Forest 2026.rms` — **the complete set of corpus maps that use the
trigonometry idiom**, established by one grep for `40500` and not assumed. Bulls_Eyes places
8 lands and spends **158 `#const` lines** doing it, of which **104 are the placement block**
this tool regenerates: 13 lines per land, of which **10 are the same trigonometry macro
copied with a different suffix and 1 is the angle the author actually chose.** Eight useful
numbers, 104 lines. That ratio is the problem this tool exists to delete, and rev 3 confirmed
both halves of it by regenerating the block (Sec.10.1).

---

## 1. What was asked for, and the short answer

Four asks:

1. Chain a land to another land (or to map centre) so it keeps its position *relative to the
   parent*, and moves when the parent moves.
2. Drop lands in standard shapes — circle, square, triangle, …
3. Write a custom formula in `x`, `y`, arithmetic and `SIN`/`COS`, and have the app turn it
   into RMS-legal left-associative maths.
4. Two ways to drive all of it: text/number fields on the right, direct manipulation on a
   live preview on the left, the preview cut at the end of land generation.

Five answers up front, because the rest of this document is their consequences:

1. **This is not an Advanced Tool under the v1 contract, and pretending otherwise costs more
   than admitting it.** `docs/tools-api-design.md` line 31 names "tool-defined interactive UI"
   as an explicit v1 non-goal. It needs a new tier: a **panel tool** (Sec.3) — and that tier
   is built for the community rather than for this one tool, which is what Sec.3.4's four
   layers are. Most of "an interactive map tool" turns out to be expressible declaratively,
   over plain JSON, with no webview and no sandbox.
2. **The tool owns a fenced region of the script and regenerates it wholesale.** It does not
   read back hand-written trigonometry as its primary path. Sec.6.
3. **The formula compiler emits SSA, not one expression.** A DAG of single-assignment
   `#const`s, each one flat left-associative chain. There is no clever inlining to find,
   and the emit rule is exact rather than heuristic. Sec.5. **Rev 3 ran it: the rule as rev 2
   stated it is sound and incomplete**, and the two missing pieces cost 14 spurious `#const`s
   on the one map this design cites as its acceptance bar. Sec.5.3, Sec.10.1.
4. **Every emit is verified against the app's own RMS evaluator before it is offered.**
   `evaluateExpressionTokens` (`src/preview/generator/mathEval.ts`) is a near-exact model of
   engine evaluation. The compiler round-trips its own output through it and refuses to emit
   on disagreement. This is what makes "clever" trustworthy instead of hopeful. Sec.5.5 —
   with the caveat in answer 5, which is the whole reason "near-exact" is hedged.
5. **`%` casts both operands to int, and that one fact rewrote two sections.** It makes `%`
   the language's only rounding operator, makes the SIN macro **self-guarding for any input**
   (deleting rev 1's central "integer trap"), and exposed a real bug in `mathEval.ts`'s
   `mod()` that was upstream of answer 4. Sec.5.1 and Sec.5.4. **The fix has landed and rev 3
   re-verified the property it licenses**: 4,000 fractional angles through the macro, `S`
   is ±1 on every one (Sec.5.4).

And one answer rev 2 did not have, because it comes from running the tool's own reader over
the corpus rather than from reading the maps:

6. **A script the parser degrades to a `RawNode` is invisible to this tool, and one of the
   three trigonometry maps is 70.9% `RawNode` with zero parser errors.** That is not a defect
   in the parser and not one in this tool; it is a precondition, and it has to be stated in
   the UI rather than discovered. Sec.9.

---

## 2. Goals and non-goals

**Goals**

1. Rebuild Bulls_Eyes' land layout in the tool, generate its `#const` block, and have the
   generated block produce the same land positions as the hand-written one. That is the
   acceptance bar; it is a corpus map, not a fixture. **Rev 3 ran it: 104 of 104 emitted
   lines byte-identical, 8 of 8 lands on the same tile, and it took two amendments to
   Sec.5.3 to get there (Sec.10.1).**
2. Dragging a parent land moves its whole subtree, on canvas, at interactive frame rates.
3. A formula the user types in ordinary infix notation produces RMS the engine reads the
   same way the user meant it — or an error saying it cannot.
4. Everything the tool did not write is byte-identical afterwards.
5. A script the tool has touched is still an ordinary `.rms`. No sidecar, no new extension,
   no import step required to open it in anything else.

**Non-goals (v1)**

- Reading arbitrary hand-written trigonometry back into the model. There is an importer, it
  is best-effort, and it asks before it adopts anything (Sec.6.4). **Measured, "best-effort"
  is less hedged than rev 2 assumed on the two maps it can read (8/8 and 8/8) and completely
  hedged on the third, for a reason that has nothing to do with trigonometry (Sec.9 P1).**
- Managing lands the parser cannot see. A script the parser degrades to a `RawNode` is
  outside this tool's reach entirely, and saying so is Sec.9's job rather than a silent
  limitation.
- Owning anything about a land except its `land_position`. Terrain, size, zone, elevation and
  `assign_to` stay Breakdown's (Sec.6.2).
- Math beyond `+ - * / %`, `SIN`, `COS`, `rnd`. The expansion slot is designed for; `TAN`,
  `SQRT`, `ATAN2` are later and each needs its own left-associative derivation.
- External (v1.1) tools rendering panels. Panel tools are built-in only, and Sec.3 says why
  that restriction is load-bearing rather than temporary.
- Elevation, connections, or anything after `<LAND_GENERATION>`.

---

## 3. Where it lives: the panel-tool tier

### 3.1 The contract genuinely cannot express this

`ToolOutput.blocks` is `heading | text | keyValue | table | severity | codeRef`, and the
comment on it reads *"Declarative display — the pane renders these; tools render nothing."*
There is no canvas, no pointer event, no persistent state between messages. `tools-api-design.md`
line 31 lists interactive UI as a v1 non-goal pointing at "the future webview tier".

So there are three honest options and one dishonest one:

| Option | Verdict |
|---|---|
| Add a `canvas` / `html` block kind | **No.** That *is* the webview tier, with its whole trust and sandboxing story, arrived at sideways to get one first-party feature shipped. |
| A fourth top-level tab | **No.** It reads source, reads the AST, reads generation settings and writes edits — it is a tool by every property except how it draws. A tab would fork the capability model and the Apply path. |
| A **panel tool**: a built-in that owns the pane's body | **Yes.** Sec.3.2. |
| Call it a report tool and smuggle state through params | Dishonest, and it does not work — params are a submit-once form, not live state. |

### 3.2 What a panel tool is

**An excerpt of the existing declaration, not a second one.** The member goes into
`ToolManifest` where it already lives; a second `export interface ToolManifest` in the same
module is declaration merging, compiles silently, and is how a published contract type ends
up declared in two places (Sec.11).

```ts
// tools-api/index.ts — ToolManifest gains one member
export interface ToolManifest {
  // … existing members unchanged …
  /**
   * "report" (default) — the tool emits ToolOutput blocks and the host renders them.
   *   The only kind an external (v1.1) tool may declare.
   * "panel" — the tool renders the pane body itself. BUILT-IN ONLY; the registry
   *   rejects a "panel" manifest arriving over the external transport, because a
   *   panel is app code and app code cannot come off the wire without the webview
   *   tier's sandbox. The restriction is the security boundary, not a stub.
   */
  surface?: "report" | "panel";
}
```

Three things a panel tool keeps, and one it must not:

- **Keeps** the capability declaration. Land Placement declares `read-source`, `read-ast`,
  `read-generation-settings`, `read-reference`, `edit-source`, and a new
  `read-preview-view` (Sec.3.3).
- **Keeps** the context builder. Same `ToolContext<ParseResult>` the report tools get, from
  the same code path, so `previewBridge.ts` still watches the seam it exists to watch.
- **Keeps** the Apply path — `TextEdit[]` through `useDocument.applyTextEdits`, and the
  `edit-source` enforcement in `host.ts` still gates it.
- **Does not go through `ToolHost.start()`.** This needs saying loudly because it is the
  obvious wrong move. `ToolHost` models a one-shot compute: one run app-wide, a progress
  stream, a 60 s silence watchdog, a cancel grace, a terminal message. A panel is *live* —
  it recomputes on every pointer move and never terminates until the user leaves the tab.
  Forcing it through the host means either a watchdog that fires on an idle panel or a
  watchdog disabled for one tool, and the second is the first with extra steps. Panel tools
  get a mount/unmount lifecycle instead, and `isBusy()` treats a mounted panel as holding
  the run slot so a report tool cannot start underneath it. **Sec.3.6 is that lifecycle,
  written out** — rev 2 stopped at this sentence, and the reframe that makes it small is
  that a panel is long-lived while its *work* is not: every `generate` it asks for is one
  bounded computation, which is exactly what `DEADLINES` already bounds.

### 3.3 `read-preview-view`, and why it has to be real

`ToolContext`'s own doc calls out what it deliberately withholds:

> Deliberately absent: file paths, fs access, the preview pane's seed, and the Current/Final
> cut point. The last two are view state; a tool that must reproduce the pane exactly is a
> `read-preview-view` escalation, not a silent widening of `read-generation-settings`.

That escalation is now owed. This tool needs the seed for a reason stronger than fidelity:
**with `rnd()` in the script, an unpinned seed makes dragging impossible.** Bulls_Eyes'
`ROTATION_PLAYER` is `rnd(-10000,10000)`; regenerate between two frames of a drag and every
land jumps. So the panel pins a seed on mount, shows it, and offers a visible re-roll — the
same contract the preview pane already has with the user.

The capability carries `{ seed: number; cutOffset: number | null }` and is **read-only**.
Rev 1 gave the panel a write half so it could force the cut to the end of
`<LAND_GENERATION>`; Sec.3.4 removes the need, because `cutOffset` is a parameter of the
layer-1 `generate` request. Reading the pane's cut and choosing your own are different
needs, and only the first belongs in a capability (Sec.7.1).

### 3.4 Built for reuse (**resolved 2026-08-29**): four layers, three of them now

Rev 1 recommended keeping the panel tier narrow until a second tenant appeared. **Overruled:
build it for the community.** That changes the design, and the useful move is to notice that
"let community tools do what Land Placement does" is *not one capability*. It is four, they
have wildly different costs, and three of them are cheap enough to ship now and benefit
every existing tool.

| Layer | What a tool can do | Transport | Cost |
|---|---|---|---|
| **1. `run-preview`** | Ask the host to generate and read the result | **Any**, external included | Small |
| **2. `mapOverlay` block** | Draw on the preview canvas declaratively | **Any**, external included | Small |
| **3. `overlayEvent`** | Receive clicks and drags back from the canvas | **Any**, external included | Medium |
| **4. Declarative forms** | A full editing panel (trees, formula fields) | Any | **Large — deferred** |

#### Layer 1 — the preview becomes a service, not an import

Today `consistencyChecker` imports `generatePreview` directly, and `registry.ts` says in
as many words that this "is what makes it inexpressible as an external tool until that
generator is a standalone library." **Layer 1 removes that sentence** without making the
generator standalone: the tool *asks*, the host *runs*.

```ts
type ToolToHost =
  | { type: "generate"; settings?: { playerCount?: number }; seed?: number; cutOffset?: number }
  | { type: "sliceRequest"; handle: string; rect: { x: number; y: number; w: number; h: number } }
  | { type: "release"; handle: string };

type HostToTool =
  | { type: "generated"; handle: string; summary: PreviewSummary }   // Sec.11
  | { type: "previewSlice"; handle: string; rect: { x: number; y: number; w: number; h: number };
      terrain: number[]; elevation: number[] }
  | { type: "generateFailed"; reason: string };
```

**The result is a handle plus a summary, never the whole grid.** ⚠ **Rev 2 priced this at
Ludicrous, 480×480 = 230,400 tiles. The app cannot generate that map.** `MAP_SIZES`
(`generationSettingsConstants.ts`) tops out at **Giant, 252×252 = 63,504 tiles**;
`language.json` carries `MAPSIZE_LUDICROUS` at 480 with no `mapSize` mapping, so the settings
pane cannot select it and `resolveMapDim` never returns it. The correct worst case is 63,504
tiles, **3.6× smaller than the number the argument was made on** — and `override_map_size`
clamps to 480, so a script can reach it even though the lobby cannot, which is why the arm
survives at all. It still exceeds an 8 MB inbound line cap per generation on every run of a
Monte Carlo loop that does this sixty times, so the conclusion stands on the smaller number.
**It is quoted here at the size the app can actually produce**, because a bound justified by
an unreachable case is the same mistake as a budget quoted at one map size. So the host retains the
`PreviewResult` and the tool queries it — land origins, per-land placement outcomes and
failure buckets, notes, and explicit slice requests for tile rects or a land's tiles. That
is a deeper interface than shipping the grid *and* it is the cheaper one, which is the
usual sign it is the right one.

In-process built-ins get the same API backed by the live object with zero copy. One
contract, two costs — the principle `tools-api-design.md` Sec.1 already runs on.

**This layer pays for itself immediately, independent of Land Placement.** The consistency
checker and balance summary both become expressible as external tools, so the first
community tool author has two worked examples to read instead of zero.

#### Layer 2 — declarative overlays, which is most of "an interactive map tool"

A new `OutputBlock`:

```ts
// OutputBlock gains one arm; OverlayShape is Sec.11.
type OutputBlockV2 = OutputBlock | { kind: "mapOverlay"; shapes: OverlayShape[]; interactive?: boolean };
```

where `OverlayShape` is points, circles, lines, polylines, labels and handles in **tile
coordinates**, with a colour role rather than a hex value so it themes with the app.

**Amended 2026-08-31 (slice 4b), now that §1 is answered.** This sentence originally read
"the host renders them on the existing `PreviewCanvas` through `projection.ts`" — true of
neither surface as built. §1.1 chose (a): the projection/viewport/hit-test core was
extracted into a new, shared `OverlayCanvas` (`src/components/preview/OverlayCanvas.tsx`),
parameterised on `dim` rather than a `StageSnapshot`. `PreviewCanvas` is now a thin wrapper
over it supplying the document's own `usePreviewViewport()` context and no overlay shapes of
its own; the Land Placement panel renders the same `OverlayCanvas` with its own local
viewport state and its own `overlayShapes`. `drawPreview.ts`'s `PreviewScene` carries the
full terrain/objects/players/failure-marks layer as an OPTIONAL `base` field for exactly this
reason — a pure overlay canvas with no generation of its own omits it entirely. See
`docs/build-log.md`'s 2026-08-31 "Land Placement Slice 4b" entry, item 2.

This is the disproportionately valuable one. It gives **every tool, including external ones,
over plain JSON, today** the ability to say things on the map that no table can: the
consistency checker highlighting the 3% of runs where a land failed to place; a resource
tool drawing each player's gold within reach; Land Placement's own chain edges and land
circles. No HTML, no JS from tools, no sandbox, no webview — the v1 non-goal is untouched
because the tool still renders nothing. It describes; the host draws.

#### Layer 3 — events back

```ts
// HostToTool gains one arm.
type OverlayEvent = {
  type: "overlayEvent";
  event: "click" | "dragStart" | "drag" | "dragEnd";
  tile: { x: number; y: number };
  shapeId?: string;
  modifiers: ("shift" | "ctrl" | "alt" | "meta")[];
};
```

With layer 3, **"drag a connection between two lands" is expressible declaratively**, by an
external tool, with no HTML anywhere. That is the specific interaction the brief asks for,
and it turns out not to need a webview at all.

It also forces the lifecycle change Sec.3.2 already describes — a tool receiving events is
long-lived, so `ToolHost`'s one-shot run model has to grow a "live" mode regardless of
whether the tenant is built-in or external. Better to find that out now than after the
webview tier is designed on top of the wrong lifecycle.

#### Layer 4 — deferred, deliberately

Land Placement's right-hand panel is a tree with per-node formula fields, live validation
and a diff preview (Sec.8). A declarative vocabulary for *that* is a large design and there
is currently **nothing to derive it from**. Designing it now means designing it from
imagination, one week before having a real example in hand.

So: **layers 1–3 now; Land Placement built as a built-in panel tool that uses layers 1–3
for its canvas and native React for its right panel; layer 4 designed afterwards, from what
the panel actually turned out to need.** The canvas half is community-usable on day one,
which is the half the brief is mostly about; the form half waits for evidence. If the panel
ends up needing only six widget kinds, layer 4 is small and we will know it — and if this
tool never uses a widget we would have speculatively specified, we will know that too.

### 3.5 What this means for Land Placement itself

It becomes the **reference implementation** rather than a one-off: it declares
`run-preview`, emits `mapOverlay` blocks, consumes `overlayEvent`s, and is built-in only
because of layer 4 and the fence-editing in Sec.6 — not because the canvas needed
privileges. If a community author later wants to write a rival placement tool externally,
everything except the right-hand panel is already open to them.

### 3.6 The panel lifecycle (**new in rev 3**)

Rev 2 gave this one sentence — *"panel tools get a mount/unmount lifecycle instead, and
`isBusy()` treats a mounted panel as holding the run slot"* — and it is the largest unwritten
piece in the document. This section is written **from `src/tools/host.ts` and
`src/tools/ToolsPane.tsx`** rather than from rev 2's prose, per the rule that a section
describing a function must be derived from that function.

#### The reframe that makes this small: a panel is long-lived, its *work* is not

Rev 2's argument against `ToolHost.start()` is that a panel "recomputes on every pointer move
and never terminates", so a silence watchdog either fires on an idle panel or gets disabled.
That is right about the panel and **wrong about the work**. Everything a panel actually asks
the host to do is one layer-1 `generate` — a single, synchronous, bounded computation, and
**exactly the quantity `DEADLINES` already bounds**. Split the two and the machinery stops
fighting:

> **The panel has a lifecycle with no timers. Each `generate` request it makes is a one-shot
> job with the existing watchdog and cancel grace.**

So nothing about `ToolHost`'s run machinery changes. It gains a second, parallel slot.

```ts
type PanelPhase = "unmounted" | "mounted" | "suspended";

interface PanelState {
  phase: PanelPhase;
  toolId: string | null;
  /** The file the mounted model belongs to. Mismatch => unmount (below). */
  documentId: string | null;
  /** True when the model differs from what the fence in the document says. */
  dirty: boolean;
  /** At most one in flight; a second request cancels the first. */
  inFlight: { handle: RunnerHandle; requestedAt: number } | null;
}
```

`isBusy()` becomes `runPhase is running|cancelling || panelPhase === "mounted"`, which is the
one line rev 2 promised and the only change to an existing method. `start()` already throws
on `isBusy()`, so a report tool cannot begin underneath a mounted panel without any further
edit.

#### The transitions, and the two that are not obvious

| event | today (run) | panel |
|---|---|---|
| select this tool | `cancel()` → `reset()` → `start()` | reject if `isBusy()`; else mount |
| select another tool | confirm → `cancel()` → `reset()` | confirm **if `dirty`** → unmount |
| `generate` in flight, another requested | n/a | cancel the first, keep the panel |
| tool goes silent mid-`generate` | watchdog → `terminate()` | identical, scoped to the request |
| document edited (Code tab) | run keeps its snapshot; Apply goes stale | **re-derive the fence; model survives** |
| document replaced (File > Open) | `documentReplaced()` → terminate + reset | **unmount, unconditionally** |
| Advanced Tools tab left | — | **suspend** |
| Apply | `applyTextEdits` → `reparseNow` → `reset()` | `applyTextEdits` → `reparseNow`; panel **stays mounted** |

**(a) A document edit does not invalidate a panel, and this is where the run model does not
transfer.** `canApply(currentText)` is `currentText === state.snapshot`, where the snapshot
was taken at `start()`. That is right for a checker: a 30-minute Monte Carlo run cannot be
recomputed, so a stale result must refuse to apply and the user must re-run. **A panel is the
opposite** — its edits are a pure function of the model and the current parse, and
recomputing them costs the 0.173 ms of Sec.7.2. So:

> A panel takes **no snapshot at mount**. It computes its `TextEdit[]` synchronously against
> the current parse at the moment Apply is pressed, and `canApply` compares against *that*
> string. "Stale" is not reachable for a panel, because there is no window between computing
> the edits and applying them.

What a document edit *can* do is move or damage the fence, and that is a separate, real
concern: the fence's span is re-derived on every reparse, and if the text **inside** the
fence changed by hand, the panel says so and offers to re-adopt or overwrite rather than
silently regenerating over the edit. That is the `@alp` analogue of the staleness guard and
it is a content check, not a version check.

**(b) The panel's model must survive a tab switch, and today's pane cannot do it.**
`App.tsx` renders `{activeTab === "advanced-tools" && <ToolsPane … />}`, so the pane
**unmounts on every tab switch**, and `host` is a `useMemo` *inside* `ToolsPane` with no
unmount cleanup. For a report tool that is merely wasteful. For a panel it is data loss: the
model is unsaved user work, and switching to Code to look at something would destroy it.

So the panel's model is lifted above `activeTab`, which is a move `App.tsx` has already made
twice for exactly this reason — its own comment says the preview cut lives there
*"specifically so it survives Breakdown ↔ Code"*. **Suspended** is the state a lifted model
is in while the pane is not rendered: the model is retained, no `generate` is requested, and
**the run slot is released**, because holding it while the user is in another tab would block
every other tool for no benefit. Re-entering the tab resumes and re-requests one generation.

Two things fell out of writing this section, and the first was **fixed on 2026-08-29 rather
than recorded**, because it is a live bug today and not a consequence of this design.

**A tab switch mid-run orphaned the run, and the watchdog could not save it.** Nothing called
`kill()` on unmount, and `armWatchdog` re-arms on every message — a chunking tool like the
consistency checker emits progress per chunk, so the deadline never arrived and a worker-backed
run burned a core for its full 8-30 minutes with its result going nowhere. Rev 3's first draft
of this section prescribed a new `ToolHost.dispose()`; **writing it showed that to be wrong.**
`main.tsx` wraps the app in `React.StrictMode`, which double-invokes effects on mount (setup,
cleanup, setup), so a `dispose()` that marked the host permanently dead would fire its cleanup
once before the pane had done anything and refuse every subsequent run in development.
`reset()` already terminates the active run — it was taught to on 2026-08-19, for the
orphaned-grace-timer bug — and leaves the host usable, which is exactly the semantics an
unmount cleanup needs. The fix is `useEffect(() => () => host.reset(), [host])`, plus moving
the host from `useMemo` to a `useState` lazy initialiser, since React documents a `useMemo`
cache as discardable and this object owns a live Worker. **The lesson is the one this repo
already has about `reset()` not being `terminate()`, arriving from the other side: the
narrower existing method was the right one, and the new method the design reached for first
would have shipped a development-only bug.**

**The second is genuinely contingent and stays recorded.** The confirm on tool-switch should
key on the panel being `dirty`, not on `isBusy()` — but only once a panel exists. Today
`isBusy()` is true only during a real run and the unconditional `window.confirm` is correct,
so there is nothing to fix yet and a speculative change would be a regression.

**(c) Document replaced is unconditional unmount.** `noteOpenDocument` already detects the
one transition a `hasFile` boolean misses (one file replaced by a different one). A panel's
model is keyed to a `@alp` fence in a specific file, so carrying it across File > Open would
offer to write one script's layout into another. Unmount, discard, and if the model was
`dirty` say so in the pane rather than in a modal — the file is already gone by then and a
prompt that cannot undo anything is noise.

#### What this does *not* need

No new watchdog, no new terminal states, no change to `cancel()`, `terminate()`, `finish()`
or `canApply()`'s existing behaviour for runs, and no per-tool host (which would break "one
run at a time, app-wide" the way `ToolHost.start`'s own comment describes). The additions are
a `PanelState`, one clause in `isBusy()`, a `dispose()`, and lifting the model above
`activeTab`.

### 3.7 The overlay budget (**new in rev 3**)

Sec.10.6 flagged this as owed to the contract and it is really a blocker, because the
consistency checker has already shipped the failure: **1026 blocks against
`LIMITS.maxBlocksPerOutput` of 1000, `protocol.ts` rejected the output, `host.ts` killed the
run, and the user got nothing at all** — not a truncated report — on a map the design cited
by name 27 times.

**The contract already contains the answer, and it is `table`.** A table is *one* block
holding N rows, with `LIMITS.maxTableRowsRendered` at 10,000 and a pane that renders the
first N and prints "showing first N of M". So:

> **`mapOverlay` is one block holding N shapes**, never one block per shape. The block cap is
> not the governing limit; a new per-block `maxOverlayShapesPerBlock` is.

That is the difference between a tool drawing one mark per land being *unrepresentable* and
being *ordinary*.

**The cap is derived from the worst real script, not chosen round.** Largest `create_land`
counts measured 2026-08-29:

| | lands |
|---|---|
| `Arena.rms` (DE official) | **3,774** |
| `Stranded.rms` (DE official) | 1,889 |
| `24hr_A Heart Map.rms` (corpus) | **2,275** |
| `Venn.rms` (corpus) | 471 |

A per-land overlay therefore needs to serve ~3,800 shapes on a real shipped map, and a tool
drawing a mark *plus* an edge per land doubles it. **`maxOverlayShapesPerBlock: 10_000`,
equal to `maxTableRowsRendered`** — the same order, for the same reason (it is a render
budget, not a memory budget), and consistency with a constant the contract already carries
beats a fresh number derived from the same argument.

Three rules ride with it, each one a lesson this repo has already paid for:

- **Over-budget truncates and says so; it never rejects.** The checker's failure was that an
  over-cap output produced *nothing*. An overlay that draws 10,000 of 12,000 shapes and
  prints the count is strictly better than a blank canvas, and the count is printed
  **unconditionally, including at zero**, because a filtered overlay and an empty one are
  different claims.
- **Shape count is bounded by land count, so a tool cannot be surprised by it.** Land Placement
  itself draws one circle per land, one edge per chain link, and handles on the selection
  only — at Venn's 471 lands that is under 1,000 and it is nowhere near the cap. The cap
  exists for the checker highlighting failures across Arena, which is the case that would
  otherwise have found it in production.
- **`overlayEvent` needs a delivery-rate bound.** A drag at 60 fps against an external NDJSON
  tool is 60 messages a second on a transport whose inbound cap is per-line, not per-second.
  Coalesce `drag` to the latest position per animation frame and deliver `dragStart` /
  `dragEnd` unconditionally, which is the same shape as the vector/full tier split in
  Sec.7.2 and costs a tool that samples every frame nothing it can observe.

### 3.8 The handle lifecycle (**new in rev 3**)

Layer 1 returns "a handle plus a summary" and rev 3's first pass gave the handle a `release`
message and no policy behind it: nothing said who releases, what bounds the results the host
retains, or what happens when a tool never releases at all. That is an unbounded-memory path
in the host, and this session has just paid for one of those — the orphaned worker in Sec.3.6
was the same shape, an object with no owner and no deadline.

**Writing it found two things the sketch had assumed and the tree does not have.** Both are
the *resolve the symbol against the tree* rule landing on rev 3's own work, one section after
Sec.11 was written about exactly that.

> **`generatePreview` does not return land origins.** Its result is
> `{ dim, seedUsed, snapshots?, objects, players, reports, failureMarks, notes }`.
> `landResult.origins` is computed, handed to seven stages, and dropped. So Sec.11's
> `PreviewSummary.landOrigins` is **not buildable today**, and `reports` cannot stand in —
> a `CommandReport` is `{ commandSpan, stage, attempted, placed, failures }` and carries no
> position. A land placement tool needs where the lands went, so this is a real prerequisite,
> not a nicety.
>
> **The final grid is not returned either.** `snapshots` is present only when
> `collectSnapshots` is true, and the live `TileGrid` never escapes. So `previewSlice`
> cannot be served from a `collectSnapshots: false` result at all — the design's own default.

Both are small against `index.ts` (the origins array and the grid both already exist at the
`return`), and both must land before layer 1 does.

#### What a handle owns, priced

Measured 2026-08-29, from the real struct widths — `StageSnapshot` is 6 bytes/tile
(terrain + layer `Uint16`, elevation + cliff `Uint8`), a full `TileGrid` is 11:

| size | dim | one snapshot | all six snapshots | full `TileGrid` |
|---|---|---|---|---|
| Tiny | 120 | 84 KB | 0.49 MB | 155 KB |
| Normal | 200 | 234 KB | 1.37 MB | 430 KB |
| Giant | 252 | 372 KB | **2.18 MB** | **682 KB** |

**So a handle retains the final grid, never the snapshot sequence.** 682 KB against 2.18 MB
at the largest reachable size, and the panel draws the finished map — the S1-S6 sequence is
the preview pane's Current/Final feature, not this one's. Snapshot *capture* turned out not to
be the question: `collectSnapshots` true against false measured between −22% and +47% across
six runs, both signs, which on a machine with a documented 3.7× load spread means the time
cost is inside the noise. **The whole question is retention, not capture.**

#### The policy: one live result per tool, so a leak is unrepresentable

> A `generate` **supersedes** that tool's previous handle. The host retains at most one
> result per tool, and the superseded one is freed at the moment the new one is produced.

Correctness never depends on a tool doing anything, which is the property to design for on a
transport where the tool may be a third-party process that crashed. `{ type: "release" }`
survives as an **early free** for a tool that knows it is done — an optimisation a
well-behaved tool can offer, never a step a correct host waits for. This is the same move as
`Expr` having no `rnd` arm (Sec.5.0): the rule is enforced by what the design can represent
rather than by a validator.

The bound that follows is worth stating as a number: **one tool, one grid, 682 KB worst
case.** A Monte Carlo loop calling `generate` sixty times retains one grid, not sixty.

#### Invalidation: a handle names the generation it came from

A result describes one `(source text, playerCount, mapSize, seed, cutOffset)`. When any of
them changes the handle is stale, and serving old tiles against a changed script is the
"same-version garbage, silently" failure `canApply` already exists to prevent. So the handle
carries the source string it was generated from, and:

- A `sliceRequest` against a stale handle returns `generateFailed` **naming the reason**,
  never stale tiles and never silence.
- `documentReplaced()` (File > Open) invalidates every handle, matching what it already does
  to the run.
- The panel's unmount `reset()` — Sec.3.6, and the fix that landed with it — drops handles
  with the run. Handles are run-scoped, so there is exactly one place they die.

#### Objects are the other half of the payload, and they are bigger than the grid

Measured JSON size of a summary carrying everything except the grid:

| map | full | without `objects` | objects |
|---|---|---|---|
| `Bulls_Eyes.rms` | 71 KB | 60 KB | 144 |
| `Venn.rms` | **1,171 KB** | 175 KB | 12,367 |
| `24hr_A Heart Map.rms` @Giant | **1,876 KB** | 242 KB | 20,374 |

**So "never the whole grid" was the wrong half of the economy to worry about.** On a real map
the object list is 85–87% of the payload and it dwarfs a Giant grid's 682 KB once serialised.
`PreviewSummary` therefore carries **counts and per-command reports, not the object list**;
objects come back through a slice request, bounded by rect, exactly as tiles do. Land
Placement needs none of them — it draws lands — so the common case ships neither.

#### One cap the supersession rule does not close

A tool can ask for the whole grid one slice at a time. Supersession bounds what the *host*
retains; it does nothing about what a tool pulls across the wire. So `sliceRequest` needs a
per-rect area cap and the host counts bytes served per run against
`LIMITS.maxInboundLineBytes`' outbound sibling — the same asymmetry `tools-api/index.ts`
already draws between the inbound line cap and `maxOutboundRunBytes`. In-process built-ins
read the live object with zero copy and are exempt by construction: one contract, two costs,
the principle Sec.1 of `tools-api-design.md` already runs on.

---

## 4. The model

### 4.1 The graph

`Expr` and `Ref` are Sec.5.0 — rev 2 used the first fourteen times without defining it, which
is what `tsc` found (Sec.11). This whole block compiles clean under the repo's own
`tsconfig.json` as written.

```ts
type FrameKind = "radial" | "absolute";
/** "center" is the map centre; anything else is a Placement id. */
type Anchor = "center" | string;

interface Placement {
  id: string;                       // stable; survives reorder
  parent: Anchor;                   // parent placement id — this is the chain
  frame: FrameKind;                 // Sec.4.2
  offset:
    // `theta` in a radial frame IS the angle ABC of Sec.4.2 — signed, degrees,
    // measured at the parent from the ray pointing back at the parent's own
    // anchor. In an absolute frame it is a plain world bearing.
    | { kind: "polar"; r: Expr; theta: Expr }
    | { kind: "cartesian"; dx: Expr; dy: Expr }
    | { kind: "formula"; x: Expr; y: Expr };   // the custom-formula escape hatch
  label: string;                    // user-facing, and the seed of the emitted const names
  /**
   * Set when the user has edited this member away from its group's expansion.
   * Load-bearing, not decorative: Sec.4.5's merge rule branches on it — unset
   * recomputes the offset wholesale, set re-applies it as a delta.
   */
  nudged?: boolean;
}

interface RandomParam {
  id: string;
  label: string;                    // becomes the emitted const name (Sec.5.6)
  min: number;
  max: number;
  /** Sec.4.4. false (default) = one draw shared everywhere; true = one draw per player. */
  perPlayer: boolean;
  /** Sec.4.4: a perPlayer param is only correct at the count it was emitted for. */
  emittedForPlayerCount?: number;
}

interface LandRole {
  id: string;
  label: string;                    // "Player", "Neutral A", … — the const-name stem
  // Every attribute below emits as a `#const` the create_land references, so
  // editing the role edits one line and every land wearing it follows (Sec.6.2).
  // `Ref`, not `Expr`: a terrain is a NAME, not a number, and this repo already
  // paid for mixing the two (BUG-015 split `aliases` out of `symbols`). Sec.5.0.
  terrain: Ref;
  baseSize: Expr;
  baseElevation: Expr;
  landPercent: Expr;
  zone: ZonePolicy;
  assignToPlayer: boolean;          // true → assign_to AT_PLAYER <repeat index>
}

type ZonePolicy =
  | { kind: "none" }
  | { kind: "fixed"; zone: number }
  | { kind: "perRepeat"; base: number; step: number };  // zone = base + step * repeatIndex

interface PatternSlot {
  id: string;                       // stable; with repeatIndex this is Sec.4.5's merge key
  role: string;                     // LandRole id
  theta?: Expr;                     // angular position within the ring; default even
  radius?: Expr;                    // overrides the group radius — the "wavy ring" case
}

interface ShapeGroup {
  id: string;
  parent: Anchor;
  kind: "circle" | "square" | "triangle" | "polygon" | "line" | "arc";
  pattern: PatternSlot[];           // ONE repeat of the cycle: [P, A, B, A, C]
  repeats: number;                  // how many times it goes round
  radius: Expr;                     // default circumradius, PERCENT (Sec.4.3)
  rotation: Expr;                   // phase, degrees
  frame: FrameKind;
  members: string[];                // pattern.length × repeats Placements, ordered
                                    // repeat-major then pattern order — Sec.4.5 derives
                                    // each member's merge key from that position
}
```

A shape group is **sugar that expands to Placements**, not a node kind of its own. Expansion
happens at edit time and the resulting Placements are ordinary and individually editable —
so a user who nudges one vertex of a hexagon keeps the nudge, and the model never forks into
"shape, but with exceptions".

Re-expansion is therefore an explicit act, not something that happens on every emit: changing
`pattern` or `repeats` re-expands. ~~If any member has been hand-nudged or detached from
its role the panel says what it is about to overwrite before it does.~~ — **withdrawn
2026-08-30 by Sec.4.5's merge rule**, which makes re-expansion non-destructive by
construction: there is nothing left to warn about, so it reports what it did rather than
asking permission first. The group survives
expansion so the canvas can still offer radius/rotation/count gizmos for the set (Sec.7.3)
and so "regenerate this shape" is one click.

### 4.2 The radial frame: angle ABC (**resolved 2026-08-29**)

**A** is the map centre, **B** is the parent land, **C** the child placed around it. The
invariant the chain maintains is the **angle ABC** — equivalently, C's bearing expressed in
B's own rotated coordinate system. That is `frame: "radial"`, and it is the default.

So the local zero axis is the **ray B→A, pointing back at the map centre**, and `theta` is
the signed angle swung off it. Bulls_Eyes says so in its own arithmetic:

```
#const DEGREES_P1_A1 (DEGREES_P1 + 180 + ROTATION_AUX + VAR_A1)
#const X_P1_A1       (RADIUS_AUX_LANDS * COS_P1_A1 + X_P1)
```

`DEGREES_P1` is B's bearing from A; `+ 180` turns it into the ray B→A; everything after is
the angle ABC. **The `+ 180` is not a user-facing term — it is the frame definition, and it
belongs in the emit.** What the user types is `ROTATION_AUX + VAR_A1`, and that is exactly
angle ABC. (A2's `DEGREES_P1 + 45 + …` is the same node with `theta = 45 - 180 = -135`; the
model reproduces either spelling.)

Signed, not the unsigned 0–180 of school geometry: the sign is which side of the B→A ray C
sits on, and dropping it would mirror half the map.

#### Why the frame composes without `ATAN2`

Depth 2 forces a choice the brief does not cover: for a grandchild D hung off C, is the
reference ray C→A (back to the map centre) or C→B (back up the chain)?

**It must be C→B, and this is forced rather than chosen.** The tool emits C's *position*
(`X_C`, `Y_C`), not its bearing from centre — a child position is a vector sum, not a
rotation — so recovering bearing(A→C) would need `ATAN2`, which RMS does not have and which
Sec.2 lists as a non-goal. The ray back up the chain, by contrast, is pure addition.

Both readings agree at depth 1, because at depth 1 the parent's anchor *is* the map centre.
So one uniform rule covers every depth:

> The local zero axis is the ray from the parent back to **the parent's own anchor** — the
> map centre for a top-level land, its own parent otherwise.

Carrying one extra quantity per node makes the whole thing three additions. For node `n`
let `INBOUND_n` be the world angle of the ray from `n` back to its anchor:

| | top-level land `t` (anchor = centre) | child `c` of parent `p` |
|---|---|---|
| ray angle | `θ_t` (world bearing) | `INBOUND_p + θ_c` |
| position | `r * COS(θ_t) + 50` | `r * COS(INBOUND_p + θ_c) + X_p` |
| `INBOUND` | `θ_t + 180` | `INBOUND_p + θ_c + 180` |

Substituting for P1_A1: `INBOUND_P1 + θ` = `DEGREES_P1 + 180 + (ROTATION_AUX + VAR_A1)` —
character-for-character the hand-written line.

**`INBOUND_n` is a derivation, never an emission (rev 3, measured).** Rev 2 read the third
row as a line to write and the emit spent one `#const` per node on it — eight on Bulls_Eyes,
six of them on leaves with no children at all. Substitute the row into itself and the const
disappears: `INBOUND_p` is `DEGREES_p + 180`, `DEGREES_p` is always a single emitted symbol
at every depth, so

> `DEGREES_c = DEGREES_p + 180 + θ_c`

is already a pure left spine, and the recursion closes on `DEGREES` alone. That is exactly
what Bulls_Eyes writes. **The table is the algebra; only rows 1 and 2 reach the file.**

The Sec.2 acceptance bar is no longer checkable-by-hand-in-principle — it has been run, and
the emitted block is byte-identical to the hand-written one on all 104 lines. Sec.10.1.

#### The degenerate cases

- **Parent at the map centre.** bearing(A→B) is undefined when A and B coincide. The tool
  falls back to a world axis of 0° and flags the node, rather than emitting arithmetic whose
  meaning depends on floating-point noise in a subtraction of equal numbers.
- **Top-level land.** No ABC angle exists — its parent *is* A — so its offset is a plain
  world polar `(r, θ)` from centre, exactly `DEGREES_P1 (ROTATION_PLAYER)`.

#### `absolute`

`frame: "absolute"` drops the `INBOUND_p` term: the child keeps a world-axis delta and stays
north-east of its parent wherever the parent goes. Right for "a lake always 8% west of the
TC", wrong for anything rotationally symmetric. It is **one term cheaper to emit, not a
separate code path**, so it is kept — the speculative-generality objection would apply to a
second mechanism, and this is the same mechanism with a zero substituted.

**Connecting never moves anything.** Drag a link from C to B and the tool computes the
`theta` that leaves C exactly where it already sits; the connection only changes what will
move it *later*. That is the whole promise of the feature and it goes in the HelpTip
verbatim.

#### Two combinations this section never named (**added slice 3, 2026-08-30**)

`frame.ts` builds every offset kind now, which surfaced two combinations Sec.4.1/4.2 describe
only for `polar`:

- **`cartesian`/`formula` offsets do not consult `frame` at all.** Neither has an angle to
  rotate or an `INBOUND` term to drop — `dx`/`dy` are already plain world-axis deltas and a
  `formula`'s `x`/`y` are already whatever the user wrote. `radial` vs `absolute` is a
  distinction this document only ever states in terms of `polar`'s `theta`, and it stays that
  way rather than growing a second meaning.
- **A `radial`+`polar` child of a `cartesian`/`formula` parent** has no `DEGREES_p` to add
  `+ 180` to, since its parent was never placed by angle. It falls back to the same rule
  already stated for the map-centre degenerate case: a plain world bearing, `theta`
  unmodified. No new mechanism — the existing fallback, triggered by the same absence.

### 4.3 Units and scale (**measured 2026-08-29**)

`land_position` is **percent of map** — `lands.ts` scales `(px / 100) * dim`, rounds, then
clamps to `[0, dim-1]` (the Michi.rms fix). So `r` and `dx`/`dy` are percent, and Bulls_Eyes'
`RADIUS_PLAYER_LANDS 26` is 26% of the map, not 26 tiles. The canvas overlay converts through
`projection.ts`.

Rev 2 stopped there, and the three things it left implicit are the ones that decide the panel.

#### The model stores percent as a float, and that is forced

`percent` is what the attribute takes and the only unit that survives a map-size change, so
it is what the fence writes. But the *quantum* varies with map size, and the reachable range
is narrower than rev 2 assumed:

| lobby size | dim | tiles | 1 tile = | 1% = |
|---|---|---|---|---|
| Tiny | 120 | 14,400 | 0.833% | 1.2 tiles |
| Small | 144 | 20,736 | 0.694% | 1.44 tiles |
| Medium | 168 | 28,224 | 0.595% | 1.68 tiles |
| Normal | 200 | 40,000 | 0.500% | 2.0 tiles |
| Large | 220 | 48,400 | 0.455% | 2.2 tiles |
| Huge | 240 | 57,600 | 0.417% | 2.4 tiles |
| Giant | 252 | 63,504 | 0.397% | **2.52 tiles** |

**So Sec.7.3's "snapping to integer percent, on by default" is wrong, and rev 3 withdraws
it.** At Giant it quantises every land to a 2.52-tile lattice — a land can be placed 2 tiles
from where the user put it, on a map whose author is choosing radii to the tile. And the
rationale rev 2 gave for the snap does not survive either: Sec.5.4's integrality requirement
is about **angles**, which the compiler already resolves to integer literals at emit time
(Sec.4.5), and a position const is `r * COS + 50` where `COS` is a float, so snapping `r` to
an integer percent buys the emitted arithmetic nothing at all. The snap becomes an explicit,
default-off modifier, and the useful default snap is **to the tile lattice for the current
map size**, which is a real thing the user can see on the canvas.

#### The corpus already picked a lattice, and it is tiles

Census over all 34 corpus maps, every `land_position` argument (**13,322** arguments,
6,661 sites):

| | count |
|---|---|
| numeric literal | 12,912 |
| symbolic (a `#const` name) | **410** (3.1%) |
| integral | 12,178 |
| **fractional** | **734** |

Every one of the 734 fractional values is in **one map, `Venn.rms`**, and they are on a
regular lattice: the smallest gap between distinct values is **0.833**, which is `100/120`
— the author laid out 463 hand-placed wall segments **in tiles on a 120-tile map and divided
by 1.2**. So the one map in the corpus that places lands at sub-percent precision was
thinking in tiles the whole time, which is the strongest available argument for showing tiles
beside percent rather than treating percent as the user's unit.

Note the other side of that table: **3.1% of land positions are symbolic.** Everything this
tool writes is symbolic (Sec.6.2), so a script it has touched sits in a 3% minority of the
corpus by this measure. That is a statement about how rare computed placement is, not a
reason to avoid it — it is the whole point of the feature — but it is why Sec.6.4's importer
matters more than the raw map count suggests.

#### The error budget, and why 1° is not the limiting term

The macro has 1° resolution (Sec.5.4). Run through the app's own evaluator at every integer
degree from −359 to 359, **Bhaskara's own approximation error is at most 0.00163** in both
`sin` and `cos` — at `r = 26%` that is 0.042% of the map, a fifth of a tile at Normal and
well under one tile everywhere. So the approximation is not the limiting term; the **angular
quantisation** is:

| radius | worst error, engine cast (1.0°) | worst error, compiler rounds (0.5°) | in tiles @Normal | @Giant |
|---|---|---|---|---|
| 14% (Bulls_Eyes aux) | 0.244% | 0.122% | 0.49 / 0.24 | 0.62 |
| 26% (Bulls_Eyes player) | 0.454% | 0.227% | 0.91 / 0.45 | 1.14 |
| 33% (Venn aux) | 0.576% | 0.288% | 1.15 / 0.58 | 1.45 |
| 49% (Venn dense forest) | 0.855% | 0.428% | 1.71 / 0.86 | 2.16 |

Two things fall out. Sec.5.4's "emit integer literals, rounded to nearest" is worth **half a
tile to a full tile** at real radii rather than being a nicety. And **the total positional
error is under 1.2 tiles at every radius the corpus uses**, at every reachable map size —
which is what makes the vector tier's model-only drawing (Sec.7.2) honest: it can draw where
the land will be, not approximately.

#### The declared range is `[0, 99]`, not `[0, 100]`

`language.json` declares `land_position`'s two arguments `type: percent, min: 0, max: 99`,
and **the corpus exceeds it** — `land_position 100 46`, `14 100` and eight more spellings
appear across the tracked maps. Positions outside the range are legal to write and get
clamped by the engine, so the tool **warns rather than prevents**, and it takes the bounds
**from `language.json` rather than hardcoding `100`**, per the project's own data-driven
vocabulary rule. A clamped land is drawn on the canvas at its clamped position with a marker,
since that is where it will be.

#### The conversion has three implementations and no shared one

`grid.ts` exports `positionPercentToTile(pct, dim)`, documented with the Michi.rms fix and
the round-then-clamp order. **It has zero production callers.** `lands.ts` inlines the same
conversion twice — once in `neutralOrigin`, once in the `direct_placement` slot loop — and
both are correct today, and both are a copy. Rev 2's Sec.4.3 cited the helper's docstring as
though it were the code path. The tool should call the export and, when it lands, the two
inline copies should call it too; that is a one-line cleanup rather than a bug report, and it
is written down here because the next reader will otherwise cite the docstring again.

#### The percent/tile confusion is not hypothetical: the map it is for already made it

`create_actor_area` takes **tiles** — `language.json` says so in capitals, "X coordinate in
TILES, not a percentage of map width. Must be scaled to map size by hand." Bulls_Eyes'
`<OBJECTS_GENERATION>` writes:

```
create_actor_area X_P1 Y_P1 2 0                                  /* percent, into a tiles slot */
create_actor_area (X_P2_A1 / 100 * MAPSIZE) (Y_P2_A1 / 100 * MAPSIZE) 4 0   /* scaled */
```

Three of the four scale and one does not. So the panel does not merely *display* tiles beside
percent — when the user asks for a land's position somewhere that takes tiles, it offers the
`(NAME / 100 * MAPSIZE)` form, because the map that motivates this whole tool got that
conversion wrong once already and nothing told its author.

### 4.4 Random parameters, and the per-player checkbox (**resolved 2026-08-29**)

`rnd(a,b)` may never be a term inside an expression, so every random quantity that takes part
in arithmetic is **hoisted to a named parameter** and referenced (Sec.5.3). That much is
forced by the language — and it forces a semantic choice with it, because a hoisted draw is
evaluated *once* and every reference reads the same number.

⚠ **Rev 2 overstated the rule, and the DE install settles it (measured 2026-08-29).**
`rnd(a,b)` is legal as a **whole argument value**, not only as a whole `#const` value: the
parser already models this (`ArgValue`'s `{ rnd: [N, N] }` arm), and across the 211 official
DE scripts plus 81 `.inc` files, **5,222 of 10,226 `land_position` uses are exactly
`land_position rnd(a,b) rnd(a,b)`** or one random axis against one literal. In the same
population, `rnd` appears as a term inside an expression **zero** times, so the two halves of
the rule are cleanly separated by shipped evidence rather than by reading.

**So hoisting a purely-random position is a choice, and the tool still makes it.** A
`Placement` whose offset is nothing but a draw *could* emit `land_position rnd(15,85) rnd(15,85)`
with no `#const` at all, which is shorter and is the official idiom. The tool hoists anyway,
for three reasons that are about the panel rather than the language: a named parameter is
re-rollable from the UI, it is shareable between placements (which is the whole of Sec.4.4's
`perPlayer` distinction), and it is pinnable for a drag (Sec.3.3 — an unpinned draw inside a
`land_position` cannot be held still between two frames). **The panel offers the un-hoisted
form as an explicit "inline this draw" action** for a one-off land, because a mapper who
wants the official spelling should be able to have it.

Bulls_Eyes depends on this in both directions at once:

```
#const ROTATION_AUX rnd(-180,180)     /* shared: both players' clusters rotate together */
#const VAR_A1       rnd(-2,2)         /* shared: P1's and P2's first aux land mirror */
```

Whereas a mapper who wants each player's cluster jittered independently needs a distinct
draw per player. Both are legitimate and neither is inferable from the model.

**So every `RandomParam` carries a `perPlayer` checkbox**, and it is the whole of the
feature:

| `perPlayer` | Emits | Reads as |
|---|---|---|
| `false` (default) | `#const ALP_VAR_A1 rnd(-2,2)` | One draw, shared by every reference — symmetric, mirrored variance. Bulls_Eyes' own behaviour, so it is the default. |
| `true` | `#const ALP_VAR_A1_P1 rnd(-2,2)`, `…_P2`, … one per player | Independent draw per player; a reference from a node owned by player *n* resolves to that player's copy. |

Two consequences worth stating rather than discovering:

- ~~**`perPlayer: true` needs a player count at emit time.**~~ **Lifted (per-player-escalation.md
  Sec.5.4, slice B).** This used to come from `settings.playerCount` on the context, so the
  emitted script was correct at the count it was authored for and no other — Q3 had chosen a
  user-set count over a runtime one, consistent rather than a gap at the time, on the
  understanding that the `2_PLAYER_GAME` ladder deferred by Sec.12 Q3 was what would lift the
  restriction, "here and there together or not at all." The ladder shipped (per-player rings,
  slice A) and this is the "there": `paramEmit.ts` now emits **every** `perPlayer` param at
  `MAX_PLAYER_COUNT` unconditionally, ring or not, so the emitted script is correct at every
  count rather than one. Unused draws for players beyond the live count are harmless. The panel
  no longer states a count a `perPlayer` parameter was emitted against, since there no longer is
  one — `RandomParam.emittedForPlayerCount` is kept on the type (a stale value from elsewhere is
  still checked correctly) but this tool never stamps it any more, and P2 (preconditions.ts) has
  nothing left to fire on for anything this tool itself emits.
- **A node not owned by any player** — a neutral centre land, say — has no "its player", so
  a `perPlayer` parameter referenced from one is a model error the panel reports rather
  than silently resolving to P1.

### 4.5 Roles and repeating patterns (**resolved 2026-08-29**)

The count is **chosen by the user**, not derived from the player count (Sec.12 Q3). But a
ring is rarely one kind of land — the requirement is a cycle of *roles* going round:

```
P A B A C   P A B A C
```

So a `ShapeGroup` carries a **pattern** (one repeat of the cycle) and a **repeat count**,
and the total is `pattern.length × repeats`. The panel exposes all three, live: edit the
pattern and the total moves, edit the total and it snaps to the nearest multiple. Ten lands
above is `[P, A, B, A, C] × 2`.

#### A role is a named set of `#const`s, which is a trick your own map already uses

`LandRole` is not a new mechanism. Bulls_Eyes already has exactly two roles and already
expresses them the right way:

```
#const TERRAIN_PLAYER        DIRT      #const TERRAIN_AUX_TEMP    DLC_BOGLAND
#const BASE_SIZE_PLAYER      12        #const BASE_SIZE_AUX       7
#const BASE_ELEVATION_PLAYER 9         #const BASE_ELEVATION_AUX  9
```

— and every `create_land` references those names rather than literals. So **the role emits
its attributes as constants and the lands reference them**, which is the same "the constant
name is the link" trick `land_position` uses (Sec.6.2). Three things fall out of it, all
free:

- **Editing a role is editing one line.** Change `Neutral B` to forest and every B land in
  every repeat follows, because they all read one `#const`.
- **Breakdown still works, per land.** Hand-edit one land's `terrain_type` to a literal and
  it simply stops following its role. That is a feature — the escape hatch is the absence of
  a mechanism, not an added one — and the panel reports the land as detached rather than
  reasserting itself.
- **The role survives a round-trip** without the tool owning the `create_land` block, so
  Sec.6.2's ownership split holds unchanged.

#### What varies per instance: the repeat index

This is what makes the pattern *modular* rather than a naming convention. A role's
attributes are constant across its instances **except** where they are parameterised by
which repeat they are in, and Bulls_Eyes shows both of the cases that matter:

| | P1 cluster | P2 cluster | Rule |
|---|---|---|---|
| `assign_to AT_PLAYER` | `1` | `2` | repeat index |
| player-land `zone` | `1` | `2` | `perRepeat`, base 1 step 1 |
| aux-land `zone` | `11` | `22` | `perRepeat`, base 11 step 11 |
| `base_size`, `terrain`, elevation | identical | identical | role constant |

Hence `ZonePolicy` and `assignToPlayer` on the role: a role either pins a zone, derives one
from the repeat index, or has none. Everything else is flat.

`assignToPlayer: true` is also what ties a pattern to the player count without making the
count dynamic: a pattern with one `P` slot and 4 repeats assigns players 1–4. If `repeats`
exceeds the current `playerCount` the panel warns — the lands are still emitted, since a map
authored for 8 and played at 4 is ordinary, but Sec.6.3's `direct_placement` check applies
to each of them.

#### Future want: every `create_land` attribute on a Role, override-able per land (recorded, not designed)

`LandRole` covers a working subset of `create_land`'s own attribute set — `terrain_type`,
`land_percent`, `base_size`, `base_elevation`, the `zone`/`set_zone_by_team`/`set_zone_randomly`
group, and `assign_to_player`/`assign_to`. `language.json`'s own `create_land` entry lists 23
attributes in total; the rest (`number_of_tiles`, `set_circular_base`, `generate_mode`,
`left_border`/`right_border`/`top_border`/`bottom_border`, `border_fuzziness`,
`clumping_factor`, `land_conformity`, `other_zone_avoidance_distance`,
`min_placement_distance`, `land_id`) have no `LandRole` field and no way into a role's emitted
`#const` set at all today. (`land_position` and `circle_radius` are a different case, not a gap
— they are what the frame/offset algebra computes, on purpose, so a role has no business naming
them directly.)

A stated want, not yet scoped: **every remaining `create_land` attribute should be a `LandRole`
field**, the same way `baseSize`/`baseElevation`/`landPercent` already are, so the full attribute
set is authorable from one place per role instead of only reachable by hand-editing the emitted
fence. **And each of those fields should be override-able on an individual land**, not only
shared across every land wearing the role — today the ONLY escape hatch for one land diverging
from its role is the existing text-level one (hand-edit that land's `create_land` to a literal,
which detaches it from the role's `#const` for that attribute, Sec.4.5's own "editing a role is
editing one line" paragraph above). That is a real mechanism for the case it covers, but it is
not what is being asked for here: a genuine per-land override needs a modeled field (on
`Placement`, the way `thetaPerCount` already overrides one member's angle without touching the
group), not a manual departure from the fence.

This needs its own design pass before it is built, on the same standing rule every other
Land Placement gap in this file has followed (a spec silent on a combination it never considered
gets escalated, not improvised) — in particular: which of the remaining attributes take an
`Expr` versus a plain value (`border_fuzziness`/`clumping_factor` look closer to `sweep`'s
plain-`number` precedent than to `baseSize`'s `Expr`, since DE's own guide already treats a few
of them as tuning knobs rather than script-visible quantities — unconfirmed, worth checking
before assuming), whether a per-land override composes with `ZonePolicy.perRepeat` the way
`perimeterShift` composes with `slot.radius` (Sec.4.5's own perimeter-rotation write-up above,
a stated rule rather than an emergent one), and whether all 12 missing attributes are worth
building at once or whether some (`land_id`, say) are dead weight nobody has asked for.

#### Angles

For `N = pattern.length × repeats` lands on a ring, slot `j` of repeat `i` sits at

```
theta = rotation + i × (360 / repeats) + j × (360 / N)
```

which is one expression, evaluated **at emit time to an integer literal** per land, so
Sec.5.4's integrality requirement is satisfied by construction at every `N` including 7.
`PatternSlot.theta` overrides the even default for one slot; `PatternSlot.radius` overrides
the ring radius, which is the per-vertex-radius / irregular-shape case of Sec.12 Q6 arriving
for free rather than as its own feature.

#### Shape kinds: `line`, `arc`, `square`, `triangle` and `polygon` (slices A/B/C, resolved 2026-09-03; the perimeter kinds moved to `polar` the same day, perimeter-symbolic-rotation-slice-a-brief.md)

`ShapeGroup.kind` sat untyped-in-practice since Sec.13's slice 1 (`expandShapeGroup` never read it, so every kind expanded as a circle). `docs/land-placement-shape-kinds-escalation.md` closed the question for all six kinds; slice A builds the two that ride the existing `polar` model unchanged, `line` and `arc`. `square`, `triangle` and `polygon` were built with a `cartesian` offset and a second `reExpand` branch first (slice B), which slice C then called two more ways for the remaining two named shapes. All six kinds are built as of slice C, 2026-09-03 — and, the same day, a follow-on slice replaced the perimeter kinds' `cartesian` representation with `polar` (below), so **all six kinds are `polar`; there is no `cartesian` group member any more**. `reExpand.ts`'s `cartesian` merge branch stays, for a standalone user-authored `cartesian` placement outside any group.

A kind decides two things only, `theta`'s default and `r`'s default, the same two quantities circle already computes; `PatternSlot.theta`/`PatternSlot.radius` still override either one per slot, for every kind.

**`line` is circle's own dual.** Circle holds `r` fixed and varies `theta`; a line holds `theta` fixed at `rotation` (plus a per-slot override, default 0) and varies `r`, SIGNED, so members run from one end through the anchor to the other:

```
N = pattern.length × repeats, m = i × pattern.length + j, span = N - 1
r_m     = radius × (2m - span) / span   (0 when span is 0, a one-member line)
theta_m = rotation + (slot.theta ?? 0)
```

`radius` doubles as the line's half length, so the existing radius gizmo handle (which sits at `(radius, rotation)`) already lands on the far end member with no change to `gizmoGeometry.ts`. Emitted as the integer ratio `radius × (2m - span) / span`, never a baked decimal, so it stays exact under a symbolic radius and reads like the corpus. A one-member line (`span = 0`) sits at the anchor, not at either end.

**`arc` is circle's own formula with `360` replaced by `sweep` and the divisor `N` replaced by `N - 1`.** A ring's last member deliberately stops short of its first; an arc's two ends are both occupied, so it needs the smaller divisor:

```
step_m  = round(sweep × m / span)   (0 when span is 0, a one-member arc)
theta_m = rotation + (slot.theta ?? step_m)
r_m     = slot.radius ?? radius
```

`ShapeGroup.sweep` is a new field, a plain `number` (not an `Expr`, since it is consumed at expansion time to bake an integer degree literal per member, Sec.5.4) defaulting to **180, not 360**. A 360 sweep is legal input and stacks the last member on the first rather than closing into a ring — dividing by `N - 1` at a full turn puts two members at the same angle, which is exactly the collision the `N` divisor exists to avoid for `circle`. (The escalation doc originally read a 360 sweep as degenerating to circle exactly; it does not, and the doc has been amended in place.)

**`perPlayer` is refused outside `circle`.** The per-player prologue (`prologue.ts`, per-player-escalation.md Sec.8.2) only ever computes the RING formula and substitutes it over any `polar` member of a `perPlayer` group. A line or an arc is `polar` too, so without a guard a `perPlayer` line would silently draw ring angles over it, a plausible-looking wrong map rather than an error. `emitAlpModel` refuses any `perPlayer` group whose `kind` is not `circle` before the prologue is built, and the panel disables the "One land per player" checkbox outside `circle` with a title explaining why. A `perPlayer` arc is a real future want (how a sweep divides across a runtime count) and is deliberately not built this slice.

**`square`, `triangle` and `polygon` are `polar` too, same day as slices A-C.** They were built `cartesian` first (below, kept for the historical record of why); `docs/land-placement-perimeter-symbolic-rotation-escalation.md` Sec.8.3 replaced that representation the same day, in the slice named in this subsection's own heading update. A member's position is still a fraction of the way round the shape's own perimeter — `PatternSlot.theta` still has no meaning for it, the field's own doc comment says why — but that fraction now resolves to a **scale on the radius and an offset on the bearing**, an ordinary `polar` offset in exactly the shape `circle` already produces, rather than a `cartesian` `dx`/`dy` pair. The three polygon kinds (`square`, `triangle`, `polygon` and the `M`-sided general case behind them) share one function, `perimeterPolar(sides, memberCount, memberIndex)`, which takes **no rotation parameter at all**:

```
M = sides, N = memberCount, m = memberIndex
delta = m / N + 1 / (2M)                  fraction of the way round the perimeter
k     = floor(delta * M) mod M            which side
f     = (delta * M) mod 1                 how far along that side
u     = (f - 0.5) * 2 * sin(pi / M)       signed distance from the side's midpoint, in units of R
apo   = cos(pi / M)                       the apothem, in units of R
radiusScale    = hypot(apo, u)                       (rounded to 6 decimal places)
bearingDegrees = round(k * 360 / M + atan2(u, apo))   (rounded to a WHOLE degree)
```

`expand.ts` then emits `r = base * radiusScale`, `theta = group.rotation + bearingDegrees` — rotation as the OUTER addend, exactly the shape `circle`'s own `theta` already has. The absence of a rotation parameter on `perimeterPolar` is the whole design: the geometry never sees rotation, so a `sym`/`param`/`rnd()` rotation composes for free, with no new machinery in `frame.ts`, `compiler/trig.ts` or `reExpand.ts`'s polar branch.

Two conventions this formula pins that the escalation itself left ambiguous, carried over unchanged from the cartesian representation this replaces:

1. **Rotation enters once, additively on the bearing.** The escalation's own §3(a) also wrote it into a `phase` term inside `delta`, which would spin the shape AND slide every member along its own perimeter at the same time — dropped, so `rotation` means for a perimeter kind exactly what it already means for `circle`/`line`/`arc`. (Corrected in the escalation doc in place, matching how slice A corrected its own `sweep` sentence.)
2. **The walk starts at the midpoint of side 0** (the `1 / (2M)` term), so member 0 sits on the rotation ray like every other kind — under the polar form that reads as `bearingDegrees === 0` at `m === 0` for every `M` and `N` — and a square at rotation 0 has flat sides facing the axes rather than a corner.

At `N = 4` this puts one member on the middle of each side; at `N = 8` it alternates side midpoint and corner, with corner members landing at exactly the radius (`radiusScale = 1`) and midpoint members at exactly the apothem (`radiusScale = cos(pi/M)`) — the mid-edge requirement that settled the escalation's own vertex-vs-perimeter fork, now visible directly as the member's own emitted radius rather than hidden inside a coefficient pair.

**The price of going polar, measured rather than assumed.** A polar member's DEGREES cell is truncated to a whole degree by the engine's own `%` cast, so `bearingDegrees` is rounded at expansion time exactly as `circle`'s own bearing already is — the bearing offset is not generally integral, so this rounding is real. Measured worst-case emitted-position error against real trigonometry, over a spread of `sides`/`memberCount`/rotation/radius: **0.440 percent-units** (about 2.1 tiles at this app's largest map dimension, 480), against 0.00003 for the old cartesian representation. Of that, 0.393 is the whole-degree quantization every `circle`/`line`/`arc` member already pays (it scales with radius, so a ring at radius 10 pays a quarter of the figure above) and 0.078 is the Bhaskara macro's own already-documented distance from real trig (Sec.5.4). A cartesian/polar hybrid — cartesian when rotation resolves, polar only when it does not — was considered and rejected: it would make a group's offset KIND depend on whether its rotation happens to be a formula, so typing `rnd(0,359)` into Rotation would silently flip every member's representation and detach every nudged member on the next edit (Sec.4.5's merge rule, below). One honest representation, priced above, beats two that swap under the user.

**A symbolic radius keeps working, unchanged: it multiplies a baked scalar, so it can be any `Expr`.** A symbolic rotation now works too, for the reason above — there is no longer a refusal to state: `emitAlpModel`'s old rotation refusal (which used to draw the group at rotation 0 and block Apply, the same two-place pattern `perPlayer` outside `circle` still uses) is deleted outright, not narrowed, since there is nothing left for it to refuse.

**Two capabilities this representation change hands over for free, both real output changes.** A `radial` child chained to a perimeter member now inherits a real DEGREES cell — a `cartesian` parent has none (`frame.ts`'s own header point 2), so a child used to degrade to a plain world bearing; a polar parent has one, so radial framing now works off a polygon's own corner. And the canvas draws a symbolically-rotated perimeter group at its actual resolved rotation, rather than falling back to 0 while `emitAlpModel` silently refused the Apply.

**The merge rule and the drag inverter needed less new work than the representation change might suggest.** `reExpand.ts`'s cartesian-vs-cartesian delta branch (built for `square` originally) STAYS, since a standalone user-authored `cartesian` placement is still a real, reachable case outside any `ShapeGroup` — it is simply no longer reachable FROM group expansion, since no kind produces `cartesian` any more. A model saved before this slice, with a nudged perimeter member still holding the old `cartesian` shape, hits the MIXED-pair branch on its next re-expansion and reports `positionDetached` — the member keeps its position and stops following its group, visibly, rather than being silently reinterpreted. `dragMath.ts` needed no code change at all: a member with a symbolic ROTATION now has `theta = sym ± num`, which the existing polar absorb path already inverts, so dragging a member of a symbolically-rotated square keeps the rotation reference and adjusts the constant, gained for free rather than built.

**`triangle` and `polygon` are the same `perimeterPolar` function called two more ways**, exactly as they were the same `perimeterOffset` function before this slice. `square` above is `M = 4` of a shared implementation, not a special case, so `triangle` is `M = 3` and `polygon` is `M = clampSides(group.sides)`. `ShapeGroup.sides` is a `number | undefined`, meaningful for `polygon` only — `square` and `triangle` hardcode 4 and 3 and carry no field of their own, since their side count is exactly what makes them their own kinds. **Clamped, not refused**, at expansion (`expand.ts`'s `clampSides`, `Math.max(3, Math.trunc(sides ?? 6))`): a hand-edited `sides: 2` has no polygon to draw, and unlike every other refusal this feature makes, a clamp here can never let a wrong value reach an emitted map, since the panel's own Sides input (min 3, max 12) keeps the case from arising in the first place — this is the one place in the feature where a floor beats a refusal. The panel's max of 12 is a legibility judgement, not a limit of the maths: past a dozen sides a polygon and a circle look the same at map scale, and Circle gets there with less arithmetic.

**`perPlayer` outside `circle` was already refused before this slice, and the refusal quietly became the ONLY guard for a perimeter kind.** `prologue.ts`'s own `offset.kind !== "polar"` skip used to catch every perimeter member as a second line of defence (they were all `cartesian`); since every kind is `polar` now, it catches none of them, so `emitAlpModel`'s `perPlayer` refusal is what stands between a `perPlayer` square and a set of silently-stamped ring angles. Read the other way, this is also the news that a per-player ARC — one of the two wants parked by the shape-kinds escalation — is closer than it was: the prologue's own rule-detection machinery works on any `polar` member.

**What is left of slice 5's own item 6, closed the same session.** A perimeter kind (`square`/`triangle`/`polygon`) needs no per-vertex handles — its vertices are fully determined by radius and rotation, which the existing gizmo already edits, so a vertex handle would be a second control for two numbers that already have one (`docs/land-placement-shape-kinds-escalation.md` §7 has the full reasoning). What remained was two handles, one per *polar* kind slice A introduced:

- **A line's near end** (`gizmoGeometry.ts`'s `lineEndHandlePosition`), the anchor's own mirror of the far end the existing radius handle already sits on — `(radius, rotation + 180)`. Dragging it (`canvasInteraction.ts`'s `computeLineEndDrag`) sets `radius` to the drop distance and `rotation` to the drop bearing plus 180 (folded, `dragMath.ts`'s own `foldBearing`, now exported for this), both in ONE `applyGroupEdit` call — two edits would measure the second delta against a group only half updated. It sits exactly on the line's own member 0 by construction, so the canvas's existing handle-before-circle hit-test precedence (already load-bearing for the radius handle over a circle's own member 0) picks it up for free. Declines exactly like the radius/rotation handles, with both labels together, when either `radius` or `rotation` is symbolic.
- **An arc's sweep** (`arcSweepHandlePosition`), at its own last member, `(radius, rotation + sweep)`. Dragging it (`computeArcSweepDrag`) sets `sweep` only, to the drop bearing minus the group's own resolved rotation, WRAPPED into `(0, 360]` rather than folded into `dragPolar`'s signed bearing range — a sweep is a span, never negative, which a fold would get wrong at the exact drop that would land past 180. `sweep` is a plain `number`, never an `Expr`, so this handle can never hit the symbolic decline the line's does.

Both interpretations are pure, tested functions in `canvasInteraction.ts`, the same discipline `computeRimDragReparent` and the snap context builder already follow — the canvas component stays glue.

#### `PatternSlot.perimeterShift`: a per-member position along the perimeter (perimeter-symbolic-rotation-slice-b-brief.md, resolved 2026-09-03)

The perimeter kinds' own analogue of `slot.theta`: a member's position along its shape can now vary independently of the others, not only stay at the even walk `perimeterPolar` computes by default. Built the same day as, and directly on top of, the `polar` representation change above (`perimeterPolar` gained one optional parameter, `expand.ts`'s `perimeterKindOffset` threads `slot.perimeterShift ?? 0` through it, nothing else in the tree changed).

```
delta = m / N + 1 / (2M) + shiftPercent / 100    (was m / N + 1 / (2M))
```

`shiftPercent` is `PatternSlot.perimeterShift`, **percent of one lap, ADDED to the slot's even position**. `square`/`triangle`/`polygon` only, ignored by `circle`/`line`/`arc` the same way `ShapeGroup.sweep` is ignored outside `arc`. The existing wrap (`k`'s double mod, `f`'s subtraction from `floor`) already handles a negative or greater-than-100 shift correctly — a shift of exactly 100 lands on the identical `(radiusScale, bearingDegrees)` pair as no shift at all, one full lap round.

**A plain `number`, not an `Expr`, for `sweep`'s own reason.** The value is consumed at expansion time to bake a radius scale and a bearing, and both are discontinuous in the fraction — the side index `k` is a `floor` of it, so a value the tool cannot see until the engine runs would have no radius scale and no bearing at all. The type makes that unrepresentable rather than needing a runtime refusal (escalation Sec.8.7, finding 1) — `emitAlpModel`'s `kindProblems` gains no new entry for this field.

**A DELTA, not a replacement, deliberately unlike `slot.theta` one field above it.** `slot.theta` REPLACES the even angular term, which stacks every repeat of a slot at one bearing and is only usable at `repeats: 1`; `perimeterShift` nudges the slot's members along the shape and works at every repeat count. The asymmetry is real, not a drift: overloading one field for both meanings would either lose an authored angle or reinterpret "90" as a quarter-lap the moment a group's kind flips between circle and square, this feature's own named failure mode (a plausible-looking wrong picture).

**The radius composition rule, embracing rather than working around the apothem subtlety.** Walking along a flat side moves a point strictly closer to the anchor except exactly at the side's midpoint — that is what `radiusScale`'s own range, `[cos(pi/M), 1]`, already means, and under the polar representation it shows up as the member's own emitted radius rather than hiding inside a coefficient pair. `slot.radius` scales the whole local vector `perimeterShift` has already chosen a point on, so the two are orthogonal: the shift picks WHERE on the unit-circumradius shape, the radius scales it outward or inward from there, in either order. "Pin the member to the circumradius while sliding it along the shape" was rejected outright — on a polygon that point is not on the shape at all.

**Composes with a symbolic group rotation for free**, for the identical reason the representation change above does: `perimeterPolar` never sees rotation, so it does not matter whether `shiftPercent` moved which side/fraction the member landed on before `expand.ts` adds `group.rotation` as the outer addend. Rotation spins the shape, the shift moves a member along it, neither reads the other.

**The panel puts one number input per slot inside its existing chip**, shown only when the group's kind is a perimeter kind (hidden for circle/line/arc exactly as Sweep and Sides already hide themselves), editing `pattern` through the existing `applyGroupEdit` path with no signature change. Signed, no clamp — unlike `sides` there is no invalid shift; 250 is two and a half laps and lands somewhere real, and clamping it would be inventing a rule the geometry does not have.

#### Patterns and chains compose, and Bulls_Eyes needs both

Worth being explicit, because they look like alternatives and are not. Bulls_Eyes is **not**
a patterned ring — it is 2 player lands on a ring, each the *parent* of 3 chained aux lands.
A patterned ring would put all 8 lands on one circle, which is a different map.

Both exist, and any member of a patterned ring can still be a parent for chained children
(Sec.4.2). "A hexagonal ring of player lands, each with two flanking neutrals" is a pattern
of one role plus a chain of two, and that composition is the thing neither feature does
alone.

**How much of that composition is automatic depends on whether the ring is per-player, and
the difference is worth stating because the sentence above reads as though it were always
automatic. It is not.**

- **A per-player ring (Q10) does repeat the chain.** Each chained land is emitted once and
  guarded by its parent's own `ALP_AT_LEAST_k` label, so a ring of one player slot with two
  flanking neutrals produces both neutrals for every player who is actually in the game, at
  whatever count that turns out to be. Nothing is wired by hand.
- **A fixed-count ring does not.** `Placement.parent` names one anchor, `expandShapeGroup`
  parents every member it builds to `group.parent`, and there is no form of either meaning
  "every member of this group". So the hexagonal example above is six placements plus twelve
  children, each child parented to its own member one at a time. The composition is reachable,
  it is not generated.

What makes the manual path tolerable is that it does not rot: `reExpand`'s departure rule
refuses to delete a member that has a child, releasing it instead with its parent, label,
children and last per-repeat literals intact (this section's own merge rule, below). So a
hand-wired chain survives a later change to `repeats` rather than breaking. A one-shot "copy
this chain onto every member" action would remove the tedium without introducing a binding
that has to be maintained, and is the recommended answer if this is ever built for fixed-count
rings.

#### Re-expansion: the merge rule (**resolved 2026-08-30**)

Sec.4.1 says re-expansion keeps nudges and happens only on an explicit act. It does not say
**which** nudges survive **which** edit, how a member is matched across a count change, or what
becomes of a member the new count has no room for. Those are three decisions, and rev 3 listed
all three as unwritten. This is them.

Throughout, re-expansion is the transition `(G_old, placements) → (G_new, placements′)`
triggered by an edit to `pattern` or `repeats`. An edit to `radius` or `rotation` moves every
base position but changes no membership, so it is the same rule with an empty leave set.

**The key is `(repeatIndex, slotId)`, and nothing already in the model can express it.**
`PatternSlot` gains an `id` (Sec.4.1). The two alternatives both fail on edits the panel
offers:

- **Flat index into `members` breaks whenever `pattern.length` changes.** `[P, A, B] × 3` puts
  (repeat 1, slot P) at `members[3]`. Re-expand to `[P, A] × 3` and `members[3]` is now
  (repeat 1, slot A) — a flat match hands the P land's nudge to an A land, a different role
  with a different terrain and a different `base_size`.
- **Slot *position* breaks on reorder**, and reorder is a supported edit: Sec.8's pattern editor
  is "a reorderable strip of role chips". `[P, A, B] → [P, B, A]` leaves every land where it is
  and every slot index pointing at a new role.

With ids, `(repeatIndex, slotId)` is stable across reorder, insertion, deletion of *other*
slots, and any `repeats` change — which is the entire set of edits that trigger re-expansion.

**`members` stays `string[]`**, ordered repeat-major then pattern order, length exactly
`pattern.length × repeats`, so `members[k]` carries the key
`(⌊k / pattern.length⌋, pattern[k mod pattern.length].id)`. The key is *derived* rather than
stored, and the old key is derivable at transition time because the transition holds `G_old`.
Storing it would be a second copy of a fact the array already carries — the same trade Sec.6.2
makes when it refuses an id comment and lets the constant name be the link. The ordering
invariant is what a re-expansion test should assert first, since every rule below is stated in
terms of it.

**What survives: `nudged` picks the branch, and that is what it is for.** Today
`nudged?: boolean` is a flag nothing reads. It becomes the discriminator:

- **`nudged` unset — the offset is base-derived.** Recompute it wholesale from `G_new`; there
  is no merge and nothing to lose. This is the branch that has to survive a *symbolic* group:
  a ring whose `rotation` is a `RandomParam` — Bulls_Eyes' `ROTATION_PLAYER`, exactly — expands
  to symbolic member offsets, and they must keep following the ring.
- **`nudged` set — the offset carries user intent.** Re-apply it as a **delta**:

  ```
  offset' = slotBase(G_new, i, s) + (offset - slotBase(G_old, i, s))
  ```

  derived at transition time and never stored. A delta rather than an absolute because the
  alternative visibly breaks the shape: drag the rotation gizmo and every nudged member would
  stay behind, which is precisely the "shape, but with exceptions" fork Sec.4.1 rejects one
  paragraph after introducing the group.

**One exclusion, and it is Sec.7.3's rule arriving somewhere else.** A nudged member whose
offset is not numeric-literal in every `Expr` — a typed formula, a `formula`-kind position, a
`RandomParam` reference the user wrote themselves — is **never rewritten**. It keeps what the
user wrote, and the panel lists it as *position-detached*, beside the role-detachment Sec.6.2
already reports. Sec.7.3 refuses to discard a formula because the user brushed the canvas;
re-expansion is a bigger brush and the reason does not weaken. The delta arithmetic is
therefore always numeric — which is sound rather than lucky, because a nudge is *made*
numerically (Sec.7.3's drag "edits `(r, θ)`"), so the case where symbolic arithmetic would be
collapsed to a literal is unreachable through the drag path and excluded by name on the one
path that could reach it.

**Members with nowhere to go are released, not deleted.** The leave set is every key present in
`G_old` and absent in `G_new` — a `repeats` decrease, a slot deletion, or both. Such a member is
**deleted only if nothing references it**, on three mechanical conditions:

1. no `Placement.parent` in the model points at it — deleting a parent orphans a chain, and
   Sec.4.5's closing argument is precisely that ring members *are* chain parents;
2. `nudged` is unset;
3. no `create_land` in the document references its emitted constants.
   `auditConstants(parse)` already computes the raw material
   (`ConstantUsage.useSpans`, `src/tools/builtin/constantsAuditor.ts`), but the
   condition is **uses outside the tool's own fence**, and the filter is not
   optional. `useSpans` is every appearance of the name in the file, and the fence
   contains its own: a chained child's position const references its parent's
   (Sec.4.2), so a parent would look referenced by arithmetic that is *about to be
   regenerated*. Counting those asks the tool whether its own output needs its own
   output, which is circular and answers yes forever. The fence's span is known —
   Sec.6.1 delimits it — so the filter is a span comparison, and condition 1 already
   covers the case that motivates most intra-fence references anyway.

Otherwise it is **released**: an ordinary free `Placement` at its current position, keeping its
parent, label, children and its last per-repeat literals, which simply stops following the group.

**Condition 3 is the one worth having written down, because the document had only half-stated
the hazard.** Sec.6.2 says deleting a `create_land` by hand leaves its constants unreferenced,
"which is harmless". The reverse is not harmless: the `create_land` lives *outside* the fence
and the tool does not own it, so deleting a member deletes `ALP_X_…`/`ALP_Y_…` out from under a
command that still names them, and the script is left resolving a constant nobody defined. A
shrink is the one ordinary edit that reaches that state, and nothing before this paragraph
prevented it.

Condition 3 also buys, with no special case, the behaviour the interactive path needs: **while
the user is trying counts out before ever pressing Apply, nothing in the document references
anything**, so `8 → 3` deletes cleanly and `8 → 3 → 8` leaves no litter. The rule that protects
applied lands gets out of the way of unapplied ones, without a mode.

**No confirm dialog — which reverses Sec.4.1's own sentence.** Sec.4.1 promises the panel "says
what it is about to overwrite before it does". Under the rule above **re-expansion overwrites
nothing that carries user intent**: growth is additive, nudges move as deltas, symbolic and
formula positions are untouched, and departing members are released unless provably
unreferenced. Nothing is left to warn about, and a confirm dialog on a harmless edit is worse
than no dialog — it teaches the user to dismiss the dialog, and the next one that matters is
dismissed the same way.

It is replaced by a **report after the fact** in the panel's own strip — *"Ring 1: 15 → 10
lands. 2 released and still on the map, 3 deleted."* — with a one-click delete for the released
pair. `Apply` is a single document edit and therefore a single `Ctrl+Z` (`useDocument.ts`
batches for exactly this reason: "a user who applied 40 changes should press Ctrl+Z once"), and
since the model rides in the fence header (Sec.6.1) undoing the text undoes the model with it —
**provided the panel re-reads the fence on external document change**, which is Sec.3.6's
dirty-tracking obligation and is named here rather than assumed.

**Four consequences, stated rather than left to be found.**

1. **Shrink→grow is not a round trip.** `5 → 3 → 5` leaves the two released members on the map
   *plus* two fresh ones at the same keys. Re-adoption is rejected: a released placement is
   ordinary, and remembering ghost membership so it can be reclaimed is exactly the hidden
   mechanism Sec.6.2's "the escape hatch is the absence of a mechanism" refuses. The report's
   one-click delete is the cleanup, offered while the user still knows why those lands appeared.
2. **Growth moves every land, not only the new ones.** `N = pattern.length × repeats` is in the
   denominator of Sec.4.5's own angle formula, so raising `repeats` re-spaces the whole ring.
   Additive in membership is not additive on screen, and this is the first thing that will
   arrive as a bug report.
3. **`ZonePolicy` and `assignToPlayer` need no merge rule.** Both derive from the repeat index,
   so both recompute. A released member keeps its last values as literals, which is what
   Sec.6.2 already says per-repeat values are.
4. **No migration.** `PatternSlot.id` changes the shape of the `@alp-model` v1 JSON, and there
   is no v1 data anywhere — no panel has ever written a fence. A later session should not build
   a migration path for data that never existed.

---

## 5. The math compiler

The centrepiece. The brief asks for "a clever way to turn the user input into
left-associative RMS compatible maths"; the honest answer is that the cleverness is in
*refusing* to be clever, and in verifying afterwards.

### 5.0 `Expr` (**new in rev 3**)

Rev 2's Sec.4.1 used `Expr` in fourteen slots and never defined it. That is not a
presentation gap — `Expr` is where four separate constraints from four separate sections
have to meet, and writing it down is what makes them checkable:

```ts
/**
 * Every NUMERIC quantity the tool owns. Discriminated union on `k`, plain JSON
 * data (no functions, no cycles, no class instances), because Sec.6.1 round-trips
 * the whole model through JSON.parse of a comment.
 */
type Expr =
  /** A finite literal. Non-finite is `inf`; NaN is not representable. */
  | { k: "num"; v: number }
  | { k: "inf"; sign: 1 | -1 }
  /** A `#const` the script already defines, by name. Never one the tool emits. */
  | { k: "sym"; name: string }
  /** A hoisted rnd (Sec.4.4). Resolves per player when `perPlayer`. */
  | { k: "param"; id: string }
  /** Another placement's own quantity — Sec.4.2's INBOUND, and Rage Forest's bisector. */
  | { k: "node"; id: string; field: "x" | "y" | "theta" | "inbound" }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "%"; l: Expr; r: Expr }
  | { k: "neg"; e: Expr }
  | { k: "sin"; e: Expr }
  | { k: "cos"; e: Expr };

/** A NAME-valued slot: terrain_type, base_terrain. Separate domain from Expr. */
type Ref = { k: "name"; name: string } | { k: "id"; id: number };
```

**Four absences, each one a rule enforced by the type instead of by a validator.**

- **No `rnd` arm.** `rnd(a,b)` is only legal as a whole `#const` value (Sec.5.1), so a random
  draw is a `RandomParam` referenced by `{ k: "param" }`. Rev 2 stated the hoisting rule
  three times in prose; here it is unrepresentable to break.
- **No `Infinity` inside `num`.** `JSON.stringify(Infinity)` is `null`, and `-inf` is the
  truncation idiom Sec.5.4 depends on, so it gets its own arm. This is exactly the problem
  `tools-api/index.ts` already solved with `WireNumber`, and the fix is the same shape.
- **No name arm that could carry a terrain.** Rev 2 typed `LandRole.terrain` as `Expr`.
  **A terrain is a name, not a number**, and this repo has already paid for mixing the two:
  BUG-015 split `InstantiatedScript.aliases` out of `symbols` rather than widening it to
  `number | string`, precisely so that the slot a name is written in decides its domain.
  `terrain: Ref` follows that decision instead of re-litigating it.
- **No cycles.** `parent` and `{ k: "node" }` both address by id, so the model is a plain
  tree of JSON values and the fence's `JSON.parse` is total. Cycle detection is a graph
  invariant checked on edit, not a serialisation problem.

And one **addition** rev 2's model could not express, found by reading `Rage Forest 2026.rms`
rather than by design: `{ k: "node" }`. That map writes

```
#const T_PERP (T1 + T2 / 2)      /* left-associative: (T1 + T2) / 2 */
```

— a placement whose angle is the **bisector of two other placements' angles**. Rev 2's
`Placement.offset` can reference script symbols and nothing else, so the whole construct was
inexpressible and the importer would have had to decline it. It is one union arm. The same
arm is what makes Sec.4.2's `INBOUND_p` a first-class quantity rather than a naming
convention, which is what let rev 3 notice that it never needs emitting at all.

**Where `Expr` is evaluated is a design property, not an implementation detail.** The same
tree is walked three times, and they must not diverge: the vector tier draws from it
(Sec.7.2), the compiler emits from it (Sec.5.3), and Sec.5.5's self-check evaluates it
independently to compare. One traversal, three consumers, and Sec.5.5's exact-equality
assertion is what proves they agree.

### 5.1 What RMS actually does

From `docs/parser-design.md` Sec.2.2, **amended 2026-08-29** by two sources the repo did not
have: a Discord report of undocumented patch behaviour, and
`github.com/twestura/RMS-Trigonometry-Example`.

- Evaluation is **strictly left-to-right. No precedence. No nested parentheses.**
- Operators are `+ - * / %` only. There are **no comparison operators** and no arrays.
- A nested `(` operand is **silently dropped**, along with its operator — the guide's own
  example `(GOLD_COUNT + (5 + 2))` yields 8.
- `+ - * /` **do not round**. Floats flow through; rounding happens only where a float
  reaches an integer-only attribute, and 0.5 rounds up (Zetnus).
- `inf`, `-inf` and `-0` are real float values.
- `rnd(a,b)` is **invalid inside an expression**; it may only be a `#const`'s entire value.
- `if` **cannot test a constant** — only an RMS label. (This is what keeps Sec.12 Q3's
  `2_PLAYER_GAME` ladder legal, and it is why Bulls_Eyes' own `MAPSIZE` ladder is legal.)
- An unresolvable operand after the first is dropped and evaluation continues; an
  unresolvable *first* operand makes the whole expression unresolvable.

#### `%` is a cast, and this is the amendment

> `X % Y`: cast **both** operands to int; take the remainder of `|(int)X| / |(int)Y|`;
> return it with **the sign of X**.

Two consequences, and the second is load-bearing for this whole document:

1. **If `|Y| > |X|` then `X % Y == (int)X`.** So `%` is the language's only rounding
   operator, it rounds **toward zero**, and `X % -inf` is the idiom for "truncate".
2. **Any `% n` truncates its left operand to an integer as a side effect**, whether or not
   the programmer wanted a remainder. Sec.5.4 is entirely about this.

~~**The repo currently implements this incorrectly**~~ — **fixed, and re-verified for rev 3.**
`mathEval.ts`'s `mod()` used to special-case a zero or non-finite divisor (`Math.trunc(left)`,
correct) and otherwise return JS's `left % right`, which does **not** cast: `5.7 % 3` gave
`2.7` where the engine gives `2`, and `51.43 % 360` gave `51.43` where the engine gives `51`.
The sign rule *was* measured and *was* right — ⚠ verify #18 was answered 2026-08-11 by
`RMSTEST_47` against `-7 % 2`, `7 % -2`, `-7 % -2` — but every arm of that test used integer
operands, so it pinned the sign and never exercised the cast. The two facts are orthogonal
and the second was never in evidence.

`mod()` now truncates both operands, guards a non-finite dividend against `NaN`, and
**returns the truncated left operand for a zero divisor** — that last branch was an owner
guess on 2026-08-29 and was **measured on 2026-08-30** by `RMSTEST_64`, which reversed it
(Sec.12 Q5 follow-up 2, `known-issues.md` BUG-022). **Rev 3 confirmed the property before
building on it** rather than citing the fix: `Math.trunc` on both sides, read out of the live
function, and 4,000 fractional angles pushed through the real macro (Sec.5.4). Sec.5.5's
oracle is sound, and as of 2026-08-30 every branch of it is measured rather than argued. This
paragraph is kept rather than deleted because the *lesson* is what decays slowest —
**a measurement pins the property its arms varied**, which is the Hard rule this bug
produced, and Sec.5.4 closes on the same point.

So `(180 * S - R * R)` is `((180 * S) - R) * R`. Bulls_Eyes is written that way on purpose
and reads as ordinary algebra only by accident.

### 5.2 Front end

Ordinary precedence-climbing parser over: numbers, identifiers, `x`, `y`, `( )`, unary `-`,
binary `+ - * / %` **with conventional precedence**, and the call forms `SIN(e)`, `COS(e)`,
`rnd(a, b)`. The user writes maths the way maths is written. Precedence is theirs; making
them think left-associatively is the job we are removing.

Output is an expression tree, then hash-consed into a DAG so that identical subtrees — most
importantly `SIN(θ)` and `COS(θ)` sharing a θ — are one node.

### 5.3 Back end: the emit rule, which is exact

> **A DAG node emits as one `#const` iff, walking its left spine, every right-hand operand
> is a leaf** — a literal, a pre-existing script symbol, or an already-emitted temp name.
> The chain is then `L op R op R op R …`. Any right operand that is itself an operation is
> emitted first, as its own `#const`, and referenced by name.

**That is sound, decidable in one pass, and incomplete — rev 3 ran it and it spills.** Two
normalisations have to happen *before* the rule is applied, and neither is optional:

> **(a) Re-associate a uniform `+` or `*` chain onto the left spine.** `a + (b + c)` is a
> legal RMS left spine written `a + b + c`. Rev 2's rule sees a non-leaf right operand and
> spends a temp. Restricted to `+` and `*` and to a chain of one operator: `-`, `/` and `%`
> are not associative and re-associating them changes the answer.
>
> **(b) Fold adjacent integer literals in that chain.** `DEGREES_P1 + 180 + -135` is
> `DEGREES_P1 + 45`. Restricted to integers, so the fold is exact without consulting the
> evaluator; a pair of float literals goes to Sec.5.5 rather than being folded here.

**Measured cost of leaving them out** (Sec.10.1's run, Bulls_Eyes' eight lands): rev 2's rule
as written emits **118** `#const`s against the hand-written **104**, of which 8 are the
`INBOUND_*` consts Sec.4.2 now deletes and 6 are temps for `ROTATION_AUX + VAR_An`. With (a)
it emits 104 with 4 lines differing; with (a) and (b) it emits **104, all 104 byte-identical**
after normalising parentheses and whitespace. On a tool whose stated purpose is to delete
`#const` lines, shipping 14 spurious ones would have been the wrong first impression, and
nothing but running it was going to say so.

Note that (a) and (b) are *not* the "clever inlining" this section refuses. They are
canonicalisations of the input tree, they are decidable, and their output still goes through
Sec.5.5's round-trip like everything else — which is what covers the one case where `+`
re-association is not exact, two float literals whose IEEE sum depends on grouping. The
compiler proposes; the evaluator disposes.

Two further consequences worth stating because they surprise people:

- **Input already in RMS form emits as one line.** `180 * S - R * R` *entered as*
  `((180 * S) - R) * R` is a pure left spine with leaf right-operands, so it emits verbatim.
  Generated output looks like the hand-written map, not like machine vomit.
- **Input in conventional form costs temps, correctly.** `180 * S - R * R` meaning
  `(180*S) - (R*R)` has `Mul(R,R)` as the right operand of the subtraction, which is not a
  leaf, so:

  ```
  #const ALP_T1 (R * R)
  #const ALP_P  (180 * S - ALP_T1)
  ```

  A user who wants the one-liner can parenthesise for it, and the panel shows the emitted
  line count live so the trade is visible while they type.

Unary minus lowers to `* -1` when the operand is a leaf (matching `CR_P1`'s own
`% 360 * -1 + 180`), otherwise to a temp then `* -1`. Negative literals ride inline as
operands, which is legal and is what the corpus does.

`rnd(a,b)` is **hoisted**: it becomes its own `#const NAME rnd(a,b)` and every use becomes a
reference. This is forced by the language, and its semantic consequence — one draw shared,
or one draw per player — is the `perPlayer` checkbox of Sec.4.4.

### 5.4 `SIN` / `COS`, and why the macro cannot be broken from outside

`SIN(θ)` expands to Bulls_Eyes' own macro, which is Bhaskara I's sine approximation carried
out in left-associative integer-friendly arithmetic:

```
#const R_k    (θ % 360 + 360 % 360 * -1 + 180)     /* fold to (-180, 180]; sin(180-n) = sin(n) */
#const S_k    (R_k * 2 + 1 % 2)                    /* sign(R_k), as ±1 */
#const P_k    (180 * S_k - R_k * R_k)              /* (180·|R|-|R|²) with sign folded in */
#const D_k    (40500 - P_k)
#const SIN_k  (S_k * 4 * P_k / D_k)                /* 4P / (40500 - P) */
```

and `COS(θ)` reuses `R_k`, adding five more (`CR CS CP CD COS`) via `cos(θ) = sin(θ+90)`.
So **SIN and COS on a shared angle cost ten lines together, not twenty** — exactly the
sharing the hand-written map does, and here it falls out of the DAG hash-consing in Sec.5.2
rather than out of discipline.

#### The macro guards itself, and rev 1 got this wrong

`S_k = (R_k * 2 + 1) % 2` yields ±1 **only when `R_k` is an integer** — at `R = 2.5`,
`(2·2.5+1) % 2` would be `6 % 2 = 0`, and `S = 0` collapses the whole macro to zero. Rev 1
concluded from this that every angle reaching the macro must be integral, and that a circle
of 7 lands (`360 / 7 = 51.43°`) would therefore stack every land on the map centre.

**That is wrong, and Sec.5.1's amendment is why.** `R_k`'s own first operation is `θ % 360`,
and `%` casts its operands to int. So `51.43 % 360` is `51`, and `R_k` is an integer **for
any θ, float or not**. Every subsequent step (`+ 360`, `% 360`, `* -1`, `+ 180`) preserves
integrality, so `S_k` is always ±1 and the macro is **self-guarding by construction**. This
looks deliberate rather than lucky.

**Rev 3 measured it rather than re-deriving it a third time.** The macro's five lines were
pushed through `evaluateExpressionTokens` — the same evaluator Sec.5.5 trusts — at 4,000
fractional angles spanning −1000° to +1054° in steps of 0.5137°. **`S` came back ±1 on every
one; the failure count is 0 of 4000.** Two revisions reached opposite conclusions about this
from the same code, so the reading that settles it is a run, not a third argument. The same
sweep also priced the approximation: over every integer degree, worst `|sin|` error 0.001630
and worst `|cos|` error 0.001630, which is the Bhaskara bound and confirms the macro is a
faithful implementation of it rather than a mangled one.

Three things follow, and they are the useful residue of a wrong conclusion:

1. **The sine macro has 1° resolution, always.** Not a limitation to design around — a fact
   to state in the UI, because a user typing `51.43` and reading back `51` should be told
   why rather than left to discover it.
2. **Emitting integer literals is still right, now on quality grounds rather than
   correctness.** The engine's cast truncates (max error 1.0°); the compiler rounds to
   nearest (max error 0.5°). The tool knows `pattern.length × repeats` at emit time
   (Sec.4.5), so it emits `0, 51, 103, 154, 206, 257, 309` rather than `360 / 7 * i` — half
   the angular error, fewer emitted lines, and readable output.
3. **`%` is the truncation primitive**, so anywhere this tool needs to force an integer it
   has one — `X % -inf`, or any `% n` with `n` larger than the operand. No guard needs
   inventing.

The lesson worth keeping is not the trap but the reason rev 1 fell into it: **the repo's own
evaluator was the oracle, and it was wrong in exactly the place the argument depended on.**
Sec.5.5's self-check inherits that hazard directly, which is why Sec.5.1 says fix `mod()`
first.

### 5.5 Verification: the compiler checks its own homework

Both halves already exist in this repo and neither was built for this:

- `instantiateScript(parse, refDb, settings, seed)` returns `symbols: Map<string, number>` —
  the script's resolved constant table, computed the way the engine computes it.
- `evaluateExpressionTokens(tokenTexts, resolveConstant)` evaluates a token list under exact
  RMS semantics, `/0 → 0` and truncating `%` included.

So after emitting, and **before offering a single edit**:

1. Seed a resolver with the script's own symbols.
2. Walk the emitted `#const`s in order, evaluating each with `evaluateExpressionTokens` and
   adding the result to the resolver — i.e. read the generated block back exactly as the
   engine will.
3. Independently evaluate the user's original DAG under the same operator semantics.
4. Assert **exact equality**, not a tolerance. Both sides use identical operator rules, so
   any difference is a compiler bug, and a tolerance would hide precisely the class of bug
   worth catching. The one sanctioned inexactness is Sec.5.4's angle rounding, which happens
   *before* step 3 and so is common to both sides.

On disagreement the tool emits nothing and reports the offending node. A compiler that can
only ever be wrong loudly is worth more here than one that is usually right.

Two facts make this cheap rather than aspirational: the whole check is pure arithmetic over
a few dozen constants, so it runs on every keystroke; and it is the same code the preview
will use, so a divergence between "what the tool promised" and "what the preview draws" is
not expressible.

### 5.6 Names

Generated symbols are prefixed `ALP_` and suffixed from `Placement.label` (slugged) plus a
disambiguator. Before emitting, the tool checks every candidate against
`parseResult.symbols` and against `language.json`'s reserved words, and renames on collision
rather than shadowing — first-definition-wins is the engine's rule (`instantiate.ts`), so a
shadowing emit would silently do nothing, which is the worst available failure.

---

## 6. What it writes

### 6.1 One fenced region, regenerated wholesale

```
/* @alp v1 begin — Advanced Land Placement. Do not edit inside this block by hand.
   @alp-model {"v":1,"nodes":[…]} */
#const ALP_DEG_P1 …
…
/* @alp end */
```

The model rides in the fence header as JSON in a comment, so it **round-trips exactly** and
there is no sidecar file. This is not a new idea in this repo — `docs/source-languages-design.md`
Sec.4.1 already establishes the pattern and its rules, and they carry over unchanged:

- Only the fenced block is read. Only `@alp-*` keys are read.
- A missing or malformed `@alp-model` means **no association** — the script is a plain RMS
  script and the tool starts empty. It never repairs and never guesses.
- Nothing in the banner can name an executable or a path.

Rejected alternatives: a sidecar `.json` (a second file to lose, and the `.rms` stops being
self-describing); and reconstructing the model from the emitted RMS on every open (it is
lossy — `frame`, labels and grouping are not recoverable from the arithmetic).

The block is regenerated wholesale on Apply. Everything outside it is byte-identical. That
is the same invariant the script formatter earns a different way — it never changes a token,
only whitespace between tokens — and it is the reason both tools can be trusted with a file
someone spent a month on.

#### The comment is not inert, and a check cannot make it safe (**added 2026-08-30**)

The header carries the model as JSON **inside an RMS comment**, and this repo has already
established that RMS comments are not inert text. `src/hooks/scriptHeader.ts` carries both halves
in its own header comment, from the banner feature that paid for them:

1. **Comment markers are whole tokens.** `src/parser/lexer.ts` splits on whitespace and only
   *then* asks whether a token IS `/*` or `*/`. A closing `====*/` does not close the comment —
   it lexes as one `word`, and every line below it stays commented out, silently, with the map
   still generating. Each marker has to stand alone, whitespace-separated.
2. **A word inside a comment that resolves to 69 opens a second comment.**
   `commentOpensNestedComment` (`src/parser/diagnostics.ts`), diagnostic **RMS0111**, over the
   script's own `#const`s and over game constants alike: the next `*/` closes only the inner
   comment, and every line below is invisible to the engine. The map still generates, missing
   everything after that point.

Hazard 2 lands on this section and on nothing else the tool writes, because the fence header is
**the only place the tool puts user-authored text inside a comment**. Every `label` in the model
— `Placement.label`, `LandRole.label`, `RandomParam.label` — is typed by the user and serialised
straight into that JSON. A label that happens to be a name resolving to 69 comments out the rest
of the script.

**The obvious fix is unsound, and it is unsound by this repo's own hard rule.** Serialise, walk
the tokens, ask whether any of them resolves to 69, escape the ones that do — that is reference
data used as a *negative* authority. `game-constants.json` holds a few dozen of several hundred
constants, so a name found proves danger and a name **not** found proves nothing whatever. A
validator built that way is green on exactly the scripts whose constants this repo does not know,
which is the failure the positive-resolver rule exists to forbid.

**So the property is structural rather than checked: the fence header contains no token that can
be read as a word.** The model payload is emitted as a single opaque token, and no serialisation
of user text ever reaches the comment as bare words. Which encoding is the build session's call;
what is pinned here is that the hazard must be **unrepresentable** rather than validated — the
same move Sec.3.8 makes when one handle per tool makes a leak unrepresentable, and Sec.5.0 makes
when `Expr` has no `rnd` arm. A stray `*/` inside the payload is closed off by the same property.

The cost is a header that is no longer readable at a glance, and that is the right trade. The
model round-trips exactly either way, this section never promised a legible header, and the
failure it buys out of is silent, total, and reported by nobody.

### 6.2 References, not values — the link needs no marker

Everything the tool writes into a `create_land` is a **reference to a constant inside its own
fence**. It never writes a literal there and it never owns the block:

```
create_land
{
terrain_type    ALP_ROLE_NEUTRAL_B_TERRAIN     /* role (Sec.4.5) */
base_size       ALP_ROLE_NEUTRAL_B_SIZE        /* role */
land_position   ALP_X_R2_S3 ALP_Y_R2_S3        /* placement (Sec.5) */
zone            22                             /* per-repeat literal — not a role const */
}
```

**The constant name is the link.** No `/* @alp:n7 */` marker, no id comment, nothing for a
formatter or a hand-edit to disturb. Consequences, all of them good:

- Delete the `create_land` by hand → its constants go unreferenced, which is harmless and
  which the constants auditor already reports.
- Hand-edit `terrain_type` to a literal → that land detaches from its role, keeps the value
  you gave it, and the panel reports it as detached instead of silently reasserting itself.
  The escape hatch is the *absence* of a mechanism.
- Breakdown keeps full ownership of the block. It can edit any attribute of any land at any
  time; the tool's fence is upstream of all of it and never argues.

The one thing written as a literal rather than a reference is a **per-repeat** value — `zone`
under a `perRepeat` policy, and `assign_to AT_PLAYER n` — because it varies per instance and
a shared constant is exactly the wrong shape for it.

Creating a land from a shape button emits a `create_land` skeleton wired to its role's
constants; from that moment the tool owns only what is inside the fence.

### 6.3 A check the tool owes

`land_position` on a land with `assign_to AT_PLAYER` does nothing useful unless
`<PLAYER_SETUP>` declares `direct_placement` — Bulls_Eyes and Venn both declare it. Placing
a player land without it is a silent no-op in the "your map is fine" direction, so the panel
raises it as a warning with a one-click fix.

### 6.4 Import: run over the three maps that have the idiom (**rev 3**)

Opening Bulls_Eyes with no `@alp` fence, the tool offers: *"This script looks like it has 8
hand-written angle placements. Adopt them?"* The import is a **preview-and-confirm diff**,
never automatic, and anything it cannot read confidently is left alone and reported rather
than approximated. That part of rev 2 stands. Everything else in this section moved, in both
directions, because rev 3 built the recogniser and ran it.

**The population is three maps and it was established rather than assumed.** One grep for
`40500` over the 34 corpus maps returns `Bulls_Eyes.rms`, `Venn.rms` and
`Rage Forest 2026.rms`, and the same three answer a grep for `COS_`. There is no fourth.

#### The idiom is community-only, and that reprioritises this section

Swept over the DE install (211 official `.rms` plus 81 `.inc`, 2026-08-29):

| | official DE scripts |
|---|---|
| `land_position` uses | **10,226** |
| …whose operand is a `#const` name | **0** |
| files containing `40500` | **0** |
| files containing `SIN_` / `COS_` / a trigonometry macro | **0** |
| `rnd` as a term inside an expression | **0** |

**Not one official map computes a land position.** Every one of the 10,226 is a literal or a
whole-argument `rnd()`. The technique this whole document is about is an expert-community
invention that the game's own designers never use — which is the strongest available
statement of the barrier this app exists to lower, and it is also a scheduling fact:

> **The importer serves 3 scripts out of the 245 on this machine. The authoring path serves
> all of them.** Build the compiler and the panel first; the importer is the deferrable half,
> and rev 2 had them the other way round by implication rather than by decision.

The second half of that sweep is a warning about scope. `Arena.rms` alone carries **3,774**
literal `land_position` uses, and Venn carries 463 — hand-drawn geometry at literal
positions, at a scale no chain-and-shape model addresses. **That is a different feature** (a
tile painter), it is explicitly out of scope, and the importer must not offer to adopt one
line of it.

#### Recognition runs backwards from `land_position`, not forwards from the macro

Rev 2 specified "pattern-matching the Sec.5.4 macro shape plus the `X_* / Y_*` pair". **Both
halves fail on the third map, and they fail in the direction that produces confident
nonsense.**

| | Bulls_Eyes | Venn | Rage Forest |
|---|---|---|---|
| polar position consts, found structurally | 16 | 16 | **18** |
| …of which named `X_*` / `Y_*` | 16 | 16 | **2** |

Rage Forest names its position pairs `X1/Y1`, `A1/B1`, `POND_X1/POND_Y1` and
`X_PERP_0/Y_PERP_0` — **four naming schemes in one file**, of which the rev-2 rule matches
one. A name-keyed recogniser reads that map as having two placements when it has ten.

Worse, the forward direction is unsound even where it matches. Rage Forest has 18 macro
blocks visible in the AST and **zero visible lands** (below), so a recogniser that starts
from the macro would offer to adopt eighteen placements on a map where it cannot see a single
`create_land`. **Start from `land_position`, take the two symbol names it references, and
walk the `#const` DAG backwards.** That rule is name-blind, it terminates, and it can only
ever propose a placement that a real land actually uses.

The walk is mechanical: `X = <radius> * <cosName> + <anchorX>`; `cosName` must resolve to
`(S * 4 * P / D)`; that `P` must resolve to `(180 * S − R * R)`; that `R` must resolve to
either the fold `(θ % 360 + 360 % 360 * -1 + 180)` (the sine arm) or `(270 − R' % 360 * -1 + 180)`
(the cosine arm, which reuses the sine's `R`). Whatever sits at `θ` is the angle, and it is
an `Expr` (Sec.5.0), not necessarily a leaf.

#### What it actually adopts

Run over the three maps, per distinct position pair:

| map | pairs | ADOPT | reason for the rest |
|---|---|---|---|
| `Bulls_Eyes.rms` | 8 | **8** | — |
| `Venn.rms` | 8 | **8** | — |
| `Rage Forest 2026.rms` | **0** | 0 | nothing to read (below) |

**Rev 2's stated reason for calling the importer best-effort was wrong.** It named Venn's
`X_P1_TC (RADIUS_PLAYER_LANDS + DIST_TC_FROM_CENTRE * COS_P1 + 50)` as a varied idiom that a
near-miss recogniser would half-adopt. It is not a near miss. Left-associatively that reads
`((RADIUS_PLAYER_LANDS + DIST_TC_FROM_CENTRE) * COS_P1) + 50` — a **compound radius**, which
is an ordinary `Expr` in the `r` slot and adopts exactly. Both of Venn's TC lands come in
clean. Rage Forest uses the same idiom for a different purpose (`A1 = (R + R_OFF_2V2_1) * COS_U1 + 50`,
a per-slot radius jitter), so it is the **majority** spelling across the two maps that use
it, not an outlier. Rev 2 read the arithmetic with school precedence in the one place the
whole document is about not doing that.

And the second half of Venn, which rev 2 never counted: **463 of Venn's 471 `create_land`
commands are literal-position wall segments**, on the 1.2-tiles-per-percent lattice of
Sec.4.3. The importer must not offer to adopt those — they are hand-drawn geometry, not a
computed layout, and folding them into a fence would be the worst possible outcome for that
file. Literal positions are reported and left alone; only symbolic pairs are candidates.

#### Rage Forest is the interesting case, and the trigonometry is not why

The tool sees **nothing** in that map. Not "cannot adopt" — cannot see:

| | in the file | reaching the AST |
|---|---|---|
| `create_land` | 30 | **0** |
| `land_position` | 10 | **0** |
| `<LAND_GENERATION>` sections | 3 | **0** |
| parser **errors** | | **0** |

Lines 1131 to 5345 — **90,719 characters, 70.9% of the file** — are one `RawNode` inside
`<PLAYER_SETUP>`, emitted by the parser's own `RMS0110`: *"This code mixes if/random with
command structure in a way that must be shown as raw code — it is valid RMS."* That is the
project's never-silently-drop rule working correctly. The consequence for this tool is
absolute and it is not about trigonometry: **the 18 macro blocks in the preamble are visible
and every land that uses them is not.** The importer finds no candidates, offers nothing, and
looks exactly like it looks on a map with no computed placement at all.

`RMS0110` is severity **info**, so nothing prominent tells the user why. Sec.9 is the
precondition this creates, and Sec.8's panel is where it has to be said.

Declining an import leaves the script untouched and the panel empty; the user can still build
a new layout beside the old one and delete the old by hand.

---

## 7. The canvas (left)

### 7.1 Cut at the end of land generation

`truncateAst(parse, cutOffset)` already does exactly this, and `resolveCutOffset` already
computes offsets from positions.

**Rev 1 had the panel seize the pane's shared Current/Final cut while mounted and restore it
on unmount. Sec.3.4 deletes that**, and the deletion is the clearest single benefit of
answering Q7 the way it was answered. `cutOffset` is a **parameter of the layer-1 `generate`
request**, so the panel asks for a generation cut at the end of `<LAND_GENERATION>` and gets
exactly that, without touching view state it does not own and without a second pipeline —
layer 1 *is* the pipeline, and every other tool shares it.

The user's own Current/Final pin stays theirs, and it keeps working while the panel is open.
A tool that wants to reproduce the pane exactly still reads the pane's cut through
`read-preview-view`; a tool that wants its own cut simply asks for one. Those turn out to be
two different needs, and rev 1 had conflated them into one capability with a write half.

**Amended 2026-08-31 (slice 4b).** "`cutOffset` is a parameter of the layer-1 `generate`
request... layer 1 *is* the pipeline" describes the wire contract every OTHER tool (built-in
or external) uses; the Land Placement panel itself does not go through it. Sec.3.4's own
"in-process built-ins get the same API backed by the live object with zero copy" turned out to
mean, in practice, that the panel's Full tier calls `usePanelPreviewResultContext()` — a
second instance of the SAME `usePreviewResult` worker pipeline the document's own preview
uses (`PreviewResultContext.tsx`'s `createPreviewResultChannel`), with its own pinned seed
(Sec.3.3, `panelPreviewSeed.tsx`) and its own `cutOffset` (still exactly the rule stated
above, still computed by `resolveLandGenerationCutOffset`). `PreviewHandleStore` (layer 1's
own implementation, `runPreview.ts`) was deliberately NOT used for this: its `generate`
message returns a grid-less `PreviewSummary` and `sliceRequest` returns only
`terrain`/`elevation`, neither carrying the `layer`/`cliff` data `buildTerrainBitmap` needs.
Layer 1 remains correct and necessary for every tool that is not in-process with a direct
line to `generatePreview` already open — see `docs/build-log.md`'s 2026-08-31 "Land Placement
Slice 4b" entry, item 4, for the full reasoning.

**"The end of `<LAND_GENERATION>`" is not always a well-defined offset, and rev 3 pins the
rule.** A script may declare the section more than once — `Rage Forest 2026.rms` has three,
one per game mode, selected by `if` branches — and a script may put it last, as
`24hr_Petra.rms` does. So:

> The cut offset is the start of the **first section that follows the last
> `<LAND_GENERATION>` in source order**, or the end of the document if there is none.

That is the offset that keeps every land in the script, which is the property the panel
needs; cutting at the *first* `<LAND_GENERATION>` would silently drop the layouts a
multi-mode map defines later, and those are exactly the ones a placement tool exists to edit.
The corpus as the AST sees it has zero maps with more than one such section and one map where
the rule degenerates to no cut at all (Petra, Sec.7.2 finding 2) — but the rule is stated
from the construct rather than from the corpus, because the corpus is 34 files and the
construct is legal RMS.

### 7.2 Two render tiers (**re-derived 2026-08-29**)

⚠ **Rev 2 cited `tools-api/index.ts`'s "median ~460 ms and up to 3.8 s" — a figure this repo
superseded on 2026-08-15 and left in place.** `consistency-checker-design.md` Sec.4.4 measured
775–794 ms median over the same corpus and named the cause (BUG-013 gave `24hr_Petra.rms` 384
land origins and nobody re-timed), in a section whose own opening sentence is *"on numbers
measured for this revision, because the older figure had drifted 1.7× while sitting in a
document"*. Rev 2 re-cited the drifted number **out of the file that carries the warning
against re-citing it**. This is the repo's own decay rule landing on a design doc one
revision old, and it is the cheapest of the six passes to have run.

Worse, the re-cite priced **the wrong quantity**. This panel never asks for a full
generation: Sec.7.1 has it request a cut at the end of `<LAND_GENERATION>`. Nobody had
measured that, in this document or any other.

**Measured this revision, all 34 corpus maps, `collectSnapshots: false`, 5 reps after a warm
run, this machine:**

| | Normal, full | Normal, land-cut | Giant, full | Giant, land-cut |
|---|---|---|---|---|
| median | 577 ms | **49 ms** | 920 ms | **78 ms** |
| mean | 658 ms | 175 ms | 1050 ms | 279 ms |
| worst | 3137 ms (`24hr_Petra`) | 3454 ms (`24hr_Petra`) | 5045 ms (`24hr_Petra`) | 5094 ms (`24hr_Petra`) |
| median ratio | | **0.129** | | **0.131** |

Read the same ±50% caution `consistency-checker-design.md` Sec.4.4 attaches to its own table:
this machine spans a 3.7× load factor and these are one reading. **The level to trust is the
ratio, not the milliseconds** — the two columns were taken in the same run under the same
load, so the load factor divides out of the ratio and does not divide out of either column.

**Three findings, and the third is the one that changes the design.**

1. **The land cut is worth about 8× at the median.** 49 ms at Normal is three frames, not
   sixty, so it is nearly interactive on a median map — a materially different situation from
   the 460 ms rev 2 designed against.
2. **The saving is not uniform, and its worst case is `24hr_Petra.rms` at 1.01× — no saving
   at all.** The reason is structural rather than statistical: Petra puts `<LAND_GENERATION>`
   **last**, after `<OBJECTS_GENERATION>`, so a cut at the end of it is a cut at end of file.
   It is the only corpus map with that layout, and it is the map that dominates every worst
   case in this table for a separate reason (384 origins over 30,926 tiles). **A cut buys
   nothing on a script whose cost is in land generation itself**, which is exactly what a
   cut at the end of land generation cannot avoid.
3. **The maps this tool is for are the expensive ones.** Venn's land-cut is **323 ms at
   Normal and 1279 ms at Giant** — second worst in the corpus — because 471 `create_land`
   commands is a lot of land generation, and a fence-editing tool is disproportionately
   likely to be pointed at a script like that. The median is reassuring and it is not the
   number to design against.

So the two tiers stand, with their justification replaced:

| Tier | When | What |
|---|---|---|
| **Vector** | every pointer move, 60 fps | Model only: land seed positions as circles at `base_size`, chain edges, shape gizmos. No terrain, no generation. Pure function of the graph. |
| **Full** | drag end, debounced ~250 ms | One layer-1 `generate` request at the pinned seed and the panel's own `cutOffset`, drawn underneath the vector layer. |

The vector tier is drawable *straight from the model* — the compiler's own float evaluation
of each node (Sec.5.5 step 3) is already the position, so there is nothing extra to compute
and no risk of the overlay disagreeing with what will be emitted. **Measured, that is cheap
by two orders of magnitude**: re-evaluating Bulls_Eyes' entire 143-const table through
`evaluateExpressionTokens` costs **0.173 ms**, or 5,785 Hz — **97 full re-evaluations inside
one 16.7 ms frame budget**. The vector tier is not a compromise forced by the full tier's
cost; it is free, and it would be the right architecture even if generation were instant.

**The debounce is the number that should be revisited first.** 250 ms was chosen against a
460 ms generation; against a 49 ms median it is conservative and against Venn's 1279 ms it is
optimistic. The honest rule is **adaptive**: debounce to the last measured land-cut duration
for *this* script, floored at 100 ms, since the panel gets that measurement free on every
generation it already runs. A fixed constant is wrong at both ends of a 26× spread.

### 7.3 Interaction

`projection.ts` supplies both directions already: `latticeToScreen` to draw,
`screenToTile` to hit-test.

- **Click** a land → selects it, right panel scrolls to it.
- **Drag** a land → moves it. Which numbers change depends on `frame`: radial edits
  `(r, θ)`, absolute edits `(dx, dy)`. Children follow, live.
- **Drag from a land's rim handle to another land (or the centre marker)** → creates the
  chain, computing the offset that leaves the child exactly where it is (Sec.4.2).
- **Shape buttons** create a group at map centre; then a radius handle and a rotation handle
  (every kind), a count stepper, and — for `line` and `arc` only, per
  `docs/land-placement-shape-kinds-escalation.md` §7 — one more: a line's near end, or an
  arc's own sweep. A perimeter kind (`square`/`triangle`/`polygon`) needs no third handle,
  since radius and rotation already determine every vertex.
- **A node whose position is `formula`** is draggable only if the formula is invertible in
  the dragged coordinate; otherwise the handle is a read-only marker and the panel says why.
  Silently discarding a user's formula because they brushed the canvas is unacceptable.

~~Snapping to integer percent is on by default~~ — **withdrawn in rev 3, on measurement.**
Integer percent is a **2.52-tile lattice at Giant** (Sec.4.3), and the rationale was wrong
twice over: Sec.5.4's integrality requirement is about *angles*, which the compiler already
resolves to integer literals at emit time (Sec.4.5), and a position const is `r * COS + 50`
where `COS` is a float, so an integer `r` buys the emitted arithmetic nothing. The defaults
that survive are **snap to the tile lattice for the current map size** (a real position the
user can see), plus snap to the centre and to a parent's axis. Integer percent stays
available as an explicit modifier for a mapper who wants a round number in the file, which is
a legibility preference and should be labelled as one.

---

## 8. The panel (right)

A tree mirroring the graph — indentation is the chain, so `Map centre → P1 → {A1, A2, A3}`
reads at a glance, which is the thing Bulls_Eyes' 130 lines of `#const` do not.

Per node: parent picker, frame toggle (radial/absolute), offset fields, label. Shape groups
additionally get radius / rotation / phase plus the **pattern editor** — a reorderable strip
of role chips (`P A B A C`) with a repeat stepper beside it and the resulting land total
shown live, since `pattern.length × repeats` is the number the user is actually choosing
(Sec.4.5). A separate **Roles** list edits the `#const` set behind each chip, and each land
in the tree shows which role it wears or that it has detached from one.

A **Formula** field per node accepting
Sec.5.2's grammar, with live feedback in three parts: the parse, the resulting position, and
**the RMS the compiler would emit for it**, with its line count. Showing the emitted lines
while typing is what teaches the left-associativity rule without a tutorial, and it makes
Sec.5.3's temp-count trade visible at the moment the user can act on it.

A **Generated code** section previews the whole fence as a diff before Apply.

**A preconditions strip at the top of the panel, above the tree** (Sec.9). It is empty on a
healthy script and it is the first thing on screen when it is not, because the failure this
tool can produce is an empty panel that looks identical to a map with nothing to manage. On
`Rage Forest 2026.rms` it reads: *"70.9% of this script is code the app can only show as raw
text, including 30 `create_land` commands. Land Placement cannot manage those."* — with a
codeRef to the raw node's first line. Rev 3 added this section because that is the map's
actual behaviour, measured, and rev 2 would have shipped a blank tree.

Every number field shows **percent with the tile equivalent beside it** for the current map
size (Sec.4.3), since the one corpus map that places lands sub-percent was working in tiles
the whole time. Where a value will be consumed in tiles rather than percent — a
`create_actor_area`, say — the panel offers the `(NAME / 100 * MAPSIZE)` form, because
Bulls_Eyes already got that conversion wrong on one of its four lines.

Per CLAUDE.md's hard rule, every interactive element above gets a `HelpTip` and a matching
`ui-help.json` entry as it is built. `tools-api-design.md` Sec.7 notes the pane shipped
eight `tools.*` ids against `preview.*`'s sixteen for a pane of comparable complexity; this
panel is more complex than either and should be budgeted accordingly — name the ids in the
build session, not after.

---

## 9. Preconditions (**new in rev 3**)

A panel that reads the AST inherits every limit of the AST. Rev 2 did not say what those are,
and one of the three maps this document is written about trips the first of them completely.
Each is checked on mount, each has a UI consequence, and each was measured rather than
imagined.

**P1 — the script must not be a `RawNode` where the lands live.** The parser degrades
`if`/`start_random` that interleaves with command structure into a `RawNode` (`RMS0110`,
severity **info**), which is the right call and is this project's never-silently-drop rule
working. But `walkItems` cannot descend one, so a tool sees no commands, no attributes and no
sections inside it. Corpus: 3 of 34 maps carry a raw node over 1% of the file —
`Rage Forest 2026.rms` at **70.9%**, `Pa_Site_v1.1.rms` at 4.4%, `TL Cape of Storms.rms` at
1.3%. The first of those is 30 `create_land` and 10 `land_position` the tool cannot see, with
**zero parser errors** to hint at it. **The panel states the raw-covered fraction and names
the lands it therefore cannot manage**, rather than presenting an empty tree that is
indistinguishable from a map with no computed placement.

**P2 — a `perPlayer` random parameter pins a player count.** Sec.4.4. The panel states the
count each one was emitted against, and warns when the live count differs.

**P3 — `direct_placement` for any player-assigned land.** Sec.6.3. Bulls_Eyes and Venn both
declare it; a map that does not gets a warning and a one-click fix.

**P4 — the emitted symbol names must not collide.** Sec.5.6, checked against
`parseResult.symbols` and `language.json` before any edit is offered, because
first-definition-wins makes a shadowing emit a silent no-op.

**P5 — the fence's `@alp-model` must parse.** Sec.6.1. Malformed means no association and an
empty panel; it never repairs and never guesses.

P1 is the only one that can make the tool useless on a valid script, and it is the only one
whose cause lies outside this tool entirely. Lifting it means teaching the parser to
represent section-crossing conditionals, which is a parser-design decision several times the
size of this feature and is **not** proposed here.

---

## 10. Test plan (**new in rev 3**)

Rev 2 had no test plan, which is how it shipped a compiler rule that spills 14 `#const`s and
three type names that do not exist. This section is what replaces rev 3's throwaway probes.

**Three gates and two reporters, and the split is deliberate.** Gates: 10.1 (the acceptance
bar), 10.2 (compiler properties), 10.4 (fence safety) — each can only go red for a real
reason. Reporters: 10.3 (the importer census) and 10.5 (this document's own sketches), which
print numbers and diff them against pinned figures without failing the build. That follows
this repo's own precedent (`rms0200.measure.test.ts`, `npm run measure:checker`): fourteen
review rounds of `consistency-checker-design.md` each re-typed the same probes by hand, and
the fix was to build them once and diff against history.

### 10.1 The acceptance gate: regenerate Bulls_Eyes

Sec.2 goal 1 stated the bar and rev 2 never ran it. **Rev 3 did, and it passes.** Build
Bulls_Eyes' eight lands in the Sec.4.1 model, emit through Sec.4.2's table and Sec.5.3's
amended rule, and check two things against the map itself:

| check | result |
|---|---|
| emitted `#const` count | **104**, against the hand-written 104 |
| emitted names with no hand-written counterpart | **0** |
| lines byte-identical after normalising parens and whitespace | **104 of 104** |
| lands landing on the same tile at Normal | **8 of 8** |
| percent agreement | exact to the last printed digit on all 16 coordinates |

This is a **gate**, not a reporter: it compares against a checked-in corpus map and it can
only go red for a real reason. It is also the strongest test in the plan, because it pins the
emit rule, the frame algebra, the macro, the anchor chain and the evaluator agreement in one
assertion — and each of the two Sec.5.3 amendments was found by watching it fail in a way
that reasoning had not predicted.

Run at pinned draws (`ROTATION_PLAYER 4123`, `ROTATION_AUX -47`, `VAR_A1 1`, `VAR_A2 -2`,
`VAR_A3 0`) so both sides are comparable, which is the same seed pin Sec.3.3 does at runtime.

### 10.2 Property tests on the compiler

Generated `Expr` trees over the Sec.5.0 grammar, checked against Sec.5.5's own oracle:

1. **Round-trip exactness.** For every generated tree, evaluating the emitted `#const` chain
   through `evaluateExpressionTokens` equals evaluating the tree directly. **Exact equality,
   no tolerance** — Sec.5.5's rule, and a tolerance would hide the class of bug worth
   catching.
2. **Re-association safety.** The Sec.5.3(a) normalisation must not change the answer.
   Generate trees with float literals specifically, since that is the one case where `+`
   re-association can differ.
3. **Emit-count monotonicity.** An input already in RMS left-spine form emits exactly one
   line. This is the claim Sec.5.3 makes about output legibility and it is checkable.
4. **No `rnd` inline.** Structural, and it is free — Sec.5.0's union has no arm for it, so
   this one is enforced by `tsc` rather than by a test. Named here so the absence is
   deliberate rather than an oversight.
5. **Name collision.** An emit whose candidate name already exists in `parseResult.symbols`
   or `language.json` renames rather than shadows (Sec.5.6). **Mutation-test this one**: the
   failure mode is a silent no-op, so a green run proves nothing until the check has been
   seen to go red.

### 10.3 The importer, over the corpus

A **reporter**, printing per map and diffing against pinned figures:

| pinned | value |
|---|---|
| maps carrying the macro (grep `40500`) | 3 |
| `Bulls_Eyes.rms` distinct position pairs / ADOPT | 8 / 8 |
| `Venn.rms` distinct position pairs / ADOPT | 8 / 8 |
| `Venn.rms` literal-position lands (not candidates) | 463 |
| `Rage Forest 2026.rms` pairs visible to the AST | 0 |
| corpus `land_position` arguments: numeric / symbolic | 12,912 / 410 |
| corpus fractional position arguments | 734, all in `Venn.rms` |

Two of those rows are **controls that must not come back zero**, in this repo's own sense:
the Venn literal count and the corpus symbolic count. A recogniser that silently matches
nothing prints a tidy `0 / 0` and looks like a clean report, which is the instrument failure
`consistency-checker-design.md` rev 4 paid for. The Rage Forest row is the opposite control —
it must stay **0**, and if it ever becomes non-zero, the parser learned to represent something
and P1 needs re-deriving.

### 10.4 Fence and edit safety

1. **Byte-identity outside the fence.** Regenerate over every corpus map that can carry a
   fence and assert every byte outside `@alp v1 begin`…`@alp end` is unchanged. Same
   invariant the formatter earns a different way, same reason.
2. **Model round-trip.** `JSON.parse(JSON.stringify(model))` is deep-equal to `model`, over
   generated models. This is what Sec.5.0's "no functions, no cycles, no `Infinity`" buys,
   and it is the assertion that catches someone adding a `Map` to the model later.
3. **Malformed `@alp-model` yields no association**, never a repair and never a partial
   adopt. Assert on truncated JSON, wrong `v`, and a fence with no model comment at all.
4. **Idempotence.** Apply twice, second Apply produces zero `TextEdit`s.

### 10.5 Typecheck this document's own sketches

A reporter, ~30 lines: extract every ` ```ts ` block from this file in document order,
concatenate them with `tools-api/index.ts` imported, and run the repo's own `tsc`. It is
green at rev 3 (8 blocks, 0 errors) and it was red at rev 2 (17 errors, 3 undefined names,
Sec.11). The cost is one CI second and the class of defect it catches is the one a corpus
probe structurally cannot reach.

**It is a reporter rather than a gate**, for the reason the excerpt case makes obvious: a
block can legitimately be an excerpt of a real declaration, and forcing every fragment to be
standalone would push the document toward code that compiles rather than code that reads.
The reporter prints which blocks it could not place and lets a human judge.

### 10.6 What is deliberately not tested here

The canvas, the panel and the overlay transport. Layers 1–3 are `tools-api` surface and their
tests belong with the contract, not with this tool — the same split `tools-api-design.md`
Sec.9 already makes. Both debts this section used to record are now settled in **Sec.3.7**
(one block holding N shapes, capped at 10,000 to match `maxTableRowsRendered`, truncating
rather than rejecting; `overlayEvent` coalesced to one `drag` per animation frame), so what
this document still owes the contract is the tests for them — a `mapOverlay` block at the cap
and one over it, and an `overlayEvent` burst asserting the coalescing. Both belong with
`protocol.ts`'s own suite, not here.

---

## 11. The `tsc` pass (**new in rev 3**)

Rev 2 carried five `ts` blocks. Extracted verbatim, placed in the context each one names, and
compiled under this repo's own `tsconfig.json` (`strict`, `noUnusedLocals`,
`noUnusedParameters`), they produce **17 errors, every one `TS2304: Cannot find name`, across
three identifiers**:

| identifier | sites | where |
|---|---|---|
| `Expr` | 14 | Sec.4.1's model, in six interfaces |
| `OverlayShape` | 1 | Sec.3.4 layer 2's `mapOverlay` block |
| `PreviewSummary` | 1 | Sec.3.4 layer 1's `generated` message |

**None of the three is defined anywhere in rev 2**, and the two one-site names are the
payload types of the two capabilities Sec.3.4 calls "small" and ships to the community. A
layer whose message type does not exist is not a small layer; it is an unpriced one.

This is the repo's own rule arriving on schedule: *a claim about DATA gets checked by a probe;
a claim about a NAME, a TYPE or an EXPORT gets checked by the toolchain — and the second half
is the one that keeps getting skipped.* Rev 2 cited its sources by symbol throughout, which is
what makes the check mechanical, and then nobody ran it. `npm run typecheck` answers in
seconds and CI already runs it ahead of the tests.

**Rev 3's eight `ts` blocks compile clean — 0 errors**, extracted verbatim from this file by
a script, concatenated in document order, and run through `tsc --noEmit -p tsconfig.json`
alongside the real `tools-api/index.ts`. Sec.3.6's `PanelState` resolves `RunnerHandle`
against `src/tools/host.ts`'s actual export rather than a lookalike, which is the point of
running the check against the tree instead of in isolation. Separately verified against a worked example from
each of the three maps (Bulls_Eyes' chained aux land, Venn's compound radius, Rage Forest's
bisector and its four-slot ring), which is what showed `Expr` needed the `{ k: "node" }` arm.

**That extraction is thirty lines and it belongs in the repo, not in a session.** Sec.10 lists
it: a reporter that pulls every `ts` block out of this document and typechecks it. Rev 2's
three missing names would have been caught the day they were written, and the check costs
nothing on a document with no code in it. `PreviewSummary` and `OverlayShape` follow;
`Expr` and `Ref` are Sec.5.0.

```ts
/**
 * Everything the host returns about a generation WITHOUT shipping the grid OR
 * the object list — measured, objects are 85-87% of a real map's payload
 * (Sec.3.8), so they come back through a slice request like tiles do.
 *
 * TWO PREREQUISITES against `src/preview/generator/index.ts`, both named in
 * Sec.3.8: `generatePreview` must surface `landResult.origins` (it drops them
 * today) and must return the final grid (only `snapshots` escapes, and only
 * when collecting). Neither exists as this is written.
 */
interface PreviewSummary {
  /** Post-override_map_size, so it can differ from the requested size. */
  dim: number;
  seedUsed: number;
  landOrigins: readonly {
    commandSpan: Span;
    /** TILES, not percent — the grid's own units (Sec.4.3). */
    x: number;
    y: number;
    zone: number;
    player?: number;
    tiles: number;
    declaredTargetTiles: number;
  }[];
  reports: readonly {
    commandSpan: Span; stage: string; attempted: number; placed: number;
    failureBuckets: Record<string, number>;
  }[];
  notes: readonly { key: string; text: string }[];
  /** Counts only. The list itself is slice-requested (Sec.3.8). */
  objectCount: number;
}

/** Themed by role, never by hex, so an overlay reads in both app themes. */
type OverlayRole = "primary" | "secondary" | "warning" | "error" | "muted";

/** TILE coordinates throughout — projection.ts owns the screen transform. */
type OverlayShape =
  | { id?: string; kind: "point"; x: number; y: number; role: OverlayRole; radiusPx?: number }
  | { id?: string; kind: "circle"; x: number; y: number; rTiles: number; role: OverlayRole; fill?: boolean }
  | { id?: string; kind: "line"; from: { x: number; y: number }; to: { x: number; y: number }; role: OverlayRole; dashed?: boolean }
  | { id?: string; kind: "polyline"; points: { x: number; y: number }[]; role: OverlayRole; closed?: boolean }
  | { id?: string; kind: "label"; x: number; y: number; text: string; role: OverlayRole }
  | { id: string; kind: "handle"; x: number; y: number; role: OverlayRole; cursor?: "move" | "ew-resize" | "grab" };
```

`PreviewSummary` is the deeper half of Sec.3.4 layer 1's argument made concrete: it is what a
tool needs about a generation, it is bounded by land count rather than by tile count, and
writing it down is what shows the handle-plus-summary design is cheaper *and* more useful
than shipping the grid. `landOrigins[].x/y` are **tiles**, deliberately — the grid's own
units, converted once at the boundary rather than at every reader.

**The one thing `tsc` cannot check, and rev 3 states rather than assumes**: rev 2's Sec.3.2
block redeclares `ToolManifest` with only `surface?` in it. Pasted into `tools-api/index.ts`
that is TypeScript **declaration merging** and it compiles silently, adding the member to the
real interface. That is the intended reading and it is also how someone accidentally ships a
second partial declaration of a published contract type. The amendment goes into the existing
declaration; the block in Sec.3.2 is an excerpt of it and now says so.

---

## 12. Open questions

These were rev 1's; all eight were answered for rev 2, and rev 3 re-ran four of them.
Several change the shape of the work rather than its details.

**Q1 — Ownership. RESOLVED 2026-08-29: yes.** The fenced-region model of Sec.6.1 is
accepted. The tool owns its fence, regenerates it wholesale, and leaves every other byte
alone.

**Q2 — Frame semantics. RESOLVED 2026-08-29: angle ABC.** A = map centre, B = parent land,
C = child; the angle at B is what the chain maintains, equivalently C expressed in B's
rotated coordinate system. Sec.4.2 is rewritten around this, including the depth-2
derivation it forces (the reference ray must run back up the chain, not back to the centre,
because the alternative needs an `ATAN2` RMS does not have).

**Q3 — Shape count. RESOLVED 2026-08-29: user-chosen, with a repeating role pattern.** The
count is fixed at edit time (`pattern.length × repeats`), not derived from the player count,
so every vertex angle resolves to an integer literal and Sec.5.4 is satisfied by
construction at every count including 7. The `P A B A C` cycle requirement is Sec.4.5, which
is new and is the largest addition since rev 1: roles emit as `#const` sets, per-instance
values (`zone`, `assign_to`) stay literals, and patterns compose with chains rather than
replacing them.

**The player-count-driven variant is now deferred rather than rejected**, and the note is
kept because Sec.4.4's `perPlayer` inherits the same dependency and because it is cheap when
wanted: `language.json` carries `1_PLAYER_GAME` … `8_PLAYER_GAME`, and Bulls_Eyes already
uses that shape for map size, so a ladder of pre-computed integer literals gets a runtime
count without ever emitting a runtime division:

```
if 2_PLAYER_GAME       #const ALP_STEP 180
elseif 3_PLAYER_GAME   #const ALP_STEP 120
…
elseif 7_PLAYER_GAME   #const ALP_STEP 51
elseif 8_PLAYER_GAME   #const ALP_STEP 45
endif
```

Every branch integral, macro safe at every count. Worth revisiting once patterns are built,
because a pattern with one `P` slot and *n* repeats is already most of the way there.

**Q4 — `rnd` sharing. RESOLVED 2026-08-29: a per-parameter checkbox.** `perPlayer` on each
`RandomParam` — unchecked draws once and shares (Bulls_Eyes' `VAR_A1` mirroring, the
default), checked emits one draw per player. Sec.4.4, including the two edge cases it
creates: a `perPlayer` parameter needs a player count at emit time (so it inherits whatever
Q3 decides), and one referenced from a land no player owns is a model error rather than a
silent resolve to P1.

**Q5 — Float `#const`s. RESOLVED 2026-08-29, and it reversed a conclusion.** Floats do flow
through `+ - * /` unrounded, and rounding happens only where a float meets an integer-only
attribute (0.5 up). But the answer arrived with a fact the repo did not have: **`%` casts
both operands to int**, which makes it the language's only rounding operator and makes the
SIN macro self-guarding (Sec.5.1, Sec.5.4). Rev 1's central "integer trap" is deleted.

**Two follow-ups this opens, neither blocking.**

1. ~~**`mathEval.ts`'s `mod()` needs the cast**~~ — **DONE 2026-08-29.** `mod()` now casts
   both operands, guards a non-finite dividend against producing `NaN` (`Infinity % 5` was
   reachable and `NaN` is in `PROHIBITED_VALUE_KINDS`). (Its zero-divisor branch returned `0`
   when this line was written; follow-up 2 below **reversed that on measurement** the next
   day, so read the two together rather than this one alone.) Six tests in `src/preview/__tests__/mathEval.test.ts`, five mutation-confirmed red
   against the pre-amendment code; `parser-design.md` Sec.2.2 amended to match. **Corpus
   blast radius is zero** — 907 preview tests and 480 parser/tools tests unchanged, which is
   the expected result, since the cast is a no-op on the integer-only arithmetic that makes
   up almost all real script math. Sec.5.5's oracle is now sound. **Rev 3 confirmed the fix
   in the live function rather than citing this entry**, and then confirmed the property it
   licenses independently — 4,000 fractional angles through the real macro, `S` = ±1 on all
   of them (Sec.5.4). A "DONE" line is a claim like any other and decays the same way.
2. ~~**`x % 0` → `0` is an owner decision, not a measurement, and it reverses a sourced
   one.**~~ — **MEASURED 2026-08-30, `RMSTEST_64`, BUG-022.** The 2026-08-29 decision was
   wrong: `x % 0` returns the left operand truncated toward zero, exactly the Summer 2025
   Update note (guide line 4550) that Sec.2.2 originally built `mod()` from. The guide's main
   math text ("Modulo 0 also gives 0.") is the stale sentence. `mod()`'s zero-divisor branch
   now returns the truncated left operand; `mathEval.test.ts`'s pin moved with it. The `-inf`
   idiom is unaffected, as predicted. See `docs/known-issues.md` BUG-022 for the full reading.
3. **`x / 0` → `0` is confirmed**, also by `RMSTEST_64` (CYPRESS_TREE arm, 100 of 100) — the
   same run settled both halves of the guide sentence it was built to arbitrate, and only one
   of the two turned out to be right.

**Q6 — Shape set. RESOLVED 2026-08-29: ring gizmo first, per-vertex handles later.**
`PatternSlot.radius` and `PatternSlot.theta` (Sec.4.5) make irregular rings a property of
the pattern, editable as numbers in the panel from day one. The canvas gets the radius and
rotation gizmo first; per-vertex drag handles are a later pass.

**Q7 — Panel tier scope. RESOLVED 2026-08-29: build it for the community.** Sec.3.4 is the
answer and it is the largest structural change in this revision. The key move is that "let
community tools do this" is four capabilities, not one: **layers 1–3 (`run-preview`,
`mapOverlay`, `overlayEvent`) ship now and work over any transport including external
NDJSON tools; layer 4 (declarative forms) waits** until this tool has shown what a panel
actually needs. Land Placement is the reference implementation rather than a one-off
(Sec.3.5).

**Q8 — Preview cut. RESOLVED 2026-08-29 by Q7, and the question dissolved rather than being
decided.** With `cutOffset` as a parameter of the layer-1 `generate` request, the panel never
touches the pane's shared Current/Final state: it asks for the cut it wants. Neither of the
two options rev 1 posed is taken — there is no seizure of view state, and there is no second
pipeline, because layer 1 is the pipeline and every tool shares it. `read-preview-view`
shrinks to read-only (Sec.3.3, Sec.7.1).

**Q9 — what does a non-circle `ShapeGroup.kind` mean? CLOSED for all six kinds, 2026-09-03.** `docs/land-placement-shape-kinds-escalation.md` decided a geometry for all six kinds and is now fully implemented. Slice A built `line`/`arc`, the two that ride the existing `polar` model unchanged; slice B built the cartesian machinery `reExpand.ts`/`dragMath.ts` needed and `square`, the first non-`polar` kind; slice C built `triangle`/`polygon` (the same shared `perimeterOffset` function called two more ways, plus the `sides` field) and the two handles left of slice 5's own item 6 (Sec.4.5's shape-kinds subsection has every formula and both handles). The panel's kind control now offers all six kinds with no unbuilt-shape caveat left to state. **Superseded the same day**: `docs/land-placement-perimeter-symbolic-rotation-escalation.md` replaced `square`/`triangle`/`polygon`'s `cartesian` representation with `polar` (Sec.4.5's shape-kinds subsection has the current formula), so this answer's "the first non-`polar` kind" clause is now historical — every kind is `polar`.

**Q10 — per-player rings. DESIGNED 2026-09-02, ready to implement.** Asked for from a run of the
built panel: a ring should rearrange itself around however many players are in the game. This is
**Q3's own deferred variant, whose stated trigger has fired** (Q3 said it was worth revisiting
once patterns were built, and they are), so it is this document's next step rather than a
deviation from it.

**The count labels are exact and `if` has no boolean operator** (confirmed 2026-09-02), so "emit
this land when the count is at least *k*" cannot be written directly. It can be **manufactured**,
which is the whole design. A prologue converts the exact count into cumulative labels once:

```
if 2_PLAYER_GAME       #define ALP_AT_LEAST_2
elseif 3_PLAYER_GAME   #define ALP_AT_LEAST_2 #define ALP_AT_LEAST_3
...
```

`if` tests a LABEL and never a constant (Sec.5.1), and `#define` creates exactly that, so after
this block `if ALP_AT_LEAST_5` is a working threshold anywhere in the script. The same prologue
carries the per-count player angles, rounded per land rather than derived from one step constant,
which caps the error at 0.5 degrees with no accumulation (at 7 players a shared step drifts
nearly 3 degrees into the final gap). Emission is then **the body exactly as it is today, plus
one two-line guard per player-owned land**: 8 lands rather than the 35 an arrangement-per-count
shape would need, 32 rather than 140 for a Bulls_Eyes shape. **Q3's `ALP_STEP` ladder is used,
not superseded** — it handles the angles, and the `AT_LEAST` labels handle membership, which is
the half Q3 never had.

Three consequences worth recording here. **The `assign_to AT_PLAYER` overflow measurement is
retired**, since no guard ever admits a land for an absent player. **The per-member chain question
dissolves for per-player rings**, because a chained land is guarded by its parent's threshold; it
survives only for rings that are not per-player, where a one-shot copy action is the cheap answer.
And **`resolved`/`quantities`/`emittedNames` keep their flat shape**, because the body is
unconditional and the prologue resolves at the one count the panel is previewing.

The design, the cost table, a six item implementation brief and the resolved questions are in
`docs/land-placement-per-player-escalation.md`. **Blocking nothing built.** Note Sec.4.4's rule
that a runtime lift has to cover `perPlayer` parameters and rings together or not at all, which
this design satisfies by leaving `perPlayer` parameters alone.

**Nothing above blocks starting.** Q5 follow-up 1 has landed and rev 3 re-verified it, so the
one prerequisite rev 2 named is discharged.

---

## 13. What rev 3 changed, and what it says about how to review this

Six passes were run. **Five moved a conclusion**, which is a high enough rate to be worth
recording as a fact about the document rather than as a list of fixes.

| pass | verdict | cost of not running it |
|---|---|---|
| `tsc` on the sketches | **3 undefined type names, 17 errors** | Two "small" community-facing layers had no payload type at all |
| Emit the acceptance bar | **Rule sound but incomplete** | 14 spurious `#const`s, on the tool whose purpose is deleting them |
| Perf re-derivation | **Re-cited a figure superseded 1.7×, and priced the wrong quantity** | A 250 ms debounce chosen against a number 8× too large |
| Importer over three maps | **Recognition ran the wrong direction; the "hard" map is hard for an unrelated reason** | Confident nonsense on one map, a silent empty panel on another |
| Scale decision | **A default snap that quantises to 2.52 tiles** | Lands 2 tiles from where the user put them, at the largest size |
| `Expr` | Defined; needed an arm rev 2's model lacked | Rage Forest's bisector inexpressible |

Three patterns, all of which this repo's Hard rules already name, arriving one revision after
the rules were written:

1. **A re-cite is not a citation.** The 460 ms figure was taken out of the one file in the
   tree that carries a warning against re-citing it, one revision after
   `consistency-checker-design.md` paid for the same mistake. The fix is not "check the
   number" — it is to notice that the panel needed a *different* number, which no amount of
   checking the cited one would have produced.
2. **A claim about a type gets checked by the toolchain, and it did not get checked.** Rev 2
   is unusually well sourced by symbol, which is exactly what makes `npm run typecheck`
   mechanical, and it went unrun.
3. **Running the thing beats arguing about it, and the margin is not close.** Both Sec.5.3
   amendments, the `INBOUND` deletion, and the reversal of Sec.6.4's stated reason for
   best-effort import all came from one probe that took under four seconds to run. Every one
   of them had survived two rounds of careful reading.

### Is it buildable?

**The compiler half is; the panel half now is too, and they are separable.** Rev 3 closed the
two things that were not: Sec.3.6 (the lifecycle, which rev 2 left at one sentence) and
Sec.3.7 (the overlay budget, which rev 3 had itself recorded as owed). What remains open is
listed below rather than implied.

**Slice 1 — no panel tier, no contract change beyond types.** This is a complete, testable
piece of work on its own and it is where to start.

1. Land `Expr`, `Ref`, `PreviewSummary` and `OverlayShape` in `tools-api/index.ts`. Types
   only, no behaviour, and Sec.11 is what CI would have said a revision ago.
2. Build Sec.10.1 as a gate **before** the compiler it tests — it is the assertion that found
   both Sec.5.3 amendments and the `INBOUND` deletion.
3. Build the math compiler (Sec.5), the deepest part and the only one already run end to end.
4. Build the importer backwards from `land_position` (Sec.6.4), printing Sec.10.3's controls
   from the first run. **Deferrable**: it serves 3 scripts out of the 245 on this machine
   while the authoring path serves all of them.

**Slice 2 — the panel tier.** In order: the two `generatePreview` prerequisites Sec.3.8 names
(surface `landResult.origins`; return the final grid) — **these come first, because layers 1-3
cannot be built on a generator that does not return what they publish**. Then `PanelState` and
the `isBusy()` clause (Sec.3.6), the model lifted above `activeTab`, then layers 1-3 with
Sec.3.7's shape cap and Sec.3.8's supersession rule, and `protocol.ts` tests for both.
(`ToolsPane`'s unmount cleanup is **done** — landed 2026-08-29, Sec.3.6.)

**Still open, and none of it blocks slice 1.** Layer 4 stays deferred by design (Sec.3.4) —
the right-hand panel is native React until this tool has shown what a declarative form
vocabulary would need. ~~Sec.4.5's **re-expansion merge rule** is unwritten~~ — **written
2026-08-30**, Sec.4.5. The merge key is `(repeatIndex, slotId)`, which is why `PatternSlot`
now carries an id; `nudged` decides whether an offset is recomputed wholesale or re-applied as
a delta; and a member the new count has no room for is released as a free `Placement` rather
than deleted, unless the model and the document both reference nothing of it. The
**HelpTip ids** are deliberately punted to the
build session (Sec.8) per CLAUDE.md's hard rule, so they are the first thing in it rather than
the last. And this work is **not in `CREATION_PLAN.md`** — it is new scope spanning a
published-contract change with its own gates, which is a scheduling decision rather than a
design one.

One thing left that needs a person, not an agent: **the first read of the panel's real output
by a human** — this repo has twice found a class of defect no number of review rounds reaches,
on the checker and on the formatter, and both times it was legibility rather than correctness.
(`RMSTEST_64`, Q5 follow-up 2, is no longer on this list — **RUN AND READ 2026-08-30**: `x % 0`
truncates toward zero, reversing the 2026-08-29 guess; see BUG-022.)

**What rev 4 should re-derive rather than inherit.** Every millisecond in Sec.7.2 (one
reading, ±50%, on a machine with a documented 3.7× load factor). The three-map population, if
the corpus grows. The 70.9% raw-node figure, if the parser learns to represent
section-crossing conditionals — that number is a statement about the parser, not about
`Rage Forest 2026.rms`.
