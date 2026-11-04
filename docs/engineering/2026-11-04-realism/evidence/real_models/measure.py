import json,struct,pathlib,shutil
root=pathlib.Path(__file__).resolve().parent;jobs=json.loads((root/'dev-jobs.json').read_text());result={}
for name,job in jobs.items():
 p=pathlib.Path('var/board-jobs')/job;d=json.loads((p/'job.json').read_text());m=json.loads((p/'board-metadata.json').read_text());en=json.loads((p/'enclosure.json').read_text());b=(p/'board.glb').read_bytes();g=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
 assert d['status']=='done' and not d['drc']['errors'] and not en['validation']['failures']
 assert len(b)<3_000_000
 models=[n for n in g['nodes'] if n.get('extras',{}).get('moki')]
 parts=json.loads((p/'design.json').read_text())['parts']
 for part in parts:assert any(n['name']==part['id']+':'+part['module'] for n in models)
 for n in models:
  minimum=min(g['accessors'][q['attributes']['POSITION']]['min'][1]for q in g['meshes'][n['mesh']]['primitives'])+n['translation'][1]
  seat=.8+n['extras']['moki']['seatHeightMm'];assert minimum>=seat-.001 and minimum-seat<=.5
 a=(p/'assembly.glb').read_bytes();assembly=json.loads(a[20:20+struct.unpack_from('<I',a,12)[0]])
 assert assembly['asset']['extras']['moki']['maskMaterials']==g['asset']['extras']['moki']['maskMaterials']
 result[name]={'jobId':job,'drcErrors':len(d['drc']['errors']),'boardMm':[m['widthMm'],m['heightMm']],'boardGlbBytes':len(b),'assemblyGlbBytes':len(a),'kicadZipBytes':(p/'kicad.zip').stat().st_size,'enclosureFailures':en['validation']['failures'],'modelNames':[n['name']for n in models],'cornerRadiusMm':en['dimensions'].get('cornerRadiusMm')}
 out=root/name;out.mkdir(exist_ok=True)
 for f in ['design.json','board-metadata.json','receipt.json','mech-handoff.json','enclosure.json','kicad.zip']:shutil.copyfile(p/f,out/f)
 source=pathlib.Path('docs/engineering/2026-11-04-tscircuit/evidence/fix_core')/name/'connectivity.log'
 if source.exists():shutil.copyfile(source,root/f'{name}-connectivity.log')
(root/'measurements.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
