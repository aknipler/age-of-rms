// tutorial-design.md Sec.5.1, the shapes the engine and every content file
// are written against.

import type { ParseResult } from "../parser/types";
import type { TabId } from "../types";
import type { MapSize } from "../generationSettings/generationSettingsConstants";

export interface StepContext {
  parseResult: ParseResult | null;
  source: string;
  activeTab: TabId;
  activeSectionId: string | null;
  hasFile: boolean;
}

export type StepCompletion =
  | { kind: "manual" } // Next only
  | {
      kind: "check";
      test: (ctx: StepContext) => boolean;
      /**
       * `false` keeps the step on screen once `test` passes. The tick still
       * shows and the learner moves on with Next. For a step whose body has
       * more to read after the learner acts, such as a spoiler that explains
       * what they just saw. Leaving it out means `true`, the Sec.5.2
       * behaviour every other check step has.
       *
       * An option on `check` and not a third `kind`, because a step like
       * this is a check for every other reader. The tick, the hint, the
       * anchor poll and the tests that run each check against its stage
       * script all key on `kind === "check"` and keep working unchanged.
       */
      autoAdvance?: boolean;
    };

export type Anchor =
  | { kind: "help"; id: string } // [data-help-id="id"]
  | { kind: "region"; id: string } // [data-tutorial-anchor="id"]
  | { kind: "selector"; css: string }; // escape hatch, avoid (Sec.4.3)

/**
 * `src` is a path under `public/`, so `/tutorial/name.png` for a file in
 * `public/tutorial/`. A wide image usually wants `calloutMaxWidthPx` too.
 */
export interface StepImage {
  src: string;
  alt: string;
}

/**
 * A run of hidden words inside a paragraph, shown masked until the learner
 * clicks it (tutorial-islands-design.md Sec.4.2).
 */
export interface InlineSpoiler {
  spoiler: string;
  /**
   * Text the mask is drawn as wide as, instead of `spoiler` itself. For a
   * number, whose digit count would otherwise show through the bar's width
   * (a one digit bar cannot be 10). Revealing swaps in the real text.
   */
  maskAs?: string;
}

/** One piece of a paragraph. A plain string is shown as written. */
export type Inline = string | InlineSpoiler;

/** A paragraph, plain or with hidden words in it. */
export type Paragraph = string | Inline[];

/**
 * Script text shown as written, line breaks and indents kept, in the
 * editor's font. Named because it is both a body block and an entry of a
 * spoiler's `paragraphs`, and one shape for both keeps them rendered alike.
 */
export interface CodeLines {
  kind: "code";
  text: string;
}

/**
 * One entry of a spoiler's `paragraphs`, a paragraph or script text. For an
 * Answer that shows the values as code and then explains them in prose,
 * all behind one reveal.
 *
 * Still a discriminated union, told apart by `typeof`, `Array.isArray` and
 * then `kind`, the same tests a `BodyBlock` takes. A reader written for
 * `Paragraph` alone, such as `typeof p === "string" ? p : p.map(...)`, now
 * fails to compile, because a `CodeLines` has no `map`. That compile error is
 * the point. It finds every reader that would otherwise print a code entry as
 * prose.
 */
export type SpoilerParagraph = Paragraph | CodeLines;

/**
 * What a step asks of the learner, shown as a chip before its title and a
 * stripe down the card's left edge. "investigate" is a step for trying
 * values and watching the preview, "build" adds something that stays in the
 * finished script. A string union rather than an enum, the TypeScript idiom
 * for a closed set of names that are only ever compared.
 */
export type StepKind = "investigate" | "build";

/**
 * The pictures a `diagram` block can show. Each name is a React component in
 * diagrams.tsx, drawn as inline SVG so it reads the app's theme colours. A
 * picture loaded through `<img>` cannot, since a separate SVG document never
 * sees the page's CSS variables.
 */
export type DiagramName = "start-square-overlap";

/**
 * One block of a step's body, in reading order.
 * - A string is a plain paragraph, the form every step used before spoilers.
 * - An `Inline[]` is a paragraph with hidden words in it.
 * - A `spoiler` block is a labelled toggle that opens a hidden paragraph, or
 *   with `paragraphs` several of them, which may hold hidden words of their
 *   own (a hint ladder inside the toggle).
 * - An `image` block is a picture between paragraphs.
 * - A `diagram` block is a drawn picture that follows the theme.
 * - A `text` block is a paragraph with an `align`.
 *
 * A discriminated union, told apart by `typeof`, `Array.isArray` and then
 * `kind`. The renderer's `switch` on `kind` makes the compiler point at it
 * when a new block kind is added. Plain strings stay valid so existing
 * content needs no change. That is also why a paragraph is not wrapped as
 * `{ kind: "text" }`, which would be more uniform and would touch every step
 * ever written.
 */
