# Age of RMS user guide

A reference for the app once it is installed. The [README](../README.md#installing) covers installing it.

The app is easy to learn, particularly because of two things. The tutorials walk you through real maps step by step, and every control shows a short popup when you hover it.

## Start with a tutorial

The tutorials are in the **Help** menu. Each one starts over from step 1 when you pick it, so you can replay one at any time.

| Menu item                          | Pick it if                                                         | What it covers                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tutorial: Your first random map    | You have never written a random map script                         | Builds a small map called Golden Hill from an empty file. Choose the Breakdown track to work with cards or the Code track to type the script.                 |
| Tutorial: Land Generation (Comeer) | You are a beginner and want to improve your land generation skills | Builds the islands of the 1v1 tournament map Comeer and shows how land grows and what stops it. It sets the preview to 1v1 on a Tiny map and leaves it there. |
| Tour of Age of RMS                 | You already write RMS                                              | Shows the key features of the app.                                                                                                                            |
| What's new                         | You want to see what changed in the newest release                 | Points out the newest features in place.                                                                                                                      |

The **DE RMS Guide** item in the same menu opens Zetnus's guide to the scripting language, which the app's own hover docs are drawn from.

Hover popups show on hover by default. **Settings > General** can make them show only while you hold Alt, or turn them off.

## Features the tutorials skip

### Breakdown

- Ctrl+click adds a card to the selection and Shift+click selects a run of cards. Deleting, dragging and commenting out then act on all of them.
- Drag a card by its header to move it more than one place, or into an `if` or `start_random` branch.
- The tick boxes on the section tabs show several sections in one list. Ctrl+click a section name to add or remove it, Shift+click to show every section up to it, or use show all for the whole script.
- **Add Template** on the Objects and Terrain tabs inserts ready made blocks, such as town centers and villagers for every player, starting resources, water resources and player forests. It previews the exact text before inserting.
- A misspelled command shows a fix button with the closest known name.
- A name you type that is not a built in constant or one of your `#const` lines gets an offer to create the `#const` for you.
- **Settings > Breakdown** can hide attribute rows the code does not use, change attribute order and switch to a compact layout that fits more on screen.

### Code

- Suggestions appear as you type. Grey prediction text after the caret is copied from similar lines earlier in your script, and Tab accepts it. **Settings > Code** sets which keys accept a suggestion.
- A light bulb offers quick fixes, such as a corrected spelling or creating a missing `#const`.
- Hover a command, attribute or constant for its documentation.
- Problems are underlined as you type and counted in the status bar. Click an underline to read the full message.
- A warning can be hidden with **Ok**, which hides it in that file, or **Don't show me this again**, which hides it everywhere. **Settings > Diagnostics** brings hidden warnings back.
- Toggle comment wraps the selected lines in `/* */`.

### The map panel

The panel beside Breakdown and Code holds two tabs, **Preview** and **Reference**. Drag its edge to resize it, or click the arrow on the edge to hide it.

- **Truncate at Cursor** draws only what the script builds up to your cursor, useful for testing. The pin button beside it holds that cut point while you edit elsewhere.
- The seed chip shows the seed the preview used. Type a seed to reproduce a layout, or press Ctrl+R to roll a new one.
- **Notes** lists every placement that failed.
- **Obj. List** under the map counts what each object placed. A zero means no tile met that object's rules. Untick an object to hide it from the drawing while it stays placed and counted.
- **Export** saves the current view as a PNG.
- The labels Left, Bottom, Right and Top on the map's sides match the RMS border names, so `left_border` is the side marked Left.
- The **Reference** tab looks up terrains, objects, commands and the attributes each command accepts.

The status bar totals are read from the generation on screen, so they show what the map placed, which can differ from what the script asked for.

## How far to trust the preview

The preview runs the script stage by stage, in the order the game does. The land, elevation and cliff stages draw the game's own random numbers in the game's own order. The stages after them are approximations.

| Stage                             | Compared with the game                                     |
| --------------------------------- | ---------------------------------------------------------- |
| Lands                             | Tile for tile at the same seed                             |
| Elevation                         | Tile for tile at the same seed                             |
| Cliffs                            | Tile for tile at the same seed                             |
| Terrains, connections and objects | Close approximation that will not line up with a real game |

To compare with a real game, set Generation Settings to that game's map size, players, teams and Team Positions box, then type its seed into the seed chip. The game shows the seed on the Objectives screen.

## Advanced Tools

Pick one of the Advanced Tools from the tool list, adjust its settings and press **Run**. A tool that proposes edits shows an **Apply** button when it finishes, and nothing in the script changes until you press it. Apply is one undo step. It is disabled if you changed the code after the run, so run the tool again.

| Tool                           | Use it to                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advanced Land Placement        | This is my favourite feature. This holds a lot of promise for making exciting new maps. Lay out lands on a canvas, such as a ring of player lands or lands along a line, arc or polygon, then write the matching `create_land` code. It writes inside a marked block in your script. Edit that block with the tool. |
| Generation Consistency Checker | Find out whether each command places what it asks for. It runs many generations across player counts and reports how often each command succeeds, the worst player count and why placements failed.                                                                                                                 |
| Balance Summary                | Compare players. It reports each player's average gold, stone, food and wood and the distance to their nearest patch.                                                                                                                                                                                               |
| Constants Usage                | Tidy `#const` and `#define` lines. It lists each one and flags names that are never used, or used but never defined.                                                                                                                                                                                                |
| Script Formatter               | Fix indentation, line breaks and blank lines. It never changes a word of the script, only the space between words.                                                                                                                                                                                                  |
| Script Statistics              | Count commands, attributes, constants and sections.                                                                                                                                                                                                                                                                 |

## Hotkeys

**Settings > Hotkeys** rebinds any of these. A binding must include Ctrl or Alt.

| Action                                                              | Default         |
| ------------------------------------------------------------------- | --------------- |
| New file                                                            | `Ctrl+N`        |
| Open file                                                           | `Ctrl+O`        |
| Save                                                                | `Ctrl+S`        |
| Save as                                                             | `Ctrl+Shift+S`  |
| Preview, switch Truncate at Cursor on or off                        | `Ctrl+Alt+V`    |
| Preview, roll a new seed                                            | `Ctrl+R`        |
| Preview, open or close Generation Settings (focus in the map panel) | `Ctrl+D`        |
| Breakdown, add command                                              | `Ctrl+Alt+A`    |
| Breakdown, delete selected cards                                    | `Ctrl+Alt+D`    |
| Breakdown, duplicate selected card                                  | `Ctrl+Alt+C`    |
| Breakdown, move selected card up or down                            | `Alt+↑` `Alt+↓` |
| Breakdown, comment out or uncomment selected cards                  | `Ctrl+/`        |
| Code, flip a command between one line and one attribute per line    | `Ctrl+Alt+F`    |
| Step through the focused tabs, add Shift to go back                 | `Ctrl+Tab`      |
| Switch to Advanced Tools and back                                   | ``Ctrl+` ``     |

The Code tab also has the usual editor keys, such as Ctrl+F to find, Ctrl+H to replace and Alt+↑ to move a line.

### Reporting a problem

Use the bug button in the status bar, or [open an issue](https://github.com/aknipler/age-of-rms/issues) on GitHub. The button beside it suggests a feature, a tutorial or an idea. Include your app version, your operating system and the `.rms` file. For a preview that differs from the game, also include the seed, the Generation Settings and a screenshot of each.

## Known limits

- Terrains, connections and objects in the preview are approximations, see [How far to trust the preview](#how-far-to-trust-the-preview).
- Files pulled in with `#include_drs` are not read, so the app cannot see constants or commands defined in them. It holds back warnings it cannot be sure of in such a script.
- There is no macOS build yet. The README explains how to build one yourself.
