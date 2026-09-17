"""NASS QuickStats retrieval. Credentials come from NASS_API_KEY; never written to disk.

Raw JSON is stored under ``raw/nass/`` (gitignored). Discovery reads the derived
index ``raw/nass/price_received_index.json``, not the API, so tests stay offline.
"""
from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass

PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(PACKAGE_DIR)
RAW_DIR = os.path.join(PROJECT_ROOT, "raw", "nass")
INDEX_PATH = os.path.join(RAW_DIR, "price_received_index.json")
UNIVERSE_PATH = os.path.join(RAW_DIR, "price_received_commodities.json")

API_GET = "https://quickstats.nass.usda.gov/api/api_GET/"
API_PARAMS = "https://quickstats.nass.usda.gov/api/get_param_values/"
USER_AGENT = "LandIntelligence/boost-yields"

# USDA crop_id -> NASS commodity_desc. Identity traps are explicit (mustard greens
# are not NASS MUSTARD; maple the tree is not MAPLE SYRUP; culinary Piper pepper
# is not NASS PEPPERS).
NASS_COMMODITY_TO_CROP_IDS: dict[str, list[str]] = {
    "ALMONDS": ["almond"],
    "APPLES": ["apple"],
    "APRICOTS": ["apricot"],
    "ARTICHOKES": ["artichoke"],
    "ASPARAGUS": ["asparagus"],
    "AVOCADOS": ["avocado"],
    "BANANAS": ["banana"],
    "BEANS": ["bean-dry-edible"],  # NASS PRICE RECEIVED beans are dry beans, not snap
    "BEETS": ["beet-table"],
    "BLACKBERRIES": ["blackberry"],
    "BLUEBERRIES": ["blueberry"],
    "BROCCOLI": ["broccoli-including-broccoli-raab"],
    "BRUSSELS SPROUTS": ["brussels-sprout"],
    "CABBAGE": ["cabbage-including-chinese"],
    "CARROTS": ["carrot"],
    "CAULIFLOWER": ["cauliflower"],
    "CELERY": ["celery"],
    "CHERRIES": ["cherry"],
    "CRANBERRIES": ["cranberry"],
    "CUCUMBERS": ["cucumber"],
    "DATES": ["date"],
    "EGGPLANT": ["eggplant"],
    "FIGS": ["fig"],
    "GARLIC": ["garlic"],
    "GINGER ROOT": ["ginger"],
    "GRAPEFRUIT": ["citrus"],
    "GRAPES": ["grape-including-raisin"],
    "HAZELNUTS": ["hazelnut"],
    "HOPS": ["hops"],
    "KIWIFRUIT": ["kiwi"],
    "LEMONS": ["citrus"],
    "LENTILS": ["lentils"],
    "LETTUCE": ["lettuce"],
    "LIMES": ["citrus"],
    "MACADAMIAS": ["macadamia"],
    "MELONS": ["melon-all-types"],
    "MUSHROOMS": ["mushroom-cultivated"],
    "NECTARINES": ["nectarine"],
    "OKRA": ["okra"],
    "OLIVES": ["olive"],
    "ONIONS": ["onion"],
    "ORANGES": ["citrus"],
    "PAPAYAS": ["papaya"],
    "PEACHES": ["peach"],
    "PEARS": ["pear"],
    "PEAS": ["pea-dry-edible"],
    "PECANS": ["pecan"],
    "PEPPERS": ["pepper"],  # Capsicum, not culinary Piper
    "PINEAPPLES": ["pineapple"],
    "PISTACHIOS": ["pistachio"],
    "PLUMS": ["plum"],
    "PLUMS & PRUNES": ["plum"],
    "POTATOES": ["potato"],
    "PUMPKINS": ["pumpkin"],
    "RADISHES": ["radish"],
    "RASPBERRIES": ["raspberry"],
    "SPINACH": ["spinach"],
    "SQUASH": ["squash-summer-and-winter"],
    "STRAWBERRIES": ["strawberry"],
    "SWEET CORN": ["sweet-corn"],
    "SWEET POTATOES": ["sweet-potato"],
    "TANGELOS": ["citrus"],
    "TANGERINES": ["citrus"],
    "TOMATOES": ["tomato-including-tomatillo"],
    "WALNUTS": ["walnut"],
    # Present in NASS PRICE RECEIVED but MUST NOT attach to same-named specialty rows:
    # MUSTARD -> oilseed (ineligible mustard-seed), not mustard-and-other-greens
    "MUSTARD": ["mustard-seed"],
    "FLAXSEED": ["flaxseed"],
    "CANOLA": ["canola"],
    "HAY": ["hay"],
    "HEMP": ["hemp"],
    "PEANUTS": ["peanut"],
    "SUNFLOWER": ["sunflower-seed"],
    "SUGARBEETS": ["sugar-beet"],
    "RICE": ["rice-including-wild"],
    "OATS": ["oats"],
    "RYE": ["rye"],
    "SORGHUM": ["grain-sorghum"],
    # MAPLE SYRUP and HONEY exist in NASS; they have no matching USDA specialty
    # crop_id (maple/honey-locust are shade trees). Left unmapped on purpose.
}

