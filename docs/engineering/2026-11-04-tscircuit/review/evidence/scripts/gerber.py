#!/usr/bin/env python3
"""Independent check of what would actually be fabricated: rebuild copper connectivity from Gerber + Excellon only."""
import re,sys,json,math,zipfile,itertools,collections
job=sys.argv[1]; catalog=json.load(open(sys.argv[2])); design=json.load(open(f'{job}/design.json'))
z=zipfile.ZipFile(f'{job}/gerbers.zip')
def layer(name):
    t=z.read(name).decode(); ap={}; cur=None; x=y=0; out=[]
    for m in re.finditer(r'%ADD(\d+)([A-Za-z_]+),?([^*%]*)\*%',t):
        ap[int(m[1])]=(m[2],[float(v) for v in m[3].split('X') if v and re.fullmatch(r'[\d.]+',v)])
    body=re.sub(r'%[^%]*%','',t)
    for cmd in body.split('*'):
        cmd=cmd.strip()
        if not cmd or cmd.startswith('G04'): continue
        m=re.fullmatch(r'(?:G54)?D(\d+)',cmd)
        if m and int(m[1])>=10: cur=int(m[1]); continue
        m=re.fullmatch(r'(?:G01)?(?:X(-?\d+))?(?:Y(-?\d+))?D0?([123])',cmd)
        if m:
            nx=int(m[1])/1e6 if m[1] else x; ny=int(m[2])/1e6 if m[2] else y; d=int(m[3])
            if d==1: out.append(('draw',x,y,nx,ny,ap[cur]))
            if d==3: out.append(('flash',nx,ny,ap[cur]))
            x,y=nx,ny
    return out,ap
items=[]
for lname,f in (('top','F_Cu.gbr'),('bottom','B_Cu.gbr')):
    o,ap=layer(f)
    for e in o:
        if e[0]=='draw': items.append(dict(k='s',l=lname,ax=e[1],ay=e[2],bx=e[3],by=e[4],w=e[5][1][0]))
        else: items.append(dict(k='p',l=lname,x=e[1],y=e[2],r=(e[3][1][0] if e[3][1] else 0)/2,ap=e[3][0]))
drl=z.read('drill-L1-L2.drl').decode(); tools={};cur=None;holes=[]
for ln in drl.splitlines():
    m=re.fullmatch(r'T(\d+)C([\d.]+)',ln.strip())
    if m: tools[m[1]]=float(m[2]);continue
    m=re.fullmatch(r'T(\d+)',ln.strip())
    if m: cur=m[1];continue
    m=re.fullmatch(r'X(-?[\d.]+)Y(-?[\d.]+)',ln.strip())
    if m: holes.append((float(m[1]),float(m[2]),tools[cur]))
npth=[l for l in z.read('drill_npth.drl').decode().splitlines() if l.startswith('X')]
print('copper flashes/draws',collections.Counter((i['l'],i['k']) for i in items),'PTH holes',len(holes),collections.Counter(h[2] for h in holes),'NPTH',len(npth),collections.Counter(re.findall(r'T\d+C[\d.]+',z.read('drill_npth.drl').decode())))
def dps(px,py,s):
    dx,dy=s['bx']-s['ax'],s['by']-s['ay'];l=dx*dx+dy*dy
    t=0 if l==0 else max(0,min(1,((px-s['ax'])*dx+(py-s['ay'])*dy)/l))
    return math.hypot(px-(s['ax']+t*dx),py-(s['ay']+t*dy))
def segseg(a,b):
    def ccw(p,q,r): return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    A,B,C,D=(a['ax'],a['ay']),(a['bx'],a['by']),(b['ax'],b['ay']),(b['bx'],b['by'])
    if ccw(A,B,C)*ccw(A,B,D)<0 and ccw(C,D,A)*ccw(C,D,B)<0: return 0
    return min(dps(C[0],C[1],a),dps(D[0],D[1],a),dps(A[0],A[1],b),dps(B[0],B[1],b))
par=list(range(len(items)+len(holes)))
def find(i):
    while par[i]!=i: par[i]=par[par[i]];i=par[i]
    return i
minclr=9e9
for i,j in itertools.combinations(range(len(items)),2):
    a,b=items[i],items[j]
    if a['l']!=b['l']: continue
    if a['k']=='p' and b['k']=='p': g=math.hypot(a['x']-b['x'],a['y']-b['y'])-a['r']-b['r']
    elif a['k']=='s' and b['k']=='s': g=segseg(a,b)-(a['w']+b['w'])/2
    else:
        s,p=(a,b) if a['k']=='s' else (b,a); g=dps(p['x'],p['y'],s)-p['r']-s['w']/2
    if g<=1e-5: par[find(i)]=find(j)
    else: minclr=min(minclr,g)
n=len(items)
for hi,(x,y,d) in enumerate(holes):
    hit={'top':0,'bottom':0}
    for i,it in enumerate(items):
        if it['k']=='p' and math.hypot(it['x']-x,it['y']-y)<1e-3:
            par[find(i)]=find(n+hi); hit[it['l']]+=1
    if not all(hit.values()): print('  drill without pad on both layers',x,y,d,hit)
meta=json.load(open(f'{job}/board-metadata.json'))
pinxy={}
for p in meta['parts']:
    for pin in p['pins']: pinxy[(p['id'],pin['id'])]=(pin['x'],pin['y'])
hole_of={}
for k,(x,y) in pinxy.items():
    c=[i for i,(hx,hy,d) in enumerate(holes) if math.hypot(hx-x,hy-y)<0.005]
    if len(c)!=1: print('  pad without single drill',k,(x,y),len(c))
    else: hole_of[k]=n+c[0]
groups=collections.defaultdict(set)
for k,i in hole_of.items(): groups[find(i)].add(k)
want=[frozenset((e['part'],e['pin']) for e in net['endpoints']) for net in design['nets']]
got=[frozenset(v) for v in groups.values() if len(v)>1]
print('design nets',len(want),'gerber copper groups>=2',len(got),'exact matches',sum(1 for w in want if w in got),'| min same-layer clearance between non-touching copper primitives (includes different primitives only) %.3f'%minclr)
for w in want:
    if w not in got: print('  MISSING',sorted(w))
for g in got:
    if g not in want: print('  EXTRA',sorted(g))
