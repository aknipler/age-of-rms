import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import languageDataRaw from "../../reference/data/language.json";
import gameConstantsRaw from "../../reference/data/game-constants.json";
import { buildLanguageIndex, type LanguageData } from "../parser/language";
import type { ParseResult, Span } from "../parser/types";
import { PlaceholderPane } from "../components/PlaceholderPane";
import { BreakdownProvider, type CommitNote } from "./BreakdownContext";
import { applyEditIntent, type ApplyTextEdits } from "./applyEdit";
import { canActOnCard, canRearrangeItem } from "./cardKind";
import { editsOf } from "./patch/computeEdit";
import { siblingMoveTarget } from "./selectionResolve";
import {
  shiftAnchors,
  isAnchoredWithin,
  type OffsetEdit,
} from "./ephemeralAnchors";
import { findItemAtOffset } from "./selectionResolve";
import {
  rememberCollapse,
  restoreTarget,
  type CollapseMemory,
} from "./scrollMemory";
import { extractComments } from "./comments";
import { useEditorFocusKeeper } from "./editorFocus";
import type {
  DraggableCard,
  EditIntent,
  InsertTarget,
  RearrangeableNode,
} from "./patch/intents";
import type { SharedSelectionApi } from "../hooks/useSharedSelection";
import { useHotkeySettings } from "../settings/HotkeySettingsContext";
import {
  cycleDirection,
  isPlainDeleteKey,
  isTextEntryTarget,
  matchesHotkey,
} from "../settings/hotkeys";
import { isSidePanelKeyEvent } from "../settings/focusRegion";
import { useBreakdownSettings } from "../settings/BreakdownSettingsContext";
import {
  useCurrentFilePath,
  useDiagnosticDismissal,
} from "../settings/DiagnosticDismissalContext";
import { SectionTabs } from "./SectionTabs";
import { SectionView } from "./SectionView";
import { adjacentSectionId, buildSectionTabs } from "./sectionTabsModel";
import {
  rememberFocusId,
  rememberShownIds,
  rememberedFocusId,
  rememberedShownIds,
  resolveShownIds,
  shownAfterTabClick,
  shownAfterToggle,
} from "./viewScope";
import {
  nextSelection,
  type ClickMode,
  type SelectableCard,
} from "./multiSelect";
import { useRegisterNavigator } from "../tutorial/TutorialContext";
import type { GameConstantsData } from "./gameConstants";
import styles from "./BreakdownPane.module.css";

// Same double-cast reasoning as parserWorker.ts / aoe2RmsHover.ts: the
// JSON's TS-inferred literal type doesn't necessarily structurally
// overlap with the hand-written interface closely enough for a
// single-step cast; validate:reference (ajv) is the real guarantee.
const languageData = languageDataRaw as unknown as LanguageData;
const languageIndex = buildLanguageIndex(languageData);
const gameConstants = gameConstantsRaw as unknown as GameConstantsData;

/**
 * settings.breakdown.density's actual effect: every card-internal
 * stylesheet (cards.module.css, CommandCard.module.css,
 * AttributeRow.module.css) reads these as `var(--bd-x, <comfortable
 * default>)`, so comfortable density sets nothing here and every rule just
 * falls back to its own default. Same "settings drive CSS custom
 * properties" pattern ThemeSettingsContext uses for colour tokens, just
 * scoped to this pane's own DOM subtree via inline style rather than
 * documentElement, since density is a Breakdown-only concept.
 */
const COMPACT_DENSITY_STYLE: Record<string, string> = {
  "--bd-card-padding": "0.15rem 0.35rem",
  "--bd-row-padding": "0.05rem 0.2rem",
  "--bd-row-gap": "0.05rem",
  "--bd-group-gap": "0.3rem",
};

interface BreakdownPaneProps {
  hasFile: boolean;
  source: string;
  parseResult: ParseResult | null;
  /** From useDocument (Sec.6.4), pushes one intent's TextEdits onto the shared Monaco model as one undo entry. */
  applyTextEdits: ApplyTextEdits;
  /** From useParsedDocument (Sec.6.2), BUG-001 Part B, bypasses the debounce for a programmatic edit's reparse. */
  reparseNow: (source: string) => void;
  /**
   * Card selection is now owned by App (see
   * useSharedSelection), not this component, specifically so it survives
   * this component unmounting on every Breakdown -> Code tab switch.
   */
  selection: SharedSelectionApi;
}

