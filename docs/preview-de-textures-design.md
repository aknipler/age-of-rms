# Preview DE textures design

Rev 5, 2026-11-25. Sprites reach the window, a terrain blending switch, and smooth hill light (Sec.14). Rev 4, 2026-11-24. Tiers 3 and 4 built the same day (Sec.12, Sec.13). Rev 3 of 2026-11-24 follows. Tier 1 built 2026-11-23 (Sec.9). Tier 2 designed and built 2026-11-24 from measurements in the scenario editor (Sec.10). Rev 3 corrects the texture repeat, layers without a mask and the water reading, and adds a colour grade and a mask cover curve, all from pixel comparisons against the game (Sec.10.7).

The map preview gains a second way to draw the map. It keeps today's flat colour preview as the fast default, and adds an isometric view painted with the terrain textures from the user's own DE install, so the map looks closer to the game. Generation is untouched. This document covers only how a finished `PreviewResult` is drawn.

## Sec.1 What the user sees

A new button sits beside the minimap colour button in the preview's control row.

1. Off, the button shows a plain diamond outline and the preview draws as it does today, one colour per tile on a square diamond.
2. On, the button shows a squashed diamond with the letters DE inside it, and the preview draws the map at the game's 2:1 isometric squash with each tile painted from its terrain's DE texture.
3. Hover, the tile readout, selection, the orientation aids, the failure marks, objects, player markers, every `mapOverlay` shape and the Land Placement panel's handles and drags all keep working in the textured view, in the right place.
4. Export saves what the canvas shows, textures included.
5. Without a DE install, without WebGL2, or while the textures load, the textured view draws flat colours at the 2:1 squash and says why in one line over the map.

The owner settled these on 2026-11-23. The preview is never animated. Nothing that works in the flat view may be switched off in the textured one. The button looks as items 1 and 2 describe.

## Sec.2 What the install holds

Measured 2026-11-23 on the maintainer's install. Paths are under `<install>\resources\_common`.

