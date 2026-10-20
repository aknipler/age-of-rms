// The tutorial card's two ways out of the learner's way. Minimize shrinks it
// to a bar, bottom right by default, and dragging moves the card or the bar
// to a spot that holds for the rest of the run. Both replace the old "Move
// this out of the way" button, which only anchored steps showed and which
// could not move a card already in the corner it parked in.
//
// jsdom lays nothing out, so every box is 0 by 0. The tests that read a
// position give the card and the anchor real sizes by stubbing
// getBoundingClientRect, keyed on the element.

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

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => storeData.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storeData.set(key, value);
    }),
  })),
}));

const VIEW_W = 1200;
const VIEW_H = 800;
const CARD = { width: 300, height: 200 };
const BAR = { width: 250, height: 30 };

beforeEach(() => {
  storeData.clear();
  storeData.set(WELCOME_SEEN_KEY, true);
  vi.stubGlobal("innerWidth", VIEW_W);
  vi.stubGlobal("innerHeight", VIEW_H);
  // jsdom has no pointer capture. The overlay only needs the calls to exist.
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  // jsdom has no PointerEvent either, and without one fireEvent drops
  // `button`, `clientX` and `pointerId`. A MouseEvent carries the first
  // two, and the subclass adds the third.
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    vi.stubGlobal("PointerEvent", PointerEventStub);
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function rect(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** The card is CARD sized, the bar BAR sized, and an element with `data-tutorial-anchor` gets the box `anchors` names for it. */
function stubLayout(anchors: Record<string, DOMRect> = {}) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const anchorId = this.getAttribute("data-tutorial-anchor");
      if (anchorId && anchors[anchorId]) return anchors[anchorId];
      const cls = this.getAttribute("class") ?? "";
      // Wherever the overlay last put it, the way a real layout would report.
      const style = (this as HTMLElement).style;
      const left = parseFloat(style.left) || 0;
      const top = parseFloat(style.top) || 0;
      if (/bar/.test(cls)) return rect(left, top, BAR.width, BAR.height);
      if (/callout/.test(cls)) return rect(left, top, CARD.width, CARD.height);
      return rect(0, 0, 0, 0);
    },
  );
}

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

/** Outside the card that stays mounted, hidden, while minimized. */
function visible(el: HTMLElement): boolean {
  return el.closest("[hidden]") === null;
}

function positionOf(el: HTMLElement) {
  return { top: parseFloat(el.style.top), left: parseFloat(el.style.left) };
}

function addAnchor(id: string) {
  const el = document.createElement("div");
  el.setAttribute("data-tutorial-anchor", id);
  document.body.appendChild(el);
}

function drag(handle: Element, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(handle, {
    pointerId: 1,
    button: 0,
    clientX: from[0],
    clientY: from[1],
  });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: to[0],
    clientY: to[1],
  });
  fireEvent.pointerUp(handle, { pointerId: 1 });
}

