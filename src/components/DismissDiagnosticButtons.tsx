import { HelpTip } from "./HelpTip";
import {
  useCurrentFilePath,
  useDiagnosticDismissal,
} from "../settings/DiagnosticDismissalContext";
import styles from "./DiagnosticTooltip.module.css";

/**
 * "Ok" and "Don't show me this again", under a warning the user may hide
 * (`dismissible` in diagnostics.ts). "Ok" hides it in this file, and the other
 * turns it off everywhere until the Diagnostics tab in Settings turns it back
 * on. Breakdown's popup renders these as React buttons. The Code tab's hover
 * offers the same two as links (src/editor/diagnosticActions.ts), since a
 * Monaco hover holds markdown rather than components.
 */
export function DismissDiagnosticButtons({ code }: { code: string }) {
  const { hideForFile, turnOff } = useDiagnosticDismissal();
  const filePath = useCurrentFilePath();
  return (
    <div className={styles.actions}>
      <HelpTip id="diagnostics.dismiss.ok">
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => hideForFile(code, filePath)}
        >
          Ok
        </button>
      </HelpTip>
      <HelpTip id="diagnostics.dismiss.never">
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => turnOff(code)}
        >
          Don&apos;t show me this again
        </button>
      </HelpTip>
    </div>
  );
}
