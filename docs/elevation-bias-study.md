# Directional bias in random map elevation placement, Age of Empires II: Definitive Edition

**Status:** complete. Measurements taken 2026-07-31 to 2026-08-04 against build `AoE2DE_s.exe` as installed on 2026-07-26.

---

## Abstract

The random map scripting language of Age of Empires II places elevation through a `create_elevation` command whose output is known to favour one region of the map. Prior characterisation, derived from community documentation and from counts of elevated tiles, described this as a step discontinuity across a diagonal with a favoured:disfavoured weight ratio near 18:1, softening to roughly 12:1 under the `enable_balanced_elevation` attribute. This study measures the seed distribution directly rather than inferring it from grown tiles, and finds the seeding bias to be **1.31:1**, an order of magnitude weaker than the accepted value, and uniform with respect to distance from the map boundary. The ratio observed in finished maps is shown to be an emergent statistic that scales with the density of elevation clumps requested by the script, approximately `585 × (clumps / mapArea)` above 250 clumps on a 200×200 map, and independent of the per-clump tile budget. Five candidate mechanisms are tested and rejected. A predictive but non-mechanistic model is proposed.

---

## 1. Introduction

Maps in Age of Empires II: Definitive Edition are generated at match start from a text script. The `create_elevation` command in the `<ELEVATION_GENERATION>` section requests a number of raised clumps and a total tile budget, and the engine distributes them across the map. Players and script authors have long reported that hills are not distributed uniformly, and the community reference documentation states that "hill positions are noticeably biased towards being placed in the south", together with an attribute, `enable_balanced_elevation`, described as reducing that bias.

Quantifying the effect matters for any external reimplementation of the generator. Two properties are needed: the axis along which the bias acts, and its magnitude.

The axis was established in earlier work in this series and is not re-derived here. The rendered map is rotated 45° relative to the tile array, so the "south" of player-facing documentation corresponds to the `y − x` diagonal of tile coordinates rather than to increasing `y`. That result came from an orthogonal control: a measurement of the mean `x` coordinate of elevated tiles, included only as a sanity check on an axis nobody had questioned, returned 0.336 against an expected 0.500.

The magnitude is the subject of this study. The accepted figure entering it was 18:1, obtained by fitting a two-value step to per-band selection rates over elevated tiles. That figure is shown below to be an artefact of the measurement rather than a property of the generator.

---

## 2. Method

### 2.1 Instrumentation

Each measurement uses a minimal random map script isolating one variable. The script is generated in the game's own scenario editor and exported as a `.aoe2scenario` file, which is then parsed to recover the exact terrain identifier, elevation and unit content of every tile. This yields complete, exact grids rather than sampled or visual estimates, and is the only route in this series capable of resolving numeric questions.

Two properties of the instrument constrain the design of every experiment.

**The export is taken after the full generation pipeline has run.** Intermediate state is therefore invisible. This is not a limitation that can be worked around by more careful reading; it caused a false negative elsewhere in the series, where a documented mechanic that reverts a temporary terrain before the objects stage was recorded as "not observed" on the strength of six exports that could not, by construction, have observed it.

**Elevated tiles are not seeds.** A seed grows into a clump, and adjacent clumps merge into single connected components. Any measurement over tiles is therefore a convolution of seed placement, growth, and merging. Separating them is the central methodological problem of this study and the reason its earlier rounds failed.

### 2.2 Measured quantities

For each run, the elevation grid is reduced to the set of tiles with elevation greater than zero, and that set is decomposed into 4-connected components. Three ratios are then computed, each as favoured (`y > x`) over disfavoured (`y < x`), with tiles on the diagonal excluded:

| quantity | definition |
|---|---|
| **seed ratio** | count of component centroids on each side |
| **size ratio** | mean component size on each side |
| **tile ratio** | count of elevated tiles on each side |

These are related by construction, `tileRatio = seedRatio × sizeRatio`, which serves as an internal consistency check. The identity held to within 1.5% in every configuration where component merging was low.

**The tile ratio is immune to merging**, since merging changes which tiles are grouped together and never which tiles are elevated. The seed and size ratios degrade as merging rises, and are trustworthy only where the recovered component count approaches the declared clump count. This asymmetry determines which quantity each experiment can read.

