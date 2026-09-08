"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { ZoomHandlers } from "./leaflet-controls";

export interface HeatPoint {
  lat: number;
  lng: number;
  severity: string;
  title?: string;
  status?: string;
}

export interface MapBounds {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

function MapControls({ fs, setFs }: { fs: boolean; setFs: (v: boolean) => void }) {
  const map = useMap();
  const [found, setFound] = useState<{ pos: [number, number]; acc: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map, fs]);
  useEffect(() => {
    const onLoc = (e: L.LocationEvent) => {
      setErr(null);
      setFound({ pos: [e.latlng.lat, e.latlng.lng], acc: e.accuracy });
      map.flyTo(e.latlng, 13, { duration: 1.2 });
    };
    const onErr = () => setErr("Couldn't get your location — check browser permission.");
    map.on("locationfound", onLoc);
    map.on("locationerror", onErr);
    return () => {
      map.off("locationfound", onLoc);
      map.off("locationerror", onErr);
    };
  }, [map]);
  return (
    <>
      <div className="absolute right-3 top-3 z-[800] flex flex-col gap-2">
        <button
          title="Go to my location"
          aria-label="Go to my location"
          onClick={(e) => {
            e.stopPropagation();
            setErr(null);
            map.locate({ setView: false, timeout: 10000 });
          }}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-100"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
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
      {found && (
        <>
          <Marker position={found.pos}>
            <Popup>You are here</Popup>
          </Marker>
          <Circle
            center={found.pos}
            radius={Math.max(found.acc, 20)}
            pathOptions={{ color: "#2563eb", fillOpacity: 0.1 }}
          />
        </>
      )}
      {err && (
        <p className="absolute bottom-6 left-3 z-[800] rounded-md bg-white px-2 py-1 text-xs text-red-600 shadow">
          {err}
        </p>
      )}
    </>
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

function BoundsReporter({ onChange }: { onChange?: (bounds: MapBounds) => void }) {
  const map = useMap();
  const ready = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      ready.current = true;
    }, 700);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!onChange) return;
    const report = () => {
      if (!ready.current) return;
      const bounds = map.getBounds();
      onChange({
        min_lat: Number(bounds.getSouth().toFixed(6)),
        min_lng: Number(bounds.getWest().toFixed(6)),
        max_lat: Number(bounds.getNorth().toFixed(6)),
        max_lng: Number(bounds.getEast().toFixed(6)),
      });
    };
    map.on("moveend", report);
    return () => {
      map.off("moveend", report);
    };
  }, [map, onChange]);
  return null;
}

export function HeatmapMap({
  points,
  onBoundsChange,
}: {
  points: HeatPoint[];
  onBoundsChange?: (bounds: MapBounds) => void;
}) {
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
          minZoom={3}
          maxZoom={18}
          style={{
            height: fs && typeof window !== "undefined" ? window.innerHeight - 90 : 320,
            width: "100%",
          }}
        >      <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
        maxNativeZoom={17}
        attribution="Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom"
      />
      <FitToPoints pts={points.map((p) => [p.lat, p.lng])} />
      <BoundsReporter onChange={onBoundsChange} />
      <MapControls fs={fs} setFs={setFs} />
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
