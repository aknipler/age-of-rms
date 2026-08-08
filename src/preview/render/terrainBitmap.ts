import { NO_LAYER } from "../generator/grid";
import type { StageSnapshot } from "../generator/types";
import {
  CANOPY_COLOR,
  CANOPY_WEIGHT,
  CLIFF_COLOR,
  CLIFF_WEIGHT,
  LAYER_TINT_WEIGHT,
  mix,
  shadeForElevation,
  type TerrainPalette,
} from "./palette";

/**
 * Turns a stage snapshot into a dim x dim RGBA bitmap — one pixel per tile,
 * in TILE space, with no projection applied at all.
 *
 * That last part is the whole trick, and it is worth understanding because it
 * is what makes the preview cheap. The obvious renderer walks the grid and
 * strokes 40,000 diamond paths per frame, which is far too slow to pan
 * smoothly. Instead this builds a plain square bitmap once per result, and
 * drawPreview.ts hands it to the canvas under an affine transform that maps
 * the unit square to a tile diamond. The rotation, the scale and the pan all
 * become one `drawImage`, and zooming re-draws rather than re-computes.
 *
 * Pure: takes bytes and a palette, returns bytes. No canvas here, so it runs
 * in Node and can be asserted pixel by pixel in tests.
 */
export interface TerrainBitmap {
  dim: number;
  /** RGBA, 4 bytes per tile, row-major — the layout ImageData expects. */
  pixels: Uint8ClampedArray;
}

export function buildTerrainBitmap(
  snapshot: StageSnapshot,
  palette: TerrainPalette,
): TerrainBitmap {
  const { dim, terrain, layer, elevation, cliff } = snapshot;
  const pixels = new Uint8ClampedArray(dim * dim * 4);

  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const index = y * dim + x;
      const terrainId = terrain[index];
      let color = palette.colorFor(terrainId);

      // A visual layer sits on top of the terrain rather than replacing it,
      // so it tints. Sec.9 item 6 excludes real terrain_mask blending, and a
      // flat tint is the honest stand-in for it.
      const layerId = layer[index];
      if (layerId !== NO_LAYER) {
        color = mix(color, palette.colorFor(layerId), LAYER_TINT_WEIGHT);
      }

      // The canopy goes on AFTER the layer, and reads the terrain rather than
      // the layer, because trees follow the terrain that owns the tile's
      // properties — the same rule the engine uses for its automatic objects,
      // and the reason `terrain_mask 2` moves them (see CANOPY_COLOR).
      if (palette.isForest(terrainId)) {
        color = mix(color, CANOPY_COLOR, CANOPY_WEIGHT);
      }

      // Light comes from the screen's upper left, which is -y in tile space
      // (projection.ts's compass). At the y = 0 edge there is no neighbour,
      // so the tile compares against itself and reads as flat — which is
      // right: an unknown slope should not be drawn as a lit one.
      const lightNeighbour = y === 0 ? elevation[index] : elevation[index - dim];
      color = shadeForElevation(color, elevation[index], lightNeighbour);

      if (cliff[index] !== 0) {
        color = mix(color, CLIFF_COLOR, CLIFF_WEIGHT);
      }

      const p = index * 4;
      pixels[p] = color.r;
      pixels[p + 1] = color.g;
      pixels[p + 2] = color.b;
      pixels[p + 3] = 255;
    }
  }

  return { dim, pixels };
}
