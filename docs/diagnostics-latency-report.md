# Diagnostics and highlighting latency report

2026-10-22. Session 3 of `feedback/2026-10-comeer-feedback-sessions.md`. The owner picked fixes 1 and 2 of Sec.7, built the same day in `src/editor/parseResponses.ts`. In Chromium a warm Vanguard parse now delivers its diagnostics 120 ms after it is sent and its tree at 315 ms, where before both came at 315 ms. A superseded tree is dropped unread in 0.0 ms instead of a 100 ms unpack. Documents under 50,000 characters wait 30 ms instead of 150 ms before parsing.

## 1. The question

RMSIDE feels fast. In Age of RMS the squiggles feel slow to update, and a newly opened file takes a while to show syntax colours. Is it the laptop or the implementation, and would Rust instead of TypeScript fix it?

Short answer. It is mostly the implementation, and Rust would not fix it.

- On a small or medium map, 150 ms of the roughly 180 to 200 ms wait is the debounce in `src/useParsedDocument.ts`. The parse itself takes 1 to 20 ms.
- On Vanguard the biggest cost is copying the parse result, 7.1 MB of syntax tree and tokens, from the worker to the UI thread. That copy is 150 to 250 ms, more than the 86 ms parse and validate. Part of it blocks the UI thread, so typing stalls too.
- Monaco's tokenizer is fast (1 to 5 ms for the visible lines of Vanguard), so slow colours on open come from when Monaco gets to run, not from the tokenizer.
- The laptop matters as a multiplier. The same Vanguard parse ran 2.7 times slower at 99% CPU load than at 68%.

## 2. How it was measured

| Instrument                                      | What it timed                                                                                                                                           | Where                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Node probe, `node:v8` serialize and deserialize | lexer, parser, `validate()`, preview generation, the structured clone of every payload                                                                  | esbuild bundle of `src/parser` and `src/preview/generator`, 15 runs per map, median              |
| Chromium harness                                | the real `parserWorker.ts` round trip, Monaco editor creation, Monarch tokenizing, `diagnosticsToMarkers`, `setModelMarkers`, the preview `postMessage` | a throwaway Vite page in the in-app browser running the app's own modules. Deleted after the run |
| `src/perfTrace.ts`                              | every stage in the real `npm run tauri dev` host, React commits included                                                                                | left in the code behind a flag, Sec.8 and Sec.9                                                  |

Machine is an Intel i5-10210U (4 cores, 8 threads, U series), 8 GB RAM, on mains power. CPU load from other programs and agent sessions sat at 68% for most runs and 99% for the last. Each figure is a median, and the spread is given where it was wide.

The in-app browser pane was hidden for the harness runs, so it painted no frames. Paint times and the React commit cost could not be taken there and wait on the owner's trace (Sec.8).

Maps used are `test-maps/new_map.rms` (2.5 KB, 195 tokens), `Comeer v1.5.rms` (42 KB, 3628 tokens) and `AK_Vanguard_v1.2.rms` (366 KB, 49705 tokens, 1751 lines).

## 3. Timings

### 3.1 Keystroke to squiggles

All figures are milliseconds.

| Stage                                         | Thread        | Small         | Comeer        | Vanguard                               |
| --------------------------------------------- | ------------- | ------------- | ------------- | -------------------------------------- |
| Debounce, restarts on every key               | UI timer      | 150           | 150           | 150                                    |
| Lex and parse                                 | parser worker | 0.6           | 4.2           | 63 (Chromium 62 to 99)                 |
| `validate()`                                  | parser worker | 2.4           | 2.7           | 23 (Chromium 13 to 32)                 |
| Serialize the 7.1 MB result                   | parser worker | 0.4           | 5.3           | 94 (Chromium, with queueing, 58 to 71) |
| Unpack the result                             | **UI**        | 0.6           | 9.2           | 158 (Chromium 93 to 152)               |
| Whole round trip, Chromium                    |               | 27            | 41            | 358 to 424                             |
| `diagnosticsToMarkers` plus `setModelMarkers` | UI            | 0.2           | 0.3           | 0.4                                    |
| React commit for the new result               | UI            | owner trace   | owner trace   | owner trace                            |
| Paint, one frame                              | UI            | about 16      | about 16      | about 16                               |
| **Estimated total, before React**             |               | **about 190** | **about 210** | **about 520 to 590**                   |

