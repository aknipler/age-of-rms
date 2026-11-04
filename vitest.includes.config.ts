import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// A separate config for the include resolution corpus gate
// (src/parser/__tests__/includeResolution.measure.test.ts), kept out of
// `npm test` the way vitest.measure.config.ts keeps the consistency checker's
// sweeps out: vitest.config.ts's `exclude` names the file. The gate parses and
// validates 243 scripts and reads 600 K characters of DE's include files from
// a local install, so it runs in a minute or two on a quiet machine and
// longer under load. `testTimeout` is far above that, margin against this
// machine's laptop-sleep wall-clock inflation rather than real cost.
//
// Mirrors vitest.config.ts (jsdom + globals + the react plugin) so the
// harness behaves identically; the only differences are `include` narrowed to
// this one file and the long timeout.
//
// Run with: npm run measure:includes
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/parser/__tests__/includeResolution.measure.test.ts"],
    testTimeout: 172_800_000,
  },
});
