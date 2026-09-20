"""Explicit, idempotent KAN-38 demo fixtures for the shared Supabase database.

This module is intentionally reachable only through an authenticated, opt-in
admin API route. It never deletes or alters non-demo records.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from geoalchemy2.elements import WKTElement
from sqlalchemy.orm import Session

from .models import Incident, IncidentNote, Staff, StatusHistory, User
from .storage import get_storage
from .worker import ANALYSIS_VERSION

DEMO_MARKER = "[CW-DEMO:KAN-38]"


@dataclass(frozen=True)
class FixtureReport:
    slug: str
    contributor: str
    category: str
    title: str
    description: str
    lat: float
    lng: float
    days_ago: int
    severity: str
    status: str = "verified"


# Every group is deliberately small enough to read in the demo:
# 3 reports -> rising; 4 reports -> stable; 1 report -> isolated.
FIXTURES = (
    FixtureReport("flood-01", "a", "flooding", "Flooding at Riverside crossing", "Flood water is covering the footpath after overnight rain.", 18.62040, 73.90520, 14, "high"),
    FixtureReport("flood-02", "b", "flooding", "Flooding returning at Riverside crossing", "Water remains on the route and is restricting access for pedestrians.", 18.62058, 73.90534, 7, "high"),
    FixtureReport("flood-03", "c", "flooding", "Flooding worsening at Riverside crossing", "The flooded section has widened after fresh rain this morning.", 18.62023, 73.90505, 1, "critical"),
    FixtureReport("waste-01", "d", "waste", "Waste accumulating beside Green Park", "Uncollected street garbage is spilling from bins near the park entrance.", 18.59000, 73.81750, 12, "medium"),
    FixtureReport("waste-02", "e", "waste", "Waste still present beside Green Park", "Garbage bags remain beside the same public bin after collection time.", 18.59015, 73.81738, 9, "medium"),
    FixtureReport("waste-03", "f", "waste", "Waste pile at Green Park entrance", "Loose waste is affecting the pedestrian edge of the park.", 18.58986, 73.81762, 5, "medium"),
    FixtureReport("waste-04", "g", "waste", "Recurring waste beside Green Park", "The same bin area needs a sanitation visit before the next collection cycle.", 18.59007, 73.81756, 2, "medium"),
    FixtureReport("pothole-01", "h", "damaged_infrastructure", "Pothole near Library junction", "A deep pothole is visible in the lane approaching the junction.", 18.56330, 73.96220, 3, "medium"),
    FixtureReport("drain-resolved", "i", "blocked_drain", "Blocked drain cleared on Market Lane", "The drain was blocked after rain; the response team has cleared it and water is flowing again.", 18.57620, 73.93190, 8, "high", "resolved"),
)


# Pexels hosts these traceable, real environmental photographs on a CDN the local
# API can fetch. No image is committed to the repository.
PHOTO_SOURCES = {
    "flooding": "https://images.pexels.com/photos/14562092/pexels-photo-14562092.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "waste": "https://images.pexels.com/photos/7635129/pexels-photo-7635129.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "damaged_infrastructure": "https://images.pexels.com/photos/16368407/pexels-photo-16368407.jpeg?auto=compress&cs=tinysrgb&w=1200",
    "blocked_drain": "https://images.pexels.com/photos/8568720/pexels-photo-8568720.jpeg?auto=compress&cs=tinysrgb&w=1200",
}

EVIDENCE_PAGES = {
    "flooding": "https://www.pexels.com/photo/flooded-road-surrounded-by-trees-14562092/",
    "waste": "https://www.pexels.com/photo/empty-street-with-trash-on-ground-7635129/",
    "damaged_infrastructure": "https://www.pexels.com/photo/worker-working-by-truck-on-road-16368407/",
    "blocked_drain": "https://www.pexels.com/photo/two-cars-in-the-flooded-road-8568720/",
}


def _fixture_title(report: FixtureReport) -> str:
    return f"{DEMO_MARKER} {report.title}"


def _photo_bytes(category: str) -> tuple[bytes, str]:
    response = httpx.get(
        PHOTO_SOURCES[category],
        follow_redirects=True,
        timeout=25,
    )
    response.raise_for_status()
    content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0]
    if content_type not in {"image/jpeg", "image/png"}:
        raise RuntimeError(f"fixture source for {category} was not an image")
    if not response.content:
        raise RuntimeError(f"fixture source for {category} was empty")
    return response.content, content_type


def _existing_reports(db: Session) -> list[Incident]:
    return db.query(Incident).filter(Incident.title.like(f"{DEMO_MARKER}%")).all()


def _matches_fixture(incident: Incident, report: FixtureReport) -> bool:
    return (
        round(incident.lat, 5) == round(report.lat, 5)
        and round(incident.lng, 5) == round(report.lng, 5)
        and incident.status == report.status
        and (incident.ai_analysis or {}).get("category") == report.category
    )


def _repair_fixture_locations(db: Session, existing: list[Incident]) -> list[Incident]:
    """Repair only this fixture's own rows if a prior run used a colliding site."""

    by_title = {incident.title: incident for incident in existing}
    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    for report in FIXTURES:
        incident = by_title[_fixture_title(report)]
        incident.lat = report.lat
        incident.lng = report.lng
        incident.location = WKTElement(f"POINT({report.lng} {report.lat})", srid=4326)  # type: ignore
        incident.created_at = now - timedelta(days=report.days_ago)
        incident.status = report.status
        incident.severity = report.severity
        incident.ai_confidence = 0.92
        incident.ai_analysis = {
            "is_legitimate": True,
            "category": report.category,
            "severity": report.severity,
            "confidence": 0.92,
            "reason": "Deterministic CitiWatch demo classification from environmental evidence.",
            "analysis_version": ANALYSIS_VERSION,
        }
    db.commit()
    return [by_title[_fixture_title(report)] for report in FIXTURES]


