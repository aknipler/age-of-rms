// Pure ArgValue -> display-text rendering (docs/breakdown-design.md §3.4).
// Read-only for 3.2 — no parsing back, just formatting for display. The
// real "render an item to text" for inserts is patch/formatStyle.ts,
// 3.3 scope; this is display-only and much simpler.
import type { ArgNode, ArgValue, Token } from "../parser/types";

export function renderArgValue(value: ArgValue, tokens?: readonly Token[]): string {
  if (typeof value === "number") {
    if (value === Infinity) return "inf";
    if (value === -Infinity) return "-inf";
    return String(value);
  }
  if (typeof value === "string") return value;
  if ("rnd" in value) return `rnd(${value.rnd[0]},${value.rnd[1]})`;
  if ("expr" in value) {
    if (!tokens) return "(expression)";
    return value.expr.tokens.map((i) => tokens[i]?.text ?? "?").join(" ");
  }
  return String(value);
}

export function renderArg(arg: ArgNode, tokens: readonly Token[]): string {
  return renderArgValue(arg.value, tokens);
}

export function renderArgs(args: readonly ArgNode[], tokens: readonly Token[]): string {
  return args.map((a) => renderArg(a, tokens)).join(" ");
}
