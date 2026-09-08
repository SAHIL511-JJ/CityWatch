"""Derived, read-only authority insights for the CRM workspace."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from geoalchemy2 import Geography
from sqlalchemy import cast
from sqlalchemy.orm import Session

from .hotspots import (
    MAX_CANDIDATES,
    _cluster_payload,
    _confidence,
    _union_find_clusters,
    _utc,
)
from .models import Incident
from .taxonomy import canonical_category


def _query_rows(
    db: Session,
    *,
    window_days: int,
    radius_km: float,
    center_lat: float | None,
    center_lng: float | None,
    category: str | None,
    severity: str | None,
    min_lat: float | None,
    min_lng: float | None,
    max_lat: float | None,
    max_lng: float | None,
) -> list[Incident]:
    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    q = (
        db.query(Incident)
        .filter(Incident.status == "verified", Incident.created_at >= since)
        .order_by(Incident.created_at.asc(), Incident.id.asc())
    )
    if severity:
        q = q.filter(Incident.severity == severity)
    if min_lat is not None:
        q = q.filter(Incident.lat >= min_lat)
    if max_lat is not None:
        q = q.filter(Incident.lat <= max_lat)
    if min_lng is not None:
        q = q.filter(Incident.lng >= min_lng)
    if max_lng is not None:
        q = q.filter(Incident.lng <= max_lng)
    if center_lat is not None and center_lng is not None:
        from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID

        point = cast(
            ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326),
            Geography("POINT", srid=4326),
        )
        q = q.filter(ST_DWithin(Incident.location, point, radius_km * 1000))

    rows = q.limit(MAX_CANDIDATES).all()
    wanted = canonical_category(category) if category else None
    return [
        row
        for row in rows
        if _confidence(row) >= 0.7
        and (
            wanted is None
            or canonical_category((row.ai_analysis or {}).get("category")) == wanted
        )
    ]


def _day_series(rows: list[Incident], window_days: int) -> list[dict]:
    counts = Counter((_utc(row.created_at).date().isoformat() for row in rows))
    today = datetime.now(timezone.utc).date()
    return [
        {
            "date": (today - timedelta(days=offset)).isoformat(),
            "count": int(counts.get((today - timedelta(days=offset)).isoformat(), 0)),
        }
        for offset in range(window_days - 1, -1, -1)
    ]


def _summary(rows: list[Incident], window_days: int) -> dict:
    categories = Counter(
        canonical_category((row.ai_analysis or {}).get("category")) for row in rows
    )
    severities = Counter(str(row.severity or "medium") for row in rows)
    return {
        "total": len(rows),
        "by_category": [
            {"name": name, "count": count}
            for name, count in sorted(categories.items(), key=lambda item: (-item[1], item[0]))
        ],
        "by_severity": [
            {"severity": name, "count": count}
            for name, count in sorted(severities.items(), key=lambda item: (-item[1], item[0]))
        ],
        "by_day": _day_series(rows, window_days),
    }


def build_insights(
    db: Session,
    *,
    window_days: int = 30,
    radius_km: float = 0.75,
    center_lat: float | None = None,
    center_lng: float | None = None,
    category: str | None = None,
    severity: str | None = None,
    min_lat: float | None = None,
    min_lng: float | None = None,
    max_lat: float | None = None,
    max_lng: float | None = None,
    limit: int = 3,
) -> dict:
    rows = _query_rows(
        db,
        window_days=window_days,
        radius_km=radius_km,
        center_lat=center_lat,
        center_lng=center_lng,
        category=category,
        severity=severity,
        min_lat=min_lat,
        min_lng=min_lng,
        max_lat=max_lat,
        max_lng=max_lng,
    )
    clusters = _union_find_clusters(rows, radius_km, window_days)
    now = max(
        (_utc(row.created_at) for row in rows),
        default=datetime.now(timezone.utc),
    )
    narratives = [_cluster_payload(group, now) for group in clusters]
    narratives.sort(key=lambda item: (-item["persistence_score"], item["category"], item["id"]))
    points = [
        {
            "id": str(row.id),
            "lat": row.lat,
            "lng": row.lng,
            "title": row.title,
            "status": row.status,
            "severity": row.severity,
            "category": canonical_category((row.ai_analysis or {}).get("category")),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rows
    ]
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scope": {
            "window_days": window_days,
            "radius_km": radius_km,
            "center": {"lat": center_lat, "lng": center_lng}
            if center_lat is not None and center_lng is not None
            else None,
            "bounds": {
                "min_lat": min_lat,
                "min_lng": min_lng,
                "max_lat": max_lat,
                "max_lng": max_lng,
            }
            if all(value is not None for value in (min_lat, min_lng, max_lat, max_lng))
            else None,
            "category": category,
            "severity": severity,
        },
        "summary": _summary(rows, window_days),
        "narratives": narratives[: max(1, min(limit, 10))],
        "signal_count": len(narratives),
        "map_points": points,
    }
