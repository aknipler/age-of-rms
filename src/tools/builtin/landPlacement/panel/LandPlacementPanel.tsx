// The Land Placement panel (land-placement-design.md Sec.8): "the minimum
// that makes an authoring loop real; create a ring, set its numbers, see
// it, Apply." A React component over the tested pure functions in
// viewModel.ts and modelOps.ts; per this brief's §5 rule, nothing here does
// arithmetic, a cycle check, or truncation logic of its own.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { message } from "@tauri-apps/plugin-dialog";
import { HelpTip } from "../../../../components/HelpTip";
import { TrashIcon } from "../../../../components/TrashIcon";
import {
  MAX_PLAYER_COUNT,
  type MapSize,
} from "../../../../generationSettings/generationSettingsConstants";
import type { LanguageData } from "../../../../parser/language";
import type { ParseResult, SymbolInfo } from "../../../../parser/types";
import { resolveMapDim } from "../../../../preview/generator/mapDimensions";
import type { Expr, TextEdit } from "../../../../../tools-api/index";
import { computeApplyEdits } from "../applyEdits";
import {
  buildDirectPlacementFix,
  buildElevationSectionFix,
  checkP1,
  checkP2,
  checkP3,
  checkP6,
} from "../preconditions";
import { parseFormula } from "../compiler/frontend";
import {
  bindParamLabels,
  computeFormulaFeedback,
  describeUnknownName,
  exprToFormulaText,
  findUnknownNames,
  NO_PARAMS,
  type FormulaParamEnv,
} from "./formulaField";
import { locateFence, readFenceModel } from "../fence";
import type { AlpModel } from "../fence";
import { jitterUnitsForKind } from "../prologue";
import { perimeterSides } from "../expand";
import { computeJitterAmount, type JitterUnit } from "./jitter";
import {
  ROLE_OPTIONAL_ATTRIBUTES,
  effectiveRole,
  type Anchor,
  type AssignPolicy,
  type AssignTarget,
  type ChainTemplate,
  type FrameKind,
  type LandExtent,
  type LandRole,
  type PatternSlot,
  type Placement,
  type PlayerSlot,
  type RoleOptionalField,
  type RoleOverrides,
  type ShapeGroup,
  type ZonePolicy,
} from "../model";
import {
  addChainTemplate,
  addPatternSlot,
  addRandomParam,
  addRing,
  addRole,
  addShapeOriginPoint,
  addStandalonePlacement,
  applyDragToPlacement,
  applyGroupEdit,
  deleteGroup,
  deleteRole,
  deleteStandalonePlacement,
  groupForMember,
  clearRoleOverride,
  deleteRandomParam,
  isGroupMember,
  isParamReferenced,
  jitterGroupForParam,
  materialiseRndParams,
  removeChainTemplate,
  removeGroupJitter,
  removePatternSlot,
  setGroupJitter,
  setGroupKind,
  setRoleOverride,
  setSlotRole,
  setThetaPerCountOverride,
  shapeOriginCandidates,
  updateChainTemplate,
  updatePlacement,
  updateRandomParam,
  updateRole,
} from "./modelOps";
import {
  availableThetaPerCountOptions,
  checkP4ForPanel,
  computePlacementAttachment,
  defaultSelection,
  firstRawNodeSpan,
  flattenPlacementTree,
  formatExtentLabel,
  formatPercentWithTiles,
  resolveSelection,
  SHAPE_KIND_LABELS,
  shapeDisplayName,
  shapeGroupLandTotal,
  shapeRoleIds,
  wouldCreateCycle,
} from "./viewModel";
import { buildPlacementTree } from "./viewModel";
import { useEmission } from "./useEmission";
import { useLandPlacementModel, EMPTY_MODEL } from "./landPlacementModel";
import { usePanelPreviewSeed } from "./panelPreviewSeed";
import { LandPlacementCanvas } from "./LandPlacementCanvas";
import { LandPlacementHelpDialog } from "./LandPlacementHelpDialog";
import styles from "./LandPlacementPanel.module.css";

/** The "with role" picker's (none) option value. */
const NO_ROLE = "";

/**
 * Ambient facts every `FormulaField` needs about the model's RandomParams
 * (2026-09-22): a `param` leaf displays as its label and parses back from
 * it, previews at its midpoint, and a typed `rnd(a,b)` becomes a real param
 * on commit through `onChangeModel`. A context rather than props because
 * sixteen fields, several of them inside helpers that take no model, would
 * otherwise each need three more props threaded through. This is React's
 * standard answer to "every leaf needs the same ambient value"; the model
 * itself still flows through props, only the param environment is ambient.
 */
const FormulaEnvContext = createContext<{
  params: FormulaParamEnv;
  /** The model as rendered, what new param ids are allocated against. */
  model: AlpModel | null;
  onChangeModel: ((updater: (prev: AlpModel) => AlpModel) => void) | null;
  /** Every `#const` and `#define` in the document, whichever branch it sits in, for `findUnknownNames`. */
  scriptSymbols: readonly SymbolInfo[];
}>({ params: NO_PARAMS, model: null, onChangeModel: null, scriptSymbols: [] });

/**
 * The warning under a formula box for each name it uses that has no value
 * at the settings being previewed (`findUnknownNames`). Shown from the live
 * text, so it appears while typing and stays after saving, which is what
 * explains a canvas that has gone blank. Its own component so both formula
 * boxes render the same check, and so the memo lives next to the one place
 * that reads it.
 */
function UnknownNameNotes({
  text,
  resolveSym,
}: {
  text: string;
  resolveSym: (name: string) => number | undefined;
}) {
  const env = useContext(FormulaEnvContext);
  const unknown = useMemo(
    () => findUnknownNames(text, resolveSym, env.params, env.scriptSymbols),
    [text, resolveSym, env.params, env.scriptSymbols],
  );
  return (
    <>
      {unknown.map((u) => (
        <span key={u.name} className={styles.formulaWarning}>
          {describeUnknownName(u)}
        </span>
      ))}
    </>
  );
}

export interface LandPlacementPanelProps {
  parseResult: ParseResult;
  source: string;
  reparseNow: (source: string) => void;
  applyTextEdits: (edits: readonly TextEdit[]) => void;
  onJumpToOffset: (offset: number) => void;
  playerCount: number;
  mapSize: MapSize;
  lang: LanguageData;
}

