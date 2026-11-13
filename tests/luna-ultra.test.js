"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../site/shared/exposure-core.js");
const Luna = require("../site/luna-ultra/camera.js");

const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const calc = (o) => Luna.calculate({ ...Luna.DEFAULTS, ...o });

test("defaults: 24 fps, cloudy, ND32, standard, main → ISO 125 at 1/50", () => {
  const r = Luna.calculate(Luna.DEFAULTS);
  assert.equal(r.iso, 125);
  assert.equal(r.shutterDen, 50);
  assert.equal(r.status, "ok");
  assert.equal(r.inputs.wasCorrected, false);
});

test("indoor 24 fps: ND8 → ISO 1000, ND16 → ISO 2000, shutter fixed at 1/50", () => {
  const a = calc({ light: "indoor", nd: "nd8" });
  const b = calc({ light: "indoor", nd: "nd16" });
  assert.deepEqual([a.shutterDen, a.iso, b.shutterDen, b.iso], [50, 1000, 50, 2000]);
});

test("night 24 fps no ND → 1/50, ISO 1000, about right", () => {
  const r = calc({ light: "night", nd: "none" });
  assert.deepEqual([r.shutterDen, r.iso, r.status], [50, 1000, "ok"]);
});

test("bright sun 24 fps ND64 alone → ISO 100, faster than 1/50; a stack is recommended", () => {
  const r = calc({ light: "sunny", nd: "nd64" });
  assert.equal(r.iso, 100);
  assert.ok(r.shutterDen > 50);
  assert.equal(r.ndSufficient, true); // sufficient once stacking is allowed
  assert.equal(r.recommendedNd, "nd32+nd8"); // 8 stops → ISO ≈ 126, the lowest valid
  assert.equal(r.advice, "Better: ND32 + ND8 → ISO 125 · 1/50");
});

test("stacked NDs add their stops and hold 1/50 in bright sun (I-Log)", () => {
  const cases = [["beach", "nd64", "nd32", 11], ["sunny", "nd64", "nd16", 10], ["daylight", "nd64", "nd8", 9]];
  for (const [light, nd, stack, stops] of cases) {
    const r = calc({ light, nd, stack, profile: "ilog" });
    assert.equal(r.totalStops, stops, light);
    assert.deepEqual([r.iso, r.shutterDen, r.status], [500, 50, "ok"], light);
    assert.match(r.why[0], new RegExp(`minus ${stops} stops of ND64 \\+ ND`));
    assert.ok(r.notes.some((n) => /^Stacking/.test(n)));
  }
  // Order of slots doesn't matter.
  const a = calc({ light: "sunny", nd: "nd16", stack: "nd64" });
  const b = calc({ light: "sunny", nd: "nd64", stack: "nd16" });
  assert.deepEqual([a.iso, a.shutterDen, a.advice], [b.iso, b.shutterDen, b.advice]);
});

test("a filter can't be stacked on itself", () => {
  const r = calc({ nd: "nd64", stack: "nd64" });
  assert.equal(r.totalStops, 6);
  assert.equal(r.inputs.wasCorrected, false);
  assert.ok(r.warnings.some((w) => /only one ND64/.test(w)));
});

test("too bright even for the strongest stack (ND64 + ND32)", () => {
  // Beach at 24 fps in I-Log needs ≈ 10.7 stops: 11 is enough. Tele (f/2.0) needs 0.3 less.
  assert.equal(calc({ light: "beach", profile: "ilog" }).recommendedNd, "nd64+nd32");
  const Core2 = Core.recommendNd({ sceneEv: 18, aperture: 1.8, idealDen: 50, isoMin: 400, isoMax: 6400,
    filters: Luna.SETUPS.map((s) => ({ key: s.key, stops: s.stops })), targetIso: 400, closestToTarget: true });
  assert.deepEqual([Core2.key, Core2.tooBright], ["nd64+nd32", true]);
});

test("ND64 cannot hold 1/50 in normal daylight or brighter at f/1.8", () => {
  for (const light of ["daylight", "sunny", "beach"]) {
    const r = calc({ light, nd: "nd64" });
    assert.equal(r.mode, "tooBright", light);
    assert.ok(r.shutterDen > 50, light);
  }
});

test("bright sun 240 fps ND32 → holds 1/480, about right", () => {
  const r = calc({ fps: "240", light: "sunny", nd: "nd32" });
  assert.deepEqual([r.shutterDen, r.status], [480, "ok"]);
});

test("night 240 fps ND64 → ISO 6400, 1/240, underexposed, recommends No ND", () => {
  const r = calc({ fps: "240", light: "night", nd: "nd64" });
  assert.deepEqual([r.iso, r.shutterDen, r.status, r.recommendedNd], [6400, 240, "under", "none"]);
  assert.ok(r.warnings.some((w) => /^Too dark/.test(w)));
});

