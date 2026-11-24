import {
  UnsupportedDdsError,
  decodeDdsAtMost,
  enlarge,
  type DecodedImage,
} from "./dds";
import type { SpriteImage } from "./objectSprites";
import { SldFile } from "./sld";
import { composeFrame } from "./spriteCompose";

// The window's side of the decode worker (decodeWorker.ts). One worker for
// the session, made on first use, with each request answered by id, the
// same request and reply shape the preview worker uses. Where no worker can
// be made (a test, Node) the same functions run here instead, so callers
// never need to know which.

export type DecodeRequest =
  | { id: number; kind: "dds"; bytes: Uint8Array; size: number }
  | { id: number; kind: "sldOpen"; key: string; bytes: Uint8Array }
  | { id: number; kind: "sprite"; key: string; frame: number; owner: number };

export type DecodeResponse =
  | { id: number; kind: "dds"; image: DecodedImage }
  | { id: number; kind: "sldOpen"; frameCount: number }
  | { id: number; kind: "sprite"; sprite: SpriteImage }
  | { id: number; kind: "error"; unsupported: boolean; message: string };

/** The answer to one request, by its kind. */
type Answer<K extends DecodeRequest["kind"]> = Extract<
  DecodeResponse,
  { kind: K }
>;

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<
  number,
  { resolve: (r: DecodeResponse) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    // `new URL(..., import.meta.url)` rather than Vite's `?worker` import, so
    // a bundler that is not Vite (the offline comparison page's esbuild) can
    // still import the modules that use this one.
    worker = new Worker(new URL("./decodeWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
      const entry = waiting.get(event.data.id);
      if (entry === undefined) return;
      waiting.delete(event.data.id);
      entry.resolve(event.data);
    };
    worker.onerror = (event) => {
      // A worker that cannot start fails every request, so later ones run
      // here instead.
      event.preventDefault();
      const failed = new Error(event.message || "decode worker failed");
      for (const entry of waiting.values()) entry.reject(failed);
      waiting.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function ask<K extends DecodeRequest["kind"]>(
  request: Omit<Extract<DecodeRequest, { kind: K }>, "id">,
  transfer: Transferable[],
): Promise<Answer<K>> | null {
  const w = getWorker();
  if (w === null) return null;
  const id = nextId++;
  return new Promise<Answer<K>>((resolve, reject) => {
    waiting.set(id, {
      resolve: (response) => {
        if (response.kind === "error") {
          reject(
            response.unsupported
              ? new UnsupportedDdsError(response.message)
              : new Error(response.message),
          );
        } else resolve(response as Answer<K>);
      },
      reject,
    });
    w.postMessage({ ...request, id }, transfer);
  });
}

/** A DDS texture decoded at most `size` a side and enlarged to it. Throws UnsupportedDdsError as the inline decode does. */
export async function decodeDds(
  bytes: Uint8Array,
  size: number,
): Promise<DecodedImage> {
  const pending = ask<"dds">({ kind: "dds", bytes, size }, [bytes.buffer]);
  if (pending === null) return enlarge(decodeDdsAtMost(bytes, size), size);
  return (await pending).image;
}

/** Files parsed inline when there is no worker, by key. */
const inlineFiles = new Map<string, SldFile>();

/** Hands a sprite file's bytes over, once, and returns its frame count. */
export async function openSprite(
  key: string,
  bytes: Uint8Array,
): Promise<number> {
  const pending = ask<"sldOpen">({ kind: "sldOpen", key, bytes }, [
    bytes.buffer,
  ]);
  if (pending === null) {
    const file = new SldFile(bytes);
    inlineFiles.set(key, file);
    return file.frameCount;
  }
  return (await pending).frameCount;
}

/** One frame of an opened sprite file in one player's colour. */
export async function decodeSprite(
  key: string,
  frame: number,
  owner: number,
): Promise<SpriteImage> {
  const pending = ask<"sprite">({ kind: "sprite", key, frame, owner }, []);
  if (pending === null) {
    const file = inlineFiles.get(key);
    if (file === undefined) throw new Error(`no sprite file ${key}`);
    return composeFrame(file.decodeFrame(frame), owner);
  }
  return (await pending).sprite;
}
