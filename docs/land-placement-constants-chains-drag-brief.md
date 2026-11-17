# Land Placement Constants section, nested chains and chain drag (build brief)

Written 2026-11-14 for a Sonnet build session. The owner settled every decision below on
2026-11-14. Build the three features in the order given and nothing else. Where the brief says
**STOP AND ASK**, message the owner and wait. Don't choose for them.

All paths are relative to `age-of-rms/`. Other sessions edit this repo at the same time. Re-read
a file right before editing it, use Edit (never a whole-file Write on an existing file), don't
`git commit`, and run `npx prettier --write` on the files you changed at the end. Every new
interactive control is wrapped in `HelpTip` with a new `reference/data/ui-help.json` entry. Keep
the text short (what it does, its range, its effect), as CLAUDE.md asks.
`src/tools/__tests__/helpCoverage.test.ts` checks every id has text. New prose in code comments,
docs and UI strings follows the repo CLAUDE.md language rule (no colons, semi-colons or dashes
as punctuation).

Each gate runs `npx vitest run src/tools/builtin/landPlacement`, plus any new test file by its
exact path. Never run vitest over the whole repo while another session's sweep may be running.
Run the full `npm test` once, at the very end.

---

## Feature 1. Constants section and Create constant

### What the owner wants

- A formula box that uses a name defined nowhere (say `ISLAND_SIZE` typed into Base size)
  offers to create that constant in its warning.
- A new **Constants** section sits above Roles, so the right column reads Constants, Roles,
  Shapes, Lands.
- The section lists two kinds of row.
  1. **Panel constants**, owned by the panel, made with Create or with the section's own Add
     button.
  2. **Script constants**, the names a formula box in the model uses that the script defines
     outside the fence. These are editable too.

### Decisions (settled, don't reopen)

- **A. Panel constants live inside the fence.** The model stores them, and every Apply writes
  them out again as `#const` lines at the top of the fence body. So Apply never loses them,
  which answers the reason Q4 gave. This reverses `docs/name-lookup-design.md` Q4, and item 1.6
  updates that doc.
- **B. Editing a script constant rewrites only the number on its defining line.** This is the
  one deliberate exception to the rule that the panel writes only inside its fence. A row that
  can't be edited this way is read-only and shows why (the rules are in item 1.5).

### Items in build order

**1.1 Model field.** Add this to `src/tools/builtin/landPlacement/model.ts`.

```ts
export interface PanelConstant {
  /** Stable, from freshId("const", takenIds(model)). */
  id: string;
  /** The emitted #const name, written as typed. */
  name: string;
  /** May use script #consts, RandomParams and EARLIER panel constants only. */
  value: Expr;
}
```

Add `constants: PanelConstant[]` to `AlpModel`. Every place that builds an empty model (search
for `randomParams: []`) gains `constants: []`.

**1.2 Fence read upgrade. Never bump `FENCE_VERSION`.** A beta with this tool has been out since
2026-09-15, so a fence written before this change has no `constants` key. `readFenceModel` in
`fence.ts` (around line 179) refuses a model unless `placements`, `roles`, `randomParams` and
`groups` are arrays. Leave that check alone and do NOT add `constants` to it. After the existing
`upgradeRoles(...)` call, apply a new `upgradeConstants(model)` that sets `constants: []` when
the key is missing or is not an array. Write it in the same style as `upgradeRoles`, a no-op on a
current model, applied in this one place only.

Gate 1.2. A test in `__tests__/` reads a fence JSON with no `constants` key and gets
`constants: []`. A fence written with constants round-trips (the second Apply makes zero edits).

**1.3 Emission.** In `emitModel.ts` `emitAlpModel`, add a step 0.5 straight after step 0's
`emitRandomParams`.

- Emit one `#const` cell per panel constant, in list order. Resolve its `value` through
  `resolveExprParams` first, the way roles do.
- The name is the constant's own `name`, never an allocated one. Reserve every panel constant
  name in `namer` before anything else allocates, so no generated name can take it. Find how
  `NameAllocator` (`compiler/naming.ts`) takes reserved names. If it has no way to reserve an
  exact name, **STOP AND ASK** before adding one.
