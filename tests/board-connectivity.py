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
EPS=1e-6
MIN_ANNULUS_MM=0.15

def number(value,label,positive=False):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or (positive and value<=0):
        raise ValueError(f'{label} must be finite' + (' and positive' if positive else ''))
    return value

def plated(kind,x,y,outer,hole,**extra):
    outer=number(outer,f'{kind} copper diameter',True); hole=number(hole,f'{kind} drill diameter',True)
    if (outer-hole)/2 < MIN_ANNULUS_MM-EPS:
        raise ValueError(f'{kind} annulus must be at least {MIN_ANNULUS_MM} mm: outer={outer}, drill={hole}')
    return dict(kind=kind,x=number(x,f'{kind} x'),y=number(y,f'{kind} y'),r=outer/2,hole=hole,**extra)

pads=[]
for h in by('pcb_plated_hole'):
    name=src[pc[h['pcb_component_id']]['source_component_id']]['name']
    n=[p for p in h['port_hints'] if re.fullmatch(r'pin\d+',p)][0]
    part=[p for p in design['parts'] if p['id']==name][0]
    pin=catalog[part['module']]['pins'][int(n[3:])-1]
    pads.append(plated('pad',h['x'],h['y'],h['outer_diameter'],h['hole_diameter'],part=name,pin=pin['id'],module=part['module']))
vias=[plated('via',v['x'],v['y'],v['outer_diameter'],v['hole_diameter'],net=v.get('pcb_trace_id')) for v in by('pcb_via')]
segs=[];route_vias=0
for t in by('pcb_trace'):
    r=t['route']
    for point in r:
        number(point['x'],'route x'); number(point['y'],'route y')
        if point['route_type']=='wire': number(point['width'],'trace width',True)
    for a,b in zip(r,r[1:]):
        if a['route_type']=='wire' and b['route_type']=='wire' and a['layer']==b['layer']:
            segs.append(dict(kind='seg',ax=a['x'],ay=a['y'],bx=b['x'],by=b['y'],layer=a['layer'],w=a['width'],trace=t['pcb_trace_id'],conn=t.get('connection_name')))
        elif a['route_type']=='wire' and b['route_type']=='wire':
            print('  layer change with no via element',t['pcb_trace_id'],a,b)
    route_vias+=sum(1 for p in r if p['route_type']=='via')
    for p in r:
        if p['route_type']!='via': continue
        matching=next((v for v in vias if math.hypot(v['x']-p['x'],v['y']-p['y'])<EPS),None)
        has_dimensions='via_diameter' in p or 'via_hole_diameter' in p
        if has_dimensions:
            route_via=plated('via',p['x'],p['y'],p.get('via_diameter'),p.get('via_hole_diameter'),net=t['pcb_trace_id'],inroute=True)
            if matching and (abs(matching['r']-route_via['r'])>EPS or abs(matching['hole']-route_via['hole'])>EPS):
                raise ValueError('Route via dimensions disagree with its physical pcb_via')
        elif not matching:
            raise ValueError('Route via has no physical dimensions and no matching pcb_via')
        if not matching: vias.append(route_via)

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
# Treat every connected BREP pour as physical copper, independent of its declared net.
# Inner rings are voids (antipads, mounting holes, and thermal-relief slots).
polys=[]
for p in by('pcb_copper_pour'):
    assert p['shape']=='brep', 'Unsupported pour geometry must not silently pass'
    b=p['brep_shape']
    polys.append(dict(kind='poly',layer=p['layer'],rings=[b['outer_ring']['vertices']]+[r['vertices'] for r in b.get('inner_rings',[])],pour=p['pcb_copper_pour_id']))
def edges(poly):
    for ring in poly['rings']:
        for a,b in zip(ring,ring[1:]+ring[:1]):
            yield dict(ax=a['x'],ay=a['y'],bx=b['x'],by=b['y'])
def inside_ring(x,y,ring):
    hit=False
    for a,b in zip(ring,ring[1:]+ring[:1]):
        if (a['y']>y)!=(b['y']>y) and x<(b['x']-a['x'])*(y-a['y'])/(b['y']-a['y'])+a['x']: hit=not hit
    return hit
def inside_poly(x,y,p):
    return inside_ring(x,y,p['rings'][0]) and not any(inside_ring(x,y,r) for r in p['rings'][1:])
