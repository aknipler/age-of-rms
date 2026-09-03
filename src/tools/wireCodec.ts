/**
 * The external-wire encoder for a `ParseResult` (tools-api-design.md Sec.4,
 * Sec.9 item 1). Nothing in this repo built this before BUG-017: the
 * `InfSentinel`/`SerializedParseResult` types in `tools-api/index.ts` describe
 * the wire SHAPE, and `numeric()` decodes one already-wire number, but the
 * encode direction, turning a real `ParseResult` (real `Infinity`, real
 * `def`s) into that shape, had no implementation and no test. This is the
 * "external serializer" Sec.1 goal 5 refers to.
 *
 * Two responsibilities, kept separate on purpose:
 *  - `encodeParseResultForWire` performs the two encodings the type system
 *    cannot: replacing `Infinity`/`-Infinity` in a numeric `ArgValue` slot with
 *    `InfSentinel`, and stripping every `def` (JSON has no back-references, so
 *    a shared `CommandDef` would otherwise re-expand at every node using it).
 *  - `findProhibitedValue` is a generic scanner, independent of `ArgValue`
 *    shape, for the values `PROHIBITED_VALUE_KINDS` names. It runs AFTER the
 *    `ArgValue`-aware encode, so a bare `Infinity` it still finds is one the
 *    encoder's own walk did not reach, a real bug, not a false positive.
 */

import type {
  ArgNode,
  ArgValue,
  AttributeNode,
  BlockNode,
  CommandNode,
  DirectiveNode,
  IfNode,
  Item,
  OrphanBlockNode,
  ParseResult,
  RandomNode,
  ScriptNode,
  SectionNode,
} from "../parser/types";
import type { InfSentinel, SerializedParseResult, WireNumber } from "../../tools-api/index";
import { PROHIBITED_VALUE_KINDS } from "../../tools-api/index";

export class WireEncodingError extends Error {}

function encodeNumber(n: number): WireNumber {
  // NaN is not representable at all (tools-api/index.ts's PROHIBITED_VALUE_KINDS).
  // There is no sentinel for it, unlike ±Infinity, so it can only be rejected.
  if (Number.isNaN(n)) throw new WireEncodingError("cannot encode NaN onto the wire — there is no sentinel for it");
  if (n === Infinity) return { inf: 1 };
  if (n === -Infinity) return { inf: -1 };
  return n;
}

/**
 * `expr.tokens` is deliberately left untouched: those are token INDICES, not
 * parsed numbers, and stay `number[]` on both transports (parser-design Sec.4's
 * amendment, `src/parser/__tests__/wireTypes.test-d.ts` item 4's other half).
 */
export function encodeArgValue(v: ArgValue): ArgValue<WireNumber> {
  if (typeof v === "string") return v;
  if (typeof v === "number") return encodeNumber(v);
  if ("rnd" in v) return { rnd: [encodeNumber(v.rnd[0]), encodeNumber(v.rnd[1])] };
  return v; // { expr: { tokens: number[] } }
}

function encodeArg(arg: ArgNode): ArgNode<WireNumber, never> {
  // `def` is omitted from the returned object entirely (not set to
  // `undefined`) so JSON.stringify produces the same smaller payload the real
  // wire does, not merely a type-level fiction.
  return { firstToken: arg.firstToken, lastToken: arg.lastToken, span: arg.span, value: encodeArgValue(arg.value) };
}

function encodeArgs(args: ArgNode[]): ArgNode<WireNumber, never>[] {
  return args.map(encodeArg);
}

function encodeBlock(block: BlockNode): BlockNode<WireNumber, never> {
  return {
    kind: "block",
    open: block.open,
    close: block.close,
    items: block.items.map(encodeItem),
    firstToken: block.firstToken,
    lastToken: block.lastToken,
    span: block.span,
  };
}

