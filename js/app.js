/* ============================================================
   app.js — motio application controller.
   SPA state engine: navigation, rendering, tracking lifecycle,
   capture, encrypted inbox, community map, civic actions.

   Load order (index.html): civic → crypto → data → sensors →
   engine → sync → app. Everything is plain globals; no build.
   ============================================================ */

/* ================= State ================= */
const STORE_KEY = "motio.v1";

const DEFAULT_STATE = () => ({
  onboarded: false,
  ageConfirmed: false,
  waiverAccepted: false,
  settings: {
    dark: false,
    mode: "bike",          // bike | walk
    autoUpload: true,      // 10-minute loop on/off
    lowPower: false,       // disables AudioContext (sonar) factor
    tts: true,             // proximity voice alerts
    radiusM: 120,          // proximity alert radius (meters)
    offline: false,        // offline tiles mode
  },
  profile: { name: "Novato commuter", points: 0, mapped: 0, cleared: 0, emails: 0 },
  hazards: SEED_HAZARDS.map(h => ({ ...h })),
  filters: { pothole: true, manhole: true, rut: true, branch: true, oil: true, dumping: true },
  history: [],             // { t, icon, text }
});

let state = load();
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = Object.assign(DEFAULT_STATE(), JSON.parse(raw));
      s.settings = Object.assign(DEFAULT_STATE().settings, s.settings);
      return s;
    }
  } catch (e) {}
  return DEFAULT_STATE();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

/* ================= Helpers ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => "m" + Math.random().toString(36).slice(2, 10);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtAgo = (ts) => {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
};
const sevColors = ["#5f8a5f", "#8a9a4e", "#e0902f", "#cf6b3a", "#d64d3f"];
const sevColor = (n) => sevColors[Math.max(1, Math.min(5, n)) - 1];
const sevLabel = (n) => ["", "Minor", "Low", "Moderate", "High", "Severe"][Math.max(1, Math.min(5, n))];
function haversineM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function pushHistory(icon, text) {
  state.history.unshift({ t: Date.now(), icon, text });
  state.history = state.history.slice(0, 30);
  save();
}

/* ================= Feedback (vibrate → chime → flash fallbacks) ================= */
const Feedback = {
  _ctx: null,
  // AudioContext for chimes: reuse the tracking context when present;
  // else lazily create (may start suspended off-gesture — then we fall
  // through the chain to the visual flash).
  ctx() {
    if (Sensors._audioCtx) return Sensors._audioCtx;
    if (!this._ctx) {
      try { const AC = window.AudioContext || window.webkitAudioContext; this._ctx = new AC(); } catch (e) {}
    }
    return this._ctx;
  },
  tone(freq = 880, ms = 160, vol = 0.4) {
    const ctx = this.ctx();
    if (!ctx) return false;
    if (ctx.state === "suspended") { ctx.resume().catch(() => {}); if (ctx.state === "suspended") return false; }
    try {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = freq;
      g.gain.value = vol;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + ms / 1000);
      return true;
    } catch (e) { return false; }
  },
  flash() {
    const d = $("#device");
    d.classList.remove("flash-alert");
    void d.offsetWidth; // restart animation
    d.classList.add("flash-alert");
  },
  // The spec's fallback chain: vibrate → audio chime → visual flash.
  alert(pattern = [90, 60, 90]) {
    if (Sensors.buzz(pattern)) return "vibrate";
    if (this.tone(880, 150) ) { setTimeout(() => this.tone(660, 150), 200); return "tone"; }
    this.flash();
    return "flash";
  },
};

/* ================= Toasts ================= */
function toast(msg, kind = "", ms = 2800) {
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, ms - 300);
  setTimeout(() => el.remove(), ms);
}

/* ================= Theme ================= */
function applyTheme() {
  document.documentElement.dataset.theme = state.settings.dark ? "dark" : "";
  $("#darkIcon").textContent = state.settings.dark ? "🌙" : "☀️";
}

/* ================= Navigation ================= */
let currentScreen = "home";
function showScreen(name) {
  if (Track.active && name !== "track") { toast("⛔ End tracking first — battery saver keeps only telemetry alive", "warn"); return; }
  currentScreen = name;
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  $("#backBtn").style.display = "none";
  renderScreen(name);
}
function renderScreen(name) {
  if (name === "home") renderHome();
  else if (name === "map") renderMap();
  else if (name === "inbox") renderInbox();
  else if (name === "settings") renderSettings();
}

/* ================= HOME ================= */
function renderHome() {
  const p = state.profile;
  const pendingNote = Sync.configured
    ? (state.settings.autoUpload ? "auto-upload every 10 min" : "manual review mode")
    : "sync unavailable — working locally";
  $("#screen-home").innerHTML = `
    <h1>Good ${new Date().getHours() < 12 ? "morning" : (new Date().getHours() < 17 ? "afternoon" : "evening")}, ${esc(p.name)}</h1>
    <p class="sub">Novato's community road &amp; trail hazard network.</p>

    <div class="grid-3">
      <div class="stat"><b>${p.mapped}</b><span>hazards mapped</span></div>
      <div class="stat"><b>${p.cleared}</b><span>hazards cleared</span></div>
      <div class="stat"><b>${p.points}</b><span>civic points</span></div>
    </div>

    <button class="btn mt" data-act="start-track" style="padding:17px;font-size:16px">▶ Start tracking</button>
    <p class="muted center" style="margin-top:6px">${state.settings.mode === "bike" ? "Bike" : "Walk"} mode · sensor fusion arms between 6–22 mph · ${pendingNote}</p>

    <div class="card mt" id="homeZoneCard">
      <h3>📍 Zone awareness</h3>
      <p class="muted" id="homeZoneText">Checking your location against Novato's documented risk corridors…</p>
    </div>

    <div class="card">
      <h3>Recent activity</h3>
      ${state.history.length
        ? state.history.slice(0, 5).map(h => `<div class="list-row"><span>${h.icon}</span><span style="flex:1">${esc(h.text)}</span><span class="muted">${fmtAgo(h.t)}</span></div>`).join("")
        : `<p class="muted">Nothing yet. Start tracking or capture a hazard with the ＋ button.</p>`}
    </div>
  `;
  // Async zone check for the home card.
  Sensors.getPosition().then(pos => {
    const el = $("#homeZoneText");
    if (!el) return;
    if (!pos) { el.textContent = "Location unavailable. Zone alerts activate while tracking."; return; }
    const z = zoneForPoint(pos.lat, pos.lng);
    el.innerHTML = z
      ? `⚠️ You're inside a documented risk corridor:<br><b>${esc(z.title)}</b><br>Known issue: ${esc(z.riskType)}. Sensor sensitivity is raised here.`
      : "You're outside Novato's documented risk corridors. All 7 zones are outlined on the map.";
  });
}

