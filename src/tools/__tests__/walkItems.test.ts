// consistency-checker-design.md Sec.7.0 item 5 — walkItems is UNCONDITIONALLY
// GENEROUS (every branch, every shared block), so this file pins that shape
// rather than any filtering policy: filtering is every caller's own job.

import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import type { IfBranch, Item } from "../../parser/types";
import { walkItems, type WalkContext } from "../walkItems";

const lang = loadLanguage();

function visited(source: string): { item: Item; ctx: WalkContext }[] {
  const parse = parseRms(source, lang);
  const out: { item: Item; ctx: WalkContext }[] = [];
  walkItems(parse, (item, ctx) => out.push({ item, ctx }));
  return out;
}

describe("walkItems", () => {
  it("descends into a command's own block", () => {
    const out = visited("<LAND_GENERATION>\ncreate_land { terrain_type GRASS }");
    const command = out.find((v) => v.item.kind === "command");
    const attr = out.find((v) => v.item.kind === "attribute");
    expect(command?.ctx.enclosing).toBe("top");
    expect(attr?.ctx.enclosing).toBe("commandBlock");
    expect(attr?.ctx.sharedBlock).toBe(false);
  });

  it("visits every if branch, not only a selected one — there is no selection to know", () => {
    const out = visited("<OBJECTS_GENERATION>\nif REGICIDE create_object KING else create_object SCOUT endif");
    // Both branches' commands are present; the walker has no notion of which
    // one S0 would select.
    expect(out.filter((v) => v.item.kind === "if")).toHaveLength(1);
    const commands = out.filter((v) => v.item.kind === "command");
    expect(commands).toHaveLength(2);
    for (const c of commands) expect(c.ctx.enclosing).toBe("ifBranch");
  });

  it("descends both the start_random preamble and every percent_chance branch", () => {
    const out = visited(
      "<OBJECTS_GENERATION>\nstart_random\nmax_distance_to_players 8\npercent_chance 50 create_object KING\npercent_chance 50 create_object SCOUT\nend_random",
    );
    expect(out.filter((v) => v.item.kind === "random")).toHaveLength(1);
    const attr = out.find((v) => v.item.kind === "attribute");
    expect(attr?.ctx.enclosing).toBe("randomPreamble");
    const commands = out.filter((v) => v.item.kind === "command");
    expect(commands).toHaveLength(2);
    for (const c of commands) expect(c.ctx.enclosing).toBe("randomBranch");
  });

  // guide Example2 verbatim (parser.test.ts's own fixture for RMS0110): an
  // unrecognised word opens a real block, which the parser keeps as a shared
  // OrphanBlockNode rather than discarding it.
  it("descends into an orphan (shared) block and marks it sharedBlock, and keeps that flag nested further in", () => {
    const out = visited(
      "<OBJECTS_GENERATION>\nif REGICIDE create_object KING else create_object SCOUT endif\n{ max_distance_to_players 8 }",
    );
    const orphan = out.find((v) => v.item.kind === "orphanBlock");
    expect(orphan?.ctx.sharedBlock).toBe(false); // the orphan block ITSELF is not "inside" a shared block
    const attr = out.find((v) => v.item.kind === "attribute");
    expect(attr?.ctx.enclosing).toBe("orphanBlock");
    expect(attr?.ctx.sharedBlock).toBe(true);
  });

  it("does not descend into a raw node — it has no children", () => {
    // Interleaved if/random overlap degrades to one RawNode (parser.test.ts).
    const out = visited("if A start_random percent_chance 100 endif end_random");
    expect(out.some((v) => v.item.kind === "raw")).toBe(true);
    // Nothing else was extracted from inside the raw span.
    expect(out).toHaveLength(1);
  });

  it("hands back the branch object so a caller can correlate against S0's own selection", () => {
    const out = visited("<OBJECTS_GENERATION>\nif REGICIDE create_object KING endif");
    const command = out.find((v) => v.item.kind === "command");
    expect(command?.ctx.enclosing).toBe("ifBranch");
    const branch = command?.ctx.branch as IfBranch | undefined;
    expect(branch?.keyword).toBeDefined();
  });

  describe("insideRandom", () => {
    it("is false outside any start_random", () => {
      const out = visited("<LAND_GENERATION>\ncreate_land { terrain_type GRASS }");
      for (const v of out) expect(v.ctx.insideRandom).toBe(false);
    });

    it("is true for the preamble and every branch, and stays true nested further in", () => {
      const out = visited(
        "<OBJECTS_GENERATION>\nstart_random\nmax_distance_to_players 8\npercent_chance 50 create_object KING { actor_area 1 }\nend_random",
      );
      const attr = out.find((v) => v.item.kind === "attribute" && v.ctx.enclosing === "randomPreamble");
      expect(attr?.ctx.insideRandom).toBe(true);
      const command = out.find((v) => v.item.kind === "command");
      expect(command?.ctx.insideRandom).toBe(true);
      // Nested inside the command's OWN block, two levels down from the
      // random branch — enclosing reads "commandBlock", not "randomBranch",
      // which is exactly the case a single-level check would miss.
      const nestedAttr = out.find((v) => v.item.kind === "attribute" && v.ctx.enclosing === "commandBlock");
      expect(nestedAttr?.ctx.insideRandom).toBe(true);
    });

    it("does not become true merely from sitting inside an if branch", () => {
      const out = visited("<OBJECTS_GENERATION>\nif REGICIDE create_object KING endif");
      const command = out.find((v) => v.item.kind === "command");
      expect(command?.ctx.insideRandom).toBe(false);
    });
  });
});