The serialize and unpack rows are the structured clone that every `postMessage` does. The unpack happens lazily, when the UI thread first reads `event.data`, so its cost lands on the UI thread.

### 3.2 After the squiggles

| Stage                                                                                | Thread         | Small       | Comeer      | Vanguard    |
| ------------------------------------------------------------------------------------ | -------------- | ----------- | ----------- | ----------- |
| Preview request 300 ms after each parse result, re-serializing the whole ParseResult | **UI**         | 0.8         | 6.6         | 85 to 160   |
| Preview generation                                                                   | preview worker | 420 to 1210 | 660 to 1220 | 900 to 1020 |
| Preview result unpack                                                                | UI             | 0.6         | 8.3         | 5.7         |

### 3.3 Typing

| Stage                                                                           | Small       | Vanguard    |
| ------------------------------------------------------------------------------- | ----------- | ----------- |
| Monaco keystroke handler, including the `getValue()` mirror in `useDocument.ts` | 1.0 to 3.2  | 1.5 to 4.0  |
| React re-render of the app shell per keystroke                                  | owner trace | owner trace |

### 3.4 Highlighting on open

| Stage                                                | Small    | Comeer | Vanguard                     |
| ---------------------------------------------------- | -------- | ------ | ---------------------------- |
| Register the language and theme, once at startup     | 10 to 35 |        | 10 to 67                     |
| `model.setValue`                                     | 2        | 3      | 3 to 32                      |
| `monaco.editor.create`, dev build                    | 38       | 41     | 14 to 198                    |
| Monarch tokenizing the first 60 lines                | 1.9      | 3.1    | 1.0 to 5.5                   |
| Monarch tokenizing the whole file, in idle slices    | 7.5      | 17.5   | 48 to 485                    |
| First token event after `editor.create`, no paint    | 48       | 53     | 25 to 209                    |
| Cold `tauri dev` page load after a dependency change |          |        | 12 s once, then 0.2 to 0.6 s |

### 3.5 Load

| Vanguard, Node                    | 68% CPU load | 99% CPU load |
| --------------------------------- | ------------ | ------------ |
| Lex and parse                     | 63           | 169          |
| Full clone, serialize plus unpack | 252          | 691          |

## 4. Ranked causes

### 4.1 Squiggles

1. **The debounce, on every map size.** It is 150 ms of a roughly 190 ms wait on small maps. It restarts on each key, so while typing continuously the squiggles do not move at all. They update 150 ms plus a round trip after the last key.
2. **The syntax tree copy, on large maps.** The parser worker sends the whole ParseResult, tokens and tree, 7.1 MB on Vanguard. Copying it costs 150 to 250 ms, more than the parse it carries, and the unpack half of it runs on the UI thread.
3. **Stale results still pay for the copy.** `useParsedDocument` reads `event.data` before it checks the request id, so a result that is about to be thrown away is unpacked on the UI thread first.
4. **Stale results are thrown away.** That rule is correct, since markers for older text would point at the wrong characters. On Vanguard it means a typist pausing between 150 and about 550 ms per key never sees the squiggles refresh until a longer pause.
5. **The preview copies the same tree again.** 300 ms after each parse result, `usePreviewResult` posts the whole ParseResult to the preview worker. That is another 85 to 160 ms on the UI thread on Vanguard, which shows up as typing lag. Each generation (0.4 to 1.2 s) also runs to the end even when a newer one supersedes it, and it competes with the parser for the laptop's four cores.
6. **Machine load.** Every stage scales with it, by 2.7 times between the two load levels measured. Parallel agent sessions running Vitest are a large part of that load on this laptop.
7. **Development build.** `tauri dev` serves unminified code with React's development checks. A release build is the fair comparison with an RMSIDE install.

Not measured yet is React's commit cost. `AppContent` holds the document text in state, so every keystroke re-renders the app shell, and every parse result re-renders whatever reads it (CodePane, the status bar, the side panel, the Breakdown pane when it is in front). Sec.8 collects it.

### 4.2 Highlighting on open

