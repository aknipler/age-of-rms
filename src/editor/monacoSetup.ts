// Self-hosts Monaco instead of letting @monaco-editor/react fetch it from
// a CDN at runtime. This app is a desktop app that must work fully
// offline, so nothing about the editor can depend on network access.
// Import this file once, before any <Editor> mounts (see main.tsx) — it's
// a side-effecting module, not something you call.
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";

// TypeScript doesn't know the global `self` has a MonacoEnvironment
// property — that's a convention Monaco's loader reads at runtime, not
// something declared on Window/WorkerGlobalScope by default. This tells
// TS about it, using the type Monaco itself ships for that shape.
declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

// Only the generic editor worker is needed while the Code tab is
// plaintext (Phase 1.3). A custom Monarch-based "aoe2-rms" language
// (Phase 1.4) still runs on this same worker — dedicated per-language
// workers (like the ones bundled for JSON/TypeScript/CSS) are only
// needed for Monaco's built-in rich language services, which we don't
// use here.
self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

loader.config({ monaco });