/* ================= MAP ================= */
const MapCtl = {
  map: null, tiles: null, markers: [], zoneRects: [], meMarker: null,
  showZones: true,

  /* ---- IndexedDB tile cache (offline mode fills as you pan) ---- */
  BLANK_TILE: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==",
  _tileDB: null,
  tileDB() {
    return new Promise((resolve) => {
      if (this._tileDB) return resolve(this._tileDB);
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open("motio-tiles", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("tiles");
      req.onsuccess = () => { this._tileDB = req.result; resolve(this._tileDB); };
      req.onerror = () => resolve(null);
    });
  },
  async tileGet(key) {
    const db = await this.tileDB(); if (!db) return null;
    return new Promise((res) => {
      const rq = db.transaction("tiles").objectStore("tiles").get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  },
  async tilePut(key, dataURL) {
    const db = await this.tileDB(); if (!db) return;
    try { db.transaction("tiles", "readwrite").objectStore("tiles").put(dataURL, key); } catch (e) {}
  },

  isOffline() { return state.settings.offline || !navigator.onLine; },

  init() {
    if (this.map) return;
    const host = $("#leafletHost");
    if (!host) return;
    this.map = L.map(host, {
      center: [NOVATO_CENTER.lat, NOVATO_CENTER.lng],
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
      maxBounds: [[NOVATO_VIEW.minLat - .06, NOVATO_VIEW.minLng - .08], [NOVATO_VIEW.maxLat + .06, NOVATO_VIEW.maxLng + .08]],
    });

    // Caching tile layer: serves from IndexedDB when offline, caches
    // (CORS-permitting) tiles while online.
    const self = this;
    const CachingLayer = L.TileLayer.extend({
      createTile(coords, done) {
        const img = document.createElement("img");
        const key = `${coords.z}/${coords.x}/${coords.y}`;
        const url = L.Util.template(TILE_LAYER.url, coords);
        img.alt = "";
        if (self.isOffline()) {
          self.tileGet(key).then(data => { img.src = data || self.BLANK_TILE; done(null, img); });
        } else {
          img.crossOrigin = "anonymous";
          img.onload = () => {
            done(null, img);
            try {
              const c = document.createElement("canvas");
              c.width = img.naturalWidth; c.height = img.naturalHeight;
              c.getContext("2d").drawImage(img, 0, 0);
              self.tilePut(key, c.toDataURL("image/png"));
            } catch (e) { /* tainted or quota — display still fine */ }
          };
          img.onerror = () => self.tileGet(key).then(data => { img.src = data || self.BLANK_TILE; done(null, img); });
          img.src = url;
        }
        return img;
      },
    });
    this.tiles = new CachingLayer(TILE_LAYER.url, { maxZoom: TILE_LAYER.maxZoom, attribution: TILE_LAYER.attribution });
    this.tiles.addTo(this.map);

    // Zone rectangles: the 7 documented Novato risk corridors.
    this.drawZones();

    this.map.on("zoomend moveend", () => { this.refreshPins(); this.updateZoneBanner(); });
    this.map.on("click", (e) => openManualReport({ lat: e.latlng.lat, lng: e.latlng.lng }));
    this.refreshPins();
    this.updateZoneBanner();
  },

  // Full unmount for OLED power mode: destroy the Leaflet instance and
  // empty the host node so the GPU/RAM cost drops to zero.
  destroy() {
    if (!this.map) return;
    try { this.map.remove(); } catch (e) {}
    this.map = null; this.tiles = null; this.markers = []; this.zoneRects = []; this.meMarker = null;
    const host = $("#leafletHost");
    if (host) host.innerHTML = "";
  },

  drawZones() {
    this.zoneRects.forEach(r => r.remove());
    this.zoneRects = [];
    if (!this.showZones || !this.map) return;
    for (const [id, z] of Object.entries(NOVATO_HAZARD_ZONES)) {
      const rect = L.rectangle(
        [[z.latMin, z.lngMin], [z.latMax, z.lngMax]],
        { color: "#c07a4f", weight: 1, dashArray: "4 4", fillColor: "#c07a4f", fillOpacity: 0.06, interactive: false });
      rect.addTo(this.map);
      this.zoneRects.push(rect);
    }
  },

  visibleHazards() {
    return allHazards().filter(h => state.filters[h.cat]);
  },

  // Zoom-aware clustering: group pins closer than 44 px at current zoom.
  clusters() {
    const list = this.visibleHazards();
    if (!this.map) return [];
    const groups = [];
    const used = new Set();
    for (const h of list) {
      if (used.has(h.id)) continue;
      const g = [h]; used.add(h.id);
      const p1 = this.map.latLngToContainerPoint([h.lat, h.lng]);
      for (const o of list) {
        if (used.has(o.id)) continue;
        const p2 = this.map.latLngToContainerPoint([o.lat, o.lng]);
        if (p1.distanceTo(p2) < 44) { g.push(o); used.add(o.id); }
      }
      groups.push(g);
    }
    return groups;
  },

  refreshPins() {
    if (!this.map) return;
    this.markers.forEach(m => m.remove());
    this.markers = [];
    for (const group of this.clusters()) {
      if (group.length === 1) {
        const h = group[0];
        const c = CATEGORIES[h.cat];
        const icon = L.divIcon({
          className: "",
          html: `<div class="pin ${h.status}" style="background:${c.color}"><span>${c.icon}</span></div>`,
          iconSize: [30, 30], iconAnchor: [15, 28],
        });
        const m = L.marker([h.lat, h.lng], { icon }).addTo(this.map);
        m.on("click", () => { this.map.flyTo([h.lat, h.lng], Math.max(this.map.getZoom(), 16), { duration: .5 }); openPin(h.id); });
        this.markers.push(m);
      } else {
        const lat = group.reduce((s, h) => s + h.lat, 0) / group.length;
        const lng = group.reduce((s, h) => s + h.lng, 0) / group.length;
        const icon = L.divIcon({ className: "", html: `<div class="cluster">${group.length}</div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
        const m = L.marker([lat, lng], { icon }).addTo(this.map);
        const ids = group.map(h => h.id);
        m.on("click", () => openCluster(ids));
        this.markers.push(m);
      }
    }
  },

  updateMe(pos) {
    if (!this.map) return;
    if (!this.meMarker) {
      const icon = L.divIcon({ className: "", html: `<div style="width:16px;height:16px;border-radius:50%;background:#4f7166;border:3px solid #fff;box-shadow:0 0 0 4px rgba(79,113,102,.25)"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] });
      this.meMarker = L.marker([pos.lat, pos.lng], { icon }).addTo(this.map);
    } else this.meMarker.setLatLng([pos.lat, pos.lng]);
  },

  updateZoneBanner() {
    const el = $("#zoneBanner");
    if (!el || !this.map) return;
    const c = this.map.getCenter();
    const z = zoneForPoint(c.lat, c.lng);
    el.style.display = z ? "block" : "none";
    if (z) el.innerHTML = `<b>⚠️ ${esc(z.riskType)}</b> — ${esc(z.title)}`;
  },
};

function allHazards() {
  // Local (persisted) + remote (community pull, session-only), deduped.
  const seen = new Set(state.hazards.map(h => h.id));
  return state.hazards.concat((window._remoteHazards || []).filter(h => !seen.has(h.id)));
}

function renderMap() {
  const scr = $("#screen-map");
  if (!$("#mapWrap", scr)) {
    scr.innerHTML = `
      <div id="mapWrap">
        <div id="leafletHost"></div>
        <div class="map-status">
          <div class="zone-banner" id="zoneBanner" style="display:none"></div>
        </div>
        <div class="map-ui tr">
          <button class="map-btn" data-act="map-locate" title="My location">🎯</button>
          <button class="map-btn" data-act="map-zones" title="Toggle risk zones">▦</button>
          <button class="map-btn" data-act="map-offline" title="Offline tiles" id="offlineBtn">📶</button>
        </div>
        <div class="map-ui bl" id="filterChips"></div>
      </div>`;
  }
  MapCtl.init();
  renderFilterChips();
  $("#offlineBtn").textContent = MapCtl.isOffline() ? "📴" : "📶";
  setTimeout(() => MapCtl.map && MapCtl.map.invalidateSize(), 60);
}

function renderFilterChips() {
  const el = $("#filterChips");
  if (!el) return;
  el.innerHTML = Object.entries(CATEGORIES).map(([k, c]) =>
    `<button class="chip ${state.filters[k] ? "on" : ""}" data-act="filter" data-cat="${k}">${c.icon} ${c.label}</button>`).join("");
}

/* ================= TRACKING (OLED power mode) ================= */
const Track = {
  active: false,
  startedAt: 0,
  distanceM: 0,
  pulses: 0,
  lastPos: null,
  _wakeVideo: null, _wakeLock: null, _wakeDraw: null,
  _zoneId: null,
  _alerted: new Set(), // proximity alert cooldown per hazard

  /* Wakelock: 1×1 black looping silent video (canvas captureStream —
     no external asset), plus the native Screen Wake Lock API where
     available. Keeps mobile browsers from throttling sensor loops. */
  startWakelock() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1; canvas.height = 1;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 1, 1);
      this._wakeDraw = setInterval(() => ctx.fillRect(0, 0, 1, 1), 1000);
      const stream = canvas.captureStream(1);
      const v = document.createElement("video");
      v.className = "wakelock";
      v.muted = true; v.setAttribute("muted", "");
      v.playsInline = true; v.setAttribute("playsinline", "");
      v.loop = true;
      v.srcObject = stream;
      $("#device").appendChild(v);
      v.play().catch(() => {});
      this._wakeVideo = v;
    } catch (e) {}
    if ("wakeLock" in navigator) {
      navigator.wakeLock.request("screen").then(l => { this._wakeLock = l; }).catch(() => {});
    }
  },
  stopWakelock() {
    if (this._wakeDraw) { clearInterval(this._wakeDraw); this._wakeDraw = null; }
    if (this._wakeVideo) { this._wakeVideo.remove(); this._wakeVideo = null; }
    if (this._wakeLock) { this._wakeLock.release().catch(() => {}); this._wakeLock = null; }
  },
};

