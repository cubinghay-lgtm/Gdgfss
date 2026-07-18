/* ============================================================
   sensors.js — Thin wrappers over real device APIs. Every
   wrapper reports support and degrades gracefully so the
   desktop preview still works (the engine and UI provide
   simulation paths).

     • Geolocation + speed   navigator.geolocation
     • Motion + rotation     DeviceMotionEvent (accel + gyro)
     • Acoustic baseline     Web Audio API (mic analyser)
     • Geomagnetic           Magnetometer (Generic Sensor API)
     • Voice dictation       Web Speech Recognition (raw only)
     • Text-to-speech        speechSynthesis
     • Camera                getUserMedia
     • Haptics               navigator.vibrate

   iOS permission rule: requestMotionPermission() and initAudio()
   are ONLY called from inside the Start Tracking click handler
   (see app.js) — never on page load.
   ============================================================ */

const Sensors = {
  /* ---------------- GPS ---------------- */
  geoSupported: "geolocation" in navigator,
  getPosition() {
    return new Promise((resolve) => {
      if (!this.geoSupported) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({
          lat: p.coords.latitude, lng: p.coords.longitude,
          acc: p.coords.accuracy, alt: p.coords.altitude,
          speed: p.coords.speed, // m/s or null
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  },

  // Continuous position stream (tracking + proximity). Emits
  // { lat, lng, acc, alt, speed } — speed in m/s, may be null.
  _watchId: null,
  startWatch(onPos) {
    if (!this.geoSupported) return false;
    this.stopWatch();
    try {
      this._watchId = navigator.geolocation.watchPosition(
        (p) => onPos({
          lat: p.coords.latitude, lng: p.coords.longitude,
          acc: p.coords.accuracy, alt: p.coords.altitude,
          speed: p.coords.speed,
        }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 8000 }
      );
      return true;
    } catch (e) { return false; }
  },
  stopWatch() {
    if (this._watchId != null) {
      try { navigator.geolocation.clearWatch(this._watchId); } catch (e) {}
      this._watchId = null;
    }
  },

  /* ---------------- Motion (IMU: accel Z + gyro) ---------------- */
  motionSupported: typeof DeviceMotionEvent !== "undefined",
  motionPermission: null, // null=unknown, true/false after gesture ask

  // iOS 13+ requires this inside a user gesture. Android/desktop no-op true.
  async requestMotionPermission() {
    if (!this.motionSupported) { this.motionPermission = false; return false; }
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        this.motionPermission = (res === "granted");
      } catch (e) { this.motionPermission = false; }
    } else {
      this.motionPermission = true;
    }
    return this.motionPermission;
  },

  _motionHandler: null,
  // onSample({ z, mag, rot:{alpha,beta,gamma}, t })
  startMotion(onSample) {
    if (!this.motionSupported || this.motionPermission === false) return false;
    this.stopMotion();
    this._motionHandler = (ev) => {
      const a = ev.accelerationIncludingGravity || ev.acceleration;
      if (!a) return;
      const rr = ev.rotationRate || {};
      onSample({
        z: a.z || 0,
        mag: Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2),
        rot: { alpha: rr.alpha || 0, beta: rr.beta || 0, gamma: rr.gamma || 0 },
        t: performance.now(),
      });
    };
    window.addEventListener("devicemotion", this._motionHandler, true);
    return true;
  },
  stopMotion() {
    if (this._motionHandler) {
      window.removeEventListener("devicemotion", this._motionHandler, true);
      this._motionHandler = null;
    }
  },

  /* ---------------- Acoustic baseline (Web Audio) ----------------
     Created ONLY from the Start Tracking gesture. Low Power Mode
     skips this entirely (engine falls back to IMU-only). */
  audioSupported: !!(window.AudioContext || window.webkitAudioContext),
  _audioCtx: null, _analyser: null, _audioStream: null, _audioBuf: null,
  async initAudio() {
    if (!this.audioSupported || !navigator.mediaDevices) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this._audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._audioCtx = new AC();
      const src = this._audioCtx.createMediaStreamSource(this._audioStream);
      this._analyser = this._audioCtx.createAnalyser();
      this._analyser.fftSize = 512;
      src.connect(this._analyser);
      this._audioBuf = new Uint8Array(this._analyser.frequencyBinCount);
      return true;
    } catch (e) { this.stopAudio(); return false; }
  },
  // RMS level 0..1 of the current mic frame.
  audioLevel() {
    if (!this._analyser) return null;
    this._analyser.getByteTimeDomainData(this._audioBuf);
    let sum = 0;
    for (let i = 0; i < this._audioBuf.length; i++) {
      const v = (this._audioBuf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / this._audioBuf.length);
  },
  stopAudio() {
    if (this._audioStream) { this._audioStream.getTracks().forEach(t => t.stop()); this._audioStream = null; }
    if (this._audioCtx) { try { this._audioCtx.close(); } catch (e) {} this._audioCtx = null; }
    this._analyser = null;
  },

  /* ---------------- Geomagnetic (Generic Sensor API) ----------------
     Rare outside Android Chrome; engine treats null as "factor absent". */
  magSupported: "Magnetometer" in window,
  _mag: null, magReading: null,
  startMag() {
    if (!this.magSupported) return false;
    try {
      this._mag = new Magnetometer({ frequency: 20 });
      this._mag.addEventListener("reading", () => {
        this.magReading = {
          uT: Math.sqrt(this._mag.x ** 2 + this._mag.y ** 2 + this._mag.z ** 2),
          t: performance.now(),
        };
      });
      this._mag.start();
      return true;
    } catch (e) { this._mag = null; return false; }
  },
  stopMag() {
    if (this._mag) { try { this._mag.stop(); } catch (e) {} this._mag = null; }
    this.magReading = null;
  },

  /* ---------------- Voice dictation (raw transcript only) ----------------
     Used for optional capture captions. NO summarization or rewriting —
     the exact native transcript is what gets stored. */
  dictationSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  _dictation: null,
  startDictation(onText, onEnd) {
    if (!this.dictationSupported) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stopDictation();
    const r = new SR();
    r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text.trim());
    };
    r.onend = () => { this._dictation = null; onEnd && onEnd(); };
    r.onerror = () => {};
    try { r.start(); } catch (e) { return false; }
    this._dictation = r;
    return true;
  },
  stopDictation() {
    if (this._dictation) { const r = this._dictation; this._dictation = null; try { r.stop(); } catch (e) {} }
  },

  /* ---------------- Text-to-speech (proximity voice alerts) ---------------- */
  ttsSupported: "speechSynthesis" in window,
  speak(text) {
    if (!this.ttsSupported) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1; u.volume = 1;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  },

  /* ---------------- Camera ---------------- */
  camSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  _camStream: null,
  async startCamera(videoEl) {
    if (!this.camSupported) return false;
    try {
      this._camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = this._camStream;
      await videoEl.play();
      return true;
    } catch (e) { return false; }
  },
  stopCamera() {
    if (this._camStream) { this._camStream.getTracks().forEach(t => t.stop()); this._camStream = null; }
  },

  /* ---------------- Haptics ---------------- */
  vibrateSupported: !!navigator.vibrate,
  buzz(pattern = 60) {
    if (!this.vibrateSupported) return false;
    try { return navigator.vibrate(pattern); } catch (e) { return false; }
  },
};
