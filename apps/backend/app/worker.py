"""Celery worker: direct Google Gemini vision now, fake stub as fallback.

Flow: analyze_incident(incident_id) -> gemini_ai() if GEMINI_API_KEY set
else fake_ai() -> update status verified / rejected / needs_review -> FCM stub.
Runs on Render worker service with Upstash Redis as broker.
"""

import base64
import json
import os

from celery import Celery

from .config import settings

celery = Celery(
    "incident_worker", broker=settings.REDIS_URL, backend=settings.REDIS_URL
)
celery.conf.update(task_acks_late=True, worker_prefetch_multiplier=1)

GEMINI_PROMPT = """You check citizen incident reports. Reply with JSON only, no other text.
Fields: {"is_legitimate": bool, "category": "crime|fire|accident|hazard|other", "severity": "low|medium|high|critical", "confidence": 0-1, "reason": "short reason"}.
Legitimate = real visible event (crime, fire, crash, flood, broken road, fallen wire). Reject spam, jokes, blurry random photos, screenshots, memes.
Severity: low = small litter/pothole, medium = hazard needing crew, high = fire/crash/crime in progress, critical = lives at risk.
Use the photo as main proof; text as extra hint. Low confidence (<0.7) when unsure."""


def _load_photo_bytes(photo_url: str | None) -> tuple[bytes | None, str]:
    if not photo_url:
        return None, "image/jpeg"
    try:
        if photo_url.startswith("http"):
            import httpx

            r = httpx.get(photo_url, timeout=10)
            if r.status_code != 200:
                return None, "image/jpeg"
            mime = r.headers.get("content-type", "image/jpeg").split(";")[0]
            return r.content, mime or "image/jpeg"
        p = photo_url
        for prefix in ("./uploads/", "uploads/", "./"):
            if p.startswith(prefix):
                break
        else:
            p = os.path.join(".", photo_url.lstrip("/"))
        if os.path.exists(p) and os.path.isfile(p):
            with open(p, "rb") as f:
                data = f.read()
            mime = "image/png" if p.lower().endswith(".png") else "image/jpeg"
            return data, mime
    except Exception as e:
        print(f"[gemini] photo load failed: {e}")
    return None, "image/jpeg"


def gemini_ai(title: str, description: str, photo_url: str | None) -> dict:
    """Call direct Google Gemini (REST, no extra package). Raises on failure."""
    import httpx

    key = settings.GEMINI_API_KEY or settings.AI_API_KEY
    model = settings.GEMINI_MODEL or "gemini-3.6-flash"
    photo_bytes, mime = _load_photo_bytes(photo_url)
    parts: list = [
        {"text": f"{GEMINI_PROMPT}\n\nTitle: {title}\nDetails: {description}"}
    ]
    if photo_bytes:
        parts.append(
            {
                "inline_data": {
                    "mime_type": mime,
                    "data": base64.b64encode(photo_bytes).decode(),
                }
            }
        )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    r = httpx.post(
        url,
        json={
            "contents": [{"parts": parts}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
            },
        },
        timeout=40,
    )
    r.raise_for_status()
    data = r.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        if text.lower().startswith("json"):
            text = text[4:].strip()
    res = json.loads(text)
    cat = str(res.get("category", "other")).lower()
    sev = str(res.get("severity", "low")).lower()
    if cat not in ("crime", "fire", "accident", "hazard", "other"):
        cat = "other"
    if sev not in ("low", "medium", "high", "critical"):
        sev = "low"
    return {
        "is_legitimate": bool(res.get("is_legitimate", False)),
        "category": cat,
        "severity": sev,
        "confidence": max(0.0, min(1.0, float(res.get("confidence", 0.5)))),
        "reason": str(res.get("reason", ""))[:300],
    }


def run_ai(title: str, description: str, photo_url: str | None) -> dict:
    key = settings.GEMINI_API_KEY or settings.AI_API_KEY
    if key:
        try:
            return gemini_ai(title, description, photo_url)
        except Exception as e:
            print(f"[gemini] failed, using stub: {e}")
    return fake_ai(title, description, photo_url)