/* Start Tracking — THE user gesture. iOS motion permission and the
   AudioContext are initialized here and only here (spec rule). */
async function startTracking() {
  if (Track.active) return;
  if (!state.waiverAccepted) { openWaiverSheet(() => startTracking()); return; }

  toast("🔐 Arming sensors…", "", 1500);

  // 1) Permissions + hardware, inside the gesture:
  await Sensors.requestMotionPermission();
  let audioOn = false;
  if (!state.settings.lowPower) audioOn = await Sensors.initAudio();

  // 2) Power: unmount the map entirely (RAM/GPU), start wakelock.
  MapCtl.destroy();
  Track.startWakelock();

  // 3) Engine + GPS.
  Track.active = true;
  Track.startedAt = Date.now();
  Track.distanceM = 0; Track.pulses = 0; Track.lastPos = null;
  Track._zoneId = null; Track._alerted = new Set();

  const started = Engine.start({ lowPower: state.settings.lowPower });
  Sensors.startWatch(onTrackPosition);

  currentScreen = "track";
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-track"));
  $$(".tab").forEach(t => t.classList.remove("active"));
  renderTrackScreen(started, audioOn);

  const fallbacks = [];
  if (!started.motion) fallbacks.push("IMU unavailable → GPS-altitude fallback");
  if (!audioOn && !state.settings.lowPower) fallbacks.push("mic unavailable → IMU-only");
  if (state.settings.lowPower) fallbacks.push("Low Power: sonar off");
  toast("▶ Tracking started" + (fallbacks.length ? "<br>" + fallbacks.join("<br>") : ""), "good", 3400);
}

function endTracking() {
  if (!Track.active) return;
  Track.active = false;
  Engine.stop();
  Sensors.stopWatch();
  Sensors.stopAudio();
  Track.stopWakelock();
  hideCancelOverlay(true);

  const mins = Math.max(1, Math.round((Date.now() - Track.startedAt) / 60000));
  const km = (Track.distanceM / 1000).toFixed(1);
  pushHistory("🏁", `Tracked ${km} km in ${mins} min — ${Track.pulses} auto-detection${Track.pulses === 1 ? "" : "s"}`);
  toast(`🏁 Trip saved: ${km} km · ${mins} min · ${Track.pulses} detections`, "good", 3600);
  showScreen("home");
}

function renderTrackScreen(started, audioOn) {
  $("#screen-track").innerHTML = `
    <div class="oled" id="oled">
      <div>
        <span class="big" id="tSpeed">0</span>
        <span class="unit"> mph</span>
      </div>
      <div class="armed-line off" id="tArmed">DISARMED — 6–22 MPH WINDOW</div>
      <div class="zone-line" id="tZone"></div>
      <div class="tele-grid">
        <div class="tele"><b id="tDist">0.0</b><span>km</span></div>
        <div class="tele"><b id="tTime">0:00</b><span>elapsed</span></div>
        <div class="tele"><b id="tPulses">0</b><span>detections</span></div>
        <div class="tele"><b id="tDev">—</b><span>iz dev / thr</span></div>
      </div>
      <div class="tele-grid" style="margin-top:14px">
        <div class="tele"><b style="font-size:13px">${started.motion ? "IMU" : "GPS-ALT"}</b><span>Iz source</span></div>
        <div class="tele"><b style="font-size:13px">${state.settings.lowPower ? "OFF" : (audioOn ? "LIVE" : "N/A")}</b><span>Ab sonar</span></div>
      </div>
      <button class="end-btn" data-act="end-track">■ End tracking</button>
    </div>`;
  Engine.onTelemetry = (t) => {
    const s = $("#tSpeed"); if (!s) return;
    s.textContent = Math.round(t.speedMph);
    $("#tDist").textContent = (Track.distanceM / 1000).toFixed(1);
    const el = Math.floor((Date.now() - Track.startedAt) / 1000);
    $("#tTime").textContent = Math.floor(el / 60) + ":" + String(el % 60).padStart(2, "0");
    $("#tPulses").textContent = Track.pulses;
    $("#tDev").textContent = t.dev.toFixed(1) + "/" + t.threshold.toFixed(1);
    const a = $("#tArmed");
    a.className = "armed-line " + (t.armed ? "on" : "off");
    a.textContent = t.armed ? "ARMED — SENSOR FUSION LIVE" : "DISARMED — 6–22 MPH WINDOW";
    $("#tZone").textContent = t.zone ? `zone: ${t.zone.riskType} · threshold ×${zoneSensorFactor(t.zone)}` : "";
  };
}

function onTrackPosition(pos) {
  Engine.updatePosition(pos);
  // Distance accumulation (ignore poor fixes).
  if (pos.acc == null || pos.acc < 60) {
    if (Track.lastPos) {
      const d = haversineM(Track.lastPos, pos);
      if (d > 1 && d < 200) Track.distanceM += d;
    }
    Track.lastPos = { lat: pos.lat, lng: pos.lng };
  }
  // Zone entry announcements (the hazardlocations.js purpose).
  const z = zoneForPoint(pos.lat, pos.lng);
  const zid = z ? z.id : null;
  if (zid !== Track._zoneId) {
    Track._zoneId = zid;
    if (z) {
      toast(`⚠️ Entering risk corridor: ${esc(z.riskType)}`, "warn", 3600);
      if (state.settings.tts) Sensors.speak(`Caution. Entering ${z.riskType.split("/")[0].trim()} area.`);
      Sensors.buzz([60, 40, 60]);
    }
  }
  checkProximity(pos);
}

/* AirPods-style proximity voice alerts: verified hazards ahead. */
function checkProximity(pos) {
  if (!state.settings.tts && !Sensors.vibrateSupported) return;
  for (const h of allHazards()) {
    if (h.status !== "verified" || Track._alerted.has(h.id)) continue;
    if (haversineM(pos, h) <= state.settings.radiusM) {
      Track._alerted.add(h.id);
      const c = CATEGORIES[h.cat];
      if (state.settings.tts) Sensors.speak(`Warning: ${c.label} ahead.`);
      Feedback.alert([80, 50, 80]);
      if (Track.active) Track._lastProx = h.id;
      else toast(`🔊 ${c.icon} ${c.label} nearby`, "warn");
    }
  }
}

