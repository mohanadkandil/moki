import urllib.request,json,time,pathlib
root=pathlib.Path(__file__).resolve().parent
jobs={}
for name in ['focus-timer','light-lamp','temp-monitor']:
 design=json.load(open(f'var/realism/{name}/design.json'))
 req=urllib.request.Request('http://127.0.0.1:5173/api/board/jobs',data=json.dumps({'design':design}).encode(),headers={'Content-Type':'application/json'})
 job=json.load(urllib.request.urlopen(req))['jobId'];jobs[name]=job
 (root/'dev-jobs.json').write_text(json.dumps(jobs,indent=2));print(name,job,flush=True)
 while True:
  d=json.load(urllib.request.urlopen(f'http://127.0.0.1:5173/api/board/jobs/{job}'))
  if d['status'] in ['done','failed']:break
  time.sleep(2)
 (root/f'{name}-job.json').write_text(json.dumps(d,indent=2))
 print(name,d['status'],d.get('error'),flush=True)
 if d['status']!='done':raise RuntimeError(d)
