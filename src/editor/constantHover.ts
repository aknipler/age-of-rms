// The one line the Code tab's hover shows for a predefined constant. Kept
// apart from aoe2RmsHover.ts, which imports Monaco and so cannot load in
// Vitest.

/** The fields of a game-constants.json row the hover reads. */
export interface HoverConstant {
  category: string;
  classId?: number;
  resourceAmounts?: {
    food?: number;
    wood?: number;
    gold?: number;
    stone?: number;
  };
}

/**
 * The relic class in the dat. Relics have no resource node, so the dat
 * extraction records no yield for them. The rate is not known, so the line
 * shows a question mark in its place until it is measured.
 */
export const RELIC_CLASS_ID = 42;
export const RELIC_RATE_LINE = "Default rate: ? g/in-game min";

/**
 * A resource object says what it holds by default and a relic says what it
 * earns. Everything else only says it is predefined, since the name is
 * already on screen and a title repeating it adds nothing.
 */
export function constantHoverLine(constant: HoverConstant): string {
  const held = Object.entries(constant.resourceAmounts ?? {});
  if (held.length === 1) return `Default res: ${held[0][1]}`;
  if (held.length > 1)
    return `Default res: ${held.map(([r, n]) => `${n} ${r}`).join(", ")}`;
  if (constant.category === "object" && constant.classId === RELIC_CLASS_ID)
    return RELIC_RATE_LINE;
  return "Predefined constant.";
}
