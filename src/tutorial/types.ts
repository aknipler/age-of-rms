// tutorial-design.md Sec.5.1, the shapes the engine and every content file
// are written against.

import type { ParseResult } from "../parser/types";
import type { TabId } from "../types";

export interface StepContext {
  parseResult: ParseResult | null;
  source: string;
  activeTab: TabId;
  activeSectionId: string | null;
  hasFile: boolean;
}

export type StepCompletion =
  | { kind: "manual" } // Next only
  | { kind: "check"; test: (ctx: StepContext) => boolean };

export type Anchor =
  | { kind: "help"; id: string } // [data-help-id="id"]
  | { kind: "region"; id: string } // [data-tutorial-anchor="id"]
  | { kind: "selector"; css: string }; // escape hatch, avoid (Sec.4.3)

/** A byte-level text change, same shape `useDocument.applyTextEdits` takes. */
export interface StepTextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface TutorialStep {
  id: string; // stable; used by tests
  title: string; // callout heading, <= 6 words
  body: string[]; // one string per paragraph; plain text, no markdown
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
   * A manual nudge added to the callout's final on-screen position, AFTER
   * the normal beside/below/above placement algorithm and clamped to the
   * same viewport margins as everything else. For a step where the default
   * position would land on top of something the step causes to open that
   * ISN'T the anchor itself, e.g. a dropdown triggered by a different
   * control than the one being pointed at, which the placement algorithm
   * has no way to know about.
   */
  calloutNudge?: { x?: number; y?: number };
  /** Overrides the callout's default max-width (320px, TutorialOverlay.module.css) for one step. */
  calloutMaxWidthPx?: number;
  /** View state this step needs. Applied once when the step becomes active. */
  navigate?: { tab?: TabId; section?: string };
  completion: StepCompletion;
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
  /**
   * Which corner "Move this out of the way" parks the callout in, for a step
   * whose anchor sits low enough on screen that the default (bottom-right)
   * would land near or on the anchor itself, the status bar steps are the
   * case this exists for. Only consulted while the step is anchored; default
   * is bottom-right.
   */
  moveAsideCorner?: "bottom-right" | "top-right";
}

export interface TutorialDefinition {
  id: string; // "rms-basics", "app-tour", "whats-new-0.4.0"
  kind: "rms" | "app" | "feature";
  title: string; // "Your first random map"
  blurb: string; // one line, shown on the welcome pane / Help menu
  steps: TutorialStep[];
  /** Feature tours only, the app version that introduces it (Sec.11). */
  version?: string;
}
