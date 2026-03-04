const CACHE = "kml-nav-v2";

// GitHub Pages’de /repo-adi/ altında çalışır.
// Base path’i otomatik bul: örn "/kml-navigator/"
const BASE = new URL("./", self.location).pathname.replace(/\/$/, "");
const ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/style.css`,
  `${BASE}/app.js`,
  `${BASE}/manifest.webmanifest`,
  `${BASE}/sw.js`,
  `${BASE}/icons/logo.jpg`,
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => caches.match(`${BASE}/index.html`)))
  );
});
