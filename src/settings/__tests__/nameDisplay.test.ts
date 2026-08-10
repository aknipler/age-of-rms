import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHORTEN_LONG_NAMES,
  isShortened,
  NAME_LENGTH_LIMIT,
  SHORTENED_PREFIX_LENGTH,
  shortenName,
} from "../nameDisplay";

describe("shortenName", () => {
  it("leaves a name at the limit alone", () => {
    // Six characters exactly. The setting shortens names LONGER than the
    // limit, so the boundary is the one case worth pinning in both
    // directions — an off-by-one here silently truncates a whole class of
    // perfectly readable names.
    expect("SHEEP1".length).toBe(NAME_LENGTH_LIMIT);
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
        expect(isShortened(name, enabled)).toBe(shortenName(name, enabled) !== name);
      }
    }
  });
});

describe("the default", () => {
  it("is on", () => {
    // Asserted rather than assumed: the setting is specified as on by
    // default, and a flipped default is invisible on a fresh install until
    // someone notices names are not being shortened.
    expect(DEFAULT_SHORTEN_LONG_NAMES).toBe(true);
  });
});
