#!/usr/bin/env python3
"""Watch DE's scenario folder and probe every map as it is saved.

Closes the manual half of the measurement loop. Leave this running in a
terminal, then in the editor: pick a script, Generate Map, Save As. The probe
output appears within a second or two, without touching a terminal or the
game process.

    python watch_scenarios.py                 # default DE scenario folder
    python watch_scenarios.py --dir <path>    # explicit folder
    python watch_scenarios.py --once          # probe newest file and exit

WHY POLLING RATHER THAN A FILESYSTEM-EVENT LIBRARY
    A directory scan of a folder holding a handful of files is free, and it
    avoids adding `watchdog` for something a `stat` loop does. Event libraries
    also fire on the *first* write, which here is the worst possible moment —
    see below.

THE FILE-IS-STILL-BEING-WRITTEN PROBLEM
    The game writes a multi-megabyte scenario over a noticeable interval. Probe
    it on the first size change and the parse fails on a truncated file, which
    looks like a format incompatibility and is not. So a file is only probed
    once its size has held steady across consecutive polls (STABLE_POLLS), and
    parse errors during that window are swallowed rather than reported.
"""

from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
POLL_SECONDS = 1.0
STABLE_POLLS = 2  # consecutive identical sizes before a file counts as finished


def default_scenario_dir() -> Path | None:
    """DE keeps scenarios per Steam profile, so the numeric folder varies.

    Pick the profile directory that actually contains a scenario folder rather
    than guessing at the steam id; '0' also exists and is usually empty.
    """
    base = Path(os.path.expanduser("~")) / "Games" / "Age of Empires 2 DE"
    if not base.is_dir():
        return None
    candidates = sorted(base.glob("*/resources/_common/scenario"), key=lambda p: len(str(p)))
    return candidates[-1] if candidates else None


def probe(path: Path) -> None:
    print(f"\n{'=' * 70}\n{time.strftime('%H:%M:%S')}  {path.name}\n{'=' * 70}")
    result = subprocess.run(
        [sys.executable, str(HERE / "probe_scenario.py"), str(path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    # probe_scenario prints the library's parse chatter before the report; only
    # the report is interesting once the loop is running.
    out = result.stdout
    marker = "=== MAP:"
    print(out[out.index(marker):] if marker in out else out)
    if result.returncode != 0:
        print(result.stderr.strip()[-500:], file=sys.stderr)


def watch(folder: Path) -> int:
    print(f"watching {folder}\ngenerate a map in the editor and Save As — Ctrl+C to stop")
    sizes: dict[Path, tuple[int, int]] = {}   # path -> (last size, consecutive stable polls)
    seen: dict[Path, float] = {p: p.stat().st_mtime for p in folder.glob("*.aoe2scenario")}

    while True:
        time.sleep(POLL_SECONDS)
        for path in folder.glob("*.aoe2scenario"):
            try:
                stat = path.stat()
            except OSError:
                continue  # mid-write, mid-rename; try again next poll
            if seen.get(path) == stat.st_mtime:
                continue

            size, stable = sizes.get(path, (-1, 0))
            if stat.st_size == size:
                stable += 1
            else:
                stable = 0
            sizes[path] = (stat.st_size, stable)

            if stable >= STABLE_POLLS:
                seen[path] = stat.st_mtime
                sizes.pop(path, None)
                try:
                    probe(path)
                except Exception as exc:  # noqa: BLE001 — a bad file must not kill the loop
                    print(f"  probe failed: {exc}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", type=Path, default=None, help="Scenario folder (auto-detected if omitted)")
    parser.add_argument("--once", action="store_true", help="Probe the newest scenario and exit")
    args = parser.parse_args()

    folder = args.dir or default_scenario_dir()
    if folder is None or not folder.is_dir():
        print("could not find DE's scenario folder — pass --dir", file=sys.stderr)
        return 1

    if args.once:
        files = sorted(folder.glob("*.aoe2scenario"), key=lambda p: p.stat().st_mtime)
        if not files:
            print(f"no scenarios in {folder}", file=sys.stderr)
            return 1
        probe(files[-1])
        return 0

    try:
        return watch(folder)
    except KeyboardInterrupt:
        print("\nstopped")
        return 0


if __name__ == "__main__":
    sys.exit(main())
