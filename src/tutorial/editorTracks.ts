// tutorial-design.md Sec.9.2. The Breakdown or Code choice every map-building
// tutorial offers, and the builder that gives a tutorial its Code track.
//
// A tutorial is written once, for Breakdown. Its steps that name a Breakdown
// control carry `track: BREAKDOWN_TRACK`, and a list of `CodeTwin`s says how
// each of those reads in the Code tab. `withCodeTrack` interleaves the two.
// Each Code step takes its twin's completion and autoFill as the same
// objects. Both tabs edit one document and the checks read its parse, so a
// check cannot tell which tab the text came from, and a later fix to a check
// reaches both tracks.
//
// A twin may also leave out its title and body, and then reads exactly as its
// Breakdown step does. That suits a step whose words only name attributes and
// the preview. Shared words cannot drift apart when one track is edited.
// `describeEditorTracks` (__tests__/editorTracks.ts) fails a Code step whose
// words name a Breakdown control, so an inherited body that later gains one is
// caught.

import type { BodyBlock, Paragraph, TutorialStep } from "./types";

export const BREAKDOWN_TRACK = "breakdown";
export const CODE_TRACK = "code";

export const EDITOR_CHOICE_STEP_ID = "breakdown-or-code";

/**
 * The step that asks which tab to build in. It goes straight after the step
 * that opens a new file, so both tabs have something real to show, and every
 * step above it must stay untracked (types.ts, `choice`).
 */
export function editorChoiceStep(): TutorialStep {
  return {
    id: EDITOR_CHOICE_STEP_ID,
    title: "Breakdown or Code",
    anchor: { kind: "help", id: "tabBar.breakdown" },
    extraAnchors: [{ kind: "help", id: "tabBar.code" }],
    body: [
      "You can build this map in either of two tabs, and both write the same file.",
      "Breakdown shows the script as cards. You pick commands and attributes from lists, so there are no names to remember and no brackets to balance. Pick it if you have never written code.",
      "Code is the script as plain text, the way the game reads it. You type every line yourself, and hovering over a word explains it. Most map authors work here once they know the names.",
      "Whichever you pick, the other tab shows the same map, so you can switch at any time. Back on the next step returns here if you change your mind.",
    ],
    completion: { kind: "manual" },
    choice: {
      options: [
        {
          track: BREAKDOWN_TRACK,
          label: "Use Breakdown",
          help: "Builds the map from cards and lists in the Breakdown tab.",
        },
        {
          track: CODE_TRACK,
          label: "Use Code",
          help: "Builds the map by typing the script in the Code tab.",
        },
      ],
    },
  };
}

export const CODE_EDITOR_ANCHOR = {
  kind: "region",
  id: "code.editor",
} as const;

/**
 * A Code step before it is joined to its twin.
 *
 * Always taken from the twin, never written here: `completion`, `autoFill`.
 * Taken from the twin unless written here: `title`, `body`, `hint`, `bypass`,
 * `preview`, `image`. A `body` can also be a function of the twin's body, for
 * a Code step that says the same and then adds an answer to type.
 * Never taken from the twin, because they place the callout over Breakdown
 * controls: `anchor`, `extraAnchors`, `calloutNudge`, `calloutMaxWidthPx`
 * and `navigate`. They default to the code editor and the Code tab.
 */
export type CodeTwin = Omit<
  TutorialStep,
  "completion" | "autoFill" | "track" | "title" | "body"
> & {
  /** Id of the Breakdown step this one mirrors. */
  twinOf: string;
  title?: string;
  body?: BodyBlock[] | ((twinBody: BodyBlock[]) => BodyBlock[]);
};

/** Every word of a paragraph, hidden or not. */
export function paragraphText(paragraph: Paragraph): string {
  if (typeof paragraph === "string") return paragraph;
  return paragraph.map((p) => (typeof p === "string" ? p : p.spoiler)).join("");
}

