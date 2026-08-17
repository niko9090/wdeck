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
  // Nessun .catch sull'addAll: se il precache fallisce l'installazione deve
  // fallire con lui, cosi' il vecchio service worker (funzionante) resta attivo
  // e il browser ritenta piu' tardi. Attivare uno shell incompleto romperebbe
  // l'offline in silenzio.
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      const stale = keys.filter((k) => k !== CACHE && k.startsWith('wdeck-shell-'));
      return Promise.all(stale.map((k) => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          // Solo quando c'era gia' una build precedente (aggiornamento vero, non
          // primo avvio) si avvisano le pagine: la strategia stale-while-revalidate
          // servirebbe altrimenti il vecchio app.js/index.html senza dirlo a nessuno.
          if (stale.length === 0) return undefined;
          return self.clients.matchAll({ type: 'window' }).then((clients) => {
            for (const client of clients) client.postMessage({ type: 'wdeck-shell-updated' });
          });
        });
    })
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
