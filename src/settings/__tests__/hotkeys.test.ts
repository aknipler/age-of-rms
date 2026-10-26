import { describe, it, expect } from "vitest";
import {
  DEFAULT_HOTKEYS,
  DEFAULT_SAVE_HOTKEY,
  cycleDirection,
  formatHotkey,
  hotkeyFromEvent,
  hotkeysEqual,
  isHotkey,
  isPlainDeleteKey,
  isTextEntryTarget,
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

  it("reads the backtick from its physical key, for a layout where it is a dead key", () => {
    const binding = { key: "`", ctrl: true, shift: false, alt: false };
    expect(
      matchesHotkey(
        keydown({ key: "Dead", code: "Backquote", ctrlKey: true }),
        binding,
      ),
    ).toBe(true);
    expect(
      matchesHotkey(
        keydown({ key: "`", code: "Backquote", ctrlKey: true }),
        binding,
      ),
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

// The fixed Delete key that removes the selected Breakdown card. The target
// check is the whole safety story, so each kind of place the user types gets
// its own case, and so does the place they do not.
describe("isPlainDeleteKey / isTextEntryTarget", () => {
  function pressOn(
    el: HTMLElement,
    init: Partial<KeyboardEventInit> = {},
  ): KeyboardEvent {
    document.body.appendChild(el);
    let seen!: KeyboardEvent;
    el.addEventListener("keydown", (e) => (seen = e));
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true, ...init }),
    );
    el.remove();
    return seen;
  }

  it("fires for Delete on a plain element such as a focused card button", () => {
    expect(isPlainDeleteKey(pressOn(document.createElement("button")))).toBe(
      true,
    );
    expect(isPlainDeleteKey(pressOn(document.createElement("div")))).toBe(true);
  });

  it("stands down in a text input, a textarea, a select and contenteditable", () => {
    const input = document.createElement("input");
    input.type = "text";
    expect(isPlainDeleteKey(pressOn(input))).toBe(false);
    expect(isPlainDeleteKey(pressOn(document.createElement("textarea")))).toBe(
      false,
    );
    expect(isPlainDeleteKey(pressOn(document.createElement("select")))).toBe(
      false,
    );
    const editable = document.createElement("div");
    // jsdom does not compute isContentEditable from the attribute, so the
    // property is set the way a real browser would report it.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isPlainDeleteKey(pressOn(editable))).toBe(false);
  });

  it("still fires from a checkbox, which takes no typed text", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isTextEntryTarget(box)).toBe(false);
    expect(isPlainDeleteKey(pressOn(box))).toBe(true);
  });

  it("ignores other keys, any modifier, and held-key repeats", () => {
    const div = () => document.createElement("div");
    expect(isPlainDeleteKey(pressOn(div(), { key: "Backspace" }))).toBe(false);
    expect(isPlainDeleteKey(pressOn(div(), { ctrlKey: true }))).toBe(false);
    expect(isPlainDeleteKey(pressOn(div(), { shiftKey: true }))).toBe(false);
    expect(isPlainDeleteKey(pressOn(div(), { altKey: true }))).toBe(false);
    expect(isPlainDeleteKey(pressOn(div(), { metaKey: true }))).toBe(false);
    expect(isPlainDeleteKey(pressOn(div(), { repeat: true }))).toBe(false);
  });
});

describe("cycleDirection", () => {
  const cycle = DEFAULT_HOTKEYS.cycleFocusedTabs;

  it("steps forward on Ctrl+Tab and back on Ctrl+Shift+Tab", () => {
    expect(cycleDirection(keydown({ key: "Tab", ctrlKey: true }), cycle)).toBe(
      1,
    );
    expect(
      cycleDirection(
        keydown({ key: "Tab", ctrlKey: true, shiftKey: true }),
        cycle,
      ),
    ).toBe(-1);
  });

  it("ignores a press without the binding's modifiers", () => {
    expect(cycleDirection(keydown({ key: "Tab" }), cycle)).toBeNull();
    expect(
      cycleDirection(
        keydown({ key: "Tab", ctrlKey: true, altKey: true }),
        cycle,
      ),
    ).toBeNull();
  });

  it("gives a binding that already has Shift no reverse form", () => {
    const withShift = { ...cycle, shift: true };
    expect(
      cycleDirection(
        keydown({ key: "Tab", ctrlKey: true, shiftKey: true }),
        withShift,
      ),
    ).toBe(1);
    expect(
      cycleDirection(keydown({ key: "Tab", ctrlKey: true }), withShift),
    ).toBeNull();
  });
});

// 2026-10-22, when Breakdown's comment toggle took Ctrl+/. Two actions on
// one default would leave the second unreachable until someone rebinds it.
describe("default bindings", () => {
  it("never share a combination", () => {
    const seen = new Map<string, string>();
    for (const [id, hotkey] of Object.entries(DEFAULT_HOTKEYS)) {
      const label = formatHotkey(hotkey);
      expect(seen.get(label), `${id} and ${seen.get(label)}`).toBeUndefined();
      seen.set(label, id);
    }
  });

  it("comment toggle is Ctrl+/, the Code tab's own keys", () => {
    expect(formatHotkey(DEFAULT_HOTKEYS.breakdownToggleComment)).toBe("Ctrl+/");
    expect(
      matchesHotkey(
        keydown({ key: "/", ctrlKey: true }),
        DEFAULT_HOTKEYS.breakdownToggleComment,
      ),
    ).toBe(true);
  });
});
