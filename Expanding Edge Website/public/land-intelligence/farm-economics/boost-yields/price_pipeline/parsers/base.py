"""Shared parser scaffolding."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from typing import Any, Callable, Iterator

from ..models import Observation
from ..registry import SourceSpec


@dataclass(frozen=True)
class ParseContext:
    """Everything a parser needs besides its config: the artifact and its digest.

    ``sha256`` and ``retrieved_at`` are threaded through every observation so the
    emitted dataset can be tied back to the exact bytes it was parsed from. Without
    that, a re-download that silently changes history is undetectable.
    """

    source: SourceSpec
    raw_path: str
    sha256: str
    retrieved_at: str

    @classmethod
    def build(cls, source: SourceSpec, *, retrieved_at: str) -> "ParseContext":
        path = source.raw_path
        if not os.path.exists(path):
            raise FileNotFoundError(f"raw artifact missing for {source.source_id}: {path}")
        digest = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                digest.update(chunk)
        return cls(source=source, raw_path=path, sha256=digest.hexdigest(),
                   retrieved_at=retrieved_at)


def raw_repr_of(obj: Any, max_chars: int = 900) -> dict[str, Any]:
    """Compact original record, JSON-safe, size-bounded.

    The full original row is kept so a later re-normalization never has to trust
    this pipeline's interpretation of history -- but floats coming from PDF
    coordinates are not JSON-friendly, so everything is coerced to primitives.
    """
    if isinstance(obj, dict):
        out = {}
        for k, v in obj.items():
            if isinstance(v, (str, int, bool)) or v is None:
                out[str(k)] = v[:200] if isinstance(v, str) else v
            elif isinstance(v, float):
                out[str(k)] = round(v, 6)
            else:
                out[str(k)] = str(v)[:200]
        text = repr(out)
        return {"row": out} if len(text) <= max_chars else {"row": out, "truncated": True}
    return {"repr": str(obj)[:max_chars]}


ParserFn = Callable[[ParseContext, dict[str, Any]], Iterator[Observation]]
