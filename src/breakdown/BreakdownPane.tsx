import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import { buildLanguageIndex, type LanguageData } from "../parser/language";
import type { ParseResult, Span } from "../parser/types";
import { PlaceholderPane } from "../components/PlaceholderPane";
import { BreakdownProvider } from "./BreakdownContext";
import { applyEditIntent, type ApplyTextEdit } from "./applyEdit";
import { shiftAnchors, isAnchoredWithin, type OffsetEdit } from "./ephemeralAnchors";
import { findItemAtOffset } from "./selectionResolve";
import { extractComments } from "./comments";
import type { EditIntent } from "./patch/intents";
import type { SharedSelectionApi } from "../hooks/useSharedSelection";
import { BreakdownSidePanel } from "./sidepanel/BreakdownSidePanel";
import { SectionTabs } from "./SectionTabs";
import { SectionView } from "./SectionView";
import { buildSectionTabs } from "./sectionTabsModel";
import type { GameConstantsData } from "./gameConstants";
import styles from "./BreakdownPane.module.css";

// Same double-cast reasoning as parserWorker.ts / aoe2RmsHover.ts: the
// JSON's TS-inferred literal type doesn't necessarily structurally
// overlap with the hand-written interface closely enough for a
// single-step cast; validate:reference (ajv) is the real guarantee.
const languageData = languageDataRaw as unknown as LanguageData;
const languageIndex = buildLanguageIndex(languageData);
const gameConstants = gameConstantsRaw as unknown as GameConstantsData;

interface BreakdownPaneProps {
  hasFile: boolean;
  source: string;
  parseResult: ParseResult | null;
  /** From useDocument (§6.4) — pushes a TextEdit onto the shared Monaco model. */
  applyTextEdit: ApplyTextEdit;
  /** From useParsedDocument (§6.2) — BUG-001 Part B, bypasses the debounce for a programmatic edit's reparse. */
  reparseNow: (source: string) => void;
  /**
   * Ash's post-3.9 follow-up: card selection is now owned by App (see
   * useSharedSelection), not this component, specifically so it survives
   * this component unmounting on every Breakdown -> Code tab switch.
   */
  selection: SharedSelectionApi;
}

