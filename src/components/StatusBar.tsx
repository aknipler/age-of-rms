import { HelpTip } from "./HelpTip";
import type { Diagnostic } from "../parser/types";
import type {
  ResourceAmounts,
  ResourceRange,
} from "../preview/generator/resourceSummary";
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
  /** Resource totals read off the current preview generation (resourceSummary.ts).
   * Zeroed ranges when no file is open yet, or before the first generation
   * has come back. */
  total?: ResourceRange;
  player?: ResourceRange;
  neutral?: ResourceRange;
  /** D11: a generation is in flight, so these figures describe the previous one. */
  pending?: boolean;
  /** D3: "Pinned line N" / "Current line N" when Current view is drawing less than the whole script. Absent draws nothing. */
  cutLabel?: string;
  /** Opens a prefilled GitHub issue in the user's browser (src/bugReport.ts). */
  onReportBug?: () => void;
  /** Opens a new discussion in the ideas category in the user's browser (src/bugReport.ts). */
  onSuggestFeature?: () => void;
}

const ZERO_RANGE: ResourceRange = {
  min: { food: 0, wood: 0, gold: 0, stone: 0 },
  max: { food: 0, wood: 0, gold: 0, stone: 0 },
};

// Wood/gold/stone used to be the U+1FAxx emoji (🪵🪙🪨), added to Unicode in
// 2020. Windows 10's bundled emoji font predates that block, so those three
// fall back to invisible tofu while food's much older 🍖 still renders,
// exactly the report this fixed: "only the food emoji shows". Same shape as
// ProblemIcon below, drawn as a plain SVG instead of gambling on a glyph
// being in whatever font the OS ships.
//
// Wood is drawn as a STANDING log (cut face up) rather than a log lying on
// its side, the first version's shape: at the ~11px this actually renders at,
// a horizontal log with round end-caps read as a formless brown blob. A
// vertical silhouette next to the round coin and the round rock is a shape
// distinction the eye catches before it resolves any colour, and it is the
// one feature guaranteed to survive being drawn this small. It also keeps
// wood from reading as a second, browner Meat on Bone: that glyph is a
// diagonal bone shape in pale off-white, this is a vertical two-tone
// cylinder, no orientation or colour in common.
//
// The first cut of this shape only used 6 of the viewBox's 16 units of
// width (37%), against 80%+ for the circular gold/stone icons below and for
// 🍖 itself, which fills most of its own em box. Next to those, a narrower
// drawing reads as a SMALLER icon even though every icon here shares the
// same `width`/`height` in CSS — the eye compares drawn area, not the
// invisible box around it. Widened to ~64% here without touching the
// vertical extent, rather than scaling the whole log up uniformly, which
// would have pushed the rounded base past the bottom edge and clipped it.
//
// The vertical extent moved on its own afterwards, on request: the base
// stays anchored where it was (the rounded-base curve already touched the
// viewBox's bottom edge, so there was no more room to grow downward without
// clipping it), and only the cap moved up, from cy 6.5 to 5, taking the
// drawn height from 72% of the box to 81%.
function WoodIcon() {
  return (
    <svg
      className={styles.resourceIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {/* The bark. A vertical rounded rectangle is the whole shape read at
          icon size; everything below is detail for when it renders larger. */}
      <rect x="2.9" y="5" width="10.2" height="10" rx="1.3" fill="#8b5a2b" />
      {/* The cut top face and its growth rings, the other half of the
          silhouette: a flat brown rectangle alone reads as a plank, not a log. */}
      <ellipse cx="8" cy="5" rx="5.1" ry="2" fill="#e8b975" />
      <ellipse
        cx="8"
        cy="5"
        rx="3.2"
        ry="1.25"
        fill="none"
        stroke="#a9702f"
        strokeWidth="0.6"
      />
      <ellipse cx="8" cy="5" rx="1.2" ry="0.45" fill="#a9702f" />
      {/* Bark texture and the rounded base, both subtle: real detail once
          the icon is large enough to show it, invisible noise otherwise. */}
      <path
        d="M2.9 15 Q8 16 13.1 15"
        fill="none"
        stroke="#6b431f"
        strokeWidth="0.7"
      />
      <line
        x1="5.3"
        y1="6.1"
        x2="4.9"
        y2="14.6"
        stroke="#6b431f"
        strokeWidth="0.5"
        opacity="0.8"
      />
      <line
        x1="10.7"
        y1="6.1"
        x2="11.2"
        y2="14.6"
        stroke="#6b431f"
        strokeWidth="0.5"
        opacity="0.8"
      />
    </svg>
  );
}

function GoldIcon() {
  return (
    <svg
      className={styles.resourceIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6.4"
        fill="#f4c430"
        stroke="#b8860b"
        strokeWidth="1"
      />
      <circle
        cx="8"
        cy="8"
        r="4"
        fill="none"
        stroke="#b8860b"
        strokeWidth="0.8"
      />
    </svg>
  );
}

// The rock's original points only spanned 75% of the viewBox's width and
// 69% of its height, against gold's 86%/86% (its r=6.4 circle plus half its
// own stroke), the same under-filled-box problem WoodIcon had above. Scaled
// 1.15x from the centre (8,8) here, which is the same fix in spirit as
// widening the log: more of the icon's own drawn area, not a bigger box.
function StoneIcon() {
  return (
    <svg
      className={styles.resourceIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2.25 11.45 1.1 6.85 4.55 2.25 11.45 1.675 14.9 5.7 14.325 11.45 9.15 14.325Z"
        fill="#9a9ca1"
        stroke="#6e7075"
        strokeWidth="0.65"
        strokeLinejoin="round"
      />
      <path d="M4.55 2.25 8 5.7 11.45 1.675Z" fill="#b7b9bd" opacity="0.7" />
    </svg>
  );
}

// Food was the last of the four still drawn as text, the 🍖 glyph. Its look
// depends on whichever emoji font the OS ships (a bone on Windows, a drumstick
// elsewhere), and it ignored the game's own meat art. This draws a cut of meat
// instead, after the resource icon the game shows. The silhouette is the
// point. Gold is a round coin and stone a faceted rock, so the meat is a
// rounded slab, longer than it is tall (with corners rounded part way between a
// rectangle and an oval), with a big lobe at one end and a
// smaller one at the other, tilted. Neither of them shares that profile.
// Colour comes second (a saturated red-pink no other icon here has), then the
// pale fat rim and the dark outline that keeps it from bleeding into the bar.
// The marbling is detail for larger sizes.
//
// Drawn lying flat, then tilted and centred with one `transform` on a group. The alternative
// is writing the tilted coordinates out by hand, which is harder to tweak:
// moving a lobe or the waist here is a one-number change on level ground.
function FoodIcon() {
  return (
    <svg
      className={styles.resourceIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <g transform="translate(7.56 8.55) scale(1.02) rotate(-40) translate(-8 -8)">
        {/* The meat. Fat rim and lean are two layers of one outline, so the
            rim survives as a thin pale band. Straight sides with rounded
            corners keep it rectangular, so it does not read as an oval. The
            big lobe (right, before the tilt) is the front of the cut. */}
        <path
          d="M3.6 4.9 L6.6 4.9 Q8.2 4.9 8.7 3.9 Q9.1 3.2 10 3.2 L11.8 3.2 Q14.8 3.2 14.8 6.2 L14.8 9.8 Q14.8 12.8 11.8 12.8 L10 12.8 Q9.1 12.8 8.7 12.1 Q8.2 11.1 6.6 11.1 L3.6 11.1 Q1.2 11.1 1.2 8.7 L1.2 7.3 Q1.2 4.9 3.6 4.9Z"
          fill="#f2d6cf"
          stroke="#7a2230"
          strokeWidth="0.9"
          strokeLinejoin="round"
        />
        <path
          d="M3.8 6.2 L6.5 6.2 Q8.3 6.2 9.1 5 Q9.4 4.5 10 4.5 L11.8 4.5 Q13.5 4.5 13.5 6.2 L13.5 9.8 Q13.5 11.5 11.8 11.5 L10 11.5 Q9.4 11.5 9.1 11 Q8.3 9.8 6.5 9.8 L3.8 9.8 Q2.5 9.8 2.5 8.5 L2.5 7.5 Q2.5 6.2 3.8 6.2Z"
          fill="#d9475a"
          strokeLinejoin="round"
        />
        <path
          d="M4.2 8.1 Q5.3 7.4 6.5 8.1 M10.4 6.9 Q11.8 6.2 13 7.1 M10.6 9.9 Q11.8 9.3 12.8 9.8"
          fill="none"
          stroke="#f2b8bb"
          strokeWidth="0.55"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

// Twelve figures share this row with a problem count and two buttons, and
// the labels were most of its width, hence an icon instead of the word. It
// carries an `aria-label` with the real word, so the saving is visual only:
// a screen reader still hears "Food". Deliberately the everyday pictogram
// rather than the game's own resource art, since these have to read at
// 0.85rem.
const RESOURCES: readonly {
  key: keyof ResourceAmounts;
  name: string;
  icon: React.ReactNode;
}[] = [
  { key: "food", name: "Food", icon: <FoodIcon /> },
  { key: "wood", name: "Wood", icon: <WoodIcon /> },
  { key: "gold", name: "Gold", icon: <GoldIcon /> },
  { key: "stone", name: "Stone", icon: <StoneIcon /> },
];

// The colour IS the severity readout, there is no "Problems:" label any
// more, so the triangle is drawn as an SVG rather than written as the ⚠
// character. A text ⚠ renders as a colour emoji on Windows in most fonts
// and ignores `color` entirely, which would leave the one thing this
// element has to communicate untellable.
function ProblemIcon() {
  return (
    <svg
      className={styles.problemIcon}
      viewBox="0 0 16 14"
      aria-hidden="true"
      focusable="false"
    >
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

// The two feedback buttons are drawn the same way as ProblemIcon and the
// resource icons, so they look identical on every Windows build instead of
// depending on which emoji font the OS ships. The bug is a single grey line
// drawing in `currentColor`, so it follows the light and dark themes with the
// rest of the status bar. Its body and head are two complete shapes that touch
// at one point. With no fill, any overlap would show as a line through the
// neck. It turns the theme's error colour on hover (`.bugIcon` in the module
// CSS), which works because every stroke here is `currentColor`.
function BugIcon() {
  return (
    <svg
      className={`${styles.buttonIcon} ${styles.bugIcon}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.85"
      >
        <ellipse cx="8" cy="9.7" rx="3.5" ry="4.9" />
        <circle cx="8" cy="3.2" r="1.7" />
        <path d="M4.8 7.6 1.2 5.8M4.5 9.7 0.9 9.7M4.8 11.8 1.6 14.2M11.2 7.6 14.8 5.8M11.5 9.7 15.1 9.7M11.2 11.8 14.4 14.2" />
      </g>
    </svg>
  );
}

// Two drawings of one bulb in the same box. The grey outline is what shows at
// rest, matching the bug, and the filled yellow bulb fades in on hover or
// keyboard focus (`.bulbOutline` and `.bulbColour` in the module CSS). Both
// share the glass path, so the shape does not shift when they swap.
function LightbulbIcon() {
  return (
    <svg
      className={styles.buttonIcon}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <g
        className={styles.bulbOutline}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 1C4.9 1 3 3.3 3 5.9C3 7.7 3.9 8.8 4.8 9.9C5.3 10.5 5.5 11 5.5 11.7H10.5C10.5 11 10.7 10.5 11.2 9.9C12.1 8.8 13 7.7 13 5.9C13 3.3 11.1 1 8 1Z" />
        <path d="M5.9 13.4H10.1M6.7 14.9H9.3" />
        <path
          d="M8 8.6V11.7"
          strokeWidth="0.5"
        />
      </g>
      <g className={styles.bulbColour}>
        <path
          d="M8 1C4.9 1 3 3.3 3 5.9C3 7.7 3.9 8.8 4.8 9.9C5.3 10.5 5.5 11 5.5 11.7H10.5C10.5 11 10.7 10.5 11.2 9.9C12.1 8.8 13 7.7 13 5.9C13 3.3 11.1 1 8 1Z"
          fill="#f7c948"
          stroke="#c99a1e"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <path
          d="M6.4 6.8 8 8.6 9.6 6.8M8 8.6V11.7"
          stroke="#a87a0c"
          strokeWidth="0.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect
          x="5.6"
          y="12.5"
          width="4.8"
          height="1.1"
          rx="0.5"
          fill="currentColor"
        />
        <rect
          x="6.4"
          y="14.1"
          width="3.2"
          height="1"
          rx="0.5"
          fill="currentColor"
        />
      </g>
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

// Resource totals (status-bar accuracy pass): read off the actual preview
// generation currently showing (src/preview/generator/resourceSummary.ts),
// not a static AST walk — see that module's own header for why. Lifted here
// from App via StatusBarContainer, which reads PreviewResultContext.
// Problems (Phase 2.4) is likewise real: the live count from the parser
// worker wired up in CodePane.
export function StatusBar({
  diagnostics = [],
  total = ZERO_RANGE,
  player = ZERO_RANGE,
  neutral = ZERO_RANGE,
  pending = false,
  cutLabel,
  onReportBug,
  onSuggestFeature,
}: StatusBarProps) {
  const problems = summariseProblems(diagnostics);

  return (
    <div className={styles.statusBar}>
      {/* Only the resource buckets scroll. The problem indicator and the bug
          report button live outside this element (see .pinned), so nothing
          the user needs to REACH, report a bug, see that the script is
          broken, can be pushed out of sight by a wide total. Generation
          settings used to have its own cog here too; it moved to the preview
          pane (beta feedback said the cog was hard to find, and that's the
          pane whose Current/Final toggle these settings actually feed), and
          this is its only entry point now. Dimmed while a generation is in
          flight (D11) — not colour-only, aria-busy says the same thing to a
          screen reader. */}
      <div
        className={`${styles.scrollArea} ${pending ? styles.pending : ""}`}
        data-tutorial-anchor="statusBar.resources"
        aria-busy={pending}
      >
        {cutLabel && (
          <HelpTip id="statusBar.cut">
            <span className={styles.cutLabel}>({cutLabel})</span>
          </HelpTip>
        )}
        <ResourceBucket helpId="statusBar.total" label="Total" range={total} />
        <ResourceBucket
          helpId="statusBar.player"
          label="Player"
          range={player}
        />
        <ResourceBucket
          helpId="statusBar.neutral"
          label="Neutral"
          range={neutral}
        />
      </div>
      <div className={styles.pinned}>
        {/* The breakdown stays written out ("4 warnings, 2 info") rather than
            collapsing to a total. The triangle replaces the word "Problems:",
            a label that never told the user anything the row's position
            didn't, and its colour repeats the worst severity, so the text is
            the detail and the colour is the glance. */}
        <HelpTip id="statusBar.problems">
          <span
            className={`${styles.problems} ${PROBLEM_LEVEL_CLASS[problems.level]}`}
          >
            <ProblemIcon />
            {problems.label}
          </span>
        </HelpTip>
        {/* The two feedback buttons sit in their own row so the spacing
            between them is set here and not by `.pinned`'s gap, which would
            also space them from the problem count. */}
        <div className={styles.feedbackButtons}>
          <HelpTip id="statusBar.reportBug">
            <button
              type="button"
              className={styles.settingsCog}
              onClick={onReportBug}
              aria-label="Report a bug"
            >
              <BugIcon />
            </button>
          </HelpTip>
          <HelpTip id="statusBar.suggestFeature">
            <button
              type="button"
              className={styles.settingsCog}
              onClick={onSuggestFeature}
              aria-label="Suggest a feature"
            >
              <LightbulbIcon />
            </button>
          </HelpTip>
        </div>
      </div>
    </div>
  );
}

// A lookup rather than a template string (`styles[`level-${level}`]`) so
// TypeScript checks that every level has a class and that every class named
// here exists, a template index silently yields `undefined` for a typo,
// which renders as an uncoloured icon and looks like a CSS problem.
const PROBLEM_LEVEL_CLASS: Record<ProblemLevel, string> = {
  none: styles.levelNone,
  info: styles.levelInfo,
  warning: styles.levelWarning,
  error: styles.levelError,
};
