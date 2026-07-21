// Phase 3.3 — the §4.8 property gate. For seeded random intents over every
// available corpus map: patched source re-parses with the intended change
// and no other AST difference; comments outside deleted ranges survive
// byte-identical. Per-file seeding (filename-derived) so results are
// identical whether or not gitignored maps are present (spec §4.8 rev 3).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { buildLanguageIndex } from "../../../parser/language";
import type {
  ArgNode,
  AttributeNode,
  BlockNode,
  CommandNode,
  DirectiveNode,
  Item,
  ParseResult,
  SectionNode,
} from "../../../parser/types";
import { loadLanguage, REPO_ROOT } from "../../../parser/__tests__/testUtils";
import { NUMERIC_ARGUMENT_TYPES } from "../../../parser/language";
import { applyEdit, computeEdit } from "../computeEdit";
import { PatchError, type EditIntent } from "../intents";
import { astDiff } from "./astDiff";

const langData = loadLanguage();
const lang = buildLanguageIndex(langData);
const N_INTENTS = 25;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fileSeed(name: string): number {
  let h = 0xa0e2_2026;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) >>> 0;
  return h;
}

/** Candidate pools harvested from one parse. */
interface Pools {
  numericArgs: ArgNode[];
  removables: (CommandNode | AttributeNode | DirectiveNode)[];
  closedBlocks: { block: BlockNode; owner: CommandNode }[];
  sections: SectionNode[];
}

/** True when this file offers the generator nothing to do (see the assertion at the end). */
function isInert(p: Pools): boolean {
  return p.numericArgs.length === 0 && p.removables.length === 0 && p.closedBlocks.length === 0 && p.sections.length === 0;
}

function harvest(r: ParseResult): Pools {
  const pools: Pools = { numericArgs: [], removables: [], closedBlocks: [], sections: [] };
  const visitItems = (items: Item[]) => {
    for (const item of items) {
      if (item.kind === "command" || item.kind === "attribute" || item.kind === "directive") {
        // Directives ARE removable: `removeNode` accepts DirectiveNode (intents.ts)
        // and computeEdit handles it generically via removeSpan. Excluding them was a
        // harness omission that left every directive edit — i.e. the whole Header tab
        // surface (spec §3.1/§3.6) — with zero property coverage, and made maps whose
        // only content is directives generate no intents at all (the EM_* stubs below).
        pools.removables.push(item);
        for (const arg of item.args) {
          const tok = r.tokens[arg.firstToken];
          if (
            arg.def &&
            NUMERIC_ARGUMENT_TYPES.has(arg.def.type) &&
            tok.kind === "number" &&
            arg.firstToken === arg.lastToken
          ) {
            pools.numericArgs.push(arg);
          }
        }
      }
      if (item.kind === "command" && item.block && item.block.close !== undefined && item.def?.attributes?.length) {
        pools.closedBlocks.push({ block: item.block, owner: item });
        visitItems(item.block.items);
      } else if (item.kind === "command" && item.block) {
        visitItems(item.block.items);
      }
      if (item.kind === "if") for (const b of item.branches) visitItems(b.items);
      if (item.kind === "random") {
        visitItems(item.preamble);
        for (const b of item.branches) visitItems(b.items);
      }
      if (item.kind === "orphanBlock" && item.block) visitItems(item.block.items);
    }
  };
  visitItems(r.script.preamble);
  for (const s of r.script.sections) {
    if (s.known) pools.sections.push(s);
    visitItems(s.items);
  }
  return pools;
}

