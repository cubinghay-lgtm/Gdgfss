/* ============================================================
   app.js — motio controller.
   Ties the shell, sensors, engine, learner, weather, map and
   community sync into one one-handed mobile experience. All
   user-facing copy is plain language — no sensor/crypto jargon.
   ============================================================ */

/* ================= State ================= */
const STORE_KEY = "motio.v1";
const DEFAULT_STATE = () => ({
  onboarded: false,
  ageConfirmed: false,
  waiverAccepted: false,
  profile: { name: "", emoji: "🚲", visibility: "public", points: 0, mapped: 0, cleared: 0 },
  settings: {
    mode: "bike",            // bike | walk | drive
    autoUpload: true,
    tts: true,
    autoPhoto: true,
    prox: 1,                 // 0 Near · 1 Close · 2 Far
    dark: false,
    autoDark: true,          // Android ambient-light auto theme
    offline: false,
    notifications: false,
  },
  hazards: SEED_HAZARDS.map(h => ({ ...h })),
  filters: { branch: true, pothole: true, trash: true, other: true },
  promoted: {},              // custom subtype label -> count (Other promotion)
  history: [],
});

let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = Object.assign(DEFAULT_STATE(), JSON.parse(raw));
      s.settings = Object.assign(DEFAULT_STATE().settings, s.settings);
      s.profile = Object.assign(DEFAULT_STATE().profile, s.profile);
      return s;
    }
  } catch (e) {}
  return DEFAULT_STATE();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

/* ================= Helpers ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => "m" + Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtAgo = (ts) => { const d = Math.floor((Date.now() - ts) / 1000); if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago"; if (d < 86400) return Math.floor(d / 3600) + "h ago"; return Math.floor(d / 86400) + "d ago"; };
const sevColors = ["#5f8a5f", "#8a9a4e", "#d98a2b", "#cf6b3a", "#cf4436"];
const sevColor = (n) => sevColors[Math.max(1, Math.min(5, n)) - 1];
const sevWord = (n) => ["", "Minor", "Small", "Moderate", "Big", "Severe"][Math.max(1, Math.min(5, n))];
const MODE_LABEL = { bike: "Bike", walk: "Walk", drive: "Drive" };
const PROX = [{ label: "Near", m: 46, ft: 150 }, { label: "Close", m: 122, ft: 400 }, { label: "Far", m: 274, ft: 900 }];
function haversineM(a, b) { const R = 6371000, r = Math.PI / 180; const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function pushHistory(icon, text) { state.history.unshift({ t: Date.now(), icon, text }); state.history = state.history.slice(0, 30); save(); }
function allHazards() { const seen = new Set(state.hazards.map(h => h.id)); return state.hazards.concat((window._remoteHazards || []).filter(h => !seen.has(h.id))); }

/* ================= Toasts + feedback ================= */
function toast(msg, kind = "", ms = 2800) {
  const el = document.createElement("div"); el.className = "toast " + kind; el.innerHTML = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}
const Feedback = {
  _ctx: null,
  tone(freq = 880, ms = 150) {
    try {
      if (!this._ctx) { const AC = window.AudioContext || window.webkitAudioContext; this._ctx = new AC(); }
      if (this._ctx.state === "suspended") this._ctx.resume().catch(() => {});
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.type = "square"; o.frequency.value = freq; g.gain.value = 0.3;
      o.connect(g); g.connect(this._ctx.destination); o.start(); o.stop(this._ctx.currentTime + ms / 1000);
      return true;
    } catch (e) { return false; }
  },
  flash() { const d = $("#device"); d.style.transition = "none"; d.style.filter = "invert(1)"; setTimeout(() => { d.style.transition = "filter .2s"; d.style.filter = "none"; }, 120); },
  alert() { if (Platform.buzz([90, 60, 90])) return; if (this.tone(900, 150)) return; this.flash(); },
};

/* ================= Theme ================= */
function applyTheme() { document.documentElement.dataset.theme = state.settings.dark ? "dark" : "light"; }

/* ================= Navigation ================= */
let currentScreen = "home";
function showScreen(name) {
  if (Track.active && name !== "ride") { endTracking(); }
  currentScreen = name;
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  if (name === "home") renderHome();
  else if (name === "map") renderMap();
  else if (name === "inbox") renderInbox();
  else if (name === "settings") renderSettings();
}

/* ================= HOME ================= */
function renderHome() {
  const p = state.profile;
  const hi = new Date().getHours() < 12 ? "Morning" : new Date().getHours() < 17 ? "Afternoon" : "Evening";
  $("#screen-home").innerHTML = `
    <span class="eyebrow">Novato · ${MODE_LABEL[state.settings.mode]} mode</span>
    <h1>Good ${hi},<br>${esc(p.name || "rider")} ${esc(p.emoji)}</h1>
    <p class="sub">Spot a hazard, help the next rider avoid it.</p>
    <div class="stats">
      <div class="stat"><b>${p.mapped}</b><span>Mapped</span></div>
      <div class="stat"><b>${p.cleared}</b><span>Cleared</span></div>
      <div class="stat"><b>${p.points}</b><span>Points</span></div>
    </div>
    <button class="btn" data-act="start-track" style="min-height:60px;font-size:17px">▶ Start ${MODE_LABEL[state.settings.mode]} tracking</button>
    <p class="muted center" style="margin-top:8px">${state.settings.mode === "bike"
      ? "Your phone watches for bumps automatically between 6–22 mph."
      : "Get spoken alerts as you near known hazards. Tap ＋ to add one."}</p>
    <div class="card" style="margin-top:16px">
      <h3>Near you</h3>
      <p class="muted" id="homeZone">Checking your area…</p>
    </div>
    <div class="card">
      <h3>Recent</h3>
      ${state.history.length ? state.history.slice(0, 5).map(h => `<div class="row" style="padding:7px 0"><span>${h.icon}</span><span style="flex:1;font-size:13px">${esc(h.text)}</span><span class="muted">${fmtAgo(h.t)}</span></div>`).join("") : `<p class="muted">Nothing yet — start tracking or tap ＋ to add a report.</p>`}
    </div>`;
  Platform.getPosition().then(pos => {
    const el = $("#homeZone"); if (!el) return;
    if (!pos) { el.textContent = "Turn on location to see nearby hazards and alerts."; return; }
    const z = zoneForPoint(pos.lat, pos.lng);
    const near = allHazards().filter(h => haversineM(pos, h) < 800).length;
    el.innerHTML = (z ? `You're near a known trouble spot: <b>${esc(z.title.split("—")[0].trim())}</b>. ` : "") + `${near} hazard${near === 1 ? "" : "s"} reported within half a mile.`;
  });
  refreshWeather();
}

