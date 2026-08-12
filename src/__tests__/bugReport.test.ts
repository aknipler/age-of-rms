import { describe, it, expect } from "vitest";
import { buildBugReportUrl, buildEnvironmentBlock, type BugReportFacts } from "../bugReport";

const BASE: BugReportFacts = {
  appVersion: "0.1.0",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) WebView2/120.0.0.0",
  diagnostics: { errors: 2, warnings: 5, infos: 1 },
  hasFileOpen: true,
};

describe("buildEnvironmentBlock", () => {
  it("names the app version, the system and the diagnostic counts", () => {
    const block = buildEnvironmentBlock(BASE);
    expect(block).toContain("Age of RMS: 0.1.0");
    expect(block).toContain("Windows NT 10.0");
    expect(block).toContain("2 errors, 5 warnings, 1 info");
    expect(block).toContain("File open: yes");
  });

  it("distinguishes no parse from a clean parse", () => {
    expect(buildEnvironmentBlock({ ...BASE, diagnostics: null })).toContain("none (no parse yet)");
    expect(
      buildEnvironmentBlock({ ...BASE, diagnostics: { errors: 0, warnings: 0, infos: 0 } }),
    ).toContain("0 errors, 0 warnings, 0 info");
  });

  it("clamps a pathologically long user agent", () => {
    const block = buildEnvironmentBlock({ ...BASE, userAgent: "x".repeat(5000) });
    expect(block.length).toBeLessThan(500);
  });
});

describe("buildBugReportUrl", () => {
  it("points at the repo's new-issue form with the bug template", () => {
    const url = new URL(buildBugReportUrl(BASE));
    expect(url.origin + url.pathname).toBe("https://github.com/aknipler/age-of-rms/issues/new");
    expect(url.searchParams.get("template")).toBe("bug_report.yml");
    expect(url.searchParams.get("labels")).toBe("bug");
  });

  it("puts the environment block in the field the issue form declares", () => {
    const url = new URL(buildBugReportUrl(BASE));
    // Round-tripping through URLSearchParams is the actual claim: the newlines
    // in the block have to survive encoding or the form arrives as one line.
    expect(url.searchParams.get("environment")).toBe(buildEnvironmentBlock(BASE));
    expect(url.searchParams.get("environment")).toContain("\n");
  });

  it("never carries the user's script", () => {
    // The guard is that there is no parameter for it at all. Written as a
    // whitelist rather than "does not contain the source", because the latter
    // passes for any script that happens not to appear in a short URL.
    const url = new URL(buildBugReportUrl(BASE));
    expect([...url.searchParams.keys()].sort()).toEqual(["environment", "labels", "template"]);
  });

  it("stays well inside GitHub's URL ceiling on realistic input", () => {
    const url = buildBugReportUrl({ ...BASE, userAgent: "x".repeat(5000) });
    expect(url.length).toBeLessThan(2000);
  });
});
