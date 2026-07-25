/* ============================================================
   learn.js — motio's on-device learning classifier.

   A small, honest online model: multinomial logistic regression
   over the four hazard categories (branch / pothole / trash /
   other). It runs entirely in the browser, learns incrementally
   from the rider's own corrections, and persists to localStorage.
   No server, no dependency, no neural-net theatre — just a
   handful of weights nudged by gradient descent as the user
   confirms or edits detections.

   The engine blends this with its physics heuristic:
     p(class) = alpha * model + (1 - alpha) * heuristic
   where alpha rises with how much the model has been taught, so
   a fresh install trusts physics and a seasoned one trusts the
   rider. Training signals: a pencil-edit correction (strong), an
   accepted auto-detection (weak).
   ============================================================ */

const Learn = {
  CLASSES: ["branch", "pothole", "trash", "other"],
  DIM: 10,                 // feature vector length (see vectorize)
  W: null,                 // CLASSES x (DIM+1) weight matrix (last col = bias)
  trainCount: 0,
  LR: 0.06,
  KEY: "motio.ml.v1",

  init() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || "null");
      if (raw && raw.W && raw.W.length === this.CLASSES.length && raw.W[0].length === this.DIM + 1) {
        this.W = raw.W; this.trainCount = raw.n || 0; return;
      }
    } catch (e) {}
    // Small random init keeps classes distinguishable before any training.
    this.W = this.CLASSES.map(() => Array.from({ length: this.DIM + 1 }, () => (Math.random() - 0.5) * 0.02));
    this.trainCount = 0;
  },
  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify({ W: this.W, n: this.trainCount })); } catch (e) {}
  },

  // Turn the engine's raw feature object into a bounded vector. Order is a
  // contract shared with training; keep it stable.
  vectorize(f) {
    const thr = f.thr || 4.5;
    const v = [
      clampf((f.peakDev || 0) / thr / 3, 0, 1),     // impact strength
      clampf((f.peaks || 0) / 6, 0, 1),             // oscillation count
      clampf((f.durMs || 0) / 1000, 0, 1),          // event duration
      clampf((f.rotMean || 0) / 200, 0, 1),         // average rotation
      clampf((f.rotPeak || 0) / 400, 0, 1),         // peak rotation
      clampf((f.magDelta || 0) / 50, 0, 1),         // magnetic swing (metal)
      clampf((f.audioImpulse || 1) / 4, 0, 1),      // acoustic spike
      clampf(f.sharpness || 0, 0, 1),               // jerk / sharpness
      clampf((f.speedAt || 0) / 22, 0, 1),          // speed at event
      clampf(((f.slope || 0) + 20) / 40, 0, 1),     // terrain slope (-20..20%)
    ];
    return v;
  },

  _logits(v) {
    return this.W.map(row => {
      let s = row[this.DIM]; // bias
      for (let i = 0; i < this.DIM; i++) s += row[i] * v[i];
      return s;
    });
  },
  _softmax(logits) {
    const m = Math.max(...logits);
    const ex = logits.map(l => Math.exp(l - m));
    const sum = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map(e => e / sum);
  },

  // Predict probabilities for each category from engine features.
  predict(f) {
    const v = this.vectorize(f);
    const probs = this._softmax(this._logits(v));
    const out = {};
    this.CLASSES.forEach((c, i) => out[c] = probs[i]);
    return out;
  },

  // How much to trust the model vs the heuristic (0..0.65).
  alpha() { return Math.min(0.65, this.trainCount / 200); },

  // One SGD step toward `cls` (a category string). weight scales the step:
  // 1.0 for an explicit user correction, ~0.3 for an accepted detection.
  train(f, cls, weight = 1) {
    const idx = this.CLASSES.indexOf(cls);
    if (idx < 0) return;
    const v = this.vectorize(f);
    const probs = this._softmax(this._logits(v));
    for (let k = 0; k < this.CLASSES.length; k++) {
      const target = k === idx ? 1 : 0;
      const err = (target - probs[k]) * weight * this.LR;
      for (let i = 0; i < this.DIM; i++) this.W[k][i] += err * v[i];
      this.W[k][this.DIM] += err; // bias
    }
    this.trainCount++;
    this._save();
  },

  reset() { localStorage.removeItem(this.KEY); this.init(); },
};

function clampf(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

Learn.init();
