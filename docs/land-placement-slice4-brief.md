# Land Placement — Slice 4 brief: the panel exists

**This is a work brief, not a design document.** The design is
`docs/land-placement-design.md` (rev 3, plus the 2026-08-30 addenda in Sec.4.2 and Sec.4.5).
Read this file for *what to build and in what order*; read the design doc for *why*, and treat
it as authoritative wherever the two disagree.

**It covers two sessions, not one.** Slices 1-3 were cut at "provable by an automated test",
which worked because nothing in this repo can render `ToolsPane`/`App.tsx`. Slice 4 straddles
that line, so it is split at the same place: **4a is the last of the headless work and ends
green on tests; 4b is the React work and ends on §5's run sheet.** **4a shipped on 2026-08-31,
so this brief is now a 4b brief** — §3 is kept as the record of what it built and what that
changed, and §4 is the work that is left.

**Brief rev 3 (2026-08-31), written with 4a built and §1 answered.** Rev 2 split §1 into two
questions — §1.1, where the canvas COMPONENT lives (rev 1's question, with option (a)'s cost
corrected downward), and §1.2, which preview RESULT it draws, the singleton cut/seed pipeline
rev 1 missed. **Both are now answered: (a) and (f).** Rev 3 records those answers, refreshes §0
to the post-4a tree, adds the two build items the answers imply as §4 items 1 and 2 (renumbering
the old three), folds 4a's two inherited defects and one deliberate omission into §6, adds run
sheet steps R1/R2 for the refactor regressions, and moves the baseline to 87/2318. **4a's scope
did not change; 4b grew two refactors.**

---

## 0. Where the work stands

Slices 1-3 and 4a are built and green. `docs/build-log.md`'s **2026-08-31 entry (Land Placement
Slice 4a)** is the record; read it first, then the 2026-08-30 slice 3 entry, before starting.

| | status |
|---|---|
| Sec.5 math compiler, Sec.4.2 frame algebra, Sec.10.1 acceptance gate | **built** (slice 1) |
| `generatePreview` prerequisites, `PanelState`, layers 1-3 | **built** (slice 2) |
| Fence writer, `create_land` skeletons, `ShapeGroup` expansion, `reExpand()`, remaining offsets/frames, P2-P5 | **built** (slice 3) |
| The `RegisteredTool` seam, the emission orchestrator, panel Apply, `read-preview-view`, the cut offset, the overlay builder, P1 | **built** (slice 4a) |
| The preview pipeline per-consumer, the shared overlay canvas, the panel lifecycle wired, the canvas (Sec.7), the panel (Sec.8), HelpTip ids | **slice 4b** |
| Canvas dragging (Sec.7.3), the formula field, the roles editor, snapping | **slice 5, not this one** |
| The importer (Sec.6.4, Sec.10.3) | **slice 6, not this one** |

**Almost everything slice 2 built is still unwired.** `PanelState`, `mountPanel`, `unmountPanel`,
`PreviewHandleStore`, `createDragCoalescer`, `overlayShapesToRender` — all built, all tested, and
**nothing calls any of them** outside their own tests, because no `surface: "panel"` tool is in
`TOOLS` yet. The single exception is `suspendPanel()`, called from `ToolsPane.tsx:93` in the
unmount effect slice 2 landed. 4a did not change this: it built the panel arm of `RegisteredTool`
without registering a panel, because mounting one needs 4b item 3's lifecycle.

**The emission orchestrator that rev 1 of this brief warned was missing now exists.** It was 4a
item 2 and it is `emitModel.ts` — one function taking an `AlpModel` and running `buildFrame`,
`emitCells`, `emitRole`, `buildCreateLandSkeleton` and `verifyEmission` in order against one
shared `NameAllocator`. Both Apply and the canvas call it. **The rule it carries is still live
and §6 repeats it: one allocator per emission.**

### Read before writing code, in this order

1. `docs/build-log.md` — the 2026-08-31 entry (slice 4a) first, then slice 3's, then slice 2's.
   **4a's entry names two defects and one deliberate omission that 4b inherits; §6 carries them.**
2. `docs/land-placement-design.md` — Sec.3.2, Sec.3.6 **in full**, Sec.3.7, Sec.6.1-6.3,
   Sec.7 **in full**, Sec.8, Sec.9. Sec.3.6's transition table is the specification for 4b
   item 3 and every clause in it is load-bearing.
3. `docs/external-tools-design.md` Sec.10 — the `RegisteredTool` seam. **4a item 1 built it**
   (`registry.ts`, `builtin`/`panel` arms); read it before adding the panel arm's first real
   entry, so 4b extends the union rather than inventing a second, incompatible one.
4. `src/tools/host.ts` lines 74-235 — `PanelState` and the five transitions, with the comment
   saying they are "deliberately NOT wired into ToolsPane.tsx yet".
5. `src/tools/ToolsPane.tsx` — the whole file. It is 350 lines and 4b branches it.
6. `src/tools/builtin/landPlacement/` — all of it. Headless, done; you are calling it.
7. For 4b only, and in this order: `src/PreviewResultContext.tsx` and `src/usePreviewResult.ts`
   (item 1 rewrites the first), then `src/components/preview/PreviewCanvas.tsx`,
   `src/preview/render/drawPreview.ts` and `src/preview/render/projection.ts` (item 2 splits the
   first two).

---

## 1. The two questions that gated 4b — **both answered**

**RESOLVED 2026-08-31. §1.1 is (a), the shared overlay canvas. §1.2 is (f), a second
panel-scoped provider above the tab switch.** Both are built as §4 items 2 and 1 respectively,
and item 1 comes first because the canvas needs its props to exist. The rest of this section is
the reasoning, kept because the design doc still says something else — see §9's item 4, which
now owes `land-placement-design.md` two amendments rather than a conditional one.

**Sec.3.4 layer 2 says the host "renders them on the existing `PreviewCanvas` through
`projection.ts`". There is no `PreviewCanvas` on the Advanced Tools tab.**

