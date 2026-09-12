"""On-demand environmental hotspot clustering for the hackathon MVP.

Hotspots are derived from verified incidents instead of introducing another
database table. The algorithm is intentionally deterministic and bounded for
the expected dataset; PostGIS narrows the candidate query when a map centre is
supplied.
"""

from __future__ import annotations

import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from sqlalchemy import cast, func
from sqlalchemy.orm import Session
from geoalchemy2 import Geography

from .models import Incident, IncidentNote
from .taxonomy import canonical_category


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))

MAX_CANDIDATES = 1000
DEFAULT_RADIUS_KM = 0.75
DEFAULT_WINDOW_DAYS = 30


def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _confidence(incident: Incident) -> float:
    value = incident.ai_confidence
    if value is None and isinstance(incident.ai_analysis, dict):
        value = incident.ai_analysis.get("confidence")
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def _severity_weight(value: str | None) -> float:
    return {"low": 0.25, "medium": 0.5, "high": 0.75, "critical": 1.0}.get(
        str(value or "medium").lower(), 0.5
    )


def _candidate_rows(
    db: Session,
    *,
    center_lat: float | None = None,
    center_lng: float | None = None,
    radius_km: float | None = None,
    since: datetime | None = None,
    category: str | None = None,
    severity: str | None = None,
) -> list[Incident]:
    q = (
        db.query(Incident)
        .filter(Incident.status == "verified")
        .order_by(Incident.created_at.asc(), Incident.id.asc())
    )
    if since is not None:
        q = q.filter(Incident.created_at >= since)
    if severity is not None:
        q = q.filter(Incident.severity == severity)
    # Category is stored in ai_analysis for the current schema, so it remains
    # a portable Python filter after the bounded candidate query.
    # Use the indexed Supabase PostGIS geography column for map-centred reads.
    if center_lat is not None and center_lng is not None and radius_km is not None:
        from geoalchemy2.functions import ST_DWithin, ST_MakePoint, ST_SetSRID

        point = cast(
            ST_SetSRID(ST_MakePoint(center_lng, center_lat), 4326),
            Geography("POINT", srid=4326),
        )
        q = q.filter(ST_DWithin(Incident.location, point, radius_km * 1000))
    rows = q.limit(MAX_CANDIDATES).all()
    if category is not None:
        wanted = canonical_category(category)
        rows = [
            row
            for row in rows
            if canonical_category((row.ai_analysis or {}).get("category")) == wanted
        ]
    return rows


