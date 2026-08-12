"""Unit tests for the parts of extract_constants.py that don't need
genieutils-py or a real DE install: the random_map.def parser and the
JSON merge/formatting logic. (DatExtraction itself — the genieutils-backed
half — has no local install to test against; see README.md "Testing
status".) Stdlib-only (unittest), matching this being a standalone dev
tool with its own minimal dependency footprint.

Run: python -m unittest test_extract_constants.py -v
"""

import json
import unittest
from dataclasses import dataclass
from pathlib import Path

from extract_constants import (
    CLASS_CONST_BASE,
    ExtractedObject,
    ExtractedPlacement,
    ExtractedTerrain,
    build_class_entries,
    build_unit_lookup,
    class_constants,
    class_descriptive_name,
    clean_dat_filename,
    corpse_unit_ids,
    parse_display_strings,
    roster_descriptive_name,
    storage_note,
    derive_habitat,
    format_constant,
    format_game_constants,
    format_preview_color,
    format_resource_amounts,
    habitat_note,
    merge_entry,
    merge_terrain_colors,
    merge_terrain_table,
    object_constants,
    parse_jasc_palette,
    parse_random_map_def,
    parse_random_map_def_sections,
    strip_rms_comments,
    verify_class_offset,
)

REPO_GAME_CONSTANTS = Path(__file__).resolve().parents[2] / "reference" / "data" / "game-constants.json"


class TestStripComments(unittest.TestCase):
    def test_line_comment(self):
        self.assertEqual(strip_rms_comments("#const A 1 // trailing note"), "#const A 1 ")

    def test_block_comment_single_line(self):
        self.assertEqual(strip_rms_comments("#const A /* inline */ 1"), "#const A   1")

    def test_block_comment_spans_lines(self):
        text = "#const A 1\n/* this\nspans\nlines */\n#const B 2"
        self.assertEqual(strip_rms_comments(text), "#const A 1\n \n#const B 2")


class TestParseRandomMapDef(unittest.TestCase):
    def test_basic(self):
        text = "#const GOLD 66\n#const GRASS 0\n"
        self.assertEqual(parse_random_map_def(text), {"GOLD": 66, "GRASS": 0})

    def test_negative_value(self):
        self.assertEqual(parse_random_map_def("#const SOME_FLAG -1\n"), {"SOME_FLAG": -1})

    def test_ignores_expressions(self):
        # rnd(...) values are user-script territory, not ID definitions —
        # a real random_map.def should never contain these, but the
        # parser must not choke on or misparse one if it did.
        text = "#const POND_SIZE rnd(20,40)\n#const GOLD 66\n"
        self.assertEqual(parse_random_map_def(text), {"GOLD": 66})

    def test_ignores_commented_out_definitions(self):
        text = "// #const OLD_GOLD 12\n#const GOLD 66\n/* #const ALSO_OLD 5 */\n"
        self.assertEqual(parse_random_map_def(text), {"GOLD": 66})

    def test_later_definition_wins(self):
        text = "#const GOLD 1\n#const GOLD 66\n"
        self.assertEqual(parse_random_map_def(text), {"GOLD": 66})

    def test_ignores_unrelated_lines(self):
        text = "<PLAYER_SETUP>\nrandom_placement\n#const GOLD 66\nend_random\n"
        self.assertEqual(parse_random_map_def(text), {"GOLD": 66})


class TestFormatting(unittest.TestCase):
    def test_format_resource_amounts_orders_and_filters(self):
        # RESOURCE_KEY_ORDER is food/wood/gold/stone regardless of insertion order.
        self.assertEqual(format_resource_amounts({"stone": 350, "gold": 800}), '{ "gold": 800, "stone": 350 }')

    def test_format_constant_omits_absent_optional_keys(self):
        entry = {
            "constId": 0,
            "rmsConstant": "GRASS",
            "descriptiveName": "Grass 1",
            "category": "terrain",
            "deTextureFile": "g_grs00.slp",
            "verified": True,
            "notes": "ok",
        }
        line = format_constant(entry)
        self.assertNotIn("resourceAmounts", line)
        self.assertEqual(
            line,
            '{ "constId": 0, "rmsConstant": "GRASS", "descriptiveName": "Grass 1", '
            '"category": "terrain", "deTextureFile": "g_grs00.slp", "verified": true, "notes": "ok" }',
        )

    def test_format_constant_includes_resource_amounts_when_present(self):
        entry = {
            "constId": 66,
            "rmsConstant": "GOLD",
            "descriptiveName": "Gold Mine",
            "category": "object",
            "deTextureFile": None,
            "resourceAmounts": {"gold": 800},
            "verified": True,
            "notes": "ok",
        }
        self.assertIn('"resourceAmounts": { "gold": 800 }', format_constant(entry))

    def test_format_game_constants_round_trips_as_valid_json(self):
        import json

        entries = [
            {"constId": 0, "rmsConstant": "GRASS", "descriptiveName": "Grass 1", "category": "terrain", "deTextureFile": None, "verified": True, "notes": "ok"},
            {"constId": 66, "rmsConstant": "GOLD", "descriptiveName": "Gold Mine", "category": "object", "deTextureFile": None, "resourceAmounts": {"gold": 800}, "verified": True, "notes": "ok"},
        ]
        text = format_game_constants(entries)
        parsed = json.loads(text)
        self.assertEqual(parsed["constants"], entries)
        self.assertTrue(text.endswith("\n"))


