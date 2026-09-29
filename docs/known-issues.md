# Known issues, Age of RMS

Open bugs in the Age of RMS app, grouped by the subsystem they affect (Breakdown, Preview Engine, Advanced Tools, Others). Only open entries live here, so this file stays short enough to read before starting work. When a bug is fixed or closed, move its entry word for word to the end of `docs/build-log.md` and delete it from this file.

Closed entries up to 2026-09-23 are in `docs/build-log.md` under "Closed known-issues entries, moved 2026-09-23". Older code comments and docs that cite `known-issues.md` BUG-NNN for a closed bug point there. BUG numbers run in filing order across the whole project, so grep `docs/` for the highest one in use before filing a new one.

Write each entry as symptom, reproduction, root cause (with file:line), prescribed fix, verification.

---

## Breakdown

No open entries.

---

## Preview Engine

### BUG-029 — 2026-09-17 — connection endpoints are guide-sourced, not measured

**Status:** OPEN, verify item. **SCRIPTS WRITTEN 2026-09-21, NOT YET RUN.** **Area:** `src/preview/generator/connections.ts`, `docs/preview-design.md` Sec.6.5. The 2026-09-17 fix (roads stopped one land radius short of every TC on the tutorial's Golden Hill) moved connections from nearest-edge to origin-to-origin on the guide's word (guide:1730, 1759, 1792) and one in-game observation that the road reaches the TC. Two consequences of that model have no RMSTEST_* run behind them and are worth one: that a cost-0 terrain under a land ORIGIN blocks connections to that land in BOTH directions (guide:1937, the engine may well still depart from it), and that the road's `terrain_size` disc paints over the player's own land right up to the origin tile rather than stopping at the land edge.

**Both now have scripts, tracked in `tools/scenario-probe/rmstest/README.md`'s Batch 18, ready to run against a real DE install.** `RMSTEST_75a_costzero_origin_blocked` / `RMSTEST_75b_costzero_origin_control` (a matched pair) put three lands under one `create_connect_all_lands`, one of them wholly cost-0 terrain and placed off the other two's line, and check that connections to it fail from BOTH of its potential neighbours rather than just one — the withdrawn per-tile model's own asymmetry (depart from anywhere the land's tiles touched, arrive only through its own passable tiles) is exactly the shape of bug this is checking was not carried forward into the origin-to-origin rewrite. `RMSTEST_76_terrainsize_intrudes_origin` checks the second consequence directly: a deterministic, variance-free `terrain_size` disc on a road running to a land's origin, reading whether ROAD tiles appear inside the land's own former footprint or stop at its edge.

---

## Advanced Tools

**Tracked, minor, non-blocking** (spec-text-vs-implementation drift found in the same review as BUG-017, whose entry is now in the build log, none of it a correctness bug — noted here so it doesn't silently decay):

- `src/tools/checkerWorker.ts`'s `CheckerWorkerRequest` is a purpose-built type, not the `HostMessage<P>` `tools-api-design.md` Sec.4.3/7.2 item 4b prescribes adding for exactly this worker. Functionally fine (`msg.context` still typechecks with no cast) but means `HostMessage<P>` still has zero real consumers in-tree — the same fact earlier review rounds flagged as the reason the bug it was meant to fix went unnoticed.
- `src/tools/builtin/formatter/layout.ts`'s `hasNonAttributeItems` (inline/compact-block gating) refuses more item kinds (`command`, `orphanBlock`, `raw`, `directive`) than `formatter-design.md` §3.3 asks for (only conditionals). Likely intentional, but the spec prose was never widened to match.
- `layout.ts`'s `canInline` only refuses a block containing a `RawNode` when the raw span itself is multi-line; §3.3 states the refusal unconditionally for any `RawNode` at any depth. Documented in-code as deliberate, but the spec text was never updated to match the looser behavior actually shipped.

---

## Others

No open entries.
