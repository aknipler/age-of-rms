import type { ObjectConstant } from "./objects";
import type { InstantiatedScript } from "./types";

// The script's colour mood, `color_correction CC_AUTUMN` (preview-de-textures
// Sec.14.6). Generation ignores it; the textured view tints the map with the
// mood's measured colour transform. Pure, like the rest of the generator.

/**
 * The mood's number (the `colorCorrection` constants, CC_DEFAULT 0), from the
 * last `color_correction` line that survived instantiation, or undefined when
 * the script names none or one we cannot resolve. A `#const` of the script's
 * own and a bare number both resolve, as the game reads them.
 */
export function readColorMood(
  script: InstantiatedScript,
  constants: readonly Pick<
    ObjectConstant,
    "category" | "rmsConstant" | "constId"
  >[],
): number | undefined {
  let mood: number | undefined;
  for (const commands of script.sections.values())
    for (const cmd of commands) {
      if (cmd.name !== "color_correction") continue;
      const v = cmd.args[0]?.value;
      if (typeof v === "number") mood = Math.trunc(v);
      else if (typeof v === "string") {
        const own = script.symbols.get(v);
        if (own !== undefined) mood = Math.trunc(own);
        else {
          const row = constants.find(
            (c) => c.category === "colorCorrection" && c.rmsConstant === v,
          );
          if (row?.constId !== undefined && row.constId !== null)
            mood = row.constId;
        }
      }
    }
  return mood;
}
