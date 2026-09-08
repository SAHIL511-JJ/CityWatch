"use client";

import dynamic from "next/dynamic";

export type { MapBounds } from "./heatmap-map";

export const Heatmap = dynamic(() => import("./heatmap-map").then((m) => m.HeatmapMap), {
  ssr: false,
  loading: () => <p>Loading map…</p>,
});

export const InsightsMap = dynamic(() => import("./insights-map").then((m) => m.InsightsMap), {
  ssr: false,
  loading: () => <p>Loading interactive map…</p>,
});

export const IncidentMiniMap = dynamic(
  () => import("./incident-minimap").then((m) => m.IncidentMiniMap),
  {
    ssr: false,
    loading: () => <p>Loading map…</p>,
  }
);
