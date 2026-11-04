// The atoms of name liveness and the domain constraint D
// (docs/name-liveness-design.md Sec.4.1 to 4.3). PURE.
//
// An atom is one BDD variable standing for a yes-or-no fact about the lobby
// or the dice: "the map size is Tiny", "the label TINY_MAP is defined", "the
// start_random block on line 12 took its second arm". A guard is a formula
// over atoms.
//
// Not every combination of atoms can happen. A lobby has one map size, and a
// random block takes one arm. D, the domain, is the conjunction of those
// facts, true exactly on the combinations that can occur. Every question
// liveness asks is of the form "is guard and D impossible", so the facts are
// stated once here and the BDD does the rest.

import type { LabelGroup, PredefinedLabel } from "../language";
import { Bdd, type BddNode } from "./bdd";

/** The player counts a lobby offers. The labels `1_PLAYER_GAME` to `8_PLAYER_GAME` map onto these. */
const PLAYER_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
const PLAYER_LABEL = /^(\d+)_PLAYER_GAME$/;

/**
 * DE rolls 0 to 99 and takes the first arm whose running total reaches the
 * roll (preview-design Sec.3 rule 3, measured). A total of 99 therefore
 * already covers every roll, and an arm that starts after the total reached
 * 99 can never be taken. rms-check, whose model this follows, assumes a roll
 * of 1 to 100 and gets both of these wrong.
 */
const COVERS_EVERY_ROLL = 99;

/**
 * The size a map-size label names, as a key. Labels of one size share a
 * `dimensions` value (TINY_MAP and MAPSIZE_TINY are both 120), so that is the
 * identity. The `mapSize` field is not enough: it is absent on the sizes only
 * a launch option or override_map_size reaches (MAPSIZE_MASSIVE and up, MINI),
 * and a lobby still has exactly one size. Leaving those labels out of the
 * size group made every branch that tests one look impossible, 800 times on
 * DE's own maps.
 */
export function sizeKeyOf(label: PredefinedLabel): string | undefined {
  if (label.category !== "mapSize") return undefined;
  return label.dimensions !== undefined
    ? String(label.dimensions)
    : label.mapSize;
}

/** Every size the data names, once each, for the AtomTable's `mapSizes`. */
export function sizeKeys(labels: readonly PredefinedLabel[]): string[] {
  return [
    ...new Set(
      labels.map(sizeKeyOf).filter((k): k is string => k !== undefined),
    ),
  ];
}

interface BlockState {
  /** The atom of every arm that can be taken, in order. */
  possible: BddNode[];
  total: number;
  /** True once a chance that is not a literal number was seen. */
  nonLiteral: boolean;
  closed: boolean;
}

export class AtomTable {
  private nextVar = 0;
  private readonly names = new Map<number, string>();
  private readonly sizeAtoms = new Map<string, BddNode>();
  private readonly playerAtoms = new Map<number, BddNode>();
  /** Atoms for labels and unknown names, by name. A name has one atom whether it is read as a label or as a free name. */
  private readonly named = new Map<string, BddNode>();
  private readonly labelByName = new Map<string, PredefinedLabel>();
  private readonly groupById = new Map<string, LabelGroup>();
  /** The atoms made so far for each group's members. A member never read has no atom and no constraint. */
  private readonly groupMembers = new Map<string, BddNode[]>();
  private readonly blocks: BlockState[] = [];
  /** The size and player constraints, true from the start. */
  private base: BddNode;
  /** The constraints of blocks closed so far, conjoined. */
  /** One constraint per closed block, in closing order. Joined in domain(), see the note there. */
  private readonly blockConstraints: BddNode[] = [];

  constructor(
    private readonly bdd: Bdd,
    labels: readonly PredefinedLabel[],
    groups: readonly LabelGroup[],
    mapSizes: readonly string[],
  ) {
    for (const label of labels) this.labelByName.set(label.name, label);
    for (const group of groups) this.groupById.set(group.id, group);

    // Created first, so they get the lowest variable indices and the BDD
    // tests them nearest the root. Variable order is the main cost lever of
    // a BDD (a bad order can make a small formula exponentially large), and
    // putting the facts every guard leans on at the top keeps chains short.
    for (const size of mapSizes)
      this.sizeAtoms.set(size, this.newAtom(`${size} map size`));
    for (const n of PLAYER_COUNTS)
      this.playerAtoms.set(n, this.newAtom(`${n} players`));

    this.base = this.exactlyOne([...this.sizeAtoms.values()]);
    this.base = bdd.and(
      this.base,
      this.exactlyOne([...this.playerAtoms.values()]),
    );
  }

  /**
   * The node for a predefined label. A map-size label is its size's atom, so
   * `TINY_MAP` and `MAPSIZE_TINY`, the legacy and modern names of one size,
   * are the same node with nothing written by hand. `N_PLAYER_GAME` is the
   * player atom. Any other label has its own atom and, if the data gives it a
   * group, takes part in that group's constraint. A name that is not a
   * predefined label is a free atom.
   */
  label(name: string): BddNode {
    const data = this.labelByName.get(name);
    if (data === undefined) return this.free(name);
    const key = sizeKeyOf(data);
    if (key !== undefined) {
      const size = this.sizeAtoms.get(key);
      if (size !== undefined) return size;
    }
    if (data.category === "playerCount") {
      const m = PLAYER_LABEL.exec(name);
      const atom = m === null ? undefined : this.playerAtoms.get(Number(m[1]));
      if (atom !== undefined) return atom;
    }
    const found = this.named.get(name);
    if (found !== undefined) return found;
    const atom = this.newAtom(name);
    this.named.set(name, atom);
    if (data.group !== undefined) {
      const members = this.groupMembers.get(data.group) ?? [];
      members.push(atom);
      this.groupMembers.set(data.group, members);
    }
    return atom;
  }

