// The four engine additions from the Comeer feedback round
// (feedback/2026-10-comeer-feedback-sessions.md, session 1). A step kind's
// chip and edge stripe, the warning triangle on a spoiler, code entries
// inside a spoiler's paragraphs, and the theme-aware diagram block.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialProvider, useTutorial } from "../TutorialContext";
import { TutorialOverlay } from "../TutorialOverlay";
import { WELCOME_SEEN_KEY } from "../tutorialConstants";
import type { TutorialDefinition, TutorialStep } from "../types";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";

const { storeData } = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
}));

// The same in-memory stand-in for the Tauri store the other overlay tests use.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => storeData.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storeData.set(key, value);
    }),
  })),
}));

beforeEach(() => {
  storeData.clear();
  storeData.set(WELCOME_SEEN_KEY, true);
});

afterEach(() => cleanup());

function manualStep(
  id: string,
  extra: Partial<TutorialStep> = {},
): TutorialStep {
  return {
    id,
    title: `Title ${id}`,
    body: [`Body of ${id}.`],
    completion: { kind: "manual" },
    ...extra,
  };
}

function tutorial(steps: TutorialStep[]): TutorialDefinition {
  return { id: "t", kind: "rms", title: "t", blurb: "t", steps };
}

async function renderOverlay(definition: TutorialDefinition) {
  let api: ReturnType<typeof useTutorial> | null = null;
  function Capture() {
    api = useTutorial();
    return null;
  }
  render(
    <HelpSettingsProvider>
      <TutorialProvider tutorials={[definition]} appVersion="1.0.0">
        <Capture />
        <TutorialOverlay
          hasFile={true}
          activeTab="breakdown"
          applyTextEdits={() => {}}
        />
      </TutorialProvider>
    </HelpSettingsProvider>,
  );
  await waitFor(() => expect(api?.welcomeOpen).toBe(false));
  act(() => api!.start(definition.id));
  return () => api!;
}

/** The fixed-position element the overlay places, the card or the bar. */
function placed(): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    '[class*="callout"], [class*="bar"]',
  );
  if (!el) throw new Error("no callout on screen");
  return el;
}

describe("step kind", () => {
  it("puts the kind's word and icon before the title, and the stripe on the card", async () => {
    await renderOverlay(
      tutorial([
        manualStep("a", { kind: "investigate" }),
        manualStep("b", { kind: "build" }),
      ]),
    );
    const heading = screen.getByRole("heading");
    expect(heading.textContent).toBe("InvestigateTitle a");
    // The icon is drawn, not a character, and hidden from a screen reader,
    // which reads the word instead.
    expect(
      heading.querySelector('svg[aria-hidden="true"] circle'),
    ).not.toBeNull();
    expect(placed().className).toMatch(/kindStripe/);
    expect(placed().className).toMatch(/kindInvestigate/);
    expect(placed().className).not.toMatch(/kindBuild/);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading").textContent).toBe("BuildTitle b");
    expect(placed().className).toMatch(/kindBuild/);
    expect(placed().className).not.toMatch(/kindInvestigate/);
  });

  it("shows neither chip nor stripe on a step without a kind", async () => {
    await renderOverlay(tutorial([manualStep("a")]));
    expect(screen.getByRole("heading").textContent).toBe("Title a");
    expect(placed().className).not.toMatch(/kind/);
  });

  it("keeps the stripe on the minimized bar", async () => {
    await renderOverlay(tutorial([manualStep("a", { kind: "build" })]));
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    const bar = placed();
    expect(bar.className).toMatch(/bar/);
    expect(bar.className).toMatch(/kindStripe/);
    expect(bar.className).toMatch(/kindBuild/);
  });
});

describe("spoiler warning", () => {
  it("draws a named warning triangle before the label of a spoiler marked warn, in both spoiler shapes", async () => {
    await renderOverlay(
      tutorial([
        manualStep("a", {
          body: [
            {
              kind: "spoiler",
              label: "Notice something?",
              warn: true,
              paragraphs: ["Look."],
            },
            { kind: "spoiler", label: "Why", text: "Because.", warn: true },
            { kind: "spoiler", label: "Plain", text: "Nothing." },
          ],
        }),
      ]),
    );
    // The triangle's own name joins the button's, ahead of the label.
    const notice = screen.getByRole("button", {
      name: "Important Notice something?",
    });
    const icon = within(notice).getByRole("img", { name: "Important" });
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.nextSibling?.textContent).toBe("Notice something?");
    expect(screen.getByRole("button", { name: "Important Why" })).toBeTruthy();
    const plain = screen.getByRole("button", { name: /Plain/ });
    expect(within(plain).queryByRole("img")).toBeNull();
  });
});

describe("code entries in a spoiler's paragraphs", () => {
  it("shows a code entry as script lines between the prose, all behind one reveal", async () => {
    const script = "create_player_lands\n  terrain_type SNOW_SOFT";
    await renderOverlay(
      tutorial([
        manualStep("a", {
          body: [
            {
              kind: "spoiler",
              label: "Answer",
              paragraphs: [
                "Before.",
                { kind: "code", text: script },
                ["After, with ", { spoiler: "hidden" }, " words."],
              ],
            },
          ],
        }),
      ]),
    );
    expect(document.querySelector("pre")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Answer/ }));
    const pre = document.querySelector("pre")!;
    // Line breaks and the indent kept, as typed.
    expect(pre.textContent).toBe(script);
    expect(pre.className).toMatch(/code/);
    const before = screen.getByText("Before.");
    const after = screen.getByText(/After, with/);
    expect(
      before.compareDocumentPosition(pre) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      pre.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    // The paragraph after the code entry still has its own inline spoiler.
    expect(screen.queryByText("hidden")).toBeNull();
  });
});

describe("diagram block", () => {
  it("draws the named diagram as inline SVG, named by its alt text, in its place in the body", async () => {
    await renderOverlay(
      tutorial([
        manualStep("a", {
          body: [
            "Above.",
            {
              kind: "diagram",
              name: "start-square-overlap",
              alt: "Two maps.",
            },
            "Below.",
          ],
        }),
      ]),
    );
    const diagram = screen.getByRole("img", { name: "Two maps." });
    expect(diagram.tagName.toLowerCase()).toBe("svg");
    // Two map panels, each with two starting squares, and one overlap.
    expect(diagram.querySelectorAll('[class*="diagramMap"]')).toHaveLength(2);
    expect(diagram.querySelectorAll('[class*="diagramSquare"]')).toHaveLength(
      4,
    );
    expect(diagram.querySelectorAll('[class*="diagramOverlap"]')).toHaveLength(
      1,
    );
    // Inline, so its colours are the theme's CSS variables, not an <img>.
    expect(document.querySelector("img")).toBeNull();
    expect(
      screen.getByText("Above.").compareDocumentPosition(diagram) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });
});