/* ================= MAP ================= */
const MapCtl = {
  map: null, tiles: null, markers: [], zoneRects: [], meMarker: null, showZones: true,
  BLANK: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  _db: null,
  tileDB() { return new Promise(r => { if (this._db) return r(this._db); if (!("indexedDB" in window)) return r(null); const q = indexedDB.open("motio-tiles", 1); q.onupgradeneeded = () => q.result.createObjectStore("t"); q.onsuccess = () => { this._db = q.result; r(this._db); }; q.onerror = () => r(null); }); },
  async tGet(k) { const db = await this.tileDB(); if (!db) return null; return new Promise(r => { const q = db.transaction("t").objectStore("t").get(k); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); },
  async tPut(k, v) { const db = await this.tileDB(); if (!db) return; try { db.transaction("t", "readwrite").objectStore("t").put(v, k); } catch (e) {} },
  isOffline() { return state.settings.offline || !navigator.onLine; },

  init() {
    if (this.map) return;
    const host = $("#leafletHost"); if (!host) return;
    this.map = L.map(host, { center: [NOVATO_CENTER.lat, NOVATO_CENTER.lng], zoom: DEFAULT_ZOOM, zoomControl: false });
    const self = this;
    const Caching = L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement("img"); const key = `${coords.z}/${coords.x}/${coords.y}`; const url = L.Util.template(TILE_LAYER.url, coords);
        if (self.isOffline()) { self.tGet(key).then(d => { img.src = d || self.BLANK; done(null, img); }); }
        else { img.crossOrigin = "anonymous"; img.onload = () => { done(null, img); try { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext("2d").drawImage(img, 0, 0); self.tPut(key, c.toDataURL("image/png")); } catch (e) {} }; img.onerror = () => self.tGet(key).then(d => { img.src = d || self.BLANK; done(null, img); }); img.src = url; }
        return img;
      },
    });
    this.tiles = new Caching(TILE_LAYER.url, { maxZoom: TILE_LAYER.maxZoom, attribution: TILE_LAYER.attribution });
    this.tiles.addTo(this.map);
    this.drawZones();
    this.map.on("moveend zoomend", () => { this.refreshPins(); this.updateZoneBanner(); });
    this.map.on("click", (e) => openCapture({ lat: e.latlng.lat, lng: e.latlng.lng }));
    this.refreshPins(); this.updateZoneBanner();
  },
  destroy() { if (!this.map) return; try { this.map.remove(); } catch (e) {} this.map = null; this.tiles = null; this.markers = []; this.zoneRects = []; this.meMarker = null; const h = $("#leafletHost"); if (h) h.innerHTML = ""; },
  drawZones() {
    this.zoneRects.forEach(r => r.remove()); this.zoneRects = [];
    if (!this.showZones || !this.map) return;
    for (const z of Object.values(NOVATO_HAZARD_ZONES)) {
      const r = L.rectangle([[z.latMin, z.lngMin], [z.latMax, z.lngMax]], { color: "#c07a4f", weight: 1.5, dashArray: "5 4", fillColor: "#c07a4f", fillOpacity: 0.05, interactive: false });
      r.addTo(this.map); this.zoneRects.push(r);
    }
  },
  visible() { return allHazards().filter(h => state.filters[h.cat]); },
  clusters() {
    const list = this.visible(); if (!this.map) return []; const groups = []; const used = new Set();
    for (const h of list) { if (used.has(h.id)) continue; const g = [h]; used.add(h.id); const p1 = this.map.latLngToContainerPoint([h.lat, h.lng]); for (const o of list) { if (used.has(o.id)) continue; const p2 = this.map.latLngToContainerPoint([o.lat, o.lng]); if (p1.distanceTo(p2) < 44) { g.push(o); used.add(o.id); } } groups.push(g); }
    return groups;
  },
  refreshPins() {
    if (!this.map) return; this.markers.forEach(m => m.remove()); this.markers = [];
    for (const g of this.clusters()) {
      if (g.length === 1) {
        const h = g[0]; const c = CATEGORIES[h.cat];
        const conf = h.confidence != null ? h.confidence : (h.status === "verified" ? 70 : 45);
        const cls = conf < 40 ? "low" : (h.status === "verified" ? "verified" : "unverified");
        const icon = L.divIcon({ className: "", html: `<div class="pin ${cls}" style="background:${c.color}"><span>${c.icon}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 28] });
        const m = L.marker([h.lat, h.lng], { icon }).addTo(this.map);
        m.on("click", () => { this.map.flyTo([h.lat, h.lng], Math.max(this.map.getZoom(), 16), { duration: .4 }); openPin(h.id); });
        this.markers.push(m);
      } else {
        const lat = g.reduce((s, h) => s + h.lat, 0) / g.length, lng = g.reduce((s, h) => s + h.lng, 0) / g.length;
        const icon = L.divIcon({ className: "", html: `<div class="cluster">${g.length}</div>`, iconSize: [36, 36], iconAnchor: [18, 18] });
        const m = L.marker([lat, lng], { icon }).addTo(this.map); const ids = g.map(h => h.id);
        m.on("click", () => openCluster(ids)); this.markers.push(m);
      }
    }
  },
  updateMe(pos) { if (!this.map) return; if (!this.meMarker) { const icon = L.divIcon({ className: "", html: `<div style="width:16px;height:16px;border-radius:50%;background:#4f7166;border:3px solid #fff;box-shadow:0 0 0 4px rgba(79,113,102,.3)"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }); this.meMarker = L.marker([pos.lat, pos.lng], { icon }).addTo(this.map); } else this.meMarker.setLatLng([pos.lat, pos.lng]); },
  updateZoneBanner() { const el = $("#zoneBanner"); if (!el || !this.map) return; const z = zoneForPoint(this.map.getCenter().lat, this.map.getCenter().lng); el.hidden = !z; if (z) el.innerHTML = `⚠️ Known trouble spot: ${esc(z.riskType.split("/")[0].trim())}`; }
};

function renderMap() {
  const scr = $("#screen-map");
  if (!$("#mapWrap", scr)) {
    scr.innerHTML = `
      <div id="mapWrap">
        <div id="leafletHost"></div>
        <div class="zone-banner" id="zoneBanner" hidden></div>
        <div class="map-ui tr">
          <button class="map-btn" data-act="map-locate" aria-label="Center on me">🎯</button>
          <button class="map-btn" data-act="map-filter" aria-label="Filter hazards">⚙️</button>
          <button class="map-btn" data-act="map-offline" id="offlineBtn" aria-label="Offline maps">📶</button>
        </div>
      </div>`;
  }
  MapCtl.init();
  $("#offlineBtn").textContent = MapCtl.isOffline() ? "📴" : "📶";
  setTimeout(() => MapCtl.map && MapCtl.map.invalidateSize(), 60);
}

function openFilterSheet() {
  openSheet(`
    <h2>Show on map</h2>
    <p class="sub">Pick which hazard types to see.</p>
    <div class="filter-grid">
      ${CATEGORY_ORDER.map(k => { const c = CATEGORIES[k]; return `<button class="filter-chip ${state.filters[k] ? "on" : ""}" data-act="filter" data-cat="${k}"><span class="dot" style="background:${c.color}"></span>${c.icon} ${c.label}</button>`; }).join("")}
    </div>
    <div class="switch-row" style="margin-top:12px"><div><div class="lbl">Known trouble spots</div><div class="hint">Outlines of areas with a history of problems.</div></div><div class="switch ${MapCtl.showZones ? "on" : ""}" data-act="toggle-zones"></div></div>`);
}

/* ================= TRACKING / RIDE ================= */
const Track = {
  active: false, startedAt: 0, distanceM: 0, detections: 0, lastPos: null,
  _wake: null, _wakeDraw: null, _wakeLock: null, _alerted: new Set(),
  _zoneId: null, _elev: null, _elevAt: 0, _photoReady: false,
  startWake() {
    try {
      const c = document.createElement("canvas"); c.width = 1; c.height = 1; const ctx = c.getContext("2d"); ctx.fillRect(0, 0, 1, 1);
      this._wakeDraw = setInterval(() => ctx.fillRect(0, 0, 1, 1), 1000);
      const v = document.createElement("video"); v.muted = true; v.setAttribute("muted", ""); v.playsInline = true; v.setAttribute("playsinline", ""); v.loop = true; v.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0"; v.srcObject = c.captureStream(1); $("#device").appendChild(v); v.play().catch(() => {}); this._wake = v;
    } catch (e) {}
    if (Platform.caps.wakeLock) navigator.wakeLock.request("screen").then(l => this._wakeLock = l).catch(() => {});
  },
  stopWake() { if (this._wakeDraw) { clearInterval(this._wakeDraw); this._wakeDraw = null; } if (this._wake) { this._wake.remove(); this._wake = null; } if (this._wakeLock) { this._wakeLock.release().catch(() => {}); this._wakeLock = null; } },
};

