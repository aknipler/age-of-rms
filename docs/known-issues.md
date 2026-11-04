# Known issues, Age of RMS

Open bugs in the Age of RMS app, grouped by the subsystem they affect (Breakdown, Preview Engine, Advanced Tools, Others). Only open entries live here, so this file stays short enough to read before starting work. When a bug is fixed or closed, move its entry word for word to the end of `docs/build-log.md` and delete it from this file.

Closed entries up to 2026-09-23 are in `docs/build-log.md` under "Closed known-issues entries, moved 2026-09-23". Older code comments and docs that cite `known-issues.md` BUG-NNN for a closed bug point there. BUG numbers run in filing order across the whole project, so grep `docs/` for the highest one in use before filing a new one.

Write each entry as symptom, reproduction, root cause (with file:line), prescribed fix, verification.

---

## Breakdown

No open entries.

---

## Preview Engine

No open entries.

---

## Advanced Tools

**Tracked, minor, non-blocking** (spec-text-vs-implementation drift found in the same review as BUG-017, whose entry is now in the build log, none of it a correctness bug — noted here so it doesn't silently decay):

- `src/tools/checkerWorker.ts`'s `CheckerWorkerRequest` is a purpose-built type, not the `HostMessage<P>` `tools-api-design.md` Sec.4.3/7.2 item 4b prescribes adding for exactly this worker. Functionally fine (`msg.context` still typechecks with no cast) but means `HostMessage<P>` still has zero real consumers in-tree — the same fact earlier review rounds flagged as the reason the bug it was meant to fix went unnoticed.
- `src/tools/builtin/formatter/layout.ts`'s `hasNonAttributeItems` (inline/compact-block gating) refuses more item kinds (`command`, `orphanBlock`, `raw`, `directive`) than `formatter-design.md` §3.3 asks for (only conditionals). Likely intentional, but the spec prose was never widened to match.
- `layout.ts`'s `canInline` only refuses a block containing a `RawNode` when the raw span itself is multi-line; §3.3 states the refusal unconditionally for any `RawNode` at any depth. Documented in-code as deliberate, but the spec text was never updated to match the looser behavior actually shipped.

---

## Others

None open.
