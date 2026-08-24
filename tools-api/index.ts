/**
 * Advanced Tools API — THE CONTRACT.
 *
 * Spec: docs/tools-api-design.md (rev 10). Section numbers below are that doc's.
 *
 * One contract, two transports (Sec.1 goal 1): built-in tools implement
 * `ToolImplementation` in-process; v1.1 external tools speak the identical
 * messages as NDJSON over stdin/stdout. The host cannot tell them apart above
 * the transport layer.
 *
 * IMPORT RULE (Sec.8): type-only imports from src/parser are allowed and real.
 * What is forbidden is a RUNTIME import — nothing executable crosses in — so
 * the published artifact can be a bundled .d.ts that flattens the parser types
 * in. That is possible precisely because they are plain-data interfaces.
 * The one runtime export here (`numeric`) is app-side convenience for built-ins
 * and is NOT part of the published .d.ts.
 */

import type { ArgumentDef, AttributeDef, CommandDef, DirectiveDef, LanguageData } from "../src/parser/language";
import type { NoDefs, ParseResult, Span } from "../src/parser/types";
import type { PublishedGameConstant, PublishedGameConstants } from "./generated/gameConstants";

export type { Span };

/**
 * Generated from reference/schemas/game-constants.schema.json (Sec.2), NOT
 * written here. The hand-written placeholder this replaces compiled fine on the
 * day the schema gained a field, which is the one property the type is for —
 * `npm run check:generated-types` is what goes red instead, and CI runs it.
 *
 * Re-exported so the published surface stays one import for a tool author.
 */
export type { PublishedGameConstant, PublishedGameConstants };

/** Bump on a breaking protocol change; the host REJECTS a mismatch (Sec.10). */
export const TOOLS_API_VERSION = 1;

// ---------------------------------------------------------------------------
// The wire form of a parse (Sec.4)
// ---------------------------------------------------------------------------

/**
 * `±Infinity` as JSON can carry it. `JSON.stringify(Infinity)` is `null`, which
 * is silent AST corruption for any script using `inf` — and the words are not
 * the only source: `Number("9".repeat(400))` reaches `ArgValue` as `Infinity`
 * through an ordinary number token.
 *
 * EXTERNAL WIRE ONLY (Sec.4). Built-ins receive the real `ParseResult` with
 * real `Infinity`. Encoding for both transports makes the flagship tool's own
 * first line uncompilable — `generatePreview` takes a `ParseResult`, of which
 * the serialized form is a supertype — and at runtime every numeric read in the
 * generator is guarded by `typeof v === "number"`, so a sentinel in any of those
 * slots takes the unresolved branch and the value disappears.
 */
export interface InfSentinel {
  inf: 1 | -1;
}

/** A numeric slot as it arrives over the external wire. */
export type WireNumber = number | InfSentinel;

/**
 * The published parse type.
 *
 * It differs from the in-process `ParseResult` in whichever direction makes the
 * difference a COMPILE ERROR, and that is not always "wider" (Sec.4):
 *
 *  - Numbers are WIDER: `number | InfSentinel` cannot be used as a number, so
 *    the decode is a compile error away.
 *  - Defs are UNREADABLE: every `def` slot is `unknown` (`NoDefs`), so
 *    `node.def?.name` is a compile error rather than a silent `undefined`.
 *    Leaving `def?: CommandDef` standing here is the trap — a portable tool
 *    writing it compiles, works in-process, and returns `undefined` for every
 *    node over the wire, which fails in the "your map is fine" direction.
 *
 * `ParseResult` stays assignable to this (arrays are covariant, `number` is a
 * subtype of the union, and anything is assignable to `unknown`), which is what
 * `ToolContext<ParseResult>` → `ToolContext` rests on. The two rejected
 * mechanisms — `def?: never` and a conditional mode parameter — are written up
 * in src/parser/types.ts, and the property is pinned by
 * src/parser/__tests__/wireTypes.test-d.ts.
 */
