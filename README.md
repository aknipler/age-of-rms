# Age of RMS ![Downloads](https://img.shields.io/github/downloads/aknipler/age-of-rms/total)

A free, open-source desktop app that lowers the barrier of entry to Age of Empires II: Definitive Edition Random Map Script (RMS) creation.

## What it does

- **Breakdown editor**, a beginner-friendly block-based view of our RMS code. Edit dropdowns and value fields instead of raw syntax.
- **Code editor**, a full Monaco editor with RMS syntax highlighting, hover docs and search.
- **Advanced Live Diagnostics**, 48 diagnostic codes covering unclosed blocks, unknown names, argument problems and semantic mistakes the game reports no error for. Also catches lines that parse cleanly and then do nothing in game, such as an attribute whose required partner is missing, or a command sitting in a section the engine will not run it from.
- **Tutorials**, step-by-step guides to help you learn how to write RMS using either the Breakdown editor or the Code editor.
- **Map preview**, a canvas render of what your script generates including a notes drawer listing every placement failure and a list of every object placed with the option to hide objects for testing viewability.
- **Reference panel**, look up terrains, objects, commands and the attributes each command accepts.
- **Advanced Tools**, a pane of built-in tools that analyze or edit your script: advanced land placement, a generation consistency checker, a constants-usage auditor, a balance summary, a script formatter and script statistics. See "Contributing" below for how to add one.

Code is the single source of truth. Breakdown and preview are views generated from it, and editing in Breakdown patches the underlying code with minimal, comment-preserving text edits.

The preview's land generation, elevation and cliff sections are tile-for-tile with the engine, the other sections are close approximations being improved upon.

## Status

Open Beta. The editor, the parser, the map preview (not 100% perfect, feedback always welcome) and Advanced Tools are all built (tools are beta). The tutorials in the app's Help menu teach it step by step, and the [user guide](docs/user-guide.md) is a reference for hotkeys, settings and how far to trust the preview.

## Installing

Download the newest build from the [latest release](https://github.com/aknipler/age-of-rms/releases/latest). The program has an automatic updater. Pick the file for your system, where `<version>` is the release number, such as `0.9.0`.

| Your system                           | Download                              |
| ------------------------------------- | ------------------------------------- |
| Windows 10 or 11, 64-bit              | `Age.of.RMS_<version>_x64-setup.exe`  |
| Linux, any distribution               | `Age.of.RMS_<version>_amd64.AppImage` |
| Debian or Ubuntu, as a system package | `Age.of.RMS_<version>_amd64.deb`      |

You can ignore the `.sig` files, `latest.json` and the Source code archives. The auto updater uses the first two, and the archives are only for building from source.

**Windows.** The installer is not code signed yet, so SmartScreen will show "Windows protected your PC" the first time you run it. Choose "More info", then "Run anyway". It installs for the current user only, into `%LOCALAPPDATA%`, and never asks for administrator rights. Uninstall it from Settings, Apps, Installed apps.

**Linux.** Both packages need Ubuntu 24.04, Debian 13, Fedora 40 or newer (glibc 2.39 or later). Make the AppImage executable with `chmod +x Age.of.RMS_<version>_amd64.AppImage` and run it. If it reports that FUSE is missing, install it with `sudo apt install libfuse2t64` (other distributions name the package differently). Install the .deb with `sudo apt install ./Age.of.RMS_<version>_amd64.deb`. The AppImage updates itself, the .deb does not.

The app checks for a new version when it starts and offers to update. It never installs anything without being asked.

**macOS.** There is no Mac build yet, because notarising one needs a paid Apple Developer account. Nothing in the app is Windows-specific though, so you can build your own. Install the [prerequisites](https://v2.tauri.app/start/prerequisites/), clone this repository, then run `npm install` and `npm run tauri build`. No config change is needed, since `bundle.targets` is already `"all"` and each platform builds whatever it supports. The `.dmg` and `.app` land in `src-tauri/target/release/bundle/`. macOS refuses to open an app it cannot verify, so right click and choose Open the first time rather than double clicking. Reports on whether this works are welcome in the [issue tracker](https://github.com/aknipler/age-of-rms/issues), and a signed build follows if there is demand.

Found a bug? [Open an issue](https://github.com/aknipler/age-of-rms/issues) with your app version, your operating system and the .rms file if one is involved.

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

The code is GPL-3.0. See `LICENSE`.

The reference data in `reference/data/game-constants.json` is derived from Age of Empires II: Definitive Edition's own data files, and the object and terrain names in it are Microsoft's text. Those rows are included under Microsoft's Game Content Usage Rules, a license that is personal and cannot be passed on, so you hold it yourself by owning the game. The GPL-3.0 grant over this repository does not reach them. `NOTICE` sets out what the data is, where each part came from and what it asks of contributors.

Age of RMS will always be free, with no advertising and no paid tier (which is good because the Game Content Usage Rules require it). Under the Usage Rules, art, audio, binary game files and Microsoft's own written documentation stay out of this repository.

## Credits

Thanks to Zetnus for permission to adapt the Definitive Random Map Scripting Guide and the terrain and object reference sheets, which the hover docs and reference data build on.

[genie-rms](https://github.com/genie-js/genie-rms) by Renée Kooi, an open source reimplementation of the original game's map generator, was a useful resource for how the map preview grows lands. It builds on reverse engineering of the original game by Yvan Burrie, JustTesting123 and others.

[AoE2RMSIDE](https://github.com/aoe2control/AoE2RMSIDE) gave the first leads to how Definitive Edition draws its random numbers. Every rule the preview uses was then tested against maps the game generated, and the code is written from those tests.

## Attribution

Age of Empires II © Microsoft Corporation. Age of RMS was created under Microsoft's 'Game Content Usage Rules' using assets from Age of Empires II, and it is not endorsed by or affiliated with Microsoft.

## Contributing

See `CONTRIBUTING.md`. This project is aimed at the AoE2 RMS community, including casual and first-time contributors.

Wish there was a tool that isn't there right now? Feel free to fork, build it and submit a pull request. Feature requests are also welcome, whether or not you plan to build it yourself.
