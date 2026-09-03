/**
 * Host-side protocol enforcement (tools-api-design.md Sec.4.2, Sec.4.5, Sec.5).
 *
 * Pure, no React, no Monaco, no Tauri, so it runs in plain-Node Vitest and
 * could run in the worker shim. Every rule here exists because `ToolMessage` is
 * a TypeScript type, which is a COMPILE-TIME FICTION for an external process: a
 * v1.1 tool can emit malformed JSON, well-formed JSON that is not a
 * `ToolMessage`, a `severity` with `level: "catastrophe"`, or a `table` whose
 * rows are numbers.
 *
 * The validators never trust the discriminant. A message that fails is
 * DISCARDED with a visible error (`reason: "protocol"`), never rendered.
 */

import {
  LIMITS,
  TOOLS_API_VERSION,
  type Capability,
  type OutputBlock,
  type OverlayRole,
  type OverlayShape,
  type ParamValue,
  type Span,
  type TextEdit,
  type ToolManifest,
  type ToolMessage,
  type ToolOutput,
  type ToolParamDef,
} from "../../tools-api/index";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isSpan(v: unknown): v is Span {
  return isRecord(v) && isFiniteNumber(v.start) && isFiniteNumber(v.end);
}

/** `null` is a legal rowSpans entry, it means "this row has no code to jump to". */
function isSpanOrNull(v: unknown): v is Span | null {
  return v === null || isSpan(v);
}

const OVERLAY_ROLES = new Set<OverlayRole>(["primary", "secondary", "warning", "error", "muted"]);
function isOverlayRole(v: unknown): v is OverlayRole {
  return typeof v === "string" && OVERLAY_ROLES.has(v as OverlayRole);
}

/**
 * The intersection (not a bare `{x,y}`) is deliberate: `checkOverlayShape`
 * calls this on the WHOLE shape object for point/circle/label/handle, and a
 * bare-object predicate would narrow away every OTHER field TS already knew
 * the record could have (radiusPx, rTiles, cursor, ...), reporting them as
 * nonexistent even though the runtime object still carries them.
 */
function isTilePoint(v: unknown): v is Record<string, unknown> & { x: number; y: number } {
  return isRecord(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y);
}

/**
 * Sec.3.4 layer 2. Never trusts the discriminant, same rule as
 * `checkOutputBlock`, an external tool can send a "handle" shape with no
 * `id`, which the type says is required and JSON cannot enforce.
 */
function checkOverlayShape(shape: unknown, index: number): string | null {
  if (!isRecord(shape)) return `shape ${index} is not an object`;
  if (shape.id !== undefined && typeof shape.id !== "string") return `shape ${index} has a non-string id`;
  if (!isOverlayRole(shape.role)) return `shape ${index} has an out-of-enum role`;
  switch (shape.kind) {
    case "point":
      if (!isTilePoint(shape)) return `shape ${index} (point) has non-numeric x/y`;
      if (shape.radiusPx !== undefined && !isFiniteNumber(shape.radiusPx)) return `shape ${index} (point) has a non-numeric radiusPx`;
      return null;
    case "circle":
      if (!isTilePoint(shape)) return `shape ${index} (circle) has non-numeric x/y`;
      if (!isFiniteNumber(shape.rTiles)) return `shape ${index} (circle) has a non-numeric rTiles`;
      if (shape.fill !== undefined && typeof shape.fill !== "boolean") return `shape ${index} (circle) has a non-boolean fill`;
      return null;
    case "line":
      if (!isTilePoint(shape.from)) return `shape ${index} (line) has a malformed 'from'`;
      if (!isTilePoint(shape.to)) return `shape ${index} (line) has a malformed 'to'`;
      if (shape.dashed !== undefined && typeof shape.dashed !== "boolean") return `shape ${index} (line) has a non-boolean dashed`;
      return null;
    case "polyline":
      if (!Array.isArray(shape.points) || !shape.points.every(isTilePoint)) {
        return `shape ${index} (polyline) has a non-tile-point in points`;
      }
      if (shape.closed !== undefined && typeof shape.closed !== "boolean") return `shape ${index} (polyline) has a non-boolean closed`;
      return null;
    case "label":
      if (!isTilePoint(shape)) return `shape ${index} (label) has non-numeric x/y`;
      if (typeof shape.text !== "string") return `shape ${index} (label) has no text`;
      return null;
    case "handle":
      if (typeof shape.id !== "string") return `shape ${index} (handle) has no id`;
      if (!isTilePoint(shape)) return `shape ${index} (handle) has non-numeric x/y`;
      if (shape.cursor !== undefined && shape.cursor !== "move" && shape.cursor !== "ew-resize" && shape.cursor !== "grab") {
        return `shape ${index} (handle) has an out-of-enum cursor`;
      }
      return null;
    default:
      return `shape ${index} has an unknown kind ${JSON.stringify(shape.kind)}`;
  }
}

