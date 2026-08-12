#!/usr/bin/env python3
"""Regenerate reference/data/game-constants.json from a local
AoE2:DE install. Dev-side tool only; never invoked by the shipped app (see
tools/extract-constants/README.md for the "why Python here" and licensing
rationale, and PLAN.md's "Reference DB approach").

Two independent data sources, both read from the MAINTAINER'S OWN local
install — nothing of Microsoft's data is redistributed, only the derived
shallow facts this script writes out:

1. resources/_common/.../random_map.def — a plain-text file (ordinary RMS
   `#const NAME <int>` syntax) DE auto-includes in every random map script.
   This is the RMS-constant-name -> internal numeric ID mapping. No binary
   parsing needed for this half at all.
2. empires2_x2_p1.dat — the compiled game-data file. Parsed with
   genieutils-py (LGPL-3.0, SiegeEngineers) to pull, for each ID resolved
   in step 1: terrain -> texture filename, object -> resource yield.

Usage:
    python extract_constants.py --install-path "C:\\...\\AoE2DE"
    python extract_constants.py   # tries common Steam install paths first

Output overwrites reference/data/game-constants.json in place, preserving
every existing entry's rmsConstant/category/notes and only filling in
constId/deTextureFile/resourceAmounts for names it can resolve. Entries it
can't resolve (name not found in random_map.def) are left untouched.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = REPO_ROOT / "reference" / "data" / "game-constants.json"

# AoE2/genie-engine resource-type indices, as stored in a Unit's
# resource_storages[].type. Stable across the whole genie-family modding
# ecosystem (genieutils, aoe2techtree, etc.) but not something we can read
# out of the dat file itself as a label — it's a fixed convention, not
# data. main() prints a sanity-check for a few well-known objects (GOLD
# should show gold, STONE should show stone, ...) after every run; if
# that ever looks wrong after a DE patch, fix this map, not the rest of
# the script.
# 17 is FISH FOOD and was missing until 2026-08-10, which is why FISH and
# SHORE_FISH carried `verified: false` and a "CONTRADICTION — the dat reports no
# resource storage" note from the first real run onward. The dat reports 200 for
# unit 69 perfectly clearly; this table simply had nowhere to put type 17, so it
# was dropped and the absence read as a contradiction.
#
# Two independent readings agree it is food, on two different numbers. guide:4999
# states "FISH_A: a type of standard fish (225 food)", and the dat's FISH1-FISH5
# (units 455-459) carry type 17 amount 225. The hand-written entries in
# game-constants.json claim 200 food for FISH and SHORE_FISH, and the dat carries
# type 17 amount 200 for units 53 and 69. Sixteen units use the type and every one
# is a fish, a whale, a marlin, a turtle or a fish trap.
RESOURCE_TYPE_INDEX = {0: "food", 1: "wood", 2: "stone", 3: "gold", 17: "food"}

# Slot-0 storage types measured across the roster 2026-08-10, with the counts
# that back each reading. Only the five that are player-gatherable resources are
# in RESOURCE_TYPE_INDEX above; the rest are here because `ATTR_STORAGE_VALUE`
# (effect attribute 21) writes slot 0 whatever it holds, so a consumer asking
# "did that line change a resource" needs to know what else it can be.
#
#     0  food            89 units   BOARX 340, FORAG 125, DEERX 140
#     1  wood            53 units   TREETD 125, BUSH 100
#     2  stone            3 units   STONM 350
#     3  gold             7 units   GOLDM 800
#     4  population     807 units   HOUS 5 (provides), LEGION -1 (consumes)
#     9  unread           6 units   SDOC 600 — docks; not investigated
#    12  decay time     533 units   every *_D dead-unit record, 300
#    14  unread           2 units   INDESTRUCT 1
#    17  fish food       16 units   FISH1-5 225, FISHS 200, WHAL1 200
#    56  unread           2 units   OREMN 400
#   508  unread           1 unit
#   514  unread           2 units
#
# guide:3599 annotates the attribute as "population support, tree wood amount,
# decay time", which is types 4, 1 and 12 — the guide is describing the slot's
# type varying, not three unrelated meanings.
RESOURCE_KEY_ORDER = ["food", "wood", "gold", "stone"]

COMMON_WINDOWS_INSTALL_PATHS = [
    r"C:\Program Files (x86)\Steam\steamapps\common\AoE2DE",
    r"C:\Program Files\Steam\steamapps\common\AoE2DE",
    r"D:\SteamLibrary\steamapps\common\AoE2DE",
    r"D:\Steam\steamapps\common\AoE2DE",
]


# ---------------------------------------------------------------------------
# 1. random_map.def parsing — pure, no genieutils dependency, unit-testable
# ---------------------------------------------------------------------------


def strip_rms_comments(text: str) -> str:
    """Strip /* */ block comments (may span lines, don't nest, per this
    project's own parser-design.md) and // line comments."""
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.DOTALL)
    text = re.sub(r"//[^\n]*", "", text)
    return text


CONST_RE = re.compile(r"#const\s+([A-Za-z_][A-Za-z0-9_]*)\s+(-?\d+)\b")


def parse_random_map_def(text: str) -> dict[str, int]:
    """Extract NAME -> id from random_map.def's `#const NAME <int>` lines.

    Only bare-integer values are captured (that's all a definitions file
    should ever contain — user scripts also use `#const` for expressions
    like `rnd(20,40)`, which aren't ID definitions and are correctly
    ignored here since they don't match CONST_RE's \\d+ value group).
    Later definitions win on duplicate names, matching how #const
    redefinition behaves in the RMS engine itself.
    """
    clean = strip_rms_comments(text)
    result: dict[str, int] = {}
    for name, value in CONST_RE.findall(clean):
        result[name] = int(value)
    return result


# --- The namespace split (preview-design Sec.15 item 23) -------------------
#
# `parse_random_map_def` above flattens the whole file into one name -> id
# dict, which is right for what it does (looking up an id for a name we
# already know is a terrain or an object) and WRONG for going the other way.
# The file's ids are per namespace and collide freely: 45 is `DOCK` and also
# `CUSTOM`, `CIVILIZATION_GEORGIANS` and `ATTR_BLAST_DEFENSE`; 61 is a dolphin
# and also `DLC_JUNGLEROAD` and `ATTR_CHARGE_EVENT`. Joined flat against the
# dat's unit roster, 1083 of 1114 constants "resolve" to a unit slot, and most
# of those resolutions are meaningless — an extraction built on that would
# confidently give civilizations a terrain habitat.
#
# The split is in the file itself, in the `/* SECTION */` comments that
# `strip_rms_comments` throws away. Measured on the current DE build: 21
# headers, and the object sections hold 651 names against 1114 flat.

SECTION_HEADER_RE = re.compile(r"/\*\s*([^*/][^*]*?)\s*\*/")

#: Sections whose `#const`s name a placeable object. `OBJECT TYPES` is a
#: heading over GAIA/UNITS/BUILDINGS rather than a section with members of its
#: own; `EXPORTED FROM THE DATABASE` is the long tail (588 live names).
OBJECT_SECTIONS = frozenset({"OBJECT TYPES", "GAIA", "UNITS", "BUILDINGS", "EXPORTED FROM THE DATABASE"})


def parse_random_map_def_sections(text: str) -> dict[str, list[tuple[str, int]]]:
    """Section title -> [(name, id)], in file order, for LIVE `#const`s only.

    Deliberately line-based rather than built on `strip_rms_comments`: the
    section headers ARE comments, so stripping first destroys the only
    structure this function exists to read.

    Two traps, both hit while writing this and both worth the guard:

    1. **A commented-out `#const` looks exactly like a section header.** The
       file carries 35 of them (`/* #const ARCHER    4 */`) — names moved into
       the exported block and left behind as documentation. Treating those as
       headers shattered `EXPORTED FROM THE DATABASE` into 40 one-line
       "sections" and cut the object namespace from 651 names to 69, which is
       a failure quiet enough to ship: every name it kept was correct.
    2. **Titles are decorated with dashed rules** (`/*-----*/` above and below
       the text). Those carry no title and must not reset the section.
    """
    sections: dict[str, list[tuple[str, int]]] = {}
    current = "(preamble)"
    for line in text.splitlines():
        stripped = line.strip()
        header = SECTION_HEADER_RE.fullmatch(stripped)
        if header is not None and "#const" not in stripped:
            title = header.group(1).strip("- ")
            if title:
                current = title
            continue
        if stripped.startswith("/*"):
            continue  # a commented-out #const, kept out of the live set
        match = CONST_RE.search(line)
        if match is not None:
            sections.setdefault(current, []).append((match.group(1), int(match.group(2))))
    return sections


#: The offset between a genie unit CLASS id and the `#const` an RMS author
#: writes for it. Measured, not assumed — see `class_constants`.
CLASS_CONST_BASE = 900


def class_constants(text: str) -> dict[str, int]:
    """The `*_CLASS` names of `random_map.def`: name -> the id an author writes.

    `object_constants` deliberately throws these 24 names away, and its reason
    was right and its conclusion half wrong. They are not unit ids, so joining
    them against the unit roster gave `ARCHERY_CLASS` a terrain habitat off unit
    0 — but they are not junk either. They are genie UNIT CLASS ids offset by
    900, and that offset is the whole reason the engine can tell a class target
    from a unit target in `effect_amount SET_ATTRIBUTE <target> ...`.

    **The offset is measured rather than assumed.** Four names in this file can
    be checked against a unit whose own `class_` field is known, and all four
    agree: BUILDING_CLASS 903 against HOUSE (unit 70, class 3), VILLAGER_CLASS
    904 against VILLAGER (83, class 4), OCEAN_FISH_CLASS 905 against FISH_TUNA
    (457, class 5), SHORE_FISH_CLASS 933 against SHORE_FISH (69, class 33). No
    counter-example exists in the file. `verify_class_offset` re-runs that check
    on every real extraction rather than trusting this paragraph.

    Kept separate from `object_constants` rather than folded into it, because
    the two answer different questions about the same file and a caller that
    conflates them is the bug this docstring exists to prevent.
    """
    sections = parse_random_map_def_sections(text)
    result: dict[str, int] = {}
    for title in OBJECT_SECTIONS:
        for name, value in sections.get(title, []):
            if name.endswith("_CLASS"):
                result[name] = value
    return result


#: The section of `random_map.def` holding `effect_amount`'s third argument.
#: Its own header, not a guess: `parse_random_map_def_sections` returns 152
#: names under this title on the current DE build.
ATTRIBUTE_SECTION = "Attribute Constants"

#: Attribute name -> the resource-storage SLOT it writes.
#:
#: The app must not hardcode RMS vocabulary (CLAUDE.md), so it cannot ask for
#: "ATTR_STORAGE_VALUE" by name — it asks the data which attribute writes a
#: storage slot, and this is where that claim is made and sourced. The genie
#: effect-attribute list puts 21 at "amount of the FIRST resource storage", and
#: guide:3599 annotates it "population support, tree wood amount, decay time",
#: which are three different slot-0 TYPES rather than three attributes.
#:
#: Only the one is listed because only the one is established. Attributes 22+
#: address later slots in some genie builds and nothing here has measured that.
ATTRIBUTE_STORAGE_SLOTS = {"ATTR_STORAGE_VALUE": 0}


def attribute_constants(text: str) -> dict[str, int]:
    """`ATTR_*` name -> id, from `random_map.def`'s own Attribute Constants
    section.

    A FOURTH namespace, and it collides with the other three exactly the way
    they collide with each other — `ATTR_BLAST_DEFENSE` is 45 and so is `DOCK`.
    Reading it from the section rather than by name prefix is what keeps that
    straight, the same argument `object_constants` makes.

    These are `effect_amount`'s attribute selector, and the one that matters
    today is `ATTR_STORAGE_VALUE` (21), which `resourceTotals.ts` needs in order
    to tell "this line changes what an object yields" from the 151 corpus uses
    of `ATTR_TERRAIN_ID` and the 86 of `ATTR_HITPOINTS`. Extracting all 152
    rather than the one keeps that check data-driven, and `ATTR_TERRAIN_ID` is
    already known to have a second consumer waiting (preview-design records
    scripts mutating the terrain table at run time, which no static extraction
    can otherwise see).
    """
    sections = parse_random_map_def_sections(text)
    return {name: value for name, value in sections.get(ATTRIBUTE_SECTION, [])}


