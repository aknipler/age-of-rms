# Source Languages in the Code Tab — Design (rev 1, draft for discussion)

**Status: proposal, nothing implemented, and scheduled AFTER M6.** External tools ship first and this feature inherits their pack machinery — see Sec.11, where that ordering is a decision with consequences rather than a sequencing accident. This covers PLAN.md's "Later" line item — *"multi-language dropdown in Code tab"* — and the Code-tab bullet it comes from: *"language dropdown (AoE2 RMS default; other languages later for tool authors)."* It is written after the Advanced Tools API (`docs/tools-api-design.md`), reuses that document's trust and transport reasoning wherever the shape is the same, and departs from it where a compiler is not a tool.

**Every repo claim here is dated 2026-08-29 — re-derive before acting on it.** `docs/tools-api-design.md` Sec.10.2's standing instruction applies to this document too, and for the same measured reason.

## 1. What the user asked for, and the short answer

Community projects already compile other languages to RMS: **python-aoe2rms** (Antoine Roll) and **aoe2-rms** (Erbenos, Racket). The ask is that the Code tab let you write in one of those instead of RMS, with a button to see the generated code, Overleaf-style.

Three answers up front, because the rest of the document is the consequences of them:

1. **Two files, and neither of them is a `.aorms`.** The source keeps its language's own extension (`.py`, `.rkt`); the build description lives in the **header comment of the generated `.rms`**, which the app already stamps. No sidecar, no third file, and the artifact is self-describing. Sec.4 has the format, the open-a-file decision table, and the two alternatives this replaced (a JSON sidecar, and `.aorms` as the source text itself).
2. **Yes to the generated-code button**, and the honest version of it costs more than a button: a generated document is one the app must stop writing to. Sec.3.2 is that inventory.
3. **The app never learns Python or Racket.** It learns to run *a language pack* — a manifest describing an already-installed community toolchain. The pack contract (Sec.5) is the deliverable; the two reference packs are contributions, not app code, exactly as tools v1.1 intends for tools.

## 2. Goals and non-goals

**Goals**

1. A user can open a map whose source is Python (or Racket, or anything a pack describes), edit it in the Code tab with syntax highlighting, press Build, and get a `.rms` the game can load.
2. A user can see the generated RMS at any time, beside or instead of their source, and it is obvious when what they are looking at is out of date.
3. Everything the app already does to an RMS script — preview, Breakdown explanation, resource totals, diagnostics, Advanced Tools — keeps working **on the generated output**, without those subsystems learning that source languages exist.
4. Adding a language is authoring a manifest and installing a toolchain. No app release, no app code, no PR to this repo.
5. A shared map project cannot execute anything on the machine that opens it.

**Non-goals (v1 of this feature)**

- Bundling Python, Racket, or any other runtime. The user installs the toolchain; the app finds and runs it.
- Multi-file source projects with an in-app file tree. One entry file is editable in the app; helper modules beside it are compiled but edited elsewhere (Sec.6.6).
- Editing the generated RMS. It is a build artifact (Sec.3.2).
- Mapping RMS diagnostics back onto source lines without a source map. Designed for, not required, not faked (Sec.7).
- A package manager. Installing a pack is unzipping a folder plus a consent dialog (Sec.9).

## 3. Document modes

### 3.1 The generated RMS keeps the existing model slot

`src/hooks/useDocument.ts` creates one Monaco `ITextModel` at module scope, `inmemory://model/document.rms`, language `aoe2-rms`, and every consumer in the app hangs off it: `App.tsx` calls `useParsedDocument(doc.content, playerCount)`, Breakdown patches it through `applyTextEdits`, the preview and status-bar totals derive from that parse, Advanced Tools reads the same `source`/`parseResult` and applies edits back through the same call.

**So the compiled RMS goes into that model, and nothing downstream changes.** The source gets a *second* model, `inmemory://model/source.<ext>`, in whatever Monaco language the pack declares. This is the whole architectural trick and it is worth stating as a rule:

> The RMS document model is the app's map. In RMS mode the user types into it. In generated mode a build fills it. Nothing else about the app knows the difference.

The alternative — teach Breakdown, preview, totals, tools and diagnostics to ask "which text am I looking at?" — spreads a mode flag across five subsystems that have no business holding one.

```
              RMS mode                        Generated mode

  disk   mapname.rms                     mapname.py      (source, edited)
              |                          mapname.rms     (artifact + build banner)
              v                                |  ^
  models  document.rms  <-- typed              |  | build
              |                          source.py --+   <-- typed
              |                                v
              |                          document.rms    <-- filled, read-only
              v                                v
        parse -> preview / breakdown / totals / tools / diagnostics   (identical)
```

`DocumentMode = "rms" | "generated"` lives beside `filePath` in `useDocument`. **`"rms"` must be behaviourally identical to today** — that is the acceptance bar for Phase A, and the reason mode is a property of the open document rather than an app-wide setting.

### 3.2 A generated document is read-only, and here is every write path

The locked decision in PLAN.md is *"Source of truth: Code."* It still holds; "Code" now means *the source you wrote*. The artifact is not a place to type. Every path that writes into the document model has to be found and gated, and there are more than one expects:

