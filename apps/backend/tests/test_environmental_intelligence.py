import unittest
from datetime import datetime, timedelta
from unittest.mock import patch

from app.hotspots import _candidate_rows, detect_hotspots
from app.insights import build_insights
from app.action_playbooks import build_action_plan
from app.models import Incident
from app.taxonomy import ENVIRONMENTAL_CATEGORIES, canonical_category
from app.worker import fake_ai, sanitize_ai_result


def _incident(
    *,
    category: str,
    lat: float,
    lng: float,
    created_at: datetime,
    reporter_id: str,
    severity: str = "medium",
    confidence: float = 0.9,
    status: str = "verified",
) -> Incident:
    return Incident(
        id=f"{reporter_id}-{created_at.day}-{lat}",
        title=category,
        description="environmental observation",
        lat=lat,
        lng=lng,
        status=status,
        severity=severity,
        ai_confidence=confidence,
        ai_analysis={"category": category, "confidence": confidence},
        reporter_id=reporter_id,
        created_at=created_at,
    )


class EnvironmentalIntelligenceTests(unittest.TestCase):
    def test_centered_candidate_query_filters_before_limiting(self):
        class QuerySpy:
            def __init__(self):
                self.limited = False
                self.filter_calls = 0

            def filter(self, *args):
                self.assert_not_limited()
                self.filter_calls += 1
                return self

            def order_by(self, *args):
                return self

            def limit(self, count):
                self.limited = True
                self.limit_count = count
                return self

            def all(self):
                return []

            def assert_not_limited(self):
                if self.limited:
                    raise AssertionError("candidate query filtered after LIMIT")

        class DbSpy:
            def __init__(self):
                self.query_spy = QuerySpy()

            def query(self, model):
                return self.query_spy

        db = DbSpy()
        self.assertEqual(_candidate_rows(db, center_lat=18.5199, center_lng=73.8552, radius_km=0.75), [])
        self.assertEqual(db.query_spy.filter_calls, 2)
        self.assertEqual(db.query_spy.limit_count, 1000)

    def test_taxonomy_accepts_environmental_values_and_maps_legacy_values(self):
        self.assertEqual(len(ENVIRONMENTAL_CATEGORIES), 9)
        self.assertEqual(canonical_category("blocked drain"), "blocked_drain")
        self.assertEqual(canonical_category("hazard"), "other_environmental_condition")
        self.assertEqual(canonical_category("not-a-category"), "other_environmental_condition")

    def test_fallback_is_deterministic_and_environmental(self):
        first = fake_ai("Blocked drain on Market Street", "Water backs up after rain", None)
        second = fake_ai("Blocked drain on Market Street", "Water backs up after rain", None)
        self.assertEqual(first, second)
        self.assertEqual(first["category"], "blocked_drain")
        self.assertGreaterEqual(first["confidence"], 0.7)
        self.assertEqual(first["analysis_version"], "environmental-v1")
        self.assertEqual(
            fake_ai("Waterlogging at the crossing", "Waterlogging returns after rain", None)["category"],
            "waterlogging",
        )

    def test_malformed_model_fields_are_safe_and_need_review(self):
        result = sanitize_ai_result({"category": "unknown", "severity": "impossible", "confidence": "nope"})
        self.assertEqual(result["category"], "other_environmental_condition")
        self.assertEqual(result["severity"], "medium")
        self.assertLess(result["confidence"], 0.7)
        self.assertTrue(result["is_legitimate"])

    def test_hotspots_require_verified_high_confidence_and_group_same_category(self):
        base = datetime(2026, 9, 1, 8, 0, 0)
        rows = [
            _incident(category="flooding", lat=18.5200, lng=73.8550, created_at=base, reporter_id="a", severity="high"),
            _incident(category="flooding", lat=18.5210, lng=73.8555, created_at=base + timedelta(days=3), reporter_id="b", severity="medium"),
            _incident(category="flooding", lat=18.5198, lng=73.8548, created_at=base + timedelta(days=6), reporter_id="c", severity="high"),
            _incident(category="waste", lat=18.5201, lng=73.8551, created_at=base + timedelta(days=2), reporter_id="d"),
            _incident(category="flooding", lat=18.5201, lng=73.8551, created_at=base + timedelta(days=2), reporter_id="noise", confidence=0.4),
            _incident(category="flooding", lat=18.5201, lng=73.8551, created_at=base + timedelta(days=2), reporter_id="rejected", status="rejected"),
        ]
        with patch("app.hotspots._candidate_rows", return_value=rows):
            result = detect_hotspots(object(), radius_km=0.75, window_days=30)
        self.assertEqual(len(result), 2)
        flooding = next(item for item in result if item["category"] == "flooding")
        self.assertEqual(flooding["report_count"], 3)
        self.assertEqual(flooding["unique_contributors"], 3)
        self.assertEqual(flooding["trend"], "rising")
        self.assertGreater(flooding["persistence_score"], 0)
        self.assertIn("observations", flooding["explanation"])

    def test_separate_locations_and_categories_do_not_merge(self):
        base = datetime(2026, 9, 1, 8, 0, 0)
        rows = [
            _incident(category="waste", lat=18.52, lng=73.855, created_at=base, reporter_id="a"),
            _incident(category="waste", lat=18.60, lng=73.95, created_at=base, reporter_id="b"),
            _incident(category="sewage", lat=18.52, lng=73.855, created_at=base, reporter_id="c"),
        ]
        with patch("app.hotspots._candidate_rows", return_value=rows):
            result = detect_hotspots(object(), radius_km=0.75, window_days=30)
        self.assertEqual(len(result), 3)

    def test_insights_snapshot_returns_ranked_narratives_and_filtered_points(self):
        base = datetime(2026, 9, 1, 8, 0, 0)
        rows = [
            _incident(category="flooding", lat=18.5200, lng=73.8550, created_at=base, reporter_id="a", severity="high"),
            _incident(category="flooding", lat=18.5210, lng=73.8555, created_at=base + timedelta(days=3), reporter_id="b", severity="critical"),
            _incident(category="flooding", lat=18.5198, lng=73.8548, created_at=base + timedelta(days=6), reporter_id="c", severity="high"),
            _incident(category="plastic", lat=18.5201, lng=73.8551, created_at=base + timedelta(days=2), reporter_id="d"),
        ]
        with patch("app.insights._query_rows", return_value=rows):
            result = build_insights(object(), window_days=30, radius_km=0.75)
            limited = build_insights(object(), window_days=30, radius_km=0.75, limit=1)
        self.assertEqual(result["summary"]["total"], 4)
        self.assertEqual(result["signal_count"], 2)
        self.assertEqual(result["narratives"][0]["category"], "flooding")
        self.assertEqual(result["narratives"][0]["report_count"], 3)
        self.assertEqual(result["narratives"][0]["action_plan"]["priority"], "immediate")
        self.assertEqual(result["narratives"][0]["action_plan"]["authority"], "Municipal drainage / public works")
        self.assertEqual(len(result["map_points"]), 4)
        self.assertEqual(len(result["summary"]["by_day"]), 30)
        self.assertLessEqual(len(limited["narratives"]), 1)

    def test_action_playbooks_are_deterministic_and_priority_aware(self):
        for category in ENVIRONMENTAL_CATEGORIES:
            category_plan = build_action_plan({
                "category": category,
                "severity_summary": {},
                "persistence_score": 10,
                "trend": "stable",
            })
            self.assertEqual(len(category_plan["immediate_steps"]), 3)
            self.assertEqual(len(category_plan["escalate_when"]), 2)
            self.assertTrue(category_plan["objective"])
            self.assertTrue(category_plan["verify"])

        plan = build_action_plan({
            "category": "blocked_drain",
            "severity_summary": {"high": 2},
            "persistence_score": 54,
            "trend": "stable",
        })
        self.assertEqual(plan["priority"], "priority")
        self.assertEqual(plan["authority"], "Drainage / sanitation services")
        self.assertEqual(len(plan["immediate_steps"]), 3)
        self.assertTrue(plan["verify"])

        immediate = build_action_plan({
            "category": "flooding",
            "severity_summary": {"critical": 1},
            "persistence_score": 10,
            "trend": "stable",
        })
        self.assertEqual(immediate["priority"], "immediate")

        fallback = build_action_plan({
            "category": "unrecognised-category",
            "severity_summary": {},
            "persistence_score": 10,
            "trend": "isolated",
        })
        self.assertEqual(fallback["authority"], "Local environmental response team")


if __name__ == "__main__":
    unittest.main()
