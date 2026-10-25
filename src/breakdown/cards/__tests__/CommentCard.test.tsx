// Feedback 2026-10, "comments can't be deleted". A comment card had a toggle
// and a textarea and no way to remove it. These run the real patch engine and
// a real reparse, so what is asserted is the source text a click leaves
// behind, not that a mock was called.

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
import { extractComments } from "../../comments";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { CommentCard } from "../CommentCard";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

// CommentCard draws commented-out code as cards (CommentedCode.tsx), which
// reaches ItemCard and its preview hooks. Mocked as CommandCard.test does.
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
  clickCard,
}: {
  initialSource: string;
  clickCard?: BreakdownContextValue["clickCard"];
}) {
  const [source, setSource] = useState(initialSource);
  const parseResult = parseRms(source, rawLangData);
  const comments = extractComments(parseResult.tokens);

  const applyEdit: BreakdownContextValue["applyEdit"] = (intent) =>
    applyEditIntent(parseResult, intent, langData, (edits) => {
      setSource((prev) => {
        let out = prev;
        for (const e of edits) {
          out = out.slice(0, e.start) + e.newText + out.slice(e.end);
        }
        return out;
      });
    });

  // Full enough for the cards of commented-out code (CommentedCode.tsx),
  // which spread this context into their own.
  const ctx = {
    source,
    lang: langData,
    tokens: parseResult.tokens,
    parseResult,
    diagnostics: [],
    gameConstants: { constants: [] },
    comments,
    expandedAnchors: new Set(),
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
    moveItem: () => {},
    duplicateItem: () => {},
    clickCard,
  } as unknown as BreakdownContextValue;

  return (
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          {comments.map((c) => (
            <CommentCard key={c.start} span={c} />
          ))}
          <pre data-testid="source">{source}</pre>
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>
  );
}

const sourceText = () => screen.getByTestId("source").textContent;

describe("CommentCard delete button", () => {
  it("removes the comment from the source", () => {
    render(
      <Harness initialSource={"/* first */\n<PLAYER_SETUP>\n/* second */"} />,
    );
    expect(screen.getAllByLabelText("Delete")).toHaveLength(2);

    fireEvent.click(screen.getAllByLabelText("Delete")[1]);

    expect(sourceText()).toBe("/* first */\n<PLAYER_SETUP>\n");
    expect(screen.getAllByLabelText("Delete")).toHaveLength(1);
  });

  it("deletes a comment that has unsaved text in its box", () => {
    render(<Harness initialSource={"/* note */\n<PLAYER_SETUP>"} />);
    const box = screen.getByDisplayValue("note") as HTMLTextAreaElement;
    act(() => box.focus());
    fireEvent.change(box, { target: { value: "half typed" } });

    // A real press blurs the box first unless the mousedown is cancelled, and
    // that blur would commit an edit over the span the click removes.
    const stayed = fireEvent.mouseDown(screen.getByLabelText("Delete"));
    expect(stayed).toBe(false); // preventDefault was called
    expect(document.activeElement).toBe(box);

    fireEvent.click(screen.getByLabelText("Delete"));
    expect(sourceText()).toBe("<PLAYER_SETUP>");
  });

  it("deletes a comment that contains a nested comment", () => {
    render(<Harness initialSource={"/* a /* b */ c */\n<PLAYER_SETUP>"} />);
    fireEvent.click(screen.getByLabelText("Delete"));
    expect(sourceText()).toBe("<PLAYER_SETUP>");
  });
});

// Opening a second map while Breakdown stays mounted. Nothing remounts the
// pane, so the cards React keeps are the ones whose key matches, and a
// comment's key is its offset. Two maps stamped with the same header put a
// comment at the same offset, and the textarea (uncontrolled, defaultValue
// read once on mount) kept the first map's text. A blur then wrote that text
// into the second map. The source is a prop here, so a rerender is the switch.
function SwitchHarness({
  source,
  applyEdit = vi.fn(),
}: {
  source: string;
  applyEdit?: BreakdownContextValue["applyEdit"];
}) {
  const parseResult = parseRms(source, rawLangData);
  const comments = extractComments(parseResult.tokens);
  const ctx = {
    source,
    lang: langData,
    applyEdit,
    isExpanded: () => false,
    toggleExpanded: () => {},
    registerFocusable: () => {},
    isSelected: () => false,
    selectCard: () => {},
  } as unknown as BreakdownContextValue;
  return (
    <HelpSettingsProvider>
      <BreakdownProvider value={ctx}>
        {comments.map((c) => (
          <CommentCard key={c.start} span={c} />
        ))}
      </BreakdownProvider>
    </HelpSettingsProvider>
  );
}

describe("CommentCard after the source is replaced", () => {
  it("shows the new map's text for a comment at the same offset", () => {
    const { rerender } = render(
      <SwitchHarness source={"/* Ra header */\n<PLAYER_SETUP>\n"} />,
    );
    expect(screen.getByDisplayValue("Ra header")).toBeTruthy();

    rerender(<SwitchHarness source={"/* Foredaut one */\n<PLAYER_SETUP>\n"} />);

    expect(screen.queryByDisplayValue("Ra header")).toBeNull();
    expect(screen.getByDisplayValue("Foredaut one")).toBeTruthy();
  });

  it("sends no edit when the box is focused and left", () => {
    const applyEdit = vi.fn();
    const { rerender } = render(
      <SwitchHarness
        source={"/* Ra header */\n<PLAYER_SETUP>\n"}
        applyEdit={applyEdit}
      />,
    );
    rerender(
      <SwitchHarness
        source={"/* Foredaut one */\n<PLAYER_SETUP>\n"}
        applyEdit={applyEdit}
      />,
    );

    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    act(() => box.focus());
    fireEvent.blur(box);

    // The old behaviour committed "Ra header" over Foredaut's comment.
    expect(applyEdit).not.toHaveBeenCalled();
  });
});