_UNIT_PRICE_RE = re.compile(r"\$\s*/\s*(LB|TON|CWT|BU|TONNE|KG|GAL|BOX)", re.I)


def _api_key() -> str:
    key = (os.environ.get("NASS_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("NASS_API_KEY is not set")
    return key


def _get_json(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(**params) -> dict:
    q = {"key": _api_key(), "format": "JSON", **params}
    url = API_GET + "?" + urllib.parse.urlencode(q)
    data = _get_json(url)
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected QuickStats payload type {type(data)}")
    return data


def param_values(param: str, **filters) -> list[str]:
    q = {"key": _api_key(), "param": param, "format": "JSON", **filters}
    url = API_PARAMS + "?" + urllib.parse.urlencode(q)
    data = _get_json(url)
    if isinstance(data, list):
        return [str(x) for x in data]
    if isinstance(data, dict):
        vals = data.get(param) or data.get("data") or []
        return [str(x) for x in vals]
    return []


def write_raw(name: str, payload: dict | list) -> str:
    os.makedirs(RAW_DIR, exist_ok=True)
    path = os.path.join(RAW_DIR, name)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)
    return path


def _parse_value(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip().replace(",", "")
    if not text or text in {"(D)", "(NA)", "(Z)", "(X)", "(S)"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


@dataclass(frozen=True)
class NassPriceHit:
    commodity_desc: str
    short_desc: str
    year: str
    value: float
    unit_desc: str
    class_desc: str
    agg_level_desc: str
    raw_file: str

    def to_dict(self) -> dict:
        return {
            "commodity_desc": self.commodity_desc,
            "short_desc": self.short_desc,
            "year": self.year,
            "value": self.value,
            "unit_desc": self.unit_desc,
            "class_desc": self.class_desc,
            "agg_level_desc": self.agg_level_desc,
            "raw_file": self.raw_file,
        }


def _rows_to_hits(rows: list[dict], raw_file: str) -> list[NassPriceHit]:
    hits: list[NassPriceHit] = []
    for row in rows:
        unit = (row.get("unit_desc") or "").strip()
        short = (row.get("short_desc") or "").strip()
        if not _UNIT_PRICE_RE.search(unit) and "PRICE RECEIVED" not in short.upper():
            continue
        if not _UNIT_PRICE_RE.search(unit):
            continue
        value = _parse_value(row.get("Value"))
        if value is None:
            continue
        hits.append(NassPriceHit(
            commodity_desc=(row.get("commodity_desc") or "").strip(),
            short_desc=short,
            year=str(row.get("year") or ""),
            value=value,
            unit_desc=unit,
            class_desc=(row.get("class_desc") or "").strip(),
            agg_level_desc=(row.get("agg_level_desc") or "").strip(),
            raw_file=raw_file,
        ))
    return hits


def retrieve_commodity(commodity_desc: str, *, national: bool = True) -> list[NassPriceHit]:
    params = {
        "commodity_desc": commodity_desc,
        "statisticcat_desc": "PRICE RECEIVED",
    }
    if national:
        params["agg_level_desc"] = "NATIONAL"
    data = api_get(**params)
    slug = re.sub(r"[^A-Z0-9]+", "_", commodity_desc.upper()).strip("_")
    path = write_raw(f"price_received_{slug}.json", data)
    return _rows_to_hits(data.get("data") or [], os.path.relpath(path, PROJECT_ROOT))


def retrieve_price_received_universe() -> list[str]:
    commodities = param_values("commodity_desc", statisticcat_desc="PRICE RECEIVED")
    write_raw("price_received_commodities.json", {
        "retrieved_from": API_PARAMS,
        "filter": {"statisticcat_desc": "PRICE RECEIVED"},
        "commodity_desc": commodities,
    })
    return commodities


def retrieve_national_annual_years(years: list[str]) -> list[NassPriceHit]:
    hits: list[NassPriceHit] = []
    for year in years:
        data = api_get(
            statisticcat_desc="PRICE RECEIVED",
            agg_level_desc="NATIONAL",
            freq_desc="ANNUAL",
            year=year,
        )
        path = write_raw(f"price_received_national_annual_{year}.json", data)
        hits.extend(_rows_to_hits(data.get("data") or [], os.path.relpath(path, PROJECT_ROOT)))
    return hits


def _prefer_hit(a: NassPriceHit, b: NassPriceHit) -> NassPriceHit:
    if a.year != b.year:
        return a if a.year > b.year else b
    a_all = a.class_desc.upper() in {"ALL CLASSES", ""}
    b_all = b.class_desc.upper() in {"ALL CLASSES", ""}
    if a_all != b_all:
        return a if a_all else b
    return a if len(a.short_desc) <= len(b.short_desc) else b


def _latest_by_commodity(hits: list[NassPriceHit]) -> dict[str, NassPriceHit]:
    best: dict[str, NassPriceHit] = {}
    for hit in hits:
        prev = best.get(hit.commodity_desc)
        best[hit.commodity_desc] = hit if prev is None else _prefer_hit(prev, hit)
    return best


def build_index(hits: list[NassPriceHit], commodities: list[str]) -> dict:
    latest = _latest_by_commodity(hits)
    crop_hits: dict[str, list[dict]] = {}
    for commodity, hit in latest.items():
        for crop_id in NASS_COMMODITY_TO_CROP_IDS.get(commodity, []):
            crop_hits.setdefault(crop_id, []).append(hit.to_dict())
    doc = {
        "source": "NASS QuickStats api_GET statisticcat_desc=PRICE RECEIVED",
        "n_commodities_in_universe": len(commodities),
        "commodities": commodities,
        "n_commodities_with_unit_price": len(latest),
        "by_crop_id": crop_hits,
        "unmapped_with_price": sorted(
            c for c in latest if c not in NASS_COMMODITY_TO_CROP_IDS
        ),
    }
    os.makedirs(RAW_DIR, exist_ok=True)
    with open(INDEX_PATH, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2)
    return doc


def load_index(path: str | None = None) -> dict | None:
    index_path = path or INDEX_PATH
    if not os.path.exists(index_path):
        return None
    with open(index_path, encoding="utf-8") as fh:
        return json.load(fh)


def hits_for_crop(crop_id: str, index: dict | None = None) -> list[dict]:
    doc = index if index is not None else load_index()
    if not doc:
        return []
    return list((doc.get("by_crop_id") or {}).get(crop_id) or [])


def universe_contains(commodity: str, index: dict | None = None) -> bool:
    doc = index if index is not None else load_index()
    if not doc:
        return False
    return commodity.upper() in {c.upper() for c in doc.get("commodities") or []}