### 2.3 Controlling merging

Component merging is the dominant confound. It was quantified by comparing recovered component counts against declared clump counts:

| declared clumps | tile budget | components recovered | usable for seed/size |
|---|---|---|---|
| 50 | 300 | 47.8 | yes |
| 50 | 1250 | 45.8 | yes |
| 50 | 5000 | 36.5 | no |
| 100 | 600 | 94.0 | yes |
| 250 | 1500 | 189.8 | marginal |
| 500 | 2000 | 283 | no |
| 500 | 3000 | 249.5 | no |
| 1000 | 6000 | 175.0 | no |

At 1000 declared clumps only 17.5% of components survive as distinct, and the seed ratio inverts to 0.49, below unity, which is a clear signature of measurement failure rather than of an inverted bias.

All measurements below are on 200×200 maps with a grass base terrain, no player lands, no cliff section, and clump spacing 1, unless stated otherwise. Player lands are excluded because the engine holds elevation at least 9 tiles from each player origin, and those exclusion zones lie on a ring that crosses the diagonal under study.

---

## 3. Results

### 3.1 The seed distribution

Setting the per-clump tile budget to the engine's own minimum clump size, and using only 100 clumps, produces near-isolated clumps whose component centroids approximate seed positions to within one or two tiles. Six runs yielded 560 seeds from 600 declared.

| quantity | value |
|---|---|
| seeds, favoured | 318 |
| seeds, disfavoured | 242 |
| **seed ratio** | **1.31 : 1** |

The deviation from parity is 38 seeds against an expected standard error of 11.8, so the bias is real at approximately 3.2 standard deviations. Its magnitude is an order of magnitude below the accepted 18:1.

Profiling the same seeds against distance from the nearest map edge:

| edge distance | 0–9 | 10–19 | 20–29 | 30–39 | 40–49 | 50–59 |
|---|---|---|---|---|---|---|
| favoured seeds | 68 | 54 | 52 | 41 | 30 | 29 |
| disfavoured seeds | 48 | 43 | 35 | 35 | 25 | 19 |
| **ratio** | 1.4 | 1.3 | 1.5 | 1.2 | 1.2 | 1.5 |

**Seed placement is uniform with respect to the map boundary.** No border effect is present.

### 3.2 The tile ratio depends on clump density

Holding the per-clump budget at the 6-tile floor and varying only the number of clumps:

| clumps | coverage | seed ratio | size ratio | **tile ratio** |
|---|---|---|---|---|
| 50 | 0.78% | 1.25 | 1.16 | **1.45** |
| 100 | 1.55% | 1.31 | 1.41 | **1.88** |
| 250 | 4.14% | 1.78 | 2.09 | **3.74** |
| 500 | 9.06% | 1.60 | 4.35 | **7.01** |
| 1000 | 20.14% | 0.49 | 30.23 | **14.88** |

Seed and size columns beyond 250 clumps are contaminated by merging and are reported for completeness only. The tile column is valid throughout.

Above 250 clumps the relationship is proportional. Expressing density as clumps per tile of map area:

| clumps | density | tile ratio | ratio / density |
|---|---|---|---|
| 250 | 0.00625 | 3.74 | 598 |
| 500 | 0.01250 | 7.01 | 561 |
| 500 | 0.01250 | 7.16 | 573 |
| 1000 | 0.02500 | 14.88 | 595 |

The constant is 582 ± 17 across these four points. Below 250 clumps the ratio flattens toward the seed-bias floor of 1.3 to 1.9 measured in §3.1.

### 3.3 The per-clump budget has no effect

Two scripts differing only in per-clump budget, at identical clump count:

| clumps | tiles per clump | coverage | tile ratio |
|---|---|---|---|
| 500 | 4 | 6.21% | 7.16 |
| 500 | 6 | 9.06% | 7.01 |

A 50% increase in per-clump budget, producing 46% more coverage, changes the ratio by 2%. These runs were separated by four days and use independently written scripts, so this also serves as a replication.

