# motio

**Novato's community road & trail safety map.** motio (strictly lowercase) is a clean, mobile-first civic tool that helps cyclists and commuters find, report, and resolve local hazards. It's built to work primarily on **mobile Safari (iOS)** and **Chrome (Android)**, using real phone sensors where the platform allows and degrading gracefully everywhere else.

This README is the canonical context document for the project.

## ▶️ Run it

No build step, no framework, no bundler — plain script tags.

```bash
python3 -m http.server 8000
# open http://localhost:8000  (add to Home Screen on a phone to install the PWA)
```

Serving over https/localhost is recommended (sensors, camera, notifications, tiles, and the backend need a secure origin). On desktop it runs in a phone frame for design review; automatic bump-sensing needs a real phone.

## Tech stack

- **Vanilla HTML5 / CSS3 / ES6+** — strict no-framework rule; all files load via `<script>` tags
- **Leaflet 1.9.4** and **supabase-js 2.110.7** — vendored (`vendor/`), no CDN at runtime
- **Web Crypto (AES-256-GCM)** — every report is encrypted on-device before storage (the word "encryption" never appears in the UI — it's just "protected on your phone")
- **IndexedDB** — encrypted report inbox (`motio-vault`) + offline tile cache (`motio-tiles`)
- **PWA** — `manifest.json` + `sw.js` (cache-first shell) for install + offline + iOS notifications

## File map

```
index.html         shell: logo, mode chip, cloud-status, 911, 5-slot bottom nav, sheets, onboarding
css/styles.css     "warm civic brutalism" design system (light + dark)
js/civic.js        Novato directory (Title-Case departments, routing, disclaimer) + 7 risk zones
js/crypto.js       on-device encryption + encrypted inbox (IndexedDB)
js/data.js         map framing, 4 categories, 20-subtype registry, seeds, imagery endpoint
js/platform.js     OS detection + per-platform sensors (Android Generic Sensor API, iOS DeviceMotion+compass)
js/learn.js        on-device learning classifier (improves from the rider's edits)
js/engine.js       Bike-mode hazard sensing: adaptive baseline -> 4 general terms
js/weather.js      live National Weather Service alerts + wind banner
js/sync.js         encrypted staging + community sync + confidence
js/app.js          controller: screens, tracking, capture, reports, civic actions, settings
sw.js              service worker (offline shell)
vendor/            leaflet · supabase-js · motio logo (vendor/leaflet/images/motio_logo1.png)
```

Everything is **pure `lat/lng`** — no coordinate projection.

## Design — "warm civic brutalism"

Chosen for a field tool a rider glances at in sunlight: built entirely from **type + grid + hard edges** (zero image/GPU cost → instant load on mobile data), the highest WCAG headroom, and a voice that fits a municipal-safety subject. Signatures: a heavy display face over a **monospace civic-label voice**, 2px ink borders, and solid offset "stamp" shadows instead of soft blur. Palette derives from the motio logo (sage + copper on warm paper). Light **and** dark are both first-class; on Android, ambient light can auto-switch the theme. The layout is a **one-thumb rail**: single column, controls in the thumb zone, a true-centered 5-slot bottom bar with a raised report button, and edge-inset swipe between tabs that never fights the browser's own back-gesture.

## What it does (per the finalized spec)

- **Onboarding is a hard gate.** Mandatory **Confirm** buttons (not "Next") for 13+ and the community waiver — access is blocked until both are confirmed. Then a profile: display name + one emoji + **Public/Private** visibility.
- **Mode-specific sensing.** **Bike** is the only mode that senses bumps autonomously (motion + rotation + slope). **Walk/Drive** are manual reporting + proximity alerts.
- **Four categories, one stable term.** Fallen Branch · Pothole · Trash · Other. A 20-entry **subtype registry** (common + uncommon/e-bike cases) refines each. The classifier always emits one general term (never re-labels the same jolt) and the rider refines with the **pencil**, which trains the on-device model. Frequently-used custom subtypes get promoted as quick-picks.
- **Adaptive detection.** The engine tracks *this ride's* normal vibration and reacts to what's abnormal, blending a physics read with the learner. Slope comes from **GPS + elevation fusion** (backend proxy: Google Elevation with keyless USGS fallback). Smooth speed bumps are skipped, not logged.
- **Auto-photo (opt-in).** On a detected bump in Bike mode, a quick rear-camera frame is captured (brightness/blur gated) and rides inside the encrypted report.
- **Community map.** Confidence = 50 + 10 × net community votes (0–100); low-confidence and stale pins fade or drop off. Votes are insert-only (no anonymous edits/deletes).
- **Connectivity.** A single cloud icon (outline online, lightning offline); tap for a plain-language sync explanation.
- **Civic action.** The **Novato Report Directory** lists Title-Case departments with working links/emails; drafts include type, location, and — only if the profile is **Public** — the reporter's name and time.
- **Safety.** A permanent **911** button up top (no fragile hard-fall system). Live **National Weather Service** banner for wind/alerts. **Proximity alerts** in Track mode via browser notifications (fallback: spoken + vibration), with a **Near/Close/Far** slider that shows the distance in feet.
- **Location fallback.** If GPS can't get a fix on capture, the map opens so you can drop the pin by hand.

## Sensors by platform

`js/platform.js` detects the OS by feature-detection first (UA only as a tiebreak) and wires the best available path, always gesture-gated, never on page load:

| | Android Chrome | iOS Safari | Desktop |
|---|---|---|---|
| Bump sensing | Generic Sensor API (LinearAcceleration + Gyroscope, 60 Hz) → DeviceMotion fallback | DeviceMotion after `requestPermission()` in a tap | not available (manual reports only) |
| Heading | Magnetometer / AbsoluteOrientation | `webkitCompassHeading` | — |
| Notifications | Notification API | Web Push when installed to Home Screen | — |
| Ambient-light auto-theme | AmbientLightSensor | not exposed (silent no-op) | — |
| Camera · location · speech · vibration | ✓ | ✓ (no vibration) | partial |

Deliberately **not used** (no feature needs them; including them would be bloat): Web NFC, Web Bluetooth, Web USB, WebAuthn.

## Backend (Supabase — live)

- Project **motio** · ref `qmlihmsgqassteijijvm` · us-west-1.
- `public.hazards` `{id, type∈(branch,pothole,trash,other), subtype, lat, lng, severity, note, photo_url, elevation, zone, source, status, created_at}`; `public.confirmations` (insert-only votes); `public.hazards_scored` view adds `confidence` + `vote_count`.
- **RLS:** anon `SELECT`; anon `INSERT` only inside the Novato geofence; **no anon UPDATE/DELETE**. The publishable key in `js/sync.js` is public by design.
- **Edge function `imagery`** proxies Street View + elevation so the **Google Maps key stays server-side only** (never in the repo); requests are geofenced to Novato. Mapillary is wired but needs a token.
- The database was **purged to a clean launch state** (0 rows) as part of the v2 migration.

## Validation status (2026-07-25)

- ✅ 34/34 automated checks (Node harness): 4-category classify stability, benign-skip, learner convergence, per-OS platform detection, civic routing + Public/Private drafts, confidence math, encryption round-trip
- ✅ `node --check` clean on all modules; jargon-guard grep passes (no "encryption"/sensor jargon in UI copy); no demo/simulation/beacon surface remains
- ✅ Playwright mobile (390×844): **zero console errors**; onboarding hard gate verified (blocks without age/waiver/name); home, map (tiles + pins + clusters + zones), and settings render correctly in the warm-civic-brutalism system; weather banner shows live NWS data
- ✅ Live Supabase round-trip on the new schema: hazard (with subtype + elevation) insert → 2 votes → confidence view returns 70; geofence rejects out-of-area; edge function returns real elevation and 204s where no imagery exists

> Boundaries: classifier heuristics are tuned on synthetic signatures and need real ride data; Mapillary needs a token; anonymous inserts should get auth + rate-limiting before a public launch. The Google Maps key currently lives in the edge function — restrict it in Google Cloud Console.
