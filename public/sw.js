const CACHE = "loomkey-shell-v2";
const SHELL = [
  "/listings",
  "/billing",
  "/dashboard",
  "/install",
  "/js/pwa.js",
  "/js/session.js",
  "/js/loomkey-flutterwave.js",
  "/manifest.webmanifest",
  "/img/bg.jpg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("/listings")))
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Loomkey", body: "You have a new update.", url: "/listings", tag: "loomkey" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (err) {
    data.body = event.data ? event.data.text() : data.body;
  }
  const show = self.registration.showNotification(data.title, {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.tag || "loomkey",
    renotify: true,
    data: { url: data.url || "/listings" },
  });
  const ping = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: "loomkey-push", title: data.title, body: data.body, url: data.url || "/listings" });
    });
  });
  event.waitUntil(Promise.all([show, ping]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/listings";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
