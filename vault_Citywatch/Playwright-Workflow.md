# Playwright-Workflow

How **we** use Playwright MCP against the [[Frontend-CRM]] — a live loop, not a test suite.

## The loop

1. **Navigate** to `http://localhost:3000` (see [[Rules-and-Conventions]] localhost rule).
2. **Snapshot** — read the accessibility tree; every actionable element has a `ref` you act on.
3. **Act** — click/fill/select via refs, then re-snapshot.
4. **Screenshot + Read** — take the PNG, then Read it back as an image to actually see the render.
5. **Console + network** — pull console messages and failed requests after every change; a clean render with red console errors is still a failure.

## Measure, don't squint

Run `evaluate` for exact numbers instead of eyeballing: photo `naturalWidth/naturalHeight` vs displayed size, tile zoom levels on the map, and map container heights (inline 280px vs heatmap 320px vs fullscreen `innerHeight-90`). Pixel claims in reviews must come from measurements.

## Trusted vs synthetic input

Synthetic `ctrl+wheel` events **failed** to reproduce the tab-zoom bug — only the real keyboard+mouse path (keyboard down, mouse wheel) proved the pinch fix works. Lesson: gesture code (`ZoomHandlers` in [[Frontend-CRM]]) must be verified with trusted input, never synthetic dispatch alone.

## Hygiene

- Both dev servers on, API on 8000 first: redirect server output **to a file**, and kill stale servers by **port PID** (full kill, not just Ctrl-C) before restarting.
- **Fullscreen-screenshot sticky artifact**: exiting fullscreen can leave a stale overlay in captures — re-snapshot after Esc.
- **Log in each run** (`admin@example.com` / `admin123`); the staff token does not persist across fresh contexts.
- **Temp-file cleanup**: remove `.playwright-mcp/` output and screenshots when done (per [[Rules-and-Conventions]]).

Related: [[Frontend-CRM]], [[Rules-and-Conventions]], [[Backend]].
