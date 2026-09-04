"use client";

import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Makes trackpad/mouse gestures behave on embedded maps:
 * - Pinch (wheel + ctrl) ALWAYS zooms the map under the cursor and never
 *   the browser tab (preventDefault + zoom anchored at pointer).
 * - Plain wheel zooms the map only while it has focus (click into it);
 *   otherwise the page scrolls normally instead of getting trapped.
 * Render inside any MapContainer. No props needed.
 */
export function ZoomHandlers() {
  const map = useMap();

  useEffect(() => {
    map.scrollWheelZoom.disable();
    const onFocus = () => map.scrollWheelZoom.enable();
    const onBlur = () => map.scrollWheelZoom.disable();
    map.on("focus", onFocus);
    map.on("blur", onBlur);
    return () => {
      map.off("focus", onFocus);
      map.off("blur", onBlur);
    };
  }, [map]);

  useEffect(() => {
    const el = map.getContainer();
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain scroll: page handles it unless focused
      e.preventDefault();
      e.stopPropagation();
      const dir = e.deltaY > 0 ? -1 : 1;
      const at = map.mouseEventToContainerPoint(e);
      // clamp to tile coverage: past z18 Esri serves "Map Data Not Available"
      const next = Math.min(18, Math.max(3, map.getZoom() + dir * 0.6));
      map.setZoomAround(at, next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [map]);

  return null;
}

export function FsButton({ fs, setFs }: { fs: boolean; setFs: (v: boolean) => void }) {
  return (
    <button
      title={fs ? "Exit fullscreen" : "Fullscreen map"}
      aria-label={fs ? "Exit fullscreen" : "Fullscreen map"}
      onClick={(e) => {
        e.stopPropagation();
        setFs(!fs);
      }}
      className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-300 bg-white text-zinc-700 shadow-sm hover:bg-zinc-100"
    >
      {fs ? (
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M3 8V3h5M17 12v5h-5M3 3l5 5M17 17l-5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
          <path d="M8 3H3v5M12 17h5v-5M3 3l6 6M17 17l-6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
