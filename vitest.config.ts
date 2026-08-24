import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    // The consistency-checker corpus reporter (vitest.measure.config.ts,
    // `npm run measure:checker`) takes 440-515s (measured 2026-08-18) and this repo has documented
    // wall-clock flake — it must never run as part of the default `npm test`
    // suite. Vitest's own default include (`**/*.{test,spec}.?(c|m)[jt]s?(x)`)
    // would otherwise catch it like any other `*.test.ts` file, so it is
    // excluded here explicitly rather than relying on the separate config
    // file to keep it out.
    exclude: [...configDefaults.exclude, "src/tools/__tests__/consistencyChecker.measure.test.ts"],
  },
});
