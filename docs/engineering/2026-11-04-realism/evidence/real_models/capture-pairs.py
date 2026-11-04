import json,subprocess,pathlib,shutil,sys
root=pathlib.Path(__file__).resolve().parent
jobs=json.loads((root/'dev-jobs.json').read_text())
for name,job in jobs.items():
 after=pathlib.Path('var/board-jobs')/job/'board.glb';shutil.copyfile(after,root/f'{name}-after.glb')
 for state in (['after'] if '--after-only' in sys.argv else ['before','after']):
  subprocess.run(['/home/sogo/.bun/bin/bun','eda/models/render-evidence.ts',str(root/f'{name}-{state}.glb'),str(root/f'{name}-{state}.png')],check=True)
