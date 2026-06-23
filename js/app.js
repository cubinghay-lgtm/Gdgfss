/* ============================================================
   app.js — PulsePath application controller.
   State, navigation, rendering and all feature wiring.
   ============================================================ */

/* ---------------- State ---------------- */
const STORE_KEY = "pulsepath.v1";

const DEFAULT_STATE = () => ({
  onboarded: false,
  ageConfirmed: false,
  hazards: SEED_HAZARDS.map(h => ({ ...h })),
  queue: SEED_QUEUE.map(q => ({ ...q })),
  filters: { pothole: true, rut: true, debris: true, wildlife: true, flood: true, other: true },
  settings: {
    dark: false, radius: 35, threshold: 13.8, voice: false, tts: true,
    battery: true, mode: "bike", calibrated: false, weather: "clear",
  },
  profile: { name: "River Rider", photo: null, mapped: 3, verified: 5, carbon: 2.4, emails: 0, miles: 42 },
  district: { miles: 1284 },
  me: { x: 41, y: 44 },
});

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(DEFAULT_STATE(), JSON.parse(raw));
  } catch (e) {}
  return DEFAULT_STATE();
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

/* ---------------- Tiny DOM helpers ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmtTime = (ts) => {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
};
const sevColors = ["#6a994e", "#a7c957", "#f2c14e", "#ff8a3d", "#e4572e"];
const sevColor = (n) => sevColors[clamp(n, 1, 5) - 1];
const sevLabel = (n) => ["", "Minor", "Low", "Moderate", "High", "Severe"][clamp(n, 1, 5)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const uid = () => "x" + Math.random().toString(36).slice(2, 9);

/* ---------------- Navigation ---------------- */
let currentScreen = "home";
const TAB_SCREENS = ["home", "map", "inbox", "profile"];

function showScreen(name) {
  currentScreen = name;
  $$(".screen").forEach(s => s.classList.toggle("active", s.id === "screen-" + name));
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  // back arrow for sub-screens
  $("#backBtn").style.display = TAB_SCREENS.includes(name) ? "none" : "grid";
  renderScreen(name);
  $(".screens").scrollTop = 0;
  const sc = $("#screen-" + name); if (sc) sc.scrollTop = 0;
}

function renderScreen(name) {
  ({
    home: renderHome, map: renderMap, track: renderTrack,
    inbox: renderInbox, profile: renderProfile, settings: renderSettings,
  }[name] || (() => {}))();
}

/* ---------------- Toast + mascot ---------------- */
function toast(msg, kind = "", ms = 2600) {
  const w = $("#toasts");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.innerHTML = msg;
  w.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, ms);
}
function mascot(line) {
  const m = $("#mascot");
  m.querySelector("b").textContent = line || OTTER_LINES[Math.floor(Math.random() * OTTER_LINES.length)];
  m.classList.add("show");
  setTimeout(() => m.classList.remove("show"), 2600);
}

/* ---------------- Theme + mode pill ---------------- */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.settings.dark ? "dark" : "light");
  $("#darkIcon").textContent = state.settings.dark ? "🌙" : "☀️";
}
const MODE_META = {
  bike:   { icon: "🚲", label: "Bike Mode" },
  walk:   { icon: "🚶", label: "Walk Mode" },
  patrol: { icon: "📷", label: "Patrol Mode" },
  drive:  { icon: "🚗", label: "Drive Mode" },
};
function refreshModePill() {
  const m = MODE_META[state.settings.mode];
  $("#modePill").innerHTML = `${m.icon} ${m.label}`;
}

/* ============================================================
   HOME
   ============================================================ */
function renderHome() {
  const p = state.profile;
  const totalPins = state.hazards.length;
  const unv = state.hazards.filter(h => h.status === "unverified").length;
  const goal = 50, contrib = p.mapped + p.verified;
  const w = state.settings.weather;
  const wo = WEATHER_STATES.find(x => x.id === w);

  $("#screen-home").innerHTML = `
    <div class="card hero">
      <span class="otter">🦦</span>
      <h2>Hey ${p.name.split(" ")[0]} 👋</h2>
      <p>Marin's roads & trails are a little safer thanks to you.</p>
      <div class="stat-row">
        <div class="stat"><b>${p.mapped}</b><span>hazards mapped</span></div>
        <div class="stat"><b>${p.verified}</b><span>reports verified</span></div>
        <div class="stat"><b>${p.carbon.toFixed(1)}kg</b><span>CO₂ offset</span></div>
      </div>
      <div class="progress"><i style="width:${Math.min(100, contrib / goal * 100)}%"></i></div>
      <p style="margin-top:8px;font-size:11px">${contrib}/${goal} to your next milestone</p>
    </div>

    <button class="btn accent" data-act="go-track" style="margin-bottom:14px;font-size:15px;padding:16px">
      ▶  Start ${MODE_META[state.settings.mode].label} tracking
    </button>

    <div class="section-label">Choose your mode</div>
    <div class="mode-grid">
      ${Object.entries(MODE_META).map(([k, m]) => `
        <button class="mode-card ${state.settings.mode === k ? "sel" : ""}" data-act="set-mode" data-mode="${k}">
          <span class="emoji">${m.icon}</span>
          <b>${m.label}</b>
          <span>${modeBlurb(k)}</span>
        </button>`).join("")}
    </div>

    <div class="grid-2 mt">
      <div class="mini"><b>${totalPins}</b><span>active hazard pins</span></div>
      <div class="mini"><b>${unv}</b><span>need verification near you</span></div>
    </div>

    <div class="card mt" style="background:linear-gradient(135deg,var(--sky),#2f80ed);color:#fff;border:none">
      <h3 style="color:#fff">🌍 District Progress</h3>
      <p class="sub" style="color:rgba(255,255,255,.85)">Mapped by all PulsePath users across the district</p>
      <div style="font-size:30px;font-weight:800;margin-top:6px">${state.district.miles.toLocaleString()} mi</div>
      <div class="kpi-bar"><i style="width:64%;background:#fff"></i></div>
      <p style="font-size:11px;margin-top:6px;opacity:.85">64% toward the 2,000 mi county goal</p>
    </div>

    <div class="card" data-act="cycle-weather" style="cursor:pointer">
      <div class="flex"><span style="font-size:26px">${wo.icon}</span>
        <div><h3>${wo.label}</h3><p class="sub">${wo.note} · tap to preview overlay</p></div></div>
    </div>

    <div class="card" data-act="open-clearing">
      <div class="flex"><span style="font-size:26px">🧹</span>
        <div><h3>Safe Clearing Guide</h3><p class="sub">How to safely move a loose branch (13+)</p></div></div>
    </div>

    <div class="card" data-act="go-settings">
      <div class="flex"><span style="font-size:26px">⚙️</span>
        <div><h3>Settings & data export</h3><p class="sub">Proximity, battery saver, dark mode, CSV / GeoJSON</p></div></div>
    </div>

    <p class="center muted" style="font-size:11px;margin-top:8px">PulsePath · prototype build · sensors simulate on desktop</p>
  `;
}
function modeBlurb(k) {
  return { bike: "Pulse impact logging", walk: "Health-app steps", patrol: "Camera anomaly watch", drive: "CO₂ commute nudge" }[k];
}