class TestMergeEntry(unittest.TestCase):
    def test_ids_only_mode_sets_const_id_but_not_verified(self):
        # dat=None means resourceAmounts/deTextureFile are NOT re-checked
        # this run — only constId is real. Marking the whole entry
        # verified: true here would be a false claim (this is the bug a
        # real install run caught: GOLD's placeholder resourceAmounts got
        # relabeled verified: true without ever touching empires2_x2_p1.dat).
        entry = {
            "constId": None,
            "rmsConstant": "GRASS",
            "descriptiveName": "Grass 1",
            "category": "terrain",
            "deTextureFile": None,
            "verified": False,
            "notes": "old placeholder note",
        }
        updated = merge_entry(entry, const_id=0, dat=None, run_date="2026-07-26")
        self.assertEqual(updated["constId"], 0)
        self.assertFalse(updated["verified"])
        self.assertIn("confirmed via random_map.def", updated["notes"])
        self.assertIn("NOT re-verified this run", updated["notes"])
        self.assertIn("2026-07-26", updated["notes"])
        # ids-only mode must not fabricate a texture file
        self.assertIsNone(updated["deTextureFile"])

    def test_unnamed_terrain_keeps_its_community_id_source(self):
        # random_map.def is keyed by constant name, so the 53 DE terrains that
        # have no constant can never appear in it. They still take the merge
        # path (texture and colours are looked up by id, which is known), but
        # stamping idSource "extracted" on the id would claim a provenance
        # this run did not establish — the id came from the community table.
        entry = {
            "constId": 26,
            "rmsConstant": None,
            "descriptiveName": "Ice, Navigable",
            "category": "terrain",
            "deTextureFile": "g_ic2",
            "verified": False,
            "notes": "community-sourced",
        }
        updated = merge_entry(entry, const_id=26, dat=None, run_date="2026-08-07", id_from_def=False)
        self.assertEqual(updated["constId"], 26)
        self.assertNotIn("idSource", updated)
        self.assertIn("NOT re-confirmed", updated["notes"])

    def test_named_terrain_still_earns_extracted_provenance(self):
        # The other half of the pair above: without this, id_from_def could be
        # inverted and only the test above would notice.
        entry = {"constId": 32, "rmsConstant": "SNOW", "descriptiveName": "Snow", "category": "terrain", "verified": False}
        updated = merge_entry(entry, const_id=32, dat=None, run_date="2026-08-07")
        self.assertEqual(updated["idSource"], "extracted")
        self.assertIn("confirmed via random_map.def", updated["notes"])

    def test_ids_only_mode_preserves_prior_verified_true(self):
        # If an entry was already verified: true from a previous full
        # run, an ids-only re-run for a NEW constId shouldn't silently
        # downgrade it back to false.
        entry = {
            "constId": 0,
            "rmsConstant": "GRASS",
            "descriptiveName": "Grass 1",
            "category": "terrain",
            "deTextureFile": "g_grs00.slp",
            "verified": True,
            "notes": "previously fully verified",
        }
        updated = merge_entry(entry, const_id=0, dat=None, run_date="2026-07-26")
        self.assertTrue(updated["verified"])

    # `verified` is per-field, not "the dat was parsed at all". The test this
    # replaced was named test_full_run_sets_verified_true and asserted exactly
    # that: it handed merge_entry a FakeDat whose object() returned None — unit
    # NOT found in the dat — and required verified: True. That is how the first
    # real install run (2026-07-30) came to stamp verified: true on all 31
    # entries, including GRASS whose notes on the same line read "texture NOT
    # resolved". A test asserting the bug is worse than no test, so these six
    # pin each branch separately.

    @staticmethod
    def _dat(terrain=None, obj=None):
        class FakeDat:
            def terrain(self, const_id):
                return terrain

            def object(self, const_id):
                return obj

        return FakeDat()

    def test_terrain_verified_only_when_texture_resolves(self):
        entry = {"constId": None, "rmsConstant": "GRASS", "descriptiveName": "Grass 1", "category": "terrain", "deTextureFile": None, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=0, dat=self._dat(terrain=ExtractedTerrain(texture_file="g_grs00.slp")), run_date="2026-07-26")
        self.assertTrue(got["verified"])
        self.assertEqual(got["deTextureFile"], "g_grs00.slp")

    def test_terrain_unverified_when_texture_unresolved(self):
        entry = {"constId": None, "rmsConstant": "GRASS", "descriptiveName": "Grass 1", "category": "terrain", "deTextureFile": None, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=0, dat=self._dat(terrain=ExtractedTerrain(texture_file=None)), run_date="2026-07-26")
        self.assertFalse(got["verified"])
        self.assertIn("texture NOT resolved", got["notes"])
        self.assertIsNone(got["deTextureFile"])

    def test_object_verified_when_resources_found(self):
        entry = {"constId": None, "rmsConstant": "GOLD", "descriptiveName": "Gold Mine", "category": "object", "deTextureFile": None, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=66, dat=self._dat(obj=ExtractedObject(resource_amounts={"gold": 800.0})), run_date="2026-07-26")
        self.assertTrue(got["verified"])
        self.assertEqual(got["resourceAmounts"], {"gold": 800.0})

    def test_object_verified_when_legitimately_resourceless(self):
        # HOUSE is present in the dat and genuinely has no resource storage,
        # and claims none. That IS a confirmation, not a failed lookup.
        entry = {"constId": None, "rmsConstant": "HOUSE", "descriptiveName": "House", "category": "object", "deTextureFile": None, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=70, dat=self._dat(obj=ExtractedObject(resource_amounts={})), run_date="2026-07-26")
        self.assertTrue(got["verified"])
        self.assertIn("no resource storage", got["notes"])

    def test_object_unverified_when_dat_contradicts_a_claimed_amount(self):
        # The FISH / SHORE_FISH case from the first real run: dat reports no
        # resource storage while the entry claims 200 food. Carry the prior
        # value (fish really do yield food, so suspect the lookup), but do not
        # call it verified.
        entry = {"constId": None, "rmsConstant": "SHORE_FISH", "descriptiveName": "Shore Fish", "category": "object", "deTextureFile": None, "resourceAmounts": {"food": 200}, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=69, dat=self._dat(obj=ExtractedObject(resource_amounts={})), run_date="2026-07-26")
        self.assertFalse(got["verified"])
        self.assertIn("CONTRADICTION", got["notes"])
        self.assertEqual(got["resourceAmounts"], {"food": 200})

    def test_object_unverified_when_unit_id_absent_from_dat(self):
        entry = {"constId": None, "rmsConstant": "HOUSE", "descriptiveName": "House", "category": "object", "deTextureFile": None, "verified": False, "notes": "x"}
        got = merge_entry(entry, const_id=70, dat=self._dat(obj=None), run_date="2026-07-26")
        self.assertFalse(got["verified"])
        self.assertIn("NOT found", got["notes"])

    def test_does_not_mutate_input_entry(self):
        entry = {"constId": None, "rmsConstant": "GRASS", "descriptiveName": "Grass 1", "category": "terrain", "deTextureFile": None, "verified": False, "notes": "x"}
        merge_entry(entry, const_id=0, dat=None, run_date="2026-07-26")
        self.assertIsNone(entry["constId"])
        self.assertFalse(entry["verified"])


