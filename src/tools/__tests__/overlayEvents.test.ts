// Sec.3.7: "coalesce drag to the latest position per animation frame and
// deliver dragStart/dragEnd unconditionally."

import { describe, expect, it } from "vitest";
import type { OverlayEvent } from "../../../tools-api/index";
import { createDragCoalescer } from "../overlayEvents";

function evt(event: OverlayEvent["event"], x: number, y: number): OverlayEvent {
  return { type: "overlayEvent", event, tile: { x, y }, modifiers: [] };
}

describe("createDragCoalescer", () => {
  it("coalesces consecutive drag events to the latest position", () => {
    const c = createDragCoalescer();
    c.push(evt("drag", 1, 1));
    c.push(evt("drag", 2, 2));
    c.push(evt("drag", 3, 3));
    expect(c.flush()).toEqual([evt("drag", 3, 3)]);
  });

  it("delivers click, dragStart and dragEnd unconditionally, never coalesced", () => {
    const c = createDragCoalescer();
    c.push(evt("dragStart", 0, 0));
    c.push(evt("drag", 1, 1));
    c.push(evt("drag", 2, 2));
    c.push(evt("dragEnd", 2, 2));
    expect(c.flush()).toEqual([
      evt("dragStart", 0, 0),
      evt("drag", 2, 2),
      evt("dragEnd", 2, 2),
    ]);
  });

  it("keeps two separate drag runs in one flush window as two samples, not one", () => {
    const c = createDragCoalescer();
    c.push(evt("drag", 1, 1));
    c.push(evt("drag", 2, 2));
    c.push(evt("dragEnd", 2, 2));
    c.push(evt("drag", 5, 5));
    c.push(evt("drag", 6, 6));
    expect(c.flush()).toEqual([
      evt("drag", 2, 2),
      evt("dragEnd", 2, 2),
      evt("drag", 6, 6),
    ]);
  });

  it("flush empties the queue — a second flush with nothing new returns nothing", () => {
    const c = createDragCoalescer();
    c.push(evt("click", 1, 1));
    c.flush();
    expect(c.flush()).toEqual([]);
  });

  it("a click between two drags is not itself coalesced away", () => {
    const c = createDragCoalescer();
    c.push(evt("drag", 1, 1));
    c.push(evt("click", 9, 9));
    c.push(evt("drag", 2, 2));
    expect(c.flush()).toEqual([
      evt("drag", 1, 1),
      evt("click", 9, 9),
      evt("drag", 2, 2),
    ]);
  });
});
