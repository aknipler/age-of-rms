// Regression test for the "click to add" absent-attribute row: the
// placeholder text used to be a bare <span> with no click handler, so
// clicking exactly what the UI told you to click ("click to add") did
// nothing, only a small, separately-dimmed "+" button next to it worked.
// Two things need proving: (1) clicking the row (not just the button) now
// fires the add, and (2) clicking the button doesn't fire it TWICE (its
// click bubbles into the new row-level handler unless stopped).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttributeRow } from "../AttributeRow";
import { BreakdownProvider, type BreakdownContextValue } from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import type { AttributeSlot } from "../../attributeModel";
import type { CommandNode } from "../../../parser/types";

// HelpTip (used by AttributeRow) needs HelpSettingsProvider, which reads
// @tauri-apps/plugin-store on mount, same mock TutorialContext.test.tsx
// established as this repo's pattern for it.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

afterEach(cleanup);

// No `default` on the argument, this is what actually renders the literal
// "click to add" text (AttributeRow.tsx: absent + no default -> that
// string; absent + a default -> the default's own value is shown instead).
// Most real attributes have no default, so this is the common case, not an
// edge case.
const slot: AttributeSlot = {
  name: "terrain_type",
  def: { name: "terrain_type", arguments: [{ name: "terrain", type: "terrainConstant" }], verified: true },
  instances: [],
  isFlag: false,
};

function renderRow(applyEdit: BreakdownContextValue["applyEdit"]) {
  const ctx = {
    applyEdit,
    requestFocus: vi.fn(),
  } as unknown as BreakdownContextValue;
  return render(
    <HelpSettingsProvider>
      <BreakdownProvider value={ctx}>
        <AttributeRow slot={slot} target={{} as CommandNode} />
      </BreakdownProvider>
    </HelpSettingsProvider>,
  );
}

describe("AttributeRow — absent slot (the 'click to add' row)", () => {
  it("clicking the row itself (not just the + button) adds the attribute", () => {
    const applyEdit = vi.fn(() => ({ edit: { start: 0, end: 0, newText: "" }, caret: 0 }));
    renderRow(applyEdit);
    fireEvent.click(screen.getByText("click to add"));
    expect(applyEdit).toHaveBeenCalledTimes(1);
    expect(applyEdit).toHaveBeenCalledWith({ kind: "addAttribute", target: {}, name: "terrain_type", value: undefined });
  });

  it("clicking the + button adds it exactly once, not twice (bubble into the row must be stopped)", () => {
    const applyEdit = vi.fn(() => ({ edit: { start: 0, end: 0, newText: "" }, caret: 0 }));
    renderRow(applyEdit);
    fireEvent.click(screen.getByTitle("Add"));
    expect(applyEdit).toHaveBeenCalledTimes(1);
  });
});
