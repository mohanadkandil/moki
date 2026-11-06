"""Read-only route comparison. No solver, converter, compile or rerouting."""
from pathlib import Path
import hashlib
import json
import math
base = Path('var/board-jobs-test-chip/9fabd4b4-aadb-40af-9ae5-176a0740f421')
srj = json.loads((base / 'router-input.json').read_text())
circuit = json.loads((base / 'circuit.json').read_text())
final = {e['pcb_trace_id']: e for e in circuit if e['type'] == 'pcb_trace'}
fields = {'route_type', 'x', 'y', 'width', 'layer', 'from_layer', 'to_layer', 'via_diameter', 'via_hole_diameter'}
def geometry(trace):
    return [{k: v for k, v in p.items() if k in fields} for p in trace['route']]
def distance(p, a, b):
    dx, dy = b['x'] - a['x'], b['y'] - a['y']
    length = dx * dx + dy * dy
    t = max(0, min(1, ((p['x'] - a['x']) * dx + (p['y'] - a['y']) * dy) / length)) if length else 0
    return math.hypot(p['x'] - a['x'] - t * dx, p['y'] - a['y'] - t * dy)
record_changes, moved, missing = [], [], []
for trace in srj.get('traces', []):
    output = final.get(trace['pcb_trace_id'])
    if output is None:
        missing.append(trace['pcb_trace_id'])
        continue
    if geometry(trace) != geometry(output):
        record_changes.append(trace['pcb_trace_id'])
    segments = []
    for a, b in zip(trace['route'], trace['route'][1:]):
        wire = a if a['route_type'] == 'wire' else b if b['route_type'] == 'wire' else None
        if wire:
            segments.append((a, b, wire['layer']))
    values = []
    for p in output['route']:
        if p['route_type'] != 'wire':
            continue
        distances = [distance(p, a, b) for a, b, layer in segments if layer == p['layer']]
        if distances:
            values.append(min(distances))
    delta = max(values, default=0)
    if delta > 1e-6:
        moved.append({'id': trace['pcb_trace_id'], 'maxNewWireVertexDistanceFromPriorPolylineMm': delta,
                      'inputPoints': len(trace['route']), 'outputPoints': len(output['route'])})
print(json.dumps({'jobId': base.name, 'preloadCount': len(srj.get('traces', [])),
                  'sameIdsMissingInFinal': missing, 'changedRouteRecordCount': len(record_changes),
                  'changedRouteIds': record_changes, 'definiteCenterlineChangeCount': len(moved),
                  'changes': sorted(moved, key=lambda e: -e['maxNewWireVertexDistanceFromPriorPolylineMm']),
                  'artifactSha256': {name: hashlib.sha256((base / name).read_bytes()).hexdigest()
                                     for name in ['router-input.json', 'circuit.json']},
                  'limit': 'Centerline displacement is a conservative point-to-original-same-layer-segment check; no exact mutation phase or individual cause is inferred.'}, indent=2))
