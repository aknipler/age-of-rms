# Land Placement — Slice 3 brief: the headless half

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-design.md` (rev 3, plus the 2026-08-30 merge rule in Sec.4.5). Read this
file for *what to build and in what order*; read the design doc for *why*, and treat it as
authoritative wherever the two disagree.

---

## 0. Where the work stands

Slices 1 and 2 are built and green. `docs/build-log.md`'s last three entries are the record;
read them before starting, they are the fastest orientation in the repo.

| | status |
|---|---|
| Sec.5 math compiler, Sec.4.2 frame algebra, Sec.10.1 acceptance gate | **built** (slice 1) |
| `generatePreview` prerequisites, `PanelState`, layers 1–3 | **built** (slice 2) |
| Sec.4.5 re-expansion merge rule | **designed 2026-08-30**, not implemented |
| Fence writer (Sec.6.1/6.2), `ShapeGroup` expansion, remaining offset kinds | **this slice** |
| Canvas (Sec.7), panel (Sec.8), HelpTip ids, `surface: "panel"` manifest | **slice 4, not this one** |

**The cut between slice 3 and slice 4 is "can it be proven by an automated test".** Nothing in
this repo can render `ToolsPane`/`App.tsx` — the Tauri store plugin throws outside the real
host, which is why slice 2's `ToolHost` lift needed a manual `npm run tauri dev` check. Every
item below is a pure function over the model or the AST, so slice 3 ends green on evidence.
Keeping the UI out is what preserves that.

### Read before writing code, in this order

1. `docs/build-log.md` — the last three entries (slice 1, slice 2, the merge rule).
2. `docs/land-placement-design.md` — Sec.4.1, Sec.4.5 (all of it, including the new
   re-expansion subsection), Sec.6.1–6.3, Sec.9, Sec.10.4.
3. `src/tools/builtin/landPlacement/` — `model.ts`, `frame.ts`, `compiler/`. The compiler is
   done; you are calling it, not changing it.
4. `src/hooks/scriptHeader.ts` — the fence precedent, and the two lexer hazards in its header
   comment. See §3 below; one of them lands directly on Sec.6.1.

---

## 1. Scope

**In.** Seven items, ordered in §2 so each one ends green.

**Out, and do not drift into these:**

- **The canvas and the panel** (Sec.7, Sec.8) and anything React. No `surface: "panel"`
  manifest, no `ToolsPane` wiring, no `read-preview-view` population.
- **HelpTip ids.** `CLAUDE.md`'s hard rule ("all new interactive UI elements get wrapped in
  HelpTip as they're built") is real and it does **not** apply here, because this slice builds
  no interactive UI. Do not invent ids for elements that do not exist yet — Sec.8 says name
  them in the build session that builds them.
- **The importer** (Sec.6.4, Sec.10.3). Still deferrable for the reason slice 1 gave: 3 corpus
  scripts against an authoring path that serves all of them. It is the natural slice 5.
- **Layer 4** (declarative forms). Deferred by design, Sec.3.4.
- **Raising the test floor.** `scripts/check-test-floor.mjs` prints a "consider raising the
  floors" note on a grown suite. Leave it; that is a separate decision.

---

## 2. The work, in order

Each item states its acceptance criterion. An item is done when its criterion is demonstrated
by a test you can point at, not when the code looks right.

### 1. The fence: read, write, round-trip (Sec.6.1)

New file, suggested `src/tools/builtin/landPlacement/fence.ts`.

- Locate the `/* @alp v1 begin … */ … /* @alp end */` region in a `ParseResult`; parse the
  `@alp-model` JSON out of the header comment; serialise a model back into one.
- **Regenerate wholesale.** Everything outside the fence is byte-identical, always.
- **Never repair, never guess.** Missing or malformed `@alp-model`, or a wrong `v`, means *no
  association* — the script is a plain RMS script and the tool starts empty. Sec.6.1 is
  explicit and Sec.9's P5 repeats it.
- Emit edits as `TextEdit[]` (`tools-api/index.ts:339`); `src/tools/protocol.ts:450`'s
  `validateEdits` is the existing validator and your edits must pass it.

**Acceptance:** a model survives write → parse → deep-equal. A malformed fence yields no
association on all three shapes Sec.10.4(3) names — truncated JSON, wrong `v`, no model
comment at all.

### 2. `create_land` skeletons and the reference rule (Sec.6.2)

- Everything the tool writes into a `create_land` is a **reference to a constant inside its own
  fence** — never a literal, with the one exception Sec.6.2 names (per-repeat values: `zone`
  under a `perRepeat` policy, and `assign_to AT_PLAYER n`).
- Creating a land emits a `create_land` skeleton wired to its role's constants. From that
  moment the tool owns only what is inside the fence.
- There is no id comment and no marker. **The constant name is the link.** Do not add one.

**Acceptance:** a generated `create_land` references role constants by name; a hand-edited
attribute detaches that land from its role and the detachment is *detectable* (a pure
predicate — the reporting UI is slice 4).

### 3. Fence and edit safety (Sec.10.4) — the gate that makes items 1 and 2 trustworthy

Four assertions, all of them gates:

1. **Byte-identity outside the fence**, over every corpus map that can carry one.
2. **Model round-trip:** `JSON.parse(JSON.stringify(model))` deep-equals `model`, over
   generated models. This is the assertion that catches someone adding a `Map` to the model
   later.
3. **Malformed `@alp-model` yields no association** — never a repair, never a partial adopt.
4. **Idempotence:** Apply twice, the second Apply produces zero `TextEdit`s.

**Acceptance:** all four green. (4) is the one most likely to be quietly wrong; assert on the
edit array being empty, not on the resulting text being equal.

### 4. `ShapeGroup` expansion (Sec.4.5)

`ShapeGroup` is typed in `model.ts` and has **no consumers** — nothing has ever expanded one.

- `theta = rotation + i × (360 / repeats) + j × (360 / N)` where `N = pattern.length × repeats`,
  evaluated **at emit time to an integer literal per land**. That integrality is what satisfies
  Sec.5.4 at every count including 7; do not emit a runtime division.
- `PatternSlot.theta` overrides the even default for one slot; `PatternSlot.radius` overrides
  the ring radius.
- `ZonePolicy` and `assignToPlayer` resolve per repeat index (`zone = base + step × repeatIndex`).
- `members` is ordered **repeat-major, then pattern order**, length exactly
  `pattern.length × repeats`. This ordering is a model invariant, not a rendering convenience —
  the merge rule derives every member's key from it.

**Acceptance:** a `[P, A, B] × 3` group expands to 9 correctly-keyed members with integer
angles; the `members` ordering invariant is asserted directly.

### 5. `reExpand()` — the merge rule (Sec.4.5, the 2026-08-30 subsection)

Read that subsection in full before writing this. It is short and every clause is load-bearing.
The signature is a transition: `(oldGroup, newGroup, placements, parse) → placements'` plus a
report of what happened.

