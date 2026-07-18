# CLAUDE.md

## Build and Test Commands

```bash
# Dev server (no build step — never add one)
python3 -m http.server 8000        # → http://localhost:8000

# Syntax check every module
for f in js/*.js; do node --check "$f"; done

# Rebrand guard (must output nothing)
grep -ri "pulsepath\|otter\|🦦" js css index.html

# Headless boot smoke test (expect Welcome/Start tracking/911 markers)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless \
  --virtual-time-budget=6000 --dump-dom "http://localhost:8000/" | grep -c "Start tracking"
```

- No linter/formatter is configured; match surrounding style by hand.
- Logic tests: Node harness pattern — concatenate browser shims + `js/civic.js` + `js/crypto.js` + `js/data.js` + `js/engine.js` + assertions into **one** file, then `node combined.js`. Per-file `eval()` fails: modules use top-level `const` (script-scoped globals).
- Backend checks: Supabase MCP (`execute_sql`, `get_advisors`) against project ref `qmlihmsgqassteijijvm`; clean up any test rows you insert.

## Code Style and Architecture

- **Language:** Vanilla HTML5 / CSS3 / JavaScript ES6+. **No framework, no bundler, no npm, no CDN.** Libraries are vendored: Leaflet 1.9.4 (@vendor/leaflet/), supabase-js 2.110.7 (@vendor/supabase/).
- **Load order is a contract** (@index.html): civic → crypto → data → sensors → engine → sync → app. Plain script-tag globals only; no modules/imports.
- **Patterns:** singleton controller objects (`Engine`, `Sync`, `Vault`, `VaultDB`, `MapCtl`, `Track`, `Feedback`, `Sensors`); per-screen render functions (`renderHome`, `renderInbox`…); one delegated click handler switching on `data-act` attributes (@js/app.js); sheet/scrim + toast UI system.
- **State:** `localStorage["motio.v1"]` for settings/profile/hazards; encrypted IndexedDB `motio-vault` for captured payloads; `motio-tiles` for the offline tile cache.
- **Naming:** camelCase functions/vars; SCREAMING_SNAKE data globals (`NOVATO_HAZARD_ZONES`, `SEED_HAZARDS`, `CATEGORIES`); kebab-case `data-act` verbs; section-banner block comments at the top of every file.
- **Coordinates:** pure `lat/lng` everywhere. Never reintroduce a projection layer.
- Canonical architecture/status doc: @README.md. Civic routing + zone data: @js/civic.js. Classifier: @js/engine.js.

## Hard Rules and Constraints

1. Brand is **motio, strictly lowercase** — in UI, copy, commits, docs.
2. `DeviceMotionEvent.requestPermission()` and `AudioContext` creation happen **only inside the Start Tracking click handler** (`startTracking()` in @js/app.js) — never on page load.
3. Every captured payload (GPS, notes, photos) is AES-256-GCM encrypted via `Vault` (@js/crypto.js) **before** touching any storage. Plaintext at rest is a bug.
4. Detection arms only at 6–22 mph; every auto-detection gets the 10-second Cancel Log overlay; uploads ride the 10-minute loop or explicit approval (@js/sync.js).
5. Voice captions are **raw native dictation transcripts only** — never AI-generate, summarize, or rewrite user text.
6. CSS: **no gradients**; every color flows through the `:root` variables in @css/styles.css (palette re-maps to official brand later).
7. Emergencies never route through the app or email: keep the persistent 911 button; after-hours Public Works is 415-897-4361.
8. The liability disclaimer (`NOVATO_MUNICIPAL_DIRECTORY.disclaimer`) must precede any clearing flow; age-gate and waiver are enforced at action time even if onboarding was skipped.
9. Every sensor feature must degrade gracefully (fallback chains) and be desktop-simulatable via Settings → Demo & diagnostics.
10. OLED tracking mode must **fully unmount** the Leaflet instance (`MapCtl.destroy()`), not hide it.
11. Supabase RLS: anon INSERT stays geofenced to Novato; never grant anon UPDATE/DELETE. The publishable key in @js/sync.js is public by design — the service key never enters this repo.
12. Zone boxes are intentionally coarse; tighten to polyline geometries only as a deliberate change.

## Project Overview

motio is a privacy-first, battery-efficient civic transit-safety web app for cyclists and pedestrians in Novato, California. A 4-factor sensor-fusion engine (velocity, IMU-Z, acoustic, magnetometer) auto-detects road and trail hazards through a 7-scenario classifier, stages them AES-encrypted on-device, and publishes user-approved reports to a live Supabase backend plus official Novato municipal channels (@js/civic.js). Full feature, validation, and backend status: @README.md.

<!-- ## Current Focus
(manually updated — e.g. current sprint, active bug, next feature)
- 
-->