`App.tsx:191-218` renders `MapSidePanel` (which owns `PreviewPane`, which owns
`PreviewCanvas`) from `BreakdownPane` and `CodePane` only. The Advanced Tools tab renders
`ToolsPane` and nothing else. So the sentence describes a surface that does not exist on the
tab the panel lives on, and **no report tool's `mapOverlay` block has anywhere to draw
either** — layer 2's producer half shipped in slice 2 (`protocol.ts` validates and caps the
block) and its consumer half was never built.

This was a gap in the design, not a licence to improvise, and it was escalated rather than
guessed at.

**It is TWO questions, and rev 1 of this brief asked only the first.** §1.1 is where the canvas
COMPONENT lives. §1.2 is which preview RESULT that canvas draws. They are orthogonal — every
answer to §1.1 still needs an answer to §1.2 — and §1.1 alone ships a canvas that faithfully
draws the *Breakdown tab's* map. Do not merge the two tables: (d)-(f) are not more options for
§1.1, and picking one of them is not an alternative to picking (a).

### 1.1 Where the canvas component lives

| option | what it costs |
|---|---|
| **(a) One shared overlay canvas, used both places** *(CHOSEN)* | Extract the projection/viewport/hit-test core of `PreviewCanvas` into a component that takes `OverlayShape[]` and an optional terrain layer. `ToolsPane` renders it for a panel tool; `PreviewPane` renders overlay blocks on it later. Land Placement really does go through the declarative overlay path, so Sec.3.5's "reference implementation" claim stays true. Only one renderer. |
| (b) A private canvas inside the panel | Fastest to a first pixel. Land Placement draws directly from its model and never emits an `OverlayShape`, so layer 2 stays unproven and Sec.3.5's claim becomes false. A second renderer to keep in sync with `projection.ts` forever. |
| (c) Put `MapSidePanel` on the Advanced Tools tab | Cheapest change to `App.tsx`, wrong shape: Sec.7/Sec.8 want the canvas to *be* the panel's left half, not a side panel beside it. It also does not dodge §1.2 — it answers it with "share everything", which is the one answer Sec.7.1/Sec.3.3 rule out. |

The choice is **(a)**, and the reason is not aesthetic: option (b) makes the tool's own
canvas the one thing no community tool can reproduce, which inverts the entire argument of
Sec.3.4.

**Rev 1 costed (a) too high, and that matters because the cost was the stated reason to weigh
(b) at all.** It called `PreviewCanvas.tsx` "352 lines coupled to `PreviewWireResult`,
`StageSnapshot`, `usePreviewViewport()` and `hiddenObjects`". Read the file: the coupling is not
spread over those 352 lines, it is concentrated in two call sites.

- Everything that makes it *a canvas* — the `ResizeObserver`/fit effect, pan, zoom, the
  click-vs-pan slop, hover, `screenToTile` — touches the snapshot only through `snapshot.dim`.
  That is one number, across `PreviewCanvas.tsx:100-250`.
- The thick coupling is the terrain-bitmap memo (`PreviewCanvas.tsx:98`) and the single
  `drawPreview` scene (`PreviewCanvas.tsx:167-173`). `result` is otherwise read exactly once,
  for `result.notes` at line 301.
- `drawPreview` (`src/preview/render/drawPreview.ts:71`) is already a flat layer sequence:
  terrain, map edge, objects, players, failure marks, then highlight, then selection. A
  `drawOverlay(ctx, viewport, shapes)` between failure marks and highlight is additive and
  changes no existing layer.

So the seam is "parameterise on `dim`, make the content layer pluggable", not "untangle 352
lines" — which makes (a) *less* code than (b), not more, since (b) still has to write a second
`projection.ts` consumer from scratch.

**One framing correction while you are here.** "There is no `PreviewCanvas` on the Advanced
Tools tab" reads like missing plumbing. It is not: every provider the pane needs already sits
above the tab switch (`App.tsx:277-287`, `App.tsx:183-188`), and `MapSidePanel` takes no props
(`src/components/sidepanel/MapSidePanel.tsx:30`), so `<MapSidePanel />` inside `ToolsPane` would
render today. What is missing is the two decisions here, not the wiring.

### 1.2 Which preview result the canvas draws — **new in this brief's rev 2**

Rev 1 rejected (c) partly because "the panel needs its own cut and its own pinned seed
(Sec.7.1, Sec.3.3)". That objection is correct, and it **also lands on (a) and (b)**, which rev
1 did not notice.

`PreviewResultProvider` derives its truncated parse from `usePreviewView()`'s seed and
`usePreviewCut()`'s `cutOffset` (`src/PreviewResultContext.tsx:54-55`, `:78-80`). Both are
app-level singletons above the tab switch. **There is one seed, one cut, one worker and one
`PreviewWireResult` for the whole app.** A shared overlay canvas mounted in `ToolsPane` that
calls `usePreviewResultContext()` therefore gets Breakdown's cut and Breakdown's seed — and 4a
built `cutOffset.ts` precisely because the panel's cut is a different one (at the fence, not at
the caret).

| option | what it costs |
|---|---|
| (d) `ToolsPane` mounts its own `PreviewResultProvider` inside the tab branch | Smallest diff, and it re-introduces exactly the failure `PreviewResultContext.tsx:11-28` was written to kill: the provider unmounts on every tab switch, terminating the worker and throwing away a generation that "can take seconds on a real map". |
| (e) The panel drives the shared provider while mounted | No new worker. But the panel's fence cut has to be pushed into `PreviewCutContext`, whose value is *derived* from the caret (`PreviewCutContext.tsx:86`) rather than set — and the pinned seed then leaks to Breakdown/Code when the user switches back. |
| **(f) A second, panel-scoped provider above the tab switch** *(CHOSEN)* | Each consumer owns its cut and seed; neither dies on a tab switch; the second worker generates only while the panel asks it to. Costs one more idle worker, and requires the change below. |

**(f) is not "render `PreviewResultProvider` twice".** As written, a second instance reads the
same singleton seed and cut out of context and computes the same result twice over. Making it
work means taking `cutOffset`, `view` and `seed` as **props** rather than from `usePreviewView()`
/ `usePreviewCut()`, and letting `AppContent` pass the document ones to the existing instance and
the panel ones to the new one. That is the actual unit of work in §1.2, and it is a change to a
file both other tabs depend on — which is why it is an escalation and not a build step.

