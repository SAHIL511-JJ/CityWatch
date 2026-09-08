"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import L from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { ZoomHandlers } from "./leaflet-controls";
import type { InsightMapPoint } from "@/lib/types";
import type { MapBounds } from "./heatmap-map";

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
const SEVERITY_COLOR: Record<string, string> = {
  low: "#278557",
  medium: "#b5822b",
  high: "#c45a32",
  critical: "#b83b3b",
};

export interface InsightsMapProps {
  points: InsightMapPoint[];
  fitKey?: string;
  selectedId?: string | null;
  onSelect?: (point: InsightMapPoint) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  className?: string;
  height?: number;
}

type PointCluster = {
  id: string;
  points: InsightMapPoint[];
  center: [number, number];
};

function MapControls({ fs, setFs }: { fs: boolean; setFs: (value: boolean) => void }) {
  const map = useMap();
  const [found, setFound] = useState<{ pos: [number, number]; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [fs, map]);

  useEffect(() => {
    const onFound = (event: L.LocationEvent) => {
      setError(null);
      setFound({ pos: [event.latlng.lat, event.latlng.lng], accuracy: event.accuracy });
      map.flyTo(event.latlng, 13, { duration: 1.1 });
    };
    const onError = () => setError("Location unavailable. Check browser permission.");
    map.on("locationfound", onFound);
    map.on("locationerror", onError);
    return () => {
      map.off("locationfound", onFound);
      map.off("locationerror", onError);
    };
  }, [map]);

  return (
    <>
      <div className="absolute right-3 top-3 z-[800] flex flex-col gap-2">
        <button
          type="button"
          title="Go to my location"
          aria-label="Go to my location"
          onClick={(event) => {
            event.stopPropagation();
            setError(null);
            map.locate({ setView: false, timeout: 10000 });
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300/90 bg-white/95 text-zinc-700 shadow-sm backdrop-blur transition hover:bg-[#f1f6ef] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] active:translate-y-px"
        >
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" />
            <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          title={fs ? "Exit fullscreen" : "Fullscreen map"}
          aria-label={fs ? "Exit fullscreen" : "Fullscreen map"}
          onClick={(event) => {
            event.stopPropagation();
            setFs(!fs);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300/90 bg-white/95 text-zinc-700 shadow-sm backdrop-blur transition hover:bg-[#f1f6ef] focus:outline-none focus:ring-2 focus:ring-[#2a4a33] active:translate-y-px"
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
            radius={Math.max(found.accuracy, 20)}
            pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 0.1 }}
          />
        </>
      )}
      {error && (
        <p className="absolute bottom-5 left-3 z-[800] rounded-lg border border-red-200 bg-white/95 px-3 py-2 text-xs text-red-700 shadow-sm backdrop-blur">
          {error}
        </p>
      )}
    </>
  );
}

function ViewportReporter({ onChange, suppressRef }: { onChange?: (bounds: MapBounds) => void; suppressRef: MutableRefObject<boolean> }) {
  const map = useMap();
  const ready = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      ready.current = true;
      suppressRef.current = false;
    }, 650);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!onChange) return;
    const report = () => {
      if (!ready.current) return;
      if (suppressRef.current) {
        suppressRef.current = false;
        return;
      }
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
  }, [map, onChange, suppressRef]);

  return null;
}

function ZoomReporter({ onChange }: { onChange: (zoom: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const report = () => onChange(map.getZoom());
    report();
    map.on("zoomend", report);
    return () => {
      map.off("zoomend", report);
    };
  }, [map, onChange]);
  return null;
}

function FitToPoints({ points, fitKey, suppressRef }: { points: InsightMapPoint[]; fitKey: string; suppressRef: MutableRefObject<boolean> }) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);
  const pointKey = points.map((point) => `${point.lat},${point.lng}`).join(";");

  useEffect(() => {
    if (!points.length || lastKey.current === fitKey) return;
    const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng] as [number, number]));
    suppressRef.current = true;
    if (points.length === 1) map.setView(bounds.getCenter(), 14, { animate: false });
    else map.fitBounds(bounds, { padding: [52, 52], maxZoom: 15, animate: true, duration: 0.65 });
    lastKey.current = fitKey;
  }, [fitKey, map, pointKey, points, suppressRef]);

  return null;
}

function clusterPoints(points: InsightMapPoint[], zoom: number): PointCluster[] {
  if (points.length < 2) {
    return points.map((point) => ({ id: point.id, points: [point], center: [point.lat, point.lng] }));
  }
  const cellSize = Math.max(0.0012, 0.65 / 2 ** Math.max(0, zoom - 8));
  const buckets = new Map<string, InsightMapPoint[]>();
  points.forEach((point) => {
    const key = `${Math.floor(point.lat / cellSize)}:${Math.floor(point.lng / cellSize)}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(point);
    buckets.set(key, bucket);
  });
  return Array.from(buckets.entries()).map(([id, bucket]) => ({
    id,
    points: bucket,
    center: [
      bucket.reduce((sum, point) => sum + point.lat, 0) / bucket.length,
      bucket.reduce((sum, point) => sum + point.lng, 0) / bucket.length,
    ],
  }));
}

function dominantSeverity(points: InsightMapPoint[]): string {
  return SEVERITY_ORDER.find((severity) => points.some((point) => point.severity === severity)) ?? "medium";
}

function clusterIcon(cluster: PointCluster) {
  const severity = dominantSeverity(cluster.points);
  const count = cluster.points.length;
  return L.divIcon({
    className: "citywatch-cluster-icon",
    html: `<span style="--cluster-color:${SEVERITY_COLOR[severity] ?? SEVERITY_COLOR.medium}">${count}</span>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
  });
}