/* ============================================================
   MAP
   ============================================================ */
function visibleHazards() {
  return state.hazards.filter(h => state.filters[h.cat]);
}
function clusterHazards(list) {
  const used = new Set(), clusters = [];
  for (let i = 0; i < list.length; i++) {
    if (used.has(i)) continue;
    const group = [list[i]]; used.add(i);
    for (let j = i + 1; j < list.length; j++) {
      if (used.has(j)) continue;
      if (list[i].cat === list[j].cat && dist(list[i], list[j]) < 5) { group.push(list[j]); used.add(j); }
    }
    clusters.push(group);
  }
  return clusters;
}
function mapZone() {
  // Hybrid auto-switch: south/east region is forest/trail -> topo.
  return (state.me.x > 52 || state.me.y > 56) ? "topo" : "urban";
}
const ringUnits = () => clamp(state.settings.radius * 0.16, 3, 22);

function renderMap() {
  const zone = mapZone();
  const clusters = clusterHazards(visibleHazards());
  const wo = WEATHER_STATES.find(x => x.id === state.settings.weather);

  const pinsHtml = clusters.map(group => {
    if (group.length > 1) {
      const cx = group.reduce((s, g) => s + g.x, 0) / group.length;
      const cy = group.reduce((s, g) => s + g.y, 0) / group.length;
      return `<div class="pin cluster" style="left:${cx}%;top:${cy}%" data-act="open-cluster" data-cat="${group[0].cat}">
        <div class="bubble" style="background:${CATEGORIES[group[0].cat].color}"><span>${group.length}</span></div></div>`;
    }
    const h = group[0];
    return `<div class="pin ${h.status}" style="left:${h.x}%;top:${h.y}%" data-act="open-pin" data-id="${h.id}">
      <div class="bubble" style="background:${CATEGORIES[h.cat].color}"><span>${CATEGORIES[h.cat].icon}</span></div></div>`;
  }).join("");

  const filterChips = Object.entries(CATEGORIES).map(([k, c]) => `
    <button class="chip ${state.filters[k] ? "" : "off"}" data-act="toggle-filter" data-cat="${k}">
      <span class="dot" style="background:${c.color}"></span>${c.label}</button>`).join("");

  const ru = ringUnits();
  $("#screen-map").innerHTML = `
    <div class="map-wrap">
      <div class="map-canvas ${zone}" id="mapCanvas" data-act="map-tap">
        <svg class="map-deco" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M0,40 Q30,30 50,45 T100,38" stroke="${zone === "urban" ? "#9fb0bd" : "#9cc08a"}" stroke-width="2.2" fill="none"/>
          <path d="M20,0 L34,100" stroke="#aebcc7" stroke-width="3" fill="none" opacity=".5"/>
          <path d="M60,10 Q70,50 55,100" stroke="#9cc08a" stroke-width="2" fill="none" stroke-dasharray="3 3"/>
        </svg>
        <div class="radius-ring" style="left:${state.me.x}%;top:${state.me.y}%;width:${ru * 2}%;height:${ru * 2}%"></div>
        <div class="me-dot" style="left:${state.me.x}%;top:${state.me.y}%"></div>
        ${pinsHtml}
      </div>

      <div class="map-top">${filterChips}</div>

      <button class="chip weather-badge" data-act="cycle-weather">${wo.icon} ${wo.label}</button>

      <div class="map-legend">${zone === "urban" ? "🏙️ Street view" : "⛰️ Topographic"} · ${visibleHazards().length} pins</div>

      <div style="position:absolute;right:12px;bottom:14px;z-index:10;display:flex;flex-direction:column;gap:8px">
        <button class="icon-btn" style="background:var(--surface);box-shadow:var(--shadow-sm)" data-act="locate-me" title="Find me">📍</button>
        <button class="icon-btn" style="background:var(--surface);box-shadow:var(--shadow-sm)" data-act="sim-ride" title="Simulate ride">🛰️</button>
      </div>
    </div>`;
}

function openPin(id) {
  const h = state.hazards.find(x => x.id === id);
  if (!h) return;
  const c = CATEGORIES[h.cat];
  const d = (dist(state.me, h) * 150).toFixed(0); // ~150m per map unit
  openSheet(`
    <div class="flex" style="gap:14px">
      <div class="inbox-item" style="margin:0;border:none;padding:0">
        <div class="thumb" style="width:60px;height:60px;background:${c.color}22">${c.icon}</div>
      </div>
      <div style="flex:1">
        <h2>${c.label}</h2>
        <div class="sub">${h.note || c.hint}</div>
        <div class="tag-list">
          <span class="badge ${h.status === "verified" ? "ver" : "unv"}">${h.status}</span>
          <span class="badge" style="background:${sevColor(h.sev)}22;color:${sevColor(h.sev)}">Sev ${h.sev} · ${sevLabel(h.sev)}</span>
        </div>
      </div>
    </div>
    <div class="grid-3 mt">
      <div class="mini"><b>${h.votes}</b><span>confirms</span></div>
      <div class="mini"><b>${d}m</b><span>away</span></div>
      <div class="mini"><b>${fmtTime(h.createdAt)}</b><span>reported</span></div>
    </div>
    <div class="mini" style="margin-top:12px"><b style="font-size:13px">📍 ${h.lat}, ${h.lng}</b><span>Auto-GPS tagged</span></div>
    <div class="btn-row mt">
      <button class="btn" data-act="confirm-pin" data-id="${h.id}">✅ Still here</button>
      <button class="btn ghost" data-act="speak-pin" data-id="${h.id}">🔊 Read aloud</button>
    </div>
    <div class="btn-row mt">
      <button class="btn accent" data-act="draft-email" data-id="${h.id}">✉️ Draft city email</button>
      <button class="btn ghost" data-act="rate-pin" data-id="${h.id}">⭐ Rate severity</button>
    </div>
    ${h.cat === "debris" ? `<button class="btn ghost mt" data-act="open-clearing">🧹 Safe clearing guide</button>` : ""}
    <button class="btn danger mt" data-act="delete-pin" data-id="${h.id}">🗑️ Remove pin</button>
  `, c.label);
}

function openCluster(cat) {
  const items = state.hazards.filter(h => h.cat === cat && state.filters[h.cat]);
  openSheet(`
    <h2>${CATEGORIES[cat].icon} ${CATEGORIES[cat].label} cluster</h2>
    <p class="sub">${items.length} reports bundled into one map pin to keep things tidy.</p>
    ${items.map(h => `
      <div class="inbox-item" data-act="open-pin" data-id="${h.id}">
        <div class="thumb" style="background:${CATEGORIES[cat].color}22">${CATEGORIES[cat].icon}</div>
        <div class="meta"><b>${h.note || CATEGORIES[cat].label}</b>
          <span>Sev ${h.sev} · ${h.votes} confirms · ${fmtTime(h.createdAt)}</span></div>
        <span class="badge ${h.status === "verified" ? "ver" : "unv"}">${h.status}</span>
      </div>`).join("")}
  `, "Cluster");
}

