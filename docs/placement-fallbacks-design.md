# Placement Fallbacks design (rev 1, 2026-09-28)

A right-click action on a `create_object` card that rewrites the command into a chain of passes. Pass 1 is the command as written. Each later pass runs only where the earlier ones failed, with constraints the author chose to loosen. Worked out from a design conversation that started with a per-player boar and ended with the general case below.

Read `CLAUDE.md` first. The hard rules that bite here are "code is the only source of truth for Breakdown", "vocabulary is data-driven", "never silently drop content", and "every interactive UI element wraps in HelpTip". New prose in this file follows the house punctuation rule.

## 1. The short answer

- The chain is a sequence of `create_object` commands sharing actor-area IDs. Each placed object leaves a **guard** area. Later passes avoid the guards, so a pass only fires in a slot the earlier passes left empty.
- The feature needs three things from the command. How many **slots** it fills (one per player, one per land, one per component of a place-in area, or one in total). How far each pass can reach from the slot's origin. How far apart the slots sit.
- The guard radius for pass `i` is `reach(i) + max reach(j)` over every later pass `j`. Guards never need to be larger, and a larger guard only costs neighbours space.
- Groups do not always need the anchor-and-placeholder build. It is only needed when one object has to carry two or more actor areas (Sec.5).
- Name. Recommend **Add Fallbacks…** in the menu and **Placement Fallbacks** as the dialog title. "Ensure Placement" promises something the engine cannot give, since the last pass can still fail. See Q1.

## 2. Engine facts this rests on

Each row says where the fact comes from. Rows marked "spike" are unverified and gate the slice that needs them (Sec.10).

| Fact                                                                                                      | Source                                                                                                                     |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `avoid_actor_area` blocks areas from every player's objects, including under `set_place_for_every_player` | In-game, 2026-09-28. The first player's boar blocked every other player's boar under a map-wide guard. The guide is silent |
| `create_actor_area` areas exist before any `create_object` runs, wherever the line sits                   | guide:1991                                                                                                                 |
| An area from the `actor_area` attribute exists only once its object is placed                             | Implied by guide:2782 ("the first object successfully created"). Recorded in `language.json`'s `create_actor_area` note    |
| Objects sharing an actor-area ID all take the radius of the first one created                             | guide:2782                                                                                                                 |
| A command can avoid the area it is creating itself, for ungrouped or loose objects only                   | guide:2858                                                                                                                 |
| Player distances are square unless `set_circular_placement` is set. Actor areas are square                | guide:2430, guide:1989                                                                                                     |
| `place_on_specific_land_id` measures distance from that land, and places on every land sharing the ID     | guide:2432, guide:2287                                                                                                     |
| `max_distance_to_players` does nothing without `set_place_for_every_player` or a land ID                  | guide:2433                                                                                                                 |
| `min_distance_group_placement` repels every future object, not only the command's own                     | guide:2611                                                                                                                 |
| One `actor_area_to_place_in` per object                                                                   | guide:2824                                                                                                                 |
| `avoid_all_actor_areas` avoids every existing area                                                        | guide:2878                                                                                                                 |
| `force_placement` stacks units on an occupied tile once free tiles run out                                | guide:2737                                                                                                                 |
| Off-grid placeholder `PLACEHOLDER_GENERIC` (1902) can share a tile with another object                    | guide:4703 and `game-constants.json` say off grid. guide:2218 lists 1902 as on grid. **Spike S2**                          |
| A radius-0 area can be placed into when `set_tight_grouping` is set                                       | guide:4784. **Spike S2**                                                                                                   |
| `actor_area_to_place_in` binds a per-player object to its own player's areas                              | Unknown. guide:2830 hints at player-referenced areas. **Spike S3**                                                         |

`spacing_to_other_terrain_types` belongs to `create_terrain` (guide:1532), not `create_object`. The object-side constraints a ladder can loosen are listed in Sec.6.

## 3. The model

### 3.1 Slots

A slot is one place the author wants exactly one object (or one group).

| Slot kind     | Comes from                                                                                   | Who spreads objects across slots                       |
| ------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Per player    | `set_place_for_every_player`                                                                 | The engine, one placement per player                   |
| Per land      | `place_on_specific_land_id` with a shared ID                                                 | The engine, one placement per land                     |
| Per component | `actor_area_to_place_in` on an area made of separate pieces, no per-player or land attribute | The chain itself, through a guard the pass also avoids |
| Single        | A unique land ID, `generate_for_first_land_only`, or a plain generic command                 | Nothing to spread                                      |

