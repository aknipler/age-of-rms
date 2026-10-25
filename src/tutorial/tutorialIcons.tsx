// The tutorial card's small drawn icons. Inline SVG in `currentColor`, so each
// takes the colour of the text around it and follows the theme. The app has
// no icon library, and three icons do not justify adding one. Emoji would be
// the shortcut, and they are drawn differently by every font on every
// machine, which a label meant to be learnt by sight cannot have.

import { useId } from "react";
import type { StepKind } from "./types";
import styles from "./TutorialOverlay.module.css";

/** A magnifying glass for "investigate", a hammer for "build". */
export function StepKindIcon({ kind }: { kind: StepKind }) {
  return (
    <svg className={styles.kindIcon} viewBox="0 0 16 16" aria-hidden="true">
      {kind === "investigate" ? (
        <g className={styles.iconStroke}>
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10" y1="10" x2="14.5" y2="14.5" />
        </g>
      ) : (
        // An upright hammer turned 45 degrees about the icon's centre, so
        // the head points up and right and the handle runs down and left.
        <g className={styles.iconFill} transform="rotate(45 8 8)">
          <rect x="3.5" y="1.5" width="9" height="4" rx="1" />
          <rect x="7" y="5" width="2" height="10" rx="1" />
        </g>
      )}
    </svg>
  );
}

/**
 * A warning triangle, for a spoiler that is easy to skip and matters. It is
 * not decoration, so it has a name of its own for a screen reader, which
 * reads it before the spoiler's label.
 *
 * A filled triangle with the exclamation mark cut out of it, so whatever is
 * behind the icon shows through the mark. The status bar's ProblemIcon
 * paints its mark white instead, which only reads right on a white
 * background. The cut is an SVG `<mask>`: white keeps what is drawn, black
 * removes it. A mask is found by id, and every id on the page must be
 * unique, so each icon takes its own from `useId`.
 */
export function WarnIcon() {
  // useId's characters are not all safe inside `url(#...)`, so keep the
  // letters and digits only. They stay unique, since the stripped
  // characters are the same in every id.
  const maskId = `warn-mask-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      className={styles.warnIcon}
      viewBox="0 0 16 16"
      role="img"
      aria-label="Important"
    >
      <mask id={maskId}>
        {/* Stroked as well as filled, for rounded corners. */}
        <path
          d="M8 1.75 L15 14.25 H1 Z"
          fill="#fff"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <rect x="7.1" y="5.5" width="1.8" height="4.6" rx="0.6" fill="#000" />
        <circle cx="8" cy="12" r="1" fill="#000" />
      </mask>
      <rect
        className={styles.iconFill}
        width="16"
        height="16"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