test("I-Log recommendation is the valid filter closest to ISO 400", () => {
  for (const fps of Object.keys(Luna.FPS)) {
    for (const light of Object.keys(Luna.LIGHT)) {
      for (const lens of Object.keys(Luna.LENS)) {
        const r = calc({ fps, light, lens, profile: "ilog" });
        if (!r.ndSufficient) continue;
        const N = Luna.LENS[lens].aperture, t = 1 / Luna.FPS[fps].idealDen, ev = Luna.LIGHT[light].ev;
        const stopsOf = (k) => Luna.SETUPS.find((s) => s.key === k).stops;
        const dist = (k) => Math.abs(Core.log2(Core.isoRequired(ev, stopsOf(k), N, t) / 400));
        const lo = 400 * 2 ** (-1 / 6), hi = 6400 * 2 ** (1 / 6); // I-Log floor is ISO 400
        for (const k of Luna.SETUPS.map((s) => s.key)) {
          const iso = Core.isoRequired(ev, stopsOf(k), N, t);
          if (iso < lo || iso > hi) continue;
          assert.ok(dist(r.recommendedNd) <= dist(k) + 1e-9, `${fps}/${light}/${lens}: ${r.recommendedNd} vs ${k}`);
        }
      }
    }
  }
});

test("I-Log: ISO 400 floor; too bright speeds up the shutter instead", () => {
  const r = calc({ profile: "ilog" }); // cloudy, ND32: Standard would be ISO 125 at 1/50
  assert.equal(r.iso, 400);
  assert.equal(r.mode, "tooBright");
  assert.equal(r.shutterDen, 160);   // needs ≈ 1/158; nominal 1/160 is that ⅓-stop value
  assert.equal(r.status, "ok");
  assert.ok(r.residualStops >= -0.05);
  assert.match(r.why.join(" "), /I-Log minimum/);
  assert.equal(r.checklist.length, 8);
  assert.equal(calc({}).checklist.length, 7);
});

test("I-Log: in range keeps 1/50 and lands on the nominal ⅓-stop ISO", () => {
  // Indoor 24 fps ND8 needs ISO ≈ 1013; nominal 1000 is the ⅓-stop value (≈1008), within float slack.
  const log = calc({ light: "indoor", nd: "nd8", profile: "ilog" });
  assert.deepEqual([log.iso, log.shutterDen, log.status], [1000, 50, "ok"]);
  assert.ok(log.residualStops >= -0.05);
});

test("I-Log: any real underexposure is flagged", () => {
  const r = calc({ fps: "240", light: "night", nd: "nd8", profile: "ilog" });
  assert.equal(r.status, "under");
  assert.ok(r.warnings.some((w) => /Dark I-Log footage gets noisy/.test(w)));
});

test("noise warning above the clean ISO: 800 at 24/30 fps, 400 at 60+ fps", () => {
  const noisy = (r) => r.warnings.some((w) => /^Grain likely/.test(w));
  const a = calc({ light: "indoor", nd: "none" });            // 24 fps, needs ≈ 127 → ISO 125
  const b = calc({ light: "indoor", nd: "nd8" });             // 24 fps → ISO 1000
  assert.deepEqual([a.iso, noisy(a), b.iso, noisy(b)], [125, false, 1000, true]);
  assert.equal(b.cleanIso, 800);
  const c = calc({ fps: "60", light: "overcast", nd: "nd32", profile: "ilog" }); // ISO ≥ 400 at 60 fps
  assert.equal(c.cleanIso, 400);
  assert.equal(noisy(c), c.iso > 400);
  const d = calc({ fps: "60", light: "golden", nd: "nd32" }); // 60 fps, EV 5 at lens → ISO ≈ 1012
  assert.ok(d.iso > 400 && noisy(d));
  assert.match(d.warnings.join(" "), /Use less ND or add light/);
});

test("recommendation stays in the family the user has on (ND or ND/PL)", () => {
  // Shade, 24 fps: 4 stops gives ISO ≈ 126, the lowest valid ISO.
  assert.equal(calc({ light: "shade", nd: "none" }).recommendedNd, "nd16");
  assert.equal(calc({ light: "shade", nd: "nd8pl" }).recommendedNd, "nd16pl");
  const sun = calc({ light: "sunny", nd: "nd32pl" });
  assert.equal(sun.bestNdText, "ND32/PL + ND8");
  assert.ok(sun.notes.some((n) => /only mentions stacking plain NDs/.test(n)));
});

test("tele lens (f/2.0) needs ≈ ⅓ stop more ISO than main", () => {
  const m = calc({ lens: "main" });
  const t = calc({ lens: "tele" });
  assert.ok(near(Core.log2(t.isoRequired / m.isoRequired), 0.304, 0.005));
  assert.equal(t.aperture, 2.0);
  assert.match(t.why.join(" "), /f\/2\.0/);
});

test("ND/PL filters use the same stops as the plain ND (per Freewell)", () => {
  for (const k of ["nd8", "nd16", "nd32", "nd64"]) assert.equal(Luna.ND[k + "pl"].stops, Luna.ND[k].stops);
  const pl = calc({ nd: "nd32pl" });
  const plain = calc({ nd: "nd32" });
  assert.deepEqual([pl.iso, pl.shutterDen], [plain.iso, plain.shutterDen]);
  assert.ok(pl.notes.some((n) => /polariser/.test(n)));
  assert.ok(!plain.notes.some((n) => /polariser/.test(n)));
});

