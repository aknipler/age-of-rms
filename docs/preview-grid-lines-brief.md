# Grid lines on the preview (build brief)

Written 2026-11-25 for a Sonnet build session. The owner settled every decision below on
2026-11-25. Build the items in the order given and nothing else. Where the brief says
**STOP AND ASK**, message the owner and wait. Don't choose for them.

All paths are relative to `age-of-rms/`. Other sessions edit this repo at the same time. Re-read
a file right before editing it, use Edit (never a whole-file Write on an existing file), don't
`git commit`, and run `npx prettier --write` on the files you changed at the end. Every new
interactive control is wrapped in `HelpTip` with a new `reference/data/ui-help.json` entry. Keep
the text short (what it does, its range, its effect), as CLAUDE.md asks. New prose in code
comments, docs and UI strings follows the repo CLAUDE.md language rule (no colons, semi-colons
or dashes as punctuation). Teaching mode applies. Comment the why at each decision point.

Run test files by exact path, never vitest over a whole folder. Run the full `npm test` once,
at the very end.

---

## What the owner wants

A **Grid lines** setting in Preview Options with four choices, **None**, **Light**, **Medium**
and **Dark**. Anything but None draws a line along every tile edge of the map, so a scripter
can count tiles and read distances.

### Settled behaviour (don't reopen)

- **The choices set the line's strength, not its colour.** One dark ink, faint to strong.
  Light is barely visible, Dark clearly outlines every tile. A single dark ink reads on every
  terrain, where white lines would vanish on snow.
  | Choice | Stroke                |
  | ------ | --------------------- |
  | None   | not drawn             |
  | Light  | `rgba(0, 0, 0, 0.14)` |
  | Medium | `rgba(0, 0, 0, 0.28)` |
  | Dark   | `rgba(0, 0, 0, 0.5)`  |
- Default None. Remembered across launches, like Hide player circles.
- All three views draw them (flat colours, minimap, DE textures). In the DE textures view the
  lines follow raised ground, since every lattice point goes through `latticeToScreen`, which
  lifts it by the ground under it.
- Lines draw over the terrain and under every object, sprite, player circle and failure mark,
  so they never cut through a tree or a town centre.
- **Zooming out fades them.** Below a tile half width of 2 CSS pixels the grid is a grey wash
  that hides the map, so the alpha is multiplied by `clamp((halfWidth - 2) / 4, 0, 1)`. At a
  half width of 6 and above it is the full strength from the table.
