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
    ExtractedObject,
    ExtractedTerrain,
    build_unit_lookup,
    clean_dat_filename,
    format_constant,
    format_game_constants,
    format_preview_color,
    format_resource_amounts,
    merge_entry,
    merge_terrain_colors,
    parse_jasc_palette,
    parse_random_map_def,
    strip_rms_comments,
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


if __name__ == "__main__":
    unittest.main()
