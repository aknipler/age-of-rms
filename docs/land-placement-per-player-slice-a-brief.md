# Land Placement, per-player slice A brief: rings that follow the player count

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-per-player-escalation.md` (rev 5), which Sec.12 Q10 of
`docs/land-placement-design.md` points to. Read this file for *what to build and in what order*;
read the design for *why*, and treat the design as authoritative wherever the two disagree.

**Slice A delivers the whole user-facing ask on its own.** A ring can be marked per-player, and
the emitted script then produces one repeat per player who is actually in the game, arranged
evenly at whatever that count turns out to be. Authored angle rules are slice B and per-count
rules are slice C; neither is needed for this to be useful, and neither should be started here.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules and Teaching mode.
2. `docs/land-placement-per-player-escalation.md`, **sections 2, 3, 4, 7 and 8**. Sections 5, 6
   and 9 are context you do not need yet. Section 1 records two wrong turns; read it so you do
   not retake them.
3. `docs/land-placement-design.md` Sec.4.5 (roles and repeating patterns, including the corrected
   composition paragraph and the merge rule), Sec.5.1 (what the engine actually does), Sec.5.4
   (the trig macro), Sec.5.6 (names), Sec.6.1 (the fence), Sec.12 Q3 and Q10.
4. `src/tools/builtin/landPlacement/emitModel.ts` and `compiler/verify.ts` and `compiler/emit.ts`
   together. Items 2 and 3 change all three and they are one pipeline.
5. `src/tools/builtin/landPlacement/expand.ts` with its test. **You are not changing it.**

## 1. What to build, in order

### Item 1: `ShapeGroup.perPlayer`

```ts
/**
 * One repeat per player, resolved at runtime. `repeats` is held at
 * MAX_PLAYER_COUNT while this is set, so expansion keeps operating on a
 * fixed member list and every member is guarded by its own repeat index.
 */
perPlayer: boolean;
```

Sec.4.5 already makes a repeat index a player index, so `assignToPlayer` and
`ZonePolicy.perRepeat` need no change: member (i, j) belongs to player i+1.

`expandShapeGroup`, `memberKeyAt` and `reExpand`'s merge rule must all keep working untouched.
That is the point of pinning `repeats` rather than making it optional. `shapeGroupLandTotal`
(`panel/viewModel.ts`) is the one consumer that has to learn the difference, since the panel
currently prints an exact land count and a per-player ring has an upper bound instead.

### Item 2: `#define` as an emission kind

Every cell the compiler emits today is a `#const` with a value. A `#define` has none.

**Do not teach `verifyEmission` about a valueless cell.** Give the define its own kind and
exclude it from the numeric resolve-and-compare path entirely. A define contributes a NAME (so it
must reach `emittedNames` for P4, item 5) and no value.

### Item 3: the prologue

Emitted once per fence, before everything else in the body.

```
if 1_PLAYER_GAME
    #const ALP_DEG_P1 0
elseif 2_PLAYER_GAME
    #define ALP_AT_LEAST_2
    #const ALP_DEG_P1 0    #const ALP_DEG_P2 180
elseif 3_PLAYER_GAME
    #define ALP_AT_LEAST_2 #define ALP_AT_LEAST_3
    #const ALP_DEG_P1 0    #const ALP_DEG_P2 120   #const ALP_DEG_P3 240
...
endif
```

**Cover 1 through 8, not 2 through 8.** `MIN_PLAYER_COUNT` is 2, and that bound is about what can
be authored in this app, not about what a published map meets in the wild. Omit the 1 player
branch and a 1 player game matches nothing, defines no label, and emits no lands at all. See the
design's 8.4, which exists because an earlier revision got exactly this wrong.

Angles are **per land per branch**, never one shared step constant. The design's 4.1 gives both
reasons: a shared step accumulates nearly 3 degrees of drift into the final gap at 7 players, and
it cannot express slice B's per-land rules at all.

**Emit no `else`.** The enumeration is exhaustive, so an `else` could only be dead code implying
a case that is already covered.

### Item 4: per-player member angles come from the emitter