function ClusterMarker({ cluster, onSelect, suppressRef }: { cluster: PointCluster; onSelect?: (point: InsightMapPoint) => void; suppressRef: MutableRefObject<boolean> }) {
  const map = useMap();
  const severity = dominantSeverity(cluster.points);
  if (cluster.points.length === 1) {
    const point = cluster.points[0];
    return (
      <CircleMarker
        center={[point.lat, point.lng]}
        radius={10}
        eventHandlers={{ click: () => onSelect?.(point) }}
        pathOptions={{
          color: "#fffdf8",
          weight: 3,
          fillColor: SEVERITY_COLOR[point.severity] ?? SEVERITY_COLOR.medium,
          fillOpacity: 0.96,
        }}
      >
        <Tooltip direction="top" offset={[0, -8]} sticky>
          <span className="font-semibold">{point.title}</span>
          <br />
          <span className="capitalize">{point.severity} · {point.category.replaceAll("_", " ")}</span>
        </Tooltip>
        <Popup>
          <strong>{point.title}</strong>
          <br />
          <span className="capitalize">{point.severity} · {point.status}</span>
        </Popup>
      </CircleMarker>
    );
  }

  return (
    <Marker
      position={cluster.center}
      icon={clusterIcon(cluster)}
      eventHandlers={{
        click: () => {
          suppressRef.current = true;
          map.fitBounds(L.latLngBounds(cluster.points.map((point) => [point.lat, point.lng] as [number, number])), {
            padding: [60, 60],
            maxZoom: Math.min(map.getZoom() + 3, 16),
            animate: true,
            duration: 0.55,
          });
          onSelect?.(cluster.points[0]);
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -18]}>
        <span className="font-semibold">{cluster.points.length} reports in this area</span>
        <br />
        <span className="capitalize">Highest severity: {severity}</span>
      </Tooltip>
      <Popup>
        <strong>{cluster.points.length} reports in this area</strong>
        <br />
        <span>Click to expand the cluster.</span>
      </Popup>
    </Marker>
  );
}

export function InsightsMap({
  points,
  fitKey = "default",
  selectedId,
  onSelect,
  onBoundsChange,
  className = "",
  height = 520,
}: InsightsMapProps) {
  const center: [number, number] = points.length ? [points[0].lat, points[0].lng] : [21, 78];
  const [fullscreen, setFullscreen] = useState(false);
  const suppressBounds = useRef(false);
  const [zoom, setZoom] = useState(11);
  const clusters = useMemo(() => clusterPoints(points, zoom), [points, zoom]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const displayedHeight = fullscreen && typeof window !== "undefined" ? window.innerHeight - 72 : height;
  return (
    <div className={`${fullscreen ? "fixed inset-0 z-[70] bg-[#faf7f0] p-4" : "relative"} ${className}`}>
      {fullscreen && <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#55705c]">Signal map · Esc to exit</p>}
      <div className="relative overflow-hidden rounded-[1.35rem] border border-[#dbe3d9] bg-[#e8eee7] shadow-[0_16px_45px_rgba(20,35,26,0.10)]">
        <MapContainer
          key={`${center.join(",")}-${fullscreen ? "fullscreen" : "inline"}`}
          center={center}
          zoom={points.length ? 11 : 4}
          minZoom={3}
          maxZoom={18}
          zoomControl
          style={{ height: displayedHeight, width: "100%" }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
            maxNativeZoom={17}
            attribution="Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom"
          />
          <FitToPoints points={points} fitKey={fitKey} suppressRef={suppressBounds} />
          <ViewportReporter onChange={onBoundsChange} suppressRef={suppressBounds} />
          <ZoomReporter onChange={setZoom} />
          <MapControls fs={fullscreen} setFs={setFullscreen} />
          <ZoomHandlers />
          {clusters.map((cluster) => (
            <ClusterMarker key={cluster.id} cluster={cluster} onSelect={onSelect} suppressRef={suppressBounds} />
          ))}
          {selectedId && points.some((point) => point.id === selectedId) && (
            <CircleMarker
              center={[
                points.find((point) => point.id === selectedId)?.lat ?? center[0],
                points.find((point) => point.id === selectedId)?.lng ?? center[1],
              ]}
              radius={17}
              pathOptions={{ color: "#14231a", weight: 2, fillOpacity: 0, opacity: 0.78 }}
            />
          )}
        </MapContainer>
        <div className="pointer-events-none absolute bottom-3 left-3 z-[800] rounded-xl border border-white/70 bg-[#fffdf8]/90 px-3 py-2 text-[11px] text-zinc-600 shadow-sm backdrop-blur">
          <div className="mb-1 font-semibold text-[#14231a]">Report severity</div>
          <div className="flex items-center gap-2">
            {SEVERITY_ORDER.map((severity) => (
              <span key={severity} className="inline-flex items-center gap-1 capitalize">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[severity] }} />{severity}
              </span>
            ))}
          </div>
        </div>
        {!points.length && (
          <div className="pointer-events-none absolute inset-0 z-[700] flex items-center justify-center bg-[#fffdf8]/25">
            <div className="rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 text-center shadow-sm">
              <p className="text-sm font-semibold text-[#14231a]">No reports in this map scope</p>
              <p className="mt-1 text-xs text-zinc-500">Move the map or clear the scope to widen the view.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