  /**
   * A fresh atom for a name no data knows and the script never defines, the
   * same node every time for one name. This is CLAUDE.md's positive-resolver
   * rule applied to liveness: our data missing a name proves nothing about
   * the engine, so it is "possibly defined", never "never defined".
   */
  free(name: string): BddNode {
    const found = this.named.get(name);
    if (found !== undefined) return found;
    const atom = this.newAtom(name);
    this.named.set(name, atom);
    return atom;
  }

  /** Opens a start_random block and returns its id. */
  openBlock(): number {
    this.blocks.push({
      possible: [],
      total: 0,
      nonLiteral: false,
      closed: false,
    });
    return this.blocks.length - 1;
  }

  /**
   * The node for the next arm of a block, or FALSE for an arm that can never
   * be taken (a later arm at 0 percent, or one that starts after the total
   * reached 99). An arm that cannot be taken gets no atom.
   *
   * `chance` is the literal number, or undefined when the chance is a name,
   * an rnd() or an expression. That arm and every later one count as
   * possible and the block as not exhaustive, the weaker reading, which can
   * only turn a definite answer into "maybe".
   */
  arm(block: number, chance: number | undefined): BddNode {
    const state = this.blocks[block];
    const first = state.possible.length === 0 && state.total === 0;
    let possible: boolean;
    if (chance === undefined) {
      state.nonLiteral = true;
      possible = true;
    } else if (state.nonLiteral) {
      possible = true;
    } else {
      // The first arm wins a roll of 0, so it is possible even at 0 percent.
      possible = first || (chance > 0 && state.total < COVERS_EVERY_ROLL);
    }
    if (chance !== undefined) state.total += chance;
    if (!possible) return this.bdd.FALSE;
    const atom = this.newAtom(
      `arm ${state.possible.length + 1} of random block ${block + 1}`,
    );
    state.possible.push(atom);
    return atom;
  }

  /** Adds the block's constraint to D. */
  closeBlock(block: number): void {
    const state = this.blocks[block];
    if (state.closed) return;
    state.closed = true;
    const exhaustive = !state.nonLiteral && state.total >= COVERS_EVERY_ROLL;
    this.blockConstraints.push(
      exhaustive
        ? this.exactlyOne(state.possible)
        : this.atMostOne(state.possible),
    );
  }

  /**
   * D, the conjunction of every constraint so far.
   *
   * The ORDER the pieces are joined in decides the cost. Joining a new
   * constraint onto the end of a growing conjunction whose variables sit above
   * it rebuilds the whole conjunction above the new part, once per constraint,
   * which is quadratic and cost 300,000 nodes on one DE script. Joining from
   * the variables farthest from the root upward adds each constraint on top of
   * what exists, so each costs only its own size.
   */
  domain(): BddNode {
    // Atoms are numbered in order of first use, so the last constraint's
    // variables are the farthest from the root.
    let d: BddNode = this.bdd.TRUE;
    for (let i = this.blockConstraints.length - 1; i >= 0; i--)
      d = this.bdd.and(this.blockConstraints[i], d);
    d = this.bdd.and(this.base, d);
    for (const [id, atoms] of this.groupMembers) {
      const group = this.groupById.get(id);
      if (group === undefined) continue;
      const constraint =
        group.cardinality === "exactlyOne"
          ? this.exactlyOne(atoms)
          : this.atMostOne(atoms);
      d = this.bdd.and(d, constraint);
    }
    return d;
  }

  /** The name of a BDD variable, for messages. */
  atomName(variable: number): string {
    return this.names.get(variable) ?? `atom ${variable}`;
  }

  private newAtom(name: string): BddNode {
    const index = this.nextVar++;
    this.names.set(index, name);
    return this.bdd.variable(index);
  }

  /**
   * "At most one of these atoms holds", or "exactly one" with `exact`, built
   * in about 2n nodes. The obvious construction, `not (a and b)` for every
   * pair, makes n(n-1)/2 intermediate formulas and was most of the cost on
   * scripts with hundreds of random blocks.
   *
   * It works from the atom farthest from the root upward. `none` is "every
   * atom so far is false" and `one` is "at most (or exactly) one so far is
   * true". Putting a new atom on top gives `one' = a ? none : one` (if it is
   * true the rest must be false) and `none' = a ? false : none`. Sorting by
   * the BDD's own variable index makes each new atom sit above everything
   * built, which is what lets `ite` take it as a test.
   */
  private oneOf(atoms: readonly BddNode[], exact: boolean): BddNode {
    const sorted = [...atoms].sort(
      (x, y) => this.bdd.variableOf(y)! - this.bdd.variableOf(x)!,
    );
    let none: BddNode = this.bdd.TRUE;
    let one: BddNode = exact ? this.bdd.FALSE : this.bdd.TRUE;
    for (const atom of sorted) {
      one = this.bdd.ite(atom, none, one);
      none = this.bdd.ite(atom, this.bdd.FALSE, none);
    }
    return one;
  }

  private atMostOne(atoms: readonly BddNode[]): BddNode {
    return this.oneOf(atoms, false);
  }

  private exactlyOne(atoms: readonly BddNode[]): BddNode {
    return this.oneOf(atoms, true);
  }
}
