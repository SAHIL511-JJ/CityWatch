"""Seed and verify the API half of the KAN-38 CitiWatch demo narrative.

Run only against the explicitly started local API with
ENABLE_DEMO_FIXTURES=true. The endpoint is idempotent and writes only marked
records to the shared Supabase database.
"""

from __future__ import annotations

import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = os.environ.get("CITYWATCH_API_URL", "http://localhost:8000").rstrip("/")
MARKER = "[CW-DEMO:KAN-38]"


def request(path: str, *, method: str = "GET", token: str | None = None, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"content-type": "application/json"} if data else {}
    if token:
        headers["authorization"] = f"Bearer {token}"
    req = Request(f"{BASE_URL}{path}", data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=45) as response:
            return json.loads(response.read())
    except HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"cannot reach {BASE_URL}: {exc.reason}") from exc


def hotspot_by_category(items: list[dict], category: str) -> dict:
    try:
        return next(item for item in items if item["category"] == category)
    except StopIteration as exc:
        raise RuntimeError(f"missing {category} hotspot") from exc


def main() -> int:
    health = request("/health")
    if health.get("ok") is not True:
        raise RuntimeError("API health check did not return ok")

    admin = request(
        "/admin/login",
        method="POST",
        body={
            "email": os.environ.get("CITYWATCH_ADMIN_EMAIL", "admin@example.com"),
            "password": os.environ.get("CITYWATCH_ADMIN_PASSWORD", "admin123"),
        },
    )
    staff_token = admin["token"]
    seeded = request("/admin/demo-fixtures/citiwatch", method="POST", token=staff_token)
    if seeded["marker"] != MARKER or seeded["report_count"] != 9:
        raise RuntimeError("fixture endpoint returned an unexpected dataset")

    # The public awareness path uses a regular anonymous citizen token.
    citizen = request(
        "/auth/anonymous",
        method="POST",
        body={"device_id": "cw-demo-kan38-observer"},
    )
    flood_hotspots = request(
        "/hotspots?lat=18.6204&lng=73.9052&radius_km=0.75&window_days=30&limit=20",
        token=citizen["token"],
    )
    waste_hotspots = request(
        "/hotspots?lat=18.5900&lng=73.8175&radius_km=0.75&window_days=30&limit=20",
        token=citizen["token"],
    )
    flooding = hotspot_by_category(flood_hotspots, "flooding")
    waste = hotspot_by_category(waste_hotspots, "waste")
    if flooding["report_count"] != 3 or flooding["trend"] != "rising":
        raise RuntimeError("rising flooding signal did not match the demo contract")
    if waste["report_count"] != 4 or waste["trend"] != "stable":
        raise RuntimeError("stable waste signal did not match the demo contract")

    incidents = request("/admin/incidents", token=staff_token)
    demo = [item for item in incidents if item["title"].startswith(MARKER)]
    isolated = next((item for item in demo if "Pothole" in item["title"]), None)
    resolved = next((item for item in demo if "Blocked drain" in item["title"]), None)
    if isolated is None or isolated["status"] != "verified":
        raise RuntimeError("isolated verified report was not present")
    if resolved is None or resolved["status"] != "resolved":
        raise RuntimeError("resolved case was not present")
    resolved_detail = request(f"/admin/incidents/{resolved['id']}", token=staff_token)
    transitions = [entry["new_status"] for entry in resolved_detail["history"]]
    if transitions[-2:] != ["verified", "resolved"]:
        raise RuntimeError("resolution history does not prove classify -> staff resolution")
    if not any(MARKER in note["note"] for note in resolved_detail["notes"]):
        raise RuntimeError("resolution evidence note is missing")

    print(json.dumps({
        "fixture_created": seeded["created"],
        "marker": MARKER,
        "report_to_classify": flooding["report_ids"][-1],
        "rising_signal": {"reports": flooding["report_count"], "trend": flooding["trend"]},
        "stable_signal": {"reports": waste["report_count"], "trend": waste["trend"]},
        "isolated_report": isolated["id"],
        "resolved_case": resolved["id"],
        "resolution_history": transitions,
        "next": "Open Flutter Feed and CRM Incidents with the documented Playwright CLI checks.",
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(f"KAN-38 demo verification failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
