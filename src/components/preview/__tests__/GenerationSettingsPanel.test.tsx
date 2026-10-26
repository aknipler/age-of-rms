// Escape closes the Generation Settings box over the map while focus is in the
// map preview (the side panel), and not for a press elsewhere, such as the
// code editor. The map size list takes the first Escape while it is open, so
// that press closes only the list.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { GenerationSettingsProvider } from "../../../generationSettings/GenerationSettingsContext";
import {
  FOCUS_REGION_ATTR,
  SIDE_PANEL_REGION,
  trackFocusRegion,
} from "../../../settings/focusRegion";
import { GenerationSettingsPanel } from "../GenerationSettingsPanel";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  })),
}));

afterEach(() => cleanup());

function setup() {
  const onClose = vi.fn();
  render(
    <HelpSettingsProvider>
      <GenerationSettingsProvider>
        {/* The side panel marks itself with this attribute (MapSidePanel). */}
        <div {...{ [FOCUS_REGION_ATTR]: SIDE_PANEL_REGION }}>
          <GenerationSettingsPanel onClose={onClose} />
        </div>
        <textarea data-testid="editor" />
      </GenerationSettingsProvider>
    </HelpSettingsProvider>,
  );
  return onClose;
}

describe("GenerationSettingsPanel Escape", () => {
  it("closes the box for a press with focus in the preview", () => {
    const onClose = setup();
    act(() => {
      fireEvent.keyDown(document.getElementById("generation-player-count")!, {
        key: "Escape",
      });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a press with focus outside the preview, such as the code editor", () => {
    const onClose = setup();
    act(() => {
      fireEvent.keyDown(screen.getByTestId("editor"), { key: "Escape" });
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes after a click on the map, where focus is left on the page body", () => {
    const stop = trackFocusRegion();
    const onClose = setup();
    act(() => {
      fireEvent.pointerDown(document.getElementById("generation-map-size")!);
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    stop();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the open map size list on the first press", () => {
    const onClose = setup();
    const button = document.getElementById("generation-map-size")!;
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(button, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the Close button", () => {
    const onClose = setup();
    act(() => {
      fireEvent.click(screen.getByLabelText("Close generation settings"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