async function startTracking() {
  if (Track.active) return;
  if (!state.waiverAccepted || !state.ageConfirmed) { startOnboarding(); return; }
  const bike = state.settings.mode === "bike";

  if (bike) {
    const ok = await Platform.requestMotion();
    if (!ok && Platform.isMobile) toast("Motion access was declined — you can still add reports by hand.", "warn", 3400);
    Platform.startHeading();
  }
  if (state.settings.notifications) await Platform.requestNotify();
  if (bike && state.settings.autoPhoto) Track._photoReady = await Platform.prewarmCamera();

  MapCtl.destroy();
  Track.startWake();
  Track.active = true; Track.startedAt = Date.now(); Track.distanceM = 0; Track.detections = 0;
  Track.lastPos = null; Track._alerted = new Set(); Track._zoneId = null; Track._elev = null; Track._elevDistAt = 0;

  const started = bike ? Engine.start() : { motion: false };
  Platform.startWatch(onTrackPosition);
  currentScreen = "ride";
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-ride"));
  $$(".tab").forEach(t => t.classList.remove("active"));
  renderRide(bike, started.motion);
  toast("▶ Tracking started", "good", 1800);
}

function endTracking() {
  if (!Track.active) return;
  Track.active = false;
  Engine.stop(); Platform.stopWatch(); Platform.stopHeading(); Platform.stopCamera(); Track.stopWake();
  hideCancel(true);
  const mins = Math.max(1, Math.round((Date.now() - Track.startedAt) / 60000));
  const mi = (Track.distanceM / 1609).toFixed(1);
  pushHistory("🏁", `${MODE_LABEL[state.settings.mode]}: ${mi} mi, ${mins} min, ${Track.detections} auto-report${Track.detections === 1 ? "" : "s"}`);
  toast(`🏁 ${mi} mi · ${mins} min · ${Track.detections} found`, "good", 3200);
  showScreen("home");
}

function renderRide(bike, motionOn) {
  $("#screen-ride").innerHTML = `
    <div class="ride">
      <span class="rlabel">${MODE_LABEL[state.settings.mode]} · speed</span>
      <div><span class="speed" id="rSpeed">0</span><span class="speed u"> mph</span></div>
      <div class="state off" id="rState">${bike ? "Warming up — needs 6–22 mph" : "Tracking your ride"}</div>
      <div class="zwarn" id="rZone"></div>
      <div class="rgrid">
        <div><b id="rDist">0.0</b><span>miles</span></div>
        <div><b id="rTime">0:00</b><span>time</span></div>
        <div><b id="rHits">0</b><span>${bike ? "found" : "nearby"}</span></div>
      </div>
      ${bike && !motionOn ? `<p class="zwarn" style="margin-top:16px">Motion sensing isn't available here — you'll still get nearby-hazard alerts. Add bumps by hand with ＋.</p>` : ""}
      <button class="end" data-act="end-track">■ End tracking</button>
    </div>`;
  if (bike) {
    Engine.onTelemetry = (t) => {
      const s = $("#rSpeed"); if (!s) return;
      s.textContent = Math.round(t.speedMph);
      $("#rDist").textContent = (Track.distanceM / 1609).toFixed(1);
      const el = Math.floor((Date.now() - Track.startedAt) / 1000); $("#rTime").textContent = Math.floor(el / 60) + ":" + String(el % 60).padStart(2, "0");
      $("#rHits").textContent = Track.detections;
      const st = $("#rState"); st.className = "state " + (t.armed ? "on" : "off"); st.textContent = t.armed ? "Sensing bumps" : "Warming up — needs 6–22 mph";
      $("#rZone").textContent = t.zone ? `Heads up: ${t.zone.riskType.split("/")[0].trim()} area` : "";
    };
  } else {
    // Walk/Drive: telemetry ticker without impact sensing.
    Track._tick = setInterval(() => {
      if (!Track.active) return clearInterval(Track._tick);
      const el = Math.floor((Date.now() - Track.startedAt) / 1000);
      const t = $("#rTime"); if (t) t.textContent = Math.floor(el / 60) + ":" + String(el % 60).padStart(2, "0");
      const d = $("#rDist"); if (d) d.textContent = (Track.distanceM / 1609).toFixed(1);
    }, 1000);
  }
}

function onTrackPosition(pos) {
  if (state.settings.mode === "bike") Engine.updatePosition(pos);
  if (pos.speed != null && isFinite(pos.speed)) { const s = $("#rSpeed"); if (s && state.settings.mode !== "bike") s.textContent = Math.round(pos.speed * 2.23694); }
  if (pos.acc == null || pos.acc < 60) { if (Track.lastPos) { const d = haversineM(Track.lastPos, pos); if (d > 1 && d < 200) Track.distanceM += d; } Track.lastPos = { lat: pos.lat, lng: pos.lng }; }

  // Elevation fusion -> slope (throttled; backend proxy, keyless USGS fallback).
  // Slope = rise / run over the real distance ridden since the last sample.
  if (Date.now() - Track._elevAt > 15000) {
    Track._elevAt = Date.now();
    fetchElevation(pos.lat, pos.lng).then(ev => {
      const run = Track.distanceM - (Track._elevDistAt || 0);
      if (ev != null && Track._elev != null && run > 10) {
        const slope = 100 * (ev - Track._elev) / run;
        Engine.setSlope(Math.max(-25, Math.min(25, slope)));
      }
      if (ev != null) { Track._elev = ev; Track._elevDistAt = Track.distanceM; }
    });
  }

  // Zone entry announcement.
  const z = zoneForPoint(pos.lat, pos.lng); const zid = z ? z.id : null;
  if (zid !== Track._zoneId) { Track._zoneId = zid; if (z) { toast(`⚠️ Entering a known trouble spot`, "warn", 3200); if (state.settings.tts) Platform.speak(`Caution. ${z.riskType.split("/")[0].trim()} area ahead.`); Platform.buzz([60, 40, 60]); } }
  checkProximity(pos);
}

function checkProximity(pos) {
  const radius = PROX[state.settings.prox].m;
  for (const h of allHazards()) {
    if (h.status !== "verified" || Track._alerted.has(h.id)) continue;
    if (haversineM(pos, h) <= radius) {
      Track._alerted.add(h.id);
      const c = CATEGORIES[h.cat];
      const sent = state.settings.notifications && Platform.notify("Hazard ahead", `${c.label} about ${Math.round(haversineM(pos, h) * 3.281)} ft ahead`);
      if (state.settings.tts) Platform.speak(`Heads up. ${c.label} ahead.`);
      if (!sent) Feedback.alert();
    }
  }
}

async function fetchElevation(lat, lng) {
  try { const r = await fetch(`${IMAGERY_ENDPOINT}?kind=elevation&lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}`).then(r => r.json()); return r && r.elevation != null ? r.elevation : null; }
  catch (e) { return null; }
}

/* ================= Engine wiring ================= */
function wireEngine() {
  Engine.onDetect = (d) => {
    Feedback.alert(); Feedback.tone(980, 110); setTimeout(() => Feedback.tone(980, 110), 170);
    const pos = Track.lastPos || NOVATO_CENTER;
    const z = zoneForPoint(pos.lat, pos.lng);
    const photo = (state.settings.autoPhoto && Track._photoReady) ? Platform.snapPhoto() : null;
    showCancel({ cat: d.cat, subtype: d.subtype, sev: d.sev, lat: pos.lat, lng: pos.lng, zoneId: z ? z.id : null, elevation: Track._elev, photo, hasPhoto: !!photo, note: "", features: d.features, source: "auto" });
  };
  Engine.onSkip = () => {}; // benign bumps are ignored silently
}

