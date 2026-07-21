import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import type { Item, Span } from "../parser/types";
import { useBreakdownContext } from "./BreakdownContext";
import { ticksForItems, type RulerTick } from "./rulerTicks";
import { HelpTip } from "../components/HelpTip";
import styles from "./DiagnosticsRuler.module.css";

interface MeasuredTick extends RulerTick {
  /** 0-1 fraction of the scroll container's `scrollHeight` — Monaco-ruler-style, NOT a source-offset computation (§3.10's "mapping problem": cards are variable-height and resize at runtime, so this can only come from real layout). */
  topFraction: number;
}

/** The currently-visible slice of the scroll container, as a fraction of its full scrollHeight — the "you are here" indicator Ash asked for, since ticks alone give no sense of whether a problem is on-screen right now. */
interface Viewport {
  topFraction: number;
  heightFraction: number;
}

interface DiagnosticsRulerProps {
  items: readonly Item[];
  /** The scrollable container to measure against and query card positions within — SectionView's own `.view` div. */
  containerRef: RefObject<HTMLDivElement | null>;
}

// §3.10 (post-3.4, sequenced last as the hardest/only DOM-measurement
// item — see docs/breakdown-design.md's own cost note). A thin vertical
// track along the section's scroll container, one tick per top-level
// item carrying a diagnostic, positioned by actual rendered offsetTop
// (not source offset — cards are variable-height and that height changes
// at runtime on expand/collapse, so there is no linear offset->y
// function the way there is for Monaco's own ruler over uniform-height
// lines). Clicking a tick scrolls that card into view and selects it,
// same as the cross-tab-sync scroll path.
export function DiagnosticsRuler({ items, containerRef }: DiagnosticsRulerProps) {
  const { diagnostics, expandedAnchors, selectCard } = useBreakdownContext();
  const [ticks, setTicks] = useState<MeasuredTick[]>([]);
  const [viewport, setViewport] = useState<Viewport>({ topFraction: 0, heightFraction: 1 });

  // Recomputes tick screen positions from the CURRENT DOM layout. Kept as
  // one function so both the layout effect (fires after every render
  // that could have changed which items exist or their diagnostics) and
  // the ResizeObserver (fires on pane/window resize, which changes
  // nothing about the AST but does change where things land on screen)
  // call the exact same measurement path.
  const remeasureTicks = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const candidates = ticksForItems(items, diagnostics);
    const scrollHeight = container.scrollHeight || 1;
    // getBoundingClientRect, not offsetTop: offsetTop is only meaningful
    // relative to the element's offsetParent — the nearest ANCESTOR with
    // a non-static `position` — which is fragile here (this codebase
    // wraps lots of things in HelpTip, whose own wrapper is itself
    // `position: relative` for popup anchoring, and it's easy for some
    // future ancestor to become positioned without anyone realizing it
    // breaks this measurement). getBoundingClientRect is viewport-
    // relative and immune to the offsetParent chain entirely — subtract
    // the container's own rect and add back its scrollTop to recover
    // "distance from the top of the FULL scrollable content" regardless
    // of what's positioned where in between.
    const containerRect = container.getBoundingClientRect();
    const next: MeasuredTick[] = [];
    for (const candidate of candidates) {
      const el = container.querySelector<HTMLElement>(`[data-anchor="${candidate.anchor}"]`);
      if (!el) continue; // shouldn't happen (every top-level item renders one), but degrade quietly rather than throw
      const elRect = el.getBoundingClientRect();
      const topWithinContent = elRect.top - containerRect.top + container.scrollTop;
      // Clamp to [0, 1]: the very last item's rect can land a hair past
      // `scrollHeight` from sub-pixel rounding (border/padding rounding
      // differs between getBoundingClientRect's fractional pixels and the
      // integer-rounded scrollHeight), which without clamping renders
      // that one tick a few px below .ruler's own box — visually poking
      // into whatever sits below the pane (the StatusBar).
      const topFraction = Math.min(1, Math.max(0, topWithinContent / scrollHeight));
      next.push({ ...candidate, topFraction });
    }
    setTicks(next);
  }, [items, diagnostics, containerRef]);

  // "Where am I currently looking" — Ash's ask: ticks alone give no way
  // to tell whether a problem is on-screen right now. Same
  // scrollHeight-fraction math as ticks, but for the container's own
  // visible slice (scrollTop/clientHeight) instead of a card's offsetTop.
  const remeasureViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollHeight = container.scrollHeight || 1;
    setViewport({
      topFraction: container.scrollTop / scrollHeight,
      heightFraction: Math.min(1, container.clientHeight / scrollHeight),
    });
  }, [containerRef]);

  const remeasure = useCallback(() => {
    remeasureTicks();
    remeasureViewport();
  }, [remeasureTicks, remeasureViewport]);

  // Measure in a layout effect (per §3.10's own instruction: "measure in
  // a layout effect... do not measure during render"), keyed on
  // everything that can change layout WITHOUT necessarily changing the
  // container's own border-box size (which is all a ResizeObserver on
  // the container would catch): a fresh parse changing which items exist
  // (`items`/`diagnostics` themselves), and expand/collapse toggling
  // (`expandedAnchors` — a new Set reference on every toggle, so this
  // dependency fires correctly even though ticksForItems itself doesn't
  // read expansion state at all).
  useLayoutEffect(() => {
    remeasure();
  }, [remeasure, expandedAnchors]);

  // Pure resize (pane drag, window resize, DevTools open/close) doesn't
  // change the AST or expansion state, so the effect above wouldn't
  // re-fire for it — a ResizeObserver on the scroll container is the
  // only way to catch that case, per §3.10's own instruction. Scrolling
  // ALSO doesn't change the AST/expansion/container size, but it's the
  // one thing that moves the viewport indicator — a plain scroll listener
  // covers it (deliberately NOT routed through remeasureTicks too: ticks
  // are positions within the full document and don't move when you
  // scroll, only the viewport indicator does, so re-doing the tick
  // measurement on every scroll event would be pure wasted work).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(container);
    container.addEventListener("scroll", remeasureViewport);
    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", remeasureViewport);
    };
  }, [containerRef, remeasure, remeasureViewport]);

  // Always rendered (Ash: "always have the ruler, even if there are no
  // diagnostics") — it's also the only visible indicator of where the
  // current viewport sits in the section, independent of whether
  // anything is actually wrong.
  return (
    <div className={styles.ruler}>
      <div
        className={styles.viewport}
        style={{ top: `${viewport.topFraction * 100}%`, height: `${viewport.heightFraction * 100}%` }}
      />
      {ticks.map((tick) => (
        // The positioned element MUST be a direct child of `.ruler` —
        // HelpTip wraps its children in its OWN `position: relative`
        // span (HelpTip.module.css, needed to anchor its hover popup),
        // which silently becomes the containing block for anything
        // absolutely positioned inside it. Putting HelpTip on the button
        // itself (as an earlier version of this did) meant every tick's
        // `top: X%` was resolving against that tiny auto-sized wrapper
        // span instead of `.ruler` — collapsing every tick to roughly the
        // same spot near the top, regardless of its actual computed
        // fraction. Fix: this outer div carries the position/top, and
        // HelpTip goes INSIDE it, wrapping only the button.
        <div key={tick.anchor} className={styles.tickWrapper} style={{ top: `${tick.topFraction * 100}%` }}>
          <HelpTip id="breakdown.diagnosticsRuler.tick">
            <button
              type="button"
              className={`${styles.tick} ${styles[`severity-${tick.severity}`]}`}
              title={`Jump to this ${tick.severity}`}
              onClick={() => {
                const el = containerRef.current?.querySelector<HTMLElement>(`[data-anchor="${tick.anchor}"]`);
                el?.scrollIntoView({ block: "center" });
                // selectCard's signature takes a Span and only reads
                // `.start` (§3.9) — a tick only ever has the anchor
                // offset itself, so a single-point span is exactly what's
                // needed, not a real range.
                const span: Span = { start: tick.anchor, end: tick.anchor + 1 };
                selectCard(span);
              }}
            />
          </HelpTip>
        </div>
      ))}
    </div>
  );
}