"Per component" is the two-squares case. Each object claims a component by covering it with its guard, so the next object in the same pass has to go elsewhere.

### 3.2 Reach

`reach(i)` is the largest Chebyshev distance from the slot's origin that pass `i` can place at. Only region-bounding attributes set it. Constraints that only filter tiles (forest avoidance, terrain, other actor areas) shrink the region and can be ignored, since a guard sized for the larger region is still large enough.

| Slot kind            | Reach                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Per player, per land | `max_distance_to_players`. Circular placement gives the same bound, since a Euclidean radius fits inside the square of the same size |
| Per component        | The component's radius. Known when the component is a `create_actor_area` with literal arguments                                     |
| Single               | Unbounded is fine, since there is nothing else to block                                                                              |

A per-player or per-land command with no `max_distance_to_players` has unbounded reach. Refuse it with a message suggesting a max distance. A land-ID command without `avoid_other_land_zones` can also spill onto connected terrain off the land (guide:2314), which counts as unbounded.

When a value sits under `if` branches, `rnd()` or a `#const`, take the largest value any branch can produce and show the per-map-size figures in the dialog. Emitting symbolic radii is Q5.

### 3.3 Guard radius

`R(i) = reach(i) + max reach(j)` over later passes `j`. For per-component slots, include `j = i`, because the pass also has to stop a second object landing in the same component.

The worst case is the placed object and the later candidate on opposite sides of the origin, so the bound is tight and the minimum spread (`min_distance_to_players`) does not reduce it.

Guard IDs follow from guide:2782. When every pass has the same radius, one shared ID does the job, and every pass both avoids and creates it. When radii differ, each pass gets its own ID and later passes avoid all earlier ones. The last pass creates no guard unless its slots are per component.

### 3.4 Separation and what can go wrong

| Slot kind            | Condition                                              | Failure when it does not hold                                                                                       | Dialog response                                                                                                   |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Per player, per land | Neighbour origins more than `R(i) + reach(j)` apart    | A neighbour loses the part of its later ring nearest the guard. Never the whole ring unless origins nearly coincide | Warning with the figure. Separation read from the preview's land origins at the current player count and map size |
| Per component        | Component centres more than `R(i) + r(s) + r(t)` apart | One object blocks another component outright                                                                        | Error. Insert disabled                                                                                            |
| Single               | None                                                   | None                                                                                                                | None                                                                                                              |

For two squares of equal radius `r`, with no region loosening, `R = 2r` and the centres must be more than `4r` apart.

### 3.5 Counts

Each slot gets one object or one group. The guard records only whether a slot filled, so it cannot top up a shortfall. `number_of_objects 3` ungrouped per player, or `number_of_groups 2` per player, is K slots per origin. Refuse that in the first slices with a message suggesting one command per object. A later slice can emit K chains (Sec.10).

Per-component chains are the exception. Every pass keeps `number_of_objects` equal to the component count, since filled components are already guarded and the extra attempts fail harmlessly.

`set_scaling_to_map_size` and `set_scaling_to_player_number` change the count at generation time. Refuse them.

## 4. Direct guard (no placeholders)

Used when the object needs exactly one actor area, the guard. That covers single objects in every slot kind, and groups in per-player, per-land and single slots.

Per-player boar, 10 to 12, retries at 14 and 18.

```rms
create_object BOAR { set_place_for_every_player  set_gaia_object_only
  min_distance_to_players 10  max_distance_to_players 12
  actor_area FB1_G1  actor_area_radius 30 }       /* 12 + 18 */
create_object BOAR { set_place_for_every_player  set_gaia_object_only
  min_distance_to_players 10  max_distance_to_players 14
  avoid_actor_area FB1_G1
  actor_area FB1_G2  actor_area_radius 32 }       /* 14 + 18 */
create_object BOAR { set_place_for_every_player  set_gaia_object_only
  min_distance_to_players 10  max_distance_to_players 18
  avoid_actor_area FB1_G1  avoid_actor_area FB1_G2 }
```

Two squares, one boar each, ladder loosening forest avoidance only. Radius is constant, so one ID.

```rms
create_object BOAR { number_of_objects 2  set_gaia_object_only
  actor_area_to_place_in SQUARES  avoid_forest_zone 3
  avoid_actor_area FB2_G  actor_area FB2_G  actor_area_radius 8 }   /* 4 + 4 */
create_object BOAR { number_of_objects 2  set_gaia_object_only
  actor_area_to_place_in SQUARES
  avoid_actor_area FB2_G  actor_area FB2_G  actor_area_radius 8 }
```

