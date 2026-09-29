// The Land Placement panel's own model store (land-placement-design.md
// Sec.3.6(b)): "the panel's model must survive a tab switch, and today's
// pane cannot do it." Lifted above `activeTab` (App.tsx wires this provider
// in alongside `ToolHostProvider`) for the same reason `ToolHostContext.tsx`
// lifts `ToolHost` itself. `ToolsPane` unmounts on every tab switch, and
// anything owned INSIDE it dies with it.
//
// Parallel to `ToolHost`'s own `PanelState`, not a replacement for it:
// `PanelState` (host.ts) is the generic mount/suspend/dirty LIFECYCLE any
// panel tool would need; this store is Land Placement's own PAYLOAD, the
// actual `AlpModel` graph and the canvas selection. Kept apart so `host.ts`
// stays tool-agnostic. The two are wired together at the call site that
// drives both (ToolsPane.tsx's tool-selection logic).

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AlpModel } from "../fence";
import type { PanelSelection } from "./viewModel";

export const EMPTY_MODEL: AlpModel = Object.freeze({
  v: 1,
  placements: [],
  roles: [],
  randomParams: [],
  groups: [],
});

export interface LandPlacementModelValue {
  /** null before the panel's first `load()`. ToolsPane loads one synchronously on mount, so a real render never sees this. */
  model: AlpModel | null;
  /**
   * True when `model` differs from the model as last loaded or Apply'd, a
   * CONTENT check (JSON equality), never a version number, matching Sec.3.6(a)'s
   * own rule for the fence itself. `ToolHost.setPanelDirty` mirrors this so
   * `PanelState.dirty` (which drives the tool-switch confirm) stays in sync;
   * see `useLandPlacementDirtySync` below.
   */
  dirty: boolean;
  /** Replace the model with an edit. Marks dirty relative to the last `load`/`markSaved`. */
  setModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
  /**
   * Loads a fresh model (from the fence, or `EMPTY_MODEL` when there is none)
   * with its starting selection, and marks it clean. Called once when the
   * panel mounts. A tab switch keeps the store and never calls this again,
   * which is what lets the selection survive one.
   */
  load: (model: AlpModel, selection: PanelSelection | null) => void;
  /** Marks the CURRENT model as saved, called right after a successful Apply, since Apply writes exactly this model into the fence. */
  markSaved: () => void;
  /** Discards everything. Called on unmount ("select another tool" after its confirm, or a document replace). */
  clear: () => void;
  /** Lives here rather than in the panel's own state so a tab switch, which unmounts the panel, does not lose it. */
  selection: PanelSelection | null;
  setSelection: (selection: PanelSelection | null) => void;
}

const LandPlacementModelCtx = createContext<LandPlacementModelValue | null>(
  null,
);

function sameContent(a: AlpModel | null, b: AlpModel | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function LandPlacementModelProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [model, setModelState] = useState<AlpModel | null>(null);
  const [saved, setSaved] = useState<AlpModel | null>(null);
  const [selection, setSelection] = useState<PanelSelection | null>(null);

  const setModel = useCallback(
    (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => {
      setModelState((prev) =>
        typeof updater === "function" ? updater(prev ?? EMPTY_MODEL) : updater,
      );
    },
    [],
  );

  const load = useCallback(
    (next: AlpModel, startSelection: PanelSelection | null) => {
      setModelState(next);
      setSaved(next);
      setSelection(startSelection);
    },
    [],
  );

  const markSaved = useCallback(() => {
    setSaved(model);
  }, [model]);

  const clear = useCallback(() => {
    setModelState(null);
    setSaved(null);
    setSelection(null);
  }, []);

  const dirty = !sameContent(model, saved);

  const value = useMemo(
    () => ({
      model,
      dirty,
      setModel,
      load,
      markSaved,
      clear,
      selection,
      setSelection,
    }),
    [model, dirty, setModel, load, markSaved, clear, selection],
  );

  return (
    <LandPlacementModelCtx.Provider value={value}>
      {children}
    </LandPlacementModelCtx.Provider>
  );
}

export function useLandPlacementModel(): LandPlacementModelValue {
  const ctx = useContext(LandPlacementModelCtx);
  if (!ctx)
    throw new Error(
      "useLandPlacementModel must be used within LandPlacementModelProvider",
    );
  return ctx;
}
