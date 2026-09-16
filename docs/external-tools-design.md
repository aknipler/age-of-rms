# External Tools — Design (Phase 6 / M6, rev 1, draft for review)

**Status: proposal, nothing implemented.** This is CREATION_PLAN.md's Phase 6 brief — _"manifest schema + process spawning implementing the 5.1 contract; unvetted-tool warning dialog; curated registry"_ — worked out against the contract that has been running five built-in tools since 2026-08-15. It is written after `docs/tools-api-design.md` (rev 10) and `docs/source-languages-design.md` (rev 1) and reuses both wherever the shape is the same. Where it contradicts either, Sec.17 says so explicitly rather than leaving the reader to notice.

**Every repo claim here is dated 2026-08-30 — re-derive before acting on it.** `docs/tools-api-design.md` Sec.10.2's standing instruction applies to this document, for the same measured reason: the half-life of an undated claim in this repo is about a week.

## 1. The three answers up front

The rest of the document is the consequences of these.

1. **An extension is a folder plus a record, and the record is the authority.** One generic install layer serves both external tools and (later) language packs. What makes consent non-bypassable is that "installed" means _there is a record saying a human consented_, never _there is a folder on disk_. Sec.4.
2. **A tool's `entry` may be an executable or a script plus a declared runtime.** The runtime is a key resolved through a shared Settings > Runtimes panel, never a path in a manifest — the rule `docs/source-languages-design.md` Sec.5.3 already argued for packs, built once here. Sec.5.
3. **Install is local; the registry is deferred but its shape is reserved.** The install record carries `source: { kind, url?, sha256? }` from day one, so a later registry fills fields instead of migrating what is already on users' disks. Sec.12.

And one finding that reorders the work: **the wire serializer specified in rev 10 of the contract does not exist and has never run.** Sec.3 is that inventory, and it is why the phase starts with a codec rather than with a process.

## 2. Goals and non-goals

**Goals**

1. A user can install a tool nobody at this project wrote, see exactly what it may read before agreeing to anything, and run it against the open script with the same pane, the same Run/Cancel, and the same Apply gate as a built-in.
2. A tool author in any language can implement the contract from a published prose spec and check their work against something executable, without reading TypeScript.
3. The host cannot be made to hang, OOM, or apply a bad edit by a hostile or broken child process.
4. Nothing about the built-in path changes behaviour. Five tools ship today and their observable behaviour is the regression bar.
5. The install, consent and registration machinery is the machinery language packs inherit, not a first draft of it.

**Non-goals**

- **A sandbox.** A spawned child runs with the user's privileges and this document does not pretend otherwise (Sec.9.1). The contract's "no ambient authority beyond its stdin" is a statement about the _protocol_, not about the OS.
- **The registry.** Sec.12.
- **Making the flagship tool portable.** The consistency checker imports the preview generator and is inexpressible externally until that generator is a standalone library. Sec.13.
- **Hot reload, background tools, tools that add UI.** A tool is still a document the app displays (`docs/tools-api-design.md` Sec.1 goal 2), and that is what keeps the trust model tractable.
- **Non-Windows spawning.** This is a Windows desktop app and Sec.6.3 is written for Windows specifically, for the reason `src/settings/scriptFolder.ts` gives about its own path list: three plausible-looking untested branches are worse than one tested one.

## 3. The honest inventory

### 3.1 What exists, what is prepared, what does not exist

Verified 2026-08-30.

| Piece                                                                               | State                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The contract (`tools-api/index.ts`)                                                 | **Exists, complete, running.** `TOOLS_API_VERSION`, capabilities, manifest, `ToolContext`, `OutputBlock`, `ToolMessage`, `ErrorReason`, `LIMITS`, `DEADLINES`, `PROHIBITED_VALUE_KINDS` |
| Wire _types_ (`SerializedParseResult`, `WireNumber`, `InfSentinel`)                 | **Exist**, and are pinned by `src/parser/__tests__/wireTypes.test-d.ts`                                                                                                                 |
| `numeric()` decode helper                                                           | Exists, **zero consumers** outside its own declaration                                                                                                                                  |
| The **encoder**                                                                     | **Does not exist.** No file anywhere converts a `ParseResult` to the wire form                                                                                                          |
| `parseInboundLine`                                                                  | Exists in `src/tools/protocol.ts`, **called only from `protocol.test.ts`**                                                                                                              |
| `validateToolMessage`, `validateEdits`, `validateManifest`, `effectiveCapabilities` | Exist and run against built-ins today                                                                                                                                                   |
| Run lifecycle (`ToolHost`)                                                          | Exists: one run app-wide, both watchdogs, cancel grace, staleness guard, edit-capability enforcement, handle-identity stale-message rejection                                           |
| Injected-runner seam (`ToolRunner`)                                                 | Exists, with two implementations (`inProcessRunner`, `workerRunner`)                                                                                                                    |
| Process spawning                                                                    | **Does not exist anywhere.** `src-tauri/Cargo.toml` carries `opener`, `dialog`, `fs`, `store`, `process` and `updater`; no shell plugin, and `src/` contains no spawn of any kind       |
| App data dir layout for extensions                                                  | **Does not exist.** The only app data today is one `settings.json` via `tauri-plugin-store`, shared by every settings family                                                            |
| `tools-api/PROTOCOL.md`                                                             | **Does not exist**, not even as the stub Sec.8 of rev 10 prescribes                                                                                                                     |
| Published bundled `.d.ts`                                                           | **Does not exist**                                                                                                                                                                      |
| Sec.9 round-trip and def-reconstruction tests                                       | **Do not exist** — this is `docs/known-issues.md` BUG-017                                                                                                                               |

### 3.2 BUG-017 is not tracked debt, it is step one

BUG-017 records that the contract's own Sec.9 items 1 and 11 — a serialization round-trip over every `ToolMessage` kind, an `Infinity`-bearing fixture, a corpus parse, and def-reconstruction from the wire form against four named fixtures — were never built. It is filed as an open bug with a prescribed fix.

**Read it as the first work item of this phase rather than as debt to clear alongside it.** Everything in Phase 6 rides on an encode/decode path that nothing has ever exercised, in either direction, on any input. The contract's own comment on the sentinel says the failure mode is silent and lands "in the 'your map is fine' direction", and Sec.9 of rev 10 goes further: the one gate that was supposed to enforce that the encoder encodes at all was aimed at the half of the test that structurally cannot fail, because the corpus contains no non-finite value anywhere. So the encoder is unwritten, and the test that would have caught an unwritten encoder was itself misaimed. Building the codec and its tests before anything spawns is not sequencing preference, it is the only order in which the later steps have a foundation.