export type BodyBlock =
  | string
  | Inline[]
  | {
      kind: "spoiler";
      label: string;
      text: string;
      /** Shows the opened text as script lines, the way a `code` block does. */
      code?: boolean;
      /** Puts a warning triangle before the label, for a spoiler that is easy to skip and matters. */
      warn?: true;
    }
  /**
   * A second spoiler shape rather than widening `text` to `string |
   * Paragraph[]`. A widened `text` would still compile in every reader that
   * puts it in a template literal, and print "a,[object Object]". With its
   * own field, a reader that only knows `text` fails to compile until it
   * handles this shape too. Tell the two apart with `"paragraphs" in block`.
   */
  | {
      kind: "spoiler";
      label: string;
      paragraphs: SpoilerParagraph[];
      warn?: true;
    }
  | ({ kind: "image" } & StepImage)
  /**
   * `alt` is read out in place of the picture and is held to the copy rules
   * like any other words. A caption the learner reads goes in a paragraph
   * next to the block, where it follows the UI font size.
   */
  | { kind: "diagram"; name: DiagramName; alt: string }
  /** For a step that asks the learner to type something. */
  | CodeLines
  /**
   * A paragraph with its own alignment, for a sign-off at the end of an
   * announcement. A plain string is a left-aligned paragraph, so this is only
   * for the lines that need something else.
   */
  | { kind: "text"; text: string; align: "left" | "center" | "right" };

/**
 * One button on a choice step (`TutorialStep.choice`). Picking it sets the
 * run's track and moves to the next step.
 */
export interface StepChoiceOption {
  track: string;
  label: string;
  /** The button's hover help. */
  help: string;
}

/**
 * A step's `preview` (tutorial-islands-design.md Sec.4.3). Every field is
 * optional and a missing one leaves that setting alone.
 *
 * The engine reads `seed` at the moment the step becomes active, never
 * earlier, so a step whose seed is only known at run time can define it as
 * a getter, `get seed() { return currentComeerSeed(); }`. That keeps the
 * type a plain number for the common case. The alternative, a
 * `number | (() => number)` union, would make every reader branch on it.
 */
export interface StepPreviewPin {
  seed?: number;
  /** An id from `TEAM_PRESETS`. It sets the player count and the teams together. */
  teamPreset?: string;
  mapSize?: MapSize;
}

/**
 * How the engine reaches the app's preview seed and generation settings.
 * The app registers one (`useRegisterPreviewPinner`), the same inversion as
 * the navigators in Sec.5.3, so the engine imports no app context and its
 * tests can hand in a fake.
 *
 * An interface with one method rather than a bare function type, so a later
 * need (a restore on exit was designed and then dropped) can add a method
 * without changing every registration site's shape.
 */
export interface PreviewPinner {
  apply: (pin: StepPreviewPin) => void;
}

