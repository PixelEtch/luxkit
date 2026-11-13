/* Registers the site-wide service worker (site/sw.js). Skipped on file:// and old browsers. */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  var here = document.currentScript && document.currentScript.src;
  if (!here) return;
  var root = new URL("../", here); // this file lives in site/shared/
  window.addEventListener("load", function () {
    navigator.serviceWorker.register(new URL("sw.js", root).href, { scope: root.pathname })
      .catch(function (err) { if (window.console) console.warn("Offline mode unavailable:", err); });
  });
})();
