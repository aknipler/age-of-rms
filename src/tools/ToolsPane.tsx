/**
 * The Advanced Tools pane (tools-api-design.md Sec.5).
 *
 * Select Tool dropdown -> params form (from `manifest.params`) -> Run/Cancel ->
 * progress -> rendered OutputBlocks -> Apply when the tool proposed edits.
 *
 * Tools are DOCUMENTS THE APP DISPLAYS, not extensions of the app: everything
 * below renders declarative blocks the tool returned. A tool never touches the
 * DOM, adds no menus and hooks no events, which is what makes the v1.1 trust
 * model tractable at all.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { HelpTip } from "../components/HelpTip";
import { useParsedDocumentContext } from "../ParsedDocumentContext";
import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import { resolveMapDim } from "../preview/generator/mapDimensions";
import { lineNumberOfOffset } from "../parser/lineIndex";
import languageData from "../../reference/data/language.json";
import gameConstantsData from "../../reference/data/game-constants.json";
import type { LanguageData } from "../parser/language";
import type { Span } from "../parser/types";
import {
  TOOLS_API_VERSION,
  type OutputBlock,
  type ParamValue,
  type PublishedGameConstants,
  type ToolContext,
  type ToolParamDef,
} from "../../tools-api/index";
import { ToolHost, inProcessRunner } from "./host";
import { effectiveCapabilities, paramsAreSubmittable, resolveParams, tableRowsToRender, validateEdits } from "./protocol";
import { registeredTools, WORKER_RUNTIME_TOOL_IDS } from "./registry";
import { workerRunner } from "./workerRunner";
import styles from "./ToolsPane.module.css";

const lang = languageData as unknown as LanguageData;
// Same double-cast reasoning as src/preview/worker.ts for the same file:
// resolveJsonModule infers a literal type that doesn't structurally overlap
// the hand-written/generated interface closely enough for a single-step
// cast, and `validate:reference` (ajv) is the real guarantee this data is
// shaped correctly, not a runtime assertion here.
const gameConstants = (gameConstantsData as unknown as { constants: PublishedGameConstants }).constants;

interface ToolsPaneProps {
  /**
   * `null` means no file is open. NOT a boolean — `useDocument` goes straight
   * from one non-null path to a different non-null one on File > Open when a
   * file is already open (`documentModel.setValue()` then `setFilePath`), so a
   * `hasFile: boolean` derived from `filePath !== null` never toggles on that
   * transition and a run against the closed file's snapshot is never flagged.
   */
  filePath: string | null;
  source: string;
  /** Bypasses the typing debounce, exactly as Breakdown's discrete-edit path does. */
  reparseNow: (source: string) => void;
  applyTextEdits: (edits: readonly { start: number; end: number; newText: string }[]) => void;
  onJumpToOffset: (offset: number) => void;
}

