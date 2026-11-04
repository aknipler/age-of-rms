// Reads a BDD node back as a short sentence, for messages
// (docs/name-liveness-design.md Sec.6.1). PURE.
//
// A BDD is a graph, and each path from the root to the TRUE terminal is one
// way for the formula to hold: a product of yes-or-no facts about the atoms
// the path tests. The formula is the sum of those products. For a name that
// is only defined in some situations, that is the sentence "TINY_MAP or
// SMALL_MAP".

import type { Bdd, BddNode } from "./bdd";

/** At most this many products are written out. */
const MAX_PRODUCTS = 3;

/**
 * A short sum of products of atom names, such as `2 players and not Tiny map
 * size or 3 players`, cut at three products with "or more". `atomName` turns
 * a variable index into its name (AtomTable.atomName).
 */
export function describeCondition(
  bdd: Bdd,
  node: BddNode,
  atomName: (variable: number) => string,
): string {
  if (node === bdd.TRUE) return "always";
  if (node === bdd.FALSE) return "never";

  const products: string[] = [];
  let more = false;
  const path: string[] = [];

  // Depth-first from the root, collecting the literals along the way. It
  // stops once it has seen one product more than it will print, which is all
  // that "or more" needs to know.
  const visit = (n: BddNode): void => {
    if (more) return;
    if (n === bdd.FALSE) return;
    if (n === bdd.TRUE) {
      if (products.length === MAX_PRODUCTS) {
        more = true;
        return;
      }
      products.push(path.length === 0 ? "always" : path.join(" and "));
      return;
    }
    const name = atomName(bdd.variableOf(n)!);
    path.push(`not ${name}`);
    visit(bdd.lowOf(n));
    path.pop();
    path.push(name);
    visit(bdd.highOf(n));
    path.pop();
  };
  visit(node);

  return products.join(" or ") + (more ? " or more" : "");
}
