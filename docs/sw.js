// Service worker: makes the game installable and fully playable offline (vs bots).
//
//  • Code (html/js/css/json outside sprites/): network-first, bypassing the HTTP
//    cache, so a deploy never mixes old and new scripts; cached copy offline.
//  • Assets (sprites, sounds, maps): stale-while-revalidate for instant loads;
//    an atlas image and its JSON are treated the same way so they stay paired.
//  • On install, everything in precache.json is fetched in the background so
//    offline play works from the second visit on.
//  • socket.io traffic is never touched.
const CACHE = 'sar-cache-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'precache.json'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    self.skipWaiting();
    // Best-effort full precache; doesn't block activation.
    precacheAll(cache);
  })());
});

async function precacheAll(cache) {
  try {
    const list = await (await fetch('precache.json', { cache: 'no-cache' })).json();
    for (const f of list.files) {
      if (await cache.match(f)) continue;
      try { await cache.add(f); } catch (e) { /* skip missing/failed file */ }
    }
  } catch (e) { /* offline during install */ }
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isCode = (url) => !url.pathname.includes('/sprites/') && /\.(html|js|css|json|webmanifest)$/.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/socket.io/') || url.pathname.endsWith('/healthz')) return;

  // Only the game page itself is the offline shell (not /status or others).
  const isShell = req.mode === 'navigate' && /\/(index\.html)?$/.test(url.pathname);
  if (req.mode === 'navigate' && !isShell) return;

  if (isShell || isCode(url)) {
    const key = isShell ? 'index.html' : req;
    event.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); }
          return res;
        })
        .catch(() => caches.match(key, { ignoreSearch: true }).then(r => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const network = fetch(req)
          .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached || Response.error());
        if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
        return network;
      })
    )
  );
});
