# Age of RMS

A free, open-source Windows desktop app that lowers the barrier of entry to Age of Empires II: Definitive Edition Random Map Script (RMS) creation, and aims to be a single home for community-made RMS tools.

## What it does

- **Breakdown editor** — a beginner-friendly, block-based view over your RMS code (Player Setup, Land, Elevation, Cliff, Terrain Connection, Objects). Edit dropdowns and value fields instead of raw syntax; unrecognized code falls back to a raw block so nothing you write is ever destroyed.
- **Code editor** — a full Monaco editor with RMS syntax highlighting, hover docs, search, and diagnostics.
- **Approximate map preview** — a quick, clearly-labeled canvas preview of what your script will generate, with a Current/Final toggle.
- **Advanced Tools** — a pane for built-in (and later, community-contributed) tools that operate on your script.

Code is always the single source of truth. Breakdown and preview are views generated from it; editing in Breakdown patches the underlying code with minimal, comment-preserving text edits.

## Status

Early development (Phase 0 — foundation). Not yet usable. See `PLAN.md` for the full design and `CLAUDE.md` for current build status.

## Tech stack

Tauri 2 (Rust backend, kept thin) + React/TypeScript frontend, Monaco editor, DE-only targeting.

## Getting started (development)

```
npm install
npm run tauri dev
```

Requires Node LTS, Rust (via rustup), and on Windows the "Desktop development with C++" Visual Studio Build Tools workload.

## License

GPL-3.0. See `LICENSE`.

## Contributing

See `CONTRIBUTING.md`. This project is aimed at the AoE2 RMS community, including casual/first-time contributors.