@dataclass
class FakeUnit:
    id: int
    label: str = ""


# TestBuildSlpLookup is gone with build_slp_lookup itself. It joined
# DatFile.graphics on a Terrain's `slp`, which crosses two unrelated id spaces
# and resolved for no terrain at all — see DatExtraction.terrain's docstring.
# Its tests all passed against stand-in objects, which is worth remembering:
# they verified the function did what it said, never that what it said was the
# right question. The texture name comes off the Terrain record's own `name_2`.
class TestCleanDatFilename(unittest.TestCase):
    def test_rejects_the_literal_none_placeholder(self):
        # DE's dat uses the 4-character string "None" as the filename of unused
        # records. The first real install run wrote deTextureFile: "None" for
        # ICE and LEAVES, and `npm run validate:reference` cannot catch it: the
        # schema types the field ["string", "null"] and "None" is a valid
        # string. It must never leave this function.
        for raw in ("None", "none", "NONE", "", "   ", None):
            self.assertIsNone(clean_dat_filename(raw), f"{raw!r} should be None")

    def test_keeps_a_real_name_and_strips_whitespace(self):
        self.assertEqual(clean_dat_filename("g_grs"), "g_grs")
        self.assertEqual(clean_dat_filename("  g_wtr  "), "g_wtr")

    def test_does_not_reject_a_name_merely_containing_none(self):
        # Guard against over-eager matching: substring, not the whole field.
        self.assertEqual(clean_dat_filename("g_none_stone"), "g_none_stone")


class TestBuildUnitLookup(unittest.TestCase):
    def test_skips_none_slots(self):
        # Regression test for the exact crash a real install run hit:
        # civ.units is list[Unit | None] (genieutils/civ.py), same sparse
        # shape as graphics above. The original version of this function
        # read u.id unconditionally and blew up on the first unused unit
        # slot with "'NoneType' object has no attribute 'id'".
        units = [None, FakeUnit(id=66), None, None, FakeUnit(id=102)]
        self.assertEqual(build_unit_lookup(units), {66: units[1], 102: units[4]})

    def test_all_none_yields_empty_dict(self):
        self.assertEqual(build_unit_lookup([None, None]), {})


class FakeColors:
    """Stands in for TextureExtraction / MinimapColorExtraction so these tests
    need neither Pillow, a palette, nor an AoE2 install. Both real classes
    expose the same one-method surface, keyed differently (texture name vs
    constId), which is why one fake covers both."""

    def __init__(self, colors):
        self.colors = colors

    def color(self, key):
        return self.colors.get(key)


class TestMergeTerrainColors(unittest.TestCase):
    GRASS = {
        "constId": 0,
        "rmsConstant": "GRASS",
        "category": "terrain",
        "deTextureFile": "g_grs",
        "verified": True,
        "notes": "constId 0 confirmed via random_map.def.",
    }

    def merge(self, entry, textures=None, minimaps=None, run_date="2026-08-05"):
        return merge_terrain_colors(
            entry,
            FakeColors({"g_grs": [129, 146, 63]} if textures is None else textures),
            FakeColors({0: [0, 169, 0]} if minimaps is None else minimaps),
            run_date,
        )

    def test_sets_both_colours_and_appends_to_notes(self):
        out = self.merge(self.GRASS)
        self.assertEqual(out["previewColor"], [129, 146, 63])
        self.assertEqual(out["minimapColor"], [0, 169, 0])
        self.assertTrue(out["notes"].startswith("constId 0 confirmed via random_map.def."))
        self.assertIn("previewColor [129, 146, 63]", out["notes"])
        self.assertIn("minimapColor [0, 169, 0]", out["notes"])

    def test_touches_no_other_field(self):
        out = self.merge(self.GRASS)
        for key in ("constId", "rmsConstant", "category", "deTextureFile", "verified"):
            self.assertEqual(out[key], self.GRASS[key])

    def test_is_idempotent_across_runs(self):
        """A re-run must REPLACE the previous colour sentence, not stack a
        second one. The first version of this function appended
        unconditionally, and two runs produced two identical sentences in
        `notes` — this is that defect, pinned."""
        once = self.merge(self.GRASS)
        twice = self.merge(once)
        # Count the sentence marker, not the field names: the sentence names
        # each field twice on purpose (once for its value, once in the caveat),
        # so counting "previewColor" would be 2 on a correct single note.
        self.assertEqual(twice["notes"].count("Colours: "), 1)
        self.assertEqual(twice["notes"], once["notes"])

    def test_replaces_a_stale_colour_rather_than_keeping_both(self):
        once = self.merge(self.GRASS)
        twice = self.merge(once, textures={"g_grs": [1, 2, 3]})
        self.assertEqual(twice["previewColor"], [1, 2, 3])
        self.assertIn("previewColor [1, 2, 3]", twice["notes"])
        self.assertNotIn("[129, 146, 63]", twice["notes"])

    def test_the_two_sources_fail_independently(self):
        """No palette must not cost us the texture colour, or vice versa — they
        come from different files and either can be missing on a given
        install."""
        no_palette = self.merge(self.GRASS, minimaps={})
        self.assertEqual(no_palette["previewColor"], [129, 146, 63])
        self.assertNotIn("minimapColor", no_palette)

        no_texture = self.merge(self.GRASS, textures={})
        self.assertEqual(no_texture["minimapColor"], [0, 169, 0])
        self.assertNotIn("previewColor", no_texture)

    def test_keeps_an_existing_colour_when_this_run_cannot_resolve_it(self):
        once = self.merge(self.GRASS)
        degraded = self.merge(once, textures={})
        self.assertEqual(degraded["previewColor"], [129, 146, 63])

    def test_leaves_an_unresolvable_terrain_completely_alone(self):
        entry = dict(self.GRASS, deTextureFile=None, constId=None)
        self.assertEqual(self.merge(entry), entry)

    def test_ignores_object_entries(self):
        entry = {"rmsConstant": "GOLD", "category": "object", "deTextureFile": "g_grs", "constId": 0}
        self.assertEqual(self.merge(entry), entry)

    def test_does_not_mutate_input_entry(self):
        entry = dict(self.GRASS)
        self.merge(entry)
        self.assertNotIn("previewColor", entry)


