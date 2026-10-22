// Offline support. The build (see vite.config.ts) fills in BUILD, a version
// that changes whenever any built file does, and FILES, everything the build
// produced. Each version caches all of its files when it installs, and once
// it takes over it deletes older versions' caches, so the cache holds one
// copy of the game instead of every version ever played.
const CACHE = `fpd-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', ...FILES])));
  // No skipWaiting(): an open page keeps the version it loaded (with its
  // cache) until every tab is closed, so a phone-lobby chunk it loads later
  // is still there. Reloading still shows the update, since pages come from
  // the network first.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Network first, so an update shows on reload; the cached page offline.
    event.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }
  // Built files have content hashes in their names, so cache-first is safe.
  // Anything not cached up front (a newer version's files, fetched by a page
  // loaded from the network) is just fetched.
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