### 3.3 `checkOutboundContextSize` measures a quantity no transport uses

`ToolHost.start()` calls `checkOutboundContextSize(contextJson)` unconditionally, on every run, for every tool. That function is `JSON.stringify(contextJson).length` compared against `LIMITS.maxOutboundRunBytes`.

Two things are wrong with it, and neither is currently a live bug.

- **It stringifies the def-_included_ tree.** `maxOutboundRunBytes` was derived from a worst measured case of roughly 9.5 MB, which rev 10 states is a **def-stripped** parse plus reference data; the def-included figure the same section gives is about 14 MB, because JSON has no back-references and every shared `CommandDef` pointer re-expands inline. So the check compares the wrong quantity against a cap derived from the right one. It errs large, so it cannot under-reject, and 15-odd MB is comfortably inside a 32 MB cap — **latent, not live.**
- **It costs a full stringify of the largest object in the app on every built-in run**, to guard a transport that does not exist. The checker declares `read-ast` and `read-reference`, so pressing Run on a heavy map serializes the whole parse plus 1.37 MB of reference data purely to measure it, and then throws the string away.

**The fix falls out of building the encoder and should land with it.** The external runner produces the wire string anyway, so the cap check becomes `wire.length` on the string it is about to write — no separate pass, and it measures the bytes that actually cross. For in-process and worker transports the check should not run at all: `postMessage` uses structured clone, which preserves sharing and never builds a JSON string, so there is no outbound byte count to cap. Keep the host-side `host-error` reason and the script-naming message, both of which rev 10 argues for correctly; move where the number comes from.

## 4. The extension layer

One install path serves both kinds. This was a decision taken against the alternative of building it tool-shaped and generalising later, and Sec.4.3 is the mechanism that pays for it.

### 4.1 Directory layout

```
<appLocalDataDir>/Age of RMS/
  settings.json                     exists today; every settings family shares it
  extensions/
    installed.json                  the install records (Sec.4.2) — the authority
    tools/<tool-id>/
      manifest.json
      <the tool's own files>
    packs/<pack-id>/                reserved for docs/source-languages-design.md
      manifest.json
  build-history/<project-key>/      reserved; source-languages Sec.6.7 and Sec.13 q3
```

Three properties this layout is chosen for.

- **`installed.json` sits above the kind folders**, so "what is installed" is one read, one schema, one place to audit, and it does not depend on walking a tree whose contents a user can change.
- **Build history is not inside `packs/`.** `docs/source-languages-design.md` Sec.13 q3 asks Phase 6 to settle this, and the answer is that history is per _project_ and holds two full copies of a script per entry, so it has a different lifetime, a different pruning owner and a different growth curve from an installed extension. Putting it under the pack that produced it would make uninstalling a pack delete a user's build history, which is not what uninstall means.
- **Nothing goes next to the executable.** The Microsoft Store build installs read-only into `C:\Program Files\WindowsApps` (`src/settings/scriptFolder.ts` records why probing it is pointless), so an install location that assumes a writable install directory is broken on one of the two shipping channels.

### 4.2 The install record is the authority, not the directory

`extensions/installed.json` holds one record per installed extension:

```jsonc
{
  "schemaVersion": 1,
  "extensions": [
    {
      "kind": "tool", // discriminant; "pack" later
      "id": "my-checker",
      "version": "1.2.0",
      "apiVersion": 1,
      "installedAt": "2026-09-01T10:14:03Z",
      "source": { "kind": "local", "path": "D:\\downloads\\my-checker" },
      "consent": {
        "capabilities": ["read-ast", "read-reference", "edit-source"],
        "grantedAt": "2026-09-01T10:14:03Z",
      },
      "enabled": true,
    },
  ],
}
```

**A folder under `extensions/tools/` with no matching record is not installed.** It does not appear in the dropdown, it cannot be run, and the Settings tab lists it once under "found but not installed", with an Install button that opens the ordinary consent dialog. This is the whole mechanism by which consent cannot be bypassed by copying a directory, and it costs one rule.

The inverse also holds: a record whose folder is gone is reported and offered for removal, not silently pruned. Silently pruning is how a user loses a tool and never learns why.

**`source` is the registry hedge.** `kind: "local"` carries the path it came from, purely so the Settings tab can say where a thing came from. `kind: "registry"` will carry `url` and `sha256`. Reserving the shape now means a registry adds fields rather than rewriting a file that is already on users' disks.

**`consent.capabilities` is recorded, not derived.** It is the set that was _shown to the user_, snapshotted at the moment they agreed. Sec.9.3 is what it is for.

### 4.3 The mechanism that stops consent wording collapsing

The known failure of a generic extension layer is that the consent dialog becomes one component parameterised by a string, and then somebody supplies the wrong string. `docs/source-languages-design.md` Sec.11 names exactly this: the one thing packs must not inherit silently is the wording, because _"this tool can read your script"_ and _"building with this pack runs `python` on your map file"_ are different claims.

So the generic layer is generic in its **plumbing** and closed in its **copy**:

```ts
// One discriminated union, no index signature, no default branch.
export type ExtensionKind = "tool" | "pack";

export interface ConsentCopy {
  /** "Install My Checker?" */
  title: string;
  /** The authority sentence. Must state what RUNS, not what is read. */
  authority: string;
  /** Rendered from the manifest's capabilities, in plain language. */
  readsIntro: string;
  confirmLabel: string;
}

// The wording itself lives in Sec.9.2 and is deliberately not duplicated here.
declare const TOOL_CONSENT: ConsentCopy;
declare const PACK_CONSENT: ConsentCopy;

// Required per kind. Adding a kind without copy is a COMPILE error,
// because this is a Record over the union with no partiality and no fallback.
export const CONSENT_COPY: Record<ExtensionKind, ConsentCopy> = {
  tool: TOOL_CONSENT,
  pack: PACK_CONSENT,
};
```

Two rules make it enforceable rather than merely intended.

