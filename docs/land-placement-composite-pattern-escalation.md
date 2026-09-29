# Land Placement design: a repeating composite, one main land plus its own chain, per player

**Status: BUILT, both slices, 2026-09-22.** Role picker at three sites, `ChainTemplate`,
`chainMembers`, the second expansion pass, the chain merge pass with the parent rewrite and
children-first departure, the Chain list, `chainTemplates.test.ts` including the `5 → 3 → 5`
case mutation-tested. Tauri run sheet: `docs/manual-test-run-sheet.md` section 12, whose item
10 is section 11's canvas-selectability judgement call, still open. Originally: design, ready
to implement, sliced in section 9. Raised as a one-line want on
2026-09-04 against `docs/land-placement-design.md` Sec.4.5 ("Future want: a repeating multi-land
pattern per player, the way `Bulls_Eyes.rms` is built by hand"), designed here 2026-09-21. First
session to touch it. Reviewed the same day against the tree; corrections are marked **[rev 1]**
in place. One of them (section 5.2's parent link) would have produced a plausible-looking wrong
map, and one (section 4(b)'s add-slot control) turned out to already exist with the exact id bug
slice 1's own test obligation warns about, now fixed as BUG-030.

The ask, in the shape the user reported it. `Bulls_Eyes.rms`'s real pattern is one player land
plus three auxiliary lands clustered around **that one land**, repeated once per player. Q10's
per-player rings rearrange ONE ring of lands around however many players are in the game. What
repeats here is a small structure rather than a single land.

---

## 1. The answer, and it is smaller than the want paragraph expects

**Option (c), a targeted addition, and the addition is one optional field plus one parallel
member list.**

Sec.4.5's want paragraph says "the missing concept is closer to a repeating COMPOSITE unit …
which does not exist anywhere in `model.ts` today", and floats a new node kind. That reading is
correct about the AUTHORING gap and wrong about the size of the hole underneath it. Section 2
measures what is already built, and the answer is that every mechanism the composite needs at
emit time exists, is generic over chain depth, and is already tested. What is missing is a way to
say the chain once and have it repeat, and to keep it in step afterwards.

So this is not a new capability. It is an expander that writes down what a user can already write
down by hand, twenty-four times.

## 2. What is already built, measured rather than assumed

Five mechanisms, each read out of the tree on 2026-09-21. Together they are the whole of the
composite's emit path.

**(a) Guard propagation already walks the chain, to any depth.**
`prologue.ts`'s `computeGuardLabels` answers a placement's `ALP_AT_LEAST_k` label by recursing
through `parent` until it reaches a per-player group member or the map centre. Its own comment
says so. A child, a grandchild and a great-grandchild of player 5's ring member all get
`ALP_AT_LEAST_5`, with a cycle guard, with no depth limit, today.

**(b) Owner resolution does the same.** `emitModel.ts`'s `computeOwnerPlayers` gives a chained
land its ancestor's player, which is what lets a `perPlayer` `RandomParam` resolve inside the
cluster.

**(c) The frame algebra already composes a radial child off a polar parent.** Sec.4.2's
`DEGREES_c = DEGREES_p + 180 + θ_c` is exactly the line `Bulls_Eyes.rms` writes by hand, and
`frame.ts` emits it.

**(d) The per-repeat zone already indexes by the player, not by the child.** This is the one that
looks like it would need work and does not. `Bulls_Eyes.rms`'s aux lands sit in zones 11 and 22,
which is `ZonePolicy.perRepeat` with base 11 and step 11 read at the PLAYER's repeat index. A
chain child built with `repeatIndex = i` copied from the member it hangs off resolves 11 and 22
with no new code at all.

**(e) The merge rule already protects a hand-wired chain.** `reExpand`'s departure rule refuses
to delete a member that has a child, releasing it instead with its parent, label, children and
last per-repeat literals intact.

**And the composite is already reachable.** A standalone `Placement` parented to one specific
per-player ring member (`parent: "ring#3#slotA"`) emits correctly and inherits that member's
guard, pinned by `emitModel.test.ts` ("a chained aux land is guarded by its parent's own
`ALP_AT_LEAST_k`") and `prologue.test.ts` ("a placement chained to a perPlayer group member
inherits that member's own guard"). **[rev 1]** The first draft said "confirmed by hand in
`docs/manual-test-run-sheet.md` section 3 item 7". That item is still ON the sheet, and the
sheet's convention is that a verified item is deleted, so its presence means it has never been
run in the real host. The property is unit-tested, not hand-confirmed.

## 3. Why the corpus settles the geometry, and it is a chain rather than a pattern

`Bulls_Eyes.rms` writes, for player 1, with the identical three lines for player 2;

```
#const DEGREES_P1_A1 (DEGREES_P1 + 180 + ROTATION_AUX + VAR_A1)
#const DEGREES_P1_A2 (DEGREES_P1 +  45 + ROTATION_AUX + VAR_A2)
#const DEGREES_P1_A3 (DEGREES_P1 + 315 + ROTATION_AUX + VAR_A3)
#const X_P1_A1       (RADIUS_AUX_LANDS * COS_P1_A1 + X_P1)
```

Under Sec.4.2's frame definition the `+ 180` is the frame and the rest is the angle ABC, so the
three children are `theta = ROTATION_AUX + VAR_A1`, `-135 + ROTATION_AUX + VAR_A2` and
`135 + ROTATION_AUX + VAR_A3`, each at `r = RADIUS_AUX_LANDS`, in their own player land's radial
frame. **Player 2's three are character-for-character the same offsets**, sharing the same
`ROTATION_AUX` and the same three `VAR_An` parameters. The cluster is one shape repeated, and the
only thing that differs between players is which land it hangs off and which zone it lands in.

That is what makes a template the right primitive rather than a per-player authoring aid. There
is one cluster in the author's head and eight copies in the file.

### 3.1 The corpus says this is rare, and says how rare, and the count cuts both ways

One grep over the 52 corpus maps with a `<LAND_GENERATION>` section, for a position constant
defined in terms of another land's position constant. **`Bulls_Eyes.rms` is the only map that
chains one land off another.** The other two trigonometry maps do not; `Venn.rms` and
`Rage Forest 2026.rms` anchor every computed land at `+ 50`, the map centre, so the deepest chain
either one contains is depth 0. The maximum chain depth anywhere in the corpus is **1**, in one
map.

Two readings, and both matter.

**Against building much**, one map is not a demand signal, and this design must not grow past it.
**For building this much**, the one map is the map Sec.2 names as this tool's acceptance bar, the
map the whole document is written about, and the reason the idiom is rare is visible in the file;
it costs 104 hand-written `#const` lines to express eight useful numbers. Rarity that is
explained by cost is not the same evidence as rarity that is explained by nobody wanting it.

The depth measurement is what bounds the design. Section 5 scopes templates to depth 1 and cites
this, rather than building an unbounded tree nothing has asked for.

### 3.2 A second composite shape the corpus has, reached by the same mechanism

Worth recording because it arrived unlooked-for and it is a second constituency for one feature.

`Venn.rms` gives every player land a companion at the **same bearing and a larger radius**;

```
#const X_P1    (RADIUS_PLAYER_LANDS * COS_P1 + 50)
#const X_P1_TC (RADIUS_PLAYER_LANDS + DIST_TC_FROM_CENTRE * COS_P1 + 50)
```

Left-associatively that is `(RADIUS_PLAYER_LANDS + DIST_TC_FROM_CENTRE) * COS_P1 + 50`, the same
angle at a longer radius. As a chain template it is one child at `theta = -180`,
`r = DIST_TC_FROM_CENTRE`, because `DEGREES_p + 180 + (-180)` folds to `DEGREES_p` under
Sec.5.3(b)'s integer fold, so the child's bearing IS its parent's and the vector sum lands on the
same tile.

**The position matches; the emitted text does not.** `Venn.rms` spends one multiplication and
this spends a vector sum, so this is a claim about where the land goes rather than about bytes.
Sec.10.1's byte-identical gate is `Bulls_Eyes.rms` and stays that way.

## 4. The three options, priced

### (a) A new composite node kind

A `Composite` alongside `Placement` and `ShapeGroup`, owning a main land and its dependents, with
`perPlayer` moved onto it.

**Rejected, and the price is the argument.** It needs its own expansion, its own merge rule, its
own release rule, its own `reExpand` branch, its own emitter branch, its own panel tree level and
its own fence serialisation. Every one of those is something `Placement.parent` already provides,
generically, tested, per section 2. It would also fork `perPlayer`, which today is a
`ShapeGroup` flag with one prologue reading it, into two places that must agree.

The deciding argument is not the line count. It is that a second way to express "this land hangs
off that one" makes the two representations diverge, and the map that reaches for a composite is
the map most likely to also want an ordinary chain hanging off it.

### (b) Already expressible, ship panel affordances only

Sec.4.5 names two panel gaps; `addRing` and `addStandalonePlacement` both take a `roleId` and
the `+ Shape` / `+ Land` buttons hardcode `model.roles[0].id`, and, it said, nothing anywhere
pushes a second `PatternSlot` onto an existing group's pattern.

**[rev 1] The second gap was stale, and what was there had a bug.** `GroupEditor`'s pattern
strip already carried a `+ slot` button and a per-chip `✕` on 2026-09-21. But `+ slot` derived
the new id from `pattern.length`, so removing the middle of three slots and adding one produced
a duplicate id, and because `reExpand` keys members by `(repeatIndex, slotId)` the duplicate
silently handed one slot's members to the other. That is the exact hazard slice 1's test
obligation below names. Fixed the same day as BUG-030: `addPatternSlot` / `removePatternSlot`
in `modelOps.ts` allocate through `freshId` against every id the model holds (which also closes
a cross-session collision, since the session counter restarts at 0 and a loaded fence carries
ids from earlier sessions), both buttons wrap in `HelpTip`, and the fixture in
`modelOps.test.ts` uses ids in the old panel's own shape so a mutant of the fix goes red.

**The real remaining gap is narrower than "no add-slot".** A slot chip shows its role and offers
no way to change it, and `+ slot` wears `roles[0]` like the other two buttons, so a heterogeneous
pattern is not authorable from the panel even though the model, compiler and expander all
support one. The role picker is the gap, at three sites (`+ Shape`, `+ Land`, the slot chip), and
section 9 puts it in slice 1 because it is useful on its own and because a composite needs a
role picker to be authorable at all. But fixing them does not make the composite authorable, for the reason Sec.4.5 already
identified correctly; a `PatternSlot` spreads its members around the SHARED shape, each taking an
angular share of one circle, while the composite's children travel with one specific member.
Those are different maps.

**The honest form of (b) is that the RESULT is representable and the AUTHORING is not**, which
section 2 establishes and which is why this is not a model-invention problem. Building
`Bulls_Eyes.rms` today means hand-creating `MAX_PLAYER_COUNT × 3` standalone placements, each
individually re-parented, and then editing twenty-four of them every time the cluster radius
changes. It works and it rots.

**The one-shot copy action is the sharpest version of (b)**, and Sec.4.5 recommends it for
fixed-count rings. Rejected as the answer here, kept as the thing this design supersedes; a
one-shot copy produces twenty-four unlinked placements, so the first edit after the copy costs
twenty-four edits again. It removes the tedium once and leaves the maintenance.

### (c) A chain template on the pattern slot

**Taken.** One optional field, one parallel member list, one expansion loop, one merge branch.
Nothing in `frame.ts`, `prologue.ts`, `emitModel.ts`'s guard or owner walks, `paramEmit.ts` or
`landCommand.ts` changes at all, because section 2 is what those modules already do.

It also closes the fixed-count half for free. A template at `perPlayer: false` repeats across the
fixed repeat count, which is Sec.4.5's "a hexagonal ring of player lands, each with two flanking
neutrals" case, currently reachable and not generated. One mechanism, both cases, and the parked
copy action stops being owed.

## 5. The model

```ts
/**
 * One chained child, authored once on a PatternSlot and expanded onto every
 * member that slot produces (Q12). The offset is in the MEMBER's own frame,
 * so `radial` means Sec.4.2's angle ABC measured at that member.
 */
export interface ChainTemplate {
  /** Stable; with (repeatIndex, slotId) this is the merge key. */
  id: string;
  role: string; // LandRole id
  label: string; // the stem of the expanded children's labels
  frame: FrameKind;
  offset: Placement["offset"];
}

export interface PatternSlot {
  // … existing members unchanged …
  /** Absent or empty means this slot's members have no templated children. */
  chain?: ChainTemplate[];
}

export interface ShapeGroup {
  // … existing members unchanged …
  /**
   * Expanded chain children, ordered repeat-major, then pattern order, then
   * template order. Length exactly `repeats × Σ(slot.chain?.length ?? 0)`.
   * Kept SEPARATE from `members` so that `memberKeyAt`'s positional key
   * derivation is untouched.
   */
  chainMembers: string[];
}
```

### 5.1 A second array rather than a longer one, and the pinned invariant is why

`members` is `string[]`, ordered repeat-major then pattern order, and `memberKeyAt(index,
pattern)` derives `(repeatIndex, slotId)` from the position by `index % pattern.length`. Sec.4.5
states that ordering as a model invariant and states, as a deliberate trade, that the key is
derived rather than stored because storing it would be a second copy of a fact the array already
carries.

Flattening chain children into `members` breaks that arithmetic on the first template. Storing an
explicit key array per member would keep it working and would reverse the pinned decision for
every existing member, to serve a case none of them are in.

**A parallel array preserves both.** `chainMemberKeyAt(index, pattern)` is `memberKeyAt`'s
sibling over a three-part key, derived from position in exactly the same way, and `members` is
byte-identical to what it is today for every model with no templates. A model with no template is
indistinguishable from a model written before this feature existed, which is what keeps Sec.10.1's
gate honest.

### 5.2 Expansion, and the one line that makes `Bulls_Eyes.rms` fall out

`expandShapeGroup` gains a second pass after the existing member loop. For repeat `i`, slot `j`,
template `t`;

```
id          = `${group.id}#${i}#${slot.id}#${t.id}`
parent      = the id of the member (i, j) the first pass just built
frame       = t.frame
offset      = t.offset
role        = t.role
repeatIndex = i
```

**`repeatIndex = i`, the member's own repeat index and not a fresh one, is the whole of section
2(d).** `Bulls_Eyes.rms`'s aux zones resolve to 11 and 22 through `ZonePolicy.perRepeat` with base
11 and step 11, with no code that knows anything about chains. Copying the parent's index rather
than inventing a child index is a one-word decision that would be very easy to get wrong in the
other direction, and the corpus map is the thing that says which way.

`expandShapeGroup` stays pure and still has no `NameAllocator`, so the per-player theta
substitution stays where Sec.8.2 of the per-player escalation put it, in the emitter.

**[rev 1] `parent` above is the deterministic id, and the merge pass must replace it with the
member's ACTUAL id.** `reExpand` does two things to member ids that `expandShapeGroup` cannot
see. A brand-new member whose deterministic id is already held by a RELEASED placement still in
the document is renamed through `freshId` (the `5 → 3 → 5` case, reExpand.ts's own comment), and
a matched key always keeps the OLD placement's id, which may itself carry a `_2` suffix from an
earlier rename. So a chain child that kept `parent = "${group.id}#${i}#${slot.id}"` would hang
off the released placement, or off nothing, in exactly the case the merge rule exists for; a
plausible-looking wrong map. Section 9 slice 2 item 4 therefore rewrites every chain child's
`parent` to `nextMembers[k]` for its member (i, j) inside the merge pass, unconditionally, and
the test named there constructs the `5 → 3 → 5` release-then-re-add case with a template on the
slot, since that is the only fixture that can produce the wrong answer.

### 5.3 Depth 1, bounded by the measurement rather than by taste

A template's offset is measured at its slot's member. A template cannot carry templates of its
own.

Justified by section 3.1; the corpus's deepest chain is depth 1 and it is in one map. Deeper
chains stay reachable exactly as they are today, by parenting a standalone `Placement` to an
expanded chain child, and `computeGuardLabels` already carries the guard all the way down.

The condition for revisiting is written here so the next session does not have to re-derive it.
If a real map wants a two-deep template, the key grows a fourth part and `chainMemberKeyAt`
becomes a path rather than a triple. Nothing else in this design changes, which is the property
worth having.

### 5.4 The merge rule, which is the existing rule with a different base

A chain member is an ordinary `Placement`. It carries `nudged`, it is individually editable, it
can be a parent, and Sec.4.5's three rules apply unchanged with one substitution; where a group
member's base offset comes from the group's geometry, a chain member's base offset is
`template.offset`.

- **`nudged` unset** recomputes wholesale from the new template.
- **`nudged` set** re-applies as a delta, `offset' = t_new.offset + (offset - t_old.offset)`,
  derived at transition time and never stored.
- **The symbolic exclusion carries over verbatim.** A nudged chain member whose offset is not
  numeric-literal in every `Expr` is never rewritten and is reported as position-detached.
  `Bulls_Eyes.rms`'s own children are symbolic (`ROTATION_AUX + VAR_A1`), so this is the common
  case here rather than the corner one, which is worth a test naming the map.

**Departure.** A chain member's key leaves when its template is deleted, its slot is deleted, or
`repeats` shrinks. The three release conditions are the ones already written; no `parent` points
at it, `nudged` is unset, and no `create_land` outside the fence references its constants. A
member that fails any of them is released as an ordinary free `Placement` rather than deleted.

**Deleting a slot that has templates releases or deletes the children first**, by the same rules,
and the panel's existing after-the-fact report grows one clause. No confirm dialog, for the reason
Sec.4.5 already gives; nothing that carries user intent is overwritten.

### 5.5 `perPlayer` needs no change at all, and that is the load-bearing claim

`ShapeGroup.perPlayer` stays a flag on the shape. A chain child is guarded because
`computeGuardLabels` walks `parent` and finds a per-player member, which is section 2(a) and is
already how a hand-wired child behaves.

`emitAlpModel`'s existing refusal of `perPlayer` outside `circle` is unaffected, because it reads
`group.kind` and templates do not touch it. The refusal stays the only guard there, exactly as
the shape-kinds slice left it.

**`repeats` stays pinned to `MAX_PLAYER_COUNT` under `perPlayer`**, so a template produces 8
copies whether the game has 8 players or 2. The extra copies are guarded and never emitted as
lands, which is the same harmless over-emission `perPlayer` `RandomParam`s already accept.
`shapeGroupLandTotal` is the one consumer that needs to learn the new arithmetic, since a
per-player composite's upper bound is now `repeats × (pattern.length + Σ chain lengths)`.

## 6. What it costs

The emitted script does not change. That is the headline and it is what makes this a low-risk
feature.

A per-player ring with one player slot and three chain templates, at the maximum count, emits
what the per-player escalation's own table already prices for a `Bulls_Eyes.rms` shape; **32
lands, roughly 416 constants plus 36 prologue lines, and 31 guards**. Hand-wiring the same
cluster emits exactly that, character for character, because the placements are the same
placements.

What moves is the authoring.

|                                  | Things to author | Placements to create by hand | Edits to change the cluster radius | Edits to add a fourth aux land |
| -------------------------------- | ---------------: | ---------------------------: | ---------------------------------: | -----------------------------: |
| Hand-wired today                 |               32 |                       **24** |                             **24** |                          **8** |
| One-shot copy action, option (b) |               32 |                            0 |                             **24** |                          **8** |
| **Chain templates**              |           **11** |                        **0** |                              **1** |                          **1** |

At a fixed-count ring the same table holds with `repeats` in place of the player count, so a
hexagonal ring with two flanking neutrals is 8 things to author rather than 18, and Sec.4.5's
parked copy action is no longer owed.

**Model size.** A template costs one `ChainTemplate` in the fence JSON and one id string in
`chainMembers` per expanded child. Against the hand-wired path the fence holds the same
placements either way, so the saving is in what the USER maintains rather than in bytes.

## 7. The panel

**A slot chip gains a child count and expands.** `GroupEditor`'s pattern strip already renders a
reorderable row of role chips. A chip with templates shows how many, and selecting it opens a
Chain list under the group's own fields; one row per template with a role picker, a frame toggle
and the same offset fields a `Placement` already has, plus add and remove.

**The tree shows expanded children under their member**, indented, since Sec.8 already says
indentation is the chain. Each is an ordinary editable land, and a nudge on one marks it exactly
as a nudged ring member is marked today.

**Editing a template restates every un-nudged copy and says what it did**, using the existing
after-the-fact report strip rather than a dialog, which is Sec.4.5's own rule for re-expansion.

**The role picker ships in the same slice**, because a composite needs it. `addRing` and
`addStandalonePlacement` already take a `roleId` and the buttons hardcode `model.roles[0].id`,
so the fix is a role picker at creation time, and a slot chip gets one for its own role, since
`ShapeGroup.pattern` is already typed as a heterogeneous cycle the compiler and expander both
support and nothing in the panel can yet say so. **[rev 1]** The add-slot control the first draft
listed here already existed; see section 4(b). Not a model change.

Per CLAUDE.md's rule, **every control above wraps in `<HelpTip id="…">` with a matching
`reference/data/ui-help.json` entry as it is built**, `helpCoverage.test.ts` gates it, and the
ids get named in the slice rather than after.

## 8. Independence from Q11, checked rather than assumed

The brief that scoped this session asked whether the composite needs Q11's per-land override for
its children's attribute deviations, and whether the two features therefore want one document.

**It does not, and the corpus is what says so.** `Bulls_Eyes.rms`'s six aux lands wear one role
(`TERRAIN_AUX_TEMP`, `BASE_SIZE_AUX`, `BASE_ELEVATION_AUX`) and are identical on every attribute
except `zone`, which is 11 and 22, which is `ZonePolicy.perRepeat` resolved at the player index
and already built. There is no attribute on which one aux land differs from another.

So the two features are independent and get one document each, matching how Q9 and Q10 were
handled. They meet in two places and neither is a dependency; `ChainTemplate.role` names a
`LandRole` that Q11 makes wider, and a per-land override on an expanded chain child works through
`Placement.roleOverrides` with no extra machinery, because a chain child is an ordinary
`Placement`. Either slice order is safe.

## 9. Slice plan

Two slices, each shippable, each with its own brief. Hand one brief to one session.

### Slice 1, the role picker

Independently useful, prerequisite for authoring a composite, and it changes no types.

**Files.** `panel/LandPlacementPanel.tsx`, `panel/modelOps.ts`, `panel/viewModel.ts`,
`reference/data/ui-help.json`.

1. A role picker on `+ Shape` and `+ Land`, replacing the hardcoded `model.roles[0].id` at both
   call sites. `addRing` and `addStandalonePlacement` already take the argument.
2. **[rev 1]** A role picker on each slot chip in `GroupEditor`'s pattern strip, and on
   `+ slot`, which wears `roles[0]` today. The add and remove controls themselves already
   exist and now route through `addPatternSlot` / `removePatternSlot` (BUG-030); a slot's role
   edit goes through `applyGroupEdit` with the slot mapped, which is what the chip's
   `perimeterShift` input already does one line up.
3. `HelpTip` and a `ui-help.json` entry per new control.

**Test obligations.** **[rev 1]** The first draft's three obligations for the add and remove
controls (a nudged member survives a slot add by the merge rule's delta, asserted on its
resolved position; removing a slot releases rather than deletes a member with a child; the
fresh-id allocation is mutation-tested) were built with BUG-030 and live in `modelOps.test.ts`.
What remains for this slice: changing a slot's role re-expands through `reExpand`, so a nudged
member of that slot keeps its nudge and its new role, asserted on the placement; and the picker
lists every role, not `roles[0]`.

### Slice 2, chain templates

**Files.** `model.ts`, `expand.ts`, `reExpand.ts`, `panel/modelOps.ts`, `panel/viewModel.ts`,
`panel/LandPlacementPanel.tsx`, `fence.ts` only if the serialiser enumerates fields.

1. `ChainTemplate`, `PatternSlot.chain`, `ShapeGroup.chainMembers` (section 5).
2. `chainMemberKeyAt(index, pattern)` beside `memberKeyAt`, deriving the three-part key from
   position. **Do not change `memberKeyAt` and do not lengthen `members`** (section 5.1).
3. `expandShapeGroup`'s second pass, with `repeatIndex` copied from the parent member
   (section 5.2). `ShapeGroupExpansion` gains `chainPlacements` and `chainMembers`.
4. `reExpand`'s second merge pass over the three-part key, reusing `isFullyNumericLiteral`,
   `deltaComponent`, `freshId` and `isReferencedOutsideFence` unchanged (section 5.4), **and
   rewriting every chain child's `parent` to its member's post-merge id** (section 5.2
   [rev 1]). This is not optional and not only for fresh children; a kept member's id can differ
   from the deterministic one.
5. `shapeGroupLandTotal` learns the new upper bound (section 5.5).
6. The panel's Chain list, the tree's indented children and the report clause (section 7).

**Test obligations.**

- **A `Bulls_Eyes.rms`-shaped acceptance case.** One `perPlayer` circle, one slot, three
  templates at `theta` `0`, `-135`, `+135` off a shared `ROTATION_AUX` parameter and three
  `VAR_An` parameters, `r = 14`. Assert 8 members and 24 chain children, that every child carries
  its parent's `ALP_AT_LEAST_k` guard, that the aux zones resolve 11 through 88 under
  `perRepeat` base 11 step 11, and that the emitted `DEGREES` cell for player 1's first child is
  the shape Sec.4.2 derives.
- **Guard inheritance is `computeGuardLabels`'s existing walk**, so assert it rather than
  reimplementing it, and mutation-test by breaking the parent link on one child.
- **The symbolic nudge exclusion**, named for this map, because a `Bulls_Eyes.rms` child's offset
  is symbolic and so the common case here is the one Sec.4.5's merge rule excludes from rewriting
  (section 5.4).
- **A fixed-count group with templates**, confirming one mechanism serves both cases and that no
  prologue is emitted.
- **[rev 1] The `5 → 3 → 5` case with a template on the slot.** Shrink `repeats` so two members
  are released (give them a child each so they cannot be deleted), grow it back, and assert that
  the two re-added members' chain children hang off the RENAMED fresh members and not off the
  released placements that still hold the deterministic ids. Mutation-test by skipping the
  parent rewrite; the fixture is built to go red on exactly that.
- **A model with no templates is byte-identical**, which is the regression gate for the whole
  slice.
- **Sec.10.1's acceptance gate stays byte-identical**, unedited.

### What does not move

`frame.ts`, `prologue.ts`, `paramEmit.ts`, `landCommand.ts`, `compiler/` and
`emitModel.ts`'s guard and owner walks. If a slice finds itself editing one of those, the design
is wrong somewhere and that is worth stopping over, because section 2's entire argument is that
those five already do this job.

## 10. Resolved

1. ~~Is this (a) a new capability, (b) already expressible, or (c) a targeted addition?~~
   **(c).** Every emit-side mechanism exists and is generic over depth (section 2); what is
   missing is authoring and maintenance (section 4).
2. ~~Can a `PatternSlot`'s member already BE a whole sub-chain?~~ **No, and it should not
   become one.** A slot spreads its members around the shared shape, which is a different map
   (section 4(b)). The chain hangs off one member, and it hangs off it through
   `Placement.parent`, which already exists.
3. ~~Does `perPlayer` need to move onto a composite?~~ **No.** It stays a `ShapeGroup` flag;
   children are guarded by walking `parent`, which `computeGuardLabels` already does
   (section 5.5).
4. ~~Should the two panel gaps ship first?~~ **Yes, as slice 1, and [rev 1] there is one gap,
   not two.** The add-slot control already existed (with a bug, fixed as BUG-030); the role
   picker is the gap, at three sites. Useful on its own, changes no types, and a composite is
   not authorable without it (section 9).
5. ~~Is a one-shot "copy this chain onto every member" action the answer?~~ **No, and this
   supersedes it.** It removes the tedium once and leaves twenty-four unlinked placements to
   maintain (section 4(b)). Sec.4.5's recommendation of it for fixed-count rings is discharged by
   templates working at `perPlayer: false`.
6. ~~Do chain children flatten into `members`?~~ **No.** It breaks `memberKeyAt`'s positional key,
   which Sec.4.5 pins as a model invariant, for every existing member (section 5.1).
7. ~~How deep do templates go?~~ **One.** The corpus's deepest chain is depth 1 in one map
   (section 3.1), deeper stays reachable by hand, and the condition for revisiting is written down
   (section 5.3).
8. ~~Does this depend on Q11's per-land override?~~ **No.** `Bulls_Eyes.rms`'s six aux lands wear
   one role and differ only on `zone`, which `perRepeat` already resolves (section 8).

## 11. Still open

**Nothing blocking, and nothing in slice 1.**

One want recorded rather than designed. **A per-player arc.** Section 5.5 leaves
`emitAlpModel`'s `perPlayer`-outside-`circle` refusal exactly as the shape-kinds slice left it,
and that refusal is now the only guard for a perimeter kind. A composite hanging off an arc
member would work the moment the refusal lifts, since nothing in this design reads `group.kind`,
so the two are independent and the arc question stays where the shape-kinds escalation parked it.

One judgement call left to slice 2, with the panel in front of it. **Whether an expanded chain
child is selectable on the canvas by default.** Eight members with three children each is 32
hit targets where there were 8, and the canvas's handle-before-circle precedence was tuned for
the smaller number. Decide it against a real cluster rather than now.
