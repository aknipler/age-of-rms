# Local History design (rev 6, 2026-11-02)

A history of every script the user saves, kept on their own machine. A History panel lists the saved versions of the open script, compares any two side by side, and restores an old one. Worked out from `CREATION_PLAN.md` Sec.A.3 and from `docs/community-maps-design.md` Sec.4.5, where the owner chose a hidden Git store in the app's data folder on 2026-10-28. Design only, nothing built. Sec.13 holds the questions for the owner.

**Revisions.** Rev 1 written 2026-10-28. Rev 3 the same day settles the last question, keeping notes optional and never prompted. Rev 4 the same day records spike H1 (`tools/history-spike/`). The store works through the Tauri plugin, the adapter's details are now known (Sec.3.2), and the panel reads its list from a small index per script rather than from Git's log, since walking the log costs about four plugin calls per snapshot (Sec.3.4). Rev 5 the same day records the rest of the spikes. H1 was run again with the window on screen, which settled its timings (Sec.3.4), H2 measured the bundle cost and H3 showed Monaco's diff editor working with the app's language and theme (Sec.11). Rev 2 the same day folds in the owner's answers. Every snapshot is kept, crash recovery is a separate later feature (`CREATION_PLAN.md` Sec.A.8), Save As shows the original's history behind a divider, and the panel is a pane over the editor. The owner also asked about saves that change only the header or changelog, which rev 1 skipped. They are now recorded, as their own kind of snapshot, since the header is the script's credit and documentation (Sec.4.1). Rev 6 (2026-11-02) takes in two decisions from slice 1's brief, both confirmed by the owner. Opening a known file whose map was changed in another editor records an `open` snapshot (Sec.4), and a file found by its map hash at a new path is reconnected only when its old path is gone, otherwise it is a copy with its own history (Sec.5).

Read `CLAUDE.md` first. The rules that bite here are "every interactive UI element wraps in HelpTip", the house language rule, and "business logic stays in TS" (the Rust side stays thin). The community maps design shares a core with this one (Sec.9), so read its Sec.4.2, 4.5 and 4.6 too.

## 1. The short answer

