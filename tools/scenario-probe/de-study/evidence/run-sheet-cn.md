# Round CN run sheet: what decides PANDA_ROCK's stored frame (7 maps, set up 2026-11-14)

**Status: RUN 2026-11-15 and CLOSED (see Conclusions at the end). Predictions frozen in `cn_predictions.pkl`
(2026-11-14 20:01:08) before any map was saved.** Same procedure as round CM (`run-sheet-cm.md`): fresh editor before every map, Tiny, two Britons, Seed Map
with the seed typed in.

Scripts: `python probe_cn.py write` writes `cn-n1-rocksalone.rms`, `cn-n2-rocksafterTC.rms`, `cn-n3-rocksfixed.rms`.
Copy them to `C:\Program Files (x86)\Steam\steamapps\common\AoE2DE\resources\_common\random-map-scripts\`.

## Why

DE stores a different animation frame for each PANDA_ROCK (Heart, round CM r1/r2). It repeats at the same seed, no
generator stream gives it, and Heart's rock at (75,75) gets 1385 at seed 1004 and 737 at 1005. n1 and n2 put the rocks
on the same tiles (checked with `probe_cn.py check`), n2 after the town centres, so only the rocks' instance ids
differ; n3 pins one rock to each of six fixed lands at three seeds, so only the seed differs.

## Steps

1. `batch_cn.ps1 -FromMainMenu -Max 1`, then check `cn-shots\label_cn-n1-rocksalone_1013.png` reads `cn-n1-rocksalone`.
2. `batch_cn.ps1` for the rest.
3. Compare: `python compare_cn.py`.

## Maps (fill in)

| # | File | Saved | Bytes | Note |
|---|---|---|---|---|
| 1 | RMSTEST_cn-n1-rocksalone_1013_n2-brit | | | |
| 2 | RMSTEST_cn-n1-rocksalone_1014_n2-brit | | | |
| 3 | RMSTEST_cn-n2-rocksafterTC_1013_n2-brit | | | |
| 4 | RMSTEST_cn-n2-rocksafterTC_1014_n2-brit | | | |
| 5 | RMSTEST_cn-n3-rocksfixed_1013_n2-brit | | | |
| 6 | RMSTEST_cn-n3-rocksfixed_1014_n2-brit | | | |
| 7 | RMSTEST_cn-n3-rocksfixed_1015_n2-brit | | | |

## Notes (fill in)


## Run 2026-11-15 (Claude, driver batch_cn.ps1; all 7 maps saved, 10.8-11.1 KB; first label checked by eye)

Compared with `compare_cn.py` (output of the run only; predictions' frame field was 0, so every rock "differs" in frame only; positions all match, 6 of 6 per map).
- n1 vs n2 at 1013 and 1014: frames THE SAME. The instance id (shift 12) does not matter.
- n3: the frame at a fixed spot depends on the seed (1339/1159/272 at (19,19); 406/725/891 at (60,19); ...). Frames at 1013 and 1014 in n1/n2 reappear in n3 at other spots (e.g. 1339, 406, 301, 950, 550, 460 at 1013 in n1, n3), so the frame is a per-seed sequence handed out in some order, not a function of position or id.
- (Corrected 2026-11-15: n1 and n3 hand the sequence out in the SAME order, the rocks' creation order; see below.)

## Conclusions (2026-11-15)

- **The k-th PANDA_ROCK created gets the k-th value of a per-seed sequence.** In reference-id order, n1, n2, n3 and
  CM r1/r2 all give 1339, 406, 301, 950, 550, 460 at 1013 and 1159, 725, 1195, 470, 427, 61 at 1014, whatever the
  script, the tiles (n1 vs n3), the instance ids (n1 vs n2, +12) or what was created before (TCs in n2 and CM,
  other decorations in n3). Nothing the RMS stages do moves the sequence, and the rocks move nothing we model.
- **Its source is not found.** `rock_search.py` and `rock_search2.py`: no stream 1-32 of the seed's chain (offsets
  to 4,000, strides 1-5) gives the values by multiply-shift for any scale, or by modulo for any N in 1,386-69,999
  (first 400 offsets); the search finds two planted sequences (control). None from mt19937, the exe's 64-bit LCG
  (>>32, >>33) or Numerical Recipes' LCG seeded with the map seed either, nor from MSVC rand (that test also
  required Heart's single rocks, 1385 at 1004 and 737 at 1005, to be first values, so it is weaker).
- **Closed as a file field the model leaves open:** `object_model` `unknown_frame "open"` (control "zero"): the
  frame is not compared, as for fixed facets. It is an animation frame only, so the preview does not need it.
- **One new rule from n3 1015:** a placed object also deletes decorations already retired (status 7) by the object
  stage's decoration pass (`retire_dying "delete"`, control "skip", which leaves a DLC fern 1358 under a rock).
- Fresh, all 11 rock maps (CN 7, CM r1/r2 at two seeds) identical (`rock_fresh.py`); controls 10 of 11 ("skip")
  and 0 of 11 ("zero").
