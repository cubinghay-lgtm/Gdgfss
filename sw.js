/* motio service worker — minimal cache-first shell so the app opens
   instantly and works offline. Map tiles + Supabase are always network
   (they have their own offline handling); we only precache the shell. */
const CACHE = "motio-shell-v2";
const SHELL = [
  "./", "./index.html", "./css/styles.css", "./manifest.json",
  "./vendor/leaflet/leaflet.js", "./vendor/leaflet/leaflet.css",
  "./vendor/supabase/supabase.min.js", "./vendor/leaflet/images/motio_logo1.png",
  "./js/civic.js", "./js/crypto.js", "./js/data.js", "./js/platform.js",
  "./js/learn.js", "./js/engine.js", "./js/weather.js", "./js/sync.js", "./js/app.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Never cache tiles, Supabase, or weather — always live.
  if (/tile\.openstreetmap|supabase\.co|api\.weather\.gov/.test(url.host + url.pathname)) return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok && url.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