/** A byte-level text change, same shape `useDocument.applyTextEdits` takes. */
export interface StepTextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface TutorialStep {
  id: string; // stable; used by tests
  title: string; // callout heading, <= 6 words
  /**
   * Shows the chip and edge stripe for this kind of step. Left out, the step
   * shows neither, which is how every step looked before kinds existed. A
   * Code track twin takes its Breakdown step's kind (editorTracks.ts).
   */
  kind?: StepKind;
  body: BodyBlock[]; // plain text, no markdown, see BodyBlock
  anchor?: Anchor;
  /**
   * Additional regions to spotlight alongside `anchor`, every one of them
   * gets its own dimmed-out cutout, but only `anchor` positions the callout.
   * For a step that both names a section tab and asks the user to press Add
   * command, this is how both land in the spotlight at once instead of
   * forcing a choice between them.
   */
  extraAnchors?: Anchor[];
  /**
   * Regions to light when the step opens, in place of `anchor` and
   * `extraAnchors`, for a step that asks the learner to look at one thing
   * and then work in a part of the app the spotlight dims. The dim and the
   * rings fade away after a while, or as soon as the learner clicks or types
   * outside the card. `anchor` still places the callout.
   */
  lookFirst?: Anchor[];
  /**
   * A manual nudge added to the callout's final on-screen position, AFTER
   * the normal beside/below/above placement algorithm and clamped to the
   * same viewport margins as everything else. For a step where the default
   * position would land on top of something the step causes to open that
   * ISN'T the anchor itself, e.g. a dropdown triggered by a different
   * control than the one being pointed at, which the placement algorithm
   * has no way to know about.
   */
  calloutNudge?: { x?: number; y?: number };
  /**
   * Seats the callout inside the anchor's own rectangle, against the named
   * corner, instead of beside it. For an anchor that is large and has a
   * panel next to it that the learner is using (the Code tab's editor, with
   * the preview on its left). Beside placement would land on that panel.
   * Skips `calloutNudge` and the overlap test, since overlapping the anchor
   * is the point. A callout taller than the anchor grows upward and stops
   * at the anchor's top edge.
   */
  calloutInsideAnchor?: "bottom-right";
  /** Overrides the callout's default max-width (320px, TutorialOverlay.module.css) for one step. */
  calloutMaxWidthPx?: number;
  /** View state this step needs. Applied once when the step becomes active. */
  navigate?: {
    tab?: TabId;
    section?: string;
    /** Which tab of the map side panel to show, for a step that points at the preview or at the reference table. */
    sidePanel?: "preview" | "reference";
  };
  /**
   * A picture outside the body (tutorial-islands-design.md Sec.4.1), above
   * the title ("top", the default) or just above the buttons ("bottom"). A
   * picture between paragraphs is an `image` block in `body` instead, so
   * there is one way to do each.
   */
  image?: StepImage & { placement?: "top" | "bottom" };
  /**
   * Preview state this step needs, applied once when the step becomes
   * active, in the same pass as `navigate` (tutorial-islands-design.md
   * Sec.4.3). Nothing is put back when the tutorial ends. The learner
   * leaves with the pinned settings, and the last step says so.
   */
  preview?: StepPreviewPin;
  completion: StepCompletion;
  /**
   * Shown only on a run that picked this track at a choice step. A step
   * with no track is shown on every run. See `visibleSteps` in
   * registry.ts for how a run before its choice is counted.
   */
  track?: string;
  /**
   * Makes this a choice step. Its options replace Next, and the one the
   * learner picks decides which `track` steps the rest of the run shows.
   * Back from the step after it returns here, so the choice can be changed.
   * Every step before a choice step must have no track, or the step
   * indexes of the two tracks would disagree at the choice itself.
   */
  choice?: { options: StepChoiceOption[] };
  /**
   * An extra button beside Next that performs the step FOR the user, e.g.
   * "Add them for me" on a step that would otherwise be four hand-typed
   * commands. `buildEdit` is called against the live StepContext; returning
   * null means the step isn't in a state the shortcut can act on (already
   * done, or missing a prerequisite), so no button-triggered edit fires.
   */
  autoFill?: {
    label: string;
    buildEdit: (ctx: StepContext) => StepTextEdit | null;
  };
  /** Shown under the body while a `check` step is still unsatisfied. */
  hint?: string;
  /**
   * An extra button beside Next that advances the step, labelled for the
   * reason someone would want it. `Next` already advances an unsatisfied
   * check step (Sec.2.2), so this adds no capability, it names the choice,
   * which is the whole point. See Sec.5.5.
   */
  bypass?: { label: string };
}

export interface TutorialDefinition {
  id: string; // "rms-basics", "app-tour", "whats-new-0.4.0"
  kind: "rms" | "app" | "feature";
  title: string; // "Your first random map"
  blurb: string; // one line, shown on the welcome pane / Help menu
  steps: TutorialStep[];
  /** Feature tours only, the app version that introduces it (Sec.11). */
  version?: string;
  /**
   * Background work to run each time the tutorial becomes active, for a
   * tutorial whose copy depends on something that has to be checked against
   * the current engine, such as a seed that shows a planted problem
   * (tutorial-islands-design.md Sec.5). It runs without blocking the first
   * step. `signal` aborts when the tutorial is exited, completed or
   * restarted, and the work should stop then. A rejection is logged and the
   * tutorial carries on, so a failing check never traps the learner.
   */
  prepare?: (signal: AbortSignal) => Promise<void>;
}