Two things already checked, so the next session does not re-check them:

- `usePreviewResult` holds its worker in a `useRef` (`src/usePreviewResult.ts:75`) with no
  module-level state, so two live instances are mechanically clean. The cost really is just the
  second worker.
- `PreviewViewValue` already exposes `seed`/`setSeed`/`reseed` as an interface
  (`PreviewViewContext.tsx:57-67`), so a panel-scoped seed needs no new concept — only a second
  holder of the existing one.

**Both questions blocked 4b and neither blocked 4a**, which is why 4a shipped ahead of the answers.

---

## 2. Scope

**In, and bounded — new in rev 3.** §4's items 1 and 2 are the only work in this brief that
touches files outside `src/tools/`, and both are **refactors under a no-behaviour-change rule**,
not invitations to redesign anything:

- **Item 1 moves three values from context to props.** It does not change the debounce, the
  worker protocol, `truncateAst`, Current/Final semantics, or how Breakdown and Code pick a cut.
- **Item 2 splits one component in two.** It does not change the projection, the terrain bitmap,
  the palette, the draw order of existing layers, or what `PreviewPane` renders.

If either item starts changing what the preview *shows*, it has left its scope. Run sheet R1/R2
exist to catch exactly that.

**Out, and do not drift into these:**

- **Canvas dragging** — Sec.7.3's move/chain/gizmo interactions. The frame-dependent edit rule
  (`radial` edits `(r, θ)`, `absolute` edits `(dx, dy)`), formula invertibility, and the three
  surviving snap defaults are one coherent item and they are slice 5. **The canvas 4b builds
  draws and selects; the panel edits by numbers.**
