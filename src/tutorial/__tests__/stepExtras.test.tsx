// tutorial-islands-design.md Sec.4 and Sec.7, the three engine additions:
// a step image, spoilers, and a pinned preview state. The pinned state is
// tested twice, once against a fake pinner (the engine's own timing rules)
// and once through the real GenerationSettingsProvider and
// PreviewViewProvider (the app's wiring).

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TutorialProvider,
  useRegisterPreviewPinner,
  useTutorial,
} from "../TutorialContext";
import { TutorialOverlay } from "../TutorialOverlay";
import { useAppPreviewPinner } from "../useAppPreviewPinner";
import { TUTORIALS } from "../registry";
import { WELCOME_SEEN_KEY } from "../tutorialConstants";
import type {
  PreviewPinner,
  StepPreviewPin,
  TutorialDefinition,
  TutorialStep,
} from "../types";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import {
  GenerationSettingsProvider,
  useGenerationSettings,
} from "../../generationSettings/GenerationSettingsContext";
import {
  PreviewViewProvider,
  usePreviewView,
} from "../../components/preview/PreviewViewContext";

const { storeData } = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
}));

// Same in-memory stand-in as TutorialContext.test.tsx. Both the tutorial
// store and the generation settings store go through it.
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
    title: id,
    body: [`Body of ${id}.`],
    completion: { kind: "manual" },
    ...extra,
  };
}

function tutorial(id: string, steps: TutorialStep[]): TutorialDefinition {
  return { id, kind: "rms", title: id, blurb: id, steps };
}

// ---------------------------------------------------------------------------
// Pinned preview, the engine's timing against a fake pinner
// ---------------------------------------------------------------------------

describe("pinned preview state, engine timing", () => {
  function fakePinner() {
    const applied: StepPreviewPin[] = [];
    const pinner: PreviewPinner = {
      apply: (pin) => {
        applied.push({ ...pin });
      },
    };
    return { applied, pinner };
  }

  async function mount(tutorials: TutorialDefinition[], pinner: PreviewPinner) {
    const rendered = renderHook(
      () => {
        useRegisterPreviewPinner(pinner);
        return useTutorial();
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <TutorialProvider tutorials={tutorials} appVersion="1.0.0">
            {children}
          </TutorialProvider>
        ),
      },
    );
    await waitFor(() =>
      expect(rendered.result.current.welcomeOpen).toBe(false),
    );
    return rendered;
  }

  const pinning = tutorial("pinning", [
    manualStep("a"),
    manualStep("b", { preview: { seed: 13, mapSize: "Tiny" } }),
    manualStep("c"),
    manualStep("d", { preview: { seed: 21 } }),
  ]);

  it("applies a pin when its step becomes active, and nothing on a step without one", async () => {
    const fake = fakePinner();
    const { result } = await mount([pinning], fake.pinner);
    act(() => result.current.start("pinning"));
    expect(fake.applied).toEqual([]);
    act(() => result.current.next()); // b
    act(() => result.current.next()); // c
    act(() => result.current.next()); // d
    expect(fake.applied).toEqual([{ seed: 13, mapSize: "Tiny" }, { seed: 21 }]);
  });

  it("re-applies the pin when the learner comes Back to a step, so a re-roll is undone", async () => {
    const fake = fakePinner();
    const { result } = await mount([pinning], fake.pinner);
    act(() => result.current.start("pinning"));
    act(() => result.current.next()); // b
    act(() => result.current.next()); // c
    act(() => result.current.back()); // b again
    expect(fake.applied.map((pin) => pin.seed)).toEqual([13, 13]);
  });

  it("does nothing when the tutorial ends, the pinned settings stay", async () => {
    const fake = fakePinner();
    const { result } = await mount([pinning], fake.pinner);
    act(() => result.current.start("pinning"));
    act(() => result.current.next()); // b
    const before = fake.applied.length;
    act(() => result.current.exit());
    expect(fake.applied).toHaveLength(before);
  });

  it("reads a getter seed when the step becomes active, not when the content was defined", async () => {
    const fake = fakePinner();
    let liveSeed = 5;
    const late = tutorial("late", [
      manualStep("a"),
      manualStep("b", {
        preview: {
          get seed() {
            return liveSeed;
          },
        },
      }),
    ]);
    const { result } = await mount([late], fake.pinner);
    act(() => result.current.start("late"));
    liveSeed = 42; // a background check settles after the tutorial started
    act(() => result.current.next());
    expect(fake.applied.map((pin) => pin.seed)).toEqual([42]);
  });
});

// ---------------------------------------------------------------------------
// Pinned preview, through the real providers
// ---------------------------------------------------------------------------