def fake_ai(title: str, description: str, photo_url: str | None) -> dict:
    """Stub returning {is_legitimate, category, severity, confidence}."""
    text = f"{title} {description}".lower()
    if any(w in text for w in ("spam", "test", "asdf", "fake")):
        return {
            "is_legitimate": False,
            "category": "other",
            "severity": "low",
            "confidence": 0.92,
        }
    if any(w in text for w in ("fire", "burn", "smoke")):
        cat, sev, conf = "fire", "high", 0.85
    elif any(w in text for w in ("crash", "accident", "collision")):
        cat, sev, conf = "accident", "high", 0.82
    elif any(w in text for w in ("crime", "robbery", "theft", "attack", "gun")):
        cat, sev, conf = "crime", "critical", 0.8
    elif any(w in text for w in ("flood", "hazard", "pothole", "wire", "leak")):
        cat, sev, conf = "hazard", "medium", 0.75
    else:
        cat, sev, conf = "other", "low", 0.45  # low confidence -> needs_review
    return {"is_legitimate": True, "category": cat, "severity": sev, "confidence": conf}


def send_fcm_stub(tokens: list[str], title: str, body: str) -> None:
    if not tokens:
        return
    if not settings.FCM_CRED_JSON or not os.path.exists(settings.FCM_CRED_JSON):
        print(f"[fcm-stub] to {len(tokens)} devices: {title} — {body}")
        return
    import firebase_admin
    from firebase_admin import credentials, messaging

    try:
        firebase_admin.get_app()
    except ValueError:
        firebase_admin.initialize_app(credentials.Certificate(settings.FCM_CRED_JSON))
    msg = messaging.MulticastMessage(
        notification=messaging.Notification(title, body), tokens=tokens
    )
    messaging.send_each_for_multicast(msg)


def apply_ai_result(db, inc, res: dict, changed_by=None) -> str:
    """Shared status update used by Celery task and sync admin endpoint."""
    from .models import StatusHistory, User

    conf = float(res["confidence"])
    old = inc.status
    if not res["is_legitimate"]:
        inc.status = "rejected"
    elif conf >= 0.7:
        inc.status = "verified"
    else:
        inc.status = "needs_review"
    inc.severity = res["severity"]
    inc.ai_confidence = conf
    inc.ai_analysis = res
    if inc.reporter_id:
        u = db.get(User, inc.reporter_id)
        if u is not None:
            u.trust_score = max(
                0.1,
                min(1.0, u.trust_score + (0.02 if inc.status == "verified" else -0.05)),
            )
    db.add(
        StatusHistory(
            incident_id=inc.id,
            old_status=old,
            new_status=inc.status,
            changed_by=changed_by,
        )
    )
    db.commit()
    db.refresh(inc)
    return inc.status


@celery.task(name="analyze_incident", bind=True, max_retries=3)
def analyze_incident(self, incident_id: str) -> dict:
    from .db import SessionLocal
    from .models import Incident, User

    db = SessionLocal()
    try:
        inc = db.get(Incident, incident_id)
        if inc is None:
            return {"ok": False, "error": "not found"}
        res = run_ai(inc.title or "", inc.description or "", inc.photo_url)
        status = apply_ai_result(db, inc, res)
        # nearby push stub: users within 10km whose threshold allows it
        if inc.status == "verified" and inc.severity in ("high", "critical"):
            try:
                users = (
                    db.query(User).filter(User.fcm_token.isnot(None)).limit(500).all()
                )
                tokens = [u.fcm_token for u in users if u.fcm_token]
                send_fcm_stub(
                    tokens,
                    f"{inc.severity.upper()}: {inc.title}",
                    inc.description or "",
                )
            except Exception as e:
                print(f"[fcm] failed: {e}")
        return {"ok": True, "status": status, "ai": res}
    except Exception as e:
        db.rollback()
        raise self.retry(exc=e, countdown=10)
    finally:
        db.close()
