# Highlight Selected Command in Preview (build brief)

Written 2026-11-25 for a Sonnet build session. The owner settled every decision below on
2026-11-25. Build the items in the order given and nothing else. Where the brief says
**STOP AND ASK**, message the owner and wait. Don't choose for them.

All paths are relative to `age-of-rms/`. Other sessions edit this repo at the same time. Re-read
a file right before editing it, use Edit (never a whole-file Write on an existing file), don't
`git commit`, and run `npx prettier --write` on the files you changed at the end. Every new
interactive control is wrapped in `HelpTip` with a new `reference/data/ui-help.json` entry. Keep
the text short (what it does, its range, its effect), as CLAUDE.md asks.
`src/tools/__tests__/helpCoverage.test.ts` checks every id has text. New prose in code comments,
docs and UI strings follows the repo CLAUDE.md language rule (no colons, semi-colons or dashes
as punctuation). Teaching mode applies. Comment the why at each decision point.

Each gate runs the named test files by exact path, never vitest over a whole folder, since a
directory run can restart another session's long sweep. Run the full `npm test` once, at the
very end.

---

## What the owner wants

A Preview Options checkbox, **Highlight selected command**. While it is on, the preview lights
the tiles that the command under the caret (Code tab) or the selected card (Breakdown) produced
in the generation on screen.

| Command                       | First set                          | Second set                      |
| ----------------------------- | ---------------------------------- | ------------------------------- |
| `create_terrain`              | Placed by command                  | Surviving tiles                 |
| `create_land`                 | Grown tiles                        | Zone tiles                      |
| `create_player_lands`         | Grown tiles, every player's land   | Zone tiles, every player's zone |
| `create_object`               | Tiles under every object it placed | none                            |
| `create_elevation`            | Tiles it raised                    | none                            |
| `create_connect_*`            | Placed by command                  | Surviving tiles                 |
| any line of the cliff section | Every cliff tile                   | none                            |

**Two sets take turns.** The first set glows up and fades to nothing, then the second set glows
up in a second colour and fades to nothing, then back to the first. A command with one set (or
two sets that hold the same tiles) pulses one colour and shows no legend.

**The legend.** When two sets show, a small legend sits next to the hovered or selected tile box
in the map's top left corner (`PreviewPane`'s `topLeft`), a swatch per colour with its name and
tile count. Example `● Placed by command 500 ● Surviving tiles 400`.

### The sets, defined exactly

- **Placed by command** (`create_terrain`, connections). The tiles whose terrain or layer this
  command changed when it ran. A tile it painted with the terrain it already had does not count,
  since the generator cannot tell that from a tile it skipped. Say so in the HelpTip.
- **Surviving tiles** (`create_terrain`, connections). The placed tiles that, on the finished
  map, still hold this command's terrain and were not placed by any later command.
- **Grown tiles** (`create_land`). Every tile the land claimed during growth, its stamp
  included, read from `grid.landId` right after `growLands` and before the cleanup pass, so a
  tile a later `create_terrain` painted over still counts.
- **Zone tiles** (`create_land`). Every tile whose zone byte (the `landZone` array
  `generatePreview` already keeps from growth) equals this land's zone byte. Zones are shared.
  Every `create_land` without `zone` is zone -10, so the zone tiles of one such land are the
  tiles of all of them. That is the point of showing it, since `avoid_other_land_zones` and
  connections read zones, not lands. The legend says `Zone tiles (zone -10, 3 lands)` when more
  than one land shares it.
- **Object tiles.** For each object the command placed, the square of tiles its placement
  half size `p` covers in `object-data.json` (1 tile when `p` is under 1). A
  `set_place_for_every_player` command lights every player's copies.
- **Raised tiles** (`create_elevation`). The tiles whose height this command changed.
- **Cliff tiles.** Tiles with `grid.cliff !== 0` after S3.

### Settled behaviour (don't reopen)

- The highlight follows the caret live. Moving the caret to another command swaps the
  highlight without regenerating. All sets come from the generation already on screen.
- A caret on an attribute line inside a block counts as its command.
- A command that did not run in this generation (a branch not taken, a `start_random` arm not
  rolled) shows no highlight, and the legend box reads `Not run in this generation`.
- A caret on a line that is not one of the commands above shows nothing and no legend.
- One script line can run more than once (a per player object command, an `if` inside a loop
  of includes). All runs of one command join into one set, keyed by the command's source
  offset `span.start`, exactly as the hourglass keys its rows (`generationTiming.ts`).
- The highlight is not drawn in an exported PNG, the same as the Terrain Stats glow.
- It draws above the Terrain Stats glow, and both may show at once.
- Off by default and remembered across launches, like Hide player circles.

---

## Items in build order

### 1. The recorder (generator side, pure)

