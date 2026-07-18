// Shared helpers for the Phase 2.3 parser suites: language.json loading and
// the two non-negotiable §12 properties (coverage/ownership + span fidelity)
// that corpus.test.ts and fuzz.test.ts both gate on.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item, ParseResult, SectionNode } from "../types";
import type { LanguageData } from "../language";

const here = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = join(here, "..", "..", "..");

export function loadLanguage(): LanguageData {
  const raw = readFileSync(join(REPO_ROOT, "reference", "data", "language.json"), "utf8");
  return JSON.parse(raw) as LanguageData;
}

interface Ranged {
  firstToken: number;
  lastToken: number;
  span: { start: number; end: number };
  label: string;
}

/** Flatten every ranged node in the AST (depth-first, parents before children). */
export function collectNodes(result: ParseResult): { node: Ranged; children: Ranged[] }[] {
  const out: { node: Ranged; children: Ranged[] }[] = [];

  function argRanges(args: { firstToken: number; lastToken: number; span: { start: number; end: number } }[]): Ranged[] {
    return args.map((a, i) => ({ ...a, label: `arg[${i}]` }));
  }

  function visitItem(item: Item): Ranged {
    const self: Ranged = { firstToken: item.firstToken, lastToken: item.lastToken, span: item.span, label: item.kind };
    const children: Ranged[] = [];
    switch (item.kind) {
      case "command": {
        children.push(...argRanges(item.args));
        if (item.block) children.push(visitBlockLike(item.block.items, item.block));
        break;
      }
      case "attribute":
      case "directive":
        children.push(...argRanges(item.args));
        break;
      case "if":
        for (const b of item.branches) for (const i of b.items) children.push(visitItem(i));
        break;
      case "random":
        for (const i of item.preamble) children.push(visitItem(i));
        for (const b of item.branches) {
          if (b.chance) children.push({ ...b.chance, label: "chance" });
          for (const i of b.items) children.push(visitItem(i));
        }
        break;
      case "orphanBlock":
        if (item.block) children.push(visitBlockLike(item.block.items, item.block));
        break;
      case "raw":
        break;
    }
    out.push({ node: self, children });
    return self;
  }

  function visitBlockLike(items: Item[], block: { firstToken: number; lastToken: number; span: { start: number; end: number } }): Ranged {
    const self: Ranged = { firstToken: block.firstToken, lastToken: block.lastToken, span: block.span, label: "block" };
    const children = items.map(visitItem);
    out.push({ node: self, children });
    return self;
  }

  for (const item of result.script.preamble) visitItem(item);
  for (const section of result.script.sections) {
    const s: SectionNode = section;
    const children = s.items.map(visitItem);
    out.push({
      node: { firstToken: s.firstToken, lastToken: s.lastToken, span: s.span, label: `section<${s.name}>` },
      children,
    });
  }
  return out;
}

/**
 * §12 property (a): every non-trivia token is inside at least one node's
 * token range, and children nest strictly within their parents.
 * §12 property (b): every node's span starts/ends exactly at its first/last
 * token's text.
 * Returns a list of human-readable violations (empty = pass).
 */
export function checkProperties(result: ParseResult): string[] {
  const problems: string[] = [];
  const nodes = collectNodes(result);

  // Span fidelity + nesting.
  for (const { node, children } of nodes) {
    const first = result.tokens[node.firstToken];
    const last = result.tokens[node.lastToken];
    if (!first || !last) {
      problems.push(`${node.label}: token index out of range`);
      continue;
    }
    if (node.span.start !== first.start || node.span.end !== last.end) {
      problems.push(`${node.label}: span (${node.span.start},${node.span.end}) != tokens (${first.start},${last.end})`);
    }
    const slice = result.source.slice(node.span.start, node.span.end);
    if (!slice.startsWith(first.text) || !slice.endsWith(last.text)) {
      problems.push(`${node.label}: source slice does not start/end with its boundary tokens`);
    }
    for (const child of children) {
      if (child.firstToken < node.firstToken || child.lastToken > node.lastToken) {
        problems.push(`${node.label}: child ${child.label} [${child.firstToken},${child.lastToken}] escapes parent [${node.firstToken},${node.lastToken}]`);
      }
    }
  }

  // Coverage: every non-trivia token inside >=1 node range.
  const covered = new Array<boolean>(result.tokens.length).fill(false);
  for (const { node } of nodes) {
    for (let i = node.firstToken; i <= node.lastToken && i < result.tokens.length; i++) covered[i] = true;
  }
  for (let i = 0; i < result.tokens.length; i++) {
    if (!result.tokens[i].isTrivia && !covered[i]) {
      problems.push(`token ${i} ("${result.tokens[i].text}" at ${result.tokens[i].start}) reachable from no AST node`);
    }
  }

  return problems;
}
