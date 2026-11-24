import { LIFT_PER_LEVEL, aspectOf, groundHeightAt } from "./projection";
import type { GroundHeights, Viewport } from "./projection";
import type { SpriteLayer } from "./drawPreview";
import { spriteKey, type SpriteImage } from "./objectSprites";
import { IDENTITY_MOOD, type MoodTransform } from "./colourMoods";

// The textured view's object sprites, drawn by the GPU (docs/preview-de-
// textures-design.md Sec.14.2). The 2D canvas drew each sprite with its own
// drawImage call, and a zoomed out forest map is tens of thousands of trees
// and as many shadows. Measured in the browser pane, 60,000 draws took about
// 1.1 s a frame however each draw was made (plain rectangles, smaller copies
// of the pictures), since the cost is the calls themselves. Here every
// picture the map needs is copied once into a texture, every sprite's place
// once into a buffer, and a frame is two draw calls, shadows then pictures.
// Panning and zooming change four numbers.
//
// The same pattern as texturedTerrainGl.ts. The GPU draws into a canvas of
// its own, and drawPreview copies that onto the visible canvas with one
// drawImage, between the terrain and the overlays.

/** The atlas page size. 2048 is within every WebGL2 device's limit. */
const PAGE = 2048;

/**
 * Clear pixels around each picture in the atlas. A sprite drawn small reads
 * a shrunk copy of the atlas (a mip level), where neighbouring pictures run
 * together. A gutter of 2 to the power `MAX_MIP` keeps them apart down to
 * the smallest level used.
 */
const MAX_MIP = 4;
const GUTTER = 2 ** MAX_MIP;

/** One picture's place in the atlas, in texels. */
export interface AtlasSlot {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Places pictures on pages in rows (shelf packing), tallest first so rows
 * waste little. Pure, so it is tested in Node. A picture larger than a page
 * gets no slot and does not draw.
 */
export function packAtlas(
  sizes: readonly { width: number; height: number }[],
  page = PAGE,
  gutter = GUTTER,
): (AtlasSlot | null)[] {
  const order = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size.height - a.size.height);
  const slots: (AtlasSlot | null)[] = sizes.map(() => null);
  let current = 0;
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const { size, index } of order) {
    const w = size.width + gutter;
    const h = size.height + gutter;
    if (w > page || h > page) continue;
    if (x + w > page) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    if (y + h > page) {
      current++;
      x = 0;
      y = 0;
      rowHeight = 0;
    }
    slots[index] = {
      page: current,
      x: x + gutter / 2,
      y: y + gutter / 2,
      width: size.width,
      height: size.height,
    };
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return slots;
}

/** Floats per sprite in the instance buffer. */
export const INSTANCE_FLOATS = 12;

/**
 * One float array for each pass, shadows and pictures, in draw order. Per
 * sprite: x + y and y - x of its position in tiles, the ground's height there
 * in levels, its rectangle in sprite pixels from the position (x, y, width,
 * height, the width negative for a mirrored sprite), its texels in the atlas
 * (u0, v0, u1, v1) and its page. Pure, so it is tested in Node.
 */
export function buildSpriteInstances(
  layer: SpriteLayer,
  slotOf: (bitmap: ImageBitmap) => AtlasSlot | null,
  ground: GroundHeights | undefined,
): { shadows: Float32Array; images: Float32Array } {
  const passes = { shadows: [] as number[], images: [] as number[] };
  for (const part of layer.parts) {
    if (layer.hiddenIds?.has(part.objectId)) continue;
    const image: SpriteImage | undefined = layer.images.get(
      spriteKey(part.file, part.frame, part.owner),
    );
    if (image === undefined) continue;
    const scale = layer.scaleOf?.(part.objectId) ?? 1;
    const lift =
      ground === undefined ? 0 : groundHeightAt(ground, part.x, part.y);
    for (const pass of ["shadows", "images"] as const) {
      const bitmap = pass === "shadows" ? image.shadow : image.image;
      if (bitmap === null) continue;
      const slot = slotOf(bitmap);
      if (slot === null) continue;
      const ox = part.dx + (pass === "shadows" ? image.shadowX : image.x);
      const oy = part.dy + (pass === "shadows" ? image.shadowY : image.y);
      // drawSprites mirrors about the hotspot, offsets included, so a
      // mirrored picture spans -(ox + width) to -ox.
      const left = part.mirrored ? -(ox + slot.width) : ox;
      const u0 = part.mirrored ? slot.x + slot.width : slot.x;
      const u1 = part.mirrored ? slot.x : slot.x + slot.width;
      passes[pass].push(
        part.x + part.y,
        part.y - part.x,
        lift,
        left * scale,
        oy * scale,
        slot.width * scale,
        slot.height * scale,
        u0,
        slot.y,
        u1,
        slot.y + slot.height,
        slot.page,
      );
    }
  }
  return {
    shadows: Float32Array.from(passes.shadows),
    images: Float32Array.from(passes.images),
  };
}