- Match on `(repeatIndex, slotId)`. Never on flat index into `members`, never on slot position.
- `nudged` unset → recompute the offset wholesale from the new group. `nudged` set → re-apply
  as a **delta** against the new base, derived at transition time and never stored.
- A nudged member whose offset is not numeric-literal in every `Expr` is **never rewritten**.
- A member with nowhere to go is **released** as an ordinary free `Placement`, and deleted only
  on all three conditions in the doc — including the one about uses **outside the fence**.
- **No confirm dialog.** The rule is non-destructive by construction; it returns a report of
  what it did. Sec.4.1's old "says what it is about to overwrite" sentence is struck.

**Acceptance:** tests for reorder, slot insertion, slot deletion, `repeats` up, `repeats` down,
and the shrink→grow non-round-trip. The delta case and the release-vs-delete branch each need
their own test; they are the two clauses most likely to be silently wrong.

### 6. The remaining offset kinds and frames (Sec.4.1, Sec.4.2)

`frame.ts` builds only `radial`/`polar` today — deliberately, since that is Bulls_Eyes' whole
idiom and the acceptance gate's whole subject. Add `cartesian` and `formula` offsets and
`absolute` frames. `frame.ts`'s own header comment records the omission; update it.

**Acceptance:** the Sec.10.1 acceptance gate still passes byte-for-byte — it is the regression
test for this item, and it must not be modified to accommodate you.