- Refuse the emission (add a problem to the result the way `paramProblems` does) in these four
  cases. Each refusal carries a message the panel shows on that row.
  1. The name is also a script `#const` or `#define` (`scriptSymbols` has it).
  2. Two panel constants share a name.
  3. A value uses a panel constant at or after its own position.
  4. A value uses a name the model emits for a placement or role.
- The cells go into the fence body after the param cells and before the role cells. Read the
  comment at emitModel.ts ~442 on why the prologue lands after the params, and keep panel
  constants ahead of the prologue too.
- Update the `EmissionResult.body` doc comment (line ~45), which says role constants come first.

`resolveSym` in `LandPlacementPanel.tsx` (~line 349) already reads `emission.resolved`. Confirm
panel constants appear there. No change should be needed. If they don't, **STOP AND ASK**.

Gate 1.3. Tests cover each of these.

- A model with `constants: [{name:"ISLAND_SIZE", value: num 300}]` and a role whose base size is
  `sym("ISLAND_SIZE")` emits `#const ISLAND_SIZE 300` before the role's lines, and
  `verifyEmission` passes on it.
- Each of the four refusals fires with its message.
- A model with `constants: []` emits a body byte-identical to today's (use an existing golden
  body test as the reference).

**1.4 Create offer in a formula box.** `UnknownNameNotes` (`LandPlacementPanel.tsx` ~line 180)
renders `describeUnknownName(u)` for each result of `findUnknownNames`
(`panel/formulaField.ts:353`).

- A name whose reason is `notInScript` (defined nowhere) gets a **Create constant** button after
  its note. Every other reason means the script defines the name somewhere, so there is no
  offer, as name-lookup-design.md Sec.7 and Sec.9 already rule.
- Clicking it shows a small empty numeric `Value` input and a **Create** button in place. Create
  stays disabled until the input parses as a number. Enter clicks Create and Esc closes the
  input.
- Create calls a new `addPanelConstant(model, name, value): AlpModel` in `panel/modelOps.ts`
  through `FormulaEnvContext.onChangeModel`, which is already in the context for writes of this
  kind. Then it selects the new row in the Constants section. The box warning goes away by
  itself once the name resolves.
- HelpTip ids are `landPlacement.constCreate` and `landPlacement.constCreateValue`.

**1.5 The Constants section.** Add a `ListSection` titled `Constants` above the `Roles` one
(`LandPlacementPanel.tsx` ~line 640, same props pattern, `helpId="landPlacement.constants"`).

A panel constant row has these controls.

- Name, a text input committed on Enter or blur. Renaming rewrites every `sym(oldName)` leaf in
  the model to `sym(newName)` through a new `renamePanelConstant` in `modelOps.ts`. It walks
  Exprs the way `exprsIn` in formulaField.ts finds them, never through a field list.
- Value, a `FormulaField`.
- Remove, a button. It works even while formulas still use the name. Those names then show in
  the box warnings and the unset names notice like any other unknown name.
- An Add button at the top of the section creates `NEW_CONST` with value 0, then `NEW_CONST_2`
  and so on when the name is taken.
- HelpTip ids are `landPlacement.constName`, `landPlacement.constValue`,
  `landPlacement.constRemove` and `landPlacement.constAdd`.

Script constant rows come after the panel ones, each with a small "in script, line N" note.

- The list is every `sym` name in the model's Exprs that matches a `SymbolInfo` in `parseResult`
  and that the fence does not emit. Build it with a new pure function
  `collectScriptConstUses(model, scriptSymbols, fenceSpan)` in `formulaField.ts`, beside
  `collectUnsetNames` and on the same `exprsIn` walk. Show a use count.
- A row is editable only when all five hold. Otherwise it is read-only and shows the reason in
  brackets.
  1. `directiveKind === "const"`, else "a #define has no number".
  2. `conditionalDepth === 0`, else "defined inside an if or random branch".
  3. Exactly one `SymbolInfo` has the name, else "defined N times".
  4. The token at `valueToken` is a single number literal and the next token is on a later line
     or is a comment, else "its value is not a plain number".
  5. It is not an included name (`parse.includeIndex`), else "defined in an include file".
- An edit is a numeric input committed on Enter or blur, never per keystroke. The commit sends
  one `TextEdit` replacing exactly the value token's span through the panel's `applyTextEdits`
  prop (~line 263). Nothing else in the document changes, and editor undo reverts it.
- The HelpTip id is `landPlacement.constScriptValue`.

