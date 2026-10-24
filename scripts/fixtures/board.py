"""Non-functional infrastructure fixture: outline + NPTH holes, no circuit."""
import hashlib
import json
import pathlib
import sys
import pcbnew

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
path = root / 'fixture.kicad_pcb'
board = pcbnew.BOARD()
for start, end in [((0, 0), (60, 0)), ((60, 0), (60, 40)),
                   ((60, 40), (0, 40)), ((0, 40), (0, 0))]:
    edge = pcbnew.PCB_SHAPE()
    edge.SetShape(pcbnew.SHAPE_T_SEGMENT)
    edge.SetLayer(pcbnew.Edge_Cuts)
    edge.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(start[0]), pcbnew.FromMM(start[1])))
    edge.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(end[0]), pcbnew.FromMM(end[1])))
    edge.SetWidth(pcbnew.FromMM(0.05))
    board.Add(edge)
for i, (x, y) in enumerate([(4, 4), (56, 4), (56, 36), (4, 36)]):
    footprint = pcbnew.FOOTPRINT(board)
    footprint.SetReference('H' + str(i + 1))
    footprint.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(x), pcbnew.FromMM(y)))
    pad = pcbnew.PAD(footprint)
    pad.SetAttribute(pcbnew.PAD_ATTRIB_NPTH)
    pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    pad.SetSize(pcbnew.VECTOR2I(pcbnew.FromMM(3.2), pcbnew.FromMM(3.2)))
    pad.SetDrillSize(pcbnew.VECTOR2I(pcbnew.FromMM(3.2), pcbnew.FromMM(3.2)))
    pad.SetLayerSet(pcbnew.LSET.AllCuMask())
    footprint.Add(pad)
    board.Add(footprint)
pcbnew.SaveBoard(str(path), board)

# Publish measurements from the SAVED and reloaded artifact, never the input values.
board = pcbnew.LoadBoard(str(path))
points = [point for edge in board.GetDrawings() if edge.GetLayer() == pcbnew.Edge_Cuts
          for point in (edge.GetStart(), edge.GetEnd())]
xs = [pcbnew.ToMM(p.x) for p in points]
ys = [pcbnew.ToMM(p.y) for p in points]
contract = {
    'artifact': {'id': 'fixture-board', 'revision': 1,
                 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'uri': str(path)},
    'units': 'mm', 'coordinateFrame': 'XY board outline minimum=(0,0); +Z up',
    'width': max(xs) - min(xs), 'height': max(ys) - min(ys),
    'thickness': pcbnew.ToMM(board.GetDesignSettings().GetBoardThickness()),
    'holes': [{'x': pcbnew.ToMM(p.GetPosition().x), 'y': pcbnew.ToMM(p.GetPosition().y),
               'diameter': pcbnew.ToMM(p.GetDrillSize().x)}
              for footprint in board.GetFootprints() for p in footprint.Pads()],
    'geometryComplete': False,
    'unresolved': ['Infrastructure fixture only: no circuit or component envelopes.'],
}
(root / 'pcb-geometry.json').write_text(json.dumps(contract, indent=2))
print(json.dumps({'kicad': pcbnew.GetBuildVersion(), 'width': contract['width'],
                  'height': contract['height'], 'holes': len(contract['holes'])}))
