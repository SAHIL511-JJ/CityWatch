import math
from datetime import datetime

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
from pydantic import BaseModel
from sqlalchemy import func
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
from .models import Category, Incident, IncidentNote, Staff, StatusHistory, User
from .storage import get_storage
from .taxonomy import (
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
    severity: str | None = None
    assigned_to: str | None = None


class NoteIn(BaseModel):
    note: str


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
    # Public feed = verified only (per contract).
    q = db.query(Incident).filter(Incident.status == "verified")
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
        out.append(incident_out(i))
        if len(out) >= limit:
            break
    return out
    # TODO (Postgres): replace Python haversine with
    #   ST_DWithin(location, ST_MakePoint(lng,lat)::geography, radius_km*1000)


@app.get("/incidents/{incident_id}")
def get_incident(incident_id: str, db: Session = Depends(get_db)):
    i = db.get(Incident, incident_id)
    if i is None:
        raise HTTPException(404, "not found")
    return incident_out(i)


@app.get("/incidents/{incident_id}/photo")
def public_photo(incident_id: str, db: Session = Depends(get_db)):
    """Public reels-feed photo. Verified incidents only, no auth."""
    from fastapi.responses import RedirectResponse

    i = db.get(Incident, incident_id)
    if i is None or not i.photo_url or i.status != "verified":
        raise HTTPException(404, "no photo")
    key = i.photo_url.replace("\\", "/").strip()
    if key.startswith(f"{settings.STORAGE_BUCKET}/"):
        if not settings.SUPABASE_SERVICE_KEY:
            raise HTTPException(404, "photo unavailable")
        url = get_storage().signed_url(key.split("/", 1)[1])
        return RedirectResponse(url, status_code=302)
    raise HTTPException(404, "photo unavailable")


# ---------- admin ----------
@app.post("/admin/login")
def admin_login(body: AdminLoginIn, db: Session = Depends(get_db)):
    s = db.query(Staff).filter_by(email=body.email).first()
    if s is None or not auth.verify_password(body.password, s.password_hash):
        raise HTTPException(401, "bad credentials")
    return {"token": create_token(s.id, {"role": s.role}), "role": s.role}


@app.get("/admin/incidents")
def admin_list(
    status: str | None = None,
    severity: str | None = None,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    q = db.query(Incident).order_by(Incident.created_at.desc()).limit(200)
    rows = q.all()
    if status:
        rows = [r for r in rows if r.status == status]
    if severity:
        rows = [r for r in rows if r.severity == severity]
    return [incident_out(r) for r in rows]


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
    if body.status:
        i.status = body.status
    if body.severity:
        i.severity = body.severity
    # assigned_to uses field-set presence so explicit null unassigns.
    if "assigned_to" in body.model_fields_set:
        if body.assigned_to is not None and (
            not _is_uuid(body.assigned_to) or db.get(Staff, body.assigned_to) is None
        ):
            raise HTTPException(422, "assignee is not staff")
        i.assigned_to = body.assigned_to
    db.add(
        StatusHistory(
            incident_id=i.id, old_status=old, new_status=i.status, changed_by=staff.id
        )
    )
    db.commit()
    db.refresh(i)
    return incident_out(i)


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
                Incident.status.notin_(["resolved", "closed"]),
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
    "processing",
    "needs_review",
    "verified",
    "rejected",
    "escalated",
    "resolved",
    "closed",
}
BULK_SEVERITY = {"low", "medium", "high", "critical"}


class BulkIn(BaseModel):
    ids: list[str]
    status: str | None = None
    severity: str | None = None
    assigned_to: str | None = None


@app.post("/admin/incidents/bulk")
def admin_bulk(
    body: BulkIn,
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    if not body.ids:
        raise HTTPException(422, "no ids given")
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
    results = []
    unset_assign = "assigned_to" in body.model_fields_set and body.assigned_to is None
    for iid in body.ids:
        i = db.get(Incident, iid)
        if i is None:
            results.append({"id": iid, "ok": False, "error": "not found"})
            continue
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
        if changed:
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
    return {"updated": sum(1 for r in results if r["ok"]), "results": results}


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
    res = run_ai(i.title or "", i.description or "", i.photo_url)
    status = apply_ai_result(db, i, res, changed_by=staff.id)
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
    out = incident_out(i)
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
    return out


@app.get("/admin/incidents/{incident_id}/photo")
def admin_photo(
    incident_id: str,
    token: str | None = Query(None),
    request: Request = None,  # type: ignore
    db: Session = Depends(get_db),
):
    """Serve incident photo. <img> tags can't send headers, so staff JWT
    is accepted as ?token= query param (falls back to Bearer header)."""
    from fastapi.responses import RedirectResponse

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
        url = get_storage().signed_url(key.split("/", 1)[1])
        return RedirectResponse(url, status_code=302)
    raise HTTPException(404, "photo unavailable")


@app.get("/admin/analytics/summary")
def analytics(staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)):
    by_status: dict = {}
    for k, v in db.query(Incident.status, func.count()).group_by(Incident.status).all():
        by_status[str(k)] = int(v)
    by_sev: dict = {}
    for k, v in (
        db.query(Incident.severity, func.count()).group_by(Incident.severity).all()
    ):
        by_sev[str(k)] = int(v)
    by_cat: dict[str, int] = {}
    for (a,) in db.query(Incident.ai_analysis).all():
        raw_category = (a or {}).get("category") if isinstance(a, dict) else None
        if not raw_category:
            continue
        c = canonical_category(raw_category)
        by_cat[c] = by_cat.get(c, 0) + 1
    by_day_raw = (
        db.query(func.date(Incident.created_at), func.count())
        .group_by(func.date(Incident.created_at))
        .all()
    )
    by_day_status_raw = (
        db.query(func.date(Incident.created_at), Incident.status, func.count())
        .group_by(func.date(Incident.created_at), Incident.status)
        .all()
    )
    by_day_sev_raw = (
        db.query(func.date(Incident.created_at), Incident.severity, func.count())
        .group_by(func.date(Incident.created_at), Incident.severity)
        .all()
    )
    open_statuses = {"processing", "needs_review", "verified", "escalated"}
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
        if str(s) == "resolved":
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
    total = sum(by_status.values())
    return {
        "total": total,
        "by_category": [{"name": k, "count": v} for k, v in sorted(by_cat.items())],
        "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
        "by_severity": [{"severity": k, "count": v} for k, v in sorted(by_sev.items())],
        "by_day": [per_day[k] for k in sorted(per_day)],
    }


@app.get("/admin/analytics/hotspots")
def admin_hotspots(
    radius_km: float = Query(0.75, ge=0.05, le=25),
    window_days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=100),
    lat: float | None = Query(None, ge=-90, le=90),
    lng: float | None = Query(None, ge=-180, le=180),
    staff: Staff = Depends(get_current_staff),
    db: Session = Depends(get_db),
):
    """Rank recurring environmental signals without a permanent hotspot table."""

    from .hotspots import detect_hotspots

    return detect_hotspots(
        db,
        radius_km=radius_km,
        window_days=window_days,
        limit=limit,
        center_lat=lat,
        center_lng=lng,
    )


@app.get("/admin/insights")
def admin_insights(
    window_days: int = Query(30, ge=1, le=365),
    radius_km: float = Query(0.75, ge=0.05, le=25),
    limit: int = Query(3, ge=1, le=50),
    category: str | None = Query(None),
    severity: str | None = Query(None),
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
        min_lat=min_lat,
        min_lng=min_lng,
        max_lat=max_lat,
        max_lng=max_lng,
        limit=limit,
    )


@app.get("/health")
def health():
    return {"ok": True}