### 7. Preconditions as pure predicates (Sec.9)

P2–P5 as functions returning structured results. **The functions only** — the panel strip that
displays them is slice 4.

- **P2** — a `perPlayer` random parameter pins a player count (`emittedForPlayerCount`).
- **P3** — `direct_placement` declared for any player-assigned land (Sec.6.3).
- **P4** — emitted names must not collide, checked against `parseResult.symbols` **and**
  `language.json`. `NameAllocator` (`compiler/naming.ts`) already does the allocation; this is
  the pre-flight check that it was given the right inputs.
- **P5** — the fence's `@alp-model` must parse. Falls out of item 1.

**P1 is out of scope** — the raw-node fraction. It needs the AST statistics Sec.9 cites and its
UI consequence is the panel strip. Leave it for slice 4.

---

## 3. Hazards a fresh session gets wrong

**The fence is an RMS comment, and RMS comments are not inert.** This is the one that will ship
a silent map-breaking bug. `src/hooks/scriptHeader.ts`'s header comment documents both halves,
from a feature that already paid for them:

1. **Comment markers are whole tokens.** The lexer splits on whitespace and *then* asks whether
   a token is `/*` or `*/`. A closing `====*/` does not close the comment — it lexes as one
   `word`, and the rest of the script stays commented out, silently, with the map still
   generating. Each marker gets its own line.
2. **A word inside a comment whose constant value is 69 opens a second comment.** Diagnostic
   `RMS0111` / `commentOpensNestedComment` in `src/parser/diagnostics.ts:322` — the next `*/`
   closes only the inner one and every line below is invisible to the game.

Hazard 2 lands directly on Sec.6.1, which now carries the rule: the `@alp-model` JSON serialises
user-authored `label` strings straight into a comment, and a label resolving to 69 silently
comments out the rest of the script. **Read Sec.6.1's "The comment is not inert" subsection
before writing the serialiser** — in particular, do not build a resolve-and-escape validator.
That approach is unsound by this repo's positive-resolver hard rule, and the section says why.
The requirement is structural: no token in the fence header can be read as a word. Test it with a
fixture that defines a constant at 69. (Note: `scriptHeader.ts`'s comment cites this as "RMS0301"
— that is stale, RMS0301 is redefinition. Cite RMS0111.)

**`useSpans` counts uses inside the fence too.** Item 5's delete condition is uses *outside* the
fence. A chained child's position const references its parent's, so an unfiltered count asks the
tool whether its own about-to-be-regenerated output needs its own output — it answers yes
forever, and quietly deletes the behaviour the condition exists for.

**Do not modify the Sec.10.1 acceptance gate.** It is a fixture comparison against
`test-maps/Bulls_Eyes.rms` and it is the strongest test in the repo for this tool. If it goes
red, you changed behaviour — fix the behaviour.

---

## 4. Teaching mode is a requirement here, not a nicety

`CLAUDE.md` says it plainly and it governs this session: the repo owner is using this project
to learn TypeScript and React, coming from Python and C++. **A session that ships correct code
and teaches nothing has half-failed.**

What that means concretely for a slice that is almost entirely pure functions:

- Explain the non-obvious *decision*, never the syntax. Why a discriminated union rather than
  an enum for the leave-set outcome; why `readonly` on the members array; why the transition
  function takes both groups rather than mutating one.