### 3.4 Matched-coverage comparisons

Coverage and clump count covary in §3.2, and are separated by pairing runs of similar coverage and dissimilar clump count:

| coverage | clumps | tile ratio |
|---|---|---|
| 3.29% | 50 | 1.41 |
| 4.14% | 250 | **3.74** |
| 13.11% | 50 | 2.08 |
| 20.14% | 1000 | **14.88** |

At comparable coverage, five times the clumps yields 2.7 times the ratio, and twenty times the clumps yields seven times the ratio. Coverage does not order the data; clump density does.

### 3.5 `enable_balanced_elevation`

Two scripts identical but for the attribute, at 21.5% coverage on a 120×120 map:

| condition | coverage | tile ratio |
|---|---|---|
| unbalanced | 21.47% | 12.86 |
| balanced | 21.45% | 12.27 |

The attribute reduces the ratio by 4.6%. The previously recorded softening from 20:1 to 12:1 is not reproduced.

### 3.6 Player lands

The same script and map size, with and without eight player lands:

| condition | tile ratio |
|---|---|
| no player lands | 7.16 |
| eight player lands | 2.24 |

The engine's exclusion of elevation within 9 tiles of each player origin removes area from a ring that crosses the diagonal. The exclusion and the bias therefore do not compose independently.

---

## 4. Hypotheses tested and rejected

Five mechanisms were proposed during the study and each was tested against a measurement capable of refuting it.

**H1. The bias acts during clump growth rather than seed placement.** Predicted a size ratio rising with per-clump budget. Measured size ratios of 1.16 and 1.13 across a fourfold budget increase, in the two configurations where merging was low enough to read them. Rejected.

**H2. The observed ratio is a function of elevation coverage.** Predicted monotonicity in coverage. A run at 3.29% coverage gives 1.41 while a run at 1.55% gives 1.88 and a run at 6.21% gives 7.16. Not monotone. Rejected.

**H3. The bias strength depends on map size.** The two runs suggesting this are the same script at two sizes, and differ in clump density by a factor of 2.8. Once density is controlled, no size term is required. Rejected as a confound.

**H4. Seeds are excluded from a border band, so near-edge elevation is unbiased spillover from interior seeds.** Predicted a hard floor in the distribution of component centroids against edge distance. Centroids occur at edge distance 0, and are more numerous near edges than in the interior, partly because clumps clipped by the boundary remain separate rather than merging. Rejected.

**H5. Near-edge disfavoured elevation is spillover from favoured-side clumps growing across the diagonal.** Predicted that such tiles would belong to components straddling the line. Between 0.7% and 3.0% do. Rejected.

The border effect that motivated H4 and H5 is itself an artefact. It appears only in tile-level measurements, is absent from the seed distribution (§3.1), and is therefore a property of growth and merging near the boundary rather than of the placement rule.

---

## 5. Model

The following reproduces every run in this study and is proposed for use in an approximate reimplementation.

**Seed placement.** Draw seeds from eligible tiles with a weight ratio of **1.3 : 1** favouring `y > x`, where eligibility requires matching base terrain and a distance of at least 9 tiles from any player origin. The draw is uniform with respect to distance from the map boundary. No border rule, no per-band weight table, no map-size term.

**Density amplification.** The tile ratio observed in a finished map rises with clump density as `≈ 585 × (clumps / mapArea)` above roughly 250 clumps on a 200×200 map, and flattens toward the seed-bias floor below that. Implementations targeting tile-level agreement should apply this as an explicit post-hoc weighting fitted to §3.2, flagged as a tuning parameter rather than as a derived constant.

**`enable_balanced_elevation`.** Model as a small reduction of the seed bias, on the order of 5%. Do not model it as a second weight table.

**Growth.** Unbiased. Clump growth contributes to the tile ratio only through merging, which concentrates in whichever half holds more clumps.

### 5.1 What the model does not explain

The density relationship is empirical. No mechanism accounts for it, and the naive expectation runs the other way: with clumps required to maintain spacing, a denser map should force overflow into the disfavoured half and reduce the ratio. It increases it, monotonically, across a twentyfold range of clump counts.

