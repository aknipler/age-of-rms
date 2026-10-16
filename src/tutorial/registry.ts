// tutorial-design.md Sec.2.1/Sec.11, every TutorialDefinition in the app,
// keyed by id. Populated incrementally as content/*.ts lands (rev1 ships
// rms-basics and app-tour; whatsNew.ts adds one entry per release that has
// something to announce).

import type { TutorialDefinition, TutorialStep } from "./types";
import { appTourTutorial } from "./content/appTour";
import { landGenerationComeerTutorial } from "./landGenerationComeer/tutorial";
import { rmsBasicsTutorial } from "./content/rmsBasics";
import { WHATS_NEW_TOURS } from "./content/whatsNew";

export const TUTORIALS: readonly TutorialDefinition[] = [
  rmsBasicsTutorial,
  landGenerationComeerTutorial,
  appTourTutorial,
  ...WHATS_NEW_TOURS,
];

export function getTutorial(
  id: string,
  tutorials: readonly TutorialDefinition[] = TUTORIALS,
): TutorialDefinition | undefined {
  return tutorials.find((t) => t.id === id);
}

/**
 * The track a run follows before the learner has picked one, the first
 * option of the tutorial's first choice step. Undefined for a tutorial with
 * no choice step, where every step has no track anyway.
 */
function defaultTrack(definition: TutorialDefinition): string | undefined {
  return definition.steps.find((s) => s.choice)?.choice?.options[0]?.track;
}

/**
 * The steps a run shows, in order. A step with no track is always shown. A
 * step with a track is shown when it matches the run's track, or the
 * default track while nothing has been picked yet.
 *
 * Counting the default track before the choice keeps the "3 / 20" counter
 * honest from the first step. Counting only the untracked steps would read
 * "1 / 9" and then jump to "3 / 20" at the choice.
 */
export function visibleSteps(
  definition: TutorialDefinition,
  track: string | null,
): TutorialStep[] {
  const shown = track ?? defaultTrack(definition);
  return definition.steps.filter((s) => !s.track || s.track === shown);
}

/** Sec.11 step 3, the feature tour whose `version` matches exactly, if one exists. */
export function featureTourForVersion(
  version: string,
  tutorials: readonly TutorialDefinition[] = TUTORIALS,
): TutorialDefinition | undefined {
  return tutorials.find((t) => t.kind === "feature" && t.version === version);
}

/**
 * Numeric dot-separated version compare (semver-shaped, not full semver, no
 * pre-release/build metadata support, which none of this project's version
 * strings carry). Missing components compare as 0, so "0.4" < "0.4.1".
 */
function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Help menu's "What's new" (Sec.6): the newest feature tour in the registry,
 * regardless of the app's current version, so an item that fell behind a
 * skipped release still points at the most recent changelog rather than
 * disappearing.
 */
export function latestFeatureTour(
  tutorials: readonly TutorialDefinition[] = TUTORIALS,
): TutorialDefinition | undefined {
  let latest: TutorialDefinition | undefined;
  for (const t of tutorials) {
    if (t.kind !== "feature" || !t.version) continue;
    if (!latest || compareVersions(t.version, latest.version!) > 0) latest = t;
  }
  return latest;
}