Gate 1.5. Pure tests cover `collectScriptConstUses`, each of the five read-only rules, the edit
being one TextEdit over the value token only, and rename rewriting every use.

**1.6 Docs.** In `docs/name-lookup-design.md`, make three changes.

- In the surfaces table row for the Land Placement formula (line ~21), "No create offer (Q4)"
  becomes "Create offer into the panel's own Constants (Q4 reversed 2026-11-14)".
- Rewrite the Sec.4.3 sentence at line ~122 to match.
- Under Q4 (line ~303) the reversal note is already written. Change its "not built yet" to the
  build date.

Add a build log entry the way earlier slices did (`docs/build-log.md`).

### Limits (don't build)

- No create offer added to the Breakdown or Code by this work. They have their own already.
- No Create all button in the unset names notice. It keeps its Copy snippet.
- Panel constants are never `#define`s and never sit inside a branch.
- No turning a script constant into a panel constant, or back.

---

## Feature 2. Chained lands off chained lands, any depth

### What the owner wants

A chained land on a shape's pattern can carry chained lands of its own, to any depth, and each
one repeats on every copy. For example, an 8-player ring with gold chained off each player land
and stone chained off each gold gives 8 stones, each measured from its own gold. Today
`ChainTemplate` (`model.ts:307`) cannot carry templates, and the comment at `model.ts:299-306`
says depth 1. The one-off way, a standalone land whose Parent is one expanded chain copy, must
keep working.

### Items in build order

**2.1 Model.** Add `parent?: string` to `ChainTemplate`, the id of another template in the SAME
slot's `chain`. Absent means it hangs off the slot member, which is every template today, so
old fences need no upgrade. The invariant is that a template's parent appears earlier in
`slot.chain`, and the ops in 2.4 keep it. Rewrite the depth 1 comment above `ChainTemplate`.

**2.2 Expansion.** In the second pass of `expandShapeGroup` (`expand.ts` ~line 379), a template
with `parent` gets `` parent: `${memberIdFor(group.id, i, slot.id)}#${t.parent}` `` in place of
the member id. Its own id stays `${memberId}#${t.id}`, still unique because template ids are
unique per model. Keep `repeatIndex: i`, and keep the push order (slot order, then array order).
With the invariant every parent is pushed before its child, so `chainPerRepeat` and
`chainMemberKeyAt` need no change. Add a dev assertion that throws when the invariant is broken.
Pass 2 of `reExpand.ts` keys on (repeat, slot, template) and should need no change. Prove that
with a test rather than assuming it.

Gate 2.2. A two-level template expands to the right parents over 3 repeats. Re-expanding after
a repeat count change keeps a nudged grandchild nudged. Emission resolves the grandchild from
its chained parent, checked against hand-computed numbers on a radial frame.

**2.3 Guards and the tree.**

- `computeGuardLabels` in `prologue.ts` (~line 368) already walks `guardOf` up the parents. Add
  a test that a grandchild of player 3's land gets `ALP_AT_LEAST_3`, and change code only if it
  fails.
- In `panel/viewModel.ts` the tree must nest grandchildren under their chained parent (see
  `buildPlacementTree` and the `chainMembers` handling ~line 160).
- The cycle check (~line 234) must still refuse a standalone land parented to its own
  descendant.

Gate 2.3. Tree tests cover depth 2 and a cycle refusal through a chained copy.

**2.4 Panel ops and UI.** In `panel/modelOps.ts` make these changes.

- `addChainTemplate` (~line 986) takes an optional `parentTemplateId`. With one, the new
  template goes straight after the last template in that parent's subtree. Without one it is
  appended as today.
- `removeChainTemplate` (~line 1050) removes the template and every descendant template. The
  existing keep rule applies to every removed copy (copies that are nudged, have a child of
  their own, or are referenced elsewhere stay as ordinary lands, per the
  `landPlacement.chainRemove` text).
- `updateChainTemplate` stays as it is. Changing `parent` is not offered in this slice.

In the chain template list (`LandPlacementPanel.tsx` ~2538 to 2650), indent each template under
its parent and give each row a small **+ chained land** button that calls `addChainTemplate`
with that template as parent. Its HelpTip id is `landPlacement.chainAddNested`, with text saying
it adds a land hanging off this chained land, one per copy. Update the
`landPlacement.chainRemove` text to say descendants go with it.

