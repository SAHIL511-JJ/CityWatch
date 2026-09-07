"""The shared environmental vocabulary used by every CityWatch surface.

The values are deliberately stable machine keys.  Labels belong in clients so
the API remains easy to filter and old records can be migrated without a
breaking rename.
"""

from __future__ import annotations

import re


ENVIRONMENTAL_CATEGORIES: tuple[str, ...] = (
    "flooding",
    "waterlogging",
    "blocked_drain",
    "waste",
    "sewage",
    "plastic",
    "pollution",
    "damaged_infrastructure",
    "other_environmental_condition",
)

ENVIRONMENTAL_CATEGORY_LABELS: dict[str, str] = {
    "flooding": "Flooding",
    "waterlogging": "Waterlogging",
    "blocked_drain": "Blocked drain",
    "waste": "Waste",
    "sewage": "Sewage",
    "plastic": "Plastic",
    "pollution": "Pollution",
    "damaged_infrastructure": "Damaged infrastructure",
    "other_environmental_condition": "Other environmental condition",
}

# These values existed before CityWatch became an environmental intelligence
# product.  They remain readable in stored analysis, but never appear as a
# normal category in new reports or filters.
LEGACY_CATEGORY_MAP: dict[str, str] = {
    "crime": "other_environmental_condition",
    "fire": "pollution",
    "accident": "damaged_infrastructure",
    "hazard": "other_environmental_condition",
    "other": "other_environmental_condition",
}


def _key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def canonical_category(value: object) -> str:
    """Return a supported environmental category for any stored/model value."""

    key = _key(value)
    if key in ENVIRONMENTAL_CATEGORIES:
        return key
    return LEGACY_CATEGORY_MAP.get(key, "other_environmental_condition")


def normalize_analysis(value: object) -> dict:
    """Normalize an old or malformed analysis without losing its raw category."""

    analysis = dict(value) if isinstance(value, dict) else {}
    raw = analysis.get("category")
    if raw is None:
        return analysis
    category = canonical_category(raw)
    if raw is not None and _key(raw) != category:
        analysis.setdefault("legacy_category", str(raw))
    analysis["category"] = category
    return analysis
