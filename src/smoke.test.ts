import { describe, expect, it } from "vitest";

// Placeholder so `npm test` and CI have something to run before real
// test suites exist (parser tests land in Phase 2, etc). Safe to delete
// once real tests are added.
describe("CI smoke test", () => {
  it("pipeline is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