1. **Monaco only tokenizes a model that an editor shows.** The app starts on the Breakdown tab, and `CodePane` unmounts whenever the Code tab is left. Each visit to Code builds a new editor (14 to 198 ms in dev). Colours arrive after a 50 ms timer in Monaco plus a frame.
2. **The UI thread is busy right after an open (not yet confirmed).** Opening runs `setValue`, a full app re-render, the parse result unpack (100 to 150 ms on Vanguard) with its React commit, then the preview re-serialize (85 to 160 ms) and the canvas render. Monaco's tokenizing of the visible lines waits behind whichever of these is queued first. The trace's "first highlighted tokens painted" line settles whether this is the delay.
3. **Startup in `tauri dev`.** Vite rebuilt its dependency cache on the first load after a change (12 s once). `import * as monaco from "monaco-editor"` also loads every Monaco language and its services (a 4.2 MB bundle), which costs at startup rather than at open.

Ruled out are the tokenizer itself (1 to 5 ms for the visible lines) and lazy registration. `main.tsx` registers the language and the theme at startup, and nothing waits on reference data or the parser worker.

## 5. TypeScript or Rust

Rust would speed up one stage, the worker's lex, parse and validate. That is 86 ms on Vanguard and 3 to 7 ms on a small map, all of it already off the UI thread. A tenfold faster parser saves about 75 ms on Vanguard and about 3 ms on a small map.

It leaves the costs from Sec.4 untouched, which are the 150 ms debounce, the 150 to 250 ms copy and the 85 to 160 ms preview re-post. A Rust parser behind Tauri IPC would make the copy worse. The tree would arrive on the UI thread as JSON, and JSON measured slower than structured clone here (stringify 519 ms and parse 497 ms against 226 ms and 454 ms in the same run, 18 MB against 7.1 MB). Rust compiled to WebAssembly inside the worker avoids IPC, but turning its tree into JavaScript objects costs about what building them in JavaScript does, and the copy to the UI thread remains.

RMSIDE is fast mainly because of what it sends, and its language matters less.

## 6. How RMSIDE does it

