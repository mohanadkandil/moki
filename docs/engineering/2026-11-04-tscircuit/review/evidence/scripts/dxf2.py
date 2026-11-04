import sys,collections
L=[l.strip() for l in open(sys.argv[1],errors='replace')]
pairs=[(L[i],L[i+1]) for i in range(0,len(L)-1,2)]
ents=[];cur=None;sec=None;blocks=collections.defaultdict(list);bname=None
i=0
for c,v in pairs:
    if c=='2' and cur is None and v in('ENTITIES','BLOCKS','HEADER','TABLES','CLASSES','OBJECTS'): sec=v;continue
    if c=='0' and v=='ENDSEC': sec=None;cur=None;continue
    if sec not in('ENTITIES','BLOCKS'): continue
    if c=='0':
        cur={'t':v,'sec':sec}
        if sec=='ENTITIES': ents.append(cur)
        elif v=='BLOCK': bname=None
        elif v!='ENDBLK' and bname: blocks[bname].append(cur)
    elif cur is not None:
        cur.setdefault(c,[]).append(v)
        if cur['t']=='BLOCK' and c=='2': bname=v
for e in ents:
    if e['t']=='DIMENSION':
        print('dim',round(float(e['42'][0]),3),'from',[round(float(e[k][0]),2) for k in('13','23')],'to',[round(float(e[k][0]),2) for k in('14','24')],'ang',e.get('50'))
bb=[]
for e in ents:
    if e['t']=='LWPOLYLINE':
        xs=list(map(float,e['10']));ys=list(map(float,e['20']));bb.append((max(xs)-min(xs),max(ys)-min(ys),min(xs),min(ys),max(xs),max(ys),e.get('8'),len(xs)))
bb.sort(key=lambda b:-max(b[0],b[1]))
print(*[tuple(round(x,2) if isinstance(x,float) else x for x in b) for b in bb[:8]],sep='\n')
print(collections.Counter(e['2'][0] for e in ents if e['t']=='INSERT').most_common(6))
print(collections.Counter(e.get('8',['?'])[0] for e in ents).most_common(10))
