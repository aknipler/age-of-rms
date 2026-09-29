import { useEffect, useMemo, useRef, useState } from "react";
import type { SectionTab } from "./sectionTabsModel";
import { BlockList } from "./BlockList";
import { CommandPicker, intentForPick } from "./CommandPicker";
import { CardDragProvider } from "./cardDrag";
import { DiagnosticsRuler } from "./DiagnosticsRuler";
import { useBreakdownContext } from "./BreakdownContext";
import { useHotkeySettings } from "../settings/HotkeySettingsContext";
import { useBreakdownSettings } from "../settings/BreakdownSettingsContext";
import { matchesHotkey } from "../settings/hotkeys";
import { HelpTip } from "../components/HelpTip";
import { TemplateDialog } from "./templates/TemplateDialog";
import { FOREST_MAKER_CONST, templatesFor } from "./templates/templates";
import { definesSymbol, playerLandTerrain } from "./templates/scriptContext";
import styles from "./SectionView.module.css";

interface SectionViewProps {
  tab: SectionTab;
}

// docs/breakdown-design.md Sec.3.2: an "Add" button opening a command
// picker (filtered to this tab's section by default), then the
// BlockList of the active section's items in source order.
//
// 3.4: the picker constructs a real `addCommand` intent, targeting the
// LAST concrete SectionNode this tab aggregates (Sec.3.1's rule for
// duplicate same-type sections, "add-command defaults to the last
// section of that type"). The Header tab has no SectionNode at all
// (ScriptNode.preamble is a bare Item[]), so it falls back to the
// `{ in: "preamble" }` InsertTarget instead (computeEdit.ts's
// insertIntoPreamble), closed 2026-09-01, was previously flagged as an
// unaddressed gap here.
//
// A canonical tab for a section that isn't in the source AT ALL yet (no
// SectionNode, `tab.sections` empty), a brand-new file's every tab, e.g.
// Tutorial A's own PLAYER_SETUP step (src/tutorial/content/rmsBasics.ts),
// falls back to `{ in: "newSection", name: tab.id }` (computeEdit.ts's
// insertIntoNewSection), which synthesizes the `<NAME>` tag plus the
// picked command as one insert. Closed 2026-09-01; previously the button
// just stayed disabled and every disabled tab's tooltip claimed to be the
// Header tab specifically, whichever tab it actually was.
export function SectionView({ tab }: SectionViewProps) {
  const {
    source,
    tokens,
    parseResult,
    applyEdit,
    requestFocus,
    revealAfterEdit,
    selectedItem,
    clearSelection,
    gameConstants,
  } = useBreakdownContext();
  const { scrollToAddedCard } = useBreakdownSettings();
  // Every Add path lands here (beta feedback 2026-09-17): the new card
  // opens right away so its attributes can be filled in, scrolled into
  // view unless the setting says otherwise, and focused on its first
  // value. Order matters, revealAfterEdit attaches to the pending edit
  // applyEdit just queued.
  const revealNew = (result: { caret: number } | null, expand = true) => {
    if (!result) return;
    revealAfterEdit(result.caret, scrollToAddedCard, expand);
    requestFocus(result.caret);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  // docs/object-templates-brief.md: Add Template shows on the tabs that
  // have templates of their own, Objects and (since the terrain player
  // forests template, 2026-09-28) Terrain. Own boolean rather than
  // reusing pickerOpen, the two aren't mutually exclusive in the UI (the
  // command picker is section-scoped chrome; this is a full dialog).
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const templateSection =
    (tab.id === "OBJECTS_GENERATION" || tab.id === "TERRAIN_GENERATION") &&
    templatesFor(tab.id).length > 0
      ? tab.id
      : undefined;
  const targetSection = tab.sections[tab.sections.length - 1];
  // Sec.3.10, the diagnostics ruler measures/queries against this exact
  // scroll container (offsetTop of each top-level card's data-anchor
  // node, relative to this element's own scrollHeight).
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sec.3.9, Add Command resolves relative to the current selection when one
  // exists (insert right after the selected card), falling back to the
  // existing "append to this tab's last concrete section" default
  // otherwise. ItemCard.tsx stops click propagation on every card, so this
  // handler only ever fires for a genuine background click (the padding
  // around/between cards, not a card itself), exactly the "click empty
  // space to deselect" behavior the spec calls for.
  // Memoized (not just a plain expression) so the Add Command hotkey effect
  // below can depend on it without tearing down and re-adding its listener
  // on every render, a plain object literal here would be a new reference
  // every time regardless of whether selectedItem/targetSection actually
  // changed.
  const insertTarget = useMemo(() => {
    if (selectedItem) return { after: selectedItem };
    if (targetSection)
      return { in: "section" as const, section: targetSection };
    if (tab.id === "header") return { in: "preamble" as const };
    // Canonical tab, no SectionNode in the file yet (sectionTabsModel.ts
    // always pushes all seven canonical tabs, present or not), every
    // unknown-section tab already has ≥1 SectionNode by construction, so
    // this branch is reached only by the canonical seven.
    if (tab.isCanonicalOrHeader)
      return { in: "newSection" as const, name: tab.id };
    return null;
  }, [selectedItem, targetSection, tab.id, tab.isCanonicalOrHeader]);

  // Where a comment trailing this tab's own item list has to end, for
  // BlockList's benefit (comments.ts): the Header tab ends at the first
  // real <SECTION>, any other tab ends at whichever SectionNode comes
  // after ITS last physical section in file order (tab.items can
  // aggregate more than one same-named SectionNode, sectionTabsModel.ts's
  // duplicate-section rule), or end of file if nothing follows either
  // way. undefined (no boundary, no trailing comments render) only when
  // this tab has no SectionNode at all yet, matching insertTarget's own
  // "newSection" fallback above, since there's nothing to be trailing WITHIN.
  const trailingBoundary = useMemo(() => {
    if (tab.id === "header") {
      const firstSection = parseResult.script.sections[0];
      return firstSection ? tokens[firstSection.header].start : source.length;
    }
    if (!targetSection) return undefined;
    const index = parseResult.script.sections.indexOf(targetSection);
    const next = parseResult.script.sections[index + 1];
    return next ? tokens[next.header].start : source.length;
  }, [tab.id, targetSection, parseResult, tokens, source.length]);

  // Add Command's own hotkey, toggles the same picker the button does,
  // with the same insertTarget rule (after the selection, else appended to
  // this tab's last section). Scoped to this component rather than a
  // global listener: SectionView remounts per active section tab, so the
  // effect's mount lifetime is what makes the hotkey target the section
  // actually on screen, the same way the button's own disabled state does.
  const { hotkeys, recordingId } = useHotkeySettings();
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (recordingId !== null) return;
      if (!matchesHotkey(event, hotkeys.breakdownAddCommand)) return;
      if (!insertTarget) return;
      event.preventDefault();
      setPickerOpen((v) => !v);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hotkeys.breakdownAddCommand, recordingId, insertTarget]);

  return (
    <div className={styles.outer}>
      <div
        className={styles.view}
        onClick={clearSelection}
        ref={scrollContainerRef}
        data-tutorial-anchor="breakdown.cardList"
        data-breakdown-scroll
      >
        <div className={styles.addWrapper} data-sticky-header>
          {/* .buttonRow puts Add Command and Add Comment on one row, each
              sized to its own content (2026-09-15) rather than stretched
              to fill half the row each. */}
          <div className={styles.buttonRow}>
            <HelpTip
              id="breakdown.addCommand"
              // insertTarget now resolves for every real tab (selection,
              // an existing section, the preamble, or a new-section
              // fallback), this override stays as a defensive fallback
              // rather than an expected state. Only one tooltip system
              // should ever explain this button, so this replaces (not
              // joins) a `title` attribute, a native title tooltip and
              // this popup used to fire on the same hover and cover each
              // other.
              text={
                insertTarget ? undefined : "Nothing to add a command to yet"
              }
              // Dismiss the instant the button is clicked, so the tip is
              // gone before CommandPicker renders below it, and stay
              // suppressed for as long as the picker is open, so hovering
              // off the button and back on can't re-arm the tip on top of
              // it (see HelpTip's `suppressed` doc comment).
              dismissOnInteract
              suppressed={pickerOpen}
            >
              <button
                type="button"
                className={styles.addButton}
                disabled={!insertTarget}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerOpen((v) => !v);
                }}
              >
                + Add command
              </button>
            </HelpTip>
            <HelpTip
              id="breakdown.addComment"
              text={
                insertTarget ? undefined : "Nothing to add a comment to yet"
              }
              dismissOnInteract
            >
              <button
                type="button"
                className={styles.addButton}
                disabled={!insertTarget}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!insertTarget) return;
                  // No picker to open, unlike Add Command: a comment has
                  // no name to choose, so this inserts a blank `/* */`
                  // straight away and hands focus to it (CommentCard
                  // registers itself at the same offset addComment's
                  // caret points at, see computeEdit.ts's own comment).
                  const result = applyEdit({
                    kind: "addComment",
                    at: insertTarget,
                  });
                  // A comment starts open (CommentCard's inverted anchor
                  // sense), so scroll only.
                  revealNew(result, false);
                }}
              >
                + Add comment
              </button>
            </HelpTip>
            {templateSection && (
              <HelpTip
                id="breakdown.addTemplate"
                text={
                  insertTarget ? undefined : "Nothing to add a template to yet"
                }
                dismissOnInteract
              >
                <button
                  type="button"
                  className={styles.addButton}
                  disabled={!insertTarget}
                  onClick={(e) => {
                    e.stopPropagation();
                    setTemplateDialogOpen(true);
                  }}
                >
                  + Add template
                </button>
              </HelpTip>
            )}
          </div>
          {pickerOpen && insertTarget && (
            <CommandPicker
              // "header" is never a real CommandDef.section value (language.json's
              // sections[] holds only the seven canonical names), filtering by it
              // would always return zero results, so the Header tab shows every
              // command by default instead, same as an unknown-section tab.
              defaultSection={
                tab.isCanonicalOrHeader && tab.id !== "header"
                  ? tab.id
                  : undefined
              }
              onClose={() => setPickerOpen(false)}
              onPick={(choice) => {
                const result = applyEdit(intentForPick(choice, insertTarget));
                setPickerOpen(false);
                revealNew(result);
              }}
            />
          )}
        </div>
        <div className={styles.content}>
          {/* The drag layer is per tab, like the diagnostics ruler, since
              a drop resolves against this tab's own items and autoscrolls
              this tab's own container. */}
          <CardDragProvider
            items={tab.items}
            scrollContainerRef={scrollContainerRef}
          >
            <BlockList items={tab.items} trailingBoundary={trailingBoundary} />
          </CardDragProvider>
        </div>
      </div>
      <DiagnosticsRuler items={tab.items} containerRef={scrollContainerRef} />
      {templateDialogOpen && insertTarget && templateSection && (
        <TemplateDialog
          section={templateSection}
          // Read once per render while the dialog is open, both are short
          // walks. The dialog copies playerLand into its own state on mount,
          // see its lazy useState.
          script={{
            playerLand: playerLandTerrain(parseResult),
            forestSetupPresent: definesSymbol(parseResult, FOREST_MAKER_CONST),
          }}
          constants={gameConstants.constants}
          onClose={() => setTemplateDialogOpen(false)}
          onInsert={({ text, caretOffset, setupText }) => {
            const result = applyEdit({
              kind: "insertText",
              at: insertTarget,
              text,
              caretOffset,
              ...(setupText === undefined ? {} : { setupText }),
            });
            setTemplateDialogOpen(false);
            revealNew(result);
          }}
        />
      )}
    </div>
  );
}