def build_attribute_entries(attributes: dict[str, int], run_date: str) -> list[dict]:
    """One `category: attribute` row per name, id order then name order.

    `descriptiveName` is the name un-shouted rather than an explanation of what
    the attribute does: the dat carries no text for these, and writing "the
    amount held in the unit's first resource slot" for 152 of them would be 152
    claims nobody checked. The one that has a documented meaning carries it in
    `notes` instead, sourced.
    """
    entries: list[dict] = []
    for name, value in sorted(attributes.items(), key=lambda kv: (kv[1], kv[0])):
        words = name[len("ATTR_") :].replace("_", " ").title() if name.startswith("ATTR_") else name
        entries.append(
            {
                "constId": value,
                "idSource": "extracted",
                "rmsConstant": name,
                "descriptiveName": words,
                "category": "attribute",
                **({"writesStorageSlot": ATTRIBUTE_STORAGE_SLOTS[name]} if name in ATTRIBUTE_STORAGE_SLOTS else {}),
                "verified": True,
                "notes": (
                    f"effect_amount attribute selector, read from random_map.def's "
                    f"'{ATTRIBUTE_SECTION}' section {run_date} by tools/extract-constants --attributes. "
                    "Ids are per-namespace and collide with the terrain, object and class spaces."
                ),
            }
        )
    return entries


def verify_class_offset(
    named_classes: dict[str, int],
    classes: dict[int, list[int]],
    objects: dict[str, int],
    class_of_unit,
) -> tuple[list[str], list[str], list[str]]:
    """Check `CLASS_CONST_BASE` against the data. Returns (confirmed,
    coincidental, contradicted).

    **Name-stem cross-check, the strong one.** `SHORE_FISH_CLASS` has
    `SHORE_FISH` sitting in the same file as an object constant, so the class id
    derived from the constant (933 - 900 = 33) can be compared against the class
    the UNIT actually carries (unit 69, `class_` 33). Two independent readings of
    one fact, one from `random_map.def` and one from the dat, with nothing
    hardcoded — the link is the shared name stem.

    **A shared stem can still be a coincidence, and the first real run found
    one.** `MONASTERY_CLASS` is 918, so it derives class 18 — which holds MONKX,
    HFRIAR and PRIEST, the monk class. The object constant `MONASTERY` is unit
    104, the BUILDING, class 3. Both readings are correct and they are about
    different things; the stem is the only thing they share. Seven other stems
    agree, so treating this as a failed check would have blocked the extraction
    over a pun.

    **What separates the two, and it is measurable rather than a judgement call.**
    A wrong offset is a CONSTANT shift: every derived id moves by the same
    amount, so every stem check fails at once and most derived ids land on class
    numbers no unit is in. A name coincidence is one row while its neighbours
    agree. So a coincidence is reported and tolerated, a derived id that matches
    no class at all is fatal, and zero confirmations out of a non-empty stem set
    is fatal too — that last one is what a shifted offset actually looks like.
    """
    confirmed: list[str] = []
    coincidental: list[str] = []
    contradicted: list[str] = []
    for name, declared in sorted(named_classes.items()):
        derived = declared - CLASS_CONST_BASE
        stem = name[: -len("_CLASS")]
        unit_id = objects.get(stem)
        actual = class_of_unit(unit_id) if unit_id is not None else None
        if actual is not None and actual == derived:
            confirmed.append(f"{name} {declared} -> class {derived}, and {stem} (unit {unit_id}) carries class {actual}")
        elif derived not in classes:
            contradicted.append(f"{name} {declared} -> class {derived}, which no unit is in")
        elif actual is not None:
            coincidental.append(
                f"{name} {declared} -> class {derived} ({len(classes[derived])} units), but the object constant "
                f"{stem} (unit {unit_id}) is class {actual} — same name, different thing"
            )
        else:
            confirmed.append(f"{name} {declared} -> class {derived}, which exists ({len(classes[derived])} units)")
    return confirmed, coincidental, contradicted


def class_descriptive_name(rms_constant: str | None, class_id: int) -> str:
    """`descriptiveName` for a class row. The schema requires one and the dat
    has none to give — a class is a field, not a record, so there is no name
    field anywhere to read.

    So it is derived from the RMS constant where one exists (`TREE_CLASS` ->
    `Tree class`) and is otherwise the id stated plainly. Deliberately NOT a
    guess at what the class contains: 33 of the 57 have no constant, and naming
    one "Trees and bushes" from a glance at its members is the kind of
    confident invention this file's other docstrings keep warning about.
    """
    if rms_constant is None:
        return f"Unit class {class_id}"
    words = rms_constant[: -len("_CLASS")].replace("_", " ").title()
    return f"{words} class"


def build_class_entries(
    classes: dict[int, list[int]],
    named_classes: dict[str, int],
    run_date: str,
) -> list[dict]:
    """One `category: objectClass` row per class the roster contains.

    **Why these are rows in `constants` rather than a new top-level array.** A
    class IS an RMS constant — `TREE_CLASS` is defined in `random_map.def` like
    any other — so it belongs in the same array under the same shape, and every
    consumer that resolves a written name against `constants` picks it up for
    free. The 33 classes with no constant carry `rmsConstant: null`, which is
    the shape the 53 unnamed terrains already established. A separate array
    would have meant a second schema, a second resolver and a second thing to
    keep in sync, for data of exactly the same kind.

    `memberIds` is the payload and it is the whole roster, not the 33 objects
    `game-constants.json` happens to have rows for. That is deliberate: the
    thing a caller needs to answer is "does the object this script places belong
    to the class this script named", and an object with no row of its own is
    exactly the case that question gets asked about.
    """
    by_id = {declared - CLASS_CONST_BASE: name for name, declared in named_classes.items()}
    entries: list[dict] = []
    for class_id in sorted(classes):
        # **Negative class ids are dropped, and the first run found 116 units in
        # class -1.** A negative class is the dat's "no class", not a class with
        # a negative number, so there is nothing for a constant to name: writing
        # it would mint `constId 899` for a name no author can write and no
        # engine lookup would reach. Reported by the caller rather than silently
        # skipped, since a jump in the count means a DE patch reclassified
        # something.
        if class_id < 0:
            continue
        members = classes[class_id]
        name = by_id.get(class_id)
        entries.append(
            {
                "constId": CLASS_CONST_BASE + class_id,
                "idSource": "extracted",
                "rmsConstant": name,
                "descriptiveName": class_descriptive_name(name, class_id),
                "category": "objectClass",
                "classId": class_id,
                "memberIds": members,
                "verified": True,
                "notes": (
                    f"Genie unit class {class_id}, holding {len(members)} unit ids. "
                    f"constId is classId + {CLASS_CONST_BASE}, the offset an RMS author writes "
                    f"(effect_amount SET_ATTRIBUTE <class> ...); the offset is what lets the engine "
                    f"tell a class target from a unit target, and it is re-verified against "
                    f"random_map.def on every run. Extracted {run_date} by tools/extract-constants."
                ),
            }
        )
    return entries


def object_constants(text: str) -> dict[str, int]:
    """The object namespace of `random_map.def`: name -> unit id.

    Two exclusions inside the object sections, each measured rather than
    assumed:

    - **`STRING_*`** (9 names) are localisation string ids in the 21000s. They
      sit as a contiguous run at the very end of the exported block, so the
      name test and the position test agree; the name test is used because a
      future patch could append after them.
    - **`*_CLASS`** (24 names: `OCEAN_FISH_CLASS`, `WARSHIP_CLASS`, …) are unit
      CLASS ids, which are a third id space and small integers, so they resolve
      to unrelated unit slots. This is the same collision one level down, and
      leaving them in gave `ARCHERY_CLASS` and `CAVALRY_CLASS` a terrain
      habitat off unit 0-ish. If a DE patch adds one, the run prints the list
      so it is visible rather than silent.

    Aliasing is NOT an error and is left alone: 28 ids carry two names each
    (`WALL`/`STONE_WALL`, `FISH_TUNA`/`TUNA`, `SCOUT`/`SCOUT_CAVALRY`). Two
    names for one unit is what the file means, and both should resolve.
    """
    sections = parse_random_map_def_sections(text)
    result: dict[str, int] = {}
    for title in OBJECT_SECTIONS:
        for name, value in sections.get(title, []):
            if name.startswith("STRING_") or name.endswith("_CLASS"):
                continue
            result[name] = value
    return result


# ---------------------------------------------------------------------------
# 2. Locating install files
# ---------------------------------------------------------------------------


def find_file(root: Path, filename: str) -> list[Path]:
    """Recursively search root for filename. Returns all matches — DE
    ships localized duplicates of some files, so callers decide which to
    prefer rather than this function guessing."""
    return sorted(root.rglob(filename))


def guess_install_path() -> Path | None:
    for candidate in COMMON_WINDOWS_INSTALL_PATHS:
        p = Path(candidate)
        if p.is_dir():
            return p
    return None


# ---------------------------------------------------------------------------
# 3. dat file extraction — isolated behind a function so tests that only
#    exercise the def-parser / JSON formatting don't need genieutils
#    installed to import this module.
# ---------------------------------------------------------------------------


@dataclass
class ExtractedTerrain:
    texture_file: str | None


@dataclass
class ExtractedObject:
    resource_amounts: dict[str, float]
    #: Slot 0 first, non-empty slots only, raw `(type, amount)` straight off the
    #: dat. The MEASUREMENT that `resource_amounts` is a reading of, kept
    #: because `ATTR_STORAGE_VALUE` (effect attribute 21) writes slot 0
    #: whatever it holds — so a consumer has to know the slot's TYPE, and
    #: `resource_amounts` has already thrown it away by keying on our own
    #: four-resource vocabulary.
    storages: list[tuple[int, float]] = field(default_factory=list)


@dataclass
class ExtractedPlacement:
    """The engine's own terrain table for one object (Sec.15 item 23).

    `restriction_id` indexes `DatFile.terrain_restrictions`; `allowed_terrains`
    is that row expanded to the terrain ids it permits. `side_terrains` is
    `Unit.placement_side_terrain`, a two-slot "must sit BESIDE" requirement
    that is `(-1, -1)` on all but six entries of the whole object namespace.
    """

    restriction_id: int
    allowed_terrains: list[int]
    side_terrains: list[int]


#: Which terrains each coarse habitat class permits, as a predicate over one
#: terrain entry's own flags. These are TRANSCRIBED from `objects.ts`'s
#: `habitatMask` and `grid.ts`'s `terrainDepth`, not paraphrased from the
#: schema's prose, because the whole method below is "which class does the app
#: implement that comes closest to this row" — a paraphrase would be scoring
#: against a class the app does not have. Two transcription details that look
#: like slips and are not:
#:
#: - **`land` is `not isWater`, NOT `depth == LAND`.** `objects.ts` says so in
#:   a comment and gives the reason: the two differ on the three shallows the
#:   water flag calls dry, and whether a land object may stand on those is
#:   unmeasured.
#: - **`water` excludes hybrids even though they carry `isWater`.**
#:   `terrainDepth` tests `isHybrid` FIRST and returns early, so a shallow is
#:   never `DEPTH_WATER` however the water flag reads.
#:
#: `shore` is deliberately absent: its terrain set IS `water`'s, and what
#: separates the two is the side-terrain requirement rather than any terrain.
#: Scoring it here would only produce a tie with `water` on every row.
HABITAT_CLASS_TERRAINS = {
    "any": lambda f: True,
    "land": lambda f: not f.get("isWater"),
    "water": lambda f: bool(f.get("isWater")) and not f.get("isHybrid"),
    "amphibious": lambda f: bool(f.get("isWater") or f.get("isHybrid") or f.get("isBeach")),
}


@dataclass
class HabitatFit:
    """A derived habitat plus how well it actually fits, which is the half a
    bare class name would throw away. `mismatch` is the size of the symmetric
    difference between the engine's row and the class's own terrain set, so 0
    is exact and larger is coarser; `runner_up` is the next-best class, and the
    gap between the two is what makes the answer trustworthy or not."""

    habitat: str
    mismatch: int
    runner_up: str
    runner_up_mismatch: int
    #: True when the row carries a `placement_side_terrain` that the chosen
    #: class has no way to express — see `derive_habitat`'s side-terrain note.
    side_terrain_unmodelled: bool = False


