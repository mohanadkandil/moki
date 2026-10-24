"""CAD brief: open tray derived from the electrical worker's saved board.

Millimetres, XY footprint centred at origin, +Z up, bottom at Z=0.
One monolithic part; wall/floor=2 mm, lateral board clearance=1 mm,
height=20 mm. Board thickness/outline come exclusively from pcb-geometry.json.
No purchased components, mounts, connectors or functional electronics claimed.
Primary tray.step; secondary tray.glb. Validate solid/bbox/collision from STEP.
"""
import json
from pathlib import Path
from build123d import Align, Box, Color, Pos

def gen_step():
    geometry = json.loads(Path(__file__).with_name('pcb-geometry.json').read_text())
    wall = floor = 2.0
    clearance = 1.0
    height = 20.0
    width = geometry['width'] + 2 * (clearance + wall)
    depth = geometry['height'] + 2 * (clearance + wall)
    outside = Box(width, depth, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    cavity = Pos(0, 0, floor) * Box(width - 2 * wall, depth - 2 * wall, height,
                                   align=(Align.CENTER, Align.CENTER, Align.MIN))
    tray = outside - cavity
    tray.label = 'pcb_clearance_fixture_tray'
    tray.color = Color(0.91, 0.75, 0.34)
    return tray
