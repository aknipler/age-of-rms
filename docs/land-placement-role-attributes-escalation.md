# Land Placement design: full `create_land` attribute coverage on `LandRole`, and a per-land override

**Status: BUILT, all three slices, 2026-09-22.** Model, emit, panel and tests as sliced in
section 10, plus the rev 1 corrections. Tauri run sheet: `docs/manual-test-run-sheet.md`
section 12. The one deliberate gap: an override cannot set an optional attribute to
"not written" when the role writes it (`Partial<>` has no way to say absent-on-purpose);
recorded in section 12. Originally: design, ready to implement, sliced in section 10. Raised as a one-line want on
2026-09-03 against `docs/land-placement-design.md` Sec.4.5 ("Future want: every `create_land`
attribute on a Role, override-able per land"), designed here 2026-09-21. This is the first
session to touch it, so nothing below supersedes an earlier revision. Reviewed the same day
against the tree and the corpus; the corrections are marked **[rev 1]** in place, and the largest
of them is section 10 slice 1 item 4, which the review found to rest on a premise that had
already expired.

The ask has two halves. Every `create_land` attribute should be authorable from a `LandRole`,
the way `terrain_type`, `base_size`, `base_elevation` and `land_percent` already are. And each
of those should be override-able on one individual land without duplicating the role or
hand-editing the emitted fence.

---

## 1. Four things Sec.4.5's own want paragraph got wrong, and they decide the scope

Sec.4.5's paragraph was written from memory of the guide rather than from
`reference/data/language.json`, which is this project's own source of truth for what exists.
Every figure in it moves on re-derivation, and two of the four moves change what gets built.

**(a) `create_land` carries 24 attributes, not 23.** `language.json`'s `create_land` entry lists
24 names, identical to `create_player_lands`'. The paragraph's own enumeration of what is
missing has 13 entries while the sentence after it says "all 12 missing attributes". The list is
right and both numbers are wrong.

**(b) The covered set is 6, not the 9 the paragraph implies.** It counts `set_zone_by_team`,
`set_zone_randomly` and `assign_to_player` as covered by `ZonePolicy` and `assignToPlayer`.
`ZonePolicy` is `none | fixed | perRepeat`, which has no variant meaning either zone flag, and
`assignToPlayer: true` emits `assign_to`, never `assign_to_player`. Those three are uncovered,
which moves them from "already handled" into the work.

**(c) `circle_radius` IS a `create_land` attribute.** It is in `language.json`'s list and
guide:858 says so in its own words, that using it for `create_land` still applies it to player
lands normally. It is still scoped out of this design, for a different and stronger reason
(section 3).

**(d) The `Expr`-versus-plain-number question resolves the opposite way from the guess.** The
paragraph reasons that `border_fuzziness` and `clumping_factor` "look closer to `sweep`'s
plain-`number` precedent". They are not. `sweep` and `perimeterShift` are plain numbers because
the tool CONSUMES them at expansion time to bake a radius scale and an integer bearing, so a
value it cannot see would leave the member with no geometry at all (model.ts's own doc comment
on `perimeterShift` states this as the reason). The tool consumes none of the thirteen
attributes below. Every one of them passes straight through into the `create_land` as a
reference and is read by the engine. **The test is whether the tool needs the value, and for all
thirteen it does not, so all thirteen are `Expr`.** Section 4.3 states the rule so the next
reader does not re-derive it from the wrong precedent.

One defect fell out of the same cross-check and is section 9.

## 2. The accounting, all 24 attributes

Measured against `language.json` and `reference-docs/definitive-rms-guide-2026-07-16.txt`
lines 706 to 1166, 2026-09-21.

| Attribute                       | Verdict                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| `terrain_type`                  | Covered (`LandRole.terrain`)                                                       |
| `land_percent`                  | Covered (`LandRole.landPercent`), reshaped by section 4.1                          |
| `base_size`                     | Covered (`LandRole.baseSize`)                                                      |
| `base_elevation`                | Covered (`LandRole.baseElevation`), gains a precondition (section 8)               |
| `zone`                          | Covered (`ZonePolicy`)                                                             |
| `assign_to`                     | Covered in part (`assignToPlayer`), reshaped by section 4.2 and fixed by section 9 |
| `land_position`                 | **Non-goal**, section 3                                                            |
| `circle_radius`                 | **Non-goal**, section 3                                                            |
| `generate_mode`                 | **Non-goal**, section 3                                                            |
| `min_placement_distance`        | **Non-goal**, section 3                                                            |
| `set_zone_by_team`              | **Refused**, section 3                                                             |
| `number_of_tiles`               | Build, tier 1                                                                      |
| `land_id`                       | Build, tier 1                                                                      |
| `left_border`                   | Build, tier 1                                                                      |
| `right_border`                  | Build, tier 1                                                                      |
| `top_border`                    | Build, tier 1                                                                      |
| `bottom_border`                 | Build, tier 1                                                                      |
| `clumping_factor`               | Build, tier 1                                                                      |
| `other_zone_avoidance_distance` | Build, tier 1                                                                      |
| `border_fuzziness`              | Build, tier 1                                                                      |
| `set_circular_base`             | Build, tier 2                                                                      |
| `set_zone_randomly`             | Build, tier 2                                                                      |
| `land_conformity`               | Build, tier 2                                                                      |
| `assign_to_player`              | Build, tier 2                                                                      |

6 covered, 4 non-goals, 1 refused, 13 to build. The tiers come from section 2.1's measurement
rather than from a judgement about which attributes feel important.

### 2.1 The corpus, counted on the population this tool actually writes into

Sec.4.5's want paragraph asks whether `border_fuzziness`, `clumping_factor` and
`land_conformity` are "common or rare in practice". They are not alike, and neither is what an
unscoped count says. Raw use counts across this corpus are dominated by a handful of generated
maps (one map holds 56% of every `clumping_factor` use, another holds 70% of every `assign_to`
use), so the count per map is the independence-robust reading, and the population that matters
is **`create_land` / `create_player_lands` blocks that carry a `land_position`**, because every
land this tool emits carries one (Sec.6.2).

Measured over 58 `.rms` files on disk, 52 of which have a `<LAND_GENERATION>` section, 10,408
land blocks parsed, 45 maps using `land_position`.

| Attribute                       | blocks with `land_position` | maps | blocks without | maps |
| ------------------------------- | --------------------------: | ---: | -------------: | ---: |
| `land_id`                       |                        2615 |   33 |             32 |    6 |
| `number_of_tiles`               |                        9700 |   29 |             24 |   13 |
| `bottom_border`                 |                         289 |   25 |            102 |   16 |
| `left_border`                   |                         366 |   25 |             97 |   15 |
| `top_border`                    |                         299 |   25 |             96 |   15 |
| `right_border`                  |                         284 |   24 |            102 |   16 |
| `clumping_factor`               |                        3006 |   20 |             78 |   18 |
| `other_zone_avoidance_distance` |                        4639 |   19 |             65 |   17 |
| `border_fuzziness`              |                         279 |   18 |             86 |   12 |
| `set_circular_base`             |                          19 |    5 |             25 |    4 |
| `land_conformity`               |                          17 |    1 |             10 |    2 |
| `min_placement_distance`        |                           1 |    1 |             28 |    6 |
| `generate_mode`                 |                           0 |    0 |             16 |    2 |
| `circle_radius`                 |                           0 |    0 |             37 |   27 |
| `set_zone_randomly`             |                           0 |    0 |              0 |    0 |
| `set_zone_by_team`              |                           0 |    0 |              0 |    0 |

Reproduce with the reporter section 10 asks for. Four readings come out of it, and the third is
the one that was expected to be boring.

**Tier 1 is the top nine rows**, 18 maps and up. Each is a construct a fifth of the corpus
reaches for on exactly the kind of land this tool writes.

**Tier 2 is `set_circular_base`, `land_conformity`, `set_zone_randomly` and
`assign_to_player`**, and none of the four is tiered by its count alone. `set_circular_base` is
on 5 maps and on **9 of `Bulls_Eyes.rms`'s 10 lands**, which is the map Sec.10.1 names as this
tool's acceptance bar, so the tool cannot write the shape of its own reference map today.
`land_conformity` is on 1 map with a positioned land and the guide says outright that it is
buggy and advises against it, which would put it last, except that guide:789 prescribes
`land_conformity 99` as the fix for a named `set_circular_base` bug, and that bug bites
precisely when `set_circular_base` meets `base_elevation`, which is the combination this tool
emits by default. `set_zone_randomly` is 0 uses and is one flag on a union that already exists.
`assign_to_player` is the mutex partner of an attribute already covered.

**`min_placement_distance`, `generate_mode` and `circle_radius` separate cleanly, in the same
direction, on one axis.** 28 of 29, 16 of 16 and 37 of 37 of their uses sit on a land with no
`land_position`. Section 3 is what that means.

**Borders do not, and that is the reading worth having taken.** The natural guess is that a
border patterns like `min_placement_distance`, since a positioned land ignores borders when it
is placed. Measured, all four borders run roughly three to one the OTHER way, 24 to 25 maps
with a positioned land against 15 to 16 without. The guide says why at line 826, that a land
placed outside its borders "will not grow beyond its base_size". Placement ignores borders and
GROWTH does not, so borders are a live attribute on exactly the lands this tool writes, and a
count run without the split would have hidden that under one number.

## 3. The four non-goals, and the one refusal

**One fact scopes out three of the four, so it is stated once.** Every `create_land` this tool
emits carries an explicit `land_position` (Sec.6.2's skeleton, `buildLandAttachmentExpectations`
in `landCommand.ts`). Three attributes are defined by the guide as governing the case where a
land has no `land_position`, so all three are inert in this tool's own output.

- **`min_placement_distance`.** guide:1119, "No effect when `land_position` is specified."
  Corpus 28 of 29 blocks carry no `land_position`. The one exception is a dead line in a shipped
  map, which is this repo's own "a shipped map is not a specification" rule arriving on a single
  row rather than on a frequency.
- **`generate_mode`.** guide:819, a land without `land_position` gets a random origin in a
  cross-shaped area "unless `generate_mode` is set to 1". A positioned land has no random origin
  for the mode to govern. Corpus 16 of 16 blocks carry no `land_position`.
- **`circle_radius`.** It parameterises the circular ring that player lands are laid out on, and
  guide:698/979/1016 all say that ring is what `direct_placement` turns off. `direct_placement`
  is this tool's own P3 precondition (Sec.6.3), because without it every `land_position` on a
  player land is ignored. So the tool can only operate on scripts where `circle_radius` has
  nothing left to position. Corpus 37 of 37 blocks carry no `land_position`.

**`land_position` itself** is the fourth, and it is the one Sec.4.5 already named. It is what
Sec.4.2's frame and chain algebra computes. A role-level `land_position` would put every land
wearing that role on one tile, which is not a role attribute in any useful sense; and a
placement-level one is the `formula` offset kind, which already exists.

**`set_zone_by_team` is refused rather than scoped out**, because the distinction matters for
whether a later session should revisit it. It is not inert. guide:1055 says that on a
`create_land` it assigns the zone of **player 1's team**, whoever the land actually belongs to,
and the guide adds "(This is not recommended!)" in its own words. `create_land` is the only
command this tool emits. Offering an attribute whose documented behaviour on the only command in
reach is to silently ignore ownership would be building a footgun with a label on it.

**The condition under which all four come back is one sentence, so it is written down.** If this
tool ever emits a land with no `land_position`, `min_placement_distance` and `generate_mode`
become live for it immediately. That land exists in the corpus: `Bulls_Eyes.rms`'s tenth
`create_land` is an unpositioned filler at `land_percent 100` whose only shape control is
`min_placement_distance 33`. The tool cannot express it today and this design does not change
that. Recorded in section 11 as a want rather than designed here, because an unpositioned land
has no offset, no frame and no canvas position, which is a model question rather than an
attribute question.

## 4. The extended `LandRole`

```ts
export interface LandRole {
  id: string;
  label: string;

  // --- covered today, unchanged ---
  terrain: Ref;
  baseSize: Expr;
  baseElevation: Expr;

  // --- reshaped: two mutex groups become unions (4.1, 4.2) ---
  extent: LandExtent;
  assign: AssignPolicy;
  zone: ZonePolicy; // gains one variant, 4.3

  // --- new, tier 1 (2.1) ---
  landId?: Expr;
  leftBorder?: Expr; // four fields, not one record; 4.5 [rev 1]
  rightBorder?: Expr;
  topBorder?: Expr;
  bottomBorder?: Expr;
  borderFuzziness?: Expr;
  clumpingFactor?: Expr;
  otherZoneAvoidanceDistance?: Expr;

  // --- new, tier 2 (2.1) ---
  circularBase?: boolean;
  landConformity?: Expr;
}

/** `land_percent` and `number_of_tiles` are mutexWith partners in language.json. */
export type LandExtent =
  { kind: "percent"; value: Expr } | { kind: "tiles"; value: Expr };

/** `assign_to_player` and `assign_to` are mutexWith partners in language.json. */
export type AssignPolicy =
  | { kind: "none" }
  | { kind: "player"; number: PlayerSlot }
  | {
      kind: "assignTo";
      target: "AT_PLAYER" | "AT_COLOR" | "AT_TEAM";
      number: PlayerSlot;
      mode: -1 | 0;
      flags: 0 | 1 | 2 | 3;
    };

/** A per-instance number, the shape `ZonePolicy.perRepeat` already has; the `fixed` arm is an `Expr`, 4.2 [rev 1]. */
export type PlayerSlot =
  | { kind: "fixed"; value: Expr }
  | { kind: "perRepeat"; base: number; step: number };

export type ZonePolicy =
  | { kind: "none" }
  | { kind: "fixed"; zone: number }
  | { kind: "perRepeat"; base: number; step: number }
  | { kind: "random" }; // set_zone_randomly, new
```

Each border absent means the attribute is not written at all, which is not the same as 0.

### 4.1 Three mutex groups, three unions, and the repo already made this decision once

`language.json` records exactly three mutex groups inside `create_land`, machine-readably, on
the `mutexWith` field; `land_percent` against `number_of_tiles`, `assign_to_player` against
`assign_to`, and `zone` against `set_zone_by_team` against `set_zone_randomly`.

That field is not decoration. `validate.ts:1207` reads it and raises **RMS0307** on a co-occurring
pair, and `scripts/validate-reference-data.mjs` gates its referential integrity. So a `LandRole`
carrying a separate `landPercent` and `numberOfTiles` field could emit a `create_land` that the
app's own parser then flags, on the app's own output.

**The fix is a type, not a check.** `ZonePolicy` is already a union and the zone mutex is already
unrepresentable because of it, which is the whole precedent. `LandExtent` and `AssignPolicy`
generalise the move the model already made rather than inventing one. This is the same shape as
Sec.5.0's `Expr` having no `rnd` arm, and Sec.6.1's fence payload being structurally incapable of
carrying a bare word; make the hazard unrepresentable rather than validated.

Recorded as a corpus fact worth knowing, since it shows the mutex is real and authors do trip
it: **11 blocks across 2 maps carry both `land_percent` and `number_of_tiles`**. No block
anywhere in the corpus carries two zone attributes.

### 4.2 `assignToPlayer: boolean` was a simplification of `assign_to`, and it covers the rarest target

The current field's doc comment says `true → assign_to AT_PLAYER <repeat index>`, and that is
what it does. It is not a simplification of `assign_to_player`, which the tool cannot emit at all.

Measured over the corpus, every `assign_to` use is four arguments and `AT_PLAYER` is the target
authors reach for least. **[built]** `roleAttributes.measure.test.ts` states the predicate
(attribute nodes inside land blocks, branches included, rms-check excluded) and prints
`AT_COLOR` 3270, `AT_TEAM` 3232, `AT_PLAYER` 17 over 6519 nodes, 71% of them in one map.
**[rev 1]** The first draft printed `AT_TEAM` 257, `AT_COLOR` 70,
`AT_PLAYER` 21 here, a population the review could not reproduce by either a block-level or a
token-level count (token-level over the same 58 files: `AT_TEAM` 3306, `AT_COLOR` 3296,
`AT_PLAYER` 19, of which `AK_Vanguard_v1.2.rms` alone holds 4608, the 70% section 2.1 already
quotes). The ranking of `AT_PLAYER` last is stable across every method; the other two figures
are not, and section 10 slice 2's reporter is where they get a stated predicate. So the one
target the model can express is the one authors reach for least. `AT_TEAM` in particular is the natural spelling for the per-team want
Sec.4.5 already records as undesigned, so covering the full `assign_to` here is groundwork for
that rather than breadth for its own sake.

`PlayerSlot` exists so `number` can be per-instance. `{ kind: "perRepeat", base: 1, step: 1 }`
against `AT_PLAYER` is exactly today's `assignToPlayer: true`, so the migration is mechanical and
the per-player ring keeps working unchanged (its guard comes from `prologue.ts`, which reads a
member's repeat index, never this field).

`mode` and `flags` are typed as their literal domains rather than as `number`, because
`language.json` declares `mode` as -1 to 0 and `flags` as 0 to 3 and the panel offers a picker
either way. They are not `Expr` under section 4.3's rule, because they are not a quantity the
script computes; the corpus writes `0 0` on every single use.

**[rev 1] `PlayerSlot`'s `fixed` arm is an `Expr`, emitted as a role constant, not a `number`
emitted as a literal.** The first draft typed it `{ kind: "fixed"; value: number }` and let it
ride the per-repeat literal path. Two of this document's own rules say otherwise, and the corpus
has the counterexample. Under section 4.3 the tool never consumes a fixed slot number, so it is an
`Expr`. Under Sec.6.2's ownership split a literal is licensed only for a PER-REPEAT value, and a
fixed slot does not vary per repeat, so it is a reference to a `#const`, exactly the shape
`fixedZoneName` already gives a `ZonePolicy.fixed` zone. And `CoastalForest.rms:1009` writes
`assign_to AT_COLOR L1_COLOUR 0 0`, a `#const` reference in the number slot, which a plain
`number` could not round-trip. So:

```ts
export type PlayerSlot =
  | { kind: "fixed"; value: Expr } // emitted as its own role constant, like fixedZoneName
  | { kind: "perRepeat"; base: number; step: number }; // the per-repeat literal exception
```

`RoleConstNames` gains `fixedAssignNumberName?`, present only for a `fixed` slot, mirroring
`fixedZoneName`. The `perRepeat` arm keeps `number`s because the tool DOES consume them, to bake
`base + step × repeatIndex` at emit time.

### 4.3 The `Expr` rule, stated once so it is not re-derived

**A `create_land` attribute's value is an `Expr` when the tool never needs to read it, and a
plain typed value when the tool consumes it to decide something.** The thirteen new attributes
are all the first case; they are written into the `create_land` as a reference to a `#const` and
the engine reads them.

The second case is `ShapeGroup.sweep`, `ShapeGroup.sides`, `PatternSlot.perimeterShift` and
`ShapeGroup.repeats`, every one of which the expander turns into baked geometry. `AssignPolicy`'s
discriminant, `mode`, `flags` and the three booleans are the second case too, for the weaker
reason that they are a choice rather than a quantity.

`Expr` is free here. `roleEmit.ts` already routes every `Expr` field through `emitCells`, so a
role attribute that needs hoisting (a formula, a `RandomParam` reference, a symbol the script
already defines) gets it with no new code.

### 4.4 A flag has no constant, and that is not a gap

`set_circular_base`, `set_zone_randomly` and `set_zone_by_team` take no arguments at all, so
there is nothing to name and no `#const` to emit. A flag is shared by being present or absent in
the skeleton the role builds, which is exactly what a role is for.

`checkLandAttachment` needs no change for this. An expectation of
`{ attribute: "set_circular_base", expectedArgs: [] }` reads a present, zero-argument attribute as
attached and a missing one as detached, through the existing code path.

### 4.5 Absent is not zero, and the optionals are load-bearing

Every new valued field is optional, and absent means **the attribute is not written**. That is a
different map from writing the documented default. `border_fuzziness` defaults to 20 and
`clumping_factor` to 8, so a role that wrote `0` where the user meant "leave it alone" would
change every land's shape. The same trap `grid.layer` fell into when `0` doubled as GRASS.

The panel therefore shows an explicit empty state per field with the documented default beside
it, read from `language.json`'s `default`, never hardcoded.

**[rev 1] The four borders are four fields on `LandRole`, not one `LandBorders` record.** The
first draft nested them as `borders?: LandBorders`. Section 5's override is
`Partial<Omit<LandRole, …>>`, and `Partial` makes each TOP-LEVEL key optional without recursing,
so a nested record would make an override of `left_border` alone restate all four sides, which
breaks section 5.5's "per attribute per land" promise and section 5.3's replacement rule at the
wrong granularity. Flattened:

```ts
  leftBorder?: Expr;
  rightBorder?: Expr;
  topBorder?: Expr;
  bottomBorder?: Expr;
```

The panel may still render them as one row of four; the model does not.

### 4.6 One ordering rule, from a guide header line

guide:1145 on `land_id`, "Must be used after `assign_to_player` / `assign_to` since they will
reset the ID." That is a `Requires`-class header line, which this repo's Hard rules say to read
as behaviour to implement rather than as prose about the entry.

`buildLandAttachmentExpectations` already returns an ORDERED array and
`buildCreateLandSkeleton` renders it in that order, so the rule is one position in one array and
it is directly testable. `land_id` goes last, after the assign attribute. Stated here because it
is invisible in the emitted text and a later reader reordering the array for tidiness would
silently break it.

## 5. The per-land override

### 5.1 The shape, and which existing precedent it reuses

```ts
export interface Placement {
  // … existing members unchanged …
  /**
   * Per-attribute deviation from this placement's role (Q11). Absent, or an
   * absent key, means the role's own value is used. Every key holds a value in
   * the SAME domain as the role field it shadows, so an override can never
   * change an attribute's kind.
   */
  roleOverrides?: RoleOverrides;
}

export type RoleOverrides = Partial<Omit<LandRole, "id" | "label">>;
```

The model already has two shapes for "shared value, one instance deviates", and they are not
interchangeable.

- **`nudged`** is a boolean discriminator, and the deviating value lives in a field the
  `Placement` already has (`offset`). Re-expansion reads the flag to pick between recompute and
  delta.
- **`thetaPerCount`** is an optional partial record, because the deviating value has nowhere
  else to live.

**A role override is `thetaPerCount`'s shape, and the reason is mechanical rather than a
preference.** A `Placement` has no `terrain` or `baseSize` field to deviate in. The value needs a
place, so the override has to carry it, so the discriminator-plus-existing-field shape is not
available. Saying which precedent applies and why is the point of this paragraph; both were
considered and only one is reachable.

`Partial<Omit<LandRole, "id" | "label">>` rather than a hand-written second interface, so the
override set cannot drift from the role's own fields when a later session adds one. A structural
type keeps the two provably in step; two hand-written lists do not.

### 5.2 How it emits, and why an inline literal is the one option that breaks the tool

Three candidate emissions, and the first is disqualified by a property the tool already depends
on.

**(i) Write the overridden value as a literal inside the `create_land`.** Rejected. Sec.6.2's
whole detachment story is that a reference means attached and anything else means detached, with
exactly one named exception for per-repeat values. An override is not per-repeat, it does not
vary with the index, it is one land differing. If the tool wrote its own literals it could no
longer tell its own output from a hand-edit, and `checkLandAttachment` would be reading a value
that means two different things. Sec.6.2's escape hatch is the ABSENCE of a mechanism, and this
would put a second thing in the same slot.

**(ii) Emit the override as its own `#const` and reference it.** Taken. The overridden attribute
gets a per-land name allocated through `NameAllocator`, one `#const` line, and the skeleton
references that name in place of the role's. Everything else in that land still references the
role, so a role edit still reaches it on every attribute the land did not override.

**[rev 1] (ii) covers the `Expr`-valued fields, and the other three kinds each have a path
already.** A flag override (`circularBase`) toggles the attribute's presence in that land's
skeleton, there is no constant to allocate (section 4.4). A `zone` or `assign` override whose
arm is `perRepeat` goes through the existing per-repeat literal path with the placement's own
`repeatIndex`; whose arm is `fixed` allocates a per-land constant the same way (ii) does, since
`fixedZoneName` is a constant today and section 4.2's `fixed` slot number is one too. An
`extent` override changes which ATTRIBUTE NAME the skeleton writes, so the effective-names
resolver in section 10 slice 3 item 3 carries the arm as well as the name. Stated so a builder
does not read (ii) as "every override is a `#const`" and then have nowhere to put a flag.

**(iii) Emit a `#const` derived from the role's own, `(ALP_ROLE_PLAYER_SIZE + 3)`.** Not built,
door left open. This is the delta reading, and it is genuinely attractive, because it is the same
delta the merge rule applies to a nudged offset. It is not built because nobody asked for it, no
corpus map expresses a land's size as an offset from another land's, and building it means
deciding what a delta means for `terrain` (a `Ref`, where there is none) and for `extent` (where
the two arms are different attributes). The door is open and costs nothing to leave open; the
role's constant name is allocated before any land's override is emitted, so the emitter can
substitute a reference to it locally, which is exactly the move Sec.8.2 of the per-player
escalation already makes for `ALP_DEG_Pk` rather than adding an `Expr` leaf kind. **Do not add an
`Expr` leaf kind for this either.** `Expr` is published contract in `tools-api/index.ts` with
`npm run check:generated-types` behind it.

### 5.3 Replacement, not delta, and the reason is the same one `slot.theta` gives

An override REPLACES the role's value for that land. It does not compose with it.

For a union-valued field this is forced. There is no delta between `{ kind: "perRepeat" }` and
`{ kind: "fixed" }`, or between `percent` and `tiles`. For a scalar field it is a choice, and it
is the same choice `PatternSlot.theta` already made against `perimeterShift`; a field that means
two things depending on context is the failure mode this feature keeps naming, a plausible
looking wrong map.

**Which answers Sec.4.5's own question about `ZonePolicy.perRepeat` directly.** Overriding `zone`
on a land whose role derives its zone per repeat gives that one land a fixed zone and leaves
every other land deriving. The override replaces the POLICY, not the resolved number, so there is
no case where a land is half following a rule.

### 5.4 An override has an owner, and a role does not

`emitModel.ts` resolves a role's `Expr` fields with `undefined` as the owning player, and its own
comment says why; a role has many lands, so a `perPlayer` `RandomParam` reference in a role field
is unresolvable by construction and correctly fails.

An override is attached to one `Placement`, and `computeOwnerPlayers` already knows that
placement's owner. **So an override can reference a `perPlayer` parameter and a role cannot.**
That is a real capability the override unlocks rather than a quirk, it needs no new code, and it
should have a test in both directions, because it is exactly the kind of asymmetry that reads as
a bug to the next person. **[rev 1]** And a third: a standalone placement chained to nothing
per-player has no owner either, so the same reference on ITS override fails for the same reason
a role's does. The asymmetry is owner-versus-no-owner, not override-versus-role.

### 5.5 Overriding is not the same as detaching, and the panel has to say so

Three states per attribute per land, and they must be distinguishable in the tree, because two of
them look identical in the emitted script to anyone not reading the names.

| State      | What the `create_land` says             | Who owns the value |
| ---------- | --------------------------------------- | ------------------ |
| Following  | `base_size ALP_ROLE_PLAYER_SIZE`        | the role           |
| Overridden | `base_size ALP_LAND_P3_SIZE`            | this placement     |
| Detached   | anything else, including a bare literal | the document       |

Detached stays what it is today, the absence of a mechanism, and the tool still reports it and
still never reasserts itself.

## 6. What it costs

Let `R` be roles, `A` the valued attributes a role sets (a flag costs no constant), `N` lands,
`M` overridden lands and `d` the attributes each overrides.

|                                   | `#const` lines | Literals inside `create_land` blocks | Lines to edit to change one shared attribute |
| --------------------------------- | -------------- | ------------------------------------ | -------------------------------------------- |
| **This design**                   | `R×A + M×d`    | per-repeat only                      | **1**                                        |
| Duplicate the role per deviation  | `(R+M)×A`      | per-repeat only                      | `1 + M`                                      |
| No roles, literal every attribute | 0              | `N×A`                                | `N`                                          |

Worked on this document's own acceptance map, `Bulls_Eyes.rms`, scaled to the 8 player
arrangement the per-player escalation already prices. Two roles, a Player role and an Aux role,
each setting `terrain_type`, `base_size`, `extent`, `base_elevation` and `set_circular_base`, so
`A = 4` valued plus one flag. 32 lands.

|                                   | `#const` lines | literals inside blocks | edit "all aux lands are bigger" |
| --------------------------------- | -------------: | ---------------------: | ------------------------------: |
| This design, no overrides         |          **8** |                     32 |                      **1 line** |
| This design, 2 lands overriding 3 |         **14** |                     32 |                      **1 line** |
| One role per deviation            |             16 |                     32 |                         3 lines |
| Literal every attribute           |              0 |                **128** |                        24 lines |

At the widest a role can go, all 14 valued attributes set, the same 32 lands cost **28 `#const`
lines against 448 literal ones**, which is the same ratio this whole tool exists to delete;
Sec.0 prices the hand-written original at eight useful numbers spread over 104 lines.

**The override is cheap against the alternative it replaces, and that is the number to carry
away.** A land deviating on three attributes costs 3 lines under this design and 14 under
role duplication, and role duplication also destroys the property the role existed for, since
editing the shared value then touches one line per duplicate.

## 7. The panel

Sec.8 already describes a Roles list that "edits the `#const` set behind each chip" and a tree
where "each land shows which role it wears or that it has detached from one". Both grow rather
than change.

**The Roles list gains a two-tier attribute form** in `RolesSection` / `RoleRow`
(`panel/LandPlacementPanel.tsx`). Tier 1 from section 2.1 is always shown. Tier 2 sits behind one
disclosure labelled for what it holds rather than for its rank, since "advanced" tells the user
nothing about whether their case is in there. Every valued field is the existing formula field
(`panel/formulaField.ts`), so an `Expr` role attribute gets hoisting, live parse feedback and the
emitted line count already built for offsets.

**The mutex groups render as a choice, not as two fields.** Extent is one control with a
percent/tiles selector beside the value. Assign is one control that reveals `target`, `number`,
`mode` and `flags` only in the `assignTo` arm. Zone gains a fourth radio. The user cannot express
the illegal combination because the control has no way to say it, which is section 4.1's type
doing its job at the other end.

**The per-land override lives in `PlacementEditor`**, under the existing role chip, as a
collapsed "Overrides" section listing only the attributes this land has overridden, with a
picker to add one. That is `ThetaPerCountEditor`'s own shape, decided in the per-player
escalation's section 11; an always-rendered list of what is overridden, never folded into the
field that shows the shared value, because folding makes a deviation invisible.

**Each overridden row carries its own reset control**, which deletes the key rather than writing
the role's current value into it. Writing the value would freeze it, and the land would stop
following the role while looking as though it still did.

**Every field shows the role's value as its empty state** and, where the role is also silent,
`language.json`'s own documented `default` (section 4.5). The four borders additionally surface
`language.json`'s `cautionMessage` when a negative value is typed, read from the data rather than
restated, and `top_border` carries the guide's own paired-border bug note.

Per CLAUDE.md's rule, **every one of these controls wraps in `<HelpTip id="…">` with a matching
`reference/data/ui-help.json` entry as it is built**, not afterwards. This adds on the order of
twenty ids; name them in the slice, and `helpCoverage.test.ts` gates them.

## 8. A precondition this design makes reachable, P6

`language.json` carries `requiresSection: "ELEVATION_GENERATION"` on `base_elevation`, measured
in game in 2026-07-30 and driving **RMS0311**. Without the section the map generates and looks
correct while every slope silently does nothing.

`buildLandAttachmentExpectations` writes `base_elevation` into **every** skeleton
unconditionally, today, before any of this design. `preconditions.ts` has P1 through P5 and
nothing checks the section. So the tool can already emit a script that trips the app's own error
diagnostic.

Every corpus map that uses `base_elevation` has the section, so authors get this right and no
existing script exposes it. That is exactly why it has not been noticed; the tool writes the
attribute into a script the user did not necessarily prepare.

**P6, the `<ELEVATION_GENERATION>` section must exist when any emitted land carries a
`base_elevation`.** The section may be completely empty. One-click fix, the shape Sec.6.3 and
Sec.9 SPECIFY for P3's `direct_placement`. **[rev 1] P3 has no one-click fix built.** The panel
renders P3 as a message only (`LandPlacementPanel.tsx`, the `p3.ok` branch of the preconditions
strip) and nothing in the tree inserts `direct_placement`, checked by grep on 2026-09-21. So the
P6 slice builds the fix mechanism from nothing, and should give P3 its specified fix in the same
change, since the two are one shape. It belongs in this work because the same slice is touching
the skeleton builder, and because a wider attribute set is a wider surface for the same class of
silent prerequisite; `requiresSection` is the only one of the 24 that declares one, checked.

## 9. A defect found by the cross-check, and it is in shipped code

`landCommand.ts:96` emits `assign_to` with **two** arguments.

```ts
expectations.push({
  attribute: "assign_to",
  expectedArgs: ["AT_PLAYER", String(repeatIndex + 1)],
});
```

`language.json` declares `assign_to` with **four** arguments, none of them `optional`. The guide
signature is `assign_to AssignTarget Number Mode Flags`. Every `assign_to` use in this corpus
is four arguments (token-level, 6605 of 6621 lines carry four numeric tokens after the target
and the remaining 16 continue onto the next line), and `Bulls_Eyes.rms` writes `assign_to AT_PLAYER 1 0 0` on
both of its player lands.

So the app's own parser raises **RMS0201**, "assign_to expects 4 arguments but only 2 were
found", on this tool's own output, on every player-assigned land it emits. **[rev 1]** Nothing is
red because the two tests that touch it (`landCommand.test.ts:110`, `emitModel.test.ts:187`)
both assert `toContain("assign_to AT_PLAYER 2")`, which a four-argument line satisfies just as
well. They do not pin the two-argument spelling; they are too weak to see either spelling, which
is the "a check that has only ever passed proves nothing" rule in its plainest form.

It is in this design's scope rather than adjacent to it, because section 4.2 is where `mode` and
`flags` get modelled. **Fix it in slice 1**, emit `assign_to AT_PLAYER k 0 0`, and strengthen
both tests to the full four-token line. Then mutation-test it, since a check that has only ever passed proves nothing; the
assertion to add is that the emitted fence draws no RMS0201 from `validate()`, which is a
stronger and more durable claim than a string match on four tokens.

## 10. Slice plan

Three slices, each shippable, each with its own brief. Hand one brief to one session.

### Slice 1, the reshape and the defect fix

**Files.** `landPlacement/model.ts`, `roleEmit.ts`, `landCommand.ts`, `emitModel.ts`,
`fence.ts` **[rev 1]**, `panel/modelOps.ts`, `panel/LandPlacementPanel.tsx`,
`panel/viewModel.ts`.

1. `LandExtent`, `AssignPolicy`, `PlayerSlot` and `ZonePolicy`'s `random` arm in `model.ts`
   (section 4). No new attribute yet; this slice only changes the SHAPE of what is already
   covered, so the surface it can break is small and Sec.10.1's gate proves it did not.
2. `emitRole` learns `extent` and emits under the right attribute name. `roleEmit.ts`'s
   `RoleConstNames` gains `extentName` and the `land_percent`/`number_of_tiles` choice rides on
   the union's discriminant, never on a second field.
3. `buildLandAttachmentExpectations` learns `AssignPolicy` and `ZonePolicy.random`, and **emits
   `assign_to` with four arguments** (section 9).
4. Migrate `assignToPlayer: true` to `{ kind: "assignTo", target: "AT_PLAYER", number: { kind:
"perRepeat", base: 1, step: 1 }, mode: 0, flags: 0 }` and `landPercent` to
   `{ kind: "percent", value }` at every construction site, including every test fixture.
   **[rev 1] AND a read-side upgrade in `fence.ts`'s `readFence`.** The first draft said no
   migration path, leaning on Sec.4.5's consequence 4 ("no panel has ever written a fence"),
   and asked the builder to check it was still true. Checked: it is not. The build-log's
   2026-09-15 entry records a soft Discord announcement with feedback arriving, and
   `Land Placement (Alpha)` is in that build's tool dropdown (`src/tools/registry.ts`). A
   tester's document can hold a v1 fence with `landPercent` and `assignToPlayer` in it today,
   and `readFence` only shape-checks the four arrays before casting, so that fence would load
   and crash the first `emitRole` on `role.extent === undefined`. Two lines lift the old fields
   into `extent` and `assign` at read time; do that rather than bumping `FENCE_VERSION`, which
   would have P5 report the fence unreadable and silently start the tester from empty. Test it
   with a fixture written in the OLD shape, since that is the only shape the bug can reach.
5. Panel controls for the three unions, each in `HelpTip`.

**Test obligations.** Sec.10.1's acceptance gate (`__tests__/acceptance.test.ts`) stays
byte-identical, which is the whole proof that a type reshape moved nothing. A new assertion that
`validate()` over the rendered fence plus a tool-built `create_land` returns no RMS0201 and no
RMS0307, mutation-tested by reverting the four-argument fix. A test that the three mutex
combinations are not constructible, which is a `tsc` obligation rather than a runtime one, so it
belongs in the Sec.10.5 typecheck reporter.

### Slice 2, the thirteen attributes

**Files.** `model.ts`, `roleEmit.ts`, `landCommand.ts`, `preconditions.ts`,
`panel/LandPlacementPanel.tsx`, `reference/data/ui-help.json`.

1. Tier 1's nine fields, then tier 2's four (section 4). Every valued one an `Expr` through
   `emitCells`; the three flags carry no constant (section 4.4).
2. `land_id` last in the expectation array (section 4.6), with a test naming the guide line.
3. P6 in `preconditions.ts` plus its panel strip row and one-click fix (section 8), and the
   fix mechanism itself, which does not exist yet; give P3 its specified fix through it too
   **[rev 1]**.
4. The two-tier Roles form, the `language.json`-sourced defaults and border cautions, and one
   `HelpTip` id per control (section 7).
5. A corpus reporter reproducing section 2.1's table, on the `rms0200.measure.test.ts` precedent;
   a reporter, not a gate.

**Test obligations.** One emit test per new attribute asserting the exact rendered line and that
an absent optional emits **nothing at all** (section 4.5's absent-is-not-zero rule, which is the
one most likely to regress). `checkLandAttachment` round-trip for a flag, since zero-argument
attachment is a code path no existing test reaches. P6 red on a script with no
`<ELEVATION_GENERATION>` and green on an empty one, mutation-tested.

### Slice 3, the per-land override

**Files.** `model.ts`, `emitModel.ts`, `landCommand.ts`, `panel/modelOps.ts`,
`panel/LandPlacementPanel.tsx`, `panel/viewModel.ts`.

1. `Placement.roleOverrides` (section 5.1).
2. `emitModel.ts` step 2.5, after roles and before the frame algebra; for each placement with
   overrides, resolve each overridden `Expr` **with that placement's owner** (section 5.4),
   allocate a per-land name through `NameAllocator`, emit its cells, and record the name so
   step 4's `LandSkeletonInput` references it instead of the role's.
3. `RoleConstNames` gains an effective-names resolver so `buildLandAttachmentExpectations` takes
   the per-land set rather than the role's, which keeps detachment detection correct by
   construction instead of by a second list.
4. `setRoleOverride` / `clearRoleOverride` in `modelOps.ts`, mirroring
   `setThetaPerCountOverride`'s existing add/replace/remove shape.
5. The Overrides section in `PlacementEditor`, with per-row reset (section 7).

**Test obligations.** One land overriding one attribute, asserting that land references the
per-land constant and every other land wearing the role still references the role's. A reset
restores the reference rather than freezing the value. An override of `zone` on a `perRepeat`
role leaves the other members deriving (section 5.3). An override referencing a `perPlayer`
`RandomParam` resolves while the same reference in the role field fails (section 5.4), both
directions, because the asymmetry reads as a bug. Every override name reaches `emittedNames` so
P4 sees it, and P4 still reports a genuine collision.

### What does not move

**Sec.10.1's acceptance gate is byte-identical through all three slices.** It regenerates
`Bulls_Eyes.rms`'s 104 placement lines and none of this touches the frame algebra or the
compiler. It is the regression test that a model reshape did not disturb the emit, and it must
not be edited to accommodate any slice.

## 11. Resolved

1. ~~Is `circle_radius` a `create_land` attribute?~~ **Yes.** `language.json` lists it and
   guide:858 states its behaviour there. Scoped out anyway, because the ring it parameterises is
   the one `direct_placement` disables and `direct_placement` is this tool's own precondition
   (section 3).
2. ~~Are `number_of_tiles` and `land_percent` formally exclusive or only conventionally?~~
   **Formally.** Both carry `mutexWith` in `language.json` and the guide's own header line says
   so. RMS0307 already fires on the pair, so it is a union (section 4.1).
3. ~~Is `assignToPlayer` a simplification of `assign_to` or of `assign_to_player`?~~ **Of
   `assign_to`**, and it covers the least used of the three targets (section 4.2).
4. ~~Does `ZonePolicy` need new variants for `set_zone_by_team` / `set_zone_randomly`?~~ **One,
   not two.** `set_zone_randomly` is a real `create_land` behaviour and becomes a fourth variant.
   `set_zone_by_team` is refused on a guide sentence, not on its zero corpus uses (section 3).
5. ~~Does `land_position` belong on a `LandRole`?~~ **No, and it is an explicit non-goal.** It is
   what the frame algebra computes, and a role-level one would stack every land wearing the role
   on one tile (section 3).
6. ~~Which attributes take an `Expr` and which a plain value?~~ **All thirteen take an `Expr`**,
   and Sec.4.5's guess that `border_fuzziness` and `clumping_factor` follow `sweep`'s
   plain-number precedent is wrong. The test is whether the tool consumes the value, and it
   consumes none of them (section 4.3).
7. ~~Does a per-land override compose with `ZonePolicy.perRepeat`?~~ **It replaces the policy for
   that land.** Other members keep deriving. A delta is not expressible across a union's arms and
   is not asked for anywhere else either (section 5.3).
8. ~~Are all the missing attributes worth building at once, or is `land_id` dead weight?~~
   **`land_id` is the widest spread of the thirteen**, 33 of the 45 maps that position a land,
   which refutes the guess in Sec.4.5's own paragraph. The four that are genuinely narrow are
   tier 2 and three of them are tiered by an argument rather than by their count (section 2.1).
9. ~~Does the override emit a literal, its own constant, or one derived from the role's?~~ **Its
   own constant.** A literal would collapse the detachment predicate the tool already depends on;
   the derived form is left unbuilt with its door open (section 5.2).

## 12. Still open

**Nothing blocking, and nothing in slice 1.**

- **[built] An override cannot un-set an optional attribute.** `RoleOverrides` is
  `Partial<Omit<LandRole, …>>`, and an absent key means "follow the role", so there is no
  spelling for "the role writes `clumping_factor`, this one land writes nothing". Wanted by
  nobody yet; if it is, the shape is a sentinel arm on each optional field rather than a second
  map, and the clearing path in `OptionalAttributeField` is where it plugs in.

Two wants recorded rather than designed, both of them model questions rather than attribute ones.

- **A land with no `land_position`.** `Bulls_Eyes.rms`'s tenth `create_land` is one, and the tool
  cannot express it. It would make `min_placement_distance` and `generate_mode` live immediately
  (section 3), and it needs a `Placement` with no offset, no frame and no canvas position, which
  this design deliberately does not open.
- **The delta override**, section 5.2 option (iii). The emitter can already reach the role's own
  constant name, so this stays cheap for as long as nobody builds a second mechanism in the same
  slot.

One judgement call left to the slice that has the panel in front of it. **Where the tier 1 and
tier 2 line falls in the Roles form.** Section 2.1 measures the order and three of the four tier
2 entries are argued rather than counted, so a build session that finds the disclosure hiding
something users reach for should move the line and say so, rather than treating the table as
settled UI.