/* ---- 10-second review buffer ---- */
const Cancel = { timer: null, payload: null, n: 10 };
function showCancel(p) {
  hideCancel(true); Cancel.payload = p; Cancel.n = 10;
  $("#cancelWhat").textContent = `${CATEGORIES[p.cat].icon} ${CATEGORIES[p.cat].label} — saving in`;
  $("#cancelCount").textContent = "10";
  $("#cancelOverlay").classList.add("show");
  Cancel.timer = setInterval(() => { Cancel.n--; const el = $("#cancelCount"); if (el) el.textContent = Cancel.n; if (Cancel.n <= 0) commitCancel(); }, 1000);
}
async function commitCancel() {
  const p = Cancel.payload; hideCancel(false); if (!p) return;
  Track.detections++;
  if (typeof Learn !== "undefined" && p.features) Learn.train(p.features, p.cat, 0.3); // weak signal: accepted as-is
  await Sync.enqueue(p, "auto");
  pushHistory("📍", `Auto-saved a ${CATEGORIES[p.cat].label.toLowerCase()}`);
  updateBadge();
}
function hideCancel(discard) { if (Cancel.timer) { clearInterval(Cancel.timer); Cancel.timer = null; } $("#cancelOverlay").classList.remove("show"); if (discard) Cancel.payload = null; }

/* ================= CAPTURE (FAB / manual) ================= */
const Cap = { photo: null, cat: "pothole", subtype: "", sev: 3, pos: null, dictating: false };
async function openCapture(preset) {
  if (!state.ageConfirmed) { startOnboarding(); return; }
  Cap.photo = null; Cap.cat = preset && preset.cat || "pothole"; Cap.subtype = ""; Cap.sev = 3;
  Cap.pos = preset && preset.lat ? { lat: preset.lat, lng: preset.lng } : null;
  openSheet(`
    <h2>Add a report</h2>
    <p class="sub">A quick photo and your spot help the city and other riders. Saved privately until you send it.</p>
    <div class="row" style="margin-bottom:12px">
      <video id="capCam" style="width:112px;height:82px;border-radius:6px;border:2px solid var(--line);background:#111;object-fit:cover" playsinline muted></video>
      <div style="flex:1;display:flex;flex-direction:column;gap:8px">
        <button class="btn ghost sm" data-act="cap-snap">📷 Take photo</button>
        <label class="btn ghost sm" style="text-align:center">🖼️ Choose<input type="file" accept="image/*" capture="environment" id="capFile" class="hide"></label>
      </div>
    </div>
    <div id="capThumb" class="hide" style="margin-bottom:12px"><img id="capThumbImg" style="width:100%;border-radius:6px;border:2px solid var(--line);max-height:150px;object-fit:cover"></div>
    <span class="eyebrow">Type</span>
    <div class="picker-grid" id="capCats"></div>
    <span class="eyebrow" style="margin-top:12px">How big?</span>
    <div class="sev-picker" id="capSev"></div>
    <label class="field" style="margin-top:12px"><span class="eyebrow">Note (optional — type or speak)</span>
      <div class="row"><textarea id="capNote" rows="2" placeholder="e.g. deep pothole, right side"></textarea><button class="map-btn" data-act="cap-mic" id="capMic" aria-label="Speak">🎙️</button></div>
    </label>
    <p class="muted" id="capGPS" style="margin-top:8px">📍 Finding your location…</p>
    <button class="btn copper" data-act="cap-save" style="margin-top:12px">Save report</button>`,
    () => { Platform.stopCamera(); Platform.stopDictation(); });
  renderCapPickers();
  const fi = $("#capFile"); if (fi) fi.addEventListener("change", () => readCapFile(fi));
  Platform.attachCamera($("#capCam"));
  if (!Cap.pos) {
    const pos = await Platform.getPosition();
    if (pos) Cap.pos = pos;
    else { // Location failed -> open the map to drop a pin by hand (spec).
      closeSheet(); toast("Couldn't get your location — tap the map to place the pin.", "warn", 3600); showScreen("map"); return;
    }
  }
  const g = $("#capGPS"); if (g) { const z = zoneForPoint(Cap.pos.lat, Cap.pos.lng); g.innerHTML = `📍 ${Cap.pos.lat.toFixed(5)}, ${Cap.pos.lng.toFixed(5)}${z ? ` · near a known trouble spot` : ""}`; }
}
function renderCapPickers() {
  // Promoted custom subtypes float to the front as quick-picks (Other promotion).
  $("#capCats").innerHTML = CATEGORY_ORDER.map(k => { const c = CATEGORIES[k]; return `<button class="${Cap.cat === k ? "on" : ""}" data-act="cap-cat" data-cat="${k}"><span class="ic">${c.icon}</span>${c.label}</button>`; }).join("");
  $("#capSev").innerHTML = [1, 2, 3, 4, 5].map(n => `<button class="${Cap.sev === n ? "on" : ""}" data-act="cap-sev" data-sev="${n}" style="${Cap.sev === n ? `background:${sevColor(n)}` : ""}">${n}</button>`).join("");
}
function snapCap() { const v = $("#capCam"); if (!v || !v.videoWidth) { toast("Camera not ready — use Choose", "warn"); return; } const c = document.createElement("canvas"); const s = Math.min(1, 900 / v.videoWidth); c.width = v.videoWidth * s; c.height = v.videoHeight * s; c.getContext("2d").drawImage(v, 0, 0, c.width, c.height); Cap.photo = c.toDataURL("image/jpeg", 0.7); showCapThumb(); }
function readCapFile(input) { const f = input.files && input.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); const s = Math.min(1, 900 / img.width); c.width = img.width * s; c.height = img.height * s; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); Cap.photo = c.toDataURL("image/jpeg", 0.7); showCapThumb(); }; img.src = rd.result; }; rd.readAsDataURL(f); }
function showCapThumb() { $("#capThumb").classList.remove("hide"); $("#capThumbImg").src = Cap.photo; toast("📷 Photo added", "good", 1400); }
function toggleDictation() { const mic = $("#capMic"); if (Cap.dictating) { Platform.stopDictation(); Cap.dictating = false; mic.style.background = ""; return; } const ok = Platform.startDictation((t) => { const n = $("#capNote"); if (n) n.value = t; }, () => { Cap.dictating = false; const m = $("#capMic"); if (m) m.style.background = ""; }); if (!ok) { toast("Speech typing isn't available here", "warn"); return; } Cap.dictating = true; mic.style.background = "var(--sage-soft)"; toast("🎙️ Listening — say your note", "", 1800); }
async function saveCapture() {
  const pos = Cap.pos || NOVATO_CENTER; const z = zoneForPoint(pos.lat, pos.lng);
  let elevation = null; try { elevation = await fetchElevation(pos.lat, pos.lng); } catch (e) {}
  const payload = { cat: Cap.cat, subtype: Cap.subtype || null, sev: Cap.sev, lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), note: ($("#capNote") && $("#capNote").value || "").slice(0, 400), photo: Cap.photo, hasPhoto: !!Cap.photo, zoneId: z ? z.id : null, elevation, source: "manual", capturedAt: Date.now() };
  closeSheet();
  await Sync.enqueue(payload, "manual");
  state.profile.points += 1; pushHistory("📷", `Added a ${CATEGORIES[payload.cat].label.toLowerCase()} report`); save();
  updateBadge();
  toast(`Saved — ${state.settings.autoUpload ? "sends automatically soon" : "review it in Reports"}`, "good", 3200);
}

