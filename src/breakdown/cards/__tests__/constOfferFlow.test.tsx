// docs/name-lookup-design.md slice C, the Breakdown value field end to end:
// commit a name, wait for the parse of the edited source, and get the flash,
// the create strip or the move offer. The harness plays the pane's part (it
// keeps the note and pairs it with the source the edit produced), and the
// card, the value editor, the strip and the patch engine are the real ones.

import { useCallback, useRef, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import type { CommandNode } from "../../../parser/types";
import { applyEditIntent } from "../../applyEdit";
import {
  BreakdownProvider,
  type BreakdownContextValue,
  type CommitNote,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { CommandCard } from "../CommandCard";

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

// Each test parses and re-renders a card several times. The default 5 s is
// enough on a quiet machine and not on a loaded one, where it has timed out.
vi.setConfig({ testTimeout: 20_000 });

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

function Harness({ initialSource }: { initialSource: string }) {
  const [source, setSource] = useState(initialSource);
  const [note, setNote] = useState<CommitNote | null>(null);
  const [said, setSaid] = useState("");
  // The source the last edit produces, which is what the pane's
  // expectedSourceRef holds when noteCommit is called.
  const expected = useRef(source);
  const parseResult = parseRms(source, rawLangData);
  const command = parseResult.script.sections[0].items.find(
    (i) => i.kind === "command",
  ) as CommandNode;

  const applyEdit: BreakdownContextValue["applyEdit"] = (intent) =>
    applyEditIntent(parseResult, intent, langData, (edits) => {
      let out = source;
      for (const e of edits)
        out = out.slice(0, e.start) + e.newText + out.slice(e.end);
      expected.current = out;
      setSource(out);
    });
  const noteCommit = useCallback(
    (name: string, anchor: number) =>
      setNote({ name, anchor, source: expected.current }),
    [],
  );
  const clearConstNote = useCallback(() => setNote(null), []);
  const announce = useCallback((m: string) => setSaid(m), []);

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
    registerFocusable: () => {},
    isSelected: () => false,
    selectCard: () => {},
    clearSelection: () => {},
    editInCode: () => {},
    moveItem: () => {},
    duplicateItem: () => {},
    selectedItem: undefined,
    comments: [],
    expandedAnchors: new Set(),
    constNote: note,
    noteCommit,
    clearConstNote,
    announce,
  };

  return (
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <CommandCard command={command} />
          <pre data-testid="source">{source}</pre>
          <output data-testid="said">{said}</output>
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>
  );
}

const SRC = "<LAND_GENERATION>\ncreate_land {\n  terrain_type GRASS\n}\n";
const source = () => screen.getByTestId("source").textContent ?? "";

/** Type `value` into the field showing `shown` and click away, the way a commit happens. */
async function commitValue(shown: string, value: string) {
  const el = screen.getByDisplayValue(shown) as HTMLInputElement;
  act(() => el.focus());
  act(() => {
    el.value = value;
  });
  act(() => el.blur());
  await act(async () => {
    await Promise.resolve();
  });
}

describe("a committed name that resolves", () => {
  it("flashes the field once and tells a screen reader", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "DIRT");
    const field = screen.getByDisplayValue("DIRT");
    expect(field.className).toMatch(/resolveFlash/);
    expect(screen.getByTestId("said").textContent).toMatch(
      /^DIRT is a built-in terrain/,
    );
    // Consumed: no strip, and the note is gone so a remount cannot replay it.
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("does not flash a number", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "5");
    expect(screen.getByDisplayValue("5").className).not.toMatch(/resolveFlash/);
    expect(screen.getByTestId("said").textContent).toBe("");
  });
});

describe("a committed name our data does not know", () => {
  it("offers to create it, and Create writes the line above the command and flashes", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    const strip = screen.getByRole("group");
    expect(strip.textContent).toMatch(/No const named FORREST/);
    expect(strip.textContent).toMatch(/Did you mean FOREST\?/);
    expect((screen.getByLabelText("Value") as HTMLInputElement).value).toBe(
      "10",
    );

    await act(async () => {
      fireEvent.click(screen.getByText("Create"));
    });
    expect(source()).toBe(
      "<LAND_GENERATION>\n#const FORREST 10\ncreate_land {\n  terrain_type FORREST\n}\n",
    );
    // The name resolves now, so the strip is replaced by the flash.
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByDisplayValue("FORREST").className).toMatch(
      /resolveFlash/,
    );
  });

  it("Create in the header writes above the first section", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    fireEvent.change(screen.getByLabelText("Where to put the line"), {
      target: { value: "header" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Create"));
    });
    expect(source().indexOf("#const FORREST 10")).toBeLessThan(
      source().indexOf("<LAND_GENERATION>"),
    );
  });

  it("uses the value typed in the strip", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "21" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Create"));
    });
    expect(source()).toContain("#const FORREST 21\n");
  });

  it("warns beside Create when the value is 69 (RMS0111)", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    fireEvent.change(screen.getByLabelText("Value"), {
      target: { value: "69" },
    });
    expect(screen.getByRole("group").textContent).toMatch(/RMS0111/);
  });

  it("Did you mean puts the built-in name in the field and flashes it", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    await act(async () => {
      fireEvent.click(screen.getByText("Did you mean FOREST?"));
    });
    expect(source()).toContain("terrain_type FOREST");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByDisplayValue("FOREST").className).toMatch(
      /resolveFlash/,
    );
  });

  it("Dismiss hides the strip and changes nothing", async () => {
    render(<Harness initialSource={SRC} />);
    await commitValue("GRASS", "FORREST");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByRole("group")).toBeNull();
    expect(source()).toContain("terrain_type FORREST");
    expect(source()).not.toContain("#const");
  });

  it("offers nothing in a script that includes another file (Sec.7.1)", async () => {
    render(<Harness initialSource={`#include_drs random_map.def\n${SRC}`} />);
    await commitValue("GRASS", "FORREST");
    expect(screen.queryByRole("group")).toBeNull();
  });
});

describe("a committed name defined below the use", () => {
  const BELOW = `${SRC}#const MY_FOREST 10\n`;

  it("offers to move the #const up, and Move does it as written", async () => {
    render(<Harness initialSource={BELOW} />);
    await commitValue("GRASS", "MY_FOREST");
    expect(screen.getByRole("group").textContent).toMatch(
      /MY_FOREST is defined on line 5, below this use/,
    );
    await act(async () => {
      fireEvent.click(screen.getByText("Move the #const up here"));
    });
    expect(source()).toBe(
      "<LAND_GENERATION>\n#const MY_FOREST 10\ncreate_land {\n  terrain_type MY_FOREST\n}\n",
    );
    expect(screen.getByDisplayValue("MY_FOREST").className).toMatch(
      /resolveFlash/,
    );
  });

  it("hides Move and says why when the definition sits in a branch", async () => {
    render(
      <Harness
        initialSource={`${SRC}if TINY_MAP\n#const MY_FOREST 10\nendif\n`}
      />,
    );
    await commitValue("GRASS", "MY_FOREST");
    expect(screen.queryByText("Move the #const up here")).toBeNull();
    expect(screen.getByRole("group").textContent).toMatch(/inside a branch/);
  });
});
