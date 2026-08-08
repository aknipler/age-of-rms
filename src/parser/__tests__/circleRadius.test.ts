import { describe, expect, it } from "vitest";
import { parseRms } from "../parser";
import { loadLanguage } from "./testUtils";
const lang = loadLanguage();
const hits = (v: string) =>
  parseRms(`<LAND_GENERATION>\ncreate_player_lands {\n terrain_type GRASS\n circle_radius ${v}\n}\n`, lang)
    .diagnostics.filter((d) => d.message.includes("circle_radius") || d.code === "RMS0203")
    .map((d) => `${d.code}: ${d.message}`);
describe("circle_radius three behaviours", () => {
  it("accepts a positive radius", () => expect(hits("38")).toEqual([]));
  it("accepts 0 (disable sentinel, guide:844)", () => expect(hits("0")).toEqual([]));
  it("accepts a negative radius (RMSTEST_27's third behaviour)", () => expect(hits("-20")).toEqual([]));
  it("still rejects out-of-range", () => expect(hits("99").length).toBeGreaterThan(0));
});
