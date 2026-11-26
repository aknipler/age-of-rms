import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// A separate config for the RMS0324 corpus gate
// (src/parser/__tests__/undefinedNames.measure.test.ts), kept out of
// `npm test` the way vitest.includes.config.ts keeps the include gate out:
// vitest.config.ts's `exclude` names the file. It parses and validates 243
// scripts and reads DE's include files and random_map.def from a local
// install. `testTimeout` is far above the real cost, margin against this
// machine's laptop-sleep wall-clock inflation.
//
// Run with: npm run measure:undefined-names
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/parser/__tests__/undefinedNames.measure.test.ts"],
    testTimeout: 172_800_000,
  },
});
