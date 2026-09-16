/**
 * land-placement-design.md Sec.3.4 layer 3 / Sec.3.7: "`overlayEvent` needs a
 * delivery-rate bound. A drag at 60 fps against an external NDJSON tool is 60
 * messages a second on a transport whose inbound cap is per-line, not
 * per-second. Coalesce `drag` to the latest position per animation frame and
 * deliver `dragStart` / `dragEnd` unconditionally."
 *
 * Pure, no `requestAnimationFrame`, no timers. The caller pumps `push()` on
 * every pointer-move and calls `flush()` once per frame; this module only
 * decides WHICH events survive one flush cycle, not WHEN a frame happens.
 *
 * land-placement-design.md Sec.7.3 brief, item 1: the BUILT-IN Land
 * Placement panel does NOT pump this coalescer. It is in-process with a
 * direct line to `applyDrag`/`applyDefaultSnapping` and calls them straight
 * from `OverlayCanvas`'s own `onDrag` prop, no serialisation and no rate
 * bound needed for a same-thread call. This module exists for the transport
 * case: an EXTERNAL panel tool (M6, not yet built) receiving `overlayEvent`
 * over NDJSON, where a drag at 60fps really would be 60 messages a second
 * against a per-line inbound cap. Read this file when M6 lands, not before.
 */

import type { OverlayEvent } from "../../tools-api/index";

export interface DragCoalescer {
  push(event: OverlayEvent): void;
  /** Drains and returns everything queued since the last flush, in order. */
  flush(): OverlayEvent[];
}

/**
 * A `drag` event REPLACES the immediately-preceding queued `drag` (not any
 * `drag`, only an adjacent one), so two separate drag runs in one flush
 * window (drag, drag, dragEnd, drag, drag) each coalesce to their own single
 * sample rather than collapsing into one. `click`/`dragStart`/`dragEnd` are
 * always queued and never dropped or reordered.
 */
export function createDragCoalescer(): DragCoalescer {
  let queue: OverlayEvent[] = [];
  return {
    push(event) {
      const last = queue[queue.length - 1];
      if (
        event.event === "drag" &&
        last !== undefined &&
        last.event === "drag"
      ) {
        queue[queue.length - 1] = event;
      } else {
        queue.push(event);
      }
    },
    flush() {
      const out = queue;
      queue = [];
      return out;
    },
  };
}
