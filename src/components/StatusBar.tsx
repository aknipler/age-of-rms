import { HelpTip } from "./HelpTip";
import type { Diagnostic } from "../parser/types";
import type { ResourceAmounts, ResourceRange } from "../parser/resourceTotals";
import styles from "./StatusBar.module.css";

interface StatusBarProps {
  /** Live parser diagnostics from the Code tab (Phase 2.4). Empty when
   * no file is open yet, or before the first parse has come back. */
  diagnostics?: Diagnostic[];
  /** Live resource totals from the Code tab (Phase 2.5). Zeroed ranges
   * when no file is open yet, or before the first parse has come back. */
  total?: ResourceRange;
  player?: ResourceRange;
  neutral?: ResourceRange;
  onOpenGenerationSettings?: () => void;
}

const ZERO_RANGE: ResourceRange = {
  min: { food: 0, wood: 0, gold: 0, stone: 0 },
  max: { food: 0, wood: 0, gold: 0, stone: 0 },
};

// k-abbreviated per Ash's locked 2.5 format decision: whole numbers under
// 1000 shown as-is, 1000+ divided by 1000 with at most one decimal place
// ("1.8k", "60k") — matches the mockup's "F: 1.8k W: 2.7k G: 5k" style.
function formatK(n: number): string {
  const rounded = Math.round(n);
  if (Math.abs(rounded) < 1000) return String(rounded);
  const k = rounded / 1000;
  const fixed = k.toFixed(1);
  return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}k`;
}

// Range display per Ash's locked 2.5 decision ("keep track of options and
// do a range, e.g. 10k-15k"): a hyphenated min-max span when if/random
// blocks make the count generation-dependent, collapsing to a single
// number when min === max (a script with no conditional placement, or a
// resource no branch touches differently).
function formatRange(min: number, max: number): string {
  return min === max ? formatK(min) : `${formatK(min)}-${formatK(max)}`;
}

function formatBucket(range: ResourceRange, labels: Record<keyof ResourceAmounts, string>): string {
  const keys: (keyof ResourceAmounts)[] = ["food", "wood", "gold", "stone"];
  return keys.map((key) => `${labels[key]}: ${formatRange(range.min[key], range.max[key])}`).join(" ");
}

// Resource totals (Phase 2.5): walks the AST for create_object of
// resource objects (src/parser/resourceTotals.ts), computed in the
// parser worker and lifted here from App via useRmsDiagnostics. Problems
// (Phase 2.4) is likewise real: the live count from the parser worker
// wired up in CodePane.
export function StatusBar({
  diagnostics = [],
  total = ZERO_RANGE,
  player = ZERO_RANGE,
  neutral = ZERO_RANGE,
  onOpenGenerationSettings,
}: StatusBarProps) {
  return (
    <div className={styles.statusBar}>
      <HelpTip id="statusBar.total">
        <span>(Total) {formatBucket(total, { food: "Food", wood: "Wood", gold: "Gold", stone: "Stone" })}</span>
      </HelpTip>
      <HelpTip id="statusBar.player">
        <span>(Player) {formatBucket(player, { food: "F", wood: "W", gold: "G", stone: "S" })}</span>
      </HelpTip>
      <HelpTip id="statusBar.neutral">
        <span>(Neutral) {formatBucket(neutral, { food: "F", wood: "W", gold: "G", stone: "S" })}</span>
      </HelpTip>
      <HelpTip id="statusBar.problems">
        <span>{formatProblems(diagnostics)}</span>
      </HelpTip>
      {/* .cogSlot (not .settingsCog) carries margin-left: auto — see its
          CSS comment: HelpTip's own wrapper span is the actual flex item
          here once help mode is on, so a margin set on the button itself
          only pushes it right when help mode is off (HelpTip renders no
          wrapper then, so the button WAS the flex item). */}
      <span className={styles.cogSlot}>
        <HelpTip id="statusBar.generationSettings">
          <button
            type="button"
            className={styles.settingsCog}
            onClick={onOpenGenerationSettings}
            aria-label="Generation settings"
          >
            ⚙
          </button>
        </HelpTip>
      </span>
    </div>
  );
}

function formatProblems(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return "Problems: none";

  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors++;
    else if (diagnostic.severity === "warning") warnings++;
    else infos++;
  }

  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (infos > 0) parts.push(`${infos} info`);
  return `Problems: ${parts.join(", ")}`;
}