1. **`Record<ExtensionKind, ConsentCopy>` with no `Partial` and no fallback.** A third kind cannot be added without someone writing its copy. This is the same discipline `validateManifest` applies at registration and for the same reason: fail where it is visible, not at the moment a user is being asked to trust something.
2. **A test asserts the copy says the right thing per kind, in both directions.** The pack copy must contain its full-privilege claim. The tool copy must _also_ contain one (Sec.9.1 explains why), and must not contain a claim about interpreting the user's own source file, which is not what a tool does. **Over-claiming is a defect too** — a dialog that says the same alarming thing about everything trains a user to click through it, and the next dialog they click through is the one that mattered.

The plumbing that genuinely is shared: unzip or copy into place, validate the manifest at registration, write the record, list, enable/disable, uninstall, and report the "found but not installed" case. None of that differs by kind, and none of it contains a sentence a user reads.

### 4.4 Registration, validation, uninstall

**Validation runs before the dialog.** A malformed extension is never asked about, which is `src/tools/registry.ts`'s existing rule ("a manifest whose declared default violates its own declared constraints ships a form that cannot be submitted as authored") applied one layer out. The existing `validateManifest` covers the params half already and is reused verbatim; Sec.5.1's new fields extend it.

**`apiVersion` rejects, it does not warn.** Rev 10 Sec.10 states this and gives the reason: leniency becomes something tools depend on. A rejected tool is listed in Settings with its declared version and the app's, so the user can tell whether to update the tool or the app.

**Uninstall removes the record first, then the folder.** In that order, so a failed delete leaves a tool that cannot run rather than a record pointing at nothing. Report the leftover folder; do not retry silently.

## 5. The external tool manifest

### 5.1 The added fields

`ToolManifest` today carries `id`, `name`, `version`, `apiVersion`, `description`, `capabilities`, optional `params`, optional `ownsSettingsHeader`, and a comment reading _"v1.1 external tools add: entry (executable + args), language, author, homepage."_ That comment is the specification being filled in here.

```ts
/** Present iff the tool is external. A built-in manifest must not carry it. */
export interface ExternalEntry {
  /**
   * Path to the executable or script, RELATIVE to the extension's own
   * directory. Absolute paths and any path escaping the directory are
   * rejected at registration, and again Rust-side before spawn (Sec.6.2).
   */
  entry: string;
  /**
   * Absent for a self-contained executable. Present for a script, naming a
   * runtime KEY the app resolves (Sec.5.2) — never a path.
   */
  runtime?: {
    /** A key in KNOWN_RUNTIMES, or any other string to take the fallback. */
    id: string;
    minVersion?: string;
    /**
     * ESCAPE HATCH ONLY, and ignored for a known `id` (Sec.5.2). Present so a
     * runtime the app has never heard of still ships on day one. RE2 syntax:
     * no backreferences, no lookaround, validated at registration.
     */
    versionArgs?: string[]; // default ["--version"]
    versionPattern?: string;
    versionStream?: "stdout" | "stderr" | "both"; // default "both"
  };
  /** Literal, except for the closed substitution set in Sec.5.3. */
  args?: string[];
  author: string;
  homepage?: string;
}
```

`language` from the old comment is dropped. It would be display metadata only, it duplicates what `runtime.id` already tells a reader, and for a self-contained executable it is unanswerable and irrelevant. If the registry later wants it for filtering, it belongs in the registry entry, not in the manifest the host validates.

### 5.2 The runtime is a key, never a path, and the app owns the probe

`runtime.id` resolves through a new **Settings > Runtimes** panel: discover on `PATH`, show the resolved absolute path and version, let the user point elsewhere. The resolved path lives in `settings.json` under a `runtimes` family, alongside every other family in that one file.

Two holes this closes, both borrowed from `docs/source-languages-design.md` Sec.5.3 because the argument transfers exactly:

1. **A manifest from a stranger can never name an executable.** It names `"python"`; what that means is a local decision the user made in a settings panel.
2. **The webview never hands an executable path across the process boundary.** Sec.6.2 is why that matters.

The version gate is not decoration. Failing before spawn with _"this tool needs Python 3.11 or newer; you have 3.10.4"_ is the difference between a two-minute fix and a bug report about a syntax error inside somebody else's library.

**Runtimes are shared state across extension kinds, and that is the one place the generic layer genuinely earns its keep.** A user who has told the app where Python is for a language pack has told it for tools too.

**Decided 2026-08-30: the app ships named probes; a manifest-supplied pattern survives only as an escape hatch.** `docs/source-languages-design.md` Sec.13 q4 raises this and defers it. It is settled here rather than twice, because Runtimes is shared.

```ts
/** Hand-written, one per runtime, shipped with the app. Not extensible by a manifest. */
export const KNOWN_RUNTIMES = ["python", "node", "racket"] as const;
```

**A known `id` takes the app's probe and the manifest's `versionArgs`/`versionPattern`/`versionStream` are ignored, flagged at registration as redundant rather than honoured.** An unknown `id` falls back to the manifest's own probe, matched Rust-side under RE2.

Two arguments decide it, and neither is the security one.

- **`runtime.id` is shared state, and a manifest-carried probe makes it contested.** The whole point of one Runtimes panel is that telling the app where Python lives serves every extension at once. If the probe travels with the manifest, two extensions naming `python` can disagree about how to probe it, against one resolved path, and the app has to pick a winner by install order. A closed set does not have the question. This is the same class of defect as two settings families fighting over one key, and it is why the escape hatch is scoped to ids **nothing else can be using**.
- **A manifest would supply the easy tenth of a job the app already does the other nine tenths of.** Finding a runtime on Windows is the hard part and none of it is expressible in a manifest: `PATHEXT` resolution across `.exe`/`.cmd`/`.bat`, the `python` versus `python3` split, and the Microsoft Store App Execution Alias, which is a real `python.exe` on `PATH` that opens the Store instead of an interpreter. The app owns all of that regardless. Handing back only the last mile puts a seam in the middle of one job.

A hand-written probe also fails better. It can say Python was not found, name where to get it, and point at Settings > Runtimes; a generic matcher can only report that a pattern did not match.

**Version output has no common shape, which is why the knowledge has to live somewhere.** Node prefixes a bare `v` with no product name, Racket answers in a prose sentence, Go embeds the version mid-line with the platform after it, and several runtimes write it to **stderr** rather than stdout — `java -version` does today, and Python did before 3.4. That last one is why the fallback carries `versionStream` at all, and why its default is `"both"`: a probe that reads only stdout silently sees an empty string and cannot tell "no version" from "version, elsewhere". **Treat every shape named in this paragraph as illustrative and re-derive it against the actual binary before a probe encodes it** — none of it was measured here, and this repo's rule about undated claims applies hardest to the ones that look like trivia.

