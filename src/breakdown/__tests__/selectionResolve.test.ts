import { describe, expect, it } from "vitest";
import { parseRms } from "../../parser/parser";
import { loadLanguage } from "../../parser/__tests__/testUtils";
import { findItemAtOffsetInScript } from "../selectionResolve";

// §3.9 — findItemAtOffset must resolve to the innermost SELECTABLE item at
// a given offset: it descends into if/random branches (those render as
// separate nested ItemCards) but must NOT descend into a command's own
// block/attributes (those render as part of the same CommandCard, not a
// separate selectable child).
describe("selectionResolve", () => {
  const langData = loadLanguage();

  it("resolves a top-level command in a section", () => {
    const src = "<PLAYER_SETUP>\nnomad_resources\n";
    const r = parseRms(src, langData);
    const cmdOffset = src.indexOf("nomad_resources") + 2;
    const found = findItemAtOffsetInScript(r.script, cmdOffset);
    expect(found?.kind).toBe("command");
  });

  it("does not descend into a command's own block/attributes", () => {
    const src = "<PLAYER_SETUP>\ncreate_terrain FOREST\n{\n  base_size 5\n}\n";
    const r = parseRms(src, langData);
    const blockInnerOffset = src.indexOf("base_size") + 2;
    const found = findItemAtOffsetInScript(r.script, blockInnerOffset);
    // Still resolves to the owning command, not something inside the block —
    // there IS no separate Item for `base_size` (it's an AttributeNode
    // living on the CommandNode's block.attributes, not a sibling Item).
    expect(found?.kind).toBe("command");
  });

  it("descends into an if-branch to find the nested command", () => {
    const src = "<PLAYER_SETUP>\nif TEST\n  nomad_resources\nendif\n";
    const r = parseRms(src, langData);
    const nestedOffset = src.indexOf("nomad_resources") + 2;
    const found = findItemAtOffsetInScript(r.script, nestedOffset);
    expect(found?.kind).toBe("command");
  });

  it("resolves to the if-node itself when the offset is on the if/endif keyword, not a branch item", () => {
    const src = "<PLAYER_SETUP>\nif TEST\n  nomad_resources\nendif\n";
    const r = parseRms(src, langData);
    const ifKeywordOffset = src.indexOf("if TEST") + 1;
    const found = findItemAtOffsetInScript(r.script, ifKeywordOffset);
    expect(found?.kind).toBe("if");
  });

  it("descends into a random-node preamble and branches", () => {
    const src = "<PLAYER_SETUP>\nstart_random\n  nomad_resources\n  percent_chance 100\n  nomad_resources\nend_random\n";
    const r = parseRms(src, langData);
    const preambleOffset = src.indexOf("nomad_resources") + 2;
    const foundPreamble = findItemAtOffsetInScript(r.script, preambleOffset);
    expect(foundPreamble?.kind).toBe("command");

    const branchOffset = src.lastIndexOf("nomad_resources") + 2;
    const foundBranch = findItemAtOffsetInScript(r.script, branchOffset);
    expect(foundBranch?.kind).toBe("command");
    expect(foundBranch).not.toBe(foundPreamble);
  });

  it("returns undefined for an offset that falls in whitespace between items", () => {
    const src = "<PLAYER_SETUP>\nnomad_resources\n\n\nnomad_resources\n";
    const r = parseRms(src, langData);
    // Right in the blank-line gap between the two commands.
    const gapOffset = src.indexOf("\n\n\n") + 2;
    const found = findItemAtOffsetInScript(r.script, gapOffset);
    expect(found).toBeUndefined();
  });
});
