// @ts-check
const { test, expect } = require("@playwright/test");
const path = require("path");

const SHOTS = path.join(__dirname, "..", "test-results", "screenshots");
const BAD = /NaN|undefined|Infinity|null/;

// Collect console errors and uncaught exceptions for every test.
const errors = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
});
test.afterEach(async () => {
  expect(errors, "console errors").toEqual([]);
});

async function noHorizontalScroll(page) {
  const [sw, vw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBe(vw);
}

async function readout(page) {
  return page.evaluate(() => ({
    iso: document.getElementById("outIso").textContent,
    shutter: document.getElementById("outShutter").textContent,
    status: document.getElementById("outStatus").textContent,
    title: document.getElementById("outTitle").textContent,
    advice: document.getElementById("ndAdvice").hidden ? "" : document.getElementById("ndAdviceText").textContent,
    steps: [...document.querySelectorAll("#outChecklist li")].map((li) => li.textContent).join(" | ")
  }));
}

function expectValid(r) {
  expect(r.iso).toMatch(/^\d{3,4}$/);
  expect(r.shutter).toMatch(/^1\/\d{2,4}$/);
  for (const v of Object.values(r)) expect(v).not.toMatch(BAD);
}

test("hub: loads, links to the Luna app, no horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "luxkit" })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("link", { name: /Insta360 Luna Ultra/ }).click();
  await expect(page).toHaveURL(/\/luna-ultra\/$/);
  await expect(page.locator("#outIso")).toHaveText("125");
});

test("luna: defaults, self-test, no horizontal scroll", async ({ page }) => {
  await page.goto("/luna-ultra/");
  const r = await readout(page);
  expect([r.iso, r.shutter, r.status]).toEqual(["125", "1/50", "Exposure about right"]);
  await expect(page.locator("#selftest")).toHaveText(/^Self-test: (\d+)\/\1 exposure checks passed\.$/);
  await noHorizontalScroll(page);
  await page.screenshot({ path: path.join(SHOTS, "01-default.png") });
});

test("luna: tapping every option once gives valid output", async ({ page }) => {
  await page.goto("/luna-ultra/");
  const labels = page.locator(".seg label");
  const n = await labels.count();
  for (let i = 0; i < n; i++) {
    const label = labels.nth(i);
    const disabled = await label.evaluate((l) => document.getElementById(l.htmlFor).disabled);
    if (disabled) continue;
    await label.scrollIntoViewIfNeeded();
    await label.click();
    if ((await label.getAttribute("for")) === "lMeasured") {
      await page.locator("#evInput").fill("13.3");
    }
    expectValid(await readout(page));
  }
  await noHorizontalScroll(page);
});

test("luna: bright sun + ND64, then Use applies the suggested stack", async ({ page }) => {
  await page.goto("/luna-ultra/");
  await page.locator('label[for="lSunny"]').click();
  await page.locator('label[for="nd64"]').click();
  let r = await readout(page);
  expect(r.iso).toBe("100");
  expect(Number(r.shutter.slice(2))).toBeGreaterThan(50); // ND64 alone can't hold 1/50 in sun
  expect(r.advice).toBe("Better: ND32 + ND8 → ISO 125 · 1/50");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, "02-bright-sun-nd64.png") });
  await page.getByRole("button", { name: "Use" }).click();
  r = await readout(page);
  expect([r.iso, r.shutter, r.advice]).toEqual(["125", "1/50", ""]);
  expect(r.title).toContain("ND32 + ND8");
});

test("luna: measured EV field", async ({ page }) => {
  await page.goto("/luna-ultra/");
  await page.locator('label[for="lMeasured"]').click();
  await expect(page.locator("#evInput")).toBeVisible();
  await expect(page.locator("#errorBox")).toContainText("Type the EV");
  await page.locator('label[for="ndNone"]').click();
  await page.locator("#evInput").fill("4,1");
  const r = await readout(page);
  expect([r.iso, r.shutter]).toEqual(["1000", "1/50"]);
  await expect(page.locator("#errorBox")).toBeHidden();
});

test("luna: every input combination renders valid output (WebKit)", async ({ page }) => {
  await page.goto("/luna-ultra/");
  const result = await page.evaluate(() => {
    const groups = {
      light: ["beach", "sunny", "daylight", "overcast", "shade", "golden", "indoor", "night"],
      fps: ["24", "30", "60", "120", "240"],
      profile: ["standard", "ilog"],
      ndBase: ["none", "nd8", "nd16", "nd32", "nd64"],
      pl: ["plain", "pl"],
      stack: ["none", "nd8", "nd16", "nd32", "nd64"],
      lens: ["main", "tele"]
    };
    const set = (name, value) => {
      const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const bad = /NaN|undefined|Infinity|null/;
    let count = 0; const failures = [];
    for (const light of groups.light) for (const fps of groups.fps) for (const profile of groups.profile)
      for (const ndBase of groups.ndBase) for (const pl of groups.pl) for (const stack of groups.stack) for (const lens of groups.lens) {
        set("light", light); set("fps", fps); set("profile", profile); set("ndBase", ndBase); set("pl", pl); set("lens", lens);
        const st = document.querySelector(`input[name="stack"][value="${stack}"]`);
        if (!st.disabled) set("stack", stack);
        count++;
        const iso = document.getElementById("outIso").textContent;
        const sh = document.getElementById("outShutter").textContent;
        const all = document.querySelector("main").innerText;
        if (!/^\d{3,4}$/.test(iso) || !/^1\/\d{2,4}$/.test(sh) || bad.test(all) || !document.getElementById("errorBox").hidden ||
            document.documentElement.scrollWidth !== window.innerWidth) {
          failures.push([light, fps, profile, ndBase, pl, stack, lens, iso, sh].join("/"));
        }
      }
    return { count, failures: failures.slice(0, 10), failureCount: failures.length };
  });
  expect(result.count).toBe(8 * 5 * 2 * 5 * 2 * 5 * 2);
  expect(result.failures).toEqual([]);
});

test("offline: works after the first visit with the network off", async ({ page, context }) => {
  await page.goto("/luna-ultra/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("#outIso")).toHaveText("125");
  await page.locator('label[for="lNight"]').click();
  await page.locator('label[for="ndNone"]').click();
  const r = await readout(page);
  expect([r.iso, r.shutter]).toEqual(["1000", "1/50"]);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "luxkit" })).toBeVisible();
  await context.setOffline(false);
});
