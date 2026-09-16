# Advanced Tools — author preview

This is an early look at the Advanced Tools contract, for anyone thinking
about writing a tool once external tools ship. **You can't plug an external
tool into the app yet.** Today's five tools are all built-in — bundled into
the app itself, running in-process. Phase 6 (v1.1, not yet scheduled) adds
external tools: a separate executable plus a manifest, spawned as a child
process and speaking the identical protocol over stdin/stdout. That's the
point of this document — the contract a v1.1 tool will speak is _already
finalized and running in production_ today, just with the transport nailed
down to "in-process" for now. Nothing below should change shape by the time
external tools land; only the transport is missing.

The real contract, byte for byte, is [`tools-api/index.ts`](../tools-api/index.ts)
— it's short, fully commented, and this document is a guided tour of it, not
a replacement for it. The full design rationale is
[`docs/tools-api-design.md`](tools-api-design.md) (rev 10) if you want the
"why" behind a given rule.

## The core idea: one contract, two transports

A tool is a pure function of _context in, messages out_. It never touches
the filesystem, never renders its own UI, and never mutates anything it's
handed. It receives a `ToolContext` describing the open script and whatever
else it declared permission to see, and it streams `ToolMessage`s back
through a callback — progress, a result, or an error. The app (the "host")
owns the pane, the Run/Cancel buttons, and turning the tool's declarative
output into pixels.

Because the contract is transport-agnostic, a built-in tool and a future
external tool are indistinguishable above this layer. A built-in's `run()`
is called directly with real JavaScript values (real `Infinity`, real object
references); an external tool will receive the same messages as NDJSON lines
over stdin/stdout, with a couple of encoding differences described below.

## The manifest

Every tool declares a `ToolManifest`:

```ts
{
  id: "my-tool",              // stable, kebab-case
  name: "My Tool",
  version: "1.0.0",           // the tool's own semver
  apiVersion: TOOLS_API_VERSION,
  description: "...",
  capabilities: [...],        // see below — everything undeclared is denied
  params: [...],              // optional run-configuration form
}
```

The host validates a manifest at registration, not just at run time — a
`select` param whose declared default isn't one of its own options, or a
`multiSelect` declaring `default: []` alongside `minSelected: 1`, is rejected
before it ever reaches a user, rather than shipping a form nobody can submit.

### Capabilities

Everything a tool can see is opt-in and named:

| Capability                 | Grants                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read-source`              | The raw script text.                                                                                                                                                   |
| `read-ast`                 | The parsed AST (implies `read-source`).                                                                                                                                |
| `read-generation-settings` | Player count, map size, and team layout — nothing else from the settings store.                                                                                        |
| `read-reference`           | The full language and game-constants reference data (~1.37 MB) — needed to resolve what a command or constant _is_, since the wire form of the AST strips definitions. |
| `read-selection`           | Where the user's cursor/selection anchor currently is.                                                                                                                 |
| `edit-source`              | Permission to propose text edits back into the script.                                                                                                                 |

Declare only what you use. This isn't just politeness — in v1.1 it's the text
of the consent dialog a user sees before running an unfamiliar external tool.

### Params

Four scalar types (`integer`, `boolean`, `text`, `select`) plus `multiSelect`
for anything that needs several values at once (the consistency checker's
player-count matrix, for instance). The host renders the form and validates
every value against its own declared constraints before your tool ever sees
it.

## The context you receive

```ts
run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle
```

`run()` must return immediately — `ToolRunHandle.cancel()` is how the host
asks you to stop, and every result flows through `emit`, not through the
return value. `ctx` carries only the fields your declared capabilities
unlock; an undeclared field is simply absent, not empty or null.

One field is worth knowing about up front if you want your tool to work
identically in-process and externally: `ctx.parseResult`. In-process, it's
the real, fully-typed `ParseResult`. Over the external wire, numbers become
`number | InfSentinel` (plain JSON can't carry `±Infinity`, and
`JSON.stringify(Infinity)` silently becomes `null` — the sentinel exists so
that failure mode is a compile error instead of corrupted data) and every
`def` field becomes `unknown`, because a command's identity over the wire
comes from `ctx.referenceData`, not from a pointer into a table you don't
have. Writing your tool against the published `ToolContext` type (rather than
the in-process one) makes both of these a compile-time concern rather than a
runtime surprise — decode a number with the exported `numeric()` helper and
it works on either transport.

## What you can output

```ts
type OutputBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "keyValue"; rows: [string, string][] }
  | {
      kind: "table";
      columns: string[];
      rows: string[][];
      rowSpans?: (Span | null)[];
    }
  | {
      kind: "severity";
      level: "info" | "warning" | "error";
      text: string;
      span?: Span;
    }
  | { kind: "codeRef"; text: string; span: Span };