/* ================= REVIEW (Reports) ================= */
async function updateBadge() { const n = await VaultDB.count(); const b = $("#inboxBadge"); b.hidden = !n; b.textContent = n; }
async function renderInbox() {
  const rows = await Sync.pending();
  $("#screen-inbox").innerHTML = `
    <span class="eyebrow">Your reports</span>
    <h1>Reports</h1>
    <p class="sub">${rows.length ? `${rows.length} saved on your phone, ready to send.` : "All caught up — nothing waiting."} ${Sync.online() ? "" : "You're offline; they'll send when you reconnect."}</p>
    ${rows.length ? `<div class="btn-row"><button class="btn sm" data-act="inbox-all">Send all to the map</button></div>` : ""}
    <div id="inboxList" style="margin-top:14px"></div>`;
  const list = $("#inboxList");
  for (const r of rows) {
    const p = await Sync.reveal(r);
    const c = p ? (CATEGORIES[p.cat] || CATEGORIES.other) : CATEGORIES.other;
    const el = document.createElement("div"); el.className = "report";
    el.innerHTML = `
      <div class="ico">${p && p.photo ? `<img src="${p.photo}">` : (c.icon)}</div>
      <div class="meta"><b>${p ? c.label : "Unreadable"}</b><span>${r.source === "auto" ? "Sensed while riding" : "Added by you"} · ${fmtAgo(r.createdAt)}${p && p.subtype ? " · " + esc(subtypeLabel(p.subtype)) : ""}${p && p.note ? `<br>“${esc(p.note.slice(0, 60))}”` : ""}</span></div>
      <div class="acts"><button data-act="inbox-edit" data-id="${r.id}" aria-label="Edit type">✏️</button><button data-act="inbox-send" data-id="${r.id}" aria-label="Send">☁️</button><button data-act="inbox-del" data-id="${r.id}" aria-label="Delete">🗑️</button></div>`;
    list.appendChild(el);
  }
}
async function sendInboxItem(id) {
  const row = (await Sync.pending()).find(r => r.id === id); if (!row) return;
  const res = await Sync.uploadOne(row);
  if (res.ok) { adoptUploaded(res.payload); toast("☁️ On the community map", "good"); }
  else if (res.reason === "offline") toast("Offline — kept safe on your phone", "warn");
  else if (res.reason === "corrupt") toast("Removed an unreadable report", "warn");
  else toast("Couldn't send — try again", "bad");
  renderInbox(); updateBadge();
}
function adoptUploaded(p) { state.hazards.push({ id: uid(), cat: p.cat, subtype: p.subtype || "", lat: p.lat, lng: p.lng, sev: p.sev, status: "unverified", confidence: 50, votes: 0, note: p.note || "", mine: true, createdAt: Date.now() }); state.profile.mapped += 1; state.profile.points += 2; pushHistory("☁️", `Shared a ${CATEGORIES[p.cat].label.toLowerCase()} to the map`); save(); MapCtl.refreshPins(); }
async function sendAllInbox() { const results = await Sync.flush(); const ok = results.filter(r => r.ok); ok.forEach(r => adoptUploaded(r.payload)); if (ok.length) toast(`☁️ Sent ${ok.length}`, "good"); const fail = results.length - ok.length; if (fail) toast(`${fail} kept on your phone`, "warn"); renderInbox(); updateBadge(); }

/* ---- edit type on a pending report (teaches the model) ---- */
async function editInboxItem(id) {
  const row = (await Sync.pending()).find(r => r.id === id); if (!row) return;
  const p = await Sync.reveal(row); if (!p) return;
  openTypeEditor(p.cat, p.subtype, async (cat, subtype) => {
    if (typeof Learn !== "undefined" && p.features && cat !== p.cat) Learn.train(p.features, cat, 1); // strong correction
    p.cat = cat; p.subtype = subtype;
    row.payload = await Vault.encryptRecord(p); await VaultDB.put(row);
    if (subtype && SUBTYPE_BY_ID[subtype] === undefined) { state.promoted[subtype] = (state.promoted[subtype] || 0) + 1; save(); }
    closeSheet(); renderInbox(); toast("Updated", "good");
  });
}
function openTypeEditor(cat, subtype, onSave) {
  window._typeEdit = { cat: cat || "pothole", subtype: subtype || "", onSave };
  const draw = () => {
    const e = window._typeEdit;
    const subs = SUBTYPES.filter(s => s.cat === e.cat);
    $("#typeCats").innerHTML = CATEGORY_ORDER.map(k => { const c = CATEGORIES[k]; return `<button class="${e.cat === k ? "on" : ""}" data-act="te-cat" data-cat="${k}"><span class="ic">${c.icon}</span>${c.label}</button>`; }).join("");
    $("#typeSubs").innerHTML = subs.map(s => `<button class="filter-chip ${e.subtype === s.id ? "on" : ""}" data-act="te-sub" data-sub="${s.id}">${esc(s.label)}</button>`).join("");
  };
  openSheet(`<h2>What was it?</h2><p class="sub">Pick the closest match — motio learns from your choice.</p><span class="eyebrow">Type</span><div class="picker-grid" id="typeCats"></div><span class="eyebrow" style="margin-top:12px">Detail (optional)</span><div class="filter-grid" id="typeSubs" style="grid-template-columns:1fr 1fr"></div><button class="btn copper" data-act="te-save" style="margin-top:14px">Save</button>`);
  window._typeEditDraw = draw; draw();
}

