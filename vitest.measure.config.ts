import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// A separate config for the consistency-checker corpus reporter
// (src/tools/__tests__/consistencyChecker.measure.test.ts) rather than a
// second entry in vitest.config.ts's own suite: it re-derives every figure
// docs/consistency-checker-design.md's review rounds have hand-measured
// through throwaway probes over and over, generating every tracked/on-disk
// map across five separate sweeps (Sections 1-6's two original sweeps, plus
// rev 13/14's four owed censuses — Section 10 sweeps 2/4/6/8 @ seeds 1-5,
// Section 11 sweeps 2/4/6/8 @ the tool's own default 15 seeds/count, the
// most expensive thing in the file). That is on the order of 30-45 minutes
// on this machine, and this repo has documented wall-clock flake on shared
// hardware (CLAUDE.md's own "duration spread" tracked-debt entry), so it
// must stay out of `npm test` — vitest.config.ts's `exclude` names this file
// explicitly for the same reason.
//
// Mirrors vitest.config.ts (jsdom + globals + the react plugin) so the
// harness pattern (loadLanguage/buildLanguageIndex/generatePreview) behaves
// identically; the only real difference is `include` narrowed to this one
// file and a `testTimeout` long enough for the full sweep plus this
// project's own ~3.7x observed load factor.
//
// Run with: npm run measure:checker
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/tools/__tests__/consistencyChecker.measure.test.ts"],
    testTimeout: 172_800_000,
  },
});