export function ToolsPane({ filePath, source, reparseNow, applyTextEdits, onJumpToOffset }: ToolsPaneProps) {
  const parseResult = useParsedDocumentContext();
  const generation = useGenerationSettings();
  const tools = useMemo(() => registeredTools(), []);

  const [selectedId, setSelectedId] = useState<string>(tools[0]?.manifest.id ?? "");
  const [submitted, setSubmitted] = useState<Record<string, unknown>>({});

  const host = useMemo(() => {
    const h = new ToolHost(inProcessRunner);
    h.registerEditCapable(tools.filter((t) => t.manifest.capabilities.includes("edit-source")).map((t) => t.manifest.id));
    return h;
  }, [tools]);

  const state = useSyncExternalStore(
    useCallback((cb) => host.subscribe(cb), [host]),
    () => host.getState(),
  );

  const tool = tools.find((t) => t.manifest.id === selectedId);

  // Sec.5: a run is pinned to a document, and the document can be REPLACED —
  // decided in ToolHost.noteOpenDocument, not here, so the transition that
  // matters (one open file replaced by a different one, which a `hasFile`
  // boolean cannot see) is covered by that method's own tests rather than by
  // a render effect nothing exercises directly.
  useEffect(() => {
    host.noteOpenDocument(filePath);
  }, [filePath, host]);

  // Selecting a different tool resets the form to that manifest's own defaults,
  // and cancels an active run after a confirm (one run at a time, app-wide).
  const selectTool = (id: string) => {
    if (host.isBusy() && !window.confirm("A tool is still running. Switching tools cancels it. Continue?")) return;
    if (host.isBusy()) host.cancel();
    host.reset();
    setSelectedId(id);
    setSubmitted({});
  };

  const setParam = (key: string, value: ParamValue) => setSubmitted((prev) => ({ ...prev, [key]: value }));

  const run = () => {
    if (!tool || !parseResult) return;

    // Sec.4.3 pin 5: the source-equality gate is FALSE for the whole debounce
    // window after every keystroke, so a Run pressed just after typing would do
    // nothing with no affordance — the shape of bug users report as "the button
    // is broken". Push a reparse first; the effect below starts the run when the
    // matching parse lands.
    if (parseResult.source !== source) {
      reparseNow(source);
      setPendingRun(true);
      return;
    }
    startRun();
  };

  const [pendingRun, setPendingRun] = useState(false);

  const startRun = useCallback(() => {
    if (!tool || !parseResult) return;
    const { params } = resolveParams(tool.manifest.params, submitted);
    const granted = effectiveCapabilities(tool.manifest.capabilities);

    // Sec.6: capabilities gate what the host PUTS IN the context, even for
    // trusted built-ins. An undeclared field is simply absent, which keeps the
    // contract honest before v1.1 makes it a trust boundary.
    const tiles = resolveMapDim(generation.mapSize, lang.predefinedLabels ?? []) ?? 0;
    const ctx: ToolContext<typeof parseResult> = {
      apiVersion: TOOLS_API_VERSION,
      params,
      ...(granted.has("read-source") ? { source: parseResult.source } : {}),
      ...(granted.has("read-ast") ? { parseResult } : {}),
      ...(granted.has("read-generation-settings")
        ? {
            settings: {
              playerCount: generation.playerCount,
              mapSize: { name: generation.mapSize, tiles },
              teams: [...generation.teams],
            },
          }
        : {}),
      ...(granted.has("read-reference") ? { referenceData: { language: lang, gameConstants } } : {}),
    };
    // Sec.4.3, Sec.7.2 item 3: the runner is picked per run, at the call
    // site, so `host` itself stays one shared instance with an unchanged
    // `useMemo` — see ToolHost.start's own doc comment for why that matters.
    const runner = WORKER_RUNTIME_TOOL_IDS.has(tool.manifest.id) ? workerRunner : inProcessRunner;
    host.start(tool, ctx, parseResult.source, runner, { playerCount: generation.playerCount, mapSize: generation.mapSize }, filePath);
  }, [tool, parseResult, submitted, generation, host, filePath]);

  useEffect(() => {
    if (pendingRun && parseResult && parseResult.source === source) {
      setPendingRun(false);
      startRun();
    }
  }, [pendingRun, parseResult, source, startRun]);

  const canApply = host.canApply(source);
  const stale = state.edits !== null && state.edits.length > 0 && !canApply;

  const apply = () => {
    if (!state.edits) return;
    // Validate again at the point of use: a buggy external tool can emit
    // anything and the staleness guard alone does not catch same-version
    // garbage. ANY violation rejects the whole set.
    const check = validateEdits(state.edits, source.length);
    if (!check.ok) {
      window.alert(`These changes were rejected: ${check.problem}`);
      return;
    }
    applyTextEdits(state.edits);
    reparseNow(source);
    host.reset();
  };

  if (filePath === null) {
    return (
      <div className={styles.pane}>
        <p className={styles.empty}>Open a script to run a tool against it.</p>
      </div>
    );
  }

  const busy = state.phase === "running" || state.phase === "cancelling";
  const submittable = tool ? paramsAreSubmittable(tool.manifest.params, submitted) : false;
  // Sec.5.2 — keyed on the OUTPUT's own tool (state.toolId), not the
  // currently selected one: selecting a different tool resets state first, so
  // the two agree while a result is showing, but state.toolId is what the
  // output actually belongs to.
  const outputOwnsSettingsHeader = tools.find((t) => t.manifest.id === state.toolId)?.manifest.ownsSettingsHeader === true;

  return (
    <div className={styles.pane}>
      <div className={styles.controls}>
        <HelpTip id="tools.select">
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tool-select">
              Tool
            </label>
            <select
              id="tool-select"
              className={styles.select}
              value={selectedId}
              onChange={(e) => selectTool(e.target.value)}
            >
              {tools.map((t) => (
                <option key={t.manifest.id} value={t.manifest.id}>
                  {t.manifest.name}
                </option>
              ))}
            </select>
          </div>
        </HelpTip>

        {busy ? (
          <HelpTip id="tools.cancel">
            <button type="button" className={styles.button} onClick={() => host.cancel()} disabled={state.phase === "cancelling"}>
              {state.phase === "cancelling" ? "Stopping…" : "Cancel"}
            </button>
          </HelpTip>
        ) : (
          <HelpTip id="tools.run">
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={run}
              disabled={!tool || !parseResult || !submittable}
            >
              {pendingRun ? "Parsing…" : "Run"}
            </button>
          </HelpTip>
        )}

        {canApply && (
          <HelpTip id="tools.apply">
            <button type="button" className={styles.button} onClick={apply}>
              Apply {state.edits?.length} change{state.edits?.length === 1 ? "" : "s"}
            </button>
          </HelpTip>
        )}
      </div>

      {tool && <p className={styles.description}>{tool.manifest.description}</p>}

      {tool?.manifest.params && tool.manifest.params.length > 0 && (
        <HelpTip id="tools.params">
          <div className={styles.params}>
            {tool.manifest.params.map((def) => (
              <ParamRow key={def.key} def={def} value={submitted[def.key]} onChange={(v) => setParam(def.key, v)} />
            ))}
          </div>
        </HelpTip>
      )}

      {busy && (
        <HelpTip id="tools.progress">
          <div>
            <div className={styles.progressTrack}>
              {state.progress?.fraction !== undefined ? (
                <div className={styles.progressFill} style={{ width: `${Math.round(state.progress.fraction * 100)}%` }} />
              ) : (
                <div className={styles.progressIndeterminate} />
              )}
            </div>
            {state.progress?.note && <p className={styles.progressNote}>{state.progress.note}</p>}
          </div>
        </HelpTip>
      )}

      {stale && (
        <p className={styles.staleNote}>The code changed since this ran — re-run before applying. Tool edits are never rebased.</p>
      )}

      {state.error && (
        <div className={`${styles.severity} ${styles.error}`}>
          <strong>{state.error.reason}</strong> — {state.error.message}
        </div>
      )}

      {state.output && (
        <HelpTip id="tools.output">
          <div className={styles.output}>
            {/* Echoing the run's settings makes a stale result self-describing
                instead of silently wrong: change the player count mid-run and
                the pane would otherwise show results for the old value, labelled
                with nothing. Read from `state.settingsSnapshot` (the settings
                THIS run was started at), never the live `generation` context —
                the live context changes after Run and would re-label a finished
                report with a setting it was never run at (docs/known-issues.md
                BUG-014). Suppressed for a tool that declares its own header
                (ownsSettingsHeader) — for a multi-player-count report this echo
                would duplicate the tool's own header and can only name one
                player count anyway. */}
            {!outputOwnsSettingsHeader && state.settingsSnapshot && (
              <p className={styles.description}>
                Run at {state.settingsSnapshot.playerCount} players, {state.settingsSnapshot.mapSize}
              </p>
            )}
            {state.output.blocks.map((block, i) => (
              <Block key={i} block={block} lineOffsets={parseResult?.lineOffsets} onJump={onJumpToOffset} />
            ))}
          </div>
        </HelpTip>
      )}

      {state.log.length > 0 && (
        <HelpTip id="tools.log">
          <div className={styles.log}>
            {state.log.map((line, i) => (
              <p key={i} className={styles.logLine}>
                {line}
              </p>
            ))}
          </div>
        </HelpTip>
      )}

      {!state.output && !state.error && !busy && <p className={styles.empty}>Waiting for tool selection…</p>}
    </div>
  );
}

