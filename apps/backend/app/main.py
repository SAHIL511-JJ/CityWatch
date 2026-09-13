import math
from datetime import datetime, timedelta

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, case, func, or_, text
from sqlalchemy.orm import Session

from . import auth
from .auth import (
    check_code,
    create_token,
    get_current_staff,
    get_current_user,
    new_code,
    store_code,
)
from .config import settings
from .db import SessionLocal, get_db
from .incident_status import (
    AI_SOURCE_STATUSES,
    ALL_INCIDENT_STATUSES,
    TRIAGE_STATUSES as POLICY_TRIAGE_STATUSES,
    allowed_manual_statuses,
    can_manual_transition,
)
from .models import (
    Category,
    Incident,
    IncidentNote,
    ResolutionEvidence,
    Staff,
    StatusHistory,
    User,
)
from .resolution_evidence import (
    AUTHORITY_START_STATUSES,
    OPERATIONAL_STATUSES,
    RESOLUTION_STATUSES,
    add_status_history,
    build_public_resolution,
    clean_hotspot_snapshot_id,
    clean_note,
    clean_optional_note,
    current_pending_follow_up,
    latest_authority_evidence,
    ordered_evidence,
    private_evidence_out,
    public_evidence_out,
    public_history_out,
    resolution_incident_out,
    upload_evidence_photo,
)
from .storage import get_storage
from .taxonomy import (
    ENVIRONMENTAL_CATEGORIES,
    canonical_category,
    normalize_analysis,
)

app = FastAPI(title=settings.APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
TRIAGE_STATUSES = POLICY_TRIAGE_STATUSES
VALID_INCIDENT_STATUSES = ALL_INCIDENT_STATUSES
PUBLIC_CITIZEN_INCIDENT_STATUSES = {"verified", "awaiting_verification"}
TERMINAL_INCIDENT_STATUSES = {"resolved", "community_confirmed", "closed"}
INCIDENT_QUEUES = {"mine", "unassigned"}
INCIDENT_SORTS = {"newest", "oldest", "severity", "action"}
INCIDENT_STATES = {"needs_attention", "resolved"}
INCIDENT_SLA_FILTERS = {"overdue", "breaching"}
NEEDS_ATTENTION_STATUSES = {
    "processing",
    "needs_review",
    "verified",
    "escalated",
    "awaiting_verification",
    "needs_follow_up",
}
RESOLVED_INCIDENT_STATUSES = {"resolved", "community_confirmed"}


# ---------- schemas ----------
class AnonymousIn(BaseModel):
    device_id: str
    fcm_token: str | None = None


class SendCodeIn(BaseModel):
    phone: str | None = None
    email: str | None = None


class VerifyIn(BaseModel):
    phone: str | None = None
    email: str | None = None
    code: str
    device_id: str | None = None
    fcm_token: str | None = None


class AdminLoginIn(BaseModel):
    email: str
    password: str


class AdminPatchIn(BaseModel):
    status: str | None = None
    status_reason: str | None = Field(default=None, max_length=2000)
    severity: str | None = None
    assigned_to: str | None = None


class NoteIn(BaseModel):
    note: str


class AdminIncidentPage(BaseModel):
    items: list[dict]
    total: int
    page: int
    page_size: int
    total_pages: int


class BulkFiltersIn(BaseModel):
    q: str | None = Field(default=None, max_length=100)
    status: str | None = None
    severity: str | None = None
    queue: str | None = None
    window_days: int | None = Field(default=None, ge=1, le=365)
    state: str | None = None
    sla: str | None = None


class ResolutionReviewIn(BaseModel):
    outcome: str
    review_note: str | None = None


HOTSPOT_TRENDS = {"rising", "stable", "declining", "isolated"}
HOTSPOT_SEVERITIES = {"low", "medium", "high", "critical"}


class HotspotCentroid(BaseModel):
    lat: float = Field(description="Latitude of the derived hotspot centroid")
    lng: float = Field(description="Longitude of the derived hotspot centroid")


class PublicHotspotOut(BaseModel):
    """Safe hotspot data shared with authenticated citizen clients."""

    id: str
    category: str
    centroid: HotspotCentroid
    report_count: int
    unique_contributors: int
    first_observed: str
    last_observed: str
    severity_summary: dict[str, int]
    latest_status: str
    persistence_score: int
    trend: str
    mean_distance_km: float
    report_ids: list[str]
    explanation: str

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "id": "flooding:18.5204:73.8552",
                "category": "flooding",
                "centroid": {"lat": 18.5204, "lng": 73.8552},
                "report_count": 4,
                "unique_contributors": 3,
                "first_observed": "2026-09-01T08:00:00+00:00",
                "last_observed": "2026-09-08T08:00:00+00:00",
                "severity_summary": {"high": 2, "medium": 2},
                "latest_status": "verified",
                "persistence_score": 78,
                "trend": "rising",
                "mean_distance_km": 0.18,
                "report_ids": ["incident-1", "incident-2"],
                "explanation": "4 flooding observations from 3 contributor(s) across 7.0 days; mean spread 0.18 km; average confidence 91%.",
            }
        }
    )


class HotspotAssignment(BaseModel):
    incident_id: str
    assigned_to: str | None
    status: str


class HotspotAssignmentStatus(BaseModel):
    assigned: int
    unassigned: int
    by_incident: list[HotspotAssignment]


class HotspotEvidenceCounts(BaseModel):
    reports: int
    photos: int
    notes: int


class StaffHotspotOut(PublicHotspotOut):
    related_incident_ids: list[str]
    assignment_status: HotspotAssignmentStatus
    evidence_counts: HotspotEvidenceCounts


