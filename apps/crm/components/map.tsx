"use client";

import dynamic from "next/dynamic";

export const Heatmap = dynamic(() => import("./heatmap-map").then((m) => m.HeatmapMap), {
  ssr: false,
  loading: () => <p>Loading map…</p>,
});