**What the fallback costs, stated so it is not mistaken for free.** It is one `regex` crate call, which Sec.6.2's Rust command needs anyway. The crate is linear-time by construction — finite automata, no backtracking — so the ReDoS objection that usually sinks manifest regexes does not apply here, and it is worth recording that **the objection was an artefact of matching in JavaScript**, whose `RegExp` has no timeout and backtracks. "Bounded input" is not the reason it is safe; catastrophic backtracking is a property of the pattern, not the input length, and `(\d+\.)+\d+` against a forty-character non-match is exponential in any backtracking engine. The Rust engine is the reason. The price is a contract clause: patterns are RE2, so a manifest written against PCRE habits using lookahead or a backreference **fails at registration**, which is where it should fail.

**When the pattern does not match, fail closed and say which half failed.** The runtime was found and its version could not be read is a different sentence from the runtime was not found, and a user can act on the first only if the message distinguishes it. Failing open would make the gate decorative, which is the one outcome that makes `minVersion` worse than not having it.

**What this closes, and it should be said out loud rather than left for a reader to notice.** A tool whose runtime is not in `KNOWN_RUNTIMES` and whose author will not write a fallback probe cannot ship without a PR here and an app release. That is a real narrowing of `docs/source-languages-design.md` goal 4 ("no app release, no app code, no PR to this repo"), and the escape hatch is what keeps the narrowing from being total. Sec.17 records the amendment that document needs. This document's own goal 2 is untouched: it is about implementing the **protocol** in any language, which the fallback and the conformance kit both still serve.

### 5.3 Substitution is a closed set

`${entry}` and `${extensionDir}`, both resolved host-side to absolute paths inside the extension's own directory. Everything else in `args` is a literal. No shell, no environment expansion, no user-supplied interpolation.

Note what is deliberately absent relative to the pack contract: **there is no `${outPath}`.** A tool never writes a file. It receives its context on stdin and answers on stdout, which is the entire reason its trust story is simpler to _specify_ than a pack's, even though Sec.9.1 shows it is no simpler to _contain_.

## 6. Spawning

### 6.1 Not `tauri-plugin-shell`

CREATION_PLAN.md's brief says "process spawning (Tauri shell plugin)". **Supersede it.** `docs/source-languages-design.md` Sec.6.2 already reached the opposite conclusion for packs, and the reasoning is identical here:

`tauri-plugin-shell` gates execution with a scope declared statically in `capabilities/*.json` at build time. The command line for an external tool is assembled at run time from a manifest the user installed after the app shipped. A static scope either cannot express that, or is permissive enough that the app has handed its own webview a general execute-a-program primitive. That is a far larger blast radius than the feature needs, and it is a permanent one: the capability is compiled in.

**Decided: a bespoke Rust command.** Since packs will need the same command with a different payload, build it as `run_extension_process` rather than `run_tool` — the one place where the generic layer extends below the TypeScript boundary.

### 6.2 What the Rust side owns

The webview passes **two things**: the extension id and the serialized run context. It can name neither an executable nor an argument.

Rust then:

1. Reads `installed.json`, finds the record, refuses if absent or `enabled: false`. A record is required, so consent cannot be bypassed from the webview either.
2. Reads that extension's `manifest.json` from its own directory.
3. Resolves `runtime.id` against the settings store, probes the version if `minVersion` is declared, and fails before spawning if it is short.
4. Performs the Sec.5.3 substitution, canonicalises `entry`, and **refuses any resolved path outside the extension directory**.
5. Spawns with an **argument array**, never a command string, with no shell anywhere in the chain.
6. Writes the context to stdin as one NDJSON line, then closes nothing — stdin stays open for `cancel`.
7. Streams complete stdout lines to the webview over a Tauri channel, enforcing the inbound cap in bytes (Sec.7.2).
8. Keeps stderr as a 64 KB ring buffer per `LIMITS.maxStderrBytes`.

**Policy lives on the side of the boundary that has the authority.** That sentence is `docs/source-languages-design.md` Sec.6.2's and it is the whole design.

### 6.3 Windows specifics that will otherwise be found late

Rev 10 Sec.10 flags only that "the cancel grace and SIGKILL need Windows-specific testing". Three concrete items sit under that, and each is cheap now and expensive after release.

- **There is no SIGKILL.** Rust's `Child::kill()` maps to `TerminateProcess`, which kills that process and **not its children**. A tool that spawned helpers leaves orphans holding the app's run slot conceptually and the user's CPU actually. The Windows mechanism for killing a tree is a **Job Object** with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: assign the child at spawn, and closing the job handle takes the whole tree. `docs/source-languages-design.md` Sec.6.3 says "Cancel kills the process group" without naming a mechanism; this is the mechanism.
- **A console child pops a console window.** Spawning a console-subsystem program from a GUI application allocates a visible console. Every run of a Python-backed tool would flash a black window. `CREATE_NO_WINDOW` in the creation flags suppresses it. This is the kind of defect that reaches a release because it is invisible in every automated test.
- **Line endings.** A Windows tool writing `\r\n` leaves a trailing `\r` on every frame. `JSON.parse` tolerates it, so this will never fail loudly; trim it at the framing boundary anyway, for the reason `docs/source-languages-design.md` Sec.6.3 gives about normalising once at the boundary rather than in each consumer.

## 7. The wire

### 7.1 The serializer is a validating encoder

Build it as a `JSON.stringify` **replacer**, not a hand-written tree walk. The replacer receives each raw value before stringification, which is enough to do all three jobs in one pass:

```ts
function wireReplacer(key: string, value: unknown): unknown {
  if (key === "def") return undefined; // Sec.4.2: defs are stripped
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) throw new WireError("NaN");
    return { inf: value > 0 ? 1 : -1 }; // the sentinel
  }
  // prohibited kinds throw rather than pass
  return value;
}
```

Four things to get right, all of which the contract already implies and none of which is obvious.

