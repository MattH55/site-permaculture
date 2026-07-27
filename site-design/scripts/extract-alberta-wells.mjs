/**
 * Extracts Alberta Water Wells from the Access MDB into a compact JSON file.
 * Usage: node scripts/extract-alberta-wells.mjs [mdb-path]
 * Output: data/wells/alberta-wells.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'data', 'wells');
const MDB = process.argv[2] || path.join(__dirname, '..', '..', '..', 'abwells_extracted', 'Well_Reports.mdb');

if (!fs.existsSync(MDB)) {
  console.error(`MDB not found at: ${MDB}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const outPath = JSON.stringify(path.join(outDir, 'alberta-wells.json').replace(/\\/g, '\\\\'));
const mdbPath = JSON.stringify(MDB.replace(/\\/g, '\\\\'));

const PY = `
import pyodbc, json, sys, os
from collections import defaultdict

conn = pyodbc.connect(f"DRIVER={{Microsoft Access Driver (*.mdb, *.accdb)}};DBQ={${mdbPath}}")
cur = conn.cursor()

# ---- Wells (basic loc) ----
print("Reading Wells...", file=sys.stderr)
cur.execute("SELECT [Well_ID],[Longitude],[Latitude],[Elevation],[LSD],[Section],[Township],[Range],[Meridian],[GPS_Obtained] FROM [Wells]")
cols = [d[0] for d in cur.description]
wells = {}
for row in cur.fetchall():
    d = dict(zip(cols, row))
    wells[str(d['Well_ID'])] = {
        'lng': float(d['Longitude']) if d.get('Longitude') is not None else None,
        'lat': float(d['Latitude']) if d.get('Latitude') is not None else None,
        'elev': float(d['Elevation']) if d.get('Elevation') is not None else None,
        'lsd': str(d.get('LSD') or '').strip(),
        'section': str(d.get('Section') or '').strip(),
        'twp': str(d.get('Township') or '').strip(),
        'rge': str(d.get('Range') or '').strip(),
        'mer': str(d.get('Meridian') or '').strip(),
        'gps': bool(d.get('GPS_Obtained')),
    }

# ---- Well_Reports (latest per Well_ID) ----
print("Reading Well_Reports...", file=sys.stderr)
cur.execute("""
    SELECT wr.* FROM [Well_Reports] wr
    INNER JOIN (
        SELECT [Well_ID], MAX([Date_Received]) as max_date
        FROM [Well_Reports] GROUP BY [Well_ID]
    ) latest ON wr.[Well_ID] = latest.[Well_ID] AND wr.[Date_Received] = latest.max_date
""")
cols_r = [d[0] for d in cur.description]
for row in cur.fetchall():
    d = dict(zip(cols_r, row))
    wid = str(d.get('Well_ID'))
    if wid not in wells: continue
    depth = float(d['Total_Depth_Drilled']) if d.get('Total_Depth_Drilled') is not None else None
    finish = float(d['Finished_Well_Depth']) if d.get('Finished_Well_Depth') is not None else None
    rec_rate = float(d['Recommended_Rate']) if d.get('Recommended_Rate') is not None else None
    yield_val = None
    for fk in ['Artesian_Flow_Rate', 'Recommended_Rate']:
        if fk in d and d[fk] is not None:
            try:
                yield_val = float(d[fk])
                break
            except: pass
    wells[wid].update({
        'depth_m': round(depth, 1) if depth else None,
        'finish_depth_m': round(finish, 1) if finish else None,
        'yield': round(yield_val, 2) if yield_val else None,
        'rec_rate': round(rec_rate, 2) if rec_rate else None,
        'method': str(d.get('Drilling_Method') or '')[:60].strip(),
        'work_type': str(d.get('Type_of_Work') or '')[:40].strip(),
        'use': str(d.get('Well_Use') or '')[:60].strip(),
        'aquifer': str(d.get('Model_Output_Rating') or '')[:80].strip(),
        'artesian': bool(d.get('Artesian_Flow_Flag')),
        'saline': bool(d.get('Encounter_Saline_Water_Flag')),
        'gas': bool(d.get('Encounter_Gas_Flag')),
        'date': str(d.get('Date_Received'))[:10] if d.get('Date_Received') else None,
        'total_depth_m': depth,
    })

# ---- Pump Tests (collect all, deduplicate per Well_ID later) ----
print("Reading Pump_Tests...", file=sys.stderr)
cur.execute("SELECT pt.[Well_Report_ID], pt.[Test_Date], pt.[Static_Water_Level], pt.[End_Water_Level], pt.[Water_Removal_Rate], pt.[Water_Removal_Type] FROM [Pump_Tests] pt")
cols_p = [d[0] for d in cur.description]
pump_by_wr = defaultdict(list)
for row in cur.fetchall():
    d = dict(zip(cols_p, row))
    wr_id = d.get('Well_Report_ID')
    pump_by_wr[wr_id].append(d)

# Build wr_id -> wid map
cur.execute("SELECT [Well_Report_ID], [Well_ID] FROM [Well_Reports]")
wr_to_wid = {str(row[0]): str(row[1]) for row in cur.fetchall()}

for wr_id, tests in pump_by_wr.items():
    wid = wr_to_wid.get(str(wr_id))
    if not wid or wid not in wells: continue
    # Pick the latest test
    tests.sort(key=lambda x: str(x.get('Test_Date') or ''), reverse=True)
    d = tests[0]
    swl = float(d['Static_Water_Level']) if d.get('Static_Water_Level') is not None else None
    ewl = float(d['End_Water_Level']) if d.get('End_Water_Level') is not None else None
    rr = float(d['Water_Removal_Rate']) if d.get('Water_Removal_Rate') is not None else None
    wells[wid]['pump_test'] = {
        'date': str(d.get('Test_Date'))[:10] if d.get('Test_Date') else None,
        'swl_m': round(swl, 2) if swl is not None else None,
        'end_wl_m': round(ewl, 2) if ewl is not None else None,
        'drawdown_m': round(abs(ewl - swl), 2) if (swl is not None and ewl is not None) else None,
        'rate': round(rr, 2) if rr is not None else None,
        'rate_type': str(d.get('Water_Removal_Type') or '')[:30].strip(),
    }

# ---- Chemical Analysis summary ----
print("Reading Chemical_Analysis...", file=sys.stderr)
cur.execute("""
    SELECT ca.[Well_ID], ca.[Sample_Date], ca.[Laboratory],
           ai.[Element_Name], ai.[Element_Symbol], ai.[Value]
    FROM [Chemical_Analysis] ca
    INNER JOIN [Analysis_Items] ai ON ca.[Chemical_Analysis_ID] = ai.[Chemical_Analysis_ID]
""")
cols_c = [d[0] for d in cur.description]
chem_by_wid = defaultdict(list)
for row in cur.fetchall():
    d = dict(zip(cols_c, row))
    wid = str(d.get('Well_ID') or '')
    if not wid or len(chem_by_wid[wid]) >= 200: continue
    val = d.get('Value')
    try: val = round(float(val), 2)
    except: val = str(val)[:40]
    chem_by_wid[wid].append({
        'e': (d.get('Element_Symbol') or d.get('Element_Name') or '')[:10].upper(),
        'v': val,
        'd': str(d.get('Sample_Date'))[:10] if d.get('Sample_Date') else None,
    })

key_elems = {'NA','K','CA','MG','FE','MN','CL','SO4','HCO3','TDS','PH','NO3','F','HARDNESS'}
for wid, items in chem_by_wid.items():
    if wid in wells:
        summary = {}
        for it in items:
            if it['e'] in key_elems and isinstance(it['v'], (int, float)):
                summary[it['e']] = it['v']
        if summary:
            wells[wid]['chemistry'] = {
                'n': len({(it['d'],) for it in items if it['d']}),
                'elems': summary,
                'date': items[0].get('d'),
            }

# ---- Lithology summary ----
print("Reading Lithologies...", file=sys.stderr)
cur.execute("SELECT l.[Well_Report_ID], l.[Depth], l.[Material], l.[Water_Bearing], wr.[Well_ID] FROM [Lithologies] l INNER JOIN [Well_Reports] wr ON l.[Well_Report_ID] = wr.[Well_Report_ID]")
lith_by_wid = defaultdict(list)
for row in cur.fetchall():
    wid = str(row[4]) if row[4] else None
    if not wid or len(lith_by_wid[wid]) >= 100: continue
    lith_by_wid[wid].append({
        'd': float(row[1]) if row[1] is not None else None,
        'mat': str(row[2] or '')[:60].strip(),
        'wet': bool(row[3]),
    })

for wid, entries in lith_by_wid.items():
    if wid in wells:
        entries.sort(key=lambda x: x['d'] or 0)
        wet_at = sorted(set(round(e['d'], 1) for e in entries if e['wet']))[:8]
        wells[wid]['lith_summary'] = {
            'n': len(entries),
            'top_mat': entries[0]['mat'] if entries else None,
            'wet_zones': len(wet_at),
        }
        if wet_at:
            wells[wid]['lith_summary']['wet_at_m'] = wet_at

# ---- Geophysical logs ----
print("Reading Geophysical_Logs...", file=sys.stderr)
cur.execute("SELECT wr.[Well_ID], gl.[Log_Type], gl.[Log_Taken_Flag] FROM [Geophysical_Logs] gl INNER JOIN [Well_Reports] wr ON gl.[Well_Report_ID] = wr.[Well_Report_ID]")
for row in cur.fetchall():
    wid = str(row[0])
    if wid in wells:
        w = wells[wid]
        w.setdefault('geophys', [])
        if len(w['geophys']) < 12 and row[2]:
            w['geophys'].append(str(row[1] or '')[:50].strip())

# ---- Screens ----
print("Reading Screens...", file=sys.stderr)
cur.execute("SELECT wr.[Well_ID], s.[From], s.[To], s.[Slot_Size] FROM [Screens] s INNER JOIN [Well_Reports] wr ON s.[Well_Report_ID] = wr.[Well_Report_ID]")
for row in cur.fetchall():
    wid = str(row[0])
    if wid in wells:
        w = wells[wid]
        w.setdefault('screens', [])
        if len(w['screens']) < 15:
            w['screens'].append({
                'f': round(float(row[1]), 1) if row[1] is not None else None,
                't': round(float(row[2]), 1) if row[2] is not None else None,
                'slot': str(row[3] or '')[:12].strip(),
            })

# ---- Boreholes ----
print("Reading Boreholes...", file=sys.stderr)
cur.execute("SELECT wr.[Well_ID], b.[Diameter], b.[From], b.[To] FROM [Boreholes] b INNER JOIN [Well_Reports] wr ON b.[Well_Report_ID] = wr.[Well_Report_ID]")
for row in cur.fetchall():
    wid = str(row[0])
    if wid in wells:
        w = wells[wid]
        w.setdefault('boreholes', [])
        if len(w['boreholes']) < 12:
            w['boreholes'].append({
                'dia': round(float(row[1]), 1) if row[1] is not None else None,
                'f': round(float(row[2]), 1) if row[2] is not None else None,
                't': round(float(row[3]), 1) if row[3] is not None else None,
            })

conn.close()

# Build output — compact array for radix-sorted neighbour lookup
output = []
for wid, w in wells.items():
    if w['lat'] is None or w['lng'] is None or not w.get('depth_m'): continue
    obj = {
        'i': wid,
        'la': round(w['lat'], 5),
        'lo': round(w['lng'], 5),
        'dp': w['depth_m'],
        'el': w.get('elev'),
        'yd': w.get('yield'),
        'rr': w.get('rec_rate'),
        'ls': w.get('lsd')[:30] if w.get('lsd') else None,
        'dt': w.get('date'),
        'us': w.get('use'),
        'aq': w.get('aquifer'),
        'mt': w.get('method'),
        'wt': w.get('work_type'),
        'ar': w.get('artesian'),
    }
    if w.get('pump_test'): obj['pt'] = w['pump_test']
    if w.get('chemistry'): obj['ch'] = w['chemistry']
    if w.get('lith_summary'): obj['lx'] = w['lith_summary']
    if w.get('geophys'): obj['gp'] = w['geophys'][:8]
    if w.get('screens'):
        sc = sorted([s for s in w['screens'] if s['f'] is not None], key=lambda x: x['f'])
        if sc:
            obj['sc'] = {'t': sc[0]['f'], 'b': sc[-1]['t'], 'n': len(sc)}
    if w.get('boreholes'):
        dias = sorted(set(b['dia'] for b in w['boreholes'] if b['dia']), reverse=True)[:3]
        if dias: obj['bh'] = dias
    output.append(obj)

output.sort(key=lambda x: x['i'])

with open(${outPath}, 'w') as f:
    json.dump(output, f, separators=(',',':'))

print(f"Wells: {len(output)}", file=sys.stderr)
print(f"  pump_test: {sum(1 for w in output if 'pt' in w)}  chemistry: {sum(1 for w in output if 'ch' in w)}", file=sys.stderr)
print(f"  lith: {sum(1 for w in output if 'lx' in w)}  geophys: {sum(1 for w in output if 'gp' in w)}", file=sys.stderr)
print(f"  yield: {sum(1 for w in output if w.get('yd'))}", file=sys.stderr)
print(f"  size: {os.path.getsize(${outPath}):,} bytes", file=sys.stderr)
`

const tmpPy = path.join(outDir, '_extract.py');
fs.writeFileSync(tmpPy, PY, 'utf8');
console.log(`Extracting from: ${MDB}`);
try {
  execSync(`python "${tmpPy}"`, { stdio: 'inherit' });
  const outFile = path.join(outDir, 'alberta-wells.json');
  if (fs.existsSync(outFile)) {
    const s = fs.statSync(outFile);
    console.log(`Done. ${(s.size / 1024 / 1024).toFixed(1)} MB`);
  }
} finally {
  try { fs.unlinkSync(tmpPy); } catch {}
}