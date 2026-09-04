"use client";

import { useEffect, useState } from "react";
import L from "leaflet";
import { Circle, CircleMarker, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

const severityColor: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

function CtrlBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-100"
    >
      {children}
    </button>
  );
}

/** Map-bound buttons + listeners. Must render inside MapContainer. */
function MiniMapControls({
  fs,
  setFs,
  setFound,
  setErr,
}: {
  fs: boolean;
  setFs: (v: boolean) => void;
  setFound: (f: { pos: [number, number]; acc: number } | null) => void;
  setErr: (msg: string | null) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 100);
    return () => clearTimeout(t);
  }, [map, fs]);

  useEffect(() => {
    const onLoc = (e: L.LocationEvent) => {
      setErr(null);
      setFound({ pos: [e.latlng.lat, e.latlng.lng], acc: e.accuracy });
      map.flyTo(e.latlng, 15, { duration: 1.2 });
    };
    const onErr = () => setErr("Couldn't get your location — check browser permission.");
    map.on("locationfound", onLoc);
    map.on("locationerror", onErr);
    return () => {
      map.off("locationfound", onLoc);
      map.off("locationerror", onErr);
    };
  }, [map, setFound, setErr]);

  return (
    <div className="absolute right-3 top-3 z-[800] flex flex-col gap-2">
      <CtrlBtn
        title="Go to my location"
        onClick={() => {
          setErr(null);
          map.locate({ setView: false, timeout: 10000 });
        }}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </CtrlBtn>
      <CtrlBtn title={fs ? "Exit fullscreen" : "Fullscreen map"} onClick={() => setFs(!fs)}>
        {fs ? (
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M3 8V3h5M17 12v5h-5M3 3l5 5M17 17l-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
            <path d="M8 3H3v5M12 17h5v-5M3 3l6 6M17 17l-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </CtrlBtn>
    </div>
  );
}

export function IncidentMiniMap({
  lat,
  lng,
  severity,
  title,
}: {
  lat: number;
  lng: number;
  severity: string;
  title: string;
}) {
  const [fs, setFs] = useState(false);
  const [found, setFound] = useState<{ pos: [number, number]; acc: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

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
      {fs && <p className="mb-2 text-sm font-medium text-zinc-600">Incident location — Esc to exit</p>}
      <div>
        <MapContainer
          key={`mini-${fs ? "fs" : "inline"}`}
          center={[lat, lng]}
          zoom={15}
          scrollWheelZoom={false}
          style={{
            height: fs && typeof window !== "undefined" ? window.innerHeight - 90 : 280,
            width: "100%",
          }}
        >
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom"
          />
          <CircleMarker
            center={[lat, lng]}
            radius={14}
            pathOptions={{
              color: "#ffffff",
              weight: 3,
              fillColor: severityColor[severity] ?? "#666",
              fillOpacity: 0.9,
            }}
          >
            <Popup>{title}</Popup>
          </CircleMarker>
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
          <MiniMapControls fs={fs} setFs={setFs} setFound={setFound} setErr={setErr} />
        </MapContainer>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
