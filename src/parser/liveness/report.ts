// Turns the liveness analysis into diagnostics (docs/name-liveness-design.md
// Sec.6, slice B). PURE: no React, Monaco or Tauri.
//
// The analysis keeps verdicts and not diagrams (analyse.ts), because a BDD node
// means nothing without the Bdd that made it. A message needs the diagram: it
// prints a name's condition, and it asks which of three things killed a dead
// branch. So this module asks the analysis for its detail, builds every
// message while the diagram is alive, and returns plain data.

import {
  branchNeverRuns,
  branchTurnedOffBySwitch,
  nameMaybeUndefinedAtUse,
  nameNeverDefinedAtUse,
  type DefinitionSite,
} from "../diagnostics";
import { lineNumberOfOffset } from "../lineIndex";
import type { Diagnostic, Span } from "../types";
import {
  analyseDetailed,
  type LivenessDetail,
  type LivenessOptions,
  type LivenessResult,
} from "./analyse";
import { describeCondition } from "./describe";
import type { LivenessInput } from "./walk";

export interface LivenessReportInput extends Omit<LivenessInput, "freeNames"> {
  /**
   * The diagnostics the parse and validate already made. A use whose token
   * already carries RMS0202 (never defined) or RMS0303 (defined only below)
   * gets no mark of ours, since those say the more useful thing.
   */
  existing: readonly Diagnostic[];
}

export interface LivenessReport {
  status: LivenessResult["status"];
  diagnostics: Diagnostic[];
}

/** The codes whose token a use mark keeps clear of. */
const SHADOWING_CODES = new Set(["RMS0202", "RMS0303"]);

const overlaps = (a: Span, b: Span): boolean =>
  a.start < b.end && b.start < a.end;

export function livenessDiagnostics(
  input: LivenessReportInput,
  options: LivenessOptions = {},
): LivenessReport {
  const { result, detail } = analyseDetailed(input, options);
  // `overflow` and `incomplete` say nothing about any name, only their status.
  if (result.status !== "complete" || detail === undefined)
    return { status: result.status, diagnostics: [] };
  return {
    status: result.status,
    diagnostics: [
      ...diagnosticsForUses(input, detail),
      ...diagnosticsForBranches(input, detail),
    ],
  };
}

function diagnosticsForUses(
  input: LivenessReportInput,
  detail: LivenessDetail,
): Diagnostic[] {
  const { parse, existing } = input;
  const { bdd, atoms } = detail;
  const shadowing = existing.filter((d) => SHADOWING_CODES.has(d.code));
  const out: Diagnostic[] = [];
  for (const { use, verdict } of detail.uses) {
    if (verdict === "live") continue;
    // B4. A mark needs a definition the walk recorded above the use. A name
    // with none is RMS0303's (defined only below) or RMS0202's (never defined).
    if (
      use.definitionTokens.length === 0 &&
      use.includeDefinitions.length === 0
    )
      continue;
    const token = parse.tokens[use.token];
    const span: Span = { start: token.start, end: token.end };
    if (shadowing.some((d) => overlaps(d.span, span))) continue;

    const definitions: DefinitionSite[] = use.definitionTokens.map((i) => ({
      span: { start: parse.tokens[i].start, end: parse.tokens[i].end },
      line: lineNumberOfOffset(parse.lineOffsets, parse.tokens[i].start),
    }));
    const condition = describeCondition(bdd, use.def, (v) => atoms.atomName(v));
    const make =
      verdict === "dead" ? nameNeverDefinedAtUse : nameMaybeUndefinedAtUse;
    out.push(
      make(span, use.name, condition, definitions, use.includeDefinitions),
    );
  }
  return out;
}

function diagnosticsForBranches(
  input: LivenessReportInput,
  detail: LivenessDetail,
): Diagnostic[] {
  const { parse } = input;
  const { bdd, atoms, domain, walk } = detail;
  const name = (v: number) => atoms.atomName(v);
  const out: Diagnostic[] = [];

  for (const { branch: b, kind } of detail.deadBranches) {
    const keyword = parse.tokens[b.keywordToken];
    const end =
      b.conditionToken === undefined
        ? keyword.end
        : parse.tokens[b.conditionToken].end;
    const span: Span = { start: keyword.start, end };

    if (kind === "switch") {
      // The flag that turned the branch off is one of the words this branch's
      // chain, or a chain around it, tests, and the script defines it with
      // nothing around the definition. One defined further down could not
      // have run before the branch, so only definitions above count.
      const flag = b.conditionNames.find((n) => {
        const at = walk.switchTokens.get(n);
        return at !== undefined && at < b.keywordToken;
      });
      const at = flag === undefined ? undefined : walk.switchTokens.get(flag);
      out.push(
        branchTurnedOffBySwitch(
          span,
          flag === undefined || at === undefined
            ? undefined
            : {
                name: flag,
                line: lineNumberOfOffset(
                  parse.lineOffsets,
                  parse.tokens[at].start,
                ),
                span: {
                  start: parse.tokens[at].start,
                  end: parse.tokens[at].end,
                },
              },
        ),
      );
      continue;
    }

    // B7, in order. Which of three things made the branch impossible?
    const conditionText =
      b.conditionToken === undefined
        ? undefined
        : parse.tokens[b.conditionToken].text;
    if (
      conditionText !== undefined &&
      b.conditionDef !== undefined &&
      bdd.isFalse(bdd.and(b.conditionDef, domain))
    ) {
      out.push(branchNeverRuns(span, `${conditionText} is never defined here`));
    } else if (bdd.isFalse(bdd.and(b.local, domain))) {
      out.push(
        branchNeverRuns(
          span,
          "the branches above it in this chain already cover every case",
        ),
      );
    } else {
      const local = describeCondition(bdd, b.local, name);
      out.push(
        b.enclosingGuard === bdd.TRUE
          ? branchNeverRuns(
              span,
              `no lobby setting or dice roll satisfies ${local}`,
            )
          : branchNeverRuns(
              span,
              `it needs ${local} inside a branch that needs ${describeCondition(bdd, b.enclosingGuard, name)}`,
            ),
      );
    }
  }
  return out;
}
