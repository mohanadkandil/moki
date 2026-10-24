"""Create a proposed physical board outline, then measure the saved KiCad file.

This file does not create a schematic, circuit, components, or routed electronics.
"""
import hashlib
import json
from pathlib import Path
import sys
import pcbnew

root = Path(sys.argv[1])
plan = json.loads((root / 'electrical-plan.json').read_text())
width, height = float(plan['width']), float(plan['height'])
assert 10 <= width <= 200 and 10 <= height <= 150
assert len(plan['holes']) <= 8
board = pcbnew.BOARD()
board.GetDesignSettings().SetBoardThickness(pcbnew.FromMM(1.6))
for start, end in [((0, 0), (width, 0)), ((width, 0), (width, height)),
                   ((width, height), (0, height)), ((0, height), (0, 0))]:
    edge = pcbnew.PCB_SHAPE()
    edge.SetShape(pcbnew.SHAPE_T_SEGMENT)
    edge.SetLayer(pcbnew.Edge_Cuts)
    edge.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(start[0]), pcbnew.FromMM(start[1])))
    edge.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(end[0]), pcbnew.FromMM(end[1])))
    edge.SetWidth(pcbnew.FromMM(0.05))
    board.Add(edge)
for index, hole in enumerate(plan['holes']):
    x, y, diameter = float(hole['x']), float(hole['y']), float(hole['diameter'])
    assert 1 <= diameter <= 8
    assert diameter / 2 + .5 <= x <= width - diameter / 2 - .5
    assert diameter / 2 + .5 <= y <= height - diameter / 2 - .5
    footprint = pcbnew.FOOTPRINT(board)
    footprint.SetReference('H' + str(index + 1))
    footprint.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    pad = pcbnew.PAD(footprint)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(diameter), pcbnew.FromMM(diameter)))
    pad.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(diameter), pcbnew.FromMM(diameter)))
    pad.SetLayerSet(pcbnew.LSET.AllCuMask())
    footprint.Add(pad)
    board.Add(footprint)
path = root / 'board.kicad_pcb'
pcbnew.SaveBoard(str(path), board)
saved = pcbnew.LoadBoard(str(path))
points = [point for edge in saved.GetDrawings() if edge.GetLayer() == pcbnew.Edge_Cuts
          for point in (edge.GetStart(), edge.GetEnd())]
xs, ys = [pcbnew.ToMM(p.x) for p in points], [pcbnew.ToMM(p.y) for p in points]
contract = {
    'artifact': {'id': root.name + '-board', 'revision': 1,
                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'uri': str(path)},
    'units': 'mm',
    'coordinateFrame': 'KiCad XY outline minimum=(0,0), +X right, +Y down; mechanical transform x=X-width/2,y=height/2-Y,z=board top above floor; +Z up',
    'width': max(xs) - min(xs), 'height': max(ys) - min(ys),
    'thickness': pcbnew.ToMM(saved.GetDesignSettings().GetBoardThickness()),
    'holes': [{'x': pcbnew.ToMM(p.GetPosition().x), 'y': pcbnew.ToMM(p.GetPosition().y),
               'diameter': pcbnew.ToMM(p.GetDrillSize().x)}
              for footprint in saved.GetFootprints() for p in footprint.Pads()],
    'geometryComplete': False,
    'unresolved': ['Physical planning outline only: no schematic or circuit.',
                   'No functional components, routing, connector geometry or component-height models.',
                   'Board size and mounting holes are provisional assumptions, not an electronics design.'],
}
(root / 'pcb-geometry.json').write_text(json.dumps(contract, indent=2) + '\n')
print(json.dumps({'kicad': pcbnew.GetBuildVersion(), 'width': contract['width'],
                  'height': contract['height'], 'holes': contract['holes']}))