- **It must not convert in place.** Rev 10 Sec.4.2 is emphatic and names three call sites in Breakdown that read and write real `Infinity` against the same tree the UI renders from (`renderValue.ts`, `patch/formatStyle.ts`, `cards/ValueEditor.tsx`). A replacer satisfies this by construction, which is most of why it is the right tool: it produces a string and touches nothing.
- **It throws on `PROHIBITED_VALUE_KINDS` rather than letting them through.** A `Map` passed to `JSON.stringify` becomes `{}` — silently, and in the direction where a tool reports a clean map. That frozen list exists so a test can assert against it; the encoder is where the assertion becomes a runtime guarantee. A throw here surfaces as `reason: "host-error"`, which rev 10 added precisely so the host does not blame the tool for its own failure to build a context.
- **`undefined` returned for an array element becomes `null`, not an omission.** `def` is never an array element so the strip is safe, but the encoder must not grow a rule that returns `undefined` for anything that can appear in an array. This is the same distinction `PROHIBITED_VALUE_KINDS` draws between an `undefined`-valued optional key (fine, reads as absent) and `undefined` inside an array (a value the consumer can read and be wrong about).
- **Stripping `def` is a size decision as much as a type decision.** The wire type says `unknown`, but the reason the bytes matter is that JSON has no back-references, so shared `CommandDef` pointers re-expand once per node. That is the whole gap between roughly 9.5 MB and roughly 14 MB on the worst measured map.

The decode side is `numeric()`, which already exists and has no consumers. It gets its first ones here and in the conformance kit.

### 7.2 Framing, and where the inbound cap is enforced

`parseInboundLine` checks the cap on a line it has _already been handed_. That is one guard short: a child that emits 500 MB with no newline never produces a line, so nothing calls the function, and the buffer grows until the host dies. Rev 10's own sentence — "a single 500 MB NDJSON line OOMs the host before any render-side cap can help" — describes a hazard the current guard sits on the wrong side of.

**Enforce the cap while accumulating, in Rust, on bytes.** Two reasons it belongs there rather than in TypeScript:

1. The accumulation happens there. A cap checked after reassembly is a cap that has already allocated the thing it was protecting against.
2. `LIMITS.maxInboundLineBytes` is named in **bytes** and `line.length` in JavaScript counts **UTF-16 code units**. For ASCII they agree; for a tool emitting non-ASCII output they do not, in both directions. Rust reads a byte stream, so the check is exact there and approximate anywhere else.

Keep `parseInboundLine`'s check as a second guard. It is cheap, it already exists, and it covers the case where a future transport reaches it by another route.

Exceeding the cap terminates the run with `reason: "protocol"` and names the cap. It does not truncate.

### 7.3 Measure the string you are about to write

Per Sec.3.3: the external runner already holds the wire string, so the outbound cap is `wire.length` against `LIMITS.maxOutboundRunBytes`, checked in the external runner, and `checkOutboundContextSize` stops running on transports that never build a string. The failure stays a `host-error` naming the script.

**Reference data is a constant ~1.37 MB on every run declaring `read-reference`, and it is not cacheable.** One process per run is a deliberate invariant borrowed from the worker transport (`kill()` is the whole recovery; no tool state survives a run), and the contract gives tools no file paths, so there is nowhere to park a cached copy. Pay it per run and say so in PROTOCOL.md, because an author measuring their own start-up time deserves to know where the first second went.

### 7.4 stderr is ground truth and is never filtered

A 64 KB ring buffer, surfaced in the pane as a collapsible tool log, shown whether or not the run succeeded. A tool author's only debugging channel is stderr, and a host that hides it on success is a host that makes a working-but-wrong tool unfixable.

## 8. Lifecycle: cancel, watchdog, kill

The host lifecycle is already built and **does not change**. `ToolHost` owns one run app-wide, arms `runWatchdogMs` on every message, arms `cancelGraceMs` on a cancel request, distinguishes `cancelled` from `killed`, and rejects late messages by handle identity rather than by a wire field. All of that is transport-agnostic already, which is the payoff rev 10 was designing for.

What the external runner supplies:

| `RunnerHandle` | External implementation                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| `cancel()`     | Write `{"type":"cancel"}\n` to the child's stdin                                        |
| `kill()`       | Close the job handle, taking the process tree (Sec.6.3). Must not throw if already dead |

Three consequences worth stating rather than discovering.

- **A blocking-stdin tool will be killed as `unresponsive`, and that is correct.** Rev 10 Sec.10 already reasons this out: a single-threaded tool blocked on `stdin.readline()` while working sees neither the cancel nor a chance to emit, so the silence watchdog fires. Document it as the designed outcome in PROTOCOL.md, with the per-language delivery recipe (a non-blocking poll between chunks, or a reader thread setting a flag) next to it. Rev 10 names that recipe as a pre-v1.1 blocker and it is still unwritten.
- **A child that exits without a terminal message synthesizes an `error`.** Same rule the worker transport already follows via `onerror`. Exit code and the stderr tail go in the message, because "the tool stopped" with no exit code is unactionable.
- **`cancelGraceMs` and `runWatchdogMs` are both 60 s and both bound one unit of the tool's own work.** They were deliberately equalised on 2026-08-19. Do not re-derive one without the other; the contract's comment explains that a grace shorter than the watchdog prints `killed` against a tool that cancelled exactly as specified.

## 9. Trust and consent

### 9.1 The asymmetry argument in `source-languages-design.md` Sec.9 is inverted

That section reads: _"A language pack is strictly more dangerous than an Advanced Tool: a tool speaks JSON over a pipe with no ambient authority beyond its stdin, while a pack runs an interpreter over the user's file with the user's full OS privileges, outside every sandbox in the app."_

**That is true of a built-in tool and false of an external one.** A built-in runs in the webview or a web worker, with no filesystem, no spawn, no network beyond what the app itself grants. An external tool is a child process launched with the user's token. It can read the user's documents, write files, and open sockets. The contract's "no ambient authority beyond its stdin" describes what the _protocol_ hands it, not what the _operating system_ does.

If anything the comparison runs the other way. When a pack builds, the code being executed is overwhelmingly the user's own map script, run through an interpreter the user installed and a library they chose. When an external tool runs, **every instruction executed is the stranger's.**

**What survives and what does not.** Sec.11 of that document gives two reasons for building this machinery in M6 rather than in the pack phase. The first — that the tools contract is already written and running five built-ins, so its install story is the smaller step from where the code actually is — is untouched and remains a good reason. The second — that a tool is "the safer thing to get wrong first" — does not survive, and neither does the "build the riskier consent surface second" framing that rests on it. **The ordering conclusion is unchanged; one of its two supports is not load-bearing.** Sec.17 records the amendment that document needs.