| Write path | Where | Generated mode |
|---|---|---|
| Typing in the Code editor | `CodePane.tsx` `<Editor>` | Generated pane is `readOnly`; typing happens in the source editor |
| Breakdown value editors / add / delete | `src/breakdown/applyEdit.ts` -> `applyTextEdit` | Cards render, editors disabled, HelpTip says why |
| Advanced Tools Apply (`edit-source`) | `tools/host.ts` -> `applyTextEdits` | Apply disabled; the run still produces its report |
| Toggle command layout (Ctrl+Alt+F) | `CodePane.tsx` -> `toggleCommandLayoutInRange` | No-op in the generated pane |
| Script Formatter built-in | `tools/builtin/scriptFormatter.ts` | Same as any `edit-source` tool |
| **The script header stamp** | `useDocument.ts` `stampHeader` | Retargeted — see below; not a simple disable |
| Undo/redo (window-level listener) | `useDocument.ts` | Routes to the focused model; the generated model has no user edits to undo |

**The header stamp is the interesting one.** Today it deliberately edits the *model* rather than the bytes on the way to disk, so the comment is real, visible and undoable. In generated mode that is exactly wrong: an edit to the artifact is erased by the next build, and stamping the *source* would inject an RMS comment into a Python file. So in generated mode the stamp becomes a **write-time prepend on the output only**, with different content — the app's own banner:

```
/* Generated by Age of RMS 0.x from mapname.py (python-aoe2rms 0.1.0)
   on 2026-08-29. Do not edit — this file is overwritten on every build. */
```

Author, created date and the rest belong in the source file, where the pack's own conventions put them, and the app does not touch them. This banner is also where the build record lives — Sec.4.1.

`stampHeader`'s two pieces of state go unused in generated mode, and that is deliberate rather than an oversight. `hasHeaderRef` answers "should one be added?" and `stampedHeaderRef` answers "may this row be rewritten?", and both exist because a *user* may edit a header the app wrote. Nobody edits a generated banner: it is rewritten wholesale on every build, and a user who wants it gone uses Detach (Sec.4.2), which removes the association rather than the comment. Wiring the ownership machinery to it would be answering a question that cannot be asked.

**Read paths are untouched and that is the point.** Running the Generation Consistency Checker over the RMS your Python produced is one of the better arguments for this whole feature: same flagship tool, same generated text, no tool-side change.

### 3.3 Saving, and what "dirty" means with two models

Sec.3.2 is the inventory of what may *write* to the models. This is the inventory of what happens around **saving** them, and it is the other half of the same job — `useDocument` currently owns one model, one path, one dirty flag and one unsaved-work guard, and every one of those is singular in a way generated mode breaks.

**Dirty is the source's dirty, and only the source's.** Today it is `documentModel.getAlternativeVersionId() !== savedVersionIdRef.current`, which is the right mechanism and the wrong model: the generated document has no user edits, so its version id moves only when a build fills it, and treating that as unsaved work would prompt to save an artifact the app wrote itself. In generated mode `savedVersionIdRef` tracks the **source** model, and the generated model contributes nothing to dirty at all. Its own "is the file on disk current?" question is a different one with a different answer, and Sec.6.5 already answers it: staleness, not dirtiness.

Consequences for the three callers, none of which is a judgment call once the rule above is fixed:

- **`ensureSavedBefore`** — the shared guard behind Open and window-close — saves the *source*. Its Save As fallback picks a source path, with the pack's own extension in the filter rather than `.rms`.
- **`writeToPath`** writes the source, then builds if build-on-save is on. A build that fails must not fail the save: the file is on disk, and the Build Output panel is where the failure is reported. Saving and building are two outcomes and the status bar shows both.
- **`openFile` / `newFile`** reset the source model with `setValue` for the existing reason (a new document starts a new undo history) and must reset the generated model too, or the previous map's preview, totals and diagnostics survive into a document that has not been built yet.

**Save As moves the whole project, and the old artifact stays put.** Saving `Sacred Springs.py` as `Winter Springs.py` writes a new source file, and the next build writes `Winter Springs.rms` beside it, because the output path is derived from the source name rather than carried in the banner as an absolute. `Sacred Springs.rms` is left exactly where it was — deleting a playable map the user did not ask about is not something a Save As should do, and its banner still points at a source file that still exists.

## 4. Files on disk

### 4.1 Two files, and the build description rides in the `.rms` header

| File | Role | Written by |
|---|---|---|
| `Sacred Springs.py` | The source. **Native extension of the pack's language.** | The user (in the Code tab or any editor) |
| `Sacred Springs.rms` | Build artifact **and** the record of how it was built. | Build |

The app already stamps a comment at the top of every script it writes (`src/hooks/scriptHeader.ts`), so the generated file's banner carries a few machine-readable rows and there is no third file:

```
/* Age of RMS — generated file, do not edit.
   Edits here are overwritten by the next build.

   aorms-pack: python-aoe2rms 0.1.0
   aorms-entry: Sacred Springs.py
   aorms-built: 2026-08-29T11:04:00Z
   aorms-source-sha256: 3f2a9c...
*/
```

Rules that keep this from becoming a guessing game:

- **Only the first comment block is scanned**, only `aorms-*` keys are read, and every path is relative to the `.rms`. A missing or malformed `aorms-pack` or `aorms-entry` means *no association* — the file is a plain RMS script. The parser never repairs, never guesses.
- **The banner is prepended once, to one string**, which then fills both the model and the file. The generated pane shows exactly the bytes on disk, so generated diagnostics' offsets are true in both.
- **Nothing in the banner can name an executable.** It names a pack id and a version, same as the sidecar it replaces; Sec.5.3 is why that is the security property and not tidiness.