export type SerializedParseResult = ParseResult<WireNumber, NoDefs>;

/**
 * Decode one numeric slot. The identity on a plain number, which is what lets a
 * tool written against the published type run correctly on BOTH transports
 * without knowing which it got.
 *
 * PROTOCOL.md documents the encoding and each language reimplements this in
 * three lines (Sec.4) — this export is in-repo convenience, not the contract.
 */
export function numeric(value: WireNumber): number {
  return typeof value === "number" ? value : value.inf === 1 ? Infinity : -Infinity;
}

// ---------------------------------------------------------------------------
// Manifest and parameters (Sec.2)
// ---------------------------------------------------------------------------

export type Capability =
  | "read-source"
  | "read-ast"
  /**
   * NOT "read-settings", and the name is not a quibble — it is a consent-dialog
   * string in v1.1. One settings.json holds several unrelated families (help,
   * generation, side-panel layout, app display, the Open dialog's last-used
   * folder) and this capability carries only the generation one. Deliberately
   * described as a list rather than a count: the count has to be re-dated every
   * time the store grows and the argument never needed it.
   */
  | "read-generation-settings"
  /**
   * language.json + game-constants.json IN FULL — a ~1.37 MB constant term on
   * every run that declares it (Sec.4.2 rule 2).
   *
   * `read-ast` alone is NOT sufficient to know what a COMMAND IS: the wire
   * strips `def`, and a command's identity can come from the script's own
   * `#const` table via `CommandDef.tokenId`, which lives in language.json. So a
   * tool that resolves commands at all needs this, not merely one that "needs
   * defs".
   */
  | "read-reference"
  | "read-selection"
  | "edit-source";

/**
 * read-ast IMPLIES read-source, and that is why stripping `source` would be
 * wrong rather than merely unhelpful: `ParseResult` inherently contains the
 * document, and even without `source`, `tokens[].text` holds every
 * non-whitespace character. Stripping it would be security theater.
 */
export const IMPLIED_CAPABILITIES: Readonly<Partial<Record<Capability, readonly Capability[]>>> = Object.freeze({
  "read-ast": Object.freeze(["read-source"] as const),
});

interface ParamBase {
  key: string;
  label: string;
  help?: string;
}

/**
 * A discriminated union, so `{ type: "integer", default: "foo" }` is
 * unrepresentable. A `select` default must be one of its own options, and every
 * declared default must satisfy its own declared constraints — both checked at
 * REGISTRATION (Sec.5), which is where a `multiSelect` declaring `default: []`
 * alongside `minSelected: 1` gets caught before it ships a form that cannot be
 * submitted as authored.
 */
export type ToolParamDef =
  | (ParamBase & { type: "integer"; default: number; min?: number; max?: number })
  | (ParamBase & { type: "boolean"; default: boolean })
  | (ParamBase & { type: "text"; default: string })
  | (ParamBase & { type: "select"; default: string; options: ParamOption[] })
  /**
   * Exists because CREATION_PLAN 5.2 specifies the checker runs "across a
   * player-count matrix (2/4/6/8)", which none of the four above can express.
   * The workarounds are four booleans, or a text field every tool re-parses
   * itself, which throws away the host-side validation.
   */
  | (ParamBase & {
      type: "multiSelect";
      default: string[];
      options: ParamOption[];
      minSelected?: number;
      maxSelected?: number;
    });

export interface ParamOption {
  value: string;
  label: string;
}

export type ParamValue = number | boolean | string | string[];