test("invalid inputs fall back to defaults without throwing", () => {
  for (const bad of [undefined, null, {}, { fps: "999", light: "moon", nd: "nd1000", profile: "raw", lens: "fisheye" }, { fps: NaN }]) {
    const r = Luna.calculate(bad);
    assert.equal(r.inputs.wasCorrected, true);
    assert.equal(r.iso, 125);
    assert.equal(r.shutterDen, 50);
  }
});

test("full matrix: every fps × lighting × ND × profile × lens", () => {
  let n = 0;
  for (const fps of Object.keys(Luna.FPS)) {
    for (const light of Object.keys(Luna.LIGHT)) {
      for (const nd of Luna.ND_ORDER) for (const stack of Luna.STACK_ORDER) {
        for (const profile of Object.keys(Luna.PROFILE)) {
          for (const lens of Object.keys(Luna.LENS)) {
            n++;
            const r = Luna.calculate({ fps, light, nd, stack, profile, lens });
            const id = `${fps}/${light}/${nd}+${stack}/${profile}/${lens}`;
            for (const v of [r.iso, r.shutterDen, r.idealDen, r.residualStops, r.isoRequired]) {
              assert.ok(Number.isFinite(v), `${id} finite`);
            }
            assert.ok(r.iso >= 100 && r.iso <= 6400, `${id} ISO range`);
            assert.ok(r.shutterDen >= Number(fps) && r.shutterDen <= 8000, `${id} shutter range`);
            const txt = [r.isoText, r.shutterText, r.idealText, r.bestNdText, r.advice ?? ""]
              .concat(r.why, r.warnings, r.notes).join(" ");
            assert.ok(r.isoText && r.shutterText && r.bestNdText && r.why.length, `${id} not blank`);
            assert.doesNotMatch(txt, /NaN|undefined|Infinity/, id);
            if (r.mode === "inRange") assert.equal(r.shutterDen, r.idealDen, `${id} shutter fixed`);
            if (r.mode === "tooDark") assert.equal(r.shutterDen, Number(fps), `${id} 360° shutter`);
            if (profile === "ilog") {
              assert.ok(r.iso >= 400, `${id} I-Log ISO floor`);
              if (r.iso < 6400) assert.ok(r.residualStops >= -0.05, `${id} I-Log never rounds darker`);
            }
          }
        }
      }
    }
  }
  assert.equal(n, 5 * 8 * 9 * 5 * 2 * 2);
});

test("in-page self-test passes", () => {
  const t = Luna.runSelfTests();
  const failed = t.results.filter((r) => !r.pass).map((r) => r.name);
  assert.deepEqual(failed, []);
  assert.equal(t.passed, t.total);
});

test("measured EV from a light-meter app replaces the preset", () => {
  // EV 12 measured gives exactly the Cloudy (EV 12) result.
  const m = calc({ light: "measured", ev: "12" });
  const p = calc({ light: "overcast" });
  assert.deepEqual([m.iso, m.shutterDen, m.inputs.wasCorrected], [p.iso, p.shutterDen, false]);
  assert.match(m.why[0], /^Measured EV 12 minus 5 stops/);
  assert.match(m.checklist.join(" "), /White balance: fixed, to match the light/);
  // Decimals and comma decimals work; 13.3 is 1.3 stops brighter than cloudy.
  const d = calc({ light: "measured", ev: "13,3" });
  assert.equal(d.inputs.ev, 13.3);
  assert.equal(d.sceneEv, 13.3);
  assert.ok(Math.abs(Core.log2(p.isoRequired / d.isoRequired) - 1.3) < 1e-9);
});

test("measured EV: empty, out of range or non-numbers fall back to the default preset", () => {
  for (const ev of ["", null, undefined, "abc", 25, -5, true, NaN]) {
    const r = calc({ light: "measured", ev });
    assert.equal(r.inputs.light, "overcast", String(ev));
    assert.equal(r.inputs.wasCorrected, true, String(ev));
  }
  assert.equal(calc({ light: "measured", ev: -4 }).inputs.ev, -4);
  assert.equal(calc({ light: "measured", ev: 20 }).inputs.ev, 20);
});

test("measured EV: every value from -4 to 20 in 0.1 steps gives valid output", () => {
  for (let ev = -40; ev <= 200; ev++) {
    for (const profile of ["standard", "ilog"]) {
      const r = calc({ light: "measured", ev: String(ev / 10), profile, fps: "60" });
      const txt = [r.isoText, r.shutterText, r.bestNdText, r.advice ?? ""].concat(r.why, r.warnings, r.notes, r.checklist).join(" ");
      assert.doesNotMatch(txt, /NaN|undefined|Infinity|null/, `${ev / 10}`);
      assert.ok(r.iso >= 100 && r.iso <= 6400 && r.shutterDen >= 60 && r.shutterDen <= 8000, `${ev / 10}`);
    }
  }
});
