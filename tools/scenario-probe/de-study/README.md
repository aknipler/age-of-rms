# The DE study archive

The evidence behind `docs/preview-design.md` rev 9 and rev 10. Between 2026-10-09 and 2026-10-19 the owner ran
black-box tests on Age of Empires II DE's map generator. Each probe script was generated in the scenario editor at a
typed seed, the map was saved, and every tile was read back and compared with a prediction written before the run.
That found the game's random number generator, the order of its draws, and the rules of the land, elevation and
cliff stages, tile for tile. The study lived in a folder outside this repo, which is expected to be deleted, so its
probes, its saved maps and its written evidence are kept here. The rules themselves are in the spec, Sec.6.1 to 6.4
and Sec.8, and the preview's DE gates (`src/preview/__tests__/de*Maps.test.ts`) hold the preview to these maps.

All of it is DE build 101.103.54800.

## What is here

| Folder       | Holds                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probes/`    | The 94 probe scripts, as DE ran them.                                                                                                                    |
| `scenarios/` | 232 maps DE generated from them and the editor saved.                                                                                                    |
| `evidence/`  | The two write-ups and the corner-cut note, the run sheets, the predictions written before each round, the results log (`results.md`) and the open cases. |

The write-ups are `evidence/de-land-stage.md` and `evidence/de-elevation-cliffs.md`. They state each rule with the
maps that tested it and what was left untested. `results.md` is the run-by-run log, including the readings each map
rejected and by how much.

## Reading a scenario's name

`RMSTEST_<script>_<seed>_<lobby>`, with `_size-<n>` added for a map larger than Tiny (120). The lobby code is the
player count, then the team of each player when there are teams, then `r` when the editor's Team Positions box was
unticked. `n2` is two players with no teams, `n4t1122` four players in teams 1, 1, 2 and 2, and `n4t1122r` the same
with Team Positions off.

A few names differ from their script. `a7-behaviour` and `c2-conf-circle` are `a7-behavior.rms` and
`c2-conf-circ.rms`, `land4_<seed>` is `land4-grow.rms`, `land3-tiebreak-<seed>` is `land3-tiebreak.rms`, and
`land-probe-k0-2` is a second save of `land-probe-k0.rms`.

**Twelve `p4o-players` maps carry stale alliances.** They were saved while a player in the game was still allied
with an unused slot, which a real lobby never does and which moves players in the editor (the alliance trap in
`../README.md`). `../export_de_fixture.py check` lists them and refuses them.

## Checking a map against the preview

```bash
python ../export_de_fixture.py add scenarios/RMSTEST_cl1-default_1000_n2.aoe2scenario --script probes/cl1-default.rms --seed 1000 --fixture <scratch copy of the fixture>
```

Point `--fixture` at a scratch copy and run the gate's logic against it, or add the map to the real fixture when it
should become part of the gate. A script with `<OBJECTS_GENERATION>`, such as the villager markers of
`p4o-players`, needs `--force`. The objects do not change the terrain the gate compares.

## What was not kept

The study's Python tools are not here. The evidence names them (`land_model.py`, `stage_model.py`,
`writeup_check.py`, `compare_ec.py` and others), so read those names as history. They were the study's own model
of the game, which the preview has since replaced and which the DE gates check. The prediction pickles, the caches,
and the study's notes on disassembling the game's executable were not kept either.

## Round ET, set up and not run

The last round (`evidence/run-sheet-et.md`, `evidence/et-predictions.md`) was set up on 2026-10-19 and never run in
DE. It is the first round on the terrain stage (`t1-forest` to `t9-cliffs`, `pg1-grassland`) plus what elevation and
cliffs left open (`e1-high` to `e5-coast`, `ct3` to `ct5`, `gr2` to `gr5`, `ly2`, `ly3`, `wc2`). Its scripts are in
`probes/` and its run sheet says how to generate the maps. Its predictions came from the study's Python model, which
was not kept, so the maps would now be compared with the preview. The elevation and cliff ones can go straight
through the gate. The terrain-stage ones would test a stage the preview only approximates (Sec.6.4), so they would
start a new piece of work rather than check an old one.
