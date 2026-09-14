import unittest
from unittest.mock import patch

from app.main import enqueue_analysis, mark_analysis_queue_unavailable
from app.models import Incident, StatusHistory
from app.worker import analyze_incident


class AnalysisQueueTests(unittest.TestCase):
    def test_enqueue_publishes_once_without_a_socket_precheck(self):
        with patch("app.worker.analyze_incident.apply_async") as publish:
            self.assertTrue(enqueue_analysis("incident-1"))

        publish.assert_called_once_with(args=("incident-1",), retry=False)

    def test_enqueue_failure_is_reported_without_running_ai(self):
        with patch(
            "app.worker.analyze_incident.apply_async", side_effect=ConnectionError("redis down")
        ):
            self.assertFalse(enqueue_analysis("incident-1"))

    def test_queue_failure_moves_the_report_to_staff_review(self):
        class DbSpy:
            def __init__(self):
                self.added = []

            def add(self, value):
                self.added.append(value)

            def commit(self):
                pass

            def refresh(self, value):
                pass

        incident = Incident(
            id="incident-1",
            title="Flooded footpath",
            lat=18.52,
            lng=73.85,
            status="processing",
            severity="high",
        )
        db = DbSpy()

        mark_analysis_queue_unavailable(db, incident)

        self.assertEqual(incident.status, "needs_review")
        self.assertEqual(incident.ai_confidence, 0.0)
        self.assertEqual(incident.ai_analysis["analysis_version"], "queue-unavailable-v1")
        self.assertEqual(len(db.added), 1)
        self.assertIsInstance(db.added[0], StatusHistory)

    def test_stale_queued_job_skips_ai_after_a_safe_failure_state(self):
        class DbSpy:
            def get(self, model, incident_id):
                return Incident(
                    id=incident_id,
                    title="Flooded footpath",
                    lat=18.52,
                    lng=73.85,
                    status="needs_review",
                )

            def close(self):
                pass

        with (
            patch("app.db.SessionLocal", return_value=DbSpy()),
            patch("app.worker.run_ai") as run_ai,
        ):
            result = analyze_incident.run("incident-1")

        self.assertTrue(result["skipped"])
        self.assertEqual(result["status"], "needs_review")
        run_ai.assert_not_called()


if __name__ == "__main__":
    unittest.main()