// ---------------------------------------------------------------------------
// Registration-time manifest validation (Sec.5)
// ---------------------------------------------------------------------------

export interface ManifestProblem {
  manifestId: string;
  message: string;
}

/**
 * A declared `default` must satisfy its OWN declared constraints.
 *
 * This is the same rule `npm run validate:reference` already enforces on
 * language.json arguments, for a defect that reached the corpus 461 times. The
 * case it exists for here: a `multiSelect` declaring `default: []` alongside
 * `minSelected: 1` passes every run-time check and ships a form that cannot be
 * submitted as authored.
 */
export function validateManifest(manifest: ToolManifest): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const id = manifest.id;
  const fail = (message: string) => problems.push({ manifestId: id, message });

  // Must REJECT, not warn, otherwise v1.1 tools will depend on leniency.
  if (manifest.apiVersion !== TOOLS_API_VERSION) {
    fail(`declares apiVersion ${manifest.apiVersion}; this host implements ${TOOLS_API_VERSION}`);
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) fail(`id must be kebab-case`);
  if (manifest.ownsSettingsHeader !== undefined && typeof manifest.ownsSettingsHeader !== "boolean") {
    fail(`ownsSettingsHeader must be a boolean when present`);
  }

  const seen = new Set<string>();
  for (const param of manifest.params ?? []) {
    if (seen.has(param.key)) fail(`duplicate param key "${param.key}"`);
    seen.add(param.key);

    switch (param.type) {
      case "integer": {
        if (param.min !== undefined && param.default < param.min) {
          fail(`param "${param.key}" default ${param.default} is below its own min ${param.min}`);
        }
        if (param.max !== undefined && param.default > param.max) {
          fail(`param "${param.key}" default ${param.default} is above its own max ${param.max}`);
        }
        break;
      }
      case "select": {
        if (!param.options.some((o) => o.value === param.default)) {
          fail(`param "${param.key}" default "${param.default}" is not one of its own options`);
        }
        break;
      }
      case "multiSelect": {
        const values = new Set(param.options.map((o) => o.value));
        for (const d of param.default) {
          if (!values.has(d)) fail(`param "${param.key}" default "${d}" is not one of its own options`);
        }
        if (param.minSelected !== undefined && param.default.length < param.minSelected) {
          fail(`param "${param.key}" default selects ${param.default.length}, below its own minSelected ${param.minSelected}`);
        }
        if (param.maxSelected !== undefined && param.default.length > param.maxSelected) {
          fail(`param "${param.key}" default selects ${param.default.length}, above its own maxSelected ${param.maxSelected}`);
        }
        break;
      }
      case "boolean":
      case "text":
        break;
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Run-time param validation (Sec.5)
// ---------------------------------------------------------------------------

/**
 * Validate and CLAMP submitted values before they enter `ctx.params`.
 *
 * Implicit while the host owns the form; stated and implemented because v1.1
 * makes `params` part of the trust boundary and manifests arrive from strangers.
 *
 * The count bound on `multiSelect` is the one that gets forgotten: min/max,
 * options-membership and every-value-is-an-option all pass an EMPTY selection,
 * and the parameter that motivated multiSelect (the 2/4/6/8 player-count matrix)
 * is meaningless empty. Absent bounds mean unbounded, INCLUDING empty.
 */
export function resolveParams(
  defs: readonly ToolParamDef[] | undefined,
  submitted: Readonly<Record<string, unknown>>,
): { params: Record<string, ParamValue>; problems: string[] } {
  const params: Record<string, ParamValue> = {};
  const problems: string[] = [];

  for (const def of defs ?? []) {
    const raw = submitted[def.key];
    switch (def.type) {
      case "integer": {
        let n = isFiniteNumber(raw) ? Math.trunc(raw) : def.default;
        if (!isFiniteNumber(raw)) problems.push(`"${def.label}" was not a number; using ${def.default}`);
        if (def.min !== undefined && n < def.min) n = def.min;
        if (def.max !== undefined && n > def.max) n = def.max;
        params[def.key] = n;
        break;
      }
      case "boolean":
        params[def.key] = typeof raw === "boolean" ? raw : def.default;
        break;
      case "text":
        params[def.key] = typeof raw === "string" ? raw : def.default;
        break;
      case "select": {
        const ok = typeof raw === "string" && def.options.some((o) => o.value === raw);
        if (!ok && raw !== undefined) problems.push(`"${def.label}" was not one of its options; using the default`);
        params[def.key] = ok ? (raw as string) : def.default;
        break;
      }
      case "multiSelect": {
        const values = new Set(def.options.map((o) => o.value));
        const picked = isStringArray(raw) ? raw.filter((v) => values.has(v)) : [...def.default];
        if (def.minSelected !== undefined && picked.length < def.minSelected) {
          problems.push(`"${def.label}" needs at least ${def.minSelected} selected`);
        }
        if (def.maxSelected !== undefined && picked.length > def.maxSelected) {
          problems.push(`"${def.label}" allows at most ${def.maxSelected} selected`);
        }
        params[def.key] = picked;
        break;
      }
    }
  }
  return { params, problems };
}

/** True when nothing in `problems` blocks the run. Kept separate so the pane can show warnings. */
export function paramsAreSubmittable(
  defs: readonly ToolParamDef[] | undefined,
  submitted: Readonly<Record<string, unknown>>,
): boolean {
  for (const def of defs ?? []) {
    if (def.type !== "multiSelect") continue;
    const values = new Set(def.options.map((o) => o.value));
    const raw = submitted[def.key];
    const picked = isStringArray(raw) ? raw.filter((v) => values.has(v)) : [...def.default];
    if (def.minSelected !== undefined && picked.length < def.minSelected) return false;
    if (def.maxSelected !== undefined && picked.length > def.maxSelected) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Inbound message validation (Sec.4.2)
// ---------------------------------------------------------------------------

export type MessageCheck = { ok: true; message: ToolMessage } | { ok: false; problem: string };

function checkOutputBlock(block: unknown, index: number): string | null {
  if (!isRecord(block)) return `block ${index} is not an object`;
  const where = `block ${index}`;
  switch (block.kind) {
    case "heading":
    case "text":
      if (typeof block.text !== "string") return `${where} (${block.kind}) has no text`;
      if (block.text.length > LIMITS.maxTextLengthPerBlock) return `${where} exceeds the ${LIMITS.maxTextLengthPerBlock}-character block cap`;
      return null;
    case "keyValue":
      if (!Array.isArray(block.rows)) return `${where} (keyValue) has no rows`;
      for (const row of block.rows) {
        if (!Array.isArray(row) || row.length !== 2 || row.some((c) => typeof c !== "string")) {
          return `${where} (keyValue) has a row that is not a [string, string] pair`;
        }
      }
      return null;
    case "table": {
      if (!isStringArray(block.columns)) return `${where} (table) columns must be strings`;
      if (!Array.isArray(block.rows)) return `${where} (table) has no rows`;
      for (const row of block.rows) {
        if (!isStringArray(row)) return `${where} (table) has a row whose cells are not all strings`;
      }
      // The only OutputBlock field with a cross-field invariant, and it would
      // otherwise ship unvalidated: Sec.2 declares it and delegates the check
      // here.
      if (block.rowSpans !== undefined) {
        if (!Array.isArray(block.rowSpans)) return `${where} (table) rowSpans must be an array`;
        if (block.rowSpans.length !== block.rows.length) {
          return `${where} (table) has ${block.rowSpans.length} rowSpans for ${block.rows.length} rows`;
        }
        if (!block.rowSpans.every(isSpanOrNull)) return `${where} (table) has a rowSpan that is neither a Span nor null`;
      }
      return null;
    }
    case "severity":
      if (block.level !== "info" && block.level !== "warning" && block.level !== "error") {
        return `${where} (severity) has an out-of-enum level`;
      }
      if (typeof block.text !== "string") return `${where} (severity) has no text`;
      if (block.span !== undefined && !isSpan(block.span)) return `${where} (severity) has a malformed span`;
      return null;
    case "codeRef":
      if (typeof block.text !== "string") return `${where} (codeRef) has no text`;
      if (!isSpan(block.span)) return `${where} (codeRef) has a malformed span`;
      return null;
    case "mapOverlay": {
      if (!Array.isArray(block.shapes)) return `${where} (mapOverlay) has no shapes`;
      if (block.interactive !== undefined && typeof block.interactive !== "boolean") {
        return `${where} (mapOverlay) has a non-boolean interactive`;
      }
      // Sec.3.7: over-cap TRUNCATES rather than rejects, so this checks each
      // shape up to the cap only, a block over the cap is not itself a
      // protocol violation, `overlayShapesToRender` is what enforces it at
      // render time, same split `checkOutput`'s block-count cap and
      // `tableRowsToRender`'s row cap already have.
      const toCheck = block.shapes.slice(0, LIMITS.maxOverlayShapesPerBlock);
      for (let i = 0; i < toCheck.length; i++) {
        const problem = checkOverlayShape(toCheck[i], i);
        if (problem) return `${where} (mapOverlay) ${problem}`;
      }
      return null;
    }
    default:
      return `${where} has an unknown kind ${JSON.stringify(block.kind)}`;
  }
}

function checkOutput(output: unknown): string | null {
  if (!isRecord(output)) return "output is not an object";
  if (!Array.isArray(output.blocks)) return "output.blocks is not an array";
  if (output.blocks.length > LIMITS.maxBlocksPerOutput) {
    return `output has ${output.blocks.length} blocks, over the ${LIMITS.maxBlocksPerOutput} cap`;
  }
  for (let i = 0; i < output.blocks.length; i++) {
    const problem = checkOutputBlock(output.blocks[i], i);
    if (problem) return problem;
  }
  return null;
}

function checkEdits(edits: unknown): string | null {
  if (!Array.isArray(edits)) return "edits is not an array";
  for (const edit of edits) {
    if (!isRecord(edit)) return "an edit is not an object";
    if (!isFiniteNumber(edit.start) || !isFiniteNumber(edit.end)) return "an edit has non-numeric bounds";
    if (typeof edit.newText !== "string") return "an edit has no newText";
  }
  return null;
}

/** One narrow validator per message kind. Never trusts the discriminant. */
export function validateToolMessage(raw: unknown): MessageCheck {
  if (!isRecord(raw)) return { ok: false, problem: "message is not an object" };
  switch (raw.type) {
    case "progress": {
      if (raw.fraction !== undefined && (!isFiniteNumber(raw.fraction) || raw.fraction < 0 || raw.fraction > 1)) {
        return { ok: false, problem: "progress.fraction must be a number in [0,1]" };
      }
      if (raw.note !== undefined && typeof raw.note !== "string") return { ok: false, problem: "progress.note must be a string" };
      return { ok: true, message: raw as ToolMessage };
    }
    case "partial": {
      const problem = checkOutput(raw.output);
      return problem ? { ok: false, problem } : { ok: true, message: raw as ToolMessage };
    }
    case "result": {
      const problem = checkOutput(raw.output);
      if (problem) return { ok: false, problem };
      if (raw.edits !== undefined) {
        const editProblem = checkEdits(raw.edits);
        if (editProblem) return { ok: false, problem: editProblem };
      }
      return { ok: true, message: raw as ToolMessage };
    }
    case "error": {
      if (typeof raw.message !== "string") return { ok: false, problem: "error.message must be a string" };
      const reasons = ["tool-error", "cancelled", "killed", "unresponsive", "protocol", "host-error"];
      if (typeof raw.reason !== "string" || !reasons.includes(raw.reason)) {
        return { ok: false, problem: "error.reason is out of enum" };
      }
      return { ok: true, message: raw as ToolMessage };
    }
    default:
      return { ok: false, problem: `unknown message type ${JSON.stringify(raw.type)}` };
  }
}

/** Parse one NDJSON line from an external tool, cap-checked before `JSON.parse`. */
export function parseInboundLine(line: string): MessageCheck {
  // The cap is checked on the RAW line: a single 500 MB NDJSON line OOMs the
  // host before any render-side cap can help.
  if (line.length > LIMITS.maxInboundLineBytes) {
    return { ok: false, problem: `inbound line exceeds the ${LIMITS.maxInboundLineBytes}-byte cap` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, problem: "inbound line is not valid JSON" };
  }
  return validateToolMessage(parsed);
}

/**
 * Outbound (host→tool) `run` context cap (Sec.4.2 rule 2). Checked before the
 * context ever reaches a runner, so an in-process built-in and a worker-backed
 * tool fail identically, exceeding it is a host-side error, never a silent
 * truncation.
 */
export function checkOutboundContextSize(contextJson: unknown): string | null {
  const bytes = JSON.stringify(contextJson).length;
  if (bytes > LIMITS.maxOutboundRunBytes) {
    return `outbound run context is ${bytes} bytes, over the ${LIMITS.maxOutboundRunBytes}-byte cap`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edit validation (Sec.4.5)
// ---------------------------------------------------------------------------

export type EditCheck = { ok: true } | { ok: false; problem: string };

/**
 * ANY violation rejects the WHOLE set. A buggy external tool can emit anything
 * and the staleness guard alone does not catch same-version garbage.
 *
 * Note what is not validated here: ordering. "Sorted descending by start" reads
 * as load-bearing and is not, descending order is what manual string splicing
 * needs, whereas `pushEditOperations` takes ranges in original coordinates and
 * handles ordering itself. What Monaco does require is NON-OVERLAP, which is
 * what this checks.
 */
export function validateEdits(edits: readonly TextEdit[], snapshotLength: number): EditCheck {
  for (const e of edits) {
    if (!Number.isInteger(e.start) || !Number.isInteger(e.end)) return { ok: false, problem: "an edit has non-integer bounds" };
    if (e.start < 0 || e.end < 0) return { ok: false, problem: "an edit has a negative offset" };
    if (e.start > e.end) return { ok: false, problem: `an edit has start ${e.start} after end ${e.end}` };
    if (e.end > snapshotLength) {
      return { ok: false, problem: `an edit ends at ${e.end}, past the ${snapshotLength}-character document` };
    }
  }
  const sorted = [...edits].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return { ok: false, problem: `edits overlap at offset ${sorted[i].start}` };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Capabilities (Sec.6)
// ---------------------------------------------------------------------------

/** read-ast implies read-source; the consent dialog collapses them into one line. */
export function effectiveCapabilities(declared: readonly Capability[]): Set<Capability> {
  const set = new Set<Capability>(declared);
  if (set.has("read-ast")) set.add("read-source");
  return set;
}

/** Rendered rows are capped; the pane says "showing first N of M" rather than truncating silently. */
export function tableRowsToRender(rows: readonly string[][]): { rows: readonly string[][]; hidden: number } {
  if (rows.length <= LIMITS.maxTableRowsRendered) return { rows, hidden: 0 };
  return { rows: rows.slice(0, LIMITS.maxTableRowsRendered), hidden: rows.length - LIMITS.maxTableRowsRendered };
}

/**
 * Sec.3.7: "over-budget truncates and says so; it never rejects." `hidden`
 * is returned even at 0, the pane prints the count UNCONDITIONALLY, because
 * a filtered overlay and an empty one are different claims and the
 * sentence's absence must never be what carries the information (the same
 * lesson `consistency-checker-design.md`'s first human read of its output
 * paid for).
 */
export function overlayShapesToRender(shapes: readonly OverlayShape[]): { shapes: readonly OverlayShape[]; hidden: number } {
  if (shapes.length <= LIMITS.maxOverlayShapesPerBlock) return { shapes, hidden: 0 };
  return { shapes: shapes.slice(0, LIMITS.maxOverlayShapesPerBlock), hidden: shapes.length - LIMITS.maxOverlayShapesPerBlock };
}

export type { OutputBlock, ToolOutput };