/* ============================================================
   TRACK / MODES  (Bike pulse, Walk health, Patrol cam, Drive)
   ============================================================ */
let tracking = { on: false, raf: null, samples: [], lastPulse: 0 };

function renderTrack() {
  const mode = state.settings.mode;
  const m = MODE_META[mode];
  $("#screen-track").innerHTML = `
    <div class="section-label">Active mode</div>
    <div class="mode-grid" style="margin-bottom:14px">
      ${Object.entries(MODE_META).map(([k, mm]) => `
        <button class="mode-card ${mode === k ? "sel" : ""}" data-act="set-mode" data-mode="${k}" data-stay="track">
          <span class="emoji">${mm.icon}</span><b>${mm.label}</b><span>${modeBlurb(k)}</span></button>`).join("")}
    </div>
    <div id="modePanel"></div>
  `;
  renderModePanel();
}

function renderModePanel() {
  const panel = $("#modePanel");
  if (!panel) return;
  const mode = state.settings.mode;
  if (mode === "bike") panel.innerHTML = bikePanel();
  else if (mode === "walk") panel.innerHTML = walkPanel();
  else if (mode === "patrol") panel.innerHTML = patrolPanel();
  else panel.innerHTML = drivePanel();

  if (mode === "bike" && tracking.on) drawMeter();
}

function bikePanel() {
  return `
    <div class="card">
      <h3>🚲 Bike Pulse Engine</h3>
      <p class="sub">Mount your phone on the handlebars. PulsePath watches the accelerometer for sudden vertical & lateral impacts (potholes, ruts) and auto-tags GPS.</p>
      <div class="meter mt" id="meter"></div>
      <div class="flex" style="justify-content:space-between;margin-top:10px">
        <div><div class="big-reading" id="reading">0.0</div><span class="muted" style="font-size:11px">live g-force</span></div>
        <div class="center"><div style="font-weight:800;font-size:18px;color:var(--accent)">${state.settings.threshold.toFixed(1)}</div><span class="muted" style="font-size:11px">trip threshold</span></div>
      </div>
      <div class="btn-row mt">
        <button class="btn ${tracking.on ? "danger" : ""}" data-act="toggle-track">${tracking.on ? "⏹ Stop tracking" : "▶ Start tracking"}</button>
        <button class="btn ghost" data-act="sim-pulse">⚡ Simulate hit</button>
      </div>
      <button class="btn ghost mt" data-act="calibrate">🎚️ ${state.settings.calibrated ? "Re-run" : "Run"} calibration wizard</button>
      <p class="muted center" style="font-size:11px;margin-top:8px">${Sensors.motionSupported ? "Motion sensor detected ✓" : "No motion sensor — use Simulate hit"}</p>
    </div>
    ${terrainCard()}`;
}
function terrainCard() {
  return `<div class="card">
      <h3>🏔️ Continuous Terrain Calibration</h3>
      <p class="sub">A filtering loop separates smooth, sustained elevation change (long downhill) from short impact spikes — so a steep West Marin descent doesn't corrupt the map.</p>
      <div class="kpi-bar mt"><i style="width:72%;background:var(--brand)"></i><i style="width:14%;background:var(--accent)"></i></div>
      <div class="flex" style="justify-content:space-between;margin-top:6px;font-size:11px" class="muted">
        <span class="muted">🟢 Smooth terrain 72%</span><span class="muted">🟠 Impact spikes 14%</span></div>
    </div>`;
}

function walkPanel() {
  const connected = state._healthConnected;
  return `
    <div class="card">
      <h3>🚶 Walk Mode</h3>
      <p class="sub">Instead of an error-prone custom step sensor, Walk Mode pulls clean stats from the native health framework (Apple HealthKit / Google Fit).</p>
      ${connected ? `
        <div class="grid-3 mt">
          <div class="mini"><b>6,418</b><span>steps today</span></div>
          <div class="mini"><b>2.9 mi</b><span>distance</span></div>
          <div class="mini"><b>312</b><span>kcal</span></div>
        </div>
        <p class="muted center" style="font-size:11px;margin-top:10px">Synced from HealthKit · 2m ago</p>` : `
        <button class="btn mt" data-act="connect-health"> Connect Apple Health / Google Fit</button>
        <p class="muted center" style="font-size:11px;margin-top:8px">Native bridge — demo connect on web</p>`}
    </div>
    <div class="card">
      <h3>🔊 Audio Hazard Readouts</h3>
      <p class="sub">Hands-free TTS announces upcoming dangers into your headphones as you walk.</p>
      <button class="btn ghost mt" data-act="demo-tts">▶ Preview a readout</button>
    </div>`;
}

function patrolPanel() {
  return `
    <div class="card">
      <h3>📷 Visual Patrol Mode</h3>
      <p class="sub">Arm-mount or dash-mount your phone. The camera watches for structural anomalies & road blocks and pings you to document them.</p>
      <div class="photo-drop mt" id="patrolView"><span class="e">📹</span><span>Camera preview appears here</span></div>
      <div class="btn-row mt">
        <button class="btn" data-act="start-patrol">▶ Start camera watch</button>
        <button class="btn ghost" data-act="stop-patrol">⏹ Stop</button>
      </div>
      <button class="btn ghost mt" data-act="sim-anomaly">🔍 Simulate anomaly detection</button>
    </div>
    <div class="card">
      <h3>🪄 Trail AR Discovery</h3>
      <p class="sub">Hold up the camera on a trail to see floating markers where community members safely cleared a past obstacle.</p>
      <button class="btn ghost mt" data-act="start-patrol">Open AR layer</button>
    </div>`;
}

function drivePanel() {
  return `
    <div class="card">
      <h3>🚗 Passive Speed Interceptor</h3>
      <p class="sub">Running quietly in the background, PulsePath notices vehicle-speed travel and sends a friendly next-morning nudge showing the CO₂ you'd save biking that distance.</p>
      <button class="btn mt" data-act="sim-drive">🚙 Simulate a 6-mile drive</button>
    </div>
    <div class="card">
      <h3>🔋 Battery Optimization Saver</h3>
      <p class="sub">Below 20% on a remote trail, GPS sampling scales back and camera scanning pauses automatically.</p>
      <div class="row" style="padding-top:4px"><div class="label"><b>Battery saver</b><span>Auto-throttle under 20%</span></div>
        <span class="spacer"></span>
        <label class="switch"><input type="checkbox" data-toggle="battery" ${state.settings.battery ? "checked" : ""}><span class="track"></span></label></div>
    </div>`;
}

/* --- Pulse meter rendering --- */
function drawMeter() {
  const meter = $("#meter");
  if (!meter) return;
  meter.innerHTML = "";
  const bars = 40;
  for (let i = 0; i < bars; i++) {
    const b = document.createElement("div");
    b.className = "bar";
    b.style.height = "2px";
    meter.appendChild(b);
  }
  const line = document.createElement("div");
  line.className = "threshold-line";
  const pct = clamp((state.settings.threshold - 8) / 8, 0, 1);
  line.style.bottom = (8 + pct * 92) + "%";
  meter.appendChild(line);
}
function pushMeter(mag) {
  const meter = $("#meter");
  const reading = $("#reading");
  if (reading) reading.textContent = mag.toFixed(1);
  if (!meter) return;
  const bars = $$(".bar", meter);
  if (!bars.length) return;
  // shift left
  for (let i = 0; i < bars.length - 1; i++) bars[i].style.height = bars[i + 1].style.height;
  const h = clamp((mag - 6) / 18 * 100, 2, 100);
  const last = bars[bars.length - 1];
  last.style.height = h + "%";
  last.style.background = mag >= state.settings.threshold ? "var(--accent)" : "var(--brand)";
}

