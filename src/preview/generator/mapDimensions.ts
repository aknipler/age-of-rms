import type { PredefinedLabel } from "../../parser/language";
import type { MapSize } from "../../generationSettings/generationSettingsConstants";

// docs/preview-design.md Sec.4: the lobby's map size resolves to a grid
// dimension by LOOKUP in language.json's predefinedLabels, never from a table
// typed out in code.
//
// The spec is emphatic about this and the reason is specific. Legacy and
// modern size names are offset by one size — the app's Normal (200x200)
// defines LARGE_MAP *and* MAPSIZE_NORMAL, while MAPSIZE_LARGE is the next
// size up — so anything that infers a dimension from a label's name is wrong
// on every size-aware map, silently, by picking the wrong branch. There are
// already three representations of this relationship (the guide's table, this
// data, and MAP_SIZES in generationSettingsConstants.ts) and a fourth
// hand-typed copy is exactly how the offset gets mis-transcribed.
//
// Pure: a data lookup, no AST, no placement, no RNG.

/**
 * Side length in tiles for a lobby map size, or null if the data cannot
 * answer — which is a real possibility worth surfacing rather than defaulting
 * away, since the whole label environment is built from the same array.
 *
 * Note that `find` is correct here and a uniqueness assertion would be a bug.
 * Every size except Giant matches TWO entries — the legacy and the modern
 * name both carry `mapSize: "Tiny"` and both carry `dimensions: 120` — and
 * they differ only in which label the environment defines, not in the number.
 * `npm run validate:reference` is what asserts the pair agrees.
 */
export function resolveMapDim(
  mapSize: MapSize,
  predefinedLabels: readonly PredefinedLabel[] | undefined,
): number | null {
  const match = (predefinedLabels ?? []).find(
    (label) =>
      label.category === "mapSize" && label.mapSize === mapSize && label.dimensions !== undefined,
  );
  return match?.dimensions ?? null;
}
