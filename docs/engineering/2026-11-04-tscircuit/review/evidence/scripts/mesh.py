#!/usr/bin/env python3
"""Independent mechanical audit from the exported STLs (not the B-rep tests): ray-cast with numpy."""
import json,sys,numpy as np
job=sys.argv[1]
H=json.load(open(f'{job}/mech-handoff.json')); E=json.load(open(f'{job}/enclosure.json'))
def stl(p):
    raw=open(p,'rb').read(); n=int.from_bytes(raw[80:84],'little')
    rec=np.dtype([('n','<f4',3),('v','<f4',(3,3)),('a','<u2')])
    return np.frombuffer(raw,rec,count=n,offset=84)['v'].astype(float)
base=stl(f'{job}/enclosure-base.stl'); lid=stl(f'{job}/enclosure-lid.stl')
total=E['dimensions']['outerMm']['z']
lid=lid.copy(); lid[:,:,1]*=-1; lid[:,:,2]=total-lid[:,:,2]   # documented transform back to assembled frame
def ray(tri,o,d):
    """Moller-Trumbore: sorted distances of all hits along ray"""
    o=np.array(o,float);d=np.array(d,float)
    a=tri[:,0];e1=tri[:,1]-a;e2=tri[:,2]-a
    p=np.cross(d,e2);det=(e1*p).sum(1);ok=abs(det)>1e-12
    inv=np.where(ok,1/np.where(ok,det,1),0);s=o-a
    u=(s*p).sum(1)*inv;q=np.cross(s,e1);v=(d*q).sum(1)*inv;t=(e2*q).sum(1)*inv
    m=ok&(u>=-1e-9)&(v>=-1e-9)&(u+v<=1+1e-9)&(t>1e-9)
    return np.sort(t[m])
D=E['dimensions'];bt=D['boardTopZ'];seam=D['seamZ'];top=D['outerMm']['z'];R=D['outerRect'];print('outer',D['outerMm'],'boardTop',bt,'seam',seam,'lipDepth',D['lipDepthMm'],'cavity z',D['cavityMm']['z'])
print('lid bbox after transform',lid.reshape(-1,3).min(0).round(3),lid.reshape(-1,3).max(0).round(3)); print('base bbox',base.reshape(-1,3).min(0).round(3),base.reshape(-1,3).max(0).round(3))
down=lambda t,x,y:ray(t,(x,y,top+5),(0,0,-1))
# M3
for h in H['board']['holes']:
    x,y=h['x'],h['y']
    b=down(base,x,y); l=down(lid,x,y)
    # hole wall radius: first r where a downward ray hits at z in standoff
    print(f" hole ({x},{y}) d={h['diameterMm']}: base axial hits={len(b)} ; lid axial hits z={[round(top+5-t,2) for t in l]}",end=' ')
    def wall(tri,z):
        return [round(float(ray(tri,(x,y,z),(c,s,0))[0]),2) for c,s in ((1,0),(0,1),(-1,0),(0,-1))]
    print('base bore r@z=5',wall(base,5.0),'lid pilot r@z=',round(bt+1,2),wall(lid,bt+1))
for a in H['apertures']:
    x,y=a['center']['x'],a['center']['y']
    if a['face']=='z_pos':
        l=down(lid,x,y)
        part=[p for p in H['parts'] if p['id']==a['part']][0]
        extra=''
        if a['purpose']=='encoder-shaft':
            shaft=[b for b in part['blocks'] if b['label']=='encoder shaft'][0]; bush=[b for b in part['blocks'] if b['label']=='encoder bushing'][0]
            rs=[float(ray(lid,(x,y,top-1),(np.cos(t),np.sin(t),0))[0]) for t in np.linspace(0,6.283,12,endpoint=False)]
            extra=f"shaft at ({shaft['x']},{shaft['y']}) offset {np.hypot(shaft['x']-x,shaft['y']-y):.3f}; bushing d={bush['w']} ; hole radius from STL {min(rs):.3f}-{max(rs):.3f}; bushing z top {bt+bush['z1']:.2f} lid top {top}; shaft top {bt+shaft['z1']:.2f}"
        if a['purpose']=='display-active-area':
            w,h=a['activeAreaMm']['w'],a['activeAreaMm']['h']; th=np.radians(a['rotationDeg'])
            blocked=0;n=0;tot=[]
            for u in np.linspace(-w/2,w/2,9):
                for v in np.linspace(-h/2,h/2,5):
                    px=x+u*np.cos(th)-v*np.sin(th);py=y+u*np.sin(th)+v*np.cos(th);n+=1
                    if len(down(lid,px,py)): blocked+=1
            active=[b for b in part['blocks'] if 'active' in b['label']][0]
            extra=f"active area centre ({active['x']},{active['y']}) vs window offset {np.hypot(active['x']-x,active['y']-y):.3f}; active-area probe points blocked by lid {blocked}/{n}; glass top z={bt+active['z1']:.2f}, lid underside {seam}, depth to outer {top-(bt+active['z1']):.2f}"
        print(f" {a['id']} {a['purpose']} @({x},{y}) rot={a['rotationDeg']} axial lid hits={len(l)} {extra}")
    else:
        z=bt+a['zMm']
        n={'y_neg':(0,1),'y_pos':(0,-1),'x_neg':(1,0),'x_pos':(-1,0)}[a['face']]
        o=(x-n[0]*20,y-n[1]*20,z)
        wall_hits=ray(base,o,(n[0],n[1],0))
        part=[p for p in H['parts'] if p['id']==a['part']][0]
        usb=[b for b in part['blocks'] if b['label']=='micro-usb'][0]
        print(f" {a['id']} {a['face']} centre x={x} z={z:.2f}; first base hit at {wall_hits[0]-20 if len(wall_hits) else None} (positive = beyond wall point); usb block centre ({usb['x']},{usb['y']}) z {bt+usb['z0']:.2f}-{bt+usb['z1']:.2f} w={usb['w']} h={usb['h']} rot={usb['rotationDeg']}; opening {a['widthMm']}x{a['heightMm']}; outer wall y={R['minY']}")
        # 4 extreme points of the USB metal shell as seen through the wall must not hit
        for ox in (-3.8,3.8):
            for oz in (bt+usb['z0']+0.05,bt+usb['z1']-0.05):
                h=ray(base,(usb['x']+ox,R['minY']-5,oz),(0,1,0))
                print(f"    probe usb shell corner dx={ox} z={oz:.2f}: first base hit {h[0]-5 if len(h) else None}")
print(' fastening',E['fastening']['screw'],'pilot depth',E['fastening']['lidPillar'])
# screw arithmetic
hd=E['fastening']['standoff']['headSeatMm']['depth']; L=int(E['fastening']['screw'].split('x')[1].split()[0])
end=hd+L; pillar=bt+E['clearancesMm']['lidPillarToBoard']
print(f" screw tip z={end}; engages pillar from z={pillar} = {end-pillar:.2f} mm; pilot ends z={min(pillar+12,top-0.8):.2f}")
print(' stack', [(p['id'],p['topAboveBoardMm']) for p in E['stack']['parts']], 'through', E['stack']['throughLid'], 'warnings', E['warnings'])
for p in E['stack']['parts']: print('   conf',p['id'],p['confidence'][:90])
