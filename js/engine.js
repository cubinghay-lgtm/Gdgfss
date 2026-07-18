/* ============================================================
   engine.js — the motio sensor-fusion engine.

   FOUR CONSTANT FACTORS, polled every 50 ms while tracking:
     V   velocity            navigator.geolocation (app feeds
                             positions in via updatePosition)
     Iz  IMU z-axis          DeviceMotionEvent vertical accel
     Ab  acoustic baseline   Web Audio analyser RMS (skipped in
                             Low Power Mode -> IMU-only)
     Mg  geomagnetic         Magnetometer µT magnitude (rare;
                             treated as absent when unsupported)

   ARMING RULE: impact detection is armed ONLY between 6 and
   22 mph. Below/above, samples still stream (telemetry) but
   anomalies are not acted on.

   ANOMALY -> 1-SECOND BUFFER -> 7-SCENARIO MATRIX:
     1 standard pothole      -> LOG hazard (pothole)
     2 cattle guard / grate  -> IGNORE (system bypass)
     3 manhole cover defect  -> LOG hazard (manhole)
     4 dirt trail rut        -> LOG hazard (rut)
     5 low-hanging branch    -> LOG hazard (branch)
     6 severe impact / fall  -> SAFETY BEACON
     7 speed bump            -> IGNORE (system bypass)

   Zone context (civic.js) scales the impact threshold: documented
   landslip/erosion corridors are more sensitive. Thresholds also
   self-tune from the live noise floor — this replaces a manual
   calibration wizard.

   FALLBACKS (per spec):
     no DeviceMotion  -> GPS altitude-velocity tracking (coarse
                         vertical anomalies from successive fixes)
     no audio / LowPwr-> IMU-only (Ab factor absent)
     no magnetometer  -> Mg factor absent (metal tests soften)

   iOS/user-gesture rule: motion permission and AudioContext are
   requested by app.js INSIDE the Start Tracking click handler,
   BEFORE Engine.start() is called. The engine never asks.
   ============================================================ */

