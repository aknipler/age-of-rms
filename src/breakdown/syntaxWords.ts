// The Code tab tokenizer's rule for a constant (editor/aoe2RmsLanguage.ts),
// an all caps word, for the Breakdown's value fields (syntaxColor.tsx has
// the components). A .ts file of its own so the component file exports
// components only, which React's fast refresh needs.

/** True when the whole text is one constant word, for a value field's colour. */
export function isConstantWord(text: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(text.trim());
}
