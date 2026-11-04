// Spike H1 of docs/local-history-design.md, kept so it can be run again.
// Not part of the app. README.md beside it says how to wire it in for a run
// and how to take it back out.
import { Buffer } from "buffer";
import * as fsp from "@tauri-apps/plugin-fs";
import { appDataDir, join } from "@tauri-apps/api/path";
import { exit } from "@tauri-apps/plugin-process";
import { getCurrentWindow } from "@tauri-apps/api/window";

type Json = Record<string, unknown>;

function codeFor(message: string): string | undefined {
  if (/os error 2\b|os error 3\b|not found|cannot find/i.test(message))
    return "ENOENT";
  if (/os error 183\b|os error 17\b|already exists/i.test(message))
    return "EEXIST";
  if (/os error 145\b|not empty/i.test(message)) return "ENOTEMPTY";
  return undefined;
}

const calls: Record<string, { n: number; ms: number }> = {};
let currentOp = "other";
function wrap<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  name = "op",
) {
  return async (...args: A): Promise<R> => {
    const key = `${currentOp}.${name}`;
    const t = performance.now();
    calls[key] ??= { n: 0, ms: 0 };
    calls[key].n++;
    try {
      return await fn(...args);
    } catch (e) {
      const message = String(e);
      const err = new Error(message) as Error & { code?: string };
      err.code = codeFor(message);
      throw err;
    } finally {
      calls[key].ms += performance.now() - t;
    }
  };
}

function toStats(info: fsp.FileInfo) {
  const mtimeMs = info.mtime ? info.mtime.getTime() : 0;
  return {
    isFile: () => info.isFile,
    isDirectory: () => info.isDirectory,
    isSymbolicLink: () => info.isSymlink,
    size: info.size,
    mtimeMs,
    ctimeMs: mtimeMs,
    mode: info.isDirectory ? 0o40000 : 0o100644,
    uid: 0,
    gid: 0,
    dev: 0,
    ino: 0,
  };
}

const adapter = {
  promises: {
    readFile: wrap(
      async (path: string, opts?: string | { encoding?: string }) => {
        const encoding = typeof opts === "string" ? opts : opts?.encoding;
        if (encoding === "utf8") return fsp.readTextFile(path);
        return Buffer.from(await fsp.readFile(path));
      },
      "readFile",
    ),
    writeFile: wrap(async (path: string, data: string | Uint8Array) => {
      if (typeof data === "string") return fsp.writeTextFile(path, data);
      return fsp.writeFile(path, new Uint8Array(data));
    }, "writeFile"),
    unlink: wrap((path: string) => fsp.remove(path), "unlink"),
    rmdir: wrap((path: string) => fsp.remove(path), "rmdir"),
    mkdir: wrap((path: string) => fsp.mkdir(path), "mkdir"),
    readdir: wrap(
      async (path: string) => (await fsp.readDir(path)).map((e) => e.name),
      "readdir",
    ),
    stat: wrap(async (path: string) => toStats(await fsp.stat(path)), "stat"),
    lstat: wrap(
      async (path: string) => toStats(await fsp.lstat(path)),
      "lstat",
    ),
    // isomorphic-git binds these at construction even though its docs call
    // them optional. A bare store of one text file never has symlinks.
    readlink: async () => {
      throw Object.assign(new Error("readlink unsupported"), {
        code: "ENOSYS",
      });
    },
    symlink: async () => {
      throw Object.assign(new Error("symlink unsupported"), { code: "ENOSYS" });
    },
  },
};

async function errorOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "(no error)";
  } catch (e) {
    return `${typeof e}: ${String(e)}`;
  }
}

async function dirSize(
  path: string,
): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await fsp.readDir(path)) {
    const child = await join(path, entry.name);
    if (entry.isDirectory) {
      const sub = await dirSize(child);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      bytes += (await fsp.stat(child)).size;
      files++;
    }
  }
  return { bytes, files };
}

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: +s[0].toFixed(1),
    median: +s[Math.floor(s.length / 2)].toFixed(1),
    max: +s[s.length - 1].toFixed(1),
  };
}