/* --- Tracking control --- */
async function toggleTrack() {
  if (tracking.on) { stopTrack(); return; }
  tracking.on = true; tracking.samples = [];
  renderModePanel();
  toast("🚲 Tracking started — ride safe!", "good");
  const ok = await Sensors.startMotion(onMotionSample);
  if (!ok) {
    // Desktop fallback: synthesize gentle road noise so the meter lives.
    tracking.fakeTimer = setInterval(() => {
      const noise = 9.8 + (Math.random() - 0.5) * 2.4;
      onMotionSample(noise);
    }, 90);
  }
}
function stopTrack() {
  tracking.on = false;
  Sensors.stopMotion();
  if (tracking.fakeTimer) { clearInterval(tracking.fakeTimer); tracking.fakeTimer = null; }
  renderModePanel();
  toast("⏹ Tracking stopped");
}
function onMotionSample(mag) {
  pushMeter(mag);
  // Detect an impact above the trip threshold (debounced).
  if (mag >= state.settings.threshold && Date.now() - tracking.lastPulse > 1400) {
    tracking.lastPulse = Date.now();
    logPulse(mag);
  }
}
function logPulse(mag) {
  Sensors.buzz([40, 30, 40]);
  const g = (mag / 9.8).toFixed(1);
  const item = {
    id: uid(), type: "pulse", cat: "pothole", sev: clamp(Math.round((mag - 10) / 2) + 2, 1, 5),
    x: clamp(state.me.x + (Math.random() - 0.5) * 3, 4, 96),
    y: clamp(state.me.y + (Math.random() - 0.5) * 3, 6, 94),
    createdAt: Date.now(), note: `Auto-logged impact ${g}g`,
  };
  Object.assign(item, xyToGeo(item.x, item.y));
  state.queue.unshift(item);
  save();
  updateInboxBadge();
  toast(`⚡ Impact logged (${g}g) → review queue`, "alert");
  if (state.settings.tts) Sensors.speak("Hazard logged");
}

/* ============================================================
   CAPTURE SHEET  (One-tap quick capture)
   ============================================================ */
let draft = null;
function openCapture(presetXY) {
  draft = {
    cat: "pothole", sev: 3, photo: null,
    x: presetXY ? presetXY.x : state.me.x,
    y: presetXY ? presetXY.y : state.me.y,
    note: "",
  };
  renderCapture();
  openSheet(null, "Quick Capture", "capture");
}
function renderCapture() {
  const geo = xyToGeo(draft.x, draft.y);
  setSheet(`
    <h2>📸 Quick Capture</h2>
    <p class="sub">Snap a hazard — GPS is auto-tagged and it lands in your review queue.</p>

    <div class="photo-drop" data-act="pick-photo">
      ${draft.photo ? `<img src="${draft.photo}">` : `<span class="e">📷</span><span>Tap to take / choose photo</span>`}
    </div>
    <input type="file" id="photoInput" accept="image/*" capture="environment" hidden>

    <div class="section-label" style="margin-top:14px">Category</div>
    <div class="cat-pick">
      ${Object.entries(CATEGORIES).map(([k, c]) => `
        <button class="cat-opt ${draft.cat === k ? "sel" : ""}" data-act="draft-cat" data-cat="${k}">
          <span class="e">${c.icon}</span><small>${c.label}</small></button>`).join("")}
    </div>

    <div class="section-label">Severity</div>
    <div class="sev-pick">
      ${[1, 2, 3, 4, 5].map(n => `
        <button class="sev-opt ${draft.sev === n ? "sel" : ""}" data-act="draft-sev" data-sev="${n}"
          style="${draft.sev === n ? `background:${sevColor(n)}` : ""}">${n}</button>`).join("")}
    </div>
    <p class="muted center" style="font-size:11px">${sevLabel(draft.sev)}</p>

    <div class="mini" style="margin-top:12px"><b style="font-size:13px">📍 ${geo.lat}, ${geo.lng}</b><span>Auto-GPS tagged · ${Sensors.geoSupported ? "live GPS available" : "demo coords"}</span></div>

    <button class="btn accent mt" data-act="save-capture">Save to review queue</button>
  `);
}

/* ============================================================
   INBOX  (Local verification review log)
   ============================================================ */
function updateInboxBadge() {
  const n = state.queue.length;
  const b = $("#inboxBadge");
  b.style.display = n ? "grid" : "none";
  b.textContent = n;
}
function renderInbox() {
  if (!state.queue.length) {
    $("#screen-inbox").innerHTML = `
      <div class="section-label">Review log</div>
      <div class="empty"><span class="e">📭</span>All caught up! Auto-logged pulses & widget photos show up here for you to confirm before they post.</div>`;
    return;
  }
  $("#screen-inbox").innerHTML = `
    <div class="section-label">End-of-day review · ${state.queue.length} pending</div>
    <p class="muted" style="font-size:12px;margin:0 4px 12px">Confirm to post publicly, or delete. Nothing goes to the community map until you approve it.</p>
    ${state.queue.map(q => {
      const c = CATEGORIES[q.cat];
      return `<div class="inbox-item">
        <div class="thumb" style="background:${c.color}22">${q.photo ? `<img src="${q.photo}">` : c.icon}</div>
        <div class="meta">
          <b>${c.label} · Sev ${q.sev}</b>
          <span>${q.type === "pulse" ? "⚡" : "📷"} ${q.note} · ${fmtTime(q.createdAt)}</span>
        </div>
        <div class="acts">
          <button class="round ok" data-act="approve-q" data-id="${q.id}">✓</button>
          <button class="round no" data-act="reject-q" data-id="${q.id}">✕</button>
        </div>
      </div>`;
    }).join("")}
    <button class="btn ghost mt" data-act="approve-all">✅ Confirm all & post</button>
  `;
}

/* ============================================================
   PROFILE  (Impact dashboard + medals + history)
   ============================================================ */
