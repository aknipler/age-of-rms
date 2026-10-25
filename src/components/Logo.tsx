import {
  LOGO_BIG_PATH,
  LOGO_HEIGHT,
  LOGO_OF_PATH,
  LOGO_RULES,
  LOGO_RULE_THICKNESS,
  LOGO_WIDTH,
} from "./logoPaths";

interface LogoProps {
  /** Rendered width in CSS pixels. Height follows the logo's aspect ratio. */
  width?: number;
}

// The logo as inline SVG rather than an <img> of public/logo/*.svg. An <img>
// is a separate document, so it cannot read this page's CSS custom properties
// and would need one file per theme plus code to guess which theme is active.
// Inline, the fills read var(--text) and var(--warning), so every built-in
// and custom theme gets a logo that matches it with no extra code. The two
// standalone files in public/logo/ carry fixed light and dark colours for
// places outside the app (README, store pages).
export function Logo({ width = 160 }: LogoProps) {
  return (
    <svg
      viewBox={`0 0 ${LOGO_WIDTH} ${LOGO_HEIGHT}`}
      width={width}
      role="img"
      aria-label="Age of RMS"
      style={{ display: "block", height: "auto" }}
    >
      <path fill="var(--text)" d={LOGO_BIG_PATH} />
      {LOGO_RULES.map((rule) => (
        <rect
          key={rule.x}
          x={rule.x}
          y={rule.y}
          width={rule.width}
          height={LOGO_RULE_THICKNESS}
          fill="var(--warning)"
        />
      ))}
      <path fill="var(--warning)" d={LOGO_OF_PATH} />
    </svg>
  );
}
