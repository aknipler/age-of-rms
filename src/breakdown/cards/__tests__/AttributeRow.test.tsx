// Regression test for the "click to add" absent-attribute row: the
// placeholder text used to be a bare <span> with no click handler, so
// clicking exactly what the UI told you to click ("click to add") did
// nothing, only a small, separately-dimmed "+" button next to it worked.
// Two things need proving: (1) clicking the row (not just the button) now
// fires the add, and (2) clicking the button doesn't fire it TWICE (its
// click bubbles into the new row-level handler unless stopped).

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttributeRow, AttributeInstanceRow } from "../AttributeRow";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import { buildLanguageIndex } from "../../../parser/language";
import { applyEditIntent } from "../../applyEdit";
import type { EditIntent } from "../../patch/intents";
import type { AttributeSlot } from "../../attributeModel";
import type {
  AttributeNode,
  BlockNode,
  CommandNode,
} from "../../../parser/types";

// HelpTip (used by AttributeRow) needs HelpSettingsProvider, which reads
// @tauri-apps/plugin-store on mount, same mock TutorialContext.test.tsx
// established as this repo's pattern for it.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => {}),
  })),
}));

afterEach(cleanup);

// No `default` on the argument, this is what actually renders the literal
// "click to add" text (AttributeRow.tsx: absent + no default -> that
// string; absent + a default -> the default's own value is shown instead).
// Most real attributes have no default, so this is the common case, not an
// edge case.
const slot: AttributeSlot = {
  name: "terrain_type",
  def: {
    name: "terrain_type",
    arguments: [{ name: "terrain", type: "terrainConstant" }],
    verified: true,
  },
  instances: [],
  isFlag: false,
};

function renderRow(applyEdit: BreakdownContextValue["applyEdit"]) {
  const ctx = {
    applyEdit,
    requestFocus: vi.fn(),
  } as unknown as BreakdownContextValue;
  return render(
    <HelpSettingsProvider>
      <BreakdownProvider value={ctx}>
        <AttributeRow slot={slot} target={{} as CommandNode} />
      </BreakdownProvider>
    </HelpSettingsProvider>,
  );
}

describe("AttributeRow — absent slot (the 'click to add' row)", () => {
  it("clicking the row itself (not just the + button) adds the attribute", () => {
    const applyEdit = vi.fn(() => ({
      edit: { start: 0, end: 0, newText: "" },
      caret: 0,
    }));
    renderRow(applyEdit);
    fireEvent.click(screen.getByText("click to add"));
    expect(applyEdit).toHaveBeenCalledTimes(1);
    // A terrainConstant slot inserts bare (Sec.4.3 amendment, 2026-09-17),
    // the value comes later through appendArg.
    expect(applyEdit).toHaveBeenCalledWith({
      kind: "addAttribute",
      target: {},
      name: "terrain_type",
      bare: true,
    });
  });

  it("a numeric slot still inserts with its placeholder, not bare", () => {
    const applyEdit = vi.fn(() => ({
      edit: { start: 0, end: 0, newText: "" },
      caret: 0,
    }));
    const numericSlot: AttributeSlot = {
      name: "number_of_clumps",
      def: {
        name: "number_of_clumps",
        arguments: [{ name: "count", type: "integer", default: 1 }],
        verified: true,
      },
      instances: [],
      isFlag: false,
    };
    const ctx = {
      applyEdit,
      requestFocus: vi.fn(),
    } as unknown as BreakdownContextValue;
    render(
      <HelpSettingsProvider>
        <BreakdownProvider value={ctx}>
          <AttributeRow slot={numericSlot} target={{} as CommandNode} />
        </BreakdownProvider>
      </HelpSettingsProvider>,
    );
    // The default shows as the greyed preview and rides along on insert.
    fireEvent.click(screen.getByText("1"));
    expect(applyEdit).toHaveBeenCalledWith({
      kind: "addAttribute",
      target: {},
      name: "number_of_clumps",
      value: [1],
    });
  });

  it("clicking the + button adds it exactly once, not twice (bubble into the row must be stopped)", () => {
    const applyEdit = vi.fn(() => ({
      edit: { start: 0, end: 0, newText: "" },
      caret: 0,
    }));
    renderRow(applyEdit);
    fireEvent.click(screen.getByLabelText("Add"));
    expect(applyEdit).toHaveBeenCalledTimes(1);
  });
});

// docs/breakdown-design.md Sec.3.4 as amended 2026-09-18. An arg that parsed
// to a math expression used to render as a read-only pill titled "edit in
// the Code tab". It is now an ordinary raw-text field whose commit replaces
// the whole expression span verbatim. There was no coverage of the old
// behaviour at all, so this is a first pass over the field rather than a
// re-pin of one.
const rawLangData = loadLanguage();
const langData = buildLanguageIndex(rawLangData);

/**
 * A real parse plus the real patch engine plus a real reparse, the same
 * harness shape CommandCard.test.tsx uses. A fake applyEdit would prove the
 * component calls something; running the engine proves what lands in the
 * source text, which is the only thing Sec.3.4's whole-span swap is about.
 */
