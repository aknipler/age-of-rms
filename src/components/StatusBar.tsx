import { HelpTip } from "./HelpTip";
import type { Diagnostic } from "../parser/types";
import type { ResourceAmounts, ResourceRange } from "../parser/resourceTotals";
import {
  formatCompactRange,
  formatExactRange,
  summariseProblems,
  type ProblemLevel,
} from "./statusFormat";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  /** Live parser diagnostics from the Code tab (Phase 2.4). Empty when
   * no file is open yet, or before the first parse has come back. */
  diagnostics?: Diagnostic[];
  /** Live resource totals from the Code tab (Phase 2.5). Zeroed ranges
   * when no file is open yet, or before the first parse has come back. */
  total?: ResourceRange;
  player?: ResourceRange;
  neutral?: ResourceRange;
  onOpenGenerationSettings?: () => void;
  /** Opens a prefilled GitHub issue in the user's browser (src/bugReport.ts). */
  onReportBug?: () => void;
}

const ZERO_RANGE: ResourceRange = {
  min: { food: 0, wood: 0, gold: 0, stone: 0 },
  max: { food: 0, wood: 0, gold: 0, stone: 0 },
};

// Emoji stand in for the words "Food"/"Wood"/"Gold"/"Stone" — twelve
// figures share this row with a problem count and two buttons, and the
// labels were most of its width. The icon carries an `aria-label` with the
// real word, so the saving is visual only: a screen reader still hears
// "Food". Deliberately the everyday pictogram rather than the game's own
// resource art, since these have to render in a system font at 0.85rem.
const RESOURCES: readonly { key: keyof ResourceAmounts; name: string; icon: string }[] = [
  { key: "food", name: "Food", icon: "🍖" },
  { key: "wood", name: "Wood", icon: "🪵" },
  { key: "gold", name: "Gold", icon: "🪙" },
  { key: "stone", name: "Stone", icon: "🪨" },
];

// The colour IS the severity readout — there is no "Problems:" label any
// more — so the triangle is drawn as an SVG rather than written as the ⚠
// character. A text ⚠ renders as a colour emoji on Windows in most fonts
// and ignores `color` entirely, which would leave the one thing this
// element has to communicate untellable.
function ProblemIcon() {
  return (
    <svg className={styles.problemIcon} viewBox="0 0 16 14" aria-hidden="true" focusable="false">
      <path
        d="M8 0.8 15.4 13.2 0.6 13.2 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <rect x="7.1" y="4.4" width="1.8" height="4.8" rx="0.6" fill="#fff" />
      <rect x="7.1" y="10.2" width="1.8" height="1.8" rx="0.6" fill="#fff" />
    </svg>
  );
}

function ResourceBucket({
  helpId,
  label,
  range,
}: {
  helpId: string;
  label: string;
  range: ResourceRange;
}) {
  return (
    <span className={styles.bucket}>
      {/* HelpTip wraps the LABEL, not the whole bucket, so the two hover
          readouts can't collide: hovering the word explains what the bucket
          counts, hovering a figure gives that figure's exact value. */}
      <HelpTip id={helpId}>
        <span className={styles.bucketLabel}>{label}</span>
      </HelpTip>
      {RESOURCES.map((resource) => {
        const min = range.min[resource.key];
        const max = range.max[resource.key];
        return (
          <span
            key={resource.key}
            className={styles.resource}
            // A native `title` rather than a HelpTip: the exact figure has
            // to be reachable regardless of the help-popup setting, which a
            // user who has turned help off has not asked to lose.
            title={`${label} ${resource.name}: ${formatExactRange(min, max)}`}
          >
            <span className={styles.icon} role="img" aria-label={resource.name}>
              {resource.icon}
            </span>
            {formatCompactRange(min, max)}
          </span>
        );
      })}
    </span>
  );
}

// Resource totals (Phase 2.5): walks the AST for create_object of
// resource objects (src/parser/resourceTotals.ts), computed in the
// parser worker and lifted here from App via useRmsDiagnostics. Problems
// (Phase 2.4) is likewise real: the live count from the parser worker
// wired up in CodePane.
export function StatusBar({
  diagnostics = [],
  total = ZERO_RANGE,
  player = ZERO_RANGE,
  neutral = ZERO_RANGE,
  onOpenGenerationSettings,
  onReportBug,
}: StatusBarProps) {
  const problems = summariseProblems(diagnostics);

  return (
    <div className={styles.statusBar}>
      {/* Only the resource buckets scroll. The problem indicator and the two
          buttons live outside this element (see .pinned), so nothing the
          user needs to REACH — report a bug, open settings, see that the
          script is broken — can be pushed out of sight by a wide total. */}
      <div className={styles.scrollArea}>
        <ResourceBucket helpId="statusBar.total" label="Total" range={total} />
        <ResourceBucket helpId="statusBar.player" label="Player" range={player} />
        <ResourceBucket helpId="statusBar.neutral" label="Neutral" range={neutral} />
      </div>
      <div className={styles.pinned}>
        {/* The breakdown stays written out ("4 warnings, 2 info") rather than
            collapsing to a total. The triangle replaces the word "Problems:"
            — a label that never told the user anything the row's position
            didn't — and its colour repeats the worst severity, so the text is
            the detail and the colour is the glance. */}
        <HelpTip id="statusBar.problems">
          <span className={`${styles.problems} ${PROBLEM_LEVEL_CLASS[problems.level]}`}>
            <ProblemIcon />
            {problems.label}
          </span>
        </HelpTip>
        <HelpTip id="statusBar.reportBug">
          <button
            type="button"
            className={styles.settingsCog}
            onClick={onReportBug}
            aria-label="Report a bug"
          >
            🐞
          </button>
        </HelpTip>
        <HelpTip id="statusBar.generationSettings">
          <button
            type="button"
            className={styles.settingsCog}
            onClick={onOpenGenerationSettings}
            aria-label="Generation settings"
          >
            ⚙
          </button>
        </HelpTip>
      </div>
    </div>
  );
}

// A lookup rather than a template string (`styles[`level-${level}`]`) so
// TypeScript checks that every level has a class and that every class named
// here exists — a template index silently yields `undefined` for a typo,
// which renders as an uncoloured icon and looks like a CSS problem.
const PROBLEM_LEVEL_CLASS: Record<ProblemLevel, string> = {
  none: styles.levelNone,
  info: styles.levelInfo,
  warning: styles.levelWarning,
  error: styles.levelError,
};
