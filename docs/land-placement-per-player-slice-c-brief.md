# Land Placement, per-player slice C brief: per-count rules and the jitter helper

**This is a work brief for one session, not a design document.** The design is
`docs/land-placement-per-player-escalation.md` (rev 5), sections 5.2, 5.3 and 8.3.

**Slices A and B must be built and green before this starts.**

This slice covers the two things the earlier slices deliberately left: an angle rule that differs
by player count, and a control that turns "keep the players at least this far apart" into bounds
the emission can actually guarantee.

---

## 0. Read before writing code

1. `CLAUDE.md` in full.
2. `docs/land-placement-per-player-escalation.md` **sections 5.2, 5.3, 8.3 and 11**.
3. The slice A and B briefs, so you do not rebuild their items.

## 1. What to build, in order

### Item 1: `Placement.thetaPerCount`

```ts
/** Angle at a specific player count, overriding `offset` there. Only consulted inside a perPlayer group. */
thetaPerCount?: Record<number, Expr>;
```

**On the `Placement`, not the `PatternSlot`.** "P2 is 30 degrees from P1 at 2 players" is about
one member, and a slot repeats across all of them. Members are already ordinary individually
editable Placements carrying `nudged`, so this rides machinery that exists and is tested.

Theta only. Per-count radius is a plausible later want and is not asked for; do not add it
speculatively.

Emission is a small change to slice A's prologue: branch *n* uses `thetaPerCount[n]` where the
member has one, then the member's own theta from slice B, then the even default. Three levels,
first match wins, and the fallback order should be a named function with its own test rather than
a chain of `??` at the emit site.

### Item 2: the panel surface, which is this feature's one open judgement call

**The design deliberately does not decide this**, per section 11: it is the first field in this
tool whose value depends on a setting outside it, and it wanted the panel in front of a person
before being fixed.

The constraint is that a member's angle now has up to eight values and the panel shows one field.
Whatever you choose, it must be obvious at a glance that a per-count override exists for a count
you are not currently previewing, because an invisible override is a trap. Decide it, write down
the reasoning in the build log, and wrap the control in `HelpTip` with a `ui-help.json` entry.

### Item 3: the bounded jitter control

The one separation guarantee the emission can actually keep.

Player *k* at `even_k + rnd(-j, +j)` keeps every gap at or above `360/n - 2j`. **The tool knows
*n* inside each branch**, so for a requested minimum separation it can compute the largest safe
*j* per count, and clamp or warn where the author asks for more than the count allows.

That calculation is pure and belongs in its own module with its own tests, beside `snapping.ts`.
Give it the count, the requested minimum separation, and the pattern length; get back the safe
jitter or a reason it is impossible. At 8 players an even gap is 45 degrees, so a requested
minimum of 40 leaves 2.5 degrees of jitter, and a requested minimum of 50 is impossible and must
say so rather than silently clamping to zero.

### Item 4: say what cannot be guaranteed

Free bearings can collide. Three players each given an independent `rnd` bearing can land on top
of each other, and nothing in the emission prevents it.

**The panel must say so where the rule is authored**, in the same spirit as the existing drag
refusal messages, rather than implying a guarantee the emission cannot keep. This is one sentence
of UI text and it is the difference between a tool that is honest about its limits and one that
is not. Follow CLAUDE.md's language rules when writing it.

## 2. Acceptance

- Sec.10.1's Bulls_Eyes gate still byte-identical.
- A member with `thetaPerCount[2]` emits that rule in the 2 player branch and its default
  elsewhere.
- The fallback order (per-count, then member theta, then even) has its own test at all three
  levels.
- The jitter calculation returns the right bound at every count from 1 to 8, and refuses an
  impossible request rather than clamping it to zero.
- A per-count override is visible in the panel when previewing a different count.

## 3. Hazards

1. **A silent override.** Item 2. An override you cannot see at the current count is worse than
   not having the feature.
2. **Clamping an impossible separation to zero.** Item 3. Refuse and say why.
3. **Implying a collision guarantee.** Item 4.
4. **Adding per-count radius while you are in there.** Not asked for.

## 4. Verification

`npm run typecheck`, `npm run lint`, `npm run validate:reference`, full `npm test`. Update
CLAUDE.md's test count row if a test file lands. Append a `docs/build-log.md` entry recording
item 2's decision and its reasoning.

**Mutation-test the jitter bound**, since it is a calculation whose wrong answers are all
plausible-looking numbers. Restore from a byte copy.

Run sheet for `npm run tauri dev`: set a per-count rule at 2 players, switch the player count
between 2 and 6 and confirm the canvas and the field both follow, request an impossible minimum
separation and confirm the refusal, Apply and read the fence.
