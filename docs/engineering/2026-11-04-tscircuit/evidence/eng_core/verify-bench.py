#!/usr/bin/env python3
"""Recheck final benchmark artifacts from repo root, without regenerating the boards."""
import csv
import hashlib
import io
import json
import pathlib
import struct
import zipfile
from collections import Counter

root = pathlib.Path.cwd()
evidence = root / 'docs/engineering/2026-11-04-tscircuit/evidence'
bench = json.loads((evidence / 'bench.json').read_text())
assert len(bench['runs']) == 24, 'Benchmark is incomplete'
required = {'board.tsx', 'circuit.json', 'schematic.svg', 'pcb.svg', 'board.glb',
            'gerbers.zip', 'bom.csv', 'pnp.csv', 'enclosure-base.stl', 'enclosure-lid.stl',
            'assembly.glb', 'enclosure.json', 'enclosure.step', 'firmware.zip',
            'firmware-build.json', 'receipt.json'}
checked = []
for job in bench['runs']:
    path = root / 'var/board-jobs' / job['jobId']
    assert job['status'] == 'done' and not job['drc']['errors']
    assert job['drc']['checked'] is True
    assert job['board']['layers'] == 2 and job['board']['traceCount'] > 0
    assert not any(s['status'] == 'failed' for s in job['stages'])
    assert required.issubset(job['artifacts'])
    for name in required:
        data = (path / name).read_bytes()
        manifest = job['artifacts'][name]
        assert len(data) == manifest['bytes']
        assert hashlib.sha256(data).hexdigest() == manifest['sha256']
        if name.endswith('.glb'):
            assert data[:4] == b'glTF' and struct.unpack_from('<II', data, 4) == (2, len(data))
    with zipfile.ZipFile(path / 'gerbers.zip') as files:
        assert files.testzip() is None and any(n.endswith('.drl') for n in files.namelist())
    with zipfile.ZipFile(path / 'firmware.zip') as files:
        assert files.testzip() is None and {'firmware/platformio.ini', 'firmware/src/main.cpp', 'firmware/include/pins.h', 'firmware/README.md'}.issubset(files.namelist())
    mech = json.loads((path / 'enclosure.json').read_text())
    assert mech['engine']['name'] == 'build123d' and not mech['engine']['fallback']
    for part in ['base', 'lid']:
        check = mech['validation'][part]['stl']
        assert check['watertight'] and check['boundaryEdges'] == 0 and check['nonManifoldEdges'] == 0
    assert mech['validation']['step']['allValid'] and mech['validation']['step']['solids'] == 2
    if job['cache'] == 'miss':
        assert mech['mechCache'] == 'miss', 'Cold run unexpectedly reused the mechanical cache'
    firmware = json.loads((path / 'firmware-build.json').read_text())
    assert firmware['compiled'] and firmware['status'] == 'done'
    design = json.loads((path / 'design.json').read_text())
    bom = {row['Designator']: row for row in csv.DictReader(io.StringIO((path / 'bom.csv').read_text()))}
    for part in design['parts']:
        assert part['id'] in bom and bom[part['id']]['Footprint'] == f"moki:{part['module']}"
        if 'value' in part:
            assert bom[part['id']]['Value'] == part['value'].replace('Ω', 'ohm')
    checked.append({'jobId': job['jobId'], 'template': job['input']['template'], 'cache': job['cache'],
                    'mechanicalCache': mech['mechCache'], 'traceCount': job['board']['traceCount'],
                    'viaCount': job['board']['viaCount'], 'artifacts': len(required), 'firmwareCompiled': True,
                    'baseTriangles': mech['validation']['base']['stl']['triangles'],
                    'lidTriangles': mech['validation']['lid']['stl']['triangles']})
counts = Counter((j['template'], j['cache']) for j in checked)
for template in ['focus-timer', 'light-lamp', 'temp-monitor']:
    assert counts[(template, 'miss')] == 5 and counts[(template, 'hit')] == 3
result = {'passed': True, 'jobs': len(checked), 'artifactsChecked': len(required) * len(checked), 'runs': checked}
(evidence / 'eng_core/bench-artifacts.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'passed': True, 'jobs': len(checked), 'artifactsChecked': len(required) * len(checked)}))
