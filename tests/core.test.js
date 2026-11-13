"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../site/shared/exposure-core.js");

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

test("EV100 reference cases", () => {
  assert.ok(near(Core.ev100FromSettings(16, 1 / 100, 100), 14.64), "f/16, 1/100, ISO 100 ≈ EV 14.64");
  assert.ok(near(Core.ev100FromSettings(1.8, 1 / 50, 100), 7.34), "f/1.8, 1/50, ISO 100 ≈ EV 7.34");
  assert.ok(near(Core.ev100FromSettings(1, 1, 100), 0, 1e-12), "f/1, 1 s, ISO 100 = EV 0");
  assert.ok(near(Core.ev100FromSettings(4, 1 / 60, 200), Core.ev100FromSettings(4, 1 / 60, 100) - 1, 1e-12));
});

test("isoRequired and shutterRequired invert EV100", () => {
  const ev = Core.ev100FromSettings(1.8, 1 / 50, 800);
  assert.ok(near(Core.isoRequired(ev, 0, 1.8, 1 / 50), 800, 1e-9));
  assert.ok(near(Core.shutterRequired(ev, 0, 1.8, 800), 1 / 50, 1e-12));
});

test("each ND adds exactly its stops", () => {
  const base = Core.isoRequired(12, 0, 1.8, 1 / 50);
  for (const [stops, factor] of [[3, 8], [4, 16], [5, 32], [6, 64]]) {
    assert.ok(near(Core.isoRequired(12, stops, 1.8, 1 / 50) / base, factor, 1e-9), `ND${factor} = ${factor}×`);
  }
  assert.ok(near(Core.isoRequired(12, 6, 1.8, 1 / 50) / Core.isoRequired(12, 3, 1.8, 1 / 50), 8, 1e-9), "ND8→ND64 = 8×");
});

test("aperture f/2.0 vs f/1.8 is ≈ 0.30 stops", () => {
  const r = Core.isoRequired(12, 0, 2.0, 1 / 50) / Core.isoRequired(12, 0, 1.8, 1 / 50);
  assert.ok(near(Core.log2(r), 0.304, 0.002));
});

const cam = { aperture: 1.8, isoMin: 100, isoMax: 6400, fastestShutterDen: 8000 };

test("solveExposure: in range keeps the ideal shutter", () => {
  const s = Core.solveExposure({ ...cam, sceneEv: 7, ndStops: 3, fps: 24, idealDen: 50 });
  assert.equal(s.mode, "inRange");
  assert.equal(s.den, 50);
  assert.equal(s.iso, 1000);
  assert.equal(s.status, "ok");
});

test("solveExposure: too bright floors ISO and speeds up shutter, capped at 1/8000", () => {
  const s = Core.solveExposure({ ...cam, sceneEv: 15, ndStops: 6, fps: 24, idealDen: 50 });
  assert.equal(s.mode, "tooBright");
  assert.equal(s.iso, 100);
  assert.ok(s.den > 50 && s.den <= 8000);
  const x = Core.solveExposure({ ...cam, sceneEv: 25, ndStops: 0, fps: 24, idealDen: 50 });
  assert.equal(x.den, 8000);
  assert.equal(x.status, "over");
});

test("solveExposure: too dark opens to 1/fps, then caps ISO", () => {
  const s = Core.solveExposure({ ...cam, sceneEv: 4, ndStops: 6, fps: 240, idealDen: 480 });
  assert.equal(s.mode, "tooDark");
  assert.equal(s.den, 240);
  assert.equal(s.iso, 6400);
  assert.equal(s.status, "under");
});

test("solveExposure brighter: rounds ISO up and shutter slower, custom tolerances", () => {
  assert.equal(Core.atOrAbove([100, 125, 160], 130), 160);
  assert.equal(Core.atOrAbove([100, 125, 160], 126), 125); // nominal 125 ≈ 126, within float slack
  assert.equal(Core.atOrBelow([50, 60, 80], 75), 60);
  // Needs ≈ 126.6: nominal "125" is the ⅓-stop value 126, within the 0.02-stop slack.
  const s = Core.solveExposure({ ...cam, sceneEv: 7, ndStops: 0, fps: 24, idealDen: 50, brighter: true });
  assert.equal(s.iso, 125);
  // Needs ≈ 133 (between 125 and 160): brighter picks 160, nearest picks 125.
  const x = { ...cam, sceneEv: 7 - Core.log2(133 / 126.6), ndStops: 0, fps: 24, idealDen: 50 };
  assert.equal(Core.solveExposure({ ...x, brighter: true }).iso, 160);
  assert.equal(Core.solveExposure(x).iso, 125);
  const t = Core.solveExposure({ ...cam, isoMin: 400, sceneEv: 12, ndStops: 5, fps: 24, idealDen: 50, brighter: true, okOverStops: 0.5 });
  assert.equal(t.iso, 400);
  assert.equal(t.den, 160); // needs ≈ 1/158: nominal 1/160 is the ⅓-stop value
  assert.ok(t.residualStops >= -0.05 && t.status === "ok");
  // EV 4 − 3 stops at 1/240 needs ISO ≈ 38900: capped at 6400, so underexposed.
  const u = Core.solveExposure({ ...cam, sceneEv: 4, ndStops: 3, fps: 240, idealDen: 480, okUnderStops: 0.05 });
  assert.equal(u.status, "under");
});

const filters = [{ key: "none", stops: 0 }, { key: "a", stops: 3 }, { key: "b", stops: 4 }, { key: "b2", stops: 4 }, { key: "c", stops: 6 }];
const rec = (o) => Core.recommendNd({ ...cam, idealDen: 50, filters, targetIso: 100, closestToTarget: false, ...o });

test("recommendNd: lowest ISO, closest to target, ties keep first", () => {
  // EV 12 at f/1.8, 1/50: only 6 stops is valid (ISO ≈ 253); 4 stops gives ≈ 63, too bright.
  assert.equal(rec({ sceneEv: 12 }).key, "c");
  // EV 11: 4 stops → ISO ≈ 126 (lowest valid); "b" and "b2" tie, first wins. 6 stops → ≈ 506.
  assert.equal(rec({ sceneEv: 11 }).key, "b");
  // Same scene, I-Log target 400: 506 is closer to 400 than 126.
  assert.equal(rec({ sceneEv: 11, targetIso: 400, closestToTarget: true }).key, "c");
});

test("recommendNd: all too bright and all too dark", () => {
  const bright = rec({ sceneEv: 16 });
  assert.equal(bright.sufficient, false);
  assert.equal(bright.tooBright, true);
  assert.equal(bright.key, "c");
  assert.ok(near(bright.stopsNeeded, 16 - Core.log2(1.8 * 1.8 * 50), 1e-9));
  assert.equal(Core.ndNameForStops(Math.ceil(7.66 - 0.17)), "ND256");
  const dark = Core.recommendNd({ ...cam, sceneEv: -2, idealDen: 480, filters, targetIso: 100, closestToTarget: false });
  assert.equal(dark.key, "none");
  assert.equal(dark.tooDark, true);
});

test("formatters never return NaN/Infinity", () => {
  assert.equal(Core.formatShutter(NaN), "1/50");
  assert.equal(Core.formatShutter(0), "1/50");
  assert.equal(Core.formatShutter(479.6), "1/480");
  assert.equal(Core.formatIso(Infinity), "400");
  assert.equal(Core.formatIso(125.4), "125");
});