class TestParseJascPalette(unittest.TestCase):
    HEADER = "JASC-PAL\n0100\n3\n"

    def test_parses_entries(self):
        self.assertEqual(
            parse_jasc_palette(self.HEADER + "0 0 0\n255 255 255\n48 93 182\n"),
            [[0, 0, 0], [255, 255, 255], [48, 93, 182]],
        )

    def test_ignores_trailing_content_past_the_declared_count(self):
        parsed = parse_jasc_palette(self.HEADER + "1 1 1\n2 2 2\n3 3 3\n4 4 4\n")
        self.assertEqual(len(parsed), 3)

    def test_rejects_a_non_palette_file(self):
        with self.assertRaises(ValueError):
            parse_jasc_palette("RIFF....\n")

    def test_rejects_a_truncated_palette(self):
        """A short palette must not parse: it would silently turn every high
        index into a missing colour rather than an error."""
        with self.assertRaises(ValueError):
            parse_jasc_palette("JASC-PAL\n0100\n256\n0 0 0\n")


class TestFormatPreviewColor(unittest.TestCase):
    def test_renders_three_channels_on_one_line(self):
        self.assertEqual(format_preview_color([129, 146, 63]), "[129, 146, 63]")

    def test_appears_in_a_formatted_terrain_entry(self):
        entry = {
            "constId": 0,
            "rmsConstant": "GRASS",
            "category": "terrain",
            "deTextureFile": "g_grs",
            "previewColor": [129, 146, 63],
            "verified": True,
            "notes": "x",
        }
        text = format_constant(entry)
        self.assertIn('"previewColor": [129, 146, 63]', text)
        # Key order matters: the file is hand-formatted and a reordering would
        # rewrite every line of a real run's diff.
        self.assertLess(text.index("deTextureFile"), text.index("previewColor"))
        self.assertLess(text.index("previewColor"), text.index("verified"))
        json.loads(text)


class TestRoundTripAgainstRepoFile(unittest.TestCase):
    """Guards the thing that actually matters for a real run: re-formatting
    the CURRENT reference/data/game-constants.json (untouched — no entries
    resolved) must reproduce it byte-for-byte. If this breaks, a real
    extraction run would rewrite every unrelated line and bury the actual
    data diff in noise."""

    def test_byte_identical_when_nothing_changes(self):
        if not REPO_GAME_CONSTANTS.exists():
            self.skipTest(f"{REPO_GAME_CONSTANTS} not found (unexpected repo layout)")
        original = REPO_GAME_CONSTANTS.read_text(encoding="utf-8")
        data = json.loads(original)
        reformatted = format_game_constants(data["constants"])
        self.assertEqual(reformatted, original)


#: A miniature random_map.def carrying both traps the real file sets: a
#: commented-out `#const` that is shaped exactly like a section header, and
#: dashed decoration rules that carry no title and must not reset the section.
SAMPLE_DEF = """\
#const AI_FLAG 3

/*------------------------*/
/*         GAIA           */
/*------------------------*/
#const GOLD      66
#const DEER      65
/* #const ARCHER    4 */
#const WOLF      126

/* UNITS */
#const VILLAGER  83
#const OCEAN_FISH_CLASS  905

/* EXPORTED FROM THE DATABASE */
#const OYSTERS   2170
#const STRING_SOMETHING 21001

/* TERRAIN CONSTANTS */
#const GRASS     0
#const WATER     1
"""


class TestParseRandomMapDefSections(unittest.TestCase):
    def test_splits_on_section_headers(self):
        sections = parse_random_map_def_sections(SAMPLE_DEF)
        self.assertEqual(sections["GAIA"], [("GOLD", 66), ("DEER", 65), ("WOLF", 126)])
        self.assertEqual(sections["UNITS"], [("VILLAGER", 83), ("OCEAN_FISH_CLASS", 905)])
        self.assertEqual(sections["TERRAIN CONSTANTS"], [("GRASS", 0), ("WATER", 1)])

    def test_content_before_the_first_header_is_kept(self):
        # Dropping it would silently lose names rather than misfile them, which
        # is the harder failure to notice.
        self.assertEqual(parse_random_map_def_sections(SAMPLE_DEF)["(preamble)"], [("AI_FLAG", 3)])

    def test_commented_out_const_is_not_a_section_header(self):
        # The trap that cut the object namespace from 651 names to 69 while
        # every name it kept was still correct. ARCHER must not become a
        # section, and DEER must stay in GAIA rather than falling into one.
        sections = parse_random_map_def_sections(SAMPLE_DEF)
        self.assertNotIn("#const ARCHER    4", sections)
        self.assertEqual([title for title in sections if "ARCHER" in title], [])

    def test_commented_out_const_is_not_a_live_definition(self):
        names = [name for members in parse_random_map_def_sections(SAMPLE_DEF).values() for name, _ in members]
        self.assertNotIn("ARCHER", names)

    def test_dashed_rules_do_not_reset_the_section(self):
        self.assertNotIn("", parse_random_map_def_sections(SAMPLE_DEF))
        self.assertIn("GAIA", parse_random_map_def_sections(SAMPLE_DEF))


class TestObjectConstants(unittest.TestCase):
    def test_keeps_only_the_object_sections(self):
        objects = object_constants(SAMPLE_DEF)
        self.assertEqual(objects, {"GOLD": 66, "DEER": 65, "WOLF": 126, "VILLAGER": 83, "OYSTERS": 2170})

    def test_a_name_after_a_commented_out_const_stays_in_its_section(self):
        """The 651-to-69 defect, stated as the loss it actually causes.

        Mistaking `/* #const ARCHER 4 */` for a section header does not just
        invent a section — it moves every name BELOW it out of the object
        namespace, and the names that survive are all still correct, so the
        failure is quiet enough to ship.
        """
        self.assertIn("WOLF", object_constants(SAMPLE_DEF))

    def test_excludes_terrain_namespace(self):
        # The whole point of the split: GRASS is id 0 in the TERRAIN namespace
        # and would otherwise resolve against unit slot 0.
        self.assertNotIn("GRASS", object_constants(SAMPLE_DEF))

    def test_excludes_class_and_string_ids(self):
        objects = object_constants(SAMPLE_DEF)
        self.assertNotIn("OCEAN_FISH_CLASS", objects)
        self.assertNotIn("STRING_SOMETHING", objects)


