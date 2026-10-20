import { describe, expect, it } from "vitest";
import { argumentHelpText } from "../helpText";
import { loadLanguage } from "../../parser/__tests__/testUtils";

describe("argumentHelpText", () => {
  it("says nothing for an argument with no description, range or default", () => {
    expect(argumentHelpText(undefined)).toBeUndefined();
    expect(
      argumentHelpText({ name: "terrain", type: "terrainConstant" }),
    ).toBeUndefined();
  });

  it("gives range and default when there is no description", () => {
    expect(
      argumentHelpText({
        name: "percent",
        type: "percent",
        min: 0,
        max: 100,
        default: 20,
      }),
    ).toBe("Range 0–100. Default 20.");
  });

  it("puts the description first and names the argument when asked", () => {
    expect(
      argumentHelpText(
        {
          name: "variance",
          type: "integer",
          description: "Spread.",
          default: 0,
        },
        true,
      ),
    ).toBe("Argument variance. Spread. Default 0.");
  });

  it("never repeats the argument's type as filler", () => {
    const text = argumentHelpText({ name: "x", type: "integer", min: 0 });
    expect(text).toBe("Min 0.");
  });

  it("gives border_fuzziness its one-line direction from the reference data", () => {
    const lang = loadLanguage();
    const def = lang.attributes.find((a) => a.name === "border_fuzziness");
    const text = argumentHelpText(def?.arguments?.[0]);
    expect(text).toContain("100 sticks closest to the borders");
    expect(text).toContain("0 respects them least");
  });
});