export interface ToolManifest {
  /** Stable, kebab-case: "consistency-checker". */
  id: string;
  name: string;
  /** The tool's own semver, not the API's. */
  version: string;
  /** Must equal TOOLS_API_VERSION; the host rejects a mismatch. */
  apiVersion: number;
  description: string;
  /** Everything not declared is DENIED (Sec.6). */
  capabilities: Capability[];
  /** Run-configuration form, rendered by the host (Sec.5). */
  params?: ToolParamDef[];
  /**
   * The pane echoes `Run at {playerCount} players, {mapSize}` above every
   * tool's output, off the LIVE generation context, to keep a stale result
   * self-describing. That is wrong for a tool whose own report already states
   * the settings it ran at (5.2's consistency checker: a matrix of player
   * counts, not one) — the echo would both duplicate the tool's own header and
   * re-label a finished report with a setting it was never run at the moment
   * the live context changes. Set `true` to suppress the pane's echo; the tool
   * is then responsible for stating what it ran at, from its own run snapshot
   * rather than the live context (consistency-checker-design.md Sec.5.2).
   */
  ownsSettingsHeader?: boolean;
  // v1.1 external tools add: entry (executable + args), language, author, homepage.
}

// ---------------------------------------------------------------------------
// The context (Sec.2)
// ---------------------------------------------------------------------------

export interface ToolGenerationSettings {
  playerCount: number;
  /**
   * BOTH the display name and the resolved dimension. `name` is a plain string,
   * not the app's `MapSize` union, so external tools need no import; a built-in
   * re-narrows with generationSettingsConstants.ts's own `isMapSize` guard
   * rather than casting.
   *
   * `tiles` is the LOBBY dimension and a script can change it: `override_map_size`
   * replaces it, clamped to [36, 480], honoured only before the first land
   * command. A static check keyed on map area computes against the wrong grid on
   * every script that overrides, and fails QUIETLY, in the "your map is fine"
   * direction.
   */
  mapSize: { name: string; tiles: number };
  /**
   * Always length 8, indexed player - 1, INDEPENDENT of playerCount — entries at
   * index >= playerCount describe people who are NOT in the game and must be
   * ignored, team sizes included. 0 means un-teamed and is the engine's own
   * value for it (guide:1001), not a UI placeholder.
   *
   * These are NOT the numbers that appear in TEAMn_SIZEm / PLAYERx_TEAMy: those
   * are lobby order, derived by src/generationSettings/teamModel.ts's
   * canonicalisation. Plain number[] at the JSON boundary; a built-in re-narrows
   * with `isTeams`.
   */
  teams: number[];
}

/**
 * What a tool receives. Every field is gated on its capability; an undeclared
 * field is simply ABSENT.
 *
 * The parse-result form is a TYPE PARAMETER because it differs by transport.
 * The default is the wire form, so a tool authored against the published .d.ts
 * writes `ToolContext` and gets the widened, sentinel-carrying, def-less type.
 * A built-in receives `ToolContext<ParseResult>`.
 *
 * Deliberately absent: file paths, fs access, the preview pane's seed, and the
 * Current/Final cut point. The last two are view state; a tool that must
 * reproduce the pane exactly is a `read-preview-view` escalation, not a silent
 * widening of `read-generation-settings`. A tool wanting a fixed seed declares
 * an `integer` param, which the host validates and the output header echoes.
 */
export interface ToolContext<P extends SerializedParseResult = SerializedParseResult> {
  apiVersion: number;
  /** iff "read-source" */
  source?: string;
  /** iff "read-ast" */
  parseResult?: P;
  /** iff "read-generation-settings" */
  settings?: ToolGenerationSettings;
  /** iff "read-reference" */
  referenceData?: ToolReferenceData;
  /** iff "read-selection" */
  selection?: ToolSelection;
  /**
   * The value union includes string[] for multiSelect, and the widening lands
   * NOW rather than with v1.1: `params` is the type an external tool
   * deserializes its own run config into, so widening it after v1.1 manifests
   * exist hands every already-written tool a runtime surprise its compiler
   * promised was impossible.
   */
  params: Record<string, ParamValue>;
}

