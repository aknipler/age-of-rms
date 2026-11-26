import { defineConfig } from "vitest/config";

// The preview generation benchmark
// (src/preview/__tests__/generationBench.measure.test.ts), kept out of
// `npm test` like the other measure configs: vitest.config.ts's `exclude`
// names the file. A node environment rather than jsdom, since the generator
// is pure and jsdom only adds start up time. `testTimeout` is far above the
// real cost (a few minutes), margin against laptop sleep.
//
// Run with: npm run bench:preview, then npm run bench:compare
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/preview/__tests__/generationBench.measure.test.ts"],
    testTimeout: 172_800_000,
  },
});