**Groups in engine-spread slots.** A tight or loose group can carry the guard directly. Distances to players measure the group's centre (guide:2431), but the guide does not say whether a grouped command's area sits on the centre or on each member, so size for members. Let `g` be the group's extent from its centre, `group_placement_radius` for a loose group and at most `number_of_objects − 1` for a tight one, which grows through adjacent tiles (guide:2119).

- Tight retries check `avoid_actor_area` at the centre only (guide:2122), so `R(i) = reach(i) + g + max reach(j)`.
- Loose retries check each member (guide:2143), and a member outside the guard would still place, so add the retry's own extent as well, `R(i) = reach(i) + g + max (reach(j) + g(j))`.

This keeps the engine's grouping behaviour exactly as written, which the placeholder build in Sec.5 cannot fully do.

## 5. Anchor and placeholders

Needed when one object must carry two or more areas. An object has one `actor_area`, so the extra areas ride on invisible placeholders stacked on it. The cases are these;

- a group in per-component slots, where same-command self-avoidance fails for tight groups (guide:2858) and breaks loose groups by blocking their own members
- an original command that already has its own `actor_area` that other commands reference
- spacing between groups that the original expressed with `min_distance_group_placement` (Sec.5.3)

### 5.1 The build

1. **Anchor.** The first object of the group, placed by the pass with `actor_area PIN` and `actor_area_radius 0`. `PIN` is shared by every pass, so later steps find every anchor.
2. **Guard placeholder**, after each pass. `PLACEHOLDER_GENERIC` into `PIN`, with `set_tight_grouping` and `force_placement` for the radius-0 area (guide:4784, guide:2737), avoiding every earlier guard so it only lands on this pass's anchors. Carries the guard area.
3. **Group placeholder**, once after the last pass. Into `PIN`, carrying `GROUP` at the original `group_placement_radius`.
4. **Members.** The remaining `number_of_objects − 1`, placed into `GROUP` with the original per-member constraints.
5. **Original area placeholder**, when the command had its own `actor_area X`. Recreates `X` at the anchor with its original radius.
6. **Spacing**, Sec.5.3.

Placeholders are always `set_gaia_object_only`, so no player owns an invisible unit.

### 5.2 Binding placeholders to the right anchor

Every placeholder step has to land on its own slot's anchor.

**Per player and per land.** Placeholders use the same slot attribute, `find_closest`, and `max_distance_to_players reach(last pass)`. `test-maps/24hr_Petra.rms` (local corpus, untracked) stacks per-player placeholders on a radius-0 anchor with `find_closest` and `force_placement`. The max distance is added here to keep a placeholder from reaching a far anchor. It is not airtight. If a player's anchor is missing and a neighbour's anchor lies within the bound, the placeholder lands on the neighbour's anchor, and that player's members follow it there. It needs origins closer than about `2 × reach`, and only matters when the whole chain failed for one player. Spike S3 checks whether `actor_area_to_place_in` is player-scoped, which would remove the problem. Until then, the dialog warns using the Sec.3.4 separation figure.

**Per component.** There is no origin to bind to, so members cannot be spread one group per anchor in a single command. Unroll one round per component, two commands each;

```rms
/* round k: claim one anchor that no earlier round claimed */
create_object PLACEHOLDER_GENERIC { set_gaia_object_only  set_tight_grouping  force_placement
  actor_area_to_place_in FB3_PIN
  avoid_actor_area FB3_GROUP_1  /* … one line per earlier round */
  actor_area FB3_GROUP_k  actor_area_radius 5 }
create_object DEER { number_of_objects 3  set_gaia_object_only
  actor_area_to_place_in FB3_GROUP_k }
```

This needs anchors further apart than the group radius, which the Sec.3.4 check already guarantees.

### 5.3 Replacing `min_distance_group_placement`

An anchor that keeps `min_distance_group_placement` repels its own placeholders and members (guide:2611), so the build has to strip it. Two ways to put the effect back;

- **Spacer (recommended).** A last placeholder on each anchor carrying the original `min_distance_group_placement N`. Placed after the members, it repels only objects later in the script, which is what the original did. No other command needs editing. Spike S5 confirms the engine applies the rule from a placeholder.
- **Opt-in area.** A placeholder carrying `SPACING` at radius N. Later commands avoid it only where the author adds `avoid_actor_area SPACING`. The dialog lists the later `create_object` commands that previously were kept away and would now need the line. Offered as an option for authors who want selective spacing.

