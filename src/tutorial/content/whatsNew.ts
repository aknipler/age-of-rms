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
      body: [
        "Add a comment anywhere a command can go, and click any existing comment card to edit its text in place.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "preview-reference-split",
      title: "Preview and reference tabs",
      anchor: { kind: "help", id: "sidePanel.tabReference" },
      navigate: { tab: "breakdown" },
      body: [
        "The preview and the reference table take turns in the same panel. Click a tab to switch between them.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "export-png",
      title: "Export the preview as PNG",
      anchor: { kind: "help", id: "preview.exportPng" },
      navigate: { tab: "breakdown", sidePanel: "preview" },
      body: [
        "Save exactly what the preview is showing right now, at its current zoom, pan, and seed, as a PNG file. The button is on the bottom row of the map.",
      ],
      completion: { kind: "manual" },
    },
    {
      id: "reference-sort",
      title: "Sort the reference table",
      anchor: { kind: "help", id: "breakdown.sidePanel.referenceSort" },
      navigate: { tab: "breakdown", sidePanel: "reference" },
      body: [
        "The Terrain and Objects tabs can now sort by name, constant, or id, ascending or descending.",
      ],
      completion: { kind: "manual" },
    },
  ],
};

const whatsNew060: TutorialDefinition = {
  id: "whats-new-0.6.0",
  kind: "feature",
  title: "What's new in 0.6",
  blurb:
    "Object templates, cards you can move and duplicate, Hide Unused Attributes, cards that open when added, and preview fixes.",
  version: "0.6.0",
  steps: [
    {
      id: "announcement",
      title: "What's new in 0.6",
      body: [
        "The Objects tab has an Add template button with ready-made blocks for player objects, player resources and water resources, with a live preview of the text before you insert it.",
        "Cards can now be moved up and down, duplicated, and wrapped in if or random control flow. New cards open and scroll into view when you add them, and a collapsed card shows its attributes as buttons you can click to jump straight to that field.",
        "Hide Unused Attributes (in Breakdown settings) shows only the attributes a command actually uses, with a search bar to add the rest. #const and #define are now offered in the Add command picker, and the Header tab is always there.",
        "In the preview, #const values are no longer rounded, so rings draw as rings, and connections now reach the town centre.",
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
      id: "add-template",
      title: "Add a template",
      anchor: { kind: "help", id: "breakdown.addTemplate" },
      navigate: { section: "OBJECTS_GENERATION" },
      body: [
        "Pick a canned block of create_object commands, check the preview of exactly what will be inserted, then press Insert.",
      ],
      completion: { kind: "manual" },
    },
  ],
};

// No new controls this release, so the announcement is the whole tour.
const whatsNew070: TutorialDefinition = {
  id: "whats-new-0.7.0",
  kind: "feature",
  title: "What's new in 0.7",
  blurb:
    "Game data for The Viking Sagas update, object groups weighted the way the game now picks them, and two new warnings.",
  version: "0.7.0",
  steps: [
    {
      id: "announcement",
      title: "What's new in 0.7",
      body: [
        "Game data is updated for The Viking Sagas update. That brings the spruce and green oak forests, the new animals, trees and rocks, the three new civilizations, every map type and every unit class. Several map type constants changed number in that update, and the reference panel now shows the new ones.",
        "Object groups in the preview now follow the game's new add_object weighting. The first member gets more than its share, so a group of two at 50 50 places about 75 25. The add_object help explains how to set the chances you want.",
        "BOGLAND now means Grass, Flowers 2 in every script, even one that includes constants.inc, so the editor warns when you use it as a terrain and suggests DLC_BOGLAND.",
        "The editor also warns about unit classes no unit belongs to, such as PIKEMAN_CLASS. An effect aimed at one changes nothing, and the warning names the class the unit is really in.",
      ],
      completion: { kind: "manual" },
    },
  ],
};

const whatsNew080: TutorialDefinition = {
  id: "whats-new-0.8.0",
  kind: "feature",
  title: "What's new in 0.8",
  blurb:
    "Preview Generator Land section matches DE, Feature Requests, a Team Positions setting, a second tutorial, a resizable map, and keyboard control of the search lists.",
  version: "0.8.0",
  steps: [
    {
      id: "announcement",
      title: "What's new in 0.8",
      body: [
        "The preview land generation section is now the same as the game. It should be tile-for-tile on same seed. Additional testing is always appreciated, specifically with larger map sizes. Credit to Big John and his work on the AoE2RMSIDE project for figuring out the number generator.",
        "Feature Requests! There is now a little button in the bottom right corner of the status bar that opens the project's GitHub Discussions page in your browser. You can suggest a feature, a tutorial, or any other idea. Please let me know if anything pops into your head!",
        "Generation Settings now has a Team Positions checkbox, on by default. Maps that branch on TEAM_POSITIONS will work too.",
        "A new tutorial, Land Generation (Comeer), focusses on teaching land generation section techniques. It is in the Help menu. Both tutorials now work in both Breakdown and Code, asking you which you want to do.",
        "The map preview can have its size adjusted vertically as well as horizontally. The Add command picker and the attribute search are navigable with Up, Down and Enter, and the Credits tab has a Buy Me a Coffee link if you want to support the work. :)",
        "What's next:",
        "(1) improving the preview engine,",
        "(2) adding in community hub for sharing maps (this may take a while),",
        "(3) more tutorials!",
        "(4) improving the Advanced Land Placement tool,",
        "(5) any of the bug fixes or small QOL improvements that you guys suggest along the way.",
        "I would also like to start looking into supporting multiple languages. If anyone is interested in helping with that, please reach out to me on GitHub or Discord. I would love to have a community of people helping to make this app accessible to everyone.",
        "Thank you for the support!",
        { kind: "text", text: "Happy scripting,", align: "right" },
        { kind: "text", text: "Captain Kniples the Fourth", align: "right" },
      ],
      completion: { kind: "manual" },
    },
    {
      id: "comeer-tutorial",
      title: "Try the Comeer tutorial",
      anchor: { kind: "help", id: "titleBar.help" },
      body: [
        "The Tutorial: Land Generation (Comeer) is found in the Help menu. I would love some feedback on how to improve it!",
      ],
      completion: { kind: "manual" },
    },
  ],
};

export const WHATS_NEW_TOURS: readonly TutorialDefinition[] = [
  whatsNew050,
  whatsNew060,
  whatsNew070,
  whatsNew080,
];
