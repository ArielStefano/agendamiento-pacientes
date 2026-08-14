// Service Worker: cache de la app para que sea instalable y funcione sin red
// Cambiar CACHE solo en releases que rompan compatibilidad con caché antigua.
const CACHE = "cliniagenda-pwa-v1";
const BASE = self.registration.scope;

const STATIC = [
  "index.html",
  "registro.html",
  "dashboard.html",
  "citas.html",
  "calendario.html",
  "pacientes.html",
  "medicos.html",
  "recordatorios.html",
  "offline.html",
  "css/style.css",
  "js/config.js",
  "js/layout.js",
  "js/app.js",
  "js/pwa.js",
  "js/dashboard.js",
  "js/citas.js",
  "js/calendario.js",
  "js/pacientes.js",
  "js/medicos.js",
  "js/recordatorios.js",
  "vendor/supabase.min.js",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
].map((f) => new URL(f, BASE).href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches
            .match(request)
            .then((r) => r || caches.match(new URL("index.html", BASE).href))
            .then((r) => r || caches.match(new URL("offline.html", BASE).href))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const red = fetch(request).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
      return cached || red;
    })
  );
});