From its public repository ([aoe2control/AoE2RMSIDE](https://github.com/aoe2control/AoE2RMSIDE), Apache 2.0, read on 2026-10-22).

- Electron with React and Monaco 0.56, Monarch for colours like ours.
- Analysis runs in `rms-ls`, a Rust language server in its own process.
- `monaco-language.ts` sends the whole text to the server on every `onDidChangeContent` with no debounce.
- The server answers with `publishDiagnostics`, a list of diagnostics and never a syntax tree. Vanguard's 31 diagnostics are 8.9 KB and clone in 0.1 ms.
- It has no block editor that needs a syntax tree on the UI thread. The Breakdown pane is why Age of RMS sends one.
- It ships a latency profile behind a compile time feature (`latency.rs`, `apps/desktop/src/latency-profile`). `src/perfTrace.ts` follows the same idea with a runtime flag.

## 7. Ranked fixes

Gains are for the keystroke to squiggles time unless stated.

| Rank | Fix                                                                                                                                                                                                                                                                                                 | Gain                                                                                                    | Risk                                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Diagnostics first.** The worker posts a small `{ requestId, diagnostics }` message straight after `validate()`, then the full ParseResult as a second message. Markers apply from the first. The UI thread reads the second only when its id is still current, so stale trees are never unpacked. | Vanguard about 150 to 250 ms sooner, and stale results stop costing the UI thread. Small maps unchanged | Low to medium. The marker staleness guard needs the source for the small message, already kept in `sourceByRequestIdRef`. BUG-001's `reparseNow` path is untouched. |
| 2    | **Shorter debounce, scaled by size.** For example 30 ms under 50 KB and 150 ms above.                                                                                                                                                                                                               | About 120 ms on small and medium maps, the biggest win there                                            | Low. More parses on small maps at 3 to 20 ms each, off the UI thread. `reparseNow` stays a bypass (BUG-001).                                                        |
| 3    | **Stop the UI thread copying the tree to the preview.** Either the preview worker parses the source itself, or the parser worker hands its result to the preview worker through a `MessageChannel`.                                                                                                 | Removes an 85 to 160 ms UI stall per parse on Vanguard, 7 ms on Comeer                                  | Medium. A second parse costs worker CPU. The channel keeps one parse but is more plumbing.                                                                          |
| 4    | **Supersede preview generations.** Drop queued requests older than the newest, and terminate a running one when a newer request arrives.                                                                                                                                                            | Frees a core while typing on large maps                                                                 | Medium. Interacts with the watchdog. The hard rule that `reset()` is not `terminate()` applies.                                                                     |
| 5    | **Keep the Code tab's editor mounted** and hide it instead.                                                                                                                                                                                                                                         | 14 to 198 ms per switch to Code, and colours are already there on return                                | Medium. CodePane's mount race comments describe what depends on remounting.                                                                                         |
| 6    | **Slimmer tree payload.** Drop `tokens` (3.0 of 7.1 MB) or pack them into a transferable typed array.                                                                                                                                                                                               | About 40 to 50% of the copy                                                                             | High. More than 25 main thread modules read `parseResult.tokens`.                                                                                                   |
| 7    | **Keystrokes stop re-rendering the app shell.** Move the text mirror out of `AppContent` state.                                                                                                                                                                                                     | Unknown until the owner's trace gives the React numbers                                                 | High. Many consumers read `doc.content`.                                                                                                                            |
| 8    | Rust or WebAssembly parser                                                                                                                                                                                                                                                                          | At most about 75 ms of worker time on Vanguard, about 3 ms on small maps                                | Very high. Not recommended.                                                                                                                                         |

Fixes 1 and 2 together put a small map near 70 ms (30 debounce, about 25 round trip, one frame) and Vanguard near 250 to 300 ms (150 debounce, the worker's parse and validate, one frame), before React.

## 8. The owner's run in `tauri dev`

The trace is `src/perfTrace.ts`, off unless a flag is set. Steps.

1. Start the app from `age-of-rms`.

   ```bash
   npm run tauri dev
   ```

2. Open WebView2's developer tools with Ctrl+Shift+I or right click and Inspect. In the Console run

   ```js
   localStorage.setItem("aorms.perfTrace", "1");
   location.reload();
   ```

   and type `[perf]` into the console's filter box.

3. Note the CPU load in Task Manager, and close other heavy programs if possible.
4. **Highlighting.** Switch to the Code tab, then File, Open, `test-maps/new_map.rms`. Read `after file open, first highlighted tokens painted`. Open `AK_Vanguard_v1.2.rms` the same way and read the same line. Then switch to Breakdown and back to Code, and read `code editor mounted` and `after editor mount, first highlighted tokens painted`. Close the app, start it again, and repeat once for a cold start.
5. **Squiggles.** On the Code tab with Vanguard open, type one character at the end of a line and wait two seconds. Read the lines from `parse #N sent` to `squiggles painted`, including any `react update (app)` line between them. Do it five times, then the same on `new_map.rms`.
6. **Typing lag.** On Vanguard type a whole word at normal speed and look for `LONG TASK` and `react update` lines.
7. Save the console (right click, Save as) into `RMS/test-outputs/` and say which file it is.
8. Turn the trace off with

   ```js
   localStorage.removeItem("aorms.perfTrace");
   location.reload();
   ```

What each line means.

| Line                                              | Meaning                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `parse #N sent`                                   | the debounce fired. Its "+ms after last edit" is the debounce plus any timer delay           |
| `parse #N back`                                   | the worker's lex and parse, validate, serialize and queue times, then the UI thread's unpack |
| `react update (app)`                              | one React commit and its render time, printed when over 4 ms                                 |
| `diagnosticsToMarkers`, `setModelMarkers`         | marker conversion and Monaco's own marker update                                             |
| `squiggles painted`                               | the frame after the markers, the number the owner sees                                       |
| `preview #N sent, main thread serialize`          | the UI thread's copy of the tree to the preview worker                                       |
| `preview #N back`                                 | queue, generation and transfer of one preview                                                |
| `LONG TASK on main thread`                        | anything that blocked the UI thread for over 50 ms                                           |
| `first highlighted tokens computed` and `painted` | Monaco's first coloured lines, timed from the file open or the editor mount                  |

## 9. What was left in the code

- `src/perfTrace.ts`, new. Every function returns at once when the flag is off. Tested in `src/__tests__/perfTrace.test.ts`, which a mutant forcing the flag on turns red.
- Call sites in `useParsedDocument.ts`, `editor/parserWorker.ts`, `hooks/useDocument.ts`, `components/CodePane.tsx`, `usePreviewResult.ts` and `main.tsx`. With the flag off, the only change is three numbers added to each parse response, and `<React.Profiler>` is added only when the flag is on.
- The Chromium harness and the Node probes were throwaway and are not in the repo.
