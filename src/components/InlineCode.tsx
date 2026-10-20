import { Fragment, type ReactNode } from "react";
import styles from "./InlineCode.module.css";

/** One inline code chip. For a literal piece of RMS in a sentence: a command, an attribute, a constant, a value. */
export function InlineCode({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}

// What counts as code in prose without being asked to. An identifier with at
// least one underscore (create_land, TEAM_POSITIONS, RMSTEST_27) or a
// preprocessor directive (#const). Words with no underscore are NOT guessed
// at, since `zone`, `if` and `RMS` are as often English as RMS, so those take
// explicit backticks. The look-arounds keep it off the middle of a path or
// file name (src/foo_bar.ts, my_map.rms) while still matching a name that ends
// a sentence ("... create_land.").
const AUTO_CODE =
  /(?<![\w./\\-])(?:#(?:define|undefine|const|include_drs|includeXS|if|elseif|else|endif)\b|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)(?![\w/\\-]|\.[A-Za-z0-9])/g;

/**
 * Prose text with its code marked up as `<InlineCode>`. Two sources, applied
 * to every prose surface through this one function so they all agree:
 *
 *  1. `backtick` spans, as in markdown, for anything the author wants shown as
 *     code (a bare constant such as `GRASS`, a value such as `rnd`);
 *  2. underscore identifiers and #directives, found automatically, so the
 *     existing copy ("add create_player_lands") needed no rewrite and new copy
 *     cannot forget.
 *
 * An unmatched backtick is left as written.
 */
export function renderProse(text: string): ReactNode {
  const pieces = text.split(/`([^`\n]+)`/);
  // split with one capture group alternates plain, code, plain, code, ...
  return pieces.map((piece, i) =>
    i % 2 === 1 ? (
      <InlineCode key={i}>{piece}</InlineCode>
    ) : (
      <Fragment key={i}>{withAutoCode(piece)}</Fragment>
    ),
  );
}

function withAutoCode(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(AUTO_CODE)) {
    const at = match.index;
    if (at > last) out.push(text.slice(last, at));
    out.push(<InlineCode key={at}>{match[0]}</InlineCode>);
    last = at + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `renderProse` as a component, for JSX that has the string in hand. */
export function Prose({ text }: { text: string }) {
  return <>{renderProse(text)}</>;
}