function makeIntent(pools: Pools, rand: () => number): EditIntent | undefined {
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const kinds: string[] = [];
  if (pools.numericArgs.length) kinds.push("set");
  if (pools.removables.length) kinds.push("remove");
  if (pools.closedBlocks.length) kinds.push("addAttr");
  if (pools.sections.length) kinds.push("addCmd");
  // §3.9's `{ after: Item }` InsertTarget, reinstated in intents.ts/computeEdit.ts
  // this session — reuses the `removables` pool (every command/attribute/
  // directive at any nesting depth) as anchors, since that's exactly the set
  // of Items §3.9's card-selection can produce as `selectedItem`.
  if (pools.removables.length) kinds.push("addCmdAfter");
  if (kinds.length === 0) return undefined;
  switch (pick(kinds)) {
    case "set": {
      const arg = pick(pools.numericArgs);
      const max = arg.def?.max ?? 100;
      const min = Math.max(arg.def?.min ?? 0, 0);
      const value = min + Math.floor(rand() * Math.max(1, max - min + 1));
      return { kind: "setArgValue", arg, value };
    }
    case "remove":
      return { kind: "removeNode", node: pick(pools.removables) };
    case "addAttr": {
      const { block, owner } = pick(pools.closedBlocks);
      const candidates = (owner.def?.attributes ?? []).filter((n) => lang.attributesByName.has(n));
      if (candidates.length === 0) return undefined;
      return { kind: "addAttribute", target: block, name: pick(candidates) };
    }
    case "addCmdAfter": {
      const anchor = pick(pools.removables);
      if (langData.commands.length === 0) return undefined;
      return { kind: "addCommand", at: { after: anchor }, name: pick(langData.commands).name };
    }
    default: {
      const section = pick(pools.sections);
      const cmds = langData.commands.filter((c) => c.section === section.name);
      if (cmds.length === 0) return undefined;
      return { kind: "addCommand", at: { in: "section", section }, name: pick(cmds).name };
    }
  }
}

function mapsUnder(dir: string): { name: string; path: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".rms"))
    .map((e) => ({ name: e.name, path: join(dir, e.name) }));
}

const files = [...mapsUnder(join(REPO_ROOT, "test-maps")), ...mapsUnder(join(REPO_ROOT, "test-maps", "local"))].sort(
  (a, b) => a.name.localeCompare(b.name),
);

describe("§4.8 property gate: patch → reparse → only the intended diff", () => {
  it("found corpus files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    // Generous timeout: AK_Vanguard (~50k tokens) needs ~15s for 25 patched
    // re-parses + node-key diffs; the default 5s is for unit-scale tests.
    it(`${file.name} (seed ${fileSeed(file.name)})`, { timeout: 60_000 }, () => {
      const original = readFileSync(file.path, "utf8");
      const rand = mulberry32(fileSeed(file.name));
      let skipped = 0;
      // Every iteration edits the ORIGINAL source, so parse/harvest once.
      const a = parseRms(original, langData);
      const pools = harvest(a);
      for (let iter = 0; iter < N_INTENTS; iter++) {
        const intent = makeIntent(pools, rand);
        if (!intent) {
          skipped++;
          continue;
        }
        let editResult;
        try {
          editResult = computeEdit(a, intent, lang);
        } catch (e) {
          if (e instanceof PatchError) {
            skipped++;
            continue; // suppressed edit (unclosed container etc.) — spec §4.5
          }
          throw new Error(`(${file.name}, iter ${iter}, ${intent.kind}) computeEdit threw: ${String(e)}`);
        }
        const { edit } = editResult;
        const patched = applyEdit(original, edit);
        const b = parseRms(patched, langData);
        const isDeletion = edit.newText === "";
        const problems = astDiff(a, b, edit, isDeletion ? { deletedRange: { start: edit.start, end: edit.end } } : {});
        if (problems.length > 0) {
          throw new Error(
            `(${file.name}, iter ${iter}) intent ${intent.kind} → edit [${edit.start},${edit.end})="${edit.newText.slice(0, 40)}"\n${problems.slice(0, 6).join("\n")}`,
          );
        }
      }
      // The generator must be productive on any file that actually offers it a target —
      // this is the guard against a silently broken makeIntent/harvest. But "at least one
      // real edit per file" is false as an absolute: a file can legitimately have nothing
      // to edit (e.g. the EM_* stubs are two directives and no sections/commands/blocks —
      // 48 bytes total). Asserting unconditionally made those files fail on a correct
      // engine. Assert productivity where there are targets, and inertness where there
      // aren't, so both a broken generator and a mis-harvested file still fail loudly.
      if (isInert(pools)) {
        expect(skipped).toBe(N_INTENTS);
      } else {
        expect(skipped).toBeLessThan(N_INTENTS);
      }
    });
  }
});