def point_poly_gap(x,y,p):
    d=min(dps(x,y,e['ax'],e['ay'],e['bx'],e['by']) for e in edges(p))
    return -d if inside_poly(x,y,p) else d
# A plated annulus must remain continuous after every drill, not only its own.
# Coincident records may describe one physical hole, but must agree on its drill.
drills=pads+vias
for a,b in itertools.combinations(drills,2):
    distance=math.hypot(a['x']-b['x'],a['y']-b['y'])
    if distance<EPS and abs(a['hole']-b['hole'])<EPS: continue
    if distance<a['hole']/2+b['r']-EPS or distance<b['hole']/2+a['r']-EPS:
        raise ValueError('Drill void cuts a neighbouring plated annulus')

# Remove copper completely erased by a drill. Valid annuli connect surviving trace
# branches around their void; they cannot connect a segment or island wholly inside it.
# Zero-length router segments at via centres are a common harmless erased case.
def erased_segment(s):
    return any(max(math.hypot(s['ax']-d['x'],s['ay']-d['y']),math.hypot(s['bx']-d['x'],s['by']-d['y']))+s['w']/2<=d['hole']/2+EPS for d in drills)
def erased_polygon(p):
    return any(max(math.hypot(v['x']-d['x'],v['y']-d['y']) for v in p['rings'][0])<=d['hole']/2+EPS for d in drills)
erased_count=sum(erased_segment(s) for s in segs)+sum(erased_polygon(p) for p in polys)
segs=[s for s in segs if not erased_segment(s)]
polys=[p for p in polys if not erased_polygon(p)]

def point_annulus_gap(x,y,p):
    distance=math.hypot(x-p['x'],y-p['y'])
    return max(distance-p['r'],p['hole']/2-distance)
def segment_annulus_gap(s,p):
    near=dps(p['x'],p['y'],s['ax'],s['ay'],s['bx'],s['by'])-s['w']/2
    far=max(math.hypot(p['x']-s['ax'],p['y']-s['ay']),math.hypot(p['x']-s['bx'],p['y']-s['by']))+s['w']/2
    return max(near-p['r'],p['hole']/2-far)

items=pads+vias+segs+polys
parent=list(range(len(items)))
def find(i):
    while parent[i]!=i: parent[i]=parent[parent[i]]; i=parent[i]
    return i
def gap(a,b):
    """edge-to-edge copper distance; None if never on the same layer"""
    A,B=a['kind'],b['kind']
    if A=='poly' or B=='poly':
        p,o=(a,b) if A=='poly' else (b,a)
        if o['kind'] in ('poly','seg') and o['layer']!=p['layer']: return None
        if o['kind']=='poly':
            if any(inside_poly(v['x'],v['y'],p) for v in o['rings'][0]) or any(inside_poly(v['x'],v['y'],o) for v in p['rings'][0]): return -1e-6
            return min(segseg(e,f) for e in edges(p) for f in edges(o))
        if o['kind']=='seg':
            if any(inside_poly(x,y,p) for x,y in [(o['ax'],o['ay']),(o['bx'],o['by']),((o['ax']+o['bx'])/2,(o['ay']+o['by'])/2)]): return -o['w']/2
            return min(segseg(e,o) for e in edges(p))-o['w']/2
        near=max(0,point_poly_gap(o['x'],o['y'],p))
        far=max(math.hypot(v['x']-o['x'],v['y']-o['y']) for v in p['rings'][0])
        return max(near-o['r'],o['hole']/2-far)
    if A!='seg' and B!='seg':
        distance=math.hypot(a['x']-b['x'],a['y']-b['y'])
        return max(distance-a['r']-b['r'],a['hole']/2-distance-b['r'],b['hole']/2-distance-a['r'])
    if A=='seg' and B=='seg':
        if a['layer']!=b['layer']: return None
        return segseg(a,b)-(a['w']+b['w'])/2
    s,p=(a,b) if A=='seg' else (b,a)
    return segment_annulus_gap(s,p)
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
            elif o['kind']=='poly':
                if o['layer']!=s['layer']: continue
                d=point_poly_gap(x,y,o)
            else:
                d=point_annulus_gap(x,y,o)
                # An endpoint in a drilled void terminates on its continuous barrel,
                # provided this segment has retained copper touching the annulus.
                if math.hypot(x-o['x'],y-o['y'])<o['hole']/2 and segment_annulus_gap(s,o)<=EPS: d=0
            if d<=s['w']/2+1e-6: touched=True;break
        if not touched: dead.append((round(x,3),round(y,3),s['layer'],s['trace']))
