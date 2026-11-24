import type { DecodedImage } from "./dds";
import { IDENTITY_MOOD, type MoodTransform } from "./colourMoods";
import {
  CANOPY_COLOR,
  CANOPY_WEIGHT,
  CLIFF_COLOR,
  CLIFF_WEIGHT,
} from "./palette";
import { LIFT_PER_LEVEL, halfHeightOf, type Viewport } from "./projection";
import {
  ATLAS_CELL_OF_TILE,
  BLEND_ATLAS_FILES,
  NEIGHBOURS,
  type BlendBytes,
} from "./terrainBlends";
import {
  DE_COLOUR_GRADE,
  LEVEL_HEIGHT,
  MASK_COVER_EXPONENT,
  MASK_SIZE,
  SUN,
  CORNER_LIGHT,
  buildCornerLight,
  type Sun,
  TEXTURE_SIZE,
  type TerrainTable,
} from "./texturedTiles";

/** The measured parts of the look that a comparison may switch off. */
export interface TexturedLook {
  maskExponent: number;
  grade: { gain: readonly number[]; offset: readonly number[] };
  /**
   * The flat view's forest tint. Zero here, since the sprite pass draws the
   * trees themselves and DE shows the forest's own ground under them
   * (Sec.12). CANOPY_WEIGHT is the flat view's value, for comparisons.
   */
  canopyWeight: number;
  /** The direction toward the sun for the hill light. */
  sun: Sun;
  /**
   * True blends each tile's light from its corners' light
   * (`buildCornerLight`), so a slope shades smoothly. False lights each
   * point by the slope of its own tile's face.
   */
  cornerLight: boolean;
}

export const DE_LOOK: TexturedLook = {
  maskExponent: MASK_COVER_EXPONENT,
  grade: DE_COLOUR_GRADE,
  canopyWeight: 0,
  sun: SUN,
  cornerLight: CORNER_LIGHT,
};

export { CANOPY_WEIGHT };

// The textured view's terrain, drawn by the GPU into a canvas of its own
// (docs/preview-de-textures-design.md Sec.7). drawPreview then copies that
// canvas onto the visible one with a single drawImage, and draws objects,
// overlays and outlines over it exactly as it does over the flat bitmap. So
// nothing that works in the flat view has to know this one exists.
//
// Why WebGL and not the 2D canvas the rest of the preview uses. A textured
// tile needs a texture lookup per screen pixel, and a Giant map at a close
// zoom is millions of them per frame. A 2D canvas would draw each tile as a
// clipped, transformed image, tens of thousands of draw calls per frame. The
// GPU runs the small program below once per pixel, all in parallel, in one
// draw call.

// One triangle that covers the whole screen, made from the vertex number
// alone, so there is no vertex buffer to set up. Vertices 0, 1, 2 land at
// (-1,-1), (3,-1) and (-1,3), and the part inside the screen is the screen.
const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Runs once per pixel. It undoes the projection to find the tile under the
// pixel (the same algebra as projection.ts's screenToTile), draws that tile's
// terrain and layer, then each neighbour that spreads over it through its
// blend tile (terrainBlends.ts worked out which, once per map), then the
// shade, canopy and cliff tints. Every texture is sampled at the tile
// coordinate divided by its terrain's repeat (Sec.7, Sec.10).
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp usampler2DArray;
precision mediump sampler2DArray;

uniform usampler2D uTiles;
uniform highp sampler2D uCorners; // r height in levels, g corner light
uniform usampler2DArray uBlends;
uniform sampler2D uLut;
uniform sampler2DArray uTextures;
uniform sampler2DArray uMasks;
uniform sampler2DArray uAtlases;
uniform int uAtlasCell[${ATLAS_CELL_OF_TILE.length}];
uniform int uBlendDepth;
uniform vec4 uView;      // originX, originY, halfWidth, halfHeight, CSS pixels
uniform float uRatio;    // device pixels per CSS pixel
uniform float uHeight;   // backing store height, device pixels
uniform float uDim;
uniform vec3 uCanopy;
uniform float uCanopyWeight;
uniform vec3 uCliff;
uniform float uCliffWeight;
uniform float uMaskExponent;
uniform float uMaxLevel;     // 0 draws the ground flat
uniform vec3 uSun;
uniform bool uCornerLight;
uniform vec3 uGradeGain;
uniform vec3 uGradeOffset;   // 0 to 1
uniform vec3 uMoodGain;      // the script's colour mood (colourMoods.ts)
uniform vec3 uMoodOffset;    // 0 to 1

