/* SmartLife service worker — offline app shell.
   Same file is shipped at the app root (sw.js) and under assets/ (assets/sw.js);
   all URLs are resolved against the registration scope so either copy works.
   Strategy: navigations are network-first (fresh copy when online, cached shell
   when offline); same-origin files are cache-first; Google Fonts are
   stale-while-revalidate. Non-GET requests (the Coach APIs) are never touched. */
var VERSION = "smartlife-v9";
var SHELL_CACHE = VERSION + "-shell";
var FONT_CACHE = VERSION + "-fonts";
var SCOPE = self.registration.scope;

function u(path) { return new URL(path, SCOPE).toString(); }

var SHELL_CANDIDATES = [
  SCOPE,
  u("index.html"),
  u("./"),
  u("assets/manifest.webmanifest"),
  u("manifest.webmanifest"),
  u("manifest.webmanifest"),
  u("assets/icon-192.png"),
  u("assets/icon-512.png"),
  u("assets/icon-maskable-512.png"),
  u("assets/icon-180.png"),
  u("../index.html"),
  u("../"),
  u("icon-192.png"),
  u("icon-512.png"),
  u("icon-maskable-512.png"),
  u("icon-180.png")
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      var seen = {};
      var jobs = [];
      SHELL_CANDIDATES.forEach(function (url) {
        if (seen[url]) return;
        seen[url] = 1;
        jobs.push(
          fetch(url, { credentials: "same-origin" })
            .then(function (res) { if (res && res.ok) return cache.put(url, res); })
            .catch(function () { /* candidate not served from this location — skip */ })
        );
      });
      return Promise.all(jobs);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== SHELL_CACHE && key !== FONT_CACHE) return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  /* Page loads: fresh when online, SmartLife shell when offline. */
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy1 = res.clone();
        var copy2 = res.clone();
        caches.open(SHELL_CACHE).then(function (cache) {
          cache.put(SCOPE, copy1);
          cache.put(u("index.html"), copy2);
        }).catch(function () {});
        return res;
      }).catch(function () {
        return caches.match(SCOPE)
          .then(function (hit) { return hit || caches.match(u("index.html")); })
          .then(function (hit) { return hit || caches.match(u("../index.html")); })
          .then(function (hit) { return hit || new Response("SmartLife is offline and not cached yet on this device. Open it once with internet, then it works fully offline.", { status: 503, headers: { "Content-Type": "text/plain" } }); });
      })
    );
    return;
  }

  /* Fonts: serve the cached copy instantly, refresh it in the background. */
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          var network = fetch(req).then(function (res) {
            if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
          return hit || network;
        });
      })
    );
    return;
  }

  /* Same-origin files (icons, manifest): cache-first. */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(SHELL_CACHE).then(function (cache) { cache.put(req, copy); });
          }
          return res;
        });
      })
    );
  }
  /* Everything else (Coach APIs over GET, etc.) goes straight to the network. */
});