describe("minimize", () => {
  it("is offered on a step with no anchor, which the old button skipped", async () => {
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [manualStep("a"), manualStep("b")],
    });
    expect(screen.getByRole("button", { name: "Minimize" })).toBeTruthy();
  });

  it("shrinks the card to a bar naming the step, with Next, and the next step opens full size", async () => {
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [manualStep("a"), manualStep("b")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    // Hidden, not removed, so its spoilers keep their state.
    expect(screen.getByText("Body of a.").closest("[hidden]")).not.toBeNull();
    const bar = within(placed());
    expect(bar.getAllByText("Title a").some(visible)).toBe(true);
    expect(bar.getAllByText("1 / 2").some(visible)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Body of b.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show the whole step" })).toBe(
      null,
    );
  });

  it("keeps an opened spoiler open across minimize and restore", async () => {
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [
        manualStep("a", {
          body: [{ kind: "spoiler", label: "Answer", text: "the answer" }],
        }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /Answer/ }));
    expect(screen.getByText("the answer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Show the whole step" }),
    );
    expect(screen.getByText("the answer")).toBeTruthy();
  });

  it("has no Next on a choice step, whose options stand in for it", async () => {
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [
        manualStep("a", {
          choice: {
            options: [
              { track: "x", label: "Use X", help: "x" },
              { track: "y", label: "Use Y", help: "y" },
            ],
          },
        }),
        manualStep("b"),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("parks the bar bottom right", async () => {
    stubLayout();
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [manualStep("a")],
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(positionOf(placed())).toEqual({
      top: VIEW_H - BAR.height - 8,
      left: VIEW_W - BAR.width - 8,
    });
  });

  it("lifts the bar above a spotlight it would cover, the status bar steps' case", async () => {
    addAnchor("status");
    const status = rect(700, VIEW_H - 24, 500, 24);
    stubLayout({ status });
    await renderOverlay({
      id: "t",
      kind: "rms",
      title: "t",
      blurb: "t",
      steps: [manualStep("a", { anchor: { kind: "region", id: "status" } })],
    });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(positionOf(placed()).top).toBe(status.top - 8 - BAR.height);
  });
});

describe("dragging", () => {
  const twoSteps = (
    second: Partial<TutorialStep> = {},
  ): TutorialDefinition => ({
    id: "t",
    kind: "rms",
    title: "t",
    blurb: "t",
    steps: [manualStep("a"), manualStep("b", second)],
  });

  it("moves the card by its header and keeps it there on the next step", async () => {
    stubLayout();
    await renderOverlay(twoSteps());
    // The card starts centred, (1200-300)/2 by (800-200)/2.
    expect(positionOf(placed())).toEqual({ left: 450, top: 300 });
    drag(screen.getByText("1 / 2"), [460, 310], [60, 110]);
    expect(positionOf(placed())).toEqual({ left: 50, top: 100 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(positionOf(placed())).toEqual({ left: 50, top: 100 });
  });

  it("does not start a drag from a button in the header", async () => {
    stubLayout();
    await renderOverlay(twoSteps());
    drag(
      screen.getByRole("button", { name: "Minimize" }),
      [460, 310],
      [60, 110],
    );
    expect(positionOf(placed())).toEqual({ left: 450, top: 300 });
  });

  it("keeps the card on screen however far it is dragged", async () => {
    stubLayout();
    await renderOverlay(twoSteps());
    drag(screen.getByText("1 / 2"), [460, 310], [5000, -5000]);
    expect(positionOf(placed())).toEqual({
      left: VIEW_W - CARD.width - 8,
      top: 8,
    });
  });

  it("gives way on a later step whose spotlight the dropped spot would cover", async () => {
    addAnchor("target");
    stubLayout({ target: rect(40, 90, 100, 40) });
    await renderOverlay(twoSteps({ anchor: { kind: "region", id: "target" } }));
    drag(screen.getByText("1 / 2"), [460, 310], [60, 110]);
    expect(positionOf(placed())).toEqual({ left: 50, top: 100 });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Automatic placement, beside the anchor's right edge.
    expect(positionOf(placed())).toEqual({ left: 148, top: 90 });
  });

  it("moves the bar separately from the card", async () => {
    stubLayout();
    await renderOverlay(twoSteps());
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    drag(
      within(placed()).getAllByText("Title a").find(visible)!,
      [1000, 770],
      [500, 400],
    );
    const barPos = positionOf(placed());
    fireEvent.click(
      screen.getByRole("button", { name: "Show the whole step" }),
    );
    expect(positionOf(placed())).toEqual({ left: 450, top: 300 });
    fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
    expect(positionOf(placed())).toEqual(barPos);
  });

  it("forgets the dropped spot when the tutorial ends, so a restart places it automatically", async () => {
    stubLayout();
    const api = await renderOverlay(twoSteps());
    drag(screen.getByText("1 / 2"), [460, 310], [60, 110]);
    expect(positionOf(placed())).toEqual({ left: 50, top: 100 });
    fireEvent.click(screen.getByRole("button", { name: "Exit tutorial" }));
    act(() => api().start("t"));
    expect(positionOf(placed())).toEqual({ left: 450, top: 300 });
  });
});
