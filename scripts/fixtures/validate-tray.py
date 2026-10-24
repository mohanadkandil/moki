"""Independent check of exported STEP; does not import the generator."""
import hashlib
import json
from pathlib import Path
import sys
from build123d import Align, Box, Pos, import_step

root = Path(sys.argv[1])
geometry = json.loads((root / 'pcb-geometry.json').read_text())
path = root / 'tray.step'
tray = import_step(path)
bounds = tray.bounding_box().size
expected = [geometry['width'] + 6, geometry['height'] + 6, 20]
actual = [bounds.X, bounds.Y, bounds.Z]
assert tray.is_valid and len(tray.solids()) == 1 and tray.volume > 0
assert all(abs(a - e) < 1e-5 for a, e in zip(actual, expected)), actual
board = Pos(0, 0, 5) * Box(geometry['width'], geometry['height'], geometry['thickness'])
overlap = tray & board
collision = overlap.volume if overlap else 0
assert collision < 1e-6, collision
# A deliberately oversized board must collide with the tray walls.
bad_board = Pos(0, 0, 5) * Box(geometry['width'] + 10, geometry['height'], geometry['thickness'])
negative = tray & bad_board
assert negative and negative.volume > 0, 'Negative collision check did not fail'
report = {'checker': 'fixture-step-collision-v1', 'outcome': 'pass',
          'scope': 'bare board clearance only', 'bboxMm': actual,
          'solidCount': len(tray.solids()), 'volumeMm3': tray.volume,
          'overlapMm3': collision, 'negativeOverlapMm3': negative.volume,
          'boardSha256': geometry['artifact']['sha256'],
          'stepSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
          'releaseOutcome': 'blocked', 'unresolved': geometry['unresolved']}
(root / 'fit-report.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