/* ================= PIN + civic ================= */
function openPin(id) {
  const h = allHazards().find(x => x.id === id); if (!h) return;
  const c = CATEGORIES[h.cat]; const z = zoneForPoint(h.lat, h.lng);
  const conf = h.confidence != null ? h.confidence : (h.status === "verified" ? 70 : 45);
  const clearable = h.sev <= 2 && (h.cat === "branch" || h.cat === "trash") && h.status !== "cleared";
  openSheet(`
    <div class="row"><div class="ico" style="width:48px;height:48px;border:2px solid var(--line);border-radius:6px;display:grid;place-items:center;font-size:22px;background:${c.color};color:#fff">${c.icon}</div>
      <div style="flex:1"><h2 style="margin:0">${c.label}</h2><p class="muted">${h.status === "verified" ? "✅ confirmed" : h.status === "cleared" ? "🧹 cleared" : "🕓 needs confirming"} · ${fmtAgo(h.createdAt)}</p></div>
      <span style="font-weight:800;color:${sevColor(h.sev)}">${sevWord(h.sev)}</span></div>
    ${h.subtype ? `<p class="muted mt" style="margin-top:8px">Detail: ${esc(subtypeLabel(h.subtype) || h.subtype)}</p>` : ""}
    ${h.note ? `<p style="margin-top:8px;font-size:14px;line-height:1.5">“${esc(h.note)}”</p>` : ""}
    <div class="conf" style="margin:10px 0"><small>Confidence</small><div class="bar"><div class="fill" style="width:${conf}%"></div></div><small>${conf}%</small></div>
    <div class="mini"><b>Spot</b><span>${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}</span></div>
    ${z ? `<div class="mini"><b>Area</b><span>${esc(z.riskType.split("/")[0].trim())}</span></div>` : ""}
    <div class="btn-row">
      ${h.status !== "cleared" ? `<button class="btn sm" data-act="pin-yes" data-id="${h.id}">👍 It's there</button><button class="btn ghost sm" data-act="pin-no" data-id="${h.id}">👎 Gone</button>` : ""}
    </div>
    <button class="btn copper" data-act="pin-report" data-id="${h.id}" style="margin-top:10px">✉️ Report to the city</button>
    <div class="btn-row">
      <button class="btn ghost sm" data-act="pin-edit" data-id="${h.id}">✏️ Fix type</button>
      ${clearable ? `<button class="btn ghost sm" data-act="pin-clear" data-id="${h.id}">🧹 I cleared it</button>` : ""}
    </div>`);
}
function openCluster(ids) {
  const items = ids.map(id => allHazards().find(h => h.id === id)).filter(Boolean);
  openSheet(`<h2>${items.length} reports here</h2><p class="sub">Likely the same spot.</p>${items.map(h => { const c = CATEGORIES[h.cat]; return `<div class="report" data-act="pin-open" data-id="${h.id}" style="cursor:pointer;margin-bottom:8px"><div class="ico">${c.icon}</div><div class="meta"><b>${c.label}</b><span>${sevWord(h.sev)} · ${esc((h.note || "").slice(0, 40))}</span></div><span class="muted">›</span></div>`; }).join("")}`);
}
async function votePin(id, up) {
  const h = state.hazards.find(x => x.id === id);
  await Sync.confirm(id, up ? 1 : -1);
  if (h) { h.votes = (h.votes || 0) + (up ? 1 : -1); h.confidence = Math.max(0, Math.min(100, 50 + 10 * h.votes)); if (h.votes >= 2 && h.status === "unverified") h.status = "verified"; if (h.votes <= -2) h.status = "cleared"; }
  state.profile.points += 1; save(); MapCtl.refreshPins(); closeSheet();
  toast(up ? "👍 Thanks — confidence raised" : "👎 Noted", "good");
}
function openReport(id) {
  const h = allHazards().find(x => x.id === id); if (!h) return;
  const c = CATEGORIES[h.cat];
  const draft = buildCivicEmail(h, c.label, { reporterName: state.profile.name, isPublic: state.profile.visibility === "public" });
  window._draft = draft;
  openSheet(`
    <h2>Report to the city</h2>
    <p class="sub">Goes to <b>${esc(draft.department)}</b>. For emergencies call 911, or after-hours Public Works at 415-897-4361.</p>
    ${draft.to ? `<div class="mini"><b>To</b><span>${esc(draft.to)}</span></div>` : `<div class="mini"><b>How</b><span>Online form</span></div>`}
    <div class="mini"><b>About</b><span>${esc(draft.subject)}</span></div>
    <div class="email-preview">${esc(draft.body)}</div>
    ${state.profile.visibility === "private" ? `<p class="muted" style="margin-top:8px">You're private, so your name and time aren't included.</p>` : ""}
    ${draft.mailto ? `<button class="btn copper" data-act="report-send" style="margin-top:12px">📤 Open in mail</button>` : ""}
    <a class="btn ghost" href="${draft.formUrl}" target="_blank" rel="noopener" data-act="report-form" style="margin-top:10px">🌐 Open city form</a>`);
}
function sendReport() { const d = window._draft; if (!d || !d.mailto) return; try { window.location.href = d.mailto; } catch (e) {} state.profile.points += 2; pushHistory("✉️", "Reported a hazard to the city"); save(); closeSheet(); toast("✉️ Opening your mail app", "good"); }
function openClearing(id) {
  openSheet(`<h2>Before you clear it</h2><div class="card" style="background:var(--copper-soft);border-color:var(--copper)"><p style="font-size:11.5px;line-height:1.6;user-select:text">${esc(NOVATO_MUNICIPAL_DIRECTORY.disclaimer)}</p></div><p class="muted">Only move something small, light, and clearly safe — never near traffic or on unstable ground.</p><button class="btn" data-act="clear-ok" data-id="${id}" style="margin-top:12px">I understand — continue</button><button class="btn ghost" data-act="close-sheet" style="margin-top:10px">Cancel</button>`);
}
function commitClearing(id) { const h = state.hazards.find(x => x.id === id); if (h) h.status = "cleared"; state.profile.cleared += 1; state.profile.points += 1; pushHistory("🧹", "Cleared a hazard — thank you"); save(); MapCtl.refreshPins(); closeSheet(); toast("🧹 Marked cleared — +1 point", "good"); }

/* ================= Cloud status + weather ================= */
function updateCloud() { const b = $("#cloudBtn"); if (b) b.classList.toggle("offline", !Sync.online()); }
function openCloudStatus() { openSheet(`<h2>${Sync.online() ? "Connected" : "Offline"}</h2><p class="sub">${esc(Sync.statusText())}</p><button class="btn ghost" data-act="close-sheet">Got it</button>`); }
async function refreshWeather() {
  const pos = await Platform.getPosition().catch(() => null);
  const w = await Weather.get(pos ? pos.lat : NOVATO_CENTER.lat, pos ? pos.lng : NOVATO_CENTER.lng);
  const banner = $("#wxBanner");
  if (w && w.banner && !window._wxDismissed) { $("#wxText").textContent = w.banner; banner.className = "wx-banner " + (w.level === "warn" ? "warn" : ""); banner.hidden = false; }
  else banner.hidden = true;
}

/* ================= SETTINGS ================= */
function renderSettings() {
  const s = state.settings, p = state.profile;
  const sw = (k, on) => `<div class="switch ${on ? "on" : ""}" data-act="set-toggle" data-key="${k}"></div>`;
  $("#screen-settings").innerHTML = `
    <span class="eyebrow">You</span>
    <h1>Settings</h1>
    <div class="card" style="margin-top:12px">
      <div class="row"><div style="width:52px;height:52px;border:2px solid var(--line);border-radius:50%;display:grid;place-items:center;font-size:26px;background:var(--sage-soft)">${esc(p.emoji)}</div>
        <div style="flex:1"><b style="font-size:16px">${esc(p.name || "Set your name")}</b><p class="muted">${p.visibility === "public" ? "Public profile" : "Private profile"} · ${p.points} points</p></div>
        <button class="btn ghost sm" data-act="edit-profile">Edit</button></div>
    </div>
    <div class="card"><h3>Mode</h3>
      <div class="seg"><button class="${s.mode === "bike" ? "on" : ""}" data-act="set-mode" data-mode="bike">🚲 Bike</button><button class="${s.mode === "walk" ? "on" : ""}" data-act="set-mode" data-mode="walk">🚶 Walk</button><button class="${s.mode === "drive" ? "on" : ""}" data-act="set-mode" data-mode="drive">🚗 Drive</button></div>
      <p class="muted" style="margin-top:8px">Only Bike senses bumps automatically. Walk and Drive are for adding reports by hand.</p>
    </div>
    <div class="card prox"><h3>Alert distance</h3>
      <div class="prox-dist" id="proxDist">${PROX[s.prox].label} · ${PROX[s.prox].ft} ft</div>
      <input class="prox-track" type="range" min="0" max="2" step="1" value="${s.prox}" id="proxSlider" aria-label="Alert distance">
      <div class="prox-labels"><span>Near</span><span>Close</span><span>Far</span></div>
    </div>
    <div class="card"><h3>Alerts &amp; power</h3>
      <div class="switch-row"><div><div class="lbl">Send reports automatically</div><div class="hint">Shares your saved reports to the map every few minutes.</div></div>${sw("autoUpload", s.autoUpload)}</div>
      <div class="switch-row"><div><div class="lbl">Spoken alerts</div><div class="hint">Hear a warning as you near a hazard.</div></div>${sw("tts", s.tts)}</div>
      <div class="switch-row"><div><div class="lbl">Pop-up alerts</div><div class="hint">Phone notifications while tracking.</div></div>${sw("notifications", s.notifications)}</div>
      <div class="switch-row"><div><div class="lbl">Auto photo</div><div class="hint">Snap a quick rear-camera photo when a bump is found (Bike mode).</div></div>${sw("autoPhoto", s.autoPhoto)}</div>
      <div class="switch-row"><div><div class="lbl">Dark theme</div></div>${sw("dark", s.dark)}</div>
    </div>
    <div class="card"><h3>Novato Report Directory</h3>
      <p class="muted" style="margin-bottom:8px">Emergency: <a href="tel:911"><b>911</b></a> · After-hours Public Works: <a href="tel:4158974361"><b>415-897-4361</b></a></p>
      ${Object.entries(NOVATO_MUNICIPAL_DIRECTORY.routing).map(([k, r]) => `<div class="dir-item"><b>${esc(DEPARTMENT_NAMES[k] || k)}</b>${r.targetEmail ? `<a href="mailto:${r.targetEmail}">${r.targetEmail}</a>` : ""}<a href="${r.contactFormEndpoint}" target="_blank" rel="noopener">${r.contactFormEndpoint}</a></div>`).join("")}
    </div>
    <div class="card"><h3>Data</h3>
      <div class="btn-row"><button class="btn ghost sm" data-act="export-csv">Export CSV</button><button class="btn ghost sm" data-act="refresh-community">Refresh map</button></div>
      <button class="btn danger sm" data-act="reset" style="margin-top:12px">Reset app</button>
    </div>
    <p class="muted center" style="padding-bottom:10px">motio · Novato, CA · your reports are protected on your phone</p>`;
  const ps = $("#proxSlider"); if (ps) ps.addEventListener("input", () => { state.settings.prox = +ps.value; $("#proxDist").textContent = `${PROX[+ps.value].label} · ${PROX[+ps.value].ft} ft`; save(); });
}

/* ---- profile editor (name + emoji + visibility) ---- */
const EMOJIS = ["🚲","🚴","🛹","🛴","🏃","🚶","🌲","🌊","⛰️","🦊","🦉","🐢","☀️","🌙","⭐","🔧","🧭","📍","🚦","🛡️","🌵","🍃"];
function openProfileEditor() {
  window._pf = { name: state.profile.name, emoji: state.profile.emoji, visibility: state.profile.visibility };
  const draw = () => { const e = window._pf; $("#pfEmoji").innerHTML = EMOJIS.map(x => `<button class="${e.emoji === x ? "on" : ""}" data-act="pf-emoji" data-e="${x}">${x}</button>`).join(""); $("#pfVis").innerHTML = ["public","private"].map(v => `<button class="${e.visibility === v ? "on" : ""}" data-act="pf-vis" data-v="${v}">${v === "public" ? "Public" : "Private"}<small>${v === "public" ? "Name on city reports" : "Stay anonymous"}</small></button>`).join(""); };
  openSheet(`<h2>Your profile</h2><label class="field"><span class="eyebrow">Display name</span><input type="text" id="pfName" maxlength="24" value="${esc(state.profile.name)}" placeholder="e.g. Grant Ave rider"></label><span class="eyebrow" style="margin-top:12px">Pick an emoji</span><div class="emoji-grid" id="pfEmoji"></div><span class="eyebrow" style="margin-top:12px">Visibility</span><div class="vis-toggle" id="pfVis"></div><button class="btn copper" data-act="pf-save" style="margin-top:14px">Save profile</button>`);
  window._pfDraw = draw; draw();
  const ni = $("#pfName"); if (ni) ni.addEventListener("input", () => window._pf.name = ni.value);
}

/* ---- export ---- */
function exportCSV() {
  const rows = [["id","type","subtype","severity","status","lat","lng","note","created"]];
  for (const h of allHazards()) rows.push([h.id, h.cat, h.subtype || "", h.sev, h.status, h.lat, h.lng, `"${(h.note || "").replace(/"/g, '""')}"`, new Date(h.createdAt).toISOString()]);
  const blob = new Blob([rows.map(r => r.join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "motio-hazards.csv"; a.click(); toast("⬇️ Exported", "good");
}

/* ================= ONBOARDING (hard gate) ================= */
const SLIDES = [
  { art: "👋", eyebrow: "Welcome", h: "Make Novato\nsafer to ride", p: "motio turns your ride into a live safety map. Spot a pothole or branch, and the next rider gets a heads-up.", action: "Continue" },
  { art: "📡", eyebrow: "How it works", h: "Your phone\ndoes the watching", p: "In Bike mode, motion sensors quietly notice bumps as you ride. Everything is saved privately on your phone first — you choose what to share.", action: "Continue" },
  { art: "🎂", eyebrow: "Required", h: "Are you 13\nor older?", p: "motio involves being out on real roads and trails, so we need you to confirm your age.", gate: "age", action: "Confirm I'm 13+" },
  { art: "⚖️", eyebrow: "Required", h: "Community\nwaiver", waiver: true, gate: "waiver", action: "Confirm & accept" },
  { art: "🚲", eyebrow: "Last step", h: "Set up\nyour profile", profile: true, action: "Confirm & finish" },
];
let onbIdx = 0;
function startOnboarding() { onbIdx = 0; $("#onb").classList.add("show"); renderOnb(); }
function renderOnb() {
  const sl = SLIDES[onbIdx];
  let inner = `<span class="eyebrow">${sl.eyebrow}</span><div class="art">${sl.art}</div><h2 style="white-space:pre-line">${sl.h || ""}</h2>`;
  if (sl.waiver) inner += `<div class="waiver-box">${esc(NOVATO_MUNICIPAL_DIRECTORY.disclaimer)}<br><br>Sensor use: while you ride, motio may read motion, location, camera and microphone signals to detect and place hazards. It only does so while tracking, and your reports stay encrypted on your phone until you share them. Not for emergencies — call 911, or after-hours Public Works at 415-897-4361.</div>`;
  else if (sl.profile) inner += `<p>Pick how you'll show up on the map.</p><label class="field" style="width:100%;max-width:320px"><span class="eyebrow">Name</span><input type="text" id="onbName" maxlength="24" value="${esc(state.profile.name)}" placeholder="e.g. Grant Ave rider"></label><div class="emoji-grid" id="onbEmoji" style="width:100%;max-width:320px;margin-top:10px"></div><div class="vis-toggle" id="onbVis" style="width:100%;max-width:320px;margin-top:10px"></div>`;
  else inner += `<p>${sl.p || ""}</p>`;
  if (sl.gate === "age" && state.ageConfirmed) inner += `<p class="gate-note">✓ Confirmed</p>`;
  if (sl.gate === "waiver" && state.waiverAccepted) inner += `<p class="gate-note">✓ Accepted</p>`;
  $("#onbSlides").innerHTML = `<div class="slide active">${inner}</div>`;
  $("#onbDots").innerHTML = SLIDES.map((_, i) => `<i class="${i === onbIdx ? "on" : ""}"></i>`).join("");
  $("#onbAction").textContent = sl.action;
  if (sl.profile) {
    window._pf = { name: state.profile.name, emoji: state.profile.emoji, visibility: state.profile.visibility };
    const drawE = () => { $("#onbEmoji").innerHTML = EMOJIS.map(x => `<button class="${window._pf.emoji === x ? "on" : ""}" data-act="onb-emoji" data-e="${x}">${x}</button>`).join(""); $("#onbVis").innerHTML = ["public","private"].map(v => `<button class="${window._pf.visibility === v ? "on" : ""}" data-act="onb-vis" data-v="${v}">${v === "public" ? "Public" : "Private"}<small>${v === "public" ? "Name on reports" : "Anonymous"}</small></button>`).join(""); };
    window._onbDrawE = drawE; drawE();
    const ni = $("#onbName"); if (ni) ni.addEventListener("input", () => window._pf.name = ni.value);
  }
}
function onbAction() {
  const sl = SLIDES[onbIdx];
  // Hard gates: block advance until satisfied (spec).
  if (sl.gate === "age") { state.ageConfirmed = true; save(); }
  if (sl.gate === "waiver") { state.waiverAccepted = true; save(); }
  if (sl.profile) {
    const name = (window._pf.name || "").trim();
    if (!name) { toast("Please add a display name", "warn"); return; }
    state.profile.name = name.slice(0, 24); state.profile.emoji = window._pf.emoji; state.profile.visibility = window._pf.visibility; save();
    finishOnboarding(); return;
  }
  if (onbIdx < SLIDES.length - 1) { onbIdx++; renderOnb(); }
}
function finishOnboarding() { state.onboarded = true; save(); $("#onb").classList.remove("show"); renderHome(); }

/* ================= Sheet ================= */
let _sheetCleanup = null;
function openSheet(html, onClose) { _sheetCleanup = onClose || null; $("#sheet").innerHTML = `<div class="grab" data-act="close-sheet"></div>` + html; $("#sheet").classList.add("show"); $("#scrim").classList.add("show"); }
function closeSheet() { $("#sheet").classList.remove("show"); $("#scrim").classList.remove("show"); if (_sheetCleanup) { try { _sheetCleanup(); } catch (e) {} _sheetCleanup = null; } }

/* ================= Event delegation ================= */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]"); if (!t) return;
  const act = t.dataset.act, id = t.dataset.id;
  switch (act) {
    case "tab": showScreen(t.dataset.tab); break;
    case "close-sheet": closeSheet(); break;
    case "capture": if (Track.active) { toast("End tracking first", "warn"); } else openCapture(); break;
    case "start-track": startTracking(); break;
    case "end-track": endTracking(); break;
    case "cycle-mode": { const order = ["bike","walk","drive"]; state.settings.mode = order[(order.indexOf(state.settings.mode) + 1) % 3]; save(); $("#modeChip").textContent = MODE_LABEL[state.settings.mode]; if (currentScreen === "home") renderHome(); break; }
    case "cloud-status": openCloudStatus(); break;

    case "map-locate": { const pos = await Platform.getPosition(); if (pos && MapCtl.map) { MapCtl.map.flyTo([pos.lat, pos.lng], 16); MapCtl.updateMe(pos); checkProximity(pos); } else toast("Location unavailable", "warn"); break; }
    case "map-filter": openFilterSheet(); break;
    case "map-offline": state.settings.offline = !state.settings.offline; save(); $("#offlineBtn").textContent = MapCtl.isOffline() ? "📴" : "📶"; if (MapCtl.tiles) MapCtl.tiles.redraw(); toast(state.settings.offline ? "📴 Using saved maps" : "📶 Live maps", "", 2000); break;
    case "filter": state.filters[t.dataset.cat] = !state.filters[t.dataset.cat]; save(); t.classList.toggle("on", state.filters[t.dataset.cat]); MapCtl.refreshPins(); break;
    case "toggle-zones": MapCtl.showZones = !MapCtl.showZones; MapCtl.drawZones(); t.classList.toggle("on", MapCtl.showZones); break;

    case "cap-snap": snapCap(); break;
    case "cap-cat": Cap.cat = t.dataset.cat; Cap.subtype = ""; renderCapPickers(); break;
    case "cap-sev": Cap.sev = +t.dataset.sev; renderCapPickers(); break;
    case "cap-mic": toggleDictation(); break;
    case "cap-save": saveCapture(); break;

    case "inbox-send": sendInboxItem(id); break;
    case "inbox-del": await Sync.discard(id); toast("Deleted — never sent"); renderInbox(); updateBadge(); break;
    case "inbox-all": sendAllInbox(); break;
    case "inbox-edit": editInboxItem(id); break;

    case "pin-open": closeSheet(); setTimeout(() => openPin(id), 240); break;
    case "pin-yes": votePin(id, true); break;
    case "pin-no": votePin(id, false); break;
    case "pin-report": closeSheet(); setTimeout(() => openReport(id), 240); break;
    case "pin-edit": closeSheet(); setTimeout(() => openPinEdit(id), 240); break;
    case "pin-clear": closeSheet(); setTimeout(() => openClearing(id), 240); break;
    case "clear-ok": commitClearing(id); break;
    case "report-send": sendReport(); break;
    case "report-form": state.profile.points += 1; pushHistory("🌐", "Opened a city report form"); save(); break;

    case "te-cat": window._typeEdit.cat = t.dataset.cat; window._typeEdit.subtype = ""; window._typeEditDraw(); break;
    case "te-sub": window._typeEdit.subtype = t.dataset.sub; window._typeEditDraw(); break;
    case "te-save": window._typeEdit.onSave(window._typeEdit.cat, window._typeEdit.subtype); break;

    case "edit-profile": openProfileEditor(); break;
    case "pf-emoji": window._pf.emoji = t.dataset.e; window._pfDraw(); break;
    case "pf-vis": window._pf.visibility = t.dataset.v; window._pfDraw(); break;
    case "pf-save": { const n = ($("#pfName").value || "").trim(); if (!n) { toast("Add a name", "warn"); break; } state.profile.name = n.slice(0, 24); state.profile.emoji = window._pf.emoji; state.profile.visibility = window._pf.visibility; save(); closeSheet(); renderSettings(); toast("Profile saved", "good"); break; }

    case "set-toggle": { const k = t.dataset.key; state.settings[k] = !state.settings[k]; save(); t.classList.toggle("on", state.settings[k]); if (k === "dark") applyTheme(); if (k === "notifications" && state.settings.notifications) { const ok = await Platform.requestNotify(); if (!ok) { state.settings.notifications = false; save(); t.classList.remove("on"); toast("Turn on notifications in your browser settings to use this", "warn", 3600); } } if (k === "autoUpload" && state.settings.autoUpload) Sync.flushIfAuto(); break; }
    case "set-mode": state.settings.mode = t.dataset.mode; save(); $("#modeChip").textContent = MODE_LABEL[state.settings.mode]; renderSettings(); break;
    case "export-csv": exportCSV(); break;
    case "refresh-community": { toast("Refreshing…"); const r = await Sync.fetchCommunity(); window._remoteHazards = r; MapCtl.refreshPins(); toast(r.length ? `Loaded ${r.length} community reports` : "No new community reports", r.length ? "good" : "warn"); break; }
    case "reset": if (confirm("Reset motio? Your reports, points and settings will be erased.")) { localStorage.clear(); indexedDB.deleteDatabase("motio-vault"); indexedDB.deleteDatabase("motio-tiles"); location.reload(); } break;

    case "onb-emoji": window._pf.emoji = t.dataset.e; window._onbDrawE(); break;
    case "onb-vis": window._pf.visibility = t.dataset.v; window._onbDrawE(); break;
  }
});

