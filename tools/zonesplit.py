#!/usr/bin/env python3
"""Compute the In2 (PWR) split for tools/makezones.py: each 1 mm cell goes to the rail
whose nearest HEAVY load it is, smoothed, islands absorbed -> zones-labels.json + a picture.

Two steps (KiCad closed): dump pads with KiCad python into board.json (see
layout.md A22), then run this in that folder. Written 2026-10-03."""
D=json.load(open("board.json")); pads=D["pads"]; parts=D["parts"]
W,H,S=130,100,1.0                       # board mm, cell size
NX,NY=int(W/S),int(H/S)
# ---- heavy anchors: where each rail's real current goes (light pull-ups ride on tracks)
HEAVY = {
 "VIN_PROT": None,   # every VIN_PROT pad is a real load or source
 "+5V":  {"J49","J2","J3","J4","J5","J6","J7","K1","K2","K3","U3","U9","C28","U11","C42","LED1","C44"},
 "+3V3": {"J50","U2","C2","C3","U10","C36","C37","C38","C39","C40","C41","U4","U12","C4","C5","C48","C49","Card1","C34","C35"},
}
anch=[]
for p in pads:
    if p["net"] in HEAVY and (HEAVY[p["net"]] is None or p["ref"] in HEAVY[p["net"]]):
        anch.append((p["x"],p["y"],p["net"]))
NETS=["VIN_PROT","+5V","+3V3"]
lab=[[None]*NX for _ in range(NY)]
for j in range(NY):
    for i in range(NX):
        cx,cy=(i+0.5)*S,(j+0.5)*S
        best=min(anch, key=lambda a:(a[0]-cx)**2+(a[1]-cy)**2)
        lab[j][i]=best[2]
def smooth(lab,r=3,it=3):
    for _ in range(it):
        new=[row[:] for row in lab]
        for j in range(NY):
            for i in range(NX):
                c=collections.Counter(lab[jj][ii] for jj in range(max(0,j-r),min(NY,j+r+1)) for ii in range(max(0,i-r),min(NX,i+r+1)))
                new[j][i]=c.most_common(1)[0][0]
        lab=new
    return lab
lab=smooth(lab)
# island removal: components smaller than MIN cells take their neighbours' majority
MIN=400
def comps(lab):
    seen=[[False]*NX for _ in range(NY)]; out=[]
    for j in range(NY):
        for i in range(NX):
            if seen[j][i]: continue
            n=lab[j][i]; st=[(j,i)]; seen[j][i]=True; cells=[]
            while st:
                y,x=st.pop(); cells.append((y,x))
                for yy,xx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
                    if 0<=yy<NY and 0<=xx<NX and not seen[yy][xx] and lab[yy][xx]==n: seen[yy][xx]=True; st.append((yy,xx))
            out.append((n,cells))
    return out
for _ in range(4):
    changed=False
    for n,cells in comps(lab):
        if len(cells)<MIN:
            cs=set(cells); c=collections.Counter()
            for y,x in cells:
                for yy,xx in ((y+1,x),(y-1,x),(y,x+1),(y,x-1)):
                    if 0<=yy<NY and 0<=xx<NX and (yy,xx) not in cs: c[lab[yy][xx]]+=1
            if c:
                m=c.most_common(1)[0][0]
                for y,x in cells: lab[y][x]=m
                changed=True
    if not changed: break
json.dump(dict(S=S,lab=lab), open("labels.json","w"))
print("regions:", [(n,len(c)) for n,c in comps(lab)])
# ---- coverage report: which heavy pads land outside their own region
miss=collections.defaultdict(list)
for p in pads:
    if p["net"] in NETS:
        i,j=min(NX-1,max(0,int(p["x"]/S))),min(NY-1,max(0,int(p["y"]/S)))
        if lab[j][i]!=p["net"]: miss[p["net"]].append(f'{p["ref"]}.{p["num"]}')
for n in NETS: print(f"  {n}: {len(miss[n])} pads outside its region (need a via + short track):", " ".join(sorted(set(miss[n])))[:300])
# ---- picture
COL={"VIN_PROT":(214,96,77),"+5V":(232,190,60),"+3V3":(90,150,220)}
SC_=6; img=[[COL[lab[min(NY-1,y//SC_)][min(NX-1,x//SC_)]] for x in range(NX*SC_)] for y in range(NY*SC_)]
def box(x0,y0,x1,y1,c):
    for x in range(max(0,int(x0*SC_)),min(NX*SC_,int(x1*SC_))):
        for y in (int(y0*SC_),int(y1*SC_)-1):
            if 0<=y<NY*SC_: img[y][x]=c
    for y in range(max(0,int(y0*SC_)),min(NY*SC_,int(y1*SC_))):
        for x in (int(x0*SC_),int(x1*SC_)-1):
            if 0<=x<NX*SC_: img[y][x]=c
for pt in parts:
    if not pt["ref"].startswith(("TP","H","R","C","D")) or pt["ref"] in ("C43","C45","C11","C18","C19","C20","C22"):
        box(pt["x0"],pt["y0"],pt["x1"],pt["y1"],(30,30,30))
for p in pads:
    if p["net"] in NETS:
        x,y=int(p["x"]*SC_),int(p["y"]*SC_)
        for dy in range(-3,4):
            for dx in range(-3,4):
                if 0<=x+dx<NX*SC_ and 0<=y+dy<NY*SC_: img[y+dy][x+dx]=tuple(int(v*0.45) for v in COL[p["net"]])
raw=b"".join(b"\x00"+bytes(v for px in row for v in px) for row in img)
def chunk(t,d): return struct.pack(">I",len(d))+t+d+struct.pack(">I",zlib.crc32(t+d)&0xffffffff)
open("partition.png","wb").write(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",NX*SC_,NY*SC_,8,2,0,0,0))+chunk(b"IDAT",zlib.compress(raw,9))+chunk(b"IEND",b""))
print("partition.png written")
