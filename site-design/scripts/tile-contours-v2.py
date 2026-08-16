"""Tile Parkland County contours: NAD83 CSRS 10TM AEP → WGS84 GeoJSON tiles."""
import sys, os, json, struct, math

DATA = r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Land Intelligence\site-design\data\contours'
OUT = os.path.join(DATA, '..', 'contours-tiles')
SHP = os.path.join(DATA, 'ContoursIntermittent.shp')
SHX = os.path.join(DATA, 'ContoursIntermittent.shx')
DBF = os.path.join(DATA, 'ContoursIntermittent.dbf')

# ---- DBF ----
buf = open(DBF, 'rb').read()
dbf_recs = struct.unpack_from('<I', buf, 4)[0]
dbf_hdr = struct.unpack_from('<H', buf, 8)[0]
dbf_row = struct.unpack_from('<H', buf, 10)[0]
print(f'DBF: {dbf_recs} recs, hdr={dbf_hdr}, row={dbf_row}')

flds = []; off = 32
while off < dbf_hdr:
    if buf[off+11] == 0x0D: break
    name = buf[off:off+11].decode('ascii').split('\x00')[0]
    flds.append((name, off-32)); off += 32
print(f'Fields: {[f[0] for f in flds]}')

elevs = [None]*dbf_recs
for i in range(dbf_recs):
    rs = dbf_hdr + i*dbf_row
    if buf[rs] == 0x2A: continue
    vs = rs+1+flds[0][1]
    raw = buf[vs:vs+11].decode('ascii').split('\x00')[0].strip()
    if raw:
        try: elevs[i] = round(float(raw), 1)
        except: pass
print(f'Elevations loaded: {sum(1 for e in elevs if e is not None)}')

# ---- SHX ----
shx = open(SHX, 'rb').read()
nrecs = (len(shx)-100)//8
print(f'{nrecs:,} records')

# ---- Projection: NAD83 CSRS 10TM AEP Forest (Transverse Mercator, CM -115, GRS80) ----
A = 6378137; F = 1/298.257222101; E2 = 2*F-F*F
K0 = 0.9992; CM = -115; FE = 500000
E1 = (1-math.sqrt(1-E2))/(1+math.sqrt(1-E2))

def tm_to_wgs(x, y):
    try:
        dx = (x-FE)/(A*K0)
        dy = y/(A*K0)
        mu = dy
        phi1 = mu + (1.5*E1-27/32*E1**3)*math.sin(2*mu) + (21/16*E1**2-55/32*E1**4)*math.sin(4*mu) + (151/96*E1**3)*math.sin(6*mu)
        s1 = math.sin(phi1); c1 = math.cos(phi1); t1 = s1/c1
        N1 = A/math.sqrt(1-E2*s1*s1)
        R1 = A*(1-E2)/((1-E2*s1*s1)**1.5)
        D = dx/(N1*K0)
        if abs(D) > 0.5: return None  # points far from central meridian — skip
        lat = phi1 - (t1/(R1*K0))*D*D*0.5
        lng = CM + D/c1*(180/math.pi)
        return round(lat*180/math.pi,5), round(((lng+360)%360-180),5)
    except: return None

# ---- Tiling ----
shp_fd = open(SHP, 'rb')
TILE = 0.05; tiles = {}; skip = 0; proc = 0

for i in range(nrecs):
    off = struct.unpack_from('>I', shx, 100+i*8)[0]*2
    clen = struct.unpack_from('>I', shx, 100+i*8+4)[0]*2
    if clen < 12: skip += 1; continue
    shp_fd.seek(off+8)
    data = shp_fd.read(clen)
    typ = struct.unpack_from('<I', data, 0)[0]
    if typ not in (3,13,23): skip += 1; continue
    np = struct.unpack_from('<I', data, 44)[0]
    npt = struct.unpack_from('<I', data, 48)[0]
    if npt<2 or npt>50000: skip+=1; continue
    parts = [struct.unpack_from('<I', data, 52+p*4)[0] for p in range(np)]
    poff = 52+np*4
    pts = []
    for p in range(npt):
        ox = struct.unpack_from('<d', data, poff+p*16)[0]
        oy = struct.unpack_from('<d', data, poff+p*16+8)[0]
        pts.append(tm_to_wgs(ox, oy))
    elev = elevs[i] if i<len(elevs) else None
    for p in range(np):
        s = parts[p]; e = parts[p+1] if p+1<np else npt
        if e-s<2: continue
        line = [[ll[1], ll[0]] for ll in pts[s:e]]  # [lng,lat]
        mid = line[len(line)//2]
        key = f'{int(mid[1]//TILE)}_{int(mid[0]//TILE)}'
        tiles.setdefault(key, []).append({
            'type':'Feature',
            'geometry':{'type':'LineString','coordinates':line},
            'properties':{'elevation_m':elev} if elev else {}
        })
        if len(tiles[key])>=4000: break
    proc += 1
    if proc%200000==0: print(f'  {proc:,} recs, {len(tiles):,} tiles')

shp_fd.close()
print(f'Done: {proc:,} processed, {skip:,} skipped, {len(tiles):,} tiles')

# ---- Write ----
os.makedirs(OUT, exist_ok=True)
idx = []
for key, feats in tiles.items():
    ty,tx = map(int, key.split('_'))
    gj = {'type':'FeatureCollection','features':feats,'bbox':[tx*TILE, ty*TILE, (tx+1)*TILE, (ty+1)*TILE]}
    fname = f'{key}.json'
    json.dump(gj, open(os.path.join(OUT, fname), 'w'), separators=(',',':'))
    idx.append({'key':key,'file':fname,'n':len(feats)})
json.dump({'tileSize':TILE,'total':len(tiles),'tiles':idx}, open(os.path.join(OUT,'index.json'),'w'))
total_feat = sum(t['n'] for t in idx)
total_mb = sum(os.path.getsize(os.path.join(OUT, t['file'])) for t in idx)/1024/1024
print(f'Wrote {len(idx)} tiles, {total_feat:,} features, {total_mb:.1f} MB')