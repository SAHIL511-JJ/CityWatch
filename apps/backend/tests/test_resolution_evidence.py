import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_staff
from app.main import app, get_db
from app.models import Incident
from app.resolution_evidence import (
    build_public_resolution,
    clean_hotspot_snapshot_id,
    clean_note,
    private_evidence_out,
    public_evidence_out,
    resolution_incident_out,
)


class ResolutionEvidenceHelperTests(unittest.TestCase):
    def test_public_serializer_drops_actor_and_storage_metadata(self):
        evidence = SimpleNamespace(
            id="evidence-1",
            incident_id="incident-1",
            parent_evidence_id="authority-1",
            hotspot_snapshot_id="snapshot-1",
            evidence_type="community_follow_up",
            submitted_by="citizen-1",
            note="Still blocked after the cleanup.",
            photo_url="incident-photos/private.jpg",
            review_outcome="pending",
            review_note="Internal note",
            reviewed_by="staff-1",
            reviewed_at=datetime(2026, 9, 9),
            created_at=datetime(2026, 9, 8),
        )
        private = private_evidence_out(evidence)
        public = public_evidence_out(evidence)
        self.assertEqual(private["submitted_by"], "citizen-1")
        self.assertEqual(private["photo_url"], "incident-photos/private.jpg")
        self.assertNotIn("submitted_by", public)
        self.assertNotIn("photo_url", public)
        self.assertNotIn("hotspot_snapshot_id", public)
        self.assertIsNone(public["review_note"])

    def test_public_resolution_contains_safe_history_only(self):
        incident = SimpleNamespace(
            id="incident-1",
            title="Blocked drain",
            description="Water is pooling",
            lat=18.52,
            lng=73.85,
            address="Ward 4",
            status="awaiting_verification",
            severity="high",
            created_at=datetime(2026, 9, 8),
        )
        history = [
            SimpleNamespace(
                id="h1",
                old_status="verified",
                new_status="awaiting_verification",
                changed_by="staff-1",
                changed_at=datetime(2026, 9, 9),
            )
        ]
        result = build_public_resolution(incident, [], history, can_submit_follow_up=True)
        self.assertTrue(result["can_submit_follow_up"])
        self.assertNotIn("changed_by", result["history"][0])
        self.assertEqual(result["incident"]["status"], "awaiting_verification")

    def test_resolution_incident_serializer_excludes_private_incident_fields(self):
        incident = SimpleNamespace(
            id="incident-1",
            title="Blocked drain",
            description="Water is pooling",
            lat=18.52,
            lng=73.85,
            address="Ward 4",
            status="community_confirmed",
            severity="high",
            created_at=datetime(2026, 9, 8),
            photo_url="incident-photos/private.jpg",
            reporter_id="citizen-1",
            assigned_to="staff-1",
            ai_confidence=0.99,
            ai_analysis={"reason": "internal"},
        )
        result = resolution_incident_out(incident)
        self.assertEqual(
            set(result),
            {"id", "title", "description", "lat", "lng", "address", "status", "severity", "created_at"},
        )

    def test_validation_rejects_blank_or_long_values(self):
        with self.assertRaises(HTTPException):
            clean_note("  ", "action_taken")
        with self.assertRaises(HTTPException):
            clean_note("x" * 2001, "observation")
        with self.assertRaises(HTTPException):
            clean_hotspot_snapshot_id("x" * 256)


class ResolutionEvidenceStatusEndpointTests(unittest.TestCase):
    def setUp(self):
        self.overrides = app.dependency_overrides.copy()
        self.db = MagicMock()
        incident = Incident(id="incident-1", status="verified", title="Report", lat=1, lng=2)
        self.db.get.return_value = incident
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[get_current_staff] = lambda: SimpleNamespace(id="staff-1")
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_generic_patch_cannot_create_evidence_free_resolution(self):
        response = self.client.patch(
            "/admin/incidents/incident-1", json={"status": "resolved"}
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn("resolution evidence workflow", response.json()["detail"])

    def test_generic_patch_cannot_create_resolution_states(self):
        for status in ("awaiting_verification", "community_confirmed", "needs_follow_up"):
            with self.subTest(status=status):
                response = self.client.patch(
                    "/admin/incidents/incident-1", json={"status": status}
                )
                self.assertEqual(response.status_code, 409)


if __name__ == "__main__":
    unittest.main()