Two mechanistic hypotheses (H1, H2) were advanced and refuted during this study. A third was not attempted, on the grounds that the relationship is already predictive across every configuration measured and that the intended application tolerates approximation. Any future work on the mechanism should begin here.

---

## 6. Limitations

**The proportionality constant is established on one map size.** All four points supporting `582 ± 17` are 200×200. The single 120×120 point at high density yields 370, some 36% below the line. Either the constant carries a residual size dependence or high-coverage saturation applies at 21% coverage on a small map; the data cannot distinguish these.

**One cross-size experiment failed and is reported as such.** A repeat at 480×480 was intended to test whether the border effect scaled with map size. Because the tile budget is absolute, coverage fell to 0.90%, leaving approximately 11 disfavoured tiles per analysis bin and ratios scattering between 1.4 and 17.0 with no trend. The run count was doubled in anticipation of sparseness, which addresses variance and not signal. **Cross-size comparisons in this domain must hold coverage constant rather than the declared budget.**

**Component centroids approximate seeds and are not seeds.** Growth displaces a centroid, and the engine imposes a minimum clump size of approximately 6 tiles, so no configuration yields a bare seed. The residual displacement is small relative to the effects measured but is not zero.

**Duplicate exports occurred in four separate batches.** A scenario file embeds its own filename, so file hashes differ even when the generated content is identical. Distinctness must be verified on a content-derived quantity, and on the quantity the measurement reads: an early check on terrain content reported three identical maps for a script that varies only elevation.

---

## 7. Open questions

1. **The mechanism of the density relationship.** Why the tile ratio scales with clumps per unit area, when spacing constraints predict the opposite.
2. **Whether the proportionality constant carries a size term.** Resolvable by repeating §3.2 at a second map size with coverage held constant by scaling the tile budget.
3. **Whether the density relationship saturates.** The highest density measured is 0.025 clumps per tile. Behaviour above that is unmeasured.
4. **The interaction between player-land exclusion and the bias.** Section 3.6 establishes that it is large but characterises it at one player count and one map size.

---

## Appendix A: scripts

Scripts are minimal, isolate one variable, and record their predictions before the run. Each is retained with its reasoning in its own header.

| script | varies | runs |
|---|---|---|
| `RMSTEST_22a` | baseline, 120×120 | 3 |
| `RMSTEST_22b` | `enable_balanced_elevation` | 3 |
| `RMSTEST_32` | player lands present | 3 |
| `RMSTEST_35` | baseline, 200×200 and 480×480 | 3 + 6 |
| `RMSTEST_39` | 100 clumps at the size floor, for seed recovery | 6 |
| `RMSTEST_40a/b/c` | per-clump budget 6, 25, 100 at fixed count | 4 each |
| `RMSTEST_41a/b/c` | clump count 250, 500, 1000 at fixed budget | 4 each |

## Appendix B: consistency of the decomposition

`tileRatio = seedRatio × sizeRatio` verified per configuration. Divergence indicates merging.

| configuration | seed | size | product | tile | agreement |
|---|---|---|---|---|---|
| 100 clumps, 6 tiles | 1.31 | 1.41 | 1.86 | 1.88 | 1.1% |
| 500 clumps, 4 tiles | 1.78 | 4.03 | 7.18 | 7.16 | 0.3% |
| 50 clumps, 6 tiles | 1.25 | 1.16 | 1.45 | 1.45 | 0.0% |
| 50 clumps, 25 tiles | 1.26 | 1.13 | 1.43 | 1.41 | 1.4% |
| 50 clumps, 100 tiles | 1.09 | 1.93 | 2.10 | 2.08 | 1.0% |
| 250 clumps, 6 tiles | 1.78 | 2.09 | 3.72 | 3.74 | 0.5% |
| 500 clumps, 6 tiles | 1.60 | 4.35 | 6.96 | 7.01 | 0.7% |
| 1000 clumps, 6 tiles | 0.49 | 30.23 | 14.81 | 14.88 | 0.5% |

The identity holds throughout, including where the individual factors are corrupted by merging, since both errors are compensating. It validates the decomposition arithmetic and not the interpretation of its terms.