#: Terrain flags shaped like the real table's four kinds, with the real ids so
#: a failure reads against the install. `Ice, Navigable` (26) is the one that
#: matters: hybrid but NOT water, and inside the fish restriction.
HABITAT_TERRAINS = {
    0: {"rmsConstant": "GRASS"},
    10: {"rmsConstant": "DIRT"},
    63: {"rmsConstant": "Rice Farm"},
    1: {"rmsConstant": "WATER", "isWater": True},
    22: {"rmsConstant": "DEEP_WATER", "isWater": True},
    23: {"rmsConstant": "MED_WATER", "isWater": True},
    57: {"rmsConstant": "DLC_WATER4", "isWater": True},
    26: {"rmsConstant": "Ice, Navigable", "isHybrid": True},
    54: {"rmsConstant": "DLC_MANGROVESHALLOW", "isHybrid": True},
    4: {"rmsConstant": "SHALLOW", "isWater": True, "isHybrid": True},
    2: {"rmsConstant": "BEACH", "isBeach": True},
    37: {"rmsConstant": "ICYSHORE", "isBeach": True},
}

#: Restriction 19's shape: open water plus navigable ice, no beach, no shallow.
FISH_ROW = [1, 22, 23, 57, 26]
#: Restrictions 13/3/15: water, shallows, beaches and the rice farms.
GREAT_FISH_ROW = [1, 22, 23, 57, 26, 4, 54, 2, 37, 63]
NO_SIDE = [-1, -1]
BESIDE_BEACH = [2, 35]


class TestDeriveHabitat(unittest.TestCase):
    def test_fish_row_is_water_not_amphibious(self):
        """The regression this function was rewritten for.

        The predicate-chain version classified restriction 19 as `amphibious`
        because ONE of its 15 terrains (26, navigable ice) carries `isHybrid`,
        which would have put every ordinary fish back on the shallows and
        undone the 2026-08-08 water/amphibious split.
        """
        fit = derive_habitat(FISH_ROW, NO_SIDE, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "water")
        self.assertEqual(fit.runner_up, "amphibious")
        self.assertLess(fit.mismatch, fit.runner_up_mismatch)

    def test_great_fish_row_is_amphibious(self):
        fit = derive_habitat(GREAT_FISH_ROW, NO_SIDE, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "amphibious")

    def test_water_class_is_open_water_exactly_and_excludes_shallows(self):
        """Pins the class DEFINITION, not just which class ranks first.

        Ranking tests alone survive a `water` that quietly includes the
        shallows — it still beats `amphibious` on the fish row, just by less —
        and a `water` that includes shallows is a fish standing on walkable
        ground, which is the whole thing the 2026-08-08 split established
        cannot happen. Asserting an EXACT fit against the open-water set is
        what makes the mismatch number load-bearing rather than decorative.
        """
        open_water = [1, 22, 23, 57]
        fit = derive_habitat(open_water, NO_SIDE, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "water")
        self.assertEqual(fit.mismatch, 0)

    def test_adding_a_shallow_to_an_open_water_row_stops_it_fitting_water_exactly(self):
        # The other direction of the same claim: SHALLOW is not in `water`, so
        # a row containing one cannot fit `water` perfectly.
        fit = derive_habitat([1, 22, 23, 57, 4], NO_SIDE, HABITAT_TERRAINS)
        self.assertGreater(fit.mismatch, 0)

    def test_side_terrain_over_a_water_row_is_shore(self):
        self.assertEqual(derive_habitat(FISH_ROW, BESIDE_BEACH, HABITAT_TERRAINS).habitat, "shore")

    def test_side_terrain_over_a_non_water_row_is_reported_not_applied(self):
        # The DOCK family (restriction 6): the same "must sit beside a beach"
        # requirement over an amphibious-shaped row, which no class expresses.
        fit = derive_habitat(GREAT_FISH_ROW, BESIDE_BEACH, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "amphibious")
        self.assertTrue(fit.side_terrain_unmodelled)

    def test_water_row_without_a_side_terrain_is_not_shore(self):
        self.assertFalse(derive_habitat(FISH_ROW, NO_SIDE, HABITAT_TERRAINS).side_terrain_unmodelled)

    def test_every_terrain_permitted_is_any(self):
        fit = derive_habitat(list(HABITAT_TERRAINS), NO_SIDE, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "any")
        self.assertEqual(fit.mismatch, 0)

    def test_dry_row_is_land(self):
        self.assertEqual(derive_habitat([0, 10, 63], NO_SIDE, HABITAT_TERRAINS).habitat, "land")

    def test_mismatch_reports_the_coarseness_rather_than_hiding_it(self):
        # A land row the class overshoots: the engine permits 2 of the 7
        # terrains `land` covers, so 5 differ and the answer says so.
        fit = derive_habitat([0, 10], NO_SIDE, HABITAT_TERRAINS)
        self.assertEqual(fit.habitat, "land")
        self.assertEqual(fit.mismatch, 5)

    def test_empty_row_is_unclassified(self):
        self.assertIsNone(derive_habitat([], NO_SIDE, HABITAT_TERRAINS))

    def test_row_of_unknown_terrains_is_unclassified(self):
        self.assertIsNone(derive_habitat([9001], NO_SIDE, HABITAT_TERRAINS))

    def test_a_tie_is_unclassified_rather_than_arbitrary(self):
        # A degenerate table with no hybrid and no beach makes `water` and
        # `amphibious` the same set, so nothing distinguishes them and picking
        # one would be a coin flip wearing a measurement's clothes.
        degenerate = {0: {"rmsConstant": "GRASS"}, 1: {"rmsConstant": "WATER", "isWater": True}}
        self.assertIsNone(derive_habitat([1], NO_SIDE, degenerate))

    def test_no_terrain_flags_is_unclassified(self):
        self.assertIsNone(derive_habitat(FISH_ROW, NO_SIDE, {}))


