// Phase 2.3 — the RMS parser core, implementing docs/parser-design.md
// (rev 5) §§3-7. Pure function: no I/O, no globals, no exceptions escape
// (spec goal #1). Iterative with an explicit frame stack (§5.0's preferred
// shape — no recursion, so no depth-related throw is even possible; the
// maxNestingDepth option still degrades absurd nesting to RawNodes so the
// AST stays sane for consumers).
//
// Reading order for future sessions: the dispatch loop in `parseRms` is a
// direct transcription of §5.1's numbered items; argument consumption
// (§6) lives in `consumeArgs`; §5.3 degradation in `degrade`; §5.4 in
// `handleOpenBrace`.

import { tokenize } from "./lexer";
import type {
  ArgNode,
  ArgValue,
  AttributeNode,
  BlockNode,
  CommandNode,
  Diagnostic,
  DirectiveNode,
  IfNode,
  IncludeInfo,
  Item,
  OrphanBlockNode,
  ParseOptions,
  ParseResult,
  RandomNode,
  RawNode,
  ScriptNode,
  SectionNode,
  SymbolInfo,
  Token,
} from "./types";
import type { ArgumentDef, AttributeDef, CommandDef, LanguageData, LanguageIndex } from "./language";
import { buildLanguageIndex, NUMERIC_ARGUMENT_TYPES } from "./language";
import * as d from "./diagnostics";

const ASSEMBLY_CAP = 64; // shared by expression and quote assembly (spec §2.2 / §5.2)
const DEFAULT_MAX_NESTING = 200;

// ---------------------------------------------------------------------------
// Frames — the explicit parse stack. Sections are NOT frames (they cannot
// nest); the section cursor lives directly on the Parser.
// ---------------------------------------------------------------------------

interface BlockFrame {
  type: "block";
  node: BlockNode;
  owner: CommandNode | OrphanBlockNode;
  // RMS0207 cascade suppression (§5.1): set when a token inside this block
  // carried a lexer RMS0003 brace lint — one glued brace must not produce
  // fifty wrong-context warnings.
  suspect: boolean;
  wrongContextCount: number;
}

interface IfFrame {
  type: "if";
  node: IfNode;
}

interface RandomFrame {
  type: "random";
  node: RandomNode;
}

type Frame = BlockFrame | IfFrame | RandomFrame;

class Parser {
  readonly source: string;
  readonly tokens: Token[];
  readonly lineOffsets: number[];
  readonly diagnostics: Diagnostic[];
  readonly lang: LanguageIndex;
  readonly maxNesting: number;

  /** Indices (into `tokens`) of non-trivia tokens — the parse stream. */
  readonly nt: number[];
  /** Cursor into `nt`. */
  p = 0;

  readonly script: ScriptNode = { preamble: [], sections: [] };
  readonly symbols: SymbolInfo[] = [];
  readonly includes: IncludeInfo[] = [];

  currentSection: SectionNode | undefined;
  readonly frames: Frame[] = [];
  /** Pending unknown-run: contiguous nt-positions awaiting a single RawNode. */
  pendingRun: number[] = [];
  /**
   * True when the run's FIRST token already carries its own diagnostic
   * (stray } → RMS0104, mismatched keyword → RMS0106) — the flush must not
   * add a second one (spec §5.1: absorbed tokens keep their own diagnostic;
   * one diagnostic per run otherwise).
   */
  pendingRunDiagnosed = false;
  /** Token start-offsets that drew a lexer RMS0003 lint (cascade suppression). */
  readonly rms0003Starts: Set<number>;

  constructor(source: string, langData: LanguageData, opts: ParseOptions) {
    this.source = source;
    this.lang = buildLanguageIndex(langData);
    this.maxNesting = opts.maxNestingDepth ?? DEFAULT_MAX_NESTING;

    const lex = tokenize(source, { nestedComments: opts.nestedComments });
    this.tokens = lex.tokens;
    this.lineOffsets = lex.lineOffsets;
    this.diagnostics = [...lex.diagnostics];

    // §2.1 aliasTable: lexer-level classification override. v1 limitation
    // (documented): applied post-lex, so aliases of comment markers do not
    // affect the already-completed comment pass — fine while the table is
    // empty by default; revisit when token-aliases.json is imported.
    const aliasTable = opts.aliasTable;
    if (aliasTable && aliasTable.size > 0) {
      for (const t of this.tokens) {
        const alias = aliasTable.get(t.text);
        if (alias !== undefined) t.kind = alias;
      }
    }

    this.nt = [];
    for (let i = 0; i < this.tokens.length; i++) {
      if (!this.tokens[i].isTrivia) this.nt.push(i);
    }

    this.rms0003Starts = new Set(
      this.diagnostics.filter((diag) => diag.code === "RMS0003").map((diag) => diag.span.start),
    );
  }

  // ---- small helpers -----------------------------------------------------

  tokAt(pos: number): Token {
    return this.tokens[this.nt[pos]];
  }

  /** The item list new nodes are appended to, per the innermost open container. */
  currentItems(): Item[] {
    const top = this.frames[this.frames.length - 1];
    if (!top) return this.currentSection ? this.currentSection.items : this.script.preamble;
    if (top.type === "block") return top.node.items;
    if (top.type === "if") return top.node.branches[top.node.branches.length - 1].items;
    // random: preamble until the first percent_chance branch exists
    return top.node.branches.length > 0
      ? top.node.branches[top.node.branches.length - 1].items
      : top.node.preamble;
  }