def derive_habitat(allowed: list[int], side_terrains: list[int], terrain_flags: dict[int, dict]) -> HabitatFit | None:
    """Map a measured allowed-terrain set onto the five habitat classes the
    app already consumes, by **choosing the class whose own terrain set is
    closest to the engine's row** — smallest symmetric difference wins.

    **Why classes rather than the raw 131-terrain mask.** The classes were cut
    when no table was available, and the honest expectation was that reading
    the table would retire them. It did not: they have now survived contact
    with it three times — the `shore` pair, the `water`/`amphibious` split
    (2026-08-08), and this derivation. Keeping them costs one mapping function
    and keeps `objects.ts` unchanged; the raw mask stays available in
    `allowed_terrains` for whoever wants to retire them on evidence.

    **Why a distance and not a chain of predicates.** This function first
    shipped as an ordered chain — `any`, then `shore`, then `amphibious` on
    "permits any hybrid", then `water` — and the first real run against the
    install refuted it on the very family item 23 was written about. Restriction
    19 (every ordinary fish) permits 15 terrains: 14 open water plus **26, `Ice,
    Navigable`**, which carries `isHybrid` in our own terrain table. One hybrid
    in the set tripped the `permits_shallow` test and classified all nine fish
    rows as `amphibious`, contradicting the hand assignment made on 2026-08-08
    and undoing that day's whole `water`/`amphibious` split — a fish would have
    been placeable on a shallow again.

    A distance has no such threshold to get wrong, and it separates the two
    cases by a wide margin rather than a hair (measured against this install):

    | row       | objects | permits | best        | gap to runner-up |
    |-----------|---------|---------|-------------|------------------|
    | 19 fish   | 12      | 15      | water 1     | amphibious 18    |
    | 13/3/15   | 21      | 38      | amphibious 5| water 24         |
    | 0         | 72      | 131     | any 0       | land 21          |
    | 7 (land)  | 177     | 116     | land 8      | any 15           |

    The `mismatch` column is the honest part of the answer and is why it is
    returned rather than discarded. The land family fits worst — restriction 8
    (GOLD/STONE/FORAGE) permits 83 of the 110 terrains `land` covers, so 27
    terrains where the engine says no are terrain the preview will still use.
    That is a limit of a five-value vocabulary, not an error in this join, and
    it is `land` by a wide margin regardless (runner-up `any` at 48).

    **Side terrains.** `shore` is `water` plus "must sit beside a beach", so a
    row that fits `water` AND carries a side terrain is `shore` — which is not
    an approximation of the table, it IS the table (restriction 19's
    SHORE_FISH/DLC_BOXTURTLE, the pair the class was cut for). The DOCK family
    (restriction 6) carries the same `(2, 35)` requirement over an
    `amphibious`-shaped row, and no class can say that; rather than silently
    widen it to `shore` or silently drop the requirement, the fit records
    `side_terrain_unmodelled` and the caller prints it. No DOCK is in the
    reference data today, so this reports rather than changes anything.

    Returns None only when there is nothing to measure (an empty row) or when
    the best two classes tie, which is a real answer: a future patch could
    introduce a shape nobody has seen, and picking one of a tie would hide it.
    """
    if not allowed or not terrain_flags:
        return None

    measured = set(allowed) & set(terrain_flags)
    if not measured:
        return None

    scored = sorted(
        (len(measured ^ {t for t, flags in terrain_flags.items() if permits(flags)}), name)
        for name, permits in HABITAT_CLASS_TERRAINS.items()
    )
    (best_distance, best), (runner_distance, runner) = scored[0], scored[1]
    if best_distance == runner_distance:
        return None

    has_side_terrain = any(side >= 0 for side in side_terrains)
    if has_side_terrain and best == "water":
        return HabitatFit("shore", best_distance, runner, runner_distance)
    return HabitatFit(best, best_distance, runner, runner_distance, side_terrain_unmodelled=has_side_terrain)


#: Separates an entry's extraction provenance from its habitat provenance in
#: `notes`. A habitat run must be idempotent — running it twice has to leave the
#: file byte-identical rather than stacking a second clause — and it must not
#: touch what the full run wrote, since the two passes confirm different fields
#: on different days. Splitting on a sentinel gives both.
HABITAT_NOTE_SEPARATOR = " | habitat: "


def habitat_note(existing: str | None, fit: "HabitatFit", placement: "ExtractedPlacement", run_date: str) -> str:
    """The entry's `notes` with its habitat clause replaced (not appended).

    Records the restriction id and the fit, because a habitat with neither is
    an assertion: `land` derived from a row the class misses by 27 terrains and
    `water` derived from a row it misses by 1 are different claims, and the
    file should not read the same for both. Pure, so it is unit-testable
    without an install — same reason as `clean_dat_filename`.
    """
    head = (existing or "").split(HABITAT_NOTE_SEPARATOR)[0].strip()
    detail = (
        f"'{fit.habitat}' derived from terrain restriction {placement.restriction_id} "
        f"({len(placement.allowed_terrains)} terrains permitted; closest of the coarse classes, "
        f"differing on {fit.mismatch}; runner-up {fit.runner_up} at {fit.runner_up_mismatch})"
    )
    if fit.side_terrain_unmodelled:
        detail += f"; NOTE placement_side_terrain {placement.side_terrains} is not expressible as a habitat class"
    return f"{head}{HABITAT_NOTE_SEPARATOR}{detail}. Derived {run_date} by tools/extract-constants --terrain-table."


# ---------------------------------------------------------------------------
# 3b. Terrain colours — TWO of them, from two different sources, because the
#     preview offers two modes and they are answering different questions.
#
# `previewColor` (GAME mode, the default) is the mean colour of the terrain's
# own texture. DE ships them as ordinary .dds files under
# resources/_common/terrain/textures/, named by the Terrain record's `name_2`
# — already this file's `deTextureFile` — so g_sno.dds averages to
# (180,205,219) pale blue-white and g_grs.dds to (129,146,63) olive. One
# number per terrain, from the terrain the script actually places, and it
# distinguishes everything a script can distinguish.
#
# `minimapColor` (MINIMAP mode) is the dat's own `Terrain.colors[0]`, decoded
# through resources/_common/palettes/original.pal. That field holds PALETTE
# INDICES rather than RGB — index 55 is (0,169,0) green, 19 is (48,93,182)
# blue, 137 is (248,201,138) sand — which is what preview-design Sec.12 item 5
# recorded as "sourced but not yet decodable". It is decodable; the palette is
# a plain-text JASC-PAL file of 256 entries.
#
# MEASURED CAVEAT, and it is why the texture is the default rather than this
# (2026-08-05). Across the 131 enabled terrain records `colors[0]` takes
# exactly **12 distinct values**. It is a legacy colour CLASS, not a
# per-terrain colour: SNOW (id 32), Snow Light (73), Snow Deep (74), Snow Soft
# (124) and every grass variant all carry index 55, green. So minimap mode
# genuinely draws snow as grass, and that is the data faithfully reported
# rather than a bug here. It is still worth shipping — the classic flat
# palette reads well at a glance, and it is what the terrain's colour class
# actually is — but it must be labelled, not presented as ground truth.
#
# Both are shallow facts: one averaged RGB triple and one decoded index per
# terrain, derived from the maintainer's own install, in the same class as an
# id or a name. No texture or palette data is redistributed.
# ---------------------------------------------------------------------------

# Nearest-neighbour downsample size. 65k texels is far more than an average
# needs, and it keeps a 2048x2048 sheet under a second.
TEXTURE_SAMPLE = 256
# Texels below this alpha are not part of the tile (see average_texture_color).
TEXTURE_ALPHA_MIN = 128


def average_texture_color(path: Path, sample: int = TEXTURE_SAMPLE, alpha_min: int = TEXTURE_ALPHA_MIN):
    """Mean RGB over the opaque texels of a terrain texture, as [r, g, b].

    Returns None if the file cannot be read, never a guess.

    Two details that are decisions rather than defaults. The resample filter
    is NEAREST, not the usual box/bilinear: these sheets hold diamond tiles on
    a transparent field, and any smoothing filter blends that transparent
    border into the edge texels BEFORE the alpha test can drop them, dragging
    every average toward black by an amount that depends on the tile's shape.
    Nearest sampling picks real texels, so alpha stays 0 or 255 and the test
    means what it says. And the average is unweighted over opaque texels
    rather than alpha-weighted, because a half-transparent texel is a blend
    edge, not a half-strength colour.
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        with Image.open(path) as raw:
            image = raw.convert("RGBA").resize((sample, sample), Image.NEAREST)
    except Exception:  # unreadable, unsupported DDS variant, truncated file
        return None
    # tobytes() rather than getdata(): flat RGBA bytes, four per texel, and it
    # is the one accessor whose spelling has not moved across Pillow versions
    # (getdata() is deprecated in 12, its replacement does not exist in 10).
    data = image.tobytes()
    red = green = blue = count = 0
    for i in range(0, len(data), 4):
        if data[i + 3] < alpha_min:
            continue
        red += data[i]
        green += data[i + 1]
        blue += data[i + 2]
        count += 1
    if count == 0:
        return None
    return [round(red / count), round(green / count), round(blue / count)]


def parse_jasc_palette(text: str) -> list[list[int]]:
    """Parses a JASC-PAL file into a list of [r, g, b].

    The format is four lines of header — the literal "JASC-PAL", a version
    ("0100"), and the entry count — then one "R G B" line per entry. Pure, so
    it is unit-testable without an install.

    Raises ValueError on anything that is not a JASC palette, rather than
    returning a plausible-looking short list: a truncated palette would
    silently turn every high index into a missing colour.
    """
    lines = [line.strip() for line in text.splitlines()]
    if not lines or lines[0] != "JASC-PAL":
        raise ValueError(f"not a JASC-PAL file (first line was {lines[0]!r} )" if lines else "empty palette file")
    try:
        count = int(lines[2])
    except (IndexError, ValueError) as exc:
        raise ValueError("JASC-PAL header has no entry count") from exc
    entries = []
    for line in lines[3:3 + count]:
        parts = line.split()
        if len(parts) < 3:
            raise ValueError(f"malformed palette entry: {line!r}")
        entries.append([int(parts[0]), int(parts[1]), int(parts[2])])
    if len(entries) != count:
        raise ValueError(f"palette declares {count} entries but holds {len(entries)}")
    return entries


class TextureExtraction:
    """Resolves a `deTextureFile` name to an averaged RGB.

    Memoised because the names are NOT unique — DESERT and PALM_DESERT both
    read `g_pal`, FOREST and LEAVES both `g_for` — so without a cache the same
    2048x2048 sheet is averaged twice and the two entries could in principle
    disagree. They must not: identical texture, identical colour.
    """

    def __init__(self, install_path: Path):
        self.by_stem: dict[str, Path] = {}
        root = install_path / "resources" / "_common" / "terrain" / "textures"
        if root.is_dir():
            for path in sorted(root.rglob("*.dds")):
                # First wins, and rglob is sorted, so a run is reproducible
                # even if a future DE ships several resolution folders.
                self.by_stem.setdefault(path.stem.lower(), path)
        self._cache: dict[str, list[int] | None] = {}

    @property
    def available(self) -> bool:
        return bool(self.by_stem)

    def color(self, texture_file: str | None):
        if not texture_file:
            return None
        key = texture_file.lower()
        if key not in self._cache:
            path = self.by_stem.get(key)
            self._cache[key] = average_texture_color(path) if path else None
        return self._cache[key]


# Palette 0 in resources/_common/palettes/palettes.conf — the classic game
# palette Terrain.colors indexes into. The conf file maps many more, but they
# are per-building-set and per-effect recolours; the terrain colour class is
# palette 0.
BASE_PALETTE_RELATIVE = Path("resources") / "_common" / "palettes" / "original.pal"


class MinimapColorExtraction:
    """Decodes `Terrain.colors[0]` through the base palette.

    Needs the parsed dat, so unlike TextureExtraction this cannot run on the
    JSON alone. Both halves degrade independently: a missing palette leaves
    minimapColor absent and previewColor untouched, and vice versa.
    """

    def __init__(self, install_path: Path, dat: "DatExtraction | None"):
        self.palette: list[list[int]] | None = None
        self.dat = dat
        path = install_path / BASE_PALETTE_RELATIVE
        if path.is_file():
            try:
                self.palette = parse_jasc_palette(path.read_text(encoding="utf-8", errors="replace"))
            except (ValueError, OSError):
                self.palette = None

    @property
    def available(self) -> bool:
        return self.palette is not None and self.dat is not None

    def color(self, const_id: int):
        if self.palette is None or self.dat is None:
            return None
        terrains = self.dat.dat.terrain_block.terrains
        if not (0 <= const_id < len(terrains)):
            return None
        colors = getattr(terrains[const_id], "colors", None)
        if not colors:
            return None
        # colors is a 3-tuple. [1] and [2] are the shades AoK dithered the
        # minimap with; [0] is the terrain's colour and the only one a flat
        # fill wants.
        index = colors[0]
        if not (0 <= index < len(self.palette)):
            return None
        return list(self.palette[index])


def clean_dat_filename(raw: str | None) -> str | None:
    """Normalizes a filename field read out of the dat, returning None for
    'no filename here' rather than a string that merely looks like one.

    DE's dat uses the literal 4-character string "None" as the filename of
    unused/placeholder records. It must never reach the JSON: the schema
    types deTextureFile ["string", "null"], so "None" is a perfectly valid
    string and `npm run validate:reference` cannot catch it. The first real
    install run (2026-07-30) wrote deTextureFile: "None" for ICE and LEAVES
    exactly this way. Pure, so it is directly unit-testable."""
    name = (raw or "").strip()
    if not name or name.lower() == "none":
        return None
    return name


def build_unit_lookup(units: list) -> dict[int, object]:
    """units is a Civ's .units: list[Unit | None] (genieutils/civ.py) — a
    sparse, pointer-based array. Unused unit IDs are None slots, not
    missing entries. Skipping them is the
    fix for a real crash a first install run hit: 'NoneType' object has
    no attribute 'id' from the earlier version of this function, which
    read u.id on every slot unconditionally. Pure/testable for the same
    reason as clean_dat_filename."""
    return {u.id: u for u in units if u is not None}


class DatExtraction:
    """Wraps a parsed DatFile with the two lookups this script needs.
    Both are best-effort: an unresolved id yields None (terrain) / no
    entry (object), never a guess. Never crashes on an out-of-range id —
    game data drifts between patches; a missing id degrades to
    "unresolved", matching this project's own 'never silently drop, but
    never fabricate' rule for reference data."""

    def __init__(self, dat_path: Path):
        # Imported lazily so this module is importable (and its pure
        # helpers testable) without genieutils-py installed.
        from genieutils.datfile import DatFile

        self.dat = DatFile.parse(dat_path)
        # Civ 0 is Gaia — the roster that holds map-object records (gold
        # mines, forage bushes, wildlife, ...). Resource yields on these
        # aren't civ-specific, so Gaia's copy is the canonical one.
        self._units_by_id = build_unit_lookup(self.dat.civs[0].units)

    def terrain(self, const_id: int) -> ExtractedTerrain | None:
        """The texture name is the Terrain record's own `name_2` field — NOT a
        join through DatFile.graphics on `t.slp`, which is what this did until
        the first real install run (2026-07-30) exposed it.

        Two independent id spaces were being crossed: a Terrain's `slp` and a
        Graphic's `slp` are unrelated, so the lookup resolved for no terrain at
        all. The 13 land terrains carry slp 15000-15026, absent from the
        graphics table, and silently yielded None. ICE and LEAVES carry slp
        **-1** (they have no SLP of their own), which collided with a graphic
        whose slp is also -1, so those two — and only those two — produced a
        filename, and it was `s_town_center_extra_x1`, a building shadow.

        `name_2` is the real field and agrees with the schema's own documented
        example: it reads `g_grs` for GRASS, `g_wtr` for WATER, `g_sno` for
        SNOW. Note it is not unique — PALM_DESERT and DESERT both read `g_pal`,
        LEAVES and FOREST both `g_for` — so treat it as a texture name, never
        as a key."""
        terrains = self.dat.terrain_block.terrains
        if not (0 <= const_id < len(terrains)):
            return None
        return ExtractedTerrain(texture_file=clean_dat_filename(terrains[const_id].name_2))

    def placement(self, const_id: int) -> ExtractedPlacement | None:
        """The engine's terrain table for one object — Sec.15 item 23's four
        lines, with the bounds checks a shipped tool needs.

        `passable_buildable_dmg_multiplier` is 131 floats per restriction row,
        one per terrain, and `> 0` means permitted. The name is the dat's, not
        ours: the same row does triple duty for pathing, building and damage,
        and only the first reading is used here.
        """
        unit = self._units_by_id.get(const_id)
        if unit is None:
            return None
        restrictions = self.dat.terrain_restrictions
        rid = unit.terrain_restriction
        if not (0 <= rid < len(restrictions)):
            return None
        row = restrictions[rid].passable_buildable_dmg_multiplier
        return ExtractedPlacement(
            restriction_id=rid,
            allowed_terrains=[i for i, v in enumerate(row) if v > 0],
            side_terrains=[int(s) for s in unit.placement_side_terrain],
        )

    def unit_classes(self) -> dict[int, list[int]]:
        """Genie unit class id -> the unit ids in it, ascending.

        One pass over Gaia's roster reading `Unit.class_`, which is the whole
        extraction. There is no class TABLE in the dat to read — a class is not
        a record, it is a field every unit carries — so the mapping only exists
        as a groupby, and that is why nothing could look a class up before this.

        Sparse slots are skipped by `build_unit_lookup`, so an empty slot never
        joins a class. Measured on the current DE build: 2642 live units across
        57 classes.
        """
        classes: dict[int, list[int]] = {}
        for const_id, unit in sorted(self._units_by_id.items()):
            classes.setdefault(unit.class_, []).append(const_id)
        return classes

    def unit_class_of(self, const_id: int) -> int | None:
        """One unit's class, for stamping `classId` onto an object row."""
        unit = self._units_by_id.get(const_id)
        return None if unit is None else int(unit.class_)

    def object(self, const_id: int) -> ExtractedObject | None:
        unit = self._units_by_id.get(const_id)
        if unit is None:
            return None
        amounts: dict[str, float] = {}
        storages: list[tuple[int, float]] = []
        for storage in unit.resource_storages:
            # An empty slot is type -1. Amount 0 is NOT empty — it is a real
            # zero, and `effect_amount ... ATTR_STORAGE_VALUE 0` is exactly how
            # a script turns a resource off, so the slot has to survive into
            # the raw list even though the derived dict drops it.
            if storage.type >= 0:
                storages.append((int(storage.type), float(storage.amount)))
            key = RESOURCE_TYPE_INDEX.get(storage.type)
            if key is None or storage.amount == 0:
                continue
            amounts[key] = amounts.get(key, 0) + storage.amount
        return ExtractedObject(resource_amounts=amounts, storages=storages)