describe("pinned preview state, app wiring", () => {
  it("pins the seed, the 1v1 preset and Tiny, keeps the preset on through repeat pins, and leaves them set after exit", async () => {
    const pinned = tutorial("pinned", [
      manualStep("a", {
        preview: { seed: 13, teamPreset: "1v1", mapSize: "Tiny" },
      }),
      manualStep("b", { preview: { teamPreset: "1v1" } }),
    ]);

    const { result } = renderHook(
      () => {
        useAppPreviewPinner();
        return {
          tutorial: useTutorial(),
          settings: useGenerationSettings(),
          view: usePreviewView(),
        };
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <GenerationSettingsProvider>
            <PreviewViewProvider>
              <TutorialProvider tutorials={[pinned]} appVersion="1.0.0">
                {children}
              </TutorialProvider>
            </PreviewViewProvider>
          </GenerationSettingsProvider>
        ),
      },
    );
    await waitFor(() =>
      expect(result.current.tutorial.welcomeOpen).toBe(false),
    );

    act(() => result.current.settings.setPlayerCount(5));
    act(() => result.current.view.setSeed(777));

    act(() => result.current.tutorial.start("pinned"));
    expect(result.current.view.seed).toBe(13);
    expect(result.current.settings.mapSize).toBe("Tiny");
    expect(result.current.settings.activePreset).toBe("1v1");
    expect(result.current.settings.playerCount).toBe(2);

    // Pinning the same preset again must not toggle it off.
    act(() => result.current.tutorial.next());
    expect(result.current.settings.activePreset).toBe("1v1");

    act(() => result.current.tutorial.exit());
    expect(result.current.view.seed).toBe(13);
    expect(result.current.settings.mapSize).toBe("Tiny");
    expect(result.current.settings.activePreset).toBe("1v1");

    // The learner's hand-built lobby is still in the stash, so pressing the
    // 1v1 button afterwards brings it back, as it would after any preset.
    act(() => result.current.settings.toggleTeamPreset("1v1"));
    expect(result.current.settings.playerCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Body blocks, images and spoilers, in the overlay
// ---------------------------------------------------------------------------

describe("step body blocks", () => {
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

  /** True when `a` comes before `b` in document order. */
  function precedes(a: Node, b: Node): boolean {
    return (
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
  }

  it("renders every block kind in the order the body lists them", async () => {
    await renderOverlay(
      tutorial("ordered", [
        manualStep("a", {
          body: [
            "Para one.",
            { kind: "image", src: "/x.png", alt: "pic" },
            ["Para ", "two."],
            { kind: "spoiler", label: "Open me", text: "hidden" },
            "Para three.",
          ],
        }),
      ]),
    );
    const order = [
      screen.getByText("Para one."),
      screen.getByAltText("pic"),
      screen.getByText("Para two."),
      screen.getByRole("button", { name: /Open me/ }),
      screen.getByText("Para three."),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(precedes(order[i - 1]!, order[i]!)).toBe(true);
    }
  });

  it("aligns a text block and leaves a plain string paragraph alone", async () => {
    await renderOverlay(
      tutorial("aligned", [
        manualStep("a", {
          body: [
            "Plain.",
            { kind: "text", text: "On the right.", align: "right" },
            { kind: "text", text: "In the middle.", align: "center" },
          ],
        }),
      ]),
    );
    expect(screen.getByText("Plain.").style.textAlign).toBe("");
    expect(screen.getByText("On the right.").style.textAlign).toBe("right");
    expect(screen.getByText("In the middle.").style.textAlign).toBe("center");
  });

  it("keeps an inline spoiler's words out of the page until it is clicked, then shows them in the sentence", async () => {
    await renderOverlay(
      tutorial("inline", [
        manualStep("a", {
          body: [
            [
              "A value between 10 and 14 works, we pick ",
              { spoiler: "12" },
              ".",
            ],
          ],
        }),
      ]),
    );
    // Not merely masked. The words must be absent, or a screen reader,
    // a text selection or find in page would give the answer away.
    expect(screen.queryByText("12")).toBeNull();
    expect(document.body.textContent).not.toContain("pick 12");

    fireEvent.click(
      screen.getByRole("button", { name: "Hidden text, click to show" }),
    );
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("12").closest("p")?.textContent).toBe(
      "A value between 10 and 14 works, we pick 12.",
    );
    expect(
      screen.queryByRole("button", { name: "Hidden text, click to show" }),
    ).toBeNull();
  });

  it("draws a masked number as wide as its mask, so one digit and two digits look alike", async () => {
    await renderOverlay(
      tutorial("masked", [
        manualStep("a", {
          body: [
            [
              "Between ",
              { spoiler: "8", maskAs: "0000" },
              " and ",
              { spoiler: "11", maskAs: "0000" },
              ".",
            ],
          ],
        }),
      ]),
    );
    const buttons = screen.getAllByRole("button", {
      name: "Hidden text, click to show",
    });
    // jsdom has no canvas, so the bars fall back to a width in `ch` taken from
    // the text the mask is drawn as. Both come from "0000", not from "8" or "11".
    const widths = buttons.map(
      (b) => (b.querySelector("span") as HTMLElement).style.width,
    );
    expect(widths).toEqual(["4ch", "4ch"]);

    fireEvent.click(buttons[0]!);
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("opens and shuts a block spoiler", async () => {
    await renderOverlay(
      tutorial("block", [
        manualStep("a", {
          body: [
            "Intro.",
            { kind: "spoiler", label: "Show the answer", text: "The answer." },
          ],
        }),
      ]),
    );
    const toggle = screen.getByRole("button", { name: /Show the answer/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("The answer.")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("The answer.")).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.queryByText("The answer.")).toBeNull();
  });

  it("opens a block spoiler of several paragraphs whose own hidden words stay hidden until clicked, and leaves them shown on reopening", async () => {
    await renderOverlay(
      tutorial("ladder", [
        manualStep("a", {
          body: [
            {
              kind: "spoiler",
              label: "Notice something?",
              paragraphs: [
                "First question.",
                ["Hint 1: ", { spoiler: "Look left." }],
                "Second question.",
              ],
            },
          ],
        }),
      ]),
    );
    const toggle = screen.getByRole("button", { name: /Notice something/ });
    expect(screen.queryByText("First question.")).toBeNull();
    fireEvent.click(toggle);
    const first = screen.getByText("First question.");
    const second = screen.getByText("Second question.");
    expect(precedes(first, second)).toBe(true);
    // Open, but the hint inside is a spoiler of its own.
    expect(screen.queryByText("Look left.")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Hidden text, click to show" }),
    );
    expect(screen.getByText("Look left.").closest("p")?.textContent).toBe(
      "Hint 1: Look left.",
    );
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByText("Look left.")).toBeTruthy();
  });

  it("hides an inline spoiler again on one click of its words", async () => {
    await renderOverlay(
      tutorial("rehide", [
        manualStep("a", { body: [["We pick ", { spoiler: "12" }, "."]] }),
      ]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hidden text, click to show" }),
    );
    fireEvent.click(screen.getByText("12"));
    expect(screen.queryByText("12")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Hidden text, click to show" }),
    ).toBeTruthy();
  });

  it("keeps a step's opened spoilers open on coming back, and starts the next step with its own hidden", async () => {
    // Both steps have both kinds at the same positions, so state shared
    // between the steps would show. The memory is keyed by step.
    const body = (answer: string) => [
      ["We pick ", { spoiler: answer }, "."],
      { kind: "spoiler" as const, label: "Why", text: `Because ${answer}.` },
    ];
    const api = await renderOverlay(
      tutorial("remember", [
        manualStep("a", { body: body("12") }),
        manualStep("b", { body: body("20") }),
      ]),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hidden text, click to show" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Why/ }));
    expect(screen.getByText("Because 12.")).toBeTruthy();

    act(() => api().next());
    expect(screen.queryByText("20")).toBeNull();
    expect(screen.queryByText("Because 20.")).toBeNull();

    act(() => api().back());
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("Because 12.")).toBeTruthy();
  });

  it("forgets a closed spoiler, and every spoiler once the run ends", async () => {
    const definition = tutorial("forget", [
      manualStep("a", {
        body: [{ kind: "spoiler", label: "Why", text: "Because." }],
      }),
      manualStep("b", { body: ["Second."] }),
    ]);
    const api = await renderOverlay(definition);
    const why = () => screen.getByRole("button", { name: /Why/ });
    fireEvent.click(why());
    fireEvent.click(why());
    act(() => api().next());
    act(() => api().back());
    expect(screen.queryByText("Because.")).toBeNull();

    fireEvent.click(why());
    act(() => api().exit());
    act(() => api().start(definition.id));
    expect(screen.queryByText("Because.")).toBeNull();
  });

  it.each([
    ["top", "1 / 1", "Step"],
    [undefined, "1 / 1", "Step"],
    ["bottom", "Last para.", "Next"],
  ] as const)(
    "places a step image with placement %s between %s and %s",
    async (placement, before, after) => {
      await renderOverlay(
        tutorial("placed", [
          manualStep("a", {
            title: "Step",
            body: ["First para.", "Last para."],
            image: { src: "/x.png", alt: "pic", placement },
          }),
        ]),
      );
      const image = screen.getByAltText("pic");
      const find = (label: string) =>
        label === "Step"
          ? screen.getByRole("heading")
          : label === "Next"
            ? screen.getByRole("button", { name: "Finish" })
            : screen.getByText(label);
      expect(precedes(find(before), image)).toBe(true);
      expect(precedes(image, find(after === "Next" ? "Next" : after))).toBe(
        true,
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Content guard
// ---------------------------------------------------------------------------

describe("registered tutorial images", () => {
  // Sec.4.1, images live in public/. A typo in `src` would render as a
  // broken image with only the alt text showing, which nothing else catches.
  // Both places an image can be named are read, the step's own `image` and
  // every image block in its body.
  it("every step image points at a file that exists under public/", () => {
    const publicDir = join(__dirname, "..", "..", "..", "public");
    const sources = TUTORIALS.flatMap((definition) =>
      definition.steps.flatMap((step) => [
        ...(step.image ? [step.image.src] : []),
        ...step.body.flatMap((block) =>
          typeof block === "object" &&
          !Array.isArray(block) &&
          block.kind === "image"
            ? [block.src]
            : [],
        ),
      ]),
    );
    const missing = sources.filter((src) => !existsSync(join(publicDir, src)));
    expect(missing).toEqual([]);
  });
});
