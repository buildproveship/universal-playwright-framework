import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "demo.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 15_000,
  reporter: [["list"], ["json", { outputFile: "reports/demo-results.json" }]],
  use: {
    browserName: "chromium",
    headless: true,
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
});
