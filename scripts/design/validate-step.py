"""Independent geometry validation: imports exported STEP, never its generator."""
import hashlib
import json
import math
from pathlib import Path
import sys
from build123d import import_step

root = Path(sys.argv[1])
path = root / 'product.step'
shape = import_step(path)
solids = shape.solids()
box = shape.bounding_box()
bbox = [float(box.size.X), float(box.size.Y), float(box.size.Z)]
volume = float(shape.volume)
assert shape.is_valid and solids and all(s.is_valid and s.volume > 0 for s in solids), 'Invalid or empty solid'
assert math.isfinite(volume) and volume > 0, 'Invalid volume'
assert all(math.isfinite(v) and .5 <= v <= 500 for v in bbox), 'Unreasonable enclosure bounds'
board = json.loads((root / 'pcb-geometry.json').read_text())
assert hashlib.sha256((root / 'board.kicad_pcb').read_bytes()).hexdigest() == board['artifact']['sha256'], 'Board artifact changed'
report = {
    'checker': 'independent-exported-step-geometry-v1', 'outcome': 'pass',
    'scope': 'Valid closed STEP solids, positive volume, finite bounded dimensions and artifact integrity only; no electronics or assembly fit claim.',
    'bboxMm': bbox, 'solidCount': len(solids), 'volumeMm3': volume,
    'stepSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    'boardSha256': board['artifact']['sha256'],
    'geometryComplete': False, 'fitOutcome': 'blocked',
    'unresolved': board['unresolved'] + ['No independent component-envelope or enclosure fit validation.'],
}
(root / 'geometry-check.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
