// Escape closes the Generation Settings dialog. The map size list takes the
// first Escape while it is open, so that press closes only the list.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import { GenerationSettingsProvider } from "../../generationSettings/GenerationSettingsContext";
import { GenerationSettingsDialog } from "../GenerationSettingsDialog";

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
        <GenerationSettingsDialog onClose={onClose} />
      </GenerationSettingsProvider>
    </HelpSettingsProvider>,
  );
  return onClose;
}

describe("GenerationSettingsDialog Escape", () => {
  it("closes the dialog", () => {
    const onClose = setup();
    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
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
});
