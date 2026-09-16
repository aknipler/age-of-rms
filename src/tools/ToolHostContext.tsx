import { createContext, useContext, useState, type ReactNode } from "react";
import { ToolHost, inProcessRunner } from "./host";
import { registeredTools } from "./registry";

/**
 * Lifts `ToolHost` above the Breakdown/Code/Advanced-Tools tab switch, the
 * same move `App.tsx` has already made twice for the same reason
 * (`useSharedSelection`, `PreviewViewportProvider`): App.tsx renders
 * `{activeTab === "advanced-tools" && <ToolsPane …/>}`, so anything owned
 * INSIDE `ToolsPane` dies on every tab switch away from it.
 *
 * For a REPORT tool that was fine. Nothing about a finished report needs
 * to survive a tab switch, and `ToolsPane`'s own unmount effect already
 * tears the run down deliberately (host.ts's `reset()`, landed 2026-08-29
 * for the orphaned-worker bug). What changes here is PANEL state
 * (land-placement-design.md Sec.3.6): "a panel takes no snapshot and cannot
 * go stale; its model has to be lifted above activeTab or a tab switch
 * destroys it." Lifting the WHOLE `ToolHost` (rather than only its
 * `PanelState` half) keeps `isBusy()`, which reads both RunState and
 * PanelState together, a single object's own invariant instead of two
 * objects that could disagree about whether the run slot is occupied.
 *
 * `ToolsPane.tsx`'s own mount/unmount effect is what still reproduces
 * today's report-tool behaviour unchanged (suspend a MOUNTED panel, reset
 * otherwise). This provider only decides WHERE the object lives, not what
 * happens to it on a tab switch.
 */
const ToolHostCtx = createContext<ToolHost | null>(null);

/**
 * Which tool is showing in the Advanced Tools dropdown — lifted above the
 * tab switch for the identical reason `ToolHost` itself is (see the file
 * header above): `ToolsPane` fully unmounts on every tab switch away from
 * it, so a plain `useState` inside that component forgets the selection on
 * the way out and re-initialises to `tools[0]` on the way back in. `host`'s
 * own RunState/PanelState already survive the switch (a suspended PANEL
 * resumes correctly), but the dropdown itself was still defaulting back to
 * the first tool in the list, so a user who had Land Placement open saw the
 * wrong tool's UI — the panel was technically still "mounted" underneath,
 * just not the one selected — and anyone else had to re-pick their tool
 * from the list every time. A separate context rather than a field on
 * `ToolHost`: this is pure UI state (which row the `<select>` shows),
 * never read or written by host.ts, so it doesn't belong on the object that
 * owns run lifecycle and panel lifecycle.
 */
const SelectedToolCtx = createContext<{
  selectedId: string;
  setSelectedId: (id: string) => void;
} | null>(null);

export function ToolHostProvider({ children }: { children: ReactNode }) {
  // `useState`'s LAZY INITIALISER, not `useMemo`, same reasoning ToolsPane's
  // own (now-removed) local host carried: React documents a `useMemo` cache
  // as discardable, and this object owns a live Worker across its
  // lifetime once a worker-backed tool runs.
  const [host] = useState(() => {
    const h = new ToolHost(inProcessRunner);
    const tools = registeredTools();
    h.registerEditCapable(
      tools
        .filter((t) => t.manifest.capabilities.includes("edit-source"))
        .map((t) => t.manifest.id),
    );
    return h;
  });
  const [selectedId, setSelectedId] = useState<string>(
    () => registeredTools()[0]?.manifest.id ?? "",
  );

  return (
    <ToolHostCtx.Provider value={host}>
      <SelectedToolCtx.Provider value={{ selectedId, setSelectedId }}>
        {children}
      </SelectedToolCtx.Provider>
    </ToolHostCtx.Provider>
  );
}

export function useToolHostContext(): ToolHost {
  const host = useContext(ToolHostCtx);
  if (host === null)
    throw new Error(
      "useToolHostContext must be used within a ToolHostProvider",
    );
  return host;
}

export function useSelectedTool(): {
  selectedId: string;
  setSelectedId: (id: string) => void;
} {
  const ctx = useContext(SelectedToolCtx);
  if (ctx === null)
    throw new Error("useSelectedTool must be used within a ToolHostProvider");
  return ctx;
}