function ExprHarness({
  initialSource,
  onIntent,
}: {
  initialSource: string;
  onIntent: (intent: EditIntent) => void;
}) {
  const [source, setSource] = useState(initialSource);
  const parseResult = parseRms(source, rawLangData);
  const command = parseResult.script.sections[0].items[0] as CommandNode;
  const attr = (command.block as BlockNode).items[0] as AttributeNode;

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
    requestFocus: () => {},
    registerFocusable: () => {},
  } as unknown as BreakdownContextValue;

  return (
    <HelpSettingsProvider>
      <BreakdownProvider value={ctx}>
        <AttributeInstanceRow
          node={attr}
          helpId="breakdown.attributeRow.value"
        />
        <pre data-testid="source">{source}</pre>
      </BreakdownProvider>
    </HelpSettingsProvider>
  );
}

const EXPR_SRC =
  "<LAND_GENERATION>\ncreate_land { clumping_factor (MY_C + 5) }";

function currentSource() {
  return screen.getByTestId("source").textContent;
}

describe("AttributeValueEditor — a math expression argument (Sec.3.4)", () => {
  it("renders an editable input seeded with the reconstructed expression, not a read-only pill", () => {
    render(<ExprHarness initialSource={EXPR_SRC} onIntent={() => {}} />);
    // renderArgValue joins the expression's own tokens with single spaces,
    // so this is the reconstruction, not a slice of the source.
    const field = screen.getByDisplayValue("(MY_C + 5)");
    expect(field.tagName).toBe("INPUT");
    expect((field as HTMLInputElement).disabled).toBe(false);
    // The old pill was a <span> carrying this exact title. Nothing should
    // render it any more, in this file or in RandomCard.
    expect(document.querySelector('[title^="Math expression"]')).toBeNull();
  });

  it("committing a replacement that contains spaces rewrites the whole span verbatim", () => {
    const intents: EditIntent[] = [];
    render(
      <ExprHarness
        initialSource={EXPR_SRC}
        onIntent={(i) => intents.push(i)}
      />,
    );

    const field = screen.getByDisplayValue("(MY_C + 5)");
    fireEvent.change(field, { target: { value: "(MY_C * 2 + 3)" } });
    fireEvent.blur(field);

    // Without allowSpaces, ValueEditor's commit() refuses anything holding
    // whitespace and never calls onCommit, so this array stays empty and
    // the source below never moves. That is the one genuinely new risk in
    // the change, and it is what this case exists to catch.
    expect(intents).toHaveLength(1);
    const intent = intents[0] as Extract<EditIntent, { kind: "setArgValue" }>;
    expect(intent.kind).toBe("setArgValue");
    expect(intent.value).toBe("(MY_C * 2 + 3)");
    expect(currentSource()).toBe(
      "<LAND_GENERATION>\ncreate_land { clumping_factor (MY_C * 2 + 3) }",
    );
  });

  it("a bare #const name typed over the expression commits as written", () => {
    const intents: EditIntent[] = [];
    render(
      <ExprHarness
        initialSource={EXPR_SRC}
        onIntent={(i) => intents.push(i)}
      />,
    );

    const field = screen.getByDisplayValue("(MY_C + 5)");
    fireEvent.change(field, { target: { value: "MY_CLUMPING" } });
    fireEvent.blur(field);

    // Sec.3.4, resolution is the ordinary reparse's job, the field itself
    // does not check the name against the symbol table.
    expect(currentSource()).toBe(
      "<LAND_GENERATION>\ncreate_land { clumping_factor MY_CLUMPING }",
    );
  });

  it("commits as a raw string even when the typed replacement is a plain number", () => {
    const intents: EditIntent[] = [];
    render(
      <ExprHarness
        initialSource={EXPR_SRC}
        onIntent={(i) => intents.push(i)}
      />,
    );

    const field = screen.getByDisplayValue("(MY_C + 5)");
    fireEvent.change(field, { target: { value: "42" } });
    fireEvent.blur(field);

    // clumping_factor's declared type is `integer`, so the unforced path
    // would hand computeEdit the NUMBER 42. Forcing "string" keeps an
    // expression slot opaque. Both render "42" into the source, so the
    // difference is only visible on the intent itself.
    const intent = intents[0] as Extract<EditIntent, { kind: "setArgValue" }>;
    expect(intent.value).toBe("42");
    expect(typeof intent.value).toBe("string");
  });

  it("an ordinary non-expression argument still refuses spaces", () => {
    const intents: EditIntent[] = [];
    render(
      <ExprHarness
        initialSource={"<LAND_GENERATION>\ncreate_land { clumping_factor 8 }"}
        onIntent={(i) => intents.push(i)}
      />,
    );

    const field = screen.getByDisplayValue("8");
    fireEvent.change(field, { target: { value: "8 9" } });
    fireEvent.blur(field);

    // allowSpaces is lifted for the expression case only. A plain integer
    // slot has to keep rejecting whitespace, or one token would silently
    // become two.
    expect(intents).toHaveLength(0);
    expect(screen.getByText("can't contain spaces here")).toBeTruthy();
  });
});
