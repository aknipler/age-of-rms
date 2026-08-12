import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Bakes the version into the bundle at build time. package.json is already
  // the single source of truth for it (tauri.conf.json reads the same file),
  // so a bug report and an installer can never disagree about what was
  // running. Deliberately not read at runtime through the Tauri app API: that
  // would need a permission and an await for a value that is fixed the moment
  // the bundle is built.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  // Monaco's editor.worker is imported with Vite's `?worker` suffix (see
  // src/editor/monacoSetup.ts) so the editor is fully self-hosted — no
  // CDN fetch at runtime, which matters for a desktop app that should
  // work offline. That worker needs to build as an ES module.
  worker: {
    format: "es",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
