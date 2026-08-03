"""Convert supplied species-richness FileGDB archives to production GeoJSON JSON."""
import json
import math
import os
import shutil
import tempfile
import zipfile

import pyogrio

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARCHIVES = {
    "all_species": "richness_all_species.zip",
    "birds": "richness_birds.zip",
    "mammals": "richness_mammals.zip",
}

GRID_DEG = 0.05
layers = []
for layer_id, archive_name in ARCHIVES.items():
    archive_path = os.path.join(BASE, archive_name)
    tmpdir = tempfile.mkdtemp(prefix="ee-richness-")
    try:
        with zipfile.ZipFile(archive_path) as archive:
            archive.extractall(tmpdir)
        gdb_name = next(name for name in os.listdir(tmpdir) if name.endswith(".gdb"))
        gdb_path = os.path.join(tmpdir, gdb_name)
        layer_name = str(pyogrio.list_layers(gdb_path)[0][0])
        # The source is a 664k-cell raster-like fishnet. Aggregate all cells
        # into a compact 0.05-degree screening grid for the Node pipeline.
        # Use feature bounds rather than Shapely centroids: this avoids
        # materialising hundreds of thousands of polygon objects.
        _, bounds = pyogrio.read_bounds(gdb_path, layer=layer_name)
        attributes = pyogrio.read_dataframe(
            gdb_path, layer=layer_name, columns=["VALUE"], read_geometry=False
        )
        sums = {}
        counts = {}
        for index, value in enumerate(attributes["VALUE"]):
            if value is None or not math.isfinite(float(value)):
                continue
            west, south, east, north = bounds[:, index]
            lat = round(((float(south) + float(north)) / 2) / GRID_DEG) * GRID_DEG
            lng = round(((float(west) + float(east)) / 2) / GRID_DEG) * GRID_DEG
            key = f"{lat:.2f},{lng:.2f}"
            sums[key] = sums.get(key, 0.0) + float(value)
            counts[key] = counts.get(key, 0) + 1
        cells = [
            {
                "lat": float(key.split(",")[0]),
                "lng": float(key.split(",")[1]),
                "value": round(sums[key] / counts[key], 2),
                "n": counts[key],
            }
            for key in sums
        ]
        layers.append({
            "id": layer_id,
            "source_file": archive_name,
            "cells": cells,
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

output_dir = os.path.join(BASE, "site-design", "data", "biodiversity")
os.makedirs(output_dir, exist_ok=True)
output_path = os.path.join(output_dir, "species-richness.json")
with open(output_path, "w", encoding="utf-8") as output:
    json.dump({
        "source": "Supplied Alberta species-richness File Geodatabases",
        "crs": "EPSG:4326",
        "resolution_degrees": GRID_DEG,
        "note": "Values are means of supplied source cells aggregated to a 0.05-degree grid for report screening.",
        "layers": layers,
    }, output, separators=(",", ":"))
print(output_path)
print(os.path.getsize(output_path))