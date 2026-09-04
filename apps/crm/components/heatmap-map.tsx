"use client";

import { useEffect } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";

export interface HeatPoint {
  lat: number;
  lng: number;
  severity: string;
  title?: string;
  status?: string;
}

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

function FitToPoints({ pts }: { pts: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [40, 40] });
  }, [map, pts.map((p) => p.join(",")).join(";")]);
  return null;
}

export function HeatmapMap({ points }: { points: HeatPoint[] }) {
  // MapContainer freezes its view at mount, but points arrive async after
  // the incidents query resolves — so remount (via key) once we know the
  // real center instead of staying stuck at the [0,0] fallback.
  const center: [number, number] =
    points.length > 0 ? [points[0].lat, points[0].lng] : [21.0, 78.0];
  return (
    <MapContainer
      key={center.join(",")}
      center={center}
      zoom={points.length > 0 ? 11 : 4}
      style={{ height: 320, width: "100%" }}
    >      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitToPoints pts={points.map((p) => [p.lat, p.lng])} />
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={12}
          pathOptions={{
            color: severityColor[p.severity] ?? "#666",
            fillOpacity: 0.4,
          }}
        >
          {(p.title || p.status) && (
            <Popup>
              <strong>{p.title ?? "Incident"}</strong>
              <br />
              {p.status ?? p.severity}
            </Popup>
          )}
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