function openPinEdit(id) {
  const h = state.hazards.find(x => x.id === id) || allHazards().find(x => x.id === id); if (!h) return;
  openTypeEditor(h.cat, h.subtype, (cat, subtype) => {
    const local = state.hazards.find(x => x.id === id);
    if (local) { local.cat = cat; local.subtype = subtype; save(); MapCtl.refreshPins(); }
    if (subtype && SUBTYPE_BY_ID[subtype] === undefined) { state.promoted[subtype] = (state.promoted[subtype] || 0) + 1; save(); }
    closeSheet(); toast("Updated", "good");
  });
}

/* Singletons */
$("#scrim").addEventListener("click", closeSheet);
$("#cancelBtn").addEventListener("click", () => { hideCancel(true); toast("Cancelled — nothing saved"); });
$("#wxDismiss").addEventListener("click", () => { window._wxDismissed = true; $("#wxBanner").hidden = true; });
$("#onbAction").addEventListener("click", onbAction);
$("#modeChip").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const order = ["bike","walk","drive"]; state.settings.mode = order[(order.indexOf(state.settings.mode) + 1) % 3]; save(); $("#modeChip").textContent = MODE_LABEL[state.settings.mode]; } });

/* Edge-safe horizontal swipe between tabs (inset from screen edges so it
   never fights the browser's own back-swipe). */
