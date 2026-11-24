import type { DeObjectRecord } from "./types";

// `deObjects` across the preview worker's postMessage. A forested map has
// tens of thousands, and structured-cloning that many small objects cost
// about 30 ms on each side per preview, on every debounced update, for a list
// only the textured view reads. Packed, it is one buffer the worker transfers
// for free, and the window unpacks it only when sprites are on.

/** Numbers per object: id, owner, x, y, rotation, frame, status, kind. */
const STRIDE = 8;
const KINDS: readonly DeObjectRecord["kind"][] = ["terrain", "cliff", "script"];

export function packDeObjects(
  objects: readonly DeObjectRecord[],
): Float64Array {
  const packed = new Float64Array(objects.length * STRIDE);
  let at = 0;
  for (const o of objects) {
    packed[at++] = o.id;
    packed[at++] = o.owner;
    packed[at++] = o.x;
    packed[at++] = o.y;
    packed[at++] = o.rotation;
    packed[at++] = o.frame;
    packed[at++] = o.status;
    packed[at++] = KINDS.indexOf(o.kind);
  }
  return packed;
}

export function unpackDeObjects(packed: Float64Array): DeObjectRecord[] {
  const objects: DeObjectRecord[] = [];
  for (let at = 0; at + STRIDE <= packed.length; at += STRIDE) {
    objects.push({
      id: packed[at],
      owner: packed[at + 1],
      x: packed[at + 2],
      y: packed[at + 3],
      rotation: packed[at + 4],
      frame: packed[at + 5],
      status: packed[at + 6],
      kind: KINDS[packed[at + 7]] ?? "script",
    });
  }
  return objects;
}
