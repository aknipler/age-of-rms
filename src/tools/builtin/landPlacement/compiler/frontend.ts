// Sec.5.2: the front end. "The user writes maths the way maths is written."
// Ordinary precedence-climbing parser over numbers, identifiers, `x`, `y`,
// parens, unary `-`, binary `+ - * / %` with CONVENTIONAL precedence, and
// the call forms SIN(e), COS(e), rnd(a,b). Precedence is the user's;
// flattening it into RMS's left-to-right, no-precedence form is the back
// end's job (emit.ts), not this one's. This module only ever produces an
// ordinary (possibly right-leaning) expression tree.
//
// `x`/`y` become `sym("x")`/`sym("y")`. The caller (a future formula-slot
// consumer) is responsible for substituting the placement's own x/y in;
// this module has no placement context.

import type { Expr } from "../../../../../tools-api/index";
import { bin, negE, num, param, sym } from "./expr";

export interface ParseError {
  message: string;
  position: number;
}

export type ParseFormulaResult =
  { ok: true; expr: Expr } | { ok: false; error: ParseError };

type TokKind = "num" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Tok {
  kind: TokKind;
  text: string;
  pos: number;
}

function lex(source: string): Tok[] {
  const toks: Tok[] = [];
  const re =
    /\s*(?:([0-9]+(?:\.[0-9]+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/%])|(\()|(\))|(,))\s*/y;
  let i = 0;
  while (i < source.length) {
    re.lastIndex = i;
    const m = re.exec(source);
    if (!m || m.index !== i) {
      throw new ParseFail(`unrecognised character '${source[i]}'`, i);
    }
    const pos = i;
    i = re.lastIndex;
    if (m[1] !== undefined) toks.push({ kind: "num", text: m[1], pos });
    else if (m[2] !== undefined) toks.push({ kind: "ident", text: m[2], pos });
    else if (m[3] !== undefined) toks.push({ kind: "op", text: m[3], pos });
    else if (m[4] !== undefined) toks.push({ kind: "lparen", text: "(", pos });
    else if (m[5] !== undefined) toks.push({ kind: "rparen", text: ")", pos });
    else if (m[6] !== undefined) toks.push({ kind: "comma", text: ",", pos });
  }
  toks.push({ kind: "eof", text: "", pos: source.length });
  return toks;
}

class ParseFail extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
  }
}

const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
};

class Parser {
  private i = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private expect(kind: TokKind, text?: string): Tok {
    const t = this.peek();
    if (t.kind !== kind || (text !== undefined && t.text !== text)) {
      throw new ParseFail(
        `expected '${text ?? kind}', got '${t.text || "end of input"}'`,
        t.pos,
      );
    }
    return this.next();
  }

  parseExpr(): Expr {
    const e = this.parseBinary(0);
    this.expect("eof");
    return e;
  }

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== "op") break;
      const prec = PRECEDENCE[t.text];
      if (prec < minPrec) break;
      this.next();
      // Left-associative: next call requires strictly higher precedence.
      const right = this.parseBinary(prec + 1);
      left = bin(t.text as "+" | "-" | "*" | "/" | "%", left, right);
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === "op" && t.text === "-") {
      this.next();
      return negE(this.parseUnary());
    }
    return this.parseAtom();
  }

  private parseAtom(): Expr {
    const t = this.peek();
    if (t.kind === "num") {
      this.next();
      return num(Number(t.text));
    }
    if (t.kind === "lparen") {
      this.next();
      const e = this.parseBinary(0);
      this.expect("rparen");
      return e;
    }
    if (t.kind === "ident") {
      this.next();
      const name = t.text;
      // `x`/`y` are ordinary identifiers here too. A future formula-slot
      // consumer substitutes the placement's own x/y for these names; this
      // module has no placement context to resolve them against.
      if (this.peek().kind === "lparen") return this.parseCall(name, t.pos);
      return sym(name);
    }
    throw new ParseFail(`expected a number, identifier or '('`, t.pos);
  }

  /**
   * A `rnd(a,b)` bound, allowing an optional leading `-`. REAL BUG FOUND
   * WRITING SLICE 5'S FORMULA FIELD: this used to be a bare `this.expect
   * ("num")`, which cannot parse `rnd(-2,2)` at all ("expected 'num', got
   * '-'"), even though Sec.4.4's OWN worked example is exactly that call
   * (`ROTATION_AUX rnd(-180,180)`). The lexer never folds a sign into a
   * number token (`-2` lexes as `-` then `2`, same as everywhere else in
   * this grammar), and nothing had ever exercised this path with a negative
   * bound. `frontend.test.ts`'s own pre-existing case is `rnd(1,10)`.
   */
  private parseRndBound(): string {
    if (this.peek().kind === "op" && this.peek().text === "-") {
      this.next();
      const n = this.expect("num");
      return `-${n.text}`;
    }
    return this.expect("num").text;
  }

  private parseCall(name: string, pos: number): Expr {
    this.expect("lparen");
    if (/^sin$/i.test(name)) {
      const e = this.parseBinary(0);
      this.expect("rparen");
      return { k: "sin", e };
    }
    if (/^cos$/i.test(name)) {
      const e = this.parseBinary(0);
      this.expect("rparen");
      return { k: "cos", e };
    }
    if (/^rnd$/i.test(name)) {
      // Sec.5.1: rnd(a,b) is only legal as a whole #const value, never a
      // term inside an expression, so the front end represents it as a
      // fresh, unnamed hoisted parameter. The caller (the panel, slice 2)
      // is responsible for turning this into a real RandomParam with a
      // label; here it is just structurally distinguishable as a `param`.
      const a = this.parseRndBound();
      this.expect("comma", ",");
      const b = this.parseRndBound();
      this.expect("rparen");
      return param(`rnd(${a},${b})@${pos}`);
    }
    throw new ParseFail(
      `unknown function '${name}' — only SIN, COS, rnd are supported`,
      pos,
    );
  }
}

/** Parses ordinary infix maths, Sec.5.2, into an Expr tree. */
export function parseFormula(source: string): ParseFormulaResult {
  try {
    const toks = lex(source);
    const expr = new Parser(toks).parseExpr();
    return { ok: true, expr };
  } catch (e) {
    if (e instanceof ParseFail)
      return { ok: false, error: { message: e.message, position: e.position } };
    throw e;
  }
}
