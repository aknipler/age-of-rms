// A dry-run emission of the live model, re-derived on every model/parse
// change. The vector tier's positions (overlay.ts) and the Generated code
// preview (Sec.8) both read from this, and Sec.3.4's own measurement is why
// re-running it on every edit is not a performance concern: 0.173ms for
// Bulls_Eyes' full 143-const table, 97 full re-evaluations inside one 16.7ms
// frame.
//
// `scriptSymbols` comes from `instantiateScript`, per applyEdits.ts's own
// contract note ("computed by the caller, via instantiateScript at its
// pinned seed"), kept out of emitModel.ts/applyEdits.ts so those stay pure
// and testable without a real instantiation pipeline in front of them.
// Returned alongside the emission (not just consumed internally) because
// `computeApplyEdits`, Apply's own preview, needs the SAME script symbol
// table, and it must be the document's own resolved constants, never the
// model's own emission output (`EmissionOk.resolved` answers a different
// question: what THIS model's own placements evaluate to, not what the
// document's PRE-EXISTING `#const`s are worth).

import { useMemo } from "react";
import { buildLanguageIndex, type LanguageData } from "../../../../parser/language";
import type { ParseResult } from "../../../../parser/types";
import { instantiateScript } from "../../../../preview/generator/instantiate";
import type { MapSize } from "../../../../generationSettings/generationSettingsConstants";
import { reservedNamesForApply } from "../applyEdits";
import { NameAllocator } from "../compiler/naming";
import { emitAlpModel, type EmissionResult } from "../emitModel";
import type { AlpModel } from "../fence";

export interface DryEmission {
  emission: EmissionResult;
  /** The document's own resolved `#const` table at the panel's pinned seed, Apply's own `computeApplyEdits` call needs exactly this. */
  scriptSymbols: ReadonlyMap<string, number>;
}

export function useEmission(
  parse: ParseResult | null,
  model: AlpModel | null,
  lang: LanguageData,
  playerCount: number,
  mapSize: MapSize,
  seed: number,
): DryEmission | null {
  return useMemo(() => {
    if (parse === null || model === null) return null;
    const refDb = buildLanguageIndex(lang);
    const instantiated = instantiateScript(parse, refDb, { playerCount, mapSize, teams: [] }, seed);
    const namer = new NameAllocator({ reserved: reservedNamesForApply(parse, lang) });
    const emission = emitAlpModel(model, namer, instantiated.symbols, playerCount);
    return { emission, scriptSymbols: instantiated.symbols };
  }, [parse, model, lang, playerCount, mapSize, seed]);
}
