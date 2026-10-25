// docs/name-lookup-design.md slice D, Sec.4.4: the Add Template dialog's
// terrain field suggests the built-in terrains and the script's own #consts.
// Nothing flashes and nothing is offered for creation here, since nothing is
// in the script until Insert writes it.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import gameConstantsRaw from "../../../../reference/data/game-constants.json";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { TemplateDialog } from "../TemplateDialog";
import type { TemplateConstant } from "../templates";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const lang = loadLanguage();
const constants = (
  gameConstantsRaw as unknown as { constants: TemplateConstant[] }
).constants;

function renderDialog(source: string) {
  return render(
    <HelpSettingsProvider>
      <TemplateDialog
        section="TERRAIN_GENERATION"
        script={{
          parse: parseRms(source, lang),
          forestSetupPresent: false,
          quickStartDefined: false,
          kitNamesDefined: [],
          startResourceCutsDefined: [],
        }}
        constants={constants}
        onClose={() => {}}
        onInsert={() => {}}
      />
    </HelpSettingsProvider>,
  );
}

function typeInto(el: HTMLInputElement, text: string) {
  act(() => {
    el.focus();
    fireEvent.change(el, { target: { value: text } });
    el.setSelectionRange(text.length, text.length);
    fireEvent.input(el);
  });
}

describe("Add Template terrain field", () => {
  it("suggests built-in terrains, and Enter fills the field after a move", () => {
    renderDialog("<LAND_GENERATION>\n");
    const field = screen.getByPlaceholderText("e.g. GRASS") as HTMLInputElement;
    typeInto(field, "GRA");
    const rows = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(rows.map((r) => r.textContent?.split("terrain")[0])).toContain(
      "GRASS",
    );
    act(() => {
      fireEvent.keyDown(field, { key: "Tab" });
      fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(field.value).toMatch(/^GRASS/);
  });

  it("puts the script's own #const ahead of the built-ins", () => {
    renderDialog("#const GRAND_FIELD 12\n<LAND_GENERATION>\n");
    const field = screen.getByPlaceholderText("e.g. GRASS") as HTMLInputElement;
    typeInto(field, "GRA");
    const first = within(screen.getByRole("listbox")).getAllByRole("option")[0];
    expect(first.textContent).toMatch(/^GRAND_FIELD/);
  });
});
