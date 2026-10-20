import { afterEach, describe, expect, it } from "vitest";
import {
  FOCUS_REGION_ATTR,
  SIDE_PANEL_REGION,
  isSidePanelKeyEvent,
  trackFocusRegion,
} from "../focusRegion";

function pressOn(target: HTMLElement): KeyboardEvent {
  let seen!: KeyboardEvent;
  target.addEventListener("keydown", (e) => (seen = e), { once: true });
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true, bubbles: true }),
  );
  return seen;
}

describe("isSidePanelKeyEvent", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true for a press inside the marked side panel, and false outside it", () => {
    document.body.innerHTML = `<div ${FOCUS_REGION_ATTR}="${SIDE_PANEL_REGION}"><button id="in"></button></div><button id="out"></button>`;
    const inside = document.getElementById("in")!;
    const outside = document.getElementById("out")!;
    expect(isSidePanelKeyEvent(pressOn(inside))).toBe(true);
    expect(isSidePanelKeyEvent(pressOn(outside))).toBe(false);
  });

  it("falls back to the last click when nothing is focused", () => {
    document.body.innerHTML = `<div ${FOCUS_REGION_ATTR}="${SIDE_PANEL_REGION}"><canvas id="canvas"></canvas></div><p id="text"></p>`;
    const stop = trackFocusRegion();
    const click = (el: HTMLElement) =>
      el.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    click(document.getElementById("canvas")!);
    expect(isSidePanelKeyEvent(pressOn(document.body))).toBe(true);
    click(document.getElementById("text")!);
    expect(isSidePanelKeyEvent(pressOn(document.body))).toBe(false);
    stop();
  });
});