# ---------- helpers ----------
def _is_uuid(v: str | None) -> bool:
    if not v:
        return False
    try:
        __import__("uuid").UUID(v)
        return True
    except (ValueError, AttributeError):
        return False


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def incident_out(i: Incident) -> dict:
    analysis = normalize_analysis(i.ai_analysis)
    return {
        "id": str(i.id),
        "title": i.title,
        "description": i.description,
        "photo_url": i.photo_url,
        "lat": i.lat,
        "lng": i.lng,
        "address": i.address,
        "status": i.status,
        "severity": i.severity,
        "ai_confidence": i.ai_confidence,
        "ai_analysis": analysis,
        "reporter_id": str(i.reporter_id) if i.reporter_id else None,
        "assigned_to": str(i.assigned_to) if i.assigned_to else None,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def admin_incident_out(i: Incident) -> dict:
    out = incident_out(i)
    out["allowed_statuses"] = list(allowed_manual_statuses(i.status))
    return out


def public_incident_out(i: Incident) -> dict:
    """Return public incident fields; never expose private IDs."""

    out = incident_out(i)
    out.pop("reporter_id", None)
    out.pop("assigned_to", None)
    return out


def _resolution_history(db: Session, incident_id: str) -> list[StatusHistory]:
    return (
        db.query(StatusHistory)
        .filter_by(incident_id=incident_id)
        .order_by(StatusHistory.changed_at.asc(), StatusHistory.id.asc())
        .all()
    )


def _resolution_photo_redirect(photo_url: str | None):
    """Return a short-lived redirect for a private evidence object."""
    from fastapi.responses import RedirectResponse

    if not photo_url:
        raise HTTPException(404, "photo unavailable")
    key = photo_url.replace("\\", "/").strip()
    if not key.startswith(f"{settings.STORAGE_BUCKET}/"):
        raise HTTPException(404, "photo unavailable")
    if not settings.SUPABASE_SERVICE_KEY:
        raise HTTPException(404, "photo unavailable")
    try:
        url = get_storage().signed_url(key.split("/", 1)[1])
    except Exception as exc:
        raise HTTPException(502, f"photo unavailable: {exc}") from exc
    return RedirectResponse(url, status_code=302)


def enqueue_analysis(incident_id: str) -> bool:
    """Queue analysis when Redis is available; report whether it was queued."""
    try:
        import socket
        from urllib.parse import urlparse

        pr = urlparse(settings.REDIS_URL)
        sock = socket.create_connection(
            (pr.hostname or "localhost", pr.port or 6379), timeout=1
        )
        sock.close()
    except Exception:
        return False
    try:
        from .worker import analyze_incident

        getattr(analyze_incident, "delay")(str(incident_id))
        return True
    except Exception:
        return False


def seed() -> None:
    # Supabase migrations own schema creation. Startup only seeds idempotent
    # application data after the managed schema is present.
    db = SessionLocal()
    try:
        existing_categories = {c.name for c in db.query(Category).all()}
        for name, icon in [
            ("flooding", "water_drop"),
            ("waterlogging", "waves"),
            ("blocked_drain", "plumbing"),
            ("waste", "delete_sweep"),
            ("sewage", "sanitizer"),
            ("plastic", "recycling"),
            ("pollution", "air"),
            ("damaged_infrastructure", "construction"),
            ("other_environmental_condition", "eco"),
        ]:
            if name not in existing_categories:
                db.add(Category(name=name, icon=icon))
        if db.query(Staff).count() == 0:
            db.add(
                Staff(
                    email="admin@example.com",
                    password_hash=auth.hash_password("admin123"),
                    role="admin",
                )
            )
        db.commit()
    finally:
        db.close()


@app.on_event("startup")
def _startup():
    try:
        seed()
    except Exception:
        pass  # surfaced on first request if DB unreachable


# ---------- auth ----------
@app.post("/auth/anonymous")
def anonymous(body: AnonymousIn, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(device_id=body.device_id).first()
    if u is None:
        u = User(
            device_id=body.device_id,
            verified=False,
            trust_score=auth.TRUST_ANON,
            fcm_token=body.fcm_token,
        )
        db.add(u)
        db.commit()
        db.refresh(u)
    elif body.fcm_token:
        u.fcm_token = body.fcm_token
        db.commit()
    token = create_token(u.id, {"verified": u.verified, "trust": u.trust_score})
    return {"token": token, "user_id": str(u.id), "verified": u.verified}


@app.post("/auth/send-code")
def send_code(body: SendCodeIn):
    key = body.phone or body.email
    if not key:
        raise HTTPException(400, "phone or email required")
    code = new_code()
    store_code(key, code)
    # TODO: send via Resend/SMTP (email) or Twilio/Firebase (SMS). Log for MVP dev.
    print(f"[send-code] {key} -> {code}")
    return {"ok": True}


@app.post("/auth/verify")
def verify(body: VerifyIn, db: Session = Depends(get_db)):
    key = body.phone or body.email
    if not key:
        raise HTTPException(400, "phone or email required")
    if not check_code(key, body.code):
        raise HTTPException(400, "invalid or expired code")
    u = None
    if body.device_id:
        u = db.query(User).filter_by(device_id=body.device_id).first()
    if u is None and body.phone:
        u = db.query(User).filter_by(phone=body.phone).first()
    if u is None and body.email:
        u = db.query(User).filter_by(email=body.email).first()
    if u is None:
        u = User(
            device_id=body.device_id or key,
            verified=True,
            trust_score=auth.TRUST_VERIFIED,
        )
        db.add(u)
    u.phone = body.phone or u.phone
    u.email = body.email or u.email
    u.verified = True
    u.trust_score = auth.TRUST_VERIFIED
    if body.fcm_token:
        u.fcm_token = body.fcm_token
    db.commit()
    db.refresh(u)
    token = create_token(u.id, {"verified": True, "trust": u.trust_score})
    return {"token": token, "user_id": str(u.id), "verified": True}


# ---------- incidents ----------
@app.post("/incidents")
def create_incident(
    title: str = Form(...),
    description: str = Form(""),
    lat: float = Form(...),
    lng: float = Form(...),
    address: str | None = Form(None),
    photo: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    data, content_type, ext = b"", None, ".jpg"
    if photo is not None and photo.filename:
        content_type = photo.content_type or "image/jpeg"
        if content_type not in ALLOWED_TYPES:
            raise HTTPException(400, "only jpg/png allowed")
        data = photo.file.read()
        if len(data) > settings.MAX_PHOTO_MB * 1024 * 1024:
            raise HTTPException(400, f"photo over {settings.MAX_PHOTO_MB}MB")
        ext = ALLOWED_TYPES[content_type]

    inc = Incident(
        reporter_id=user.id,
        title=title,
        description=description,
        lat=lat,
        lng=lng,
        address=address,
        status="processing",
    )
    from geoalchemy2.elements import WKTElement

    inc.location = WKTElement(f"POINT({lng} {lat})", srid=4326)  # type: ignore
    db.add(inc)
    db.commit()
    db.refresh(inc)

    photo_url = None
    if data:
        try:
            photo_url = get_storage().upload(
                f"{inc.id}{ext}", data, content_type or "image/jpeg"
            )
        except Exception as e:
            photo_url = f"upload-failed:{e}"
        inc.photo_url = photo_url
        db.commit()

    db.add(
        StatusHistory(
            incident_id=inc.id,
            old_status=None,
            new_status="processing",
            changed_by=None,  # citizen-created; reporter tracked via reporter_id
        )
    )
    db.commit()
    if not enqueue_analysis(inc.id):
        # Redis/Celery is optional. Never leave a citizen's report stuck in
        # processing just because the background worker is unavailable.
        from .worker import apply_ai_result, run_ai

        try:
            result = run_ai(inc.title or "", inc.description or "", inc.photo_url)
        except Exception:
            result = {
                "is_legitimate": True,
                "category": "other_environmental_condition",
                "severity": "medium",
                "confidence": 0.0,
                "reason": "AI analysis unavailable; manual review required",
            }
        apply_ai_result(db, inc, result)
    return {"id": str(inc.id), "status": inc.status, "photo_url": photo_url}


@app.get("/incidents")
def list_incidents(
    lat: float | None = Query(None),
    lng: float | None = Query(None),
    radius_km: float = Query(10.0),
    severity: str | None = Query(None),
    category: str | None = Query(None),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    # Public feed exposes active incidents plus resolutions awaiting community review.
    q = db.query(Incident).filter(Incident.status.in_(PUBLIC_CITIZEN_INCIDENT_STATUSES))
    if severity:
        q = q.filter(Incident.severity == severity)
    # Category lives inside ai_analysis for the Supabase-backed MVP; normalize legacy
    # values while filtering so historical records remain discoverable.
    rows = q.order_by(Incident.created_at.desc()).limit(500).all()
    out = []
    for i in rows:
        if category and canonical_category((i.ai_analysis or {}).get("category")) != canonical_category(category):
            continue
        if lat is not None and lng is not None:
            if haversine_km(lat, lng, i.lat, i.lng) > radius_km:
                continue
        out.append(public_incident_out(i))
        if len(out) >= limit:
            break
    return out
    # TODO (Postgres): replace Python haversine with
    #   ST_DWithin(location, ST_MakePoint(lng,lat)::geography, radius_km*1000)


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str, db: Session = Depends(get_db)):
    i = db.get(Incident, incident_id)
    if i is None or i.status not in PUBLIC_CITIZEN_INCIDENT_STATUSES:
        raise HTTPException(404, "not found")
    return public_incident_out(i)


@app.get("/incidents/{incident_id}/resolution")
def get_incident_resolution(
    incident_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return the safe resolution timeline for an incident with evidence."""
    incident = db.get(Incident, incident_id)
    if incident is None:
        raise HTTPException(404, "not found")
    if latest_authority_evidence(db, incident.id) is None:
        raise HTTPException(404, "resolution not found")
    evidence = ordered_evidence(db, incident.id)
    history = _resolution_history(db, incident.id)
    authority = latest_authority_evidence(db, incident.id)
    can_submit = bool(
        incident.status == "awaiting_verification"
        and authority is not None
        and current_pending_follow_up(db, incident.id, authority.id) is None
    )
    return build_public_resolution(
        incident, evidence, history, can_submit_follow_up=can_submit
    )


@app.get("/resolution-evidence/{evidence_id}/photo")
def citizen_resolution_photo(
    evidence_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    evidence = db.get(ResolutionEvidence, evidence_id)
    if evidence is None or not evidence.photo_url:
        raise HTTPException(404, "photo unavailable")
    if latest_authority_evidence(db, evidence.incident_id) is None:
        raise HTTPException(404, "photo unavailable")
    return _resolution_photo_redirect(evidence.photo_url)


@app.post("/incidents/{incident_id}/resolution-evidence", status_code=201)
def submit_citizen_resolution_evidence(
    incident_id: str,
    observation: str = Form(...),
    photo: UploadFile | None = File(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incident = (
        db.query(Incident).filter(Incident.id == incident_id).with_for_update().first()
    )
    if incident is None:
        raise HTTPException(404, "not found")
    authority = latest_authority_evidence(db, incident.id)
    if authority is None:
        raise HTTPException(404, "resolution not found")
    if incident.status != "awaiting_verification":
        raise HTTPException(409, "incident is not awaiting verification")
    if current_pending_follow_up(db, incident.id, authority.id) is not None:
        raise HTTPException(409, "follow-up already pending")
    note = clean_note(observation, "observation")
    from uuid import uuid4

    evidence_id = str(uuid4())
    photo_url = upload_evidence_photo(incident.id, evidence_id, photo)
    evidence = ResolutionEvidence(
        id=evidence_id,
        incident_id=incident.id,
        parent_evidence_id=authority.id,
        evidence_type="community_follow_up",
        submitted_by=user.id,
        note=note,
        photo_url=photo_url,
        review_outcome="pending",
    )
    db.add(evidence)
    try:
        db.commit()
        db.refresh(evidence)
    except Exception as exc:
        db.rollback()
        print(f"[resolution-evidence] orphaned upload after commit failure: {photo_url}")
        raise HTTPException(502, "could not save resolution evidence") from exc
    return public_evidence_out(evidence)


@app.get("/me/incidents/{incident_id}")
def get_my_incident(
    incident_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incident = db.get(Incident, incident_id)
    if incident is None or incident.reporter_id != user.id:
        raise HTTPException(404, "not found")
    evidence = ordered_evidence(db, incident.id)
    history = _resolution_history(db, incident.id)
    authority = latest_authority_evidence(db, incident.id)
    resolution = (
        build_public_resolution(
            incident,
            evidence,
            history,
            can_submit_follow_up=bool(
                incident.status == "awaiting_verification"
                and authority is not None
                and current_pending_follow_up(db, incident.id, authority.id) is None
            ),
        )
        if authority is not None
        else None
    )
    out = {
        "incident": resolution_incident_out(incident),
        "evidence": [public_evidence_out(item) for item in evidence],
        "history": [public_history_out(item) for item in history],
    }
    if resolution is not None:
        out["resolution"] = resolution
    return out


@app.get("/incidents/{incident_id}/photo")
def public_photo(incident_id: str, db: Session = Depends(get_db)):
    """Public reels-feed photo for active and awaiting-verification incidents."""
    from fastapi.responses import RedirectResponse

    i = db.get(Incident, incident_id)
    if (
        i is None
        or not i.photo_url
        or i.status not in PUBLIC_CITIZEN_INCIDENT_STATUSES
    ):
        raise HTTPException(404, "no photo")
    key = i.photo_url.replace("\\", "/").strip()
    if key.startswith(f"{settings.STORAGE_BUCKET}/"):
        if not settings.SUPABASE_SERVICE_KEY:
            raise HTTPException(404, "photo unavailable")
        url = get_storage().signed_url(key.split("/", 1)[1])
        return RedirectResponse(url, status_code=302)
    raise HTTPException(404, "photo unavailable")


def _validate_hotspot_filters(
    *,
    lat: float | None,
    lng: float | None,
    severity: str | None,
    trend: str | None,
) -> None:
    if (lat is None) != (lng is None):
        raise HTTPException(422, "lat and lng must be provided together")
    if severity is not None and severity not in HOTSPOT_SEVERITIES:
        raise HTTPException(422, "invalid severity")
    if trend is not None and trend not in HOTSPOT_TRENDS:
        raise HTTPException(422, "invalid trend")


def _category_filter(category: str | None) -> str | None:
    if category is None:
        return None
    normalized = canonical_category(category)
    if normalized not in ENVIRONMENTAL_CATEGORIES:
        raise HTTPException(422, "invalid category")
    return normalized


@app.get(
    "/hotspots",
    response_model=list[PublicHotspotOut],
    summary="List nearby public environmental hotspots",
    description=(
        "Returns only verified, high-confidence hotspot summaries for the signed-in "
        "citizen. Reporter identity, assignment data, internal notes, and private "
        "evidence metadata are never included."
    ),
)
def public_hotspots(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(0.75, ge=0.05, le=25),
    window_days: int = Query(30, ge=1, le=365),
    limit: int = Query(20, ge=1, le=100),
    category: str | None = Query(None),
    severity: str | None = Query(None),
    trend: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_hotspot_filters(lat=lat, lng=lng, severity=severity, trend=trend)
    from .hotspots import detect_hotspots

    return detect_hotspots(
        db,
        radius_km=radius_km,
        window_days=window_days,
        limit=limit,
        center_lat=lat,
        center_lng=lng,
        category=_category_filter(category),
        severity=severity,
        trend=trend,
    )


# ---------- admin ----------
@app.post("/admin/login")
def admin_login(body: AdminLoginIn, db: Session = Depends(get_db)):
    s = db.query(Staff).filter_by(email=body.email).first()
    if s is None or not auth.verify_password(body.password, s.password_hash):
        raise HTTPException(401, "bad credentials")
    return {"token": create_token(s.id, {"role": s.role}), "role": s.role}


@app.post("/admin/demo-fixtures/citiwatch")
def seed_citiwatch_demo_fixture(
    staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)
):
    """Opt-in KAN-38 demo data for the one shared Supabase database."""

    if not settings.ENABLE_DEMO_FIXTURES:
        raise HTTPException(404, "demo fixtures are disabled")
    from .demo_fixtures import seed_citiwatch_demo

    try:
        result = seed_citiwatch_demo(db, staff)
    except ValueError as exc:
        raise HTTPException(409, str(exc))
    except Exception as exc:
        raise HTTPException(502, f"demo evidence source failed: {exc}")
    reports = result["reports"]
    return {
        "created": result["created"],
        "marker": result["marker"],
        "report_count": len(reports),
        "incident_ids": [str(report.id) for report in reports],
    }


def _clean_incident_scope(
    *,
    q: str | None,
    status: str | None,
    severity: str | None,
    queue: str | None,
    window_days: int | None,
    state: str | None,
    sla: str | None,
    sort: str,
) -> tuple[
    str | None,
    str | None,
    str | None,
    str | None,
    int | None,
    str | None,
    str | None,
    str,
]:
    clean_q = (q or "").strip() or None
    if clean_q and len(clean_q) > 100:
        raise HTTPException(422, "q must be 100 characters or fewer")
    if status is not None and status not in VALID_INCIDENT_STATUSES:
        raise HTTPException(422, "invalid incident status")
    if severity is not None and severity not in HOTSPOT_SEVERITIES:
        raise HTTPException(422, "invalid incident severity")
    if queue is not None and queue not in INCIDENT_QUEUES:
        raise HTTPException(422, "invalid incident queue")
    if window_days is not None and not 1 <= window_days <= 365:
        raise HTTPException(422, "window_days must be between 1 and 365")
    if state is not None and state not in INCIDENT_STATES:
        raise HTTPException(422, "invalid incident state")
    if sla is not None and sla not in INCIDENT_SLA_FILTERS:
        raise HTTPException(422, "invalid incident SLA filter")
    if status is not None and state is not None:
        raise HTTPException(422, "status and state cannot be combined")
    if state == "resolved" and sla is not None:
        raise HTTPException(422, "SLA filters cannot target resolved incidents")
    if sort not in INCIDENT_SORTS:
        raise HTTPException(422, "invalid incident sort")
    return clean_q, status, severity, queue, window_days, state, sla, sort


def _incident_overdue_clause():
    return or_(
        and_(Incident.severity == "critical", Incident.created_at <= func.now() - text("interval '1 hour'")),
        and_(Incident.severity == "high", Incident.created_at <= func.now() - text("interval '4 hours'")),
        and_(Incident.severity == "medium", Incident.created_at <= func.now() - text("interval '24 hours'")),
        and_(Incident.severity == "low", Incident.created_at <= func.now() - text("interval '48 hours'")),
    )


def _incident_breaching_clause():
    return or_(
        and_(Incident.severity == "critical", Incident.created_at <= func.now() - text("interval '45 minutes'")),
        and_(Incident.severity == "high", Incident.created_at <= func.now() - text("interval '3 hours'")),
        and_(Incident.severity == "medium", Incident.created_at <= func.now() - text("interval '18 hours'")),
        and_(Incident.severity == "low", Incident.created_at <= func.now() - text("interval '36 hours'")),
    )


def _apply_incident_scope(
    query,
    *,
    q: str | None,
    status: str | None,
    severity: str | None,
    queue: str | None,
    window_days: int | None,
    state: str | None,
    sla: str | None,
    staff_id: str,
):
    if q:
        pattern = f"%{q}%"
        query = query.filter(
            or_(Incident.title.ilike(pattern), Incident.description.ilike(pattern))
        )
    if status:
        query = query.filter(Incident.status == status)
    if severity:
        query = query.filter(Incident.severity == severity)
    if window_days is not None:
        query = query.filter(
            Incident.created_at >= datetime.utcnow() - timedelta(days=window_days)
        )
    if state == "needs_attention":
        query = query.filter(Incident.status.in_(NEEDS_ATTENTION_STATUSES))
    elif state == "resolved":
        query = query.filter(Incident.status.in_(RESOLVED_INCIDENT_STATUSES))
    if queue == "mine":
        query = query.filter(
            Incident.assigned_to == staff_id,
            Incident.status.notin_(TERMINAL_INCIDENT_STATUSES),
        )
    elif queue == "unassigned":
        query = query.filter(
            Incident.assigned_to.is_(None),
            Incident.status.notin_(TERMINAL_INCIDENT_STATUSES),
        )
    if sla:
        query = query.filter(Incident.status.notin_(TERMINAL_INCIDENT_STATUSES))
        query = query.filter(
            _incident_overdue_clause() if sla == "overdue" else _incident_breaching_clause()
        )
    return query


def _incident_action_rank():
    overdue = _incident_overdue_clause()
    breaching = _incident_breaching_clause()
    return case(
        (Incident.status.in_(TERMINAL_INCIDENT_STATUSES), 3),
        (overdue, 0),
        (breaching, 1),
        else_=2,
    )


def _order_incidents(query, sort: str):
    if sort == "oldest":
        return query.order_by(Incident.created_at.asc(), Incident.id.asc())
    if sort == "severity":
        severity_rank = case(
            (Incident.severity == "critical", 0),
            (Incident.severity == "high", 1),
            (Incident.severity == "medium", 2),
            else_=3,
        )
        return query.order_by(severity_rank.asc(), Incident.created_at.asc(), Incident.id.asc())
    if sort == "action":
        return query.order_by(_incident_action_rank().asc(), Incident.created_at.asc(), Incident.id.asc())
    return query.order_by(Incident.created_at.desc(), Incident.id.asc())


@app.get("/admin/incidents", response_model=AdminIncidentPage)
def admin_list(
    q: str | None = Query(None, max_length=100),
    status: str | None = None,
    severity: str | None = None,
    queue: str | None = None,
    window_days: int | None = Query(None, ge=1, le=365),
    state: str | None = None,
    sla: str | None = None,
    sort: str = Query("newest"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    q, status, severity, queue, window_days, state, sla, sort = _clean_incident_scope(
        q=q,
        status=status,
        severity=severity,
        queue=queue,
        window_days=window_days,
        state=state,
        sla=sla,
        sort=sort,
    )
    query = _apply_incident_scope(
        db.query(Incident),
        q=q,
        status=status,
        severity=severity,
        queue=queue,
        window_days=window_days,
        state=state,
        sla=sla,
        staff_id=str(staff.id),
    )
    total = query.count()
    total_pages = math.ceil(total / page_size) if total else 0
    actual_page = min(page, total_pages) if total_pages else 1
    rows = _order_incidents(query, sort).offset((actual_page - 1) * page_size).limit(page_size).all()
    return {
        "items": [admin_incident_out(row) for row in rows],
        "total": total,
        "page": actual_page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@app.patch("/admin/incidents/{incident_id}")
def admin_patch(
    incident_id: str,
    body: AdminPatchIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    i = db.get(Incident, incident_id)
    if i is None:
        raise HTTPException(404, "not found")
    old = i.status
    if body.status is not None:
        if body.status not in VALID_INCIDENT_STATUSES:
            raise HTTPException(422, "bad status")
        if body.status in RESOLUTION_STATUSES or body.status == "resolved":
            raise HTTPException(
                409,
                detail={
                    "code": "resolution_workflow_required",
                    "message": "use the resolution evidence workflow for this status",
                    "current_status": old,
                    "requested_status": body.status,
                },
            )
        if not can_manual_transition(old, body.status):
            raise HTTPException(
                409,
                detail={
                    "code": "invalid_status_transition",
                    "message": "status transition is not allowed",
                    "current_status": old,
                    "requested_status": body.status,
                    "allowed_statuses": list(allowed_manual_statuses(old)),
                },
            )
        if body.status != "closed" and body.status_reason is not None:
            raise HTTPException(422, "status_reason is only valid when closing")
        if body.status == "closed" and old != "closed":
            close_reason = clean_note(body.status_reason, "status_reason")
        else:
            close_reason = None
        i.status = body.status
    elif body.status_reason is not None:
        raise HTTPException(422, "status_reason requires status=closed")
    else:
        close_reason = None
    if body.severity:
        i.severity = body.severity
    # assigned_to uses field-set presence so explicit null unassigns.
    if "assigned_to" in body.model_fields_set:
        if body.assigned_to is not None and (
            not _is_uuid(body.assigned_to) or db.get(Staff, body.assigned_to) is None
        ):
            raise HTTPException(422, "assignee is not staff")
        i.assigned_to = body.assigned_to
    if old != i.status:
        db.add(
            StatusHistory(
                incident_id=i.id,
                old_status=old,
                new_status=i.status,
                changed_by=staff.id,
            )
        )
        if close_reason is not None:
            db.add(
                IncidentNote(
                    incident_id=i.id,
                    staff_id=staff.id,
                    note=f"Emergency close: {close_reason}",
                )
            )
    db.commit()
    db.refresh(i)
    return admin_incident_out(i)


@app.post("/admin/incidents/{incident_id}/notes")
def admin_note(
    incident_id: str,
    body: NoteIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    if db.get(Incident, incident_id) is None:
        raise HTTPException(404, "not found")
    n = IncidentNote(incident_id=incident_id, staff_id=staff.id, note=body.note)
    db.add(n)
    db.commit()
    db.refresh(n)
    return {
        "id": str(n.id),
        "note": n.note,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


# ---------- staff directory (KAN-17) ----------
@app.get("/admin/me")
def admin_me(staff: Staff = Depends(get_current_staff)):
    return {"id": str(staff.id), "email": staff.email, "role": staff.role}


@app.get("/admin/staff")
def admin_staff(
    staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)
):
    rows = db.query(Staff).order_by(Staff.email.asc()).all()
    out = []
    for s in rows:
        open_count = (
            db.query(func.count())
            .filter(
                Incident.assigned_to == s.id,
                Incident.status.notin_(["resolved", "community_confirmed", "closed"]),
            )
            .scalar()
        )
        out.append(
            {
                "id": str(s.id),
                "email": s.email,
                "role": s.role,
                "open_count": int(open_count or 0),
            }
        )
    return out


# ---------- suspected duplicates + merge (KAN-15) ----------
import re as _re


def _norm_title(t: str | None) -> str:
    t = (t or "").lower().strip()
    t = _re.sub(r"[^a-z0-9\s]", "", t)
    return _re.sub(r"\s+", " ", t)


@app.get("/admin/incidents/duplicates")
def admin_duplicates(
    staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)
):
    """Pairs with same normalized title within 150m and 24h, scored 0-100.
    Closed records (incl. already-merged) are never candidates."""
    rows = (
        db.query(Incident)
        .filter(Incident.status != "closed")
        .order_by(Incident.created_at.asc())
        .limit(500)
        .all()
    )
    pairs = []
    for x in range(len(rows)):
        for y in range(x + 1, len(rows)):
            a, b = rows[x], rows[y]
            if not a.title or _norm_title(a.title) != _norm_title(b.title):
                continue
            dist_m = haversine_km(a.lat, a.lng, b.lat, b.lng) * 1000
            if dist_m > 150:
                continue
            try:
                hours = abs((a.created_at - b.created_at).total_seconds()) / 3600
            except Exception:
                continue
            if hours > 24:
                continue
            score = round(50 + 30 * (1 - dist_m / 150) + 20 * (1 - hours / 24))
            pairs.append(
                {
                    "a_id": str(a.id),
                    "b_id": str(b.id),
                    "title": a.title,
                    "distance_m": round(dist_m),
                    "hours_apart": round(hours, 1),
                    "score": score,
                }
            )
    pairs.sort(key=lambda p: -p["score"])
    return pairs


class MergeIn(BaseModel):
    master_id: str
    duplicate_ids: list[str]


@app.post("/admin/incidents/merge")
def admin_merge(
    body: MergeIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Fold duplicates into a master: notes + history move over, the
    master's missing photo is backfilled, the duplicate is closed with a
    pointer note. Nothing is deleted — split can reopen."""
    master = db.get(Incident, body.master_id)
    if master is None:
        raise HTTPException(404, "master not found")
    if not body.duplicate_ids:
        raise HTTPException(422, "no duplicates given")
    merged = []
    moved_notes = 0
    moved_hist = 0
    for did in body.duplicate_ids:
        if did == master.id:
            raise HTTPException(422, "master cannot merge into itself")
        d = db.get(Incident, did)
        if d is None:
            raise HTTPException(404, f"duplicate not found: {did}")
        notes = db.query(IncidentNote).filter_by(incident_id=d.id).all()
        hist = db.query(StatusHistory).filter_by(incident_id=d.id).all()
        for n in notes:
            n.incident_id = master.id
        for h in hist:
            h.incident_id = master.id
        moved_notes += len(notes)
        moved_hist += len(hist)
        if not master.photo_url and d.photo_url:
            master.photo_url = d.photo_url
        db.add(
            IncidentNote(
                incident_id=master.id,
                staff_id=staff.id,
                note=f"Merged '{d.title}' ({d.id}) into this record — "
                f"{len(notes)} notes, {len(hist)} history entries preserved.",
            )
        )
        old = d.status
        d.status = "closed"
        db.add(
            StatusHistory(
                incident_id=d.id,
                old_status=old,
                new_status="closed",
                changed_by=staff.id,
            )
        )
        db.add(
            IncidentNote(
                incident_id=d.id,
                staff_id=staff.id,
                note=f"Merged into {master.id}. Split to reopen.",
            )
        )
        merged.append(str(d.id))
    db.commit()
    return {
        "master_id": str(master.id),
        "merged": merged,
        "moved_notes": moved_notes,
        "moved_history": moved_hist,
    }


class SplitIn(BaseModel):
    incident_id: str


@app.post("/admin/incidents/split")
def admin_split(
    body: SplitIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Reopen a merged (closed) duplicate. Moved notes/history stay on the
    master as the audit trail; the pointer notes on both sides record it."""
    i = db.get(Incident, body.incident_id)
    if i is None:
        raise HTTPException(404, "not found")
    if i.status != "closed":
        raise HTTPException(422, "only closed records can be split apart")
    prev = None
    hist = (
        db.query(StatusHistory)
        .filter_by(incident_id=i.id)
        .order_by(StatusHistory.changed_at.desc())
        .all()
    )
    for h in hist:
        if h.new_status == "closed" and h.old_status and h.old_status != "closed":
            prev = h.old_status
            break
    i.status = prev or "processing"
    db.add(
        StatusHistory(
            incident_id=i.id,
            old_status="closed",
            new_status=i.status,
            changed_by=staff.id,
        )
    )
    db.add(
        IncidentNote(
            incident_id=i.id,
            staff_id=staff.id,
            note="Split apart — reopened for independent triage.",
        )
    )
    db.commit()
    return {"id": str(i.id), "status": i.status}


# ---------- bulk triage (KAN-16) ----------
BULK_STATUS = {
    "verified",
    "rejected",
    "escalated",
}
BULK_SEVERITY = {"low", "medium", "high", "critical"}


class BulkIn(BaseModel):
    ids: list[str] | None = None
    scope: str | None = None
    filters: BulkFiltersIn | None = None
    status: str | None = None
    severity: str | None = None
    assigned_to: str | None = None


@app.post("/admin/incidents/bulk")
def admin_bulk(
    body: BulkIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    explicit_ids = list(dict.fromkeys(body.ids or []))
    filtered_scope = body.scope == "filtered"
    if body.scope not in (None, "filtered"):
        raise HTTPException(422, "bad bulk scope")
    if bool(explicit_ids) == filtered_scope:
        raise HTTPException(422, "provide ids or filtered scope")
    if filtered_scope and body.filters is None:
        raise HTTPException(422, "filters are required for filtered scope")
    if body.status is not None and body.status not in BULK_STATUS:
        raise HTTPException(422, "bad status")
    if body.severity is not None and body.severity not in BULK_SEVERITY:
        raise HTTPException(422, "bad severity")
    if body.assigned_to is not None and (
        not _is_uuid(body.assigned_to) or db.get(Staff, body.assigned_to) is None
    ):
        raise HTTPException(422, "assignee is not staff")
    if body.status is None and body.severity is None and body.assigned_to is None:
        raise HTTPException(422, "nothing to apply")
    if filtered_scope:
        filters = body.filters
        (
            filter_q,
            filter_status,
            filter_severity,
            filter_queue,
            filter_window_days,
            filter_state,
            filter_sla,
            _,
        ) = _clean_incident_scope(
            q=filters.q,
            status=filters.status,
            severity=filters.severity,
            queue=filters.queue,
            window_days=filters.window_days,
            state=filters.state,
            sla=filters.sla,
            sort="newest",
        )
        target_query = _apply_incident_scope(
            db.query(Incident),
            q=filter_q,
            status=filter_status,
            severity=filter_severity,
            queue=filter_queue,
            window_days=filter_window_days,
            state=filter_state,
            sla=filter_sla,
            staff_id=str(staff.id),
        )
        explicit_ids = [str(row.id) for row in target_query.all()]
    matched = len(explicit_ids)
    results = []
    records = []
    missing_ids = []
    for iid in explicit_ids:
        i = db.get(Incident, iid)
        if i is None:
            missing_ids.append(iid)
            results.append({"id": iid, "ok": False, "error": "not found"})
            continue
        records.append(i)

    if body.status is not None:
        if missing_ids:
            raise HTTPException(
                404,
                detail={
                    "code": "bulk_incident_not_found",
                    "message": "one or more incidents were not found",
                    "ids": missing_ids,
                },
            )
        invalid = [
            {
                "id": str(i.id),
                "current_status": i.status,
                "allowed_statuses": list(allowed_manual_statuses(i.status)),
            }
            for i in records
            if not can_manual_transition(i.status, body.status)
        ]
        if invalid:
            raise HTTPException(
                409,
                detail={
                    "code": "invalid_bulk_status_transition",
                    "message": "the requested status is not allowed for every selected incident",
                    "requested_status": body.status,
                    "invalid_incidents": invalid,
                },
            )
    unset_assign = "assigned_to" in body.model_fields_set and body.assigned_to is None
    for i in records:
        changed = []
        if body.status is not None and body.status != i.status:
            changed.append("status")
        if body.severity is not None and body.severity != i.severity:
            changed.append("severity")
        if unset_assign and i.assigned_to is not None:
            changed.append("assigned_to")
        elif body.assigned_to is not None and body.assigned_to != i.assigned_to:
            changed.append("assigned_to")
        old = i.status
        if body.status is not None:
            i.status = body.status
        if body.severity is not None:
            i.severity = body.severity
        if unset_assign:
            i.assigned_to = None
        elif body.assigned_to is not None:
            i.assigned_to = body.assigned_to
        if body.status is not None and old != i.status:
            db.add(
                StatusHistory(
                    incident_id=i.id,
                    old_status=old,
                    new_status=i.status,
                    changed_by=staff.id,
                )
            )
        results.append({"id": str(i.id), "ok": True, "changed": changed})
    db.commit()
    return {
        "matched": matched,
        "updated": sum(1 for r in results if r["ok"] and r["changed"]),
        "results": results,
    }


@app.get("/admin/users")
def admin_users(
    staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)
):
    rows = db.query(User).order_by(User.created_at.desc()).limit(200).all()
    return [
        {
            "id": str(u.id),
            "device_id": u.device_id,
            "phone": u.phone,
            "email": u.email,
            "verified": u.verified,
            "trust_score": u.trust_score,
            "banned": bool(getattr(u, "banned", False)),
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in rows
    ]


class UserPatchIn(BaseModel):
    verified: bool | None = None
    trust_score: float | None = None
    banned: bool | None = None


@app.patch("/admin/users/{user_id}")
def admin_user_patch(
    user_id: str,
    body: UserPatchIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(404, "not found")
    if body.verified is not None:
        u.verified = body.verified
        if body.verified:
            u.trust_score = max(u.trust_score, auth.TRUST_VERIFIED)
    if body.trust_score is not None:
        u.trust_score = max(0.1, min(1.0, body.trust_score))
    if body.banned is not None:
        u.banned = body.banned
    db.commit()
    db.refresh(u)
    return {
        "id": str(u.id),
        "verified": u.verified,
        "trust_score": u.trust_score,
        "banned": bool(u.banned),
    }


@app.post("/admin/incidents/{incident_id}/analyze")
def admin_analyze(
    incident_id: str,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Sync AI analysis (no Redis needed). Runs Gemini now, updates status."""
    from .worker import apply_ai_result, run_ai

    i = db.get(Incident, incident_id)
    if i is None:
        raise HTTPException(404, "not found")
    if i.status not in AI_SOURCE_STATUSES:
        raise HTTPException(
            409,
            detail={
                "code": "ai_analysis_not_allowed",
                "message": "AI analysis can only run for processing or needs review incidents",
                "current_status": i.status,
                "allowed_statuses": list(AI_SOURCE_STATUSES),
            },
        )
    res = run_ai(i.title or "", i.description or "", i.photo_url)
    status = apply_ai_result(
        db, i, res, changed_by=staff.id, allow_review_reanalysis=True
    )
    return {"id": str(i.id), "status": status, "ai": res}


@app.get("/admin/incidents/{incident_id}")
def admin_get(
    incident_id: str,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    i = db.get(Incident, incident_id)
    if i is None:
        raise HTTPException(404, "not found")
    notes = (
        db.query(IncidentNote)
        .filter_by(incident_id=i.id)
        .order_by(IncidentNote.created_at.asc())
        .all()
    )
    hist = (
        db.query(StatusHistory)
        .filter_by(incident_id=i.id)
        .order_by(StatusHistory.changed_at.asc())
        .all()
    )
    rep = db.get(User, i.reporter_id) if i.reporter_id else None
    out = admin_incident_out(i)
    out["reporter"] = (
        {
            "id": str(rep.id),
            "device_id": rep.device_id,
            "phone": rep.phone,
            "email": rep.email,
            "verified": rep.verified,
            "trust_score": rep.trust_score,
        }
        if rep
        else None
    )
    out["notes"] = [
        {
            "id": str(n.id),
            "incident_id": str(n.incident_id),
            "staff_id": str(n.staff_id) if n.staff_id else None,
            "note": n.note,
            "created_at": n.created_at.isoformat() if n.created_at else None,
        }
        for n in notes
    ]
    out["history"] = [
        {
            "id": str(h.id),
            "incident_id": str(h.incident_id),
            "old_status": h.old_status,
            "new_status": h.new_status,
            "changed_by": str(h.changed_by) if h.changed_by else None,
            "changed_at": h.changed_at.isoformat() if h.changed_at else None,
        }
        for h in hist
    ]
    out["resolution_evidence"] = [
        private_evidence_out(item) for item in ordered_evidence(db, i.id)
    ]
    return out


@app.post("/admin/incidents/{incident_id}/resolution-evidence", status_code=201)
def submit_authority_resolution_evidence(
    incident_id: str,
    action_taken: str = Form(...),
    hotspot_snapshot_id: str | None = Form(None),
    photo: UploadFile | None = File(None),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    # Lock the incident for the state check so two operators cannot start the
    # same authority cycle concurrently.
    incident = (
        db.query(Incident).filter(Incident.id == incident_id).with_for_update().first()
    )
    if incident is None:
        raise HTTPException(404, "not found")
    if incident.status == "awaiting_verification":
        raise HTTPException(409, "authority resolution already awaiting verification")
    if incident.status not in AUTHORITY_START_STATUSES:
        raise HTTPException(409, "incident is not eligible for authority resolution")
    note = clean_note(action_taken, "action_taken")
    snapshot = clean_hotspot_snapshot_id(hotspot_snapshot_id)
    from uuid import uuid4

    evidence_id = str(uuid4())
    photo_url = upload_evidence_photo(incident.id, evidence_id, photo)
    evidence = ResolutionEvidence(
        id=evidence_id,
        incident_id=incident.id,
        evidence_type="authority_resolution",
        submitted_by=staff.id,
        hotspot_snapshot_id=snapshot,
        note=note,
        photo_url=photo_url,
        review_outcome="not_applicable",
    )
    db.add(evidence)
    add_status_history(db, incident, "awaiting_verification", staff.id)
    try:
        db.commit()
        db.refresh(incident)
        db.refresh(evidence)
    except Exception as exc:
        db.rollback()
        print(f"[resolution-evidence] orphaned upload after commit failure: {photo_url}")
        raise HTTPException(502, "could not save resolution evidence") from exc
    return {"incident": admin_incident_out(incident), "evidence": private_evidence_out(evidence)}


@app.get("/admin/incidents/{incident_id}/resolution-evidence")
def list_authority_resolution_evidence(
    incident_id: str,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    if db.get(Incident, incident_id) is None:
        raise HTTPException(404, "not found")
    return [private_evidence_out(item) for item in ordered_evidence(db, incident_id)]


@app.get("/admin/resolution-evidence/{evidence_id}/photo")
def admin_resolution_photo(
    evidence_id: str,
    token: str | None = Query(None),
    request: Request = None,  # type: ignore
    db: Session = Depends(get_db),
):
    """Serve a private resolution photo using the CRM's image-token pattern."""
    raw = token
    if not raw and request is not None:
        hdr = request.headers.get("authorization", "")
        if hdr.lower().startswith("bearer "):
            raw = hdr[7:]
    if not raw:
        raise HTTPException(401, "missing bearer token")
    try:
        claims = auth.decode_token(raw)
    except HTTPException:
        raise HTTPException(401, "invalid token")
    if "role" not in claims:
        raise HTTPException(403, "staff only")
    if db.get(Staff, claims.get("sub")) is None:
        raise HTTPException(401, "unknown staff")
    evidence = db.get(ResolutionEvidence, evidence_id)
    if evidence is None:
        raise HTTPException(404, "photo unavailable")
    return _resolution_photo_redirect(evidence.photo_url)


@app.patch("/admin/resolution-evidence/{evidence_id}")
def review_resolution_evidence(
    evidence_id: str,
    body: ResolutionReviewIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    if body.outcome not in {"confirmed", "needs_follow_up"}:
        raise HTTPException(422, "outcome must be confirmed or needs_follow_up")
    review_note = clean_optional_note(body.review_note, "review_note")
    if body.outcome == "needs_follow_up" and review_note is None:
        raise HTTPException(400, "review_note is required for needs_follow_up")
    evidence = (
        db.query(ResolutionEvidence)
        .filter(ResolutionEvidence.id == evidence_id)
        .with_for_update()
        .first()
    )
    if evidence is None:
        raise HTTPException(404, "not found")
    incident = (
        db.query(Incident).filter(Incident.id == evidence.incident_id).with_for_update().first()
    )
    if incident is None:
        raise HTTPException(404, "not found")
    if evidence.evidence_type != "community_follow_up" or evidence.review_outcome != "pending":
        raise HTTPException(409, "evidence is no longer pending")
    if incident.status != "awaiting_verification":
        raise HTTPException(409, "incident is no longer awaiting verification")
    evidence.review_outcome = body.outcome
    evidence.review_note = review_note
    evidence.reviewed_by = staff.id
    evidence.reviewed_at = datetime.utcnow()
    new_status = (
        "community_confirmed" if body.outcome == "confirmed" else "needs_follow_up"
    )
    add_status_history(db, incident, new_status, staff.id)
    try:
        db.commit()
        db.refresh(incident)
        db.refresh(evidence)
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, "could not save resolution review") from exc
    return {"incident": admin_incident_out(incident), "evidence": private_evidence_out(evidence)}


@app.get("/admin/incidents/{incident_id}/photo")
def admin_photo(
    incident_id: str,
    token: str | None = Query(None),
    request: Request = None,  # type: ignore
    db: Session = Depends(get_db),
):
    """Serve incident photo. <img> tags can't send headers, so staff JWT
    is accepted as ?token= query param (falls back to Bearer header)."""
    from fastapi.responses import RedirectResponse, Response

    raw = token
    if not raw and request is not None:
        hdr = request.headers.get("authorization", "")
        if hdr.lower().startswith("bearer "):
            raw = hdr[7:]
    if not raw:
        raise HTTPException(401, "missing bearer token")
    try:
        data = auth.decode_token(raw)
    except HTTPException:
        raise HTTPException(401, "invalid token")
    if "role" not in data:
        raise HTTPException(403, "staff only")
    if db.get(Staff, data.get("sub")) is None:
        raise HTTPException(401, "unknown staff")

    i = db.get(Incident, incident_id)
    if i is None or not i.photo_url:
        raise HTTPException(404, "no photo")
    key = i.photo_url.replace("\\", "/").strip()
    if key.startswith(f"{settings.STORAGE_BUCKET}/"):
        if not settings.SUPABASE_SERVICE_KEY:
            raise HTTPException(404, "photo unavailable")
        try:
            url = get_storage().signed_url(key.split("/", 1)[1])
        except Exception:
            # A list row can still render its metadata when storage is slow or unavailable.
            return Response(status_code=204)
        return RedirectResponse(url, status_code=302)
    raise HTTPException(404, "photo unavailable")


@app.get("/admin/analytics/summary")
def analytics(
    window_days: int = Query(30, ge=1, le=365),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    cutoff = datetime.utcnow() - timedelta(days=window_days)
    scope = db.query(Incident).filter(Incident.created_at >= cutoff)
    by_status: dict = {}
    for k, v in (
        scope.with_entities(Incident.status, func.count())
        .group_by(Incident.status)
        .all()
    ):
        by_status[str(k)] = int(v)
    by_sev: dict = {}
    for k, v in (
        scope.with_entities(Incident.severity, func.count())
        .group_by(Incident.severity)
        .all()
    ):
        by_sev[str(k)] = int(v)
    by_cat: dict[str, int] = {}
    for (a,) in scope.with_entities(Incident.ai_analysis).all():
        raw_category = (a or {}).get("category") if isinstance(a, dict) else None
        if not raw_category:
            continue
        c = canonical_category(raw_category)
        by_cat[c] = by_cat.get(c, 0) + 1
    by_day_raw = (
        scope.with_entities(func.date(Incident.created_at), func.count())
        .group_by(func.date(Incident.created_at))
        .all()
    )
    by_day_status_raw = (
        scope.with_entities(func.date(Incident.created_at), Incident.status, func.count())
        .group_by(func.date(Incident.created_at), Incident.status)
        .all()
    )
    by_day_sev_raw = (
        scope.with_entities(func.date(Incident.created_at), Incident.severity, func.count())
        .group_by(func.date(Incident.created_at), Incident.severity)
        .all()
    )
    open_statuses = {
        "processing",
        "needs_review",
        "verified",
        "escalated",
        "awaiting_verification",
        "needs_follow_up",
    }
    resolved_statuses = {"resolved", "community_confirmed"}
    per_day: dict = {}
    for d, c in by_day_raw:
        per_day[str(d)] = {
            "date": str(d),
            "count": int(c),
            "resolved": 0,
            "open": 0,
            "critical": 0,
        }
    for d, s, c in by_day_status_raw:
        key = str(d)
        entry = per_day.setdefault(
            key, {"date": key, "count": 0, "resolved": 0, "open": 0, "critical": 0}
        )
        if str(s) in resolved_statuses:
            entry["resolved"] = int(c)
        if str(s) in open_statuses:
            entry["open"] = int(entry["open"]) + int(c)
    for d, s, c in by_day_sev_raw:
        key = str(d)
        entry = per_day.setdefault(
            key, {"date": key, "count": 0, "resolved": 0, "open": 0, "critical": 0}
        )
        if str(s) == "critical":
            entry["critical"] = int(c)
    action_scope = scope.filter(Incident.status.notin_(TERMINAL_INCIDENT_STATUSES))
    action_counts = {
        "overdue": action_scope.filter(_incident_overdue_clause()).count(),
        "breaching": action_scope.filter(_incident_breaching_clause()).count(),
        "needs_review": by_status.get("needs_review", 0),
        "escalated": by_status.get("escalated", 0),
        "needs_follow_up": by_status.get("needs_follow_up", 0),
    }
    total = sum(by_status.values())
    return {
        "window_days": window_days,
        "total": total,
        "by_category": [{"name": k, "count": v} for k, v in sorted(by_cat.items())],
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_severity": [{"severity": k, "count": v} for k, v in sorted(by_sev.items())],
        "by_day": [per_day[k] for k in sorted(per_day)],
        "action_counts": action_counts,
    }


@app.get(
    "/admin/analytics/hotspots",
    response_model=list[StaffHotspotOut],
    summary="List explainable hotspot intelligence for staff",
    description=(
        "Returns deterministically ranked verified hotspot clusters with related "
        "incident IDs, assignment status, photo/note evidence counts, trend, and "
        "a human-readable explanation."
    ),
)
def admin_hotspots(
    radius_km: float = Query(0.75, ge=0.05, le=25),
    window_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=100),
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    category: str | None = Query(None),
    severity: str | None = Query(None),
    trend: str | None = Query(None),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Rank recurring environmental signals without a permanent hotspot table."""

    _validate_hotspot_filters(lat=lat, lng=lng, severity=severity, trend=trend)
    from .hotspots import detect_hotspots

    return detect_hotspots(
        db,
        radius_km=radius_km,
        window_days=window_days,
        limit=limit,
        center_lat=lat,
        center_lng=lng,
        category=_category_filter(category),
        severity=severity,
        trend=trend,
        include_staff_details=True,
    )


@app.get("/admin/insights")
def admin_insights(
    window_days: int = Query(30, ge=1, le=365),
    radius_km: float = Query(0.75, ge=0.05, le=25),
    limit: int = Query(3, ge=1, le=50),
    category: str | None = Query(None),
    severity: str | None = Query(None),
    trend: str | None = Query(None),
    status: str = Query("verified"),
    center_lat: float | None = Query(None, ge=-90, le=90),
    center_lng: float | None = Query(None, ge=-180, le=180),
    min_lat: float | None = Query(None, ge=-90, le=90),
    min_lng: float | None = Query(None, ge=-180, le=180),
    max_lat: float | None = Query(None, ge=-90, le=90),
    max_lng: float | None = Query(None, ge=-180, le=180),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Return one read-only snapshot for the CRM Insights workspace."""
    if status not in {"all", *OPERATIONAL_STATUSES}:
        raise HTTPException(422, "invalid status")
    if trend and trend not in {"rising", "stable", "declining", "isolated"}:
        raise HTTPException(422, "invalid trend")
    if (center_lat is None) != (center_lng is None):
        raise HTTPException(422, "center_lat and center_lng must be provided together")
    bound_values = (min_lat, min_lng, max_lat, max_lng)
    if any(value is not None for value in bound_values) and not all(
        value is not None for value in bound_values
    ):
        raise HTTPException(422, "all map bounds must be provided together")
    if min_lat is not None and max_lat is not None and min_lat > max_lat:
        raise HTTPException(422, "min_lat must not exceed max_lat")
    if min_lng is not None and max_lng is not None and min_lng > max_lng:
        raise HTTPException(422, "min_lng must not exceed max_lng")
    if severity and severity not in {"low", "medium", "high", "critical"}:
        raise HTTPException(422, "invalid severity")

    from .insights import build_insights

    return build_insights(
        db,
        window_days=window_days,
        radius_km=radius_km,
        center_lat=center_lat,
        center_lng=center_lng,
        category=category,
        severity=severity,
        trend=trend,
        min_lat=min_lat,
        status=status,
        min_lng=min_lng,
        max_lat=max_lat,
        max_lng=max_lng,
        limit=limit,
    )


@app.get("/health")
def health():
    return {"ok": True}
