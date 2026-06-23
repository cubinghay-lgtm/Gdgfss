/* ============================================================
   sensors.js — Thin wrappers around real device APIs:
     • Geolocation        (navigator.geolocation)
     • Motion / Pulse      (DeviceMotionEvent accelerometer)
     • Voice trigger       (Web Speech Recognition)
     • Text-to-speech      (speechSynthesis)
     • Camera              (getUserMedia)
     • Haptics             (navigator.vibrate)
   Each one degrades gracefully so the desktop preview still
   works through simulation buttons in the UI.
   ============================================================ */

const Sensors = {
  /* ---------- GPS ---------- */
  geoSupported: "geolocation" in navigator,
  getPosition() {
    return new Promise((resolve) => {
      if (!this.geoSupported) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000 }
      );
    });
  },

  /* ---------- Haptics ---------- */
  buzz(pattern = 60) { if (navigator.vibrate) navigator.vibrate(pattern); },

  /* ---------- Text to speech ---------- */
  ttsSupported: "speechSynthesis" in window,
  speak(text) {
    if (!this.ttsSupported) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1; u.volume = 1;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch (e) {}
  },

  /* ---------- Accelerometer / Pulse engine ---------- */
  motionSupported: typeof DeviceMotionEvent !== "undefined",
  _motionHandler: null,
  // baseline magnitude (~9.8 gravity) and current smoothed reading
  baseline: 9.8,
  current: 0,
  async startMotion(onSample) {
    // iOS 13+ needs an explicit permission gesture.
    if (this.motionSupported && typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") return false;
      } catch (e) { return false; }
    }
    if (!this.motionSupported) return false;
    this.stopMotion();
    this._motionHandler = (ev) => {
      const a = ev.accelerationIncludingGravity || ev.acceleration;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      this.current = mag;
      onSample(mag);
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

  /* ---------- Voice trigger ("Log Danger") ---------- */
  _recognition: null,
  voiceSupported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  startVoice(onPhrase, onState) {
    if (!this.voiceSupported) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stopVoice();
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.toLowerCase();
        if (t.includes("log danger") || t.includes("log hazard") || t.includes("mark danger")) {
          onPhrase();
        }
      }
    };
    r.onend = () => { if (this._recognition) { try { r.start(); } catch (e) {} } };
    r.onerror = () => {};
    try { r.start(); } catch (e) {}
    this._recognition = r;
    onState && onState(true);
    return true;
  },
  stopVoice(onState) {
    if (this._recognition) {
      const r = this._recognition; this._recognition = null;
      try { r.stop(); } catch (e) {}
    }
    onState && onState(false);
  },

  /* ---------- Camera ---------- */
  camSupported: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  _stream: null,
  async startCamera(videoEl) {
    if (!this.camSupported) return false;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = this._stream;
      await videoEl.play();
      return true;
    } catch (e) { return false; }
  },
  stopCamera() {
    if (this._stream) { this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
  },
};
