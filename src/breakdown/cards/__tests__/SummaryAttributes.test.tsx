// The clickable summary line (beta feedback 2026-09-17). Covers the two
// settings.breakdown.summaryClick modes and the flag ghost's lifetime.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GHOST_LIFETIME_MS, SummaryAttributes } from "../SummaryAttributes";
import {
  BreakdownProvider,
  type BreakdownContextValue,
} from "../../BreakdownContext";
import { HelpSettingsProvider } from "../../../help/HelpSettingsContext";
import { BreakdownSettingsProvider } from "../../../settings/BreakdownSettingsContext";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import type { AttributeNode, CommandNode } from "../../../parser/types";

// Both providers read @tauri-apps/plugin-store on mount, same mock the
// other React tests use. The store's get returns whatever `saved` holds,
// so a test can pick the summaryClick mode by seeding it.
let saved: Record<string, unknown> = {};
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => saved[key]),
    set: vi.fn(async () => {}),
  })),
}));

afterEach(() => {
  cleanup();
  saved = {};
  vi.useRealTimers();
});

const langData = loadLanguage();
const SRC =
  "<LAND_GENERATION>\ncreate_land { land_percent 30 set_flat_terrain_only }";

function setup(mode: "open" | "edit") {
  saved = { breakdownSummaryClick: mode };
  const result = parseRms(SRC, langData);
  const command = result.script.sections[0].items[0] as CommandNode;
  const attrs = command.block!.items.filter(
    (i): i is AttributeNode => i.kind === "attribute",
  );
  const applyEdit = vi.fn(() => ({
    edit: { start: 0, end: 0, newText: "" },
    caret: 0,
  }));
  const expandCard = vi.fn();
  const requestFocus = vi.fn();
  const ctx = {
    tokens: result.tokens,
    applyEdit,
    expandCard,
    requestFocus,
    registerFocusable: vi.fn(),
    parseResult: result,
    gameConstants: { constants: [] },
  } as unknown as BreakdownContextValue;
  render(
    <HelpSettingsProvider>
      <BreakdownSettingsProvider>
        <BreakdownProvider value={ctx}>
          <SummaryAttributes command={command} attrs={attrs} />
        </BreakdownProvider>
      </BreakdownSettingsProvider>
    </HelpSettingsProvider>,
  );
  return { command, attrs, applyEdit, expandCard, requestFocus };
}

/** The settings provider loads asynchronously, wait for the seeded mode to land. */
async function settled() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("SummaryAttributes", () => {
  it("open mode: a click expands the card and focuses that attribute's editor", async () => {
    const { command, attrs, expandCard, requestFocus } = setup("open");
    await settled();
    fireEvent.click(screen.getByText("land_percent 30"));
    expect(expandCard).toHaveBeenCalledWith(command.span);
    expect(requestFocus).toHaveBeenCalledWith(attrs[0].args[0].span.start);
  });

  it("open mode: a flag click expands only, there is no editor to focus", async () => {
    const { expandCard, requestFocus } = setup("open");
    await settled();
    fireEvent.click(screen.getByText("set_flat_terrain_only"));
    expect(expandCard).toHaveBeenCalledTimes(1);
    expect(requestFocus).not.toHaveBeenCalled();
  });

  it("edit mode: a value click swaps in an editor instead of opening the card", async () => {
    const { expandCard } = setup("edit");
    await settled();
    fireEvent.click(screen.getByText("land_percent 30"));
    expect(expandCard).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("30")).toBeTruthy();
  });

  it("edit mode: a flag click removes it now, keeps a ghost, and the ghost restores it", async () => {
    const { command, attrs, applyEdit } = setup("edit");
    await settled();
    fireEvent.click(screen.getByText("set_flat_terrain_only"));
    expect(applyEdit).toHaveBeenCalledWith({
      kind: "removeNode",
      node: attrs[1],
    });
    // The fixture never reparses (applyEdit is a stub), so without the
    // ghost-filters-out-its-own-live-entry logic this would render BOTH
    // the untouched live attribute and its ghost — the duplicate flash a
    // real reparse round-trip briefly produces too. Exactly one element
    // should exist, and it should be the struck-through one.
    const matches = screen.getAllByText("set_flat_terrain_only");
    expect(matches).toHaveLength(1);
    const ghost = matches[0];
    expect(ghost.className).toMatch(/ghost/);
    fireEvent.click(ghost);
    expect(applyEdit).toHaveBeenLastCalledWith({
      kind: "toggleFlag",
      target: command.block,
      name: "set_flat_terrain_only",
      on: true,
    });
    expect(
      screen
        .getAllByText("set_flat_terrain_only")
        .some((el) => el.className.includes("ghost")),
    ).toBe(false);
  });

  it("edit mode: a ghost reinserts before its old neighbor, not at the end of the line", async () => {
    // The line is uncapped (CommandCard.tsx no longer slices to 3), so a
    // command with several attributes fills the row with no spare width.
    // A ghost appended after every live entry would land past .summary's
    // ellipsis cutoff and never be seen. Striking a flag that ISN'T last
    // must reinsert its ghost where it used to sit, not at the tail.
    saved = { breakdownSummaryClick: "edit" };
    const src =
      "<LAND_GENERATION>\ncreate_land { set_flat_terrain_only land_percent 30 number_of_tiles 50 }";
    const result = parseRms(src, langData);
    const command = result.script.sections[0].items[0] as CommandNode;
    const attrs = command.block!.items.filter(
      (i): i is AttributeNode => i.kind === "attribute",
    );
    const ctx = {
      tokens: result.tokens,
      applyEdit: vi.fn(() => ({
        edit: { start: 0, end: 0, newText: "" },
        caret: 0,
      })),
      expandCard: vi.fn(),
      requestFocus: vi.fn(),
      registerFocusable: vi.fn(),
      parseResult: result,
      gameConstants: { constants: [] },
    } as unknown as BreakdownContextValue;
    render(
      <HelpSettingsProvider>
        <BreakdownSettingsProvider>
          <BreakdownProvider value={ctx}>
            <SummaryAttributes command={command} attrs={attrs} />
          </BreakdownProvider>
        </BreakdownSettingsProvider>
      </HelpSettingsProvider>,
    );
    await settled();

    fireEvent.click(screen.getByText("set_flat_terrain_only"));

    // What matters here is DOM order: the ghost must land before
    // land_percent/number_of_tiles, not after.
    const buttons = screen.getAllByRole("button");
    const ghostIndex = buttons.findIndex((el) =>
      el.className.includes("ghost"),
    );
    const landPercentIndex = buttons.findIndex(
      (el) => el.textContent === "land_percent 30",
    );
    const tilesIndex = buttons.findIndex(
      (el) => el.textContent === "number_of_tiles 50",
    );
    expect(ghostIndex).toBeGreaterThanOrEqual(0);
    expect(ghostIndex).toBeLessThan(landPercentIndex);
    expect(landPercentIndex).toBeLessThan(tilesIndex);
  });

  it("edit mode: a ghost disappears on its own after GHOST_LIFETIME_MS", async () => {
    vi.useFakeTimers();
    setup("edit");
    await settled();
    fireEvent.click(screen.getByText("set_flat_terrain_only"));
    const isGhosted = () =>
      screen
        .getAllByText("set_flat_terrain_only")
        .some((el) => el.className.includes("ghost"));
    expect(isGhosted()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(GHOST_LIFETIME_MS - 1);
    });
    expect(isGhosted()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(isGhosted()).toBe(false);
  });
});