// WebView2 throttles a hidden or covered window, which would inflate every
// timing below. These record what the page itself saw, so a run can show it
// was on screen rather than relying on anyone remembering.
const visibility: Json[] = [];
let visibilityChanges = 0;
document.addEventListener("visibilitychange", () => visibilityChanges++);
async function frameRate(ms = 1000): Promise<number> {
  let frames = 0;
  const end = performance.now() + ms;
  await new Promise<void>((resolve) => {
    const tick = () => {
      frames++;
      if (performance.now() < end) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  return frames;
}
async function sampleVisibility(phase: string): Promise<void> {
  visibility.push({
    phase,
    at: new Date().toISOString(),
    state: document.visibilityState,
    focus: document.hasFocus(),
    framesPerSecond: await frameRate(),
    width: window.innerWidth,
    height: window.innerHeight,
  });
}

export async function runH1(options?: {
  after?: (sample: (phase: string) => Promise<void>) => Promise<Json>;
}): Promise<void> {
  const results: Json = { startedAt: new Date().toISOString() };
  const base = await join(await appDataDir(), "history-spike");
  const out = await join(base, "h1-results.json");
  try {
    (globalThis as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
    if (await fsp.exists(base)) await fsp.remove(base, { recursive: true });
    await fsp.mkdir(base, { recursive: true });
    await fsp.mkdir(await join(base, "probe-dir"));
    await fsp.writeTextFile(await join(base, "probe-dir", "x.txt"), "x");
    // Needs core:window:allow-set-focus for the run (README step 3).
    await getCurrentWindow()
      .setFocus()
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 2000));
    await sampleVisibility("start");

    const missing = await join(base, "does-not-exist", "file.txt");
    results.errors = {
      readTextFileMissing: await errorOf(() => fsp.readTextFile(missing)),
      readFileMissing: await errorOf(() => fsp.readFile(missing)),
      statMissing: await errorOf(() => fsp.stat(missing)),
      lstatMissing: await errorOf(() => fsp.lstat(missing)),
      readDirMissing: await errorOf(async () =>
        fsp.readDir(await join(base, "does-not-exist")),
      ),
      mkdirExisting: await errorOf(async () =>
        fsp.mkdir(await join(base, "probe-dir")),
      ),
      mkdirParentMissing: await errorOf(async () =>
        fsp.mkdir(await join(base, "a", "b")),
      ),
      removeMissing: await errorOf(() => fsp.remove(missing)),
      removeNonEmptyDir: await errorOf(async () =>
        fsp.remove(await join(base, "probe-dir")),
      ),
      writeTextFileParentMissing: await errorOf(() =>
        fsp.writeTextFile(missing, "x"),
      ),
    };
    results.mappedCodes = Object.fromEntries(
      Object.entries(results.errors as Record<string, string>).map(([k, v]) => [
        k,
        codeFor(v) ?? null,
      ]),
    );

    const rt: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      await fsp.exists(base);
      rt.push(performance.now() - t);
    }
    results.roundTripExistsMs = stats(rt);
    // A core command with no plugin and no disk access, to separate the
    // IPC bridge's own cost from the fs plugin's.
    const core: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      await getCurrentWindow().isMaximized();
      core.push(performance.now() - t);
    }
    results.roundTripCoreMs = stats(core);
    await new Promise((r) => setTimeout(r, 30000));
    const rtIdle: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t = performance.now();
      await fsp.exists(base);
      rtIdle.push(performance.now() - t);
    }
    results.roundTripExistsIdleMs = stats(rtIdle);
    await sampleVisibility("after idle");
    for (const k of Object.keys(calls)) delete calls[k];
    const git = await import("isomorphic-git");
    const maps: Record<string, string> = {
      median:
        "C:/Users/assas/Documents/AOE2_projects/RMS/age-of-rms/test-maps/Comeer v1.5.rms",
      largest:
        "C:/Users/assas/Documents/AOE2_projects/RMS/age-of-rms/test-maps/AK_Vanguard_v1.2.rms",
    };
    const runs: Json = {};
    for (const [label, mapPath] of Object.entries(maps)) {
      const text = await fsp.readTextFile(mapPath);
      const gitdir = await join(base, "scripts", `${label}.git`);
      const t0 = performance.now();
      await git.init({
        fs: adapter,
        dir: gitdir,
        gitdir,
        bare: true,
        defaultBranch: "main",
      });
      const initMs = performance.now() - t0;
      const commitMs: number[] = [];
      const commits: string[] = [];
      let parent: string | null = null;
      for (let i = 0; i < 20; i++) {
        const version = `${text}\n/* edit ${i} */\n`;
        currentOp = `${label}.commit`;
        const start = performance.now();
        const blob = await git.writeBlob({
          fs: adapter,
          gitdir,
          blob: new TextEncoder().encode(version),
        });
        const tree = await git.writeTree({
          fs: adapter,
          gitdir,
          tree: [
            { mode: "100644", path: "script.rms", oid: blob, type: "blob" },
          ],
        });
        const who = {
          name: "Spike",
          email: "history@age-of-rms.local",
          timestamp: Math.floor(Date.now() / 1000),
          timezoneOffset: new Date().getTimezoneOffset(),
        };
        const commit: string = await git.writeCommit({
          fs: adapter,
          gitdir,
          commit: {
            message: `Saved\n\nkind: save\nindex: ${i}\n`,
            tree,
            parent: parent ? [parent] : [],
            author: who,
            committer: who,
          },
        });
        await git.writeRef({
          fs: adapter,
          gitdir,
          ref: "refs/heads/main",
          value: commit,
          force: true,
        });
        commitMs.push(performance.now() - start);
        commits.push(commit);
        parent = commit;
      }
      currentOp = `${label}.log`;
      const logStart = performance.now();
      const log = await git.log({ fs: adapter, gitdir, ref: "main" });
      const logMs = performance.now() - logStart;
      const readStart = performance.now();
      const first = await git.readBlob({
        fs: adapter,
        gitdir,
        oid: commits[0],
        filepath: "script.rms",
      });
      const readMs = performance.now() - readStart;
      const roundTrip =
        new TextDecoder().decode(first.blob) === `${text}\n/* edit 0 */\n`;
      await git.addNote({
        fs: adapter,
        gitdir,
        oid: commits[3],
        note: "tried bigger lakes",
        author: { name: "Spike", email: "history@age-of-rms.local" },
      });
      const note = new TextDecoder().decode(
        await git.readNote({ fs: adapter, gitdir, oid: commits[3] }),
      );
      runs[label] = {
        chars: text.length,
        initMs: +initMs.toFixed(1),
        commitMs: stats(commitMs),
        logCount: log.length,
        logMs: +logMs.toFixed(1),
        readFirstBlobMs: +readMs.toFixed(1),
        roundTrip,
        noteRoundTrip: note === "tried bigger lakes",
        disk: await dirSize(gitdir),
      };
    }
    results.runs = runs;
    await sampleVisibility("after commits");
    results.calls = Object.fromEntries(
      Object.entries(calls).map(([k, v]) => [
        k,
        { n: v.n, ms: +v.ms.toFixed(0) },
      ]),
    );
    results.ok = true;
    if (options?.after) results.after = await options.after(sampleVisibility);
  } catch (e) {
    results.ok = false;
    results.error = String(e);
    results.stack = e instanceof Error ? e.stack : undefined;
  }
  results.visibility = visibility;
  results.visibilityChanges = visibilityChanges;
  results.finishedAt = new Date().toISOString();
  try {
    await fsp.writeTextFile(out, JSON.stringify(results, null, 2));
  } finally {
    await exit(0);
  }
}
