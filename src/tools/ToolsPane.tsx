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

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { HelpTip } from "../components/HelpTip";
import { DraftNumberInput } from "../components/DraftNumberInput";
import { PanelErrorBoundary } from "./PanelErrorBoundary";
import { useParsedDocumentContext } from "../ParsedDocumentContext";
import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import { usePreviewView } from "../components/preview/PreviewViewContext";
import { usePreviewCut } from "../PreviewCutContext";
import { lineNumberOfOffset } from "../parser/lineIndex";
import languageData from "../../reference/data/language.json";
import gameConstantsData from "../../reference/data/game-constants.json";
import type { LanguageData } from "../parser/language";
import type { Span } from "../parser/types";
import {
  type OutputBlock,
  type ParamValue,
  type PublishedGameConstants,
  type ToolParamDef,
} from "../../tools-api/index";
import { inProcessRunner } from "./host";
import {
  useSelectedTool,
  useToolHostContext,
  useToolParams,
} from "./ToolHostContext";
import { buildToolContext } from "./buildToolContext";
import { useIncludeFiles } from "../useIncludeFiles";
import {
  paramsAreSubmittable,
  resolveParams,
  tableRowsToRender,
  validateEdits,
} from "./protocol";
import { registeredTools, WORKER_RUNTIME_TOOL_IDS } from "./registry";
import { workerRunner } from "./workerRunner";
import { useLandPlacementModel } from "./builtin/landPlacement/panel/landPlacementModel";
import { LandPlacementPanel } from "./builtin/landPlacement/panel/LandPlacementPanel";
import { useToolsSlots } from "./ToolsSlots";
import styles from "./ToolsPane.module.css";

const lang = languageData as unknown as LanguageData;
// Same double-cast reasoning as src/preview/worker.ts for the same file:
// resolveJsonModule infers a literal type that doesn't structurally overlap
// the hand-written/generated interface closely enough for a single-step
// cast, and `validate:reference` (ajv) is the real guarantee this data is
// shaped correctly, not a runtime assertion here.
const gameConstants = (
  gameConstantsData as unknown as { constants: PublishedGameConstants }
).constants;

interface ToolsPaneProps {
  /**
   * `null` means no file is open. NOT a boolean. `useDocument` goes straight
   * from one non-null path to a different non-null one on File > Open when a
   * file is already open (`documentModel.setValue()` then `setFilePath`), so a
   * `hasFile: boolean` derived from `filePath !== null` never toggles on that
   * transition and a run against the closed file's snapshot is never flagged.
   */
  filePath: string | null;
  source: string;
  /** Bypasses the typing debounce, exactly as Breakdown's discrete-edit path does. */
  reparseNow: (source: string) => void;
  applyTextEdits: (
    edits: readonly { start: number; end: number; newText: string }[],
  ) => void;
  onJumpToOffset: (offset: number) => void;
}

