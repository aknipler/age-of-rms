// The raw and shared block cards. "Edit in Code tab" used to be a disabled
// stub ("wiring arrives with 3.4") and an empty shared block printed a
// "Contents (read-only...)" label over "Nothing here yet.". The button now
// hands the card's span to the context, and an empty block shows no contents
// section at all.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { RawCard } from "../RawCard";
import type { OrphanBlockNode, Span } from "../../../parser/types";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
// RawCard -> BlockList -> ItemCard pulls these in, and they reach monaco-editor.
vi.mock("../../../PreviewCutContext", () => ({
  usePreviewCut: () => ({ cutOffset: null }),
}));
vi.mock("../../../components/preview/PreviewViewContext", () => ({
  usePreviewView: () => ({ view: "current" }),
}));

afterEach(cleanup);

const rawLangData = loadLanguage();
const lang = buildLanguageIndex(rawLangData);

// A shared block, written after a random whose branch ends in a block command.
const SHARED =
  "<OBJECTS_GENERATION>\nstart_random\npercent_chance 50\ncreate_object GOLD\nend_random\n{\n}\n";
const SHARED_FULL =
  "<OBJECTS_GENERATION>\nstart_random\npercent_chance 50\ncreate_object GOLD\nend_random\n{\nnumber_of_objects 4\n}\n";

function renderOrphan(source: string, editInCode: (span: Span) => void) {
  const parseResult = parseRms(source, rawLangData);
  const orphan = parseResult.script.sections[0].items.find(
    (i) => i.kind === "orphanBlock",
  ) as OrphanBlockNode;
  expect(orphan).toBeDefined();
  const ctx: BreakdownContextValue = {
    tokens: parseResult.tokens,
    lang,
    diagnostics: [],
    source,
    gameConstants: {
      constants: [],
    } as unknown as BreakdownContextValue["gameConstants"],
    parseResult,
    applyEdit: () => null,
    isExpanded: () => false,
    toggleExpanded: () => {},
    expandCard: () => {},
    collapseFromStrip: () => {},
    revealAfterEdit: () => {},
    requestFocus: () => {},
    registerFocusable: () => {},
    isSelected: () => false,
    selectCard: () => {},
    clearSelection: () => {},
    editInCode,
    moveItem: () => {},
    duplicateItem: () => {},
    selectedItem: undefined,
    comments: [],
    expandedAnchors: new Set(),
  };
  render(
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <RawCard node={orphan} kindLabel="Shared block" />
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>,
  );
  return orphan;
}

describe("RawCard on a shared block", () => {
  it("Edit in Code tab is enabled and passes the card's span on", () => {
    const editInCode = vi.fn();
    const orphan = renderOrphan(SHARED, editInCode);
    const button = screen.getByRole("button", { name: "Edit in Code tab" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    act(() => {
      fireEvent.click(button);
    });
    expect(editInCode).toHaveBeenCalledTimes(1);
    expect(editInCode).toHaveBeenCalledWith(orphan.span);
  });

  it("shows no contents section for an empty block", () => {
    renderOrphan(SHARED, vi.fn());
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
    expect(screen.queryByText(/read-only/)).toBeNull();
  });

  it("still shows the cards of a block that has some", () => {
    renderOrphan(SHARED_FULL, vi.fn());
    expect(screen.queryByText(/read-only/)).toBeNull();
    expect(screen.getAllByText(/number_of_objects/).length).toBeGreaterThan(0);
  });
});
