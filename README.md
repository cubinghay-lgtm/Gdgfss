# motio

**Novato's community road & trail hazard network.** motio (strictly lowercase) is a privacy-first, battery-efficient civic transit-safety web app for cyclists and pedestrians in Novato, California. Your phone's sensors detect infrastructure hazards while you ride; reports stage encrypted on-device, and you stay in control of what gets published.

Built per the `FirstRevision.md` spec. This README is the canonical context document for the project.

---

## ▶️ Run it

No build step, no framework, no bundler — plain script tags.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Serving over http is recommended (map tiles + Supabase need a network origin). On desktop it renders in a phone frame with full simulation tools (Settings → Demo & diagnostics). Real sensors (motion, GPS, mic, camera, dictation) activate on a phone over a secure origin.

## Tech stack

- **Vanilla HTML5 / CSS3 / ES6+** — strict no-framework rule; all files load via `<script>` tags
- **Leaflet 1.9.4** — vendored at `vendor/leaflet/` (no CDN)
- **supabase-js 2.110.7** — vendored at `vendor/supabase/` (no CDN at runtime)
- **Web Crypto** (`crypto.subtle`) — AES-256-GCM local encryption
- **IndexedDB** — encrypted report inbox (`motio-vault`) + offline tile cache (`motio-tiles`)
- **localStorage** — settings/profile/UI state (`motio.v1`) + device key JWK

## File map

```
index.html         app shell: topbar (wordmark, mode, 911), 5 screens, tabbar+FAB,
                   sheet/scrim, cancel-log overlay, safety beacon, onboarding
css/styles.css     design system — logo palette via CSS variables, light/dark,
                   matte-black OLED tracking skin, no gradients
js/civic.js        NOVATO_MUNICIPAL_DIRECTORY (routing/disclaimer), NOVATO_EMERGENCY,
                   NOVATO_HAZARD_ZONES (7 risk corridors), zoneForPoint/zonesForPoint,
                   zoneSensorFactor, buildCivicEmail
js/crypto.js       Vault (AES-256-GCM encrypt/decrypt, per-device JWK key),
                   VaultDB (encrypted IndexedDB inbox)
js/data.js         Novato map framing, 6 hazard categories, seed reports on real corridors
js/sensors.js      device API wrappers: geolocation+speed, DeviceMotion (accel+gyro),
                   Web Audio analyser, Magnetometer, dictation, TTS, camera, haptics
js/engine.js       the sensor-fusion engine (see below)
js/sync.js         Supabase client + encrypted inbox flow + the 10-minute upload loop
js/app.js          SPA controller: navigation, rendering, tracking lifecycle, capture,
                   review, civic actions, settings, onboarding
vendor/            leaflet 1.9.4 · supabase-js 2.110.7
```

Everything is **pure `lat/lng`** — there is no stylized coordinate projection.

## Brand palette (from the motio logo)

```
--paper #f2efe7   --ink #2f3a34    --brand #4f7166 (sage)   --brand-deep #3c5a50
--brand-soft #dbe5df   --accent #c07a4f (copper)   --accent-soft #efd9c9
--danger #d64d3f   --warn #e0902f   OLED #000000
```

All UI colors run through CSS variables in `:root` — re-map them when official brand values land.

---

## The sensor-fusion engine (`js/engine.js`)

**Four constant factors, polled every 50 ms** while tracking:

| Factor | Source | Fallback chain |
|---|---|---|
| `V` velocity | geolocation (GPS speed or derived) | — |
| `Iz` IMU z-axis | DeviceMotionEvent vertical accel | → GPS altitude-velocity tracking |
| `Ab` acoustic | Web Audio mic analyser (RMS) | → IMU-only (also off in Low Power Mode) |
| `Mg` geomagnetic | Magnetometer µT magnitude | → factor absent (metal tests soften) |

- **Arming rule:** detection armed **only between 6–22 mph**.
- **User-gesture rule:** iOS motion permission and the AudioContext are initialized **inside the Start Tracking click handler only** (`startTracking()` in app.js) — never on page load.
- **Thresholds self-tune** from the live noise floor and are scaled by zone context (`zoneSensorFactor`): documented landslip corridors run at ×0.82, erosion/pavement at ×0.88.

**On an `Iz` anomaly**, a 1-second buffer (pre-roll + capture) of vertical deviation, gyro rotation, acoustic impulse, and magnetometer delta feeds the **7-scenario matrix**:

1. Standard pothole → **log** · 2. Cattle guard/metal grate → **bypass** · 3. Manhole defect → **log** · 4. Dirt trail rut → **log** · 5. Low-hanging branch → **log** · 6. Severe impact/fall → **Safety Beacon** · 7. Speed bump → **bypass**

Settings → *Demo & diagnostics* feeds synthetic buffers for all 7 scenarios through the **real** classifier for desktop validation.

## Security & the 10-minute loop (`js/crypto.js`, `js/sync.js`)

