// tutorial-design.md Sec.13 item 4. The project's first React-rendering
// test file (no other *.test.tsx exists yet), @testing-library/react and
// @testing-library/dom were added as dev dependencies for it (`npm
// install`), same as any new dependency per CLAUDE.md.
//
// @tauri-apps/plugin-store is mocked with a tiny in-memory Map standing in
// for the on-disk store, since no prior test in this repo mocks it to copy
// from.

import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TutorialProvider, useTutorial } from "../TutorialContext";
import { TutorialOverlay } from "../TutorialOverlay";
import { HelpSettingsProvider } from "../../help/HelpSettingsContext";
import { COMPLETED_KEY, LAST_SEEN_VERSION_KEY, WELCOME_SEEN_KEY } from "../tutorialConstants";
import type { TutorialDefinition } from "../types";
import type { ReactNode } from "react";

const { storeData, storeSets } = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
  storeSets: [] as { key: string; value: unknown }[],
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async (key: string) => storeData.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      storeData.set(key, value);
      storeSets.push({ key, value });
    }),
  })),
}));

beforeEach(() => {
  storeData.clear();
  storeSets.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fixtureTutorial: TutorialDefinition = {
  id: "fixture",
  kind: "app",
  title: "Fixture Tutorial",
  blurb: "A tiny tutorial for testing the engine.",
  steps: [
    { id: "step-a", title: "Step A", body: ["First step."], completion: { kind: "manual" } },
    {
      id: "step-b",
      title: "Step B",
      body: ["A step gated on hasFile."],
      completion: { kind: "check", test: (ctx) => ctx.hasFile },
    },
    { id: "step-c", title: "Step C", body: ["Last step."], completion: { kind: "manual" } },
  ],
};

function wrapperFor(tutorials: readonly TutorialDefinition[], appVersion = "1.0.0") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TutorialProvider tutorials={tutorials} appVersion={appVersion}>
        {children}
      </TutorialProvider>
    );
  };
}

async function seedWelcomed(store: Map<string, unknown> = storeData) {
  store.set(WELCOME_SEEN_KEY, true);
}

describe("TutorialProvider — start / next / back / exit", () => {
  it("start() begins at step 0, next()/back() move the index, exit() clears it without completing", async () => {
    await seedWelcomed();
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([fixtureTutorial]) });
    await waitFor(() => expect(result.current.welcomeOpen).toBe(false));

    act(() => result.current.start("fixture"));
    expect(result.current.active).toEqual({ definition: fixtureTutorial, stepIndex: 0 });

    act(() => result.current.next());
    expect(result.current.active?.stepIndex).toBe(1);

    act(() => result.current.back());
    expect(result.current.active?.stepIndex).toBe(0);

    // Back is a no-op on step 0, not an error.
    act(() => result.current.back());
    expect(result.current.active?.stepIndex).toBe(0);

    act(() => result.current.exit());
    expect(result.current.active).toBeNull();
    expect(result.current.completed.has("fixture")).toBe(false);
  });

  it("next() advances past an unsatisfied check step (Sec.2.2 — Next always works)", async () => {
    await seedWelcomed();
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([fixtureTutorial]) });
    await waitFor(() => expect(result.current.welcomeOpen).toBe(false));

    act(() => result.current.start("fixture"));
    act(() => result.current.next()); // now on step-b, an unsatisfied check (hasFile is never asked here)
    expect(result.current.active?.stepIndex).toBe(1);
    act(() => result.current.next());
    expect(result.current.active?.stepIndex).toBe(2);
  });

  it("advancing past the last step completes the tutorial and persists it", async () => {
    await seedWelcomed();
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([fixtureTutorial]) });
    await waitFor(() => expect(result.current.welcomeOpen).toBe(false));

    act(() => result.current.start("fixture"));
    act(() => result.current.next());
    act(() => result.current.next());
    expect(result.current.active?.stepIndex).toBe(2);

    act(() => result.current.next()); // past the last step
    expect(result.current.active).toBeNull();
    expect(result.current.completed.has("fixture")).toBe(true);
    expect(storeSets).toContainEqual({ key: COMPLETED_KEY, value: ["fixture"] });
  });
});

