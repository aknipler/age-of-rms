import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  COMPLETED_KEY,
  isCompletedList,
  LAST_SEEN_VERSION_KEY,
  TUTORIAL_STORE_FILE,
  WELCOME_SEEN_KEY,
} from "./tutorialConstants";
import { featureTourForVersion, getTutorial, TUTORIALS } from "./registry";
import type { TutorialDefinition } from "./types";

export type NavigatorKey = "appTab" | "breakdownSection";

interface TutorialValue {
  active: { definition: TutorialDefinition; stepIndex: number } | null;
  start: (id: string) => void;
  next: () => void;
  back: () => void;
  exit: () => void; // abandons; does not mark complete
  welcomeOpen: boolean;
  dismissWelcome: () => void; // marks welcomeSeen, closes
  completed: ReadonlySet<string>;
  registerNavigator: (
    key: NavigatorKey,
    fn: (target: string) => void,
  ) => () => void;
  /**
   * Sec.11, a feature tour whose FIRST step is being shown as a standalone
   * announcement (centred, no spotlight), or null. Distinct from `active`:
   * the announcement isn't a running tutorial yet, just an offer to start
   * one.
   */
  announcement: TutorialDefinition | null;
  /** "Show me" starts the announced tour from its second step. */
  showAnnouncementTour: () => void;
  /** "Not now" dismisses the announcement without starting the tour. */
  dismissAnnouncement: () => void;
  /**
   * The Breakdown section tab the engine last navigated to on the user's
   * behalf, for `StepContext.activeSectionId` (types.ts). No rev-1
   * completion check reads it, it exists so a future one can, and it is
   * only ever set BY a step's own `navigate.section`, not read back from
   * BreakdownPane, so it goes stale the moment the user clicks a different
   * section tab by hand. That's fine: nothing depends on it staying fresh
   * yet.
   */
  activeSectionId: string | null;
}

const TutorialContext = createContext<TutorialValue | null>(null);

interface TutorialProviderProps {
  children: ReactNode;
  /** Testability seam, same reasoning as buildBugReportUrl taking appVersion as an argument (vite-env.d.ts). `define` doesn't run under Vitest. */
  appVersion?: string;
  /** Testability seam, defaults to the real registry so tests can exercise the engine against small fixture definitions instead of the full content. */
  tutorials?: readonly TutorialDefinition[];
}

