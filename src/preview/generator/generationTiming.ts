import type { InstantiatedCommand } from "./types";

// How long each part of a generation took, for the preview's hourglass. Pure
// and worker-safe like the rest of the generator.
//
// A module-level recorder, not a parameter threaded through every stage.
// The stages share no common loop, and a timer argument on six stage
// functions would touch every caller and test for a diagnostic. This is the
// pattern often called an ambient context. Its usual danger is two runs
// sharing the one recorder at once, which cannot happen here: generatePreview
// is synchronous and runs to the end before anything else on its thread.
// With no recorder installed (every test, every tool), `timeCall` runs its
// function and nothing else.

/** One row under a section: a command, or a named step of the stage. */
export interface TimedCall {
  label: string;
  /** The command's line, 1 based, absent for a step that is not one command. */
  line?: number;
  ms: number;
  /** How many times it ran, more than 1 for a command run once per player. */
  count: number;
}

export interface SectionTiming {
  /** The stage id, S0 to S6, as the snapshots name them. */
  stage: string;
  ms: number;
  /** Slowest first. Time no call accounts for is `ms` minus their sum. */
  calls: TimedCall[];
}

export interface GenerationTiming {
  totalMs: number;
  /** Parsing the script, timed by the worker before generation. 0 when it reused the last parse. */
  parseMs?: number;
  sections: SectionTiming[];
}

interface Recording {
  startedAt: number;
  sectionStart: number;
  sections: SectionTiming[];
  calls: Map<string, TimedCall & { offset?: number }>;
  /** Nesting, so a call inside another call is not counted twice. */
  depth: number;
}

let current: Recording | null = null;

const now = (): number => performance.now();

/** Starts recording. generatePreview calls it first. */
export function startTiming(): void {
  const t = now();
  current = {
    startedAt: t,
    sectionStart: t,
    sections: [],
    calls: new Map(),
    depth: 0,
  };
}

/** Closes the section that ran since the last mark, under `stage`'s name. */
export function markSection(stage: string): void {
  if (current === null) return;
  const t = now();
  current.sections.push({
    stage,
    ms: t - current.sectionStart,
    calls: [...current.calls.values()],
  });
  current.sectionStart = t;
  current.calls = new Map();
}

/**
 * Runs `fn`, adding its time to the current section under `label` (and the
 * command's offset, so two commands with the same text stay apart).
 */
export function timeCall<T>(
  label: string,
  offset: number | undefined,
  fn: () => T,
): T {
  const rec = current;
  if (rec === null || rec.depth > 0) return fn();
  rec.depth++;
  const t = now();
  try {
    return fn();
  } finally {
    rec.depth--;
    const key = `${offset ?? ""}\0${label}`;
    const call = rec.calls.get(key);
    if (call === undefined)
      rec.calls.set(key, { label, offset, ms: now() - t, count: 1 });
    else {
      call.ms += now() - t;
      call.count++;
    }
  }
}

/** `timeCall` for one script command, labelled with its name and first argument. */
export function timeCommand<T>(
  cmd: Pick<InstantiatedCommand, "name" | "span" | "args">,
  fn: () => T,
): T {
  if (current === null) return fn();
  return timeCall(commandLabel(cmd), cmd.span.start, fn);
}

/**
 * "create_object GOLD": the command and its first argument as written, so a
 * constant shows by its name and not its number.
 */
export function commandLabel(
  cmd: Pick<InstantiatedCommand, "name" | "args">,
): string {
  const arg = cmd.args[0];
  if (arg === undefined) return cmd.name;
  const written = arg.source.value;
  const shown =
    typeof written === "string" || typeof written === "number"
      ? written
      : arg.value;
  return shown === undefined ? cmd.name : `${cmd.name} ${String(shown)}`;
}

/**
 * Stops recording and returns what was recorded, the call offsets turned into
 * lines with `lineOf`, each section's calls slowest first. Null when nothing
 * was recording.
 */
export function endTiming(
  lineOf: (offset: number) => number,
): GenerationTiming | null {
  const rec = current;
  current = null;
  if (rec === null) return null;
  return {
    totalMs: now() - rec.startedAt,
    sections: rec.sections.map((s) => ({
      ...s,
      calls: s.calls
        .map((c) => {
          const { offset, ...rest } = c as TimedCall & { offset?: number };
          return offset === undefined
            ? rest
            : { ...rest, line: lineOf(offset) };
        })
        .sort((a, b) => b.ms - a.ms),
    })),
  };
}
