import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// The name liveness measurement
// (src/parser/liveness/__tests__/liveness.measure.test.ts), kept out of
// `npm test` for the same reason as the include resolution gate: it analyses
// 243 scripts and reads DE's include files, and this repo has documented
// wall-clock flake on shared hardware. vitest.config.ts's `exclude` names the
// file too. A config of its own narrows `include` to this one file and gives
// it a timeout long enough for the sweep.
//
// Run with: npm run measure:liveness
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/parser/liveness/__tests__/liveness.measure.test.ts"],
    testTimeout: 172_800_000,
  },
});
