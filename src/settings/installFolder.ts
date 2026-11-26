// The AoE2 install folder chosen in Settings > General, held outside React.
//
// The readers of the install (useIncludeFiles.ts, deTextureSource.ts, the
// Open dialog in useDocument.ts) cache their folder in module-level promises,
// not component state, because the answer belongs to no one component. A
// React context cannot reach those caches, so the choice lives here as a
// small external store: a value, a setter, and a subscribe function. This is
// the shape React's own `useSyncExternalStore` expects, which is how a hook
// reads it (useInstallFolderVersion below).
//
// AppSettingsContext loads the saved choice and writes it here. A change
// bumps `version`, the readers drop their caches, and hooks keyed on the
// version read the disk again.

import { useSyncExternalStore } from "react";

let chosen = "";
let version = 0;
const listeners = new Set<() => void>();

/** The chosen folder, or "" for search automatically. */
export function chosenInstallFolder(): string {
  return chosen;
}

/** Called by AppSettingsContext on load and on every change. */
export function setChosenInstallFolder(next: string): void {
  const trimmed = next.trim();
  if (trimmed === chosen) return;
  chosen = trimmed;
  version++;
  for (const listener of listeners) listener();
}

/** Runs `listener` after every change. Returns the unsubscribe function. */
export function onInstallFolderChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A number that changes whenever the chosen folder does, for effect dependencies. */
export function useInstallFolderVersion(): number {
  return useSyncExternalStore(onInstallFolderChange, () => version);
}