const VERTEX_SHADER = `#version 300 es
in vec3 aPlace;   // x + y, y - x, ground height in levels
in vec4 aRect;    // sprite pixels from the position: x, y, width, height
in vec4 aUv;      // atlas texels: u0, v0, u1, v1
in float aPage;
uniform vec4 uView;   // originX, originY, halfWidth, aspect, CSS pixels
uniform vec2 uSize;   // canvas size, CSS pixels
uniform float uLift;  // LIFT_PER_LEVEL
uniform float uPage;  // atlas page size, texels
out vec3 vUv;
void main() {
  // Two triangles from the vertex number, so there is no corner buffer.
  int i = gl_VertexID;
  vec2 corner = vec2(i == 1 || i == 4 || i == 5 ? 1.0 : 0.0,
                     i == 2 || i == 3 || i == 5 ? 1.0 : 0.0);
  float hw = uView.z;
  // projection.ts's latticeToScreen, then the sprite's rectangle at one
  // sprite pixel per 96th of a tile's width (drawSprites).
  vec2 at = vec2(uView.x + aPlace.x * hw,
                 uView.y + aPlace.y * hw * uView.w - aPlace.z * uLift * hw);
  vec2 css = at + (aRect.xy + corner * aRect.zw) * (hw * 2.0 / 96.0);
  vec2 clip = css / uSize * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUv = vec3(mix(aUv.xy, aUv.zw, corner) / uPage, aPage);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision mediump sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uMoodGain;
uniform vec3 uMoodOffset;  // 0 to 1
in vec3 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uAtlas, vUv);
  // The colour mood, as on the terrain. The texels are premultiplied, so the
  // offset scales with coverage and a clear texel stays clear.
  outColor = vec4(c.rgb * uMoodGain + uMoodOffset * c.a, c.a);
}`;

function compileShader(
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
    throw new Error(`sprite shader did not compile: ${log}`);
  }
  return shader;
}