- The line is 1 CSS pixel wide.
- An exported PNG includes the grid when it is on, since Export saves what the canvas shows
  (`OverlayCanvas`'s `paint` is shared by both, so this needs nothing extra).

---

## Items in build order

### 1. The setting

`src/components/preview/PreviewViewContext.tsx`. Add
`gridLines: GridLineStrength` and `setGridLines`, where

```ts
export type GridLineStrength = "none" | "light" | "medium" | "dark";
```

lives in a new pure module `src/preview/render/gridLines.ts` (item 2). Remember it in the store
the way `hidePlayerCircles` is remembered (its `...ChosenRef`, the read in the store effect, the
write effect), under a new key `GRID_LINES_KEY`. Validate what the store returns with a type
guard `isGridLineStrength(value: unknown): value is GridLineStrength`, since a stored value is
`unknown` until checked. Add a `useGridLinesSetting()` hook beside `useHidePlayerCirclesSetting`.

### 2. The pure part

New `src/preview/render/gridLines.ts`.

```ts
export const GRID_LINE_ALPHA: Record<
  Exclude<GridLineStrength, "none">,
  number
> = {
  light: 0.14,
  medium: 0.28,
  dark: 0.5,
};
/** The stroke alpha at this zoom, 0 when nothing should draw. */
export function gridLineAlpha(
  strength: GridLineStrength,
  halfWidth: number,
): number;
/**
 * The lattice lines that can be on screen, as index ranges, so a zoomed in
 * view of a Giant map does not trace 481 lines it cannot see.
 */
export function visibleLatticeRange(
  viewport: Viewport,
  dim: number,
): { x0: number; x1: number; y0: number; y1: number };
```

For `visibleLatticeRange`, take `screenToTile` of the four canvas corners, floor and ceil the
extremes, pad by 1, and clamp to `0..dim`. On raised ground `screenToTile` already finds the
raised point, but a hill can lift tiles from below the bottom edge into view, so pad the
bottom (larger y on screen) by the map's highest lift in tiles,
`ceil(ground.maxLevel * LIFT_PER_LEVEL)` plus 1. **STOP AND ASK** if `LIFT_PER_LEVEL` is not
exported from `projection.ts`. Don't copy its value.

**Gate 2.** New `src/preview/render/__tests__/gridLines.test.ts`. `gridLineAlpha` for each
strength at half widths 1, 2, 4 and 6 (0, 0, half, full), and None always 0.
`visibleLatticeRange` for a fitted viewport (the whole map, `0..dim`) and a zoomed in one
(a strict sub range that still contains the tile under the canvas centre).

### 3. Drawing

`src/preview/render/drawPreview.ts`. `PreviewScene` gains
`gridLines?: { strength: GridLineStrength }`. New function `drawGridLines(ctx, viewport, dim, strength)`,
called in `drawPreview` right after `drawMapEdge` and before the object layers. It

1. returns at once when `gridLineAlpha(...)` is 0,
2. takes the range from `visibleLatticeRange`,
3. for each lattice x in the range, one polyline along y through `latticeToScreen(viewport, x, y)`
   for every y in the range, then the same for each lattice y along x,
4. strokes everything as one path with the alpha's colour and `lineWidth = 1`.

On the flat views (no `viewport.ground`) each line is straight, so it needs only its two end
points. Branch on `viewport.ground === undefined` and draw two points per line there, the full
polyline only on raised ground. That keeps a flat Giant map at 482 short lines.

Pass `gridLines` through `OverlayCanvas`'s `paint` (read `useGridLinesSetting()` there the way
it reads the other settings, and add it to `paint`'s dependency list).

**Gate 3.** Extend `src/preview/render/__tests__/drawOrientation.test.ts`'s recording mock
pattern in a new `drawGridLines.test.ts`. A 4 by 4 map at a fitted viewport with "dark" records
10 lines (5 each way) whose end points equal `latticeToScreen` of the lattice corners, a
viewport with ground records more than 2 points per line, and "none" records no stroke.

### 4. The control

`src/components/preview/GenerationSettingsPanel.tsx`, in `PreviewOptions`, after the checkbox
rows and before the Performance heading. A labelled native `<select>` (plain text options are
all it needs, unlike `MapSizePicker`), id `preview-option-grid-lines`, label `Grid lines`,
options None, Light, Medium, Dark. Wrap it in `HelpTip id="preview.gridLines"`, text roughly
"Lines along every tile edge. Light to Dark sets how strong they are. They fade out as you zoom
out." Match the row styling of the checkbox rows (`styles.field`).

### 5. Run sheet and build log

Add a section to `docs/manual-test-run-sheet.md` (the next free number) with these checks.
Each strength in the flat view, the minimap view and the DE textures view on a hilly map (lines
follow the hills), zooming out fades the lines, objects and player circles draw over the lines,
an export includes them, and the choice survives a restart. Append a dated entry to
`docs/build-log.md` with the test counts.

**Final gate.** Full `npm test`, `npx tsc --noEmit`, `npx eslint` on the changed files and
`npm run validate:reference`.

## Not in this brief

Coordinate labels along the edges, and a line every 5 or 10 tiles in a stronger ink. Each is a
separate want. The Land Placement panel renders `OverlayCanvas` too, so it shows the grid as
well, which is wanted there and needs no work of its own.
