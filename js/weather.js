/* ============================================================
   weather.js — real environmental safety data for riders.

   Pulls active alerts and near-term wind from the U.S. National
   Weather Service (api.weather.gov) — free, no key, CORS-open.
   Results are cached 30 minutes in localStorage; offline it goes
   quiet (returns the last cache or nothing). Surfaced as a single
   non-intrusive banner, never a blocking dialog.
   ============================================================ */

const Weather = {
  KEY: "motio.weather.v1",
  TTL: 30 * 60 * 1000,
  _gridHourly: null,

  // Returns { banner: string|null, level: 'info'|'warn', alerts, wind } or null.
  async get(lat, lng) {
    const cached = this._cache();
    if (cached && Date.now() - cached.at < this.TTL) return cached.data;
    if (!navigator.onLine) return cached ? cached.data : null;
    try {
      const data = await this._fetch(lat, lng);
      localStorage.setItem(this.KEY, JSON.stringify({ at: Date.now(), data }));
      return data;
    } catch (e) {
      return cached ? cached.data : null;
    }
  },

  _cache() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch (e) { return null; }
  },

  async _fetch(lat, lng) {
    // 1) Active alerts for this point.
    const alertsRes = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lng.toFixed(4)}`,
      { headers: { Accept: "application/geo+json" } }).then(r => r.json()).catch(() => null);
    const alerts = (alertsRes && alertsRes.features || []).map(f => ({
      event: f.properties.event,
      severity: f.properties.severity,
      headline: f.properties.headline,
    }));

    // 2) Near-term wind from the gridpoint hourly forecast.
    let wind = null;
    try {
      if (!this._gridHourly) {
        const pts = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`).then(r => r.json());
        this._gridHourly = pts.properties.forecastHourly;
      }
      const hourly = await fetch(this._gridHourly).then(r => r.json());
      const now = hourly.properties.periods[0];
      const spd = parseInt(String(now.windSpeed).replace(/\D/g, "")) || 0;
      wind = { speed: spd, dir: now.windDirection, short: now.shortForecast };
    } catch (e) {}

    return this._compose(alerts, wind);
  },

  _compose(alerts, wind) {
    // An official alert always wins the banner.
    const bikeRelevant = alerts.find(a => /wind|flood|heat|smoke|air quality|winter|ice|thunder/i.test(a.event));
    if (bikeRelevant) {
      return { banner: bikeRelevant.headline || bikeRelevant.event, level: "warn", alerts, wind };
    }
    // Otherwise flag strong wind for cyclists (~25+ mph is a real handling risk).
    if (wind && wind.speed >= 25) {
      return { banner: `Strong wind — around ${wind.speed} mph from the ${wind.dir}. Watch for gusts and branches.`, level: "warn", alerts, wind };
    }
    // A gentle heads-up only when wind is genuinely breezy; stay silent on calm
    // days so the banner reads as a real warning, not noise.
    if (wind && wind.speed >= 15) {
      return { banner: `Breezy — wind ${wind.speed} mph from the ${wind.dir}.`, level: "info", alerts, wind };
    }
    return { banner: null, level: "info", alerts, wind };
  },
};
