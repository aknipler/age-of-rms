// docs/name-lookup-design.md Sec.4.2 and Sec.5, the suggestion input's keys.
// The decisions under test are the ones a person would trip over: Tab cycles
// and Enter accepts only after a move (Q1), and Escape closes the list without reaching the
// field's own Escape.

import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import { RmsSuggestInput, type SuggestRow } from "../RmsSuggestInput";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

// jsdom has no layout, so no scrollIntoView. useSearchListNav calls it to keep
// the highlighted row visible, which is a no-op here.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const ROWS: SuggestRow[] = [
  { name: "GRASS", detail: "terrain 0" },
  { name: "GRASS2", detail: "terrain 1" },
  { name: "GRAVEL" },
];
const rowsFor = (word: string): SuggestRow[] =>
  ROWS.filter((r) => r.name.startsWith(word.toUpperCase()));

function setup(props: {
  onKeyDown?: (key: string) => void;
  onChange?: (value: string) => void;
  rows?: typeof rowsFor | null;
}) {
  render(
    <HelpSettingsProvider>
      <RmsSuggestInput
        rowsFor={props.rows === undefined ? rowsFor : props.rows}
        data-testid="field"
        defaultValue=""
        onKeyDown={(e) => props.onKeyDown?.(e.key)}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
      />
    </HelpSettingsProvider>,
  );
  return screen.getByTestId("field") as HTMLInputElement;
}

/** Type `text` the way a keyboard does: value first, then the input event. */
function type(el: HTMLInputElement, text: string) {
  act(() => {
    el.focus();
    fireEvent.input(el, { target: { value: text } });
    el.setSelectionRange(text.length, text.length);
  });
}

describe("RmsSuggestInput", () => {
  it("opens a list of the matching names while typing", () => {
    const el = setup({});
    type(el, "GRA");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "GRASSterrain 0",
      "GRASS2terrain 1",
      "GRAVEL",
    ]);
  });

  it("Tab then Enter accepts the row, keeps focus, and tells onChange", () => {
    const onChange = vi.fn();
    const el = setup({ onChange });
    type(el, "GRA");
    onChange.mockClear();
    act(() => {
      fireEvent.keyDown(el, { key: "Tab", shiftKey: false });
      fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(el.value).toBe("GRASS");
    expect(document.activeElement).toBe(el);
    expect(screen.queryByRole("listbox")).toBeNull();
    // The accept goes through a real input event so a controlled field sees it.
    expect(onChange).toHaveBeenCalledWith("GRASS");
  });

  it("Tab cycles down, Shift+Tab cycles up, and Enter accepts", () => {
    const el = setup({});
    type(el, "GRA");
    act(() => {
      fireEvent.keyDown(el, { key: "Tab" });
      fireEvent.keyDown(el, { key: "Tab" });
      fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(el.value).toBe("GRASS2");
  });

  it("Shift+Tab from the first row wraps to the last", () => {
    const el = setup({});
    type(el, "GRA");
    act(() => {
      fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(el.value).toBe("GRAVEL");
  });

  it("Enter before the highlight moves does not accept, and still reaches the field's own handler (Q1)", () => {
    const onKeyDown = vi.fn();
    const el = setup({ onKeyDown });
    type(el, "GRA");
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(el.value).toBe("GRA");
    expect(onKeyDown).toHaveBeenCalledWith("Enter");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the list and does not reach the field's own Escape", () => {
    const onKeyDown = vi.fn();
    const el = setup({ onKeyDown });
    type(el, "GRA");
    act(() => {
      fireEvent.keyDown(el, { key: "Escape" });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    // With the list closed the field's Escape (revert) is back in play.
    act(() => {
      fireEvent.keyDown(el, { key: "Escape" });
    });
    expect(onKeyDown).toHaveBeenCalledWith("Escape");
  });

  it("Tab with the list closed is left to the browser, so focus can move on", () => {
    const onKeyDown = vi.fn();
    const el = setup({ onKeyDown });
    act(() => el.focus());
    const notCancelled = fireEvent.keyDown(el, { key: "Tab" });
    expect(notCancelled).toBe(true);
    expect(onKeyDown).toHaveBeenCalledWith("Tab");
  });

  it("Ctrl+Space opens the list on an empty word", () => {
    const el = setup({});
    act(() => el.focus());
    act(() => {
      fireEvent.keyDown(el, { key: " ", ctrlKey: true });
    });
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("replaces only the name at the caret, leaving the rest of the field", () => {
    const el = setup({});
    type(el, "(GRA + 5)");
    act(() => el.setSelectionRange(4, 4));
    act(() => {
      fireEvent.input(el);
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Tab" });
      fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(el.value).toBe("(GRASS + 5)");
  });

  it("clicking a row accepts it", () => {
    const el = setup({});
    type(el, "GRA");
    act(() => {
      fireEvent.mouseDown(screen.getAllByRole("option")[2]);
    });
    expect(el.value).toBe("GRAVEL");
  });

  it("works in a controlled field too", () => {
    function Controlled() {
      const [v, setV] = useState("");
      return (
        <HelpSettingsProvider>
          <RmsSuggestInput
            rowsFor={rowsFor}
            data-testid="field"
            value={v}
            onChange={(e) => setV(e.target.value)}
          />
          <output data-testid="state">{v}</output>
        </HelpSettingsProvider>
      );
    }
    render(<Controlled />);
    const el = screen.getByTestId("field") as HTMLInputElement;
    type(el, "GRA");
    act(() => {
      fireEvent.keyDown(el, { key: "Tab" });
      fireEvent.keyDown(el, { key: "Tab", shiftKey: true });
    });
    act(() => {
      fireEvent.keyDown(el, { key: "Enter" });
    });
    expect(screen.getByTestId("state").textContent).toBe("GRASS");
  });

  it("is a plain input when it has no rows to offer", () => {
    const el = setup({ rows: null });
    expect(el.getAttribute("aria-autocomplete")).toBeNull();
    type(el, "GRA");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
