"use client";

import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";

export interface HeatPoint {
  lat: number;
  lng: number;
  severity: string;
}

const severityColor: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

export function HeatmapMap({ points }: { points: HeatPoint[] }) {
  const center: [number, number] =
    points.length > 0 ? [points[0].lat, points[0].lng] : [0, 0];
  return (
    <MapContainer center={center} zoom={11} style={{ height: 320, width: "100%" }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={12}
          pathOptions={{
            color: severityColor[p.severity] ?? "#666",
            fillOpacity: 0.4,
          }}
        />
      ))}
    </MapContainer>
  );
}