/** Every word of a block, hidden or not, for finding it by a phrase. */
function blockText(block: BodyBlock): string {
  if (typeof block === "string" || Array.isArray(block))
    return paragraphText(block);
  if (block.kind === "spoiler")
    return "paragraphs" in block
      ? [block.label, ...block.paragraphs.map(paragraphText)].join(" ")
      : `${block.label} ${block.text}`;
  if (block.kind === "code" || block.kind === "text") return block.text;
  return block.alt;
}

/**
 * The one block of `body` whose words contain `phrase`. Finding a block by
 * its words, rather than by its position, means a paragraph added above it
 * on the Breakdown step does not move an edit onto the wrong block. Throws
 * at module load when no block or more than one holds the phrase, so an edit
 * that rewords it fails the tests instead of leaving Breakdown words on the
 * Code track.
 */
function oneBlock(body: readonly BodyBlock[], phrase: string): BodyBlock {
  const hits = body.filter((b) => blockText(b).includes(phrase));
  if (hits.length !== 1)
    throw new Error(
      `expected one block containing "${phrase}", found ${hits.length}`,
    );
  return hits[0];
}

/** For a Code twin's `body` function. Swaps the block holding `phrase` for `replacement`, which may be several blocks. */
export function replaceBlock(
  body: readonly BodyBlock[],
  phrase: string,
  ...replacement: BodyBlock[]
): BodyBlock[] {
  const hit = oneBlock(body, phrase);
  return body.flatMap((b) => (b === hit ? replacement : [b]));
}

/** For a Code twin's `body` function. Adds `added` straight after the block holding `phrase`. */
export function insertAfterBlock(
  body: readonly BodyBlock[],
  phrase: string,
  ...added: BodyBlock[]
): BodyBlock[] {
  const hit = oneBlock(body, phrase);
  return body.flatMap((b) => (b === hit ? [b, ...added] : [b]));
}

function joinTwin(
  twin: TutorialStep,
  code: Omit<CodeTwin, "twinOf">,
): TutorialStep {
  const { body, ...rest } = code;
  const anchor = rest.anchor ?? CODE_EDITOR_ANCHOR;
  return {
    title: twin.title,
    hint: twin.hint,
    bypass: twin.bypass,
    preview: twin.preview,
    image: twin.image,
    anchor,
    // The preview sits to the left of the editor, so beside placement would
    // cover it. The editor's bottom right corner is the least used part.
    calloutInsideAnchor:
      anchor.kind === "region" && anchor.id === CODE_EDITOR_ANCHOR.id
        ? "bottom-right"
        : undefined,
    navigate: { tab: "code" },
    ...rest,
    body:
      body === undefined
        ? twin.body
        : typeof body === "function"
          ? body(twin.body)
          : body,
    track: CODE_TRACK,
    completion: twin.completion,
    autoFill: twin.autoFill,
  };
}

/**
 * Inserts each Code step straight after the Breakdown step it mirrors.
 * `visibleSteps` (registry.ts) filters by track and keeps the array's order,
 * so interleaving the pairs gives each track its own order with no index
 * bookkeeping.
 *
 * The Breakdown steps must already carry `track: BREAKDOWN_TRACK`, written
 * on each one so the track is visible where the step is read. Throws at
 * module load if a twin is missing or is not a Breakdown step, which the
 * registry test then reports by failing to import.
 */
export function withCodeTrack(
  steps: readonly TutorialStep[],
  codeTwins: readonly CodeTwin[],
): TutorialStep[] {
  const out: TutorialStep[] = [];
  const used = new Set<string>();
  for (const step of steps) {
    out.push(step);
    for (const { twinOf, ...code } of codeTwins) {
      if (twinOf !== step.id) continue;
      if (step.track !== BREAKDOWN_TRACK)
        throw new Error(
          `Code step "${code.id}" mirrors "${twinOf}", which is not on the Breakdown track`,
        );
      used.add(twinOf);
      out.push(joinTwin(step, code));
    }
  }
  for (const { twinOf, id } of codeTwins) {
    if (!used.has(twinOf))
      throw new Error(
        `Code step "${id}" mirrors "${twinOf}", which does not exist`,
      );
  }
  return out;
}
