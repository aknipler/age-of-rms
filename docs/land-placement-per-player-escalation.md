# Land Placement design: per-player rings

**Status: design, ready to implement, sliced in section 9.** Raised 2026-09-02 from a run of the
built panel, revised four times the same day. Revision 2 discarded a wrong option, revision 3 discarded revision 2's
emission shape after the owner supplied the idiom in section 3, and revision 4 added section 5
after the owner asked whether authored angles survive any of it. Both corrections are kept, since
each names a way of reasoning that failed.

The ask: a ring should rearrange itself around however many players are in the game. Read the
count at the top of the script, then apply the rules the author set in the tool.

---

## 1. Two corrections, kept because the reasoning matters

**Revision 1 said: emit the maximum count and let the extras be harmless.** Dead. An 8 land ring
has its lands 45 degrees apart, so removing one leaves the survivors 45 degrees apart and opens a
single 90 degree gap. Membership is not the only thing that changes with the count. **The
arrangement changes**, and an arrangement is fixed the moment its angles are written. Revision 1
reasoned about which lands exist and never about where the remaining ones sit.

**Revision 2 said: emit one complete arrangement per player count, and Q3's `ALP_STEP` ladder is
superseded.** Also wrong, for a more interesting reason. It correctly established that the count
labels are exact rather than thresholds, correctly concluded that "emit this land when the count
is at least *k*" cannot be written **directly**, and then treated that as a fact about the engine
when it is only a fact about the labels. **A threshold you cannot write can still be
manufactured.** The cost of not asking was a design emitting 140 lands where 32 do.

When a constraint blocks an expression, check whether the value can be computed once and stored
before concluding the expression is unreachable.

## 2. The engine constraints, as they actually stand

- **The count labels test an exact count.** `1_PLAYER_GAME` through `8_PLAYER_GAME`, all
  `verified: true`, each reading "Exactly N players in the game". There is no threshold label.
- **`if` does not support a boolean operator.** Confirmed by the owner 2026-09-02. One label per
  condition.
- **`if` tests a LABEL, never a constant** (Sec.5.1). This is what makes the design work, because
  `#define` creates exactly that: a label, testable by a later `if`.
- **`#const` and `#define` are both legal inside an `if` branch**, and only the taken branch's
  definitions come into existence. Bulls_Eyes' own `MAPSIZE` ladder already relies on this.
- **`rnd(a,b)` may only be a `#const`'s entire value**, never a term inside an expression
  (Sec.5.1). Every random quantity is therefore hoisted to its own constant and referenced by
  name, which is what `paramEmit.ts` already does for every `RandomParam`.

## 3. The idiom: manufacture the thresholds once

Supplied by the owner from working scripts. A prologue converts the exact count into cumulative
labels:

```
if 2_PLAYER_GAME
    #define AT_LEAST_2
elseif 3_PLAYER_GAME
    #define AT_LEAST_2 #define AT_LEAST_3
elseif 4_PLAYER_GAME
    #define AT_LEAST_2 #define AT_LEAST_3 #define AT_LEAST_4
...
endif
```

After this block `if AT_LEAST_5` is a working threshold anywhere in the script. The same prologue
is where team-shape flags belong (`#define 3V2` guarded by `TEAM1_SIZE3` / `TEAM2_SIZE2`), which
is beyond this feature's scope but shares the mechanism exactly, so build the emitter so that
adding them later is adding rows rather than rethinking the shape.

**A note on the source material.** The owner's example carries a comment marking an `endif` whose
necessity was unclear, and a warning that its nesting may not balance. That is the natural
consequence of hand-writing nested conditionals across eight branches, and it is the strongest
argument for the tool owning this block: generated nesting balances by construction.

## 4. The emission shape

Three parts. Only the third is conditional.

**4.1 Prologue, once per fence.** Eight branches. Each defines the cumulative `AT_LEAST_k` labels
for its count, and **one angle constant per player land**, whose value comes from that land's
angle rule (section 5) evaluated at that count.

