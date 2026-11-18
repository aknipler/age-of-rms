"""The object data DE's object stage reads, from empires2_x2_p1.dat.

`extract_constants.py --object-data` writes reference/data/object-data.json
from here. The preview's object stage (docs/preview-design.md Sec.6.6, rev 12)
reads it, and nothing else does.

Every field is a raw dat field or a rule over a few of them. The preview's
object gate (`src/preview/__tests__/deObjectMaps.test.ts`) holds the stage
built on them to every object of 339 maps DE saved. The rules:

- placement half-size is the dat's `clearance_size`, collision half-size its
  `collision_size_x/y`, vertical extent `collision_size_z`;
- the pathing action is `obstruction_type`, its kind `obstruction_class`;
- a graphic's "random angle" flag is bit 0x02 of `sequence_type` and its
  "random facet" flag bit 0x04;
- an object is available to a civilization when that civilization's unit
  table holds it;
- a restriction accepts terrain t when its multiplier for t is above 0.

The rules the TypeScript side derives from these fields (placement family,
position family, collision and obstruction modes, creation draws) are stated
in `src/preview/generator/deObjectData.ts`, next to the code that applies them.
"""

from __future__ import annotations

import json
import struct
from datetime import date
from pathlib import Path

#: Attribute 82 of a civilization's resources decides whether a TOWN_CENTER
#: is resolved under its replacement rule (preview-design Sec.6.6, rev 12).
TOWN_CENTER_ATTRIBUTE = 82


def f32(value: float) -> float:
    """The value as a 32-bit float would hold it, as a Python float."""
    return struct.unpack("<f", struct.pack("<f", value))[0]


def unit_row(u, civ_count: int, present_in: list[int]) -> dict:
    """One object's row. Defaults are left out to keep the file small."""
    row: dict = {"id": u.id, "cls": u.class_, "type": u.type}
    graphic = u.standing_graphic[0]
    if graphic >= 0:
        row["g"] = graphic
    row["hp"] = u.hit_points
    row["r"] = u.terrain_restriction
    row["c"] = [f32(u.collision_size_x), f32(u.collision_size_y)]
    row["p"] = [f32(u.clearance_size[0]), f32(u.clearance_size[1])]
    row["z"] = f32(u.collision_size_z)
    row["o"] = [f32(u.outline_size_x), f32(u.outline_size_y)]
    if u.speed is not None and u.speed != 0:
        row["spd"] = f32(u.speed)
    if u.can_be_built_on:
        row["cbo"] = 1
    if u.hill_mode:
        row["slope"] = u.hill_mode
    if u.obstruction_type:
        row["act"] = u.obstruction_type
    if u.obstruction_class:
        row["kind"] = u.obstruction_class
    centre = [t for t in u.placement_terrain if t >= 0]
    side = [t for t in u.placement_side_terrain if t >= 0]
    if centre:
        row["ctr"] = centre
    if side:
        row["side"] = side
    slot = u.resource_storages[0]
    if slot.type != -1:
        row["res"] = [slot.type, f32(slot.amount)]
    building = u.building
    if building is not None:
        if building.foundation_terrain_id >= 0:
            row["fnd"] = building.foundation_terrain_id
        annexes = [[a.unit_id, f32(a.misplacement_x), f32(a.misplacement_y)] for a in building.annexes if a.unit_id >= 0]
        if annexes:
            row["ann"] = annexes
    if len(present_in) != civ_count:
        row["civs"] = present_in
    if u.hide_in_editor:
        row["hid"] = 1
    return row


def build_object_data(dat, wall_gates: dict, run_date: str) -> dict:
    """The whole file. `dat` is a parsed genieutils DatFile."""
    civs = dat.civs
    present: dict[int, list[int]] = {}
    for ci, civ in enumerate(civs):
        for u in civ.units:
            if u is not None:
                present.setdefault(u.id, []).append(ci)
    objects = [unit_row(u, len(civs), present[u.id]) for u in civs[0].units if u is not None]

    graphics: dict[str, list[int]] = {}
    for g in dat.graphics:
        if g is None:
            continue
        flags = g.sequence_type & 0x06
        if g.angle_count > 1 or flags:
            graphics[str(g.id)] = [g.angle_count, flags, g.frame_count]

    restrictions = [[f32(v) for v in r.passable_buildable_dmg_multiplier] for r in dat.terrain_restrictions]

    town_centre_attribute = [f32(civ.resources[TOWN_CENTER_ATTRIBUTE]) for civ in civs]

    return {
        "note": (
            f"Object data for the preview's object stage, extracted {run_date} by tools/extract-constants "
            "--object-data from empires2_x2_p1.dat. Each object row: id, cls (class), type (constructor type), "
            "g (standing graphic), hp, r (terrain restriction), c (collision half-size), p (placement half-size), "
            "z (vertical extent), o (outline half-size), spd (speed), cbo (can be built on), slope (hill mode), "
            "act (pathing action), kind (obstruction class), ctr and side (placement terrains), res (first "
            "resource slot), fnd (foundation terrain), ann (annexes: id, x, y), civs (civilizations that have "
            "it, all when absent), hid (hidden in the editor). graphics: id -> [angles, flags (0x02 random angle, "
            "0x04 random facet), frames], for graphics with more than one angle or a flag. restrictions: the "
            "multiplier per terrain, by restriction id. wallGates: the gate per wall object and run direction."
        ),
        "civilizationCount": len(civs),
        "objects": objects,
        "graphics": graphics,
        "restrictions": restrictions,
        "townCentreAttribute": town_centre_attribute,
        "wallGates": wall_gates,
    }


def format_object_data(data: dict) -> str:
    """One line per object, graphic and restriction, so a diff names what changed."""
    lines = ["{"]
    lines.append(f'  "note": {json.dumps(data["note"])},')
    lines.append(f'  "civilizationCount": {data["civilizationCount"]},')
    lines.append('  "objects": [')
    rows = [f"    {json.dumps(r, separators=(',', ':'))}" for r in data["objects"]]
    lines.append(",\n".join(rows))
    lines.append("  ],")
    lines.append('  "graphics": {')
    rows = [f'    "{k}": {json.dumps(v)}' for k, v in data["graphics"].items()]
    lines.append(",\n".join(rows))
    lines.append("  },")
    lines.append('  "restrictions": [')
    rows = [f"    {json.dumps(r, separators=(',', ':'))}" for r in data["restrictions"]]
    lines.append(",\n".join(rows))
    lines.append("  ],")
    lines.append(f'  "townCentreAttribute": {json.dumps(data["townCentreAttribute"])},')
    lines.append(f'  "wallGates": {json.dumps(data["wallGates"], separators=(",", ":"))}')
    lines.append("}")
    return "\n".join(lines) + "\n"


def load_wall_gates(path: Path) -> dict:
    """The gate table beside this file (`wall_gates.json`): wall id -> four [gate, unused] pairs."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {"rows": raw["rows"], "byWallObject": raw["byWallObject"], "default": raw.get("default")}


def run_object_data(dat, output: Path, wall_gates_path: Path, dry_run: bool) -> int:
    """`--object-data`: writes the file."""
    import sys

    if dat is None:
        print("Cannot extract the object data without empires2_x2_p1.dat.", file=sys.stderr)
        return 1
    data = build_object_data(dat, load_wall_gates(wall_gates_path), date.today().isoformat())
    print(f"  objects: {len(data['objects'])}, graphics kept: {len(data['graphics'])}, restrictions: {len(data['restrictions'])}")
    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_object_data(data), encoding="utf-8", newline="\n")
    print(f"\nWrote {output}")
    return 0