# ---------------------------------------------------------------------------
# 4. Merge extracted data into the existing game-constants.json structure
# ---------------------------------------------------------------------------


# Matches a previewColor sentence this script wrote on an earlier run, so a
# re-run replaces it instead of stacking a second copy onto `notes`. The head
# and tail are fixed text from the template below; everything between them
# (the colour, the filename, the date) is what changes between runs. A tool
# meant to be re-run after every DE patch has to be idempotent, and the first
# version of this was not — two runs, two identical sentences.
_COLOR_NOTE_RE = re.compile(r"\s*Colours: .*?module docstring\)\.")


def color_note(preview_color, minimap_color, texture_file: str | None, run_date: str) -> str:
    parts = []
    if preview_color is not None:
        parts.append(f"previewColor {preview_color} is the mean of the opaque texels of {texture_file}.dds")
    if minimap_color is not None:
        parts.append(f"minimapColor {minimap_color} is Terrain.colors[0] decoded through original.pal")
    return (
        f"Colours: {'; '.join(parts)}, extracted {run_date} by tools/extract-constants "
        "(minimapColor is a 12-value legacy colour class shared across unrelated "
        "terrains, which is why previewColor is the default — see the module docstring)."
    )


def merge_terrain_colors(entry: dict, textures, minimaps, run_date: str) -> dict:
    """Adds/updates `previewColor` and `minimapColor` on a terrain entry,
    touching NOTHING else — not constId, not verified, not the rest of notes.

    This is the `--colors-only` path and it is deliberately separate from
    merge_entry. A full run rewrites every entry's `notes` and recomputes
    `verified`, which is right when the whole file is being re-extracted and
    wrong when two fields are being added: this repo's working tree normally
    carries weeks of uncommitted reference-data edits, and a colour refresh
    must not be able to take any of them with it.

    The two sources fail independently, so a run with no palette still
    refreshes previewColor and leaves any existing minimapColor alone.
    """
    if entry.get("category") != "terrain":
        return entry
    preview_color = textures.color(entry.get("deTextureFile")) if textures else None
    const_id = entry.get("constId")
    minimap_color = minimaps.color(const_id) if minimaps and isinstance(const_id, int) else None
    if preview_color is None and minimap_color is None:
        return entry
    updated = dict(entry)
    if preview_color is not None:
        updated["previewColor"] = preview_color
    if minimap_color is not None:
        updated["minimapColor"] = minimap_color
    # Append rather than replace the whole field: the existing note carries the
    # constId and texture provenance from an earlier run and is still true. Any
    # colour sentence from an earlier run is stripped first, so re-running does
    # not stack duplicates — a tool meant to be re-run after every DE patch has
    # to be idempotent, and the first version of this was not.
    existing_notes = _COLOR_NOTE_RE.sub("", updated.get("notes", "")).strip()
    note = color_note(updated.get("previewColor"), updated.get("minimapColor"), entry.get("deTextureFile"), run_date)
    updated["notes"] = f"{existing_notes} {note}" if existing_notes else note
    return updated


def merge_terrain_table(entry: dict, placement: "ExtractedPlacement", fit: "HabitatFit | None", run_date: str) -> dict:
    """Writes the engine's terrain table for one object onto its entry, plus the
    coarse `habitat` derived from it when a class fits.

    This is the `--terrain-table` path, pure and separate from `merge_entry` for
    exactly the reason `merge_terrain_colors` is: a full run recomputes
    `verified` and rewrites `notes` wholesale, which is right when re-extracting
    everything and wrong when adding fields to a working tree that normally
    carries weeks of uncommitted reference-data edits.

    **The transcription does not depend on the derivation, and the fields are
    written in the order that says so.** A row no class fits — a tie, or a shape
    a future patch introduces — still gets `terrainRestrictionId`,
    `allowedTerrains` and `placementSideTerrain`, because those are what the
    engine says and `habitat` is only our reading of it. Skipping the raw fields
    whenever `fit` is None would drop the measurement precisely where the
    five-value vocabulary is known to be inadequate, which is the case the raw
    fields exist for.

    `notes` is only touched when a habitat is derived: the restriction id in
    that sentence is now also a field, but the fit it records (how far the class
    is from the row, and what the runner-up was) is not, and that is the half
    that says whether the class is trustworthy here.
    """
    updated = dict(entry)
    updated["terrainRestrictionId"] = placement.restriction_id
    updated["allowedTerrains"] = list(placement.allowed_terrains)
    updated["placementSideTerrain"] = list(placement.side_terrains)
    if fit is not None:
        updated["habitat"] = fit.habitat
        updated["notes"] = habitat_note(entry.get("notes"), fit, placement, run_date)
    return updated


def entry_label(entry: dict) -> str:
    """A name for console output. `rmsConstant` is null for the 53 DE terrains
    that have no callable constant, so nothing that prints an entry may reach
    for it directly — an f-string format spec on None raises."""
    return entry.get("rmsConstant") or f"#{entry.get('constId')} {entry.get('descriptiveName', '?')}"


