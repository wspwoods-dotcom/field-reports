/* Field Reports — service worker (prototype)
 * Caches the app shell so the app opens and works offline in dead zones.
 * No user data ever passes through here — reports live in localStorage
 * on the device only. There is no backend in this prototype.
 */
var SHELL_CACHE = 'field-reports-shell-v3';

var SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/orgs.js',
  './js/orgmap.js',
  './js/app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/greene-county-conservation-logo.jpg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = req.url;
  if (url.indexOf(self.location.origin) === 0) {
    /* app shell: network-first, cache fallback — always newest code online */
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          if (req.mode === 'navigate') return caches.match('./index.html');
          throw new Error('offline and not cached: ' + url);
        });
      })
    );
  }
});