1. Detection (or FAB capture) → sharp double-vibration + chime → **"CANCEL LOG" overlay with a 10-second countdown**.
2. Not cancelled → payload (GPS, note, photo, category) is **AES-256-GCM encrypted before touching storage** and staged in the IndexedDB inbox. Fresh random IV per record; per-device key stored as JWK.
3. **Auto-Upload ON:** a 10-minute timer decrypts staged reports and inserts them into Supabase. **OFF:** they wait for per-item approval in Review. Offline → the `online` event triggers the flush.
4. Photos stay on-device inside the encrypted payload (`photo_url` uploads as null until a storage bucket is added).

## Backend (Supabase — live)

- Project **`motio`** · ref `qmlihmsgqassteijijvm` · us-west-1 · URL + publishable key wired in `js/sync.js`.
- Table `public.hazards` `{id, type, lat, lng, severity, note, photo_url, zone, source, status, created_at}` with CHECK constraints on type/severity/status/source.
- **RLS:** anon may `SELECT` (public feed) and `INSERT` **only inside a Novato geofence** (lat 37.90–38.30, lng −122.80–−122.30 — validated: outside rows are rejected 401). No anon UPDATE/DELETE; moderation is server-side.
- Anonymous open reporting is a deliberate crowdsourcing choice for this phase; add auth + rate limiting before real public launch.

## Power & performance

- **Matte-black OLED tracking mode:** starting a track **fully unmounts the Leaflet map from the DOM** (`MapCtl.destroy()`), swapping to a solid `#000` telemetry screen (speed, km, elapsed, detections, Iz dev/threshold, factor status). The map re-initializes on next visit.
- **Wakelock:** a 1×1 invisible black looping muted `<video>` (canvas `captureStream`, no asset) + the native Screen Wake Lock API where present.
- **Low Power Mode:** disables the AudioContext factor entirely; fusion runs IMU-only.
- Offline tile cache fills as you pan while online; the 📴 toggle serves cached tiles.

## Safety

- Persistent **911 button** (`tel:911`) in the top bar, always visible.
- **Safety Beacon** (scenario 6): full-screen white/orange flash + high-volume tone bursts + one-tap 911; dismissible.
- Alert fallback chain: vibrate → audio chime → visual screen flash (`Feedback.alert`).
- Emergencies never route through email: 911, after-hours Public Works **415-897-4361** (surfaced in onboarding, the email drafter, and the directory).

## Civic integration (`js/civic.js`)

Six capture categories route to Novato's official channels via `CATEGORY_ROUTING`:

| Category | Route | Endpoint |
|---|---|---|
| pothole, manhole | Public Works | `pw@novato.org` + VueWorks citizen portal |
| rut, branch | Parks/Open Space | `pw@novato.org` + VueWorks citizen portal |
| oil | MCSTOPPP stormwater | `mlarizadeh@novato.gov` + mcstoppp.org form |
| dumping | FixItMarin | form-only (no direct email) |

The **email drafter** fills the official subject templates (type, GPS, map link, severity, notes, photo status) and embeds the California liability disclaimer. **Community Resolution** (clearing a minor hazard) always shows the disclaimer pop-up first, then an optional after-photo, and awards one profile point.

**The 7 hazard zones** (`NOVATO_HAZARD_ZONES`) are coarse bounding boxes for documented corridors — Rush Creek drainage flats, Indian Valley erosion, Stafford Lake, the March-2023 Redwood Blvd landslide path closure, the Novato Blvd rehab corridor, Grant Ave's bike-lane gap, and South Novato's Rowland corridor. They drive zone-entry announcements (TTS + haptic), map overlays (▦), and sensor sensitivity. Tighten to polyline geometries when segment-level flagging is needed.

## Onboarding & gates

Skippable carousel: welcome → privacy model → **age gate (13+)** → **safety waiver** (full disclaimer text). Skipping is allowed, but tracking enforces the waiver and capture/clearing enforce the age gate at action time.

## Validation status (2026-07-17)

- ✅ 43/43 automated checks (Node harness): zone lookups incl. overlap resolution, email routing incl. placeholder substitution, AES round-trip incl. 50 KB photo + IV freshness, all 7 classifier scenarios, velocity gate, zone-threshold scaling, seed integrity
- ✅ `node --check` clean on all 7 modules; no legacy PulsePath strings
- ✅ Headless Chrome boot: onboarding + home render, zero console errors; every `data-act` has a handler
- ✅ Live Supabase round-trip via the anon publishable key (insert 201 → select → server-side cleanup); geofence rejects out-of-area rows
- ✅ All 12 assets serve HTTP 200

> Prototype boundaries: magnetometer support is rare outside Android Chrome (the classifier degrades gracefully); classifier heuristics are tuned on synthetic signatures and need real ride data; photos don't upload yet (no storage bucket); anonymous inserts need auth/rate-limiting before public launch.
