// describeCondition (src/parser/liveness/describe.ts) on three formulas.

import { describe, expect, it } from "vitest";
import { Bdd } from "../bdd";
import { describeCondition } from "../describe";

const NAMES = ["A", "B", "C", "D", "E"];
const name = (v: number): string => NAMES[v];

describe("describeCondition", () => {
  it("names the constants", () => {
    const bdd = new Bdd();
    expect(describeCondition(bdd, bdd.TRUE, name)).toBe("always");
    expect(describeCondition(bdd, bdd.FALSE, name)).toBe("never");
  });

  it("writes a conjunction as one product", () => {
    const bdd = new Bdd();
    const f = bdd.and(bdd.variable(0), bdd.not(bdd.variable(1)));
    expect(describeCondition(bdd, f, name)).toBe("A and not B");
  });

  it("writes a disjunction as a sum and cuts at three products", () => {
    const bdd = new Bdd();
    const two = bdd.or(bdd.variable(0), bdd.variable(1));
    // Paths to TRUE: A false then B true, and A true.
    expect(describeCondition(bdd, two, name)).toBe("not A and B or A");
    const many = [0, 1, 2, 3, 4].reduce(
      (acc, v) => bdd.or(acc, bdd.variable(v)),
      bdd.FALSE,
    );
    expect(describeCondition(bdd, many, name).endsWith(" or more")).toBe(true);
  });
});
