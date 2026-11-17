"""Writes the preview's DE object gate fixture from the DE study's saved maps.

USAGE
    python export_de_objects.py [--out PATH] [STEM ...]

    With no STEM, every map of the object rounds is taken: the 30 corpus maps
    (`cg-x-*` at seeds 1004 and 1005) and the probe maps of rounds CH to DZ and
    of the object maps of rounds CO and CF. A STEM is a saved map's name
    without `RMSTEST_` and `.aoe2scenario`.

WHAT IT WRITES
    `src/preview/__tests__/fixtures/de-object-maps.json.gz`, read by
    `deObjectMaps.test.ts` (docs/preview-design.md Sec.13, rev 12). Per map:
    its script, seed, size, lobby, each player's civilization, and every object
    in the saved file as one line "type owner x y rotation frame status", x and
    y in 1/256 tile, rotation in 1/10000 radian (or facet), sorted. Child
    objects are not in DE's files, so they are not here either. Gzipped,
    because the 30 corpus maps alone hold about 237,000 objects.

    The map's terrain, elevation and layer come from the whole-script fixture
    (`de-whole-script-maps.json`), which holds most of these maps already. A
    map that fixture lacks gets its own grids here.

    Needs AoE2ScenarioParser 0.9.4 or later (DE's format 1.59).
"""

from __future__ import annotations

import argparse
import gzip
import json
import re
import sys
from pathlib import Path

from export_de_fixture import PROBES, REPO_ROOT, lobby_teams, load, rle, NO_LAYER

SCENARIOS = REPO_ROOT / "tools" / "scenario-probe" / "de-study" / "scenarios"
FIXTURES = REPO_ROOT / "src" / "preview" / "__tests__" / "fixtures"
DEFAULT_OUT = FIXTURES / "de-object-maps.json.gz"
WHOLE = FIXTURES / "de-whole-script-maps.json"

#: The object rounds, by the first part of a probe's name.
ROUND_PREFIXES = ("cg-x-", "ch-", "ck-", "cl-", "cm-", "cn-", "cp-", "cq-", "cr-", "cs-", "dz-", "ob", "k", "u")
#: Second saves of a corpus map, identical to the first.
SKIP = re.compile(r"venn-regen")
NAME = re.compile(r"RMSTEST_(?P<script>.+)_(?P<seed>\d+)_(?P<lobby>n[0-9][0-9a-z-]*)(?:_size-(?P<size>\d+))?\.aoe2scenario")


def civ_id(civ) -> int | str:
    """The dat's civilization number. Newer parser versions hold a named dataset (BRITONS), older ones the number."""
    if isinstance(civ, int):
        return civ
    from AoE2ScenarioParser.datasets.object_support import CivilizationOld

    name = getattr(civ, "name", str(civ))
    return CivilizationOld[name].value if name in CivilizationOld.__members__ else name


def object_lines(scenario) -> list[str]:
    out = []
    for u in scenario.unit_manager.get_all_units():
        x = int(round(float(u.x) * 256))
        y = int(round(float(u.y) * 256))
        rot = int(round(float(u.rotation) * 10000))
        out.append(f"{int(u.unit_const)} {int(u.player)} {x} {y} {rot} {int(u.initial_animation_frame)} {int(u.status)}")
    out.sort()
    return out


def grids(scenario) -> dict:
    mm = scenario.map_manager
    size = mm.map_size
    elevation, terrain, layer = [0] * (size * size), [0] * (size * size), [NO_LAYER] * (size * size)
    for tile in mm.terrain:
        i = tile.y * size + tile.x
        elevation[i], terrain[i] = tile.elevation, tile.terrain_id
        layer[i] = NO_LAYER if tile.layer < 0 else tile.layer
    return {"elevation": rle(elevation), "terrain": rle(terrain), "layer": rle(layer)}


def wanted(stem_script: str) -> bool:
    return stem_script.startswith(ROUND_PREFIXES) and not SKIP.search(stem_script)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("stems", nargs="*")
    args = parser.parse_args()

    whole = {m["name"]: m for m in json.loads(WHOLE.read_text(encoding="utf-8"))["maps"]}
    if args.stems:
        files = [SCENARIOS / f"RMSTEST_{s}.aoe2scenario" for s in args.stems]
    else:
        files = sorted(p for p in SCENARIOS.glob("RMSTEST_*.aoe2scenario") if (m := NAME.fullmatch(p.name)) and wanted(m["script"]))

    maps = []
    for path in files:
        m = NAME.fullmatch(path.name)
        if m is None:
            print(f"skipped (name): {path.name}", file=sys.stderr)
            continue
        script = m["script"] + ".rms"
        if not (PROBES / script).exists():
            print(f"skipped (no probe {script}): {path.name}", file=sys.stderr)
            continue
        scenario = load(path)
        players, teams, problems = lobby_teams(scenario)
        if problems:
            print(f"skipped (alliances {problems}): {path.name}", file=sys.stderr)
            continue
        name = path.name[len("RMSTEST_") : -len(".aoe2scenario")]
        pm = scenario.player_manager
        rec = {
            "name": name,
            "script": script,
            "seed": int(m["seed"]),
            "size": scenario.map_manager.map_size,
            "players": players,
            "civs": [civ_id(pm.players[i].civilization) for i in range(1, players + 1)],
        }
        if any(teams):
            rec["teams"] = teams
        w = whole.get(name)
        if w is not None and w.get("lobbySize"):
            rec["lobbySize"] = w["lobbySize"]
        if w is None:
            rec.update(grids(scenario))
        rec["objects"] = object_lines(scenario)
        maps.append(rec)
        print(f"{name}: {len(rec['objects'])} objects", flush=True)

    note = (
        "Every object of the DE study's saved maps for the object rounds, written by "
        "tools/scenario-probe/export_de_objects.py. Read by deObjectMaps.test.ts. One object per line: "
        "type owner x y rotation frame status, x and y in 1/256 tile, rotation in 1/10000."
    )
    payload = json.dumps({"note": note, "maps": maps}, separators=(",", ":")).encode("utf-8")
    with open(args.out, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        gz.write(payload)
    print(f"Wrote {args.out} ({len(maps)} maps)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