const Engine = {
  /* ---- public callbacks (assigned by app.js) ---- */
  onTelemetry: null, // (t) => {}  every poll tick
  onDetect: null,    // ({ scenario, action:'log', cat, sev, confidence, sim }) => {}
  onIgnore: null,    // ({ scenario, sim }) => {}  bypassed events (grate/bump)
  onBeacon: null,    // ({ scenario, sim }) => {}  severe impact / fall

  /* ---- tuning ---- */
  POLL_MS: 50,
  BASE_THRESHOLD: 4.5,   // m/s² deviation from gravity baseline
  SEVERE_MULT: 3.0,      // dev > 3x threshold => severe impact
  MAG_METAL_DELTA: 8,    // µT swing suggesting ferrous metal underfoot
  ARM_MIN_MPH: 6,
  ARM_MAX_MPH: 22,
  COOLDOWN_MS: 4000,

  /* ---- live state ---- */
  running: false,
  lowPower: false,
  usingMotion: false,    // false => GPS-altitude fallback mode
  armed: false,
  speedMph: 0,
  zone: null,
  zoneFactor: 1,
  threshold: 4.5,
  _pollId: null,
  _phase: "idle",        // idle | capturing | cooldown
  _cooldownUntil: 0,

  // latest sensor snapshots
  _motion: null,          // { z, mag, rot, t } from Sensors.startMotion
  _zBase: null,           // EMA gravity baseline of z
  _noise: 0.6,            // EMA of |z - base| (noise floor)
  _lastPos: null, _prevPos: null,

  // ring of recent samples (pre-roll) + active capture buffer
  _ring: [], _capture: null,

  /* ================= lifecycle ================= */
  start(opts = {}) {
    this.stop();
    this.lowPower = !!opts.lowPower;
    this.running = true;
    this._phase = "idle";
    this._ring = [];
    this._zBase = null;
    this._noise = 0.6;

    // Iz: motion stream (permission already granted via gesture in app.js)
    this.usingMotion = Sensors.startMotion((s) => { this._motion = s; });

    // Mg: magnetometer where available
    Sensors.startMag();

    this._pollId = setInterval(() => this._tick(), this.POLL_MS);
    return { motion: this.usingMotion, audio: !this.lowPower && !!Sensors._analyser, mag: Sensors.magSupported };
  },

  stop() {
    if (this._pollId) { clearInterval(this._pollId); this._pollId = null; }
    Sensors.stopMotion();
    Sensors.stopMag();
    this.running = false;
    this.armed = false;
    this._phase = "idle";
    this._capture = null;
    this._motion = null;
  },

  /* App feeds GPS fixes here (it owns the single watchPosition). */
  updatePosition(pos) {
    this._prevPos = this._lastPos;
    this._lastPos = { ...pos, t: performance.now() };

    // Velocity: prefer the GPS-reported speed; else derive from fixes.
    let ms = (pos.speed != null && isFinite(pos.speed)) ? pos.speed : null;
    if (ms == null && this._prevPos) {
      const dt = (this._lastPos.t - this._prevPos.t) / 1000;
      if (dt > 0.3) ms = this._haversine(this._prevPos, this._lastPos) / dt;
    }
    if (ms != null) this.speedMph = Math.max(0, ms * 2.23694);

    // Zone context -> dynamic threshold factor.
    this.zone = (typeof zoneForPoint === "function") ? zoneForPoint(pos.lat, pos.lng) : null;
    this.zoneFactor = (typeof zoneSensorFactor === "function") ? zoneSensorFactor(this.zone) : 1;

    // GPS-altitude fallback: no IMU -> vertical velocity anomalies.
    if (this.running && !this.usingMotion && this._prevPos &&
        pos.alt != null && this._prevPos.alt != null) {
      const dt = (this._lastPos.t - this._prevPos.t) / 1000;
      if (dt > 0.2 && dt < 5) {
        const vAlt = Math.abs(pos.alt - this._prevPos.alt) / dt; // m/s vertical
        if (this.armed && this._phase === "idle" && vAlt > 1.6) {
          // Coarse anomaly; classify with degraded features (low confidence).
          this._finishCapture(this._degradedBuffer(vAlt), /*degraded*/ true);
        }
      }
    }
  },

  _haversine(a, b) {
    const R = 6371000, r = Math.PI / 180;
    const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  },

  /* ================= the 50 ms fusion tick ================= */
  _tick() {
    const now = performance.now();

    // Arm gate: 6–22 mph only.
    this.armed = this.speedMph >= this.ARM_MIN_MPH && this.speedMph <= this.ARM_MAX_MPH;

    // Assemble this tick's fused sample.
    const m = this._motion;
    const z = m ? m.z : null;
    const audio = (!this.lowPower) ? Sensors.audioLevel() : null; // null when absent
    const magUT = Sensors.magReading ? Sensors.magReading.uT : null;

    // Update gravity baseline + noise floor (slow EMAs) while not capturing.
    if (z != null) {
      if (this._zBase == null) this._zBase = z;
      const dev = Math.abs(z - this._zBase);
      if (this._phase !== "capturing") {
        this._zBase += (z - this._zBase) * 0.04;
        this._noise += (dev - this._noise) * 0.02;
      }
      // Self-tuning threshold: floor at BASE_THRESHOLD, scaled by zone,
      // lifted above the live noise floor (replaces calibration wizard).
      this.threshold = Math.max(this.BASE_THRESHOLD * this.zoneFactor, this._noise * 3.2);

      const sample = {
        t: now, z, dev,
        rot: m ? (Math.abs(m.rot.alpha) + Math.abs(m.rot.beta) + Math.abs(m.rot.gamma)) : 0,
        audio: audio == null ? 0 : audio,
        mag: magUT == null ? 0 : magUT,
        hasAudio: audio != null, hasMag: magUT != null,
      };
      this._ring.push(sample);
      if (this._ring.length > 12) this._ring.shift(); // ~0.6 s pre-roll

      if (this._phase === "idle" && this.armed && now >= this._cooldownUntil && dev > this.threshold) {
        // Anomaly! open a 1-second capture window (pre-roll included).
        this._phase = "capturing";
        this._capture = { samples: [...this._ring], until: now + 1000, speedAt: this.speedMph };
      } else if (this._phase === "capturing") {
        this._capture.samples.push(sample);
        if (now >= this._capture.until) {
          const buf = this._capture; this._capture = null;
          this._finishCapture(buf, false);
        }
      }
    }

    // Telemetry for the OLED tracking screen.
    if (this.onTelemetry) this.onTelemetry({
      speedMph: this.speedMph, armed: this.armed, phase: this._phase,
      dev: (z != null && this._zBase != null) ? Math.abs(z - this._zBase) : 0,
      threshold: this.threshold, zone: this.zone,
      factors: {
        V: this.speedMph, Iz: z != null,
        Ab: this.lowPower ? "off" : (audio != null ? audio : "n/a"),
        Mg: magUT != null ? magUT : "n/a",
      },
      usingMotion: this.usingMotion,
    });
  },

  /* ================= classification ================= */
  _features(buf) {
    const s = buf.samples;
    const devs = s.map(x => x.dev);
    const peakDev = Math.max(...devs, 0);
    const thr = this.threshold;

    // Count distinct crossings above half-threshold (oscillation count).
    let peaks = 0, above = false;
    for (const d of devs) {
      if (d > thr * 0.55 && !above) { peaks++; above = true; }
      else if (d < thr * 0.35) above = false;
    }
    // Active duration: first->last sample above half-threshold.
    const idx = devs.map((d, i) => d > thr * 0.5 ? i : -1).filter(i => i >= 0);
    const durMs = idx.length ? (s[idx[idx.length - 1]].t - s[idx[0]].t) : 0;

    const rotMean = s.reduce((a, x) => a + x.rot, 0) / s.length;
    const rotPeak = Math.max(...s.map(x => x.rot), 0);

    const hasMag = s.some(x => x.hasMag);
    const mags = s.filter(x => x.hasMag).map(x => x.mag);
    const magDelta = mags.length ? Math.max(...mags) - Math.min(...mags) : 0;

    const hasAudio = s.some(x => x.hasAudio);
    const audios = s.map(x => x.audio);
    const aBase = audios.slice(0, 4).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(4, audios.length));
    const aPeak = Math.max(...audios, 0);
    const audioImpulse = aBase > 0.005 ? aPeak / aBase : (aPeak > 0.08 ? 3 : 1);

    // Smoothness: mean |jerk| between samples relative to peak (speed bumps
    // are smooth two-lobe humps; potholes are sharp).
    let jerk = 0;
    for (let i = 1; i < devs.length; i++) jerk += Math.abs(devs[i] - devs[i - 1]);
    jerk /= Math.max(1, devs.length - 1);
    const sharpness = peakDev > 0 ? jerk / peakDev : 0;

    return { peakDev, thr, peaks, durMs, rotMean, rotPeak, hasMag, magDelta, hasAudio, audioImpulse, sharpness, speedAt: buf.speedAt || this.speedMph };
  },

  _classify(f) {
    const metal = f.hasMag && f.magDelta > this.MAG_METAL_DELTA;

    // 6 — severe impact / fall: extreme deviation, or big hit + speed collapse.
    if (f.peakDev > f.thr * this.SEVERE_MULT ||
        (f.peakDev > f.thr * 2 && this.speedMph < 2 && f.speedAt > 6)) {
      return { scenario: "severe_impact", action: "beacon", confidence: 0.9 };
    }
    // 2 — cattle guard / metal grate: rapid repeated strikes (+ metal if known).
    if (f.peaks >= 4 && f.durMs <= 900 && (metal || !f.hasMag)) {
      return { scenario: "cattle_guard", action: "ignore", confidence: metal ? 0.9 : 0.65 };
    }
    // 3 — manhole cover defect: sharp single strike WITH metal signature.
    if (f.peaks <= 2 && metal) {
      return { scenario: "manhole_defect", action: "log", cat: "manhole", confidence: 0.85 };
    }
    // 4 — dirt trail rut: long sustained wobble (and/or trail-risk zone).
    // Checked BEFORE speed bump: ruts are long + rotationally chaotic,
    // bumps are short + smooth — duration and rotation separate them.
    const trailZone = this.zone && /landslip|erosion|drainage/i.test(this.zone.riskType);
    if (f.durMs > 600 && (f.rotMean > 60 || trailZone)) {
      return { scenario: "trail_rut", action: "log", cat: "rut", confidence: trailZone ? 0.8 : 0.65 };
    }
    // 7 — speed bump: single smooth low-rotation hump, no metal signature.
    if (f.peaks <= 2 && f.sharpness < 0.28 && f.rotMean < 80 && f.durMs >= 250 && f.durMs <= 950 && !metal) {
      return { scenario: "speed_bump", action: "ignore", confidence: 0.7 };
    }
    // 5 — low-hanging branch: loud acoustic impulse with modest vertical hit.
    if (f.hasAudio && f.audioImpulse > 2.6 && f.peakDev < f.thr * 1.6) {
      return { scenario: "low_branch", action: "log", cat: "branch", confidence: 0.6 };
    }
    // 1 — default: standard pothole.
    return { scenario: "standard_pothole", action: "log", cat: "pothole", confidence: 0.75 };
  },

  _severity(f) {
    // Scale deviation vs threshold into 1..5.
    return Math.max(1, Math.min(5, Math.round((f.peakDev / f.thr) * 1.8)));
  },

  _finishCapture(buf, degraded) {
    this._phase = "cooldown";
    this._cooldownUntil = performance.now() + this.COOLDOWN_MS;
    setTimeout(() => { if (this._phase === "cooldown") this._phase = "idle"; }, this.COOLDOWN_MS);

    const f = this._features(buf);
    const c = this._classify(f);
    if (degraded) c.confidence = Math.min(c.confidence, 0.4);
    const detail = { ...c, sev: this._severity(f), features: f, sim: !!buf.sim };

    if (c.action === "beacon") { this.onBeacon && this.onBeacon(detail); }
    else if (c.action === "ignore") { this.onIgnore && this.onIgnore(detail); }
    else { this.onDetect && this.onDetect(detail); }
    return detail;
  },

  // Fallback-path buffer when only GPS altitude is available.
  _degradedBuffer(vAlt) {
    const now = performance.now();
    const dev = Math.min(vAlt * 3, this.threshold * 1.8);
    return {
      sim: false, speedAt: this.speedMph,
      samples: Array.from({ length: 12 }, (_, i) => ({
        t: now + i * 50, z: 0, dev: i === 5 ? dev : dev * 0.2,
        rot: 0, audio: 0, mag: 0, hasAudio: false, hasMag: false,
      })),
    };
  },

  /* ================= simulation (desktop/demo/validation) =================
     Synthetic 1-second buffers with each scenario's signature, pushed
     through the SAME feature extractor + classifier as real data. */
  simulate(name) {
    const thr = this.threshold || this.BASE_THRESHOLD;
    const now = performance.now();
    const mk = (fn, speedAt = 12) => ({
      sim: true, speedAt,
      samples: Array.from({ length: 21 }, (_, i) => ({ t: now + i * 50, hasAudio: true, hasMag: true, audio: 0.01, mag: 40, rot: 20, z: 0, ...fn(i) })),
    });
    const shapes = {
      pothole:      mk(i => ({ dev: i === 8 ? thr * 2.0 : (i === 9 ? thr * 0.9 : 0.3), rot: i === 8 ? 160 : 25, audio: i === 8 ? 0.06 : 0.012 })),
      cattle_guard: mk(i => ({ dev: (i >= 5 && i <= 15 && i % 2 === 1) ? thr * 1.3 : 0.3, mag: 40 + ((i % 2) ? 12 : 0), audio: 0.05, rot: 90 })),
      manhole:      mk(i => ({ dev: i === 8 ? thr * 1.7 : 0.3, mag: i >= 8 && i <= 11 ? 58 : 40, rot: i === 8 ? 120 : 20 })),
      rut:          mk(i => ({ dev: (i >= 4 && i <= 19) ? thr * (0.8 + 0.35 * Math.abs(Math.sin(i * 1.3))) : 0.4, rot: 150, audio: 0.02 })),
      branch:       mk(i => ({ dev: i === 8 ? thr * 1.2 : 0.2, audio: i === 8 ? 0.30 : 0.01, rot: i === 8 ? 60 : 15 })),
      severe:       mk(i => ({ dev: i === 8 ? thr * 4.2 : (i > 8 ? thr * 1.4 : 0.4), rot: i >= 8 ? 400 : 30, audio: i === 8 ? 0.4 : 0.02 }), 14),
      speed_bump:   mk(i => { const c = Math.max(0, 1 - Math.abs(i - 10) / 6); return { dev: thr * 1.15 * c, rot: 30 * c, audio: 0.012 }; }),
    };
    const buf = shapes[name];
    if (!buf) return null;
    if (name === "severe") this.speedMph = 0; // fall: speed collapses
    return this._finishCapture(buf, false);
  },
};
