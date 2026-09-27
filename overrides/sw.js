const CACHE = 'arena-line-sync-v56';

const PRECACHE = [
  '/',
  '/app.js',
  '/app.css',
  '/theme.css',
  '/theme.mjs',
  '/team-emblem.mjs',
  '/settings.css',
  '/i18n.mjs',
  '/match-filter.mjs',
  '/sports.css',
  '/sports.mjs',
  '/bet-view.css',
  '/bet-view.mjs',
  '/event-view.css',
  '/event-view.mjs',
  '/share-coupon.css',
  '/share-coupon.mjs',
  '/ui.mjs',
  '/feed.mjs',
  '/account.mjs',
  '/settlement.mjs',
  '/results.mjs',
  '/lucide.min.js',
  '/manifest.webmanifest',
  '/assets/wordmark.png',
  '/assets/fonts/roboto-regular.ttf',
  '/assets/fonts/roboto-semibold.woff2',
  ...['favorite','football','tennis','table-tennis','hockey','esports','basketball','snooker','volleyball','lol','counter-strike','dota']
    .map(name => `/assets/icons/${name}.png`)
];

async function cacheFirst(request,{ignoreSearch=false,cacheMissing=false}={}) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request,{ignoreSearch});
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || (cacheMissing && response.status === 404))) {
    cache.put(request,response.clone()).catch(()=>{});
  }
  return response;
}

async function navigation(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      cache.put('/',response.clone()).catch(()=>{});
    }
    return response;
  } catch {
    return (await caches.match('/')) || Response.error();
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('arena-line-') && key !== CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigation(request));
    return;
  }

  if (url.pathname.startsWith('/api/media/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname === '/sw.js') {
    return;
  }

  event.respondWith(cacheFirst(request,{ignoreSearch:true}));
});