```
if 2_PLAYER_GAME
    #define ALP_AT_LEAST_2
    #const ALP_DEG_P1 0    #const ALP_DEG_P2 180
elseif 3_PLAYER_GAME
    #define ALP_AT_LEAST_2 #define ALP_AT_LEAST_3
    #const ALP_DEG_P1 0    #const ALP_DEG_P2 120   #const ALP_DEG_P3 240
...
endif
```

**Emit an angle per land per branch rather than one shared `ALP_STEP` per branch.** The
alternative, `theta = ROTATION + k * ALP_STEP`, needs one constant instead of *k* but accumulates
rounding error: at 7 players the step rounds 51.43 to 51, and by the seventh land nearly 3
degrees have collected in the final gap. Rounding each angle independently caps the error at 0.5
degrees with no accumulation, the same reasoning `expand.ts` records for preferring rounding to
truncation. The cost is a triangular sum, 36 constants across all eight branches. It is also what
makes section 5 possible at all, since a shared step cannot express a per-land rule.

**4.2 Body, unconditional.** The existing frame algebra for **every** land, emitted exactly as it
is today at the maximum count, referencing `ALP_DEG_Pk` where it would otherwise carry a literal
angle. Nothing here is guarded. At 3 players `ALP_DEG_P7` is simply never defined, and the
constants derived from it are never read, because 4.3 never emits the land that would read them.

Chained aux lands need no special handling. Their offsets are relative to their parent through
the radial frame, so they follow whatever their player land does.

**4.3 One guard per `create_land`.**

```
if ALP_AT_LEAST_3
create_land { ... player 3 ... }
endif
```

A land belonging to player *k*, or chained to one, is guarded by `ALP_AT_LEAST_k`. A land
belonging to no player is not guarded.

## 5. Angles are authored, not fixed

The even distribution in 4.1 is the **default value of a rule**, not the only thing that can go
in that slot. This section exists because the first three revisions all wrote "the angles" as
though they were a property of the ring rather than something the author sets.

**Most of this already works, and Bulls_Eyes is the worked example.** That map does not use even
spacing for its second player. It writes:

```
#const DIST_BW_PLAYERS rnd(80,280)
#const DEGREES_P2 (DIST_BW_PLAYERS + ROTATION_PLAYER)
```

which is precisely "P2 spawns at a random bearing at least 80 degrees from P1". The hoisted `rnd`
and the reference to it are forced by Sec.5.1's rule that `rnd` cannot sit inside an expression,
and they are exactly the shape `paramEmit.ts` emits for a `RandomParam` today.

### 5.1 The four rules, and what each costs

