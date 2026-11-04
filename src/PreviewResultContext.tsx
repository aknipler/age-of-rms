import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ParseResult } from "./parser/types";
import type { PreviewWireResult } from "./preview/generator/types";
import type { PreviewViewMode } from "./components/preview/PreviewViewContext";
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
  /** Generate when the script is edited. Absent means on, which is right for the panel's own instance. */
  regenOnEdit?: boolean;
  children: ReactNode;
}

/** D11: the result plus whether a generation is currently in flight for it — see usePreviewResult.ts's own doc comment. */
export interface PreviewResultContextValue {
  result: PreviewWireResult | null;
  pending: boolean;
  /** The script changed since `result` was generated and Regenerate on Edit is off. */
  stale: boolean;
  regenerate: () => void;
}

/**
 * One (Context, Provider, hook) triple per CONSUMER, not per app; see the
 * doc comment above for why. Each instance is a fully independent worker +
 * debounce + last-result cell; nothing is shared between two channels but
 * this function's code.
 */
/**
 * What the context carries inside a channel. `watch` is how a reader says it
 * is on screen. It never leaves this file, since `useResultContext` returns
 * the narrower public type.
 */
interface ChannelContextValue extends PreviewResultContextValue {
  /** Counts one more reader, and returns the function that uncounts it. */
  watch: () => () => void;
}

interface ChannelOptions {
  /**
   * Generate only while at least one component reads this channel. The
   * Land Placement panel's channel sets it. Without it that channel generated
   * a full second preview of every edit, on its own worker, whether or not
   * the panel was open, which on Stranded.rms was 1.5 to 2.7 s of a core per
   * edit competing with the parser and the document's own preview
   * (2026-11-04, docs/diagnostics-latency-report.md Sec.10).
   */
  generateOnlyWhileRead: boolean;
}

function createPreviewResultChannel({
  generateOnlyWhileRead,
}: ChannelOptions): {
  Provider: (props: PreviewResultProviderProps) => ReactElement;
  useResultContext: () => PreviewResultContextValue;
} {
  const ctx = createContext<ChannelContextValue>({
    result: null,
    pending: false,
    stale: false,
    regenerate: () => {},
    watch: () => () => {},
  });

  function ChannelProvider({
    parseResult,
    seed,
    view,
    cutOffset,
    regenOnEdit = true,
    children,
  }: PreviewResultProviderProps): ReactElement {
    const { playerCount, mapSize, teams, teamPositions } =
      useGenerationSettings();

    /*
     * Current vs Final (preview-design Sec.5), and the ONLY place the two
     * differ. Sec.5: Current is `generatePreview(truncateAst(parse,
     * pinnedLine), …)`; the same generator, the same settings, the same
     * seed, over a shorter script. Final is the whole parse. There is no mode
     * parameter anywhere below this line, which is why `generatePreview` and
     * `worker.ts` needed no change at all to ship this.
     *
     * The cut itself happens in the preview worker (worker.ts), because it
     * needs the tree and only the script text crosses to the worker (the
     * tree cost the UI thread 85 to 160 ms per request on a big map). This
     * file only says WHERE. A number compares by value, so a cursor that has
     * not moved restarts nothing, which is what the old memoised
     * `truncateAst(...)` object was there to guarantee.
     *
     * The cost Sec.5 accepts is one extra generation per cursor move while
     * Current is on and unpinned; the debounce is what makes that liveable,
     * and `truncateAst` returning the parse unchanged when the cut drops
     * nothing is what makes a pin at the end of the file free.
     */
    const cutAt = view === "current" ? cutOffset : null;

    // How many mounted components read this channel. State, not a ref,
    // because the count changing has to re-render this provider so the hook
    // below sees the parse appear or vanish. The callback is stable
    // (useCallback with no dependencies) so a reader's effect that depends on
    // it runs once per mount rather than once per render.
    const [readers, setReaders] = useState(0);
    const watch = useCallback(() => {
      setReaders((n) => n + 1);
      return () => setReaders((n) => n - 1);
    }, []);
    // Handing the hook `null` is its existing "nothing to generate" input. It
    // sends nothing and keeps the last result, so a panel shown again still
    // has its old map on screen while the new one generates.
    const generating = !generateOnlyWhileRead || readers > 0;

    const { result, pending, stale, regenerate } = usePreviewResult(
      generating ? parseResult : null,
      playerCount,
      mapSize,
      teams,
      teamPositions,
      seed,
      regenOnEdit,
      cutAt,
    );

    // No useMemo: unlike the old bare-`result` value, this object IS
    // rebuilt every render, but `pending` starts and stops changing exactly
    // when the bar should dim/undim, and `result` still only swaps identity
    // when a worker response actually arrives — a consumer diffing `result`
    // alone (the pane) is unaffected, and StatusBarContainer wants both.
    return (
      <ctx.Provider value={{ result, pending, stale, regenerate, watch }}>
        {children}
      </ctx.Provider>
    );
  }

  function useResultContext(): PreviewResultContextValue {
    const value = useContext(ctx);
    const { watch } = value;
    // Registers this reader for as long as it is mounted. The returned
    // function is the effect's cleanup, so an unmount uncounts it. Under
    // StrictMode's double mount the count goes 1, 0, 1, which settles right.
    // The hook is called on every channel because hooks must run in the same
    // order every render, and only the body depends on the option.
    useEffect(() => (generateOnlyWhileRead ? watch() : undefined), [watch]);
    return value;
  }

  return { Provider: ChannelProvider, useResultContext };
}

const documentChannel = createPreviewResultChannel({
  generateOnlyWhileRead: false,
});

/** The document's own preview, Breakdown/Code's shared seed, view and cut (`PreviewViewContext`/`PreviewCutContext`). */
export const PreviewResultProvider = documentChannel.Provider;
/** `.result` is null until the first generation completes; callers must handle it, the pane renders nothing until then. `.pending` is true while a generation is in flight (D11). */
export const usePreviewResultContext = documentChannel.useResultContext;

const panelChannel = createPreviewResultChannel({
  generateOnlyWhileRead: true,
});

/**
 * The Land Placement panel's own preview, its own pinned seed and its own
 * cut at the end of `<LAND_GENERATION>` (Sec.7.1), never the document's. A
 * second, independent worker (`usePreviewResult` holds its own in a `useRef`
 * with no module-level state; see its own header), mounted ABOVE the tab
 * switch alongside the document instance so it survives suspend/resume the
 * same way (App.tsx wires both). Costs one idle worker when no panel tool is
 * selected. It generates only while a component reads
 * `usePanelPreviewResultContext`, which today is LandPlacementCanvas.
 */
export const PanelPreviewResultProvider = panelChannel.Provider;
export const usePanelPreviewResultContext = panelChannel.useResultContext;
