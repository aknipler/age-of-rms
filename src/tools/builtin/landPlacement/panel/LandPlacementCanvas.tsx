// The panel's own canvas (land-placement-design.md Sec.7). Two tiers,
// exactly as Sec.7.2 fixes them:
//
//   Vector, every render, straight from the live model. Pure, cheap
//     (Sec.3.4 measured 0.173ms for a full re-evaluation), and it is what
//     makes dragging (slice 5) possible at all: the overlay can never
//     disagree with what will be emitted, because it reads the SAME
//     `emitAlpModel` + `buildOverlayShapes` pipeline Apply itself uses.
//   Full, the panel's own preview pipeline (`PanelPreviewResultProvider`,
//     item 1), drawn underneath as the base layer. Reacts to the real
//     document changing (Apply, a seed re-roll), not to in-progress model
//     edits, which are not written into the document until Apply.
//
// The canvas needs its OWN viewport (Sec.7.2 item 2's own note: "for the same
// reason it needs its own seed"), a local `useState`, never
// `usePreviewViewport()`, which is the Breakdown/Code singleton.
//
// slice-5-brief.md item 1: drag wiring lives HERE, behind OverlayCanvas's
// optional `hitTestDragStart`/`onDrag` props, per that brief's own
// recommendation — the built-in panel is in-process, so it calls
// `applyDrag`/`applyDefaultSnapping` directly rather than pumping
// `overlayEvents.ts`'s coalescer, which exists for a future EXTERNAL tool
// on a real transport (see that module's own header comment). Every
// CALCULATION a drag needs lives in canvasInteraction.ts/gizmoGeometry.ts/
// canvasGeometry.ts, all pure and tested; what follows is glue dispatching
// a drag's opaque shape id to the right one of those, unverified by
// anything but typecheck/lint and the brief's own manual run sheet — see
// this brief's §4, "nothing in this environment can render App.tsx".

import { useMemo, useState } from "react";
import {
  OverlayCanvas,
  type OverlayDragModifiers,
} from "../../../../components/preview/OverlayCanvas";
import type { MapSize } from "../../../../generationSettings/generationSettingsConstants";
import type { LanguageData } from "../../../../parser/language";
import type { ParseResult } from "../../../../parser/types";
import {
  createTerrainPalette,
  DEFAULT_TERRAIN_COLOR_MODE,
  type TerrainConstant,
} from "../../../../preview/render/palette";
import type { Viewport } from "../../../../preview/render/projection";
import { resolveMapDim } from "../../../../preview/generator/mapDimensions";
import { usePanelPreviewResultContext } from "../../../../PreviewResultContext";
import { buildOverlayShapes } from "../overlay";
import { evalClosed, num } from "../compiler/expr";
import { applyDrag, dragPolar, symbolicDeclineReason } from "./dragMath";
import { applyDefaultSnapping, snapToIntegerPercent } from "./snapping";
import {
  buildSnapContext,
  computeArcSweepDrag,
  computeLineEndDrag,
  computeRimDragReparent,
  evalGroupExpr,
  resolveGroupFrameContext,
  resolvedDegreesOf,
  resolvedOffsetOf,
  resolvedPercentOf,
} from "./canvasInteraction";
import {
  arcSweepHandlePosition,
  gizmoHandlePositions,
  lineEndHandlePosition,
} from "./gizmoGeometry";
import {
  applyDragToPlacement,
  applyGroupEdit,
  groupForMember,
} from "./modelOps";
import { percentToTile } from "./viewModel";
import type { EmissionResult } from "../emitModel";
import type { AlpModel } from "../fence";
import type { ShapeGroup } from "../model";
import {
  circlesFromOverlay,
  handleGrabRadiusTiles,
  hitTestCircles,
  hitTestRim,
  type TileCircle,
} from "./canvasGeometry";
import gameConstantsRaw from "../../../../../reference/data/game-constants.json";

// Same double-cast reasoning as PreviewPane.tsx for the same file: ajv
// (`npm run validate:reference`) is the real shape guarantee, not a runtime
// assertion here.
const terrainConstants = (
  gameConstantsRaw as unknown as { constants: TerrainConstant[] }
).constants;