- **The formula field** (Sec.8's three-part live feedback). `compiler/frontend.ts` already
  parses the grammar, so this is a UI item, and it belongs with the drag work because both are
  about editing one node's offset.
- **The roles editor.** 4b lets a pattern slot *pick* an existing role. Editing the `#const`
  set behind a chip is slice 5.
- **The importer** (Sec.6.4, Sec.10.3). Slice 6.
- **Layer 4** (declarative forms). Deferred by design, Sec.3.4. The right panel is native React
  until this slice has shown what a form vocabulary would need — that is the point of building
  it first.
- **Anything in M6.** 4a item 1 built the `RegisteredTool` seam with the two arms it needs.
  The external arm, the loader, the consent dialog and the Runtimes panel are M6 and are not
  prerequisites for any of this — see that item's closing note.
- **Resolving `{k:"node"}` references.** Left unbuilt by slice 3 on purpose; `emit.ts` throws
  if one reaches lowering, and nothing here can produce one.
- **Raising the test floor.** Same standing decision as slice 3.

---

## 3. Slice 4a — the last of the headless work

**BUILT 2026-08-31 — this section is a record, not a task list.** Seven items, each ending on a
test you can point at, so 4a ended green on evidence the same way slices 1-3 did. Read it to
learn what you are calling; do not rebuild any of it.

### 1. The `RegisteredTool` seam, and `surface: "panel"` (Sec.3.2)

`ToolManifest.surface` is typed (`tools-api/index.ts:227`) and **nothing reads it**.
`ToolImplementation.run()` is **required** (`tools-api/index.ts:506`) and a panel has no
one-shot run.

**Do not invent a registry type for this. One is already designed.**
`docs/external-tools-design.md` Sec.10 widened the seam for M6's identical problem — an
external tool has no `run()` either — and gives the exact shape:

```ts
export type RegisteredTool =
  | { kind: "builtin"; manifest: ToolManifest; impl: ToolImplementation }
  | { kind: "external"; manifest: ToolManifest; installDir: string };
```

Build that union with the arms this slice needs — `builtin` and a new
`{ kind: "panel"; manifest: ToolManifest; component: … }` — and leave `external` for M6 to
add. Sec.10 already pins the consequences and they are small: *"`ToolHost` touches only
`tool.manifest.id`, verified 2026-08-30, so it is unaffected beyond the type"*, and
*"`ToolsPane` gains one branch, not a mode"* — the runner selection it performs by id today
(`WORKER_RUNTIME_TOOL_IDS`) becomes selection by `kind`. Name the concept when you write it:
this is a **discriminated union**, and `kind` is its tag.

**The security boundary then costs nothing, because it becomes structural.** Sec.3.2 asks the
registry to reject a `panel` manifest "arriving over the external transport". A `panel` arm
carries a React component — a *function* — and JSON cannot carry a function, so an external
manifest can never produce a panel entry **by construction**. That is strictly stronger than a
validator check, and it is the same move Sec.3.8 makes when it gives `Expr` no `rnd` arm: *the
rule enforced by what the design can represent rather than by a validator*.

**One obligation is deferred, and deferring it is the point.** `validateManifest(manifest)`
(`protocol.ts:136`) takes a bare manifest with no notion of origin, and **there is no external
transport to test a rejection against** — that is M6. Do not add an `origin` parameter now
against a caller that does not exist. Instead **record the obligation in
`docs/external-tools-design.md` Sec.10**: the loader that builds an `external` entry from JSON
must reject `surface: "panel"` at that boundary. One line in the doc, one line of code in M6.

**Acceptance:** the built-in panel registers and reaches the Select Tool dropdown; the existing
five built-ins still register unchanged through the `builtin` arm; `registeredTools()`'s
manifest validation is untouched by the widening. Mutation-test the arm narrowing — a runner
handed the wrong `kind` must throw, not silently no-op.

### 2. The emission orchestrator — `AlpModel` → everything else

**The largest remaining headless piece, and the one nothing else can proceed without.** One
function, one shared `NameAllocator`, in the order Sec.5 and Sec.6 already fix:

1. Expand every `ShapeGroup` (`expandShapeGroup`) into its members.
2. Emit each role's constants (`emitRole`).
3. Build the frame algebra over the placements (`buildFrame`).
4. Lower to `#const` cells (`emitCells`) and render them (`formatConstLine`) — this is the
   fence **body**.
5. Verify (`verifyEmission`) — Sec.5.5 is explicit that on disagreement *the tool emits
   nothing and reports the offending node*. That branch is part of this function's contract,
   not a caller's option.

It returns the body text, the `create_land` text per placement, **and
`verifyEmission().resolved`** — the name→value map, which is what items 3 and 6 both consume.

**The `NameAllocator` is shared across all five steps or the output is wrong**, not merely
untidy: it is seeded from the document's own symbols so emitted names cannot shadow existing
ones (Sec.5.6, P4), and two allocators would each think a name was free.

**Acceptance:** a Bulls_Eyes-shaped model emits a body whose `verifyEmission` is `ok`; a model
rigged to disagree emits nothing and names the node. The Sec.10.1 acceptance gate still passes
unmodified — **it is the regression test for this item and must not be edited to accommodate
you.**

### 3. Panel Apply: the whole edit set (Sec.6.1, Sec.6.2)

Apply produces **two kinds of edit**, and slice 3 built only the first.

- **The fence, regenerated wholesale** — `buildFenceEdits(parse, model, body)`, done.
- **`create_land` skeletons, which live OUTSIDE the fence** — Sec.6.2. Nothing computes where
  they go. They are written once and thereafter hand-owned: *"From that moment the tool owns
  only what is inside the fence."*

Three things this item owes, none of them written down anywhere yet:

1. **Where a skeleton is inserted** — inside `<LAND_GENERATION>`, and the same section scan
   item 5 needs. Share it.
2. **Which placements need one.** Re-emitting every skeleton on every Apply duplicates lands.
   There is no id comment and no marker — **the constant name is the link** (Sec.6.2, and it
   says in as many words not to add one), so "does this placement already have a
   `create_land`?" is answered by looking for a command referencing its role's constants.
   `checkLandAttachment` (`landCommand.ts:117`) is the predicate slice 3 built for the
   neighbouring question; use it or extend it rather than writing a second matcher.
3. **Where a brand-new fence goes.** `buildFenceEdits`'s own comment calls its end-of-document
   append *"a placeholder insertion point. Sec.8's panel is what decides where a freshly-created
   fence should actually go"*. That decision is owed here. Sec.6.1's constraint is that the
   `#const`s must precede their uses.

**Apply for a panel is not Apply for a run, and this is the clause most likely to be built
wrong.** Sec.3.6(a): a panel takes **no snapshot at mount**; it computes its `TextEdit[]`
synchronously against the current parse at the moment Apply is pressed, and `canApply` compares
against *that* string. "Stale" is unreachable for a panel. Do not route panel edits through
`RunState.edits` and `host.canApply()` — those exist for a computation that cannot be re-run,
which is the opposite of this.

**Acceptance:** a pure `model + parse → TextEdit[]` covering both kinds; every edit passes
`validateEdits` (`protocol.ts:450`); **Apply twice produces zero edits the second time**
(Sec.10.4 #4, and assert on the edit array being empty, not on the resulting text matching);
a hand-edited `create_land` is detected as detached rather than silently re-emitted.

### 4. `read-preview-view`, granted (Sec.3.3)

The capability string is typed (`tools-api/index.ts:134`) and **never granted** —
`ToolsPane.startRun` builds a context from four capabilities and this is not one of them. It
carries `{ seed: number; cutOffset: number | null }` and is read-only. Both values are already
above the tab switch: `usePreviewView().seed` and `usePreviewCut().cutOffset`.

**Extract the context builder out of `ToolsPane` while you are in there.** It is ~25 lines of
inline object-spread in a component nothing can render, it is the one place capability
enforcement actually happens, and lifting it to a pure `buildToolContext(...)` makes it
testable for the first time. That is a real deepening, not a tidy-up: the function is where the
trust model lives.

**Acceptance:** an undeclared capability leaves the field **absent** (not undefined-valued —
absent, which is what the existing spread produces and what a v1.1 external tool would
observe); `read-preview-view` grants both fields.

### 5. The cut offset (Sec.7.1)

A pure function over `ParseResult`:

> The cut offset is the start of the **first section that follows the last
> `<LAND_GENERATION>` in source order**, or the end of the document if there is none.

Not the first `<LAND_GENERATION>` — a multi-mode map declares several and cutting at the first
silently drops the layouts defined later, which are exactly the ones a placement tool exists to
edit.

**Acceptance:** a corpus test. Verified on disk 2026-08-31: `Rage Forest 2026.rms` has three
`<LAND_GENERATION>` in text; `24hr_Petra.rms` has one at line 1520, after `<OBJECTS_GENERATION>`
at line 277, so the rule degenerates to end-of-document and the cut buys nothing (Sec.7.2
finding 2 — the expected answer, not a failure). **Rage Forest's three are inside a `RawNode`,
so the AST may see fewer than the text does.** Assert what you measure and write down which it
was.

### 6. Model → `OverlayShape[]` (Sec.3.4 layer 2, Sec.3.7)

Pure: `(AlpModel, mapDim) → OverlayShape[]`. One circle per land at `base_size`, one line per
chain link, gizmos on the selection only.

- **Positions come from item 2's `verifyEmission().resolved`** — the name→value map produced by
  reading the emitted block back exactly as the engine will (Sec.5.5 step 2). Not a parallel
  geometry routine, and not a standalone `evalExpr` of the user's DAG: the whole point is that
  the overlay *cannot* disagree with what will be emitted. Cost is not a concern — re-evaluating
  Bulls_Eyes' entire 143-const table measures 0.173 ms, which is 97 full re-evaluations inside
  one 16.7 ms frame.
- **Percent in, tiles out.** `OverlayShape` is in tile coordinates (Sec.3.4); the model is in
  percent (Sec.4.3). One conversion, one place.
- **Over budget truncates and says so; it never rejects.** `overlayShapesToRender`
  (`protocol.ts:493`) already implements the truncation. The count is printed
  **unconditionally, including at zero**, because a filtered overlay and an empty one are
  different claims. The checker has already shipped the failure this rule exists to prevent —
  1026 blocks against a 1000 cap produced *nothing at all*.

**Acceptance:** shape counts and coordinates for a Bulls_Eyes-shaped model; the truncation path
at `maxOverlayShapesPerBlock` (10,000) reporting the hidden count; the zero case printing its
count. Land Placement will not approach the cap — Venn's 471 lands is under 1,000 shapes — so
the truncation test is a deliberate over-budget fixture, not a real map.

### 7. P1 (Sec.9)

P2-P5 are built (`preconditions.ts`). **P1 is not, and it is the one that can make the tool
useless on a valid script.**

P1 is the `RawNode`-covered fraction of the file, plus the lands inside it the tool therefore
cannot manage. `walkItems` cannot descend a `RawNode` (`walkItems.ts:94`), so counting
`create_land` inside one is a **token scan over the node's span, not a regex over the source** —
a regex counts the word inside comments, and this repo has a hard rule about exactly that class
of mistake.

**Acceptance:** a pure function asserted against the three maps Sec.9 names — all three
confirmed present on disk 2026-08-31 — `Rage Forest 2026.rms` 70.9%, `Pa_Site_v1.1.rms` 4.4%,
`TL Cape of Storms.rms` 1.3%. **Those figures were measured on 2026-08-29 and they are a
statement about the parser, not about the maps** (Sec.13's "what rev 4 should re-derive rather
than inherit" names this one explicitly). If your measurement disagrees, the parser has moved:
report the new number, amend Sec.9, and say so in the build log. That is the house style, not a
deviation from it.

---

## 4. Slice 4b — the React surfaces, and the two refactors that precede them

Five items. **The first two exist because of §1's answers** — they are the work (a) and (f)
imply, and neither was in this brief's rev 1. Build them in order: item 2 needs item 1's props
to exist, and items 4 and 5 need item 2's component.

Only item 1 ends on an automated test, and only because it is a pure refactor that must leave
the existing suite untouched. §5 is how the other four end.

### 1. The preview pipeline, per-consumer (§1.2's answer, option (f))

`PreviewResultProvider` reads seed and view from `usePreviewView()` and the cut from
`usePreviewCut()` (`src/PreviewResultContext.tsx:54-55`), both app-level singletons. One seed,
one cut, one worker, one `PreviewWireResult` for the whole app — so **a second instance changes
nothing until its inputs stop coming from context.** That is this item.

- **Take `cutOffset`, `view` and `seed` as props.** `AppContent` passes the document's values to
  the existing instance and the panel's to a new one.
- **Both instances stay ABOVE the tab switch.** Mounting the panel's inside the
  `activeTab === "advanced-tools"` branch re-creates the exact failure
  `PreviewResultContext.tsx:11-28` exists to prevent — the worker dies on every tab switch and
  a generation that "can take seconds on a real map" is thrown away.
- **Two live instances are mechanically clean.** `usePreviewResult` holds its worker in a
  `useRef` (`src/usePreviewResult.ts:75`) with no module-level state. The cost is one more idle
  worker, and it only generates while the panel asks it to.
- **The panel's seed is its own** (Sec.3.3) — pinned on mount, shown, re-rollable, and it must
  **not** write back to `PreviewViewContext`. That leak is what option (e) was rejected for.
- **The panel's cut is 4a item 5's `cutOffset`**, not the caret-derived one.

This changes a file both other tabs render through, so **Breakdown and Code must come out
behaviourally identical**: same seed, same cut, same re-roll, same survival across a tab switch.

**Acceptance:** the full suite green and *unchanged* — no new test, no edited test — plus run
sheet R1. A pure refactor is the one place in this brief where "the existing tests still pass"
is the whole of it.

### 2. The shared overlay canvas (§1.1's answer, option (a))

Extract the projection/viewport/hit-test core of `PreviewCanvas` into a component taking
`OverlayShape[]` and an optional base layer. `ToolsPane` renders it for a panel tool;
`PreviewPane` renders `mapOverlay` blocks on it later — which is what makes Sec.3.5's "reference
implementation" claim true rather than aspirational, and it is why layer 2's consumer half
finally exists for report tools too.

The seam is narrower than this brief's rev 1 costed it. Read the file before believing the
number: the coupling is concentrated in two call sites, not spread over 352 lines.

- Everything that makes it *a canvas* — the `ResizeObserver`/fit effect, pan, zoom, the
  click-vs-pan slop, hover, `screenToTile` — needs only `snapshot.dim`. **Parameterise on `dim`,**
  not on `StageSnapshot`.
- The terrain bitmap (`PreviewCanvas.tsx:98`) and the `drawPreview` scene (`:167-173`) are the
  only two places the full snapshot and result are needed, and `result` is otherwise read once,
  for `result.notes`. All of that becomes the **optional** base layer.
- `drawPreview` (`src/preview/render/drawPreview.ts:71`) is already a flat sequence — terrain,
  map edge, objects, players, failure marks, then highlight, then selection. Add `drawOverlay`
  between failure marks and highlight. **Additive: no existing layer changes.**
- `usePreviewViewport()` is app-level, and the panel's canvas needs its **own** viewport for the
  same reason it needs its own seed. Settle that here, not inside item 4.

**`PreviewPane` rendering the extracted component with no shapes must look and behave exactly as
it does today.** That is the regression this item can actually produce.

**Acceptance:** `projection.test.ts` unchanged and green, `drawOverlay` tested on its own
(shape-to-screen for each `OverlayShape` arm, and the truncation report via
`overlayShapesToRender`, which is still uncalled by anything), plus run sheet R2.

### 3. The panel lifecycle, wired (Sec.3.6)

`host.ts` has all five transitions. `ToolsPane` calls exactly one (`suspendPanel`/
`resumePanel`, in the unmount effect slice 2 landed). Wire the rest against Sec.3.6's table:

- **select this tool** → `mountPanel()`; it returns `false` if `isBusy()`, and the pane shows an
  inline message rather than crashing (that is why it returns a boolean).
- **select another tool** → confirm **if `dirty`**, then `unmountPanel()`. This is the change
  Sec.3.6(b)'s second note deferred: *"the confirm should key on the panel being `dirty`, not on
  `isBusy()` — but only once a panel exists… a speculative change would be a regression."* A
  panel now exists. Make the change, and keep the unconditional confirm for the run path.
- **document replaced** → unconditional unmount. `noteOpenDocument` already detects the
  transition; the panel branch is what is missing.
- **Apply** → `applyTextEdits` → `reparseNow`, and the panel **stays mounted**. Not `reset()`.

**Acceptance:** §5 steps 1-4.

### 4. The canvas (Sec.7.2)

Two tiers, and the split is not a compromise forced by cost:

| Tier | When | What |
|---|---|---|
| **Vector** | every pointer move, 60 fps | 4a item 6's shapes. Pure function of the model. |
| **Full** | drag end, debounced | One layer-1 `generate` at the pinned seed and 4a item 5's `cutOffset`, drawn underneath. |

- **The seed is pinned on mount, shown, and re-rollable** (Sec.3.3). With `rnd()` in the script
  an unpinned seed makes dragging impossible — Bulls_Eyes' `ROTATION_PLAYER` is
  `rnd(-10000,10000)` and every land jumps between two frames.
- **The debounce is adaptive**: the last measured land-cut duration for *this* script, floored
  at 100 ms. A fixed 250 ms is wrong at both ends of a 26× spread — 49 ms median at Normal
  against Venn's 1279 ms at Giant. The panel gets the measurement free from the generation it
  already ran.
- **`PreviewHandleStore` is layer 1** (`src/tools/runPreview.ts`, built and tested in slice 2,
  never called). Call it. Its supersession rule means the panel never has to release anything
  for correctness. It wants a `PreviewReferenceData`, which is **not** the shape
  `ToolContext.referenceData` carries — `consistencyChecker.ts:191-196` builds one in three
  lines via `buildLanguageIndex` and `objectConstantsFromPublished`. Copy that; do not
  re-derive it.
- **Events come back through `createDragCoalescer()`** (`src/tools/overlayEvents.ts`, same
  status). It is pure and deliberately owns no `requestAnimationFrame` — the canvas pumps
  `push()` per pointer-move and calls `flush()` once per frame. Selection clicks are the only
  event this slice consumes; `drag` arrives wired but unused until slice 5.

**Acceptance:** the geometry is pure and tested — shape-to-screen, hit-test, the
adaptive-debounce function given a last-duration. The **drawing** is §5 steps 5-7.

### 5. The panel (Sec.8), minus the parts slice 5 owns

The minimum that makes an authoring loop real: **create a ring, set its numbers, see it,
Apply.**

- A tree mirroring the graph, indentation as the chain, so `Map centre → P1 → {A1, A2, A3}`
  reads at a glance. Selection shared with the canvas in both directions.
- Shape-group controls: radius, rotation, the pattern strip as role chips, a repeat stepper,
  **and the resulting land total shown live**, since `pattern.length × repeats` is the number
  the user is actually choosing.
- **The pattern editor is what `reExpand()` was built for.** Every edit to `pattern` or
  `repeats` goes through it — never through a fresh `expandShapeGroup` that discards the user's
  nudges. It returns a report of what it did; show it.
- Every number field shows **percent with the tile equivalent beside it** for the current map
  size (Sec.4.3). The one corpus map that places lands sub-percent was working in tiles the
  whole time.
- **The preconditions strip at the top, above the tree** (Sec.9), rendering 4a item 7's P1 and
  slice 3's P2-P5. Empty on a healthy script. On `Rage Forest 2026.rms` it reads: *"70.9% of
  this script is code the app can only show as raw text, including 30 `create_land` commands.
  Land Placement cannot manage those."* — with a `codeRef` to the raw node's first line. **The
  failure this tool can produce is an empty panel that looks identical to a map with nothing to
  manage**, which is why the strip is the first thing on screen rather than a footnote.
- A **Generated code** section showing the fence body before Apply. Sec.8 says "as a diff" and
  **this repo has no diff renderer** — the formatter proposes edits without one. Show the body
  and the edit count, and record the gap rather than building a diff component nobody asked for.
- Each land shows which role it wears, **or that it has detached from one** —
  `checkLandAttachment`'s first UI consumer.

**HelpTip, and it is a hard rule this time.** Slice 3's brief said the rule did not apply
because no interactive UI existed. It exists now. Every interactive element above gets a
`HelpTip` and a matching `reference/data/ui-help.json` entry **as it is built**, not after.

The budget: the pane ships 8 `tools.*` ids against `preview.*`'s 16, for a pane of comparable
complexity; this panel is more complex than either. Expect to write more ids than any single
session in this repo has written, and use a new namespace (`landPlacement.*`) rather than
growing `tools.*`, which describes the report chrome.

**There is already an automated gate and it must be extended.**
`src/tools/__tests__/helpCoverage.test.ts` reads `ToolsPane.tsx`'s source for
`<HelpTip id="...">` and asserts every id has an entry — from a **hardcoded list of file
paths**. Add the new panel files or the gate silently covers nothing you wrote.
`npm run validate:reference` schema-checks `ui-help.json`
(`scripts/validate-reference-data.mjs:20`) — re-run it.

**Acceptance:** the view-model is pure and tested — flattening the graph to a tree with depths,
the parent-picker's cycle rejection, the live land total, the percent-to-tile conversion. The
rendering is §5 steps 8-12. `helpCoverage.test.ts` green over the new files.

---

## 5. How 4b ends green

**Nothing in this repo can render `ToolsPane` or `App.tsx`** — the Tauri store plugin throws
outside the real host, which is why slice 2's `ToolHost` lift needed a manual
`npm run tauri dev` check before it could be called done. **4b cannot end on tests, so its
verification has to be designed rather than assumed.**

Two rules, and the first is most of the answer.

**(1) Push everything provable out of the components.** A React component in 4b should be glue
over tested functions and contain no arithmetic, no coordinate maths, no cycle checks, no
truncation logic, no formatting. That is why 4a exists as a separate slice at all. The measure
of a good split is that the run sheet checks *wiring and legibility*, never *correctness of a
calculation* — if a run-sheet step could fail because a number is wrong, that number belonged
in 4a.

**(2) The manual pass is a written run sheet, run once, with its results recorded in the build
log.** Not "opened the app and it looked fine". Run `npm run tauri dev` and work through:
**First, the two refactor regressions.** Items 1 and 2 change files Breakdown and Code render
through, and both can only fail as a regression on a tab this slice is not building. Run these
before the panel exists, and again at the end:

- **R1.** Breakdown and Code: the preview generates, the seed re-rolls, Current/Final still
  cut where they did, and switching Breakdown ↔ Code neither restarts a generation nor resets
  zoom. That is item 1's whole acceptance.
- **R2.** Breakdown's preview is unchanged to the eye after item 2's extraction — same terrain,
  objects, player flags, failure marks, hover and selection outlines, at a fixed seed.

Then, with the panel:

1. Select Land Placement. The panel mounts; `isBusy()` is true; starting a report tool is
   refused with a readable message.
2. Switch to another tool with a clean panel — no confirm. Make an edit, switch again — confirm
   appears. Cancel it; the panel and the model are still there.
3. Switch to Code and back. The model survives (the whole reason it was lifted above `activeTab`
   in slice 2). The panel re-requests one generation on return.
4. File > Open a different script. The panel unmounts unconditionally and says so in the pane,
   not in a modal.
5. The canvas draws the pinned seed's generation, cut at the end of land generation. Re-roll; it
   redraws. The seed is visible.
6. Land circles sit where the emitted script puts them — check one against the preview pane on
   the Breakdown tab at the same seed and player count.
7. Click a land. The tree scrolls to it; click a tree row, the canvas highlights it.
8. Create a ring of 8. The count reads 8 live. Change repeats to 3 with a 3-slot pattern; it
   reads 9. Reorder a chip; the report says what moved.
9. Every number field shows its tile equivalent, and it changes with the map size.
10. Open `Rage Forest 2026.rms`. The preconditions strip states the raw-node fraction and names
    the lands it cannot manage. **The panel is not silently empty.**
11. Apply on a fresh script. The fence appears, everything outside it is byte-identical, the
    script still parses with no new diagnostics. Apply again with no edits — zero changes.
12. Hover eight elements at random. Every tip has real text; none shows the "No help written
    yet" fallback.

**Record the result of each step in the build-log entry, including anything that looked wrong
and was left.** Sec.13 names one thing that needs a person rather than an agent — *"the first
read of the panel's real output by a human"* — and notes this repo has twice found a class of
defect no number of review rounds reaches, on the checker and on the formatter, and both times
it was **legibility rather than correctness**. Step 12 and the readability of steps 5-10 are
that read. Write down what was ugly even when it was not wrong.

---

## 6. Hazards a fresh session gets wrong

**`isBusy()` is true whenever a panel is mounted, and every report tool runs through `start()`
which throws on it.** Mount the panel by default, or leave it mounted after a tool switch, and
the Advanced Tools pane stops being able to run anything at all — with an exception message
written for a different situation. The mount is on *selecting this tool*, the unmount is on
*selecting another*, and a suspended panel deliberately does not hold the slot.

**One `NameAllocator` per emission.** 4a item 2 says it; it is repeated here because a second
allocator produces output that looks right and shadows a script symbol, which is a silent
no-op in the engine (first-definition-wins, Sec.5.6) rather than an error.

**The fence's span is re-derived on every reparse; the fence's *contents* are a separate
concern.** A document edit does not invalidate a panel. But if the text **inside** the fence
changed by hand, the panel says so and offers to re-adopt or overwrite — it never silently
regenerates over the edit. That is what `PanelState.dirty` and `setPanelDirty` are for.

**`useSpans` counts uses inside the fence too.** Slice 3's brief flagged this for the delete
condition and it lands again anywhere this slice asks "is this constant referenced?". Filter to
uses *outside* the fence or the tool asks whether its own about-to-be-regenerated output needs
its own output.

**The RMS comment hazards have not gone anywhere.** `fence.ts` closed them by escaping every
whitespace character in the model JSON, and its header comment explains why that is structural
rather than a blocklist. Anything written into the fence header goes through the same escape or
it re-opens `RMS0111` — a word inside a comment whose constant value is 69 opens a second
comment and silently comments out the rest of the script.

**Do not modify the Sec.10.1 acceptance gate.** Still the strongest test in the repo for this
tool, and 4a item 2's regression test. If it goes red, you changed behaviour.

**The `mapOverlay` block cap is not the block cap.** `LIMITS.maxBlocksPerOutput` is 1000 and
`maxOverlayShapesPerBlock` is 10,000; one block holds N shapes, never one block per shape.
Emitting per-shape blocks reproduces the checker's exact production failure.

**4a left one gap open on purpose, and 4b has to decide whether it can reach it.** `frame.ts`
does not resolve `{ k: "param" }` to `sym(emittedName)` before lowering, though `emit.ts`'s own
`leafText` comment says it is supposed to. Every model Bulls_Eyes exercises references a
pre-existing script `#const` via `sym`, so nothing has hit it yet. **A `RandomParam` the panel
creates will not emit correctly.** Sec.8 gives shape groups a `rotation` field and Sec.4.5's
worked example is a ring whose rotation *is* a `RandomParam` — so settle whether item 5's fields
can produce one **before** building them, and close the hoisting gap first if they can. Slice
5's formula field certainly can.

**`preconditions.ts`'s `reservedNames` still carries the self-collision 4a fixed only in
`applyEdits.ts`.** It reads `parse.symbols` unfiltered, so on a document that already contains a
fence it seeds the allocator from the tool's own emitted names and renames around them forever
(`ALP_X_P1` → `_2` → `_3`). `applyEdits.ts` works around it locally with
`reservedNamesForApply`; `checkP4` does not. **Item 5's preconditions strip is the first
surface that shows P4 to a user**, and a re-Apply is exactly when it runs. Verify it first.

**`Placement` now carries `role?` and `repeatIndex?`** (`model.ts`, added by 4a). `PatternSlot.role`
exists only at the pattern level, so once `expand.ts` turned a group member into an ordinary
`Placement` the association was being lost, and a standalone placement could not carry one at
all. The panel tree reads these fields — do not re-derive a role by walking back to the pattern.

---

## 7. Teaching mode is a requirement here, not a nicety

`CLAUDE.md` governs this session: the repo owner is learning TypeScript and React, coming from
Python and C++. **A session that ships correct code and teaches nothing has half-failed.**

4b is the first React-heavy work in the whole feature, so its teaching surface is larger and
more transferable than slice 3's:

- Name the concepts out loud — **discriminated union** (4a item 1's `RegisteredTool`, and it is
  worth showing why the alternative, a `ToolImplementation` whose `run` throws, is a lie the
  type system would propagate — the design doc says exactly that), **lifting state up** (why the
  model is above `activeTab` and what breaks otherwise), **stale closure** (the canvas's event
  handlers and why a ref appears), **`useRef` vs `useState`** (`PreviewCanvas`'s `userFramedRef`
  is the worked example already in the tree), **`useSyncExternalStore`** (how the pane
  subscribes to `ToolHost` without React owning the state).
- Explain the non-obvious decision, never the syntax. Why 4b's components are thin shells over
  4a's pure functions is a *testability* decision forced by this repo's inability to render
  `App.tsx` — say that, because it is the reason for the whole 4a/4b split.
- Say whether something is standard React practice or a choice specific to this codebase.
  `useSyncExternalStore` over a class instance is not how most React apps hold state; why it is
  right here is worth one paragraph.
- Comment the *why* in the code. `src/hooks/useDocument.ts` and
  `src/components/preview/PreviewCanvas.tsx` are the standard to match.
- End each session by offering two or three questions that check understanding.

Keep it proportionate: a few sentences at the decision points, not an essay per file.

---

## 8. Repo rules that will bite

Read `CLAUDE.md` in full before starting. The ones most likely to reach this slice:

- **Design specs are authoritative. If a spec seems wrong or ambiguous, stop and escalate.** §1
  is an escalation, not a decision already made — treat it that way.
- **All new interactive UI elements get wrapped in `HelpTip` as they're built.** The one hard
  rule slice 3 got to skip; 4b does not.
- **NEVER run `git checkout --`, `git restore`, `git stash`, or `git clean`.** The working tree
  carries weeks of uncommitted work as its normal state. Undo an edit with the edit tools.
- **Do not commit.** Write the commit message and leave it.
- **Other sessions edit this repo concurrently.** Re-read a file immediately before editing it,
  never overwrite one wholesale. This matters more than usual here: `ToolsPane.tsx`,
  `protocol.ts` and `registry.ts` are shared files, not new ones.
- **Do not run Prettier across the tree.** `.prettierrc.json` is `{}`, the tree has never been
  formatted, and a run rewrites untouched lines everywhere. Match the file you are editing —
  this bites hardest on `.tsx`, where the existing components run to ~110 columns.
- **A new dependency means saying `npm install` in the same breath.** Neither slice should need
  one; if the canvas work tempts you toward a geometry library, `projection.ts` already has both
  directions.
- **Never write the owner's name** in comments or docs. Imperative mood.
- **The Grep tool under-reports on `test-maps/*.rms`** — it sees roughly a third of the corpus
  and reports no matches. Use `grep` via Bash for any corpus-wide count. 4a items 5 and 7 both
  need one.
- **Run vitest by exact path.** A bare or directory-wide run can collide with a long-running
  measurement probe another session started.
- `elevation.test.ts` and `patch.property.test.ts` have documented wall-clock timeout flakes
  under full-suite load. If one of those is the only failure, confirm it passes in isolation
  before believing it.

---

## 9. Definition of done

Both slices run the same gates:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run validate:reference
```

- `typecheck`, `lint` and `validate:reference` clean.
- Full suite green. **Baseline entering 4a was 80 files / 2271 tests** (clean run, 146.44 s,
  floor 59/1467, 2026-08-30); **4a ended at 87 / 2318, and that is 4b's baseline** (clean run,
  124.34 s, floor 59/1467, 2026-08-31). Report the real number you end with, and **never edit
  a test to make it pass**.
- The Sec.10.1 acceptance gate passes unmodified.
- Sec.10.4's four fence gates still green.

**4a additionally:** every one of its seven items green on its own test, and
**mutation-test 4a item 1's arm narrowing, item 3's idempotence assertion, and item 6's
truncation report.** All three are checks that will only ever pass in normal operation, which
is the definition of a check that proves nothing until it has been shown to fail. Introduce the
defect, confirm red, restore.

**4b additionally:** `helpCoverage.test.ts` extended to the new files and green, and **§5's run
sheet worked through in `npm run tauri dev` with every step's result written down** — including
the ones that looked wrong and were left.

Then, at the end of each session:

1. Append an entry to `docs/build-log.md` in the style of the existing ones: what was built,
   what was found, what moved a conclusion, what is deliberately not done, and the real
   verification numbers.
2. **Update `CLAUDE.md`'s expected files/tests row** if the suite grew. A stale row reads as a
   silent-skip failure and wastes an investigation.
3. **4a: record the M6 obligation** in `docs/external-tools-design.md` Sec.10 — the external
   loader must reject `surface: "panel"` at the JSON boundary.
4. **4b: amend `docs/land-placement-design.md` — this is now owed, not conditional, because §1
   is answered.** Two sentences are wrong as written and neither survives the answers: Sec.3.4's
   "the host renders them on the existing `PreviewCanvas`" (§1.1 chose (a), so it is a shared
   overlay canvas both surfaces render), and Sec.7.1/Sec.3.3's pinned seed and panel cut, which
   assume a preview pipeline the panel did not own (§1.2 chose (f), so it owns its own). Say so
   in the log entry.
5. **4b: write the slice 5 brief's scope line** while the omissions are fresh: dragging, the
   formula field, the roles editor, snapping, per-vertex handles.
