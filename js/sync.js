/* ============================================================
   sync.js — Encrypted inbox + the 10-minute Supabase loop.

   Flow (per spec):
     detect/capture -> encrypt (crypto.js) -> local Inbox (IDB)
       Auto-Upload ON : a 10-minute timer decrypts pending items
                        and inserts them into Supabase `hazards`.
       Auto-Upload OFF: items persist until manually approved in
                        the Review screen (manual approve = same
                        upload path, per item).
     Offline: items wait; the `online` event triggers a flush.

   The Supabase client is the vendored UMD build loaded via a
   plain <script> tag (vendor/supabase/supabase.min.js). If the
   library or network is unavailable the app still works fully
   locally — uploads simply wait.

   Photos stay on-device (inside the encrypted payload); rows are
   uploaded with photo_url = null until a storage bucket is added.
   ============================================================ */

/* ---- Live project config (created via Supabase MCP, 2026-07-17) ---- */
const SUPABASE_URL = "https://qmlihmsgqassteijijvm.supabase.co";
const SUPABASE_KEY = "sb_publishable_d26Ca3mUMJM5Xf7dUVjd-g_j9DzHrXR";

const Sync = {
  client: null,
  configured: false,
  lastSyncAt: null,
  lastError: null,
  _loopId: null,
  onChange: null, // app hook: called after any inbox/sync mutation

  init() {
    try {
      if (typeof supabase !== "undefined" && SUPABASE_URL && SUPABASE_KEY) {
        this.client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        this.configured = true;
      }
    } catch (e) { this.client = null; this.configured = false; }
    // Offline data waits until connectivity is restored.
    window.addEventListener("online", () => this.flushIfAuto());
    return this.configured;
  },

  _emit() { try { this.onChange && this.onChange(); } catch (e) {} },

  /* ---- enqueue: encrypt-then-store (never plaintext at rest) ---- */
  async enqueue(payload, source) {
    const row = {
      id: "r" + Math.random().toString(36).slice(2, 10),
      createdAt: Date.now(),
      source: source || "manual", // 'auto' (engine) | 'manual' (FAB)
      status: "pending",
      payload: await Vault.encryptRecord(payload),
    };
    await VaultDB.put(row);
    this._emit();
    return row.id;
  },

  async pending() { return (await VaultDB.all()).sort((a, b) => b.createdAt - a.createdAt); },

  // Decrypt one inbox row for in-app display (Review screen).
  async reveal(row) {
    try { return await Vault.decryptRecord(row.payload); }
    catch (e) { return null; }
  },

  async discard(id) { await VaultDB.remove(id); this._emit(); },

  /* ---- upload one decrypted record to Supabase ---- */
  async uploadOne(row) {
    const p = await this.reveal(row);
    if (!p) { await VaultDB.remove(row.id); this._emit(); return { ok: false, reason: "corrupt" }; }
    if (!this.configured || !navigator.onLine) return { ok: false, reason: "offline", payload: p };
    try {
      const { error } = await this.client.from("hazards").insert({
        type: p.cat, lat: p.lat, lng: p.lng, severity: p.sev,
        note: p.note || null, photo_url: null,
        zone: p.zoneId || null, source: row.source, status: "unverified",
      });
      if (error) { this.lastError = error.message; return { ok: false, reason: error.message, payload: p }; }
      await VaultDB.remove(row.id);
      this.lastSyncAt = Date.now();
      this.lastError = null;
      this._emit();
      return { ok: true, payload: p };
    } catch (e) {
      this.lastError = String(e && e.message || e);
      return { ok: false, reason: this.lastError, payload: p };
    }
  },

  /* ---- flush all pending (auto loop / reconnect / manual "sync now") ---- */
  _flushing: false,
  async flush() {
    if (this._flushing) return [];
    this._flushing = true;
    const results = [];
    try {
      for (const row of await this.pending()) {
        results.push({ id: row.id, ...(await this.uploadOne(row)) });
      }
    } finally { this._flushing = false; }
    return results;
  },
  flushIfAuto() {
    try {
      const s = JSON.parse(localStorage.getItem("motio.v1") || "{}");
      if (s.settings && s.settings.autoUpload) this.flush();
    } catch (e) {}
  },

  /* ---- the 10-minute loop ---- */
  startLoop() {
    this.stopLoop();
    this._loopId = setInterval(() => this.flushIfAuto(), 10 * 60 * 1000);
  },
  stopLoop() { if (this._loopId) { clearInterval(this._loopId); this._loopId = null; } },

  /* ---- community pull: recent verified/unverified reports ---- */
  async fetchCommunity(limit = 200) {
    if (!this.configured || !navigator.onLine) return [];
    try {
      const { data, error } = await this.client
        .from("hazards")
        .select("id,type,lat,lng,severity,note,zone,source,status,created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return data.map(r => ({
        id: "sb_" + r.id, cat: r.type, lat: r.lat, lng: r.lng,
        sev: r.severity, status: r.status, votes: 1,
        note: r.note || "", remote: true,
        createdAt: new Date(r.created_at).getTime(),
      }));
    } catch (e) { return []; }
  },
};
