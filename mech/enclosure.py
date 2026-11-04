#!/usr/bin/env python3
"""Printable enclosure from mech-handoff.json, as real B-rep (build123d).

tscircuit owns the electronics and the board facts. This file owns the body.

Usage: enclosure.py --job <dir>
Reads <dir>/mech-handoff.json.
Writes enclosure-base.stl, enclosure-lid.stl, enclosure.step and enclosure.json.
The last stdout line is a JSON stage receipt: {name, status, ms, note}.

Model frame: X/Y are the board frame (mm, board centre at the origin in generated boards) and
Z = 0 is the outside of the floor, so the enclosure is modelled in its assembled position.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from time import perf_counter

_t_start = perf_counter()
import build123d as bd  # noqa: E402
import numpy as np  # noqa: E402

IMPORT_MS = (perf_counter() - _t_start) * 1000

SCHEMA = "moki.enclosure/1"
FONT = Path(__file__).resolve().parent / "assets" / "IBMPlexMono-Regular.ttf"
MAX_SPAN_MM = 400.0

# Body rules. Everything printed or reported comes from these.
WALL = 2.0
FLOOR = 2.0
LID = 2.0
FIT = 0.3  # Board and modules to wall, and lid lip to wall, per side.
STANDOFF = 5.0
HEADROOM = 0.5  # Tallest body to the underside of the lid.
EDGE_CHAMFER = 0.6  # Bed-side edge, against elephant foot.
LIP_WALL = 1.4
LIP_MAX = 3.0
LIP_MIN = 1.5
LIP_PART_CLEARANCE = 0.3
STANDOFF_R_BOTTOM = 3.5
STANDOFF_R_TOP = 3.0
PILLAR_R = 3.0
PILLAR_GAP = 0.15  # Lid pillar to board top, so the seam closes before the pillar lands.
M3_CLEAR_R = 1.7
M3_PILOT_R = 1.3  # 2.6 mm pilot for an M3 self-tapping screw in PLA.
M3_PILOT_DEPTH = 12.0
HEAD_R = 3.0  # 6 mm seat for a 5.5 mm pan head.
HEAD_DEPTH = 2.5
USB_ABOVE_SEAM = 1.5  # Solid wall kept over the USB opening.
VENT_WIDTH = 2.0
VENT_MAX_HEIGHT = 12.0
VENT_PITCH = 5.0
VENT_MAX_COUNT = 8
VENT_CORNER_KEEP = 10.0
WELL_WALL = 1.5
WELL_GLASS_GAP = 0.5
WELL_SLOPES = (0.7, 0.5, 0.35, 0.2, 0.0)  # tan(viewing half angle), widest first.
TEXT_DEPTH = 0.5
PLA_G_PER_CM3 = 1.24
STL_TOLERANCE = 0.02
STL_ANGULAR = 0.2

ASSUMPTIONS = [
    "No physical print or test fit has happened. Every fit below is calculated, not measured.",
    "Module dimensions come from the catalog plus public seller data. Measure real parts before printing.",
    "Each socketed module stands on an 8.5 mm female socket plus its own 2.54 mm male header spacer.",
    "The KY-040 lies parallel to the carrier with its shaft pointing up. That needs straight header pins; a right-angle header would not plug into a vertical socket like this. Its single socket cannot take the push force, so tighten the bushing's panel nut onto the lid.",
    "Four M3 x 16 mm self-tapping screws go in through the floor, pass the standoffs and the board, and thread into the lid pillars. They hold the lid and the board together. The 3.4 mm clearance and 2.6 mm pilot holes need checking on your printer.",
    "The ESP32 uses a micro-USB connector centred on its short edge. USB-C clones may differ.",
    "The OLED active area's position on its PCB is estimated, because no seller drawing was found. The window has a 1.2 mm margin per side to allow for this.",
    "LED and LDR leads are long enough to bring the part up to its lid hole.",
    "Filament grams assume a solid print (100% infill), so they are an upper bound for a sliced print.",
    "PLA softens near 60 C. Nothing here is rated for heat, mains or outdoor use. USB 5 V and 3.3 V logic only.",
]


class EnclosureError(Exception):
    pass


@dataclass
class Rect:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    def grown(self, by: float) -> "Rect":
        return Rect(self.min_x - by, self.min_y - by, self.max_x + by, self.max_y + by)

    @property
    def w(self) -> float:
        return self.max_x - self.min_x

    @property
    def h(self) -> float:
        return self.max_y - self.min_y

    @property
    def cx(self) -> float:
        return (self.min_x + self.max_x) / 2

    @property
    def cy(self) -> float:
        return (self.min_y + self.max_y) / 2

    def overlaps(self, other: "Rect") -> bool:
        return self.min_x < other.max_x and other.min_x < self.max_x and self.min_y < other.max_y and other.min_y < self.max_y

    def as_dict(self) -> dict:
        return {"minX": rnd(self.min_x), "minY": rnd(self.min_y), "maxX": rnd(self.max_x), "maxY": rnd(self.max_y)}


@dataclass
class Model:
    base: bd.Solid
    lid: bd.Solid
    report: dict
    warnings: list = field(default_factory=list)


def rnd(value: float, digits: int = 3) -> float:
    return round(float(value), digits)


def check_number(value, what: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value) or abs(value) > MAX_SPAN_MM:
        raise EnclosureError(f"mech-handoff has an invalid {what}: {value!r}")
    return float(value)


def rect_from(bbox: dict, what: str) -> Rect:
    return Rect(*(check_number(bbox[key], what) for key in ("minX", "minY", "maxX", "maxY")))


def single_solid(shape, what: str) -> bd.Solid:
    """A printed part must be exactly one solid: a stray island would fall off the bed."""
    solids = shape.solids()
    if len(solids) != 1:
        raise EnclosureError(f"{what} came out as {len(solids)} solids, expected 1")
    return solids[0]


def rounded_prism(rect: Rect, radius: float, z0: float, z1: float) -> bd.Part:
    return bd.Pos(rect.cx, rect.cy, z0) * bd.extrude(bd.RectangleRounded(rect.w, rect.h, radius), amount=z1 - z0)


def board_outline_radius(board: dict) -> float:
    """Recognize our sampled, axis-aligned rounded rectangle. Unknown outlines keep
    the conservative legacy bounding envelope; never infer a smaller cavity."""
    points = board.get("outline", [])
    if len(points) < 12:
        return 0.0
    cx, cy = board["center"]["x"], board["center"]["y"]
    hw, hh = board["widthMm"] / 2, board["heightMm"] / 2
    on_top = [abs(p["x"] - cx) for p in points if abs(p["y"] - cy - hh) < 0.002]
    on_right = [abs(p["y"] - cy) for p in points if abs(p["x"] - cx - hw) < 0.002]
    if not on_top or not on_right:
        return 0.0
    radius = hw - max(on_top)
    if radius < 0.1 or abs(radius - (hh - max(on_right))) > 0.002:
        return 0.0
    for p in points:
        x, y = abs(p["x"] - cx), abs(p["y"] - cy)
        if x > hw + 0.002 or y > hh + 0.002:
            return 0.0
        if x > hw - radius and y > hh - radius:
            if abs(math.hypot(x - hw + radius, y - hh + radius) - radius) > 0.002:
                return 0.0
    return radius


def upright_cylinder(x: float, y: float, radius: float, z0: float, z1: float) -> bd.Solid:
    return bd.Pos(x, y, z0) * bd.Cylinder(radius, z1 - z0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))


WALL_AXES = {
    "x_pos": ((1.0, 0.0), (0.0, 1.0)),
    "x_neg": ((-1.0, 0.0), (0.0, -1.0)),
    "y_pos": ((0.0, 1.0), (-1.0, 0.0)),
    "y_neg": ((0.0, -1.0), (1.0, 0.0)),
}


def wall_plane(face: str, along: float, z: float, outer: Rect, inward: float) -> bd.Plane:
    """Plane on a wall, seen from outside: x runs to the viewer's right, y up, normal outward.

    `along` is the board X (y walls) or Y (x walls) of the point. The origin sits `inward` behind the outer face.
    """
    (nx, ny), (rx, ry) = WALL_AXES[face]
    if face == "x_pos":
        origin = (outer.max_x - inward, along, z)
    elif face == "x_neg":
        origin = (outer.min_x + inward, along, z)
    elif face == "y_pos":
        origin = (along, outer.max_y - inward, z)
    else:
        origin = (along, outer.min_y + inward, z)
    return bd.Plane(origin=origin, x_dir=(rx, ry, 0), z_dir=(nx, ny, 0))


def wall_slot(face: str, along: float, z: float, width: float, height: float, outer: Rect, depth: float) -> bd.Part:
    """A through-wall tool with rounded ends: printable with no support, since the top arches over."""
    plane = wall_plane(face, along, z, outer, depth)
    length, across = (width, height) if width >= height else (height, width)
    profile = bd.SlotOverall(length, across, rotation=0 if width >= height else 90)
    return bd.extrude(plane * profile, amount=depth + 1.0)


def well_section(aperture: dict, width: float, height: float, z: float) -> bd.Sketch:
    place = bd.Pos(aperture["center"]["x"], aperture["center"]["y"], z) * bd.Rot(Z=aperture["rotationDeg"])
    return place * bd.Rectangle(width, height)


def rotated_rect(aperture: dict, width: float, height: float) -> Rect:
    theta = math.radians(aperture["rotationDeg"])
    half_x = (abs(math.cos(theta)) * width + abs(math.sin(theta)) * height) / 2
    half_y = (abs(math.sin(theta)) * width + abs(math.cos(theta)) * height) / 2
    x, y = aperture["center"]["x"], aperture["center"]["y"]
    return Rect(x - half_x, y - half_y, x + half_x, y + half_y)


def choose_well_slope(aperture, window_w, window_h, z_rim, seam, lid_top, board_top, parts, others, holes, cavity, warnings):
    """Widest viewing angle whose funnel misses every neighbour."""
    part_id = aperture["part"]
    for slope in WELL_SLOPES:
        clear = True
        at_top = lid_top - z_rim
        top_rect = rotated_rect(aperture, window_w + 2 * slope * at_top, window_h + 2 * slope * at_top)
        seam_rect = rotated_rect(aperture, window_w + 2 * (slope * (seam - z_rim) + WELL_WALL), window_h + 2 * (slope * (seam - z_rim) + WELL_WALL))
        if seam_rect.min_x < cavity.min_x or seam_rect.max_x > cavity.max_x or seam_rect.min_y < cavity.min_y or seam_rect.max_y > cavity.max_y:
            clear = False
        for part in parts:
            if part["id"] == part_id or part["stack"]["raisedToLid"]:
                continue
            top = board_top + part["stack"]["topMm"]
            if top <= z_rim:
                continue
            at = min(top, seam) - z_rim
            outer = rotated_rect(aperture, window_w + 2 * (slope * at + WELL_WALL), window_h + 2 * (slope * at + WELL_WALL))
            if outer.overlaps(rect_from(part["bbox"], "part bbox")):
                clear = False
        for other in others:
            if other["id"] != aperture["id"] and top_rect.overlaps(rotated_rect(other, other["widthMm"] + 2, other["heightMm"] + 2)):
                clear = False
        for hole in holes:
            if seam_rect.overlaps(Rect(hole["x"] - PILLAR_R, hole["y"] - PILLAR_R, hole["x"] + PILLAR_R, hole["y"] + PILLAR_R)):
                clear = False
        if clear:
            return slope
    warnings.append(f"{part_id}: no room for a display well, so the opening is a straight tunnel that may hit a neighbour. Check it.")
    return 0.0


def build_enclosure(handoff: dict) -> Model:
    if handoff.get("schema") != "moki.mech-handoff/1":
        raise EnclosureError(f"Unexpected handoff schema: {handoff.get('schema')!r}")
    board = handoff["board"]
    parts = handoff["parts"]
    apertures = handoff["apertures"]
    warnings = list(handoff.get("warnings", []))
    thickness = check_number(board["thicknessMm"], "board thickness")
    board_rect = Rect(
        check_number(board["center"]["x"], "board centre") - check_number(board["widthMm"], "board width") / 2,
        check_number(board["center"]["y"], "board centre") - check_number(board["heightMm"], "board height") / 2,
        board["center"]["x"] + board["widthMm"] / 2,
        board["center"]["y"] + board["heightMm"] / 2,
    )
    holes = board["holes"]
    for hole in holes:
        check_number(hole["x"], "hole x")
        check_number(hole["y"], "hole y")

    # Plan view: the cavity holds the board and anything that overhangs it, such as a USB shell.
    envelope = Rect(board_rect.min_x, board_rect.min_y, board_rect.max_x, board_rect.max_y)
    for part in parts:
        bbox = rect_from(part["bbox"], "part bbox")
        envelope = Rect(min(envelope.min_x, bbox.min_x), min(envelope.min_y, bbox.min_y), max(envelope.max_x, bbox.max_x), max(envelope.max_y, bbox.max_y))
    cavity = envelope.grown(FIT)
    outer = cavity.grown(WALL)
    # Offset the board's rounded outline through the fit clearance and the wall.
    # Module/USB overhangs retain the existing expanded bounding envelope.
    board_radius = board_outline_radius(board)
    # Radius zero is a real square PCB corner. Offset it by FIT as well;
    # the legacy 1 mm cavity fillet consumed most of the advertised clearance.
    inner_radius = board_radius + FIT
    outer_radius = inner_radius + WALL


    # Height: floor, standoff, board, tallest body, headroom. USB keeps a bar of wall above its opening.
    board_bottom = FLOOR + STANDOFF
    board_top = board_bottom + thickness
    tallest = max((p for p in parts if not p["stack"]["raisedToLid"]), key=lambda p: p["stack"]["topMm"], default=None)
    above_board = (tallest["stack"]["topMm"] if tallest else 0.0) + HEADROOM
    for aperture in apertures:
        if aperture["face"] != "z_pos":
            above_board = max(above_board, aperture["zMm"] + aperture["heightMm"] / 2 + USB_ABOVE_SEAM)
    seam = board_top + above_board
    lid_top = seam + LID

    # Lip: as deep as the parts beside the walls allow, because the screws, not the lip, hold the lid on.
    lip_band = FIT + LIP_WALL + 0.2
    lip_depth = LIP_MAX
    lip_limiter = None
    inner_band = cavity.grown(-lip_band)
    for part in parts:
        bbox = rect_from(part["bbox"], "part bbox")
        beside_wall = bbox.min_x < inner_band.min_x or bbox.max_x > inner_band.max_x or bbox.min_y < inner_band.min_y or bbox.max_y > inner_band.max_y
        if beside_wall and not part["stack"]["raisedToLid"]:
            room = seam - (board_top + part["stack"]["topMm"]) - LIP_PART_CLEARANCE
            if room < lip_depth:
                lip_depth, lip_limiter = room, part["id"]
    if lip_depth < LIP_MIN:
        warnings.append(f"Only {lip_depth:.2f} mm of lip fits beside {lip_limiter}, so the lid uses a {LIP_MIN} mm lip. Check the clearance at that part.")
        lip_depth = LIP_MIN

    # ---- Base -------------------------------------------------------------------------------
    shell = rounded_prism(outer, outer_radius, 0.0, seam)
    shell = bd.chamfer(shell.edges().group_by(bd.Axis.Z)[0], EDGE_CHAMFER)
    shell = shell - rounded_prism(cavity, inner_radius, FLOOR, seam + 1.0)

    # A board without M3 holes still needs something to rest on. Those posts are solid and nothing fastens to them.
    supports = holes or [
        {"x": x, "y": y} for x in (board_rect.min_x + 4, board_rect.max_x - 4) for y in (board_rect.min_y + 4, board_rect.max_y - 4)
    ]
    standoffs = [
        bd.Pos(h["x"], h["y"], FLOOR - 0.2) * bd.Cone(STANDOFF_R_BOTTOM, STANDOFF_R_TOP, STANDOFF + 0.2, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
        for h in supports
    ]
    if not holes:
        warnings.append("The lid is friction-fit only and the board is not fastened, because the board has no M3 holes.")
    base = shell.fuse(*standoffs) if standoffs else shell

    base_cuts = []
    for hole in holes:
        base_cuts.append(upright_cylinder(hole["x"], hole["y"], M3_CLEAR_R, -1.0, board_bottom + 1.0))
        base_cuts.append(upright_cylinder(hole["x"], hole["y"], HEAD_R, -1.0, HEAD_DEPTH))

    aperture_rows = []
    wall_faces_used = set()
    lip_cuts = []
    for aperture in [a for a in apertures if a["face"] != "z_pos"]:
        face = aperture["face"]
        wall_faces_used.add(face)
        z = board_top + check_number(aperture["zMm"], "aperture height")
        along = aperture["center"]["y"] if face.startswith("x") else aperture["center"]["x"]
        # The opening also clears the lid lip where it passes behind this wall.
        reach = WALL + FIT + LIP_WALL + 0.5
        tool = wall_slot(face, along, z, aperture["widthMm"], aperture["heightMm"], outer, reach)
        base_cuts.append(tool)
        lip_cuts.append(tool)
        (nx, ny), _ = WALL_AXES[face]
        wall_x = outer.max_x if nx > 0 else outer.min_x if nx < 0 else along
        wall_y = outer.max_y if ny > 0 else outer.min_y if ny < 0 else along
        mouth_gap = abs((aperture["center"]["x"] - wall_x) * nx + (aperture["center"]["y"] - wall_y) * ny) - WALL
        if aperture["purpose"] == "usb" and mouth_gap > 3.0:
            warnings.append(f"{aperture['part']}: the USB connector sits {mouth_gap:.1f} mm behind the wall, so a short plug may not reach it.")
        aperture_rows.append({
            "id": aperture["id"], "part": aperture["part"], "purpose": aperture["purpose"], "onPart": "base", "face": face, "shape": aperture["shape"],
            "position": {"x": rnd(aperture["center"]["x"]), "y": rnd(aperture["center"]["y"]), "z": rnd(z)},
            "sizeMm": {"width": aperture["widthMm"], "height": aperture["heightMm"]}, "note": aperture["note"],
        })

    # Vents: vertical slots with arched ends, on the two walls beside the connector wall.
    used_axis_x = any(f.startswith("x") for f in wall_faces_used)
    vent_faces = ("y_pos", "y_neg") if used_axis_x else ("x_pos", "x_neg")
    vent_low = board_top + 0.5  # Above the board edge, so the carrier does not block the slot.
    vent_high = seam - lip_depth - 1.0
    vent_height = min(VENT_MAX_HEIGHT, vent_high - vent_low)
    vent_z = (vent_low + vent_high) / 2
    if vent_height >= 4.0:
        for face in vent_faces:
            on_x_wall = face.startswith("x")
            low, high = (outer.min_y, outer.max_y) if on_x_wall else (outer.min_x, outer.max_x)
            room = (high - low) - 2 * VENT_CORNER_KEEP
            count = min(VENT_MAX_COUNT, int(room // VENT_PITCH))
            mid = (low + high) / 2
            for index in range(count):
                along = mid + (index - (count - 1) / 2) * VENT_PITCH
                base_cuts.append(wall_slot(face, along, vent_z, VENT_WIDTH, vent_height, outer, WALL))
            if count:
                aperture_rows.append({
                    "id": f"vent-{face}", "part": "enclosure", "purpose": "vent", "onPart": "base", "face": face, "shape": "slot-row",
                    "position": {"x": rnd(outer.max_x if face == "x_pos" else outer.min_x if face == "x_neg" else mid), "y": rnd(outer.max_y if face == "y_pos" else outer.min_y if face == "y_neg" else mid), "z": rnd(vent_z)},
                    "sizeMm": {"width": VENT_WIDTH, "height": rnd(vent_height)}, "count": count, "pitchMm": VENT_PITCH,
                    "note": "Passive air exchange. Not thermally simulated.",
                })
    else:
        warnings.append("The base wall is too low for vent slots.")

    # Identifying mark on the back wall, away from the USB opening and the vents.
    # Just the name: engraving the full content id took 3.6 s more per job, measured. The id stays on the board silkscreen.
    label = ((handoff.get("source", {}).get("label") or "moki").split() or ["moki"])[0][:12]
    back = {"y_neg": "y_pos", "y_pos": "y_neg", "x_neg": "x_pos", "x_pos": "x_neg"}.get(next(iter(sorted(wall_faces_used)), "y_neg"))
    mark = None
    try:
        span = outer.h if back.startswith("x") else outer.w
        mid_along = outer.cy if back.startswith("x") else outer.cx
        text = bd.Text(label, font_size=7.0, font_path=str(FONT))
        width = text.bounding_box().size.X
        if width > span - 16:
            text = bd.Text(label, font_size=7.0 * (span - 16) / width, font_path=str(FONT))
        plane = wall_plane(back, mid_along, FLOOR + (seam - lip_depth - FLOOR) / 2, outer, TEXT_DEPTH)
        base_cuts.append(bd.extrude(plane * text, amount=TEXT_DEPTH + 0.5))
        mark = {"text": label, "face": back, "depthMm": TEXT_DEPTH, "font": "IBM Plex Mono Regular"}
    except Exception as error:  # A mark is never worth failing a job for.
        warnings.append(f"The wall mark was skipped: {error}")

    base = base.cut(*base_cuts)

    # ---- Lid --------------------------------------------------------------------------------
    plate = rounded_prism(outer, outer_radius, seam, lid_top)
    plate = bd.chamfer(plate.edges().group_by(bd.Axis.Z)[-1], EDGE_CHAMFER)
    lip_outer = cavity.grown(-FIT)
    lip = rounded_prism(lip_outer, max(inner_radius - FIT, 0.3), seam - lip_depth, seam + 0.2) - rounded_prism(lip_outer.grown(-LIP_WALL), 0.3, seam - lip_depth - 1.0, seam + 1.0)
    pillars = [upright_cylinder(h["x"], h["y"], PILLAR_R, board_top + PILLAR_GAP, seam + 0.2) for h in holes]
    additions = [lip, *pillars]
    lid_cuts = list(lip_cuts)

    for hole in holes:
        pilot_top = min(board_top + PILLAR_GAP + M3_PILOT_DEPTH, lid_top - 0.8)
        lid_cuts.append(upright_cylinder(hole["x"], hole["y"], M3_PILOT_R, board_top, pilot_top))
        for part in parts:
            bbox = rect_from(part["bbox"], "part bbox")
            if bbox.grown(PILLAR_R + FIT).overlaps(Rect(hole["x"], hole["y"], hole["x"], hole["y"])) and bbox.grown(FIT).overlaps(Rect(hole["x"] - PILLAR_R, hole["y"] - PILLAR_R, hole["x"] + PILLAR_R, hole["y"] + PILLAR_R)):
                warnings.append(f"The lid pillar at ({hole['x']}, {hole['y']}) may touch {part['id']}.")

    lid_apertures = [a for a in apertures if a["face"] == "z_pos"]
    for aperture in lid_apertures:
        x, y = aperture["center"]["x"], aperture["center"]["y"]
        check_number(x, "aperture x")
        check_number(y, "aperture y")
        if not (cavity.min_x < x < cavity.max_x and cavity.min_y < y < cavity.max_y):
            warnings.append(f"{aperture['id']} is outside the lid.")
            continue
        row = {
            "id": aperture["id"], "part": aperture["part"], "purpose": aperture["purpose"], "onPart": "lid", "face": "z_pos", "shape": aperture["shape"],
            "position": {"x": rnd(x), "y": rnd(y), "z": rnd(lid_top)}, "sizeMm": {"width": aperture["widthMm"], "height": aperture["heightMm"]},
            "rotationDeg": aperture["rotationDeg"], "note": aperture["note"],
        }
        if aperture["shape"] == "circle":
            lid_cuts.append(upright_cylinder(x, y, aperture["widthMm"] / 2, seam - 1.0, lid_top + 1.0))
        elif aperture["shape"] == "grid":
            grid = aperture["grid"]
            theta = math.radians(aperture["rotationDeg"])
            for column in range(grid["columns"]):
                for line in range(grid["rows"]):
                    lx = (column - (grid["columns"] - 1) / 2) * grid["pitchMm"]
                    ly = (line - (grid["rows"] - 1) / 2) * grid["pitchMm"]
                    lid_cuts.append(upright_cylinder(x + lx * math.cos(theta) - ly * math.sin(theta), y + lx * math.sin(theta) + ly * math.cos(theta), grid["holeMm"] / 2, seam - 1.0, lid_top + 1.0))
            row["grid"] = grid
        else:
            # A display sits well below the lid. A funnel brings the opening down to the glass, which
            # gives a real viewing angle. It tapers inward as it prints upward, so it needs no support.
            w, h = aperture["widthMm"], aperture["heightMm"]
            z_rim = board_top + aperture["zMm"] + WELL_GLASS_GAP
            if seam - z_rim > 1.0:
                slope = choose_well_slope(aperture, w, h, z_rim, seam, lid_top, board_top, parts, lid_apertures, holes, cavity, warnings)
                size = lambda base_size, at_z: base_size + 2 * slope * (at_z - z_rim)  # noqa: E731
                wall_body = bd.loft([
                    well_section(aperture, size(w, z_rim) + 2 * WELL_WALL, size(h, z_rim) + 2 * WELL_WALL, z_rim),
                    well_section(aperture, size(w, seam + 0.2) + 2 * WELL_WALL, size(h, seam + 0.2) + 2 * WELL_WALL, seam + 0.2),
                ])
                additions.append(wall_body)
                lid_cuts.append(bd.loft([
                    well_section(aperture, size(w, z_rim - 0.5), size(h, z_rim - 0.5), z_rim - 0.5),
                    well_section(aperture, size(w, lid_top + 0.5), size(h, lid_top + 0.5), lid_top + 0.5),
                ]))
                row["well"] = {
                    "rimZ": rnd(z_rim), "glassGapMm": WELL_GLASS_GAP, "viewingHalfAngleDeg": rnd(math.degrees(math.atan(slope)), 1),
                    "topOpeningMm": {"width": rnd(size(w, lid_top)), "height": rnd(size(h, lid_top))},
                }
            else:
                lid_cuts.append(bd.extrude(well_section(aperture, w, h, seam - 1.0), amount=LID + 2.0))
        aperture_rows.append(row)

    lid = plate.fuse(*additions).cut(*lid_cuts)

    base = single_solid(base, "The base")
    lid = single_solid(lid, "The lid")
    base.label = "enclosure-base"
    lid.label = "enclosure-lid"

    # Encoder protrusion, so the knob question has a number.
    protrusions = []
    for part in parts:
        through = part["stack"].get("throughLid")
        if through:
            shaft = board_top + through["shaftTopMm"] - lid_top
            bushing = board_top + through["bushingTopMm"] - lid_top
            protrusions.append({"part": part["id"], "shaftAboveLidMm": rnd(shaft), "bushingAboveLidMm": rnd(bushing)})
            if shaft < 8:
                warnings.append(f"{part['id']}: only {shaft:.1f} mm of shaft stands above the lid, which is short for a knob.")
            if bushing < 2:
                warnings.append(f"{part['id']}: only {bushing:.1f} mm of bushing stands above the lid, which is too little for the panel nut.")

    screw_length = 16 if board_top + PILLAR_GAP + 8 - HEAD_DEPTH <= 16 else 20
    assumptions = [
        text.replace("M3 x 16 mm", f"M3 x {screw_length} mm") if text.startswith("Four M3") else text
        for text in ASSUMPTIONS
        if holes or not text.startswith("Four M3")
    ]
    report = {
        "dimensions": {
            "outerMm": {"x": rnd(outer.w), "y": rnd(outer.h), "z": rnd(lid_top)},
            "cavityMm": {"x": rnd(cavity.w), "y": rnd(cavity.h), "z": rnd(seam - FLOOR)},
            "wallMm": WALL, "floorMm": FLOOR, "lidMm": LID, "cornerRadiusMm": outer_radius, "boardCornerRadiusMm": board_radius,
            "seamZ": rnd(seam), "lipDepthMm": rnd(lip_depth), "lipWallMm": LIP_WALL,
            "boardBottomZ": rnd(board_bottom), "boardTopZ": rnd(board_top), "standoffMm": STANDOFF,
            "boardRect": board_rect.as_dict(), "outerRect": outer.as_dict(), "cavityRect": cavity.as_dict(),
        },
        "clearancesMm": {
            "fit": FIT, "headroomAboveTallestBody": HEADROOM, "lidPillarToBoard": PILLAR_GAP,
            "boardToWall": {"xNeg": rnd(board_rect.min_x - cavity.min_x), "xPos": rnd(cavity.max_x - board_rect.max_x), "yNeg": rnd(board_rect.min_y - cavity.min_y), "yPos": rnd(cavity.max_y - board_rect.max_y)},
        },
        "stack": {
            "tallestPart": tallest["id"] if tallest else None,
            "parts": [{"id": p["id"], "module": p["module"], "mount": p["stack"]["mount"], "socketMm": p["stack"]["socketMm"], "spacerMm": p["stack"]["spacerMm"], "pcbMm": p["stack"]["pcbMm"], "componentsMm": p["stack"]["componentsMm"], "topAboveBoardMm": p["stack"]["topMm"], "raisedToLid": p["stack"]["raisedToLid"], "confidence": p["confidence"]} for p in parts],
            "throughLid": protrusions,
        },
        "fastening": {
            "type": "M3 through-bolt" if holes else "friction-fit lip only", "count": len(holes), "screw": f"M3 x {screw_length} mm self-tapping, pan head" if holes else None, "holes": holes,
            "standoff": {"heightMm": STANDOFF, "diameterBottomMm": 2 * STANDOFF_R_BOTTOM, "diameterTopMm": 2 * STANDOFF_R_TOP, "clearanceHoleMm": 2 * M3_CLEAR_R, "headSeatMm": {"diameter": 2 * HEAD_R, "depth": HEAD_DEPTH}},
            "lidPillar": {"diameterMm": 2 * PILLAR_R, "pilotHoleMm": 2 * M3_PILOT_R, "pilotDepthMm": M3_PILOT_DEPTH},
        },
        "apertures": aperture_rows,
        "mark": mark,
        "assumptions": assumptions,
        "printOrientation": {
            "base": "Floor on the bed, opening up, as exported.",
            "lid": "Outer face on the bed, pillars up, as exported.",
            "supports": "None expected: wall openings have arched tops, and the display well and pillars rise from the bed side. Not confirmed by a slicer.",
            "lidExportTransform": {"note": "Assembled (x, y, z) = (x_stl, -y_stl, totalHeight - z_stl).", "totalHeightMm": rnd(lid_top)},
        },
    }
    return Model(base=base, lid=lid, report=report, warnings=warnings)


def check_stl(path: Path) -> dict:
    """Edge-manifold check of a binary STL. Vertices weld only on exact float32 equality, so nothing is repaired."""
    raw = path.read_bytes()
    count = int.from_bytes(raw[80:84], "little")
    if len(raw) != 84 + 50 * count:
        raise EnclosureError(f"{path.name} is not a valid binary STL")
    record = np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    triangles = np.frombuffer(raw, record, count=count, offset=84)["v"]
    _, inverse = np.unique(triangles.reshape(-1, 3), axis=0, return_inverse=True)
    index = inverse.reshape(-1, 3)
    degenerate = int(np.sum((index[:, 0] == index[:, 1]) | (index[:, 1] == index[:, 2]) | (index[:, 0] == index[:, 2])))
    edges = np.concatenate([index[:, [0, 1]], index[:, [1, 2]], index[:, [2, 0]]])
    directed, directed_counts = np.unique(edges, axis=0, return_counts=True)
    undirected, counts = np.unique(np.sort(edges, axis=1), axis=0, return_counts=True)
    # A closed, consistently wound mesh uses each undirected edge exactly twice, once per direction.
    repeated_direction = int(np.sum(directed_counts > 1))
    vertices = int(index.max()) + 1 if count else 0
    edge_count = len(undirected)
    a, b, c = triangles[:, 0].astype(np.float64), triangles[:, 1].astype(np.float64), triangles[:, 2].astype(np.float64)
    volume = float(np.sum(np.einsum("ij,ij->i", a, np.cross(b, c))) / 6.0)
    return {
        "triangles": count, "vertices": vertices, "edges": edge_count,
        "boundaryEdges": int(np.sum(counts == 1)), "nonManifoldEdges": int(np.sum(counts > 2)),
        "windingConflictEdges": repeated_direction, "degenerateTriangles": degenerate,
        "eulerCharacteristic": vertices - edge_count + count, "signedVolumeMm3": rnd(volume, 1),
        "watertight": bool(np.all(counts == 2) and repeated_direction == 0 and degenerate == 0 and volume > 0),
    }


def block_solid(block: dict, board_top: float, lift: float = 0.0) -> bd.Solid:
    z0, z1 = board_top + block["z0"] + lift, board_top + block["z1"] + lift
    if block["shape"] == "cylinder":
        return upright_cylinder(block["x"], block["y"], block["w"] / 2, z0, z1)
    return bd.Pos(block["x"], block["y"], z0) * bd.Rot(Z=block["rotationDeg"]) * bd.Box(block["w"], block["h"], z1 - z0, align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))


def intersection_volume(a, b) -> float:
    try:
        common = a.intersect(b)
    except Exception:
        return 0.0
    if common is None:
        return 0.0
    if isinstance(common, (list, tuple)):
        return sum(item.volume for item in common)
    return common.volume


def find_interference(model: Model, handoff: dict) -> list:
    """Every placeholder module block and the board against both printed parts. Slow, so tests and evidence call it, not jobs."""
    dims = model.report["dimensions"]
    board_top = dims["boardTopZ"]
    findings = []
    # Lifted parts are placed on their leads, so their position is the assembler's choice, not a fixed fit.
    fixed = [(part["id"], block) for part in handoff["parts"] if not part["stack"]["raisedToLid"] for block in part["blocks"]]
    for part_id, block in fixed:
        solid = block_solid(block, board_top)
        for name, body in (("base", model.base), ("lid", model.lid)):
            volume = intersection_volume(body, solid)
            if volume > 1e-3:
                findings.append({"part": part_id, "block": block["label"], "against": name, "volumeMm3": rnd(volume)})
    return findings


def part_is_valid(part) -> bool:
    value = part.is_valid
    return bool(value() if callable(value) else value)


def run(job: Path) -> dict:
    t_total = perf_counter()
    handoff = json.loads((job / "mech-handoff.json").read_text())
    timing = {"importMs": rnd(IMPORT_MS, 1)}

    started = perf_counter()
    model = build_enclosure(handoff)
    timing["modelMs"] = rnd((perf_counter() - started) * 1000, 1)

    started = perf_counter()
    base, lid = model.base, model.lid
    base_valid, lid_valid = part_is_valid(base), part_is_valid(lid)
    base_volume, lid_volume = base.volume, lid.volume
    timing["brepCheckMs"] = rnd((perf_counter() - started) * 1000, 1)

    started = perf_counter()
    total_height = model.report["dimensions"]["outerMm"]["z"]
    lid_print = bd.Pos(0, 0, total_height) * bd.Rot(X=180) * lid
    bd.export_stl(base, str(job / "enclosure-base.stl"), tolerance=STL_TOLERANCE, angular_tolerance=STL_ANGULAR, ascii_format=False)
    bd.export_stl(lid_print, str(job / "enclosure-lid.stl"), tolerance=STL_TOLERANCE, angular_tolerance=STL_ANGULAR, ascii_format=False)
    timing["stlMs"] = rnd((perf_counter() - started) * 1000, 1)

    started = perf_counter()
    assembly = bd.Compound(label="moki-enclosure", children=[base, lid])
    bd.export_step(assembly, str(job / "enclosure.step"))
    timing["stepMs"] = rnd((perf_counter() - started) * 1000, 1)

    started = perf_counter()
    base_mesh = check_stl(job / "enclosure-base.stl")
    lid_mesh = check_stl(job / "enclosure-lid.stl")
    reopened = bd.import_step(str(job / "enclosure.step"))
    step_solids = reopened.solids()
    step_ok = len(step_solids) == 2 and all(part_is_valid(s) for s in step_solids)
    step_volume = sum(s.volume for s in step_solids)
    timing["validateMs"] = rnd((perf_counter() - started) * 1000, 1)

    volume_mm3 = base_volume + lid_volume
    failures = []
    if not base_valid:
        failures.append("the base is not a valid solid")
    if not lid_valid:
        failures.append("the lid is not a valid solid")
    if not base_mesh["watertight"]:
        failures.append("enclosure-base.stl is not watertight")
    if not lid_mesh["watertight"]:
        failures.append("enclosure-lid.stl is not watertight")
    if not step_ok:
        failures.append("enclosure.step did not reopen as two valid solids")

    timing["totalMs"] = rnd((perf_counter() - _t_start) * 1000, 1)
    timing["excludingImportMs"] = rnd((perf_counter() - t_total) * 1000, 1)
    result = {
        "schema": SCHEMA,
        "engine": {"name": "build123d", "version": bd.__version__, "kernel": "OpenCascade (cadquery-ocp-novtk)", "fallback": False},
        "source": handoff.get("source", {}),
        "units": "mm",
        "frame": "X and Y are the board frame. Z = 0 is the outside of the floor. Dimensions describe the assembled position.",
        **model.report,
        "material": {"name": "PLA", "densityGPerCm3": PLA_G_PER_CM3},
        "estimate": {
            "baseVolumeCm3": rnd(base_volume / 1000), "lidVolumeCm3": rnd(lid_volume / 1000), "volumeCm3": rnd(volume_mm3 / 1000),
            "filamentG": rnd(volume_mm3 / 1000 * PLA_G_PER_CM3, 1), "basis": "Solid volume at 100% infill: an upper bound.",
        },
        "validation": {
            "base": {"isValid": base_valid, "stl": base_mesh}, "lid": {"isValid": lid_valid, "stl": lid_mesh},
            "step": {"reopened": True, "solids": len(step_solids), "allValid": step_ok, "volumeCm3": rnd(step_volume / 1000)},
            "failures": failures,
        },
        "physicalPrint": False,
        "warnings": model.warnings,
        "timing": timing,
    }
    (job / "enclosure.json").write_text(json.dumps(result, indent=2) + "\n")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the printable enclosure from mech-handoff.json.")
    parser.add_argument("--job", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = run(args.job.resolve())
    except Exception as error:  # The caller records the reason and falls back to the baseline.
        message = f"{type(error).__name__}: {error}"
        print(message, file=sys.stderr)
        print(json.dumps({"name": "enclosure", "status": "failed", "ms": rnd((perf_counter() - _t_start) * 1000, 1), "note": message}))
        return 1
    failures = result["validation"]["failures"]
    timing = result["timing"]
    note = f"build123d {result['engine']['version']}: import {timing['importMs']:.0f} ms, model {timing['modelMs']:.0f} ms, total {timing['totalMs']:.0f} ms"
    if failures:
        note += "; " + "; ".join(failures)
    print(json.dumps({"name": "enclosure", "status": "failed" if failures else "done", "ms": timing["totalMs"], "note": note}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