New file `src/preview/generator/commandTiles.ts`, an ambient recorder in the same pattern as
`generationTiming.ts` (read that file's top comment first and copy its reasoning).

```ts
export type CommandTileKind =
  "terrain" | "land" | "object" | "elevation" | "connection" | "cliff";

export interface CommandTiles {
  /** The command's source offset, `span.start`. For "cliff" it is -1 and the whole section matches. */
  offset: number;
  kind: CommandTileKind;
  /** Tile indices (y * dim + x), sorted ascending, no repeats. */
  first: Uint32Array;
  /** Absent for single set kinds. */
  second?: Uint32Array;
  /** Land kinds only, the zone number and how many lands share it. */
  zone?: { zone: number; lands: number };
}

export function startCommandTiles(dim: number): void;
/** Wraps one command's work, recording the tiles whose terrain, layer or elevation it changed. */
export function traceCommandTiles<T>(
  cmd: { span: { start: number } },
  kind: "terrain" | "connection" | "elevation",
  grid: TileGrid,
  fn: () => T,
): T;
export function recordTiles(
  offset: number,
  kind: CommandTileKind,
  first: Iterable<number>,
  second?: Iterable<number>,
  zone?: CommandTiles["zone"],
): void;
export function endCommandTiles(
  finalTerrain: Uint16Array,
): CommandTiles[] | null;
```

- `traceCommandTiles` copies `grid.terrain` and `grid.layer` (or `grid.elevation` for
  "elevation") before `fn`, runs it, and adds every index that differs afterwards to that
  offset's placed set. With no recorder running it calls `fn` and nothing else, so tests and
  tools pay nothing.
- Each terrain or connection record also keeps the terrain id the command paints, so
  `endCommandTiles` can compute **surviving** as placed tiles where `finalTerrain[i]` is that id
  and no later record (in run order) placed `i`. Store the run order as you record.
- Repeated runs of one offset union into one set.

**Gate 1.** New `src/preview/__tests__/commandTiles.test.ts`. A recorder test with a hand made
grid (two terrain commands overlapping, check placed and surviving), and the not recording case
(returns `fn`'s value, `endCommandTiles` returns null). Write one fixture that can tell
surviving from placed (CLAUDE.md, a fixture that cannot produce the wrong answer is not a test).

### 2. Wiring the recorder into `generatePreview`

`PreviewOptions` gains `commandTiles?: boolean` and `PreviewResult` gains
`commandTiles?: CommandTiles[]`, set only when asked. In `src/preview/generator/index.ts`:

1. `if (opts.commandTiles) startCommandTiles(instantiated.dim)` right after `startTiming`.
2. Terrain. In `terrains.ts` at the `timeCommand(cmd, ...)` call (around line 622), wrap the
   inner function in `traceCommandTiles(cmd, "terrain", grid, ...)`. Keep `timeCommand`
   outermost, so the trace's copying shows in the hourglass as part of the command.
3. Elevation. The same in `elevation.ts` at its `timeCommand(layer.cmd, ...)` (around line
   666), kind "elevation".
4. Connections. The same in `connections.ts` around line 657, kind "connection". When
   `connection.cmd` is undefined, skip the trace.
5. Lands. Right after `growLands` returns, read `grid.landId` and the zones array (the
   `landZone` the existing callback fills) and call `recordTiles` once per land origin with
   `origins[i].commandSpan.start`, the tiles whose `landId === i` as `first`, and the tiles
   whose zone byte equals `zoneByte(origins[i].zone)` as `second`. Count the lands sharing that
   zone for `zone.lands`. `create_player_lands` lands share one offset, so they union.
6. Cliffs. After `applyCliffs`, `recordTiles(-1, "cliff", <indices with grid.cliff !== 0>)`.
7. Objects. In `deObjects.ts` around line 540, where `stage.scripted()` makes each
   `kind: "script"` record, `b.cmd` indexes `descs` and `descs[b.cmd].span.start` is the
   offset. Add the object's tiles (the square of half size `p`, from the catalog's row for
   `b.id`, clamped to the map) to that offset with `recordTiles`. Only objects from the DE object
   stage are covered. The older `applyObjects` path (no object data loaded) records nothing.
8. Just before `endTiming`, `result.commandTiles = endCommandTiles(grid.terrain) ?? undefined`.

**STOP AND ASK** if a terrain command's painted terrain id is not available at its
`timeCommand` site, rather than guessing it from the tiles.

**Gate 2.** In `commandTiles.test.ts`, generate `test-maps/AK_Vanguard_v1.2.rms` (Normal,
4 players, seed 1, `commandTiles: true`) and check that a known `create_terrain` has surviving
tiles that are a subset of its placed tiles, every surviving tile holds its terrain, every
`create_player_lands` grown set is a subset of its zone set, and the object sets are non empty
for a `create_object TOWN_CENTER`. Also check that `commandTiles: false` leaves the result
identical to before (compare `result.objects` and the final grid), so the recorder never
changes a generation.

### 3. Across the worker

`src/preview/worker.ts` and `src/usePreviewResult.ts`. The worker passes
`commandTiles: <setting>` in the options, the same way `timing` travels (`timingRef`). The sets
can be large, so pack them for transfer as `deObjects` already is (`deObjectsWire.ts`). One
`Uint32Array` of all tile indices concatenated, plus a small JSON array of
`{ offset, kind, firstLength, secondLength, zone }`, the buffer in the transfer list. Unpack in
the hook. Write `packCommandTiles` and `unpackCommandTiles` in a new
`src/preview/commandTilesWire.ts` with a round trip test in Gate 3.

Changing the setting regenerates once (it changes what the worker records), like turning
timing on.

**Gate 3.** `src/preview/__tests__/commandTilesWire.test.ts`, round trip with zero, one and two
sets and an empty set.

### 4. The setting

`src/components/preview/PreviewViewContext.tsx`. Add `highlightCommand` with
`setHighlightCommand`, default false, remembered in the store exactly like `hidePlayerCircles`
(its `...ChosenRef`, the load in the store effect, the write effect, and a
`useHighlightCommandSetting()` hook). Add a row to `rows` in
`src/components/preview/GenerationSettingsPanel.tsx` after Hide player circles, label
`Highlight selected command`, help id `preview.highlightCommand`. HelpTip text, roughly
"Lights the tiles the command under the caret produced. Two colours take turns when a command
has two sets, explained in the legend beside the tile box."

### 5. Finding the command under the caret

`usePreviewCut()` (`src/PreviewCutContext.tsx`) already gives `cursorOffset`, the caret or the
selected card. New pure function in `src/preview/commandAtOffset.ts`,
`commandAtOffset(parse: ParseResult, offset: number): { start: number; kind: CommandTileKind } | null`.
It finds the innermost command node whose span contains `offset` and maps its name to a kind
(`create_terrain` terrain, `create_land` and `create_player_lands` land, `create_object`
object, `create_elevation` elevation, names starting `create_connect_` connection). A caret
anywhere inside `<CLIFF_GENERATION>` maps to `{ start: -1, kind: "cliff" }`. Read the parse
tree's node types in `src/parser/types.ts` and copy how `PreviewCutContext` resolves its offset.
Command names come from `language.json` lookups where the codebase already has them; the six
names above are the only literal strings allowed, since they are the brief's own scope.

**Gate 5.** `src/preview/__tests__/commandAtOffset.test.ts`. Caret on the command word, on an
attribute line inside its block, on the closing brace, between two commands, inside the cliff
section, and in a comment.

### 6. Drawing

Generalise the Terrain Stats glow rather than adding a second mechanism. In
`src/preview/render/terrainStats.ts` add `maskRuns(tiles: Uint32Array, dim: number): TileRun[]`
(runs along each row from a sorted index list) beside `glowRuns`, and a pure
`alternatingGlow(ms: number): { set: 0 | 1; alpha: number }`. One full cycle is two
`GLOW_PERIOD_MS` long. Each half rises from 0 to the peak and back to 0 on its set, so the
switch between sets happens at alpha 0 and never shows a jump.

`OverlayCanvas` gains `commandHighlight?: { first: Uint32Array; second?: Uint32Array } | null`.
Draw it on the same glow canvas as `glowTerrain` (one canvas, one animation frame loop, both
paths filled each frame), after the terrain glow. Colours are fixed constants beside the gold,
cyan `rgba(80, 220, 255, a)` for the first set and magenta `rgba(255, 90, 220, a)` for the
second, chosen to read on grass, sand, snow and water and to differ from the gold glow.
With one set, use `glowAlpha` on the first colour.

**Gate 6.** In `terrainStats.test.ts`, `maskRuns` on a hand grid and `alternatingGlow` at 0, a
quarter, a half and three quarters of a cycle (set 0 bright, 0 at the switch, set 1 bright).

### 7. The pane

`src/components/preview/PreviewPane.tsx`. When the setting is on, read `cursorOffset`, the
parse (`useParsedDocumentContext` or whatever the pane already reads), and the result's
`commandTiles`. Memoise the lookup on `[cursorOffset, parse, result]` so a pan never re-runs
it. Pass the matching sets to `PreviewCanvas` and on to `OverlayCanvas`. Note for Current mode
(`PreviewCutContext`), the script is cut at the caret, and the command under the caret is the
last one that runs, which is correct and needs nothing special.

Render the legend in `topLeft`, as a sibling just below the tile readout (or alone when nothing
is hovered or selected), with `aria-live="polite"`. It holds the two rows (swatch, name, tile
count), or `Not run in this generation`. Not interactive, so no HelpTip on it, but the rows
need a `title` with the set's definition from "The sets, defined exactly" above, in one
sentence each.

### 8. Run sheet and build log

Add section 67 to `docs/manual-test-run-sheet.md` with one check per row of the table at the
top, plus following the caret between commands, a command in an untaken branch, the legend
next to a selected tile, export without the highlight, and the setting surviving a restart.
Append a dated entry to `docs/build-log.md` with the test counts.

**Final gate.** Full `npm test`, `npx tsc --noEmit`, `npx eslint` on the changed files,
`npm run validate:reference`, and `npm run bench:preview` once with the setting's option off,
then `npm run bench:compare`. The recorder must cost nothing when off. **STOP AND ASK** if any
map is more than 10% slower calibrated.

## Not in this brief

Highlighting for `create_land`'s base_size core, for `create_object` groups as one shape, and
for any other command. Clicking the map to find the command that made a tile (the reverse
lookup) is a separate want, not designed.
