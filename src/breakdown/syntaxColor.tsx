import type { ReactNode } from "react";
import styles from "./syntaxColor.module.css";

// Breakdown colours attribute names and constants the way the Code tab does
// (2026-10-23), so the same word is the same colour in both tabs. Only these
// two kinds for now. The colours are derivedPalette.ts's --syntax-* values,
// which Monaco's theme reads too.

/**
 * An all caps word, the Code tab tokenizer's rule for a constant
 * (editor/aoe2RmsLanguage.ts). Both tabs answer "is this a constant" from
 * the spelling alone, which is what lets a summary line and an input be
 * coloured without a name lookup.
 */
const CONSTANT_WORD = /\b([A-Z][A-Z0-9_]*)\b/;

/**
 * `text` with every constant word wrapped in the constant colour. The split
 * keeps the capture group, so the matches land on the odd indexes.
 */
export function ConstantsColoured({ text }: { text: string }) {
  const parts = text.split(CONSTANT_WORD);
  const out: ReactNode[] = parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className={styles.constant}>
        {part}
      </span>
    ) : (
      part
    ),
  );
  return <>{out}</>;
}

/** An attribute name in the attribute colour. */
export function AttributeName({ children }: { children: ReactNode }) {
  return <span className={styles.attribute}>{children}</span>;
}