  /** Statement vs block context (§4): nearest block frame wins; if/random are transparent. */
  inBlockContext(): boolean {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].type === "block") return true;
    }
    return false;
  }

  conditionalDepth(): number {
    let n = 0;
    for (const f of this.frames) if (f.type === "if" || f.type === "random") n++;
    return n;
  }

  span(firstToken: number, lastToken: number): { start: number; end: number } {
    return { start: this.tokens[firstToken].start, end: this.tokens[lastToken].end };
  }

  /** Refresh a node's lastToken/span after consuming more tokens. */
  extend(node: { firstToken: number; lastToken: number; span: { start: number; end: number } }, lastToken: number): void {
    if (lastToken > node.lastToken) {
      node.lastToken = lastToken;
      node.span = this.span(node.firstToken, lastToken);
    }
  }

  // ---- unknown runs (§5.1 coverage rule: no token is ever dropped) --------

  runPush(pos: number, alreadyDiagnosed = false): void {
    if (this.pendingRun.length === 0) this.pendingRunDiagnosed = alreadyDiagnosed;
    this.pendingRun.push(pos);
  }

  flushRun(): void {
    if (this.pendingRun.length === 0) return;
    const firstIdx = this.nt[this.pendingRun[0]];
    const lastIdx = this.nt[this.pendingRun[this.pendingRun.length - 1]];
    const firstTok = this.tokens[firstIdx];
    const raw: RawNode = {
      kind: "raw",
      reason: "unknown-run",
      firstToken: firstIdx,
      lastToken: lastIdx,
      span: this.span(firstIdx, lastIdx),
    };
    // One diagnostic per run (§5.1) — unless the first token already carries
    // its own (RMS0104/0106 absorption, or a lexer RMS0003 glue lint — a
    // "}8050" token must not draw BOTH the glue lint and an unknown-name
    // warning). Word-initiated → RMS0200 with did-you-mean; value-initiated
    // → RMS0215 (rev 5).
    if (this.rms0003Starts.has(firstTok.start)) this.pendingRunDiagnosed = true;
    if (!this.pendingRunDiagnosed) {
      if (firstTok.kind === "word") {
        const context = this.inBlockContext() ? "attribute" : "command";
        this.diagnostics.push(d.unknownName(firstTok, context, this.didYouMean(firstTok.text, context)));
      } else {
        this.diagnostics.push(d.unexpectedValue(firstTok, this.tokens[lastIdx]));
      }
    }
    this.currentItems().push(raw);
    this.pendingRun = [];
    this.pendingRunDiagnosed = false;
  }

  /** Did-you-mean (§10): edit distance ≤ 2 (case-insensitive), then suffix/substring. */
  didYouMean(name: string, context: "command" | "attribute"): string | undefined {
    if (name.length < 3) return undefined;
    const pool =
      context === "command"
        ? [...this.lang.commandsByName.keys(), ...this.lang.attributesByName.keys()]
        : [...this.lang.attributesByName.keys(), ...this.lang.commandsByName.keys()];
    const lower = name.toLowerCase();
    let best: string | undefined;
    let bestDist = 3;
    for (const candidate of pool) {
      if (Math.abs(candidate.length - lower.length) > 2) continue;
      const dist = editDistanceCapped(lower, candidate.toLowerCase(), 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
        if (dist === 0) break; // case-only mismatch — perfect suggestion
      }
    }
    if (best !== undefined) return best;
    // Suffix/substring heuristic (avoidance_distance → other_zone_avoidance_distance).
    if (name.length >= 6) {
      let shortest: string | undefined;
      for (const candidate of pool) {
        if (candidate !== lower && candidate.endsWith(lower)) {
          if (shortest === undefined || candidate.length < shortest.length) shortest = candidate;
        }
      }
      return shortest;
    }
    return undefined;
  }

  // ---- main loop -----------------------------------------------------------

  parse(): void {
    while (this.p < this.nt.length) {
      const tok = this.tokAt(this.p);
      switch (tok.kind) {
        case "sectionHeader":
          this.handleSectionHeader();
          break;
        case "directive":
          this.flushRun();
          this.parseDirective();
          break;
        case "openBrace":
          this.handleOpenBrace();
          break;
        case "closeBrace":
          this.handleCloseBrace();
          break;
        case "word":
          if (this.lang.controlKeywords.has(tok.text)) {
            this.handleControlKeyword(tok.text);
          } else {
            this.parseNamedOrRun();
          }
          break;
        case "number":
        case "rnd":
          this.runPush(this.p); // §5.1 item 7 → RMS0215 at flush
          this.p++;
          break;
        default:
          // commentOpen/commentClose are always trivia by the time we're here;
          // defensively absorb anything unexpected rather than dropping it.
          this.runPush(this.p);
          this.p++;
          break;
      }
    }
    this.finishAtEof();
  }

  // ---- §5.1 item 1: section headers ---------------------------------------

  handleSectionHeader(): void {
    this.flushRun();
    const headerTok = this.tokAt(this.p);

    const hasBlock = this.frames.some((f) => f.type === "block");
    const hasCond = this.frames.some((f) => f.type === "if" || f.type === "random");

    if (hasCond) {
      // Legal RMS (token-filter model): conditionals may span section
      // headers → §5.3 degradation, absorbing headers while only
      // conditionals remain open. If blocks are ALSO open, the forward
      // scan stops at a header per RMS0103 semantics inside `degrade`.
      // All open frames are involved (blocks too, when mixed — the forward
      // scan's own RMS0103 rule bounds that case at the header).
      this.degrade(0, "conditional-spans-structure", "RMS0110");
      return;
    }

    if (hasBlock) {
      // Only blocks open: force-close them all with RMS0103, keep the
      // (lossless) structural nodes, then start the section.
      while (this.frames.length > 0) {
        const top = this.frames[this.frames.length - 1];
        if (top.type !== "block") break;
        this.diagnostics.push(d.sectionHeaderInBlock(headerTok, this.tokens[top.node.open]));
        this.closeBlockFrame(top, undefined);
        this.frames.pop();
      }
    }

    const headerIdx = this.nt[this.p];
    const name = headerTok.text.slice(1, -1);
    const known = this.lang.sections.has(name);
    if (!known) this.diagnostics.push(d.unknownSection(headerTok));
    const section: SectionNode = {
      kind: "section",
      header: headerIdx,
      name,
      known,
      items: [],
      firstToken: headerIdx,
      lastToken: headerIdx,
      span: this.span(headerIdx, headerIdx),
    };
    this.currentSection = section;
    this.script.sections.push(section);
    this.p++;
  }

  // ---- §5.1 item 2: directives ---------------------------------------------

  parseDirective(): void {
    const hashPos = this.p;
    const hashIdx = this.nt[hashPos];
    const hashTok = this.tokens[hashIdx];
    this.p++;

    const def = this.lang.directivesByName.get(hashTok.text);
    const node: DirectiveNode = {
      kind: "directive",
      hash: hashIdx,
      def,
      args: [],
      firstToken: hashIdx,
      lastToken: hashIdx,
      span: this.span(hashIdx, hashIdx),
    };

    // Push BEFORE consuming args: assembly failures (RMS0208/0209) push
    // their RawNode as a following sibling, and item order must stay
    // monotone in token position (found by the fuzz suite).
    this.currentItems().push(node);

    if (!def) {
      this.diagnostics.push(d.unknownDirective(hashTok));
      return;
    }

    node.args = this.consumeArgs(def.arguments ?? [], hashTok, def.verified, /*quoteAssembly*/ true);
    if (node.args.length > 0) this.extend(node, node.args[node.args.length - 1].lastToken);

    // Quoted-path bookkeeping + RMS0211 (§5.2).
    const firstArg = node.args[0];
    const quoted = firstArg !== undefined && this.tokens[firstArg.firstToken].text.startsWith('"');
    if (quoted && hashTok.text === "#includeXS") {
      this.diagnostics.push(d.includeXsQuoted(hashTok));
    }
    if ((hashTok.text === "#include_drs" || hashTok.text === "#includeXS") && firstArg !== undefined) {
      this.includes.push({ directiveToken: hashIdx, path: String(firstArg.value), quoted });
    }

    // Symbol table (§7).
    if (hashTok.text === "#define" && firstArg !== undefined) {
      this.symbols.push({
        name: this.tokens[firstArg.firstToken].text,
        directiveKind: "define",
        nameToken: firstArg.firstToken,
        conditionalDepth: this.conditionalDepth(),
      });
    } else if (hashTok.text === "#const" && firstArg !== undefined) {
      this.symbols.push({
        name: this.tokens[firstArg.firstToken].text,
        directiveKind: "const",
        nameToken: firstArg.firstToken,
        valueToken: node.args[1]?.firstToken,
        conditionalDepth: this.conditionalDepth(),
      });
    } else if (hashTok.text === "#undefine" && firstArg !== undefined) {
      // #undefine does NOTHING in-engine (§7) — record the attempt only.
      const name = this.tokens[firstArg.firstToken].text;
      for (let i = this.symbols.length - 1; i >= 0; i--) {
        if (this.symbols[i].name === name) {
          this.symbols[i].undefineAttempted = true;
          break;
        }
      }
    }
  }

  // ---- §5.1 item 3: control keywords ---------------------------------------

  handleControlKeyword(text: string): void {
    const tokPos = this.p;
    const tokIdx = this.nt[tokPos];
    const tok = this.tokens[tokIdx];

    switch (text) {
      case "if": {
        this.flushRun();
        if (this.constructDepth() >= this.maxNesting) {
          this.degradeTooDeep();
          return;
        }
        this.p++;
        const condition = this.consumeCondition(tok);
        const node: IfNode = {
          kind: "if",
          branches: [{ keyword: tokIdx, condition, items: [] }],
          firstToken: tokIdx,
          lastToken: condition ?? tokIdx,
          span: this.span(tokIdx, condition ?? tokIdx),
        };
        this.currentItems().push(node);
        this.frames.push({ type: "if", node });
        return;
      }
      case "elseif":
      case "else": {
        const ifPos = this.nearestFrame("if");
        if (ifPos === -1) {
          this.diagnostics.push(d.wrongContextKeyword(tok, "has no matching if — it's ignored."));
          this.runPush(this.p, true);
          this.p++;
          return;
        }
        if (ifPos !== this.frames.length - 1) {
          this.degrade(ifPos, "conditional-splits-structure", "RMS0110");
          return;
        }
        this.flushRun();
        this.p++;
        const frame = this.frames[ifPos] as IfFrame;
        const condition = text === "elseif" ? this.consumeCondition(tok) : undefined;
        frame.node.branches.push({ keyword: tokIdx, condition, items: [] });
        this.extend(frame.node, condition ?? tokIdx);
        return;
      }
      case "endif": {
        const ifPos = this.nearestFrame("if");
        if (ifPos === -1) {
          this.diagnostics.push(d.wrongContextKeyword(tok, "has no matching if — it's ignored."));
          this.runPush(this.p, true);
          this.p++;
          return;
        }
        if (ifPos !== this.frames.length - 1) {
          this.degrade(ifPos, "conditional-splits-structure", "RMS0110");
          return;
        }
        this.flushRun();
        this.p++;
        const frame = this.frames.pop() as IfFrame;
        frame.node.endif = tokIdx;
        this.extend(frame.node, tokIdx);
        return;
      }
      case "start_random": {
        this.flushRun();
        if (this.constructDepth() >= this.maxNesting) {
          this.degradeTooDeep();
          return;
        }
        if (this.frames.some((f) => f.type === "random")) {
          this.diagnostics.push(d.nestedRandom(tok)); // still parsed structurally (lossless)
        }
        this.p++;
        const node: RandomNode = {
          kind: "random",
          start: tokIdx,
          preamble: [],
          branches: [],
          firstToken: tokIdx,
          lastToken: tokIdx,
          span: this.span(tokIdx, tokIdx),
        };
        this.currentItems().push(node);
        this.frames.push({ type: "random", node });
        return;
      }
      case "percent_chance": {
        const randPos = this.nearestFrame("random");
        if (randPos === -1) {
          this.diagnostics.push(d.wrongContextKeyword(tok, "belongs inside start_random ... end_random — it's ignored."));
          this.runPush(this.p, true);
          this.p++;
          return;
        }
        if (randPos !== this.frames.length - 1) {
          this.degrade(randPos, "conditional-splits-structure", "RMS0110");
          return;
        }
        this.flushRun();
        this.p++;
        const frame = this.frames[randPos] as RandomFrame;
        if (frame.node.branches.length === 0 && frame.node.preamble.length > 0) {
          const first = frame.node.preamble[0];
          const last = frame.node.preamble[frame.node.preamble.length - 1];
          this.diagnostics.push(d.randomPreamble(this.tokens[first.firstToken], this.tokens[last.lastToken]));
        }
        // Pinned exception (§5.1): percent_chance takes one numeric operand;
        // expression/rnd assembly are active in this slot. Data-driven
        // `arguments[]` on controlKeywords replaces this once §13 lands.
        const chanceArgs = this.consumeArgs(
          [{ name: "chance", type: "integer" }],
          tok,
          /*verified*/ true,
          /*quoteAssembly*/ false,
        );
        frame.node.branches.push({ chanceKeyword: tokIdx, chance: chanceArgs[0], items: [] });
        this.extend(frame.node, chanceArgs[0]?.lastToken ?? tokIdx);
        return;
      }
      case "end_random": {
        const randPos = this.nearestFrame("random");
        if (randPos === -1) {
          this.diagnostics.push(d.wrongContextKeyword(tok, "has no matching start_random — it's ignored."));
          this.runPush(this.p, true);
          this.p++;
          return;
        }
        if (randPos !== this.frames.length - 1) {
          this.degrade(randPos, "conditional-splits-structure", "RMS0110");
          return;
        }
        this.flushRun();
        this.p++;
        const frame = this.frames.pop() as RandomFrame;
        frame.node.end = tokIdx;
        this.extend(frame.node, tokIdx);
        return;
      }
      default: {
        // A control keyword in language.json we don't know structurally —
        // future-proofing; absorb.
        this.runPush(this.p);
        this.p++;
      }
    }
  }

  /** if/elseif condition: exactly one non-structural token (§5.1 pinned exception). */
  consumeCondition(keywordTok: Token): number | undefined {
    if (this.p >= this.nt.length) {
      this.diagnostics.push(d.wrongContextKeyword(keywordTok, "has no condition — the file ends here."));
      return undefined;
    }
    const tok = this.tokAt(this.p);
    const structural =
      tok.kind === "openBrace" ||
      tok.kind === "closeBrace" ||
      tok.kind === "sectionHeader" ||
      tok.kind === "directive" ||
      (tok.kind === "word" && this.lang.controlKeywords.has(tok.text));
    if (structural) {
      this.diagnostics.push(d.wrongContextKeyword(keywordTok, "has no condition — add a label after it, e.g. `if HUGE_MAP`."));
      return undefined;
    }
    const idx = this.nt[this.p];
    this.p++;
    return idx;
  }

  nearestFrame(type: "if" | "random"): number {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i].type === type) return i;
    }
    return -1;
  }

  constructDepth(): number {
    return this.frames.length;
  }

  // ---- §5.1 items 4-7: words, braces, values -------------------------------

  parseNamedOrRun(): void {
    const namePos = this.p;
    const nameIdx = this.nt[namePos];
    const nameTok = this.tokens[nameIdx];
    const inBlock = this.inBlockContext();

    // §4 pinned lookup order: block → attribute first; statement → command first.
    const asAttribute = this.lang.attributesByName.get(nameTok.text);
    const asCommand = this.lang.commandsByName.get(nameTok.text);
    const primary = inBlock ? asAttribute : asCommand;
    const crossCategory = inBlock ? asCommand : asAttribute;

    if (!primary && !crossCategory) {
      this.runPush(this.p);
      this.p++;
      return;
    }

    this.flushRun();

    if (!primary && crossCategory) {
      // Known name, wrong context (RMS0207) — parse as its actual category.
      this.emitWrongContext(nameTok, inBlock ? "command" : "attribute");
      if (inBlock) {
        this.parseCommand(nameIdx, crossCategory as CommandDef);
      } else {
        this.parseAttribute(nameIdx, crossCategory as AttributeDef);
      }
      return;
    }

    // Context-native (dual-use names resolve here silently — no RMS0207).
    if (inBlock) {
      this.parseAttribute(nameIdx, primary as AttributeDef);
    } else {
      this.parseCommand(nameIdx, primary as CommandDef);
    }
  }

  parseCommand(nameIdx: number, def: CommandDef | undefined): void {
    const nameTok = this.tokens[nameIdx];
    this.p++;
    const node: CommandNode = {
      kind: "command",
      name: nameIdx,
      def,
      args: [],
      firstToken: nameIdx,
      lastToken: nameIdx,
      span: this.span(nameIdx, nameIdx),
    };
    // Push before consuming args (assembly-failure RawNodes must follow, not precede).
    this.currentItems().push(node);
    node.args = this.consumeArgs(def?.arguments ?? [], nameTok, def?.verified ?? true, false);
    if (node.args.length > 0) this.extend(node, node.args[node.args.length - 1].lastToken);

    // Attached block (§5.1 item 4): next token is { and def says block (or unknown).
    const blockCapable = def === undefined || def.kind === "block";
    if (blockCapable && this.p < this.nt.length && this.tokAt(this.p).kind === "openBrace") {
      this.openBlockFrame(node);
    }
  }

  parseAttribute(nameIdx: number, def: AttributeDef | undefined): void {
    const nameTok = this.tokens[nameIdx];
    this.p++;
    const node: AttributeNode = {
      kind: "attribute",
      name: nameIdx,
      def,
      args: [],
      firstToken: nameIdx,
      lastToken: nameIdx,
      span: this.span(nameIdx, nameIdx),
    };
    // Push before consuming args (assembly-failure RawNodes must follow, not precede).
    this.currentItems().push(node);
    node.args = this.consumeArgs(def?.arguments ?? [], nameTok, def?.verified ?? true, false);
    if (node.args.length > 0) this.extend(node, node.args[node.args.length - 1].lastToken);
  }

  openBlockFrame(owner: CommandNode | OrphanBlockNode): void {
    const openIdx = this.nt[this.p];
    if (this.constructDepth() >= this.maxNesting) {
      this.degradeTooDeep();
      return;
    }
    this.p++;
    const block: BlockNode = {
      kind: "block",
      open: openIdx,
      items: [],
      firstToken: openIdx,
      lastToken: openIdx,
      span: this.span(openIdx, openIdx),
    };
    owner.block = block;
    this.frames.push({ type: "block", node: block, owner, suspect: false, wrongContextCount: 0 });
  }

  handleOpenBrace(): void {
    // Depth cap first — none of the §5.4 paths may open a frame past it.
    if (this.constructDepth() >= this.maxNesting) {
      this.degradeTooDeep();
      return;
    }
    // §5.4, in pinned order: unknown-run upgrade → shared block → plain orphan.
    const openTok = this.tokAt(this.p);

    // (a) Unknown word(s) followed by { — upgrade the run to an unknown command.
    if (this.pendingRun.length > 0 && this.tokAt(this.pendingRun[0]).kind === "word") {
      const runPositions = this.pendingRun;
      this.pendingRun = [];
      const nameIdx = this.nt[runPositions[0]];
      const nameTok = this.tokens[nameIdx];
      const context = this.inBlockContext() ? "attribute" : "command";
      this.diagnostics.push(d.unknownName(nameTok, context, this.didYouMean(nameTok.text, context)));
      const node: CommandNode = {
        kind: "command",
        name: nameIdx,
        def: undefined,
        args: runPositions.slice(1).map((pos) => this.defLessArg(this.nt[pos])),
        firstToken: nameIdx,
        lastToken: this.nt[runPositions[runPositions.length - 1]],
        span: this.span(nameIdx, this.nt[runPositions[runPositions.length - 1]]),
      };
      this.currentItems().push(node);
      this.openBlockFrame(node);
      return;
    }

    this.flushRun();

    // (b) Shared-block rule (rev 5 — guide Example2's path): { right after a
    // just-completed if/random whose branch tails are block-capable commands.
    const items = this.currentItems();
    const last = items[items.length - 1];
    if (last !== undefined && (last.kind === "if" || last.kind === "random") && this.hasBlockCapableTail(last)) {
      this.diagnostics.push(d.sharedBlock(openTok));
      const orphan = this.makeOrphan();
      items.push(orphan);
      this.openBlockFrame(orphan);
      return;
    }

    // (c) Plain orphan (RMS0102).
    this.diagnostics.push(d.orphanBlock(openTok));
    const orphan = this.makeOrphan();
    this.currentItems().push(orphan);
    this.openBlockFrame(orphan);
  }

  makeOrphan(): OrphanBlockNode {
    const openIdx = this.nt[this.p];
    return {
      kind: "orphanBlock",
      // block is attached by openBlockFrame; placeholder satisfies the type
      block: undefined as unknown as BlockNode,
      firstToken: openIdx,
      lastToken: openIdx,
      span: this.span(openIdx, openIdx),
    };
  }

  hasBlockCapableTail(node: IfNode | RandomNode): boolean {
    const branches = node.kind === "if" ? node.branches : node.branches;
    for (const branch of branches) {
      const tail = branch.items[branch.items.length - 1];
      if (tail !== undefined && tail.kind === "command" && tail.block === undefined) {
        if (tail.def === undefined || tail.def.kind === "block") return true;
      }
    }
    return false;
  }

  defLessArg(tokenIdx: number): ArgNode {
    const tok = this.tokens[tokenIdx];
    let value: ArgValue = tok.text;
    if (tok.kind === "number") value = Number(tok.text);
    else if (tok.kind === "rnd") value = parseRndValue(tok.text) ?? tok.text;
    return { value, firstToken: tokenIdx, lastToken: tokenIdx, span: this.span(tokenIdx, tokenIdx) };
  }

  handleCloseBrace(): void {
    const top = this.frames[this.frames.length - 1];
    if (top !== undefined && top.type === "block") {
      this.flushRun();
      const closeIdx = this.nt[this.p];
      this.p++;
      this.closeBlockFrame(top, closeIdx);
      this.frames.pop();
      return;
    }
    // } while an if/random is on top: mirror imbalance IF a block frame
    // exists deeper (§5.3); otherwise a plain stray } (RMS0104, absorbed).
    if (top !== undefined && (top.type === "if" || top.type === "random")) {
      let blockPos = -1;
      for (let i = this.frames.length - 1; i >= 0; i--) {
        if (this.frames[i].type === "block") {
          blockPos = i;
          break;
        }
      }
      if (blockPos !== -1) {
        this.degrade(blockPos, "conditional-splits-structure", "RMS0110");
        return;
      }
    }
    this.diagnostics.push(d.strayCloseBrace(this.tokAt(this.p)));
    this.runPush(this.p, true);
    this.p++;
  }

  closeBlockFrame(frame: BlockFrame, closeIdx: number | undefined): void {
    const block = frame.node;
    block.close = closeIdx;
    const lastIdx =
      closeIdx ??
      (block.items.length > 0 ? block.items[block.items.length - 1].lastToken : block.open);
    this.extend(block, lastIdx);
    this.extend(frame.owner, lastIdx);
    // RMS0207 cascade summary (§5.1): one glued brace ≠ fifty warnings.
    if (frame.wrongContextCount > 1) {
      const lastTok = this.tokens[lastIdx];
      this.diagnostics.push(d.wrongContext(lastTok, "command", frame.wrongContextCount - 1));
    }
  }

  emitWrongContext(tok: Token, is: "command" | "attribute"): void {
    // Suppression only applies inside suspect blocks (glued-brace cascade,
    // §5.1): suspect = an RMS0003-flagged token lies between this block's
    // opening brace and the current token.
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frames[i];
      if (f.type === "block") {
        if (!f.suspect && this.rms0003Starts.size > 0) {
          const openStart = this.tokens[f.node.open].start;
          for (const s of this.rms0003Starts) {
            if (s > openStart && s < tok.start) {
              f.suspect = true;
              break;
            }
          }
        }
        if (f.suspect) {
          f.wrongContextCount++;
          if (f.wrongContextCount > 1) return; // suppressed; summarized at close
        }
        break;
      }
    }
    this.diagnostics.push(d.wrongContext(tok, is));
  }

  // ---- §6: argument consumption --------------------------------------------

  consumeArgs(argDefs: ArgumentDef[], nameTok: Token, verified: boolean, quoteAssembly: boolean): ArgNode[] {
    const unverified = !verified;
    const args: ArgNode[] = [];
    for (let i = 0; i < argDefs.length; i++) {
      const argDef = argDefs[i];
      const stopped = this.stopSetAt(this.p);
      if (stopped) {
        if (!argDef.optional) {
          this.diagnostics.push(d.tooFewArguments(nameTok, argDefs.length, args.length, unverified));
        }
        break;
      }
      const arg = this.consumeOneArg(argDef, unverified, quoteAssembly);
      if (arg === undefined) {
        // Assembly failure already produced RMS0208/0209 + a RawNode.
        this.diagnostics.push(d.tooFewArguments(nameTok, argDefs.length, args.length, unverified));
        break;
      }
      args.push(arg);
      if (argDef.variadic) {
        while (!this.stopSetAt(this.p)) {
          const more = this.consumeOneArg(argDef, unverified, quoteAssembly);
          if (more === undefined) break;
          args.push(more);
        }
      }
    }
    return args;
  }

  /** True when the token at nt-position `pos` must never be consumed as an argument. */
  stopSetAt(pos: number): boolean {
    if (pos >= this.nt.length) return true;
    const tok = this.tokAt(pos);
    if (
      tok.kind === "openBrace" ||
      tok.kind === "closeBrace" ||
      tok.kind === "sectionHeader" ||
      tok.kind === "directive"
    ) {
      return true;
    }
    if (tok.kind === "word") {
      if (this.lang.controlKeywords.has(tok.text)) return true;
      // Context-symmetric known-name stop (rev 4): any known command OR
      // attribute name, in either context.
      if (this.lang.knownNames.has(tok.text)) return true;
    }
    return false;
  }

  consumeOneArg(argDef: ArgumentDef, unverified: boolean, quoteAssembly: boolean): ArgNode | undefined {
    const tok = this.tokAt(this.p);
    if (tok.text.startsWith("(")) {
      return this.assembleExpression(argDef);
    }
    if (quoteAssembly && argDef.type === "string" && tok.text.startsWith('"')) {
      return this.assembleQuote(argDef);
    }

    const tokenIdx = this.nt[this.p];
    this.p++;
    const numericSlot = NUMERIC_ARGUMENT_TYPES.has(argDef.type);
    let value: ArgValue = tok.text;

    if (tok.kind === "number") {
      value = Number(tok.text);
      if (argDef.min !== undefined && (value as number) < argDef.min) {
        this.diagnostics.push(d.argOutOfRange(tok, argDef, unverified));
      } else if (argDef.max !== undefined && (value as number) > argDef.max) {
        this.diagnostics.push(d.argOutOfRange(tok, argDef, unverified));
      } else if (
        argDef.cautionBelow !== undefined &&
        argDef.cautionMessage !== undefined &&
        (value as number) < argDef.cautionBelow
      ) {
        // Not a range violation (checked above) — a value that's valid RMS
        // but that reference data flags as worth a second look (RMS0217).
        this.diagnostics.push(d.valueCaution(tok, argDef.cautionMessage));
      }
    } else if (tok.kind === "rnd") {
      const rnd = parseRndValue(tok.text);
      value = rnd ?? tok.text;
    } else if (tok.kind === "word") {
      if (numericSlot) {
        if (tok.text === "inf") value = Infinity;
        else if (tok.text === "-inf") value = -Infinity;
        else if (tok.text.startsWith("rnd(")) {
          this.diagnostics.push(d.malformedRnd(tok)); // RMS0214 instead of a baffling 0202
        } else if (/^\d/.test(tok.text)) {
          this.diagnostics.push(d.digitPrefixedWord(tok)); // RMS0212 — numeric slots ONLY (rev 5)
        } else {
          this.diagnostics.push(d.argTypeMismatch(tok, argDef, unverified));
        }
      }
      // Constant/string slots accept words (and numbers) freely — §2.1(1).
    } else {
      this.diagnostics.push(d.argTypeMismatch(tok, argDef, unverified));
    }

    return { value, def: argDef, firstToken: tokenIdx, lastToken: tokenIdx, span: this.span(tokenIdx, tokenIdx) };
  }

  /**
   * §2.2 expression assembly. Terminator rule (pinned): first token whose
   * text ends with ")" regardless of kind — EXCEPT canonical rnd tokens,
   * which never terminate. Break-outs (structural/control/EOF/cap) degrade
   * the collected tokens to a RawNode with RMS0208.
   */
  assembleExpression(argDef: ArgumentDef): ArgNode | undefined {
    const startPos = this.p;
    const collected: number[] = [this.nt[this.p]];
    const opener = this.tokAt(this.p);
    this.p++;

    let terminated = opener.text.length > 1 && opener.text.endsWith(")");
    while (!terminated) {
      if (this.p >= this.nt.length || collected.length >= ASSEMBLY_CAP) {
        return this.failAssembly(startPos, "unclosed-expression");
      }
      const tok = this.tokAt(this.p);
      const breakout =
        tok.kind === "openBrace" ||
        tok.kind === "closeBrace" ||
        tok.kind === "sectionHeader" ||
        tok.kind === "directive" ||
        (tok.kind === "word" && this.lang.controlKeywords.has(tok.text));
      if (breakout) {
        return this.failAssembly(startPos, "unclosed-expression");
      }
      collected.push(this.nt[this.p]);
      this.p++;
      if (tok.kind !== "rnd" && tok.text.endsWith(")")) terminated = true;
    }

    const firstIdx = collected[0];
    const lastIdx = collected[collected.length - 1];
    const exprSpan = this.span(firstIdx, lastIdx);

    // Guide-verified lints (RMS0210).
    if (opener.text === "(") this.diagnostics.push(d.expressionLint("ungluedOperand", exprSpan));
    const terminator = this.tokens[lastIdx];
    if (collected.length > 1 && terminator.text === ")") {
      this.diagnostics.push(d.expressionLint("ungluedOperand", exprSpan));
    }
    for (let i = 0; i < collected.length; i++) {
      const t = this.tokens[collected[i]];
      if (i > 0 && t.text.startsWith("(")) {
        this.diagnostics.push(d.expressionLint("nestedParen", { start: t.start, end: t.end }));
      }
      if (t.kind === "rnd" || t.text.startsWith("rnd(")) {
        this.diagnostics.push(d.expressionLint("rndInside", { start: t.start, end: t.end }));
      }
      if (t.kind === "word" || t.kind === "number") {
        const core = t.text.replace(/^\(+/, "").replace(/\)+$/, "");
        if (!/^[+\-*/%]$/.test(core) && /[+*/%]/.test(core) && !core.startsWith("rnd(")) {
          this.diagnostics.push(d.expressionLint("gluedOperator", { start: t.start, end: t.end }));
        }
      }
    }
    // Comment-inside check (rev 5): any trivia token in the FULL token
    // array between the expression's first and last token.
    for (let i = firstIdx + 1; i < lastIdx; i++) {
      if (this.tokens[i].isTrivia) {
        this.diagnostics.push(d.expressionLint("commentInside", exprSpan));
        break;
      }
    }

    return {
      value: { expr: { tokens: collected } },
      def: argDef,
      firstToken: firstIdx,
      lastToken: lastIdx,
      span: exprSpan,
    };
  }

  /** §5.2 quote assembly for filename-typed directive args. */
  assembleQuote(argDef: ArgumentDef): ArgNode | undefined {
    const startPos = this.p;
    const collected: number[] = [this.nt[this.p]];
    const opener = this.tokAt(this.p);
    this.p++;

    let terminated = opener.text.length > 1 && opener.text.endsWith('"');
    while (!terminated) {
      if (this.p >= this.nt.length || collected.length >= ASSEMBLY_CAP) {
        return this.failAssembly(startPos, "unclosed-quote");
      }
      const tok = this.tokAt(this.p);
      const breakout =
        tok.kind === "openBrace" ||
        tok.kind === "closeBrace" ||
        tok.kind === "sectionHeader" ||
        tok.kind === "directive" ||
        (tok.kind === "word" && this.lang.controlKeywords.has(tok.text));
      if (breakout) {
        return this.failAssembly(startPos, "unclosed-quote");
      }
      collected.push(this.nt[this.p]);
      this.p++;
      if (tok.text.endsWith('"')) terminated = true;
    }

    const firstIdx = collected[0];
    const lastIdx = collected[collected.length - 1];
    const text = collected.map((i) => this.tokens[i].text).join(" ");
    const path = text.replace(/^"/, "").replace(/"$/, "");
    return { value: path, def: argDef, firstToken: firstIdx, lastToken: lastIdx, span: this.span(firstIdx, lastIdx) };
  }

  /** Shared failure path for expression/quote assembly: RawNode + diagnostic. */
  failAssembly(startPos: number, reason: "unclosed-expression" | "unclosed-quote"): undefined {
    const firstIdx = this.nt[startPos];
    const lastIdx = this.nt[Math.max(startPos, this.p - 1)];
    const raw: RawNode = {
      kind: "raw",
      reason,
      firstToken: firstIdx,
      lastToken: lastIdx,
      span: this.span(firstIdx, lastIdx),
    };
    this.currentItems().push(raw);
    if (reason === "unclosed-expression") {
      this.diagnostics.push(d.unclosedExpression(this.tokens[firstIdx], this.tokens[lastIdx]));
    } else {
      this.diagnostics.push(d.unclosedQuote(this.tokens[firstIdx], this.tokens[lastIdx]));
    }
    return undefined;
  }

  // ---- §5.3: degradation ----------------------------------------------------

  /**
   * Wrap everything from the outermost involved frame (stack index
   * `outermostIdx`) through the forward-scanned closers into ONE RawNode.
   * The trigger token at this.p has NOT been consumed yet.
   */
  degrade(outermostIdx: number, reason: string, code: "RMS0110" | "RMS0107"): void {
    this.flushRun();

    // Count what's still open among the involved frames.
    let openBraces = 0;
    let openConds = 0;
    for (let i = outermostIdx; i < this.frames.length; i++) {
      const f = this.frames[i];
      if (f.type === "block") openBraces++;
      else openConds++;
    }

    // Range start: outermost involved construct — including the statement
    // owning an involved block (spec §5.3).
    const outermost = this.frames[outermostIdx];
    const rangeStartToken =
      outermost.type === "block" ? outermost.owner.firstToken : outermost.node.firstToken;

    // The parent that will receive the RawNode.
    const parentItems = this.itemsBelowFrame(outermostIdx);

    // Pop involved frames; their nodes get discarded from parentItems below.
    this.frames.length = outermostIdx;

    // Remove the (partial) involved nodes from the parent list.
    while (parentItems.length > 0 && parentItems[parentItems.length - 1].firstToken >= rangeStartToken) {
      parentItems.pop();
    }

    // Forward scan (rev 5): consume until every involved construct closes,
    // bounded by section header (while braces remain open) / EOF.
    let lastConsumedNt = this.p - 1;
    let sawUnfinishedAtEof = false;
    while (openBraces > 0 || openConds > 0) {
      if (this.p >= this.nt.length) {
        sawUnfinishedAtEof = true;
        break;
      }
      const tok = this.tokAt(this.p);
      if (tok.kind === "sectionHeader") {
        if (openBraces > 0) {
          // RMS0103 semantics: a block may not span a section header.
          this.diagnostics.push(d.sectionHeaderInBlock(tok, this.tokens[rangeStartToken]));
          break;
        }
        // Only conditionals open → legal spanning; absorb the header.
        lastConsumedNt = this.p;
        this.p++;
        continue;
      }
      if (tok.kind === "openBrace") openBraces++;
      else if (tok.kind === "closeBrace") openBraces = Math.max(0, openBraces - 1);
      else if (tok.kind === "word" && (tok.text === "if" || tok.text === "start_random")) openConds++;
      else if (tok.kind === "word" && (tok.text === "endif" || tok.text === "end_random")) {
        openConds = Math.max(0, openConds - 1);
      }
      lastConsumedNt = this.p;
      this.p++;
    }
    if (sawUnfinishedAtEof) {
      const startTok = this.tokens[rangeStartToken];
      if (openConds > 0) this.diagnostics.push(d.unclosedConditionalAtEof(startTok));
      if (openBraces > 0) this.diagnostics.push(d.unclosedBraceAtEof(startTok));
    }

    const rangeEndToken = lastConsumedNt >= 0 ? this.nt[lastConsumedNt] : rangeStartToken;
    const endToken = Math.max(rangeStartToken, rangeEndToken);
    const raw: RawNode = {
      kind: "raw",
      reason,
      firstToken: rangeStartToken,
      lastToken: endToken,
      span: this.span(rangeStartToken, endToken),
    };
    parentItems.push(raw);
    if (code === "RMS0110") {
      // When the raw region runs all the way to EOF because an if/random
      // never closed, say so directly in THIS diagnostic — its span
      // covers the whole degraded region (often most of the file), while
      // the separate unclosedConditionalAtEof (RMS0105) above only spans
      // the single opening keyword and is easy to miss underneath it.
      this.diagnostics.push(
        d.degradedToRaw(this.tokens[rangeStartToken], this.tokens[endToken], sawUnfinishedAtEof && openConds > 0),
      );
    } else {
      this.diagnostics.push(d.nestingTooDeep(this.tokens[rangeStartToken], this.maxNesting));
    }
  }

  /** Item list of the container just below stack index `idx`. */
  itemsBelowFrame(idx: number): Item[] {
    const below = this.frames[idx - 1];
    if (!below) return this.currentSection ? this.currentSection.items : this.script.preamble;
    if (below.type === "block") return below.node.items;
    if (below.type === "if") return below.node.branches[below.node.branches.length - 1].items;
    return below.node.branches.length > 0
      ? below.node.branches[below.node.branches.length - 1].items
      : below.node.preamble;
  }

  /** §5.0: opening one more construct would exceed the cap — degrade it. */
  degradeTooDeep(): void {
    // Treat the would-be construct as a zero-frame §5.3 range starting at
    // the opener token; forward-scan its own body.
    const openerNt = this.p;
    const openerIdx = this.nt[openerNt];
    const openerTok = this.tokens[openerIdx];
    this.flushRun();
    this.p++;

    let openBraces = openerTok.kind === "openBrace" ? 1 : 0;
    let openConds = openerTok.kind === "openBrace" ? 0 : 1;
    let lastConsumedNt = openerNt;
    while (openBraces > 0 || openConds > 0) {
      if (this.p >= this.nt.length) break;
      const tok = this.tokAt(this.p);
      if (tok.kind === "sectionHeader" && openBraces > 0) break;
      if (tok.kind === "openBrace") openBraces++;
      else if (tok.kind === "closeBrace") openBraces = Math.max(0, openBraces - 1);
      else if (tok.kind === "word" && (tok.text === "if" || tok.text === "start_random")) openConds++;
      else if (tok.kind === "word" && (tok.text === "endif" || tok.text === "end_random")) {
        openConds = Math.max(0, openConds - 1);
      }
      lastConsumedNt = this.p;
      this.p++;
    }
    const endToken = this.nt[lastConsumedNt];
    const raw: RawNode = {
      kind: "raw",
      reason: "nesting-too-deep",
      firstToken: openerIdx,
      lastToken: endToken,
      span: this.span(openerIdx, endToken),
    };
    this.currentItems().push(raw);
    this.diagnostics.push(d.nestingTooDeep(openerTok, this.maxNesting));
  }

  // ---- EOF (§5.2) -----------------------------------------------------------

  finishAtEof(): void {
    this.flushRun();
    const lastTokenIdx = this.nt.length > 0 ? this.nt[this.nt.length - 1] : 0;
    while (this.frames.length > 0) {
      const frame = this.frames.pop() as Frame;
      if (frame.type === "block") {
        this.diagnostics.push(d.unclosedBraceAtEof(this.tokens[frame.node.open]));
        this.closeBlockFrame(frame, undefined);
        this.extend(frame.node, lastTokenIdx);
        this.extend(frame.owner, lastTokenIdx);
      } else {
        const openTok =
          frame.type === "if" ? this.tokens[frame.node.branches[0].keyword] : this.tokens[frame.node.start];
        this.diagnostics.push(d.unclosedConditionalAtEof(openTok));
        this.extend(frame.node, lastTokenIdx);
      }
    }
    if (this.currentSection && this.currentSection.items.length > 0) {
      const items = this.currentSection.items;
      this.extend(this.currentSection, items[items.length - 1].lastToken);
    }
    for (const section of this.script.sections) {
      if (section.items.length > 0) {
        this.extend(section, section.items[section.items.length - 1].lastToken);
      }
    }
  }
}

function parseRndValue(text: string): { rnd: [number, number] } | undefined {
  const m = /^rnd\((-?\d+),(-?\d+)\)$/.exec(text);
  if (!m) return undefined;
  return { rnd: [Number(m[1]), Number(m[2])] };
}

/** Banded Levenshtein with early exit above `cap`. */
function editDistanceCapped(a: string, b: string, cap: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[lb] <= cap ? prev[lb] : cap + 1;
}

/**
 * Parse an AoE2:DE random map script. Pure function — no I/O, never throws
 * (docs/parser-design.md goal #1). See ParseResult for what you get back.
 */
export function parseRms(source: string, langData: LanguageData, opts: ParseOptions = {}): ParseResult {
  const parser = new Parser(source, langData, opts);
  parser.parse();
  return {
    source,
    tokens: parser.tokens,
    lineOffsets: parser.lineOffsets,
    script: parser.script,
    symbols: parser.symbols,
    includes: parser.includes,
    diagnostics: parser.diagnostics,
  };
}