out vec4 outColor;

// Each neighbour bit's blend tile, terrainBlends.ts's NEIGHBOURS.
const int NEIGHBOUR_TILE[8] = int[8](${NEIGHBOURS.map((n) => n.tile).join(", ")});

// Set once in main and read by the helpers below.
vec2 t;      // the pixel's continuous tile coordinate
vec2 tdx;    // its rate of change across one pixel, see main
vec2 tdy;

// One of a terrain's two table rows (texturedTiles.ts's TerrainTable.lut).
vec4 lut(int id, int row) { return texelFetch(uLut, ivec2(id, row), 0); }

// A texture of a terrain that repeats every repeatTiles tiles. The
// derivatives are of the unwrapped coordinate, not of fract's. fract jumps
// from 1 back to 0 at every repeat boundary, and derivatives of that jump
// would tell the GPU the texture is squeezed a thousand times over, so it
// would pick its smallest mip and draw a seam along each boundary.
vec4 sampleRepeating(sampler2DArray s, float slot, float repeatTiles) {
  float r = max(repeatTiles, 1.0);
  return textureGrad(s, vec3(fract(t / r), slot), tdx / r, tdy / r);
}

// A terrain's own look, its texture or, without one, its flat colour.
vec3 terrainColour(int id) {
  vec4 entry = lut(id, 0);
  int slot = int(entry.a * 255.0 + 0.5);
  if (slot == 255) return entry.rgb;
  return sampleRepeating(uTextures, float(slot), lut(id, 1).r * 255.0).rgb;
}

// How much of a layer shows, from its mask through the game's cover curve
// (texturedTiles.ts's MASK_COVER_EXPONENT). A terrain naming no mask has the
// default one, so 255 here means only that its mask did not load.
float layerCover(int id) {
  vec4 row = lut(id, 1);
  int slot = int(row.g * 255.0 + 0.5);
  if (slot == 255) return 1.0;
  float value = sampleRepeating(uMasks, float(slot), row.r * 255.0).r;
  return pow(value, uMaskExponent);
}

// A tile's look, its terrain with its layer drawn over through the mask.
vec3 pairColour(int terrain, int layer) {
  vec3 colour = terrainColour(terrain);
  if (layer != 255) colour = mix(colour, terrainColour(layer), layerCover(layer));
  return colour;
}

// A blend tile's cover at a point of the tile. Clamped half a pixel inside
// its 64 pixel cell, so filtering never reads the neighbouring cell.
float blendCover(int mode, int tile, vec2 f) {
  int cell = uAtlasCell[tile];
  vec2 pixel = vec2(cell % 8, cell / 8) * 64.0 + clamp(f * 64.0, 0.5, 63.5);
  return textureLod(uAtlases, vec3(pixel / 512.0, float(mode)), 0.0).r;
}

float cornerHeight(ivec2 corner) {
  return texelFetch(uCorners, corner, 0).r;
}

float cornerLight(ivec2 corner) {
  return texelFetch(uCorners, corner, 0).g;
}

// The ground's height at a continuous tile point, blended from its corners
// (projection.ts's groundHeightAt).
// A tile's surface blended from its corners (projection.ts's groundHeightAt).
// x is the height at f, yz its slope in levels a tile along x and y.
vec3 blendedSurface(ivec2 cell, vec2 f) {
  float h00 = cornerHeight(cell);
  float h10 = cornerHeight(cell + ivec2(1, 0));
  float h01 = cornerHeight(cell + ivec2(0, 1));
  float h11 = cornerHeight(cell + ivec2(1, 1));
  float h = mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  vec2 slope = vec2(mix(h10 - h00, h11 - h01, f.y), mix(h01 - h00, h11 - h10, f.x));
  return vec3(h, slope);
}

float groundHeight(vec2 p) {
  vec2 c = clamp(p, vec2(0.0), vec2(uDim));
  ivec2 i0 = min(ivec2(floor(c)), ivec2(int(uDim) - 1));
  return blendedSurface(i0, c - vec2(i0)).x;
}

// The tile point a screen point shows when the ground there stands that many
// levels high, the flat inverse with the point moved down by the lift.
vec2 flatAt(float u, float cssY, float level) {
  float v = (cssY + level * ${LIFT_PER_LEVEL.toFixed(3)} * uView.z - uView.y) / uView.w;
  return vec2(u - v, u + v) * 0.5;
}

