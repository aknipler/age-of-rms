import { describe, expect, it } from "vitest";
import {
  clampSidePanelWidth,
  COLLAPSE_DRAG_MARGIN,
  DEFAULT_SIDE_PANEL_WIDTH,
  isSidePanelWidth,
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  resolveSidePanelDrag,
} from "../sidePanelLayout";

describe("clampSidePanelWidth", () => {
  it("leaves a width inside the bounds alone", () => {
    expect(clampSidePanelWidth(340)).toBe(340);
  });

  it("clamps to the minimum and the maximum", () => {
    expect(clampSidePanelWidth(10)).toBe(MIN_SIDE_PANEL_WIDTH);
    expect(clampSidePanelWidth(10_000)).toBe(MAX_SIDE_PANEL_WIDTH);
  });

  it("rounds to whole pixels", () => {
    // getBoundingClientRect().left is fractional on a scaled display, so the
    // subtraction that feeds this is fractional too.
    expect(clampSidePanelWidth(340.4)).toBe(340);
    expect(clampSidePanelWidth(340.6)).toBe(341);
  });

  it("falls back to the default rather than propagating NaN", () => {
    // A NaN width would reach React as style={{ width: NaN }}, which renders
    // no width attribute at all — a panel that silently shrinks to its
    // content, which reads as a layout bug with no obvious cause.
    expect(clampSidePanelWidth(Number.NaN)).toBe(DEFAULT_SIDE_PANEL_WIDTH);
    expect(clampSidePanelWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDE_PANEL_WIDTH);
  });
});

describe("resolveSidePanelDrag", () => {
  it("tracks the pointer between the bounds", () => {
    expect(resolveSidePanelDrag(400)).toEqual({ collapsed: false, width: 400 });
  });

  it("sticks at the minimum inside the collapse margin", () => {
    // The margin's whole job: the minimum has to be reachable and holdable,
    // not a knife edge that collapses the panel the moment you touch it.
    expect(resolveSidePanelDrag(MIN_SIDE_PANEL_WIDTH - 1)).toEqual({
      collapsed: false,
      width: MIN_SIDE_PANEL_WIDTH,
    });
    expect(resolveSidePanelDrag(MIN_SIDE_PANEL_WIDTH - COLLAPSE_DRAG_MARGIN)).toEqual({
      collapsed: false,
      width: MIN_SIDE_PANEL_WIDTH,
    });
  });

  it("collapses once the drag passes the margin", () => {
    expect(resolveSidePanelDrag(MIN_SIDE_PANEL_WIDTH - COLLAPSE_DRAG_MARGIN - 1)).toEqual({
      collapsed: true,
    });
  });

  it("collapses when the pointer goes past the panel's own left edge", () => {
    expect(resolveSidePanelDrag(0)).toEqual({ collapsed: true });
    expect(resolveSidePanelDrag(-120)).toEqual({ collapsed: true });
  });

  it("stops at the maximum instead of following the pointer out", () => {
    expect(resolveSidePanelDrag(5_000)).toEqual({
      collapsed: false,
      width: MAX_SIDE_PANEL_WIDTH,
    });
  });
});

describe("isSidePanelWidth", () => {
  it("accepts a width the app itself would have written", () => {
    expect(isSidePanelWidth(DEFAULT_SIDE_PANEL_WIDTH)).toBe(true);
    expect(isSidePanelWidth(MIN_SIDE_PANEL_WIDTH)).toBe(true);
    expect(isSidePanelWidth(MAX_SIDE_PANEL_WIDTH)).toBe(true);
  });

  it("rejects anything else the store could hand back", () => {
    // settings.json is a file on disk that outlives any one app version, so
    // every one of these is reachable without anybody doing anything wrong.
    expect(isSidePanelWidth(undefined)).toBe(false);
    expect(isSidePanelWidth(null)).toBe(false);
    expect(isSidePanelWidth("288")).toBe(false);
    expect(isSidePanelWidth(Number.NaN)).toBe(false);
    expect(isSidePanelWidth(MIN_SIDE_PANEL_WIDTH - 1)).toBe(false);
    expect(isSidePanelWidth(MAX_SIDE_PANEL_WIDTH + 1)).toBe(false);
  });
});

describe("the constants themselves", () => {
  it("leaves room between the minimum and the default", () => {
    expect(MIN_SIDE_PANEL_WIDTH).toBeLessThan(DEFAULT_SIDE_PANEL_WIDTH);
    expect(DEFAULT_SIDE_PANEL_WIDTH).toBeLessThan(MAX_SIDE_PANEL_WIDTH);
  });

  it("keeps the collapse margin inside the minimum", () => {
    // If the margin were larger than the minimum, the collapse threshold
    // would sit at a negative width — off the left of the panel, where the
    // pointer can only get by leaving the window — and the panel would be
    // uncollapsable by drag.
    expect(COLLAPSE_DRAG_MARGIN).toBeLessThan(MIN_SIDE_PANEL_WIDTH);
  });
});
