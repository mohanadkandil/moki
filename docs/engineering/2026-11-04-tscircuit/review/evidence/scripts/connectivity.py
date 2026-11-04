#!/usr/bin/env python3
"""Independent copper connectivity + clearance audit. Reads only circuit.json + design.json + board-metadata.json of a job;
does NOT use source_trace/connectivity keys. Geometry only."""
import json,sys,math,re,itertools,collections,os
job=sys.argv[1]
cj=json.load(open(f'{job}/circuit.json')); design=json.load(open(f'{job}/design.json'))
def by(t): return [e for e in cj if e['type']==t]
board=by('pcb_board')[0]; W,H=board['width'],board['height']
src={e['source_component_id']:e for e in by('source_component')}
pc={e['pcb_component_id']:e for e in by('pcb_component')}
# pads named by part + catalog pin id
catalog=json.load(open(sys.argv[2]))
pads=[]
for h in by('pcb_plated_hole'):
    name=src[pc[h['pcb_component_id']]['source_component_id']]['name']
    n=[p for p in h['port_hints'] if re.fullmatch(r'pin\d+',p)][0]
    part=[p for p in design['parts'] if p['id']==name][0]
    pin=catalog[part['module']]['pins'][int(n[3:])-1]
    pads.append(dict(kind='pad',part=name,pin=pin['id'],x=h['x'],y=h['y'],r=h['outer_diameter']/2,hole=h['hole_diameter'],module=part['module']))
vias=[dict(kind='via',x=v['x'],y=v['y'],r=v['outer_diameter']/2,hole=v['hole_diameter'],net=v.get('pcb_trace_id')) for v in by('pcb_via')]
segs=[];route_vias=0
for t in by('pcb_trace'):
    r=t['route']
    for a,b in zip(r,r[1:]):
        if a['route_type']=='wire' and b['route_type']=='wire' and a['layer']==b['layer']:
            segs.append(dict(kind='seg',ax=a['x'],ay=a['y'],bx=b['x'],by=b['y'],layer=a['layer'],w=a['width'],trace=t['pcb_trace_id'],conn=t.get('connection_name')))
        elif a['route_type']=='wire' and b['route_type']=='wire':
            print('  layer change with no via element',t['pcb_trace_id'],a,b)
    route_vias+=sum(1 for p in r if p['route_type']=='via')
    for p in r:
        if p['route_type']=='via': vias.append(dict(kind='via',x=p['x'],y=p['y'],r=0.15,hole=0.2,net=t['pcb_trace_id'],inroute=True))
def dps(px,py,ax,ay,bx,by):
    dx,dy=bx-ax,by-ay; l=dx*dx+dy*dy
    t=0 if l==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/l))
    return math.hypot(px-(ax+t*dx),py-(ay+t*dy))
def segseg(s,t):
    def ccw(ax,ay,bx,by,cx,cy): return (bx-ax)*(cy-ay)-(by-ay)*(cx-ax)
    a=(s['ax'],s['ay'],s['bx'],s['by']);b=(t['ax'],t['ay'],t['bx'],t['by'])
    d1=ccw(a[0],a[1],a[2],a[3],b[0],b[1]);d2=ccw(a[0],a[1],a[2],a[3],b[2],b[3]);d3=ccw(b[0],b[1],b[2],b[3],a[0],a[1]);d4=ccw(b[0],b[1],b[2],b[3],a[2],a[3])
    if d1*d2<0 and d3*d4<0: return 0.0
    return min(dps(b[0],b[1],*a),dps(b[2],b[3],*a),dps(a[0],a[1],*b),dps(a[2],a[3],*b))
items=pads+vias+segs
parent=list(range(len(items)))
def find(i):
    while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
    return i
def gap(a,b):
    """edge-to-edge copper distance; None if never on the same layer"""
    A,B=a['kind'],b['kind']
    if A!='seg' and B!='seg': return math.hypot(a['x']-b['x'],a['y']-b['y'])-a['r']-b['r']
    if A=='seg' and B=='seg':
        if a['layer']!=b['layer']: return None
        return segseg(a,b)-(a['w']+b['w'])/2
    s,p=(a,b) if A=='seg' else (b,a)
    return dps(p['x'],p['y'],s['ax'],s['ay'],s['bx'],s['by'])-p['r']-s['w']/2
gaps=[]
for i,j in itertools.combinations(range(len(items)),2):
    g=gap(items[i],items[j])
    if g is None: continue
    gaps.append((g,i,j))
    if g<=1e-6: parent[find(i)]=find(j)
groups=collections.defaultdict(list)
for i,it in enumerate(items): groups[find(i)].append(i)
netof={}
for n in design['nets']:
    for e in n['endpoints']: netof[(e['part'],e['pin'])]=n['name']
