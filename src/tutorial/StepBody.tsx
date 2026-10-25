// tutorial-islands-design.md Sec.4.1 and Sec.4.2, a step's body rendered
// block by block (types.ts, BodyBlock). Its own file because both callouts in
// TutorialOverlay.tsx render a body, the running step and the feature-tour
// announcement, and they must agree on what every block looks like.

import {
  Fragment,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { BodyBlock, Inline, Paragraph, SpoilerParagraph } from "./types";
import { renderProse } from "../components/InlineCode";
import { TutorialDiagram } from "./diagrams";
import { WarnIcon } from "./tutorialIcons";
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
  /** Which spoilers the learner has opened. Without it, each starts shut on every mount. */
  spoilerMemory?: SpoilerMemory;
}

/**
 * Which spoilers the learner opened, kept by the overlay for one tutorial run
 * so they survive the remount that every step change causes (TutorialOverlay
 * keys StepCallout by the step, Back included). `scope` names the step, and
 * each spoiler adds its position in the body to form its own key.
 *
 * Plain mutable data and not state. Nothing renders from it directly. Each
 * spoiler reads it once, when it mounts, and writes to it when toggled, so a
 * change needs no re-render of anything else.
 */
export interface SpoilerMemory {
  opened: Set<string>;
  scope: string;
}

/**
 * A spoiler's open state, seeded from `memory` on mount and written back on
 * every toggle. The state itself stays in the component, so a toggle renders
 * as before. `memory` only decides the starting value.
 */
function useRememberedOpen(
  memory: SpoilerMemory | undefined,
  key: string,
): [boolean, (open: boolean) => void] {
  const full = memory ? `${memory.scope}#${key}` : null;
  const [open, setOpenState] = useState(
    () => full !== null && memory!.opened.has(full),
  );
  const setOpen = (value: boolean) => {
    setOpenState(value);
    if (full === null) return;
    if (value) memory!.opened.add(full);
    else memory!.opened.delete(full);
  };
  return [open, setOpen];
}