// texturedTiles.ts's slopeLight. With corner light on, the light worked out
// at each corner is blended across the tile, as a smooth shaded mesh is.
// Off, the light of the tile's own face at this point, which changes at
// every tile edge.
float hillLight(ivec2 cell, vec2 f) {
  if (uCornerLight) {
    float l00 = cornerLight(cell);
    float l10 = cornerLight(cell + ivec2(1, 0));
    float l01 = cornerLight(cell + ivec2(0, 1));
    float l11 = cornerLight(cell + ivec2(1, 1));
    return mix(mix(l00, l10, f.x), mix(l01, l11, f.x), f.y);
  }
  vec2 slope = blendedSurface(cell, f).yz;
  float dx = slope.x * ${LEVEL_HEIGHT};
  float dy = slope.y * ${LEVEL_HEIGHT};
  float lit = dot(vec3(-dx, -dy, 1.0), uSun) / length(vec3(dx, dy, 1.0));
  return clamp(lit / uSun.z, 0.0, 1.0);
}

void main() {
  // gl_FragCoord counts up from the bottom, the page counts down from the top.
  vec2 css = vec2(gl_FragCoord.x, uHeight - gl_FragCoord.y) / uRatio;
  float u = (css.x - uView.x) / uView.z;
  t = flatAt(u, css.y, 0.0);
  // Raised ground, projection.ts's screenToTile search. Step down from the
  // highest level to the first whose ground reaches it, the front-most, then
  // narrow the crossing down.
  if (uMaxLevel > 0.0) {
    for (float level = uMaxLevel; level > 0.0; level -= 0.25) {
      if (groundHeight(flatAt(u, css.y, level)) < level) continue;
      float low = level;
      float high = level + 0.25;
      for (int i = 0; i < 6; i++) {
        float mid = (low + high) * 0.5;
        if (groundHeight(flatAt(u, css.y, mid)) >= mid) low = mid;
        else high = mid;
      }
      t = flatAt(u, css.y, low);
      break;
    }
  }
  // Taken before any branch, since a derivative is only defined where every
  // pixel of a 2 by 2 group runs the same code.
  tdx = dFdx(t);
  tdy = dFdy(t);
  if (t.x < 0.0 || t.y < 0.0 || t.x >= uDim || t.y >= uDim) discard;

  ivec2 cell = ivec2(floor(t));
  vec2 f = t - vec2(cell);
  uvec4 tile = texelFetch(uTiles, cell, 0);
  vec3 colour = pairColour(int(tile.r), int(tile.a));

  // The terrains that spread over this tile, lowest priority first, so the
  // highest lands on top. Each neighbour holding one draws its own blend
  // tile, and their covers combine as stacked layers do, 1 - (1 - a)(1 - b).
  for (int k = 0; k < 8; k++) {
    if (k >= uBlendDepth) break;
    uvec4 b = texelFetch(uBlends, ivec3(cell, k), 0);
    if (b.r == 255u) break;
    int mode = int(b.a & 15u);
    int variant = int(b.a >> 4);
    float keep = 1.0;
    for (int n = 0; n < 8; n++) {
      if ((b.b & (1u << uint(n))) == 0u) continue;
      // The four sides come first, each with four drawings.
      int tile = NEIGHBOUR_TILE[n] + (n < 4 ? variant : 0);
      keep *= 1.0 - blendCover(mode, tile, f);
    }
    colour = mix(colour, pairColour(int(b.r), int(b.g)), 1.0 - keep);
  }

  // The flat view's order. Canopy, then hill light, then cliff.
  if ((tile.b & 1u) != 0u) colour = mix(colour, uCanopy, uCanopyWeight);
  colour *= hillLight(cell, f);
  // DE's picture is brighter than its textures (DE_COLOUR_GRADE). Last, over
  // everything the game draws as ground, as a screen effect would be.
  colour = colour * uGradeGain + uGradeOffset;
  // The colour mood, on top of the default mood's grade, as measured.
  colour = colour * uMoodGain + uMoodOffset;
  if ((tile.b & 2u) != 0u) colour = mix(colour, uCliff, uCliffWeight);
  outColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
}`;

function rgbUniform(colour: { r: number; g: number; b: number }): number[] {
  return [colour.r / 255, colour.g / 255, colour.b / 255];
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error("could not create a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader did not compile: ${log}`);
  }
  return shader;
}

