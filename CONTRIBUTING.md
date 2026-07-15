# Contributing to Age of RMS

Thanks for your interest — this project is built for the AoE2 Random Map Scripting community, and that includes people who have never contributed to open source before. This guide assumes no prior experience with Git, TypeScript, or Rust.

## Ways to contribute (no coding required)

- **Report bugs or confusing behavior** — open a GitHub issue describing what you expected vs. what happened. Screenshots help a lot.
- **Suggest RMS commands/constants that are missing or wrong** in the reference data (`reference/data/`) — these are plain JSON files, readable without coding experience.
- **Write or improve hover-doc explanations** for commands and constants — also plain text/JSON.
- **Playtest** — try the Breakdown editor and preview against your own maps and tell us where it breaks or misleads.

## Ways to contribute (coding)

1. **Set up your environment**: Node LTS, Rust (via [rustup](https://rustup.rs)), and on Windows the "Desktop development with C++" Visual Studio Build Tools workload. See the main `README.md`.
2. **Fork the repo, clone it, create a branch** for your change (`git checkout -b my-fix`).
3. **Run it locally**: `npm install`, then `npm run tauri dev`.
4. **Before opening a PR**, run:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
5. **Open a pull request** describing what changed and why. Small, focused PRs are much easier to review than large ones.

## Code conventions

- TypeScript strict mode.
- Functional React components with hooks (no class components).
- Prettier defaults for formatting — don't hand-format, let the tooling do it.
- Rust (`src-tauri/`) is kept intentionally thin — filesystem, dialogs, process spawning. Real logic lives in TypeScript.

## Reference data (constants, language, docs)

`reference/data/` holds three kinds of versioned JSON, each with a different maintenance model — see `PLAN.md` "Reference DB approach" for details. If you're adding or correcting a command/attribute/constant, that's a normal PR; if you're not fully sure an entry is correct, mark it `"verified": false` so a human can double check.

## Code of conduct

Be respectful. This is a hobby/community project — assume good faith, and remember most contributors are learning alongside the maintainer.

## Licensing note

By contributing, you agree your contribution is licensed under this project's GPL-3.0 license (see `LICENSE`).