export interface ToolReferenceData {
  /**
   * Plain data, NOT a `LanguageIndex` — that is Maps and Sets and serialises to
   * `{}`. Every tool builds its own index: built-ins import
   * `buildLanguageIndex`, external tools reimplement it. PROTOCOL.md must say
   * so; it is one sentence that saves a session, and it has a second consumer
   * now that `commandsByTokenId` is what the alias recipe needs.
   */
  language: LanguageData;
  /** Generated from reference/schemas/game-constants.schema.json (Sec.2). */
  gameConstants: PublishedGameConstants;
}

/**
 * An offset ANCHOR, not a range. The Monaco editor instance exists only while
 * CodePane is mounted, and a tool runs from the Tools tab — so at run time
 * there is no mounted editor and no live selection range. What survives a tab
 * switch is `useSharedSelection`'s single nullable offset anchor, lifted to app
 * level precisely so it outlives the panes. `item` is the span of the `Item`
 * that hook already resolves. Absent entirely when the anchor is null.
 */
export interface ToolSelection {
  offset: number;
  item?: Span;
}

// ---------------------------------------------------------------------------
// Output (Sec.2)
// ---------------------------------------------------------------------------

/** Same shape as breakdown Sec.4.1. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

export interface ToolOutput {
  /** Declarative display — the pane renders these; tools render nothing. */
  blocks: OutputBlock[];
}

/**
 * `severity` and `table` carry optional SPANS because without them the flagship
 * tool cannot express its own prescribed output: a per-`create_object` table
 * whose every row a user wants to click. With bare `string[][]` there is
 * nowhere to hang a `Span`, so a 200-row table becomes 200 unlinked pairs.
 * `Diagnostic` already models this correctly one layer down.
 *
 * A span is an OFFSET. A location named in PROSE (`severity.text`, `text`,
 * `table.rows`) is a 1-based LINE NUMBER — an offset names a position no editor
 * displays, and this repo shipped exactly that defect to a release. Convert with
 * `lineNumberOfOffset` in-process, or `parseResult.lineOffsets` over the wire.
 */
export type OutputBlock =
  | { kind: "heading"; text: string }
  /** Plain text with \n; NO markdown or HTML in v1 (Sec.10). */
  | { kind: "text"; text: string }
  | { kind: "keyValue"; rows: [string, string][] }
  /** `rowSpans`, when present, must have exactly `rows.length` entries. */
  | { kind: "table"; columns: string[]; rows: string[][]; rowSpans?: (Span | null)[] }
  | { kind: "severity"; level: "info" | "warning" | "error"; text: string; span?: Span }
  /** Clickable — jumps the Code tab to span.start via useSharedSelection's anchor. */
  | { kind: "codeRef"; text: string; span: Span };

// ---------------------------------------------------------------------------
// Messages (Sec.4)
// ---------------------------------------------------------------------------

/**
 * Parameterised over the parse-result form, matching `ToolContext` itself
 * (consistency-checker-design.md Sec.4.3, Sec.7.2 item 4b). The default is
 * the wire form, so an external tool's own reading is unchanged.
 *
 * **This is not a style choice — the unparameterised form does not compile
 * for a worker-backed runner.** `HostMessage`'s payload is `ToolContext`,
 * which defaults to the WIRE form; a tool worker posting the in-process
 * `ToolContext<ParseResult>` into `tool.run()` needs `HostMessage<ParseResult>`
 * to type that without a cast. Verified against this repo's own
 * `tsconfig.json`: written unparameterised, a worker sketch built exactly
 * this way fails `TS2345` (`SerializedParseResult` is not assignable to
 * `ParseResult` — `WireNumber` is not `number`); parameterised, it is
 * `tsc --noEmit` EXIT 0. Do not close the gap with `context as
 * ToolContext<ParseResult>` instead — that is precisely the move
 * `previewBridge.ts` exists to refuse.
 */
export type HostMessage<P extends SerializedParseResult = SerializedParseResult> =
  | { type: "run"; context: ToolContext<P> }
  | { type: "cancel" };

