/* ============================================================
   engine.js — motio's autonomous hazard sensor (Bike Mode only).

   While the rider bikes, the phone's motion sensors are polled and
   an adaptive baseline (a rolling average of *this ride's* normal
   vibration) is maintained. When a jolt breaks well clear of that
   baseline, the engine captures a ~1-second window and decides:

     • is this just a speed bump / rhythmic seam?  -> skip quietly
     • otherwise, which of the four general terms fits best?
         Fallen Branch · Pothole · Trash · Other

   The category is chosen by blending a physics heuristic with the
   on-device learner (learn.js), so it improves as the rider edits.
   It always emits ONE stable general term (never re-labels the same
   jolt two different ways); the rider can refine the exact subtype
   with the pencil, which teaches the model.

   Slope (from GPS + elevation fusion, set by app.js) sharpens the
   read on descents. There is no hard-fall / beacon system by design.

   The engine never asks for permission and never reads jargon to the
   user — app.js requests motion access in a gesture and owns all copy.
   ============================================================ */

const Engine = {
  onTelemetry: null, // (t) => {}   every tick, for the ride screen
  onDetect: null,    // ({cat, subtype, sev, confidence}) => {}
  onSkip: null,      // ({reason}) => {}   benign event, logged nowhere

  POLL_MS: 50,
  BASE_THRESHOLD: 4.5,
  ARM_MIN_MPH: 6,
  ARM_MAX_MPH: 22,
  COOLDOWN_MS: 3500,

  running: false,
  armed: false,
  speedMph: 0,
  slope: 0,            // percent grade, set by app.js from elevation fusion
  zone: null,
  zoneFactor: 1,
  threshold: 4.5,
  _pollId: null,
  _phase: "idle",
  _cooldownUntil: 0,
  _motion: null,
  _zBase: null,
  _noise: 0.6,
  _lastPos: null, _prevPos: null,
  _ring: [], _capture: null,

  start() {
    this.stop();
    this.running = true;
    this._phase = "idle";
    this._ring = [];
    this._zBase = null;
    this._noise = 0.6;
    const ok = Platform.startMotion((s) => { this._motion = s; });
    this._pollId = setInterval(() => this._tick(), this.POLL_MS);
    return { motion: ok };
  },
  stop() {
    if (this._pollId) { clearInterval(this._pollId); this._pollId = null; }
    Platform.stopMotion();
    this.running = false; this.armed = false; this._phase = "idle";
    this._capture = null; this._motion = null;
  },

  // app.js owns the single geolocation watch and feeds fixes here.
  updatePosition(pos) {
    this._prevPos = this._lastPos;
    this._lastPos = { ...pos, t: performance.now() };
    let ms = (pos.speed != null && isFinite(pos.speed)) ? pos.speed : null;
    if (ms == null && this._prevPos) {
      const dt = (this._lastPos.t - this._prevPos.t) / 1000;
      if (dt > 0.3) ms = this._haversine(this._prevPos, this._lastPos) / dt;
    }
    if (ms != null) this.speedMph = Math.max(0, ms * 2.23694);
    this.zone = (typeof zoneForPoint === "function") ? zoneForPoint(pos.lat, pos.lng) : null;
    this.zoneFactor = (typeof zoneSensorFactor === "function") ? zoneSensorFactor(this.zone) : 1;
  },
  setSlope(pct) { if (isFinite(pct)) this.slope = pct; },

  _haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  },

  _tick() {
    const now = performance.now();
    this.armed = this.speedMph >= this.ARM_MIN_MPH && this.speedMph <= this.ARM_MAX_MPH;
    const m = this._motion;
    const z = m ? m.z : null;

    if (z != null) {
      if (this._zBase == null) this._zBase = z;
      const dev = Math.abs(z - this._zBase);
      if (this._phase !== "capturing") {
        this._zBase += (z - this._zBase) * 0.04;   // adaptive baseline
        this._noise += (dev - this._noise) * 0.02; // rolling noise floor
      }
      this.threshold = Math.max(this.BASE_THRESHOLD * this.zoneFactor, this._noise * 3.2);

      const sample = {
        t: now, z, dev,
        rot: m ? (Math.abs(m.rot.alpha) + Math.abs(m.rot.beta) + Math.abs(m.rot.gamma)) : 0,
        mag: 0, // reserved (magnetometer swing fed via app if present)
      };
      this._ring.push(sample);
      if (this._ring.length > 12) this._ring.shift();

      if (this._phase === "idle" && this.armed && now >= this._cooldownUntil && dev > this.threshold) {
        this._phase = "capturing";
        this._capture = { samples: [...this._ring], until: now + 1000, speedAt: this.speedMph };
      } else if (this._phase === "capturing") {
        this._capture.samples.push(sample);
        if (now >= this._capture.until) { const buf = this._capture; this._capture = null; this._finish(buf); }
      }
    }

    if (this.onTelemetry) this.onTelemetry({
      speedMph: this.speedMph, armed: this.armed,
      dev: (z != null && this._zBase != null) ? Math.abs(z - this._zBase) : 0,
      threshold: this.threshold, zone: this.zone, slope: this.slope,
    });
  },

  /* ---- feature extraction ---- */
  _features(buf) {
    const s = buf.samples;
    const devs = s.map(x => x.dev);
    const peakDev = Math.max(...devs, 0);
    const thr = this.threshold;
    let peaks = 0, above = false;
    for (const d of devs) {
      if (d > thr * 0.55 && !above) { peaks++; above = true; }
      else if (d < thr * 0.35) above = false;
    }
    const idx = devs.map((d, i) => d > thr * 0.5 ? i : -1).filter(i => i >= 0);
    const durMs = idx.length ? (s[idx[idx.length - 1]].t - s[idx[0]].t) : 0;
    const rotMean = s.reduce((a, x) => a + x.rot, 0) / s.length;
    const rotPeak = Math.max(...s.map(x => x.rot), 0);
    const magDelta = Math.max(...s.map(x => x.mag), 0) - Math.min(...s.map(x => x.mag), 0);
    let jerk = 0;
    for (let i = 1; i < devs.length; i++) jerk += Math.abs(devs[i] - devs[i - 1]);
    jerk /= Math.max(1, devs.length - 1);
    const sharpness = peakDev > 0 ? jerk / peakDev : 0;
    return { peakDev, thr, peaks, durMs, rotMean, rotPeak, magDelta, sharpness, speedAt: buf.speedAt || this.speedMph, slope: this.slope };
  },

  // Physics prior over the 4 categories (rows sum loosely to 1 after blend).
  _heuristic(f) {
    const long = f.durMs > 550;
    const sharp = f.sharpness > 0.32;
    const rough = f.rotMean > 70;
    let branch = 0.1, pothole = 0.2, trash = 0.05, other = 0.15;
    if (sharp && !long) pothole += 0.6;                 // crisp single hit
    if (long && rough) other += 0.6;                    // sustained wobble (rut/gravel/mud)
    if (!sharp && f.rotPeak > 180 && f.peakDev < f.thr * 1.5) branch += 0.4; // scrape/whip
    if (f.slope < -4 && long) other += 0.2;             // descent washout
    return this._norm({ branch, pothole, trash, other });
  },
  _norm(o) { const s = Object.values(o).reduce((a, b) => a + b, 0) || 1; const r = {}; for (const k in o) r[k] = o[k] / s; return r; },

  // Best subtype within a chosen category, from the physics signature.
  _subtype(cat, f) {
    if (cat === "pothole") {
      if (f.magDelta > 8) return "wet_grate";
      if (f.peaks <= 1 && f.sharpness > 0.5) return "curb_drop";
      if (f.rotMean > 60) return "cracked_pave";
      return "pothole";
    }
    if (cat === "branch") return f.rotPeak > 220 ? "helmet_branch" : "fallen_limb";
    if (cat === "other") {
      if (f.slope < -4 && f.durMs > 600) return "washout_gully";
      if (f.rotMean > 120) return "loose_gravel";
      if (f.durMs > 700) return "mud_wash";
      return "loose_gravel";
    }
    return "dumping"; // trash rarely comes from motion; here if the model insists
  },

  _classify(f) {
    const heur = this._heuristic(f);
    let blended = heur;
    if (typeof Learn !== "undefined") {
      const ml = Learn.predict(f);
      const a = Learn.alpha();
      blended = {};
      for (const c of CATEGORY_ORDER) blended[c] = a * (ml[c] || 0) + (1 - a) * (heur[c] || 0);
      blended = this._norm(blended);
    }
    let cat = CATEGORY_ORDER[0], best = -1;
    for (const c of CATEGORY_ORDER) if (blended[c] > best) { best = blended[c]; cat = c; }
    return { cat, subtype: this._subtype(cat, f), confidence: best };
  },

  _severity(f) { return Math.max(1, Math.min(5, Math.round((f.peakDev / f.thr) * 1.8))); },

  // Is this jolt too smooth/rhythmic to be a real hazard? (speed bump, seam)
  _benign(f) {
    return f.peaks <= 2 && f.sharpness < 0.26 && f.rotMean < 70 && f.durMs >= 240 && f.durMs <= 950;
  },

  _finish(buf) {
    this._phase = "cooldown";
    this._cooldownUntil = performance.now() + this.COOLDOWN_MS;
    setTimeout(() => { if (this._phase === "cooldown") this._phase = "idle"; }, this.COOLDOWN_MS);

    const f = this._features(buf);
    if (this._benign(f) && !buf.force) { this.onSkip && this.onSkip({ reason: "smooth", features: f }); return { skip: true }; }
    const c = this._classify(f);
    const detail = { cat: c.cat, subtype: c.subtype, confidence: c.confidence, sev: this._severity(f), features: f };
    this.onDetect && this.onDetect(detail);
    return detail;
  },

  /* ---- simulation (test harness + on-device sanity only; no UI hook) ---- */
  simulate(name) {
    const thr = this.threshold || this.BASE_THRESHOLD;
    const now = performance.now();
    const mk = (fn, speedAt = 12) => ({ sim: true, speedAt,
      samples: Array.from({ length: 21 }, (_, i) => ({ t: now + i * 50, z: 0, dev: 0.3, rot: 20, mag: 40, ...fn(i) })) });
    const shapes = {
      pothole:      mk(i => ({ dev: i === 8 ? thr * 2.0 : 0.3, rot: i === 8 ? 60 : 20 })),
      grate:        mk(i => ({ dev: i === 8 ? thr * 1.7 : 0.3, mag: i >= 8 && i <= 11 ? 60 : 40, rot: 30 })),
      rut:          mk(i => ({ dev: (i >= 4 && i <= 19) ? thr * (0.9 + 0.3 * Math.abs(Math.sin(i))) : 0.4, rot: 150 })),
      branch:       mk(i => ({ dev: i === 8 ? thr * 1.1 : 0.2, rot: i === 8 ? 300 : 15 })),
      speed_bump:   mk(i => { const c = Math.max(0, 1 - Math.abs(i - 10) / 6); return { dev: thr * 1.1 * c, rot: 25 * c }; }),
    };
    const buf = shapes[name];
    return buf ? this._finish(buf) : null;
  },
};
