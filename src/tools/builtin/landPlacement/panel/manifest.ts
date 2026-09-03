// The Land Placement tool's manifest (land-placement-design.md Sec.3.2).
// `surface: "panel"` is what makes `ToolsPane` render `component` instead of
// running it through `ToolHost.start()`. See registry.ts's `RegisteredTool`
// union and its own comment on why a panel manifest can never arrive over
// the external transport (JSON cannot carry the `component` a panel arm
// needs, so the restriction is structural, not a validator check).

import { TOOLS_API_VERSION, type ToolManifest } from "../../../../../tools-api/index";

export const landPlacementManifest: ToolManifest = {
  id: "land-placement",
  name: "Land Placement",
  version: "0.1.0",
  apiVersion: TOOLS_API_VERSION,
  description:
    "Design ring, chain and lattice layouts of lands visually, and emit the create_land script that places them.",
  // A panel's Apply is computed and applied directly by the panel component
  // (computeApplyEdits -> applyTextEdits), never through ToolHost's
  // progress/partial/result lifecycle, so `currentToolMayEdit()`'s
  // edit-drop enforcement never actually consults this for a panel run.
  // Declared anyway for the same reason every other capability list is
  // declared: it is what this tool IS allowed to do, not only what the host
  // happens to check today.
  capabilities: ["edit-source", "read-ast", "read-generation-settings"],
  surface: "panel",
};