export type ToolMessage =
  /** fraction ∈ [0,1]; omit for indeterminate. */
  | { type: "progress"; fraction?: number; note?: string }
  /** Replaces the pane's output area. A full self-contained output, never a delta. */
  | { type: "partial"; output: ToolOutput }
  | { type: "result"; output: ToolOutput; edits?: TextEdit[] }
  | { type: "error"; message: string; reason: ErrorReason };

/**
 * `cancelled` and `killed` are DISTINCT, and collapsing them throws away the
 * only signal that a tool is misbehaving — the user would see the same thing
 * whether their Cancel worked or the host had to SIGKILL.
 *
 * The pane renders every reason as `severity: error`; only `killed` and
 * `unresponsive` mean "this tool did not behave", and only they should ever be
 * counted anywhere. `host-error` is never counted against a tool at all.
 */
export type ErrorReason =
  /** The tool said so, or threw, or crashed. */
  | "tool-error"
  /** The user cancelled and the tool honoured it. */
  | "cancelled"
  /** The tool did not honour a cancel and was killed. */
  | "killed"
  /** No message for the watchdog interval; the tool never chunked. */
  | "unresponsive"
  /** The tool emitted something that is not a valid ToolMessage. */
  | "protocol"
  /**
   * The host could not build or send this run's context — an outbound `run`
   * over the cap, or the serializer refusing a prohibited value. Every other
   * member blames the TOOL; reporting one of these as `tool-error` is a false
   * accusation and `protocol` points the wrong way down the wire.
   */
  | "host-error";

// ---------------------------------------------------------------------------
// Implementation surface (Sec.3)
// ---------------------------------------------------------------------------

export interface ToolRunHandle {
  cancel(): void;
}

export interface ToolImplementation {
  manifest: ToolManifest;
  /**
   * Returns IMMEDIATELY; all results flow through `emit`. A synchronous throw is
   * caught by the host and synthesized into an `error` terminal.
   *
   * A built-in receives the in-process context — real `ParseResult`, real
   * `Infinity`, no sentinels. A tool that wants to stay portable to v1.1
   * declares `run(ctx: ToolContext, …)` instead and reads numbers through
   * `numeric()`; `ToolContext<ParseResult>` is assignable to `ToolContext`, so
   * both compile.
   *
   * The context is READ-ONLY. In the worker case it is a structured-clone copy
   * for free; a main-thread built-in holds the live object and must treat every
   * field as frozen. Nothing in this contract licenses a tool to mutate it.
   */
  run(ctx: ToolContext<ParseResult>, emit: (msg: ToolMessage) => void): ToolRunHandle;
}

// ---------------------------------------------------------------------------
// Caps and deadlines (Sec.4.1, Sec.4.2) — all [tune], all stated so an
// implementer does not have to invent them.
// ---------------------------------------------------------------------------

export const LIMITS = Object.freeze({
  /** INBOUND (tool→host) NDJSON line. Exists to stop a hostile/broken child. */
  maxInboundLineBytes: 8 * 1024 * 1024,
  /**
   * OUTBOUND (host→tool) `run` message. Bounded by the PAYLOAD, not by a
   * constant chosen for symmetry: 25 of 32 corpus maps exceed 1 MB and 2 exceed
   * 8 MB, so the biggest map is the requirement rather than an outlier. Worst
   * measured case is ≈9.5 MB (a def-stripped parse plus ~1.37 MB of reference
   * data). Exceeding it is a host-side error NAMING THE SCRIPT, never a silent
   * truncation.
   */
  maxOutboundRunBytes: 32 * 1024 * 1024,
  maxBlocksPerOutput: 1000,
  /** Rendered rows; beyond this the pane shows "showing first N of M". */
  maxTableRowsRendered: 10_000,
  maxTextLengthPerBlock: 100_000,
  /** stderr from an external tool, as a ring buffer. */
  maxStderrBytes: 64 * 1024,
} as const);

