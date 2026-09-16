import { describe, it, expect } from "vitest";
import {
  DEFAULT_SAVE_HOTKEY,
  formatHotkey,
  hotkeyFromEvent,
  hotkeysEqual,
  isHotkey,
  matchesHotkey,
  type Hotkey,
} from "../hotkeys";

function keydown(
  init: Partial<KeyboardEventInit> & { key: string },
): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("formatHotkey", () => {
  it("formats the default binding", () => {
    expect(formatHotkey(DEFAULT_SAVE_HOTKEY)).toBe("Ctrl+S");
  });

  it("orders modifiers Ctrl, Alt, Shift ahead of the key", () => {
    expect(formatHotkey({ key: "s", ctrl: true, alt: true, shift: true })).toBe(
      "Ctrl+Alt+Shift+S",
    );
  });

  it("gives named keys a readable label", () => {
    expect(
      formatHotkey({ key: "f5", ctrl: false, alt: false, shift: false }),
    ).toBe("F5");
    expect(
      formatHotkey({ key: "arrowleft", ctrl: true, alt: false, shift: false }),
    ).toBe("Ctrl+←");
    expect(
      formatHotkey({ key: "escape", ctrl: true, alt: false, shift: false }),
    ).toBe("Ctrl+Esc");
  });
});

describe("matchesHotkey", () => {
  it("matches the default binding on Ctrl+S", () => {
    const event = keydown({ key: "s", ctrlKey: true });
    expect(matchesHotkey(event, DEFAULT_SAVE_HOTKEY)).toBe(true);
  });

  it("is case-insensitive on the base key, since Shift changes KeyboardEvent.key's case", () => {
    const event = keydown({ key: "S", ctrlKey: true, shiftKey: true });
    expect(
      matchesHotkey(event, { key: "s", ctrl: true, shift: true, alt: false }),
    ).toBe(true);
  });

  it("rejects a press missing a required modifier", () => {
    const event = keydown({ key: "s", ctrlKey: false });
    expect(matchesHotkey(event, DEFAULT_SAVE_HOTKEY)).toBe(false);
  });

  it("rejects a press carrying an extra modifier the binding doesn't have", () => {
    const event = keydown({ key: "s", ctrlKey: true, shiftKey: true });
    expect(matchesHotkey(event, DEFAULT_SAVE_HOTKEY)).toBe(false);
  });
});

describe("hotkeyFromEvent", () => {
  it("captures Ctrl+letter", () => {
    const event = keydown({ key: "b", ctrlKey: true });
    expect(hotkeyFromEvent(event)).toEqual({
      key: "b",
      ctrl: true,
      shift: false,
      alt: false,
    });
  });

  it("captures Alt-only combinations too", () => {
    const event = keydown({ key: "b", altKey: true });
    expect(hotkeyFromEvent(event)).toEqual({
      key: "b",
      ctrl: false,
      shift: false,
      alt: true,
    });
  });

  it("declines a bare modifier press", () => {
    for (const key of ["Control", "Shift", "Alt", "Meta"]) {
      expect(
        hotkeyFromEvent(keydown({ key, ctrlKey: key === "Control" })),
      ).toBeNull();
    }
  });

  it("declines a press with no Ctrl and no Alt, so ordinary typing can never become a binding", () => {
    expect(hotkeyFromEvent(keydown({ key: "s" }))).toBeNull();
    expect(hotkeyFromEvent(keydown({ key: "S", shiftKey: true }))).toBeNull();
  });
});

describe("hotkeysEqual", () => {
  it("is true for two separately-built identical bindings", () => {
    expect(
      hotkeysEqual(
        { key: "s", ctrl: true, shift: false, alt: false },
        DEFAULT_SAVE_HOTKEY,
      ),
    ).toBe(true);
  });

  it("is false when any single field differs", () => {
    expect(
      hotkeysEqual(
        { key: "b", ctrl: true, shift: false, alt: false },
        DEFAULT_SAVE_HOTKEY,
      ),
    ).toBe(false);
    expect(
      hotkeysEqual(
        { key: "s", ctrl: false, shift: false, alt: false },
        DEFAULT_SAVE_HOTKEY,
      ),
    ).toBe(false);
    expect(
      hotkeysEqual(
        { key: "s", ctrl: true, shift: true, alt: false },
        DEFAULT_SAVE_HOTKEY,
      ),
    ).toBe(false);
    expect(
      hotkeysEqual(
        { key: "s", ctrl: true, shift: false, alt: true },
        DEFAULT_SAVE_HOTKEY,
      ),
    ).toBe(false);
  });
});

describe("isHotkey", () => {
  it("accepts a well-formed binding", () => {
    const value: Hotkey = { key: "s", ctrl: true, shift: false, alt: false };
    expect(isHotkey(value)).toBe(true);
  });

  it("rejects malformed or missing data rather than throwing", () => {
    expect(isHotkey(null)).toBe(false);
    expect(isHotkey(undefined)).toBe(false);
    expect(isHotkey("Ctrl+S")).toBe(false);
    expect(isHotkey({ key: "s", ctrl: true })).toBe(false);
    expect(isHotkey({ key: "", ctrl: true, shift: false, alt: false })).toBe(
      false,
    );
  });
});
