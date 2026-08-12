import { HelpTip } from "./HelpTip";
import type { UpdateState } from "../update/useUpdateCheck";
import styles from "./UpdatePrompt.module.css";

interface UpdatePromptProps {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
}

/**
 * A strip above the status bar offering an update that has already been found.
 *
 * A strip rather than a modal, deliberately. A modal on startup interrupts
 * someone who opened the app to do something else, and an update is never
 * urgent enough to earn that. This can sit there being ignored.
 *
 * Renders nothing in the `idle` state, which is also what a failed check
 * leaves behind, so an offline start looks exactly like an up-to-date one.
 */
export function UpdatePrompt({ state, onInstall, onDismiss }: UpdatePromptProps) {
  if (state.status === "idle") return null;

  return (
    <div className={styles.strip} role="status">
      {state.status === "available" && (
        <>
          <span className={styles.message}>
            Version {state.version} is available. You have {__APP_VERSION__}.
          </span>
          <HelpTip id="update.install">
            <button type="button" className={styles.primary} onClick={onInstall}>
              Update and restart
            </button>
          </HelpTip>
          <HelpTip id="update.dismiss">
            <button type="button" className={styles.button} onClick={onDismiss}>
              Not now
            </button>
          </HelpTip>
        </>
      )}

      {state.status === "downloading" && (
        <span className={styles.message}>Downloading the update. The app will restart itself.</span>
      )}

      {state.status === "error" && (
        <>
          <span className={styles.message}>The update could not be installed. {state.message}</span>
          <HelpTip id="update.dismiss">
            <button type="button" className={styles.button} onClick={onDismiss}>
              Dismiss
            </button>
          </HelpTip>
        </>
      )}
    </div>
  );
}
