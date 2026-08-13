/**
 * Service worker della PWA Wdeck.
 *
 * Strategia:
 *  - app shell (HTML/CSS/JS/icone): cache-first con aggiornamento in background;
 *  - qualunque cosa sotto /api/ o /ws: sempre rete, mai cache.
 *
 * Il segnaposto __WDECK_BUILD__ viene sostituito con l'hash della build da
 * scripts/build-web.mjs, cosi' ogni build invalida la cache precedente.
 */

const BUILD = '__WDECK_BUILD__';
const CACHE = `wdeck-shell-${BUILD}`;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './icons.js',
  './i18n.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  '/shared/protocol.mjs'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
