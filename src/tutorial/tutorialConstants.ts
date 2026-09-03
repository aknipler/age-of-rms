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