/* ================= Engine event wiring (global, incl. demo) ================= */
function wireEngine() {
  Engine.onDetect = (d) => {
    // Sharp double-vibration + chime, then the 10-second Cancel window.
    Feedback.alert([120, 80, 120]);
    Feedback.tone(980, 120); setTimeout(() => Feedback.tone(980, 120), 180);
    const pos = Track.lastPos || NOVATO_CENTER;
    const z = zoneForPoint(pos.lat, pos.lng);
    showCancelOverlay({
      cat: d.cat, sev: d.sev,
      lat: pos.lat, lng: pos.lng,
      zoneId: z ? z.id : null,
      note: `Auto-detected ${d.scenario.replace(/_/g, " ")} (confidence ${(d.confidence * 100) | 0}%${d.sim ? ", simulated" : ""})`,
      source: "auto",
    });
  };
  Engine.onIgnore = (d) => {
    toast(`↷ Bypassed: ${d.scenario === "cattle_guard" ? "cattle guard / metal grate" : "speed bump"} (not a hazard)`, "", 2200);
  };
  Engine.onBeacon = () => showBeacon();
}

/* ---- 10-second Cancel-Log overlay ---- */
const CancelCtl = { timer: null, payload: null, count: 10 };
function showCancelOverlay(payload) {
  hideCancelOverlay(true);
  CancelCtl.payload = payload;
  CancelCtl.count = 10;
  $("#cancelWhat").textContent = `${CATEGORIES[payload.cat].icon} ${CATEGORIES[payload.cat].label} detected — logging in`;
  $("#cancelCount").textContent = "10";
  $("#cancelOverlay").classList.add("show");
  CancelCtl.timer = setInterval(() => {
    CancelCtl.count--;
    const el = $("#cancelCount");
    if (el) el.textContent = CancelCtl.count;
    if (CancelCtl.count <= 0) commitCancelOverlay();
  }, 1000);
}
async function commitCancelOverlay() {
  const p = CancelCtl.payload;
  hideCancelOverlay(false);
  if (!p) return;
  Track.pulses++;
  await Sync.enqueue(p, "auto");
  pushHistory("📡", `Auto-logged ${CATEGORIES[p.cat].label} (encrypted to inbox)`);
  toast(`🔐 ${CATEGORIES[p.cat].label} encrypted → Review inbox`, "good");
  updateInboxBadge();
}
function hideCancelOverlay(discard) {
  if (CancelCtl.timer) { clearInterval(CancelCtl.timer); CancelCtl.timer = null; }
  $("#cancelOverlay").classList.remove("show");
  if (discard) CancelCtl.payload = null;
}

/* ---- Safety Beacon ---- */
const Beacon = { toneTimer: null };
function showBeacon() {
  $("#beacon").classList.add("show");
  const burst = () => { Feedback.tone(1400, 350, 0.9); Sensors.buzz([300, 120, 300]); };
  burst();
  Beacon.toneTimer = setInterval(burst, 900);
}
function hideBeacon() {
  $("#beacon").classList.remove("show");
  if (Beacon.toneTimer) { clearInterval(Beacon.toneTimer); Beacon.toneTimer = null; }
  pushHistory("🛟", "Safety Beacon dismissed — marked OK");
}

/* ================= CAPTURE (FAB) ================= */
const Capture = { photo: null, cat: "pothole", sev: 3, pos: null, dictating: false };
async function openCapture(preset) {
  Capture.photo = null;
  Capture.cat = preset?.cat || "pothole";
  Capture.sev = 3;
  Capture.pos = preset?.lat ? { lat: preset.lat, lng: preset.lng } : null;

  openSheet(`
    <h2>＋ Capture hazard</h2>
    <p class="sub">Photo + GPS pin, encrypted on-device. <span class="lock-tag">🔒 AES-256-GCM</span></p>
    <div class="row" style="margin-bottom:10px">
      <video id="capCam" style="width:104px;height:78px;border-radius:10px;background:#111;object-fit:cover" playsinline muted></video>
      <div style="flex:1;display:flex;flex-direction:column;gap:7px">
        <button class="btn ghost sm" data-act="cap-snap">📷 Snap photo</button>
        <label class="btn ghost sm" style="text-align:center">🖼️ Choose file<input type="file" accept="image/*" capture="environment" id="capFile" style="display:none"></label>
      </div>
    </div>
    <div id="capThumbWrap" style="display:none;margin-bottom:10px"><img id="capThumb" style="width:100%;border-radius:10px;max-height:140px;object-fit:cover"></div>
    <div class="cat-picker" id="capCats"></div>
    <p class="muted mt" style="margin-bottom:4px">Severity</p>
    <div class="sev-picker" id="capSev"></div>
    <p class="muted mt" style="margin-bottom:4px">Note — typed or dictated (raw transcript only, never AI-written)</p>
    <div class="row">
      <textarea id="capNote" rows="2" placeholder="e.g. deep pothole, right lane"></textarea>
      <button class="icon-btn" data-act="cap-dictate" id="capMic" title="Dictate">🎙️</button>
    </div>
    <p class="muted mt" id="capGPS">📡 Acquiring GPS…</p>
    <button class="btn accent mt" data-act="cap-save">🔐 Encrypt &amp; queue report</button>
  `, () => { Sensors.stopCamera(); Sensors.stopDictation(); });

  renderCapPickers();
  const fi = $("#capFile");
  if (fi) fi.addEventListener("change", () => readCaptureFile(fi));
  Sensors.startCamera($("#capCam"));
  if (!Capture.pos) {
    const pos = await Sensors.getPosition();
    Capture.pos = pos || { ...NOVATO_CENTER, approx: true };
  }
  const g = $("#capGPS");
  if (g) {
    const z = zoneForPoint(Capture.pos.lat, Capture.pos.lng);
    g.innerHTML = `📡 ${Capture.pos.lat.toFixed(5)}, ${Capture.pos.lng.toFixed(5)}${Capture.pos.approx ? " (approx — GPS unavailable)" : ""}${z ? `<br>⚠️ Inside: ${esc(z.riskType)} corridor` : ""}`;
  }
}
function renderCapPickers() {
  $("#capCats").innerHTML = Object.entries(CATEGORIES).map(([k, c]) =>
    `<button class="${Capture.cat === k ? "on" : ""}" data-act="cap-cat" data-cat="${k}"><span class="ic">${c.icon}</span>${c.label}</button>`).join("");
  $("#capSev").innerHTML = [1, 2, 3, 4, 5].map(n =>
    `<button class="${Capture.sev === n ? "on" : ""}" data-act="cap-sev" data-sev="${n}" style="${Capture.sev === n ? `background:${sevColor(n)}` : ""}">${n}</button>`).join("");
}
function snapCapturePhoto() {
  const v = $("#capCam");
  if (!v || !v.videoWidth) { toast("Camera unavailable — use Choose file", "warn"); return; }
  const c = document.createElement("canvas");
  const scale = Math.min(1, 720 / v.videoWidth);
  c.width = v.videoWidth * scale; c.height = v.videoHeight * scale;
  c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
  Capture.photo = c.toDataURL("image/jpeg", 0.72);
  showCaptureThumb();
}
function readCaptureFile(input) {
  const f = input.files && input.files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 720 / img.width);
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      Capture.photo = c.toDataURL("image/jpeg", 0.72);
      showCaptureThumb();
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(f);
}
function showCaptureThumb() {
  $("#capThumbWrap").style.display = "block";
  $("#capThumb").src = Capture.photo;
  toast("📷 Photo attached", "good", 1600);
}
function toggleDictation() {
  const mic = $("#capMic");
  if (Capture.dictating) { Sensors.stopDictation(); Capture.dictating = false; mic.style.background = ""; return; }
  const ok = Sensors.startDictation(
    (text) => { const n = $("#capNote"); if (n) n.value = text; },
    () => { Capture.dictating = false; const m = $("#capMic"); if (m) m.style.background = ""; });
  if (!ok) { toast("Dictation not supported on this browser", "warn"); return; }
  Capture.dictating = true;
  mic.style.background = "var(--accent-soft)";
  toast("🎙️ Listening — speak your note", "", 2000);
}
async function saveCapture() {
  if (!state.ageConfirmed) { closeSheet(); openAgeSheet(() => openCapture()); return; }
  const pos = Capture.pos || NOVATO_CENTER;
  const z = zoneForPoint(pos.lat, pos.lng);
  const payload = {
    cat: Capture.cat, sev: Capture.sev,
    lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6),
    note: ($("#capNote")?.value || "").slice(0, 400),
    photo: Capture.photo, hasPhoto: !!Capture.photo,
    zoneId: z ? z.id : null,
    source: "manual", capturedAt: Date.now(),
  };
  closeSheet();
  await Sync.enqueue(payload, "manual");
  state.profile.points += 1;
  pushHistory("📷", `Captured ${CATEGORIES[payload.cat].label} (encrypted to inbox)`);
  save();
  updateInboxBadge();
  toast(`🔐 Encrypted &amp; queued — ${state.settings.autoUpload ? "auto-uploads within 10 min" : "approve it in Review"}`, "good", 3400);
}

