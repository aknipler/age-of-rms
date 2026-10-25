// tutorial-design.md Sec.9.2. The tests every tutorial with a Breakdown and a
// Code track runs, from one call in its own test file. Not a `.test.ts` file,
// so Vitest only runs it through the files that import it.

import { describe, expect, it } from "vitest";
import {
  BREAKDOWN_TRACK,
  CODE_TRACK,
  EDITOR_CHOICE_STEP_ID,
} from "../editorTracks";
import { visibleSteps } from "../registry";
import type { TabId } from "../../types";
import type {
  BodyBlock,
  StepContext,
  TutorialDefinition,
  TutorialStep,
} from "../types";

export interface EditorTrackOptions {
  /** The Breakdown track's step ids in order, pinned so adding Code steps cannot reorder it. */
  breakdownIds: readonly string[];
  /** Code steps that show a tab other than Code on purpose, with that tab. */
  codeStepTabs?: Readonly<Record<string, TabId>>;
  ctxFor: (source: string) => StepContext;
  /**
   * For each Code check step whose body holds script text, the whole script
   * that text is typed into. Must name exactly those steps, so a new Answer
   * cannot go untested.
   */
  typedInto: Readonly<Record<string, (typed: string) => string>>;
}

/** The words of a block a learner reads as prose. Script text is left out. */
export function prose(block: BodyBlock): string[] {
  if (typeof block === "string") return [block];
  if (Array.isArray(block))
    return block.map((p) => (typeof p === "string" ? p : p.spoiler));
  if (block.kind === "spoiler") {
    // Piece by piece, as for an Inline[] block above, so a "Hint 1: " label
    // is read on its own and not as a colon inside the sentence after it.
    // A code entry among the paragraphs is a `{ kind: "code" }` like a code
    // block, so `prose` gives it nothing, the same exemption.
    if ("paragraphs" in block)
      return [block.label, ...block.paragraphs.flatMap(prose)];
    return block.code ? [block.label] : [block.label, block.text];
  }
  if (block.kind === "code") return [];
  if (block.kind === "text") return [block.text];
  return [block.alt];
}

/**
 * The script text a step shows, joined. That is code blocks, code spoilers,
 * and the code entries inside a spoiler's `paragraphs`. A code entry is read
 * as script to type like the other two, so an Answer written that way is
 * held to the step's check too.
 */
export function typedText(step: TutorialStep): string {
  return step.body
    .flatMap((b): string[] => {
      if (typeof b !== "object" || Array.isArray(b)) return [];
      if (b.kind === "code") return [b.text];
      if (b.kind !== "spoiler") return [];
      if (!("paragraphs" in b)) return b.code ? [b.text] : [];
      return b.paragraphs.flatMap((p) =>
        typeof p === "object" && !Array.isArray(p) ? [p.text] : [],
      );
    })
    .join("\n\n");
}

/**
 * Names of Breakdown controls. A Code step that uses one points the learner
 * at a tab they are not on. Most often that is a Code step that took its
 * Breakdown twin's words, after the twin was edited.
 */
const BREAKDOWN_WORDS =
  /\b(breakdown|cards?|add command|picker|duplicate|right-click)\b/i;