class TestHabitatNote(unittest.TestCase):
    FIT = None

    def setUp(self):
        self.fit = derive_habitat(FISH_ROW, NO_SIDE, HABITAT_TERRAINS)
        self.placement = ExtractedPlacement(restriction_id=19, allowed_terrains=FISH_ROW, side_terrains=NO_SIDE)

    def test_records_the_restriction_and_the_fit(self):
        note = habitat_note("constId 53 confirmed. Extracted 2026-07-30.", self.fit, self.placement, "2026-08-10")
        self.assertIn("terrain restriction 19", note)
        self.assertIn("'water'", note)
        self.assertIn("runner-up amphibious", note)

    def test_preserves_the_extraction_provenance(self):
        note = habitat_note("constId 53 confirmed. Extracted 2026-07-30.", self.fit, self.placement, "2026-08-10")
        self.assertTrue(note.startswith("constId 53 confirmed. Extracted 2026-07-30."))

    def test_is_idempotent(self):
        """Running the habitat pass twice must leave the file byte-identical.

        An appended clause would stack, and the second run's diff would be
        noise on every object entry — the same failure the round-trip test
        guards for the file as a whole.
        """
        once = habitat_note("constId 53 confirmed.", self.fit, self.placement, "2026-08-10")
        twice = habitat_note(once, self.fit, self.placement, "2026-08-10")
        self.assertEqual(once, twice)

    def test_handles_an_entry_with_no_prior_notes(self):
        note = habitat_note(None, self.fit, self.placement, "2026-08-10")
        self.assertIn("terrain restriction 19", note)

    def test_flags_an_unmodelled_side_terrain(self):
        fit = derive_habitat(GREAT_FISH_ROW, BESIDE_BEACH, HABITAT_TERRAINS)
        placement = ExtractedPlacement(restriction_id=6, allowed_terrains=GREAT_FISH_ROW, side_terrains=BESIDE_BEACH)
        self.assertIn("placement_side_terrain", habitat_note("", fit, placement, "2026-08-10"))


class TestMergeTerrainTable(unittest.TestCase):
    """The `--terrain-table` write path (CREATION_PLAN 4.7): the engine's own
    row goes into the file, and the coarse class is derived beside it."""

    def setUp(self):
        self.entry = {
            "constId": 53,
            "rmsConstant": "FISH",
            "descriptiveName": "Fish (generic)",
            "category": "object",
            "verified": True,
            "notes": "constId 53 confirmed. Extracted 2026-07-30.",
        }
        self.placement = ExtractedPlacement(restriction_id=19, allowed_terrains=FISH_ROW, side_terrains=NO_SIDE)
        self.fit = derive_habitat(FISH_ROW, NO_SIDE, HABITAT_TERRAINS)

    def test_writes_the_engine_row_not_only_the_class(self):
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertEqual(updated["terrainRestrictionId"], 19)
        self.assertEqual(updated["allowedTerrains"], FISH_ROW)
        self.assertEqual(updated["habitat"], "water")

    def test_writes_the_raw_table_even_when_no_class_fits(self):
        """The point of the raw fields, and the shape of the mistake they exist
        to survive: a row nothing classifies is exactly the row worth keeping.

        The habitat derivation returns None on a tie or an unrecognisable shape,
        and an implementation that returned the entry untouched in that case
        would drop the measurement precisely where the five-value vocabulary is
        known to be inadequate.
        """
        entry = dict(self.entry, habitat="water")
        updated = merge_terrain_table(entry, self.placement, None, "2026-08-10")
        self.assertEqual(updated["terrainRestrictionId"], 19)
        self.assertEqual(updated["allowedTerrains"], FISH_ROW)
        # …and the unclassifiable row leaves the existing reading alone rather
        # than clearing it: no class fitting is not evidence the old one is wrong.
        self.assertEqual(updated["habitat"], "water")
        self.assertEqual(updated["notes"], self.entry["notes"])

    def test_no_side_requirement_is_written_explicitly(self):
        """`[-1, -1]` is data, not a default worth omitting.

        Absence has to keep meaning "never extracted", which is a different
        claim from "measured, and the engine asks for nothing" — the same
        distinction isBeach's schema note makes for the terrain rows.
        """
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertEqual(updated["placementSideTerrain"], [-1, -1])

    def test_carries_a_real_side_requirement_through(self):
        placement = ExtractedPlacement(restriction_id=19, allowed_terrains=FISH_ROW, side_terrains=BESIDE_BEACH)
        fit = derive_habitat(FISH_ROW, BESIDE_BEACH, HABITAT_TERRAINS)
        updated = merge_terrain_table(self.entry, placement, fit, "2026-08-10")
        self.assertEqual(updated["placementSideTerrain"], [2, 35])
        self.assertEqual(updated["habitat"], "shore")

    def test_records_the_fit_in_notes_beside_the_field(self):
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertIn("runner-up amphibious", updated["notes"])
        self.assertTrue(updated["notes"].startswith("constId 53 confirmed."))

    def test_touches_no_other_field(self):
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertEqual(updated["constId"], 53)
        self.assertEqual(updated["verified"], True)
        self.assertEqual(updated["descriptiveName"], "Fish (generic)")

    def test_is_idempotent_across_runs(self):
        once = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        twice = merge_terrain_table(once, self.placement, self.fit, "2026-08-10")
        self.assertEqual(once, twice)

    def test_does_not_mutate_input_entry(self):
        merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertNotIn("terrainRestrictionId", self.entry)

    def test_does_not_alias_the_extracted_lists(self):
        # A shared list would let a later entry's edit reach back into this one,
        # and the run holds every entry until it writes.
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        self.assertIsNot(updated["allowedTerrains"], self.placement.allowed_terrains)

    def test_formats_in_key_order_and_round_trips(self):
        updated = merge_terrain_table(self.entry, self.placement, self.fit, "2026-08-10")
        text = format_constant(updated)
        json.loads(text)
        self.assertIn('"allowedTerrains": [1, 22, 23, 57, 26]', text)
        # The measurement precedes our reading of it, and both precede verified.
        self.assertLess(text.index("terrainRestrictionId"), text.index("allowedTerrains"))
        self.assertLess(text.index("placementSideTerrain"), text.index("habitat"))
        self.assertLess(text.index("habitat"), text.index("verified"))


if __name__ == "__main__":
    unittest.main()


class TestClassConstants(unittest.TestCase):
    def test_keeps_only_the_class_names(self):
        self.assertEqual(class_constants(SAMPLE_DEF), {"OCEAN_FISH_CLASS": 905})

    def test_partitions_cleanly_against_object_constants(self):
        # The two readers split one file and must not both claim a name.
        # `object_constants` drops the class names because they are not unit
        # ids; this one exists because they are not junk either.
        objects = object_constants(SAMPLE_DEF)
        classes = class_constants(SAMPLE_DEF)
        self.assertEqual(set(objects) & set(classes), set())

    def test_ignores_class_names_outside_the_object_sections(self):
        text = SAMPLE_DEF + "\n/* Attribute Constants */\n#const ATTR_SIZE_CLASS 163\n"
        self.assertNotIn("ATTR_SIZE_CLASS", class_constants(text))