/* Manual report from a map tap. */
function openManualReport(latlng) {
  openCapture({ lat: latlng.lat, lng: latlng.lng });
}

/* ================= INBOX / REVIEW ================= */
async function updateInboxBadge() {
  const n = await VaultDB.count();
  const b = $("#inboxBadge");
  b.style.display = n ? "grid" : "none";
  b.textContent = n;
}
async function renderInbox() {
  const rows = await Sync.pending();
  const status = Sync.configured
    ? (navigator.onLine ? `☁️ Supabase connected · ${state.settings.autoUpload ? "auto-upload every 10 min" : "manual approval mode"}${Sync.lastSyncAt ? ` · last sync ${fmtAgo(Sync.lastSyncAt)}` : ""}` : "📴 Offline — uploads resume on reconnect")
    : "⚠️ Sync unavailable — reports stay encrypted on-device";
  const scr = $("#screen-inbox");
  scr.innerHTML = `
    <h1>Review</h1>
    <p class="sub">${rows.length ? `${rows.length} encrypted report${rows.length === 1 ? "" : "s"} staged locally.` : "Nothing staged — you're all caught up."}<br>${status}</p>
    ${rows.length ? `<div class="row" style="margin-bottom:12px">
      <button class="btn sm" data-act="inbox-approve-all">☁️ Approve &amp; upload all</button>
      ${state.settings.autoUpload && Sync.configured ? `<button class="btn ghost sm" data-act="inbox-sync-now">Sync now</button>` : ""}
    </div>` : ""}
    <div id="inboxList">${rows.map(r => `
      <div class="inbox-item" id="ib-${r.id}">
        <div class="ico">🔒</div>
        <div class="meta">
          <b>Decrypting…</b>
          <span>${r.source === "auto" ? "sensor auto-detection" : "manual capture"} · ${fmtAgo(r.createdAt)} · <span class="lock-tag">AES-256-GCM</span></span>
        </div>
        <div class="acts">
          <button data-act="inbox-approve" data-id="${r.id}" title="Approve & upload">☁️</button>
          <button data-act="inbox-discard" data-id="${r.id}" title="Discard">🗑️</button>
        </div>
      </div>`).join("")}
    </div>`;
  // Decrypt for display (device key stays local; storage stays encrypted).
  for (const r of rows) {
    const p = await Sync.reveal(r);
    const el = $(`#ib-${r.id} .meta b`);
    if (el && p) {
      const c = CATEGORIES[p.cat] || { icon: "⚠️", label: p.cat };
      el.innerHTML = `${c.icon} ${c.label} · sev ${p.sev} <span style="color:${sevColor(p.sev)}">●</span>`;
      const ico = $(`#ib-${r.id} .ico`);
      if (ico) {
        if (p.photo) { ico.innerHTML = `<img src="${p.photo}" style="width:40px;height:40px;border-radius:10px;object-fit:cover">`; }
        else ico.textContent = c.icon;
      }
      const span = $(`#ib-${r.id} .meta span`);
      if (span && p.note) span.innerHTML += `<br>“${esc(p.note.slice(0, 70))}”`;
    } else if (el) el.textContent = "⚠️ Unreadable record";
  }
}
async function approveInboxItem(id) {
  const rows = await Sync.pending();
  const row = rows.find(r => r.id === id);
  if (!row) return;
  const res = await Sync.uploadOne(row);
  if (res.ok) {
    adoptUploaded(res.payload);
    toast("☁️ Uploaded to the community map", "good");
  } else if (res.reason === "offline") {
    toast("📴 Offline or sync unavailable — kept encrypted locally", "warn");
  } else if (res.reason === "corrupt") {
    toast("Removed unreadable record", "warn");
  } else {
    toast("Upload failed: " + esc(res.reason), "bad");
  }
  renderInbox(); updateInboxBadge();
}
function adoptUploaded(p) {
  state.hazards.push({
    id: uid(), cat: p.cat, lat: p.lat, lng: p.lng, sev: p.sev,
    status: "unverified", votes: 1, note: p.note || "", mine: true, createdAt: Date.now(),
  });
  state.profile.mapped += 1;
  state.profile.points += 2;
  pushHistory("☁️", `Published ${CATEGORIES[p.cat].label} to the community map`);
  save();
  MapCtl.refreshPins();
}
async function approveAllInbox() {
  const results = await Sync.flush();
  const ok = results.filter(r => r.ok);
  ok.forEach(r => adoptUploaded(r.payload));
  if (ok.length) toast(`☁️ Uploaded ${ok.length} report${ok.length === 1 ? "" : "s"}`, "good");
  const failed = results.length - ok.length;
  if (failed) toast(`📴 ${failed} kept locally (offline or error)`, "warn");
  renderInbox(); updateInboxBadge();
}

