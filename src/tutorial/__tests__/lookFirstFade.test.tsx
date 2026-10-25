// A step's `lookFirst` spotlight (types.ts). It lights the regions it names
// instead of the anchor, and fades away after a delay or at the learner's
// first click or key outside the card, so they can work in the part of the
// app it dimmed. The anchor still places the card.
//
// jsdom lays nothing out, so every box is 0 by 0. The anchors get real
// boxes by stubbing getBoundingClientRect, the way minimizeAndDrag.test.tsx
// does, so a ring can be matched to the region it outlines.

import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialProvider, useTutorial } from "../TutorialContext";
import { LOOK_FIRST_FADE_DELAY_MS, TutorialOverlay } from "../TutorialOverlay";
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

const BOXES: Record<string, DOMRect> = {
  editor: rect(300, 50, 900, 700),
  preview: rect(0, 50, 290, 700),
};

beforeEach(() => {
  storeData.clear();
  storeData.set(WELCOME_SEEN_KEY, true);
  vi.stubGlobal("innerWidth", 1200);
  vi.stubGlobal("innerHeight", 800);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const id = this.getAttribute("data-tutorial-anchor");
      if (id && BOXES[id]) return BOXES[id];
      if (/callout/.test(this.getAttribute("class") ?? ""))
        return rect(0, 0, 300, 200);
      return rect(0, 0, 0, 0);
    },
  );
  for (const id of Object.keys(BOXES)) {
    const el = document.createElement("div");
    el.setAttribute("data-tutorial-anchor", id);
    document.body.appendChild(el);
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function step(id: string, extra: Partial<TutorialStep> = {}): TutorialStep {
  return {
    id,
    title: `Title ${id}`,
    body: [`Body of ${id}.`],
    completion: { kind: "manual" },
    anchor: { kind: "region", id: "editor" },
    ...extra,
  };
}

const LOOK_AT_PREVIEW_FIRST = step("look", {
  lookFirst: [{ kind: "region", id: "preview" }],
});

async function renderOverlay(steps: TutorialStep[]) {
  const definition: TutorialDefinition = {
    id: "fade-test",
    kind: "feature",
    title: "Fade test",
    blurb: "A run for the spotlight fade.",
    steps,
  };
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
  // Fake timers after the store has loaded, since waitFor polls on a real
  // timer, and before the start, which sets the fade timer.
  vi.useFakeTimers();
  act(() => api!.start(definition.id));
  return () => api!;
}

function rings(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[class*="ring"]')];
}

/** The ring's box, to match it against the region it outlines. */
function ringBox(el: HTMLElement) {
  return [el.style.left, el.style.top, el.style.width, el.style.height]
    .map((v) => parseFloat(v))
    .join(",");
}

function boxOf(r: DOMRect) {
  return [r.left, r.top, r.width, r.height].join(",");
}

function faded(): boolean {
  const dim = document.querySelector('svg[class*="dimSvg"]');
  if (!dim) throw new Error("no spotlight on screen");
  // getAttribute, since an SVG element's `className` is an object, not text.
  const all = [dim, ...rings()].map((e) =>
    /spotlightFaded/.test(e.getAttribute("class") ?? ""),
  );
  // The dim and every ring fade together, never one without the other.
  expect(new Set(all).size).toBe(1);
  return all[0];
}

function card(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[class*="callout"]');
  if (!el) throw new Error("no callout on screen");
  return el;
}

describe("a lookFirst step", () => {
  it("lights only the lookFirst regions, not its anchor", async () => {
    await renderOverlay([LOOK_AT_PREVIEW_FIRST]);
    expect(rings().map(ringBox)).toEqual([boxOf(BOXES.preview)]);
    expect(faded()).toBe(false);
  });

  it("fades after the delay and not a moment before", async () => {
    await renderOverlay([LOOK_AT_PREVIEW_FIRST]);
    act(() => vi.advanceTimersByTime(LOOK_FIRST_FADE_DELAY_MS - 1));
    expect(faded()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(faded()).toBe(true);
  });

  it("fades at the first click or key outside the card, and not on the card", async () => {
    await renderOverlay([LOOK_AT_PREVIEW_FIRST]);
    fireEvent.pointerDown(card());
    fireEvent.keyDown(card(), { key: "a" });
    expect(faded()).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(faded()).toBe(true);
  });

  it("fades at a key typed outside the card", async () => {
    await renderOverlay([LOOK_AT_PREVIEW_FIRST]);
    fireEvent.keyDown(document.body, { key: "a" });
    expect(faded()).toBe(true);
  });

  it("shows the spotlight again on the next step and on coming Back", async () => {
    const api = await renderOverlay([LOOK_AT_PREVIEW_FIRST, step("after")]);
    fireEvent.pointerDown(document.body);
    expect(faded()).toBe(true);
    act(() => api().next());
    expect(rings().map(ringBox)).toEqual([boxOf(BOXES.editor)]);
    expect(faded()).toBe(false);
    act(() => api().back());
    expect(faded()).toBe(false);
  });

  it("leaves a step without lookFirst lit however long it stays open", async () => {
    await renderOverlay([step("plain")]);
    act(() => vi.advanceTimersByTime(LOOK_FIRST_FADE_DELAY_MS * 3));
    fireEvent.pointerDown(document.body);
    expect(faded()).toBe(false);
  });
});