`expandShapeGroup` is pure and has no `NameAllocator`, so it cannot name a prologue constant. It
keeps baking the even literal at the maximum count, which keeps the model well formed and
drawable. `emitAlpModel` then substitutes a reference to the prologue constant it allocated.

**Do not add an `Expr` leaf kind for this.** `Expr` is published contract in `tools-api/index.ts`
with generated types behind `npm run check:generated-types`, and the emitter can do the
substitution locally where the allocator already lives.

### Item 5: names go through `NameAllocator`

`ALP_AT_LEAST_3` and `ALP_DEG_P3` are emitted names. Allocate them like every other cell and get
them into `EmissionOk.emittedNames`, so P4 sees them. **Do not hardcode the bare `AT_LEAST_3`
spelling**: authors already write this prologue by hand, and a script carrying its own would
shadow the tool's or be shadowed by it.

### Item 6: one guard per `create_land`

```
if ALP_AT_LEAST_3
create_land { ... }
endif
```

A land belonging to player *k*, **or chained to a land belonging to player *k***, is guarded by
`ALP_AT_LEAST_k`. A land belonging to no player is not guarded. Player 1 needs no guard.

**Emit the conditional structure from a structure that cannot unbalance**, never by string
concatenation at the call site, and assert balance over the rendered fence in a test. Unbalanced
`if`/`endif` is the one hazard this whole feature carries, and the author-written example the
design quotes demonstrates it.

### Item 7: the panel

A per-player checkbox on the ring editor (`ShapeGroupEditor` in `LandPlacementPanel.tsx`),
wrapped in `HelpTip` with a matching `reference/data/ui-help.json` entry, per CLAUDE.md's rule.
When it is on, the Repeats input is meaningless and should be disabled with a title saying why.

The preview draws one count. The panel already receives `playerCount` and threads it into
`useEmission`; resolve `ALP_DEG_Pk` at that count. Changing the player count in generation
settings should visibly rearrange the ring, which is the main thing to check by hand.

### Item 8: P2 stands down for a per-player ring

P2 warns that something was emitted for a count the script is no longer set to. A per-player ring
is correct at every count by construction, so P2 must not fire for one. It keeps firing for
`perPlayer` `RandomParam`s, which slice B handles and this slice does not touch.

## 2. Acceptance

- **Sec.10.1's acceptance gate must stay byte-identical.** Bulls_Eyes is a fixed-count map with
  `perPlayer` false everywhere. It is the regression test that this feature did not disturb the
  existing path, and it must not be edited to accommodate you.
- A per-player ring of one slot emits 8 lands, a prologue of 8 branches, and 7 guards.
- The rendered fence has balanced `if`/`endif` at every player count, asserted by a test.
- `emittedNames` contains every `ALP_AT_LEAST_*` and `ALP_DEG_*` name.
- P4 reports no collision on a clean script, and still reports one when a name is genuinely taken.

## 3. Hazards

1. **`#define` through the verifier.** It will try to evaluate a cell with no value. Item 2.
2. **Hardcoded `AT_LEAST_k` names.** Collides with an author's own prologue. Item 5.
3. **Unbalanced conditionals.** Item 6.
4. **A 2-through-8 prologue.** Item 3, and the design's 8.4.
5. **Adding an `Expr` leaf kind.** Item 4. It is a published contract change for no gain.
6. **Editing `expandShapeGroup`.** Item 1 is designed so you do not have to.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, and full `npm test`. Update
CLAUDE.md's test count row if a test file lands.

**Mutation-test the balance assertion and the guard logic**, per CLAUDE.md's rule that a check
which has only ever passed proves nothing. Restore from a byte copy, not by reverse substitution.

**Nothing in this environment can render the panel** (see CLAUDE.md's environment section), so
end the session with a written run sheet for `npm run tauri dev`: mark a ring per-player, change
the player count in generation settings, confirm the canvas rearranges, Apply, and read the
emitted fence.

Append a `docs/build-log.md` entry, and follow the house language rules in CLAUDE.md for every
comment and user-facing string you write.
