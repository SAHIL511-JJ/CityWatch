"""Resolution evidence workflow shared by the FastAPI routes.

Evidence is immutable after creation. Only review fields on a pending
community follow-up may be changed by staff.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from .models import Incident, ResolutionEvidence, StatusHistory
from .storage import get_storage

EVIDENCE_TYPES = {"authority_resolution", "community_follow_up"}
REVIEW_OUTCOMES = {"not_applicable", "pending", "confirmed", "needs_follow_up"}
AUTHORITY_START_STATUSES = {"verified", "escalated", "resolved", "needs_follow_up"}
RESOLUTION_STATUSES = {"awaiting_verification", "community_confirmed", "needs_follow_up"}
OPERATIONAL_STATUSES = {
    "verified",
    "escalated",
    "resolved",
    "awaiting_verification",
    "community_confirmed",
    "needs_follow_up",
    "closed",
}
MAX_NOTE_LENGTH = 2000
ALLOWED_PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}


class ResolutionEvidenceError(ValueError):
    """A caller supplied an invalid evidence workflow value."""


def clean_note(value: str | None, field_name: str) -> str:
    value = (value or "").strip()
    if not value:
        raise HTTPException(400, f"{field_name} is required")
    if len(value) > MAX_NOTE_LENGTH:
        raise HTTPException(400, f"{field_name} must be 2000 characters or fewer")
    return value


def clean_optional_note(value: str | None, field_name: str) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise HTTPException(400, f"{field_name} cannot be blank")
    if len(value) > MAX_NOTE_LENGTH:
        raise HTTPException(400, f"{field_name} must be 2000 characters or fewer")
    return value


def clean_hotspot_snapshot_id(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise HTTPException(400, "hotspot_snapshot_id cannot be blank")
    if len(value) > 255:
        raise HTTPException(400, "hotspot_snapshot_id must be 255 characters or fewer")
    return value


def validate_photo(upload: UploadFile | None) -> tuple[bytes, str, str]:
    if upload is None or not upload.filename:
        raise HTTPException(400, "photo is required")
    content_type = (upload.content_type or "").lower()
    extension = ALLOWED_PHOTO_TYPES.get(content_type)
    if extension is None:
        raise HTTPException(400, "only jpg/png allowed")
    data = upload.file.read()
    if not data:
        raise HTTPException(400, "photo is empty")
    from .config import settings

    if len(data) > settings.MAX_PHOTO_MB * 1024 * 1024:
        raise HTTPException(400, f"photo over {settings.MAX_PHOTO_MB}MB")
    return data, content_type, extension


def upload_evidence_photo(
    incident_id: str, evidence_id: str, upload: UploadFile | None
) -> str:
    data, content_type, extension = validate_photo(upload)
    key = f"resolution-evidence/{incident_id}/{evidence_id}{extension}"
    try:
        return get_storage().upload(key, data, content_type)
    except Exception as exc:
        raise HTTPException(502, f"evidence photo storage failed: {exc}") from exc


def ordered_evidence(db: Session, incident_id: str) -> list[ResolutionEvidence]:
    return (
        db.query(ResolutionEvidence)
        .filter(ResolutionEvidence.incident_id == incident_id)
        .order_by(ResolutionEvidence.created_at.asc(), ResolutionEvidence.id.asc())
        .all()
    )


def latest_authority_evidence(
    db: Session, incident_id: str, *, lock: bool = False
) -> ResolutionEvidence | None:
    query = (
        db.query(ResolutionEvidence)
        .filter(
            ResolutionEvidence.incident_id == incident_id,
            ResolutionEvidence.evidence_type == "authority_resolution",
        )
        .order_by(ResolutionEvidence.created_at.desc(), ResolutionEvidence.id.desc())
    )
    if lock:
        query = query.with_for_update()
    return query.first()


def current_pending_follow_up(
    db: Session, incident_id: str, parent_evidence_id: str, user_id: str
) -> ResolutionEvidence | None:
    return (
        db.query(ResolutionEvidence)
        .filter(
            ResolutionEvidence.incident_id == incident_id,
            ResolutionEvidence.parent_evidence_id == parent_evidence_id,
            ResolutionEvidence.submitted_by == user_id,
            ResolutionEvidence.evidence_type == "community_follow_up",
            ResolutionEvidence.review_outcome == "pending",
        )
        .first()
    )


def add_status_history(
    db: Session, incident: Incident, new_status: str, actor_id: str
) -> bool:
    old_status = incident.status
    if old_status == new_status:
        return False
    incident.status = new_status
    db.add(
        StatusHistory(
            incident_id=incident.id,
            old_status=old_status,
            new_status=new_status,
            changed_by=actor_id,
        )
    )
    return True


def private_evidence_out(evidence: ResolutionEvidence) -> dict[str, Any]:
    return {
        "id": str(evidence.id),
        "incident_id": str(evidence.incident_id),
        "parent_evidence_id": str(evidence.parent_evidence_id)
        if evidence.parent_evidence_id
        else None,
        "hotspot_snapshot_id": evidence.hotspot_snapshot_id,
        "evidence_type": evidence.evidence_type,
        "submitted_by": str(evidence.submitted_by),
        "note": evidence.note,
        "photo_url": evidence.photo_url,
        "has_photo": bool(evidence.photo_url),
        "review_outcome": evidence.review_outcome,
        "review_note": evidence.review_note,
        "reviewed_by": str(evidence.reviewed_by) if evidence.reviewed_by else None,
        "reviewed_at": evidence.reviewed_at.isoformat()
        if evidence.reviewed_at
        else None,
        "created_at": evidence.created_at.isoformat() if evidence.created_at else None,
    }


def public_evidence_out(evidence: ResolutionEvidence) -> dict[str, Any]:
    return {
        "id": str(evidence.id),
        "evidence_type": evidence.evidence_type,
        "note": evidence.note,
        "review_outcome": evidence.review_outcome,
        "review_note": evidence.review_note
        if evidence.review_outcome != "pending"
        else None,
        "has_photo": bool(evidence.photo_url),
        "created_at": evidence.created_at.isoformat() if evidence.created_at else None,
        "reviewed_at": evidence.reviewed_at.isoformat()
        if evidence.reviewed_at
        else None,
    }


def public_history_out(history: StatusHistory) -> dict[str, Any]:
    return {
        "id": str(history.id),
        "old_status": history.old_status,
        "new_status": history.new_status,
        "changed_at": history.changed_at.isoformat() if history.changed_at else None,
    }


def resolution_incident_out(incident: Incident) -> dict[str, Any]:
    """Return the exact incident fields allowed in citizen resolution views."""
    return {
        "id": str(incident.id),
        "title": incident.title,
        "description": incident.description,
        "lat": incident.lat,
        "lng": incident.lng,
        "address": incident.address,
        "status": incident.status,
        "severity": incident.severity,
        "created_at": incident.created_at.isoformat()
        if incident.created_at
        else None,
    }


def build_public_resolution(
    incident: Incident,
    evidence: list[ResolutionEvidence],
    history: list[StatusHistory],
    *,
    can_submit_follow_up: bool,
) -> dict[str, Any]:
    return {
        "incident": resolution_incident_out(incident),
        "can_submit_follow_up": can_submit_follow_up,
        "evidence": [public_evidence_out(item) for item in evidence],
        "history": [public_history_out(item) for item in history],
    }
