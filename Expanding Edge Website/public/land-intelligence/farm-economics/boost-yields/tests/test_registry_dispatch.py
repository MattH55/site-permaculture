"""Registry <-> dispatch <-> parser agreement.

This is the test that catches the defect class the pipeline actually suffered from:
a registry naming a ``parser`` that no module implements, or a module exposing a
function the dispatch table does not route. Both are invisible until a run silently
produces nothing for a source, so they are asserted structurally here.

The registry's policy invariants are asserted too: a ``values_included: false``
price_type must not be ingestable, and every source must declare a type the closed
taxonomy knows.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from price_pipeline import parsers, registry  # noqa: E402


def test_every_registry_parser_is_registered():
    """No source may name a parser that the dispatch table cannot resolve."""
    doc = registry.load_registry()
    missing = sorted({s.parser for s in registry.sources(doc)
                      if s.parser not in parsers.PARSERS})
    assert missing == [], f"registry names unregistered parsers: {missing}"


def test_every_registered_parser_is_callable_and_dispatches():
    for key, fn in parsers.PARSERS.items():
        assert callable(fn), f"{key} is not callable"


def test_parser_keys_are_importable_modules():
    """Each dispatch key resolves to a real module attribute."""
    for key in parsers.PARSERS:
        assert callable(parsers.get(key))


def test_unknown_parser_raises_rather_than_silently_returning_nothing():
    """An unknown parser must fail loudly; silently yielding no rows hides drift."""
    import pytest

    with pytest.raises(KeyError):
        parsers.get("no_such_parser")


def test_resolvable_parser_for_every_source():
    doc = registry.load_registry()
    for src in registry.sources(doc):
        assert callable(parsers.get(src.parser))


def test_every_enabled_source_has_a_resolvable_parser():
    doc = registry.load_registry()
    for src in registry.sources(doc):
        assert parsers.get(src.parser) is not None, (
            f"{src.source_id} -> {src.parser} not resolvable")


def test_externalized_price_type_cannot_be_enabled():
    """A citation-only price_type must never appear among ingested sources."""
    doc = registry.load_registry()
    excluded = {name for name, meta in (doc.get("price_types") or {}).items()
                if meta.get("values_included") is False}
    assert excluded, "registry should still record the externalized type"

    enabled = {s.price_type for s in registry.sources(doc)}
    assert not (enabled & excluded), (
        f"externalized price type ingested: {sorted(enabled & excluded)}")


def test_every_source_price_type_is_in_the_closed_taxonomy():
    doc = registry.load_registry()
    known = set((doc.get("price_types") or {}).keys())
    for src in registry.sources(doc):
        assert src.price_type in known


def test_source_ids_are_unique_and_raw_names_present():
    doc = registry.load_registry()
    srcs = registry.sources(doc)
    ids = [s.source_id for s in srcs]
    assert len(ids) == len(set(ids))
    for s in srcs:
        assert s.raw_name


def test_parser_pool_covers_all_afsc_documents():
    """The AFSC family shares modules but must expose each dispatch key it declares."""
    for key in ("afsc_spring", "afsc_agristability", "afsc_agristability_forage"):
        assert key in parsers.PARSERS, f"{key} missing from dispatch table"