/**
 * Owns one WebGL2 context. A class rather than a hook or plain functions,
 * because a GL context is a long lived resource with state that has to be
 * created once, updated in pieces and released once, which is what an
 * object with methods is for. React state would be the wrong home, nothing
 * here should cause a render.
 */
export class TexturedTerrainRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private tilesTexture: WebGLTexture | null = null;
  private cornersTexture: WebGLTexture | null = null;
  private blendsTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private arrayTexture: WebGLTexture | null = null;
  private masksTexture: WebGLTexture | null = null;
  private atlasesTexture: WebGLTexture | null = null;
  private dim = 0;
  private blendDepth = 0;
  /**
   * The terrain blends switch. A uniform rather than a rebuild, since the
   * shader's blend loop already stops at `uBlendDepth`, and a depth of 0
   * draws every tile to its own edge with nothing else changed.
   */
  blendsOn = true;
  /** What is uploaded now, compared by identity so an unchanged input costs nothing. */
  private uploadedTiles: Uint8Array | null = null;
  private uploadedCorners: Float32Array | null = null;
  private uploadedSun: Sun | null = null;
  private cornersDim = 0;
  private uploadedBlends: Uint8Array | null = null;
  private uploadedLut: Uint8Array | null = null;
  private uploadedLayersKey = "";
  private uploadedMasksKey: string | null = null;
  private uploadedAtlases: readonly (Uint8Array | null)[] | null = null;
  private lost = false;
  /**
   * The measured look, the app's only setting. A field rather than shader
   * constants so a comparison against the game can switch one part off and
   * see whether the game agrees better without it.
   */
  private look: TexturedLook = DE_LOOK;
  /** The script's colour mood (colourMoods.ts), set per map. A uniform, so a change costs nothing. */
  mood: MoodTransform = IDENTITY_MOOD;

  /** Replaces the measured look, for comparisons. The app never calls it. */
  setLook(look: TexturedLook): void {
    this.look = look;
    // The corner light follows the sun, so work it out again.
    if (this.uploadedCorners !== null)
      this.setCorners(this.uploadedCorners, this.cornersDim);
  }

  /** A renderer, or `null` where WebGL2 is not available. */
  static create(): TexturedTerrainRenderer | null {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
    });
    if (gl === null) return null;
    try {
      return new TexturedTerrainRenderer(canvas, gl);
    } catch (error) {
      console.warn("textured terrain is unavailable", error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("could not create a program");
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program did not link: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
    this.uniforms = {};
    for (const name of [
      "uTiles",
      "uCorners",
      "uBlends",
      "uLut",
      "uTextures",
      "uMasks",
      "uAtlases",
      "uAtlasCell",
      "uBlendDepth",
      "uView",
      "uRatio",
      "uHeight",
      "uDim",
      "uCanopy",
      "uCanopyWeight",
      "uCliff",
      "uCliffWeight",
      "uMaskExponent",
      "uMaxLevel",
      "uSun",
      "uCornerLight",
      "uGradeGain",
      "uGradeOffset",
      "uMoodGain",
      "uMoodOffset",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }
    // A GPU can take a context away (a driver reset, too many contexts). The
    // caller then falls back to the flat bitmap rather than drawing nothing.
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    // Every sampler the shader declares needs a texture bound even when the
    // map has no masks or the atlases have not loaded, so both start as one
    // empty slice. An empty atlas covers nothing, so the map draws unblended.
    this.masksTexture = this.greyArray([]);
    this.atlasesTexture = this.greyArray([]);
  }

  /**
   * A one channel texture array of 512 by 512 slices, at least one. A null
   * slice stays zero. Mipmapped and repeating when `repeat`, for masks laid
   * over the map like textures. Blend atlases are not, since a mip level
   * would average neighbouring atlas cells into each other.
   */
  private greyArray(
    slices: readonly (Uint8Array | null)[],
    repeat = false,
  ): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (texture === null) throw new Error("could not create a texture");
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    const levels = repeat ? Math.log2(MASK_SIZE) + 1 : 1;
    const depth = Math.max(1, slices.length);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      levels,
      gl.R8,
      MASK_SIZE,
      MASK_SIZE,
      depth,
    );
    // Rows of one byte are not 4 byte aligned when the width is odd. 512
    // is even, but the default alignment of 4 is a trap worth closing.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const empty = new Uint8Array(MASK_SIZE * MASK_SIZE);
    for (let slice = 0; slice < depth; slice++) {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        slice,
        MASK_SIZE,
        MASK_SIZE,
        1,
        gl.RED,
        gl.UNSIGNED_BYTE,
        slices[slice] ?? empty,
      );
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (repeat) {
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.texParameteri(
        gl.TEXTURE_2D_ARRAY,
        gl.TEXTURE_MIN_FILTER,
        gl.LINEAR_MIPMAP_LINEAR,
      );
    } else {
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, wrap);
    return texture;
  }

  /**
   * The ground's height at each tile corner, `dim + 1` a side
   * (texturedTiles.ts), uploaded beside each corner's light. Two floats a
   * texel, since heights are fractional under the mean corner rule. The
   * light depends on the look's sun, so a new sun uploads again.
   */
  setCorners(corners: Float32Array, dim: number): void {
    if (this.uploadedCorners === corners && this.uploadedSun === this.look.sun)
      return;
    const gl = this.gl;
    const light = buildCornerLight(corners, dim, this.look.sun);
    const texels = new Float32Array(corners.length * 2);
    for (let i = 0; i < corners.length; i++) {
      texels[i * 2] = corners[i];
      texels[i * 2 + 1] = light[i];
    }
    if (this.cornersTexture !== null) gl.deleteTexture(this.cornersTexture);
    this.cornersTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cornersTexture);
    // Float textures cannot be filtered in plain WebGL2, which is fine, the
    // shader reads them with texelFetch and blends them itself.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG32F,
      dim + 1,
      dim + 1,
      0,
      gl.RG,
      gl.FLOAT,
      texels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.uploadedCorners = corners;
    this.uploadedSun = this.look.sun;
    this.cornersDim = dim;
  }

  /** Which neighbours blend into each tile (terrainBlends.ts). */
  setBlends(blends: BlendBytes, dim: number): void {
    if (this.uploadedBlends === blends.bytes) return;
    const gl = this.gl;
    if (this.blendsTexture !== null) gl.deleteTexture(this.blendsTexture);
    this.blendsTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blendsTexture);
    // Integer bytes, read with texelFetch and never filtered, as the tiles.
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.RGBA8UI,
      dim,
      dim,
      blends.depth,
      0,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_BYTE,
      blends.bytes,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.uploadedBlends = blends.bytes;
    this.blendDepth = blends.depth;
  }

  /** The install's blend atlases, indexed by blend mode (`BLEND_ATLAS_FILES`). */
  setAtlases(atlases: readonly (Uint8Array | null)[]): void {
    if (this.uploadedAtlases === atlases) return;
    if (this.atlasesTexture !== null)
      this.gl.deleteTexture(this.atlasesTexture);
    const slices = BLEND_ATLAS_FILES.map((_, mode) => atlases[mode] ?? null);
    this.atlasesTexture = this.greyArray(slices);
    this.uploadedAtlases = atlases;
  }

  /** The tile bytes for a `dim` by `dim` map (texturedTiles.ts). */
  setTiles(bytes: Uint8Array, dim: number): void {
    if (this.uploadedTiles === bytes && this.dim === dim) return;
    const gl = this.gl;
    if (this.tilesTexture !== null) gl.deleteTexture(this.tilesTexture);
    this.tilesTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tilesTexture);
    // An integer texture, read with texelFetch and never filtered. Filtering
    // would average two terrain ids into a third that means nothing.
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8UI,
      dim,
      dim,
      0,
      gl.RGBA_INTEGER,
      gl.UNSIGNED_BYTE,
      bytes,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.uploadedTiles = bytes;
    this.dim = dim;
  }

  /** The terrain table and the decoded images and masks it names. */
  setTable(
    table: TerrainTable,
    images: ReadonlyMap<string, DecodedImage>,
    masks: ReadonlyMap<string, Uint8Array> = new Map(),
  ): void {
    const gl = this.gl;
    const masksKey = table.masks.join("\n");
    if (masksKey !== this.uploadedMasksKey) {
      if (this.masksTexture !== null) gl.deleteTexture(this.masksTexture);
      this.masksTexture = this.greyArray(
        table.masks.map((name) => masks.get(name) ?? null),
        true,
      );
      this.uploadedMasksKey = masksKey;
    }
    if (this.uploadedLut !== table.lut) {
      if (this.lutTexture !== null) gl.deleteTexture(this.lutTexture);
      this.lutTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        256,
        2,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        table.lut,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.uploadedLut = table.lut;
    }

    const key = table.layers.join("\n");
    if (key === this.uploadedLayersKey && this.arrayTexture !== null) return;
    if (this.arrayTexture !== null) gl.deleteTexture(this.arrayTexture);
    this.arrayTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrayTexture);
    // At least one layer, since a texture array of depth 0 is invalid and
    // the shader still declares the sampler when no terrain has a texture.
    const depth = Math.max(1, table.layers.length);
    const levels = Math.log2(TEXTURE_SIZE) + 1;
    // texStorage3D fixes the size and every mip level up front, which is
    // what generateMipmap below then fills.
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      levels,
      gl.RGBA8,
      TEXTURE_SIZE,
      TEXTURE_SIZE,
      depth,
    );
    table.layers.forEach((name, layer) => {
      const image = images.get(name);
      if (image === undefined) return;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        TEXTURE_SIZE,
        TEXTURE_SIZE,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        new Uint8Array(
          image.pixels.buffer,
          image.pixels.byteOffset,
          image.pixels.byteLength,
        ),
      );
    });
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.uploadedLayersKey = key;
  }

  /**
   * Draws one frame at the visible canvas's backing size. False when nothing
   * could be drawn, so the caller falls back to the flat bitmap.
   */
  render(viewport: Viewport, ratio: number): boolean {
    const gl = this.gl;
    if (
      this.lost ||
      gl.isContextLost() ||
      this.tilesTexture === null ||
      this.cornersTexture === null ||
      this.blendsTexture === null ||
      this.lutTexture === null ||
      this.arrayTexture === null ||
      this.masksTexture === null ||
      this.atlasesTexture === null
    ) {
      return false;
    }
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tilesTexture);
    gl.uniform1i(this.uniforms.uTiles, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.uniform1i(this.uniforms.uLut, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arrayTexture);
    gl.uniform1i(this.uniforms.uTextures, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blendsTexture);
    gl.uniform1i(this.uniforms.uBlends, 3);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.masksTexture);
    gl.uniform1i(this.uniforms.uMasks, 4);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasesTexture);
    gl.uniform1i(this.uniforms.uAtlases, 5);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.cornersTexture);
    gl.uniform1i(this.uniforms.uCorners, 6);
    gl.uniform1iv(this.uniforms.uAtlasCell, ATLAS_CELL_OF_TILE);
    gl.uniform1i(
      this.uniforms.uBlendDepth,
      this.blendsOn ? this.blendDepth : 0,
    );

    gl.uniform4f(
      this.uniforms.uView,
      viewport.originX,
      viewport.originY,
      viewport.halfWidth,
      halfHeightOf(viewport),
    );
    gl.uniform1f(this.uniforms.uRatio, ratio);
    gl.uniform1f(this.uniforms.uHeight, height);
    gl.uniform1f(this.uniforms.uDim, this.dim);
    gl.uniform3fv(this.uniforms.uCanopy, rgbUniform(CANOPY_COLOR));
    gl.uniform1f(this.uniforms.uCanopyWeight, this.look.canopyWeight);
    gl.uniform3fv(this.uniforms.uCliff, rgbUniform(CLIFF_COLOR));
    gl.uniform1f(this.uniforms.uCliffWeight, CLIFF_WEIGHT);
    gl.uniform1f(this.uniforms.uMaskExponent, this.look.maskExponent);
    const sun = this.look.sun;
    gl.uniform3f(this.uniforms.uSun, sun.x, sun.y, sun.z);
    gl.uniform1i(this.uniforms.uCornerLight, this.look.cornerLight ? 1 : 0);
    // The viewport says whether the ground is raised, so the terrain lifts
    // exactly when every point drawn over it does.
    gl.uniform1f(this.uniforms.uMaxLevel, viewport.ground?.maxLevel ?? 0);
    gl.uniform3fv(this.uniforms.uGradeGain, this.look.grade.gain);
    gl.uniform3fv(
      this.uniforms.uGradeOffset,
      this.look.grade.offset.map((v) => v / 255),
    );
    gl.uniform3fv(this.uniforms.uMoodGain, this.mood.gain);
    gl.uniform3fv(
      this.uniforms.uMoodOffset,
      this.mood.offset.map((v) => v / 255),
    );

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  /** Frees the GPU memory now rather than whenever the page drops the canvas. */
  dispose(): void {
    const gl = this.gl;
    for (const texture of [
      this.tilesTexture,
      this.cornersTexture,
      this.blendsTexture,
      this.lutTexture,
      this.arrayTexture,
      this.masksTexture,
      this.atlasesTexture,
    ]) {
      if (texture !== null) gl.deleteTexture(texture);
    }
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
