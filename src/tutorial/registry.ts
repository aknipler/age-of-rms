// tutorial-design.md Sec.2.1/Sec.11, every TutorialDefinition in the app,
// keyed by id. Populated incrementally as content/*.ts lands (rev1 ships
// rms-basics and app-tour; whatsNew.ts adds one entry per release that has
// something to announce).

import type { TutorialDefinition } from "./types";
import { appTourTutorial } from "./content/appTour";
import { rmsBasicsTutorial } from "./content/rmsBasics";
import { WHATS_NEW_TOURS } from "./content/whatsNew";

export const TUTORIALS: readonly TutorialDefinition[] = [rmsBasicsTutorial, appTourTutorial, ...WHATS_NEW_TOURS];

export function getTutorial(id: string, tutorials: readonly TutorialDefinition[] = TUTORIALS): TutorialDefinition | undefined {
  return tutorials.find((t) => t.id === id);
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
export function latestFeatureTour(tutorials: readonly TutorialDefinition[] = TUTORIALS): TutorialDefinition | undefined {
  let latest: TutorialDefinition | undefined;
  for (const t of tutorials) {
    if (t.kind !== "feature" || !t.version) continue;
    if (!latest || compareVersions(t.version, latest.version!) > 0) latest = t;
  }
  return latest;
}
