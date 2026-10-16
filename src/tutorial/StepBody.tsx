// tutorial-islands-design.md Sec.4.1 and Sec.4.2, a step's body rendered
// block by block (types.ts, BodyBlock). Its own file because both callouts in
// TutorialOverlay.tsx render a body, the running step and the feature-tour
// announcement, and they must agree on what every block looks like.

import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import type { BodyBlock, Inline, Paragraph } from "./types";
import styles from "./TutorialOverlay.module.css";

interface StepBodyProps {
  blocks: readonly BodyBlock[];
  /**
   * Called after the body changes height on its own, when an image loads or
   * a spoiler opens, so the overlay can place the callout again. A `check`
   * step's polling loop would notice anyway. A `manual` step has no loop.
   */
  onContentResize: () => void;
  /** Called when a dropdown spoiler opens or closes. Defaults to `onContentResize`. */
  onDropdownToggle?: () => void;
}

/**
 * Hidden state for every spoiler lives inside the spoiler component, so it
 * resets whenever this body remounts. TutorialOverlay keys StepCallout by
 * the step, which remounts it on every step change, Back included. An answer
 * left open from the last visit would give it away before the learner tried.
 */
export function StepBody({
  blocks,
  onContentResize,
  onDropdownToggle = onContentResize,
}: StepBodyProps) {
  return (
    <div className={styles.body}>
      {blocks.map((block, i) => {
        // Index keys are right here and usually a smell. The blocks are
        // static content that never reorders while shown, so the index is
        // a stable identity for each one.
        if (typeof block === "string" || Array.isArray(block))
          return (
            <ParagraphView
              key={i}
              paragraph={block}
              onReveal={onContentResize}
            />
          );
        switch (block.kind) {
          case "spoiler":
            return (
              <BlockSpoiler
                key={i}
                label={block.label}
                content={
                  "paragraphs" in block
                    ? { paragraphs: block.paragraphs }
                    : { text: block.text, code: block.code ?? false }
                }
                onToggle={onDropdownToggle}
                onReveal={onContentResize}
              />
            );
          case "image":
            return (
              <img
                key={i}
                className={styles.image}
                src={block.src}
                alt={block.alt}
                onLoad={onContentResize}
              />
            );
          case "code":
            return (
              <pre key={i} className={styles.code}>
                {block.text}
              </pre>
            );
          case "text":
            // An inline style, not a class per alignment. The value is data
            // from the content file, and a three-way class map in the CSS
            // module would only restate it.
            return (
              <p key={i} style={{ textAlign: block.align }}>
                {block.text}
              </p>
            );
        }
      })}
    </div>
  );
}

/** A paragraph of the body, or of an opened dropdown. */
function ParagraphView({
  paragraph,
  onReveal,
  className,
}: {
  paragraph: Paragraph;
  onReveal: () => void;
  className?: string;
}) {
  if (typeof paragraph === "string")
    return <p className={className}>{paragraph}</p>;
  return (
    <p className={className}>
      {paragraph.map((inline, j) => (
        <InlinePiece key={j} inline={inline} onReveal={onReveal} />
      ))}
    </p>
  );
}

function InlinePiece({
  inline,
  onReveal,
}: {
  inline: Inline;
  onReveal: () => void;
}) {
  if (typeof inline === "string") return <>{inline}</>;
  return (
    <InlineSpoiler
      text={inline.spoiler}
      maskAs={inline.maskAs}
      onReveal={onReveal}
    />
  );
}

/**
 * Calls `onChange` after the DOM reflects a toggle, and not on mount. A
 * layout effect so the callout is moved before the browser paints it in the
 * old position.
 *
 * Compares against the previous value rather than skipping the first run
 * with a "mounted" flag. React StrictMode runs mount effects twice in
 * development, and the flag would already be set on the second run, so it
 * would fire on mount there and nowhere else.
 */
