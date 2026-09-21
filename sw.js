/* Field Reports — service worker (prototype)
 * Caches the app shell so the app opens and works offline in dead zones.
 * Esri map tiles get a separate bounded cache so recently-viewed map areas
 * keep working without a connection (same pattern as Opossum Foot).
 * No user data ever passes through here — reports live in localStorage
 * on the device only. There is no backend in this prototype.
 */
var SHELL_CACHE = 'field-reports-shell-v13';
var TILE_CACHE = 'field-reports-tiles-v1';
var MAX_TILES = 400;

var SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/orgs.js',
  './js/orgmap.js',
  './js/trail.js',
  './js/app.js',
  './manifest.json',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/greene-county-conservation-logo.jpg',
  './assets/cats/tree.png',
  './assets/cats/pothole.png',
  './assets/cats/trail.png',
  './assets/cats/facility.png',
  './assets/cats/sign.png',
  './assets/cats/trash.png',
  './assets/cats/water.png',
  './assets/cats/animal.png',
  './assets/cats/vandalism.png',
  './assets/cats/mowing.png',
  './assets/cats/storm.png',
  './assets/cats/fence.png',
  './assets/cats/headstone.png',
  './assets/cats/cleaning.png',
  './assets/cats/other.png'
];

var TILE_HOSTS = [
  'server.arcgisonline.com',
  'unpkg.com'
];

function isTileRequest(url) {
  return TILE_HOSTS.some(function (h) { return url.indexOf(h) !== -1; });
}

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
        if (k !== SHELL_CACHE && k !== TILE_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function trimTiles() {
  caches.open(TILE_CACHE).then(function (cache) {
    cache.keys().then(function (keys) {
      if (keys.length > MAX_TILES) {
        var extra = keys.slice(0, keys.length - MAX_TILES);
        extra.forEach(function (k) { cache.delete(k); });
      }
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = req.url;

  /* map tiles + Leaflet CDN: cache-first, then network, bounded cache */
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            if (res && res.ok) {
              cache.put(req, res.clone());
              trimTiles();
            }
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }

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