```

Tools render nothing themselves — output is entirely declarative, and the
pane draws it. `Span`s (on `table` rows, `severity`, and `codeRef`) make a
row or a message clickable, jumping the Code tab straight to that offset.
Two things worth internalizing before your first tool: a `Span` is a raw
character _offset_, but any location you name in prose text should be a
1-based _line number_ — converting the wrong way is a real defect this app
shipped once and had to fix. And there's no markdown or HTML in `text`
blocks in v1 — plain text with `\n` only.

If your tool declared `edit-source`, a final `result` message may carry
`edits: TextEdit[]` — `{ start, end, newText }` ranges the host applies only
when the user clicks Apply, never automatically.

## The message stream

```ts
type ToolMessage =
  | { type: "progress"; fraction?: number; note?: string }
  | { type: "partial"; output: ToolOutput } // replaces the pane's output — never a delta
  | { type: "result"; output: ToolOutput; edits?: TextEdit[] }
  | { type: "error"; message: string; reason: ErrorReason };
```

Emit `progress` for anything that takes real time — a `fraction` renders a
progress bar, omit it for an indeterminate spinner. `partial` is for a tool
that wants to show interim results on a long run (the consistency checker's
Monte Carlo pass does this); each one is a complete, self-contained
`ToolOutput`, not an increment to apply on top of the last.

## Limits you're building against

These are exported as `LIMITS` and `DEADLINES` in the contract, not
invented by convention — the host enforces them:

- **1,000 blocks** and **10,000 rendered table rows** per output. If you have
  more to say, group it into a `table` rather than one block per finding —
  the consistency checker had to fix exactly this to ship.
- **~9.5 MB** is the largest context payload measured across the current map
  corpus (a def-stripped parse plus reference data); the outbound cap is
  32 MB, and exceeding it is a host-side error naming the script, never a
  silent truncation.
- **60 seconds** of silence (no message at all) triggers the run watchdog —
  this bounds one unit of your own work between `emit` calls, not your
  tool's total runtime. A checker-style tool that chunks and reports
  progress every generation can legitimately run for 8–30 minutes.

## What's deliberately not in the contract

No file paths, no filesystem access, no arbitrary network calls, and no
access to view-only state like the preview's current seed or its
Current/Final cut point — those are UI state, not script state, and a tool
that genuinely needs them is a case for a future, separately-declared
capability rather than a silent widening of an existing one.

## Five worked examples

All five ship in [`src/tools/builtin/`](../src/tools/builtin/) and are
registered in [`src/tools/registry.ts`](../src/tools/registry.ts) — reading
the smallest one (`scriptStats.ts`, `read-ast` only, no params) is the
fastest way to see the whole contract in miniature before tackling
`consistencyChecker.ts`, which uses nearly every corner of it (a worker
transport, `read-reference`, a `multiSelect` param, `ownsSettingsHeader` to
suppress the pane's own settings echo in favor of its own multi-count
report header).

| Tool                           | Capabilities                                                            | Notable for                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Script Statistics              | `read-ast`                                                              | The minimal template.                                                                         |
| Generation Consistency Checker | `read-source`, `read-ast`, `read-generation-settings`, `read-reference` | Monte Carlo runs, a player-count `multiSelect`, `ownsSettingsHeader`.                         |
| Constants Usage                | `read-ast`                                                              | Read-only, no generation, no worker needed.                                                   |
| Balance Summary                | `read-ast`, `read-generation-settings`, `read-reference`                | A second Monte Carlo consumer, same worker transport as the checker.                          |
| Script Formatter               | `read-ast`, `read-source`, `edit-source`                                | The only tool with `edit-source` today — the reference for how to propose `TextEdit`s safely. |

## Where this is headed

Phase 6 (v1.1) adds the second transport: a manifest with `entry` (executable

- args), `language`, `author`, and `homepage`, spawned through Tauri's shell
  plugin, with an unvetted-tool warning dialog naming exactly the capabilities
  above before a user runs anything they didn't write themselves. A curated
  registry (a JSON file in a separate repo, PR-able by the community) is the
  plan for discovery. None of that is built yet, and the details are
  deliberately deferred until v1 has shipped and real tool authors — maybe you
  — have had a chance to react to this document.
