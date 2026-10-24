# Spatial frontend

- `/`: 3,000px sticky story, four chapters, CSS-transformed schematic city, WebGL rain, SVG glass optics. Chapter buttons and reduced-motion support are included.
- `/map`: existing route/search/navigation features inside the spatial HUD. `/dashboard` remains the saved-places/community page. Saved-place links now target `/map?origin=lat,lng`.
- The map uses CARTO Dark Matter with MapLibre and the existing Deck.gl packages. The flood-column toggle shows measured live flood ratios; it does not synthesize missing values.
- TTH 145 snapshots appear only when that camera has an image. Landing detection, fusion, and route-saving figures are explicitly simulated. The city is an illustrative diagram, not a geographic navigation map.
- Demo sends `demo:extreme-rain` over `/ws/alerts`. The server responds with `DEMO_FLOOD_ALERT`, source `SIMULATED`, only on that socket. It never mutates camera evidence, broadcasts to other users, or replaces a real computed route. The client waits for acknowledgement before showing illustrative paths and voice warnings. Restart the backend to enable this protocol.
- Voice uses browser speech synthesis (`vi-VN`); available Vietnamese voices and automatic playback depend on the browser/device. The HUD also offers manual playback.
- Live snapshots, routing, weather, and tiles retain their external-service dependencies and unavailable states.

Run locally from `frontend`: `npm run dev`. Check with `npm run type-check`, `npm run test:navigation`, `npm run build`, and `npx playwright test e2e/spatial-experience.spec.ts`. Set `PLAYWRIGHT_EXTERNAL_SERVER=1` for an already-running server on port 3100. The demo browser test stubs WebSocket acknowledgement; it does not verify a running backend or physical voice output.
