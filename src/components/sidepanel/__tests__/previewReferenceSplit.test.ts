import { describe, expect, it } from "vitest";
import {
  clampPreviewFraction,
  COLLAPSE_DRAG_MARGIN,
  DEFAULT_PREVIEW_FRACTION,
  isPreviewFraction,
  isPreviewReferenceCollapsedSide,
  MIN_PANE_FRACTION,
  resolvePreviewReferenceDrag,
} from "../previewReferenceSplit";

describe("clampPreviewFraction", () => {
  it("leaves a fraction inside the bounds alone", () => {
    expect(clampPreviewFraction(0.4)).toBe(0.4);
  });

  it("clamps to the minimum and the maximum", () => {
    expect(clampPreviewFraction(-1)).toBe(MIN_PANE_FRACTION);
    expect(clampPreviewFraction(2)).toBe(1 - MIN_PANE_FRACTION);
  });

  it("falls back to the default rather than propagating NaN", () => {
    // A NaN fraction would reach React as an invalid flex-basis, which is
    // silently dropped, a pane collapsing to its content size for no
    // apparent reason.
    expect(clampPreviewFraction(Number.NaN)).toBe(DEFAULT_PREVIEW_FRACTION);
    expect(clampPreviewFraction(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_PREVIEW_FRACTION,
    );
  });
});

describe("resolvePreviewReferenceDrag", () => {
  it("tracks the pointer between the bounds", () => {
    expect(resolvePreviewReferenceDrag(0.5)).toEqual({
      collapsedSide: null,
      fraction: 0.5,
    });
  });

  it("sticks at the minimum inside the collapse margin, on either end", () => {
    expect(resolvePreviewReferenceDrag(MIN_PANE_FRACTION - 0.01)).toEqual({
      collapsedSide: null,
      fraction: MIN_PANE_FRACTION,
    });
    expect(resolvePreviewReferenceDrag(1 - MIN_PANE_FRACTION + 0.01)).toEqual({
      collapsedSide: null,
      fraction: 1 - MIN_PANE_FRACTION,
    });
  });

  it("collapses the preview once the drag passes the margin toward the top", () => {
    expect(
      resolvePreviewReferenceDrag(
        MIN_PANE_FRACTION - COLLAPSE_DRAG_MARGIN - 0.001,
      ),
    ).toEqual({
      collapsedSide: "preview",
    });
    expect(resolvePreviewReferenceDrag(0)).toEqual({
      collapsedSide: "preview",
    });
    expect(resolvePreviewReferenceDrag(-5)).toEqual({
      collapsedSide: "preview",
    });
  });

  it("collapses the reference table once the drag passes the margin toward the bottom", () => {
    expect(
      resolvePreviewReferenceDrag(
        1 - MIN_PANE_FRACTION + COLLAPSE_DRAG_MARGIN + 0.001,
      ),
    ).toEqual({
      collapsedSide: "reference",
    });
    expect(resolvePreviewReferenceDrag(1)).toEqual({
      collapsedSide: "reference",
    });
    expect(resolvePreviewReferenceDrag(5)).toEqual({
      collapsedSide: "reference",
    });
  });

  it("falls back to the default on non-finite input rather than collapsing either side", () => {
    expect(resolvePreviewReferenceDrag(Number.NaN)).toEqual({
      collapsedSide: null,
      fraction: DEFAULT_PREVIEW_FRACTION,
    });
  });
});

describe("isPreviewFraction", () => {
  it("accepts a fraction the app itself would have written", () => {
    expect(isPreviewFraction(DEFAULT_PREVIEW_FRACTION)).toBe(true);
    expect(isPreviewFraction(MIN_PANE_FRACTION)).toBe(true);
    expect(isPreviewFraction(1 - MIN_PANE_FRACTION)).toBe(true);
  });

  it("rejects anything else the store could hand back", () => {
    expect(isPreviewFraction(undefined)).toBe(false);
    expect(isPreviewFraction(null)).toBe(false);
    expect(isPreviewFraction("0.5")).toBe(false);
    expect(isPreviewFraction(Number.NaN)).toBe(false);
    expect(isPreviewFraction(MIN_PANE_FRACTION - 0.01)).toBe(false);
    expect(isPreviewFraction(1 - MIN_PANE_FRACTION + 0.01)).toBe(false);
  });
});

describe("isPreviewReferenceCollapsedSide", () => {
  it("accepts both sides and the shown-both state", () => {
    expect(isPreviewReferenceCollapsedSide("preview")).toBe(true);
    expect(isPreviewReferenceCollapsedSide("reference")).toBe(true);
    expect(isPreviewReferenceCollapsedSide(null)).toBe(true);
  });

  it("rejects anything else the store could hand back", () => {
    expect(isPreviewReferenceCollapsedSide(undefined)).toBe(false);
    expect(isPreviewReferenceCollapsedSide("both")).toBe(false);
    expect(isPreviewReferenceCollapsedSide(1)).toBe(false);
  });
});

describe("the constants themselves", () => {
  it("leaves room between the minimum and the default on both sides", () => {
    expect(MIN_PANE_FRACTION).toBeLessThan(DEFAULT_PREVIEW_FRACTION);
    expect(DEFAULT_PREVIEW_FRACTION).toBeLessThan(1 - MIN_PANE_FRACTION);
  });

  it("keeps the collapse margin inside the minimum", () => {
    // If the margin were larger than the minimum, the collapse threshold for
    // the preview would sit below 0, past the drag surface's own top edge,
    // which the pointer can only reach by leaving the window.
    expect(COLLAPSE_DRAG_MARGIN).toBeLessThan(MIN_PANE_FRACTION);
  });
});
