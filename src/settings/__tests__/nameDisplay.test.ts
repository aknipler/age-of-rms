import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTEN_LONG_NAMES,
  isShortened,
  clampPrefixLength,
  nameLengthLimit,
  SHORTENED_PREFIX_LENGTH,
  shortenName,
} from "../nameDisplay";

describe("shortenName", () => {
  it("leaves a name at the limit alone", () => {
    // Six characters exactly. The setting shortens names LONGER than the
    // limit, so the boundary is the one case worth pinning in both
    // directions. An off-by-one here silently truncates a whole class of
    // perfectly readable names.
    expect("SHEEP1".length).toBe(nameLengthLimit());
    expect(shortenName("SHEEP1", true)).toBe("SHEEP1");
  });

  it("shortens a name one character over the limit", () => {
    expect(shortenName("FORAGE", true)).toBe("FORAGE");
    expect(shortenName("FORAGE1", true)).toBe("FOR…");
  });

  it("keeps the configured prefix length", () => {
    const shortened = shortenName("SHORE_FISH", true);
    expect(shortened).toBe("SHO…");
    expect(shortened.slice(0, SHORTENED_PREFIX_LENGTH)).toBe("SHO");
  });

  it("returns the name untouched when the setting is off", () => {
    expect(shortenName("SHORE_FISH", false)).toBe("SHORE_FISH");
  });

  it("leaves short names alone whatever the setting", () => {
    expect(shortenName("GOLD", true)).toBe("GOLD");
    expect(shortenName("GOLD", false)).toBe("GOLD");
  });

  it("handles the empty name without producing a bare ellipsis", () => {
    expect(shortenName("", true)).toBe("");
  });
});

describe("isShortened", () => {
  it("is true exactly when shortenName changes the name", () => {
    for (const name of ["", "GOLD", "SHEEP1", "FORAGE1", "SHORE_FISH"]) {
      for (const enabled of [true, false]) {
        expect(isShortened(name, enabled)).toBe(
          shortenName(name, enabled) !== name,
        );
      }
    }
  });
});

describe("the default", () => {
  it("is off", () => {
    expect(DEFAULT_SHORTEN_LONG_NAMES).toBe(false);
  });
});

describe("a chosen length", () => {
  it("keeps that many characters and leaves names within three of it alone", () => {
    expect(shortenName("SHORE_FISH", true, 5)).toBe("SHORE…");
    expect(shortenName("SHORE_FI", true, 5)).toBe("SHORE_FI");
    expect(isShortened("SHORE_FISH", true, 5)).toBe(true);
    expect(isShortened("SHORE_FI", true, 5)).toBe(false);
  });

  it("clamps to 2 through 12 and falls back on junk", () => {
    expect(clampPrefixLength(0)).toBe(2);
    expect(clampPrefixLength(99)).toBe(12);
    expect(clampPrefixLength(4.6)).toBe(5);
    expect(clampPrefixLength(Number.NaN)).toBe(3);
  });
});
