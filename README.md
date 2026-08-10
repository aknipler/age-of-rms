# Age of RMS

A free, open-source Windows desktop app that lowers the barrier of entry to Age of Empires II: Definitive Edition Random Map Script (RMS) creation, and aims to be a single home for community-made RMS tools.

## What it does

- **Breakdown editor**, a beginner-friendly block-based view over your RMS code (Player Setup, Land, Elevation, Cliff, Terrain, Connection, Objects). Edit dropdowns and value fields instead of raw syntax. Unrecognized code falls back to a raw block, so nothing you write is ever destroyed.
- **Code editor**, a full Monaco editor with RMS syntax highlighting, hover docs and search.
- **Live checking**, 48 diagnostic codes covering unclosed blocks, unknown names, argument problems and semantic mistakes the game reports no error for. Several catch lines that parse cleanly and then do nothing in game, such as an attribute whose required partner is missing, or a command sitting in a section the engine will not run it from.
- **Approximate map preview**, a canvas render of what your script generates, with zoom and pan, a game or minimap colour mode, hover and click readouts for any tile, and a notes drawer listing every approximation and placement failure.
- **Reference panel**, sharing the preview column. Look up terrains, objects and commands, and read a list of every object your script names beside how many of it the last generation actually placed, zeroes included. An object the script asks for and the map never gets is the usual sign of a terrain restriction or a distance band nothing can satisfy.
- **Advanced Tools**, a pane for built-in and community-contributed tools that operate on your script. Specified, not built yet, and currently a placeholder.

Code is always the single source of truth. Breakdown and preview are views generated from it, and editing in Breakdown patches the underlying code with minimal, comment-preserving text edits.

The preview is an approximation and can always be improved. It reproduces the engine's own rules where those have been measured in game, and marks what it cannot model rather than drawing a confident guess.

## Status

In development, and usable. The editor, the parser and the map preview (not 100% perfect, feedback always welcome) are all built. Advanced Tools is the remaining pane.

## Tech stack

Tauri 2 with a deliberately thin Rust backend, a React and TypeScript frontend, the Monaco editor, targeting DE only.

## Getting started (development)

```
npm install
npm run tauri dev
```

Requires Node LTS, Rust (via rustup), and on Windows the "Desktop development with C++" Visual Studio Build Tools workload.

Useful checks while working.

```
npm test                    # Vitest suite, the primary gate
npm run typecheck
npm run lint
npm run validate:reference  # schema and integrity checks on reference/data
```

## License

GPL-3.0. See `LICENSE`.

## Contributing

See `CONTRIBUTING.md`. This project is aimed at the AoE2 RMS community, including casual and first-time contributors.
