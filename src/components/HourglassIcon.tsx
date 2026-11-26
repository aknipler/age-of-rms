// Single-color hourglass outline in currentColor, so it takes the button's
// text color. Replaces the ⌛ emoji, which WebView2 draws in colour from
// Segoe UI Emoji whatever the CSS color says. The text presentation selector
// U+FE0E is the usual way to ask for a plain glyph, but Windows ignores it
// for this character, so an SVG is the only reliable single-colour option.
export function HourglassIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 1.5h9" />
      <path d="M3.5 14.5h9" />
      {/* Each side is two quadratic curves meeting at the neck, with control
          points near the frame so the glass bows out only slightly. */}
      <path d="M4 1.5Q4.3 5.6 7.3 8Q4.3 10.4 4 14.5" />
      <path d="M12 1.5Q11.7 5.6 8.7 8Q11.7 10.4 12 14.5" />
      <path d="M6 13.5 8 11.5l2 2Z" fill="currentColor" />
    </svg>
  );
}
