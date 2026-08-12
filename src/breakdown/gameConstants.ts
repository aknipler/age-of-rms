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
  deTextureFile: string | null;
  // Object rows only, and optional for that reason — the terrain rows that
  // make up most of this file carry neither. Optional here is a claim about
  // the DATA (a terrain has no habitat) rather than about confidence, which
  // is what keeps `deTextureFile: string | null` above a different shape: a
  // terrain always has the field and it is sometimes null.
  habitat?: "land" | "water" | "amphibious" | "shore" | "any";
  resourceAmounts?: Record<string, number>;
  verified: boolean;
  notes?: string;
}

export interface GameConstantsData {
  constants: GameConstantEntry[];
}
