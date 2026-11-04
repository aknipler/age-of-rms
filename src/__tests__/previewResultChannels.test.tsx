// The Land Placement panel's preview channel generated a second full preview
// of every edit whether or not the panel was open, which on Stranded.rms was
// 1.5 to 2.7 s of a core per edit (docs/diagnostics-latency-report.md
// Sec.10). It now generates only while a component reads it. These mock
// usePreviewResult and record the parse each provider hands it, since a null
// parse is that hook's "nothing to generate".

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParseResult } from "../parser/types";

const seen = vi.hoisted(() => ({ parses: [] as (unknown | null)[] }));

vi.mock("../usePreviewResult", () => ({
  usePreviewResult: (parseResult: unknown) => {
    seen.parses.push(parseResult);
    return { result: null, pending: false, stale: false, regenerate: () => {} };
  },
}));

vi.mock("../generationSettings/GenerationSettingsContext", () => ({
  useGenerationSettings: () => ({
    playerCount: 2,
    mapSize: "medium",
    teams: [],
    teamPositions: false,
  }),
}));

import {
  PanelPreviewResultProvider,
  PreviewResultProvider,
  usePanelPreviewResultContext,
} from "../PreviewResultContext";

const PARSE = { source: "x" } as unknown as ParseResult;

function PanelReader() {
  usePanelPreviewResultContext();
  return null;
}

const lastParse = () => seen.parses[seen.parses.length - 1];

afterEach(() => {
  cleanup();
  seen.parses.length = 0;
});

describe("preview result channels", () => {
  it("the panel channel hands no parse to the generator while nothing reads it", () => {
    render(
      <PanelPreviewResultProvider
        parseResult={PARSE}
        seed={1}
        view="current"
        cutOffset={null}
      >
        <div />
      </PanelPreviewResultProvider>,
    );
    expect(seen.parses.length).toBeGreaterThan(0);
    expect(seen.parses.every((p) => p === null)).toBe(true);
  });

  it("the panel channel generates while a reader is mounted, and stops when it unmounts", () => {
    const tree = (withReader: boolean) => (
      <PanelPreviewResultProvider
        parseResult={PARSE}
        seed={1}
        view="current"
        cutOffset={null}
      >
        {withReader ? <PanelReader /> : null}
      </PanelPreviewResultProvider>
    );
    const { rerender } = render(tree(true));
    expect(lastParse()).toBe(PARSE);

    rerender(tree(false));
    expect(lastParse()).toBeNull();
  });

  it("the document channel always generates", () => {
    render(
      <PreviewResultProvider
        parseResult={PARSE}
        seed={1}
        view="final"
        cutOffset={null}
      >
        <div />
      </PreviewResultProvider>,
    );
    expect(seen.parses.every((p) => p === PARSE)).toBe(true);
  });
});
