# CLAUDE.md — Age of RMS

Read this file and `PLAN.md` (in the parent `AOE2_projects/RMS` folder, one level up from this repo) at the start of every session before doing anything else.

## Project summary

Age of RMS is a free, open-source Windows desktop app (Tauri 2 + React/TypeScript, Rust backend kept thin) that lowers the barrier to writing Age of Empires II: Definitive Edition Random Map Scripts (RMS). Its centerpiece is a "Breakdown" editor — a beginner-friendly, block-based UI that is a *view over the underlying RMS code*, not a separate model: every edit in Breakdown is applied back to the code as a minimal text patch, and code is always the single source of truth. It also ships a Monaco-based code editor with RMS syntax highlighting/hover docs, an approximate map preview, and a pane for advanced community-built tools. DE only. GPL-3.0.

Full design/decisions/milestones live in `PLAN.md`. Step-by-step build plan (which model to use per step, learning goals) lives in `CREATION_PLAN.md`. Both are one level up, in the parent project folder, since they're workspace planning docs rather than repo source — read them from there.

## Tech stack

- **Frontend**: React + TypeScript (strict mode), Vite, Monaco editor (`@monaco-editor/react`).
- **Backend**: Rust via Tauri 2, kept intentionally thin (fs, dialogs, process spawning only — no business logic).
- **Testing**: Vitest.
- **Linting/formatting**: ESLint + Prettier (Prettier defaults).

## Code conventions

- TypeScript strict mode everywhere.
- Functional React components with hooks only — no class components.
- Prettier defaults; don't hand-format, let the tooling own it.
- Parser (once built, Phase 2) is the one source of truth for the AST — Breakdown, diagnostics, resource totals, and preview all consume it rather than re-deriving their own model.
- Unparseable/exotic RMS code must degrade to a raw code block in Breakdown, never crash or silently drop content.

## Repo map

```
src/              React frontend (components, editor integration, parser, breakdown UI, preview, tools pane, reference-data client)
src-tauri/        Rust backend (thin — fs, dialogs, process spawning; Tauri config, capabilities)
reference/        Versioned JSON: game constants, language definition, doc strings (see PLAN.md "Reference DB approach")
docs/             Design specs produced by strong-model sessions (parser-design.md, breakdown-design.md, preview-design.md) and contributor/tool-author guides
test-maps/        Real community .rms files used as parser/breakdown test fixtures
tools-api/        Contract spec for Advanced Tools (internal v1, external process+manifest v1.1)
.github/workflows/ CI: lint + typecheck + test on PR
```

(`src/` and `src-tauri/` currently hold only the scaffold — Phase 0 output. Other folders above are planned but not yet created; create them when the corresponding phase starts.)

## Current status

**Phase 0 — Foundation (M0): complete.**

- 0.1 Toolchain installed and verified (Node, Rust, MSVC Build Tools, Git) — done.
- 0.2 Tauri 2 + React + TypeScript + Vite scaffold created (`npm create tauri-app@latest`), `npm run tauri dev` confirmed working — done.
- 0.3 Repo/license/context files (this file, LICENSE, README.md, CONTRIBUTING.md, ESLint/Prettier/Vitest config, CI workflow) — done. `git init`, first commit, and push to GitHub — done, repo is live.
- Ran `npm approve-scripts esbuild` to approve esbuild's postinstall (npm 11's new install-script allowlist; expect to hit this again for other native-binary deps).
- Ran `npm audit fix --force`, which bumped vitest 2 → 4 (breaking change, accepted now while only the placeholder smoke test exists — cheapest possible time to take it). Re-verify `npm test`/`npm run typecheck` still pass after this and note here if vitest 4 required config changes.

**Not yet started**: Phase 1 (editor core: app shell, file open/save, Monaco integration, RMS syntax highlighting, reference DB, hover docs). Start with 1.1 (app shell UI) next session.

Update this section at the end of every session so the next session (possibly a different model) knows where things stand.
