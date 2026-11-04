// React 19.2's development build diffed the parse result into props tables
// for its Performance tracks, which froze `tauri dev` for 1.3 to 1.9 s per
// commit on Stranded.rms. devReactTracks.ts turns the tracks off by removing
// console.timeStamp before react-dom is evaluated.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { disableReactTracks } from "../devReactTracks";

describe("disableReactTracks", () => {
  it("removes timeStamp in a development build", () => {
    const target: { timeStamp?: unknown } = { timeStamp: () => {} };
    expect(disableReactTracks(target, true, false)).toBe(true);
    expect(typeof target.timeStamp).toBe("undefined");
  });

  it("leaves it alone in production or when the flag asks for tracks", () => {
    const fn = () => {};
    const prod: { timeStamp?: unknown } = { timeStamp: fn };
    const flagged: { timeStamp?: unknown } = { timeStamp: fn };
    expect(disableReactTracks(prod, false, false)).toBe(false);
    expect(disableReactTracks(flagged, true, true)).toBe(false);
    expect(prod.timeStamp).toBe(fn);
    expect(flagged.timeStamp).toBe(fn);
  });

  // The switch works only because ES modules are evaluated in import order,
  // so react-dom reads console.timeStamp after this file has removed it.
  // Moving the import below "react-dom/client" would silently undo the fix.
  it("is main.tsx's first import", () => {
    const main = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");
    const firstImport = main
      .split("\n")
      .find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "./devReactTracks";');
  });
});