export function LandPlacementPanel({
  parseResult,
  source,
  reparseNow,
  applyTextEdits,
  onJumpToOffset,
  playerCount,
  mapSize,
  lang,
}: LandPlacementPanelProps) {
  const {
    model: storeModel,
    setModel,
    load,
    markSaved,
    selection,
    setSelection,
  } = useLandPlacementModel();
  const { seed, reseed } = usePanelPreviewSeed();
  // Local, not in `landPlacementModel.tsx`'s store: an open explanation
  // dialog is not part of the model, and it should not survive a tab switch
  // the way the model deliberately does (Sec.3.6(b)).
  const [helpOpen, setHelpOpen] = useState(false);
  // Which role `+ Shape`, `+ Land` and a group's `+ slot` create with. Local
  // like `helpOpen` (a preference, not model state), and RESOLVED on read
  // rather than trusted: the chosen role can be deleted out from under it,
  // so the effective id falls back to the first role whenever the stored
  // one is gone. Keeping the raw choice and deriving the effective value is
  // the alternative to an effect that "fixes" state after the fact, which
  // would render one frame with a dangling id.
  const [newRoleChoice, setNewRoleChoice] = useState<string | null>(null);
  // What the last Apply did, in words, shown under the button until the
  // model changes again (2026-09-22: "there isn't enough feedback to show
  // that the code has been applied"). Keyed to the model object so an edit
  // clears it without an effect: a report about a previous model is stale
  // the moment the model is a different object.
  const [lastApply, setLastApply] = useState<{
    report: import("../applyEdits").ApplyReport;
    forModel: AlpModel;
  } | null>(null);

  // Sec.3.6(a): loaded once when the panel mounts, never again from the
  // fence. After this, `model` is the tool's own in-memory state and the
  // document only changes it back via a successful Apply. `storeModel` is
  // null exactly on a FRESH mount (a genuine tool selection, or after an
  // unmount+reselect) and non-null across a mere suspend/resume tab-switch
  // (the model is retained then, Sec.3.6(b)), so guarding both this load
  // and the seed pin on it is what makes "pinned on mount" mean the panel's
  // own mount rather than every React remount a tab switch causes.
  //
  // The default selection rides on this same load, and that is the whole
  // mechanism that keeps it from clobbering a kept selection. A return from
  // the Code or Breakdown tab remounts this component with `storeModel`
  // already set, so neither the load nor the default runs again.
  useEffect(() => {
    if (storeModel === null) {
      const loaded = readFenceModel(parseResult) ?? EMPTY_MODEL;
      load(loaded, defaultSelection(loaded));
      reseed();
    }
    // Deliberately mount-only (the `storeModel === null` guard makes this
    // idempotent even under StrictMode's double-invoke). This must NOT
    // re-fire on every keystroke reparse, which is what a `parseResult`
    // dependency would do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = storeModel ?? EMPTY_MODEL;
  const mapDim = resolveMapDim(mapSize, lang.predefinedLabels ?? []) ?? 0;

  const dry = useEmission(parseResult, model, lang, playerCount, mapSize, seed);
  const emission = dry?.emission ?? null;

  // The formula field's own resolver (Sec.8's "resulting position" part of
  // its live feedback): this model's own dry-run values first (so a formula
  // can reference a sibling placement's already-emitted name), falling back
  // to the document's pre-existing #consts. `useCallback` so a field whose
  // OWN text hasn't changed doesn't recompute its feedback on every
  // unrelated keystroke elsewhere in the panel.
  const resolveSym = useCallback(
    (name: string): number | undefined =>
      (emission?.ok ? emission.resolved.get(name) : undefined) ??
      dry?.scriptSymbols.get(name),
    [emission, dry],
  );

  // --- Preconditions (Sec.9) ------------------------------------------------

  const p1 = checkP1(parseResult);
  const p2 = checkP2(model.randomParams, playerCount);
  const p3 = checkP3(model.roles, parseResult);
  const p6 = checkP6(model.placements, parseResult);
  // Hands over the emission rather than a name list, so which names are the
  // candidates is that function's decision and not this one's. See its own
  // doc comment for why it is shaped that way.
  const p4 = checkP4ForPanel(emission?.ok ? emission : null, parseResult, lang);
  const fenceExists = locateFence(parseResult) !== null;
  const p5Malformed = fenceExists && readFenceModel(parseResult) === null;

  // --- Tree + attachment -----------------------------------------------------

  const tree = useMemo(
    () => flattenPlacementTree(buildPlacementTree(model)),
    [model],
  );
  const attachment = useMemo(
    () =>
      emission?.ok
        ? computePlacementAttachment(parseResult, model, emission)
        : new Map<string, boolean | null>(),
    [parseResult, model, emission],
  );

  // `useMemo` because the canvas lists `highlightIds` as a dependency, and a
  // fresh Set on every render would redraw the overlay on every render.
  const resolved = useMemo(
    () => resolveSelection(model, selection),
    [model, selection],
  );
  const selectLand = (id: string | null) =>
    setSelection(
      id === null
        ? null
        : selection?.kind === "land" && selection.id === id
          ? null
          : { kind: "land", id },
    );
  // `newRoleChoice` is null until the user picks, which means "the first
  // role". NO_ROLE is the picker's (none) option, the same "" the land
  // editor's own Role select uses for no role. `newRoleId` is null when
  // (none) is picked or no role exists. + Land then makes a chain anchor,
  // and + Shape and + slot make points (PatternSlot.role, 2026-09-28).
  const noRoleChosen = newRoleChoice === NO_ROLE;
  const newRoleId = noRoleChosen
    ? null
    : ((newRoleChoice !== null &&
      model.roles.some((r) => r.id === newRoleChoice)
        ? newRoleChoice
        : model.roles[0]?.id) ?? null);

  // --- Apply -----------------------------------------------------------------

  // `dry.scriptSymbols`, the DOCUMENT's own resolved #consts, never
  // `emission.resolved` (this model's own output). See useEmission.ts's own
  // doc comment for why those answer different questions.
  const applyPreview = useMemo(() => {
    if (storeModel === null || dry === null) return null;
    return computeApplyEdits(
      parseResult,
      model,
      lang,
      dry.scriptSymbols,
      playerCount,
    );
  }, [storeModel, dry, parseResult, model, lang, playerCount]);

  const apply = () => {
    if (!applyPreview || applyPreview.edits.length === 0) return;
    applyTextEdits(applyPreview.edits);
    reparseNow(source);
    markSaved();
    setLastApply({ report: applyPreview.report, forModel: model });
  };
  const applied = lastApply !== null && lastApply.forModel === model;
  const editCount = applyPreview?.edits.length ?? 0;
  // "Apply" the first time, "Update" once the script carries a fence, and
  // "Up to date" when there is nothing left to write.
  const applyLabel =
    editCount === 0
      ? applied
        ? "Applied, up to date"
        : "Up to date"
      : `${fenceExists ? "Update" : "Apply"} (${editCount} change${editCount === 1 ? "" : "s"})`;

  if (storeModel === null) {
    return <p className={styles.pane}>Loading…</p>;
  }

  const formulaEnv = {
    params: {
      labelOf: (id: string) =>
        model.randomParams.find((p) => p.id === id)?.label,
      idByLabel: new Map(model.randomParams.map((p) => [p.label, p.id])),
      previewOf: (id: string) =>
        emission?.ok ? emission.paramPreview.get(id) : undefined,
    },
    model,
    onChangeModel: setModel as (updater: (prev: AlpModel) => AlpModel) => void,
    scriptSymbols: parseResult.symbols,
  };

  return (
    <FormulaEnvContext.Provider value={formulaEnv}>
      <div className={styles.pane}>
        <PreconditionsStrip
          p1={p1}
          p1RawSpan={firstRawNodeSpan(parseResult)}
          p2Mismatches={p2.mismatches}
          p3={p3}
          p4Collisions={p4.collisions}
          p5Malformed={p5Malformed}
          p6={p6}
          parseResult={parseResult}
          onJumpToOffset={onJumpToOffset}
          applyTextEdits={applyTextEdits}
        />

        <HelpTip id="landPlacement.seed">
          <div className={styles.toolbar}>
            <span>Seed {seed}</span>
            <button type="button" onClick={reseed}>
              Re-roll
            </button>
          </div>
        </HelpTip>

        <div className={styles.toolbar}>
          <HelpTip id="landPlacement.newRole">
            <button
              type="button"
              onClick={() => {
                const { model: next, roleId } = addRole(model);
                setModel(next);
                setSelection({ kind: "role", id: roleId });
              }}
            >
              + Role
            </button>
          </HelpTip>
          <HelpTip
            id="landPlacement.newRing"
            text={
              newRoleId === null
                ? "Adds a shape of points only, with no lands on it. Other lands can be parented to its points or chained off them. Pick a role in the with role list to place lands instead."
                : undefined
            }
          >
            <button
              type="button"
              onClick={() => {
                // No role chosen (or none exist) makes a points-only shape.
                const { model: next, groupId } = addRing(
                  model,
                  newRoleId ?? undefined,
                );
                setModel(next);
                setSelection({ kind: "shape", id: groupId });
              }}
            >
              + Shape
            </button>
          </HelpTip>
          <HelpTip
            id="landPlacement.newLand"
            text={
              model.roles.length === 0
                ? "Add a role first. A land needs a role to assign it to."
                : undefined
            }
          >
            <button
              type="button"
              disabled={model.roles.length === 0}
              onClick={() => {
                const { model: next, id } = addStandalonePlacement(
                  model,
                  newRoleId ?? undefined,
                );
                setModel(next);
                setSelection({ kind: "land", id });
              }}
            >
              + Land
            </button>
          </HelpTip>
          {model.roles.length > 0 && (
            <HelpTip id="landPlacement.newWithRole">
              <label className={styles.newWithRole}>
                with role
                <select
                  value={newRoleId ?? NO_ROLE}
                  onChange={(e) => setNewRoleChoice(e.target.value)}
                >
                  <option value={NO_ROLE}>(none)</option>
                  {model.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </HelpTip>
          )}
          {/* Pinned to the right end of the same row. This one creates
            nothing, so sitting beside the three + buttons would read as a
            fourth thing to add.

            The class goes on a span AROUND the HelpTip rather than on the
            button, and that is not a style preference. HelpTip renders its
            own `display: inline-block` wrapper span, so the button is not a
            child of the flex row at all and `margin-left: auto` on it would
            resolve against the wrapper and do nothing. The auto margin has
            to sit on whichever element the flex container actually lays
            out. */}
          <span className={styles.toolbarEnd}>
            <HelpTip id="landPlacement.explain">
              <button type="button" onClick={() => setHelpOpen(true)}>
                Tool Explanation
              </button>
            </HelpTip>
          </span>
        </div>

        {helpOpen && (
          <LandPlacementHelpDialog onClose={() => setHelpOpen(false)} />
        )}

        <div className={styles.body}>
          <div className={styles.canvasColumn}>
            <LandPlacementCanvas
              model={model}
              emission={emission}
              parseResult={parseResult}
              lang={lang}
              mapSize={mapSize}
              playerCount={playerCount}
              selectedLandId={resolved.land?.id ?? null}
              selectedGroup={resolved.group}
              highlightIds={resolved.highlightIds}
              onSelect={selectLand}
              onModelChange={setModel}
            />
          </div>

          <div className={styles.rightColumn}>
            <ListSection
              title="Roles"
              columns={3}
              count={model.roles.length}
              helpId="landPlacement.roles"
              emptyText="No roles yet. Add one above."
              editor={
                resolved.role && (
                  // One editor slot serves every role, so without a key
                  // React would reuse this instance when the selection moves
                  // to another role, and a half-typed draft in a NumberInput
                  // or FormulaField below would carry over to it. A key that
                  // changes with the role makes React unmount and remount.
                  <RoleRow
                    key={resolved.role.id}
                    role={resolved.role}
                    lang={lang}
                    mapDim={mapDim}
                    resolveSym={resolveSym}
                    onChangeModel={setModel}
                  />
                )
              }
            >
              {model.roles.map((role) => (
                <GridRow
                  key={role.id}
                  cells={[
                    role.label,
                    role.terrain.k === "name"
                      ? role.terrain.name
                      : `terrain ${role.terrain.id}`,
                    countLabel(
                      model.placements.filter((p) => p.role === role.id).length,
                      "land",
                    ),
                  ]}
                  selected={resolved.role?.id === role.id}
                  onSelect={() =>
                    setSelection(
                      selection?.kind === "role" && selection.id === role.id
                        ? null
                        : { kind: "role", id: role.id },
                    )
                  }
                  onDelete={() => {
                    setModel((m) => deleteRole(m, role.id));
                    if (resolved.role?.id === role.id) setSelection(null);
                  }}
                  deleteHelpId="landPlacement.deleteRole"
                />
              ))}
            </ListSection>

            <ListSection
              title="Shapes"
              columns={3}
              count={model.groups.length}
              helpId="landPlacement.shapes"
              emptyText="No shapes yet. Add one above."
              editor={
                resolved.selection?.kind === "shape" &&
                resolved.group && (
                  <GroupEditor
                    key={resolved.group.id}
                    newRoleId={newRoleId}
                    model={model}
                    group={resolved.group}
                    mapDim={mapDim}
                    parseResult={parseResult}
                    emission={emission?.ok ? emission : null}
                    resolveSym={resolveSym}
                    onChangeModel={setModel}
                    onSelectLand={selectLand}
                    playerCount={playerCount}
                  />
                )
              }
            >
              {model.groups.map((group) => {
                const total = shapeGroupLandTotal(group);
                return (
                  <GridRow
                    key={group.id}
                    cells={[
                      shapeDisplayName(group),
                      describeShapeTotal(total),
                      shapeRoleIds(group)
                        .map(
                          (id) =>
                            model.roles.find((r) => r.id === id)?.label ?? id,
                        )
                        .join(", "),
                    ]}
                    selected={
                      resolved.selection?.kind === "shape" &&
                      resolved.selection.id === group.id
                    }
                    onSelect={() =>
                      setSelection(
                        selection?.kind === "shape" && selection.id === group.id
                          ? null
                          : { kind: "shape", id: group.id },
                      )
                    }
                    onDelete={() => {
                      setModel((m) => deleteGroup(m, group.id));
                      if (
                        resolved.selection?.kind === "shape" &&
                        resolved.selection.id === group.id
                      ) {
                        setSelection(null);
                      }
                    }}
                    deleteHelpId="landPlacement.deleteShape"
                  />
                );
              })}
            </ListSection>

            <ListSection
              title="Lands"
              columns={4}
              count={tree.length}
              helpId="landPlacement.tree"
              emptyText="No lands yet. Add a shape or a land above."
              editor={
                resolved.land && (
                  <PlacementEditor
                    key={resolved.land.id}
                    model={model}
                    lang={lang}
                    placement={resolved.land}
                    group={resolved.group}
                    mapDim={mapDim}
                    resolveSym={resolveSym}
                    onChangeModel={setModel}
                    onSelectShape={(id) => setSelection({ kind: "shape", id })}
                  />
                )
              }
            >
              {tree.map(({ placement, depth }) => (
                <TreeRow
                  key={placement.id}
                  placement={placement}
                  depth={depth}
                  model={model}
                  attached={attachment.get(placement.id) ?? null}
                  selected={resolved.land?.id === placement.id}
                  onSelect={() => selectLand(placement.id)}
                  onDelete={() => {
                    const id = placement.id;
                    setModel((m) => deleteStandalonePlacement(m, id));
                    if (resolved.land?.id === id) setSelection(null);
                  }}
                />
              ))}
            </ListSection>

            <RandomParamsSection model={model} onChangeModel={setModel} />

            <GeneratedCodeSection
              body={emission?.ok ? emission.body : null}
              lands={
                emission?.ok
                  ? model.placements
                      .map((p) => emission.createLandText.get(p.id))
                      .filter((t): t is string => t !== undefined)
                  : []
              }
              problems={emission?.ok === false ? emission.problems : []}
              editCount={editCount}
            />

            <HelpTip id="landPlacement.apply">
              <button
                type="button"
                disabled={!applyPreview || editCount === 0}
                onClick={apply}
              >
                {applyLabel}
              </button>
            </HelpTip>
            {applied && (
              <p className={styles.applyReport}>
                Written to the script: {describeApplyReport(lastApply.report)}.
              </p>
            )}
            {!applied && applyPreview !== null && editCount > 0 && (
              <p className={styles.applyReport}>
                Will {describeApplyReport(applyPreview.report)}
                {fenceExists
                  ? ", and rewrite the fenced #const block"
                  : ", and write the fenced #const block into the header"}
                .
              </p>
            )}
          </div>
        </div>
      </div>
    </FormulaEnvContext.Provider>
  );
}

// ---------------------------------------------------------------------------

function PreconditionsStrip({
  p1,
  p1RawSpan,
  p2Mismatches,
  p3,
  p4Collisions,
  p5Malformed,
  p6,
  parseResult,
  onJumpToOffset,
  applyTextEdits,
}: {
  p1: ReturnType<typeof checkP1>;
  p1RawSpan: ReturnType<typeof firstRawNodeSpan>;
  p2Mismatches: ReturnType<typeof checkP2>["mismatches"];
  p3: ReturnType<typeof checkP3>;
  p4Collisions: readonly string[];
  p5Malformed: boolean;
  p6: ReturnType<typeof checkP6>;
  parseResult: ParseResult;
  onJumpToOffset: (offset: number) => void;
  applyTextEdits: (edits: readonly TextEdit[]) => void;
}) {
  // A `fix` is an edit list BUILT HERE, at render time, against the current
  // parse, and applied through the same `applyTextEdits` the Apply button
  // uses, so a fix is an ordinary document edit (undoable, reparsed) and
  // never a second write path. Both builders are pure and tested in
  // preconditions.test.ts; this strip only chooses which to offer.
  const messages: {
    text: string;
    jumpTo?: number;
    fix?: { label: string; helpId: string; edits: readonly TextEdit[] };
  }[] = [];
  if (!p1.ok) {
    messages.push({
      text: `${(p1.rawFraction * 100).toFixed(1)}% of this script is code the app can only show as raw text, including ${p1.unmanagedLandCount} create_land commands. Land Placement cannot manage those.`,
      jumpTo: p1RawSpan?.start,
    });
  }
  for (const m of p2Mismatches) {
    messages.push({
      text: `Random parameter "${m.label}" was emitted for ${m.emittedFor} players; the script is now set to ${m.livePlayerCount}.`,
    });
  }
  if (!p3.ok) {
    messages.push({
      text: "A land is assigned to a player, but direct_placement is not declared. The engine may ignore the assignment.",
      fix: {
        label: "Add direct_placement",
        helpId: "landPlacement.fixDirectPlacement",
        edits: buildDirectPlacementFix(parseResult),
      },
    });
  }
  if (!p6.ok) {
    messages.push({
      text: "Every land this tool writes carries base_elevation, and this script has no <ELEVATION_GENERATION> section. Without it the engine silently ignores every base_elevation.",
      fix: {
        label: "Add <ELEVATION_GENERATION>",
        helpId: "landPlacement.fixElevationSection",
        edits: buildElevationSectionFix(parseResult),
      },
    });
  }
  if (p4Collisions.length > 0) {
    messages.push({
      text: `These names would collide with existing script symbols: ${p4Collisions.join(", ")}.`,
    });
  }
  if (p5Malformed) {
    messages.push({
      text: "This script has an Advanced Land Placement fence, but it could not be read. Starting from an empty model rather than guessing.",
    });
  }

  if (messages.length === 0) return null;

  return (
    <HelpTip id="landPlacement.preconditions">
      <div className={styles.preconditions}>
        {messages.map((m, i) => (
          <div key={i} className={`${styles.precondition} ${styles.warning}`}>
            {m.text}
            {m.jumpTo !== undefined && (
              <>
                {" "}
                <button type="button" onClick={() => onJumpToOffset(m.jumpTo!)}>
                  Go to code
                </button>
              </>
            )}
            {m.fix !== undefined && (
              <>
                {" "}
                <HelpTip id={m.fix.helpId}>
                  <button
                    type="button"
                    onClick={() => applyTextEdits(m.fix!.edits)}
                  >
                    {m.fix.label}
                  </button>
                </HelpTip>
              </>
            )}
          </div>
        ))}
      </div>
    </HelpTip>
  );
}

/** "1 land", "8 lands". */
function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "8 lands", "up to 8 lands", "8 points", or "8 lands, 8 points" for a shape mixing both kinds of slot. */
function describeShapeTotal(
  total: ReturnType<typeof shapeGroupLandTotal>,
): string {
  const upTo = total.exact ? "" : "up to ";
  const lands = `${upTo}${countLabel(total.count, "land")}`;
  const points = `${upTo}${countLabel(total.points, "point")}`;
  if (total.points === 0) return lands;
  return total.count === 0 ? points : `${lands}, ${points}`;
}

/**
 * One of the right column's three sections: a title with its count, a
 * clickable list, and the selected item's editor directly under the list.
 * The editor sits inside its own section rather than in one shared slot
 * below all three, so it opens next to the row that was clicked.
 *
 * `editor` is a prop rather than `children` because the section has two
 * slots. Passing JSX as a named prop is the usual React way to give a
 * component more than one place to put content (sometimes called a render
 * slot). `children` stays the list rows.
 */
function ListSection({
  title,
  columns,
  count,
  helpId,
  emptyText,
  editor,
  children,
}: {
  title: string;
  /** How many cells each row has. Every column but the last is as wide as its widest cell, and the last takes what is left. */
  columns: number;
  count: number;
  helpId: string;
  emptyText: string;
  editor: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>
        {title} ({count})
      </p>
      <HelpTip id={helpId}>
        <div
          className={`${styles.tree} ${styles.gridList}`}
          style={{
            gridTemplateColumns: `repeat(${columns - 1}, max-content) 1fr max-content`,
          }}
        >
          {count === 0 && <p className={styles.gridFull}>{emptyText}</p>}
          {children}
        </div>
      </HelpTip>
      {editor}
    </div>
  );
}

/**
 * One clickable row of a `ListSection`. The row is a subgrid of the list, so
 * its cells sit in the list's own columns and line up with every other row.
 * The alternative, a flex row per line, sizes each row's cells to that row's
 * own text, which is what made the tags drift before. An empty cell is still
 * rendered, since skipping it would shift the rest of the row one column left.
 *
 * The row itself used to be a `<button>`, but the trailing trash icon is a
 * real button too, and a button can't nest inside a button (invalid HTML,
 * and screen readers can't sensibly announce it). It's a `div` with
 * `role="button"` instead, with its own key handling to keep Enter/Space
 * selecting the row the way a native button would.
 */
function GridRow({
  cells,
  indent = 0,
  selected,
  onSelect,
  onDelete,
  deleteHelpId,
}: {
  cells: readonly ReactNode[];
  /** Tree depth, indenting the first cell only so the other columns stay aligned. */
  indent?: number;
  selected: boolean;
  onSelect: () => void;
  /** Trailing trash icon for this row. Omitted rows still get the column, just empty, so cells stay aligned. */
  onDelete?: () => void;
  /** HelpTip id for the trash icon; required whenever `onDelete` is passed. */
  deleteHelpId?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.gridRow} ${selected ? styles.gridRowSelected : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          className={
            i === 0 ? styles.gridCell : `${styles.gridCell} ${styles.muted}`
          }
          style={i === 0 && indent > 0 ? { paddingLeft: `${indent}rem` } : {}}
        >
          {cell}
        </span>
      ))}
      <span className={styles.gridDeleteCell}>
        {onDelete && (
          <HelpTip id={deleteHelpId ?? "landPlacement.deleteRole"}>
            <button
              type="button"
              className={styles.deleteButton}
              aria-label="Delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <TrashIcon />
            </button>
          </HelpTip>
        )}
      </span>
    </div>
  );
}

