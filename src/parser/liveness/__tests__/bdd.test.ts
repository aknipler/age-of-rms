// The BDD (src/parser/liveness/bdd.ts) against truth tables and its own
// canonical-form promise.

import { describe, expect, it } from "vitest";
import { Bdd, BddOverflow, type BddNode } from "../bdd";

/** A small seeded generator, so the property test is the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Bdd", () => {
  it("collapses a contradiction to FALSE and a tautology to TRUE", () => {
    const bdd = new Bdd();
    const x = bdd.variable(0);
    expect(bdd.and(x, bdd.not(x))).toBe(bdd.FALSE);
    expect(bdd.or(x, bdd.not(x))).toBe(bdd.TRUE);
  });

  it("gives equal formulas built different ways the same node", () => {
    const bdd = new Bdd();
    const [a, b, c] = [bdd.variable(0), bdd.variable(1), bdd.variable(2)];
    // Distribution: (a or b) and (a or c) equals a or (b and c).
    const left = bdd.and(bdd.or(a, b), bdd.or(a, c));
    const right = bdd.or(a, bdd.and(b, c));
    expect(left).toBe(right);
  });

  it("agrees with a truth table on random formulas over 5 variables", () => {
    const rand = mulberry32(12345);
    const VARS = 5;
    type Formula =
      | { op: "var"; i: number }
      | { op: "not"; a: Formula }
      | { op: "and" | "or"; a: Formula; b: Formula };
    const gen = (depth: number): Formula => {
      if (depth === 0 || rand() < 0.2)
        return { op: "var", i: Math.floor(rand() * VARS) };
      const r = rand();
      if (r < 0.2) return { op: "not", a: gen(depth - 1) };
      return {
        op: r < 0.6 ? "and" : "or",
        a: gen(depth - 1),
        b: gen(depth - 1),
      };
    };
    const evalF = (f: Formula, env: boolean[]): boolean => {
      switch (f.op) {
        case "var":
          return env[f.i];
        case "not":
          return !evalF(f.a, env);
        case "and":
          return evalF(f.a, env) && evalF(f.b, env);
        case "or":
          return evalF(f.a, env) || evalF(f.b, env);
      }
    };
    const build = (bdd: Bdd, f: Formula): BddNode => {
      switch (f.op) {
        case "var":
          return bdd.variable(f.i);
        case "not":
          return bdd.not(build(bdd, f.a));
        case "and":
          return bdd.and(build(bdd, f.a), build(bdd, f.b));
        case "or":
          return bdd.or(build(bdd, f.a), build(bdd, f.b));
      }
    };
    // Reads the diagram under an assignment by walking from the root.
    const read = (bdd: Bdd, n: BddNode, env: boolean[]): boolean => {
      while (n > 1) n = env[bdd.variableOf(n)!] ? bdd.highOf(n) : bdd.lowOf(n);
      return n === 1;
    };
    for (let round = 0; round < 300; round++) {
      const bdd = new Bdd();
      const f = gen(5);
      const node = build(bdd, f);
      for (let bits = 0; bits < 1 << VARS; bits++) {
        const env = Array.from(
          { length: VARS },
          (_, i) => ((bits >> i) & 1) === 1,
        );
        expect(read(bdd, node, env)).toBe(evalF(f, env));
      }
    }
  });

  it("answers implies on three hand cases", () => {
    const bdd = new Bdd();
    const [a, b] = [bdd.variable(0), bdd.variable(1)];
    expect(bdd.implies(bdd.and(a, b), a)).toBe(true);
    expect(bdd.implies(a, bdd.and(a, b))).toBe(false);
    expect(bdd.implies(bdd.FALSE, a)).toBe(true);
  });

  it("throws BddOverflow past the node cap", () => {
    const bdd = new Bdd(4);
    expect(() => {
      let f = bdd.TRUE;
      for (let i = 0; i < 10; i++) f = bdd.and(f, bdd.variable(i));
    }).toThrow(BddOverflow);
  });
});
