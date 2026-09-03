# Land Placement, per-player slice B brief: authored angles, and the last edit-time count pin

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-per-player-escalation.md` (rev 5), section 5 in particular. Read this file
for *what to build and in what order*; read the design for *why*.

**Slice A must be built and green before this starts.**

**Most of this slice is verification, not construction**, and that is the finding rather than an
excuse. Three of the four angle rules the owner asked for already work in the model:
`Placement.offset.theta` and `PatternSlot.theta` have been `Expr` since slice 1, the formula
field has been the authoring surface since slice 5, and `RandomParam` already hoists. Bulls_Eyes
is the worked example and it is in the corpus. **Expect to write more tests than code, and do not
manufacture work to fill the gap.**

---

## 0. Read before writing code

1. `CLAUDE.md` in full.
2. `docs/land-placement-per-player-escalation.md` **section 5 in full**, plus 7.7 and 9's slice B
   line.
3. `docs/land-placement-design.md` Sec.4.4 (random parameters and the per-player checkbox, whose
   restriction this slice lifts), Sec.5.1 (`rnd` may only be a whole `#const` value).
4. `test-maps/Bulls_Eyes.rms` lines 20 and 131. That two line idiom is the feature.
5. `src/tools/builtin/landPlacement/paramEmit.ts` and `panel/formulaField.ts` with their tests.
6. `src/tools/builtin/landPlacement/panel/dragMath.ts`, specifically `symbolicDeclineReason` and
   the `applyDrag` refusal path.

## 1. What to build, in order

### Item 1: confirm a ring member's angle is authorable, and make it so if it is not

`PlacementEditor` hides the Parent and Frame controls for a group member (`!inGroup`), which is
right, since a member's parent and frame come from its group. **Check what it does with the
offset fields.** A member's own theta must be editable through the formula field, because that is
the entire authoring surface for rules 2, 3 and 4 in the design's 5.1.

If it is already reachable, write the test that pins it and move on. If it is not, make it
reachable. Do not redesign the editor.

### Item 2: an authored member theta must survive into the prologue

Slice A's emitter substitutes a per-player member's theta with a reference to the prologue
constant it allocates. **That substitution must not clobber an authored angle.**

The rule: the prologue constant's VALUE is the member's own rule where it has one, and the even
default otherwise. A member carrying `nudged`, or a theta that is anything other than the even
literal expansion produced, has a rule.

So `#const ALP_DEG_P2 (ALP_DIST_BW_PLAYERS + ALP_ROTATION)` is a legitimate prologue line, and it
is what Bulls_Eyes' own second player would emit if that map were rebuilt as a per-player ring.

Note the ordering constraint that falls out: a hoisted `rnd` constant must be emitted **before**
the prologue that references it, since `paramEmit.ts` already guarantees params come first. Check
that the prologue lands after the param cells and before the body.

### Item 3: `perPlayer` `RandomParam`s emit at the maximum

Sec.4.4 emits one draw per player at the count the script was authored for, which is the
`emittedForPlayerCount` decay P2 warns about. Under a per-player ring the count is runtime, so
these must emit at `MAX_PLAYER_COUNT` and let each player's land reference its own copy. Unused
draws are harmless.

**Sec.4.4 is explicit that this restriction must be lifted for parameters and for rings "together
or not at all".** Slice A lifted it for rings. This lifts it for parameters, so the rule is
satisfied rather than sidestepped. P2 then stops firing for `perPlayer` parameters too, which
leaves P2 covering nothing in this feature; check whether it still has any live caller before
deleting anything.

**Update Sec.4.4's own text** to record that the restriction is lifted and how, since that
section currently states it as a standing limitation.

### Item 4: the drag refusal, tested against a per-player angle

`applyDrag` already declines rather than overwriting a symbolic offset, and `dragMath.ts` has
tests for the fixed-count case. A per-player angle is a `sym` reference to a prologue constant, so
it lands on the same path and must decline the same way.

**This is more likely to be hit after slice A, not less**, since every per-player member now
carries a symbolic theta by construction. Write the test. Mutation-test it: a fixture that cannot
distinguish is the failure mode this repo has hit repeatedly, so pick a case where the guarded and
unguarded code genuinely differ.

## 2. Acceptance

- Sec.10.1's Bulls_Eyes gate still byte-identical.
- A per-player ring whose second member carries an authored theta emits that rule into every
  prologue branch, and the even default for members that have none.
- A `perPlayer` `RandomParam` emits 8 draws regardless of the current player-count setting.
- Dragging a per-player member declines with a stated reason and does not modify the model.

## 3. Hazards

1. **Clobbering an authored angle with the even default.** Item 2 is the whole slice.
2. **Emitting the prologue before the hoisted params it references.** Item 2.
3. **Deleting P2 because nothing in this feature uses it.** Check for other callers first.
4. **A drag test whose fixture passes with the guard removed.** Item 4.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, full `npm test`. Update
CLAUDE.md's test count row if a test file lands. Append a `docs/build-log.md` entry.

Run sheet for `npm run tauri dev`: build a per-player ring, give one member a formula angle
referencing another member, confirm the canvas honours it, confirm dragging that member refuses
with a message, Apply and read the fence.
