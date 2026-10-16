import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useParsedDocumentContext } from "../ParsedDocumentContext";
import { HelpTip } from "../components/HelpTip";
import { useTutorial } from "./TutorialContext";
import { RMS_DISCORD_URL } from "./content/rmsBasics";
import { SUPPORT_URL } from "../supportLink";
import { StepBody } from "./StepBody";
import type { Anchor, BodyBlock, StepContext, TutorialStep } from "./types";
import type { TabId } from "../types";
import styles from "./TutorialOverlay.module.css";

/** Gap between the anchor and the callout, and the callout's minimum clearance from the viewport edge, same values HelpTip's popup uses. */
const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

/** How long the tick shows before a freshly-satisfied check step auto-advances (Sec.5.5), long enough to read as a reward, not a dismissal. A step with `autoAdvance: false` never does. */
const AUTO_ADVANCE_DELAY_MS = 1100;

interface TutorialOverlayProps {
  hasFile: boolean;
  activeTab: TabId;
  /** Powers a step's `autoFill` button, same function CodePane/Advanced Tools push edits through (one `pushEditOperations` call, one undo entry). */
  applyTextEdits: (
    edits: readonly { start: number; end: number; newText: string }[],
  ) => void;
}

function resolveAnchor(anchor: Anchor): HTMLElement | null {
  switch (anchor.kind) {
    case "help":
      return document.querySelector<HTMLElement>(
        `[data-help-id="${anchor.id}"]`,
      );
    case "region":
      return document.querySelector<HTMLElement>(
        `[data-tutorial-anchor="${anchor.id}"]`,
      );
    case "selector":
      return document.querySelector<HTMLElement>(anchor.css);
  }
}

interface Placement {
  top: number;
  left: number;
}

