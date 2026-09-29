import type { Diagnostic, DiagnosticSeverity } from "../../parser/types";
import {
  DiagnosticPopup,
  useDiagnosticHover,
} from "../../components/DiagnosticTooltip";
import styles from "./cards.module.css";

const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  error: "error",
  warning: "warning",
  info: "info",
};

const SEVERITY_RANK: Record<DiagnosticSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
};

function worstSeverity(diagnostics: readonly Diagnostic[]): DiagnosticSeverity {
  return diagnostics.reduce<DiagnosticSeverity>(
    (worst, d) =>
      SEVERITY_RANK[d.severity] > SEVERITY_RANK[worst] ? d.severity : worst,
    diagnostics[0].severity,
  );
}

// One diagnostic: show its own message, the same content the Code tab's
// squiggle hover gives. More than one: a per-diagnostic popup has nowhere
// good to put several unrelated messages at once, so this names how many
// and of what severity instead, and the reader finds the individual ones
// by expanding the card (CommandCard's per-arg row, RawCard's expanded
// list).
function summarize(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 1) return diagnostics[0].message;
  const bySeverity = new Map<DiagnosticSeverity, number>();
  for (const d of diagnostics) {
    bySeverity.set(d.severity, (bySeverity.get(d.severity) ?? 0) + 1);
  }
  if (bySeverity.size === 1) {
    const [severity] = bySeverity.keys();
    return `${diagnostics.length} ${SEVERITY_LABEL[severity]}s in this card.`;
  }
  const parts = (["error", "warning", "info"] as const)
    .filter((s) => bySeverity.has(s))
    .map((s) => {
      const n = bySeverity.get(s)!;
      return `${n} ${SEVERITY_LABEL[s]}${n > 1 ? "s" : ""}`;
    });
  return `${diagnostics.length} issues in this card (${parts.join(", ")}).`;
}

/** Sec.3.1/Sec.5, badges reuse the parser's own diagnostics, mapped by span containment; Breakdown invents no validation of its own. */
export function ProblemBadge({
  diagnostics,
}: {
  diagnostics: readonly Diagnostic[];
}) {
  const severity = worstSeverity(diagnostics);
  const message = summarize(diagnostics);
  // Same reasoning as ArgRow/AttributeRow's own per-diagnostic popup: the
  // actual message, always visible on hover, not gated behind the
  // Preferences help-mode toggle the way a HelpTip is (a HelpTip here used
  // to show one static ui-help.json sentence regardless of which
  // diagnostic, or how many, applied).
  const diagHover = useDiagnosticHover();

  return (
    <span className={styles.problemBadgeWrapper} {...diagHover.handlers}>
      {diagHover.hovering && (
        <DiagnosticPopup
          message={message}
          severity={severity}
          side={diagHover.side}
        />
      )}
      <span
        className={`${styles.problemBadge} ${styles[`severity-${severity}`]}`}
      >
        {SEVERITY_LABEL[severity]}
      </span>
    </span>
  );
}
