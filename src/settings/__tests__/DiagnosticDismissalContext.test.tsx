// The hidden-warning store behind RMS0318's "Ok" and "Don't show me this
// again" (DiagnosticDismissalContext.tsx), driven through the real buttons.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import { DismissDiagnosticButtons } from "../../components/DismissDiagnosticButtons";
import {
  CurrentFileProvider,
  DiagnosticDismissalProvider,
  useDiagnosticDismissal,
} from "../DiagnosticDismissalContext";
import type { Diagnostic } from "../../parser/types";

let saved: Record<string, unknown> = {};
const set = vi.fn(async (key: string, value: unknown) => {
  saved[key] = value;
});
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => saved[key]),
    set,
  })),
}));

beforeEach(() => {
  saved = {};
  set.mockClear();
});
afterEach(cleanup);

const span = { start: 0, end: 1 };
const DISMISSIBLE: Diagnostic = {
  severity: "warning",
  code: "RMS0318",
  message: "base_layer",
  span,
};
const ORDINARY: Diagnostic = {
  severity: "warning",
  code: "RMS0303",
  message: "used above its definition",
  span,
};

/** Shows how many of the two diagnostics each file still shows. */
function Counts() {
  const { visible, turnedOff, turnBackOn } = useDiagnosticDismissal();
  const list = [DISMISSIBLE, ORDINARY];
  return (
    <>
      <span data-testid="a">{visible(list, "a.rms").length}</span>
      <span data-testid="b">{visible(list, "b.rms").length}</span>
      <span data-testid="off">{turnedOff.join(",")}</span>
      <button type="button" onClick={() => turnBackOn("RMS0318")}>
        back
      </button>
    </>
  );
}

function Harness({ filePath }: { filePath: string | null }) {
  return (
    <HelpSettingsProvider>
      <DiagnosticDismissalProvider>
        <CurrentFileProvider filePath={filePath}>
          <DismissDiagnosticButtons code="RMS0318" />
          <Counts />
        </CurrentFileProvider>
      </DiagnosticDismissalProvider>
    </HelpSettingsProvider>
  );
}

const count = (id: string) => Number(screen.getByTestId(id).textContent);

describe("hiding a dismissible warning", () => {
  it("Ok hides it in this file only, and is remembered by path", async () => {
    render(<Harness filePath="a.rms" />);
    await waitFor(() => expect(set).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Ok"));
    expect(count("a")).toBe(1);
    expect(count("b")).toBe(2);
    await waitFor(() =>
      expect(saved.diagnosticsHiddenPerFile).toEqual({ "a.rms": ["RMS0318"] }),
    );
  });

  it("Don't show me this again hides it everywhere until turned back on, and never touches an ordinary warning", async () => {
    render(<Harness filePath="a.rms" />);
    await waitFor(() => expect(set).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Don't show me this again"));
    expect(count("a")).toBe(1);
    expect(count("b")).toBe(1);
    expect(screen.getByTestId("off").textContent).toBe("RMS0318");
    await waitFor(() =>
      expect(saved.diagnosticsTurnedOff).toEqual(["RMS0318"]),
    );
    fireEvent.click(screen.getByText("back"));
    expect(count("b")).toBe(2);
  });

  it("an unsaved file's Ok lasts for the session and is never written", async () => {
    render(<Harness filePath={null} />);
    await waitFor(() => expect(set).toHaveBeenCalled());
    fireEvent.click(screen.getByText("Ok"));
    await act(async () => {});
    expect(saved.diagnosticsHiddenPerFile).toEqual({});
  });

  it("loads what was saved, and does not write the empty defaults over it first", async () => {
    saved = {
      diagnosticsTurnedOff: ["RMS0318"],
      diagnosticsHiddenPerFile: { "c.rms": ["RMS0318"] },
    };
    render(<Harness filePath="a.rms" />);
    await waitFor(() =>
      expect(screen.getByTestId("off").textContent).toBe("RMS0318"),
    );
    expect(count("b")).toBe(1);
    for (const [key, value] of set.mock.calls) {
      if (key === "diagnosticsTurnedOff") expect(value).toEqual(["RMS0318"]);
      if (key === "diagnosticsHiddenPerFile")
        expect(value).toEqual({ "c.rms": ["RMS0318"] });
    }
  });
});