export function ToolsPane({
  filePath,
  source,
  reparseNow,
  applyTextEdits,
  onJumpToOffset,
}: ToolsPaneProps) {
  const parseResult = useParsedDocumentContext();
  const generation = useGenerationSettings();
  const tools = useMemo(() => registeredTools(), []);

  // Lifted above the tab switch (ToolHostContext.tsx): which tool the
  // dropdown shows has to survive a tab switch the same way the ToolHost and
  // Land Placement's own model do, or returning to this pane always looked
  // like the tool selection had been forgotten. `submitted` (the params
  // form) is lifted too, per tool (`useToolParams`), so a run's settings are
  // still there after a trip to Code and back, and switching tools no longer
  // resets the form.
  const { selectedId, setSelectedId } = useSelectedTool();
  const { submitted, setParam: setSubmittedParam } = useToolParams(selectedId);

  // Lifted above the tab switch (ToolHostContext.tsx), land-placement-design.md
  // Sec.3.6: "the model has to be lifted above activeTab or a tab switch
  // destroys it." The object itself now outlives this component; what
  // happens to it on mount/unmount is decided by the effect right below.
  const host = useToolHostContext();

  // App.tsx renders `{activeTab === "advanced-tools" && <ToolsPane …/>}`, so a
  // TAB SWITCH UNMOUNTS THIS COMPONENT even though `host` itself now
  // survives it. Two different teardowns, chosen by what's actually mounted:
  //
  // - No panel mounted (every report tool, today, unconditionally): `reset()`,
  //   EXACTLY today's behaviour. Without it a worker-backed run outlives the
  //   pane entirely. Nothing calls kill(), and the run watchdog cannot save
  //   us because `armWatchdog` re-arms on every message, so a chunking tool
  //   like the consistency checker never hits its deadline and burns a core
  //   for the full 8-30 minutes with its result going nowhere. `reset()`
  //   rather than a `dispose()`: it already terminates the active run
  //   (taught to on 2026-08-19, for the orphaned-grace-timer bug) and leaves
  //   the host USABLE, which matters under StrictMode's double-invoked
  //   mount effects. A host a premature dispose() marked permanently dead
  //   would refuse every subsequent run in development.
  // - A panel IS mounted (Sec.3.6's table, "Advanced Tools tab left"):
  //   `suspendPanel()` instead, the model is retained, not torn down, and
  //   the run slot is released since `isBusy()` only reads "mounted".
  //   `resumePanel()` mirrors it on the way back in.
  useEffect(() => {
    if (host.getPanelState().phase === "suspended") host.resumePanel();
    return () => {
      if (host.getPanelState().phase === "mounted") host.suspendPanel();
      // A finished run is kept, so a trip to the Code tab to check a finding
      // does not lose the report. Its snapshot is compared with the live
      // source on return (`outputStale` below). A run still in flight has no
      // reader left and no way to deliver, so it is torn down as before.
      else if (host.getState().phase !== "done") host.reset();
    };
  }, [host]);

  const state = useSyncExternalStore(
    useCallback((cb) => host.subscribe(cb), [host]),
    () => host.getState(),
  );

  // land-placement-design.md Sec.3.6 (slice-4b item 3): the panel lifecycle.
  // `panelState` is read the same way `state` (RunState) is above, a
  // useSyncExternalStore subscription to the same `ToolHost`, which already
  // owns both.
  const panelState = useSyncExternalStore(
    useCallback((cb) => host.subscribePanel(cb), [host]),
    () => host.getPanelState(),
  );
  const landPlacementModel = useLandPlacementModel();

  // `PanelState.dirty` (host.ts) mirrors the model store's own `dirty`.
  // this is the ONE place they are kept in sync, so the tool-switch confirm
  // below can read `host`'s copy without depending on the model store
  // directly, matching `setPanelDirty`'s own doc: "the panel's own React
  // state calls this to keep PanelState.dirty in sync."
  useEffect(() => {
    if (panelState.phase !== "unmounted")
      host.setPanelDirty(landPlacementModel.dirty);
  }, [host, panelState.phase, landPlacementModel.dirty]);

  // Any unmount (this tool switch's own confirm+unmount below, OR
  // `documentReplaced()` firing from the noteOpenDocument effect a few lines
  // down) clears the model here, ONE place, so a document replace does not
  // need its own duplicate of this logic (Sec.3.6(c): "unmount, discard").
  useEffect(() => {
    if (panelState.phase === "unmounted") landPlacementModel.clear();
  }, [panelState.phase, landPlacementModel]);

  const tool = tools.find((t) => t.manifest.id === selectedId);

  // Sec.5: a run is pinned to a document, and the document can be REPLACED,
  // decided in ToolHost.noteOpenDocument, not here, so the transition that
  // matters (one open file replaced by a different one, which a `hasFile`
  // boolean cannot see) is covered by that method's own tests rather than by
  // a render effect nothing exercises directly.
  useEffect(() => {
    host.noteOpenDocument(filePath);
  }, [filePath, host]);

  const [panelBlockedMessage, setPanelBlockedMessage] = useState<string | null>(
    null,
  );

  // Selecting a different tool resets the form to that manifest's own
  // defaults. Sec.3.6's table: leaving a MOUNTED panel confirms only when it
  // is `dirty` (not unconditionally, the way a report-tool run does) and
  // then unmounts it; leaving a running/cancelling report tool keeps the
  // old unconditional confirm. Selecting the panel tool itself mounts it.
  const selectTool = async (id: string) => {
    setPanelBlockedMessage(null);
    if (panelState.phase === "mounted") {
      if (landPlacementModel.dirty) {
        // Tauri's WebView2 shell does not reliably honour the raw browser
        // `window.confirm` (it can resolve without ever showing anything),
        // which is how this dialog silently discarded work with no prompt at
        // all in practice. `@tauri-apps/plugin-dialog` is the app's own,
        // already-depended-on native dialog surface (useDocument.ts uses it
        // for open/save) and is what actually renders in the packaged app.
        const proceed = await confirm(
          "Land Placement has unsaved changes. Switching tools discards them. Continue?",
        );
        if (!proceed) return;
      }
      host.unmountPanel();
    } else if (host.isBusy()) {
      const proceed = await confirm(
        "A tool is still running. Switching tools cancels it. Continue?",
      );
      if (!proceed) return;
      host.cancel();
    }
    host.reset();
    setSelectedId(id);

    const target = tools.find((t) => t.manifest.id === id);
    if (target?.kind === "panel") {
      const mounted = host.mountPanel(target.manifest.id, filePath);
      if (!mounted)
        setPanelBlockedMessage(
          "Another tool is still running. Cancel it before opening Land Placement.",
        );
    }
  };

  const setParam = (key: string, value: ParamValue) =>
    setSubmittedParam(key, value);

  const run = () => {
    if (!tool || !parseResult) return;

    // Sec.4.3 pin 5: the source-equality gate is FALSE for the whole debounce
    // window after every keystroke, so a Run pressed just after typing would do
    // nothing with no affordance, the shape of bug users report as "the button
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

  // Sec.3.3: read-only, granted only under `read-preview-view` (buildToolContext
  // gates it the same way as every other field). Both providers sit above this
  // component in App.tsx, so they are always available to read here regardless
  // of whether the currently-selected tool actually declares the capability.
  const previewView = usePreviewView();
  const previewCut = usePreviewCut();
  // The same include files the preview pane reads, so a tool generates the
  // map the pane draws (useIncludeFiles shares one read between the two).
  const includeFiles = useIncludeFiles(parseResult);

  const startRun = useCallback(() => {
    if (!tool || !parseResult) return;
    const { params } = resolveParams(tool.manifest.params, submitted);

    // Sec.6: capabilities gate what the host PUTS IN the context, even for
    // trusted built-ins. An undeclared field is simply absent, which keeps the
    // contract honest before v1.1 makes it a trust boundary. Pulled out to a
    // pure function (buildToolContext.ts). See its own doc comment.
    const ctx = buildToolContext({
      capabilities: tool.manifest.capabilities,
      params,
      parseResult,
      generation: {
        playerCount: generation.playerCount,
        mapSize: generation.mapSize,
        teams: generation.teams,
        teamPositions: generation.teamPositions,
      },
      lang,
      gameConstants,
      includeFiles,
      previewView: { seed: previewView.seed, cutOffset: previewCut.cutOffset },
    });
    // Sec.4.3, Sec.7.2 item 3: the runner is picked per run, at the call
    // site, so `host` itself stays one shared instance with an unchanged
    // `useMemo`. See ToolHost.start's own doc comment for why that matters.
    const runner = WORKER_RUNTIME_TOOL_IDS.has(tool.manifest.id)
      ? workerRunner
      : inProcessRunner;
    host.start(
      tool,
      ctx,
      parseResult.source,
      runner,
      { playerCount: generation.playerCount, mapSize: generation.mapSize },
      filePath,
    );
  }, [
    tool,
    parseResult,
    submitted,
    generation,
    host,
    filePath,
    previewView.seed,
    previewCut.cutOffset,
    includeFiles,
  ]);

  useEffect(() => {
    if (pendingRun && parseResult && parseResult.source === source) {
      setPendingRun(false);
      startRun();
    }
  }, [pendingRun, parseResult, source, startRun]);

  // A `runOnSelect` tool runs when picked, and when the pane opens on it with
  // nothing run yet. Keyed on the tool id and the idle phase only, so it fires
  // once per pick rather than on every keystroke's new parse. `pendingRun`
  // routes it through the same parse gate as a Run press.
  const runOnSelect = tool?.manifest.runOnSelect === true;
  const idle = state.phase === "idle";
  useEffect(() => {
    if (runOnSelect && idle && filePath !== null) setPendingRun(true);
  }, [runOnSelect, idle, selectedId, filePath]);

  // The left column App mounts beside the map header, when it is there. The
  // tool picker and Run go in its top row, the description and parameters in
  // its body (ToolsSlots.tsx). With no column (a test, or any caller outside
  // App) everything stays inline in the pane.
  const slots = useToolsSlots();
  // A panel tool (Land Placement) has its own columns and nothing for the left
  // column's body to hold, so the two body columns merge into one that takes
  // the whole row. The title row is unchanged and keeps the tool picker. Every
  // other tool keeps its options on the left and its output on the right.
  // Effect cleanup splits the body again when the tool goes.
  const panelMergesBody =
    tool?.kind === "panel" && panelState.phase === "mounted";
  const { setBodyMerged } = slots;
  useEffect(() => {
    setBodyMerged(panelMergesBody);
    return () => setBodyMerged(false);
  }, [panelMergesBody, setBodyMerged]);
  // The header slot alone decides the picker's look. The body slot is gone
  // while the body is merged, and the picker is still in the column then.
  const inColumn = slots.header !== null;
  const intoHeader = (node: ReactNode) =>
    slots.header ? createPortal(node, slots.header) : node;
  const intoBody = (node: ReactNode) =>
    slots.body ? createPortal(node, slots.body) : node;

  const canApply = host.canApply(source);
  const stale = state.edits !== null && state.edits.length > 0 && !canApply;
  // The kept report was made from different text than the editor holds now.
  // Not shown when the edit-apply notice above already says so.
  const outputStale =
    !stale &&
    state.phase === "done" &&
    state.output !== null &&
    state.snapshot !== source;

  const apply = () => {
    if (!state.edits) return;
    // Validate again at the point of use: a buggy external tool can emit
    // anything and the staleness guard alone does not catch same-version
    // garbage. ANY violation rejects the whole set.
    const check = validateEdits(state.edits, source.length);
    if (!check.ok) {
      void message(`These changes were rejected: ${check.problem}`);
      return;
    }
    applyTextEdits(state.edits);
    reparseNow(source);
    host.reset();
  };

  if (filePath === null) {
    return (
      <div className={styles.pane} data-tutorial-anchor="tools.pane">
        <p className={styles.empty}>Open a script to run a tool against it.</p>
      </div>
    );
  }

  const busy = state.phase === "running" || state.phase === "cancelling";
  // A panel tool (e.g. Land Placement) unmounts unconditionally on File >
  // Open (host.documentReplaced -> unmountPanel), but nothing here resets
  // `selectedId` — the dropdown still shows the panel tool selected, and
  // without this guard the code below falls into the generic report-tool
  // branch and renders a live "Run" button wired to a tool that has no
  // run() at all, which throws in inProcessRunner. Re-selecting the SAME
  // dropdown option also fires no onChange, so "Reopen" below calls
  // selectTool directly rather than relying on the select element.
  const panelClosedByDocumentChange =
    tool?.kind === "panel" && panelState.phase !== "mounted";
  const submittable = tool
    ? paramsAreSubmittable(tool.manifest.params, submitted)
    : false;
  // Sec.5.2, keyed on the OUTPUT's own tool (state.toolId), not the
  // currently selected one: selecting a different tool resets state first, so
  // the two agree while a result is showing, but state.toolId is what the
  // output actually belongs to.
  const outputOwnsSettingsHeader =
    tools.find((t) => t.manifest.id === state.toolId)?.manifest
      .ownsSettingsHeader === true;

  // Sec.3.2/Sec.3.6: a panel-kind tool renders its own component instead of
  // the report-tool run/output UI below. It has no `run()`, no params form
  // and no Apply-through-ToolHost path (Sec.3.6(a): a panel computes and
  // applies its own edits synchronously). `component` is `unknown` in the
  // registry by design (registry.ts's own comment: "no panel component
  // exists yet... this module must not import React to type it"); this is
  // the one call site that narrows it back to a real component type.
  if (tool?.kind === "panel" && panelState.phase === "mounted") {
    const PanelComponent = tool.component as typeof LandPlacementPanel;
    return (
      <div className={styles.pane} data-tutorial-anchor="tools.pane">
        {intoHeader(
          <div
            className={`${styles.controls} ${inColumn ? styles.columnControls : ""}`}
          >
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
          </div>,
        )}
        {parseResult ? (
          <PanelErrorBoundary>
            <PanelComponent
              parseResult={parseResult}
              source={source}
              reparseNow={reparseNow}
              applyTextEdits={applyTextEdits}
              onJumpToOffset={onJumpToOffset}
              playerCount={generation.playerCount}
              mapSize={generation.mapSize}
              teams={generation.teams}
              teamPositions={generation.teamPositions}
              lang={lang}
            />
          </PanelErrorBoundary>
        ) : (
          <p className={styles.empty}>Waiting for a parse…</p>
        )}
      </div>
    );
  }

  return (
    <div className={styles.pane} data-tutorial-anchor="tools.pane">
      {intoHeader(
        <div
          className={`${styles.controls} ${inColumn ? styles.columnControls : ""}`}
        >
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

          {panelBlockedMessage && (
            <p className={styles.staleNote}>{panelBlockedMessage}</p>
          )}

          {panelClosedByDocumentChange ? (
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => void selectTool(tool!.manifest.id)}
            >
              Reopen {tool!.manifest.name}
            </button>
          ) : busy ? (
            <HelpTip id="tools.cancel">
              <button
                type="button"
                className={styles.button}
                onClick={() => host.cancel()}
                disabled={state.phase === "cancelling"}
              >
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
                Apply {state.edits?.length} change
                {state.edits?.length === 1 ? "" : "s"}
              </button>
            </HelpTip>
          )}
        </div>,
      )}

      {intoBody(
        <>
          {tool && (
            <p className={styles.description}>{tool.manifest.description}</p>
          )}

          {tool?.manifest.params && tool.manifest.params.length > 0 && (
            <HelpTip id="tools.params">
              <div className={styles.params}>
                {tool.manifest.params.map((def) => (
                  <ParamRow
                    key={def.key}
                    def={def}
                    value={submitted[def.key]}
                    onChange={(v) => setParam(def.key, v)}
                  />
                ))}
              </div>
            </HelpTip>
          )}
        </>,
      )}

      {busy && (
        <HelpTip id="tools.progress">
          <div>
            <div className={styles.progressTrack}>
              {state.progress?.fraction !== undefined ? (
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${Math.round(state.progress.fraction * 100)}%`,
                  }}
                />
              ) : (
                <div className={styles.progressIndeterminate} />
              )}
            </div>
            {state.progress?.note && (
              <p className={styles.progressNote}>{state.progress.note}</p>
            )}
          </div>
        </HelpTip>
      )}

      {stale && (
        <p className={styles.staleNote}>
          The code changed since this ran. Re-run before applying. Tool edits
          are never rebased.
        </p>
      )}

      {outputStale && (
        <HelpTip id="tools.outputStale">
          <p className={styles.staleNote}>
            The script has been edited since this ran, so these results may be
            out of date. Run again to refresh them.
          </p>
        </HelpTip>
      )}

      {state.error && (
        <div className={`${styles.severity} ${styles.error}`}>
          <strong>{state.error.reason}</strong> · {state.error.message}
        </div>
      )}

      {state.output && (
        <HelpTip id="tools.output">
          <div className={styles.output}>
            {/* Echoing the run's settings makes a stale result self-describing
                instead of silently wrong: change the player count mid-run and
                the pane would otherwise show results for the old value, labelled
                with nothing. Read from `state.settingsSnapshot` (the settings
                THIS run was started at), never the live `generation` context.
                The live context changes after Run and would re-label a finished
                report with a setting it was never run at (docs/known-issues.md
                BUG-014). Suppressed for a tool that declares its own header
                (ownsSettingsHeader), for a multi-player-count report this echo
                would duplicate the tool's own header and can only name one
                player count anyway. */}
            {!outputOwnsSettingsHeader && state.settingsSnapshot && (
              <p className={styles.description}>
                Run at {state.settingsSnapshot.playerCount} players,{" "}
                {state.settingsSnapshot.mapSize}
              </p>
            )}
            <OutputSections
              blocks={state.output.blocks}
              lineOffsets={parseResult?.lineOffsets}
              onJump={onJumpToOffset}
            />
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

      {panelClosedByDocumentChange && (
        <p className={styles.empty}>
          {tool!.manifest.name} closed because the open document changed.
        </p>
      )}

      {!panelClosedByDocumentChange &&
        !state.output &&
        !state.error &&
        !busy && <p className={styles.empty}>Waiting for tool selection…</p>}
    </div>
  );
}

function ParamRow({
  def,
  value,
  onChange,
}: {
  def: ToolParamDef;
  value: unknown;
  onChange: (v: ParamValue) => void;
}) {
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
          <input
            type="checkbox"
            checked={typeof value === "boolean" ? value : def.default}
            onChange={(e) => onChange(e.target.checked)}
          />
          {label}
        </label>
      );
    case "integer":
      return (
        <label className={styles.paramRow}>
          {label}
          <DraftNumberInput
            className={styles.input}
            min={def.min}
            max={def.max}
            value={typeof value === "number" ? value : def.default}
            onCommit={onChange}
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
          <select
            className={styles.select}
            value={typeof value === "string" ? value : def.default}
            onChange={(e) => onChange(e.target.value)}
          >
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "multiSelect": {
      const picked = new Set(
        Array.isArray(value) ? (value as string[]) : def.default,
      );
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
                    onChange(
                      def.options
                        .filter((x) => next.has(x.value))
                        .map((x) => x.value),
                    );
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

/** A heading and the blocks under it, up to the next heading. `heading` is undefined for whatever comes before the first one. */
interface OutputSection {
  heading: string | undefined;
  blocks: OutputBlock[];
}

function groupSections(blocks: readonly OutputBlock[]): OutputSection[] {
  const sections: OutputSection[] = [];
  for (const block of blocks) {
    if (block.kind === "heading") {
      sections.push({ heading: block.text, blocks: [] });
    } else {
      if (sections.length === 0)
        sections.push({ heading: undefined, blocks: [] });
      sections[sections.length - 1].blocks.push(block);
    }
  }
  return sections;
}

/**
 * A tool's output as sections that can each be hidden, one per heading block.
 *
 * Hidden sections are remembered by heading text, not by position, so a
 * section hidden before Run stays hidden in the next run's report even when
 * an earlier section appears or goes. The state lives here and not in the
 * tool, because hiding is a way of reading the report, not part of it, so
 * the published block contract needs nothing new for it.
 */
function OutputSections({
  blocks,
  lineOffsets,
  onJump,
}: {
  blocks: readonly OutputBlock[];
  lineOffsets: readonly number[] | undefined;
  onJump: (offset: number) => void;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const toggle = (heading: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(heading)) next.delete(heading);
      else next.add(heading);
      return next;
    });

  return (
    <>
      {groupSections(blocks).map((section, i) => {
        const body = section.blocks.map((block, j) => (
          <Block
            key={j}
            block={block}
            lineOffsets={lineOffsets}
            onJump={onJump}
          />
        ));
        if (section.heading === undefined)
          return (
            <div key={i} className={styles.sectionBody}>
              {body}
            </div>
          );
        const heading = section.heading;
        const open = !hidden.has(heading);
        return (
          <section key={i} className={styles.section}>
            <StickyBar
              className={styles.sectionBar}
              heightVar="--section-bar-height"
            >
              <HelpTip id="tools.sectionToggle">
                <button
                  type="button"
                  className={styles.sectionToggle}
                  aria-expanded={open}
                  onClick={() => toggle(heading)}
                >
                  <span className={styles.sectionCaret} aria-hidden="true">
                    {open ? "▾" : "▸"}
                  </span>
                  <h3 className={styles.heading}>{heading}</h3>
                </button>
              </HelpTip>
            </StickyBar>
            {open && body.length > 0 && (
              <div className={styles.sectionBody}>{body}</div>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * A sticky bar that writes its own height onto its parent as `heightVar`, so
 * the sticky rows below it (a section title, a table header) can sit exactly
 * under it. Measured rather than written into the CSS, because the bar's real
 * height comes from its contents, the HelpTip wrapper's line box among them,
 * and a guessed figure left a gap where the table showed through, or an
 * overlap. A ResizeObserver keeps it right when the font or the wrapping
 * changes.
 */
function StickyBar({
  className,
  heightVar,
  children,
}: {
  className: string | undefined;
  heightVar: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = ref.current;
    const parent = bar?.parentElement;
    if (!bar || !parent) return;
    const write = () =>
      parent.style.setProperty(heightVar, `${bar.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [heightVar]);
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * A `tabs` block. The chosen tab is kept by label, so a partial report that
 * adds a tab, or a rerun, leaves the reader on the tab they were reading.
 * A label that is gone falls back to the first tab.
 */
function TabsBlock({
  tabs,
  lineOffsets,
  onJump,
}: {
  tabs: readonly { label: string; blocks: OutputBlock[] }[];
  lineOffsets: readonly number[] | undefined;
  onJump: (offset: number) => void;
}) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const active = tabs.find((t) => t.label === chosen) ?? tabs[0];
  return (
    <div className={styles.outputTabs}>
      {/* The sticky element is this bar and not the row inside the HelpTip.
          A sticky box only travels within its parent, and the HelpTip's
          wrapper is exactly as tall as the row, so the row could never move.
          This bar's parent is the whole tabs block, so the tabs stay in view
          for every section of the report. */}
      <StickyBar className={styles.outputTabBar} heightVar="--tab-bar-height">
        <HelpTip id="tools.outputTabs">
          <div className={styles.outputTabRow} role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={tab === active}
                className={
                  tab === active
                    ? `${styles.outputTab} ${styles.outputTabActive}`
                    : styles.outputTab
                }
                onClick={() => setChosen(tab.label)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </HelpTip>
      </StickyBar>
      <div role="tabpanel" className={styles.outputTabPanel}>
        <OutputSections
          blocks={active.blocks}
          lineOffsets={lineOffsets}
          onJump={onJump}
        />
      </div>
    </div>
  );
}

type TableOutputBlock = Extract<OutputBlock, { kind: "table" }>;

/** Which column the reader sorted by, and which way. `null` is the tool's own order. */
type TableSort = { column: number; descending: boolean } | null;

/**
 * A `table` block. Headers the tool gave `sortKeys` for are buttons: the
 * first click sorts ascending, the second descending, the third returns to
 * the tool's own order. Rows are sorted by index, so each row keeps its own
 * rowSpan and bar wherever it lands.
 */
function TableBlock({
  block,
  onJump,
}: {
  block: TableOutputBlock;
  onJump: (span: Span) => void;
}) {
  const [sort, setSort] = useState<TableSort>(null);
  const keysFor = (column: number) =>
    block.sortKeys?.find((k) => k.column === column)?.values;

  const order = block.rows.map((_, i) => i);
  const keys = sort ? keysFor(sort.column) : undefined;
  if (sort && keys) {
    order.sort((a, b) => {
      const ka = keys[a];
      const kb = keys[b];
      // Rows with no value go last whichever way the column is sorted.
      if (ka === null && kb === null) return a - b;
      if (ka === null) return 1;
      if (kb === null) return -1;
      const byKey = sort.descending ? kb - ka : ka - kb;
      // Equal keys keep the tool's order, so a sort never shuffles ties.
      return byKey !== 0 ? byKey : a - b;
    });
  }
  // Beyond the cap the pane says how many are hidden rather than truncating
  // silently. A table that quietly stops is indistinguishable from a tool
  // that found fewer results. Capped after sorting, so a sort reaches the
  // rows the cap would otherwise cut.
  const { rows: shown, hidden } = tableRowsToRender(
    order.map((i) => block.rows[i]),
  );

  const nextSort = (column: number) =>
    setSort((prev) =>
      prev?.column !== column
        ? { column, descending: false }
        : !prev.descending
          ? { column, descending: true }
          : null,
    );
  const alignClass = (column: number) => {
    const align = block.align?.[column];
    if (align === "center") return styles.alignCenter;
    if (align === "right") return styles.alignRight;
    return undefined;
  };

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {block.columns.map((c, i) => {
              const label = (
                <span className={styles.headerLabel} title={c}>
                  {c}
                </span>
              );
              if (!keysFor(i))
                return (
                  <th key={i} className={alignClass(i)}>
                    {label}
                  </th>
                );
              const arrow =
                sort?.column === i ? (sort.descending ? "▼" : "▲") : "";
              return (
                <th
                  key={i}
                  className={alignClass(i)}
                  aria-sort={
                    sort?.column === i
                      ? sort.descending
                        ? "descending"
                        : "ascending"
                      : "none"
                  }
                >
                  <HelpTip id="tools.tableSort">
                    <button
                      type="button"
                      className={styles.sortHeader}
                      onClick={() => nextSort(i)}
                    >
                      {label}
                      <span className={styles.sortArrow} aria-hidden="true">
                        {arrow}
                      </span>
                    </button>
                  </HelpTip>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, position) => {
            const i = order[position];
            const span = block.rowSpans?.[i] ?? null;
            return (
              <tr
                key={i}
                className={span ? styles.rowLink : undefined}
                onClick={span ? () => onJump(span) : undefined}
              >
                {row.map((cell, j) => {
                  const bar =
                    block.bars?.column === j ? block.bars.values[i] : undefined;
                  if (bar === undefined || bar === null)
                    return (
                      <td key={j} className={alignClass(j)}>
                        {cell}
                      </td>
                    );
                  return (
                    <td key={j} className={alignClass(j)}>
                      <span className={styles.barCell}>
                        <span className={styles.barTrack} aria-hidden="true">
                          <span
                            className={`${styles.barFill} ${barTone(bar)}`}
                            style={{ width: `${bar * 100}%` }}
                          />
                        </span>
                        {cell}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {hidden > 0 && (
        <p className={styles.description}>
          Showing the first {shown.length} of {shown.length + hidden} rows.
        </p>
      )}
    </div>
  );
}

/** Green when every attempt placed, yellow from 40%, red below, per the checker's spawn rate bar. */
function barTone(value: number): string {
  if (value >= 1) return styles.barFull;
  if (value >= 0.4) return styles.barPartial;
  return styles.barLow;
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
    case "tabs":
      return (
        <TabsBlock
          tabs={block.tabs}
          lineOffsets={lineOffsets}
          onJump={onJump}
        />
      );
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
    case "table":
      return <TableBlock block={block} onJump={jump} />;
    case "severity":
      return (
        <div className={`${styles.severity} ${styles[block.level]}`}>
          {block.text}
          {block.span && lineOffsets && (
            <>
              {" "}
              <button
                type="button"
                className={styles.codeRef}
                onClick={() => jump(block.span!)}
              >
                line {lineNumberOfOffset(lineOffsets, block.span.start)}
              </button>
            </>
          )}
        </div>
      );
    case "codeRef":
      return (
        <button
          type="button"
          className={styles.codeRef}
          onClick={() => jump(block.span)}
        >
          {block.text}
        </button>
      );
  }
}
