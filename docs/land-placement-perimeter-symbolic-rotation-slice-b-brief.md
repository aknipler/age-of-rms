# Land Placement, perimeter slice B brief: per-member position along the perimeter

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-perimeter-symbolic-rotation-escalation.md` **Sec.8.5** (with Sec.5 as the
question it answers). Read this file for _what to build and in what order_; read the escalation for
_why_, and treat the escalation and `docs/land-placement-design.md` as authoritative wherever they and
this file disagree.

**Slice A must be built before this one**, for a reason worth stating rather than assuming. B is
buildable against the cartesian representation too, and would work — the shift is a term inside
`delta`, which is upstream of both representations. What A buys is _legibility_: under the polar
representation a shifted member's changed distance from the anchor is its own emitted radius, so the
thing Sec.5 called the design's hard subtlety (moving along a flat side moves you closer to the
centre) is visible in the panel instead of hidden inside a coefficient pair. Building B first would
mean shipping a feature whose main surprise the tool cannot show the user.

**This slice is small.** One optional model field, one term inside an existing expression, one panel
input, and the tests that pin how it composes with the two things already on a slot. Expect to write
more tests than code, and do not manufacture work to fill the gap.

---

## 0. Read before writing code, in this order

1. `CLAUDE.md` in full, especially Hard rules, Teaching mode, and the `HelpTip` rule (every new
   interactive element wraps in one, with a matching `reference/data/ui-help.json` entry, as it is
   built).
2. `docs/land-placement-perimeter-symbolic-rotation-escalation.md` **Sec.5 then Sec.8.5**. Sec.5 is
   the fork; Sec.8.5 is which arm was taken and what was rejected. Sec.8.8's first bullet is the
   gesture this slice deliberately does not build.
3. `src/tools/builtin/landPlacement/model.ts`, `PatternSlot` and `ShapeGroup.sweep`. `sweep` is the
   precedent for a plain `number` on a group and its doc comment carries the reason, which is the
   same reason here.
4. `src/tools/builtin/landPlacement/perimeterOffset.ts` after slice A, and `expand.ts`'s
   `perimeterKindOffset`. One line of each changes.
5. `src/tools/builtin/landPlacement/panel/LandPlacementPanel.tsx`, `GroupEditor` — specifically the
   pattern chips near the end of it. Today a chip is a role label and a delete button; the slots have
   never had a numeric surface of any kind.

## 1. What to build, in order

### Item 1: the model field

```ts
/**
 * Percent of one lap around the perimeter, ADDED to this slot's even position.
 * `square`/`triangle`/`polygon` only; ignored by every other kind, like `sweep`.
 * Signed, wraps, absent means 0.
 */
