import { describe, expect, it } from "vitest";
import { parseRms } from "../../../parser/parser";
import { loadLanguage } from "../../../parser/__tests__/testUtils";
import {
  TOOLS_API_VERSION,
  type ToolContext,
  type ToolMessage,
} from "../../../../tools-api/index";
import { validateManifest } from "../../protocol";
import {
  auditConstants,
  buildConstantsAuditOutput,
  constantsAuditor,
  findUndefinedReferences,
} from "../constantsAuditor";
import type { ParseResult } from "../../../parser/types";

const lang = loadLanguage();

function parse(source: string): ParseResult {
  return parseRms(source, lang);
}

describe("constantsAuditor manifest", () => {
  it("registers cleanly", () => {
    expect(validateManifest(constantsAuditor.manifest)).toEqual([]);
  });
});

describe("auditConstants", () => {
  it("counts a used constant as used, not unused", () => {
    const p = parse(`
#const CLUMP 15
<LAND_GENERATION>
  create_land { clumping_factor CLUMP }
`);
    const [entry] = auditConstants(p);
    expect(entry.name).toBe("CLUMP");
    expect(entry.kind).toBe("const");
    expect(entry.useSpans).toHaveLength(1);
    expect(entry.definitions).toHaveLength(1);
  });

  it("flags a constant that is defined and never referenced again", () => {
    const p = parse(`#const UNUSED 1\n`);
    const [entry] = auditConstants(p);
    expect(entry.useSpans).toHaveLength(0);
  });

  it("does not count a #undefine target as a use", () => {
    const p = parse(`
#const FLAG 1
#undefine FLAG
`);
    const [entry] = auditConstants(p);
    expect(entry.useSpans).toHaveLength(0);
    expect(entry.undefineAttemptSpans).toHaveLength(1);
  });

  it("does not flag redefinition across mutually exclusive if/elseif/else branches", () => {
    const p = parse(`
if HUGE_MAP
#const SIZE 200
elseif TINY_MAP
#const SIZE 100
else
#const SIZE 150
endif
<LAND_GENERATION>
  create_land { number_of_tiles SIZE }
`);
    const [entry] = auditConstants(p);
    expect(entry.name).toBe("SIZE");
    expect(entry.definitions).toHaveLength(3);
    expect(entry.definitions.every((d) => d.conditionalDepth > 0)).toBe(true);
  });

  it("counts a value that references another constant as a use of that constant", () => {
    const p = parse(`
#const BASE 10
#const DOUBLE BASE
`);
    const byName = new Map(auditConstants(p).map((c) => [c.name, c]));
    expect(byName.get("BASE")!.useSpans).toHaveLength(1);
  });
});

describe("findUndefinedReferences", () => {
  it("groups RMS0202 diagnostics by the name at fault", () => {
    const p = parse(`
<LAND_GENERATION>
  create_land { clumping_factor NEVER_DEFINED }
  create_land { clumping_factor NEVER_DEFINED }
`);
    const refs = findUndefinedReferences(p);
    expect(refs).toHaveLength(1);
    expect(refs[0].name).toBe("NEVER_DEFINED");
    expect(refs[0].spans).toHaveLength(2);
  });
});

describe("buildConstantsAuditOutput", () => {
  it("says so when the script defines nothing", () => {
    const blocks = buildConstantsAuditOutput(
      parse(`<LAND_GENERATION>\n`),
      true,
    );
    expect(blocks.some((b) => b.kind === "text")).toBe(true);
  });

  it("prints the hidden count even when nothing is hidden", () => {
    const p = parse(`#const UNUSED 1\n`);
    const blocks = buildConstantsAuditOutput(p, true);
    const text = blocks.find((b) => b.kind === "text");
    expect(text && "text" in text ? text.text : "").toMatch(/0 of 1 constant/);
  });

  it("hides a fully healthy constant under hideHealthy and reports the count", () => {
    const p = parse(`
#const CLUMP 15
<LAND_GENERATION>
  create_land { clumping_factor CLUMP }
`);
    const blocks = buildConstantsAuditOutput(p, true);
    expect(blocks.some((b) => b.kind === "table")).toBe(false);
    const text = blocks.find((b) => b.kind === "text");
    expect(text && "text" in text ? text.text : "").toMatch(/1 of 1 constant/);
  });
});

describe("constantsAuditor.run", () => {
  it("emits progress then a result", async () => {
    const p = parse(`#const UNUSED 1\n`);
    const ctx: ToolContext<ParseResult> = {
      apiVersion: TOOLS_API_VERSION,
      parseResult: p,
      params: {},
    };
    const messages = await new Promise<ToolMessage[]>((resolve) => {
      const out: ToolMessage[] = [];
      constantsAuditor.run(ctx, (msg) => {
        out.push(msg);
        if (msg.type === "result" || msg.type === "error") resolve(out);
      });
    });
    expect(messages.map((m) => m.type)).toEqual(["progress", "result"]);
  });
});
