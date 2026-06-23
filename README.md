# 🦦 PulsePath

**Map the bumps. Mind the trail.** — a friendly civic hazard-mapping app for Marin's roads & trails (commuters, hikers, bikers).

This is a working **mobile-web prototype**: a self-contained app you can open instantly with **no build step and no external dependencies**. Real device sensors are wired up where the browser allows; everything else simulates cleanly so the full experience works on desktop too.

## ▶️ Preview it

Just open `index.html` in a browser — or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

On desktop it renders inside a phone frame. For the real sensor experience, open it on your phone (motion, GPS, voice, camera all activate on a secure/`https` origin).

## What works right now

The strongest features are implemented as a coherent, navigable app:

| Area | Feature |
|------|---------|
| **Map** | Interactive community pin map · multi-category filters · hazard **clustering** · hybrid urban↔topo auto-switch · weather overlay · proximity ring |
| **Sensors** | Bike **Pulse Engine** (live accelerometer + impact threshold) · **Auto-GPS tagging** · calibration wizard · continuous terrain filter |
| **Capture** | One-tap quick capture (camera/photo) → private **review queue** · severity rater |
| **Review** | End-of-day verification inbox — confirm or delete before anything posts publicly |
| **Modes** | Bike · Walk (HealthKit/Google Fit bridge) · Patrol (camera watch + AR) · Drive (CO₂ speed-interceptor nudge) |
| **Civic** | Humanized municipal email drafter (FixItMarin) · CSV / GeoJSON export portal |
| **Community** | Proximity alerts on unverified pins · district progress counter · age-gated safe-clearing guide |
| **You** | Impact dashboard · achievement medals · profile card · history |
| **System** | True dark mode · hands-free voice "Log Danger" · TTS hazard readouts · custom proximity radius · battery saver · onboarding guide · otter mascot 🦦 |

### Try these in the preview
- **Map tab** → tap a pin, tap empty map to drop a report, toggle category chips, hit 🛰️ to *simulate a ride* (watch proximity alerts + auto-pulses fire).
- **Home → Start tracking** → *Simulate hit* to log an impact, or *Run calibration wizard*.
- **＋ button** → quick capture flow.
- **Review tab** → confirm/delete auto-logged items.
- **🎙️ top bar** → hands-free voice trigger (say "Log Danger").

## Tech

Vanilla HTML/CSS/JS, no framework, no bundler. State persists in `localStorage`.

```
index.html        app shell (screens, nav, sheets, onboarding)
css/styles.css    design system (light + dark)
js/data.js        categories, seed hazards, medals, geo projection
js/sensors.js     geolocation, accelerometer, voice, TTS, camera, haptics
js/app.js         state, navigation, rendering, all feature logic
```

> Prototype note: sensor calibration, the native health/widget bridges, and the
> community backend are stubbed for the preview. The UI, data flow, and on-device
> logic are real and ready to connect to live services.
