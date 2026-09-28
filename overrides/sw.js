const CACHE = 'arena-line-sync-v110';

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
  '/assets/icons/esports-controller-clean-v79.png',
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

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache:'no-store' });
    if (response && response.ok) {
      cache.put(request,response.clone()).catch(()=>{});
    }
    return response;
  } catch {
    return (await cache.match(request,{ignoreSearch:false})) || (await cache.match(request,{ignoreSearch:true})) || Response.error();
  }
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
      .then(async () => {
        const clients = await self.clients.matchAll({type:'window',includeUncontrolled:true});
        await Promise.all(clients.map(client => client.navigate(client.url).catch(()=>{})));
      })
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

  if (/\.(?:js|mjs|css|webmanifest)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request,{ignoreSearch:false}));
});
