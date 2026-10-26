// The remembered start tab. @tauri-apps/plugin-store is mocked with an
// in-memory Map, as TutorialContext.test.tsx does, and `load` resolves only
// when a test says so, so a tab picked during the load can be tested.

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isEditorTab,
  LAST_EDITOR_TAB_KEY,
  useRememberedTab,
} from "../useRememberedTab";

const { storeData, storeSets, pendingLoads } = vi.hoisted(() => ({
  storeData: new Map<string, unknown>(),
  storeSets: [] as { key: string; value: unknown }[],
  pendingLoads: [] as (() => void)[],
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(
    () =>
      new Promise((resolve) => {
        pendingLoads.push(() =>
          resolve({
            // A timer, not an immediate value. The real get is an IPC round
            // trip, so React renders before it answers, and a test whose get
            // answered in the same microtask would batch that render away.
            get: (key: string) =>
              new Promise((r) => setTimeout(() => r(storeData.get(key)), 0)),
            set: async (key: string, value: unknown) => {
              storeData.set(key, value);
              storeSets.push({ key, value });
            },
          }),
        );
      }),
  ),
}));

async function finishLoad() {
  await act(async () => {
    for (const resolve of pendingLoads.splice(0)) resolve();
  });
}

beforeEach(() => {
  storeData.clear();
  storeSets.length = 0;
  pendingLoads.length = 0;
});

afterEach(cleanup);

describe("isEditorTab", () => {
  it("accepts the two editor tabs only", () => {
    expect(isEditorTab("breakdown")).toBe(true);
    expect(isEditorTab("code")).toBe(true);
    expect(isEditorTab("advanced-tools")).toBe(false);
    expect(isEditorTab("Code")).toBe(false);
    expect(isEditorTab(undefined)).toBe(false);
  });
});

describe("useRememberedTab", () => {
  it("opens on Breakdown when nothing is remembered", async () => {
    const { result } = renderHook(() => useRememberedTab());
    await finishLoad();
    expect(result.current[0]).toBe("breakdown");
  });

  it("opens on Code when Code was used last", async () => {
    storeData.set(LAST_EDITOR_TAB_KEY, "code");
    const { result } = renderHook(() => useRememberedTab());
    expect(result.current[0]).toBe("breakdown");
    await finishLoad();
    await waitFor(() => expect(result.current[0]).toBe("code"));
  });

  it("ignores a remembered value that is not an editor tab", async () => {
    storeData.set(LAST_EDITOR_TAB_KEY, "advanced-tools");
    const { result } = renderHook(() => useRememberedTab());
    await finishLoad();
    expect(result.current[0]).toBe("breakdown");
  });

  it("never writes the default over the remembered tab before the load", async () => {
    storeData.set(LAST_EDITOR_TAB_KEY, "code");
    renderHook(() => useRememberedTab());
    expect(storeSets).toEqual([]);
    await finishLoad();
    await waitFor(() =>
      expect(storeData.get(LAST_EDITOR_TAB_KEY)).toBe("code"),
    );
    expect(storeSets.some((s) => s.value === "breakdown")).toBe(false);
  });

  it("keeps a tab picked while the store is still loading", async () => {
    storeData.set(LAST_EDITOR_TAB_KEY, "breakdown");
    const { result } = renderHook(() => useRememberedTab());
    act(() => result.current[1]("code"));
    await finishLoad();
    expect(result.current[0]).toBe("code");
    await waitFor(() =>
      expect(storeData.get(LAST_EDITOR_TAB_KEY)).toBe("code"),
    );
  });

  it("remembers the last editor tab, not Advanced Tools", async () => {
    const { result } = renderHook(() => useRememberedTab());
    await finishLoad();
    act(() => result.current[1]("code"));
    await waitFor(() =>
      expect(storeData.get(LAST_EDITOR_TAB_KEY)).toBe("code"),
    );
    act(() => result.current[1]("advanced-tools"));
    expect(result.current[0]).toBe("advanced-tools");
    expect(storeData.get(LAST_EDITOR_TAB_KEY)).toBe("code");
  });

  it("keeps one setter identity across renders", async () => {
    const { result, rerender } = renderHook(() => useRememberedTab());
    const first = result.current[1];
    rerender();
    await finishLoad();
    expect(result.current[1]).toBe(first);
  });
});
