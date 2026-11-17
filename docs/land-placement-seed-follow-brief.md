# Land Placement shapes follow the seed (build brief)

Written 2026-11-14 for a Sonnet build session, from the owner's Great_Bite report. Build what is
below and nothing else. Where it says **STOP AND ASK**, message the owner and wait.

All paths are relative to `age-of-rms/`. Other sessions edit this repo at the same time. Re-read a
file right before editing it, use Edit (never a whole-file Write on an existing file), don't
`git commit`, and run `npx prettier --write` on the files you changed at the end. Every new
interactive control is wrapped in `HelpTip` with a short `reference/data/ui-help.json` entry
(what it does and its effect, nothing that restates the label). New prose in comments, docs and UI
strings follows the repo CLAUDE.md language rule. Run tests by exact path or with
`npx vitest run src/tools/builtin/landPlacement`, never over the whole repo while another session's
sweep may be running. Run the full `npm test` once at the end.

## What the owner asked for

After Re-roll in the Land Placement panel, the shapes drawn on the canvas should sit where the
lands actually generate at that seed. A button next to Re-roll holds the shapes still instead. By
default the shapes move with the seed.

## Why they don't line up today

The map under the canvas is a real generation of the script at the panel's seed
(`PanelPreviewResultProvider` in `src/App.tsx`, seed from `panelPreviewSeed.tsx`). The shapes are
drawn from `emission.resolved`, which `emitAlpModel` (`emitModel.ts`) builds with every
`RandomParam` set to the midpoint of its range (`emitRandomParams` in `paramEmit.ts`,
`previewValues` and `previewById`). So a ring rotation of `rnd(0,359)` always draws at 179.5 while
the lands under it use whatever the seed rolled. On Great_Bite that is
`ALP_PARAM_ROTATION_RING_2`.

The rolled values are already computed. `useEmission.ts` instantiates the script at the same seed
and passes the result to `emitAlpModel` as `scriptSymbols`. When the script's fence is the one the
current model would write, `scriptSymbols` holds every `ALP_PARAM_*` name with its rolled value.

## Settled decisions (owner, 2026-11-14)

1. Following the seed is on by default.
2. A control next to Re-roll turns it off, and the shapes then hold still.

## Decided for the build (owner may revisit)

3. Held shapes draw at the midpoint, exactly as today. Holding does not freeze the last rolled
   values. This keeps the held picture the same at every seed, and it is what every existing test
   already assumes.
4. The setting lives in `PanelPreviewSeedProvider` beside the seed, so it survives tab switches the
   way the seed does. It is not saved across app restarts. Each session starts following.
5. A param counts as rolled only when the fence in the script was written for that same param.
   Otherwise it draws at the midpoint and the panel says so (item 4 below).

## Build order

### Item 1. A rolled value source in `paramEmit.ts`

Add an optional parameter to `emitRandomParams`, `rolled?: (name: string) => number | undefined`.
For each emitted param cell (the shared name, or each `_P<n>` name of a `perPlayer` param), use
`rolled(name)` for `previewValues` when it returns a number, else the midpoint. `previewById` takes
the shared value, or for a `perPlayer` param the `_P1` value. Record that last choice in a comment,
since a per-player param has eight values and the id-keyed map can hold one. Leave
`rolled` undefined and nothing changes, which every current caller does.

Gate. A new test in `__tests__/paramEmit.test.ts` (extend the file if it exists). With
`rolled` answering 42 for a shared param's name, `previewValues` and `previewById` hold 42. With a
`perPlayer` param and `rolled` answering `_P3` only, `_P3` is the rolled value and the other seven
are the midpoint. With `rolled` undefined, every value is the midpoint.

### Item 2. Which script values count as rolled for this model