function unlockedMedals() { return MEDALS.filter(m => m.test(state)); }
function renderProfile() {
  const p = state.profile;
  const medals = MEDALS;
  const recent = state.hazards.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  $("#screen-profile").innerHTML = `
    <div class="card center">
      <div class="avatar" data-act="pick-avatar">${p.photo ? `<img src="${p.photo}">` : "🦦"}</div>
      <h3 style="font-size:18px" data-act="rename">${p.name} ✏️</h3>
      <p class="sub">Level ${1 + Math.floor((p.mapped + p.verified) / 10)} contributor · joined this season</p>
      <input type="file" id="avatarInput" accept="image/*" hidden>
    </div>

    <div class="section-label">Your impact</div>
    <div class="grid-2">
      <div class="mini"><b>${p.mapped}</b><span>hazards mapped</span></div>
      <div class="mini"><b>${p.verified}</b><span>reports verified</span></div>
      <div class="mini"><b>${p.carbon.toFixed(1)} kg</b><span>CO₂ offset</span></div>
      <div class="mini"><b>${p.miles} mi</b><span>routes tracked</span></div>
    </div>

    <div class="section-label" style="margin-top:16px">Medals · ${unlockedMedals().length}/${medals.length}</div>
    <div class="medal-grid">
      ${medals.map(m => {
        const on = m.test(state);
        return `<div class="medal ${on ? "" : "locked"}"><div class="m">${m.icon}</div><b>${m.name}</b><span>${m.desc}</span></div>`;
      }).join("")}
    </div>

    <div class="section-label" style="margin-top:16px">Recent reports</div>
    ${recent.map(h => `<div class="inbox-item">
      <div class="thumb" style="background:${CATEGORIES[h.cat].color}22">${CATEGORIES[h.cat].icon}</div>
      <div class="meta"><b>${CATEGORIES[h.cat].label}</b><span>${h.note || ""} · ${fmtTime(h.createdAt)}</span></div>
      <span class="badge ${h.status === "verified" ? "ver" : "unv"}">${h.status}</span></div>`).join("")}

    <button class="btn ghost mt" data-act="go-settings">⚙️ Settings & export</button>
    <button class="btn ghost mt" data-act="show-guide">📖 Replay intro guide</button>
  `;
}

/* ============================================================
   SETTINGS  (Radius, dark, voice, export, reset)
   ============================================================ */
function renderSettings() {
  const s = state.settings;
  $("#screen-settings").innerHTML = `
    <div class="section-label">Appearance & safety</div>
    <div class="card">
      <div class="row" style="padding-top:2px"><div class="label"><b>🌙 True dark mode</b><span>Low-glare for dawn / night rides</span></div>
        <span class="spacer"></span><label class="switch"><input type="checkbox" data-toggle="dark" ${s.dark ? "checked" : ""}><span class="track"></span></label></div>
      <div class="row"><div class="label"><b>🔊 Audio hazard readouts</b><span>Speak alerts aloud (TTS)</span></div>
        <span class="spacer"></span><label class="switch"><input type="checkbox" data-toggle="tts" ${s.tts ? "checked" : ""}><span class="track"></span></label></div>
      <div class="row"><div class="label"><b>🔋 Battery saver</b><span>Throttle GPS/camera under 20%</span></div>
        <span class="spacer"></span><label class="switch"><input type="checkbox" data-toggle="battery" ${s.battery ? "checked" : ""}><span class="track"></span></label></div>
    </div>

    <div class="section-label">Proximity alerts</div>
    <div class="card">
      <div class="flex" style="justify-content:space-between"><b>Warn me within</b><b style="color:var(--brand)" id="radiusVal">${s.radius} m</b></div>
      <input type="range" min="10" max="100" step="5" value="${s.radius}" data-range="radius" class="mt">
      <p class="sub mt">Closer to a logged hazard than this and you'll get a haptic + audio heads-up.</p>
    </div>

    <div class="section-label">Pulse sensitivity</div>
    <div class="card">
      <div class="flex" style="justify-content:space-between"><b>Impact threshold</b><b style="color:var(--accent)" id="threshVal">${s.threshold.toFixed(1)} g</b></div>
      <input type="range" min="10.5" max="18" step="0.1" value="${s.threshold}" data-range="threshold" class="mt">
      <button class="btn ghost mt" data-act="calibrate">🎚️ Run calibration wizard</button>
    </div>

    <div class="section-label">Data export portal</div>
    <div class="card">
      <p class="sub">Anonymized infrastructure data for schools, science classes & planning groups.</p>
      <div class="btn-row mt">
        <button class="btn ghost" data-act="export-csv">⬇️ CSV</button>
        <button class="btn ghost" data-act="export-geojson">⬇️ GeoJSON</button>
      </div>
    </div>

    <div class="section-label">About</div>
    <div class="card">
      <p class="sub">PulsePath keeps your tracking on-device until you confirm a report. Auto-logs stay private in your review queue. Coordinates posted publicly are rounded for safety.</p>
      <button class="btn ghost mt" data-act="reset-app">♻️ Reset demo data</button>
    </div>
  `;
}

/* ============================================================
   Email drafter, clearing guide, calibration, export, etc.
   ============================================================ */
function draftEmail(id) {
  const h = state.hazards.find(x => x.id === id);
  if (!h) return;
  const c = CATEGORIES[h.cat];
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const body =
`Hello Marin Public Works / FixItMarin team,

I'd like to report a ${c.label.toLowerCase()} that's creating a safety hazard for local commuters, hikers and cyclists.

  • Type: ${c.label}
  • Severity: ${h.sev}/5 (${sevLabel(h.sev)})
  • Location: ${h.lat}, ${h.lng}
  • Details: ${h.note || c.hint}
  • Reported: ${today}
  • Community confirmations: ${h.votes}

A photo is attached for reference. Could someone take a look when possible? Happy to provide any additional detail.

Thank you for keeping our roads and trails safe,
${state.profile.name}
(sent via PulsePath)`;

  openSheet(`
    <h2>✉️ Municipal email draft</h2>
    <p class="sub">Naturally-worded, ready to send to local public works / FixItMarin.</p>
    <div class="mini" style="margin-bottom:10px"><b style="font-size:12px">To:</b> <span>publicworks@marincounty.gov</span></div>
    <div class="mini" style="margin-bottom:12px"><b style="font-size:12px">Subject:</b> <span>${c.label} hazard report — ${h.lat}, ${h.lng}</span></div>
    <div class="email-preview">${body.replace(/</g, "&lt;")}</div>
    <button class="btn accent mt" data-act="send-email" data-id="${id}">📤 Open in mail app</button>
    <button class="btn ghost mt" data-act="copy-email">📋 Copy text</button>
  `, "Email");
  state._lastEmail = { to: "publicworks@marincounty.gov", subject: `${c.label} hazard report — ${h.lat}, ${h.lng}`, body };
}
function sendEmail(id) {
  const e = state._lastEmail;
  if (!e) return;
  const url = `mailto:${e.to}?subject=${encodeURIComponent(e.subject)}&body=${encodeURIComponent(e.body)}`;
  try { window.location.href = url; } catch (err) {}
  state.profile.emails++;
  save();
  closeSheet();
  mascot("Email sent — civic hero! 🦦");
  toast("✉️ Draft opened in your mail app", "good");
}

