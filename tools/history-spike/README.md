# History spikes H1 to H3

Spikes of `docs/local-history-design.md`, kept so they can be run again.

- **H1** (`h1History.ts`) drives `isomorphic-git` through `@tauri-apps/plugin-fs` inside the real app, records the plugin's error messages, call counts and timings, and records whether the page was visible while it measured.
- **H3** (`h3Diff.ts`) opens Monaco's diff editor over the running app with the app's language and theme, on two real comparisons, in light and dark and at two window sizes.
- **H2** needs no app. It bundles the commands the design uses with esbuild (below).

H1 runs H3 when it finishes, writes both results to `<app data>/history-spike/h1-results.json` and closes the app. `h1-h3-results-2026-10-28-visible.json` is the run with the window on screen. `h1-results-2026-10-28.json` is an earlier H1 run with the window hidden, kept for the comparison in the results below.

## Running H1 and H3 again

Nothing here is wired into the app. For a run, from `age-of-rms/`:

1. Install the two packages without touching `package.json`.

   ```bash
   npm install --no-save isomorphic-git buffer
   ```

2. Copy `h1History.ts` and `h3Diff.ts` to `src/spikes/`, and add this to `src/main.tsx` after the `register…` calls.

   ```ts
   if (import.meta.env.VITE_SPIKE_H1 === "1") {
     void Promise.all([
       import("./spikes/h1History"),
       import("./spikes/h3Diff"),
     ]).then(([h1, h3]) => h1.runH1({ after: h3.runH3 }));
   }
   ```

3. Add `fs:allow-read-file`, `fs:allow-read-dir`, `fs:allow-mkdir`, `fs:allow-remove`, `fs:allow-stat`, `fs:allow-lstat` and `core:window:allow-set-focus` to `src-tauri/capabilities/default.json`, and `process:allow-exit` to `desktop.json`.
4. Run it with the desktop unlocked. The spike brings its window to the front and checks it stayed visible.

   ```bash
   VITE_SPIKE_H1=1 npm run tauri dev
   ```

5. Undo steps 1 to 3 (`npm uninstall --no-save isomorphic-git buffer`), and delete `<app data>/history-spike`. H3 maximises the window, so restore its size afterwards if that matters.

H3 reads `test-maps/AK_Vanguard_v1.2.rms`, `test-maps/Menindee_AUS_v2.3.rms` and `AD3_Menindee_v2.5.rms` from DE's `random-map-scripts` folder, by absolute path.

## Measuring H2 again

From `age-of-rms/`, with the packages from step 1 installed, bundle an entry that exports only the commands the design uses (`init`, `writeBlob`, `writeTree`, `writeCommit`, `writeRef`, `log`, `readBlob`, `addNote`, `readNote`, and `Buffer` from `buffer`).

```bash
npx esbuild --bundle --minify --format=esm --platform=browser --log-level=error < entry.js > out.js
```

Feeding the entry on standard input makes esbuild resolve the packages from the current folder, so the entry file can live anywhere. Pass `metafile: true` through esbuild's JavaScript API for the size per package.

## Results, 2026-10-28

**H1 works.** A bare repository per script, written with `writeBlob`, `writeTree`, `writeCommit` and `writeRef`, read back with `log` and `readBlob`, with notes through `addNote` and `readNote`. The first snapshot's text came back byte for byte, on a 42 KB map and on the largest corpus map (366 KB).

**Two things the docs do not say.**

- `isomorphic-git` uses a global `Buffer` that a webview does not have, so the app needs the `buffer` package and `globalThis.Buffer` set before the first Git call.
- It binds `readlink` and `symlink` when it starts, though its docs call them optional. The adapter has to provide them, as stubs that throw.

**The plugin's errors** are plain strings carrying the Windows error number, so the adapter maps them to the codes `isomorphic-git` checks for. `(os error 3)` means a path is missing, for a missing file, folder or parent, and maps to `ENOENT`. Error 2 is the other Windows "not found" and maps the same way. `(os error 183)` means the path already exists, from `mkdir`, and maps to `EEXIST`. `(os error 145)` means a folder is not empty, from `remove`, and maps to `ENOTEMPTY`. Mapping `ENOENT` and `EEXIST` is required, not cosmetic, since `isomorphic-git` creates nested folders by catching them.

**Permissions** beyond the app's current ones: `fs:allow-read-file`, `fs:allow-read-dir`, `fs:allow-mkdir`, `fs:allow-remove`, `fs:allow-stat` and `fs:allow-lstat`.

**Cost.** The visible run is the one to use. Its page reported itself visible and focused at 60 frames a second at every sample, with no visibility changes, and desktop captures taken outside the app show the window in front.

| Operation                              | Plugin calls                                              | Window on screen        | Window hidden (earlier runs) |
| -------------------------------------- | --------------------------------------------------------- | ----------------------- | ---------------------------- |
| One snapshot (blob, tree, commit, ref) | about 24 (8 reads, 7 stats, 7 writes, 3 folder creations) | median 117 to 123 ms    | median 535 to 680 ms         |
| `log` of 20 snapshots                  | about 4 per snapshot                                      | 200 ms                  | 1.0 to 2.2 s                 |
| Reading one old version                | a few                                                     | 36 to 40 ms             | 200 to 330 ms                |
| One plugin round trip (`exists`)       | 1                                                         | median 10 ms, 5 ms idle | median 12 to 63 ms           |
| One core round trip (`isMaximized`)    | 1                                                         | median 6 ms             | not measured                 |
| Disk for 20 snapshots                  |                                                           | 115 KB and 218 KB       | the same                     |

The snapshot time does not grow with the map's size, so it is round trips, not work. A core command with no plugin and no disk access costs about the same as a plugin call, so the bridge between the webview and Rust is most of each round trip. All of this is a debug build. The hidden window made everything about five times slower.

**H2.** 184 KB minified and 59 KB gzipped for the commands used, against 271 KB minified for the whole library. Per package, `isomorphic-git` 71 KB, `pako` 46 KB, `buffer` 25 KB, and small shims the rest (`get-intrinsic` 8 KB the largest). `buffer` comes in through `isomorphic-git`'s own dependencies anyway, so importing it directly adds nothing.

**H3.** Monaco's diff editor works with the app's setup unchanged.

| Comparison                       | Lines       | Changes found | Diff time | Longest page stall | Layout at 800 px | Layout at 1536 px |
| -------------------------------- | ----------- | ------------- | --------- | ------------------ | ---------------- | ----------------- |
| Vanguard, three one-number edits | 1751        | 3             | 83 ms     | 47 ms              | one column       | not run           |
| Menindee v2.3 to v2.5            | 2624 → 2620 | 11            | 49 ms     | 17 ms              | one column       | side by side      |

- The `aoe2-rms` colouring shows on both sides, five token colours in view, in light and dark. The diff editor takes the app's theme with no extra code, since Monaco has one theme for the whole page.
- The diff is computed in the editor worker `monacoSetup.ts` already provides.
- Monaco switches to one column below 900 px (`useInlineViewWhenSpaceIsLimited`), and the app's default window is 800 px wide.
- In dark mode a light strip showed at the right edge, most likely the spike's white page showing through. The real pane should set its background from the theme.
