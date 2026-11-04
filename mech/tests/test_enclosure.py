"""Run: <venv>/bin/python -m unittest discover -s mech/tests -v

The geometry is probed at points, so a test fails if an opening moves, not just if a mesh breaks.
"""
import copy
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import enclosure as mech  # noqa: E402
import build123d as bd  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
TEMPLATES = ("focus-timer", "light-lamp", "temp-monitor")


def load(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.mech-handoff.json").read_text())


def inside(solid, x, y, z) -> bool:
    return solid.is_inside(bd.Vector(x, y, z))


def aperture(handoff: dict, purpose: str) -> dict:
    return next(a for a in handoff["apertures"] if a["purpose"] == purpose)


def rotated_board(handoff: dict) -> dict:
    """The same board turned 90 degrees, so USB faces another wall."""
    out = copy.deepcopy(handoff)
    turn = lambda p: {"x": -p["y"], "y": p["x"]}  # noqa: E731
    board = out["board"]
    board["widthMm"], board["heightMm"] = board["heightMm"], board["widthMm"]
    board["holes"] = [{**turn(h), "diameterMm": h["diameterMm"]} for h in board["holes"]]
    for part in out["parts"]:
        part["center"] = turn(part["center"])
        box = part["bbox"]
        part["bbox"] = {"minX": -box["maxY"], "maxX": -box["minY"], "minY": box["minX"], "maxY": box["maxX"]}
        part["rotationDeg"] = (part["rotationDeg"] + 90) % 360
        for block in part["blocks"]:
            block.update(turn(block))
            block["rotationDeg"] = (block["rotationDeg"] + 90) % 360
    next_face = {"y_neg": "x_pos", "x_pos": "y_pos", "y_pos": "x_neg", "x_neg": "y_neg", "z_pos": "z_pos"}
    for item in out["apertures"]:
        item["center"] = turn(item["center"])
        item["face"] = next_face[item["face"]]
        item["rotationDeg"] = (item["rotationDeg"] + 90) % 360
    return out


class RoundedOutlineGeometry(unittest.TestCase):
    def test_square_board_preserves_fit_at_the_corner(self):
        h = load("focus-timer")
        model = mech.build_enclosure(h)
        dims = model.report["dimensions"]
        self.assertEqual(dims["boardCornerRadiusMm"], 0)
        self.assertAlmostEqual(dims["cornerRadiusMm"], mech.FIT + mech.WALL)
        hw, hh = h["board"]["widthMm"] / 2, h["board"]["heightMm"] / 2
        self.assertFalse(inside(model.base, hw + mech.FIT * .7, hh + mech.FIT * .7, dims["boardTopZ"] + .1))
        self.assertTrue(mech.part_is_valid(model.base))
        self.assertTrue(mech.part_is_valid(model.lid))

    def test_board_corner_profile_is_offset_into_the_cavity_and_shell(self):
        h = load("focus-timer")
        board = h["board"]
        hw, hh, radius = board["widthMm"] / 2, board["heightMm"] / 2, 3.0
        board["outline"] = [
            {"x": cx + radius * math.cos(math.radians(start + i * 7.5)),
             "y": cy + radius * math.sin(math.radians(start + i * 7.5))}
            for cx, cy, start in [(hw-radius,hh-radius,0),(-hw+radius,hh-radius,90),(-hw+radius,-hh+radius,180),(hw-radius,-hh+radius,270)] for i in range(13)
        ]
        self.assertAlmostEqual(mech.board_outline_radius(board), radius)
        model = mech.build_enclosure(h)
        dims = model.report["dimensions"]
        self.assertAlmostEqual(dims["cornerRadiusMm"], radius + mech.FIT + mech.WALL)
        self.assertAlmostEqual(dims["boardCornerRadiusMm"], radius)
        for p in board["outline"]:
            self.assertFalse(inside(model.base,p["x"],p["y"],dims["boardTopZ"] + .1), "sampled PCB edge clears rounded cavity")
        self.assertTrue(mech.part_is_valid(model.base))
        self.assertTrue(mech.part_is_valid(model.lid))


class FocusTimerGeometry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.handoff = load("focus-timer")
        cls.model = mech.build_enclosure(cls.handoff)
        cls.dims = cls.model.report["dimensions"]

    def test_parts_are_valid_single_solids(self):
        self.assertTrue(mech.part_is_valid(self.model.base))
        self.assertTrue(mech.part_is_valid(self.model.lid))
        self.assertEqual(len(self.model.base.solids()), 1)
        self.assertEqual(len(self.model.lid.solids()), 1)

    def test_wall_floor_and_lid_are_two_millimetres(self):
        outer, cavity = self.dims["outerRect"], self.dims["cavityRect"]
        self.assertAlmostEqual(cavity["minX"] - outer["minX"], 2.0)
        self.assertAlmostEqual(outer["maxY"] - cavity["maxY"], 2.0)
        z = self.dims["boardTopZ"] - 1
        # A y that misses the vent row on the x_neg wall.
        y = outer["minY"] + 6
        self.assertTrue(inside(self.model.base, outer["minX"] + 1, y, z))
        self.assertFalse(inside(self.model.base, cavity["minX"] + 0.05, y, z))
        self.assertTrue(inside(self.model.base, 0, 0, 1.0))
        self.assertFalse(inside(self.model.base, 0, 0, 2.05))
        self.assertTrue(inside(self.model.lid, 0, 0, self.dims["seamZ"] + 1))

    def test_usb_opening_is_in_the_wall_it_faces(self):
        usb = aperture(self.handoff, "usb")
        self.assertEqual(usb["face"], "y_neg")
        outer = self.dims["outerRect"]
        z = self.dims["boardTopZ"] + usb["zMm"]
        wall_y = outer["minY"] + 1
        self.assertFalse(inside(self.model.base, usb["center"]["x"], wall_y, z), "open at the centre")
        self.assertTrue(inside(self.model.base, usb["center"]["x"] + usb["widthMm"] / 2 + 1, wall_y, z), "closed beside it")
        self.assertTrue(inside(self.model.base, usb["center"]["x"], wall_y, z + usb["heightMm"] / 2 + 0.7), "closed above it")
        self.assertTrue(inside(self.model.base, usb["center"]["x"], outer["maxY"] - 1, z), "the far wall stays solid")

    def test_usb_opening_clears_the_connector(self):
        usb_block = next(b for p in self.handoff["parts"] for b in p["blocks"] if b["label"] == "micro-usb")
        usb = aperture(self.handoff, "usb")
        self.assertLess(abs(usb_block["x"] - usb["center"]["x"]), 0.01)
        block_mid = (usb_block["z0"] + usb_block["z1"]) / 2
        self.assertLess(abs(block_mid - usb["zMm"]), 0.01)
        self.assertLess(usb_block["w"], usb["widthMm"])
        self.assertLess(usb_block["z1"] - usb_block["z0"], usb["heightMm"])

    def test_lid_openings_sit_over_their_parts(self):
        z = self.dims["seamZ"] + 1
        display = aperture(self.handoff, "display-active-area")
        cx, cy = display["center"]["x"], display["center"]["y"]
        self.assertFalse(inside(self.model.lid, cx, cy, z))
        self.assertFalse(inside(self.model.lid, cx + display["activeAreaMm"]["w"] / 2, cy + display["activeAreaMm"]["h"] / 2, z), "the whole active area is open")
        self.assertTrue(inside(self.model.lid, cx, cy + 20, z), "the plate is solid past the window")
        encoder = aperture(self.handoff, "encoder-shaft")
        ex, ey = encoder["center"]["x"], encoder["center"]["y"]
        self.assertFalse(inside(self.model.lid, ex, ey, z))
        self.assertFalse(inside(self.model.lid, ex + 3.6, ey, z))
        self.assertTrue(inside(self.model.lid, ex + 4.2, ey, z))
        shaft = next(b for p in self.handoff["parts"] for b in p["blocks"] if b["label"] == "encoder shaft")
        self.assertLess(math.hypot(shaft["x"] - ex, shaft["y"] - ey), 0.01, "the hole is on the shaft axis")

    def test_display_well_reaches_down_to_the_glass(self):
        display = aperture(self.handoff, "display-active-area")
        row = next(r for r in self.model.report["apertures"] if r["id"] == display["id"])
        self.assertAlmostEqual(row["well"]["rimZ"], self.dims["boardTopZ"] + display["zMm"] + mech.WELL_GLASS_GAP, places=2)
        self.assertGreater(row["well"]["viewingHalfAngleDeg"], 0)
        z = row["well"]["rimZ"] + 0.1
        half = display["widthMm"] / 2
        self.assertTrue(inside(self.model.lid, display["center"]["x"] + half + 0.8, display["center"]["y"], z), "well wall")
        self.assertFalse(inside(self.model.lid, display["center"]["x"], display["center"]["y"], z), "open centre")

    def test_screw_path_runs_through_standoff_and_into_the_pillar(self):
        for hole in self.handoff["board"]["holes"]:
            x, y = hole["x"], hole["y"]
            self.assertFalse(inside(self.model.base, x, y, 1.0), "head seat")
            self.assertFalse(inside(self.model.base, x, y, self.dims["boardBottomZ"] - 1), "clearance bore")
            self.assertTrue(inside(self.model.base, x + 2.5, y, self.dims["boardBottomZ"] - 1), "standoff wall")
            self.assertFalse(inside(self.model.base, x + 2.5, y, 1.0), "head seat diameter")
            pillar_z = self.dims["boardTopZ"] + 3
            self.assertFalse(inside(self.model.lid, x, y, pillar_z), "pilot hole")
            self.assertTrue(inside(self.model.lid, x + 2.0, y, pillar_z), "pillar wall")

    def test_lid_lip_does_not_block_the_usb_opening(self):
        usb = aperture(self.handoff, "usb")
        cavity = self.dims["cavityRect"]
        # A height where the lip and the top of the USB opening overlap.
        lip_bottom = self.dims["seamZ"] - self.dims["lipDepthMm"]
        usb_top = self.dims["boardTopZ"] + usb["zMm"] + usb["heightMm"] / 2
        self.assertGreater(usb_top, lip_bottom, "this board's USB opening reaches the lip")
        lip_z = (lip_bottom + usb_top) / 2
        lip_y = cavity["minY"] + mech.FIT + mech.LIP_WALL / 2
        self.assertFalse(inside(self.model.lid, usb["center"]["x"], lip_y, lip_z), "notched at the USB")
        self.assertTrue(inside(self.model.lid, usb["center"]["x"] + 15, lip_y, lip_z), "lip present elsewhere")

    def test_base_and_lid_do_not_overlap(self):
        self.assertLess(mech.intersection_volume(self.model.base, self.model.lid), 1e-3)

    def test_no_module_block_collides_with_the_body(self):
        self.assertEqual(mech.find_interference(self.model, self.handoff), [])

    def test_the_tallest_body_clears_the_lid(self):
        tallest = max(p["stack"]["topMm"] for p in self.handoff["parts"] if not p["stack"]["raisedToLid"])
        self.assertGreaterEqual(self.dims["seamZ"] - (self.dims["boardTopZ"] + tallest), mech.HEADROOM - 1e-6)

    def test_a_cheating_block_is_caught(self):
        """The collision check itself must be able to fail."""
        broken = copy.deepcopy(self.handoff)
        broken["parts"][0]["blocks"].append({"shape": "box", "color": "metal", "label": "too tall", "x": 0, "y": 0, "w": 5, "h": 5, "z0": 0, "z1": 60, "rotationDeg": 0})
        findings = mech.find_interference(self.model, broken)
        self.assertTrue(any(f["block"] == "too tall" and f["against"] == "lid" for f in findings))


class AllTemplates(unittest.TestCase):
    def test_every_template_exports_watertight_and_reopens(self):
        for name in TEMPLATES:
            with self.subTest(name), tempfile.TemporaryDirectory() as tmp:
                job = Path(tmp)
                (job / "mech-handoff.json").write_text(json.dumps(load(name)))
                result = mech.run(job)
                self.assertEqual(result["validation"]["failures"], [])
                for part in ("base", "lid"):
                    self.assertTrue(result["validation"][part]["isValid"])
                    stl = result["validation"][part]["stl"]
                    self.assertEqual(stl["boundaryEdges"], 0)
                    self.assertEqual(stl["nonManifoldEdges"], 0)
                    self.assertTrue(stl["watertight"])
                    self.assertTrue((job / f"enclosure-{part}.stl").stat().st_size > 1000)
                step = result["validation"]["step"]
                self.assertEqual(step["solids"], 2)
                self.assertTrue(step["allValid"])
                self.assertAlmostEqual(step["volumeCm3"], result["estimate"]["volumeCm3"], delta=0.01)
                self.assertGreater(result["estimate"]["filamentG"], 1)

    def test_every_template_has_no_collisions(self):
        for name in TEMPLATES:
            with self.subTest(name):
                handoff = load(name)
                model = mech.build_enclosure(handoff)
                self.assertEqual(mech.find_interference(model, handoff), [])

    def test_the_same_handoff_gives_identical_meshes(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            for tmp in (a, b):
                (Path(tmp) / "mech-handoff.json").write_text(json.dumps(load("light-lamp")))
                mech.run(Path(tmp))
            for name in ("enclosure-base.stl", "enclosure-lid.stl"):
                self.assertEqual((Path(a) / name).read_bytes(), (Path(b) / name).read_bytes(), name)


class OtherBoards(unittest.TestCase):
    def test_a_rotated_board_moves_the_usb_opening_to_the_new_wall(self):
        handoff = rotated_board(load("focus-timer"))
        model = mech.build_enclosure(handoff)
        self.assertTrue(mech.part_is_valid(model.base))
        self.assertTrue(mech.part_is_valid(model.lid))
        usb = aperture(handoff, "usb")
        self.assertEqual(usb["face"], "x_pos")
        dims = model.report["dimensions"]
        wall_x = dims["outerRect"]["maxX"] - 1
        z = dims["boardTopZ"] + usb["zMm"]
        self.assertFalse(inside(model.base, wall_x, usb["center"]["y"], z))
        self.assertTrue(inside(model.base, wall_x, usb["center"]["y"] + usb["widthMm"] / 2 + 1, z))
        faces = {r["face"] for r in model.report["apertures"] if r["purpose"] == "vent"}
        self.assertEqual(faces, {"y_pos", "y_neg"})
        self.assertEqual(mech.find_interference(model, handoff), [])

    def test_a_board_with_no_holes_still_rests_on_posts_and_says_so(self):
        handoff = load("light-lamp")
        handoff["board"]["holes"] = []
        model = mech.build_enclosure(handoff)
        self.assertTrue(mech.part_is_valid(model.base))
        self.assertTrue(any("friction-fit" in w for w in model.warnings))
        self.assertEqual(model.report["fastening"]["count"], 0)
        self.assertFalse(any(a.startswith("Four M3") for a in model.report["assumptions"]))

    def test_invalid_numbers_are_refused(self):
        for bad in (float("nan"), float("inf"), 1e9, "12"):
            handoff = load("light-lamp")
            handoff["board"]["widthMm"] = bad
            with self.assertRaises(mech.EnclosureError):
                mech.build_enclosure(handoff)

    def test_a_wrong_schema_is_refused(self):
        with self.assertRaises(mech.EnclosureError):
            mech.build_enclosure({"schema": "something/else"})


if __name__ == "__main__":
    unittest.main()
