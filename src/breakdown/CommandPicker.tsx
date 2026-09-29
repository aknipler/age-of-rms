import { useMemo, useState } from "react";
import type { EditIntent, InsertTarget } from "./patch/intents";
import { useBreakdownContext } from "./BreakdownContext";
import { HelpTip } from "../components/HelpTip";
import styles from "./CommandPicker.module.css";

/**
 * What the picker hands back (2026-09-18). A command or directive by name,
 * as before, or one of the two control-flow constructs, which are not
 * CommandDefs and insert a skeleton rather than a bare name
 * (computeEdit.ts's addControlFlow). Every caller turns this into the
 * matching EditIntent with `intentForPick`, so the three Add buttons
 * (section, if branch, random branch) cannot drift apart on what a pick
 * means.
 */
export type PickerChoice =
  | { kind: "command"; name: string }
  | { kind: "controlFlow"; construct: "if" | "random" };

export function intentForPick(
  choice: PickerChoice,
  at: InsertTarget,
): EditIntent {
  return choice.kind === "command"
    ? { kind: "addCommand", at, name: choice.name }
    : { kind: "addControlFlow", at, construct: choice.construct };
}

/**
 * The control-flow group's rows. Not read from language.json, since `if`
 * and `start_random` are grammar the parser owns (parser-design Sec.5), not
 * vocabulary, and language.json's commands[] has no row for either. The
 * descriptions here are the picker's own copy, matched to the ones on
 * ConditionalCard/RandomCard.
 */
const CONTROL_FLOW: {
  construct: "if" | "random";
  name: string;
  description: string;
}[] = [
  {
    construct: "if",
    name: "if … endif",
    description:
      "Run the commands inside only when a condition holds (a game mode, map size, or your own #define).",
  },
  {
    construct: "random",
    name: "start_random … end_random",
    description:
      "Pick one of several branches by chance, each with its own percent_chance.",
  },
];

interface CommandPickerProps {
  /** The tab's section name (canonical or unknown-section raw name), filters the list by default, per Sec.3.2. */
  defaultSection?: string;
  onPick: (choice: PickerChoice) => void;
  onClose: () => void;
}

// docs/breakdown-design.md Sec.3.2, a searchable list of every command,
// filtered to the active tab's section by default with a "show all
// sections" toggle. This is a pure convenience filter, never a hard
// restriction: cross-section placement draws a diagnostic for two commands and
// nothing for the other 39.
//
// The reason has now changed twice, and the filter has stayed advisory through
// both. RMS0304 shipped 2026-08-10, but it fires only where `sectionLocked` is
// set, two commands, `create_terrain` and `create_object`, the only two the
// engine has been measured on. `CommandDef.section`, which is what this filter
// reads, records where the guide *documents* a command, and 52 of the 53
// corpus hits a `section`-driven check produces are shipped, working maps. So
// the filter is a convenience over documentation and the diagnostic is a claim
// about the engine, and they are deliberately not the same set. Each entry
// shows name + one-line description + a verified/unverified chip.
export function CommandPicker({
  defaultSection,
  onPick,
  onClose,
}: CommandPickerProps) {
  const { lang } = useBreakdownContext();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(!defaultSection);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: { name: string; description?: string }) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.description ?? "").toLowerCase().includes(q);
    const byName = (a: { name: string }, b: { name: string }) =>
      a.name.localeCompare(b.name);
    const commands = lang.data.commands
      .filter((c) => showAll || c.section === defaultSection)
      .filter(matches)
      .sort(byName);
    // Directives are legal in every section, not only the preamble (beta
    // feedback 2026-09-17, "#const/#define should be available everywhere"),
    // so they bypass the section filter and sit after the commands, where a
    // tab's own vocabulary stays first. nonFunctional ones (#undefine,
    // #include, engine ghosts per parser-design Sec.7) are never offered.
    // Sec.3.6 badges them where they already exist, it doesn't hand them out.
    const directives = lang.data.directives
      .filter((d) => !d.nonFunctional)
      .filter(matches)
      .sort(byName);
    return [...commands, ...directives];
  }, [lang, query, showAll, defaultSection]);
  // Control flow is legal in every section, like directives, so it never
  // takes the section filter. It sits first rather than last because there
  // are two rows, they are structurally unlike everything below them, and
  // "put this under a condition" is a question a person asks before they
  // ask which command to add.
  const controlFlow = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONTROL_FLOW.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className={styles.panel} role="dialog" aria-label="Add a command">
      <div className={styles.searchRow}>
        <HelpTip id="breakdown.addCommand.search">
          <input
            type="text"
            autoFocus
            placeholder="Search commands…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            className={styles.search}
          />
        </HelpTip>
        {defaultSection && (
          <HelpTip id="breakdown.addCommand.showAll">
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={showAll}
                onChange={(e) => setShowAll(e.target.checked)}
              />
              show all sections
            </label>
          </HelpTip>
        )}
      </div>
      {/* One HelpTip over the whole list rather than one per entry.
          Matches ReferenceTable.tsx's pattern (a wrap per row here would
          spam a tooltip over every visible result in a scrollable list).
          .listSlot mirrors SectionView.module.css's .addButtonSlot: HelpTip
          always renders its own `display: inline-block` wrapper span now
          (HelpTip.tsx), which isn't a flex participant, so it needs to be
          made one from the outside, see the CSS comment. */}
      <div className={styles.listSlot}>
        <HelpTip id="breakdown.addCommand.entry">
          <div className={styles.list}>
            {results.length === 0 && controlFlow.length === 0 && (
              <p className={styles.empty}>No matching commands.</p>
            )}
            {controlFlow.map((c) => (
              <button
                key={c.construct}
                type="button"
                className={`${styles.entry} ${styles.controlFlowEntry}`}
                onClick={() =>
                  onPick({ kind: "controlFlow", construct: c.construct })
                }
              >
                <span className={styles.entryName}>{c.name}</span>
                <span className={styles.entryDesc}>{c.description}</span>
                {/* No verified chip. These are grammar, not reference
                    data, so there is nothing a chip could be reporting on. */}
                <span className={styles.chip}>control flow</span>
              </button>
            ))}
            {results.map((c) => (
              <button
                key={c.name}
                type="button"
                className={styles.entry}
                onClick={() => onPick({ kind: "command", name: c.name })}
              >
                <span className={styles.entryName}>{c.name}</span>
                <span className={styles.entryDesc}>{c.description ?? ""}</span>
                <span className={styles.chip}>
                  {c.verified ? "verified" : "unverified"}
                </span>
              </button>
            ))}
          </div>
        </HelpTip>
      </div>
    </div>
  );
}