perimeterShift?: number;
```

on `PatternSlot`, beside `theta` and `radius`.

**A plain `number`, not an `Expr`, and the doc comment must say why** — `sweep`'s own wording is the
template. The value is consumed at expansion time to bake a radius scale and a bearing, both of which
are discontinuous in the fraction (the side index is a `floor` of it), so a value the tool cannot see
until the engine runs has no radius scale and no bearing at all. The type is what makes that
unrepresentable rather than a refusal (escalation Sec.8.7, finding 1).

**A delta, not a replacement, and the doc comment must say that too**, because it diverges from
`slot.theta` one field above it. `slot.theta` replaces the even angular term, which stacks every
repeat of a slot at one bearing and is only usable at `repeats: 1`. A delta nudges the slot's members
along the shape and works at every repeat count. Write the divergence down where a reader meets it,
or it reads as an inconsistency someone will later "fix".

### Item 2: expansion

`perimeterPolar` gains one optional parameter, defaulting to 0, and one term:

```ts
export function perimeterPolar(sides: number, memberCount: number, memberIndex: number, shiftPercent = 0): PerimeterPolar
...
delta = m / N + 1 / (2M) + shiftPercent / 100
```

Everything downstream is unchanged. The existing wrap already handles a negative or greater-than-one
`delta` correctly — `k = ((floor(scaled) % M) + M) % M` and `f = scaled - floor(scaled)` are both
correct for negative input, which was checked during the design session and must now be pinned by a
test rather than left as a happy accident.

`expand.ts` passes `slot.perimeterShift ?? 0`. That is the whole change to that file.

### Item 3: the panel

Each pattern chip in `GroupEditor` gains a shift input **when the group's kind is a perimeter kind**,
hidden for circle, line and arc exactly as the Sweep and Sides fields already hide themselves. It
edits `pattern`, so it goes through the existing `edit({ pattern: nextPattern })` path and
`applyGroupEdit` needs no signature change (`pattern` is already in its patch type).

Requirements, in order of how easy they are to get wrong:

- **Per slot, and unambiguously so.** A row of anonymous number boxes under the chips would not say
  which slot each belongs to. Keep the input inside its own chip, or give each row the role label.
- **`HelpTip` around it, with a `landPlacement.perimeterShift` entry in
  `reference/data/ui-help.json`**, then `npm run validate:reference`. The help text has one job
  beyond naming the unit, and it is Sec.5's subtlety: say that a polygon's corners are further from
  the centre than its edges, so sliding a land along the shape changes how far out it sits. Plain
  words, no punctuation heavier than a comma, matching the tone of the `landPlacement.shapeSides`
  entry.
- **A plain number input, signed, no clamp.** Unlike `sides` there is no invalid value here: 250 is
  two and a half laps and lands somewhere real. Clamping would be inventing a rule the geometry does
  not have.
- The existing chip delete button and `+ slot` button keep working unchanged.

### Item 4: tests

- **Even spacing is untouched when no shift is set.** The default path must be byte-identical to
  slice A's. Assert it directly rather than trusting that `?? 0` did nothing.
- **A shift moves the member along the perimeter**, and specifically: check both components. A member
  shifted off a side's midpoint has a LARGER `radiusScale` and a different bearing. A test that only
  checks the bearing would pass under an implementation that forgot the radius, which is the whole
  subtlety of this slice.
- **Wrap**: negative shifts, shifts over 100, and a shift of exactly 100 returning a member to where
  it started (same `radiusScale`, bearing differing by a whole number of laps).
- **Composition with `slot.radius`** (escalation Sec.8.5's radius rule): the shift chooses the point
  on the unit-circumradius polygon, the radius scales it, and the two are independent. Pin it with a
  member carrying both.
- **Composition with a symbolic rotation** (slice A's feature): a shifted member of a group whose
  rotation is `sym("ROT")` still has `theta = bin("+", sym("ROT"), num(k))` with a shifted `k`.
  Rotation spins the shape, shift moves along it, and neither reads the other.
- **`reExpand`**: changing a slot's shift is a group edit, so a NON-nudged member follows it and a
  NUDGED member takes the polar delta path and keeps its own offset. Two tests, one each.
- **The field is inert for circle, line and arc.** Set `perimeterShift` on a circle group's slot and
  assert the expansion is unchanged, the same way `sweep` is inert outside `arc`.

### Item 5: docs

- `docs/land-placement-design.md` **Sec.4.5**: the field, its unit, the delta-versus-replacement
  divergence from `slot.theta`, and the radius composition rule.
- `docs/build-log.md`: the usual entry.
- `docs/manual-test-run-sheet.md`: one step — set a shift on one slot of a square, confirm the land
  moves along the shape and its distance from the centre changes with it.

## 2. Acceptance

- A slot with no `perimeterShift` expands exactly as it did after slice A.
- A slot with one moves its members along the perimeter, changing both their bearing and their radius,
  at every repeat count and for all three perimeter kinds.
- Negative shifts, shifts past a full lap, and a full-lap shift all behave as stated above.
- `perimeterShift` composes with `slot.radius` and with a symbolic group rotation, each pinned by its
  own test.
- The panel exposes it per slot, only for perimeter kinds, wrapped in a `HelpTip` with a matching
  `ui-help.json` entry.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run validate:reference` all green.

## 3. Hazards

1. **Checking the bearing and forgetting the radius.** The one mistake that makes this feature look
   right and be wrong: a shifted member that keeps its old radius has left the polygon and is
   floating beside it. Every position assertion in item 4 checks both components.
2. **Reading the shift as an absolute position.** It is added to the even walk. A test that sets a
   shift on the only slot of a one-member group cannot tell the two readings apart — use a group with
   at least two slots and more than one repeat, so a replacement implementation would visibly stack
   members.
3. **Clamping.** There is no invalid shift. If you find yourself writing a `Math.max`, re-read item 3.
4. **Assuming a shift is safe.** Nothing here guarantees two lands stay apart, and a large enough
   shift walks one member past its neighbour. That is the author's business, the same way an authored
   angle is for a circle, and the panel says so in the same voice the per-count angle editor already
   uses. Do not add a refusal.
5. **Changing `slot.theta`'s behaviour in passing.** It stays unread for perimeter kinds and keeps
   replacing the even term for circle, line and arc. This slice adds a field; it does not reform an
   old one.

## 4. Verification

The composition tests are the verification: this slice has no new geometry of its own, only one term
inside a function slice A already pinned against real trigonometry. If a shift's position is wrong,
it is wrong in `delta`, and the wrap tests are what find it.

## 5. What is left after this

Nothing in the escalation. Both asks are then built, and its Sec.8.8 lists what was deliberately
parked with a reason each: dragging a member along the perimeter on the canvas, a bounded random
jitter in perimeter-fraction terms, a `formula`-kind escape for a genuinely symbolic perimeter
position, and `perPlayer` for non-circle kinds.
