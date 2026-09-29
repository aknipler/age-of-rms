// docs/breakdown-design.md Sec.3.4 as amended 2026-09-18, the RandomCard
// half. A percent_chance operand that parsed to a math expression used to
// render as a read-only pill, which also contradicted Sec.3.5's own
// description of the chance field as editable (number, rnd or expression).
// It is now the same raw-text field every other value uses, with a commit
// that replaces the whole expression span verbatim.

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { RandomCard } from "../RandomCard";
import type { EditIntent } from "../../patch/intents";
import type { RandomNode } from "../../../parser/types";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));
// RandomCard renders each branch's items through BlockList -> ItemCard,
// which statically imports these, and they pull in monaco-editor through
// useDocument.ts. Same mocks CommandCard.test.tsx already needs, for the
// same reason, ES module imports run at load time whether or not the
// fixture reaches that code.
vi.mock("../../../PreviewCutContext", () => ({
  usePreviewCut: () => ({ cutOffset: null }),
}));
vi.mock("../../../components/preview/PreviewViewContext", () => ({
  usePreviewView: () => ({ view: "current" }),
}));

afterEach(cleanup);

const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

/** Real parse, real patch engine, real reparse, as in CommandCard.test.tsx. */
function Harness({
  initialSource,
  onIntent,
}: {
  initialSource: string;
  onIntent: (intent: EditIntent) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const parseResult = parseRms(source, rawLangData);
  const node = parseResult.script.sections[0].items[0] as RandomNode;

  const applyEdit: BreakdownContextValue["applyEdit"] = (intent) => {
    onIntent(intent);
    return applyEditIntent(parseResult, intent, langData, (edits) => {
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
  };

  const ctx = {
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
    selectedItem: undefined,
    comments: [],
    moveItem: () => {},
    duplicateItem: () => {},
    expandedAnchors: new Set<number>(),
  } as unknown as BreakdownContextValue;

  return (
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <RandomCard node={node} />
          <pre data-testid="source">{source}</pre>
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>
  );
}

const EXPR_SRC =
  "<LAND_GENERATION>\nstart_random\npercent_chance (MY_PCT + 5)\ncreate_land { land_percent 20 }\nend_random";

const PLAIN_SRC =
  "<LAND_GENERATION>\nstart_random\npercent_chance 30\ncreate_land { land_percent 20 }\nend_random";

function currentSource() {
  return screen.getByTestId("source").textContent;
}

describe("RandomCard — a percent_chance holding a math expression (Sec.3.4)", () => {
  it("renders an editable chance field, not a read-only pill", () => {
    render(<Harness initialSource={EXPR_SRC} onIntent={() => {}} />);
    const field = screen.getByDisplayValue("(MY_PCT + 5)");
    expect(field.tagName).toBe("INPUT");
    expect((field as HTMLInputElement).disabled).toBe(false);
    expect(document.querySelector('[title^="Math expression"]')).toBeNull();
  });

  it("committing a replacement that contains spaces rewrites the whole span verbatim", () => {
    const intents: EditIntent[] = [];
    render(
      <Harness initialSource={EXPR_SRC} onIntent={(i) => intents.push(i)} />,
    );

    const field = screen.getByDisplayValue("(MY_PCT + 5)");
    fireEvent.change(field, { target: { value: "(MY_PCT * 2)" } });
    fireEvent.blur(field);

    // allowSpaces again. Drop it and commit() rejects the whitespace
    // before onCommit ever runs, so no intent is produced at all.
    expect(intents).toHaveLength(1);
    const intent = intents[0] as Extract<EditIntent, { kind: "setChance" }>;
    expect(intent.kind).toBe("setChance");
    expect(intent.value).toBe("(MY_PCT * 2)");
    expect(currentSource()).toBe(
      "<LAND_GENERATION>\nstart_random\npercent_chance (MY_PCT * 2)\ncreate_land { land_percent 20 }\nend_random",
    );
  });

  it("commits as a raw string even when the typed replacement is a plain number", () => {
    const intents: EditIntent[] = [];
    render(
      <Harness initialSource={EXPR_SRC} onIntent={(i) => intents.push(i)} />,
    );

    const field = screen.getByDisplayValue("(MY_PCT + 5)");
    fireEvent.change(field, { target: { value: "25" } });
    fireEvent.blur(field);

    // The unforced path types this field `integer`, which would coerce to
    // the NUMBER 25. An expression slot stays opaque text.
    const intent = intents[0] as Extract<EditIntent, { kind: "setChance" }>;
    expect(intent.value).toBe("25");
    expect(typeof intent.value).toBe("string");
  });

  it("a plain numeric chance keeps its number commit and still refuses spaces", () => {
    const intents: EditIntent[] = [];
    render(
      <Harness initialSource={PLAIN_SRC} onIntent={(i) => intents.push(i)} />,
    );

    const field = screen.getByDisplayValue("30");
    fireEvent.change(field, { target: { value: "30 40" } });
    fireEvent.blur(field);
    expect(intents).toHaveLength(0);
    expect(screen.getByText("can't contain spaces here")).toBeTruthy();

    fireEvent.change(field, { target: { value: "45" } });
    fireEvent.blur(field);
    const intent = intents[0] as Extract<EditIntent, { kind: "setChance" }>;
    expect(intent.value).toBe(45);
    expect(currentSource()).toBe(
      "<LAND_GENERATION>\nstart_random\npercent_chance 45\ncreate_land { land_percent 20 }\nend_random",
    );
  });
});
