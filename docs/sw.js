// Service worker: makes the game installable and playable offline (vs bots).
//  • Navigations: network-first (always get the latest page), cache fallback.
//  • Code (js/css/json/html): network-first, so a deploy never mixes old and new scripts.
//  • Heavy assets (sprites, sounds, maps): stale-while-revalidate for instant loads.
//  • socket.io traffic is never cached.
const VERSION = 'sar-v2';
const CORE = [
  './',
  'index.html',
  'css/style.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'data/weapons.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/socket.io/') || url.pathname.endsWith('/healthz')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('index.html', copy)); return res; })
        .catch(() => caches.match('index.html'))
    );
    return;
  }

  if (/\.(js|css|json|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      fetch(req)
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then(r => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req).then(cached => {
        const network = fetch(req)
          .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached || Response.error());
        return cached || network;
      })
    )
  );
});