In `emitModel.ts`, add an optional last parameter to `emitAlpModel` and `tryEmitAlpModel`,
`options?: { followSeed?: boolean; fenceModel?: AlpModel | null }`. When `followSeed` is true,
build `rolled` from `scriptSymbols`, but answer only for names whose param in `fenceModel` (the
model read from the script's fence with `readFenceModel`) has the same id, `min`, `max` and
`perPlayer` as the current model's param, and only when `fenceModel` is not null. Any other name
answers undefined. Pass `rolled` into `emitRandomParams`. Both `verifyEmission` calls already read
`paramEmission.previewValues`, so the two passes stay consistent with each other. Don't change
them.

Return `paramsRolled: number` and `paramsHeld: number` on `EmissionOk`, counting params that got a
rolled value and params that fell back to the midpoint while following was on. Both are 0 when
following is off.

`computeApplyEdits` (`applyEdits.ts`) must keep calling without the option. Apply writes the same
text whatever is on screen, and its own `previousEmission` must reproduce the old skeleton text,
which does not depend on param values. Check that with the existing applyEdits tests.

Gate. Tests in `__tests__/emitModel.test.ts`. A model with one circle rotated by a `rnd(0,359)`
param, emitted with `followSeed` true, `scriptSymbols` holding the param's name at 90, and a
matching `fenceModel`, puts member 0 at the 90 degree position. The same with `fenceModel`
holding `max` 180 instead puts it at the midpoint and counts one held. `followSeed` false
ignores `scriptSymbols` for params. Mutation check. Make `rolled` ignore `fenceModel` and confirm
the stale test goes red, then restore it exactly.

### Item 3. The seed gate, against a real generation

The point of the feature is that the canvas and the generated map agree, so pin that with the real
pipeline rather than with numbers the test builds itself. Add
`__tests__/seedFollow.test.ts`. Load `test-maps/Great_Bite_check_ARMS_matches_DE.rms` (a local
map, not tracked, so skip the test with `it.skipIf` when the file is absent, the way other tests
that read untracked maps do). For seeds 1, 2, 3, 17 and 999, instantiate the script with
`instantiateScript` at that seed, emit its own fence model with `followSeed` true, and run
`placeLandOrigins` (`src/preview/generator/lands.ts`, as `applyEdits.test.ts` already does). Each
pond member's resolved `ALP_X_*`/`ALP_Y_*` percent, turned into tiles the way the canvas does,
must land within one tile of that land's origin. Write down how the test pairs a placement with its
origin.

**STOP AND ASK** if the gate fails on any seed by more than a tile. That means the panel's
instantiation and the preview's draw `rnd` differently, and the fix is not this brief's to choose.

### Item 4. Wire it into the panel

`panelPreviewSeed.tsx`. Add `followSeed: boolean` (initial true) and `setFollowSeed` to the
context value.

`useEmission.ts`. Read `followSeed` from `usePanelPreviewSeed()` (or take it as a parameter, your
call, but don't read the context in two places). Pass `{ followSeed, fenceModel:
readFenceModel(parse) }` to `tryEmitAlpModel`, and add both to the `useMemo` dependency list.
`readFenceModel` parses the banner JSON, so memoise it on `parse` with its own `useMemo` rather than
inside the emission's.

Instantiation settings. `useEmission` instantiates with `teams: []`, while the panel's preview uses
the generation settings' `teams` and `teamPositions` (`ChannelProvider` in
`src/PreviewResultContext.tsx`). A script that branches on team labels would then roll differently
in the two. Pass the same `teams` from `useGenerationSettings()` into `instantiateScript`. If
`instantiateScript` has no field for `teamPositions`, leave it out and say so in the build log.

`LandPlacementPanel.tsx`, the toolbar with `Seed {seed}` and Re-roll (around line 513). Add a
checkbox labelled "Shapes follow seed" after Re-roll, checked when following. Wrap it in
`HelpTip id="landPlacement.followSeed"`, text along the lines of "When on, shapes draw with the
random values this seed rolls, so they sit on the lands below. When off, each random value draws
at the middle of its range and the shapes stay put on Re-roll." When following is on and
`emission.paramsHeld > 0`, show one line under the toolbar, "Some random values are not in the
script yet, so those shapes draw at the middle of their range. Apply to see them at this seed."
That line is not interactive and needs no HelpTip.

Drags. A drag on a shape whose rotation or radius is a param already goes through the absorb or
decline path in `dragMath.ts`, which reads resolved values. Don't change that path. Do check
by hand (run sheet item 5) that dragging a member while following works and that the drag does not
jump when the seed changes. **STOP AND ASK** if it jumps, since what a drag should edit while
the picture follows a roll is a design question.

Gate. Extend `panel/__tests__/LandPlacementPanel.selection.test.tsx` or add a small panel test.
The checkbox renders checked, unchecking it changes the label of nothing else, and the held line
appears when a param is not in the script.
`src/tools/__tests__/helpCoverage.test.ts` must stay green with the new id.

### Item 5. Records

Add run sheet section 60 to `docs/manual-test-run-sheet.md` before "Not covered here". Number it
after whatever the last section is when you build, if 60 is taken.

1. Open Great_Bite in Land Placement. Press Re-roll five times and confirm each time the ponds,
   players and far lands drawn on the canvas sit on their lands in the map below.
2. Uncheck Shapes follow seed and Re-roll. Confirm the shapes stay put while the map moves.
3. Check it again and confirm the shapes jump back onto the lands.
4. Change a param's range in the panel without applying. Confirm the held line appears and that
   shape draws at the middle of its new range. Apply and confirm the line goes.
5. With following on, drag a pond member and Re-roll. Confirm the drag kept its edit and the
   member did not jump on release.

Append a dated build-log entry. Update the Land Placement memory if there is one for this feature.

## Limits

- Don't touch Apply's output or `previousEmission` in `applyEdits.ts`.
- Don't change how a held (midpoint) value is computed.
- Don't persist the checkbox across restarts.
- Fixed-count jitter and every other undesigned Land Placement want stays unbuilt.
