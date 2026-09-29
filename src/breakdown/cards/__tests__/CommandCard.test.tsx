// Regression for a bug in the collapsed summary line: striking through the
// LAST flag shown there used to unmount SummaryAttributes entirely instead
// of leaving its 30s undo ghost up, because the old render gate was
// `!expanded && summaryAttrs.length > 0` and summaryAttrs (recomputed from
// the freshly reparsed AST) drops to 0 the instant that flag's own removal
// lands. Card actions bypass the normal typing debounce (reparseNow), so
// the reparse arrives within a render or two of the click — the ghost
// flashed for a frame, if that, rather than holding for its lifetime.

import { useState } from "react";
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
import { applyEditIntent } from "../../applyEdit";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { CommandCard } from "../CommandCard";
import type { CommandNode } from "../../../parser/types";

const saved: Record<string, unknown> = { breakdownSummaryClick: "edit" };
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => saved[key]),
    set: vi.fn(async () => {}),
  })),
}));
// CommandCard -> OtherContentsRow -> ItemCard statically imports these,
// which pull in monaco-editor (via useDocument.ts) transitively. Not
// reachable at runtime for this flag-only fixture (no "Other contents"
// section renders), but ES module imports execute at load time regardless.
vi.mock("../../../PreviewCutContext", () => ({
  usePreviewCut: () => ({ cutOffset: null }),
}));
vi.mock("../../../components/preview/PreviewViewContext", () => ({
  usePreviewView: () => ({ view: "current" }),
}));

afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

/** A minimal real reparse loop, standing in for BreakdownPane's own. */
function Harness({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource);
  const parseResult = parseRms(source, rawLangData);
  const command = parseResult.script.sections[0].items[0] as CommandNode;

  const applyEdit: BreakdownContextValue["applyEdit"] = (intent) =>
    applyEditIntent(parseResult, intent, langData, (edits) => {
      // One intent can carry two edits since moveNode landed (an insert
      // plus its removal). editsOf hands them back highest offset first,
      // so applying them in the given order never shifts an offset that
      // is still to be used.
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
    // No-ops, this fixture's tests never move or duplicate a card.
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
          <CommandCard command={command} />
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

const SRC = "<LAND_GENERATION>\ncreate_land { set_circular_base }";

describe("CommandCard collapsed summary line", () => {
  it("striking the only attribute shown keeps its ghost up instead of vanishing", async () => {
    render(<Harness initialSource={SRC} />);
    await settled();

    fireEvent.click(screen.getByText("set_circular_base"));
    await settled();

    const ghost = screen.getByText("set_circular_base");
    expect(ghost.className).toMatch(/ghost/);
  });

  it("renders every attribute, not just the first 3 (visual truncation is CSS's job)", async () => {
    const manySrc =
      "<LAND_GENERATION>\ncreate_land { land_percent 30 number_of_tiles 50 base_size 5 set_circular_base }";
    render(<Harness initialSource={manySrc} />);
    await settled();

    expect(screen.getByText("land_percent 30")).toBeTruthy();
    expect(screen.getByText("number_of_tiles 50")).toBeTruthy();
    expect(screen.getByText("base_size 5")).toBeTruthy();
    expect(screen.getByText("set_circular_base")).toBeTruthy();
  });
});