// docs/breakdown-design.md, the Breakdown editor. As of 3.4, wired to the
// text-patch engine (Sec.4): every card action becomes an EditIntent,
// computeEdit() turns it into a TextEdit, and applyTextEdit (Sec.6.4) pushes
// it onto the shared Monaco model, which drives useParsedDocument's
// reparse and re-renders this tree from the new AST. Ephemeral UI state
// (expansion, focus) is anchored to source offsets (Sec.6.3), owned here so
// it survives the reparse that replaces `parseResult` on every edit.
export function BreakdownPane({
  hasFile,
  source,
  parseResult,
  applyTextEdits,
  reparseNow,
  selection,
}: BreakdownPaneProps) {
  const tabs = useMemo(
    () => (parseResult ? buildSectionTabs(parseResult.script) : []),
    [parseResult],
  );
  // Comments are pure trivia (see comments.ts), re-derived from the full
  // token stream on every parse, same as `tabs` above.
  const comments = useMemo(
    () => (parseResult ? extractComments(parseResult.tokens) : []),
    [parseResult],
  );
  // Which sections are on screen and which one Add writes to (2026-10-21,
  // Sec.3.1.1 and viewScope.ts). Seeded from the session memory, since this
  // component unmounts on every switch to the Code tab, and written back on
  // every change through the two setters below rather than in an effect,
  // so the memory is never a render behind.
  const [shownIdsState, setShownIdsState] = useState<readonly string[]>(
    () => rememberedShownIds() ?? [],
  );
  const [focusIdState, setFocusIdState] = useState<string | null>(() =>
    rememberedFocusId(),
  );
  const setShownIds = useCallback((ids: readonly string[]) => {
    rememberShownIds(ids);
    setShownIdsState(ids);
  }, []);
  const setFocusId = useCallback((id: string | null) => {
    rememberFocusId(id);
    setFocusIdState(id);
  }, []);
  // Derived every render from the tabs this parse produced, so a remembered
  // id this file lacks simply drops out (resolveShownIds).
  const shownIds = useMemo(
    () =>
      resolveShownIds(
        tabs.map((t) => t.id),
        shownIdsState.length > 0 ? shownIdsState : null,
      ),
    [tabs, shownIdsState],
  );
  const shownTabs = useMemo(
    () => tabs.filter((t) => shownIds.includes(t.id)),
    [tabs, shownIds],
  );
  /** The tab a card offset belongs to, or null. */
  // A comment card's offset is in no item (2026-10-22, comment cards became
  // selectable), so it is found by the section span holding it, and before
  // the first section it is the Header tab's.
  const tabIdAt = useCallback(
    (offset: number) => {
      const byItem = tabs.find((t) => findItemAtOffset(t.items, offset));
      if (byItem) return byItem.id;
      const bySection = tabs.find((t) =>
        t.sections.some((s) => offset >= s.span.start && offset < s.span.end),
      );
      if (bySection) return bySection.id;
      const first = parseResult?.script.sections[0];
      return !first || offset < first.span.start ? "header" : null;
    },
    [tabs, parseResult],
  );
  // Focus follows the selected card when it is on screen, else the section
  // last clicked, else the first shown one. Derived rather than stored, so
  // the selection and the "Terrain:" label can never disagree.
  const selectedTabId = selection.primaryCard
    ? tabIdAt(selection.primaryCard.span.start)
    : null;
  const focusTab =
    shownTabs.find((t) => t.id === selectedTabId) ??
    shownTabs.find((t) => t.id === focusIdState) ??
    shownTabs[0] ??
    null;
  // A tab click in the stacked view scrolls to that section's heading once
  // it has rendered.
  const pendingSectionScrollRef = useRef<string | null>(null);
  // The warnings the user has not hidden, the same filter App applies for the
  // Code tab and the status bar (DiagnosticDismissalContext.tsx). Every badge,
  // the ruler and the section tabs read this list, so a hidden warning leaves
  // all of them at once.
  const dismissal = useDiagnosticDismissal();
  const filePath = useCurrentFilePath();
  const diagnostics = useMemo(
    () => dismissal.visible(parseResult?.diagnostics ?? [], filePath),
    [dismissal, parseResult, filePath],
  );

  // Sec.6.3 expansion anchors: a set of source offsets captured at
  // expand-time (a card's span.start). A card renders expanded iff some
  // anchor falls within its current span (isAnchoredWithin).
  const [expandedAnchors, setExpandedAnchors] = useState<Set<number>>(
    new Set(),
  );

  // Sec.3.9, single-select. As of the post-3.9 cross-tab-sync follow-up,
  // the anchor itself lives in App (useSharedSelection) so it survives
  // this component unmounting on a tab switch; `selection` below is
  // where all of isSelected/selectCard/clearSelection/selectedItem now
  // come from.

  // Sec.6.3/Sec.4.11 focus restoration: editors register themselves (by their
  // own current anchor offset) here as they mount/update; a pending
  // request is resolved by exact-offset lookup once the pane re-renders
  // from the next parse (computeEdit's `caret` is already a valid
  // NEW-source offset, see applyEdit call site below).
  const focusableRef = useRef(new Map<number, HTMLElement>());
  const pendingFocusRef = useRef<number | (() => HTMLElement | null) | null>(
    null,
  );

  const registerFocusable = useCallback(
    (offset: number, el: HTMLElement | null) => {
      if (el) focusableRef.current.set(offset, el);
      else focusableRef.current.delete(offset);
    },
    [],
  );

  const requestFocus = useCallback(
    (target: number | (() => HTMLElement | null)) => {
      pendingFocusRef.current = target;
    },
    [],
  );

  // Gives focus back to the editor the user clicked into when the reparse
  // after an earlier field's blur-commit replaced it (editorFocus.ts has the
  // whole story). Fed from the pending-shift effect further down.
  const focusKeeper = useEditorFocusKeeper(focusableRef);

  // Runs after every re-render driven by a fresh parseResult (i.e. after
  // a reparse following an edit), tries to resolve a pending focus
  // request against whatever registered itself at that exact offset this
  // render. If nothing registered there (e.g. the caret pointed inside a
  // still-collapsed card), the request is silently dropped rather than
  // guessing.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (target === null) return;
    const el =
      typeof target === "function"
        ? target()
        : focusableRef.current.get(target);
    if (el) {
      el.focus();
      // Selects the placeholder text (ValueEditor's default value, or
      // addComment's single placeholder space in CommentCard's textarea)
      // so typing replaces it outright instead of landing next to it.
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
        el.select();
    }
    pendingFocusRef.current = null;
    // expandedAnchors is a dependency too: a summary-line click (Sec.3.3,
    // beta feedback 2026-09-17) expands the card and asks for focus on an
    // editor that only mounts once the body renders, with no reparse in
    // between.
  }, [parseResult, expandedAnchors]);

  const isExpanded = useCallback(
    (span: Span) => isAnchoredWithin(expandedAnchors, span),
    [expandedAnchors],
  );

  // Collapse-strip scroll memory, keyed by the card's span.start at collapse
  // time. A ref, not state: nothing renders from it, it is read back inside
  // event handlers and effects only. Entries go stale the moment an edit
  // shifts offsets, which is fine, a stale key simply never matches and the
  // reopen leaves the viewport alone (scrollMemory.ts's own null answer).
  const collapseMemoryRef = useRef(new Map<number, CollapseMemory>());
  // Scroll work that has to wait for the next paint (the card has to be
  // collapsed or expanded in the DOM before its offsetTop means anything).
  const pendingScrollWorkRef = useRef<(() => void) | null>(null);

  const scrollContainerOf = (el: Element): HTMLElement | null =>
    el.closest<HTMLElement>("[data-breakdown-scroll]");

  const toggleExpanded = useCallback(
    (span: Span) => {
      // Reopen half of the collapse strip's memory: decide BEFORE the state
      // update whether this is a reopen we remember, then restore after
      // the expanded body has rendered.
      const memory = collapseMemoryRef.current.get(span.start);
      const wasExpanded = isAnchoredWithin(expandedAnchors, span);
      if (memory && !wasExpanded) {
        collapseMemoryRef.current.delete(span.start);
        pendingScrollWorkRef.current = () => {
          const el = document.querySelector<HTMLElement>(
            `[data-anchor="${span.start}"]`,
          );
          const container = el && scrollContainerOf(el);
          if (!el || !container) return;
          const target = restoreTarget(
            memory,
            container.scrollTop,
            el.offsetTop,
          );
          if (target !== null) container.scrollTop = target;
        };
      }
      setExpandedAnchors((prev) => {
        const next = new Set(prev);
        if (isAnchoredWithin(prev, span)) {
          for (const a of prev)
            if (a >= span.start && a < span.end) next.delete(a);
        } else {
          next.add(span.start);
        }
        return next;
      });
    },
    [expandedAnchors],
  );

  const expandCard = useCallback((span: Span) => {
    setExpandedAnchors((prev) => {
      if (isAnchoredWithin(prev, span)) return prev;
      const next = new Set(prev);
      next.add(span.start);
      return next;
    });
  }, []);

  const collapseFromStrip = useCallback((span: Span) => {
    const el = document.querySelector<HTMLElement>(
      `[data-anchor="${span.start}"]`,
    );
    const container = el && scrollContainerOf(el);
    if (el && container) {
      const memory = rememberCollapse(container.scrollTop, el.offsetTop);
      collapseMemoryRef.current.set(span.start, memory);
      pendingScrollWorkRef.current = () => {
        // The card is collapsed now, so its offsetTop is the collapsed
        // card's. Park it at the top of the list and record where that
        // left scrollTop (the browser clamps at the end of the list, so
        // read it back rather than assuming).
        container.scrollTop = el.offsetTop;
        memory.settledScrollTop = container.scrollTop;
      };
    }
    setExpandedAnchors((prev) => {
      if (!isAnchoredWithin(prev, span)) return prev;
      const next = new Set(prev);
      for (const a of prev) if (a >= span.start && a < span.end) next.delete(a);
      return next;
    });
  }, []);

  // Runs the queued scroll work once the expansion change has painted.
  // useLayoutEffect rather than useEffect so the scroll lands before the
  // frame is shown, no flash of the wrong position.
  useLayoutEffect(() => {
    const work = pendingScrollWorkRef.current;
    if (!work) return;
    pendingScrollWorkRef.current = null;
    work();
  }, [expandedAnchors]);

  // BUG-001 (docs/known-issues.md), Part A: don't shift expandedAnchors
  // eagerly. expandedAnchors used to shift synchronously with the edit
  // (same tick), while `parseResult` only catches up ~150ms+worker-round-
  // trip later (the debounced reparse). For that window the UI rendered
  // NEW anchors against the OLD AST, and a delete's negative Δ moved
  // every later anchor backward into the wrong (preceding) card's span,
  // visibly "wrong card expands for a moment, then corrects itself".
  //
  // Fix: queue the shift with the exact source it's only valid once
  // rendered, and apply it in the effect below, once `source` (the
  // currently-rendered parse's source, from useParsedDocument) actually
  // equals that expected string, i.e. once shift and AST are guaranteed
  // to be in the same coordinate space, so both flip in one commit.
  // `expectedSourceRef` chains sequential edits (each computed from the
  // PREVIOUS edit's expected result, not the possibly-stale `source`
  // prop), so a rapid burst of edits before any reparse lands still
  // queues correctly-ordered shifts rather than computing every one from
  // the same stale baseline.
  // Declared here (above the resolve effect that writes it) rather than
  // beside the mount-sync effect that first used it: revealAfterEdit's
  // scroll shares it.
  const pendingScrollAnchorRef = useRef<number | null>(null);
  const pendingAnchorShiftsRef = useRef<
    {
      edit: OffsetEdit;
      expectedSource: string;
      /** revealAfterEdit's request, an offset in expectedSource's coordinates, applied once the shift lands. */
      reveal?: {
        offset: number;
        scroll: boolean;
        expand: boolean;
        /** More cards to open in the same commit, a group move's other open cards. */
        alsoExpand?: readonly number[];
      };
    }[]
  >([]);
  const expectedSourceRef = useRef<string | null>(null);

  const applyEdit = useCallback(
    (intent: EditIntent) => {
      if (!parseResult) return null;
      // Rapid-action fix (over-deletes when deleting a bunch of
      // cards fast): `computeEdit` inside applyEditIntent only
      // knows about THIS `parseResult`, the last CONFIRMED parse, but if
      // a previous card action already landed on the model while ITS
      // reparse is still in flight (tracked right here in
      // pendingAnchorShiftsRef), that prior edit already shifted the
      // model's real text out from under this one's stale offsets. Passing
      // the still-pending edits lets applyEditIntent rebase this edit
      // through them (or bail out as PatchError-unavailable if the two
      // genuinely overlap) instead of blindly splicing stale offsets into
      // already-shifted text, which is exactly what corrupted an
      // unrelated command when deleting several cards back-to-back.
      const priorEdits = pendingAnchorShiftsRef.current.map((p) => p.edit);
      const result = applyEditIntent(
        parseResult,
        intent,
        languageIndex,
        applyTextEdits,
        priorEdits,
      );
      if (result) {
        // One queue entry per edit, highest offset first (editsOf's
        // order). A moveNode carries two edits in the same original
        // coordinates; applying the higher one first leaves the lower
        // one's offsets untouched, so each entry's `edit` is valid against
        // the source the entry before it produced, which is what
        // shiftAnchors and rebaseEdit both assume when they walk the queue.
        // The intermediate expectedSource (after only the first half) will
        // never render, and the resolving effect below already copes with
        // a superseded intermediate entry.
        let expectedSource = expectedSourceRef.current ?? source;
        for (const edit of editsOf(result)) {
          expectedSource =
            expectedSource.slice(0, edit.start) +
            edit.newText +
            expectedSource.slice(edit.end);
          pendingAnchorShiftsRef.current.push({ edit, expectedSource });
        }
        expectedSourceRef.current = expectedSource;
        // Part B: request an immediate reparse of the exact source we
        // just computed, instead of waiting on the 150ms typing debounce;
        // a card action is one discrete event, nothing to coalesce.
        // Safe even if a second edit supersedes this one before it
        // resolves (see reparseNow's own doc comment).
        reparseNow(expectedSource);
      }
      return result;
    },
    [parseResult, applyTextEdits, source, reparseNow],
  );

  // Name lookup, slice C. The note ties a committed name to the source its
  // offset belongs to, so the field can flash or show the create strip once
  // that source has rendered (BreakdownContext.tsx, CommitNote). `matched`
  // records that the note's source has been on screen, which is what lets the
  // effect below tell "the parse has not landed yet" from "the document has
  // moved on".
  const [constNote, setConstNote] = useState<CommitNote | null>(null);
  const constNoteMatchedRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  const noteCommit = useCallback(
    (name: string, anchor: number) => {
      // Called straight after applyEdit, which has just advanced
      // expectedSourceRef to the source this edit produces.
      constNoteMatchedRef.current = false;
      setConstNote({
        name,
        anchor,
        source: expectedSourceRef.current ?? source,
      });
    },
    [source],
  );
  const clearConstNote = useCallback(() => setConstNote(null), []);
  const announce = useCallback(
    (message: string) => setAnnouncement(message),
    [],
  );

  // A note is read only while its source is the rendered one. Once it has
  // been, any later source (another edit, an undo) retires it, so an undo
  // that happens to land on the same text does not bring a strip back.
  useEffect(() => {
    if (!constNote) return;
    if (constNote.source === source) constNoteMatchedRef.current = true;
    else if (constNoteMatchedRef.current) setConstNote(null);
  }, [constNote, source]);

  const { hotkeys, recordingId } = useHotkeySettings();
  const { density } = useBreakdownSettings();

  // Resolves queued anchor shifts once their expected source has
  // actually rendered. Walks the queue from the front: if `source`
  // matches some entry (not necessarily the first, a superseded
  // intermediate edit's exact source may never itself render, since
  // useParsedDocument drops out-of-order responses), every entry up to
  // and including that match is now safe to apply, in order, in one
  // state update (one commit, no visible intermediate frame). If
  // `source` matches nothing in the queue at all, something else changed
  // the document (e.g. manual Code-tab typing racing a Breakdown edit);
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
    // The new parse is on screen and its editors have registered, so a field
    // that was replaced under the user's cursor can be focused again.
    focusKeeper.restoreAfter(toApply.map((p) => p.edit));
    if (pendingAnchorShiftsRef.current.length === 0) {
      expectedSourceRef.current = null;
    }
    // A reveal rides on the LAST applied entry, so its offset is read
    // against the source now rendering, never re-shifted. Expanding is
    // one more anchor in the same commit as the shifts (the offset lands
    // inside the new card's span, which is all isAnchoredWithin needs).
    const reveal = toApply[toApply.length - 1]?.reveal;
    setExpandedAnchors((prev) => {
      let next = prev;
      for (const { edit } of toApply) next = shiftAnchors(next, edit);
      if (reveal?.expand) {
        next = new Set(next);
        next.add(reveal.offset);
      }
      if (reveal?.alsoExpand?.length) {
        next = new Set(next);
        for (const o of reveal.alsoExpand) next.add(o);
      }
      return next;
    });
    if (reveal?.scroll) {
      // The card's data-anchor is its span.start, which the caret is
      // usually inside rather than at, so resolve the item first. A
      // comment is not an item, its card carries the raw offset instead.
      let anchor = reveal.offset;
      for (const tab of tabs) {
        const item = findItemAtOffset(tab.items, reveal.offset);
        if (item) {
          anchor = item.span.start;
          break;
        }
      }
      if (reveal.expand) {
        // The setExpandedAnchors above lands in a LATER commit (it's a
        // state update, not a DOM mutation yet), so scrolling right now
        // would measure the card still in its collapsed height and land
        // wrong once it expands. Queue it as pending layout work instead,
        // same as toggleExpanded/collapseFromStrip above, so it runs
        // after the expanded card's real height is in the DOM.
        pendingScrollWorkRef.current = () => {
          const el = document.querySelector<HTMLElement>(
            `[data-anchor="${anchor}"]`,
          );
          el?.scrollIntoView({ block: "center" });
        };
      } else {
        // Nothing else changes this card's DOM for this reveal (a new
        // comment is already open), so scrolling immediately is safe.
        pendingScrollAnchorRef.current = anchor;
      }
    }
  }, [source, tabs, focusKeeper]);

  const revealAfterEdit = useCallback(
    (
      offset: number,
      scroll: boolean,
      expand = true,
      alsoExpand?: readonly number[],
    ) => {
      const pending = pendingAnchorShiftsRef.current;
      const last = pending[pending.length - 1];
      if (last) last.reveal = { offset, scroll, expand, alsoExpand };
    },
    [],
  );

  // Move a card somewhere else, or copy it below itself (2026-09-18).
  // Shared by the hotkeys below, the card's right-click menu
  // (CardMenu.tsx) and dragging (cardDrag.tsx), which is why both live
  // here beside applyEdit rather than in any one consumer. After the
  // edit the card is selected and keeps its expansion at its new
  // position. Both of those anchors sit inside the removed range and
  // would otherwise be dropped (the rev-4 rule), so they are
  // re-established once the parse lands, through the same pending queue
  // every other post-edit reveal rides on and the selection hook's own
  // equivalent (useShiftedAnchor's setAfterPending).
  const moveItem = useCallback(
    (item: DraggableCard, to: InsertTarget) => {
      const wasExpanded = isAnchoredWithin(expandedAnchors, item.span);
      const result = applyEdit({ kind: "moveNode", node: item, to });
      if (result) {
        revealAfterEdit(result.caret, true, wasExpanded);
        selection.selectAfterEdit(result.caret);
      }
    },
    [selection, applyEdit, expandedAnchors, revealAfterEdit],
  );
  const duplicateItem = useCallback(
    (item: RearrangeableNode) => {
      const result = applyEdit({ kind: "duplicateNode", node: item });
      if (result) {
        // The copy opens if the original was open, and takes the selection
        // so a second Duplicate stacks copies downward.
        revealAfterEdit(
          result.caret,
          true,
          isAnchoredWithin(expandedAnchors, item.span),
        );
        selection.selectAfterEdit(result.caret);
      }
    },
    [selection, applyEdit, expandedAnchors, revealAfterEdit],
  );
  // A group drop (2026-10-21, Sec.3.12). Every moved card keeps its own
  // open or closed state and the whole group stays selected, both through
  // the same after-the-parse queues moveItem uses.
  const moveItems = useCallback(
    (items: readonly DraggableCard[], to: InsertTarget) => {
      if (items.length === 1) {
        moveItem(items[0], to);
        return;
      }
      const wasExpanded = items.map((i) =>
        isAnchoredWithin(expandedAnchors, i.span),
      );
      const result = applyEdit({ kind: "moveNodes", nodes: [...items], to });
      if (!result?.selection) return;
      const starts = result.selection;
      revealAfterEdit(
        result.caret,
        true,
        wasExpanded[0],
        starts.filter((_, k) => k > 0 && wasExpanded[k]),
      );
      selection.selectManyAfterEdit(starts);
    },
    [selection, applyEdit, expandedAnchors, revealAfterEdit, moveItem],
  );
  // Delete every selected card that carries a Delete button of its own,
  // as one intent and so one undo entry. A selection of one takes the
  // removeNode path it always took. Selected comment cards go too
  // (2026-10-22), each by its own span.
  const deleteSelected = useCallback(() => {
    const cards = selection.selectedCards.filter(canActOnCard);
    if (cards.length === 0) return;
    const [only] = cards;
    if (cards.length > 1) applyEdit({ kind: "removeNodes", nodes: cards });
    else if (only.kind === "comment")
      applyEdit({ kind: "removeComment", span: only.span });
    else applyEdit({ kind: "removeNode", node: only });
  }, [selection.selectedCards, applyEdit]);
  // Comment cards out, or back in (2026-10-22, Sec.3.13). One intent, so one
  // undo entry however many cards. Re-selecting the results goes through the
  // after-the-parse queue for the same reason a move does: the old anchors
  // sit at an insert or inside a removal, and the new cards only exist once
  // the parse lands.
  const toggleCommentOut = useCallback(
    (cards: readonly DraggableCard[], reselect: boolean) => {
      if (cards.length === 0) return;
      const result = applyEdit({ kind: "toggleCommentOut", cards: [...cards] });
      if (reselect && result?.selection)
        selection.selectManyAfterEdit(result.selection);
    },
    [applyEdit, selection],
  );
  // A click on a card's chrome, with its modifier keys (ItemCard.tsx,
  // CommentCard.tsx). A selection never spans two sections
  // (multiSelect.ts's sameScope), so the section the clicked card is in
  // becomes the focus section.
  const clickCard = useCallback(
    (card: SelectableCard, mode: ClickMode) => {
      if (!parseResult) return;
      const sameScope = (a: SelectableCard, b: SelectableCard) =>
        tabIdAt(a.span.start) === tabIdAt(b.span.start);
      selection.setSelection(
        nextSelection<SelectableCard>(
          parseResult.script,
          selection.primaryCard,
          [...selection.extraItems, ...selection.extraComments],
          card,
          mode,
          sameScope,
          selection.places,
        ),
      );
      setFocusId(tabIdAt(card.span.start));
    },
    [parseResult, selection, tabIdAt, setFocusId],
  );
  const selectCard = useCallback(
    (span: Span) => {
      selection.selectCard(span);
      setFocusId(tabIdAt(span.start));
    },
    [selection, tabIdAt, setFocusId],
  );
  const rearrangeSelected = useCallback(
    (action: "up" | "down" | "duplicate") => {
      // One-card actions, so they stand down while several are selected,
      // comment cards counted.
      if (selection.selectedCards.length > 1) return;
      const item = selection.selectedItem;
      if (!item || !canRearrangeItem(item) || !parseResult) return;
      if (action === "duplicate") {
        duplicateItem(item);
        return;
      }
      const to = siblingMoveTarget(parseResult.script, item, action);
      if (to) moveItem(item, to);
    },
    [
      selection.selectedItem,
      selection.selectedCards,
      parseResult,
      moveItem,
      duplicateItem,
    ],
  );

  // Breakdown's own card hotkeys (delete, and since 2026-09-18 move up,
  // move down and duplicate). Scoped to this component rather than
  // App.tsx's global listener (see AppContent's own comment on why)
  // because they need `applyEdit` and the current selection, both of
  // which only exist while this pane is mounted, so the effect's own
  // mount lifetime IS the "only while Breakdown is the active tab" guard,
  // no extra check needed. `canDeleteItem`/`canRearrangeItem` mirror
  // exactly the set of card kinds that already carry their own Delete
  // button (cardKind.ts), each hotkey is a shortcut for a button or menu
  // entry, not a new capability, so a selection nothing else can act on
  // (a stray attribute, a shared block, a raw node) is silently a no-op
  // rather than acting on a different node the user didn't click.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      // The bound chord, or a plain Delete press (feedback 2026-10: "does
      // clicking a card then pressing the delete button work?" It did not,
      // only Ctrl+Alt+D did). Plain Delete stands down inside any text field.
      if (
        matchesHotkey(event, hotkeys.breakdownDeleteCard) ||
        isPlainDeleteKey(event)
      ) {
        if (!selection.selectedCards.some(canActOnCard)) return;
        event.preventDefault();
        deleteSelected();
        return;
      }
      // Comment out or uncomment the selection (2026-10-22). Stands down
      // inside a text field, where the field's own unsaved text would commit
      // on blur as an edit overlapping this one, and the patch queue would
      // refuse whichever came second.
      if (matchesHotkey(event, hotkeys.breakdownToggleComment)) {
        if (isTextEntryTarget(event.target)) return;
        const cards = selection.selectedCards.filter(canActOnCard);
        if (cards.length === 0) return;
        event.preventDefault();
        toggleCommentOut(cards, true);
        return;
      }
      // The rearranging hotkeys share this listener and the same
      // selection guard. Each is a shortcut for a card-menu entry.
      const action = matchesHotkey(event, hotkeys.breakdownMoveCardUp)
        ? "up"
        : matchesHotkey(event, hotkeys.breakdownMoveCardDown)
          ? "down"
          : matchesHotkey(event, hotkeys.breakdownDuplicateCard)
            ? "duplicate"
            : null;
      if (action === null) return;
      event.preventDefault();
      rearrangeSelected(action);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    hotkeys.breakdownDeleteCard,
    hotkeys.breakdownMoveCardUp,
    hotkeys.breakdownMoveCardDown,
    hotkeys.breakdownDuplicateCard,
    hotkeys.breakdownToggleComment,
    recordingId,
    selection.selectedCards,
    deleteSelected,
    toggleCommentOut,
    rearrangeSelected,
  ]);

  // Tab switch clears selection (Sec.3.9, the selected card is no longer
  // on screen, and an off-screen insert anchor is exactly the surprise
  // this feature exists to remove). This is a SECTION-tab switch inside
  // Breakdown, distinct from the top-level Breakdown/Code tab switch,
  // which must NOT clear it (that's the whole point of lifting selection
  // to App).
  //
  // Since 2026-10-21 a tab click also decides what is shown
  // (viewScope.ts's shownAfterTabClick). A shown tab stays in the stacked
  // view and the list scrolls to it, a faded one becomes the only section
  // shown. Either way it becomes the focus section.
  const handleSelectTab = useCallback(
    (id: string) => {
      const next = shownAfterTabClick(shownIds, id);
      setShownIds(next);
      setFocusId(id);
      selection.clearSelection();
      if (next.length > 1) pendingSectionScrollRef.current = id;
    },
    [selection, shownIds, setShownIds, setFocusId],
  );
  const handleToggleShown = useCallback(
    (id: string) => {
      const next = shownAfterToggle(
        shownIds,
        id,
        tabs.map((t) => t.id),
      );
      setShownIds(next);
      // A selection left in a section that just went away would be an
      // insert anchor nobody can see.
      if (selectedTabId !== null && !next.includes(selectedTabId))
        selection.clearSelection();
    },
    [shownIds, tabs, setShownIds, selectedTabId, selection],
  );
  const handleShowAll = useCallback(() => {
    const all = tabs.map((t) => t.id);
    if (shownIds.length === all.length) {
      setShownIds(focusTab ? [focusTab.id] : all.slice(0, 1));
    } else {
      setShownIds(all);
    }
  }, [tabs, shownIds, setShownIds, focusTab]);
  // A section heading, or empty space inside a section, was clicked.
  const handleFocusSection = useCallback(
    (id: string) => {
      setFocusId(id);
      selection.clearSelection();
    },
    [setFocusId, selection],
  );

  // tutorial-design.md Sec.5.3, a step whose `navigate.section` names a
  // Breakdown section tab jumps here through this navigator. Registered
  // unconditionally (before either PlaceholderPane return below) so it's
  // live for as long as this component is mounted, and unregisters itself
  // on unmount (a top-level Breakdown -> Code switch), matching the
  // "BreakdownPane unmounts on a top-tab switch" rule the engine's
  // navigate-application effect is already written against.
  useRegisterNavigator("breakdownSection", handleSelectTab);

  // Cycle Tabs (Ctrl+Tab, Ctrl+Shift+Tab backwards) steps the section tabs.
  // Not while the press belongs to the side panel, whose Preview/Reference
  // tabs take the same chord (App.tsx). The `activeTabId` fallback mirrors
  // `resolvedActiveId` below, which can't be read here, above the early
  // returns.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      const step = cycleDirection(event, hotkeys.cycleFocusedTabs);
      if (step === null || isSidePanelKeyEvent(event)) return;
      // With several sections shown the chord steps the focus through
      // them, with one it switches tabs as it always did.
      const ring = shownTabs.length > 1 ? shownTabs : tabs;
      const next = adjacentSectionId(ring, focusTab?.id ?? null, step);
      if (next === null) return;
      event.preventDefault();
      handleSelectTab(next);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    hotkeys.cycleFocusedTabs,
    recordingId,
    shownTabs,
    focusTab,
    tabs,
    handleSelectTab,
  ]);

  // Post-3.9 cross-tab sync, mount-only: BreakdownPane mounting means the
  // user either just switched TO Breakdown (from Code, or app startup).
  // Either way, `selection.selectedItem` may already point at
  // something set from the Code tab's last cursor position. Jump to
  // whichever section tab contains it and queue a scroll so the same
  // card that was "in view" in Code is back in view here. Deliberately
  // runs once (mount only): a click on a DIFFERENT card later in the same
  // Breakdown session must not re-trigger a tab jump. The user is
  // already looking at the right tab when that happens.
  //
  // Uses `selectedItem.span.start` here, NOT the raw `selectedAnchor`.
  // The anchor is wherever the Code-tab cursor happened to land, which is
  // usually somewhere in the MIDDLE of a command, not its span.start.
  // ItemCard's `data-anchor` attribute (below) is keyed on span.start, so
  // scrolling by the raw anchor would silently miss every element that
  // isn't already selected right at its opening character, which is
  // exactly why the scroll previously landed nowhere (selection itself
  // still worked because isSelected does a range check, not exact match).
  const didMountSyncRef = useRef(false);
  useEffect(() => {
    if (didMountSyncRef.current) return;
    didMountSyncRef.current = true;
    const item = selection.selectedItem;
    if (!item || tabs.length === 0) return;
    const anchor = item.span.start;
    for (const tab of tabs) {
      if (findItemAtOffset(tab.items, anchor)) {
        // Added to whatever is shown rather than replacing it, so a chosen
        // set survives a trip to the Code tab.
        if (!shownIds.includes(tab.id))
          setShownIds(
            shownAfterToggle(
              shownIds,
              tab.id,
              tabs.map((t) => t.id),
            ),
          );
        setFocusId(tab.id);
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
  }, [shownIds, parseResult]);

  // Runs after every render, cheap when nothing is queued.
  useEffect(() => {
    const id = pendingSectionScrollRef.current;
    if (id === null) return;
    pendingSectionScrollRef.current = null;
    document
      .querySelector(`[data-section-heading="${id}"]`)
      ?.scrollIntoView({ block: "start" });
  });

  if (!hasFile) {
    return (
      <PlaceholderPane description="Open an .rms file (File > Open) to see its Breakdown here." />
    );
  }
  if (!parseResult) {
    return <PlaceholderPane description="Parsing…" />;
  }

  return (
    <BreakdownProvider
      value={{
        tokens: parseResult.tokens,
        lang: languageIndex,
        diagnostics,
        source,
        gameConstants,
        parseResult,
        applyEdit,
        isExpanded,
        toggleExpanded,
        expandCard,
        collapseFromStrip,
        revealAfterEdit,
        requestFocus,
        registerFocusable,
        isSelected: selection.isSelected,
        selectCard,
        clearSelection: selection.clearSelection,
        selectedItem: selection.selectedItem,
        comments,
        expandedAnchors,
        moveItem,
        duplicateItem,
        clickCard,
        selectedItems: selection.selectedItems,
        selectedCards: selection.selectedCards,
        selectedComment: selection.selectedComment,
        moveItems,
        deleteSelected,
        toggleCommentOut,
        constNote,
        noteCommit,
        clearConstNote,
        announce,
      }}
    >
      <div
        className={styles.pane}
        onFocusCapture={focusKeeper.onFocusCapture}
        onBlurCapture={focusKeeper.onBlurCapture}
      >
        {/* Sec.6.3. Always mounted, so a screen reader has registered the
            region before its text changes, which is what makes it speak. */}
        <div role="status" aria-live="polite" className={styles.liveRegion}>
          {announcement}
        </div>
        <div
          className={styles.main}
          data-tutorial-anchor="breakdown.main"
          style={
            density === "compact"
              ? (COMPACT_DENSITY_STYLE as CSSProperties)
              : undefined
          }
        >
          <SectionTabs
            tabs={tabs}
            activeId={focusTab?.id ?? ""}
            onSelect={handleSelectTab}
            diagnostics={diagnostics}
            shownIds={shownIds}
            onToggleShown={handleToggleShown}
            onShowAll={handleShowAll}
          />
          {focusTab ? (
            <SectionView
              tabs={shownTabs}
              focusTab={focusTab}
              onFocusSection={handleFocusSection}
            />
          ) : (
            <PlaceholderPane description="No sections found." />
          )}
        </div>
      </div>
    </BreakdownProvider>
  );
}