export function StepBody({
  blocks,
  onContentResize,
  onDropdownToggle = onContentResize,
  spoilerMemory,
}: StepBodyProps) {
  return (
    <div className={styles.body}>
      {blocks.map((block, i) => {
        // Index keys are right here and usually a smell. The blocks are
        // static content that never reorders while shown, so the index is
        // a stable identity for each one. They also name the spoiler in the
        // memory, for the same reason.
        if (typeof block === "string" || Array.isArray(block))
          return (
            <ParagraphView
              key={i}
              paragraph={block}
              onReveal={onContentResize}
              memory={spoilerMemory}
              memoryKey={`${i}`}
            />
          );
        switch (block.kind) {
          case "spoiler":
            return (
              <BlockSpoiler
                key={i}
                memory={spoilerMemory}
                memoryKey={`${i}`}
                label={block.label}
                warn={block.warn === true}
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
          case "diagram":
            // Inline SVG has its size from the first render, so unlike an
            // image it needs no onLoad to place the callout again.
            return (
              <TutorialDiagram key={i} name={block.name} alt={block.alt} />
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
                {renderProse(block.text)}
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
  memory,
  memoryKey,
  className,
}: {
  paragraph: Paragraph;
  onReveal: () => void;
  memory: SpoilerMemory | undefined;
  /** This paragraph's place in the body, extended with each inline spoiler's index. */
  memoryKey: string;
  className?: string;
}) {
  if (typeof paragraph === "string")
    return <p className={className}>{renderProse(paragraph)}</p>;
  return (
    <p className={className}>
      {paragraph.map((inline, j) => (
        <InlinePiece
          key={j}
          inline={inline}
          onReveal={onReveal}
          memory={memory}
          memoryKey={`${memoryKey}.${j}`}
        />
      ))}
    </p>
  );
}

function InlinePiece({
  inline,
  onReveal,
  memory,
  memoryKey,
}: {
  inline: Inline;
  onReveal: () => void;
  memory: SpoilerMemory | undefined;
  memoryKey: string;
}) {
  if (typeof inline === "string") return <>{renderProse(inline)}</>;
  return (
    <InlineSpoiler
      text={inline.spoiler}
      maskAs={inline.maskAs}
      onReveal={onReveal}
      memory={memory}
      memoryKey={memoryKey}
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
 * A click on the revealed words hides them again.
 *
 * The revealed words are plain text, not renderProse: the bars were measured in
 * the surrounding font, and a code chip's monospace face would change the
 * widths the swap promises to keep.
 *
 * No HelpTip, on the owner's call (2026-10-06), an exception to CLAUDE.md's
 * every-control rule. The masked bar and its label say what it does, and a
 * hover popup over the answer's position would only get in the way.
 */
function InlineSpoiler({
  text,
  maskAs,
  onReveal,
  memory,
  memoryKey,
}: {
  text: string;
  maskAs?: string;
  onReveal: () => void;
  memory: SpoilerMemory | undefined;
  memoryKey: string;
}) {
  const [revealed, setRevealed] = useRememberedOpen(memory, memoryKey);
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
    // `words` is derived from `maskText`. `revealed` is a dependency because
    // the bars are not in the DOM while the words show, and `ref` is empty
    // then. A spoiler that mounts already revealed (remembered open) and is
    // hidden by a click measures on that click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maskText, revealed]);

  // A span, not a button, so the bars can wrap over lines with the sentence.
  const toggle = () => setRevealed(!revealed);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  };
  // No aria-label here. It would replace the words as the accessible name.
  if (revealed)
    return (
      <span
        role="button"
        tabIndex={0}
        className={styles.inlineRevealed}
        title="Click to hide again"
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        {text}
      </span>
    );
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      className={styles.inlineSpoiler}
      aria-label="Hidden text, click to show"
      onClick={toggle}
      onKeyDown={onKeyDown}
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
  warn,
  content,
  onToggle,
  onReveal,
  memory,
  memoryKey,
}: {
  label: string;
  /** Shows a warning triangle before the label. */
  warn: boolean;
  content: { text: string; code: boolean } | { paragraphs: SpoilerParagraph[] };
  onToggle: () => void;
  /** For hidden words inside the opened paragraphs. */
  onReveal: () => void;
  memory: SpoilerMemory | undefined;
  memoryKey: string;
}) {
  const [open, setOpen] = useRememberedOpen(memory, memoryKey);
  const textId = useId();
  useAfterToggle(open, onToggle);

  return (
    <div className={styles.spoiler}>
      <button
        type="button"
        className={styles.spoilerToggle}
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
        {warn && <WarnIcon />}
        {label}
      </button>
      {open &&
        ("paragraphs" in content ? (
          // Each inline spoiler in here is remembered under this dropdown's
          // key plus its own position, so closing and reopening the dropdown
          // leaves a revealed answer revealed.
          // A code entry is told apart by its `kind`, after the two tests
          // that pick out a paragraph, the same order StepBody reads a block
          // in. A code entry keeps its index in the key sequence, so adding
          // one never shifts the remembered state of the paragraphs after it.
          <div id={textId}>
            {content.paragraphs.map((entry, i) =>
              typeof entry === "string" || Array.isArray(entry) ? (
                <ParagraphView
                  key={i}
                  paragraph={entry}
                  onReveal={onReveal}
                  memory={memory}
                  memoryKey={`${memoryKey}.${i}`}
                  className={styles.spoilerText}
                />
              ) : (
                <pre key={i} className={`${styles.code} ${styles.spoilerCode}`}>
                  {entry.text}
                </pre>
              ),
            )}
          </div>
        ) : content.code ? (
          <pre id={textId} className={`${styles.code} ${styles.spoilerCode}`}>
            {content.text}
          </pre>
        ) : (
          <p id={textId} className={styles.spoilerText}>
            {renderProse(content.text)}
          </p>
        ))}
    </div>
  );
}
