// Sec.5.5: the compiler checks its own homework, before offering a single
// edit.
//
//   1. Seed a resolver with the script's own symbols.
//   2. Walk the emitted #consts in order, evaluating each with
//      evaluateExpressionTokens and adding the result to the resolver, i.e.
//      read the generated block back exactly as the engine will.
//   3. Independently evaluate the user's original DAG under the same
//      operator semantics (evalExpr, expr.ts).
//   4. Assert EXACT equality. Both sides use identical operator rules
//      (applyOperator, shared, see expr.ts), so any difference is a
//      compiler bug, not a rounding difference to tolerate.
//
// On disagreement the tool emits nothing and reports the offending node. A
// compiler that can only ever be wrong LOUDLY is worth more here than one
// that is usually right.

import type { Expr } from "../../../../../tools-api/index";
import { evaluateExpressionTokens } from "../../../../preview/generator/mathEval";
import { evalExpr } from "./expr";
import type { EmittedConst } from "./emit";

export interface VerifyTarget {
  /** The emitted cell's own name (must match one entry in `emitted`). */
  name: string;
  /** The ORIGINAL, pre-lowering Expr this cell was built from (sin/cos/node/param intact). */
  source: Expr;
}

export interface VerifyProblem {
  name: string;
  emittedValue: number | undefined;
  directValue: number | undefined;
}

export interface VerifyResult {
  ok: boolean;
  /** name -> resolved value, from walking `emitted` in order (step 2). */
  resolved: ReadonlyMap<string, number>;
  problems: readonly VerifyProblem[];
}

export function verifyEmission(
  emitted: readonly EmittedConst[],
  targets: readonly VerifyTarget[],
  scriptSymbols: ReadonlyMap<string, number>,
  resolveParam: (id: string) => number | undefined = () => undefined,
  resolveNode: (id: string, field: "x" | "y" | "theta" | "inbound") => number | undefined = () => undefined,
  /**
   * A DETERMINISTIC value to seed `resolved` with for specific cell names,
   * bypassing `evaluateExpressionTokens` for them entirely, found necessary
   * building `paramEmit.ts` (Sec.4.4): a `#const NAME rnd(a,b)` cell's own
   * value can never come from that function, since its Sec.2.2 contract
   * makes `rnd(...)` unresolvable as an operand unconditionally, including
   * as a whole-value single token. Without this, a param cell and everything
   * downstream of it silently resolve to `undefined` in BOTH step 2 and step
   * 3 (the latter via `resolveSym` falling through to the same map), which
   * never disagree and so never trip step 4's equality check, a false
   * "verified" on a model that never actually got checked. Empty for every
   * caller but `emitAlpModel`.
   */
  paramCellValues: ReadonlyMap<string, number> = new Map(),
): VerifyResult {
  // Step 1 + 2: seed with the script's own symbols, then read the emitted
  // block back exactly as the engine will, in emission order.
  const resolved = new Map<string, number>(scriptSymbols);
  for (const cell of emitted) {
    const seeded = paramCellValues.get(cell.name);
    const value = seeded !== undefined ? seeded : evaluateExpressionTokens(cell.tokens, (n) => resolved.get(n));
    if (value !== undefined) resolved.set(cell.name, value);
  }

  const byName = new Map(emitted.map((c) => [c.name, c] as const));
  const problems: VerifyProblem[] = [];

  for (const target of targets) {
    const cell = byName.get(target.name);
    if (cell === undefined) {
      problems.push({ name: target.name, emittedValue: undefined, directValue: undefined });
      continue;
    }
    const emittedValue = resolved.get(target.name);
    // Step 3: independently evaluate the ORIGINAL DAG.
    const directValue = evalExpr(target.source, {
      resolveSym: (name) => resolved.get(name) ?? scriptSymbols.get(name),
      resolveParam,
      resolveNode,
    });
    if (emittedValue !== directValue) {
      problems.push({ name: target.name, emittedValue, directValue });
    }
  }

  return { ok: problems.length === 0, resolved, problems };
}