print('dead-end wire ends:',dead if dead else 'none')
# clearances between different electrical groups
cross=sorted([(g,i,j) for g,i,j in gaps if find(i)!=find(j)])
def lab(i):
    it=items[i]
    if it['kind']=='poly': return f"{it['layer']} {it['pour']}"
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
    best=min((( (dps(h['x'],h['y'],o['ax'],o['ay'],o['bx'],o['by'])-o['w']/2) if o['kind']=='seg' else point_poly_gap(h['x'],h['y'],o) if o['kind']=='poly' else math.hypot(h['x']-o['x'],h['y']-o['y'])-o['r'])-h['hole_diameter']/2,lab(k)) for k,o in enumerate(items))
    print(f"  M3 hole ({h['x']},{h['y']}) d={h['hole_diameter']} nearest copper {best[0]:.2f} mm {best[1]}")
    assert best[0] >= .2 - 1e-6, 'Mounting-hole copper clearance below 0.2 mm'
# edge clearance
outline=board.get('outline') or [dict(x=-W/2,y=-H/2),dict(x=W/2,y=-H/2),dict(x=W/2,y=H/2),dict(x=-W/2,y=H/2)]
def edge(x,y,extra):
    distance=min(dps(x,y,a['x'],a['y'],b['x'],b['y']) for a,b in zip(outline,outline[1:]+outline[:1]))
    return (distance if inside_ring(x,y,outline) else -distance)-extra
e=min((min(edge(v['x'],v['y'],0) for v in o['rings'][0]) if o['kind']=='poly' else edge(o['x'],o['y'],o['r']) if o['kind']!='seg' else min(edge(o['ax'],o['ay'],o['w']/2),edge(o['bx'],o['by'],o['w']/2)),lab(k)) for k,o in enumerate(items))
print(f'  nearest copper to actual board outline {e[0]:.2f} mm {e[1]}')
assert e[0] >= .2 - 1e-6, 'Board-edge copper clearance below 0.2 mm'
print('  via count',len([v for v in vias]),'hole/outer',collections.Counter((v['hole'],round(2*v['r'],3)) for v in vias),'annular ring mm',{round(v['r']-v['hole']/2,3) for v in vias})
print('  trace widths',collections.Counter(s['w'] for s in segs))
print('  pad drill/outer',collections.Counter((p['hole'],round(p['r']*2,3)) for p in pads))
# pad position vs catalog placement
meta=json.load(open(f'{job}/board-metadata.json'))
worst=0
for p in pads:
    part=[m for m in meta['parts'] if m['id']==p['part']][0]; mod=catalog[part['module']]
    c=[q for q in mod['pins'] if q['id']==p['pin']][0]['physical']
    rotation=math.radians(part.get('rotation',0));lx=c['x']-mod['size']['w']/2;ly=mod['size']['h']/2-c['y']
    ex=part['x']+math.cos(rotation)*lx-math.sin(rotation)*ly; ey=part['y']+math.sin(rotation)*lx+math.cos(rotation)*ly
    worst=max(worst,math.hypot(ex-p['x'],ey-p['y']))
print(f'  max pad offset from catalog physical position: {worst:.4f} mm')

# Test oracle: metadata never supplies electrical connectivity. It identifies only pads.
assert not missing, f'Copper opens: {missing}'
assert not extra, f'Copper shorts or unexpected groups: {extra}'
assert not any(not copper[g] for g in groups), 'Floating copper islands'
assert not dead, f'Dead-ended copper: {dead}'
assert not cross or min(g for g, i, j in cross) >= 0.2 - 1e-6, 'Copper clearance below 0.2 mm'
assert worst < 0.001, f'Catalog pad drift: {worst}'
print(f'  copper pieces erased by drill voids: {erased_count}')
print(f'  audited filled copper polygons: {len(polys)} (with antipads and thermal slots)')
print('PASS: exact physical copper connectivity')
