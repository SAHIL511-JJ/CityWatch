export const ENVIRONMENTAL_CATEGORIES = [
  "flooding",
  "waterlogging",
  "blocked_drain",
  "waste",
  "sewage",
  "plastic",
  "pollution",
  "damaged_infrastructure",
  "other_environmental_condition",
] as const;

export type EnvironmentalCategory = (typeof ENVIRONMENTAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EnvironmentalCategory, string> = {
  flooding: "Flooding",
  waterlogging: "Waterlogging",
  blocked_drain: "Blocked drain",
  waste: "Waste",
  sewage: "Sewage",
  plastic: "Plastic",
  pollution: "Pollution",
  damaged_infrastructure: "Damaged infrastructure",
  other_environmental_condition: "Other environmental condition",
};

export function categoryLabel(value: unknown): string {
  const key = String(value ?? "other_environmental_condition");
  if (key in CATEGORY_LABELS) {
    return CATEGORY_LABELS[key as EnvironmentalCategory];
  }
  return "Other environmental condition";
}

