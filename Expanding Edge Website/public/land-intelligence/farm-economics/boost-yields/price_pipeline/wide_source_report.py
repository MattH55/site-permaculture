"""§56 output writers for the v3 source-discovery-first layer.

Every deliverable is derived from discovery/fetch results that already carry their
honesty metadata — these writers format, they never re-classify. A file that would be
empty still gets written with its header, because a missing file looks like a crashed
run while an empty-but-headed file is an honest "nothing found".
"""

from __future__ import annotations

import csv
import html
import os

from . import wide_crop_code_map as CCM
from . import wide_source_discovery as DISC
from .wide_price_normalization import OBSERVATION_FIELDS
from .wide_source_catalog import WideSourceCatalog

V3_OUTPUT_FILES = (
    "wide_source_catalog.csv", "wide_crop_source_map.csv", "wide_crop_code_map.csv",
    "wide_search_audit.csv", "wide_manual_review.csv", "discovered_candidate_crops.csv",
    "wide_coverage_matrix.csv", "wide_fetch_summary.csv",
)


def _write_csv(path: str, rows: list[dict], fieldnames: list[str] | None = None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if fieldnames is None:
        fieldnames = list(rows[0].keys()) if rows else ["empty"]
    with open(path, "w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_source_catalog_csv(catalog: WideSourceCatalog, out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_source_catalog.csv")
    _write_csv(path, [s.to_row() for s in catalog.sources])
    return path


def write_crop_source_map(discovered: dict[str, list[DISC.CandidateSource]],
                          out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_crop_source_map.csv")
    rows = [k.to_row() for cands in discovered.values() for k in cands]
    _write_csv(path, rows, fieldnames=None if rows else [
        "crop_id", "country", "source_id", "source_name", "source_class", "price_type",
        "market_level", "match_method", "match_confidence", "status", "access_status",
        "source_authority_score", "frequency", "historical_available", "data_url",
        "source_url", "currency", "retrieval_blockers"])
    return path


def write_crop_code_map(seed, catalog: WideSourceCatalog, out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_crop_code_map.csv")
    _write_csv(path, CCM.code_map_rows(seed, catalog),
               fieldnames=["crop_id", "source_id", "source_code",
                           "match_confidence", "note"])
    return path


def write_search_audit(seed, catalog: WideSourceCatalog, checked_at: str,
                       out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_search_audit.csv")
    _write_csv(path, DISC.search_audit_rows(seed, catalog, checked_at))
    return path


def write_manual_review(seed, catalog: WideSourceCatalog, out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_manual_review.csv")
    _write_csv(path, DISC.manual_review_rows(seed, catalog),
               fieldnames=["crop", "issue", "detail", "action"])
    return path


def write_candidate_crops(seed, catalog: WideSourceCatalog, out_dir: str) -> str:
    path = os.path.join(out_dir, "discovered_candidate_crops.csv")
    _write_csv(path, DISC.candidate_crop_rows(seed, catalog),
               fieldnames=["candidate_name", "source", "source_category",
                           "reason_candidate"])
    return path


def write_coverage_matrix(discovered: dict[str, list[DISC.CandidateSource]],
                          countries: list[str], out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_coverage_matrix.csv")
    _write_csv(path, DISC.coverage_matrix_rows(discovered, countries),
               fieldnames=["crop"] + list(countries))
    return path


def write_fetch_summary(report, out_dir: str) -> str:
    path = os.path.join(out_dir, "wide_fetch_summary.csv")
    _write_csv(path, [o.to_row() for o in report.outcomes],
               fieldnames=["crop_id", "country", "source_id", "retrieved", "status",
                           "n_observations", "reason", "raw_file", "sha256", "error"])
    return path


def write_observations(observations: list, out_dir: str) -> str | None:
    """§56 observations.parquet when a parquet engine exists, else CSV. None if empty."""
    if not observations:
        return None
    rows = [o.to_row() for o in observations]
    try:  # parquet preferred (§56); CSV is the dependency-free fallback
        import pandas as pd  # noqa: PLC0415
        path = os.path.join(out_dir, "observations.parquet")
        pd.DataFrame(rows, columns=list(OBSERVATION_FIELDS)).to_parquet(path, index=False)
        return path
    except Exception:
        path = os.path.join(out_dir, "observations.csv")
        _write_csv(path, rows, fieldnames=list(OBSERVATION_FIELDS))
        return path


# --------------------------------------------------------------------- §43/§44 HTML

def write_coverage_report_html(discovered: dict[str, list[DISC.CandidateSource]],
                               seed, checked_at: str, countries: list[str],
                               out_dir: str) -> str:
    """§43/§44 human coverage report: breadth table + crop x country matrix.

    The legend states explicitly that cells are *discovered source classes* — places a
    price credibly exists — not retrieved prices. That sentence is the difference
    between this report and an overclaim.
    """
    path = os.path.join(out_dir, "wide_coverage_report.html")
    matrix = DISC.coverage_matrix_rows(discovered, countries)
    breadth = {r["crop"]: r for r in DISC.breadth_rows(discovered, seed, checked_at)}
    esc = html.escape
    head = "".join(f"<th>{esc(c)}</th>" for c in countries)
    body = []
    for row in matrix:
        cells = "".join(f"<td>{esc(str(row[c]))}</td>" for c in countries)
        b = breadth[row["crop"]]
        body.append(
            f"<tr><th>{esc(row['crop'])}</th>{cells}"
            f"<td>{b['candidate_sources']}</td><td>{b['usable_price_sources']}</td>"
            f"<td>{b['price_observations']}</td></tr>")
    doc = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Wide price source coverage (v3)</title>
<style>
body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #222; }}
table {{ border-collapse: collapse; font-size: 0.85rem; }}
th, td {{ border: 1px solid #bbb; padding: 0.25rem 0.5rem; text-align: left; }}
thead th {{ background: #eee; }}
</style></head><body>
<h1>Specialty-crop price source coverage &mdash; v3 discovery layer</h1>
<p>Generated {esc(checked_at)}. Class codes:
GS government statistics, GMN government market news, GT government trade,
PO producer organization, AM auction market, WM wholesale market, RD retail data,
EX exchange, UE university extension, ID industry data, CD commercial data, OT other.
<strong>*</strong> = at least one price-carrying, non-blocked source in that class.</p>
<p><strong>Honesty note:</strong> cells list source classes <em>discovered</em> for each
crop&times;country &mdash; places a price credibly exists &mdash; not retrieved prices.
An empty cell (&mdash;) means nothing cataloged, <em>not</em> that no source exists in
the world.</p>
<table><thead><tr><th>crop</th>{head}<th>sources</th><th>usable</th><th>obs</th></tr></thead>
<tbody>{''.join(body)}</tbody></table>
</body></html>
"""
    os.makedirs(out_dir, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)
    return path


def write_all(discovered: dict[str, list[DISC.CandidateSource]], seed,
              catalog: WideSourceCatalog, checked_at: str, countries: list[str],
              out_dir: str, fetch_report=None) -> dict[str, str]:
    """Write every §56 deliverable; returns {name: path} for the CLI to report."""
    written = {
        "source_catalog": write_source_catalog_csv(catalog, out_dir),
        "crop_source_map": write_crop_source_map(discovered, out_dir),
        "crop_code_map": write_crop_code_map(seed, catalog, out_dir),
        "search_audit": write_search_audit(seed, catalog, checked_at, out_dir),
        "manual_review": write_manual_review(seed, catalog, out_dir),
        "candidate_crops": write_candidate_crops(seed, catalog, out_dir),
        "coverage_matrix": write_coverage_matrix(discovered, countries, out_dir),
        "coverage_html": write_coverage_report_html(
            discovered, seed, checked_at, countries, out_dir),
    }
    if fetch_report is not None:
        written["fetch_summary"] = write_fetch_summary(fetch_report, out_dir)
        obs_path = write_observations(fetch_report.observations, out_dir)
        if obs_path:
            written["observations"] = obs_path
    return written