export function TutorialProvider({
  children,
  appVersion = __APP_VERSION__,
  tutorials = TUTORIALS,
}: TutorialProviderProps) {
  const [active, setActive] = useState<{
    definition: TutorialDefinition;
    stepIndex: number;
  } | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState<TutorialDefinition | null>(
    null,
  );
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [store, setStore] = useState<Store | null>(null);

  // The registry, keyed by the NavigatorKey union, is a ref inside the
  // provider rather than a module-level map, so it can't survive React
  // StrictMode's double-mount in a way that's subtly wrong, and so it has
  // exactly the lifetime a run of the app has (Sec.5.3).
  const navigatorsRef = useRef(
    new Map<NavigatorKey, (target: string) => void>(),
  );

  const registerNavigator = useCallback(
    (key: NavigatorKey, fn: (target: string) => void) => {
      navigatorsRef.current.set(key, fn);
      return () => {
        if (navigatorsRef.current.get(key) === fn)
          navigatorsRef.current.delete(key);
      };
    },
    [],
  );

  // Sec.7.1 (welcome pane) + Sec.11 (feature tour) triggers, both evaluated
  // once on mount from the same store load. The welcome pane wins if both
  // would fire on the same launch (Sec.11), a first run is never also an
  // upgrade, so the version trigger only runs once the profile has already
  // seen the welcome pane.
  useEffect(() => {
    let cancelled = false;
    load(TUTORIAL_STORE_FILE, { autoSave: true, defaults: {} })
      .then(async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);

        const seenWelcome = await loadedStore.get<boolean>(WELCOME_SEEN_KEY);
        const completedRaw = await loadedStore.get<unknown>(COMPLETED_KEY);
        if (cancelled) return;
        setWelcomeOpen(seenWelcome !== true);
        setCompleted(
          new Set(isCompletedList(completedRaw) ? completedRaw : []),
        );

        if (seenWelcome !== true) return;

        const lastSeenVersion = await loadedStore.get<string>(
          LAST_SEEN_VERSION_KEY,
        );
        if (cancelled) return;
        if (lastSeenVersion === undefined) {
          // A fresh install gets the welcome pane, not a changelog for a
          // version it never ran.
          void loadedStore.set(LAST_SEEN_VERSION_KEY, appVersion);
        } else if (lastSeenVersion !== appVersion) {
          const tour = featureTourForVersion(appVersion, tutorials);
          if (tour) setAnnouncement(tour);
          void loadedStore.set(LAST_SEEN_VERSION_KEY, appVersion);
        }
      })
      .catch((error: unknown) => {
        console.error("Failed to load the tutorial store", error);
        // Sec.12, a store that fails to load must not reopen the welcome
        // pane on every launch.
        if (!cancelled) setWelcomeOpen(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appVersion, tutorials]);

  const dismissWelcome = useCallback(() => {
    setWelcomeOpen(false);
    void store?.set(WELCOME_SEEN_KEY, true);
  }, [store]);

  const completeTutorial = useCallback(
    (id: string) => {
      setCompleted((current) => {
        if (current.has(id)) return current;
        const next = new Set(current);
        next.add(id);
        void store?.set(COMPLETED_KEY, [...next]);
        return next;
      });
    },
    [store],
  );

  const start = useCallback(
    (id: string) => {
      const definition = getTutorial(id, tutorials);
      if (!definition) {
        console.error(`No tutorial registered with id "${id}"`);
        return;
      }
      setActive({ definition, stepIndex: 0 });
    },
    [tutorials],
  );

  const next = useCallback(() => {
    setActive((current) => {
      if (!current) return current;
      const { definition, stepIndex } = current;
      if (stepIndex >= definition.steps.length - 1) {
        completeTutorial(definition.id);
        return null;
      }
      return { definition, stepIndex: stepIndex + 1 };
    });
  }, [completeTutorial]);

  const back = useCallback(() => {
    setActive((current) =>
      current && current.stepIndex > 0
        ? { ...current, stepIndex: current.stepIndex - 1 }
        : current,
    );
  }, []);

  const exit = useCallback(() => setActive(null), []);

  const showAnnouncementTour = useCallback(() => {
    setAnnouncement((tour) => {
      if (tour)
        setActive({
          definition: tour,
          stepIndex: Math.min(1, tour.steps.length - 1),
        });
      return null;
    });
  }, []);

  const dismissAnnouncement = useCallback(() => setAnnouncement(null), []);

  // Sec.5.3, a step's `navigate` is applied once when it becomes active.
  // `tab` is applied first; when `section` is ALSO set, it's deferred one
  // frame so BreakdownPane (which unmounts on a top-tab switch) exists by
  // the time the section navigator runs.
  useEffect(() => {
    if (!active) return;
    const step = active.definition.steps[active.stepIndex];
    const nav = step?.navigate;
    if (!nav) return;
    if (nav.tab) navigatorsRef.current.get("appTab")?.(nav.tab);
    if (nav.section) {
      const section = nav.section;
      if (nav.tab) {
        const frame = requestAnimationFrame(() => {
          navigatorsRef.current.get("breakdownSection")?.(section);
          setActiveSectionId(section);
        });
        return () => cancelAnimationFrame(frame);
      }
      navigatorsRef.current.get("breakdownSection")?.(section);
      setActiveSectionId(section);
    }
    return undefined;
    // navigatorsRef is a ref, deliberately excluded. It's mutated by
    // registerNavigator without needing to re-run this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.definition.id, active?.stepIndex]);

  const value = useMemo<TutorialValue>(
    () => ({
      active,
      start,
      next,
      back,
      exit,
      welcomeOpen,
      dismissWelcome,
      completed,
      registerNavigator,
      announcement,
      showAnnouncementTour,
      dismissAnnouncement,
      activeSectionId,
    }),
    [
      active,
      start,
      next,
      back,
      exit,
      welcomeOpen,
      dismissWelcome,
      completed,
      registerNavigator,
      announcement,
      showAnnouncementTour,
      dismissAnnouncement,
      activeSectionId,
    ],
  );

  return (
    <TutorialContext.Provider value={value}>
      {children}
    </TutorialContext.Provider>
  );
}

export function useTutorial(): TutorialValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) {
    throw new Error("useTutorial must be used within a TutorialProvider");
  }
  return ctx;
}

/**
 * Registers a view-state navigator under `key` for as long as the calling
 * component is mounted (Sec.5.3), `AppContent` registers "appTab" ->
 * setActiveTab, `BreakdownPane` registers "breakdownSection" ->
 * setActiveTabId. `fn` is read through a ref so a caller passing a
 * differently-identitied callback on every render (e.g. a useCallback whose
 * deps changed) doesn't churn the registration.
 */
export function useRegisterNavigator(
  key: NavigatorKey,
  fn: (target: string) => void,
): void {
  const { registerNavigator } = useTutorial();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(
    () => registerNavigator(key, (target) => fnRef.current(target)),
    [key, registerNavigator],
  );
}
