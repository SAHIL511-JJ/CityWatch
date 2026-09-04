"use client";

import { useEffect, useState } from "react";
import L from "leaflet";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { ZoomHandlers } from "./leaflet-controls";

export interface HeatPoint {
  lat: number;
  lng: number;
  severity: string;
  title?: string;
  status?: string;
}

function FsControl({ fs, setFs }: { fs: boolean; setFs: (v: boolean) => void }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map, fs]);
  return (
    <div className="absolute right-3 top-3 z-[800]">
      <button
        title={fs ? "Exit fullscreen" : "Fullscreen map"}
        aria-label={fs ? "Exit fullscreen" : "Fullscreen map"}
        onClick={(e) => {
          e.stopPropagation();
          setFs(!fs);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-100"
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M8 3H3v5M12 17h5v-5M3 3l6 6M17 17l-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
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
  const [fs, setFs] = useState(false);

  useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFs(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);

  return (
    <div className={fs ? "fixed inset-0 z-[70] bg-white p-4" : "relative"}>
      {fs && <p className="mb-2 text-sm font-medium text-zinc-600">Incident map — Esc to exit</p>}
      <div>
        <MapContainer
          key={`${center.join(",")}-${fs ? "fs" : "inline"}`}
          center={center}
          zoom={points.length > 0 ? 11 : 4}
          style={{
            height: fs && typeof window !== "undefined" ? window.innerHeight - 90 : 320,
            width: "100%",
          }}
        >      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
        attribution="Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom"
      />
      <FitToPoints pts={points.map((p) => [p.lat, p.lng])} />
      <FsControl fs={fs} setFs={setFs} />
      <ZoomHandlers />
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lng]}
          radius={12}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: severityColor[p.severity] ?? "#666",
            fillOpacity: 0.9,
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
      </div>
    </div>
  );
}
