# Fingerprint probe (spike S8)

Calibrates the content fingerprint of `docs/community-maps-design.md` Sec.4.6 on the maps on this disk. Dev only. The app never imports it.

## Run

From `age-of-rms/`:

```bash
node_modules/.bin/esbuild tools/fingerprint-probe/probe.ts --bundle --platform=node --format=esm --outfile=probe.out.mjs
```

```bash
NORM=1 CONT=1 node probe.out.mjs
```

Delete `probe.out.mjs` afterwards. `NORM=1` replaces the names a script defines itself (`#const`, `#define`) with one placeholder. `CONT=1` reports the synthetic edits as containment instead of overlap. `AOE2DE_COMMON` overrides the game's `resources/_common` folder.

## Corpus

- DE's shipped maps in `drs/gamedata_x2` (188 after dropping exact duplicates). Used only to build the stop list of common token runs.
- Community maps from `test-maps/` and the game's own `random-map-scripts` folder, with short probe scripts and tutorial files left out (40).
- `test-maps/local/` (21, mostly copies of DE maps).
- Known relationships, by name. Menindee v2.3, v2.5 and WDC2 v1.7, and Comeer v1.4 and v1.5 (Comeer v1.5 exists twice, slightly different). That is four distinct real relationships, a small sample.
- Synthetic edits of every community map, seeded. 15% of numbers changed, a 10% span deleted, a 10% span from another map inserted, and all three at once at 30%, 15% and 15%.

## Result, 2026-10-28

Settings chosen. Runs of 3 tokens, comments dropped, own names replaced by a placeholder, runs found in at least 10% of DE's shipped maps left out (4,743 runs), 64 hashes.

| Measure                                  | Unrelated pairs (1,824)            | Real versions | Synthetic edits (median)                               |
| ---------------------------------------- | ---------------------------------- | ------------- | ------------------------------------------------------ |
| Overlap (Jaccard)                        | p99 0.09, max 0.72                 | 0.31 to 1.00  | numbers 0.61, delete 0.94, insert 0.89, all three 0.39 |
| Containment of the smaller in the larger | p99 0.31, two pairs at 0.6 or more | 0.93 to 1.00  | numbers 0.87, delete 1.00, insert 1.00, all three 0.72 |

The MinHash estimate is within 0.04 of the exact overlap at p95, 0.07 at worst. One fingerprint takes about 5 ms on a median map, after about 7 ms of lexing.

Comeer v1.4 to v1.5 scores only 0.31 on overlap. Both files are 1,031 lines with about 73 changed, but the copy of v1.4 in the game's folder has a stray `/*` on line 196 that is never closed, and DE nests comments, so its last 835 lines are comment (RMS0001). Its live code is about a fifth of v1.5's and almost wholly inside it. Containment, estimated from the overlap and each fingerprint's count of runs, reads 1.00. Renamed `#const` names, which v1.5 also has, are what the placeholder is for.

The two unrelated pairs at containment 0.6 or more are Pa Site against DE's Fortified Clearing (0.95, nearly all of Pa Site's code is in Fortified Clearing) and DE's African Clearing against Land Nomad (0.73). Both are real shared code, not noise.