/** A land row. Its label, indented by chain depth, the shape it belongs to (blank for a standalone land), its role, then any overrides and a detached warning. */
function TreeRow({
  placement,
  depth,
  model,
  attached,
  selected,
  onSelect,
  onDelete,
}: {
  placement: Placement;
  depth: number;
  model: AlpModel;
  attached: boolean | null;
  selected: boolean;
  onSelect: () => void;
  /** Deletes this land. Only offered for a standalone land — a shape's member lands are deleted with the whole shape. */
  onDelete: () => void;
}) {
  const role = model.roles.find((r) => r.id === placement.role);
  const group = groupForMember(model, placement.id);
  const overrideCount = Object.keys(placement.roleOverrides ?? {}).length;
  return (
    <GridRow
      indent={depth}
      selected={selected}
      onSelect={onSelect}
      onDelete={group ? undefined : onDelete}
      deleteHelpId="landPlacement.deleteLand"
      cells={[
        placement.label,
        group ? shapeDisplayName(group) : "",
        role?.label ?? "",
        <>
          {overrideCount > 0 && countLabel(overrideCount, "override")}
          {overrideCount > 0 && attached === false && " "}
          {attached === false && (
            <span className={styles.detached}>detached</span>
          )}
        </>,
      ]}
    />
  );
}