The practical consequence is Sec.4.3's second test: the tool consent dialog must make a full-privilege claim, because the claim is true.

### 9.2 What the dialog says

Two paragraphs, in this order, because the order is the point.

> **My Checker wants to run on your computer.**
> This tool is a program from someone outside Age of RMS. Running it gives it the same access to your computer that you have. Only install tools from people you trust.
>
> **What it will be given:** your script, and the built-in reference data. **It can propose changes to your script**, which you approve one at a time before anything is written.

The authority sentence comes first because it is the one that decides. The capability list comes second because it is what the app can actually promise, and the two must not be blurred into a single reassuring paragraph.

**The capability sentence is already written and already shipping.** `describeCapabilities` in `src/components/settings/AdvancedToolsSettings.tsx` renders capabilities as plain language today, and its own comment says it "is the ancestor of the v1.1 consent dialog, where over-claiming is a trust problem rather than a wording one". Lift that function rather than writing a second one, and let the same test cover both surfaces. It also already handles the `read-ast` implies `read-source` collapse that `effectiveCapabilities` encodes, so the dialog says "your script" once rather than twice.

Say nothing the app does not enforce. `edit-source` never auto-applies — `ToolHost` drops edits from a tool that did not declare it, `validateEdits` rejects a malformed set whole, and Apply re-checks string equality against the run snapshot. Those are real guarantees and the dialog may state them.

### 9.3 Consent is recorded against a capability set, and an update re-asks

`consent.capabilities` in the install record is the set that was **shown**. On update, compare the new manifest's effective capabilities against the recorded set:

- **Same or narrower:** install silently. Nothing new is being asked for.
- **Wider in any element:** re-ask, with the added capabilities called out as added rather than presented as a fresh list. A user who agreed to a reader must be asked again before it becomes an editor.

This is cheap now and unavailable later, because retrofitting it means either re-asking everyone once or grandfathering consent that was never given. `apiVersion` is recorded alongside for the same reason: a tool that changes its API version is a different contract, not a patch release.

## 10. Changes to code that exists

The point of rev 10's transport-agnostic design is that this list is short. It is, and the shape of each change matters more than the size.

**`ToolRunner.start` takes a registered tool, not a `ToolImplementation`.** An external tool has no `run()`, so it cannot satisfy `ToolImplementation`. Rather than synthesise one whose `run` throws — a lie the type system would then propagate — widen the seam:

```ts
export type RegisteredTool =
  | { kind: "builtin"; manifest: ToolManifest; impl: ToolImplementation }
  | { kind: "external"; manifest: ToolManifest; installDir: string };
```

`ToolHost` touches only `tool.manifest.id`, verified 2026-08-30, so it is unaffected beyond the type. `inProcessRunner` and `workerRunner` narrow on `kind` and throw on the wrong one. `registry.ts` wraps the five built-ins; `TOOLS` keeps its meaning as "the built-ins" and gains a sibling for the installed externals.

**Landed 2026-08-31 (land-placement-slice4-brief.md item 1), a third arm ahead of this one:** `RegisteredTool` is built in `src/tools/registry.ts` with `builtin` and `{ kind: "panel"; manifest: ToolManifest; component: unknown }` — `panel` for land-placement-design.md Sec.3.2's panel tools, `external` (above) still unbuilt and reserved for this phase. **The obligation this phase owes and has not yet paid**: whatever builds the loader that turns installed JSON into an `external` `RegisteredTool` entry must reject a manifest declaring `surface: "panel"` at that boundary. A `panel` arm carries a React component — a function — and JSON cannot carry one, so today an external manifest can never produce a `panel` entry **by construction**; that guarantee holds only as long as the loader never does something clever to route around it (e.g. resolving a `component` field by string lookup). One line of code, at the loader, when it is written.

**`ToolsPane` gains one branch, not a mode.** It already builds `ToolContext<ParseResult>` gated per capability. For an external tool it hands that same object to the external runner, which serializes it. The pane does not learn about transports; the runner selection it already performs by id (`WORKER_RUNTIME_TOOL_IDS`) becomes selection by `kind`.

**`AdvancedToolsSettings` becomes the install surface.** Its own comment lists "a v1.1 registry URL" among what it deliberately does not offer; what it acquires now is the installed list with sources and capability summaries, Install, Enable/Disable, Uninstall, and the "found but not installed" report. Its help entry needs rewriting in the same session, for the reason the pane's own history records: a settings tab that describes a feature inaccurately while the user is looking at it is the defect that copy was already rewritten once to fix.

**Rust gains one command and one dependency set.** `run_extension_process`, plus whatever the job-object handling needs. No shell plugin. `capabilities/default.json` gains nothing, because a bespoke command needs no scope entry.

**`ui-help.json` gains entries for every new interactive element**, per CLAUDE.md's standing rule that new interactive UI is wrapped in `HelpTip`. The Runtimes panel, the install controls and the consent dialog are all new surface.

## 11. Publishing the contract

### 11.1 `PROTOCOL.md`

Rev 10 Sec.8 specifies its contents in detail and the file does not exist. Writing it is a Phase 6 deliverable, not a follow-up. Its non-negotiable contents, from that section: the sentinel encode/decode **and** that it is external-wire only; the prohibited value set; "build your own `LanguageIndex`"; the def re-derivation recipe with its name-lookup, token-index and variadic caveats; **the alias algorithm verbatim, not paraphrased** — a paraphrase shipped once here and diverged from the parser in two expressible cases; the offsets-versus-line-numbers rule; the `override_map_size` resolution rule including that a land command is identified after alias resolution; the selection-is-an-anchor note; and the per-language cancel-delivery recipe.

Add three things that section predates: the per-run reference-data cost (Sec.7.3), that a blocking-stdin tool is killed as `unresponsive` by design (Sec.8), and the exit-without-terminal rule.

### 11.2 The bundled `.d.ts`

Rev 10 Sec.8 says the published artifact is a bundled declaration file flattening the parser's plain-data types in, which is possible precisely because the contract's imports from `src/parser` are type-only and ESLint enforces that (`eslint.config.js` has carried a `tools-api/**` purity block since 2026-08-14). Generate it, attach it to GitHub releases, and gate it the way `check:generated-types` gates the game-constants type: a check that goes red the day the contract changes and the published surface does not. Do not publish to npm in this phase — it is a second release channel with its own versioning obligations, and nothing yet needs it.

