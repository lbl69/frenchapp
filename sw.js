// Service worker : met l'application en cache pour qu'elle s'ouvre sans connexion.
// Les poids des modèles sont mis en cache séparément par WebLLM (Cache Storage).
const VERSION = "v3";
const CACHE = `tuteur-langues-${VERSION}`;
const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/app.js",
  "js/engines.js",
  "js/prompt.js",
  "js/markdown.js",
  "vendor/web-llm/index.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tuteur-langues-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // La bibliothèque WebLLM (6 Mo) ne change qu'avec la version : cache d'abord.
  if (url.pathname.includes("/vendor/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }

  // Le reste : réseau d'abord (pour recevoir les mises à jour), cache si hors-ligne.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))
      )
  );
});
