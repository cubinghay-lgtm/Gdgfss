# 🦦 PulsePath

**Map the bumps. Mind the trail.** — a friendly civic hazard-mapping app for Marin's roads & trails (commuters, hikers, bikers).

This is a working **mobile-web prototype**: a self-contained app with **no build step**. The only bundled dependency is **Leaflet** (vendored in `vendor/leaflet/`, no CDN). Real device sensors and a real map are wired up where the browser allows; everything else simulates cleanly so the full experience works on desktop too.

## ▶️ Preview it

Serve the folder (recommended — the map tiles and address search need an http origin):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Opening `index.html` directly via `file://` also works for the whole UI; only the live map tiles and search require being served/online. On desktop it renders inside a phone frame. For the real sensor experience, open it on your phone (motion, GPS, voice, camera activate on a secure/`https` origin).

## What works right now

The strongest features are implemented as a coherent, navigable app:

| Area | Feature |
|------|---------|
| **Map** | **Real Leaflet basemap** (OSM street / OpenTopoMap / Esri satellite) with native pinch-zoom & pan · address search · zoom & recenter controls · **online/offline toggle** with an IndexedDB tile cache that fills in as you pan · multi-category filters · zoom-aware hazard **clustering** · auto street↔topo hybrid + manual style toggle · tap-pin-to-focus · weather overlay · proximity ring |
| **Sensors** | Bike **Pulse Engine** (live accelerometer + impact threshold) · **Auto-GPS tagging** · calibration wizard · continuous terrain filter |
| **Capture** | One-tap quick capture (camera/photo) → private **review queue** · severity rater |
| **Review** | End-of-day verification inbox — confirm or delete before anything posts publicly |
| **Modes** | Bike · Walk (HealthKit/Google Fit bridge) · Patrol (camera watch + AR) · Drive (CO₂ speed-interceptor nudge) |
| **Civic** | Humanized municipal email drafter (FixItMarin) · CSV / GeoJSON export portal |
| **Community** | Proximity alerts on unverified pins · district progress counter · age-gated safe-clearing guide |
| **You** | Impact dashboard · achievement medals · profile card · history |
| **System** | True dark mode · hands-free voice "Log Danger" · TTS hazard readouts · custom proximity radius · battery saver · onboarding guide · otter mascot 🦦 |

### Try these in the preview
- **Map tab** → pinch/scroll to zoom, tap a pin (map flies to it), tap empty map to drop a report, search a place, cycle the 🗺️ style, toggle 📶/📴 online-offline, and open the **⋯ Demo tools** to *simulate a ride* (watch proximity alerts + auto-pulses fire).
- **Home → Start tracking** → *Simulate hit* to log an impact, or *Run calibration wizard*.
- **＋ button** → quick capture flow.
- **Review tab** → confirm/delete auto-logged items.
- **🎙️ top bar** → hands-free voice trigger (say "Log Danger").

## Tech

Vanilla HTML/CSS/JS, no framework, no bundler. State persists in `localStorage`.

```
index.html        app shell (screens, nav, sheets, onboarding)
css/styles.css    design system (light + dark)
js/data.js        categories, seed hazards, medals, geo projection, tile layers
js/sensors.js     geolocation, accelerometer, voice, TTS, camera, haptics
js/app.js         state, navigation, rendering, Leaflet map + tile cache, all logic
vendor/leaflet/   vendored Leaflet 1.9.4 (no CDN)
```

The app keeps an internal `x/y` coordinate model bridged to real `lat/lng` only at
the map layer, so sensors/tracking/proximity stay decoupled from the basemap.

> Prototype note: sensor calibration, the native health/widget bridges, and the
> community backend are stubbed for the preview. Map tiles need a network; offline
> mode serves whatever was cached while online. The UI, data flow, on-device logic,
> and the real map are functional and ready to connect to live services.
