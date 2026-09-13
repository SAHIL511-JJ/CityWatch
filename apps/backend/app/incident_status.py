"""Incident status policy shared by staff moderation and AI updates."""

from __future__ import annotations

from collections.abc import Mapping


TRIAGE_STATUSES = frozenset(
    {
        "processing",
        "needs_review",
        "verified",
        "rejected",
        "escalated",
        "closed",
    }
)
RESOLUTION_STATUSES = frozenset(
    {"awaiting_verification", "community_confirmed", "needs_follow_up"}
)
ALL_INCIDENT_STATUSES = TRIAGE_STATUSES | RESOLUTION_STATUSES | {"resolved"}

AUTHORITY_START_STATUSES = frozenset(
    {"verified", "escalated", "resolved", "needs_follow_up"}
)
OPERATIONAL_STATUSES = frozenset(
    {
        "verified",
        "escalated",
        "resolved",
        "awaiting_verification",
        "community_confirmed",
        "needs_follow_up",
        "closed",
    }
)

# These are the only normal staff status actions. ``closed`` is appended as a
# separate emergency action for every non-closed status below.
MANUAL_STATUS_TRANSITIONS: Mapping[str, frozenset[str]] = {
    "processing": frozenset({"verified", "rejected", "escalated"}),
    "needs_review": frozenset({"verified", "rejected", "escalated"}),
    "verified": frozenset({"escalated"}),
    "rejected": frozenset(),
    "escalated": frozenset({"verified"}),
    "resolved": frozenset(),
    "awaiting_verification": frozenset(),
    "community_confirmed": frozenset(),
    "needs_follow_up": frozenset(),
    "closed": frozenset(),
}
MANUAL_ACTION_ORDER = ("verified", "rejected", "escalated", "closed")
AI_SOURCE_STATUSES = frozenset({"processing", "needs_review"})
AI_TARGET_STATUSES = frozenset({"verified", "rejected", "needs_review"})


def allowed_manual_statuses(current: str) -> tuple[str, ...]:
    """Return status actions the staff UI/API may offer for ``current``."""

    if current not in ALL_INCIDENT_STATUSES:
        return ()
    allowed = set(MANUAL_STATUS_TRANSITIONS.get(current, frozenset()))
    if current != "closed":
        allowed.add("closed")
    return tuple(status for status in MANUAL_ACTION_ORDER if status in allowed)


def can_manual_transition(current: str, target: str) -> bool:
    if current == target:
        return current in ALL_INCIDENT_STATUSES
    return target in allowed_manual_statuses(current)


def can_ai_transition(current: str, target: str) -> bool:
    return current in AI_SOURCE_STATUSES and target in AI_TARGET_STATUSES
