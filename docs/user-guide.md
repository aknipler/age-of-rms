# Age of RMS — User Guide

This is a walkthrough of using the app, for RMS authors. If you're looking to
install it, see the [README](../README.md#installing) instead — this guide
picks up once it's open.

Age of RMS never treats your code as anything but the source of truth. Every
view described below — Breakdown, Preview, Reference — is generated from your
script and edits it with minimal, comment-preserving text changes. Nothing you
write is discarded, even code the app doesn't recognize.

## The three tabs

The main window has three tabs, always available: **Breakdown**, **Code**, and
**Advanced Tools**. Switching between them doesn't lose your selection —
clicking a command in Breakdown and switching to Code jumps you to the same
spot in the raw text, and back again.

### Breakdown

A block-based view over your script, organized into the sections a random map
script actually has: Player Setup, Land, Elevation, Cliff, Terrain, Connection,
and Objects. Each command renders as a card with dropdowns and value fields
instead of raw syntax, so you can build a map without memorizing command
names.

- **Add a command** with the "+ Add command" control in a section, or the
  `Ctrl+Alt+A` hotkey — both open a picker scoped to what that section
  accepts.
- **Delete a card** with its Delete button or `Ctrl+Alt+D`, on any card kind
  that supports it.
- **Anything the app doesn't recognize** — a typo, an advanced idiom, code
  from before you started using Breakdown — renders as a raw block you can
  still see and select, never silently dropped or rewritten.
- Comments in your script show up in Breakdown too, attached to the command
  they precede.

### Code

A full Monaco editor (the engine behind VS Code) with RMS syntax
highlighting, hover documentation on commands and attributes, and search.
Live diagnostics — over 48 checks — underline problems as you type: unclosed
blocks, unknown names, wrong argument counts, and semantic mistakes the game
itself won't tell you about, like an attribute whose required partner is
missing, or a command sitting in a section the engine silently ignores it
from.

`Ctrl+Alt+F` flips the command under the cursor between one line and one
attribute per line. With a selection spanning several commands, each one
toggles independently — to the opposite of its own current shape, not to a
shared target — so a mixed selection stays mixed the other way round. It
skips anything it can't safely flip, such as a block that holds a nested
`if`/`start_random` (collapsing that onto one line would be unreadable) or
one that would force reindenting a different, untouched command elsewhere
in the file.

### Advanced Tools

A pane of built-in tools that run analysis or edits over your open script.
Pick one from the Select Tool dropdown, adjust its settings if it has any,
and press Run. If a tool proposes edits, an **Apply N changes** button
appears once its output is ready — nothing is written back to your script
until you click it.

The tools shipped today:

| Tool | What it does |
|---|---|
| **Script Statistics** | Counts commands, attributes, constants and sections in the open script. |
| **Generation Consistency Checker** | The flagship tool. Static checks (undefined actor areas, terrain the engine's own table refuses, land over-allocation, contradictory conditions) plus a Monte Carlo pass across a player-count matrix, reporting spawn rates, worst player count and failure reasons per command — the closest thing to "will this actually place?" without opening the game. |
| **Constants Usage** | Lists every `#const`/`#define`, where it's defined, and flags names defined but never used again, or used but never defined. |
| **Balance Summary** | Runs generations across a player-count matrix and reports each player's average gold/stone/food/wood and nearest-patch distance, side by side — useful for spotting a lopsided map. |
| **Script Formatter** | Re-lays out indentation, line breaks and blank lines. Preserves each command block's existing one-line-or-expanded shape by default, and — this is the guarantee that makes it safe to run — it never changes a single token, only the whitespace between them. |

A table row or note with a span next to it is clickable and jumps the Code
tab straight to that line.

## The side panel: Preview and Reference

Alongside the tabs, a resizable side panel holds the map preview and a
reference lookup.

**Preview** renders an approximate canvas of what your script generates —
zoom, pan, a game or minimap color mode, and hover/click readouts for any
tile. **Current** shows the map as generated up to your cursor's position in
the script (useful while writing); **Final** shows the whole script.
`Ctrl+Alt+V` toggles between them, `Ctrl+Alt+R` re-rolls the seed. A notes
drawer lists everything the preview approximated or failed to place, so you
know where the picture might diverge from what the real game engine would
do.

The preview is deliberately honest about its own limits: it reproduces the
engine's rules where those have been measured in game, and marks what it
can't model rather than drawing a confident guess.

**Reference** shares the same column. Look up terrains, objects, and commands
— including every attribute a command accepts — and see a live count of how
many of each object your script asked for versus how many the last
generation actually placed, zeroes included. An object your script names but
the map never gets is usually a terrain restriction or a distance constraint
nothing on the map satisfies.

## File actions and hotkeys

Every hotkey below is rebindable in Settings, and every default is reachable
with one hand on the left side of the keyboard (so your mouse hand never has
to move) — the one exception is Open, which keeps the OS-conventional
`Ctrl+O`.

| Action | Default hotkey |
|---|---|
| Save | `Ctrl+S` |
| Save As | `Ctrl+Shift+S` |
| New File | `Ctrl+N` |
| Open File | `Ctrl+O` |
| Toggle Preview Current/Final | `Ctrl+Alt+V` |
| Re-roll Preview seed | `Ctrl+Alt+R` |
| Delete selected Breakdown card | `Ctrl+Alt+D` |
| Add command (in Breakdown) | `Ctrl+Alt+A` |
| Toggle command layout (in Code) | `Ctrl+Alt+F` |

## Theming

Settings > Theme has a Light and a Dark theme built in, plus every colour
the app uses (surfaces, text, borders, accent, and the four status colours)
and the code editor's monospace font, grouped and editable one at a time.
Changing a colour previews instantly across the whole app; nothing is saved
until you click **Save as new theme…** or, if you're editing a theme you
already saved, **Update**. Saved themes can be renamed or deleted from the
same tab. Note that this covers the app's own chrome, not the Code tab's
syntax highlighting colours, which are a separate, not-yet-customizable
scheme.

## Updating and reporting problems

The app checks for a new version on startup and offers to update — it never
installs anything without asking first. If something looks wrong or a
generation looks off, use the bug-report button in the status bar, or open an
issue directly on GitHub. Screenshots and the `.rms` file that triggered the
problem both help a lot.

## Known limits, honestly stated

- The preview is an approximation, not a re-implementation of the game
  engine. It's continually corrected against measured in-game behavior, but
  it can still diverge — see its own notes drawer for what it flagged on
  your specific script.
- `#include_drs` files aren't resolved yet, so the parser and preview are
  blind to symbols defined outside the open document. This mainly affects
  advanced maps that lean heavily on shared include files.
- There's no macOS build yet (it needs a paid Apple Developer account to
  notarize). The app has nothing Windows-specific in it, so it builds from
  source today — see the README.
