"""Pull M-Lab NDT7 + annotation2 for Alberta servers and write test-level speeds.

Source: public GCS archive documented at
https://d3f2vqxgk3exj.cloudfront.net/data/  (M-Lab NDT archive)
https://storage.googleapis.com/archive-measurement-lab/
"""

from __future__ import annotations

import gzip
import io
import json
import tarfile
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "mlab"
PROC = ROOT / "data" / "processed"
API = "https://www.googleapis.com/storage/v1/b/archive-measurement-lab/o"
MEDIA = "https://storage.googleapis.com/archive-measurement-lab/"
METROS = ("yyc", "yeg")  # Calgary, Edmonton — primary Alberta NDT sites


def list_objects(glob: str) -> list[dict]:
    items = []
    page = None
    while True:
        q = {"matchGlob": glob, "maxResults": "1000"}
        if page:
            q["pageToken"] = page
        url = API + "?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={"User-Agent": "SPI-mlab-ingest/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        items.extend(payload.get("items") or [])
        page = payload.get("nextPageToken")
        if not page:
            break
    return items


def hour_ok(name: str, every_hours: int) -> bool:
    # .../20260715T123000....tgz
    base = name.rsplit("/", 1)[-1]
    try:
        stamp = base.split("T", 1)[1][:2]
        hour = int(stamp)
    except (IndexError, ValueError):
        return True
    return hour % every_hours == 0


def download(name: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    url = MEDIA + urllib.parse.quote(name)
    req = urllib.request.Request(url, headers={"User-Agent": "SPI-mlab-ingest/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp, dest.open("wb") as fh:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)
    return dest


def parse_annotation_tgz(path: Path) -> list[dict]:
    rows = []
    with tarfile.open(path, "r:gz") as tf:
        for member in tf.getmembers():
            if not member.isfile():
                continue
            raw = tf.extractfile(member).read()
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception:
                try:
                    data = json.loads(gzip.decompress(raw).decode("utf-8"))
                except Exception:
                    continue
            client = (data.get("Client") or {}).get("Geo") or {}
            net = (data.get("Client") or {}).get("Network") or {}
            if client.get("Subdivision1ISOCode") != "AB" and client.get("Subdivision1Name") != "Alberta":
                if client.get("CountryCode") != "CA":
                    continue
                # keep CA-AB only; skip other provinces
                if str(client.get("Subdivision1ISOCode") or "") != "AB":
                    continue
            lat = client.get("Latitude")
            lon = client.get("Longitude")
            if lat is None or lon is None:
                continue
            rows.append(
                {
                    "uuid": data.get("UUID"),
                    "ts": data.get("Timestamp"),
                    "lat": lat,
                    "lon": lon,
                    "city": client.get("City") or "",
                    "postal": client.get("PostalCode") or "",
                    "accuracy_km": client.get("AccuracyRadiusKm"),
                    "asn": net.get("ASNumber"),
                    "isp": net.get("ASName") or "",
                    "server": ((data.get("Server") or {}).get("Site") or ""),
                }
            )
    return rows


def _meta_map(items) -> dict:
    out = {}
    for item in items or []:
        if isinstance(item, dict) and item.get("Name"):
            out[item["Name"]] = item.get("Value")
    return out


def _mbps(block: dict | None, direction: str) -> float | None:
    if not block:
        return None
    measures = block.get("ServerMeasurements") or []
    if not measures:
        return None
    tcp = measures[-1].get("TCPInfo") or {}
    # Download: server sends, use bytes acked. Upload: server receives.
    nbytes = tcp.get("BytesAcked") if direction == "download" else tcp.get("BytesReceived")
    elapsed = tcp.get("ElapsedTime")
    if not nbytes or not elapsed:
        return None
    return (8.0 * float(nbytes)) / float(elapsed)


def _min_rtt_ms(block: dict | None) -> float | None:
    if not block:
        return None
    measures = block.get("ServerMeasurements") or []
    if not measures:
        return None
    tcp = measures[-1].get("TCPInfo") or {}
    rtt = tcp.get("MinRTT")
    if rtt is None:
        return None
    return float(rtt) / 1000.0


def parse_ndt7_tgz(path: Path) -> list[dict]:
    by_uuid: dict[str, dict] = {}
    with tarfile.open(path, "r:gz") as tf:
        for member in tf.getmembers():
            if not member.isfile() or not member.name.endswith(".json.gz"):
                continue
            try:
                data = json.loads(gzip.decompress(tf.extractfile(member).read()))
            except Exception:
                continue
            direction = "download" if "ndt7-download" in member.name else "upload" if "ndt7-upload" in member.name else None
            if not direction:
                continue
            block = data.get("Download") if direction == "download" else data.get("Upload")
            if not isinstance(block, dict):
                continue
            uuid = block.get("UUID")
            if not uuid:
                continue
            rec = by_uuid.setdefault(uuid, {"uuid": uuid})
            rec[f"{direction}_mbps"] = _mbps(block, direction)
            rec[f"{direction}_rtt_ms"] = _min_rtt_ms(block)
            meta = _meta_map(block.get("ClientMetadata"))
            rec["client_name"] = meta.get("client_name") or rec.get("client_name")
            rec["client_os"] = meta.get("client_os") or rec.get("client_os")
    return list(by_uuid.values())


def daterange(days: int) -> list[date]:
    end = datetime.now(timezone.utc).date() - timedelta(days=1)
    return [end - timedelta(days=i) for i in range(days)]


def main(days: int = 8, every_hours: int = 3) -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    PROC.mkdir(parents=True, exist_ok=True)
    ann_rows: list[dict] = []
    speed_rows: list[dict] = []

    for day in daterange(days):
        ymd = day.strftime("%Y/%m/%d")
        print(f"Listing {ymd}...", flush=True)
        for metro in METROS:
            for kind, folder in (("annotation2", "ndt/annotation2"), ("ndt7", "ndt/ndt7")):
                glob = f"{folder}/{ymd}/*{metro}*"
                try:
                    objs = list_objects(glob)
                except Exception as exc:
                    print(f"  list failed {glob}: {exc}", flush=True)
                    continue
                picked = [o for o in objs if hour_ok(o["name"], every_hours)]
                print(f"  {metro} {kind}: {len(picked)}/{len(objs)} files", flush=True)
                for obj in picked:
                    name = obj["name"]
                    dest = RAW / name.replace("/", "_")
                    try:
                        download(name, dest)
                    except Exception as exc:
                        print(f"    skip {name}: {exc}", flush=True)
                        continue
                    if kind == "annotation2":
                        ann_rows.extend(parse_annotation_tgz(dest))
                    else:
                        speed_rows.extend(parse_ndt7_tgz(dest))

    ann = pd.DataFrame(ann_rows).drop_duplicates("uuid")
    spd = pd.DataFrame(speed_rows).drop_duplicates("uuid")
    print(f"annotation AB rows {len(ann)}  speed rows {len(spd)}", flush=True)
    if ann.empty:
        raise SystemExit("no Alberta annotations parsed")

    tests = ann.merge(spd, on="uuid", how="left")
    out = PROC / "alberta-mlab-tests.csv"
    tests.to_csv(out, index=False)
    print(f"wrote {out} ({len(tests)} tests, {tests['download_mbps'].notna().sum()} with download)", flush=True)
    print(tests[["city", "isp", "download_mbps", "upload_mbps", "download_rtt_ms"]].describe(include="all").to_string())
    return 0


if __name__ == "__main__":
    import sys

    days = int(sys.argv[1]) if len(sys.argv) > 1 else 8
    every = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    raise SystemExit(main(days=days, every_hours=every))
