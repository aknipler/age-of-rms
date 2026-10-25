// docs/name-lookup-design.md slice D, rendered for real: the formula field's
// name suggestions, its flash, and the unset names notice with its Copy
// button. The pure halves are pinned in unsetNames.test.ts, so this file only
// proves the panel is wired to them.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLanguage } from "../../../../../parser/__tests__/testUtils";
import { parseRms } from "../../../../../parser/parser";
import { HelpSettingsProvider } from "../../../../../help/HelpSettingsContext";
import { computeApplyEdits } from "../../applyEdits";
import { EMPTY_MODEL, LandPlacementModelProvider } from "../landPlacementModel";
import { PanelPreviewSeedProvider } from "../panelPreviewSeed";
import { LandPlacementPanel } from "../LandPlacementPanel";
import { addRing, addRole } from "../modelOps";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(async () => {}),
  confirm: vi.fn(async () => true),
}));
vi.mock("../LandPlacementCanvas", () => ({
  LandPlacementCanvas: () => null,
}));

vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  // jsdom has no layout, and useSearchListNav scrolls the highlighted row.
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const lang = loadLanguage();

/** The script the tool itself writes for a one role ring, with `extra` lines above it. */
function scriptWith(extra: string): string {
  const { model: withRole, roleId } = addRole(EMPTY_MODEL);
  const model = addRing(withRole, roleId).model;
  const source = `${extra}<PLAYER_SETUP>\ndirect_placement\n`;
  const { edits } = computeApplyEdits(
    parseRms(source, lang),
    model,
    lang,
    new Map(),
    8,
  );
  let text = source;
  for (const e of [...edits].sort((a, b) => b.start - a.start))
    text = text.slice(0, e.start) + e.newText + text.slice(e.end);
  return text;
}

function Harness({ source }: { source: string }) {
  const parseResult = parseRms(source, lang);
  return (
    <HelpSettingsProvider>
      <LandPlacementModelProvider>
        <PanelPreviewSeedProvider>
          <LandPlacementPanel
            parseResult={parseResult}
            source={source}
            reparseNow={() => {}}
            applyTextEdits={() => {}}
            onJumpToOffset={() => {}}
            playerCount={8}
            mapSize="Normal"
            lang={lang}
          />
        </PanelPreviewSeedProvider>
      </LandPlacementModelProvider>
    </HelpSettingsProvider>
  );
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** The input of the formula field with this label, which is a sibling of its label and not associated with it. */
function formulaInput(label: string): HTMLInputElement {
  const row = screen.getByText(label).parentElement!;
  return row.querySelector("input") as HTMLInputElement;
}

function type(el: HTMLInputElement, text: string) {
  act(() => {
    el.focus();
    fireEvent.change(el, { target: { value: text } });
    el.setSelectionRange(text.length, text.length);
    fireEvent.input(el);
  });
}

describe("formula field name suggestions (Sec.4.3)", () => {
  it("offers the script's own #const, and Enter replaces the word and keeps the field's draft", async () => {
    render(<Harness source={scriptWith("#const MY_RADIUS 12\n")} />);
    await settled();
    const field = formulaInput("Base size");
    type(field, "MY");
    // The panel has <select>s whose options share the role, so the query
    // starts at the suggestion list.
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0].textContent).toMatch(/^MY_RADIUS/);
    act(() => {
      fireEvent.keyDown(field, { key: "Tab" });
      fireEvent.keyDown(field, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(field, { key: "Enter" });
    });
    expect(field.value).toBe("MY_RADIUS");
  });

  it("offers the formula functions", async () => {
    render(<Harness source={scriptWith("")} />);
    await settled();
    const field = formulaInput("Base size");
    type(field, "SI");
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toContain("SINfunction");
  });

  it("flashes after a committed edit whose names all resolve, and not for a bare number", async () => {
    render(<Harness source={scriptWith("#const MY_RADIUS 12\n")} />);
    await settled();
    const field = formulaInput("Base size");
    type(field, "MY_RADIUS");
    act(() => field.blur());
    await settled();
    expect(field.className).toMatch(/resolveFlash/);

    const other = formulaInput("Elevation");
    type(other, "3");
    act(() => other.blur());
    await settled();
    expect(other.className).not.toMatch(/resolveFlash/);
  });
});

describe("the unset names notice (Sec.4.3.1)", () => {
  it("lists a name with no value, shows the line to set it, and Copy puts that line on the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<Harness source={scriptWith("")} />);
    await settled();
    expect(screen.queryByRole("group", { name: "Unset names" })).toBeNull();

    const field = formulaInput("Base size");
    type(field, "NOPE_SIZE");
    act(() => field.blur());
    await settled();

    const notice = screen.getByRole("group", { name: "Unset names" });
    expect(notice.textContent).toMatch(/These names have no value yet/);
    expect(notice.textContent).toMatch(/NOPE_SIZE has no value\./);
    expect(notice.querySelector("pre")?.textContent).toBe("#const NOPE_SIZE 0");

    await act(async () => {
      fireEvent.click(screen.getByText("Copy"));
    });
    expect(writeText).toHaveBeenCalledWith("#const NOPE_SIZE 0");
    expect(notice.textContent).toMatch(/Copied\./);
  });

  it("goes away once the script defines the name", async () => {
    const { rerender } = render(<Harness source={scriptWith("")} />);
    await settled();
    const field = formulaInput("Base size");
    type(field, "NOPE_SIZE");
    act(() => field.blur());
    await settled();
    expect(screen.queryByRole("group", { name: "Unset names" })).not.toBeNull();

    // The person adds the line the notice offered, in Code. A fresh parse
    // arrives with it, which is all the panel is ever given.
    rerender(<Harness source={scriptWith("#const NOPE_SIZE 9\n")} />);
    await settled();
    expect(screen.queryByRole("group", { name: "Unset names" })).toBeNull();
  });
});
