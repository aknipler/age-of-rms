// The Land Placement panel (land-placement-design.md Sec.8): "the minimum
// that makes an authoring loop real; create a ring, set its numbers, see
// it, Apply." A React component over the tested pure functions in
// viewModel.ts and modelOps.ts; per this brief's §5 rule, nothing here does
// arithmetic, a cycle check, or truncation logic of its own.

import { useCallback, useEffect, useMemo, useState } from "react";
import { HelpTip } from "../../../../components/HelpTip";
import { MAX_PLAYER_COUNT, type MapSize } from "../../../../generationSettings/generationSettingsConstants";
import type { LanguageData } from "../../../../parser/language";
import type { ParseResult } from "../../../../parser/types";
import { resolveMapDim } from "../../../../preview/generator/mapDimensions";
import type { Expr, TextEdit } from "../../../../../tools-api/index";
import { computeApplyEdits } from "../applyEdits";
import { checkP1, checkP2, checkP3 } from "../preconditions";
import { parseFormula } from "../compiler/frontend";
import { computeFormulaFeedback, exprToFormulaText } from "./formulaField";
import { locateFence, readFenceModel } from "../fence";
import type { AlpModel } from "../fence";
import { computeSafeJitterDegrees } from "./jitter";
import type { Anchor, FrameKind, LandRole, Placement, ShapeGroup } from "../model";
import {
  addRing,
  addRole,
  addStandalonePlacement,
  applyDragToPlacement,
  applyGroupEdit,
  deleteGroup,
  deleteRole,
  deleteStandalonePlacement,
  groupForMember,
  isGroupMember,
  setThetaPerCountOverride,
  updatePlacement,
  updateRole,
} from "./modelOps";
import {
  availableThetaPerCountOptions,
  checkP4ForPanel,
  computePlacementAttachment,
  firstRawNodeSpan,
  flattenPlacementTree,
  formatPercentWithTiles,
  shapeGroupLandTotal,
  wouldCreateCycle,
} from "./viewModel";
import { buildPlacementTree } from "./viewModel";
import { useEmission } from "./useEmission";
import { useLandPlacementModel, EMPTY_MODEL } from "./landPlacementModel";
import { usePanelPreviewSeed } from "./panelPreviewSeed";
import { LandPlacementCanvas } from "./LandPlacementCanvas";
import { LandPlacementHelpDialog } from "./LandPlacementHelpDialog";
import styles from "./LandPlacementPanel.module.css";

