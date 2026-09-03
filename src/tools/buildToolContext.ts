/**
 * The pure, testable half of `ToolsPane.startRun`'s context builder
 * (tools-api-design.md Sec.6, land-placement-design.md Sec.3.3).
 *
 * Extracted out of `ToolsPane.tsx` (slice-4 brief item 4): it was ~25 lines
 * of inline object-spread in a component nothing in this repo can render, and
 * it is the ONE place capability enforcement actually happens. Every field
 * below is gated on its own capability, and an undeclared capability leaves
 * the field ABSENT (never `undefined`-valued; the spread pattern below is
 * what makes that true, since `...(cond ? { key: value } : {})` adds no key
 * at all when `cond` is false. This is what a v1.1 external tool observes,
 * so the behaviour is worth pinning as a function rather than trusting it to
 * survive inline edits to a 350-line component).
 */

import {
  TOOLS_API_VERSION,
  type Capability,
  type ParamValue,
  type PublishedGameConstants,
  type ToolContext,
} from "../../tools-api/index";
import { resolveMapDim } from "../preview/generator/mapDimensions";
import type { MapSize } from "../generationSettings/generationSettingsConstants";
import type { LanguageData } from "../parser/language";
import type { ParseResult } from "../parser/types";
import { effectiveCapabilities } from "./protocol";

export interface BuildToolContextInput {
  capabilities: readonly Capability[];
  params: Record<string, ParamValue>;
  parseResult: ParseResult;
  generation: { playerCount: number; mapSize: MapSize; teams: readonly number[] };
  lang: LanguageData;
  gameConstants: PublishedGameConstants;
  /**
   * Sec.3.3, the pane's own seed and Current/Final cut, granted only under
   * `read-preview-view`. `cutOffset` is `null` when the pane's Current pin has
   * none set (Final, or no pin), the same nullability `PreviewCutValue.cutOffset`
   * itself already carries, passed straight through rather than re-derived.
   */
  previewView: { seed: number; cutOffset: number | null };
}

export function buildToolContext(input: BuildToolContextInput): ToolContext<ParseResult> {
  const granted = effectiveCapabilities(input.capabilities);
  const tiles = resolveMapDim(input.generation.mapSize, input.lang.predefinedLabels ?? []) ?? 0;

  return {
    apiVersion: TOOLS_API_VERSION,
    params: input.params,
    ...(granted.has("read-source") ? { source: input.parseResult.source } : {}),
    ...(granted.has("read-ast") ? { parseResult: input.parseResult } : {}),
    ...(granted.has("read-generation-settings")
      ? {
          settings: {
            playerCount: input.generation.playerCount,
            mapSize: { name: input.generation.mapSize, tiles },
            teams: [...input.generation.teams],
          },
        }
      : {}),
    ...(granted.has("read-reference") ? { referenceData: { language: input.lang, gameConstants: input.gameConstants } } : {}),
    ...(granted.has("read-preview-view") ? { previewView: input.previewView } : {}),
  };
}
