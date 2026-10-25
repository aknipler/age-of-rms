import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// `npm run generate:skeletons` (docs/name-lookup-design.md Sec.13.4.1).
// A generator, not a test. It writes reference/data/block-skeletons.json
// from every map on this disk, so it lives outside `npm test`, whose
// default include never matches its `.generate.ts` name. Mirrors
// vitest.config.ts otherwise, so the parser loads the same way.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/editor/__tests__/blockSkeletons.generate.ts"],
    testTimeout: 600_000,
  },
});
