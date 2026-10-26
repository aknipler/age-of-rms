// Phase 2.5, mirrors src/help/HelpSettingsContext.tsx's pattern exactly:
// load the persisted store once on mount, read initial values, and every
// setter both updates local state AND writes back to the store.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { load, type Store } from "@tauri-apps/plugin-store";
import {
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_COUNT,
  DEFAULT_TEAM_POSITIONS,
  DEFAULT_TEAMS,
  findTeamPreset,
  GENERATION_SETTINGS_STORE_FILE,
  isMapSize,
  isPlayerCount,
  isTeams,
  MAP_SIZE_KEY,
  PLAYER_COUNT_KEY,
  TEAM_POSITIONS_KEY,
  TEAM_PRESET_KEY,
  TEAM_STASH_KEY,
  TEAMS_KEY,
  type MapSize,
  type TeamNumber,
} from "./generationSettingsConstants";

/**
 * What a preset displaced when it was activated, so deselecting it can put
 * things back (Sec.15 item 4's UI contract). Persisted alongside the preset
 * id so the toggle survives an app restart, a stash that only lived in
 * memory would make "press again to restore" silently lossy across sessions.
 */
interface TeamStash {
  teams: TeamNumber[];
  playerCount: number;
}

function isTeamStash(value: unknown): value is TeamStash {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TeamStash>;
  return isTeams(candidate.teams) && isPlayerCount(candidate.playerCount);
}

interface GenerationSettingsValue {
  playerCount: number;
  setPlayerCount: (count: number) => void;
  mapSize: MapSize;
  setMapSize: (size: MapSize) => void;
  /** Selected team per player, always length 8, indexed player - 1. */
  teams: readonly TeamNumber[];
  setPlayerTeam: (playerIndex: number, team: TeamNumber) => void;
  /** id of the active preset, or null when the lobby is hand-configured. */
  activePreset: string | null;
  /** Applies a preset, or deselects it and restores the stash if it's active. */
  toggleTeamPreset: (presetId: string) => void;
  /**
   * Applies a preset and does nothing if it is already active. A tutorial
   * that pins a preset on several steps needs this, since calling the
   * toggle a second time would switch the preset off.
   */
  selectTeamPreset: (presetId: string) => void;
  /** True while a preset owns the team assignments. */
  teamsLocked: boolean;
  /** True while a preset also owns the player count (every preset but FFA). */
  playerCountLocked: boolean;
  /**
   * The lobby's Team Positions box (preview-design Sec.6.1, rev 9). It changes
   * how the game places players, and it defines the TEAM_POSITIONS label.
   * Independent of the team presets, which only assign teams, so pressing a
   * preset never changes it.
   */
  teamPositions: boolean;
  setTeamPositions: (on: boolean) => void;
  /**
   * Whether the settings box over the map preview is open
   * (GenerationSettingsPanel). Lives here rather than as local state in the
   * preview because two places outside it flip the flag, the Generation
   * Settings hotkey in App.tsx and the cog on the map, and neither can hand
   * the other a callback. Ephemeral, not persisted: unlike the rest of this
   * context, there is no reason a closed box should reopen on the next
   * launch. The "Dialog" in the names predates the box moving onto the map.
   */
  isDialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  toggleDialog: () => void;
}

const GenerationSettingsContext = createContext<GenerationSettingsValue | null>(
  null,
);