function useAfterToggle(value: boolean, onChange: () => void): void {
  const previous = useRef(value);
  useLayoutEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    onChange();
    // Keyed on `value` alone. `onChange` is the overlay's `place`, whose
    // identity changes for reasons unrelated to this spoiler, and a re-run
    // then would place the callout again for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
}

/**
 * Hidden words inside a paragraph. While hidden, the words are NOT in the
 * DOM. One bar per word stands in for them, each as wide as that word is
 * when drawn in the surrounding font (measured on a canvas), with real
 * spaces between the bars. Revealing therefore swaps the bars for the words
 * at the same widths and the same wrap points, and the callout does not
 * change size. A blur or a transparent colour would leave the text readable
 * to a screen reader, to text selection and to find in page.
 *
 * `maskAs` sets the bar widths from other text than the hidden words. A number
 * uses it so a short answer cannot be told from a long one by its bar. The
 * callout then changes width by a few pixels on reveal, which a number can
 * take and a sentence could not.
 *
 * Revealing is one way.
 *
 * No HelpTip, on the owner's call (2026-10-06), an exception to CLAUDE.md's
 * every-control rule. The masked bar and its label say what it does, and a
 * hover popup over the answer's position would only get in the way.
 */
function InlineSpoiler({
  text,
  maskAs,
  onReveal,
}: {
  text: string;
  maskAs?: string;
  onReveal: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [widths, setWidths] = useState<number[] | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  useAfterToggle(revealed, onReveal);

  const maskText = maskAs ?? text;
  const words = maskText.split(" ");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return;
    context.font = getComputedStyle(el).font;
    setWidths(words.map((word) => context.measureText(word).width));
    // `words` is derived from `maskText`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskText]);

  if (revealed) return <span className={styles.inlineRevealed}>{text}</span>;
  // A span, not a button, so the bars can wrap over lines with the sentence.
  const reveal = () => setRevealed(true);
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      className={styles.inlineSpoiler}
      aria-label="Hidden text, click to show"
      onClick={reveal}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          reveal();
        }
      }}
    >
      {words.map((word, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span
            className={styles.inlineBar}
            style={
              widths
                ? { width: widths[i] }
                : { width: `${Math.max(1, word.length)}ch` }
            }
          >
            {String.fromCharCode(0x200b)}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * A labelled toggle between paragraphs. No HelpTip, for the same reason as
 * the inline form above. The label already says what opening it shows.
 *
 * A button with `aria-expanded` rather than a native details/summary pair,
 * which would also work now that nothing wraps the toggle. The button keeps
 * the open state in React, where the overlay's re-placement can follow it,
 * and both spoiler forms then share one hook for that.
 */
function BlockSpoiler({
  label,
  content,
  onToggle,
  onReveal,
}: {
  label: string;
  content: { text: string; code: boolean } | { paragraphs: Paragraph[] };
  onToggle: () => void;
  /** For hidden words inside the opened paragraphs. */
  onReveal: () => void;
}) {
  const [open, setOpen] = useState(false);
  const textId = useId();
  useAfterToggle(open, onToggle);

  return (
    <div className={styles.spoiler}>
      <button
        type="button"
        className={styles.spoilerToggle}
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> {label}
      </button>
      {open &&
        ("paragraphs" in content ? (
          // Each inline spoiler in here keeps its own revealed state, and
          // closing the dropdown unmounts them, so reopening it hides every
          // answer again. The same reset rule as a step change (StepBody).
          <div id={textId}>
            {content.paragraphs.map((paragraph, i) => (
              <ParagraphView
                key={i}
                paragraph={paragraph}
                onReveal={onReveal}
                className={styles.spoilerText}
              />
            ))}
          </div>
        ) : content.code ? (
          <pre id={textId} className={`${styles.code} ${styles.spoilerCode}`}>
            {content.text}
          </pre>
        ) : (
          <p id={textId} className={styles.spoilerText}>
            {content.text}
          </p>
        ))}
    </div>
  );
}
