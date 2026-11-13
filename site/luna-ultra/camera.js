/* ==========================================================================
   Insta360 Luna Ultra: specs, presets and rules. No DOM.
   Needs shared/exposure-core.js loaded first (browser) or require()s it (Node).
   ========================================================================== */
(function (root, Core) {
  "use strict";

  // Verified Luna Ultra specs (Insta360 online manual and spec sheet, retailer listings, 2026):
  // main lens 1-inch 20mm f/1.8, tele 1/1.3-inch 60mm f/2.0 (no variable aperture),
  // ISO 100–6400, video shutter 1/8000 to 1/fps in normal video modes,
  // I-Log single native ISO 400.
  var CAMERA = {
    name: "Insta360 Luna Ultra",
    isoMin: 100,
    isoMax: 6400,
    fastestShutterDen: 8000,
    ilogNativeIso: 400
  };

  var LENS = {
    main: { aperture: 1.8, label: "Main", detail: "20mm f/1.8" },
    tele: { aperture: 2.0, label: "Tele", detail: "60mm f/2.0" }
  };

  var FPS = {
    24:  { idealDen: 50,  alt: "1/48",  label: "24 fps" },
    30:  { idealDen: 60,  alt: null,    label: "30 fps" },
    60:  { idealDen: 120, alt: null,    label: "60 fps" },
    120: { idealDen: 240, alt: "1/250", label: "120 fps" },
    240: { idealDen: 480, alt: "1/500", label: "240 fps" }
  };

  // Approximate EV100 per scene (standard exposure-value tables).
  // wbK: rough white-balance starting point in Kelvin (general photo practice, not camera-specific).
  var LIGHT = {
    beach:    { ev: 16, label: "very bright sun",       wbK: 5600 },
    sunny:    { ev: 15, label: "bright sun",            wbK: 5600 },
    daylight: { ev: 14, label: "normal daylight",       wbK: 5600 },
    overcast: { ev: 12, label: "overcast",              wbK: 6500 },
    shade:    { ev: 11, label: "shade",                 wbK: 7000 },
    golden:   { ev: 10, label: "golden hour",           wbK: 5600 },
    indoor:   { ev: 7,  label: "indoor lighting",       wbK: 3200 },
    night:    { ev: 4,  label: "night street lighting", wbK: 4000 }
  };

  // Freewell All Day kit (FW-LNUB-ALD). Freewell's product page says to "use the same starting
  // point for the ND or ND/PL version", so ND/PL hybrids use the same stops as the plain ND.
  var ND = {
    none:   { stops: 0, label: "No ND" },
    nd8:    { stops: 3, label: "ND8" },
    nd16:   { stops: 4, label: "ND16" },
    nd32:   { stops: 5, label: "ND32" },
    nd64:   { stops: 6, label: "ND64" },
    nd8pl:  { stops: 3, label: "ND8/PL",  pl: true },
    nd16pl: { stops: 4, label: "ND16/PL", pl: true },
    nd32pl: { stops: 5, label: "ND32/PL", pl: true },
    nd64pl: { stops: 6, label: "ND64/PL", pl: true }
  };
  // Weakest to strongest; on equal stops the plain ND comes first so it wins ties.
  var ND_ORDER = ["none", "nd8", "nd8pl", "nd16", "nd16pl", "nd32", "nd32pl", "nd64", "nd64pl"];

  // Second filter stacked on top: plain NDs only (Freewell: "compatible pure ND filters can work together").
  // The kit has one of each, so a filter can't be stacked on itself.
  var STACK_ORDER = ["none", "nd8", "nd16", "nd32", "nd64"];

  // Every setup the kit allows: one filter, or two different plain NDs stacked (stronger first).
  // Weakest to strongest; on equal stops a single filter comes before a stack (stable sort).
  var SETUPS = (function () {
    var list = ND_ORDER.map(function (k) { return { key: k, nd: k, stack: "none", stops: ND[k].stops }; });
    var pure = STACK_ORDER.slice(1);
    for (var i = 0; i < pure.length; i++) {
      for (var j = i + 1; j < pure.length; j++) {
        list.push({ key: pure[j] + "+" + pure[i], nd: pure[j], stack: pure[i], stops: ND[pure[j]].stops + ND[pure[i]].stops });
      }
    }
    return list.sort(function (x, y) { return x.stops - y.stops; });
  })();

  function setupLabel(ndKey, stackKey) {
    if (stackKey === "none") return ND[ndKey].label;
    if (ndKey === "none") return ND[stackKey].label;
    return ND[ndKey].label + " + " + ND[stackKey].label;
  }
  // Same physical filters regardless of which slot they were picked in.
  function setupId(ndKey, stackKey) {
    return [ndKey, stackKey].filter(function (k) { return k !== "none"; }).sort().join("+") || "none";
  }

  // I-Log: ISO 400 is treated as the floor (native ISO; lower ISO in I-Log is unverified),
  // exposure rounds brighter, and almost any underexposure is flagged, because CineD's lab test
  // found I-Log shadows break up about 1 stop under while highlights hold better.
  var PROFILE = {
    standard: { label: "Standard", targetIso: 100, closestToTarget: false, isoFloor: 100, brighter: false, okUnderStops: 0.34, okOverStops: 0.34 },
    // okOverStops 0.5: room for the widest shutter step (1/60→1/80 ≈ 0.42 stops) when rounding brighter.
    ilog:     { label: "I-Log",    targetIso: 400, closestToTarget: true,  isoFloor: 400, brighter: true,  okUnderStops: 0.05, okOverStops: 0.5 }
  };

  var DEFAULTS = { fps: "24", light: "overcast", nd: "nd32", stack: "none", profile: "standard", lens: "main" };

  // Highest ISO that still looks clean, from Cinema Tools' independent noise test (2026):
  // 4K24 relatively clean up to ISO 800; 60/120 fps (less noise reduction) noisy from ISO 400.
  function cleanIsoLimit(fps) { return fps <= 30 ? 800 : 400; }

  var has = function (obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); };
  var round1 = Core.round1, fmtS = Core.formatShutter;

  // Measured scene brightness (EV at ISO 100) typed in from a light-meter app.
  // Range covers moonlit streets to snow in full sun with margin.
  var MEASURED_EV = { min: -4, max: 20 };
  function parseEv(v) {
    if (typeof v !== "number" && typeof v !== "string") return null;
    var s = String(v).trim().replace(",", ".");
    var n = Number(s);
    return s !== "" && isFinite(n) && n >= MEASURED_EV.min && n <= MEASURED_EV.max ? Math.round(n * 10) / 10 : null;
  }

  function sanitize(inputs) {
    var i = inputs || {};
    var ev = parseEv(i.ev);
    var measuredOk = i.light === "measured" && ev !== null;
    var clean = {
      fps: has(FPS, String(i.fps)) ? String(i.fps) : DEFAULTS.fps,
      light: has(LIGHT, i.light) || measuredOk ? i.light : DEFAULTS.light,
      ev: measuredOk ? ev : null,
      nd: has(ND, i.nd) ? i.nd : DEFAULTS.nd,
      profile: has(PROFILE, i.profile) ? i.profile : DEFAULTS.profile,
      lens: has(LENS, i.lens) ? i.lens : DEFAULTS.lens,
      // Optional input: missing means no stack.
      stack: STACK_ORDER.indexOf(i.stack) >= 0 ? i.stack : DEFAULTS.stack
    };
    clean.wasCorrected = clean.fps !== String(i.fps) || clean.light !== i.light || clean.nd !== i.nd ||
      clean.profile !== i.profile || clean.lens !== i.lens || (i.stack !== undefined && clean.stack !== i.stack);
    return clean;
  }

  function calculate(rawInputs) {
    var inp = sanitize(rawInputs);
    var fps = Number(inp.fps);
    var fpsInfo = FPS[inp.fps];
    var measured = inp.light === "measured";
    var light = measured ? { ev: inp.ev, label: "measured", wbK: null } : LIGHT[inp.light];
    var nd = ND[inp.nd];
    var lens = LENS[inp.lens];
    var profile = PROFILE[inp.profile];
    var N = lens.aperture;
    var idealDen = fpsInfo.idealDen;
    var duplicateStack = inp.stack !== "none" && inp.stack === inp.nd;
    var stackKey = duplicateStack ? "none" : inp.stack;
    var totalStops = nd.stops + ND[stackKey].stops;
    var filterLabel = setupLabel(inp.nd, stackKey);
    var evAtSensor = light.ev - totalStops;
    var ilog = inp.profile === "ilog";
    var isoFloor = Math.max(CAMERA.isoMin, profile.isoFloor);

    var s = Core.solveExposure({
      sceneEv: light.ev, ndStops: totalStops, aperture: N, fps: fps, idealDen: idealDen,
      isoMin: isoFloor, isoMax: CAMERA.isoMax, fastestShutterDen: CAMERA.fastestShutterDen,
      brighter: profile.brighter, okUnderStops: profile.okUnderStops, okOverStops: profile.okOverStops
    });
    var iso = s.iso, den = s.den, mode = s.mode, status = s.status, residual = s.residualStops;

    var rec = Core.recommendNd({
      sceneEv: light.ev, aperture: N, idealDen: idealDen, isoMin: isoFloor, isoMax: CAMERA.isoMax,
      filters: SETUPS.map(function (x) { return { key: x.key, stops: x.stops }; }),
      targetIso: profile.targetIso, closestToTarget: profile.closestToTarget
    });

    // Same density either way: stay in the family (ND or ND/PL) the user has on.
    var recSetup = SETUPS.filter(function (x) { return x.key === rec.key; })[0];
    var recNd = recSetup.nd, recStack = recSetup.stack;
    if (nd.pl && has(ND, recNd + "pl")) recNd += "pl";
    var recLabel = setupLabel(recNd, recStack);
    var recKey = recNd + (recStack === "none" ? "" : "+" + recStack);

    // ---- Warnings (short: one line each, plain words) ----
    var warnings = [];
    if (status === "over") {
      warnings.push("Too bright by about " + round1(residual) + " stops. Add more ND.");
    } else if (status === "under") {
      warnings.push("Too dark by about " + Math.max(0.1, round1(-residual)) + " stops. Remove ND or add light." +
        (ilog ? " Dark I-Log footage gets noisy." : ""));
    }
    if (mode === "tooBright") {
      warnings.push("Shutter is faster than ideal, so motion looks choppy.");
    }
    if (mode === "tooDark") {
      warnings.push("Shutter is at its slowest (" + fmtS(den) + "), so motion is extra blurry.");
    }
    if (duplicateStack) {
      warnings.push("You have only one " + nd.label + ". Second filter ignored.");
    }
    var cleanIso = cleanIsoLimit(fps);
    if (iso > cleanIso && status !== "over") {
      warnings.push("Grain likely above ISO " + cleanIso + " at " + fps + " fps. " +
        (totalStops ? "Use less ND or add light." : "Add light" + (fps > 30 ? " or use 24/30 fps." : ".")));
    }

    // ---- ND recommendation ----
    var bestNdText = rec.tooBright ? "Stronger than " + recLabel : recLabel;
    // What the camera would read with the recommended filter(s) on.
    var preview = Core.solveExposure({
      sceneEv: light.ev, ndStops: recSetup.stops, aperture: N, fps: fps, idealDen: idealDen,
      isoMin: isoFloor, isoMax: CAMERA.isoMax, fastestShutterDen: CAMERA.fastestShutterDen,
      brighter: profile.brighter, okUnderStops: profile.okUnderStops, okOverStops: profile.okOverStops
    });
    var previewText = "ISO " + preview.iso + " · " + fmtS(preview.den);

    var advice = null, adviceAlert = false;
    if (rec.tooBright) {
      var need = Math.ceil(rec.stopsNeeded - 0.17);
      advice = "Too bright even for " + recLabel + " (needs about " + Core.ndNameForStops(need) +
        "). Use it and accept a faster shutter, or pick a higher frame rate.";
      adviceAlert = true;
    } else if (setupId(recNd, recStack) !== setupId(inp.nd, stackKey)) {
      advice = "Better: " + (recNd === "none" ? "no ND" : recLabel) + " → " + previewText;
    }

    // ---- Why ----
    var why = [];
    why.push((measured ? "Measured EV " : "Approx. EV ") + light.ev + (measured ? "" : " (" + light.label + ")") +
      (totalStops ? " minus " + totalStops + " stops of " + filterLabel +
        " leaves EV " + round1(evAtSensor) + " at the lens." : " with no ND."));
    var at = "f/" + N.toFixed(1);
    if (mode === "inRange") {
      why.push("At " + at + " and the 180° shutter " + fmtS(idealDen) + ", correct exposure needs ISO ≈ " +
        Math.round(s.isoRequired) + ", rounded to " + iso + ". Shutter stays put to keep natural motion blur.");
    } else if (mode === "tooBright") {
      why.push("At " + at + " and " + fmtS(idealDen) + " it would need ISO ≈ " + Math.max(1, Math.round(s.isoRequired)) +
        (ilog ? ", below I-Log’s native 400, which this app treats as the I-Log minimum,"
          : ", below the camera’s " + CAMERA.isoMin + " minimum,") +
        " so ISO sits at " + isoFloor + " and the shutter speeds up instead.");
    } else {
      why.push("At " + at + " and " + fmtS(idealDen) + " it would need ISO ≈ " + Math.round(s.isoRequired) +
        ", above the " + CAMERA.isoMax + " maximum, so the shutter opens to " + fmtS(den) + " first.");
    }
    if (ilog && iso !== CAMERA.ilogNativeIso && status !== "under") {
      why.push("I-Log’s native ISO is 400; you’re at " + iso + ". A lighter ND or more light gets you closer.");
    }

    // ---- Notes ----
    var notes = [];
    if (fps <= 30) {
      notes.push("Even with correct motion blur, fast pans at " + fps + " fps can judder. Pan slowly or use 60 fps for quick moves.");
    }
    if (fpsInfo.alt) {
      notes.push("If the camera offers " + fpsInfo.alt + " instead of " + fmtS(idealDen) + ", either is fine.");
    }
    if (fps === 120) notes.push("120 fps is available up to 4K on the Luna Ultra.");
    if (fps === 240) notes.push("240 fps is 1080p only on the Luna Ultra.");
    if (fps >= 120 && inp.profile === "ilog") {
      notes.push("Not verified: whether I-Log is offered in Slow Motion mode. Check on the camera.");
    }
    if (stackKey !== "none" || recStack !== "none") {
      notes.push("Stacking: Freewell says plain ND filters can be stacked. Check the frame corners for darkening and keep both " +
        "filters clean; not verified on this camera." + (nd.pl ? " Freewell only mentions stacking plain NDs, not ND/PL." : ""));
    }
    if (nd.pl) {
      notes.push("Freewell rates " + nd.label + " the same as the plain ND (" + nd.stops + " stops). The polariser cuts glare " +
        "and can darken blue sky depending on angle, so check exposure on the camera.");
    }
    if (ilog) {
      notes.push("This app keeps I-Log at ISO 400 or above. The camera may allow lower ISO in I-Log (not verified), " +
        "but going below a log profile’s native ISO generally costs highlight range.");
    }
    if (inp.lens === "tele") {
      notes.push("The tele lens is used at 3× zoom and above. At 8K its rolling shutter is slow (≈25 ms in CineD’s test), so avoid fast pans.");
    }

    // ---- Step-by-step camera setup (beginner-friendly, both profiles) ----
    var checklist = [
      "Swipe in from the right edge → switch Basic to Pro.",
      "Colour: " + profile.label + ".",
      "ISO: Manual, " + iso + ". Not Auto, which adds smeary noise.",
      "Shutter: Manual, " + fmtS(den) + ".",
      "Filter: " + (filterLabel === "No ND" ? "none" : filterLabel) + ".",
      measured ? "White balance: fixed, to match the light (about 5600K in daylight), not Auto."
        : "White balance: about " + light.wbK + "K, not Auto.",
      "Settings → Video bitrate: High."
    ];
    if (ilog) {
      checklist.push("No histogram in I-Log: check the colour preview or the Insta360 app. If unsure, go brighter, never darker.");
    }

    return {
      inputs: inp,
      aperture: N,
      isoFloor: isoFloor,
      cleanIso: cleanIso,
      checklist: checklist,
      iso: iso,
      isoText: Core.formatIso(iso),
      shutterDen: den,
      shutterText: fmtS(den),
      idealDen: idealDen,
      idealText: fmtS(idealDen),
      shutterChanged: den !== idealDen,
      isoRequired: s.isoRequired,
      evAtSensor: evAtSensor,
      sceneEv: light.ev,
      residualStops: residual,
      status: status,
      mode: mode,
      recommendedNd: recKey,
      recommendedInputs: { nd: recNd, stack: recStack },
      recommendedPreview: previewText,
      totalStops: totalStops,
      filterLabel: filterLabel,
      ndSufficient: rec.sufficient,
      bestNdText: bestNdText,
      advice: advice,
      adviceAlert: adviceAlert,
      warnings: warnings,
      why: why,
      notes: notes
    };
  }

  // ---------------- In-page self-test (also run by the Node tests) ----------------
  function runSelfTests() {
    var results = [];
    function check(name, cond) { results.push({ name: name, pass: !!cond }); }
    function near(a, b, eps) { return Math.abs(a - b) <= (eps || 0.01); }
    var log2 = Core.log2, isoReq = Core.isoRequired, ev = Core.ev100FromSettings;

    check("Sunny 16: f/16, 1/100, ISO 100 ≈ EV 14.64", near(ev(16, 1 / 100, 100), 14.64));
    check("f/1.8, 1/50, ISO 100 ≈ EV 7.34", near(ev(1.8, 1 / 50, 100), 7.34));
    check("f/1, 1s, ISO 100 = EV 0", near(ev(1, 1, 100), 0));
    check("isoRequired inverts ev100FromSettings", near(isoReq(ev(1.8, 1 / 50, 800), 0, 1.8, 1 / 50), 800, 0.001));

    var base = isoReq(12, 0, 1.8, 1 / 50);
    [["ND8", 3, 8], ["ND16", 4, 16], ["ND32", 5, 32], ["ND64", 6, 64]].forEach(function (c) {
      check(c[0] + " = " + c[2] + "× required ISO", near(isoReq(12, c[1], 1.8, 1 / 50) / base, c[2], 1e-9));
    });

    var def = calculate(DEFAULTS);
    check("Defaults: ISO 125 at 1/50", def.iso === 125 && def.shutterDen === 50);

    var a = calculate({ fps: "24", light: "indoor", nd: "nd8", profile: "standard", lens: "main" });
    var b = calculate({ fps: "24", light: "indoor", nd: "nd16", profile: "standard", lens: "main" });
    check("Indoor 24fps ND8→ND16: shutter fixed, ISO 1000→2000",
      a.shutterDen === 50 && b.shutterDen === 50 && a.iso === 1000 && b.iso === 2000);

    var n = calculate({ fps: "24", light: "night", nd: "none", profile: "standard", lens: "main" });
    check("Night 24fps no ND: 1/50, ISO 1000, about right", n.shutterDen === 50 && n.iso === 1000 && n.status === "ok");

    var sun = calculate({ fps: "24", light: "sunny", nd: "nd64", profile: "standard", lens: "main" });
    check("Bright sun 24fps ND64: ISO 100, faster shutter; ND64 + ND8 stack holds 1/50",
      sun.iso === 100 && sun.shutterDen > 50 && sun.recommendedInputs.stack !== "none" &&
      calculate({ fps: "24", light: "sunny", nd: "nd64", stack: "nd8", profile: "standard", lens: "main" }).shutterDen === 50);

    var slo = calculate({ fps: "240", light: "sunny", nd: "nd32", profile: "standard", lens: "main" });
    check("Bright sun 240fps ND32: holds 1/480", slo.shutterDen === 480 && slo.status === "ok");

    var dark = calculate({ fps: "240", light: "night", nd: "nd64", profile: "standard", lens: "main" });
    check("Night 240fps ND64: ISO 6400, 1/240, under, recommends No ND",
      dark.iso === 6400 && dark.shutterDen === 240 && dark.status === "under" && dark.recommendedNd === "none");

    var m = calculate({ fps: "24", light: "overcast", nd: "nd32", profile: "standard", lens: "main" });
    var t = calculate({ fps: "24", light: "overcast", nd: "nd32", profile: "standard", lens: "tele" });
    check("Tele f/2.0 needs ≈ ⅓ stop more ISO", near(log2(t.isoRequired / m.isoRequired), 0.304, 0.005));

    var il = calculate({ fps: "24", light: "overcast", nd: "nd32", profile: "ilog", lens: "main" });
    check("I-Log default scene: ISO 400 floor, faster shutter, not under",
      il.iso === 400 && il.shutterDen > 50 && il.status !== "under" && il.checklist.length > 0);

    var bad = calculate({ fps: "999", light: "moon", nd: "nd1000", profile: "raw", lens: "fisheye" });
    check("Invalid inputs fall back to defaults", bad.inputs.wasCorrected && bad.iso === 125 && bad.shutterDen === 50);

    var total = 0, ok = true;
    Object.keys(FPS).forEach(function (f) {
      Object.keys(LIGHT).forEach(function (l) {
        ND_ORDER.forEach(function (k) {
          STACK_ORDER.forEach(function (st) {
          Object.keys(PROFILE).forEach(function (p) {
            Object.keys(LENS).forEach(function (ln) {
              total++;
              var r = calculate({ fps: f, light: l, nd: k, stack: st, profile: p, lens: ln });
              var txt = [r.isoText, r.shutterText, r.idealText, r.bestNdText, r.advice || "x"]
                .concat(r.why, r.warnings, r.notes).join(" ");
              if (![r.iso, r.shutterDen, r.residualStops, r.isoRequired].every(Core.isFiniteNum) ||
                  r.iso < CAMERA.isoMin || r.iso > CAMERA.isoMax ||
                  r.shutterDen < Number(f) || r.shutterDen > CAMERA.fastestShutterDen ||
                  /NaN|undefined|Infinity/.test(txt) ||
                  (r.mode === "inRange" && r.shutterDen !== r.idealDen) ||
                  (p === "ilog" && (r.iso < 400 || (r.residualStops < -0.05 && r.iso !== CAMERA.isoMax)))) ok = false;
            });
          });
          });
        });
      });
    });
    check("All " + total + " combinations valid", ok);

    var passed = results.filter(function (r) { return r.pass; }).length;
    return { passed: passed, total: results.length, results: results };
  }

  var api = {
    CAMERA: CAMERA, LENS: LENS, FPS: FPS, LIGHT: LIGHT, MEASURED_EV: MEASURED_EV, ND: ND, ND_ORDER: ND_ORDER,
    STACK_ORDER: STACK_ORDER, SETUPS: SETUPS,
    PROFILE: PROFILE, DEFAULTS: DEFAULTS,
    sanitize: sanitize, calculate: calculate, runSelfTests: runSelfTests
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LunaUltra = api;
})(typeof window !== "undefined" ? window : globalThis,
   typeof module !== "undefined" && module.exports ? require("../shared/exposure-core.js")
     : (typeof window !== "undefined" ? window : globalThis).ExposureCore);
