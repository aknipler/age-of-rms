// Feedback 2026-10, "when you are dragging, temporarily close all cards".
//
// The collapse is a view-level override on CommandCard (open while the user
// wants it open AND no drag is running), so these tests check three things:
// the cards close once a press has travelled far enough to be a drag, they
// come back by drop and by cancel, and the user's own open or closed choice
// is never rewritten along the way (a card closed by hand stays closed).

import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { BlockList } from "../../BlockList";
import { CardDragProvider } from "../../cardDrag";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import type { Item } from "../../../parser/types";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
vi.mock("../../../PreviewCutContext", () => ({
  usePreviewCut: () => ({ cutOffset: null }),
}));
vi.mock("../../../components/preview/PreviewViewContext", () => ({
  usePreviewView: () => ({ view: "current" }),
}));

// jsdom has no layout, so it never implemented hit-testing. The drag layer
// asks the DOM what is under the pointer on every move; "nothing" is a valid
// answer (a drop on empty space is a no-op).
beforeEach(() => {
  document.elementFromPoint = () => null;
});
afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

const SRC =
  "<LAND_GENERATION>\ncreate_land { land_percent 30 }\ncreate_land { land_percent 40 }";

/** `open` decides, per card, whether the user has it open. */
function Harness({ open }: { open: (item: Item, index: number) => boolean }) {
  const [source] = useState(SRC);
  const parseResult = parseRms(source, rawLangData);
  const items = parseResult.script.sections[0].items;
  const moved: unknown[] = [];

  const ctx = {
    tokens: parseResult.tokens,
    lang: langData,
    diagnostics: [],
    source,
    gameConstants: { constants: [] },
    parseResult,
    applyEdit: () => null,
    isExpanded: (span: { start: number }) => {
      const idx = items.findIndex((i) => i.span.start === span.start);
      return idx >= 0 && open(items[idx], idx);
    },
    toggleExpanded: () => {},
    expandCard: () => {},
    collapseFromStrip: () => {},
    revealAfterEdit: () => {},
    requestFocus: () => {},
    registerFocusable: () => {},
    isSelected: () => false,
    selectCard: () => {},
    clearSelection: () => {},
    moveItem: (...args: unknown[]) => moved.push(args),
    duplicateItem: () => {},
    selectedItem: undefined,
    comments: [],
    expandedAnchors: new Set<number>(),
  } as unknown as BreakdownContextValue;

  return (
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <CardDragProvider
            items={items}
            scrollContainerRef={{ current: null }}
          >
            <BlockList items={items} />
          </CardDragProvider>
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>
  );
}

// React reads these off the native event, so a MouseEvent carrying the
// pointer fields is enough where jsdom has no PointerEvent constructor.
function pointer(type: string, x: number, y: number): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

function press(el: Element) {
  act(() => {
    el.dispatchEvent(pointer("pointerdown", 0, 0));
  });
}
function moveFar() {
  act(() => {
    window.dispatchEvent(pointer("pointermove", 40, 40));
  });
}
function release() {
  act(() => {
    window.dispatchEvent(pointer("pointerup", 40, 40));
  });
}

const bodies = () => screen.queryAllByText("Attributes");
const firstCard = () =>
  document.querySelectorAll<HTMLElement>("[data-anchor]")[0];
// A header label is plain text, not a button or field, so a press on it is a
// press on card chrome, which is what starts a drag.
const grabHandle = () =>
  within(firstCard()).getAllByText("create_land")[0] as HTMLElement;

describe("dragging a card closes every command card until the drag ends", () => {
  it("closes open cards once the pointer has travelled, and reopens them on drop", () => {
    render(<Harness open={() => true} />);
    expect(bodies()).toHaveLength(2);

    press(grabHandle());
    // A press alone is still a click, nothing closes yet.
    expect(bodies()).toHaveLength(2);

    moveFar();
    expect(bodies()).toHaveLength(0);

    release();
    expect(bodies()).toHaveLength(2);
  });

  it("reopens them when the drag is cancelled with Escape", () => {
    render(<Harness open={() => true} />);
    press(grabHandle());
    moveFar();
    expect(bodies()).toHaveLength(0);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
      );
    });
    expect(bodies()).toHaveLength(2);
  });

  it("restores each card's own state: a card that was closed stays closed", () => {
    render(<Harness open={(_, i) => i === 0} />);
    expect(bodies()).toHaveLength(1);

    press(grabHandle());
    moveFar();
    expect(bodies()).toHaveLength(0);

    release();
    expect(bodies()).toHaveLength(1);
    // And it is the first card, the one that was open, that came back.
    expect(within(firstCard()).queryByText("Attributes")).not.toBeNull();
  });

  it("a plain click on a card never closes anything", () => {
    render(<Harness open={() => true} />);
    press(grabHandle());
    act(() => {
      window.dispatchEvent(pointer("pointermove", 1, 1)); // under the slop
    });
    release();
    expect(bodies()).toHaveLength(2);
  });
});
