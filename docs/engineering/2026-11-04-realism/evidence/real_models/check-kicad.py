# Apt-less KiCad 9.0.8 from Debian bookworm-backports, dependencies extracted in /tmp.
# The generated archive is tested unchanged; only output directories are created.
import os,pathlib,json,subprocess,zipfile
root=pathlib.Path(__file__).resolve().parent
jobs=json.loads((root/'dev-jobs.json').read_text());results={}
env={**os.environ,'LD_LIBRARY_PATH':'/tmp/moki-kicad-check/root9/usr/lib/aarch64-linux-gnu:/tmp/moki-kicad-check/root/usr/lib/aarch64-linux-gnu'}
cli='/tmp/moki-kicad-check/root9/usr/bin/kicad-cli'
for name,job in jobs.items():
 dest=pathlib.Path('/tmp/moki-kicad-check/final')/name;dest.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(pathlib.Path('var/board-jobs')/job/'kicad.zip') as z:z.extractall(dest)
 results[name]={}
 for kind,ext in [('pcb','kicad_pcb'),('sch','kicad_sch')]:
  out=dest/f'{kind}-svg';out.mkdir(exist_ok=True)
  args=[cli,kind,'export','svg','-o',str(out)+'/',str(dest/f'moki-carrier.{ext}')]
  if kind=='pcb':args[4:4]=['--layers','F.Cu,B.Cu,Edge.Cuts','--mode-multi']
  run=subprocess.run(args,env=env,text=True,capture_output=True,timeout=60)
  files=list(out.glob('*.svg'));results[name][kind]={'exit':run.returncode,'stdout':run.stdout,'stderr':run.stderr,'svgFiles':[str(p) for p in files],'svgBytes':sum(p.stat().st_size for p in files)}
  print(name,kind,run.returncode,len(files),flush=True)
  (root/'kicad9-final-check.json').write_text(json.dumps(results,indent=2))
  if run.returncode or not files:raise RuntimeError(results[name][kind])