/** tutorial-design.md Sec.5.2, the engine, spotlight geometry and the two callout kinds (a running step, and Sec.11's standalone announcement). */
export function TutorialOverlay({
  hasFile,
  activeTab,
  applyTextEdits,
}: TutorialOverlayProps) {
  const {
    active,
    choose,
    next,
    back,
    exit,
    announcement,
    showAnnouncementTour,
    dismissAnnouncement,
    activeSectionId,
  } = useTutorial();
  const parseResult = useParsedDocumentContext();

  const step = active ? active.steps[active.stepIndex] : null;
  // The track is part of the key. Back to a choice step and a different pick
  // reaches the same index with a different step, which must remount.
  const stepKey = active
    ? `${active.definition.id}:${active.track ?? ""}:${active.stepIndex}`
    : null;

  // The What's New text is several paragraphs, so it gets the wide callout
  // in both ways it can appear: the popup after an upgrade (`announcement`)
  // and its first step opened from the Help menu (an ordinary `active` run
  // at index 0, the same condition StepCallout's showSupportButton uses).
  const wide =
    announcement !== null ||
    (active !== null &&
      active.definition.id.startsWith("whats-new-") &&
      active.stepIndex === 0);

  const stepContext: StepContext = {
    parseResult,
    source: parseResult?.source ?? "",
    activeTab,
    activeSectionId,
    hasFile,
  };
  const satisfied =
    step?.completion.kind === "check"
      ? step.completion.test(stepContext)
      : false;

  // Sec.5.5, whether THIS step was already satisfied the moment it became
  // active, computed once per step identity via React's documented
  // "adjusting state during render" pattern (a setState call guarded by a
  // key comparison, rather than useEffect. This needs to be settled
  // before the auto-advance effect below reads it on the very first render
  // of a new step).
  const [arrival, setArrival] = useState<{
    key: string;
    satisfiedOnArrival: boolean;
  } | null>(null);
  if (stepKey && arrival?.key !== stepKey) {
    setArrival({ key: stepKey, satisfiedOnArrival: satisfied });
  }
  const satisfiedOnArrival =
    arrival?.key === stepKey ? arrival.satisfiedOnArrival : false;

  // Auto-advance only on a TRANSITION to satisfied, never for a step that
  // arrives already done. Running the tutorial against a finished map
  // must read as a reference, not race to the end (Sec.5.5). A step that
  // opts out with `autoAdvance: false` shows its tick and waits for Next.
  useLayoutEffect(() => {
    if (
      !step ||
      step.completion.kind !== "check" ||
      step.completion.autoAdvance === false ||
      satisfiedOnArrival ||
      !satisfied
    )
      return;
    const timeout = window.setTimeout(() => next(), AUTO_ADVANCE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [step, satisfied, satisfiedOnArrival, next]);

  // Escape exits the running tutorial (not the announcement, Sec.7.4 gives
  // Escape that meaning only for the welcome pane).
  useLayoutEffect(() => {
    if (!active) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") exit();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, exit]);

  const calloutRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Placement | null>(null);
  // Every anchored region currently in the spotlight, `anchor` (which also
  // positions the callout) plus any `extraAnchors`. A step naming a section
  // tab AND asking the user to press Add command lands both in one dimmed
  // cutout rather than forcing a choice of which one gets highlighted.
  const [spotlightRects, setSpotlightRects] = useState<DOMRect[]>([]);

  // The announcement is always anchorless by convention (Sec.11), it's a
  // standalone callout, not a step in a running tutorial.
  const anchor = step?.anchor;
  const extraAnchors = step?.extraAnchors;

  // "Move this out of the way" (Sec.5.5-adjacent, a named, deliberate
  // escape hatch, same philosophy as `bypass`). Tracked against the step's
  // own key rather than a plain boolean so it always resets on any step
  // transition, including paging back to a step you'd previously moved
  // aside on. "moved aside" describes what you're doing right now, not a
  // preference that should survive leaving the step.
  const [asideState, setAsideState] = useState<{
    key: string | null;
    aside: boolean;
  }>({
    key: null,
    aside: false,
  });
  if (stepKey !== asideState.key) {
    setAsideState({ key: stepKey, aside: false });
  }
  const movedAside = asideState.aside;
  const moveAside = useCallback(() => {
    setAsideState({ key: stepKey, aside: true });
  }, [stepKey]);

  // A dropdown spoiler opening grows an anchorless callout. Re-centring would
  // shift its top edge, so those re-placements keep the top where it was and
  // only move up when the new height no longer fits below it.
  const positionRef = useRef(position);
  positionRef.current = position;
  const keepTopRef = useRef(false);
  useLayoutEffect(() => {
    keepTopRef.current = false;
  }, [stepKey]);

  const place = useCallback(() => {
    const callout = calloutRef.current;
    if (!callout) return;
    const calloutBox = callout.getBoundingClientRect();

    if (movedAside) {
      // Parked in a corner, independent of the anchor entirely; no
      // spotlight, nothing dimmed (the request this exists to satisfy: the
      // user asked to work unobstructed, so nothing should still be marked
      // as "look here").
      setSpotlightRects([]);
      const corner = step?.moveAsideCorner ?? "bottom-right";
      const top =
        corner === "top-right"
          ? VIEWPORT_MARGIN_PX
          : Math.max(
              VIEWPORT_MARGIN_PX,
              window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
            );
      const left = Math.max(
        VIEWPORT_MARGIN_PX,
        window.innerWidth - calloutBox.width - VIEWPORT_MARGIN_PX,
      );
      setPosition({ top, left });
      return;
    }

    const anchorEl = anchor ? resolveAnchor(anchor) : null;
    const anchorBox = anchorEl?.getBoundingClientRect() ?? null;
    const rects: DOMRect[] = [];
    if (anchorBox) rects.push(anchorBox);
    for (const extra of extraAnchors ?? []) {
      const extraBox = resolveAnchor(extra)?.getBoundingClientRect();
      if (extraBox) rects.push(extraBox);
    }
    setSpotlightRects(rects);

    // A step's `calloutNudge` (Sec.5.2-adjacent) shifts the otherwise-computed
    // position by a fixed amount, clamped to the same viewport margins as
    // every other placement, for the rare step where the default position
    // would land on top of something the step opens that ISN'T the anchor
    // (a dropdown triggered by a different control), which this algorithm
    // has no way to know about on its own. Deliberately pure add-then-clamp:
    // see `overlapsSpotlight` below for why anything cleverer belongs there
    // instead, checked against the actual result, not guessed from the
    // nudge amount.
    const nudge = step?.calloutNudge;
    function applyNudge(pos: Placement): Placement {
      if (!nudge) return pos;
      const top = Math.min(
        Math.max(pos.top + (nudge.y ?? 0), VIEWPORT_MARGIN_PX),
        Math.max(
          VIEWPORT_MARGIN_PX,
          window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
        ),
      );
      const left = Math.min(
        Math.max(pos.left + (nudge.x ?? 0), VIEWPORT_MARGIN_PX),
        Math.max(
          VIEWPORT_MARGIN_PX,
          window.innerWidth - calloutBox.width - VIEWPORT_MARGIN_PX,
        ),
      );
      return { top, left };
    }

    // The actual invariant every branch below is trying to guess its way
    // toward: the callout must not overlap anything spotlighted. Clamping
    // a nudge to the viewport only guarantees staying ON-SCREEN, not
    // staying clear of the anchor — for a tab far enough into the strip
    // (Connections, Objects), the rightmost on-screen position can still
    // sit to the LEFT of where the tab itself ends on a merely-narrow-ish
    // window, which is how "beside, nudged, clamped" kept landing back on
    // top of Hills/Cliffs/Trees/"A road to the hill"'s own tab even after
    // the clamp-detection heuristic (tuned to the nudge amount, not the
    // real geometry) was removed. Checked directly against `rects` instead
    // of inferred from whether a clamp "bit": exact, and correct for any
    // anchor shape, not just the tab-strip case that prompted it.
    function overlapsSpotlight(pos: Placement): boolean {
      const right = pos.left + calloutBox.width;
      const bottom = pos.top + calloutBox.height;
      return rects.some(
        (r) =>
          pos.left < r.right &&
          right > r.left &&
          pos.top < r.bottom &&
          bottom > r.top,
      );
    }

    // Guaranteed clear of everything spotlighted: below the lowest rect
    // (flipping above only if even that overflows the viewport), pinned as
    // far right as the viewport allows so it also stays off the breakdown
    // pane's own left side. The one placement this function trusts without
    // re-checking, since "below/above the union of every highlighted rect"
    // cannot overlap any individual one of them by construction.
    function belowSpotlight(): Placement {
      const maxBottom =
        rects.length > 0
          ? Math.max(...rects.map((r) => r.bottom))
          : (anchorBox?.bottom ?? 0);
      const minTop =
        rects.length > 0
          ? Math.min(...rects.map((r) => r.top))
          : (anchorBox?.top ?? 0);
      let top = maxBottom + GAP_PX;
      if (top + calloutBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
        const above = minTop - GAP_PX - calloutBox.height;
        top =
          above >= VIEWPORT_MARGIN_PX
            ? above
            : Math.max(
                VIEWPORT_MARGIN_PX,
                window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
              );
      }
      const left = Math.max(
        VIEWPORT_MARGIN_PX,
        window.innerWidth - calloutBox.width - VIEWPORT_MARGIN_PX,
      );
      return { top, left };
    }

    // Every branch below funnels through this: compute a candidate the
    // normal way, fall back to `belowSpotlight()` if it still overlaps.
    function commitPosition(pos: Placement): void {
      setPosition(overlapsSpotlight(pos) ? belowSpotlight() : pos);
    }

    // Inside the anchor's corner, ahead of every beside/below rule. Those
    // would put the Code tab's callout on the preview panel to the editor's
    // left. There is deliberately no "too big" fallback to those rules. A
    // step with several open hints is the tallest callout there is, and
    // falling back is what put it back on the preview. A tall callout grows
    // upward instead, stopping at the top of the anchor.
    if (
      anchorBox &&
      step?.calloutInsideAnchor === "bottom-right" &&
      calloutBox.width + 2 * GAP_PX <= anchorBox.width
    ) {
      setPosition({
        top: Math.max(
          VIEWPORT_MARGIN_PX,
          Math.min(
            Math.max(
              anchorBox.top + GAP_PX,
              anchorBox.bottom - calloutBox.height - GAP_PX,
            ),
            window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
          ),
        ),
        left: Math.max(
          VIEWPORT_MARGIN_PX,
          Math.min(
            anchorBox.right - calloutBox.width - GAP_PX,
            window.innerWidth - calloutBox.width - VIEWPORT_MARGIN_PX,
          ),
        ),
      });
      return;
    }

    if (!anchorBox) {
      const previous = positionRef.current;
      const centredTop = Math.max(
        VIEWPORT_MARGIN_PX,
        (window.innerHeight - calloutBox.height) / 2,
      );
      const top =
        keepTopRef.current && previous
          ? Math.max(
              VIEWPORT_MARGIN_PX,
              Math.min(
                previous.top,
                window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
              ),
            )
          : centredTop;
      commitPosition(
        applyNudge({
          top,
          left: Math.max(
            VIEWPORT_MARGIN_PX,
            (window.innerWidth - calloutBox.width) / 2,
          ),
        }),
      );
      return;
    }

    // Prefer beside the anchor (right, then left) before below/above. Most
    // of this app's anchors that open something on click, the command
    // picker chief among them, expand straight downward from the anchor's
    // own rect, which is exactly where HelpTip's below-first popup
    // algorithm used to put this callout too, so the tutorial covered (and,
    // being pointer-events: auto, actually blocked clicks into) the very
    // control it was pointing at. Beside sidesteps that whole class rather
    // than special-casing the command picker.
    const fitsRight =
      anchorBox.right + GAP_PX + calloutBox.width + VIEWPORT_MARGIN_PX <=
      window.innerWidth;
    const fitsLeft =
      anchorBox.left - GAP_PX - calloutBox.width >= VIEWPORT_MARGIN_PX;

    if (fitsRight || fitsLeft) {
      const left = fitsRight
        ? anchorBox.right + GAP_PX
        : anchorBox.left - GAP_PX - calloutBox.width;
      let top = anchorBox.top;
      if (top + calloutBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
        top = Math.max(
          VIEWPORT_MARGIN_PX,
          window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
        );
      }
      commitPosition(applyNudge({ top, left }));
      return;
    }

    // Neither side has room (a narrow window, or a tab-strip anchor that
    // wrapped somewhere the beside test can't fit around). Same
    // prefer-below / flip-above fallback HelpTip.place() uses, but the
    // left position is pinned as far RIGHT as the viewport allows rather
    // than to the anchor's own left edge — an anchor near the left of a
    // narrow pane (a wrapped section tab, the tab strip's own tabs like
    // Cliff/Terrain) would otherwise drop the callout right back onto the
    // breakdown pane's own left side, the exact thing beside placement
    // was trying to avoid in the first place. Pin right, not to the
    // anchor, whenever beside doesn't fit.
    let top = anchorBox.bottom + GAP_PX;
    if (top + calloutBox.height + VIEWPORT_MARGIN_PX > window.innerHeight) {
      const above = anchorBox.top - GAP_PX - calloutBox.height;
      top =
        above >= VIEWPORT_MARGIN_PX
          ? above
          : Math.max(
              VIEWPORT_MARGIN_PX,
              window.innerHeight - calloutBox.height - VIEWPORT_MARGIN_PX,
            );
    }
    const left = Math.max(
      VIEWPORT_MARGIN_PX,
      window.innerWidth - calloutBox.width - VIEWPORT_MARGIN_PX,
    );
    commitPosition(applyNudge({ top, left }));
  }, [anchor, extraAnchors, movedAside, step]);

  const showingCallout = active !== null || announcement !== null;

  useLayoutEffect(() => {
    if (!showingCallout) {
      setPosition(null);
      setSpotlightRects([]);
      return;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    // Sec.5.2, poll while a check step is pending, because the anchor can
    // move for reasons neither event fires on (a card list growing as the
    // user adds commands). Cancelled the moment the step is satisfied,
    // manual, this is the announcement, or the callout has been moved
    // aside, parked in a corner, it no longer tracks the anchor at all.
    let frame: number | null = null;
    if (!movedAside && step?.completion.kind === "check" && !satisfied) {
      const loop = () => {
        place();
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (frame !== null) cancelAnimationFrame(frame);
    };
    // `activeTab` is a dependency purely to re-trigger `place()`, not read
    // inside it. A step's `navigate.tab` is applied by TutorialContext's own
    // (passive) useEffect, which runs AFTER this layout effect on the same
    // render that makes a step active, so on a step whose anchor lives in
    // the tab being switched TO (e.g. "This is what it really is" pointing
    // at the Code tab's Monaco editor), the very first `place()` call here
    // runs before that tab has mounted and finds nothing. For a `check` step
    // the rAF loop above self-corrects within a frame; a `manual` step has
    // no such loop, so its spotlight would otherwise never resolve. Once
    // `navigate.tab` actually flips `activeTab` a render later, this effect
    // re-runs and re-resolves against the now-mounted DOM.
  }, [showingCallout, place, step, satisfied, movedAside, activeTab]);

  const placeKeepingTop = useCallback(() => {
    keepTopRef.current = true;
    place();
  }, [place]);

  if (!showingCallout) return null;

  const positionStyle = position ?? {
    visibility: "hidden" as const,
    top: 0,
    left: 0,
  };
  const calloutStyle = step?.calloutMaxWidthPx
    ? { ...positionStyle, maxWidth: step.calloutMaxWidthPx }
    : positionStyle;

  return createPortal(
    <>
      {spotlightRects.length > 0 && (
        <>
          {/* One dim layer with N holes cut via an SVG mask, rather than N
              independent sets of "everything but this rect" divs. Two
              disjoint spotlights each covered by their own 4-band system
              would double-dim the area outside both of them (two stacked
              rgba layers) and, worse, a pixel inside spotlight A would still
              sit inside spotlight B's "everything but B" bands. A mask with
              one hole per rect is the only way multiple disjoint cutouts
              compose correctly. */}
          <svg className={styles.dimSvg} aria-hidden="true">
            <mask
              id="tutorial-spotlight-mask"
              maskUnits="userSpaceOnUse"
              x="0"
              y="0"
              width="100%"
              height="100%"
            >
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {spotlightRects.map((r, i) => (
                <rect
                  key={i}
                  x={r.left}
                  y={r.top}
                  width={r.width}
                  height={r.height}
                  fill="black"
                />
              ))}
            </mask>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              className={styles.dimFill}
              mask="url(#tutorial-spotlight-mask)"
            />
          </svg>
          {spotlightRects.map((r, i) => (
            <div
              key={i}
              className={styles.ring}
              style={{
                top: r.top,
                left: r.left,
                width: r.width,
                height: r.height,
              }}
            />
          ))}
        </>
      )}
      <div
        ref={calloutRef}
        className={
          wide ? `${styles.callout} ${styles.calloutWide}` : styles.callout
        }
        style={calloutStyle}
      >
        {announcement ? (
          <AnnouncementCallout
            title={announcement.title}
            body={announcement.steps[0]?.body ?? []}
            onContentResize={place}
            onShowMe={showAnnouncementTour}
            onNotNow={dismissAnnouncement}
          />
        ) : active && step ? (
          <StepCallout
            key={stepKey}
            step={step}
            stepIndex={active.stepIndex}
            total={active.steps.length}
            tutorialId={active.definition.id}
            satisfied={satisfied}
            movedAside={movedAside}
            onMoveAside={moveAside}
            onBack={back}
            onNext={next}
            onChoose={choose}
            onExit={exit}
            onContentResize={place}
            onDropdownToggle={placeKeepingTop}
            onAutoFill={
              step.autoFill
                ? () => {
                    const edit = step.autoFill?.buildEdit(stepContext);
                    if (edit) applyTextEdits([edit]);
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </>,
    document.body,
  );
}

/**
 * The RMS Discord and Buy Me a Coffee links every What's New shows, in both
 * of its forms (the popup after an upgrade, and its first step opened from
 * the Help menu). Both open into the user's own browser, never a webview
 * with no address bar or back button.
 */
function SupportLinks() {
  function open(url: string, what: string) {
    openUrl(url).catch((error: unknown) => {
      console.error(`Failed to open the ${what}`, error);
    });
  }
  return (
    <div className={styles.supportRow}>
      {RMS_DISCORD_URL !== "" && (
        <>
          <HelpTip id="tutorial.discordLink">
            <button
              type="button"
              className={styles.discordLink}
              onClick={() => open(RMS_DISCORD_URL, "RMS Discord invite")}
            >
              RMS Discord ↗
            </button>
          </HelpTip>
          <span aria-hidden="true"> · </span>
        </>
      )}
      <HelpTip id="tutorial.supportLink">
        <button
          type="button"
          className={styles.discordLink}
          onClick={() => open(SUPPORT_URL, "Buy Me a Coffee page")}
        >
          ☕ Buy me a coffee ↗
        </button>
      </HelpTip>
    </div>
  );
}

function AnnouncementCallout({
  title,
  body,
  onShowMe,
  onNotNow,
  onContentResize,
}: {
  title: string;
  body: readonly BodyBlock[];
  onContentResize: () => void;
  onShowMe: () => void;
  onNotNow: () => void;
}) {
  return (
    <>
      <h3 className={styles.title}>{title}</h3>
      <StepBody blocks={body} onContentResize={onContentResize} />
      <SupportLinks />
      <div className={styles.controls}>
        <span className={styles.spacer} />
        <HelpTip id="tutorial.announcementNotNow">
          <button type="button" className={styles.button} onClick={onNotNow}>
            Not now
          </button>
        </HelpTip>
        <HelpTip id="tutorial.announcementShowMe">
          <button
            type="button"
            className={`${styles.button} ${styles.primary}`}
            onClick={onShowMe}
          >
            Show me
          </button>
        </HelpTip>
      </div>
    </>
  );
}

function StepCallout({
  step,
  stepIndex,
  total,
  tutorialId,
  satisfied,
  movedAside,
  onMoveAside,
  onBack,
  onNext,
  onChoose,
  onExit,
  onContentResize,
  onDropdownToggle,
  onAutoFill,
}: {
  step: TutorialStep;
  stepIndex: number;
  total: number;
  tutorialId: string;
  satisfied: boolean;
  movedAside: boolean;
  onMoveAside: () => void;
  onBack: () => void;
  onNext: () => void;
  onChoose: (track: string) => void;
  onExit: () => void;
  /**
   * Re-runs placement after the callout changes height on its own, when an
   * image finishes loading or a spoiler opens. A `check` step's rAF loop
   * would catch that anyway, a `manual` step has no loop, and a centred
   * callout that grows downward ends up off centre, or off screen.
   */
  onContentResize: () => void;
  /** Like `onContentResize`, for a dropdown spoiler: keeps the callout's top edge. */
  onDropdownToggle: () => void;
  /** Present only when the step declares `autoFill`. Performs its edit. */
  onAutoFill?: () => void;
}) {
  const isCheck = step.completion.kind === "check";
  const isLast = stepIndex === total - 1;
  // tutorial-design.md Sec.9 / Sec.14 open question 1, Tutorial A's final
  // step shows the Discord invite as a real link, opened the same way
  // TitleBar's DE RMS Guide item is (openUrl into the user's own browser,
  // never a webview with no address bar or back button).
  const showDiscordLink =
    tutorialId === "rms-basics" && isLast && RMS_DISCORD_URL !== "";

  function openDiscord() {
    openUrl(RMS_DISCORD_URL).catch((error: unknown) => {
      console.error("Failed to open the RMS Discord invite", error);
    });
  }

  // The announcement step of every What's New tour carries the RMS Discord
  // and support links (SupportLinks). A What's New tour is an announcement
  // and not a lesson, so its exit button reads "Exit".
  const isWhatsNew = tutorialId.startsWith("whats-new-");
  const showSupportButton = isWhatsNew && stepIndex === 0;

  // Rendered in one of two slots outside the body. A picture between
  // paragraphs is an image block in `body` (types.ts).
  const imagePlacement = step.image?.placement ?? "top";
  const imageElement = step.image && (
    <img
      className={styles.image}
      src={step.image.src}
      alt={step.image.alt}
      onLoad={onContentResize}
    />
  );

  return (
    <>
      <div className={styles.counter}>
        {stepIndex + 1} / {total}
      </div>
      {imagePlacement === "top" && imageElement}
      <h3 className={styles.title}>
        {step.title}
        {isCheck && satisfied && (
          <span className={styles.tick} aria-label="done">
            ✓
          </span>
        )}
      </h3>
      <StepBody
        blocks={step.body}
        onContentResize={onContentResize}
        onDropdownToggle={onDropdownToggle}
      />
      {showDiscordLink && (
        <HelpTip id="tutorial.discordLink">
          <button
            type="button"
            className={styles.discordLink}
            onClick={openDiscord}
          >
            Join the RMS Discord ↗
          </button>
        </HelpTip>
      )}
      {showSupportButton && <SupportLinks />}
      {isCheck && !satisfied && step.hint && (
        <p className={styles.hint}>{step.hint}</p>
      )}
      {imagePlacement === "bottom" && imageElement}
      <div className={styles.controls}>
        <HelpTip id="tutorial.back">
          <button
            type="button"
            className={styles.button}
            onClick={onBack}
            disabled={stepIndex === 0}
          >
            Back
          </button>
        </HelpTip>
        <span className={styles.spacer} />
        {step.anchor && !movedAside && (
          <HelpTip id="tutorial.moveAside">
            <button
              type="button"
              className={styles.button}
              onClick={onMoveAside}
            >
              Move this out of the way
            </button>
          </HelpTip>
        )}
        {step.autoFill && onAutoFill && !satisfied && (
          <HelpTip id="tutorial.autoFill">
            <button
              type="button"
              className={styles.button}
              onClick={onAutoFill}
            >
              {step.autoFill.label}
            </button>
          </HelpTip>
        )}
        {step.bypass && (
          <HelpTip
            id="tutorial.bypass"
            text="Moves on without doing this step. Mechanically the same as Next."
          >
            <button type="button" className={styles.button} onClick={onNext}>
              {step.bypass.label}
            </button>
          </HelpTip>
        )}
        {/* A choice step's options stand in for Next. Next beside them would
            be a third answer to a two way question, and Sec.2.2's "you can
            always move on" still holds, since either option moves on. */}
        {step.choice ? (
          step.choice.options.map((option) => (
            <HelpTip key={option.track} id="tutorial.choice" text={option.help}>
              <button
                type="button"
                className={`${styles.button} ${styles.primary}`}
                onClick={() => onChoose(option.track)}
              >
                {option.label}
              </button>
            </HelpTip>
          ))
        ) : (
          <HelpTip id="tutorial.next">
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={onNext}
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </HelpTip>
        )}
        <HelpTip id="tutorial.exit">
          <button type="button" className={styles.exit} onClick={onExit}>
            {isWhatsNew ? "Exit" : "Exit tutorial"}
          </button>
        </HelpTip>
      </div>
    </>
  );
}