def seed_citiwatch_demo(db: Session, staff: Staff) -> dict:
    """Create the fixed demo narrative once, preserving all unrelated data."""

    existing = _existing_reports(db)
    if existing:
        expected = {_fixture_title(report) for report in FIXTURES}
        actual = {report.title for report in existing}
        if actual == expected:
            ordered = [next(item for item in existing if item.title == _fixture_title(report)) for report in FIXTURES]
            if all(_matches_fixture(incident, report) for incident, report in zip(ordered, FIXTURES)):
                return {"created": False, "reports": ordered, "marker": DEMO_MARKER}
            return {"created": False, "repaired": True, "reports": _repair_fixture_locations(db, existing), "marker": DEMO_MARKER}
        raise ValueError("a partial CitiWatch demo fixture exists; it was left untouched")

    # Download evidence before any database mutation so a failed source leaves the
    # shared database unchanged. One source image is re-used for its report group.
    evidence = {category: _photo_bytes(category) for category in PHOTO_SOURCES}
    now = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    contributors: dict[str, User] = {}
    for report in FIXTURES:
        if report.contributor in contributors:
            continue
        device_id = f"cw-demo-kan38-{report.contributor}"
        user = db.query(User).filter_by(device_id=device_id).first()
        if user is None:
            user = User(device_id=device_id, verified=True, trust_score=0.9)
            db.add(user)
            db.flush()
        contributors[report.contributor] = user

    created: list[Incident] = []
    try:
        for report in FIXTURES:
            image, content_type = evidence[report.category]
            ext = ".png" if content_type == "image/png" else ".jpg"
            incident = Incident(
                reporter_id=contributors[report.contributor].id,
                title=_fixture_title(report),
                description=(
                    f"{report.description} {DEMO_MARKER} Evidence source: "
                    f"{EVIDENCE_PAGES[report.category]}"
                ),
                lat=report.lat,
                lng=report.lng,
                address="CitiWatch demo location",
                status="verified",
                severity=report.severity,
                ai_confidence=0.92,
                ai_analysis={
                    "is_legitimate": True,
                    "category": report.category,
                    "severity": report.severity,
                    "confidence": 0.92,
                    "reason": "Deterministic CitiWatch demo classification from environmental evidence.",
                    "analysis_version": ANALYSIS_VERSION,
                },
                created_at=now - timedelta(days=report.days_ago),
            )
            incident.location = WKTElement(f"POINT({report.lng} {report.lat})", srid=4326)  # type: ignore
            db.add(incident)
            db.flush()
            incident.photo_url = get_storage().upload(
                f"demo/kan-38/{report.slug}{ext}", image, content_type
            )
            db.add_all((
                StatusHistory(incident_id=incident.id, old_status=None, new_status="processing", changed_by=None, changed_at=incident.created_at),
                StatusHistory(incident_id=incident.id, old_status="processing", new_status="verified", changed_by=staff.id, changed_at=incident.created_at + timedelta(minutes=2)),
            ))
            if report.status == "resolved":
                incident.status = "resolved"
                db.add(StatusHistory(incident_id=incident.id, old_status="verified", new_status="resolved", changed_by=staff.id, changed_at=incident.created_at + timedelta(days=1)))
                db.add(IncidentNote(
                    incident_id=incident.id,
                    staff_id=staff.id,
                    note=f"{DEMO_MARKER} Resolution evidence: drain cleared and water flow restored during a staff follow-up.",
                    created_at=incident.created_at + timedelta(days=1),
                ))
            created.append(incident)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"created": True, "reports": created, "marker": DEMO_MARKER}