describe("TutorialOverlay — a check step's arrival-vs-transition tick behaviour (Sec.5.5)", () => {
  // Fake timers are installed only AFTER the store finishes loading (below),
  // the store mock resolves over real microtasks via testing-library's
  // real-timer `waitFor`, and only the auto-advance pause (AUTO_ADVANCE_DELAY_MS)
  // needs to be fast-forwarded.

  it("a step already satisfied on arrival renders ticked and does NOT auto-advance", async () => {
    await seedWelcomed();
    let api: ReturnType<typeof useTutorial> | null = null;
    function Capture() {
      api = useTutorial();
      return null;
    }
    render(
      <HelpSettingsProvider>
        <TutorialProvider tutorials={[fixtureTutorial]} appVersion="1.0.0">
          <Capture />
          <TutorialOverlay hasFile={true} activeTab="breakdown" applyTextEdits={() => {}} />
        </TutorialProvider>
      </HelpSettingsProvider>,
    );
    await waitFor(() => expect(api?.welcomeOpen).toBe(false));

    vi.useFakeTimers();
    try {
      // hasFile is already true, so step-b's check is satisfied the moment it becomes active.
      act(() => api!.start("fixture"));
      act(() => api!.next()); // land on step-b, already satisfied
      expect(api!.active?.stepIndex).toBe(1);
      expect(screen.getByLabelText("done")).toBeTruthy();

      act(() => vi.advanceTimersByTime(2000));
      // Still on step-b, no auto-advance for a step that arrived already done.
      expect(api!.active?.stepIndex).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a check that becomes satisfied WHILE active auto-advances after the pause", async () => {
    await seedWelcomed();
    let api: ReturnType<typeof useTutorial> | null = null;
    let hasFile = false;
    function Capture() {
      api = useTutorial();
      return null;
    }
    function Harness() {
      return (
        <HelpSettingsProvider>
          <TutorialProvider tutorials={[fixtureTutorial]} appVersion="1.0.0">
            <Capture />
            <TutorialOverlay hasFile={hasFile} activeTab="breakdown" applyTextEdits={() => {}} />
          </TutorialProvider>
        </HelpSettingsProvider>
      );
    }
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(api?.welcomeOpen).toBe(false));

    vi.useFakeTimers();
    try {
      act(() => api!.start("fixture"));
      act(() => api!.next()); // land on step-b while hasFile is false, arrives UNsatisfied
      expect(api!.active?.stepIndex).toBe(1);
      expect(screen.queryByLabelText("done")).toBeNull();

      // Now the user does the thing (opens a file), the step transitions to satisfied.
      hasFile = true;
      act(() => rerender(<Harness />));
      expect(screen.getByLabelText("done")).toBeTruthy();

      act(() => vi.advanceTimersByTime(2000));
      expect(api!.active?.stepIndex).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TutorialProvider — welcome-versus-upgrade precedence (Sec.11)", () => {
  const featureTour: TutorialDefinition = {
    id: "whats-new-0.4.0",
    kind: "feature",
    version: "0.4.0",
    title: "What's new in 0.4",
    blurb: "New stuff.",
    steps: [{ id: "announce", title: "New in 0.4", body: ["Some new controls."], completion: { kind: "manual" } }],
  };

  it("a fresh profile (welcome unseen) shows the welcome pane and never fires the version trigger", async () => {
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([featureTour], "0.4.0") });
    await waitFor(() => expect(result.current.welcomeOpen).toBe(true));
    expect(result.current.announcement).toBeNull();
    // The version key must not have been written either, Sec.11 step 2
    // only applies once welcome has already been seen.
    expect(storeData.has(LAST_SEEN_VERSION_KEY)).toBe(false);
  });

  it("an already-welcomed profile with no recorded version just records the current one (no changelog for a version it never ran)", async () => {
    await seedWelcomed();
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([featureTour], "0.4.0") });
    await waitFor(() => expect(result.current.welcomeOpen).toBe(false));
    await waitFor(() => expect(storeData.get(LAST_SEEN_VERSION_KEY)).toBe("0.4.0"));
    expect(result.current.announcement).toBeNull();
  });

  it("an already-welcomed profile on an older recorded version sees the matching feature tour as an announcement", async () => {
    await seedWelcomed();
    storeData.set(LAST_SEEN_VERSION_KEY, "0.3.0");
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([featureTour], "0.4.0") });
    await waitFor(() => expect(result.current.announcement?.id).toBe("whats-new-0.4.0"));
    await waitFor(() => expect(storeData.get(LAST_SEEN_VERSION_KEY)).toBe("0.4.0"));
  });

  it('showAnnouncementTour() starts the tour from its second step; dismissAnnouncement() just clears it', async () => {
    await seedWelcomed();
    storeData.set(LAST_SEEN_VERSION_KEY, "0.3.0");
    const tourWithSpotlight: TutorialDefinition = {
      ...featureTour,
      steps: [...featureTour.steps, { id: "spotlight", title: "New control", body: ["Look here."], completion: { kind: "manual" } }],
    };
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([tourWithSpotlight], "0.4.0") });
    await waitFor(() => expect(result.current.announcement).not.toBeNull());

    act(() => result.current.showAnnouncementTour());
    expect(result.current.announcement).toBeNull();
    expect(result.current.active).toEqual({ definition: tourWithSpotlight, stepIndex: 1 });
  });

  it("a store that fails to load behaves as though nothing was seen, except welcomeOpen stays false", async () => {
    const { load } = await import("@tauri-apps/plugin-store");
    vi.mocked(load).mockRejectedValueOnce(new Error("disk on fire"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useTutorial(), { wrapper: wrapperFor([featureTour], "0.4.0") });
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    expect(result.current.welcomeOpen).toBe(false);
    errorSpy.mockRestore();
  });
});