def merge_entry(entry: dict, const_id: int, dat: DatExtraction | None, run_date: str, textures=None, minimaps=None, id_from_def: bool = True) -> dict:
    """Returns a new entry dict with constId (and, where resolvable,
    deTextureFile / resourceAmounts) filled in from real game data.
    Fields this script can't confirm (descriptiveName wording, whether a
    community-only spelling is exactly right) are left as-is — this only
    fills in what it can independently verify."""
    updated = dict(entry)
    updated["constId"] = const_id
    # Provenance for the id, consumed by the parser's RMS0204/RMS0205 message
    # gating (parser-design Sec.6): resolved-ID wording like "32 = SNOW…" is
    # only allowed when the id came from a trusted source, generic wording
    # otherwise. An id looked up in random_map.def, the game's own definitions
    # file, earns "extracted" — including in --ids-only mode, where the id is
    # exactly as trustworthy as in a full run. Absent means unknown
    # provenance; do not backfill it by hand.
    #
    # `id_from_def` is false for the unnamed terrains: random_map.def only
    # lists the 78 that have a constant, so the other 53 arrive here carrying
    # a community-sourced id this run did not confirm. Their textures and
    # colours ARE confirmable from the dat by id, which is the whole reason
    # they take this path at all — but stamping "extracted" on the id would
    # claim a provenance that does not exist.
    if id_from_def:
        updated["idSource"] = "extracted"

    provenance = [
        f"constId {const_id} confirmed via random_map.def"
        if id_from_def
        else f"constId {const_id} NOT re-confirmed (this terrain has no RMS constant, so random_map.def does not list it); community-sourced id carried through"
    ]

    if dat is None:
        # constId is real, but resourceAmounts/deTextureFile are whatever
        # was already there (old hand-written placeholder, or null) —
        # NOT confirmed by this run. Marking verified: true here would be
        # a false claim the schema explicitly warns against ("Treat
        # unverified numeric fields as placeholders, not facts"). Keep
        # the entry's prior verified value and say plainly what's still
        # unconfirmed, instead of overwriting the old placeholder-warning
        # notes with something that reads as fully confirmed.
        provenance.append(
            "resourceAmounts/deTextureFile NOT re-verified this run (empires2_x2_p1.dat wasn't parsed — see script output) "
            f"— prior value carried through unchanged: {entry.get('notes', '')!r}"
        )
        updated["notes"] = f"{'; '.join(provenance)}. Extracted {run_date} by tools/extract-constants (Phase 4.0)."
        return updated

    # Whether THIS run confirmed the entry's category-specific field against
    # the dat. constId alone is not enough — see the verified= assignment
    # below for why this is tracked per field rather than set unconditionally.
    field_confirmed = False

    if entry["category"] == "terrain":
        terrain = dat.terrain(const_id)
        if terrain and terrain.texture_file:
            updated["deTextureFile"] = terrain.texture_file
            provenance.append(f"texture '{terrain.texture_file}' from empires2_x2_p1.dat")
            field_confirmed = True
            # previewColor rides on the texture name, so it can only be
            # attempted once that name is confirmed. A miss is recorded, never
            # guessed at — the renderer has a documented fallback and a wrong
            # colour is worse than no colour.
            color = textures.color(terrain.texture_file) if textures else None
            if color is not None:
                updated["previewColor"] = color
                provenance.append(f"previewColor {color} from the mean opaque texel of {terrain.texture_file}.dds")
            else:
                provenance.append("previewColor NOT resolved (texture file unreadable or Pillow missing)")
            minimap = minimaps.color(const_id) if minimaps else None
            if minimap is not None:
                updated["minimapColor"] = minimap
                provenance.append(f"minimapColor {minimap} from Terrain.colors[0] via original.pal")
            else:
                provenance.append("minimapColor NOT resolved (palette file missing or unparseable)")
        else:
            provenance.append("texture NOT resolved from empires2_x2_p1.dat")
    elif entry["category"] == "object":
        obj = dat.object(const_id)
        if obj and obj.resource_amounts:
            updated["resourceAmounts"] = obj.resource_amounts
            provenance.append("resourceAmounts (base/default, pre-effect) from empires2_x2_p1.dat")
            field_confirmed = True
        elif obj is not None and not entry.get("resourceAmounts"):
            # Found in the dat, carries no resource storage, and claims none.
            # That is a genuine confirmation, not a failure: most objects
            # (WOLF, RELIC, HOUSE, VILLAGER, KING, ...) are not resource nodes.
            provenance.append("confirmed present in empires2_x2_p1.dat with no resource storage (not a resource node)")
            field_confirmed = True
        elif obj is not None:
            # The dat found the unit but reports no resource storage, while the
            # entry already claims an amount. Those disagree, so nothing here is
            # confirmed — carry the prior value untouched and say so. Do NOT
            # clear it: on the first real run this hit FISH and SHORE_FISH,
            # which unquestionably do yield food in game, so the likelier fault
            # is this script's lookup, not the placeholder.
            provenance.append(
                f"CONTRADICTION — empires2_x2_p1.dat reports no resource storage for unit {const_id}, "
                f"but this entry claims {entry.get('resourceAmounts')!r}; prior value carried through, "
                "still UNVERIFIED (suspect this script's Gaia-roster lookup before the placeholder)"
            )
        else:
            provenance.append("unit id NOT found in empires2_x2_p1.dat")

    # `verified` means "this run checked this entry's fields against the game's
    # data files", per the schema: "False means this entry (or some field on it
    # — see notes) hasn't been checked." So it is set per field, never
    # unconditionally. The first real install run (2026-07-30) set it True here
    # for all 31 entries, including GRASS whose own notes on the same line read
    # "texture NOT resolved from empires2_x2_p1.dat" — a self-contradicting
    # entry. That is the same false-confidence bug the `dat is None` branch
    # above was written to prevent, which had survived in this branch because
    # the earlier fix only guarded the --ids-only path.
    updated["verified"] = field_confirmed
    updated["notes"] = f"{'; '.join(provenance)}. Extracted {run_date} by tools/extract-constants (Phase 4.0)."
    return updated


# ---------------------------------------------------------------------------
# 5. Compact single-line-per-object JSON formatting, matching the existing
#    hand-formatted style of reference/data/game-constants.json exactly.
#    Note this style does NOT survive `npm run format` (Prettier would
#    re-wrap it) — that's a pre-existing repo situation, not something
#    this script controls; it only preserves what's already there.
# ---------------------------------------------------------------------------

CONSTANT_KEY_ORDER = [
    "constId",
    "idSource",
    "rmsConstant",
    "descriptiveName",
    "category",
    "deTextureFile",
    # A key missing from this list is silently DROPPED from the rewritten file,
    # so anything added to the schema has to be added here in the same change.
    # isWater/isForest/isHybrid/beachTerrain come from the community DE terrain
    # table rather than from the game's own files, so this script never writes
    # them — it only has to carry them through. beachTerrain was missing from
    # this list between the pass that added it and the pass that added
    # isHybrid, which means the next extraction run would have dropped all 131
    # of its values without saying anything.
    "isWater",
    "isForest",
    "isHybrid",
    "isBeach",
    "beachTerrain",
    # The engine's own terrain table, then our five-value reading of it. Order
    # is the argument: the measurement comes first and the approximation second,
    # so a reader who wants the real answer never has to know `habitat` exists.
    "terrainRestrictionId",
    "allowedTerrains",
    "placementSideTerrain",
    "habitat",
    # Unit classes, both directions. `classId` sits on an object row and
    # `classId`/`memberIds` on an objectClass row, so the two share a key name
    # by design — an object says which class it is in, a class says the same
    # thing about itself and then lists its members.
    "classId",
    "memberIds",
    "writesStorageSlot",
    # Written only when true, and only by --roster: something in the roster dies
    # or bleeds into this unit, so the Objects tab hides it unless asked. Guarded
    # on having no RMS constant, because FORAGE (59) is referenced as a corpse
    # and is also a bush scripts place on purpose.
    "isCorpse",
    "isTree",
    "previewColor",
    "minimapColor",
    # Measurement then reading, the order the terrain table established: the raw
    # slots first, our four-resource view of them second.
    "resourceStorages",
    "resourceAmounts",
    "verified",
    "notes",
]


def _json_scalar(value) -> str:
    import json

    # ensure_ascii=False: the existing file stores UTF-8 em dashes etc.
    # literally (not \uXXXX-escaped) — match that rather than mangling
    # notes text on every future run of this script.
    return json.dumps(value, ensure_ascii=False)


def format_resource_amounts(amounts: dict[str, float]) -> str:
    parts = [f'"{key}": {_json_scalar(amounts[key])}' for key in RESOURCE_KEY_ORDER if key in amounts]
    return "{ " + ", ".join(parts) + " }"


def format_preview_color(color) -> str:
    # On one line, like resourceAmounts — _json_scalar would give the same
    # text for a 3-element list today, but this says the shape is fixed at
    # three rather than leaving it to json's formatting to happen to agree.
    return "[" + ", ".join(str(int(channel)) for channel in color) + "]"


def format_constant(entry: dict) -> str:
    parts = []
    for key in CONSTANT_KEY_ORDER:
        if key not in entry:
            continue
        if key == "resourceAmounts":
            parts.append(f'"{key}": {format_resource_amounts(entry[key])}')
        elif key in ("previewColor", "minimapColor"):
            parts.append(f'"{key}": {format_preview_color(entry[key])}')
        else:
            parts.append(f'"{key}": {_json_scalar(entry[key])}')
    return "{ " + ", ".join(parts) + " }"


def format_game_constants(constants: list[dict]) -> str:
    # A blank line between category groups (terrain block, then object
    # block) matches the source file's existing hand-formatting and keeps
    # a real run's git diff to just the changed fields, not a reflow of
    # the whole file.
    rows: list[str] = []
    prev_category = None
    for c in constants:
        if prev_category is not None and c.get("category") != prev_category:
            rows.append("")
        rows.append(f"    {format_constant(c)}")
        prev_category = c.get("category")

    # Commas after every non-blank line except the last one.
    out_lines = []
    non_blank_indices = [i for i, r in enumerate(rows) if r != ""]
    last_non_blank = non_blank_indices[-1] if non_blank_indices else -1
    for i, row in enumerate(rows):
        if row == "":
            out_lines.append(row)
        elif i == last_non_blank:
            out_lines.append(row)
        else:
            out_lines.append(row + ",")
    body = "\n".join(out_lines)
    return "{\n  \"constants\": [\n" + body + "\n  ]\n}\n"


# ---------------------------------------------------------------------------
# 5b. Terrain-table run (preview-design Sec.15 item 23, CREATION_PLAN 4.7)
# ---------------------------------------------------------------------------


def run_terrain_table(install_path: Path, output: Path, dat: "DatExtraction | None", dry_run: bool) -> int:
    """Write the engine's own terrain table onto every object entry — the
    restriction id, the terrains that row permits, and the two-slot
    `placement_side_terrain` — plus the coarse `habitat` derived from it, and
    report every disagreement with what the file already says.

    **The report is the point, not the write.** Every habitat in the file
    today was assigned by hand on 2026-08-08 from a handful of restriction
    rows read one at a time, and the value of automating it is only partly
    that it scales — it is mostly that the automated answer can be checked
    against the hand answer on the entries where both exist. A run that
    silently overwrote them would throw that away.

    The mode was called `--habitat-only` while the derived class was all it
    wrote, which is where the build log's 2026-08-10 entry meets it. It writes
    the measurement as well as the reading now, so the name would be false.
    """
    import json

    if dat is None:
        print("Cannot derive habitats without empires2_x2_p1.dat.", file=sys.stderr)
        return 1

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print("random_map.def not found.", file=sys.stderr)
        return 1
    objects = object_constants(def_matches[0].read_text(encoding="utf-8", errors="replace"))

    existing = json.loads(output.read_text(encoding="utf-8"))
    constants = existing["constants"]
    # Terrain flags come from the file, not the dat: isWater/isHybrid/isBeach
    # are the community DE terrain table's, and this script has never sourced
    # them (see CONSTANT_KEY_ORDER's note). The derivation therefore reads OUR
    # classification of terrain and the ENGINE's classification of objects,
    # which is the only combination available and is worth saying out loud.
    terrain_flags = {
        entry["constId"]: entry
        for entry in constants
        if entry.get("category") == "terrain" and entry.get("constId") is not None
    }

    run_date = date.today().isoformat()
    unchanged, changed, unresolved, unclassified, loose, side_notes = [], [], [], [], [], []
    # Entries whose RAW table this run wrote or rewrote, tracked separately from
    # the habitat counts because the two answer different questions: a habitat
    # that agrees with the file is a confirmation, while a restriction row that
    # disagrees with the file is a DE patch having moved something under us.
    tabled, table_moved = [], []
    updated: list[dict] = []
    for entry in constants:
        if entry.get("category") != "object":
            updated.append(entry)
            continue
        name = entry.get("rmsConstant")
        const_id = objects.get(name, entry.get("constId"))
        placement = dat.placement(const_id) if const_id is not None else None
        if placement is None:
            unresolved.append(name)
            updated.append(entry)
            continue
        fit = derive_habitat(placement.allowed_terrains, placement.side_terrains, terrain_flags)
        if fit is None:
            # No class fits, and the raw table is still written below. That is
            # the whole reason the raw fields exist — see merge_terrain_table.
            unclassified.append((name, placement.restriction_id, len(placement.allowed_terrains)))
        else:
            current = entry.get("habitat")
            if current == fit.habitat:
                unchanged.append(name)
            else:
                changed.append((name, current, fit, placement.restriction_id))
            # Every fit worth a second look is collected, whether or not it
            # changed the value: a habitat that AGREES with the hand assignment
            # and fits its row badly is exactly as interesting as one that
            # disagrees, and the first version of this report could not say so.
            if fit.mismatch > 0:
                loose.append((name, fit, placement.restriction_id, len(placement.allowed_terrains)))
            if fit.side_terrain_unmodelled:
                side_notes.append((name, fit.habitat, placement.side_terrains))
        tabled.append(name)
        prior_restriction = entry.get("terrainRestrictionId")
        if prior_restriction is not None and prior_restriction != placement.restriction_id:
            table_moved.append((name, prior_restriction, placement.restriction_id))
        updated.append(merge_terrain_table(entry, placement, fit, run_date))

    print(f"\nObject namespace from random_map.def: {len(objects)} names")
    print(f"Object entries in {output.name}: {sum(1 for c in constants if c.get('category') == 'object')}")
    print(f"  terrain table written        : {len(tabled)}")
    if table_moved:
        # A restriction id that moved is the one result in this report that
        # cannot be a mistake of ours: the engine changed. Printed loudly
        # because it invalidates whatever the preview assumed about that object.
        print(f"  RESTRICTION ID MOVED         : {len(table_moved)} — the dat disagrees with the file")
        for name, was, now in table_moved:
            print(f"      {name:22s} restriction {was} -> {now}")
    print(f"  habitat agrees with the file : {len(unchanged)}")
    print(f"  habitat CHANGED by this run  : {len(changed)}")
    for name, current, fit, rid in changed:
        print(
            f"      {name:22s} {str(current):12s} -> {fit.habitat:12s} "
            f"(restriction {rid}, {fit.mismatch} terrains differ, runner-up {fit.runner_up} at {fit.runner_up_mismatch})"
        )
    if loose:
        # Sorted worst-first so the coarsest join is the first thing read. This
        # is the number that says how much a five-value vocabulary is costing,
        # and it is a property of the vocabulary rather than a fault to fix.
        print(f"  approximate fits (worst first): {len(loose)}")
        for name, fit, rid, permitted in sorted(loose, key=lambda item: -item[1].mismatch):
            print(
                f"      {name:22s} {fit.habitat:12s} restriction {rid:3d}: engine permits {permitted:3d}, "
                f"class differs on {fit.mismatch:3d} (runner-up {fit.runner_up} at {fit.runner_up_mismatch})"
            )
    if side_notes:
        print(f"  side terrain NOT modelled    : {len(side_notes)}")
        for name, habitat, sides in side_notes:
            print(f"      {name:22s} {habitat:12s} must sit beside terrain {sides} — no class expresses this")
    if unclassified:
        print(f"  no class fits (habitat left alone, table still written): {len(unclassified)}")
        for name, rid, count in unclassified:
            print(f"      {name:22s} restriction {rid}, {count} terrains permitted")
    if unresolved:
        print(f"  not in the object namespace  : {len(unresolved)} — {', '.join(str(n) for n in unresolved)}")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_game_constants(updated), encoding="utf-8")
    print(f"\nWrote {output}")
    print("Next: run `npm run validate:reference` from the repo root and review the diff before committing.")
    return 0