/** shape-kinds-slice-a/b-brief.md item 6. "Ring" as a section title predates kinds, and the group editor's title now names the shape rather than a word that only ever meant circle. */
const KIND_LABELS: Record<ShapeGroup["kind"], string> = { circle: "Circle", line: "Line", arc: "Arc", square: "Square", triangle: "Triangle", polygon: "Polygon" };

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
  const { model: storeModel, setModel, load, markSaved, selectedId, setSelectedId } = useLandPlacementModel();
  const { seed, reseed } = usePanelPreviewSeed();
  // Local, not in `landPlacementModel.tsx`'s store: an open explanation
  // dialog is not part of the model, and it should not survive a tab switch
  // the way the model deliberately does (Sec.3.6(b)).
  const [helpOpen, setHelpOpen] = useState(false);

  // Sec.3.6(a): loaded once when the panel mounts, never again from the
  // fence. After this, `model` is the tool's own in-memory state and the
  // document only changes it back via a successful Apply. `storeModel` is
  // null exactly on a FRESH mount (a genuine tool selection, or after an
  // unmount+reselect) and non-null across a mere suspend/resume tab-switch
  // (the model is retained then, Sec.3.6(b)), so guarding both this load
  // and the seed pin on it is what makes "pinned on mount" mean the panel's
  // own mount rather than every React remount a tab switch causes.
  useEffect(() => {
    if (storeModel === null) {
      load(readFenceModel(parseResult) ?? EMPTY_MODEL);
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
    (name: string): number | undefined => (emission?.ok ? emission.resolved.get(name) : undefined) ?? dry?.scriptSymbols.get(name),
    [emission, dry],
  );

  // --- Preconditions (Sec.9) ------------------------------------------------

  const p1 = checkP1(parseResult);
  const p2 = checkP2(model.randomParams, playerCount);
  const p3 = checkP3(model.roles, parseResult);
  // Hands over the emission rather than a name list, so which names are the
  // candidates is that function's decision and not this one's. See its own
  // doc comment for why it is shaped that way.
  const p4 = checkP4ForPanel(emission?.ok ? emission : null, parseResult, lang);
  const fenceExists = locateFence(parseResult) !== null;
  const p5Malformed = fenceExists && readFenceModel(parseResult) === null;

  // --- Tree + attachment -----------------------------------------------------

  const tree = useMemo(() => flattenPlacementTree(buildPlacementTree(model)), [model]);
  const attachment = useMemo(
    () => (emission?.ok ? computePlacementAttachment(parseResult, model, emission) : new Map<string, boolean | null>()),
    [parseResult, model, emission],
  );

  const selected = model.placements.find((p) => p.id === selectedId) ?? null;
  const selectedGroup = selectedId ? groupForMember(model, selectedId) : undefined;

  // --- Apply -----------------------------------------------------------------

  // `dry.scriptSymbols`, the DOCUMENT's own resolved #consts, never
  // `emission.resolved` (this model's own output). See useEmission.ts's own
  // doc comment for why those answer different questions.
  const applyPreview = useMemo(() => {
    if (storeModel === null || dry === null) return null;
    return computeApplyEdits(parseResult, model, lang, dry.scriptSymbols, playerCount);
  }, [storeModel, dry, parseResult, model, lang, playerCount]);

  const apply = () => {
    if (!applyPreview || applyPreview.edits.length === 0) return;
    applyTextEdits(applyPreview.edits);
    reparseNow(source);
    markSaved();
  };

  if (storeModel === null) {
    return <p className={styles.pane}>Loading…</p>;
  }

  return (
    <div className={styles.pane}>
      <PreconditionsStrip
        p1={p1}
        p1RawSpan={firstRawNodeSpan(parseResult)}
        p2Mismatches={p2.mismatches}
        p3={p3}
        p4Collisions={p4.collisions}
        p5Malformed={p5Malformed}
        onJumpToOffset={onJumpToOffset}
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
              const { model: next } = addRole(model);
              setModel(next);
            }}
          >
            + Role
          </button>
        </HelpTip>
        <HelpTip id="landPlacement.newRing">
          <button
            type="button"
            disabled={model.roles.length === 0}
            title={model.roles.length === 0 ? "Add a role first" : undefined}
            onClick={() => {
              const { model: next, groupId } = addRing(model, model.roles[0].id);
              setModel(next);
              setSelectedId(next.groups.find((g) => g.id === groupId)?.members[0] ?? null);
            }}
          >
            + Shape
          </button>
        </HelpTip>
        <HelpTip id="landPlacement.newLand">
          <button
            type="button"
            disabled={model.roles.length === 0}
            title={model.roles.length === 0 ? "Add a role first" : undefined}
            onClick={() => {
              const { model: next, id } = addStandalonePlacement(model, model.roles[0].id);
              setModel(next);
              setSelectedId(id);
            }}
          >
            + Land
          </button>
        </HelpTip>
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

      {helpOpen && <LandPlacementHelpDialog onClose={() => setHelpOpen(false)} />}

      <div className={styles.body}>
        <div className={styles.canvasColumn}>
          <LandPlacementCanvas
            model={model}
            emission={emission}
            parseResult={parseResult}
            lang={lang}
            mapSize={mapSize}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onModelChange={setModel}
          />
        </div>

        <div className={styles.rightColumn}>
          <HelpTip id="landPlacement.tree">
            <div className={styles.tree}>
              {tree.length === 0 && <p className={styles.fieldRow}>No lands yet — add a ring or a land above.</p>}
              {tree.map(({ placement, depth }) => (
                <TreeRow
                  key={placement.id}
                  placement={placement}
                  depth={depth}
                  model={model}
                  attached={attachment.get(placement.id) ?? null}
                  selected={placement.id === selectedId}
                  onSelect={() => setSelectedId(placement.id)}
                />
              ))}
            </div>
          </HelpTip>

          {selected && (
            <PlacementEditor
              model={model}
              placement={selected}
              group={selectedGroup}
              mapDim={mapDim}
              playerCount={playerCount}
              parseResult={parseResult}
              emission={emission?.ok ? emission : null}
              resolveSym={resolveSym}
              onChangeModel={setModel}
              onDeleteStandalone={() => {
                setModel((m) => deleteStandalonePlacement(m, selected.id));
                setSelectedId(null);
              }}
              onDeleteGroup={() => {
                if (selectedGroup) {
                  setModel((m) => deleteGroup(m, selectedGroup.id));
                  setSelectedId(null);
                }
              }}
            />
          )}

          <RolesSection model={model} resolveSym={resolveSym} onChangeModel={setModel} />

          <GeneratedCodeSection body={emission?.ok ? emission.body : null} problems={emission?.ok === false ? emission.problems : []} editCount={applyPreview?.edits.length ?? 0} />

          <HelpTip id="landPlacement.apply">
            <button type="button" disabled={!applyPreview || applyPreview.edits.length === 0} onClick={apply}>
              Apply {applyPreview?.edits.length ?? 0} change{applyPreview?.edits.length === 1 ? "" : "s"}
            </button>
          </HelpTip>
        </div>
      </div>
    </div>
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
  onJumpToOffset,
}: {
  p1: ReturnType<typeof checkP1>;
  p1RawSpan: ReturnType<typeof firstRawNodeSpan>;
  p2Mismatches: ReturnType<typeof checkP2>["mismatches"];
  p3: ReturnType<typeof checkP3>;
  p4Collisions: readonly string[];
  p5Malformed: boolean;
  onJumpToOffset: (offset: number) => void;
}) {
  const messages: { text: string; jumpTo?: number }[] = [];
  if (!p1.ok) {
    messages.push({
      text: `${(p1.rawFraction * 100).toFixed(1)}% of this script is code the app can only show as raw text, including ${p1.unmanagedLandCount} create_land commands. Land Placement cannot manage those.`,
      jumpTo: p1RawSpan?.start,
    });
  }
  for (const m of p2Mismatches) {
    messages.push({ text: `Random parameter "${m.label}" was emitted for ${m.emittedFor} players; the script is now set to ${m.livePlayerCount}.` });
  }
  if (!p3.ok) {
    messages.push({ text: 'A land is assigned to a player, but direct_placement is not declared — the engine may ignore the assignment.' });
  }
  if (p4Collisions.length > 0) {
    messages.push({ text: `These names would collide with existing script symbols: ${p4Collisions.join(", ")}.` });
  }
  if (p5Malformed) {
    messages.push({ text: "This script has an Advanced Land Placement fence, but it could not be read — starting from an empty model rather than guessing." });
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
          </div>
        ))}
      </div>
    </HelpTip>
  );
}

