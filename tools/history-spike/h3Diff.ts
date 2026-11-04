// Spike H3 of docs/local-history-design.md, kept so it can be run again.
// Not part of the app. It opens Monaco's diff editor over the running app,
// with the app's own language and theme, on two real comparisons, and
// returns what it measured to the H1 run, which writes the results file.
// README.md beside it says how to wire it in.
import * as monaco from "monaco-editor";
import * as fsp from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { defineAoe2RmsMonacoTheme } from "../editor/monacoTheme";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../settings/theme";

type Json = Record<string, unknown>;

const MAPS = "C:/Users/assas/Documents/AOE2_projects/RMS/age-of-rms/test-maps";
const DE_MAPS =
  "C:/Program Files (x86)/Steam/steamapps/common/AoE2DE/resources/_common/random-map-scripts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Three one-number edits spread through the file, the shape of a typical
// save between two snapshots.
function smallEdits(text: string): string {
  const lines = text.split("\n");
  for (const at of [0.2, 0.5, 0.8]) {
    const i = lines.findIndex(
      (line, n) => n >= Math.floor(lines.length * at) && /\d/.test(line),
    );
    if (i >= 0) lines[i] = lines[i].replace(/\d+/, (d) => String(+d + 1));
  }
  return lines.join("\n");
}

// The longest gap between 4 ms timer ticks while the diff is computed. A
// diff run on the main thread would show up here as a long gap, one run in
// the editor worker would not.
function watchMainThread(): () => number {
  let last = performance.now();
  let worst = 0;
  const id = setInterval(() => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
  }, 4);
  return () => {
    clearInterval(id);
    return +worst.toFixed(1);
  };
}

function tokenClasses(root: HTMLElement): number {
  const found = new Set<string>();
  root.querySelectorAll("span[class*='mtk']").forEach((el) => {
    for (const c of el.classList) if (/^mtk\d+$/.test(c)) found.add(c);
  });
  return found.size;
}

async function compare(
  host: HTMLElement,
  label: string,
  original: string,
  modified: string,
  sample: (phase: string) => Promise<void>,
): Promise<Json> {
  const diff = monaco.editor.createDiffEditor(host, {
    readOnly: true,
    originalEditable: false,
    automaticLayout: true,
  });
  const a = monaco.editor.createModel(original, "aoe2-rms");
  const b = monaco.editor.createModel(modified, "aoe2-rms");
  const stop = watchMainThread();
  const start = performance.now();
  const updated = new Promise<void>((resolve) => {
    const sub = diff.onDidUpdateDiff(() => {
      sub.dispose();
      resolve();
    });
  });
  diff.setModel({ original: a, modified: b });
  const timedOut = await Promise.race([
    updated.then(() => false),
    sleep(15000).then(() => true),
  ]);
  const diffMs = +(performance.now() - start).toFixed(1);
  const worstGapMs = stop();
  const changes = diff.getLineChanges() ?? [];
  // Not in 0.53's public typings, read if the object still has it.
  const result = (
    diff as unknown as {
      getDiffComputationResult?: () => {
        quitEarly?: boolean;
        identical?: boolean;
      } | null;
    }
  ).getDiffComputationResult?.();
  await sleep(500);
  const out: Json = {
    label,
    originalLines: a.getLineCount(),
    modifiedLines: b.getLineCount(),
    timedOut,
    diffMs,
    worstMainThreadGapMs: worstGapMs,
    lineChanges: changes.length,
    quitEarly: result?.quitEarly ?? null,
    identical: result?.identical ?? null,
    sideBySide: !!host.querySelector(".monaco-diff-editor.side-by-side"),
    tokenClassesShown: tokenClasses(host),
    insertedLinesDrawn: host.querySelectorAll(".line-insert").length,
    deletedLinesDrawn: host.querySelectorAll(".line-delete").length,
  };
  for (const [name, tokens] of [
    ["light", DEFAULT_LIGHT_THEME],
    ["dark", DEFAULT_DARK_THEME],
  ] as const) {
    defineAoe2RmsMonacoTheme(monaco, tokens);
    await sleep(300);
    const bg = host.querySelector(".monaco-editor .monaco-editor-background");
    const insert = host.querySelector(".line-insert, .char-insert");
    out[name] = {
      at: new Date().toISOString(),
      editorBackground: bg ? getComputedStyle(bg).backgroundColor : null,
      insertBackground: insert
        ? getComputedStyle(insert).backgroundColor
        : null,
      tokenClassesShown: tokenClasses(host),
    };
    // Held on screen so a desktop capture taken outside the app can show it.
    await sleep(6000);
    await sample(`${label} ${name}`);
  }
  diff.dispose();
  a.dispose();
  b.dispose();
  return out;
}

export async function runH3(
  sample: (phase: string) => Promise<void>,
): Promise<Json> {
  const results: Json = {};
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:#fff";
  document.body.appendChild(host);
  try {
    const vanguard = await fsp.readTextFile(`${MAPS}/AK_Vanguard_v1.2.rms`);
    const menindeeOld = await fsp.readTextFile(`${MAPS}/Menindee_AUS_v2.3.rms`);
    const menindeeNew = await fsp.readTextFile(
      `${DE_MAPS}/AD3_Menindee_v2.5.rms`,
    );
    results.windowSize = [window.innerWidth, window.innerHeight];
    results.small = await compare(
      host,
      "Vanguard, three one-number edits",
      vanguard,
      smallEdits(vanguard),
      sample,
    );
    results.versions = await compare(
      host,
      "Menindee v2.3 to v2.5",
      menindeeOld,
      menindeeNew,
      sample,
    );
    // Monaco falls back to one inline column below 900 px. Maximised, the
    // same comparison shows whether side by side appears.
    await getCurrentWindow().maximize();
    await sleep(1500);
    results.maximisedSize = [window.innerWidth, window.innerHeight];
    results.versionsMaximised = await compare(
      host,
      "Menindee v2.3 to v2.5, maximised",
      menindeeOld,
      menindeeNew,
      sample,
    );
  } catch (e) {
    results.error = String(e);
    results.stack = e instanceof Error ? e.stack : undefined;
  } finally {
    host.remove();
  }
  return results;
}
