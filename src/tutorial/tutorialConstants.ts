// Same file/shape as help/helpConstants.ts, for the same reason: one
// persisted store, agreed keys, guards beside them (tutorial-design.md
// Sec.12).

export const TUTORIAL_STORE_FILE = "settings.json";
export const WELCOME_SEEN_KEY = "tutorialWelcomeSeen";
export const COMPLETED_KEY = "tutorialCompleted";
export const LAST_SEEN_VERSION_KEY = "tutorialLastSeenVersion";

export function isCompletedList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * The Comeer tutorial's replacement seed, saved when the background check
 * found that the pinned seed no longer passes (landGenerationComeer/
 * seedMemory.ts). `replaces` is the pinned seed it stands in for.
 */
export const COMEER_SEED_KEY = "tutorialComeerSeed";

export interface RememberedSeed {
  seed: number;
  replaces: number;
}

export function isRememberedSeed(value: unknown): value is RememberedSeed {
  if (typeof value !== "object" || value === null) return false;
  const { seed, replaces } = value as Record<string, unknown>;
  return Number.isInteger(seed) && Number.isInteger(replaces);
}
