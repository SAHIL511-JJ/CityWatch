# Hotspot API

CityWatch derives hotspot signals from verified incidents at request time. The
same deterministic clustering service powers the citizen and staff contracts;
the staff contract adds operational metadata.

Both endpoints require a CityWatch JWT. Citizen tokens may call the public
contract; staff tokens may call the staff contract.

## Public nearby hotspots

`GET /hotspots`

Query parameters:

- `lat` and `lng` — required WGS84 location.
- `radius_km` — `0.05`–`25`, default `0.75`.
- `window_days` — `1`–`365`, default `30`.
- `limit` — `1`–`100`, default `20`.
- `category` — environmental category key.
- `severity` — `low`, `medium`, `high`, or `critical`.
- `trend` — `rising`, `stable`, `declining`, or `isolated`.

Example:

```http
GET /hotspots?lat=18.5204&lng=73.8552&radius_km=2&window_days=30&trend=rising
Authorization: Bearer <citizen-jwt>
```

Response:

```json
[
  {
    "id": "flooding:18.5204:73.8552",
    "category": "flooding",
    "centroid": {"lat": 18.5204, "lng": 73.8552},
    "report_count": 4,
    "unique_contributors": 3,
    "first_observed": "2026-09-01T08:00:00+00:00",
    "last_observed": "2026-09-08T08:00:00+00:00",
    "severity_summary": {"high": 2, "medium": 2},
    "latest_status": "verified",
    "persistence_score": 78,
    "trend": "rising",
    "mean_distance_km": 0.18,
    "report_ids": ["incident-1", "incident-2"],
    "explanation": "4 flooding observations from 3 contributor(s) across 7.0 days; mean spread 0.18 km; average confidence 91%."
  }
]
```

The public response contains only verified, high-confidence signal data. It
never includes reporter IDs, staff assignments, internal notes, or private
evidence metadata.

## Staff hotspot intelligence

`GET /admin/analytics/hotspots`

It accepts the same filters, except `lat` and `lng` are optional together so
staff can request a citywide view. A partial coordinate pair returns `422`.

Each staff hotspot also includes:

```json
{
  "related_incident_ids": ["incident-1", "incident-2"],
  "assignment_status": {
    "assigned": 1,
    "unassigned": 1,
    "by_incident": [
      {"incident_id": "incident-1", "assigned_to": "staff-1", "status": "assigned"},
      {"incident_id": "incident-2", "assigned_to": null, "status": "unassigned"}
    ]
  },
  "evidence_counts": {"reports": 2, "photos": 2, "notes": 1}
}
```

## Stable edge cases

- No matching observations returns `[]` with HTTP `200`.
- Missing or partial public coordinates returns a validation error; invalid
  coordinate ranges return `422`.
- Invalid severity or trend filters return `422`.
- Results are bounded to 1000 candidate incidents and 100 response clusters,
  ordered by persistence score descending, then category and deterministic ID.