export class SpriteRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private readonly vaos: {
    shadows: WebGLVertexArrayObject;
    images: WebGLVertexArrayObject;
  };
  private readonly buffers: { shadows: WebGLBuffer; images: WebGLBuffer };
  private counts = { shadows: 0, images: 0 };
  private atlas: WebGLTexture | null = null;
  private slots = new Map<ImageBitmap, AtlasSlot | null>();
  /** What is uploaded now, compared by identity so an unchanged layer costs nothing. */
  private atlasFor: SpriteLayer["images"] | null = null;
  private instancesFor: {
    layer: SpriteLayer;
    ground: GroundHeights | undefined;
  } | null = null;
  private lost = false;
  /** The script's colour mood (colourMoods.ts). The 2D fallback draws without it. */
  mood: MoodTransform = IDENTITY_MOOD;

  /** A renderer, or `null` where WebGL2 is not available. drawSprites then draws on the 2D canvas. */
  static create(): SpriteRenderer | null {
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
      return new SpriteRenderer(canvas, gl);
    } catch (error) {
      console.warn("GPU sprites are unavailable", error);
      return null;
    }
  }

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const program = gl.createProgram();
    if (program === null) throw new Error("could not create a program");
    gl.attachShader(
      program,
      compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER),
    );
    gl.attachShader(
      program,
      compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(`program did not link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    this.uniforms = {};
    for (const name of [
      "uView",
      "uSize",
      "uLift",
      "uPage",
      "uAtlas",
      "uMoodGain",
      "uMoodOffset",
    ])
      this.uniforms[name] = gl.getUniformLocation(program, name);
    const makeVao = (): [WebGLVertexArrayObject, WebGLBuffer] => {
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      if (vao === null || buffer === null)
        throw new Error("could not create a buffer");
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = INSTANCE_FLOATS * 4;
      let offset = 0;
      for (const [name, size] of [
        ["aPlace", 3],
        ["aRect", 4],
        ["aUv", 4],
        ["aPage", 1],
      ] as const) {
        const at = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(at);
        gl.vertexAttribPointer(at, size, gl.FLOAT, false, stride, offset);
        // One value per sprite, not per corner, which is what makes this
        // instanced drawing.
        gl.vertexAttribDivisor(at, 1);
        offset += size * 4;
      }
      gl.bindVertexArray(null);
      return [vao, buffer];
    };
    const [shadowVao, shadowBuffer] = makeVao();
    const [imageVao, imageBuffer] = makeVao();
    this.vaos = { shadows: shadowVao, images: imageVao };
    this.buffers = { shadows: shadowBuffer, images: imageBuffer };
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
  }

  /** Copies every picture of the layer into the atlas, once per set of pictures. */
  private uploadAtlas(images: SpriteLayer["images"]): void {
    if (this.atlasFor === images) return;
    const gl = this.gl;
    const bitmaps: ImageBitmap[] = [];
    const seen = new Set<ImageBitmap>();
    for (const image of images.values())
      for (const bitmap of [image.image, image.shadow])
        if (bitmap !== null && !seen.has(bitmap)) {
          seen.add(bitmap);
          bitmaps.push(bitmap);
        }
    const packed = packAtlas(bitmaps);
    const pages = Math.max(
      1,
      ...packed.map((s) => (s === null ? 0 : s.page + 1)),
    );
    if (this.atlas !== null) gl.deleteTexture(this.atlas);
    this.atlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      MAX_MIP + 1,
      gl.RGBA8,
      PAGE,
      PAGE,
      pages,
    );
    // The gutters must be clear. WebGL zero-fills every texture it
    // allocates, unlike desktop OpenGL, so they already are. An explicit
    // clear here uploaded 16 MB of zeros per page.
    // Premultiplied, as the canvas composites, so a shrunk copy blends a
    // picture's edge with clear texels and not with black.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    this.slots = new Map();
    bitmaps.forEach((bitmap, i) => {
      const slot = packed[i];
      this.slots.set(bitmap, slot);
      if (slot === null) return;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        slot.x,
        slot.y,
        slot.page,
        slot.width,
        slot.height,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bitmap,
      );
    });
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(
      gl.TEXTURE_2D_ARRAY,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlasFor = images;
    this.instancesFor = null;
  }

  /** The layer to draw, uploaded only when it or the ground changed. */
  setLayer(layer: SpriteLayer, ground: GroundHeights | undefined): void {
    this.uploadAtlas(layer.images);
    if (
      this.instancesFor?.layer === layer &&
      this.instancesFor.ground === ground
    )
      return;
    const gl = this.gl;
    const { shadows, images } = buildSpriteInstances(
      layer,
      (bitmap) => this.slots.get(bitmap) ?? null,
      ground,
    );
    for (const [pass, data] of [
      ["shadows", shadows],
      ["images", images],
    ] as const) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[pass]);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.counts[pass] = data.length / INSTANCE_FLOATS;
    }
    this.instancesFor = { layer, ground };
  }

  /** Frees the GPU memory now rather than whenever the page drops the canvas. */
  dispose(): void {
    const gl = this.gl;
    if (this.atlas !== null) gl.deleteTexture(this.atlas);
    gl.deleteBuffer(this.buffers.shadows);
    gl.deleteBuffer(this.buffers.images);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Draws a frame at the visible canvas's backing size. False when it could not. */
  render(viewport: Viewport, ratio: number): boolean {
    const gl = this.gl;
    if (this.lost || gl.isContextLost() || this.atlas === null) return false;
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.uniform1i(this.uniforms.uAtlas, 0);
    gl.uniform4f(
      this.uniforms.uView,
      viewport.originX,
      viewport.originY,
      viewport.halfWidth,
      aspectOf(viewport),
    );
    gl.uniform2f(this.uniforms.uSize, viewport.width, viewport.height);
    gl.uniform1f(
      this.uniforms.uLift,
      viewport.ground === undefined ? 0 : LIFT_PER_LEVEL,
    );
    gl.uniform1f(this.uniforms.uPage, PAGE);
    gl.uniform3fv(this.uniforms.uMoodGain, this.mood.gain);
    gl.uniform3fv(
      this.uniforms.uMoodOffset,
      this.mood.offset.map((v) => v / 255),
    );
    // Every shadow under every picture, as drawSprites draws them.
    for (const pass of ["shadows", "images"] as const) {
      if (this.counts[pass] === 0) continue;
      gl.bindVertexArray(this.vaos[pass]);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.counts[pass]);
    }
    gl.bindVertexArray(null);
    return true;
  }
}