// 2026-10-22, comment cards became selectable and gained the comment toggle
// (breakdown-design Sec.3.13).
describe("CommentCard selection and comment toggle", () => {
  it("a click on the card selects it, with the modifier keys read off the click", () => {
    const clickCard = vi.fn();
    render(
      <Harness
        initialSource={"<PLAYER_SETUP>\n/* note */\n"}
        clickCard={clickCard}
      />,
    );
    fireEvent.click(screen.getByText("/*").closest("[data-anchor]")!, {
      ctrlKey: true,
    });
    expect(clickCard).toHaveBeenCalledWith(
      { kind: "comment", span: { start: 15, end: 25 } },
      "toggle",
    );
  });

  it("the toggle button puts commented-out code back", () => {
    render(
      <Harness initialSource={"<PLAYER_SETUP>\n/* create_player_lands */\n"} />,
    );
    fireEvent.click(screen.getByLabelText("Uncomment"));
    expect(sourceText()).toBe("<PLAYER_SETUP>\ncreate_player_lands\n");
  });

  it("the toggle button is off for an empty comment, which holds no code", () => {
    render(<Harness initialSource={"<PLAYER_SETUP>\n/* */\n"} />);
    expect(
      (screen.getByLabelText("Uncomment") as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// Commented-out code (2026-10-23, breakdown-design Sec.3.14). A comment that
// reads as RMS shows as cards and stays editable. The source each edit
// leaves behind is the assertion, since the point is that an edit to a card
// lands inside the comment and changes nothing else.
describe("CommentCard with commented-out code", () => {
  const CONST_SRC = "<PLAYER_SETUP>\n/* #const MY_A 1 */\n";

  it("shows code as cards and prose as text", () => {
    render(
      <Harness
        initialSource={
          "<PLAYER_SETUP>\n/* #const MY_A 1 */\n/* Half the time */\n"
        }
      />,
    );
    expect(screen.getByDisplayValue("MY_A")).toBeTruthy();
    expect(screen.getByDisplayValue("Half the time")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(3);
  });

  it("an edit to a card's value changes only that value inside the comment", () => {
    render(<Harness initialSource={CONST_SRC} />);
    const value = screen.getByDisplayValue("1") as HTMLInputElement;
    fireEvent.change(value, { target: { value: "25" } });
    fireEvent.blur(value);
    expect(sourceText()).toBe("<PLAYER_SETUP>\n/* #const MY_A 25 */\n");
  });

  it("adding a #const row inside the comment keeps it one comment", () => {
    render(<Harness initialSource={CONST_SRC} />);
    fireEvent.click(screen.getByText("+ add #const"));
    const out = sourceText() ?? "";
    expect(out).toContain("#const NEW_CONST 0");
    expect(extractComments(parseRms(out, rawLangData).tokens)).toHaveLength(1);
  });

  it("a #define table walks name to name, ends on its button, and adds a row", () => {
    render(
      <Harness
        initialSource={"<PLAYER_SETUP>\n/* #define MY_A\n#define MY_B */\n"}
      />,
    );
    const enter = () =>
      fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    (screen.getByDisplayValue("MY_A") as HTMLInputElement).focus();
    enter();
    expect(document.activeElement).toBe(screen.getByDisplayValue("MY_B"));
    enter();
    const add = screen.getByText("+ add #define");
    expect(document.activeElement).toBe(add);
    fireEvent.click(add);
    expect(sourceText()).toBe(
      "<PLAYER_SETUP>\n/* #define MY_A\n#define MY_B\n#define NEW_DEFINE */\n",
    );
  });

  it("Enter walks a #const table's fields and ends on its add button", () => {
    render(
      <Harness
        initialSource={"<PLAYER_SETUP>\n/* #const MY_A 1\n#const MY_B 2 */\n"}
      />,
    );
    const enter = () =>
      fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    (screen.getByDisplayValue("MY_A") as HTMLInputElement).focus();
    enter();
    expect(document.activeElement).toBe(screen.getByDisplayValue("1"));
    enter();
    expect(document.activeElement).toBe(screen.getByDisplayValue("MY_B"));
    enter();
    expect(document.activeElement).toBe(screen.getByDisplayValue("2"));
    enter();
    expect(document.activeElement).toBe(screen.getByText("+ add #const"));
  });

  it("Enter commits a changed value once before moving on", () => {
    render(
      <Harness
        initialSource={"<PLAYER_SETUP>\n/* #const MY_A 1\n#const MY_B 2 */\n"}
      />,
    );
    const value = screen.getByDisplayValue("1") as HTMLInputElement;
    value.focus();
    // A longer value, so a second commit from the blur that moving focus
    // causes would splice into text the first one already changed.
    fireEvent.change(value, { target: { value: "75" } });
    fireEvent.keyDown(value, { key: "Enter" });
    expect(sourceText()).toBe(
      "<PLAYER_SETUP>\n/* #const MY_A 75\n#const MY_B 2 */\n",
    );
  });

  it("Text switches to the plain text and Cards back", () => {
    render(<Harness initialSource={CONST_SRC} />);
    fireEvent.click(screen.getByText("Text"));
    expect(screen.getByDisplayValue("#const MY_A 1")).toBeTruthy();
    fireEvent.click(screen.getByText("Cards"));
    expect(screen.getByDisplayValue("MY_A")).toBeTruthy();
  });
});
