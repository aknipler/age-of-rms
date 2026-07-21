// Narrow typed view of reference/data/game-constants.json for the
// sidepanel reference table (§3.8) and, later, the terrain/object
// constant comboboxes (§3.4, not built in 3.2 since value editors are
// read-only here). Same double-cast reasoning as parserWorker.ts.
export interface GameConstantEntry {
  constId: number | null;
  rmsConstant: string;
  descriptiveName: string;
  category: string;
  deTextureFile: string | null;
  verified: boolean;
  notes?: string;
}

export interface GameConstantsData {
  constants: GameConstantEntry[];
}
