"""
Turn a scenario DE generated from a probe script into a record for the preview's
DE gate fixture, so the gate can grow without the study that made the first maps.

The fixture is src/preview/__tests__/fixtures/de-elevation-cliff-maps.json, which
deElevationCliffMaps.test.ts reads. Each record holds the probe script, the seed,
the lobby, and DE's own saved map: every tile's elevation, terrain and layer and
every cliff object. The gate then runs the script through generatePreview at that
seed and lobby and expects the same map back.

SETUP
    pip install -r requirements.txt

USE
    python export_de_fixture.py check <scenario>
        Prints what the scenario says about its lobby, and refuses a map whose
        saved alliances no lobby can produce (see THE ALLIANCE TRAP).

    python export_de_fixture.py add <scenario> --script <probe.rms> --seed <n>
                                   [--no-team-positions] [--name <name>]
                                   [--fixture <path>] [--force]
        Reads the scenario and adds its record to the fixture, replacing a
        record of the same name. The script and the seed are not stored in a
        scenario, so they have to be given. Players and teams are read from it.

WHAT A MAP NEEDS TO BE USEFUL HERE
    The gate compares the FINISHED map, so a probe script may only use the
    stages the preview reproduces exactly: <PLAYER_SETUP>, <LAND_GENERATION>,
    <ELEVATION_GENERATION> and <CLIFF_GENERATION>. A <TERRAIN_GENERATION>,
    <CONNECTION_GENERATION> or <OBJECTS_GENERATION> section changes the map in
    ways the preview only approximates, and `add` refuses such a script unless
    --force is given. Use a base terrain with no decorations (DESERT) unless the
    decoration draws are the point of the probe.

THE EDITOR WORKFLOW
    In DE's scenario editor: Map > Random Map location > the probe script,
    tick Seed Map and type the seed, set the players, then Generate Map and
    Save As. Name the file after the script and the seed so the pair is not
    lost, for example RMSTEST_<script>_<seed>_n2. Team Positions is the editor's
    own checkbox. Pass --no-team-positions when it was unticked.

THE ALLIANCE TRAP
    The editor builds teams from the scenario's alliance table across all 8
    slots, unused slots included, and a lobby never does. A scenario saved after
    an earlier setup can still ally a player in the game with an unused slot,
    and DE then seats the players differently from any real lobby. Before
    generating, set every unused slot to ally nobody. `check` and `add` refuse a
    map with such an alliance, and also one whose alliances are not whole teams
    (1-2 and 2-3 without 1-3), which no lobby can produce either.

WINDOWS GOTCHA
    AoE2ScenarioParser prints emoji progress markers, which a cp1252 console
    cannot encode. This script forces UTF-8 on stdout at import time, as
    probe_scenario.py does.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = REPO_ROOT / "src" / "preview" / "__tests__" / "fixtures" / "de-elevation-cliff-maps.json"

# Each cliff style is nine consecutive object ids from its base, by cliff_type
# 0 to 5 (preview-design Sec.6.3 rule 7, cliffs.ts STYLE_BASE).
CLIFF_STYLE_BASES = (264, 1849, 1858, 2178, 2069, 2651)
CLIFF_IDS = {base + k for base in CLIFF_STYLE_BASES for k in range(9)}
NO_LAYER = -1
APPROXIMATE_SECTIONS = ("TERRAIN_GENERATION", "CONNECTION_GENERATION", "OBJECTS_GENERATION")
# DE's diplomacy stance for an ally.
ALLY = 0


def rle(values: list[int]) -> str:
    """Row-major runs as space-separated "value*count" tokens, the fixture's grid encoding."""
    out, i = [], 0
    while i < len(values):
        j = i
        while j < len(values) and values[j] == values[i]:
            j += 1
        out.append(f"{values[i]}*{j - i}")
        i = j
    return " ".join(out)


def load(path: Path):
    from AoE2ScenarioParser.scenarios.aoe2_de_scenario import AoE2DEScenario

    return AoE2DEScenario.from_file(str(path))


def lobby_teams(scenario) -> tuple[int, list[int], list[str]]:
    """The player count, the preview's 8-entry team list (0 = no team), and
    every reason no lobby could produce these alliances."""
    pm = scenario.player_manager
    players = int(pm.active_players)
    problems: list[str] = []

    def stance(i: int, j: int) -> int:
        return list(pm.players[i].diplomacy)[j - 1]

    for i in range(1, players + 1):
        for j in range(players + 1, 9):
            if stance(i, j) == ALLY:
                problems.append(f"player {i} is allied with unused slot {j}")

    groups: list[frozenset[int]] = []
    for i in range(1, players + 1):
        group = frozenset(j for j in range(1, players + 1) if j == i or stance(i, j) == ALLY)
        if group not in groups:
            groups.append(group)
    # A lobby team is a clique, each member allied with every other, so every
    # member must see exactly the same group.
    seen: dict[int, frozenset[int]] = {}
    for group in groups:
        for member in group:
            if member in seen and seen[member] != group:
                problems.append(f"the alliances of players {sorted(seen[member])} and {sorted(group)} overlap without being one team")
            seen[member] = group

    teams = [0] * 8
    number = 0
    for group in sorted({g for g in groups if len(g) > 1}, key=min):
        number += 1
        for member in group:
            teams[member - 1] = number
    return players, teams, problems