function openClearing() {
  if (!state.ageConfirmed) {
    openSheet(`
      <h2>🧹 Safe Clearing Guide</h2>
      <p class="sub">Before we show clearing steps, please confirm your age. PulsePath provides guidance only and assumes zero liability.</p>
      <div class="card" style="background:var(--surface-2);border:none">
        <p style="font-size:13px">⚠️ Never clear anything near traffic, on steep/unstable ground, or that's too heavy to move comfortably. When in doubt, just report it.</p>
      </div>
      <button class="btn mt" data-act="confirm-age">✅ I'm 13 or older — continue</button>
      <button class="btn ghost mt" data-act="close-sheet">Cancel</button>
    `, "Safety");
    return;
  }
  openSheet(`
    <h2>🧹 Clearing a loose branch</h2>
    <p class="sub">Simple steps for minor path obstacles only.</p>
    <ol style="font-size:14px;line-height:1.9;padding-left:18px">
      <li>Check for traffic, bikes & wildlife first.</li>
      <li>Confirm it's light enough to lift comfortably.</li>
      <li>Drag — don't lift overhead — to the side of the path.</li>
      <li>Place it well clear of the trail, off any runoff channel.</li>
      <li>Snap a photo & log it cleared so others know.</li>
    </ol>
    <div class="card" style="background:var(--accent-soft);border:none;color:#9a4a16"><p style="font-size:12px">Zero-liability: you act at your own discretion. Leave anything large, heavy, or hazardous to the pros.</p></div>
    <button class="btn ghost mt" data-act="close-sheet">Got it</button>
  `, "Safety");
}

function runCalibration() {
  let t = 10;
  const samples = [];
  openSheet(`
    <h2 class="center">🎚️ Calibration</h2>
    <p class="sub center">Ride or walk normally for a few seconds so we can learn your bike & terrain baseline.</p>
    <div class="center" style="font-size:64px;font-weight:800;color:var(--brand)" id="calCount">${t}</div>
    <div class="meter" id="calMeter"></div>
    <p class="muted center mt" id="calNote">Sampling your motion…</p>
  `, "Calibration", "cal");
  drawCalMeter();
  Sensors.startMotion((m) => { samples.push(m); pushCalMeter(m); });
  let fake = null;
  if (!Sensors.motionSupported || samples.length === 0) {
    fake = setInterval(() => { const m = 9.8 + (Math.random() - 0.5) * 2; samples.push(m); pushCalMeter(m); }, 90);
  }
  const iv = setInterval(() => {
    t--;
    const c = $("#calCount"); if (c) c.textContent = t;
    if (t <= 0) {
      clearInterval(iv); if (fake) clearInterval(fake);
      Sensors.stopMotion();
      const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 9.8;
      const peak = samples.length ? Math.max(...samples) : 11;
      // Threshold = baseline + headroom above observed peak jitter.
      state.settings.threshold = +clamp(peak + (peak - avg) + 1.5, 11, 18).toFixed(1);
      state.settings.calibrated = true;
      save();
      const note = $("#calNote");
      if (note) note.innerHTML = `✅ Calibrated! Trip threshold set to <b>${state.settings.threshold.toFixed(1)}g</b>`;
      const cc = $("#calCount"); if (cc) cc.textContent = "✓";
      toast("🎚️ Calibration complete", "good");
      setTimeout(() => { closeSheet(); if (currentScreen === "track") renderModePanel(); if (currentScreen === "settings") renderSettings(); }, 1400);
    }
  }, 1000);
}
function drawCalMeter() {
  const m = $("#calMeter"); if (!m) return; m.innerHTML = "";
  for (let i = 0; i < 40; i++) { const b = document.createElement("div"); b.className = "bar"; b.style.height = "2px"; m.appendChild(b); }
}
function pushCalMeter(mag) {
  const m = $("#calMeter"); if (!m) return; const bars = $$(".bar", m); if (!bars.length) return;
  for (let i = 0; i < bars.length - 1; i++) bars[i].style.height = bars[i + 1].style.height;
  bars[bars.length - 1].style.height = clamp((mag - 6) / 18 * 100, 2, 100) + "%";
}

/* --- Export --- */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`⬇️ Exported ${name}`, "good");
}
function exportCSV() {
  const rows = [["id", "category", "severity", "status", "votes", "lat", "lng", "reported", "note"]];
  state.hazards.forEach(h => rows.push([h.id, h.cat, h.sev, h.status, h.votes, h.lat, h.lng,
    new Date(h.createdAt).toISOString(), `"${(h.note || "").replace(/"/g, '""')}"`]));
  download("pulsepath_hazards.csv", rows.map(r => r.join(",")).join("\n"), "text/csv");
}
function exportGeoJSON() {
  const fc = {
    type: "FeatureCollection",
    features: state.hazards.map(h => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      properties: { category: h.cat, severity: h.sev, status: h.status, votes: h.votes, note: h.note, reported: new Date(h.createdAt).toISOString() },
    })),
  };
  download("pulsepath_hazards.geojson", JSON.stringify(fc, null, 2), "application/geo+json");
}

/* --- Proximity engine --- */
const alertedPins = new Set();
function checkProximity() {
  state.hazards.filter(h => h.status === "unverified").forEach(h => {
    const d = dist(state.me, h);
    if (d < ringUnits()) {
      if (!alertedPins.has(h.id)) {
        alertedPins.add(h.id);
        Sensors.buzz([60, 40, 60]);
        const c = CATEGORIES[h.cat];
        toast(`⚠️ Unverified ${c.label} nearby — can you confirm it?`, "alert", 3200);
        if (state.settings.tts) Sensors.speak(`Heads up. ${c.label} reported ahead.`);
      }
    } else if (d > ringUnits() * 1.4) {
      alertedPins.delete(h.id);
    }
  });
}

/* --- Simulated ride --- */
function simulateRide() {
  toast("🛰️ Simulating a ride across the map…");
  const path = [{ x: 30, y: 34 }, { x: 40, y: 42 }, { x: 50, y: 52 }, { x: 64, y: 62 }, { x: 74, y: 56 }];
  let i = 0, step = 0;
  const iv = setInterval(() => {
    const a = path[i], b = path[i + 1];
    if (!b) { clearInterval(iv); state.profile.miles += 1; save(); mascot("Route complete! 🦦"); return; }
    step += 0.06;
    state.me.x = a.x + (b.x - a.x) * step;
    state.me.y = a.y + (b.y - a.y) * step;
    if (step >= 1) { step = 0; i++; }
    if (currentScreen === "map") renderMap();
    checkProximity();
    if (Math.random() < 0.04) logPulse(state.settings.threshold + Math.random() * 3);
  }, 120);
}

/* ============================================================
   SHEETS
   ============================================================ */
function openSheet(html, title, kind) {
  const sheet = $("#sheet");
  sheet.dataset.kind = kind || "";
  if (html !== null && html !== undefined) sheet.innerHTML = `<div class="grab"></div>` + html;
  $("#scrim").classList.add("show");
  sheet.classList.add("show");
}
function setSheet(html) { $("#sheet").innerHTML = `<div class="grab"></div>` + html; }
function closeSheet() {
  $("#sheet").classList.remove("show");
  $("#scrim").classList.remove("show");
  Sensors.stopCamera();
}