// docs/breakdown-design.md — the Breakdown editor. As of 3.4, wired to the
// text-patch engine (§4): every card action becomes an EditIntent,
// computeEdit() turns it into a TextEdit, and applyTextEdit (§6.4) pushes
// it onto the shared Monaco model, which drives useParsedDocument's
// reparse and re-renders this tree from the new AST. Ephemeral UI state
// (expansion, focus) is anchored to source offsets (§6.3), owned here so
// it survives the reparse that replaces `parseResult` on every edit.
export function BreakdownPane({ hasFile, source, parseResult, applyTextEdit, reparseNow, selection }: BreakdownPaneProps) {
  const tabs = useMemo(() => (parseResult ? buildSectionTabs(parseResult.script) : []), [parseResult]);
  // Comments are pure trivia (see comments.ts) — re-derived from the full
  // token stream on every parse, same as `tabs` above.
  const comments = useMemo(() => (parseResult ? extractComments(parseResult.tokens) : []), [parseResult]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // §6.3 expansion anchors: a set of source offsets captured at
  // expand-time (a card's span.start). A card renders expanded iff some
  // anchor falls within its current span (isAnchoredWithin).
  const [expandedAnchors, setExpandedAnchors] = useState<Set<number>>(new Set());

  // §3.9 — single-select. As of the post-3.9 cross-tab-sync follow-up,
  // the anchor itself lives in App (useSharedSelection) so it survives
  // this component unmounting on a tab switch; `selection` below is
  // where all of isSelected/selectCard/clearSelection/selectedItem now
  // come from.

  // §6.3/§4.11 focus restoration: editors register themselves (by their
  // own current anchor offset) here as they mount/update; a pending
  // request is resolved by exact-offset lookup once the pane re-renders
  // from the next parse (computeEdit's `caret` is already a valid
  // NEW-source offset — see applyEdit call site below).
  const focusableRef = useRef(new Map<number, HTMLElement>());
  const pendingFocusRef = useRef<number | null>(null);

  const registerFocusable = useCallback((offset: number, el: HTMLElement | null) => {
    if (el) focusableRef.current.set(offset, el);
    else focusableRef.current.delete(offset);
  }, []);

  const requestFocus = useCallback((offset: number) => {
    pendingFocusRef.current = offset;
  }, []);

  // Runs after every re-render driven by a fresh parseResult (i.e. after
  // a reparse following an edit) — tries to resolve a pending focus
  // request against whatever registered itself at that exact offset this
  // render. If nothing registered there (e.g. the caret pointed inside a
  // still-collapsed card), the request is silently dropped rather than
  // guessing.
  useEffect(() => {
    const offset = pendingFocusRef.current;
    if (offset === null) return;
    const el = focusableRef.current.get(offset);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }
    pendingFocusRef.current = null;
  }, [parseResult]);

  const isExpanded = useCallback((span: Span) => isAnchoredWithin(expandedAnchors, span), [expandedAnchors]);

  const toggleExpanded = useCallback((span: Span) => {
    setExpandedAnchors((prev) => {
      const next = new Set(prev);
      if (isAnchoredWithin(prev, span)) {
        for (const a of prev) if (a >= span.start && a < span.end) next.delete(a);
      } else {
        next.add(span.start);
      }
      return next;
    });
  }, []);

  // BUG-001 (docs/known-issues.md) — Part A: don't shift expandedAnchors
  // eagerly. expandedAnchors used to shift synchronously with the edit
  // (same tick), while `parseResult` only catches up ~150ms+worker-round-
  // trip later (the debounced reparse). For that window the UI rendered
  // NEW anchors against the OLD AST, and a delete's negative Δ moved
  // every later anchor backward into the wrong (preceding) card's span —
  // visibly "wrong card expands for a moment, then corrects itself".
  //
  // Fix: queue the shift with the exact source it's only valid once
  // rendered, and apply it in the effect below, once `source` (the
  // currently-rendered parse's source, from useParsedDocument) actually
  // equals that expected string — i.e. once shift and AST are guaranteed
  // to be in the same coordinate space, so both flip in one commit.
  // `expectedSourceRef` chains sequential edits (each computed from the
  // PREVIOUS edit's expected result, not the possibly-stale `source`
  // prop), so a rapid burst of edits before any reparse lands still
  // queues correctly-ordered shifts rather than computing every one from
  // the same stale baseline.
  const pendingAnchorShiftsRef = useRef<{ edit: OffsetEdit; expectedSource: string }[]>([]);
  const expectedSourceRef = useRef<string | null>(null);

  const applyEdit = useCallback(
    (intent: EditIntent) => {
      if (!parseResult) return null;
      // Rapid-action fix (Ash's "over-deletes when I delete a bunch of
      // cards fast" report): `computeEdit` inside applyEditIntent only
      // knows about THIS `parseResult` — the last CONFIRMED parse — but if
      // a previous card action already landed on the model while ITS
      // reparse is still in flight (tracked right here in
      // pendingAnchorShiftsRef), that prior edit already shifted the
      // model's real text out from under this one's stale offsets. Passing
      // the still-pending edits lets applyEditIntent rebase this edit
      // through them (or bail out as PatchError-unavailable if the two
      // genuinely overlap) instead of blindly splicing stale offsets into
      // already-shifted text — which is exactly what corrupted an
      // unrelated command when deleting several cards back-to-back.
      const priorEdits = pendingAnchorShiftsRef.current.map((p) => p.edit);
      const result = applyEditIntent(parseResult, intent, languageIndex, applyTextEdit, priorEdits);
      if (result) {
        const baseSource = expectedSourceRef.current ?? source;
        const expectedSource =
          baseSource.slice(0, result.edit.start) + result.edit.newText + baseSource.slice(result.edit.end);
        expectedSourceRef.current = expectedSource;
        pendingAnchorShiftsRef.current.push({ edit: result.edit, expectedSource });
        // Part B: request an immediate reparse of the exact source we
        // just computed, instead of waiting on the 150ms typing debounce
        // — a card action is one discrete event, nothing to coalesce.
        // Safe even if a second edit supersedes this one before it
        // resolves (see reparseNow's own doc comment).
        reparseNow(expectedSource);
      }
      return result;
    },
    [parseResult, applyTextEdit, source, reparseNow],
  );

  // Resolves queued anchor shifts once their expected source has
  // actually rendered. Walks the queue from the front: if `source`
  // matches some entry (not necessarily the first — a superseded
  // intermediate edit's exact source may never itself render, since
  // useParsedDocument drops out-of-order responses), every entry up to
  // and including that match is now safe to apply, in order, in one
  // state update (one commit — no visible intermediate frame). If
  // `source` matches nothing in the queue at all, something else changed
  // the document (e.g. manual Code-tab typing racing a Breakdown edit) —
  // drop the stale queue rather than waiting forever; the alternative is
  // a permanently stuck queue that stops shifting for every future edit
  // too. Losing a queued shift in that rare collision case is an
  // acceptable trade against that.
  useEffect(() => {
    const pending = pendingAnchorShiftsRef.current;
    if (pending.length === 0) return;
    const matchedUpTo = pending.findIndex((p) => p.expectedSource === source);
    if (matchedUpTo === -1) {
      pendingAnchorShiftsRef.current = [];
      expectedSourceRef.current = null;
      return;
    }
    const toApply = pending.slice(0, matchedUpTo + 1);
    pendingAnchorShiftsRef.current = pending.slice(matchedUpTo + 1);
    if (pendingAnchorShiftsRef.current.length === 0) {
      expectedSourceRef.current = null;
    }
    setExpandedAnchors((prev) => {
      let next = prev;
      for (const { edit } of toApply) next = shiftAnchors(next, edit);
      return next;
    });
  }, [source]);

  // Tab switch clears selection (§3.9 — the selected card is no longer
  // on screen, and an off-screen insert anchor is exactly the surprise
  // this feature exists to remove). This is a SECTION-tab switch inside
  // Breakdown — distinct from the top-level Breakdown/Code tab switch,
  // which must NOT clear it (that's the whole point of lifting selection
  // to App).
  const handleSelectTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
      selection.clearSelection();
    },
    [selection],
  );

  // Post-3.9 cross-tab sync, mount-only: BreakdownPane mounting means the
  // user either just switched TO Breakdown (from Code, or app startup)
  // — either way, `selection.selectedItem` may already point at
  // something set from the Code tab's last cursor position. Jump to
  // whichever section tab contains it and queue a scroll so the same
  // card that was "in view" in Code is back in view here. Deliberately
  // runs once (mount only): a click on a DIFFERENT card later in the same
  // Breakdown session must not re-trigger a tab jump — the user is
  // already looking at the right tab when that happens.
  //
  // Uses `selectedItem.span.start` here, NOT the raw `selectedAnchor` —
  // the anchor is wherever the Code-tab cursor happened to land, which is
  // usually somewhere in the MIDDLE of a command, not its span.start.
  // ItemCard's `data-anchor` attribute (below) is keyed on span.start, so
  // scrolling by the raw anchor would silently miss every element that
  // isn't already selected right at its opening character — which is
  // exactly why the scroll previously landed nowhere (selection itself
  // still worked because isSelected does a range check, not exact match).
  const pendingScrollAnchorRef = useRef<number | null>(null);
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (didMountSyncRef.current) return;
    didMountSyncRef.current = true;
    const item = selection.selectedItem;
    if (!item || tabs.length === 0) return;
    const anchor = item.span.start;
    for (const tab of tabs) {
      if (findItemAtOffset(tab.items, anchor)) {
        setActiveTabId(tab.id);
        pendingScrollAnchorRef.current = anchor;
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-only; see comment above.
  }, []);

  // Resolves the queued scroll once the target tab has actually rendered
  // the card (data-anchor is set on every ItemCard, see ItemCard.tsx).
  useEffect(() => {
    const anchor = pendingScrollAnchorRef.current;
    if (anchor === null) return;
    const el = document.querySelector(`[data-anchor="${anchor}"]`);
    if (el) {
      el.scrollIntoView({ block: "center" });
      pendingScrollAnchorRef.current = null;
    }
  }, [activeTabId, parseResult]);

  if (!hasFile) {
    return <PlaceholderPane description="Open an .rms file (File > Open) to see its Breakdown here." />;
  }
  if (!parseResult) {
    return <PlaceholderPane description="Parsing…" />;
  }

  // Default active tab: Header if present, else the first canonical
  // section, falling back to whatever tab exists.
  const resolvedActiveId = activeTabId && tabs.some((t) => t.id === activeTabId) ? activeTabId : (tabs[0]?.id ?? null);
  const activeTab = tabs.find((t) => t.id === resolvedActiveId) ?? null;

  return (
    <BreakdownProvider
      value={{
        tokens: parseResult.tokens,
        lang: languageIndex,
        diagnostics: parseResult.diagnostics,
        source,
        gameConstants,
        parseResult,
        applyEdit,
        isExpanded,
        toggleExpanded,
        requestFocus,
        registerFocusable,
        isSelected: selection.isSelected,
        selectCard: selection.selectCard,
        clearSelection: selection.clearSelection,
        selectedItem: selection.selectedItem,
        comments,
        expandedAnchors,
      }}
    >
      <div className={styles.pane}>
        <BreakdownSidePanel />
        <div className={styles.main}>
          <SectionTabs
            tabs={tabs}
            activeId={resolvedActiveId ?? ""}
            onSelect={handleSelectTab}
            diagnostics={parseResult.diagnostics}
          />
          {activeTab ? (
            <SectionView tab={activeTab} />
          ) : (
            <PlaceholderPane description="No sections found." />
          )}
        </div>
      </div>
    </BreakdownProvider>
  );
}