`temp_min_distance_group_placement` only acts inside one command, so it stays on the anchors unchanged.

### 5.4 What changes about the group

Decomposition changes group shape. A tight group becomes the anchor plus members in a small area around it, not one contiguous blob grown from the centre. The dialog says so when it picks this build for a tight group, and the Sec.4 direct guard is always preferred where it applies.

## 6. The retry ladder

The dialog shows the passes as columns and each loosenable constraint present in the command as a row. Each cell holds the value for that pass or "drop". A new pass starts as a copy of the last one. Only attributes already in the command can be loosened. Adding new constraints to a retry is out of scope.

Which attributes are loosenable and in which direction lives in `language.json`, not in code. Proposed field on the attribute entry, `fallback`, with `direction` (`raise`, `lower` or `drop`) and `bounds` (true when it sets reach). First population;

| Attribute                                                           | Direction     | Sets reach                                           |
| ------------------------------------------------------------------- | ------------- | ---------------------------------------------------- |
| `max_distance_to_players`                                           | raise         | yes                                                  |
| `min_distance_to_players`                                           | lower         | no                                                   |
| `avoid_forest_zone`, `avoid_cliff_zone`, `min_distance_to_map_edge` | lower or drop | no                                                   |
| `terrain_to_place_on`, `layer_to_place_on`                          | drop          | no                                                   |
| `avoid_actor_area` (each line separately)                           | drop          | no                                                   |
| `temp_min_distance_group_placement`                                 | lower or drop | no                                                   |
| `max_distance_to_other_zones`, `avoid_other_land_zones`             | raise or drop | only `avoid_other_land_zones` when dropped (Sec.3.2) |
| `require_path`, `min_connected_tiles`                               | lower or drop | no                                                   |

The dialog refuses a ladder that tightens a constraint between passes, since a later pass that is stricter than an earlier one can never fire where the earlier one failed.

## 7. What it writes

- **One `TextEdit`** replacing the command's span, through a new `replaceNode` intent in `patch/intents.ts`. The existing `insertText` only inserts. `replaceNode` takes the same carried range `moveNode` uses, so a same-line trailing comment is handled the same way. `#const` lines for the new IDs go inside the fence, directly above the chain, which keeps it one edit.
- **Passes are slices, never re-renders.** Pass 1 is the original text byte for byte. Each later pass is that same slice with attribute lines removed, values replaced and new lines inserted, reusing `formatStyle.ts` for indentation. Authors keep their spacing, comments and attribute order.
- **A fence**, following Land Placement's precedent (`land-placement-design.md` Sec.6.1, `fence.ts`). `/* @fallbacks v1 begin @fallbacks-model {…} */` then the chain then `/* @fallbacks end */`. The model stores the original command's slice and the ladder settings, escaped with the same whitespace-to-`\uXXXX` rule `fence.ts` uses. Move that escaping into a shared helper rather than copying it.
- **Regenerate wholesale.** Edit Fallbacks reopens the dialog from the model and replaces the whole fence. If the text inside no longer matches what the model produces, the dialog says the chain was edited by hand and offers overwrite or cancel. **Remove Fallbacks** puts the stored original back.
- **IDs.** Pick actor-area values above the highest value any actor-area attribute or `create_actor_area` uses anywhere in the file, all branches included, and `#const` names that collide with no existing symbol. Name them from the object, e.g. `FB_BOAR_G1`.
- **Position.** The chain replaces the command where it stands, inside any `if` or `start_random` branch.

## 8. UI

- **Entry points.** The card menu gains **Add Fallbacks…** on `create_object` cards, or **Edit Fallbacks…** and **Remove Fallbacks** on a card inside a fence. Breakdown-design Sec.3.11 sets a bar that every menu entry shortcuts something visible elsewhere, so the action also needs a visible home on the card. See Q2.
- **Which cards.** Offered on any command whose definition carries a new `fallbacks: true` flag in `language.json` (only `create_object` today), so the check is data, not a name comparison.
- **Dialog.** Built like `TemplateDialog.tsx`. Top holds a read-only summary of the detected slot kind in plain words ("one boar per player", "one boar in each of 2 areas"). Middle holds the ladder grid of Sec.6 and the group options of Sec.5. Bottom holds a live read-only preview of the RMS text, then warnings, then **Insert** and **Cancel**.
- **Warnings**, always visible when they apply;
  - the `avoid_all_actor_areas` warning, listing by line number every later command that uses it, since the chain's areas will block those commands wherever they reach
  - neighbour shadow (Sec.3.4), with the figure
  - placeholder binding (Sec.5.2), when it applies
  - the tight-group shape change (Sec.5.4)
  - the opt-in spacing list (Sec.5.3), when that option is chosen
