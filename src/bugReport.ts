/**
 * Builds the "Report a Bug" link.
 *
 * Pure on purpose, and it takes every fact as an argument rather than reading
 * any of them itself. The version lives in a build-time global, the user agent
 * lives on `navigator`, and neither exists under plain-Node Vitest — a module
 * that reached for them directly could only be tested by faking two globals.
 * Passing them in costs one line at the call site and makes every branch here
 * testable, which is the same trade `src/parser/**` makes for the worker.
 */

const ISSUE_URL = "https://github.com/aknipler/age-of-rms/issues/new";

/**
 * GitHub rejects issue URLs past roughly 8 KB, and silently drops the whole
 * prefill rather than truncating it, so the failure looks like "the button
 * opened an empty form". The environment block is small and bounded by
 * construction, but the user agent is attacker-of-last-resort long on some
 * webviews, so it gets clamped before it can matter.
 */
const MAX_USER_AGENT = 300;

export interface BugReportFacts {
  /** From `__APP_VERSION__`, itself from package.json. */
  appVersion: string;
  /** `navigator.userAgent`. The webview's, so it names the OS and the arch. */
  userAgent: string;
  /** Diagnostic counts from the live parse, or null when no file is open. */
  diagnostics: { errors: number; warnings: number; infos: number } | null;
  /** Whether a file is open at all. The script itself is deliberately NOT sent. */
  hasFileOpen: boolean;
}

/**
 * The environment block, as Markdown, for the issue form's `environment` field.
 *
 * Exported separately from the URL so a future "copy diagnostics" button can
 * reuse it, and so the test can read it without parsing a query string.
 */
export function buildEnvironmentBlock(facts: BugReportFacts): string {
  const lines = [
    `Age of RMS: ${facts.appVersion}`,
    `System: ${facts.userAgent.slice(0, MAX_USER_AGENT)}`,
    `File open: ${facts.hasFileOpen ? "yes" : "no"}`,
  ];

  // Absent and zero are different answers and the distinction is the useful
  // one. "no file open" explains a missing count; "0 errors, 0 warnings" says
  // the parser looked and found nothing, which is evidence when someone
  // reports that the preview is empty.
  if (facts.diagnostics === null) {
    lines.push("Diagnostics: none (no parse yet)");
  } else {
    const { errors, warnings, infos } = facts.diagnostics;
    lines.push(`Diagnostics: ${errors} errors, ${warnings} warnings, ${infos} info`);
  }

  return lines.join("\n");
}

/**
 * The prefilled issue URL.
 *
 * Query parameter names are the `id`s of the fields in
 * `.github/ISSUE_TEMPLATE/bug_report.yml`. That coupling is real and silent:
 * renaming a field id there leaves this building a URL whose parameter GitHub
 * ignores, and the form simply opens with that box empty. If you rename one,
 * rename it here.
 *
 * The user's script is never included. It is their unpublished map, it can be
 * thousands of lines, and attaching it automatically would mean the button
 * publishes their work to a public tracker without ever saying so. The form
 * asks for it instead.
 */
export function buildBugReportUrl(facts: BugReportFacts): string {
  const params = new URLSearchParams({
    template: "bug_report.yml",
    labels: "bug",
    environment: buildEnvironmentBlock(facts),
  });

  return `${ISSUE_URL}?${params.toString()}`;
}
