// tutorial-islands-design.md Sec.4.3, the app's side of a step's pinned
// preview. The engine (TutorialContext.tsx) decides WHEN to apply a pin. This
// hook knows HOW, because only something rendered below PreviewViewProvider
// and GenerationSettingsProvider can reach the seed and the lobby.
// AppContent calls it once.
//
// Nothing is restored when the tutorial ends. The learner keeps the pinned
// settings, so the map they just built still previews the way it did.

import { useGenerationSettings } from "../generationSettings/GenerationSettingsContext";
import { usePreviewView } from "../components/preview/PreviewViewContext";
import { useRegisterPreviewPinner } from "./TutorialContext";

export function useAppPreviewPinner(): void {
  const { setSeed } = usePreviewView();
  const { selectTeamPreset, setMapSize } = useGenerationSettings();

  // A fresh object every render is fine. useRegisterPreviewPinner forwards
  // through a ref, so the engine always calls this render's closures.
  useRegisterPreviewPinner({
    apply: (pin) => {
      // `selectTeamPreset`, never `toggleTeamPreset`. Two steps in a row that
      // pin "1v1" would otherwise switch it on and then off again.
      if (pin.teamPreset !== undefined) selectTeamPreset(pin.teamPreset);
      if (pin.mapSize !== undefined) setMapSize(pin.mapSize);
      if (pin.seed !== undefined) setSeed(pin.seed);
    },
  });
}