function TreeRow({
  placement,
  depth,
  model,
  attached,
  selected,
  onSelect,
}: {
  placement: Placement;
  depth: number;
  model: AlpModel;
  attached: boolean | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const role = model.roles.find((r) => r.id === placement.role);
  return (
    <button
      type="button"
      className={`${styles.treeRow} ${selected ? styles.treeRowSelected : ""}`}
      style={{ paddingLeft: `${0.4 + depth * 1}rem` }}
      onClick={onSelect}
    >
      <span>{placement.label}</span>
      {role && <span className={styles.roleTag}>{role.label}</span>}
      {attached === false && <span className={styles.detached}>detached</span>}
    </button>
  );
}

function PlacementEditor({
  model,
  placement,
  group,
  mapDim,
  playerCount,
  parseResult,
  emission,
  resolveSym,
  onChangeModel,
  onDeleteStandalone,
  onDeleteGroup,
}: {
  model: AlpModel;
  placement: Placement;
  group: ReturnType<typeof groupForMember>;
  mapDim: number;
  playerCount: number;
  parseResult: ParseResult;
  emission: import("../emitModel").EmissionOk | null;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
  onDeleteStandalone: () => void;
  onDeleteGroup: () => void;
}) {
  const inGroup = isGroupMember(model, placement.id);
  const parentOptions: Anchor[] = ["center", ...model.placements.filter((p) => p.id !== placement.id).map((p) => p.id)];

  return (
    <HelpTip id="landPlacement.nodeEditor">
      <div className={styles.section}>
        <p className={styles.sectionTitle}>{placement.label}</p>

        <div className={styles.fieldRow}>
          <label>Label</label>
          <input
            type="text"
            value={placement.label}
            onChange={(e) => onChangeModel((m) => updatePlacement(m, placement.id, { label: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label>Role</label>
          <select
            value={placement.role ?? ""}
            onChange={(e) => onChangeModel((m) => updatePlacement(m, placement.id, { role: e.target.value || undefined }))}
          >
            <option value="">(none — chain anchor)</option>
            {model.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {!inGroup && (
          <div className={styles.fieldRow}>
            <label>Parent</label>
            <select
              value={placement.parent}
              onChange={(e) => {
                const next = e.target.value;
                if (wouldCreateCycle(model, placement.id, next)) {
                  window.alert("That would make this placement its own ancestor.");
                  return;
                }
                onChangeModel((m) => updatePlacement(m, placement.id, { parent: next }));
              }}
            >
              {parentOptions.map((id) => (
                <option key={id} value={id}>
                  {id === "center" ? "Map centre" : (model.placements.find((p) => p.id === id)?.label ?? id)}
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
                    updatePlacement(m, placement.id, { frame: placement.frame === "radial" ? ("absolute" as FrameKind) : ("radial" as FrameKind) }),
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
                  onChangeModel((m) => updatePlacement(m, placement.id, { offset: { kind: "polar", r, theta: (placement.offset as { theta: Expr }).theta } }))
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
                onChangeModel((m) => applyDragToPlacement(m, placement.id, { kind: "polar", r: (placement.offset as { r: Expr }).r, theta }))
              }
            />
            {group?.perPlayer && (
              <ThetaPerCountEditor placement={placement} resolveSym={resolveSym} onChangeModel={onChangeModel} />
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
                onChangeModel((m) => updatePlacement(m, placement.id, { offset: { kind: "cartesian", dx, dy: (placement.offset as { dy: Expr }).dy } }))
              }
            />
            <FormulaField
              label="dy"
              value={placement.offset.dy}
              fieldSuffix={`${placement.label}_DY`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(dy) =>
                onChangeModel((m) => updatePlacement(m, placement.id, { offset: { kind: "cartesian", dx: (placement.offset as { dx: Expr }).dx, dy } }))
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
                onChangeModel((m) => updatePlacement(m, placement.id, { offset: { kind: "formula", x, y: (placement.offset as { y: Expr }).y } }))
              }
            />
            <FormulaField
              label="y"
              value={placement.offset.y}
              fieldSuffix={`${placement.label}_Y`}
              mapDim={mapDim}
              resolveSym={resolveSym}
              onCommit={(y) =>
                onChangeModel((m) => updatePlacement(m, placement.id, { offset: { kind: "formula", x: (placement.offset as { x: Expr }).x, y } }))
              }
            />
          </>
        )}

        {group && (
          <GroupEditor
            model={model}
            group={group}
            mapDim={mapDim}
            playerCount={playerCount}
            parseResult={parseResult}
            emission={emission}
            resolveSym={resolveSym}
            onChangeModel={onChangeModel}
            onDeleteGroup={onDeleteGroup}
          />
        )}

        {!inGroup && (
          <button type="button" onClick={onDeleteStandalone}>
            Delete
          </button>
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
function ThetaPerCountEditor({
  placement,
  resolveSym,
  onChangeModel,
}: {
  placement: Placement;
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
        {overrides.length === 0 && <p className={styles.fieldRow}>No per-count overrides — every count uses the rule above.</p>}
        {overrides.map(({ count, expr }) => (
          <div key={count} className={styles.fieldRow}>
            <FormulaField
              label={`At ${count}p`}
              value={expr}
              fieldSuffix={`${placement.label}_THETA_AT_${count}`}
              resolveSym={resolveSym}
              onCommit={(next) => onChangeModel((m) => setThetaPerCountOverride(m, placement.id, count, next))}
            />
            <button type="button" onClick={() => onChangeModel((m) => setThetaPerCountOverride(m, placement.id, count, undefined))}>
              Remove
            </button>
          </div>
        ))}
        {available.length > 0 && (
          <div className={styles.fieldRow}>
            <select
              value=""
              onChange={(e) => {
                const count = Number(e.target.value);
                if (!count) return;
                // Seeded with the member's own current default rule, so the
                // author starts from a sane value rather than a blank field
                // that would otherwise read as "angle 0" until edited.
                onChangeModel((m) => setThetaPerCountOverride(m, placement.id, count, placement.offset.kind === "polar" ? placement.offset.theta : { k: "num", v: 0 }));
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
          A free bearing (a random angle not defined relative to another player) can still land on top of another
          player&apos;s land. Nothing in the emission guarantees separation unless one angle is defined relative to
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
  const initialText = useMemo(() => exprToFormulaText(value), [value]);
  const [text, setText] = useState(initialText);
  const [dirty, setDirty] = useState(false);

  // Re-seed from a value changed OUTSIDE this field (a group re-expand, an
  // undo, a sibling edit), but only while the user hasn't started typing
  // their own draft, or every external re-render would clobber it.
  useEffect(() => {
    if (!dirty) setText(initialText);
  }, [initialText, dirty]);

  const feedback = useMemo(() => computeFormulaFeedback(text, fieldSuffix, resolveSym), [text, fieldSuffix, resolveSym]);
  const canCommit = feedback.parse.ok && feedback.unsupportedReason === null;

  const commit = () => {
    setDirty(false);
    if (!canCommit) return; // an invalid draft is simply not applied; never coerced, never silently discarded from view
    const reparsed = parseFormula(text);
    if (reparsed.ok) onCommit(reparsed.expr);
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
          <span className={styles.tileHint}>{formatPercentWithTiles(feedback.value, mapDim)}</span>
        )}
      </div>
      {!feedback.parse.ok && <span className={styles.formulaError}>{feedback.parse.error.message}</span>}
      {feedback.unsupportedReason !== null && <span className={styles.formulaError}>{feedback.unsupportedReason}</span>}
      {feedback.parse.ok && feedback.unsupportedReason === null && feedback.emittedLines.length > 0 && (
        <details className={styles.formulaPreview}>
          <summary>
            {feedback.emittedLines.length} emitted line{feedback.emittedLines.length === 1 ? "" : "s"}
          </summary>
          <pre className={styles.code}>{feedback.emittedLines.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

/**
 * slice-c-brief.md item 3: an advisory calculator, not a model field. It
 * writes nothing — `computeSafeJitterDegrees` (jitter.ts) is pure and this
 * component's only job is to show its answer for the player count currently
 * being PREVIEWED (Sec.7.4's own rule: the panel draws one count at a time),
 * with a plain note that the bound can differ at another count. Turning this
 * into something that authors a `rnd(...)` into the model directly was
 * considered and deliberately cut: the safe bound depends on which count is
 * being asked about, and `RandomParam` has no per-count shape (nor was one
 * asked for, hazard 4's own "adding per-count radius while you are in
 * there" is the same caution applied one field over) — a single hoisted
 * draw can only be as generous as the TIGHTEST count it is used at, which
 * this control does not attempt to solve for since the author only ever
 * asked about the count in front of them.
 */
function MinSeparationHelper({ patternLength, playerCount }: { patternLength: number; playerCount: number }) {
  const [minSeparation, setMinSeparation] = useState(0);
  const result = computeSafeJitterDegrees(playerCount, patternLength, minSeparation);
  return (
    <HelpTip id="landPlacement.minSeparation">
      <div className={styles.section}>
        <div className={styles.fieldRow}>
          <label>Min. separation (deg)</label>
          <input
            type="number"
            min={0}
            value={minSeparation}
            onChange={(e) => setMinSeparation(Math.max(0, Number(e.target.value)))}
          />
        </div>
        {result.ok ? (
          <p className={styles.fieldRow}>
            Safe jitter at {playerCount} players: ±{result.jitterDegrees.toFixed(1)}°. Add{" "}
            <code>{`rnd(-${result.jitterDegrees.toFixed(1)},${result.jitterDegrees.toFixed(1)})`}</code> to a member&apos;s
            angle to use it. Recompute before relying on this at a different player count.
          </p>
        ) : (
          <p className={styles.formulaError}>{result.reason}</p>
        )}
      </div>
    </HelpTip>
  );
}

function GroupEditor({
  model,
  group,
  mapDim,
  playerCount,
  parseResult,
  emission,
  resolveSym,
  onChangeModel,
  onDeleteGroup,
}: {
  model: AlpModel;
  group: NonNullable<ReturnType<typeof groupForMember>>;
  mapDim: number;
  playerCount: number;
  parseResult: ParseResult;
  emission: import("../emitModel").EmissionOk | null;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
  onDeleteGroup: () => void;
}) {
  const total = shapeGroupLandTotal(group);
  const kindLabel = KIND_LABELS[group.kind];

  const edit = (patch: Parameters<typeof applyGroupEdit>[2]) => {
    onChangeModel((m) => {
      const result = applyGroupEdit(m, group.id, patch, parseResult, emission);
      return result ? result.model : m;
    });
  };

  return (
    <div className={styles.section}>
      <p className={styles.sectionTitle}>{kindLabel}, {total.exact ? total.count : `up to ${total.count}`} lands</p>
      <HelpTip id="landPlacement.shapeKind">
        <div className={styles.fieldRow}>
          <label>Shape</label>
          <select value={group.kind} onChange={(e) => edit({ kind: e.target.value as ShapeGroup["kind"] })}>
            <option value="circle">Circle</option>
            <option value="line">Line</option>
            <option value="arc">Arc</option>
            <option value="square">Square</option>
            <option value="triangle">Triangle</option>
            <option value="polygon">Polygon</option>
          </select>
        </div>
      </HelpTip>
      <FormulaField
        label={group.kind === "line" ? "Half length" : "Radius"}
        value={group.radius}
        fieldSuffix={`${group.id}_RADIUS`}
        mapDim={mapDim}
        resolveSym={resolveSym}
        onCommit={(radius) => edit({ radius })}
      />
      <FormulaField label="Rotation (deg)" value={group.rotation} fieldSuffix={`${group.id}_ROTATION`} resolveSym={resolveSym} onCommit={(rotation) => edit({ rotation })} />
      {group.kind === "arc" && (
        <div className={styles.fieldRow}>
          <label>Sweep (deg)</label>
          <input
            type="number"
            min={1}
            max={360}
            value={group.sweep ?? 180}
            onChange={(e) => edit({ sweep: Math.max(1, Math.min(360, Math.trunc(Number(e.target.value)))) })}
          />
        </div>
      )}
      {group.kind === "polygon" && (
        <HelpTip id="landPlacement.shapeSides">
          <div className={styles.fieldRow}>
            <label>Sides</label>
            <input
              type="number"
              min={3}
              max={12}
              value={group.sides ?? 6}
              onChange={(e) => edit({ sides: Math.max(3, Math.min(12, Math.trunc(Number(e.target.value)))) })}
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
              disabled={group.kind !== "circle"}
              title={group.kind !== "circle" ? "Per player angles are computed for a ring, so this needs the Circle shape." : undefined}
              onChange={(e) => {
                const perPlayer = e.target.checked;
                edit(perPlayer ? { perPlayer, repeats: MAX_PLAYER_COUNT } : { perPlayer });
              }}
            />
            One land per player
          </label>
        </div>
      </HelpTip>
      {group.perPlayer && <MinSeparationHelper patternLength={group.pattern.length} playerCount={playerCount} />}
      <div className={styles.fieldRow}>
        <label>Repeats</label>
        <input
          type="number"
          min={1}
          value={group.repeats}
          disabled={group.perPlayer}
          title={group.perPlayer ? "One land per player — the repeat count follows the game's own player count instead." : undefined}
          onChange={(e) => edit({ repeats: Math.max(1, Math.trunc(Number(e.target.value))) })}
        />
      </div>
      <div className={styles.chips}>
        {group.pattern.map((slot) => {
          const role = model.roles.find((r) => r.id === slot.role);
          const isPerimeterKind = group.kind === "square" || group.kind === "triangle" || group.kind === "polygon";
          return (
            <span key={slot.id} className={styles.chip}>
              {role?.label ?? slot.role}
              {isPerimeterKind && (
                <HelpTip id="landPlacement.perimeterShift">
                  <input
                    type="number"
                    className={styles.chipShiftInput}
                    value={slot.perimeterShift ?? 0}
                    onChange={(e) => {
                      const perimeterShift = Number(e.target.value);
                      edit({ pattern: group.pattern.map((s) => (s.id === slot.id ? { ...s, perimeterShift } : s)) });
                    }}
                  />
                </HelpTip>
              )}
              {group.pattern.length > 1 && (
                <button type="button" onClick={() => edit({ pattern: group.pattern.filter((s) => s.id !== slot.id) })}>
                  ✕
                </button>
              )}
            </span>
          );
        })}
        {model.roles.length > 0 && (
          <button
            type="button"
            onClick={() => edit({ pattern: [...group.pattern, { id: `${group.id}_slot_${group.pattern.length}`, role: model.roles[0].id }] })}
          >
            + slot
          </button>
        )}
      </div>
      <button type="button" onClick={onDeleteGroup}>
        Delete ring
      </button>
    </div>
  );
}

function RolesSection({
  model,
  resolveSym,
  onChangeModel,
}: {
  model: AlpModel;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  return (
    <HelpTip id="landPlacement.roles">
      <div className={styles.section}>
        <p className={styles.sectionTitle}>Roles</p>
        <div className={styles.rolesList}>
          {model.roles.length === 0 && <p>No roles yet.</p>}
          {model.roles.map((role) => (
            <RoleRow key={role.id} role={role} resolveSym={resolveSym} onChangeModel={onChangeModel} />
          ))}
        </div>
      </div>
    </HelpTip>
  );
}

function RoleRow({
  role,
  resolveSym,
  onChangeModel,
}: {
  role: LandRole;
  resolveSym: (name: string) => number | undefined;
  onChangeModel: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}) {
  return (
    <div className={styles.section}>
      <div className={styles.fieldRow}>
        <input type="text" value={role.label} onChange={(e) => onChangeModel((m) => updateRole(m, role.id, { label: e.target.value }))} />
        <label>Terrain</label>
        <input
          type="text"
          value={role.terrain.k === "name" ? role.terrain.name : String(role.terrain.id)}
          onChange={(e) => onChangeModel((m) => updateRole(m, role.id, { terrain: { k: "name", name: e.target.value.toUpperCase() } }))}
        />
        <label>
          <input
            type="checkbox"
            checked={role.assignToPlayer}
            onChange={(e) => onChangeModel((m) => updateRole(m, role.id, { assignToPlayer: e.target.checked }))}
          />
          Assign to player
        </label>
        <button type="button" onClick={() => onChangeModel((m) => deleteRole(m, role.id))}>
          Delete
        </button>
      </div>
      {/* Sec.8's roles list: "edits the #const set behind each chip". Every
          one of a role's Expr fields is a formula field, not just Size, so a
          mapper can give any of them a formula (an existing script #const,
          arithmetic, SIN/COS). Attaching a freshly-created RandomParam from
          here, Sec.8's own worked ring-rotation example, is NOT built by
          this pass: the formula grammar has no syntax yet for "reference an
          existing named parameter" as opposed to typing a fresh rnd() (which
          formulaField.ts explicitly declines, Sec.4.4's own scope cut). */}
      <FormulaField label="Size" value={role.baseSize} fieldSuffix={`ROLE_${role.label}_SIZE`} resolveSym={resolveSym} onCommit={(baseSize) => onChangeModel((m) => updateRole(m, role.id, { baseSize }))} />
      <FormulaField
        label="Elevation"
        value={role.baseElevation}
        fieldSuffix={`ROLE_${role.label}_ELEVATION`}
        resolveSym={resolveSym}
        onCommit={(baseElevation) => onChangeModel((m) => updateRole(m, role.id, { baseElevation }))}
      />
      <FormulaField
        label="Land %"
        value={role.landPercent}
        fieldSuffix={`ROLE_${role.label}_PERCENT`}
        resolveSym={resolveSym}
        onCommit={(landPercent) => onChangeModel((m) => updateRole(m, role.id, { landPercent }))}
      />
    </div>
  );
}

function GeneratedCodeSection({
  body,
  problems,
  editCount,
}: {
  body: string | null;
  problems: readonly import("../compiler/verify").VerifyProblem[];
  editCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <HelpTip id="landPlacement.generatedCode">
      <div className={styles.section}>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} generated code ({editCount} change{editCount === 1 ? "" : "s"})
        </button>
        {open && problems.length > 0 && (
          <div className={styles.code}>
            {problems.map((p, i) => (
              // Sec.5.5: "the tool emits nothing and reports the offending node", emittedValue/directValue disagreeing IS the report.
              <p key={i}>
                {p.name}: emitted {p.emittedValue ?? "?"}, independently evaluated {p.directValue ?? "?"}
              </p>
            ))}
          </div>
        )}
        {open && body !== null && <pre className={styles.code}>{body}</pre>}
      </div>
    </HelpTip>
  );
}
