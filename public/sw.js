// Service Worker: cache + push notifications
const CACHE = "cliniagenda-pwa-v2";
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

// Push notifications
self.addEventListener("push", (event) => {
  let data = { title: "CliniAgenda", body: "Tiene una nueva notificación", url: "./dashboard.html" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (e) { /* use defaults */ }

  const options = {
    body: data.body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    vibrate: [200, 100, 200],
    data: { url: data.url || "./dashboard.html" },
    tag: data.tag || "cliniagenda",
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./dashboard.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url.includes(BASE) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