Gate 2.4. Ops tests cover the insert position, removing a subtree and the keep rule on a removed
grandchild. The P5 round trip (Apply twice, zero edits) passes on a depth 3 model.

### Limits

- No moving a template to another parent.
- No templates across slots.
- No depth cap. If a test shows a code path that recurses without a bound, **STOP AND ASK**.

---

## Feature 3. Dragging a chained copy moves every copy, Ctrl moves just the one

### What the owner wants

Dragging an expanded chain copy (`isChainMember`, `modelOps.ts:968`) changes the TEMPLATE's
offset, so every copy on every repeat moves together. Holding Ctrl moves only that copy, which
is what every drag does today (`applyDragToPlacement`, `modelOps.ts:820`, sets `nudged: true`).
This covers templates whose offset is an angle and radius or a formula.

Settled with it, whole percent snapping moves from **Ctrl to Shift**.

### Items in build order

**3.1 Snap key.**

- In `handlePlacementDrag` (`panel/LandPlacementCanvas.tsx` ~line 316), change
  `modifiers.ctrl ? snapToIntegerPercent(...)` to `modifiers.shift ? ...`.
- In `LandPlacementHelpDialog.tsx` (~line 162), the line about holding Ctrl to snap to whole
  percentages names Shift instead.
- Search `reference/data/ui-help.json` and `docs/manual-test-run-sheet.md` for other Ctrl snap
  mentions and update them.
- Update any test that passes `ctrl: true` expecting a snap.

Gate 3.1. The snapping tests pass with `shift: true`.

**3.2 Find the template for a copy.** Add `chainTemplateOf(model, placementId)` to
`modelOps.ts`, returning `{ groupId, slotId, templateId }` or `undefined`. Work it out from the
copy's index in `group.chainMembers` through `chainMemberKeyAt`, never by splitting the id text.

**3.3 A plain drag edits the template.** In `handlePlacementDrag`, when `chainTemplateOf` finds
a template and `modifiers.ctrl` is false, do the following.

- Run `applyDrag` exactly as today. The anchor is the copy's own parent and `resolvedOffsetOf`
  gives the copy's resolved offset, so the outcome's offset is in the parent's frame, the same
  frame `ChainTemplate.offset` uses.
- On `ok: false`, call `setDragDecline(outcome.reason)` as today. Formula offsets go through the
  existing absorb or decline path (`symbolicDeclineReason`) unchanged.
- On `ok: true`, call `updateChainTemplate(m, groupId, slotId, templateId, { offset:
outcome.placement.offset }, parseResult, emission)` inside `onModelChange`, and keep the model
  as it was when it returns null.
- A plain drag on a copy that is already `nudged` also clears its flag, so it rejoins its
  siblings at the new template offset. The owner confirmed this 2026-11-14.
- Other nudged copies keep their own offsets (reExpand already does this).

With Ctrl held, keep today's path exactly (`applyDragToPlacement`, which sets `nudged`). Ring
members that are not chain copies behave as today either way.

Change the `landPlacement.chainOffset` help text, which says dragging nudges only that copy. It
now says dragging moves every copy and Ctrl+drag moves just the one. Add the same line to the
drag list in `LandPlacementHelpDialog.tsx`.

Gate 3.3. Interaction tests cover each of these.

- A plain drag on repeat 2's copy moves the template, and every repeat moves.
- Ctrl+drag moves only that copy and sets `nudged`.
- A plain drag on a nudged copy clears its nudge.
- A `sym ± num` formula offset absorbs the drag, and any other formula declines with the reason.
- A depth 2 grandchild drags its own template, not its parent's.

If moving every copy on each `move` event lags by more than a frame on an 8-repeat ring in the
mock Tauri browser harness, **STOP AND ASK** before adding a commit on release path.

---

## Run sheet

Section 58 of `docs/manual-test-run-sheet.md` holds the stub. Fill in anything the build
changed. Check the last section number first, since another session may have used 58.

## Final gates

1. `npx vitest run src/tools/builtin/landPlacement` is green.
2. `npm test` is green once, at the end.
3. `npm run typecheck` is clean.
4. Prettier runs on the changed files.
5. The build log entry is written, and a commit message is drafted to
   `RMS/commit-message-2026-11-14-alp-constants-chains-drag.txt` (don't commit).