copper=collections.defaultdict(set)
for g,ii in groups.items():
    for i in ii:
        it=items[i]
        if it['kind']=='pad': copper[g].add((it['part'],it['pin']))
errors=[]
designed={n['name']:{(e['part'],e['pin']) for e in n['endpoints']} for n in design['nets']}
got=[frozenset(v) for v in copper.values() if len(v)>1]
want=[frozenset(v) for v in designed.values()]
missing=[w for w in want if w not in got]; extra=[g for g in got if g not in want]
print(f'nets designed {len(want)}, copper groups with >=2 pads {len(got)}, exact-match {sum(1 for w in want if w in got)}')
for w in missing: print('  MISSING/OPEN design net',sorted(w))
for g in extra: print('  UNEXPECTED copper group',sorted(g),[netof.get(p) for p in sorted(g)])
# stray copper with no pad
for g,ii in groups.items():
    if not copper[g]: print('  FLOATING copper island:',[(items[i]['kind'],items[i].get('trace'),items[i].get('layer')) for i in ii][:5])
# dead-ends: a wire endpoint touching nothing else
dead=[]
for i,s in enumerate(items):
    if s['kind']!='seg': continue
    for (x,y) in ((s['ax'],s['ay']),(s['bx'],s['by'])):
        touched=False
        for j,o in enumerate(items):
            if j==i: continue
            if o['kind']=='seg':
                if o['layer']!=s['layer']: continue
                d=dps(x,y,o['ax'],o['ay'],o['bx'],o['by'])-(o['w'])/2
            else: d=math.hypot(x-o['x'],y-o['y'])-o['r']
            if d<=s['w']/2+1e-6: touched=True;break
        if not touched: dead.append((round(x,3),round(y,3),s['layer'],s['trace']))
print('dead-end wire ends:',dead if dead else 'none')
# clearances between different electrical groups
cross=sorted([(g,i,j) for g,i,j in gaps if find(i)!=find(j)])
def lab(i):
    it=items[i]
    return f"{it['part']}.{it['pin']}" if it['kind']=='pad' else (f"via@{it['x']:.2f},{it['y']:.2f}" if it['kind']=='via' else f"{it['layer']} {it['trace']}")
print('min clearance across different copper groups (mm):')
seen=0
for g,i,j in cross:
    if items[i]['kind']=='pad' and items[j]['kind']=='pad': continue
    print(f'   {g:.3f} {lab(i)} <-> {lab(j)}'); seen+=1
    if seen>=6: break
pp=[x for x in cross if items[x[1]]['kind']=='pad' and items[x[2]]['kind']=='pad'][:2]
for g,i,j in pp: print(f'   pad-pad {g:.3f} {lab(i)} <-> {lab(j)}')
# mounting holes vs copper
for h in by('pcb_hole'):
    best=min((( (dps(h['x'],h['y'],o['ax'],o['ay'],o['bx'],o['by'])-o['w']/2) if o['kind']=='seg' else math.hypot(h['x']-o['x'],h['y']-o['y'])-o['r'])-h['hole_diameter']/2,lab(k)) for k,o in enumerate(items))
    print(f"  M3 hole ({h['x']},{h['y']}) d={h['hole_diameter']} nearest copper {best[0]:.2f} mm {best[1]}")
# edge clearance
def edge(x,y,extra): return min(W/2-abs(x),H/2-abs(y))-extra
e=min((edge(o['x'],o['y'],o['r']) if o['kind']!='seg' else min(edge(o['ax'],o['ay'],o['w']/2),edge(o['bx'],o['by'],o['w']/2)),lab(k)) for k,o in enumerate(items))
print(f'  nearest copper to board edge {e[0]:.2f} mm {e[1]}')
print('  via count',len([v for v in vias]),'hole/outer',collections.Counter((v['hole'],round(2*v['r'],3)) for v in vias),'annular ring mm',{round(v['r']-v['hole']/2,3) for v in vias})
print('  trace widths',collections.Counter(s['w'] for s in segs))
print('  pad drill/outer',collections.Counter((p['hole'],round(p['r']*2,3)) for p in pads))
# pad position vs catalog placement
meta=json.load(open(f'{job}/board-metadata.json'))
worst=0
for p in pads:
    part=[m for m in meta['parts'] if m['id']==p['part']][0]; mod=catalog[part['module']]
    c=[q for q in mod['pins'] if q['id']==p['pin']][0]['physical']
    ex=part['x']+c['x']-mod['size']['w']/2; ey=part['y']+mod['size']['h']/2-c['y']
    worst=max(worst,math.hypot(ex-p['x'],ey-p['y']))
print(f'  max pad offset from catalog physical position: {worst:.4f} mm')