# ---------------------------------------------------------------------------
# 5bb. Resource-storage run
# ---------------------------------------------------------------------------


#: The contradiction sentence `merge_entry` wrote whenever the dat appeared to
#: report no storage for an object that claims a yield. It fired on exactly two
#: entries, FISH and SHORE_FISH, and its own text guessed the cause correctly
#: ("suspect this script's Gaia-roster lookup before the placeholder"). The
#: cause was neither: `RESOURCE_TYPE_INDEX` had no entry for type 17. Matched
#: here so the run that resolves it can retract it rather than leave a false
#: sentence sitting in the data.
#:
#: The dash is matched as EITHER a real em dash or its UTF-8 bytes decoded as
#: latin-1 ("â"), because one entry in the file carries the
#: mojibake form. Found here on 2026-08-10 by this very regex failing to match
#: SHORE_FISH while matching FISH: one round-trip through the wrong encoding,
#: somewhere in this file's history, corrupted a single character in a single
#: note. Retracting the sentence removes the corruption with it.
_CONTRADICTION_NOTE_RE = re.compile(
    "CONTRADICTION (?:—|â) "
    r"empires2_x2_p1\.dat reports no resource storage for unit \d+, "
    r"but this entry claims .*?\(suspect this script's Gaia-roster lookup before the placeholder\)"
)

_STORAGE_NOTE_RE = re.compile(r"\s*\| storage: .*?(?=\s*\||$)")


def storage_note(existing: str | None, storages: list[tuple[int, float]], const_id: int, run_date: str) -> str:
    """Append (or replace) one sentence recording the raw slots, and retract the
    contradiction sentence if this entry carries one.

    Idempotent for the reason every note helper in this file is: a tool meant to
    be re-run after each DE patch that stacks a second copy of its own sentence
    is a tool nobody re-runs.
    """
    note = existing or ""
    resolved = _CONTRADICTION_NOTE_RE.search(note)
    if resolved:
        slot_text = ", ".join(f"type {t} amount {a:g}" for t, a in storages) or "no non-empty slot"
        note = _CONTRADICTION_NOTE_RE.sub(
            f"resourceAmounts CONFIRMED against empires2_x2_p1.dat on {run_date}: unit {const_id} stores "
            f"{slot_text}, and type 17 is fish food (guide:4999 puts standard fish at 225 food; the dat's "
            f"FISH1-FISH5 carry type 17 amount 225). The earlier CONTRADICTION here was this script's own "
            f"gap — RESOURCE_TYPE_INDEX mapped only types 0-3 — which is what that note suspected",
            note,
        )
    note = _STORAGE_NOTE_RE.sub("", note).rstrip()
    slots = ", ".join(f"[{t}]={a:g}" for t, a in storages) or "none"
    addition = f"| storage: raw slots {slots} read {run_date} by tools/extract-constants --storages."
    return f"{note} {addition}".strip() if note else addition


def run_storages(install_path: Path, output: Path, dat: "DatExtraction | None", dry_run: bool) -> int:
    """Write each object's RAW resource-storage slots, and refresh the derived
    `resourceAmounts` from the same read.

    **Why the raw slots are worth their own field when `resourceAmounts` exists.**
    `effect_amount SET_ATTRIBUTE <target> ATTR_STORAGE_VALUE <n>` writes SLOT 0,
    whatever that slot holds, and the corpus does it 374 times. Whether that
    line changes a map's food total depends entirely on the slot's TYPE — wood
    for a tree, population for a house, decay time for a corpse, all through the
    same attribute. `resourceAmounts` has already thrown the type away by keying
    on our own four-resource vocabulary, and it drops a zero amount outright,
    which is exactly the value a script writes to switch a resource off.

    So this writes the measurement beside the reading, the same order the
    terrain table uses: `resourceStorages` is what the dat says, and
    `resourceAmounts` stays the four-resource view a status bar wants.
    """
    import json

    if dat is None:
        print("Cannot read resource storages without empires2_x2_p1.dat.", file=sys.stderr)
        return 1

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print("random_map.def not found.", file=sys.stderr)
        return 1
    objects = object_constants(def_matches[0].read_text(encoding="utf-8", errors="replace"))

    existing = json.loads(output.read_text(encoding="utf-8"))
    constants = existing["constants"]
    run_date = date.today().isoformat()

    written, unresolved, amount_changed, retracted = [], [], [], []
    updated: list[dict] = []
    for entry in constants:
        if entry.get("category") != "object":
            updated.append(entry)
            continue
        name = entry.get("rmsConstant")
        const_id = objects.get(name, entry.get("constId"))
        obj = dat.object(const_id) if const_id is not None else None
        if obj is None:
            unresolved.append(name)
            updated.append(entry)
            continue
        replacement = dict(entry)
        # `resource` resolves the type through RESOURCE_TYPE_INDEX right here,
        # so no consumer has to carry a second copy of the engine's resource
        # convention. Absent means "this slot is not one of the four" —
        # population, decay time, or one of the unread types — which is exactly
        # what a caller needs to know before assuming an ATTR_STORAGE_VALUE
        # line moved a resource total.
        replacement["resourceStorages"] = [
            {"type": t, "amount": a, **({"resource": RESOURCE_TYPE_INDEX[t]} if t in RESOURCE_TYPE_INDEX else {})}
            for t, a in obj.storages
        ]
        before = entry.get("resourceAmounts")
        after = {k: v for k, v in obj.resource_amounts.items()} or None
        if after is None:
            replacement.pop("resourceAmounts", None)
        else:
            replacement["resourceAmounts"] = after
        if before != after:
            amount_changed.append((name, before, after))
        note = storage_note(entry.get("notes"), obj.storages, const_id, run_date)
        if _CONTRADICTION_NOTE_RE.search(entry.get("notes") or ""):
            retracted.append(name)
        replacement["notes"] = note
        written.append(name)
        updated.append(replacement)

    print(f"\nObject entries in {output.name}: {sum(1 for c in constants if c.get('category') == 'object')}")
    print(f"  resourceStorages written     : {len(written)}")
    if amount_changed:
        print(f"  resourceAmounts CHANGED      : {len(amount_changed)}")
        for name, before, after in amount_changed:
            print(f"      {name:22s} {before!r} -> {after!r}")
    if retracted:
        # The loudest line in this report. A note that asserted a contradiction
        # for two weeks was wrong, and the entries it sat on can now be marked
        # verified by hand — this run deliberately does not flip that flag,
        # since `verified` is a claim about the WHOLE entry.
        print(f"  CONTRADICTION note retracted : {len(retracted)} — {', '.join(retracted)}")
        print("      these entries still read verified: false purely because of that note. Review and flip by hand.")
    if unresolved:
        print(f"  not a live unit              : {len(unresolved)} — {', '.join(str(n) for n in unresolved)}")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_game_constants(updated), encoding="utf-8")
    print(f"\nWrote {output}")
    print("Next: run `npm run validate:reference` from the repo root and review the diff before committing.")
    return 0


def run_attributes(install_path: Path, output: Path, dry_run: bool) -> int:
    """Write one `attribute` row per `effect_amount` attribute selector.

    Needs no dat: `random_map.def` is a text file and this is a text scan, so
    it works on an install genieutils cannot parse. Rows are rebuilt wholesale,
    since the file is the only source and there is nothing of ours to preserve.
    """
    import json

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print("random_map.def not found.", file=sys.stderr)
        return 1
    attributes = attribute_constants(def_matches[0].read_text(encoding="utf-8", errors="replace"))
    if not attributes:
        print(
            f"No names found under random_map.def's '{ATTRIBUTE_SECTION}' section. The section header may "
            "have been renamed by a patch — check before assuming the attributes are gone.",
            file=sys.stderr,
        )
        return 1

    existing = json.loads(output.read_text(encoding="utf-8"))
    kept = [entry for entry in existing["constants"] if entry.get("category") != "attribute"]
    run_date = date.today().isoformat()
    entries = build_attribute_entries(attributes, run_date)

    print(f"\nAttribute constants in random_map.def: {len(attributes)}")
    print(f"  rows written                 : {len(entries)}")
    storage = attributes.get("ATTR_STORAGE_VALUE")
    print(f"  ATTR_STORAGE_VALUE           : {storage if storage is not None else 'ABSENT — resourceTotals cannot resolve it'}")
    if storage is None:
        return 1

    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_game_constants(kept + entries), encoding="utf-8")
    print(f"\nWrote {output}")
    print("Next: run `npm run validate:reference` from the repo root and review the diff before committing.")
    return 0


# ---------------------------------------------------------------------------
# 5c. Unit-class run
# ---------------------------------------------------------------------------


def run_classes(install_path: Path, output: Path, dat: "DatExtraction | None", dry_run: bool) -> int:
    """Write one `objectClass` row per genie unit class, and stamp `classId`
    onto every object entry that resolves to a live unit.

    **What this is for.** A script can aim `effect_amount SET_ATTRIBUTE` at a
    CLASS rather than a unit, and 374 of the corpus's uses do — `TREE_CLASS`
    alone covers 51 unit types. Nothing in the reference data could resolve one,
    so a consumer asking "did that line change the object I am about to place"
    had no way to answer. `src/parser/resourceTotals.ts` is the first caller
    that needs it (`ATTR_STORAGE_VALUE` rewrites what an object yields, and the
    status bar currently reports the base value regardless).

    **The offset is verified before anything is written, and a disagreement
    aborts.** If DE moved `CLASS_CONST_BASE`, every `memberIds` list this would
    emit is attached to the wrong constant, and a file that is confidently wrong
    is worse than one that is missing the field.

    Both directions of the mapping are written on purpose. `memberIds` answers
    "which units does this class name cover" and is complete over the roster;
    `classId` answers "which class is this object in" and only exists for the
    few dozen objects that have rows. They cannot drift — one run writes both
    from one read — and `npm run validate:reference` pins that they agree.
    """
    import json

    if dat is None:
        print("Cannot read unit classes without empires2_x2_p1.dat.", file=sys.stderr)
        return 1

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print("random_map.def not found.", file=sys.stderr)
        return 1
    def_text = def_matches[0].read_text(encoding="utf-8", errors="replace")
    objects = object_constants(def_text)
    named_classes = class_constants(def_text)
    classes = dat.unit_classes()

    confirmed, coincidental, contradicted = verify_class_offset(named_classes, classes, objects, dat.unit_class_of)
    print(f"\nUnit classes in the roster: {len(classes)} across {sum(len(m) for m in classes.values())} live units")
    print(f"Named *_CLASS constants in random_map.def: {len(named_classes)}")
    print(f"  offset {CLASS_CONST_BASE} confirmed by : {len(confirmed)}")
    for line in confirmed:
        print(f"      {line}")
    if coincidental:
        # Reported every run rather than suppressed. It is a live warning about
        # reading these names as if they described their stem — see
        # verify_class_offset for why it is not a failure.
        print(f"  name coincidences (not failures): {len(coincidental)}")
        for line in coincidental:
            print(f"      {line}")
    if contradicted or (named_classes and not confirmed):
        print(f"  offset {CLASS_CONST_BASE} CONTRADICTED by: {len(contradicted)}", file=sys.stderr)
        for line in contradicted:
            print(f"      {line}", file=sys.stderr)
        if not confirmed:
            print("      no named class constant confirms the offset at all", file=sys.stderr)
        print(
            "\nRefusing to write. The class-to-constant offset is the one assumption every\n"
            "memberIds list rests on, so a contradiction means the rows would be attached to\n"
            "the wrong constants. Re-derive CLASS_CONST_BASE before re-running.",
            file=sys.stderr,
        )
        return 1

    existing = json.loads(output.read_text(encoding="utf-8"))
    constants = existing["constants"]
    run_date = date.today().isoformat()

    # Object rows first, so `classId` lands beside the data it describes.
    stamped, unresolved = [], []
    updated: list[dict] = []
    for entry in constants:
        if entry.get("category") == "objectClass":
            continue  # rebuilt wholesale below — this mode owns them
        if entry.get("category") != "object":
            updated.append(entry)
            continue
        name = entry.get("rmsConstant")
        const_id = objects.get(name, entry.get("constId"))
        class_id = dat.unit_class_of(const_id) if const_id is not None else None
        if class_id is None:
            unresolved.append(name)
            updated.append(entry)
            continue
        stamped.append((name, class_id))
        updated.append({**entry, "classId": class_id})

    class_entries = build_class_entries(classes, named_classes, run_date)
    updated.extend(class_entries)

    print(f"\nObject entries in {output.name}: {sum(1 for c in constants if c.get('category') == 'object')}")
    print(f"  classId stamped              : {len(stamped)}")
    if unresolved:
        print(f"  not a live unit              : {len(unresolved)} — {', '.join(str(n) for n in unresolved)}")
    unclassed = sum(len(members) for class_id, members in classes.items() if class_id < 0)
    if unclassed:
        print(f"  units with NO class (dropped): {unclassed} — the dat's class -1, which no constant names")
    print(f"  objectClass rows written     : {len(class_entries)}")
    named_rows = [e for e in class_entries if e["rmsConstant"] is not None]
    print(f"      with an RMS constant     : {len(named_rows)}")
    print(f"      unnamed (id-only)        : {len(class_entries) - len(named_rows)}")
    for entry in sorted(class_entries, key=lambda e: -len(e["memberIds"]))[:8]:
        label = entry["rmsConstant"] or f"(class {entry['classId']})"
        print(f"      {label:24s} constId {entry['constId']}: {len(entry['memberIds'])} units")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_game_constants(updated), encoding="utf-8")
    print(f"\nWrote {output}")
    print("Next: run `npm run validate:reference` from the repo root and review the diff before committing.")
    return 0