### 11.3 The stub tool: one artefact, three jobs

Write one deliberately misbehaving reference tool, in Node, since Node is the one runtime CI is guaranteed to have. Driven by its own first argument, it can: answer correctly; emit malformed JSON; emit well-formed JSON that is not a `ToolMessage`; emit a `severity` with an invalid level; emit a `table` whose `rowSpans` length disagrees with `rows`; emit a line over the inbound cap; propose edits without declaring `edit-source`; propose overlapping edits; ignore `cancel`; go silent past the watchdog; exit non-zero; exit zero with no terminal message; spawn a child and orphan it; and write non-ASCII to stderr forever.

It is simultaneously the **test fixture** for Sec.15, the **conformance target** the harness runs against, and the **worked example** an author reads. Three jobs, one artefact, and every failure path in this document gets exercised by something that actually exists.

### 11.4 Conformance

Rev 10 Sec.9 item 11 states its own honest limit: it verifies the recipe _this repo publishes_ against the parser's behaviour, and "cannot tell you that an external author in another language implemented the recipe correctly. That remains PROTOCOL.md's job and a conformance fixture's, neither of which exists in v1."

Build the fixture. A driver script feeds a candidate tool a fixed sequence of host messages over the real transport and checks its answers: a context containing `inf` and `-inf`, an aliased-command fixture whose def is recoverable only through the `#const` path, a fixture whose `def` slots must not be read, and a cancel mid-run. An author in any language runs it and gets a pass or a specific failure. This is the only mechanism in the whole design that can tell a Python author their alias handling is wrong before their users find out.

## 12. The registry, deferred but not designed away

Not built in this phase. Discovery is a link in the README and the Discord, which is honest about where this ecosystem actually is: **zero external tools exist today**, so a registry schema now would be a guess about metadata a population of zero has not asked for.

What this phase does owe it, and pays in full:

- `source: { kind, url?, sha256? }` in the install record, so a registry install is a new `kind` rather than a migration of files already on users' disks.
- `apiVersion` recorded per install, so a future registry can answer "which tools work with your app version" without probing.
- Consent-on-widened-capabilities (Sec.9.3), which is the rule an update channel needs and which cannot be retrofitted honestly.

What it must not acquire quietly: a paid tier. PLAN.md's GCUR posture binds the registry as a condition rather than a preference, permanently, and `docs/source-languages-design.md` Sec.9 says the same about packs.

## 13. What external tools cannot do, and the capability that would fix it

**Three of the five built-ins are expressible as external tools and two are not** (measured 2026-08-30 by reading their imports). `scriptStats` and `constantsAuditor` import only parser types and `lineNumberOfOffset`; `scriptFormatter` adds its own formatter module and a direct `language.json` import, which an external port would take through `read-reference` instead. `consistencyChecker` and `balanceSummary` both import the preview generator and `previewBridge`.

Rev 10 Sec.3 states the boundary honestly — "the contract is portable, a given tool's dependencies may not be" — but it is worth naming the strategic shape of it, because it is uncomfortable:

**The single most valuable thing an external tool could do is the one thing the wire cannot carry.** Monte Carlo generation is what makes the flagship tool the flagship, and an external author gets a parse and no generator. So the external ecosystem this phase opens is, for now, an ecosystem of static analysers, linters, formatters and reporters. Those are genuinely useful and three shipped built-ins prove the shape works. But nobody outside this repo can write a second consistency checker.

Two ways out, both explicitly deferred and recorded so a later reader knows they were considered:

- **Extract the generator into a standalone library** that an external tool can depend on directly, in its own language or via a compiled artifact. Large, and it makes the generator a published surface with compatibility obligations.
- **A `run-generation` capability**, where the _host_ runs generations on the tool's behalf and streams results back. This inverts the dependency and keeps the generator private. It is a real answer, it costs a new message pair in the protocol, and it must not be invented while the transport it would ride on has never run. **Revisit once external tools exist and someone asks.**

## 14. Phasing

Ordered so that each step is testable before the next exists.

**6.1 — The codec. No process, no UI.** The encoder (Sec.7.1), `numeric()`'s first real consumers, and **BUG-017's two test suites** (round-trip over every message kind, an `Infinity` fixture, a corpus parse, the four def-reconstruction fixtures). Fix Sec.3.3's size check in the same session, since the encoder is what makes the correct check possible. Nothing user-visible ships. This is the largest single risk in the phase and it is testable in plain Node.

**6.2 — The transport, against the stub tool.** The Rust `run_extension_process` command, job-object kill, `CREATE_NO_WINDOW`, channel streaming, byte-accurate inbound cap, stderr ring buffer, the external `ToolRunner`, and the Sec.10 `RegisteredTool` widening. Driven entirely by the Sec.11.3 stub, so every failure path is exercised without a real third-party tool existing.

**6.3 — The extension layer.** Directory layout, install records, validation at registration, the consent dialog and its per-kind copy, Settings > Runtimes, and the `AdvancedToolsSettings` rework. This is the first step a user can see.

**6.4 — Publishing.** `PROTOCOL.md`, the bundled `.d.ts` and its drift gate, the conformance harness, and the stub promoted to a documented worked example.

**6.5 — Deferred.** The registry (Sec.12) and any `run-generation` conversation (Sec.13).

6.1 and 6.2 ship no user-visible feature, which is deliberate and is the same argument `docs/source-languages-design.md` Sec.11 makes about its own Phase A: the part that will be got wrong is the part with no UI, and it is testable long before anything is clickable.

## 15. Test plan

