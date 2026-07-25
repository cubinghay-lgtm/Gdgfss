/* ============================================================
   platform.js — device + sensor abstraction for motio.

   ONE job: give the rest of the app a clean, uniform sensor
   surface that works on Android Chrome and iOS Safari, and
   degrades to "not available on this device" on desktop —
   never crashing, never blocking the non-sensor features.

   Detection is feature-first (what the browser actually
   exposes), with the user-agent used only to break ties.
   Every permission-gated API (motion on iOS, camera, mic,
   notifications) is requested INSIDE a user gesture by the
   caller — nothing here fires on page load.

   Consumed by engine.js (motion stream) and app.js (geo,
   camera, notifications, heading, speech, haptics).
   ============================================================ */

const Platform = {
  os: "desktop",        // 'ios' | 'android' | 'desktop' | 'other'
  isMobile: false,
  caps: {},

  detect() {
    const ua = navigator.userAgent || "";
    const iOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS masquerades as Mac
    const android = /Android/.test(ua);
    const touch = (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;

    if (iOS) this.os = "ios";
    else if (android) this.os = "android";
    else if (touch && /Mobi/.test(ua)) this.os = "other";
    else this.os = "desktop";
    this.isMobile = this.os === "ios" || this.os === "android" || this.os === "other";

    this.caps = {
      // Motion: iOS exposes DeviceMotionEvent but needs a permission gesture;
      // Android additionally exposes the Generic Sensor API (cleaner signal).
      motion: typeof DeviceMotionEvent !== "undefined",
      motionNeedsPermission: typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function",
      genericAccel: "LinearAccelerationSensor" in window,
      genericGyro: "Gyroscope" in window,
      compassIOS: false, // learned at runtime from the first orientation event
      genericMag: "Magnetometer" in window || "AbsoluteOrientationSensor" in window,
      geolocation: "geolocation" in navigator,
      camera: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      notifications: "Notification" in window,
      ambientLight: "AmbientLightSensor" in window, // Android flag-gated; absent on iOS
      vibration: !!navigator.vibrate,
      tts: "speechSynthesis" in window,
      dictation: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      wakeLock: "wakeLock" in navigator,
    };
    return this;
  },

  // Plain-language summary of what this device can do (for the waiver/settings,
  // no API names). Kept short on purpose.
  sensingSummary() {
    if (this.os === "android")
      return "This phone can sense bumps and impacts automatically while you bike, and can send you alerts.";
    if (this.os === "ios")
      return "This iPhone can sense bumps while you bike after you allow motion access, and can alert you when installed to your Home Screen.";
    return "You're on a desktop browser — you can view the map and add reports by hand, but automatic bump sensing needs a phone.";
  },

  /* ================= Motion (impact sensing) ================= */
  motionGranted: false,
  _genericAccel: null, _genericGyro: null, _domHandler: null, _rot: { alpha: 0, beta: 0, gamma: 0 },

  // Ask for motion access. iOS shows a prompt (must be in a gesture);
  // Android/desktop resolve immediately. Returns true if usable.
  async requestMotion() {
    if (!this.caps.motion && !this.caps.genericAccel) { this.motionGranted = false; return false; }
    if (this.caps.motionNeedsPermission) {
      try {
        const res = await DeviceMotionEvent.requestPermission();
        this.motionGranted = res === "granted";
      } catch (e) { this.motionGranted = false; }
    } else {
      this.motionGranted = true;
    }
    return this.motionGranted;
  },

  // onSample({ z, mag, rot:{alpha,beta,gamma}, t }) — z is vertical acceleration
  // with gravity removed where the platform provides it (Android linear-accel),
  // otherwise raw. Baseline-relative, so both are fine for the detector.
  startMotion(onSample) {
    this.stopMotion();
    // Android: Generic Sensor API — steadier 60 Hz, gravity already removed.
    if (this.caps.genericAccel) {
      try {
        this._genericAccel = new LinearAccelerationSensor({ frequency: 60 });
        if (this.caps.genericGyro) {
          this._genericGyro = new Gyroscope({ frequency: 60 });
          this._genericGyro.addEventListener("reading", () => {
            this._rot = { alpha: this._genericGyro.z || 0, beta: this._genericGyro.x || 0, gamma: this._genericGyro.y || 0 };
          });
          this._genericGyro.start();
        }
        this._genericAccel.addEventListener("reading", () => {
          const x = this._genericAccel.x || 0, y = this._genericAccel.y || 0, z = this._genericAccel.z || 0;
          onSample({ z, mag: Math.sqrt(x * x + y * y + z * z), rot: this._rot, t: performance.now() });
        });
        this._genericAccel.addEventListener("error", () => { this._fallbackMotion(onSample); });
        this._genericAccel.start();
        return true;
      } catch (e) { /* fall through */ }
    }
    return this._fallbackMotion(onSample);
  },
  _fallbackMotion(onSample) {
    if (!this.caps.motion) return false;
    this._domHandler = (ev) => {
      const a = ev.acceleration && ev.acceleration.z != null ? ev.acceleration : ev.accelerationIncludingGravity;
      if (!a) return;
      const rr = ev.rotationRate || {};
      onSample({
        z: a.z || 0,
        mag: Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2),
        rot: { alpha: rr.alpha || 0, beta: rr.beta || 0, gamma: rr.gamma || 0 },
        t: performance.now(),
      });
    };
    window.addEventListener("devicemotion", this._domHandler, true);
    return true;
  },
  stopMotion() {
    if (this._genericAccel) { try { this._genericAccel.stop(); } catch (e) {} this._genericAccel = null; }
    if (this._genericGyro) { try { this._genericGyro.stop(); } catch (e) {} this._genericGyro = null; }
    if (this._domHandler) { window.removeEventListener("devicemotion", this._domHandler, true); this._domHandler = null; }
  },

  /* ================= Heading (which way the rider faces) ================= */
  _headingHandler: null, _mag: null, heading: null,
  startHeading(onHeading) {
    this.stopHeading();
    // iOS: webkitCompassHeading rides on deviceorientation (needs the motion grant).
    this._headingHandler = (ev) => {
      let h = null;
      if (typeof ev.webkitCompassHeading === "number") { this.caps.compassIOS = true; h = ev.webkitCompassHeading; }
      else if (ev.absolute && typeof ev.alpha === "number") h = 360 - ev.alpha;
      if (h != null) { this.heading = h; onHeading && onHeading(h); }
    };
    window.addEventListener("deviceorientation", this._headingHandler, true);
    return true;
  },
  stopHeading() {
    if (this._headingHandler) { window.removeEventListener("deviceorientation", this._headingHandler, true); this._headingHandler = null; }
  },

  /* ================= Location ================= */
  _watchId: null,
  getPosition() {
    return new Promise((resolve) => {
      if (!this.caps.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(this._pos(p)),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000 }
      );
    });
  },
  startWatch(onPos) {
    if (!this.caps.geolocation) return false;
    this.stopWatch();
    try {
      this._watchId = navigator.geolocation.watchPosition(
        (p) => onPos(this._pos(p)), () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 9000 });
      return true;
    } catch (e) { return false; }
  },
  stopWatch() { if (this._watchId != null) { try { navigator.geolocation.clearWatch(this._watchId); } catch (e) {} this._watchId = null; } },
  _pos(p) {
    return { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, alt: p.coords.altitude, speed: p.coords.speed };
  },

  /* ================= Camera (rear, for hazard photos) ================= */
  _camStream: null, _camVideo: null,
  async prewarmCamera() {
    if (!this.caps.camera) return false;
    try {
      this._camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.setAttribute("playsinline", "");
      v.srcObject = this._camStream; await v.play().catch(() => {});
      this._camVideo = v;
      return true;
    } catch (e) { this.stopCamera(); return false; }
  },
  // Returns a JPEG data URL, or null. Non-blocking to the detection path.
  snapPhoto() {
    const v = this._camVideo;
    if (!v || !v.videoWidth) return null;
    try {
      const c = document.createElement("canvas");
      const scale = Math.min(1, 960 / v.videoWidth);
      c.width = v.videoWidth * scale; c.height = v.videoHeight * scale;
      const ctx = c.getContext("2d");
      ctx.drawImage(v, 0, 0, c.width, c.height);
      // Cheap quality gate: reject frames that are near-black or blown out.
      const q = this._brightness(ctx, c.width, c.height);
      if (q < 0.06 || q > 0.97) return null;
      return c.toDataURL("image/jpeg", 0.68);
    } catch (e) { return null; }
  },
  _brightness(ctx, w, h) {
    try {
      const d = ctx.getImageData(0, 0, Math.min(w, 64), Math.min(h, 64)).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return s / (d.length / 4) / 255;
    } catch (e) { return 0.5; }
  },
  // For the manual capture sheet: attach the live stream to a visible element.
  async attachCamera(videoEl) {
    if (!this.caps.camera) return false;
    try {
      if (!this._camStream) this._camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      videoEl.srcObject = this._camStream; await videoEl.play();
      return true;
    } catch (e) { return false; }
  },
  stopCamera() {
    if (this._camStream) { this._camStream.getTracks().forEach(t => t.stop()); this._camStream = null; }
    this._camVideo = null;
  },

  /* ================= Notifications (proximity alerts) ================= */
  async requestNotify() {
    if (!this.caps.notifications) return false;
    try { const r = await Notification.requestPermission(); return r === "granted"; }
    catch (e) { return false; }
  },
  notify(title, body) {
    if (this.caps.notifications && Notification.permission === "granted") {
      try { new Notification(title, { body, tag: "motio-proximity", silent: false }); return true; } catch (e) {}
    }
    return false;
  },

  /* ================= Ambient light (Android only; silent no-op elsewhere) ==== */
  _light: null,
  startLight(onLux) {
    if (!this.caps.ambientLight) return false;
    try {
      this._light = new AmbientLightSensor({ frequency: 1 });
      this._light.addEventListener("reading", () => onLux(this._light.illuminance));
      this._light.addEventListener("error", () => this.stopLight());
      this._light.start();
      return true;
    } catch (e) { this._light = null; return false; }
  },
  stopLight() { if (this._light) { try { this._light.stop(); } catch (e) {} this._light = null; } },

  /* ================= Speech, dictation, haptics ================= */
  speak(text) {
    if (!this.caps.tts) return false;
    try { const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); return true; }
    catch (e) { return false; }
  },
  buzz(pattern = 60) { if (!this.caps.vibration) return false; try { return navigator.vibrate(pattern); } catch (e) { return false; } },

  _dictation: null,
  startDictation(onText, onEnd) {
    if (!this.caps.dictation) return false;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.stopDictation();
    const r = new SR(); r.continuous = false; r.interimResults = true; r.lang = "en-US";
    r.onresult = (e) => { let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript; onText(t.trim()); };
    r.onend = () => { this._dictation = null; onEnd && onEnd(); };
    r.onerror = () => {};
    try { r.start(); } catch (e) { return false; }
    this._dictation = r; return true;
  },
  stopDictation() { if (this._dictation) { const r = this._dictation; this._dictation = null; try { r.stop(); } catch (e) {} } },
};

Platform.detect();
