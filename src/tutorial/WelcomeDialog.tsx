import { useEffect, useState } from "react";
import { HelpTip } from "../components/HelpTip";
import { useTutorial } from "./TutorialContext";
import { getTutorial, TUTORIALS } from "./registry";
import { WELCOME_SKIP_PHRASES } from "./welcomePhrases";
import type { TutorialDefinition } from "./types";
import dialogStyles from "../components/dialog.module.css";
import styles from "./WelcomeDialog.module.css";

function pickSkipPhrase(): string {
  return WELCOME_SKIP_PHRASES[Math.floor(Math.random() * WELCOME_SKIP_PHRASES.length)];
}

interface WelcomeDialogProps {
  /** Testability seam, defaults to the real registry (Sec.7.2). */
  tutorials?: readonly TutorialDefinition[];
}

// tutorial-design.md Sec.7, the first-run pane. Modal (unlike the tutorial
// overlay itself): there is no "correct thing to click" behind it, so
// swallowing clicks costs nothing. Reuses dialog.module.css the same way
// GenerationSettingsDialog does.
export function WelcomeDialog({ tutorials = TUTORIALS }: WelcomeDialogProps) {
  const { dismissWelcome, start } = useTutorial();
  // Picked once per mount, not on every render. A re-render must not
  // reshuffle the button label under the user's cursor.
  const [skipPhrase] = useState(pickSkipPhrase);

  // Sec.7.4, Escape dismisses without starting either tutorial, same as
  // the overlay click.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissWelcome();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismissWelcome]);

  const rmsBasics = getTutorial("rms-basics", tutorials);
  const appTour = getTutorial("app-tour", tutorials);

  function startTutorial(id: string) {
    dismissWelcome();
    start(id);
  }

  return (
    <div className={dialogStyles.overlay} onMouseDown={dismissWelcome}>
      <div className={dialogStyles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <h2 className={dialogStyles.title}>Welcome to Age of RMS</h2>
        <p className={styles.intro}>
          A free tool for writing Age of Empires II random map scripts. Where would you like to start?
        </p>

        {rmsBasics && (
          <HelpTip id="welcome.startRms">
            <button type="button" className={styles.choice} onClick={() => startTutorial(rmsBasics.id)}>
              <span className={styles.choiceTitle}>{rmsBasics.title}</span>
              <span className={styles.choiceBlurb}>{rmsBasics.blurb}</span>
            </button>
          </HelpTip>
        )}
        {appTour && (
          <HelpTip id="welcome.startApp">
            <button type="button" className={styles.choice} onClick={() => startTutorial(appTour.id)}>
              <span className={styles.choiceTitle}>{appTour.title}</span>
              <span className={styles.choiceBlurb}>{appTour.blurb}</span>
            </button>
          </HelpTip>
        )}

        <div className={styles.skipRow}>
          <HelpTip id="welcome.skip">
            <button type="button" className={styles.skipButton} onClick={dismissWelcome}>
              {skipPhrase}
            </button>
          </HelpTip>
        </div>

        <p className={styles.footer}>You can reopen these any time from Help.</p>
      </div>
    </div>
  );
}
