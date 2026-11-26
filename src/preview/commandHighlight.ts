import type { ParseResult } from "../parser/types";
import { commandAtOffset } from "./commandAtOffset";
import type { CommandTiles } from "./generator/commandTiles";

// What the preview shows for "Highlight selected command", worked out from the
// caret and the sets the generation recorded. Pure, so the pane stays a thin
// shell and a test can drive every case without React.

/** One legend row, a swatch colour, a name, a tile count and the definition for its tooltip. */
export interface LegendRow {
  swatch: "first" | "second";
  name: string;
  tiles: number;
  title: string;
}

export type CommandHighlight =
  | { state: "none" }
  | { state: "notRun" }
  | {
      state: "sets";
      first: Uint32Array;
      /** Absent when the command has one set, or two that hold the same tiles. */
      second?: Uint32Array;
      /** One row for a single set, two for two different sets. */
      legend?: LegendRow[];
    };

const sameTiles = (a: Uint32Array, b: Uint32Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** The two names and their one sentence definitions, per kind. The definitions come from the brief's "sets, defined exactly". */
function rowsFor(entry: CommandTiles): [LegendRow, LegendRow] | null {
  if (entry.second === undefined) return null;
  const row = (
    swatch: "first" | "second",
    name: string,
    tiles: number,
    title: string,
  ): LegendRow => ({ swatch, name, tiles, title });
  const first = entry.first.length;
  const second = entry.second.length;
  switch (entry.kind) {
    case "terrain":
    case "connection":
      return [
        row(
          "first",
          "Placed by command",
          first,
          "Tiles whose terrain or layer this command changed when it ran. A tile painted with the terrain it already had does not count.",
        ),
        row(
          "second",
          "Surviving tiles",
          second,
          "Placed tiles that still hold this command's terrain on the finished map and that no later command placed.",
        ),
      ];
    case "land": {
      const zone = entry.zone;
      const zoneName =
        zone === undefined
          ? "Zone tiles"
          : zone.lands > 1
            ? `Zone tiles (zone ${zone.zone}, ${zone.lands} lands)`
            : `Zone tiles (zone ${zone.zone})`;
      return [
        row(
          "first",
          "Grown tiles",
          first,
          "Every tile the land claimed during growth, its stamp included, before the cleanup pass.",
        ),
        row(
          "second",
          zoneName,
          second,
          "Every tile whose zone matches this land's zone. Zones are shared, and other commands read zones and not lands.",
        ),
      ];
    }
    default:
      return null;
  }
}

/** The one row for a command with a single drawn set. */
function singleRowFor(entry: CommandTiles): LegendRow {
  const names: Record<CommandTiles["kind"], [string, string]> = {
    terrain: [
      "Placed by command",
      "Tiles whose terrain or layer this command changed when it ran.",
    ],
    connection: [
      "Placed by command",
      "Tiles whose terrain or layer this command changed when it ran.",
    ],
    land: [
      "Grown tiles",
      "Every tile the land claimed during growth, its stamp included, before the cleanup pass.",
    ],
    object: ["Object tiles", "Tiles holding objects this command placed."],
    elevation: ["Elevated tiles", "Tiles whose height this command changed."],
    cliff: ["Cliff tiles", "Tiles holding cliffs."],
  };
  const [name, title] = names[entry.kind];
  return { swatch: "first", name, tiles: entry.first.length, title };
}

/**
 * The highlight for the caret, or `none` with no caret, no command or a
 * command the highlight does not cover. `notRun` is a covered command with no
 * record in this generation (a branch not taken, a `start_random` arm not
 * rolled). `sets` carries what to draw and, with two different sets, the legend.
 */
export function highlightFor(
  parse: ParseResult | null,
  cursorOffset: number | null,
  sets: readonly CommandTiles[] | undefined,
): CommandHighlight {
  if (parse === null || cursorOffset === null || sets === undefined)
    return { state: "none" };
  const found = commandAtOffset(parse, cursorOffset);
  if (found === null) return { state: "none" };
  const entry = sets.find(
    (s) => s.offset === found.start && s.kind === found.kind,
  );
  if (entry === undefined) return { state: "notRun" };
  const second =
    entry.second !== undefined && !sameTiles(entry.first, entry.second)
      ? entry.second
      : undefined;
  // Two different sets get two rows. One set (or two identical ones, drawn in
  // one colour) gets a single row so its tile count still shows.
  const legend: LegendRow[] =
    second === undefined
      ? [singleRowFor(entry)]
      : (rowsFor(entry) ?? [singleRowFor(entry)]);
  return {
    state: "sets",
    first: entry.first,
    second,
    legend,
  };
}
