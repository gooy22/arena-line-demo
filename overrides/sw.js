const CACHE = 'arena-line-sync-v44';
const ASSETS = ['/assets/icons/esports-transparent.png', '/theme.css?v=44', '/theme.mjs', '/team-emblem.mjs', '/settings.css?v=44', '/i18n.mjs', '/match-filter.mjs', '/', '/app.js?v=44', '/app.css?v=44', '/sports.css?v=44', '/bet-view.css?v=44', '/event-view.css?v=44', '/share-coupon.css?v=44', '/share-coupon.mjs', '/sports.mjs', '/ui.mjs', '/feed.mjs', '/account.mjs', '/settlement.mjs', '/results.mjs', '/event-view.mjs', '/bet-view.mjs', '/lucide.min.js', '/manifest.webmanifest', '/assets/wordmark.png', '/assets/fonts/roboto-regular.ttf', '/assets/fonts/roboto-semibold.woff2', ...['favorite','football','tennis','table-tennis','hockey','esports','basketball','snooker','volleyball','lol','counter-strike','dota'].map(name => `/assets/icons/${name}.png`)];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('arena-line-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.match(event.request, { ignoreSearch: true })) || Response.error()));
});
