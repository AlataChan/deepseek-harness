from __future__ import annotations

import json
from typing import Any

from octopus_kb_compound.ckr.models import CKR_VERSION, CanonicalPage


def pages_to_json(pages: list[CanonicalPage]) -> dict[str, Any]:
    return {
        "ckr_version": CKR_VERSION,
        "pages": [page.to_dict() for page in pages],
    }


def pages_from_json(data: dict[str, Any]) -> list[CanonicalPage]:
    version = str(data.get("ckr_version") or "")
    if version != CKR_VERSION:
        raise ValueError(f"unsupported CKR version: {version}")
    return [CanonicalPage.from_dict(page) for page in data.get("pages", [])]


def dumps_pages(pages: list[CanonicalPage]) -> str:
    return json.dumps(pages_to_json(pages), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def loads_pages(payload: str) -> list[CanonicalPage]:
    return pages_from_json(json.loads(payload))
