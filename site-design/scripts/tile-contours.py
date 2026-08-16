"""Tile Parkland County contours using pyshp (no GDAL needed)."""
import json, math, os
import shapefile

SHP = r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Land Intelligence\site-design\data\contours\ContoursIntermittent.shp'
OUT = os.path.join(os.path.dirname(SHP), '..', 'contours-tiles')

# ---- Projection constants (10TM AEP Forest, NAD83 CSRS) ----
A = 6378137.0
F = 1 / 298.257222101
E2 = 2*F - F*F
K0 = 0.9992
CM_DEG = -115.0
FE = 500000.0
E1 = (1 - math.sqrt(1-E2)) / (1 + math.sqrt(1-E2))

def tm_to_wgs(x, y):
    dx = (x - FE) / (A * K0)
    dy = y / (A * K0)
    mu = dy
    phi1 = mu + (1.5*E1 - 27/32*E1**3)*math.sin(2*mu) + (21/16*E1**2 - 55/32*E1**4)*math.sin(4*mu) + (151/96*E1**3)*math.sin(6*mu)
    s1 = math.sin(phi1); c1 = math.cos(phi1); t1 = s1/c1
    N1 = A / math.sqrt(1 - E2*s1*s1)
    R1 = A * (1 - E2) / ((1 - E2*s1*s1) ** 1.5)
    D = dx / (N1 * K0)
    lat = phi1 - (t1 / (R1 * K0)) * D*D * 0.5
    lng = CM_DEG + D / c1 * (180 / math.pi)
    return round(lat*180/math.pi, 5), round(((lng+360)%360-180), 5)

# ---- Process ----
print('Reading shapefile with pyshp...')
sf = shapefile.Reader(SHP)
records = sf.records()
shapes = sf.shapes()
total = len(shapes)
print(f'{total:,} features')

TILE = 0.05
tiles = {}
skip = 0

for i, shp in enumerate(shapes):
    if i % 100000 == 0: print(f'  {i:,} / {total:,}')
    pts = shp.points
    if len(pts) < 2: skip += 1; continue
    
    # Reproject
    wgs_pts = [tm_to_wgs(x, y) for x, y in pts]
    line = [[lng, lat] for lat, lng in wgs_pts]
    
    # Elevation from DBF
    elev = None
    if i < len(records):
        try:
            val = float(records[i][0])
            elev = round(val, 1)
        except: pass
    
    # Assign to tile by midpoint
    mid = line[len(line)//2]
    key = f'{int(mid[1]//TILE)}_{int(mid[0]//TILE)}'
    tiles.setdefault(key, []).append({
        'type': 'Feature',
        'geometry': {'type': 'LineString', 'coordinates': line},
        'properties': {'elevation_m': elev} if elev else {}
    })
    if len(tiles[key]) >= 8000: break  # cap per tile

print(f'{len(tiles):,} tiles, {skip:,} skipped')

# ---- Write ----
os.makedirs(OUT, exist_ok=True)
idx = []
for key, feats in tiles.items():
    ty, tx = map(int, key.split('_'))
    gj = {'type': 'FeatureCollection', 'features': feats, 'bbox': [tx*TILE, ty*TILE, (tx+1)*TILE, (ty+1)*TILE]}
    fname = f'{key}.json'
    json.dump(gj, open(os.path.join(OUT, fname), 'w'), separators=(',',':'))
    idx.append({'key': key, 'file': fname, 'n': len(feats)})

json.dump({'tileSize': TILE, 'total': len(tiles), 'tiles': idx}, open(os.path.join(OUT, 'index.json'), 'w'))
total_mb = sum(os.path.getsize(os.path.join(OUT, t['file'])) for t in idx) / 1024 / 1024
print(f'Wrote {len(idx)} tiles, {total_mb:.1f} MB')
sf.close()