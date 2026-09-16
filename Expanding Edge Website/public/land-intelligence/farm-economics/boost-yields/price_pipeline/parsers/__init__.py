"""Parser dispatch: source `parser:` key from the registry -> implementation."""

from __future__ import annotations

from . import alberta_table90, alberta_table93, afsc_agristability, afsc_spring
from . import cropping_alternatives, statcan
from .base import ParseContext

PARSERS = {
    "statcan": statcan.iter_rows,
    "alberta_table90": alberta_table90.iter_rows,
    "alberta_table93": alberta_table93.iter_rows,
    "afsc_spring": afsc_spring.iter_rows,
    "afsc_agristability": afsc_agristability.iter_rows,
    "afsc_agristability_forage": afsc_agristability.iter_rows_forage,
    "cropping_alternatives": cropping_alternatives.iter_rows,
}


def get(name: str):
    if name not in PARSERS:
        raise KeyError(f"no parser registered as {name!r}; have {sorted(PARSERS)}")
    return PARSERS[name]


__all__ = ["PARSERS", "ParseContext", "get"]
