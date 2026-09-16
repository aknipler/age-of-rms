// tutorial-design.md Sec.10. Tutorial B, "Tour of Age of RMS". Written for
// someone who already writes RMS, so it explains this app's surfaces and
// nothing about the language. Every step after the first is manual: it's a
// tour, not an exercise, and there is nothing to check.
//
// This tour changes no document. Unlike Tutorial A it asks for no NEW file
// and never requires emptiness, but it still needs SOME file open, because
// half of what it tours (the preview, the reference table, the resource
// totals) doesn't exist in the DOM at all until BreakdownPane has one
// (`hasFile === false` renders a bare PlaceholderPane instead of the real
// layout). Rev 1 shipped with no such gate on the theory that "runs against
// whatever the user already has open, including nothing" meant a step 0 was
// unnecessary. It wasn't: starting this tour from a clean install with
// nothing open left every one of those anchors unresolvable for the entire
// run, since nothing else ever opens a file. `open-a-file` below is that
// gate, added post-rev-1. Everything after it still can't assert what's ON
// SCREEN (a map, a reference-table mode, a non-zero resource total can all
// look different from what the tour author saw), only that a file, and so
// the surface itself, exists to look at.

import type { TutorialDefinition } from "../types";

export const appTourTutorial: TutorialDefinition = {
  id: "app-tour",
  kind: "app",
  title: "Tour of Age of RMS",
  blurb: "Preview, reference, status bar, settings and tools, in about three minutes.",
  steps: [
    {
      id: "open-a-file",
      title: "Open a map to explore",
      anchor: { kind: "help", id: "titleBar.file" },
      // Same File-dropdown clearance as Tutorial A's own step 0. See
      // rmsBasics.ts's "start-new-file" for the reasoning (no single CSS
      // literal to derive an exact number from, this is a generous
      // estimate).
      calloutNudge: { x: 300 },
      navigate: { tab: "breakdown" },
      body: [
        "The rest of this tour points at panes that need a script open to mean anything: the preview, the reference table, the resource totals. Open one of your own maps if you have one handy, it's the best way to see real numbers in all of them.",
        "Nothing here either? File ▸ New then File ▸ Save works too. The panes will just start at zero until you write something.",
      ],
      completion: {
        kind: "check",
        test: (ctx) => ctx.hasFile,
      },
      hint: "Waiting on a file. File ▸ Open, or File ▸ New then File ▸ Save.",
    },
    {
      id: "preview",
      title: "The map preview",
      anchor: { kind: "region", id: "sidePanel.preview" },
      navigate: { tab: "breakdown" },
      body: [
        "An approximate render of what your script generates, updated as you edit. It reproduces the engine's rules where those have been measured in game, and marks what it cannot model rather than drawing a confident guess. Drag to pan, wheel to zoom, click a tile for its terrain, elevation and objects.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "current-vs-final",
      title: "Current vs Final",
      anchor: { kind: "help", id: "breakdown.sidePanel.previewToggle" },
      body: [
        "Final generates the whole script. Current generates only up to the line you are on, so you can watch the map being built stage by stage. Current also let's you Pin a line, essentially commenting out the script after the pin.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "notes-drawer",
      title: "The notes drawer",
      anchor: { kind: "help", id: "preview.notesDrawer" },
      body: [
        "Every approximation the preview made, and every placement that failed. You may need to scroll down in the preview pane to see this. Perhaps too much information, please provide feedback on ways to highlight the critical information.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "reference-table",
      title: "The reference table",
      anchor: { kind: "region", id: "sidePanel.reference" },
      body: [
        "Terrains, objects and commands with the attributes each one takes, searchable. Also a list of all the objects placed, their count and you can unselect them to make them invisible in the preview generation.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "resources-and-problems",
      title: "Resources and problems",
      anchor: { kind: "region", id: "statusBar.resources" },
      // The resource buckets and the problem indicator sit in separate DOM
      // regions (StatusBar.tsx: only the scrolling bucket row carries
      // data-tutorial-anchor="statusBar.resources"; the problems triangle
      // lives outside it, in the pinned section, under its own HelpTip id).
      // This step's body talks about both, so both need to be in the
      // spotlight, not just the one `anchor` names.
      extraAnchors: [{ kind: "help", id: "statusBar.problems" }],
      moveAsideCorner: "top-right",
      body: [
        "Live resource totals split into total, player and neutral, and a live problem count from advanced diagnostics.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "generation-settings",
      title: "Generation settings",
      anchor: { kind: "help", id: "preview.generationSettings" },
      body: [
        "Properties of the script (player count, map size and team layout) are available here. Everything above is computed for whatever you set here.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "advanced-tools",
      title: "Advanced Tools",
      anchor: { kind: "region", id: "tools.pane" },
      // The tab bar's own "Advanced Tools" item is how the user gets back
      // here later, so it's part of what this step is showing, not just the
      // pane the tab switch lands on.
      extraAnchors: [{ kind: "help", id: "tabBar.advancedTools" }],
      navigate: { tab: "advanced-tools" },
      body: [
        "Advanced Tools with plans to make it easy for the community to contribute more. Currently, advanced land placement generation, a generation consistency checker, a constants auditor, a balance summary, a formatter and script statistics. Each proposes edits you review before applying. Nothing is written without an Apply.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "help-as-you-go",
      title: "Help as you go",
      anchor: { kind: "help", id: "titleBar.settings" },
      navigate: { tab: "breakdown" },
      body: [
        "Almost every control in the app explains itself on hover. Settings ▸ General switches that between always on, ALT only, and off. Both tutorials are in the Help menu whenever you want them again.",
      ],
      completion: { kind: "manual" },
    },
  ],
};