- **Refusals** disable Insert and say why. They are unbounded reach with more than one slot, more than one object per slot, scaling attributes, a component separation that fails Sec.3.4, a ladder that tightens, and an unclosed or raw command.
- **HelpTip** on every control, with `reference/data/ui-help.json` entries under `breakdown.fallbacks.*` and `breakdown.cardMenu.addFallbacks`.

## 9. Verification

- **Pure module**, `src/breakdown/fallbacks/`, no React. Slot detection, reach, radii, ID allocation and text emission. Every emitted chain parses with zero errors through `src/parser`, and pass 1 is byte-identical to the original.
- **Property tests** on the radius rule. For random ladders, every point a later pass can reach lies inside the guard of every earlier placement in the same slot, checked by brute force over tiles.
- **Patch gate.** The replacing edit goes through the Sec.4.8 property gate like every other intent.
- **Preview gaps.** `src/preview/generator/objects.ts` records one area per command per frame, at the last placement (file header note 5). Per-player and per-land chains preview correctly. Per-component chains do not, because same-command self-avoidance is not modelled and the preview would show two objects in one square. Fixing that means per-placement area bookkeeping for commands that avoid their own ID, which is a preview-design change and has to be escalated there before slice 2 claims preview support.
- **In-game spikes**, run through `tools/scenario-probe/rmstest` before the slice that depends on each;
  - S1 player scoping of `avoid_actor_area`. Done 2026-09-28.
  - S2 `PLACEHOLDER_GENERIC` stacks on a radius-0 anchor, with and without `set_tight_grouping`.
  - S3 does a per-player placeholder's `actor_area_to_place_in` stay on its own player's anchor when its own anchor is missing? Force one player's anchor to fail with a `create_actor_area` over that player's known `direct_placement` position.
  - S4 radius edges are inclusive. Pass 1 at exactly 12, 99 flags at exactly 18 avoiding the guard. Radius 30 should give zero flags, radius 29 some.
  - S5 `min_distance_group_placement` on a placeholder repels later objects.
  - S6 same-command self-avoidance spreads one object per square (guide:2858 says yes).

## 10. Slices

1. Model, emitter, fence, dialog, menu entry. Single objects in per-player, per-land and single slots. Direct guard. Needs S4.
2. Per-component slots with single objects. Needs S6 and the preview escalation.
3. Groups in per-player, per-land and single slots through the direct guard.
4. Anchor and placeholders. Per-component groups, original `actor_area` preservation, spacing. Needs S2, S3, S5.
5. K objects per slot as K chains, with inter-chain spacing through placeholder areas.

## 11. Alternatives considered

- **One map-wide guard.** Correct for single slots only. Blocks every other slot's retries in multi-slot commands, which is the failure that started this design.
- **Guard centred on the player origin.** A placeholder at the origin, placed only when the anchor's own area covers the origin, carrying radius `max reach(j)`. Shadows neighbours far less than an anchor-centred guard. Rejected for now because when origins are closer than `2 × reach(i)`, a neighbour's anchor can trigger it and block a player's retries completely, which is worse than a partial shadow. Worth revisiting if S3 shows placement binds per player.
- **Decomposing every command.** One code path, but more commands, depends on S2 and S3 for every chain, and changes tight-group shape. The direct guard covers the common cases with none of that.

## 12. Open questions

- **Q1. Name.** Add Fallbacks / Placement Fallbacks (recommended), Ensure Placement, or other.
- **Q2. Visible entry point.** A small button on `create_object` card headers, or relax Sec.3.11's bar for this entry.
- **Q3. Spacing default.** Spacer (recommended), opt-in area, or ask per chain.
- **Q4. Breakdown display of the fence.** The model comment renders as a comment card full of JSON. Hide fence comments and show a compact header card instead?
- **Q5. Symbolic radii.** When reach comes from a `#const` or an `if` ladder, emit an expression that tracks it, or the resolved worst-case number (recommended for slice 1)?
- **Q6. K per slot.** Is slice 5 wanted, or is "one command per object" an acceptable answer?