export function GenerationSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [playerCount, setPlayerCountState] =
    useState<number>(DEFAULT_PLAYER_COUNT);
  const [mapSize, setMapSizeState] = useState<MapSize>(DEFAULT_MAP_SIZE);
  const [teams, setTeamsState] = useState<readonly TeamNumber[]>(DEFAULT_TEAMS);
  const [activePreset, setActivePresetState] = useState<string | null>(null);
  const [stash, setStashState] = useState<TeamStash | null>(null);
  const [teamPositions, setTeamPositionsState] = useState<boolean>(
    DEFAULT_TEAM_POSITIONS,
  );
  const [store, setStore] = useState<Store | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const openDialog = useCallback(() => setIsDialogOpen(true), []);
  const closeDialog = useCallback(() => setIsDialogOpen(false), []);
  const toggleDialog = useCallback(() => setIsDialogOpen((open) => !open), []);

  useEffect(() => {
    let cancelled = false;
    load(GENERATION_SETTINGS_STORE_FILE, { autoSave: true, defaults: {} }).then(
      async (loadedStore) => {
        if (cancelled) return;
        setStore(loadedStore);
        const savedPlayerCount =
          await loadedStore.get<number>(PLAYER_COUNT_KEY);
        if (!cancelled && isPlayerCount(savedPlayerCount)) {
          setPlayerCountState(savedPlayerCount);
        }
        const savedMapSize = await loadedStore.get<string>(MAP_SIZE_KEY);
        if (!cancelled && isMapSize(savedMapSize)) {
          setMapSizeState(savedMapSize);
        }
        const savedTeams = await loadedStore.get<unknown>(TEAMS_KEY);
        if (!cancelled && isTeams(savedTeams)) {
          setTeamsState(savedTeams);
        }
        // Validate the preset id against the table rather than trusting the
        // store: a renamed or removed preset would otherwise leave the UI
        // permanently locked with no button able to unlock it.
        const savedPreset = await loadedStore.get<string>(TEAM_PRESET_KEY);
        if (!cancelled && findTeamPreset(savedPreset)) {
          setActivePresetState(savedPreset ?? null);
        }
        const savedStash = await loadedStore.get<unknown>(TEAM_STASH_KEY);
        if (!cancelled && isTeamStash(savedStash)) {
          setStashState(savedStash);
        }
        // A typeof check rather than a truthiness test, since false is a
        // real saved answer and an absent key must keep the default.
        const savedPositions =
          await loadedStore.get<unknown>(TEAM_POSITIONS_KEY);
        if (!cancelled && typeof savedPositions === "boolean") {
          setTeamPositionsState(savedPositions);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const setPlayerCount = useCallback(
    (next: number) => {
      setPlayerCountState(next);
      void store?.set(PLAYER_COUNT_KEY, next);
      // Typing a count directly is a deliberate override, not a way to
      // edit the active preset's own count (only FFA leaves this callback
      // reachable while unlocked; every other preset asserts a specific
      // count, so a change here can only mean "I want something else").
      // Clears the preset the same way pressing its own button again
      // does, restoring whatever teams it had displaced, except the
      // player count keeps the just-typed value rather than snapping back
      // to the stash's.
      if (activePreset !== null) {
        const restoredTeams = stash?.teams ?? teams;
        setTeamsState(restoredTeams);
        setActivePresetState(null);
        setStashState(null);
        void store?.set(TEAMS_KEY, restoredTeams);
        void store?.set(TEAM_PRESET_KEY, null);
        void store?.set(TEAM_STASH_KEY, null);
      }
    },
    [store, activePreset, stash, teams],
  );

  const setMapSize = useCallback(
    (next: MapSize) => {
      setMapSizeState(next);
      void store?.set(MAP_SIZE_KEY, next);
    },
    [store],
  );

  const setTeamPositions = useCallback(
    (on: boolean) => {
      setTeamPositionsState(on);
      void store?.set(TEAM_POSITIONS_KEY, on);
    },
    [store],
  );

  const setPlayerTeam = useCallback(
    (playerIndex: number, team: TeamNumber) => {
      // Functional update, not `teams[i] = team` on the captured array: the
      // team button can fire twice before React re-renders (fast clicking, or
      // StrictMode's double-invoke in dev), and reading `teams` from the
      // closure would make the second write clobber the first. Same stale-
      // closure hazard useDocument.ts documents.
      setTeamsState((current) => {
        const next = current.map((value, index) =>
          index === playerIndex ? team : value,
        );
        void store?.set(TEAMS_KEY, next);
        return next;
      });
    },
    [store],
  );

  // Shared by both actions that rewrite the lobby as a whole, the preset
  // toggle and the tutorial's idempotent select.
  const persist = useCallback(
    (
      nextTeams: readonly TeamNumber[],
      nextPlayerCount: number,
      nextPreset: string | null,
      nextStash: TeamStash | null,
    ) => {
      setTeamsState(nextTeams);
      setPlayerCountState(nextPlayerCount);
      setActivePresetState(nextPreset);
      setStashState(nextStash);
      void store?.set(TEAMS_KEY, nextTeams);
      void store?.set(PLAYER_COUNT_KEY, nextPlayerCount);
      void store?.set(TEAM_PRESET_KEY, nextPreset);
      void store?.set(TEAM_STASH_KEY, nextStash);
    },
    [store],
  );

  const selectTeamPreset = useCallback(
    (presetId: string) => {
      const preset = findTeamPreset(presetId);
      if (!preset || activePreset === presetId) return;
      // Same stash rule as the toggle below. Only a hand-built lobby is
      // stashed, never another preset's layout.
      const nextStash =
        activePreset === null ? { teams: [...teams], playerCount } : stash;
      persist(
        preset.teams,
        preset.playerCount ?? playerCount,
        presetId,
        nextStash,
      );
    },
    [activePreset, persist, playerCount, stash, teams],
  );

  const toggleTeamPreset = useCallback(
    (presetId: string) => {
      const preset = findTeamPreset(presetId);
      if (!preset) return;

      if (activePreset === presetId) {
        // Pressing the active preset deselects it and restores what it
        // displaced. Falling back to the current values when the stash is
        // missing keeps this a no-op rather than a wipe.
        persist(
          stash?.teams ?? teams,
          stash?.playerCount ?? playerCount,
          null,
          null,
        );
        return;
      }

      selectTeamPreset(presetId);
    },
    [activePreset, persist, playerCount, selectTeamPreset, stash, teams],
  );

  const activePresetDef = findTeamPreset(activePreset);

  const value = useMemo<GenerationSettingsValue>(
    () => ({
      playerCount,
      setPlayerCount,
      mapSize,
      setMapSize,
      teams,
      setPlayerTeam,
      activePreset,
      toggleTeamPreset,
      selectTeamPreset,
      teamsLocked: activePresetDef !== undefined,
      playerCountLocked: activePresetDef?.playerCount != null,
      teamPositions,
      setTeamPositions,
      isDialogOpen,
      openDialog,
      closeDialog,
      toggleDialog,
    }),
    [
      playerCount,
      setPlayerCount,
      mapSize,
      setMapSize,
      teams,
      setPlayerTeam,
      activePreset,
      toggleTeamPreset,
      selectTeamPreset,
      activePresetDef,
      teamPositions,
      setTeamPositions,
      isDialogOpen,
      openDialog,
      closeDialog,
      toggleDialog,
    ],
  );

  return (
    <GenerationSettingsContext.Provider value={value}>
      {children}
    </GenerationSettingsContext.Provider>
  );
}

export function useGenerationSettings(): GenerationSettingsValue {
  const ctx = useContext(GenerationSettingsContext);
  if (!ctx) {
    throw new Error(
      "useGenerationSettings must be used within a GenerationSettingsProvider",
    );
  }
  return ctx;
}
