# Frontend-CRM

Next.js 14 ops console in `apps/crm` (React 18, Tailwind, TanStack Query, `react-leaflet`, Recharts), port 3000. Talks to the [[Backend]] only (`NEXT_PUBLIC_API_URL=http://localhost:8000`) — no Supabase client in the browser.

## 4 modules

- **Dashboard** (`app/page.tsx`) — total incidents, by-status and by-category lists, by-day list from `GET /admin/analytics/summary`.
- **Incidents** (`app/incidents/page.tsx` + `app/incidents/[id]/page.tsx`) — status/severity filter dropdowns, card list, and a redesigned detail view (below).
- **Users** (`app/users/page.tsx`) — verify / ban / unban citizens via `PATCH /admin/users/{id}`.
- **Analytics** (`app/analytics/page.tsx`) — Recharts bar (by category) + line (by day) + severity-colored incident map.

## Sidebar shell (`components/sidebar.tsx`)

Dark-green (`#14231a`) fixed sidebar, grouped sections (Overview / Review / Manage / Insights) with section labels, SVG icons, active-state pill (`#2a4a33`), `CW` badge + `OPS · V1` wordmark, sign-out button, and a cream content area (`#faf7f0`) with per-route header title. The **Incidents** item carries a `needs_review` count badge, polled every 60s.

## Detail redesign (`app/incidents/[id]/page.tsx`)

Header (status + severity + verified-reporter badges, title, address/coords, reporter identity + trust) over an evidence/map **two-column** grid (`lg:grid-cols-5`, 3+2): photo evidence with click-to-open **lightbox**, location card with minimap, AI verdict card (category/severity/confidence/reason), Moderate card (Approve/Reject/Escalate/Resolve/Close + severity save + assign), internal notes thread, and audit history timeline. Photos load via `GET /admin/incidents/{id}/photo?token=` (see [[Backend]]).

## Maps

- **Esri** `World_Street_Map` tiles (chosen over OSM/Carto — Carto watermarks without a key; see [[Decisions-Log]]).
- **Zoom caps**: `maxZoom={18}`, `maxNativeZoom={17}` (past z18 Esri serves "Map Data Not Available").
- **fitBounds fix** (`heatmap-map.tsx`): `MapContainer` freezes its view at mount while points arrive async, so the map remounts by `key` on the real center and `FitToPoints` calls `fitBounds` with padding.
- **Controls**: locate-me (`map.locate` + flyTo + accuracy circle) and fullscreen (fixed overlay, Esc exits, `invalidateSize` on toggle) on both minimap and heatmap.
- **Gesture system** (`leaflet-controls.tsx` `ZoomHandlers`): pinch (`ctrl+wheel`) always zooms anchored at the cursor and never zooms the tab; plain wheel zooms only while the map is focused, otherwise the page scrolls.

Related: [[Playwright-Workflow]], [[Backend]], [[Database]], [[AI-Pipeline]], [[Rules-and-Conventions]].
