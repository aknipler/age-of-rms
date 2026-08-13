import { describe, expect, it } from "vitest";
import {
  formatCompact,
  formatCompactRange,
  formatExact,
  formatExactRange,
  summariseProblems,
} from "../statusFormat";
import type { Diagnostic } from "../../parser/types";

function diag(severity: Diagnostic["severity"]): Diagnostic {
  return { severity, code: "RMS0000", message: "test", span: { start: 0, end: 1 } };
}

describe("formatCompact", () => {
  it("prints whole numbers below 1000 as-is", () => {
    expect(formatCompact(0)).toBe("0");
    expect(formatCompact(7)).toBe("7");
    expect(formatCompact(999)).toBe("999");
  });

  it("rounds a fractional figure before printing it", () => {
    expect(formatCompact(6.4)).toBe("6");
    expect(formatCompact(6.6)).toBe("7");
  });

  it("takes one decimal place below 100 of a scale", () => {
    expect(formatCompact(1800)).toBe("1.8k");
    expect(formatCompact(99_900)).toBe("99.9k");
    expect(formatCompact(42_400_000)).toBe("42.4m");
  });

  it("drops the decimal place at or above 100 of a scale", () => {
    expect(formatCompact(100_000)).toBe("100k");
    expect(formatCompact(608_400)).toBe("608k");
    expect(formatCompact(425_000_000)).toBe("425m");
  });

  it("strips a trailing .0 rather than printing a decimal that says nothing", () => {
    expect(formatCompact(60_000)).toBe("60k");
    expect(formatCompact(2_000_000)).toBe("2m");
  });

  it("switches to m and b as the magnitude grows", () => {
    expect(formatCompact(999_000)).toBe("999k");
    expect(formatCompact(1_000_000)).toBe("1m");
    expect(formatCompact(1_500_000_000)).toBe("1.5b");
  });

  // The regression this whole module was written for: the old rule applied
  // one decimal at every magnitude, so a two-million total printed as a
  // six-digit "2008.6k" — long AND at a scale nobody reads at a glance.
  it("prints a multi-million total in millions, not in four-digit thousands", () => {
    expect(formatCompact(2_008_600)).toBe("2m");
  });

  // Rounding at the top of a scale must promote rather than print "1000k".
  it("promotes to the next scale when rounding fills the current one", () => {
    expect(formatCompact(999_600)).toBe("1m");
    expect(formatCompact(999_600_000)).toBe("1b");
  });

  it("keeps the sign on a negative figure", () => {
    expect(formatCompact(-1800)).toBe("-1.8k");
    expect(formatCompact(-608_400)).toBe("-608k");
  });
});

describe("formatExact", () => {
  it("groups thousands with commas", () => {
    expect(formatExact(42_365_273)).toBe("42,365,273");
    expect(formatExact(999)).toBe("999");
    expect(formatExact(1000)).toBe("1,000");
  });

  it("rounds rather than printing a fraction", () => {
    expect(formatExact(1234.6)).toBe("1,235");
  });
});

describe("ranges", () => {
  it("collapses to one figure when the bounds agree", () => {
    expect(formatCompactRange(1800, 1800)).toBe("1.8k");
    expect(formatExactRange(1800, 1800)).toBe("1,800");
  });

  it("spans both bounds when they differ", () => {
    expect(formatCompactRange(10_000, 15_000)).toBe("10k-15k");
    expect(formatExactRange(10_000, 15_000)).toBe("10,000 to 15,000");
  });
});

describe("summariseProblems", () => {
  it("reports level none on an empty list", () => {
    const summary = summariseProblems([]);
    expect(summary.level).toBe("none");
    expect(summary.label).toBe("No problems");
  });

  it("reports the WORST severity present, not the most common", () => {
    expect(summariseProblems([diag("info"), diag("info")]).level).toBe("info");
    expect(summariseProblems([diag("info"), diag("warning")]).level).toBe("warning");
    expect(summariseProblems([diag("info"), diag("warning"), diag("error")]).level).toBe("error");
    // One error under a pile of info still colours the icon red.
    expect(
      summariseProblems([diag("info"), diag("info"), diag("info"), diag("error")]).level,
    ).toBe("error");
  });

  it("counts every diagnostic, whatever its severity", () => {
    const summary = summariseProblems([diag("error"), diag("warning"), diag("info")]);
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.infos).toBe(1);
  });

  it("pluralises errors and warnings but not info", () => {
    expect(summariseProblems([diag("error")]).label).toBe("1 error");
    expect(summariseProblems([diag("error"), diag("error")]).label).toBe("2 errors");
    expect(summariseProblems([diag("warning")]).label).toBe("1 warning");
    expect(summariseProblems([diag("info"), diag("info")]).label).toBe("2 info");
  });

  it("orders the breakdown worst-first", () => {
    const summary = summariseProblems([diag("info"), diag("error"), diag("warning")]);
    expect(summary.label).toBe("1 error, 1 warning, 1 info");
  });
});
