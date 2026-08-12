import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ParseResult } from "./parser/types";
import type { PreviewResult } from "./preview/generator/types";
import { truncateAst } from "./preview/generator/truncateAst";
import { usePreviewResult } from "./usePreviewResult";
import { usePreviewCut } from "./PreviewCutContext";
import { useGenerationSettings } from "./generationSettings/GenerationSettingsContext";
import { usePreviewView } from "./components/preview/PreviewViewContext";

/**
 * The generated preview, hoisted ABOVE the Breakdown/Code tab switch.
 *
 * WHY THIS FILE EXISTS. `usePreviewResult` used to be called by
 * `PreviewPane`, which lives inside `MapSidePanel`, which is rendered by
 * `BreakdownPane` and `CodePane` — both of which unmount when the other tab
 * is selected. A hook's state dies with the component that owns it, so every
 * tab switch terminated the preview worker, threw away the finished
 * `PreviewResult`, spawned a fresh worker, and re-ran a generation that can
 * take seconds on a real map. The pane came back empty and stayed empty
 * while it regenerated, which reads as the preview being deleted by the tab
 * switch — and on a heavy script it effectively was.
 *
 * This is the same fix, and the same reasoning, as the two things App.tsx
 * already hoists for exactly this reason: `useSharedSelection` ("lifted here
 * rather than living inside BreakdownPane, which unmounts on every tab
 * switch") and `PreviewViewportProvider` (zoom/pan, hoisted in the 2026-08-06
 * fix for the same symptom one level shallower). The viewport survived the
 * switch while the map it framed did not.
 *
 * It is a PROVIDER COMPONENT rather than a bare context because the hook has
 * to run somewhere, and the only place it can run is above the switch. That
 * also keeps `PreviewPane` prop-less, which `MapSidePanel`'s own contract
 * requires.
 *
 * WHAT IS NOT HERE: `parseResult` still arrives as a prop rather than through
 * `useParsedDocumentContext`. This provider renders ABOVE
 * `ParsedDocumentProvider` in App.tsx (it has to, to outlive the tab switch),
 * so the context would not be readable from here — and `AppContent` has the
 * value in hand anyway.
 */
const PreviewResultCtx = createContext<PreviewResult | null>(null);

export function PreviewResultProvider({
  parseResult,
  children,
}: {
  parseResult: ParseResult | null;
  children: ReactNode;
}) {
  const { playerCount, mapSize, teams } = useGenerationSettings();
  // Seed comes from PreviewViewContext, which is already above the tab
  // switch — so a re-roll and the generation it triggers now live at the
  // same level, instead of the control outliving the result it produces.
  const { seed, view } = usePreviewView();
  const { cutOffset } = usePreviewCut();

  /*
   * Current vs Final (preview-design Sec.5), and the ONLY place the two
   * differ. Sec.5: Current is `generatePreview(truncateAst(parse,
   * pinnedLine), …)` — the same generator, the same settings, the same seed,
   * over a shorter script. Final is the whole parse. There is no mode
   * parameter anywhere below this line, which is why `generatePreview` and
   * `worker.ts` needed no change at all to ship this.
   *
   * `useMemo` is not an optimisation here, it is the correctness condition:
   * `usePreviewResult`'s debounce effect keys on the parse's REFERENCE, so an
   * unmemoised `truncateAst(...)` would hand it a fresh object on every
   * render — every keystroke, every hover — and restart the 300ms timer
   * without the script having changed, which is a preview that never settles.
   *
   * The cost Sec.5 accepts is one extra generation per cursor move while
   * Current is on and unpinned; the debounce is what makes that liveable, and
   * `truncateAst` returning the parse unchanged when the cut drops nothing is
   * what makes a pin at the end of the file free.
   */
  const generatedFrom = useMemo(() => {
    if (parseResult === null) return null;
    if (view !== "current" || cutOffset === null) return parseResult;
    return truncateAst(parseResult, cutOffset);
  }, [parseResult, view, cutOffset]);

  const { result } = usePreviewResult(
    generatedFrom,
    playerCount,
    mapSize,
    teams,
    seed,
  );

  // No useMemo: `result` is the context value itself, and it only changes
  // when a worker response actually arrives — the same reasoning
  // ParsedDocumentProvider gives for not wrapping its own value.
  return (
    <PreviewResultCtx.Provider value={result}>
      {children}
    </PreviewResultCtx.Provider>
  );
}

/** null until the first generation completes. Callers must handle it — the pane renders nothing until then. */
export function usePreviewResultContext(): PreviewResult | null {
  return useContext(PreviewResultCtx);
}
