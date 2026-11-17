// The atom table and its domain constraint D (src/parser/liveness/atoms.ts).

import { describe, expect, it } from "vitest";
import { loadLanguage } from "../../__tests__/testUtils";
import { AtomTable, sizeKeys } from "../atoms";
import { Bdd } from "../bdd";

const lang = loadLanguage();
const SIZES = sizeKeys(lang.predefinedLabels ?? []);

function setup() {
  const bdd = new Bdd();
  const atoms = new AtomTable(
    bdd,
    lang.predefinedLabels ?? [],
    lang.labelGroups ?? [],
    SIZES,
  );
  return { bdd, atoms };
}

describe("AtomTable labels", () => {
  it("gives the legacy and modern name of one size the same node", () => {
    const { atoms } = setup();
    expect(atoms.label("TINY_MAP")).toBe(atoms.label("MAPSIZE_TINY"));
  });

  it("cannot hold two different sizes at once", () => {
    const { bdd, atoms } = setup();
    const both = bdd.and(atoms.label("TINY_MAP"), atoms.label("SMALL_MAP"));
    expect(bdd.isFalse(bdd.and(atoms.domain(), both))).toBe(true);
  });

  it("holds a player count only for one count", () => {
    const { bdd, atoms } = setup();
    const both = bdd.and(
      atoms.label("2_PLAYER_GAME"),
      atoms.label("3_PLAYER_GAME"),
    );
    expect(bdd.isFalse(bdd.and(atoms.domain(), both))).toBe(true);
  });

  it("gives an unknown name one stable free atom", () => {
    const { bdd, atoms } = setup();
    const a = atoms.free("NOT_A_REAL_LABEL");
    expect(atoms.label("NOT_A_REAL_LABEL")).toBe(a);
    expect(bdd.isFalse(bdd.and(atoms.domain(), a))).toBe(false);
  });

  it("allows no gameMode label, or one, but not two", () => {
    const { bdd, atoms } = setup();
    const a = atoms.label("DEATH_MATCH");
    const b = atoms.label("REGICIDE");
    const d = atoms.domain();
    expect(bdd.isFalse(bdd.and(d, bdd.and(a, b)))).toBe(true);
    expect(bdd.isFalse(bdd.and(d, bdd.and(bdd.not(a), bdd.not(b))))).toBe(
      false,
    );
    expect(bdd.isFalse(bdd.and(d, a))).toBe(false);
  });
});

describe("AtomTable names", () => {
  const nameOf = (bdd: Bdd, atoms: AtomTable, node: ReturnType<Bdd["not"]>) =>
    atoms.atomName(bdd.variableOf(node)!);

  it("names a size after the first label of it the script reads (B5)", () => {
    const { bdd, atoms } = setup();
    atoms.noteRead("TINY_MAP");
    atoms.noteRead("MAPSIZE_TINY");
    const node = atoms.label("MAPSIZE_TINY");
    expect(nameOf(bdd, atoms, node)).toBe("TINY_MAP");
  });

  it("names a size after its modern label when the script reads none", () => {
    const { bdd, atoms } = setup();
    expect(nameOf(bdd, atoms, atoms.label("TINY_MAP"))).toBe("TINY_MAP");
    const other = setup();
    expect(
      other.atoms.atomName(
        other.bdd.variableOf(other.atoms.label("MAPSIZE_SMALL"))!,
      ),
    ).toBe("MAPSIZE_SMALL");
  });

  it("names a player atom N_PLAYER_GAME and an arm after its start_random line", () => {
    const { bdd, atoms } = setup();
    expect(nameOf(bdd, atoms, atoms.label("4_PLAYER_GAME"))).toBe(
      "4_PLAYER_GAME",
    );
    const id = atoms.openBlock(12);
    atoms.arm(id, 50);
    const second = atoms.arm(id, 50);
    expect(nameOf(bdd, atoms, second)).toBe(
      "arm 2 of the start_random on line 12",
    );
  });
});

describe("AtomTable random blocks", () => {
  /** Opens a block, adds one arm per chance, closes it, and returns the arm nodes. */
  function block(atoms: AtomTable, chances: (number | undefined)[]) {
    const id = atoms.openBlock(1);
    const arms = chances.map((c) => atoms.arm(id, c));
    atoms.closeBlock(id);
    return arms;
  }

  it("covers every roll with two arms at 50 and 50", () => {
    const { bdd, atoms } = setup();
    const [a, b] = block(atoms, [50, 50]);
    expect(bdd.implies(atoms.domain(), bdd.or(a, b))).toBe(true);
  });

  it("does not cover every roll with two arms at 25 and 25", () => {
    const { bdd, atoms } = setup();
    const [a, b] = block(atoms, [25, 25]);
    expect(bdd.implies(atoms.domain(), bdd.or(a, b))).toBe(false);
  });

  it("makes a first arm at 0 possible and a second arm at 0 impossible", () => {
    const { bdd, atoms } = setup();
    const [first, second] = block(atoms, [0, 0]);
    expect(bdd.isFalse(bdd.and(atoms.domain(), first))).toBe(false);
    expect(second).toBe(bdd.FALSE);
  });

  it("is exhaustive at 99, so an arm after 99 is impossible", () => {
    const { bdd, atoms } = setup();
    const [a, b] = block(atoms, [99, 1]);
    expect(b).toBe(bdd.FALSE);
    expect(bdd.implies(atoms.domain(), a)).toBe(true);
  });

  it("keeps an arm after 98 possible", () => {
    const { bdd, atoms } = setup();
    const [, b] = block(atoms, [98, 1]);
    expect(b).not.toBe(bdd.FALSE);
  });

  it("is not exhaustive after a chance that is not a literal", () => {
    const { bdd, atoms } = setup();
    const [a, b] = block(atoms, [50, undefined]);
    expect(b).not.toBe(bdd.FALSE);
    expect(bdd.implies(atoms.domain(), bdd.or(a, b))).toBe(false);
  });

  it("takes at most one arm", () => {
    const { bdd, atoms } = setup();
    const [a, b] = block(atoms, [50, 50]);
    expect(bdd.isFalse(bdd.and(atoms.domain(), bdd.and(a, b)))).toBe(true);
  });
});
