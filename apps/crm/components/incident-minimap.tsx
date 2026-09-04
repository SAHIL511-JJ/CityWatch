"use client";

import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

const severityColor: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  critical: "#ef4444",
};

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
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom={false}
      style={{ height: 280, width: "100%" }}
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
    </MapContainer>
  );
}