class TestClassDescriptiveName(unittest.TestCase):
    def test_derives_from_the_constant(self):
        self.assertEqual(class_descriptive_name("OCEAN_FISH_CLASS", 5), "Ocean Fish class")

    def test_states_the_id_when_there_is_no_constant(self):
        # 32 of the 56 classes have no constant. Naming one from a glance at
        # its members would be invention, so it says what is known and no more.
        self.assertEqual(class_descriptive_name(None, 41), "Unit class 41")


class TestVerifyClassOffset(unittest.TestCase):
    """The offset is the one assumption every memberIds list rests on."""

    NAMED = {"OCEAN_FISH_CLASS": 905, "TREE_CLASS": 915}
    CLASSES = {5: [53, 457], 15: [349, 350]}
    OBJECTS = {"OCEAN_FISH": 53}

    def class_of(self, unit_id):
        return {53: 5, 457: 5, 349: 15, 104: 3}.get(unit_id)

    def test_a_matching_stem_confirms(self):
        confirmed, coincidental, contradicted = verify_class_offset(
            self.NAMED, self.CLASSES, self.OBJECTS, self.class_of
        )
        self.assertEqual(len(contradicted), 0)
        self.assertEqual(len(coincidental), 0)
        # OCEAN_FISH_CLASS by stem, TREE_CLASS by existence.
        self.assertEqual(len(confirmed), 2)

    def test_a_stem_that_means_something_else_is_a_coincidence_not_a_failure(self):
        """The MONASTERY finding, in miniature.

        `MONASTERY_CLASS` is 918, so it derives class 18 — the monk class. The
        object constant `MONASTERY` is the BUILDING, class 3. Both readings are
        right and they are about different things. Treating a shared name stem
        as proof would have aborted the first real run over a pun.
        """
        named = {**self.NAMED, "MONASTERY_CLASS": 918}
        classes = {**self.CLASSES, 18: [125, 775]}
        objects = {**self.OBJECTS, "MONASTERY": 104}
        confirmed, coincidental, contradicted = verify_class_offset(named, classes, objects, self.class_of)
        self.assertEqual(len(contradicted), 0)
        self.assertEqual(len(coincidental), 1)
        self.assertIn("MONASTERY_CLASS", coincidental[0])
        self.assertIn("same name, different thing", coincidental[0])

    def test_a_derived_class_no_unit_is_in_is_fatal(self):
        confirmed, coincidental, contradicted = verify_class_offset(
            {"WARSHIP_CLASS": 922}, self.CLASSES, {}, self.class_of
        )
        self.assertEqual(len(contradicted), 1)
        self.assertEqual(len(confirmed), 0)

    def test_a_shifted_offset_reads_as_contradiction_not_coincidence(self):
        """What separates the two, and why one bad row is tolerated and this is
        not: a wrong offset moves EVERY constant by the same amount, so the
        confirmations vanish together rather than one at a time."""
        shifted = {name: value + 7 for name, value in self.NAMED.items()}
        confirmed, coincidental, contradicted = verify_class_offset(
            shifted, self.CLASSES, self.OBJECTS, self.class_of
        )
        self.assertEqual(len(confirmed), 0)
        self.assertEqual(len(contradicted), 2)


class TestBuildClassEntries(unittest.TestCase):
    CLASSES = {-1: [900, 901], 5: [53, 457], 41: [1200]}
    NAMED = {"OCEAN_FISH_CLASS": 905}

    def entries(self):
        return build_class_entries(self.CLASSES, self.NAMED, "2026-08-10")

    def test_constid_is_the_class_plus_the_offset(self):
        by_class = {e["classId"]: e for e in self.entries()}
        self.assertEqual(by_class[5]["constId"], 5 + CLASS_CONST_BASE)
        self.assertEqual(by_class[41]["constId"], 41 + CLASS_CONST_BASE)

    def test_drops_the_no_class_bucket(self):
        # class -1 is the dat's "no class", 116 units on the real roster. It has
        # no constant to name it, so a row would mint constId 899 for something
        # no author can write.
        self.assertNotIn(-1, {e["classId"] for e in self.entries()})

    def test_an_unnamed_class_still_gets_a_row(self):
        by_class = {e["classId"]: e for e in self.entries()}
        self.assertIsNone(by_class[41]["rmsConstant"])
        self.assertEqual(by_class[41]["descriptiveName"], "Unit class 41")

    def test_members_are_the_whole_roster_not_only_known_objects(self):
        by_class = {e["classId"]: e for e in self.entries()}
        self.assertEqual(by_class[5]["memberIds"], [53, 457])

    def test_the_new_keys_survive_the_writer(self):
        """The `beachTerrain` defect, pre-empted.

        `format_constant` walks CONSTANT_KEY_ORDER and SILENTLY DROPS any key
        missing from it, which is how 131 beachTerrain values nearly went out
        of the file. Both new keys are checked through the real writer rather
        than trusted to have been added.
        """
        rendered = format_constant(self.entries()[0])
        self.assertIn('"classId"', rendered)
        self.assertIn('"memberIds"', rendered)
        self.assertIn('"category": "objectClass"', rendered)


