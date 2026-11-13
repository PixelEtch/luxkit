/* luxkit service worker: one for the whole site, cache-first.
   BUMP CACHE whenever any file in site/ changes, or phones keep the old copy. */
"use strict";
var CACHE = "luxkit-v1";

// Paths relative to this file (the site root). Pages are cached by their folder URL.
var PRECACHE = [
  "./",
  "manifest.webmanifest",
  "shared/ui.css",
  "shared/exposure-core.js",
  "shared/register-sw.js",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "luna-ultra/",
  "luna-ultra/camera.js",
  "luna-ultra/manifest.webmanifest"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // ".../index.html" and "...?v=2" are the same page as the folder URL in the cache.
  var key = url.pathname.replace(/index\.html$/, "");

  event.respondWith(
    caches.match(key, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok && res.type === "basic" && !res.redirected) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(key, copy); });
        }
        return res;
      }).catch(function () {
        // Offline and not cached: send page requests to the hub.
        if (req.mode === "navigate") return caches.match("./");
        throw new Error("offline");
      });
    })
  );
});
