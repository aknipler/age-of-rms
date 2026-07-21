import type { DiagnosticSeverity } from "../../parser/types";
import { HelpTip } from "../../components/HelpTip";
import styles from "./cards.module.css";

const SEVERITY_LABEL: Record<DiagnosticSeverity, string> = {
  error: "error",
  warning: "warning",
  info: "info",
};

/** §3.1/§5 — badges reuse the parser's own diagnostics, mapped by span containment; Breakdown invents no validation of its own. */
export function ProblemBadge({ severity }: { severity: DiagnosticSeverity }) {
  return (
    <HelpTip id="breakdown.problemBadge">
      <span className={`${styles.problemBadge} ${styles[`severity-${severity}`]}`}>
        {SEVERITY_LABEL[severity]}
      </span>
    </HelpTip>
  );
}