export function describeEditorTracks(
  tutorial: TutorialDefinition,
  options: EditorTrackOptions,
): void {
  describe(`${tutorial.id}, the Breakdown and Code tracks`, () => {
    const breakdown = visibleSteps(tutorial, BREAKDOWN_TRACK);
    const code = visibleSteps(tutorial, CODE_TRACK);
    const codeOnly = tutorial.steps.filter((s) => s.track === CODE_TRACK);
    const choiceIndex = tutorial.steps.findIndex((s) => s.choice);
    const tabOf = (step: TutorialStep): TabId =>
      options.codeStepTabs?.[step.id] ?? "code";

    it("puts the choice right after the new file, with nothing tracked before it", () => {
      expect(tutorial.steps[choiceIndex].id).toBe(EDITOR_CHOICE_STEP_ID);
      expect(tutorial.steps[choiceIndex - 1].id).toBe("start-new-file");
      for (const step of tutorial.steps.slice(0, choiceIndex))
        expect(step.track, step.id).toBeUndefined();
      expect(
        tutorial.steps[choiceIndex].choice?.options.map((o) => o.track),
      ).toEqual([BREAKDOWN_TRACK, CODE_TRACK]);
    });

    it("keeps the Breakdown track in its pinned order", () => {
      expect(breakdown.map((s) => s.id)).toEqual(options.breakdownIds);
    });

    it("gives both tracks the same length and the same shared steps in the same places", () => {
      expect(code.length).toBe(breakdown.length);
      breakdown.forEach((step, i) => {
        if (!step.track) expect(code[i]).toBe(step);
        else expect(code[i].track).toBe(CODE_TRACK);
      });
    });

    // The one claim the whole track rests on. Both tabs edit one document,
    // so a twin that shares its Breakdown step's check function is checked by
    // every Breakdown assertion in the tutorial's own tests at once.
    it("runs every Code step on the same check and autoFill as its Breakdown twin", () => {
      breakdown.forEach((step, i) => {
        if (!step.track) return;
        expect(code[i].completion).toBe(step.completion);
        expect(code[i].autoFill).toBe(step.autoFill);
      });
    });

    // editorTracks.ts copies the kind in `joinTwin`, so a twin never has to
    // repeat it and cannot lose its chip on one track only.
    it("gives every Code step its Breakdown twin's kind", () => {
      breakdown.forEach((step, i) => {
        expect(code[i].kind, code[i].id).toBe(step.kind);
      });
    });

    it("points every Code step at its tab", () => {
      for (const step of codeOnly)
        expect(step.navigate?.tab, step.id).toBe(tabOf(step));
    });

    // Back from either track's first step returns to the choice, and a
    // learner may then pick the other one. The step after the choice has to
    // switch tabs itself, or the second pick starts on the first pick's tab.
    it("opens each track on its own tab", () => {
      expect(breakdown[choiceIndex + 1].navigate?.tab).toBe("breakdown");
      expect(code[choiceIndex + 1].navigate?.tab).toBe("code");
    });

    it("never names a Breakdown control on a Code step that shows the Code tab", () => {
      const offenders = codeOnly
        .filter((s) => tabOf(s) === "code")
        .flatMap((s) =>
          [s.title, s.hint ?? "", ...s.body.flatMap(prose)]
            .filter((t) => BREAKDOWN_WORDS.test(t))
            .map((t) => `${s.id}: ${t}`),
        );
      expect(offenders).toEqual([]);
    });

    it("uses none of the punctuation CLAUDE.md rules out in the Code and choice copy", () => {
      const added = [...codeOnly, tutorial.steps[choiceIndex]];
      const texts = added.flatMap((s) => [
        s.title,
        s.hint ?? "",
        ...s.body.flatMap(prose),
        ...(s.choice?.options.flatMap((o) => [o.label, o.help]) ?? []),
      ]);
      for (const text of texts) {
        // A colon may end a heading or a label, never sit inside a sentence.
        expect(text.trimEnd()).not.toMatch(/[—–;]|:[\s\S]/);
        expect(text).not.toMatch(/ - /);
      }
    });

    // Every Answer must be text the step's own check accepts, or the last
    // rung of the hint ladder would leave a learner stuck.
    const typedSteps = codeOnly.filter(
      (s) => s.completion.kind === "check" && typedText(s) !== "",
    );

    it("has a script to type into for exactly the Code check steps that show script text", () => {
      expect(Object.keys(options.typedInto).sort()).toEqual(
        typedSteps.map((s) => s.id).sort(),
      );
    });

    it.each(typedSteps.map((s) => s.id))(
      'step "%s" is satisfied by its own script text',
      (id) => {
        const step = codeOnly.find((s) => s.id === id)!;
        if (step.completion.kind !== "check")
          throw new Error(`${id} is manual`);
        const build = options.typedInto[id];
        expect(build, `no typedInto entry for ${id}`).toBeDefined();
        const source = build(typedText(step));
        expect(step.completion.test(options.ctxFor(source))).toBe(true);
      },
    );
  });
}
