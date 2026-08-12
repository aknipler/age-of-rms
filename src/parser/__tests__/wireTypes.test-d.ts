// Type-level gate for docs/parser-design.md Sec.4's amendment — the two
// defaulted parameters on the AST tree that let the Phase-5 tools contract name
// its external-wire form as an INSTANTIATION of these types rather than a
// hand-maintained copy.
//
// This file has no runtime assertions and is not a Vitest suite: the extension
// is `.test-d.ts`, which Vitest's default include (`*.{test,spec}.*`) does not
// match, so it never enters the file/test floor. It is checked by
// `npm run typecheck` (tsconfig `include: ["src"]`), which CI runs.
//
// WHY IT CANNOT DECAY INTO A VACUOUS PASS, which is the usual objection to a
// check that has only ever been green: half the assertions here are
// `@ts-expect-error`, and TypeScript reports an UNUSED `@ts-expect-error` as an
// error of its own. So each negative claim fails in both directions — if the
// error stops happening, this file goes red. The positive claims are ordinary
// assignments and fail the normal way.
//
// Mutation-tested when it landed: dropping `D` from CommandNode's `def` (back
// to `def?: CommandDef`) turns the def-read claim red; retyping NoDefs' slots
// `never` turns the assignability claim red. Both confirmed, both reverted.

import type {
  ArgNode,
  BlockNode,
  CommandNode,
  DefSlots,
  NoDefs,
  ParseResult,
  ScriptNode,
} from "../types";
import type { ArgumentDef, CommandDef } from "../language";

// The wire form. tools-api Sec.2 owns the real declaration once `tools-api/`
// exists; this local copy exists so the parser can prove its own types SUPPORT
// that instantiation without depending on a package that isn't written yet.
type InfSentinel = { inf: 1 | -1 };
type SerializedParseResult = ParseResult<number | InfSentinel, NoDefs>;

// ---------------------------------------------------------------------------
// 1. The load-bearing property: a real ParseResult flows INTO the wire type.
// Everything else rests on this — `ToolContext<ParseResult>` is only assignable
// to `ToolContext` (which defaults to the wire form) because of it.
// ---------------------------------------------------------------------------

declare const inProcess: ParseResult;
export const flowsToWire: SerializedParseResult = inProcess;

// The same property one level down, where the recursion actually lives
// (BlockNode -> Item -> CommandNode -> BlockNode). Generic interfaces that
// reference each other cyclically are where variance measurement gives up and
// falls back to a structural walk, so assert it rather than assume it.
declare const block: BlockNode;
export const blockFlowsToWire: BlockNode<number | InfSentinel, NoDefs> = block;

declare const script: ScriptNode;
export const scriptFlowsToWire: ScriptNode<number | InfSentinel, NoDefs> = script;

// ---------------------------------------------------------------------------
// 2. It does NOT flow back. The wire form is a strict supertype; a tool that
// hands a decoded tree to generatePreview() must be told so by the compiler.
// ---------------------------------------------------------------------------

declare const fromWire: SerializedParseResult;
// @ts-expect-error - the wire form is wider; it must not silently become a real ParseResult
export const wireDoesNotFlowBack: ParseResult = fromWire;

// ---------------------------------------------------------------------------
// 3. `def` is unreadable over the wire. This is the defect the amendment exists
// to prevent: `node.def?.name` compiles, works in-process, and returns
// undefined for every node over the wire — failing in the direction of "your
// map is fine".
// ---------------------------------------------------------------------------

export function defIsUnreadableOnWire(node: CommandNode<number | InfSentinel, NoDefs>) {
  // @ts-expect-error - def is `unknown` on the wire; resolve it through your own LanguageIndex
  return node.def?.name;
}

export function defIsReadableInProcess(node: CommandNode) {
  return node.def?.name; // string | undefined — no cast, no decode
}

// ---------------------------------------------------------------------------
// 4. Both numeric positions carry the sentinel. The `rnd` bounds are the half
// that rev 6 missed: parseRndValue() is Number() over an unbounded digit run,
// so a bound reaches Infinity by the same route a bare number token does.
// ---------------------------------------------------------------------------

export function bareNumericForcesADecode(arg: ArgNode<number | InfSentinel, NoDefs>) {
  // @ts-expect-error - the value union carries the sentinel; reading it as a number is a compile error
  const n: number = arg.value;
  return n;
}

export function rndBoundsForceADecode(arg: ArgNode<number | InfSentinel, NoDefs>) {
  const v = arg.value;
  if (typeof v !== "object" || !("rnd" in v)) return 0;
  // @ts-expect-error - rnd bounds take the parameter too, so they need decoding as well
  const lower: number = v.rnd[0];
  return lower;
}

// The other side of the same coin, and the reason `expr.tokens` was deliberately
// left off the parameter: a token INDEX still reads as a plain number on the
// wire. A blanket deep mapped type would have made this line an error and
// published a type claiming a token index might be infinite.
export function tokenIndicesStayPlainNumbers(arg: ArgNode<number | InfSentinel, NoDefs>) {
  const v = arg.value;
  if (typeof v !== "object" || !("expr" in v)) return 0;
  const first: number = v.expr.tokens[0];
  return first;
}

// ---------------------------------------------------------------------------
// 5. The two rejected mechanisms, kept executable so the reason for the chosen
// one cannot decay into folklore (same convention as rms0304.measure.test.ts
// keeping the rejected section-driven design runnable).
// ---------------------------------------------------------------------------

// (a) `def?: never` — the first thing anyone reaches for. It breaks
// assignability outright, and it breaks it a long way from where it is written.
interface NeverDefNode {
  kind: "command";
  def?: never;
}
declare const realDefNode: { kind: "command"; def?: CommandDef };
// @ts-expect-error - `CommandDef | undefined` is not assignable to `undefined`
export const neverDefBreaksAssignability: NeverDefNode = realDefNode;

// (b) A conditional property type on a mode parameter. Omitting `def` entirely
// is correct in isolation and cannot be reached by instantiating a parameter —
// a parameter changes a property's TYPE, never its EXISTENCE. Reaching for a
// conditional instead makes the mode parameter unmeasurable for variance, and
// the two instantiations stop being assignable on the type argument alone.
interface ConditionalDefNode<M extends "real" | "wire"> {
  kind: "command";
  def?: M extends "real" ? ArgumentDef : undefined;
}
declare const conditionalReal: ConditionalDefNode<"real">;
// @ts-expect-error - fails on the type ARGUMENT ("real" vs "wire"), with nothing about `def` in the message
export const conditionalBreaksVariance: ConditionalDefNode<"wire"> = conditionalReal;

// (c) The chosen mechanism, stated positively: indexed access keeps variance
// measurable, so DefSlots-instantiated nodes stay assignable to NoDefs ones.
declare const slotted: CommandNode<number, DefSlots>;
export const indexedAccessKeepsVariance: CommandNode<number, NoDefs> = slotted;
