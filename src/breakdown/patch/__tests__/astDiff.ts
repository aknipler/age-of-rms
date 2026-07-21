// Phase 3.3 — the shift-aware AST comparator (breakdown-design §4.8).
// Implements clauses 1, 2, 4, 5 fully; clause 3's ancestor-chain rule is
// verified implicitly (ancestors straddle and are excluded from 1-2; their
// stretched spans are exercised by clause 5's well-nestedness) plus light
// per-intent checks living in the test files. Returns human-readable
// violations; empty array = pass.

import type { ParseResult } from "../../../parser/types";
import type { TextEdit } from "../intents";
import { checkProperties, collectNodes } from "../../../parser/__tests__/testUtils";

interface NodeKey {
  label: string;
  start: number;
  end: number;
  slice: string;
}

function nodeKeys(result: ParseResult): NodeKey[] {
  return collectNodes(result).map(({ node }) => ({
    label: node.label,
    start: node.span.start,
    end: node.span.end,
    slice: result.source.slice(node.span.start, node.span.end),
  }));
}

function keyId(k: NodeKey): string {
  return `${k.label}@${k.start}-${k.end}:${k.slice}`;
}

export interface DiffOptions {
  /** Range whose interior trivia is EXPECTED to disappear (delete intents, clause 4 rev-3 scoping). */
  deletedRange?: { start: number; end: number };
}

export function astDiff(a: ParseResult, b: ParseResult, edit: TextEdit, opts: DiffOptions = {}): string[] {
  const problems: string[] = [];
  const delta = edit.newText.length - (edit.end - edit.start);

  // Clause 5 first — if B is malformed nothing else is meaningful.
  problems.push(...checkProperties(b).map((p) => `clause5(wellformed): ${p}`));
  const errorCounts = (r: ParseResult) => {
    const m = new Map<string, number>();
    for (const d of r.diagnostics) if (d.severity === "error") m.set(d.code, (m.get(d.code) ?? 0) + 1);
    return m;
  };
  const errA = errorCounts(a);
  for (const [code, n] of errorCounts(b)) {
    if (n > (errA.get(code) ?? 0)) problems.push(`clause5(errors): new error-severity ${code} in patched parse`);
  }

  // Clauses 1-2: pre-edit nodes identical, post-edit nodes translated by delta.
  // Boundary subtlety the spec's <= partition doesn't spell out: a CONTAINER
  // whose span ends exactly at an insertion point (append into a section /
  // block-less command growing a block) legitimately STRETCHES to absorb the
  // insert. For nodes touching the edit point we therefore accept either the
  // identical key or a same-start stretched key (label match, end shifted).
  const bKeys = nodeKeys(b);
  const bIds = new Set(bKeys.map(keyId));
  const bByLabelStart = new Set(bKeys.map((k) => `${k.label}@${k.start}-${k.end}`));
  for (const k of nodeKeys(a)) {
    if (k.end < edit.start || (k.end === edit.start && bIds.has(keyId(k)))) {
      if (!bIds.has(keyId(k))) problems.push(`clause1: pre-edit ${k.label}@${k.start} has no identical counterpart`);
    } else if (k.end === edit.start) {
      // Touching container: allow stretch (same start, end absorbed the delta).
      if (!bByLabelStart.has(`${k.label}@${k.start}-${k.end + delta}`)) {
        problems.push(`clause1b: node ${k.label}@${k.start} ending at the edit neither survived nor stretched by ${delta}`);
      }
    } else if (k.start > edit.end || (k.start === edit.end && delta !== 0)) {
      const shifted: NodeKey = { ...k, start: k.start + delta, end: k.end + delta };
      if (!bIds.has(keyId(shifted)) && !bByLabelStart.has(`${k.label}@${k.start}-${k.end + delta}`)) {
        problems.push(`clause2: post-edit ${k.label}@${k.start} not found shifted by ${delta}`);
      }
    } else if (k.start === edit.end) {
      if (!bIds.has(keyId(k)) && !bByLabelStart.has(`${k.label}@${k.start + delta}-${k.end + delta}`)) {
        problems.push(`clause2b: node ${k.label}@${k.start} starting at the edit neither survived nor shifted`);
      }
    }
    // strictly straddling: governed per-intent (clause 3) — checked by the caller.
  }

  // Clause 4: trivia outside any deleted range survives byte-identical, in order.
  const del = opts.deletedRange;
  const surviving = a.tokens
    .filter((t) => t.isTrivia)
    .filter((t) => !(del && t.start >= del.start && t.end <= del.end))
    .map((t) => t.text);
  const actual = b.tokens.filter((t) => t.isTrivia).map((t) => t.text);
  if (surviving.length !== actual.length || surviving.some((t, i) => t !== actual[i])) {
    problems.push(
      `clause4: trivia sequence changed (expected ${surviving.length} comments/markers, got ${actual.length})`,
    );
  }

  return problems;
}
