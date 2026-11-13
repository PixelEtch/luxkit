// End-to-end tests in WebKit (closest to iPhone Safari) at iPhone 17 Pro Max size.
// Run: npx playwright test   (first time: npx playwright install webkit)
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  testMatch: "e2e.spec.js",
  timeout: 180000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "webkit",
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    hasTouch: true
  },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1 -d site",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: true
  }
});