| What                     | Where                                                                     | Format                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terrain textures         | `terrain\textures\2x\*.dds`, 75 files, and 10 more `o_*.dds` one level up | DDS. 45 are 2048 DXT1 with 3 mips, 11 are 2048 DXT1 with 12, 7 are 1024 DXT1, 13 are 512 DXT1, 5 are 2048 BC7 (`DX10` header, DXGI 98), 2 are 2048 DXT5 with no mips, 1 is 1024 uncompressed BGRA |
| Blend masks              | `terrain\blends\*.png` and `terrain\masks\*.png`                          | 512 greyscale PNG atlases                                                                                                                                                                         |
| Water                    | `terrain\water\`                                                          | normal map atlases for the game's animated water shader                                                                                                                                           |
| Object and cliff sprites | `drs\graphics\*.sld`, 7,743 files                                         | SLD, DE's layered sprite format                                                                                                                                                                   |

Each texture is a seamless top down image, not an isometric one. The game lays it over the tile grid in tile space and the camera squashes the result. Every terrain's file is named by the dat's `Terrain.name_2`, already `deTextureFile` in `game-constants.json`, and all 85 names the table uses exist in the install.

The dat's `Terrain.terrain_dimensions` was read in rev 1 as how many tiles one copy of the texture covers. 114 enabled terrains say 10, the five gravel and rock wet beaches say 15, the farms and pastures say 6, and their construction stages say 3. Rev 3 measured otherwise. Every terrain DE was compared on, farms, pastures, construction stages and wet beaches included, repeats every 10 tiles (Sec.10.7), so the field is something else and the renderer uses 10 for all. `textureTiles` stays on the rows as the dat's value.

The dat's terrain block gives `tile_width` 96 and `tile_height` 48, so the game's tile is exactly twice as wide as it is tall. The textured view uses that squash.

## Sec.3 The projection carries its squash

`projection.ts` had one module constant, `TILE_ASPECT = 1`, read by `halfHeightOf`. Every screen position the app draws or hit tests goes through that function, which is what makes this feature cheap. The squash moves onto the viewport.

1. `Viewport` gains an optional `aspect`, the tile's half height over its half width, read as `TILE_ASPECT` when absent so the tutorial pictures and older callers keep the flat view. `halfHeightOf` returns `halfWidth * aspect`.
2. `TILE_ASPECT` stays as the flat view's value, and `DE_TILE_ASPECT = 0.5` is added beside it.
3. `fitViewport` takes the aspect as an argument, defaulting to `TILE_ASPECT`.
4. `withAspect(viewport, aspect)` returns the same viewport at a new squash, keeping the tile at the canvas centre where it was. The toggle uses it, so switching views does not throw away the user's zoom and pan.

Hover, click, drag, `screenToTile`, `zoomAt`, `clampToCanvas` and every draw call then follow the squash with no change of their own. One place assumed a square tile. `drawOverlay`'s circle took one screen radius and drew `arc`. A tile space circle under the projection is an axis aligned ellipse, with radii `r * halfWidth * sqrt 2` across and `r * halfHeight * sqrt 2` down, so it now draws `ellipse` with those radii, which is the same circle when the aspect is 1.

The tutorial pictures (`renderImage.ts`, `startSquareDiagram.ts`) keep the flat squash and are not touched.

## Sec.4 Where the switch lives

`PreviewViewContext` gains `deTextures` and `setDeTextures`, beside `colorMode`. It is not persisted, matching `colorMode` and the rest of that context. Both canvases read it. The app's preview passes it to `OverlayCanvas` through `PreviewCanvas`, and the Land Placement panel passes the same value, so the two canvases always agree.

`OverlayCanvas` takes `terrainRender: "flat" | "de"`. When a viewport's aspect differs from the one the mode asks for, an effect converts it with `withAspect`. Every `fitViewport` call in the component passes the mode's aspect.

## Sec.5 Reading the textures

`src/preview/render/deTextureSource.ts` runs on the main thread, since the Tauri fs plugin talks over IPC only the window has (the same reason as `useIncludeFiles.ts`).

1. The folder comes from `findDeTerrainTexturesFolder` in `scriptFolder.ts`, which tries the same install candidates as the gamedata search and accepts the first with a `resources\_common\terrain\textures` folder. Found once per session.
2. A file is looked for in `2x\` first, then in the folder itself.
3. It is read with `readFile`. The capability file gains `fs:allow-read-file`.
4. `dds.ts` parses the header and decodes one mip level to RGBA. It reads DXT1, DXT3, DXT5 and uncompressed 32 bit BGRA. Anything else, BC7 included, is reported as unsupported and the terrain draws in its flat colour. Five textures fall in that case today, the pasture ones (`g_pm*`, `g_pc*`).
5. The level decoded is the largest one no wider than 1024. A file with no such level has its top level decoded and halved until it fits, and a smaller file is scaled up to 1024, since every layer of a texture array shares one size.
6. Each file is decoded once per session and kept in a module level cache of promises, keyed by lower case name, so a re-roll, a mode switch or the second canvas costs nothing.

No texture is shipped, copied or cached on disk by the app. It reads the user's own install where the game does, like the include files.

## Sec.6 What each tile draws

`texturedTiles.ts` is pure and runs in Node. It turns a snapshot into four bytes a tile, following `buildTerrainBitmap`'s rules so the two views agree on what a tile is.

1. The visual terrain is the tile's layer when it has one, else its terrain. In the flat view a layer tints the terrain colour, because a colour cannot show both. In game a `base_layer` or mask is the texture you see, so the textured view draws the layer's texture.
2. The shade is the factor `shadeForElevation` applies, from the tile's height and its neighbour toward the light. `palette.ts` exports it as `elevationShadeFactor`, and `shadeForElevation` now calls it.
3. Two flags, forest (from the owning terrain, as the canopy rule reads it) and cliff. The shader mixes toward `CANOPY_COLOR` and `CLIFF_COLOR` with the flat view's own weights.

A second table maps each terrain id to its texture layer and repeat, and to its fallback colour from the active palette, so the colour mode button still decides the colour of any terrain without a texture.

## Sec.7 Drawing

`texturedTerrainGl.ts` owns a WebGL2 context on an offscreen canvas the size of the visible canvas's backing store.

1. One full screen triangle. The fragment shader turns its pixel into a continuous tile coordinate with the same inverse as `screenToTile`, discards pixels off the map, fetches the tile's four bytes, then the terrain's layer and repeat.
2. The colour is sampled from a `TEXTURE_2D_ARRAY` at `tile / repeat`. `textureGrad` is given the derivatives of the unwrapped coordinate, not of its `fract`, since the wrapped coordinate jumps at every repeat boundary and the mip choice would draw a seam of the smallest mip along each one.
3. Shade, canopy and cliff are applied, or the fallback colour is drawn when the terrain has no layer.
4. `drawPreview`'s base layer gains a terrain kind. The flat bitmap is drawn under the projection transform as before, and the textured canvas is drawn once at the canvas's own size with no transform. Objects, players, failure marks, overlays and outlines are drawn on top exactly as before, which is what keeps every interaction of Sec.1 item 3 working.

Only terrains on the drawn grid get a layer. The textures upload once per set of terrains and the tile bytes once per snapshot, so pan and zoom cost one draw.

## Sec.8 Tiers

| Tier | What                                                                                                                                              | State                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1    | Textured terrain at 2:1 with hard tile edges, hill shading, canopy and cliff tints, the switch, the fallbacks                                     | Built 2026-11-23                                                                    |
| 2    | Blended terrain edges from the blend masks and the dat's blend priority and type, BC7 decoding, a still water look, lighting closer to the game's | Built 2026-11-24                                                                    |
| 3    | Objects drawn from their SLD sprites (trees, mines, buildings, player colour) through the dat's graphics                                          | Built 2026-11-24, Sec.12                                                            |
| 4    | Cliff sprites, shadows, pixel level agreement with the game                                                                                       | Raised ground, cliff sprites and shadows built 2026-11-24, Sec.13. Slope shape open |

Tier 2's questions, answered in Sec.10. How the game picks a blend mask and its frame for a pair of neighbours, and whether the dat's `blend_priority` and `blend_type` say it all. Whether a still frame of water should be the texture or a colour. Whether elevation should lift tiles on screen as the game does, which moves every hit test (not done, see Sec.10.5).

Tier 3's questions. How much SLD decoding it takes to draw a still frame with its player colour layer. Which frame and angle the game shows for a placed object. How objects drawn as sprites stay clickable and readable at the zoom levels where a sprite is a few pixels.

## Sec.9 Tier 1 as built

| Item                                                                      | File                                                                                                                             |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `aspect` on the viewport, `DE_TILE_ASPECT`, `withAspect`, ellipse circles | `src/preview/render/projection.ts`, `drawPreview.ts`                                                                             |
| `textureTiles` on terrain rows, from `Terrain.terrain_dimensions`         | `tools/extract-constants --terrain-render`, the schema, `game-constants.json`                                                    |
| DDS decoding                                                              | `src/preview/render/dds.ts`                                                                                                      |
| Tile bytes and the terrain table                                          | `src/preview/render/texturedTiles.ts`                                                                                            |
| Reading and caching the textures                                          | `src/preview/render/deTextureSource.ts`, `src/settings/scriptFolder.ts`                                                          |
| The WebGL2 renderer                                                       | `src/preview/render/texturedTerrainGl.ts`                                                                                        |
| The switch, the button and its help, both canvases                        | `PreviewViewContext.tsx`, `PreviewPane.tsx`, `OverlayCanvas.tsx`, `PreviewCanvas.tsx`, `LandPlacementCanvas.tsx`, `ui-help.json` |

Run sheet section 62 checks it in the app.

## Sec.10 Tier 2

Measured 2026-11-24 in DE's scenario editor with the grid on, by painting test patterns and comparing them with the same patterns drawn by the renderer in a standalone page.

### Sec.10.1 What the dat and the install give

`tools/extract-constants --terrain-render` now also writes three fields on each terrain row. `blendPriority` (the dat's `blend_priority`, 0 to 199, unique per terrain), `blendType` (`blend_type`, a family, 0 land, 1 farm, 2 beach, 3 water, 4 shallows, 5 road, 6 ice, 7 snow) and `overlayMask` (`overlay_mask_name`, a PNG in `terrain/masks`, absent on 66 rows).

`terrain/blends` holds nine 512 pixel greyscale atlases, one per blend mode, plus `herbwatershore.png`, which nothing names. Each atlas is an 8 by 8 grid of 64 pixel cells. 31 of them are blend tiles, white where the higher terrain covers and black where the lower one shows. Reading each cell's four sides gives their meaning. Tiles 0 to 3 have white on the bottom side (the y + 1 neighbour), 4 to 7 on the right (x + 1), 8 to 11 on the left, 12 to 15 on the top, four drawings each. 16 to 19 are the corners (+1, +1), (−1, +1), (+1, −1), (−1, −1). 20 to 30 cover two, three or four sides at once. `terrainBlends.ts`'s `ATLAS_CELL_OF_TILE` records where each sits.

### Sec.10.2 Blending

1. A tile and each of its eight neighbours compare as pairs of terrain and layer. A pair ranks by `blendPriority * 1000`, or with a layer by the layer's priority times 1000 plus the terrain's. A neighbour spreads over the tile when it ranks higher.
2. Each spreading neighbour draws its own blend tile, a side tile (drawing `(x + y) & 3` of the four) or a corner tile, over the tile, and the covers of one terrain's tiles stack as `1 − (1 − a)(1 − b)`. The several sided tiles 20 to 30 are not used. A sand tile with black on all eight neighbours shows a faint smudge of sand in the game. Eight stacked tiles draw the same smudge, while tile 30, clear in its middle, draws a bright sharp hole. That one comparison decided it.
3. The higher terrains are drawn lowest rank first, so the highest lands on top.
4. The atlas is picked by the blend mode for the lower and upper pair's types, `BLEND_MODES[lower][upper]` in `terrainBlends.ts`, which names land under water watershore, land under land landland, water under shallows shallowswater, anything under road roadland, and so on.
5. A layered tile draws its terrain, then its layer through the layer's overlay mask, both repeating as the layer's texture does. A layer whose terrain names no mask goes through `neutral.png` (rev 3, Sec.10.7). A mask's value becomes cover through `value ^ 0.78`. A tile's pair blends as its layer's type.

`buildBlendBytes` works this out once per map on the CPU, up to eight slots a tile, and the shader only draws the slots.

### Sec.10.3 BC7

`bc7.ts` decodes all eight modes. The 64 two subset and 64 three subset partitions were read back from Pillow's decoder, one block per partition with every index zero. 8,000 random blocks, 1,000 per mode, decode identical to Pillow, and so do the five pasture textures, byte for byte at 2048. `__tests__/bc7Blocks.json` keeps 64 of those blocks with Pillow's output, so CI holds the decoder to the reference without Pillow.

### Sec.10.4 Water

The still water look is the texture, under the same colour grade as land (Sec.10.7). Rev 2 read water as within 2 to 6 units of its textures' means from samples of the computer use tool's JPEG screenshots. Lossless captures put DE's water about as much brighter than its textures as its land, which the grade covers. The game's waves and reflections are animated and stay out (Sec.1).

### Sec.10.5 Hill light

The flat view lights a tile from the upper left and brightens it with height. The game does neither. A hill raised on sand measured 171 on flat ground and on the plateau top, 86 on the slope facing −x and 165 on the slope facing +x. So the light comes from the screen's right, a slope facing away from it is half as bright, and one facing it is no brighter than flat ground.

1. The ground's height at a tile corner is the highest of the up to four tiles around it (`buildCornerHeights`), and inside a tile it is blended from its corners.
2. One level is 0.408 tiles high, from the dat's `elev_height` of 24 pixels on its 96 by 48 tile seen from 30 degrees.
3. The sun points to (+x, +y), the screen's right, about 32 degrees above the horizon, the height that halves the measured slope. Light is the surface's cosine to it over flat ground's, capped at 1 (`slopeLight`).

Tiles are not lifted on screen. Lifting them would move every hit test and overlay, which Sec.1 item 3 forbids breaking, and is left with tier 4.

### Sec.10.6 As built

| Item                                                                     | File                                                                          |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `blendPriority`, `blendType`, `overlayMask`                              | `tools/extract-constants --terrain-render`, the schema, `game-constants.json` |
| BC7                                                                      | `src/preview/render/bc7.ts`, `dds.ts`                                         |
| Which neighbours blend into each tile                                    | `src/preview/render/terrainBlends.ts`                                         |
| The layer byte, masks in the terrain table, corner heights, `slopeLight` | `src/preview/render/texturedTiles.ts`                                         |
| Reading blend atlases and masks                                          | `src/preview/render/deTextureSource.ts`                                       |
| The shader and its six textures                                          | `src/preview/render/texturedTerrainGl.ts`                                     |
| Building and uploading per map                                           | `src/components/preview/OverlayCanvas.tsx`                                    |

Run sheet section 63 checks it in the app.

### Sec.10.7 Measured against the game's own picture (rev 3)

An offline script compares DE's drawing with the renderer's pixel by pixel. A scene is painted in the scenario editor on a blank map, the game window is captured losslessly, and the saved scenario gives the true tiles. The renderer draws those tiles in headless Chrome, the camera is found by correlating the two pictures blurred to a third of a tile (texture grain is what may differ, terrain patches are what must agree), and the error is reported per terrain and for tiles beside another terrain. Variants change one rule at a time. A control with the blends off must come out worse at edges, and does in every scene.

Two clean scenes, one on Beach and one on Dirt 3, with shallow and deep water, Road, Grass, Dirt Mud, Snow Soft, Ice Beach, Pasture, Farm, two farm construction stages, the wet gravel and rock beaches, and layers of Desert Sand, Desert Cracked and Dirt 1.

1. Texture repeat. Every terrain lines up with DE at 10 tiles and at no other repeat tried. Road scores 16 against 35 at 6 and 39 at 15, and its strong pattern also confirms the texture runs along tile x from tile 0, 0. Pasture scores 8 at 10 against 20 at the dat's 6, Farm 11 against 25, the construction stages 9 and 10 against 16 and 19 at the dat's 3, and the wet beaches 11 and 9 against 21 and 22 at the dat's 15. `TEXTURE_REPEAT_TILES` is 10 for every terrain.
2. Colour grade. DE's picture is brighter than its textures on every terrain, water included. Fitted on flat interiors, DE = gain x renderer + offset with gains 1.044, 1.016, 1.088 and offsets 11.1, 10.0, 6.0 on the first scene and 1.037, 1.011, 1.072 and 11.8, 10.0, 8.1 on the second. `DE_COLOUR_GRADE` is their mean, applied last in the shader. With it the remaining fit is within 0.01 of no change. The game's colour correction file says brightness 0.95 but also has a bloom, which over broad areas brightens, so this is measured rather than read.
3. Layers without a mask. DE draws them at about two thirds cover, so neither full cover (rev 2) nor not drawing them is right. The install's flat masks name their cover (`neutral_33.png` holds 63, `neutral_42.png` 85, `neutral_50.png` 105, `neutral_66.png` 149), and `value ^ 0.78` gives each named cover within 0.01. `neutral.png` holds 149, two thirds cover through that curve, which is what DE shows. `DEFAULT_LAYER_MASK` is `neutral.png` and `MASK_COVER_EXPONENT` 0.78. The curve lowers the error on all three layered regions measured.
4. Result. The mean error per channel fell from 19.3 to 10.3 on the first scene and from 19.6 to 10.8 on the second, and on flat interiors from 18 to 8 and 9. Turning off the grade or going back to the dat's repeats makes both scenes clearly worse again.

## Sec.11 Unverified

1. Which way the texture runs. Settled for Road, Farm and the wet beaches by Sec.10.7 item 1. Others are assumed to run the same way.
2. The game may offset or mirror a texture per terrain. None of the nine textures compared does.
3. Decoding 15 or so textures takes a noticeable moment on first use. If it shows in the app, the decode moves to a worker. Tier 2 adds a BC7 decode for pasture maps and up to nine atlases and a few masks, small PNGs the browser decodes.
4. The blend mode table (`BLEND_MODES`). It lives in the game's code, not its files. The rows read sensibly (land under water is watershore, water under shallows is shallowswater) but only land over land was compared in game. A coast against an in game screenshot checks watershore (run sheet section 63 item 3).
5. Which of a side's four drawings a tile uses. `(x + y) & 3` is a guess the comparisons could not tell apart.
6. That a mask repeats with its terrain's texture. The masks are noise, so a different repeat would look much the same.
7. The hill light was fitted to one slope, one level a tile, the steepest DE's elevation stage makes. A two level step would draw nearly black. Diagonal ridges show small steps where the game's look smooth, since the game may split a tile's surface along a diagonal.
8. The colour grade is two scenes' fit under the default colour mood and lighting. Other colour moods and the bloom's local brightening near bright terrain are not modelled. Rev 2's "sand 4 percent darker" came from a JPEG screenshot and is withdrawn.
9. The hill surface. DE's slopes spread over two or three tiles with a soft gradient. Ours rise in one tile, since each corner takes the highest tile around it, and show steps along a hill's diagonal edges. A surface folded along a tile diagonal was tried and scored slightly worse (19.48 against 19.10 on the hill scene), so the blend stays. Corners from the mean of their tiles, spreading a slope over two tiles, is the next lead, and needs fractional corner heights.

## Sec.12 Tier 3, objects as sprites

Built 2026-11-24 at the owner's request, designed from the dat and checked against the game with the comparison script of Sec.10.7.

### Sec.12.1 What the install and the dat give

Every object, tree and cliff is an SLD file in `drs/graphics`. An SLD frame has a canvas, a hotspot (the canvas point that sits on the object's position) and up to five layers in a fixed order. The main layer is DXT1 blocks with the transparent index cutting the picture out, the shadow layer BC4 blocks of shadow alpha, the player colour layer a BC4 mask. Each layer stores a list of (skip, draw) block counts, and a frame may keep the blocks it skips from the frame before. `sld.ts` reads all of this. A tree, a mine, a cliff and a town centre decode to the pictures the game shows, with their shadows cast to the left (light from the right, as Sec.10.5 measured).

The dat says what each object stands as. `Unit.standing_graphic` names a graphic, whose `file_name` is the SLD's base name, with `frame_count` frames for each of `angle_count` angles, a `mirroring_mode` (later angles drawn as flipped earlier ones), a draw `layer`, and deltas, parts drawn in order at sprite pixel offsets, -1 meaning the graphic itself. `tools/extract-constants --object-data` now also writes `reference/data/object-sprites.json`, every standing graphic and its deltas, 2,138 rows, loaded only by the textured view.

### Sec.12.2 Which frame

The object stage already writes what DE saves for each object (`PreviewResult.deObjects`), so the frame drawn is the frame DE draws (`spriteFrame`). An unanimated graphic's angles are its variants, and the stored frame names one, a tree's facet or a cliff's face. An animated graphic turns to the stored rotation in radians and starts at the stored frame. A mirrored graphic stores half its angles plus one, and the rest draw flipped. Objects the game saves as hidden (status 0) draw nothing.

### Sec.12.3 Drawing

`drawPreview` draws the sprites in place of the object and terrain object glyphs once a tile is at least 2 pixels wide (`SPRITE_MIN_HALF_WIDTH` 1, 16 pixels until 2026-11-25, lowered on the owner's request once the sprites moved to the GPU). Farther out a sprite is a few pixels and the glyphs say more. Shadows draw first, all of them, then the pictures by layer, then from the back of the screen to the front. One sprite pixel is a 96th of a tile's width. The player colour mask paints the owner's team colour from the install's `palettes/spritecolors.json` over the picture's own light and dark. An object whose picture did not load keeps its glyph. The Obj. List's hidden set hides sprites by the object's constant name. The textured view no longer tints forest ground green, since it draws the trees.

### Sec.12.4 Measured

On a random map scene with forest, a hill and player starts, against DE with the owner's Small Trees option on:

| Variant            | Ground flat | Ground raised (Sec.13) |
| ------------------ | ----------- | ---------------------- |
| no sprites         | 25.87       | 22.43                  |
| trees at full size | 29.83       | 25.70                  |
| trees at 0.4       | 25.97       |                        |
| trees at 0.5       | 25.81       | 19.10                  |
| trees at 0.6       | 25.80       |                        |

Full size trees are clearly wrong with DE's Small Trees on, and 0.5 and 0.6 could not be told apart on this scene. Trees draw at half size (`SMALL_TREE_SCALE`), the value another renderer uses and the one that looks right beside the game. A button beside the DE textures button turns it on (`preview.smallTrees`, remembered). A scene of a dense forest would settle 0.5 against 0.6. A tree's shadow layer peaks at 162 and is drawn as its own alpha (`SHADOW_STRENGTH` 1), as dark as DE's. Tree species, variants and positions matched the game's by eye.

## Sec.13 Tier 4, raised ground, cliffs and shadows

1. Raised ground. The textured view lifts every point by the ground under it, half a tile half width a level (`LIFT_PER_LEVEL`, from the dat's 24 pixel `elev_height` on its 96 by 48 tile). The height field rides on the viewport (`Viewport.ground`), as the squash does, so terrain, sprites, outlines, overlays and every hit test lift together. `screenToTile` finds the front-most raised point under the pointer by stepping down from the highest level and halving the crossing, and the shader runs the same search per pixel. On the hill scene the lift took the error from 23.88 to 19.10 and flat ground interiors from 10.4 to 6.3.
2. Cliffs. Cliff pieces are objects in `deObjects` with their face as the stored frame, so the sprite pass draws them. The default cliff's file holds 24 frames, one fewer than the dat's 25 angles, and a face past the file's end keeps its glyph.
3. Shadows. Every sprite's shadow layer draws under all pictures (Sec.12.3).
4. Not done. The slope shape (Sec.11 item 9). Units' idle animations draw their stored start frame and never move, as the preview is never animated.

## Sec.14 Rev 5, owner feedback after the first app run

The owner ran the textured view in the app and reported three things on 2026-11-25.

1. Sprites never drew. `worker.ts` relayed the result without `deObjects`, so `useDeSprites` had nothing to plan and every object kept its glyph. Every test passed, since they all called the generator in process. `deObjects` now crosses as one packed `Float64Array` the worker transfers (`deObjectsWire.ts`, `PreviewWireResult.deObjectsPacked`), unpacked only in the textured view. As objects it cost about 30 ms of cloning on each side per preview on a forested map. Sprites still give way to glyphs below `SPRITE_MIN_HALF_WIDTH`, as Sec.12.3 says.
2. A Terrain Blending button beside Small Trees (`preview.terrainBlends`, remembered, on by default). Off sets the shader's blend depth to 0, so every tile ends at its own edge and layers through masks still draw.
3. Hills. The owner found them odd beside the game. Each tile's face was lit on its own, which drew hard facets and stair steps on diagonal edges, and slopes too dark. Against `texture-compare`'s `first` scene (hills to level 4, Small Trees on), with a new score on the tiles within 3 of a raised tile, blurred to a third of a tile so texture grain drops out:

| Corners | Light            | Sun | All   | Hill blurred |
| ------- | ---------------- | --- | ----- | ------------ |
| max     | per face (rev 4) | 32  | 19.10 | 16.13        |
| max     | per face         | 55  | 15.78 | 10.03        |
| max     | from corners     | 32  | 17.90 | 14.52        |
| max     | from corners     | 45  | 16.01 | 10.47        |
| max     | from corners     | 55  | 15.86 | 10.46        |
| max     | from corners     | 65  | 16.29 | 11.76        |
| mean    | from corners     | 32  | 18.25 | 14.02        |
| mean    | from corners     | 50  | 17.41 | 12.46        |
| mean    | from corners     | 17  | 23.74 | 24.34        |

The sun's height matters most and the two light models score alike, but by eye only light from the corners has DE's soft mound; per face keeps the facets at any sun. Mean corners look as smooth and score 2 worse. Built: `CORNER_RULE` max, `CORNER_LIGHT` on (`buildCornerLight`, the slope around each corner, blended across the tile in the shader), `SUN` 50 degrees up. Corners are a `Float32Array` uploaded as RG32F beside their light. The shipped settings score 15.83 and 10.20.

This retires Sec.10.5's fit of a one level slope to half brightness, which came from one screenshot reading and cannot hold with a 50 degree sun. Sec.11 items 7 and 9 now read as follows. The shape of DE's slopes is still not settled pixel for pixel, only by one scene, and a two level step now draws dim rather than near black.

### Sec.14.1 Second round, the same day

1. Blocky artifacts beside trees, reported on Pag seed 1 near tile 63, 130. `sld.ts` read layer flag bit 0 as "keep skipped blocks from the previous frame". The bit that does is 0x80 (`REUSE_PREVIOUS`). The dragon tree's frame 4 sets 0x80 over frame 3's rectangle, and decoded with nothing kept it had square holes. Bit 0 is set on nearly every tree shadow layer, so each shadow was patched with blocks of the unrelated variants before it, which drew as stair stepped dark blocks. The hand built test had encoded the reuse flag as 1 and so asserted the bug.
2. Town centres drew only their back piece. A town centre is the object 109 plus three annexes the game adds (main 618, centre 619, front 620, and 890 with no picture), and the saved map, and so `deObjects`, holds only 109. `planSprites` now adds each object's annexes (object-data.json's `ann`) at their offsets in tiles, drawn and sorted as objects of their own, under the parent's id so the Obj. List hides all of it. `s_town_center_extra` has no SLD in the install and is skipped as any missing file is.
3. An object the dat gives no picture (no standing graphic, or one with no file anywhere in its deltas, such as 1613) no longer draws a circle in the sprite view. A circle stays only for an object whose picture exists but did not load.
4. A Hide Decorations button beside Terrain Blending (`preview.hideDecorations`, remembered, off by default), shown in both views. It leaves out the circles of terrain objects in the decoration category, the only objects that carry it. Sprites still draw.

### Sec.14.2 Sprites on the GPU

With sprites drawn down to a 4 pixel tile, a zoomed out forest map lagged. A browser pane benchmark of 30,000 tree sized sprites with shadows on a Large map took about 1.1 s a frame on the 2D canvas, and neither plain destination rectangles in place of save, transform and restore, nor shrunk copies of the pictures, changed that by more than 10 percent. The cost is the drawImage calls themselves.

`spritesGl.ts` draws the sprites with WebGL2 instead, in its own canvas, copied onto the visible one with one drawImage where `drawSprites` ran. Every picture the map needs is packed once into a texture array with mip levels and a 16 texel gutter (`packAtlas`), and every sprite's position, ground height, rectangle and texels go once into an instance buffer per pass (`buildSpriteInstances`). The vertex shader applies `latticeToScreen` and the sprite scale, so a pan or zoom sets four numbers and draws twice, shadows then pictures, in the sorted order. Measured on the same 30,000 sprites in the browser pane:

| Half width | 2D canvas | GPU frame |
| ---------- | --------- | --------- |
| 2          | 3815 ms   | 12.4 ms   |
| 4          | 4185 ms   | 18.3 ms   |
| 8          | 2065 ms   | 14.3 ms   |
| 24         | 254 ms    | 11.3 ms   |

The first upload took 205 ms, once per map. Close in the two pictures differ by 2 per channel on average, filtering. Far out by about 12, since the GPU averages a shrunk picture through its mip levels where the 2D canvas samples it. `drawSprites` stays as the fallback without WebGL2 and for the comparison page. The circles of objects whose picture did not load still draw on the 2D canvas over the sprites.

### Sec.14.3 A script's own standing graphics

Mont Saint Michel sets `effect_amount GAIA_SET_ATTRIBUTE HAY_STACK ATTR_STANDING_GRAPHIC 12783`, a bridge piece, and ten more such lines for driftwood, walls and town buildings. The object stage already read attribute 71 to pick frames, but the renderer drew every object as the dat's graphic. `PreviewResult.standingGraphics` now carries the overrides as [object, graphic] pairs per scope, Gaia (`GAIA_SET_ATTRIBUTE`) and players (`SET_ATTRIBUTE`, which also covers Gaia, as `collectEffects` reads it), and `planSprites` draws an object as its owner's scope's graphic before the dat's, annexes included. A graphic missing from `object-sprites.json`, which holds only graphics some object stands as, keeps the object's circle rather than drawing nothing or the old picture. Every graphic Mont Saint Michel sets is in the table, and its 81 hay stacks plan as `s_bridge_piece_cd_middle_a_x1`. `UPGRADE_UNIT` was first left undrawn; RMSTEST_86a (2026-11-25) then showed DE saves the original object and draws the target, so an upgraded object now draws as its target's graphic, the script's override for the target first, an override on the object itself before both. RMSTEST_85a and 85c confirmed the player scope and the town centre reading.

### Sec.14.4 Preview Options tab and the minimap view

The settings box over the map has two tabs. Generation Settings holds what it always did. Preview Options holds DE textures, Small Trees, Terrain Blending and Hide Decorations as checkboxes, moved from the toolbar, the two textured view options disabled while DE textures is off.

The minimap colour button now shows the game's minimap: the flat diamond view whatever the DE textures option says, terrain in the minimap colours, trees and cliff tiles filled, and only resources, relics and players' objects drawn, as squares the size of their footprint (`minimapLayer.ts`). What shows comes from each object's dat class and first resource slot: wood on a tree class object fills its tile, gold, stone, food (type 0) and fish (type 17) take their own colours, class 42 is the relic, and anything else a player owns takes that player's colour. A resource keeps its resource colour whoever owns it, so a player's starting sheep reads as food. The owner set cliffs #7E3F32, food #9FD994, stone #776363, fish #75B7AA and relics white. Gold and trees keep the preview's own colours, since none was given.

Squares draw at three times the footprint, deep water fish one and a half times (at least 4 pixels), players' objects over gold over stone over the rest, and the numbered player circles are left out in this view. A Preview Options checkbox, Hide player circles, leaves them out of the other two views. The settings box keeps both tabs laid out, one hidden, so it does not change size between them.

### Sec.14.5 The open gaps, investigated 2026-11-25

1. Cliff faces. Every cliff object (264 to 272) stands as graphic 1574, which the dat gives 25 angles while `n_cliff_default_x1.sld` holds 24 frames. Across the 339 DE maps of the object gate, cliff pieces store faces 0 to 23 only, never 24. So no real map draws the missing face, and Sec.13 item 2's glyph never shows. Closed.
2. Load pauses. Measured in Node with the game running beside it, so high: 15 terrain textures decoded in 1.5 s, about 100 ms each, and tree sprites at about 13 ms a frame (acacia 30 frames in 493 ms, oak 42 in 524). Both ran on the window's thread in small chunks, so a forested map stuttered for a second or two while it loaded. Built the same day: the files are still read on that thread (Tauri's fs plugin), and decoded in `decodeWorker.ts`, which hands back transferred pixels and ImageBitmaps. In the browser the window was held at most 9 to 18 ms while a texture and 42 tree frames decoded, against 91 ms for one texture on the window. The GPU sprite atlas no longer uploads 16 MB of zeros per page, since WebGL zero-fills new textures.
3. Measured the same day from scenes generated by script (`RMS/texture-compare/results.md`). Land under water blends match DE (edge error 8.3 against 21.4 without blends). Mean tile corners lose on a second hill scene too and are settled; sun 45 to 50 degrees is best on both. Which of a side's four drawings a tile uses is not separable on these scenes. Colour moods did not apply in the editor or in skirmish games, so the grade for other moods stays unmeasured. Originally: slope shape, the blend mode table beyond land over land, which of a side's four drawings a tile uses, and other colour moods each need a picture from the game. Six scene scripts in `RMS/texture-compare/scenes/scripts/` (coasts, hills to level 7, small grass blobs for edges, the edges scene under CC_AUTUMN, CC_WINTER and CC_NIGHT) are queued for the game session after RMSTEST batch 21, captured losslessly and saved, for `compare.py` to read.

### Sec.14.6 Colour moods, and the grade with Map lighting on

The owner's DE ran with Graphics on Low and Map lighting off, so every capture before 2026-11-25 evening, Sec.10.7's included, showed the game without its lighting pass, and `color_correction` showed nothing. With Map lighting on:

1. Moods. Each of the 18 moods is, within about one unit (darkness 4.6), a per channel gain and offset of the default mood's picture, measured from skirmish games of one scene under each (`RMS/texture-compare/results.md`). `readColorMood` (`src/preview/generator/colorMood.ts`) reads the script's last `color_correction`, resolving a name, the script's own `#const` or a number, into `PreviewResult.colorMood`. `colourMoods.ts` holds the transforms, and the terrain shader and the GPU sprite shader apply the mood after the grade. The 2D sprite fallback draws without it.
2. Grade. Refitted on the coast and edges scenes captured with lighting on: gain 0.992, 1.001, 0.983, offset 8.8, 2.3, 11.2. Error fell from 12.2 to 9.2 on coast, 14.1 to 11.6 on edges and 15.0 to 13.2 on hills. The preview now matches the default graphics settings rather than Low.
3. Hill light. Rechecked with lighting on and the new grade: sun 45 and 50 tie, 40 is worse, so it stays at 50. Corner light and max corners stay.