def sections_of(script: str) -> set[str]:
    text = re.sub(r"/\*.*?\*/", " ", script, flags=re.S)
    return set(re.findall(r"<([A-Z_]+)>", text))


def record(scenario, name: str, script_index: int, seed: int, team_positions: bool) -> dict:
    mm = scenario.map_manager
    size = mm.map_size
    elevation = [0] * (size * size)
    terrain = [0] * (size * size)
    layer = [NO_LAYER] * (size * size)
    for tile in mm.terrain:
        i = tile.y * size + tile.x
        elevation[i] = tile.elevation
        terrain[i] = tile.terrain_id
        layer[i] = NO_LAYER if tile.layer < 0 else tile.layer
    cliffs = sorted(
        [int(u.unit_const), round(float(u.x), 4), round(float(u.y), 4), int(u.initial_animation_frame)]
        for u in scenario.unit_manager.get_all_units()
        if int(u.unit_const) in CLIFF_IDS
    )
    players, teams, _ = lobby_teams(scenario)
    out = {
        "name": name,
        "script": script_index,
        "seed": seed,
        "size": size,
        "players": players,
        "elevation": rle(elevation),
        "terrain": rle(terrain),
        "layer": rle(layer),
        "cliffs": cliffs,
    }
    # Written only when they differ from the gate's defaults, so the first 51
    # records and new ones read the same way.
    if any(teams):
        out["teams"] = teams
    if not team_positions:
        out["teamPositions"] = False
    return out


def cmd_check(args) -> int:
    scenario = load(args.scenario)
    players, teams, problems = lobby_teams(scenario)
    print(f"\n{args.scenario.name}: {scenario.map_manager.map_size} tiles a side, {players} players, teams {teams[:players]}")
    for problem in problems:
        print(f"  NO LOBBY CAN PRODUCE THIS: {problem}")
    return 1 if problems else 0


def cmd_add(args) -> int:
    script = args.script.read_text(encoding="utf-8").replace("\r\n", "\n")
    approximate = sorted(sections_of(script) & set(APPROXIMATE_SECTIONS))
    if approximate and not args.force:
        print(
            f"{args.script.name} has {', '.join(approximate)}, which the preview only approximates, "
            "so the gate would fail on it. Pass --force to add it anyway.",
            file=sys.stderr,
        )
        return 1
    scenario = load(args.scenario)
    _, _, problems = lobby_teams(scenario)
    if problems:
        for problem in problems:
            print(f"NO LOBBY CAN PRODUCE THIS: {problem}", file=sys.stderr)
        print("Fix the alliances in the editor, generate again and save again.", file=sys.stderr)
        return 1

    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    if script not in fixture["scripts"]:
        fixture["scripts"].append(script)
    name = args.name or args.scenario.stem.removeprefix("RMSTEST_")
    entry = record(scenario, name, fixture["scripts"].index(script), args.seed, not args.no_team_positions)
    fixture["maps"] = [m for m in fixture["maps"] if m["name"] != name] + [entry]
    args.fixture.write_text(json.dumps(fixture, indent=1) + "\n", encoding="utf-8", newline="\n")
    print(
        f"\nAdded {name} ({entry['size']} tiles, {entry['players']} players, seed {args.seed}, "
        f"{len(entry['cliffs'])} cliff objects). The fixture now holds {len(fixture['maps'])} maps.\n"
        "Next: run `npx prettier --write` on the fixture, then\n"
        "`npx vitest run src/preview/__tests__/deElevationCliffMaps.test.ts`."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    check = sub.add_parser("check", help="Print the scenario's lobby and refuse alliances no lobby can produce.")
    check.add_argument("scenario", type=Path)
    add = sub.add_parser("add", help="Add the scenario's map to the DE gate fixture.")
    add.add_argument("scenario", type=Path)
    add.add_argument("--script", type=Path, required=True, help="The .rms the map was generated from.")
    add.add_argument("--seed", type=int, required=True, help="The seed typed into the editor.")
    add.add_argument("--no-team-positions", action="store_true", help="The editor's Team Positions box was unticked.")
    add.add_argument("--name", help="Record name. Defaults to the scenario's file name without RMSTEST_.")
    add.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    add.add_argument("--force", action="store_true", help="Add a script with sections the preview only approximates.")
    args = parser.parse_args()
    return cmd_check(args) if args.command == "check" else cmd_add(args)


if __name__ == "__main__":
    sys.exit(main())