function PlacementEditor({
  model,
  lang,
  placement,
  group,
  mapDim,
  resolveSym,
  onChangeModel,
  onSelectShape,
}: {
  model: AlpModel;
  lang: LanguageData;
  placement: Placement;
  /** The shape this land belongs to, if any. Its own settings are edited from the Shapes section. */
  group: ShapeGroup | undefined;
  mapDim: number;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
  onSelectShape: (groupId: string) => void;
}) {
  const inGroup = isGroupMember(model, placement.id);
  const parentOptions: Anchor[] = [
    "center",
    ...model.placements.filter((p) => p.id !== placement.id).map((p) => p.id),
  ];

  return (
    <HelpTip id="landPlacement.nodeEditor">
      <div className={styles.section}>
        <p className={styles.sectionTitle}>{placement.label}</p>

        <div className={styles.fieldRow}>
          <label>Label</label>
          <input
            type="text"
            value={placement.label}
            onChange={(e) =>
              onChangeModel((m) =>
                updatePlacement(m, placement.id, { label: e.target.value }),
              )
            }
          />
        </div>

        <div className={styles.fieldRow}>
          <label>Role</label>
          <select
            value={placement.role ?? ""}
            onChange={(e) =>
              onChangeModel((m) =>
                updatePlacement(m, placement.id, {
                  role: e.target.value || undefined,
                }),
              )
            }
          >
            <option value="">(none, chain anchor)</option>
            {model.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        {placement.role !== undefined &&
          (() => {
            const worn = model.roles.find((r) => r.id === placement.role);
            return worn ? (
              <RoleOverridesEditor
                placement={placement}
                role={worn}
                lang={lang}
                mapDim={mapDim}
                resolveSym={resolveSym}
                onChangeModel={onChangeModel}
              />
            ) : null;
          })()}

        {!inGroup && (
          <div className={styles.fieldRow}>
            <label>Parent</label>
            <select
              value={placement.parent}
              onChange={(e) => {
                const next = e.target.value;
                if (wouldCreateCycle(model, placement.id, next)) {
                  void message(
                    "That would make this placement its own ancestor.",
                  );
                  return;
                }
                onChangeModel((m) =>
                  updatePlacement(m, placement.id, { parent: next }),
                );
              }}
            >
              {parentOptions.map((id) => (
                <option key={id} value={id}>
                  {id === "center"
                    ? "Map centre"
                    : (model.placements.find((p) => p.id === id)?.label ?? id)}
                </option>
              ))}
            </select>
          </div>
        )}

        {!inGroup && (
          <div className={styles.fieldRow}>
            <label>Frame</label>
            <HelpTip id="landPlacement.frame">
              <button
                type="button"
                onClick={() =>
                  onChangeModel((m) =>
                    updatePlacement(m, placement.id, {
                      frame:
                        placement.frame === "radial"
                          ? ("absolute" as FrameKind)
                          : ("radial" as FrameKind),
                    }),
                  )
                }
              >
                {placement.frame}
              </button>
            </HelpTip>
          </div>
        )}

        {placement.offset.kind === "polar" && (
          <>
            {!inGroup && (
              <FormulaField
                label="Radius"
                value={placement.offset.r}
                fieldSuffix={`${placement.label}_R`}
                mapDim={mapDim}
                resolveSym={resolveSym}
                onCommit={(r) =>
                  onChangeModel((m) =>
                    updatePlacement(m, placement.id, {
                      offset: {
                        kind: "polar",
                        r,
                        theta: (placement.offset as { theta: Expr }).theta,
                      },
                    }),
                  )
                }
              />
            )}
            {/* per-player-escalation.md Sec.5: a ring member's own theta is
                editable regardless of group membership — Parent/Frame/Radius
                come from the group (Sec.4.1), but theta is the entire
                authoring surface for Sec.5.1's rules 2-4, and slice-b-brief.md
                item 1 found it silently unreachable here. `applyDragToPlacement`
                (not `updatePlacement`) so a group member's edit stamps
                `nudged`, the same flag a canvas drag sets, matching Sec.4.5's
                merge rule and what item 2's "has a rule" detection reads. */}
            <FormulaField
              label="Angle (deg)"
              value={placement.offset.theta}
              fieldSuffix={`${placement.label}_THETA`}
              resolveSym={resolveSym}
              onCommit={(theta) =>
                onChangeModel((m) =>
                  applyDragToPlacement(m, placement.id, {
                    kind: "polar",
                    r: (placement.offset as { r: Expr }).r,
                    theta,
                  }),
                )
              }
            />
            {/* Hidden on a perimeter shape, where a bearing alone does not
                pick a point (any-kind escalation Sec.6), unless the land
                already holds an override, say from a kind change. Then it
                stays on screen so the override can be seen and removed (the
                owner's call, that document's section 3 decision 9). */}
            {group?.perPlayer &&
              (perimeterSides(group) === undefined ||
                Object.keys(placement.thetaPerCount ?? {}).length > 0) && (
                <ThetaPerCountEditor
                  placement={placement}
                  onPerimeter={perimeterSides(group) !== undefined}
                  resolveSym={resolveSym}
                  onChangeModel={onChangeModel}
                />
              )}
          </>
        )}

        {!inGroup && placement.offset.kind === "cartesian" && (
          <>
            <FormulaField
              label="dx"
              value={placement.offset.dx}
              fieldSuffix={`${placement.label}_DX`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(dx) =>
                onChangeModel((m) =>
                  updatePlacement(m, placement.id, {
                    offset: {
                      kind: "cartesian",
                      dx,
                      dy: (placement.offset as { dy: Expr }).dy,
                    },
                  }),
                )
              }
            />
            <FormulaField
              label="dy"
              value={placement.offset.dy}
              fieldSuffix={`${placement.label}_DY`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(dy) =>
                onChangeModel((m) =>
                  updatePlacement(m, placement.id, {
                    offset: {
                      kind: "cartesian",
                      dx: (placement.offset as { dx: Expr }).dx,
                      dy,
                    },
                  }),
                )
              }
            />
          </>
        )}

        {!inGroup && placement.offset.kind === "formula" && (
          <>
            <FormulaField
              label="x"
              value={placement.offset.x}
              fieldSuffix={`${placement.label}_X`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(x) =>
                onChangeModel((m) =>
                  updatePlacement(m, placement.id, {
                    offset: {
                      kind: "formula",
                      x,
                      y: (placement.offset as { y: Expr }).y,
                    },
                  }),
                )
              }
            />
            <FormulaField
              label="y"
              value={placement.offset.y}
              fieldSuffix={`${placement.label}_Y`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(y) =>
                onChangeModel((m) =>
                  updatePlacement(m, placement.id, {
                    offset: {
                      kind: "formula",
                      x: (placement.offset as { x: Expr }).x,
                      y,
                    },
                  }),
                )
              }
            />
          </>
        )}

        {/* The shape's own settings used to render here, inside every
            member's editor. They now live in the Shapes section, so one
            shape has one editor, and this row links to it. */}
        {group && (
          <div className={styles.fieldRow}>
            <label>Shape</label>
            <span>{shapeDisplayName(group)}</span>
            <HelpTip id="landPlacement.editShape">
              <button type="button" onClick={() => onSelectShape(group.id)}>
                Edit shape
              </button>
            </HelpTip>
          </div>
        )}
      </div>
    </HelpTip>
  );
}

/**
 * slice-c-brief.md item 1's panel surface, and item 2 — this feature's one
 * deliberately-undecided judgement call (per-player-escalation.md Sec.11):
 * "the first field in this tool whose value depends on a setting outside it."
 *
 * DECIDED HERE, with the panel in front of it: the Angle field above stays
 * exactly what it has always meant (the member's own default rule, slice B,
 * unaffected by anything in this component). A per-count override is a
 * SEPARATE, ALWAYS-VISIBLE list below it, one row per count that has one,
 * never folded into the main field. The alternative — making the Angle field
 * itself show whichever value is active at the currently previewed count —
 * was rejected: it would make an override at a count you are not previewing
 * invisible, which is exactly the trap the brief warns against (hazard 1),
 * and it would leave the field's own meaning ambiguous (is this the default,
 * or this count's resolved value?) depending on generation settings, a
 * dependency this panel has never made a plain field carry before. A always-
 * rendered list costs one more row when a ring has no overrides, in exchange
 * for an override at player count 2 staying visible while previewing count 6.
 *
 * Item 4's own one-sentence hazard note lives here too, since this is where
 * the rule gets authored: a free (independent random) bearing can still
 * collide with another player's, and nothing in the emission prevents it.
 */
/** The attributes a land can override, in the order the picker lists them. Labels are the same words the Roles form uses. */
const OVERRIDABLE: readonly { key: keyof RoleOverrides; label: string }[] = [
  { key: "terrain", label: "Terrain" },
  { key: "baseSize", label: "Base size" },
  { key: "baseElevation", label: "Elevation" },
  { key: "extent", label: "Extent" },
  { key: "zone", label: "Zone" },
  { key: "assign", label: "Assign" },
  { key: "leftBorder", label: "Left border" },
  { key: "rightBorder", label: "Right border" },
  { key: "topBorder", label: "Top border" },
  { key: "bottomBorder", label: "Bottom border" },
  { key: "borderFuzziness", label: "Fuzziness" },
  { key: "clumpingFactor", label: "Clumping" },
  { key: "otherZoneAvoidanceDistance", label: "Zone gap" },
  { key: "landId", label: "Land id" },
  { key: "circularBase", label: "set_circular_base" },
  { key: "landConformity", label: "Conformity" },
];

/**
 * Sec.7 of role-attributes-escalation.md: an always-rendered list of what
 * THIS land overrides, never folded into the field that shows the shared
 * value, because folding makes a deviation invisible. Each row has its own
 * reset, which deletes the key (never writes the role's current value into
 * it). `ThetaPerCountEditor`'s own shape.
 */
function RoleOverridesEditor({
  placement,
  role,
  lang,
  mapDim,
  resolveSym,
  onChangeModel,
}: {
  placement: Placement;
  role: LandRole;
  lang: LanguageData;
  mapDim: number;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const overrides = placement.roleOverrides ?? {};
  const active = OVERRIDABLE.filter((o) => overrides[o.key] !== undefined);
  const available = OVERRIDABLE.filter((o) => overrides[o.key] === undefined);
  const set = <K extends keyof RoleOverrides>(
    key: K,
    value: RoleOverrides[K],
  ) => onChangeModel((m) => setRoleOverride(m, placement.id, key, value));
  const clear = (key: keyof RoleOverrides) =>
    onChangeModel((m) => clearRoleOverride(m, placement.id, key));
  const effective = effectiveRole(role, overrides);
  const stem = `LAND_${placement.label}`;

  return (
    <details className={styles.roleTier2} open={active.length > 0}>
      <summary>
        Overrides{active.length > 0 ? ` (${active.length})` : ""}
      </summary>
      {active.map(({ key, label }) => (
        <div key={key} className={styles.overrideRow}>
          <div className={styles.overrideBody}>
            {key === "terrain" && (
              <div className={styles.fieldRow}>
                <label>Terrain</label>
                <input
                  type="text"
                  value={
                    effective.terrain.k === "name"
                      ? effective.terrain.name
                      : String(effective.terrain.id)
                  }
                  onChange={(e) =>
                    set("terrain", {
                      k: "name",
                      name: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>
            )}
            {(key === "baseSize" || key === "baseElevation") && (
              <FormulaField
                label={label}
                value={effective[key]}
                fieldSuffix={`${stem}_${key === "baseSize" ? "SIZE" : "ELEVATION"}`}
                resolveSym={resolveSym}
                onCommit={(v) => set(key, v)}
              />
            )}
            {key === "extent" && (
              <ExtentControl
                extent={effective.extent}
                nameStem={stem}
                mapDim={mapDim}
                resolveSym={resolveSym}
                onChange={(v) => set("extent", v)}
              />
            )}
            {key === "zone" && (
              <ZoneControl
                zone={effective.zone}
                onChange={(v) => set("zone", v)}
              />
            )}
            {key === "assign" && (
              <AssignControl
                assign={effective.assign}
                roleLabel={placement.label}
                resolveSym={resolveSym}
                onChange={(v) => set("assign", v)}
              />
            )}
            {key === "circularBase" && (
              <label className={styles.fieldRow}>
                <input
                  type="checkbox"
                  checked={effective.circularBase === true}
                  onChange={(e) => set("circularBase", e.target.checked)}
                />
                set_circular_base
              </label>
            )}
            {ROLE_OPTIONAL_ATTRIBUTES.some((a) => a.field === key) && (
              <OptionalAttributeField
                field={key as RoleOptionalField}
                label={label}
                value={effective[key as RoleOptionalField]}
                nameStem={placement.label}
                lang={lang}
                resolveSym={resolveSym}
                // Clearing the field IS the reset for an optional attribute:
                // the override goes, the land follows the role again.
                onCommit={(v) =>
                  v === undefined
                    ? clear(key)
                    : set(key as RoleOptionalField, v)
                }
              />
            )}
          </div>
          <HelpTip id="landPlacement.overrideReset">
            <button type="button" onClick={() => clear(key)}>
              Reset
            </button>
          </HelpTip>
        </div>
      ))}
      {available.length > 0 && (
        <HelpTip id="landPlacement.overrideAdd">
          <div className={styles.fieldRow}>
            <label>Override</label>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value === "") return;
                const key = e.target.value as keyof RoleOverrides;
                // Seeded with the role's CURRENT value so the row has
                // something to edit; the user is about to change it. This
                // is the one direction in which copying the value is right;
                // reset goes the other way and deletes.
                const seed =
                  key === "circularBase"
                    ? !(role.circularBase === true)
                    : ROLE_OPTIONAL_ATTRIBUTES.some((a) => a.field === key)
                      ? (role[key as RoleOptionalField] ?? { k: "num", v: 0 })
                      : role[key];
                set(key, seed as RoleOverrides[typeof key]);
              }}
            >
              <option value="">add one…</option>
              {available.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </HelpTip>
      )}
    </details>
  );
}

function ThetaPerCountEditor({
  placement,
  onPerimeter,
  resolveSym,
  onChangeModel,
}: {
  placement: Placement;
  /** The land belongs to a Square, Triangle or Polygon, where the list only lets an override be removed. */
  onPerimeter: boolean;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const overrides = Object.entries(placement.thetaPerCount ?? {})
    .map(([count, expr]) => ({ count: Number(count), expr }))
    .sort((a, b) => a.count - b.count);
  const available = availableThetaPerCountOptions(placement, MAX_PLAYER_COUNT);

  return (
    <HelpTip id="landPlacement.thetaPerCount">
      <div className={styles.section}>
        <p className={styles.sectionTitle}>Angle overrides by player count</p>
        {overrides.length === 0 && (
          <p className={styles.fieldRow}>
            No per-count overrides. Every count uses the rule above.
          </p>
        )}
        {overrides.map(({ count, expr }) => (
          <div key={count} className={styles.fieldRow}>
            <FormulaField
              label={`At ${count}p`}
              value={expr}
              fieldSuffix={`${placement.label}_THETA_AT_${count}`}
              resolveSym={resolveSym}
              onCommit={(next) =>
                onChangeModel((m) =>
                  setThetaPerCountOverride(m, placement.id, count, next),
                )
              }
            />
            <button
              type="button"
              onClick={() =>
                onChangeModel((m) =>
                  setThetaPerCountOverride(m, placement.id, count, undefined),
                )
              }
            >
              Remove
            </button>
          </div>
        ))}
        {onPerimeter && (
          <p className={styles.formulaError}>
            A bearing alone does not pick a point on a Square, Triangle or
            Polygon, so no new override can be added here. While this land keeps
            one, it takes no jitter at any count. Remove it to let the land
            follow the shape again.
          </p>
        )}
        {available.length > 0 && !onPerimeter && (
          <div className={styles.fieldRow}>
            <select
              value=""
              onChange={(e) => {
                const count = Number(e.target.value);
                if (!count) return;
                // Seeded with the member's own current default rule, so the
                // author starts from a sane value rather than a blank field
                // that would otherwise read as "angle 0" until edited.
                onChangeModel((m) =>
                  setThetaPerCountOverride(
                    m,
                    placement.id,
                    count,
                    placement.offset.kind === "polar"
                      ? placement.offset.theta
                      : { k: "num", v: 0 },
                  ),
                );
              }}
            >
              <option value="" disabled>
                + add override for player count…
              </option>
              {available.map((count) => (
                <option key={count} value={count}>
                  {count} players
                </option>
              ))}
            </select>
          </div>
        )}
        <p className={styles.formulaError}>
          A free bearing (a random angle not defined relative to another player)
          can still land on top of another player&apos;s land. Nothing in the
          emission guarantees separation unless one angle is defined relative to
          another.
        </p>
      </div>
    </HelpTip>
  );
}

/**
 * Sec.8's formula field: "a Formula field per node accepting Sec.5.2's
 * grammar, with live feedback in three parts: the parse, the resulting
 * position, and the RMS the compiler would emit for it, with its line
 * count." Replaces 4b's `NumberField` outright, viewModel.ts's own header
 * comment named the gap this closes ("the formula field and its full Expr
 * grammar are slice 5"), and a plain number is valid formula-grammar input
 * too (`parseFormula("42")` is `num(42)` trivially), so unifying the two
 * loses nothing for the common case while gaining everything for the
 * uncommon one.
 *
 * Local `text` is the field's own draft, separate from the committed
 * `value`, so a user can type a syntactically incomplete formula
 * (`"X + "`) without every keystroke racing to parse and reject it as the
 * model's new value; commit happens on blur or Enter, and only when the
 * draft parses AND has no `unsupportedReason` (Sec.4.4's own rnd() cut,
 * documented in formulaField.ts).
 */
/**
 * What every formula field does with a parsed draft before handing it to
 * its own `onCommit`: bind param LABELS to ids, then turn any `rnd(a,b)`
 * the user typed into a real `RandomParam` on the model. The new params
 * are allocated SYNCHRONOUSLY against the model the panel rendered with
 * (inside one blur/Enter handler that is the current one), so the returned
 * expression already carries their ids, and they are appended through
 * `onChangeModel` as a functional update queued BEFORE the field's own
 * commit. React applies queued updaters in order, so the site's
 * `(m) => update(m, expr)` receives a model that already holds the params
 * the expression references. Computing the ids inside the updater instead
 * would be too late: the site's expression is captured before any updater
 * runs.
 */
function commitFormulaExpr(
  parsed: Expr,
  labelStem: string,
  env: {
    params: FormulaParamEnv;
    model: AlpModel | null;
    onChangeModel: ((u: (m: AlpModel) => AlpModel) => void) | null;
  },
): Expr {
  const bound = bindParamLabels(parsed, env.params.idByLabel);
  if (env.onChangeModel === null || env.model === null) return bound;
  const { model: withParams, expr } = materialiseRndParams(
    env.model,
    bound,
    labelStem,
  );
  const added = withParams.randomParams.slice(env.model.randomParams.length);
  if (added.length > 0) {
    env.onChangeModel((m) => ({
      ...m,
      randomParams: [...m.randomParams, ...added],
    }));
  }
  return expr;
}

function FormulaField({
  label,
  value,
  fieldSuffix,
  mapDim,
  resolveSym,
  onCommit,
}: {
  label: string;
  value: Expr;
  fieldSuffix: string;
  mapDim?: number;
  resolveSym: (name: string) => number | undefined;
  onCommit: (expr: Expr) => void;
}) {
  const env = useContext(FormulaEnvContext);
  const initialText = useMemo(
    () => exprToFormulaText(value, 0, env.params.labelOf),
    [value, env.params],
  );
  const [text, setText] = useState(initialText);
  const [dirty, setDirty] = useState(false);

  // Re-seed from a value changed OUTSIDE this field (a group re-expand, an
  // undo, a sibling edit), but only while the user hasn't started typing
  // their own draft, or every external re-render would clobber it.
  useEffect(() => {
    if (!dirty) setText(initialText);
  }, [initialText, dirty]);

  const feedback = useMemo(
    () => computeFormulaFeedback(text, fieldSuffix, resolveSym, env.params),
    [text, fieldSuffix, resolveSym, env.params],
  );
  const canCommit = feedback.parse.ok && feedback.unsupportedReason === null;

  const commit = () => {
    setDirty(false);
    if (!canCommit) return; // an invalid draft is simply not applied; never coerced, never silently discarded from view
    const reparsed = parseFormula(text);
    if (!reparsed.ok) return;
    onCommit(commitFormulaExpr(reparsed.expr, fieldSuffix, env));
  };

  return (
    <div className={styles.formulaField}>
      <div className={styles.formulaFieldRow}>
        <label>{label}</label>
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            commit();
            e.currentTarget.blur();
          }}
        />
        {mapDim !== undefined && mapDim > 0 && feedback.value !== undefined && (
          <span className={styles.tileHint}>
            {formatPercentWithTiles(feedback.value, mapDim)}
          </span>
        )}
      </div>
      {!feedback.parse.ok && (
        <span className={styles.formulaError}>
          {feedback.parse.error.message}
        </span>
      )}
      {feedback.unsupportedReason !== null && (
        <span className={styles.formulaError}>
          {feedback.unsupportedReason}
        </span>
      )}
      <UnknownNameNotes text={text} resolveSym={resolveSym} />
      {feedback.parse.ok &&
        feedback.unsupportedReason === null &&
        feedback.emittedLines.length > 0 && (
          <details className={styles.formulaPreview}>
            <summary>
              {feedback.emittedLines.length} emitted line
              {feedback.emittedLines.length === 1 ? "" : "s"}
            </summary>
            <pre className={styles.code}>
              {feedback.emittedLines.join("\n")}
            </pre>
          </details>
        )}
    </div>
  );
}

/** "±12°" or "±30% of the even gap". */
function describeJitter(amount: number, unit: JitterUnit): string {
  return unit === "deg" ? `±${amount}°` : `±${amount}% of the even gap`;
}

/**
 * per-player-escalation.md Sec.11: the jitter controls of a per player
 * shape. Pressing the button writes `group.jitter` and its per-player param
 * (`setGroupJitter`), and the prologue adds the draw to each player's even
 * position at every count.
 *
 * Circle computes the amount from a minimum separation (`CircleJitterAmount`).
 * Every other kind takes an amount the scripter types, with no minimum
 * separation and no computed bound
 * (land-placement-per-player-any-kind-escalation.md Sec.5.5), since the
 * amount already decides how close two neighbours can come.
 *
 * `unit` is local state, the same choice the panel makes for `helpOpen`.
 * It is an input to the button, and only the button's result becomes model
 * state. It starts from the shape's current jitter so the controls open
 * showing what is already set. It is read once at mount, and the
 * GroupEditor above is keyed by shape id, so switching shapes remounts this
 * and reads the new shape's unit.
 */
function JitterControl({
  model,
  group,
  onChangeModel,
}: {
  model: AlpModel;
  group: ShapeGroup;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const [unit, setUnit] = useState<JitterUnit>(group.jitter?.unit ?? "deg");
  const current = group.jitter;
  const currentParam = current
    ? model.randomParams.find((p) => p.id === current.param)
    : undefined;
  return (
    <div className={styles.section}>
      {group.kind === "circle" ? (
        <CircleJitterAmount
          group={group}
          unit={unit}
          onUnit={setUnit}
          onChangeModel={onChangeModel}
        />
      ) : (
        <TypedJitterAmount
          group={group}
          initialAmount={currentParam?.max}
          unit={unit}
          onUnit={setUnit}
          onChangeModel={onChangeModel}
        />
      )}
      {current && currentParam && (
        <div className={styles.fieldRow}>
          <span>
            Jitter is {describeJitter(currentParam.max, current.unit)}, drawn
            per player by {currentParam.label}. A player&apos;s lands move
            together.
          </span>
          <HelpTip id="landPlacement.jitterRemove">
            <button
              type="button"
              onClick={() =>
                onChangeModel((m) => removeGroupJitter(m, group.id))
              }
            >
              Remove jitter
            </button>
          </HelpTip>
        </div>
      )}
    </div>
  );
}

/** The degrees or percent toggle. Both units have a reading on a circle and on an arc. */
function JitterUnitSelect({
  unit,
  onUnit,
}: {
  unit: JitterUnit;
  onUnit: (unit: JitterUnit) => void;
}) {
  return (
    <HelpTip id="landPlacement.jitterUnit">
      <div className={styles.fieldRow}>
        <label>Jitter in</label>
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value as JitterUnit)}
        >
          <option value="deg">degrees</option>
          <option value="percent">% of the even gap</option>
        </select>
      </div>
    </HelpTip>
  );
}

/**
 * Circle's Min. separation calculator. The bound is always computed at
 * MAX_PLAYER_COUNT, not at the count being previewed. One draw serves every
 * count, and the even gap is smallest at 8 players, so a bound that holds
 * there holds everywhere. `minSeparation` is local state for the same
 * reason `unit` is.
 */
function CircleJitterAmount({
  group,
  unit,
  onUnit,
  onChangeModel,
}: {
  group: ShapeGroup;
  unit: JitterUnit;
  onUnit: (unit: JitterUnit) => void;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const [minSeparation, setMinSeparation] = useState(0);
  const result = computeJitterAmount(
    unit,
    MAX_PLAYER_COUNT,
    group.pattern.length,
    minSeparation,
  );
  return (
    <>
      <HelpTip id="landPlacement.minSeparation">
        <div className={styles.fieldRow}>
          <label>Min. separation (deg)</label>
          <NumberInput
            min={0}
            integer={false}
            value={minSeparation}
            onCommit={setMinSeparation}
          />
        </div>
      </HelpTip>
      <JitterUnitSelect unit={unit} onUnit={onUnit} />
      {result.ok ? (
        <p className={styles.fieldRow}>
          Largest safe jitter at {MAX_PLAYER_COUNT} players is{" "}
          {describeJitter(result.amount, unit)}, and it holds at every smaller
          count too.
        </p>
      ) : (
        <p className={styles.formulaError}>{result.reason}</p>
      )}
      <HelpTip id="landPlacement.jitterApply">
        <button
          type="button"
          disabled={!result.ok}
          onClick={() => {
            if (!result.ok) return;
            onChangeModel((m) =>
              setGroupJitter(m, group.id, unit, result.amount),
            );
          }}
        >
          {group.jitter ? "Update jitter" : "Add jitter"}
          {result.ok ? ` ${describeJitter(result.amount, unit)}` : ""}
        </button>
      </HelpTip>
    </>
  );
}

/**
 * The amount the scripter types, on every kind but Circle (any-kind
 * escalation Sec.5.5). A whole number of at least 1, since the guide
 * requires `rnd`'s max to exceed its min, which `NumberInput`'s `min` and
 * its default whole number rounding keep. It opens on the shape's current
 * amount, or 10 on a shape with no jitter yet, a starting value to type
 * over rather than a computed one. Nothing caps it.
 *
 * The unit toggle shows only where the kind has more than one unit
 * (`jitterUnitsForKind`). A line has percent alone, so there the toggle is
 * hidden and the button writes percent whatever `unit` holds, which keeps
 * the panel from ever writing degrees the emitter would refuse.
 */
function TypedJitterAmount({
  group,
  initialAmount,
  unit,
  onUnit,
  onChangeModel,
}: {
  group: ShapeGroup;
  initialAmount: number | undefined;
  unit: JitterUnit;
  onUnit: (unit: JitterUnit) => void;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const [amount, setAmount] = useState(initialAmount ?? 10);
  const units = jitterUnitsForKind(group.kind);
  const shownUnit = units.includes(unit) ? unit : units[0];
  return (
    <>
      <HelpTip id="landPlacement.jitterAmount">
        <div className={styles.fieldRow}>
          <label>Jitter amount</label>
          <NumberInput min={1} value={amount} onCommit={setAmount} />
        </div>
      </HelpTip>
      {units.length > 1 && <JitterUnitSelect unit={unit} onUnit={onUnit} />}
      <HelpTip id="landPlacement.jitterApply">
        <button
          type="button"
          onClick={() =>
            onChangeModel((m) => setGroupJitter(m, group.id, shownUnit, amount))
          }
        >
          {group.jitter ? "Update jitter" : "Add jitter"}{" "}
          {describeJitter(amount, shownUnit)}
        </button>
      </HelpTip>
    </>
  );
}

function GroupEditor({
  model,
  group,
  newRoleId,
  mapDim,
  parseResult,
  emission,
  resolveSym,
  onChangeModel,
  onSelectLand,
  playerCount,
}: {
  model: AlpModel;
  group: NonNullable<ReturnType<typeof groupForMember>>;
  /** The toolbar's "with role" choice. Null when (none) is picked or no role exists, and then + slot adds points. */
  newRoleId: string | null;
  mapDim: number;
  parseResult: ParseResult;
  emission: import("../emitModel").EmissionOk | null;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
  /** Selects a land, so + Origin point can open the point it just made. */
  onSelectLand: (id: string) => void;
  /** The previewed player count, which a kind change translates degree jitter at (`setGroupKind`). */
  playerCount: number;
}) {
  const total = shapeGroupLandTotal(group);
  const edit = (patch: Parameters<typeof applyGroupEdit>[2]) => {
    onChangeModel((m) => {
      const result = applyGroupEdit(m, group.id, patch, parseResult, emission);
      return result ? result.model : m;
    });
  };
  const originCandidates = shapeOriginCandidates(model, group.id);

  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>
        {shapeDisplayName(group)}, {describeShapeTotal(total)}
      </p>
      <HelpTip id="landPlacement.shapeKind">
        <div className={styles.fieldRow}>
          <label>Shape</label>
          {/* Every kind is offered, per player or not. The per player
              prologue places every kind since the any-kind escalation's
              slice C, which deleted the guard that used to disable them. */}
          <select
            value={group.kind}
            // Through setGroupKind rather than `edit`, so a switch to Line,
            // Square, Triangle or Polygon translates degree jitter to
            // percent instead of meeting applyGroupEdit's refusal.
            onChange={(e) => {
              const kind = e.target.value as ShapeGroup["kind"];
              onChangeModel(
                (m) =>
                  setGroupKind(
                    m,
                    group.id,
                    kind,
                    playerCount,
                    parseResult,
                    emission,
                  )?.model ?? m,
              );
            }}
          >
            {/* `Object.keys` is typed `string[]` on purpose. Under structural
                typing an object can carry more keys than its type names, so
                TypeScript will not promise the narrower type. This record is
                a literal with exactly one key per kind, so the cast holds. */}
            {(Object.keys(SHAPE_KIND_LABELS) as ShapeGroup["kind"][]).map(
              (kind) => (
                <option key={kind} value={kind}>
                  {SHAPE_KIND_LABELS[kind]}
                </option>
              ),
            )}
          </select>
        </div>
      </HelpTip>
      <HelpTip id="landPlacement.shapeOrigin">
        <div className={styles.fieldRow}>
          <label>Origin</label>
          <select
            value={group.parent}
            onChange={(e) => {
              // The frame is left alone (the owner's call, 2026-09-28). The
              // Frame row below appears once the origin leaves the centre,
              // which is where the two frames start to differ.
              edit({ parent: e.target.value });
            }}
          >
            <option value="center">Map centre</option>
            {originCandidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <HelpTip id="landPlacement.shapeOriginPoint">
            <button
              type="button"
              onClick={() => {
                // Built from the `model` prop and handed over as a finished
                // value, not as an updater. React may call an updater twice
                // (StrictMode does, on purpose), and each call would draw a
                // fresh id from `freshId`'s counter, so the id selected
                // below could name a point the kept call never made.
                const result = addShapeOriginPoint(
                  model,
                  group.id,
                  parseResult,
                  emission,
                );
                if (!result) return;
                onChangeModel(result.model);
                onSelectLand(result.pointId);
              }}
            >
              + Origin point
            </button>
          </HelpTip>
        </div>
      </HelpTip>
      {group.parent !== "center" && (
        <HelpTip id="landPlacement.shapeFrame">
          <div className={styles.fieldRow}>
            <label>Frame</label>
            <select
              value={group.frame}
              onChange={(e) => edit({ frame: e.target.value as FrameKind })}
            >
              <option value="absolute">absolute (keeps its facing)</option>
              <option value="radial">radial (turns with the origin)</option>
            </select>
          </div>
        </HelpTip>
      )}
      <FormulaField
        label={group.kind === "line" ? "Half length" : "Radius"}
        value={group.radius}
        fieldSuffix={`${group.id}_RADIUS`}
        mapDim={mapDim}
        resolveSym={resolveSym}
        onCommit={(radius) => edit({ radius })}
      />
      <FormulaField
        label="Rotation (deg)"
        value={group.rotation}
        fieldSuffix={`${group.id}_ROTATION`}
        resolveSym={resolveSym}
        onCommit={(rotation) => edit({ rotation })}
      />
      {group.kind === "arc" && (
        <div className={styles.fieldRow}>
          <label>Sweep (deg)</label>
          <NumberInput
            min={1}
            max={360}
            value={group.sweep ?? 180}
            onCommit={(sweep) => edit({ sweep })}
          />
        </div>
      )}
      {group.kind === "polygon" && (
        <HelpTip id="landPlacement.shapeSides">
          <div className={styles.fieldRow}>
            <label>Sides</label>
            <NumberInput
              min={3}
              max={12}
              value={group.sides ?? 6}
              onCommit={(sides) => edit({ sides })}
            />
          </div>
        </HelpTip>
      )}
      <HelpTip id="landPlacement.perPlayer">
        <div className={styles.fieldRow}>
          <label>
            <input
              type="checkbox"
              checked={group.perPlayer}
              onChange={(e) => {
                const perPlayer = e.target.checked;
                edit(
                  perPlayer
                    ? { perPlayer, repeats: MAX_PLAYER_COUNT }
                    : { perPlayer },
                );
              }}
            />
            One land per player
          </label>
        </div>
      </HelpTip>
      {group.perPlayer && (
        <JitterControl
          model={model}
          group={group}
          onChangeModel={onChangeModel}
        />
      )}
      <div className={styles.fieldRow}>
        <label>Repeats</label>
        <NumberInput
          min={1}
          value={group.repeats}
          disabled={group.perPlayer}
          title={
            group.perPlayer
              ? "One land per player. The repeat count follows the game's own player count instead."
              : undefined
          }
          onCommit={(repeats) => edit({ repeats })}
        />
      </div>
      <div className={styles.chips}>
        {group.pattern.map((slot) => {
          const role = model.roles.find((r) => r.id === slot.role);
          const isPerimeterKind =
            group.kind === "square" ||
            group.kind === "triangle" ||
            group.kind === "polygon";
          return (
            <span key={slot.id} className={styles.chip}>
              {/* A slot's role is editable in place; the members follow
                  through reExpand, which now carries `role` on every
                  matched key (composite-pattern-escalation.md Sec.9 slice
                  1). The same mapped-slot edit path perimeterShift uses. */}
              <HelpTip id="landPlacement.slotRole">
                <select
                  className={styles.chipSelect}
                  value={role ? slot.role : NO_ROLE}
                  onChange={(e) => {
                    const roleId = e.target.value || undefined;
                    onChangeModel(
                      (m) =>
                        setSlotRole(
                          m,
                          group.id,
                          slot.id,
                          roleId,
                          parseResult,
                          emission,
                        )?.model ?? m,
                    );
                  }}
                >
                  {/* A slot naming a role that no longer exists shows
                      (none) here. Only a hand-edited fence can produce one
                      now that deleteRole clears the slot, and choosing any
                      option writes a real value. */}
                  <option value={NO_ROLE}>(none, points)</option>
                  {model.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </HelpTip>
              {(slot.chain?.length ?? 0) > 0 && (
                <span className={styles.chipCount} title="chained lands">
                  +{slot.chain!.length}
                </span>
              )}
              {isPerimeterKind && (
                <HelpTip id="landPlacement.perimeterShift">
                  <NumberInput
                    className={styles.chipShiftInput}
                    integer={false}
                    value={slot.perimeterShift ?? 0}
                    onCommit={(perimeterShift) =>
                      edit({
                        pattern: group.pattern.map((s) =>
                          s.id === slot.id ? { ...s, perimeterShift } : s,
                        ),
                      })
                    }
                  />
                </HelpTip>
              )}
              {group.pattern.length > 1 && (
                <HelpTip id="landPlacement.removeSlot">
                  <button
                    type="button"
                    onClick={() =>
                      onChangeModel((m) => {
                        const result = removePatternSlot(
                          m,
                          group.id,
                          slot.id,
                          parseResult,
                          emission,
                        );
                        return result ? result.model : m;
                      })
                    }
                  >
                    ✕
                  </button>
                </HelpTip>
              )}
            </span>
          );
        })}
        <HelpTip id="landPlacement.addSlot">
          <button
            type="button"
            onClick={() =>
              // The slot id used to be derived from `pattern.length` here,
              // which duplicated an existing id after a remove-then-add
              // (BUG-030). `addPatternSlot` allocates against the whole
              // model and reads the group off `m` inside the updater, so
              // this closure holds no stale `group.pattern`.
              onChangeModel((m) => {
                const result = addPatternSlot(
                  m,
                  group.id,
                  newRoleId ?? undefined,
                  parseResult,
                  emission,
                );
                return result ? result.model : m;
              })
            }
          >
            + slot
          </button>
        </HelpTip>
      </div>
      {/* composite-pattern-escalation.md Sec.7: the Chain list. One row per
          template, on the slot it hangs off, with the same offset fields a
          Placement has. Every edit goes through the merge rule, so a
          nudged chain child keeps its nudge and the strip reports the rest. */}
      {model.roles.length > 0 &&
        group.pattern.map((slot) => (
          <ChainList
            key={slot.id}
            model={model}
            group={group}
            slot={slot}
            newRoleId={newRoleId ?? model.roles[0].id}
            parseResult={parseResult}
            emission={emission}
            resolveSym={resolveSym}
            onChangeModel={onChangeModel}
          />
        ))}
    </div>
  );
}

function ChainList({
  model,
  group,
  slot,
  newRoleId,
  parseResult,
  emission,
  resolveSym,
  onChangeModel,
}: {
  model: AlpModel;
  group: ShapeGroup;
  slot: PatternSlot;
  newRoleId: string;
  parseResult: ParseResult;
  emission: import("../emitModel").EmissionOk | null;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  const chain = slot.chain ?? [];
  const slotRole = model.roles.find((r) => r.id === slot.role);
  const run = (
    op: (m: AlpModel) => ReturnType<typeof applyGroupEdit>,
  ): void => {
    onChangeModel((m) => {
      const result = op(m);
      return result ? result.model : m;
    });
  };
  const update = (
    templateId: string,
    patch: Partial<Omit<ChainTemplate, "id">>,
  ) =>
    run((m) =>
      updateChainTemplate(
        m,
        group.id,
        slot.id,
        templateId,
        patch,
        parseResult,
        emission,
      ),
    );

  return (
    <details className={styles.roleTier2} open={chain.length > 0}>
      <summary>
        Chained off {slotRole?.label ?? "each point"}
        {chain.length > 0 ? ` (${chain.length})` : ""}
      </summary>
      {chain.map((t) => {
        const polar = t.offset.kind === "polar" ? t.offset : null;
        return (
          <div key={t.id} className={styles.section}>
            <HelpTip id="landPlacement.chainRole">
              <div className={styles.fieldRow}>
                <input
                  type="text"
                  value={t.label}
                  onChange={(e) => update(t.id, { label: e.target.value })}
                />
                <label>Role</label>
                <select
                  value={t.role}
                  onChange={(e) => update(t.id, { role: e.target.value })}
                >
                  {model.roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </HelpTip>
            <HelpTip id="landPlacement.chainFrame">
              <div className={styles.fieldRow}>
                <label>Frame</label>
                <select
                  value={t.frame}
                  onChange={(e) =>
                    update(t.id, { frame: e.target.value as FrameKind })
                  }
                >
                  <option value="radial">radial (off the member)</option>
                  <option value="absolute">absolute</option>
                </select>
              </div>
            </HelpTip>
            {polar !== null && (
              <HelpTip id="landPlacement.chainOffset">
                <FormulaField
                  label="Distance"
                  value={polar.r}
                  fieldSuffix={`${group.id}_${t.label}_R`}
                  resolveSym={resolveSym}
                  onCommit={(r) => update(t.id, { offset: { ...polar, r } })}
                />
                <FormulaField
                  label="Angle (deg)"
                  value={polar.theta}
                  fieldSuffix={`${group.id}_${t.label}_THETA`}
                  resolveSym={resolveSym}
                  onCommit={(theta) =>
                    update(t.id, { offset: { ...polar, theta } })
                  }
                />
              </HelpTip>
            )}
            <HelpTip id="landPlacement.chainRemove">
              <button
                type="button"
                onClick={() =>
                  run((m) =>
                    removeChainTemplate(
                      m,
                      group.id,
                      slot.id,
                      t.id,
                      parseResult,
                      emission,
                    ),
                  )
                }
              >
                Remove
              </button>
            </HelpTip>
          </div>
        );
      })}
      <HelpTip id="landPlacement.chainAdd">
        <button
          type="button"
          onClick={() =>
            run((m) =>
              addChainTemplate(
                m,
                group.id,
                slot.id,
                newRoleId,
                parseResult,
                emission,
              ),
            )
          }
        >
          + chained land
        </button>
      </HelpTip>
    </details>
  );
}

/**
 * Sec.4.4's hoisted draws, listed so the ones the tool creates on its own
 * (every ring's `ROTATION_*`, 2026-09-22) are visible and editable, and so
 * a user can add one to reference by name from any formula field. Delete
 * refuses while a field still references the param, and says so.
 */
function RandomParamsSection({
  model,
  onChangeModel,
}: {
  model: AlpModel;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  return (
    <HelpTip id="landPlacement.randomParams">
      <div className={styles.section}>
        <p className={styles.sectionTitle}>Random parameters</p>
        {model.randomParams.length === 0 && (
          <p>None yet. Type rnd(a,b) into any field to create one.</p>
        )}
        {model.randomParams.map((param) => {
          const referenced = isParamReferenced(model, param.id);
          // A jitter draw must stay per player. Shared, every player would
          // take one draw and the ring would turn instead of jittering, and
          // the emitter refuses that.
          const jitterOf = jitterGroupForParam(model, param.id);
          return (
            <div key={param.id} className={styles.fieldRow}>
              <input
                type="text"
                value={param.label}
                onChange={(e) =>
                  onChangeModel((m) =>
                    updateRandomParam(m, param.id, {
                      label: e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9_]/g, "_"),
                    }),
                  )
                }
              />
              <label>rnd(</label>
              <NumberInput
                value={param.min}
                integer={false}
                onCommit={(min) =>
                  onChangeModel((m) => updateRandomParam(m, param.id, { min }))
                }
              />
              <label>,</label>
              <NumberInput
                value={param.max}
                integer={false}
                onCommit={(max) =>
                  onChangeModel((m) => updateRandomParam(m, param.id, { max }))
                }
              />
              <label>)</label>
              <HelpTip
                id="landPlacement.paramPerPlayer"
                text={
                  jitterOf
                    ? `This is ${shapeDisplayName(jitterOf)}'s jitter, which needs one draw per player. Remove the jitter from that shape to change this.`
                    : undefined
                }
              >
                <label>
                  <input
                    type="checkbox"
                    checked={param.perPlayer}
                    disabled={jitterOf !== undefined}
                    onChange={(e) =>
                      onChangeModel((m) =>
                        updateRandomParam(m, param.id, {
                          perPlayer: e.target.checked,
                        }),
                      )
                    }
                  />
                  per player
                </label>
              </HelpTip>
              <HelpTip
                id="landPlacement.paramDelete"
                text={
                  referenced
                    ? "Still referenced by a field. Remove the reference first."
                    : undefined
                }
              >
                <button
                  type="button"
                  disabled={referenced}
                  onClick={() =>
                    onChangeModel((m) => deleteRandomParam(m, param.id))
                  }
                >
                  Delete
                </button>
              </HelpTip>
            </div>
          );
        })}
        <HelpTip id="landPlacement.paramAdd">
          <button
            type="button"
            onClick={() => onChangeModel((m) => addRandomParam(m).model)}
          >
            + Random parameter
          </button>
        </HelpTip>
      </div>
    </HelpTip>
  );
}

/** The selected role's editor, shown under the Roles list. */
function RoleRow({
  role,
  lang,
  mapDim,
  resolveSym,
  onChangeModel,
}: {
  role: LandRole;
  lang: LanguageData;
  mapDim: number;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.fieldRow}>
        <input
          type="text"
          value={role.label}
          onChange={(e) =>
            onChangeModel((m) =>
              updateRole(m, role.id, { label: e.target.value }),
            )
          }
        />
        <label>Terrain</label>
        <input
          type="text"
          value={
            role.terrain.k === "name"
              ? role.terrain.name
              : String(role.terrain.id)
          }
          onChange={(e) =>
            onChangeModel((m) =>
              updateRole(m, role.id, {
                terrain: { k: "name", name: e.target.value.toUpperCase() },
              }),
            )
          }
        />
      </div>
      {/* Sec.8's roles list: "edits the #const set behind each chip". Every
          one of a role's Expr fields is a formula field, not just Size, so a
          mapper can give any of them a formula (an existing script #const,
          arithmetic, SIN/COS). Attaching a freshly-created RandomParam from
          here, Sec.8's own worked ring-rotation example, is NOT built by
          this pass: the formula grammar has no syntax yet for "reference an
          existing named parameter" as opposed to typing a fresh rnd() (which
          formulaField.ts explicitly declines, Sec.4.4's own scope cut). */}
      <FormulaField
        label="Base size"
        value={role.baseSize}
        fieldSuffix={`ROLE_${role.label}_SIZE`}
        resolveSym={resolveSym}
        onCommit={(baseSize) =>
          onChangeModel((m) => updateRole(m, role.id, { baseSize }))
        }
      />
      <FormulaField
        label="Elevation"
        value={role.baseElevation}
        fieldSuffix={`ROLE_${role.label}_ELEVATION`}
        resolveSym={resolveSym}
        onCommit={(baseElevation) =>
          onChangeModel((m) => updateRole(m, role.id, { baseElevation }))
        }
      />
      {/* The three mutex groups render as ONE control each (role-attributes-
          escalation.md Sec.7): the user cannot express the illegal pair
          because the control has no way to say it, which is the model's
          discriminated union doing its job at the other end. */}
      <HelpTip id="landPlacement.roleExtent">
        <ExtentControl
          extent={role.extent}
          nameStem={`ROLE_${role.label}`}
          mapDim={mapDim}
          resolveSym={resolveSym}
          onChange={(extent) =>
            onChangeModel((m) => updateRole(m, role.id, { extent }))
          }
        />
      </HelpTip>
      <HelpTip id="landPlacement.roleZone">
        <ZoneControl
          zone={role.zone}
          onChange={(zone) =>
            onChangeModel((m) => updateRole(m, role.id, { zone }))
          }
        />
      </HelpTip>
      <HelpTip id="landPlacement.roleAssign">
        <AssignControl
          assign={role.assign}
          roleLabel={role.label}
          resolveSym={resolveSym}
          onChange={(assign) =>
            onChangeModel((m) => updateRole(m, role.id, { assign }))
          }
        />
      </HelpTip>

      {/* Tier 1 (role-attributes-escalation.md Sec.2.1: 18 maps and up),
          always shown. Every field is OPTIONAL and absent means the
          attribute is not written; the empty state shows language.json's
          own documented default beside it, never a hardcoded number
          (Sec.4.5). */}
      <HelpTip id="landPlacement.roleBorders">
        <div className={styles.borderGrid}>
          {(
            [
              ["leftBorder", "Left"],
              ["rightBorder", "Right"],
              ["topBorder", "Top"],
              ["bottomBorder", "Bottom"],
            ] as const
          ).map(([field, label]) => (
            <OptionalAttributeField
              key={field}
              field={field}
              label={`${label} border`}
              value={role[field]}
              nameStem={role.label}
              lang={lang}
              resolveSym={resolveSym}
              onCommit={(v) =>
                onChangeModel((m) => updateRole(m, role.id, { [field]: v }))
              }
            />
          ))}
        </div>
      </HelpTip>
      <HelpTip id="landPlacement.roleFuzziness">
        <OptionalAttributeField
          field="borderFuzziness"
          label="Fuzziness"
          value={role["borderFuzziness"]}
          nameStem={role.label}
          lang={lang}
          resolveSym={resolveSym}
          onCommit={(v) =>
            onChangeModel((m) =>
              updateRole(m, role.id, { ["borderFuzziness"]: v }),
            )
          }
        />
      </HelpTip>
      <HelpTip id="landPlacement.roleClumping">
        <OptionalAttributeField
          field="clumpingFactor"
          label="Clumping"
          value={role["clumpingFactor"]}
          nameStem={role.label}
          lang={lang}
          resolveSym={resolveSym}
          onCommit={(v) =>
            onChangeModel((m) =>
              updateRole(m, role.id, { ["clumpingFactor"]: v }),
            )
          }
        />
      </HelpTip>
      <HelpTip id="landPlacement.roleZoneAvoidance">
        <OptionalAttributeField
          field="otherZoneAvoidanceDistance"
          label="Zone gap"
          value={role["otherZoneAvoidanceDistance"]}
          nameStem={role.label}
          lang={lang}
          resolveSym={resolveSym}
          onCommit={(v) =>
            onChangeModel((m) =>
              updateRole(m, role.id, { ["otherZoneAvoidanceDistance"]: v }),
            )
          }
        />
      </HelpTip>
      <HelpTip id="landPlacement.roleLandId">
        <OptionalAttributeField
          field="landId"
          label="Land id"
          value={role["landId"]}
          nameStem={role.label}
          lang={lang}
          resolveSym={resolveSym}
          onCommit={(v) =>
            onChangeModel((m) => updateRole(m, role.id, { ["landId"]: v }))
          }
        />
      </HelpTip>

      {/* Tier 2 behind one disclosure, labelled for what it holds rather
          than for its rank ("advanced" tells the user nothing about whether
          their case is in there, Sec.7). Where the line falls is a
          judgement call left to whoever has the panel in front of them
          (Sec.12); move it and say so. */}
      <details className={styles.roleTier2}>
        <summary>Shape and conformity</summary>
        <HelpTip id="landPlacement.roleCircularBase">
          <label className={styles.fieldRow}>
            <input
              type="checkbox"
              checked={role.circularBase === true}
              onChange={(e) =>
                onChangeModel((m) =>
                  updateRole(m, role.id, {
                    // Unset rather than false, so a role that never
                    // touched the flag serialises without it.
                    circularBase: e.target.checked ? true : undefined,
                  }),
                )
              }
            />
            set_circular_base
          </label>
        </HelpTip>
        <HelpTip id="landPlacement.roleConformity">
          <OptionalAttributeField
            field="landConformity"
            label="Conformity"
            value={role["landConformity"]}
            nameStem={role.label}
            lang={lang}
            resolveSym={resolveSym}
            onCommit={(v) =>
              onChangeModel((m) =>
                updateRole(m, role.id, { ["landConformity"]: v }),
              )
            }
          />
        </HelpTip>
      </details>
    </div>
  );
}

/**
 * One optional `Expr` attribute on a role: an empty field means "not
 * written", and the placeholder shows `language.json`'s documented default
 * for the attribute so the user can see what the engine will do instead.
 * Clearing the field deletes the key (never writes the default into it,
 * which would freeze a value the user meant to leave alone). A negative
 * border surfaces `language.json`'s own `cautionMessage`, read from the data.
 */
function OptionalAttributeField({
  field,
  label,
  value,
  nameStem,
  lang,
  resolveSym,
  onCommit,
}: {
  field: RoleOptionalField;
  label: string;
  /** Absent means the attribute is not written (a role) or follows the role (an override). */
  value: Expr | undefined;
  /** The label the emitted constant is named after: the role's for a role field, the placement's for an override. */
  nameStem: string;
  lang: LanguageData;
  resolveSym: (name: string) => number | undefined;
  /** `undefined` clears the field. */
  onCommit: (expr: Expr | undefined) => void;
}) {
  const { attribute, stem } = ROLE_OPTIONAL_ATTRIBUTES.find(
    (a) => a.field === field,
  )!;
  const def = lang.attributes.find((a) => a.name === attribute);
  const arg = def?.arguments?.[0];
  const env = useContext(FormulaEnvContext);
  const initialText = useMemo(
    () =>
      value === undefined
        ? ""
        : exprToFormulaText(value, 0, env.params.labelOf),
    [value, env.params],
  );
  const [text, setText] = useState(initialText);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setText(initialText);
  }, [initialText, dirty]);

  const trimmed = text.trim();
  const feedback = useMemo(
    () =>
      trimmed === ""
        ? null
        : computeFormulaFeedback(
            trimmed,
            `${stem}_${nameStem}`,
            resolveSym,
            env.params,
          ),
    [trimmed, stem, nameStem, resolveSym, env.params],
  );
  const canCommit =
    feedback === null ||
    (feedback.parse.ok && feedback.unsupportedReason === null);

  const commit = () => {
    setDirty(false);
    if (!canCommit) return;
    if (trimmed === "") {
      onCommit(undefined);
      return;
    }
    const reparsed = parseFormula(trimmed);
    if (reparsed.ok)
      onCommit(commitFormulaExpr(reparsed.expr, `${stem}_${nameStem}`, env));
  };

  const caution =
    feedback !== null &&
    feedback.value !== undefined &&
    arg?.cautionBelow !== undefined &&
    feedback.value < arg.cautionBelow
      ? arg.cautionMessage
      : undefined;

  return (
    <div className={styles.formulaField}>
      <div className={styles.formulaFieldRow}>
        <label>{label}</label>
        <input
          type="text"
          value={text}
          placeholder={
            arg?.default !== undefined ? `default ${arg.default}` : "not set"
          }
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            commit();
            e.currentTarget.blur();
          }}
        />
      </div>
      {feedback !== null && !feedback.parse.ok && (
        <span className={styles.formulaError}>
          {feedback.parse.error.message}
        </span>
      )}
      {feedback !== null && feedback.unsupportedReason !== null && (
        <span className={styles.formulaError}>
          {feedback.unsupportedReason}
        </span>
      )}
      <UnknownNameNotes text={trimmed} resolveSym={resolveSym} />
      {caution !== undefined && (
        <span className={styles.formulaError}>{caution}</span>
      )}
    </div>
  );
}

