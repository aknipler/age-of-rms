// Regression for "sometimes when you click on an attribute, it places the
// cursor there then deselects" (beta feedback 2026-10).
//
// Root cause. Every editor is keyed by a SOURCE OFFSET (ValueEditor's
// `key={anchorOffset}`, the arg slot's `key={arg.span.start}`, BlockList's
// `key={item.span.start}`). Editing field A and then pressing the mouse on
// field B moves focus to B first, and A's blur commits its edit. That edit
// changes the source length, the reparse lands a few milliseconds later,
// and B's offset has moved, so React sees a NEW key and replaces B's input
// with a fresh element. The browser had already focused the old B, so the
// caret appears and then vanishes with the element it lived in. A click on
// a field that comes after an unedited field never does this, which is why
// the report says "sometimes".
//
// BreakdownPane owns the fix (it remembers which editor had focus and
// re-focuses whatever registers at the shifted offset), so this test mounts
// the same focus registry the pane provides.

import { useCallback, useEffect, useRef, useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import { applyEditIntent } from "../../applyEdit";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { useEditorFocusKeeper } from "../../editorFocus";
import type { OffsetEdit } from "../../ephemeralAnchors";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { CommandCard } from "../CommandCard";
import type { CommandNode } from "../../../parser/types";

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

afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

function Harness({
  initialSource,
  keepFocus,
}: {
  initialSource: string;
  /** False reproduces the bug: the pane's focus keeper is left out. */
  keepFocus: boolean;
}) {
  const [source, setSource] = useState(initialSource);
  const parseResult = parseRms(source, rawLangData);
  const command = parseResult.script.sections[0].items[0] as CommandNode;
  const focusableRef = useRef(new Map<number, HTMLElement>());
  const registerFocusable = useCallback(
    (offset: number, el: HTMLElement | null) => {
      if (el) focusableRef.current.set(offset, el);
      else focusableRef.current.delete(offset);
    },
    [],
  );
  const keeper = useEditorFocusKeeper(focusableRef);
  // The pane queues each edit and replays it once the matching parse has
  // rendered. This harness reparses synchronously, so the same queue is
  // drained by an effect that runs after each commit.
  const pendingEdits = useRef<OffsetEdit[]>([]);
  useEffect(() => {
    const edits = pendingEdits.current.splice(0);
    if (keepFocus && edits.length > 0) keeper.restoreAfter(edits);
  }, [source, keeper, keepFocus]);

  const applyEdit: BreakdownContextValue["applyEdit"] = (intent) =>
    applyEditIntent(parseResult, intent, langData, (edits) => {
      pendingEdits.current.push(...edits);
      setSource((prev) => {
        let out = prev;
        for (const e of edits) {
          out = out.slice(0, e.start) + e.newText + out.slice(e.end);
        }
        return out;
      });
    });

  const ctx: BreakdownContextValue = {
    tokens: parseResult.tokens,
    lang: langData,
    diagnostics: [],
    source,
    gameConstants: {
      constants: [],
    } as unknown as BreakdownContextValue["gameConstants"],
    parseResult,
    applyEdit,
    isExpanded: () => true,
    toggleExpanded: () => {},
    expandCard: () => {},
    collapseFromStrip: () => {},
    revealAfterEdit: () => {},
    requestFocus: () => {},
    registerFocusable,
    isSelected: () => false,
    selectCard: () => {},
    clearSelection: () => {},
    moveItem: () => {},
    duplicateItem: () => {},
    selectedItem: undefined,
    comments: [],
    expandedAnchors: new Set(),
  };

  return (
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <div
            onFocusCapture={keepFocus ? keeper.onFocusCapture : undefined}
            onBlurCapture={keepFocus ? keeper.onBlurCapture : undefined}
          >
            <CommandCard command={command} />
          </div>
          <pre data-testid="source">{source}</pre>
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>
  );
}

async function settled() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const SRC = "<LAND_GENERATION>\ncreate_land { land_percent 30 base_size 5 }";

/** Edit `land_percent`, then move focus to `base_size` the way a mouse press does: focus moves first, the old field blurs. */
async function editThenClickNextField() {
  const a = screen.getByDisplayValue("30") as HTMLInputElement;
  const b = screen.getByDisplayValue("5") as HTMLInputElement;
  act(() => a.focus());
  // A longer value pushes every later offset, base_size's included.
  act(() => {
    a.value = "100";
  });
  act(() => b.focus());
  await settled();
}

describe("focus survives the reparse an earlier field's blur-commit causes", () => {
  it("reproduces the bug without the focus keeper: the clicked field is replaced and focus is lost", async () => {
    render(<Harness initialSource={SRC} keepFocus={false} />);
    await settled();
    await editThenClickNextField();

    expect(screen.getByTestId("source").textContent).toContain(
      "land_percent 100",
    );
    const active = document.activeElement;
    expect(active instanceof HTMLInputElement && active.value === "5").toBe(
      false,
    );
  });

  it("with the keeper, the clicked field is focused again after the reparse", async () => {
    render(<Harness initialSource={SRC} keepFocus />);
    await settled();
    await editThenClickNextField();

    expect(screen.getByTestId("source").textContent).toContain(
      "land_percent 100",
    );
    const active = document.activeElement as HTMLInputElement;
    expect(active.tagName).toBe("INPUT");
    expect(active.value).toBe("5");
    expect(active.isConnected).toBe(true);
  });

  it("does not steal focus back after the user clicked away on purpose", async () => {
    render(<Harness initialSource={SRC} keepFocus />);
    await settled();
    const a = screen.getByDisplayValue("30") as HTMLInputElement;
    act(() => a.focus());
    act(() => {
      a.value = "100";
    });
    // Clicking on nothing: blur with no related target, element still mounted.
    act(() => a.blur());
    await settled();
    expect(screen.getByTestId("source").textContent).toContain(
      "land_percent 100",
    );
    expect(document.activeElement).toBe(document.body);
  });
});
