/* ==========================================================================
   luxkit exposure core: camera-agnostic EV maths. No DOM.
   Loads as a plain <script> (window.ExposureCore) and in Node (require).
   EV100 = log2(N²/t) − log2(ISO/100)
   ========================================================================== */
(function (root) {
  "use strict";

  // Half of a ⅓-stop step: how far past the ISO limits still counts as reachable.
  var TOL = 1 / 6;
  // Residual within this many stops counts as "about right".
  var OK_STOPS = 0.34;

  // Common ⅓-stop ISO values. Cameras filter these to their own range.
  var ISO_STEPS = [50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600,
    2000, 2500, 3200, 4000, 5000, 6400, 8000, 10000, 12800, 16000, 20000, 25600];
  // Common video shutter denominators (1/x).
  var SHUTTER_STEPS = [24, 25, 30, 40, 48, 50, 60, 80, 100, 120, 125, 160, 200, 240, 250, 320, 400, 480,
    500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000, 6400, 8000];

  function log2(x) { return Math.log(x) / Math.LN2; }
  function isFiniteNum(x) { return typeof x === "number" && isFinite(x); }

  function ev100FromSettings(N, t, iso) {
    return log2((N * N) / t) - log2(iso / 100);
  }

  // ISO that gives correct exposure for a scene, after ND, at aperture N and shutter t.
  function isoRequired(sceneEv, ndStops, N, t) {
    return 100 * Math.pow(2, log2((N * N) / t) - (sceneEv - ndStops));
  }

  // Shutter time giving correct exposure at a given ISO.
  function shutterRequired(sceneEv, ndStops, N, iso) {
    return (N * N) / Math.pow(2, (sceneEv - ndStops) + log2(iso / 100));
  }

  function nearestInLog(list, x) {
    var best = list[0], bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = Math.abs(log2(list[i] / x));
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  // Slack for float error when rounding "brighter" (stops).
  var EPS_STOPS = 0.02;

  // Smallest list value at or above x (brighter exposure); falls back to the largest.
  function atOrAbove(list, x) {
    for (var i = 0; i < list.length; i++) if (list[i] >= x * Math.pow(2, -EPS_STOPS)) return list[i];
    return list[list.length - 1];
  }

  // Largest list value at or below x (slower shutter = brighter); falls back to the smallest.
  function atOrBelow(list, x) {
    var best = list[0];
    for (var i = 0; i < list.length; i++) if (list[i] <= x * Math.pow(2, EPS_STOPS)) best = list[i];
    return best;
  }

  function isoBounds(cam) {
    return { lo: cam.isoMin * Math.pow(2, -TOL), hi: cam.isoMax * Math.pow(2, TOL) };
  }

  /*
   * Solve ISO and shutter for one scene.
   * p: { sceneEv, ndStops, aperture, fps, idealDen, isoMin, isoMax, fastestShutterDen,
   *      brighter (optional: round toward more exposure, never less),
   *      okUnderStops / okOverStops (optional: error still "ok", default OK_STOPS) }
   * Keeps the 180° shutter whenever ISO can cover it; never moves both together.
   */
  function solveExposure(p) {
    var N = p.aperture;
    var idealDen = p.idealDen;
    var b = isoBounds(p);
    var isoList = ISO_STEPS.filter(function (s) { return s >= p.isoMin && s <= p.isoMax; });
    var isoReq = isoRequired(p.sceneEv, p.ndStops, N, 1 / idealDen);
    var pickIso = p.brighter ? atOrAbove : nearestInLog;

    var iso, den, mode;
    if (isoReq >= b.lo && isoReq <= b.hi) {
      // Shutter stays at 180°; ISO does the work.
      mode = "inRange";
      den = idealDen;
      iso = pickIso(isoList, isoReq);
    } else if (isoReq < b.lo) {
      // Too bright: ISO floors at minimum, shutter gets faster (capped).
      mode = "tooBright";
      iso = p.isoMin;
      var denExact = 1 / shutterRequired(p.sceneEv, p.ndStops, N, iso);
      var candidates = SHUTTER_STEPS.filter(function (s) { return s >= idealDen && s <= p.fastestShutterDen; });
      den = denExact >= p.fastestShutterDen ? p.fastestShutterDen
        : (p.brighter ? atOrBelow : nearestInLog)(candidates, denExact);
    } else {
      // Too dark: shutter opens to 1/fps first, then ISO tops out.
      mode = "tooDark";
      den = p.fps;
      var iso2 = isoRequired(p.sceneEv, p.ndStops, N, 1 / den);
      iso = iso2 <= b.hi ? pickIso(isoList, Math.max(iso2, p.isoMin)) : p.isoMax;
    }

    // Residual in stops: + overexposed, − underexposed.
    var residual = log2(iso / isoRequired(p.sceneEv, p.ndStops, N, 1 / den));
    var okUnder = typeof p.okUnderStops === "number" ? p.okUnderStops : OK_STOPS;
    var okOver = typeof p.okOverStops === "number" ? p.okOverStops : OK_STOPS;
    var status = residual > okOver ? "over" : (residual < -okUnder ? "under" : "ok");

    return { iso: iso, den: den, mode: mode, isoRequired: isoReq, residualStops: residual, status: status };
  }

  /*
   * Pick the best filter at the ideal shutter.
   * p: { sceneEv, aperture, idealDen, isoMin, isoMax, filters: [{key, stops}], targetIso, closestToTarget }
   * closestToTarget false: lowest ISO wins (least noise). true: ISO closest to targetIso wins.
   * Ties keep the earlier filter in the list.
   */
  function recommendNd(p) {
    var b = isoBounds(p);
    var t = 1 / p.idealDen;
    var valid = [], allTooBright = true, allTooDark = true;

    p.filters.forEach(function (f) {
      var req = isoRequired(p.sceneEv, f.stops, p.aperture, t);
      if (req >= b.lo) allTooBright = false;
      if (req <= b.hi) allTooDark = false;
      if (req >= b.lo && req <= b.hi) valid.push({ key: f.key, iso: req });
    });

    if (valid.length) {
      var best = valid[0];
      valid.forEach(function (v) {
        var better = p.closestToTarget
          ? Math.abs(log2(v.iso / p.targetIso)) < Math.abs(log2(best.iso / p.targetIso))
          : v.iso < best.iso;
        if (better) best = v;
      });
      return { key: best.key, sufficient: true, tooBright: false, tooDark: false, stopsNeeded: null };
    }

    var strongest = p.filters.reduce(function (a, f) { return f.stops > a.stops ? f : a; });
    var weakest = p.filters.reduce(function (a, f) { return f.stops < a.stops ? f : a; });
    if (allTooBright) {
      var stopsNeeded = p.sceneEv - log2((p.aperture * p.aperture) * p.idealDen) + log2(p.targetIso / 100);
      return { key: strongest.key, sufficient: false, tooBright: true, tooDark: false, stopsNeeded: stopsNeeded };
    }
    return { key: weakest.key, sufficient: false, tooBright: false, tooDark: allTooDark, stopsNeeded: null };
  }

  // Nearest standard ND name for a whole number of stops, e.g. 8 → "ND256".
  function ndNameForStops(stops) { return "ND" + Math.pow(2, stops); }

  function formatShutter(den) {
    if (!isFiniteNum(den) || den <= 0) return "1/50";
    return "1/" + Math.round(den);
  }

  function formatIso(iso) {
    if (!isFiniteNum(iso) || iso <= 0) return "400";
    return String(Math.round(iso));
  }

  function round1(x) { return Math.round(x * 10) / 10; }

  var api = {
    TOL: TOL, OK_STOPS: OK_STOPS, ISO_STEPS: ISO_STEPS, SHUTTER_STEPS: SHUTTER_STEPS,
    log2: log2, isFiniteNum: isFiniteNum, round1: round1,
    ev100FromSettings: ev100FromSettings, isoRequired: isoRequired, shutterRequired: shutterRequired,
    nearestInLog: nearestInLog, atOrAbove: atOrAbove, atOrBelow: atOrBelow, solveExposure: solveExposure, recommendNd: recommendNd,
    ndNameForStops: ndNameForStops, formatShutter: formatShutter, formatIso: formatIso
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.ExposureCore = api;
})(typeof window !== "undefined" ? window : globalThis);
