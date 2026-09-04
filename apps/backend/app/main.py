import math
from datetime import datetime

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.staticfiles import StaticFiles
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
from .db import Base, SessionLocal, engine, get_db
from .models import Category, Incident, IncidentNote, Staff, StatusHistory, User
from .storage import get_storage

app = FastAPI(title=settings.APP_NAME)

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
def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def incident_out(i: Incident) -> dict:
    return {
        "id": i.id,
        "title": i.title,
        "description": i.description,
        "photo_url": i.photo_url,
        "lat": i.lat,
        "lng": i.lng,
        "address": i.address,
        "status": i.status,
        "severity": i.severity,
        "ai_confidence": i.ai_confidence,
        "ai_analysis": i.ai_analysis,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def enqueue_analysis(incident_id: str) -> None:
    """Best-effort Celery enqueue; falls back silently when Redis is absent."""
    try:
        from .worker import analyze_incident

        getattr(analyze_incident, "delay")(incident_id)
    except Exception:
        pass  # dev/sqlite boot without Redis: incident stays `processing`


def seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Category).count() == 0:
            for name, icon in [
                ("crime", "shield"),
                ("fire", "flame"),
                ("accident", "car"),
                ("hazard", "alert"),
                ("other", "dot"),
            ]:
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
    return {"token": token, "user_id": u.id, "verified": u.verified}


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
    return {"token": token, "user_id": u.id, "verified": True}


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
    try:
        # PostGIS WKT on postgres; NULL on sqlite (lat/lng remain canonical)
        if not engine.url.get_backend_name().startswith("sqlite"):
            from geoalchemy2.elements import WKTElement

            inc.location = WKTElement(f"POINT({lng} {lat})", srid=4326)  # type: ignore
    except Exception:
        pass
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
            changed_by=user.id,
        )
    )
    db.commit()
    enqueue_analysis(inc.id)
    return {"id": inc.id, "status": inc.status, "photo_url": photo_url}


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
    # NOTE: category lives inside ai_analysis JSON for MVP; filter in Python below.
    rows = q.order_by(Incident.created_at.desc()).limit(500).all()
    out = []
    for i in rows:
        if category and (
            not i.ai_analysis or i.ai_analysis.get("category") != category
        ):
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
    if body.assigned_to:
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
        "id": n.id,
        "note": n.note,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


@app.get("/admin/users")
def admin_users(
    staff: Staff = Depends(get_current_staff), db: Session = Depends(get_db)
):
    rows = db.query(User).order_by(User.created_at.desc()).limit(200).all()
    return [
        {
            "id": u.id,
            "device_id": u.device_id,
            "phone": u.phone,
            "email": u.email,
            "verified": u.verified,
            "trust_score": u.trust_score,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in rows
    ]


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
        c = (a or {}).get("category", "unknown")
        by_cat[c] = by_cat.get(c, 0) + 1
    by_day_raw = (
        db.query(func.date(Incident.created_at), func.count())
        .group_by(func.date(Incident.created_at))
        .all()
    )
    return {
        "by_category": by_cat,
        "by_status": by_status,
        "by_severity": by_sev,
        "by_day": [{"day": str(d), "count": c} for d, c in by_day_raw],
    }


@app.get("/health")
def health():
    return {"ok": True}


try:
    app.mount("/uploads", StaticFiles(directory="./uploads"), name="uploads")
except Exception:
    pass