# ---------------------------------------------------------------------------
# 5d. Roster run (CREATION_PLAN 4.10)
# ---------------------------------------------------------------------------

#: DE's own display text, keyed by the string id `Unit.language_dll_name` holds.
#: Every other mode in this file fills FIELDS on rows that already exist, so
#: none of them ever needed a name for a unit nobody had written down.
DISPLAY_STRINGS_RELATIVE = Path("resources") / "en" / "strings" / "key-value" / "key-value-strings-utf8.txt"

#: `<id> "<text>"`, one per line, with comment lines and blanks between them.
_DISPLAY_STRING_RE = re.compile(r'^\s*(\d+)\s+"(.*)"\s*$')


def parse_display_strings(text: str) -> dict[int, str]:
    """Pure half of `load_display_strings`, so it is testable without an install."""
    out: dict[int, str] = {}
    for line in text.splitlines():
        match = _DISPLAY_STRING_RE.match(line)
        if match:
            out[int(match.group(1))] = match.group(2)
    return out


def load_display_strings(install_path: Path) -> dict[int, str]:
    """DE's English display strings, or an empty dict if the file is missing.

    **Missing is not fatal and must not be.** Every row this mode writes can
    still be named from `Unit.name`; losing the strings file costs 1327 rows a
    friendlier name and costs nothing else, so a run that aborts here would be
    refusing to do the 4.10 work over a cosmetic field.

    `utf-8-sig` because the file carries a BOM, and `errors="replace"` for the
    same reason every other read in this script does: a mangled character in one
    campaign string is not a reason to fail an extraction.
    """
    path = install_path / DISPLAY_STRINGS_RELATIVE
    if not path.is_file():
        return {}
    return parse_display_strings(path.read_text(encoding="utf-8-sig", errors="replace"))


def corpse_unit_ids(units: dict[int, object]) -> set[int]:
    """Units that some other unit turns into when it dies or bleeds.

    **This is the only data-driven answer to "would anyone place this on a map",
    and it took two wrong ones to find.** `Unit.name.endswith("_D")` is a name
    pattern, which this project resists for the reason `objectHabitat` records:
    a pattern is a claim about every name nobody has looked at. `Unit.type` was
    the obvious data alternative and it does not work either — 329 of the 336
    `*_D` units are type 30, and so are `DEER`, `SHEEP`, `WOLF` and 13 other
    rows already in the file, so the enum cannot tell a carcass from the animal
    that leaves it. There are no type-50 projectiles in the gaia roster at all.

    `dead_unit_id`/`blood_unit_id` is a LINK rather than a label: a unit is a
    corpse because something dies into it, which is a fact the dat states. It
    catches 292 of the 336, so it under-reaches, which is the right direction —
    the caller hides these by default and a row wrongly left visible is a row in
    a list, while a row wrongly hidden is a unit an author cannot find.
    """
    corpses: set[int] = set()
    for unit in units.values():
        for field_name in ("dead_unit_id", "blood_unit_id"):
            value = getattr(unit, field_name, None)
            if value is not None and int(value) >= 0:
                corpses.add(int(value))
    return corpses & set(units)


def roster_descriptive_name(unit, strings: dict[int, str]) -> tuple[str, str]:
    """`(name, source)` for one unit, DE's display text first and its internal
    code second.

    **The strings file is trusted because it reproduces the hand-written rows**,
    which is the same check `--terrain-table` put its derived habitats through:
    against the 31 comparable object rows written by hand it scores 14 exact, 17
    differing and 0 missing, and all 17 differences are DE being more specific
    (`Wolf` -> `Grey Wolf`, `Tuna` -> `Fish (Tuna)`).

    `Unit.name` is an internal code — `FISHS`, `GOLDM`, `PLACEHOLDER (NAVAL)` —
    and 1315 units have nothing else. It is written VERBATIM. Paraphrasing it
    into something friendlier would be a thousand claims nobody checked, which
    is the objection CREATION_PLAN 4.10 raises against doing exactly that.
    """
    string_id = int(getattr(unit, "language_dll_name", 0) or 0)
    text = strings.get(string_id)
    if text:
        return text, "strings"
    return str(unit.name), "unitName"


def build_roster_entry(
    const_id: int,
    rms_constant: str | None,
    unit,
    dat: "DatExtraction",
    strings: dict[int, str],
    terrain_flags: dict[int, dict],
    corpses: set[int],
    run_date: str,
) -> tuple[dict, str]:
    """One object row plus where its name came from, with every field the narrow
    modes write already on it.

    The name source is RETURNED rather than left for the caller to read back off
    the finished row. The first version of this had the reporter counting rows
    whose `notes` contained "display string", which the fallback note also
    contains in the words "no display string" — so a run that named 1315 rows
    from `Unit.name` reported naming none that way, and the number looked
    plausible enough to print.

    The narrow modes (`--terrain-table`, `--storages`, `--classes`) were never
    missing anything except rows to write onto, so this reuses each of their
    readers rather than re-deriving a single field.
    """
    name, name_source = roster_descriptive_name(unit, strings)
    # `deTextureFile` is deliberately absent rather than null. It is a terrain
    # field; the 33 hand-written object rows carry an explicit null only because
    # they were written before the file had any other category. 2639 more nulls
    # is 56 KB spent restating that objects have no texture.
    entry: dict = {
        "constId": const_id,
        "idSource": "extracted",
        "rmsConstant": rms_constant,
        "descriptiveName": name,
        "category": "object",
    }

    # `isCorpse` is written only when true, the way `writesStorageSlot` is.
    # Absent means "not a corpse" on a row this mode wrote; 2642 explicit
    # `false`s would be ~40 KB spent saying nothing.
    if rms_constant is None and const_id in corpses:
        entry["isCorpse"] = True

    placement = dat.placement(const_id)
    fit = None
    if placement is not None:
        fit = derive_habitat(placement.allowed_terrains, placement.side_terrains, terrain_flags)
        entry["terrainRestrictionId"] = placement.restriction_id
        # **`allowedTerrains` is NOT written on a roster row, and the id it is
        # derived from always is.** The expansion is a pure function of the
        # restriction id, and the whole roster references only 33 distinct ids,
        # so writing the array per row stores 33 real answers 2672 times — 1.33
        # MB of a 3.5 MB file, in a file every consumer imports whole. Nothing
        # in src/ reads the field today. `--terrain-table` re-expands it onto
        # any row on demand, so the measurement is one command away rather than
        # lost, and the id is what makes that possible.
        if placement.side_terrains != [-1, -1]:
            # Six entries in the whole object namespace carry a real "must sit
            # beside" pair. Writing (-1, -1) on the other 2633 says nothing that
            # its absence does not.
            entry["placementSideTerrain"] = placement.side_terrains
        if fit is not None:
            entry["habitat"] = fit.habitat

    class_id = dat.unit_class_of(const_id)
    # Class -1 is skipped, not written. `--classes` gives it no `objectClass`
    # row on purpose — no constant names it — and `validate:reference` checks
    # that every `classId` on an object resolves to a row, so writing it here
    # fails the gate 116 times. Absent is the honest value: this unit is in no
    # class an RMS author can name.
    if class_id is not None and class_id >= 0:
        entry["classId"] = class_id

    extracted = dat.object(const_id)
    if extracted is not None:
        # `resource` is OMITTED rather than null when the slot is not one of the
        # four, matching --storages: absent means population, a decay timer, or
        # one of the unread types. See its comment for why that distinction
        # matters to an ATTR_STORAGE_VALUE consumer.
        entry["resourceStorages"] = [
            {"type": t, "amount": a, **({"resource": RESOURCE_TYPE_INDEX[t]} if t in RESOURCE_TYPE_INDEX else {})}
            for t, a in extracted.storages
        ]
        if extracted.resource_amounts:
            entry["resourceAmounts"] = extracted.resource_amounts

    # **The note is one clause, not a paragraph.** The long-form provenance every
    # other mode writes costs ~400 bytes, which over 2639 rows is 1 MB of near
    # identical text in a file the app imports whole. What actually varies per
    # row is where the NAME came from, since that is the one field a bulk pass
    # can get from two places; the rest of the provenance is the same sentence
    # for every row and belongs in the mode's docstring and the schema, where it
    # is written once and can be read. `--roster` in the note is the pointer.
    entry["verified"] = True
    entry["notes"] = (
        f"Gaia roster row, tools/extract-constants --roster {run_date}; "
        + ("name is DE's own display string." if name_source == "strings" else "name is the dat's internal Unit.name verbatim (no display string, no RMS constant).")
    )
    return entry, name_source