function ExtentControl({
  extent,
  nameStem,
  mapDim,
  resolveSym,
  onChange,
}: {
  extent: LandExtent;
  nameStem: string;
  mapDim: number;
  resolveSym: (name: string) => number | undefined;
  onChange: (extent: LandExtent) => void;
}) {
  // The label carries the other unit in brackets, from the COMMITTED value
  // (the field's own live draft is not visible here); it updates on commit.
  const env = useContext(FormulaEnvContext);
  const resolved = useMemo(
    () =>
      computeFormulaFeedback(
        exprToFormulaText(extent.value, 0, env.params.labelOf),
        `${nameStem}_EXTENT`,
        resolveSym,
        env.params,
      ).value,
    [extent.value, nameStem, resolveSym, env.params],
  );
  return (
    <>
      <div className={styles.fieldRow}>
        <label>Extent</label>
        <select
          value={extent.kind}
          onChange={(e) =>
            onChange({
              kind: e.target.value as LandExtent["kind"],
              value: extent.value,
            })
          }
        >
          <option value="percent">land_percent</option>
          <option value="tiles">number_of_tiles</option>
        </select>
      </div>
      <FormulaField
        label={formatExtentLabel(extent.kind, resolved, mapDim)}
        value={extent.value}
        fieldSuffix={`${nameStem}_${extent.kind === "percent" ? "PERCENT" : "TILES"}`}
        resolveSym={resolveSym}
        onCommit={(value) => onChange({ ...extent, value })}
      />
    </>
  );
}