/* ================= PIN SHEET / CIVIC ACTIONS ================= */
function openPin(id) {
  const h = allHazards().find(x => x.id === id);
  if (!h) return;
  const c = CATEGORIES[h.cat];
  const z = zoneForPoint(h.lat, h.lng);
  const clearable = h.sev <= 2 && (h.cat === "branch" || h.cat === "dumping") && h.status !== "cleared";
  openSheet(`
    <div class="row">
      <div class="ico" style="width:44px;height:44px;border-radius:11px;display:grid;place-items:center;font-size:21px;background:${c.color};color:#fff">${c.icon}</div>
      <div style="flex:1">
        <h2 style="margin:0">${c.label}</h2>
        <p class="muted">${h.status === "verified" ? "✅ verified" : h.status === "cleared" ? "🧹 cleared" : "🕓 unverified"} · ${h.votes} confirmation${h.votes === 1 ? "" : "s"} · ${fmtAgo(h.createdAt)}</p>
      </div>
      <span style="font-weight:800;color:${sevColor(h.sev)}">${sevLabel(h.sev)}</span>
    </div>
    ${h.note ? `<p class="mt" style="font-size:13.5px;line-height:1.5">“${esc(h.note)}”</p>` : ""}
    <div class="mini mt"><b>GPS</b><span>${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}</span></div>
    ${z ? `<div class="mini mt"><b>Zone</b><span>${esc(z.riskType)} — ${esc(z.title.split("—")[0].trim())}</span></div>` : ""}
    ${h.status !== "cleared" ? `<button class="btn mt" data-act="pin-confirm" data-id="${h.id}">👍 Confirm it's there</button>` : ""}
    <button class="btn accent mt" data-act="pin-email" data-id="${h.id}">✉️ Draft municipal report</button>
    ${clearable ? `<button class="btn ghost mt" data-act="pin-clear" data-id="${h.id}">🧹 I safely cleared this</button>` : ""}
  `);
}
function openCluster(ids) {
  const items = ids.map(id => allHazards().find(h => h.id === id)).filter(Boolean);
  openSheet(`
    <h2>${items.length} reports here</h2>
    <p class="sub">Multiple reports at this location — likely the same hazard.</p>
    ${items.map(h => {
      const c = CATEGORIES[h.cat];
      return `<div class="list-row" data-act="pin-open" data-id="${h.id}" style="cursor:pointer">
        <span style="font-size:17px">${c.icon}</span>
        <span style="flex:1"><b>${c.label}</b> · ${sevLabel(h.sev)}<br><span class="muted">${esc((h.note || "").slice(0, 48))}</span></span>
        <span class="muted">›</span>
      </div>`;
    }).join("")}
  `);
}
function confirmPin(id) {
  const h = state.hazards.find(x => x.id === id);
  if (!h) { toast("Community pin — confirmations sync later", "", 2400); closeSheet(); return; }
  h.votes += 1;
  if (h.votes >= 3 && h.status === "unverified") { h.status = "verified"; toast("✅ Now verified by the community", "good"); }
  else toast("👍 Confirmation added", "good");
  state.profile.points += 1;
  save();
  MapCtl.refreshPins();
  closeSheet();
}

/* ---- Civic email drafter (Novato directory routing) ---- */
function openEmailDraft(id) {
  const h = allHazards().find(x => x.id === id);
  if (!h) return;
  const c = CATEGORIES[h.cat];
  const draft = buildCivicEmail(h, c.label, state.profile.name);
  window._lastDraft = { draft, id };
  openSheet(`
    <h2>✉️ Municipal report</h2>
    <p class="sub">Routed via the official Novato process for this hazard type. <b>Not for emergencies</b> — call ${NOVATO_EMERGENCY.emergency.tel}, or after-hours Public Works at ${NOVATO_EMERGENCY.afterHours.tel}.</p>
    ${draft.to ? `<div class="mini" style="margin-bottom:8px"><b>To</b><span>${draft.to}</span></div>` : `<div class="mini" style="margin-bottom:8px"><b>Route</b><span>Online form only (no direct email for this type)</span></div>`}
    <div class="mini" style="margin-bottom:10px"><b>Subject</b><span>${esc(draft.subject)}</span></div>
    <div class="email-preview">${esc(draft.body)}</div>
    ${draft.mailto ? `<button class="btn accent mt" data-act="email-send">📤 Open in mail app</button>` : ""}
    <a class="btn ghost mt" href="${draft.formUrl}" target="_blank" rel="noopener" data-act="email-form">🌐 Open official reporting form</a>
    <button class="btn ghost mt" data-act="email-copy">📋 Copy text</button>
  `);
}
function sendEmailDraft() {
  const d = window._lastDraft;
  if (!d || !d.draft.mailto) return;
  try { window.location.href = d.draft.mailto; } catch (e) {}
  state.profile.emails += 1;
  state.profile.points += 2;
  pushHistory("✉️", "Drafted a municipal hazard report");
  save();
  closeSheet();
  toast("✉️ Draft opened in your mail app", "good");
}
function copyEmailDraft() {
  const d = window._lastDraft;
  if (!d) return;
  const text = `To: ${d.draft.to || "(use the online form)"}\nSubject: ${d.draft.subject}\n\n${d.draft.body}`;
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast("📋 Copied", "good"))
    .catch(() => toast("Copy manually from the preview", "warn"));
}

/* ---- Community Resolution (clear a minor hazard) ---- */
function openClearing(id) {
  // Liability disclaimer MUST appear before any clearing guidance (spec).
  openSheet(`
    <h2>🧹 Before you touch anything</h2>
    <div class="card" style="background:var(--accent-soft);border-color:var(--accent)">
      <p style="font-size:11.5px;line-height:1.6;user-select:text">${esc(NOVATO_MUNICIPAL_DIRECTORY.disclaimer)}</p>
    </div>
    <p class="muted">Only clear something if it is small, light, away from traffic, and obviously safe — a fallen branch on a flat trail, not a slide area, spill, or anything near cars.</p>
    <button class="btn mt" data-act="clear-accept" data-id="${id}">I understand &amp; accept — continue</button>
    <button class="btn ghost mt" data-act="close-sheet">Cancel</button>
  `);
}
function openClearingStep2(id) {
  if (!state.ageConfirmed) { closeSheet(); openAgeSheet(() => openClearing(id)); return; }
  openSheet(`
    <h2>🧹 Mark as cleared</h2>
    <p class="sub">Take an "after" photo so the community can see it's handled.</p>
    <label class="btn ghost" style="text-align:center">📷 After photo (optional)<input type="file" accept="image/*" capture="environment" id="clearPhoto" style="display:none"></label>
    <p class="muted mt" id="clearPhotoNote"></p>
    <button class="btn mt" data-act="clear-commit" data-id="${id}">✅ Confirm cleared (+1 point)</button>
  `);
  const fi = $("#clearPhoto");
  if (fi) fi.addEventListener("change", () => { $("#clearPhotoNote").textContent = "📷 After photo attached — stored on-device."; });
}
function commitClearing(id) {
  const h = state.hazards.find(x => x.id === id);
  if (h) h.status = "cleared";
  state.profile.cleared += 1;
  state.profile.points += 1; // light gamification: one simple profile point
  pushHistory("🧹", `Cleared a ${h ? CATEGORIES[h.cat].label.toLowerCase() : "hazard"} — thank you`);
  save();
  MapCtl.refreshPins();
  closeSheet();
  toast("🧹 Marked cleared — +1 civic point", "good");
}

/* ================= SETTINGS ================= */
function renderSettings() {
  const s = state.settings;
  const sw = (key, on) => `<div class="switch ${on ? "on" : ""}" data-act="toggle" data-key="${key}"></div>`;
  $("#screen-settings").innerHTML = `
    <h1>Settings</h1>
    <p class="sub">Hardware, power, sync and your civic profile.</p>

    <div class="card">
      <div class="row">
        <div style="width:46px;height:46px;border-radius:50%;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800">${esc(state.profile.name[0] || "n")}</div>
        <div style="flex:1">
          <b style="font-size:15px">${esc(state.profile.name)}</b>
          <p class="muted">${state.profile.points} civic points · ${state.profile.mapped} mapped · ${state.profile.cleared} cleared</p>
        </div>
        <button class="btn ghost sm" data-act="rename">Edit</button>
      </div>
    </div>

    <div class="card">
      <h3>Mode</h3>
      <div class="seg">
        <button class="${s.mode === "bike" ? "on" : ""}" data-act="mode" data-mode="bike">🚲 Bike</button>
        <button class="${s.mode === "walk" ? "on" : ""}" data-act="mode" data-mode="walk">🚶 Walk</button>
      </div>
      <p class="muted mt">Auto-detection arms at riding speeds (6–22 mph). Walk mode focuses on manual capture + proximity voice alerts.</p>
    </div>

    <div class="card">
      <h3>Sync &amp; power</h3>
      <div class="switch-row">
        <div><div class="lbl">Auto-Upload</div><div class="hint">Every 10 minutes, decrypt staged reports and publish to the community database. Off = manual approval in Review.</div></div>
        ${sw("autoUpload", s.autoUpload)}
      </div>
      <div class="switch-row">
        <div><div class="lbl">Low Power Mode</div><div class="hint">Disables the acoustic (sonar) sensor factor entirely to save battery. Fusion runs IMU-only.</div></div>
        ${sw("lowPower", s.lowPower)}
      </div>
      <div class="switch-row">
        <div><div class="lbl">Voice alerts (TTS)</div><div class="hint">Spoken warnings in your headphones when approaching verified hazards.</div></div>
        ${sw("tts", s.tts)}
      </div>
      <div class="switch-row">
        <div><div class="lbl">Dark mode</div></div>
        ${sw("dark", s.dark)}
      </div>
      <div class="switch-row">
        <div><div class="lbl">Alert radius</div><div class="hint">Proximity voice alerts trigger inside this distance.</div></div>
        <input type="number" min="40" max="400" step="10" value="${s.radiusM}" id="radiusInput" style="width:76px;text-align:center">
      </div>
    </div>

    <div class="card">
      <h3>Novato municipal directory</h3>
      <p class="muted" style="margin-bottom:6px">Where each report type is routed. Emergencies: <a href="tel:911"><b>911</b></a> · After-hours Public Works: <a href="tel:4158974361"><b>415-897-4361</b></a></p>
      ${Object.entries(NOVATO_MUNICIPAL_DIRECTORY.routing).map(([k, r]) => `
        <div class="dir-route">
          <b>${k.replace(/_/g, " ")}</b>
          <div class="to">${r.targetEmail || "online form only"}</div>
          <div class="form">${r.contactFormEndpoint}</div>
        </div>`).join("")}
    </div>

    <div class="card">
      <h3>Data</h3>
      <button class="btn ghost sm" data-act="export-csv">⬇️ CSV</button>
      <button class="btn ghost sm mt" data-act="export-geojson">⬇️ GeoJSON</button>
      <button class="btn ghost sm mt" data-act="fetch-community">☁️ Refresh community pins</button>
      <p class="muted mt">Backend: ${Sync.configured ? "Supabase connected" : "not configured"}${Sync.lastError ? ` · last error: ${esc(Sync.lastError)}` : ""}</p>
    </div>

    <div class="card">
      <h3>Demo &amp; diagnostics</h3>
      <p class="muted" style="margin-bottom:8px">Feed synthetic 1-second buffers through the real classifier (desktop validation of the 7-scenario matrix).</p>
      <div class="grid-2">
        <button class="btn ghost sm" data-act="sim" data-s="pothole">🕳️ Pothole</button>
        <button class="btn ghost sm" data-act="sim" data-s="cattle_guard">🐮 Cattle guard</button>
        <button class="btn ghost sm" data-act="sim" data-s="manhole">⭕ Manhole</button>
        <button class="btn ghost sm" data-act="sim" data-s="rut">🚵 Trail rut</button>
        <button class="btn ghost sm" data-act="sim" data-s="branch">🌿 Low branch</button>
        <button class="btn ghost sm" data-act="sim" data-s="speed_bump">🛑 Speed bump</button>
        <button class="btn ghost sm" data-act="sim" data-s="severe">⚠️ Severe fall</button>
        <button class="btn ghost sm" data-act="sim-prox">🔊 Proximity alert</button>
      </div>
      <button class="btn danger sm mt" data-act="reset">Reset app</button>
    </div>

    <p class="muted center" style="padding-bottom:8px">motio · Novato, CA · reports are encrypted on-device (AES-256-GCM)</p>
  `;
  const ri = $("#radiusInput");
  if (ri) ri.addEventListener("change", () => {
    state.settings.radiusM = Math.max(40, Math.min(400, +ri.value || 120));
    save();
  });
}

/* ---- exports ---- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`⬇️ Exported ${name}`, "good");
}
function exportCSV() {
  const rows = [["id", "type", "severity", "status", "lat", "lng", "zone", "note", "created"]];
  for (const h of allHazards()) {
    const z = zoneForPoint(h.lat, h.lng);
    rows.push([h.id, h.cat, h.sev, h.status, h.lat, h.lng, z ? z.id : "", `"${(h.note || "").replace(/"/g, '""')}"`, new Date(h.createdAt).toISOString()]);
  }
  download("motio-hazards.csv", rows.map(r => r.join(",")).join("\n"), "text/csv");
}
function exportGeoJSON() {
  const fc = {
    type: "FeatureCollection",
    features: allHazards().map(h => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      properties: { id: h.id, type: h.cat, severity: h.sev, status: h.status, note: h.note || "", created: new Date(h.createdAt).toISOString() },
    })),
  };
  download("motio-hazards.geojson", JSON.stringify(fc, null, 2), "application/geo+json");
}