- **Every save to disk becomes a snapshot**, unless the only change is to the rows the app refreshes by itself (File, Last modified, AoRMS version). A save that changes only other header rows or the changelog is kept as a header-only snapshot, folded under the snapshot before it in the panel. Opening an untracked file, downloading a map from the catalog, restoring an old version and publishing also record one.
- **The store is a Git repository per script in the app's data folder**, written with `isomorphic-git`, a Git library in plain JavaScript. The user never sees Git, needs no account and installs nothing.
- **A History panel** over the editor lists the snapshots by day, with Compare (Monaco's diff editor), Restore and an optional note on each.
- **Restore never writes to disk.** It replaces the editor's text as one undoable edit, after first snapshotting the text it replaces, so a restore can always be undone.
- **History never gets in the way of saving.** The file is written first, and a history failure shows in the status bar and nothing else.
- **A script keeps its history when renamed or moved outside the app.** Opening it finds the history again by content, with the fingerprint the community catalog uses.
- **It feeds the community features.** A downloaded map's first snapshot records its catalog version, a publish marks the snapshot it sent, and the notes on the snapshots between them prefill the changelog.

## 2. Facts this rests on

| Fact                                                                                                                                                                                                            | Source                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The app writes a script in one place, `writeToPath` in `src/hooks/useDocument.ts`, after the header stamp or refresh, and already runs background work there that cannot fail the save (`rememberScriptFolder`) | `useDocument.ts`                                                                                                  |
| `isomorphic-git` needs a file system object with `readFile`, `writeFile`, `unlink`, `readdir`, `mkdir`, `rmdir`, `stat` and `lstat`, and accepts a promise-based one                                            | isomorphic-git.org/docs/en/fs, read 2026-10-28                                                                    |
| `isomorphic-git` has no `gc` or repack, and its `pack` command writes every object whole and compressed, with no deltas                                                                                         | Its command list and `src/commands/pack.js`, read 2026-10-28                                                      |
| A saved version therefore costs its compressed size. The median of 52 maps on disk is 5.3 KB compressed (48.5 KB raw), the 90th percentile 11.5 KB, the largest 21.8 KB                                         | Measured 2026-10-28 with zlib at level 6                                                                          |
| The app has `tauri-plugin-fs`, with permission today to read and write text files, write files and check existence, scoped to every path                                                                        | `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`                                                     |
| The Tauri plugins' JavaScript side talks to the host through the window, so it is not reachable from a web worker                                                                                               | How Tauri 2 injects its IPC bridge, also the reason `npm run dev` cannot render the app (`CLAUDE.md` Environment) |
| Monaco ships a diff editor                                                                                                                                                                                      | Monaco's API                                                                                                      |
| The community catalog's hash rule ignores the header and changelog comments, and its fingerprint survives a deleted header, renamed constants and edits                                                         | `community-maps-design.md` Sec.4.2 and Sec.4.6                                                                    |

## 3. The store

### 3.1 Layout

```
<app data>/history/
  index.json              script ID to last known path, last snapshot's map hash and fingerprint
  scripts/
    3f9c.../              one script, named by a random ID
      repo.git/           its bare Git repository
      snapshots.json      the panel's list of snapshots (Sec.3.4)
      HEAD, objects/, refs/, ...
```

**One repository per script, not one for all.** Deleting one script's history is deleting one folder. Two scripts saved at once never contend for one repository's lock. The cost is that two copies of one script store their shared versions twice, a few KB each.

**Bare repositories, plumbing commands only.** The app writes each snapshot with `writeBlob`, `writeTree`, `writeCommit` and `writeRef`, and reads with `log`, `readCommit` and `readBlob`. It never checks files out or uses Git's index, so it never needs the file timestamps and inode details that `stat` would have to fake through the Tauri plugin.

### 3.2 The file system adapter

A small module turns `@tauri-apps/plugin-fs` into the promise-based object `isomorphic-git` expects. Spike H1 (2026-10-28) settled its details.

- **Error codes.** The plugin's errors are plain strings carrying the Windows error number, and `isomorphic-git` checks Node-style codes, so the adapter maps them. `os error 3` and `os error 2` (a missing file, folder or parent) map to `ENOENT`, `os error 183` (already exists, from `mkdir`) to `EEXIST`, and `os error 145` (folder not empty) to `ENOTEMPTY`. The mapping is required, not cosmetic, since `isomorphic-git` creates nested folders by catching `ENOENT` and `EEXIST`.
- **`readlink` and `symlink`.** `isomorphic-git` binds both when it starts, though its docs call them optional. The adapter provides stubs that throw, since a store of one text file has no links.
- **`Buffer`.** `isomorphic-git` uses a global `Buffer`, which a webview lacks. The app depends on the `buffer` package and sets `globalThis.Buffer` before the first Git call.
- **Permissions.** The capability gains `fs:allow-read-file`, `fs:allow-read-dir`, `fs:allow-mkdir`, `fs:allow-remove`, `fs:allow-stat` and `fs:allow-lstat`, the set H1 ran with. Scoping them to `$APPDATA/history/**` rather than everywhere is safer, but the existing scope is `**`, so whether to narrow it is a separate decision.
- **New dependencies.** `isomorphic-git` and `buffer`, installed with `npm install` when slice 1 starts.

The history logic takes the adapter as a parameter. Tests pass Node's own `fs` on a temporary folder instead, so all of it runs under Vitest with no Tauri host.

### 3.3 What a snapshot holds

A commit whose tree has one file, `script.rms`, with the exact text written to disk, header and all, so Restore brings back exactly what was saved. The commit message is a short title and trailers.

```
Saved

kind: save
scope: header                     only on a header or changelog change (Sec.4.1)
map-hash: 9c1e...                 the community hash rule (community-maps-design Sec.4.2)
app-version: 0.9.0
path: C:\Users\...\Golden Swamp.rms
catalog: golden-swamp v2          only on a download, and on later snapshots descended from it
```

`kind` is one of `save`, `open`, `download`, `restore-from`, `before-restore` and `publish`. A publish also gets a Git tag, `published-v3`. The commit author is the name from Settings > General with a fixed placeholder email, since Git requires one, and nothing leaves the machine.

A user's note on a snapshot is a Git note (`addNote`, `readNote`), because a commit message cannot change after it is written and notes are added afterwards.

### 3.4 Cost, and the snapshot index

H1 counted the plugin calls each operation makes, which is the solid part of its result.

| Operation                              | Plugin calls         | Time, window on screen  |
| -------------------------------------- | -------------------- | ----------------------- |
| One snapshot (blob, tree, commit, ref) | about 24             | median 117 to 123 ms    |
| Walking the log                        | about 4 per snapshot | 200 ms for 20 snapshots |
| Reading one old version                | a few                | 36 to 40 ms             |
| One plugin round trip (`exists`)       | 1                    | median 5 to 10 ms       |
| One core round trip, no plugin         | 1                    | median 6 ms             |

The times are from a debug build (`npm run tauri dev`) with the window visible, focused and drawing at 60 frames a second throughout, which the spike now records itself. The time per snapshot did not grow with the map's size (a 42 KB and a 366 KB map took the same), so the cost is round trips, not work. A round trip with no plugin and no disk access costs about as much as one through the fs plugin, so nearly all of it is the bridge between the webview and Rust. A release build may well be faster, which is not measured.

The first H1 runs measured round trips of 12 to 63 ms and snapshots of 535 to 680 ms, about five times slower. The window was hidden then, and WebView2 slows a hidden page down. Timings taken from the app need the page's own visibility recorded beside them.

Two consequences follow.

- **The panel does not walk Git's log.** A script saved a thousand times would need about 4,000 plugin calls just to list. Each script's folder gets a `snapshots.json` beside its repository, one entry per snapshot with the commit ID, time, kind, scope, line counts, catalog version and note. Opening the panel is one read, and Compare or Restore reads the one version it needs. Git stays the source of truth, and a missing or damaged `snapshots.json` is rebuilt from the log once.
- **A snapshot stays in the background.** It never delays the save, as Sec.4 already says. At about 120 ms a snapshot is cheap enough that buffering its writes into one call is not needed.
- **The library loads on first use.** H2 found `isomorphic-git` and its helpers add about 184 KB to the bundle (Sec.11). The history module is loaded with a dynamic `import()` on the first snapshot, so Vite puts it in its own file and the app's startup does not pay for it.

## 4. When a snapshot is taken

| Moment                                                 | Kind                                  | Notes                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A save to disk                                         | `save`                                | After `writeTextFile` succeeds in `writeToPath`, not awaited. Skipped only when the text differs from the last snapshot in nothing but the app-refreshed header rows (Sec.4.1)                                    |
| Opening a file with no history                         | `open`                                | The baseline, so the first change after opening has something to compare with                                                                                                                                     |
| Opening a known file whose map changed outside the app | `open`                                | Settled 2026-11-02. An edit made in another editor becomes its own snapshot instead of folding into the next save's. A change to the header or changelog alone records nothing here, and the next save records it |
| Opening a map from the catalog                         | `download`                            | Records the catalog map and version (community-maps-design Sec.8.1)                                                                                                                                               |
| Restore                                                | `before-restore`, then `restore-from` | The text being replaced is snapshotted first, even when unsaved, so a restore is never a loss                                                                                                                     |
| Publish                                                | `publish` and a tag                   | Marks the exact text sent (community-maps-design Sec.6.4)                                                                                                                                                         |

Unsaved edits are not snapshotted on a timer. Monaco's undo covers a session, and crash recovery is a separate feature to be designed later (settled 2026-10-28, `CREATION_PLAN.md` Sec.A.8).

### 4.1 Header and changelog changes

The owner asked (2026-10-28) what should happen when a save changes the header's Created by or Edited by, or the changelog, without touching the map. Those rows are the script's credit and documentation, so losing them from history would be wrong, but a snapshot for every one of them would bury the map's real changes.

**Three tests, from cheapest.**

1. **Refresh only.** Blank the values of the rows the app rewrites on every save, File, Last modified and AoRMS version, in both the new text and the last snapshot's. If the two are then equal, nothing a person changed is new, and the save is skipped. This is what rev 1's skip was for, and it now catches only this case.
2. **Header or changelog only.** Otherwise, if the map hash (community-maps-design Sec.4.2, which leaves out the header and changelog blocks) equals the last snapshot's, the change is to the paperwork. A snapshot is taken with the trailer `scope: header`.
3. **Anything else** is an ordinary snapshot. That includes comments inside the script, which the map hash counts.

**Why not overwrite the previous snapshot instead.** A snapshot may already be compared against, restored from, tagged as published or recorded as a download, and replacing it would make those point at text that no longer exists. A Git commit cannot be edited in place anyway, only replaced by rewriting the chain after it. A header-only snapshot costs about the same 5 KB as any other, and Q1 keeps every snapshot.

**In the panel** a header-only snapshot folds under the snapshot before it, as "Header or changelog changed", so the list reads as a list of map changes. Unfolding shows it like any other row, with Compare and Restore.

**In the catalog** the same change is not a new version, since the relay refuses an upload whose map hash equals its parent (community-maps-design Sec.6.3). The catalog rewrites the header and changelog from its own record at each upload, so nothing is lost there either.

Writes to one repository go through a queue, one at a time, so two quick saves never race for its lock.

## 5. Which history belongs to which file

`index.json` maps each script ID to the path it was last saved at, its last map hash and its last fingerprint.

- **Saved or opened at a known path.** The ID for that path.
- **Save As inside the app.** A new script with its own history, whose first snapshot records the ID and commit it was copied from in a `copied-from` trailer, so the panel shows the earlier history behind a divider (settled 2026-10-28).
- **A path the index has never seen**, a file renamed or moved outside the app for example. The app compares the file's map hash with every script's last snapshot. An exact match reconnects silently, since the content is the same, but only when the matched script's last known path no longer exists on disk (settled 2026-11-02). When it still exists, the file is a copy made outside the app, and it starts its own history with a `copied-from` trailer, the same as a Save As, while the original keeps its history. Among several matches the one with the newest snapshot is used. With no exact match, a fingerprint containment of at least 0.6 (community-maps-design Sec.4.6) offers "This looks like the history of Golden Swamp.rms. Connect it?" in the History panel. Declining starts a fresh history.
- **A file deleted outside the app.** Its history stays until the user deletes it from Settings (Sec.8).

## 6. The History panel

Opened from File > History and from a button in the status bar. A pane over the editor area, as the Community pane is, since Compare needs the width (settled 2026-10-28).

- **The list**, read from `snapshots.json` (Sec.3.4), newest first, grouped by day. Each row shows the time, the kind as an icon, the note if any, and lines added and removed against the snapshot before it. A publish shows its tag, a download its catalog version. Header-only snapshots fold under the row before them (Sec.4.1).
- **Compare.** Selecting one row compares it with the current editor text. Selecting two compares them with each other. Both use Monaco's diff editor, read only. It shows the two versions side by side when the pane is at least 900 px wide and one column with removed lines above added ones when it is narrower, which is Monaco's default (H3). The app's default window is 800 px wide, so a user sees the one-column view until they widen it.
- **Restore.** Replaces the editor's text with the selected snapshot as one undoable edit and marks the document dirty. Nothing is written to disk until the user saves.
- **Copy as new file.** Opens the snapshot as an unsaved buffer, for keeping an old version beside the current one.
- **Note.** An editable note on any row, optional, and never asked for on save (settled 2026-10-28).
- **Connect.** The offer of Sec.5 when a moved file was found by content.

The Breakdown tab needs nothing of its own. Restore is a text edit, and Breakdown re-renders from the text as it does for any edit.

## 7. Failure rules

- The save to disk comes first and does not wait for history. A history failure never fails a save, never opens a dialog, and shows once in the status bar as "Could not record this version in history" with the reason in a tooltip.
- A repository that cannot be read is renamed aside as `<id>.broken` and a fresh one started, so one damaged repository never stops history for that script for good. The panel says so.
- History never sends anything anywhere, and the bug report never includes it.

## 8. Storage and settings

At about 5 KB a save, a script saved a thousand times takes about 5 MB. Every snapshot is kept and nothing is pruned (settled 2026-10-28).

Settings gets a History section.

- A switch to turn history off. Off stops new snapshots and keeps existing ones.
- The space history uses, in total.
- Delete history for one script, picked from a list, and Delete all history, each behind a confirmation through `@tauri-apps/plugin-dialog`.

## 9. Shared with community maps

Built once and used by both (community-maps-design Sec.4.5, Sec.12's shared core).

- `mapHash.ts`, the hash rule that ignores the header and changelog. Here it tells a header-only snapshot from a map change (Sec.4.1) and reconnects moved files.
- `fingerprint.ts`, the content fingerprint. Here it offers to connect a moved file's history.
- The version record, `{ hash, parent, date, by, changes }`. A snapshot's `changes` are the lines of its note. A snapshot and a catalog version are both one of these, which is what lets the publish dialog read its parent version and changelog prefill straight from history. The parent is the newest snapshot in this script's history carrying a `catalog` trailer or a `published-v*` tag. The prefill is the notes on the snapshots after it.
- The diff view. The History panel's Compare and the Community pane's Compare are one component.

## 10. Draft HelpTips

| Control          | Tip                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| History button   | Every version of this script you have saved, kept on this computer only                                                 |
| Compare          | Shows what changed, side by side. Pick one version to compare with your current text, or two to compare with each other |
| Restore          | Puts this version's text in the editor. Your current text is kept in history first, and nothing is saved until you save |
| Copy as new file | Opens this version as a separate unsaved file                                                                           |
| Note             | Your own label for this version. Notes are offered as changelog lines when you publish                                  |
| Connect          | Links this file to history found under another name, after it was renamed or moved                                      |
| History switch   | Turns off recording new versions. Existing history is kept                                                              |
| Delete history   | Removes the saved versions of a script from this computer. The script itself is not touched                             |

## 11. Spikes and slices

| Spike | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gates |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| H1    | `isomorphic-git` over the Tauri fs adapter. **Done 2026-10-28**, run again the same day with the window on screen. Results in Sec.3.2 and Sec.3.4 and `tools/history-spike/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Done  |
| H2    | How much `isomorphic-git` adds to the app's bundle, with only the commands this design uses. **Done 2026-10-28.** 184 KB minified and 59 KB gzipped, against 271 KB for the whole library. Of that, `isomorphic-git` is 71 KB, `pako` (zlib) 46 KB, `buffer` 25 KB, and small shims the rest. The app's main bundle is about 4.1 MB, so this adds about 4 percent, loaded on first use (Sec.3.4)                                                                                                                                                                                                                                                                                             | Done  |
| H3    | Monaco's diff editor inside the app's existing Monaco setup, theme and language, both light and dark. **Done 2026-10-28.** It works with no changes to the setup. The `aoe2-rms` colouring shows on both sides and follows the light and dark themes, since Monaco has one theme for the whole page. The diff runs in the existing editor worker, 49 to 83 ms on a 366 KB map and on Menindee v2.3 against v2.5, with the page never blocked for more than 47 ms. Side by side from 900 px wide, one column below (Sec.6). In dark mode a light strip showed at the right edge, most likely the spike's white page showing through, so the pane should set its own background from the theme | Done  |

- **Slice 1, recording.** The adapter, the store, snapshots on save, open and restore, the skip rule, the per-repository queue, `index.json`, `snapshots.json` and reconnecting moved files by exact hash. No panel yet, so it is checked through tests and a Settings readout of snapshot counts. Needs `mapHash.ts` from the shared core. Its work brief is `docs/local-history-slice-1-brief.md` (2026-11-02), on the `community-maps` branch since `mapHash.ts` is only there, with no owner questions open.
- **Slice 2, the panel.** The list, Compare, Restore, Copy as new file, notes, and the Settings section. Needs the shared diff view.
- **Slice 3, community links.** The `download` and `publish` kinds, the parent and changelog prefill for the publish dialog, and connecting moved files by fingerprint. Lands with community slices A and B and needs `fingerprint.ts`.

Each slice gets a run sheet section in `manual-test-run-sheet.md` once built.

## 12. Alternatives considered

- **An own snapshot store (option A of community-maps-design Sec.4.5).** Same storage cost and the same panel. The owner chose Git for its standard format and the easy later path to a backup on GitHub.
- **Git visible beside the script (option C).** Puts a `.git` folder in the user's or the game's folder, and mixes the app's commits into any repository the user already keeps there.
- **`git2` in Rust (libgit2).** Packs with deltas, so storage could be smaller, but puts the history logic on the Rust side against the thin-Rust rule, for a saving of a few MB per thousand saves.
- **One repository for every script.** Shares identical versions between copies, but one lock for everything and no simple way to delete one script's history.
- **The Git index and working tree.** The normal way to use Git, but needs real file timestamps and metadata through the plugin, which plumbing commands avoid.
- **Snapshotting on a timer.** Records unsaved work, but fills history with half-typed states, and crash recovery is better served by its own feature.

## 13. Open questions

Settled 2026-10-28. Every snapshot is kept, with the delete buttons of Sec.8. Unsaved work is not snapshotted, and crash recovery is a separate feature for later (`CREATION_PLAN.md` Sec.A.8). Save As starts a new history that shows the original's behind a divider. The panel is a pane over the editor. Saves that change only the header or changelog are kept as header-only snapshots (Sec.4.1).

Notes stay, optional and never prompted (settled 2026-10-28). A note is a short label typed on a History row, and the notes made since the last published version are offered as changelog lines when publishing.

Settled 2026-11-02 from slice 1's brief. Opening a known file whose map changed outside the app records an `open` snapshot (Sec.4). A hash match at a new path reconnects only when the old path is gone, otherwise it is a copy (Sec.5).

No owner questions are open. Spikes H1 to H3 are done, so nothing gates slice 1.
