import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { validateRms } from "../validate";
import { loadLanguage } from "./testUtils";

const lang = loadLanguage();

function validate(source: string) {
  return validateRms(parseRms(source, lang));
}

describe("required sections", () => {
  it("reports base_elevation when ELEVATION_GENERATION is missing", () => {
    const source = "<LAND_GENERATION>\ncreate_land { base_elevation 1 }";
    const diagnostics = validate(source);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "RMS0300",
      severity: "error",
      span: {
        start: source.indexOf("base_elevation"),
        end: source.indexOf("base_elevation") + "base_elevation".length,
      },
    });
    expect(diagnostics[0].message).toContain("<ELEVATION_GENERATION>");
  });

  it("accepts an empty ELEVATION_GENERATION section", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_land { base_elevation 1 }",
      "<ELEVATION_GENERATION>",
    ].join("\n");

    expect(validate(source)).toEqual([]);
  });

  it("reports a missing attribute-to-section dependency only once", () => {
    const source = [
      "<LAND_GENERATION>",
      "create_land { base_elevation 1 }",
      "create_land { base_elevation 2 }",
    ].join("\n");

    expect(validate(source).map((diagnostic) => diagnostic.code)).toEqual([
      "RMS0300",
    ]);
  });

  it("does not require ELEVATION_GENERATION when base_elevation is unused", () => {
    const source = "<LAND_GENERATION>\ncreate_land { base_size 10 }";

    expect(validate(source)).toEqual([]);
  });
});
