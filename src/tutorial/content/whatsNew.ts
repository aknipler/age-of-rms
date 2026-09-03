// tutorial-design.md Sec.11, one TutorialDefinition per release that has
// something to announce, `kind: "feature"`, id `whats-new-<version>`.
// registry.ts collects them into the app's tutorial list.
//
// By convention (the only thing an author needs to know to add one): the
// first step is the announcement itself, no anchor, summarises the
// release, shown centred with no spotlight, and every step after it
// spotlights one new control. No release has shipped anything worth
// announcing yet, so this starts empty.

import type { TutorialDefinition } from "../types";

export const WHATS_NEW_TOURS: readonly TutorialDefinition[] = [];
