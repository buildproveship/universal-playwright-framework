// Test classification: integration
// Review status: Not Reviewed
// Evidence: synthetic
// Scope: Separate installed Playwright assertion code shares the framework's real empty browser without initializing two test runners; no customer execution.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
const exec = promisify(execFile);
test("RR207-PLAYWRIGHT-ISOLATION-001 an independently installed product assertion package uses the borrowed browser", async () => {
  const { stdout } = await exec(
    process.execPath,
    [path.join(__dirname, "isolated-product-playwright.fixture.js")],
    {
      timeout: 30000,
      maxBuffer: 200000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      },
    },
  );
  assert.deepEqual(JSON.parse(stdout), {
    productAssertionPassed: true,
  });
});
