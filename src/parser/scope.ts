// The engine's scope rule for script names, in one place.
//
// A `#const` or `#define` only counts from its own line down (guide:148).
// Three consumers ask that question: RMS0303 in validate.ts, the Breakdown
// and Code name lookups (nameLookup.ts), and the "Move the #const up here"
// offer. They used to be one inline `.some(...)` each in validate.ts, and the
// lookup would have been a third copy. A rule copied three times is three
// rules the day one copy is edited, which is how the flash and the warning
// would come to disagree about the same name (docs/name-lookup-design.md
// Sec.9).
//
// Its own module rather than living in nameLookup.ts, because validate.ts
// imports this and nameLookup.ts imports validate.ts's slot tables. Putting
// the predicate in either of those two would make the imports circular.

/**
 * True when at least one definition's name token comes before the use.
 *
 * Token indices, not offsets. Both come from the same ParseResult, where
 * token order is source order, so the two orders agree and the index is
 * what every caller already holds. Any definition counts, conditional or
 * not, which is RMS0303's own reading (a flag set in one random branch and
 * read later is core RMS, see validate.ts checkCondition).
 */
export function isDefinedAbove(
  definitions: readonly { nameToken: number }[],
  useTokenIndex: number,
): boolean {
  return definitions.some((s) => s.nameToken < useTokenIndex);
}
