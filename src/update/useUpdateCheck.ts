import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * The update check's outcome, as a *discriminated union* rather than a bag of
 * booleans. `status` is the discriminant, so once a `switch` or an `if` narrows
 * on it TypeScript knows `version` exists in the "available" case and nowhere
 * else. Three booleans (checking/available/failed) could represent
 * "simultaneously installing and errored", which is not a state this can be in.
 */
export type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; notes: string | null }
  | { status: "downloading" }
  | { status: "error"; message: string };

/**
 * Checks GitHub for a newer release once, on mount, and exposes an installer.
 *
 * Silent on failure by design. The overwhelmingly common reason `check()`
 * rejects is that the machine is offline or GitHub is briefly unreachable, and
 * an error toast on startup for that would train users to dismiss the app's
 * notifications. A failed check leaves the state `idle`, which renders nothing.
 * `install()`'s failures DO surface, because by then the user asked for
 * something and silence would read as a broken button.
 */
export function useUpdateCheck(): {
  state: UpdateState;
  install: () => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  // The handle used to download and install. Held in a ref, not state, because
  // nothing renders it — putting it in state would schedule a re-render every
  // time it changed, for a value no JSX reads.
  const updateRef = useRef<Update | null>(null);

  // React 18+ StrictMode deliberately runs effects twice in development to
  // surface missing cleanup. Without this latch the app would hit the network
  // twice on every dev start. The `cancelled` flag below is a separate concern
  // and both are needed.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Set on cleanup, and checked after every await. An async function started
    // in an effect can resolve after the component is gone, and calling
    // setState then is a memory leak at best. The effect cannot "cancel" the
    // promise, so it marks the result as unwanted instead.
    let cancelled = false;

    async function run() {
      try {
        const update = await check();
        if (cancelled || update === null) return;
        updateRef.current = update;
        setState({ status: "available", version: update.version, notes: update.body ?? null });
      } catch {
        // Deliberately swallowed. See the note on this hook.
      }
    }

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  const install = useCallback(() => {
    const update = updateRef.current;
    if (update === null) return;

    setState({ status: "downloading" });

    void (async () => {
      try {
        await update.downloadAndInstall();
        // On Windows the installer closes the app itself, so this line is
        // usually never reached. It is here for macOS and Linux, where the
        // running binary is swapped underneath and the process has to be
        // restarted explicitly. Calling it on Windows too is harmless and
        // keeps the code honest about being cross-platform.
        await relaunch();
      } catch (error) {
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, []);

  const dismiss = useCallback(() => setState({ status: "idle" }), []);

  return { state, install, dismiss };
}