/* ================= ONBOARDING ================= */
const SLIDES = [
  {
    art: `<div class="wordmark" style="font-size:44px">mot<span class="wm-i">ı<span class="wm-dot" style="width:12px;height:12px;top:-12px"></span></span>o</div>`,
    h: "Welcome to motio",
    p: "Novato's community network for road & trail hazards. Ride or walk — your phone's sensors map what needs fixing.",
  },
  {
    art: "🔐",
    h: "Private by design",
    p: "Detections stage on your phone encrypted with AES-256-GCM. Nothing uploads until a 10-minute timer (or you) approves it — and you get a 10-second cancel window on every auto-detection.",
  },
  {
    art: "🎂",
    h: "Age check",
    p: "motio involves being on public roads and trails. Please confirm you're 13 or older.",
    btn: { label: "✅ I'm 13 or older", act: "onb-age" },
  },
  {
    art: "⚖️",
    h: "Safety waiver",
    waiver: true,
    p: "",
    btn: { label: "I accept the waiver", act: "onb-waiver" },
  },
];
let onbIdx = 0;
function startOnboarding() {
  onbIdx = 0;
  $("#onb").classList.add("show");
  renderOnb();
}
function renderOnb() {
  const sl = SLIDES[onbIdx];
  $("#onbSlides").innerHTML = `
    <div class="slide active">
      <div class="art">${sl.art}</div>
      <h2>${sl.h}</h2>
      ${sl.waiver ? `<div class="waiver-box">${esc(NOVATO_MUNICIPAL_DIRECTORY.disclaimer)}<br><br>Do not use motio for emergencies. Life-threatening: call 911. After-hours Public Works (e.g. downed tree blocking a street): 415-897-4361.</div>` : `<p>${sl.p}</p>`}
      ${sl.btn ? (() => {
        const done = sl.btn.act === "onb-age" ? state.ageConfirmed : state.waiverAccepted;
        return `<button class="btn ${done ? "ghost" : ""}" style="max-width:280px" data-act="${sl.btn.act}">${done ? "✅ Done" : sl.btn.label}</button>`;
      })() : ""}
    </div>`;
  $("#onbDots").innerHTML = SLIDES.map((_, i) => `<i class="${i === onbIdx ? "on" : ""}"></i>`).join("");
  $("#onbNext").textContent = onbIdx === SLIDES.length - 1 ? "Finish" : "Next";
}
function onbNext() {
  if (onbIdx < SLIDES.length - 1) { onbIdx++; renderOnb(); }
  else finishOnboarding();
}
function finishOnboarding() {
  state.onboarded = true;
  save();
  $("#onb").classList.remove("show");
  renderHome();
}

/* Enforcement sheets (when skipped during onboarding). */
function openAgeSheet(cb) {
  window._afterAge = cb || null;
  openSheet(`
    <h2>🎂 Quick age check</h2>
    <p class="sub">This action requires confirming you're 13 or older.</p>
    <button class="btn" data-act="age-confirm">✅ I'm 13 or older</button>
    <button class="btn ghost mt" data-act="close-sheet">Not now</button>
  `);
}
function openWaiverSheet(cb) {
  window._afterWaiver = cb || null;
  openSheet(`
    <h2>⚖️ Safety waiver</h2>
    <div class="card" style="max-height:220px;overflow-y:auto"><p style="font-size:11.5px;line-height:1.6;user-select:text">${esc(NOVATO_MUNICIPAL_DIRECTORY.disclaimer)}</p></div>
    <p class="muted">Emergencies: 911. After-hours Public Works: 415-897-4361.</p>
    <button class="btn mt" data-act="waiver-accept">I understand &amp; accept</button>
    <button class="btn ghost mt" data-act="close-sheet">Not now</button>
  `);
}

