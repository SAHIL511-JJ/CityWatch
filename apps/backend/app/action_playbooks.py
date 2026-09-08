"""Deterministic, read-only response guidance for recurring insight signals."""

from __future__ import annotations

from collections.abc import Mapping

from .taxonomy import canonical_category


PLAYBOOKS: dict[str, dict[str, object]] = {
    "flooding": {
        "objective": "Restore safe water flow and reduce repeat flooding at the signal location.",
        "authority": "Municipal drainage / public works",
        "immediate_steps": [
            "Inspect the affected route and clear visible obstructions from inlets and flow paths.",
            "Pump or redirect standing water where it threatens access, homes, or public safety.",
            "Inspect nearby drains and outfalls for capacity, damage, or repeat blockage.",
        ],
        "escalate_when": [
            "Critical reports indicate an immediate safety or access risk.",
            "The signal is rising, recurring after rainfall, or expanding beyond the current area.",
        ],
        "verify": "Recheck the location after the next rainfall and confirm that water drains without a new obstruction.",
    },
    "waterlogging": {
        "objective": "Remove standing water and restore reliable drainage before the next rainfall event.",
        "authority": "Municipal drainage / public works",
        "immediate_steps": [
            "Mark unsafe sections and keep pedestrians and vehicles away from deep or contaminated water.",
            "Clear nearby inlets and route standing water to a safe discharge point.",
            "Check whether the pattern is caused by blocked drainage, low capacity, or damaged infrastructure.",
        ],
        "escalate_when": [
            "Critical reports indicate danger to people, traffic, or property.",
            "Waterlogging persists after clearing or repeatedly returns in the same location.",
        ],
        "verify": "Confirm the area is passable and dry after the next significant rainfall.",
    },
    "blocked_drain": {
        "objective": "Restore drain flow and prevent the blockage from becoming a flooding or sanitation hazard.",
        "authority": "Drainage / sanitation services",
        "immediate_steps": [
            "Remove the obstruction from the inlet and keep collected material out of the drain opening.",
            "Inspect the inlet, grate, and downstream outfall for a second blockage or damage.",
            "Schedule desilting or maintenance if the same drain is repeatedly affected.",
        ],
        "escalate_when": [
            "The blockage is linked to flooding, sewage, or an unsafe road condition.",
            "The same location produces repeated reports after cleaning.",
        ],
        "verify": "Run water through the inlet or inspect it during the next rainfall to confirm unobstructed flow.",
    },
    "waste": {
        "objective": "Remove the accumulation safely and stop the location from becoming a recurring dumping point.",
        "authority": "Solid-waste collection / sanitation services",
        "immediate_steps": [
            "Isolate the accumulation if it blocks access or contains sharp, medical, or otherwise hazardous material.",
            "Collect and segregate the waste using the appropriate handling procedure.",
            "Identify the likely source and arrange a recurring collection or site-maintenance response.",
        ],
        "escalate_when": [
            "The accumulation is growing, obstructing access, or creating a health or fire risk.",
            "Reports show repeated dumping after prior collection.",
        ],
        "verify": "Perform a follow-up inspection and confirm the site remains clear during the next collection cycle.",
    },
    "sewage": {
        "objective": "Stop exposure to sewage, contain the overflow, and restore the affected utility safely.",
        "authority": "Sanitation / water utility services",
        "immediate_steps": [
            "Cordon the affected area and reduce contact with contaminated water or surfaces.",
            "Inspect the line, manhole, or discharge point to identify the overflow source.",
            "Contain, disinfect, and repair the failed section using the local sanitation procedure.",
        ],
        "escalate_when": [
            "Any active overflow creates a public-health exposure or affects homes, schools, or roads.",
            "Critical or repeated reports indicate the underlying utility failure is unresolved.",
        ],
        "verify": "Confirm there is no active overflow, persistent odor, or contaminated standing water after follow-up.",
    },
    "plastic": {
        "objective": "Remove plastic waste and reduce the source of repeated accumulation.",
        "authority": "Solid-waste collection / sanitation services",
        "immediate_steps": [
            "Collect and segregate the plastic waste through the approved waste-handling route.",
            "Clear nearby drains and waterways if the material is blocking flow or moving downstream.",
            "Identify repeat sources and place collection or prevention measures at the hotspot.",
        ],
        "escalate_when": [
            "Plastic is entering a drain, waterway, or public access route.",
            "The hotspot is expanding or returning after collection.",
        ],
        "verify": "Check the hotspot during the next collection cycle and confirm nearby drains or waterways remain clear.",
    },
    "pollution": {
        "objective": "Contain the suspected pollution source and reduce exposure while it is investigated.",
        "authority": "Environmental health / regulatory inspection",
        "immediate_steps": [
            "Identify the likely source and limit contact with affected air, water, soil, or materials where possible.",
            "Record the location, timing, visible indicators, and affected area for inspection.",
            "Collect measurements or samples when the responsible team and local procedure support it.",
        ],
        "escalate_when": [
            "Reports are rising or indicate high or critical exposure risk.",
            "The suspected source is active, spreading, or affecting a sensitive population.",
        ],
        "verify": "Repeat the relevant measurement or inspection and confirm that exposure indicators and complaints are improving.",
    },
    "damaged_infrastructure": {
        "objective": "Make the location safe and restore the damaged public infrastructure.",
        "authority": "Public works / infrastructure maintenance",
        "immediate_steps": [
            "Cordon or mark the hazard so people and vehicles do not enter the unsafe area.",
            "Inspect the structure or road section to determine the immediate safety risk.",
            "Schedule the appropriate repair and keep the location monitored until it is complete.",
        ],
        "escalate_when": [
            "The damage creates immediate danger, blocks access, or is worsening.",
            "Repeated reports indicate the temporary measure did not hold.",
        ],
        "verify": "Confirm the repair has been inspected and the area is safe to reopen.",
    },
    "other_environmental_condition": {
        "objective": "Inspect the signal, classify the hazard, and route it to the team best placed to resolve it.",
        "authority": "Local environmental response team",
        "immediate_steps": [
            "Inspect the location and document the condition, affected area, and immediate safety concerns.",
            "Apply the safest temporary control available while the responsible team is identified.",
            "Route the issue to the relevant department after classification.",
        ],
        "escalate_when": [
            "The condition is high or critical severity, unclear, or creating immediate danger.",
            "Reports continue after the temporary control is applied.",
        ],
        "verify": "Document the classification, response, and a follow-up inspection showing the condition is controlled.",
    },
}


def _count(summary: object, key: str) -> int:
    if not isinstance(summary, Mapping):
        return 0
    try:
        return max(0, int(summary.get(key, 0) or 0))
    except (TypeError, ValueError):
        return 0


def _priority(signal: Mapping[str, object]) -> str:
    score = signal.get("persistence_score")
    try:
        score_value = float(score or 0)
    except (TypeError, ValueError):
        score_value = 0
    severity_summary = signal.get("severity_summary")
    trend = str(signal.get("trend") or "").lower()
    if _count(severity_summary, "critical") > 0 or trend == "rising" or score_value >= 80:
        return "immediate"
    if _count(severity_summary, "high") > 0 or score_value >= 60:
        return "priority"
    return "routine"


def build_action_plan(signal: Mapping[str, object]) -> dict[str, object]:
    """Return a stable action brief derived only from signal evidence."""

    category = canonical_category(signal.get("category"))
    template = PLAYBOOKS.get(category, PLAYBOOKS["other_environmental_condition"])
    return {
        "priority": _priority(signal),
        "objective": str(template["objective"]),
        "authority": str(template["authority"]),
        "immediate_steps": list(template["immediate_steps"]),
        "escalate_when": list(template["escalate_when"]),
        "verify": str(template["verify"]),
    }
