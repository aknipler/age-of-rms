// The Land Placement panel's own preview seed (land-placement-design.md
// Sec.3.3, Sec.7.2, slice-4b item 1's answer to §1.2, option (f)).
//
// Deliberately a SEPARATE, small context rather than a field on
// `PreviewViewContext`. Sec.3.3 is explicit that the panel's seed "must not
// write back to `PreviewViewContext`" (that leak is what option (e), a
// shared provider driven by the panel, was rejected for). Held above the tab
// switch, alongside `PanelPreviewResultProvider` (`PreviewResultContext.tsx`),
// so it survives Breakdown/Code <-> Advanced Tools the same way the
// document's own seed does.
//
// "Pinned on mount" (Sec.3.3) does not mean mount of THIS provider. It is
// mounted once for the app's whole life, like `PreviewViewProvider`. It means
// the moment the Land Placement TOOL is mounted (`ToolHost.mountPanel`,
// wired in ToolsPane.tsx); the caller there calls `reseed()` at that instant.
// A React-mount effect would be wrong: the panel's own component tree remounts
// on every tab switch (App.tsx renders `ToolsPane` only while
// `activeTab === "advanced-tools"`), and re-rolling on every one of those
// would throw away a seed the user is mid-edit against.

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface PanelPreviewSeedValue {
  seed: number;
  reseed: () => void;
}

const PanelPreviewSeedCtx = createContext<PanelPreviewSeedValue | null>(null);

function randomSeed(): number {
  // Math.random is fine here. See PreviewViewContext.tsx's own note:
  // reproducibility is the generator's contract (src/preview/generator/),
  // not the UI's choice of which seed to show first.
  return Math.floor(Math.random() * 1_000_000);
}

export function PanelPreviewSeedProvider({ children }: { children: ReactNode }) {
  const [seed, setSeed] = useState(randomSeed);
  const reseed = useCallback(() => setSeed(randomSeed()), []);
  const value = useMemo(() => ({ seed, reseed }), [seed, reseed]);
  return <PanelPreviewSeedCtx.Provider value={value}>{children}</PanelPreviewSeedCtx.Provider>;
}

export function usePanelPreviewSeed(): PanelPreviewSeedValue {
  const ctx = useContext(PanelPreviewSeedCtx);
  if (!ctx) throw new Error("usePanelPreviewSeed must be used within PanelPreviewSeedProvider");
  return ctx;
}
