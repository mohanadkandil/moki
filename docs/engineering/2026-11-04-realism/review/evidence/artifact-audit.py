import pathlib,json,struct,zipfile,subprocess,os,urllib.request,urllib.error,hashlib
root=pathlib.Path.cwd();out=root/'docs/engineering/2026-11-04-realism/review/evidence'; source=root/'docs/engineering/2026-11-04-realism/evidence/real_models'; measurements=json.loads((source/'measurements.json').read_text());result={}
env={**os.environ,'HOME':str(out/'kicad-home'),'XDG_CONFIG_HOME':str(out/'kicad-home/config'),'XDG_CACHE_HOME':str(out/'kicad-home/cache'),'LD_LIBRARY_PATH':'/tmp/moki-kicad-check/root9/usr/lib/aarch64-linux-gnu:/tmp/moki-kicad-check/root/usr/lib/aarch64-linux-gnu'}
for template,m in measurements.items():
 job=root/'var/board-jobs'/m['jobId'];entry={};result[template]=entry
 gbytes=(job/'board.glb').read_bytes();n=struct.unpack_from('<I',gbytes,12)[0];g=json.loads(gbytes[20:20+n]);binary=gbytes[28+n:];checks=[]
 for node in g['nodes']:
  if 'moki' not in node.get('extras',{}):continue
  ys=[]
  for p in g['meshes'][node['mesh']]['primitives']:
   a=g['accessors'][p['attributes']['POSITION']];v=g['bufferViews'][a['bufferView']];offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',12)
   ys.extend(struct.unpack_from('<f',binary,offset+i*stride+4)[0]+node.get('translation',[0,0,0])[1] for i in range(a['count']))
  checks.append({'node':node['name'],'actualMinZmm':min(ys),'expectedSeatZmm':.8+node['extras']['moki']['seatHeightMm'],'valid':abs(min(ys)-(.8+node['extras']['moki']['seatHeightMm']))<.501})
 entry['seatsFromBinary']=checks
 cj=json.loads((job/'circuit.json').read_text());board=next(e for e in cj if e['type']=='pcb_board');handoff=json.loads((job/'mech-handoff.json').read_text());enclosure=json.loads((job/'enclosure.json').read_text());entry['outline']={'points':len(board['outline']),'handoffMatches':board['outline']==handoff['board']['outline'],'enclosureCornerRadius':enclosure['dimensions'].get('cornerRadiusMm')}
 dest=out/'kicad'/template;dest.mkdir(parents=True,exist_ok=True)
 zbytes=(source/template/'kicad.zip').read_bytes();entry['zipMatchesLiveJob']=zbytes==(job/'kicad.zip').read_bytes();entry['zipSha256']=hashlib.sha256(zbytes).hexdigest()
 with zipfile.ZipFile(source/template/'kicad.zip') as z:
  entry['zipEntries']=z.namelist();assert all('/' not in n and '\\' not in n for n in z.namelist());z.extractall(dest)
 sch=(dest/'moki-carrier.kicad_sch').read_text();entry['legacyPowerMarkerAbsent']='(power global)' not in sch
 for kind,ext in [('pcb','kicad_pcb'),('sch','kicad_sch')]:
  folder=dest/(kind+'-svg');folder.mkdir(exist_ok=True)
  args=['/tmp/moki-kicad-check/root9/usr/bin/kicad-cli',kind,'export','svg','-o',str(folder)+'/',str(dest/('moki-carrier.'+ext))]
  if kind=='pcb':args[4:4]=['--layers','F.Cu,B.Cu,Edge.Cuts','--mode-multi']
  proc=subprocess.run(args,env=env,capture_output=True,text=True,timeout=60);files=list(folder.glob('*.svg'));entry[kind]={'exit':proc.returncode,'stdout':proc.stdout,'stderr':proc.stderr,'svgBytes':sum(p.stat().st_size for p in files)}
 (out/'artifact-audit.json').write_text(json.dumps(result,indent=2))
# No capability lookup: unauthenticated GET requests only, using the existing preview.
checks={}
for p in ['/app/moki/studio','/app/moki/api/board/jobs','/app/moki/@fs/etc/passwd','/app/moki/api/runs','/app/moki/src/App.tsx','/app/moki/studies/','/api/board/jobs']:
 try:
  with urllib.request.urlopen('http://127.0.0.1:8847'+p,timeout=10) as r:checks[p]={'status':r.status,'contentType':r.headers.get('Content-Type')}
 except urllib.error.HTTPError as e:checks[p]={'status':e.code}
 except Exception as e:checks[p]={'error':str(e)}
(out/'preview-probes.json').write_text(json.dumps(checks,indent=2));print(json.dumps({'artifacts':{k:{'pcb':v['pcb']['exit'],'sch':v['sch']['exit'],'outline':v['outline'],'seats':all(x['valid'] for x in v['seatsFromBinary'])} for k,v in result.items()},'preview':checks},indent=2))