`File > Open` keeps its `.rms` filter and gains the pack source extensions (`useDocument.ts`'s `RMS_FILTERS` is `.rms`-only today). Opening a `.py`/`.rkt` directly, before any build exists, asks which pack to use; that answer is remembered in the settings store keyed by source path — an MRU entry beside `LAST_SCRIPT_FOLDER_KEY`, not a file — so it survives a restart even before the first successful build.

### 4.2 What the app does when you open a file

| Opened file | Source beside it | Pack installed | Mode |
|---|---|---|---|
| `.rms`, no banner | — | — | **RMS mode.** Today's behaviour, unchanged |
| `.rms` with banner | yes | yes | **Generated mode.** Loads the source, offers Build |
| `.rms` with banner | yes | **no** | **Generated mode, read-only.** Preview, Breakdown, read-only tools all work; Build is disabled and points at the pack's homepage |
| `.rms` with banner | **no** | — | **RMS mode**, with a notice naming the source file it expects |
| `.py` / `.rkt` | (is the source) | yes | **Generated mode**, unbuilt |

The third row is the good outcome of putting the record in the artifact: someone who downloads a map built from Python, without Python, still gets a playable, previewable, checkable map and an explanation of where it came from.

**Detach** is the escape hatch for the one hazard this creates: a generated `.rms` that somebody wants to hand-edit anyway. Detaching strips the banner in a single undoable edit and the document becomes an ordinary hand-written script. Without it, the read-only rule would be a wall rather than a default — and the alternative, silently allowing edits that the next build erases, is precisely the quiet data loss this design exists to avoid.

### 4.3 What this costs, stated plainly

**If the `.rms` is gitignored, the association is not in version control.** A developer-minded author who treats the `.rms` as a build product and ignores it has a repo containing `map.py` and no record of which pack builds it. The local MRU covers their own machine, and committing the artifact — which for an AoE2 map is the deliverable, not an intermediate — covers the rest. This is the real price of the two-file layout, and it is worth paying for the tidiness; the sidecar remains available later as an optional override without breaking anything, since a sidecar and a banner say the same thing.

**Config in the artifact does not scale.** A comment is a fine place for four keys and a bad place for forty. If per-project build configuration ever grows (output overrides, pack parameters), that is the moment to revisit — and the banner still holds the pointer that finds the sidecar.

### 4.4 Why the source is not itself a `.aorms` file

The other shape considered — one `.aorms` file holding the source, compiled to `.rms` — is tidier-looking still, and it breaks the thing that makes this feature cheap: **the community toolchain has to keep working on the file.**

- `python-aoe2rms` is an ordinary Python library. `python "map.aorms"` runs, but the moment a map is split across two files, `import helpers` fails on a non-`.py` module — Python's import machinery is extension-bound. `.aorms` also loses every editor, formatter, type checker and traceback that keys on `.py`.
- `aoe2-rms` is a `#lang`. `raco`, the package system and DrRacket all expect `.rkt`.
- The deeper objection: **`.aorms` as a source extension is a claim that AoRMS has a source language.** It does not, and the entire premise of this feature is that the language is pluggable. An extension whose contents are Python in one project and Racket in the next tells a reader nothing.

The "front-matter" variant (`#!aorms python-aoe2rms` on line 1 of a `.aorms` file, app extracts the body to a temp `.py` to build) was considered and rejected: it breaks relative imports and `__file__`, shifts every traceback line number, and means the user cannot run their own map outside the app — which is the one thing an existing community toolchain is *for*.

### 4.5 Sharing

Source + `.rms` in a zip is a complete, runnable share, and the `.rms` alone is a degraded but useful one: the recipient's app reads the banner, sees `python-aoe2rms` is not installed, offers the pack's homepage, and **meanwhile the map is already playable**. That last clause is worth engineering for — it is why Build writes a real file next to the source rather than a cache entry, and it is most of the argument for the banner over a sidecar, since a sidecar is the file people forget to include.

## 5. The language pack contract

New folder `languages-api/`, mirroring `tools-api/`: shared types, no React/Monaco/Tauri runtime imports, published so pack authors compile against it. A pack is **data plus a toolchain the user already has**; unlike a tool it ships no code that we run in-process.

### 5.1 Manifest

```jsonc
{
  "id": "python-aoe2rms",              // stable, kebab-case
  "name": "Python (python-aoe2rms)",
  "version": "0.1.0",
  "apiVersion": 1,                     // must equal LANGUAGES_API_VERSION
  "homepage": "https://github.com/AntoineRoll/python-aoe2rms",
  "source": {
    "extension": "py",
    "editorLanguage": "python"         // a Monaco built-in id, or see Sec.5.4
  },
  "runtime": {
    "id": "python",                    // a key in the app's Runtimes settings — NOT a path
    "minVersion": "3.11",
    "versionArgs": ["--version"],
    "versionPattern": "Python (\\d+\\.\\d+\\.\\d+)"
  },
  "build": {
    "args": ["-m", "aoe2rms", "build", "${entry}", "-o", "${outPath}"],
    "cwd": "sourceDir",
    "output": { "strategy": "file" },
    "timeoutMs": 30000
  },
  "diagnostics": { "parser": "pythonTraceback" }
}
```

Substitution is a **closed set of three tokens** (`${entry}`, `${outPath}`, `${sourceDir}`), all resolved host-side to absolute paths inside the source file's own directory. Anything else in `args` is a literal. Manifests are validated at registration, not at run — the same discipline as `src/tools/registry.ts`, and for the same reason: a pack that cannot possibly build should fail visibly when it is installed, not the first time somebody presses Build.

### 5.2 Output strategies, and why there are three

This is where the two reference projects genuinely disagree, and the contract has to be wide enough for both without becoming "run any shell command".

| Strategy | Host behaviour | Fits |
|---|---|---|
| `stdout` | Capture stdout, treat it as the RMS text | `racket map.rkt` |
| `file` | Pass `${outPath}` into `args`/`env`, read that file after a zero exit | `racket map.rkt -d out.rms`; `python -m aoe2rms build map.py -o out.rms` once Appendix B lands |
| `newestRmsIn` | Snapshot `*.rms` mtimes in `dir` before the run; after a zero exit take the one file that is new or newer | python-aoe2rms **before** Appendix B; any library-only pack |

`file` is the strategy every pack should reach for, and the reason the third one exists is that `python-aoe2rms` has no CLI today: its API is `my_map.save_to_file("my_map.rms")`, so **the script chooses its own output path and nothing on the command line can override it** (verified 2026-08-29). Appendix B is the upstream fix — a ~60-line CLI over the `Map.compile()` method the library already has — after which the Python pack uses `file` like everything else.

`newestRmsIn` stays in the contract regardless, because it is what any *other* library-shaped project will need on day one, and it is what lets the Python pack work against released versions. Its failure mode is named rather than guessed at: if zero files changed, or more than one did, the build **fails with "could not tell which file your script wrote"** and the Build Output panel lists the candidates. It does not pick one. A silent wrong pick would put a stale map into the preview and the consistency checker, which is the precise class of quiet failure `docs/tools-api-design.md` keeps flagging.

`env` is available alongside `args` for the middle case: a pack can document `map.save_to_file(os.environ["AORMS_OUT"])` and get the `file` strategy's precision out of a library with no CLI, at the cost of a convention the user must follow.

### 5.3 The manifest names a runtime, never an executable

`runtime.id` is a key (`python`, `racket`) that the app resolves through a new **Settings > Runtimes** panel: probe `PATH`, show the discovered path and version, let the user point at another. The resolved absolute path lives in app settings, never in a pack manifest and never in a generated file's banner.

Two holes this closes:

1. **Opening a shared map cannot execute anything.** A banner can only name a pack id; if the pack is absent nothing runs, and if it is present the command line comes from the locally installed manifest the user consented to.
2. **The webview never hands an executable path to the Rust side.** See Sec.6.2.

The version check is not decoration: python-aoe2rms requires **Python 3.11+**, and the failure on 3.10 is a syntax error inside a library the user did not write. Reporting "this pack needs Python 3.11+, you have 3.10.4" before running is the difference between a two-minute fix and a bug report.

### 5.4 Highlighting

`monaco-editor`'s `editor.main.js` imports `../basic-languages/monaco.contribution` (verified 2026-08-29), and `python/` and `scheme/` are both in `node_modules/monaco-editor/esm/vs/basic-languages/`. **Both reference languages already highlight, with no new dependency and no change to `src/editor/monacoSetup.ts`.** A pack that wants something Monaco does not ship declares `editorLanguage: { monarch: { ... } }` — a Monarch tokenizer is plain JSON, so this stays inside the tools-API principle that extensions are *data the app renders*, not code the app executes. No pack ever supplies JavaScript.

## 6. Building

### 6.1 When

**Never on a keystroke, and this is not a performance decision.** A build executes the user's half-written program with full OS access; a debounce would run it hundreds of times per session, and a map generator that writes files or hits the network would do so hundreds of times. So:

- Explicit **Build** — new hotkey `buildScript`, default **Ctrl+Alt+B**. Left-hand reachable per `src/settings/hotkeys.ts`'s stated principle, and in the `Ctrl+Alt` namespace the Preview and Breakdown actions already use.
- **Build on save**, a setting, default on. Ctrl+S in generated mode writes the source, then builds.
- Never anywhere else. Opening a project does **not** build: it loads the `.rms` already on disk and marks it stale if the hash disagrees (Sec.6.5).

### 6.2 Where the process runs

There is **no process-spawn capability in the app today** — `src-tauri/Cargo.toml` carries `opener`, `dialog`, `fs`, `store`, `process` and `updater`, and `capabilities/default.json` grants `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-exists` and `core:window` bits (verified 2026-08-29). This feature is the first thing in the app that needs to run another program, and how is the security-critical decision in this document.

**Decided: a bespoke Rust command, not `tauri-plugin-shell`.**

`tauri-plugin-shell` gates execution with a scope declared statically in `capabilities/*.json` at build time. Our command line is assembled at run time from a pack the user installed after we shipped, so a static scope is either unable to express it or permissive enough that the app has handed its own webview a general "execute a program" primitive. That is a far larger blast radius than the feature needs.

Instead: `#[tauri::command] build_script(project_path, pack_id) -> BuildResult`. The **Rust side** reads the installed pack manifest, resolves the runtime from the settings store, performs the token substitution, refuses any path outside the project directory, and spawns with an argument array (never a shell string). The webview passes two strings and can name neither an executable nor an argument. Policy lives on the side of the boundary that has the authority.

### 6.3 Watchdog, cancellation, concurrency

Straight adoption of the Advanced Tools pins, which were argued once already:

- **One build at a time, app-wide.** A second Build while one runs is refused, not queued.
- **Hard timeout**, `build.timeoutMs`, default 30 s, ceiling enforced host-side. On expiry the child is killed and the failure says so — an infinite loop in a map generator is a normal beginner mistake, not an exceptional one.
- **Cancel** kills the process group. A generator that spawns children (Racket places, Python multiprocessing) must not leave orphans.
- Output is capped (1 MB of RMS text, 256 KB of stderr) with the overflow reported rather than truncated silently.
- **Line endings are normalised to `\n` on the way into the model**, whatever the compiler emitted. A Python script on Windows writing `\r\n` is the ordinary case, and this app's parser, diagnostics, Breakdown spans and tool edits are all character-offset based, so a stray `\r` per line shifts every offset in the file against a source the pack thinks it produced. Normalise once, at the boundary, rather than in each consumer.

**A build and a tool run are two locks, and the relationship between them has to be stated.** Advanced Tools already enforces one run at a time app-wide (`ToolHost.start()` throws on `isBusy()`), and Sec.6.3 adds one build at a time. They are separate locks over one shared resource — the document model — and the interesting case is a build finishing *during* a checker run that may last half an hour. The tools contract has already decided this in general terms: Sec.4.3's staleness guard says a run whose document has changed underneath it is producing a report about text that no longer exists. **A build is a document change, so it invalidates a running tool the same way an edit does**, and the app should refuse to start a build while a tool is running rather than cancel the run out from under the user. Refusing is the cheaper direction: a build takes seconds and can wait, a Monte Carlo run cannot be resumed.

### 6.4 Build Output

A collapsible panel at the bottom of the Code tab: exit code, wall time, resolved command (so "why did it use *that* Python?" is answerable), then **stderr verbatim**. The rule is `docs/tools-api-design.md`'s in spirit — **the panel is ground truth and is never filtered**; parsed diagnostics (Sec.7) are a convenience layered on top, never a replacement.

### 6.5 Staleness must be visible everywhere, not just in the Code tab

`aorms-source-sha256` (Sec.4.1) hashes the source text together with the pack id and version. When the live source hashes differently, the generated document is **stale**, and stale is dangerous in a way an out-of-date editor tab is not: the preview, the resource totals and the consistency checker all keep happily reporting on the *old* map. A user tuning `land_percent` in Python and watching the preview not move would be watching a lie.

So the build state is a **status-bar chip** — the status bar is the one surface visible from all three tabs — reading `Built` / `Stale` / `Building...` / `Failed`, clickable to build, with the generated pane carrying its own banner. Preview and Breakdown do not each grow their own indicator; one chip, always on screen.

### 6.6 Multi-file projects

The pack runs in the project directory, so `import helpers` and `(require "helpers.rkt")` work — **multi-file maps build correctly from day one.** What is missing is in-app editing of the second file: the Code tab has one source model. Helpers are edited in any editor and picked up on the next build. Stated as a limitation rather than solved, because the honest fix is a file tree and that is its own phase. Note the consequence for the staleness hash: hashing only the entry file means editing a helper does not mark the build stale, so v1 also folds in the mtimes of every `*.<ext>` beside the source. Crude, cheap, and wrong only in the safe direction (over-reporting stale).

### 6.7 Build history and rollback

A build that succeeds and produces a *worse map* is the normal case in map scripting, and "put it back the way it was five minutes ago" is a real need. It does not need a version control system, and building on git would be wrong here: git may not be installed, the map may not be in a repo, and a large share of RMS authors are not developers. What it needs is a snapshot on every build.

**On every build, successful or not, the app writes a history entry** to its own app data dir — never beside the source, so it can never pollute somebody's repo or their `Random Map Scripts` folder:

```
{ timestamp, packId, packVersion, sourceText, generatedText | null,
  sourceSha256, exitCode, stderrTail }
```

Keyed by a hash of the source's absolute path; capped at **20 successful builds and the 5 most recent failures**, or 5 MB per project, whichever binds first. Map scripts are small text, so this is free.

The **History** control sits beside Build, and each entry offers exactly two actions, which are deliberately different in kind:

- **Compare** loads that entry's generated RMS into the Generated pane, read-only, marked as historical, so the preview and the consistency checker can be pointed at the old map without touching the working document. Nothing is written.
- **Restore source** replaces the source model's contents with that entry's source, **as one edit on Monaco's own undo stack** — not a file overwrite. Ctrl+Z takes it back, and the file on disk only changes when the user saves, exactly like every other edit in the app. This follows the same rule Breakdown and the tools Apply path already follow, and for the same reason.

Restoring generated output *without* its source is deliberately not offered: it would produce a `.rms` that no longer corresponds to the source beside it, with a banner hash that says so, and the next build would silently wipe it. The two things move together or not at all.

**A failed build never overwrites the last good `.rms`.** That is what makes the everyday case need no history at all — the playable map is still sitting there, and the app says the build failed rather than pretending. History covers the harder case, which is a build that *worked* and was worse. (This resolves what was open question 1.)

Failures are recorded with their stderr because the useful question after a broken build is "what did I change since the last one that worked", and the answer is a diff between two history entries the app is already holding.

## 7. Diagnostics, and the source-map problem

**The split in one line: the source pane gets syntax highlighting and build errors; the generated pane gets everything the app knows about RMS.** That asymmetry is not a shortfall to be apologised for later — it is what the app is. Every semantic check it owns (undefined actor areas, `land_percent` over-allocation, terrain restrictions, the consistency checker) is a statement about an RMS script, and the source is not one. The app runs no Python or Racket language server and should not pretend to: a user who wants real editor intelligence for their Python opens the same `.py` in VS Code, which is available to them precisely because Sec.4.4 kept the native extension.

Beyond that, two unrelated kinds of error, and conflating them is the trap.

**Kind 1 — the build failed.** Python traceback, Racket error, nonzero exit. These are *about the source*, and the pack's `diagnostics.parser` (a host-implemented, named parser — `pythonTraceback`, `racket`, or `none`) turns them into markers in the **source** editor. Unrecognised output still lands in the panel in full. Shipping a fixed set of named parsers rather than pack-supplied regexes keeps a manifest from being able to run a catastrophically backtracking pattern over 256 KB of stderr.

**Kind 2 — the build succeeded and the RMS it produced is wrong.** Our own parser's diagnostics, computed on the generated text. **Their offsets are true in the generated document and meaningless in the source**, and there is no general way to map back: neither reference project emits a source map, and a Python loop that writes forty `create_object` blocks has no single source line to blame anyway.

The rule, then: **generated-code diagnostics are shown in the generated pane only.** The source pane does not get invented squiggles. The status bar's diagnostic count stays honest, with a one-line explanation on click ("these are errors in the generated script; open the Generated view to see them"). Same refusal-to-guess as `newestRmsIn`'s ambiguous case.

**The optional upgrade, designed now and built last (Phase D).** A pack may write `<output>.rms.map.json` beside its output: an array of `{ generated: [start, end], source: { file, line, column } }`. When present the app gets the Overleaf comparison the request is really reaching for — SyncTeX, not the split view. Click a line in the generated pane, jump to the source that emitted it; RMS diagnostics mirror onto the source editor; Breakdown card selection resolves through to source. When absent — the normal case, and the case for both reference packs today — the click-through control is disabled with a HelpTip naming the reason. **The split view is worth building without this. Do not let source maps block Phase C.**

## 8. The Code tab

In `"rms"` mode the Code tab is exactly what it is today: `MapSidePanel` plus the editor frame, no new controls. In `"generated"` mode a header strip appears above the editor:

```
 [ Source | Split | Generated ]   Python (python-aoe2rms)   [ Build ^AltB ] [ History ]   * Stale
```

- **Source** (default) — the source model, pack's Monaco language, fully editable.
- **Split** — source left, generated right, read-only, scroll-linked only if a source map exists (otherwise independent, because linking two unrelated line numberings is worse than not linking).
- **Generated** — the read-only RMS, full width, with its own banner and the RMS diagnostics.

The view choice is view state and belongs beside the preview's own in a context above the tab switch, not in the pane — `CodePane` unmounts on every tab switch, and `PreviewViewContext` exists because of exactly that lesson. Hotkey `codeToggleGenerated`, default **Ctrl+Alt+G**, cycles Source -> Generated -> Split.

`MapSidePanel` stays, unchanged, in both modes. The preview showing what your Python produced, next to your Python, is most of the appeal.

**The empty states, which are now four where the pane has one.** `CodePane` today renders `PlaceholderPane` when `!hasFile` and nothing else, because "no file" was the only way to have nothing to show. Generated mode adds three more, and they are different messages with different actions rather than shades of the same one:

| State | Generated pane shows | Action offered |
|---|---|---|
| No file open | Today's placeholder, unchanged | Open |
| Source open, never built | "Not built yet" | Build |
| Source open, pack not installed | The pack's name and that it is missing | The pack's homepage |
| Last build failed | The failure's first line | Open Build Output |

Two rules across all four. **The last good generated document stays on screen where one exists** — a failed build does not blank the pane, because the previous map is still what is on disk and still what the preview is showing, and clearing it would tell the user they have lost something they have not. And **an empty state never renders as an empty pane**: the difference between "nothing to build" and "the build produced nothing" is the whole content of the message, and a blank pane says neither.

**Help coverage** (CLAUDE.md: every new interactive element gets a `HelpTip`). New `reference/data/ui-help.json` entries: `code.viewToggle`, `code.build`, `code.buildState`, `code.generatedBanner`, `code.buildOutput`, `code.history`, `code.historyCompare`, `code.historyRestore`, `code.detach`, `settings.runtimes`, `settings.buildOnSave`, `packs.install`, `packs.consent`, plus the disabled-state text on every Breakdown and tool control Sec.3.2 gates — a disabled control with no explanation is the worst of the three states.

## 9. Trust

A language pack is strictly more dangerous than an Advanced Tool: a tool speaks JSON over a pipe with no ambient authority beyond its stdin, while a pack runs an interpreter over the user's file with the user's full OS privileges, outside every sandbox in the app. The consent flow has to say so in those words.

- **Installing a pack** is the one consent gate. Unzip a folder into the app data dir; a dialog states plainly: *"Building with this pack runs `python` on your map file. It can do anything you can do."* Registration validation (Sec.5.1) runs before the dialog, so a broken pack never gets asked about.
- **Opening a project never runs anything** (Sec.5.3). This is the property that makes maps safe to share and it must be tested, not asserted.
- **A curated registry** follows the tools registry when there is one; unvetted-pack warnings are the interim, per PLAN.md's M6 trust flow.
- The GCUR condition in PLAN.md binds here too: **no paid pack marketplace, ever.**

## 10. What each subsystem does in generated mode

| Subsystem | Reads | Writes | Change needed |
|---|---|---|---|
| Parser / diagnostics | generated | — | none (parses whatever is in the model) |
| Preview + side panel | generated | — | none; stale-gated by the status chip |
| Resource totals | generated | — | none |
| Breakdown | generated | **disabled** | editors + add/delete gated on mode, with help text |
| Advanced Tools (read) | generated | — | none |
| Advanced Tools (`edit-source`) | generated | **disabled** | Apply gated in `host.ts` beside the existing capability check |
| Header stamp | — | **retargeted** | banner prepended at write time, not into the model (Sec.3.2) |
| Undo/redo | both models | source only | window listener routes to the focused model |

Five of eight rows are "none". That is the argument for Sec.3.1's model-slot decision, stated as a count.

## 11. Phasing

**This lands after M6, and that ordering is a decision with a consequence.** External tools (PLAN.md M6) and language packs need the same machinery — an app data dir layout, an install flow, a consent dialog, manifest validation at registration, and eventually a curated registry — and whichever ships first builds it for both. **M6 builds it.** Two reasons beyond the roadmap's own order. The tools contract is written and running five built-ins today, so its install story is the smaller step from where the code actually is; and a *tool* is the safer thing to get wrong first, because it speaks JSON over a pipe with no ambient authority, where a pack runs an interpreter with the user's full privileges (Sec.9). Building the riskier consent surface second, on machinery that has already carried something, is the right way round.

What that means for this document: **Sec.9's trust flow and Phase C's discovery/install are descriptions of M6's machinery with a pack-shaped payload, not a second implementation of it.** If M6 ships an install flow that differs from what Sec.9 describes, M6 is right and this document is the bug — the same rule `docs/tools-api-design.md` states about itself and its source. The one thing this feature must not inherit silently is the consent *wording*: "this tool can read your script" and "building with this pack runs `python` on your map file" are different claims, and the second is the one Sec.9 exists to make.

**A — Modes and the second model.** `DocumentMode`, the source model, the Source/Split/Generated control, the read-only enforcement inventory in Sec.3.2, the save-guard rework in Sec.3.3, the banner-at-write-time header change, banner parsing and the Sec.4.2 open-a-file table, Detach, the four empty states. **No compiler.** Exercised end to end by a built-in pass-through pack whose "build" copies the source to the output — which sounds like a toy and is in fact the only way to test that RMS mode is unchanged and generated mode is unwritable without a Python install in CI.

**B — The build.** The Rust `build_script` command, Settings > Runtimes, the three output strategies, watchdog/cancel/caps, the Build Output panel, staleness and the status chip, build history (Sec.6.7).

**C — Packs.** Discovery, install + consent, manifest validation at registration, the Open dialog's source-extension filters, the two reference packs written and contributed. **This is the first phase a user can use.**

**D — Source maps.** The optional map format, click-through both ways, diagnostic mirroring, scroll-linked split.

A and B are independently reviewable and neither ships user-visible language support, which is deliberate: the read-only enforcement is the part that will be got wrong, and it is testable before a single subprocess exists.

## 12. Test plan

1. **RMS mode is unchanged** — the whole existing suite passes with mode plumbing in place; a document opened from `.rms` has no build controls, no second model, and identical Breakdown/tool behaviour. This is the regression bar for Phase A.
2. **Every write path in Sec.3.2's table is blocked in generated mode**, one test per row, asserting *the model text is unchanged* rather than that a button was disabled. Buttons get re-added; the table is the contract.
3. **Opening a file executes nothing** — a banner-carrying `.rms` naming an installed pack, opened, spawns no process. Assert at the spawn boundary, not on observable effects.
3b. **Banner parsing**, one case per row of Sec.4.2's table, plus a hand-mangled banner (truncated key, reordered rows, a second comment block that also contains `aorms-` keys) resolving to *no association* rather than a partial one. Detach removes the banner in one undo step and leaves the rest of the script byte-identical.
4. **Substitution cannot escape** — `${entry}` values containing `..`, absolute paths, and `;`/`&`/quote characters are rejected Rust-side; argument-array spawning is asserted by construction.
5. **Output strategies**, one fixture each, including `newestRmsIn`'s two failure cases (nothing written, two files written) asserting a *failed build*, not a chosen file.
6. **Watchdog** — a pack that sleeps past `timeoutMs` is killed and reported; Cancel leaves no orphan.
7. **Staleness** — edit source, assert the chip goes Stale, assert preview and totals still show the last build (they should — the point is that the chip is the only thing that changed).
8. **Version gate** — a runtime below `minVersion` fails before spawning the build, with the pack's requirement in the message.
9. **Manifest validation** at registration: unknown `apiVersion`, unknown output strategy, unknown substitution token, absolute path in `args`, missing `runtime.id`.
10. **The save guards** (Sec.3.3) — editing the source marks the document dirty and a build does not; close-with-unsaved-source prompts and saves the *source*; Save As writes the source under the new name and leaves the old `.rms` in place; Open and New clear the generated model, so the previous map's totals and preview cannot survive into an unbuilt document.
11. **A build is refused while a tool run is active**, and a tool run started after a build sees the new document. Assert at the lock, not through a real Monte Carlo run.
12. **Line endings** — a pack whose output is CRLF produces a model whose offsets match a parse of the same text, and the file written to disk round-trips through open-and-reparse unchanged.
13. **Build history** — a failed build leaves the previous `.rms` on disk untouched; Restore source lands as exactly one undo entry and does not write a file; Compare mutates nothing; the cap prunes oldest-first and never prunes the entry currently being compared.
14. **The spawn boundary, with no interpreter installed.** CI has no Python and no Racket, so the Rust `build_script` command is tested against a **fake runtime** registered only in tests — a manifest whose `runtime.id` resolves to a stub the test controls, which can be told to succeed, exit non-zero, write nothing, write two files, hang past the timeout, or emit CRLF. Every row of items 4 through 6 and 12 runs through it. What this deliberately does *not* prove is that a real interpreter behaves the same, which is what item 15 is for.
15. **Round-trip on the reference packs**, as manual acceptance rather than CI (neither runtime is installed on a build agent): a real python-aoe2rms map and a real `#lang aoe2-rms` map, built, previewed, and run through the consistency checker.

## 13. Open questions

1. **Should Build exist in RMS mode as a no-op, or be absent?** Absent here. Reconsider if a pack ever wants to post-process plain RMS (a minifier, an includer) — that is the same machinery with `source.extension: "rms"`, and it would make the mode distinction blurrier than this document assumes.
2. **Pack-declared Breakdown mapping.** A pack that emitted a source map could in principle let Breakdown edit *source* — change a value in a card, patch the Python literal it came from. Enormous, probably unwise, and named here only so a later reader knows it was considered and deferred rather than missed.
3. **Where does the app data dir for packs live?** Not open any more in principle — M6 decides it (Sec.11) and this feature follows, with build history (Sec.6.7) in the same dir. What stays open is one detail M6 has no reason to consider: history entries are per *project* and hold two full copies of a script each, so they need a pruning owner and a place that is not the pack folder. Raise it while M6's layout is being written, not after.
4. **`versionPattern` is a regex from a manifest**, which Sec.7 argues against for stderr parsing. It is bounded input (one line of `--version` output) so the risk differs in degree — but if the answer is "no regexes in manifests, full stop", `versionArgs`/`versionPattern` become named runtime probes like the diagnostics parsers.

## Appendix A: the two reference projects, as measured

Both verified from their public READMEs on 2026-08-29; both are external projects that can change under this document.

**python-aoe2rms** (AntoineRoll) — an embedded DSL: package `aoe2rms` 0.1.0, `requires-python >= 3.11`, one runtime dependency (`pydantic >= 2.11.3`), setuptools build backend, installed from git with pip or uv (not on PyPI). A map is a Python program using a context manager per RMS section. `pyproject.toml` defines **no `[project.scripts]`**, and the README documents no CLI.

The fact that makes Appendix B easy: **`Map.compile()` already returns the finished RMS script as a string**, and `save_to_file(file_path, overwrite=False)` is a thin wrapper that writes it. A build entry point does not need to reimplement anything — it needs to find the `Map` and call `compile()`.

Two consequences worth carrying into the pack manifest. First, `overwrite` defaults to `False` and raises `FileExistsError`, so **a script written to the README's shape fails on its second run** — an ordinary build loop hits this immediately, and it is the second half of the upstream ask. Second, until a CLI exists the pack must use `newestRmsIn`. After it: `runtime.id: "python"`, `args: ["-m", "aoe2rms", "build", "${entry}", "-o", "${outPath}"]`, `output.strategy: "file"`, `editorLanguage: "python"`, `diagnostics.parser: "pythonTraceback"`.

**aoe2-rms** (Erbenos) — a Racket `#lang`. Source is `.rkt` beginning `#lang aoe2-rms`; installed with `raco pkg install aoe2-rms`; built with `racket example.rkt` (RMS to stdout) or `racket example.rkt -d example.rms`. Consequences: `runtime.id: "racket"`, either `output.strategy: "stdout"` with `args: ["${entry}"]` or `"file"` with `args: ["${entry}", "-d", "${outPath}"]` — **prefer the latter**, since stdout capture and a library that prints anything for its own reasons are one `printf` away from a corrupt map. `editorLanguage: "scheme"` (Monaco ships it; Racket-specific highlighting is a Monarch definition someone can contribute later).

## Appendix B: the upstream contribution to python-aoe2rms

A pack works against the library as it stands, via `newestRmsIn`. This appendix is the small change that would let it use `file` instead, offered upstream rather than worked around locally — the project is open source and the author is receptive.

**Two independent pieces, so the author can take either without the other.**

**B1 — a build entry point.** `aoe2rms/cli.py` plus `aoe2rms/__main__.py`, and one `[project.scripts]` line. It executes the user's script with `runpy.run_path`, collects the module-level `Map` instances out of the resulting globals, and writes `map.compile()` to `-o` (or stdout for `-`). No change to any existing behaviour, no new dependency, and **no change required to user scripts** — the README's own `my_map = Map(...)` is already a module-level `Map`.

```python
def main(argv=None):
    args = _parse(argv)
    ns = runpy.run_path(args.entry, run_name="__main__")
    maps = [v for v in ns.values() if isinstance(v, Map)]
    if not maps:
        raise SystemExit(f"{args.entry}: no Map instance found at module level")
    if len(maps) > 1 and not args.map:
        raise SystemExit(f"{args.entry}: {len(maps)} maps found; pass --map NAME")
    ...
```

The ambiguity cases exit non-zero with a message rather than picking one — the same rule Sec.5.2 applies to `newestRmsIn`, for the same reason.

**B2 — `save_to_file` in a build loop.** With `overwrite=False` as the default, a script that ends in `save_to_file("my_map.rms")` raises `FileExistsError` the second time it runs. Under B1 the CLI never calls `save_to_file`, so the build itself is unaffected — but the user's own script still calls it, and still raises. Candidate fixes, for the author to choose between: default `overwrite` to `True`; or have the CLI set a flag the method honours; or leave it and document `overwrite=True` in the quick start. **Report it as an observation with options, not as a patch with a preference** — it is a behaviour change in someone else's library, and the CLI does not depend on the answer.

Neither piece is AoRMS-specific: any tool that builds these maps in a loop, including a plain `make`, wants both.
