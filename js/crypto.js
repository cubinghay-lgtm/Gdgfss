/* ============================================================
   crypto.js — Local encryption for captured hazard payloads.

   All user-captured data (GPS coordinates, raw notes, photos)
   is encrypted with native Web Crypto AES-256-GCM *before* it
   touches IndexedDB. A per-device key is generated on first
   run and stored as a JWK. A fresh random 96-bit IV is used
   for every record.

   Exposes:
     Vault.encryptRecord(obj)  -> { v, alg, iv, ct }   (base64)
     Vault.decryptRecord(rec)  -> obj
     VaultDB.put/all/get/remove/count — encrypted inbox store
   ============================================================ */

const Vault = {
  supported: !!(window.crypto && crypto.subtle),
  _key: null,

  /* ---- key management (per-device AES-256-GCM key as JWK) ---- */
  async key() {
    if (!this.supported) throw new Error("WebCrypto unavailable");
    if (this._key) return this._key;
    const stored = localStorage.getItem("motio.vault.jwk");
    if (stored) {
      try {
        this._key = await crypto.subtle.importKey(
          "jwk", JSON.parse(stored), { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
        return this._key;
      } catch (e) { /* corrupted key -> regenerate below */ }
    }
    const k = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    localStorage.setItem("motio.vault.jwk", JSON.stringify(await crypto.subtle.exportKey("jwk", k)));
    this._key = k;
    return k;
  },

  /* ---- base64 helpers (chunked: photos can be hundreds of KB) ---- */
  _toB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  },
  _fromB64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },

  /* ---- encrypt / decrypt a JSON-serializable record ---- */
  async encryptRecord(obj) {
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return { v: 1, alg: "AES-256-GCM", iv: this._toB64(iv), ct: this._toB64(ct) };
  },
  async decryptRecord(rec) {
    const key = await this.key();
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: this._fromB64(rec.iv) }, key, this._fromB64(rec.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  },
};

/* ---------------- Encrypted inbox store (IndexedDB) ----------------
   Rows: { id, createdAt, source: 'auto'|'manual', status: 'pending',
           payload: {v,alg,iv,ct} }.
   Only non-sensitive scheduling metadata is plaintext; the hazard
   itself (GPS, note, photo, category) lives inside `payload`. */

const VaultDB = {
  _db: null,
  open() {
    return new Promise((resolve) => {
      if (this._db) return resolve(this._db);
      if (!("indexedDB" in window)) return resolve(null);
      const req = indexedDB.open("motio-vault", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("inbox", { keyPath: "id" });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => resolve(null);
    });
  },
  async put(row) {
    const db = await this.open(); if (!db) return false;
    return new Promise((res) => {
      const tx = db.transaction("inbox", "readwrite");
      tx.objectStore("inbox").put(row);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  },
  async all() {
    const db = await this.open(); if (!db) return [];
    return new Promise((res) => {
      const req = db.transaction("inbox", "readonly").objectStore("inbox").getAll();
      req.onsuccess = () => res(req.result || []);
      req.onerror = () => res([]);
    });
  },
  async remove(id) {
    const db = await this.open(); if (!db) return false;
    return new Promise((res) => {
      const tx = db.transaction("inbox", "readwrite");
      tx.objectStore("inbox").delete(id);
      tx.oncomplete = () => res(true);
      tx.onerror = () => res(false);
    });
  },
  async count() { return (await this.all()).length; },
};