def run_roster(install_path: Path, output: Path, dat: "DatExtraction | None", dry_run: bool) -> int:
    """CREATE an object row for every live gaia unit, rather than filling fields
    on the rows that happen to exist.

    **What the gap costs is measured in the item, not asserted.** 33 object rows
    against 2642 live units means `AD4 - Pag - v1.2.rms`'s `ONGRID_PLACEHOLDER_NAVAL`
    (unit 1546, terrain restriction 6, water) takes `objectHabitat`'s `land`
    default and grows 111 naval placeholders in a desert; 397 distinct object
    names across the corpus have 11 habitat rows between them; and
    `resourceTotals.ts` resolves 365 of 374 `ATTR_STORAGE_VALUE` lines and hits
    nothing it counts.

    **Rows are keyed by `constId` and there is one per NAME, not one per id.**
    A name-keyed table can never reach unit 1546, which has no `#const` in
    `random_map.def` at all. But 618 object names cover only 590 ids — `FISH`
    and `FISH_PERCH` are both id 53, and six more pairs like it — and those
    rows already exist in the file, so collapsing them would delete a spelling
    a script may have written. Named units therefore get a row per name, unnamed
    ids get one row with `rmsConstant: null`, matching the shape the 53 unnamed
    terrains and 32 unnamed classes already use.

    **Existing rows are never overwritten, and the disagreement report is the
    point** — the same rule `--terrain-table` established. Every hand-written
    `descriptiveName` this run disagrees with is printed and left alone, because
    two of the disagreements lose information rather than gaining precision:
    `KING` is `King (Regicide)` by hand and `King` in DE's strings, and
    `MARLIN1`/`MARLIN2` both resolve to `Great Fish (Marlin)`. Settle those row
    by row and edit them deliberately; do not let a bulk pass decide them.
    """
    import json

    if dat is None:
        print("Cannot build the roster without empires2_x2_p1.dat.", file=sys.stderr)
        return 1

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print("random_map.def not found.", file=sys.stderr)
        return 1
    objects = object_constants(def_matches[0].read_text(encoding="utf-8", errors="replace"))
    names_by_id: dict[int, list[str]] = {}
    for name, const_id in sorted(objects.items()):
        names_by_id.setdefault(const_id, []).append(name)

    strings = load_display_strings(install_path)
    if not strings:
        print(f"WARNING: no display strings at {install_path / DISPLAY_STRINGS_RELATIVE} — every new row will be named from Unit.name.", file=sys.stderr)

    units = dat._units_by_id
    corpses = corpse_unit_ids(units)

    existing = json.loads(output.read_text(encoding="utf-8"))
    constants = existing["constants"]
    terrain_flags = {
        entry["constId"]: entry
        for entry in constants
        if entry.get("category") == "terrain" and entry.get("constId") is not None
    }
    run_date = date.today().isoformat()

    # (constId, rmsConstant) is the identity of a row here, because seven ids
    # legitimately carry two rows each. Keying on constId alone would read
    # FISH_PERCH as a duplicate of FISH and skip it.
    covered = {(e.get("constId"), e.get("rmsConstant")) for e in constants if e.get("category") == "object"}

    # The name check runs over the rows that already exist, and writes nothing.
    agree, differ, no_string = [], [], []
    for entry in constants:
        if entry.get("category") != "object" or entry.get("constId") is None:
            continue
        unit = units.get(entry["constId"])
        if unit is None:
            continue
        name, source = roster_descriptive_name(unit, strings)
        if source != "strings":
            no_string.append((entry.get("rmsConstant"), entry.get("descriptiveName"), name))
        elif name == entry.get("descriptiveName"):
            agree.append(entry.get("rmsConstant"))
        else:
            differ.append((entry.get("rmsConstant"), entry.get("descriptiveName"), name))

    created: list[dict] = []
    from_strings = 0
    for const_id, unit in sorted(units.items()):
        for rms_constant in names_by_id.get(const_id, [None]):
            if (const_id, rms_constant) in covered:
                continue
            entry, name_source = build_roster_entry(const_id, rms_constant, unit, dat, strings, terrain_flags, corpses, run_date)
            created.append(entry)
            from_strings += name_source == "strings"

    # New rows go immediately after the last existing object row.
    # `format_game_constants` starts a new block every time the category
    # changes, so appending at the end of the array would split the object rows
    # into two blocks with a blank line down the middle of the file.
    last_object = max((i for i, e in enumerate(constants) if e.get("category") == "object"), default=len(constants) - 1)
    updated = constants[: last_object + 1] + created + constants[last_object + 1 :]

    named_created = sum(1 for e in created if e["rmsConstant"] is not None)
    print(f"\nLive gaia units: {len(units)}   object constants in random_map.def: {len(objects)} names over {len(names_by_id)} ids")
    print(f"Object rows in {output.name}: {len(covered)} before, {len(covered) + len(created)} after")
    print(f"  rows created                 : {len(created)}")
    print(f"      with an RMS constant     : {named_created}")
    print(f"      unnamed (id-only)        : {len(created) - named_created}")
    print(f"  descriptiveName from DE text : {from_strings}")
    print(f"  descriptiveName from Unit.name: {len(created) - from_strings}")
    print(f"  marked isCorpse (hidden by default in the Objects tab): {sum(1 for e in created if e.get('isCorpse'))}")
    print(f"  no habitat could be derived  : {sum(1 for e in created if 'habitat' not in e)}")

    print(f"\nExisting rows checked against DE's display strings: {len(agree)} agree, {len(differ)} differ, {len(no_string)} have no string")
    if differ:
        print("  DIFFERS — left alone, settle each one deliberately (CREATION_PLAN 4.10 decision 1):")
        for name, hand, de_text in differ:
            print(f"      {str(name):22s} file={hand!r:30} DE={de_text!r}")
    if no_string:
        print("  no display string, file's name kept:")
        for name, hand, fallback in no_string:
            print(f"      {str(name):22s} file={hand!r:30} Unit.name={fallback!r}")

    if dry_run:
        print("\n--dry-run: nothing written.")
        return 0
    output.write_text(format_game_constants(updated), encoding="utf-8")
    print(f"\nWrote {output}")
    print("Next: run `npm run validate:reference` from the repo root, then the before/after corpus diff — the habitat fallback stops firing for hundreds of objects and the preview is expected to MOVE.")
    return 0


# ---------------------------------------------------------------------------
# 6. Main
# ---------------------------------------------------------------------------


def main() -> int:
    import json

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--install-path", type=Path, default=None, help="AoE2 DE install root. Auto-detected from common Steam paths if omitted.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="Where to write game-constants.json (default: reference/data/game-constants.json)")
    parser.add_argument("--ids-only", action="store_true", help="Skip empires2_x2_p1.dat entirely — only fill in constId from random_map.def. Use this if genieutils-py isn't installed or the .dat parse fails on your DE version.")
    parser.add_argument("--colors-only", action="store_true", help="Update ONLY previewColor on terrain entries, from each terrain's existing deTextureFile. Reads no .dat and rewrites no other field — use this to refresh colours without re-extracting everything.")
    parser.add_argument("--terrain-table", action="store_true", help="Update ONLY the engine's terrain table on object entries, read from empires2_x2_p1.dat (preview-design Sec.15 item 23): terrainRestrictionId, allowedTerrains, placementSideTerrain, and the coarse habitat derived from them. Rewrites no other field. Prints every entry whose derived habitat disagrees with what is in the file.")
    parser.add_argument("--storages", action="store_true", help="Update ONLY the resource-storage data on object entries, read from empires2_x2_p1.dat: the raw resourceStorages slots plus a refreshed resourceAmounts derived from them. Rewrites no other field. This is what tells a consumer whether an effect_amount ATTR_STORAGE_VALUE line changes a resource, a population count or a decay timer.")
    parser.add_argument("--attributes", action="store_true", help="Update ONLY the effect_amount attribute selectors (ATTR_*), read from random_map.def's own Attribute Constants section. Needs no dat file. Rewrites no other field.")
    parser.add_argument("--classes", action="store_true", help="Update ONLY the unit-class data, read from empires2_x2_p1.dat: one objectClass row per genie unit class (with the unit ids in it) plus a classId on every object entry. Rewrites no other field. Verifies the class-to-constant offset against random_map.def first and refuses to write if it disagrees.")
    parser.add_argument("--roster", action="store_true", help="CREATE an object row for every live gaia unit, read from empires2_x2_p1.dat (CREATION_PLAN 4.10) — the only mode that adds rows rather than filling fields on rows that already exist. Rows are keyed by constId with rmsConstant null where the unit has no name, since unit 1546 has no #const at all. Never overwrites an existing row, and prints every descriptiveName where DE's own display text disagrees with what the file says.")
    parser.add_argument("--dry-run", action="store_true", help="Compute and report, write nothing. Use with --terrain-table, --classes or --roster to see the diff before taking it.")
    args = parser.parse_args()

    if sum([bool(args.ids_only), bool(args.colors_only), bool(args.terrain_table), bool(args.classes), bool(args.storages), bool(args.attributes), bool(args.roster)]) > 1:
        print("The narrow modes (--ids-only, --colors-only, --terrain-table, --classes, --storages, --attributes, --roster) are mutually exclusive.", file=sys.stderr)
        return 1

    install_path = args.install_path or guess_install_path()
    if install_path is None or not install_path.is_dir():
        print(
            "Could not find an AoE2 DE install. Pass --install-path explicitly, "
            "e.g.:\n  python extract_constants.py --install-path \"C:\\Program Files (x86)\\Steam\\steamapps\\common\\AoE2DE\"",
            file=sys.stderr,
        )
        return 1

    textures = TextureExtraction(install_path)
    if not textures.available:
        print(
            f"WARNING: no terrain textures found under {install_path / 'resources' / '_common' / 'terrain' / 'textures'} "
            "— previewColor will not be updated.",
            file=sys.stderr,
        )

    def load_dat() -> DatExtraction | None:
        dat_matches = find_file(install_path, "empires2_x2_p1.dat")
        if not dat_matches:
            print("WARNING: empires2_x2_p1.dat not found.", file=sys.stderr)
            return None
        try:
            loaded = DatExtraction(dat_matches[0])
            print(f"Loaded {dat_matches[0]}")
            return loaded
        except Exception as exc:  # genieutils version mismatch, corrupt file, etc.
            print(f"WARNING: failed to parse {dat_matches[0]} ({exc}).", file=sys.stderr)
            return None

    if args.colors_only:
        # minimapColor comes from the dat, so --colors-only loads it too. It
        # still writes only the two colour fields.
        minimaps = MinimapColorExtraction(install_path, load_dat())
        if not minimaps.available:
            print(
                f"WARNING: could not read {install_path / BASE_PALETTE_RELATIVE} or the dat "
                "— minimapColor will not be updated.",
                file=sys.stderr,
            )
        existing = json.loads(args.output.read_text(encoding="utf-8"))
        run_date = date.today().isoformat()
        updated_constants = [merge_terrain_colors(e, textures, minimaps, run_date) for e in existing["constants"]]
        args.output.write_text(format_game_constants(updated_constants), encoding="utf-8")
        terrains = [c for c in updated_constants if c.get("category") == "terrain"]
        print(f"\nWrote {args.output}")
        print(f"{'const':<13} {'texture':<8} {'previewColor (game)':<22} minimapColor")
        for c in terrains:
            print(
                f"  {entry_label(c):<24} {str(c.get('deTextureFile')):<8} "
                f"{str(c.get('previewColor')):<22} {c.get('minimapColor')}"
            )
        for field in ("previewColor", "minimapColor"):
            missing = [entry_label(c) for c in terrains if field not in c]
            if missing:
                print(f"No {field} resolved (left unchanged): {', '.join(missing)}")
        print("\nNext: run `npm run validate:reference` from the repo root and review the diff before committing.")
        return 0

    if args.terrain_table:
        return run_terrain_table(install_path, args.output, load_dat(), args.dry_run)

    if args.classes:
        return run_classes(install_path, args.output, load_dat(), args.dry_run)

    if args.storages:
        return run_storages(install_path, args.output, load_dat(), args.dry_run)

    if args.attributes:
        return run_attributes(install_path, args.output, args.dry_run)

    if args.roster:
        return run_roster(install_path, args.output, load_dat(), args.dry_run)

    def_matches = find_file(install_path, "random_map.def")
    if not def_matches:
        print(f"No random_map.def found under {install_path}. Is this really a DE install root?", file=sys.stderr)
        return 1
    def_path = def_matches[0]
    if len(def_matches) > 1:
        print(f"Note: {len(def_matches)} random_map.def files found; using {def_path}. Others: {def_matches[1:]}")

    def_map = parse_random_map_def(def_path.read_text(encoding="utf-8", errors="replace"))
    print(f"Parsed {len(def_map)} #const definitions from {def_path}")

    dat_extraction: DatExtraction | None = None
    if not args.ids_only:
        dat_matches = find_file(install_path, "empires2_x2_p1.dat")
        if not dat_matches:
            print("WARNING: empires2_x2_p1.dat not found — continuing with --ids-only behavior (constId only).", file=sys.stderr)
        else:
            try:
                dat_extraction = DatExtraction(dat_matches[0])
                print(f"Loaded {dat_matches[0]}")
            except Exception as exc:  # genieutils version mismatch, corrupt file, etc.
                print(f"WARNING: failed to parse {dat_matches[0]} ({exc}) — continuing with constId only.", file=sys.stderr)

    existing = json.loads(args.output.read_text(encoding="utf-8"))
    run_date = date.today().isoformat()

    resolved = 0
    unresolved: list[str] = []
    updated_constants = []
    for entry in existing["constants"]:
        name = entry["rmsConstant"]
        const_id = def_map.get(name) if name else None
        if const_id is None:
            # An unnamed terrain is not an unresolved one: random_map.def is
            # keyed by constant name and simply has no row to find. Its id is
            # already known from the community table, and everything this run
            # can add (texture, colours) is looked up by id anyway — so merge
            # on the existing id rather than skipping the entry and leaving
            # half the terrain table permanently colourless.
            fallback_id = entry.get("constId")
            if name is None and isinstance(fallback_id, int):
                updated_constants.append(
                    merge_entry(entry, fallback_id, dat_extraction, run_date, textures, id_from_def=False)
                )
                continue
            unresolved.append(entry_label(entry))
            updated_constants.append(entry)
            continue
        resolved += 1
        updated_constants.append(merge_entry(entry, const_id, dat_extraction, run_date, textures))

    args.output.write_text(format_game_constants(updated_constants), encoding="utf-8")

    print(f"\nResolved {resolved}/{len(existing['constants'])} constants against {def_path.name}.")
    if unresolved:
        print(f"Not found in random_map.def (left unchanged): {', '.join(unresolved)}")
    print(f"Wrote {args.output}")
    print("\nSanity-check a few well-known objects below before trusting resourceAmounts —")
    print("if these look wrong, RESOURCE_TYPE_INDEX at the top of this file needs fixing:")
    for name in ("GOLD", "STONE", "FORAGE", "SHEEP"):
        match = next((c for c in updated_constants if c["rmsConstant"] == name), None)
        if match:
            print(f"  {name}: constId={match.get('constId')} resourceAmounts={match.get('resourceAmounts')}")

    print("\nNext: run `npm run validate:reference` from the repo root and review the diff before committing.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