(function swipe() {
  const TABS = ["home", "map", "inbox", "settings"];
  let x0 = null, y0 = null;
  const area = $(".screens");
  area.addEventListener("touchstart", (e) => { const t = e.touches[0]; if (t.clientX < 28 || t.clientX > window.innerWidth - 28) return; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
  area.addEventListener("touchend", (e) => {
    if (x0 == null) return; const t = e.changedTouches[0]; const dx = t.clientX - x0, dy = t.clientY - y0;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.8 && !Track.active) {
      const i = TABS.indexOf(currentScreen); if (i >= 0) { const ni = dx < 0 ? Math.min(TABS.length - 1, i + 1) : Math.max(0, i - 1); if (ni !== i) showScreen(TABS[ni]); }
    }
    x0 = y0 = null;
  }, { passive: true });
})();

/* ================= Boot ================= */
function boot() {
  applyTheme();
  $("#modeChip").textContent = MODE_LABEL[state.settings.mode];
  wireEngine();
  Sync.init(); Sync.onChange = () => { updateBadge(); updateCloud(); if (currentScreen === "inbox") renderInbox(); };
  Sync.startLoop();
  updateBadge(); updateCloud();
  renderHome();
  if (!state.onboarded) startOnboarding();
  // Ambient-light auto theme (Android only; silent no-op elsewhere).
  if (state.settings.autoDark) Platform.startLight((lux) => { const wantDark = lux < 12; if (wantDark !== state.settings.dark) { state.settings.dark = wantDark; applyTheme(); } });
  Sync.fetchCommunity().then(r => { if (r.length) { window._remoteHazards = r; MapCtl.refreshPins(); } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