1. **Round-trip, per `ToolMessage` kind**, hand-built fixtures under `toStrictEqual`, plus an `Infinity`/`-Infinity` fixture and a corpus parse under `toEqual`. BUG-017 item 1.
2. **Def reconstruction from the wire form**, the four fixtures rev 10 Sec.9 item 11 names, including the aliased-command case that goes red the day the parser learns a new way to resolve a name. BUG-017 item 2.
3. **The encoder does not mutate.** Encode a parse, then assert the source tree still holds real `Infinity` and real `def` pointers. This is the guard for rev 10 Sec.4.2's three named Breakdown call sites.
4. **Prohibited kinds throw.** One case per entry in `PROHIBITED_VALUE_KINDS`, asserting a `host-error` and not a silently-emitted `{}`. Assert against the frozen list, not a literal list in the test body, so a new entry fails until covered.
5. **Inbound cap is enforced during accumulation.** A stub emitting more than the cap with no newline terminates with `reason: "protocol"`; assert the host's memory did not grow to hold it, by capping what the reader is permitted to buffer rather than by measuring.
6. **Cap arithmetic is bytes, not code units.** A line of multi-byte characters whose UTF-16 length is under the cap and whose byte length is over it is rejected.
7. **Every `ErrorReason` is reachable and correctly attributed** — one stub mode each for `tool-error`, `cancelled`, `killed`, `unresponsive`, `protocol`, `host-error`. Assert `killed` and `cancelled` stay distinct, since collapsing them is the specific defect the contract calls out.
8. **Process-tree kill.** A stub that spawns a child and ignores cancel leaves no surviving descendant after the grace expires.
9. **No console window.** Asserted by construction on the creation flags, since it cannot be observed headlessly. Say so in the test name rather than implying more coverage than exists.
10. **Path escape is refused Rust-side** — `entry` values with `..`, absolute paths, and symlinks pointing outside the extension directory, each rejected before spawn.
11. **Consent cannot be bypassed.** A folder placed under `extensions/tools/` with no record does not appear in the dropdown and cannot be run by id. Assert at the runner, not at the UI.
12. **Consent copy per kind**, both directions: the tool copy makes a full-privilege claim and does not claim to interpret the user's source file; adding a kind without copy fails to compile (assert via a type test, as `wireTypes.test-d.ts` already does for the wire types).
13. **Widened capabilities re-ask.** Update a manifest from `read-ast` to `read-ast, edit-source` and assert the dialog is shown again; narrowing does not.
14. **`apiVersion` mismatch rejects**, and the tool is listed as rejected with both versions rather than vanishing.
    14b. **Runtime probes** (Sec.5.2), against fake runtime binaries the test controls, since CI has no Python and no Racket: a known `id` uses the app's probe **and ignores a manifest pattern that would have produced a different answer** — assert the app's answer wins, which is the only test that distinguishes "ignored" from "never consulted"; an unknown `id` uses the manifest fallback; a version below `minVersion` fails before spawn, naming both versions; a runtime that is absent and a runtime whose version cannot be parsed produce **different** messages; a fallback pattern using lookahead or a backreference is rejected at **registration**, not at run time; and a runtime writing its version to stderr is read correctly under the default `versionStream: "both"`.
15. **Edits from an external tool go through the existing gates** — `validateEdits` whole-set rejection, the snapshot equality check at Apply, and the drop-with-warning for a tool that never declared `edit-source`. These already pass for built-ins; assert they hold over the wire.
16. **Built-in behaviour is unchanged.** The existing suite, green, with the `RegisteredTool` widening in place. This is the regression bar for 6.2.
17. **Conformance harness against the stub**, in both its conforming and each of its non-conforming modes, so the harness is known to fail before anyone trusts it to pass.

## 16. Open questions

1. **Does a tool get to persist anything between runs?** Today the answer is no by construction: one process per run, no file paths, no fs. A linter wanting a cache has nowhere to put it. Leaving it closed is the safe default and it is the kind of thing an author will ask for within a week. If it opens, it opens as a declared capability with a host-managed directory, never as fs access.
2. ~~**`versionPattern` is a regex from a manifest.**~~ **RESOLVED 2026-08-30 — Sec.5.2.** App-shipped named probes for `KNOWN_RUNTIMES`, with a manifest-supplied RE2 pattern surviving only as the escape hatch for an id nothing else can be using. Decided on the contested-shared-key argument and on the app already owning the hard nine tenths of Windows runtime discovery, not on the ReDoS argument, which Sec.5.2 retires. What stays open is only the membership of `KNOWN_RUNTIMES`, which should be decided by what tool authors actually turn up with rather than guessed at now — three is a starting set, not a measurement.
3. **What happens to a running tool when its extension is uninstalled or disabled?** `ToolHost.documentReplaced()` is the precedent for "the ground moved under a run", and the answer is probably the same: terminate with `cancelled` and say why. Confirm rather than assume.
4. **Is `enabled: false` worth having at all in this phase?** It is one field and it lets a user keep a tool without loading it. It is also a state that has to be honoured in the dropdown, the runner and Settings, and it has no user asking for it yet.
5. **How does a user get an update?** Local install means "download the new zip and install over the old one". The record supports it (Sec.9.3 covers the consent side), but nothing tells the user an update exists. That is a registry job, and until there is one the honest answer is the tool's homepage.

## 17. Amendments this document owes other specs

Do not fold these in from here; each belongs to its own document's next revision, and this list is what that revision should carry.

- **`CREATION_PLAN.md` Phase 6:** "Tauri shell plugin" is superseded by a bespoke Rust command (Sec.6.1). The brief's registry sentence is narrowed to Sec.12's deferral.
- **`docs/source-languages-design.md` Sec.9 and Sec.11:** the tool-versus-pack danger asymmetry is inverted for _external_ tools (Sec.9.1). The M6-first ordering stands on its other stated reason; the safety justification does not. Sec.13 q3's build-history location is answered by Sec.4.1.
- **`docs/source-languages-design.md` Sec.5.1, Sec.5.3, Sec.13 q4 and goal 4:** q4 is answered by Sec.5.2 and packs inherit the answer, since Runtimes is one shared panel and one shared resolution path — a pack manifest naming `python` gets the app's probe, and `versionArgs`/`versionPattern` leave its Sec.5.1 example. Goal 4 ("no app release, no app code, no PR to this repo") is **narrowed and should say so**: a language whose runtime is unknown to the app still ships day one through the escape hatch, but only by declaring an RE2 pattern, and a pack author who wants first-class discovery needs a probe merged here. That is a smaller promise than the one currently written.
- **`docs/tools-api-design.md` Sec.8:** the `PROTOCOL.md` contents list gains the three items in Sec.11.1. Sec.10's Windows bullet gains the job-object and console-window specifics from Sec.6.3.
- **`docs/known-issues.md` BUG-017:** re-file as a Phase 6 prerequisite rather than tracked debt, per Sec.3.2.
- **`docs/tool-author-preview.md`:** its closing section describes the manifest as gaining "entry (executable + args), language, author, homepage" and names the Tauri shell plugin. Both are superseded by Sec.5.1 and Sec.6.1. This is the one document with an outside audience, so it should be corrected when the shape is settled rather than when the code lands.