const RADIUS_HANDLE_ID = (groupId: string) => `${groupId}#radiusHandle`;
const ROTATION_HANDLE_ID = (groupId: string) => `${groupId}#rotationHandle`;
// shape-kinds-slice-c-brief.md item 4: the two handles left of slice 5's own
// item 6, one per polar kind slice A introduced.
const LINE_END_HANDLE_ID = (groupId: string) => `${groupId}#lineEndHandle`;
const ARC_SWEEP_HANDLE_ID = (groupId: string) => `${groupId}#sweepHandle`;
const RIM_PREFIX = "rim:";

export interface LandPlacementCanvasProps {
  model: AlpModel;
  emission: EmissionResult | null;
  parseResult: ParseResult;
  lang: LanguageData;
  mapSize: MapSize;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onModelChange: (updater: AlpModel | ((prev: AlpModel) => AlpModel)) => void;
}

export function LandPlacementCanvas({
  model,
  emission,
  parseResult,
  lang,
  mapSize,
  selectedId,
  onSelect,
  onModelChange,
}: LandPlacementCanvasProps) {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [userFramed, setUserFramed] = useState(false);
  const [dragDecline, setDragDecline] = useState<string | null>(null);
  const { result: panelPreview } = usePanelPreviewResultContext();

  const mapDim = resolveMapDim(mapSize, lang.predefinedLabels ?? []) ?? 0;
  const selectedGroup: ShapeGroup | undefined = selectedId
    ? groupForMember(model, selectedId)
    : undefined;

  const overlayShapes = useMemo(() => {
    if (!emission || !emission.ok || mapDim === 0) return [];
    const shapes = buildOverlayShapes({
      model,
      quantities: emission.quantities,
      resolved: emission.resolved,
      roleNamesByPlacement: emission.roleNamesByPlacement,
      mapDim,
      selectedIds: selectedId ? new Set([selectedId]) : undefined,
    });
    // Sec.7.3's gizmo handles ("a radius ring handle, a rotation handle"),
    // additive on top of Sec.3.4 layer 2's own shared builder: they are this
    // PANEL's own selection UI, not something an external `mapOverlay`
    // consumer would ever ask for, so they are appended here rather than
    // folded into overlay.ts's own buildOverlayShapes.
    if (selectedGroup) {
      const frameCtx = resolveGroupFrameContext(selectedGroup.parent, emission);
      const radius = evalGroupExpr(selectedGroup.radius, emission);
      const rotation = evalGroupExpr(selectedGroup.rotation, emission);
      if (frameCtx && radius !== undefined && rotation !== undefined) {
        const { radiusHandle, rotationHandle } = gizmoHandlePositions(
          frameCtx.anchor,
          radius,
          rotation,
          selectedGroup.frame,
          frameCtx.parentDegreesResolved,
        );
        const toTile = (p: { x: number; y: number }) => ({
          x: percentToTile(p.x, mapDim),
          y: percentToTile(p.y, mapDim),
        });
        shapes.push(
          {
            id: RADIUS_HANDLE_ID(selectedGroup.id),
            kind: "handle",
            ...toTile(radiusHandle),
            role: "warning",
          },
          {
            id: ROTATION_HANDLE_ID(selectedGroup.id),
            kind: "handle",
            ...toTile(rotationHandle),
            role: "warning",
          },
        );
        // Item 4: a per-kind third handle, one of the two left of slice 5's
        // item 6 — a perimeter kind (square/triangle/polygon) needs neither,
        // its vertices are fully determined by radius and rotation, which
        // the two handles above already edit (shape-kinds-slice-c-brief.md
        // item 3's own closing argument).
        if (selectedGroup.kind === "line") {
          const lineEnd = lineEndHandlePosition(
            frameCtx.anchor,
            radius,
            rotation,
            selectedGroup.frame,
            frameCtx.parentDegreesResolved,
          );
          shapes.push({
            id: LINE_END_HANDLE_ID(selectedGroup.id),
            kind: "handle",
            ...toTile(lineEnd),
            role: "warning",
          });
        } else if (selectedGroup.kind === "arc") {
          const sweepPos = arcSweepHandlePosition(
            frameCtx.anchor,
            radius,
            rotation,
            selectedGroup.sweep ?? 180,
            selectedGroup.frame,
            frameCtx.parentDegreesResolved,
          );
          shapes.push({
            id: ARC_SWEEP_HANDLE_ID(selectedGroup.id),
            kind: "handle",
            ...toTile(sweepPos),
            role: "warning",
          });
        }
      }
    }
    return shapes;
  }, [model, emission, mapDim, selectedId, selectedGroup]);

  const palette = useMemo(
    () => createTerrainPalette(terrainConstants, DEFAULT_TERRAIN_COLOR_MODE),
    [],
  );
  const snapshot = panelPreview?.snapshots?.at(-1);
  const base =
    panelPreview && snapshot
      ? { result: panelPreview, snapshot, palette }
      : undefined;

  const dim = snapshot?.dim ?? mapDim;

  const circles = circlesFromOverlay(overlayShapes);
  const gizmoHandleCircles: TileCircle[] = useMemo(() => {
    if (!selectedGroup) return [];
    const r = handleGrabRadiusTiles(mapDim);
    // Item 4's own named hazard: a handle that draws (overlayShapes above)
    // and misses this filter is a handle that cannot be grabbed. All four
    // possible ids are named here so a new one added later fails loudly
    // (an unreachable id) rather than silently.
    const handleIds = new Set([
      RADIUS_HANDLE_ID(selectedGroup.id),
      ROTATION_HANDLE_ID(selectedGroup.id),
      LINE_END_HANDLE_ID(selectedGroup.id),
      ARC_SWEEP_HANDLE_ID(selectedGroup.id),
    ]);
    const out: TileCircle[] = [];
    for (const shape of overlayShapes) {
      if (shape.kind === "handle" && handleIds.has(shape.id)) {
        out.push({ id: shape.id, x: shape.x, y: shape.y, rTiles: r });
      }
    }
    return out;
  }, [overlayShapes, selectedGroup, mapDim]);

  // Sec.7.3 calls this a "rim HANDLE", and a handle belongs to the selection,
  // which is the rule the two gizmo handles above already follow. Offering
  // every land's rim at once cost more than it bought: the rim test wins over
  // the body test, so a press inside land A that happened to fall near land
  // B's edge started a chain from B rather than moving A, and on a map with
  // several lands there was no press that reliably meant "move this one".
  // Scoped to the selection, the gesture reads the same way the gizmo does,
  // click to select, then grab a handle.
  const rimCircles = useMemo(
    () =>
      selectedId === null ? [] : circles.filter((c) => c.id === selectedId),
    [circles, selectedId],
  );

  const hitTestDragStart = (tile: { x: number; y: number }): string | null => {
    // Handles are checked before member circles, already true and already
    // load-bearing before this slice (a circle's own member 0 sits under the
    // radius handle at rotation 0). A line's near-end handle sits exactly on
    // its own member 0 by construction (item 3, gizmoGeometry.ts), so this
    // is the first case where the overlap is guaranteed rather than
    // incidental — and it is the correct precedence, grabbing an end of a
    // line should resize the line, not select the land sitting under it.
    const handleHit = hitTestCircles(tile, gizmoHandleCircles);
    if (handleHit !== null) return handleHit;
    const rimHit = hitTestRim(
      tile,
      rimCircles,
      Math.max(1, handleGrabRadiusTiles(mapDim) * 0.6),
    );
    if (rimHit !== null) return RIM_PREFIX + rimHit;
    return hitTestCircles(tile, circles);
  };

  const handlePlacementDrag = (
    placementId: string,
    phase: "move" | "end",
    percent: { x: number; y: number },
    modifiers: OverlayDragModifiers,
  ) => {
    if (!emission?.ok) return;
    const placement = model.placements.find((p) => p.id === placementId);
    if (!placement) return;
    const anchor = resolvedPercentOf(placement.parent, emission);
    const previousPosition = resolvedPercentOf(placementId, emission);
    if (!anchor || !previousPosition) return;
    const parentDegreesResolved = resolvedDegreesOf(placement.parent, emission);

    // Ctrl is Sec.7.3's explicit integer-percent modifier, never the
    // default; every other drop point goes through the default snap set
    // (tile lattice unconditionally, centre/parent-axis magnetically).
    const snapped = modifiers.ctrl
      ? snapToIntegerPercent(percent)
      : applyDefaultSnapping(
          percent,
          buildSnapContext(model, placementId, emission, mapDim),
        );

    // per-player-escalation.md Sec.7.7: a direct member of a perPlayer ring
    // carries a theta the emitter will override regardless of its own
    // literal shape (slice-b-brief.md item 4) — dragMath.ts cannot see that
    // from the Expr alone, so it is passed in here.
    const isPerPlayerMember =
      groupForMember(model, placementId)?.perPlayer === true;
    // shape-kinds-slice-b-brief.md item 2: the placement's own currently
    // resolved offset, so a symbolic r/theta or dx/dy can absorb the drag's
    // delta instead of declining outright.
    const resolvedOffset = resolvedOffsetOf(placement, emission);
    const outcome = applyDrag(
      placement,
      anchor,
      previousPosition,
      snapped,
      parentDegreesResolved,
      isPerPlayerMember,
      resolvedOffset,
    );
    if (!outcome.ok) {
      // Sec.7.3: "the handle becomes a read only marker and the panel says
      // why... silently discarding a user's formula... is unacceptable."
      setDragDecline(outcome.reason);
      return;
    }
    setDragDecline(null);
    onModelChange((m) =>
      applyDragToPlacement(m, placementId, outcome.placement.offset),
    );
    void phase; // both move and end apply the same edit; only the final one matters once released
  };

  const handleRimDrag = (
    placementId: string,
    phase: "move" | "end",
    percent: { x: number; y: number },
  ) => {
    if (phase !== "end" || !emission?.ok || mapDim <= 0) return; // commit on release only, no live preview in this pass
    const dropTile = {
      x: Math.floor((percent.x / 100) * mapDim),
      y: Math.floor((percent.y / 100) * mapDim),
    };
    const centreTile = { x: mapDim / 2, y: mapDim / 2 };
    const onCentre =
      Math.hypot(dropTile.x - centreTile.x, dropTile.y - centreTile.y) <=
      handleGrabRadiusTiles(mapDim);
    const dropTargetId = onCentre
      ? "center"
      : circles.some((c) => c.id !== placementId)
        ? hitTestCircles(
            dropTile,
            circles.filter((c) => c.id !== placementId),
          )
        : null;
    if (dropTargetId === null) return; // refused: not over a valid target
    const result = computeRimDragReparent(
      model,
      emission,
      placementId,
      dropTargetId,
      mapDim,
    );
    if (result.ok) onModelChange(result.model);
  };

  const handleGizmoDrag = (
    groupId: string,
    isRadius: boolean,
    percent: { x: number; y: number },
  ) => {
    if (!emission?.ok) return;
    const group = model.groups.find((g) => g.id === groupId);
    if (!group) return;
    const frameCtx = resolveGroupFrameContext(group.parent, emission);
    if (!frameCtx) return;
    // The same refusal `applyDrag` makes for a placement, at the one site
    // that does not go through it: these handles patch a ShapeGroup's own
    // radius/rotation directly, so a group whose rotation is a RandomParam
    // (Sec.4.5's worked example) would have it overwritten with a literal by
    // one drag of the rotation handle, taking every member's steering with
    // it. Sec.7.3's own remedy is the handle staying a read-only marker with
    // the panel saying why, which is what this does: it still draws, it
    // declines to commit, and `dragDecline` renders the reason.
    const edited = isRadius ? group.radius : group.rotation;
    if (evalClosed(edited) === undefined) {
      setDragDecline(
        symbolicDeclineReason([
          isRadius ? "This ring's radius" : "This ring's rotation",
        ]),
      );
      return;
    }
    setDragDecline(null);
    const dragged = dragPolar(
      frameCtx.anchor,
      percent,
      group.frame,
      frameCtx.parentDegreesResolved,
    );
    // Sec.7.3: "the radius handle keeps the bearing and takes the distance;
    // the rotation handle keeps the distance and takes the bearing" —
    // routed through applyGroupEdit -> reExpand(), NEVER a fresh
    // expandShapeGroup, per that item's own explicit instruction.
    onModelChange((m) => {
      const patch = isRadius
        ? { radius: num(dragged.r) }
        : { rotation: num(dragged.theta) };
      const result = applyGroupEdit(m, groupId, patch, parseResult, emission);
      return result ? result.model : m;
    });
  };

  // Item 3/4: the line's near-end handle. Both `radius` and `rotation` come
  // out of ONE `computeLineEndDrag` call and go into ONE `applyGroupEdit`
  // call — hazard 2's own warning against two edits where one belongs.
  const handleLineEndDrag = (
    groupId: string,
    percent: { x: number; y: number },
  ) => {
    if (!emission?.ok) return;
    const group = model.groups.find((g) => g.id === groupId);
    if (!group) return;
    const frameCtx = resolveGroupFrameContext(group.parent, emission);
    if (!frameCtx) return;
    const outcome = computeLineEndDrag(group, frameCtx, percent);
    if (!outcome.ok) {
      setDragDecline(outcome.reason);
      return;
    }
    setDragDecline(null);
    onModelChange((m) => {
      const patch = {
        radius: num(outcome.result.radius),
        rotation: num(outcome.result.rotation),
      };
      const result = applyGroupEdit(m, groupId, patch, parseResult, emission);
      return result ? result.model : m;
    });
  };

  // Item 3/4: the arc's sweep handle. `sweep` is a plain number, never an
  // `Expr`, so there is no symbolic field to decline against here (the
  // brief's own point: this handle can never hit that refusal).
  const handleArcSweepDrag = (
    groupId: string,
    percent: { x: number; y: number },
  ) => {
    if (!emission?.ok) return;
    const group = model.groups.find((g) => g.id === groupId);
    if (!group) return;
    const frameCtx = resolveGroupFrameContext(group.parent, emission);
    if (!frameCtx) return;
    const rotation = evalGroupExpr(group.rotation, emission);
    if (rotation === undefined) return; // no resolved rotation to measure the sweep against
    const sweep = computeArcSweepDrag(group, frameCtx, rotation, percent);
    onModelChange((m) => {
      const result = applyGroupEdit(
        m,
        groupId,
        { sweep },
        parseResult,
        emission,
      );
      return result ? result.model : m;
    });
  };

  const onDrag = (
    shapeId: string,
    phase: "move" | "end",
    percent: { x: number; y: number },
    modifiers: OverlayDragModifiers,
  ) => {
    if (selectedGroup && shapeId === RADIUS_HANDLE_ID(selectedGroup.id))
      return handleGizmoDrag(selectedGroup.id, true, percent);
    if (selectedGroup && shapeId === ROTATION_HANDLE_ID(selectedGroup.id))
      return handleGizmoDrag(selectedGroup.id, false, percent);
    if (selectedGroup && shapeId === LINE_END_HANDLE_ID(selectedGroup.id))
      return handleLineEndDrag(selectedGroup.id, percent);
    if (selectedGroup && shapeId === ARC_SWEEP_HANDLE_ID(selectedGroup.id))
      return handleArcSweepDrag(selectedGroup.id, percent);
    if (shapeId.startsWith(RIM_PREFIX))
      return handleRimDrag(shapeId.slice(RIM_PREFIX.length), phase, percent);
    return handlePlacementDrag(shapeId, phase, percent, modifiers);
  };

  if (dim === 0) {
    return <p>Waiting on map size…</p>;
  }

  return (
    <>
      <OverlayCanvas
        dim={dim}
        viewport={viewport}
        setViewport={setViewport}
        userFramed={userFramed}
        setUserFramed={setUserFramed}
        onHoverTile={() => {}}
        selected={null}
        onTileClick={(tile) => onSelect(hitTestCircles(tile, circles))}
        hitTestDragStart={hitTestDragStart}
        onDrag={onDrag}
        base={base}
        overlayShapes={overlayShapes}
        helpTipId="landPlacement.canvas"
        showApproximateBadge={base !== undefined}
      />
      {dragDecline !== null && <p role="alert">{dragDecline}</p>}
    </>
  );
}