def _union_find_clusters(rows: list[Incident], radius_km: float, window_days: int) -> list[list[Incident]]:
    parents = list(range(len(rows)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parents[root_right] = root_left

    max_age = window_days * 86400
    for left, first in enumerate(rows):
        for right in range(left + 1, len(rows)):
            second = rows[right]
            if canonical_category((first.ai_analysis or {}).get("category")) != canonical_category(
                (second.ai_analysis or {}).get("category")
            ):
                continue
            if abs((_utc(second.created_at) - _utc(first.created_at)).total_seconds()) > max_age:
                continue
            if haversine_km(first.lat, first.lng, second.lat, second.lng) <= radius_km:
                union(left, right)

    grouped: dict[int, list[Incident]] = {}
    for index, row in enumerate(rows):
        grouped.setdefault(find(index), []).append(row)
    return [grouped[key] for key in sorted(grouped)]


def _trend(rows: list[Incident]) -> str:
    if len(rows) < 2:
        return "isolated"
    ordered = sorted(rows, key=lambda row: (_utc(row.created_at), str(row.id)))
    midpoint = len(ordered) / 2
    first_half = len(ordered[: int(midpoint)])
    second_half = len(ordered[int(midpoint) :])
    if second_half > first_half:
        return "rising"
    if second_half < first_half:
        return "declining"
    return "stable"


def _cluster_payload(rows: list[Incident], now: datetime) -> dict:
    ordered = sorted(rows, key=lambda row: (_utc(row.created_at), str(row.id)))
    category = canonical_category((ordered[0].ai_analysis or {}).get("category"))
    centroid_lat = sum(row.lat for row in ordered) / len(ordered)
    centroid_lng = sum(row.lng for row in ordered) / len(ordered)
    distances = [haversine_km(centroid_lat, centroid_lng, row.lat, row.lng) for row in ordered]
    mean_distance_km = sum(distances) / len(distances)
    first_seen = _utc(ordered[0].created_at)
    last_seen = _utc(ordered[-1].created_at)
    span_days = max(0.0, (last_seen - first_seen).total_seconds() / 86400)
    recurrence = min(1.0, max(0, len(ordered) - 1) / 4)
    recency = max(0.0, 1.0 - max(0.0, (now - last_seen).total_seconds() / 86400) / 30)
    severity = sum(_severity_weight(row.severity) for row in ordered) / len(ordered)
    confidence = sum(_confidence(row) for row in ordered) / len(ordered)
    concentration = max(0.0, 1.0 - min(1.0, mean_distance_km / DEFAULT_RADIUS_KM))
    score = round(100 * (0.30 * recurrence + 0.20 * recency + 0.20 * severity + 0.15 * confidence + 0.15 * concentration))
    reporters = {str(row.reporter_id) for row in ordered if row.reporter_id}
    severity_summary = dict(sorted(Counter(row.severity or "medium" for row in ordered).items()))
    span_label = "within 24 hours" if span_days < 1 else f"across {span_days:.1f} days"
    return {
        "id": f"{category}:{centroid_lat:.5f}:{centroid_lng:.5f}",
        "category": category,
        "centroid": {"lat": round(centroid_lat, 6), "lng": round(centroid_lng, 6)},
        "report_count": len(ordered),
        "unique_contributors": len(reporters),
        "first_observed": first_seen.isoformat(),
        "last_observed": last_seen.isoformat(),
        "severity_summary": severity_summary,
        "latest_status": ordered[-1].status or "verified",
        "persistence_score": score,
        "trend": _trend(ordered),
        "mean_distance_km": round(mean_distance_km, 3),
        "report_ids": [str(row.id) for row in ordered],
        "explanation": (
            f"{len(ordered)} {category.replace('_', ' ')} observations from "
            f"{len(reporters)} contributor(s) {span_label}; "
            f"mean spread {mean_distance_km:.2f} km; "
            f"average confidence {confidence:.0%}."
        ),
    }


def _staff_payload(groups: list[list[Incident]], db: Session) -> list[dict]:
    """Build staff-only metadata without exposing it on the public contract."""

    all_ids = [row.id for group in groups for row in group]
    note_counts: dict[str, int] = {}
    if all_ids:
        note_counts = {
            str(incident_id): int(count)
            for incident_id, count in (
                db.query(IncidentNote.incident_id, func.count(IncidentNote.id))
                .filter(IncidentNote.incident_id.in_(all_ids))
                .group_by(IncidentNote.incident_id)
                .all()
            )
        }

    payload = []
    for group in groups:
        ordered = sorted(group, key=lambda row: (_utc(row.created_at), str(row.id)))
        assignments = [
            {
                "incident_id": str(row.id),
                "assigned_to": str(row.assigned_to) if row.assigned_to else None,
                "status": "assigned" if row.assigned_to else "unassigned",
            }
            for row in ordered
        ]
        payload.append(
            {
                "related_incident_ids": [str(row.id) for row in ordered],
                "assignment_status": {
                    "assigned": sum(1 for row in ordered if row.assigned_to),
                    "unassigned": sum(1 for row in ordered if not row.assigned_to),
                    "by_incident": assignments,
                },
                "evidence_counts": {
                    "reports": len(ordered),
                    "photos": sum(1 for row in ordered if row.photo_url),
                    "notes": sum(note_counts.get(str(row.id), 0) for row in ordered),
                },
            }
        )
    return payload


def detect_hotspots(
    db: Session,
    *,
    radius_km: float = DEFAULT_RADIUS_KM,
    window_days: int = DEFAULT_WINDOW_DAYS,
    limit: int = 50,
    center_lat: float | None = None,
    center_lng: float | None = None,
    category: str | None = None,
    severity: str | None = None,
    trend: str | None = None,
    include_staff_details: bool = False,
) -> list[dict]:
    """Return deterministic clusters of verified, high-confidence observations."""

    since = datetime.now(timezone.utc) - timedelta(days=window_days)
    wanted_category = canonical_category(category) if category is not None else None
    rows = [
        row
        for row in _candidate_rows(
            db,
            center_lat=center_lat,
            center_lng=center_lng,
            radius_km=radius_km if center_lat is not None and center_lng is not None else None,
            since=since,
            category=category,
            severity=severity,
        )
        if row.status == "verified"
        and _confidence(row) >= 0.7
        and _utc(row.created_at) >= since
        and (
            wanted_category is None
            or canonical_category((row.ai_analysis or {}).get("category")) == wanted_category
        )
        and (severity is None or row.severity == severity)
    ]
    clusters = _union_find_clusters(rows, max(0.05, min(radius_km, 25)), max(1, min(window_days, 365)))
    now = datetime.now(timezone.utc)
    payload = [_cluster_payload(group, now) for group in clusters]
    if trend is not None:
        payload = [item for item in payload if item["trend"] == trend]
    payload.sort(key=lambda item: (-item["persistence_score"], item["category"], item["id"]))
    payload = payload[: max(1, min(limit, 100))]
    if include_staff_details and payload:
        details = _staff_payload(clusters, db)
        # Match the filtered/sorted payloads back to their source cluster by
        # the first deterministic incident id, without changing public output.
        for item in payload:
            source = next(
                (
                    detail
                    for detail in details
                    if detail["related_incident_ids"] == item["report_ids"]
                ),
                None,
            )
            if source:
                item.update(source)
    return payload