/* ================= Sheet system ================= */
let _sheetCleanup = null;
function openSheet(html, onClose) {
  _sheetCleanup = onClose || null;
  $("#sheet").innerHTML = `<div class="grab" data-act="close-sheet"></div>` + html;
  $("#sheet").classList.add("show");
  $("#scrim").classList.add("show");
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  $("#scrim").classList.remove("show");
  if (_sheetCleanup) { try { _sheetCleanup(); } catch (e) {} _sheetCleanup = null; }
}

/* ================= Global event delegation ================= */
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const act = t.dataset.act;

  switch (act) {
    case "tab": showScreen(t.dataset.tab); break;
    case "close-sheet": closeSheet(); break;

    case "start-track": startTracking(); break;
    case "end-track": endTracking(); break;

    case "filter":
      state.filters[t.dataset.cat] = !state.filters[t.dataset.cat];
      save(); renderFilterChips(); MapCtl.refreshPins();
      break;
    case "map-locate": {
      const pos = await Sensors.getPosition();
      if (pos && MapCtl.map) { MapCtl.map.flyTo([pos.lat, pos.lng], 16); MapCtl.updateMe(pos); checkProximity(pos); }
      else toast("Location unavailable", "warn");
      break;
    }
    case "map-zones":
      MapCtl.showZones = !MapCtl.showZones;
      MapCtl.drawZones();
      toast(MapCtl.showZones ? "▦ Risk corridors shown" : "▦ Risk corridors hidden");
      break;
    case "map-offline":
      state.settings.offline = !state.settings.offline;
      save();
      $("#offlineBtn").textContent = MapCtl.isOffline() ? "📴" : "📶";
      toast(state.settings.offline ? "📴 Offline tiles — serving from cache" : "📶 Online tiles", "", 2200);
      if (MapCtl.tiles) MapCtl.tiles.redraw();
      break;

    case "pin-open": closeSheet(); setTimeout(() => openPin(t.dataset.id), 240); break;
    case "pin-confirm": confirmPin(t.dataset.id); break;
    case "pin-email": closeSheet(); setTimeout(() => openEmailDraft(t.dataset.id), 240); break;
    case "pin-clear": closeSheet(); setTimeout(() => openClearing(t.dataset.id), 240); break;
    case "clear-accept": closeSheet(); setTimeout(() => openClearingStep2(t.dataset.id), 240); break;
    case "clear-commit": commitClearing(t.dataset.id); break;
    case "email-send": sendEmailDraft(); break;
    case "email-copy": copyEmailDraft(); break;
    case "email-form":
      state.profile.points += 1; pushHistory("🌐", "Opened an official reporting form"); save();
      break;

    case "cap-snap": snapCapturePhoto(); break;
    case "cap-cat": Capture.cat = t.dataset.cat; renderCapPickers(); break;
    case "cap-sev": Capture.sev = +t.dataset.sev; renderCapPickers(); break;
    case "cap-dictate": toggleDictation(); break;
    case "cap-save": saveCapture(); break;

    case "inbox-approve": approveInboxItem(t.dataset.id); break;
    case "inbox-discard":
      await Sync.discard(t.dataset.id);
      toast("🗑️ Discarded (never uploaded)");
      renderInbox(); updateInboxBadge();
      break;
    case "inbox-approve-all": approveAllInbox(); break;
    case "inbox-sync-now": approveAllInbox(); break;

    case "toggle": {
      const k = t.dataset.key;
      state.settings[k] = !state.settings[k];
      save();
      t.classList.toggle("on", state.settings[k]);
      if (k === "dark") applyTheme();
      if (k === "autoUpload" && state.settings.autoUpload) Sync.flushIfAuto();
      break;
    }
    case "mode":
      state.settings.mode = t.dataset.mode;
      save();
      $("#modeChip").textContent = state.settings.mode;
      renderSettings();
      break;
    case "rename": {
      const n = prompt("Display name", state.profile.name);
      if (n && n.trim()) { state.profile.name = n.trim().slice(0, 24); save(); renderSettings(); }
      break;
    }
    case "export-csv": exportCSV(); break;
    case "export-geojson": exportGeoJSON(); break;
    case "fetch-community": {
      toast("☁️ Fetching community reports…");
      const remote = await Sync.fetchCommunity();
      window._remoteHazards = remote;
      toast(remote.length ? `☁️ ${remote.length} community reports loaded` : "No community reports yet (or offline)", remote.length ? "good" : "warn");
      MapCtl.refreshPins();
      break;
    }
    case "sim": {
      const r = Engine.simulate(t.dataset.s);
      if (r && r.action === "log") { /* onDetect fired the cancel overlay */ }
      break;
    }
    case "sim-prox": {
      const h = allHazards().find(x => x.status === "verified");
      if (h) {
        Track._alerted.delete(h.id);
        checkProximity({ lat: h.lat + 0.0004, lng: h.lng });
      }
      break;
    }
    case "reset":
      if (confirm("Reset motio? Local reports, points and settings will be wiped.")) {
        localStorage.removeItem(STORE_KEY);
        localStorage.removeItem("motio.vault.jwk");
        indexedDB.deleteDatabase("motio-vault");
        indexedDB.deleteDatabase("motio-tiles");
        location.reload();
      }
      break;

    case "onb-age": state.ageConfirmed = true; save(); renderOnb(); break;
    case "onb-waiver": state.waiverAccepted = true; save(); renderOnb(); break;
    case "age-confirm": {
      state.ageConfirmed = true; save(); closeSheet();
      const cb = window._afterAge; window._afterAge = null;
      if (cb) setTimeout(cb, 240);
      break;
    }
    case "waiver-accept": {
      state.waiverAccepted = true; save(); closeSheet();
      const cb = window._afterWaiver; window._afterWaiver = null;
      if (cb) setTimeout(cb, 240);
      break;
    }
  }
});

/* Non-delegated singletons */
$("#fab").addEventListener("click", () => {
  if (Track.active) { toast("⛔ End tracking first", "warn"); return; }
  openCapture();
});
$("#darkBtn").addEventListener("click", () => {
  state.settings.dark = !state.settings.dark;
  save(); applyTheme();
  if (currentScreen === "settings") renderSettings();
});
$("#scrim").addEventListener("click", closeSheet);
$("#cancelBtn").addEventListener("click", () => {
  hideCancelOverlay(true);
  toast("✖ Detection cancelled — nothing was saved");
});
$("#beaconDismiss").addEventListener("click", hideBeacon);
$("#onbSkip").addEventListener("click", finishOnboarding);
$("#onbNext").addEventListener("click", onbNext);

/* ================= Boot ================= */
function boot() {
  applyTheme();
  $("#modeChip").textContent = state.settings.mode;
  wireEngine();
  Sync.init();
  Sync.onChange = () => { updateInboxBadge(); if (currentScreen === "inbox") renderInbox(); };
  Sync.startLoop();          // the 10-minute auto-upload loop
  updateInboxBadge();
  renderHome();
  if (!state.onboarded) startOnboarding();
  // Background community pull (non-blocking; fails silently offline).
  Sync.fetchCommunity().then(remote => {
    if (remote.length) { window._remoteHazards = remote; MapCtl.refreshPins(); }
  });
}
boot();
