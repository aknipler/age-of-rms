// tutorial-design.md Sec.11, one TutorialDefinition per release that has
// something to announce, `kind: "feature"`, id `whats-new-<version>`.
// registry.ts collects them into the app's tutorial list.
//
// By convention (the only thing an author needs to know to add one): the
// first step is the announcement itself, no anchor, summarises the
// release, shown centred with no spotlight, and every step after it
// spotlights one new control.
//
// The version below is a placeholder for whatever `npm version` actually
// sets in package.json for this release. Keep the two in sync, or the
// trigger in TutorialContext.tsx (Sec.11) never fires.

import type { TutorialDefinition } from "../types";

const whatsNew050: TutorialDefinition = {
  id: "whats-new-0.5.0",
  kind: "feature",
  title: "What's new in 0.5",
  blurb:
    "Comment editing, attribute ordering, a resizable preview split, PNG export, a custom titlebar, and a UI size slider.",
  version: "0.5.0",
  steps: [
    {
      id: "announcement",
      title: "What's new in 0.5",
      body: [
        "Comments in the Breakdown editor are no longer read only. Add one with the new button beside Add command, and click an existing one to edit it.",
        "Command cards can sort their attributes the way you want (required first, by type, alphabetical, or your own drag order), and a new compact density option fits more on screen at once.",
        "The preview and reference table now share a resizable, collapsible split instead of a fixed layout, the reference table can sort its rows, and the preview gained a button to export the current view as a PNG.",
        "The app window now has its own titlebar instead of the operating system's. Theme Settings gained a UI size slider to scale text and controls up or down, and the Code tab now has real controls for tab width and whether tabs insert spaces.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "open-a-file",
      title: "Open a map to see it",
      anchor: { kind: "help", id: "titleBar.file" },
      calloutNudge: { x: 300 },
      navigate: { tab: "breakdown" },
      body: [
        "The rest of this tour points at controls that need a script open. Open one of your own maps, or File ▸ New then File ▸ Save works too.",
      ],
      completion: {
        kind: "check",
        test: (ctx) => ctx.hasFile,
      },
      hint: "Waiting on a file. File ▸ Open, or File ▸ New then File ▸ Save.",
    },
    {
      id: "add-comment",
      title: "Add and edit comments",
      anchor: { kind: "help", id: "breakdown.addComment" },
      navigate: { tab: "breakdown" },
      body: ["Add a comment anywhere a command can go, and click any existing comment card to edit its text in place."],
      completion: { kind: "manual" },
    },
    {
      id: "preview-reference-split",
      title: "Resize preview and reference",
      anchor: { kind: "help", id: "sidePanel.previewReferenceResizer" },
      navigate: { tab: "breakdown" },
      body: [
        "Drag the divider between the preview and the reference table to give either one more room, or collapse it out of the way entirely.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "export-png",
      title: "Export the preview as PNG",
      anchor: { kind: "help", id: "preview.exportPng" },
      navigate: { tab: "breakdown" },
      body: ["Save exactly what the preview is showing right now, at its current zoom, pan, and seed, as a PNG file. You may need to scroll down in the preview pane to see this button (at the bottom right of the generated preview)."],
      completion: { kind: "manual" },
    },
    {
      id: "reference-sort",
      title: "Sort the reference table",
      anchor: { kind: "help", id: "breakdown.sidePanel.referenceSort" },
      navigate: { tab: "breakdown" },
      body: ["The Terrain and Objects tabs can now sort by name, constant, or id, ascending or descending."],
      completion: { kind: "manual" },
    },
  ],
};

export const WHATS_NEW_TOURS: readonly TutorialDefinition[] = [whatsNew050];