/* ============================================================
   Action delegation
   ============================================================ */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) return;
  const a = t.dataset.act, d = t.dataset;
  switch (a) {
    /* nav */
    case "tab": showScreen(d.tab); break;
    case "go-track": showScreen("track"); break;
    case "go-settings": showScreen("settings"); break;
    case "back": showScreen("home"); break;
    case "close-sheet": closeSheet(); break;

    /* modes */
    case "set-mode":
      state.settings.mode = d.mode; save(); refreshModePill();
      if (d.stay === "track" || currentScreen === "track") { renderTrack(); }
      else renderHome();
      toast(`${MODE_META[d.mode].icon} ${MODE_META[d.mode].label} selected`);
      break;

    /* map */
    case "toggle-filter": state.filters[d.cat] = !state.filters[d.cat]; save(); renderMap(); break;
    case "open-pin": openPin(d.id); break;
    case "open-cluster": openCluster(d.cat); break;
    case "cycle-weather": cycleWeather(); break;
    case "locate-me": locateMe(); break;
    case "sim-ride": simulateRide(); break;
    case "map-tap": if (e.target.id === "mapCanvas") mapTap(e); break;

    /* pin actions */
    case "confirm-pin": confirmPin(d.id); break;
    case "speak-pin": { const h = state.hazards.find(x => x.id === d.id); if (h) { Sensors.speak(`${CATEGORIES[h.cat].label}, severity ${h.sev}, ${h.note || ""}`); toast("🔊 Reading aloud"); } break; }
    case "draft-email": draftEmail(d.id); break;
    case "send-email": sendEmail(d.id); break;
    case "copy-email": navigator.clipboard?.writeText(state._lastEmail?.body || ""); toast("📋 Copied"); break;
    case "rate-pin": ratePin(d.id); break;
    case "set-rating": applyRating(d.id, +d.sev); break;
    case "delete-pin": deletePin(d.id); break;

    /* capture */
    case "open-capture": openCapture(); break;
    case "pick-photo": $("#photoInput").click(); break;
    case "draft-cat": draft.cat = d.cat; renderCapture(); break;
    case "draft-sev": draft.sev = +d.sev; renderCapture(); break;
    case "save-capture": saveCapture(); break;

    /* inbox */
    case "approve-q": approveQ(d.id); break;
    case "reject-q": rejectQ(d.id); break;
    case "approve-all": approveAll(); break;

    /* tracking */
    case "toggle-track": toggleTrack(); break;
    case "sim-pulse": logPulse(state.settings.threshold + 1 + Math.random() * 3); pushMeter(state.settings.threshold + 2); break;
    case "calibrate": runCalibration(); break;
    case "connect-health": state._healthConnected = true; renderModePanel(); toast("⌚ Connected to health framework", "good"); break;
    case "demo-tts": Sensors.speak("Caution. Pothole in 40 meters on your right."); toast("🔊 Playing readout"); break;
    case "start-patrol": startPatrol(); break;
    case "stop-patrol": Sensors.stopCamera(); renderModePanel(); toast("⏹ Camera stopped"); break;
    case "sim-anomaly": simAnomaly(); break;
    case "sim-drive": simDrive(); break;

    /* misc */
    case "open-clearing": openClearing(); break;
    case "confirm-age": state.ageConfirmed = true; save(); openClearing(); break;
    case "export-csv": exportCSV(); break;
    case "export-geojson": exportGeoJSON(); break;
    case "reset-app": resetApp(); break;
    case "pick-avatar": $("#avatarInput").click(); break;
    case "rename": renameProfile(); break;
    case "show-guide": startOnboarding(); break;
  }
});

/* toggles + ranges */
document.addEventListener("change", (e) => {
  const tg = e.target.closest("[data-toggle]");
  if (tg) {
    const k = tg.dataset.toggle;
    state.settings[k] = tg.checked; save();
    if (k === "dark") applyTheme();
    if (k === "voice") tg.checked ? startVoice() : Sensors.stopVoice(setVoiceUI);
    return;
  }
});
document.addEventListener("input", (e) => {
  const r = e.target.closest("[data-range]");
  if (r) {
    const k = r.dataset.range;
    state.settings[k] = k === "threshold" ? +r.value : +r.value;
    if (k === "radius") { const v = $("#radiusVal"); if (v) v.textContent = state.settings.radius + " m"; if (currentScreen === "map") renderMap(); }
    if (k === "threshold") { const v = $("#threshVal"); if (v) v.textContent = state.settings.threshold.toFixed(1) + " g"; drawMeter(); }
    save();
  }
});

/* file inputs */
document.addEventListener("change", (e) => {
  if (e.target.id === "photoInput") readImage(e.target, (data) => { draft.photo = data; renderCapture(); });
  if (e.target.id === "avatarInput") readImage(e.target, (data) => { state.profile.photo = data; save(); renderProfile(); });
});
function readImage(input, cb) {
  const f = input.files && input.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => cb(r.result);
  r.readAsDataURL(f);
}

/* ---------------- Action implementations ---------------- */
function mapTap(e) {
  const rect = $("#mapCanvas").getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  openCapture({ x: clamp(x, 4, 96), y: clamp(y, 6, 94) });
}
function confirmPin(id) {
  const h = state.hazards.find(x => x.id === id);
  if (!h) return;
  h.votes++; if (h.status === "unverified") h.status = "verified";
  alertedPins.delete(id);
  state.profile.verified++;
  save(); closeSheet(); renderMap();
  mascot(); toast("✅ Confirmed — thanks for checking!", "good");
  checkMedals();
}
function ratePin(id) {
  openSheet(`
    <h2 class="center">⭐ Rate severity</h2>
    <p class="sub center">How dangerous is this right now?</p>
    <div class="sev-pick" style="margin-top:16px">
      ${[1, 2, 3, 4, 5].map(n => `<button class="sev-opt" data-act="set-rating" data-id="${id}" data-sev="${n}" style="background:${sevColor(n)};color:#fff;border:none">${n}</button>`).join("")}
    </div>
    <p class="muted center">1 = minor · 5 = severe</p>
  `, "Rate");
}
function applyRating(id, sev) {
  const h = state.hazards.find(x => x.id === id);
  if (h) { h.sev = sev; save(); }
  closeSheet(); renderMap();
  toast(`⭐ Rated ${sev}/5 · ${sevLabel(sev)}`, "good");
}
function deletePin(id) {
  state.hazards = state.hazards.filter(x => x.id !== id);
  save(); closeSheet(); renderMap();
  toast("🗑️ Pin removed");
}
function saveCapture() {
  const item = {
    id: uid(), type: "photo", cat: draft.cat, sev: draft.sev, photo: draft.photo,
    x: draft.x, y: draft.y, createdAt: Date.now(),
    note: draft.photo ? "Quick-capture photo" : "Quick capture (no photo)",
  };
  Object.assign(item, xyToGeo(item.x, item.y));
  state.queue.unshift(item);
  save(); closeSheet(); updateInboxBadge();
  toast("📸 Saved to review queue", "good");
}
function approveQ(id) {
  const q = state.queue.find(x => x.id === id);
  if (!q) return;
  postHazard(q);
  state.queue = state.queue.filter(x => x.id !== id);
  save(); updateInboxBadge(); renderInbox();
  toast("✅ Posted to community map", "good");
}
function rejectQ(id) {
  state.queue = state.queue.filter(x => x.id !== id);
  save(); updateInboxBadge(); renderInbox();
  toast("🗑️ Discarded");
}
function approveAll() {
  state.queue.forEach(postHazard);
  state.queue = [];
  save(); updateInboxBadge(); renderInbox();
  mascot(); toast("✅ All reports posted!", "good");
}
function postHazard(q) {
  const h = {
    id: uid(), cat: q.cat, x: q.x, y: q.y, sev: q.sev, status: "verified",
    votes: 1, note: q.note, photo: q.photo, createdAt: Date.now(), ...xyToGeo(q.x, q.y),
  };
  state.hazards.push(h);
  state.profile.mapped++;
  state.profile.carbon = +(state.profile.carbon + 0.3).toFixed(1);
  checkMedals();
}
function checkMedals() {
  const u = unlockedMedals();
  if (u.length > (state._medalCount || 3)) {
    const newest = u[u.length - 1];
    mascot(`🏅 Unlocked: ${newest.name}!`);
  }
  state._medalCount = u.length;
}

