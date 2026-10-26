// The update action reuses the unsaved changes dialog, so the app can settle
// edits before the installer restarts it.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import { UnsavedChangesDialog } from "../UnsavedChangesDialog";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

afterEach(cleanup);

describe("UnsavedChangesDialog for an update", () => {
  it("words the buttons for updating and passes each choice on", () => {
    const onChoice = vi.fn();
    render(
      <HelpSettingsProvider>
        <UnsavedChangesDialog
          action="update"
          mapName="Golden Hill"
          onChoice={onChoice}
        />
      </HelpSettingsProvider>,
    );
    expect(screen.getByText(/restarts to update/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and Update" }));
    expect(onChoice).toHaveBeenCalledWith("save");
  });

  it("offers Update Without Saving as the discard choice", () => {
    const onChoice = vi.fn();
    render(
      <HelpSettingsProvider>
        <UnsavedChangesDialog
          action="update"
          mapName="Golden Hill"
          onChoice={onChoice}
        />
      </HelpSettingsProvider>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Update Without Saving" }),
    );
    expect(onChoice).toHaveBeenCalledWith("discard");
  });
});
