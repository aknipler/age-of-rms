/// <reference lib="webworker" />
import { UnsupportedDdsError, decodeDdsAtMost, enlarge } from "./dds";
import { SldFile } from "./sld";
import { composeFrame } from "./spriteCompose";
import type { DecodeRequest, DecodeResponse } from "./decodeClient";

// Decodes DE's terrain textures and sprite frames off the window's thread
// (docs/preview-de-textures-design.md Sec.14.5). Measured on the main thread
// a texture took about 100 ms and a tree frame about 13 ms, so a forested map
// stuttered for a second or two while it loaded. The window still reads the
// files, since Tauri's fs plugin only answers it, and hands the bytes over
// as transferred buffers, which move rather than copy.

/** Parsed sprite files, by lower case name, kept for the next frame asked of them. */
const files = new Map<string, SldFile>();

function reply(response: DecodeResponse, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    response,
    transfer,
  );
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data;
  try {
    if (request.kind === "dds") {
      const image = enlarge(
        decodeDdsAtMost(request.bytes, request.size),
        request.size,
      );
      reply({ id: request.id, kind: "dds", image }, [image.pixels.buffer]);
      return;
    }
    if (request.kind === "sldOpen") {
      const file = new SldFile(request.bytes);
      files.set(request.key, file);
      reply({ id: request.id, kind: "sldOpen", frameCount: file.frameCount });
      return;
    }
    const file = files.get(request.key);
    if (file === undefined) throw new Error(`no sprite file ${request.key}`);
    const sprite = await composeFrame(
      file.decodeFrame(request.frame),
      request.owner,
    );
    // ImageBitmaps are transferable, so the window gets them with no copy.
    const transfer: Transferable[] = [];
    if (sprite.image) transfer.push(sprite.image);
    if (sprite.shadow) transfer.push(sprite.shadow);
    reply({ id: request.id, kind: "sprite", sprite }, transfer);
  } catch (error) {
    reply({
      id: request.id,
      kind: "error",
      unsupported: error instanceof UnsupportedDdsError,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
