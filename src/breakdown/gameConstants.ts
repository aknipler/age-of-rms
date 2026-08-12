// Narrow typed view of reference/data/game-constants.json for the
// sidepanel reference table (Sec.3.8) and, later, the terrain/object
// constant comboboxes (Sec.3.4, not built in 3.2 since value editors are
// read-only here). Same double-cast reasoning as parserWorker.ts.
export interface GameConstantEntry {
  constId: number | null;
  /**
   * Null for a row the engine reaches only by bare id — 53 of the 131 terrains
   * and 32 of the 56 object classes. This was declared `string` until
   * 2026-08-11, which made every `?? ""` guard against it look like dead code
   * to the compiler while being live at runtime. It is the narrowest slice of
   * CLAUDE.md's tracked "four hand-written views declare rmsConstant: string"
   * debt; the other three views are untouched and still wrong.
   */
  rmsConstant: string | null;
  descriptiveName: string;
  category: string;
  // Optional as of CREATION_PLAN 4.10. It was required-and-nullable while every
  // object row was hand-written and carried an explicit null; the 2639 roster
  // rows omit it, because it is a terrain field and 2639 nulls is 56 KB spent
  // restating that objects have no texture.
  deTextureFile?: string | null;
  // Object rows only, and optional for that reason — the terrain rows that
  // make up most of this file carry neither. Optional here is a claim about
  // the DATA (a terrain has no habitat) rather than about confidence, which
  // is what keeps `deTextureFile: string | null` above a different shape: a
  // terrain always has the field and it is sometimes null.
  habitat?: "land" | "water" | "amphibious" | "shore" | "any";
  // Object rows only, present only when true: something else in the gaia roster
  // dies or bleeds into this unit, so it is a carcass or a blood decal rather
  // than something an author places. The reference table hides these by
  // default. Absent means "not one" — the field is a positive marker, never a
  // three-state, which is why the consumer tests `!c.isCorpse` and not `=== false`.
  isCorpse?: boolean;
  resourceAmounts?: Record<string, number>;
  verified: boolean;
  notes?: string;
}

export interface GameConstantsData {
  constants: GameConstantEntry[];
}