| Rule | Emits | Status |
|---|---|---|
| **Even** (default) | integer literal per branch | The 4.1 default |
| **Fixed offset from another land**, "P2 is 30 from P1" | `ALP_DEG_P1 + 30` | Works today |
| **Offset with variance**, "30 from P1, plus or minus 1" | `#const V rnd(-1,1)` then `ALP_DEG_P1 + 30 + V` | Works today (Bulls_Eyes' `VAR_A1`) |
| **Free bearing within bounds**, "at least 30 from P1" | `#const S rnd(30,330)` then `ALP_DEG_P1 + S` | Works today (Bulls_Eyes' `DIST_BW_PLAYERS`) |

Three of the four need no new model. `Placement.offset.theta` and `PatternSlot.theta` are already
`Expr`, the formula field built in slice 5 is already the authoring surface, and `RandomParam`
already hoists. **What is new is only that a rule may differ per player count.**

### 5.2 Per-count rules go in the branch, and that is the whole mechanism

The 2 player example is explicitly per-count: the author wants a rule at 2 players that does not
apply at 8. The prologue already branches per count, so the branch is where a per-count rule
belongs. The branch for 2 players emits that author's rule; every other branch emits its own,
which is usually the even default.

**The body never changes.** It references `ALP_DEG_Pk` and does not care how that value was
reached. So customising one player's angle at one player count edits one line inside one branch,
and touches nothing else in the fence. That property is what keeps this from exploding, and it is
the reason 4.1 emits per-land angles rather than a shared step.

The model change is correspondingly small: a slot's angle becomes a default rule plus an optional
map from player count to an overriding rule. Absent an override, every branch gets the default.

### 5.3 The one guarantee the tool can make, and the one it must not

"Minimum 30 degrees apart" is a constraint over pairs, and **RMS cannot solve constraints at
runtime.** What it can do is draw within bounds that make the constraint true by construction,
which is what Bulls_Eyes' `rnd(80,280)` does for two players.

For *n* players the expressible form is even spacing plus bounded jitter: player *k* at
`even_k + rnd(-j, +j)` keeps every gap at or above `360/n - 2j`. **The tool knows *n* inside each
branch**, so it can compute the largest safe *j* for that count and warn or clamp when the author
asks for more. That is a real thing the tool can do that a hand-writer cannot, and it is the
shape the "minimum separation" affordance should take. A solver is not on the table.

**What must not be promised**: free bearings can collide. Three players each given an independent
`rnd` bearing can land on top of each other, and nothing in the emission prevents it. The panel
should say so plainly where the rule is authored, in the same spirit as the drag refusal
messages, rather than implying a guarantee it cannot keep.

### 5.4 This lifts Sec.4.4's restriction, which it has to

`RandomParam.perPlayer` emits one draw per player at the count the script was authored for, which
is the `emittedForPlayerCount` decay P2 warns about. Under a per-player ring the count is runtime,
so **`perPlayer` parameters emit at the maximum of 8** and each player's land references its own.
Unused draws are harmless.

Sec.4.4 is explicit that the edit-time restriction "should be lifted here and there together or
not at all". This lifts both, so the rule is satisfied rather than sidestepped.

## 6. What this costs

| | Revision 2 (arrangement per count) | This design |
|---|---|---|
| One player slot, counts 1-8 | 35 lands, ~455 consts | **8 lands**, ~104 consts + 36 prologue |
| One player slot plus 3 aux each | 140 lands, ~1,800 consts | **32 lands**, ~416 consts + 36 prologue |

The body is the size it is today. The additions are one prologue and a two line guard per
player-owned land. An authored angle rule adds at most one hoisted `rnd` constant per rule, not
per count. **The cost of supporting a player count is effectively zero**, which retires two of
revision 2's open questions outright.

## 7. Implementation brief

**7.1 Names go through `NameAllocator`.** `ALP_AT_LEAST_3` and `ALP_DEG_P3` are emitted names and
must be allocated and collision checked like every other cell, including into `emittedNames` so
P4 sees them. Do not hardcode the bare `AT_LEAST_3` spelling from the owner's example: a script
already carrying its own prologue would shadow the tool's or be shadowed by it. Reusing an
author's existing prologue is a separate feature with its own detection problem.

**7.2 `#define` is a new emission kind.** Every cell the compiler emits today is a `#const` with
a value. A `#define` has none and cannot go through `verifyEmission`'s resolve-and-compare path,
which would try to evaluate it. Give it its own cell kind and exclude it from numeric
verification rather than teaching the verifier about a valueless cell.

**7.3 Conditional structure is emitted from a structure that cannot unbalance**, never by string
concatenation at the call site, with a balance assertion over the rendered fence. Unbalanced
`if`/`endif` is the one hazard this block carries and the owner's own example demonstrates it.

**7.4 The preview draws one count.** The panel already receives `playerCount` and threads it into
`useEmission`. Resolve `ALP_DEG_Pk` for that count and draw the lands that count would emit.
Same split `RandomParam.perPlayer` already uses, and it makes "what does this look like at 4
players" a matter of changing the setting.

**7.5 `emittedNames`, `resolved` and `quantities` keep their flat shape.** Nothing here makes
resolution branch dependent: the body is unconditional and the prologue resolves at the one count
being previewed. This is the main reason to prefer this shape beyond size.

**7.6 P2 stops firing for a per-player ring**, which is correct at every count by construction.
It stays for anything still pinned to an edit-time count, which after 5.4 is nothing in this
feature.

**7.7 An angle rule is an `Expr` and inherits every rule that already governs one**, including
the drag refusal: dragging a land whose angle is a formula or a random parameter must decline
with a reason rather than overwrite it, which `applyDrag` already does. A per-count rule makes
that more likely to be hit, not less, so it wants a test.

## 8. The model changes, pinned

Revisions 1 to 4 settled what the emission looks like and left the types to the reader. These are
the decisions an implementing session would otherwise have to invent, which this repo's own rule
says to escalate rather than improvise.

**8.1 A ring becomes per-player through one boolean, and a repeat means a player.**

```ts
export interface ShapeGroup {
  ...
  /**
   * One repeat per player, resolved at runtime. `repeats` then holds
   * MAX_PLAYER_COUNT and every member is guarded by its own repeat index,
   * so the emitted count follows the game rather than the model.
   */
  perPlayer: boolean;
}
```

Sec.4.5 already states that a repeat index is a player index ("a pattern with one `P` slot and 4
repeats assigns players 1-4"), so `assignToPlayer` and `ZonePolicy.perRepeat` keep working with
no change: member (i, j) belongs to player i+1 and is guarded by `ALP_AT_LEAST_{i+1}`.

`repeats` is pinned to `MAX_PLAYER_COUNT` while `perPlayer` is true, so `expandShapeGroup`,
`memberKeyAt` and the merge rule all keep operating on a fixed member list and need no change at
all. `shapeGroupLandTotal` is the one place that must learn the difference, since "8 lands" is
now "up to 8".

**8.2 The emitter owns per-player angles, not the expander.** This is the decision that keeps the
change small.

`expandShapeGroup` is pure, has no `NameAllocator`, and cannot name a prologue constant. So it
keeps doing exactly what it does today: it bakes the even literal for the maximum count. The
model therefore always holds a well formed, drawable arrangement. `emitAlpModel` then replaces a
per-player member's theta with a reference to the prologue constant it allocates.

Do **not** add an `Expr` leaf kind for this. `Expr` is published contract in `tools-api/index.ts`,
so a new leaf is a contract change with generated types behind it, and it buys nothing the
emitter cannot do locally where the allocator already lives.

The preview stays honest for free, because the canvas draws from `emission.resolved` and
`emission.quantities` rather than from the model's stored theta. The emitter resolves
`ALP_DEG_Pk` at the previewed count while writing all branches into `body`, which is what makes
7.5's flat shape true.

**8.3 Per-count overrides live on the Placement, keyed by count.**

```ts
export interface Placement {
  ...
  /** Angle at a specific player count, overriding `offset` there. Only consulted inside a perPlayer group. */
  thetaPerCount?: Record<number, Expr>;
}
```

On the Placement rather than the `PatternSlot`, because "P2 is 30 degrees from P1" is about one
member and a slot repeats across all of them. Members are already ordinary individually editable
Placements carrying `nudged`, which is exactly the mechanism that stops `reExpand` overwriting an
edited member, so this rides machinery that already exists and is already tested.

Theta only. Per-count radius is a plausible later want and is not asked for.

**8.4 The prologue covers 1 through 8, not 2 through 8, and this corrects section 9 item 3.**

`MIN_PLAYER_COUNT` is 2, so the app's own settings cannot author or preview a 1 player game. That
bound is about authoring and says nothing about what the published map meets in the wild, and
`1_PLAYER_GAME` is a real label. **Omit that branch and a 1 player game matches nothing, defines
no `AT_LEAST` label, and emits no lands at all**, which is precisely the silent-nothing failure
revision 3 called unreachable. It is unreachable only once the enumeration is genuinely
exhaustive. Emit the `1_PLAYER_GAME` branch, where only player 1's land survives its guard.

## 9. Slice plan

One handoff would be too large and this repo does not work that way. Three slices, each shippable.

Each slice has its own brief: `docs/land-placement-per-player-slice-a-brief.md`, `-slice-b-`,
`-slice-c-`. Hand one brief to one session.

**Slice A, the core.** `ShapeGroup.perPlayer`, the prologue with `AT_LEAST` labels and even
angles across all eight branches, one guard per player-owned `create_land`, `shapeGroupLandTotal`
learning "up to", the panel checkbox, preview at the current count, and P2 no longer firing for a
per-player ring. **This alone delivers the ask.** Everything in sections 4, 7 and 8.1, 8.2, 8.4.

**Slice B, authored angles.** Mostly verification rather than construction, since section 5 shows
three of the four rules already work: confirm the formula field is reachable on a ring member,
confirm a member's own theta survives into the prologue in place of the even default, and pin
7.7's drag refusal on a per-player angle with a test. The `perPlayer` `RandomParam` lift from 5.4
belongs here, since it is the same "stop pinning things to an edit-time count" change.

**Slice C, per-count rules and the jitter helper.** `Placement.thetaPerCount` from 8.3, the panel
surface for it (section 10's open judgement call), and the bounded-jitter control that computes
the largest safe jitter per count from 5.3 and warns or clamps past it.

**The acceptance gate does not move.** Sec.10.1's gate is regenerating Bulls_Eyes, which is a
fixed-count map with `perPlayer` false everywhere. It must stay byte-identical through all three
slices, and it is the regression test that this feature did not disturb the existing path.

## 10. Resolved

1. ~~Does `if` support a boolean operator?~~ **No.** Confirmed. Not needed.
2. ~~Which player counts ship as supported?~~ **Moot, an artefact of revision 2.** The prologue
   covers 1 through 8 for a fixed cost, so emit all eight branches always. No checkbox row.
3. ~~What does the `else` branch do at an unsupported count?~~ **No `else`, but only because
   8.4 makes the enumeration genuinely exhaustive.** Under revision 2 an author who ticked 2/4/6/8
   and a player in a 5 player game would match no branch, leaving every angle unresolvable and the
   ring emitting nothing, silently. Covering 1 through 8 makes that unreachable, and an `else`
   would then be dead code implying a case the enumeration already covers. **Note the correction in
   8.4**: revision 3 said 2 through 8 and would have left exactly this failure open at 1 player.
4. ~~Offer `create_player_lands` for the bare case?~~ **Rejected by the owner.** This tool is for
   advanced generation, and anyone wanting the simple path already knows that command.
5. ~~Sec.4.5's "Patterns and chains compose" paragraph is wrong.~~ **Corrected 2026-09-02.** It
   now separates the per-player case, where the chain repeats automatically because each child is
   guarded by its parent's threshold, from the fixed-count case, where it is still wired one
   member at a time, and records that `reExpand`'s departure rule keeps the manual path from
   rotting.

## 11. Still open

Nothing blocking, and nothing in slice A. ~~The one judgement call left is how the panel presents
a per-count rule (slice C), since it is the first field in this tool whose value depends on a
setting outside it. Decide it when slice C starts, with the panel in front of you, rather than
now.~~ **Decided 2026-09-03, slice C.** The plain Angle field keeps meaning the member's own
default rule, unaffected by anything a per-count override does; overrides get their own
always-rendered list below it (one row per count that has one, never folded into what the main
field shows), since making the main field itself track the currently-previewed count was
considered and rejected — that would make an override at any OTHER count invisible, the exact
trap this section named. Full reasoning in `docs/build-log.md`'s 2026-09-03 (later still) entry.
Nothing else is open; all three slices in Sec.9's plan are built and green.
