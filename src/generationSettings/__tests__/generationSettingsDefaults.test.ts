// The values a fresh install starts with. The provider saves each change to
// the settings store and reads it back on launch, so these apply only until
// the user picks something else.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_SIZE,
  DEFAULT_PLAYER_COUNT,
  isMapSize,
  isPlayerCount,
} from "../generationSettingsConstants";

describe("generation settings defaults", () => {
  it("start a new install on 2 players and a Tiny map", () => {
    expect(DEFAULT_PLAYER_COUNT).toBe(2);
    expect(DEFAULT_MAP_SIZE).toBe("Tiny");
  });

  it("are values the settings store would accept back", () => {
    expect(isPlayerCount(DEFAULT_PLAYER_COUNT)).toBe(true);
    expect(isMapSize(DEFAULT_MAP_SIZE)).toBe(true);
  });
});