class TestStorageNote(unittest.TestCase):
    """The note helper for `--storages`, including the retraction."""

    STORAGES = [(17, 200.0)]

    #: The sentence `merge_entry` wrote on the first real run, with the real em
    #: dash. FISH carried this form.
    CONTRADICTION = (
        "constId 53 confirmed via random_map.def; CONTRADICTION \u2014 empires2_x2_p1.dat reports no "
        "resource storage for unit 53, but this entry claims {'food': 200}; prior value carried through, "
        "still UNVERIFIED (suspect this script's Gaia-roster lookup before the placeholder). "
        "Extracted 2026-07-30 by tools/extract-constants (Phase 4.0)."
    )

    #: The SAME sentence as it actually sat in game-constants.json for SHORE_FISH:
    #: the em dash's UTF-8 bytes stored as three latin-1 characters. One round
    #: trip through the wrong encoding, one entry, and it defeated the first
    #: version of the retraction regex while its twin matched.
    CONTRADICTION_MOJIBAKE = CONTRADICTION.replace("\u2014", "\u00e2\u0080\u0094")

    def test_appends_the_raw_slots(self):
        note = storage_note("Existing text.", self.STORAGES, 53, "2026-08-10")
        self.assertIn("Existing text.", note)
        self.assertIn("raw slots [17]=200", note)

    def test_is_idempotent(self):
        once = storage_note("Existing text.", self.STORAGES, 53, "2026-08-10")
        twice = storage_note(once, self.STORAGES, 53, "2026-08-10")
        self.assertEqual(once, twice)
        self.assertEqual(twice.count("raw slots"), 1)

    def test_rewrites_the_slots_when_the_dat_changes(self):
        once = storage_note("Existing text.", self.STORAGES, 53, "2026-08-10")
        after = storage_note(once, [(17, 250.0)], 53, "2026-08-11")
        self.assertIn("[17]=250", after)
        self.assertNotIn("[17]=200", after)

    def test_retracts_the_contradiction(self):
        note = storage_note(self.CONTRADICTION, self.STORAGES, 53, "2026-08-10")
        # The FALSE CLAIM is what has to go, not the word. The replacement
        # deliberately still says "the earlier CONTRADICTION here was this
        # script's own gap", because a note that silently swaps one assertion
        # for its opposite teaches the next reader nothing.
        self.assertNotIn("reports no resource storage", note)
        self.assertNotIn("still UNVERIFIED", note)
        self.assertIn("CONFIRMED against empires2_x2_p1.dat", note)
        # The surrounding sentences survive — this replaces one clause, it does
        # not rewrite the note wholesale the way a full run does.
        self.assertIn("constId 53 confirmed via random_map.def", note)
        self.assertIn("Extracted 2026-07-30", note)

    def test_retracts_the_mojibake_form_too(self):
        note = storage_note(self.CONTRADICTION_MOJIBAKE, self.STORAGES, 69, "2026-08-10")
        self.assertNotIn("reports no resource storage", note)
        # And the corruption leaves with the sentence that carried it, which is
        # how the one bad character in the whole reference data got swept out.
        self.assertNotIn("\u00e2\u0080\u0094", note)

    def test_leaves_a_note_with_no_contradiction_alone(self):
        note = storage_note("Plain note.", self.STORAGES, 66, "2026-08-10")
        self.assertNotIn("CONFIRMED against", note)
        self.assertTrue(note.startswith("Plain note."))

    def test_handles_a_unit_with_no_storage_at_all(self):
        note = storage_note(None, [], 70, "2026-08-10")
        self.assertIn("raw slots none", note)


# ---------------------------------------------------------------------------
# Roster mode (CREATION_PLAN 4.10)
# ---------------------------------------------------------------------------


@dataclass
class FakeRosterUnit:
    """The four `Unit` fields the roster mode reads. Same stand-in idea as
    FakeUnit above, and the same caveat applies: these tests pin what the
    functions do, never that reading `dead_unit_id` was the right question —
    that part is measured against the real install, not here."""

    id: int
    name: str = ""
    language_dll_name: int = 0
    dead_unit_id: int = -1
    blood_unit_id: int = -1


class TestParseDisplayStrings(unittest.TestCase):
    SAMPLE = '\n'.join([
        '// a comment line DE ships in this file',
        '',
        '5400 "Gold Mine"',
        '  5072 "Fish (Perch)"  ',
        '5332 "Dolphin"',
        'not a string line at all',
        '9999 ""',
    ])

    def test_reads_id_and_text(self):
        strings = parse_display_strings(self.SAMPLE)
        self.assertEqual(strings[5400], "Gold Mine")
        self.assertEqual(strings[5072], "Fish (Perch)")

    def test_skips_comments_and_junk(self):
        strings = parse_display_strings(self.SAMPLE)
        self.assertEqual(len(strings), 4)

    def test_keeps_an_empty_string_as_an_entry(self):
        # Present but empty is a real state, and `roster_descriptive_name`
        # falls through it to Unit.name rather than naming a row "".
        self.assertEqual(parse_display_strings(self.SAMPLE)[9999], "")


class TestRosterDescriptiveName(unittest.TestCase):
    STRINGS = {5400: "Gold Mine", 9999: ""}

    def test_prefers_des_own_display_text(self):
        unit = FakeRosterUnit(id=66, name="GOLDM", language_dll_name=5400)
        self.assertEqual(roster_descriptive_name(unit, self.STRINGS), ("Gold Mine", "strings"))

    def test_falls_back_to_the_internal_code_verbatim(self):
        # Unit 1546 is the case CREATION_PLAN 4.10 was written about: no
        # display string, no RMS constant, and the dat's internal code is the
        # only name there is. It is written AS IS — paraphrasing it would be
        # thousands of claims nobody checked.
        unit = FakeRosterUnit(id=1546, name="PLACEHOLDER (NAVAL)")
        self.assertEqual(roster_descriptive_name(unit, self.STRINGS), ("PLACEHOLDER (NAVAL)", "unitName"))

    def test_an_empty_display_string_is_not_a_name(self):
        unit = FakeRosterUnit(id=7, name="MONKX_S_D", language_dll_name=9999)
        self.assertEqual(roster_descriptive_name(unit, self.STRINGS), ("MONKX_S_D", "unitName"))


class TestCorpseUnitIds(unittest.TestCase):
    def test_a_unit_something_dies_into_is_a_corpse(self):
        units = {
            10: FakeRosterUnit(id=10, name="DEERX", dead_unit_id=11),
            11: FakeRosterUnit(id=11, name="DEERX_D"),
        }
        self.assertEqual(corpse_unit_ids(units), {11})

    def test_blood_units_count_too(self):
        units = {20: FakeRosterUnit(id=20, blood_unit_id=21), 21: FakeRosterUnit(id=21)}
        self.assertEqual(corpse_unit_ids(units), {21})

    def test_minus_one_is_not_a_link(self):
        # -1 is the dat's "no such unit", and treating it as an id would mark
        # whatever happens to sit at that index.
        units = {30: FakeRosterUnit(id=30, dead_unit_id=-1, blood_unit_id=-1)}
        self.assertEqual(corpse_unit_ids(units), set())

    def test_a_dangling_link_names_nothing(self):
        # A referenced id with no live unit behind it must not enter the set:
        # the caller intersects rows against it, and a phantom id would be a
        # claim about a row that does not exist.
        units = {40: FakeRosterUnit(id=40, dead_unit_id=999)}
        self.assertEqual(corpse_unit_ids(units), set())
