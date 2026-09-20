"""Tables mirror the Supabase Postgres/PostGIS contract."""

import uuid
from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


def _uid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    device_id: Mapped[str] = mapped_column(Text, unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    trust_score: Mapped[float] = mapped_column(Float, default=0.5)
    banned: Mapped[bool] = mapped_column(Boolean, default=False)
    fcm_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    alert_radius_km: Mapped[float] = mapped_column(Float, default=5.0)
    min_severity: Mapped[str] = mapped_column(Text, default="medium")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Staff(Base):
    __tablename__ = "staff"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    email: Mapped[str] = mapped_column(Text, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, default="dispatcher")
    availability: Mapped[str] = mapped_column(Text, default="available")
    availability_updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class StaffInvitation(Base):
    __tablename__ = "staff_invitations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    email: Mapped[str] = mapped_column(Text, index=True)
    role: Mapped[str] = mapped_column(Text, default="dispatcher")
    token_hash: Mapped[str] = mapped_column(Text, unique=True, index=True)
    invited_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    name: Mapped[str] = mapped_column(Text, unique=True)
    icon: Mapped[str | None] = mapped_column(Text, nullable=True)


class Incident(Base):
    __tablename__ = "incidents"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    reporter_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    assigned_to: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    location: Mapped[str | None] = mapped_column(
        Geography("POINT", srid=4326), nullable=True
    )
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, default="processing", index=True)
    severity: Mapped[str] = mapped_column(Text, default="medium", index=True)
    ai_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    ai_analysis = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )


class IncidentNote(Base):
    __tablename__ = "incident_notes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    incident_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("incidents.id"), index=True
    )
    staff_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("staff.id"), nullable=True
    )
    note: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class StatusHistory(Base):
    __tablename__ = "status_history"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    incident_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("incidents.id"), index=True
    )
    old_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_status: Mapped[str] = mapped_column(Text)
    changed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ResolutionEvidence(Base):
    __tablename__ = "resolution_evidence"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uid)
    incident_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("incidents.id", ondelete="CASCADE"), index=True
    )
    parent_evidence_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("resolution_evidence.id", ondelete="CASCADE"), nullable=True
    )
    hotspot_snapshot_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_type: Mapped[str] = mapped_column(Text)
    submitted_by: Mapped[str] = mapped_column(String(36))
    note: Mapped[str] = mapped_column(Text)
    photo_url: Mapped[str] = mapped_column(Text)
    review_outcome: Mapped[str] = mapped_column(Text, default="pending")
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