/**
 * Every plain numeric field in this panel. The input holds its own DRAFT
 * STRING and only commits a number it can parse; a controlled
 * `<input value={number}>` with `Number(e.target.value)` cannot be cleared,
 * because `Number("")` is 0 and the 0 is written straight back into the
 * field on the same keystroke (the "cannot delete the 0" report,
 * 2026-09-22). This is the same draft-then-commit shape `FormulaField`
 * already uses, and the standard React answer to any controlled input
 * whose parsed type is narrower than what the user can type. Commits on
 * every parseable keystroke (so live re-expansion keeps behaving as it did)
 * and snaps the draft back to the committed value on blur if what is left
 * cannot parse. `min`/`max` clamp the COMMITTED value; the draft is shown
 * as typed until blur.
 */
function NumberInput({
  value,
  min,
  max,
  integer = true,
  disabled,
  title,
  className,
  onCommit,
}: {
  value: number;
  min?: number;
  max?: number;
  /** Truncate to a whole number before committing; the default, since most of these are engine integers. */
  integer?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(String(value));
  }, [value, dirty]);

  const parse = (text: string): number | undefined => {
    if (text.trim() === "") return undefined;
    let n = Number(text);
    if (!Number.isFinite(n)) return undefined;
    if (integer) n = Math.trunc(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    return n;
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      title={title}
      className={className}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        setDirty(true);
        const n = parse(e.target.value);
        if (n !== undefined && n !== value) onCommit(n);
      }}
      onBlur={() => {
        setDirty(false);
        setDraft(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function ZoneControl({
  zone,
  onChange,
}: {
  zone: ZonePolicy;
  onChange: (zone: ZonePolicy) => void;
}) {
  const switchKind = (kind: ZonePolicy["kind"]) => {
    // Carry a number across arms where one exists, so switching fixed ->
    // perRepeat keeps the zone the user typed as the base rather than
    // resetting to 1.
    const carried =
      zone.kind === "fixed"
        ? zone.zone
        : zone.kind === "perRepeat"
          ? zone.base
          : 1;
    switch (kind) {
      case "none":
      case "random":
        return onChange({ kind });
      case "fixed":
        return onChange({ kind, zone: carried });
      case "perRepeat":
        return onChange({ kind, base: carried, step: 1 });
    }
  };
  return (
    <div className={styles.fieldRow}>
      <label>Zone</label>
      <select
        value={zone.kind}
        onChange={(e) => switchKind(e.target.value as ZonePolicy["kind"])}
      >
        <option value="none">none</option>
        <option value="fixed">zone N</option>
        <option value="perRepeat">zone per repeat</option>
        <option value="random">set_zone_randomly</option>
      </select>
      {zone.kind === "fixed" && (
        <NumberInput
          value={zone.zone}
          onCommit={(z) => onChange({ kind: "fixed", zone: z })}
        />
      )}
      {zone.kind === "perRepeat" && (
        <>
          <label>base</label>
          <NumberInput
            value={zone.base}
            onCommit={(base) => onChange({ ...zone, base })}
          />
          <label>step</label>
          <NumberInput
            value={zone.step}
            onCommit={(step) => onChange({ ...zone, step })}
          />
        </>
      )}
    </div>
  );
}

function PlayerSlotControl({
  slot,
  roleLabel,
  resolveSym,
  onChange,
}: {
  slot: PlayerSlot;
  roleLabel: string;
  resolveSym: (name: string) => number | undefined;
  onChange: (slot: PlayerSlot) => void;
}) {
  return (
    <>
      <select
        value={slot.kind}
        onChange={(e) =>
          onChange(
            e.target.value === "fixed"
              ? {
                  kind: "fixed",
                  value: {
                    k: "num",
                    v: slot.kind === "perRepeat" ? slot.base : 1,
                  },
                }
              : { kind: "perRepeat", base: 1, step: 1 },
          )
        }
      >
        <option value="perRepeat">per repeat</option>
        <option value="fixed">fixed</option>
      </select>
      {slot.kind === "perRepeat" ? (
        <>
          <label>base</label>
          <NumberInput
            min={1}
            value={slot.base}
            onCommit={(base) => onChange({ ...slot, base })}
          />
          <label>step</label>
          <NumberInput
            value={slot.step}
            onCommit={(step) => onChange({ ...slot, step })}
          />
        </>
      ) : (
        <FormulaField
          label="number"
          value={slot.value}
          fieldSuffix={`ROLE_${roleLabel}_ASSIGN`}
          resolveSym={resolveSym}
          onCommit={(value) => onChange({ kind: "fixed", value })}
        />
      )}
    </>
  );
}

function AssignControl({
  assign,
  roleLabel,
  resolveSym,
  onChange,
}: {
  assign: AssignPolicy;
  roleLabel: string;
  resolveSym: (name: string) => number | undefined;
  onChange: (assign: AssignPolicy) => void;
}) {
  const switchKind = (kind: AssignPolicy["kind"]) => {
    const number: PlayerSlot =
      assign.kind === "none"
        ? { kind: "perRepeat", base: 1, step: 1 }
        : assign.number;
    switch (kind) {
      case "none":
        return onChange({ kind });
      case "player":
        return onChange({ kind, number });
      case "assignTo":
        return onChange({
          kind,
          target: "AT_PLAYER",
          number,
          mode: 0,
          flags: 0,
        });
    }
  };
  return (
    <div className={styles.fieldRow}>
      <label>Assign</label>
      <select
        value={assign.kind}
        onChange={(e) => switchKind(e.target.value as AssignPolicy["kind"])}
      >
        <option value="none">none</option>
        <option value="player">assign_to_player</option>
        <option value="assignTo">assign_to</option>
      </select>
      {assign.kind === "assignTo" && (
        <select
          value={assign.target}
          onChange={(e) =>
            onChange({ ...assign, target: e.target.value as AssignTarget })
          }
        >
          <option value="AT_PLAYER">AT_PLAYER</option>
          <option value="AT_COLOR">AT_COLOR</option>
          <option value="AT_TEAM">AT_TEAM</option>
        </select>
      )}
      {assign.kind !== "none" && (
        <PlayerSlotControl
          slot={assign.number}
          roleLabel={roleLabel}
          resolveSym={resolveSym}
          onChange={(number) => onChange({ ...assign, number })}
        />
      )}
      {assign.kind === "assignTo" && (
        <>
          <label>mode</label>
          <select
            value={assign.mode}
            onChange={(e) =>
              onChange({ ...assign, mode: Number(e.target.value) as -1 | 0 })
            }
          >
            <option value={0}>0</option>
            <option value={-1}>-1</option>
          </select>
          <label>flags</label>
          <select
            value={assign.flags}
            onChange={(e) =>
              onChange({
                ...assign,
                flags: Number(e.target.value) as 0 | 1 | 2 | 3,
              })
            }
          >
            <option value={0}>0</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </>
      )}
    </div>
  );
}

/** The Apply report in a sentence: "write 8 lands, update 2, leave 1 hand-edited". */
function describeApplyReport(r: import("../applyEdits").ApplyReport): string {
  const parts: string[] = [];
  if (r.written > 0)
    parts.push(`write ${r.written} land${r.written === 1 ? "" : "s"}`);
  if (r.updated > 0) parts.push(`update ${r.updated}`);
  if (r.unchanged > 0) parts.push(`leave ${r.unchanged} unchanged`);
  if (r.left > 0)
    parts.push(
      `leave ${r.left} hand-edited land${r.left === 1 ? "" : "s"} alone`,
    );
  return parts.length > 0 ? parts.join(", ") : "no create_land changes";
}

function GeneratedCodeSection({
  body,
  lands,
  problems,
  editCount,
}: {
  body: string | null;
  /** Every `create_land` skeleton, guards included, in placement order (2026-09-22: the section used to show the fence body only). */
  lands: readonly string[];
  problems: readonly import("../compiler/verify").VerifyProblem[];
  editCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HelpTip id="landPlacement.generatedCode">
      <div className={styles.section}>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} generated code ({editCount} change
          {editCount === 1 ? "" : "s"})
        </button>
        {open && problems.length > 0 && (
          <div className={styles.code}>
            {problems.map((p, i) => (
              // Sec.5.5: "the tool emits nothing and reports the offending node", emittedValue/directValue disagreeing IS the report.
              <p key={i}>
                {p.name}: emitted {p.emittedValue ?? "?"}, independently
                evaluated {p.directValue ?? "?"}
              </p>
            ))}
          </div>
        )}
        {open && body !== null && (
          <>
            <p className={styles.sectionTitle}>Header (fenced #const block)</p>
            <pre className={styles.code}>{body}</pre>
            <p className={styles.sectionTitle}>
              Lands ({lands.length} create_land)
            </p>
            <pre className={styles.code}>{lands.join("\n")}</pre>
          </>
        )}
      </div>
    </HelpTip>
  );
}
