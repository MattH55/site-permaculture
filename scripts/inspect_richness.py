"""Inspect the richness_all_species.gdb and write a summary JSON."""
import pyogrio, zipfile, tempfile, shutil, os, json, sys

zips = {
    'all_species': r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Expanding Edge\richness_all_species.zip',
    'birds': r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Expanding Edge\richness_birds.zip',
    'mammals': r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Expanding Edge\richness_mammals.zip',
}

results = {}
for key, zip_path in zips.items():
    if not os.path.exists(zip_path):
        results[key] = {'error': f'File not found: {zip_path}'}
        continue
    try:
        z = zipfile.ZipFile(zip_path)
        tmpdir = tempfile.mkdtemp()
        z.extractall(tmpdir)
        # Find the .gdb directory
        gdb_dirs = [d for d in os.listdir(tmpdir) if d.endswith('.gdb')]
        if not gdb_dirs:
            results[key] = {'error': 'No .gdb found in zip'}
            shutil.rmtree(tmpdir)
            continue
        gdb_path = os.path.join(tmpdir, gdb_dirs[0])
        layers = pyogrio.list_layers(gdb_path)
        layer_info = []
        for layer_row in layers:
            name = str(layer_row[0])
            geom_type = str(layer_row[1]) if len(layer_row) > 1 else 'unknown'
            df = pyogrio.read_dataframe(gdb_path, layer=name, max_features=5)
            cols = [c for c in df.columns if c != 'geometry']
            sample = {}
            for _, row in df.head(2).iterrows():
                sample_row = {}
                for c in cols:
                    v = row[c]
                    sample_row[c] = str(v) if v is not None else None
                sample[f'row_{_}'] = sample_row
            layer_info.append({
                'name': name,
                'geom_type': geom_type,
                'total_rows': len(df),
                'columns': cols,
                'crs': str(df.crs),
                'sample': sample,
            })
        results[key] = {'layers': layer_info}
        shutil.rmtree(tmpdir)
    except Exception as e:
        results[key] = {'error': str(e)}

out_path = r'c:\Users\matth\OneDrive\Documents\Sovereign Policy Institute\Permaculture\Expanding Edge\richness_summary.json'
with open(out_path, 'w') as f:
    json.dump(results, f, indent=2, default=str)
print(f'Written to {out_path}')
print(json.dumps(results, indent=2, default=str))