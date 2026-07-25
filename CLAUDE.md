# CLAUDE.md

## Build and Test Commands

```bash
# Dev server (no build step — never add one)
python3 -m http.server 8000        # → http://localhost:8000

# Syntax check every module + the service worker
for f in js/*.js sw.js; do node --check "$f"; done

# Jargon guard — UI copy must stay friendly (must output nothing)
grep -nE "AES-256|[^a-z]IMU[^a-z]|GPS-ALT|Iz dev|sonar|fusion|cache-servicing|raw transcript" js/app.js index.html

# Brand/legacy guard (must output nothing)
grep -ri "pulsepath\|otter\|🦦\|safety beacon" js css index.html

# Mobile boot: drive with Playwright at 390×844 (see Verification below).
```

- No linter/formatter is configured; match surrounding style by hand.
- **Logic tests:** Node harness pattern — concatenate a shims file (Node 26 has a read-only built-in `navigator`; replace it via `Object.defineProperty`, not assignment) + `js/civic.js` + `js/crypto.js` + `js/data.js` + `js/learn.js` + `js/platform.js` + `js/engine.js` + assertions into **one** file, then `node combined.js`. Per-file `eval()` fails: modules use top-level `const` (script-scoped globals).
- **Mobile verification:** Playwright MCP — `browser_navigate`, `browser_resize` 390×844, `browser_console_messages` (expect 0 errors), `browser_take_screenshot`. Old `--headless --dump-dom` is unreliable here; use Playwright.
- **Backend:** Supabase MCP (`execute_sql`, `apply_migration`, `get_advisors`, `deploy_edge_function`) on project ref `qmlihmsgqassteijijvm`; clean up any test rows you insert.

## Code Style and Architecture

- **Language:** Vanilla HTML5 / CSS3 / ES6+. **No framework, no bundler, no npm, no CDN.** Vendored: Leaflet 1.9.4, supabase-js 2.110.7 (`@vendor/`).
- **Load order is a contract** (@index.html): civic → crypto → data → platform → learn → engine → weather → sync → app. Plain script-tag globals; no modules/imports.
- **Patterns:** singleton controllers (`Platform`, `Engine`, `Learn`, `Weather`, `Sync`, `Vault`, `VaultDB`, `MapCtl`, `Track`, `Feedback`); per-screen render functions; one delegated click handler switching on `data-act` (@js/app.js); sheet/scrim + toast UI.
- **State:** `localStorage["motio.v1"]` (settings/profile/hazards); `localStorage["motio.ml.v1"]` (learner weights); encrypted IndexedDB `motio-vault` (reports); `motio-tiles` (offline tiles).
- **Naming:** camelCase fns/vars; SCREAMING_SNAKE data globals (`CATEGORIES`, `CATEGORY_ORDER`, `SUBTYPES`, `NOVATO_HAZARD_ZONES`); kebab-case `data-act`; section-banner comments atop every file.
- **Design:** "warm civic brutalism" — type + grid + hard edges, 2px ink borders, solid offset "stamp" shadows, **no gradients, no blur**; all color via `:root` vars in @css/styles.css; light + dark both first-class.
- **Coordinates:** pure `lat/lng` everywhere. Never reintroduce a projection.
- Canonical doc: @README.md. Classifier: @js/engine.js. Routing + zones: @js/civic.js.

## Hard Rules and Constraints

1. Brand is **motio, strictly lowercase**. Logo asset: `vendor/leaflet/images/motio_logo1.png`.
2. **No technical jargon in UI copy.** Say "protected on your phone," never "AES-256-GCM"; plain words on the ride screen, never IMU/sonar/Iz. Encryption stays real (@js/crypto.js) — only the words change. Run the jargon guard.
3. Every captured report (GPS, note, photo) is AES-256-GCM encrypted via `Vault` **before** any storage. Plaintext at rest is a bug.
4. **Sensor/permission requests fire only inside a user-gesture** (Start Tracking, capture, enabling a toggle) — never on page load. `Platform.requestMotion()` gates iOS.
5. **Bike mode is the only autonomous sensor mode.** Walk/Drive are manual reporting + proximity alerts.
6. Classifier emits ONE of the four **stable general terms** (branch/pothole/trash/other) and never re-labels an existing report; the pencil edits it and trains `Learn`.
7. Detection arms only 6–22 mph; every auto-detection gets the 10-second cancel overlay; uploads ride the 10-minute loop or explicit approval (@js/sync.js).
8. The liability disclaimer (`NOVATO_MUNICIPAL_DIRECTORY.disclaimer`) precedes any clearing flow; age-gate + waiver are hard-gated in onboarding (mandatory Confirm, no Skip) and re-checked at action time.
9. Emergencies never route through the app: keep the persistent **911** button; after-hours Public Works is 415-897-4361. No hard-fall/beacon system.
10. Every sensor feature degrades gracefully per platform (@js/platform.js) and must not break desktop (manual reporting still works).
11. Supabase RLS: anon INSERT geofenced to Novato; votes are inserts into `confirmations`; **never grant anon UPDATE/DELETE**. Publishable key in @js/sync.js is public by design. The **Google Maps key lives only in the `imagery` edge function**, never in the repo; keep imagery geofenced.
12. Zone boxes are intentionally coarse; tighten to polylines only as a deliberate change.

## Project Overview

motio is a clean, mobile-first civic tool for cyclists and commuters in Novato, CA to find, report, and resolve road and trail hazards. In Bike mode the phone's motion sensors auto-detect bumps and classify them into four friendly categories (learning from the rider's corrections); reports are encrypted on-device, scored by community confidence, and routed to official Novato channels. Full feature, sensor-by-platform, backend, and validation status: @README.md.

<!-- ## Current Focus
(manually updated — e.g. current sprint, active bug, next feature)
-->