- **Name the concept out loud** — "this is a discriminated union", "this is structural typing".
  An unnamed explanation teaches nothing durable because it cannot be looked up later.
- Comment the *why* in the code. `src/hooks/useDocument.ts` is the standard to match.
- Say whether something is standard TypeScript practice or a choice specific to this codebase,
  so the habits transfer and the quirks do not get cargo-culted.
- End the session by offering two or three questions that check understanding of what was built.

Keep it proportionate: a few sentences at the decision points, not an essay per file.

## 5. Repo rules that will bite

Read `CLAUDE.md` in full before starting — it is long, it is load-bearing, and the Hard rules
section is the distilled cost of about forty expensive mistakes. The ones most likely to reach
this slice:

- **Design specs are authoritative.** If Sec.6.1 or Sec.4.5 seems wrong or ambiguous, **stop
  and escalate**. Do not improvise a deviation. (The merge rule itself reverses one sentence in
  Sec.4.1; that reversal is recorded in the doc and in the build log, and it is the model for
  how to do this — argue it in writing, record it as a reversal, do not do it silently.)
- **NEVER run `git checkout --`, `git restore`, `git stash`, or `git clean`.** There is no safe
  use of them in this repo. The working tree carries weeks of uncommitted work as its normal
  state and git cannot recover what was never committed. Undo an edit with the edit tools, the
  same way it was made.
- **Do not commit.** Write the commit message and leave it for the owner to run.
- **Other sessions edit this repo concurrently.** Re-read a file immediately before editing it,
  and never overwrite one wholesale. The test-count rows in `CLAUDE.md` carry this caveat
  repeatedly for a reason.
- **Do not run Prettier across the tree.** `CLAUDE.md` says "Prettier defaults (don't
  hand-format)", but `.prettierrc.json` is `{}` and the tree has never been formatted, so a run
  rewrites untouched lines everywhere — measured at 55 insertions / 11 deletions on a two-line
  edit. Prettier is not in CI either. Match the style of the file you are editing; if you think a
  formatter run is genuinely needed, ask first rather than running it.
- **A new dependency means saying `npm install` in the same breath**, plus its `@types/*`
  package if it needs one. This slice should need neither.
- **Never write the owner's name** in comments, commit messages or docs. Imperative mood.
- **The Grep tool under-reports on `test-maps/*.rms`** — it sees roughly a third of the corpus
  and will report no matches. Use `grep` via Bash for any corpus-wide count.
- **Run vitest by exact path**, e.g. `npx vitest run src/tools/builtin/landPlacement`. A bare or
  directory-wide run can collide with a long-running measurement probe another session started.
- `elevation.test.ts` and `patch.property.test.ts` have documented wall-clock timeout flakes
  under full-suite load. If one of those is the only failure, confirm it passes in isolation
  before believing it. `CLAUDE.md`'s duration note explains why.

## 6. Definition of done

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

- `typecheck` and `lint` clean.
- Full suite green. Baseline entering this slice is **2086 tests across 71 files** (clean run,
  142.62 s, 2026-08-30). Report the real number you end with, and **never edit a test to make it
  pass**.
- The Sec.10.1 acceptance gate passes unmodified.
- Sec.10.4's four assertions all green.
- A check that has only ever passed proves nothing — **mutation-test the release-vs-delete
  branch and the idempotence assertion** against the defects they exist to catch. Introduce the
  failure, confirm red, restore. `CLAUDE.md` has this as a Hard rule and this repo has already
  shipped a test that asserted the bug it was meant to catch.

Then:

1. Append an entry to `docs/build-log.md` in the style of the existing ones: what was built,
   what was found, what moved a conclusion, what is deliberately not done, and the real
   verification numbers.
2. **Update `CLAUDE.md`'s expected files/tests row** if the suite grew. Its own instruction:
   a stale row reads as a silent-skip failure and wastes an investigation.
3. If something in the design doc turned out to be wrong, amend the doc and say so in the log
   entry. That is the house style, not a deviation from it.
