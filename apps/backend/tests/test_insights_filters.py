import unittest
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.auth import get_current_staff
from app.insights import _query_rows, build_insights
from app.main import app, get_db
from app.models import Incident


class InsightsFilterTests(unittest.TestCase):
    def test_trend_filters_before_limit_and_keeps_summary_and_map_in_sync(self):
        now = datetime.now()
        rows = [
            Incident(id=str(i), title="Report", description="Evidence", lat=18.52,
                     lng=73.85, reporter_id=str(i), status="verified", severity="high",
                     ai_confidence=0.9, ai_analysis={"category": category},
                     created_at=now - timedelta(days=i))
            for i, category in enumerate(["flooding", "flooding", "flooding", "waste"])
        ]
        with patch("app.insights._query_rows", return_value=rows):
            result = build_insights(object(), trend="isolated", limit=1)
            empty = build_insights(object(), trend="declining")
        self.assertEqual(result["scope"]["trend"], "isolated")
        self.assertEqual(result["signal_count"], 1)
        self.assertEqual(result["narratives"][0]["category"], "waste")
        self.assertEqual([point["id"] for point in result["map_points"]], ["3"])
        self.assertEqual(result["summary"]["total"], 1)
        self.assertEqual(sum(day["count"] for day in result["summary"]["by_day"]), 1)
        self.assertEqual(empty["narratives"], [])
        self.assertEqual(empty["map_points"], [])
        self.assertEqual(empty["summary"]["total"], 0)

    def test_status_is_applied_in_database_query_and_preserves_confidence_gate(self):
        for status in ("verified", "escalated", "resolved", "closed", "all"):
            with self.subTest(status=status):
                db = MagicMock()
                query = db.query.return_value
                query.filter.return_value = query
                query.order_by.return_value = query
                query.limit.return_value = query
                low = Incident(ai_confidence=0.4, ai_analysis={"category": "waste"})
                high = Incident(ai_confidence=0.9, ai_analysis={"category": "waste"})
                query.all.return_value = [low, high]
                rows = _query_rows(db, window_days=30, radius_km=0.75,
                                   center_lat=None, center_lng=None, category=None,
                                   severity=None, status=status, min_lat=None,
                                   min_lng=None, max_lat=None, max_lng=None)
                sql = " ".join(str(expression.compile(dialect=postgresql.dialect(),
                                      compile_kwargs={"literal_binds": True}))
                               for call in query.filter.call_args_list for expression in call.args)
                if status == "all":
                    self.assertIn(
                        "status IN ('awaiting_verification', 'closed', 'community_confirmed', 'escalated', 'needs_follow_up', 'resolved', 'verified')",
                        sql,
                    )
                else:
                    self.assertIn(f"status = '{status}'", sql)
                self.assertEqual(rows, [high])


class InsightsFilterEndpointTests(unittest.TestCase):
    def setUp(self):
        self.overrides = app.dependency_overrides.copy()
        app.dependency_overrides[get_db] = lambda: object()
        app.dependency_overrides[get_current_staff] = lambda: object()
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(self.overrides)

    def test_rejects_invalid_filters(self):
        for query in ("trend=unknown", "status=unknown", "status=rejected", "status=processing"):
            with self.subTest(query=query):
                self.assertEqual(self.client.get(f"/admin/insights?{query}").status_code, 422)

    def test_passes_combined_filters_and_retains_verified_default(self):
        with patch("app.insights.build_insights", return_value={}) as build:
            self.assertEqual(self.client.get("/admin/insights").status_code, 200)
            self.assertEqual(build.call_args.kwargs["status"], "verified")
            response = self.client.get("/admin/insights?trend=stable&status=resolved&category=waste&severity=high")
            self.assertEqual(response.status_code, 200)
            for key, value in {"trend": "stable", "status": "resolved", "category": "waste", "severity": "high"}.items():
                self.assertEqual(build.call_args.kwargs[key], value)

    def test_requires_staff_authentication(self):
        app.dependency_overrides.pop(get_current_staff)
        self.assertEqual(self.client.get("/admin/insights?trend=rising&status=all").status_code, 401)


if __name__ == "__main__":
    unittest.main()