function encodeItem(item: Item): Item<WireNumber, never> {
  switch (item.kind) {
    case "command": {
      const node: CommandNode<WireNumber, never> = {
        kind: "command",
        name: item.name,
        args: encodeArgs(item.args),
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      if (item.block) node.block = encodeBlock(item.block);
      return node;
    }
    case "attribute": {
      const node: AttributeNode<WireNumber, never> = {
        kind: "attribute",
        name: item.name,
        args: encodeArgs(item.args),
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      return node;
    }
    case "directive": {
      const node: DirectiveNode<WireNumber, never> = {
        kind: "directive",
        hash: item.hash,
        args: encodeArgs(item.args),
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      return node;
    }
    case "if": {
      const node: IfNode<WireNumber, never> = {
        kind: "if",
        branches: item.branches.map((b) => ({ keyword: b.keyword, condition: b.condition, items: b.items.map(encodeItem) })),
        endif: item.endif,
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      return node;
    }
    case "random": {
      const node: RandomNode<WireNumber, never> = {
        kind: "random",
        start: item.start,
        preamble: item.preamble.map(encodeItem),
        branches: item.branches.map((b) => ({
          chanceKeyword: b.chanceKeyword,
          chance: b.chance ? encodeArg(b.chance) : undefined,
          items: b.items.map(encodeItem),
        })),
        end: item.end,
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      return node;
    }
    case "orphanBlock": {
      const node: OrphanBlockNode<WireNumber, never> = {
        kind: "orphanBlock",
        block: encodeBlock(item.block),
        firstToken: item.firstToken,
        lastToken: item.lastToken,
        span: item.span,
      };
      return node;
    }
    case "raw":
      return item; // RawNode takes neither type parameter, nothing to encode
  }
}

function encodeSection(section: SectionNode): SectionNode<WireNumber, never> {
  return {
    kind: "section",
    header: section.header,
    name: section.name,
    known: section.known,
    items: section.items.map(encodeItem),
    firstToken: section.firstToken,
    lastToken: section.lastToken,
    span: section.span,
  };
}

function encodeScript(script: ScriptNode): ScriptNode<WireNumber, never> {
  return {
    preamble: script.preamble.map(encodeItem),
    sections: script.sections.map(encodeSection),
  };
}

/**
 * Every value `PROHIBITED_VALUE_KINDS` names, found anywhere in `value`, a
 * `Map`/`Set`/`Date`/`RegExp`/function, a `NaN`, an `undefined` array element,
 * a class instance, or a bare `±Infinity` (i.e. one this module's own
 * `ArgValue` walk did not already turn into a sentinel). Returns `null` when
 * clean.
 *
 * An `undefined`-VALUED KEY on a plain object is explicitly NOT flagged, a
 * real corpus parse carries thousands of them on optional properties (Sec.1),
 * and they survive `JSON.stringify` as an absent key, which reads identically
 * on both sides of the wire.
 */
export function findProhibitedValue(value: unknown, path = "$"): { path: string; kind: string } | null {
  if (typeof value === "function") return { path, kind: "function" };
  if (typeof value === "number") {
    if (Number.isNaN(value)) return { path, kind: "NaN" };
    if (value === Infinity || value === -Infinity) return { path, kind: "±Infinity outside the sentinel" };
    return null;
  }
  if (value === null || value === undefined || typeof value !== "object") return null;
  if (value instanceof Map) return { path, kind: "Map" };
  if (value instanceof Set) return { path, kind: "Set" };
  if (value instanceof Date) return { path, kind: "Date" };
  if (value instanceof RegExp) return { path, kind: "RegExp" };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (value[i] === undefined) return { path: `${path}[${i}]`, kind: "undefined as an array element" };
      const bad = findProhibitedValue(value[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return { path, kind: "class instance" };
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue; // an absent-reading optional key, not a prohibited value
    const bad = findProhibitedValue(v, `${path}.${key}`);
    if (bad) return bad;
  }
  return null;
}

/**
 * `PROHIBITED_VALUE_KINDS` restated as the function's own return type, so a
 * kind added there without a matching case here is at least visible at the
 * call site rather than silently unchecked.
 */
export const _PROHIBITED_KINDS_COVERED: readonly (typeof PROHIBITED_VALUE_KINDS)[number][] = [
  "Map",
  "Set",
  "Date",
  "RegExp",
  "class instance",
  "function",
  "NaN",
  "±Infinity outside the sentinel",
  "undefined as an array element",
];

/**
 * The whole encode: real `ParseResult` in, `SerializedParseResult` out,
 * `def` stripped, `Infinity`/`-Infinity` sentinel-encoded in every `ArgValue`
 * slot, validated clean of every `PROHIBITED_VALUE_KINDS` shape before it is
 * returned. Throws `WireEncodingError` rather than shipping a payload the
 * host's own `findProhibitedValue` would reject, the host-side half of
 * `ErrorReason`'s `"host-error"` (tools-api/index.ts): the payload was never
 * the tool's fault.
 */
export function encodeParseResultForWire(pr: ParseResult): SerializedParseResult {
  const wire: SerializedParseResult = {
    source: pr.source,
    tokens: pr.tokens,
    lineOffsets: pr.lineOffsets,
    script: encodeScript(pr.script),
    symbols: pr.symbols,
    includes: pr.includes,
    diagnostics: pr.diagnostics,
  };
  const bad = findProhibitedValue(wire);
  if (bad) throw new WireEncodingError(`wire payload contains a prohibited value (${bad.kind}) at ${bad.path}`);
  return wire;
}

export type { InfSentinel };