/**
 * Both deadlines bound ONE generation at the largest reachable size, under
 * load, and that is the quantity to re-derive when either is next questioned.
 *
 * Derivation (Sec.4.1): one generation costs a median ~460 ms and up to 3.8 s at
 * Normal; the Giant penalty is 1.09–1.41×; this machine's load factor reaches
 * 3.7×. So 3.8 × 1.41 × 3.7 ≈ 20 s for one chunk. The cancel grace rounds up
 * from that, and the run watchdog is ~3× it.
 *
 * Two mistakes are available to whoever re-derives these, and both have been
 * made here: a deadline shorter than one unit of the tool's own work (5 s), and
 * a worst case measured at ONE map size (15 s). A watchdog set below the real
 * cost is a denial of service on your own feature.
 *
 * Tests assert against THESE CONSTANTS, never against literals in a test body,
 * so a re-measurement does not silently invalidate them.
 */
export const DEADLINES = Object.freeze({
  /**
   * A DIAGNOSIS threshold, not a safety deadline — the user has already asked
   * for the run to stop and the kill happens either way. Erring long costs a
   * cooperative tool nothing and a wedged one a longer spinner; erring short
   * prints `killed` against a tool that behaved perfectly. Asymmetric, so round
   * up.
   *
   * **Equal to `runWatchdogMs`, amended from 30_000 2026-08-19
   * (consistency-checker-design.md Sec.4.4, Sec.7.2 item 4c).** Cancel
   * latency and the run watchdog bound the IDENTICAL quantity — one
   * generation, serviced only at the macrotask boundary between generations,
   * since `generatePreview` is synchronous and cannot yield inside itself.
   * The checker's own worst-generation measurement under Giant × load lands
   * at 24-32 s, inside the old 30 s grace by a margin this document's own
   * table says to treat as noise (±50%). A 30 s grace against a 60 s watchdog
   * for the same bounded quantity is the asymmetry this comment already
   * argues against ("Asymmetric, so round up") — at the top of the range the
   * grace expired first and printed `killed`, the verdict this contract
   * reserves for a tool that did not behave, against one that cancelled
   * exactly as specified. Same move this document's own rev 6 made moving
   * both constants once already, for the same reason: when a document
   * computes a number for one constant, check every constant that number
   * bounds.
   */
  cancelGraceMs: 60_000,
  /**
   * Silence, NOT non-termination — do not read a liveness guarantee into it. A
   * tool that chunks and emits progress forever runs forever and holds the
   * app-wide run slot, which is the right trade: a legitimate checker run is
   * 8–30 minutes, and no wall-clock ceiling can distinguish that from a hang.
   */
  runWatchdogMs: 60_000,
} as const);

/**
 * Values that must never cross the boundary in either direction (Sec.1 goal 5).
 * "Serializable" as an adjective is what let `Infinity` survive two revisions;
 * this list is what a test can assert.
 *
 * Note what is NOT here: an `undefined`-valued key on an optional property. A
 * real corpus parse carries 4,017 of them, so a rule banning them is one the
 * payload cannot satisfy and does not need to — such a key survives the boundary
 * as an ABSENT key, which reads identically. An `undefined` inside an ARRAY is
 * different in kind: JSON turns it into `null`, which is a value the consumer
 * can read and be wrong about. Hence: read optional keys, never enumerate them.
 */
export const PROHIBITED_VALUE_KINDS = Object.freeze([
  "Map",
  "Set",
  "Date",
  "RegExp",
  "class instance",
  "function",
  "NaN",
  "±Infinity outside the sentinel",
  "undefined as an array element",
] as const);

// Re-exported for built-ins that resolve defs in-process. External tools get
// none of these over the wire and rebuild them from `referenceData.language`.
export type { ArgumentDef, AttributeDef, CommandDef, DirectiveDef, LanguageData, ParseResult };
