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
import { CommentCard } from "../CommentCard";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

function Harness({ initialSource }: { initialSource: string }) {
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

  const ctx = {
    source,
    applyEdit,
    isExpanded: () => false,
    toggleExpanded: () => {},
    registerFocusable: () => {},
  } as unknown as BreakdownContextValue;

  return (
    <HelpSettingsProvider>
      <BreakdownProvider value={ctx}>
        {comments.map((c) => (
          <CommentCard key={c.start} span={c} />
        ))}
        <pre data-testid="source">{source}</pre>
      </BreakdownProvider>
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
