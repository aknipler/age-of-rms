import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from "react";
import type { ParseResult } from "./parser/types";
import type { PreviewWireResult } from "./preview/generator/types";
import type { PreviewViewMode } from "./components/preview/PreviewViewContext";
import { truncateAst } from "./preview/generator/truncateAst";
import { usePreviewResult } from "./usePreviewResult";
import { useGenerationSettings } from "./generationSettings/GenerationSettingsContext";

/**
 * The generated preview, hoisted ABOVE the Breakdown/Code tab switch.
 *
 * WHY THIS FILE EXISTS. `usePreviewResult` used to be called by
 * `PreviewPane`, which lives inside `MapSidePanel`, which is rendered by
 * `BreakdownPane` and `CodePane`, both of which unmount when the other tab
 * is selected. A hook's state dies with the component that owns it, so every
 * tab switch terminated the preview worker, threw away the finished
 * `PreviewResult`, spawned a fresh worker, and re-ran a generation that can
 * take seconds on a real map. The pane came back empty and stayed empty
 * while it regenerated, which reads as the preview being deleted by the tab
 * switch, and on a heavy script it effectively was.
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
 * so the context would not be readable from here, and `AppContent` has the
 * value in hand anyway.
 *
 * SEED/VIEW/CUTOFFSET ARE PROPS, NOT CONTEXT READS (land-placement-design.md
 * Sec.3.4, Sec.7.1; slice-4b item 1, answering §1.2 as option (f)). This
 * provider used to call `usePreviewView()`/`usePreviewCut()` itself, which
 * hard-wired it to the one app-level seed/cut singleton, fine when there was
 * only ever one consumer (Breakdown/Code sharing `MapSidePanel`), wrong the
 * moment a second consumer (the Land Placement panel) needs its own pinned
 * seed and its own cut at the end of `<LAND_GENERATION>` rather than the
 * caret's. Taking them as props is what lets `createPreviewResultChannel`
 * below be instantiated twice with two different inputs while sharing every
 * line of generation logic; the debounce, the worker, Current/Final
 * truncation, all of it unchanged.
 */
interface PreviewResultProviderProps {
  parseResult: ParseResult | null;
  seed: number;
  /** "final" is right for a caller with no Current/Final concept of its own; see the panel-scoped instance below. */
  view: PreviewViewMode;
  /** Where THIS consumer cuts Current at, or null to draw the whole script. Ignored entirely when `view` is "final". */
  cutOffset: number | null;
  children: ReactNode;
}

/** D11: the result plus whether a generation is currently in flight for it — see usePreviewResult.ts's own doc comment. */
export interface PreviewResultContextValue {
  result: PreviewWireResult | null;
  pending: boolean;
}

/**
 * One (Context, Provider, hook) triple per CONSUMER, not per app; see the
 * doc comment above for why. Each instance is a fully independent worker +
 * debounce + last-result cell; nothing is shared between two channels but
 * this function's code.
 */
function createPreviewResultChannel(): {
  Provider: (props: PreviewResultProviderProps) => ReactElement;
  useResultContext: () => PreviewResultContextValue;
} {
  const ctx = createContext<PreviewResultContextValue>({ result: null, pending: false });

  function ChannelProvider({ parseResult, seed, view, cutOffset, children }: PreviewResultProviderProps): ReactElement {
    const { playerCount, mapSize, teams } = useGenerationSettings();

    /*
     * Current vs Final (preview-design Sec.5), and the ONLY place the two
     * differ. Sec.5: Current is `generatePreview(truncateAst(parse,
     * pinnedLine), …)`; the same generator, the same settings, the same
     * seed, over a shorter script. Final is the whole parse. There is no mode
     * parameter anywhere below this line, which is why `generatePreview` and
     * `worker.ts` needed no change at all to ship this.
     *
     * `useMemo` is not an optimisation here, it is the correctness condition:
     * `usePreviewResult`'s debounce effect keys on the parse's REFERENCE, so
     * an unmemoised `truncateAst(...)` would hand it a fresh object on every
     * render (every keystroke, every hover) and restart the 300ms timer
     * without the script having changed, which is a preview that never
     * settles.
     *
     * The cost Sec.5 accepts is one extra generation per cursor move while
     * Current is on and unpinned; the debounce is what makes that liveable,
     * and `truncateAst` returning the parse unchanged when the cut drops
     * nothing is what makes a pin at the end of the file free.
     */
    const generatedFrom = useMemo(() => {
      if (parseResult === null) return null;
      if (view !== "current" || cutOffset === null) return parseResult;
      return truncateAst(parseResult, cutOffset);
    }, [parseResult, view, cutOffset]);

    const { result, pending } = usePreviewResult(generatedFrom, playerCount, mapSize, teams, seed);

    // No useMemo: unlike the old bare-`result` value, this object IS
    // rebuilt every render, but `pending` starts and stops changing exactly
    // when the bar should dim/undim, and `result` still only swaps identity
    // when a worker response actually arrives — a consumer diffing `result`
    // alone (the pane) is unaffected, and StatusBarContainer wants both.
    return <ctx.Provider value={{ result, pending }}>{children}</ctx.Provider>;
  }

  function useResultContext(): PreviewResultContextValue {
    return useContext(ctx);
  }

  return { Provider: ChannelProvider, useResultContext };
}

const documentChannel = createPreviewResultChannel();

/** The document's own preview, Breakdown/Code's shared seed, view and cut (`PreviewViewContext`/`PreviewCutContext`). */
export const PreviewResultProvider = documentChannel.Provider;
/** `.result` is null until the first generation completes; callers must handle it, the pane renders nothing until then. `.pending` is true while a generation is in flight (D11). */
export const usePreviewResultContext = documentChannel.useResultContext;

const panelChannel = createPreviewResultChannel();

/**
 * The Land Placement panel's own preview, its own pinned seed and its own
 * cut at the end of `<LAND_GENERATION>` (Sec.7.1), never the document's. A
 * second, independent worker (`usePreviewResult` holds its own in a `useRef`
 * with no module-level state; see its own header), mounted ABOVE the tab
 * switch alongside the document instance so it survives suspend/resume the
 * same way (App.tsx wires both). Costs one idle worker when no panel tool is
 * selected; it only generates while asked to.
 */
export const PanelPreviewResultProvider = panelChannel.Provider;
export const usePanelPreviewResultContext = panelChannel.useResultContext;