function cycleWeather() {
  const i = WEATHER_STATES.findIndex(w => w.id === state.settings.weather);
  const next = WEATHER_STATES[(i + 1) % WEATHER_STATES.length];
  state.settings.weather = next.id; save();
  if (currentScreen === "map") renderMap();
  if (currentScreen === "home") renderHome();
  toast(`${next.icon} ${next.label}`);
}
async function locateMe() {
  toast("📍 Getting your location…");
  const pos = await Sensors.getPosition();
  if (pos) {
    const xy = geoToXY(pos.lat, pos.lng);
    state.me = xy; save(); renderMap(); checkProximity();
    toast("📍 Location found", "good");
  } else {
    // demo nudge
    state.me = { x: clamp(state.me.x + (Math.random() - 0.5) * 20, 10, 90), y: clamp(state.me.y + (Math.random() - 0.5) * 20, 10, 90) };
    save(); renderMap(); checkProximity();
    toast("📍 GPS unavailable — using demo position");
  }
}

async function startPatrol() {
  const view = $("#patrolView");
  if (!view) return;
  view.innerHTML = `<video id="patrolVideo" playsinline></video>`;
  const ok = await Sensors.startCamera($("#patrolVideo"));
  if (!ok) {
    view.innerHTML = `<span class="e">🚫</span><span>Camera unavailable in this preview</span>`;
    toast("🚫 Camera not available");
  } else {
    toast("📷 Patrol watch active");
  }
}
function simAnomaly() {
  Sensors.buzz([80, 40, 80]);
  toast("🔍 Structural anomaly detected — tap to document!", "alert", 3500);
  if (state.settings.tts) Sensors.speak("Possible road block detected ahead.");
  setTimeout(() => openCapture(), 600);
}
function simDrive() {
  toast("🚗 Vehicle-speed travel detected (running passively)");
  const miles = 6, co2 = (miles * 0.404).toFixed(1);
  setTimeout(() => {
    openSheet(`
      <h2>☀️ Good morning!</h2>
      <p class="sub">About yesterday's ${miles}-mile drive…</p>
      <div class="card" style="background:var(--brand-soft);border:none">
        <div style="font-size:34px;font-weight:800;color:var(--brand-deep)">${co2} kg CO₂</div>
        <p style="font-size:13px">is roughly what you'd save by biking that same trip next time. 🚲</p>
      </div>
      <p class="sub">No pressure — just a friendly nudge. Every mile counts toward the district goal.</p>
      <button class="btn mt" data-act="close-sheet">Nice, thanks!</button>
    `, "Nudge");
  }, 900);
}

function renameProfile() {
  const n = prompt("Display name", state.profile.name);
  if (n && n.trim()) { state.profile.name = n.trim().slice(0, 24); save(); renderProfile(); }
}
function resetApp() {
  if (!confirm("Reset all demo data and reload?")) return;
  localStorage.removeItem(STORE_KEY);
  location.reload();
}

/* ---------------- Voice ---------------- */
function setVoiceUI(on) {
  const b = $("#voiceBtn");
  b.style.background = on ? "var(--accent)" : "var(--surface-2)";
  b.style.color = on ? "#fff" : "";
}
function startVoice() {
  const ok = Sensors.startVoice(() => {
    // "Log Danger" heard -> instant pin at current position
    logPulse(state.settings.threshold + 1);
    toast('🎙️ "Log Danger" heard — pin dropped!', "alert");
  }, setVoiceUI);
  if (!ok) { toast("🎙️ Voice recognition not supported here"); state.settings.voice = false; }
}
function toggleVoice() {
  if (Sensors._recognition) { Sensors.stopVoice(setVoiceUI); state.settings.voice = false; toast("🎙️ Voice off"); }
  else { state.settings.voice = true; startVoice(); toast('🎙️ Listening for "Log Danger"', "good"); }
  save();
}

/* ---------------- Onboarding ---------------- */
const SLIDES = [
  { big: "🦦", h: "Welcome to PulsePath", p: "Map road & trail hazards across Marin — for commuters, hikers and bikers alike." },
  { big: "🚲", h: "Automatic logging", p: "Bike, walk, patrol or drive. Sensors quietly catch potholes & ruts and auto-tag GPS so you keep your hands on the bars." },
  { big: "🔒", h: "Private by default", p: "Auto-logs stay on your device in a review queue. Nothing posts publicly until you confirm it. Public coordinates are rounded for safety." },
  { big: "🌍", h: "Real civic impact", p: "Confirm hazards, draft city emails, and watch your carbon offset & district map grow." },
];
let slideIdx = 0;
function startOnboarding() {
  slideIdx = 0;
  $("#onb").classList.remove("hide");
  renderOnb();
}
function renderOnb() {
  $("#onbSlides").style.transform = `translateX(-${slideIdx * 100}%)`;
  $("#onbDots").innerHTML = SLIDES.map((_, i) => `<i class="${i === slideIdx ? "on" : ""}"></i>`).join("");
  $("#onbNext").textContent = slideIdx === SLIDES.length - 1 ? "Get started" : "Next";
}
function onbNext() {
  if (slideIdx < SLIDES.length - 1) { slideIdx++; renderOnb(); }
  else { $("#onb").classList.add("hide"); state.onboarded = true; save(); }
}

/* ---------------- Boot ---------------- */
function boot() {
  applyTheme();
  refreshModePill();
  updateInboxBadge();
  state._medalCount = unlockedMedals().length;

  // Build onboarding slides
  $("#onbSlides").innerHTML = SLIDES.map(s => `
    <div class="slide"><div class="big">${s.big}</div><h2>${s.h}</h2><p>${s.p}</p></div>`).join("");
  $("#onbNext").addEventListener("click", onbNext);
  $("#onbSkip").addEventListener("click", () => { $("#onb").classList.add("hide"); state.onboarded = true; save(); });

  $("#scrim").addEventListener("click", closeSheet);
  $("#darkBtn").addEventListener("click", () => { state.settings.dark = !state.settings.dark; save(); applyTheme(); if (currentScreen === "settings") renderSettings(); });
  $("#voiceBtn").addEventListener("click", toggleVoice);
  $("#backBtn").addEventListener("click", () => showScreen("home"));
  $("#fab").addEventListener("click", () => openCapture());

  showScreen("home");

  if (!state.onboarded) startOnboarding();
  else $("#onb").classList.add("hide");
}
document.addEventListener("DOMContentLoaded", boot);