function ParamRow({ def, value, onChange }: { def: ToolParamDef; value: unknown; onChange: (v: ParamValue) => void }) {
  // Tool-authored help renders INSIDE the row rather than through ui-help.json:
  // these rows are generated from `manifest.params`, so their text comes from
  // the manifest. `tools.params` documents the FORM. Revisit before v1.1, when
  // a manifest from a stranger writing UI copy becomes a trust question.
  const label = (
    <span className={styles.label} title={def.help}>
      {def.label}
    </span>
  );

  switch (def.type) {
    case "boolean":
      return (
        <label className={styles.paramRow}>
          <input type="checkbox" checked={typeof value === "boolean" ? value : def.default} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      );
    case "integer":
      return (
        <label className={styles.paramRow}>
          {label}
          <input
            type="number"
            className={styles.input}
            min={def.min}
            max={def.max}
            value={typeof value === "number" ? value : def.default}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        </label>
      );
    case "text":
      return (
        <label className={styles.paramRow}>
          {label}
          <input
            type="text"
            className={styles.input}
            value={typeof value === "string" ? value : def.default}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    case "select":
      return (
        <label className={styles.paramRow}>
          {label}
          <select className={styles.select} value={typeof value === "string" ? value : def.default} onChange={(e) => onChange(e.target.value)}>
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "multiSelect": {
      const picked = new Set(Array.isArray(value) ? (value as string[]) : def.default);
      return (
        <div className={styles.paramRow}>
          {label}
          <div className={styles.checkboxes}>
            {def.options.map((o) => (
              <label key={o.value} className={styles.paramRow}>
                <input
                  type="checkbox"
                  checked={picked.has(o.value)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(o.value);
                    else next.delete(o.value);
                    onChange(def.options.filter((x) => next.has(x.value)).map((x) => x.value));
                  }}
                />
                {o.label}
              </label>
            ))}
          </div>
        </div>
      );
    }
  }
}

function Block({
  block,
  lineOffsets,
  onJump,
}: {
  block: OutputBlock;
  lineOffsets: readonly number[] | undefined;
  onJump: (offset: number) => void;
}) {
  const jump = (span: Span) => onJump(span.start);

  switch (block.kind) {
    case "heading":
      return <h3 className={styles.heading}>{block.text}</h3>;
    case "text":
      return <p className={styles.text}>{block.text}</p>;
    case "keyValue":
      return (
        <table className={styles.kv}>
          <tbody>
            {block.rows.map(([k, v], i) => (
              <tr key={i}>
                <td className={styles.kvKey}>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "table": {
      // Beyond the cap the pane says how many are hidden rather than truncating
      // silently — a table that quietly stops is indistinguishable from a tool
      // that found fewer results.
      const { rows, hidden } = tableRowsToRender(block.rows);
      return (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.columns.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const span = block.rowSpans?.[i] ?? null;
                return (
                  <tr key={i} className={span ? styles.rowLink : undefined} onClick={span ? () => jump(span) : undefined}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hidden > 0 && <p className={styles.description}>Showing the first {rows.length} of {rows.length + hidden} rows.</p>}
        </div>
      );
    }
    case "severity":
      return (
        <div className={`${styles.severity} ${styles[block.level]}`}>
          {block.text}
          {block.span && lineOffsets && (
            <>
              {" "}
              <button type="button" className={styles.codeRef} onClick={() => jump(block.span!)}>
                line {lineNumberOfOffset(lineOffsets, block.span.start)}
              </button>
            </>
          )}
        </div>
      );
    case "codeRef":
      return (
        <button type="button" className={styles.codeRef} onClick={() => jump(block.span)}>
          {block.text}
        </button>
      );
  }
}
