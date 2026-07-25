/* ============================================================
   sync.js — private on-device staging + the community sync.

   Reports are encrypted on the phone the moment they're made
   (crypto.js), held in a private inbox, and only sent to the
   shared Novato map when the rider's settings allow it (either
   the background auto-send, or a tap to approve). Offline, they
   simply wait. The user never sees encryption jargon — see the
   plain-language statusText().

   Backend: Supabase project motio. Community reads come from the
   `hazards_scored` view (base confidence + community votes).
   ============================================================ */

const SUPABASE_URL = "https://qmlihmsgqassteijijvm.supabase.co";
const SUPABASE_KEY = "sb_publishable_d26Ca3mUMJM5Xf7dUVjd-g_j9DzHrXR";

const Sync = {
  client: null,
  configured: false,
  lastSyncAt: null,
  lastError: null,
  _loopId: null,
  onChange: null,

  init() {
    try {
      if (typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_KEY) {
        this.client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        this.configured = true;
      }
    } catch (e) { this.client = null; this.configured = false; }
    window.addEventListener("online", () => { this._emit(); this.flushIfAuto(); });
    window.addEventListener("offline", () => this._emit());
    return this.configured;
  },

  _emit() { try { this.onChange && this.onChange(); } catch (e) {} },

  // Plain-language sync status for the cloud icon's tap sheet.
  online() { return this.configured && navigator.onLine; },
  statusText() {
    if (!this.configured) return "Working on your phone only. Reports are saved here safely and will send when the map service is reachable.";
    if (!navigator.onLine) return "You're offline. New reports are saved privately on your phone and will send themselves the moment you're back online.";
    const last = this.lastSyncAt ? `Last sent ${timeAgo(this.lastSyncAt)}.` : "Nothing sent yet this session.";
    return `Connected to the Novato community map. ${last}`;
  },

  /* ---- encrypt-then-store (never plaintext at rest) ---- */
  async enqueue(payload, source) {
    const row = {
      id: "r" + Math.random().toString(36).slice(2, 10),
      createdAt: Date.now(),
      source: source || "manual",
      status: "pending",
      payload: await Vault.encryptRecord(payload),
    };
    await VaultDB.put(row);
    this._emit();
    return row.id;
  },
  async pending() { return (await VaultDB.all()).sort((a, b) => b.createdAt - a.createdAt); },
  async reveal(row) { try { return await Vault.decryptRecord(row.payload); } catch (e) { return null; } },
  async discard(id) { await VaultDB.remove(id); this._emit(); },

  /* ---- upload one report ---- */
  async uploadOne(row) {
    const p = await this.reveal(row);
    if (!p) { await VaultDB.remove(row.id); this._emit(); return { ok: false, reason: "corrupt" }; }
    if (!this.configured || !navigator.onLine) return { ok: false, reason: "offline", payload: p };
    try {
      const { error } = await this.client.from("hazards").insert({
        type: p.cat, subtype: p.subtype || null,
        lat: p.lat, lng: p.lng, severity: p.sev,
        note: p.note || null, photo_url: null,
        elevation: p.elevation != null ? p.elevation : null,
        zone: p.zoneId || null, source: row.source, status: "unverified",
      });
      if (error) { this.lastError = error.message; return { ok: false, reason: error.message, payload: p }; }
      await VaultDB.remove(row.id);
      this.lastSyncAt = Date.now(); this.lastError = null; this._emit();
      return { ok: true, payload: p };
    } catch (e) {
      this.lastError = String(e && e.message || e);
      return { ok: false, reason: this.lastError, payload: p };
    }
  },

  _flushing: false,
  async flush() {
    if (this._flushing) return [];
    this._flushing = true;
    const results = [];
    try { for (const row of await this.pending()) results.push({ id: row.id, ...(await this.uploadOne(row)) }); }
    finally { this._flushing = false; }
    return results;
  },
  flushIfAuto() {
    try {
      const s = JSON.parse(localStorage.getItem("motio.v1") || "{}");
      if (s.settings && s.settings.autoUpload) this.flush();
    } catch (e) {}
  },
  startLoop() { this.stopLoop(); this._loopId = setInterval(() => this.flushIfAuto(), 10 * 60 * 1000); },
  stopLoop() { if (this._loopId) { clearInterval(this._loopId); this._loopId = null; } },

  /* ---- community vote (INSERT-only, keeps no-anon-UPDATE rule) ---- */
  async confirm(hazardId, vote) {
    if (!this.configured || !navigator.onLine) return false;
    if (!/^[0-9a-f-]{36}$/.test(hazardId)) return true; // local/seed pin: no remote row yet
    try {
      const { error } = await this.client.from("confirmations").insert({ hazard_id: hazardId, vote: vote >= 0 ? 1 : -1 });
      return !error;
    } catch (e) { return false; }
  },

  /* ---- community pull: scored + pruned ---- */
  async fetchCommunity(limit = 300) {
    if (!this.configured || !navigator.onLine) return [];
    try {
      const { data, error } = await this.client
        .from("hazards_scored")
        .select("id,type,subtype,lat,lng,severity,note,zone,source,status,confidence,vote_count,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      const now = Date.now();
      return data
        .map(r => ({
          id: r.id, cat: r.type, subtype: r.subtype || "", lat: r.lat, lng: r.lng,
          sev: r.severity, status: r.status, confidence: r.confidence, votes: r.vote_count,
          note: r.note || "", remote: true, createdAt: new Date(r.created_at).getTime(),
        }))
        // Prune stale, low-confidence, or resolved pins from the live map.
        .filter(h => h.confidence >= 25 && h.status !== "cleared" &&
          !(now - h.createdAt > 60 * 864e5 && h.votes === 0));
    } catch (e) { return []; }
  },
};

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + " min ago";
  if (d < 86400) return Math.floor(d / 3600) + " hr ago";
  return Math.floor(d / 86400) + " days ago";
}
