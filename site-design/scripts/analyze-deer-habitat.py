"""Analyze ABMI deer habitat suitability GeoTIFF for a given polygon.

Usage: python scripts/analyze-deer-habitat.py <geojson_polygon.json> <raster.tif>

Output (JSON to stdout):
{
  "available": true,
  "mean_suitability": 0.65,
  "max_suitability": 0.92,
  "pct_high": 34.5,
  "pct_moderate": 28.1,
  "pct_low": 37.4,
  "interpretation": "High deer habitat suitability"
}

If rasterio is not installed: pip install rasterio
"""

import json, sys, os

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"available": False, "error": "Usage: analyze-deer-habitat.py <geojson.json> <raster.tif>"}))
        sys.exit(1)

    geojson_path = sys.argv[1]
    raster_path = sys.argv[2]

    if not os.path.exists(raster_path):
        print(json.dumps({"available": False, "error": f"Raster not found: {raster_path}"}))
        sys.exit(1)

    if not os.path.exists(geojson_path):
        print(json.dumps({"available": False, "error": f"GeoJSON not found: {geojson_path}"}))
        sys.exit(1)

    try:
        import rasterio
        from rasterio.mask import mask
        import numpy as np
    except ImportError:
        print(json.dumps({"available": False, "error": "rasterio not installed. Run: pip install rasterio"}))
        sys.exit(1)

    try:
        # Load polygon
        with open(geojson_path) as f:
            geojson = json.load(f)

        geom = geojson.get("features", [{}])[0].get("geometry", geojson)
        if geom.get("type") != "Polygon" and geom.get("type") != "MultiPolygon":
            print(json.dumps({"available": False, "error": "GeoJSON must be Polygon or MultiPolygon"}))
            sys.exit(1)

        # Open raster and mask to polygon
        with rasterio.open(raster_path) as src:
            out_image, out_transform = mask(src, [geom], crop=True, nodata=src.nodata)
            data = out_image[0]
            valid = data[data != src.nodata] if src.nodata is not None else data[data > -9999]

            if len(valid) == 0:
                print(json.dumps({
                    "available": True,
                    "mean_suitability": None,
                    "interpretation": "No data within polygon — polygon may be outside raster extent."
                }))
                return

            mean_val = float(np.mean(valid))
            max_val = float(np.max(valid))

            # Thresholds for high/moderate/low (adjust per species)
            high_thresh = 0.60
            mod_thresh = 0.30

            pct_high = float(np.sum(valid >= high_thresh) / len(valid) * 100)
            pct_moderate = float(np.sum((valid >= mod_thresh) & (valid < high_thresh)) / len(valid) * 100)
            pct_low = float(np.sum(valid < mod_thresh) / len(valid) * 100)

            if mean_val >= 0.65:
                interpretation = "High white-tailed deer habitat suitability — expect significant browse pressure on new plantings."
            elif mean_val >= 0.35:
                interpretation = "Moderate deer habitat suitability — plan for tree guards and deer-resistant species."
            else:
                interpretation = "Low deer habitat suitability — basic monitoring recommended."

            print(json.dumps({
                "available": True,
                "source": os.path.basename(raster_path),
                "mean_suitability": round(mean_val, 3),
                "max_suitability": round(max_val, 3),
                "pct_high_suitability": round(pct_high, 1),
                "pct_moderate_suitability": round(pct_moderate, 1),
                "pct_low_suitability": round(pct_low, 1),
                "sample_count": len(valid),
                "interpretation": interpretation,
            }))

    except Exception as e:
        print(json.dumps({"available": False, "error": str(e)}))

if __name__ == "__main__":
    main()