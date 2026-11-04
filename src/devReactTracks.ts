// Turns off React's development Performance tracks unless asked for. main.tsx
// imports this file FIRST, ahead of "react-dom/client", and that order is the
// whole mechanism. An ES module's imports are evaluated in the order they are
// written, so this file runs before react-dom does. react-dom decides once,
// while its own module is evaluated, whether to log its tracks, by checking
// that `console.timeStamp` and `performance.measure` both exist
// (`supportsUserTiming` in react-dom's development build). Removing
// `console.timeStamp` before that check makes it false for the whole session.
//
// Why. React 19.2's development build records every component render for the
// browser's Performance panel, and for each component whose props changed it
// builds a table of the old and new props, three levels deep, then hands that
// table to `performance.measure`, which copies it. A component that receives
// the parse result gets a row per token. On DE's Stranded.rms (48,000 tokens)
// that was about 255,000 rows for each of seven components on every commit,
// and the main thread froze for 1.3 to 1.9 s after each parse or preview
// result while the user typed. Production builds contain none of this code,
// so a release never paid it, but `npm run tauri dev` did on every edit.
// Measured 2026-11-04, see docs/diagnostics-latency-report.md Sec.10.
//
// The usual alternative would be to keep large objects out of props, which is
// not possible here. Every provider's `value` is a prop too, and the parse
// result is the app's central value.
//
// To get the tracks back for a profiling session, run this in the dev tools
// console and reload.
//
//   localStorage.setItem("aorms.reactTracks", "1"); location.reload();

/** The localStorage key that keeps React's tracks on. */
export const REACT_TRACKS_FLAG = "aorms.reactTracks";

function wantsTracks(): boolean {
  // Same guard as perfTrace.ts. localStorage can throw in a locked down host,
  // and a failure means the default, tracks off.
  try {
    return globalThis.localStorage?.getItem(REACT_TRACKS_FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Removes `console.timeStamp` in a development build unless the flag is set.
 * Exported so the test can run it against a stand-in console. Returns whether
 * it removed anything.
 */
export function disableReactTracks(
  target: { timeStamp?: unknown },
  isDev: boolean,
  keepTracks: boolean,
): boolean {
  if (!isDev || keepTracks || typeof target.timeStamp !== "function") {
    return false;
  }
  // defineProperty rather than plain assignment, because TypeScript types
  // `console.timeStamp` as a method that is always there, and this works on
  // whatever object the test passes in as well.
  Object.defineProperty(target, "timeStamp", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  return true;
}

disableReactTracks(console, import.meta.env.DEV, wantsTracks());
