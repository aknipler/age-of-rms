// Regression test for a render loop between OverlayCanvas and its caller.
//
// Both callers (PreviewCanvas, LandPlacementCanvas) pass `base` as a fresh
// object literal on every render. OverlayCanvas's refit effect used to list
// `base` as a dependency and call setViewport, so the caller re-rendered,
// built another `base`, and the effect ran again, about 120 times a second
// for as long as the map had not been zoomed or panned. The main thread never
// went idle, so Monaco's background tokenizer never ran and newly typed code
// in the Code tab stayed uncoloured until a tab switch rebuilt the editor.
//
// The host below copies the callers' shape exactly: viewport state held one
// level up, `base` built inline. It stops rendering the canvas after
// RENDER_CAP renders, so a regression fails this test instead of hanging it.

import { useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { OverlayCanvas } from "../OverlayCanvas";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import type { Viewport } from "../../../preview/render/projection";
import type {
  PreviewWireResult,
  StageSnapshot,
} from "../../../preview/generator/types";
import type { TerrainPalette } from "../../../preview/render/palette";

// HelpTip needs HelpSettingsProvider, which reads the Tauri store on mount.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
// jsdom has no 2D canvas. The bitmap and the draw are not what this test is
// about, so both are stubbed.
vi.mock("../../../preview/render/terrainBitmap", () => ({
  buildTerrainBitmap: vi.fn(() => ({})),
}));
vi.mock("../../../preview/render/drawPreview", () => ({
  createBitmapCanvas: vi.fn(() => ({})),
  drawPreview: vi.fn(),
}));

beforeAll(() => {
  // jsdom lays nothing out, so every clientWidth is 0, and the refit effect
  // skips a zero-size container. A real size is what lets it run.
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 300,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => 300,
  });
  // jsdom's getContext logs "not implemented" and returns null. The draw
  // effect already handles null, so return it quietly.
  HTMLCanvasElement.prototype.getContext = (() =>
    null) as unknown as HTMLCanvasElement["getContext"];
  // jsdom has no ResizeObserver. One that never fires is enough here, since
  // the loop came from the effect that refits on a new map.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

const RENDER_CAP = 50;

// Stable across renders, as a real generation's objects are between two
// parses. Only the `base` wrapper around them is new each time.
const snapshot = { dim: 120 } as unknown as StageSnapshot;
const result = { notes: [] } as unknown as PreviewWireResult;
const palette = {} as unknown as TerrainPalette;

it("does not re-render forever when the caller builds `base` inline", async () => {
  let renders = 0;
  function Host() {
    renders += 1;
    const [viewport, setViewport] = useState<Viewport | null>(null);
    if (renders > RENDER_CAP) return null;
    return (
      <OverlayCanvas
        dim={snapshot.dim}
        viewport={viewport}
        setViewport={setViewport}
        userFramed={false}
        setUserFramed={() => {}}
        onHoverTile={() => {}}
        selected={null}
        onTileClick={() => {}}
        base={{ result, snapshot, palette }}
        helpTipId="preview.canvas"
      />
    );
  }

  await act(async () => {
    render(
      <HelpSettingsProvider>
        <Host />
      </HelpSettingsProvider>,
    );
  });

  // The mount, one render for the first fit and a little room for the
  // settings provider to settle. A loop runs to the cap.
  expect(renders).toBeLessThan(10);
});
